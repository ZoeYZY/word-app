// ==================== Supabase Client ====================
const SUPABASE_URL = 'https://wonshabdlvjzdtiicsjf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_KkLWWWQJ3Nc4SCJ_GI22Tw_zagGImcV';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

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
    // Migrate any localStorage dictation records to Supabase
    await migrateLocalDictationRecords();
    // Auto-seed from words.js if user's DB is empty
    if (!lessons.length && typeof WORDS_DATA !== 'undefined' && WORDS_DATA.length) {
        for (const u of WORDS_DATA) {
            for (const l of u.lessons) {
                await dbAddLesson({ name: l.name, unit: u.unit, words: [...l.words] });
            }
        }
        lessons = await dbGetLessons();
    }
    // Default tab
    switchTab('library');
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
        console.error('dbSaveDictationRecord FAILED - falling back to localStorage.', error.message,
            '\n⚠️ 请确保 Supabase 中已创建 dictation_records 表并配置了 RLS 策略。');
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

async function migrateLocalDictationRecords() {
    const key = 'yoyo_dictation_records_' + currentUserId;
    const raw = localStorage.getItem(key);
    if (!raw) return;
    try {
        const records = JSON.parse(raw);
        if (!records.length) { localStorage.removeItem(key); return; }
        console.log(`Migrating ${records.length} local dictation records to Supabase...`);
        for (const record of records) {
            const { error } = await sb.from('dictation_records')
                .insert({ ...record, user_id: currentUserId });
            if (error) {
                console.warn('Migration failed, keeping localStorage:', error.message);
                return; // 表不存在则保留 localStorage 数据
            }
        }
        localStorage.removeItem(key);
        console.log('Migration complete, localStorage cleared.');
    } catch (e) {
        console.warn('Migration parse error:', e);
    }
}

// ==================== State ====================
let lessons = [], currentWords = [], currentIndex = 0;
let pendingUnits = [];
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
    voiceSource: 'online',    // 'browser' | 'online' | 'custom'
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
    select.innerHTML = voices
        .filter(v => v.lang.includes('zh') || v.lang.includes('CN') || v.lang.includes('HK') || v.lang.includes('TW'))
        .map(v => `<option value="${v.voiceURI}" ${v.voiceURI === current ? 'selected' : ''}>${v.name} (${v.lang})</option>`)
        .join('') || '<option value="">无可用中文语音</option>';
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
function createVoicePack() {
    const name = prompt('请输入语音包名称（如：妈妈的声音）');
    if (!name || !name.trim()) return;
    const id = 'pack_' + Date.now();
    appSettings.voicePacks.push({ id, name: name.trim() });
    localStorage.setItem('yoyo_settings', JSON.stringify(appSettings));
    renderVoicePackList();
    spawnEmoji('🎉');
}

