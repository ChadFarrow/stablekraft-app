#!/bin/bash
# Convert large GIFs to MP4 and WebM for better performance
# Requires: ffmpeg installed on system

INPUT_DIR="data/optimized-images"
OUTPUT_DIR="data/optimized-images"

# Array of GIF files to convert
GIFS=("you-are-my-world.gif" "HowBoutYou.gif" "autumn.gif" "alandace.gif")

echo "Starting GIF to video conversion..."
echo "Input directory: $INPUT_DIR"
echo "Output directory: $OUTPUT_DIR"
echo ""

for gif in "${GIFS[@]}"; do
  base="${gif%.gif}"
  input="$INPUT_DIR/$gif"

  if [ -f "$input" ]; then
    echo "Converting $gif..."
    echo "  Input size: $(du -h "$input" | cut -f1)"

    # MP4 (H.264) - Best Safari/iOS compatibility
    # -movflags faststart: Move metadata to beginning for faster web playback
    # -pix_fmt yuv420p: Ensure compatibility with all players
    # -vf scale: Ensure dimensions are divisible by 2 (required for H.264)
    # -crf 23: Quality level (lower = better quality, larger file)
    ffmpeg -y -i "$input" \
      -movflags faststart \
      -pix_fmt yuv420p \
      -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" \
      -c:v libx264 \
      -crf 23 \
      -preset medium \
      "$OUTPUT_DIR/$base.mp4" 2>/dev/null

    if [ -f "$OUTPUT_DIR/$base.mp4" ]; then
      echo "  Created $base.mp4 ($(du -h "$OUTPUT_DIR/$base.mp4" | cut -f1))"
    else
      echo "  ERROR: Failed to create $base.mp4"
    fi

    # WebM (VP9) - Best compression, Chrome/Firefox
    # -c:v libvpx-vp9: VP9 codec for WebM
    # -crf 30: Quality level for VP9
    # -b:v 0: Variable bitrate mode
    ffmpeg -y -i "$input" \
      -c:v libvpx-vp9 \
      -crf 30 \
      -b:v 0 \
      -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" \
      "$OUTPUT_DIR/$base.webm" 2>/dev/null

    if [ -f "$OUTPUT_DIR/$base.webm" ]; then
      echo "  Created $base.webm ($(du -h "$OUTPUT_DIR/$base.webm" | cut -f1))"
    else
      echo "  ERROR: Failed to create $base.webm"
    fi

    echo ""
  else
    echo "WARNING: $input not found, skipping..."
    echo ""
  fi
done

echo "Conversion complete!"
echo ""
echo "Summary:"
echo "--------"
for gif in "${GIFS[@]}"; do
  base="${gif%.gif}"
  if [ -f "$INPUT_DIR/$gif" ]; then
    gif_size=$(du -h "$INPUT_DIR/$gif" | cut -f1)
    mp4_size="N/A"
    webm_size="N/A"
    if [ -f "$OUTPUT_DIR/$base.mp4" ]; then
      mp4_size=$(du -h "$OUTPUT_DIR/$base.mp4" | cut -f1)
    fi
    if [ -f "$OUTPUT_DIR/$base.webm" ]; then
      webm_size=$(du -h "$OUTPUT_DIR/$base.webm" | cut -f1)
    fi
    echo "$gif: $gif_size -> MP4: $mp4_size, WebM: $webm_size"
  fi
done
