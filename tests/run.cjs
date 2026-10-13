// Автотесты логики модулей пакета (без телевизора и без сети): node tests/run.cjs
// Запускаются из pack.py перед каждой сборкой.
const fs = require('fs'), vm = require('vm'), path = require('path');
const SRC = path.join(__dirname, '..', 'src');
let pass = 0, fail = 0;
function t(name, cond) { if (cond) pass++; else { fail++; console.log('FAIL', name); } }

function load(file, name, store) {
    store = store || {};
    const ls = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
    const w = { localStorage: ls, appready: false };
    const ctx = { window: w, XMLHttpRequest: function () {}, Node: function () {}, document: { hidden: false, addEventListener() {} },
        navigator: { userAgent: 'test', onLine: true }, location: { reload() {} }, setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, clearInterval() {},
        console, JSON, Math, Date, Infinity, String, Array, Object, Number, Promise, parseInt, parseFloat, isNaN };
    ctx.XMLHttpRequest.prototype = { open() {}, send() {} }; ctx.Node.prototype = { appendChild() {} };
    w.window = w; vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(SRC, file), 'utf8') + ';this.M=' + name + ';', ctx);
    return { M: ctx.M, store };
}

/* ---- skazauto.js: решения о переключении серверов ---- */
const S = (m, j, l) => m === null ? { ok: 0, loss: 1, median: null, jitter: null, score: Infinity } : { ok: 4, loss: l || 0, median: m, jitter: j || 0, score: m + 2 * (j || 0) + (l || 0) * 1500 };
const res = (d, o) => ({ domains: d, online: o, time: 1 });
const ON = { online3: S(80), online4: S(90), online5: S(85), online7: S(95), onlinecf3: S(120), onlinecf4: S(130), onlinecf5: S(125), onlinecf7: S(140) };
const DEAD_DIRECT = Object.assign({}, ON, { online3: S(null), online4: S(null), online5: S(null), online7: S(null) });
function decide(store, r, mode) { const x = load('skazauto.js', 'BSSkaz', store); return { r: x.M._decide(r, mode), store: x.store }; }
let x;
x = decide({ skaz_domain: 'skaz.tv' }, res({ 'skaz.tv': S(null), 'skaztv.top': S(60) }, ON), 'fast'); t('серверы: мёртвый домен до запуска -> лучший', x.store.skaz_domain === 'skaztv.top');
x = decide({ skaz_domain: 'skaz.tv' }, res({ 'skaz.tv': S(400), 'skaztv.top': S(60) }, ON), 'fast'); t('серверы: медленный, но живой — до запуска не трогаем', x.store.skaz_domain === 'skaz.tv');
x = decide({ skaz_domain: 'skaz.tv' }, res({ 'skaz.tv': S(400), 'skaztv.top': S(60) }, ON), 'full'); t('серверы: заметно медленнее -> со следующего запуска (пока не трогаем текущий)', x.store.skaz_domain === 'skaz.tv' && JSON.parse(x.store.bs_srv_pending).domain === 'skaztv.top' && x.r === false);
function decide2(store, r) { const m = load('skazauto.js', 'BSSkaz', store); const r1 = m.M._decide(r, 'full'), r2 = m.M._decide(r, 'full'); return { r1, r2, store: m.store }; }
let x2 = decide2({ skaz_domain: 'skaz.tv' }, res({ 'skaz.tv': S(100, 0, 0.75), 'skaz.team': S(110) }, ON));
t('серверы: потери 75% — первый замер только подозрение', x2.r1 === false);
t('серверы: потери 75% два замера подряд -> переключение + перезапуск', x2.r2 === true && x2.store.skaz_domain === 'skaz.team');
x = decide({ skaz_domain: 'skaz.tv' }, res({ 'skaz.tv': S(100, 300), 'skaz.team': S(110, 10) }, ON), 'full'); t('серверы: джиттер ±300 -> стабильный (со следующего запуска)', JSON.parse(x.store.bs_srv_pending).domain === 'skaz.team');
x2 = decide2({ skaz_domain: 'skaz.tv' }, res({ 'skaz.tv': S(80) }, DEAD_DIRECT)); t('серверы: прямые мертвы два замера -> Cloudflare', x2.store.skazonline_servers === 'true' && x2.r2 === true);
x2 = decide2({ skaz_domain: 'skaz.tv' }, res({ 'skaz.tv': S(100, 0, 0.75), 'skaz.team': S(110, 0, 0.25) }, ON)); t('серверы: на сервер с потерями не переключаемся', x2.store.skaz_domain === 'skaz.tv' && x2.r2 === false);
x = decide({ skaz_domain: 'skaz.tv', bs_srv_manual: String(Date.now()) }, res({ 'skaz.tv': S(400), 'skaztv.top': S(60) }, ON), 'full'); t('серверы: выбран вручную — советы «быстрее» не перебивают', !x.store.bs_srv_pending);
x = decide({ skaz_domain: 'skaz.tv' }, res({ 'skaz.tv': S(120), 'skaztv.top': S(90) }, ON), 'full'); t('серверы: малая разница — не прыгаем', x.store.skaz_domain === 'skaz.tv');
x = decide({ skaz_domain: 'skaz.tv' }, res({ 'skaz.tv': S(null), 'skaz.team': S(null) }, ON), 'full'); t('серверы: все мертвы — ничего не меняем', x.store.skaz_domain === 'skaz.tv');
const st = load('skazauto.js', 'BSSkaz').M._stats([100, 140, 100], 4); t('серверы: медиана/джиттер/потери', st.median === 100 && st.jitter === 40 && st.loss === 0.25);

/* ---- bsplayer.js: метки и главы ---- */
const P = load('bsplayer.js', 'BSPlayer').M;
const J = o => JSON.stringify(o);
t('метки: за концом файла отбрасываются', J(P._toLampa([{ kind: 'intro', start: 0, end: 99 }, { kind: 'credits', start: 3227, end: 3300 }], 635).skip) === J([{ start: 0, end: 99, kind: 'intro' }]));
t('метки: перекрывающая конец обрезается', J(P._toLampa([{ kind: 'credits', start: 600, end: 700 }], 635).skip) === J([{ start: 600, end: 635, kind: 'credits' }]));
t('метки: реклама отдельно', P._toLampa([{ kind: 'ad', start: 0, end: 20 }, { kind: 'recap', start: 20, end: 80 }], 3000).ad.length === 1);
t('метки: мусор не проходит', (r => !r.skip.length && !r.ad.length)(P._toLampa([{ kind: 'intro', start: -5, end: 10 }, { kind: 'intro', start: 50, end: 50 }, { kind: 'x' }], 3000)));
t('метки: непроверенные при автопропуске не берём (перематывали фильм)', (r => r.skip.length === 1 && r.skip[0].start === 3509 && r.dropped === 1)(P._toLampa([{ kind: 'intro', start: 338, end: 398, trusted: false }, { kind: 'credits', start: 3509, end: 3558, trusted: true }], 3558)));
t('главы: сортировка и пустые названия', J(P._parseChapters([{ start_sec: 120, title: ' B ' }, { start_sec: 0, title: 'A' }, { start_sec: 5, title: '' }]).map(c => c.title)) === J(['A', 'B']));

t('главы: HTML в названии не выполняется', J(P._parseChapters([{ start_sec: 1, title: '<img src=x onerror=alert(1)>', description: '"x"&' }])) === J([{ start: 1, title: '&lt;img src=x onerror=alert(1)&gt;', descr: '&quot;x&quot;&amp;' }]));

/* ---- bsfeatures.js: метка кэша для плагинов ---- */
const F = load('bsfeatures.js', 'BSFeatures').M;
t('кэш: плагин byskaz получает метку', /_bs=\d+$/.test(F._freshUrl('http://lampa.byskaz.ru/plugins/p.js?v=3')));
t('кэш: саму Lampa не трогаем', F._freshUrl('http://lampa.byskaz.ru/lampa-main/app.min.js?v1') === '');
t('кэш: чужие хосты не трогаем', F._freshUrl('https://cub.best/plugin/x.js') === '');
t('кэш: метка ставится до #, а не во фрагмент', /\?_bs=[\d-]+#h$/.test(F._freshUrl('http://lampa.byskaz.ru/plugins/p.js#h')));

{
    // «Сон»: кнопка по кругу и выключение ТВ через сетевой пульт
    const store = {}, sent = [];
    let sock;
    function WS(url) { sock = this; this.url = url; this.send = d => sent.push(JSON.parse(d)); this.close = () => {}; }
    const w = { localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } } };
    const ctx = { window: w, XMLHttpRequest: function () {}, Node: function () {}, document: {}, console: { log() {} }, WebSocket: WS, btoa: x => Buffer.from(x).toString('base64'),
        setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, Lampa: { Noty: { show() {} } } };
    ctx.XMLHttpRequest.prototype = { open() {} }; ctx.Node.prototype = { appendChild() {} }; w.window = w; vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(SRC, 'bsfeatures.js'), 'utf8') + ';this.M=BSFeatures;', ctx);
    const SF = ctx.M;
    SF._sleepNext(); t('сон: первое нажатие — после серии/фильма', SF._sleepMode() === 'episode');
    SF._sleepNext(); t('сон: второе — 30 мин', SF._sleepMode() === 'timer' && /30/.test(SF._sleepLabel()));
    SF._sleepNext(); SF._sleepNext(); t('сон: четвёртое — 90 мин', SF._sleepMode() === 'timer' && /90/.test(SF._sleepLabel()));
    SF._sleepNext(); t('сон: по кругу — выключен', SF._sleepMode() === '0');
}

{
    // громкость: память по карточке, ночной предел
    const store = {};
    const w = { localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } } };
    const ctx = { window: w, console: { log() {} }, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, Object, Lampa: {} };
    w.window = w; vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(SRC, 'bsvolume.js'), 'utf8') + ';this.M=BSVolume;', ctx);
    const V = ctx.M;
    t('громкость: запомненная ставится', V._target(11, 18, 0).vol === 18);
    t('громкость: та же — не трогать', V._target(11, 11, 0) === null);
    t('громкость: не запоминали — не трогать', V._target(11, -1, 0) === null);
    t('громкость: ночью не громче предела', (r => r.vol === 15 && r.why === 'night')(V._target(11, 30, 15)));
    t('громкость: ночью тише предела — не трогать', V._target(11, -1, 15) === null);
    store.bs_vol_memory = 'false';
    t('громкость: память выключена — не ставить', V._target(11, 18, 0) === null);
    store.bs_vol_night = '20';
    t('громкость: ночь — 23:30 да, 12:00 нет', V._nightCap(new Date(2026, 9, 13, 23, 30)) === 20 && V._nightCap(new Date(2026, 9, 13, 12, 0)) === 0);
    t('громкость: сериал и фильм — разные ключи', V._cardKey({ card: { id: 5, name: 'X' } }) === 'tv:5' && V._cardKey({ movie: { id: 5, title: 'X' } }) === 'movie:5');
}

{
    // люди по каналу ТВ: запись кусками, старая версия не затирает новую
    const store = {};
    const ctx = { window: {}, console: { log() {} }, Date, Math, JSON, String, Object, Array, parseInt, setTimeout: () => 0, setInterval: () => 0, XMLHttpRequest: function () { this.open = () => {}; this.send = () => {}; } };
    ctx.window = ctx; ctx.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
    vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(SRC, 'bstg.js'), 'utf8') + ';this.M=BSTelegram;', ctx);
    const U = ctx.M, rec = JSON.stringify({ name: 'Аня', want: [{ id: 5, tv: true, name: 'X'.repeat(1500) }], rev: 200 });
    const parts = [rec.slice(0, 900), rec.slice(900)];
    U._onUserPart({ t: 'u', id: '77', rev: 200, i: 1, n: 2, d: parts[1] });
    t('люди по каналу: пока не все куски — не записываем', !store.bs_tg_users);
    U._onUserPart({ t: 'u', id: '77', rev: 200, i: 0, n: 2, d: parts[0] });
    t('люди по каналу: куски собраны в запись', JSON.parse(store.bs_tg_users)['77'].name === 'Аня');
    U._onUserPart({ t: 'u', id: '77', rev: 100, i: 0, n: 1, d: JSON.stringify({ name: 'старое', rev: 100 }) });
    t('люди по каналу: старая версия новую не затирает', JSON.parse(store.bs_tg_users)['77'].name === 'Аня');
}

