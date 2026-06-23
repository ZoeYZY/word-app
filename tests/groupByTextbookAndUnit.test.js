import { describe, it, expect } from 'vitest';
import { groupByTextbookAndUnit } from '../logic.js';

describe('groupByTextbookAndUnit', () => {
    it('按 textbook → unit 二级分组', () => {
        const lessons = [
            { name: 'a', textbook: '人教版四年级上册', unit: '第一单元', words: [] },
            { name: 'b', textbook: '人教版四年级上册', unit: '第一单元', words: [] },
            { name: 'c', textbook: '人教版四年级上册', unit: '第二单元', words: [] },
            { name: 'd', textbook: '人教版四年级下册', unit: '第一单元', words: [] },
        ];
        const result = groupByTextbookAndUnit(lessons);
        expect(Object.keys(result).sort()).toEqual(['人教版四年级上册', '人教版四年级下册']);
        expect(result['人教版四年级上册']['第一单元']).toHaveLength(2);
        expect(result['人教版四年级上册']['第二单元']).toHaveLength(1);
        expect(result['人教版四年级下册']['第一单元']).toHaveLength(1);
    });

    it('缺字段时归入默认值', () => {
        const lessons = [
            { name: 'a', words: [] },
            { name: 'b', textbook: '人教版四年级上册', words: [] },
        ];
        const result = groupByTextbookAndUnit(lessons);
        expect(result['默认课本']['默认单元']).toHaveLength(1);
        expect(result['人教版四年级上册']['默认单元']).toHaveLength(1);
    });

    it('空数组返回空对象', () => {
        expect(groupByTextbookAndUnit([])).toEqual({});
    });
});
