import { describe, it, expect } from 'vitest';
import { filterWordsByMode, collectMistakes, buildDictationRecord } from '../logic.js';

describe('filterWordsByMode', () => {
    const allWords = [
        { word: '春风', lesson: '课文1' },
        { word: '夏雨', lesson: '课文1' },
        { word: '秋霜', lesson: '课文2' },
        { word: '冬雪', lesson: '课文2' },
    ];

    it('all 模式返回全部词语', () => {
        const { words, error } = filterWordsByMode(allWords, 'all');
        expect(error).toBeNull();
        expect(words).toHaveLength(4);
    });

    it('mistakes 模式只返回含有错字的词', () => {
        const mistakes = [
            { char: '春', count: 2 },
            { char: '雪', count: 1 },
        ];
        const { words, error } = filterWordsByMode(allWords, 'mistakes', mistakes);
        expect(error).toBeNull();
        expect(words).toHaveLength(2);
        expect(words.map(w => w.word)).toContain('春风');
        expect(words.map(w => w.word)).toContain('冬雪');
    });

    it('mistakes 模式无匹配时返回错误信息', () => {
        const mistakes = [{ char: '龙', count: 1 }]; // 没有词语包含这个字
        const { words, error } = filterWordsByMode(allWords, 'mistakes', mistakes);
        expect(words).toHaveLength(0);
        expect(error).toBe('没有错字词');
    });

    it('mistakes 模式无错字记录时返回错误', () => {
        const { words, error } = filterWordsByMode(allWords, 'mistakes', []);
        expect(words).toHaveLength(0);
        expect(error).toBe('没有错字词');
    });

    it('random 模式返回指定数量', () => {
        const { words } = filterWordsByMode(allWords, 'random', [], 2);
        expect(words).toHaveLength(2);
    });

    it('random 模式错字词优先', () => {
        const mistakes = [
            { char: '霜', count: 5 },
            { char: '雪', count: 3 },
        ];
        const { words } = filterWordsByMode(allWords, 'random', mistakes, 2);
        // 秋霜 has highest mistake score (5), 冬雪 has 3
        expect(words[0].word).toBe('秋霜');
        expect(words[1].word).toBe('冬雪');
    });

    it('random 模式数量大于词库时返回全部', () => {
        const { words } = filterWordsByMode(allWords, 'random', [], 100);
        expect(words).toHaveLength(4);
    });

    it('未知模式返回全部词语', () => {
        const { words } = filterWordsByMode(allWords, 'unknown');
        expect(words).toHaveLength(4);
    });
});

describe('collectMistakes', () => {
    it('正确收集去重的错字和错误词语', () => {
        const selectedChars = new Set(['春_春风_0', '风_春风_0', '夏_夏雨_1']);
        const selectedCharMeta = {
            '春_春风_0': { char: '春', word: '春风', lesson: '课文1' },
            '风_春风_0': { char: '风', word: '春风', lesson: '课文1' },
            '夏_夏雨_1': { char: '夏', word: '夏雨', lesson: '课文1' },
        };
        const { uniqueMistakes, wrongWords } = collectMistakes(selectedChars, selectedCharMeta);
        expect(Object.keys(uniqueMistakes)).toHaveLength(3);
        expect(uniqueMistakes['春'].word).toBe('春风');
        expect(uniqueMistakes['风'].word).toBe('春风');
        expect(uniqueMistakes['夏'].word).toBe('夏雨');
        expect(wrongWords).toEqual(expect.arrayContaining(['春风', '夏雨']));
        expect(wrongWords).toHaveLength(2);
    });

    it('同一个字出现在多个词中只记录第一次', () => {
        const selectedChars = new Set(['风_春风_0', '风_风景_1']);
        const selectedCharMeta = {
            '风_春风_0': { char: '风', word: '春风', lesson: '课文1' },
            '风_风景_1': { char: '风', word: '风景', lesson: '课文2' },
        };
        const { uniqueMistakes, wrongWords } = collectMistakes(selectedChars, selectedCharMeta);
        // 字 '风' 只记录第一个遇到的
        expect(Object.keys(uniqueMistakes)).toHaveLength(1);
        expect(uniqueMistakes['风'].word).toBe('春风');
        // 但两个词都算错
        expect(wrongWords).toHaveLength(2);
    });

    it('空选择返回空结果', () => {
        const { uniqueMistakes, wrongWords } = collectMistakes(new Set(), {});
        expect(Object.keys(uniqueMistakes)).toHaveLength(0);
        expect(wrongWords).toHaveLength(0);
    });
});

describe('buildDictationRecord', () => {
    it('正确计算听写记录', () => {
        const currentWords = [
            { word: '春风', lesson: '课文1' },
            { word: '夏雨', lesson: '课文1' },
            { word: '秋霜', lesson: '课文2' },
        ];
        const dictationLessons = ['课文1', '课文2'];
        const wrongWords = ['春风'];
        const now = new Date(2026, 2, 5, 14, 30, 0); // 2026-03-05 14:30:00

        const record = buildDictationRecord(currentWords, dictationLessons, wrongWords, now);
        expect(record.datetime).toBe('2026-03-05 14:30:00');
        expect(record.total_words).toBe(3);
        expect(record.correct_count).toBe(2);
        expect(record.wrong_words).toEqual(['春风']);
        expect(record.lessons_covered).toEqual(['课文1', '课文2']);
    });

    it('无错词时全部正确', () => {
        const currentWords = [
            { word: '春风', lesson: '课文1' },
            { word: '夏雨', lesson: '课文1' },
        ];
        const record = buildDictationRecord(currentWords, ['课文1'], [], new Date(2026, 0, 1, 8, 0, 0));
        expect(record.total_words).toBe(2);
        expect(record.correct_count).toBe(2);
        expect(record.wrong_words).toEqual([]);
        expect(record.datetime).toBe('2026-01-01 08:00:00');
    });

    it('dictationLessons 为空时从 currentWords 推导', () => {
        const currentWords = [
            { word: '春风', lesson: '课文1' },
            { word: '秋霜', lesson: '课文2' },
            { word: '夏雨', lesson: '课文1' },
        ];
        const record = buildDictationRecord(currentWords, [], ['春风'], new Date(2026, 5, 15, 20, 5, 30));
        expect(record.lessons_covered).toEqual(expect.arrayContaining(['课文1', '课文2']));
        expect(record.lessons_covered).toHaveLength(2);
    });

    it('日期时间格式补零正确', () => {
        const now = new Date(2026, 0, 5, 3, 7, 9); // 单位数月/日/时/分/秒
        const record = buildDictationRecord([{ word: '测试', lesson: '课1' }], ['课1'], [], now);
        expect(record.datetime).toBe('2026-01-05 03:07:09');
    });
});
