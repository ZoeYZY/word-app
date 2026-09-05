// ==================== Built-in Textbooks ====================
const BUILTIN_TEXTBOOKS = [
    '语文五年级上',
    '语文四年级下',
];
const DEFAULT_TEXTBOOK = '语文五年级上';
const DEFAULT_UNIT = '默认单元';

// ==================== Supabase Client ====================
const SUPABASE_URL = 'https://wonshabdlvjzdtiicsjf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_KkLWWWQJ3Nc4SCJ_GI22Tw_zagGImcV';
if (typeof supabase === 'undefined') {
    console.error('Supabase SDK 未加载！请检查网络连接。');
} else {
    var sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
}

// ==================== Auth ====================
let currentUserId = null;
let session = null;
let authMode = 'login'; // 'login' or 'register'

function toggleAuthMode() {
    authMode = authMode === 'login' ? 'register' : 'login';
    document.getElementById('authSubmitBtn').textContent = authMode === 'login' ? '🚀 登录' : '✨ 注册';
    document.getElementById('authToggleBtn').textContent = authMode === 'login' ? '还没有账号？点击注册' : '已有账号？点击登录';
    document.getElementById('authError').classList.add('hidden');
}

async function handleAuth() {
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const errEl = document.getElementById('authError');
    errEl.classList.add('hidden');
    if (!email || !password) { errEl.textContent = '请填写邮箱和密码'; errEl.classList.remove('hidden'); return; }
    if (password.length < 6) { errEl.textContent = '密码至少6位'; errEl.classList.remove('hidden'); return; }
    if (typeof sb === 'undefined') {
        errEl.textContent = '登录服务未加载（网络可能受限），请检查网络后刷新重试';
        errEl.classList.remove('hidden');
        return;
    }

    const btn = document.getElementById('authSubmitBtn');
    btn.disabled = true; btn.textContent = '⏳ 请稍候...';

    let result;
    if (authMode === 'register') {
        result = await sb.auth.signUp({ email, password });
    } else {
        result = await sb.auth.signInWithPassword({ email, password });
    }

    btn.disabled = false;
    btn.textContent = authMode === 'login' ? '🚀 登录' : '✨ 注册';

    if (result.error) {
        const msg = result.error.message.includes('Invalid login') ? '邮箱或密码错误' :
            result.error.message.includes('already registered') ? '该邮箱已注册，请登录' :
                result.error.message;
        errEl.textContent = msg; errEl.classList.remove('hidden'); return;
    }

    if (result.data?.user) {
        currentUserId = result.data.user.id;
        showMainApp();
    }
}

async function handleLogout() {
    await sb.auth.signOut();
    currentUserId = null;
    document.getElementById('authPage').classList.remove('hidden');
    document.getElementById('mainApp').classList.add('hidden');
}

async function showMainApp() {
    document.getElementById('authPage').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    lessons = await dbGetLessons();
    // One-time migration: any lesson without a textbook field gets assigned "默认课本"
    const needsMigration = lessons.some(l => !l.textbook);
    if (needsMigration) {
        for (const l of lessons) {
            if (!l.textbook) {
                l.textbook = DEFAULT_TEXTBOOK;
                await dbPutLesson(l);
            }
        }
        lessons = await dbGetLessons();
    }
    // Load textbooks table; backfill any textbook names used in lessons but missing from the table.
    textbooks = await dbGetTextbooks();
    const tbNamesInTable = new Set(textbooks.map(t => t.name));
    const tbNamesInLessons = new Set(lessons.map(l => l.textbook || DEFAULT_TEXTBOOK));
    const missing = [...tbNamesInLessons].filter(n => !tbNamesInTable.has(n));
    for (const name of missing) { await dbAddTextbook(name); }
    if (missing.length) textbooks = await dbGetTextbooks();
    // Auto-seed from words.js if user's DB is empty
    if (!lessons.length && typeof WORDS_DATA !== 'undefined' && WORDS_DATA.length) {
        for (const t of WORDS_DATA) {
            for (const u of (t.units || [])) {
                for (const l of (u.lessons || [])) {
                    await dbAddLesson({ name: l.name, textbook: t.textbook, unit: u.unit, words: [...l.words] });
                }
            }
        }
        lessons = await dbGetLessons();
        // Backfill any seed textbooks into the table
        const seedMissing = [...new Set(lessons.map(l => l.textbook || DEFAULT_TEXTBOOK))].filter(n => !textbooks.find(x => x.name === n));
        for (const name of seedMissing) { await dbAddTextbook(name); }
        if (seedMissing.length) textbooks = await dbGetTextbooks();
    }
    // Load local IndexedDB recordings, then sync cloud recordings
    await AudioDB.loadAll();
    await AudioDB.loadAllFromCloud();
    // Sync voice pack list from cloud (merges with any local-only packs)
    try {
        const cloudPacks = await dbGetVoicePacks();
        const localIds = new Set(appSettings.voicePacks.map(p => p.id));
        const localDefault = appSettings.voicePacks.find(p => p.id === 'default');
        const merged = [];
        if (localDefault) merged.push(localDefault);
        // Add cloud packs not already in local list
        for (const cp of cloudPacks) {
            if (!localIds.has(cp.id)) merged.push({ id: cp.id, name: cp.name });
        }
        // Keep any local-only custom packs (so a pack created on a device still works
        // before the cloud sync round-trips back)
        for (const lp of appSettings.voicePacks) {
            if (lp.id !== 'default' && !merged.find(x => x.id === lp.id)) merged.push(lp);
        }
        if (merged.length !== appSettings.voicePacks.length ||
            merged.some((p, i) => p.id !== appSettings.voicePacks[i]?.id)) {
            appSettings.voicePacks = merged;
            localStorage.setItem('yoyo_settings', JSON.stringify(appSettings));
        }
    } catch (e) { console.warn('Cloud voice-pack sync failed (using local list):', e); }
    // Default tab
    switchTab('library');
}

async function dbGetVoicePacks() {
    const { data, error } = await sb.from('voice_packs').select('*').order('created_at');
    if (error) { console.error('dbGetVoicePacks:', error); return []; }
    return data || [];
}
async function dbAddVoicePack(id, name) {
    // Idempotent: ignore unique-constraint violations (code 23505)
    const { data, error } = await sb.from('voice_packs').insert({ id, name, user_id: currentUserId }).select().single();
    if (error && error.code !== '23505') console.error('dbAddVoicePack:', error);
    return data;
}
async function dbDelVoicePack(id) {
    if (!id) return;
    const { error } = await sb.from('voice_packs').delete().eq('id', id);
    if (error) console.error('dbDelVoicePack:', error);
}

// ==================== Data Layer (Supabase + user_id) ====================
async function dbGetLessons() {
    const { data, error } = await sb.from('lessons').select('*').order('id');
    if (error) { console.error('dbGetLessons:', error); return []; }
    return data || [];
}
async function dbGetMistakes() {
    const { data, error } = await sb.from('mistakes').select('*');
    if (error) { console.error('dbGetMistakes:', error); return []; }
    return data || [];
}
async function dbAddLesson(obj) {
    const { data, error } = await sb.from('lessons').insert({ ...obj, user_id: currentUserId }).select().single();
    if (error) console.error('dbAddLesson:', error);
    return data;
}
async function dbPutLesson(obj) {
    const { id, ...rest } = obj;
    const { error } = await sb.from('lessons').update(rest).eq('id', id);
    if (error) console.error('dbPutLesson:', error);
}
async function dbDelLesson(id) {
    const { error } = await sb.from('lessons').delete().eq('id', id);
    if (error) console.error('dbDelLesson:', error);
}
async function dbGetTextbooks() {
    const { data, error } = await sb.from('textbooks').select('*').order('name');
    if (error) { console.error('dbGetTextbooks:', error); return []; }
    return data || [];
}
async function dbAddTextbook(name) {
    // Idempotent: ignore unique-constraint violations (code 23505)
    const { data, error } = await sb.from('textbooks').insert({ name, user_id: currentUserId }).select().single();
    if (error && error.code !== '23505') console.error('dbAddTextbook:', error);
    return data;
}
async function dbDelTextbook(id) {
    if (!id) return;
    const { error } = await sb.from('textbooks').delete().eq('id', id);
    if (error) console.error('dbDelTextbook:', error);
}
async function dbRenameTextbook(id, newName) {
    if (!id) return;
    const { error } = await sb.from('textbooks').update({ name: newName }).eq('id', id);
    if (error) console.error('dbRenameTextbook:', error);
}
async function dbSetTextbookHidden(id, hidden) {
    if (!id) return;
    const { error } = await sb.from('textbooks').update({ hidden: !!hidden }).eq('id', id);
    if (error) console.error('dbSetTextbookHidden:', error);
}

async function recordCharMistake(ch, fromWord, lessonName) {
    const today = new Date().toISOString().split('T')[0];
    const { data: existing } = await sb.from('mistakes').select('*').eq('char', ch).eq('user_id', currentUserId).single();
    if (existing) {
        const dates = [...(existing.dates || []), today];
        const words = existing.words || [];
        const lessonsList = existing.lessons || [];
        if (!words.includes(fromWord)) words.push(fromWord);
        if (!lessonsList.includes(lessonName)) lessonsList.push(lessonName);
        await sb.from('mistakes').update({ count: existing.count + 1, dates, words, lessons: lessonsList }).eq('char', ch).eq('user_id', currentUserId);
    } else {
        await sb.from('mistakes').insert({ char: ch, count: 1, dates: [today], words: [fromWord], lessons: [lessonName], user_id: currentUserId });
    }
}

// ==================== Dictation Records Data Layer ====================
async function dbSaveDictationRecord(record) {
    const { error } = await sb.from('dictation_records').insert({ ...record, user_id: currentUserId });
    if (error) {
        console.warn('dbSaveDictationRecord (Supabase):', error);
        // Fallback: save to localStorage
        const key = 'yoyo_dictation_records_' + currentUserId;
        const saved = JSON.parse(localStorage.getItem(key) || '[]');
        saved.push(record);
        localStorage.setItem(key, JSON.stringify(saved));
    }
}
async function dbGetDictationRecords() {
    const { data, error } = await sb.from('dictation_records').select('*').eq('user_id', currentUserId).order('datetime', { ascending: false });
    if (error) {
        console.warn('dbGetDictationRecords (Supabase):', error);
        // Fallback: read from localStorage
        const key = 'yoyo_dictation_records_' + currentUserId;
        const saved = JSON.parse(localStorage.getItem(key) || '[]');
        return saved.sort((a, b) => b.datetime.localeCompare(a.datetime));
    }
    return data || [];
}
async function dbDeleteDictationRecord(id) {
    const { error } = await sb.from('dictation_records').delete().eq('id', id).eq('user_id', currentUserId);
    if (error) console.warn('dbDeleteDictationRecord:', error);
}

// ==================== State ====================
let lessons = [], currentWords = [], currentIndex = 0;
let textbooks = []; // from `textbooks` table; one row per textbook name
let pendingTextbooks = [];
let selectedChars = new Set(), selectedCharMeta = {};
let dictationMode = 'all';
let dragData = null;
let dictationLessons = []; // track which lesson names are covered in current dictation
let activeRecorder = null;
let audioCache = {}; // { word: base64DataUrl }

// TTS Settings
let appSettings = {
    voiceURI: '',
    rate: 0.8,
    pitch: 1.1,
    voiceSource: 'browser',   // 'browser' | 'online' | 'custom' — default switched from 'online' so new users get OS/Edge natural voice
    onlineProvider: 'youdao', // 'youdao' | 'baidu'
    activePackId: 'default',
    voicePacks: [{ id: 'default', name: '默认录音' }]
};

function loadSettings() {
    const saved = localStorage.getItem('yoyo_settings');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            appSettings = { ...appSettings, ...parsed };
            // Ensure voicePacks always has at least default
            if (!appSettings.voicePacks || !appSettings.voicePacks.length) {
                appSettings.voicePacks = [{ id: 'default', name: '默认录音' }];
            }
        } catch (e) { console.error('Failed to load settings', e); }
    }
}

function saveSettings() {
    // Read browser TTS settings if that tab is visible
    const voiceSelect = document.getElementById('voiceSelect');
    const voiceRate = document.getElementById('voiceRate');
    const voicePitch = document.getElementById('voicePitch');
    if (voiceSelect) appSettings.voiceURI = voiceSelect.value;
    if (voiceRate) appSettings.rate = parseFloat(voiceRate.value);
    if (voicePitch) appSettings.pitch = parseFloat(voicePitch.value);

    // Read online provider if visible
    const onlineSel = document.getElementById('onlineProviderSelect');
    if (onlineSel) appSettings.onlineProvider = onlineSel.value;

    // Read active voice pack
    const packSel = document.getElementById('activePackSelect');
    if (packSel) appSettings.activePackId = packSel.value;

    localStorage.setItem('yoyo_settings', JSON.stringify(appSettings));
    closeSettings();
    spawnEmoji('💾');
}

function openSettings() {
    document.getElementById('settingsModal').classList.remove('hidden');
    switchVoiceSourceTab(appSettings.voiceSource);
}

function closeSettings() {
    document.getElementById('settingsModal').classList.add('hidden');
}

