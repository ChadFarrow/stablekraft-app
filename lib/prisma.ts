import { PrismaClient } from '@prisma/client'

const globalForPrisma = global as unknown as {
  prisma: PrismaClient | undefined
}

// Get database URL and add connection pool parameters for serverless
function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL || ''

  // If already has connection params, use as-is
  if (url.includes('connection_limit') || url.includes('pool_timeout')) {
    return url
  }

  // Add serverless-optimized connection pooling params
  const separator = url.includes('?') ? '&' : '?'
  // connection_limit=1 per serverless instance, pool_timeout short to fail fast
  return `${url}${separator}connection_limit=1&pool_timeout=10`
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error'],
    datasources: {
      db: {
        url: getDatabaseUrl()
      }
    }
  })

// Cache the client globally to prevent connection pool exhaustion in serverless
globalForPrisma.prisma = prisma