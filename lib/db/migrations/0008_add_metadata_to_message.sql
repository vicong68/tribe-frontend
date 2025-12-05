-- 添加 metadata 字段到 Message_v2 表
ALTER TABLE "Message_v2" ADD COLUMN IF NOT EXISTS "metadata" jsonb;