function switchVoiceSourceTab(source) {
    appSettings.voiceSource = source;
    ['browser', 'online', 'custom'].forEach(s => {
        const tab = document.getElementById(`vsTab_${s}`);
        const panel = document.getElementById(`vsPanel_${s}`);
        if (tab) tab.classList.toggle('active', s === source);
        if (panel) panel.classList.toggle('hidden', s !== source);
    });
    if (source === 'browser') {
        initVoiceList();
        document.getElementById('voiceRate').value = appSettings.rate;
        document.getElementById('voicePitch').value = appSettings.pitch;
        document.getElementById('rateValue').textContent = appSettings.rate;
        document.getElementById('pitchValue').textContent = appSettings.pitch;
    } else if (source === 'online') {
        document.getElementById('onlineProviderSelect').value = appSettings.onlineProvider;
    } else if (source === 'custom') {
        renderVoicePackList();
    }
}

function initVoiceList() {
    if (!('speechSynthesis' in window)) return;
    const voices = window.speechSynthesis.getVoices();
    const select = document.getElementById('voiceSelect');
    if (!select) return;
    const current = select.value || appSettings.voiceURI;
    const zhVoices = voices.filter(v => v.lang.includes('zh') || v.lang.includes('CN') || v.lang.includes('HK') || v.lang.includes('TW'));
    select.innerHTML = zhVoices
        .map(v => `<option value="${v.voiceURI}" ${v.voiceURI === current ? 'selected' : ''}>${v.name} (${v.lang})</option>`)
        .join('') || '<option value="">无可用中文语音</option>';
    // Show install hint on iOS/Android when zh voice list is thin (no high-quality natural voices available)
    showVoiceInstallHint(zhVoices);
}

// Detect mobile / iOS user-agent and zh voice quality. Show install hint card when relevant.
function showVoiceInstallHint(zhVoices) {
    const hint = document.getElementById('voiceInstallHint');
    if (!hint) return;
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/.test(ua);
    if (!isIOS && !isAndroid) { hint.classList.add('hidden'); return; }
    // High-quality voices are Microsoft Natural / Google neural names. iOS only ships a couple.
    const HIGH_QUALITY = ['Xiaoxiao', 'Yunyang', 'Yunjian', 'Xiaoyi', 'Yunxi', 'Yunye', 'Yating', 'Tingting', 'Mei', 'Tracy', 'Hanhan', 'Lili', 'Huihui', 'Neural', 'Natural', 'Online'];
    const hasHighQuality = zhVoices.some(v => HIGH_QUALITY.some(n => v.name.includes(n)));
    if (hasHighQuality || zhVoices.length >= 3) {
        hint.classList.add('hidden');
    } else {
        hint.classList.remove('hidden');
    }
}

