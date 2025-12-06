-- 迁移脚本：为前端 User 表添加 member_id 字段并建立关联
-- 执行前请备份数据库

-- 1. 添加 member_id 字段
ALTER TABLE "User" 
ADD COLUMN IF NOT EXISTS member_id VARCHAR(50);

-- 2. 建立关联关系（基于 email）
UPDATE "User" u
SET member_id = m.member_id
FROM members m
WHERE u.email = m.email AND u.member_id IS NULL;

-- 3. 添加外键约束
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'fk_user_member_id'
    ) THEN
        ALTER TABLE "User" 
        ADD CONSTRAINT fk_user_member_id 
        FOREIGN KEY (member_id) REFERENCES members(member_id) ON DELETE CASCADE;
    END IF;
END $$;

-- 4. 创建索引
CREATE INDEX IF NOT EXISTS idx_user_member_id ON "User"(member_id);
CREATE INDEX IF NOT EXISTS idx_members_email ON members(email);
CREATE INDEX IF NOT EXISTS idx_members_member_id ON members(member_id);

