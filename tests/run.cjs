// Автотесты логики модулей пакета (без телевизора и без сети): node tests/run.cjs
// Запускаются из pack.py перед каждой сборкой.
const fs = require('fs'), vm = require('vm'), path = require('path');
const SRC = path.join(__dirname, '..', 'src');
let pass = 0, fail = 0;
function t(name, cond) { if (cond) pass++; else { fail++; console.log('FAIL', name); } }
// Bot API шлётся POST (параметры в теле): для проверок склеиваем адрес и тело, как раньше было в адресе GET
const tgReq = (u, b) => String(u) + (b ? '?' + b : '');
const dec = s => { try { return decodeURIComponent(s); } catch (e) { return s; } };

function load(file, name, store) {
    store = store || {};
    const ls = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
    const w = { localStorage: ls, appready: false };
    const ctx = { window: w, XMLHttpRequest: function () {}, Node: function () {}, document: { hidden: false, addEventListener() {} },
        navigator: { userAgent: 'test', onLine: true }, location: { reload() {} }, setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, clearInterval() {},
        console, JSON, Math, Date, Infinity, String, Array, Object, Number, Promise, parseInt, parseFloat, isNaN };
    ctx.XMLHttpRequest.prototype = { open() {}, send() {}, setRequestHeader() {} }; ctx.Node.prototype = { appendChild() {} };
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
// сервер ТВ by Skaz (skaz_domain) — настройка самого Skaz: автовыбор его не меняет никогда
x = decide({ skaz_domain: 'skaz.tv' }, res({ 'skaz.tv': S(null), 'skaztv.top': S(60) }, ON), 'fast');
t('серверы: сервер ТВ by Skaz не трогаем — даже если не отвечает', x.store.skaz_domain === 'skaz.tv' && !('bs_srv_pending' in x.store));
x = decide({ skaz_domain: 'skaztv.online' }, res({ 'skaztv.online': S(400), 'skaztv.top': S(60) }, ON), 'full');
t('серверы: сервер ТВ by Skaz не трогаем — даже если другой быстрее', x.store.skaz_domain === 'skaztv.online' && !('bs_srv_pending' in x.store));
{
    const m = load('skazauto.js', 'BSSkaz', { skaz_domain: 'skaztv.online', bs_srv_pending: '{"domain":"skaztv.top"}' });
    m.M.prepare(() => {});
    t('серверы: старый совет перейти на skaztv.top отменяется, сервер ТВ прежний', m.store.skaz_domain === 'skaztv.online' && m.store.bs_srv_pending === '{}');
}
// серверы источников фильмов (skazonline_servers): прямые или через Cloudflare
const SLOW_DIRECT = Object.assign({}, ON, { online3: S(600), online4: S(620), online5: S(610), online7: S(640) });
x = decide({}, res({}, DEAD_DIRECT), 'fast'); t('источники: прямые мертвы до запуска -> Cloudflare', x.store.skazonline_servers === 'true');
x = decide({}, res({}, SLOW_DIRECT), 'fast'); t('источники: медленные, но живые — до запуска не трогаем', !('skazonline_servers' in x.store));
x = decide({}, res({}, SLOW_DIRECT), 'full'); t('источники: заметно медленнее -> со следующего запуска', JSON.parse(x.store.bs_srv_pending).family === 'cf' && !('skazonline_servers' in x.store));
x = decide({ bs_srv_manual: String(Date.now()) }, res({}, SLOW_DIRECT), 'full'); t('источники: выбраны вручную — советы «быстрее» не перебивают', !x.store.bs_srv_pending);
x = decide({ bs_srv_set: 'cf' }, res({}, SLOW_DIRECT), 'full'); t('источники: переключили в настройках Skaz — это ручной выбор, советы не перебивают', !JSON.parse(x.store.bs_srv_pending || '{}').family && !!x.store.bs_srv_manual);
x = decide({ bs_srv_set: 'cf' }, res({}, DEAD_DIRECT), 'fast'); t('источники: переключили в Skaz на мёртвые — всё равно спасаем', x.store.skazonline_servers === 'true');
x = decide({ bs_srv_set: 'direct' }, res({}, SLOW_DIRECT), 'full'); t('источники: сами не переключали — совет как обычно', JSON.parse(x.store.bs_srv_pending).family === 'cf');
x = decide({}, res({}, Object.assign({}, ON, { onlinecf3: S(70), onlinecf4: S(75) })), 'full'); t('источники: малая разница — не прыгаем', !x.store.bs_srv_pending && !('skazonline_servers' in x.store));
const ALL_DEAD = {}; Object.keys(ON).forEach(k => { ALL_DEAD[k] = S(null); });
x = decide({}, res({}, ALL_DEAD), 'full'); t('источники: все мертвы — ничего не меняем', !('skazonline_servers' in x.store));
function decide2(store, r) { const m = load('skazauto.js', 'BSSkaz', store); const r1 = m.M._decide(r, 'full'), r2 = m.M._decide(r, 'full'); return { r1, r2, store: m.store }; }
const LOSSY_DIRECT = Object.assign({}, ON, { online3: S(100, 0, 0.75), online4: S(100, 0, 0.75), online5: S(100, 0, 0.75), online7: S(100, 0, 0.75) });
let x2 = decide2({}, res({}, LOSSY_DIRECT));
t('источники: потери 75% — первый замер только подозрение', x2.r1 === false);
t('источники: потери 75% два замера подряд -> Cloudflare + перезапуск', x2.r2 === true && x2.store.skazonline_servers === 'true');
x2 = decide2({}, res({}, DEAD_DIRECT)); t('источники: прямые мертвы два замера -> Cloudflare', x2.store.skazonline_servers === 'true' && x2.r2 === true);
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
    const ctx = { window: {}, console: { log() {} }, Date, Math, JSON, String, Object, Array, parseInt, setTimeout: () => 0, setInterval: () => 0, XMLHttpRequest: function () { this.open = () => {}; this.send = () => {}; this.setRequestHeader = () => {}; } };
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
    function X() { this.open = (m, u) => { this.u = u; }; this.send = b => urls.push(tgReq(this.u, b)); this.setRequestHeader = () => {}; }
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
/* ---- bsmenu.js: «Смотреть» без входа в CUB — один раз выбор ---- */
{
    const withLampa = (store, access, main) => {
        store = store || {};
        const ls = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
        const shown = [], used = [];
        const Lampa = { Account: { Permit: { access } }, Storage: { get: () => '', set() {} }, Controller: { enabled: () => ({ name: 'full_start' }), toggle() {} },
            Select: { show: o => shown.push(o) }, Noty: { show() {} }, Settings: { create: n => used.push('settings:' + n) }, Activity: { replace: () => used.push('replace') } };
        const BSSources = { mainId: () => main || 'skaz', useMain: (id, cb) => { used.push('use:' + id); cb(); } };
        const w = { localStorage: ls, Lampa, BSSources };
        const ctx = { window: w, Lampa, BSSources, $: () => ({}), document: { addEventListener() {} }, setTimeout: f => f(), console, JSON, Math, Date, String, Array, Object, Number, parseInt };
        w.window = w; vm.createContext(ctx);
        vm.runInContext(fs.readFileSync(path.join(SRC, 'bsmenu.js'), 'utf8') + ';this.M=BSMenu;', ctx);
        return { M: ctx.M, store, shown, used };
    };
    t('CUB: не вошёл, главный Skaz — спросить', withLampa({}, false).M._needCubChoice() === true);
    t('CUB: вошёл / главный не Skaz / уже выбирал — не спрашивать', !withLampa({}, true).M._needCubChoice() && !withLampa({}, false, 'z01').M._needCubChoice()
        && !withLampa({ bs_cub_choice: 'done' }, false).M._needCubChoice());
    const a = withLampa({}, false); let opened = 0;
    a.M._cubChoice(() => opened++);
    t('CUB: три варианта — вход, Z01 без входа, всё равно Skaz', a.shown.length === 1 && a.shown[0].items.map(i => i.id).join() === 'login,z01,skaz');
    a.shown[0].onSelect(a.shown[0].items[1]);
    t('CUB: «без входа» — Z01 главным и карточка заново, больше не спрашиваем', a.used.join() === 'use:z01,replace' && a.store.bs_cub_choice === 'done' && opened === 0);
    const b = withLampa({}, false); b.M._cubChoice(() => {}); b.shown[0].onSelect(b.shown[0].items[0]);
    t('CUB: «войти» — экран аккаунта Lampa', b.used.join() === 'settings:account');
    const c = withLampa({}, false); let op = 0; c.M._cubChoice(() => op++); c.shown[0].onSelect(c.shown[0].items[2]);
    t('CUB: «всё равно Skaz» — открываем Skaz', op === 1);
}
t('турецкие: по языку или стране', MN._isTurkish({ original_language: 'tr' }) && MN._isTurkish({ original_language: 'en', origin_country: ['TR'] }) && !MN._isTurkish({ original_language: 'ru', origin_country: ['RU'] }));
t('турецкие: название из TMDB экранируется', MN._esc('<b>"x"&') === '&lt;b&gt;&quot;x&quot;&amp;');
t('мультики: пункт меню выключен, пока его не включат', !MN._kidsEnabled() && load('bsmenu.js', 'BSMenu', { bs_menu_kids: 'true' }).M._kidsEnabled());
t('мультики: по умолчанию мультсериалы, «все детские»; выбор запоминается', MN._kidsType() === 'tv' && MN._kidsBand() === 0
    && load('bsmenu.js', 'BSMenu', { bs_kids_band: '2', bs_kids_type: 'movie' }).M._kidsBand() === 2 && load('bsmenu.js', 'BSMenu', { bs_kids_type: 'movie' }).M._kidsType() === 'movie'
    && load('bsmenu.js', 'BSMenu', { bs_kids_band: '9' }).M._kidsBand() === 0);
{
    const once = u => { const ks = u.split('?')[1].split('&').map(p => p.split('=')[0]); return ks.length === new Set(ks).size; };
    const tvAll = MN._kidsQueries('tv', { g: 35, p: { sort_by: 'popularity.desc', 'vote_count.gte': '30' } });
    t('мультики: «все детские» — жанр «Детский» + рейтинги США и России, параметры не повторяются',
        tvAll.length === 3 && tvAll.every(once) && /with_genres=16,10762,35&/.test(tvAll[0]) && /certification=TV-Y%7CTV-Y7/.test(tvAll[1]) && /certification_country=RU/.test(tvAll[2])
        && tvAll.every(u => /vote_count.gte=30/.test(u) && /without_genres=80,18,/.test(u)));
    const movSmall = load('bsmenu.js', 'BSMenu', { bs_kids_band: '1' }).M._kidsQueries('movie', { p: { '{date}.gte': '2010-01-01', '{date}.lte': '2019-12-31' } });
    t('мультики: фильмы малышам — G, 0+ и советские; десятилетие заменяет «до 1991»', movSmall.length === 3 && movSmall.every(once)
        && /certification=G&/.test(movSmall[0]) && /primary_release_date.lte=2019-12-31/.test(movSmall[2]) && /without_genres=27,80,/.test(movSmall[0]));
    const su = MN._kidsQueries('movie', { only: [{ g: [16], lang: 'ru', to: '1991-12-31' }], p: { sort_by: 'vote_count.desc' } });
    t('мультики: советские — один запрос, самые оцениваемые первыми', su.length === 1 && /with_original_language=ru/.test(su[0]) && /primary_release_date.lte=1991-12-31/.test(su[0]) && /sort_by=vote_count.desc/.test(su[0]));
    const seen = {}, r1 = MN._kidsMerge([{ results: [{ id: 1, name: 'А', original_name: 'A', poster_path: '/a', popularity: 5 }, { id: 2, name: 'Bluey', original_name: 'Bluey', poster_path: '/b', overview: '', original_language: 'en' }] },
        { results: [{ id: 1, name: 'А', poster_path: '/a' }, { id: 3, name: 'Б', poster_path: '/c', popularity: 9 }, { id: 4, name: 'В', original_name: 'V' }] }], seen);
    t('мультики: выдача без повторов, без непереведённого и без обложки, популярные первыми', r1.map(r => r.id).join() === '3,1' && r1[0].source === 'tmdb');
    t('мультики: «Царь горы» не детский, турецкие без перевода — можно', MN._kidsJunk({ id: 2122, poster_path: '/x', overview: 'о' })
        && !MN._kidsJunk({ id: 5, name: 'İbi', original_name: 'İbi', poster_path: '/x', original_language: 'tr' }, true) && MN._kidsJunk({ id: 5, name: 'İbi', original_name: 'İbi', poster_path: '/x', original_language: 'tr' }));
    t('мультики: повтор со следующей страницы не показывается', MN._kidsMerge([{ results: [{ id: 3, name: 'Б', poster_path: '/c' }] }], seen).length === 0);
}
t('мультики: в сохранённом порядке меню — после «Турецких сериалов», не в конце', (() => {
    const r = MN._menuSortPlace(['Главная', 'Сериалы', 'Турецкие сериалы', 'Персоны', 'Shots'], 'Мультики', ['Турецкие сериалы', 'Сериалы']);
    const r2 = MN._menuSortPlace(['Главная', 'Сериалы', 'Shots'], 'Мультики', ['Турецкие сериалы', 'Сериалы']);
    const same = ['Мультики', 'Главная'];
    return r.join() === 'Главная,Сериалы,Турецкие сериалы,Мультики,Персоны,Shots' && r2.join() === 'Главная,Сериалы,Мультики,Shots'
        && MN._menuSortPlace(same, 'Мультики', ['Сериалы']) === same && MN._menuSortPlace([], 'Мультики', ['Сериалы']).length === 0;
})());
t('мультики: поиск — мультфильмы и детские, но не взрослая анимация и ужасы', MN._isKids({ genre_ids: [10762] }) && MN._isKids({ genre_ids: [16, 35], name: 'x' })
    && !MN._isKids({ genre_ids: [16, 18], name: 'x' }) && MN._isKids({ genre_ids: [16, 18], title: 'Король Лев' }) && !MN._isKids({ genre_ids: [16, 27], title: 'x' }) && !MN._isKids({ genre_ids: [35] }));


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
    ctx.XMLHttpRequest.prototype = { open() {}, send() {}, setRequestHeader() {} }; w.window = w; vm.createContext(ctx);
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

/* смена источника не выходя из плеера */
A = fixCtx(); A.ctx.Lampa.Player.opened = () => true;
A.ctx.window.BSProbe = raceProbe({ name: 'kinopub', title: 'KinoPub', verdict: 'ok', url: 'http://cdn2/ep7.mp4' }, [{ name: 'filmix', verdict: 'missing' }]);
ac = fakeComp(A, ['zzz']); ac.requestParams = u => u; ac.getChoice = () => ({ voice_name: 'Дубляж' });
ac.getFileUrl({ url: 'http://online3.skaz.tv/lite/rezka/movie', season: 2, episode: 7 }, () => {});
{
    let got = null;
    const started = A.M.findInPlayer(r => { got = r; });
    t('в плеере: нашёл источник — отдаёт проверенную ссылку и имя', started === true && got && got.url === 'http://cdn2/ep7.mp4' && got.title === 'KinoPub');
    t('в плеере: список под плеером не трогаем, пока плеер открыт', ac.switched.length === 0);
    t('в плеере: ищем ту же серию и озвучку, без упавшего', A.ctx.window.BSProbe.calls[0].want.episode === 7 && A.ctx.window.BSProbe.calls[0].want.voice === 'Дубляж'
        && A.ctx.window.BSProbe.calls[0].exclude.indexOf('rhsprem') >= 0);
    t('в плеере: «что играет» — уже новый источник', A.M.current().balanser === 'kinopub');
    A.ctx.Lampa.Player.opened = () => false; A.M._afterPlayer();
    t('в плеере: вышли из плеера — список переключён на рабочий источник', ac.switched[0] === 'kinopub');
    A.M._afterPlayer();
    t('в плеере: второй выход — ничего не переключает', ac.switched.length === 1);
}
A = fixCtx(); A.ctx.Lampa.Player.opened = () => true;
A.ctx.window.BSProbe = raceProbe(null, [{ name: 'a', verdict: 'dead' }]);
ac = fakeComp(A, ['x']); ac.requestParams = u => u; ac.getChoice = () => ({});
ac.getFileUrl({ url: 'http://x', episode: 1 }, () => {});
{ let got = 1; A.M.findInPlayer(r => { got = r; }); t('в плеере: рабочего нет — так и говорит (null)', got === null); }
A = fixCtx({ bs_auto_source: 'false' }); ac = fakeComp(A, ['x']); ac.requestParams = u => u; ac.getFileUrl({ url: 'http://x' }, () => {});
A.ctx.window.BSProbe = raceProbe(null, []);
t('в плеере: автоподбор выключен — не ищем', A.M.findInPlayer(() => {}) === false);
A = fixCtx(); ac = fakeComp(A, ['x']); ac.requestParams = u => u; ac.getFileUrl({ url: 'http://x' }, () => {});
t('в плеере: без проверки источников — по-старому (false)', A.M.findInPlayer(() => {}) === false);
{
    // автопереход на 3-ю серию: ссылка из плейлиста (плеер ТВ) просрочена через 2 ч — источник тот же, берём свежую у него
    A = fixCtx(); A.ctx.Lampa.Player.opened = () => true;
    A.ctx.window.BSProbe = raceProbe({ name: 'rezka', title: 'Rezka', verdict: 'ok', url: 'http://cdn/ep3-fresh.mp4' }, []);
    ac = fakeComp(A, ['x']); ac.requestParams = u => u; ac.getChoice = () => ({});
    A.env.bal = 'rezka';
    ac.getFileUrl({ url: 'http://online3.skaz.tv/lite/rezka', season: 2, episode: 1 }, () => {});
    A.ctx.Lampa.PlayerPlaylist = { listener: { send() {} } };
    A.M._hookPlay();
    const realNow = Date.now;
    try {
        Date.now = () => realNow() + 2 * 3600000;
        A.ctx.Lampa.PlayerPlaylist.listener.send('select', { item: { url: 'http://cdn/ep3-old.mp4', season: 2, episode: 3 } });
        const cur = A.M.current();
        t('следующая серия из плейлиста: «что играет» — она же, тот же источник', !!cur && cur.episode === 3 && cur.balanser === 'rezka');
        let got = null;
        A.M.findInPlayer(r => { got = r; });
        const c0 = A.ctx.window.BSProbe.calls[0];
        t('просроченная ссылка из плейлиста: тот же источник не исключён и не помечен упавшим', c0.exclude.indexOf('rezka') < 0 && A.ctx.window.BSProbe.marks.indexOf('rezka=failed') < 0 && c0.want.episode === 3);
        t('просроченная ссылка: свежая ссылка того же источника', got && got.url === 'http://cdn/ep3-fresh.mp4');
    } finally { Date.now = realNow; }
}
{
    // сторож: источник не пошёл — ищет другой, не закрывая плеер, и подменяет поток
    const fx = { cb: null, current: () => ({ name: 'Rezka', time: 0 }), findInPlayer(cb) { this.cb = cb; return true; }, played() {} };
    const g = guardEnv({ tizen: true, bsfix: fx });
    g.fire('player:start', { url: 'http://cdn/1080.mp4' }); g.clock.run(27000);
    t('сторож: источник не пошёл — «ищу другой, не выходя из плеера», плеер открыт', g.notes.some(n => /Rezka.*ищу другой, не выходя из плеера/.test(n)) && g.events.indexOf('close') < 0 && !!fx.cb);
    g.clock.run(9000);
    t('сторож: пока ищем — не закрывает и не дёргает качество', g.events.indexOf('close') < 0 && !g.events.some(e => /^quality/.test(e)));
    fx.cb({ name: 'kinopub', title: 'KinoPub', url: 'http://cdn2/ep.mp4', verdict: 'ok' });
    t('сторож: нашёл — поток подменён в том же плеере и написано, на какой источник', g.events.indexOf('quality http://cdn2/ep.mp4') >= 0
        && g.notes.some(n => /Переключаю на «KinoPub» — поток проверен/.test(n)) && g.events.indexOf('close') < 0);
    g.fire('video:timeupdate', { current: 1 }); g.clock.run(500); g.fire('video:timeupdate', { current: 2 }); g.clock.run(15000);
    t('сторож: новый поток пошёл — остаёмся в плеере', g.events.indexOf('close') < 0);

    const fx2 = { current: () => ({ name: 'Rezka', time: 0 }), findInPlayer(cb) { cb(null); return true; }, played() {} };
    const g2 = guardEnv({ tizen: true, bsfix: fx2 });
    g2.fire('player:start', { url: 'http://cdn/1080.mp4' }); g2.clock.run(32000);
    t('сторож: рабочего источника нет — подсказка и закрытие плеера', g2.notes.some(n => /Рабочий источник не найден/.test(n)) && g2.events.indexOf('close') >= 0);

    const fx3 = { current: () => ({ name: 'Rezka', time: 0 }), findInPlayer() { return true; }, played() {} };
    const g3 = guardEnv({ tizen: true, bsfix: fx3 });
    g3.fire('player:start', { url: 'http://cdn/1080.mp4' }); g3.clock.run(26000);
    t('сторож: поиск молчит — не ждём вечно', g3.events.indexOf('close') < 0);
    g3.clock.run(26000);
    t('сторож: …через 20 с — закрытие с подсказкой', g3.events.indexOf('close') >= 0 && g3.notes.some(n => /Рабочий источник не найден/.test(n)));

    const fx4 = { current: () => ({ name: 'Rezka', time: 0 }), findInPlayer() { return false; }, played() {}, autoNext() { this.next = true; } };
    const g4 = guardEnv({ tizen: true, bsfix: fx4 });
    g4.fire('player:start', { url: 'http://cdn/1080.mp4' }); g4.clock.run(32000);
    t('сторож: искать в плеере нельзя — по-старому: закрытие и автоподбор', g4.events.indexOf('close') >= 0 && fx4.next === true);
}
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
    const av = { setListener(l) { this.l = l; }, prepareAsync(ok, fail) { this.fail = fail; },
        play() { if (this.throwPlay) { const e = new Error('PLAYER_ERROR_INVALID_STATE'); e.name = 'InvalidStateError'; throw e; } } };
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
    const doc = { hidden: false, addEventListener: (ev, fn) => { (H['doc:' + ev] = H['doc:' + ev] || []).push(fn); } };
    const ctx = { window: w, Lampa, document: doc, navigator: { onLine: true }, console: { log() {} },
        setTimeout: (f, ms) => set(f, ms || 0), clearTimeout: id => { timers = timers.filter(x => x.id !== id); }, setInterval: (f, ms) => set(f, ms, true), clearInterval: id => { timers = timers.filter(x => x.id !== id); },
        Date: { now: () => now }, Math, JSON, String, Object, Array, parseFloat, parseInt, isNaN };
    if (opt.bsfix) { w.BSFix = opt.bsfix; ctx.BSFix = opt.bsfix; ctx.$ = () => ({ addClass() {} }); }
    w.window = w; vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(SRC, 'playerguard.js'), 'utf8') + ';this.M=BSGuard;', ctx);
    ctx.M.start();
    const fire = (k, d) => (H[k] || []).forEach(f => f(d));
    return { M: ctx.M, clock, fire, notes, events, av, store, plays, ls, doc };
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
    // INVALID_STATE из play() бывает и у рабочих каналов (TV Skaz на ТВ: поток пошёл сам через 6,6 с) — не ошибка
    const g5 = guardEnv();
    g5.fire('player:start', { url: 'http://cdn/1080.m3u8' }); g5.clock.run(500);
    g5.av.throwPlay = true;
    try { g5.av.play(); } catch (e) {}
    g5.clock.run(3500);
    t('сторож: исключение из play() не считается ошибкой — рабочий канал не перезапускаем', g5.notes.length === 0);
    const g7 = guardEnv(); g7.av.setListener({});
    g7.fire('player:start', { url: 'http://cdn/1080.m3u8' }); g7.clock.run(500);
    g7.av.l.onerror('PLAYER_ERROR_CONNECTION_FAILED'); g7.clock.run(3500);
    t('сторож: обрыв соединения до картинки — вмешивается за ~3 с', g7.notes.length > 0);
    const g6 = guardEnv(); g6.av.setListener({});
    g6.fire('player:start', { url: 'http://cdn/1080.m3u8' }); g6.clock.run(500);
    g6.fire('video:timeupdate', { current: 1 }); g6.clock.run(500); g6.fire('video:timeupdate', { current: 2 });
    for (let k = 3; k < 6; k++) { g6.clock.run(500); g6.fire('video:timeupdate', { current: k }); }
    g6.av.l.onerror('PLAYER_ERROR_CONNECTION_FAILED');
    for (let k = 6; k < 12; k++) { g6.clock.run(500); g6.fire('video:timeupdate', { current: k }); }
    t('сторож: ошибка во время просмотра — даём плееру 6 с восстановиться (не дёргаем за 3 с)', g6.notes.length === 0);
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

{
    // возврат из Smart Hub: Lampa 3.3.7 сама восстанавливает AVPlay (restoreAsync, до 15 с) — сторож не мешает
    const back = g => { g.doc.hidden = true; g.fire('doc:visibilitychange'); g.clock.run(60000); g.doc.hidden = false; g.fire('doc:visibilitychange'); };
    let g = guardEnv();
    g.fire('player:start', { url: 'http://cdn/1080.m3u8' }); g.clock.run(1000);
    for (let k = 1; k <= 10; k++) { g.fire('video:timeupdate', { current: k }); g.clock.run(500); }
    back(g);
    g.clock.run(22000);
    t('Smart Hub: вернулись — 22 с без картинки (дольше 20 с PLAY_LIMIT) поток не трогаем, Lampa восстанавливает', g.notes.length === 0 && g.events.length === 0);
    g.clock.run(5000);
    t('Smart Hub: не восстановилось и после паузы 25 с — сторож действует как обычно', g.notes.length > 0);
    g = guardEnv();
    g.fire('player:start', { url: 'http://cdn/1080.m3u8' }); g.clock.run(1000);
    for (let k = 1; k <= 10; k++) { g.fire('video:timeupdate', { current: k }); g.clock.run(500); }
    back(g); g.clock.run(12000);
    for (let k = 11; k <= 60; k++) { g.fire('video:timeupdate', { current: k }); g.clock.run(1000); }
    t('Smart Hub: Lampa восстановила за 12 с — видео идёт, сторож молчит', g.notes.length === 0);
    g = guardEnv(); g.av.setListener({}); g.fire('player:start', { url: 'http://cdn/1080.m3u8' }); g.clock.run(1000);
    for (let k = 1; k <= 10; k++) { g.fire('video:timeupdate', { current: k }); g.clock.run(500); }
    back(g); g.av.l.onerror('PLAYER_ERROR_CONNECTION_FAILED'); g.clock.run(10000);
    t('Smart Hub: ошибка посреди восстановления — до конца паузы не перезапускаем', g.notes.length === 0);
    g.clock.run(17000);
    t('Smart Hub: …после паузы — перезапуск того же потока', g.notes.some(n => /перезапускаю/.test(n)));
    t('Smart Hub: пауза — помощник', g.M._inGrace({ graceUntil: 10 }, 5) && !g.M._inGrace({ graceUntil: 10 }, 11) && !g.M._inGrace({ graceUntil: 0 }, 1));
    // слушатель AVPlay не оборачиваем дважды
    const g2 = guardEnv(), seen = [];
    g2.M._hookAvplay(); g2.M._hookAvplay();
    g2.av.setListener({ onerror: x => seen.push(x) }); g2.fire('player:start', { url: 'http://cdn/1080.m3u8' });
    g2.av.l.onerror('E'); g2.av.prepareAsync(() => {}, () => seen.push('p')); g2.av.fail({ name: 'X' });
    t('сторож: повторный hookAvplay — слушатель и prepareAsync обёрнуты один раз', seen.join() === 'E,p' && g2.av.setListener.__bsGuard && g2.av.prepareAsync.__bsGuard);
}

/* ---- index.html: плитки Smart Hub не отправляются — первым скриптом, до Lampa (служба превью убрана: её запуск
 *      ТВ превращал значок Lampa в серую заглушку) ---- */
function runGuard() {
    const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
    const code = html.match(/<script>\s*([\s\S]*?launchAppControl[\s\S]*?)<\/script>/)[1];
    const calls = [];
    const ctx = { window: {}, tizen: { application: { launchAppControl: (c, id) => calls.push(id) } } };
    ctx.window.tizen = ctx.tizen;
    vm.createContext(ctx); vm.runInContext(code, ctx);
    return { app: ctx.tizen.application, calls };
}
const PICK = d => ({ operation: 'http://tizen.org/appcontrol/operation/pick', data: d });
let hg = runGuard();
hg.app.launchAppControl(PICK([{ value: ['ForegroundApp', '{"sections":[]}'] }]), 'x.service');
t('Smart Hub: ряд Lampa не уходит в службу превью', hg.calls.length === 0);
hg.app.launchAppControl({ operation: 'http://tizen.org/appcontrol/operation/view', data: [] }, 'other.app');
t('Smart Hub: остальные запуски приложений проходят', hg.calls.length === 1 && hg.calls[0] === 'other.app');
// служба в пакете одна — наша LampaService (секреты бота, 2.1); служба превью Smart Hub (*.service, use.preview) — нет
t('Smart Hub: в config.xml нет службы превью — только LampaService', (c => !/metadata\/use\.preview/.test(c) && (c.match(/<tizen:service\s/g) || []).length === 1 &&
    /<tizen:service id="0SG81L944p\.LampaService"/.test(c))(fs.readFileSync(path.join(SRC, 'config.xml'), 'utf8')));


/* ---- update.js: новая версия годится, только когда все её файлы уже на CDN ---- */
function updCheck(manifest, head, store) {
    const ls = Object.assign({}, store || {}), got = [];
    function X() {
        this.open = (m, u) => { this.m = m; this.u = u; };
        this.send = () => {
            if (/version\.json/.test(this.u)) { this.status = manifest ? 200 : 500; this.responseText = manifest ? JSON.stringify(manifest) : 'oops'; }
            else this.status = head(this.u);
            this.onload();
        };
    }
    const w = { localStorage: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: k => { delete ls[k]; } }, location: { reload() {} } };
    const ctx = { window: w, XMLHttpRequest: X, document: { write() {}, createElement: () => ({ style: {} }), body: { appendChild() {} } },
        setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, JSON, Date, Math, String, Number, console: { log() {} } };
    w.window = w; vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(SRC, 'update.js'), 'utf8'), ctx);
    w.BSUpdate.check((v, m) => { got.push(v, m); });
    return { v: got[0], m: got[1], ls, U: w.BSUpdate };
}
const M46 = { version: '1.7.46', files: ['loader.js', 'bstg.js'], notes: { title: 'Новое', items: ['Пункт 1'] } };
let uc = updCheck(M46, () => 200);
t('обновление: все файлы на CDN — версия готова и запомнена', uc.v === '1.7.46' && JSON.parse(uc.ls.bs_upd).ok === 1 && JSON.parse(uc.ls.bs_upd).m === 0);
uc = updCheck(M46, () => 503);
t('обновление: CDN ещё отвечает 503 — версию не запоминаем (не будет кругов перезагрузок)', uc.v === '' && !uc.ls.bs_upd);
uc = updCheck(M46, u => (/fastly/.test(u) ? 200 : 503));
t('обновление: основной CDN не готов, fastly готов — запоминаем зеркало', uc.v === '1.7.46' && JSON.parse(uc.ls.bs_upd).m === 1);
uc = updCheck(M46, u => (/bstg\.js/.test(u) ? 503 : 200));
t('обновление: хоть один файл не отдаётся — версия не готова', uc.v === '');
uc = updCheck(M46, () => 200, { bs_upd: JSON.stringify({ v: '1.7.46', files: ['loader.js'], ok: 1 }) });
t('обновление: та же версия уже работает — нового нет', uc.v === '');
uc = updCheck(M46, () => 200, { bs_upd_bad: '1.7.46|' + Date.now() });
t('обновление: версия, на которой Lampa не поднялась, — не берём', uc.v === '' && !uc.ls.bs_upd);
uc = updCheck(null, () => 200);
t('обновление: GitHub не ответил — без версии', uc.v === '');
uc = updCheck(M46, () => 200, { bs_upd: JSON.stringify({ v: '1.7.45', files: ['loader.js'], m: 1, ok: 1 }) });
t('обновление: при запуске берём зеркало, где проверка нашла файлы', /fastly\.jsdelivr\.net/.test(uc.U._base));

/* ---- loader.js: «Проверить и обновить» — «что нового» в окно, согласие даёт «плохой» версии ещё шанс ---- */
function ghCheck(v, m, store) {
    const src = fs.readFileSync(path.join(SRC, 'loader.js'), 'utf8');
    const fn = src.slice(src.indexOf('function bsGhCheck('), src.indexOf('function bsEsc('));
    const ls = Object.assign({}, store || {}), got = [];
    const ctx = { window: { localStorage: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, x) => { ls[k] = String(x); }, removeItem: k => { delete ls[k]; } },
        BSUpdate: { check: cb => cb(v, m) } }, setTimeout: () => 0, Date, JSON, String, Object };
    ctx.BSUpdate = ctx.window.BSUpdate;
    vm.createContext(ctx); vm.runInContext(fn + ';bsGhCheck((v, info) => { got.push(v); got.push(info); });', Object.assign(ctx, { got }));
    return { v: got[0], info: got[1], ls };
}
let ghc = ghCheck('1.7.46', M46);
t('проверить и обновить: «что нового» пришло в окно', ghc.v === '1.7.46' && ghc.info.notes.title === 'Новое' && ghc.info.notes.items.length === 1);
ghc = ghCheck('', null);
t('проверить и обновить: нового нет — без окна', ghc.v === '' && !ghc.info);
ghc = ghCheck('1.7.46', M46, { bs_upd_bad: '1.7.46|1', bs_upd_skip: '999' });
ghc.info.apply();
t('проверить и обновить: согласились — «плохой» версии даём ещё шанс', !ghc.ls.bs_upd_bad && !ghc.ls.bs_upd_skip);

/* ---- loader.js: «Проверить и обновить» — честный ответ, когда обновлять нечего ---- */
{
    const src = fs.readFileSync(path.join(SRC, 'loader.js'), 'utf8');
    const fn = src.slice(src.indexOf('function bsNoUpdateText('), src.indexOf('function bsCheckNow(')) + src.slice(src.indexOf('function bsVerNum('), src.indexOf('/** Новая версия функций уже проверена'));
    const ctx = {}; vm.createContext(ctx); vm.runInContext(fn + ';this.f = bsNoUpdateText;', ctx);
    t('проверка: последняя версия — так и говорим, с номерами', ctx.f('2.2.4', true, '2.2.4', '3.3.7') === 'Обновлений нет — у вас последняя версия: Sunic Apps 2.2.4 · Lampa 3.3.7');
    t('проверка: GitHub не ответил — не «обновлений нет»', /GitHub не ответил/.test(ctx.f('', true, '2.2.4', '3.3.7')));
    t('проверка: ничего не ответило — про интернет', /не ответил — проверьте интернет/.test(ctx.f('', false, '2.2.4', '3.3.7')));
    t('проверка: вышла новее, файлы ещё не готовы — встанет сама', /Вышла Sunic Apps 2.2.5.*встанет само/.test(ctx.f('2.2.5', true, '2.2.4', '3.3.7')));
    t('проверка: обновление с GitHub выключено — подсказываем, где включить', /включите «Обновлять с GitHub»/.test(ctx.f('2.2.5', true, '2.2.4', '3.3.7', true)));
}

