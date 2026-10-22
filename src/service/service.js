/*
 * Служба Lampa (Tizen web service, Node.js на ТВ): секреты Telegram-бота — токен и ключи ИИ — хранятся только здесь,
 * в файле в личной папке приложения, а не в localStorage страницы: localStorage читает любой плагин Lampa, загруженный
 * в ту же страницу. Страница (bstg.js) ходит к Telegram и ИИ через службу: служба подставляет токен или ключ и отдаёт
 * ответ как есть. Сами секреты служба не возвращает никогда — ни одним запросом.
 *
 *  Адрес — http://127.0.0.1:8897 (только этот ТВ). Запускает страница (launchAppControl), дальше служба живёт сама:
 *  переживает закрытие Lampa и режим ожидания, после перезагрузки ТВ стартует сама (on-boot в config.xml).
 *
 *  Ключ доступа. На старте служба придумывает случайный ключ (32 байта, hex) и кладёт его в svc.key в папке данных
 *  пакета (apps_rw/<пакет>/data) — это та же папка, что у страницы 'wgt-private' (tizen.filesystem): ключ прочитает
 *  только страница нашего пакета. Все адреса, кроме /health, — только с заголовком X-Lampa-Key: <ключ>. Сайт, открытый
 *  в браузере ТВ (в т. ч. с Origin: null), ключа не знает — ни слать через бота, ни стирать токен не может.
 *
 *  GET  /health                 {ok, v, store, auth} — без ключа больше ничего. С ключом ещё node, has: {tg, ai:
 *                               [провайдеры с ключом владельца], aiu: {провайдер: [чаты]}}, launched — когда служба
 *                               последний раз открыла Lampa (мс, часы ТВ; 0 — не открывала).
 *                               store: 'ok' — файл секретов прочитан (или его ещё нет); 'unreadable' — файл есть, но не
 *                               прочитался (страница ничего не стирает, служба ничего не пишет); 'tmp' / 'none' — папки
 *                               данных нет (секреты не принимаются: в /tmp не храним)
 *  POST /secret {name, value}   сохранить секрет (пустое value — удалить). Имена: tg, ai.<провайдер>, aiu.<провайдер>.<чат>
 *                               Папки данных нет — 507, файл не прочитался — 503: страница оставляет секрет у себя
 *  POST /forget                 удалить все секреты («Отключить бота»)
 *  POST /derive {salt}          то, что страница раньше выводила из токена: тема и ключ канала ТВ, код приглашения
 *  POST /join {code, chat, ts}  подключить ещё один ТВ: токен и чат — в тему ntfy нового ТВ. Код из 6 цифр (v4) —
 *                               ключ нового ТВ из темы кода, общий ключ X25519 (как join4 в bstg.js; 404 — такого ТВ
 *                               нет, 409 — откликнулись два); прежний из 12 знаков — ключ из кода через PBKDF2.
 *                               Только код, который за последние 15 минут пришёл боту сообщением из этого чата.
 *  POST /tg/<метод>             -> https://api.telegram.org/bot<токен>/<метод>, тело формы как есть; ответ и Date — как есть.
 *                               Только методы, которые зовёт bstg.js (TG_METHODS); остальные (setWebhook, logOut…) — 403
 *  GET  /tgfile/<путь>          -> https://api.telegram.org/file/bot<токен>/<путь> (картинка для поиска по картинке)
 *  GET|POST /ai/<провайдер>/... -> API провайдера с ключом в заголовке; ?chat=<id> — ключ этого человека, нет — владельца
 *
 *  Бот, пока Lampa закрыта (v2; подробно — «бот, пока Lampa закрыта» ниже):
 *  POST /alive {away, offset, cfg}  страница на связи (или уходит: away) и правила для службы -> {ok, pending, next, polling}
 *  GET  /pending                -> {ok, next, more, items: [{u: апдейт, at: когда получен (часы Telegram; 0 — неизвестно), tv}]}
 *  POST /pending/ack {upTo}     страница разобрала апдейты до upTo включительно — из очереди убрать
 *  GET  /bus/cmds               (v5) команды этому ТВ из канала ТВ, принятые, пока Lampa была закрыта -> {ok, items}
 *
 *  Подключение с телефона по Wi-Fi (v3; подробно — «подключение с телефона по Wi-Fi» ниже):
 *  POST /pair/start {secret}    открыть второй сервер — на 0.0.0.0:8898 (занят — 8899..8901), только для телефона в той же
 *                               Wi-Fi -> {ok, port, ip}. Сам закрывается через 15 минут или после принятого токена
 *  POST /pair/stop {secret}     закрыть его (только с тем же секретом, что в /pair/start)
 *  GET  /pair/status            -> {ok, open, got}: открыт ли, пришёл ли токен (он уже сохранён как секрет tg)
 *
 * ES5 и ничего новее Node 4: на старых ТВ Samsung в службе Node 4. Код службы доходит до ТВ только с новым .wgt
 * (обновления модулей с jsDelivr его не меняют) — поэтому здесь только общий прокси, вся логика — в bstg.js.
 */
'use strict';
var http = require('http'), https = require('https'), fs = require('fs'), urlm = require('url'), crypto = require('crypto'), os = require('os');

var VERSION = 5, PORT = 8897, HOST = '127.0.0.1';
var AI = ['groq', 'gemini', 'openrouter'];
// адреса внешних служб; тесты подменяют их своими (cfg.up)
var UP = {
    tg: 'https://api.telegram.org/',
    ntfy: 'https://ntfy.sh/',
    groq: 'https://api.groq.com/openai/v1/',
    openrouter: 'https://openrouter.ai/api/v1/',
    gemini: 'https://generativelanguage.googleapis.com/v1beta/'
};
/* Запасные серверы ntfy (тот же API; у ntfy.sh — 250 сообщений в сутки на IP, а дома IP общий) — как RELAYS в bstg.js.
 * Публикуем в первый; ответил 429 / 5xx / нет связи — в следующий. Новый ТВ слушает тему на всех. */
var RELAYS = ['https://ntfy.sh/', 'https://ntfy.envs.net/', 'https://ntfy.adminforge.de/', 'https://ntfy.hostux.net/'];
function relays() { return cfg.up.relays || (cfg.up === UP ? RELAYS : [cfg.up.ntfy]); }
// тело запроса: служебные — маленькие; Telegram — текст и кнопки; ИИ — картинка в base64 (bstg.js пускает файл до 15 МБ)
var LIMIT_SMALL = 16 * 1024, LIMIT_TG = 1024 * 1024, LIMIT_AI = 22 * 1024 * 1024, LIMIT_TG_ANSWER = 8 * 1024 * 1024, LIMIT_CFG = 64 * 1024;
var TG_WAIT = 65000, AI_WAIT = 60000, FILE_WAIT = 60000, NTFY_WAIT = 15000, LONG_POLL_MAX = 35;
var JOIN_TTL = 15 * 60000, JOIN_MAX = 50;
/* Код «ещё один ТВ» — как в bstg.js (JOIN_*): 12 знаков без похожих (I, L, O), хотя бы одна цифра и одна буква. */
var JOIN_LEN = 12, JOIN_ITER = 2000, JOIN_SALT = 'lampa-join-v3';
/* Методы Telegram, которые страница может звать через /tg — ровно те, что зовёт bstg.js. Остальные (setWebhook,
 * deleteWebhook, logOut, close, …) — 403: ключ доступа у страницы, а на странице и чужие плагины Lampa. */
var TG_METHODS = ['getUpdates', 'getMe', 'getWebhookInfo', 'getChat', 'getFile', 'sendMessage', 'sendPhoto', 'sendVideo', 'sendChatAction',
    'editMessageText', 'editMessageMedia', 'editMessageCaption', 'editMessageReplyMarkup', 'deleteMessage', 'answerCallbackQuery',
    'setMyCommands', 'setMyDescription', 'setMyShortDescription', 'setChatMenuButton'];
// откуда можно: сама Lampa (страница пакета) — без Origin, file:/app:/…, или 127.0.0.1; «null» — только с ключом
// доступа (и предзапрос CORS: в нём заголовков нет). Сайт, открытый в браузере ТВ, — нет. Настоящая проверка — ключ.
var ORIGIN_OK = /^((file|app|tizen|wgt):\/\/.*|https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?)$/i;

var cfg = { port: PORT, dir: '', tmp: '/tmp', up: UP, log: true, bot: {}, tvApi: null, appId: '' };
var secrets = null, secretsBad = false, loadAt = 0, server = null, listenTries = 0, joinCodes = {}, accessKey = '';

function log(a, b) { if (cfg.log) try { console.log('LampaService', a, b === undefined ? '' : b); } catch (e) {} }
/* Монотонные часы (мс): интервалы, паузы, «страница на связи». Часы ТВ (Date.now) прыгают — их переводят, сверяют по
 * сети; process.hrtime — нет. +1e9: на только что включённом ТВ hrtime мал, а «давно» (0) должно быть давно. */
var T0 = process.hrtime();
function mono() { var d = process.hrtime(T0); return 1e9 + d[0] * 1000 + Math.floor(d[1] / 1e6); }
/* Часы Telegram (заголовок Date его ответов), дальше — по монотонным: для at апдейтов и возраста очереди. */
var tgBase = null;
function noteTg(x) { var d = Date.parse(x && x.headers && x.headers.date || ''); if (d) tgBase = { tg: d, m: mono() }; }
function tgNow() { return tgBase ? tgBase.tg + (mono() - tgBase.m) : Date.now(); }
/* Buffer.from в Node 4.0–4.4 — это Uint8Array.from (не то): там — new Buffer. */
function buf(s, enc) { return Buffer.from && Buffer.from !== Uint8Array.from ? Buffer.from(s, enc) : new Buffer(s, enc); }
/* Разбор адреса: WHATWG URL, где он есть (url.parse в новом Node устарел), иначе url.parse (Node 4–6).
 * -> {protocol, hostname, port, path, pathname, query: {имя: значение или [значения]}} */
function parseUrl(s) {
    if (typeof urlm.URL === 'function') {
        var u = new urlm.URL(s, 'http://127.0.0.1/'), q = {};
        u.searchParams.forEach(function (v, k) { if (q.hasOwnProperty(k)) q[k] = [].concat(q[k], v); else q[k] = v; });
        return { protocol: u.protocol, hostname: u.hostname, port: u.port, path: u.pathname + u.search, pathname: u.pathname, query: q };
    }
    var o = urlm.parse(s, true), r = { protocol: o.protocol, hostname: o.hostname, port: o.port, path: o.path, pathname: o.pathname, query: {} };
    for (var k in o.query) if (Object.prototype.hasOwnProperty.call(o.query, k)) r.query[k] = o.query[k];
    return r;
}
function zeros(n) { return Buffer.alloc ? Buffer.alloc(n) : new Buffer(n).fill(0); }

/* ---------- папка и файл секретов ---------- */

function pkgId() {
    var id = '';
    try { id = String(tizen.application.getCurrentApplication().appInfo.packageId || ''); } catch (e) {}
    if (!id) try { id = String(tizen.application.getCurrentApplication().appInfo.id || '').split('.')[0]; } catch (e) {}
    return id || '0SG81L944p';
}
function writable(d) {
    try { var f = d + '/.probe'; fs.writeFileSync(f, '1'); fs.unlinkSync(f); return true; } catch (e) { return false; }
}
var dirCache = '', dirKind = '', dirAt = 0;
/** Личная папка приложения (/ и папка пакета на ТВ только для чтения). Нет её — '' (dirKind: 'tmp' — писать можно
 *  только в /tmp, 'none' — никуда): секреты в /tmp не кладём — после перезагрузки их там нет, а страница свои уже
 *  стёрла бы. Не нашлась — проверяем снова не чаще раза в 10 с (папка могла ещё не подключиться). */
function dataDir() {
    if (dirCache) return dirCache;
    if (dirKind && mono() - dirAt < 10000) return '';
    var p = pkgId(), list = cfg.dir ? [cfg.dir] : ['/opt/usr/home/owner/apps_rw/' + p + '/data', '/home/owner/apps_rw/' + p + '/data'];
    dirAt = mono();
    for (var i = 0; i < list.length; i++) if (writable(list[i])) { dirCache = list[i]; dirKind = 'ok'; log('папка', dirCache); return dirCache; }
    var k = cfg.tmp && writable(cfg.tmp) ? 'tmp' : 'none';
    if (k !== dirKind) log('папки данных нет — секреты не принимаю', k);
    dirKind = k;
    return '';
}

function blank() { return { tg: '', ai: {}, aiu: {} }; }
/** Файл JSON -> {j} | {missing} (ENOENT — файла нет) | {bad} (не прочитался: EACCES, EIO, пустой, битый). */
function readFileJ(f) {
    var s;
    try { s = fs.readFileSync(f, 'utf8'); } catch (e) { return e && e.code === 'ENOENT' ? { missing: true } : { bad: true, code: e && e.code }; }
    try { var j = JSON.parse(s); if (j && typeof j === 'object') return { j: j }; } catch (e) {}
    return { bad: true, code: 'JSON' };
}
/* Секреты: secrets.json и копия secrets.bak (пишутся одинаково). Основной не прочитался — берём копию. Не прочиталось
 * ничего, а файл есть (ошибка — не «файла нет») — секретов НЕ «нет»: store = 'unreadable', запись запрещена, иначе
 * следующее сохранение затёрло бы файл с токеном пустым. Перечитываем не чаще раза в 10 с (EIO бывает временной). */
function load() {
    var d = dataDir(), s = null;
    secrets = blank(); secretsBad = false; loadAt = mono();
    if (!d) return;
    var a = readFileJ(d + '/secrets.json');
    if (a.j) s = a.j;
    else {
        var b = readFileJ(d + '/secrets.bak');
        if (b.j) { s = b.j; log('secrets.json не прочитался — взял копию', a.code || 'нет файла'); }
        else if (a.bad || b.bad) { secretsBad = true; log('секреты не прочитались — ничего не пишу', (a.code || '') + ' ' + (b.code || '')); return; }
    }
    if (!s) return;
    if (typeof s.tg === 'string') secrets.tg = s.tg;
    AI.forEach(function (p) {
        if (s.ai && typeof s.ai[p] === 'string' && s.ai[p]) secrets.ai[p] = s.ai[p];
        var m = s.aiu && s.aiu[p];
        if (m && typeof m === 'object') for (var c in m) if (m.hasOwnProperty(c) && typeof m[c] === 'string' && m[c]) (secrets.aiu[p] = secrets.aiu[p] || {})[c] = m[c];
    });
}
function S() { if (!secrets || ((secretsBad || !dirCache) && mono() - loadAt > 10000)) load(); return secrets; }
/** 'ok' | 'unreadable' | 'tmp' | 'none' — см. /health. */
function storeState() { S(); return dataDir() ? (secretsBad ? 'unreadable' : 'ok') : dirKind || 'none'; }
/** Запись атомарно и надёжно: временный файл, fsync (данные на диске, а не в кэше), rename. Оборвалось на середине
 *  (выключили ТВ из розетки) — старый файл цел. */
