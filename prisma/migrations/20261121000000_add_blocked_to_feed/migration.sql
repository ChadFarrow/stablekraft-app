-- <podcast:block>: the feed keeps StableKraft from showing it. Written by every parse.
-- NOT NULL with a constant default: Postgres 11+ adds it without rewriting the table,
-- and every existing row reads false (not blocked) until its next parse. The code
-- deployed before this migration never selects it, so run this FIRST, then deploy.

-- AlterTable
ALTER TABLE "Feed" ADD COLUMN "blocked" BOOLEAN NOT NULL DEFAULT false;
