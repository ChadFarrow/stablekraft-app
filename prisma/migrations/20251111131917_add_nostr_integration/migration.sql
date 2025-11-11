-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "nostrPubkey" TEXT NOT NULL,
    "nostrNpub" TEXT NOT NULL,
    "displayName" TEXT,
    "avatar" TEXT,
    "bio" TEXT,
    "lightningAddress" TEXT,
    "relays" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Follow" (
    "id" TEXT NOT NULL,
    "followerId" TEXT NOT NULL,
    "followingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NostrPost" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "kind" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "trackId" TEXT,
    "feedId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NostrPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoostEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "message" TEXT,
    "paymentHash" TEXT,
    "relayUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoostEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_nostrPubkey_key" ON "User"("nostrPubkey");

-- CreateIndex
CREATE UNIQUE INDEX "User_nostrNpub_key" ON "User"("nostrNpub");

-- CreateIndex
CREATE INDEX "User_nostrPubkey_idx" ON "User"("nostrPubkey");

-- CreateIndex
CREATE INDEX "User_nostrNpub_idx" ON "User"("nostrNpub");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Follow_followerId_followingId_key" ON "Follow"("followerId", "followingId");

-- CreateIndex
CREATE INDEX "Follow_followerId_idx" ON "Follow"("followerId");

-- CreateIndex
CREATE INDEX "Follow_followingId_idx" ON "Follow"("followingId");

-- CreateIndex
CREATE INDEX "Follow_followerId_createdAt_idx" ON "Follow"("followerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NostrPost_eventId_key" ON "NostrPost"("eventId");

-- CreateIndex
CREATE INDEX "NostrPost_userId_idx" ON "NostrPost"("userId");

-- CreateIndex
CREATE INDEX "NostrPost_eventId_idx" ON "NostrPost"("eventId");

-- CreateIndex
CREATE INDEX "NostrPost_kind_idx" ON "NostrPost"("kind");

-- CreateIndex
CREATE INDEX "NostrPost_trackId_idx" ON "NostrPost"("trackId");

-- CreateIndex
CREATE INDEX "NostrPost_feedId_idx" ON "NostrPost"("feedId");

-- CreateIndex
CREATE INDEX "NostrPost_userId_createdAt_idx" ON "NostrPost"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BoostEvent_eventId_key" ON "BoostEvent"("eventId");

-- CreateIndex
CREATE INDEX "BoostEvent_userId_idx" ON "BoostEvent"("userId");

-- CreateIndex
CREATE INDEX "BoostEvent_trackId_idx" ON "BoostEvent"("trackId");

-- CreateIndex
CREATE INDEX "BoostEvent_eventId_idx" ON "BoostEvent"("eventId");

-- CreateIndex
CREATE INDEX "BoostEvent_userId_createdAt_idx" ON "BoostEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "BoostEvent_trackId_createdAt_idx" ON "BoostEvent"("trackId", "createdAt");

-- AlterTable
ALTER TABLE "FavoriteTrack" ADD COLUMN "userId" TEXT,
ALTER COLUMN "sessionId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "FavoriteAlbum" ADD COLUMN "userId" TEXT,
ALTER COLUMN "sessionId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "FavoriteTrack_userId_trackId_key" ON "FavoriteTrack"("userId", "trackId");

-- CreateIndex
CREATE INDEX "FavoriteTrack_userId_idx" ON "FavoriteTrack"("userId");

-- CreateIndex
CREATE INDEX "FavoriteTrack_userId_createdAt_idx" ON "FavoriteTrack"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FavoriteAlbum_userId_feedId_key" ON "FavoriteAlbum"("userId", "feedId");

-- CreateIndex
CREATE INDEX "FavoriteAlbum_userId_idx" ON "FavoriteAlbum"("userId");

-- CreateIndex
CREATE INDEX "FavoriteAlbum_userId_createdAt_idx" ON "FavoriteAlbum"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NostrPost" ADD CONSTRAINT "NostrPost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoostEvent" ADD CONSTRAINT "BoostEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoriteTrack" ADD CONSTRAINT "FavoriteTrack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoriteAlbum" ADD CONSTRAINT "FavoriteAlbum_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