async function deleteVoicePack(packId) {
    if (packId === 'default') { alert('默认录音不能删除'); return; }
    if (!confirm('确定删除这个语音包及其所有录音吗？')) return;
    // Delete all recordings in this pack
    const db = await AudioDB.open();
    const tx = db.transaction('audio', 'readwrite');
    const store = tx.objectStore('audio');
    const req = store.getAll();
    req.onsuccess = () => {
        const all = req.result || [];
        all.forEach(r => {
            if (r.word && r.word.startsWith(`pack_${packId}::`)) {
                store.delete(r.word);
                delete audioCache[r.word];
            }
        });
    };
    // Remove from packs list
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
        const db = await this.open();
        const key = packId ? `pack_${packId}::${word}` : word;
        return new Promise((resolve, reject) => {
            const tx = db.transaction('audio', 'readwrite');
            tx.objectStore('audio').put({ word: key, dataUrl, ts: Date.now() });
            tx.oncomplete = () => { audioCache[key] = dataUrl; resolve(); };
            tx.onerror = () => reject(tx.error);
        });
    },
    async get(word, packId) {
        const key = packId ? `pack_${packId}::${word}` : word;
        if (audioCache[key]) return audioCache[key];
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('audio', 'readonly');
            const req = tx.objectStore('audio').get(key);
            req.onsuccess = () => { const r = req.result; if (r) audioCache[key] = r.dataUrl; resolve(r ? r.dataUrl : null); };
            req.onerror = () => reject(req.error);
        });
    },
    async delete(word, packId) {
        const db = await this.open();
        const key = packId ? `pack_${packId}::${word}` : word;
        return new Promise((resolve, reject) => {
            const tx = db.transaction('audio', 'readwrite');
            tx.objectStore('audio').delete(key);
            tx.oncomplete = () => { delete audioCache[key]; resolve(); };
            tx.onerror = () => reject(tx.error);
        });
    },
    async loadAll() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('audio', 'readonly');
            const req = tx.objectStore('audio').getAll();
            req.onsuccess = () => { (req.result || []).forEach(r => { audioCache[r.word] = r.dataUrl; }); resolve(); };
            req.onerror = () => reject(req.error);
        });
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
        await AudioDB.save(word, dataUrl);
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
        const u = l.unit || '默认单元';
        if (!map[u]) map[u] = [];
        map[u].push(l);
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

// ==================== Common Text → Units Parser ====================
function parseTextToUnits(fullText, manualName) {
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

    let units = [];

    // Format A: [{unit, lessons: [{name, words}]}] (same as WORDS_DATA)
    if (Array.isArray(json) && json.length > 0 && json[0].unit && json[0].lessons) {
        for (const u of json) {
            const unitLessons = (u.lessons || []).map(l => ({ name: l.name || '未命名课文', words: Array.isArray(l.words) ? [...l.words] : [] })).filter(l => l.words.length > 0);
            if (unitLessons.length) units.push({ unitName: u.unit || '默认单元', lessons: unitLessons });
        }
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
        if (lessons.length) units = [{ unitName: '默认单元', lessons }];
    }
    // Format C: ["词1", "词2", "词3"]
    else if (Array.isArray(json) && json.length > 0 && typeof json[0] === 'string') {
        const words = json.filter(w => typeof w === 'string' && w.trim());
        const manualName = document.getElementById('lessonName').value.trim();
        if (words.length) units = [{ unitName: '默认单元', lessons: [{ name: manualName || '未命名课文', words }] }];
    }

    if (!units.length) {
        statusEl.textContent = '😢 JSON 中没有发现可导入的词语';
        document.getElementById('previewArea').classList.add('hidden');
        return;
    }
    pendingUnits = units;
    const totalL = units.reduce((s, u) => s + u.lessons.length, 0);
    const totalW = units.reduce((s, u) => s + u.lessons.reduce((s2, l) => s2 + l.words.length, 0), 0);
    statusEl.textContent = `✅ 识别了 ${units.length} 个单元, ${totalL} 课, ${totalW} 个词语！`;
    renderMultiPreview();
}

// ==================== Apply Parse Result Helper ====================
function applyParseResult(result, statusEl) {
    if (result.mode === 'empty') {
        statusEl.textContent = '😢 没有发现词语';
        document.getElementById('previewArea').classList.add('hidden');
        return;
    }
    pendingUnits = result.units;
    if (result.mode === 'structured') {
        const totalL = result.units.reduce((s, u) => s + u.lessons.length, 0);
        const totalW = result.units.reduce((s, u) => s + u.lessons.reduce((s2, l) => s2 + l.words.length, 0), 0);
        statusEl.textContent = `✅ 识别了 ${result.units.length} 个单元, ${totalL} 课, ${totalW} 个词语！`;
    } else {
        const count = result.units[0].lessons[0].words.length;
        statusEl.textContent = `✅ 找到了 ${count} 个词语！`;
    }
    renderMultiPreview();
}