function testVoice() {
    const src = appSettings.voiceSource;
    if (src === 'browser') {
        const rate = parseFloat(document.getElementById('voiceRate').value);
        const pitch = parseFloat(document.getElementById('voicePitch').value);
        const voiceURI = document.getElementById('voiceSelect').value;
        if (!('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance("你好呀，我是 Yoyo 的语音助手！");
        u.lang = 'zh-CN'; u.rate = rate; u.pitch = pitch;
        const voices = window.speechSynthesis.getVoices();
        const selectedVoice = voices.find(v => v.voiceURI === voiceURI);
        if (selectedVoice) u.voice = selectedVoice;
        window.speechSynthesis.speak(u);
    } else if (src === 'online') {
        playOnlineVoice('你好');
    } else if (src === 'custom') {
        // play a recorded word from active pack, or fallback
        const packId = appSettings.activePackId;
        const testWord = Object.keys(audioCache).find(k => k.startsWith(`pack_${packId}::`));
        if (testWord) playAudioDataUrl(audioCache[testWord]);
        else { alert('当前语音包没有录音，请先录制一些词语'); }
    }
}

// ==================== Online TTS ====================
function getOnlineTtsUrl(word) {
    switch (appSettings.onlineProvider) {
        case 'baidu':
            return `https://fanyi.baidu.com/gettts?lan=zh&text=${encodeURIComponent(word)}&spd=5`;
        case 'youdao':
        default:
            return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=2`;
    }
}

function playOnlineVoice(word) {
    return new Promise((resolve, reject) => {
        const audio = new Audio(getOnlineTtsUrl(word));
        audio.onended = resolve;
        audio.onerror = (e) => { console.warn('Online TTS failed:', e); reject(e); };
        audio.play().catch(reject);
    });
}

// ==================== Voice Pack Management ====================
async function createVoicePack() {
    const name = prompt('请输入语音包名称（如：妈妈的声音）');
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    const id = 'pack_' + Date.now();
    // Persist to cloud first; only update local state on success
    const row = await dbAddVoicePack(id, trimmed);
    if (!row) {
        alert('❌ 创建语音包失败（云端未保存）。请检查 Supabase voice_packs 表是否已创建。');
        return;
    }
    appSettings.voicePacks.push({ id, name: trimmed });
    localStorage.setItem('yoyo_settings', JSON.stringify(appSettings));
    renderVoicePackList();
    spawnEmoji('🎉');
}

async function deleteVoicePack(packId) {
    if (packId === 'default') { alert('默认录音不能删除'); return; }
    if (!confirm('确定删除这个语音包及其所有录音吗？')) return;
    // Delete all recordings in this pack from IndexedDB
    try {
        const db = await AudioDB.open();
        const tx = db.transaction('audio', 'readwrite');
        const store = tx.objectStore('audio');
        const req = store.getAll();
        await new Promise((resolve) => {
            req.onsuccess = () => {
                const all = req.result || [];
                all.forEach(r => {
                    if (r.word && r.word.startsWith(`pack_${packId}::`)) {
                        store.delete(r.word);
                        delete audioCache[r.word];
                    }
                });
                resolve();
            };
            req.onerror = () => resolve();
        });
    } catch (e) { console.warn('IndexedDB delete failed:', e); }
    // Remove from packs list (local + cloud)
    await dbDelVoicePack(packId);
    appSettings.voicePacks = appSettings.voicePacks.filter(p => p.id !== packId);
    if (appSettings.activePackId === packId) appSettings.activePackId = 'default';
    localStorage.setItem('yoyo_settings', JSON.stringify(appSettings));
    renderVoicePackList();
    spawnEmoji('🗑️');
}

function renderVoicePackList() {
    const container = document.getElementById('voicePackList');
    const select = document.getElementById('activePackSelect');
    if (!container || !select) return;

    // Render pack cards
    container.innerHTML = appSettings.voicePacks.map(p => {
        const count = Object.keys(audioCache).filter(k => k.startsWith(`pack_${p.id}::`)).length;
        return `<div class="voice-pack-card">
            <div class="flex items-center gap-2 flex-1">
                <span class="text-lg">${p.id === appSettings.activePackId ? '🔊' : '🎤'}</span>
                <div>
                    <p class="font-bold text-sm text-gray-800">${p.name}</p>
                    <p class="text-xs text-gray-400">${count} 个录音</p>
                </div>
            </div>
            <div class="flex items-center gap-2">
                <button onclick="startVoicePackRecording('${p.id}')" class="btn-ghost text-xs" title="批量录音">🎙️ 录音</button>
                ${p.id !== 'default' ? `<button onclick="deleteVoicePack('${p.id}')" class="text-gray-300 hover:text-red-400 text-sm">🗑️</button>` : ''}
            </div>
        </div>`;
    }).join('');

    // Update active pack selector
    select.innerHTML = appSettings.voicePacks.map(p =>
        `<option value="${p.id}" ${p.id === appSettings.activePackId ? 'selected' : ''}>${p.name}</option>`
    ).join('');
}

async function startVoicePackRecording(packId) {
    // Get all words from all lessons
    const allLessons = await dbGetLessons();
    const allWords = [];
    allLessons.forEach(l => l.words.forEach(w => { if (!allWords.includes(w)) allWords.push(w); }));
    if (!allWords.length) { alert('词库为空，请先添加词语'); return; }

    // Close settings modal
    closeSettings();

    // Start batch recording for this pack
    const packName = (appSettings.voicePacks.find(p => p.id === packId) || {}).name || packId;
    batchRecState = {
        lesson: { name: `语音包: ${packName}`, words: allWords },
        index: 0,
        overlay: null,
        packId: packId // track which pack we're recording for
    };
    showBatchRecWord();
}

// Slider listeners
document.addEventListener('input', (e) => {
    if (e.target.id === 'voiceRate') document.getElementById('rateValue').textContent = e.target.value;
    if (e.target.id === 'voicePitch') document.getElementById('pitchValue').textContent = e.target.value;
});

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ==================== IndexedDB Audio Storage ====================
const AudioDB = {
    _db: null,
    async open() {
        if (this._db) return this._db;
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('WordAppAudio', 1);
            req.onupgradeneeded = () => req.result.createObjectStore('audio', { keyPath: 'word' });
            req.onsuccess = () => { this._db = req.result; resolve(this._db); };
            req.onerror = () => reject(req.error);
        });
    },
    async save(word, dataUrl, packId) {
        const key = packId ? `pack_${packId}::${word}` : word;
        // 1. Save to local IndexedDB (always)
        try {
            const db = await this.open();
            await new Promise((resolve, reject) => {
                const tx = db.transaction('audio', 'readwrite');
                tx.objectStore('audio').put({ word: key, dataUrl, ts: Date.now() });
                tx.oncomplete = () => { audioCache[key] = dataUrl; resolve(); };
                tx.onerror = () => reject(tx.error);
            });
        } catch (e) { console.warn('IndexedDB save failed:', e); }

        // 2. Upload to Supabase Storage (if logged in). Surface failures so user knows
        //    recordings won't survive a device switch — don't silently lose data.
        if (!currentUserId || typeof sb === 'undefined') {
            alert('⚠️ 未登录，录音只保存在本地浏览器。换设备/清缓存后会丢失。请先登录。');
            return;
        }
        const storagePath = `${currentUserId}/${packId || 'default'}/${encodeURIComponent(word)}.webm`;
        try {
            // Convert dataUrl to Blob
            const resp = await fetch(dataUrl);
            const blob = await resp.blob();
            const { error: uploadError } = await sb.storage
                .from('voice-recordings')
                .upload(storagePath, blob, { contentType: 'audio/webm', upsert: true });
            if (uploadError) throw uploadError;
            // Save metadata to DB
            const { data: urlData } = sb.storage.from('voice-recordings').getPublicUrl(storagePath);
            await sb.from('voice_recordings').upsert({
                user_id: currentUserId,
                word,
                pack_id: packId || 'default',
                storage_path: storagePath,
                storage_url: urlData?.publicUrl || '',
            }, { onConflict: 'user_id,word,pack_id' });
        } catch (e) {
            console.warn('Cloud audio save failed (saved locally):', e);
            alert('⚠️ 录音上传云端失败，仅保存在本地。可能原因：\n• Storage bucket "voice-recordings" 未创建\n• voice_recordings 表不存在\n请检查 Supabase 控制台。');
        }
    },
    async get(word, packId) {
        const key = packId ? `pack_${packId}::${word}` : word;
        if (audioCache[key]) return audioCache[key];
        // Try IndexedDB
        try {
            const db = await this.open();
            const local = await new Promise((resolve) => {
                const tx = db.transaction('audio', 'readonly');
                const req = tx.objectStore('audio').get(key);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            });
            if (local) { audioCache[key] = local.dataUrl; return local.dataUrl; }
        } catch (e) { /* ignore */ }
        // Try Supabase DB (fetch public URL and cache as dataUrl)
        if (!currentUserId || typeof sb === 'undefined') return null;
        try {
            const { data } = await sb
                .from('voice_recordings')
                .select('storage_path')
                .eq('user_id', currentUserId)
                .eq('word', word)
                .eq('pack_id', packId || 'default')
                .single();
            if (data?.storage_path) {
                const { data: urlData } = sb.storage.from('voice-recordings').getPublicUrl(data.storage_path);
                if (urlData?.publicUrl) {
                    audioCache[key] = urlData.publicUrl;
                    return urlData.publicUrl;
                }
            }
        } catch (e) { /* ignore */ }
        return null;
    },
    async delete(word, packId) {
        const key = packId ? `pack_${packId}::${word}` : word;
        // Remove from IndexedDB
        try {
            const db = await this.open();
            await new Promise((resolve) => {
                const tx = db.transaction('audio', 'readwrite');
                tx.objectStore('audio').delete(key);
                tx.oncomplete = () => { delete audioCache[key]; resolve(); };
            });
        } catch (e) { /* ignore */ }
        // Delete from Supabase
        if (!currentUserId || typeof sb === 'undefined') return;
        try {
            const storagePath = `${currentUserId}/${packId || 'default'}/${encodeURIComponent(word)}.webm`;
            await sb.storage.from('voice-recordings').remove([storagePath]);
            await sb.from('voice_recordings')
                .delete()
                .eq('user_id', currentUserId)
                .eq('word', word)
                .eq('pack_id', packId || 'default');
        } catch (e) { console.warn('Cloud audio delete failed:', e); }
    },
    async loadAll() {
        // Load local IndexedDB
        try {
            const db = await this.open();
            await new Promise((resolve) => {
                const tx = db.transaction('audio', 'readonly');
                const req = tx.objectStore('audio').getAll();
                req.onsuccess = () => { (req.result || []).forEach(r => { audioCache[r.word] = r.dataUrl; }); resolve(); };
                req.onerror = () => resolve();
            });
        } catch (e) { /* ignore */ }
    },
    // Load all cloud recordings for current user and populate cache
    async loadAllFromCloud() {
        if (!currentUserId || typeof sb === 'undefined') return;
        try {
            const { data } = await sb
                .from('voice_recordings')
                .select('word, pack_id, storage_url')
                .eq('user_id', currentUserId);
            if (!data) return;
            for (const rec of data) {
                const key = rec.pack_id ? `pack_${rec.pack_id}::${rec.word}` : rec.word;
                if (!audioCache[key] && rec.storage_url) {
                    audioCache[key] = rec.storage_url;
                }
            }
        } catch (e) { console.warn('loadAllFromCloud failed:', e); }
    }
};

// ==================== Recording Helpers ====================
function recordAudioClip() {
    return new Promise(async (resolve, reject) => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
            const chunks = [];
            recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
            recorder.onstop = () => {
                stream.getTracks().forEach(t => t.stop());
                const blob = new Blob(chunks, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(blob);
            };
            recorder.onerror = e => { stream.getTracks().forEach(t => t.stop()); reject(e); };
            activeRecorder = recorder;
            recorder.start();
        } catch (e) { reject(e); }
    });
}

function stopRecording() {
    if (activeRecorder && activeRecorder.state === 'recording') {
        activeRecorder.stop();
        activeRecorder = null;
    }
}

function playAudioDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
        const audio = new Audio(dataUrl);
        audio.onended = resolve;
        audio.onerror = reject;
        audio.play().catch(reject);
    });
}

async function toggleWordRecording(word, btn) {
    if (activeRecorder && activeRecorder.state === 'recording') {
        stopRecording();
        return;
    }
    btn.classList.remove('rec-btn-mic', 'rec-btn-has');
    btn.classList.add('rec-btn-recording');
    btn.textContent = '⏹';
    const dataPromise = recordAudioClip();
    // Auto-stop after 4 seconds
    const timeout = setTimeout(() => stopRecording(), 4000);
    try {
        const dataUrl = await dataPromise;
        clearTimeout(timeout);
        await AudioDB.save(word, dataUrl, appSettings.activePackId);
        btn.classList.remove('rec-btn-recording');
        btn.classList.add('rec-btn-has');
        btn.textContent = '🔊';
        btn.title = '有录音 · 点击试听 · 长按重录';
    } catch (e) {
        clearTimeout(timeout);
        btn.classList.remove('rec-btn-recording');
        btn.classList.add('rec-btn-mic');
        btn.textContent = '🎤';
        console.error('Recording failed:', e);
    }
}

async function playOrRecordWord(word, btn) {
    // Try active voice pack first, then legacy recording
    const packAudio = await AudioDB.get(word, appSettings.activePackId);
    if (packAudio) {
        playAudioDataUrl(packAudio);
        return;
    }
    const existing = await AudioDB.get(word);
    if (existing) {
        playAudioDataUrl(existing);
    } else {
        // Fallback to TTS/online voice
        speakWord(word);
        spawnEmoji('🔊');
    }
}
async function startRecordingFromLibrary(word, btn) {
    toggleWordRecording(word, btn);
}

// ==================== Batch Recording ====================
let batchRecState = null;

async function startBatchRecording(lesson) {
    if (!lesson.words.length) return;
    batchRecState = { lesson, index: 0, overlay: null };
    showBatchRecWord();
}

function showBatchRecWord() {
    if (!batchRecState) return;
    const { lesson, index, packId } = batchRecState;
    if (index >= lesson.words.length) { closeBatchRec(); spawnEmoji('🎉'); return; }
    const word = lesson.words[index];
    const pinyin = pinyinPro.pinyin(word, { toneType: 'symbol', type: 'string' });
    // Check audio: if recording for a pack, check pack key; otherwise legacy key
    const audioKey = packId ? `pack_${packId}::${word}` : word;
    const hasAudio = !!audioCache[audioKey];

    let overlay = batchRecState.overlay;
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'batch-rec-overlay';
        document.body.appendChild(overlay);
        batchRecState.overlay = overlay;
    }
    overlay.innerHTML = `
        <div class="batch-rec-card">
            <p class="text-gray-400 text-sm font-bold">🎙️ 录音模式 · ${lesson.name}</p>
            <div class="batch-rec-word">${word}</div>
            <div class="batch-rec-pinyin">${pinyin}</div>
            <div class="flex items-center justify-center gap-4 mb-3">
                <button id="batchRecBtn" class="rec-big-btn" title="点击录音">${hasAudio ? '🔊' : '🎤'}</button>
            </div>
            <div class="flex items-center justify-center gap-3">
                ${hasAudio ? '<button id="batchPlayBtn" class="btn-ghost text-sm">▶️ 试听</button><button id="batchDelBtn" class="btn-ghost text-sm text-red-400">🗑️ 删除录音</button>' : ''}
            </div>
            <div class="flex items-center justify-center gap-3 mt-4">
                <button id="batchPrevBtn" class="btn-secondary" style="padding:.5rem 1.2rem;font-size:.85rem" ${index === 0 ? 'disabled style="opacity:.4;padding:.5rem 1.2rem;font-size:.85rem"' : ''}>⬅️ 上一个</button>
                <button id="batchSkipBtn" class="btn-primary" style="padding:.5rem 1.2rem;font-size:.85rem">${index < lesson.words.length - 1 ? '下一个 ➡️' : '✅ 完成'}</button>
            </div>
            <div class="batch-rec-progress">第 ${index + 1} / ${lesson.words.length} 个</div>
            <button id="batchCloseBtn" class="btn-ghost text-xs mt-2">退出录音模式</button>
        </div>
    `;
    document.getElementById('batchRecBtn').onclick = async function () {
        if (activeRecorder && activeRecorder.state === 'recording') {
            stopRecording(); return;
        }
        this.classList.add('recording');
        this.textContent = '⏹';
        const p = recordAudioClip();
        const t = setTimeout(() => stopRecording(), 4000);
        try {
            const dataUrl = await p;
            clearTimeout(t);
            await AudioDB.save(word, dataUrl, packId || undefined);
            this.classList.remove('recording');
            this.textContent = '🔊';
            showBatchRecWord(); // refresh to show play/delete buttons
        } catch (e) {
            clearTimeout(t);
            this.classList.remove('recording');
            this.textContent = '🎤';
        }
    };
    if (document.getElementById('batchPlayBtn')) {
        document.getElementById('batchPlayBtn').onclick = () => { if (audioCache[audioKey]) playAudioDataUrl(audioCache[audioKey]); };
    }
    if (document.getElementById('batchDelBtn')) {
        document.getElementById('batchDelBtn').onclick = async () => { await AudioDB.delete(word, packId || undefined); showBatchRecWord(); };
    }
    document.getElementById('batchSkipBtn').onclick = () => { batchRecState.index++; showBatchRecWord(); };
    document.getElementById('batchPrevBtn')?.addEventListener('click', () => { if (batchRecState.index > 0) { batchRecState.index--; showBatchRecWord(); } });
    document.getElementById('batchCloseBtn').onclick = closeBatchRec;
}

function closeBatchRec() {
    if (activeRecorder && activeRecorder.state === 'recording') stopRecording();
    if (batchRecState?.overlay) { batchRecState.overlay.remove(); }
    batchRecState = null;
}

// ==================== Helpers ====================
function groupByUnit(lessonList) {
    const map = {};
    lessonList.forEach(l => {
        const u = l.unit || DEFAULT_UNIT;
        if (!map[u]) map[u] = [];
        map[u].push(l);
    });
    return map;
}

function groupByTextbook(lessonList) {
    const map = {};
    lessonList.forEach(l => {
        const t = l.textbook || DEFAULT_TEXTBOOK;
        if (!map[t]) map[t] = [];
        map[t].push(l);
    });
    return map;
}

function groupByTextbookAndUnit(lessonList) {
    const map = {};
    lessonList.forEach(l => {
        const t = l.textbook || DEFAULT_TEXTBOOK;
        const u = l.unit || DEFAULT_UNIT;
        if (!map[t]) map[t] = {};
        if (!map[t][u]) map[t][u] = [];
        map[t][u].push(l);
    });
    return map;
}

async function generateDictationPDF() {
    if (!currentWords || !currentWords.length) return;
    spawnEmoji('⏳'); // loading emoji

    // Create hidden print container
    const printDiv = document.createElement('div');
    printDiv.id = 'printTemplate';

    // Header
    const dateStr = new Date().toLocaleDateString('zh-CN');
    const header = document.createElement('div');
    header.className = 'print-header';
    header.textContent = `词语默写挑战 (${dateStr})`;
    printDiv.appendChild(header);

    // Grid
    const grid = document.createElement('div');
    grid.className = 'print-grid';

    currentWords.forEach(item => {
        const wordBox = document.createElement('div');
        wordBox.className = 'print-word-box';

        // Pinyin
        const pinyinElem = document.createElement('div');
        pinyinElem.className = 'print-pinyin';
        pinyinElem.textContent = pinyinPro.pinyin(item.word, { toneType: 'symbol' });

        // Empty boxes for each char
        const charsElem = document.createElement('div');
        charsElem.className = 'print-chars';
        for (let i = 0; i < item.word.length; i++) {
            const box = document.createElement('div');
            box.className = 'print-char-box';
            charsElem.appendChild(box);
        }

        wordBox.appendChild(pinyinElem);
        wordBox.appendChild(charsElem);
        grid.appendChild(wordBox);
    });

    printDiv.appendChild(grid);
    document.body.appendChild(printDiv);

    // Generate PDF
    const opt = {
        margin: 10,
        filename: `默写纸_${dateStr}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    try {
        await html2pdf().set(opt).from(printDiv).save();
    } catch (e) {
        console.error('PDF export failed', e);
        alert('生成 PDF 失败，请稍后重试');
    } finally {
        // Cleanup DOM and finish dictation to go to mistakes view
        document.body.removeChild(printDiv);
        finishDictation();
    }
}

// ==================== Init ====================
async function init() {
    // Load audio cache
    try { await AudioDB.loadAll(); } catch (e) { console.error('AudioDB init failed', e); }
    loadSettings();

    // Check existing session
    const { data } = await sb.auth.getSession();
    session = data.session;
    if (session?.user) {
        currentUserId = session.user.id;
        showMainApp();
    }
    // else: auth page is shown by default
    if ('speechSynthesis' in window) {
        window.speechSynthesis.onvoiceschanged = () => {
            initVoiceList();
        };
        initVoiceList();
    }
}
init();

// ==================== Tabs ====================
function switchTab(tab) {
    document.getElementById('pageLibrary').classList.toggle('hidden', tab !== 'library');
    document.getElementById('pageDictation').classList.toggle('hidden', tab !== 'dictation');
    document.getElementById('pageHistory').classList.toggle('hidden', tab !== 'history');
    document.getElementById('pageRecords').classList.toggle('hidden', tab !== 'records');
    document.getElementById('tabLibrary').classList.toggle('active', tab === 'library');
    document.getElementById('tabDictation').classList.toggle('active', tab === 'dictation');
    document.getElementById('tabHistory').classList.toggle('active', tab === 'history');
    document.getElementById('tabRecords').classList.toggle('active', tab === 'records');
    if (tab === 'library') renderLibrary();
    if (tab === 'dictation') {
        renderLessonSelection();
        document.getElementById('selectLessonView').classList.remove('hidden');
        document.getElementById('dictationView').classList.add('hidden');
        document.getElementById('completeView').classList.add('hidden');
    }
    if (tab === 'history') renderHistory();
    if (tab === 'records') renderRecords();
}

// ==================== Common Text → Textbooks Parser ====================
function parseTextToUnits(fullText, manualName) {
    const lines = fullText.split(/\n/);
    const textbookPattern = /^(人教版|部编版|苏教版|北师大版)?\s*[一二三四五六七八九十]年级\s*[上下]册[：:\s]*(.*)/;
    const textbookLabelPattern = /^课本[：:]\s*(.+)/;
    const unitPattern = /^第\s*[一二三四五六七八九十百千\d]+\s*单元[：:\s]*(.*)/;
    const lessonPattern = /^(\d+)\s*[.、．·]?\s*(.+)/;
    let textbooks = [], curTextbook = null, curUnit = null, curLesson = null;
    const ensureTb = () => { if (!curTextbook) curTextbook = { name: DEFAULT_TEXTBOOK, units: [] }; return curTextbook; };
    const ensureU = () => { const tb = ensureTb(); if (!curUnit) curUnit = { name: DEFAULT_UNIT, lessons: [] }; return { textbook: tb, unit: curUnit }; };
    for (const line of lines) {
        const trimmed = line.trim(); if (!trimmed) continue;
        const tbInlineMatch = trimmed.match(textbookPattern);
        const tbLabelMatch = trimmed.match(textbookLabelPattern);
        if (tbInlineMatch || tbLabelMatch) {
            if (curLesson && curUnit) curUnit.lessons.push(curLesson);
            if (curUnit && curTextbook) curTextbook.units.push(curUnit);
            if (curTextbook) textbooks.push(curTextbook);
            const name = tbInlineMatch ? trimmed.replace(/[：:]\s*$/, '').trim() : tbLabelMatch[1].trim();
            curTextbook = { name, units: [] };
            curUnit = null; curLesson = null; continue;
        }
        const unitMatch = trimmed.match(unitPattern);
        if (unitMatch) {
            if (curLesson && curUnit) curUnit.lessons.push(curLesson);
            if (curUnit) ensureTb().units.push(curUnit);
            curUnit = { name: trimmed.replace(/[：:]\s*$/, '').trim(), lessons: [] };
            curLesson = null; continue;
        }
        const lessonMatch = trimmed.match(lessonPattern);
        if (lessonMatch) {
            const rest = lessonMatch[2].trim();
            const isExercise = /[：:_—]/.test(rest) || rest.replace(/[^\u4e00-\u9fa5]/g, '').length < 3;
            if (!isExercise) {
                const { unit } = ensureU();
                if (curLesson) unit.lessons.push(curLesson);
                curLesson = { name: `${lessonMatch[1]} ${rest}`, words: [] }; continue;
            }
        }
        const { unit } = ensureU();
        if (curLesson) {
            const words = trimmed.match(/[\u4e00-\u9fa5]{2,}/g) || [];
            words.forEach(w => { if (!curLesson.words.includes(w)) curLesson.words.push(w); });
        }
    }
    if (curLesson && curUnit) curUnit.lessons.push(curLesson);
    if (curUnit && curTextbook) curTextbook.units.push(curUnit);
    if (curTextbook) textbooks.push(curTextbook);
    textbooks = textbooks.map(t => ({
        name: t.name,
        units: t.units.map(u => ({ name: u.name, lessons: u.lessons.filter(l => l.words.length > 0) })).filter(u => u.lessons.length > 0)
    })).filter(t => t.units.length > 0);

    if (!manualName && textbooks.length > 0) {
        return { textbooks, mode: 'structured' };
    } else {
        const all = fullText.match(/[\u4e00-\u9fa5]{2,}/g) || [];
        const unique = [...new Set(all)];
        if (!unique.length) return { textbooks: [], mode: 'empty' };
        return {
            textbooks: [{ name: DEFAULT_TEXTBOOK, units: [{ name: DEFAULT_UNIT, lessons: [{ name: manualName || '未命名课文', words: unique }] }] }],
            mode: 'flat'
        };
    }
}

// ==================== File Upload Dispatcher ====================
document.getElementById('pdfInput').addEventListener('change', async function (e) {
    const file = e.target.files[0]; if (!file) return;
    const statusEl = document.getElementById('uploadStatus');
    statusEl.classList.remove('hidden');

    const ext = file.name.split('.').pop().toLowerCase();
    try {
        if (ext === 'pdf') {
            await parsePdfFile(file, statusEl);
        } else if (ext === 'docx' || ext === 'doc') {
            await parseDocxFile(file, statusEl);
        } else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
            await parseImageFile(file, statusEl);
        } else if (ext === 'json') {
            await parseJsonFile(file, statusEl);
        } else {
            statusEl.textContent = '❌ 不支持的文件格式';
            return;
        }
    } catch (err) {
        statusEl.textContent = '❌ 解析失败：' + err.message;
    }
});

// ==================== PDF Parser ====================
async function parsePdfFile(file, statusEl) {
    statusEl.textContent = '🔄 正在解析 PDF...';
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        fullText += content.items.map(it => it.str).join(' ') + '\n';
    }
    const manualName = document.getElementById('lessonName').value.trim();
    const result = parseTextToUnits(fullText, manualName);
    applyParseResult(result, statusEl);
}

// ==================== Word (DOCX) Parser ====================
async function parseDocxFile(file, statusEl) {
    statusEl.textContent = '🔄 正在解析 Word 文档...';
    const buf = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    const fullText = result.value;
    if (!fullText || !fullText.trim()) {
        statusEl.textContent = '😢 Word 文档中没有找到文本内容';
        document.getElementById('previewArea').classList.add('hidden');
        return;
    }
    const manualName = document.getElementById('lessonName').value.trim();
    const parsed = parseTextToUnits(fullText, manualName);
    applyParseResult(parsed, statusEl);
}

// ==================== Image (OCR) Parser ====================
async function parseImageFile(file, statusEl) {
    statusEl.textContent = '🔄 正在识别图片文字（首次使用需下载语言包，请稍等）...';
    const worker = await Tesseract.createWorker('chi_sim', 1, {
        logger: m => {
            if (m.status === 'recognizing text') {
                const pct = Math.round(m.progress * 100);
                statusEl.textContent = `🔄 正在识别图片文字... ${pct}%`;
            }
        }
    });
    const { data: { text } } = await worker.recognize(file);
    await worker.terminate();
    if (!text || !text.trim()) {
        statusEl.textContent = '😢 图片中没有识别到文字';
        document.getElementById('previewArea').classList.add('hidden');
        return;
    }
    const manualName = document.getElementById('lessonName').value.trim();
    const parsed = parseTextToUnits(text, manualName);
    applyParseResult(parsed, statusEl);
}

// ==================== JSON Parser ====================
async function parseJsonFile(file, statusEl) {
    statusEl.textContent = '🔄 正在解析 JSON 文件...';
    const text = await file.text();
    let json;
    try { json = JSON.parse(text); } catch (e) { statusEl.textContent = '❌ JSON 格式错误：' + e.message; return; }

    let textbooks = [];

    // Format A (new): [{textbook, units: [{unit, lessons: [...]}]}]
    if (Array.isArray(json) && json.length > 0 && json[0].textbook && json[0].units) {
        for (const t of json) {
            const tbUnits = (t.units || []).map(u => ({
                name: u.unit || DEFAULT_UNIT,
                lessons: (u.lessons || []).map(l => ({ name: l.name || '未命名课文', words: Array.isArray(l.words) ? [...l.words] : [] })).filter(l => l.words.length > 0)
            })).filter(u => u.lessons.length > 0);
            if (tbUnits.length) textbooks.push({ name: t.textbook || DEFAULT_TEXTBOOK, units: tbUnits });
        }
    }
    // Format A (legacy): [{unit, lessons: [{name, words}]}] — wrap under 默认课本
    else if (Array.isArray(json) && json.length > 0 && json[0].unit && json[0].lessons) {
        const tbUnits = [];
        for (const u of json) {
            const unitLessons = (u.lessons || []).map(l => ({ name: l.name || '未命名课文', words: Array.isArray(l.words) ? [...l.words] : [] })).filter(l => l.words.length > 0);
            if (unitLessons.length) tbUnits.push({ name: u.unit || DEFAULT_UNIT, lessons: unitLessons });
        }
        if (tbUnits.length) textbooks = [{ name: DEFAULT_TEXTBOOK, units: tbUnits }];
    }
    // Format B: {"课文名": ["词1", "词2"]}
    else if (!Array.isArray(json) && typeof json === 'object') {
        const lessons = [];
        for (const key in json) {
            if (Array.isArray(json[key])) {
                const words = json[key].filter(w => typeof w === 'string' && w.trim());
                if (words.length) lessons.push({ name: key, words });
            }
        }
        if (lessons.length) textbooks = [{ name: DEFAULT_TEXTBOOK, units: [{ name: DEFAULT_UNIT, lessons }] }];
    }
    // Format C: ["词1", "词2", "词3"]
    else if (Array.isArray(json) && json.length > 0 && typeof json[0] === 'string') {
        const words = json.filter(w => typeof w === 'string' && w.trim());
        const manualName = document.getElementById('lessonName').value.trim();
        if (words.length) textbooks = [{ name: DEFAULT_TEXTBOOK, units: [{ name: DEFAULT_UNIT, lessons: [{ name: manualName || '未命名课文', words }] }] }];
    }

    if (!textbooks.length) {
        statusEl.textContent = '😢 JSON 中没有发现可导入的词语';
        document.getElementById('previewArea').classList.add('hidden');
        return;
    }
    pendingTextbooks = textbooks;
    const totalL = textbooks.reduce((s, t) => s + t.units.reduce((s2, u) => s2 + u.lessons.length, 0), 0);
    const totalW = textbooks.reduce((s, t) => s + t.units.reduce((s2, u) => s2 + u.lessons.reduce((s3, l) => s3 + l.words.length, 0), 0), 0);
    statusEl.textContent = `✅ 识别了 ${textbooks.length} 本课本, ${totalL} 课, ${totalW} 个词语！`;
    renderMultiPreview();
}

// ==================== Apply Parse Result Helper ====================
function applyParseResult(result, statusEl) {
    if (result.mode === 'empty') {
        statusEl.textContent = '😢 没有发现词语';
        document.getElementById('previewArea').classList.add('hidden');
        return;
    }
    pendingTextbooks = result.textbooks;
    if (result.mode === 'structured') {
        const totalL = result.textbooks.reduce((s, t) => s + t.units.reduce((s2, u) => s2 + u.lessons.length, 0), 0);
        const totalW = result.textbooks.reduce((s, t) => s + t.units.reduce((s2, u) => s2 + u.lessons.reduce((s3, l) => s3 + l.words.length, 0), 0), 0);
        statusEl.textContent = `✅ 识别了 ${result.textbooks.length} 本课本, ${totalL} 课, ${totalW} 个词语！`;
    } else {
        const count = result.textbooks[0].units[0].lessons[0].words.length;
        statusEl.textContent = `✅ 找到了 ${count} 个词语！`;
    }
    renderMultiPreview();
}

// ==================== Interactive Preview ====================
function renderMultiPreview() {
    const container = document.getElementById('previewContent');
    container.innerHTML = '';
    const totalL = pendingTextbooks.reduce((s, t) => s + t.units.reduce((s2, u) => s2 + u.lessons.length, 0), 0);
    const totalW = pendingTextbooks.reduce((s, t) => s + t.units.reduce((s2, u) => s2 + u.lessons.reduce((s3, l) => s3 + l.words.length, 0), 0), 0);
    const summary = document.createElement('div');
    summary.className = 'flex items-center justify-between mb-3';
    summary.innerHTML = `<p class="text-sm font-bold text-gray-600">🔍 ${pendingTextbooks.length} 本课本, ${totalL} 课, ${totalW} 个词语</p><p class="text-xs text-gray-400">💡 可编辑名称 · 拖拽词语到其他课文</p>`;
    container.appendChild(summary);

    pendingTextbooks.forEach((tb, ti) => {
        const tbCard = document.createElement('div'); tbCard.className = 'unit-card mb-4'; tbCard.style.borderColor = '#FED7AA'; tbCard.style.background = '#FFFBEB';
        const tbHeader = document.createElement('div'); tbHeader.className = 'flex items-center gap-2 mb-2';
        tbHeader.innerHTML = '<span class="text-lg">📚</span>';
        const tbInput = document.createElement('input'); tbInput.type = 'text'; tbInput.value = tb.name;
        tbInput.className = 'unit-name-input'; tbInput.style.width = Math.max(120, tb.name.length * 17) + 'px';
        tbInput.addEventListener('input', () => { tb.name = tbInput.value; tbInput.style.width = Math.max(120, tbInput.value.length * 17) + 'px'; });
        const tbStats = document.createElement('span'); tbStats.className = 'preview-stats'; tbStats.textContent = `${tb.units.length} 单元`;
        const tbDelBtn = document.createElement('button'); tbDelBtn.className = 'text-gray-300 hover:text-red-400 text-sm ml-auto cursor-pointer'; tbDelBtn.textContent = '🗑️';
        tbDelBtn.onclick = () => { pendingTextbooks.splice(ti, 1); if (!pendingTextbooks.length) document.getElementById('previewArea').classList.add('hidden'); renderMultiPreview(); };
        tbHeader.appendChild(tbInput); tbHeader.appendChild(tbStats); tbHeader.appendChild(tbDelBtn);
        tbCard.appendChild(tbHeader);

        tb.units.forEach((unit, ui) => {
            const unitCard = document.createElement('div'); unitCard.className = 'unit-card mb-3 ml-3';
            const unitHeader = document.createElement('div'); unitHeader.className = 'flex items-center gap-2 mb-2';
            unitHeader.innerHTML = '<span class="text-lg">📦</span>';
            const unitInput = document.createElement('input'); unitInput.type = 'text'; unitInput.value = unit.name;
            unitInput.className = 'unit-name-input'; unitInput.style.width = Math.max(120, unit.name.length * 16) + 'px';
            unitInput.addEventListener('input', () => { unit.name = unitInput.value; unitInput.style.width = Math.max(120, unitInput.value.length * 16) + 'px'; });
            const unitStats = document.createElement('span'); unitStats.className = 'preview-stats'; unitStats.textContent = `${unit.lessons.length} 课`;
            const unitDelBtn = document.createElement('button'); unitDelBtn.className = 'text-gray-300 hover:text-red-400 text-sm ml-auto cursor-pointer'; unitDelBtn.textContent = '🗑️';
            unitDelBtn.onclick = () => { tb.units.splice(ui, 1); if (!tb.units.length) pendingTextbooks.splice(ti, 1); if (!pendingTextbooks.length) document.getElementById('previewArea').classList.add('hidden'); renderMultiPreview(); };
            unitHeader.appendChild(unitInput); unitHeader.appendChild(unitStats); unitHeader.appendChild(unitDelBtn);
            unitCard.appendChild(unitHeader);

            unit.lessons.forEach((lesson, li) => {
                const lessonCard = document.createElement('div'); lessonCard.className = 'preview-lesson mb-2 ml-4';
                lessonCard.addEventListener('dragover', (e) => { e.preventDefault(); lessonCard.classList.add('drag-over'); });
                lessonCard.addEventListener('dragleave', () => lessonCard.classList.remove('drag-over'));
                lessonCard.addEventListener('drop', (e) => {
                    e.preventDefault(); lessonCard.classList.remove('drag-over');
                    if (!dragData) return;
                    if (dragData.tbIdx === ti && dragData.unitIdx === ui && dragData.lessonIdx === li) return;
                    const word = dragData.word;
                    const srcTb = pendingTextbooks[dragData.tbIdx];
                    if (srcTb) {
                        const srcUnit = srcTb.units[dragData.unitIdx];
                        if (srcUnit) {
                            const srcLesson = srcUnit.lessons[dragData.lessonIdx];
                            if (srcLesson) {
                                srcLesson.words.splice(dragData.wordIdx, 1);
                                if (!srcLesson.words.length) {
                                    srcUnit.lessons.splice(dragData.lessonIdx, 1);
                                    if (!srcUnit.lessons.length) srcTb.units.splice(dragData.unitIdx, 1);
                                }
                                if (!srcTb.units.length) pendingTextbooks.splice(dragData.tbIdx, 1);
                            }
                        }
                    }
                    if (!lesson.words.includes(word)) lesson.words.push(word);
                    dragData = null; renderMultiPreview();
                });
                const lDelBtn = document.createElement('button'); lDelBtn.className = 'preview-delete-btn'; lDelBtn.textContent = '🗑️';
                lDelBtn.onclick = () => { unit.lessons.splice(li, 1); if (!unit.lessons.length) { tb.units.splice(ui, 1); if (!tb.units.length) pendingTextbooks.splice(ti, 1); } if (!pendingTextbooks.length) document.getElementById('previewArea').classList.add('hidden'); renderMultiPreview(); };
                const lHeader = document.createElement('div'); lHeader.className = 'flex items-center gap-2 mb-2';
                lHeader.innerHTML = '<span class="text-base">📗</span>';
                const lInput = document.createElement('input'); lInput.type = 'text'; lInput.value = lesson.name;
                lInput.className = 'lesson-name-input'; lInput.style.width = Math.max(100, lesson.name.length * 15) + 'px';
                lInput.addEventListener('input', () => { lesson.name = lInput.value; lInput.style.width = Math.max(100, lInput.value.length * 15) + 'px'; });
                const lStats = document.createElement('span'); lStats.className = 'preview-stats'; lStats.textContent = `${lesson.words.length} 词`;
                lHeader.appendChild(lInput); lHeader.appendChild(lStats);
                const wordsDiv = document.createElement('div'); wordsDiv.className = 'flex flex-wrap gap-1.5';
                lesson.words.forEach((w, wi) => {
                    const tag = document.createElement('div'); tag.className = 'word-tag text-xs drag-word'; tag.draggable = true;
                    tag.innerHTML = `<span>${w}</span>`;
                    const delW = document.createElement('button'); delW.className = 'text-gray-300 hover:text-red-400 ml-0.5 text-xs'; delW.textContent = '✕';
                    delW.onclick = (e) => {
                        e.stopPropagation();
                        lesson.words.splice(wi, 1);
                        if (!lesson.words.length) { unit.lessons.splice(li, 1); if (!unit.lessons.length) { tb.units.splice(ui, 1); if (!tb.units.length) pendingTextbooks.splice(ti, 1); } }
                        if (!pendingTextbooks.length) document.getElementById('previewArea').classList.add('hidden');
                        renderMultiPreview();
                    };
                    tag.appendChild(delW);
                    tag.addEventListener('dragstart', (e) => { dragData = { tbIdx: ti, unitIdx: ui, lessonIdx: li, wordIdx: wi, word: w }; tag.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', w); });
                    tag.addEventListener('dragend', () => { tag.classList.remove('dragging'); dragData = null; });
                    wordsDiv.appendChild(tag);
                });
                lessonCard.appendChild(lDelBtn); lessonCard.appendChild(lHeader); lessonCard.appendChild(wordsDiv);
                unitCard.appendChild(lessonCard);
            });
            tbCard.appendChild(unitCard);
        });
        container.appendChild(tbCard);
    });
    document.getElementById('previewArea').classList.remove('hidden');
}

async function confirmImport() {
    if (!pendingTextbooks.length) return;
    for (const t of pendingTextbooks) {
        if (!t.name.trim()) { alert('🌸 有课本名称为空，请填写！'); return; }
        for (const u of t.units) {
            if (!u.name.trim()) { alert('🌸 有单元名称为空，请填写！'); return; }
            for (const l of u.lessons) { if (!l.name.trim()) { alert('🌸 有课文名称为空，请填写！'); return; } }
        }
    }
    for (const t of pendingTextbooks) {
        const tbName = t.name.trim();
        // Ensure textbook exists in the table
        if (!textbooks.find(x => x.name === tbName)) {
            const inserted = await dbAddTextbook(tbName);
            if (inserted) textbooks.push(inserted);
            else {
                // Conflict (race) — re-fetch the row
                textbooks = await dbGetTextbooks();
            }
        }
        for (const u of t.units) {
            for (const l of u.lessons) {
                const name = l.name.trim(), unitName = u.name.trim();
                let existing = lessons.find(x => x.name === name && x.unit === unitName && (x.textbook || DEFAULT_TEXTBOOK) === tbName);
                if (existing) {
                    const set = new Set(existing.words); l.words.forEach(w => set.add(w)); existing.words = [...set];
                    await dbPutLesson(existing);
                } else {
                    await dbAddLesson({ name, textbook: tbName, unit: unitName, words: l.words });
                }
            }
        }
    }
    lessons = await dbGetLessons(); renderLibrary();
    pendingTextbooks = [];
    document.getElementById('previewArea').classList.add('hidden');
    document.getElementById('uploadStatus').textContent = '🎉 导入成功！';
    document.getElementById('pdfInput').value = '';
    document.getElementById('lessonName').value = '';
    spawnEmoji('🌈');
}

// ==================== Manual Add ====================
function populateManualTextbook() {
    const sel = document.getElementById('manualTextbook');
    if (!sel) return;
    // Build options: built-ins + custom textbooks from `textbooks` table + any in-use values
    const used = new Set([
        ...BUILTIN_TEXTBOOKS,
        ...textbooks.map(t => t.name),
        ...lessons.map(l => l.textbook || DEFAULT_TEXTBOOK),
    ]);
    sel.innerHTML = [...used].map(t => `<option value="${t}">${t}</option>`).join('') +
        '<option value="__custom__">➕ 新建课本...</option>';
    if (!sel.value) sel.value = DEFAULT_TEXTBOOK;
}

function resolveManualTextbook() {
    const sel = document.getElementById('manualTextbook');
    if (!sel) return DEFAULT_TEXTBOOK;
    let v = sel.value;
    if (v === '__custom__') {
        // 用户选了 ➕ 但还没填名字——交给 onManualTextbookChange 处理;这里作为兜底再弹一次
        const name = prompt('请输入新课本名称（如：人教版四年级上册）');
        if (!name || !name.trim()) {
            sel.value = sel.dataset.lastValid || DEFAULT_TEXTBOOK;
            return sel.value;
        }
        v = addManualTextbookOption(name.trim());
    }
    return v || DEFAULT_TEXTBOOK;
}

// 用户在下拉里选了 ➕ 新建课本 时立刻弹 prompt。成功插入新 option + 同步到 textbooks 表。
async function onManualTextbookChange(sel) {
    if (sel.value !== '__custom__') { sel.dataset.lastValid = sel.value; return; }
    const name = prompt('请输入新课本名称（如：人教版四年级上册）');
    if (!name || !name.trim()) {
        // 取消:回退到上一次有效的值
        sel.value = sel.dataset.lastValid || DEFAULT_TEXTBOOK;
        return;
    }
    addManualTextbookOption(name.trim());
    sel.dataset.lastValid = sel.value;
}

// 把新课本名插入下拉,选中,同步到云端 textbooks 表
function addManualTextbookOption(name) {
    const sel = document.getElementById('manualTextbook');
    if (!sel) return name;
    // 已存在则直接选中
    const existing = [...sel.options].find(o => o.value === name);
    if (existing) { sel.value = existing.value; return name; }
    const opt = document.createElement('option'); opt.value = name; opt.textContent = name;
    sel.insertBefore(opt, sel.querySelector('option[value="__custom__"]'));
    sel.value = name;
    // Persist to cloud. await 失败时退到 local fallback (showMainApp 会 backfill)
    dbAddTextbook(name).then(row => { if (row) textbooks.push(row); }).catch(e => console.warn('dbAddTextbook failed:', e));
    return name;
}

async function addManualWords() {
    const name = document.getElementById('manualLesson').value.trim();
    const str = document.getElementById('manualWords').value.trim();
    const tbName = resolveManualTextbook();
    const unitName = document.getElementById('manualUnit')?.value.trim() || DEFAULT_UNIT;
    if (!name || !str) { alert('🌸 请填写名称和词语！'); return; }
    const words = str.split(/[\s,，、;；]+/).filter(w => w.length >= 1);
    if (!words.length) return;
    let lesson = lessons.find(l => l.name === name && l.unit === unitName && (l.textbook || DEFAULT_TEXTBOOK) === tbName);
    if (lesson) {
        const set = new Set(lesson.words); words.forEach(w => set.add(w)); lesson.words = [...set];
        await dbPutLesson(lesson);
    } else {
        await dbAddLesson({ name, textbook: tbName, unit: unitName, words: [...new Set(words)] });
    }
    lessons = await dbGetLessons(); renderLibrary();
    document.getElementById('manualWords').value = '';
    spawnEmoji('✨');
}


// ==================== Library UI (Unit > Lesson > Words) ====================
let libDragData = null;
let expandedUnits = new Set();
let expandedLessons = new Set();
let expandedTextbooks = new Set();
let collapsedDictationTextbooks = new Set();

function rebuildWordsDiv(wordsDiv, lesson, mm) {
    wordsDiv.innerHTML = '';
    lesson.words.forEach((word, wi) => {
        const tag = document.createElement('div'); tag.className = 'word-tag text-sm drag-word'; tag.draggable = true;
        const sp = document.createElement('span'); sp.textContent = word; tag.appendChild(sp);
        [...word].filter(c => mm[c]).forEach(c => { const b = document.createElement('span'); b.className = 'err-badge'; b.textContent = `${c}错${mm[c]}`; tag.appendChild(b); });
        // Mic/speaker button
        const mic = document.createElement('button');
        mic.className = 'rec-btn ' + (audioCache[word] ? 'rec-btn-has' : 'rec-btn-mic');
        mic.textContent = audioCache[word] ? '🔊' : '🎤';
        mic.onclick = (e) => { e.stopPropagation(); playOrRecordWord(word, mic); };
        mic.ondblclick = (e) => { e.stopPropagation(); startRecordingFromLibrary(word, mic); };
        mic.title = audioCache[word] ? '点按播放录音 · 双击重录' : '点按试听在线语音 · 双击录音';
        // Right-click to delete recording
        mic.oncontextmenu = async (e) => {
            e.preventDefault(); e.stopPropagation();
            if (audioCache[word]) {
                await AudioDB.delete(word);
                mic.className = 'rec-btn rec-btn-mic';
                mic.textContent = '🎤';
                mic.title = '点击录音';
            }
        };
        tag.appendChild(mic);
        const del = document.createElement('button'); del.className = 'text-gray-300 hover:text-red-400 text-xs ml-0.5'; del.textContent = '✕';
        del.onclick = async (e) => {
            e.stopPropagation();
            lesson.words.splice(wi, 1);
            if (!lesson.words.length) {
                await dbDelLesson(lesson.id); lessons = await dbGetLessons(); renderLibrary();
            } else {
                await dbPutLesson(lesson); lessons = await dbGetLessons();
                rebuildWordsDiv(wordsDiv, lesson, mm);
                const lDiv = wordsDiv.closest('.lesson-row');
                if (lDiv) { const badge = lDiv.querySelector('.bg-gray-100'); if (badge) badge.textContent = `${lesson.words.length} 词`; }
                updateUnitBadge(lesson.unit);
                document.getElementById('lessonCount').textContent = `${lessons.length} 课`;
            }
        };
        tag.appendChild(del);
        tag.addEventListener('dragstart', (e) => { libDragData = { lessonId: lesson.id, wordIdx: wi, word }; tag.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
        tag.addEventListener('dragend', () => { tag.classList.remove('dragging'); libDragData = null; });
        wordsDiv.appendChild(tag);
    });
    wordsDiv.addEventListener('dragover', (e) => e.preventDefault());
    wordsDiv.addEventListener('drop', async (e) => {
        e.preventDefault();
        if (!libDragData || libDragData.lessonId !== lesson.id) return;
        const tags = [...wordsDiv.querySelectorAll('.drag-word')];
        let dropIdx = tags.length;
        for (let i = 0; i < tags.length; i++) { const r = tags[i].getBoundingClientRect(); if (e.clientX < r.left + r.width / 2) { dropIdx = i; break; } }
        const si = libDragData.wordIdx;
        if (si === dropIdx || si + 1 === dropIdx) return;
        const w = lesson.words.splice(si, 1)[0];
        lesson.words.splice(dropIdx > si ? dropIdx - 1 : dropIdx, 0, w);
        await dbPutLesson(lesson); lessons = await dbGetLessons(); libDragData = null;
        rebuildWordsDiv(wordsDiv, lesson, mm);
    });
}

function updateUnitBadge(unitName, textbookName) {
    const grouped = groupByTextbookAndUnit(lessons);
    const target = (textbookName && grouped[textbookName]) ? grouped[textbookName][unitName] : null;
    if (!target) return;
    const tw = target.reduce((s, l) => s + l.words.length, 0);
    document.querySelectorAll('#libraryContent .bg-brand-100').forEach(b => {
        const parentDiv = b.closest('[data-unit-block]');
        if (!parentDiv) return;
        const unitInput = parentDiv.querySelector('.unit-name-input');
        if (unitInput && unitInput.value === unitName) {
            b.textContent = `${target.length} 课 · ${tw} 词`;
        }
    });
}

function updateTextbookBadge(textbookName) {
    const grouped = groupByTextbook(lessons);
    const tbLessons = grouped[textbookName];
    if (!tbLessons) return;
    const tLessonsCount = tbLessons.length;
    const tWords = tbLessons.reduce((s, l) => s + l.words.length, 0);
    document.querySelectorAll('#libraryContent [data-textbook-block]').forEach(b => {
        const tbInput = b.querySelector('.textbook-name-input');
        if (tbInput && tbInput.value === textbookName) {
            const badge = b.querySelector('.textbook-badge');
            if (badge) badge.textContent = `${tLessonsCount} 课 · ${tWords} 词`;
        }
    });
}

async function renderLibrary() {
    const container = document.getElementById('libraryContent');
    const emptyMsg = document.getElementById('emptyLibrary');
    lessons = await dbGetLessons();
    populateManualTextbook();
    document.getElementById('lessonCount').textContent = `${lessons.length} 课`;
    let mm = {};
    try { (await dbGetMistakes()).forEach(m => { mm[m.char] = m.count; }); } catch (e) { }
    if (!lessons.length) { container.innerHTML = ''; emptyMsg.classList.remove('hidden'); return; }
    emptyMsg.classList.add('hidden');
    container.innerHTML = '';

    const grouped = groupByTextbookAndUnit(lessons);
    let tidx = 0;
    for (const textbookName in grouped) {
        const tbLessons = Object.values(grouped[textbookName]).flat();
        const tbWords = tbLessons.reduce((s, l) => s + l.words.length, 0);
        const tbDiv = document.createElement('div');
        tbDiv.className = 'mb-5 animate-slide-up'; tbDiv.style.animationDelay = (tidx * 0.08) + 's';
        tbDiv.dataset.textbookBlock = textbookName;

        // === Textbook header ===
        const tbHead = document.createElement('div'); tbHead.className = 'flex items-center gap-2 mb-2';
        const tbArrow = document.createElement('span'); tbArrow.className = 'text-brand-600 transition-transform text-base font-bold cursor-pointer'; tbArrow.textContent = '▶';
        const tbIcon = document.createElement('span'); tbIcon.textContent = '📚 '; tbIcon.className = 'cursor-pointer text-lg';
        const tbInput = document.createElement('input'); tbInput.type = 'text'; tbInput.value = textbookName;
        tbInput.className = 'textbook-name-input unit-name-input'; tbInput.style.width = Math.max(100, textbookName.length * 17) + 'px';
        tbInput.style.fontSize = '1.15rem'; tbInput.style.color = '#7C2D12';
        tbInput.addEventListener('input', () => { tbInput.style.width = Math.max(100, tbInput.value.length * 17) + 'px'; });
        tbInput.addEventListener('blur', async () => {
            const n = tbInput.value.trim();
            if (!n || n === textbookName) return;
            if (!confirm(`将课本「${textbookName}」改名为「${n}」？所有该课本下的课文都会更新。`)) { tbInput.value = textbookName; return; }
            expandedTextbooks.delete(textbookName); expandedTextbooks.add(n);
            for (const l of tbLessons) { l.textbook = n; await dbPutLesson(l); }
            // Update textbooks table
            const tbRow = textbooks.find(t => t.name === textbookName);
            if (tbRow) {
                await dbRenameTextbook(tbRow.id, n);
                tbRow.name = n;
            } else {
                // No row yet (shouldn't normally happen) — create one with the new name
                const inserted = await dbAddTextbook(n);
                if (inserted) textbooks.push(inserted);
            }
            lessons = await dbGetLessons(); renderLibrary();
        });
        const tbBadge = document.createElement('span');
        tbBadge.className = 'text-xs bg-brand-200 text-brand-700 px-2 py-0.5 rounded-full font-bold textbook-badge';
        tbBadge.textContent = `${tbLessons.length} 课 · ${tbWords} 词`;
        const tbRow = textbooks.find(t => t.name === textbookName);
        const isTbHidden = !!(tbRow && tbRow.hidden);
        const tbHide = document.createElement('button');
        tbHide.className = 'text-gray-300 hover:text-orange-500 text-sm cursor-pointer';
        tbHide.title = isTbHidden ? '在默写 tab 恢复显示' : '在默写 tab 隐藏';
        tbHide.textContent = isTbHidden ? '🚫' : '👁️';
        tbHide.onclick = async () => {
            if (!tbRow) return;
            const newHidden = !isTbHidden;
            if (newHidden && !confirm(`隐藏课本「${textbookName}」？隐藏后默写 tab 不会显示，但词库 tab 仍可管理。`)) return;
            await dbSetTextbookHidden(tbRow.id, newHidden);
            tbRow.hidden = newHidden;
            renderLibrary();
        };
        const tbDel = document.createElement('button');
        tbDel.className = 'ml-auto text-gray-300 hover:text-red-400 text-sm cursor-pointer';
        tbDel.title = '删除整个课本';
        tbDel.textContent = '🗑️';
        tbDel.onclick = async () => {
            if (!confirm(`确定删除整个课本「${textbookName}」及其下 ${tbLessons.length} 篇课文吗？此操作不可恢复！`)) return;
            for (const l of tbLessons) { await dbDelLesson(l.id); }
            // Remove from textbooks table
            const tbRow = textbooks.find(t => t.name === textbookName);
            if (tbRow) {
                await dbDelTextbook(tbRow.id);
                textbooks = textbooks.filter(t => t.id !== tbRow.id);
            }
            expandedTextbooks.delete(textbookName);
            lessons = await dbGetLessons(); renderLibrary();
            spawnEmoji('🗑️');
        };
        const tbBody = document.createElement('div'); tbBody.className = 'ml-2 space-y-3';
        const isTbExpanded = expandedTextbooks.has(textbookName);
        if (!isTbExpanded) tbBody.classList.add('hidden');
        if (isTbExpanded) tbArrow.style.transform = 'rotate(90deg)';

        const toggleTb = () => {
            tbBody.classList.toggle('hidden');
            const nowHidden = tbBody.classList.contains('hidden');
            tbArrow.style.transform = nowHidden ? '' : 'rotate(90deg)';
            if (nowHidden) expandedTextbooks.delete(textbookName); else expandedTextbooks.add(textbookName);
        };
        tbArrow.onclick = toggleTb; tbIcon.onclick = toggleTb;
        if (isTbHidden) {
            // Gray out: name struck through, badge faded, no body content rendered below.
            tbInput.style.color = '#9CA3AF';
            tbInput.style.textDecoration = 'line-through';
            tbBadge.style.opacity = '0.5';
        }
        tbHead.appendChild(tbArrow); tbHead.appendChild(tbIcon); tbHead.appendChild(tbInput); tbHead.appendChild(tbBadge); tbHead.appendChild(tbHide);
        // tbDel stays at the right via ml-auto (other buttons sit before it)
        tbDel.style.marginLeft = 'auto';
        tbHead.appendChild(tbDel);
        tbDiv.appendChild(tbHead);
        tbDiv.dataset.textbookBlock = textbookName; // ensure selector works after children appended

        // Hidden textbooks render header only (gray + strike-through); skip units/lessons.
        if (isTbHidden) {
            container.appendChild(tbDiv); tidx++;
            continue;
        }

        // === Units within this textbook ===
        let uidx = 0;
        for (const unitName in grouped[textbookName]) {
            const uLessons = grouped[textbookName][unitName];
            const uWords = uLessons.reduce((s, l) => s + l.words.length, 0);
            const unitKey = `${textbookName}::${unitName}`;
            const uDiv = document.createElement('div');
            uDiv.className = 'mb-3 ml-3';
            uDiv.dataset.unitBlock = unitKey;

            const uHead = document.createElement('div'); uHead.className = 'flex items-center gap-2 mb-2';
            const uArrow = document.createElement('span'); uArrow.className = 'text-brand-500 transition-transform text-sm font-bold cursor-pointer'; uArrow.textContent = '▶';
            const uIcon = document.createElement('span'); uIcon.textContent = '📦 '; uIcon.className = 'cursor-pointer';
            const uInput = document.createElement('input'); uInput.type = 'text'; uInput.value = unitName;
            uInput.className = 'unit-name-input'; uInput.style.width = Math.max(80, unitName.length * 16) + 'px';
            uInput.addEventListener('input', () => { uInput.style.width = Math.max(80, uInput.value.length * 16) + 'px'; });
            uInput.addEventListener('blur', async () => {
                const n = uInput.value.trim();
                if (!n || n === unitName) return;
                expandedUnits.delete(unitKey); expandedUnits.add(`${textbookName}::${n}`);
                for (const l of uLessons) { l.unit = n; await dbPutLesson(l); }
                lessons = await dbGetLessons(); renderLibrary();
            });
            const uBadge = document.createElement('span'); uBadge.className = 'text-xs bg-brand-100 text-brand-600 px-2 py-0.5 rounded-full font-bold'; uBadge.textContent = `${uLessons.length} 课 · ${uWords} 词`;
            const uDel = document.createElement('button');
            uDel.className = 'ml-auto text-gray-300 hover:text-red-400 text-xs cursor-pointer';
            uDel.title = '删除整个单元';
            uDel.textContent = '🗑️';
            uDel.onclick = async () => {
                if (!confirm(`确定删除「${unitName}」及其下 ${uLessons.length} 篇课文吗？`)) return;
                for (const l of uLessons) { await dbDelLesson(l.id); }
                lessons = await dbGetLessons(); renderLibrary();
            };
            const uBody = document.createElement('div'); uBody.className = 'ml-2 space-y-2';
            const isUnitExpanded = expandedUnits.has(unitKey);
            if (!isUnitExpanded) uBody.classList.add('hidden');
            if (isUnitExpanded) uArrow.style.transform = 'rotate(90deg)';

            const toggleU = () => {
                uBody.classList.toggle('hidden');
                const nowHidden = uBody.classList.contains('hidden');
                uArrow.style.transform = nowHidden ? '' : 'rotate(90deg)';
                if (nowHidden) expandedUnits.delete(unitKey); else expandedUnits.add(unitKey);
            };
            uArrow.onclick = toggleU; uIcon.onclick = toggleU;
            uHead.appendChild(uArrow); uHead.appendChild(uIcon); uHead.appendChild(uInput); uHead.appendChild(uBadge); uHead.appendChild(uDel);
            uDiv.appendChild(uHead);

            uLessons.forEach(lesson => {
                const lessonKey = `${textbookName}::${unitName}::${lesson.id}`;
                const lDiv = document.createElement('div'); lDiv.className = 'lesson-row';
                const lHead = document.createElement('div'); lHead.className = 'flex items-center justify-between';
                const lLeft = document.createElement('div'); lLeft.className = 'flex items-center gap-2 flex-1';
                const lArrow = document.createElement('span'); lArrow.className = 'text-brand-400 transition-transform text-xs font-bold cursor-pointer'; lArrow.textContent = '▶';
                const lInput = document.createElement('input'); lInput.type = 'text'; lInput.value = lesson.name;
                lInput.className = 'lesson-name-input text-sm'; lInput.style.width = Math.max(60, lesson.name.length * 14) + 'px';
                lInput.addEventListener('input', () => { lInput.style.width = Math.max(60, lInput.value.length * 14) + 'px'; });
                lInput.addEventListener('blur', async () => { const n = lInput.value.trim(); if (n && n !== lesson.name) { lesson.name = n; await dbPutLesson(lesson); lessons = await dbGetLessons(); } });
                const lBadge = document.createElement('span'); lBadge.className = 'text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full font-bold'; lBadge.textContent = `${lesson.words.length} 词`;
                const lDel = document.createElement('button'); lDel.className = 'w-7 h-7 flex items-center justify-center rounded-full hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors text-sm'; lDel.textContent = '🗑️';
                lDel.onclick = async () => {
                    if (!confirm(`确定删除「${lesson.name}」？`)) return;
                    expandedLessons.delete(lessonKey);
                    await dbDelLesson(lesson.id); lessons = await dbGetLessons(); renderLibrary();
                };
                lLeft.appendChild(lArrow); lLeft.appendChild(lInput); lLeft.appendChild(lBadge);
                lHead.appendChild(lLeft); lHead.appendChild(lDel);

                const wordsArea = document.createElement('div'); wordsArea.className = 'mt-2 ml-4 pt-2 border-t border-gray-100';
                const isLessonExpanded = expandedLessons.has(lessonKey);
                if (!isLessonExpanded) wordsArea.classList.add('hidden');
                if (isLessonExpanded) lArrow.style.transform = 'rotate(90deg)';

                const wordsDiv = document.createElement('div'); wordsDiv.className = 'flex flex-wrap gap-2 mb-2';
                rebuildWordsDiv(wordsDiv, lesson, mm);

                const recRow = document.createElement('div'); recRow.className = 'flex items-center gap-2 mb-2';
                const recBtn = document.createElement('button');
                recBtn.className = 'btn-secondary'; recBtn.style.cssText = 'font-size:.75rem;padding:.35rem .75rem;border-radius:.5rem;white-space:nowrap';
                recBtn.textContent = '🎙️ 批量录音';
                recBtn.onclick = () => startBatchRecording(lesson);
                const recCount = lesson.words.filter(w => audioCache[w]).length;
                const recInfo = document.createElement('span');
                recInfo.className = 'text-xs text-gray-400 font-bold';
                recInfo.textContent = recCount > 0 ? `已录 ${recCount}/${lesson.words.length}` : '';
                recRow.appendChild(recBtn); recRow.appendChild(recInfo);
                wordsArea.appendChild(recRow);

                const addRow = document.createElement('div'); addRow.className = 'flex gap-2 items-center mt-1';
                const addIn = document.createElement('input'); addIn.type = 'text'; addIn.placeholder = '添加词语（空格分隔）';
                addIn.className = 'input-field text-xs'; addIn.style.cssText = 'padding:.35rem .6rem;border-radius:.5rem;flex:1';
                const addBtn = document.createElement('button'); addBtn.className = 'btn-primary'; addBtn.style.cssText = 'font-size:.75rem;padding:.35rem .75rem;border-radius:.5rem;white-space:nowrap';
                addBtn.textContent = '➕ 添加';
                addBtn.onclick = async () => {
                    const nw = addIn.value.trim().split(/[\s,，、;；]+/).filter(w => w.length >= 1);
                    if (!nw.length) return;
                    const set = new Set(lesson.words); nw.forEach(w => set.add(w)); lesson.words = [...set];
                    await dbPutLesson(lesson); lessons = await dbGetLessons();
                    addIn.value = '';
                    rebuildWordsDiv(wordsDiv, lesson, mm);
                    lBadge.textContent = `${lesson.words.length} 词`;
                    updateUnitBadge(unitName, textbookName);
                    updateTextbookBadge(textbookName);
                    document.getElementById('lessonCount').textContent = `${lessons.length} 课`;
                };
                addIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') addBtn.click(); });
                addRow.appendChild(addIn); addRow.appendChild(addBtn);
                wordsArea.appendChild(wordsDiv); wordsArea.appendChild(addRow);

                lArrow.onclick = () => {
                    wordsArea.classList.toggle('hidden');
                    const nowHidden = wordsArea.classList.contains('hidden');
                    lArrow.style.transform = nowHidden ? '' : 'rotate(90deg)';
                    if (nowHidden) expandedLessons.delete(lessonKey); else expandedLessons.add(lessonKey);
                };
                lDiv.appendChild(lHead); lDiv.appendChild(wordsArea); uBody.appendChild(lDiv);
            });

            uDiv.appendChild(uBody); tbBody.appendChild(uDiv); uidx++;
        }

        tbDiv.appendChild(tbBody); container.appendChild(tbDiv); tidx++;
    }
}

// ==================== Mode ====================
function setMode(mode) {
    dictationMode = mode;
    document.getElementById('modeAllCard').classList.toggle('active', mode === 'all');
    document.getElementById('modeMistakesCard').classList.toggle('active', mode === 'mistakes');
    document.getElementById('modeRandomCard').classList.toggle('active', mode === 'random');
    document.querySelector(`input[name="dictMode"][value="${mode}"]`).checked = true;
}

// ==================== Dictation ====================
async function renderLessonSelection() {
    const container = document.getElementById('lessonCheckboxes');
    const noMsg = document.getElementById('noLessonsMsg');
    const startBtn = document.getElementById('startBtn');
    lessons = await dbGetLessons();
    if (!lessons.length) { container.innerHTML = ''; noMsg.classList.remove('hidden'); startBtn.classList.add('hidden'); return; }
    noMsg.classList.add('hidden'); startBtn.classList.remove('hidden');

    const grouped = groupByTextbookAndUnit(lessons);
    let html = '';
    for (const textbookName in grouped) {
        // Skip textbooks hidden by user in the library tab.
        const tbRow = textbooks.find(t => t.name === textbookName);
        if (tbRow && tbRow.hidden) continue;
        const isCollapsed = collapsedDictationTextbooks.has(textbookName);
        html += `<div class="mb-3">
      <div class="flex items-center gap-2 mb-1.5">
        <span class="text-brand-400 transition-transform text-xs font-bold cursor-pointer inline-block" style="width:1em;${isCollapsed ? '' : 'transform:rotate(90deg)'}" onclick="toggleDictationTextbook('${textbookName}', this)">▶</span>
        <input type="checkbox" class="textbook-checkbox w-5 h-5 accent-orange-600 rounded cursor-pointer" data-textbook="${textbookName}" onchange="toggleTextbookCheck(this)" />
        <span class="font-extrabold text-orange-900 text-sm cursor-pointer" onclick="this.previousElementSibling.click()">📚 ${textbookName}</span>
      </div>
      <div class="ml-6 space-y-2 dictation-tb-body" data-tb-body="${textbookName}"${isCollapsed ? ' style="display:none"' : ''}>`;
        for (const unitName in grouped[textbookName]) {
            const unitKey = `${textbookName}::${unitName}`;
            html += `<div class="mb-2">
        <div class="flex items-center gap-2 mb-1">
          <input type="checkbox" class="unit-checkbox w-4 h-4 accent-orange-500 rounded cursor-pointer" data-textbook="${textbookName}" data-unit="${unitName}" onchange="toggleUnitCheck(this)" />
          <span class="font-bold text-gray-700 text-xs cursor-pointer" onclick="this.previousElementSibling.click()">📦 ${unitName}</span>
        </div>
        <div class="ml-6 space-y-1">`;
            grouped[textbookName][unitName].forEach((lesson) => {
                const realIdx = lessons.indexOf(lesson);
                html += `<label class="lesson-check flex items-center gap-3 !py-2 !px-3">
          <input type="checkbox" value="${realIdx}" data-textbook="${textbookName}" data-unit="${unitName}" class="lesson-checkbox w-4 h-4 accent-orange-500 rounded cursor-pointer" onchange="updateStartBtn();this.closest('.lesson-check').classList.toggle('checked',this.checked);syncUnitCheckbox('${textbookName}','${unitName}');syncTextbookCheckbox('${textbookName}')" />
          <div class="flex-1"><span class="font-bold text-gray-700 text-sm">${lesson.name}</span><span class="text-gray-400 text-xs ml-2">${lesson.words.length} 词</span></div>
        </label>`;
            });
            html += `</div></div>`;
        }
        html += `</div></div>`;
    }
    container.innerHTML = html;
    updateStartBtn();
}

function toggleDictationTextbook(textbookName, arrowEl) {
    const body = document.querySelector(`[data-tb-body="${textbookName}"]`);
    if (!body) return;
    const willHide = body.style.display !== 'none';
    body.style.display = willHide ? 'none' : '';
    arrowEl.style.transform = willHide ? '' : 'rotate(90deg)';
    if (willHide) collapsedDictationTextbooks.add(textbookName);
    else collapsedDictationTextbooks.delete(textbookName);
}

function toggleTextbookCheck(tbCb) {
    const tb = tbCb.dataset.textbook, checked = tbCb.checked;
    document.querySelectorAll(`.lesson-checkbox[data-textbook="${tb}"]`).forEach(cb => { cb.checked = checked; cb.closest('.lesson-check').classList.toggle('checked', checked); });
    document.querySelectorAll(`.unit-checkbox[data-textbook="${tb}"]`).forEach(cb => { cb.checked = checked; });
    updateStartBtn();
}

function toggleUnitCheck(unitCb) {
    const tb = unitCb.dataset.textbook, unit = unitCb.dataset.unit, checked = unitCb.checked;
    document.querySelectorAll(`.lesson-checkbox[data-textbook="${tb}"][data-unit="${unit}"]`).forEach(cb => { cb.checked = checked; cb.closest('.lesson-check').classList.toggle('checked', checked); });
    syncTextbookCheckbox(tb);
    updateStartBtn();
}

function updateStartBtn() {
    const checked = document.querySelectorAll('.lesson-checkbox:checked');
    const btn = document.getElementById('startBtn');
    btn.classList.toggle('hidden', !checked.length);
    btn.textContent = checked.length ? `🚀 开启 ${checked.length} 课挑战！` : '';
}

function selectAllLessons(checked) {
    document.querySelectorAll('.lesson-checkbox').forEach(cb => { cb.checked = checked; cb.closest('.lesson-check').classList.toggle('checked', checked); });
    document.querySelectorAll('.unit-checkbox').forEach(cb => cb.checked = checked);
    document.querySelectorAll('.textbook-checkbox').forEach(cb => cb.checked = checked);
    updateStartBtn();
}

function syncUnitCheckbox(tbName, unitName) {
    const sel = `.lesson-checkbox[data-textbook="${tbName}"][data-unit="${unitName}"]`;
    const all = document.querySelectorAll(sel);
    const checkedCount = document.querySelectorAll(`${sel}:checked`).length;
    const ucb = document.querySelector(`.unit-checkbox[data-textbook="${tbName}"][data-unit="${unitName}"]`);
    if (ucb) ucb.checked = all.length > 0 && checkedCount === all.length;
}

function syncTextbookCheckbox(tbName) {
    const sel = `.lesson-checkbox[data-textbook="${tbName}"]`;
    const all = document.querySelectorAll(sel);
    const checkedCount = document.querySelectorAll(`${sel}:checked`).length;
    const tcb = document.querySelector(`.textbook-checkbox[data-textbook="${tbName}"]`);
    if (tcb) tcb.checked = all.length > 0 && checkedCount === all.length;
}

async function startDictation() {
    const checked = document.querySelectorAll('.lesson-checkbox:checked');
    if (!checked.length) return;
    let allWords = [];
    dictationLessons = [];
    checked.forEach(cb => {
        const lesson = lessons[parseInt(cb.value)];
        lesson.words.forEach(w => allWords.push({ word: w, lesson: lesson.name }));
        if (!dictationLessons.includes(lesson.name)) dictationLessons.push(lesson.name);
    });
    const allMistakes = await dbGetMistakes();
    const charSet = new Set(allMistakes.map(m => m.char));
    const hasMC = (word) => [...word].some(c => charSet.has(c));
    const mScore = (word) => { let s = 0; const mm = {}; allMistakes.forEach(m => { mm[m.char] = m.count; }); for (const c of word) if (mm[c]) s += mm[c]; return s; };

    if (dictationMode === 'mistakes') {
        allWords = allWords.filter(it => hasMC(it.word));
        if (!allWords.length) { alert('🌸 没有错字词，试试「全部默写」！'); return; }
    } else if (dictationMode === 'random') {
        const n = parseInt(document.getElementById('randomCount').value) || 10;
        allWords.forEach(it => { it._score = mScore(it.word); });
        allWords.sort((a, b) => { const sa = a._score > 0 ? 1000 + a._score : 0; const sb = b._score > 0 ? 1000 + b._score : 0; return (sb + Math.random() * 100) - (sa + Math.random() * 100); });
        allWords = allWords.slice(0, Math.min(n, allWords.length));
    }
    currentWords = allWords;
    for (let i = currentWords.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[currentWords[i], currentWords[j]] = [currentWords[j], currentWords[i]]; }
    currentIndex = 0; selectedChars = new Set(); selectedCharMeta = {};
    document.getElementById('selectLessonView').classList.add('hidden');
    document.getElementById('dictationView').classList.remove('hidden');
    showCurrentWord();
}

function showCurrentWord() {
    if (currentIndex >= currentWords.length) { generateDictationPDF(); return; }
    const item = currentWords[currentIndex];
    const pinyin = pinyinPro.pinyin(item.word, { toneType: 'symbol', type: 'string' });
    document.getElementById('pinyinDisplay').textContent = pinyin;
    const rev = document.getElementById('wordReveal');
    rev.textContent = item.word;
    rev.classList.add('opacity-0', 'scale-90'); rev.classList.remove('opacity-100', 'scale-100');
    document.getElementById('revealBtn').classList.remove('hidden');
    document.getElementById('progressText').textContent = `第 ${currentIndex + 1}/${currentWords.length} 个`;
    document.getElementById('lessonLabel').textContent = item.lesson;
    document.getElementById('progressBar').style.width = (currentIndex / currentWords.length * 100) + '%';
    const card = document.getElementById('wordCard');
    card.classList.remove('animate-pop'); void card.offsetWidth; card.classList.add('animate-pop');
    speakWord(item.word);
}

function revealWord() {
    const r = document.getElementById('wordReveal');
    r.classList.remove('opacity-0', 'scale-90'); r.classList.add('opacity-100', 'scale-100');
    document.getElementById('revealBtn').classList.add('hidden');
}

async function speakWord(text) {
    // 1. If voiceSource is 'custom', try active voice pack first
    if (appSettings.voiceSource === 'custom') {
        const packAudio = await AudioDB.get(text, appSettings.activePackId);
        if (packAudio) {
            try { await playAudioDataUrl(packAudio); return; } catch (e) { console.warn('Pack audio failed, falling back'); }
        }
    }

    // 2. Try legacy per-word recording (always check, regardless of source)
    const legacyAudio = await AudioDB.get(text);
    if (legacyAudio) {
        try { await playAudioDataUrl(legacyAudio); return; } catch (e) { console.warn('Legacy audio failed, falling back'); }
    }

    // 3. Use the configured voice source as fallback
    if (appSettings.voiceSource === 'online') {
        try { await playOnlineVoice(text); return; } catch (e) { console.warn('Online TTS failed, falling back to browser TTS'); }
    }

    // 4. Try browser SpeechSynthesis. If voiceSource === 'browser' (new default)
    //    prefer OS-installed local zh-CN voices (Xiaoxiao / Yaoyao / Yating / Tingting).
    //    Falls back to online if no zh voice is available so the child always hears something.
    if (!('speechSynthesis' in window)) {
        if (appSettings.voiceSource !== 'online') {
            try { await playOnlineVoice(text); } catch (e) { console.warn('No speech available:', e); }
        }
        return;
    }
    window.speechSynthesis.cancel();

    // Chrome/Edge load voices asynchronously — wait for them if not yet available
    let voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) {
        await new Promise(resolve => {
            const handler = () => {
                voices = window.speechSynthesis.getVoices();
                window.speechSynthesis.removeEventListener('voiceschanged', handler);
                resolve();
            };
            window.speechSynthesis.addEventListener('voiceschanged', handler);
            // Safety timeout (5s) in case voices never fire
            setTimeout(resolve, 5000);
        });
    }

    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = appSettings.rate;
    u.pitch = appSettings.pitch;
    // Pick best available voice: user-saved URI > high-quality known names > first local zh > first remote zh
    const PREFERRED = ['Xiaoxiao', 'Yaoyao', 'Yating', 'Tingting', 'Mei', 'Lili', 'Huihui', 'Tracy', 'Hanhan'];
    const zhVoices = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith('zh'));
    const localZh = zhVoices.filter(v => v.localService === true);
    let chosen = null;
    if (appSettings.voiceURI) chosen = voices.find(v => v.voiceURI === appSettings.voiceURI) || null;
    if (!chosen) {
        const preferredLocal = localZh.find(v => PREFERRED.some(p => v.name.includes(p)));
        if (preferredLocal) chosen = preferredLocal;
        else if (localZh.length) chosen = localZh[0];
        else if (zhVoices.length) chosen = zhVoices[0];
    }
    if (chosen) u.voice = chosen;
    window.speechSynthesis.speak(u);
    // If no zh voice at all, browser will speak English — fall back to online after a short grace period
    if (!zhVoices.length) {
        setTimeout(async () => {
            try { await playOnlineVoice(text); } catch (e) { /* give up silently */ }
        }, 50);
    }
}

function nextWord() { currentIndex++; showCurrentWord(); }
function replayWord() { if (currentIndex < currentWords.length) speakWord(currentWords[currentIndex].word); }
function quitDictation() {
    if (!confirm('确定要退出吗？')) return;
    document.getElementById('dictationView').classList.add('hidden');
    document.getElementById('selectLessonView').classList.remove('hidden');
}

// ==================== Auth & Navigation ====================

// ==================== Finish & Char-level Mistakes ====================
function finishDictation() {
    document.getElementById('dictationView').classList.add('hidden');
    document.getElementById('completeView').classList.remove('hidden');
    document.getElementById('markMistakesStep').classList.remove('hidden');
    document.getElementById('successStep').classList.add('hidden');
    document.getElementById('progressBar').style.width = '100%';
    selectedChars = new Set(); selectedCharMeta = {};
    const container = document.getElementById('mistakeCharList');
    container.innerHTML = '';
    currentWords.forEach((item, idx) => {
        const row = document.createElement('div');
        row.className = 'flex items-center gap-3 animate-pop'; row.style.animationDelay = (idx * 0.04) + 's';
        const label = document.createElement('span');
        label.className = 'text-gray-400 text-xs font-bold min-w-[60px] text-right'; label.textContent = item.word;
        const charsDiv = document.createElement('div'); charsDiv.className = 'flex gap-2 flex-wrap';
        [...item.word].forEach(ch => {
            const chip = document.createElement('div');
            chip.className = 'char-chip'; chip.textContent = ch;
            const key = `${ch}_${item.word}_${idx}`;
            chip.onclick = () => {
                chip.classList.toggle('selected');
                if (chip.classList.contains('selected')) { selectedChars.add(key); selectedCharMeta[key] = { char: ch, word: item.word, lesson: item.lesson }; }
                else { selectedChars.delete(key); delete selectedCharMeta[key]; }
            };
            charsDiv.appendChild(chip);
        });
        row.appendChild(label); row.appendChild(charsDiv); container.appendChild(row);
    });
}

async function submitMistakes() {
    const uniq = {};
    for (const key of selectedChars) { const m = selectedCharMeta[key]; if (m && !uniq[m.char]) uniq[m.char] = m; }
    for (const k in uniq) { const m = uniq[k]; await recordCharMistake(m.char, m.word, m.lesson); }
    // Collect wrong words (unique) from selected chars
    const wrongWordsSet = new Set();
    for (const key of selectedChars) { const m = selectedCharMeta[key]; if (m) wrongWordsSet.add(m.word); }
    await saveDictationRecord([...wrongWordsSet]);
    showSuccessScreen(Object.keys(uniq).length);
}
function skipMistakes() { saveDictationRecord([]); showSuccessScreen(0); }

async function saveDictationRecord(wrongWords) {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const datetime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const totalWords = currentWords.length;
    const correctCount = totalWords - wrongWords.length;
    const lessonsCovered = dictationLessons.length ? dictationLessons : [...new Set(currentWords.map(w => w.lesson))];
    const record = { datetime, total_words: totalWords, correct_count: correctCount, wrong_words: wrongWords, lessons_covered: lessonsCovered };
    await dbSaveDictationRecord(record);
}

function showSuccessScreen(n) {
    document.getElementById('markMistakesStep').classList.add('hidden');
    document.getElementById('successStep').classList.remove('hidden');
    document.getElementById('totalCount').textContent = currentWords.length;
    const s = document.getElementById('mistakeSummary');
    if (n > 0) { s.classList.remove('hidden'); document.getElementById('mistakeCount').textContent = n; } else s.classList.add('hidden');
    launchConfetti(); spawnEmoji('🎇'); spawnEmoji('🏆'); spawnEmoji('🌈');
}

function restartDictation() {
    document.getElementById('completeView').classList.add('hidden');
    document.getElementById('selectLessonView').classList.remove('hidden');
    renderLessonSelection();
}

// ==================== Dictation Records ====================
async function renderRecords() {
    const container = document.getElementById('recordsContent');
    const emptyEl = document.getElementById('emptyRecords');
    const records = await dbGetDictationRecords();
    if (!records.length) {
        container.innerHTML = '';
        emptyEl.classList.remove('hidden');
        return;
    }
    emptyEl.classList.add('hidden');
    container.innerHTML = records.map((r, idx) => {
        const wrongCount = (r.wrong_words || []).length;
        const total = r.total_words || 0;
        const correct = r.correct_count || 0;
        const pct = total > 0 ? Math.round(correct / total * 100) : 100;
        const pctColor = pct === 100 ? '#16A34A' : pct >= 80 ? '#F97316' : '#EF4444';
        const pctEmoji = pct === 100 ? '🌟' : pct >= 80 ? '💪' : '📝';
        const lessonsStr = (r.lessons_covered || []).join('、');
        const wrongStr = (r.wrong_words || []).map(w => `<span class="record-wrong-tag">${w}</span>`).join(' ');
        return `<div class="app-card p-5 animate-slide-up" style="animation-delay:${idx * 0.03}s">
            <div class="flex items-start justify-between gap-3 mb-3">
                <div class="flex items-center gap-2">
                    <span class="text-2xl">${pctEmoji}</span>
                    <div>
                        <p class="font-extrabold text-gray-800">${r.datetime || ''}</p>
                        <p class="text-xs text-gray-400 mt-0.5">${lessonsStr || '未知课文'}</p>
                    </div>
                </div>
                <div class="text-right flex-shrink-0">
                    <p class="text-xl font-extrabold" style="color:${pctColor}">${pct}%</p>
                    <p class="text-xs text-gray-400">${correct}/${total} 正确</p>
                </div>
            </div>
            ${wrongCount > 0 ? `<div class="record-wrong-section"><span class="text-xs text-gray-400 font-bold">❌ 错误词语：</span><div class="flex flex-wrap gap-1.5 mt-1">${wrongStr}</div></div>` : '<p class="text-sm text-green-500 font-bold">✅ 全部正确！太棒了！</p>'}
        </div>`;
    }).join('');
}

// ==================== History ====================
async function renderHistory() {
    const all = await dbGetMistakes();
    const emptyEl = document.getElementById('emptyHistory');
    const container = document.getElementById('historyContent');
    if (!all.length) { emptyEl.classList.remove('hidden'); container.innerHTML = ''; return; }
    emptyEl.classList.add('hidden');
    const byLesson = {};
    all.forEach(m => { (m.lessons || ['未知课文']).forEach(l => { if (!byLesson[l]) byLesson[l] = []; byLesson[l].push(m); }); });
    // Sort lessons by most recent mistake date (descending). Most recent errors first.
    // Each mistake has a `dates` array of ISO date strings; lesson's "latest" = max of all its chars' dates.
    const sortedLessons = Object.keys(byLesson).sort((a, b) => {
        const latest = (lesson) => {
            let max = '';
            for (const m of byLesson[lesson]) for (const d of (m.dates || [])) if (d > max) max = d;
            return max;
        };
        return latest(b).localeCompare(latest(a));   // descending
    });
    let html = '';
    for (const name of sortedLessons) {
        const chars = byLesson[name]; chars.sort((a, b) => b.count - a.count);
        html += `<div class="app-card p-6 animate-slide-up mb-4">
      <div class="section-label mb-4"><div class="icon-dot"></div><span>${name}</span></div>
      <div class="flex flex-wrap gap-3">${chars.map(m => {
            const dateTags = (m.dates || []).map((d, idx) =>
                `<span class="date-tag group relative">
                    ${d.slice(5)}
                    <button onclick="deleteMistakeDate('${m.id}', ${idx})" class="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-400 text-white rounded-full text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500">×</button>
                </span>`
            ).join('');
            return `<div class="history-char"><span class="text-2xl font-extrabold text-gray-800">${m.char}</span>
          <span class="text-brand-500 font-extrabold text-sm mt-1">错 ${m.count} 次</span>
          <div class="flex flex-wrap gap-1 mt-1.5 justify-center">${dateTags}</div>
          ${m.words && m.words.length ? `<p class="text-[10px] text-gray-400 mt-1">出自: ${m.words.join(', ')}</p>` : ''}</div>`;
        }).join('')}</div></div>`;
    }
    container.innerHTML = html;
}

async function deleteMistakeDate(mistakeId, dateIndex) {
    const { data, error } = await sb.from('mistakes').select('*').eq('id', mistakeId);
    if (error || !data || data.length === 0) return;
    const m = data[0];

    const dates = [...m.dates];
    dates.splice(dateIndex, 1);

    if (dates.length === 0) {
        if (!confirm(`确定删除「${m.char}」的全部记录吗？`)) return;
        await sb.from('mistakes').delete().eq('id', mistakeId);
        spawnEmoji('🗑️');
    } else {
        await sb.from('mistakes').update({
            dates: dates,
            count: dates.length
        }).eq('id', mistakeId);
        spawnEmoji('➖');
    }
    renderHistory();
}

// ==================== Effects ====================
function spawnEmoji(emoji) {
    const el = document.createElement('div'); el.className = 'floating-emoji'; el.textContent = emoji;
    el.style.left = Math.random() * 80 + 10 + '%'; el.style.bottom = '10%';
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.bottom = '110%'; el.style.opacity = '0'; });
    setTimeout(() => el.remove(), 2100);
}
function launchConfetti() {
    const colors = ['#FB923C', '#F97316', '#FDBA74', '#FDE68A', '#34D399', '#60A5FA', '#A78BFA'];
    for (let i = 0; i < 50; i++) { setTimeout(() => { const p = document.createElement('div'); p.className = 'confetti-piece'; p.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)]; p.style.left = Math.random() * 100 + '%'; p.style.top = '100%'; p.style.width = (Math.random() * 8 + 5) + 'px'; p.style.height = (Math.random() * 8 + 5) + 'px'; p.style.transition = `all ${1.5 + Math.random() * 2}s cubic-bezier(0.1,0.5,0.5,1)`; document.body.appendChild(p); requestAnimationFrame(() => { p.style.top = (Math.random() * 40 + 10) + '%'; p.style.left = (parseFloat(p.style.left) + (Math.random() * 20 - 10)) + '%'; p.style.opacity = '0'; p.style.transform = `rotate(${Math.random() * 1080}deg)`; }); setTimeout(() => p.remove(), 3500); }, i * 30); }
}
