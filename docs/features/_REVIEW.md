# Feed Discovery Feature - Code Review

**Review Date:** 2025-01-30 (Updated: 2025-01-30)  
**Feature:** Automated Feed Discovery System  
**Reviewer:** AI Code Review

## Executive Summary

The feed discovery feature has been successfully implemented with good overall architecture. The system automatically discovers feeds from playlists using the Podcast Index API and integrates them into the database. However, **a critical architectural mismatch** was discovered that prevents auto-parsing from working, along with several other issues that need attention.

**Overall Assessment:** ⚠️ **Functional but has critical blocking issue**

---

## 1. Implementation Correctness

### ✅ Correctly Implemented

1. **Core Feed Discovery Flow**
   - `lib/feed-discovery.ts` correctly implements GUID resolution via Podcast Index API
   - `processPlaylistFeedDiscovery()` properly extracts unique feed GUIDs and calls `addUnresolvedFeeds()`
   - Integration into playlist routes (flowgnar, iam, itdv) is correctly placed after track resolution

2. **API Integration**
   - Podcast Index API authentication is correctly implemented with SHA1 hashing
   - Handles both singular `feed` and plural `feeds` response formats (line 117, 153 in `feed-discovery.ts`)
   - Proper error handling for API failures

3. **Database Operations**
   - Correctly checks for existing feeds before creating new ones
   - Uses feed GUID as the feed ID for lookup compatibility
   - Properly stores resolved feed metadata

### ⚠️ Issues Found

1. **CRITICAL: Architectural Mismatch - Auto-Parse Cannot Find Database Feeds** (BLOCKING)
   ```typescript:198:217:lib/feed-discovery.ts
   // Automatically process the RSS feed to extract tracks
   try {
     console.log(`🔄 Processing RSS for feed: ${newFeed.id}`);
     const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
     const parseResponse = await fetch(`${baseUrl}/api/parse-feeds?action=parse-single&feedId=${newFeed.id}`, {
   ```
   ```typescript:171:177:lib/feed-parser.ts
   static async parseFeedById(feedId: string): Promise<ParsedFeedData | null> {
     const feeds = FeedManager.getActiveFeeds();
     const feed = feeds.find(f => f.id === feedId);
     
     if (!feed) {
       throw new Error(`Feed with ID '${feedId}' not found`);
     }
   ```
   **Problem:** 
   - `addUnresolvedFeeds()` creates feeds in the **database** using Prisma
   - But `FeedParser.parseFeedById()` looks up feeds from `FeedManager.getActiveFeeds()` which reads from **`data/feeds.json`** file
   - When auto-parse is called, `FeedParser` cannot find the newly created database feed because it's not in the JSON file
   - This causes auto-parsing to **always fail silently** with "Feed with ID '...' not found"
   
   **Impact:** Feeds are discovered and added to database, but tracks are never extracted because parsing fails
   
   **Recommendation:**
   - **Option 1 (Recommended):** Remove the auto-parse call and rely on `/api/playlist/parse-feeds` batch processing which reads from database
   - **Option 2:** Modify `FeedParser.parseFeedById()` to query the database instead of reading from JSON file
   - **Option 3:** After creating feed in database, also add it to `data/feeds.json` (not recommended - creates dual source of truth)

2. **Race Condition - PARTIALLY FIXED** ✅
   ```typescript:164:184:lib/feed-discovery.ts
   // Use upsert to atomically create or update (prevents race conditions)
   const upsertResult = await prisma.feed.upsert({
     where: { id: feedGuid },
     create: { ... },
     update: { ... }
   });
   ```
   **Status:** ✅ **FIXED** - Code now uses `upsert` instead of `create`, which prevents race conditions. The check-then-create pattern has been replaced with atomic upsert operation.

3. **URL Validation - FIXED** ✅
   ```typescript:155:159:lib/feed-discovery.ts
   // Validate URL before storing
   if (!isValidFeedUrl(resolvedFeed.url)) {
     console.warn(`⚠️ Invalid feed URL for ${feedGuid}: ${resolvedFeed.url}`);
     continue;
   }
   ```
   **Status:** ✅ **FIXED** - URL validation is now implemented before creating feeds.