// ==================== Interactive Preview ====================
function renderMultiPreview() {
    const container = document.getElementById('previewContent');
    container.innerHTML = '';
    const totalL = pendingUnits.reduce((s, u) => s + u.lessons.length, 0);
    const totalW = pendingUnits.reduce((s, u) => s + u.lessons.reduce((s2, l) => s2 + l.words.length, 0), 0);
    const summary = document.createElement('div');
    summary.className = 'flex items-center justify-between mb-3';
    summary.innerHTML = `<p class="text-sm font-bold text-gray-600">🔍 ${pendingUnits.length} 个单元, ${totalL} 课, ${totalW} 个词语</p><p class="text-xs text-gray-400">💡 可编辑名称 · 拖拽词语到其他课文</p>`;
    container.appendChild(summary);

    pendingUnits.forEach((unit, ui) => {
        const unitCard = document.createElement('div'); unitCard.className = 'unit-card mb-4';
        const unitHeader = document.createElement('div'); unitHeader.className = 'flex items-center gap-2 mb-2';
        unitHeader.innerHTML = '<span class="text-lg">📦</span>';
        const unitInput = document.createElement('input'); unitInput.type = 'text'; unitInput.value = unit.unitName;
        unitInput.className = 'unit-name-input'; unitInput.style.width = Math.max(120, unit.unitName.length * 16) + 'px';
        unitInput.addEventListener('input', () => { unit.unitName = unitInput.value; unitInput.style.width = Math.max(120, unitInput.value.length * 16) + 'px'; });
        const unitStats = document.createElement('span'); unitStats.className = 'preview-stats'; unitStats.textContent = `${unit.lessons.length} 课`;
        const unitDelBtn = document.createElement('button'); unitDelBtn.className = 'text-gray-300 hover:text-red-400 text-sm ml-auto cursor-pointer'; unitDelBtn.textContent = '🗑️';
        unitDelBtn.onclick = () => { pendingUnits.splice(ui, 1); if (!pendingUnits.length) document.getElementById('previewArea').classList.add('hidden'); renderMultiPreview(); };
        unitHeader.appendChild(unitInput); unitHeader.appendChild(unitStats); unitHeader.appendChild(unitDelBtn);
        unitCard.appendChild(unitHeader);

        unit.lessons.forEach((lesson, li) => {
            const lessonCard = document.createElement('div'); lessonCard.className = 'preview-lesson mb-2 ml-4';
            lessonCard.addEventListener('dragover', (e) => { e.preventDefault(); lessonCard.classList.add('drag-over'); });
            lessonCard.addEventListener('dragleave', () => lessonCard.classList.remove('drag-over'));
            lessonCard.addEventListener('drop', (e) => {
                e.preventDefault(); lessonCard.classList.remove('drag-over');
                if (!dragData) return; if (dragData.unitIdx === ui && dragData.lessonIdx === li) return;
                const word = dragData.word;
                const srcUnit = pendingUnits[dragData.unitIdx];
                if (srcUnit) { const srcLesson = srcUnit.lessons[dragData.lessonIdx]; if (srcLesson) { srcLesson.words.splice(dragData.wordIdx, 1); if (!srcLesson.words.length) { srcUnit.lessons.splice(dragData.lessonIdx, 1); if (!srcUnit.lessons.length) pendingUnits.splice(dragData.unitIdx, 1); } } }
                if (!lesson.words.includes(word)) lesson.words.push(word);
                dragData = null; renderMultiPreview();
            });
            const lDelBtn = document.createElement('button'); lDelBtn.className = 'preview-delete-btn'; lDelBtn.textContent = '🗑️';
            lDelBtn.onclick = () => { unit.lessons.splice(li, 1); if (!unit.lessons.length) pendingUnits.splice(ui, 1); if (!pendingUnits.length) document.getElementById('previewArea').classList.add('hidden'); renderMultiPreview(); };
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
                delW.onclick = (e) => { e.stopPropagation(); lesson.words.splice(wi, 1); if (!lesson.words.length) { unit.lessons.splice(li, 1); if (!unit.lessons.length) pendingUnits.splice(ui, 1); } if (!pendingUnits.length) document.getElementById('previewArea').classList.add('hidden'); renderMultiPreview(); };
                tag.appendChild(delW);
                tag.addEventListener('dragstart', (e) => { dragData = { unitIdx: ui, lessonIdx: li, wordIdx: wi, word: w }; tag.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', w); });
                tag.addEventListener('dragend', () => { tag.classList.remove('dragging'); dragData = null; });
                wordsDiv.appendChild(tag);
            });
            lessonCard.appendChild(lDelBtn); lessonCard.appendChild(lHeader); lessonCard.appendChild(wordsDiv);
            unitCard.appendChild(lessonCard);
        });
        container.appendChild(unitCard);
    });
    document.getElementById('previewArea').classList.remove('hidden');
}

