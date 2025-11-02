import json

def extract_all_publishers():
    with open('data/parsed-feeds.json', 'r') as f:
        data = json.load(f)
    
    publishers = {}
    
    # Extract all publisher entries from feeds
    for feed in data.get('feeds', []):
        if feed.get('type') == 'publisher':
            original_url = feed.get('originalUrl', '')
            
            # Extract feedGuid from URL
            feed_guid = None
            if 'wavlake.com/feed/artist/' in original_url:
                feed_guid = original_url.split('/')[-1]
            elif 'zine.bitpunk.fm/feeds/publisher.xml' in original_url:
                feed_guid = "5883e6be-4e0c-11f0-9524-00155dc57d8e"
            elif 're.podtards.com' in original_url:
                # This appears to be the Doerfels publisher
                feed_guid = "doerfels-publisher-special"
            
            publisher_info = feed.get('parsedData', {}).get('publisherInfo', {})
            
            publishers[feed_guid] = {
                'feedGuid': feed_guid,
                'feedUrl': original_url,
                'title': feed.get('title', ''),
                'id': feed.get('id', ''),
                'publisherName': publisher_info.get('title', ''),
                'artist': publisher_info.get('artist', ''),
                'description': publisher_info.get('description', ''),
                'status': feed.get('status', ''),
                'priority': feed.get('priority', '')
            }
    
    # Find publishers referenced in other feeds that may not have direct entries
    unique_feed_guids = set()
    for feed in data.get('feeds', []):
        parsed_data = feed.get('parsedData', {})
        
        # Check album publisher references
        if 'album' in parsed_data:
            publisher_info = parsed_data['album'].get('publisher', {})
            if publisher_info.get('medium') == 'publisher':
                guid = publisher_info.get('feedGuid')
                url = publisher_info.get('feedUrl', '')
                unique_feed_guids.add((guid, url))
    
    # Add any missing publishers from references
    for guid, url in unique_feed_guids:
        if guid and guid not in publishers:
            # Try to infer name from URL or context
            name = "Unknown Publisher"
            if 'wavlake.com' in url:
                name = f"Wavlake Artist ({guid[:8]}...)"
            
            publishers[guid] = {
                'feedGuid': guid,
                'feedUrl': url,
                'title': name,
                'id': f"publisher-{guid}",
                'publisherName': '',
                'artist': '',
                'description': '',
                'status': 'referenced',
                'priority': 'unknown'
            }
    
    return publishers

def create_human_readable_mappings(publishers):
    """Create URL mappings for publishers"""
    mappings = {}
    
    for guid, info in publishers.items():
        if not guid or guid == 'None':
            continue
            
        # Create human-readable name
        display_name = info['publisherName'] or info['title'] or info['artist']
        
        if not display_name or display_name == "Unknown Publisher":
            # Try to create name from URL
            url = info['feedUrl']
            if 'wavlake.com/feed/artist/' in url:
                display_name = f"Wavlake Artist {guid[:8]}"
            elif 'bitpunk.fm' in url:
                display_name = "BitPunk.fm"
            elif 'doerfel' in url.lower():
                display_name = "The Doerfels"
            else:
                display_name = f"Publisher {guid[:8]}"
        
        # Create URL-safe version
        url_safe = display_name.lower().replace(' ', '-').replace('(', '').replace(')', '').replace('.', '')
        
        mappings[guid] = {
            'guid': guid,
            'displayName': display_name,
            'urlSlug': url_safe,
            'feedUrl': info['feedUrl'],
            'status': info['status']
        }
    
    return mappings

if __name__ == '__main__':
    publishers = extract_all_publishers()
    mappings = create_human_readable_mappings(publishers)
    
    print("=== ALL UNIQUE PUBLISHERS ===\n")
    
    for guid, info in sorted(publishers.items(), key=lambda x: x[1]['title'] if x[1]['title'] else ''):
        if not guid or guid == 'None':
            continue
            
        print(f"Feed GUID: {guid}")
        print(f"Feed URL: {info['feedUrl']}")
        print(f"Title: {info['title']}")
        print(f"Publisher Name: {info['publisherName']}")
        print(f"Artist: {info['artist']}")
        print(f"Description: {info['description']}")
        print(f"Status: {info['status']}")
        print(f"Priority: {info['priority']}")
        print("-" * 60)
    
    valid_publishers = [g for g in publishers.keys() if g and g != 'None']
    print(f"\nTotal unique publishers: {len(valid_publishers)}")
    
    print("\n=== HUMAN-READABLE URL MAPPINGS ===\n")
    
    for guid, mapping in sorted(mappings.items(), key=lambda x: x[1]['displayName']):
        print(f"GUID: {guid}")
        print(f"Display Name: {mapping['displayName']}")
        print(f"URL Slug: {mapping['urlSlug']}")
        print(f"Feed URL: {mapping['feedUrl']}")
        print(f"Status: {mapping['status']}")
        print("-" * 40)