function writeAtomic(f, str) {
    var tmp = f + '.tmp', b = buf(String(str), 'utf8'), fd = fs.openSync(tmp, 'w', 384), off = 0;           // 0600
    try {
        while (off < b.length) off += fs.writeSync(fd, b, off, b.length - off, null);
        fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, f);
}
function failure(code, msg) { var e = new Error(msg); e.code = code; return e; }
/** Секреты — в файл и в копию. Папки нет — NODIR, файл не прочитался — UNREADABLE (не пишем поверх). */
function save() {
    var d = dataDir();
    if (!d) throw failure('NODIR', 'no data dir');
    if (secretsBad) throw failure('UNREADABLE', 'secrets unreadable');
    var str = JSON.stringify(secrets || blank());
    writeAtomic(d + '/secrets.json', str);
    writeAtomic(d + '/secrets.bak', str);
}

/* ---------- ключ доступа (см. в начале) ---------- */

/** Новый ключ на каждый запуск службы — в svc.key папки данных (её видит страница как wgt-private). */
function keyInit() {
    accessKey = crypto.randomBytes(32).toString('hex');
    var d = dataDir();
    if (!d) return log('папки данных нет — ключ доступа странице не передать', '');
    try { writeAtomic(d + '/svc.key', accessKey); } catch (e) { log('svc.key не записался', e.message); }
}
/** Строки равны — сравнение за постоянное время (timingSafeEqual в Node 4 нет). */
function same(v, k) {
    if (!k || typeof v !== 'string' || v.length !== k.length) return false;
    var d = 0;
    for (var i = 0; i < v.length; i++) d |= v.charCodeAt(i) ^ k.charCodeAt(i);
    return d === 0;
}
/** Ключ из заголовка. */
function keyOk(v) { return same(v, accessKey); }

/** Имя секрета -> {k: 'tg' | 'ai' | 'aiu', p, c} или null. */
function slot(name) {
    var m;
    if (name === 'tg') return { k: 'tg' };
    if ((m = /^ai\.(groq|gemini|openrouter)$/.exec(String(name)))) return { k: 'ai', p: m[1] };
    if ((m = /^aiu\.(groq|gemini|openrouter)\.(-?\d{1,20})$/.exec(String(name)))) return { k: 'aiu', p: m[1], c: m[2] };
    return null;
}
/** Сохранить секрет. Не записалось — в памяти как было (ошибка — наверх: страница оставит секрет у себя). */
function setSecret(sl, v) {
    var st = storeState();
    if (st === 'unreadable') throw failure('UNREADABLE', 'secrets unreadable');
    if (st !== 'ok') throw failure('NODIR', 'no data dir');
    var s = S(), was = JSON.stringify(s), newBot = sl.k === 'tg' && s.tg !== v;
    if (sl.k === 'tg') s.tg = v;
    else if (sl.k === 'ai') { if (v) s.ai[sl.p] = v; else delete s.ai[sl.p]; }
    else {
        var m = s.aiu[sl.p] = s.aiu[sl.p] || {};
        if (v) m[sl.c] = v; else delete m[sl.c];
        if (!Object.keys(m).length) delete s.aiu[sl.p];
    }
    try { save(); } catch (e) { secrets = JSON.parse(was); throw e; }
    if (newBot) { joinCodes = {}; botReset(); }                       // другой бот — другие номера апдейтов
}
/** Ошибка записи -> ответ странице: папки нет — 507, файл не прочитался — 503, остальное — 500. */
function saveFail(res, e) {
    var c = e && e.code === 'NODIR' ? 507 : e && e.code === 'UNREADABLE' ? 503 : 500;
    log('не сохранилось', e && (e.code || e.message));
    json(res, c, { ok: false, error: c === 507 ? 'nodir' : c === 503 ? 'unreadable' : 'save', store: storeState() });
}
/** Ключ ИИ: человека (chat), нет — владельца. Как aiKey в bstg.js: свой || владельца. */
function aiKey(p, chat) {
    var s = S(), m = s.aiu[p];
    return String((chat && m && m[chat]) || s.ai[p] || '');
}
function has() {
    var s = S(), aiu = {};
    AI.forEach(function (p) { if (s.aiu[p]) aiu[p] = Object.keys(s.aiu[p]); });
    return { tg: !!s.tg, ai: AI.filter(function (p) { return !!s.ai[p]; }), aiu: aiu };
}

/* ---------- выведенное из токена: точь-в-точь как в bstg.js ---------- */

/** 32-битный FNV-1a — копия fnv из bstg.js (тема канала, код приглашения). */
function fnv(str, h) {
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24); h = h >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
}
function sha256(b) { return crypto.createHash('sha256').update(b).digest(); }
function hmac(k, b) { return crypto.createHmac('sha256', k).update(b).digest(); }
/** Crypt.key из bstg.js: SHA-256 от строки в UTF-8. */
function key(str) { return sha256(buf(String(str), 'utf8')); }
function ctr(i) { return buf([(i >>> 24) & 255, (i >>> 16) & 255, (i >>> 8) & 255, i & 255]); }
/** Crypt.seal из bstg.js: {z:2, n, c, s} — поток HMAC(ключ 'enc', nonce|счётчик) XOR текст, подпись — первые 16 байт. */
function seal(k, str) {
    var n = crypto.randomBytes(16), data = buf(String(str), 'utf8'), ek = hmac(k, buf('enc', 'utf8')), ct = zeros(data.length);
    for (var i = 0; i < data.length; i += 32) {
        var ks = hmac(ek, Buffer.concat([n, ctr(i)]));
        for (var j = 0; j < 32 && i + j < data.length; j++) ct[i + j] = data[i + j] ^ ks[j];
    }
    var s = hmac(hmac(k, buf('mac', 'utf8')), Buffer.concat([n, ct])).slice(0, 16);
    return { z: 2, n: n.toString('base64'), c: ct.toString('base64'), s: s.toString('base64') };
}
function derive(salt) {
    var t = S().tg;
    return {
        topic: 'lampa-tv-' + fnv(t, 2166136261) + fnv(t + '#', 2166136261),                                   // busTopic
        key: key('lampa-bus-v2|' + t).toString('hex'),                                                       // busKey
        invite: fnv(t + '#invite' + salt, 2166136261) + fnv('#invite' + salt + t, 2166136261)                // inviteCode
    };
}
/** Код из сообщения (как joinFrom в bstg.js): дефисы и пробелы — мимо, буквы — заглавные. Не код — ''. */
function joinFrom(t) {
    t = String(t || '');
    if (t.length > 40) return '';
    var c = t.replace(/[\s-]+/g, '').toUpperCase();
    if (/^\d{6}$/.test(c)) return c;
    return c.length === JOIN_LEN && /^[2-9A-HJKMNP-Z]+$/.test(c) && /\d/.test(c) && /[A-Z]/.test(c) ? c : '';
}
/** Тема и ключ из кода — как joinKeys в bstg.js: PBKDF2-HMAC-SHA256 (JOIN_ITER), из него HMAC 'topic' и 'key'. */
function joinKeys(code) {
    var dk = crypto.pbkdf2Sync(buf(code, 'utf8'), buf(JOIN_SALT, 'utf8'), JOIN_ITER, 32, 'sha256');
    return { topic: 'lampa-join-' + hmac(dk, buf('topic', 'utf8')).toString('hex').slice(0, 24), key: hmac(dk, buf('key', 'utf8')) };
}
function joinTopic(code) { return joinKeys(code).topic; }

/* X25519 (RFC 7748) на чистом JS — порт crypto_scalarmult из TweetNaCl (общественное достояние). Нужен для
 * подключения второго ТВ по 6 цифрам: общий ключ двух ТВ, который не узнать, даже зная цифры. Та же копия —
 * в bstg.js (Crypt.x25519); здесь — потому что Node на старых ТВ X25519 не умеет. sk, pk — 32 байта (массив или Uint8Array) -> 32 байта. */
function x25519(sk, pk) {
    function gf(init) { var r = new Float64Array(16); if (init) for (var i = 0; i < init.length; i++) r[i] = init[i]; return r; }
    function car(o) { var c = 1, v; for (var i = 0; i < 16; i++) { v = o[i] + c + 65535; c = Math.floor(v / 65536); o[i] = v - c * 65536; } o[0] += c - 1 + 37 * (c - 1); }
    function sel(p, q, b) { var t, c = ~(b - 1); for (var i = 0; i < 16; i++) { t = c & (p[i] ^ q[i]); p[i] ^= t; q[i] ^= t; } }
    function A(o, a, b) { for (var i = 0; i < 16; i++) o[i] = a[i] + b[i]; }
    function Z(o, a, b) { for (var i = 0; i < 16; i++) o[i] = a[i] - b[i]; }
    function M(o, a, b) {
        var t = new Float64Array(31), i, j;
        for (i = 0; i < 16; i++) for (j = 0; j < 16; j++) t[i + j] += a[i] * b[j];
        for (i = 0; i < 15; i++) t[i] += 38 * t[i + 16];
        for (i = 0; i < 16; i++) o[i] = t[i];
        car(o); car(o);
    }
    function inv(o, x) { var c = gf(), a; for (a = 0; a < 16; a++) c[a] = x[a]; for (a = 253; a >= 0; a--) { M(c, c, c); if (a !== 2 && a !== 4) M(c, c, x); } for (a = 0; a < 16; a++) o[a] = c[a]; }
    function pack(n) {
        var m = gf(), t = gf(), i, j, b, out = [];
        for (i = 0; i < 16; i++) t[i] = n[i];
        car(t); car(t); car(t);
        for (j = 0; j < 2; j++) {
            m[0] = t[0] - 0xffed;
            for (i = 1; i < 15; i++) { m[i] = t[i] - 0xffff - ((m[i - 1] >> 16) & 1); m[i - 1] &= 0xffff; }
            m[15] = t[15] - 0x7fff - ((m[14] >> 16) & 1);
            b = (m[15] >> 16) & 1;
            m[14] &= 0xffff;
            sel(t, m, 1 - b);
        }
        for (i = 0; i < 16; i++) { out.push(t[i] & 0xff); out.push((t[i] >> 8) & 0xff); }
        return out;
    }
    var z = [], x = gf(), a = gf(), b = gf(), c = gf(), d = gf(), e = gf(), f = gf(), k121665 = gf([0xdb41, 1]), i, r;
    for (i = 0; i < 32; i++) z.push(sk[i] & 255);
    z[31] = (z[31] & 127) | 64; z[0] &= 248;
    for (i = 0; i < 16; i++) x[i] = (pk[2 * i] & 255) + ((pk[2 * i + 1] & 255) << 8);
    x[15] &= 0x7fff;
    for (i = 0; i < 16; i++) b[i] = x[i];
    a[0] = d[0] = 1;
    for (i = 254; i >= 0; --i) {
        r = (z[i >>> 3] >>> (i & 7)) & 1;
        sel(a, b, r); sel(c, d, r);
        A(e, a, c); Z(a, a, c); A(c, b, d); Z(b, b, d);
        M(d, e, e); M(f, a, a); M(a, c, a); M(c, b, e);
        A(e, a, c); Z(a, a, c); M(b, a, a); Z(c, d, f);
        M(a, c, k121665); A(a, a, d); M(c, c, a); M(a, d, f); M(d, b, x); M(b, e, e);
        sel(a, b, r); sel(c, d, r);
    }
    inv(c, c); M(a, a, c);
    return pack(a);
}

/* Подключение по 6 цифрам (v4) — как join4* в bstg.js: тема из кода, ключ нового ТВ в ней ({t:'hi4', pk}), общий
 * ключ X25519 с одноразовой парой службы, {t:'join4', epk, box}. */
var JOIN4_LEN = 6, JOIN4_SALT = 'lampa-join-v4', BASE9 = [9];
while (BASE9.length < 32) BASE9.push(0);
function join4Topic(code) { return 'lampa-join4-' + sha256(buf(JOIN4_SALT + '|topic|' + code, 'utf8')).toString('hex').slice(0, 24); }
function pk32(s) { try { var b = buf(String(s), 'base64'); return b.length === 32 && /^[A-Za-z0-9+\/]+=*$/.test(String(s)) ? b : null; } catch (e) { return null; } }
function join4Hellos(texts) {
    var seen = {}, out = [];
    texts.forEach(function (text) {
        String(text || '').split('\n').forEach(function (line) {
            var ev = null, m = null;
            try { ev = JSON.parse(line); m = JSON.parse(ev.message); } catch (e) { return; }
            if (!ev || ev.event !== 'message' || !m || m.t !== 'hi4' || typeof m.pk !== 'string' || !pk32(m.pk) || seen[m.pk]) return;
            seen[m.pk] = 1;
            out.push(m.pk);
        });
    });
    return out;
}
function join4Box(code, pkB64, payload) {
    var pk = pk32(pkB64);
    if (!pk) return null;
    var e = crypto.randomBytes(32), epk = buf(x25519(e, BASE9)), sh = buf(x25519(e, pk)), d = 0;
    for (var i = 0; i < sh.length; i++) d |= sh[i];
    if (!d) return null;
    var k = sha256(Buffer.concat([buf(JOIN4_SALT + '|' + code + '|', 'utf8'), pk, epk, sh]));
    return { t: 'join4', epk: epk.toString('base64'), box: seal(k, payload) };
}

/** Коды «ещё один ТВ», пришедшие боту сообщением, — из апдейтов, прошедших через службу (опрос страницы
 *  через /tg/getUpdates и свой). */
function noteCodeList(list) {
    var now = mono(), k;
    for (k in joinCodes) if (joinCodes.hasOwnProperty(k) && now - joinCodes[k].at > JOIN_TTL) delete joinCodes[k];
    list.forEach(function (u) {
        var m = u && u.message, c = m && typeof m.text === 'string' && m.chat ? joinFrom(m.text) : '';
        if (!c) return;
        var kn = bot && bot.cfg && bot.cfg.known;                               // код шлёт подключённый (владелец); чужие — мимо
        if (kn && kn.length && kn.indexOf(String(m.chat.id)) < 0) return;
        var ks = Object.keys(joinCodes);
        if (ks.length >= JOIN_MAX) delete joinCodes[ks.sort(function (a, b) { return joinCodes[a].at - joinCodes[b].at; })[0]];   // самый старый
        joinCodes[c] = { chat: String(m.chat.id), at: now };
    });
}