/* ---- loader.js: обновления не ставятся на глазах — одним перезапуском, когда Lampa ушла в фон ---- */
function applyEnv(opt) {
    const src = fs.readFileSync(path.join(SRC, 'loader.js'), 'utf8');
    const fn = src.slice(src.indexOf('function bsApplyUpdate('), src.indexOf('function bsUpdateCheck('));
    const ls = Object.assign({}, opt.store || {}), notes = [], env = { reloads: 0 };
    const ctx = { window: { localStorage: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, x) => { ls[k] = String(x); }, removeItem: k => { delete ls[k]; } } },
        document: { hidden: !!opt.hidden }, location: { reload: () => { env.reloads++; } }, Date, JSON, String, parseInt,
        bsNoty: t => notes.push(t), bsPlayerOpen: () => !!opt.player, bsUpdatePending: null,
        setTimeout: f => f(), $: () => ({ length: opt.modal ? 1 : 0, hasClass: () => false }), Lampa: { Controller: { enabled: () => ({ name: 'content' }) } },
        bsUpdateDialog: (v, info, lv, yes) => { env.dialogs = (env.dialogs || []).concat(v); env.yes = yes; } };
    vm.createContext(ctx); vm.runInContext(fn + ';this.apply = bsApplyUpdate; this.hide = bsReloadForUpdate; this.fn = bsFnPending; this.offer = bsOfferUpdate; this.later = bsOfferLater;', ctx);
    return { ctx, env, notes, ls };
}
let ae = applyEnv({});
ae.ctx.apply({ hash: 'h2', app_version: '3.3.7' }); ae.ctx.apply({ hash: 'h3', app_version: '3.3.8' });
t('обновления: Lampa на экране — не перезапускаем, говорим один раз', ae.env.reloads === 0 && ae.notes.length === 1);
ae.ctx.document.hidden = true; ae.ctx.hide();
t('обновления: ушли из Lampa — одна перезагрузка на всё готовое', ae.env.reloads === 1);
ae.ctx.hide();
t('обновления: не чаще раза в 10 минут — без кругов', ae.env.reloads === 1);
ae = applyEnv({ hidden: true, player: true }); ae.ctx.apply({ hash: 'h2' });
t('обновления: видео открыто — не перезапускаем даже в фоне', ae.env.reloads === 0);
ae = applyEnv({ hidden: true, store: { bs_upd: JSON.stringify({ v: '9.9.9', files: ['loader.js'], ok: 1 }) } });
t('обновления: версия функций без окна «что нового» молча не ставится', ae.ctx.hide() === false && ae.env.reloads === 0);
ae = applyEnv({ hidden: true, store: { bs_upd: JSON.stringify({ v: '9.9.9', files: ['loader.js'], ok: 1 }), bs_upd_asked: '9.9.9' } });
t('обновления: окно показали («Позже») — ставится при уходе в фон', ae.ctx.hide() === true && ae.env.reloads === 1);
ae = applyEnv({});
ae.ctx.offer('2.2.3', { notes: { title: 'x', items: [] }, apply() { ae.env.applied = 1; } });
t('обновления: нашли новую — окно «что нового» с кнопкой, один раз', ae.env.dialogs.join() === '2.2.3' && ae.ls.bs_upd_asked === '2.2.3');
ae.ctx.offer('2.2.3', null);
t('обновления: второй раз то же окно не показываем', ae.env.dialogs.length === 1);
ae.env.yes();
t('обновления: «Обновить сейчас» — перезапуск с новой версией', ae.env.applied === 1 && ae.env.reloads === 1);
ae = applyEnv({ player: true });
ae.ctx.offer('2.2.3', null);
t('обновления: во время видео окно не показываем', !ae.env.dialogs && !ae.ls.bs_upd_asked);
ae.ctx.bsPlayerOpen = () => false; ae.ctx.later();
t('обновления: …а после выхода из плеера — показываем', (ae.env.dialogs || []).join() === '2.2.3');
ae = applyEnv({ modal: true }); ae.ctx.offer('2.2.3', null);
t('обновления: поверх другого окна не показываем', !ae.env.dialogs);
ae = applyEnv({ hidden: true, store: { bs_upd: JSON.stringify({ v: '9.9.9', files: ['loader.js'] }) } });
t('обновления: непроверенная версия функций (без ok) — не перезапускаем', ae.ctx.hide() === false && ae.env.reloads === 0);


/* ---- bstg.js: шифрование и подпись сообщений через ntfy ---- */
{
    const store = { bs_tg_token: '123456789:' + 'AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw' };
    const ls = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
    const ctx = { console: { log() {} }, Date, Math, JSON, String, Object, Array, parseInt, setTimeout, setInterval, Uint8Array,
        btoa: s => Buffer.from(s, 'binary').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('binary'),
        unescape, escape, encodeURIComponent, decodeURIComponent };
    ctx.window = ctx; ctx.localStorage = ls; ctx.crypto = require('crypto').webcrypto;
    vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(SRC, 'bstg.js'), 'utf8') + ';this.M=BSTelegram;', ctx);
    const T = ctx.M, C = T._crypt;
    t('шифр: SHA-256 и HMAC — эталонные значения', C.hex(C.sha256(C.bytes('abc'))) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' &&
        C.hex(C.hmac(C.bytes('Jefe'), C.bytes('what do ya want for nothing?'))) === '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
    const k = T._busKey(), msg = { t: 'open', from: 'tv2', name: 'Зал', ts: Date.now() };
    const sealed = JSON.stringify(C.seal(k, JSON.stringify(msg)));
    t('канал ТВ: своё зашифрованное сообщение читается', T._busOpen(sealed).name === 'Зал');
    t('канал ТВ: повтор того же сообщения — отброшен', T._busOpen(sealed) === null);
    t('канал ТВ: чужой ключ (без токена) — отброшено', T._busOpen(JSON.stringify(C.seal(C.key('other'), JSON.stringify(msg)))) === null);
    const tampered = C.seal(k, JSON.stringify(msg)); tampered.c = tampered.c.slice(0, -4) + (tampered.c.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
    t('канал ТВ: изменённое сообщение — отброшено', T._busOpen(JSON.stringify(tampered)) === null);
    t('канал ТВ: сообщение суточной давности — отброшено', T._busOpen(JSON.stringify(C.seal(k, JSON.stringify({ t: 'open', ts: Date.now() - 2 * 86400000 })))) === null);
    t('канал ТВ: незашифрованные hello/bye — отброшены (поддельная версия не остановит опрос)', T._busOpen(JSON.stringify({ t: 'hello', from: 'old', name: 'Спальня', v: '99.0.0', leader: true })) === null &&
        T._busOpen(JSON.stringify({ t: 'bye', from: 'old' })) === null);
    t('канал ТВ: незашифрованные команды (люди, открыть, переименовать) — отброшены', ['u', 'open', 'rename'].every(x => T._busOpen(JSON.stringify({ t: x, from: 'evil' })) === null));
    const sec = C.secret(), tk = store.bs_tg_token;
    const pairLine = m => JSON.stringify({ event: 'message', id: 'p1', message: m });
    t('QR с телефона: токен, зашифрованный секретом из QR, — принят', T._tokenFrom(pairLine(JSON.stringify(C.seal(C.key('lampa-pair-v2|' + sec), tk))), sec)[0] === tk);
    t('QR с телефона: открытый токен при секрете — не принят', T._tokenFrom(pairLine(tk), sec)[0] === '');
    const jl = JSON.stringify({ event: 'message', id: 'j1', message: JSON.stringify(C.seal(T._joinKeys('ABCD2345EFGH').key, JSON.stringify({ t: 'join', token: tk, chat: '42' }))) });
    t('второй ТВ по коду: зашифровано кодом — принято, другим кодом — нет', (T._joinMsg(jl, { code: 'ABCD2345EFGH' }) || {}).chat === '42' && T._joinMsg(jl, { code: 'ABCD2345EFGJ' }) === null);
    const jlOld = JSON.stringify({ event: 'message', id: 'j2', message: JSON.stringify(C.seal(C.key('lampa-join-v2|ABCD2345EFGH'), JSON.stringify({ t: 'join', token: tk, chat: '42' }))) });
    t('второй ТВ по коду: ключ — через PBKDF2, а не прежний SHA-256 от кода', T._joinMsg(jlOld, { code: 'ABCD2345EFGH' }) === null);
    // PBKDF2-HMAC-SHA256 страницы — байт в байт как у Node (служба считает тем же)
    t('шифр: PBKDF2-HMAC-SHA256 — как crypto.pbkdf2Sync', C.hex(C.pbkdf('ABCD2345EFGH', 'lampa-join-v3', 2000)) === require('crypto').pbkdf2Sync('ABCD2345EFGH', 'lampa-join-v3', 2000, 32, 'sha256').toString('hex') &&
        C.hex(C.pbkdf('password', 'salt', 1)) === '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b');
}


/* ---- bstg.js: приглашение, одобрение владельцем, видео от гостей ---- */
{
    const store = { bs_tg_chat: '1', bs_tg_token: '123456789:' + 'AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw' };
    const urls = [];
    function X() { this.open = (m, u) => { this.u = u; }; this.send = b => urls.push(dec(tgReq(this.u, b))); this.setRequestHeader = () => {}; }
    const ctx = { console: { log() {} }, Date, Math, JSON, String, Object, Array, parseInt, setTimeout: () => 0, setInterval: () => 0, XMLHttpRequest: X, Uint8Array,
        btoa: s => Buffer.from(s, 'binary').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('binary'), unescape, escape, encodeURIComponent, decodeURIComponent,
        Lampa: { Noty: { show() {} } } };
    ctx.window = ctx; ctx.crypto = require('crypto').webcrypto;
    ctx.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
    vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(SRC, 'bstg.js'), 'utf8') + ';this.M=BSTelegram;', ctx);
    const T = ctx.M, users = () => JSON.parse(store.bs_tg_users || '{}');
    const start = (c, code) => T._handle({ update_id: 1, message: { chat: { id: +c, type: 'private' }, from: { first_name: 'Аня' }, text: '/start ' + code } });
    const cb = (data, from) => T._handle({ callback_query: { id: 'q', data, from: { id: +from }, message: { message_id: 5, chat: { id: +from } } } });
    const old = T._inviteCode();
    t('приглашение: без смены — прежний код (старые QR работают)', /^[0-9a-z]+$/.test(old) && old.length > 6);
    start('2', old);
    t('новый человек по QR — ждёт разрешения, ещё не подключён', users()['2'].pending === true && !T._active(users()['2']) && urls.some(u => /ok:2/.test(u) && /chat_id=1/.test(u)));
    urls.length = 0; start('2', old);
    t('повторный /start в течение часа — владельцу второй раз не пишем', !urls.some(u => /chat_id=1/.test(u)));
    cb('ok:2', 1);
    t('владелец разрешил — подключён со своими списками', T._active(users()['2']) && Array.isArray(users()['2'].want));
    start('3', old); cb('ku:3', 1);
    t('владелец отклонил — отключён, не ждёт', users()['3'].banned === true && !users()['3'].pending);
    T._inviteReset();
    t('сменить приглашение: новый код, старый не подключает', T._inviteCode() !== old && (start('4', old), !users()['4']));
    store.bs_tg_approve = 'false';
    start('5', T._inviteCode());
    t('без одобрения — подключается сразу', T._active(users()['5']));
    store.bs_tg_guest_play = 'false'; urls.length = 0;
    cb('D:tv1:m:550', 2);
    t('видео гостям запрещено — «Смотреть на ТВ» от гостя не включает', urls.some(u => /answerCallbackQuery/.test(u) && /запретил гостям/.test(u)) && !urls.some(u => /"t":"open"/.test(u)));
}

/* ---- настройки: каждый пункт модулей — в своём разделе (раскладка), а не в «Обновление» ---- */
{
    const L = fs.readFileSync(path.join(SRC, 'loader.js'), 'utf8');
    const lay = L.slice(L.indexOf('var BS_SETTINGS_LAYOUT'), L.indexOf('var BS_SETTINGS_NEEDS'));
    const lost = [];
    fs.readdirSync(SRC).filter(f => /^(bs.*|skazauto|playerguard)\.js$/.test(f)).forEach(f => {
        const s = fs.readFileSync(path.join(SRC, f), 'utf8'), re = /param:\s*\{\s*name:\s*'([a-z_0-9]+)'/g;
        let m;
        while ((m = re.exec(s))) if (lay.indexOf("'" + m[1] + "'") < 0) lost.push(f + ':' + m[1]);
    });
    t('настройки: все пункты модулей разложены по разделам' + (lost.length ? ' (вне раскладки: ' + lost.join(', ') + ')' : ''), lost.length === 0);
}

/* ---- bstg.js: «⌨️ Набрать на ТВ» — текст с телефона в поиск Lampa ---- */
{
    let opened = null, closed = 0, playing = false;
    const ctx = { console: { log() {} }, Date, Math, JSON, String, Object, Array, parseInt, setTimeout: () => 0, setInterval: () => 0,
        document: { body: { className: '' } },
        Lampa: { Search: { open: p => { opened = p; }, close: () => { closed++; } }, Player: { opened: () => playing }, Noty: { show() {} } } };
    ctx.window = ctx; ctx.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(SRC, 'bstg.js'), 'utf8') + ';this.M=BSTelegram;', ctx);
    const T = ctx.M;
    t('набрать на ТВ: разметка и управляющие символы вычищены', T._typedText('  <b>Дюна</b> "2"'+String.fromCharCode(10)) === 'b Дюна /b 2');
    t('набрать на ТВ: длинный текст обрезан до 100 символов', T._typedText('я'.repeat(300)).length === 100);
    t('набрать на ТВ: поиск открывается с текстом', T._typeHere('Дюна') === '' && opened && opened.input === 'Дюна' && closed === 0);
    ctx.document.body.className = 'search--open';
    T._typeHere('Матрица');
    t('набрать на ТВ: открытый поиск сначала закрывается', closed === 1 && opened.input === 'Матрица');
    playing = true; opened = null;
    t('набрать на ТВ: во время видео не прерывает', /видео/.test(T._typeHere('x')) && opened === null);
}

/* ---- bsfeatures.js: клавиатура поиска по кругу ---- */
{
    let pos = 0, focused = null, origCalls = [];
    const N = 5, cur = { length: 1 };
    const row = { length: N, index: () => pos, eq: i => [{ key: i }] };
    cur.closest = () => ({ find: () => row });
    const $ = sel => (/hg-button\.focus/.test(sel) ? (pos < 0 ? { length: 0 } : cur) : { length: 1 });
    const added = {};
    const ctx = { console: { log() {} }, Date, Math, JSON, String, Object, Array, setTimeout: () => 0, setInterval: () => 0, $,
        document: { addEventListener() {} }, XMLHttpRequest: function () {}, Node: function () {},
        Lampa: { Controller: { add: (n, o) => { added[n] = o; }, collectionFocus: el => { focused = el; } } } };
    ctx.window = ctx; ctx.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    ctx.XMLHttpRequest.prototype = { open() {} }; ctx.Node.prototype = { appendChild() {} };
    vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(SRC, 'bsfeatures.js'), 'utf8') + ';this.M=BSFeatures;', ctx);
    ctx.M._kbWrap();
    ctx.Lampa.Controller.add('keybord', { left: () => origCalls.push('L'), right: () => origCalls.push('R') });
    pos = N - 1; added.keybord.right();
    t('клавиатура: на последней клавише «вправо» — на первую в ряду', focused && focused.key === 0 && origCalls.length === 0);
    pos = 0; focused = null; added.keybord.left();
    t('клавиатура: на первой клавише «влево» — на последнюю в ряду', focused && focused.key === N - 1 && origCalls.length === 0);
    pos = 2; focused = null; added.keybord.right();
    t('клавиатура: в середине ряда — обычный ход Lampa', focused === null && origCalls.join() === 'R');
    pos = -1; added.keybord.left();
    t('клавиатура: не в поиске — поведение Lampa не меняется', origCalls.join() === 'R,L');
}

/* ---- bstg.js: открыть во время видео - в очередь, после закрытия плеера ---- */
{
    let playing = true;
    const ctx = { console: { log() {} }, Date, Math, JSON, String, Object, Array, parseInt, setInterval: () => 0,
        setTimeout: f => { f(); return 0; },
        Lampa: { Player: { opened: () => playing }, Noty: { show() {} } } };
    ctx.window = ctx; ctx.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(SRC, 'bstg.js'), 'utf8') + ';this.M=BSTelegram;', ctx);
    const T = ctx.M;
    let ran = 0;
    t('видео: во время просмотра tvPlaying — да', T._tvPlaying() === true);
    T._whenVideoEnds(() => { ran++; });
    t('видео: пока идёт, действие не выполняется', ran === 0);
    playing = false;
    T._onVideoClosed();
    t('видео: после закрытия плеера действие выполняется один раз', ran === 1 && T._tvPlaying() === false);
    T._onVideoClosed();
    t('видео: повторное закрытие ничего не запускает', ran === 1);
}

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

/* ---- bscontinue.js: таймлайн Lampa (Lampa.Timeline) — главный источник, наша память — запасная ---- */
{
    const mk = (opt) => {
        opt = opt || {};
        const store = Object.assign({}, opt.store || {}), updates = [], views = [];
        const ls = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
        const T = opt.noTimeline ? undefined : {
            view: (hash, meta) => { views.push([hash, meta]); const r = (opt.tl || {})[hash] || { percent: 0, time: 0, duration: 0, updated: 0 };
                return Object.assign({ hash, handler: () => {} }, r, meta || {}); },
            update: p => updates.push(p)
        };
        if (T && !opt.noLink) T.link = (card, s, e) => card.original_name ? { card: 'tv_' + card.id, season: s, episode: e } : { card: 'movie_' + card.id };
        const ctx = { $: () => ({}), document: { addEventListener() {} }, console: { log() {} }, setTimeout: () => 0, setInterval: () => 0, clearInterval() {}, Date, Math, JSON, String, Object, Array, parseInt, isNaN, isFinite,
            localStorage: ls, BSFix: { current: () => ({}) },
            Lampa: { Noty: { show() {} }, Utils: { hash: x => 'h:' + x }, Timeline: T, Activity: { active: () => ({}) },
                Storage: { get: (k, d) => d, field: () => undefined, cache: () => opt.watched || {} } } };
        ctx.window = ctx; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(SRC, 'bscontinue.js'), 'utf8') + ';this.M=BSContinue;', ctx);
        return { M: ctx.M, store, updates, views };
    };
    const show = { id: 7, name: 'Шоу', original_name: 'Show', number_of_seasons: 2 };
    const film = { id: 9, title: 'Фильм', original_title: 'Film' };
    let e = mk();
    t('таймлайн: хеш серии как у Lampa (сезон, серия, original_name)', e.M._lampaKey(show, 2, 5).hash === 'h:25Show' && e.M._lampaKey(show, 12, 3).hash === 'h:12:3Show');
    t('таймлайн: хеш фильма — original_title, привязка из Timeline.link', (k => k.hash === 'h:Film' && k.meta.card === 'movie_9')(e.M._lampaKey(film, 0, 0)));
    t('таймлайн: нет Timeline (старая Lampa) — ключа нет', mk({ noTimeline: true }).M._lampaKey(film, 0, 0) === null);
    t('таймлайн: нет Timeline.link — хеш без привязки', (k => k.hash === 'h:Film' && k.meta === null)(mk({ noLink: true }).M._lampaKey(film, 0, 0)));
    const v = mk({ tl: { 'h:Film': { percent: 40, time: 2880, duration: 7200, updated: 5 } } }).M._lampaView(film, 0, 0);
    t('таймлайн: из Timeline.view берём только числа — без handler', v.time === 2880 && v.percent === 40 && v.updated === 5 && !('handler' in v) && Object.keys(v).every(k => typeof v[k] === 'number'));
    const P = e.M._pickLater;
    t('кто свежее: у Lampa штамп новее — Lampa', P({ pos: 900, dur: 2400, at: 1000 }, { time: 300, percent: 12, updated: 2000 }) === 'lampa');
    t('кто свежее: наша запись новее — наша', P({ pos: 300, dur: 2400, at: 3000 }, { time: 900, percent: 37, updated: 2000 }) === 'ours');
    t('кто свежее: у Lampa нет штампа (старая сборка) — где дальше', P({ pos: 900, dur: 2400, at: 3000 }, { time: 300, percent: 12, updated: 0 }) === 'ours' && P({ pos: 100, dur: 2400, at: 3000 }, { time: 300, updated: 0 }) === 'lampa');
    t('кто свежее: у Lampa только процент — считаем по длительности', P({ pos: 900, dur: 2400, at: 1 }, { time: 0, percent: 50, updated: 0 }) === 'lampa');
    t('кто свежее: пусто с обеих сторон', P(null, { time: 0, percent: 0 }) === '' && P({ pos: 10, dur: 100, at: 1 }, null) === 'ours');
    const M2 = e.M._mergeTimeline;
    let tl = { time: 300, percent: 12, duration: 2400, updated: 1000, handler() {} };
    t('место: наша запись свежее и дальше — подсказываем Lampa (time/percent), handler цел', M2(tl, { pos: 1200, dur: 2400, at: 5000 }) && tl.time === 1200 && tl.percent === 50 && typeof tl.handler === 'function');
    tl = { time: 300, percent: 12, duration: 2400, updated: 9000 };
    t('место: у Lampa свежее (например, CUB с телефона) — не трогаем', !M2(tl, { pos: 1200, dur: 2400, at: 5000 }) && tl.time === 300);
    tl = { time: 1190, percent: 49, duration: 2400, updated: 1 };
    t('место: разница меньше 30 с — не трогаем', !M2(tl, { pos: 1200, dur: 2400, at: 5000 }) && tl.time === 1190);
    tl = { time: 0, percent: 0, duration: 0 };
    t('место: почти досмотрено и досмотренное — не подсказываем', !M2(tl, { pos: 2300, dur: 2400, at: 5 }) && !M2(tl, { pos: 1000, dur: 2400, at: 5, done: true }));
    t('место: у Lampa пусто — наше, длительность тоже', M2(tl, { pos: 600, dur: 2400, at: 5 }) && tl.time === 600 && tl.duration === 2400 && tl.percent === 25);
    // плеер с timeline от плагина: на 'start' место поправлено, сами в Lampa не пишем (она пишет сама)
    e = mk({ store: { bs_resume: JSON.stringify([{ card: show, s: 1, e: 3, pos: 1500, dur: 2400, at: Date.now(), done: false }]) } });
    const data = { card: show, season: 1, episode: 3, timeline: { time: 200, percent: 8, duration: 2400, updated: 1, handler() {} } };
    e.M._onStart(data);
    e.M._onTime({ current: 1600, duration: 2400 }); e.M._onStop();
    t('старт: timeline плеера поправлен нашей свежей записью', data.timeline.time === 1500 && data.timeline.percent === 63);
    t('старт: timeline есть — в Lampa сами не пишем', e.updates.length === 0);
    // плеер без timeline: место в Lampa пишем сами — простым объектом, без функций
    e = mk();
    e.M._onStart({ card: film, season: 0, episode: 0 });
    e.M._onTime({ current: 3000, duration: 7200 }); e.M._onStop();
    const u = e.updates[e.updates.length - 1];
    t('без timeline: место ушло в Lampa через Timeline.update', e.updates.length >= 1 && u.hash === 'h:Film' && u.time === 3000 && u.duration === 7200 && u.percent === 42 && u.card === 'movie_9');
    t('без timeline: в Timeline.update — только простые поля (никаких функций для $.param)', Object.keys(u).every(k => typeof u[k] !== 'function' && typeof u[k] !== 'object'));
    e = mk({ noTimeline: true });
    e.M._onStart({ card: film }); e.M._onTime({ current: 3000, duration: 7200 }); e.M._onStop();
    t('без Timeline (старая Lampa) — только наша память', e.updates.length === 0 && e.M._load().length === 1 && e.M._load()[0].pos === 3000);
    // какая серия: у нас S1E3 не досмотрена, в Lampa — досмотрена и свежее → следующая
    const rec = { card: show, s: 1, e: 3, pos: 600, dur: 2400, at: 1000, done: false };
    const w = { 'h:Show': { season: 1, episode: 3 } };
    e = mk({ watched: w, tl: { 'h:13Show': { percent: 97, time: 2330, duration: 2400, updated: 2000 } } });
    t('серия: в Lampa досмотрена позже нашей записи — включаем следующую', e.M._targetEpisode(show, rec).episode === 4);
    e = mk({ watched: w, tl: { 'h:13Show': { percent: 97, time: 2330, duration: 2400, updated: 500 } } });
    t('серия: наша запись свежее — та же серия', e.M._targetEpisode(show, rec).episode === 3);
    e = mk({ watched: w, noTimeline: true });
    t('серия: без Timeline — как раньше', e.M._targetEpisode(show, rec).episode === 3 && e.M._targetEpisode(show, Object.assign({}, rec, { done: true })).episode === 4);
}