{
    // Gemini: ключ человека — во всех запросах цепочки моделей, даже когда ответ приходит позже
    const store = { bs_tg_chat: '1', bs_gemini_keys: JSON.stringify({ '2': 'GUESTKEY' }), bs_gemini_key: 'OWNERKEY', bs_tg_users: JSON.stringify({ '2': { name: 'Аня' } }) };
    const sent = [], pending = [];
    function X() { const x = this; x.h = {}; x.open = (m, u) => { x.u = u; }; x.setRequestHeader = (k, v) => { x.h[k] = v; }; x.send = () => { sent.push(x); pending.push(x); }; }
    const ctx = { window: {}, console: { log() {} }, Date, Math, JSON, String, Object, Array, parseInt, setTimeout: () => 0, setInterval: () => 0, XMLHttpRequest: X };
    ctx.window = ctx; ctx.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
    vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(SRC, 'bstg.js'), 'utf8') + ';this.M=BSTelegram;', ctx);
    const G = ctx.M;
    G._as('2', () => G._geminiRun([{ text: 'x' }], () => {}, () => {}));
    let m = pending.shift();                                        // список моделей
    m.status = 200; m.responseText = JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }); m.onload();
    let a = pending.shift(); a.status = 503; a.responseText = '{"error":{"message":"high demand"}}'; a.onload();   // ответ — уже вне контекста человека
    const b2 = pending.shift();
    t('Gemini: вторая модель — тоже с ключом человека, не владельца', a.h['x-goog-api-key'] === 'GUESTKEY' && b2 && b2.h['x-goog-api-key'] === 'GUESTKEY');
}

{
    const ctx = { window: {}, console: { log() {} }, Date, Math, JSON, String, Object, Array, parseInt, setTimeout: () => 0, setInterval: () => 0 };
    ctx.window = ctx; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(SRC, 'bstg.js'), 'utf8') + ';this.M=BSTelegram;', ctx);
    const A = ctx.M, gm = text => ({ candidates: [{ content: { parts: [{ text }] } }] });
    const many = A._fromGeminiList(gm('{"sure":false,"items":[{"title":"Интерстеллар","original_title":"Interstellar","year":2014,"type":"movie"},{"title":"Гравитация","original_title":"Gravity","year":2013}]}'));
    t('ИИ: «про космос» — несколько фильмов', many && many.items.length === 2 && many.items[0].query === 'Interstellar 2014' && !many.sure);
    const one = A._fromGeminiList(gm('{"sure":true,"items":[{"title":"Марсианин","original_title":"The Martian","year":2015}]}'));
    t('ИИ: конкретный фильм — один, уверенно', one.items.length === 1 && one.sure);
    t('ИИ: старый ответ одним объектом тоже понимаем', A._fromGeminiList(gm('{"title":"Солдаты","original_title":"Солдаты","year":2004}')).items[0].query === 'Солдаты 2004');
    t('ИИ: пусто — null', A._fromGeminiList(gm('{"items":[]}')) === null);
    t('ИИ: Flash — без долгого обдумывания, 2.0 и Pro — как есть', JSON.parse(A._geminiBody([], 'gemini-2.5-flash')).generationConfig.thinkingConfig.thinkingBudget === 0 &&
        !JSON.parse(A._geminiBody([], 'gemini-2.0-flash')).generationConfig.thinkingConfig && !JSON.parse(A._geminiBody([], 'gemini-2.5-pro')).generationConfig.thinkingConfig &&
        !JSON.parse(A._geminiBody([], 'gemini-2.5-flash', true)).generationConfig.thinkingConfig);
}

{
    // «Подписаться» на ТВ: людей несколько — выбрать, кому; подписка и подтверждение — выбранному
    const store = { bs_tg_chat: '1', bs_tg_token: '123:abc', bs_tg_users: JSON.stringify({ '2': { name: 'Аня', subs: [], want: [] } }) };
    const urls = []; let sel = null;
    function X() { this.open = (m, u) => urls.push(u); this.send = () => {}; this.setRequestHeader = () => {}; }
    const ctx = { window: {}, console: { log() {} }, Date, Math, JSON, String, Object, Array, parseInt, setTimeout: () => 0, setInterval: () => 0, XMLHttpRequest: X,
        Lampa: { Select: { show: o => { sel = o; } }, Controller: { enabled: () => ({ name: 'full' }), toggle() {} }, Noty: { show() {} } } };
    ctx.window = ctx; ctx.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
    vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(SRC, 'bstg.js'), 'utf8') + ';this.M=BSTelegram;', ctx);
    let ownerCalled = false;
    ctx.M._tvSubscribe({ id: 99, name: 'Солдаты', first_air_date: '2004' }, () => { ownerCalled = true; });
    t('подписка на ТВ: людей несколько — «Кому подписка?» с владельцем и Мухибой', sel && sel.items.length === 2 && sel.items[1].title === 'Аня');
    sel.onSelect(sel.items[1]);
    const g = JSON.parse(store.bs_tg_users)['2'];
    t('подписка на ТВ: выбрали Аню — в её подписках, не у владельца, подтверждение в её чат',
        !ownerCalled && g.subs.length === 1 && g.subs[0].id === 99 && !store.bs_subs && urls.some(u => /sendMessage\?chat_id=2&/.test(u)) && !urls.some(u => /sendMessage\?chat_id=1&/.test(u)));
}

{
    const ctx = { window: {}, console: { log() {} }, Date, Math, JSON, String, Object, Array, parseInt, setTimeout: () => 0, setInterval: () => 0 };
    ctx.window = ctx; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(SRC, 'bstg.js'), 'utf8') + ';this.M=BSTelegram;', ctx);
    const O = ctx.M._ongoing;
    t('кнопка подписки в плеере: идущий сериал — да, завершённый — нет', O({ status: 'Returning Series' }) && O({ status: 'Ended', next_episode_to_air: { air_date: '2026-11-01' } }) && !O({ status: 'Ended' }) && !O({ status: 'Canceled' }) && !O(null));
}

{
    const ctx = { window: {}, console: { log() {} }, Date, Math, JSON, String, Object, Array, parseInt, setTimeout: () => 0, setInterval: () => 0 };
    ctx.window = ctx; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(SRC, 'bstg.js'), 'utf8') + ';this.M=BSTelegram;', ctx);
    const K = ctx.M;
    t('ИИ: ключ узнаём по началу — Groq, OpenRouter, Gemini', K._keyKind('gsk_abc') === 'groq' && K._keyKind('sk-or-v1-abc') === 'openrouter' && K._keyKind('AQ.Ab8') === 'gemini' && K._keyKind('AIzaSy') === 'gemini');
    const ids = ['whisper-large-v3', 'llama-3.3-70b-versatile', 'meta-llama/llama-4-scout-17b-16e-instruct', 'openai/gpt-oss-120b', 'meta-llama/llama-guard-4-12b', 'qwen/qwen3-32b'];
    t('ИИ Groq: картинка — только «зрячие» модели', K._groqPick(ids, true).join() === 'meta-llama/llama-4-scout-17b-16e-instruct');
    t('ИИ Groq: текст — сильные первыми, без whisper и guard', K._groqPick(ids, false).join() === 'llama-3.3-70b-versatile,openai/gpt-oss-120b,meta-llama/llama-4-scout-17b-16e-instruct');
    const oc = K._oaContent([{ text: 'что это' }, { inline_data: { mime_type: 'image/jpeg', data: 'AAA' } }]);
    t('ИИ: картинка в формате OpenAI', oc[0].type === 'text' && oc[1].image_url.url === 'data:image/jpeg;base64,AAA');
}

{
    const ctx = { window: {}, console: { log() {} }, Date, Math, JSON, String, Object, Array, parseInt, setTimeout: () => 0, setInterval: () => 0 };
    ctx.window = ctx; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(SRC, 'bstg.js'), 'utf8') + ';this.M=BSTelegram;', ctx);
    const V = ctx.M._verNum;
    t('версии ТВ: 1.7.32 новее 1.7.29 и 1.7.30-debug, 1.8.0 новее 1.7.99', V('1.7.32') > V('1.7.29') && V('1.7.32') > V('1.7.30-debug') && V('1.8.0') > V('1.7.99') && V('') === 0);
}

{
    const ctx = { window: {}, console: { log() {} }, Date, Math, JSON, String, Object, Array, parseInt, setTimeout: () => 0, setInterval: () => 0 };
    ctx.window = ctx; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(SRC, 'bstg.js'), 'utf8') + ';this.M=BSTelegram;', ctx);
    const S = ctx.M;
    t('запись: время 2:18:01 и 4:05', S._clock(8281) === '2:18:01' && S._clock(245) === '4:05');
    t('запись: подпись — фильм, год, серия, момент, ТВ', S._shotCaption({ card_title: 'Преемник: зов предков', card_year: '2025', season: 2, episode: 3, start_point: 8281 }, 'Гостиная')
        .indexOf('🎬 Запись из «Преемник: зов предков» (2025) — 2 сезон, 3 серия (с 2:18:01)\nЗаписано на ТВ «Гостиная»') === 0);
    t('запись: фильм без серии и года', S._shotCaption({ card_title: 'Марсианин', card_year: '----' }, 'ТВ').indexOf('🎬 Запись из «Марсианин»\n') === 0);
}

/* ---- bsrch.js: источники с RCH не висят бесконечно ---- */
function rchEnv() {
    let now = 0, timers = [], tid = 0;
    const clock = {
        set: (fn, ms) => { timers.push({ id: ++tid, at: now + (ms || 0), fn }); return tid; },
        clear: id => { timers = timers.filter(x => x.id !== id); },
        run: ms => { const end = now + ms; for (;;) { timers.sort((a, b) => a.at - b.at); const x = timers[0]; if (!x || x.at > end) break; timers.shift(); now = x.at; x.fn(); } now = end; }
    };
    const notes = [], comp = { calls: [], doesNotAnswer(e) { this.calls.push(e); }, uiDraw() {}, request() {} };
    const loading = { on: false };
    const w = {};
    const Lampa = {
        Noty: { show: t => notes.push(t) },
        Activity: { active: () => ({ activity: { component: comp } }) },
        Loading: { start() { loading.on = true; }, stop() { loading.on = false; } },
        Utils: { putScript() {} }, Storage: { get: () => '' }
    };
    const ctx = { window: w, Lampa, document: { head: { appendChild() {} }, createElement: () => ({}) }, console: { log() {} },
        setTimeout: clock.set, clearTimeout: clock.clear, Date: { now: () => now }, Math, Object, String, Array };
    w.window = w; vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(SRC, 'bsrch.js'), 'utf8') + ';this.M=BSRch;', ctx);
    // упрощённый NativeWsClient Skaz: сокет, который мы сами «открываем» или «закрываем»
    function C() { this.handlers = {}; this.socket = null; }
    C.prototype.connect = function () { this.socket = { onclose: null, close() {} }; this.connects = (this.connects || 0) + 1; };
    C.prototype.on = function (m, h) { (this.handlers[m] = this.handlers[m] || []).push(h); };
    C.prototype._emit = function (m, a) { (this.handlers[m] || []).forEach(h => h.apply(null, a || [])); };
    C.prototype.close = function () { this.closed = true; };
    w.NativeWsClient = C;
    ctx.M.start();
    const client = () => { const c = new w.NativeWsClient(); w.nwsClient = { h: c }; return c; };
    return { M: ctx.M, w, clock, notes, comp, loading, Lampa, client };
}
let R = rchEnv(), rc = R.client(), ready = 0;
rc.on('RchRegistry', () => ready++); rc.connect(); R.clock.run(900); rc._emit('Connected', ['id']); R.clock.run(200); rc._emit('RchRegistry', ['ip']); R.clock.run(60000);
t('rch: рабочее подключение не трогаем', ready === 1 && R.comp.calls.length === 0 && !rc.closed && R.notes.length === 0);
R = rchEnv(); rc = R.client(); rc.connect(); R.clock.run(8100);
t('rch: нет Connected — одна повторная попытка', rc.connects === 2 && R.comp.calls.length === 0);
R.clock.run(8000);
t('rch: после повтора — ошибка и переход к следующему источнику', R.comp.calls.length === 1 && R.comp.calls[0].timeout === true && rc.closed && R.notes.length === 1);
rc = R.client(); rc.connect(); R.clock.run(4100);
t('rch: сразу после сбоя — короче и без повтора', rc.connects === 1 && R.comp.calls.length === 2);
R = rchEnv(); rc = R.client(); rc.connect(); rc._emit('Connected', ['id']); R.clock.run(8100);
t('rch: сервер не ответил на регистрацию — ошибка', R.comp.calls.length === 1);
R = rchEnv(); rc = R.client(); rc.connect(); R.Lampa.Loading.start(); R.clock.run(20000);
t('rch: при выборе видео снимаем «Загрузку», список не трогаем', R.loading.on === false && R.comp.calls.length === 0 && R.notes.length === 1);
R = rchEnv(); rc = R.client(); rc.connect(); R.comp.uiDraw(); R.clock.run(20000);
t('rch: плагин сам показал итог — нашу ошибку не показываем', R.comp.calls.length === 0);
R = rchEnv(); rc = R.client(); rc.connect(); R.client(); R.clock.run(20000);
t('rch: брошенный ради другого источника сокет молчит', R.comp.calls.length === 0 && R.notes.length === 0);
R = rchEnv(); rc = R.client(); rc.connect(); rc._emit('Connected', ['id']); rc.socket.onclose(); R.clock.run(1);
t('rch: обрыв до регистрации — ошибка без ожидания таймера', R.comp.calls.length === 1);

