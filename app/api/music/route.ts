/**
 * Consolidated Music API Route
 * Handles all music-related operations in a single endpoint
 */
import { NextRequest } from 'next/server';
import { MusicAPIHandler } from '@/lib/api/music-handler';

export async function GET(request: NextRequest) {
  return MusicAPIHandler.handleGet(request);
}

export async function POST(request: NextRequest) {
  return MusicAPIHandler.handlePost(request);
}

export async function DELETE(request: NextRequest) {
  return MusicAPIHandler.handleDelete(request);
}