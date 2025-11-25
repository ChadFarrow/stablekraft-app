#!/bin/bash
# Process artwork colors in small batches with delays
# Usage: ./scripts/batch-colors.sh [BASE_URL] [BATCH_SIZE] [DELAY_MS]
#
# Examples:
#   ./scripts/batch-colors.sh                           # Uses defaults
#   ./scripts/batch-colors.sh http://localhost:3001     # Custom URL
#   ./scripts/batch-colors.sh http://localhost:3001 5 1000  # Custom batch size and delay

BASE_URL="${1:-http://localhost:3001}"
BATCH_SIZE="${2:-5}"
DELAY_MS="${3:-1000}"

echo "🎨 Artwork Color Batch Processor"
echo "================================"
echo "Base URL: $BASE_URL"
echo "Batch Size: $BATCH_SIZE"
echo "Delay between images: ${DELAY_MS}ms"
echo ""

# Get initial statistics
echo "📊 Checking current status..."
STATS=$(curl -s "$BASE_URL/api/artwork-colors/batch-process")
TOTAL=$(echo $STATS | jq -r '.statistics.totalArtwork // 0')
PROCESSED=$(echo $STATS | jq -r '.statistics.processed // 0')
REMAINING=$(echo $STATS | jq -r '.statistics.remaining // 0')

echo "Total artwork: $TOTAL"
echo "Already processed: $PROCESSED"
echo "Remaining: $REMAINING"
echo ""

if [ "$REMAINING" -eq 0 ]; then
  echo "✅ All artwork colors already processed!"
  exit 0
fi

echo "🚀 Starting batch processing..."
echo ""

BATCH_NUM=0
while true; do
  BATCH_NUM=$((BATCH_NUM + 1))

  echo "📦 Batch $BATCH_NUM: Processing up to $BATCH_SIZE images..."

  RESULT=$(curl -s -X POST "$BASE_URL/api/artwork-colors/batch-process" \
    -H "Content-Type: application/json" \
    -d "{\"batchSize\": $BATCH_SIZE, \"delayMs\": $DELAY_MS}")

  SUCCESS=$(echo $RESULT | jq -r '.success // false')
  BATCH_PROCESSED=$(echo $RESULT | jq -r '.results.processed // 0')
  BATCH_FAILED=$(echo $RESULT | jq -r '.results.failed // 0')
  REMAINING=$(echo $RESULT | jq -r '.remaining // 0')

  if [ "$SUCCESS" != "true" ]; then
    echo "❌ Batch failed! Error: $(echo $RESULT | jq -r '.error // "Unknown"')"
    exit 1
  fi

  echo "   ✅ Processed: $BATCH_PROCESSED, Failed: $BATCH_FAILED, Remaining: $REMAINING"

  if [ "$REMAINING" -eq 0 ]; then
    echo ""
    echo "🎉 All done! All artwork colors have been processed."
    break
  fi

  # Pause between batches
  echo "   ⏳ Pausing 2 seconds before next batch..."
  sleep 2
done

echo ""
echo "📊 Final statistics:"
curl -s "$BASE_URL/api/artwork-colors/batch-process" | jq '.statistics'
