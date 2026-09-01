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

-- =============================================================
-- 完成！现在可以做：
--   a) 在 words.js 里加 5 年级课本种子数据（可选）
--   b) 重新登录 App，让 showMainApp() 自动 seed words.js 内容到数据库
--   c) app.js 第 87-97 行的 one-time migration 会把所有 textbook 为空的
--      旧课改成 '默认课本'（你数据库是空的所以这次不会触发）
-- =============================================================

-- =============================================================
-- 完成！现在可以做：
--   a) 在 words.js 里加 5 年级课本种子数据（可选）
--   b) 重新登录 App，让 showMainApp() 自动 seed words.js 内容到数据库
--   c) app.js 第 87-97 行的 one-time migration 会把所有 textbook 为空的
--      旧课改成 '默认课本'（你数据库是空的所以这次不会触发）
-- =============================================================