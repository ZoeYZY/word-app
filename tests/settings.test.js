import { describe, it, expect } from 'vitest';
import { loadSettingsFromString } from '../logic.js';

describe('loadSettingsFromString', () => {
    it('合法 JSON 正确合并到默认设置', () => {
        const json = JSON.stringify({ rate: 1.2, pitch: 0.9 });
        const settings = loadSettingsFromString(json);
        expect(settings.rate).toBe(1.2);
        expect(settings.pitch).toBe(0.9);
        // 未指定字段保留默认值
        expect(settings.voiceSource).toBe('online');
        expect(settings.onlineProvider).toBe('youdao');
        expect(settings.voicePacks).toHaveLength(1);
    });

    it('无效 JSON 保留默认设置', () => {
        const settings = loadSettingsFromString('{invalid json}');
        expect(settings.rate).toBe(0.8);
        expect(settings.pitch).toBe(1.1);
        expect(settings.voiceSource).toBe('online');
    });

    it('null 输入保留默认设置', () => {
        const settings = loadSettingsFromString(null);
        expect(settings.rate).toBe(0.8);
        expect(settings.voicePacks).toHaveLength(1);
        expect(settings.voicePacks[0].id).toBe('default');
    });

    it('空字符串保留默认设置', () => {
        const settings = loadSettingsFromString('');
        expect(settings.rate).toBe(0.8);
    });

    it('缺少 voicePacks 时自动补充默认语音包', () => {
        const json = JSON.stringify({ voicePacks: [] });
        const settings = loadSettingsFromString(json);
        expect(settings.voicePacks).toHaveLength(1);
        expect(settings.voicePacks[0].id).toBe('default');
        expect(settings.voicePacks[0].name).toBe('默认录音');
    });

    it('voicePacks 为 null 时自动补充', () => {
        const json = JSON.stringify({ voicePacks: null });
        const settings = loadSettingsFromString(json);
        expect(settings.voicePacks).toHaveLength(1);
    });

    it('自定义 voicePacks 保留', () => {
        const packs = [{ id: 'custom1', name: '妈妈的声音' }];
        const json = JSON.stringify({ voicePacks: packs });
        const settings = loadSettingsFromString(json);
        expect(settings.voicePacks).toEqual(packs);
    });

    it('完整自定义设置合并正确', () => {
        const custom = {
            voiceURI: 'Microsoft Huihui',
            rate: 1.5,
            pitch: 0.5,
            voiceSource: 'browser',
            onlineProvider: 'baidu',
            activePackId: 'pack_123',
            voicePacks: [{ id: 'default', name: '默认录音' }, { id: 'pack_123', name: '自定义' }]
        };
        const settings = loadSettingsFromString(JSON.stringify(custom));
        expect(settings).toEqual(custom);
    });
});
