# Bloodshot Lies Background Image Setup

To complete the background image setup, you need to add the Bloodshot Lies album art to the public directory.

## Steps:

1. **Add the image file** to `/public/bloodshot-lies-bg.jpg`
   - The image should be the Bloodshot Lies album art you want to use
   - Recommended size: 1920x1080 or larger for good quality
   - Format: JPG or PNG

2. **Image description** (for reference):
   - Stylized human head in profile with glowing neural pathways
   - Red, magenta, and purple color palette with bright white/yellow lines
   - "DV" in top left, "Bloodshot Lies" in middle right, "THE DOERFELS" at bottom left

## Current Implementation:

- Background image is set to 15% opacity for subtle effect
- Content has a semi-transparent white overlay with blur for readability
- Background is fixed and covers the entire viewport
- Fallback CSS classes are available in globals.css

## To adjust the background:

- **Opacity**: Change `opacity: 0.15` in layout.tsx
- **Blur**: Modify `backdrop-filter: blur(10px)` in globals.css
- **Overlay color**: Adjust `rgba(255, 255, 255, 0.95)` in globals.css

The background will automatically work once you add the image file to `/public/bloodshot-lies-bg.jpg` 