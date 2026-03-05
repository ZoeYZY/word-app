// ==================== Testable Logic Module ====================
// Extracted pure functions from app.js for unit testing.
// This file uses ES Module exports for Vitest, but does NOT affect
// the production app.js which loads via <script> tag.

/**
 * Parse structured text into units → lessons → words.
 */
export function parseTextToUnits(fullText, manualName) {
    const lines = fullText.split(/\n/);
    const unitPattern = /^第\s*[一二三四五六七八九十百千\d]+\s*单元[：:\s]*(.*)/;
    const lessonPattern = /^(\d+)\s*[.、．·]?\s*(.+)/;
    let units = [], curUnit = null, curLesson = null;
    for (const line of lines) {
        const trimmed = line.trim(); if (!trimmed) continue;
        const unitMatch = trimmed.match(unitPattern);
        if (unitMatch) {
            if (curLesson && curUnit) curUnit.lessons.push(curLesson);
            if (curUnit) units.push(curUnit);
            curUnit = { unitName: trimmed.replace(/[：:]\s*$/, '').trim(), lessons: [] };
            curLesson = null; continue;
        }
        const lessonMatch = trimmed.match(lessonPattern);
        if (lessonMatch) {
            const rest = lessonMatch[2].trim();
            const isExercise = /[：:_—]/.test(rest) || rest.replace(/[^\u4e00-\u9fa5]/g, '').length < 3;
            if (!isExercise) {
                if (curLesson) { if (!curUnit) curUnit = { unitName: '默认单元', lessons: [] }; curUnit.lessons.push(curLesson); }
                curLesson = { name: `${lessonMatch[1]} ${rest}`, words: [] }; continue;
            }
        }
        if (curLesson) {
            const words = trimmed.match(/[\u4e00-\u9fa5]{2,}/g) || [];
            words.forEach(w => { if (!curLesson.words.includes(w)) curLesson.words.push(w); });
        }
    }
    if (curLesson) { if (!curUnit) curUnit = { unitName: '默认单元', lessons: [] }; curUnit.lessons.push(curLesson); }
    if (curUnit) units.push(curUnit);
    units = units.map(u => ({ ...u, lessons: u.lessons.filter(l => l.words.length > 0) })).filter(u => u.lessons.length > 0);

    if (!manualName && units.length > 0) {
        return { units, mode: 'structured' };
    } else {
        const all = fullText.match(/[\u4e00-\u9fa5]{2,}/g) || [];
        const unique = [...new Set(all)];
        if (!unique.length) return { units: [], mode: 'empty' };
        return { units: [{ unitName: '默认单元', lessons: [{ name: manualName || '未命名课文', words: unique }] }], mode: 'flat' };
    }
}

/**
 * Group a list of lesson objects by their `unit` field.
 */
export function groupByUnit(lessonList) {
    const map = {};
    lessonList.forEach(l => {
        const u = l.unit || '默认单元';
        if (!map[u]) map[u] = [];
        map[u].push(l);
    });
    return map;
}

/**
 * Get online TTS URL for a word based on provider.
 */
export function getOnlineTtsUrl(word, provider) {
    switch (provider) {
        case 'baidu':
            return `https://fanyi.baidu.com/gettts?lan=zh&text=${encodeURIComponent(word)}&spd=5`;
        case 'youdao':
        default:
            return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=2`;
    }
}

/**
 * Load settings from a JSON string, merging with defaults.
 * Returns the merged settings object (pure function).
 */
export function loadSettingsFromString(jsonStr) {
    const defaults = {
        voiceURI: '',
        rate: 0.8,
        pitch: 1.1,
        voiceSource: 'online',
        onlineProvider: 'youdao',
        activePackId: 'default',
        voicePacks: [{ id: 'default', name: '默认录音' }]
    };
    if (!jsonStr) return { ...defaults };
    try {
        const parsed = JSON.parse(jsonStr);
        const merged = { ...defaults, ...parsed };
        if (!merged.voicePacks || !merged.voicePacks.length) {
            merged.voicePacks = [{ id: 'default', name: '默认录音' }];
        }
        return merged;
    } catch (e) {
        return { ...defaults };
    }
}

/**
 * Filter words by dictation mode.
 * @param {Array} allWords - [{ word, lesson }, ...]
 * @param {string} mode - 'all' | 'mistakes' | 'random'
 * @param {Array} allMistakes - [{ char, count }, ...]
 * @param {number} randomCount - number of words for 'random' mode
 * @returns {{ words: Array, error: string|null }}
 */
export function filterWordsByMode(allWords, mode, allMistakes = [], randomCount = 10) {
    if (mode === 'all') {
        return { words: [...allWords], error: null };
    }

    const charSet = new Set(allMistakes.map(m => m.char));
    const hasMC = (word) => [...word].some(c => charSet.has(c));

    if (mode === 'mistakes') {
        const filtered = allWords.filter(it => hasMC(it.word));
        if (!filtered.length) return { words: [], error: '没有错字词' };
        return { words: filtered, error: null };
    }

    if (mode === 'random') {
        const mm = {};
        allMistakes.forEach(m => { mm[m.char] = m.count; });
        const mScore = (word) => { let s = 0; for (const c of word) if (mm[c]) s += mm[c]; return s; };

        const scored = allWords.map(it => ({ ...it, _score: mScore(it.word) }));
        // Sort by mistake score descending (deterministic, no random for testability)
        scored.sort((a, b) => b._score - a._score);
        const n = Math.min(randomCount, scored.length);
        return { words: scored.slice(0, n), error: null };
    }

    return { words: [...allWords], error: null };
}

/**
 * Collect unique mistake characters from selected chars/meta.
 * @param {Set} selectedChars - set of keys
 * @param {Object} selectedCharMeta - { key: { char, word, lesson } }
 * @returns {{ uniqueMistakes: Object, wrongWords: string[] }}
 */
export function collectMistakes(selectedChars, selectedCharMeta) {
    const uniq = {};
    for (const key of selectedChars) {
        const m = selectedCharMeta[key];
        if (m && !uniq[m.char]) uniq[m.char] = m;
    }
    const wrongWordsSet = new Set();
    for (const key of selectedChars) {
        const m = selectedCharMeta[key];
        if (m) wrongWordsSet.add(m.word);
    }
    return { uniqueMistakes: uniq, wrongWords: [...wrongWordsSet] };
}

/**
 * Build a dictation record object.
 * @param {Array} currentWords - [{ word, lesson }, ...]
 * @param {string[]} dictationLessons - lesson names
 * @param {string[]} wrongWords - wrong word list
 * @param {Date} now - current timestamp
 * @returns {Object} record
 */
export function buildDictationRecord(currentWords, dictationLessons, wrongWords, now) {
    const pad = n => String(n).padStart(2, '0');
    const datetime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const totalWords = currentWords.length;
    const correctCount = totalWords - wrongWords.length;
    const lessonsCovered = dictationLessons.length ? dictationLessons : [...new Set(currentWords.map(w => w.lesson))];
    return { datetime, total_words: totalWords, correct_count: correctCount, wrong_words: wrongWords, lessons_covered: lessonsCovered };
}
