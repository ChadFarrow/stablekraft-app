import { NextResponse } from 'next/server';

export async function POST() {
  // Prisma doesn't have a file-based cache to clear
  // This endpoint is kept for backward compatibility but does nothing
  return NextResponse.json({ 
    success: true, 
    message: 'Cache clear not needed - using Prisma database' 
  });
} 