/* ---------- HTTP ---------- */

function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Title, X-Lampa-Key');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Expose-Headers', 'Date');
    res.setHeader('Access-Control-Max-Age', '600');
}
/* Своё время ТВ в Date не шлём: страница берёт Date как часы Telegram. */
function json(res, code, obj) {
    if (res.headersSent) { try { res.end(); } catch (e) {} return; }
    var b = buf(JSON.stringify(obj), 'utf8');
    res.sendDate = false;
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': b.length, 'Cache-Control': 'no-store' });
    res.end(b);
}
/** Тело запроса целиком, не больше limit: больше — cb(413). */
function readBody(req, limit, cb) {
    var parts = [], n = 0, big = false, done = false;
    var cl = parseInt(req.headers['content-length'], 10);
    if (cl > limit) big = true;
    req.on('data', function (d) { if (big) return; n += d.length; if (n > limit) { big = true; parts = []; } else parts.push(d); });
    req.on('end', function () { if (!done) { done = true; cb(big ? 413 : 0, big ? null : Buffer.concat(parts, n)); } });
    req.on('error', function () { if (!done) { done = true; cb(400, null); } });
}
function readJson(req, cb) {
    readBody(req, LIMIT_SMALL, function (err, b) {
        if (err) return cb(err, null);
        var j = null;
        try { j = JSON.parse(b.toString('utf8') || '{}'); } catch (e) { return cb(400, null); }
        cb(j && typeof j === 'object' ? 0 : 400, j);
    });
}
/** Запрос наружу. cb(err, ответ) — ровно один раз. Молчит дольше wait — обрываем. */
function upstream(method, target, headers, body, wait, cb, res) {
    var u = parseUrl(target), o = { protocol: u.protocol, hostname: u.hostname, port: u.port || undefined, path: u.path }, done = false, r;
    var end = function (e, x) { if (!done) { done = true; cb(e, x); } };
    o.method = method; o.headers = headers || {};
    if (body) o.headers['Content-Length'] = body.length;
    try {
        r = (o.protocol === 'http:' ? http : https).request(o, function (x) { end(null, x); });
    } catch (e) { return end(e); }
    r.setTimeout(wait, function () { var e = new Error('timeout'); e.timeout = true; end(e); try { r.abort(); } catch (x) {} });
    r.on('error', function (e) { end(e); });
    // страница бросила запрос, не дождавшись ответа (например, длинный опрос при закрытии Lampa), — бросаем и мы
    if (res) res.on('close', function () { if (!res.finished) try { r.abort(); } catch (x) {} });
    r.end(body || undefined);
    return r;
}
function upFail(res, e) { json(res, e && e.timeout ? 504 : 502, { ok: false, error_code: e && e.timeout ? 504 : 502, description: e && e.timeout ? 'no answer from upstream' : 'no connection: ' + (e && e.code || 'error') }); }
/** Ответ снаружи — странице как есть (статус, тип, длина), без буфера. */
function pipeBack(res, x, extra) {
    var h = { 'Content-Type': x.headers['content-type'] || 'application/octet-stream', 'Cache-Control': 'no-store' };
    if (x.headers['content-length']) h['Content-Length'] = x.headers['content-length'];
    for (var k in extra) if (extra.hasOwnProperty(k)) h[k] = extra[k];
    res.sendDate = false;
    res.writeHead(x.statusCode, h);
    x.on('aborted', function () { try { res.destroy(); } catch (e) {} });
    x.pipe(res);
}

/* POST /tg/<метод>: тело формы как есть; getUpdates — ждать не дольше LONG_POLL_MAX с (больше — урезаем). */
function tg(req, res, method) {
    if (req.method !== 'POST') return json(res, 405, { ok: false, description: 'POST only' });
    if (TG_METHODS.indexOf(method) < 0) { log('метод Telegram не разрешён', method); return json(res, 403, { ok: false, error_code: 403, description: 'method not allowed' }); }
    readBody(req, LIMIT_TG, function (err, body) {
        if (err) return json(res, err, { ok: false, error_code: err, description: err === 413 ? 'body too large' : 'bad body' });
        var t = S().tg, wait = TG_WAIT, gen = tgGen, poff = -2;
        if (!t) return json(res, 503, { ok: false, error_code: 503, description: 'no token in service' });
        if (method === 'getUpdates') {
            var form = body.toString('utf8'), m = /(?:^|&)timeout=(\d+)/.exec(form), sec = m ? +m[1] : 0, mo = /(?:^|&)offset=(-?\d+)/.exec(form);
            poff = mo ? parseInt(mo[1], 10) : -2;
            if (sec > LONG_POLL_MAX) { form = form.replace(/((?:^|&)timeout=)\d+/, '$1' + LONG_POLL_MAX); body = buf(form, 'utf8'); sec = LONG_POLL_MAX; }
            wait = (sec + 15) * 1000;
            // страница опрашивает сама — служба уступает; очередь — раньше новых апдейтов Telegram (см. pageUpdates)
            var pf = pageUpdates(form, res);
            if (pf === null) return;
            if (pf !== form) body = buf(pf, 'utf8');
        }
        upstream('POST', cfg.up.tg + 'bot' + t + '/' + method, { 'Content-Type': req.headers['content-type'] || 'application/x-www-form-urlencoded' }, body, wait, function (e, x) {
            if (e) return upFail(res, e);
            var parts = [], n = 0, big = false;
            x.on('data', function (d) { n += d.length; if (n > LIMIT_TG_ANSWER) big = true; else parts.push(d); });
            x.on('end', function () {
                if (big) return json(res, 502, { ok: false, error_code: 502, description: 'answer too large' });
                var b = Buffer.concat(parts);
                noteTg(x);
                if (method === 'getUpdates' && x.statusCode === 200) pageGot(b.toString('utf8'), gen, poff);
                var h = { 'Content-Type': x.headers['content-type'] || 'application/json', 'Content-Length': b.length, 'Cache-Control': 'no-store' };
                res.sendDate = false;
                if (x.headers.date) h.Date = x.headers.date;               // часы Telegram — по ним bstg.js считает «старое»
                res.writeHead(x.statusCode, h);
                res.end(b);
            });
            x.on('aborted', function () { json(res, 502, { ok: false, error_code: 502, description: 'upstream aborted' }); });
        }, res);
    });
}

function tgFile(req, res, p) {
    var t = S().tg;
    if (!t) return json(res, 503, { ok: false, description: 'no token in service' });
    upstream('GET', cfg.up.tg + 'file/bot' + t + '/' + p, {}, null, FILE_WAIT, function (e, x) { if (e) return upFail(res, e); pipeBack(res, x); }, res);
}

/* /ai/<провайдер>/<путь>: ключ — в заголовок, как в bstg.js: Groq и OpenRouter — Authorization: Bearer, Gemini — x-goog-api-key. */
function ai(req, res, p, rest, query) {
    if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { ok: false });
    var chat = /^-?\d{1,20}$/.test(String(query.chat || '')) ? String(query.chat) : '', k = aiKey(p, chat), q = [];
    if (!k) return json(res, 503, { error: { message: 'no ' + p + ' key in service' } });
    Object.keys(query).forEach(function (n) { if (n !== 'chat') [].concat(query[n]).forEach(function (v) { q.push(encodeURIComponent(n) + '=' + encodeURIComponent(v)); }); });
    var h = {};
    if (req.headers['content-type']) h['Content-Type'] = req.headers['content-type'];
    if (p === 'openrouter' && req.headers['x-title']) h['X-Title'] = String(req.headers['x-title']).slice(0, 60);
    if (p === 'gemini') h['x-goog-api-key'] = k; else h.Authorization = 'Bearer ' + k;
    var go = function (body) {
        upstream(req.method, cfg.up[p] + rest + (q.length ? '?' + q.join('&') : ''), h, body, AI_WAIT, function (e, x) { if (e) return upFail(res, e); pipeBack(res, x); }, res);
    };
    if (req.method === 'GET') return go(null);
    readBody(req, LIMIT_AI, function (err, body) {
        if (err) return json(res, err, { error: { message: err === 413 ? 'body too large' : 'bad body' } });
        go(body);
    });
}

function join(req, res) {
    readJson(req, function (err, j) {
        if (err) return json(res, err, { ok: false });
        var code = joinFrom(j.code), chat = String(j.chat || ''), rec = code ? joinCodes[code] : null, t = S().tg;
        if (!t) return json(res, 503, { ok: false, error: 'no token' });
        if (!rec || mono() - rec.at > JOIN_TTL || rec.chat !== chat) return json(res, 403, { ok: false, error: 'code was not sent to the bot from this chat' });
        delete joinCodes[code];                                        // код — на одно подключение
        var msg = JSON.stringify({ t: 'join', token: t, chat: chat, ts: +j.ts || Date.now() });
        if (code.length === JOIN4_LEN) return join4(res, code, msg);
        var jk = joinKeys(code);
        relayPost(res, jk.topic, buf(JSON.stringify(seal(jk.key, msg)), 'utf8'));
    });
}
/** В тему на первый сервер, который примет: ntfy не принял (429 — суточный лимит на IP, 5xx, нет связи) — следующий;
 *  новый ТВ слушает тему на всех. */
function relayPost(res, topic, body) {
    var list = relays(), i = 0;
    (function next() {
        upstream('POST', list[i] + topic, {}, body, NTFY_WAIT, function (e, x) {
            if (e) { if (++i < list.length) return next(); return upFail(res, e); }
            x.resume();
            x.on('end', function () {
                if ((x.statusCode === 429 || x.statusCode >= 500) && i + 1 < list.length) { i++; return next(); }
                json(res, x.statusCode, { ok: x.statusCode < 300, status: x.statusCode, relay: i });
            });
        });
    })();
}
/** v4: тема кода на всех серверах сразу; ровно один ключ нового ТВ — подключение туда. */
function join4(res, code, msg) {
    var topic = join4Topic(code), list = relays(), texts = [], answered = 0, left = list.length;
    var go = function () {
        if (!answered) return json(res, 502, { ok: false, error: 'no relay answered' });
        var pks = join4Hellos(texts);
        if (!pks.length) return json(res, 404, { ok: false, error: 'no tv with this code' });
        if (pks.length > 1) return json(res, 409, { ok: false, error: 'several tvs answered this code' });
        var box = join4Box(code, pks[0], msg);
        if (!box) return json(res, 409, { ok: false, error: 'bad key' });
        relayPost(res, topic, buf(JSON.stringify(box), 'utf8'));
    };
    list.forEach(function (r) {
        var ended = false, fin = function () { if (ended) return; ended = true; if (--left === 0) go(); };
        upstream('GET', r + topic + '/json?poll=1&since=15m', {}, null, NTFY_WAIT, function (e, x) {
            if (e) return fin();
            var parts = [];
            x.on('data', function (d) { parts.push(d); });
            x.on('end', function () { if (x.statusCode === 200) { answered++; texts.push(Buffer.concat(parts).toString('utf8')); } fin(); });
            x.on('error', fin);
        });
    });
}

/* ---------- подключение с телефона по Wi-Fi (v3) ----------
 * ntfy.sh даёт 250 сообщений в сутки на IP, а дома IP общий у ТВ, телефона и гостей — подключение по QR через ntfy
 * упиралось в 429. Поэтому, когда служба есть, телефон отдаёт токен прямо ТВ по домашней Wi-Fi:
 *  • Страница (bstg.js) придумывает секрет (16+ знаков [a-z0-9]) и просит /pair/start. Служба открывает второй сервер
 *    на 0.0.0.0 (порт 8898, занят — 8899..8901) и отвечает {port, ip}; страница рисует QR http://<ip>:<порт>/p/<секрет>.
 *  • На этом сервере есть только /p/<секрет>: GET — лёгкая страница (поле «Токен бота от @BotFather» и «Отправить»,
 *    без скриптов и внешних файлов, язык — по Accept-Language: ru / en / uz, иначе ru), POST — токен (форма или текст,
 *    не больше 4 КБ). Остальное — 404. Ключа доступа и проверки Origin/Host тут нет — сервер для телефона; защита —
 *    секрет в адресе (сравнение за постоянное время; 10 неверных — сервер закрывается) и 15 минут жизни.
 *  • Токен проверяем у Telegram (getMe): не принял — «проверьте и вставьте ещё раз»; принял — сохраняем секретом tg
 *    (как /secret), got = true, на телефоне «Готово», и сервер закрывается. Страница видит got в /pair/status и
 *    продолжает как обычно (ждёт первое сообщение боту). Токен не возвращается и не показывается нигде. */
var PAIR = { ports: [8898, 8899, 8900, 8901], host: '0.0.0.0', ttl: 15 * 60000, tries: 10, after: 1500, wait: 20000 };
var LIMIT_PAIR = 4096, PAIR_TOKEN = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/;
function PR(k) { return cfg.pair && cfg.pair[k] !== undefined ? cfg.pair[k] : PAIR[k]; }
var pairing = null, pairGot = false;   // pairing: {server, port, secret, bad, busy, bot, timer, socks}

/** IPv4 ТВ в домашней сети. Без 169.254/16 (адрес «без DHCP») и 192.168.49/24 (Wi-Fi Direct: Screen Mirroring,
 *  телефон в домашней Wi-Fi до него не достанет). Сначала — интерфейсы Wi-Fi и Ethernet (wlan*, wl*, eth*, en*), потом
 *  остальные. Нет — ''. all — для тестов (вместо os.networkInterfaces). */
