import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// GET /api/genres - Get list of unique genres with counts
export async function GET() {
  try {
    // Get all feeds with podcastCategories
    const feedsWithCategories = await prisma.feed.findMany({
      where: {
        status: 'active',
        podcastCategories: { isEmpty: false }
      },
      select: {
        podcastCategories: true
      }
    });

    // Count occurrences of each genre
    const genreCounts = new Map<string, number>();

    for (const feed of feedsWithCategories) {
      for (const genre of feed.podcastCategories) {
        if (genre && genre.trim()) {
          const normalizedGenre = genre.trim();
          genreCounts.set(normalizedGenre, (genreCounts.get(normalizedGenre) || 0) + 1);
        }
      }
    }

    // Convert to array and sort by count (descending)
    const genres = Array.from(genreCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      genres,
      total: genres.length
    });

  } catch (error) {
    console.error('Error fetching genres:', error);
    return NextResponse.json(
      { error: 'Failed to fetch genres' },
      { status: 500 }
    );
  }
}
