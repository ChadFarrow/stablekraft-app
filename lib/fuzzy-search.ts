import { prisma } from './prisma';
import { Prisma } from '@prisma/client';

export interface FuzzySearchOptions {
  query: string;
  threshold?: number;
  limit?: number;
  offset?: number;
}

export interface FuzzyTrackResult {
  id: string;
  title: string;
  artist: string | null;
  album: string | null;
  audioUrl: string | null;
  image: string | null;
  duration: number | null;
  publishedAt: Date | null;
  v4vRecipient: string | null;
  v4vValue: number | null;
  guid: string;
  feedId: string;
  feedTitle: string | null;
  feedImage: string | null;
  similarity: number;
}

export interface FuzzyAlbumResult {
  id: string;
  title: string;
  artist: string | null;
  description: string | null;
  coverArt: string | null;
  type: string | null;
  feedUrl: string | null;
  similarity: number;
  totalTracks: bigint;
}

export interface FuzzyArtistResult {
  name: string;
  image: string | null;
  feedGuid: string | null;
  similarity: number;
  albumCount: bigint;
  totalTracks: bigint;
}

/**
 * Calculate dynamic similarity threshold based on query length
 * Lower thresholds for short queries since trigram similarity
 * is naturally lower for partial word matches
 */
export function calculateThreshold(query: string): number {
  const len = query.trim().length;
  if (len <= 3) return 0.3;
  if (len <= 5) return 0.25;
  return 0.2;
}

/**
 * Fuzzy search tracks using PostgreSQL trigram similarity
 */
export async function fuzzySearchTracks(options: FuzzySearchOptions): Promise<FuzzyTrackResult[]> {
  const {
    query,
    threshold = calculateThreshold(query),
    limit = 50,
    offset = 0
  } = options;

  const results = await prisma.$queryRaw<FuzzyTrackResult[]>`
    SELECT
      t.id,
      t.title,
      t.artist,
      t.album,
      t."audioUrl",
      t.image,
      t.duration,
      t."publishedAt",
      t."v4vRecipient",
      t."v4vValue",
      t.guid,
      t."feedId",
      f.title as "feedTitle",
      f.image as "feedImage",
      GREATEST(
        COALESCE(similarity(t.title, ${query}), 0),
        COALESCE(similarity(t.artist, ${query}), 0),
        COALESCE(similarity(t.album, ${query}), 0)
      ) as similarity
    FROM "Track" t
    LEFT JOIN "Feed" f ON t."feedId" = f.id
    WHERE t."audioUrl" IS NOT NULL
      AND (
        similarity(t.title, ${query}) > ${threshold}
        OR similarity(t.artist, ${query}) > ${threshold}
        OR similarity(t.album, ${query}) > ${threshold}
      )
    ORDER BY similarity DESC, t."publishedAt" DESC NULLS LAST
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  return results;
}

/**
 * Fuzzy search albums/feeds using PostgreSQL trigram similarity
 */
export async function fuzzySearchAlbums(options: FuzzySearchOptions): Promise<FuzzyAlbumResult[]> {
  const {
    query,
    threshold = calculateThreshold(query),
    limit = 50,
    offset = 0
  } = options;

  const results = await prisma.$queryRaw<FuzzyAlbumResult[]>`
    SELECT
      f.id,
      f.title,
      f.artist,
      f.description,
      f.image as "coverArt",
      f.type,
      f."originalUrl" as "feedUrl",
      GREATEST(
        COALESCE(similarity(f.title, ${query}), 0),
        COALESCE(similarity(f.artist, ${query}), 0)
      ) as similarity,
      (SELECT COUNT(*) FROM "Track" WHERE "feedId" = f.id) as "totalTracks"
    FROM "Feed" f
    WHERE f.status = 'active'
      AND (
        similarity(f.title, ${query}) > ${threshold}
        OR similarity(f.artist, ${query}) > ${threshold}
      )
      AND NOT (f.title ILIKE '%Bowl After Bowl%' AND f.title NOT ILIKE '%Bowl Covers%')
    ORDER BY similarity DESC, f."updatedAt" DESC NULLS LAST
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  return results;
}

/**
 * Fuzzy search artists using PostgreSQL trigram similarity
 */
export async function fuzzySearchArtists(options: FuzzySearchOptions): Promise<FuzzyArtistResult[]> {
  const {
    query,
    threshold = calculateThreshold(query),
    limit = 50,
    offset = 0
  } = options;

  const results = await prisma.$queryRaw<FuzzyArtistResult[]>`
    SELECT
      f.artist as name,
      MIN(f.image) as image,
      MIN(f.id) as "feedGuid",
      MAX(similarity(f.artist, ${query})) as similarity,
      COUNT(DISTINCT f.id) as "albumCount",
      COALESCE(SUM(tc.track_count), 0) as "totalTracks"
    FROM "Feed" f
    LEFT JOIN (
      SELECT "feedId", COUNT(*) as track_count
      FROM "Track"
      GROUP BY "feedId"
    ) tc ON tc."feedId" = f.id
    WHERE f.status = 'active'
      AND f.artist IS NOT NULL
      AND similarity(f.artist, ${query}) > ${threshold}
    GROUP BY f.artist
    ORDER BY similarity DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  return results;
}