4. **Feed Type Determination - FIXED** ✅
   ```typescript:171:171:lib/feed-discovery.ts
   type: resolvedFeed.medium === 'music' ? 'album' : 'podcast',
   ```
   **Status:** ✅ **FIXED** - Code now correctly uses the `medium` field from Podcast Index API to determine feed type.

5. **Inconsistent Feed ID Usage**
   ```typescript:167:167:lib/feed-discovery.ts
   id: feedGuid, // Use the podcast GUID so parse-feeds can look it up
   ```
   **Problem:** The code uses `feedGuid` as the feed `id`, but elsewhere in the codebase, feed IDs are generated strings (e.g., `generateFeedId()` in `auto-discover-playlist-feeds.js`). However, the Prisma schema shows `id` is a `String` field, so GUIDs should work.

   **Status:** ⚠️ **ACCEPTABLE** - Using GUID as ID is valid per schema, but could be confusing. The database has a separate `guid` field that could be used instead.
   
   **Recommendation:**
   - Consider using `generateFeedId()` for `id` and storing GUID in the `guid` field
   - Or document that feed IDs are GUIDs for discovered feeds

---

## 2. Bugs and Issues

### 🔴 Critical Bugs

1. **CRITICAL: Auto-Parse Cannot Find Database Feeds** (BLOCKING)
   - **Location:** `lib/feed-discovery.ts:202` → `lib/feed-parser.ts:171-177`
   - **Issue:** 
     - `addUnresolvedFeeds()` creates feeds in database via Prisma
     - Auto-parse calls `/api/parse-feeds?action=parse-single&feedId=...`
     - `FeedParser.parseFeedById()` looks up feeds from `FeedManager.getActiveFeeds()` which reads `data/feeds.json`
     - Database feeds are NOT in the JSON file, so parsing always fails
   - **Impact:** Feeds are discovered and added to database, but tracks are never extracted. Auto-parsing silently fails with "Feed with ID '...' not found"
   - **Fix:** 
     - **Option 1 (Recommended):** Remove auto-parse call (line 198-217) and rely on `/api/playlist/parse-feeds` batch processing
     - **Option 2:** Modify `FeedParser.parseFeedById()` to query database via Prisma instead of reading JSON file
     - **Option 3:** After database creation, also add feed to `data/feeds.json` (creates dual source of truth - not recommended)

2. **Wrong Auto-Parse Endpoint URL** (FIXED IN CODE)
   - **Location:** `lib/feed-discovery.ts:202`
   - **Issue:** Review document mentioned wrong endpoint, but code correctly calls `/api/parse-feeds` (not `/api/playlist/parse-feeds`)
   - **Status:** ✅ Endpoint URL is correct, but the fundamental architectural issue above still prevents it from working

3. **Missing Feed URL Validation** (FIXED)
   - **Location:** `lib/feed-discovery.ts:155-159`
   - **Status:** ✅ **FIXED** - URL validation is now implemented before creating feeds

4. **Potential Database Constraint Violation**
   - **Location:** `lib/feed-discovery.ts:167`
   - **Issue:** Using `feedGuid` directly as `id` - while this works per Prisma schema, it's inconsistent with other parts of codebase that use `generateFeedId()`
   - **Impact:** Low - GUIDs are valid string IDs per schema
   - **Fix:** Consider using `generateFeedId()` for `id` and storing GUID in `guid` field for consistency

### 🟡 Medium Priority Issues

1. **No Rate Limiting on Podcast Index API**
   - **Location:** `lib/feed-discovery.ts:97-130`, `195-276`
   - **Issue:** Sequential API calls without rate limiting could hit API limits
   - **Impact:** API calls could fail with rate limit errors
   - **Fix:** Add delays between API calls or implement proper rate limiting

2. **Silent Failure in Feed Resolution**
   - **Location:** `lib/feed-discovery.ts:266-269`
   - **Issue:** When feed resolution fails, it just logs a warning and continues
   - **Impact:** No visibility into which feeds failed to resolve
   - **Fix:** Return failure information or track failed GUIDs

