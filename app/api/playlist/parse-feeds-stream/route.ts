import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';
import { ValueTagParser } from '@/lib/lightning/value-parser';
import { isValidFeedUrl, normalizeUrl } from '@/lib/url-utils';
import { calculateTrackOrder } from '@/lib/rss-parser-db';
import { preserveImageVersion } from '@/lib/feeds/image-version-url';

const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY;
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET;
const API_BASE_URL = 'https://api.podcastindex.org/api/1.0';

function generateAuthHeaders() {
  if (!PODCAST_INDEX_API_KEY || !PODCAST_INDEX_API_SECRET) {
    throw new Error('Podcast Index API credentials not configured');
  }

  const apiHeaderTime = Math.floor(Date.now() / 1000);
  const data4Hash = PODCAST_INDEX_API_KEY + PODCAST_INDEX_API_SECRET + apiHeaderTime;
  const sha1Algorithm = crypto.createHash('sha1');
  const hash4Header = sha1Algorithm.update(data4Hash).digest('hex');

  return {
    'User-Agent': 'StableKraft-Feed-Parser/1.0',
    'X-Auth-Date': apiHeaderTime.toString(),
    'X-Auth-Key': PODCAST_INDEX_API_KEY,
    'Authorization': hash4Header,
  };
}

async function lookupFeedByGuid(guid: string) {
  try {
    const headers = generateAuthHeaders();
    const url = `${API_BASE_URL}/podcasts/byguid?guid=${encodeURIComponent(guid)}`;

    const response = await fetch(url, { headers });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (data.status === 'true' && data.feed) {
      return data.feed;
    }

    return null;
  } catch (error) {
    console.error(`❌ Error looking up ${guid}:`, error);
    return null;
  }
}

async function parseFeedXML(feedUrl: string): Promise<{ episodes: any[]; xmlText: string; fetchError?: string }> {
  try {
    const response = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'StableKraft-Feed-Parser/1.0'
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      return { episodes: [], xmlText: '', fetchError: `HTTP ${response.status}` };
    }

    const xmlText = await response.text();

    const episodes = [];
    const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xmlText)) !== null) {
      const itemContent = match[1];

      const titleMatch = itemContent.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/);
      const descMatch = itemContent.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>|<description>(.*?)<\/description>/);
      const guidMatch = itemContent.match(/<guid[^>]*>(.*?)<\/guid>/);
      const audioMatch = itemContent.match(/<enclosure[^>]*url="([^"]*)"[^>]*type="audio[^"]*"/);
      const imageMatch = itemContent.match(/<itunes:image[^>]*href="([^"]*)"/);
      const durationMatch = itemContent.match(/<itunes:duration>([^<]*)<\/itunes:duration>/);
      const pubDateMatch = itemContent.match(/<pubDate>([^<]*)<\/pubDate>/);
      const episodeMatch = itemContent.match(/<podcast:episode>(\d+)<\/podcast:episode>|<itunes:episode>(\d+)<\/itunes:episode>/);
      const seasonMatch = itemContent.match(/<podcast:season>(\d+)<\/podcast:season>|<itunes:season>(\d+)<\/itunes:season>/);

      const title = titleMatch ? (titleMatch[1] || titleMatch[2] || '').trim() : '';
      const description = descMatch ? (descMatch[1] || descMatch[2] || '').trim() : '';
      const guid = guidMatch ? guidMatch[1].trim() : '';
      const audioUrl = audioMatch ? audioMatch[1] : '';
      const image = imageMatch ? imageMatch[1] : '';
      const duration = durationMatch ? durationMatch[1] : '';
      const pubDate = pubDateMatch ? pubDateMatch[1] : '';
      const episode = episodeMatch ? parseInt(episodeMatch[1] || episodeMatch[2]) : null;
      const season = seasonMatch ? parseInt(seasonMatch[1] || seasonMatch[2]) : undefined;

      if (title && guid) {
        episodes.push({
          title,
          description,
          guid,
          audioUrl,
          image,
          duration,
          pubDate,
          episode,
          season
        });
      }
    }

    return { episodes, xmlText };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`❌ Error parsing feed ${feedUrl}:`, error);
    return { episodes: [], xmlText: '', fetchError: `fetch error: ${msg}` };
  }
}

function parseDuration(durationStr: string): number {
  if (!durationStr) return 0;

  if (durationStr.includes(':')) {
    const parts = durationStr.split(':').map(p => parseInt(p) || 0);
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
  }

  const numeric = parseInt(durationStr);
  return isNaN(numeric) ? 0 : numeric;
}

