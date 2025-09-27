#!/bin/bash

# Continuous batch processing for artwork colors
# This script will automatically process all remaining artwork images

API_URL="http://localhost:3000/api/artwork-colors/batch-process"
BATCH_SIZE=20
DELAY_BETWEEN_BATCHES=3

echo "🎨 Starting continuous artwork color batch processing..."
echo "📊 Batch size: $BATCH_SIZE images per batch"
echo "⏱️  Delay between batches: $DELAY_BETWEEN_BATCHES seconds"
echo "🔄 Press Ctrl+C to stop processing"
echo ""

# Function to get current status
get_status() {
    curl -s "$API_URL"
}

# Function to process a batch
process_batch() {
    echo "🔄 Processing batch..."
    result=$(curl -s -X POST "$API_URL" \
        -H "Content-Type: application/json" \
        -d "{\"batchSize\": $BATCH_SIZE}")
    echo "$result"
}

# Main processing loop
batch_count=0

while true; do
    # Get current status
    status_response=$(get_status)

    if [[ $? -eq 0 ]]; then
        # Extract values
        total=$(echo "$status_response" | grep -o '"totalArtwork":[0-9]*' | cut -d':' -f2)
        processed=$(echo "$status_response" | grep -o '"processed":[0-9]*' | cut -d':' -f2)
        remaining=$(echo "$status_response" | grep -o '"remaining":[0-9]*' | cut -d':' -f2)
        percentage=$(echo "$status_response" | grep -o '"percentage":[0-9]*' | cut -d':' -f2)

        echo "📊 Current Status: $processed/$total ($percentage%) - $remaining remaining"

        # Check if complete
        if [[ "$remaining" == "0" ]]; then
            echo ""
            echo "🎉 All artwork colors have been processed!"
            echo "📈 Total batches processed: $batch_count"
            break
        fi

        # Process next batch
        batch_count=$((batch_count + 1))
        echo "🚀 Starting batch #$batch_count..."

        batch_result=$(process_batch)

        # Parse batch results
        batch_processed=$(echo "$batch_result" | grep -o '"processed":[0-9]*' | cut -d':' -f2)
        batch_failed=$(echo "$batch_result" | grep -o '"failed":[0-9]*' | cut -d':' -f2)
        batch_remaining=$(echo "$batch_result" | grep -o '"remaining":[0-9]*' | cut -d':' -f2)

        echo "✅ Batch #$batch_count complete: $batch_processed processed, $batch_failed failed"
        echo "📊 $batch_remaining images remaining"
        echo ""

        # Wait before next batch
        if [[ "$batch_remaining" != "0" ]]; then
            echo "⏳ Waiting $DELAY_BETWEEN_BATCHES seconds before next batch..."
            sleep $DELAY_BETWEEN_BATCHES
            echo ""
        fi
    else
        echo "❌ Failed to get status, retrying in 5 seconds..."
        sleep 5
    fi
done

echo "✨ Continuous processing complete!"