/* ---- loader.js: ПИН родительского контроля Lampa перед «Telegram-бот» и «Онлайн-источники» ---- */
{
    const L = fs.readFileSync(path.join(SRC, 'loader.js'), 'utf8');
    const fn = L.slice(L.indexOf('var BS_SECTIONS_PIN'), L.indexOf('/** «Sunic Apps» в главном списке'));
    const env = (pc, store) => {
        const ls = Object.assign({}, store || {}), opened = [], asked = [], added = {};
        const P = pc === 'none' ? undefined : {
            add: (n, d) => { added[n] = d; },
            personal: (n, ok, err, save) => { asked.push([n, save]); if (pc === 'ok') ok(); else if (pc === 'throw') throw new Error('x'); }
        };
        const ctx = { console: { log() {} }, window: { localStorage: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); } } } };
        ctx.window.Lampa = ctx.Lampa = { ParentalControl: P, Settings: { create: n => opened.push(n) } };
        vm.createContext(ctx); vm.runInContext(fn + ';this.reg = bsPinRegister; this.open = bsOpenSection;', ctx);
        return { ctx, ls, opened, asked, added };
    };
    let e = env('ok');
    t('ПИН: разделы добавлены в список Lampa «Где спрашивать ПИН», в первый раз — отмечены', e.ctx.reg() === true &&
        e.added.bs_pin_bs_telegram.title === 'Telegram-бот (Sunic Apps)' && e.added.bs_pin_bs_telegram['default'] === true && e.added.bs_pin_bs_online['default'] === true);
    e = env('ok', { bs_pin_init_bs_telegram: '1', bs_pin_init_bs_online: '1' }); e.ctx.reg();
    t('ПИН: при следующих запусках не отмечаем снова — человек мог снять галочку', e.added.bs_pin_bs_telegram['default'] === false);
    e = env('ok'); e.ctx.open('bs_telegram');
    t('ПИН: «Telegram-бот» — через ParentalControl.personal (с возвратом пульта), ПИН верный — раздел открыт', e.asked[0][0] === 'bs_pin_bs_telegram' && e.asked[0][1] === true && e.opened.join() === 'bs_telegram');
    e = env('no'); e.ctx.open('bs_online');
    t('ПИН: неверный или «Назад» — раздел не открыт', e.asked.length === 1 && e.opened.length === 0);
    e = env('no'); e.ctx.open('bs_player');
    t('ПИН: прочие разделы — без ПИН', e.asked.length === 0 && e.opened.join() === 'bs_player');
    e = env('none'); e.ctx.open('bs_telegram');
    t('ПИН: нет ParentalControl (старая Lampa) — открываем как раньше', e.ctx.reg() === false && e.opened.join() === 'bs_telegram');
    e = env('throw'); e.ctx.open('bs_telegram');
    t('ПИН: ошибка API — открываем как раньше', e.opened.join() === 'bs_telegram');
}
/* ---- bswatch.js: перенос детского режима — включён ли контроль, спрашиваем у ParentalControl.enabled() ---- */
{
    const store = { bs_kids: 'true', bs_kids_pin: '4321' }, lampa = {};
    const ls = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
    const ctx = { window: { localStorage: ls }, localStorage: ls, $: () => ({}), document: { addEventListener() {} }, console: { log() {} },
        setTimeout: f => f(), clearTimeout() {}, setInterval() {}, clearInterval() {}, Date, Math, JSON, String, Object, Array, parseInt, parseFloat, isNaN,
        Lampa: { Noty: { show() {} }, ParentalControl: { enabled: () => true }, Storage: { field: k => lampa[k], set: (k, v) => { lampa[k] = v; } } } };
    ctx.window.Lampa = ctx.Lampa;
    vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(SRC, 'bswatch.js'), 'utf8') + ';this.M=BSWatch;', ctx);
    ctx.M._kidsMigrate();
    t('детский режим: ParentalControl.enabled() — контроль уже есть (детский профиль CUB) — ПИН не перезаписываем', !('parental_control_pin' in lampa));
}
/* ---- bstg.js: колокольчик Lampa на ТВ и окна подключения ---- */
{
    const mkT = (lampa, store) => {
        const st = Object.assign({}, store || {});
        const ctx = { console: { log() {} }, Date, Math, JSON, String, Object, Array, parseInt, setTimeout: () => 0, setInterval: () => 0, clearInterval() {}, clearTimeout() {},
            document: { body: { className: '' } }, Lampa: lampa };
        ctx.window = ctx; ctx.localStorage = { getItem: k => (k in st ? st[k] : null), setItem: (k, v) => { st[k] = String(v); }, removeItem: k => { delete st[k]; } };
        vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(SRC, 'bstg.js'), 'utf8') + ';this.M=BSTelegram;', ctx);
        return { T: ctx.M, st, ctx };
    };
    const notices = [], pops = [];
    let x = mkT({ Notice: { pushNotice: (cls, el, ok) => { notices.push([cls, el]); ok(); } }, Bell: { push: p => pops.push(p) } });
    const card = x.T._bellCard(77, 'Шоу <b>', '/p.jpg', true);
    t('колокольчик: новая серия — в список уведомлений Lampa, ОК откроет сериал', x.T._tvBell('ep:77:2:5', 'Шоу <b>', 'Вышла новая серия: сезон 2, серия 5', card) === true &&
        notices.length === 1 && notices[0][0] === 'lampa' && notices[0][1].id === 'bs_ep:77:2:5' && notices[0][1].from === 'Sunic Apps' &&
        notices[0][1].card.number_of_seasons === 1 && notices[0][1].card.source === 'tmdb' && notices[0][1].poster === '/p.jpg' && pops.length === 0);
    t('колокольчик: название экранировано (Lampa вставляет как HTML)', notices[0][1].title === 'Шоу &lt;b&gt;');
    t('колокольчик: то же событие второй раз — не дублируем', x.T._tvBell('ep:77:2:5', 'Шоу', 'x', card) === false && notices.length === 1);
    x.T._tvBell('today:77:2:6', 'Шоу', 'Сегодня выходит: сезон 2, серия 6', card);
    t('колокольчик: другое событие — отдельное уведомление', notices.length === 2 && JSON.parse(x.st.bs_bell_seen).length === 2);
    t('колокольчик: карточка фильма — без number_of_seasons', !('number_of_seasons' in x.T._bellCard(5, 'Фильм', '', false)) && x.T._bellCard(5, 'Фильм', '', false).title === 'Фильм');
    const pops2 = [];
    x = mkT({ Bell: { push: p => pops2.push(p) } });
    x.T._tvBell('q:5', 'Фильм', 'Вышел в хорошем качестве: WEB-DL', null);
    t('колокольчик: нет Notice — короткое всплывающее Bell.push', pops2.length === 1 && /Фильм — Вышел в хорошем качестве: WEB-DL/.test(pops2[0].text));
    x = mkT({});
    t('колокольчик: нет ни Notice, ни Bell (старая Lampa) — только бот, метку не ставим', x.T._tvBell('q:5', 'Фильм', 'x', null) === false && !x.st.bs_bell_seen);
    // окна подключения: закрываем своё окно один раз — таймер после «Готово!» не закрывает чужое и не уводит фокус
    let closes = 0, toggles = [];
    x = mkT({ Modal: { open() {}, close: () => { closes++; } }, Controller: { toggle: n => toggles.push(n) } });
    const h = x.T._modalOpen({ html: null });
    t('окно: закрыть — Modal.close и пульт назад', x.T._modalClose(h, 'settings_component') === true && closes === 1 && toggles.join() === 'settings_component');
    t('окно: второй раз (таймер после «Готово!») — ничего не трогаем', x.T._modalClose(h, 'settings_component') === false && closes === 1 && toggles.length === 1);
    const el = {};
    x.ctx.document.body.contains = n => n !== el;
    const h2 = x.T._modalOpen({ html: [el] });
    t('окно: Lampa уже убрала наше окно (новый экран) — чужое не закрываем', x.T._modalClose(h2, 'settings_component') === false && closes === 1);
    const el3 = {};
    x.ctx.document.body.contains = () => true;
    x.ctx.$ = () => ({ closest: () => ({ length: 1, hasClass: c => c === 'hide' }) });
    const h3 = x.T._modalOpen({ html: [el3] });
    t('окно: наше спрятано под другим окном (стек Lampa) — верхнее не закрываем', x.T._modalClose(h3, 'settings_component') === false && closes === 1);
    x.ctx.$ = () => ({ closest: () => ({ length: 1, hasClass: () => false }) });
    const h4 = x.T._modalOpen({ html: [{}] });
    t('окно: наше сверху — закрываем, «Другой способ» без возврата пульта', x.T._modalClose(h4, 'settings_component', true) === true && closes === 2 && toggles.length === 1);
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
    // время без пульта к старту серии: сумма прошлых серий (досмотренная наполовину — целиком)
    const idleBefore = (lens, n) => lens.slice(0, n - 1).reduce((s, m) => s + W._epSeconds(m * 60, m * 60 - 90), 0);   // титры пропущены
    const askAt = (m, lim) => { for (let n = 1; n <= 10; n++) if (W._wantStill(idleBefore(Array(10).fill(m), n), lim)) return n; return 0; };
    t('ещё смотрите: серии по 30 мин — вопрос на 3-й', askAt(30, 60) === 3);
    t('ещё смотрите: серии по 28 мин (титры короче) — тоже на 3-й', askAt(28, 60) === 3);
    t('ещё смотрите: серии от часа — сразу на 2-й', askAt(60, 60) === 2 && askAt(75, 60) === 2);
    t('ещё смотрите: серии по 45 мин — на 3-й, по 20 мин — на 4-й', askAt(45, 60) === 3 && askAt(20, 60) === 4);
    t('ещё смотрите: «через 2 часа» — серии по 30 мин на 5-й', askAt(30, 120) === 5);
    t('ещё смотрите: выключено', !W._wantStill(99999, 0));
    t('ещё смотрите: недосмотренная серия — только то, что шло', W._epSeconds(3600, 600) === 600 && W._epSeconds(3600, 1800) === 3600 && W._epSeconds(0, 0) === 0);
    // целиком, как в плеере: тики timeupdate раз в секунду, автопереход за 90 с до конца
    const sim = () => {
        const S = load('bswatch.js', 'BSWatch').M;
        return {
            S, play(min, from) { const d = min * 60; for (let c = from || 0; c <= d - 90; c++) S._stillTick({ duration: d, current: c }); },
            start() { return S._stillOnStart(Date.now()); }
        };
    };
    { const s = sim(); const asks = []; for (let n = 1; n <= 4; n++) { asks.push(s.start()); s.play(30); }
      t('ещё смотрите (плеер): серии по 30 мин — вопрос на 3-й, не раньше', asks.join() === 'false,false,true,true'); }
    { const s = sim(); s.start(); s.play(62); t('ещё смотрите (плеер): серия 62 мин — вопрос уже на 2-й', s.start() === true); }
    { const s = sim(); s.start(); s.play(30); s.start(); s.play(20); s.S.activity(); s.play(30, 1201);
      t('ещё смотрите (плеер): нажали пульт в середине серии — считаем только время после нажатия', s.start() === false && s.S._idle() < 1000); }
    { const s = sim(); s.start(); s.play(30); s.S._stillTick({ duration: 1800, current: 1700 }); s.S._stillTick({ duration: 1800, current: 100 });
      t('ещё смотрите (плеер): перемотка вперёд и назад — не просмотр', s.S._idle() === 0 && s.start() === false); }
    { const s = sim(); s.start(); s.play(62);
      t('ещё смотрите (плеер): перерыв больше 30 мин (запуск из бота на другой день) — счёт заново', s.S._stillOnStart(Date.now() + 31 * 60000) === false && s.S._idle() === 0); }
}
{
    // свой детский режим убран: включённый переносим в родительский контроль Lampa с тем же ПИН
    const kids = (store, lampa) => {
        const said = [];
        const ls = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
        const ctx = { window: { localStorage: ls }, localStorage: ls, $: () => ({}), document: { addEventListener() {} }, console: { log() {} },
            setTimeout: f => f(), clearTimeout() {}, setInterval() {}, clearInterval() {}, Date, Math, JSON, String, Object, Array, parseInt, parseFloat, isNaN,
            Lampa: { Noty: { show: x => said.push(x) }, Storage: { field: k => lampa[k], set: (k, v) => { lampa[k] = v; } } } };
        ctx.window.Lampa = ctx.Lampa;
        vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(SRC, 'bswatch.js'), 'utf8') + ';this.M=BSWatch;', ctx);
        const moved = ctx.M._kidsMigrate();
        return { moved, said: said.join('|') };
    };
    let st = { bs_kids: 'true', bs_kids_pin: '4321' }, lp = {};
    let r = kids(st, lp);
    t('детский режим: включённый — родительский контроль Lampa с тем же ПИН', r.moved && lp.parental_control === true && lp.parental_control_pin === '4321' && /родительский контроль/.test(r.said));
    t('детский режим: свои ключи убраны', !('bs_kids' in st) && !('bs_kids_pin' in st));
    st = { bs_kids: 'true', bs_kids_pin: '1111' }; lp = { parental_control: true, parental_control_pin: '9999' };
    kids(st, lp);
    t('детский режим: у Lampa контроль уже включён — её ПИН не трогаем', lp.parental_control_pin === '9999');
    st = { bs_kids: 'false' }; lp = {}; r = kids(st, lp);
    t('детский режим: был выключен — ничего не включаем и не пишем', !r.moved && !('parental_control' in lp) && r.said === '' && !('bs_kids' in st));
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
    // 3D-раздачи (SBS/OU) сами не выбираем, пока есть обычная версия
    t('3D: распознаём SBS, OU, «3D», стерео', B.is3D({ title: 'Холодное сердце 3D' }) && B.is3D({ text: 'Дубляж [H-SBS]' }) && B.is3D('1080p OU') && B.is3D({ title: 'Стерео' }));
    t('3D: обычные названия — не 3D', !B.is3D({ title: 'Холодное сердце' }) && !B.is3D({ title: 'You' }) && !B.is3D({ title: 'Дубляж 1080p' }) && !B.is3D({ title: 'Toubab' }));
    t('3D: качество только 3D-метками — 3D', B.is3D({ title: 'Дубляж', quality: { '1080p 3D': 'a' } }) && !B.is3D({ title: 'Дубляж', quality: { '1080p': 'a', '1080p 3D': 'b' } }));
    t('фильм: 3D первым в списке — включаем обычный', B._decide([{ method: 'play', title: 'Дубляж 3D', url: '3d' }, { method: 'play', title: 'Дубляж', url: '2d' }], [], { season: 0, episode: 0 }).item.url === '2d');
    t('фильм: есть только 3D — включаем его', B._decide([{ method: 'play', title: 'Дубляж SBS', url: '3d' }], [], { season: 0, episode: 0 }).item.url === '3d');
    t('фильм: папки озвучек — мимо 3D', B._decide([{ method: 'link', text: 'Дубляж 3D', url: 'a' }, { method: 'link', text: 'Дубляж', url: 'b' }], [], {}).go === 'b');
    t('prefer2D: список без 3D не меняется', B.prefer2D([{ title: 'a' }, { title: 'b' }]).length === 2 && B.prefer2D([]).length === 0);
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
    t('telegram: чат — из последнего сообщения боту', T._chatFrom([{ message: { chat: { id: 1, type: 'private' } } }, { message: { chat: { id: 42, type: 'private' } } }]) === '42' && T._chatFrom([]) === '');
    t('telegram: владелец — только личный чат, не группа и не канал', T._chatFrom([{ message: { chat: { id: 1, type: 'private' } } }, { message: { chat: { id: -5, type: 'group' } } }, { channel_post: { chat: { id: -7, type: 'channel' } } }]) === '1');
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
    const mr = T._menuRows(), flat = [].concat.apply([], mr).map(b => b.callback_data);
    t('меню бота: разделы кнопками «mn:», как у бота Skaz', ['mn:find', 'mn:pic', 'mn:type', 'mn:want', 'mn:subs', 'mn:week', 'mn:tvs', 'mn:help', 'mn:settings'].every(c => flat.indexOf(c) >= 0) && flat.indexOf('mn:profile') < 0 && mr.every(r => r.length <= 3));
    t('меню бота: без повторов, «Поддержать» — в «Помощи», а не отдельной плиткой', flat.length === new Set(flat).size && flat.indexOf('mn:support') < 0);
    t('меню бота: плитки парами — рядов не больше шести', mr.length <= 6);
    t('бот: AI-ассистент CUB — сериал узнаётся по name, без постера — мимо', (() => {
        const c = T._cubCards([{ id: 1, title: 'Интерстеллар', poster_path: '/a.jpg' }, { id: 2, name: 'Тьма', poster_path: '/b.jpg' }, { id: 3, title: 'Без постера' }]);
        return c.length === 2 && c[0].media_type === 'movie' && c[1].media_type === 'tv';
    })());
    t('меню бота: команды у кнопки «Меню» слева от поля ввода', T._commands.map(c => c.command).join(',') === 'menu,find,type,want,subs,week,tvs,profile,help,settings,lang');
    t('меню бота: «⌨️ Набрать на ТВ»', flat.indexOf('mn:type') >= 0);
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
    const upd = (id, text) => ({ update_id: id, message: { chat: { id: id, type: 'private' }, text } });
    t('владелец при подключении — не гость, писавший последним', T._chatFrom2([upd(111, 'a'), upd(222, 'b')], { '222': {} }) === '111' && T._chatFrom2([upd(111, 'a'), upd(222, 'b')]) === '222');
    t('новый ТВ: код из сообщения — с дефисами, пробелами, слитно, строчными', T._joinFrom('ABCD-2345-EFGH') === 'ABCD2345EFGH' && T._joinFrom('abcd 2345 efgh') === 'ABCD2345EFGH' &&
        T._joinFrom(' ABCD2345EFGH ') === 'ABCD2345EFGH' && T._joinFrom('aBcD-2345 eFgH') === 'ABCD2345EFGH');
    t('новый ТВ: год, телефон, прежний код из 8 цифр и обычный текст — не код', T._joinFrom('2026') === '' && T._joinFrom('Солдаты 2004') === '' && T._joinFrom('1234 5678') === '' &&
        T._joinFrom('12345678') === '' && T._joinFrom('+998 90 123 45 67') === '' && T._joinFrom('998901234567') === '' && T._joinFrom('strengthened') === '' &&
        T._joinFrom('ABCD-2345-EFGO') === '' && T._joinFrom('ABCD-2345-EFG') === '' && T._joinFrom('ABCD-2345-EFGHJ') === '');
    t('новый ТВ: тема зависит от кода', T._joinTopic('ABCD2345EFGH') !== T._joinTopic('ABCD2345EFGJ') && /^lampa-join-[0-9a-f]{24}$/.test(T._joinTopic('ABCD2345EFGH')));
    t('новый ТВ: код на экране — XXXX-XXXX-XXXX', T._joinShow('ABCD2345EFGH') === 'ABCD-2345-EFGH');
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
{
    // настройки Skaz (onlines.js) не перебиваем: тип перевода и его вопрос «Продолжить?»
    const run = (lampa, local, card) => {
        const said = [], store = Object.assign({}, local);
        const ctx = { $: () => ({}), document: { addEventListener() {} }, console: { log() {} }, setTimeout, setInterval, clearInterval, Date, Math, JSON, String, Object, Array, parseInt, isNaN,
            localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
            Lampa: { Noty: { show: x => said.push(x) }, Utils: { hash: s => s },
                Storage: { get: (k, d) => (k in lampa ? lampa[k] : d), field: k => lampa[k], cache: () => ({ 'Show': { season: 1, episode: 3 } }) } } };
        ctx.window = ctx; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(SRC, 'bscontinue.js'), 'utf8') + ';this.M=BSContinue;', ctx);
        const o = { movie: card }; ctx.M._autoResume(o);
        return { said: said.join(' | '), ep: o.lampac_continue_episode };
    };
    const film = { id: 7, title: 'Фильм', original_title: 'Film' };
    t('skaz: новый фильм — сразу по-русски', /русскую/.test(run({}, {}, film).said));
    t('skaz: в Skaz запомнен оригинал — по-русски не включаем', run({ skaz_voice_pref: 'orig' }, {}, film).said === '');
    t('skaz: «Запоминать тип перевода» выключен — по-русски как обычно', /русскую/.test(run({ skaz_voice_pref: 'sub', skaz_voice_auto: false }, {}, film).said));
    const show = { id: 9, name: 'Шоу', original_name: 'Show', number_of_seasons: 2 };
    const rec = { bs_resume: JSON.stringify([{ card: show, s: 1, e: 3, pos: 100, dur: 1000 }]) };
    t('skaz: новый вид — продолжаем сериал сами', run({}, rec, show).ep > 0);
    t('skaz: классический вид с «Предлагать продолжение» — его ответ не перебиваем', run({ skaz_ui_mode: 'classic', lampac_continue_play: true }, rec, show).ep === undefined);
}
/* ---- bstg.js: записи Shots (свой ключ списка) и разовое «что нового» ---- */
{
    const mk = (store, pkg) => {
        const ctx = { console: { log() {} }, Date, Math, JSON, String, Object, Array, parseInt, setTimeout: () => 0, setInterval: () => 0, XMLHttpRequest: function () {},
            Uint8Array, unescape, escape, encodeURIComponent, decodeURIComponent,
            Lampa: { Noty: { show() {} }, Storage: { get: () => [] } },
            tizen: { application: { getCurrentApplication: () => ({ appInfo: { version: pkg || '1.7.63' } }) } } };
        ctx.window = ctx;
        ctx.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
        vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(SRC, 'bstg.js'), 'utf8') + ';this.M=BSTelegram;', ctx);
        return ctx.M;
    };
    let st = { bs_tg_shots: '["11","12"]' };
    mk(st)._shotsMigrate();
    t('shots: список переехал в свой ключ, переключатель снова по умолчанию (вкл.)', st.bs_tg_shots_sent === '["11","12"]' && !('bs_tg_shots' in st));
    st = { bs_tg_shots: 'false', bs_tg_shots_sent: '["1"]' }; mk(st)._shotsMigrate();
    t('shots: явное «выкл.» не трогаем', st.bs_tg_shots === 'false' && st.bs_tg_shots_sent === '["1"]');
    st = { bs_tg_token: '123456789:' + 'A'.repeat(35), bs_tg_chat: '5', bs_tg_shots_sent: '["1"]' };
    try { mk(st)._onShot({ id: 77, status: 'ready', file: 'http://x/v.mp4' }); } catch (e) {}
    t('shots: готовая запись запоминается в своём ключе, переключатель не затирается', st.bs_tg_shots_sent === '["77","1"]' && !('bs_tg_shots' in st));
    const T = mk({});
    t('что нового: метка пакета — по версии его кода', T._newsPkgFlag('1.7.50') === '7' && T._newsPkgFlag('1.7.55') === '8' && T._newsPkgFlag('1.7.62') === '9' && T._newsPkgFlag('1.7.40') === '');
    // офисный ТВ: пакет 1.7.50 (ждёт '7'), модули с GitHub уже отправили «9» — ни один из двух кодов больше не пишет
    st = { bs_tg_cmds: '9' }; const P50 = mk(st, '1.7.50');
    t('что нового: уже отправленное не повторяется после отката на пакет', P50._newsDue() === false && st.bs_tg_cmds === '7' && st.bs_tg_news === '9' && P50._newsDue() === false);
    st = { bs_tg_cmds: '7' }; const P50b = mk(st, '1.7.50');
    t('что нового: новое — ровно один раз', P50b._newsDue() === true && P50b._newsDue() === false && st.bs_tg_cmds === '7');
    st = {}; const Fresh = mk(st, '1.7.63');
    t('что нового: новая установка — один раз, метка пакета не нужна', Fresh._newsDue() === true && Fresh._newsDue() === false && st.bs_tg_cmds === '9');
    t('что нового: уже виденное — по большей из меток', mk({ bs_tg_cmds: '7', bs_tg_news: '9' })._newsSeen() === 9 && mk({ bs_tg_cmds: '9' })._newsSeen() === 9 && mk({ bs_tg_cmds: '7' })._newsSeen() === 7);
}
/* ---- bstg.js: failover главного ТВ ---- */
{
    const store = { bs_tv_id: 'ZZZZZZZZ', bs_tg_chat: '1', bs_tg_token: '123456789:' + 'AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw' };
    const ctx = { console: { log() {} }, Date, Math, JSON, String, Object, Array, parseInt, setTimeout: () => 0, setInterval: () => 0, XMLHttpRequest: function () {},
        Uint8Array, btoa: s => Buffer.from(s, 'binary').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('binary'), unescape, escape,
        encodeURIComponent, decodeURIComponent, Lampa: { Noty: { show() {} } } };
    ctx.window = ctx; ctx.crypto = require('crypto').webcrypto;
    ctx.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
    vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(SRC, 'bstg.js'), 'utf8') + ';this.M=BSTelegram;', ctx);
    const T = ctx.M;
    t('failover: главного пока нет - бота можно брать', T._leaderStale() === true);
    T._onBus({ t: 'hello', from: 'AAAAAAAA', name: 'Гостиная', leader: true, fg: true });
    t('failover: свежий главный - бота не трогаем', T._leaderStale() === false);
    t('failover: ТВ на экране с меньшим id - впереди в очереди', T._takeoverRank() === 1);
    T._onBus({ t: 'hello', from: 'BBBBBBBB', name: 'Спальня', leader: false, fg: false });
    t('failover: ТВ не на экране в очереди не учитывается', T._takeoverRank() === 1);
    T._onBus({ t: 'hello', from: 'CCCCCCCC', name: 'Кухня', leader: false, fg: true });
    t('failover: очередь растёт с каждым ТВ на экране', T._takeoverRank() === 2);
}
/* ---- bstg.js: failover по времени (главный молчит 25 минут: «я здесь» — раз в 20 минут, ntfy даёт 250 сообщений в сутки) ---- */
{
    const store = { bs_tv_id: 'ZZZZZZZZ', bs_tg_chat: '1', bs_tg_token: '123456789:' + 'AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw' };
    let clock = 1700000000000;
    class FakeDate extends Date { constructor(...args) { if (args.length) super(...args); else super(clock); } static now() { return clock; } }
    const ctx = { console: { log() {} }, Date: FakeDate, Math, JSON, String, Object, Array, parseInt, setTimeout: () => 0, setInterval: () => 0, XMLHttpRequest: function () {},
        Uint8Array, btoa: s => Buffer.from(s, 'binary').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('binary'), unescape, escape,
        encodeURIComponent, decodeURIComponent, Lampa: { Noty: { show() {} } } };
    ctx.window = ctx; ctx.crypto = require('crypto').webcrypto;
    ctx.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
    vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(SRC, 'bstg.js'), 'utf8') + ';this.M=BSTelegram;', ctx);
    const T = ctx.M;
    T._onBus({ t: 'hello', from: 'AAAAAAAA', name: 'Гостиная', leader: true, fg: true });
    clock += 24 * 60000;
    t('failover по времени: через 24 минуты главный ещё жив', T._leaderStale() === false);
    clock += 2 * 60000;
    t('failover по времени: после 25 минут тишины главный считается ушедшим', T._leaderStale() === true);
    t('failover по времени: ушедший главный не занимает очередь - мы первые', T._takeoverRank() === 0);
    T._onBus({ t: 'hello', from: 'AAAAAAAA', name: 'Гостиная', leader: true, fg: true });
    t('failover по времени: новый «я здесь» от главного возвращает его', T._leaderStale() === false);
    clock += 26 * 60000;
    t('failover по времени: главный давно молчит — бота можно брать', T._leaderStale() === true);
    T._onConflict();
    t('split-brain: Telegram ответил «занято» — главный жив, не перехватываем', T._leaderStale() === false && T._takeoverRank() === 0);
    clock += 24 * 60000;
    t('split-brain: и через 24 минуты после «занято» — всё ещё не перехватываем', T._leaderStale() === false);
    clock += 2 * 60000;
    t('split-brain: «занято» больше 25 минут не было — главный пропал, можно брать', T._leaderStale() === true);
}
/* ---- bstg.js: только что запущенный ТВ не знает главного — «занято» от Telegram не даёт ему отбирать сообщения ---- */
{
    const store = { bs_tv_id: 'ZZZZZZZZ', bs_tg_chat: '1', bs_tg_token: '123456789:' + 'AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw' };
    const ctx = { console: { log() {} }, Date, Math, JSON, String, Object, Array, parseInt, setTimeout: () => 0, setInterval: () => 0, XMLHttpRequest: function () {},
        Uint8Array, btoa: s => Buffer.from(s, 'binary').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('binary'), unescape, escape,
        encodeURIComponent, decodeURIComponent, Lampa: { Noty: { show() {} } } };
    ctx.window = ctx; ctx.crypto = require('crypto').webcrypto;
    ctx.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
    vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(SRC, 'bstg.js'), 'utf8') + ';this.M=BSTelegram;', ctx);
    const T = ctx.M;
    t('split-brain: новый ТВ, главного ещё не слышал — до «занято» бота взять можно (вдруг ТВ один)', T._leaderStale() === true);
    T._onConflict();
    t('split-brain: новый ТВ получил «занято» — не дёргает Telegram каждые 8 с', T._leaderStale() === false);
}
/* ---- bssources.js: источники на выбор, главная кнопка, ключи Skaz ---- */
{
    const store = {}, mem = {};
    const ls = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
    const Lampa = { Storage: { get: (k, d) => (k in mem ? mem[k] : (d === undefined ? '' : d)), set: (k, v) => { mem[k] = v; } },
        Utils: { protocol: () => 'http://', putScriptAsync() {} }, Noty: { show() {} }, Listener: { follow() {} }, Plugins: { get: () => [] } };
    const ctx = { window: { localStorage: ls }, Lampa, $: { trim: x => String(x).trim() }, console: { log() {} }, JSON, String, Object, Array };
    ctx.window.window = ctx.window; vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(SRC, 'bssources.js'), 'utf8') + ';this.M=BSSources;', ctx);
    const S = ctx.M;
    const btn = (cls, subtitle, text) => ({ hasClass: c => cls.split(' ').indexOf(c) >= 0, attr: () => subtitle, data: () => subtitle, text: () => text || '' });
    const skaz = btn('full-start__button view--online lampac--button', 'Онлайн by Skaz', 'Онлайн');
    const z01 = btn('full-start__button view--online lampac--button', 'Z01 2.1', 'Онлайн');
    const ark = btn('full-start__button view--online lampac--button', 'Vod v1.4', 'Онлайн');
    const mod = btn('full-start__button view--online_mod', 'online_mod 3.2', 'Онлайн');
    const showy = btn('full-start__button view--online showy--button', 'смотреть Filmix/Rezka/Kodik', 'Showy');
    const shots = btn('full-start__button view--online', 'Shots', 'Shots');
    t('источники: кнопки узнаются по признакам', S.owner(skaz) === 'skaz' && S.owner(z01) === 'z01' && S.owner(ark) === 'arkmv' &&
        S.owner(mod) === 'online_mod' && S.owner(showy) === 'showy' && S.owner(shots) === '');
    t('источники: по умолчанию главный — Skaz', S.mainId() === 'skaz' && S.isMain(skaz) && !S.isMain(z01) && !S.isMain(ark));
    store.bs_src_main = 'z01';
    t('источники: выбран, но не включён — главный остаётся Skaz', S.mainId() === 'skaz' && S.isMain(skaz));
    store.bs_src_z01 = 'true';
    t('источники: выбран и включён — «Смотреть» открывает его, не Skaz', S.mainId() === 'z01' && S.isMain(z01) && !S.isMain(skaz));
    store.bs_src_main = 'vod_llpp'; store.bs_src_vod_llpp = 'true';
    t('источники: вариант Online Mod узнаётся по общей кнопке группы', S.isMain(mod));
    t('источники: экраны плагинов', S._compOwner('lampacskaz') === 'skaz' && S._compOwner('lampac_z') === 'z01' &&
        S._compOwner('online_mod') === 'online_mod' && S._compOwner('vod') === 'arkmv' && S._compOwner('full') === '');
    mem.online_balanser = 'rezka'; mem.online_watched_last = '{"skaz":1}';
    S._onActivity({ type: 'init', component: 'lampac_z' });
    t('ключи: Z01 впервые — без выбора Skaz', mem.online_balanser === '' && mem.online_watched_last === '');
    mem.online_balanser = 'filmix';
    S._onActivity({ type: 'archive', component: 'full' });
    t('ключи: вне экрана плагина — снова выбор Skaz', mem.online_balanser === 'rezka' && mem.online_watched_last === '{"skaz":1}');
    S._onActivity({ type: 'init', component: 'lampac_z' });
    t('ключи: Z01 снова — его собственный выбор', mem.online_balanser === 'filmix');
    S._onActivity({ type: 'init', component: 'lampacskaz' });
    t('ключи: экран Skaz — выбор Skaz не потерян', mem.online_balanser === 'rezka');
}
/* ---- bssources.js: выбор кнопки «Смотреть» и подключение плагинов ---- */
{
    const mk = (store, plugins) => {
        const mem = {}, loaded = [];
        const ls = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
        const Lampa = { Storage: { get: (k, d) => (k in mem ? mem[k] : (d === undefined ? '' : d)), set: (k, v) => { mem[k] = v; } },
            Utils: { protocol: () => 'http://', putScriptAsync: urls => { loaded.push.apply(loaded, urls); } }, Noty: { show() {} },
            Listener: { follow() {} }, Plugins: { get: () => plugins || [] } };
        const ctx = { window: { localStorage: ls }, Lampa, $: { trim: x => String(x).trim() }, console: { log() {} }, JSON, String, Object, Array };
        ctx.window.window = ctx.window; vm.createContext(ctx);
        vm.runInContext(fs.readFileSync(path.join(SRC, 'bssources.js'), 'utf8') + ';this.M=BSSources;', ctx);
        return { S: ctx.M, loaded, mem };
    };
    const btn = (cls, subtitle, text) => ({ hasClass: c => cls.split(' ').indexOf(c) >= 0, attr: () => subtitle, data: () => subtitle, text: () => text || '' });
    const skaz = btn('view--online lampac--button', 'Онлайн by Skaz', 'Онлайн');
    const other = btn('view--online lampac--button', 'Другой Lampac 1.0', 'Онлайн');      // добавлен вручную, не из списка
    const z01 = btn('view--online lampac--button', 'Z01 2.1', 'Онлайн');
    let r = mk({});
    t('смотреть: чужой Lampac раньше Skaz — берём точную кнопку Skaz', r.S.pick([other, skaz], false) === skaz);
    t('смотреть: подписи Skaz нет — похожая кнопка, как раньше', r.S.pick([other], false) === other);
    r = mk({ bs_src_main: 'z01', bs_src_z01: 'true' });
    t('смотреть: главный Z01 — его кнопка', r.S.pick([skaz, z01], false) === z01);
    t('смотреть: Z01 ещё не добавил кнопку — ждём (не Skaz)', r.S.pick([skaz], false) === null);
    t('смотреть: Z01 так и не загрузился — последняя попытка берёт Skaz', r.S.pick([other, skaz], true) === skaz);
    r = mk({ bs_src_online_mod: 'true', bs_src_vod_llpp: 'true', bs_src_showy: 'true' });
    r.S._loadAll();
    t('подключение: из группы Online Mod — только один плагин', r.loaded.filter(u => /online_mod\.js|llpp\.in/.test(u)).length === 1);
    t('подключение: выключенные не грузятся, включённые грузятся', r.loaded.indexOf('http://showy.online/m.js') >= 0 && r.loaded.indexOf('http://z01.online/live') < 0);
    t('подключение: Клубничку сами не грузим — решает переключатель Skaz', !r.loaded.some(u => /sisi\.js/.test(u)));
    r = mk({});
    r.S._loadAll();
    t('подключение: по умолчанию ничего не грузим', r.loaded.length === 0);
    r = mk({ bs_src_z01: 'true' }, [{ url: 'http://z01.online/live' }]);
    r.S._loadAll();
    t('подключение: плагин уже добавлен вручную — второй раз не грузим', r.loaded.length === 0);
}
/* ---- update.js: запасные зеркала CDN ---- */
{
    const mk = store => {
        const ls = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
        let reloaded = 0, written = '';
        const w = { localStorage: ls, location: { reload() { reloaded++; } } };
        const ctx = { window: w, document: { write: h => { written += h; }, createElement: () => ({ style: {} }), body: { appendChild() {} } },
            setInterval: () => 0, clearInterval() {}, setTimeout: () => 0,
            JSON, Date, Math, String, Number, console: { log() {} } };
        w.window = w; vm.createContext(ctx);
        vm.runInContext(fs.readFileSync(path.join(SRC, 'update.js'), 'utf8'), ctx);
        return { w, store, written: () => written, reloaded: () => reloaded };
    };
    const upd = JSON.stringify({ v: '9.9.9', files: ['loader.js'] });
    let r = mk({ bs_upd: upd });
    t('обновление: по умолчанию — основной jsDelivr', /https:\/\/cdn\.jsdelivr\.net\/gh\/sunic007\/lampa-samsung@v9\.9\.9\/src\/loader\.js/.test(r.written()));
    r.w.bsUpdFail();
    t('обновление: файл не пришёл — следующее зеркало, без часа на пакете и без метки «плохая версия»',
        r.store.bs_upd_mirror === '1' && !r.store.bs_upd_skip && !('bs_upd_try' in r.store) && r.reloaded() === 1);
    r = mk({ bs_upd: upd, bs_upd_mirror: '1' });
    t('обновление: второе зеркало — fastly', /https:\/\/fastly\.jsdelivr\.net\/gh\/sunic007\/lampa-samsung@v9\.9\.9\/src\//.test(r.written()));
    r = mk({ bs_upd: upd, bs_upd_mirror: '2' });
    r.w.bsUpdFail();
    t('обновление: все зеркала не ответили — час на пакете, потом снова с первого', !!r.store.bs_upd_skip && !('bs_upd_mirror' in r.store));
    r = mk({ bs_upd: upd, bs_upd_mirror: '7' });
    t('обновление: испорченный номер зеркала — основной', /cdn\.jsdelivr\.net/.test(r.written()));
}
/* ---- bstg.js: качество фильма в поиске бота и «Сообщить о качестве» ---- */
{
    const store = { bs_tv_id: 'ZZZZZZZZ', bs_tg_chat: '1', bs_tg_token: '123456789:' + 'AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw' };
    const ctx = { console: { log() {} }, Date, Math, JSON, String, Object, Array, parseInt, setTimeout: () => 0, setInterval: () => 0, XMLHttpRequest: function () {},
        Uint8Array, btoa: s => Buffer.from(s, 'binary').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('binary'), unescape, escape,
        encodeURIComponent, decodeURIComponent, Lampa: { Noty: { show() {} } } };
    ctx.window = ctx; ctx.crypto = require('crypto').webcrypto;
    ctx.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
    vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(SRC, 'bstg.js'), 'utf8') + ';this.M=BSTelegram;', ctx);
    const T = ctx.M, now = Date.parse('2026-10-15');
    t('качество: названия как у значков Lampa', T._qualityName('bd') === 'Blu-ray' && T._qualityName('webdl') === 'WEB-DL' && T._qualityName('CAMRip') === 'CAMRip' && T._qualityName('') === '');
    t('качество: экранка — TS/CAMRip/TC, а WEB-DL и Blu-ray — нормально', T._qualityLow('ts') && T._qualityLow('camrip') && T._qualityLow('TC') && !T._qualityLow('webdl') && !T._qualityLow('bd'));
    const fresh = { media_type: 'movie', id: 1, title: 'Новинка', release_date: '2026-09-20' };
    const old = { media_type: 'movie', id: 2, title: 'Старый', release_date: '1999-10-15' };
    t('качество: подпись — нормальное качество', T._qualityLine(Object.assign({}, fresh, { _q: 'webdl' }), now) === '📀 Качество: WEB-DL');
    t('качество: подпись — только экранка', T._qualityLine(Object.assign({}, fresh, { _q: 'ts' }), now) === '⚠️ Пока только экранка (TS)');
    t('качество: новинка без качества — «ещё нет», старый без данных — молчим', T._qualityLine(Object.assign({}, fresh, { _q: '' }), now) === '⏳ В хорошем качестве ещё нет' &&
        T._qualityLine(Object.assign({}, old, { _q: '' }), now) === '');
    t('качество: ждать есть смысл — экранка или новинка без качества', T._waitable(Object.assign({}, fresh, { _q: 'camrip' }), now) && T._waitable(Object.assign({}, fresh, { _q: '' }), now) &&
        !T._waitable(Object.assign({}, fresh, { _q: 'bd' }), now) && !T._waitable(Object.assign({}, old, { _q: '' }), now) && !T._waitable({ media_type: 'tv', id: 3, _q: '' }, now));
    t('качество: качество ещё не узнали — ни строки, ни кнопки', T._qualityLine(fresh, now) === '' && !T._waitable(fresh, now));
    const btns = q => [].concat.apply([], T._slideButtons([Object.assign({}, fresh, { _q: q })], 0, false)).map(b => b.callback_data);
    t('качество: экранка — кнопка «Сообщить о качестве» под фильмом', btns('ts').indexOf('q:m:1') >= 0);
    t('качество: нормальное качество — кнопки нет', btns('webdl').indexOf('q:m:1') < 0);
    T._onBus({ t: 'qw', from: 'AAAAAAAA', list: [{ id: 5, name: 'Фильм', at: 1 }] });
    t('качество: список ожидания владельца — общий для всех ТВ', JSON.parse(store.bs_tg_qwait)[0].id === 5);
    const d = T._botDesc();
    t('бот: описание «отвечает, пока Lampa открыта на ТВ» — в пределах Telegram (512 / 120)', d[0].length <= 512 && d[1].length <= 120 && /пока Lampa открыта/.test(d[0]) && /пока Lampa открыта/.test(d[1]));
}
/* ---- update.js: карточка загрузки — только при обновлении, обычный запуск — только экран Lampa ---- */
{
    const run = store => {
        const ls = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
        let appended = 0;
        const node = () => ({ style: {}, className: '', textContent: '' });
        const el = () => ({ style: {}, className: '', set innerHTML(v) {}, querySelector: () => node() });
        const w = { localStorage: ls, location: { reload() {} } };
        const ctx = { window: w, document: { write() {}, createElement: el, body: { appendChild: () => { appended++; } } },
            setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, JSON, Date, Math, String, Number, console: { log() {} } };
        w.window = w; vm.createContext(ctx);
        vm.runInContext(fs.readFileSync(path.join(SRC, 'update.js'), 'utf8'), ctx);
        w.bsUpdLoaded();
        return appended;
    };
    const upd = JSON.stringify({ v: '9.9.9', files: ['loader.js', 'bstg.js'] });
    t('загрузка: первый запуск новой версии — карточка «Обновляю Sunic Apps»', run({ bs_upd: upd }) === 1);
    t('загрузка: обычный запуск той же версии — без карточки', run({ bs_upd: upd, bs_upd_ran: '9.9.9' }) === 0);
    t('загрузка: запуск из пакета — без карточки', run({}) === 0);
    const L = fs.readFileSync(path.join(SRC, 'loader.js'), 'utf8');
    t('загрузка: loader.js сам ничего не пишет при обычном запуске', L.indexOf("'Запускаю Lampa'") < 0 && L.indexOf('bsPhase') < 0);
    // все наши настройки — в одном разделе «Sunic Apps»; в разделы самой Lampa ничего не кладём
    const sv = L.slice(L.indexOf('var BS_ROOT'), L.indexOf('var BS_SETTINGS_NEEDS'));
    const c = { console: { log() {} } };
    vm.createContext(c); vm.runInContext(sv.replace(/^var /gm, 'this.'), c);
    const secIds = c.BS_SECTIONS.map(s => s[0]);
    t('настройки: один раздел «Sunic Apps» в главном списке', c.BS_ROOT === 'bs_apps' && (L.match(/addComponent\(/g) || []).length === 1);
    t('настройки: пункты — только в наших подразделах, не в разделах Lampa', c.BS_SETTINGS_LAYOUT.every(x => secIds.indexOf(x[0]) >= 0));
    t('настройки: у каждого подраздела есть название и подсказка', c.BS_SECTIONS.every(s => s[1] && s[2]) && secIds.indexOf('bs_update') >= 0);
    const back = L.match(/function bsSectionBack\([\s\S]*?\n\}/)[0];
    const opened = [];
    const c2 = { BS_ROOT: 'bs_apps', BS_SECTIONS: c.BS_SECTIONS, Lampa: { Settings: { create: (n, p) => opened.push(n + ':' + p.last_index) } } };
    vm.createContext(c2); vm.runInContext(back, c2);
    const e1 = { name: 'bs_telegram', params: {} }; c2.bsSectionBack(e1); e1.params.onBack();
    t('настройки: «Назад» из подраздела — в «Sunic Apps» на его кнопку', opened[0] === 'bs_apps:' + secIds.indexOf('bs_telegram'));
    const own = () => 'own', e2 = { name: 'bs_player', params: { onBack: own } }, e3 = { name: 'interface', params: {} };
    c2.bsSectionBack(e2); c2.bsSectionBack(e3);
    t('настройки: чужой «Назад» и разделы Lampa не трогаем', e2.params.onBack === own && !e3.params.onBack);
}
/* ---- loader.js: вышли из Lampa во время загрузки — версия не «плохая» (не больше двух раз подряд) ---- */
{
    const L = fs.readFileSync(path.join(SRC, 'loader.js'), 'utf8');
    const fn = L.slice(L.indexOf('var BS_UPD_FORGIVE'), L.indexOf("document.addEventListener('visibilitychange', function () { if (document.hidden) bsStartInterrupted(); });"));
    const run = (store, ready) => {
        const ctx = { parseInt, String, window: { BS_REMOTE_VERSION: '1.7.63', appready: !!ready,
            localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } } } };
        vm.createContext(ctx); vm.runInContext(fn + ';bsStartInterrupted();', ctx);
        return store;
    };
    let st = run({ bs_upd_try: '1.7.63' });
    t('запуск прерван: метка попытки снята — версию не пометят плохой', !('bs_upd_try' in st) && st.bs_upd_intr === '1');
    st = run({ bs_upd_try: '1.7.63', bs_upd_intr: '2' });
    t('запуск прерван третий раз подряд: метку оставляем — зависшая версия уйдёт', st.bs_upd_try === '1.7.63');
    st = run({ bs_upd_try: '1.7.63' }, true);
    t('Lampa уже поднялась: ничего не трогаем', st.bs_upd_try === '1.7.63' && !('bs_upd_intr' in st));
}
/* ---- loader.js: «Очистить кеш и данные» в Lampa не откатывает функции на версию пакета ---- */
{
    const L = fs.readFileSync(path.join(SRC, 'loader.js'), 'utf8');
    const fn = L.slice(L.indexOf('var BS_KEEP_ON_CLEAR'), L.indexOf('try { bsKeepUpdatesOnClear('));
    const data = { bs_upd: '{"v":"2.0.0"}', bs_upd_ran: '2.0.0', bs_upd_mirror: '1', bs_tg_token: 'x', bs_tg_chat: '1', bs_tg_users: '{}', bs_subs: '[]', bs_gemini_keys: '{}',
        bs_tv_name: 'Зал', bs_tv_id: 'a1', bs_ai_groq: 'k', bs_tg_svc: '1', bs_ai_svc: '{}', bs_subscribed_x: '1', bs_player_default: '1', menu_always: 'true', online_view: '[]' };
    function FakeStorage() {}
    FakeStorage.prototype = {
        get length() { return Object.keys(data).length; }, key: i => Object.keys(data)[i], getItem: k => (k in data ? data[k] : null),
        setItem: (k, v) => { data[k] = String(v); }, clear: () => { Object.keys(data).forEach(k => delete data[k]); }
    };
    const ctx = {}; vm.createContext(ctx); vm.runInContext(fn + ';this.f = bsKeepUpdatesOnClear;', ctx);
    ctx.f(FakeStorage.prototype); ctx.f(FakeStorage.prototype);
    new FakeStorage().clear();
    t('очистка данных: записи обновления остаются, остальное стёрто', data.bs_upd === '{"v":"2.0.0"}' && data.bs_upd_ran === '2.0.0' && data.bs_upd_mirror === '1' &&
        !('bs_player_default' in data) && !('bs_subscribed_x' in data) && !('menu_always' in data) && !('online_view' in data));
    t('очистка данных: Telegram-бот остаётся подключённым (токен, чат, люди, подписки, ключи ИИ, ТВ)',
        ['bs_tg_token', 'bs_tg_chat', 'bs_tg_users', 'bs_subs', 'bs_gemini_keys', 'bs_ai_groq', 'bs_tv_name', 'bs_tv_id', 'bs_tg_svc', 'bs_ai_svc'].every(k => k in data));
    t('очистка данных: перехват ставится один раз', FakeStorage.prototype.clear.__bs === true);
}
{
    // «Очистить кеш» (без данных): Lampa пишет '' в ключи с 'online_' — наши настройки возвращаем
    const L = fs.readFileSync(path.join(SRC, 'loader.js'), 'utf8');
    const fn = L.slice(L.indexOf('function bsKeepOursOnCacheClear'), L.indexOf('\n}', L.indexOf('function bsKeepOursOnCacheClear')) + 2);
    const data = { bs_online_resume: 'false', bs_src_online_mod: 'true', online_view: '[1]', bs_empty: '' };
    const ls = { get length() { return Object.keys(data).length; }, key: i => Object.keys(data)[i], getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
    let handler = null; const later = [];
    const ctx = { window: { localStorage: ls }, setTimeout: f => later.push(f) };
    vm.createContext(ctx); vm.runInContext(fn + ';this.f = bsKeepOursOnCacheClear;', ctx);
    ctx.f({ listener: { follow: (n, h) => { if (n === 'clear') handler = h; } } });
    const lampaClear = full => { handler({ full }); if (!full) Object.keys(data).forEach(k => { if (/online_|file_view_|storage_/.test(k)) data[k] = ''; }); later.splice(0).forEach(f => f()); };
    lampaClear(false);
    t('очистка кеша: наши настройки с online_ в имени не выключаются', data.bs_online_resume === 'false' && data.bs_src_online_mod === 'true' && data.online_view === '');
    t('очистка кеша: пустое значение не выдумываем', data.bs_empty === '');
}
/* ---- loader.js: ошибки плагинов в уведомлениях — коротко и красной точкой ---- */
{
    const src = fs.readFileSync(path.join(SRC, 'loader.js'), 'utf8');
    const fn = src.slice(src.indexOf('var BS_NOTY_ERROR'), src.indexOf('function bsNotyPolish('));
    const ctx = { String, RegExp };
    vm.createContext(ctx); vm.runInContext(fn + ';this.txt = bsNotyText; this.name = bsPluginName;', ctx);
    const r = ctx.txt('При загрузке приложения, часть плагинов не удалось загрузить (http://lampa.byskaz.ru/plugins/kp.js?v=2, https://cub.best/plugin/tsarea)');
    t('ошибки плагинов: длинный список адресов — коротко по именам файлов', r.text === 'Не загрузились плагины: kp, tsarea' && r.params.style === 'error');
    t('ошибки плагинов: адрес без файла — по домену', ctx.name('http://z01.online/') === 'z01.online');
    t('ошибки: текст про сбой — красной точкой, даже без стиля', ctx.txt('Не удалось сменить качество').params.style === 'error' && ctx.txt('Сервер обновлений недоступен').params.style === 'error');
    t('ошибки: обычное уведомление остаётся обычным', !ctx.txt('Переключаю качество на 720p').params.style && !ctx.txt('Lampa 3.3.6 запущена').params.style);
    t('ошибки: стиль, заданный плагином, не трогаем', ctx.txt('Ошибка сети', { style: 'glass' }).params.style === 'glass');
    t('совместимость: новая Lampa передаёт не объект — уведомление как есть', ctx.txt('Ошибка сети', 5000).params === 5000);
    // обёртка Lampa.Noty.show: наша ошибка не ломает уведомления, лишние аргументы новой Lampa доходят
    const pol = src.match(/function bsNotyPolish\([\s\S]*?\n\}/)[0];
    const got = [];
    const c2 = { String, RegExp, window: {}, bsNotyText: () => { throw new Error('x'); } };
    c2.window.Lampa = c2.Lampa = { Noty: { show: function () { got.push([].slice.call(arguments)); } } };
    vm.createContext(c2); vm.runInContext(pol + ';bsNotyPolish();', c2);
    c2.Lampa.Noty.show('Привет', { time: 1 }, 'extra');
    t('совместимость: сбой нашей правки — уведомление Lampa всё равно показано', got.length === 1 && got[0][0] === 'Привет' && got[0][2] === 'extra');
}
/* ---- bsfix.js: сырые ошибки на весь экран — одной строкой (Samsung и Android) ---- */
{
    const F = fixCtx(), S = F.M._shortError;
    t('ошибки: упавший скрипт («Message/In/Stack») — коротко', S('Message: name.toLowerCase is not a function<br><br>In: http://skaz.tv/onlines.js?_=1<br><br>Stack: TypeError: x<br>at a (onlines.js:2274:18)') === 'Сбой в источнике — выберите другой источник');
    t('ошибки: HTML-страница ответа — без страницы', S('Ошибка сети: <!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1><hr>nginx</body></html>') === 'Ошибка сети — источник не ответил');
    t('ошибки: очень длинная ошибка — коротко', S('Ошибка: ' + 'x'.repeat(400)).length < 80);
    t('ошибки: длинный обычный текст и короткая ошибка — как есть', S('Сезон 3 выйдет 5 ноября 2026. ' + 'Новые серии каждую неделю. '.repeat(10)) === null && S('Ошибка сети: 404') === null && S('') === null);
    // обёртка Lampa.Noty.show: красная точка, свои параметры и лишние аргументы новой Lampa сохраняются
    const got = [];
    F.ctx.Lampa.Noty = { show: function () { got.push([].slice.call(arguments)); } };
    F.ctx.Lampa.Noty.show.__bs = true;
    F.M.start();
    F.ctx.Lampa.Noty.show('Message: x<br>In: y<br>Stack: z', { time: 8000 }, 'extra');
    F.ctx.Lampa.Noty.show('Привет', 5000);
    t('ошибки: обёртка уведомлений — коротко, красной точкой, время и лишние аргументы на месте', got[0][0] === 'Сбой в источнике — выберите другой источник' && got[0][1].style === 'error' && got[0][1].time === 8000 && got[0][2] === 'extra');
    t('ошибки: обычное уведомление и чужой формат параметров — как есть, метки других обёрток целы', got[1][0] === 'Привет' && got[1][1] === 5000 && F.ctx.Lampa.Noty.show.__bs === true);
    // Skaz отдаёт в проверку источников объекты строк «Сезон» — пропускаем только имена
    const seen = [];
    const comp = { setDefaultQuality: () => {}, probeSources: function (names) { names.forEach(n => seen.push(n.toLowerCase())); } };
    F.M._patch(comp);
    comp.probeSources([{ index: 0, entry: { title: '2 сезон' } }, { index: 1 }]);
    comp.probeSources(['RuDUB', { index: 2 }, 'Filmix']);
    t('Skaz: строки «Сезон» (объекты) в проверку источников не попадают — без ошибки на экране', seen.join() === 'rudub,filmix');
}
/* ---- bstg.js: бот на трёх языках (ru / en / uz) ---- */
{
    const g = { name: 'Аня', at: 1, want: [], subs: [], muted: [], later: [] };
    const store = { bs_tg_chat: '1', bs_tg_token: '123456789:' + 'AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw', bs_tg_lang: JSON.stringify({ 1: 'en', 2: 'uz' }),
        bs_tg_users: JSON.stringify({ 2: g, 3: g }) };
    const urls = [];
    function X() { this.open = (m, u) => { this.u = u; }; this.send = b => urls.push(dec(tgReq(this.u, b))); this.setRequestHeader = () => {}; }
    const ctx = { console: { log() {} }, Date, Math, JSON, String, Object, Array, parseInt, setTimeout: () => 0, setInterval: () => 0, XMLHttpRequest: X, Uint8Array,
        btoa: s => Buffer.from(s, 'binary').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('binary'), unescape, escape, encodeURIComponent, decodeURIComponent,
        Lampa: { Noty: { show() {} } } };
    ctx.window = ctx; ctx.crypto = require('crypto').webcrypto;
    ctx.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
    vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(SRC, 'bstg.js'), 'utf8') + ';this.M=BSTelegram;', ctx);
    const T = ctx.M, say = (c, text, lc) => { urls.length = 0; T._handle({ update_id: 1, message: { chat: { id: +c, type: 'private' }, from: { first_name: 'X', language_code: lc }, text } }); return urls.join('\n'); };
    const inLang = (c, fn) => { let r; T._as(c, () => { r = fn(); }); return r; };
    t('язык: L() — у каждого свой (en / uz), не выбирал — русский', inLang('1', () => T._L('ру', 'en', 'uz')) === 'en' && inLang('2', () => T._L('ру', 'en', 'uz')) === 'uz' && inLang('3', () => T._L('ру', 'en', 'uz')) === 'ру');
    t('язык: подключённый без выбора — русский, даже если Telegram на английском', /Выберите раздел/.test(say('3', '📋 Меню', 'en')));
    t('язык: «📋 Menu» по-английски — меню на английском, есть «⚙️ Settings»', /Choose a section/.test(say('1', '📋 Menu')) && /mn:settings/.test(urls.join('')) && /Settings/.test(urls.join('')));
    t("язык: «📋 Menyu» и «❓ Yordam» по-узбекски — узнаются", /Bo'limni tanlang/.test(say('2', '📋 Menyu')) && /Lampa yordamchingizman/.test(say('2', '❓ Yordam')));
    t('язык: слова кнопок на всех языках — не уходят в поиск', ['меню', 'menu', 'menyu', "ko'rmoqchiman", 'want to watch', 'хочу посмотреть', "tv'da yozish"].every(w => T._kbWords.indexOf(w) >= 0) &&
        T._plainOf('⭐ Koʻrmoqchiman') === "ko'rmoqchiman" && T._isWord(T._plainOf('🔔 Obunalar'), 'subs'));
    t('язык: «🌐 Язык / Language / Til» и /lang — кнопки выбора', /lg:uz/.test(say('3', '🌐 Язык / Language / Til')) && /lg:en/.test(say('1', '/lang')));
    urls.length = 0; T._handle({ callback_query: { id: 'q', data: 'lg:en', from: { id: 3 }, message: { message_id: 5, chat: { id: 3 } } } });
    t('язык: выбрали English — запомнили и ответили по-английски', JSON.parse(store.bs_tg_lang)['3'] === 'en' && /Language: English/.test(urls.join('\n')));
    t('язык: чужому — на языке его Telegram', /This bot is for Lampa/.test(say('9', 'hi', 'en')) && /Bu bot televizordagi Lampa/.test(say('8', 'salom', 'uz')) && /Этот бот — для Lampa/.test(say('7', 'привет', 'ru')));
    t('язык: TMDB — en-US для английского, ru для русского и узбекского', inLang('1', T._tmdbLang) === 'en-US' && inLang('2', T._tmdbLang) === 'ru');
    t('язык: меню команд на каждом языке, есть /lang', T._commandsFor('en')[0].description === '📋 Main menu' && T._commandsFor('uz').some(c => c.command === 'lang') && T._commandsFor('ru')[0].description === '📋 Главное меню');
    { const lc = T._lateCommand, q = tv => ({ _q: { at: 1, tv: tv } });
      const m = (t, tv) => Object.assign(q(tv), { message: { text: t, chat: { id: 1 } } });
      t('очередь: запоздалые «Помощь», /help, «Меню», кнопка меню — молча; поиск, /start, «на ТВ», «Хочу посмотреть», «Подписаться» и свежие — выполняются',
        lc(m('Помощь'), 300) && lc(m('/help'), 300) && lc(m('📋 Меню'), 300) && lc(Object.assign(q(0), { callback_query: { data: 'mn:help' } }), 300) &&
        !lc(m('Синтел'), 300) && !lc(m('/start'), 300) && !lc(m('Помощь'), 60) && !lc(Object.assign(q(1), { callback_query: { data: 'v:m:1' } }), 300) && !lc(m('⌨️ Набрать на ТВ'), 300) &&
        !lc(Object.assign(q(0), { callback_query: { data: 'w:m:1' } }), 300) && !lc(Object.assign(q(0), { callback_query: { data: 's:t:5' } }), 300)); }
    t('описание бота со службой («даже когда Lampa закрыта») — в пределах Telegram на трёх языках', ['ru', 'en', 'uz'].every(l => { const d = T._botDesc(l, true); return d[0].length <= 512 && d[1].length <= 120 && d[1] !== T._botDesc(l)[1]; }));
    t('язык: описание бота en/uz — в пределах Telegram (512 / 120)', ['en', 'uz'].every(l => { const d = T._botDesc(l); return d[0].length <= 512 && d[1].length <= 120 && d[0] !== T._botDesc('ru')[0]; }));
    const seenW = { 1: { name: 'Солдаты', next: { s: 12, e: 17, d: '2026-10-16' } } }, day = new Date(2026, 9, 13).getTime();
    t('язык: сводка недели — дни и месяцы на языке человека', inLang('1', () => T._weekLines(seenW, ['1'], day))[0] === '• Fri 16 Oct — Солдаты 12×17' && /^• пт 16 окт/.test(inLang('3x', () => T._weekLines(seenW, ['1'], day))[0]));
    t('язык: подпись поиска и кнопки — по-английски', /\nSeries/.test(inLang('1', () => T._caption({ media_type: 'tv', name: 'X', first_air_date: '2004-01-26' }))) &&
        /Watch/.test(JSON.stringify(inLang('1', () => T._slideButtons([{ media_type: 'tv', id: 1 }], 0)))) && /Ko'rish/.test(JSON.stringify(inLang('2', () => T._slideButtons([{ media_type: 'tv', id: 1 }], 0)))));
    t('язык: «Следующая серия» в Telegram по-английски, на ТВ (без языка) — по-русски', /^Next episode: 1×3 — tomorrow/.test(T._nextText({ air_date: '2026-10-14', season_number: 1, episode_number: 3 }, day, 'en')) &&
        /^Следующая серия: 1×3 — завтра/.test(T._nextText({ air_date: '2026-10-14', season_number: 1, episode_number: 3 }, day)));
    store.bs_tg_lang = JSON.stringify({ 2: 'uz' });
    ctx.Lampa.Storage = { get: (k, d) => (k === 'language' ? 'en' : d) };
    t('язык: не выбирал — как язык Lampa на ТВ (English)', inLang('3', () => T._L('ру', 'en', 'uz')) === 'en' && inLang('2', () => T._L('ру', 'en', 'uz')) === 'uz');
    ctx.Lampa.Storage = { get: (k, d) => (k === 'language' ? 'uk' : d) };
    t('язык: Lampa на украинском — бот по-русски', inLang('3', () => T._L('ру', 'en', 'uz')) === 'ру');
    delete ctx.Lampa.Storage;
    store.bs_tg_lang = JSON.stringify({ 1: 'en', 2: 'uz', 3: 'en' });
    /* настройки и ключи ИИ */
    const cb = (c, data) => { urls.length = 0; T._handle({ callback_query: { id: 'q', data, from: { id: +c }, message: { message_id: 50, chat: { id: +c } } } }); return urls.join(String.fromCharCode(10)); };
    t('настройки: «⚙️ Настройки» — профиль, язык, ИИ-ключи, у владельца ТВ и люди', /st:ai/.test(say('1', '/settings')) && /st:prof/.test(urls.join('')) && /mn:lang/.test(urls.join('')) && /st:people/.test(urls.join('')));
    t('настройки: у гостя нет «Люди»', !/st:people/.test(say('2', '/settings')) && /st:prof/.test(urls.join('')));
    t('настройки: ИИ-поиск — три сервиса и подсказка без подписки CUB', /st:k:groq/.test(cb('1', 'st:ai')) && /st:k:gemini/.test(urls.join('')) && /st:k:openrouter/.test(urls.join('')) && /No CUB subscription/.test(urls.join('')) && /editMessageText/.test(urls.join('')));
    t('настройки: экран сервиса — ссылка на сайт ключей и как прислать', /console\.groq\.com\/keys/.test(cb('2', 'st:k:groq')) && /gsk_/.test(urls.join('')));
    store.bs_ai_groq = 'gsk_test1234567890abcdefghijklmnopqrstuvwxyz';
    t('настройки: ключ показан только концом, есть «Удалить»', /…wxyz/.test(cb('1', 'st:k:groq')) && !/gsk_test1234/.test(urls.join('').replace('starts with gsk_', '')) && /st:d:groq/.test(urls.join('')));
    cb('1', 'st:d:groq');
    t('настройки: «Удалить ключ» — ключ убран', !store.bs_ai_groq);
    T._noteServerTime({ getResponseHeader: () => new Date(Date.now() - 10 * 60000).toUTCString() });
    t('часы ТВ спешат на 10 мин — время берём у Telegram', Math.abs(T._serverNow() - (Date.now() - 10 * 60000)) < 2000);
    T._noteServerTime({ getResponseHeader: () => new Date().toUTCString() });
    /* чистый чат */
    store.bs_tg_del = '[]';
    urls.length = 0; T._handle({ update_id: 2, message: { message_id: 77, chat: { id: 1, type: 'private' }, from: { first_name: 'X' }, text: '📋 Menu' } });
    t('чистый чат: «📋 Меню» человека ждёт ответа — в очереди, сразу не удаляется', !urls.some(u => /deleteMessage/.test(u) && /message_id=77/.test(u)) && JSON.parse(store.bs_tg_del).some(x => x.id === 77));
    store.bs_tg_del = '[]';
    ctx.Lampa.Reguest = function () { this.silent = function () {}; this.clear = function () {}; }; ctx.Lampa.TMDB = { api: u => u, key: () => 'k' };
    urls.length = 0; T._handle({ update_id: 3, message: { message_id: 78, chat: { id: 1, type: 'private' }, from: { first_name: 'X' }, text: 'Sintel' } });
    t('чистый чат: поиск (название фильма) не удаляется', !urls.some(u => /deleteMessage/.test(u) && /message_id=78/.test(u)));
    T._as('1', () => T._tmp(60000, () => T._sent({ message_id: 90 })));
    T._as('1', () => T._sent({ message_id: 91 }));
    const q = JSON.parse(store.bs_tg_del);
    t('чистый чат: служебный ответ — в очередь на удаление, обычный — нет', q.some(x => x.id === 90 && x.c === '1') && !q.some(x => x.id === 91));
    urls.length = 0; T._as('1', () => T._tmp(60000, () => T._sent({ message_id: 92 })));
    t('чистый чат: новое служебное — прежнее служебное удалено сразу', urls.some(u => /deleteMessage/.test(u) && /message_id=90/.test(u)) &&
        JSON.parse(store.bs_tg_del).map(x => x.id).join() === '92');
    store.bs_tg_del = JSON.stringify([{ c: '1', id: 95, at: Date.now() }]); urls.length = 0;
    T._as('1', () => T._tmp(60000, () => T._sent({ message_id: 94 })));
    t('чистый чат: пришедшее позже, но более раннее сообщение не удаляет новое', !urls.some(u => /deleteMessage/.test(u) && /message_id=95/.test(u)));
    T._onBus({ t: 'lang', from: 'tv2', id: '5', l: 'en', at: 2000 }); T._onBus({ t: 'langs', from: 'tv3', map: { 5: 'uz' }, at: { 5: 1000 } });
    t('язык по каналу: более свежий выбор побеждает старый', JSON.parse(store.bs_tg_lang)['5'] === 'en');
    T._onBus({ t: 'lang', from: 'tv2', id: '5', l: 'uz', at: 3000 });
    t('язык по каналу: новый выбор применяется', JSON.parse(store.bs_tg_lang)['5'] === 'uz');
    const q2 = JSON.parse(store.bs_tg_del); q2.forEach(x => { x.at = 0; }); store.bs_tg_del = JSON.stringify(q2); urls.length = 0; T._delTick();
    t('чистый чат: по времени не удаляется, старше 48 ч — просто забываем', !urls.some(u => /deleteMessage/.test(u)) && JSON.parse(store.bs_tg_del).length === 0);
}

/* ---- bstg.js: Bot API — POST, «слишком часто» (429), уведомления не теряются, чужие не съедают лимит ---- */
{
    const store = { bs_tg_chat: '1', bs_tg_token: '123456789:' + 'AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw', bs_tv_id: 'tvA', bs_tg_lang: JSON.stringify({ 1: 'ru' }) };
    const xs = [], timers = [];
    function X() { const x = this; x.h = {}; x.open = (m, u) => { x.m = m; x.u = u; }; x.setRequestHeader = (k, v) => { x.h[k] = v; }; x.send = b => { x.b = b; xs.push(x); }; x.getResponseHeader = () => ''; }
    const ctx = { console: { log() {} }, Date, Math, JSON, String, Object, Array, parseInt, setInterval: () => 0, XMLHttpRequest: X, Uint8Array,
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
        btoa: s => Buffer.from(s, 'binary').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('binary'), unescape, escape, encodeURIComponent, decodeURIComponent,
        Lampa: { Noty: { show() {} } } };
    let rnd = 0;
    const wc = require('crypto').webcrypto;
    ctx.window = ctx; ctx.crypto = { getRandomValues: a => { rnd++; return wc.getRandomValues(a); } };
    ctx.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
    vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(SRC, 'bstg.js'), 'utf8') + ';this.M=BSTelegram;', ctx);
    const T = ctx.M;
    const tg = () => xs.filter(x => /api\.telegram\.org/.test(x.u));
    const answer = (x, status, j) => { x.status = status; x.responseText = JSON.stringify(j); x.onload(); };
    const runTimers = () => { const l = timers.splice(0); l.forEach(t => t.fn()); return l; };
    // POST: всё в теле, адрес короткий — длинный текст не даёт 414
    let okV = null, failV = null;
    xs.length = 0; T._call('sendMessage', { chat_id: 1, text: 'я'.repeat(3000) }, v => { okV = v; }, e => { failV = e; });
    let x0 = tg()[0];
    t('Bot API: POST, параметры в теле, а не в адресе', x0.m === 'POST' && /\/sendMessage$/.test(x0.u) && x0.h['Content-Type'] === 'application/x-www-form-urlencoded' &&
        /^chat_id=1&text=%D1%8F/.test(x0.b) && decodeURIComponent(x0.b).length > 3000);
    // 429: один повтор через retry_after, второй 429 — ошибка
    timers.length = 0;
    answer(x0, 429, { ok: false, error_code: 429, description: 'Too Many Requests: retry after 5', parameters: { retry_after: 5 } });
    t('Bot API: 429 — ошибку не отдаём, повтор через retry_after', failV === null && timers.length === 1 && timers[0].ms === 5000);
    runTimers();
    const x1 = tg()[1];
    t('Bot API: повтор — тот же запрос', x1 && x1 !== x0 && x1.b === x0.b && /\/sendMessage$/.test(x1.u));
    answer(x1, 429, { ok: false, error_code: 429, description: 'Too Many Requests: retry after 5', parameters: { retry_after: 5 } });
    t('Bot API: снова 429 — ошибка, больше не повторяем', /Too Many/.test(failV) && timers.length === 0 && okV === null);
    failV = null; xs.length = 0; T._call('sendMessage', { chat_id: 1, text: 'x' }, v => { okV = v; }, e => { failV = e; });
    answer(tg()[0], 429, { ok: false, error_code: 429, parameters: { retry_after: 3600 } });
    t('Bot API: долгий retry_after — ждём не больше 60 с', timers.length === 1 && timers[0].ms === 60000);
    runTimers(); answer(tg()[1], 200, { ok: true, result: { message_id: 3 } });
    t('Bot API: повтор удался — ответ как обычно', okV && okV.message_id === 3 && failV === null);
    xs.length = 0; T._call('sendMessage', { chat_id: 1, text: 'x' }, null, e => { failV = e; });
    answer(tg()[0], 400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' });
    t('Bot API: другая ошибка — сразу, без повтора', /chat not found/.test(failV) && timers.length === 0);

    // новая серия: не ушло — серия не «увидена», следующая проверка пришлёт снова; ушло — увидена
    const today = new Date().toISOString().slice(0, 10), reqs = [];
    ctx.Lampa.TMDB = { api: u => u, key: () => 'k' };
    ctx.Lampa.Reguest = function () { this.silent = (u, ok) => reqs.push(ok); };
    const bells = []; ctx.Lampa.Notice = { pushNotice: (c, el) => bells.push(el) };
    store.bs_subs = JSON.stringify([{ id: 7, name: 'Сериал', source: 'tmdb' }]);
    store.bs_tg_seen = JSON.stringify({ 7: { s: 1, e: 1, at: 0, name: 'Сериал' } });
    const show = { id: 7, name: 'Сериал', last_episode_to_air: { season_number: 1, episode_number: 2, air_date: today } };
    xs.length = 0; T._check(true); reqs.shift()(show);
    answer(tg().filter(x => /sendMessage$/.test(x.u))[0], 400, { ok: false, description: 'network' });
    runTimers();
    t('новая серия: сообщение не ушло — серия не отмечена увиденной', JSON.parse(store.bs_tg_seen)['7'].e === 1);
    xs.length = 0; T._check(true); reqs.shift()(show);
    const sm = tg().filter(x => /sendMessage$/.test(x.u));
    t('новая серия: следующая проверка присылает её снова', sm.length === 1 && /1%2C%20%D1%81%D0%B5%D1%80%D0%B8%D1%8F%202/.test(sm[0].b));
    answer(sm[0], 200, { ok: true, result: { message_id: 10 } });
    runTimers();
    t('новая серия: ушло — отмечена, больше не пришлём', JSON.parse(store.bs_tg_seen)['7'].e === 2 && JSON.parse(store.bs_tg_seen)['7'].s === 1);
    t('новая серия: и в колокольчик Lampa на ТВ — один раз, хотя бот присылал дважды', bells.length === 1 && bells[0].id === 'bs_ep:7:1:2' && bells[0].text === 'Вышла новая серия: сезон 1, серия 2' && bells[0].title === 'Сериал');
    delete ctx.Lampa.Notice;

    // «Напомнить завтра»: два напоминания одному чату — с паузой; не ушло — возвращается в список
    delete store.bs_subs; store.bs_tg_seen = '{}'; store.bs_tg_week = 'x';
    store.bs_tg_later = JSON.stringify([{ id: 11, name: 'Первый', at: 1 }, { id: 12, name: 'Второй', at: 2 }]);
    xs.length = 0; timers.length = 0; T._remind();
    t('напоминания: сразу уходит только первое, второе — через ≥1,1 с', tg().length === 1 && timers.length === 1 && timers[0].ms >= 1100 && store.bs_tg_later === '[]');
    answer(tg()[0], 429, { ok: false, error_code: 429, parameters: { retry_after: 1 } });
    timers.splice(0).forEach(tm => (tm.ms === 1000 ? (tm.fn(), answer(tg()[1], 429, { ok: false, error_code: 429, parameters: { retry_after: 1 } })) : timers.push(tm)));
    t('напоминания: не ушло (429 дважды) — вернулось в «напомнить завтра»', JSON.parse(store.bs_tg_later).map(x => x.id).join() === '11');
    runTimers();
    t('напоминания: второе ушло после паузы', tg().length === 3 && /%D0%92%D1%82%D0%BE%D1%80%D0%BE%D0%B9/.test(tg()[2].b));

    // чужой чат: подсказка не чаще раза в 10 минут
    const say = (c, text) => { xs.length = 0; T._handle({ update_id: 1, message: { chat: { id: +c, type: 'private' }, from: { first_name: 'X', language_code: 'ru' }, text } }); return tg().length; };
    t('чужой чат: первое сообщение — подсказка про QR', say('66', 'привет') === 1);
    t('чужой чат: следом ещё — молчим (лимит Telegram не тратим)', say('66', 'привет') === 0 && say('66', 'эй') === 0);
    t('чужой чат: другому чужому — отвечаем', say('67', 'привет') === 1);

    // переименование с другого ТВ: имя без разметки, как остальные имена
    T._onBus({ t: 'rename', from: 'tvB', to: 'tvA', title: '<b>Зал</b> "1"' });
    t('переименование: имя ТВ — без символов разметки', store.bs_tv_name === 'bЗал/b 1');
    T._onBus({ t: 'rename', from: 'tvB', to: 'tvA', title: '<>' });
    t('переименование: пустое после чистки — не меняем', store.bs_tv_name === 'bЗал/b 1');

    // код второго ТВ и тема QR — из crypto.getRandomValues
    rnd = 0;
    const code = T._joinCode(), topic = T._randomTopic();
    t('код второго ТВ и тема QR — из crypto.getRandomValues', rnd >= 2 && /^[2-9A-HJKMNP-Z]{12}$/.test(code) && /\d/.test(code) && /[A-Z]/.test(code) && T._joinFrom(T._joinShow(code)) === code && /^lampa-[a-z2-9]{16}$/.test(topic));
    const codes = []; for (let i = 0; i < 300; i++) codes.push(T._joinCode());
    t('код второго ТВ: все знаки алфавита встречаются, без 0, 1, I, L, O', new Set(codes.join('')).size === 31 && !/[01ILO]/.test(codes.join('')) && new Set(codes).size === 300);

    // TMDB: указан источник данных в «Помощи» на всех языках
    const helpIn = c => { let r; T._as(c, () => { r = T._help(); }); return r; };
    store.bs_tg_lang = JSON.stringify({ 1: 'ru', 2: 'en', 3: 'uz' });
    store.bs_tg_users = JSON.stringify({ 2: { name: 'A', want: [], subs: [] }, 3: { name: 'B', want: [], subs: [] } });
    t('помощь: про TMDB — на трёх языках', /не одобрен и не сертифицирован TMDB/.test(helpIn('1')) && /not endorsed or certified by TMDB/.test(helpIn('2')) && /tasdiqlanmagan yoki sertifikatlanmagan/.test(helpIn('3')));
    t('настройки: в «Проект» — строка про TMDB', /не одобрен и не сертифицирован TMDB/.test(fs.readFileSync(path.join(SRC, 'loader.js'), 'utf8')));
}

