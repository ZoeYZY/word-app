import { describe, it, expect } from 'vitest';
import { groupByTextbook } from '../logic.js';

describe('groupByTextbook', () => {
    it('按 textbook 字段分组', () => {
        const lessons = [
            { name: '课文1', textbook: '人教版四年级上册', unit: '第一单元', words: ['春风'] },
            { name: '课文2', textbook: '人教版四年级上册', unit: '第二单元', words: ['夏雨'] },
            { name: '课文3', textbook: '人教版四年级下册', unit: '第一单元', words: ['秋霜'] },
        ];
        const result = groupByTextbook(lessons);
        expect(Object.keys(result).sort()).toEqual(['人教版四年级上册', '人教版四年级下册']);
        expect(result['人教版四年级上册']).toHaveLength(2);
        expect(result['人教版四年级下册']).toHaveLength(1);
    });

    it('无 textbook 字段时归入"默认课本"', () => {
        const lessons = [
            { name: '课文1', unit: '第一单元', words: ['春风'] },
            { name: '课文2', unit: '第二单元', words: ['夏雨'] },
        ];
        const result = groupByTextbook(lessons);
        expect(Object.keys(result)).toEqual(['默认课本']);
        expect(result['默认课本']).toHaveLength(2);
    });

    it('混合有无 textbook 字段', () => {
        const lessons = [
            { name: '课文1', textbook: '人教版四年级上册', unit: '第一单元', words: ['春风'] },
            { name: '课文2', unit: '第一单元', words: ['夏雨'] },
        ];
        const result = groupByTextbook(lessons);
        expect(result['人教版四年级上册']).toHaveLength(1);
        expect(result['默认课本']).toHaveLength(1);
    });

    it('空数组返回空对象', () => {
        expect(groupByTextbook([])).toEqual({});
    });
});