3. **Missing Transaction for Feed + Track Creation**
   - **Location:** `lib/feed-discovery.ts:164-217`
   - **Issue:** Feed is created, then auto-parse is called separately - if parse fails, feed remains without tracks. Additionally, the auto-parse currently fails due to architectural mismatch (see Critical Bug #1).
   - **Impact:** Database inconsistency (feeds with no tracks). Currently all feeds end up without tracks due to parsing failure.
   - **Fix:** 
     - First fix the architectural mismatch (Critical Bug #1)
     - Then consider using database transaction or ensuring parse is retried
     - Or rely on batch processing which handles this better

### 🟢 Low Priority Issues

1. **Hardcoded Base URL**
   - **Location:** `lib/feed-discovery.ts:247`
   - **Issue:** Uses `process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'` which may not work in production
   - **Fix:** Use proper URL resolution or environment-specific configuration

2. **Console.log Instead of Proper Logging**
   - **Location:** Throughout `lib/feed-discovery.ts`
   - **Issue:** Uses `console.log` instead of a proper logging system
   - **Fix:** Use a logging library or structured logging

---

## 3. Data Alignment Issues

### 🔴 Critical Data Alignment Problems

1. **Response Format Handling**
   ```typescript:116:117:lib/feed-discovery.ts
   // Handle both singular 'feed' and plural 'feeds' response formats
   const feed = data.feed || (data.feeds && data.feeds[0]);
   ```
   **Issue:** The Podcast Index API response structure is inconsistent. The code handles both formats, but there's no validation that the data structure matches expectations.

   **Recommendation:**
   - Add type guards to validate response structure
   - Log which format was received for debugging
   - Consider normalizing the response early in the function

2. **Feed Type Mismatch** (FIXED) ✅
   ```typescript:171:171:lib/feed-discovery.ts
   type: resolvedFeed.medium === 'music' ? 'album' : 'podcast',
   ```
   **Status:** ✅ **FIXED** - Code now correctly uses the `medium` field from Podcast Index API to determine feed type. No longer hardcoded to 'album'.

3. **Missing Priority Field**
   ```typescript:234:234:lib/feed-discovery.ts
   priority: 'normal',
   ```
   **Issue:** The `auto-discover-playlist-feeds.js` script sets `priority: 100` for discovered feeds, but `addUnresolvedFeeds()` uses `priority: 'normal'`. This inconsistency could affect feed processing order.

   **Recommendation:**
   - Align priority values between scripts
   - Consider using numeric priorities consistently

4. **Artist Field Handling**
   ```typescript:178:178:lib/feed-discovery.ts
   artist: finalFeed.author || finalFeed.ownerName || 'Unknown Artist',
   ```
   **Issue:** Uses `author` or `ownerName`, but the database creation uses `resolvedFeed.artist` which comes from `resolveFeedGuidWithMetadata()`. The field mapping is correct, but the fallback chain could be improved.

   **Recommendation:**
   - Ensure consistent artist field extraction
   - Document the fallback chain

### 🟡 Medium Priority Data Issues

1. **Image URL Handling**
   ```typescript:179:179:lib/feed-discovery.ts
   image: finalFeed.artwork || finalFeed.image || ''
   ```
   **Issue:** Returns empty string for missing images, but database expects `null` or a valid URL. Empty strings could cause issues in the UI.

   **Recommendation:**
   - Return `null` instead of empty string
   - Validate image URLs before storing

2. **GUID vs ID Confusion**
   - **Location:** Throughout `feed-discovery.ts`
   - **Issue:** The code uses `feedGuid` as both the Podcast Index GUID and the database feed ID. This works but is confusing and could cause issues if GUID format changes.

   **Recommendation:**
   - Use separate `guid` field in database (already exists in schema)
   - Generate proper IDs for feeds
   - Store GUID separately for lookup

---

## 4. Over-Engineering and Refactoring Opportunities

### 🔴 Over-Engineering Issues

1. **Duplicate Feed Discovery Logic**
   - **Location:** `lib/feed-discovery.ts` vs `scripts/auto-discover-playlist-feeds.js`
   - **Issue:** Two separate implementations of feed discovery:
     - `addUnresolvedFeeds()` in `feed-discovery.ts` - adds to database directly
     - `processFeedsInParallel()` in `auto-discover-playlist-feeds.js` - adds to `feeds.json` file
   - **Impact:** Code duplication, maintenance burden, potential inconsistencies
   - **Recommendation:**
     - Consolidate into a single feed discovery service
     - Have `auto-discover-playlist-feeds.js` use the same functions from `feed-discovery.ts`
     - Consider deprecating the `feeds.json` approach if database is the source of truth

2. **Unnecessary Auto-Parse Call** (CRITICAL ISSUE)
   - **Location:** `lib/feed-discovery.ts:198-217`
   - **Issue:** Attempts to auto-parse feeds immediately after creation, but `FeedParser.parseFeedById()` cannot find database feeds (reads from JSON file instead). This causes all auto-parse calls to fail.
   - **Impact:** 
     - Unnecessary HTTP call that always fails silently
     - Feeds are created but never parsed, so no tracks are extracted
     - Wasted API calls and processing time
   - **Recommendation:**
     - **Remove the auto-parse call** (lines 198-217) - it cannot work with current architecture
     - Rely on the batch processing in `/api/playlist/parse-feeds` which correctly reads from database
     - The batch processor at `/api/playlist/parse-feeds` already handles feeds with no tracks

3. **Complex Response Format Handling**
   - **Location:** `lib/feed-discovery.ts:116-117, 152-153`
   - **Issue:** Multiple places handle both `feed` and `feeds` response formats
   - **Recommendation:**
     - Create a helper function to normalize Podcast Index API responses
     - Use this helper consistently throughout

### 🟡 Refactoring Opportunities

1. **Extract API Client**
   - **Location:** `lib/feed-discovery.ts:79-95, 97-130`
   - **Issue:** Podcast Index API authentication and request logic is duplicated
   - **Recommendation:**
     - Create a `PodcastIndexClient` class
     - Centralize authentication and request logic
     - Reuse across `feed-discovery.ts`, `v4v-resolver.ts`, and other files

2. **Separate Concerns in `addUnresolvedFeeds()`**
   - **Location:** `lib/feed-discovery.ts:195-276`
   - **Issue:** Function does too much: checks existence, resolves GUID, creates feed, attempts parsing
   - **Recommendation:**
     - Split into smaller functions: `checkFeedExists()`, `resolveAndCreateFeed()`, `scheduleFeedParsing()`
     - Make each function testable independently

3. **Error Handling Strategy**
   - **Location:** Throughout `feed-discovery.ts`
   - **Issue:** Inconsistent error handling - some errors are logged and ignored, others throw
   - **Recommendation:**
     - Define clear error handling strategy
     - Use custom error types for different failure modes
     - Implement retry logic for transient failures

### 🟢 Code Organization

1. **File Size**
   - **Location:** `lib/feed-discovery.ts` (383 lines)
   - **Status:** Acceptable size, but approaching complexity threshold
   - **Recommendation:** Consider splitting if more features are added

2. **Script Organization**
   - **Location:** `scripts/check-feeds-no-tracks.js`, `scripts/debug-feed-parse.js`, `scripts/reparse-empty-feeds.ts`
   - **Status:** Good separation of concerns for utility scripts
   - **Recommendation:** Consider adding a `scripts/feed-discovery/` directory if more scripts are added

---

## 5. Code Style and Consistency

### ✅ Consistent Patterns

1. **TypeScript Usage**
   - Proper use of TypeScript interfaces and types
   - Good type safety in function signatures

2. **Async/Await**
   - Consistent use of async/await throughout
   - Proper error handling in async functions

3. **Console Logging**
   - Consistent use of emoji prefixes for log messages (🔍, ✅, ⚠️, ❌)
   - Good logging at key decision points

### ⚠️ Style Inconsistencies

1. **Mixed Quote Styles**
   - **Location:** `scripts/auto-discover-playlist-feeds.js` uses single quotes
   - **Location:** `lib/feed-discovery.ts` uses single quotes
   - **Status:** Consistent within files, but project should standardize
   - **Recommendation:** Use ESLint to enforce quote style

2. **Function Naming**
   - **Location:** `lib/feed-discovery.ts` uses camelCase (✅)
   - **Location:** `scripts/auto-discover-playlist-feeds.js` uses camelCase (✅)
   - **Status:** Consistent

3. **Error Message Format**
   - **Location:** Mixed use of template literals vs string concatenation
   - **Example:** `lib/feed-discovery.ts:120` uses template literal ✅
   - **Example:** `lib/feed-discovery.ts:268` uses string concatenation
   - **Recommendation:** Standardize on template literals

4. **Import Organization**
   - **Location:** `lib/feed-discovery.ts:1-4`
   - **Issue:** Imports are not organized (external, internal, types)
   - **Recommendation:** Organize imports: external → internal → types

---

## 6. Testing and Validation Gaps

### Missing Tests

1. **No Unit Tests for Feed Discovery**
   - **Location:** No test files found for `feed-discovery.ts`
   - **Impact:** No automated validation of core functionality
   - **Recommendation:**
     - Add unit tests for `resolveFeedGuid()`, `resolveFeedGuidWithMetadata()`, `addUnresolvedFeeds()`
     - Mock Podcast Index API responses
     - Test error handling paths

2. **No Integration Tests**
   - **Location:** No integration tests for playlist feed discovery flow
   - **Impact:** No validation of end-to-end flow
   - **Recommendation:**
     - Add integration tests for playlist routes with feed discovery
     - Test concurrent feed discovery scenarios

3. **No Validation of API Response Formats**
   - **Location:** `lib/feed-discovery.ts:114-125`
   - **Issue:** Assumes API response structure without validation
   - **Recommendation:**
     - Add response validation using Zod or similar
     - Handle unexpected response formats gracefully

---

## 7. Security Considerations

### ⚠️ Security Issues

1. **API Key Exposure Risk**
   - **Location:** `lib/feed-discovery.ts:42-77`
   - **Issue:** Reads API keys from `.env.local` file using regex parsing
   - **Impact:** If `.env.local` is accidentally committed, keys are exposed
   - **Recommendation:**
     - Use `dotenv` library instead of manual parsing
     - Ensure `.env.local` is in `.gitignore`
     - Use environment variables in production (already done ✅)

2. **No Input Sanitization**
   - **Location:** `lib/feed-discovery.ts:105, 141`
   - **Issue:** Feed GUIDs are used directly in URL construction without sanitization
   - **Impact:** Potential URL injection if GUIDs contain malicious characters
   - **Recommendation:**
     - Validate GUID format before use
     - Use `encodeURIComponent()` (already done ✅)

3. **HTTP Request Without Timeout**
   - **Location:** `lib/feed-discovery.ts:105, 141, 287, 339`
   - **Issue:** Fetch calls don't specify timeout
   - **Impact:** Requests could hang indefinitely
   - **Recommendation:**
     - Add timeout to fetch requests
     - Use `AbortController` with timeout

---

## 8. Performance Considerations

### ⚠️ Performance Issues

1. **Sequential Processing**
   - **Location:** `lib/feed-discovery.ts:198-273`
   - **Issue:** Processes feeds one at a time in a loop
   - **Impact:** Slow for large numbers of feeds
   - **Recommendation:**
     - Process feeds in parallel batches (like `auto-discover-playlist-feeds.js` does)
     - Add concurrency control to avoid overwhelming API

2. **No Caching of API Responses**
   - **Location:** `lib/feed-discovery.ts:97-130, 133-193`
   - **Issue:** Same feed GUID could be resolved multiple times
   - **Impact:** Unnecessary API calls
   - **Recommendation:**
     - Add in-memory cache for resolved feeds
     - Cache for reasonable TTL (e.g., 1 hour)

3. **Database Query in Loop**
   - **Location:** `lib/feed-discovery.ts:203-210, 217-224`
   - **Issue:** Database queries inside loop
   - **Impact:** N+1 query problem
   - **Recommendation:**
     - Batch database queries
     - Check all feeds at once, then process only new ones

---

## 9. Documentation Issues

### Missing Documentation

1. **No JSDoc Comments**
   - **Location:** All functions in `lib/feed-discovery.ts`
   - **Issue:** Functions lack documentation
   - **Recommendation:**
     - Add JSDoc comments explaining parameters, return values, and behavior
     - Document error conditions

2. **No Architecture Documentation**
   - **Location:** No docs explaining feed discovery flow
   - **Issue:** Hard to understand how components interact
   - **Recommendation:**
     - Create `docs/FEED_DISCOVERY.md` explaining:
       - How feed discovery works
       - Integration points with playlists
       - Database schema for feeds
       - API dependencies

3. **Unclear Error Messages**
   - **Location:** Various error messages throughout
   - **Issue:** Some error messages don't explain what went wrong or how to fix it
   - **Recommendation:**
     - Make error messages more descriptive
     - Include context (feed GUID, URL, etc.)

---

## 10. Recommendations Summary

### Critical (Fix Immediately)

1. 🔴 **BLOCKING:** Fix auto-parse architectural mismatch - `FeedParser.parseFeedById()` cannot find database feeds
   - **Action:** Remove auto-parse call (lines 198-217 in `feed-discovery.ts`) OR modify `FeedParser.parseFeedById()` to query database
   - **Recommended:** Remove auto-parse call and rely on `/api/playlist/parse-feeds` batch processing
2. ✅ Add proper error handling for feed creation failures
3. ⚠️ Implement transaction safety for feed + track creation (after fixing #1)
4. ✅ Add URL validation before storing feeds - **FIXED**

### High Priority (Fix Soon)

1. ✅ Consolidate duplicate feed discovery logic
2. ✅ Add rate limiting for Podcast Index API calls
3. ✅ Fix feed type determination (use `medium` field) - **FIXED** ✅
4. ✅ Add input validation and sanitization - **URL validation FIXED** ✅
5. ✅ Implement proper logging system

### Medium Priority (Fix When Possible)

1. ✅ Extract Podcast Index API client
2. ✅ Add unit and integration tests
3. ✅ Refactor `addUnresolvedFeeds()` into smaller functions
4. ✅ Add response format validation
5. ✅ Implement caching for API responses

### Low Priority (Nice to Have)

1. ✅ Add JSDoc comments
2. ✅ Create architecture documentation
3. ✅ Standardize code style (quotes, imports)
4. ✅ Add performance monitoring
5. ✅ Organize scripts into subdirectories

---

## 11. Positive Aspects

### ✅ Well-Implemented Features

1. **Good Error Handling Structure**
   - Try-catch blocks are properly placed
   - Errors are logged with context
   - Graceful degradation when feeds can't be resolved

2. **Proper API Integration**
   - Correct authentication implementation
   - Handles API response format variations
   - Good fallback mechanisms

3. **Database Integration**
   - Proper use of Prisma ORM
   - Good use of unique constraints
   - Proper relationship handling

4. **Code Organization**
   - Clear separation of concerns
   - Logical function organization
   - Good use of TypeScript types

5. **Integration with Playlists**
   - Seamless integration into playlist routes
   - Non-blocking feed discovery (errors don't break playlists)
   - Good logging for debugging

---

## Conclusion

The feed discovery feature is **partially functional** but has a **critical blocking issue** that prevents auto-parsing from working. The core feed discovery and database integration work correctly, but tracks are never extracted because the auto-parse mechanism cannot find database feeds.

### Key Findings:

1. **🔴 CRITICAL BLOCKER:** Auto-parse fails because `FeedParser.parseFeedById()` reads from `data/feeds.json` but feeds are created in the database. This means:
   - Feeds are discovered ✅
   - Feeds are added to database ✅
   - Tracks are **never extracted** ❌ (parsing always fails)

2. **✅ IMPROVEMENTS MADE:** Several issues from initial review have been fixed:
   - Race condition fixed (now uses `upsert`)
   - URL validation implemented
   - Feed type determination now uses `medium` field correctly

3. **⚠️ REMAINING ISSUES:**
   - Auto-parse architectural mismatch (blocking)
   - No rate limiting on API calls
   - Sequential processing (performance)
   - Missing tests

### Immediate Action Required:

**Remove the auto-parse call** (lines 198-217 in `lib/feed-discovery.ts`) and rely on the existing batch processing at `/api/playlist/parse-feeds` which correctly reads from the database. The batch processor already handles feeds with no tracks.

**Recommendation:** 
- **Fix the critical blocking issue immediately** - remove auto-parse call
- Address high-priority issues (rate limiting, error handling)
- Medium and low-priority items can be addressed incrementally

**Status:** ⚠️ **Not production-ready** until auto-parse issue is resolved. Once fixed, the feature will be functional for feed discovery, with tracks extracted via batch processing.

---

## 12. Detailed Code Analysis

### Critical Architectural Issue: FeedParser vs Database

**The Problem:**
```typescript
// lib/feed-discovery.ts:164-194
// Creates feed in DATABASE using Prisma
const upsertResult = await prisma.feed.upsert({ ... });

// lib/feed-discovery.ts:202
// Tries to auto-parse the feed
const parseResponse = await fetch(`${baseUrl}/api/parse-feeds?action=parse-single&feedId=${newFeed.id}`);

// app/api/parse-feeds/route.ts:111
// Calls FeedParser.parseFeedById()
const result = await FeedParser.parseFeedById(feedId);

// lib/feed-parser.ts:171-177
// Looks up feed from JSON FILE, not database!
static async parseFeedById(feedId: string): Promise<ParsedFeedData | null> {
  const feeds = FeedManager.getActiveFeeds(); // Reads from data/feeds.json
  const feed = feeds.find(f => f.id === feedId);
  if (!feed) {
    throw new Error(`Feed with ID '${feedId}' not found`); // Always fails!
  }
}
```

**Why It Fails:**
1. `addUnresolvedFeeds()` creates feed in **database** (Prisma)
2. `FeedParser.parseFeedById()` looks up feed from **JSON file** (`data/feeds.json`)
3. Database feeds are NOT in JSON file
4. Result: `FeedParser` throws "Feed with ID '...' not found" every time

**The Solution:**
The batch processor at `/api/playlist/parse-feeds` correctly reads from the database:
```typescript
// app/api/playlist/parse-feeds/route.ts:350-380
// Gets feeds from DATABASE
const unparsedFeeds = await prisma.feed.findMany({
  where: {
    status: 'active',
    Track: { none: {} } // Feeds with no tracks
  }
});
```

**Recommendation:** Remove auto-parse call and rely on batch processing which works correctly.

### Code Quality Observations

1. **Good Use of Upsert** ✅
   - Line 164: Uses `prisma.feed.upsert()` to prevent race conditions
   - Properly handles concurrent feed creation attempts

2. **Proper URL Validation** ✅
   - Line 155-159: Validates URLs before storing
   - Uses `isValidFeedUrl()` helper function

3. **Correct Feed Type Logic** ✅
   - Line 171: Uses `resolvedFeed.medium === 'music' ? 'album' : 'podcast'`
   - Correctly determines feed type from Podcast Index API

4. **Good Error Handling Structure** ✅
   - Try-catch blocks properly placed
   - Errors logged with context
   - Graceful degradation (continues on individual feed failures)

5. **Helper Functions Used Correctly** ✅
   - Uses `generatePodcastIndexHeaders()` from `podcast-index-api.ts`
   - Uses `normalizeFeedResponse()` for API response handling
   - Uses `isValidFeedUrl()` and `normalizeUrl()` from `url-utils.ts`

### Integration Points

**Correctly Integrated:**
- ✅ `app/api/playlist/flowgnar/route.ts:223` - Calls `processPlaylistFeedDiscovery()`
- ✅ `app/api/playlist/iam/route.ts:272` - Calls `processPlaylistFeedDiscovery()`
- ✅ `app/api/playlist/itdv/route.ts:269` - Calls `processPlaylistFeedDiscovery()`
- ✅ `app/api/favorites/tracks/route.ts:370` - Calls `addUnresolvedFeeds()` for album imports

**Integration Pattern:**
All playlist routes follow the same pattern:
1. Resolve tracks from database
2. Filter unresolved items
3. Call `processPlaylistFeedDiscovery()` for unresolved items
4. Continue with playlist creation (non-blocking)

This is a good pattern - feed discovery doesn't block playlist creation.