async function confirmImport() {
    if (!pendingUnits.length) return;
    for (const u of pendingUnits) {
        if (!u.unitName.trim()) { alert('🌸 有单元名称为空，请填写！'); return; }
        for (const l of u.lessons) { if (!l.name.trim()) { alert('🌸 有课文名称为空，请填写！'); return; } }
    }
    for (const u of pendingUnits) {
        for (const l of u.lessons) {
            const name = l.name.trim(), unitName = u.unitName.trim();
            let existing = lessons.find(x => x.name === name && x.unit === unitName);
            if (existing) {
                const set = new Set(existing.words); l.words.forEach(w => set.add(w)); existing.words = [...set];
                await dbPutLesson(existing);
            } else {
                await dbAddLesson({ name, unit: unitName, words: l.words });
            }
        }
    }
    lessons = await dbGetLessons(); renderLibrary();
    pendingUnits = [];
    document.getElementById('previewArea').classList.add('hidden');
    document.getElementById('uploadStatus').textContent = '🎉 导入成功！';
    document.getElementById('pdfInput').value = '';
    document.getElementById('lessonName').value = '';
    spawnEmoji('🌈');
}

// ==================== Manual Add ====================
async function addManualWords() {
    const name = document.getElementById('manualLesson').value.trim();
    const str = document.getElementById('manualWords').value.trim();
    const unitName = document.getElementById('manualUnit')?.value.trim() || '默认单元';
    if (!name || !str) { alert('🌸 请填写名称和词语！'); return; }
    const words = str.split(/[\s,，、;；]+/).filter(w => w.length >= 1);
    if (!words.length) return;
    let lesson = lessons.find(l => l.name === name && l.unit === unitName);
    if (lesson) {
        const set = new Set(lesson.words); words.forEach(w => set.add(w)); lesson.words = [...set];
        await dbPutLesson(lesson);
    } else {
        await dbAddLesson({ name, unit: unitName, words: [...new Set(words)] });
    }
    lessons = await dbGetLessons(); renderLibrary();
    document.getElementById('manualWords').value = '';
    spawnEmoji('✨');
}


// ==================== Library UI (Unit > Lesson > Words) ====================
let libDragData = null;
let expandedUnits = new Set();
let expandedLessons = new Set();

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

function updateUnitBadge(unitName) {
    const grouped = groupByUnit(lessons);
    const uLessons = grouped[unitName];
    if (!uLessons) return;
    const tw = uLessons.reduce((s, l) => s + l.words.length, 0);
    const badges = document.querySelectorAll('#libraryContent .bg-brand-100');
    badges.forEach(b => {
        if (b.textContent.includes('课') && b.textContent.includes('词')) {
            const parentDiv = b.closest('.mb-4');
            if (parentDiv) {
                const unitInput = parentDiv.querySelector('.unit-name-input');
                if (unitInput && unitInput.value === unitName) {
                    b.textContent = `${uLessons.length} 课 · ${tw} 词`;
                }
            }
        }
    });
}

