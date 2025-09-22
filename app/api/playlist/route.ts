/**
 * Consolidated Playlist API Route
 * Handles all playlist-related operations in a single endpoint
 */
import { NextRequest } from 'next/server';
import { PlaylistAPIHandler } from '@/lib/api/playlist-handler';

export async function GET(request: NextRequest) {
  return PlaylistAPIHandler.handleGet(request);
}

export async function POST(request: NextRequest) {
  return PlaylistAPIHandler.handlePost(request);
}