function lanIp(all) {
    if (!all && cfg.lanIp !== undefined) return cfg.lanIp;
    var good = [], rest = [];
    if (!all) try { all = os.networkInterfaces() || {}; } catch (e) { all = {}; }
    Object.keys(all || {}).forEach(function (k) {
        (all[k] || []).forEach(function (a) {
            if (!a || a.internal || !(a.family === 'IPv4' || a.family === 4) || !a.address || /^169\.254\.|^192\.168\.49\./.test(a.address)) return;
            (/^(wlan|wl|eth|en)/i.test(k) ? good : rest).push(a.address);
        });
    });
    return good[0] || rest[0] || '';
}
/** Открыть сервер для телефона (прежний — закрыть). cb(pairing) или cb(null) — ни один порт не открылся. */
function pairOpen(secret, cb) {
    pairClose();
    pairGot = false;
    var ports = PR('ports').slice(0), P = { server: null, port: 0, secret: secret, bad: 0, busy: false, bot: '', timer: null, socks: [] };
    pairing = P;
    (function next() {
        var port = ports.shift(), up = false;
        if (pairing !== P) return cb(null);
        if (port === undefined) { pairing = null; log('подключение по Wi-Fi: порты заняты', ''); return cb(null); }
        var s = http.createServer(function (req, res) { try { pairHandle(P, req, res); } catch (e) { log('сбой', e.message); pairPage(res, 500, 'ru', 'save'); } });
        s.on('connection', function (sock) {
            P.socks.push(sock);
            sock.on('close', function () { var i = P.socks.indexOf(sock); if (i >= 0) P.socks.splice(i, 1); });
        });
        s.on('error', function (e) {
            if (up) return log('подключение по Wi-Fi', e.code);
            log('порт для телефона занят', port + ' ' + e.code);
            next();
        });
        s.listen(port, PR('host'), function () {
            up = true;
            if (pairing !== P) { try { s.close(); } catch (e) {} return cb(null); }
            P.server = s; P.port = port;
            P.timer = setTimeout(function () { if (pairing === P) { log('подключение по Wi-Fi: время вышло', ''); pairClose(); } }, PR('ttl'));
            log('жду токен с телефона', PR('host') + ':' + port);
            cb(P);
        });
    })();
}
/** Закрыть сервер для телефона и все его соединения (телефон держит keep-alive). */
function pairClose() {
    var P = pairing;
    pairing = null;
    if (!P) return;
    clearTimeout(P.timer);
    if (P.server) try { P.server.close(); } catch (e) {}
    P.socks.forEach(function (s) { try { s.destroy(); } catch (e) {} });
    P.socks = [];
}
/** Язык страницы на телефоне — первый из ru / en / uz в Accept-Language, иначе ru. */
function pairLang(h) {
    var parts = String(h || '').toLowerCase().split(',');
    for (var i = 0; i < parts.length; i++) {
        var c = parts[i].replace(/;.*$/, '').replace(/^\s+|\s+$/g, '').slice(0, 2);
        if (c === 'ru' || c === 'en' || c === 'uz') return c;
    }
    return 'ru';
}
/** Токен из тела: форма (token=…) или просто текст. Не похоже на токен — ''. */
function pairToken(s) {
    var m = /(?:^|&)token=([^&]*)/.exec(s), v = s;
    if (m) { try { v = decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { v = ''; } }
    v = String(v).replace(/\s+/g, '');
    return v.length <= 200 && PAIR_TOKEN.test(v) ? v : '';
}
/* Тексты страницы для телефона (ru / en / uz). Шаги — простым текстом (экранируются). */
var PAIR_TX = {
    ru: { title: 'Lampa — подключить Telegram', h: 'Подключение Telegram-бота', sub: 'Вставьте токен бота — Lampa на телевизоре подключится сама.',
        steps: ['Откройте @BotFather → /newbot (или /mybots → бот → API Token)', 'Скопируйте токен и вставьте ниже', 'Нажмите «Отправить»'],
        label: 'Токен бота от @BotFather', send: 'Отправить', open: 'Открыть бота',
        bad: 'Это не похоже на токен бота. Скопируйте его у @BotFather целиком.', reject: 'Telegram не принял токен — проверьте и вставьте ещё раз',
        net: 'ТВ не достучался до Telegram — проверьте интернет на ТВ и нажмите ещё раз.', save: 'ТВ не смог сохранить токен. Перезапустите Lampa и попробуйте ещё раз.',
        busy: 'Проверяю токен… Подождите пару секунд и обновите страницу.', done: '✅ Готово. Теперь напишите своему боту в Telegram любое сообщение',
        nf: 'Страница не найдена. Откройте подключение на ТВ ещё раз и наведите камеру на новый QR-код.' },
    en: { title: 'Lampa — connect Telegram', h: 'Connect a Telegram bot', sub: 'Paste the bot token — Lampa on the TV connects by itself.',
        steps: ['Open @BotFather → /newbot (or /mybots → bot → API Token)', 'Copy the token and paste it below', 'Tap “Send”'],
        label: 'Bot token from @BotFather', send: 'Send', open: 'Open the bot',
        bad: "This doesn't look like a bot token. Copy the whole token from @BotFather.", reject: "Telegram didn't accept the token — check it and paste it again",
        net: "The TV couldn't reach Telegram — check the TV's internet and tap again.", save: "The TV couldn't save the token. Restart Lampa and try again.",
        busy: 'Checking the token… Wait a couple of seconds and reload the page.', done: '✅ Done. Now send your bot any message in Telegram',
        nf: 'Page not found. Open the connection on the TV again and scan the new QR code.' },
    uz: { title: 'Lampa — Telegramni ulash', h: 'Telegram botni ulash', sub: "Bot tokenini qo'ying — televizordagi Lampa o'zi ulanadi.",
        steps: ["@BotFather'ni oching → /newbot (yoki /mybots → bot → API Token)", "Tokenni nusxalab, pastga qo'ying", '«Yuborish» tugmasini bosing'],
        label: '@BotFather bergan bot tokeni', send: 'Yuborish', open: 'Botni ochish',
        bad: "Bu bot tokeniga o'xshamaydi. Uni @BotFather'dan to'liq nusxalang.", reject: "Telegram tokenni qabul qilmadi — tekshirib, qayta qo'ying",
        net: 'Televizor Telegramga ulana olmadi — televizordagi internetni tekshirib, qayta bosing.', save: "Televizor tokenni saqlay olmadi. Lampa'ni qayta ishga tushirib, yana urinib ko'ring.",
        busy: 'Tokenni tekshiryapman… Bir necha soniya kutib, sahifani yangilang.', done: '✅ Tayyor. Endi Telegramda botingizga istalgan xabar yozing',
        nf: 'Sahifa topilmadi. Televizorda ulanishni qayta oching va kamerani yangi QR-kodga qarating.' }
};
/* Вид — как у приложения TV Installer (его тема Compose): фон Ink, карточки InkElevated, Sky — основной, Mint / Rose /
 * Amber — итог, ошибка, «подождите». Только встроенные CSS и SVG: страница открывается и без интернета (телефон — в Wi-Fi
 * ТВ), на старом Android Chrome (без gap у flex). Та же раскладка — в docs/pair.html. */
var PAIR_CSS = ':root{color-scheme:dark}*{box-sizing:border-box}' +
    'body{margin:0;background:#000000;color:#F2F3F5;font:16px/1.45 "Bahnschrift","Segoe UI",Roboto,system-ui,sans-serif}' +
    '.w{max-width:420px;margin:0 auto;padding:28px 16px 32px}' +
    '.ic{width:64px;height:64px;border-radius:18px;background:#1B1C1F;border:1px solid #26282C;display:flex;align-items:center;justify-content:center;margin:0 0 18px}' +
    'h1{font-size:26px;line-height:1.2;margin:0 0 6px;font-weight:700}.sub{color:#A6ABB3;margin:0 0 20px}' +
    '.card{background:#1B1C1F;border:1px solid #26282C;border-radius:20px;padding:16px;margin:0 0 18px}' +
    '.st{display:flex;align-items:flex-start;margin:0 0 12px}.st:last-child{margin:0}' +
    '.n{flex:0 0 28px;height:28px;margin-right:12px;border-radius:50%;background:#11374F;color:#CDE7FF;font-weight:700;font-size:14px;display:flex;align-items:center;justify-content:center}' +
    'label{display:block;color:#A6ABB3;font-size:14px;margin:0 0 8px}' +
    'textarea{display:block;width:100%;min-height:96px;padding:14px 16px;border-radius:16px;border:1px solid #565A62;background:#1B1C1F;color:#F2F3F5;font:15px/1.4 monospace;outline:0;resize:vertical}' +
    'textarea:focus{border-color:#4599FF}' +
    'button,.btn{display:block;width:100%;height:56px;margin:14px 0 0;padding:0 16px;border:0;border-radius:28px;background:#4599FF;color:#000000;font-family:inherit;font-size:17px;font-weight:700;line-height:56px;text-align:center;text-decoration:none}' +
    '.m{border-radius:16px;padding:12px 14px;margin:0 0 16px}.ok{background:#0E3B2E;color:#C6F3E1}.err{background:#4A1E22;color:#FFD9DC}.warn{background:#4A3313;color:#FFC46B}';
// значок, как у TV Installer: экран и стрелка вниз (Sky) на тёмной плитке
var PAIR_ICON = '<div class="ic"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#4599FF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="2.5" y="4" width="19" height="13" rx="2.5"/><path d="M8 21h8M12 7.5v6M9.5 11l2.5 2.5 2.5-2.5"/></svg></div>';
function htmlEsc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
/** Страница для телефона. kind: form — поле и кнопка; bad / reject / net / save / busy — то же с ошибкой; done — «Готово»;
 *  nf — «не найдена». Токена в ответе нет никогда (поле всегда пустое). */
function pairPage(res, code, l, kind, bot) {
    if (res.headersSent) { try { res.end(); } catch (e) {} return; }
    var T = PAIR_TX[l] || PAIR_TX.ru, b = [], i;
    b.push('<!doctype html><html lang="' + l + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
        '<meta name="referrer" content="no-referrer"><meta name="theme-color" content="#000000"><title>' + htmlEsc(T.title) + '</title><style>' + PAIR_CSS + '</style></head>',
        '<body><div class="w">' + PAIR_ICON + '<h1>' + htmlEsc(T.h) + '</h1>');
    if (kind === 'done') {
        b.push('<div class="m ok">' + htmlEsc(T.done) + (bot ? ': @' + htmlEsc(bot) : '') + '</div>');
        if (bot) b.push('<a class="btn" href="https://t.me/' + htmlEsc(bot) + '">' + htmlEsc(T.open) + '</a>');
    } else if (kind === 'nf') b.push('<div class="m err">' + htmlEsc(T.nf) + '</div>');
    else {
        b.push('<p class="sub">' + htmlEsc(T.sub) + '</p>');
        if (kind !== 'form') b.push('<div class="m ' + (kind === 'busy' ? 'warn' : 'err') + '">' + htmlEsc(T[kind] || T.bad) + '</div>');
        b.push('<div class="card">');
        for (i = 0; i < T.steps.length; i++) b.push('<div class="st"><span class="n">' + (i + 1) + '</span><span>' + htmlEsc(T.steps[i]) + '</span></div>');
        b.push('</div><form method="post" autocomplete="off"><label for="t">' + htmlEsc(T.label) + '</label>',
            '<textarea id="t" name="token" placeholder="123456789:AA…" autocapitalize="off" autocorrect="off" spellcheck="false"></textarea>',
            '<button type="submit">' + htmlEsc(T.send) + '</button></form>');
    }
    b.push('</div></body></html>');
    var body = buf(b.join(''), 'utf8');
    res.sendDate = false;
    res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" });
    res.end(body);
}
/** Запрос с телефона: есть только /p/<секрет> (GET — форма, POST — токен). */
function pairHandle(P, req, res) {
    var u = parseUrl(req.url), m = /^\/p\/([^\/]{1,128})$/.exec(u.pathname || ''), l = pairLang(req.headers['accept-language']);
    if (pairing !== P || !m || (req.method !== 'GET' && req.method !== 'POST')) return pairPage(res, 404, l, 'nf');
    if (!same(m[1], P.secret)) {
        // адрес подбирают — после tries неверных закрываемся (сначала уходит ответ)
        if (++P.bad >= PR('tries')) { log('подключение по Wi-Fi: много неверных адресов — закрываю', ''); res.on('finish', function () { if (pairing === P) pairClose(); }); }
        return pairPage(res, 404, l, 'nf');
    }
    if (pairGot) return pairPage(res, 200, l, 'done', P.bot);
    if (req.method === 'GET') return pairPage(res, 200, l, 'form');
    if (P.busy) return pairPage(res, 429, l, 'busy');
    readBody(req, LIMIT_PAIR, function (err, b) {
        if (pairing !== P) return pairPage(res, 404, l, 'nf');
        if (err) return pairPage(res, err, l, 'bad');
        var tok = pairToken(b.toString('utf8'));
        if (!tok) return pairPage(res, 400, l, 'bad');
        P.busy = true;
        // токен — проверить у Telegram (в лог — без токена)
        upstream('GET', cfg.up.tg + 'bot' + tok + '/getMe', {}, null, PR('wait'), function (e, x) {
            if (e) { P.busy = false; log('подключение по Wi-Fi: Telegram не ответил', e.code || ''); return pairPage(res, 502, l, 'net'); }
            var parts = [], n = 0;
            x.on('data', function (d) { n += d.length; if (n <= LIMIT_SMALL) parts.push(d); });
            x.on('aborted', function () { P.busy = false; pairPage(res, 502, l, 'net'); });
            x.on('end', function () {
                P.busy = false;
                if (pairing !== P) return pairPage(res, 404, l, 'nf');            // пока проверяли — закрыли (отмена на ТВ)
                var j = null;
                try { j = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch (er) {}
                noteTg(x);
                if (x.statusCode >= 500 && !(j && j.ok)) return pairPage(res, 502, l, 'net');
                if (!(x.statusCode === 200 && j && j.ok)) { log('подключение по Wi-Fi: Telegram не принял токен', x.statusCode); return pairPage(res, 400, l, 'reject'); }
                try { setSecret({ k: 'tg' }, tok); } catch (er) { log('подключение по Wi-Fi: токен не сохранился', er.code || er.message); return pairPage(res, 500, l, 'save'); }
                pairGot = true;
                P.bot = j.result && /^\w{3,64}$/.test(String(j.result.username || '')) ? String(j.result.username) : '';
                log('токен с телефона принят', '');
                setTimeout(function () { if (pairing === P) pairClose(); }, PR('after'));
                pairPage(res, 200, l, 'done', P.bot);
            });
        });
    });
}

/* ---------- бот, пока Lampa закрыта ----------
 * Опрашивать бота (getUpdates) может только один: второй получает от Telegram 409 «Conflict». Поэтому:
 *  • Страница на связи — опрашивает она (через /tg/getUpdates), служба молчит. «На связи»: её getUpdates идёт сейчас,
 *    или он, /alive, /pending были меньше gone (45 с) назад. Уходя (Lampa скрыта или закрыта), страница шлёт /alive
 *    {away: true} — служба берёт бота сразу. Спрятанная страница таймеров не крутит — на неё не надеемся.
 *  • Страница ушла — служба опрашивает сама (длинный опрос) и всё полученное кладёт в очередь (bot.json): страница
 *    разберёт это своим обычным разбором, когда Lampa откроют. Сама служба только: нажата кнопка «на ТВ» (какие —
 *    правила от страницы, cfg.tv) от того, кому можно (cfg.allowed), — ответить на нажатие (cfg.texts.opening),
 *    открыть Lampa (не чаще раза в launchGap), ТВ в режиме ожидания — написать «включите ТВ» (tvOff); остальное от
 *    подключённых (cfg.known) — «Lampa закрыта, отвечу, когда откроют» (closed, на каждое сообщение; прошлый такой ответ удаляется), чужим —
 *    ничего. Тексты страница присылает уже на языке каждого человека: своих переводов у службы нет.
 *  • Несколько ТВ на одном боте (см. bstg.js: ведёт один, «главный»). Служба берёт бота, только если её страница была
 *    главной, когда ушла (cfg.leader), и ни один другой ТВ тогда не был на экране (cfg.peers = 0) — иначе бота
 *    подхватит тот, что на экране (по «bye» в канале ТВ). Выходит, бот всегда у последнего главного: ушёл с экрана
 *    последний ТВ — бота держит его служба. Получила 409 (бота взял кто-то ещё: страница другого ТВ, старая Lampa) —
 *    уступает и молчит, пока не вернётся её страница. Страница ни разу не прислала cfg — служба не опрашивает вовсе.
 *    После запуска службы (перезагрузка ТВ, auto-restart) сохранённому «главный» не верим, пока своя страница не
 *    пришлёт /alive: за это время бота мог взять другой ТВ. Кроме случая «ТВ на боте один» (cfg.others = 0).
 *  • Давнее не выполняем. У нажатия кнопки нет даты: «когда пришло» — время ответа Telegram (at). Но первый ответ
 *    после запуска службы, после сбоя или долгого (catchGap) перерыва — «догоняющий»: в нём может лежать нажатое
 *    вчера. Его at — время последнего удачного опроса (okAt), Lampa по нему не открываем. И на кнопку — сначала ответ
 *    Telegram (на давнее нажатие он отвечает «query is too old»), Lampa — только если ответ принят.
 *  • Ключ ИИ, присланный, пока Lampa закрыта, на диск не пишем (hideKey): страница попросит прислать ещё раз.
 *  • Номер апдейта (offset). Пока опрашивает страница, он её (bs_tg_offset); служба видит его в её запросах и в
 *    /alive и начинает с наибольшего известного, свой следующий хранит в bot.json. Вернулась страница — служба сразу
 *    бросает опрос (оборванный запрос Telegram не подтвердил: те апдейты придут странице снова) и отдаёт очередь
 *    раньше всего нового: /pending, а если страница сразу спросила getUpdates — в ответ на него. Подтверждение — как у
 *    Telegram: /pending/ack {upTo} или getUpdates с offset больше номера. Отданное странице, но ею не подтверждённое
 *    (pg.max) служба кладёт в очередь без своих действий: страница его уже разобрала и пропустит по своему offset.
 *    Так ни одно сообщение не теряется и не разбирается дважды.
 *  • Главный ТВ пропал без «bye» (выдернули из розетки), а Lampa этого ТВ закрыта — бота не ведёт никто. Тогда служба
 *    смотрит в сам Telegram: getWebhookInfo (чужому getUpdates не мешает) — раз в watch (60 с), только если ТВ на боте
 *    не один (cfg.others / cfg.peers) и сама она не опрашивает. Жив главный — апдейтов в ожидании 0 (Telegram отдаёт
 *    их сразу). Больше 0 на проверках подряд дольше watchSpan (90 с) — главного нет: служба ведёт бота сама
 *    (loop.takeover) — как главная: очередь, «на ТВ» открывает Lampa, «Lampa закрыта». Вернулась своя страница — бот её.
 *    Получила 409 (вернулся главный или бота взял другой ТВ) — уступает (yielded) и ещё takeCool (5 мин) Telegram не
 *    смотрит: не перетягивать бота туда-сюда.
 */
/* itemMax — один апдейт в bot.json: текст до 4096 знаков, фото и видео — ссылки file_id; больше — заглушка (см. botTake).
 * closedGap — «Lampa закрыта» в чат не чаще (пачка сообщений — один ответ); saveGap — bot.json пишем не чаще (флеш ТВ). */
var BOT = { gone: 45000, idle: 5000, poll: 25, backoff: 3000, backoffMax: 120000, launchGap: 20000, closedGap: 3000,
    offGap: 2 * 60000, qMax: 200, qAge: 47 * 3600000, itemMax: 16 * 1024, powerWait: 3000, offWait: 15000, give: 100, catchGap: 90000, fresh: 90000,
    watch: 60000, watchSpan: 90000, takeCool: 5 * 60000, retryMax: 60, saveGap: 3000 };
function B(k) { return cfg.bot && cfg.bot[k] !== undefined ? cfg.bot[k] : BOT[k]; }

var bot = null;                    // {offset, q: [{u, at, t, tv}], cfg, okAt} — файл bot.json (секретов в нём нет)
var typing = {};                   // «⌨️ Набрать на ТВ»: {чат: до какого mono()} — только в памяти
// страница: когда была (mono), сколько её getUpdates в работе, ушла ли, наибольший номер, отданный ей, её offset,
// присылала ли /alive с запуска службы
// okGen — для какого токена (tgGen) номерам страницы уже можно верить (см. pgTrusted)
var pg = { at: 0, busy: 0, away: false, max: -1, off: 0, seen: false, okGen: 0 };
/* Поколение токена: +1 при каждой смене токена (и «Отключить бота»). Номер апдейта страницы (offset в её getUpdates и
 * /alive) — от прежнего бота, пока она не перешла на новый (стирает bs_tg_offset и начинает с offset=-1). Такому номеру
 * не верим (pg.off и очередь не трогаем), пока её опрос не удался с новым токеном: offset ≤ 0 или пришли апдейты. */
var tgGen = 0;
function pgTrusted() { return pg.okGen === tgGen; }
// свой опрос; okM — когда (mono) последний раз удался опрос (свой или страницы), lost — с тех пор был сбой,
// more — прошлый «догоняющий» ответ был полным (100): за ним может быть ещё старое; takeover — ведём бота за пропавшего
// главного, coolUntil — до каких пор (mono) после 409 в Telegram не смотрим; wAt, wSince, wBusy, wN — проверки getWebhookInfo
var loop = { on: false, gen: 0, req: null, wait: 0, backoff: 0, yielded: false, timer: null, okM: 0, lost: false, more: false, c409: 0,
    takeover: false, coolUntil: 0, wAt: 0, wSince: 0, wBusy: false, wN: 0 };
var launchAt = 0, launchedWall = 0, closedMsg = {}, closedAt = {}, offWaitAt = {}, offAt = {}, okSaved = 0, saveTimer = null;

function botBlank() { return { offset: 0, q: [], cfg: null, okAt: 0 }; }
function botFile() { var d = dataDir(); return d ? d + '/bot.json' : ''; }
function botLoad() {
    var f = botFile(), j = f ? readFileJ(f).j : null;
    bot = botBlank();
    if (!j) return;
    if (j.offset > 0) bot.offset = Math.floor(j.offset);
    if (j.okAt > 0) bot.okAt = +j.okAt;
    okSaved = bot.okAt;
    if (j.q && typeof j.q.forEach === 'function') j.q.forEach(function (it) {
        if (!it || typeof it !== 'object') return;                              // битая запись — мимо, остальное цело
        var t = +it.t || +it.at || 0;
        if (it.u && typeof it.u.update_id === 'number' && t > 0) bot.q.push({ u: it.u, at: +it.at || 0, t: t, tv: it.tv ? 1 : 0 });
    });
    if (j.cfg) setCfg(j.cfg);
    botClean();
}
function BT() { if (!bot) botLoad(); return bot; }
/** Как секреты — атомарно (временный файл, fsync, rename). Папки нет — только в памяти. */
function botSave() {
    clearTimeout(saveTimer); saveTimer = null;
    var f = botFile();
    if (!f) return;
    try { okSaved = BT().okAt; writeAtomic(f, JSON.stringify(BT())); } catch (e) { log('bot.json не сохранился', e.message); }
}
/** Записать скоро — не чаще раза в saveGap: каждый опрос с апдейтами и каждое «разобрано» писали бы флеш ТВ. */
function botSaveSoon() {
    if (B('saveGap') <= 0) return botSave();
    if (!saveTimer) saveTimer = setTimeout(botSave, B('saveGap'));
}
/** Отложенная запись — сейчас (служба останавливается, бот переходит к странице). */
function botFlush() { if (saveTimer) botSave(); }
/** Очередь: не старше qAge (по часам Telegram), не больше qMax. -> изменилась ли. */
function botClean() {
    var b = BT(), now = tgNow(), n = b.q.length;
    b.q = b.q.filter(function (it) { return now - it.t < B('qAge'); });
    if (b.q.length > B('qMax')) b.q = b.q.slice(-B('qMax'));
    return n !== b.q.length;
}
/** Страница разобрала всё до upTo включительно. */
function botDrop(upTo) {
    var b = BT(), n = b.q.length;
    b.q = b.q.filter(function (it) { return it.u.update_id > upTo; });
    if (n !== b.q.length) botSaveSoon();
}
/** Другой токен или «Отключить бота»: номера, очередь и правила — с нуля. */
function botReset() {
    botHalt();
    tgGen++;
    bot = botBlank(); typing = {}; pg.max = -1; pg.off = 0; loop.yielded = false; loop.takeover = false; loop.wSince = 0;
    busStop(); bus.cmds = []; bus.heard = false; bus.since = {};
    botSave();
}

/* ---------- правила от страницы: только простые списки (никаких RegExp из чужих данных), в своих пределах ---------- */
function idList(a) {
    var out = [];
    if (a && typeof a.forEach === 'function') a.forEach(function (x) { if ((typeof x === 'string' || typeof x === 'number') && okId(String(x)) && out.length < 100) out.push(String(x)); });
    return out;
}
/** Строки 1..len знаков, не больше max штук. */
function strList(a, max, len) {
    var out = [];
    if (a && typeof a.forEach === 'function') a.forEach(function (x) { if (typeof x === 'string' && x.length && x.length <= len && out.length < max) out.push(x); });
    return out;
}
function txt(s) { return typeof s === 'string' ? s.slice(0, 500) : ''; }
function okId(k) { return /^-?\d{1,20}$/.test(k); }
function num(x, max) { return typeof x === 'number' && x >= 0 ? Math.min(Math.floor(x), max) : -1; }
/** Текст кнопки клавиатуры для сравнения: без эмодзи и пробелов в начале, без пробелов в конце, апострофы — один. */
function norm(s) {
    s = String(s);
    if (s.length > 100) return '';
    return s.toLowerCase().replace(/[ʻʼ‘’`]/g, "'").replace(/^[^\wЀ-ӿ]+/, '').replace(/\s+$/, '');
}
/** Правила от страницы (только нужное и в своих пределах). -> изменились ли.
 *  tv: cbp — начала данных кнопок, после которых только номер (v:m:, D:<тв>:t: …), cbx — данные кнопок целиком
 *  (mn:type), cmd — команды (/type), words — слова клавиатуры («⌨️ Набрать на ТВ»), typing — {чат: сколько мс ещё ждём текст}. */
function setCfg(c) {
    if (!c || typeof c !== 'object') return false;
    var tv = c.tv && typeof c.tv === 'object' ? c.tv : {}, k, cnt = 0;
    var n = { leader: c.leader === true, peers: Math.max(0, num(c.peers, 100)), others: num(c.others, 100), allowed: idList(c.allowed), known: idList(c.known),
        tv: { cbp: strList(tv.cbp, 20, 40), cbx: strList(tv.cbx, 20, 40), cmd: strList(tv.cmd, 10, 32).map(function (x) { return x.toLowerCase(); }),
            words: strList(tv.words, 20, 60).map(norm) }, texts: {}, me: null };
    // этот ТВ в канале ТВ (v5): номер, имя, модель, версия, запомненный сервер — служба говорит за него, пока Lampa закрыта
    var me = c.me && typeof c.me === 'object' ? c.me : null;
    if (me && /^[A-Za-z0-9]{4,16}$/.test(String(me.id))) n.me = { id: String(me.id), name: txt(me.name).slice(0, 40) || 'TV', model: txt(me.model).slice(0, 40), v: txt(me.v).slice(0, 20), relay: Math.max(0, num(me.relay, 9)) };
    if (tv.typing && typeof tv.typing === 'object') {
        typing = {};
        for (k in tv.typing) if (tv.typing.hasOwnProperty(k) && okId(k) && typeof tv.typing[k] === 'number' && tv.typing[k] > 0 && cnt++ < 20) typing[k] = mono() + Math.min(tv.typing[k], 10 * 60000);
    }
    cnt = 0;
    if (c.texts && typeof c.texts === 'object') for (k in c.texts) if (c.texts.hasOwnProperty(k) && okId(k) && c.texts[k] && typeof c.texts[k] === 'object' && cnt++ < 100) {
        n.texts[k] = { closed: txt(c.texts[k].closed), tvOff: txt(c.texts[k].tvOff), offWait: txt(c.texts[k].offWait), opening: txt(c.texts[k].opening) };
    }
    var b = BT(), changed = JSON.stringify(b.cfg) !== JSON.stringify(n);
    b.cfg = n;
    return changed;
}

/* страница на связи / ушла */
function pageHere() { pg.at = mono(); pg.away = false; loop.yielded = false; loop.c409 = 0; loop.wait = 0; loop.takeover = false; loop.wSince = 0; botHalt(); botFlush(); busStop(); }
function pageGone() { return pg.away || (pg.busy === 0 && mono() - pg.at > B('gone')); }
/** Опрашивать самим? Только главный ТВ без других на экране; после запуска службы (перезагрузка ТВ, auto-restart) —
 *  только когда своя страница с тех пор хоть раз прислала /alive: сохранённым правилам «главный» уже не верим (бота
 *  мог взять другой ТВ). Кроме одного ТВ на боте (others = 0) — у большинства так, и бот работает сразу после перезагрузки. */
function shouldPoll() {
    var b = BT(), c = b.cfg;
    // «ТВ один» — со слов страницы (others = 0) и если в канале ТВ (v5) мы никого не слышали: иначе после перезагрузки ТВ
    // служба отнимала бы бота у живого главного (он — «занято», уступал), и бот отвечал «Lampa закрыта» с этого ТВ
    var lead = !!c && ((c.leader && !(c.peers > 0) && (pg.seen || (c.others === 0 && !bus.heard))) || loop.takeover);
    return !!server && !!S().tg && lead && pageGone() && !loop.yielded && b.q.length < B('qMax');
}
/** Смотреть в Telegram, не пропал ли главный: ТВ на боте не один (или бота у нас взяли — 409), своя страница ушла, сами не опрашиваем, после 409 —
 *  не раньше takeCool. ТВ один — не нужно (бота и так ведёт эта служба, см. shouldPoll). */
function watchWanted() {
    var b = BT(), c = b.cfg;
    return !!server && !!S().tg && !!c && (c.others > 0 || c.peers > 0 || bus.heard || loop.yielded) && pageGone() && !loop.takeover && !loop.on && !shouldPoll() &&
        mono() >= loop.coolUntil && b.q.length < B('qMax');
}
function botWatch() {
    if (loop.wBusy) return;
    if (!watchWanted()) { loop.wSince = 0; return; }
    if (loop.wAt && mono() - loop.wAt < B('watch')) return;                       // не чаще раза в минуту
    loop.wAt = mono() + Math.floor(Math.random() * B('watch') / 10);              // несколько служб — не в одну секунду
    loop.wBusy = true; loop.wN++;
    tgSend('getWebhookInfo', {}, function (ok, r) {
        loop.wBusy = false;
        var n = ok && r && typeof r.pending_update_count === 'number' ? r.pending_update_count : -1, m = mono();
        if (n < 0) return;
        if (n === 0 || !watchWanted()) { loop.wSince = 0; return; }
        if (!loop.wSince) { loop.wSince = m; return; }                            // первый раз — ждём подтверждения
        if (m - loop.wSince < B('watchSpan')) return;
        loop.wSince = 0; loop.takeover = true; loop.yielded = false; loop.c409 = 0; loop.wait = 0;
        log('главный ТВ не опрашивает бота (апдейты копятся) — веду сама', n);
        botSoon(0);
    });
}
/** Бросить свой опрос (вернулась страница, сменился токен). Ответ брошенного запроса потом не разбираем (gen). */
function botHalt() {
    var r = loop.req;
    loop.gen++; loop.req = null; loop.on = false;
    if (r) try { r.abort(); } catch (e) {}
}
function botTick() {
    try {
        busTick();
        if (!loop.on && mono() >= loop.wait && shouldPoll()) return botFetch();
        botWatch();
    } catch (e) { log('опрос', e.message); loop.on = false; }
}
function botSoon(ms) { setTimeout(botTick, ms || 0); }
function botWait(ms) { loop.wait = mono() + ms; botSoon(ms + 10); }
/** Опрос не удался (сеть, 409, 429, 5xx): следующий удачный — «догоняющий» (см. botTake). */
function botLost() { loop.lost = true; }
/** Опрос удался (свой или страницы): at — часы Telegram. В bot.json — не чаще раза в 10 минут (флеш ТВ). */
function pollOk(at) {
    var b = BT();
    loop.okM = mono(); loop.lost = false;
    if (at > b.okAt) b.okAt = at;
    if (b.okAt - okSaved > 10 * 60000) botSave();
}
function botFetch() {
    var b = BT(), gen = ++loop.gen, done = false, start = Math.max(b.offset, pg.off, 0);
    // не больше, чем влезет в очередь: лишнее Telegram отдаст в следующий раз, а не пропадёт за qMax (до 100 — его предел)
    var lim = Math.max(1, Math.min(100, B('qMax') - b.q.length));
    var once1 = function (f) { return function (a, c) { if (done || gen !== loop.gen) return; done = true; loop.on = false; loop.req = null; f(a, c); }; };
    // сеть, таймаут, оборвалось: ждём дольше и дольше (backoff .. backoffMax)
    var fail = once1(function () { botLost(); loop.backoff = Math.min(Math.max(loop.backoff * 2, B('backoff')), B('backoffMax')); botWait(loop.backoff); });
    var answer = once1(function (x, text) { botAnswer(x, text); });
    loop.on = true;
    loop.req = upstream('POST', cfg.up.tg + 'bot' + S().tg + '/getUpdates', { 'Content-Type': 'application/x-www-form-urlencoded' },
        buf('offset=' + start + '&limit=' + lim + '&timeout=' + B('poll'), 'utf8'), (B('poll') + 15) * 1000, function (e, x) {
            if (gen !== loop.gen) { if (x) try { x.resume(); } catch (er) {} return; }
            if (e) return fail();
            var parts = [], n = 0, big = false;
            x.on('data', function (d) { n += d.length; if (n > LIMIT_TG_ANSWER) big = true; else parts.push(d); });
            x.on('aborted', fail);
            x.on('end', function () { if (big) return fail(); answer(x, Buffer.concat(parts).toString('utf8')); });
        }) || null;
}
function botAnswer(x, text) {
    var j = null, ec;
    try { j = JSON.parse(text); } catch (e) {}
    noteTg(x);
    if (x.statusCode === 200 && j && j.ok && j.result && typeof j.result.forEach === 'function') {
        loop.backoff = 0; loop.c409 = 0;
        var at = tgNow(), m = mono();
        // «догоняющий» ответ: первый после запуска службы, после сбоя, после перерыва дольше catchGap или следом за
        // полным догоняющим — в нём может лежать давнее (нажатое вчера, до перезагрузки ТВ)
        var cu = !loop.okM || loop.lost || m - loop.okM > B('catchGap') || loop.more;
        loop.more = cu && j.result.length >= 100;
        try { botTake(j.result, at, cu); } catch (e) { log('очередь', e.message); }
        pollOk(at);
        return botSoon(0);
    }
    botLost();
    ec = (j && j.error_code) || x.statusCode;
    if (ec === 409) {
        // 409 бывает от своей же страницы: её последний длинный запрос ещё висел, когда Lampa ушла с экрана (до ~35 с).
        // Других ТВ нет — через минуту пробуем снова (кроме упорного 409: после 5 подряд — уступаем до страницы).
        // Есть другие ТВ — уступаем сразу, иначе мы обрывали бы их опрос.
        // Вели бота за пропавшего главного (takeover) — он вернулся (или взял другой ТВ): уступаем сразу.
        var c9 = BT().cfg || {};
        loop.c409 = (loop.c409 | 0) + 1;
        // «занято» от своей страницы бывает только сразу после её ухода (её длинный запрос — до 35 с); позже — это другой ТВ
        var tail = mono() - pg.at < 90000;
        if (!loop.takeover && !(c9.peers > 0) && c9.others === 0 && !bus.heard && tail && loop.c409 < 5) { log('бот занят (409) — повтор через минуту', ''); return botWait(60000); }
        loop.yielded = true; loop.takeover = false; loop.wSince = 0; loop.coolUntil = mono() + B('takeCool');
        log('бота опрашивает другой — уступаю до возвращения страницы', ''); return;
    }
    if (ec === 429) return botWait(Math.min(Math.max(j && j.parameters ? j.parameters.retry_after | 0 : 0, 1), 300) * 1000);   // «слишком часто»: сколько сказал Telegram
    if (ec === 401 || ec === 404) return botWait(10 * 60000);                                                                      // токен не подошёл — не долбим
    loop.backoff = Math.min(Math.max(loop.backoff * 2, B('backoff')), B('backoffMax'));
    botWait(loop.backoff);
}
function updChat(u) { var q = u.callback_query, msg = q ? q.message : u.message; return msg && msg.chat ? String(msg.chat.id) : ''; }
/** Апдейты из своего опроса -> очередь. at — время Telegram (заголовок Date), по нему страница судит «старое».
 *  Догоняющий ответ (cu): когда апдейт пришёл боту, неизвестно — at = время последнего удачного опроса (okAt; 0 —
 *  неизвестно), у сообщения — не раньше его даты; действий «на ТВ» нет (Lampa не открываем). tv — по правилам для
 *  каждого апдейта, открыли Lampa или нет: страница применит к ним правило «на ТВ — не старше 15 минут». */
function botTake(list, at, cu) {
    var b = BT(), changed = false, c = b.cfg || {};
    noteCodeList(list);
    list.forEach(function (u) {
        if (!u || typeof u.update_id !== 'number' || u.update_id < b.offset) return;
        b.offset = u.update_id + 1; changed = true;
        var md = u.message && u.message.date > 0 ? u.message.date * 1000 : 0, when = at;
        if (cu) when = md ? Math.max(b.okAt || 0, Math.min(md, at)) : b.okAt || 0;
        var it = { u: u, at: when, t: at, tv: isTv(c, u, updChat(u)) ? 1 : 0 };
        if (u.update_id > pg.max) { try { botAct(u, it.tv, cu); } catch (e) { log('действие', e.message); } }
        hideKey(it);
        if (JSON.stringify(it).length <= B('itemMax')) b.q.push(it);
        else {
            // слишком большой для bot.json — в очередь только «был такой»: страница попросит прислать ещё раз
            log('апдейт слишком большой — в очередь без содержимого', u.update_id);
            var md0 = u.message && u.message.date > 0 ? u.message.date : 0;
            b.q.push({ u: { update_id: u.update_id, _big: { chat: updChat(u), date: md0 } }, at: it.at, t: it.t, tv: 0 });
        }
    });
    botClean();
    if (changed) botSaveSoon();
}
/* Ключ ИИ, присланный, пока Lampa закрыта, — не на диск: текст заменяем, страница попросит прислать ещё раз и удалит
 * сообщение из чата (u.message._k). Как isGeminiKey в bstg.js: одно «слово» 30–200 знаков, буквы и цифры (gsk_…,
 * AIza…, AQ.…, sk-or-…, завтра другое), не адрес и не токен бота. */
function looksKey(t) {
    t = String(t || '').replace(/^\s+|\s+$/g, '');
    return t.length >= 30 && t.length <= 200 && /^[\x21-\x7e]+$/.test(t) && /[A-Za-z]/.test(t) && /\d/.test(t) && !/^https?:/i.test(t) &&
        t.indexOf('/') < 0 && !/^\d{6,}:[\w-]{30,}$/.test(t);
}
function hideKey(it) {
    var m = it.u.message, u = {}, mm = {}, k;
    if (!m || typeof m.text !== 'string' || !looksKey(m.text)) return;
    for (k in it.u) if (it.u.hasOwnProperty(k)) u[k] = it.u[k];
    for (k in m) if (m.hasOwnProperty(k) && k !== 'text' && k !== 'entities') mm[k] = m[k];
    mm.text = '🔑'; mm._k = 1;
    u.message = mm; it.u = u;
}
function inList(a, x) { return !!a && a.indexOf(x) >= 0; }
/** Кнопка: данные целиком из cbx или начало из cbp и дальше только номер. */
function tvCb(t, d) {
    d = String(d || '');
    if (inList(t.cbx, d)) return true;
    for (var i = 0; t.cbp && i < t.cbp.length; i++) {
        var p = t.cbp[i];
        if (d.length > p.length && d.slice(0, p.length) === p && /^\d{1,20}$/.test(d.slice(p.length))) return true;
    }
    return false;
}
/** Текст: команда из cmd (/type, /type@бот, /type что-то) или слово клавиатуры из words. */
function tvText(t, s) {
    var m = /^\/([A-Za-z_]{1,32})(@\w{1,64})?(\s|$)/.exec(s);
    if (m && inList(t.cmd, m[1].toLowerCase())) return true;
    return !!t.words && t.words.length > 0 && inList(t.words, norm(s));
}
/** Кнопка или текст требуют ТВ (правила страницы). */
function isTv(c, u, chat) {
    var t = c.tv || {};
    if (u.callback_query) return tvCb(t, u.callback_query.data);
    var m = u.message;
    if (!m || typeof m.text !== 'string') return false;
    return tvText(t, m.text) || (typing[chat] > mono() && m.text.charAt(0) !== '/');     // «⌨️ Набрать на ТВ»: следующий текст
}
/** Сообщение свежее (по часам Telegram): Lampa — только на только что написанное. */
function fresh(m) { return !!m && m.date > 0 && tgNow() - m.date * 1000 < B('fresh'); }
/** Что делает служба сама, пока Lampa закрыта. tv — действие «на ТВ»; cu — догоняющий ответ (Lampa не открываем).
 *  На кнопку — сначала ответ Telegram, и только если он принят, открываем Lampa: на давнее нажатие Telegram отвечает
 *  «query is too old» — тогда фильм сам не включится. */
function botAct(u, tv, cu) {
    var c = BT().cfg || {}, q = u.callback_query, m = u.message, msg = q ? q.message : m;
    var chat = msg && msg.chat ? String(msg.chat.id) : '';
    if (!chat || !inList(c.known, chat)) return;                            // чужим — молча: ответит страница
    var tx = (c.texts && c.texts[chat]) || {};
    if (tv && inList(c.allowed, chat)) {
        if (cu) { if (q) answerCb(q, ''); return; }                                    // давнее: без «часиков», и только
        if (q) return answerCb(q, tx.opening || '', function (ok) {
            if (ok) botLaunch(chat, tx.tvOff); else log('нажатие устарело — Lampa не открываю', '');
        });
        if (fresh(m)) botLaunch(chat, tx.tvOff);
        return;
    }
    if (q) return answerCb(q, tx.closed || '');                                // без «часиков» на кнопке
    if (!m || !fresh(m)) return;                                               // давнее (старше fresh) — разберёт страница, когда откроют
    power(function (st) {
        // ТВ выключен пультом: открываем Lampa «в темноте» — она ответит сама; не успела — просим включить ТВ. На экране
        // другое приложение — Lampa поверх не открываем: «Lampa закрыта» (на каждое сообщение, прошлый такой же — убираем).
        var standby = st === 'standby' && inList(c.allowed, chat);
        if (standby) {
            // открытая «в темноте» Lampa обычно успевает ответить сама — тогда «включите ТВ» не нужно. Ждём OFF_WAIT:
            // апдейт всё ещё в очереди (страница его не забрала) — значит, Lampa спит, просим включить ТВ
            botLaunch(chat, '');
            var uid = u.update_id;
            return setTimeout(function () {
                try { if (queued(uid) && tx.offWait) closedNotice(chat, tx.offWait, offWaitAt); } catch (e) { log('ТВ', e.message); }
            }, B('offWait'));
        }
        if (tx.closed) closedNotice(chat, tx.closed);
    });
}
function queued(uid) { var q = BT().q, i; for (i = 0; i < q.length; i++) if (q[i].u && q[i].u.update_id === uid) return true; return false; }
/** «Lampa закрыта» / «включите ТВ»: прошлый такой же ответ в чате убираем — в чате всегда один. Пачка сообщений подряд
 *  (быстрее closedGap) — один ответ на всю пачку: не тратим лимит Telegram на отправку и удаление. */
function closedNotice(chat, text, map) {
    if (!once(map || closedAt, chat, B('closedGap'))) return;
    tgSend('sendMessage', { chat_id: chat, text: text }, function (ok, r) {
        if (!ok || !r || !r.message_id) return;
        // ответы могут прийти не по порядку (несколько сообщений подряд): оставляем самое новое, старшее — удаляем
        var prev = closedMsg[chat], id = r.message_id;
        if (Object.keys(closedMsg).length > 200) closedMsg = {};
        if (prev && prev > id) return tgSend('deleteMessage', { chat_id: chat, message_id: id });
        if (prev) tgSend('deleteMessage', { chat_id: chat, message_id: prev });
        closedMsg[chat] = id;
    });
}
function once(map, k, gap) {
    var now = mono(), x;
    if (map[k] && now - map[k] < gap) return false;
    // больше 200 ключей — убираем только устаревшие (старше gap), свежие отметки сохраняем: иначе повторы уведомлений
    if (Object.keys(map).length > 200) for (x in map) if (map.hasOwnProperty(x) && now - map[x] >= gap) delete map[x];
    map[k] = now;
    return true;
}
/** Открыть Lampa (не чаще раза в launchGap); ТВ в режиме ожидания — экран сам не включить: попросить человека. */
function botLaunch(chat, off) {
    power(function (st) {
        var now = mono();
        if (!launchAt || now - launchAt >= B('launchGap')) { launchAt = now; launchedWall = Date.now(); launchApp(); }
        if (st === 'standby' && off && once(offAt, chat, B('offGap'))) tgSend('sendMessage', { chat_id: chat, text: off });
    });
}
function launchApp() {
    try {
        tizen.application.launch(cfg.appId || pkgId() + '.Lampa', function () { log('Lampa открыта', ''); }, function (e) { log('Lampa не открылась', e && e.message); });
    } catch (e) { log('Lampa не открылась', e.message); }
}
/** REST самого ТВ (порт 8001): сначала по адресу в сети, потом 127.0.0.1. */
function tvApis() {
    if (cfg.tvApi) return cfg.tvApi.slice(0);
    var out = [], all = {};
    try { all = os.networkInterfaces() || {}; } catch (e) {}
    Object.keys(all).forEach(function (k) {
        (all[k] || []).forEach(function (a) { if (a && !a.internal && (a.family === 'IPv4' || a.family === 4) && a.address) out.push('http://' + a.address + ':8001/api/v2/'); });
    });
    out.push('http://127.0.0.1:8001/api/v2/');
    return out.slice(-4);
}
/** cb('on' | 'standby' | '' — не узнали). */
function power(cb) {
    var list = tvApis(), done = false;
    var fin = function (s) { if (!done) { done = true; try { cb(s); } catch (e) { log('ТВ', e.message); } } };
    (function next() {
        var u = list.shift(), over = false;
        if (!u) return fin('');
        var skip = function () { if (!over) { over = true; next(); } };
        upstream('GET', u, {}, null, B('powerWait'), function (e, x) {
            if (e) return skip();
            var parts = [], n = 0;
            x.on('data', function (d) { n += d.length; if (n <= LIMIT_CFG) parts.push(d); });
            x.on('aborted', skip);
            x.on('end', function () {
                var j = null;
                try { j = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch (er) {}
                var s = j && j.device && j.device.PowerState;
                if (typeof s === 'string' && s) { over = true; return fin(s.toLowerCase()); }
                skip();
            });
        });
    })();
}
/** Сообщение или ответ на кнопку от самой службы; ошибки — только в лог (без токена). cb(принял ли Telegram).
 *  «Слишком часто» (429) — один повтор через retry_after (не дольше retryMax), как call в bstg.js. */
function tgSend(method, p, cb) {
    var t = S().tg, q = [], k, retried = false, fin = function (ok, r) { if (cb) { var f = cb; cb = null; try { f(ok, r); } catch (e) { log(method, e.message); } } };
    if (!t) return fin(false);
    for (k in p) if (p.hasOwnProperty(k)) q.push(encodeURIComponent(k) + '=' + encodeURIComponent(p[k]));
    var body = buf(q.join('&'), 'utf8');
    (function go() {
        upstream('POST', cfg.up.tg + 'bot' + t + '/' + method, { 'Content-Type': 'application/x-www-form-urlencoded' }, body, TG_WAIT, function (e, x) {
            if (e) { log('не ушло', method); return fin(false); }
            var parts = [], n = 0;
            x.on('data', function (d) { n += d.length; if (n <= LIMIT_SMALL) parts.push(d); });
            x.on('aborted', function () { fin(false); });
            x.on('end', function () {
                var j = null;
                try { j = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch (er) {}
                noteTg(x);
                if ((x.statusCode === 429 || (j && j.error_code === 429)) && !retried) {
                    retried = true;
                    var after = Math.min(Math.max(j && j.parameters ? j.parameters.retry_after | 0 : 0, 1), B('retryMax'));
                    log('Telegram: слишком часто — повтор через, с', method + ' ' + after);
                    return setTimeout(go, after * 1000);
                }
                if (!(j && j.ok)) log('Telegram не принял', method + ' ' + String(j && j.description || x.statusCode).slice(0, 80));
                fin(!!(x.statusCode === 200 && j && j.ok), j && j.result);
            });
        });
    })();
}
/** Строка не длиннее n знаков; половинку суррогатной пары (эмодзи) на конце не оставляем. */
function cut(s, n) {
    s = String(s || '');
    if (s.length <= n) return s;
    s = s.slice(0, n);
    return /[\ud800-\udbff]$/.test(s) ? s.slice(0, -1) : s;
}
/** Ответ на нажатие кнопки: у Telegram текст — до 200 знаков. */
function answerCb(q, text, cb) { tgSend('answerCallbackQuery', { callback_query_id: q.id, text: cut(text, 200) }, cb); }

/** getUpdates страницы: она на связи. Очередь — раньше нового: есть очередь — отдаём её (в виде ответа Telegram, с
 *  пометкой _q), а Telegram не спрашиваем. offset страницы ниже нашего — поднимаем (то, что ниже, уже у неё в очереди
 *  или разобрано). -> форма для Telegram или null — уже ответили. offset=-1 и без offset (подключение, поиск чата) —
 *  как есть: там очередь не нужна. */
function pageUpdates(form, res) {
    var b = BT(), m = /(?:^|&)offset=(-?\d+)/.exec(form), off = m ? parseInt(m[1], 10) : -2, ended = false;
    pageHere();
    if (off > 0 && pgTrusted()) { botDrop(off - 1); if (off > pg.off) pg.off = off; }
    if (off >= 0 && b.q.length) { json(res, 200, { ok: true, result: b.q.slice(0, B('give')).map(withQ) }); return null; }
    pg.busy++;
    var end = function () { if (ended) return; ended = true; pg.busy--; if (!pg.away) pg.at = mono(); };
    res.on('finish', end); res.on('close', end);
    if (off >= 0 && b.offset > off) form = form.replace(/((?:^|&)offset=)-?\d+/, '$1' + b.offset);
    return form;
}
function withQ(it) { var u = {}, k; for (k in it.u) if (it.u.hasOwnProperty(k)) u[k] = it.u[k]; u._q = { at: it.at, tv: it.tv ? 1 : 0 }; return u; }
/** Ответ Telegram на getUpdates страницы: коды «ещё один ТВ», наибольший отданный номер (см. pg.max), опрос удался.
 *  gen — поколение токена, с которым ушёл запрос (сменился, пока ждали, — ответ от прежнего бота: номера не берём);
 *  off — offset страницы: ≤ 0 или пришли апдейты — страница опрашивает уже новый бот, её номерам верим (pgTrusted). */
function pageGot(text, gen, off) {
    var j = null;
    try { j = JSON.parse(text); } catch (e) { return; }
    if (!j || !j.ok || !j.result || typeof j.result.forEach !== 'function' || gen !== tgGen) return;
    noteCodeList(j.result);
    if (off <= 0 || j.result.length) pg.okGen = tgGen;
    j.result.forEach(function (u) { if (u && u.update_id > pg.max) pg.max = u.update_id; });
    pollOk(tgNow());
}

/* ---------- канал ТВ, пока Lampa закрыта (v5) ----------
 * Несколько ТВ на одном боте говорят друг с другом через ntfy (bstg.js, «общий канал ntfy.sh»): «я здесь» (hello),
 * «открыть на ТВ» (open), «набрать» (type)… Lampa закрыта — её страница молчит: главный ТВ через час убирал этот ТВ из
 * списка, а «открыть на этом ТВ» уходило в пустоту и бот писал «не ответил». Теперь, пока Lampa закрыта (pageGone),
 * канал слушает служба — от имени своего ТВ (имя, модель, номер — от страницы, cfg.me):
 *  • «кто здесь» (hello с ask, who) — отвечает «я здесь» с пометками svc (Lampa закрыта) и pw (экран: on / standby);
 *    ещё раз в BUS.every, если ТВ на боте не один (главный держит ТВ в списке DEVICE_ALIVE — час с лишним);
 *  • команда этому ТВ (open, type, rename) — в очередь (GET /bus/cmds — заберёт страница), открыть Lampa и ответить
 *    главному «⏳ открываю Lampa» (ack с wait) — окончательный ответ даст сама страница, когда выполнит.
 * Вернулась своя страница — канал снова её (служба замолкает). Сообщения — тем же шифром, что у страницы (seal/unseal).
 */
var BUS = { every: 20 * 60000, first: 8000, cmdAge: 5 * 60000, cmdMax: 20, reconnect: 15000, life: 30 * 60000, idle: 120000 };
var bus = { on: false, gen: 0, reqs: [], since: {}, seen: {}, seenN: 0, helloAt: 0, firstAt: 0, heard: false, cmds: [], topic: '', k: null };
function busMe() { var c = BT().cfg; return c && c.me && c.me.id ? c.me : null; }
function busWanted() { return !!server && !!S().tg && pageGone() && !!busMe(); }
/** Crypt.open из bstg.js: подпись не сошлась (чужое, изменённое) — null. */
function unseal(k, m) {
    try {
        if (!m || m.z !== 2) return null;
        var n = buf(String(m.n), 'base64'), ct = buf(String(m.c), 'base64'), tag = buf(String(m.s), 'base64'), i, j, diff = 0;
        if (n.length !== 16 || tag.length !== 16) return null;
        var want = hmac(hmac(k, buf('mac', 'utf8')), Buffer.concat([n, ct])).slice(0, 16);
        for (i = 0; i < 16; i++) diff |= want[i] ^ tag[i];
        if (diff) return null;
        var ek = hmac(k, buf('enc', 'utf8')), out = zeros(ct.length);
        for (i = 0; i < ct.length; i += 32) {
            var ks = hmac(ek, Buffer.concat([n, ctr(i)]));
            for (j = 0; j < 32 && i + j < ct.length; j++) out[i + j] = ct[i + j] ^ ks[j];
        }
        return out.toString('utf8');
    } catch (e) { return null; }
}
/** Серверы канала: запомненный страницей (cfg.me.relay) первым, потом остальные. */
function busOrder() {
    var list = relays(), r = (busMe() || {}).relay | 0, out = [], i;
    if (r > 0 && r < list.length) out.push(r);
    for (i = 0; i < list.length; i++) if (out.indexOf(i) < 0) out.push(i);
    return out;
}
function busStart() {
    if (bus.on) return;
    var d = derive('');
    bus.topic = d.topic; bus.k = buf(d.key, 'hex'); bus.on = true; bus.gen++; bus.helloAt = 0; bus.firstAt = mono() + BUS.first;
    // слушаем, как страница: ntfy.sh и запомненный сервер (туда публикуют ТВ этого дома)
    var r = (busMe() || {}).relay | 0;
    [0].concat(r > 0 && r < relays().length ? [r] : []).forEach(busListen);
    log('канал ТВ: Lampa закрыта — слушаю за неё', '');
}
function busStop() {
    if (!bus.on) return;
    bus.on = false; bus.gen++;
    bus.reqs.forEach(function (r) { try { r.abort(); } catch (e) {} });
    bus.reqs = [];
}
function busListen(i) {
    var base = relays()[i], gen = bus.gen, again = false, r = null;
    if (!bus.on || !base) return;
    var retry = function () {
        if (again) return;
        again = true;
        bus.reqs = bus.reqs.filter(function (x) { return x !== r; });
        if (bus.on && gen === bus.gen) setTimeout(function () { if (bus.on && gen === bus.gen) busListen(i); }, BUS.reconnect);
    };
    r = upstream('GET', base + bus.topic + '/json?since=' + encodeURIComponent(bus.since[i] || 'now'), {}, null, BUS.idle, function (e, x) {
        if (e || !x || x.statusCode !== 200) { if (x) try { x.resume(); } catch (er) {} return retry(); }
        var rest = '';
        x.setEncoding('utf8');
        x.on('data', function (d) {
            var nl;
            rest += d;
            while ((nl = rest.indexOf('\n')) >= 0) { busLine(i, rest.slice(0, nl)); rest = rest.slice(nl + 1); }
            if (rest.length > 65536) rest = '';
        });
        x.on('end', retry); x.on('aborted', retry); x.on('error', retry);
    }) || null;
    if (!r) return retry();
    bus.reqs.push(r);
    setTimeout(function () { if (!again) try { r.abort(); } catch (e) {} }, BUS.life);   // раз в полчаса — заново (как страница)
}
function busLine(i, line) {
    var ev = null, m = null, t;
    try { ev = JSON.parse(line); } catch (e) { return; }
    if (!ev || ev.event !== 'message') return;
    if (ev.id) bus.since[i] = String(ev.id).slice(0, 40);
    try { m = JSON.parse(ev.message); } catch (e) { return; }
    if (!m || m.z !== 2 || bus.seen[m.n]) return;
    t = unseal(bus.k, m);
    if (!t) return;
    if (++bus.seenN > 500) { bus.seen = {}; bus.seenN = 0; }
    bus.seen[m.n] = 1;
    try { m = JSON.parse(t); } catch (e) { return; }
    if (!m || !m.t || !m.from || (m.ts && Math.abs(Date.now() - m.ts) > 86400000)) return;
    try { busOn(m); } catch (e) { log('канал ТВ', e.message); }
}
function busOn(m) {
    var me = busMe();
    if (!me || m.from === me.id || !busWanted()) return;
    if (m.t === 'hello' || m.t === 'who') bus.heard = true;                     // на боте есть и другие ТВ
    if ((m.t === 'hello' && m.ask) || m.t === 'who') return busHello();
    if (m.to !== me.id) return;
    if ((m.t === 'open' || m.t === 'type') && Date.now() - (m.ts || 0) < 60000) {
        busCmd(m);
        return power(function (st) {
            if (m.ref) busSend({ t: 'ack', ref: m.ref, wait: true, name: me.name,
                why: st === 'standby' ? 'экран выключен — включите ТВ: Lampa уже открывается' : 'Lampa была закрыта — открываю' });
            if (!launchAt || mono() - launchAt >= B('launchGap')) { launchAt = mono(); launchedWall = Date.now(); launchApp(); }
        });
    }
    if (m.t === 'rename') busCmd(m);
}
function busCmd(m) {
    bus.cmds.push({ m: m, at: mono() });
    if (bus.cmds.length > BUS.cmdMax) bus.cmds.shift();
}
function busHello() {
    var me = busMe();
    if (!me) return;
    bus.helloAt = mono();
    power(function (st) {
        busSend({ t: 'hello', v: me.v, name: me.name, model: me.model, ip: lanIp(), leader: false, fg: false, svc: 1, pw: st || '' });
    });
}
function busSend(obj) {
    var me = busMe();
    if (!me || !bus.k || !bus.topic) return;
    obj.from = me.id; obj.ts = Date.now();
    var body = buf(JSON.stringify(seal(bus.k, JSON.stringify(obj))), 'utf8'), list = relays(), order = busOrder();
    (function next(n) {
        if (n >= order.length) return log('канал ТВ: ни один сервер не принял', obj.t);
        upstream('POST', list[order[n]] + bus.topic, {}, body, NTFY_WAIT, function (e, x) {
            if (x) try { x.resume(); } catch (er) {}
            if (e || !x || x.statusCode !== 200) next(n + 1);
        });
    })(0);
}
/** Раз в BOT.idle: Lampa закрыта — слушать канал; ушла только что — «я здесь, Lampa закрыта», потом раз в BUS.every. */
function busTick() {
    if (!busWanted()) return busStop();
    if (!bus.on) return busStart();
    var c = BT().cfg || {}, many = c.others > 0 || c.peers > 0 || bus.heard;
    if (!many) return;
    if (bus.firstAt && mono() >= bus.firstAt) { bus.firstAt = 0; return busHello(); }   // страница сказала «bye» — список у главного без нас
    if (!bus.firstAt && mono() - bus.helloAt >= BUS.every) busHello();
}

function alive(req, res) {
    readBody(req, LIMIT_CFG, function (err, b) {
        if (err) return json(res, err, { ok: false });
        var j = null;
        try { j = JSON.parse(b.toString('utf8') || '{}'); } catch (e) {}
        if (!j || typeof j !== 'object') return json(res, 400, { ok: false });
        var off = parseInt(j.offset, 10);
        if (off > pg.off && off < 1e15 && pgTrusted()) pg.off = off;     // номер от прежнего бота (токен сменился) — нет
        pg.seen = true;                                                    // своя страница с запуска службы — была
        if (j.cfg && setCfg(j.cfg)) botSaveSoon();
        if (j.away) { pg.away = true; botSoon(0); } else pageHere();
        json(res, 200, { ok: true, pending: BT().q.length, next: BT().offset, polling: loop.on });
    });
}

function handle(req, res) {
    var origin = req.headers.origin, host = String(req.headers.host || ''), authed = keyOk(req.headers['x-lampa-key']);
    cors(res);
    // Origin «null» (страница из file://, но и песочница любого сайта) — только с ключом; предзапрос CORS — без него
    if (origin && !ORIGIN_OK.test(origin) && !(origin === 'null' && (authed || req.method === 'OPTIONS'))) { log('чужой Origin', origin); return json(res, 403, { ok: false, error: 'origin' }); }
    // чужое имя в Host — DNS rebinding: сайт, прикинувшийся 127.0.0.1
    if (host && !/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) return json(res, 403, { ok: false, error: 'host' });
    if (req.method === 'OPTIONS') { res.sendDate = false; res.writeHead(204, { 'Content-Length': 0 }); return res.end(); }
    var u = parseUrl(req.url), p = u.pathname || '/', m;
    if (p === '/health') {
        var h = { ok: true, v: VERSION, store: storeState(), auth: authed };
        if (authed) { h.node = process.version; h.has = has(); h.launched = launchedWall; }
        return json(res, 200, h);
    }
    // диагностика «почему служба не опрашивает бота»: только состояние, без секретов
    if (p === '/debug') {                                             // без ключа: флажки и счётчики; номера апдейтов — только с ключом
        var db = BT(), dc = db.cfg || null;
        var dj = { ok: true, poll: shouldPoll(), server: !!server, tg: !!S().tg, cfg: !!dc,
            leader: dc ? !!dc.leader : null, peers: dc ? dc.peers : null, others: dc ? dc.others : null,
            seen: !!pg.seen, gone: pageGone(), away: !!pg.away, busy: pg.busy, sincePage: Math.round((mono() - pg.at) / 1000),
            yielded: !!loop.yielded, on: !!loop.on, takeover: !!loop.takeover, coolS: Math.max(0, Math.round((loop.coolUntil - mono()) / 1000)), watchN: loop.wN, waitS: Math.max(0, Math.round((loop.wait - mono()) / 1000)),
            backoff: loop.backoff, q: db.q.length, bus: bus.on, busHeard: bus.heard, busCmds: bus.cmds.length, me: !!(dc && dc.me) };
        if (authed) { dj.offset = db.offset; dj.pageOff = pg.off; dj.trusted = pgTrusted(); }
        return json(res, 200, dj);
    }
    if (!authed) return json(res, 401, { ok: false, error_code: 401, error: 'key', description: 'no access key' });
    if ((m = /^\/tg\/([A-Za-z]{1,40})$/.exec(p))) return tg(req, res, m[1]);
    if ((m = /^\/tgfile\/([\w\-.\/]{1,300})$/.exec(p)) && p.indexOf('..') < 0) return tgFile(req, res, m[1]);
    if ((m = /^\/ai\/(groq|gemini|openrouter)\/([\w\-.:\/]{0,300})$/.exec(p)) && p.indexOf('..') < 0) return ai(req, res, m[1], m[2], u.query || {});
    if (p === '/pending' && req.method === 'GET') {
        pageHere();
        if (botClean()) botSaveSoon();
        var pq = BT().q, give = B('give');
        return json(res, 200, { ok: true, next: BT().offset, more: pq.length > give, items: pq.slice(0, give) });
    }
    // команды этому ТВ, принятые службой из канала ТВ, пока Lampa была закрыта (свежие — не старше BUS.cmdAge)
    if (p === '/bus/cmds' && req.method === 'GET') {
        var bn = mono(), items = bus.cmds.filter(function (c) { return bn - c.at < BUS.cmdAge; }).map(function (c) { return c.m; });
        bus.cmds = [];
        return json(res, 200, { ok: true, items: items });
    }
    // экран ТВ: on / standby (выключен пультом) / '' — не узнали; странице, чтобы бот не писал «включаю» в тёмный экран
    if (p === '/power' && req.method === 'GET') return power(function (st) { json(res, 200, { ok: true, state: st }); });
    if (p === '/pair/status' && req.method === 'GET') return json(res, 200, { ok: true, open: !!(pairing && pairing.server), got: pairGot });
    if (req.method !== 'POST') return json(res, 404, { ok: false });
    if (p === '/alive') return alive(req, res);
    if (p === '/pair/start') return readJson(req, function (err, j) {
        if (err) return json(res, err, { ok: false });
        var secret = String(j.secret || '');
        if (!/^[a-z0-9]{16,64}$/.test(secret)) return json(res, 400, { ok: false, error: 'secret' });
        var st = storeState();
        if (st !== 'ok') return saveFail(res, failure(st === 'unreadable' ? 'UNREADABLE' : 'NODIR', st));   // токен некуда положить
        pairOpen(secret, function (P) {
            if (!P) return json(res, 503, { ok: false, error: 'port' });
            json(res, 200, { ok: true, port: P.port, ip: lanIp() });
        });
    });
    // закрыть — только своё подключение: секрет тот же, что в /pair/start (старый запрос не закроет новое окно)
    if (p === '/pair/stop') return readJson(req, function (err, j) {
        if (err) return json(res, err, { ok: false });
        var match = !!pairing && same(String(j.secret || ''), pairing.secret);
        if (match) pairClose();
        json(res, 200, { ok: true, closed: match, got: pairGot });
    });
    if (p === '/pending/ack') return readJson(req, function (err, j) {
        if (err) return json(res, err, { ok: false });
        var upTo = parseInt(j.upTo, 10);
        pageHere();
        if (upTo >= 0) { botDrop(upTo); if (upTo + 1 > pg.off) pg.off = upTo + 1; }
        json(res, 200, { ok: true, pending: BT().q.length, next: BT().offset });
    });
    if (p === '/secret') return readJson(req, function (err, j) {
        if (err) return json(res, err, { ok: false });
        var sl = slot(j.name), v = String(j.value === undefined || j.value === null ? '' : j.value).replace(/\s+/g, '');
        if (!sl) return json(res, 400, { ok: false, error: 'name' });
        if (v.length > 512 || !/^[\x21-\x7e]*$/.test(v)) return json(res, 400, { ok: false, error: 'value' });
        try { setSecret(sl, v); } catch (e) { return saveFail(res, e); }
        json(res, 200, { ok: true, has: has(), store: storeState() });
    });
    // «Отключить Telegram»: стираем всё — и поверх файла, который не прочитался (его человек и хочет стереть)
    if (p === '/forget') return readBody(req, LIMIT_SMALL, function () {
        var bad = secretsBad, was = secrets;
        secrets = blank(); secretsBad = false;
        try { save(); } catch (e) { secrets = was; secretsBad = bad; return saveFail(res, e); }
        joinCodes = {};
        botReset();
        json(res, 200, { ok: true, has: has(), store: storeState() });
    });
    if (p === '/derive') return readJson(req, function (err, j) {
        if (err) return json(res, err, { ok: false });
        var salt = String(j.salt || '');
        if (!/^[a-z0-9]{0,32}$/.test(salt)) return json(res, 400, { ok: false, error: 'salt' });
        if (!S().tg) return json(res, 503, { ok: false, error: 'no token' });
        var d = derive(salt);
        json(res, 200, { ok: true, topic: d.topic, key: d.key, invite: d.invite });
    });
    if (p === '/join') return join(req, res);
    json(res, 404, { ok: false });
}

function listen(cb) {
    if (server) { if (cb) cb(); return; }
    var s = http.createServer(function (req, res) { try { handle(req, res); } catch (e) { log('сбой', e.message); json(res, 500, { ok: false }); } });
    s.on('error', function (e) {
        log('порт', e.code);
        server = null;
        // порт ещё занят прошлым запуском службы — подождать и снова
        if (e.code === 'EADDRINUSE' && ++listenTries < 20) setTimeout(function () { listen(cb); }, 3000);
    });
    s.listen(cfg.port, HOST, function () { listenTries = 0; log('слушаю', HOST + ':' + cfg.port + ' v' + VERSION + ' node ' + process.version); if (cb) cb(); });
    server = s;
    if (!loop.timer) loop.timer = setInterval(botTick, B('idle'));          // страница ушла — пора ли опрашивать самим
}
function stop(cb) {
    var s = server;
    server = null;
    clearInterval(loop.timer); loop.timer = null;
    botHalt();
    busStop();
    if (bot) botFlush();
    pairClose();
    if (!s) { if (cb) cb(); return; }
    try { s.close(function () { if (cb) cb(); }); } catch (e) { if (cb) cb(); }
}

module.exports.onStart = function () {
    // служба одна на всё время работы ТВ: случайная ошибка в обработчике не должна её ронять
    try { process.on('uncaughtException', function (e) { log('сбой', e && e.message); }); } catch (e) {}
    try { load(); } catch (e) { secrets = blank(); secretsBad = true; }
    try { keyInit(); } catch (e) { log('ключ доступа', e.message); }
    try { botLoad(); } catch (e) { bot = botBlank(); }
    listen();
};
module.exports.onRequest = function () { listen(); };                        // уже запущена — сервер тот же
module.exports.onExit = function () { stop(); };
/* Только для тестов (tests/run.cjs): свой порт, папка и адреса внешних служб. */
module.exports._test = {
    config: function (o) {
        for (var k in o) if (o.hasOwnProperty(k)) cfg[k] = o[k];
        secrets = null; secretsBad = false; dirCache = ''; dirKind = ''; dirAt = 0; joinCodes = {}; accessKey = ''; tgBase = null;
        botHalt(); clearInterval(loop.timer); pairClose(); pairGot = false;
        bot = null; typing = {}; pg = { at: 0, busy: 0, away: false, max: -1, off: 0, seen: false, okGen: 0 }; tgGen = 0;
        clearTimeout(saveTimer); saveTimer = null;
        loop = { on: false, gen: 0, req: null, wait: 0, backoff: 0, yielded: false, timer: null, okM: 0, lost: false, more: false, c409: 0,
            takeover: false, coolUntil: 0, wAt: 0, wSince: 0, wBusy: false, wN: 0 };
        launchAt = 0; launchedWall = 0; closedMsg = {}; closedAt = {}; offWaitAt = {}; offAt = {}; okSaved = 0;
        busStop(); bus = { on: false, gen: 0, reqs: [], since: {}, seen: {}, seenN: 0, helloAt: 0, firstAt: 0, heard: false, cmds: [], topic: '', k: null };
    },
    start: function (cb) { load(); keyInit(); botLoad(); listen(cb); },
    stop: stop, key: function () { return accessKey; },
    tick: botTick, state: function () { return { bot: BT(), pg: pg, loop: loop, typing: typing, bus: bus }; },
    unseal: unseal, seal: seal, busOn: busOn, BUS: BUS,
    tvMatch: function (s, isCb) { var c = BT().cfg || {}; return isCb ? tvCb(c.tv || {}, s) : isTv(c, { message: { text: s } }, ''); },
    looksKey: looksKey, mono: mono,
    fnv: fnv, derive: derive, joinTopic: joinTopic, codes: function () { return joinCodes; }, PORT: PORT, VERSION: VERSION,
    pair: function () { return { open: !!(pairing && pairing.server), port: pairing ? pairing.port : 0, bad: pairing ? pairing.bad : 0, got: pairGot }; },
    PAIR: PAIR, RELAYS: RELAYS, lanIp: lanIp, pairLang: pairLang, joinFrom: joinFrom, joinKeys: joinKeys, x25519: x25519, join4Topic: join4Topic, join4Hellos: join4Hellos, join4Box: join4Box, TG_METHODS: TG_METHODS, cut: cut, flush: botFlush
};