/* ---- bsfix.js: качество объектом не роняет плагин Skaz ---- */
const X = load('bsfix.js', 'BSFix').M;
t('качество: объект -> адрес, мусор выкинут', J(X._normQuality({ '1080p': { url: 'u1' }, '720p': 'u2', bad: { label: 'x' }, n: null })) === J({ '1080p': 'u1', '720p': 'u2' }));
const fc = { setDefaultQuality(d) { for (const q in d.quality) d.quality[q].indexOf(' or '); this.ok = true; } };
X._patch(fc); const fd = { url: { url: 'u1' }, quality: { '1080p': { url: 'u1' } } }; fc.setDefaultQuality(fd);
t('качество: обёртка setDefaultQuality', fc.ok === true && fd.url === 'u1' && fd.quality['1080p'] === 'u1');

t('ссылка: следующий сервер Skaz', X._otherServer('http://online3.skaz.tv/lite/rezka/movie?s=12') === 'http://online4.skaz.tv/lite/rezka/movie?s=12' && X._otherServer('http://onlinecf7.skaz.tv/x') === 'http://onlinecf3.skaz.tv/x' && X._otherServer('https://cdn.example/x') === '');
t('журнал: почта и токены скрыты', X._mask('a?account_email=me%40x.uz&uid=abc&s=1 {"token":"eyJ"}') === 'a?account_email=…&uid=…&s=1 {"token":"…"}');
const gc = { urls: [], setDefaultQuality() {}, getFileUrl(f, call) { this.urls.push(f.url); call(f.url.indexOf('online4') > 0 ? { url: 'v' } : false, {}); } };
X._patch(gc); let got; gc.getFileUrl({ url: 'http://online3.skaz.tv/lite/rezka/movie?e=16' }, j => { got = j; });
t('ссылка: нет ответа -> один повтор через другой сервер', gc.urls.length === 2 && /online4/.test(gc.urls[1]) && got && got.url === 'v');
const gd = { urls: [], setDefaultQuality() {}, getFileUrl(f, call) { this.urls.push(f.url); call(false, {}); } };
X._patch(gd); let got2 = 1; gd.getFileUrl({ url: 'http://online3.skaz.tv/x' }, j => { got2 = j; });
t('ссылка: повтор только один раз', gd.urls.length === 2 && got2 === false);

const gr = { w: [], setDefaultQuality() {}, getFileUrl(f, call, w) { this.w.push(w); if (this.w.length === 1) return this.getFileUrl(f, call, true); call({ url: 'v' }, {}); } };
X._patch(gr); let got3; gr.getFileUrl({ url: 'http://online3.skaz.tv/lite/rezka/movie?e=17' }, j => { got3 = j; }, true);
t('ссылка: первый запрос с подключением RCH, внутренний повтор плагина — мимо обёртки', JSON.stringify(gr.w) === '[false,true]' && got3 && got3.url === 'v');

t('ссылка: HDRezka-премиум -> обычная Rezka', X._fallbackUrl('http://online3.skaz.tv/lite/rhsprem/movie?id=14068&t=110&s=12&e=16') === 'http://online3.skaz.tv/lite/rezka/movie?id=14068&t=110&s=12&e=16' && X._fallbackUrl('http://online3.skaz.tv/lite/kinopub/movie?x') === 'http://online4.skaz.tv/lite/kinopub/movie?x');

t('ссылка: для HDRezka — rezka на том же сервере, затем на online3', JSON.stringify(X._fallbacks('http://online4.skaz.tv/lite/rhsprem/movie?e=1')) === JSON.stringify(['http://online4.skaz.tv/lite/rezka/movie?e=1', 'http://online3.skaz.tv/lite/rezka/movie?e=1']));
const gz = { urls: [], setDefaultQuality() {}, getFileUrl(f, call) { this.urls.push(f.url.replace(/^http:\/\/|\?.*$/g, '')); call(/online3\.skaz\.tv\/lite\/rezka/.test(f.url) ? { url: 'v' } : false, {}); } };
X._patch(gz); let got4; gz.getFileUrl({ url: 'http://online4.skaz.tv/lite/rhsprem/movie?e=16' }, j => { got4 = j; }, true);
t('ссылка: HDRezka -> Rezka(online4) -> Rezka(online3)', JSON.stringify(gz.urls) === JSON.stringify(['online4.skaz.tv/lite/rhsprem/movie', 'online4.skaz.tv/lite/rezka/movie', 'online3.skaz.tv/lite/rezka/movie']) && got4 && got4.url === 'v');
gz.urls = []; gz.getFileUrl({ url: 'http://online3.skaz.tv/lite/rhsprem/movie?e=17' }, () => {}, true);
t('ссылка: после отказа HDRezka следующая серия сразу из Rezka', gz.urls[0] === 'online3.skaz.tv/lite/rezka/movie' && gz.urls.length === 1);

const gf = { n: 0, setDefaultQuality() {}, find() { this.n++; null.indexOf('?'); } };
X._patch(gf); let thrown = false; try { gf.find(); } catch (e) { thrown = true; }
t('поиск: падение плагина не выходит наружу', !thrown && gf.n === 1);

/* ---- bsmenu.js: турецкие сериалы ---- */
const MN = load('bsmenu.js', 'BSMenu').M;
t('турецкие: по языку или стране', MN._isTurkish({ original_language: 'tr' }) && MN._isTurkish({ original_language: 'en', origin_country: ['TR'] }) && !MN._isTurkish({ original_language: 'ru', origin_country: ['RU'] }));
t('турецкие: название из TMDB экранируется', MN._esc('<b>"x"&') === '&lt;b&gt;&quot;x&quot;&amp;');


/* ---- быстрый старт: библиотеки из пакета, память дорожек ---- */
function featuresWith(src) {
    const w = { localStorage: { getItem: () => null, setItem() {} } };
    const ctx = { window: w, XMLHttpRequest: function () {}, Node: function () {}, document: {}, console, bsSource: src };
    ctx.XMLHttpRequest.prototype = { open() {} }; ctx.Node.prototype = { appendChild() {} }; w.window = w; vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(SRC, 'bsfeatures.js'), 'utf8') + ';this.M=BSFeatures;', ctx);
    return ctx.M;
}
const HLS = 'http://lampa.byskaz.ru/lampa-main/vender/hls/hls.js?_bs=1';
t('библиотеки: Lampa из пакета -> hls из пакета', featuresWith('local')._localVender(HLS) === 'vender/hls/hls.js');
t('библиотеки: Lampa с сервера -> hls с сервера', featuresWith('server')._localVender(HLS) === '');
const PT = load('bsplayer.js', 'BSPlayer');
for (let i = 1; i <= 105; i++) { PT.store['bs_track_' + i] = '{}'; PT.M._trimTracks('bs_track_' + i); }
t('дорожки: хранится не больше 100 сериалов', !('bs_track_5' in PT.store) && ('bs_track_6' in PT.store) && JSON.parse(PT.store.bs_track_index).length === 100);


/* ---- bsfix.js: автоподбор источника ---- */
function fixCtx(store) {
    store = store || {};
    const w = { localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } } };
    const notes = [], env = { bal: 'rhsprem', screen: null };
    const ctx = { window: w, XMLHttpRequest: function () {}, console: { log() {} }, setTimeout: fn => fn(), clearTimeout() {}, Date, JSON, Math, Object, String, Array,
        $: () => ({ last: () => ({ text: () => env.bal }) }),
        Lampa: { Storage: { get: k => (k === 'online_balanser' ? env.bal : '') }, Noty: { show: t => notes.push(t) }, Player: { close() {} },
            Activity: { active: () => ({ activity: { component: env.screen } }) } } };
    ctx.XMLHttpRequest.prototype = { open() {}, send() {} }; w.window = w; vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(SRC, 'bsfix.js'), 'utf8') + ';this.M=BSFix;', ctx);
    return { M: ctx.M, notes, env, ctx };
}
function fakeComp(A, nexts) {
    const c = { switched: [], nextSource() { return nexts.shift() || ''; }, switchSource(n) { this.switched.push(n); A.env.bal = n; },
        setDefaultQuality() {}, getFileUrl(f, cb) { cb({ url: 'v' }, {}); }, destroy() {} };
    A.M._patch(c); A.env.screen = c; return c;
}
let A = fixCtx(), ac = fakeComp(A, ['rezka', 'kinopub']);
ac.getFileUrl({ url: 'http://online3.skaz.tv/lite/rhsprem/movie?e=16', season: 12, episode: 16 }, () => {});
t('автоподбор: запомнил, что играет', A.M.current() && A.M.current().episode === 16 && A.M.current().name === 'rhsprem');
t('автоподбор: переключение на следующий источник', A.M.autoNext() === true && ac.switched[0] === 'rezka');
let entered = null;
A.M._autoPick([{ method: 'link', text: '12 сезон' }, { method: 'call', season: 12, episode: 15 }, { method: 'call', season: 12, episode: 16 }], { onEnter: it => { entered = it; } }, ac);
t('автоподбор: в новом источнике выбрана та же серия', entered && entered.episode === 16);

A = fixCtx(); ac = fakeComp(A, ['b']); ac.getFileUrl({ url: 'http://x/movie' }, () => {}); A.M.autoNext(); entered = null;
A.M._autoPick([{ method: 'link' }, { method: 'play', text: '1080p' }], { onEnter: it => { entered = it; } }, ac);
t('автоподбор: фильм — первый запускаемый вариант', entered && entered.method === 'play');

// как на ТВ: источник дал ссылку, видео не пошло → следующий; счётчик не сбрасывается от новых ссылок
A = fixCtx(); ac = fakeComp(A, ['a1', 'a2', 'a3', 'a4', 'a5']);
let n = 0;
ac.getFileUrl({ url: 'http://x', season: 1, episode: 3 }, () => {});
while (A.M.autoNext() && n < 10) { n++; ac.getFileUrl({ url: 'http://x' + n, season: 1, episode: 3 }, () => {}); }
t('автоподбор: не больше 3 источников подряд, хоть каждый и даёт ссылку', n === 3 && ac.switched.length === 3);
A.M.played(); t('автоподбор: видео пошло — подбор закончен', A.M._state().auto === null);

A = fixCtx(); ac = fakeComp(A, ['b']); ac.getFileUrl({ url: 'http://x', episode: 2 }, () => {}); A.M.autoNext(); entered = null;
A.M._autoPick([{ method: 'call', episode: 2 }], { onEnter: it => { entered = it; } }, { other: true });
t('автоподбор: на другом экране серию сам не включает', entered === null);
A.env.bal = 'manual'; A.M._autoPick([{ method: 'call', episode: 2 }], { onEnter: it => { entered = it; } }, ac);
t('автоподбор: человек сам выбрал другой источник — не вмешиваемся', entered === null);

A = fixCtx(); ac = fakeComp(A, ['b']); ac.getFileUrl({ url: 'http://x', episode: 2 }, () => {}); A.env.screen = { other: true };
t('автоподбор: человек ушёл с экрана источников — не переключаем', A.M.autoNext() === false && ac.switched.length === 0);
A.env.screen = ac; ac.destroy();
t('автоподбор: экран закрыт — о прошлом видео забываем', A.M.current() === null);

A = fixCtx({ bs_auto_source: 'false' }); ac = fakeComp(A, ['z']); ac.getFileUrl({ url: 'http://x' }, () => {});
t('автоподбор: выключен в настройках — не трогаем', A.M.autoNext() === false && ac.switched.length === 0);

