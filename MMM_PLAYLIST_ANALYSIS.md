# MMM Playlist Track Coverage Analysis

## Summary

**Date:** $(date)

### Key Findings

- **MMM Playlist Items:** 1,606 tracks
- **Tracks in Database:** 1,275 tracks  
- **MMM Items Matched:** 98 tracks (6.1% coverage)
- **MMM Items Missing:** 1,508 tracks (93.9% missing)

## The Problem

The MMM (Mutton, Mead & Music) playlist references **1,606 tracks**, but only **98 of them** (6.1%) are currently in the database. This means:

1. **1,508 tracks** (94% of the playlist) are missing from the database
2. The 1,275 tracks currently in the database are mostly from other sources (not the MMM playlist)
3. When users view the MMM playlist, they're only seeing a small fraction of the tracks

## Top Albums with Matched Tracks

The following albums have the most tracks that match the MMM playlist:

1. **Music From The Doerfel-Verse** (The Doerfels) - 15 matched tracks
2. **The Heycitizen Experience** (HeyCitizen) - 14 matched tracks
3. **Spectral Hiding** (Bitpunk.fm) - 6 matched tracks
4. **HeyCitizen's Lo-Fi Hip-Hop Beats** (HeyCitizen) - 3 matched tracks
5. **Aged Friends & Old Whiskey** (Delta OG) - 3 matched tracks
6. **Kurtisdrums** (Kurtisdrums) - 3 matched tracks
7. Several albums with 2 matched tracks each

## What This Means

The MMM playlist is a curated collection of tracks from various independent artists, but most of these tracks haven't been:
- Parsed from their source RSS feeds
- Resolved by GUID matching
- Added to the database

## Recommendations

1. **Run track resolution jobs** to match MMM playlist GUIDs to their source feeds
2. **Parse missing feeds** that contain tracks referenced in the MMM playlist
3. **Use the resolve-mmm-tracks API** (`/api/playlist/resolve-mmm-tracks`) to bulk resolve missing tracks
4. **Monitor coverage** - track how many MMM playlist items get resolved over time

## Next Steps

To resolve missing tracks:
1. Extract all `feedGuid` values from the MMM playlist XML
2. Ensure those feeds are in the database (Feed table)
3. Parse those feeds to extract tracks
4. Match tracks by `itemGuid` to populate the database

The MMM playlist XML is located at:
`https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMM-music-playlist.xml`

