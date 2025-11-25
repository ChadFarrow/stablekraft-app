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

# Function to extract JSON value without jq
get_json_value() {
  local json="$1"
  local key="$2"
  echo "$json" | grep -o "\"$key\":[0-9]*" | grep -o '[0-9]*' | head -1
}

get_json_string() {
  local json="$1"
  local key="$2"
  echo "$json" | grep -o "\"$key\":\"[^\"]*\"" | sed "s/\"$key\":\"//;s/\"$//" | head -1
}

get_json_bool() {
  local json="$1"
  local key="$2"
  echo "$json" | grep -o "\"$key\":[a-z]*" | sed "s/\"$key\"://" | head -1
}

echo "🎨 Artwork Color Batch Processor"
echo "================================"
echo "Base URL: $BASE_URL"
echo "Batch Size: $BATCH_SIZE"
echo "Delay between images: ${DELAY_MS}ms"
echo ""

# Get initial statistics
echo "📊 Checking current status..."
STATS=$(curl -s "$BASE_URL/api/artwork-colors/batch-process")
TOTAL=$(get_json_value "$STATS" "totalArtwork")
PROCESSED=$(get_json_value "$STATS" "processed")
REMAINING=$(get_json_value "$STATS" "remaining")

# Default to 0 if empty
TOTAL=${TOTAL:-0}
PROCESSED=${PROCESSED:-0}
REMAINING=${REMAINING:-0}

echo "Total artwork: $TOTAL"
echo "Already processed: $PROCESSED"
echo "Remaining: $REMAINING"
echo ""

if [ "$REMAINING" -eq 0 ] 2>/dev/null; then
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

  SUCCESS=$(get_json_bool "$RESULT" "success")
  BATCH_PROCESSED=$(get_json_value "$RESULT" "processed")
  BATCH_FAILED=$(get_json_value "$RESULT" "failed")
  REMAINING=$(get_json_value "$RESULT" "remaining")

  # Default to 0 if empty
  BATCH_PROCESSED=${BATCH_PROCESSED:-0}
  BATCH_FAILED=${BATCH_FAILED:-0}
  REMAINING=${REMAINING:-0}

  if [ "$SUCCESS" != "true" ]; then
    ERROR=$(get_json_string "$RESULT" "error")
    echo "❌ Batch failed! Error: ${ERROR:-Unknown}"
    echo "Response: $RESULT"
    exit 1
  fi

  echo "   ✅ Processed: $BATCH_PROCESSED, Failed: $BATCH_FAILED, Remaining: $REMAINING"

  if [ "$REMAINING" -eq 0 ] 2>/dev/null; then
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
FINAL=$(curl -s "$BASE_URL/api/artwork-colors/batch-process")
echo "Total: $(get_json_value "$FINAL" "totalArtwork")"
echo "Processed: $(get_json_value "$FINAL" "processed")"
echo "Remaining: $(get_json_value "$FINAL" "remaining")"
echo "Percentage: $(get_json_value "$FINAL" "percentage")%"