/* ---- «Загрузка» не зависает: второй Loading.start без stop (как в Lampa: прежний слой теряется) ---- */
{
    const A2 = fixCtx(), body = []; let cur = null, cancels = 0;
    A2.ctx.Lampa.Loading = { start(cb) { cur = { cb }; body.push(cur); }, stop() { if (cur) { body.splice(body.indexOf(cur), 1); cur = null; } } };
    A2.M._hookLoading();
    const L = A2.ctx.Lampa.Loading;
    L.start(() => cancels++); L.start(() => cancels++); L.stop();
    t('загрузка: два start и один stop — на экране ничего не висит', body.length === 0);
    L.start(() => cancels++); cur.cb(); L.stop();
    t('загрузка: «Назад» на загрузке по-прежнему доходит до плагина', cancels === 1 && body.length === 0);
    L.stop(); L.start(() => {}); L.stop();
    t('загрузка: лишний stop ничего не ломает', body.length === 0);
}

/* ---- гонка источников (bsprobe.js) в автоподборе ---- */
function raceProbe(win, results) {
    return { calls: [], marks: [], enabled: () => true, bad: v => ['dead', 'nolink', 'missing', 'failed'].indexOf(v) >= 0,
        remember(n, v) { this.marks.push(n + '=' + v); }, state: n => (n === 'deadone' ? 'dead' : ''), preferred: () => '', first: () => 'firstok',
        race(c, exclude, want, cb) { this.calls.push({ exclude, want }); cb(win, results); } };
}
A = fixCtx(); A.ctx.Lampa.Player.opened = () => false;
A.ctx.window.BSProbe = raceProbe({ name: 'kinopub', title: 'KinoPub', verdict: 'ok' }, [{ name: 'filmix', verdict: 'missing' }, { name: 'kinopub', verdict: 'ok' }]);
ac = fakeComp(A, ['zzz']); ac.requestParams = u => u; ac.getChoice = () => ({ voice_name: 'Дубляж' });
ac.getFileUrl({ url: 'http://online3.skaz.tv/lite/rhsprem/movie', season: 2, episode: 7 }, () => {});
t('гонка: переключение на источник с проверенным потоком', A.M.autoNext() === true && ac.switched[0] === 'kinopub');
const call0 = A.ctx.window.BSProbe.calls[0];
t('гонка: ищем ту же серию и озвучку, без упавшего источника', call0.want.season === 2 && call0.want.episode === 7 && call0.want.voice === 'Дубляж' && call0.exclude.indexOf('rhsprem') >= 0);
t('гонка: упавший источник помечен', A.ctx.window.BSProbe.marks.indexOf('rhsprem=failed') >= 0);
t('гонка: источник без серии больше не пробуем', A.M._state().auto.tried.indexOf('filmix') >= 0);
t('гонка: в уведомлении понятное имя', A.notes.some(x => /KinoPub/.test(x) && /поток проверен/.test(x)));

A = fixCtx(); A.ctx.Lampa.Player.opened = () => false;
A.ctx.window.BSProbe = raceProbe(null, [{ name: 'a', verdict: 'dead' }]);
ac = fakeComp(A, ['plugin_next']); ac.requestParams = u => u; ac.getChoice = () => ({});
ac.getFileUrl({ url: 'http://x', episode: 1 }, () => {});
t('гонка: никто не подтвердился — как раньше, следующий по плагину', A.M.autoNext() === true && ac.switched[0] === 'plugin_next');

A = fixCtx(); A.ctx.Lampa.Player.opened = () => true;
A.ctx.window.BSProbe = raceProbe({ name: 'kinopub', verdict: 'ok' }, []);
ac = fakeComp(A, ['x']); ac.requestParams = u => u; ac.getChoice = () => ({});
ac.getFileUrl({ url: 'http://x', episode: 1 }, () => {});
A.M.autoNext();
t('гонка: пока проверяли, человек уже включил другое — не переключаем', ac.switched.length === 0);

A = fixCtx(); A.ctx.window.BSProbe = raceProbe(null, []);
ac = fakeComp(A, ['deadone']);
t('плагин сам переключается: мёртвый по проверке обходим', ac.nextSource() === 'firstok');
A = fixCtx(); A.ctx.window.BSProbe = Object.assign(raceProbe(null, []), { preferred: () => 'verified' });
ac = fakeComp(A, ['plugins_choice']);
t('плагин сам переключается: берёт проверенный рабочий', ac.nextSource() === 'verified');
A = fixCtx({ bs_race: 'false' });
ac = fakeComp(A, ['plugins_choice']);
t('проверка выключена — выбор плагина не трогаем', ac.nextSource() === 'plugins_choice');

const gi = { calls: 0, setDefaultQuality() {}, getFileUrl(f, cb, w) { this.calls++; if (this.calls === 1) return this.getFileUrl(f, cb, true); cb({ url: 'v' }, {}); } };
A = fixCtx(); A.M._patch(gi); let gr2 = 0; gi.getFileUrl({ url: 'http://online3.skaz.tv/lite/x/movie' }, () => gr2++, true); gi.getFileUrl({ url: 'http://online3.skaz.tv/lite/x/movie' }, () => gr2++, true);
t('ссылка: повторный выбор той же серии снова идёт через обёртку', gi.calls === 3 && gr2 === 2);


