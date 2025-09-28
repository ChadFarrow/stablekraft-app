import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';

export async function POST(request: NextRequest) {
  try {
    console.log('🚀 Starting database migration...');
    
    // Run Prisma migrate deploy
    const output = execSync('npx prisma migrate deploy', { 
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    console.log('✅ Migration completed successfully');
    console.log('Migration output:', output);
    
    return NextResponse.json({ 
      success: true, 
      message: 'Database migration completed successfully',
      output: output
    });
    
  } catch (error: any) {
    console.error('❌ Migration failed:', error);
    
    return NextResponse.json({ 
      success: false, 
      error: error.message,
      output: error.stdout || error.stderr || 'No output available'
    }, { status: 500 });
  }
}
