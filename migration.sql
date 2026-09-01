-- =============================================================
-- Yoyo Words schema 修复脚本
-- 解决: lessons 表缺 textbook 列,导致前端添加/seed 课程时报 400
-- =============================================================
-- 怎么跑：
--   1. 打开 https://supabase.com/dashboard/project/wonshabdlvjzdtiicsjf/sql/new
--   2. 复制下面全部内容，粘贴到 SQL Editor
--   3. 点右下角 "Run" 按钮（绿色）
--   4. 看到 "Success. No rows returned" 即成功
--
-- 这一段是幂等的（多次跑不会出错）：
--   - ALTER TABLE ADD COLUMN IF NOT EXISTS：列已存在则跳过
--   - CREATE INDEX IF NOT EXISTS：索引已存在则跳过
--   - DO $$ BEGIN ... EXCEPTION WHEN duplicate_object ... $$：
--     unique 约束已存在则跳过
-- =============================================================

-- 1. 给 lessons 表加 textbook 列（默认 '默认课本'）
ALTER TABLE public.lessons
    ADD COLUMN IF NOT EXISTS textbook TEXT NOT NULL DEFAULT '默认课本';

-- 2. 给 textbook 列加索引（默写选课按课本过滤时更快）
CREATE INDEX IF NOT EXISTS idx_lessons_textbook ON public.lessons (textbook);

-- 3. 给 textbooks 表的 (user_id, name) 加唯一约束
--    app.js 第 158 行 dbAddTextbook 依赖 unique-violation 23505 做幂等
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'textbooks_user_name_unique'
          AND conrelid = 'public.textbooks'::regclass
    ) THEN
        ALTER TABLE public.textbooks
            ADD CONSTRAINT textbooks_user_name_unique UNIQUE (user_id, name);
    END IF;
END $$;

-- 4. 跑完上面后，再跑这一段可以验证 schema 是否正确：
--    （这是只读查询，可选）
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'lessons'
ORDER BY ordinal_position;
-- 期望看到 textbook 列存在，且 default = '默认课本'

-- 5. 给 textbooks 表加 hidden 列（隐藏的课本在默写 tab 不显示，但词库 tab 仍可见可管理）
ALTER TABLE public.textbooks
    ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE;

-- 6. 建 voice_packs 表：用户自定义语音包元数据（之前只在 localStorage，多设备不同步）
CREATE TABLE IF NOT EXISTS public.voice_packs (
    id TEXT PRIMARY KEY,                    -- 'pack_<timestamp>' 客户端生成，保持与 IndexedDB 一致
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_packs_user ON public.voice_packs (user_id);
-- 同一用户下语音包名唯一
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'voice_packs_user_name_unique'
          AND conrelid = 'public.voice_packs'::regclass
    ) THEN
        ALTER TABLE public.voice_packs
            ADD CONSTRAINT voice_packs_user_name_unique UNIQUE (user_id, name);
    END IF;
END $$;
-- 启用 RLS：只能读写自己的
ALTER TABLE public.voice_packs ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE policyname = 'voice_packs_owner_all'
    ) THEN
        CREATE POLICY voice_packs_owner_all ON public.voice_packs
            FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
    END IF;
END $$;