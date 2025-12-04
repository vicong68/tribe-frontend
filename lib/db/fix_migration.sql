-- 修复数据库迁移脚本
-- 用于手动添加缺失的字段（如果自动迁移失败）

-- 添加 title 字段
ALTER TABLE "Chat" ADD COLUMN IF NOT EXISTS "title" text;
UPDATE "Chat" SET "title" = 'Untitled' WHERE "title" IS NULL;
ALTER TABLE "Chat" ALTER COLUMN "title" SET NOT NULL;

-- 添加 visibility 字段
ALTER TABLE "Chat" ADD COLUMN IF NOT EXISTS "visibility" varchar DEFAULT 'private' NOT NULL;

-- 添加 lastContext 字段
ALTER TABLE "Chat" ADD COLUMN IF NOT EXISTS "lastContext" jsonb;

