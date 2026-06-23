import { describe, it, expect } from 'vitest';
import { parseTextToUnits } from '../logic.js';

describe('parseTextToUnits', () => {
    it('解析带单元和课文编号的结构化文本', () => {
        const text = `第一单元
1 春夏秋冬
春风 夏雨 秋霜 冬雪
2 姓氏歌
赵钱 孙李 周吴 郑王
第二单元
3 小青蛙
河水 清天 天气 晴眼`;

        const result = parseTextToUnits(text);
        expect(result.mode).toBe('structured');
        expect(result.textbooks).toHaveLength(1);
        expect(result.textbooks[0].name).toBe('默认课本');
        expect(result.textbooks[0].units).toHaveLength(2);
        expect(result.textbooks[0].units[0].name).toBe('第一单元');
        expect(result.textbooks[0].units[0].lessons).toHaveLength(2);
        expect(result.textbooks[0].units[0].lessons[0].name).toBe('1 春夏秋冬');
        expect(result.textbooks[0].units[0].lessons[0].words).toEqual(['春风', '夏雨', '秋霜', '冬雪']);
        expect(result.textbooks[0].units[0].lessons[1].name).toBe('2 姓氏歌');
        expect(result.textbooks[0].units[1].name).toBe('第二单元');
        expect(result.textbooks[0].units[1].lessons).toHaveLength(1);
        expect(result.textbooks[0].units[1].lessons[0].name).toBe('3 小青蛙');
    });

    it('无结构文本归入默认课本', () => {
        const text = `1 春夏秋冬
春风 夏雨 秋霜 冬雪`;

        const result = parseTextToUnits(text);
        expect(result.mode).toBe('structured');
        expect(result.textbooks).toHaveLength(1);
        expect(result.textbooks[0].name).toBe('默认课本');
        expect(result.textbooks[0].units[0].name).toBe('默认单元');
        expect(result.textbooks[0].units[0].lessons[0].words).toEqual(['春风', '夏雨', '秋霜', '冬雪']);
    });

    it('指定 manualName 时使用 flat 模式', () => {
        const text = '春风 夏雨 秋霜 冬雪';
        const result = parseTextToUnits(text, '自定义课文');
        expect(result.mode).toBe('flat');
        expect(result.textbooks).toHaveLength(1);
        expect(result.textbooks[0].name).toBe('默认课本');
        expect(result.textbooks[0].units[0].lessons[0].name).toBe('自定义课文');
        expect(result.textbooks[0].units[0].lessons[0].words).toEqual(['春风', '夏雨', '秋霜', '冬雪']);
    });

    it('空文本返回 empty', () => {
        const result = parseTextToUnits('');
        expect(result.mode).toBe('empty');
        expect(result.textbooks).toEqual([]);
    });

    it('只有英文/数字无中文时返回 empty', () => {
        const result = parseTextToUnits('hello world 12345');
        expect(result.mode).toBe('empty');
        expect(result.textbooks).toEqual([]);
    });

    it('同一课文中重复词语只保留一份', () => {
        const text = `1 春夏秋冬
春风 夏雨 春风 秋霜 夏雨`;

        const result = parseTextToUnits(text);
        expect(result.textbooks[0].units[0].lessons[0].words).toEqual(['春风', '夏雨', '秋霜']);
    });

    it('过滤练习行（含特殊字符的标题不作为课文名）', () => {
        const text = `1 春夏秋冬
春风 夏雨
2 语文园地一：
这行应该被忽略
3 小青蛙
河水 天气`;

        const result = parseTextToUnits(text);
        const names = result.textbooks[0].units[0].lessons.map(l => l.name);
        expect(names).toContain('1 春夏秋冬');
        expect(names).toContain('3 小青蛙');
        expect(names).not.toContain('2 语文园地一：');
    });

    it('单字词被过滤（只保留2字及以上）', () => {
        const text = `1 测试课文
的 春风 了 夏雨`;

        const result = parseTextToUnits(text);
        expect(result.textbooks[0].units[0].lessons[0].words).toEqual(['春风', '夏雨']);
    });

    it('多单元多课文的完整解析', () => {
        const text = `第一单元
1 春夏秋冬
春风 夏雨
2 姓氏歌
赵钱 孙李
第二单元
3 小青蛙
河水 天气
4 猜字谜
左右 红色`;

        const result = parseTextToUnits(text);
        expect(result.textbooks).toHaveLength(1);
        expect(result.textbooks[0].units).toHaveLength(2);
        expect(result.textbooks[0].units[0].lessons).toHaveLength(2);
        expect(result.textbooks[0].units[1].lessons).toHaveLength(2);
        expect(result.textbooks[0].units[1].lessons[1].words).toEqual(['左右', '红色']);
    });

    // === Textbook-level detection ===

    it('检测人教版四年级上册课本', () => {
        const text = `人教版四年级上册
第一单元
1 观潮景象
潮水 浪花 宽阔`;

        const result = parseTextToUnits(text);
        expect(result.mode).toBe('structured');
        expect(result.textbooks).toHaveLength(1);
        expect(result.textbooks[0].name).toBe('人教版四年级上册');
        expect(result.textbooks[0].units).toHaveLength(1);
        expect(result.textbooks[0].units[0].name).toBe('第一单元');
        expect(result.textbooks[0].units[0].lessons[0].words).toEqual(['潮水', '浪花', '宽阔']);
    });

    it('检测部编版/苏教版/北师大版课本', () => {
        const text = `部编版三年级下册
第一单元
1 测试课文
春风 夏雨
苏教版五年级上册
第一单元
1 测试课文二
秋霜 冬雪`;

        const result = parseTextToUnits(text);
        expect(result.textbooks).toHaveLength(2);
        expect(result.textbooks[0].name).toBe('部编版三年级下册');
        expect(result.textbooks[1].name).toBe('苏教版五年级上册');
        expect(result.textbooks[0].units[0].lessons[0].words).toEqual(['春风', '夏雨']);
        expect(result.textbooks[1].units[0].lessons[0].words).toEqual(['秋霜', '冬雪']);
    });

    it('检测"课本：xxx"格式标签', () => {
        const text = `课本：我的古诗集
第一单元
1 古诗三首
春风 夏雨 秋霜`;

        const result = parseTextToUnits(text);
        expect(result.textbooks).toHaveLength(1);
        expect(result.textbooks[0].name).toBe('我的古诗集');
        expect(result.textbooks[0].units[0].lessons[0].words).toEqual(['春风', '夏雨', '秋霜']);
    });

    it('无课本标记时归入"默认课本"', () => {
        const text = `第一单元
1 春夏秋冬
春风 夏雨`;

        const result = parseTextToUnits(text);
        expect(result.textbooks).toHaveLength(1);
        expect(result.textbooks[0].name).toBe('默认课本');
    });

    it('两本课本各含多单元', () => {
        const text = `人教版四年级上册
第一单元
1 测试课文一
春风 夏雨
第二单元
2 测试课文二
秋霜 冬雪
人教版四年级下册
第一单元
3 测试课文三
潮水 浪花`;

        const result = parseTextToUnits(text);
        expect(result.textbooks).toHaveLength(2);
        expect(result.textbooks[0].name).toBe('人教版四年级上册');
        expect(result.textbooks[0].units).toHaveLength(2);
        expect(result.textbooks[1].name).toBe('人教版四年级下册');
        expect(result.textbooks[1].units).toHaveLength(1);
        expect(result.textbooks[1].units[0].lessons[0].words).toEqual(['潮水', '浪花']);
    });
});