async function renderLibrary() {
    const container = document.getElementById('libraryContent');
    const emptyMsg = document.getElementById('emptyLibrary');
    lessons = await dbGetLessons();
    document.getElementById('lessonCount').textContent = `${lessons.length} 课`;
    let mm = {};
    try { (await dbGetMistakes()).forEach(m => { mm[m.char] = m.count; }); } catch (e) { }
    if (!lessons.length) { container.innerHTML = ''; emptyMsg.classList.remove('hidden'); return; }
    emptyMsg.classList.add('hidden');
    container.innerHTML = '';

    const grouped = groupByUnit(lessons);
    let uidx = 0;
    for (const unitName in grouped) {
        const uLessons = grouped[unitName];
        const tw = uLessons.reduce((s, l) => s + l.words.length, 0);
        const uDiv = document.createElement('div'); uDiv.className = 'mb-4 animate-slide-up'; uDiv.style.animationDelay = (uidx * 0.08) + 's';

        const uHead = document.createElement('div'); uHead.className = 'flex items-center gap-2 mb-2';
        const uArrow = document.createElement('span'); uArrow.className = 'text-brand-500 transition-transform text-sm font-bold cursor-pointer'; uArrow.textContent = '▶';
        const uIcon = document.createElement('span'); uIcon.textContent = '📦 '; uIcon.className = 'cursor-pointer';
        const uInput = document.createElement('input'); uInput.type = 'text'; uInput.value = unitName;
        uInput.className = 'unit-name-input'; uInput.style.width = Math.max(80, unitName.length * 16) + 'px';
        uInput.addEventListener('input', () => { uInput.style.width = Math.max(80, uInput.value.length * 16) + 'px'; });
        uInput.addEventListener('blur', async () => {
            const n = uInput.value.trim();
            if (n && n !== unitName) {
                expandedUnits.delete(unitName); expandedUnits.add(n);
                for (const l of uLessons) { l.unit = n; await dbPutLesson(l); }
                lessons = await dbGetLessons(); renderLibrary();
            }
        });
        const uBadge = document.createElement('span'); uBadge.className = 'text-xs bg-brand-100 text-brand-600 px-2 py-0.5 rounded-full font-bold'; uBadge.textContent = `${uLessons.length} 课 · ${tw} 词`;
        const uBody = document.createElement('div'); uBody.className = 'ml-2 space-y-2';
        // Restore expand state
        const isUnitExpanded = expandedUnits.has(unitName);
        if (!isUnitExpanded) uBody.classList.add('hidden');
        if (isUnitExpanded) uArrow.style.transform = 'rotate(90deg)';

        const toggleU = () => {
            uBody.classList.toggle('hidden');
            const nowHidden = uBody.classList.contains('hidden');
            uArrow.style.transform = nowHidden ? '' : 'rotate(90deg)';
            if (nowHidden) expandedUnits.delete(unitName); else expandedUnits.add(unitName);
        };
        uArrow.onclick = toggleU; uIcon.onclick = toggleU;
        uHead.appendChild(uArrow); uHead.appendChild(uIcon); uHead.appendChild(uInput); uHead.appendChild(uBadge);
        uDiv.appendChild(uHead);

        uLessons.forEach(lesson => {
            const lessonKey = `${unitName}::${lesson.id}`;
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
            // Restore lesson expand state
            const isLessonExpanded = expandedLessons.has(lessonKey);
            if (!isLessonExpanded) wordsArea.classList.add('hidden');
            if (isLessonExpanded) lArrow.style.transform = 'rotate(90deg)';

            const wordsDiv = document.createElement('div'); wordsDiv.className = 'flex flex-wrap gap-2 mb-2';
            rebuildWordsDiv(wordsDiv, lesson, mm);

            // Batch record button
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
                updateUnitBadge(unitName);
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

        uDiv.appendChild(uBody); container.appendChild(uDiv); uidx++;
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

    const grouped = groupByUnit(lessons);
    let html = '';
    for (const unitName in grouped) {
        html += `<div class="mb-3">
      <div class="flex items-center gap-2 mb-1.5">
        <input type="checkbox" class="unit-checkbox w-5 h-5 accent-orange-500 rounded cursor-pointer" data-unit="${unitName}" onchange="toggleUnitCheck(this)" />
        <span class="font-extrabold text-gray-700 text-sm cursor-pointer" onclick="this.previousElementSibling.click()">📦 ${unitName}</span>
      </div>
      <div class="ml-6 space-y-1.5">`;
        grouped[unitName].forEach((lesson) => {
            const realIdx = lessons.indexOf(lesson);
            html += `<label class="lesson-check flex items-center gap-3 !py-2 !px-3">
        <input type="checkbox" value="${realIdx}" data-unit="${unitName}" class="lesson-checkbox w-4 h-4 accent-orange-500 rounded cursor-pointer" onchange="updateStartBtn();this.closest('.lesson-check').classList.toggle('checked',this.checked);syncUnitCheckbox('${unitName}')" />
        <div class="flex-1"><span class="font-bold text-gray-700 text-sm">${lesson.name}</span><span class="text-gray-400 text-xs ml-2">${lesson.words.length} 词</span></div>
      </label>`;
        });
        html += `</div></div>`;
    }
    container.innerHTML = html;
    updateStartBtn();
}

function toggleUnitCheck(unitCb) {
    const unit = unitCb.dataset.unit, checked = unitCb.checked;
    document.querySelectorAll(`.lesson-checkbox[data-unit="${unit}"]`).forEach(cb => { cb.checked = checked; cb.closest('.lesson-check').classList.toggle('checked', checked); });
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
    updateStartBtn();
}

function syncUnitCheckbox(unitName) {
    const all = document.querySelectorAll(`.lesson-checkbox[data-unit="${unitName}"]`);
    const checkedCount = document.querySelectorAll(`.lesson-checkbox[data-unit="${unitName}"]:checked`).length;
    const ucb = document.querySelector(`.unit-checkbox[data-unit="${unitName}"]`);
    if (ucb) ucb.checked = checkedCount === all.length;
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

    // 4. Final fallback: browser SpeechSynthesis
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = appSettings.rate;
    u.pitch = appSettings.pitch;
    const voices = window.speechSynthesis.getVoices();
    const selectedVoice = voices.find(v => v.voiceURI === appSettings.voiceURI);
    if (selectedVoice) u.voice = selectedVoice;
    else {
        const zh = voices.find(v => v.lang.startsWith('zh'));
        if (zh) u.voice = zh;
    }
    window.speechSynthesis.speak(u);
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
let _submittingMistakes = false;
function finishDictation() {
    _submittingMistakes = false; // reset guard for new round
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
    if (_submittingMistakes) return; // prevent double-submit
    _submittingMistakes = true;
    const uniq = {};
    for (const key of selectedChars) { const m = selectedCharMeta[key]; if (m && !uniq[m.char]) uniq[m.char] = m; }
    for (const k in uniq) { const m = uniq[k]; await recordCharMistake(m.char, m.word, m.lesson); }
    // Collect wrong words (unique) from selected chars
    const wrongWordsSet = new Set();
    for (const key of selectedChars) { const m = selectedCharMeta[key]; if (m) wrongWordsSet.add(m.word); }
    await saveDictationRecord([...wrongWordsSet]);
    showSuccessScreen(Object.keys(uniq).length);
}
function skipMistakes() { if (_submittingMistakes) return; _submittingMistakes = true; saveDictationRecord([]); showSuccessScreen(0); }

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
    let html = '';
    for (const name in byLesson) {
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
