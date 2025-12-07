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

  // Add connection pooling params
  const separator = url.includes('?') ? '&' : '?'
  // Use higher connection limit for dev, lower for production serverless
  const connectionLimit = process.env.NODE_ENV === 'development' ? 5 : 3
  const poolTimeout = 30 // Allow more time for busy connections
  return `${url}${separator}connection_limit=${connectionLimit}&pool_timeout=${poolTimeout}`
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