async function importFeedToDatabase(feedData: any, episodes: any[], xmlText?: string, existingFeedId?: string) {
  try {
    const feedId = existingFeedId || String(feedData.id || feedData.guid || `feed-${Date.now()}`);
    const feedUrl = feedData.url || '';
    const normalizedFeedUrl = feedUrl && isValidFeedUrl(feedUrl) ? normalizeUrl(feedUrl) : feedUrl;

    let parsedV4V = null;
    if (xmlText) {
      try {
        const valueParser = new ValueTagParser();
        parsedV4V = valueParser.parseValueTags(xmlText);
      } catch (v4vError) {
        // Ignore v4v parsing errors
      }
    }

    let feedV4vData = null;
    let feedV4vRecipient = null;
    if (parsedV4V?.channelValue) {
      feedV4vData = {
        type: parsedV4V.channelValue.type,
        method: parsedV4V.channelValue.method,
        suggested: parsedV4V.channelValue.suggested,
        recipients: parsedV4V.channelValue.recipients.map(r => ({
          name: r.name,
          type: r.type,
          address: r.address,
          split: r.split,
          customKey: r.customKey,
          customValue: r.customValue,
          fee: r.fee || false
        }))
      };
      feedV4vRecipient = parsedV4V.channelValue.recipients[0]?.address || null;
    }

    // Keep our image version (lib/feeds/image-version.ts): this path takes the
    // Podcast Index image and does not ask the image host.
    const storedImage = (await prisma.feed.findUnique({ where: { id: feedId }, select: { image: true } }))?.image;

    // Just update the existing feed - don't try to create/upsert
    const feed = await prisma.feed.update({
      where: { id: feedId },
      data: {
        title: feedData.title || undefined,
        description: feedData.description || undefined,
        artist: feedData.author || undefined,
        image: preserveImageVersion(feedData.image || undefined, storedImage),
        status: 'active',
        lastFetched: new Date(),
        updatedAt: new Date(),
        ...(feedV4vData && { v4vValue: feedV4vData }),
        ...(feedV4vRecipient && { v4vRecipient: feedV4vRecipient })
      }
    });

    const existingTrackCount = await prisma.track.count({
      where: { feedId: feed.id }
    });

    let trackCount = 0;

    const episodeGuids = episodes.map(e => e.guid).filter(Boolean);
    const existingTracks = episodeGuids.length > 0
      ? await prisma.track.findMany({
          where: { guid: { in: episodeGuids } },
          select: { id: true, guid: true, v4vValue: true }
        })
      : [];
    const existingTracksByGuid = new Map(existingTracks.map(t => [t.guid, t]));

    for (const episode of episodes) {
      try {
        const existingTrack = episode.guid ? existingTracksByGuid.get(episode.guid) : null;

        let v4vData = null;
        let v4vRecipient = null;

        if (episode.v4vValue && episode.v4vValue.destinations) {
          v4vData = {
            type: episode.v4vValue.model?.type || 'lightning',
            method: episode.v4vValue.model?.method || 'keysend',
            suggested: episode.v4vValue.model?.suggested,
            recipients: episode.v4vValue.destinations.map((r: any) => ({
              name: r.name,
              type: r.type,
              address: r.address,
              split: r.split,
              customKey: r.customKey,
              customValue: r.customValue,
              fee: r.fee || false
            }))
          };
          v4vRecipient = episode.v4vValue.destinations[0]?.address || null;
        } else if (parsedV4V && episode.guid) {
          const itemV4V = parsedV4V.itemValues.get(episode.guid);
          if (itemV4V) {
            v4vData = {
              type: itemV4V.type,
              method: itemV4V.method,
              suggested: itemV4V.suggested,
              recipients: itemV4V.recipients.map(r => ({
                name: r.name,
                type: r.type,
                address: r.address,
                split: r.split,
                customKey: r.customKey,
                customValue: r.customValue,
                fee: r.fee || false
              }))
            };
            v4vRecipient = itemV4V.recipients[0]?.address || null;
          }
        }

        const trackOrderValue = episode.episode
          ? calculateTrackOrder(episode.episode, episode.season)
          : trackCount + 1;

        if (!existingTrack) {
          await prisma.track.create({
            data: {
              id: `${feed.id}-${episode.guid || `track-${trackCount}-${Date.now()}`}`,
              guid: episode.guid,
              title: episode.title,
              description: episode.description || null,
              audioUrl: episode.audioUrl || '',
              duration: parseDuration(episode.duration),
              image: preserveImageVersion(episode.image || feed.image || null, feed.image),
              publishedAt: episode.pubDate ? new Date(episode.pubDate) : new Date(),
              feedId: feed.id,
              trackOrder: trackOrderValue,
              ...(v4vData && { v4vValue: v4vData }),
              ...(v4vRecipient && { v4vRecipient }),
              updatedAt: new Date()
            }
          });
          trackCount++;
        } else {
          await prisma.track.update({
            where: { id: existingTrack.id },
            data: {
              trackOrder: trackOrderValue,
              ...(v4vData && !existingTrack.v4vValue && { v4vValue: v4vData }),
              ...(v4vRecipient && !existingTrack.v4vValue && { v4vRecipient }),
              updatedAt: new Date()
            }
          });
          trackCount++;
        }
      } catch (error) {
        // Skip individual track errors
      }
    }

    return {
      feedId: feed.id,
      title: feedData.title || feed.title,
      trackCount,
      hadTracks: existingTrackCount > 0,
      newTracks: trackCount
    };

  } catch (error) {
    console.error(`❌ Error importing feed:`, error);
    return null;
  }
}

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        if (!PODCAST_INDEX_API_KEY || !PODCAST_INDEX_API_SECRET) {
          send({ error: 'Podcast Index API credentials not configured' });
          controller.close();
          return;
        }

        const unparsedFeeds = await prisma.feed.findMany({
          where: {
            status: 'active',
            type: { not: 'publisher' },
            Track: { none: {} }
          },
          take: 500
        });

        send({
          type: 'start',
          total: unparsedFeeds.length,
          message: `Found ${unparsedFeeds.length} feeds to parse`
        });

        if (unparsedFeeds.length === 0) {
          send({ type: 'complete', parsed: 0, failed: 0, totalTracks: 0 });
          controller.close();
          return;
        }

        let parsed = 0;
        let failed = 0;
        let totalTracks = 0;

        for (let i = 0; i < unparsedFeeds.length; i++) {
          const feed = unparsedFeeds[i];

          try {
            send({
              type: 'progress',
              current: i + 1,
              total: unparsedFeeds.length,
              feedTitle: feed.title,
              parsed,
              failed,
              totalTracks
            });

            let feedData = null;
            if (feed.id && feed.id.length > 10) {
              feedData = await lookupFeedByGuid(feed.id);
            }

            // Early publisher reclassification. Two signals:
            //  1. PI API medium=publisher (RSSBlue/Fountain/most hosts honor this).
            //  2. Wavlake artist-URL shape. Wavlake tags their XML with
            //     <podcast:medium>publisher</podcast:medium>, but PI API does
            //     NOT surface medium for those feeds, so the URL pattern is
            //     the only signal we have. Wavlake splits /feed/music/ (albums)
            //     from /feed/artist/ (publishers) by construction, so the shape
            //     is reliable. Skipping the RSS fetch here avoids Wavlake's
            //     IP-level 429 rate-limit on Railway.
            const candidateUrl = feedData?.url || feed.originalUrl;
            const isWavlakeArtistUrl = typeof candidateUrl === 'string'
              && /^https?:\/\/wavlake\.com\/feed\/artist\//.test(candidateUrl);
            if (feedData?.medium === 'publisher' || isWavlakeArtistUrl) {
              try {
                await prisma.feed.update({
                  where: { id: feed.id },
                  data: {
                    type: 'publisher',
                    status: 'active',
                    lastFetched: new Date(),
                    updatedAt: new Date(),
                  },
                });
                parsed++;
                const viaMedium = feedData?.medium === 'publisher';
                send({
                  type: 'feedInfo',
                  feedId: feed.id,
                  feedUrl: candidateUrl,
                  reason: viaMedium ? 'publisher-via-medium' : 'publisher-via-url',
                  message: viaMedium
                    ? 'Reclassified as publisher (PI API medium)'
                    : 'Reclassified as publisher (Wavlake artist URL)',
                });
                await new Promise(resolve => setTimeout(resolve, 100));
                continue;
              } catch {
                // Fall through to existing flow
              }
            }

            let parseResult = null;
            const feedUrl = feedData?.url || feed.originalUrl;

            if (feedData?.id) {
              try {
                const headers = generateAuthHeaders();
                const episodesResponse = await fetch(`${API_BASE_URL}/episodes/byfeedid?id=${feedData.id}&max=1000`, { headers });

                if (episodesResponse.ok) {
                  const episodesData = await episodesResponse.json();
                  if (episodesData.status === 'true' && episodesData.items && episodesData.items.length > 0) {
                    const episodes = episodesData.items.map((ep: any) => ({
                      title: ep.title,
                      description: ep.description || '',
                      guid: ep.guid,
                      audioUrl: ep.enclosureUrl || '',
                      image: ep.image || feedData.image || '',
                      duration: ep.duration?.toString() || '0',
                      pubDate: new Date(ep.datePublished * 1000).toUTCString(),
                      v4vValue: ep.value,
                      episode: ep.episode || null
                    }));
                    // Fetch RSS XML for feed-level V4V data (PI API has episode V4V but not channel-level)
                    let xmlText = '';
                    if (feedUrl) {
                      try {
                        const rssResponse = await fetch(feedUrl, { signal: AbortSignal.timeout(10000) });
                        if (rssResponse.ok) {
                          xmlText = await rssResponse.text();
                        }
                      } catch (xmlError) {
                        // Non-critical — V4V will be picked up on reparse
                      }
                    }
                    parseResult = { episodes, xmlText };
                  }
                }
              } catch (apiError) {
                // API error, will try RSS fallback
              }
            }

            if (!parseResult || !parseResult.episodes || parseResult.episodes.length === 0) {
              if (feedUrl) {
                parseResult = await parseFeedXML(feedUrl);
              }
            }

            if (!parseResult || !parseResult.episodes || parseResult.episodes.length === 0) {
              // Publisher reclassification: 0 items + <podcast:remoteItem> references =
              // a publisher feed (aggregator). Mirrors POST /api/feeds auto-detect.
              if (parseResult?.xmlText && parseResult.xmlText.includes('<podcast:remoteItem')) {
                try {
                  await prisma.feed.update({
                    where: { id: feed.id },
                    data: {
                      type: 'publisher',
                      status: 'active',
                      lastFetched: new Date(),
                      updatedAt: new Date(),
                    },
                  });
                  parsed++;
                  send({
                    type: 'feedInfo',
                    feedId: feed.id,
                    feedUrl,
                    reason: 'publisher-no-items',
                    message: 'Reclassified as publisher feed',
                  });
                  continue;
                } catch {
                  // Fall through to generic failure below
                }
              }

              failed++;
              const reason = !parseResult
                ? 'no-url-no-api-match'
                : parseResult.fetchError
                  ? 'rss-fetch-failed'
                  : 'rss-zero-items';
              send({
                type: 'feedError',
                feedId: feed.id,
                feedUrl,
                reason,
                message: parseResult?.fetchError || feed.title || null,
              });
              continue;
            }

            const importResult = await importFeedToDatabase(
              feedData || {
                id: feed.id,
                title: feed.title,
                description: feed.description,
                url: feedUrl,
                author: feed.artist,
                image: feed.image
              },
              parseResult.episodes,
              parseResult.xmlText,
              feed.id  // Pass the existing feed ID to ensure we update the right record
            );

            if (importResult) {
              // Silent-loss check: importFeedToDatabase reports trackCount for
              // every episode it processed (create OR update), but Track.guid
              // is globally unique — if another feed already owns that guid,
              // the "update" branch fires without relinking feedId, so this
              // feed ends up with zero linked tracks despite the "success".
              const actualLinkedCount = await prisma.track.count({
                where: { feedId: feed.id },
              });
              if ((importResult.trackCount || 0) > 0 && actualLinkedCount === 0) {
                const episodeGuids = parseResult.episodes
                  .map((e: any) => e.guid)
                  .filter((g: any): g is string => !!g);
                let claimants: string[] = [];
                if (episodeGuids.length > 0) {
                  const claimed = await prisma.track.findMany({
                    where: { guid: { in: episodeGuids } },
                    select: { feedId: true },
                    distinct: ['feedId'],
                    take: 5,
                  });
                  claimants = claimed.map(c => c.feedId).filter(id => id !== feed.id);
                }
                failed++;
                send({
                  type: 'feedError',
                  feedId: feed.id,
                  feedUrl,
                  reason: 'tracks-owned-elsewhere',
                  message: `${importResult.trackCount} episode(s) already linked to: ${claimants.slice(0, 3).join(', ') || '(unknown)'}${claimants.length > 3 ? ` +${claimants.length - 3} more` : ''}`,
                });
              } else {
                parsed++;
                totalTracks += importResult.newTracks || 0;
              }
            } else {
              failed++;
              send({
                type: 'feedError',
                feedId: feed.id,
                feedUrl,
                reason: 'import-failed',
                message: feed.title || null,
              });
            }

            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));

          } catch (error) {
            failed++;
            send({
              type: 'feedError',
              feedId: feed.id,
              feedUrl: feed.originalUrl,
              reason: 'exception',
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }

        send({
          type: 'complete',
          parsed,
          failed,
          totalTracks,
          message: `Completed: ${parsed} parsed, ${failed} failed, ${totalTracks} tracks imported`
        });
        controller.close();

      } catch (error) {
        send({ error: error instanceof Error ? error.message : 'Unknown error' });
        controller.close();
      }
    }
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