/* ---- ES5: на старых ТВ одна const/стрелка — и весь файл SyntaxError ---- */
function stripJs(src) {
    let out = '', i = 0, n = src.length, prevSig = '';
    while (i < n) {
        const c = src[i], d = src[i + 1];
        if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
        if (c === '/' && d === '*') { i = src.indexOf('*/', i + 2); i = i < 0 ? n : i + 2; out += ' '; continue; }
        if (c === '"' || c === "'" || c === '`') {
            if (c === '`') out += '`';
            const q = c; i++;
            while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; }
            i++; out += '""'; prevSig = '"'; continue;
        }
        if (c === '/' && !/[\w$)\]"]/.test(prevSig)) {             // регулярное выражение
            i++; let cls = false;
            while (i < n && (src[i] !== '/' || cls)) { if (src[i] === '\\') i++; else if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false; i++; }
            i++; while (/[a-z]/.test(src[i] || '')) i++; out += '/r/'; prevSig = ')'; continue;
        }
        out += c; if (!/\s/.test(c)) prevSig = c; i++;
    }
    return out;
}
const ES6 = [[/=>/, 'стрелка =>'], [/\blet\s+[\w$[{]/, 'let'], [/\bconst\s+[\w$[{]/, 'const'], [/`/, 'шаблонная строка'],
    [/\?\.[^\d]/, '?.'], [/\?\?/, '??'], [/\bclass\s+[\w$]+\s*[{e]/, 'class'], [/\.\.\.[\w$[(]/, '...']];
fs.readdirSync(SRC).filter(f => /\.js$/.test(f) && f !== 'app.js').forEach(f => {
    const code = stripJs(fs.readFileSync(path.join(SRC, f), 'utf8'));
    const bad = ES6.filter(r => r[0].test(code)).map(r => r[1]);
    t('ES5: ' + f + (bad.length ? ' — ' + bad.join(', ') : ''), !bad.length);
});


/* ---- playerguard.js: подгрузка буфера — не зависание ---- */
function guardEnv(opt) {
    opt = opt || {};
    let now = 0, timers = [], tid = 0;
    const set = (fn, ms, rep) => { timers.push({ id: ++tid, at: now + ms, fn, rep: rep ? ms : 0 }); return tid; };
    const clock = { run(ms) { const end = now + ms; for (;;) { timers.sort((a, b) => a.at - b.at); const x = timers[0]; if (!x || x.at > end) break; now = x.at; if (x.rep) x.at += x.rep; else timers.shift(); x.fn(); } now = end; } };
    const H = {}, follow = name => (ev, fn) => { (H[name + ':' + ev] = H[name + ':' + ev] || []).push(fn); };
    const notes = [], events = [];
    const av = { setListener(l) { this.l = l; }, prepareAsync(ok, fail) { this.fail = fail; } };
    const ls = {}, store = { player: 'tizen', player_hls_method: 'application' }, plays = [];
    const w = { localStorage: opt.tizen ? { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: k => { delete ls[k]; } } : { getItem: () => null, setItem() {} },
        addEventListener() {}, webapis: { avplay: av } };
    const Lampa = { Noty: { show: t => notes.push(t) }, Player: { listener: { follow: follow('player') }, opened: () => true, playdata: () => ({ url: 'http://cdn/1080.m3u8', quality: { '1080p': 'http://cdn/1080.m3u8', '720p': 'http://cdn/720.m3u8' } }), close() { events.push('close'); } },
        PlayerVideo: { listener: { follow: follow('video') }, video: () => ({}), to() {} }, PlayerPanel: { listener: { follow: follow('panel'), send: (ev, d) => { if (opt.tizen) events.push(ev + ' ' + d.url); else throw new Error('нет'); } } }, SettingsApi: null };
    if (opt.tizen) {
        Lampa.Platform = { is: n => n === 'tizen' };
        Lampa.Storage = { field: k => store[k], set: (k, v) => { store[k] = v; } };
        Lampa.PlayerPlaylist = { get: () => [{ url: 'next' }] };
        Lampa.Player.play = d => { plays.push(d.url); (H['player:start'] || []).forEach(f => f(d)); };
        Lampa.Player.playlist = () => {};
    }
    const ctx = { window: w, Lampa, document: { hidden: false, addEventListener() {} }, navigator: { onLine: true }, console: { log() {} },
        setTimeout: (f, ms) => set(f, ms || 0), clearTimeout: id => { timers = timers.filter(x => x.id !== id); }, setInterval: (f, ms) => set(f, ms, true), clearInterval: id => { timers = timers.filter(x => x.id !== id); },
        Date: { now: () => now }, Math, JSON, String, Object, Array, parseFloat, parseInt, isNaN };
    w.window = w; vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(SRC, 'playerguard.js'), 'utf8') + ';this.M=BSGuard;', ctx);
    ctx.M.start();
    const fire = (k, d) => (H[k] || []).forEach(f => f(d));
    return { M: ctx.M, clock, fire, notes, events, av, store, plays, ls };
}
{
    // Lampa ставит свой слушатель AVPlay; его onerror до сторожа не доходит — сторож берёт ошибку у AVPlay сам
    const g = guardEnv(), lampaSeen = [];
    g.av.setListener({ onerror: t => lampaSeen.push(t) });
    g.fire('player:start', { url: 'http://cdn/1080.m3u8' }); g.clock.run(3000);
    g.av.l.onerror('PLAYER_ERROR_CONNECTION_FAILED'); g.clock.run(8000);
    t('сторож: ошибка AVPlay — вмешивается через ~9 с, а не через 25', g.notes.length > 0 && lampaSeen.length === 1);
    const g2 = guardEnv();
    g2.fire('player:start', { url: 'http://cdn/1080.m3u8' }); g2.clock.run(3000);
    g2.av.prepareAsync(() => {}, () => {}); g2.av.fail({ name: 'PLAYER_ERROR_CONNECTION_FAILED' }); g2.clock.run(8000);
    t('сторож: сбой prepareAsync — тоже', g2.notes.length > 0);
    const g3 = guardEnv();
    g3.fire('player:start', { url: 'http://cdn/1080.m3u8' }); g3.clock.run(11000);
    t('сторож: без ошибки за 11 с не вмешивается', g3.notes.length === 0);
    const g4 = guardEnv(); g4.av.setListener({});
    g4.fire('player:start', { url: 'http://cdn/1080.m3u8' }); g4.av.l.onbufferingstart(); g4.clock.run(1000);
    g4.fire('video:timeupdate', { current: 1 }); g4.clock.run(500); g4.fire('video:timeupdate', { current: 2 });
    g4.av.l.onbufferingstart();
    t('сторож: остановки на подгрузку считаются только после старта видео', g4.M.stalls() === 1);
}
{
    // Плеер ТВ не запустил .m3u8 — та же серия во встроенном плеере (hls.js); сервер запоминается
    const g = guardEnv({ tizen: true });
    g.fire('player:start', { url: 'http://cdn/1080.m3u8' }); g.clock.run(4000);
    t('HLS: через 3 с без картинки — подсказка, что идёт подключение', g.notes.some(n => /Подключаюсь к потоку/.test(n)) && g.store.player === 'tizen');
    g.clock.run(3000);
    t('HLS: AVPlay молчит (ни одного сигнала загрузки) 6 с — встроенный плеер с hls.js, та же серия',
        g.store.player === 'inner' && g.store.player_hls_method === 'hlsjs' && g.events.indexOf('quality http://cdn/1080.m3u8') >= 0);
    t('HLS: плеер не закрывается и серия не перезапускается', g.events.indexOf('close') < 0 && g.plays.length === 0);
    g.clock.run(9000);
    t('HLS: во встроенном второй раз на встроенный не переключает', g.events.filter(e => /^quality/.test(e)).length <= 2 && g.store.player === 'inner');
    g.fire('player:destroy');                                       // закрытие плеера, открытого заново, — уже после повтора
    t('HLS: после просмотра настройки плеера — как были', g.store.player === 'tizen' && g.store.player_hls_method === 'application');
    t('HLS: сервер видео запомнен', g.M._hls.learned('http://cdn/720.m3u8'));
    g.fire('player:start', { url: 'http://cdn/480.m3u8' });
    t('HLS: с запомненного сервера — сразу встроенный плеер', g.store.player === 'inner');
    g.fire('player:destroy');
    g.fire('player:start', { url: 'http://other.net/a/1080.mp4' });
    t('HLS: файл mp4 и другой сервер — плеер ТВ', g.store.player === 'tizen');
    const g4 = guardEnv({ tizen: true });
    g4.fire('player:start', { url: 'http://cdn/1080.m3u8', iptv: true, timeline: {} }); g4.clock.run(11000);
    t('HLS: фильм с пометкой iptv (так делает Skaz) — не канал: запасной плеер срабатывает', g4.store.player === 'inner');
    const g5 = guardEnv({ tizen: true });
    g5.fire('player:start', { url: 'http://cdn/1080.m3u8', iptv: true }); g5.clock.run(26000);
    t('HLS: настоящий ТВ-канал — только переподключение, плеер не меняем', g5.store.player === 'tizen' && g5.notes.some(n => /Канал/.test(n)));
    const g6 = guardEnv({ tizen: true }); g6.av.setListener({});
    g6.fire('player:start', { url: 'http://cdn/1080.m3u8' }); g6.clock.run(2000); g6.av.l.onbufferingstart(); g6.clock.run(6000);
    t('HLS: AVPlay грузит данные — 6 с не переключаем, ждём до 10', g6.store.player === 'tizen');
    g6.clock.run(3000);
    t('HLS: …но и через 10 с без картинки — встроенный', g6.store.player === 'inner');
    t('HLS: сервер-IP запоминается целиком', g6.M._hls.hostKey('http://10.1.2.3:8080/a.m3u8') === '10.1.2.3');
    const g7 = guardEnv({ tizen: true }); g7.store.player = 'inner'; g7.store.player_hls_method = 'hlsjs';
    g7.fire('player:start', { url: 'http://new.net/1080.m3u8' });
    t('автовыбор: вручную стоит «Встроенный» — новый сервер всё равно начинает с плеера ТВ', g7.store.player === 'tizen');
    g7.clock.run(7000);
    t('автовыбор: …и при сбое переходит на встроенный', g7.store.player === 'inner');
    g7.fire('player:destroy');
    t('автовыбор: после просмотра ручная настройка возвращается', g7.store.player === 'inner' && g7.store.player_hls_method === 'hlsjs' && !g7.ls.bs_player_forced);
    const g8 = guardEnv({ tizen: true }); g8.ls.bs_player_auto = 'false'; g8.store.player = 'inner';
    g8.fire('player:start', { url: 'http://new.net/1080.m3u8' });
    t('автовыбор выключен: ручной «Встроенный» не трогаем', g8.store.player === 'inner');
    const g3 = guardEnv({ tizen: true });
    g3.fire('player:start', { url: 'http://slow.net/a.m3u8' }); g3.clock.run(6000); g3.fire('player:destroy');
    t('HLS: закрыли, не дождавшись (6 с), — сервер запомнен', g3.M._hls.learned('http://cdn/b.m3u8'));
    const g2 = guardEnv({ tizen: true });
    g2.fire('player:start', { url: 'http://cdn/film.mp4' }); g2.clock.run(16000);
    t('HLS: mp4 через 15 с не трогаем (ждём обычные 25 с)', g2.store.player === 'tizen' && g2.events.length === 0);
    t('HLS: распознаём поток и сервер', g2.M._hls.isHls('https://a.b/hls/x') && g2.M._hls.isHls('https://a.b/x.m3u8?t=1') && !g2.M._hls.isHls('https://a.b/x.mp4') &&
        g2.M._hls.hostKey('https://4c-2f-63-r505.vkvideo.cloud/0/x.m3u8') === 'vkvideo.cloud');
}
let G = guardEnv();
G.fire('player:start', { url: 'http://cdn/1080.m3u8' }); G.clock.run(1000);
G.fire('video:timeupdate', { current: 1 }); G.clock.run(500); G.fire('video:timeupdate', { current: 2 });   // видео шло
for (let p = 5; p <= 95; p += 5) { G.clock.run(3000); G.fire('video:progress', { down: p + '%' }); }       // 57 с: стоит, но буфер растёт
t('сторож: пока буфер набирается — не трогает поток', G.notes.length === 0 && G.events.length === 0);
G = guardEnv();
G.fire('player:start', { url: 'http://cdn/1080.m3u8' }); G.clock.run(1000);
G.fire('video:timeupdate', { current: 1 }); G.clock.run(500); G.fire('video:timeupdate', { current: 2 });
G.clock.run(25000);
t('сторож: стоит и буфер не растёт — вмешивается (перезапуск/качество)', G.notes.length > 0);


/* ---- service/service.js: служба превью — как в примере Samsung: отправила плитки — завершается (у Skaz висела, и ТВ
 *      показывал в недавних серую заглушку вместо значка) ---- */
function runService(req, okSet) {
    const st = { exit: 0, set: null };
    const ctx = { module: { exports: {} }, console: { log() {} },
        tizen: { application: { getCurrentApplication: () => ({ exit: () => st.exit++, getRequestedAppControl: () => req }) } },
        webapis: { preview: { setPreviewData: (j, ok, err) => { st.set = j; okSet ? ok() : err({ message: 'x' }); } } } };
    vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(SRC, 'service', 'service.js'), 'utf8'), ctx);
    ctx.module.exports.onRequest(); return st;
}
const PICK = d => ({ appControl: { operation: 'http://tizen.org/appcontrol/operation/pick', data: d } });
let sv = runService(PICK([{ value: ['ForegroundApp', '{"sections":[]}'] }]), true);
t('служба превью: ряд Lampa передан в превью, служба завершается', sv.set === '{"sections":[]}' && sv.exit === 1);
sv = runService(PICK([{ value: ['ForegroundApp', '{}'] }]), false);
t('служба превью: ошибка обновления — тоже завершается', sv.exit === 1);
sv = runService(null, true);
t('служба превью: запуск без данных Lampa — превью не трогает', sv.set === null);


/* ---- bsfix.js: качество под скорость канала ---- */
const QP = fixCtx().M._pickQuality, QS = { '2160p': 'u4k', '1080p': 'u1080', '720p': 'u720', '480p': 'u480' };
t('качество: 25 Мбит/с — 4K остаётся', QP(QS, 'u4k', 25e6) === '');
t('качество: 10 Мбит/с — с 4K на 1080p', QP(QS, 'u4k', 10e6) === '1080p');
t('качество: 6 Мбит/с — на 720p', QP(QS, 'u4k', 6e6) === '720p');
t('качество: 1 Мбит/с — самое низкое', QP(QS, 'u4k', 1e6) === '480p');
t('качество: скорость неизвестна — не трогаем', QP(QS, 'u4k', 0) === '');
t('качество: уже выбрано посильное — не трогаем', QP(QS, 'u720', 6e6) === '');
t('качество: метки 4K и объекты {url}', QP({ '4K': { url: 'a' }, '1080p': { url: 'b' } }, 'a', 9e6) === '1080p');
function playWith(store) {
    const A = fixCtx(store), L = A.ctx.Lampa, got = [];
    L.Storage.field = n => (n === 'video_quality_default' ? '2160' : '');
    // как в Lampa 3.3.5: Player.play сам ставит ссылку «качества по умолчанию» поверх data.url
    L.Player = { getUrlQuality(q) { for (const k in q) if (parseInt(k) == L.Storage.field('video_quality_default')) return q[k]; return ''; },
        play(d) { const u = this.getUrlQuality(d.quality); if (u) d.url = u; got.push(d.url); } };
    A.M._hookPlay();
    L.Player.play({ url: 'u4k', quality: Object.assign({}, QS) });
    return { got, L, A };
}
const bw = b => ({ bs_bw: JSON.stringify({ bps: b, n: 3, at: Date.now(), v: 2 }) });
let pw = playWith(bw(8e6));
t('плеер: при 8 Мбит/с стартует 1080p, хотя по умолчанию 2160', pw.got[0] === 'u1080');
t('плеер: настройка качества по умолчанию не тронута', pw.L.Storage.field('video_quality_default') === '2160');
t('плеер: без замеров — как раньше (2160)', playWith({}).got[0] === 'u4k');
t('плеер: замер старше недели не используется', playWith({ bs_bw: JSON.stringify({ bps: 8e6, n: 3, at: Date.now() - 8 * 86400000, v: 2 }) }).got[0] === 'u4k');
t('плеер: выключено в настройках — как раньше', playWith(Object.assign(bw(8e6), { bs_bw_quality: 'false' })).got[0] === 'u4k');
t('плеер: быстрый канал — 4K', playWith(bw(40e6)).got[0] === 'u4k');
t('плеер: старые замеры 1.6.11 (без v:2) не используются', playWith({ bs_bw: JSON.stringify({ bps: 2e6, n: 12, at: Date.now() }) }).got[0] === 'u4k');
t('плеер: меньше 3 замеров — не используем', playWith({ bs_bw: JSON.stringify({ bps: 2e6, n: 2, at: Date.now(), v: 2 }) }).got[0] === 'u4k');
const BU = load('bsplayer.js', 'BSPlayer').M._bwUsable;
t('замер: MP4 720p качает со скоростью видео (2 Мбит/с) без остановок — не берём', !BU(2e6, 3.5e6, 0));
t('замер: тот же замер, но видео вставало — берём', BU(2e6, 3.5e6, 2));
t('замер: явно быстрее видео — берём', BU(231e6, 3.5e6, 0) && BU(6e6, 3.5e6, 0));
t('замер: мусорные значения — нет', !BU(50000, 0, 5) && !BU(3e9, 0, 0));


/* следующая серия: плейлист плеера зовёт внутренний play в обход Player.play */
function playlistWith(store, asFn) {
    const A = fixCtx(store), L = A.ctx.Lampa, got = [];
    L.Storage.field = n => (n === 'video_quality_default' ? '2160' : '');
    const internalPlay = d => { for (const k in d.quality) if (parseInt(k) == L.Storage.field('video_quality_default')) d.url = d.quality[k]; got.push(d.url); };
    L.Player = { getUrlQuality(q) { for (const k in q) if (parseInt(k) == L.Storage.field('video_quality_default')) return q[k]; return ''; }, play: internalPlay };
    let later = null;
    // как в Lampa: обработчик select — адрес строкой → сразу play, функцией → после колбэка (асинхронно)
    L.PlayerPlaylist = { listener: { send(type, e) { if (type !== 'select') return; if (typeof e.item.url === 'string') internalPlay(e.item); else e.item.url(() => internalPlay(e.item)); } } };
    A.M._hookPlay();
    const item = asFn ? { url(cb) { later = () => { item.url = 'u4k'; item.quality = Object.assign({}, QS); cb(); }; } } : { url: 'u4k', quality: Object.assign({}, QS) };
    L.PlayerPlaylist.listener.send('select', { item });
    if (later) later();
    return { got, L };
}
let pl = playlistWith(bw(8e6), false);
t('следующая серия (адрес строкой): 1080p при 8 Мбит/с', pl.got[0] === 'u1080' && pl.L.Storage.field('video_quality_default') === '2160');
pl = playlistWith(bw(8e6), true);
t('следующая серия (адрес добывается позже): 1080p при 8 Мбит/с', pl.got[0] === 'u1080' && pl.L.Storage.field('video_quality_default') === '2160');
t('следующая серия: без замеров — как раньше', playlistWith({}, true).got[0] === 'u4k');


/* HDRezka-премиум молчит: через 6 с параллельно Rezka, берём первый ответ */
function hedgeEnv() {
    const A = fixCtx({}), timers = [];
    A.ctx.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
    A.ctx.clearTimeout = id => { if (timers[id - 1]) timers[id - 1].fn = null; };
    const pend = {};
    const c = { urls: [], setDefaultQuality() {}, getFileUrl(f, call) { const u = f.url.replace(/^http:\/\/|\?.*$/g, ''); this.urls.push(u); pend[u] = call; } };
    A.M._patch(c);
    const res = [];
    c.getFileUrl({ url: 'http://online4.skaz.tv/lite/rhsprem/movie?e=1' }, j => res.push(j), true);
    const tick = () => timers.forEach(x => { if (x.fn && x.ms === 6000) { const f = x.fn; x.fn = null; f(); } });
    return { c, pend, res, tick, timers };
}
let H1 = hedgeEnv();
t('HDRezka молчит: до 6 с ждём только её', H1.c.urls.length === 1);
H1.tick();
t('HDRezka молчит: через 6 с параллельно Rezka', H1.c.urls[1] === 'online4.skaz.tv/lite/rezka/movie');
H1.pend['online4.skaz.tv/lite/rezka/movie']({ url: 'rz' }, {});
H1.pend['online4.skaz.tv/lite/rhsprem/movie'](false, {});   // таймаут Lampa через 20 с — уже не нужен
t('HDRezka молчит: берём Rezka, поздний отказ HDRezka не мешает', H1.res.length === 1 && H1.res[0].url === 'rz' && H1.c.urls.length === 2);
let H2 = hedgeEnv(); H2.tick();
H2.pend['online4.skaz.tv/lite/rhsprem/movie']({ url: 'prem' }, {});
H2.pend['online4.skaz.tv/lite/rezka/movie']({ url: 'rz' }, {});
t('HDRezka ответила раньше Rezka — берём HDRezka, один ответ', H2.res.length === 1 && H2.res[0].url === 'prem');
let H3 = hedgeEnv();
H3.pend['online4.skaz.tv/lite/rhsprem/movie']({ url: 'fast' }, {}); H3.tick();
t('HDRezka ответила быстро — Rezka не спрашиваем', H3.res.length === 1 && H3.c.urls.length === 1);
let H4 = hedgeEnv(); H4.tick();
H4.pend['online4.skaz.tv/lite/rezka/movie'](false, {});
t('оба молчат: пока HDRezka не ответила — ждём', H4.res.length === 0 || H4.c.urls.includes('online3.skaz.tv/lite/rezka/movie'));
if (H4.pend['online3.skaz.tv/lite/rezka/movie']) H4.pend['online3.skaz.tv/lite/rezka/movie'](false, {});
H4.pend['online4.skaz.tv/lite/rhsprem/movie'](false, {});
t('оба отказали — один отказ плагину', H4.res.length === 1 && H4.res[0] === false);

/* ---- polyfills.js: буфер AVPlay по умолчанию ---- */
function bufferFor(mode) {
    const calls = [], store = mode ? { bs_buffer: mode } : {};
    const av = { open() {}, setBufferingParam: (a, b, v) => calls.push(a + '=' + v), setStreamingProperty() {} };
    const w = { localStorage: { getItem: k => (k in store ? store[k] : null), setItem() {} }, webapis: { avplay: av }, navigator: { userAgent: 'x' } };
    w.window = w;
    const dom = {};
    for (const n of ['Node', 'Element', 'Document', 'DocumentFragment', 'CharacterData', 'DocumentType', 'HTMLCollection', 'NodeList', 'Event', 'CustomEvent', 'IDBFactory', 'URLSearchParams']) dom[n] = w[n] = function () {};
    const ctx = vm.createContext(Object.assign(dom, { window: w, webapis: w.webapis, navigator: w.navigator, document: { addEventListener() {}, createElement: () => ({ style: {} }) }, console: { log() {} },
        setTimeout: () => 0, clearTimeout() {}, Object, Array, String, JSON, Math, Date, parseInt, Promise }, {}));
    try { vm.runInContext(fs.readFileSync(path.join(SRC, 'polyfills.js'), 'utf8'), ctx); } catch (e) {}
    try { w.webapis.avplay.open('http://x/a.m3u8'); } catch (e) {}
    return calls.join(',');
}
t('буфер: по умолчанию 4 с до старта / 8 с после остановки', bufferFor('') === 'PLAYER_BUFFER_FOR_PLAY=4,PLAYER_BUFFER_FOR_RESUME=8');
t('буфер: «как у Samsung» — не трогаем', bufferFor('auto') === '');
t('буфер: «надёжно» 8/15', bufferFor('reliable') === 'PLAYER_BUFFER_FOR_PLAY=8,PLAYER_BUFFER_FOR_RESUME=15');

/* ---- bscontinue.js: продолжить с места ---- */
{
    const C = load('bscontinue.js', 'BSContinue'), M = C.M, st = C.store;
    const tv = { id: 7, name: 'Сериал', original_name: 'Show', poster_path: '/p.jpg', first_air_date: '2024-01-01' };
    const film = { id: 9, title: 'Фильм', original_title: 'Film', release_date: '2020-01-01' };
    M._record(tv, 2, 5, 600, 2400, 1000);
    let L = M._load();
    t('продолжить: серия записана', L.length === 1 && L[0].s === 2 && L[0].e === 5 && L[0].pos === 600 && !L[0].done);
    t('продолжить: подпись серии с остатком', M._label(L[0]) === 'S2 E5 · осталось 30 мин');
    M._record(film, 0, 0, 3000, 7200, 2000);
    L = M._load();
    t('продолжить: свежие сверху', L[0].card.id === 9 && L[1].card.id === 7);
    t('продолжить: подпись фильма', M._label(L[0]) === 'осталось 1 ч 10 мин');
    M._record(film, 0, 0, 7000, 7200, 3000);
    t('продолжить: досмотренный фильм уходит из ряда', M._load().every(r => r.card.id !== 9));
    M._record(tv, 2, 5, 2300, 2400, 4000);
    L = M._load();
    t('продолжить: досмотренная серия -> следующая', L[0].done && M._label(L[0]) === 'S2 E6 — следующая');
    M._record(tv, 2, 6, 10, 2400, 5000);
    t('продолжить: включили и сразу закрыли — прежняя запись цела', M._load()[0].e === 5 && M._load()[0].done);
    M._record({ id: 0, name: 'x' }, 1, 1, 100, 2400);
    M._record(tv, 1, 1, 100, 60);
    t('продолжить: без id и короткие ролики не пишем', M._load().length === 1);
    for (let i = 1; i <= 25; i++) M._record({ id: 100 + i, title: 'f' + i }, 0, 0, 100, 5000, 6000 + i);
    t('продолжить: не больше 20 записей', M._load().length === 20 && M._load()[0].card.id === 125);
    t('продолжить: в памяти только нужные поля карточки', JSON.stringify(Object.keys(M._load()[0].card)) === '["id","title"]');
    const done = { s: 2, e: 5, done: true }, now = Date.parse('2026-10-11');
    t('новые серии: вышла следующая — новая', JSON.stringify(M._newer(done, { season_number: 2, episode_number: 6, air_date: '2026-10-08' }, now)) === '{"s":2,"e":6}');
    t('новые серии: новый сезон — новая', M._newer(done, { season_number: 3, episode_number: 1, air_date: '2026-10-10' }, now).s === 3);
    t('новые серии: та же серия — нет', M._newer(done, { season_number: 2, episode_number: 5, air_date: '2026-10-08' }, now) === null);
    t('новые серии: вышла давно — не «новая»', M._newer(done, { season_number: 2, episode_number: 6, air_date: '2026-08-01' }, now) === null);
    t('новые серии: серию не досмотрели — не спрашиваем', M._newer({ s: 2, e: 5, done: false }, { season_number: 2, episode_number: 6, air_date: '2026-10-08' }, now) === null);
    t('новые серии: подпись', M._label({ s: 2, e: 5, done: true, pos: 1, dur: 2, news: { s: 2, e: 6 } }) === 'Новая серия S2 E6');
    { const all = M._load(); all[3].news = { s: 9, e: 1 }; st.bs_resume = JSON.stringify(all); }
    t('панель ТВ: сериал с новой серией — первым', M.hubItems()[0].subtitle === 'Новая серия S9 E1');
    t('панель ТВ: записи для ряда с меткой продолжения', M.hubItems().length === 8 && M.hubItems()[0].card.bs_resume === 1 && /осталось|S\d/.test(M.hubItems()[0].subtitle));
    st.bs_continue_row = 'false';
    t('панель ТВ: ряд выключен — записей нет', M.hubItems().length === 0);
    st.bs_continue_row = 'true';
}

/* ---- bswatch.js: отсчёт, «вы ещё смотрите?», субтитры ---- */
{
    const W = load('bswatch.js', 'BSWatch').M;
    const F = { enabled: true, autonext: true, next: true, cancelled: false, endMark: false, skip: false };
    t('отсчёт: последние 15 с серии', W._wantCountdown(12, 2400, F) && W._wantCountdown(15, 2400, F) && !W._wantCountdown(16, 2400, F));
    t('отсчёт: не в самом конце (переход уже идёт)', !W._wantCountdown(0.5, 2400, F));
    t('отсчёт: нет следующей серии — нет отсчёта', !W._wantCountdown(10, 2400, Object.assign({}, F, { next: false })));
    t('отсчёт: есть метка титров Skaz — свой отсчёт не нужен', !W._wantCountdown(10, 2400, Object.assign({}, F, { endMark: true })));
    t('отсчёт: видна кнопка Lampa «Следующая серия» — не мешаем', !W._wantCountdown(10, 2400, Object.assign({}, F, { skip: true })));
    t('отсчёт: автопереход Lampa выключен или отменён — молчим', !W._wantCountdown(10, 2400, Object.assign({}, F, { autonext: false })) && !W._wantCountdown(10, 2400, Object.assign({}, F, { cancelled: true })));
    t('отсчёт: короткие ролики — нет', !W._wantCountdown(10, 200, F));
    t('ещё смотрите: 3 серии без нажатий — спросить на 4-й', !W._wantStill(3, 3) && W._wantStill(4, 3));
    t('ещё смотрите: выключено', !W._wantStill(10, 0));
    t('детский режим: распознаёт 18+ пункты', W._hideAdultText.test('Клубничка') && W._hideAdultText.test('18+') && !W._hideAdultText.test('Фильмы'));
}


/* ---- bshub.js: панель Smart Hub ---- */
{
    const H = load('bshub.js', 'BSHub').M, now = Date.parse('2026-10-11');
    const tile = (c, extra) => Object.assign({ title: c.title || c.name, subtitle: '', image_ratio: '1by1', image_url: 'http://imagetmdb.com/t/p/w300/' + c.poster_path, action_data: JSON.stringify(c), is_playable: false }, extra || {});
    const gang = { id: 247718, name: 'Гангстерленд', original_name: 'MobLand', poster_path: '/g.jpg', backdrop_path: '/gb.jpg', original_language: 'en', first_air_date: '2025-03-30' };
    const spider = { id: 557, title: 'Человек-паук', poster_path: '/s.jpg', backdrop_path: '/sb.jpg', release_date: '2026-07-01' };
    const noBack = { id: 5, title: 'Без кадра', poster_path: '/n.jpg' };
    const turk = [{ id: 274556, name: 'Далекий город', original_name: 'Uzak Şehir', poster_path: '/u.jpg', backdrop_path: '/ub.jpg', first_air_date: '2024-11-11', original_language: 'tr' }];
    const popular = []; for (let i = 0; i < 12; i++) popular.push(tile(Object.assign({}, spider, { id: 600 + i }), { subtitle: '2026' }));
    const hub = JSON.stringify({ sections: [
        { title: 'Уведомления', position: 0, tiles: [tile(gang, { subtitle: 'Новая серия' })] },
        { title: 'Продолжить', position: 1, tiles: [tile(gang)] },
        { title: 'Популярное', position: 2, tiles: [tile(spider)].concat(popular, [tile(noBack)]) }] });
    const mineItems = [{ card: Object.assign({ bs_resume: 1 }, gang), subtitle: 'S1 E3 · осталось 20 мин' }];
    let r = H._rewrite(hub, mineItems, turk, {}, now, true), out = JSON.parse(r.json);
    t('панель ТВ: порядок — продолжить, уведомления, турецкие, популярное', out.sections.map(x => x.title).join('|') === 'Продолжить с места|Уведомления|Турецкие сериалы|Популярное' && out.sections.every((x, i) => x.position === i));
    const mine = out.sections[0];
    t('панель ТВ: плитка «Продолжить» ведёт на продолжение', JSON.parse(mine.tiles[0].action_data).bs_resume === 1 && mine.tiles[0].is_playable === true && mine.tiles[0].subtitle === 'S1 E3 · осталось 20 мин');
    t('панель ТВ: раздел виден в подписи плитки', out.sections[2].tiles[0].subtitle === 'Турецкий сериал · 2024' && out.sections[3].tiles[0].subtitle === 'Популярное · 2026' && out.sections[1].tiles[0].subtitle === 'Новая серия');
    t('панель ТВ: популярного не больше 8', out.sections[3].tiles.length === 8);
    t('панель ТВ: все плитки широкие, кадр без надписей пока не узнали', out.sections.every(s => s.tiles.every(x => x.image_ratio === '16by9')) && mine.tiles[0].image_url === 'http://imagetmdb.com/t/p/w780/gb.jpg');
    t('панель ТВ: плитка без кадра выпадает', !JSON.stringify(out).includes('Без кадра'));
    t('панель ТВ: кадры спрашиваем у TMDB по одному разу', r.missing.indexOf('tv:247718') === 0 && r.missing.indexOf('tv:274556') > 0 && r.missing.filter(k => k === 'tv:247718').length === 1 && r.cards['tv:274556'].id === 274556);
    const cache = {}; r.missing.forEach(k => { cache[k] = { p: '', t: now }; }); cache['tv:247718'] = { p: '/gang_ru.jpg', t: now };
    r = H._rewrite(hub, mineItems, turk, cache, now, true); out = JSON.parse(r.json);
    t('панель ТВ: узнанный кадр с названием', out.sections[0].tiles[0].image_url === 'http://imagetmdb.com/t/p/w780/gang_ru.jpg' && r.missing.length === 0);
    t('панель ТВ: старый кадр (>30 дней) переспрашиваем', H._rewrite(hub, [], [], { 'tv:247718': { p: '/x.jpg', t: now - 40 * 86400000 } }, now, true).missing.indexOf('tv:247718') === 0);
    t('панель ТВ: та же подмена — тот же результат', H._rewrite(hub, mineItems, turk, cache, now, true).json === r.json);
    out = JSON.parse(H._rewrite(hub, [], [], {}, now, true).json);
    t('панель ТВ: «Продолжить» пусто — ряд Lampa первым', out.sections[0].title === 'Продолжить' && out.sections.length === 3);
    out = JSON.parse(H._rewrite('', mineItems, turk, {}, now, true).json);
    t('панель ТВ: Lampa ещё не прислала — наши разделы', out.sections.map(x => x.title).join('|') === 'Продолжить с места|Турецкие сериалы');
    t('панель ТВ: испорченные данные не ломают', H._rewrite('{oops', [], [], {}, now, true).json === '{oops');
    t('панель ТВ: не чаще раза в 10 минут', H._waitFor(0, now) === 0 && H._waitFor(now - 4 * 60000, now) === 6 * 60000 && H._waitFor(now - 11 * 60000, now) === 0);
    // постеры (по умолчанию): форма данных как у Lampa — ТВ 2022 так значок не стирает
    out = JSON.parse(H._rewrite(hub, mineItems, turk, {}, now).json);
    const allTiles = [].concat.apply([], out.sections.map(x => x.tiles));
    t('постеры: все плитки 1:1 с постером w300, как у Lampa', allTiles.every(x => x.image_ratio === '1by1' && /^http:\/\/imagetmdb\.com\/t\/p\/w300\//.test(x.image_url)));
    t('постеры: без «Play» и без своих полей', allTiles.every(x => x.is_playable === false) && !/"bs"/.test(H._rewrite(hub, mineItems, turk, {}, now).json));
    t('постеры: не больше 3 разделов (при уведомлениях — без турецких)', out.sections.map(x => x.title).join('|') === 'Продолжить с места|Уведомления|Популярное');
    const hubNoNotice = JSON.stringify({ sections: JSON.parse(hub).sections.filter(x => x.position !== 0) });
    t('постеры: нет уведомлений — турецкие на их месте', JSON.parse(H._rewrite(hubNoNotice, mineItems, turk, {}, now).json).sections.map(x => x.title).join('|') === 'Продолжить с места|Турецкие сериалы|Популярное');
    t('постеры: «Продолжить» по-прежнему продолжает просмотр', JSON.parse(out.sections[0].tiles[0].action_data).bs_resume === 1 && out.sections[0].tiles[0].subtitle === 'S1 E3 · осталось 20 мин');
    t('постеры: кадры у TMDB не спрашиваем', H._rewrite(hub, mineItems, turk, {}, now).missing.length === 0);
    const imgs = { backdrops: [
        { file_path: '/plain.jpg', iso_639_1: null, width: 3840, vote_average: 9 },
        { file_path: '/en.jpg', iso_639_1: 'en', width: 1920, vote_average: 5 },
        { file_path: '/ru_small.jpg', iso_639_1: 'ru', width: 500, vote_average: 9 },
        { file_path: '/ru.jpg', iso_639_1: 'ru', width: 1920, vote_average: 1 },
        { file_path: '/tr.jpg', iso_639_1: 'tr', width: 1920, vote_average: 8 }] };
    t('кадр: с русским названием', H._pickArt(imgs, { original_language: 'tr' }) === '/ru.jpg');
    t('кадр: нет русского — английский', H._pickArt({ backdrops: imgs.backdrops.filter(b => b.iso_639_1 !== 'ru') }, { original_language: 'tr' }) === '/en.jpg');
    t('кадр: турецкий сериал — турецкое название', H._pickArt({ backdrops: imgs.backdrops.filter(b => b.iso_639_1 === 'tr' || !b.iso_639_1) }, { original_language: 'tr' }) === '/tr.jpg');
    t('кадр: без надписей — кадр карточки', H._pickArt({ backdrops: [{ file_path: '/plain.jpg', iso_639_1: null, width: 3840 }] }, { backdrop_path: '/card.jpg' }) === '/card.jpg');
    t('кадр: ничего нет', H._pickArt({ backdrops: [] }, {}) === '' && H._pickArt(null, {}) === '');
}

/* ---- bsprobe.js: вердикт потока и поиск серии ---- */
{
    const B = load('bsprobe.js', 'BSProbe').M;
    t('поток: 404/410/5xx — мёртвый', B._verdict(404, '', true) === 'dead' && B._verdict(410, '', false) === 'dead' && B._verdict(503, '', true) === 'dead');
    t('поток: плейлист с #EXTM3U — живой', B._verdict(200, '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nx.m3u8', true) === 'ok');
    t('поток: видеофайл 200/206 — живой', B._verdict(200, '', false) === 'ok' && B._verdict(206, '', false) === 'ok');
    t('поток: 403, нет ответа, странная страница — «не знаем», решает плеер', B._verdict(403, '', true) === 'unknown' && B._verdict(0, '', true) === 'unknown' && B._verdict(200, '<html>captcha', true) === 'unknown');
    const want = { season: 2, episode: 5, voice: 'HDrezka Studio' };
    const seasons = [{ text: '1 сезон', url: 's1', active: true }, { text: '2 сезон', url: 's2' }];
    t('серия: нужный сезон — переходим', B._decide([{ method: 'call', season: 1, episode: 5 }], seasons, want).go === 's2');
    t('серия: такого сезона нет — источник не подходит', B._decide([], [{ text: '1 сезон', url: 's1' }, { text: '3 сезон', url: 's3' }], want).missing === true);
    const s2 = [{ text: '1 сезон', url: 's1' }, { text: '2 сезон', url: 's2', active: true }, { text: 'Дубляж', url: 'v1', active: true }, { text: 'HDrezka Studio', url: 'v2' }];
    const st = {};
    t('серия: та же озвучка — переходим', B._decide([{ method: 'call', season: 2, episode: 5 }], s2, want, st).go === 'v2');
    const hit = B._decide([{ method: 'call', season: 2, episode: 4 }, { method: 'call', season: 2, episode: 5, url: 'e5' }], s2, want, st);
    t('серия: озвучку уже пробовали — берём серию в той, что есть', hit.item && hit.item.url === 'e5');
    t('серия: нет нужной серии', B._decide([{ method: 'call', season: 2, episode: 4 }], [], { season: 2, episode: 9 }).missing === true);
    t('серия: сезоны списком папок', B._decide([{ method: 'link', text: '1 сезон', url: 'a' }, { method: 'link', text: '2 сезон', url: 'b' }], [], want).go === 'b');
    t('серия: единственная папка — внутрь', B._decide([{ method: 'link', text: 'Rezka', url: 'only' }], [], want).go === 'only');
    t('фильм: первый запускаемый', B._decide([{ method: 'play', url: 'm' }], [], { season: 0, episode: 0 }).item.url === 'm');
    t('фильм: только «похожие» — у источника его нет', B._decide([{ method: 'link', similar: true, url: 'x' }, { method: 'link', similar: true, url: 'y' }], [], {}).missing === true);
    t('озвучка: обрезанное имя с «...» совпадает', B._sameVoice('HDrezka Studio (Укр)', 'HDrezka Studio...') && !B._sameVoice('Дубляж', 'LostFilm'));
    t('сезон: распознаём подписи', B._isSeasonLabel('2 сезон') && B._isSeasonLabel('Season 3') && !B._isSeasonLabel('Дубляж'));
}

{
    // «Продолжить или сначала»
    const W = (() => { const ctx = { window: {}, Lampa: {}, $: () => ({}), document: { addEventListener() {} }, console: { log() {} }, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, String, Object, Array, parseInt, parseFloat, isNaN };
        ctx.window = ctx; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(SRC, 'bswatch.js'), 'utf8') + ';this.M=BSWatch;', ctx); return ctx.M; })();
    const now = 100 * 86400000, H = 3600000, tl = p => ({ percent: p, time: 2400 });
    t('продолжить/сначала: смотрели 2 дня назад, на 40 % — спросить', W._wantResume(tl(40), { at: now - 48 * H }, now, 'old', 'continue'));
    t('продолжить/сначала: смотрели час назад — не спрашивать', !W._wantResume(tl(40), { at: now - H }, now, 'old', 'continue'));
    t('продолжить/сначала: почти досмотрено (95 %) и первая минута — не спрашивать', !W._wantResume(tl(95), { at: 0 }, now, 'old', 'continue') && !W._wantResume({ percent: 5, time: 30 }, { at: 0 }, now, 'always', 'continue'));
    t('плашка серии: название серии есть', JSON.stringify(W._epLines('Солдаты', 12, 15, 'Новенький')) === JSON.stringify({ show: 'Солдаты', ep: 'Сезон 12 · Серия 15', name: 'Новенький' }));
    t('плашка серии: «Серия 15» / «S12E15» — не повторяем', W._epLines('Солдаты', 12, 15, 'Серия 15').name === '' && W._epLines('X', 1, 2, 'S01E02').name === '');
    t('продолжить/сначала: «всегда» — и без нашей записи', W._wantResume(tl(40), null, now, 'always', 'continue'));
    t('продолжить/сначала: выключено или в Lampa «Тайм-код» не «Продолжить» — не спрашивать', !W._wantResume(tl(40), { at: 0 }, now, 'off', 'continue') && !W._wantResume(tl(40), { at: 0 }, now, 'old', 'ask'));
}
{
    // Telegram: чат из getUpdates, новая ли серия
    const ctx = { window: {}, console: { log() {} }, Date, Math, JSON, String, Object, Array, parseInt, setTimeout, setInterval };
    ctx.window = ctx; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(SRC, 'bstg.js'), 'utf8') + ';this.M=BSTelegram;', ctx);
    const T = ctx.M, now = Date.parse('2026-10-13');
    t('telegram: чат — из последнего сообщения боту', T._chatFrom([{ message: { chat: { id: 1 } } }, { message: { chat: { id: 42 } } }]) === '42' && T._chatFrom([]) === '');
    t('telegram: вышла серия новее — сообщить', T._isNew({ s: 12, e: 15 }, { season_number: 12, episode_number: 16, air_date: '2026-10-12' }, now));
    t('telegram: та же серия или сериал впервые — молчать', !T._isNew({ s: 12, e: 16 }, { season_number: 12, episode_number: 16, air_date: '2026-10-12' }, now) && !T._isNew(null, { season_number: 1, episode_number: 2, air_date: '2026-10-12' }, now));
    const d0 = new Date(2026, 9, 13).getTime();
    t('подписка: «через 3 дня (16 окт)»', T._nextText({ season_number: 12, episode_number: 17, air_date: '2026-10-16' }, d0) === 'Следующая серия: 12×17 — через 3 дня (16 окт)');
    t('подписка: завтра, 21 день, дата неизвестна', /завтра/.test(T._nextText({ season_number: 1, episode_number: 2, air_date: '2026-10-14' }, d0)) &&
        /через 21 день/.test(T._nextText({ season_number: 1, episode_number: 2, air_date: '2026-11-03' }, d0)) && /не объявлена/.test(T._nextText(null, d0)));
    t('подписка: кнопка — только на последней вышедшей серии', T._isLatest(12, 16, { season_number: 12, episode_number: 16 }) && !T._isLatest(12, 15, { season_number: 12, episode_number: 16 }));
    const tk = ('123456789:AA' + 'HdqTcvCH1vGWJxfSeofSAs0K5PALDsaw');
    const fr = T._tokenFrom('{"event":"open"}\n{"event":"message","id":"a1","time":100,"message":" ' + tk + ' "}\n{"event":"message","id":"b2","time":120,"message":"привет"}');
    t('telegram QR: токен из сообщения ntfy, дальше — после последнего (id)', fr[0] === tk && fr[1] === 'b2');
    t('telegram QR: без токена — пусто', T._tokenFrom('{"event":"message","time":5,"message":"abc"}')[0] === '');
    const day = new Date(2026, 9, 13).getTime();   // вт, 13 окт
    const seenW = { 1: { name: 'Солдаты', next: { s: 12, e: 17, d: '2026-10-16' } }, 2: { name: 'Кэрри', next: { s: 1, e: 3, d: '2026-10-14' } }, 3: { name: 'Далеко', next: { s: 1, e: 9, d: '2026-11-01' } } };
    const wl = T._weekLines(seenW, ['1', '2', '3'], day);
    t('сводка: только 7 дней, по дате', wl.length === 2 && /Кэрри 1×3/.test(wl[0]) && /^• пт 16 окт — Солдаты 12×17$/.test(wl[1]));
    t('сводка: неделя считается с понедельника', T._weekKey(new Date(2026, 9, 18, 12).getTime()) === '2026-10-12' && T._weekKey(day) === '2026-10-12' && T._weekKey(new Date(2026, 9, 19).getTime()) === '2026-10-19');
    t('бот поиск: подпись — название, год, тип, рейтинг', /^Солдаты \(2004\)\nСериал · ★ 7\.5/.test(T._caption({ media_type: 'tv', name: 'Солдаты', first_air_date: '2004-01-26', vote_average: 7.46, overview: 'Про армию' })));
    const sl = [{ media_type: 'tv', id: 1 }, { media_type: 'movie', id: 2 }, { media_type: 'movie', id: 3 }];
    const b0 = T._slideButtons(sl, 0), b1 = T._slideButtons(sl, 1);
    t('слайдер: сериал — подписка, стрелки по кругу, счётчик', b0[1].length === 2 && b0[2][0].callback_data === 'p:2' && b0[2][1].text === '1 / 3' && b0[2][2].callback_data === 'p:1');
    const bm = T._slideButtons(sl, 2, true);
    t('слайдер: есть ещё страницы — «3 / 3+», ▶ подгружает (p:3), а не по кругу', bm[2][1].text === '3 / 3+' && bm[2][2].callback_data === 'p:3');
    t('слайдер: фильм — «Смотреть» и «Хочу посмотреть», без подписки', b1[1].length === 1 && b1[0][0].callback_data === 'v:m:2' && b1[0][1].callback_data === 'w:m:2');
    const pq = T._parseQuery;
    t('поиск: «фильмы Марвел компании за 2026» — студия, тип, год', (p => p.studio && p.studio.company === 420 && p.type === 'movie' && p.year === 2026 && p.title === '')(pq('фильмы Марвел компании за 2026')));
    t('поиск: «Доктор Стрендж 2026» — название и год', (p => p.title === 'доктор стрендж' && p.year === 2026 && !p.studio)(pq('Доктор Стрендж 2026')));
    t('поиск: «2026» — только год', (p => p.year === 2026 && p.title === '')(pq('2026')));
    t('поиск: «сериалы Netflix» — сеть, тип', (p => p.type === 'tv' && p.studio.network === 213)(pq('сериалы Netflix')));
    const gm = text => ({ candidates: [{ content: { parts: [{ text }] } }] });
    t('картинка: ответ Gemini -> поиск по оригиналу с годом', (r => r.query === 'Doctor Strange 2016' && r.title === 'Доктор Стрэндж / Doctor Strange (2016)')(T._fromGemini(gm('{"title":"Доктор Стрэндж","original_title":"Doctor Strange","year":2016,"type":"movie","sure":true}'))));
    t('картинка: JSON внутри текста ```', T._fromGemini(gm('```json\n{"title":"Солдаты","original_title":"Солдаты","year":2004}\n```')).query === 'Солдаты 2004');
    t('картинка: не узнал — null', T._fromGemini(gm('{"title":"","original_title":""}')) === null && T._fromGemini({}) === null);
    t('картинка: ключ Gemini узнаётся, обычный текст — нет', T._isGeminiKey(('AI' + 'zaSyA1234567890abcdefghijklmnopqrstu')) && !T._isGeminiKey('Аватар 2009') && T._isGeminiKey(('AQ.' + 'Ab8RN6Jabcdefghij-klmnopqrstuvwxyz0123456789ABCDEF')));
    t('картинка: ключ любого будущего вида — тоже ключ', T._isGeminiKey('gk_live.9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c'));
    t('картинка: длинные названия и ссылки — не ключ', !T._isGeminiKey('Guardians of the Galaxy Vol. 3 2023') && !T._isGeminiKey('Pirates_of_the_Caribbean_Dead_Mans_Chest') && !T._isGeminiKey('https://www.kinopoisk.ru/film/12345678901234/'));
    const mk = (n, g = ['generateContent']) => ({ name: 'models/' + n, supportedGenerationMethods: g });
    const rk = T._rankModels([mk('gemini-2.5-pro'), mk('gemini-2.5-flash-lite'), mk('gemini-3.0-flash-preview'), mk('gemini-2.0-flash'), mk('gemini-2.5-flash'),
        mk('gemini-embedding-001', ['embedContent']), mk('gemini-2.5-flash-preview-tts'), mk('gemini-2.5-flash-image'), mk('gemini-flash-latest')]);
    t('модели: Lite первыми (самый большой бесплатный лимит), потом Flash; Pro, tts, embedding, image — нет',
        rk.join() === 'gemini-2.5-flash-lite,gemini-flash-latest,gemini-2.5-flash,gemini-2.0-flash,gemini-3.0-flash-preview');
    const gnow = Date.UTC(2026, 9, 13, 15, 0);
    t('модели: 429 PerDay — лимит на сегодня до 8:00 UTC завтра', (e => e.kind === 'day' && e.until === Date.UTC(2026, 9, 14, 8, 0))(T._geminiError(429, '{"error":{"message":"Quota exceeded","details":[{"violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}]}}', gnow)));
    t('модели: 429 в минуту — подождать retryDelay', (e => e.kind === 'minute' && e.until === gnow + 37000)(T._geminiError(429, '{"error":{"message":"Quota exceeded per minute","details":[{"retryDelay":"37s"}]}}', gnow)));
    t('модели: 503 high demand — занята', T._geminiError(503, '{"error":{"message":"This model is currently experiencing high demand."}}', gnow).kind === 'busy');
    t('модели: плохой ключ', T._geminiError(400, '{"error":{"message":"API key not valid. Please pass a valid API key."}}', gnow).kind === 'key');
    t('модели: все на сегодня — «лимит закончился» и время', /закончился у всех моделей/.test(T._geminiSummary([{ id: 'a', kind: 'day', until: gnow }, { id: 'b', kind: 'day', until: gnow }], gnow)));
    t('модели: перегружены — «через минуту», по каждой строка', (x => /через минуту/.test(x) && /• a — перегружена/.test(x) && /• b — лимит на сегодня/.test(x))(T._geminiSummary([{ id: 'a', kind: 'busy' }, { id: 'b', kind: 'day', until: gnow }], gnow)));
    const gt = T._guestTracked({ subs: [{ id: 1, tv: true }, { id: 2, tv: true }], want: [{ id: 1, tv: true }, { id: 3, tv: false }, { id: 4, tv: true }], muted: ['2'] });
    t('люди: уведомления — подписки и «Хочу посмотреть» (сериалы), без отписанных и повторов', gt.map(c => c.id).join() === '1,4');
    t('люди: пустой человек — пусто', T._guestTracked(null).length === 0 && T._guestTracked({}).length === 0);
    t('люди: карточка в список — сериал/фильм', T._mini({ id: 7, name: 'X', poster_path: '/p' }, 't').tv === true && T._mini({ id: 8, title: 'Y' }, 'm').name === 'Y');
    t('ИИ в поиске: описание — 5+ слов без года и студии', T._isDescription('фильм где мужик застрял на марсе') && !T._isDescription('Доктор Стрендж 2016') && !T._isDescription('Солдаты') && !T._isDescription('фильмы марвел про космос и героев 2026'));
    const upd = (id, text) => ({ update_id: id, message: { chat: { id: id }, text } });
    t('владелец при подключении — не гость, писавший последним', T._chatFrom2([upd(111, 'a'), upd(222, 'b')], { '222': {} }) === '111' && T._chatFrom2([upd(111, 'a'), upd(222, 'b')]) === '222');
    t('новый ТВ: код из сообщения — с пробелом, дефисом, слитно', T._joinFrom('1234 5678') === '12345678' && T._joinFrom('1234-5678') === '12345678' && T._joinFrom(' 12345678 ') === '12345678');
    t('новый ТВ: год и обычный текст — не код', T._joinFrom('2026') === '' && T._joinFrom('Солдаты 2004') === '' && T._joinFrom('123456789') === '');
    t('новый ТВ: тема зависит от кода', T._joinTopic('12345678') !== T._joinTopic('12345679') && /^lampa-join-[0-9a-f]{16}$/.test(T._joinTopic('12345678')));
    const jline = JSON.stringify({ event: 'message', time: 100, message: JSON.stringify({ t: 'join', token: ('123456789:AA' + 'HdqTcvCH1vGWJxfSeofSAs0K5PALDsaw'), chat: '42' }) });
    t('новый ТВ: токен и чат из темы', (m => m && m.chat === '42' && /^123456789:/.test(m.token))(T._joinMsg('{"event":"open"}\n' + jline + '\n', null)));
    t('новый ТВ: чужое в теме — не подключение', T._joinMsg(JSON.stringify({ event: 'message', message: '{"t":"join","token":"x"}' }), null) === null);
    t('имя ТВ: из настроек телевизора, без «[TV] »', T._cleanDevName({ device: { name: '[TV] Samsung Q60BA 55 TV' } }) === 'Samsung Q60BA 55 TV');
    const lb = T._tvLabels([{ id: 'aaa1', name: 'Samsung TV', model: 'QE55', ip: '1' }, { id: 'bbb2', name: 'Samsung TV', model: 'UE43', ip: '1' }, { id: 'ccc3', name: 'Зал', ip: '1' }]);
    t('имя ТВ: одинаковые различаются моделью', lb[0].text === '📺 Samsung TV · QE55' && lb[1].text === '📺 Samsung TV · UE43' && lb[2].text === '📺 Зал');
    const lb2 = T._tvLabels([{ id: 'aaa1', name: 'Samsung TV', model: 'QE55', ip: '1' }, { id: 'bbb2', name: 'Samsung TV', model: 'QE55', ip: '1' }]);
    t('имя ТВ: другой ТВ без адреса — помечен «старая Lampa»', T._tvLabels([{ id: 'zzz9', name: 'ТВ PIW' }])[0].text === '📺 ТВ PIW (старая Lampa)');
    t('имя ТВ: и модель одинаковая — кусочек id', lb2[0].text === '📺 Samsung TV · AAA' && lb2[1].text === '📺 Samsung TV · BBB');
    t('поиск: просто название — без года и студии', (p => p.title === 'солдаты' && !p.year && !p.studio)(pq('Солдаты')));
    t('telegram: новая, но вышла давно — молчать', !T._isNew({ s: 1, e: 1 }, { season_number: 1, episode_number: 5, air_date: '2026-09-01' }, now));
}
{
    // «Фильм — сразу по-русски»: выбор озвучки
    const ctx = { window: {}, Lampa: {}, $: () => ({}), document: { addEventListener() {} }, console: { log() {} }, setTimeout, setInterval, clearInterval, Date, Math, JSON, String, Object, Array, parseInt, isNaN };
    ctx.window = ctx; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(SRC, 'bscontinue.js'), 'utf8') + ';this.M=BSContinue;', ctx);
    const C = ctx.M;
    const opts = [{ translate: 'Украинский' }, { translate: 'Оригинал (ENG)' }, { translate: 'HDrezka Studio' }, { translate: 'Дубляж' }, { title: 'Субтитры' }];
    t('по-русски: дубляж лучше прочих русских', C._pickRu(opts) === opts[3]);
    t('по-русски: без дубляжа — любая русская, не украинская/оригинал', C._pickRu([opts[0], opts[1], opts[2]]) === opts[2]);
    t('по-русски: русских нет — ничего', C._pickRu([opts[0], opts[1], opts[4]]) === null);
}
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
