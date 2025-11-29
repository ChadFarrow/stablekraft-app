import { PrismaClient } from '@prisma/client'

const globalForPrisma = global as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error'], // Only log errors to reduce console spam
  })

// Cache the client globally to prevent connection pool exhaustion in serverless
// This is especially important in production where each request could create a new client
globalForPrisma.prisma = prisma