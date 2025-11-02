import json
import sys

def extract_publishers():
    with open('data/parsed-feeds.json', 'r') as f:
        data = json.load(f)
    
    publishers = {}
    
    # Extract publisher entries from the feeds list
    for feed in data.get('feeds', []):
        if feed.get('type') == 'publisher':
            feed_guid = None
            feed_url = feed.get('originalUrl', '')
            
            # Extract feed GUID from URL if it's a Wavlake artist feed
            if 'wavlake.com/feed/artist/' in feed_url:
                feed_guid = feed_url.split('/')[-1]
            elif 'zine.bitpunk.fm/feeds/publisher.xml' in feed_url:
                feed_guid = "5883e6be-4e0c-11f0-9524-00155dc57d8e"
            
            publishers[feed_guid] = {
                'feedGuid': feed_guid,
                'feedUrl': feed_url,
                'title': feed.get('title', ''),
                'id': feed.get('id', ''),
                'parsedData': feed.get('parsedData', {})
            }
    
    # Look for publisher references in other feeds to find missing names
    publisher_references = {}
    
    for feed in data.get('feeds', []):
        parsed_data = feed.get('parsedData', {})
        
        # Check for publisher in album data
        if 'album' in parsed_data:
            publisher_info = parsed_data['album'].get('publisher', {})
            if publisher_info.get('medium') == 'publisher':
                guid = publisher_info.get('feedGuid')
                if guid and guid not in publishers:
                    # Try to extract name from the album's artist field
                    artist_name = parsed_data['album'].get('artist', '')
                    publishers[guid] = {
                        'feedGuid': guid,
                        'feedUrl': publisher_info.get('feedUrl', ''),
                        'title': f"Unknown Publisher ({artist_name})" if artist_name else "Unknown Publisher",
                        'id': f"publisher-{guid}",
                        'parsedData': {}
                    }
                    publisher_references[guid] = {
                        'referenced_in': feed.get('title', ''),
                        'artist_context': artist_name
                    }
    
    return publishers, publisher_references

if __name__ == '__main__':
    publishers, references = extract_publishers()
    
    print("=== UNIQUE PUBLISHER ENTRIES ===\n")
    
    for guid, info in sorted(publishers.items(), key=lambda x: x[1]['title']):
        if guid:  # Skip None keys
            print(f"Feed GUID: {guid}")
            print(f"Feed URL: {info['feedUrl']}")
            print(f"Title: {info['title']}")
            print(f"ID: {info['id']}")
            
            # Try to get publisher name from parsed data
            publisher_info = info['parsedData'].get('publisherInfo', {})
            if publisher_info:
                print(f"Publisher Name: {publisher_info.get('title', 'N/A')}")
                print(f"Artist: {publisher_info.get('artist', 'N/A')}")
                print(f"Description: {publisher_info.get('description', 'N/A')}")
            
            if guid in references:
                print(f"Referenced in: {references[guid]['referenced_in']}")
                print(f"Artist context: {references[guid]['artist_context']}")
            
            print("-" * 60)
    
    print(f"\nTotal unique publishers found: {len([g for g in publishers.keys() if g])}")

