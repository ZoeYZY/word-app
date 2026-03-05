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
        expect(result.units).toHaveLength(2);
        expect(result.units[0].unitName).toBe('第一单元');
        expect(result.units[0].lessons).toHaveLength(2);
        expect(result.units[0].lessons[0].name).toBe('1 春夏秋冬');
        expect(result.units[0].lessons[0].words).toEqual(['春风', '夏雨', '秋霜', '冬雪']);
        expect(result.units[0].lessons[1].name).toBe('2 姓氏歌');
        expect(result.units[1].unitName).toBe('第二单元');
        expect(result.units[1].lessons).toHaveLength(1);
        expect(result.units[1].lessons[0].name).toBe('3 小青蛙');
    });

    it('无结构文本归入默认单元', () => {
        const text = `1 春夏秋冬
春风 夏雨 秋霜 冬雪`;

        const result = parseTextToUnits(text);
        expect(result.mode).toBe('structured');
        expect(result.units).toHaveLength(1);
        expect(result.units[0].unitName).toBe('默认单元');
        expect(result.units[0].lessons[0].words).toEqual(['春风', '夏雨', '秋霜', '冬雪']);
    });

    it('指定 manualName 时使用 flat 模式', () => {
        const text = '春风 夏雨 秋霜 冬雪';
        const result = parseTextToUnits(text, '自定义课文');
        expect(result.mode).toBe('flat');
        expect(result.units).toHaveLength(1);
        expect(result.units[0].lessons[0].name).toBe('自定义课文');
        expect(result.units[0].lessons[0].words).toEqual(['春风', '夏雨', '秋霜', '冬雪']);
    });

    it('空文本返回 empty', () => {
        const result = parseTextToUnits('');
        expect(result.mode).toBe('empty');
        expect(result.units).toEqual([]);
    });

    it('只有英文/数字无中文时返回 empty', () => {
        const result = parseTextToUnits('hello world 12345');
        expect(result.mode).toBe('empty');
        expect(result.units).toEqual([]);
    });

    it('同一课文中重复词语只保留一份', () => {
        const text = `1 春夏秋冬
春风 夏雨 春风 秋霜 夏雨`;

        const result = parseTextToUnits(text);
        expect(result.units[0].lessons[0].words).toEqual(['春风', '夏雨', '秋霜']);
    });

    it('过滤练习行（含特殊字符的标题不作为课文名）', () => {
        const text = `1 春夏秋冬
春风 夏雨
2 语文园地一：
这行应该被忽略
3 小青蛙
河水 天气`;

        const result = parseTextToUnits(text);
        const names = result.units[0].lessons.map(l => l.name);
        expect(names).toContain('1 春夏秋冬');
        expect(names).toContain('3 小青蛙');
        // "2 语文园地一：" has ：so it is treated as exercise and skipped
        expect(names).not.toContain('2 语文园地一：');
    });

    it('单字词被过滤（只保留2字及以上）', () => {
        const text = `1 测试课文
的 春风 了 夏雨`;

        const result = parseTextToUnits(text);
        expect(result.units[0].lessons[0].words).toEqual(['春风', '夏雨']);
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
        expect(result.units).toHaveLength(2);
        expect(result.units[0].lessons).toHaveLength(2);
        expect(result.units[1].lessons).toHaveLength(2);
        expect(result.units[1].lessons[1].words).toEqual(['左右', '红色']);
    });
});
