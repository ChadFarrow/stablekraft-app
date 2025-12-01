#!/bin/bash
for i in {1..100}; do
  result=$(curl -s -X POST "http://localhost:3001/api/artwork-colors/batch-process" -H "Content-Type: application/json" -d '{"batchSize": 50, "delayMs": 150}')
  remaining=$(echo "$result" | grep -o '"remaining":[0-9]*' | cut -d: -f2)
  processed=$(echo "$result" | grep -o '"processed":[0-9]*' | cut -d: -f2)
  echo "Batch $i: processed $processed, remaining: $remaining"
  if [ "$remaining" = "0" ]; then
    echo "All artwork colors processed!"
    break
  fi
  sleep 1
done
echo "Done!"
