import { describe, it, expect } from 'vitest';
import { getOnlineTtsUrl } from '../logic.js';

describe('getOnlineTtsUrl', () => {
    it('youdao provider 生成有道词典 URL', () => {
        const url = getOnlineTtsUrl('你好', 'youdao');
        expect(url).toBe('https://dict.youdao.com/dictvoice?audio=%E4%BD%A0%E5%A5%BD&type=2');
    });

    it('baidu provider 生成百度翻译 URL', () => {
        const url = getOnlineTtsUrl('你好', 'baidu');
        expect(url).toBe('https://fanyi.baidu.com/gettts?lan=zh&text=%E4%BD%A0%E5%A5%BD&spd=5');
    });

    it('默认 provider 使用有道', () => {
        const url = getOnlineTtsUrl('春风');
        expect(url).toContain('dict.youdao.com');
        expect(url).toContain(encodeURIComponent('春风'));
    });

    it('未知 provider 使用有道', () => {
        const url = getOnlineTtsUrl('测试', 'unknown');
        expect(url).toContain('dict.youdao.com');
    });

    it('正确编码特殊字符', () => {
        const word = '你好吗';
        const url = getOnlineTtsUrl(word, 'youdao');
        expect(url).toContain(encodeURIComponent(word));
        // 确保没有原始中文字符
        expect(url).not.toContain(word);
    });
});
