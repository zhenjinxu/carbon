-- 修复重复触发器问题
-- 删除所有重复的触发器，只保留一份

DO $$
DECLARE
    r RECORD;
    trigger_to_keep TEXT;
    trigger_to_drop TEXT;
BEGIN
    -- 遍历所有有重复触发器的表
    FOR r IN
        SELECT
            event_object_table,
            LOWER(trigger_name) as trigger_name_lower,
            ARRAY_AGG(trigger_name ORDER BY trigger_name) as trigger_names
        FROM information_schema.triggers
        WHERE trigger_name LIKE 'trg_event%'
        GROUP BY event_object_table, LOWER(trigger_name)
        HAVING COUNT(*) > 1
    LOOP
        -- 保留第一个触发器，删除其他的
        trigger_to_keep := r.trigger_names[1];

        -- 删除重复的触发器
        FOR i IN 2..array_length(r.trigger_names, 1) LOOP
            trigger_to_drop := r.trigger_names[i];
            EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', trigger_to_drop, r.event_object_table);
            RAISE NOTICE 'Dropped duplicate trigger % on table %', trigger_to_drop, r.event_object_table;
        END LOOP;
    END LOOP;
END $$;

-- 验证修复结果
SELECT
    event_object_table,
    LOWER(trigger_name) as trigger_name_lower,
    COUNT(*) as count
FROM information_schema.triggers
WHERE trigger_name LIKE 'trg_event%'
GROUP BY event_object_table, LOWER(trigger_name)
HAVING COUNT(*) > 1
ORDER BY event_object_table;
