import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Track artwork';
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';

export default async function Image({
  params,
}: {
  params: Promise<{ trackId: string }>;
}) {
  const { trackId } = await params;

  // Decode the track ID if URL-encoded
  let decodedTrackId: string;
  try {
    decodedTrackId = decodeURIComponent(trackId);
  } catch {
    decodedTrackId = trackId;
  }

  const baseUrl = process.env.NODE_ENV === 'development'
    ? 'http://localhost:3000'
    : (process.env.NEXT_PUBLIC_BASE_URL || 'https://stablekraft.app');

  let imageUrl: string | null = null;
  let title = 'Track';
  let artist = '';

  try {
    const response = await fetch(`${baseUrl}/api/music-tracks/${decodedTrackId}`, {
      cache: 'no-store',
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.data) {
        const trackImage = data.data.image || data.data.itunesImage;
        if (trackImage) {
          imageUrl = trackImage.startsWith('http')
            ? trackImage
            : `${baseUrl}${trackImage}`;
        }
        title = data.data.title || decodedTrackId;
        artist = data.data.artist || '';
      }
    }
  } catch (error) {
    console.warn('Failed to fetch track for OG image:', error);
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#1a1a1a',
          position: 'relative',
        }}
      >
        {/* Background artwork */}
        {imageUrl && (
          <img
            src={imageUrl}
            alt=""
            style={{
              position: 'absolute',
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        )}

        {/* Dark overlay for better contrast */}
        <div
          style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.3)',
          }}
        />

        {/* Play button */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 140,
            height: 140,
            borderRadius: 70,
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          }}
        >
          {/* Play triangle using SVG */}
          <svg
            width="60"
            height="60"
            viewBox="0 0 24 24"
            fill="#1a1a1a"
            style={{ marginLeft: 8 }}
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>

        {/* Title and artist overlay at bottom */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            display: 'flex',
            flexDirection: 'column',
            padding: '40px 50px',
            background: 'linear-gradient(transparent, rgba(0, 0, 0, 0.8))',
          }}
        >
          <span
            style={{
              color: 'white',
              fontSize: 42,
              fontWeight: 700,
              textShadow: '0 2px 8px rgba(0, 0, 0, 0.5)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </span>
          {artist && (
            <span
              style={{
                color: 'rgba(255, 255, 255, 0.85)',
                fontSize: 28,
                fontWeight: 500,
                marginTop: 8,
                textShadow: '0 2px 8px rgba(0, 0, 0, 0.5)',
              }}
            >
              {artist}
            </span>
          )}
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
