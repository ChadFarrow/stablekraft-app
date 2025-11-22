import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    version: '1.0.1-v4v-fix',
    commit: process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown',
    deployedAt: new Date().toISOString(),
    hasV4VFix: true,
  });
}