/* ---- служба Tizen (src/service/service.js) и bstg.js через неё: настоящий HTTP на 127.0.0.1, внешние службы — свои ---- */
async function serviceTests() {
    const http = require('http'), os = require('os'), nodeCrypto = require('crypto');
    const TOKEN = '123456789:' + 'AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw', TG_DATE = 'Wed, 01 Jan 2025 00:00:00 GMT';
    const KEYS = { og: 'gsk_OWNERgroq1234567890abcdefghijklmn', gg: 'gsk_GUESTgroq1234567890abcdefghijklmn', om: 'AIzaOWNERgemini1234567890abcdefghijk', gm: 'AIzaGUESTgemini1234567890abcdefghijk', oo: 'sk-or-OWNERrouter1234567890abcdefghij' };
    const secretsAll = [TOKEN].concat(Object.keys(KEYS).map(k => KEYS[k]));
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const until = async (fn, ms) => { const end = Date.now() + (ms || 5000); while (Date.now() < end) { if (fn()) return true; await sleep(20); } return !!fn(); };
    // внешние службы: Telegram, ntfy, Groq, Gemini, OpenRouter — записываем, что пришло
    const seen = [], ntfy = [];
    let updates = [], tgBody = null;
    const up = http.createServer((req, res) => {
        const parts = []; req.on('data', d => parts.push(d)); req.on('end', () => {
            const body = Buffer.concat(parts), rec = { m: req.method, u: req.url, h: req.headers, b: body.toString() };
            seen.push(rec);
            const send = (code, obj, h) => { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, h || {})); res.end(typeof obj === 'string' ? obj : JSON.stringify(obj)); };
            let m;
            if ((m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url))) {
                if (m[1] !== TOKEN) return send(401, { ok: false, description: 'Unauthorized' });
                if (m[2] === 'getUpdates') { const to = /timeout=(\d+)/.exec(rec.b); return setTimeout(() => send(200, { ok: true, result: updates }, { Date: TG_DATE }), to && +to[1] ? 300 : 0); }
                tgBody = rec.b;
                return send(200, { ok: true, result: { message_id: 7 } }, { Date: TG_DATE });
            }
            if (req.url === '/file/bot' + TOKEN + '/photos/a.jpg') { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(Buffer.from([1, 2, 3, 255])); }
            if (/^\/ntfy\/lampa-join-/.test(req.url)) { ntfy.push(rec); return send(200, { id: 'x' }); }
            if (/^\/ntfy\//.test(req.url)) return send(200, '');
            if (/^\/groq\/models/.test(req.url)) return send(200, { data: [{ id: 'llama-3.3-70b-versatile' }] });
            if (/^\/groq\/chat\/completions/.test(req.url) || /^\/or\/chat\/completions/.test(req.url)) return send(200, { choices: [{ message: { content: '{"title":"Марсианин","original_title":"The Martian","year":2015}' } }] });
            if (/^\/or\/key/.test(req.url)) return send(200, { data: {} });
            if (/^\/gemini\/models\/\?pageSize/.test(req.url)) return send(200, { models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] });
            if (/^\/gemini\/models\/[\w.-]+:generateContent/.test(req.url)) return send(200, { candidates: [{ content: { parts: [{ text: '{"title":"Марсианин"}' }] } }] });
            send(404, {});
        });
    });
    await new Promise(r => up.listen(0, '127.0.0.1', r));
    const UPB = 'http://127.0.0.1:' + up.address().port;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lampa-svc-'));
    global.tizen = { application: { getCurrentApplication: () => ({ appInfo: { packageId: '0SG81L944p', id: '0SG81L944p.Lampa' } }) } };
    const SV = require(path.join(SRC, 'service', 'service.js'));
    const SVP = 18897 + Math.floor(Math.random() * 500);
    const svcCfg = { port: SVP, dir, log: false, up: { tg: UPB + '/', ntfy: UPB + '/ntfy/', groq: UPB + '/groq/', gemini: UPB + '/gemini/', openrouter: UPB + '/or/' } };
    SV._test.config(svcCfg);
    await new Promise(r => SV._test.start(r));
    t('служба: в config.xml — tizen:service и web.service, файл службы на месте', (c => /<tizen:service id="0SG81L944p\.LampaService" on-boot="true" auto-restart="true">/.test(c) &&
        /<tizen:content src="service\/service\.js"\/>/.test(c) && /http:\/\/tizen\.org\/feature\/web\.service/.test(c) && /privilege\/application\.launch/.test(c))(fs.readFileSync(path.join(SRC, 'config.xml'), 'utf8')));
    t('служба: в update.js её нет — приходит только с пакетом', !/service\.js/.test(fs.readFileSync(path.join(SRC, 'update.js'), 'utf8')));
    // запрос к службе
    const bodies = [];
    const ask = (method, p, body, headers) => new Promise(res => {
        const b = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
        const kh = SV._test.key() ? { 'X-Lampa-Key': SV._test.key() } : {};       // ключ доступа — как у страницы (null — без него)
        const r = http.request({ host: '127.0.0.1', port: SVP, agent: false, method, path: p, headers: Object.assign(b ? { 'Content-Length': b.length } : {}, kh, headers || {}) }, x => {
            const parts = []; x.on('data', d => parts.push(d)); x.on('end', () => { const raw = Buffer.concat(parts), s = raw.toString(); bodies.push(s); let j = null; try { j = JSON.parse(s); } catch (e) {} res({ st: x.statusCode, h: x.headers, s, j, raw }); });
        });
        r.on('error', e => res({ st: 0, e })); r.end(b || undefined);
    });
    let r = await ask('GET', '/health');
    t('служба /health: ok, версия, Node, секретов нет, файл секретов в порядке', r.st === 200 && r.j.ok && r.j.v === 4 && r.j.auth === true && r.j.store === 'ok' && /^v\d+/.test(r.j.node) && r.j.has.tg === false && r.j.has.ai.length === 0 && r.h['access-control-allow-origin'] === '*');
    // ключ доступа: в svc.key папки данных (страница читает его как wgt-private/svc.key), без ключа — только /health
    const KEY = SV._test.key();
    t('ключ доступа: 32 байта hex, в svc.key папки данных', /^[0-9a-f]{64}$/.test(KEY) && fs.readFileSync(path.join(dir, 'svc.key'), 'utf8') === KEY);
    r = await ask('GET', '/health', undefined, { 'X-Lampa-Key': '' });
    t('ключ доступа: /health без ключа — только ok, версия и store (ни секретов, ни has, ни launched)', r.st === 200 && r.j.ok && r.j.auth === false && r.j.store === 'ok' && !('has' in r.j) && !('launched' in r.j) && !('node' in r.j));
    t('ключ доступа: без ключа или с чужим — 401 на всё, кроме /health', (await ask('POST', '/secret', { name: 'tg', value: 'x' }, { 'X-Lampa-Key': '' })).st === 401 &&
        (await ask('POST', '/forget', {}, { 'X-Lampa-Key': 'a'.repeat(64) })).st === 401 && (await ask('GET', '/pending', undefined, { 'X-Lampa-Key': KEY.slice(0, 63) + (KEY[63] === 'a' ? 'b' : 'a') })).st === 401 &&
        (await ask('POST', '/tg/sendMessage', 'chat_id=1', { 'X-Lampa-Key': '' })).j.error === 'key');
    r = await ask('POST', '/tg/sendMessage', 'chat_id=1&text=x', { 'Content-Type': 'application/x-www-form-urlencoded' });
    t('служба /tg: токена нет — 503', r.st === 503 && r.j.ok === false);
    r = await ask('POST', '/secret', { name: 'tg', value: ' ' + TOKEN + '\n' });
    t('служба /secret: токен сохранён (пробелы убраны), в ответе его нет', r.st === 200 && r.j.ok && r.j.has.tg === true && r.s.indexOf(TOKEN) < 0);
    t('служба: токен в файле папки данных', JSON.parse(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8')).tg === TOKEN && !fs.existsSync(path.join(dir, 'secrets.json.tmp')));
    t('служба /secret: чужое имя — 400', (await ask('POST', '/secret', { name: 'bs_tg_token', value: 'x' })).st === 400 && (await ask('POST', '/secret', { name: 'aiu.groq.abc', value: 'x' })).st === 400);
    t('служба /secret: тело больше 16 КБ — 413', (await ask('POST', '/secret', { name: 'tg', value: 'x'.repeat(20000) })).st === 413);
    await ask('POST', '/secret', { name: 'ai.groq', value: KEYS.og }); await ask('POST', '/secret', { name: 'aiu.groq.2', value: KEYS.gg });
    await ask('POST', '/secret', { name: 'ai.gemini', value: KEYS.om }); await ask('POST', '/secret', { name: 'aiu.gemini.-100', value: KEYS.gm });
    r = await ask('GET', '/health');
    t('служба /health: какие ключи есть — без самих ключей', r.j.has.tg && r.j.has.ai.join() === 'groq,gemini' && r.j.has.aiu.groq.join() === '2' && r.j.has.aiu.gemini.join() === '-100' && !secretsAll.some(s => r.s.indexOf(s) >= 0));
    // Telegram
    r = await ask('POST', '/tg/sendMessage', 'chat_id=1&text=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82', { 'Content-Type': 'application/x-www-form-urlencoded' });
    let last = seen[seen.length - 1];
    t('служба /tg: POST на bot<токен>/метод, тело как есть', last.u === '/bot' + TOKEN + '/sendMessage' && last.m === 'POST' && last.b === 'chat_id=1&text=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82' && /x-www-form-urlencoded/.test(last.h['content-type']));
    t('служба /tg: ответ Telegram как есть, Date — его, виден странице', r.st === 200 && r.j.ok && r.j.result.message_id === 7 && r.h.date === TG_DATE && /Date/.test(r.h['access-control-expose-headers']));
    r = await ask('POST', '/tg/sendMessage', 'x=' + 'a'.repeat(1100 * 1024), { 'Content-Type': 'application/x-www-form-urlencoded' });
    t('служба /tg: тело больше 1 МБ — 413, к Telegram не ушло', r.st === 413 && seen[seen.length - 1] === last);
    const ifs = { wlan0: [{ family: 'IPv4', address: '192.168.1.40', internal: false }], p2p0: [{ family: 'IPv4', address: '192.168.49.1', internal: false }],
        lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }], eth0: [{ family: 'IPv4', address: '169.254.3.3', internal: false }], tun0: [{ family: 4, address: '10.8.0.2', internal: false }] };
    t('lanIp: адрес Wi-Fi/Ethernet — первым; Wi-Fi Direct (192.168.49/24), 169.254/16 и внутренние — мимо', SV._test.lanIp(ifs) === '192.168.1.40' &&
        SV._test.lanIp({ p2p0: ifs.p2p0, tun0: ifs.tun0 }) === '10.8.0.2' && SV._test.lanIp({ tun0: ifs.tun0, eth1: [{ family: 'IPv4', address: '192.168.0.7', internal: false }] }) === '192.168.0.7' &&
        SV._test.lanIp({ p2p0: ifs.p2p0, eth0: ifs.eth0, lo: ifs.lo }) === '');
    t('ответ на кнопку: обрезка до 200 знаков, без половинки эмодзи', SV._test.cut('a'.repeat(300), 200).length === 200 && SV._test.cut('a'.repeat(199) + '😀', 200) === 'a'.repeat(199) && SV._test.cut('ok', 200) === 'ok');
    const nSeen = seen.length, blocked = [];
    for (const bm of ['setWebhook', 'deleteWebhook', 'logOut', 'close', 'sendDocument', 'getMyCommands', 'Close']) blocked.push((await ask('POST', '/tg/' + bm, 'url=https%3A%2F%2Fevil.example', { 'Content-Type': 'application/x-www-form-urlencoded' })).st);
    t('служба /tg: setWebhook, deleteWebhook, logOut, close и другие не из списка — 403, к Telegram не ушло', blocked.every(x => x === 403) && seen.length === nSeen);
    const usedM = new Set(Array.from(fs.readFileSync(path.join(SRC, 'bstg.js'), 'utf8').matchAll(/\bcall\('([A-Za-z]+)'/g), x => x[1]));
    const svcM = new Set(Array.from(fs.readFileSync(path.join(SRC, 'service', 'service.js'), 'utf8').matchAll(/tgSend\('([A-Za-z]+)'/g), x => x[1]));
    t('служба /tg: список разрешённых — все методы, которые зовёт bstg.js (и сама служба), и ни одного опасного', usedM.size >= 15 && [...usedM, ...svcM].every(x => SV._test.TG_METHODS.indexOf(x) >= 0) &&
        !['setWebhook', 'deleteWebhook', 'logOut', 'close'].some(x => SV._test.TG_METHODS.indexOf(x) >= 0));
    updates = [{ update_id: 5, message: { message_id: 3, chat: { id: 1, type: 'private' }, text: 'abcd-2345-efgh', date: 1 } }];
    const t0 = Date.now();
    r = await ask('POST', '/tg/getUpdates', 'offset=1&timeout=50', { 'Content-Type': 'application/x-www-form-urlencoded' });
    last = seen[seen.length - 1];
    t('служба /tg getUpdates: длинный опрос дожидается ответа, ожидание не больше 35 с', r.st === 200 && r.j.result.length === 1 && Date.now() - t0 >= 250 && last.b === 'offset=1&timeout=35');
    t('служба: код второго ТВ из сообщения запомнен (для /join)', SV._test.codes()['ABCD2345EFGH'] && SV._test.codes()['ABCD2345EFGH'].chat === '1' && Object.keys(SV._test.codes()).length === 1);
    updates = [];
    // ИИ: ключ — в заголовок, человека или владельца
    const aiReq = async (p, q, method, body, h) => { const n = seen.length; const x = await ask(method || 'GET', '/ai/' + p + q, body, h); return { r: x, up: seen.slice(n)[0] }; };
    let a = await aiReq('groq', '/models');
    t('служба /ai Groq: ключ владельца — Authorization: Bearer', a.r.st === 200 && a.up.u === '/groq/models' && a.up.h.authorization === 'Bearer ' + KEYS.og && !a.up.h['x-goog-api-key']);
    a = await aiReq('groq', '/models?chat=2');
    t('служба /ai Groq: ?chat — ключ человека, chat наружу не уходит', a.up.h.authorization === 'Bearer ' + KEYS.gg && a.up.u === '/groq/models');
    a = await aiReq('groq', '/models?chat=3');
    t('служба /ai: у человека своего ключа нет — ключ владельца', a.up.h.authorization === 'Bearer ' + KEYS.og);
    a = await aiReq('gemini', '/models/gemini-2.5-flash:generateContent?chat=-100', 'POST', '{"contents":[]}', { 'Content-Type': 'application/json' });
    t('служба /ai Gemini: x-goog-api-key, путь и тело как есть', a.r.st === 200 && a.up.u === '/gemini/models/gemini-2.5-flash:generateContent' && a.up.h['x-goog-api-key'] === KEYS.gm && !a.up.h.authorization && a.up.b === '{"contents":[]}');
    a = await aiReq('gemini', '/models/?pageSize=200&chat=2');
    t('служба /ai Gemini: параметры адреса — дальше (кроме chat)', a.up.u === '/gemini/models/?pageSize=200' && a.up.h['x-goog-api-key'] === KEYS.om);
    a = await aiReq('openrouter', '/key');
    t('служба /ai: ключа нет — 503, наружу не ходим', a.r.st === 503 && !a.up);
    await ask('POST', '/secret', { name: 'ai.openrouter', value: KEYS.oo });
    a = await aiReq('openrouter', '/chat/completions', 'POST', '{}', { 'Content-Type': 'application/json', 'X-Title': 'Lampa TV' });
    t('служба /ai OpenRouter: Bearer и X-Title', a.up.h.authorization === 'Bearer ' + KEYS.oo && a.up.h['x-title'] === 'Lampa TV');
    r = await ask('GET', '/tgfile/photos/a.jpg');
    t('служба /tgfile: картинка из Telegram байт в байт', r.st === 200 && r.raw.length === 4 && r.raw[3] === 255);
    t('служба: путь с .. — нет', (await ask('GET', '/tgfile/../secrets.json')).st === 404);
    // откуда можно
    t('служба: сайт из браузера (чужой Origin) — 403', (await ask('GET', '/health', undefined, { Origin: 'https://evil.example' })).st === 403 &&
        (await ask('POST', '/secret', { name: 'tg', value: 'x' }, { Origin: 'http://192.168.1.5' })).st === 403);
    t('служба: страница пакета (file://, app://, null с ключом) — можно', (await ask('GET', '/health', undefined, { Origin: 'file://' })).st === 200 && (await ask('GET', '/health', undefined, { Origin: 'null' })).st === 200 &&
        (await ask('GET', '/health', undefined, { Origin: 'app://0SG81L944p.Lampa' })).st === 200);
    t('служба: Origin null без ключа (песочница любого сайта) — 403; предзапрос CORS — можно', (await ask('GET', '/health', undefined, { Origin: 'null', 'X-Lampa-Key': '' })).st === 403 &&
        (await ask('POST', '/forget', {}, { Origin: 'null', 'X-Lampa-Key': '' })).st === 403 && (await ask('OPTIONS', '/forget', undefined, { Origin: 'null', 'X-Lampa-Key': '' })).st === 204);
    t('служба: чужое имя в Host (DNS rebinding) — 403', (await ask('GET', '/health', undefined, { Host: 'evil.example:' + SVP })).st === 403);
    r = await ask('OPTIONS', '/ai/groq/models', undefined, { Origin: 'file://', 'Access-Control-Request-Method': 'POST' });
    t('служба: предзапрос CORS — 204 с разрешениями', r.st === 204 && r.h['access-control-allow-origin'] === '*' && /POST/.test(r.h['access-control-allow-methods']) && /Content-Type/.test(r.h['access-control-allow-headers']) && /X-Lampa-Key/.test(r.h['access-control-allow-headers']));
    // выведенное из токена — как у страницы (bstg.js без службы, токен в localStorage)
    const page = (store, XHR, extra, full) => {
        const ctx = Object.assign({ console: { log() {} }, Date, Math, JSON, String, Object, Array, parseInt, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, XMLHttpRequest: XHR || function () { this.open = () => {}; this.send = () => {}; this.setRequestHeader = () => {}; },
            Uint8Array, ArrayBuffer, btoa: s => Buffer.from(s, 'binary').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('binary'), unescape, escape, encodeURIComponent, decodeURIComponent,
            Lampa: { Noty: { show() {} } }, BS_TEST_HOOKS: true }, extra || {});
        ctx.window = ctx; ctx.crypto = nodeCrypto.webcrypto;
        // full — ключи, которые не записываются (localStorage полон: QuotaExceededError)
        ctx.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { if (full && full.indexOf(k) >= 0) throw new Error('QuotaExceededError'); store[k] = String(v); }, removeItem: k => { delete store[k]; } };
        vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(SRC, 'bstg.js'), 'utf8') + ';this.M=BSTelegram;', ctx);
        return ctx.M;
    };
    const legacy = page({ bs_tg_token: TOKEN, bs_tg_chat: '1', bs_tg_invite_salt: 'abc123' });
    const hex = b => Array.prototype.map.call(b, x => ('0' + x.toString(16)).slice(-2)).join('');
    r = await ask('POST', '/derive', { salt: 'abc123' });
    t('служба /derive: тема и ключ канала, код приглашения — байт в байт как у страницы', r.st === 200 && r.j.topic === legacy._busTopic() && r.j.key === hex(legacy._busKey()) && r.j.invite === legacy._inviteCode() && r.s.indexOf(TOKEN) < 0);
    t('служба /derive: соль не та — 400', (await ask('POST', '/derive', { salt: 'A-B' })).st === 400);
    // /join: только код, пришедший боту из этого чата
    t('служба /join: код не приходил — 403', (await ask('POST', '/join', { code: 'K2M3N4P5Q6R7', chat: '1' })).st === 403);
    t('служба /join: прежний код из 8 цифр — 403', (await ask('POST', '/join', { code: '12345678', chat: '1' })).st === 403);
    t('служба /join: код пришёл из другого чата — 403', (await ask('POST', '/join', { code: 'ABCD2345EFGH', chat: '2' })).st === 403 && !ntfy.length);
    t('служба: тема и ключ кода — байт в байт как у страницы (PBKDF2)', SV._test.joinKeys('ABCD2345EFGH').topic === legacy._joinTopic('ABCD2345EFGH') &&
        SV._test.joinKeys('ABCD2345EFGH').key.toString('hex') === hex(legacy._joinKeys('ABCD2345EFGH').key) && SV._test.joinFrom('abcd 2345-efgh') === 'ABCD2345EFGH' && SV._test.joinFrom('1234 5678') === '');
    r = await ask('POST', '/join', { code: 'abcd-2345-efgh', chat: '1', ts: 5 });
    const jm = ntfy[0] && legacy._joinMsg(JSON.stringify({ event: 'message', id: 'n1', message: ntfy[0].b }), { code: 'ABCD2345EFGH' });
    t('служба /join: в тему нового ТВ — токен и чат, зашифровано кодом (страница расшифровывает)', r.st === 200 && r.j.ok && ntfy.length === 1 && ntfy[0].u === '/ntfy/' + legacy._joinTopic('ABCD2345EFGH') &&
        jm && jm.token === TOKEN && jm.chat === '1' && ntfy[0].b.indexOf(TOKEN) < 0 && r.s.indexOf(TOKEN) < 0);
    t('служба /join: код — на одно подключение', (await ask('POST', '/join', { code: 'ABCD2345EFGH', chat: '1' })).st === 403);
    {
        // 6 цифр (v4): X25519 службы = страницы, подключение службы открывает новый ТВ (страница)
        const sk = legacy._crypt.rnd(32), pk = legacy._crypt.x25519(sk, legacy._join4.BASE9), pkB = legacy._crypt.b64(pk);
        t('служба: X25519 и тема 6 цифр — байт в байт как у страницы', hex(SV._test.x25519(Buffer.from(sk), legacy._join4.BASE9)) === hex(pk) && SV._test.join4Topic('481527') === legacy._join4.topic('481527') &&
            SV._test.joinFrom('481 527') === '481527' && legacy._joinFrom('481-527') === '481527' && legacy._joinFrom('48152') === '' && legacy._joinFrom('4815270') === '');
        const hl = [JSON.stringify({ event: 'message', id: 'a', message: JSON.stringify({ t: 'hi4', pk: pkB }) }), JSON.stringify({ event: 'message', id: 'b', message: JSON.stringify({ t: 'hi4', pk: 'bad' }) })].join('\n');
        t('служба: ключи из темы — как у страницы (плохие мимо)', SV._test.join4Hellos([hl]).join() === pkB && legacy._join4.hellos([hl]).join() === pkB);
        const bx = SV._test.join4Box('481527', pkB, JSON.stringify({ t: 'join', token: TOKEN, chat: '1' }));
        t('служба: подключение по 6 цифрам открывает только новый ТВ', JSON.parse(legacy._join4.open({ code: '481527', sk, pk }, bx)).token === TOKEN && JSON.stringify(bx).indexOf(TOKEN) < 0);
        SV._test.codes()['481527'] = { chat: '1', at: 9e15 };               // как будто цифры пришли боту из чата 1
        const n0 = ntfy.length;
        r = await ask('POST', '/join', { code: '481 527', chat: '1' });
        t('служба /join: 6 цифр, а ТВ с таким кодом в теме нет — 404, ничего не опубликовано', r.st === 404 && ntfy.length === n0);
    }
    // Node 4–6 (старые ТВ): url.URL нет — разбор через url.parse, всё то же
    const urlMod = require('url'), URLsaved = urlMod.URL;
    urlMod.URL = undefined; process.noDeprecation = true;           // url.parse в новом Node ругается — здесь так и надо
    try {
        a = await aiReq('groq', '/models?chat=2&x=1');
        t('служба на старом Node (url.parse): ?chat — ключ человека, остальное — дальше', a.up && a.up.h.authorization === 'Bearer ' + KEYS.gg && a.up.u === '/groq/models?x=1');
        r = await ask('POST', '/tg/sendMessage', 'chat_id=1', { 'Content-Type': 'application/x-www-form-urlencoded' });
        t('служба на старом Node (url.parse): /tg работает', r.st === 200 && seen[seen.length - 1].u === '/bot' + TOKEN + '/sendMessage');
    } finally { urlMod.URL = URLsaved; }
    // перезапуск: секреты из файла
    await new Promise(r2 => SV._test.stop(r2)); SV._test.config(svcCfg); await new Promise(r2 => SV._test.start(r2));
    r = await ask('GET', '/health');
    t('служба: после перезапуска секреты на месте (файл)', r.j.has.tg && r.j.has.ai.length === 3);
    t('служба: ни один ответ не содержит секрета', !bodies.some(b => secretsAll.some(s => b.indexOf(s) >= 0)));
    r = await ask('POST', '/forget', {});
    t('служба /forget: всё стёрто, и в файле', r.st === 200 && !r.j.has.tg && !r.j.has.ai.length && Object.keys(r.j.has.aiu).length === 0 && !secretsAll.some(s => fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8').indexOf(s) >= 0));

    /* bstg.js: XMLHttpRequest поверх настоящего HTTP — 127.0.0.1:8897 ведёт в тестовую службу, внешние адреса — в свои */
    const MAP = [['http://127.0.0.1:8897', 'http://127.0.0.1:' + SVP], ['https://api.telegram.org/', UPB + '/'], ['https://ntfy.sh/', UPB + '/ntfy/'],
        ['https://api.groq.com/openai/v1/', UPB + '/groq/'], ['https://generativelanguage.googleapis.com/v1beta/', UPB + '/gemini/'], ['https://openrouter.ai/api/v1/', UPB + '/or/']];
    function mkXHR(opt) {
        opt = opt || {};
        return function X() {
            const x = this; x.h = {};
            x.open = (m, u) => { x.m = m; x.url = u; };
            x.setRequestHeader = (k, v) => { x.h[k] = v; };
            x.getResponseHeader = k => (x.rh && x.rh[String(k).toLowerCase()]) || null;
            x.abort = () => { if (x.req) x.req.destroy(); };
            x.send = b => {
                (opt.log || []).push(x);
                let u = x.url; MAP.forEach(p => { if (u.indexOf(p[0]) === 0) u = p[1] + u.slice(p[0].length); });
                if (opt.svcDown && /^http:\/\/127\.0\.0\.1:8897/.test(x.url)) return setImmediate(() => x.onerror && x.onerror());
                if (/^https?:\/\/127\.0\.0\.1/.test(x.url) === false && u === x.url) return setImmediate(() => x.onerror && x.onerror());   // наружу — нельзя
                const body = b === null || b === undefined ? null : Buffer.from(String(b));
                const q = new URL(u);
                x.req = http.request({ host: q.hostname, port: q.port, agent: false, path: q.pathname + q.search, method: x.m, headers: Object.assign(body ? { 'Content-Length': body.length } : {}, x.h) }, res => {
                    const parts = []; res.on('data', d => parts.push(d)); res.on('end', () => {
                        const raw = Buffer.concat(parts);
                        x.status = res.statusCode; x.rh = res.headers; x.responseText = raw.toString();
                        x.response = x.responseType === 'arraybuffer' ? raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length) : x.responseText;
                        if (x.onload) x.onload();
                    });
                });
                x.req.on('error', () => { if (x.onerror) x.onerror(); });
                x.req.end(body || undefined);
            };
        };
    }
    const launches = [];
    const tizenFake = { application: { getCurrentApplication: () => ({ appInfo: { packageId: '0SG81L944p', version: '2.1.0' } }) },
        launchAppControl: (ac, id, ok) => { launches.push([ac.operation, id]); if (ok) ok(); } };
    tizenFake.ApplicationControl = function (op) { this.operation = op; };
    const lampaMem = { bs_tg_token: TOKEN };   // Lampa.Storage держит прочитанное в памяти (readed)
    // tizen.filesystem: 'wgt-private' — папка данных службы (keyDir); старый API — resolve + readAsText
    let keyDir = dir;
    const fsFake = { resolve: (p, ok, err) => { const f = path.join(keyDir, String(p).replace(/^wgt-private\//, '')); if (!/^wgt-private\//.test(p) || !fs.existsSync(f)) return setImmediate(() => err && err(new Error('NotFoundError')));
        setImmediate(() => ok({ readAsText: (cb, eb) => setImmediate(() => cb(fs.readFileSync(f, 'utf8'))) })); } };
    const tz = { tizen: { application: Object.assign(tizenFake.application, { launchAppControl: tizenFake.launchAppControl }), ApplicationControl: tizenFake.ApplicationControl, filesystem: fsFake },
        Lampa: { Storage: { set: (k, v) => { lampaMem[k] = v; }, get: k => lampaMem[k] || '' } } };
    // перенос: всё из localStorage — в службу, у страницы — только метки
    const store = { bs_tg_token: TOKEN, bs_tg_chat: '1', bs_tg_invite_salt: 'abc123', bs_tg_users: JSON.stringify({ 2: { name: 'Аня', at: 1, want: [], subs: [] } }),
        bs_ai_groq: KEYS.og, bs_ai_groq_u: JSON.stringify({ 2: KEYS.gg }), bs_gemini_key: KEYS.om, bs_gemini_keys: JSON.stringify({ 2: KEYS.gm }), bs_tv_id: 'tvA' };
    const xlog = [];
    const P = page(store, mkXHR({ log: xlog }), tz);
    const before = { topic: P._busTopic(), key: hex(P._busKey()), inv: P._inviteCode() };
    P._svcStart();
    const moved = await until(() => store.bs_tg_svc === '1' && !('bs_tg_token' in store) && !store.bs_ai_groq && !store.bs_gemini_key && store.bs_ai_groq_u === '{}' && store.bs_gemini_keys === '{}');
    t('перенос: служба запущена через launchAppControl (operation/service, 0SG81L944p.LampaService)', launches.length >= 1 && launches[0][0] === 'http://tizen.org/appcontrol/operation/service' && launches[0][1] === '0SG81L944p.LampaService');
    t('перенос: токен и ключи ушли в службу, в localStorage — только метки', moved && !secretsAll.some(s => JSON.stringify(store).indexOf(s) >= 0));
    t('перенос: копия токена в памяти Lampa.Storage тоже стёрта', lampaMem.bs_tg_token === '');
    r = await ask('GET', '/health');
    t('перенос: в службе — токен и все ключи (владельца и человека)', r.j.has.tg && r.j.has.ai.join() === 'groq,gemini' && r.j.has.aiu.groq.join() === '2' && r.j.has.aiu.gemini.join() === '2');
    const marks = JSON.parse(store.bs_ai_svc || '{}');
    t('перенос: метки ключей — FNV и 4 последних знака (кэши моделей не сбрасываются)', marks.groq.h === legacy._fnv(KEYS.og, 2166136261) && marks.groq.l === KEYS.og.slice(-4) && marks['gemini.2'].l === KEYS.gm.slice(-4));
    t('перенос: тема и ключ канала, код приглашения — те же, что от токена', P._busTopic() === before.topic && hex(P._busKey()) === before.key && P._inviteCode() === before.inv);
    // Telegram через службу: тело то же, часы — Telegram
    tgBody = null;
    let okm = null;
    P._call('sendMessage', { chat_id: '1', text: 'Привет' }, m => { okm = m; });
    await until(() => okm);
    t('через службу: sendMessage дошёл до Telegram с токеном службы, ответ разобран', okm && okm.message_id === 7 && tgBody === 'chat_id=1&text=' + encodeURIComponent('Привет') &&
        xlog.some(x => x.url === 'http://127.0.0.1:8897/tg/sendMessage'));
    t('через службу: часы — по Date от Telegram', Math.abs(P._serverNow() - Date.parse(TG_DATE)) < 5000);
    // ИИ через службу: гостю — его ключ, владельцу — свой
    const aiSeen = () => seen.filter(s => /^\/(groq|gemini|or)\//.test(s.u));
    let n0 = aiSeen().length, got = null;
    P._as('2', () => P._aiRun([{ text: 'x' }], (j, who) => { got = who; }, why => { got = 'fail ' + why; }));
    await until(() => got);
    let ai2 = aiSeen().slice(n0);
    t('через службу: ИИ человека — его ключ Groq (служба подставила), ключа в странице нет', /^Groq/.test(got) && ai2.length >= 1 && ai2.every(s => s.h.authorization === 'Bearer ' + KEYS.gg) &&
        xlog.some(x => /^http:\/\/127\.0\.0\.1:8897\/ai\/groq\/chat\/completions\?chat=2$/.test(x.url) && !x.h.Authorization));
    n0 = aiSeen().length; got = null;
    P._as('1', () => P._aiRun([{ text: 'x' }], (j, who) => { got = who; }, why => { got = 'fail ' + why; }));
    await until(() => got);
    t('через службу: ИИ владельца — ключ владельца', /^Groq/.test(got) && aiSeen().slice(n0).every(s => s.h.authorization === 'Bearer ' + KEYS.og));
    n0 = aiSeen().length; got = null;
    P._as('2', () => P._geminiRun([{ text: 'x' }], (j, id) => { got = id; }, why => { got = 'fail ' + why; }));
    await until(() => got);
    ai2 = aiSeen().slice(n0);
    t('через службу: Gemini человека — его ключ во всех запросах (список моделей и ответ)', got === 'gemini-2.5-flash' && ai2.length === 2 && ai2.every(s => s.h['x-goog-api-key'] === KEYS.gm));
    // ещё один ТВ: код пришёл из чата владельца — служба отправила токен в тему нового ТВ
    updates = [{ update_id: 9, message: { message_id: 4, chat: { id: 1, type: 'private' }, text: 'Z9Y8-X7W6-V5U4', date: Math.floor(Date.now() / 1000) } }];
    let ups = null; P._call('getUpdates', { offset: 1, timeout: 0 }, u => { ups = u; }); await until(() => ups); updates = [];
    ntfy.length = 0;
    P._handle(ups[0]);
    await until(() => ntfy.length);
    const jm2 = ntfy[0] && legacy._joinMsg(JSON.stringify({ event: 'message', id: 'n2', message: ntfy[0].b }), { code: 'Z9Y8X7W6V5U4' });
    t('через службу: «ещё один ТВ» — токен в тему нового ТВ отправила служба, страница его не видела', jm2 && jm2.token === TOKEN && jm2.chat === '1' && xlog.some(x => x.url === 'http://127.0.0.1:8897/join'));
    // удалить ключ в боте — и в службе
    P._as('1', () => P._setAiKey('groq', ''));
    await until(() => false, 300);
    r = await ask('GET', '/health');
    t('удалить ключ: метка снята, в службе ключа нет', !JSON.parse(store.bs_ai_svc).groq && r.j.has.ai.join() === 'gemini');
    // новый ключ при работающей службе — сразу в неё
    P._as('2', () => P._setAiKey('openrouter', KEYS.oo));
    await until(() => store.bs_ai_openrouter_u === '{}');
    r = await ask('GET', '/health');
    t('новый ключ: ушёл в службу, в localStorage его нет', store.bs_ai_openrouter_u === '{}' && r.j.has.aiu.openrouter.join() === '2' && JSON.parse(store.bs_ai_svc)['openrouter.2'].l === KEYS.oo.slice(-4));
    // служба потеряла токен (файл пропал) — метка снята, бот честно «не подключён»
    await ask('POST', '/secret', { name: 'tg', value: '' });
    P._svcCheck(); await until(() => !('bs_tg_svc' in store));
    t('служба без токена: метка снята', !('bs_tg_svc' in store) && P._busTopic() === '');
    // ... и на ТВ — понятное сообщение, а не молчаливое «не подключено» (один раз: метки больше нет)
    const notes = []; tz.Lampa.Noty = { show: x => notes.push(x) };
    store.bs_tg_svc = '1'; P._svcCheck(); await until(() => !('bs_tg_svc' in store));
    P._svcCheck(); await sleep(300);
    t('служба потеряла токен: на ТВ — «служба потеряла подключение — подключите бота заново», один раз', notes.filter(x => /служба потеряла подключение — подключите бота заново/.test(x)).length === 1);
    delete tz.Lampa.Noty;
    // ключ ИИ в службе, а у страницы метки нет (localStorage почистили) — служба его не теряет
    await ask('POST', '/secret', { name: 'ai.groq', value: KEYS.og });
    P._svcCheck(); await sleep(400);
    r = await ask('GET', '/health');
    t('svcSync: ключ в службе без метки у страницы — не стёрт (удаляем только по явной пометке)', r.j.has.ai.indexOf('groq') >= 0 && !('bs_ai_forget' in store));
    // удалили ключ, пока служба не отвечала: пометка bs_ai_forget — сотрём в службе, когда ответит
    const optF = { svcDown: true }, stF = { bs_tg_chat: '1', bs_ai_svc: JSON.stringify({ groq: { h: 'aaaabbbb', l: 'mnop' } }) };
    const PF = page(stF, mkXHR(optF), tz);
    PF._svcKey(SV._test.key()); PF._svc.wakeAt = Date.now();
    PF._as('1', () => PF._setAiKey('groq', ''));
    t('удалить ключ ИИ, служба не ответила: метка снята, «стереть в службе» запомнено (bs_ai_forget)', !JSON.parse(stF.bs_ai_svc || '{}').groq && JSON.parse(stF.bs_ai_forget || '[]').join() === 'groq');
    optF.svcDown = false; PF._svcCheck();
    await until(() => !('bs_ai_forget' in stF), 3000);
    r = await ask('GET', '/health');
    t('служба ответила — ключ стёрт и в ней, пометка снята', r.j.has.ai.indexOf('groq') < 0 && !('bs_ai_forget' in stF));
    // задали ключ снова раньше, чем служба ответила, — прежнее «удалить» не применяется
    stF.bs_ai_forget = JSON.stringify(['gemini']); stF.bs_gemini_key = KEYS.om;
    PF._svcSync({ tg: false, ai: ['gemini'], aiu: {} });
    t('svcSync: ключ задан снова — пометка «удалить» снята, в службе не стираем', !('bs_ai_forget' in stF));

    // старый пакет без службы: launchAppControl — NotFoundError — больше не ищем (раньше пробовали вечно)
    const lA = [], tzA = { tizen: { application: { getCurrentApplication: tizenFake.application.getCurrentApplication,
        launchAppControl: (ac, id, ok, err) => { lA.push(id); setImmediate(() => err && err({ name: 'NotFoundError', message: 'app not found' })); } },
        ApplicationControl: tizenFake.ApplicationControl, filesystem: fsFake }, Lampa: tz.Lampa };
    const xA = [], PA0 = page({ bs_tg_token: TOKEN, bs_tg_chat: '1' }, mkXHR({ svcDown: true, log: xA }), tzA);
    PA0._svcStart(); await until(() => PA0._svc.absent && !PA0._svc.probing, 3000);
    const nA = xA.length;
    PA0._svcCheck(); PA0._svcStart(); PA0._svc.wakeAt = 0; PA0._svcSeen(0, null); await sleep(200);
    t('службы в пакете нет (NotFoundError при запуске) — больше не запускаем и не проверяем', PA0._svc.absent && lA.length === 1 && xA.length === nA && !PA0._svc.probing);

    // заглушка «слишком большое» из очереди службы: подключённому — «пришлите ещё раз» (свежее), давнее и чужим — молча
    const bigSent = [];
    function XBig() { this.open = (m, u) => { this.u = u; }; this.setRequestHeader = () => {}; this.send = b => bigSent.push({ u: this.u, b: decodeURIComponent(String(b || '')) }); }
    const PBig = page({ bs_tg_token: TOKEN, bs_tg_chat: '1', bs_tg_offset: '1' }, XBig);
    const nowSec = Math.floor(Date.now() / 1000);
    PBig._takeUpdate({ update_id: 7, _big: { chat: '1', date: nowSec - 60 }, _q: { at: Date.now() - 60000, tv: 0 } }, {});
    PBig._takeUpdate({ update_id: 8, _big: { chat: '1', date: nowSec - 7 * 3600 }, _q: { at: Date.now() - 7 * 3600000, tv: 0 } }, {});
    PBig._takeUpdate({ update_id: 9, _big: { chat: '555', date: nowSec }, _q: { at: Date.now(), tv: 0 } }, {});
    t('заглушка «слишком большое»: подключённому — «пришлите ещё раз», давнее и чужим — молча', bigSent.length === 1 && /\/sendMessage$/.test(bigSent[0].u) && /chat_id=1&/.test(bigSent[0].b) &&
        /слишком большим/.test(bigSent[0].b) && PBig._serverNow() > 0);

    // без службы (старый пакет, браузер): всё как раньше, в localStorage
    const st2 = { bs_tg_token: TOKEN, bs_tg_chat: '1', bs_ai_groq: KEYS.og };
    const xl2 = [];
    const P2 = page(st2, mkXHR({ log: xl2, svcDown: true }), { setTimeout: (f) => setImmediate(f) });
    P2._svcStart();
    await until(() => !P2._svc.probing);
    t('без службы: не Tizen — запуск молча не удался, /health не ответил — секреты на месте', !P2._svc.up && st2.bs_tg_token === TOKEN && st2.bs_ai_groq === KEYS.og && !st2.bs_tg_svc && xl2.filter(x => /\/health$/.test(x.url)).length === 6);
    okm = null; P2._call('sendMessage', { chat_id: '1', text: 'x' }, m => { okm = m; });
    await until(() => okm);
    t('без службы: Telegram — напрямую с токеном, как раньше', okm && okm.message_id === 7 && xl2.some(x => x.url === 'https://api.telegram.org/bot' + TOKEN + '/sendMessage'));
    // служба была и пропала: метка есть, секрета нет — ничего не стираем, запускаем службу снова
    const st3 = { bs_tg_svc: '1', bs_tg_chat: '1', bs_ai_svc: JSON.stringify({ groq: { h: 'aaaabbbb', l: 'mnop' } }) };
    launches.length = 0;
    let er = null;
    const P3 = page(st3, mkXHR({ svcDown: true }), Object.assign({ setTimeout: (f) => setImmediate(f) }, tz));
    P3._call('sendMessage', { chat_id: '1', text: 'x' }, null, e => { er = e; });
    await until(() => er && !P3._svc.probing);
    t('служба пропала: ошибка честная, служба запускается снова, метки на месте', /служба/.test(er) && launches.length === 1 && st3.bs_tg_svc === '1' && JSON.parse(st3.bs_ai_svc).groq.l === 'mnop');
    t('служба пропала: ключ ИИ по метке — к службе, не наружу и без ключа', (s => s && s.k === '' && s.l === 'mnop')(P3._aiSlot('groq')));

    /* ---- файл секретов не теряем: fsync и копия, не прочитался — не «секретов нет», в /tmp не храним ---- */
    const sf = n => path.join(dir, n);
    const restart = async c => { await new Promise(r2 => SV._test.stop(r2)); SV._test.config(c || svcCfg); await new Promise(r2 => SV._test.start(r2)); };
    const fsyncSaved = fs.fsyncSync, fsyncs = [];
    fs.fsyncSync = fd => { fsyncs.push(fd); return fsyncSaved(fd); };
    try { r = await ask('POST', '/secret', { name: 'tg', value: TOKEN }); } finally { fs.fsyncSync = fsyncSaved; }
    t('секреты: запись — fsync до rename, копия secrets.bak — та же', r.st === 200 && fsyncs.length >= 2 && fs.readFileSync(sf('secrets.bak'), 'utf8') === fs.readFileSync(sf('secrets.json'), 'utf8') &&
        JSON.parse(fs.readFileSync(sf('secrets.bak'), 'utf8')).tg === TOKEN && !fs.existsSync(sf('secrets.json.tmp')) && !fs.existsSync(sf('secrets.bak.tmp')));
    fs.writeFileSync(sf('secrets.json'), '{"tg":"12');
    await restart();
    r = await ask('GET', '/health');
    t('секреты: secrets.json испорчен (оборвалась запись) — служба взяла копию', r.j.store === 'ok' && r.j.has.tg === true);
    fs.writeFileSync(sf('secrets.json'), ''); fs.writeFileSync(sf('secrets.bak'), 'xx');
    await restart();
    r = await ask('GET', '/health');
    const r503 = await ask('POST', '/secret', { name: 'ai.groq', value: KEYS.og });
    t('секреты: файл и копия не прочитались — store «unreadable», а не «секретов нет»', r.j.store === 'unreadable' && r.j.has.tg === false);
    t('секреты: не прочитались — запись запрещена (503), файл с токеном не затёрт', r503.st === 503 && r503.j.error === 'unreadable' && fs.readFileSync(sf('secrets.json'), 'utf8') === '' && fs.readFileSync(sf('secrets.bak'), 'utf8') === 'xx');
    // страница: служба не прочитала файл — метки и ключи у страницы не трогаем (ключ читается новым API — openFile)
    const tzOpen = Object.assign({}, tz, { tizen: Object.assign({}, tz.tizen, { filesystem: {
        openFile: (p2, mode) => { const f = path.join(keyDir, String(p2).replace(/^wgt-private\//, '')); if (mode !== 'r' || !fs.existsSync(f)) throw new Error('NotFoundError'); return { readString: () => fs.readFileSync(f, 'utf8'), close() {} }; },
        resolve: () => { throw new Error('старый API не нужен'); } } }) });
    const st4 = { bs_tg_svc: '1', bs_tg_chat: '', bs_ai_svc: JSON.stringify({ groq: { h: 'aaaabbbb', l: 'mnop' } }), bs_ai_openrouter: KEYS.oo };
    const P4 = page(st4, mkXHR(), tzOpen);
    P4._svcStart();
    await until(() => P4._svc.up);
    await sleep(300);
    t('страница: store «unreadable» — метки на месте, ключ из localStorage не переносится и не стирается', P4._svc.up && P4._svc.store === 'unreadable' && st4.bs_tg_svc === '1' &&
        JSON.parse(st4.bs_ai_svc).groq.l === 'mnop' && st4.bs_ai_openrouter === KEYS.oo);
    t('ключ доступа: страница прочитала его через tizen.filesystem (openFile, wgt-private/svc.key)', P4._svcKey() === SV._test.key());
    t('ключ доступа: в выставленном наружу BSTelegram его нет (_svc без key; _svcKey — только с BS_TEST_HOOKS)', P4._svc.key === undefined && JSON.stringify(P4._svc).indexOf(SV._test.key()) < 0 &&
        page({}, null, { BS_TEST_HOOKS: false })._svcKey() === undefined);
    // ошибка чтения — не «файла нет» (EACCES, EIO; здесь — EISDIR): тоже «unreadable»
    fs.unlinkSync(sf('secrets.json')); fs.mkdirSync(sf('secrets.json')); fs.unlinkSync(sf('secrets.bak'));
    await restart();
    r = await ask('GET', '/health');
    t('секреты: ошибка чтения (не ENOENT) — тоже «unreadable»', r.j.store === 'unreadable');
    fs.rmdirSync(sf('secrets.json'));
    r = await ask('POST', '/forget', {});
    t('/forget при «unreadable»: стёрто поверх, файл снова в порядке', r.st === 200 && r.j.store === 'ok' && JSON.parse(fs.readFileSync(sf('secrets.json'), 'utf8')).tg === '');
    // папки данных нет — в /tmp не храним (и ключ доступа туда не пишем)
    const keyWas = fs.readFileSync(sf('svc.key'), 'utf8');
    await restart(Object.assign({}, svcCfg, { dir: path.join(dir, 'no', 'such'), tmp: dir }));
    r = await ask('GET', '/health');
    let r507 = await ask('POST', '/secret', { name: 'tg', value: TOKEN });
    t('секреты: папки данных нет, писать можно только в /tmp — store «tmp», /secret — 507, в /tmp ничего', r.j.store === 'tmp' && r507.st === 507 && r507.j.error === 'nodir' &&
        fs.readFileSync(sf('secrets.json'), 'utf8').indexOf(TOKEN) < 0 && fs.readFileSync(sf('svc.key'), 'utf8') === keyWas && SV._test.key() !== keyWas);
    await restart(Object.assign({}, svcCfg, { dir: path.join(dir, 'no', 'such'), tmp: path.join(dir, 'nope') }));
    r = await ask('GET', '/health');
    r507 = await ask('POST', '/secret', { name: 'tg', value: TOKEN });
    t('секреты: писать некуда — store «none», /secret — 507', r.j.store === 'none' && r507.st === 507);
    // ключ доступа не прочитался (папки нет — svc.key не записан; старая страница; не тот путь) — служба для страницы «нет»
    const st5 = { bs_tg_token: TOKEN, bs_tg_chat: '1', bs_ai_groq: KEYS.og };
    keyDir = path.join(dir, 'no', 'such');
    const P5 = page(st5, mkXHR(), Object.assign({ setTimeout: (f) => setImmediate(f) }, tz));
    P5._svcStart();
    await until(() => !P5._svc.probing);
    t('ключ доступа не прочитался — служба для страницы «нет»: токен и ключ в localStorage, как раньше', !P5._svc.up && st5.bs_tg_token === TOKEN && st5.bs_ai_groq === KEYS.og && !st5.bs_tg_svc);
    keyDir = dir;
    await restart();
    // localStorage полон: метка не записалась — секрет остаётся у страницы
    const st6 = { bs_tg_token: TOKEN, bs_tg_chat: '', bs_ai_groq: KEYS.og };
    const P6 = page(st6, mkXHR(), tz, ['bs_tg_svc', 'bs_ai_svc']);
    P6._svcStart();
    await until(() => P6._svc.up);
    await sleep(500);
    r = await ask('GET', '/health');
    t('localStorage полон: метка не записалась — токен и ключ остаются у страницы (копия — в службе)', st6.bs_tg_token === TOKEN && st6.bs_ai_groq === KEYS.og && !st6.bs_tg_svc && !st6.bs_ai_svc &&
        r.j.has.tg && r.j.has.ai.indexOf('groq') >= 0);
    // служба стартовала позже проб: первый удачный запрос к ней — она «есть»
    const opt7 = { svcDown: true }, st7 = { bs_tg_svc: '1', bs_tg_chat: '' };
    const P7 = page(st7, mkXHR(opt7), tz);
    P7._svcKey(SV._test.key());                                     // ключ прочитан, а служба ещё не отвечает (6 проб прошли)
    P7._svc.wakeAt = Date.now();                                    // и пробовали только что: снова запускать — не сейчас
    let e7 = null; P7._call('getMe', {}, null, e => { e7 = e; });
    await until(() => e7);
    opt7.svcDown = false;
    let ok7 = null; P7._call('getMe', {}, m => { ok7 = m; });
    await until(() => ok7 && P7._svc.up);
    t('служба ответила позже 6 проб: первый же удачный запрос — служба «есть» (svcOn), store из /health', !!e7 && !!ok7 && P7._svc.up && P7._svc.store === 'ok' && !P7._svc.probing);
    // «Отключить Telegram»: спросить; передумали — ничего; подтвердили — стереть у себя и в службе
    await ask('POST', '/secret', { name: 'ai.groq', value: KEYS.og }); await ask('POST', '/secret', { name: 'aiu.gemini.2', value: KEYS.gm });
    const sel = [], lampa8 = Object.assign({}, tz.Lampa, { Select: { show: o => sel.push(o) }, Controller: { enabled: () => ({ name: 'settings_component' }), toggle() {} }, Noty: { show() {} } });
    const st8 = { bs_tg_svc: '1', bs_tg_chat: '', bs_ai_svc: JSON.stringify({ groq: { h: legacy._fnv(KEYS.og, 2166136261), l: KEYS.og.slice(-4) }, 'gemini.2': { h: legacy._fnv(KEYS.gm, 2166136261), l: KEYS.gm.slice(-4) } }),
        bs_ai_openrouter_u: JSON.stringify({ 3: KEYS.oo }), bs_tg_offset: '5', bs_tg_tvs: '{}' };
    const P8 = page(st8, mkXHR(), Object.assign({}, tz, { Lampa: lampa8 }));
    P8._svcStart();
    await until(() => P8._svc.up && P8._svc.d && st8.bs_ai_openrouter_u === '{}');
    st8.bs_tg_chat = '1';
    P8._tgOffAsk();
    t('«Отключить Telegram»: сначала вопрос — «Отключить» / «Отмена»', sel.length === 1 && sel[0].items.length === 2 && sel[0].items[0].title === 'Отключить' && sel[0].items[1].title === 'Отмена');
    sel[0].onSelect(sel[0].items[1]);
    await sleep(200);
    r = await ask('GET', '/health');
    t('«Отмена» — ничего не стёрто', st8.bs_tg_svc === '1' && st8.bs_tg_chat === '1' && r.j.has.tg);
    P8._tgOffAsk(); sel[1].onSelect(sel[1].items[0]);
    await until(() => !('bs_tg_chat' in st8));
    await sleep(100);
    r = await ask('GET', '/health');
    t('«Отключить»: в службе пусто; у страницы — ни токена, ни чата, ни меток, ни ключей (свои и гостей)', !r.j.has.tg && !r.j.has.ai.length && !Object.keys(r.j.has.aiu).length &&
        ['bs_tg_token', 'bs_tg_chat', 'bs_tg_svc', 'bs_ai_svc', 'bs_ai_openrouter_u', 'bs_tg_offset', 'bs_tg_tvs'].every(k => !(k in st8)) && !st8.bs_tg_forget && !P8._svc.d && P8._busTopic() === '');
    t('«Отключить»: службе — «главный не я» (/alive), опрашивать бота она не будет', SV._test.state().bot.cfg && SV._test.state().bot.cfg.leader === false);
    // служба не ответила — у себя стёрли, а стереть в службе — когда ответит
    await ask('POST', '/secret', { name: 'tg', value: TOKEN });
    const opt9 = { svcDown: true }, st9 = { bs_tg_svc: '1', bs_tg_chat: '1' };
    const P9 = page(st9, mkXHR(opt9), tz);
    let off9 = null; P9._tgOff(ok => { off9 = ok; });
    await until(() => off9 !== null);
    t('«Отключить», служба не ответила: у страницы стёрто, «стереть в службе» запомнено', off9 === false && st9.bs_tg_forget === '1' && !st9.bs_tg_svc && !st9.bs_tg_chat);
    opt9.svcDown = false; P9._svcCheck();
    await until(() => !st9.bs_tg_forget);
    r = await ask('GET', '/health');
    t('служба снова ответила — стёрто и в ней (проверка на Tizen и без меток)', !st9.bs_tg_forget && !r.j.has.tg);
    // настройки: кнопка и пустое поле токена — то же «Отключить» с вопросом; передумали — токен на месте
    const params = [], lampa10 = Object.assign({}, lampa8, { SettingsApi: { addParam: o => params.push(o) } });
    const st10 = { bs_tg_token: TOKEN, bs_tg_chat: '1' };
    sel.length = 0;
    const P10 = page(st10, mkXHR({ svcDown: true }), Object.assign({}, tz, { Lampa: lampa10 }));
    P10._addSettings();
    const tokP = params.find(x => x.param.name === 'bs_tg_token'), offP = params.find(x => x.param.name === 'bs_tg_off');
    t('настройки: «Отключить Telegram» — в разделе Telegram-бот (раскладка Sunic Apps)', !!offP && offP.field.name === 'Отключить Telegram' && /'bs_tg_off'/.test(fs.readFileSync(path.join(SRC, 'loader.js'), 'utf8')));
    if (tokP.onRender) tokP.onRender({ find: () => ({ text() {} }) });
    st10.bs_tg_token = ''; tokP.onChange('');
    t('настройки: поле токена очистили — вопрос «Отключить Telegram?»', sel.length === 1 && sel[0].items[0].title === 'Отключить');
    sel[0].onBack();
    t('настройки: передумали — токен вернулся, чат на месте', st10.bs_tg_token === TOKEN && st10.bs_tg_chat === '1');
    st10.bs_tg_token = ''; tokP.onChange(''); sel[1].onSelect(sel[1].items[0]);
    await until(() => !('bs_tg_chat' in st10));
    t('настройки: подтвердили — отключено (службы нет — стёрто у страницы)', !('bs_tg_token' in st10) && !('bs_tg_chat' in st10) && !st10.bs_tg_forget);
    st10.bs_tg_offset = '777'; st10.bs_tg_token = '987654321:' + 'B'.repeat(35); tokP.onChange(st10.bs_tg_token);
    t('настройки: вписали другой токен — номер апдейта прежнего бота стёрт (опрос с offset=-1)', !('bs_tg_offset' in st10));
    st10.bs_tg_offset = '5'; tokP.onChange(st10.bs_tg_token);
    t('настройки: тот же токен ещё раз — номер апдейта на месте', st10.bs_tg_offset === '5');
    delete st10.bs_tg_token; delete st10.bs_tg_offset; delete st10.bs_tg_chat;
    offP.onChange();
    t('настройки: кнопка «Отключить Telegram», когда не подключено, — без вопроса', sel.length === 2);
    // 409 у страницы: один быстрый повтор (своя служба уступает на первом 409), потом долгая пауза
    const gu = [], delays = [];
    function X409() {
        const x = this; x.setRequestHeader = () => {}; x.getResponseHeader = () => null; x.open = (m, u) => { x.url = u; };
        x.send = () => { if (/getUpdates/.test(x.url)) gu.push(1); setImmediate(() => { x.status = 409; x.responseText = JSON.stringify({ ok: false, error_code: 409, description: 'Conflict: terminated by other getUpdates request' }); x.onload(); }); };
    }
    const P11 = page({ bs_tg_token: TOKEN, bs_tg_chat: '1', bs_tg_offset: '5' }, X409, { setTimeout: (f, ms) => { delays.push(ms); if (ms === 2500) setImmediate(f); return 0; } });
    P11._poll();
    await until(() => gu.length >= 2, 1000); await sleep(50);
    P11._poll(); await sleep(50);
    t('страница, 409: один быстрый повтор через 2,5 с, потом долгая пауза', gu.length === 2 && delays.indexOf(2500) >= 0);

    /* ---- бот, пока Lampa закрыта: служба опрашивает сама, очередь, «на ТВ» открывает Lampa (служба v2) ----
     * Свой Telegram: getUpdates с offset подтверждает, как настоящий (номера меньше offset забыты), новый запрос
     * обрывает висящий старый ответом 409; tg.script — подменить ответ следующего опроса (409, 429, 502). */
    const tg = { q: [], calls: [], sent: [], script: [], held: null, power: 'on', wh: [], deliv: [] };
    const tgSrv = http.createServer((req, res) => {
        const parts = []; req.on('data', d => parts.push(d)); req.on('end', () => {
            const b = Buffer.concat(parts).toString();
            const send = (code, obj) => { try { if (res.writableEnded || res.destroyed) return; res.writeHead(code, { 'Content-Type': 'application/json', Date: new Date().toUTCString() }); res.end(typeof obj === 'string' ? obj : JSON.stringify(obj)); } catch (e) {} };
            if (req.url === '/api/v2/') return send(200, { device: { PowerState: tg.power, name: '[TV] Зал' } });
            if (/^\/ntfy\//.test(req.url)) return send(200, '');
            const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url);
            if (!m || m[1] !== TOKEN) return send(404, { ok: false });
            const p = Object.fromEntries(new URLSearchParams(b));
            const who = String(req.headers['x-who'] || '');           // какая тестовая страница спрашивает ('' — служба)
            // getWebhookInfo: сколько апдейтов ждёт подтверждения (как у Telegram: отданные, но ещё не подтверждённые — тоже)
            if (m[2] === 'getWebhookInfo') { tg.wh.push({ at: Date.now(), who, n: tg.q.length }); return send(200, { ok: true, result: { url: '', has_custom_certificate: false, pending_update_count: tg.q.length } }); }
            if (m[2] !== 'getUpdates') {
                if (tg.rate && tg.rate[m[2]] > 0) { tg.rate[m[2]]--; tg.rateHits = (tg.rateHits || 0) + 1; return send(429, { ok: false, error_code: 429, description: 'Too Many Requests: retry after 1', parameters: { retry_after: 1 } }); }
                tg.sent.push({ m: m[2], p });
                if (m[2] === 'answerCallbackQuery' && tg.badAnswer) return send(400, { ok: false, error_code: 400, description: 'Bad Request: query is too old and response timeout expired or query ID is invalid' });
                return send(200, { ok: true, result: { message_id: 900 + tg.sent.length } });
            }
            const off = +(p.offset || 0);
            tg.calls.push({ at: Date.now(), offset: p.offset, timeout: p.timeout, limit: p.limit, who });
            if (tg.script.length) { const s = tg.script.shift(); return send(s.code, s.body); }
            if (tg.held) { const h = tg.held; tg.held = null; clearTimeout(h.timer); h.send(409, { ok: false, error_code: 409, description: 'Conflict: terminated by other getUpdates request' }); }
            if (off > 0) tg.q = tg.q.filter(u => u.update_id >= off);
            const give = () => { const list = tg.q.slice(0, 100); if (list.length && !res.writableEnded && !res.destroyed) tg.deliv.push({ who, ids: list.map(u => u.update_id) }); send(200, { ok: true, result: list }); };
            if (tg.q.length || !+p.timeout) return give();
            const h = { send, give };
            h.timer = setTimeout(() => { if (tg.held === h) tg.held = null; give(); }, 200);
            tg.held = h;
        });
    });
    await new Promise(r2 => tgSrv.listen(0, '127.0.0.1', r2));
    const TGB = 'http://127.0.0.1:' + tgSrv.address().port;
    const tgPush = (...us) => { tg.q.push(...us); if (tg.held) { const h = tg.held; tg.held = null; clearTimeout(h.timer); h.give(); } };
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'lampa-bot-'));
    keyDir = dir2;
    const launched = [];
    global.tizen.application.launch = (id, ok) => { launched.push({ id, at: Date.now() }); if (ok) ok(); };
    const botCfg = { port: SVP, dir: dir2, log: false, up: { tg: TGB + '/', ntfy: TGB + '/ntfy/', groq: UPB + '/groq/', gemini: UPB + '/gemini/', openrouter: UPB + '/or/' },
        tvApi: [TGB + '/api/v2/'], appId: '', bot: { gone: 600, idle: 50, poll: 1, backoff: 100, backoffMax: 400, launchGap: 1500, closedGap: 0, offGap: 60000 } };
    await new Promise(r2 => SV._test.stop(r2)); SV._test.config(botCfg); await new Promise(r2 => SV._test.start(r2));
    await ask('POST', '/secret', { name: 'tg', value: TOKEN });
    const ST = () => SV._test.state(), Q = () => ST().bot.q, qIds = () => Q().map(i => i.u.update_id).join();
    // новый токен: номер страницы — от прежнего бота, пока её опрос не удался с новым (offset=-1 или пришли апдейты)
    await ask('POST', '/alive', { offset: 5000, cfg: { leader: false } });
    let dbg = await ask('GET', '/debug');
    const dbgOpen = await ask('GET', '/debug', undefined, { 'X-Lampa-Key': '' });
    t('новый токен: номер страницы из /alive не берём, пока она не опросила новый бот', dbg.j.pageOff === 0 && dbg.j.trusted === false);
    t('/debug без ключа: флажки есть, номеров апдейтов нет', dbgOpen.st === 200 && dbgOpen.j.ok && dbgOpen.j.offset === undefined && dbgOpen.j.pageOff === undefined && dbgOpen.j.q === 0);
    await ask('POST', '/tg/getUpdates', 'offset=5000&timeout=0', { 'Content-Type': 'application/x-www-form-urlencoded' });
    dbg = await ask('GET', '/debug');
    t('новый токен: опрос со старым номером и без апдейтов — всё ещё не верим', dbg.j.pageOff === 0 && dbg.j.trusted === false);
    await ask('POST', '/tg/getUpdates', 'offset=-1&timeout=0', { 'Content-Type': 'application/x-www-form-urlencoded' });
    dbg = await ask('GET', '/debug');
    t('новый токен: страница начала заново (offset=-1) — номерам снова верим', dbg.j.trusted === true && dbg.j.pageOff === 0);
    const svcPolls = () => tg.calls.filter(c => c.timeout === '1'), pagePolls = () => tg.calls.filter(c => c.timeout === '25');
    const sentM = (m, chat) => tg.sent.filter(s => s.m === m && (chat === undefined || s.p.chat_id === String(chat)));
    const answerOf = id => sentM('answerCallbackQuery').filter(s => s.p.callback_query_id === id);
    const nowS = () => Math.floor(Date.now() / 1000);
    const msg = (id, chat, text, date) => ({ update_id: id, message: { message_id: id, chat: { id: chat, type: 'private' }, from: { id: chat, language_code: 'ru' }, text, date: date || nowS() } });
    const cbq = (id, chat, data) => ({ update_id: id, callback_query: { id: 'cb' + id, from: { id: chat }, data, message: { message_id: 500 + id, chat: { id: chat, type: 'private' }, date: nowS() } } });
    const RULES = { cbp: ['v:m:', 'v:t:', 'o:m:', 'o:t:', 'D:tvA:m:', 'D:tvA:t:', 'd:tvA:m:', 'd:tvA:t:'], cbx: ['mn:type', 'tp:tvA'], cmd: ['type'], words: [], typing: {} };
    const CFG = o => Object.assign({ leader: true, peers: 0, others: 0, allowed: ['1'], known: ['1', '2'], tv: RULES,
        texts: { 1: { closed: 'ЗАКРЫТО', tvOff: 'ВЫКЛ', opening: 'ОТКРЫВАЮ' }, 2: { closed: 'CLOSED', tvOff: 'OFF', opening: 'OPENING' } } }, o || {});
    const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };

    r = await ask('GET', '/health');
    t('служба v2+: /health — версия не ниже 2 (страница по ней включает передачу бота)', r.j.v >= 2);
    await sleep(700);
    t('бот без Lampa: страница ни разу не прислала правил — служба сама не опрашивает', svcPolls().length === 0);
    r = await ask('POST', '/alive', { offset: 10, cfg: CFG({ leader: false }) });
    t('/alive: ok, очередь пуста, номер службы', r.st === 200 && r.j.ok && r.j.pending === 0 && r.j.next === 0 && r.j.polling === false);
    await sleep(800);
    t('бот без Lampa: этот ТВ не был главным — служба не опрашивает', svcPolls().length === 0);
    await ask('POST', '/alive', { away: true, offset: 10, cfg: CFG({ peers: 1 }) });
    await sleep(300);
    t('бот без Lampa: уходя, на экране был другой ТВ — бота возьмёт он, служба не опрашивает', svcPolls().length === 0);
    await ask('POST', '/alive', { offset: 10, cfg: CFG() });
    await sleep(300);
    t('страница на связи — служба не опрашивает (два опроса — 409)', svcPolls().length === 0);
    await until(() => svcPolls().length > 0, 3000);
    t('страница молчит дольше gone — служба опрашивает сама, с номера страницы', svcPolls().length >= 1 && svcPolls()[0].offset === '10');
    tgPush(msg(10, 1, 'привет'), msg(11, 1, 'ещё'), msg(12, 99, 'чужой'));
    await until(() => Q().length === 3); await sleep(150);
    t('Lampa закрыта: апдейты — в очередь по порядку, номер службы — следующий', qIds() === '10,11,12' && ST().bot.offset === 13 && Q().every(i => i.at > 0));
    await until(() => sentM('deleteMessage', 1).length === 1, 2000);
    t('Lampa закрыта: подключённому — «закрыта» на каждое сообщение, прошлое такое — удалено (в чате одно)', sentM('sendMessage', 1).length === 2 && sentM('sendMessage', 1).every(x => x.p.text === 'ЗАКРЫТО') && sentM('deleteMessage', 1).length === 1);
    t('Lampa закрыта: чужому служба не отвечает (ответит страница)', sentM('sendMessage', 99).length === 0);
    tgPush(cbq(13, 1, 'v:m:550'), cbq(14, 1, 'o:t:2'));
    await until(() => Q().length === 5 && launched.length >= 1, 3000); await sleep(150);
    t('«▶️ Смотреть» при закрытой Lampa: ответ на нажатие и Lampa открывается (tizen.application.launch)', answerOf('cb13').length === 1 && answerOf('cb13')[0].p.text === 'ОТКРЫВАЮ' &&
        launched.length === 1 && launched[0].id === '0SG81L944p.Lampa');
    t('второе нажатие сразу — второй раз Lampa не открываем (launchGap), но на нажатие отвечаем', launched.length === 1 && answerOf('cb14').length === 1 && answerOf('cb14')[0].p.text === 'ОТКРЫВАЮ');
    t('ТВ включён (PowerState on) — «включите ТВ» не пишем', !tg.sent.some(s => s.p.text === 'ВЫКЛ'));
    t('в очереди действия «на ТВ» помечены', Q()[3].tv === 1 && Q()[4].tv === 1 && Q()[0].tv === 0);
    tg.power = 'standby';
    await sleep(1500);
    tgPush(cbq(15, 1, 'D:tvA:m:3'), cbq(16, 1, 'w:m:1'), cbq(17, 2, 'v:m:1'), cbq(18, 1, 'd:tvB:m:3'));
    await until(() => Q().length === 9 && launched.length === 2, 3000); await sleep(200);
    t('ТВ в режиме ожидания: Lampa открыта и человеку — «включите ТВ»', launched.length === 2 && sentM('sendMessage', 1).some(s => s.p.text === 'ВЫКЛ'));
    t('не «на ТВ» («Хочу посмотреть», выбран другой ТВ) — на нажатие «закрыта», Lampa не открываем', answerOf('cb16')[0].p.text === 'ЗАКРЫТО' && answerOf('cb18')[0].p.text === 'ЗАКРЫТО' && launched.length === 2);
    t('гостю, которому нельзя включать видео, — тоже «закрыта», его текстом', answerOf('cb17').length === 1 && answerOf('cb17')[0].p.text === 'CLOSED' && !sentM('sendMessage', 2).some(s => s.p.text === 'OFF'));
    await ask('POST', '/alive', { away: true, offset: 13, cfg: CFG({ tv: Object.assign({}, RULES, { typing: { 1: 60000 } }) }) });
    tgPush(msg(19, 1, 'матрица'), msg(20, 1, '/type'), msg(21, 1, '/menu'));
    await until(() => Q().length === 12);
    t('«⌨️ Набрать на ТВ»: ждём текст — следующее сообщение «на ТВ»; /type — тоже; /menu — нет', Q()[9].tv === 1 && Q()[10].tv === 1 && Q()[11].tv === 0);
    const bjNow = () => { try { return fs.readFileSync(path.join(dir2, 'bot.json'), 'utf8'); } catch (e) { return ''; } };
    const bjQ = () => { try { return JSON.parse(bjNow()).q.length; } catch (e) { return -1; } };
    t('bot.json пишется не на каждый опрос (не чаще раза в 3 с)', bjQ() < 12);
    await until(() => bjQ() === 12, 4000);
    const bj = bjNow();
    t('очередь и номер — в bot.json (атомарно), токена в нём нет', JSON.parse(bj).q.length === 12 && JSON.parse(bj).offset === 22 && bj.indexOf(TOKEN) < 0 && !fs.existsSync(path.join(dir2, 'bot.json.tmp')));
    await new Promise(r2 => SV._test.stop(r2)); SV._test.config(botCfg); await new Promise(r2 => SV._test.start(r2));
    t('служба перезапустилась (ТВ перезагрузили): очередь, номер и правила — из файла', qIds() === '10,11,12,13,14,15,16,17,18,19,20,21' && ST().bot.offset === 22 && ST().bot.cfg.leader === true && ST().bot.cfg.tv.cbp.length === 8 && ST().bot.cfg.tv.cbx.length === 2);
    {
        // битая запись (null) в очереди bot.json — пропускаем её, остальная очередь цела (раньше сбрасывалась вся)
        await new Promise(r2 => SV._test.stop(r2));
        const bf = path.join(dir2, 'bot.json'), bjx = JSON.parse(fs.readFileSync(bf, 'utf8'));
        bjx.q.splice(1, 0, null, 7, { u: null });
        fs.writeFileSync(bf, JSON.stringify(bjx));
        SV._test.config(botCfg); await new Promise(r2 => SV._test.start(r2));
    }
    t('bot.json с битой записью (null) в очереди — пропущена, остальная очередь цела', qIds() === '10,11,12,13,14,15,16,17,18,19,20,21' && ST().bot.offset === 22);
    await until(() => ST().loop.on, 2000);
    r = await ask('GET', '/pending');
    t('/pending: очередь по порядку, со временем получения; служба бросила свой опрос', r.j.ok && r.j.items.map(i => i.u.update_id).join() === qIds() && r.j.items.every(i => i.at > 0) &&
        r.j.next === 22 && r.j.more === false && !ST().loop.on);
    let n1 = svcPolls().length;
    await sleep(250);
    t('страница вернулась — служба больше не опрашивает', svcPolls().length === n1);
    r = await ask('POST', '/pending/ack', { upTo: 14 });
    t('/pending/ack: разобранное убрано', r.j.ok && r.j.pending === 7 && qIds() === '15,16,17,18,19,20,21');
    n1 = tg.calls.length;
    r = await ask('POST', '/tg/getUpdates', 'offset=17&timeout=25', FORM);
    t('getUpdates страницы при непустой очереди: ответ — очередь (с пометкой _q), offset подтвердил разобранное, Telegram не спрашиваем',
        r.j.ok && r.j.result.map(u => u.update_id).join() === '17,18,19,20,21' && r.j.result[0]._q.at > 0 && r.j.result[2]._q.tv === 1 && r.j.result[4]._q.tv === 0 && tg.calls.length === n1);
    r = await ask('POST', '/tg/getUpdates', 'offset=22&timeout=0', FORM);
    t('очередь разобрана — дальше Telegram, с того же номера', r.j.ok && Q().length === 0 && tg.calls.length === n1 + 1 && tg.calls[n1].offset === '22');
    r = await ask('POST', '/tg/getUpdates', 'offset=5&timeout=0', FORM);
    t('страница с номером ниже, чем у службы, — служба поднимает его (без повторов)', tg.calls[tg.calls.length - 1].offset === '22');
    // ушла, не подтвердив отданное: Telegram отдаст это снова — в очередь, но без действий службы (страница уже разобрала)
    tgPush(cbq(22, 1, 'v:m:9'), msg(23, 1, 'x'));
    r = await ask('POST', '/tg/getUpdates', 'offset=22&timeout=0', FORM);
    const L0 = launched.length, A0 = sentM('answerCallbackQuery').length, M0 = sentM('sendMessage').length, P0 = svcPolls().length, tAway = Date.now();
    await ask('POST', '/alive', { away: true, offset: 22, cfg: CFG() });
    await until(() => Q().length === 2, 2000); await sleep(150);
    t('страница ушла (away) — служба берёт бота сразу, с её номера', r.j.result.length === 2 && svcPolls()[P0] && svcPolls()[P0].offset === '22' && svcPolls()[P0].at - tAway < 400);
    t('отданное странице до ухода — в очереди, но служба ничего не делает второй раз (не открывает Lampa, не отвечает)', qIds() === '22,23' &&
        launched.length === L0 && sentM('answerCallbackQuery').length === A0 && sentM('sendMessage').length === M0);
    t('пометка «на ТВ» — у каждого апдейта по правилам, открыли Lampa или нет (правило 15 минут на странице)', Q()[0].tv === 1 && Q()[1].tv === 0);
    // туда и обратно — точно: разобрала, подтвердила, ушла — служба с её номера, в очереди только новое
    await ask('POST', '/pending/ack', { upTo: 23 });
    await ask('POST', '/tg/getUpdates', 'offset=24&timeout=0', FORM);
    const P1 = svcPolls().length;
    await ask('POST', '/alive', { away: true, offset: 24, cfg: CFG() });
    tgPush(msg(24, 1, 'привет'));
    await until(() => Q().length === 1, 2000);
    t('передача бота туда и обратно точная: ни потерь, ни повторов', svcPolls()[P1].offset === '24' && qIds() === '24' && ST().bot.offset === 25);
    // 409: бота взял кто-то ещё — уступить до возвращения страницы
    await ask('POST', '/pending/ack', { upTo: 24 });
    tg.script.push({ code: 409, body: { ok: false, error_code: 409, description: 'Conflict: terminated by other getUpdates request' } });
    await ask('POST', '/alive', { away: true, offset: 25, cfg: CFG({ others: 1 }) });
    await until(() => ST().loop.yielded, 2000);
    n1 = svcPolls().length;
    await sleep(500);
    t('409 (бота опрашивает другой ТВ): служба уступает и больше не опрашивает', ST().loop.yielded && svcPolls().length === n1);
    await ask('POST', '/alive', { offset: 25, cfg: CFG() });
    t('страница вернулась — уступка снята', !ST().loop.yielded);
    // 409 при одном ТВ — это висевший запрос своей же страницы: не уступать насовсем, повтор через минуту
    tg.script.push({ code: 409, body: { ok: false, error_code: 409, description: 'Conflict: terminated by other getUpdates request' } });
    await ask('POST', '/alive', { away: true, offset: 25, cfg: CFG() });
    await until(() => ST().loop.c409 === 1, 2000);
    t('409 при одном ТВ: служба не уступает насовсем, повтор позже', ST().loop.c409 === 1 && !ST().loop.yielded);
    await ask('POST', '/alive', { offset: 25, cfg: CFG() });
    t('страница вернулась — счётчик 409 и пауза сброшены', ST().loop.c409 === 0);
    // 429: ждать, сколько сказал Telegram
    tg.script.push({ code: 429, body: { ok: false, error_code: 429, description: 'Too Many Requests: retry after 1', parameters: { retry_after: 1 } } });
    n1 = svcPolls().length;
    await ask('POST', '/alive', { away: true, offset: 25, cfg: CFG() });
    await until(() => svcPolls().length >= n1 + 2, 4000);
    let c = svcPolls();
    t('429: следующий опрос — не раньше retry_after', c.length >= n1 + 2 && c[n1 + 1].at - c[n1].at >= 950);
    // сеть / 502: пауза растёт
    await ask('POST', '/alive', { offset: 25, cfg: CFG() });
    tg.script.push({ code: 502, body: 'bad gateway' }, { code: 502, body: 'bad gateway' });
    n1 = svcPolls().length;
    await ask('POST', '/alive', { away: true, offset: 25, cfg: CFG() });
    await until(() => svcPolls().length >= n1 + 3, 4000);
    c = svcPolls();
    const g1 = c[n1 + 1].at - c[n1].at, g2 = c[n1 + 2].at - c[n1 + 1].at;
    t('502 и обрывы: повтор с нарастающей паузой', g1 >= 90 && g2 >= 180 && g2 > g1);
    // свой опрос: limit — сколько влезет в очередь (лишнее Telegram отдаст в следующий раз, а не пропадёт за qMax)
    t('свой опрос: limit в каждом запросе — от 1 до 100', svcPolls().length > 0 && svcPolls().every(x => +x.limit >= 1 && +x.limit <= 100));
    botCfg.bot.qMax = Q().length + 3; n1 = svcPolls().length;
    await until(() => svcPolls().length > n1, 3000);
    t('свой опрос: в очереди осталось место на 3 — limit=3', svcPolls()[n1] && svcPolls()[n1].limit === '3');
    delete botCfg.bot.qMax;
    // больше itemMax — заглушка в очереди; «Lampa закрыта» упёрлась в 429 — один повтор через retry_after
    tg.power = 'on'; tg.rate = { sendMessage: 1 }; tg.rateHits = 0;
    const M1 = sentM('sendMessage', 1).length, tBig = Date.now();
    tgPush(msg(25, 1, 'x'.repeat(20000)));
    await until(() => Q().some(i => i.u.update_id === 25), 3000);
    const big = Q().find(i => i.u.update_id === 25);
    t('апдейт больше itemMax (16 КБ) — в очереди заглушка {update_id, _big: {chat, date}}, без содержимого', !!big && !!big.u._big && big.u._big.chat === '1' && big.u._big.date > 0 && !big.u.message && JSON.stringify(big).length < 300);
    await until(() => sentM('sendMessage', 1).length > M1, 4000);
    t('служба: «слишком часто» (429) на своё сообщение — один повтор через retry_after', tg.rateHits === 1 && sentM('sendMessage', 1).length === M1 + 1 && Date.now() - tBig >= 950);
    tg.rate = null;
    await until(() => Date.now() - tBig > 1900, 3000);
    botCfg.bot.closedGap = 800;
    const M2 = sentM('sendMessage', 1).length;
    tgPush(msg(26, 1, 'раз'), msg(27, 1, 'два'));
    await until(() => Q().some(i => i.u.update_id === 27), 3000); await sleep(400);
    t('«Lampa закрыта»: пачка сообщений подряд — один ответ на всю пачку', sentM('sendMessage', 1).length === M2 + 1);
    botCfg.bot.closedGap = 0;
    // ответ на нажатие: у Telegram до 200 знаков — режем, эмодзи пополам не рвём
    await ask('POST', '/alive', { away: true, offset: 28, cfg: CFG({ texts: { 1: { closed: 'а'.repeat(199) + '😀' + 'b'.repeat(50), tvOff: 'ВЫКЛ', opening: 'ОТКРЫВАЮ' } } }) });
    tgPush(cbq(28, 1, 'w:m:1'));
    await until(() => answerOf('cb28').length, 3000);
    t('ответ на нажатие — не длиннее 200 знаков, эмодзи не разрезан', answerOf('cb28').length === 1 && answerOf('cb28')[0].p.text === 'а'.repeat(199));
    await ask('POST', '/pending/ack', { upTo: 29 });
    await ask('POST', '/alive', { away: true, offset: 30, cfg: CFG() });
    t('/pending/ack: заглушки и проверочные апдейты убраны', Q().length === 0);

    // страница: очередь разбирает тем же handle, пролежавшее в очереди — не «старое»
    tg.power = 'on';
    tgPush(msg(30, 1, '/help'), msg(31, 1, 'давно', nowS() - 600), cbq(32, 1, 'mn:type'), msg(33, 2, '/help'));
    await until(() => Q().length === 4, 3000); await sleep(150);
    const shift = (i, ms) => { const it = Q()[i]; it.at -= ms; if (it.u.message) it.u.message.date -= Math.round(ms / 1000); };
    shift(0, 10 * 60000);            // 10 минут в очереди службы: свежее, выполнить
    shift(2, 20 * 60000);            // «на ТВ» 20 минут назад: само не включается
    shift(3, 7 * 3600000);           // 7 часов: старое
    const A1 = answerOf('cb32').length;
    MAP[1][1] = TGB + '/'; MAP[2][1] = TGB + '/ntfy/';
    const pst = { bs_tg_svc: '1', bs_tg_chat: '1', bs_tv_id: 'tvA', bs_tg_offset: '25', bs_tg_lang: JSON.stringify({ 1: 'ru', 2: 'en' }), bs_tg_lang_at: '{}',
        bs_tg_users: JSON.stringify({ 2: { name: 'Аня', at: 1, want: [], subs: [] } }) };
    const docFake = { hidden: false };
    const PB = page(pst, mkXHR(), Object.assign({ document: docFake }, tz));
    PB._svcStart();
    await until(() => pst.bs_tg_offset === '34' && Q().length === 0 && pagePolls().some(x => x.offset === '34'), 6000);
    const helpTo = ch => sentM('sendMessage', ch).filter(s => /помощник Lampa|Lampa assistant/.test(s.p.text));
    t('страница вернулась: очередь разобрана обычным разбором, подтверждена, опрос — с номера службы', pst.bs_tg_offset === '34' && Q().length === 0 && pagePolls().some(x => x.offset === '34'));
    t('пролежавшее в очереди 10 минут /help — запоздалая команда: молча, без помощи и без «⏳»', helpTo(1).length === 0);
    t('дошедшее до службы через 10 минут после отправки — «старое», как раньше (одно объяснение)', sentM('sendMessage', 1).filter(s => /^⏳ Ваше сообщение/.test(s.p.text)).length === 1);
    t('«на ТВ» из очереди старше 15 минут — не выполняем', answerOf('cb32').length === A1);
    t('из очереди старше 6 часов — «старое», на языке человека', helpTo(2).length === 0 && sentM('sendMessage', 2).some(s => /^⏳ Your message/.test(s.p.text)));
    await sleep(400);                                             // первый опрос страницы вернулся — она главная
    PB._svcAlive(false);
    await until(() => ST().bot.cfg && ST().bot.cfg.leader === true, 3000);
    const cf = ST().bot.cfg, cbOk = d => SV._test.tvMatch(d, true), txOk = s => SV._test.tvMatch(s, false);
    t('правила от страницы: главный, кому отвечать и кому можно ТВ, других ТВ на боте нет', cf.leader === true && cf.peers === 0 && cf.others === 0 && cf.known.join() === '1,2' && cf.allowed.join() === '1,2');
    t('правила от страницы: тексты каждому на его языке', cf.texts[1].closed === 'Lampa на ТВ закрыта — отвечу, как только её откроют.' && /^Lampa on the TV is closed/.test(cf.texts[2].closed) &&
        /^📺 Телевизор выключен/.test(cf.texts[1].tvOff) && /Opening Lampa/.test(cf.texts[2].opening));
    t('правила от страницы: «на ТВ» — ▶️, 📺, этот ТВ в выборе, ⌨️; не «на ТВ» — остальное',
        cbOk('v:m:1') && cbOk('o:t:5') && cbOk('D:tvA:m:3') && cbOk('d:tvA:t:3') && cbOk('mn:type') && cbOk('tp:tvA') &&
        !cbOk('d:tvB:m:3') && !cbOk('w:m:1') && !cbOk('v:m:') && !cbOk('v:m:1x') && !cbOk('xv:m:1') && !cbOk('mn:typex') && !cbOk('s:t:1') && !cbOk('x:m:1') && !cbOk('q:m:1') && !cbOk('mn:menu') && !cbOk('mn:find') && !cbOk('st:ai') && !cbOk('u:5') && !cbOk('p:2'));
    t('правила от страницы: тексты «на ТВ» — /type и «⌨️ Набрать на ТВ» на всех языках', txOk('/type') && txOk('⌨️ Набрать на ТВ') && txOk('⌨️ Type on TV') && txOk("⌨️ TV'da yozish") && txOk('⌨️ TVʼda yozish') &&
        !txOk('матрица') && !txOk('/menu') && !txOk('📋 Меню') && txOk('/type@my_bot матрица') && !txOk('/typex') && !txOk('⌨️ Набрать на ТВ!'));
    // Lampa ушла с экрана: бота — службе, с номера страницы; страница сама больше не опрашивает
    const PA = svcPolls().length;
    docFake.hidden = true;
    PB._svcAway(true);
    await until(() => svcPolls().length > PA, 3000);
    const np = pagePolls().length;
    await sleep(600);
    t('Lampa скрыта: бота опрашивает служба, с номера страницы; страница молчит', svcPolls()[PA].offset === '34' && pagePolls().length <= np + 1 && ST().pg.away);
    PB._svcWake();
    await sleep(300);
    t('Lampa скрыта, таймеры идут, но служба её не открывала — бот остаётся у службы', ST().pg.away && pagePolls().length <= np + 1);
    const Lx = launched.length;
    await sleep(Math.max(0, 1600 - (Date.now() - launched[Lx - 1].at)));          // launchGap прошёл
    tgPush(cbq(34, 1, 'v:m:77'));
    await until(() => launched.length > Lx, 3000);
    PB._svcWake();
    await until(() => Q().length === 0 && pst.bs_tg_offset === '35' && !ST().pg.away && pagePolls().some(x => x.offset === '35'), 3000);
    t('«▶️ Смотреть» при скрытой Lampa: служба открыла её (экран может и не включиться) — страница забирает бота и очередь',
        launched.length === Lx + 1 && Q().length === 0 && pst.bs_tg_offset === '35' && !ST().pg.away && !ST().loop.on && pagePolls().some(x => x.offset === '35'));
    docFake.hidden = false;
    pst.bs_tg_chat = '';                                          // страница больше не опрашивает
    await sleep(300);

    /* ---- давнее «▶️ Смотреть» Lampa не открывает; после перезагрузки бота не перехватываем ---- */
    const gapOk = async () => { const l = launched[launched.length - 1]; if (l) await sleep(Math.max(0, 1600 - (Date.now() - l.at))); };
    await ask('POST', '/pending/ack', { upTo: 39 });
    await ask('POST', '/alive', { away: true, offset: 40, cfg: CFG() });
    await until(() => ST().loop.on && ST().bot.okAt > 0, 3000);
    await new Promise(r2 => SV._test.stop(r2));                       // ТВ выключили из розетки
    const okAtFile = JSON.parse(fs.readFileSync(path.join(dir2, 'bot.json'), 'utf8')).okAt;
    tgPush(cbq(40, 1, 'v:m:5'), msg(41, 1, 'привет'));                 // нажали, пока ТВ был выключен
    await gapOk();
    const L1 = launched.length;
    SV._test.config(botCfg); await new Promise(r2 => SV._test.start(r2));
    await until(() => Q().length >= 2, 3000); await sleep(300);
    t('после перезагрузки (ТВ на боте один): служба сама берёт бота, но давнее нажатие Lampa не открывает', ST().pg.seen === false && Q().length === 2 && launched.length === L1 &&
        !answerOf('cb40').some(a => a.p.text === 'ОТКРЫВАЮ'));
    t('догоняющий ответ: at — время последнего удачного опроса (из bot.json), у сообщения — не раньше его даты; «на ТВ» помечено', okAtFile > 0 && Q()[0].at === okAtFile && Q()[0].tv === 1 &&
        Q()[1].at >= Q()[0].at && Q()[1].tv === 0);
    // ТВ на боте не один: после перезагрузки сохранённому «главный» не верим, пока своя страница не пришлёт /alive
    await ask('POST', '/pending/ack', { upTo: 41 });
    await ask('POST', '/alive', { offset: 42, cfg: CFG({ others: 1 }) });
    await new Promise(r2 => SV._test.stop(r2)); SV._test.config(botCfg); await new Promise(r2 => SV._test.start(r2));
    let n3 = svcPolls().length;
    await sleep(1000);
    t('после перезагрузки, ТВ на боте несколько: служба бота не берёт, пока своя страница не пришлёт /alive', svcPolls().length === n3 && !ST().pg.seen && ST().bot.cfg.others === 1);
    await ask('POST', '/alive', { away: true, offset: 42, cfg: CFG({ others: 1 }) });
    await until(() => svcPolls().length > n3, 2000);
    t('своя страница прислала /alive (и ушла) — служба ведёт бота', svcPolls().length > n3 && ST().pg.seen);
    await until(() => ST().bot.okAt > 0 && ST().loop.okM > 0, 2000); await sleep(300);
    // Telegram не принял ответ на нажатие («query is too old») — Lampa не открываем
    await gapOk();
    tg.badAnswer = true;
    const L2 = launched.length;
    tgPush(cbq(42, 1, 'v:m:6'));
    await until(() => answerOf('cb42').length === 1, 2000); await sleep(400);
    tg.badAnswer = false;
    t('ответ на нажатие не принят («query is too old») — Lampa не открываем; в очереди «на ТВ»', launched.length === L2 && answerOf('cb42')[0].p.text === 'ОТКРЫВАЮ' && Q().some(i => i.u.update_id === 42 && i.tv === 1));
    // перерыв дольше catchGap — ответ догоняющий
    await gapOk();
    botCfg.bot.catchGap = -1;
    const L3 = launched.length;
    tgPush(cbq(43, 1, 'v:m:7'));
    await until(() => Q().some(i => i.u.update_id === 43), 2000); await sleep(400);
    delete botCfg.bot.catchGap;
    t('перерыв дольше catchGap (90 с) — ответ догоняющий: Lampa не открываем, «Открываю» не пишем', launched.length === L3 && answerOf('cb43').length === 1 && answerOf('cb43')[0].p.text === '');
    // и обычный ход — по-прежнему открывает
    await gapOk();
    await sleep(300);
    const L4 = launched.length;
    tgPush(cbq(44, 1, 'v:m:8'));
    await until(() => launched.length > L4, 3000);
    t('живое нажатие (ответ принят) — Lampa открывается, как раньше', launched.length === L4 + 1);
    // ключ ИИ, пока Lampa закрыта, — не на диск
    tgPush(msg(45, 1, KEYS.og), msg(46, 2, KEYS.gm));
    await until(() => Q().some(i => i.u.update_id === 46), 2000); await sleep(200);
    const kq = Q().filter(i => i.u.update_id >= 45), bj2 = fs.readFileSync(path.join(dir2, 'bot.json'), 'utf8');
    t('ключ ИИ, пока Lampa закрыта: в очереди вместо текста — заглушка и _k, в bot.json ключа нет', kq.length === 2 && kq.every(i => i.u.message._k === 1 && i.u.message.text === '🔑') &&
        bj2.indexOf(KEYS.og) < 0 && bj2.indexOf(KEYS.gm) < 0 && SV._test.looksKey(KEYS.oo) && SV._test.looksKey('AQ.' + 'Ab1'.repeat(12)) && !SV._test.looksKey('Матрица 1999') && !SV._test.looksKey(TOKEN));
    // часы ТВ прыгнули: страница «на связи» по монотонным часам, очередь не «стареет» (возраст — по часам Telegram)
    await ask('POST', '/alive', { offset: 42, cfg: CFG() });
    const qn = Q().length, realNow = Date.now;
    Date.now = () => realNow() + 3 * 86400000;
    let jumpPoll = true;
    try {
        SV._test.tick(); jumpPoll = ST().loop.on;
        r = await ask('GET', '/pending');
    } finally { Date.now = realNow; }
    t('часы ТВ ушли на 3 дня вперёд: служба не считает страницу ушедшей и очередь не выбрасывает', !jumpPoll && qn >= 5 && r.j.items.length === qn);
    // чужие правила: в пределах, типы проверены, RegExp из них не собирается
    const evil = { leader: true, peers: 'x', others: { a: 1 }, allowed: Array(3000).fill('1'), known: Array(3000).fill('2').concat([{}, 'abc', -5]),
        tv: { cbp: Array(1000).fill('v:'), cbx: ['(a+)+$'], cmd: [{}], words: ['x'.repeat(5000)], typing: { 1: 'soon', 2: 1e12, abc: 5 } }, texts: { 1: { closed: 'y'.repeat(10000) } } };
    const te = Date.now();
    r = await ask('POST', '/alive', { offset: 42, cfg: evil });
    const ce = ST().bot.cfg;
    t('/alive с чужими правилами: списки урезаны, типы проверены', r.st === 200 && Date.now() - te < 1000 && ce.peers === 0 && ce.others === -1 && ce.allowed.length === 100 && ce.known.length === 100 &&
        ce.tv.cbp.length === 20 && ce.tv.cmd.length === 0 && ce.tv.words.length === 0 && ce.texts[1].closed.length === 500 && !ST().typing[1] && ST().typing[2] - SV._test.mono() <= 600000 && !('abc' in ST().typing));
    t('/alive с чужими правилами: «(a+)+$» — просто строка (RegExp из присланного служба не собирает)', SV._test.tvMatch('(a+)+$', true) && !SV._test.tvMatch('a'.repeat(40) + '!', true));
    await ask('POST', '/alive', { offset: 42, cfg: CFG() });
    // страница: ключ из очереди — удалить из чата и попросить прислать ещё раз; «на ТВ» без времени — не выполнять
    await ask('POST', '/pending/ack', { upTo: 44 });
    const pkc = { bs_tg_svc: '1', bs_tg_chat: '1', bs_tv_id: 'tvA', bs_tg_offset: '45', bs_tg_lang: JSON.stringify({ 1: 'ru', 2: 'en' }), bs_tg_lang_at: '{}',
        bs_tg_users: JSON.stringify({ 2: { name: 'Аня', at: 1, want: [], subs: [] } }) };
    const D0 = sentM('deleteMessage').length;
    const PC = page(pkc, mkXHR(), Object.assign({ document: { hidden: false } }, tz));
    PC._svcStart();
    await until(() => sentM('deleteMessage').length >= D0 + 2 && sentM('sendMessage', 2).some(s => /^🔑 Looks like/.test(s.p.text)), 6000);
    t('страница: ключ ИИ из очереди — сообщение удалено из чата, человека просят прислать ещё раз (на его языке)', sentM('deleteMessage').slice(D0).map(s => s.p.message_id).sort().join() === '45,46' &&
        sentM('sendMessage', 1).some(s => /^🔑 Похоже, вы прислали ключ ИИ/.test(s.p.text)) && sentM('sendMessage', 2).some(s => /^🔑 Looks like/.test(s.p.text)));
    const A5 = answerOf('cb90').length, A6 = answerOf('cb91').length;
    PC._takeUpdate(Object.assign(cbq(90, 1, 'mn:type'), { _q: { at: 0, tv: 1 } }), {});
    PC._takeUpdate(Object.assign(cbq(91, 1, 'mn:type'), { _q: { at: Date.now(), tv: 1 } }), {});
    await sleep(400);
    t('страница: «на ТВ» из очереди без времени (at = 0) — не выполняем; со свежим временем — да', answerOf('cb90').length === A5 && answerOf('cb91').length === A6 + 1);
    pkc.bs_tg_chat = '';
    await sleep(300);
    /* ---- несколько ТВ: главного выдернули из розетки (без «bye») — failover по самому Telegram (getWebhookInfo) ----
     * Свой Telegram (tgSrv) — с offset и «новый getUpdates обрывает прежний 409». Страницы ТВ «А» и «Б» ходят в него
     * напрямую (без службы), их часы — общие подвижные (skew): 30 с между проверками getWebhookInfo — сдвигом часов. */
    {
        MAP[1][1] = TGB + '/';
        let skew = 0;
        class FD extends Date { constructor(...a) { if (a.length) super(...a); else super(Date.now() + skew); } static now() { return Date.now() + skew; } }
        const dead = {}, base = mkXHR();
        // XHR страницы who: заголовок X-Who (кто спрашивает); dead[who] — ТВ выдернули из розетки: запросы не уходят, ответы не приходят
        const XW = who => function () {
            base.call(this);
            const self = this, s = this.send;
            this.send = b => {
                if (dead[who]) return;
                const ol = self.onload, oe = self.onerror;
                self.onload = () => { if (!dead[who] && ol) ol(); };
                self.onerror = () => { if (!dead[who] && oe) oe(); };
                self.setRequestHeader('X-Who', who);
                s(b);
            };
        };
        const opt = { Date: FD, setTimeout: (f, ms) => setTimeout(f, ms === 2500 ? 60 : ms) };   // быстрый повтор после 409 — сразу
        const hello = (P, from, lead, fg) => P._onBus({ t: 'hello', from, name: from, leader: !!lead, fg: fg !== false });
        const upd = id => ({ update_id: id });
        const gets = who => tg.calls.filter(c => c.who === who).length;
        const whOf = who => tg.wh.filter(w => w.who === who);
        const tick = async P => { skew += 30000; P._watchTick(); await until(() => !P._lead().watch.busy, 2000); };
        // служба (tvA в её правилах) — пока в стороне: не главная, ТВ на боте один — не опрашивает и в Telegram не смотрит
        await ask('POST', '/alive', { offset: 200, cfg: CFG({ leader: false }) });
        await sleep(700);
        tg.q = []; tg.script = []; tg.calls = []; tg.wh = []; tg.deliv = [];
        const wn0 = ST().loop.wN;
        const stA = { bs_tg_token: TOKEN, bs_tg_chat: '1', bs_tv_id: 'tvA', bs_tg_offset: '200' };
        const stB = { bs_tg_token: TOKEN, bs_tg_chat: '1', bs_tv_id: 'tvB', bs_tg_offset: '200' };
        let A = page(stA, XW('A'), opt);
        const Bp = page(stB, XW('B'), opt);
        hello(A, 'tvB', false); hello(Bp, 'tvA', true);
        await sleep(300);
        t('failover по Telegram: служба в стороне — getWebhookInfo не спрашивает (ТВ на боте один)', ST().loop.wN === wn0 && whOf('').length === 0 && !ST().loop.on);
        // Б запустился раньше, А — позже: новый опрос обрывает прежний, у Б — 409, быстрый повтор, 409 — уступил
        Bp._poll(); await sleep(100); A._poll();
        await until(() => A._lead().isLeader && Bp._lead().held, 4000);
        t('два ТВ: опрашивает один (А), второй (Б) уступил после двух 409', A._lead().isLeader && !Bp._lead().isLeader && Bp._lead().held);
        tgPush(upd(201), upd(202));
        await until(() => tg.q.length === 0 && stA.bs_tg_offset === '203', 3000);
        // главный жив: Б раз в 30 с смотрит getWebhookInfo — 0; сам не опрашивает (ни через минуту, ни потом)
        let gb = gets('B');
        for (let i = 0; i < 4; i++) { await tick(Bp); Bp._poll(); await sleep(250); }
        t('главный жив: уступивший не отнимает бота раз в минуту (нет пинг-понга), Telegram показывает 0', gets('B') === gb && A._lead().isLeader && whOf('B').length === 4 && whOf('B').every(w => w.n === 0));
        const wb = whOf('B').length;
        Bp._watchTick(); Bp._watchTick(); await sleep(150);
        t('getWebhookInfo — не чаще 2 раз в минуту', whOf('B').length === wb);
        // А выдернули из розетки: «bye» нет, опрос оборвался. Апдейты копятся — Б берёт бота через 60–90 с
        dead.A = true;
        await sleep(450);                                                   // висевший запрос А истёк — дальше Telegram не опрашивает никто
        tgPush(upd(203), upd(204));
        let took = 0;
        for (let i = 1; i <= 6 && !took; i++) {
            await tick(Bp);
            if (await until(() => Bp._lead().isLeader, i >= 2 ? 2500 : 50)) took = i;
        }
        t('А пропал без «bye»: Б по getWebhookInfo взял бота через 60–90 с (не через 25 минут)', took >= 2 && took <= 3 && Bp._lead().isLeader && !Bp._lead().held);
        await until(() => tg.q.length === 0, 2000);
        t('апдейты, пришедшие без главного, — у Б', tg.deliv.some(d => d.who === 'B' && d.ids.join() === '203,204') && stB.bs_tg_offset === '205');
        // А вернулся (ТВ включили — Lampa запустилась заново): новый опрос обрывает опрос Б — Б уступает, бот у одного
        A = page(stA, XW('A2'), opt);
        hello(A, 'tvB', false);
        A._poll();
        await until(() => A._lead().isLeader && Bp._lead().held, 4000);
        t('вернувшийся главный ведёт бота, Б уступил (опрашивает один)', A._lead().isLeader && !Bp._lead().isLeader && Bp._lead().held);
        tgPush(upd(205));
        await until(() => tg.q.length === 0 && stA.bs_tg_offset === '206', 3000);
        gb = gets('B'); const ga = gets('A2');
        for (let i = 0; i < 5; i++) { await tick(Bp); Bp._poll(); await sleep(250); }
        t('после возвращения — без пинг-понга: несколько циклов Б не опрашивает, А опрашивает, Telegram — 0', gets('B') === gb && gets('A2') > ga && A._lead().isLeader && !Bp._lead().isLeader &&
            whOf('B').slice(-5).every(w => w.n === 0));
        const dl = {};
        tg.deliv.forEach(d => d.ids.forEach(id => { (dl[id] = dl[id] || []).push(d.who); }));
        t('через обе передачи бота апдейты не потерялись и не пришли дважды', [201, 202, 203, 204, 205].every(id => dl[id] && dl[id].length === 1) &&
            dl[201][0] === 'A' && dl[203][0] === 'B' && dl[205][0] === 'A2');
        stB.bs_tg_chat = '';                                                 // Б больше не нужен
        await sleep(300);

        // очередь: ТВ на экране впереди (меньший id, не главный) — ждём дольше: возьмёт он, а не мы
        const stC = { bs_tg_token: TOKEN, bs_tg_chat: '1', bs_tv_id: 'tvC', bs_tg_offset: '200' };
        let cGets = 0;
        function XC() {
            const x = this; x.setRequestHeader = () => {}; x.getResponseHeader = () => null; x.open = (m, u) => { x.url = u; };
            x.send = () => setImmediate(() => {
                if (/getUpdates/.test(x.url)) { cGets++; x.status = 409; x.responseText = JSON.stringify({ ok: false, error_code: 409, description: 'Conflict: terminated by other getUpdates request' }); }
                else { x.status = 200; x.responseText = JSON.stringify({ ok: true, result: { url: '', pending_update_count: 3 } }); }
                x.onload();
            });
        }
        const C = page(stC, XC, opt);
        hello(C, 'tvA', true); hello(C, 'tvB', false, true);
        C._poll(); await until(() => C._lead().held, 1000);
        const c0 = cGets;
        for (let i = 0; i < 4; i++) await tick(C);                           // 90 с: первому в очереди уже пора, нам — нет
        await sleep(2200);
        const cEarly = cGets === c0;
        await tick(C); await sleep(2200);                                    // 120 с ≥ 45 + 60 — наша очередь
        t('очередь на бота: впереди ТВ на экране — ждём на минуту дольше (главный в очереди не считается)', cEarly && cGets > c0);
        stC.bs_tg_chat = '';

        // ТВ на боте один: 409 — от своей службы, как раньше: getWebhookInfo не спрашиваем, через минуту пробуем снова
        const stS = { bs_tg_token: TOKEN, bs_tg_chat: '1', bs_tv_id: 'tvS', bs_tg_offset: '206' };
        const sc = { gu: 0, wh: 0 };
        function XS() {
            const x = this; x.setRequestHeader = () => {}; x.getResponseHeader = () => null; x.open = (m, u) => { x.url = u; };
            x.send = () => { if (/getUpdates/.test(x.url)) sc.gu++; if (/getWebhookInfo/.test(x.url)) sc.wh++; };   // ответа нет — опрос «висит»
        }
        const S1 = page(stS, XS, opt);
        S1._onConflict();
        t('один ТВ: «уступил» не действует', !S1._lead().held);
        await tick(S1); await tick(S1); await sleep(100);
        t('один ТВ: getWebhookInfo не спрашиваем (лишние запросы)', sc.wh === 0);
        S1._poll();
        t('один ТВ: после паузы опрашивает снова, как раньше', sc.gu === 1);
        stS.bs_tg_chat = '';
        await sleep(500);

        /* случай 2: Lampa на ТВ «Б» закрыта — смотрит его служба (раз в watch; в тесте 150 мс, подряд дольше 250 мс; после 409 — 2,5 с) */
        Object.assign(botCfg.bot, { watch: 150, watchSpan: 250, takeCool: 2500 });
        await until(() => A._lead().isLeader && tg.held, 2000);
        const offA = () => +stA.bs_tg_offset;
        await ask('POST', '/alive', { away: true, offset: offA(), cfg: CFG({ leader: false, others: 1 }) });
        const svW = () => whOf('').length, SP0 = gets('');
        const W0 = svW();
        await sleep(1200);
        const gaps = whOf('').slice(-5).map((w, i, a) => i ? w.at - a[i - 1].at : 999);
        t('служба Б (Lampa закрыта), главный жив: смотрит getWebhookInfo, бота не берёт', svW() > W0 && gets('') === SP0 && !ST().loop.takeover && A._lead().isLeader);
        t('служба: getWebhookInfo не чаще раза в watch', gaps.every(g => g >= 140));
        dead.A2 = true;                                                     // главный снова пропал без «bye»
        await sleep(450);
        const tPush = Date.now();
        tgPush(upd(206), upd(207));
        await until(() => ST().loop.takeover && Q().some(i => i.u.update_id === 207), 4000);
        t('главный пропал, Lampa Б закрыта: служба Б ведёт бота сама (не раньше watchSpan)', ST().loop.takeover && Date.now() - tPush >= 250 && gets('') > SP0 &&
            Q().filter(i => i.u.update_id === 206 || i.u.update_id === 207).length === 2);
        await until(() => tg.q.length === 0, 2000);
        // главный вернулся: его опрос обрывает опрос службы (409) — служба уступает и takeCool в Telegram не смотрит
        A = page(stA, XW('A3'), opt);
        hello(A, 'tvB', false, false);
        A._poll();
        await until(() => A._lead().isLeader && !ST().loop.takeover && ST().loop.yielded, 4000);
        t('вернувшийся главный ведёт бота, служба Б уступила (409)', A._lead().isLeader && !ST().loop.takeover && ST().loop.yielded && ST().loop.coolUntil > SV._test.mono());
        tgPush(upd(208));
        await until(() => tg.q.length === 0 && stA.bs_tg_offset === '209', 3000);
        const SP1 = gets(''), W1 = svW(), coolLeft = ST().loop.coolUntil - SV._test.mono();
        await sleep(Math.max(0, coolLeft - 150));
        t('после 409 служба takeCool не смотрит getWebhookInfo', coolLeft > 1000 && svW() === W1);
        await sleep(900);
        t('после takeCool — снова смотрит, главный жив: без пинг-понга, опрашивает один', svW() > W1 && gets('') === SP1 && !ST().loop.takeover && A._lead().isLeader);
        const dl2 = {};
        tg.deliv.forEach(d => d.ids.forEach(id => { (dl2[id] = dl2[id] || []).push(d.who); }));
        t('служба ↔ страница: апдейты не потерялись и не пришли дважды', [206, 207, 208].every(id => dl2[id] && dl2[id].length === 1) && dl2[206][0] === '' && dl2[208][0] === 'A3');
        await ask('POST', '/alive', { offset: offA(), cfg: CFG({ leader: false, others: 1 }) });
        t('своя страница вернулась — служба не ведёт бота за другого', !ST().loop.takeover && !ST().loop.yielded);
        stA.bs_tg_chat = '';
        delete botCfg.bot.watch; delete botCfg.bot.watchSpan; delete botCfg.bot.takeCool;
        MAP[1][1] = UPB + '/';
        await sleep(300);
    }
    tgSrv.close();
    try { fs.rmSync(dir2, { recursive: true, force: true }); } catch (e) {}

    {
    /* ---- подключение с телефона по Wi-Fi (служба v3) и запасные серверы ntfy ---- */
    // свои «серверы ntfy»: /r<номер>/<тема> — mode[номер] — что отвечать на публикацию (200, 429, 500)
    const relay = { mode: [200, 200, 200, 200], posts: [], gets: [], msgs: {}, n: 0 };
    const rsrv = http.createServer((req, res) => {
        const parts = []; req.on('data', d => parts.push(d)); req.on('end', () => {
            const m = /^\/r(\d)\/([\w-]+)(\/json)?/.exec(req.url), b = Buffer.concat(parts).toString();
            if (!m) { res.writeHead(404); return res.end(); }
            const i = +m[1], key = i + '/' + m[2];
            res.setHeader('Access-Control-Allow-Origin', '*');
            if (req.method === 'POST') {
                relay.posts.push({ i, topic: m[2], b });
                if (relay.mode[i] !== 200) { res.writeHead(relay.mode[i], { 'Content-Type': 'application/json' }); return res.end('{"code":42901,"error":"limit reached"}'); }
                (relay.msgs[key] = relay.msgs[key] || []).push({ id: 'm' + (++relay.n), b });
                res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"id":"x"}');
            }
            relay.gets.push({ i, topic: m[2], u: req.url });
            const since = (/since=([^&]+)/.exec(req.url) || [])[1] || '', all = relay.msgs[key] || [], at = all.findIndex(x => x.id === since);
            res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
            res.end(all.slice(at + 1).map(x => JSON.stringify({ event: 'message', id: x.id, message: x.b })).join('\n') + (all.length ? '\n' : ''));
        });
    });
    await new Promise(r2 => rsrv.listen(0, '127.0.0.1', r2));
    const RB = 'http://127.0.0.1:' + rsrv.address().port;
    const relayPut = (i, topic, b) => { const key = i + '/' + topic; (relay.msgs[key] = relay.msgs[key] || []).push({ id: 'm' + (++relay.n), b }); };
    const resetRelay = () => { relay.mode = [200, 200, 200, 200]; relay.posts.length = 0; relay.gets.length = 0; relay.msgs = {}; };
    // страница: Telegram — снова UPB, ntfy.sh и запасные — в свои /r0/../r3/
    MAP[1][1] = UPB + '/'; MAP[2][1] = RB + '/r0/';
    MAP.push(['https://ntfy.envs.net/', RB + '/r1/'], ['https://ntfy.adminforge.de/', RB + '/r2/'], ['https://ntfy.hostux.net/', RB + '/r3/']);
    t('запасные ntfy: в службе и на странице — один и тот же список, первым ntfy.sh', SV._test.RELAYS.join() === legacy._relays.join() && legacy._relays[0] === 'https://ntfy.sh/' && legacy._relays.length === 4);
    const pairHtml = fs.readFileSync(path.join(__dirname, '..', 'docs', 'pair.html'), 'utf8');
    t('docs/pair.html: вид TV Installer (те же цвета и раскладка, что у страницы с ТВ), без внешних файлов', ['#000000', '#1B1C1F', '#565A62', '#4599FF', '#11374F', '#0E3B2E', '#4A1E22', '#4A3313', '#F2F3F5', '#A6ABB3'].every(c => pairHtml.indexOf(c) >= 0) &&
        /Bahnschrift/.test(pairHtml) && /max-width: 420px/.test(pairHtml) && !/<(script|link|img)[^>]+(src|href)=/i.test(pairHtml) && Buffer.byteLength(pairHtml) < 20480);
    t('запасные ntfy: docs/pair.html — тот же список', legacy._relays.every(u => pairHtml.indexOf("'" + u + "'") >= 0));

    const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'lampa-pair-'));
    const PP = 20400 + Math.floor(Math.random() * 3000);
    const pairCfg = { ports: [PP, PP + 1], host: '127.0.0.1', ttl: 60000, tries: 10, after: 200, wait: 5000 };
    const lanCfg = { port: SVP, dir: dir3, log: false, lanIp: '127.0.0.1', pair: pairCfg,
        up: { tg: UPB + '/', ntfy: RB + '/r0/', relays: [RB + '/r0/', RB + '/r1/'], groq: UPB + '/groq/', gemini: UPB + '/gemini/', openrouter: UPB + '/or/' } };
    await new Promise(r2 => SV._test.stop(r2)); SV._test.config(lanCfg); await new Promise(r2 => SV._test.start(r2));
    keyDir = dir3;
    const lanBodies = [];
    const lan = (method, p, body, headers, port) => new Promise(res => {
        const b = body === undefined ? null : Buffer.from(body);
        const rq = http.request({ host: '127.0.0.1', port: port || PP, agent: false, method, path: p, headers: Object.assign(b ? { 'Content-Length': b.length } : {}, headers || {}) }, x => {
            const parts = []; x.on('data', d => parts.push(d)); x.on('end', () => { const s = Buffer.concat(parts).toString(); lanBodies.push(s); res({ st: x.statusCode, h: x.headers, s }); });
        });
        rq.on('error', e => res({ st: 0, e })); rq.end(b || undefined);
    });
    const SEC = 'abcdefghjkmnpqrstuvw23';
    t('по Wi-Fi: по умолчанию — 0.0.0.0, порты 8898..8901, 15 минут, 10 неверных', SV._test.PAIR.host === '0.0.0.0' && SV._test.PAIR.ports.join() === '8898,8899,8900,8901' && SV._test.PAIR.ttl === 15 * 60000 && SV._test.PAIR.tries === 10);
    t('по Wi-Fi: /health — версия 4', (await ask('GET', '/health')).j.v === 4);
    t('по Wi-Fi: /pair/start без ключа — 401', (await ask('POST', '/pair/start', { secret: SEC }, { 'X-Lampa-Key': '' })).st === 401);
    t('по Wi-Fi: /pair/start — секрет короткий или не [a-z0-9] — 400', (await ask('POST', '/pair/start', { secret: 'abc' })).st === 400 && (await ask('POST', '/pair/start', { secret: 'ABCDEFGHIJKLMNOPQRS' })).st === 400);
    t('по Wi-Fi: до /pair/start сервера для телефона нет', (await lan('GET', '/p/' + SEC)).st === 0 && (await ask('GET', '/pair/status')).j.open === false);
    r = await ask('POST', '/pair/start', { secret: SEC });
    t('по Wi-Fi: /pair/start — порт и адрес ТВ в сети', r.st === 200 && r.j.ok && r.j.port === PP && r.j.ip === '127.0.0.1');
    r = await ask('GET', '/pair/status');
    t('по Wi-Fi: /pair/status — открыт, токена ещё нет', r.st === 200 && r.j.open === true && r.j.got === false);
    let LP = await lan('GET', '/p/' + SEC);
    t('по Wi-Fi: страница для телефона — по-русски по умолчанию, поле и «Отправить», без скриптов и внешних файлов', LP.st === 200 && /text\/html/.test(LP.h['content-type']) && /<html lang="ru">/.test(LP.s) &&
        /Токен бота от @BotFather/.test(LP.s) && />Отправить</.test(LP.s) && !/<script|src=|<link/i.test(LP.s) && /default-src 'none'/.test(LP.h['content-security-policy']) && LP.h['referrer-policy'] === 'no-referrer' && !LP.h['access-control-allow-origin']);
    t('по Wi-Fi: страница в цветах TV Installer (Ink, InkElevated, Sky, контур, текст), значок — встроенный SVG, ни одного внешнего адреса, меньше 10 КБ',
        ['#000000', '#1B1C1F', '#26282C', '#565A62', '#4599FF', '#11374F', '#CDE7FF', '#F2F3F5', '#A6ABB3'].every(c => LP.s.indexOf(c) >= 0) && /<svg[^>]*stroke="#4599FF"/.test(LP.s) &&
        /Bahnschrift/.test(LP.s) && !/https?:\/\//.test(LP.s) && /max-width:420px/.test(LP.s) && Buffer.byteLength(LP.s) < 10240 && (LP.s.match(/class="n"/g) || []).length === 3);
    const langOf = async al => { const x = await lan('GET', '/p/' + SEC, undefined, { 'Accept-Language': al }); return (/<html lang="(\w+)">/.exec(x.s) || [])[1] + '|' + (/Yuborish/.test(x.s) ? 'uz' : />Send</.test(x.s) ? 'en' : />Отправить</.test(x.s) ? 'ru' : '?'); };
    t('по Wi-Fi: язык страницы — по Accept-Language (ru / en / uz), остальное — ru', (await langOf('en-US,en;q=0.9')) === 'en|en' && (await langOf('uz-UZ,uz;q=0.9,ru;q=0.8')) === 'uz|uz' &&
        (await langOf('de-DE,de;q=0.9,en;q=0.8')) === 'en|en' && (await langOf('fr-FR')) === 'ru|ru' && (await langOf('ru-RU')) === 'ru|ru');
    t('по Wi-Fi: на сервере для телефона есть только /p/<секрет> — остальное 404', (await lan('GET', '/')).st === 404 && (await lan('GET', '/health')).st === 404 &&
        (await lan('GET', '/pair/status')).st === 404 && (await lan('PUT', '/p/' + SEC, 'x')).st === 404 && (await lan('GET', '/p/' + SEC + '/x')).st === 404);
    t('по Wi-Fi: неверный секрет — 404', (await lan('GET', '/p/' + SEC.slice(0, -1) + 'x')).st === 404 && SV._test.pair().bad === 1);
    const FORMH = { 'Content-Type': 'application/x-www-form-urlencoded' };
    LP = await lan('POST', '/p/' + SEC, 'token=abc', FORMH);
    t('по Wi-Fi: не похоже на токен — 400 и подсказка, к Telegram не ходили', LP.st === 400 && /не похоже на токен/.test(LP.s) && !seen.some(s => /\/botabc\//.test(s.u)));
    t('по Wi-Fi: тело больше 4 КБ — 413', (await lan('POST', '/p/' + SEC, 'token=' + 'a'.repeat(5000), FORMH)).st === 413);
    const BADTOK = '987654321:' + 'B'.repeat(35);
    LP = await lan('POST', '/p/' + SEC, 'token=' + encodeURIComponent(BADTOK), Object.assign({ 'Accept-Language': 'en' }, FORMH));
    t('по Wi-Fi: Telegram не принял токен — «проверьте и вставьте ещё раз» (на языке телефона), токен не сохранён и не показан', LP.st === 400 && /Telegram didn't accept the token/.test(LP.s) &&
        LP.s.indexOf(BADTOK) < 0 && seen.some(s => s.u === '/bot' + BADTOK + '/getMe') && !fs.existsSync(path.join(dir3, 'secrets.json')) && (await ask('GET', '/pair/status')).j.got === false);
    LP = await lan('POST', '/p/' + SEC, ' ' + TOKEN + '\n', { 'Content-Type': 'text/plain' });
    t('по Wi-Fi: токен принят (просто текстом) — «Готово», токена в ответе нет', LP.st === 200 && /✅ Готово\. Теперь напишите своему боту в Telegram любое сообщение/.test(LP.s) && LP.s.indexOf(TOKEN) < 0);
    t('по Wi-Fi: токен проверен у Telegram (getMe) и сохранён секретом tg — в файле службы', seen.some(s => s.u === '/bot' + TOKEN + '/getMe') && JSON.parse(fs.readFileSync(path.join(dir3, 'secrets.json'), 'utf8')).tg === TOKEN);
    r = await ask('GET', '/pair/status');
    t('по Wi-Fi: /pair/status — got, без токена', r.j.got === true && r.s.indexOf(TOKEN) < 0 && (await ask('GET', '/health')).j.has.tg === true);
    t('по Wi-Fi: после токена сервер для телефона закрылся сам', await until(() => !SV._test.pair().open, 2000) && (await lan('GET', '/p/' + SEC)).st === 0 && (await ask('GET', '/pair/status')).j.open === false);
    t('по Wi-Fi: ни один ответ (службы и для телефона) не содержит токена', !lanBodies.some(b => b.indexOf(TOKEN) >= 0) && !bodies.some(b => b.indexOf(TOKEN) >= 0));
    // 10 неверных адресов — сервер закрывается
    await ask('POST', '/pair/start', { secret: SEC });
    for (let i = 0; i < 9; i++) await lan('GET', '/p/wrongsecret' + i);
    const ok9 = (await lan('GET', '/p/' + SEC)).st === 200 && SV._test.pair().open;
    await lan('GET', '/p/wrongsecret9');
    t('по Wi-Fi: после 10 неверных секретов сервер закрывается (и верный уже не открыть)', ok9 && await until(() => !SV._test.pair().open, 2000) && (await lan('GET', '/p/' + SEC)).st === 0);
    // /pair/stop и время жизни
    await ask('POST', '/pair/start', { secret: SEC });
    r = await ask('POST', '/pair/stop', {});
    const r2s = await ask('POST', '/pair/stop', { secret: 'x'.repeat(SEC.length) });
    t('по Wi-Fi: /pair/stop без секрета или с чужим — не закрывает (старый запрос не закроет новое окно)', r.st === 200 && r.j.closed === false && r2s.j.closed === false && SV._test.pair().open);
    r = await ask('POST', '/pair/stop', { secret: SEC });
    t('по Wi-Fi: /pair/stop — закрыт', r.st === 200 && r.j.ok && r.j.closed === true && !SV._test.pair().open && (await lan('GET', '/p/' + SEC)).st === 0);
    pairCfg.ttl = 300;
    await ask('POST', '/pair/start', { secret: SEC });
    const openT = SV._test.pair().open;
    await sleep(500);
    t('по Wi-Fi: через ttl (15 минут) закрывается сам', openT && !SV._test.pair().open && (await lan('GET', '/p/' + SEC)).st === 0);
    pairCfg.ttl = 60000;
    // порт занят — следующий; все заняты — 503
    const busy1 = http.createServer(() => {}); await new Promise(r2 => busy1.listen(PP, '127.0.0.1', r2));
    r = await ask('POST', '/pair/start', { secret: SEC });
    t('по Wi-Fi: порт занят — следующий', r.st === 200 && r.j.port === PP + 1 && (await lan('GET', '/p/' + SEC, undefined, {}, PP + 1)).st === 200);
    await ask('POST', '/pair/stop', { secret: SEC });
    const busy2 = http.createServer(() => {}); await new Promise(r2 => busy2.listen(PP + 1, '127.0.0.1', r2));
    r = await ask('POST', '/pair/start', { secret: SEC });
    t('по Wi-Fi: все порты заняты — 503', r.st === 503 && r.j.error === 'port' && !SV._test.pair().open);
    // страница: все порты заняты — /pair/start не удался — сразу QR через ntfy
    const modals = [], qrs = [], dollars = [];
    const $f = html => { const o = { html: String(html), texts: {}, find: sel => ({ 0: {}, text: x => { o.texts[sel] = x; } }) }; dollars.push(o); return o; };
    const lampaP = Object.assign({}, tz.Lampa, { Modal: { open: o => modals.push(o), close() {} }, Controller: { enabled: () => ({ name: 'settings_component' }), toggle() {} },
        Utils: { qrcode: u => qrs.push(u) }, Noty: { show() {} }, SettingsApi: null });
    const fastTimers = { setInterval: f => setInterval(f, 60), clearInterval: h => clearInterval(h), $: $f, document: { hidden: false } };
    const pageP = (st, log) => page(st, mkXHR({ log }), Object.assign({}, tz, { Lampa: lampaP }, fastTimers));
    const xp = [], stP0 = { bs_tv_id: 'tvP' };
    const P0 = pageP(stP0, xp);
    P0._svcStart(); await until(() => P0._svc.up);
    P0._pairPhone(); await until(() => modals.length === 1);
    t('страница: /pair/start не удался (порты заняты) — сразу QR на pair.html (ntfy), без кнопки «Другой способ»', xp.some(x => /\/pair\/start$/.test(x.url)) && /^https:\/\/sunic007\.github\.io\/lampa-samsung\/pair\.html#lampa-[a-z0-9]+\.[a-z0-9]{22}$/.test(qrs[0]) && !modals[0].buttons);
    P0._pairStop();
    busy1.close(); busy2.close();
    // страница: служба старая (v2) / нет службы — QR через ntfy, /pair/start не спрашиваем
    const xo = [], Pold = pageP({ bs_tv_id: 'tvO' }, xo);
    Pold._svc.up = true; Pold._svc.v = 2; Pold._svc.store = 'ok';
    Pold._pairPhone();
    const Pnone = pageP({ bs_tv_id: 'tvN' }, xo);
    Pnone._pairPhone();
    t('страница: служба старая (v2) или её нет — QR на pair.html, /pair/start не спрашиваем', modals.length === 3 && /pair\.html#/.test(qrs[1]) && /pair\.html#/.test(qrs[2]) && !xo.some(x => /\/pair\//.test(x.url)));
    Pold._pairStop(); Pnone._pairStop();
    // страница: по Wi-Fi от QR до первого сообщения боту
    await ask('POST', '/forget', {});
    const xl = [], stP = { bs_tv_id: 'tvP', bs_tg_offset: '777' };
    const P1 = pageP(stP, xl);
    P1._svcStart(); await until(() => P1._svc.up && P1._svc.v === 4);
    P1._pairPhone(); await until(() => modals.length === 4);
    const lanUrl = qrs[3], lanM = /^http:\/\/127\.0\.0\.1:(\d+)\/p\/([a-z0-9]{22})$/.exec(lanUrl || ''), dl = dollars[dollars.length - 1];
    t('страница: служба v3 — QR на http://<ip ТВ>:<порт>/p/<секрет>, под QR — «Телефон — в той же Wi-Fi, что и телевизор»', !!lanM && +lanM[1] === PP && /Телефон — в той же Wi-Fi, что и телевизор/.test(dl.html) && SV._test.pair().open);
    t('страница: по Wi-Fi — кнопка «Не открывается? Другой способ»', modals[3].buttons && modals[3].buttons[0].name === 'Не открывается? Другой способ');
    await sleep(200);
    t('страница: ждёт токен через /pair/status, ntfy не спрашивает', xl.some(x => /\/pair\/status$/.test(x.url)) && !xl.some(x => /ntfy|\/r\d\//.test(x.url) || x.url.indexOf(RB) === 0 || /^https:\/\/ntfy/.test(x.url)));
    LP = await lan('POST', '/p/' + lanM[2], 'token=' + encodeURIComponent(TOKEN), Object.assign({ 'Accept-Language': 'uz' }, FORMH));
    t('телефон: токен по Wi-Fi — «Tayyor» (по-узбекски)', LP.st === 200 && /✅ Tayyor/.test(LP.s) && LP.s.indexOf(TOKEN) < 0);
    await until(() => P1._pairNow() && P1._pairNow().stage === 'chat');
    t('страница: got — номер апдейта прежнего бота стёрт', !('bs_tg_offset' in stP));
    t('страница: got — токена у страницы нет, метка bs_tg_svc, ждём первое сообщение боту', P1._pairNow() && P1._pairNow().stage === 'chat' && stP.bs_tg_svc === '1' && !('bs_tg_token' in stP) && stP.bs_tg_chat === '' &&
        xl.some(x => x.url === 'http://127.0.0.1:8897/tg/getMe'));
    await until(() => P1._svc.d);
    t('страница: тема канала ТВ — от службы (/derive), как после переноса', P1._svc.d && P1._busTopic() === legacy._busTopic());
    updates = [{ update_id: 40, message: { message_id: 9, chat: { id: 77, type: 'private' }, from: { id: 77 }, text: 'привет', date: Math.floor(Date.now() / 1000) } }];
    await until(() => stP.bs_tg_chat === '77' && !P1._pairNow(), 4000);
    updates = [];
    t('страница: первое сообщение боту — чат запомнен, подключение закончено (getUpdates через службу)', stP.bs_tg_chat === '77' && !P1._pairNow() && xl.some(x => x.url === 'http://127.0.0.1:8897/tg/getUpdates'));
    await until(() => tgBody && /chat_id=77/.test(tgBody), 2000);
    t('страница: «✅ Lampa подключена» — в чат через службу; токена у страницы нет', /chat_id=77/.test(tgBody || '') && !JSON.stringify(stP).includes(TOKEN));
    // «Другой способ»: QR через ntfy, сервер для телефона закрыт
    const P2l = pageP({ bs_tv_id: 'tvQ' }, []);
    P2l._svcStart(); await until(() => P2l._svc.up);
    const mBefore = modals.length;
    P2l._pairPhone(); await until(() => modals.length === mBefore + 1 && SV._test.pair().open);
    modals[modals.length - 1].buttons[0].onSelect();
    t('страница: «Другой способ» — новое окно с QR на pair.html, сервер для телефона закрыт (/pair/stop)', modals.length === mBefore + 2 && /pair\.html#/.test(qrs[qrs.length - 1]) && !modals[modals.length - 1].buttons &&
        await until(() => !SV._test.pair().open, 2000) && P2l._pairNow() && !P2l._pairNow().lan);
    P2l._pairStop();
    // отмена (назад) — сервер закрыт
    P2l._pairPhone(); await until(() => SV._test.pair().open);
    modals[modals.length - 1].onBack();
    t('страница: отмена — /pair/stop, сервер для телефона закрыт', await until(() => !SV._test.pair().open, 2000) && !P2l._pairNow());

    // служба /join: ntfy.sh ответил 429 — запасной
    updates = [{ update_id: 50, message: { message_id: 10, chat: { id: 1, type: 'private' }, text: 'K2M3 N4P5 Q6R7', date: 1 } }];
    await ask('POST', '/secret', { name: 'tg', value: TOKEN });
    await ask('POST', '/tg/getUpdates', 'offset=1&timeout=0', { 'Content-Type': 'application/x-www-form-urlencoded' });
    updates = [];
    resetRelay(); relay.mode[0] = 429;
    r = await ask('POST', '/join', { code: 'K2M3N4P5Q6R7', chat: '1' });
    t('служба /join: ntfy.sh — 429, токен ушёл в запасной сервер (зашифрован)', r.st === 200 && r.j.ok && r.j.relay === 1 && relay.posts.map(x => x.i).join() === '0,1' &&
        relay.posts[1].topic === legacy._joinTopic('K2M3N4P5Q6R7') && relay.posts[1].b.indexOf(TOKEN) < 0);

    // страница: relayPost — 429 и 5xx — дальше; принявший — в ответе
    resetRelay(); relay.mode = [429, 500, 200, 200];
    const T1 = page({ bs_tg_token: TOKEN, bs_tg_chat: '1', bs_tv_id: 'tvR' }, mkXHR(), fastTimers);
    let rp = null; T1._relayPost('lampa-x', 'hi', 0, (st, i) => { rp = [st, i]; });
    await until(() => rp);
    t('relayPost: 429 и 500 — следующий сервер, ответ — принявший', rp[0] === 200 && rp[1] === 2 && relay.posts.map(x => x.i).join() === '0,1,2');
    resetRelay(); relay.mode = [429, 429, 429, 429]; rp = null;
    T1._relayPost('lampa-x', 'hi', 0, (st, i) => { rp = [st, i]; }); await until(() => rp);
    t('relayPost: все не приняли — -1 и 429', rp[0] === 429 && rp[1] === -1 && relay.posts.length === 4);
    // канал ТВ: ntfy.sh — 429 — запасной, запомнен, слушаем его и ntfy.sh
    resetRelay(); relay.mode[0] = 429;
    const stB = { bs_tg_token: TOKEN, bs_tg_chat: '1', bs_tv_id: 'tvB' };
    const PB = page(stB, mkXHR(), fastTimers);
    PB._busSend({ t: 'who' });
    await until(() => stB.bs_tg_relay === '1');
    await until(() => relay.posts.length >= 3, 2000);
    const busTopic = legacy._busTopic(), openB = b => legacy._crypt.open(legacy._busKey(), JSON.parse(b));
    t('канал ТВ: ntfy.sh ответил 429 — сообщение ушло в запасной, он запомнен (bs_tg_relay)', stB.bs_tg_relay === '1' && relay.posts.slice(0, 2).map(x => x.i).join() === '0,1' && relay.posts.every(x => x.topic === busTopic) && /"t":"who"/.test(openB(relay.posts[1].b)));
    t('канал ТВ: перешёл сам — «мы на сервере 1» и на ntfy.sh (его слушают все)', relay.posts.length === 3 && relay.posts[2].i === 0 && (m => m.t === 'relay' && m.r === 1)(JSON.parse(openB(relay.posts[2].b))));
    await until(() => relay.gets.some(g => g.i === 1 && g.topic === busTopic) && relay.gets.some(g => g.i === 0 && g.topic === busTopic), 2000);
    t('канал ТВ: слушаем запомненный сервер и ntfy.sh', Object.keys(PB._busStreams()).sort().join() === '0,1' && relay.gets.some(g => g.i === 1) && relay.gets.some(g => g.i === 0));
    relay.posts.length = 0;
    PB._busSend({ t: 'who' }); await until(() => relay.posts.length);
    t('канал ТВ: дальше — сразу в запомненный', relay.posts.map(x => x.i).join() === '1');
    // другой ТВ на ntfy.sh (нас не слышит) — говорим ему, где мы; он переходит
    relay.mode[0] = 200; relay.posts.length = 0;
    relayPut(0, busTopic, JSON.stringify(legacy._crypt.seal(legacy._busKey(), JSON.stringify({ t: 'hello', from: 'tvC', name: 'Кухня', ts: Date.now() }))));
    await until(() => relay.posts.some(x => x.i === 0), 8000);
    const tell = relay.posts.filter(x => x.i === 0).map(x => JSON.parse(openB(x.b)));
    t('канал ТВ: сообщение по ntfy.sh от ТВ, который нас не слышит, — ему «мы на сервере 1»', tell.length === 1 && tell[0].t === 'relay' && tell[0].r === 1 && tell[0].from === 'tvB');
    const stC = { bs_tg_token: TOKEN, bs_tg_chat: '1', bs_tv_id: 'tvC' };
    const PC2 = page(stC, mkXHR(), fastTimers);
    PC2._busStart();
    await until(() => stC.bs_tg_relay === '1', 3000);
    t('канал ТВ: ТВ на ntfy.sh получил «relay» — перешёл и слушает тот же запасной', stC.bs_tg_relay === '1' && await until(() => Object.keys(PC2._busStreams()).sort().join() === '0,1', 2000));
    PB._busStop(); PC2._busStop();
    // запасной 1 тоже упёрся в лимит — переходим на 2 и говорим об этом на ntfy.sh и на прежнем (1): ТВ, слушающие 1, услышат
    resetRelay(); relay.mode[1] = 429;
    const stD = { bs_tg_token: TOKEN, bs_tg_chat: '1', bs_tv_id: 'tvD', bs_tg_relay: '1' };
    const PD = page(stD, mkXHR(), fastTimers);
    PD._busSend({ t: 'who' });
    await until(() => stD.bs_tg_relay === '2' && relay.posts.length >= 4, 3000);
    const ann = relay.posts.slice(2).map(x => ({ i: x.i, m: JSON.parse(openB(x.b)) }));
    t('канал ТВ: сменил запасной — «relay» и на ntfy.sh, и на прежнем сервере', stD.bs_tg_relay === '2' && relay.posts.slice(0, 2).map(x => x.i).join() === '1,2' &&
        ann.map(a => a.i).sort().join() === '0,1' && ann.every(a => a.m.t === 'relay' && a.m.r === 2));
    // услышал «relay» от другого ТВ — переходит молча (не пересказывает: иначе два ТВ перекидывали бы друг друга)
    resetRelay();
    const stE = { bs_tg_token: TOKEN, bs_tg_chat: '1', bs_tv_id: 'tvE', bs_tg_relay: '1' };
    const PE = page(stE, mkXHR(), fastTimers);
    PE._onBus({ t: 'relay', r: 2, from: 'tvD' });
    await sleep(300);
    t('канал ТВ: «relay» от другого ТВ — перешёл, сам ничего не публикует', stE.bs_tg_relay === '2' && relay.posts.length === 0);
    PD._busStop(); PE._busStop();

    // QR через ntfy: ТВ слушает тему на всех серверах по очереди; токен пришёл в запасной
    resetRelay();
    const stR = { bs_tv_id: 'tvR2' };
    const PR2 = page(stR, mkXHR({ svcDown: true }), Object.assign({ Lampa: lampaP }, fastTimers));
    PR2._pairPhone();
    const rq = PR2._pairNow(), relayUrl = qrs[qrs.length - 1];
    t('QR через ntfy: без службы — QR на pair.html', /pair\.html#/.test(relayUrl) && rq && !rq.lan);
    // docs/pair.html в песочнице: ntfy.sh — 429, запасной принял
    const runPair = (hash, langs) => {
        const els = {}; ['h', 'sub', 's1', 's2', 's3', 'lbl', 'b', 's', 't'].forEach(id => { els[id] = { id, innerHTML: '', textContent: '', className: '', value: '' }; });
        const ctx = { console, JSON, String, Math, Array, Object, parseInt, encodeURIComponent, decodeURIComponent, unescape, escape, setTimeout, Uint8Array,
            btoa: s => Buffer.from(s, 'binary').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('binary'),
            document: { getElementById: id => els[id], documentElement: {} }, location: { hash }, navigator: { languages: langs || ['ru-RU'], language: (langs || ['ru'])[0] }, XMLHttpRequest: mkXHR() };
        ctx.window = ctx; ctx.crypto = nodeCrypto.webcrypto;
        vm.createContext(ctx); vm.runInContext(/<script>([\s\S]*)<\/script>/.exec(pairHtml)[1], ctx);
        return els;
    };
    await until(() => relay.gets.filter(g => g.topic === rq.topic).length >= 4, 3000);          // ТВ уже опросил все серверы
    relay.mode[0] = 429;
    const ph = runPair('#' + relayUrl.split('#')[1]);
    ph.t.value = ' ' + TOKEN + ' ';
    ph.b.onclick.call(ph.b);
    await until(() => /ok|err/.test(ph.s.className), 3000);
    t('pair.html: ntfy.sh — 429 — молча в запасной; человеку — только «Отправлено»', ph.s.className === 'm ok' && /Отправлено/.test(ph.s.textContent) && relay.posts.map(x => x.i).join() === '0,1' && relay.posts[1].b.indexOf(TOKEN) < 0);
    await until(() => stR.bs_tg_token === TOKEN, 6000);
    t('QR через ntfy: ТВ нашёл токен на запасном сервере (опрос всех по очереди)', stR.bs_tg_token === TOKEN && [0, 1, 2, 3].every(i => relay.gets.some(g => g.i === i && g.topic === rq.topic)));
    const g4 = relay.gets.filter(g => g.topic === rq.topic).slice(0, 4).map(g => g.i).join();
    t('QR через ntfy: по одному серверу в такт — 0, 1, 2, 3', g4 === '0,1,2,3');
    PR2._pairStop();
    resetRelay(); relay.mode = [429, 429, 500, 429];
    const ph2 = runPair('#lampa-abcdefghjk.' + SEC, ['en-US']);
    ph2.t.value = TOKEN; ph2.b.onclick.call(ph2.b);
    await until(() => /ok|err/.test(ph2.s.className), 3000);
    t('pair.html: все серверы не приняли — понятный текст про лимит (на языке телефона), только в конце', ph2.s.className === 'm err' && /daily limit/.test(ph2.s.textContent) && relay.posts.filter(x => x.topic === 'lampa-abcdefghjk').map(x => x.i).join() === '0,1,2,3' && ph2.b.textContent === 'Send to TV' && ph2.h.textContent === 'Connect a Telegram bot');
    // второй ТВ по коду: ответ в запасном сервере — найден
    resetRelay();
    const stJ = { bs_tv_id: 'tvJ' };
    const PJ = page(stJ, mkXHR({ svcDown: true }), Object.assign({ Lampa: lampaP }, fastTimers));
    PJ._pairJoin();
    const jq = PJ._pairNow();
    stJ.bs_tg_offset = '777';                                         // номер от прежнего бота
    await until(() => relay.posts.some(x => x.topic === jq.topic), 4000);
    const hi = relay.posts.filter(x => x.topic === jq.topic).map(x => JSON.parse(x.b));
    t('второй ТВ по коду: 6 цифр, в теме кода — только открытый ключ (hi4), без секретов', /^\d{6}$/.test(jq.code) && jq.topic === legacy._join4.topic(jq.code) &&
        hi.length === 1 && hi[0].t === 'hi4' && legacy._crypt.unb64(hi[0].pk).length === 32 && Object.keys(hi[0]).sort().join() === 'pk,t,ts');
    // старый ответ (ключ из кода, v3) новый ТВ не принимает — только join4 своим ключом
    relayPut(1, jq.topic, JSON.stringify(legacy._crypt.seal(legacy._joinKeys(jq.code).key, JSON.stringify({ t: 'join', token: TOKEN, chat: '9', ts: Date.now() }))));
    relayPut(2, jq.topic, JSON.stringify(legacy._join4.box(jq.code, hi[0].pk, JSON.stringify({ t: 'join', token: TOKEN, chat: '1', ts: Date.now() }))));
    await until(() => stJ.bs_tg_token === TOKEN, 6000);
    t('второй ТВ по коду: ответ лёг в запасной сервер — найден (опрос всех по очереди)', stJ.bs_tg_token === TOKEN && stJ.bs_tg_chat === '1' && !PJ._pairNow());
    t('второй ТВ по коду: новый токен — номер апдейта прежнего бота стёрт (опрос начнётся с offset=-1)', !('bs_tg_offset' in stJ));
    // главный ТВ (страница, токен у неё): цифры от человека — ключ нового ТВ на всех серверах, ровно один — подключение
    {
        const code = '481527', top = legacy._join4.topic(code), sk = legacy._crypt.rnd(32), pk = legacy._crypt.x25519(sk, legacy._join4.BASE9);
        relayPut(3, top, JSON.stringify({ t: 'hi4', pk: legacy._crypt.b64(pk), ts: 1 }));
        relayPut(0, top, JSON.stringify({ t: 'hi4', pk: legacy._crypt.b64(pk), ts: 2 }));        // тот же ТВ повторил — не второй
        const PM = page({ bs_tg_token: TOKEN, bs_tg_chat: '1', bs_tv_id: 'tvM' }, mkXHR({ svcDown: true }), Object.assign({ Lampa: lampaP }, fastTimers)), gets0 = relay.gets.length;
        let st = null;
        PM._join4.send(code, x => { st = x; });
        await until(() => st !== null, 4000);
        const posted = relay.posts.filter(x => x.topic === top).map(x => JSON.parse(x.b));
        const opened = posted[0] && legacy._join4.open({ code, sk, pk }, posted[0]);
        t('главный ТВ: 6 цифр — подключение только для ключа из темы, токен зашифрован (X25519)', st === 200 && posted.length === 1 && posted[0].t === 'join4' &&
            JSON.parse(opened).token === TOKEN && posted.every(x => JSON.stringify(x).indexOf(TOKEN) < 0) && [0, 1, 2, 3].every(i => relay.gets.slice(gets0).some(g => g.i === i && g.topic === top)));
        t('главный ТВ: чужой ключ (не тот ТВ) подключение не откроет', legacy._join4.open({ code, sk: legacy._crypt.rnd(32), pk }, posted[0]) === null &&
            legacy._join4.open({ code: '481528', sk, pk }, posted[0]) === null);
        relayPut(2, top, JSON.stringify({ t: 'hi4', pk: legacy._crypt.b64(legacy._crypt.x25519(legacy._crypt.rnd(32), legacy._join4.BASE9)), ts: 3 }));
        const np = relay.posts.filter(x => x.topic === top).length; st = null;
        PM._join4.send(code, x => { st = x; });
        await until(() => st !== null, 4000);
        t('главный ТВ: в теме два разных ключа (кто-то подсунул свой) — 409, токен никуда не ушёл', st === 409 && relay.posts.filter(x => x.topic === top).length === np);
        st = null;
        PM._join4.send('111222', x => { st = x; });
        await until(() => st !== null, 4000);
        t('главный ТВ: ТВ с таким кодом нет — 404', st === 404);
    }
    rsrv.close();
    try { fs.rmSync(dir3, { recursive: true, force: true }); } catch (e) {}
    }

    await new Promise(r2 => SV._test.stop(r2));
    up.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
}

/* ---- bsreport.js: отчёт о проблеме с ТВ ---- */
{
    const R = load('bsreport.js', 'BSReport', { bs_tv_model: 'QE55Q60BAU', bs_tg_token: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ', bs_guard: 'true', bs_tg_chat: '555' });
    const c = R.M._clean;
    t('отчёт: токен бота и ключ ИИ убраны', !/AAHdqTcv/.test(c('tok 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ')) && /\[ключ\]/.test(c('k AIzaSyA1234567890abcdefghijklmnopqrstu')));
    t('отчёт: параметры адресов убраны (ключ аккаунта Skaz)', c('GET http://online3.skaz.tv/lite/rezka?account_email=a%40b.c&uid=77&s=1') === 'GET http://online3.skaz.tv/lite/rezka?…');
    t('отчёт: внешний IP — без последней цифры, домашний — как есть', c('95.214.10.5 192.168.1.7') === '95.214.10.x 192.168.1.7');
    t('отчёт: почта и код подключения убраны', c('a.b@mail.ru 7AWN-CX5K-GTKY') === '[почта] [код]');
    R.M._add('', ['BSGuard', 'зависание', { a: 1 }]); R.M._add('', ['BSGuard', 'зависание', { a: 1 }]); R.M._add('ERROR ', ['boom']);
    t('отчёт: повторы строк сворачиваются', R.M._lines().length === 2 && R.M._lines()[0].n === 2);
    const b = R.M._build('video', 'Видео не запускается');
    t('отчёт: вид, модель ТВ, журнал', b.kind === 'video' && b.meta.tv === 'QE55Q60BAU' && /зависание/.test(b.log) && /×2/.test(b.log));
    t('отчёт: в настройках нет токена и чата', !/tg_token|tg_chat|AAHd/.test(b.meta.settings) && !/AAHd/.test(JSON.stringify(b)));
    t('отчёт: id устройства постоянный, не токен', /^[a-z0-9]{16}$/.test(b.device) && R.M._build('other', 'x').device === b.device);
    for (let i = 0; i < 300; i++) R.M._add('', ['строка ' + i + ' ' + 'x'.repeat(400)]);
    t('отчёт: журнал ограничен по строкам и длине', R.M._lines().length === 250 && R.M._lines()[249].text.length <= 301);
}
{
    // отправка: Worker ответил — номер задачи; Worker недоступен — через ntfy; 429 — лимит, ntfy не трогаем
    const mk = (statuses) => {
        const R = load('bsreport.js', 'BSReport'), urls = [];
        const ctxX = function () {};
        ctxX.prototype = { open(m, u) { this.u = u; urls.push(u); }, setRequestHeader() {}, send() { const s = statuses[this.u.indexOf('workers.dev') > 0 ? 'w' : 'n']; this.status = s[0]; this.responseText = s[1]; if (s[0]) this.onload(); else this.onerror(); } };
        return { R, urls, X: ctxX };
    };
    const run = (statuses) => {
        const m = mk(statuses); let got = null;
        const vm2 = require('vm'); const ctx = { window: { localStorage: { getItem: () => null, setItem() {} } }, XMLHttpRequest: m.X, JSON, Math, Date, String, Array, Object, navigator: { onLine: true } };
        ctx.window.window = ctx.window; vm2.createContext(ctx);
        vm2.runInContext(fs.readFileSync(path.join(SRC, 'bsreport.js'), 'utf8') + ';this.M=BSReport;', ctx);
        ctx.M._send({ kind: 'video' }, r => { got = r; });
        return { got, urls: m.urls };
    };
    let r = run({ w: [200, '{"ok":true,"number":12,"url":"https://github.com/sunic007/lampa-samsung/issues/12"}'], n: [200, ''] });
    t('отчёт: Worker ответил — номер задачи', r.got.ok && r.got.number === 12 && r.urls.length === 1);
    r = run({ w: [0, ''], n: [200, ''] });
    t('отчёт: Worker недоступен — ушло через ntfy', r.got.ok && r.got.queued && /ntfy\.sh\/sunicapps-tv-report-v1$/.test(r.urls[1]));
    r = run({ w: [429, '{"ok":false,"error":"limit"}'], n: [200, ''] });
    t('отчёт: лимит — так и говорим, ntfy не трогаем', !r.got.ok && r.got.limit && r.urls.length === 1);
}

{
    // проверка связи перед отчётом: какой сервер отвечает — задаёт тест (dead — адреса, которые «не пускают»)
    const net = (dead, store) => {
        const vm2 = require('vm'), urls = [];
        const X = function () {};
        X.prototype = { open(m, u) { this.u = u; urls.push(m + ' ' + u); }, send() { const d = dead.some(h => this.u.indexOf(h) >= 0); this.status = d ? 0 : 204; if (d) this.onerror(); else this.onload(); } };
        const st = store || {};
        const ctx = { window: { localStorage: { getItem: k => (k in st ? st[k] : null), setItem() {} } }, XMLHttpRequest: X, JSON, Math, Date, String, Array, Object, navigator: { onLine: true }, setTimeout: () => 0 };
        ctx.window.window = ctx.window; vm2.createContext(ctx);
        vm2.runInContext(fs.readFileSync(path.join(SRC, 'bsreport.js'), 'utf8') + ';this.M=BSReport;', ctx);
        ctx.window.BSSources = { list: [{ id: 'z01', key: 'bs_src_z01', name: 'Z01', url: 'http://z01.online/live' }, { id: 'showy', key: 'bs_src_showy', name: 'Showy', url: 'http://showy.online/m.js' }] };
        let got = null;
        ctx.M._netCheck(r => { got = r; });
        return { got, urls, hint: ctx.M._netHint(got) };
    };
    let n = net([]);
    t('связь: всё открывается — подсказки нет', n.got.internet && !n.got.blocked.length && n.hint === '' && /Skaz ✓/.test(n.got.text));
    n = net(['skaz.tv', 'imagetmdb.com', 'themoviedb.org']);
    t('связь: интернет есть, Skaz и TMDB нет — подсказка про DNS', n.got.internet && n.got.blocked.join() === 'TMDB,Skaz' && /1\.1\.1\.1/.test(n.hint) && /Skaz ✗/.test(n.got.text));
    t('связь: TMDB — запасной адрес пробуем, прежде чем считать закрытым', n.urls.filter(u => /themoviedb|imagetmdb/.test(u)).length === 2);
    n = net(['gstatic.com', '1.1.1.1', 'themoviedb.org', 'imagetmdb.com', 'skaz.tv', 'byskaz.ru']);
    t('связь: ничего не открывается — «нет интернета», а не DNS', n.got.offline && /Нет интернета/.test(n.hint));
    n = net(['z01.online'], { bs_src_z01: 'true', bs_src_main: 'z01' });
    t('связь: включённый другой источник (Z01) тоже проверяем', n.urls.some(u => /z01\.online/.test(u)) && !n.urls.some(u => /showy/.test(u)) && n.got.blocked.join() === 'Z01');
}

/* ---- следующий сезон (bswatch.js + bsfix.js nextSeason) ---- */
{
    const W = load('bswatch.js', 'BSWatch').M, NOW = Date.parse('2026-10-17T12:00:00Z');
    const S = (n, cnt, air) => ({ season_number: n, episode_count: cnt, air_date: air });
    const base = { status: 'Returning Series', seasons: [S(0, 3, '2019-01-01'), S(1, 8, '2020-01-01'), S(2, 10, '2022-01-01'), S(3, 10, '2026-09-01')], last_episode_to_air: { season_number: 3, episode_number: 10 } };
    t('сезон: конец 2-го, 3-й вышел — включаем 3-й, серию 1', JSON.stringify(W._seasonAfter(base, 2, 10, NOW)) === '{"state":"next","season":3,"episode":1}');
    t('сезон: в источнике 8 из 10 серий — не прыгаем в следующий сезон, говорим про серию 9', W._seasonAfter(base, 2, 8, NOW).state === 'more' && /Серия 9 уже вышла/.test(W._seasonText(W._seasonAfter(base, 2, 8, NOW))));
    const airing = Object.assign({}, base, { last_episode_to_air: { season_number: 3, episode_number: 4 }, next_episode_to_air: { season_number: 3, episode_number: 5, air_date: '2026-10-24' } });
    t('сезон: идёт сейчас, следующая серия ещё не вышла — с датой', W._seasonAfter(airing, 3, 4, NOW).state === 'wait-ep' && /выйдет 24 октября 2026/.test(W._seasonText(W._seasonAfter(airing, 3, 4, NOW))));
    const soon = Object.assign({}, base, { seasons: base.seasons.concat([S(4, 0, '2027-03-12')]), next_episode_to_air: { season_number: 4, episode_number: 1, air_date: '2027-03-12' } });
    t('сезон: следующий объявлен — «Сезон 4 выйдет 12 марта 2027»', W._seasonText(W._seasonAfter(soon, 3, 10, NOW)) === 'Сезон 4 выйдет 12 марта 2027');
    t('сезон: сериал завершён', W._seasonAfter(Object.assign({}, base, { status: 'Ended' }), 3, 10, NOW).state === 'ended');
    t('сезон: нового сезона нет и не объявлен', W._seasonAfter(base, 3, 10, NOW).state === 'none');
    t('сезон: спецвыпуски (сезон 0) не считаем следующим сезоном', W._seasonAfter({ seasons: [S(0, 2, '2020-01-01'), S(1, 6, '2021-01-01')], last_episode_to_air: { season_number: 1, episode_number: 6 }, status: 'Ended' }, 1, 6, NOW).state === 'ended');
    t('сезон: нет данных TMDB — ничего не делаем', W._seasonAfter(null, 2, 10, NOW) === null);
}
{
    // nextSeason: сезон есть в том же источнике — переключаем сезон как пульт и просим плагин сразу включить серию 1
    const A = fixCtx(), act = { activity: { component: null } };
    A.ctx.Lampa.Activity.active = () => act;
    A.ctx.Lampa.Player.opened = () => false;
    const c = fakeComp(A, ['x']); act.activity.component = c;
    let mem = 2; const seasons = [1, 2, 3], sw = [];
    c.seasonMemory = n => (n === undefined ? mem : (mem = n));
    c.seasonIndexByMemory = () => seasons.indexOf(mem);
    c.uiSwitch = (type, i) => sw.push(type + ':' + i);
    A.env.screen = c;
    c.getFileUrl({ url: 'http://online3.skaz.tv/lite/rezka', season: 2, episode: 10 }, () => {});
    let got = 0;
    const ok = A.M.nextSeason(3, 2, r => { got = r; });
    t('следующий сезон: есть в том же источнике — переключили сезон, серия 1 включится сама', ok === true && sw.join() === 'season:2' && act.lampac_continue_episode === 1 && got && got.same === true && mem === 3);
    // нет в этом источнике — ищем в других; не нашли — память сезона назад
    const B = fixCtx(), act2 = { activity: { component: null } };
    B.ctx.Lampa.Activity.active = () => act2;
    B.ctx.Lampa.Player.opened = () => false;
    B.ctx.window.BSProbe = raceProbe(null, []);
    const c2 = fakeComp(B, ['x']); act2.activity.component = c2; c2.requestParams = u => u; c2.getChoice = () => ({ voice_name: 'Дубляж' });
    let mem2 = 2; c2.seasonMemory = n => (n === undefined ? mem2 : (mem2 = n)); c2.seasonIndexByMemory = () => [1, 2].indexOf(mem2); c2.uiSwitch = () => { throw new Error('не должен'); };
    B.env.screen = c2;
    c2.getFileUrl({ url: 'http://online3.skaz.tv/lite/rezka', season: 2, episode: 10 }, () => {});
    let got2 = 0;
    B.M.nextSeason(3, 2, r => { got2 = r; });
    const call = B.ctx.window.BSProbe.calls[0];
    t('следующий сезон: в источнике нет — гонка за серией 1 нового сезона в других, без текущего', call && call.want.season === 3 && call.want.episode === 1 && call.exclude.join() === 'rhsprem');
    t('следующий сезон: нигде нет — null, память сезона вернули на прежний', got2 === null && mem2 === 2);
    // нашёлся в другом — переключаем источник, серия 1 включится сама
    const C2 = fixCtx(), act3 = { activity: { component: null } };
    C2.ctx.Lampa.Activity.active = () => act3;
    C2.ctx.Lampa.Player.opened = () => false;
    C2.ctx.window.BSProbe = raceProbe({ name: 'collaps', title: 'Collaps', verdict: 'ok' }, []);
    const c3 = fakeComp(C2, ['x']); act3.activity.component = c3; c3.requestParams = u => u; c3.getChoice = () => ({});
    let mem3 = 2; c3.seasonMemory = n => (n === undefined ? mem3 : (mem3 = n)); c3.seasonIndexByMemory = () => -1;
    C2.env.screen = c3;
    c3.getFileUrl({ url: 'http://online3.skaz.tv/lite/rezka', season: 2, episode: 10 }, () => {});
    let got3 = 0;
    C2.M.nextSeason(3, 2, r => { got3 = r; });
    t('следующий сезон: нашёлся в другом источнике — переключаем туда, сезон 3, серия 1', got3 && got3.title === 'Collaps' && got3.same === false && c3.switched[0] === 'collaps' && mem3 === 3 && act3.lampac_continue_episode === 1);
    // следующая серия того же сезона (TMDB отстаёт от озвучки): в этом источнике её нет — сразу другие, серия 11
    const D = fixCtx(), act4 = { activity: { component: null } };
    D.ctx.Lampa.Activity.active = () => act4;
    D.ctx.Lampa.Player.opened = () => false;
    D.ctx.window.BSProbe = raceProbe({ name: 'collaps', title: 'Collaps', verdict: 'ok' }, []);
    const c4 = fakeComp(D, ['x']); act4.activity.component = c4; c4.requestParams = u => u; c4.getChoice = () => ({});
    let mem4 = 2; c4.seasonMemory = n => (n === undefined ? mem4 : (mem4 = n)); c4.seasonIndexByMemory = () => [1, 2].indexOf(mem4); c4.uiSwitch = () => { throw new Error('не должен'); };
    D.env.screen = c4;
    c4.getFileUrl({ url: 'http://online3.skaz.tv/lite/rezka', season: 2, episode: 10 }, () => {});
    let got4 = 0;
    D.M.nextSeason(2, 2, r => { got4 = r; }, 11);
    const call4 = D.ctx.window.BSProbe.calls[0];
    t('следующая серия: тот же сезон — не переключаем сезон в этом источнике, ищем серию 11 в других', call4 && call4.want.season === 2 && call4.want.episode === 11 && call4.exclude.join() === 'rhsprem');
    t('следующая серия: нашлась в другом — переключаем, плагин включит серию 11', got4 && got4.title === 'Collaps' && c4.switched[0] === 'collaps' && act4.lampac_continue_episode === 11);
    // findEpisode: тихая разведка без переключения; «нет серии» не портит источники (peek)
    const E = fixCtx(), act5 = { activity: { component: null } };
    E.ctx.Lampa.Activity.active = () => act5;
    E.ctx.window.BSProbe = raceProbe({ name: 'alloha', title: 'Alloha', verdict: 'ok' }, []);
    const c5 = fakeComp(E, ['x']); act5.activity.component = c5; c5.requestParams = u => u; c5.getChoice = () => ({ voice_name: 'TVShows' });
    E.env.screen = c5;
    c5.getFileUrl({ url: 'http://online3.skaz.tv/lite/rezka', season: 2, episode: 10 }, () => {});
    let got5 = 0;
    const ok5 = E.M.findEpisode(2, 11, r => { got5 = r; });
    const call5 = E.ctx.window.BSProbe.calls[0];
    t('поиск серии: гонка за S2E11 с той же озвучкой, без текущего источника, в режиме разведки', ok5 === true && call5.want.episode === 11 && call5.want.voice === 'TVShows' && call5.want.peek === true && call5.exclude.join() === 'rhsprem');
    t('поиск серии: нашли — {name, title}, источник не переключали', got5 && got5.title === 'Alloha' && !(c5.switched || []).length);
    E.M.findEpisode(3, 1, () => {});
    t('поиск серии: новый сезон — текущий источник тоже проверяем', E.ctx.window.BSProbe.calls[1].exclude.length === 0);
}
serviceTests().catch(e => { fail++; console.log('FAIL служба: исключение', e && e.stack); }).then(() => {
    console.log(pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
});
