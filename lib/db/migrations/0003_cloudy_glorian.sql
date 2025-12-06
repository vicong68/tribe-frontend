ALTER TABLE "Chat" ADD COLUMN IF NOT EXISTS "visibility" varchar DEFAULT 'private';
UPDATE "Chat" SET "visibility" = 'private' WHERE "visibility" IS NULL;
ALTER TABLE "Chat" ALTER COLUMN "visibility" SET DEFAULT 'private';
ALTER TABLE "Chat" ALTER COLUMN "visibility" SET NOT NULL;
