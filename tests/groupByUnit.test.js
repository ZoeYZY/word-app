import { describe, it, expect } from 'vitest';
import { groupByUnit } from '../logic.js';

describe('groupByUnit', () => {
    it('按 unit 字段分组', () => {
        const lessons = [
            { name: '课文1', unit: '第一单元', words: ['春风'] },
            { name: '课文2', unit: '第一单元', words: ['夏雨'] },
            { name: '课文3', unit: '第二单元', words: ['秋霜'] },
        ];
        const result = groupByUnit(lessons);
        expect(Object.keys(result)).toEqual(['第一单元', '第二单元']);
        expect(result['第一单元']).toHaveLength(2);
        expect(result['第二单元']).toHaveLength(1);
    });

    it('无 unit 字段时归入默认单元', () => {
        const lessons = [
            { name: '课文1', words: ['春风'] },
            { name: '课文2', words: ['夏雨'] },
        ];
        const result = groupByUnit(lessons);
        expect(Object.keys(result)).toEqual(['默认单元']);
        expect(result['默认单元']).toHaveLength(2);
    });

    it('混合有无 unit 字段', () => {
        const lessons = [
            { name: '课文1', unit: '第一单元', words: ['春风'] },
            { name: '课文2', words: ['夏雨'] },
        ];
        const result = groupByUnit(lessons);
        expect(Object.keys(result)).toContain('第一单元');
        expect(Object.keys(result)).toContain('默认单元');
    });

    it('空数组返回空对象', () => {
        const result = groupByUnit([]);
        expect(result).toEqual({});
    });
});
