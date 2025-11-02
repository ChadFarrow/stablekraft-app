# Debugging Guide for Recurring Issues

## Common Issues and Solutions

### 1. Publisher Feeds Missing Items
**Root Cause**: Publisher items have empty titles, causing them to be filtered out
**Fix**: Improved feedGuid matching in fetchPublisherAlbums function
**Prevention**: Add validation in RSS parser to ensure publisher items have meaningful data

### 2. Infinite Recursion Errors
**Root Cause**: useEffect dependencies creating circular calls
**Fix**: Remove problematic useEffects with changing dependencies
**Prevention**: Use useCallback with stable dependencies, avoid state in useEffect deps

### 3. Image Loading Issues
**Root Cause**: CDN image optimization and fallback logic
**Fix**: Simplified timeout handling, removed circular useEffect
**Prevention**: Use simpler image loading patterns, avoid complex retry logic

## Development Workflow Improvements

### 1. Testing in Production Environment
```bash
# Always test fixes in production-like environment
npm run build
npm start

# Check console for errors
# Test specific URLs that were broken
```

### 2. Clear All Caches When Testing
```bash
# Clear service worker cache
npm run clear-sw-cache

# Hard refresh browser (Cmd+Shift+R)
# Check in incognito mode
```

### 3. Validate Data Consistency
```bash
# Check that APIs return expected data
curl -s "https://re.podtards.com/api/parsed-feeds" | jq '.feeds | length'
curl -s "https://re.podtards.com/api/albums" | jq '.albums | length'
```

### 4. Monitor Build Output
- Check build warnings for missing dependencies
- Verify static generation is working for dynamic routes
- Ensure all API routes are functional

## Preventive Measures

### 1. Add Data Validation
- Validate publisher items have required fields
- Add fallbacks for empty/missing data
- Log warnings for data inconsistencies

### 2. Simplify Complex Logic
- Reduce dependencies between components
- Use simpler state management patterns
- Avoid deep nesting in useEffect dependencies

### 3. Add Health Checks
- Create admin endpoint to validate data integrity
- Add monitoring for common error patterns
- Set up alerts for production issues

### 4. Improve Deployment Process
- Add automated testing before deployment
- Verify API endpoints after deployment
- Check for console errors in production

## Quick Fixes Checklist

When an issue recurs:

1. [ ] Clear all caches (browser, SW, CDN)
2. [ ] Check console for new errors
3. [ ] Verify API endpoints return expected data
4. [ ] Test in incognito mode
5. [ ] Check build output for warnings
6. [ ] Validate the fix addresses root cause, not symptoms