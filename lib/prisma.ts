import { PrismaClient } from '@prisma/client'

const globalForPrisma = global as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: {
      url: process.env.DATABASE_URL || '',
    },
    log: ['error'], // Only log errors to reduce console spam
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma