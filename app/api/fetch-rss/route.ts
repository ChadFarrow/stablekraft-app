import { NextRequest, NextResponse } from 'next/server';
import { safeFetch, readCappedText, MAX_FEED_BYTES } from '@/lib/safe-fetch';
import { RateLimiter, clientIp, rateLimitHeaders } from '@/lib/rate-limit';
import { USER_AGENT } from '@/lib/user-agent';

// In-memory cache for RSS feeds
const cache = new Map<string, { data: string; timestamp: number; ttl: number }>();

// Cache TTL: 5 minutes (increased for better performance)
const CACHE_TTL = 5 * 60 * 1000;

// The cache used to be unbounded: a caller rotating URLs could grow it until the
// instance ran out of memory. Entries are capped in count as well as in bytes
// (each body is already limited to MAX_FEED_BYTES by readCappedText).
const MAX_CACHE_ENTRIES = 500;

/**
 * Per-CALLER limit.
 *
 * `isRateLimited` below keys on the TARGET domain, which is politeness toward
 * the upstream feed host — it does nothing to slow a caller rotating targets,
 * which is exactly what abuse of this route looks like.
 */
const callerLimiter = new RateLimiter(60, 60_000);

// Rate limiting: track requests per domain
const rateLimit = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_MINUTE = 20; // Increased for better performance

// Clean up expired cache entries on demand
function cleanupCache() {
  const now = Date.now();
  Array.from(cache.entries()).forEach(([key, value]) => {
    if (now - value.timestamp > value.ttl) {
      cache.delete(key);
    }
  });

  // Still over capacity after dropping expired entries? Evict oldest-first.
  if (cache.size > MAX_CACHE_ENTRIES) {
    const byAge = Array.from(cache.entries()).sort(
      (a, b) => a[1].timestamp - b[1].timestamp
    );
    for (const [key] of byAge.slice(0, cache.size - MAX_CACHE_ENTRIES)) {
      cache.delete(key);
    }
  }
}

// Clean up rate limit data on demand
function cleanupRateLimit() {
  const now = Date.now();
  Array.from(rateLimit.entries()).forEach(([domain, data]) => {
    if (now > data.resetTime) {
      rateLimit.delete(domain);
    }
  });
}

/**
 * Check if we're rate limited for a domain
 */
function isRateLimited(url: string): boolean {
  try {
    const domain = new URL(url).hostname;
    const now = Date.now();
    const limit = rateLimit.get(domain);
    
    if (!limit) {
      rateLimit.set(domain, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
      return false;
    }
    
    if (now > limit.resetTime) {
      rateLimit.set(domain, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
      return false;
    }
    
    if (limit.count >= MAX_REQUESTS_PER_MINUTE) {
      return true;
    }
    
    limit.count++;
    return false;
  } catch {
    return false;
  }
}

/**
 * Fetch with retry logic for rate limiting
 */
async function fetchWithRetry(url: string, maxRetries = 3): Promise<Response> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Check rate limiting
      if (isRateLimited(url)) {
        const delay = Math.random() * 2000 + 1000; // 1-3 seconds
        console.log(`⏳ Rate limited, waiting ${Math.round(delay)}ms before retry ${attempt}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      // safeFetch, not fetch: this route takes the URL straight from the query
      // string. Before this it was an open proxy — any caller could read
      // http://169.254.169.254/ or an internal service and get the body back.
      const result = await safeFetch(url, {
        allowHttp: true, // some podcast feeds are still plain HTTP
        timeoutMs: 10000,
        headers: {
          'User-Agent': USER_AGENT,
        },
      });

      if (!result.ok) {
        // A refusal is not retryable — the URL is not going to become safe.
        throw new Error(result.error);
      }

      const response = result.response;

      // If we get a 429, wait and retry
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const delay = retryAfter ? parseInt(retryAfter) * 1000 : (attempt * 2000);
        console.log(`🔄 429 error, waiting ${delay}ms before retry ${attempt}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      return response;
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      console.log(`⚠️ Attempt ${attempt} failed, retrying...`);
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
  
  throw new Error('Max retries exceeded');
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const clearCache = searchParams.get('clearCache');

  // Clean up expired data on each request
  cleanupCache();
  cleanupRateLimit();

  // Clear cache if requested
  if (clearCache === 'true') {
    cache.clear();
    console.log('🧹 Cache cleared');
    return NextResponse.json({ message: 'Cache cleared' });
  }

  if (!url) {
    return NextResponse.json({ error: 'URL parameter is required' }, { status: 400 });
  }

  const callerCheck = callerLimiter.check(clientIp(request.headers));
  if (!callerCheck.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: rateLimitHeaders(callerCheck) }
    );
  }

  // Check cache first
  const cacheKey = url;
  const cached = cache.get(cacheKey);
  const now = Date.now();

  if (cached && (now - cached.timestamp) < cached.ttl) {
    console.log(`📦 Cache HIT for: ${url}`);
    return new NextResponse(cached.data, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml',
        'X-Cache': 'HIT',
        'X-Cache-Age': Math.floor((now - cached.timestamp) / 1000).toString(),
      },
    });
  }

  console.log(`🔄 Cache MISS for: ${url}`);

  try {
    const response = await fetchWithRetry(url);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Capped, not response.text(): an unbounded read here went straight into
    // the in-memory cache below, so a handful of large URLs was an OOM.
    const read = await readCappedText(response, MAX_FEED_BYTES);
    if (!read.ok) {
      console.warn(`⚠️ Refused oversized RSS body for ${url}: ${read.error}`);
      return NextResponse.json({ error: 'Feed too large' }, { status: 502 });
    }
    const xmlContent = read.value;

    // Store in cache
    cache.set(cacheKey, {
      data: xmlContent,
      timestamp: now,
      ttl: CACHE_TTL,
    });

    console.log(`💾 Cached RSS feed: ${url}`);

    return new NextResponse(xmlContent, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml',
        'X-Cache': 'MISS',
        'Cache-Control': `public, max-age=${Math.floor(CACHE_TTL / 1000)}`,
      },
    });
  } catch (error) {
    console.error('Error fetching RSS feed:', error);

    return NextResponse.json(
      {
        error: 'Failed to fetch RSS feed',
        url: url
      },
      { status: 500 }
    );
  }
}