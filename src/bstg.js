/*
 * Уведомления в Telegram о новых сериях — через собственного бота пользователя.
 *
 *  Подключение с телефона (QR): токен длинный, пультом его не набрать. ТВ показывает QR со страницей ntfy.sh/<случайная
 *  тема> (открытая служба сообщений — своего сервера у нас нет); на телефоне: @BotFather → /newbot → скопировать токен
 *  → открыть QR → вставить → отправить. ТВ опрашивает тему, проверяет токен (getMe), просит написать боту и сам находит
 *  чат (getUpdates), бот присылает проверочное сообщение. Вручную — токен в поле и «Подключить».
 *  Сервера у нас нет: запросы к api.telegram.org идут прямо с ТВ, токен хранится только на нём (bs_tg_token).
 *
 *  Что отслеживаем: сериалы из закладок Lampa («Закладки», «Смотрю», «Запланировано») и все, что смотрели (bs_resume).
 *  Проверка: при запуске и потом раз в CHECK_EVERY на сериал — TMDB tv/{id}, last_episode_to_air. Серия новее той,
 *  что видели в прошлый раз, и вышла не раньше FRESH — сообщение с постером, один раз на серию (bs_tg_seen).
 *  Сериал впервые — только запоминаем текущую серию: старыми сериями не засыпаем.
 *  Ограничение: проверяет сам ТВ — пока Lampa не запущена, сообщения не уходят (придут при следующем запуске).
 *
 *  Ещё (пока Lampa запущена): утром в день выхода — «Сегодня выходит»; раз в неделю (с понедельника, первый запуск
 *  недели) — сводка «На этой неделе»; кнопки в сообщениях «Отписаться» / «Напомнить завтра»; команды боту: /subs —
 *  подписки, /find название (или просто текст) — поиск фильмов и сериалов (TMDB): постер, год, рейтинг и кнопки
 *  «Хочу посмотреть» (закладка Lampa «Позже» — wath, синхронизируется аккаунтом), «Открыть на ТВ», у сериала —
 *  «Подписаться». Бот слушает только свой чат (bs_tg_chat).
 *  Без команд со слешем: постоянная клавиатура внизу Telegram — «Найти», «Хочу посмотреть», «Мои подписки»,
 *  «На этой неделе», «Помощь»; название можно писать и просто текстом. Меню команд бота убираем (deleteMyCommands).
 *  Несколько ТВ на одном боте: Telegram отдаёт сообщения только одному опрашивающему (второй получает «Conflict») —
 *  поэтому один ТВ главный (опрашивает бота, шлёт уведомления), остальные слушают общий канал ntfy.sh, тема которого
 *  вычисляется из токена (без токена не угадать). По каналу: «я здесь» (название ТВ, главный ли, чат), «открой
 *  фильм на таком-то ТВ» и ответ, подписки и отправленные уведомления — чтобы у всех ТВ было одно и то же.
 *  «Открыть на ТВ» при нескольких включённых ТВ — выбор по названию (Настройки → Telegram → «Название этого ТВ»).
 *  Главный выключили — его место после паузы занимает другой (через тот же «Conflict» Telegram).
 *  Родная кнопка Lampa «Подписаться» на карточке сериала (платная подписка CUB — у нас «Нет подписки») подписывает
 *  через бота, как кнопка в плеере.
 *
 *  Подписка в плеере, как в YouTube: на самой последней вышедшей серии сериала слева в панели плеера — «Подписаться» /
 *  «Вы подписаны ✓» (bs_subs) и когда выйдет следующая серия (TMDB next_episode_to_air): «через 3 дня (16 окт)».
 *  Подписанные сериалы отслеживаются вместе с закладками.
 */
var BSTelegram = (function () {
    var API = 'https://api.telegram.org/bot';
    var CHECK_EVERY = 6 * 3600 * 1000, FRESH = 7 * 86400000, MAX = 30, TIMEOUT = 15000;
    var BOOKMARKS = ['book', 'look', 'scheduled'];

    function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
    function on(k, def) { var v = lsGet(k); return v === null ? def : v === 'true'; }
    function noty(t, time) { try { Lampa.Noty.show(esc(t), { time: time || 4000 }); } catch (e) {} }
    /** Текст в HTML Lampa (Noty, Select): имена из Telegram и с других ТВ - чужие, разметку из них не исполняем. */
    function esc(t) { return String(t === undefined || t === null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    /** Имя человека/ТВ: без символов разметки, не длиннее 40. */
    function cleanName(t) { return String(t || '').replace(/[<>&"'`]/g, '').replace(/^\s+|\s+$/g, '').slice(0, 40); }
    function log(a, b) { try { console.log('BS telegram', a, b === undefined ? '' : b); } catch (e) {} }

    function token() { return String(lsGet('bs_tg_token') || '').replace(/\s+/g, ''); }
    function chat() { return lsGet('bs_tg_chat') || ''; }

    /* Кому отвечаем сейчас: владелец (bs_tg_chat) или человек, подключившийся по QR в поиске, — у него свой чат и свои
     * списки. cur ставит разбор сообщения (as); keep переносит его в ответы Telegram/TMDB/Gemini, которые придут позже. */
    var cur = '';
    function to() { return cur || chat(); }
    function isOwner() { return to() === chat(); }
    function keep(fn) {
        if (typeof fn !== 'function') return fn;
        var c = cur;
        return function () { var p = cur; cur = c; try { return fn.apply(this, arguments); } finally { cur = p; } };
    }
    function as(c, fn) { var p = cur; cur = String(c || ''); try { fn(); } finally { cur = p; } }

    /* ---------- Bot API ---------- */

    /** wait — своё время ожидания ответа, мс (длинный опрос getUpdates). */
    function call(method, params, ok, fail, wait) {
        ok = keep(ok); fail = keep(fail);
        var q = [], k;
        for (k in params) if (params.hasOwnProperty(k)) q.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
        var x = new XMLHttpRequest(), done = false;
        var end = function (f, v) { if (!done) { done = true; if (f) f(v); } };
        try {
            x.open('GET', API + token() + '/' + method + (q.length ? '?' + q.join('&') : ''), true);
            x.timeout = wait || TIMEOUT;
            x.onload = function () {
                var j = null;
                try { j = JSON.parse(x.responseText); } catch (e) {}
                if (j && j.ok) end(ok, j.result);
                else end(fail, (j && j.description) || ('ответ ' + x.status));
            };
            x.onerror = function () { end(fail, 'нет связи с Telegram'); };
            x.ontimeout = function () { end(fail, 'Telegram не ответил'); };
            x.send();
        } catch (e) { end(fail, e.message); }
    }

    /** Чат из последних сообщений боту (getUpdates): самое свежее личное сообщение. skip — чаты подключённых людей:
     *  владельцем при подключении ТВ не может стать гость, который писал боту последним. */
    function chatFrom(updates, skip) {
        for (var i = (updates || []).length - 1; i >= 0; i--) {
            var u = updates[i], m = u && (u.message || u.edited_message || u.my_chat_member);
            if (m && m.chat && m.chat.id && m.chat.type === 'private' && !(skip && skip[String(m.chat.id)])) return String(m.chat.id);
        }
        return '';
    }

    /** buttons — [[{text, callback_data}]] под сообщением (необязательно). */
    function send(text, photo, ok, fail, buttons) {
        if (!token() || !chat()) { if (fail) fail('не подключено'); return; }
        var extra = function (p) { if (buttons) p.reply_markup = JSON.stringify({ inline_keyboard: buttons }); return p; };
        var plain = function () { call('sendMessage', extra({ chat_id: to(), text: text }), ok, fail); };
        if (photo) call('sendPhoto', extra({ chat_id: to(), photo: photo, caption: text }), ok, plain);
        else plain();
    }
    var KB = { keyboard: [[{ text: '📋 Меню' }], [{ text: '👤 Профиль' }, { text: '❓ Помощь' }]],
        resize_keyboard: true, is_persistent: true };
    var HELP = 'Я — ваш помощник Lampa 🎬\n\n' +
        '🔎 Напишите название фильма или сериала — найду: «▶️ Смотреть» (сразу включит на ТВ), «Хочу посмотреть», подписаться. Можно и описать словами — поможет ИИ.\n' +
        'Можно с годом и студией: «Доктор Стрендж 2026», «2026», «фильмы Марвел 2026», «сериалы Netflix».\n' +
        '🖼 Пришлите скриншот, кадр или постер — узнаю фильм (Gemini).\n' +
        '⌨️ «Набрать на ТВ» — пишете текст здесь, а он появляется в поиске Lampa на телевизоре.\n' +
        '➕ Ещё один ТВ: в его Lampa — Настройки → Telegram → «Подключить через бота», код с экрана пришлите сюда.\n' +
        '🔔 Пришлю новую серию, когда выйдет, и напомню утром в день выхода.\n' +
        '🗓 По понедельникам — что выходит на неделе.\n' +
        '🎬 Записали момент кнопкой «Записать» в плеере — видео придёт сюда.\n' +
        '👥 Семья: каждый подключает свой Telegram через QR в поиске Lampa — у каждого свои «Хочу посмотреть» и подписки. «Люди» — кто подключён.\n\n' +
        '📋 «Меню» внизу — все разделы кнопками. Работаю, пока Lampa на ТВ запущена.';
    var HELP_GUEST = HELP.replace(/➕[^\n]*\n/, '').replace(/👥[^\n]*\n/, '👥 Ваши «Хочу посмотреть» и подписки — только ваши, другие их не видят.\n');
    function helpText() { return isOwner() ? HELP : HELP_GUEST; }
    function sendKb(text) { call('sendMessage', { chat_id: to(), text: text, reply_markup: JSON.stringify(KB) }, null, null); }

    function epButtons(id) { return [[{ text: '🔕 Отписаться', callback_data: 'u:' + id }, { text: '⏰ Напомнить завтра', callback_data: 'l:' + id }]]; }
    /** Меню команд слева от поля ввода - те же разделы, что в «📋 Меню». */
    var COMMANDS = [
        { command: 'menu', description: '📋 Главное меню' },
        { command: 'find', description: '🔎 Найти фильм или сериал' },
        { command: 'type', description: '⌨️ Набрать текст в поиске Lampa на ТВ' },
        { command: 'want', description: '⭐ Хочу посмотреть' },
        { command: 'subs', description: '🔔 Мои подписки' },
        { command: 'week', description: '🗓 На этой неделе' },
        { command: 'tvs', description: '📺 Телевизоры' },
        { command: 'profile', description: '👤 Профиль' },
        { command: 'help', description: '❓ Помощь' }
    ];
    function setCommands() {
        call('setMyCommands', { commands: JSON.stringify(COMMANDS) }, null, null);
        call('setChatMenuButton', { menu_button: JSON.stringify({ type: 'commands' }) }, null, null);
    }

    /** «📋 Меню»: сообщение «Выберите раздел» с кнопками-плитками, как у бота Skaz. */
    function menuRows() {
        var b = function (text, a) { return { text: text, callback_data: 'mn:' + a }; };
        var rows = [
            [b('🔎 Найти', 'find'), b('🖼 По картинке', 'pic')],
            [b('⌨️ Набрать на ТВ', 'type')],
            [b('⭐ Хочу посмотреть', 'want'), b('🔔 Мои подписки', 'subs')],
            [b('🗓 На этой неделе', 'week'), b('📺 Телевизоры', 'tvs')]
        ];
        if (isOwner()) rows.push([b('👥 Люди', 'people')]);
        rows.push([b('👤 Профиль', 'profile')]);
        rows.push([b('❓ Помощь', 'help'), b('❤️ Поддержать', 'support')]);
        return rows;
    }
    function tvNames() { return allTvs().map(function (d) { return d.text.replace(/^📺 /, ''); }); }
    function sendMenu() {
        var tvs = tvNames();
        reply('📺 На связи: ' + tvs.join(', ') + (aiReady() ? ' · 🧠 ИИ-поиск включён' : '') + '\n\nВыберите раздел:', menuRows());
    }
    function profileText() {
        var g = guest(), people = users(), me = people[to()] || {}, ai = aiProviders().map(function (x) { return x.p === 'gemini' ? 'Gemini' : OA[x.p].name; });
        var subsN = (isOwner() ? subs() : ((g || {}).subs || [])).length;
        var lines = [
            '👤 ' + (isOwner() ? 'Владелец бота' : 'Вы подключены' + (me.name ? ' как ' + me.name : '') + ' — свои списки и подписки'),
            '📺 Телевизоры на связи: ' + tvNames().join(', '),
            '🔔 Подписок: ' + subsN,
            '🧠 ИИ-поиск: ' + (ai.length ? ai.join(', ') : 'нет ключа — пришлите ключ Groq, Gemini или OpenRouter (подробнее — «🖼 По картинке»)')
        ];
        if (isOwner()) {
            var guests = Object.keys(people).filter(function (k) { return active(people[k]); }).length;
            lines.push('👥 Подключено людей: ' + guests);
        }
        return lines.join('\n');
    }
    function tvsInfo() {
        var tvs = allTvs();
        var rows = isOwner() ? [[{ text: '✏️ Переименовать ТВ', callback_data: 'rn' }]] : null;
        reply('📺 Телевизоры на связи (' + tvs.length + '):\n' + tvs.map(function (d) { return '• ' + d.text.replace(/^📺 /, ''); }).join('\n') +
            '\n\nЕщё один ТВ: в его Lampa — Настройки → Telegram → «Подключить через бота», код с экрана пришлите сюда.', rows);
    }
    function supportText() {
        return '❤️ Lampa для Samsung и TV Installer — бесплатные.\nПоддержать развитие: https://github.com/sponsors/sunic007';
    }
    function menuAction(a) {
        if (a === 'find') return reply('Напишите название фильма или сериала 👇');
        if (a === 'type') return typeStart();
        if (a === 'pic') return aiReady() ? aiStatus() : reply(geminiHow());
        if (a === 'want') return wantList();
        if (a === 'subs') return subsList();
        if (a === 'week') return reply(weekText(true));
        if (a === 'tvs') return tvsInfo();
        if (a === 'people') return isOwner() ? peopleList() : null;
        if (a === 'profile') return reply(profileText(), [[{ text: '📋 Меню', callback_data: 'mn:menu' }]]);
        if (a === 'help') return sendKb(helpText());
        if (a === 'support') return reply(supportText());
        if (a === 'menu') return sendMenu();
    }

    function link() {
        if (!token()) return noty('Сначала впишите токен бота', 3000);
        noty('Подключаю…', 2000);
        call('getMe', {}, function (me) {
            if (me && me.username) lsSet('bs_tg_bot', me.username);
            call('getUpdates', {}, function (updates) {
                var c = chatFrom(updates, users());
                if (!c) return noty('Напишите своему боту @' + me.username + ' любое сообщение и нажмите «Подключить» ещё раз', 7000);
                lsSet('bs_tg_chat', c);
                call('sendMessage', { chat_id: c, text: '✅ Lampa подключена.\n\n' + HELP, reply_markup: JSON.stringify(KB) },
                    function () { noty('Telegram подключён: @' + me.username, 4000); refreshSettings(); setCommands(); check(false); },
                    function (e) { noty('Чат найден, но сообщение не ушло: ' + e, 6000); });
            }, function (e) { noty('Telegram: ' + e, 5000); });
        }, function (e) { noty('Токен не подошёл: ' + e, 6000); });
    }

    /* ---------- подключение с телефона (QR через ntfy.sh) ---------- */

    /* ---------- шифрование и подпись сообщений через ntfy (ES5, без WebCrypto: старые ТВ) ----------
     * SHA-256 и HMAC-SHA256 на чистом JS. seal: поток HMAC(ключ шифрования, nonce|счётчик) XOR текст, подпись
     * HMAC(ключ подписи, nonce|шифртекст) — подделать, прочитать или изменить сообщение без ключа нельзя.
     * Та же копия — в docs/pair.html (страница на телефоне шифрует токен). */
    var Crypt = (function () {
        var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
            0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
            0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
            0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
            0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
            0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
            0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
            0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
        function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
        /** SHA-256 массива байт -> массив из 32 байт. */
        function sha256(msg) {
            var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
            var m = msg.slice(0), bitLen = msg.length * 8, i, j;
            m.push(0x80);
            while (m.length % 64 !== 56) m.push(0);
            for (i = 7; i >= 0; i--) m.push(i > 3 ? 0 : (bitLen >>> (i * 8)) & 255);
            var w = new Array(64);
            for (var off = 0; off < m.length; off += 64) {
                for (i = 0; i < 16; i++) w[i] = (m[off + i * 4] << 24) | (m[off + i * 4 + 1] << 16) | (m[off + i * 4 + 2] << 8) | m[off + i * 4 + 3];
                for (i = 16; i < 64; i++) {
                    var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
                    var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
                    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
                }
                var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
                for (i = 0; i < 64; i++) {
                    var t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
                    var t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
                    hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
                }
                h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
                h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
            }
            var out = [];
            for (i = 0; i < 8; i++) for (j = 3; j >= 0; j--) out.push((h[i] >>> (j * 8)) & 255);
            return out;
        }
        function hmac(key, msg) {
            if (key.length > 64) key = sha256(key);
            var ik = [], ok = [];
            for (var i = 0; i < 64; i++) { var k = key[i] || 0; ik.push(k ^ 0x36); ok.push(k ^ 0x5c); }
            return sha256(ok.concat(sha256(ik.concat(msg))));
        }
        function bytes(s) { var u = unescape(encodeURIComponent(String(s))), b = []; for (var i = 0; i < u.length; i++) b.push(u.charCodeAt(i)); return b; }
        function text(b) { var s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return decodeURIComponent(escape(s)); }
        function b64(b) { var s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
        function unb64(s) { var r = atob(String(s || '')), b = []; for (var i = 0; i < r.length; i++) b.push(r.charCodeAt(i)); return b; }
        function hex(b) { var s = ''; for (var i = 0; i < b.length; i++) s += ('0' + b[i].toString(16)).slice(-2); return s; }
        function rnd(n) {
            var a = [], i;
            try {
                var c = window.crypto || window.msCrypto, u = new Uint8Array(n);
                c.getRandomValues(u);
                for (i = 0; i < n; i++) a.push(u[i]);
                return a;
            } catch (e) {}
            for (i = 0; i < n; i++) a.push(Math.floor(Math.random() * 256));
            return a;
        }
        function stream(ek, nonce, data) {
            var out = [];
            for (var i = 0; i < data.length; i += 32) {
                var ks = hmac(ek, nonce.concat([(i >>> 24) & 255, (i >>> 16) & 255, (i >>> 8) & 255, i & 255]));
                for (var j = 0; j < 32 && i + j < data.length; j++) out.push(data[i + j] ^ ks[j]);
            }
            return out;
        }
        /** Ключ из строки (токен, код, секрет из QR). */
        function key(str) { return sha256(bytes(str)); }
        /** Зашифровать и подписать строку: {z:2, n, c, s}. */
        function seal(k, str) {
            var n = rnd(16), ct = stream(hmac(k, bytes('enc')), n, bytes(str));
            return { z: 2, n: b64(n), c: b64(ct), s: b64(hmac(hmac(k, bytes('mac')), n.concat(ct)).slice(0, 16)) };
        }
        /** Проверить подпись и расшифровать; чужое или изменённое — null. */
        function open(k, m) {
            try {
                if (!m || m.z !== 2) return null;
                var n = unb64(m.n), ct = unb64(m.c), tag = unb64(m.s);
                if (n.length !== 16 || tag.length !== 16) return null;
                var want = hmac(hmac(k, bytes('mac')), n.concat(ct)).slice(0, 16), diff = 0;
                for (var i = 0; i < 16; i++) diff |= want[i] ^ tag[i];
                if (diff) return null;
                return text(stream(hmac(k, bytes('enc')), n, ct));
            } catch (e) { return null; }
        }
        /** Случайный секрет для QR: 22 символа без похожих букв. */
        function secret() {
            var a = 'abcdefghijkmnpqrstuvwxyz23456789', r = rnd(22), s = '';
            for (var i = 0; i < r.length; i++) s += a.charAt(r[i] % a.length);
            return s;
        }
        return { sha256: sha256, hmac: hmac, bytes: bytes, hex: hex, key: key, seal: seal, open: open, secret: secret };
    })();

    var RELAY = 'https://ntfy.sh/', TOKEN_RE = /(\d{6,12}:[A-Za-z0-9_-]{30,})/, PAIR_TIME = 15 * 60000;
    var pair = null;     // {topic, since, until, stage: 'token' | 'chat', busy, timer}

    function randomTopic() {
        var a = 'abcdefghijkmnpqrstuvwxyz23456789', t = 'lampa-';
        for (var i = 0; i < 16; i++) t += a.charAt(Math.floor(Math.random() * a.length));
        return t;
    }
    function pairStop() { if (pair) clearInterval(pair.timer); pair = null; }

    /** Новые сообщения темы (ntfy: построчный JSON). cb(токен или '', время последнего сообщения). */
    function pollRelay(p, cb) {
        var x = new XMLHttpRequest(), done = false;
        var end = function (tok, last) { if (!done) { done = true; cb(tok || '', last || ''); } };
        try {
            x.open('GET', RELAY + p.topic + '/json?poll=1&since=' + encodeURIComponent(p.since), true);
            x.timeout = TIMEOUT;
            x.onload = function () { end.apply(null, tokenFrom(x.responseText, p.secret)); };
            x.onerror = x.ontimeout = function () { end('', ''); };
            x.send();
        } catch (e) { end('', ''); }
    }
    /** Токен из ответа ntfy (последний подходящий) и id последнего сообщения — дальше читаем после него (по id, а не по
     *  часам ТВ: часы нового ТВ могут спешить, и «с такого-то времени» отсеяло бы присланный токен). */
    function tokenFrom(text, secret) {
        var tok = '', last = '', k = secret ? Crypt.key('lampa-pair-v2|' + secret) : null;
        String(text || '').split('\n').forEach(function (line) {
            var ev = null, body = '';
            try { ev = JSON.parse(line); } catch (e) { return; }
            if (!ev || ev.event !== 'message') return;
            if (ev.id) last = ev.id;
            body = String(ev.message || '');
            if (k) {                                   // с секретом из QR - только зашифрованный им токен
                var sealed = null;
                try { sealed = JSON.parse(body); } catch (e) { return; }
                body = Crypt.open(k, sealed) || '';
            }
            var m = TOKEN_RE.exec(body.replace(/\s+/g, ''));
            if (m && !tok) tok = m[1];
        });
        return [tok, last];
    }

    function pairPhone() {
        pairStop();
        // своя лёгкая страница на GitHub Pages (поле и кнопка) — веб-приложение ntfy на телефоне тяжёлое и тормозит;
        // токен она отправляет в ту же тему ntfy одним запросом
        // в адресе после # - тема и секрет: страница шифрует им токен, в кэше ntfy его не прочитать
        var topic = randomTopic(), secret = Crypt.secret(), url = 'https://sunic007.github.io/lampa-samsung/pair.html#' + topic + '.' + secret;
        var body = $('<div class="bs-tg-pair"><div class="bs-tg-pair__qr"></div><div class="bs-tg-pair__steps">' +
            '<p>1. В Telegram откройте <b>@BotFather</b> → <b>/newbot</b> → придумайте имя → нажмите на токен, чтобы скопировать.</p>' +
            '<p>2. Наведите камеру телефона на QR-код. На открывшейся странице вставьте токен и нажмите «Отправить на ТВ».</p>' +
            '<p>3. Напишите своему боту любое сообщение.</p>' +
            '<div class="bs-tg-pair__url"></div><div class="bs-tg-pair__status">Жду токен с телефона…</div></div></div>');
        body.find('.bs-tg-pair__url').text(url);
        try { Lampa.Utils.qrcode(url, body.find('.bs-tg-pair__qr')[0]); } catch (e) { log('qr', e.message); }
        var status = function (t) { body.find('.bs-tg-pair__status').text(t); };
        var ctrl = 'settings_component';
        try { ctrl = Lampa.Controller.enabled().name; } catch (e) {}
        var close = function () { pairStop(); try { Lampa.Modal.close(); Lampa.Controller.toggle(ctrl); } catch (e) {} };
        Lampa.Modal.open({ title: 'Telegram — подключить с телефона', html: body, size: 'medium', onBack: close });
        var p = pair = { topic: topic, secret: secret, since: '2m', until: Date.now() + PAIR_TIME, stage: 'token', busy: false };
        p.timer = setInterval(function () {
            if (pair !== p) return;
            if (Date.now() > p.until) { status('Время вышло — откройте подключение ещё раз'); return pairStop(); }
            if (p.busy) return;
            p.busy = true;
            if (p.stage === 'token') {
                pollRelay(p, function (tok, time) {
                    if (time) p.since = time;                           // это сообщение больше не перечитываем (id)
                    if (!tok) { p.busy = false; return; }
                    lsSet('bs_tg_token', tok);
                    lsSet('bs_tg_chat', '');
                    try { Lampa.Storage.set('bs_tg_token', tok, true); } catch (e) {}
                    call('getMe', {}, function (me) {
                        if (me && me.username) lsSet('bs_tg_bot', me.username);
                        p.stage = 'chat'; p.busy = false;
                        busStart(); busSend({ t: 'who' });                   // бот уже на другом ТВ — чат пришлёт он
                        status('Токен получен ✓  Теперь напишите боту @' + me.username + ' любое сообщение');
                    }, function (e) { p.busy = false; status('Токен не подошёл (' + e + '). Отправьте токен ещё раз'); });
                });
            } else {
                if (chat()) { p.busy = false; return pairDone(); }        // чат прислал главный ТВ
                call('getUpdates', {}, function (updates) {
                    p.busy = false;
                    var c = chatFrom(updates, users());
                    if (!c || pair !== p) return;
                    lsSet('bs_tg_chat', c);
                    pairDone();
                }, function () { p.busy = false; });
            }
        }, 3000);
        function pairDone() {
            if (pair !== p) return;
            pairStop();
            sendKb('✅ Lampa подключена.\n\n' + HELP);
            status('Готово! Telegram подключён ✓');
            refreshSettings();
            setCommands();
            busHello(true);
            check(false);
            setTimeout(close, 2500);
        }
    }

    /* ---------- ещё один ТВ: подключение по коду, без токена ----------
     * Новый ТВ показывает 8 цифр и слушает тему ntfy, выведенную из них. Человек присылает код боту; ТВ, где бот уже
     * работает, кладёт в эту тему токен и чат. Бот принимает сообщения только из своего чата, так что код может
     * прислать только хозяин; тему без кода не угадать. */

    function joinCode() { var c = ''; for (var i = 0; i < 8; i++) c += Math.floor(Math.random() * 10); return c; }
    function joinTopic(code) { return 'lampa-join-' + fnv(code, 2166136261) + fnv(code + '#', 2166136261); }
    /** Код из сообщения: «1234 5678», «1234-5678», «12345678». */
    function joinFrom(t) { var m = /^\s*(\d{4})[\s-]?(\d{4})\s*$/.exec(String(t || '')); return m ? m[1] + m[2] : ''; }

    /** Сообщение с подключением из темы: {token, chat} или null. */
    function joinMsg(text, p) {
        var found = null, k = p && p.code ? Crypt.key('lampa-join-v2|' + p.code) : null;
        String(text || '').split('\n').forEach(function (line) {
            var ev = null, m = null;
            try { ev = JSON.parse(line); } catch (e) { return; }
            if (!ev || ev.event !== 'message') return;
            if (p && ev.id) p.since = ev.id;                        // дальше — после этого сообщения (по id, не по часам ТВ)
            try { m = JSON.parse(ev.message); } catch (e) { return; }
            if (k) { try { m = JSON.parse(Crypt.open(k, m) || 'null'); } catch (e) { return; } }   // зашифровано ключом из кода
            if (m && m.t === 'join' && TOKEN_RE.test(String(m.token || ''))) found = { token: String(m.token), chat: String(m.chat || '') };
        });
        return found;
    }

    function pairJoin() {
        pairStop();
        var code = joinCode();
        var body = $('<div class="bs-tg-pair"><div class="bs-tg-pair__steps">' +
            '<p>Telegram уже подключён на другом ТВ? Токен вводить не нужно.</p>' +
            '<p>1. На том ТВ должна быть запущена Lampa.</p><p>2. Отправьте своему боту код:</p>' +
            '<div class="bs-tg-join__code"></div><div class="bs-tg-pair__status">Жду код в боте…</div></div></div>');
        body.find('.bs-tg-join__code').text(code.slice(0, 4) + ' ' + code.slice(4));
        var status = function (t) { body.find('.bs-tg-pair__status').text(t); };
        var ctrl = 'settings_component';
        try { ctrl = Lampa.Controller.enabled().name; } catch (e) {}
        var close = function () { pairStop(); try { Lampa.Modal.close(); Lampa.Controller.toggle(ctrl); } catch (e) {} };
        Lampa.Modal.open({ title: 'Telegram — подключить через бота', html: body, size: 'medium', onBack: close });
        // since — сначала «за 2 минуты» по часам ntfy: часы ТВ могут спешить, и ответ отсеялся бы
        var p = pair = { topic: joinTopic(code), code: code, since: '2m', until: Date.now() + PAIR_TIME, busy: false, start: Date.now() };
        p.timer = setInterval(function () {
            if (pair !== p) return;
            if (Date.now() > p.until) { status('Время вышло — откройте подключение ещё раз'); return pairStop(); }
            if (!p.hinted && Date.now() - p.start > 30000) {
                p.hinted = true;                                     // код никто не принял — бот сейчас никто не ведёт
                status('Ответа пока нет. Похоже, Lampa не запущена ни на одном подключённом ТВ — включите её там и отправьте код ещё раз. Или подключите этот ТВ с телефона: «Подключить с телефона».');
            }
            if (p.busy) return;
            p.busy = true;
            var x = new XMLHttpRequest();
            try {
                x.open('GET', RELAY + p.topic + '/json?poll=1&since=' + encodeURIComponent(p.since), true);
                x.timeout = TIMEOUT;
                x.onload = function () {
                    p.busy = false;
                    var m = joinMsg(x.responseText, p);
                    if (!m || pair !== p) return;
                    lsSet('bs_tg_token', m.token);
                    try { Lampa.Storage.set('bs_tg_token', m.token, true); } catch (e) {}
                    lsSet('bs_tg_chat', m.chat);
                    pairStop();
                    status('Готово! Telegram подключён ✓');
                    refreshSettings();
                    busStart(); busHello(true);                         // главный пришлёт и список людей
                    send('✅ Подключён ещё один ТВ: «' + tvName() + '»', null, null, null);
                    setTimeout(close, 2500);
                };
                x.onerror = x.ontimeout = function () { p.busy = false; };
                x.send();
            } catch (e) { p.busy = false; }
        }, 3000);
    }

    /** Главный ТВ: код от человека -> токен и чат в тему нового ТВ. */
    function joinSend(code) {
        var x = new XMLHttpRequest();
        try {
            x.open('POST', RELAY + joinTopic(code), true);
            x.timeout = TIMEOUT;
            x.onload = keep(function () { reply(x.status < 300 ? '⏳ Передаю подключение на новый ТВ…' : 'Не получилось передать (' + x.status + ') — отправьте код ещё раз.'); });
            x.onerror = x.ontimeout = keep(function () { reply('Нет связи — отправьте код ещё раз.'); });
            x.send(JSON.stringify(Crypt.seal(Crypt.key('lampa-join-v2|' + code), JSON.stringify({ t: 'join', token: token(), chat: chat(), ts: Date.now() }))));
        } catch (e) { reply('Не получилось: ' + e.message); }
    }

    /* ---------- несколько людей: у каждого свои списки ----------
     * Владелец — первый подключивший бота: его «Хочу посмотреть» и подписки — это списки самой Lampa на ТВ. Другие
     * подключаются, наведя камеру на QR в поиске Lampa (t.me/бот?start=приглашение): у них свои «Хочу посмотреть»,
     * подписки, «напомнить завтра» и сводка — в bs_tg_users, видны только им в боте. Владельцу — «Подключился…» с
     * кнопкой «Отключить». Приглашение выводится из токена бота — одно на все ТВ, без синхронизации. */

    function users() { var u = lsJson('bs_tg_users', {}); return u && typeof u === 'object' ? u : {}; }
    function active(g) { return !!g && !g.banned && !g.pending; }
    /** Сохранить и разослать другим ТВ изменённых людей (ids). У записи rev — время правки: старое новое не затрёт. */
    function saveUsers(u, ids) {
        var now = Date.now();
        (ids || []).forEach(function (id) { if (u[id]) u[id].rev = now; });
        lsSet('bs_tg_users', JSON.stringify(u));
        (ids || []).forEach(function (id) { if (u[id]) busUser(id, u[id]); });
    }
    function guest() { if (isOwner()) return null; var g = users()[to()]; return active(g) ? g : null; }
    function updGuest(fn) { var u = users(), g = u[to()]; if (!active(g)) return; fn(g); saveUsers(u, [to()]); }
    function allowed(c) { c = String(c); return !!chat() && (c === chat() || active(users()[c])); }

    /* Канал ТВ (ntfy) берёт до 4 КБ на сообщение — запись человека идёт кусками {t:'u', id, rev, i, n, d}. */
    var USER_PART = 900, userParts = {};
    function busUser(id, g) {
        var str = JSON.stringify(g), n = Math.max(1, Math.ceil(str.length / USER_PART));
        for (var i = 0; i < n; i++) busSend({ t: 'u', id: id, rev: g.rev || 0, i: i, n: n, d: str.slice(i * USER_PART, (i + 1) * USER_PART) });
    }
    function onUserPart(m) {
        var k = m.id + ':' + m.rev;
        if (Object.keys(userParts).length > 50) userParts = {};
        var b = userParts[k] = userParts[k] || { got: 0, parts: [] };
        if (b.parts[m.i] === undefined) { b.parts[m.i] = String(m.d || ''); b.got++; }
        if (b.got < (m.n | 0)) return;
        delete userParts[k];
        var g = null;
        try { g = JSON.parse(b.parts.join('')); } catch (e) { return; }
        if (!g || typeof g !== 'object') return;
        if (g.name) g.name = cleanName(g.name);
        var all = users();
        if (all[m.id] && (all[m.id].rev || 0) >= m.rev) return;
        all[m.id] = g;
        lsSet('bs_tg_users', JSON.stringify(all));
    }
    function sendAllUsers() { var u = users(); for (var k in u) if (u.hasOwnProperty(k)) busUser(k, u[k]); }
    function inviteCode() {
        var t = token(), salt = lsGet('bs_tg_invite_salt') || '';
        return t ? fnv(t + '#invite' + salt, 2166136261) + fnv('#invite' + salt + t, 2166136261) : '';
    }
    /** Настройки бота владельца - общие для всех ТВ (ходят по каналу): одобрение новых людей, видео от гостей, приглашение. */
    function needApprove() { return on('bs_tg_approve', true); }
    function guestPlay() { return on('bs_tg_guest_play', true); }
    function cfgSend() { busSend({ t: 'cfg', approve: needApprove(), play: guestPlay(), salt: lsGet('bs_tg_invite_salt') || '' }); }
    function onCfg(m) {
        lsSet('bs_tg_approve', String(m.approve !== false));
        lsSet('bs_tg_guest_play', String(m.play !== false));
        if (typeof m.salt === 'string' && /^[a-z0-9]{0,32}$/.test(m.salt)) lsSet('bs_tg_invite_salt', m.salt);
    }
    /** Новое приглашение: старые QR и ссылки перестают подключать. Уже подключённые остаются. */
    function inviteReset() {
        lsSet('bs_tg_invite_salt', Crypt.secret().slice(0, 12));
        cfgSend();
    }
    /** Карточка для списка человека — только нужное. */
    function mini(card, kind) {
        return { id: card.id, tv: kind === 't', name: String(card.name || card.title || '').slice(0, 60) };
    }
    /** Сериалы человека для уведомлений: подписки и «Хочу посмотреть» (только сериалы), без отписанных. */
    function guestTracked(g) {
        var out = [], seen = {}, muted = (g && g.muted) || [];
        ((g && g.subs) || []).concat((g && g.want) || []).forEach(function (c) {
            if (!c || !(c.id > 0) || !c.tv || seen[c.id] || muted.indexOf(String(c.id)) >= 0) return;
            seen[c.id] = 1;
            out.push(c);
        });
        return out;
    }
    /** Кому слать уведомления: владелец (его сериалы — как раньше) и каждый подключившийся. */
    function recipients() {
        var out = [{ c: '', owner: true, list: tracked() }], u = users();
        for (var k in u) if (u.hasOwnProperty(k) && active(u[k])) out.push({ c: k, owner: false, list: guestTracked(u[k]) });
        return out;
    }
    function trackedNow() { return isOwner() ? tracked() : guestTracked(guest()); }

    /** Чужой чат: приглашение из QR — подключить; иначе — подсказать, где QR. */
    function stranger(u, c) {
        var msg = u.message;
        if (!msg || typeof msg.text !== 'string' || !msg.chat || msg.chat.type !== 'private') return;
        var st = /^\/start(?:@\w+)?\s+(\S+)/.exec(msg.text);
        if (st && inviteCode() && st[1] === inviteCode()) {
            var name = cleanName([msg.from && msg.from.first_name, msg.from && msg.from.last_name].filter(Boolean).join(' ')) || 'Гость';
            var all = users();
            if (all[c] && all[c].banned) {                       // отключённый — снова только с разрешения владельца
                as(c, function () { reply('Владелец отключил вас от Lampa. Я отправил ему запрос — когда разрешит, напишу.'); });
                as('', function () { reply('👤 ' + name + ' хочет снова подключиться к Lampa.', [[{ text: '✅ Разрешить', callback_data: 'ok:' + c }]]); });
                return;
            }
            if (needApprove()) {
                if (all[c] && all[c].pending && Date.now() - (all[c].at || 0) < 3600000) {   // уже спросили - не заваливаем владельца
                    return as(c, function () { reply('⏳ Запрос уже у владельца — когда разрешит, напишу.'); });
                }
                all[c] = { name: name, pending: true, at: Date.now() };
                saveUsers(all, [c]);
                as(c, function () { reply('⏳ Я спросил владельца бота — когда разрешит, напишу.'); });
                as('', function () {
                    reply('👤 ' + name + ' хочет подключиться к Lampa (через QR в поиске).',
                        [[{ text: '✅ Разрешить', callback_data: 'ok:' + c }, { text: '🚫 Отклонить', callback_data: 'ku:' + c }]]);
                });
                log('просит подключиться', name);
                return;
            }
            all[c] = { name: name, at: Date.now(), want: [], subs: [], muted: [], later: [] };
            saveUsers(all, [c]);
            as(c, function () { sendKb('👋 ' + name + ', вы подключены к Lampa.\nУ вас свои «Хочу посмотреть» и подписки — другие их не видят.\n\n' + helpText()); });
            as('', function () { reply('👤 Подключился ' + name + ' — через QR в поиске Lampa. У него свои списки и уведомления.', [[{ text: '🚫 Отключить', callback_data: 'ku:' + c }]]); });
            log('подключился', name);
            return;
        }
        as(c, function () { reply('Этот бот — для Lampa на ТВ. Чтобы подключиться, наведите камеру телефона на QR-код в поиске Lampa.'); });
    }

    function peopleList() {
        if (!isOwner()) return reply('Список людей видит только владелец бота.');
        var u = users(), ids = Object.keys(u).filter(function (i) { return active(u[i]); });
        var waiting = Object.keys(u).filter(function (i) { return u[i] && u[i].pending; });
        var rows = ids.slice(0, 10).map(function (i) { return [{ text: '🚫 ' + u[i].name, callback_data: 'ku:' + i }]; });
        waiting.slice(0, 5).forEach(function (i) { rows.push([{ text: '✅ ' + u[i].name, callback_data: 'ok:' + i }, { text: '🚫 Отклонить', callback_data: 'ku:' + i }]); });
        rows.push([{ text: (needApprove() ? '✅' : '⬜') + ' Новые — с моего разрешения', callback_data: 'cfg:ap' }]);
        rows.push([{ text: (guestPlay() ? '✅' : '⬜') + ' Гости включают видео на ТВ', callback_data: 'cfg:play' }]);
        rows.push([{ text: '🔄 Сменить приглашение (QR)', callback_data: 'cfg:inv' }]);
        var text = ids.length ? '👥 Ещё пользуются ботом:\n' + ids.map(function (i) { return '• ' + u[i].name; }).join('\n') + '\n\nНажмите имя, чтобы отключить.'
            : '👥 Кроме вас ботом никто не пользуется.\nДругие подключаются, наведя камеру на QR в поиске Lampa на ТВ.';
        if (waiting.length) text += '\n\n⏳ Ждут разрешения: ' + waiting.map(function (i) { return u[i].name; }).join(', ');
        reply(text, rows);
    }

    /** Человек (не владелец): «Хочу посмотреть», убрать, подписаться — в его списках. */
    function guestAction(act, card, kind, name, answer) {
        var m = mini(card, kind);
        var other = function (c) { return !(c && c.id == m.id && !!c.tv === m.tv); };
        updGuest(function (g) {
            if (act === 'x') g.want = (g.want || []).filter(other);
            else if (act === 'w') g.want = [m].concat((g.want || []).filter(other)).slice(0, 100);
            else if (act === 's') {
                g.subs = [m].concat((g.subs || []).filter(other)).slice(0, 100);
                g.muted = (g.muted || []).filter(function (x) { return x !== String(m.id); });
            }
        });
        answer(act === 'x' ? '✖ «' + name + '» убран из «Хочу посмотреть»' : act === 'w' ? '⭐ «' + name + '» — в «Хочу посмотреть»' : '🔔 Подписка на «' + name + '»');
    }

    /* ---------- записи Shots → Telegram ----------
     * Shots (плагин CUB): кнопка «Записать» в плеере — момент до 5 мин; CUB обрабатывает его и шлёт событие
     * shots_status {id, status: 'ready', file, screen}. Готовая запись — сразу в бот: видео (не взял Telegram — кадр со
     * ссылкой), фильм, серия и момент, кнопки «▶️ Смотреть» и «📺 Открыть на ТВ». Переслать — обычной пересылкой. */
    function clock(sec) {
        sec = Math.max(0, Math.round(+sec || 0));
        var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60;
        return (h ? h + ':' + ('0' + m).slice(-2) : m) + ':' + ('0' + x).slice(-2);
    }
    function shotCaption(info, tv) {
        info = info || {};
        var ep = info.season > 0 && info.episode > 0 ? ' — ' + info.season + ' сезон, ' + info.episode + ' серия' : '';
        var at = info.start_point > 0 ? ' (с ' + clock(info.start_point) + ')' : '';
        return '🎬 Запись из «' + (info.card_title || 'фильма') + '»' + (info.card_year && info.card_year !== '----' ? ' (' + info.card_year + ')' : '') + ep + at +
            '\nЗаписано на ТВ «' + tv + '». Переслать друзьям — как обычное видео в Telegram.';
    }
    function onShot(e) {
        if (!e || e.status !== 'ready' || !e.file || !on('bs_tg_shots', true) || !token() || !chat()) return;
        var sent = lsJson('bs_tg_shots', []);
        if (sent.indexOf(String(e.id)) >= 0) return;
        sent.unshift(String(e.id));
        lsSet('bs_tg_shots', JSON.stringify(sent.slice(0, 100)));
        var info = null;
        try { (Lampa.Storage.get('shots_created', '[]') || []).forEach(function (x) { if (x && x.id == e.id) info = x; }); } catch (x) {}
        info = info || {};
        var kind = info.card_type === 'tv' ? 't' : 'm', caption = shotCaption(info, tvName());
        var buttons = info.card_id > 0 ? [[{ text: '▶️ Смотреть', callback_data: 'v:' + kind + ':' + info.card_id }, { text: '📺 Открыть на ТВ', callback_data: 'o:' + kind + ':' + info.card_id }]] : null;
        var asLink = function (why) {
            log('запись — видео не принято, шлю ссылку', why);
            send(caption + '\n▶️ ' + e.file, e.screen || null, null, function (er) { log('запись не отправлена', er); }, buttons);
        };
        var p = { chat_id: chat(), video: e.file, caption: caption, supports_streaming: 'true' };
        if (e.screen) p.thumbnail = e.screen;
        if (buttons) p.reply_markup = JSON.stringify({ inline_keyboard: buttons });
        call('sendVideo', p, function () { log('запись в Telegram', e.id); }, asLink, 60000);
    }

    /** Готовые записи, которые прошли мимо (Lampa закрыли, пока CUB их обрабатывал), — прислать. Первый раз — только
     *  запомнить уже сделанные, старые в чат не сыплем. */
    function shotsSweep() {
        var created = [];
        try { created = Lampa.Storage.get('shots_created', '[]') || []; } catch (e) {}
        if (lsGet('bs_tg_shots') === null) return lsSet('bs_tg_shots', JSON.stringify(created.map(function (x) { return String(x && x.id); }).slice(0, 100)));
        created.forEach(function (x) { if (x && x.status === 'ready' && x.file) onShot({ id: x.id, status: 'ready', file: x.file, screen: x.screen }); });
    }

    /* ---------- QR бота в поиске Lampa ----------
     * Под клавиатурой поиска: бот подключён — QR на него (t.me/имя): найти с телефона, «Открыть на ТВ» — откроется
     * здесь; не подключён — одна строка, где подключить. Не выбирается пультом — клавиатуре не мешает. */

    function botName(cb) {
        var n = lsGet('bs_tg_bot');
        if (n || !token()) return cb(n || '');
        call('getMe', {}, function (me) { if (me && me.username) lsSet('bs_tg_bot', me.username); cb((me && me.username) || ''); }, function () { cb(''); });
    }
    /** Экранная клавиатура поиска: набрали текст и ушли вниз (история, источники, результаты) - прячется, результаты
     *  поднимаются наверх; вернулись к вводу - появляется снова. Lampa сама её не прячет. Контроллер клавиатуры в
     *  Lampa называется 'keybord'. */
    function searchKeypad() {
        if (searchKeypad.on || !Lampa.Controller || !Lampa.Controller.listener) return;
        searchKeypad.on = true;
        Lampa.Controller.listener.follow('toggle', function (e) {
            try {
                var body = $('body'), input = $('.search .search__input');
                if (!body.hasClass('search--open')) return body.removeClass('bs-kb-hidden');
                var typed = input.hasClass('filled') && $.trim(input.text()) !== '';
                body.toggleClass('bs-kb-hidden', !!typed && e.name !== 'keybord' && e.name !== 'search');
            } catch (x) {}
        });
    }

    function searchQr() {
        if (!on('bs_search_qr', true)) return;
        var body = $('.search .search__body').first();
        if (!body.length || body.find('.bs-search-tg').length) return;
        var box = $('<div class="bs-search-tg"><div class="bs-search-tg__qr"></div><div class="bs-search-tg__text"></div></div>');
        // ниже истории и вкладок источников: сразу под строкой поиска - история, как в Lampa
        var under = body.find('.search__sources');
        if (under.length) under.after(box); else body.append(box);
        var text = function (t) { box.find('.bs-search-tg__text').text(t); };
        if (!token() || !chat()) {
            box.addClass('bs-search-tg--off');
            return text('📱 Искать можно и с телефона — подключите Telegram-бот: Настройки → Telegram.');
        }
        botName(function (n) {
            if (!n) { box.addClass('bs-search-tg--off'); return text('📱 Искать с телефона: напишите своему Telegram-боту название — «Открыть на ТВ» откроет фильм здесь.'); }
            try { Lampa.Utils.qrcode('https://t.me/' + n + (inviteCode() ? '?start=' + inviteCode() : ''), box.find('.bs-search-tg__qr')[0]); } catch (e) { box.addClass('bs-search-tg--off'); }
            text('📱 Искать с телефона: наведите камеру — откроется бот @' + n + '. Напишите название или пришлите скриншот, «📺 Открыть на ТВ» — фильм откроется здесь. У каждого, кто подключится, свои «Хочу посмотреть» и подписки.');
        });
    }

    /* ---------- несколько ТВ: общий канал ntfy.sh ---------- */

    // Кто ведёт бота, решает сам Telegram: опрашивать может один — второй получает «409 занято». Остальные ТВ пробуют
    // раз в минуту (CONFLICT_PAUSE): главный выключился — следующая попытка берёт бота. Уходя (ТВ выключают, Lampa в
    // фоне), главный шлёт «bye» — другие берут бота сразу.
    // Каждые 40 с ТВ шлёт «я здесь». Главный молчит 2 минуты - считаем его ушедшим, и бота берёт следующий на экране.
    var HELLO_EVERY = 40000, LEADER_ALIVE = 120000, CONFLICT_PAUSE = 60000, TAKEOVER_PAUSE = 8000, STALE_UPDATE = 180;
    var DEVICE_ALIVE = 70 * 60000, ACK_WAIT = 10000;
    var tvId = lsGet('bs_tv_id');
    if (!tvId) { tvId = randomTopic().slice(6, 14); lsSet('bs_tv_id', tvId); }
    var devices = {}, leader = { id: '', at: 0 }, isLeader = false, conflictUntil = 0, acks = {};

    function tvName() {
        var n = String(lsGet('bs_tv_name') || '').replace(/^\s+|\s+$/g, '');
        if (n) return n;
        try { n = String(Lampa.Storage.get('device_name', '') || ''); } catch (e) {}
        if (n && n !== 'Lampa') return n;
        n = String(lsGet('bs_tv_devname') || '');
        return n || 'ТВ ' + tvId.slice(0, 3).toUpperCase();
    }
    /** Имя телевизора из него самого: «Имя устройства» Samsung (Общие → Диспетчер системы), без «[TV] ». */
    function cleanDevName(j) {
        var d = (j && j.device) || {}, n = String(d.name || j && j.name || '').replace(/^\s*\[TV\]\s*/i, '').replace(/^\s+|\s+$/g, '');
        return n.slice(0, 40);
    }
    function loadDevName() {
        var x = new XMLHttpRequest();
        try {
            x.open('GET', 'http://127.0.0.1:8001/api/v2/', true);
            x.timeout = 8000;
            x.onload = function () {
                var j = null;
                try { j = JSON.parse(x.responseText); } catch (e) {}
                var n = cleanDevName(j), was = lsGet('bs_tv_devname') || '';
                if (j && j.device && j.device.modelName) lsSet('bs_tv_model', String(j.device.modelName));
                if (n && n !== was) { lsSet('bs_tv_devname', n); busHello(false); }
            };
            x.send();
        } catch (e) {}
    }
    /** Подпись ТВ в списке: одинаковые имена различаем моделью или кусочком id. */
    function tvLabels(list) {
        var count = {};
        list.forEach(function (d) { count[d.name] = (count[d.name] || 0) + 1; });
        return list.map(function (d) {
            var extra = count[d.name] > 1 ? ' · ' + (d.model && list.filter(function (o) { return o.name === d.name && o.model === d.model; }).length === 1 ? d.model : d.id.slice(0, 3).toUpperCase()) : '';
            // старая Lampa (до 1.7.18) не присылает адрес — не умеет пульт и переименование, пусть будет видно
            var old = d.id !== tvId && (!d.ip || (d.v && verNum(d.v) < verNum(appVer())));
            return { id: d.id, ip: d.ip, old: old, text: '📺 ' + d.name + extra + (old ? ' (старая Lampa)' : '') };
        });
    }
    function myIp() { try { return String(webapis.network.getIp() || ''); } catch (e) { return ''; } }
    /** Все ТВ: этот первым, потом включённые. */
    function allTvs() {
        return tvLabels([{ id: tvId, name: tvName(), model: lsGet('bs_tv_model') || '', ip: myIp() }].concat(otherTvs()));
    }
    /** 32-битный FNV-1a: тема канала из токена — без токена не угадать, сам токен в канал не попадает. */
    function fnv(str, h) {
        for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24); h = h >>> 0; }
        return ('0000000' + h.toString(16)).slice(-8);
    }
    function busTopic() { var t = token(); return t ? 'lampa-tv-' + fnv(t, 2166136261) + fnv(t + '#', 2166136261) : ''; }

    /** Ключ канала из токена: без токена сообщение не прочитать и не подделать. */
    var busKeyFor = '', busKeyVal = null;
    function busKey() {
        var t = token();
        if (t !== busKeyFor) { busKeyFor = t; busKeyVal = t ? Crypt.key('lampa-bus-v2|' + t) : null; }
        return busKeyVal;
    }
    function busSend(obj) {
        var topic = busTopic(), k = busKey();
        if (!topic || !k) return;
        obj.from = tvId; obj.ts = Date.now();
        try {
            var x = new XMLHttpRequest();
            x.open('POST', RELAY + topic, true);
            x.timeout = TIMEOUT;
            x.send(JSON.stringify(Crypt.seal(k, JSON.stringify(obj))));
        } catch (e) {}
    }
    /** Сообщение канала: зашифрованное нашим ключом - разбираем; повтор (тот же nonce) и старше суток - мимо.
     *  Незашифрованное - только от старой версии Lampa: верим лишь «я в сети» (hello/bye), без чата и команд. */
    var busSeen = {}, busSeenN = 0;
    function busOpen(raw) {
        var m = null;
        try { m = JSON.parse(raw); } catch (e) { return null; }
        if (m && m.z === 2) {
            if (busSeen[m.n]) return null;
            var t = Crypt.open(busKey(), m);
            if (!t) return null;
            if (++busSeenN > 500) { busSeen = {}; busSeenN = 0; }
            busSeen[m.n] = 1;
            try { m = JSON.parse(t); } catch (e) { return null; }
            if (!m || (m.ts && Math.abs(Date.now() - m.ts) > 86400000)) return null;
            return m;
        }
        if (!m || (m.t !== 'hello' && m.t !== 'bye')) return null;
        return { t: m.t, from: m.from, name: m.name, model: m.model, v: m.v, ts: m.ts };
    }
    function appVer() { try { return window.BS_REMOTE_VERSION || (typeof BS_PACKAGE_VERSION !== 'undefined' ? String(BS_PACKAGE_VERSION) : ''); } catch (e) { return ''; } }
    function onScreen() { try { return !document.hidden; } catch (e) { return true; } }
    function busHello(ask) { busSend({ t: 'hello', v: appVer(), name: tvName(), model: lsGet('bs_tv_model') || '', ip: myIp(), leader: isLeader, fg: onScreen(), chat: chat(), ask: !!ask }); }
    /** Главный молчит дольше LEADER_ALIVE (или его вовсе нет) - бота можно брать. */
    function leaderStale() { return !isLeader && (!leader.id || Date.now() - leader.at > LEADER_ALIVE); }
    /** Очередь на бота: сколько ТВ на экране с свежим «я здесь» и меньшим id. 0 - берём первым. */
    function takeoverRank() {
        var now = Date.now(), rank = 0, k;
        for (k in devices) if (devices.hasOwnProperty(k) && devices[k].fg && now - devices[k].at < LEADER_ALIVE && k < tvId) rank++;
        return rank;
    }

    /* Поток канала: один длинный запрос (ntfy шлёт сообщения построчно); раз в 30 мин — заново, чтобы ответ не рос. */
    var busX = null, busNow = '', busSince = '', busPos = 0, busTimer = null, busLife = null;
    function busStop() { clearTimeout(busTimer); clearTimeout(busLife); if (busX) { var x = busX; busX = null; try { x.abort(); } catch (e) {} } }
    function busStart() {
        var topic = busTopic();
        if (!topic) return busStop();
        if (busX && busNow === topic) return;
        busStop();
        busNow = topic; busPos = 0;
        var x = busX = new XMLHttpRequest();
        try {
            x.open('GET', RELAY + topic + '/json?since=' + (busSince || Math.floor(Date.now() / 1000) - 120), true);
            x.onprogress = function () { if (busX === x) busRead(x); };
            x.onload = x.onerror = x.onabort = function () {
                if (busX !== x) return;
                busRead(x);
                busX = null;
                busTimer = setTimeout(busStart, 5000);
            };
            x.send();
            busLife = setTimeout(function () { if (busX === x) { busX = null; try { x.abort(); } catch (e) {} busStart(); } }, 30 * 60000);
        } catch (e) { busX = null; busTimer = setTimeout(busStart, 15000); }
    }
    function busRead(x) {
        var text = '';
        try { text = x.responseText || ''; } catch (e) { return; }
        var chunk = text.slice(busPos), nl = chunk.lastIndexOf('\n');
        if (nl < 0) return;
        busPos += nl + 1;
        chunk.slice(0, nl).split('\n').forEach(function (line) {
            var ev = null, m = null;
            try { ev = JSON.parse(line); } catch (e) { return; }
            if (!ev || ev.event !== 'message') return;
            busSince = ev.id || busSince;
            m = busOpen(ev.message);
            if (!m) return;
            try { onBus(m); } catch (e) { log('канал', e.message); }
        });
    }

    function onBus(m) {
        if (!m || !m.t || !m.from || m.from === tvId) return;
        var now = Date.now();
        if (m.name) {
            var dv = devices[m.from] || {};
            devices[m.from] = { name: cleanName(m.name), at: now, model: m.model || dv.model || '', ip: m.ip || dv.ip || '', v: m.v || dv.v || '' };
            if (m.t === 'hello') oldWarn(m.from);
        }
        if (m.t === 'hello') {
            if (renameWait && renameWait.to === m.from && m.name === renameWait.title) { clearTimeout(renameWait.timer); renameWait = null; reply('✅ ТВ теперь называется «' + m.name + '».'); }
            if (m.leader) leader = { id: m.from, at: now };
            if (devices[m.from]) devices[m.from].fg = !!m.fg;
            if (m.chat && !chat()) { lsSet('bs_tg_chat', String(m.chat)); refreshSettings(); }
            if (m.ask) busHello(false);
            if (m.ask && isLeader) { sendAllUsers(); cfgSend(); }                   // новый/включившийся ТВ — люди от главного
        } else if (m.t === 'who') busHello(false);
        else if (m.t === 'bye') {                                      // ТВ ушёл (выключили, Lampa в фоне)
            delete devices[m.from];
            if (leader.id === m.from) leader = { id: '', at: 0 };
            if (m.lead !== false) { conflictUntil = 0; setTimeout(poll, 300 + Math.floor(Math.random() * 1500)); }   // вёл бота — взять сейчас
        }
        else if (m.t === 'u' && m.id && m.rev) onUserPart(m);
        else if (m.t === 'cfg') onCfg(m);
        else if (m.t === 'rename' && m.to === tvId && m.title) { lsSet('bs_tv_name', String(m.title).slice(0, 40)); busHello(false); refreshSettings(); }
        else if (m.t === 'open' && m.to === tvId && now - (m.ts || 0) < 60000) openHere(m.k, m.id, m.ref, !!m.play, !!m.g);
        else if (m.t === 'type' && m.to === tvId && now - (m.ts || 0) < 60000) {
            var why = typedText(m.text) ? typeHere(typedText(m.text)) : 'пустой текст';
            if (m.ref) busSend({ t: 'ack', ref: m.ref, ok: !why, why: why, name: tvName() });
        }
        else if (m.t === 'ack' && m.ref && acks[m.ref]) { var a = acks[m.ref]; delete acks[m.ref]; a(m); }
        else if (m.t === 'sub' && m.card && m.card.id) setSub(m.card, !!m.on, null);
        else if (m.t === 'seen' && m.id) {
            var all = loadSeen(), r = all[m.id] || {};
            r.s = m.s | 0; r.e = m.e | 0; r.at = r.at || now;
            all[m.id] = r;
            lsSet('bs_tg_seen', JSON.stringify(trimSeen(all)));
        } else if (m.t === 'today' && m.tag) {
            var done = lsJson('bs_tg_today', []);
            if (done.indexOf(m.tag) < 0) { done.unshift(m.tag); lsSet('bs_tg_today', JSON.stringify(done.slice(0, 200))); }
        }
    }

    /* Разные версии Lampa на ТВ: бота ведёт тот, кто успел, — старая версия не знает новых кнопок («▶️ Смотреть» и
     * т.п.), нажатие пропадает. Поэтому ТВ уступает бота включённому ТВ с более новой Lampa, а владельцу один раз
     * пишем, где обновить. Совсем старые (до 1.7.33) этого правила не знают — их нужно обновить. */
    function verNum(v) { var m = /(\d+)\.(\d+)\.(\d+)/.exec(String(v || '')); return m ? +m[1] * 1e6 + +m[2] * 1e3 + +m[3] : 0; }
    function newerOnline() {
        var mine = verNum(appVer()), now = Date.now(), k;
        if (!mine) return false;
        for (k in devices) if (devices.hasOwnProperty(k) && now - devices[k].at < 30 * 60000 && verNum(devices[k].v) > mine) return true;
        return false;
    }
    function oldWarn(id) {
        var d = devices[id], mine = verNum(appVer());
        if (!d || !isLeader || !mine || !d.v || verNum(d.v) >= mine) return;
        var tag = id + '@' + d.v, warned = lsJson('bs_tg_oldwarn', []);
        if (warned.indexOf(tag) >= 0) return;
        warned.unshift(tag);
        lsSet('bs_tg_oldwarn', JSON.stringify(warned.slice(0, 50)));
        as('', function () { reply('⚠️ На «' + d.name + '» старая Lampa ' + String(d.v).replace(/-debug$/, '') + ' (здесь ' + String(appVer()).replace(/-debug$/, '') + '). Пока его не обновить, он иногда перехватывает бота — и новые кнопки («▶️ Смотреть» и др.) не срабатывают. Установите на нём новую версию.'); });
    }

    /** Другие включённые ТВ (отзывались за последний час). */
    function otherTvs() {
        var out = [], now = Date.now(), k;
        for (k in devices) if (devices.hasOwnProperty(k) && now - devices[k].at < DEVICE_ALIVE) out.push({ id: k, name: devices[k].name, model: devices[k].model, ip: devices[k].ip, v: devices[k].v });
        out.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
        return out;
    }
    /** Главный — этот ТВ (только он шлёт уведомления; один ТВ — всегда он). */
    function leading() { return isLeader || !(leader.id && leader.id !== tvId && Date.now() - leader.at < LEADER_ALIVE); }
    /** Подписка — и всем ТВ. */
    function setSubAll(card, on, info) {
        setSub(card, on, info);
        busSend({ t: 'sub', on: on, card: { id: card.id, name: card.name || card.title || '', original_name: card.original_name || '', poster_path: card.poster_path || '', source: card.source || 'tmdb', first_air_date: card.first_air_date || '' } });
    }

    /** Открыть карточку на этом ТВ (команда с главного или свой выбор). */
    /* «▶️ Смотреть» из бота: открыть карточку и самим нажать на ней «Смотреть» (кнопка bsmenu.js или «Онлайн» Skaz).
     * Дальше — как с пульта: сериал — с той серии, где остановились, новый фильм — сразу в русской озвучке (bscontinue). */
    var watchFor = null;
    /* Пока на ТВ идёт видео, карточку открыть нельзя: её перекрыл бы плеер. Запрос владельца не отбрасываем,
     * а ставим в очередь - когда плеер закроют, бот откроет карточку сам. Гостям очереди нет: видео смотрит
     * владелец, гость получает отказ. */
    var afterVideo = null, AFTER_VIDEO_MAX = 10 * 60000;
    function tvPlaying() { try { return !!Lampa.Player.opened(); } catch (e) { return false; } }
    function whenVideoEnds(run) { afterVideo = { run: run, at: Date.now() }; }
    function onVideoClosed() {
        var w = afterVideo;
        afterVideo = null;
        if (w && Date.now() - w.at < AFTER_VIDEO_MAX) setTimeout(keep(function () { w.run(); }), 1500);
    }
    function pushCard(card, kind, play) {
        watchFor = play ? { id: card.id, until: Date.now() + 30000 } : null;
        Lampa.Activity.push({ url: '', component: 'full', id: card.id, method: kind === 't' ? 'tv' : 'movie', card: card, source: 'tmdb' });
    }
    function onFullWatch(e) {
        if (!watchFor || !e || e.type !== 'complite' || !e.body || Date.now() > watchFor.until) return;
        var card = e.data && e.data.movie;
        if (!card || card.id != watchFor.id) return;
        watchFor = null;
        var tries = 0;
        (function click() {
            var b = e.body.find('.bs-watch').first();
            if (!b.length) e.body.find('.buttons--container > .full-start__button').each(function () {
                var x = $(this);
                if (!b.length && (x.hasClass('lampac--button') || /^(Онлайн|Online)$/i.test($.trim(x.text())))) b = x;
            });
            if (b.length) { log('смотреть сразу', card.id); return b.trigger('hover:enter'); }
            if (++tries < 20) setTimeout(click, 300);
            else noty('Не нашёл кнопку «Смотреть» — нажмите её на карточке', 4000);
        })();
    }

    function openHere(kind, id, ref, play, guest) {
        var ack = function (ok, why, wait) { if (ref) busSend({ t: 'ack', ref: ref, ok: ok, why: why || '', name: tvName(), wait: !!wait }); };
        if (tvPlaying()) {
            if (guest) return ack(false, 'на этом ТВ сейчас смотрят — подождите');
            ack(true, 'откроется, когда закончится видео', true);
            return whenVideoEnds(function () { openHere(kind, id, ref, play, false); });
        }
        tmdbGet((kind === 't' ? 'tv/' : 'movie/') + id, function (j) {
            if (!j || !j.id) return ack(false, 'TMDB не ответил');
            try {
                pushCard(toCard(j, kind), kind, play);
                ack(true);
            } catch (e) { ack(false, e.message); }
        });
    }

    /* ---------- новые серии ---------- */

    function epKey(s, e) { return (s | 0) * 10000 + (e | 0); }

    /** Новая ли серия: prev — {s, e} из прошлой проверки (нет — сериал впервые), last — last_episode_to_air TMDB. */
    function isNew(prev, last, now) {
        if (!prev || !last) return false;
        var s = last.season_number | 0, e = last.episode_number | 0;
        if (!s || !e || epKey(s, e) <= epKey(prev.s, prev.e)) return false;
        var air = Date.parse(last.air_date || '');
        return air > 0 && (now || Date.now()) - air <= FRESH;
    }

    /** Сериалы: закладки Lampa и то, что смотрели (bs_resume). Только каталог TMDB/CUB (id — TMDB). */
    function tracked() {
        var out = [], seen = {};
        var add = function (c) {
            if (!c || !(c.id > 0) || seen[c.id]) return;
            var src = String(c.source || 'tmdb');
            if (src !== 'tmdb' && src !== 'cub') return;
            if (!(c.name || c.original_name || c.number_of_seasons || c.first_air_date)) return;     // только сериалы
            seen[c.id] = 1;
            out.push(c);
        };
        BOOKMARKS.forEach(function (type) { try { (Lampa.Favorite.get({ type: type }) || []).forEach(add); } catch (e) {} });
        try { (window.BSContinue && BSContinue._load ? BSContinue._load() : []).forEach(function (r) { add(r.card); }); } catch (e) {}
        subs().forEach(add);
        var muted = mutedList();
        return out.filter(function (c) { return muted.indexOf(String(c.id)) < 0; });
    }

    /** Не больше 300 сериалов: самые давние (по at) выбрасываем. */
    function trimSeen(all) {
        var ids = Object.keys(all || {});
        if (ids.length <= 300) return all;
        ids.sort(function (x, y) { return ((all[y] || {}).at || 0) - ((all[x] || {}).at || 0); });
        var out = {};
        ids.slice(0, 300).forEach(function (k) { out[k] = all[k]; });
        return out;
    }
    function loadSeen() { try { return JSON.parse(lsGet('bs_tg_seen') || '{}') || {}; } catch (e) { return {}; } }

    var running = false;
    function check(force, report) {
        if (running || !on('bs_tg_on', true) || !token() || !chat() || !Lampa.TMDB || !Lampa.Reguest) return;
        if (!leading()) { if (report) noty('Уведомления шлёт главный ТВ: ' + ((devices[leader.id] || {}).name || 'другой'), 3500); return; }
        var seen = loadSeen(), now = Date.now(), sent = 0, pool = [], have = {};
        recipients().forEach(function (r) { r.list.forEach(function (c) { if (!have[c.id]) { have[c.id] = 1; pool.push(c); } }); });
        var list = pool.filter(function (c) { var r = seen[c.id] || {}; return force || r.name === undefined || now - (r.at || 0) > CHECK_EVERY; }).slice(0, MAX);
        if (!list.length) { if (report) noty('Новых серий нет', 2500); return; }
        running = true;
        (function next() {
            var c = list.shift();
            if (!c) {
                running = false;
                log('проверено, новых', sent);
                if (report) noty(sent ? 'Отправлено новых серий: ' + sent : 'Новых серий нет', 3000);
                return;
            }
            var url = Lampa.TMDB.api('tv/' + c.id + '?api_key=' + Lampa.TMDB.key() + '&language=ru');
            new Lampa.Reguest().silent(url, function (json) {
                var last = json && json.last_episode_to_air, all = loadSeen(), prev = all[c.id];
                if (last && isNew(prev, last, Date.now())) {
                    sent++;
                    var name = json.name || c.name || c.title || '';
                    var text = '🎬 Вышла новая серия\n' + name + '\nСезон ' + last.season_number + ', серия ' + last.episode_number +
                        (last.name && !/^(серия|episode)\s*\d+$/i.test(last.name) ? ' — ' + last.name : '');
                    var poster = json.poster_path ? 'https://image.tmdb.org/t/p/w500' + json.poster_path : null;
                    recipients().forEach(function (r) {
                        if (!r.list.some(function (x) { return x.id == c.id; })) return;
                        as(r.c, function () { send(text, poster, null, function (e) { log('не отправлено', e); }, epButtons(c.id)); });
                    });
                    busSend({ t: 'seen', id: c.id, s: last.season_number | 0, e: last.episode_number | 0 });
                }
                var nx = json && json.next_episode_to_air;
                all[c.id] = {
                    s: last ? last.season_number | 0 : prev ? prev.s : 0, e: last ? last.episode_number | 0 : prev ? prev.e : 0, at: Date.now(),
                    name: (json && json.name) || c.name || c.title || '', poster: (json && json.poster_path) || '',
                    next: nx && nx.air_date ? { s: nx.season_number | 0, e: nx.episode_number | 0, d: nx.air_date } : null
                };
                lsSet('bs_tg_seen', JSON.stringify(trimSeen(all)));
                setTimeout(next, 1200);
            }, function () { setTimeout(next, 1200); });
        })();
    }

    /* ---------- «Сегодня выходит», «Напомнить завтра», сводка на неделю ---------- */

    function lsJson(k, def) { try { var v = JSON.parse(lsGet(k) || 'null'); return v === null ? def : v; } catch (e) { return def; } }
    function mutedList() { return lsJson('bs_tg_muted', []); }
    function dayStr(t) { var d = new Date(t); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
    function posterUrl(p) { return p ? 'https://image.tmdb.org/t/p/w500' + p : null; }
    var WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

    /** Сводка: серии с датой выхода в ближайшие 7 дней (от today, полночь) — строки по дате. */
    function weekLines(seen, ids, today) {
        var out = [];
        ids.forEach(function (id) {
            var r = seen[id], n = r && r.next;
            if (!n || !n.d) return;
            var p = n.d.split('-'), t = new Date(+p[0], +p[1] - 1, +p[2]).getTime();
            if (t < today || t >= today + 7 * 86400000) return;
            out.push({ t: t, line: WEEKDAYS[new Date(t).getDay()] + ' ' + (+p[2]) + ' ' + MONTHS[+p[1] - 1] + ' — ' + (r.name || '') + ' ' + n.s + '×' + n.e });
        });
        out.sort(function (a, b) { return a.t - b.t; });
        return out.map(function (x) { return '• ' + x.line; });
    }
    /** Понедельник недели, в которую попадает t — ключ «сводка этой недели уже была». */
    function weekKey(t) { var d = new Date(t), back = (d.getDay() + 6) % 7; return dayStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime()); }

    function weekText(all) {
        var seen = loadSeen(), ids = trackedNow().map(function (c) { return String(c.id); }), d0 = new Date();
        var lines = weekLines(seen, ids, new Date(d0.getFullYear(), d0.getMonth(), d0.getDate()).getTime());
        return lines.length ? '🗓 На этой неделе выходят\n' + lines.slice(0, 20).join('\n') : (all ? '🗓 На этой неделе новых серий у ваших сериалов нет.' : '');
    }

    function remind() {
        if (!on('bs_tg_on', true) || !token() || !chat() || !leading()) return;
        var now = Date.now(), hour = new Date(now).getHours(), seen = loadSeen();
        var done = lsJson('bs_tg_today', []), today = dayStr(now), changed = false, people = users(), peopleChanged = [];
        recipients().forEach(function (r) {
            var ids = r.list.map(function (c) { return String(c.id); }), g = r.owner ? null : people[r.c];
            if (!r.owner && !active(g)) return;
            as(r.c, function () {
                // утром в день выхода (метка владельца — как раньше, у остальных — с номером чата)
                if (hour >= 8) ids.forEach(function (id) {
                    var x = seen[id], n = x && x.next;
                    if (!n || n.d !== today) return;
                    var tag = (r.owner ? '' : r.c + '@') + id + ':' + n.s + ':' + n.e;
                    if (done.indexOf(tag) >= 0) return;
                    done.unshift(tag); changed = true;
                    busSend({ t: 'today', tag: tag });
                    send('📅 Сегодня выходит\n' + (x.name || '') + '\nСезон ' + n.s + ', серия ' + n.e, posterUrl(x.poster), null, null,
                        [[{ text: '🔕 Отписаться', callback_data: 'u:' + id }]]);
                });
                // «напомнить завтра»
                var later = r.owner ? lsJson('bs_tg_later', []) : (g.later || []), keepL = later.filter(function (x) { return x.at > now; });
                later.filter(function (x) { return x.at <= now; }).forEach(function (x) {
                    var y = seen[x.id] || {};
                    send('⏰ Напоминание\n' + (y.name || x.name || '') + (y.s ? ' — вышла серия ' + y.s + '×' + y.e : ''), posterUrl(y.poster), null, null);
                });
                if (keepL.length !== later.length) { if (r.owner) lsSet('bs_tg_later', JSON.stringify(keepL)); else { g.later = keepL; peopleChanged.push(r.c); } }
                // сводка на неделю — с понедельника, при первом запуске недели после 9:00
                var wk = weekKey(now), fresh = ids.every(function (id) { return seen[id] && seen[id].name !== undefined; });
                var last = r.owner ? lsGet('bs_tg_week') : g.week;
                if (hour >= 9 && fresh && last !== wk) {
                    if (r.owner) lsSet('bs_tg_week', wk); else { g.week = wk; peopleChanged.push(r.c); }
                    var d0 = new Date(now), lines = weekLines(seen, ids, new Date(d0.getFullYear(), d0.getMonth(), d0.getDate()).getTime());
                    if (lines.length) send('🗓 На этой неделе выходят\n' + lines.slice(0, 20).join('\n'), null, null, null);
                }
            });
        });
        if (changed) lsSet('bs_tg_today', JSON.stringify(done.slice(0, 400)));
        if (peopleChanged.length) saveUsers(people, peopleChanged);
    }

    /* ---------- команды и кнопки бота (getUpdates, пока Lampa запущена) ---------- */

    var polling = false, LONG_POLL = 25;
    function poll() {
        if (polling || pair || !token() || !chat()) return;
        if (Date.now() < conflictUntil) return;
        if (newerOnline()) { if (isLeader) { isLeader = false; log('бота ведёт ТВ с новой Lampa', ''); } return; }
        var off = lsGet('bs_tg_offset');
        polling = true;
        if (off === null) {                                      // впервые — старые сообщения не разбираем
            return call('getUpdates', { offset: -1 }, function (u) {
                polling = false;
                lsSet('bs_tg_offset', String(u && u.length ? u[u.length - 1].update_id + 1 : 0));
            }, function () { polling = false; });
        }
        // длинный опрос: Telegram держит запрос до LONG_POLL с, пока не придёт нажатие или сообщение — отклик сразу
        call('getUpdates', { offset: off, timeout: LONG_POLL }, function (updates) {
            polling = false;
            if (!isLeader) { isLeader = true; leader = { id: tvId, at: Date.now() }; busHello(false); log('главный ТВ', tvName()); }
            (updates || []).forEach(function (u) {
                lsSet('bs_tg_offset', String(u.update_id + 1));
                var md = u.message && u.message.date;
                if (md && Date.now() / 1000 - md > STALE_UPDATE && u.message.chat) {     // пришло давно (ТВ был без бота) - не отвечаем позже
                    call('sendMessage', { chat_id: u.message.chat.id, text: '⏳ Этот запрос пришёл давно — напишите его ещё раз.' }, null, null);
                    return;
                }
                try { handle(u); } catch (e) { log('команда', e.message); }
            });
            setTimeout(poll, 200);                                   // сразу следующий
        }, function (e) {
            polling = false;
            if (/conflict/i.test(String(e))) {                       // бота опрашивает другой ТВ — он главный
                if (isLeader) log('главный теперь другой ТВ', '');
                isLeader = false;
                conflictUntil = Date.now() + (leaderStale() ? TAKEOVER_PAUSE : CONFLICT_PAUSE);
            }
        }, (LONG_POLL + 10) * 1000);
    }

    function reply(text, buttons) { send(text, null, null, null, buttons); }

    function wantList() {
        var list = [];
        if (isOwner()) { try { list = Lampa.Favorite.get({ type: 'wath' }) || []; } catch (e) {} }
        else list = (guest() || {}).want || [];
        if (!list.length) return reply('⭐ «Хочу посмотреть» пусто.\nНапишите название фильма или сериала и нажмите «⭐ Хочу посмотреть».');
        var rows = list.slice(0, 12).map(function (c) {
            var k = (c.tv !== undefined ? c.tv : c.name || c.number_of_seasons || c.first_air_date) ? 't' : 'm', name = c.title || c.name || c.original_title || c.original_name || '';
            return [{ text: '▶️ ' + name, callback_data: 'v:' + k + ':' + c.id }, { text: '📺', callback_data: 'o:' + k + ':' + c.id }, { text: '✖', callback_data: 'x:' + k + ':' + c.id }];
        });
        reply('⭐ Хочу посмотреть (' + list.length + ')\n▶️ — включить на ТВ, 📺 — открыть карточку, ✖ — убрать из списка', rows);
    }

    /* ---------- поиск по картинке (Gemini) ----------
     * Прислали фото, скриншот или постер: Lampa скачивает его из Telegram, спрашивает Gemini «что за фильм» и
     * отдаёт ответ обычному поиску (слайдер, «Хочу посмотреть», «Открыть на ТВ»). Ключ Gemini (AIza…) человек
     * присылает боту сообщением — хранится на этом ТВ, сообщение с ключом из чата удаляем. Картинка уходит в Google. */

    var GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models/';
    // если список моделей ключа получить не удалось
    var GEMINI_FALLBACK = ['gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'];
    var MODELS_TTL = 24 * 3600 * 1000;
    var GEMINI_ASK = 'Это скриншот, кадр или постер фильма, сериала или мультфильма. Определи, что это. ' +
        'Ответь только JSON: {"title": "название по-русски", "original_title": "оригинальное название", "year": год выхода числом или 0, ' +
        '"type": "movie" или "tv", "sure": true или false}. Если не узнал — title и original_title пустые.';
    /* Ключ Gemini: у каждого человека может быть свой (bs_gemini_keys, по чату; только на этом ТВ, в канал не уходит),
     * нет своего — ключ владельца. Лимиты моделей считаются по ключу. */
    function ownKey() { return isOwner() ? String(lsGet('bs_gemini_key') || '') : String(lsJson('bs_gemini_keys', {})[to()] || ''); }
    function geminiKey() { return (ownKey() || String(lsGet('bs_gemini_key') || '')).replace(/\s+/g, ''); }
    function setGeminiKey(key) {
        if (isOwner()) lsSet('bs_gemini_key', key);
        else { var all = lsJson('bs_gemini_keys', {}); all[to()] = key; lsSet('bs_gemini_keys', JSON.stringify(all)); }
        lsSet(skipKey(), '{}');
        lsSet('bs_gemini_models2', '');
    }
    function skipKey() { return 'bs_gemini_skip_' + fnv(geminiKey(), 2166136261); }
    /** Похоже на ключ, с чего бы он ни начинался (AIza…, AQ.…, завтра другое): одно «слово» 30–200 знаков, латиница
     *  с цифрами, без пробелов. Название фильма так не выглядит. Проверяет сам Gemini (geminiCheck). */
    function isGeminiKey(t) {
        t = String(t || '').replace(/^\s+|\s+$/g, '');
        return t.length >= 30 && t.length <= 200 && /^[\x21-\x7e]+$/.test(t) && /[A-Za-z]/.test(t) && /\d/.test(t) && !/^https?:/i.test(t) &&
            t.indexOf('/') < 0 && !/^\d{6,}:[\w-]{30,}$/.test(t);
    }

    /** Рабочий ли ключ: ok(true) — да, ok(false, why) — Gemini его не принял; нет связи — ok(null). */
    function geminiCheck(key, ok) {
        ok = keep(ok);
        var x = new XMLHttpRequest();
        try {
            x.open('GET', GEMINI + '?pageSize=1', true);
            x.setRequestHeader('x-goog-api-key', key);
            x.timeout = 20000;
            x.onload = function () {
                if (x.status === 200) return ok(true);
                var j = null;
                try { j = JSON.parse(x.responseText); } catch (e) {}
                var why = (j && j.error && j.error.message) || ('ответ ' + x.status);
                if (x.status === 429 || x.status >= 500) return ok(null);       // ключ, похоже, свой — Gemini занят
                ok(false, /location is not supported/i.test(why) ? 'Gemini недоступен в вашей стране' : why);
            };
            x.onerror = x.ontimeout = function () { ok(null); };
            x.send();
        } catch (e) { ok(null); }
    }

    /** Ответ Gemini -> {title, query} или null. */
    function fromGemini(j) {
        var text = '';
        try { text = j.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join(''); } catch (e) { return null; }
        var m = /\{[\s\S]*\}/.exec(text), r = null;
        try { r = JSON.parse(m ? m[0] : text); } catch (e) { return null; }
        if (!r) return null;
        var ru = String(r.title || '').replace(/^\s+|\s+$/g, ''), orig = String(r.original_title || '').replace(/^\s+|\s+$/g, '');
        if (!ru && !orig) return null;
        var year = (r.year | 0) > 1900 ? r.year | 0 : 0;
        var name = ru && orig && ru.toLowerCase() !== orig.toLowerCase() ? ru + ' / ' + orig : ru || orig;
        return { title: name + (year ? ' (' + year + ')' : ''), query: (orig || ru) + (year ? ' ' + year : ''), sure: r.sure !== false };
    }

    function bytesB64(buf) {
        var b = new Uint8Array(buf), s = '', CH = 0x8000;
        for (var i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH));
        return btoa(s);
    }

    function httpGetBin(url, ok, fail) {
        ok = keep(ok); fail = keep(fail);
        var x = new XMLHttpRequest();
        try {
            x.open('GET', url, true);
            x.responseType = 'arraybuffer';
            x.timeout = 30000;
            x.onload = function () { if (x.status === 200 && x.response) ok(x.response); else fail('ответ ' + x.status); };
            x.onerror = function () { fail('нет связи'); };
            x.ontimeout = function () { fail('долго нет ответа'); };
            x.send();
        } catch (e) { fail(e.message); }
    }

    /* Модели — какие есть у ключа (ListModels, раз в сутки): умеют generateContent и видят картинки. Порядок: Flash
     * Lite (самый большой бесплатный лимит, быстрая) → Flash; Pro не берём — бесплатно её почти нет. Внутри — новее
     * первыми, стабильные раньше preview.
     * Лимит у каждой модели свой: кончился на сегодня — модель пропускаем до сброса (полночь в Калифорнии),
     * «много запросов в минуту» — на минуту. Не вышло ни у одной — говорим по каждой, что с ней. */

    function rankModels(list) {
        var out = [];
        (list || []).forEach(function (m) {
            var id = String(m && m.name || '').replace(/^models\//, ''), how = (m && m.supportedGenerationMethods) || [];
            if (!/^gemini-/.test(id) || how.indexOf('generateContent') < 0) return;
            if (/embed|tts|image|live|audio|computer|robotics|aqa|learnlm|gemma/i.test(id)) return;   // не про картинки «что это»
            if (!/flash/.test(id)) return;                     // Pro и прочие: бесплатного лимита нет или он крошечный
            var tier = /lite/.test(id) ? 0 : 1;                // Lite — самый большой бесплатный лимит и быстрее всех
            var v = /latest/.test(id) ? 99 : parseFloat((/gemini-(\d+(?:\.\d+)?)/.exec(id) || [])[1] || '0');
            out.push({ id: id, tier: tier, pre: /preview|exp/.test(id) ? 1 : 0, v: v });
        });
        out.sort(function (a, b) { return a.tier - b.tier || a.pre - b.pre || b.v - a.v || (a.id < b.id ? -1 : 1); });
        return out.map(function (x) { return x.id; });
    }

    function geminiModels(cb, force) {
        cb = keep(cb);
        var key = geminiKey(), mark = fnv(key, 2166136261), c = lsJson('bs_gemini_models2', null);
        if (!force && c && c.k === mark && Date.now() - c.at < MODELS_TTL && c.list && c.list.length) return cb(c.list, true);
        var x = new XMLHttpRequest();
        var fallback = function () { cb(c && c.k === mark && c.list && c.list.length ? c.list : GEMINI_FALLBACK, false); };
        try {
            x.open('GET', GEMINI + '?pageSize=200', true);
            x.setRequestHeader('x-goog-api-key', key);
            x.timeout = 20000;
            x.onload = function () {
                var j = null;
                try { j = JSON.parse(x.responseText); } catch (e) {}
                var list = x.status === 200 ? rankModels(j && j.models) : [];
                if (!list.length) return fallback();
                lsSet('bs_gemini_models2', JSON.stringify({ k: mark, at: Date.now(), list: list }));
                cb(list, true);
            };
            x.onerror = x.ontimeout = fallback;
            x.send();
        } catch (e) { fallback(); }
    }

    /** Когда сбросится суточный лимит: полночь в Калифорнии (~8:00 UTC). */
    function quotaReset(now) {
        var d = new Date(now), r = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 8, 0);
        return r > now ? r : r + 86400000;
    }
    function hhmm(t) { var d = new Date(t); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }

    /** Ответ с ошибкой -> {kind, until}: day — лимит на сегодня, minute — много запросов в минуту, busy — перегружена,
     *  missing — модели нет у ключа, key — ключ не подошёл, region — страна, other. */
    function geminiError(status, text, now) {
        var j = null, why = '';
        try { j = JSON.parse(text); } catch (e) {}
        why = (j && j.error && j.error.message) || '';
        if (/location is not supported/i.test(why)) return { kind: 'region' };
        if (status === 400 && /API key|API_KEY/i.test(why + text) || status === 401 || status === 403 && /key/i.test(why)) return { kind: 'key', why: why };
        if (status === 429) {
            if (/PerDay|per day|daily/i.test(text)) return { kind: 'day', until: quotaReset(now) };
            var wait = /"retryDelay"\s*:\s*"(\d+)/.exec(text);
            return { kind: 'minute', until: now + Math.max(30, Math.min(300, wait ? +wait[1] : 60)) * 1000 };
        }
        if (status === 404) return { kind: 'missing' };
        if (status >= 500 || /high demand|overloaded|unavailable/i.test(why)) return { kind: 'busy' };
        return { kind: 'other', why: why || ('ответ ' + status) };
    }

    var KIND_TEXT = { day: 'лимит на сегодня закончился', minute: 'много запросов в минуту', busy: 'перегружена',
        missing: 'недоступна для ключа', other: 'ошибка' };

    /** Итог, когда ни одна модель не ответила. tried — [{id, kind, until, why}]. */
    function geminiSummary(tried, now) {
        if (!tried.length) return 'нет моделей Gemini, которые видят картинки';
        var kinds = tried.map(function (t) { return t.kind; }), all = function (k) { return kinds.every(function (x) { return x === k; }); };
        var head;
        if (all('day')) head = '🔋 Бесплатный лимит Gemini на сегодня закончился у всех моделей. Обновится в ' + hhmm(tried[0].until || quotaReset(now)) + '.';
        else if (kinds.indexOf('busy') >= 0 || kinds.indexOf('minute') >= 0) head = '⏳ Gemini сейчас занят — пришлите картинку ещё раз через минуту.';
        else head = '😔 Gemini не ответил.';
        return head + '\n' + tried.map(function (t) {
            return '• ' + t.id + ' — ' + (KIND_TEXT[t.kind] || t.kind) + (t.kind === 'day' && t.until ? ' (до ' + hhmm(t.until) + ')' : '') + (t.kind === 'other' && t.why ? ': ' + String(t.why).slice(0, 80) : '');
        }).join('\n');
    }

    function skipped(sk) {
        var m = lsJson(sk || skipKey(), {}), now = Date.now(), out = {};
        for (var k in m) if (m.hasOwnProperty(k) && m[k].until > now) out[k] = m[k];
        return out;
    }

    /** Спросить модели по очереди. ok(json, model); fail(text) — текст для человека. */
    function geminiAsk(b64, mime, hint, ok, fail) {
        aiRun([{ text: GEMINI_ASK + (hint ? '\nПодсказка от человека: ' + hint : '') }, { inline_data: { mime_type: mime, data: b64 } }], ok, fail);
    }

    /* ---------- несколько ИИ: Groq → Gemini → OpenRouter ----------
     * Ключ любого из них человек присылает боту — кто это, видно по началу: gsk_ — Groq (быстрый, ~1000 бесплатных
     * запросов в день), sk-or- — OpenRouter (бесплатные модели, 50 в день), остальное — Gemini. Ключи — как у Gemini:
     * у каждого человека свои, нет своего — ключ владельца. Бот спрашивает по очереди: не ответил один — следующий.
     * Groq и OpenRouter — API в стиле OpenAI (chat/completions); ответ приводим к виду Gemini — разбор тот же. */
    var OA = {
        groq: { name: 'Groq', base: 'https://api.groq.com/openai/v1/', site: 'console.groq.com/keys' },
        openrouter: { name: 'OpenRouter', base: 'https://openrouter.ai/api/v1/', site: 'openrouter.ai/keys' }
    };
    function keyKind(k) { k = String(k || ''); return /^gsk_/.test(k) ? 'groq' : /^sk-or-/.test(k) ? 'openrouter' : 'gemini'; }
    function aiKey(p) {
        if (p === 'gemini') return geminiKey();
        var own = isOwner() ? lsGet('bs_ai_' + p) : lsJson('bs_ai_' + p + '_u', {})[to()];
        return String(own || lsGet('bs_ai_' + p) || '').replace(/\s+/g, '');
    }
    function setAiKey(p, key) {
        if (p === 'gemini') return setGeminiKey(key);
        if (isOwner()) lsSet('bs_ai_' + p, key);
        else { var all = lsJson('bs_ai_' + p + '_u', {}); all[to()] = key; lsSet('bs_ai_' + p + '_u', JSON.stringify(all)); }
        lsSet('bs_ai_models_' + p, '');
    }
    /** Какие ИИ есть у этого человека — по порядку, с ключами (берём сейчас: ответы придут в другом контексте). */
    function aiProviders() {
        var out = [];
        ['groq', 'gemini', 'openrouter'].forEach(function (p) { var k = aiKey(p); if (k) out.push({ p: p, key: k }); });
        return out;
    }
    function aiReady() { return aiProviders().length > 0; }

    /** Модели Groq под задачу: картинка — только «зрячие», текст — сильные и быстрые первыми. */
    var GROQ_DEFAULT = ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'meta-llama/llama-4-scout-17b-16e-instruct', 'meta-llama/llama-4-maverick-17b-128e-instruct'];
    function groqPick(ids, img) {
        ids = (ids || []).filter(function (id) { return !/whisper|tts|guard|playai|orpheus|compound|distil|safeguard/i.test(id); });
        var vision = /scout|maverick|vision|\bvl\b|-vl|omni/i;
        if (img) return ids.filter(function (id) { return vision.test(id); }).slice(0, 2);
        var order = [/llama-3\.3-70b/, /gpt-oss-120b/, /llama-4-maverick/, /llama-4-scout/, /qwen/, /kimi/, /gpt-oss-20b/, /llama/], out = [];
        order.forEach(function (re) { ids.forEach(function (id) { if (re.test(id) && out.indexOf(id) < 0) out.push(id); }); });
        return out.slice(0, 3);
    }
    function oaModels(p, key, img, cb) {
        if (p === 'openrouter') return cb(['openrouter/free']);           // роутер бесплатных моделей, картинки понимает
        var mark = fnv(key, 2166136261), c = lsJson('bs_ai_models_' + p, null);
        if (c && c.k === mark && Date.now() - c.at < 86400000 && c.ids && c.ids.length) return cb(groqPick(c.ids, img));
        var x = new XMLHttpRequest(), done = function (ids) { cb(groqPick(ids, img)); };
        try {
            x.open('GET', OA[p].base + 'models', true);
            x.setRequestHeader('Authorization', 'Bearer ' + key);
            x.timeout = 10000;
            x.onload = function () {
                var j = null;
                try { j = JSON.parse(x.responseText); } catch (e) {}
                var ids = x.status === 200 && j && j.data ? j.data.map(function (m) { return m.id; }) : [];
                if (ids.length) lsSet('bs_ai_models_' + p, JSON.stringify({ k: mark, at: Date.now(), ids: ids }));
                done(ids.length ? ids : GROQ_DEFAULT);
            };
            x.onerror = x.ontimeout = function () { done(GROQ_DEFAULT); };
            x.send();
        } catch (e) { done(GROQ_DEFAULT); }
    }
    /** Части запроса Gemini (text / inline_data) -> сообщение OpenAI. */
    function oaContent(parts) {
        return parts.map(function (pt) {
            return pt.inline_data ? { type: 'image_url', image_url: { url: 'data:' + pt.inline_data.mime_type + ';base64,' + pt.inline_data.data } } : { type: 'text', text: pt.text };
        });
    }
    function oaRun(p, key, parts, ok, fail, onTry) {
        var img = parts.some(function (pt) { return !!pt.inline_data; });
        oaModels(p, key, img, function (models) {
            if (!models.length) return fail(img ? 'нет модели, которая видит картинки' : 'нет подходящей модели');
            var i = 0, deadline = Date.now() + 30000, last = '';
            (function next() {
                if (i >= models.length || Date.now() > deadline) return fail(last || 'не ответил');
                var id = models[i++], x = new XMLHttpRequest();
                if (onTry) try { onTry(OA[p].name + ' ' + id); } catch (e) {}
                try {
                    x.open('POST', OA[p].base + 'chat/completions', true);
                    x.setRequestHeader('Content-Type', 'application/json');
                    x.setRequestHeader('Authorization', 'Bearer ' + key);
                    if (p === 'openrouter') x.setRequestHeader('X-Title', 'Lampa TV');
                    x.timeout = Math.max(5000, Math.min(20000, deadline - Date.now()));
                    x.onload = function () {
                        var j = null;
                        try { j = JSON.parse(x.responseText); } catch (e) {}
                        var text = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
                        if (x.status === 200 && text) return ok({ candidates: [{ content: { parts: [{ text: String(text) }] } }] }, OA[p].name + ' ' + id);
                        var why = (j && j.error && (j.error.message || j.error)) || ('ответ ' + x.status);
                        log('ии ' + p, id + ': ' + x.status);
                        if (x.status === 401 || x.status === 403) return fail('ключ не подошёл (' + String(why).slice(0, 100) + ')');
                        last = x.status === 429 ? 'лимит на сегодня или в минуту' : String(why).slice(0, 120);
                        next();
                    };
                    x.onerror = function () { fail('нет связи'); };
                    x.ontimeout = function () { last = 'долго не отвечает'; next(); };
                    x.send(JSON.stringify({ model: id, messages: [{ role: 'user', content: oaContent(parts) }], temperature: 0, max_tokens: 700 }));
                } catch (e) { fail(e.message); }
            })();
        });
    }

    /** Спросить ИИ: по очереди все, у кого есть ключ. ok(ответ в виде Gemini, «кто ответил»), fail(текст для человека). */
    function aiRun(parts, ok, fail, onTry) {
        ok = keep(ok); fail = keep(fail); onTry = keep(onTry);
        var list = aiProviders(), errs = [], i = 0;
        if (!list.length) return fail('нет ключа ИИ — «🖼 По картинке» подскажет, где взять');
        (function next() {
            if (i >= list.length) return fail(errs.join('\n'));
            var it = list[i++];
            var f = keep(function (why) { errs.push((it.p === 'gemini' ? 'Gemini' : OA[it.p].name) + ': ' + String(why).replace(/^[^\wА-Яа-яЁё]+/, '').split('\n')[0].slice(0, 160)); next(); });
            if (it.p === 'gemini') return geminiRun(parts, ok, f, onTry);
            oaRun(it.p, it.key, parts, ok, f, onTry);
        })();
    }
    /** Ключ Groq/OpenRouter рабочий? ok(true) / ok(false, почему) / ok(null) — проверить не удалось. */
    function oaCheck(p, key, ok) {
        ok = keep(ok);
        var x = new XMLHttpRequest();
        try {
            x.open('GET', OA[p].base + (p === 'openrouter' ? 'key' : 'models'), true);
            x.setRequestHeader('Authorization', 'Bearer ' + key);
            x.timeout = 15000;
            x.onload = function () { if (x.status === 200) return ok(true); if (x.status === 401 || x.status === 403) return ok(false, 'ответ ' + x.status); ok(null); };
            x.onerror = x.ontimeout = function () { ok(null); };
            x.send();
        } catch (e) { ok(null); }
    }

    /* ИИ в поиске по тексту: описали словами («фильм где мужик застрял на Марсе») или по названию ничего не нашлось —
     * Gemini говорит, что это, и ищем уже по названию. Только если ключ Gemini есть. */
    var GEMINI_TEXT = 'Человек ищет фильм, сериал или мультфильм и написал: «{q}». Это может быть название с ошибками, ' +
        'описание сюжета, тема или жанр, актёр, фраза из фильма. Ответь только JSON: {"sure": true или false, "items": [{"title": ' +
        '"название по-русски", "original_title": "оригинальное название", "year": год выхода числом или 0, "type": "movie" или "tv"}]}. ' +
        'Конкретный фильм — один элемент и sure: true. Описание подходит ко многим (тема, жанр) — до 8 самых известных, sure: false. ' +
        'Не понятно — items пустой.';
    /** Ответ ИИ на текст: [{title, query}] (до 8) и sure. */
    function fromGeminiList(j) {
        var text = '';
        try { text = j.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join(''); } catch (e) { return null; }
        var m = /\{[\s\S]*\}/.exec(text), r = null;
        try { r = JSON.parse(m ? m[0] : text); } catch (e) { return null; }
        if (!r) return null;
        var raw = r.items && r.items.length ? r.items : (r.title || r.original_title ? [r] : []), out = [];
        raw.slice(0, 8).forEach(function (it) {
            var one = fromGemini({ candidates: [{ content: { parts: [{ text: JSON.stringify(it) }] } }] });
            if (one) out.push(one);
        });
        return out.length ? { items: out, sure: r.sure !== false && out.length === 1 } : null;
    }
    /** cb(результат или null, почему). Сторож: что бы ни случилось, ответ не позже 50 с. */
    function aiSearch(q, cb, onTry) {
        var done = false, end = keep(function (r, why) { if (done) return; done = true; clearTimeout(guard); cb(r, why); });
        var guard = setTimeout(function () { end(null, '⏳ Gemini долго не отвечает — попробуйте ещё раз через минуту.'); }, GEMINI_TOTAL + 5000);
        aiRun([{ text: GEMINI_TEXT.replace('{q}', String(q).slice(0, 300)) }], function (j) { end(fromGeminiList(j), ''); }, function (why) { end(null, why); }, onTry);
    }

    /** Фильмы, которые назвал ИИ, — найти в TMDB (по первому совпадению на каждый) и показать слайдером. */
    function aiSlides(items, status, query) {
        var results = [], left = items.length, have = {};
        items.forEach(function (it, n) {
            searchSource(it.query).fetch(1, function (list) {
                results[n] = list && list[0];
                if (--left) return;
                var all = results.filter(function (r) { if (!r || have[r.media_type + r.id]) return false; have[r.media_type + r.id] = 1; return true; });
                if (!all.length) return status('😔 ИИ предложил: ' + items.map(function (x) { return x.title; }).join(', ') + ' — но в базе их не нашлось.');
                status('🤖 Под «' + query + '» подходят: ' + items.map(function (x) { return x.title; }).join(', '));
                showSlides({ list: all, src: { fetch: function (p, cb) { cb([], 0); } }, page: 1, pages: 1 });
            });
        });
    }
    /** Спросить ИИ и показать: один фильм — обычный поиск по названию, несколько — слайдер из них. */
    function aiFlow(query, status) {
        status('🤖 Спрашиваю ИИ…');
        aiSearch(query, function (r, why) {
            if (!r) return status('😔 По запросу «' + query + '» ничего не нашлось' + (why ? ' — ' + String(why).replace(/^[^\wА-Яа-яЁё]+/, '').split('\n')[0].slice(0, 160) : ', и ИИ не понял') + '.\nПопробуйте иначе или пришлите скриншот.');
            if (r.items.length === 1) { status((r.sure ? '🤖 Похоже, вы ищете: ' : '🤖 Возможно, это: ') + r.items[0].title); return botSearch(r.items[0].query, true); }
            aiSlides(r.items, status, query);
        }, function (id) { status('🤖 Спрашиваю ИИ (' + id + ')…'); });
    }
    /** Описание, а не название: 5+ слов, без года и студии. */
    function isDescription(q) {
        var w = String(q || '').replace(/^\s+|\s+$/g, '').split(/\s+/);
        if (w.length < 5) return false;
        var p = parseQuery(q);
        return !p.year && !p.studio;
    }

    /* Сроки: на модель до 20 с, на весь запрос — 45 с, потом честное «долго не отвечает». Flash-моделям — без долгого
     * «обдумывания» (thinkingBudget 0): ответ за 1–3 с вместо 10–30; модель такое не принимает — спросить её без этого. */
    var GEMINI_MODEL_WAIT = 20000, GEMINI_TOTAL = 45000;
    function geminiBody(parts, id, plain) {
        var gc = { temperature: 0, responseMimeType: 'application/json' };
        if (!plain && /flash/.test(id) && !/gemini-(1\.|2\.0)/.test(id)) gc.thinkingConfig = { thinkingBudget: 0 };
        return JSON.stringify({ contents: [{ parts: parts }], generationConfig: gc });
    }

    /** onTry(id) — какую модель спрашиваем сейчас (для «Спрашиваю ИИ…»). */
    function geminiRun(parts, ok, fail, onTry) {
        ok = keep(ok); fail = keep(fail); onTry = keep(onTry);
        // чей ключ — решаем сразу: ответы моделей приходят позже, когда «кто спрашивал» уже другой
        var key = geminiKey(), sk = skipKey(), deadline = Date.now() + GEMINI_TOTAL, plain = {};
        geminiModels(function (models) {
            var skip = skipped(sk), tried = [], i = 0;
            models.forEach(function (id) { if (skip[id]) tried.push({ id: id, kind: skip[id].kind, until: skip[id].until }); });
            var queue = models.filter(function (id) { return !skip[id]; });
            (function next() {
                if (i >= queue.length || i >= 6) return fail(geminiSummary(tried, Date.now()));
                if (Date.now() > deadline - 3000) return fail('⏳ Gemini долго не отвечает — попробуйте ещё раз через минуту.');
                var id = queue[i++], x = new XMLHttpRequest();
                if (onTry) try { onTry(id); } catch (e) {}
                try {
                    x.open('POST', GEMINI + id + ':generateContent', true);
                    x.setRequestHeader('Content-Type', 'application/json');
                    x.setRequestHeader('x-goog-api-key', key);              // ключ — заголовком, не в адресе
                    x.timeout = Math.max(5000, Math.min(GEMINI_MODEL_WAIT, deadline - Date.now()));
                    x.onload = function () {
                        if (x.status === 200) {
                            var j = null;
                            try { j = JSON.parse(x.responseText); } catch (e) {}
                            lsSet('bs_gemini_last', id);
                            return ok(j, id);
                        }
                        if (x.status === 400 && !plain[id] && /thinking/i.test(x.responseText)) { plain[id] = 1; i--; return next(); }
                        var er = geminiError(x.status, x.responseText, Date.now());
                        log('gemini', id + ': ' + x.status + ' ' + er.kind);
                        if (er.kind === 'key') return fail('❌ Ключ Gemini не подошёл' + (er.why ? ': ' + String(er.why).slice(0, 160) : '') + ' — пришлите новый (aistudio.google.com/apikey).');
                        if (er.kind === 'region') return fail('🌍 Gemini недоступен в вашей стране.');
                        if (er.until) { var sm = lsJson(sk, {}); sm[id] = { kind: er.kind, until: er.until }; lsSet(sk, JSON.stringify(sm)); }
                        if (er.kind === 'missing') lsSet('bs_gemini_models2', '');       // список устарел — перечитать в следующий раз
                        tried.push({ id: id, kind: er.kind, until: er.until, why: er.why });
                        next();
                    };
                    x.onerror = function () { fail('📡 Нет связи с Gemini — проверьте интернет на ТВ.'); };
                    x.ontimeout = function () { tried.push({ id: id, kind: 'busy' }); next(); };
                    x.send(geminiBody(parts, id, plain[id]));
                } catch (e) { fail(e.message); }
            })();
        });
    }

    /** «🖼 По картинке»: что с Gemini сейчас — модели, лимиты, кто отвечал последним. */
    function aiStatus() {
        var list = aiProviders(), names = list.map(function (x) { return x.p === 'gemini' ? '🔷 Gemini' : x.p === 'groq' ? '⚡ Groq' : '🌐 OpenRouter'; });
        var head = '🖼 Пришлите скриншот, кадр или постер — узнаю фильм.\n\n🤖 ИИ по очереди: ' + names.join(' → ') +
            (list.length < 3 ? '\nЕщё ключ — ещё один ИИ про запас (Groq: console.groq.com/keys, OpenRouter: openrouter.ai/keys).' : '');
        if (!aiKey('gemini')) return reply(head + '\n\nНовый ключ — просто пришлите его сообщением.');
        reply(head);
        geminiStatus();
    }
    function geminiStatus() {
        geminiModels(function (models, fresh) {
            var skip = skipped(), last = lsGet('bs_gemini_last') || '';
            var free = models.filter(function (id) { return !skip[id]; });
            var lines = [];
            lines.push(fresh ? '🔷 Модели Gemini для вашего ключа: ' + models.length : '🤖 Список моделей сейчас не получить — пробую известные.');
            if (free.length) lines.push('✅ Доступны: ' + free.slice(0, 4).join(', ') + (free.length > 4 ? ' и ещё ' + (free.length - 4) : ''));
            models.forEach(function (id) { if (skip[id]) lines.push('⛔ ' + id + ' — ' + KIND_TEXT[skip[id].kind] + ' (до ' + hhmm(skip[id].until) + ')'); });
            if (!free.length) lines.push('🔋 Сейчас ни одна модель не доступна — лимит закончился.');
            if (last) lines.push('Последней отвечала: ' + last);
            lines.push('', 'Новый ключ — просто пришлите его сообщением.');
            reply(lines.join('\n'));
        }, true);
    }

    function geminiHow() {
        return '🤖 Поиск по картинке и по описанию работает через ИИ — нужен бесплатный ключ (можно несколько, бот спросит по очереди):\n' +
            '⚡ Groq — самый быстрый: console.groq.com/keys → «Create API Key» (ключ начинается с gsk_)\n' +
            '🔷 Gemini (Google): aistudio.google.com/apikey → «Create API key» (AQ. или AIza)\n' +
            '🌐 OpenRouter: openrouter.ai/keys → «Create» (sk-or-), бесплатно 50 запросов в день\n\n' +
            'Пришлите ключ сюда сообщением — сохраню на ТВ и удалю из чата.' + (isOwner() ? '' : ' Ключ будет ваш: лимит — только ваш.');
    }

    function photoSearch(msg) {
        if (!aiReady()) return reply(geminiHow());
        var file = null, mime = 'image/jpeg';
        if (msg.photo && msg.photo.length) {
            file = msg.photo[msg.photo.length - 1];
            for (var i = 0; i < msg.photo.length; i++) if (msg.photo[i].width >= 1000) { file = msg.photo[i]; break; }   // хватит и 1280
        } else if (msg.document && /^image\//.test(msg.document.mime_type || '')) { file = msg.document; mime = msg.document.mime_type; }
        if (!file) return;
        if (file.file_size > 15 * 1024 * 1024) return reply('Картинка слишком большая — пришлите сжатым фото.');
        call('sendChatAction', { chat_id: to(), action: 'typing' }, null, null);
        var statusId = 0, status = function (t) {
            if (statusId) call('editMessageText', { chat_id: to(), message_id: statusId, text: t }, null, null);
            else reply(t);
        };
        call('sendMessage', { chat_id: to(), text: '🖼 Узнаю по картинке…' }, function (m) { statusId = m && m.message_id || 0; }, null);
        var fail = function (why) { log('картинка', why); status(/^[^\wА-Яа-яЁё]/.test(why) ? why : '😔 Не получилось узнать: ' + why + '.'); };
        call('getFile', { file_id: file.file_id }, function (f) {
            if (!f || !f.file_path) return fail('Telegram не отдал картинку');
            httpGetBin('https://api.telegram.org/file/bot' + token() + '/' + f.file_path, function (buf) {
                geminiAsk(bytesB64(buf), mime, String(msg.caption || '').slice(0, 200), function (j, model) {
                    var r = fromGemini(j);
                    if (!r) return status('🤔 Не узнал, что это за фильм (' + model + '). Напишите название — найду.');
                    status((r.sure ? '🎬 Похоже на: ' : '🤔 Возможно, это: ') + r.title + '\n🤖 ' + model);
                    log('картинка', r.query);
                    botSearch(r.query);
                }, fail);
            }, function (e) { fail('не скачалась из Telegram (' + e + ')'); });
        }, function (e) { fail(e); });
    }

    var renameFor = null, renameWait = null;
    var KB_WORDS = ['набрать на тв', 'найти', 'хочу посмотреть', 'мои подписки', 'на этой неделе', 'по картинке', 'помощь', 'люди', 'меню', 'профиль', 'телевизоры'];

    /** Чей это апдейт; чужим — только подключение по приглашению. */
    function chatOf(u) { var m = u.callback_query ? u.callback_query.message : u.message; return m && m.chat ? String(m.chat.id) : ''; }
    function handle(u) {
        var c = chatOf(u);
        if (!c) return;
        if (!allowed(c)) return stranger(u, c);
        as(c, function () { handleIn(u); });
    }

    function handleIn(u) {
        if (u.callback_query) {
            var q = u.callback_query, sm = /^([wosxv]):([mt]):(\d+)$/.exec(q.data || ''), m = /^([ul]):(\d+)$/.exec(q.data || '');
            if (!q.message) return;
            var mn = /^mn:(\w+)$/.exec(q.data || '');
            if (mn) { call('answerCallbackQuery', { callback_query_id: q.id }, null, null); return menuAction(mn[1]); }
            var ku = /^ku:(-?\d+)$/.exec(q.data || '');
            var okk = /^ok:(-?\d+)$/.exec(q.data || '');
            if (okk) {
                call('answerCallbackQuery', { callback_query_id: q.id }, null, null);
                if (!isOwner()) return;
                var back = users(), was = back[okk[1]];
                if (!was || !(was.banned || was.pending)) return reply('Уже подключён.');
                var first = !!was.pending;
                back[okk[1]] = { name: was.name, at: Date.now(), want: [], subs: [], muted: [], later: [] };
                saveUsers(back, [okk[1]]);
                as(okk[1], function () { sendKb((first ? '✅ Владелец разрешил — вы подключены к Lampa.\nУ вас свои «Хочу посмотреть» и подписки — другие их не видят.' : '✅ Владелец разрешил — вы снова подключены к Lampa.') + '\n\n' + helpText()); });
                return reply('✅ ' + was.name + (first ? ' подключён.' : ' снова подключён.'));
            }
            if (ku) {
                call('answerCallbackQuery', { callback_query_id: q.id }, null, null);
                if (!isOwner()) return;
                var people = users(), gone = people[ku[1]];
                if (gone && gone.pending) {
                    people[ku[1]] = { name: gone.name, banned: true, at: Date.now() };
                    saveUsers(people, [ku[1]]);
                    as(ku[1], function () { reply('Владелец не разрешил подключение.'); });
                    return reply('🚫 Запрос ' + gone.name + ' отклонён.');
                }
                if (!active(gone)) return reply('Уже отключён.');
                people[ku[1]] = { name: gone.name, banned: true, at: Date.now() };   // запомнить: по старому QR не вернётся
                saveUsers(people, [ku[1]]);
                as(ku[1], function () { reply('Вас отключили от Lampa. Подключиться снова — QR в поиске Lampa на ТВ.'); });
                return reply('🚫 ' + gone.name + ' отключён.');
            }
            var tp = /^tp:(\w+)$/.exec(q.data || '');
            if (tp) {
                call('answerCallbackQuery', { callback_query_id: q.id }, null, null);
                if (!isOwner() && !guestPlay()) return reply('Владелец запретил гостям управлять ТВ.');
                return typeWait(tp[1]);
            }
            var pg = /^p:(\d+)$/.exec(q.data || ''), dv = /^([dD]):(\w+):([mt]):(\d+)$/.exec(q.data || '');
            if (pg) return slideTo(q, +pg[1]);
            if (dv && !isOwner() && !guestPlay()) return call('answerCallbackQuery', { callback_query_id: q.id, text: 'Владелец запретил гостям включать видео на ТВ' }, null, null);
            if (dv) return openOn(q, dv[2], dv[3], dv[4], dv[1] === 'D');
            var cf = /^cfg:(\w+)$/.exec(q.data || '');
            if (cf) {
                call('answerCallbackQuery', { callback_query_id: q.id }, null, null);
                if (!isOwner()) return;
                if (cf[1] === 'inv') { inviteReset(); return reply('🔄 Приглашение сменено: старые QR и ссылки больше не подключают. Уже подключённые остаются.'); }
                if (cf[1] === 'ap') lsSet('bs_tg_approve', String(!needApprove()));
                if (cf[1] === 'play') lsSet('bs_tg_guest_play', String(!guestPlay()));
                cfgSend();
                return peopleList();
            }
            if (q.data === 'n') return call('answerCallbackQuery', { callback_query_id: q.id }, null, null);
            var rn = /^rn(?::(\w+))?$/.exec(q.data || '');
            if (rn) {
                call('answerCallbackQuery', { callback_query_id: q.id }, null, null);
                if (!isOwner()) return reply('Переименовать ТВ может владелец бота.');
                var tvs = allTvs();
                if (!rn[1] && tvs.length > 1) return reply('✏️ Какой ТВ переименовать?', tvs.map(function (d) { return [{ text: d.text, callback_data: 'rn:' + d.id }]; }));
                var who = tvs.filter(function (d) { return d.id === (rn[1] || tvId); })[0];
                if (!who) return reply('Этот ТВ сейчас не на связи.');
                renameFor = { id: who.id, at: Date.now(), chat: to() };
                return reply('✏️ Напишите новое название для «' + who.text.replace(/^📺 /, '') + '» — например «Зал» или «Спальня».');
            }
            if (sm) return searchAction(q, sm[1], sm[2], sm[3]);
            if (!m) return;
            var id = m[2], name = (loadSeen()[id] || {}).name || '';
            if (!isOwner()) {
                updGuest(function (g) {
                    if (m[1] === 'u') {
                        g.subs = (g.subs || []).filter(function (c) { return c.id != id; });
                        if ((g.muted || []).indexOf(id) < 0) g.muted = [id].concat(g.muted || []).slice(0, 500);
                    } else {
                        var d0 = new Date();
                        g.later = (g.later || []).filter(function (x) { return x.id !== id; }).concat([{ id: id, name: name, at: new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + 1, 9, 0).getTime() }]).slice(-50);
                    }
                });
                return call('answerCallbackQuery', { callback_query_id: q.id, text: m[1] === 'u' ? 'Больше не пишу про ' + (name || 'этот сериал') : 'Напомню завтра в 9:00' }, null, null);
            }
            if (m[1] === 'u') {
                setSubAll({ id: id }, false);
                var mu = mutedList(); if (mu.indexOf(id) < 0) mu.unshift(id);
                lsSet('bs_tg_muted', JSON.stringify(mu.slice(0, 500)));
                call('answerCallbackQuery', { callback_query_id: q.id, text: 'Больше не пишу про ' + (name || 'этот сериал') }, null, null);
            } else {
                var d = new Date(), at = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 9, 0).getTime();
                var later = lsJson('bs_tg_later', []).filter(function (x) { return x.id !== id; });
                later.push({ id: id, name: name, at: at });
                lsSet('bs_tg_later', JSON.stringify(later.slice(-50)));
                call('answerCallbackQuery', { callback_query_id: q.id, text: 'Напомню завтра в 9:00' }, null, null);
            }
            return;
        }
        var msg = u.message;
        if (!msg) return;
        if (msg.photo || (msg.document && /^image\//.test(msg.document.mime_type || ''))) return photoSearch(msg);
        if (typeof msg.text !== 'string') return;
        if (renameFor && renameFor.chat === to() && Date.now() - renameFor.at < 5 * 60000 && !/^\//.test(msg.text) && KB_WORDS.indexOf(msg.text.replace(/^[^\wА-Яа-яЁё]+/, '').toLowerCase()) < 0) {
            var title = msg.text.replace(/^\s+|\s+$/g, '').slice(0, 40), target = renameFor.id;
            renameFor = null;
            if (!title) return reply('Название пустое — нажмите «✏️ Переименовать ТВ» ещё раз.');
            if (target === tvId) { lsSet('bs_tv_name', title); busHello(false); refreshSettings(); }
            if (target === tvId) return reply('✅ ТВ теперь называется «' + title + '».');
            // другой ТВ: подтвердит своим «hello» с новым именем; молчит — значит, на нём старая Lampa или он выключен
            if (renameWait) clearTimeout(renameWait.timer);
            var oldName = ((devices[target] || {}).name) || 'ТВ';
            renameWait = { to: target, title: title, timer: setTimeout(keep(function () {
                renameWait = null;
                reply('⚠️ «' + oldName + '» не ответил. Похоже, на нём старая версия Lampa или он выключен — обновите Lampa на нём и переименуйте снова.');
            }), 15000) };
            busSend({ t: 'rename', to: target, title: title });
            return;
        }
        renameFor = null;
        // «⌨️ Набрать на ТВ»: следующее сообщение (не команда и не кнопка) — в поиск Lampa
        if (typeFor && typeFor.chat === to() && Date.now() - typeFor.at < TYPE_WAIT && !/^\//.test(msg.text) &&
            KB_WORDS.indexOf(msg.text.replace(/^[^\wА-Яа-яЁё]+/, '').toLowerCase()) < 0) return typeSend(msg.text);
        if (typeFor && typeFor.chat === to()) typeFor = null;
        var jc = isOwner() && joinFrom(msg.text);
        if (jc) return joinSend(jc);
        if (isGeminiKey(msg.text)) {                                         // похоже на ключ — сразу из чата, в поиск не отдаём (у каждого свой)
            var key = msg.text.replace(/\s+/g, ''), kind = keyKind(key), kname = kind === 'gemini' ? 'Gemini' : OA[kind].name;
            call('deleteMessage', { chat_id: to(), message_id: msg.message_id }, null, null);
            return (kind === 'gemini' ? geminiCheck : function (k, cb) { oaCheck(kind, k, cb); })(key, function (good, why) {
                if (good === false) return reply('❌ Похоже на ключ ' + kname + ', но он не принят: ' + why + '\nСообщение удалено. Проверьте ключ и пришлите ещё раз.');
                setAiKey(kind, key);
                reply('✅ ' + (isOwner() ? 'Ключ' : 'Ваш ключ') + ' ' + kname + ' сохранён на ТВ «' + tvName() + '», сообщение с ним удалено.' +
                    (good ? '' : '\n(Проверить сейчас не удалось — проверю на первой картинке.)') + '\nТеперь пришлите скриншот или постер 🖼');
            });
        }
        var t = msg.text.replace(/^\s+|\s+$/g, ''), cmd = /^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/.exec(t);
        var c = cmd ? cmd[1].toLowerCase() : '', arg = cmd ? cmd[2] : t, plain = t.replace(/^[^\wА-Яа-яЁё]+/, '').toLowerCase();
        if (c === 'start') { sendKb('👋 Это бот вашей Lampa на ТВ.\nНапишите название фильма или сериала — или выберите раздел 👇'); return setTimeout(keep(sendMenu), 400); }
        if (c === 'help' || plain === 'помощь') return sendKb(helpText());
        if (c === 'menu' || plain === 'меню') return sendMenu();
        if (c === 'profile' || plain === 'профиль') return menuAction('profile');
        if (c === 'tvs' || plain === 'телевизоры') return tvsInfo();
        if (plain === 'найти') return reply('Напишите название фильма или сериала 👇');
        if (c === 'type' || plain === 'набрать на тв') return typeStart();
        if (c === 'want' || plain === 'хочу посмотреть') return wantList();
        if (plain === 'люди') return peopleList();
        if (plain === 'по картинке') return aiReady() ? aiStatus() : reply(geminiHow());
        if (c === 'week' || plain === 'на этой неделе') return reply(weekText(true));
        if (c === 'subs' || plain === 'мои подписки' || plain === 'подписки') return subsList();
        if (c && c !== 'find') return sendMenu();
        var query = (c === 'find' ? arg : t).replace(/^найти\s+/i, '').replace(/^\s+|\s+$/g, '');
        if (!query) return reply('Напишите название фильма или сериала 👇');
        botSearch(query);
    }

    /** «🔔 Мои подписки»: список с датами следующих серий и кнопками «Отписаться». */
    function subsList() {
        var l = isOwner() ? subs() : ((guest() || {}).subs || []), seen = loadSeen();
        if (!l.length) return reply('🔔 Подписок нет.\nНапишите название сериала и нажмите «🔔 Подписаться» — или кнопкой на карточке в Lampa.');
        var lines = l.slice(0, 30).map(function (s) {
            var r = seen[s.id] || {}, n = r.next;
            return '• ' + (s.name || r.name || '') + (n && n.d ? ' — ' + n.s + '×' + n.e + ', ' + n.d.split('-').reverse().slice(0, 2).join('.') : '');
        });
        return reply('🔔 Ваши подписки:\n' + lines.join('\n') + '\n\nНажмите, чтобы отписаться:', l.slice(0, 8).map(function (s) { return [{ text: '🔕 ' + (s.name || s.id), callback_data: 'u:' + s.id }]; }));
    }

    /* ---------- подписка в плеере ---------- */

    function subs() { try { var l = JSON.parse(lsGet('bs_subs') || '[]'); return Object.prototype.toString.call(l) === '[object Array]' ? l : []; } catch (e) { return []; } }
    function subscribed(id) { var g = guest(); return (g ? g.subs || [] : subs()).some(function (c) { return c && c.id == id; }); }
    function setSub(card, state, info) {
        info = info || tvInfo;
        var l = subs().filter(function (c) { return c && c.id != card.id; });
        if (state) l.unshift({ id: card.id, name: card.name || card.title || '', original_name: card.original_name || '', poster_path: card.poster_path || '', source: card.source || 'tmdb', first_air_date: card.first_air_date || '' });
        lsSet('bs_subs', JSON.stringify(l.slice(0, 200)));
        if (state) {                                   // текущая серия — уже известная, сообщать будем о следующих
            var all = loadSeen();
            if (!all[card.id] && info && info.id == card.id && info.last) all[card.id] = { s: info.last.season_number | 0, e: info.last.episode_number | 0, at: Date.now() };
            var mu = mutedList().filter(function (x) { return x !== String(card.id); });   // подписался снова — снова пишем
            lsSet('bs_tg_muted', JSON.stringify(mu));
            lsSet('bs_tg_seen', JSON.stringify(trimSeen(all)));
        }
    }

    var MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    /** «Следующая серия: 12×17 — через 3 дня (16 окт)»; next — next_episode_to_air TMDB, today — полночь сегодня. */
    function nextText(next, today) {
        if (!next || !next.air_date) return 'Дата следующей серии пока не объявлена';
        var p = next.air_date.split('-'), air = new Date(+p[0], +p[1] - 1, +p[2]).getTime();
        var days = Math.round((air - today) / 86400000), when;
        if (days <= 0) when = 'сегодня';
        else if (days === 1) when = 'завтра';
        else {
            var n = days % 10, nn = days % 100;
            when = 'через ' + days + ' ' + (n === 1 && nn !== 11 ? 'день' : n >= 2 && n <= 4 && (nn < 12 || nn > 14) ? 'дня' : 'дней');
        }
        return 'Следующая серия: ' + next.season_number + '×' + next.episode_number + ' — ' + when + ' (' + (+p[2]) + ' ' + MONTHS[+p[1] - 1] + ')';
    }
    /** Последняя ли вышедшая серия смотрится. */
    function isLatest(s, e, last) { return !!last && (s | 0) === (last.season_number | 0) && (e | 0) === (last.episode_number | 0); }

    var tvInfo = null, tvCache = {};
    function playerCard(data) {
        var c = (data && (data.card || data.movie)) || null;
        if (!c) { try { var a = Lampa.Activity.active() || {}; c = a.movie || a.card || null; } catch (e) {} }
        return c && c.id > 0 && (c.name || c.original_name || c.number_of_seasons || c.first_air_date) ? c : null;
    }
    function today() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }

    /** Подписался / отписался — подтверждение в Telegram (если бот подключён). */
    function subNotify(card, on, info) {
        info = info || tvInfo;
        if (!token() || !chat()) return;
        var name = card.name || card.title || card.original_name || '';
        if (!on) return send('🔕 Подписка отменена: ' + name, null, null, function (e) { log('не отправлено', e); });
        var text = '🔔 Вы подписались: ' + name + '\n' + nextText(info && info.id == card.id ? info.next : null, today()) + '\nСообщу, когда выйдет новая серия.';
        var poster = card.poster_path ? 'https://image.tmdb.org/t/p/w500' + card.poster_path : null;
        send(text, poster, null, function (e) { log('не отправлено', e); });
    }

    /** Данные о сериале из TMDB (на час — из памяти): {id, last, next, json}. */
    function tvLoad(id, cb) {
        var c = tvCache[id];
        if (c && Date.now() - c.at < 3600000) return cb(c);
        new Lampa.Reguest().silent(Lampa.TMDB.api('tv/' + id + '?api_key=' + Lampa.TMDB.key() + '&language=ru'), function (json) {
            if (!json || !json.id) return cb(null);
            tvCache[id] = { id: json.id, last: json.last_episode_to_air, next: json.next_episode_to_air, ongoing: ongoing(json), json: json, at: Date.now() };
            cb(tvCache[id]);
        }, function () { cb(null); });
    }
    /** Подписаться / отписаться (карточка, бот): TMDB — дата следующей серии, подтверждение в Telegram. */
    function toggleSub(card, done) {
        var now = !subscribed(card.id);
        var finish = function (info) {
            setSubAll(card, now, info);
            subNotify(card, now, info);
            noty(now ? (chat() ? 'Подписка: о новой серии придёт сообщение в Telegram' : 'Подписка сохранена. Уведомления — в Telegram: Настройки → Telegram') : 'Подписка отменена', 3500);
            if (done) done(now);
        };
        if (!now) return finish(null);
        tvLoad(card.id, finish);
    }

    /* Родная кнопка «Подписаться» на карточке сериала — через нашего бота (у CUB это платная подписка). */
    /* «Подписаться» на самом ТВ (карточка, плеер): в боте несколько людей — спросить, кому. У каждого свои подписки и
     * уведомления; выбрали владельца — как раньше (его список — список Lampa на ТВ). */
    function ownerName() { return lsGet('bs_tg_owner') || 'Владелец бота'; }
    function people() { var u = users(); return Object.keys(u).filter(function (k) { return active(u[k]); }).map(function (k) { return { who: k, name: u[k].name }; }); }
    function tvSubscribe(card, ownerToggle, cancel) {
        var list = people();
        if (!chat() || !list.length) return ownerToggle();
        var ctrl = '';
        try { ctrl = Lampa.Controller.enabled().name; } catch (e) {}
        var back = function () { try { if (ctrl) Lampa.Controller.toggle(ctrl); } catch (e) {} };
        var items = [{ title: esc(ownerName()), who: '' }].concat(list.map(function (p) { return { title: esc(p.name), who: p.who }; }));
        items.forEach(function (it) { as(it.who, function () { if (subscribed(card.id)) it.subtitle = 'подписан(а) — выберите, чтобы отписать'; }); });
        try {
            Lampa.Select.show({
                title: esc('Кому подписка на «' + (card.name || card.title || card.original_name || '') + '»?'), items: items,
                onSelect: function (a) { back(); if (!a.who) return ownerToggle(); guestToggleTv(a.who, card); if (cancel) cancel(); },
                onBack: function () { back(); if (cancel) cancel(); }
            });
        } catch (e) { log('кому подписка', e.message); ownerToggle(); }
    }
    function guestToggleTv(who, card) {
        as(who, function () {
            var g = guest();
            if (!g) return;
            var on = !subscribed(card.id), m = mini(card, 't');
            updGuest(function (x) {
                x.subs = (x.subs || []).filter(function (c) { return c.id != m.id; });
                if (on) { x.subs.unshift(m); x.subs = x.subs.slice(0, 100); x.muted = (x.muted || []).filter(function (y) { return y !== String(m.id); }); }
            });
            subNotify(card, on, null);                                   // подтверждение — в его чат
            noty(on ? 'Подписка для «' + g.name + '»: о новых сериях — ему в Telegram' : 'Подписка «' + g.name + '» отменена', 4000);
        });
    }

    function paintCardButton(btn, on) {
        btn.toggleClass('active', on).find('path').eq(1).attr('fill', on ? 'currentColor' : 'transparent');
        btn.find('span').text(on ? 'Вы подписаны' : 'Подписаться');
    }
    function cardButton(e) {
        try {
            if (!e || e.type !== 'complite' || !e.body) return;
            var card = e.data && e.data.movie;
            if (!card || !(card.id > 0) || !(card.number_of_seasons || card.first_air_date || card.original_name)) return;
            var btn = e.body.find('.button--subscribe');
            if (!btn.length) return;
            btn.removeClass('hide').off('hover:enter').on('hover:enter', function () {
                if (btn.hasClass('loading')) return;
                btn.addClass('loading');
                tvSubscribe(card, function () { toggleSub(card, function (on) { btn.removeClass('loading'); paintCardButton(btn, on); }); },
                    function () { btn.removeClass('loading'); });
            });
            paintCardButton(btn, subscribed(card.id));
        } catch (x) { log('кнопка карточки', x.message); }
    }

    /* ---------- поиск в боте ---------- */

    /* TMDB без таймаута: если сервер не отвечает, поиск висел бы до минут. Через TMDB_TIMEOUT отвечаем «не ответил». */
    var TMDB_TIMEOUT = 10000;
    function tmdbGet(path, cb) {
        cb = keep(cb);
        var done = false, finish = function (j) { if (done) return; done = true; cb(j || null); };
        var req = new Lampa.Reguest();
        try { req.timeout(TMDB_TIMEOUT); } catch (e) {}
        req.silent(Lampa.TMDB.api(path + (path.indexOf('?') < 0 ? '?' : '&') + 'api_key=' + Lampa.TMDB.key() + '&language=ru'),
            function (j) { finish(j); }, function () { finish(null); });
        setTimeout(function () { finish(null); }, TMDB_TIMEOUT + 2000);
    }
    /** Карточка Lampa из ответа TMDB (подробности фильма/сериала). */
    function toCard(j, kind) {
        var c = {}, k;
        for (k in j) if (j.hasOwnProperty(k)) c[k] = j[k];
        c.source = 'tmdb';
        if (kind === 't' && !c.name) c.name = c.original_name || '';
        return c;
    }
    /** Подпись результата поиска: «Название (год)\nСериал · ★ 7.7\nописание…». */
    function resultCaption(r) {
        var tv = r.media_type === 'tv', name = (tv ? r.name : r.title) || r.original_name || r.original_title || '';
        var y = String((tv ? r.first_air_date : r.release_date) || '').slice(0, 4), about = String(r.overview || '');
        if (about.length > 180) about = about.slice(0, 177).replace(/\s+\S*$/, '') + '…';
        return name + (y ? ' (' + y + ')' : '') + '\n' + (tv ? 'Сериал' : 'Фильм') + (r.vote_average ? ' · ★ ' + (+r.vote_average).toFixed(1) : '') + (about ? '\n\n' + about : '');
    }
    /* Результаты поиска — одним сообщением-слайдером: постер и описание, ◀ 3 / 20+ ▶ меняют их в том же сообщении
     * (editMessageMedia). Все найденные: TMDB отдаёт по 20 на страницу — дошли до конца, а страницы ещё есть, ▶
     * подгружает следующую («+» в счётчике). Найденное помним по номеру сообщения, пока Lampa запущена. */
    var slides = {}, SLIDE_LIMIT = 200;

    /* Умный поиск: «Доктор Стрендж 2026» — название с годом; «2026» — популярное за год; «фильмы Марвел 2026»,
     * «сериалы Netflix», «мультфильмы Pixar» — по студии (и типу, и году). Иначе — обычный поиск по названию. */
    var STUDIOS = [
        [/марвел|marvel/, 420, 'Marvel'], [/\bdc\b|диси|ди\s*си/, 9993, 'DC'], [/пиксар|pixar/, 3, 'Pixar'],
        [/дисне[йи]|disney/, 2, 'Disney'], [/нетфликс|netflix/, 0, 'Netflix', 213], [/\bhbo\b|эйчбио/, 0, 'HBO', 49],
        [/уорнер|ворнер|warner/, 174, 'Warner Bros.'], [/юниверсал|universal/, 33, 'Universal'],
        [/дримворкс|dreamworks/, 521, 'DreamWorks'], [/\ba24\b|а24/, 41077, 'A24'], [/лукасфильм|lucasfilm/, 1, 'Lucasfilm'],
        [/парамаунт|paramount/, 4, 'Paramount'], [/сони|sony/, 34, 'Sony Pictures'], [/блюмхаус|blumhouse/, 3172, 'Blumhouse'],
        [/иллюминейшн|illumination/, 6704, 'Illumination'], [/гибли|ghibli/, 10342, 'Studio Ghibli'], [/apple\s*tv|эпл\s*тв|апл\s*тв/, 0, 'Apple TV+', 2552],
        [/амазон|amazon|prime/, 0, 'Prime Video', 1024]
    ];
    // \b в регулярных JS не видит русских букв — слова-заполнители убираем по словам
    var FILLER = ['фильмы', 'фильм', 'кино', 'сериалы', 'сериал', 'мультфильмы', 'мультфильм', 'мультики', 'мульт', 'аниме', 'компании', 'компания',
        'студии', 'студия', 'от', 'за', 'в', 'год', 'года', 'году', 'новинки', 'новые', 'лучшие', 'movie', 'movies', 'series', 'from'];

    /** Разбор запроса: {title, year, type: '' | 'movie' | 'tv', anim, studio: {name, company, network}}. */
    function parseQuery(q) {
        var low = ' ' + String(q || '').toLowerCase().replace(/ё/g, 'е') + ' ', out = { title: '', year: 0, type: '', anim: false, studio: null };
        var y = /(?:^|\D)((?:19|20)\d{2})(?:\D|$)/.exec(low);
        if (y) { out.year = +y[1]; low = low.replace(y[1], ' '); }
        if (/сериал|series/.test(low)) out.type = 'tv';
        else if (/мульт|аниме/.test(low)) { out.type = 'movie'; out.anim = true; }
        else if (/фильм|кино|movie/.test(low)) out.type = 'movie';
        for (var i = 0; i < STUDIOS.length; i++) if (STUDIOS[i][0].test(low)) {
            out.studio = { name: STUDIOS[i][2], company: STUDIOS[i][1], network: STUDIOS[i][3] || 0 };
            low = low.replace(STUDIOS[i][0], ' ');
            break;
        }
        out.title = low.split(/\s+/).filter(function (w) { return w && FILLER.indexOf(w) < 0; }).join(' ');
        return out;
    }
    /** Что показать в «Ищу…»: «фильмы Marvel за 2026». */
    function queryLabel(p, q) {
        if (!p.studio && !(p.year && !p.title)) return '«' + q + '»';
        return (p.anim ? 'мультфильмы' : p.type === 'tv' ? 'сериалы' : p.type === 'movie' ? 'фильмы' : 'фильмы и сериалы') +
            (p.studio ? ' ' + p.studio.name : '') + (p.title && p.studio ? ' «' + p.title + '»' : '') + (p.year ? ' за ' + p.year : '');
    }

    function onlyCards(list, kind) {
        return (list || []).filter(function (r) {
            if (kind) r.media_type = kind;
            return (r.media_type === 'movie' || r.media_type === 'tv') && r.poster_path;
        });
    }
    /** Фильмы и сериалы одной страницей: обе выдачи вместе, по популярности. */
    function both(pathMovie, pathTv, page, cb) {
        var left = 0, all = [], pages = 0;
        var take = function (kind) { return function (j) { all = all.concat(onlyCards(j && j.results, kind)); pages = Math.max(pages, (j && j.total_pages) | 0); if (--left === 0) done(); }; };
        var done = function () { all.sort(function (a, b) { return (b.popularity || 0) - (a.popularity || 0); }); cb(all, pages); };
        if (pathMovie) { left++; tmdbGet(pathMovie + '&page=' + page, take('movie')); }
        if (pathTv) { left++; tmdbGet(pathTv + '&page=' + page, take('tv')); }
        if (!left) cb([], 0);
    }

    /** Источник страниц для запроса: fetch(page, cb(list, pages)). */
    function searchSource(q) {
        var p = parseQuery(q), enc = encodeURIComponent;
        var wantM = p.type !== 'tv', wantT = p.type !== 'movie';
        if (p.studio) {
            var st = p.studio, yM = p.year ? '&primary_release_year=' + p.year : '', yT = p.year ? '&first_air_date_year=' + p.year : '';
            var anim = p.anim ? '&with_genres=16' : '', sort = '&sort_by=' + (p.year ? 'popularity.desc' : 'primary_release_date.desc') + '&vote_count.gte=' + (p.year ? 0 : 20);
            var mPath = wantM && st.company ? 'discover/movie?with_companies=' + st.company + yM + anim + sort : '';
            var tPath = wantT ? 'discover/tv?' + (st.network ? 'with_networks=' + st.network : 'with_companies=' + st.company) + yT + anim + '&sort_by=popularity.desc' : '';
            if (st.network && !st.company) mPath = '';                   // стриминг — только сериалы TMDB-сети
            return { label: queryLabel(p, q), fetch: function (page, cb) {
                both(mPath, tPath, page, function (list, pages) {
                    if (!p.title) return cb(list, pages);
                    var t = p.title;                                       // «Марвел Мстители» — среди фильмов студии
                    cb(list.filter(function (r) { return String(r.title || r.name || '').toLowerCase().indexOf(t) >= 0 || String(r.original_title || r.original_name || '').toLowerCase().indexOf(t) >= 0; }), pages);
                });
            } };
        }
        if (!p.title && p.year) {                                         // «2026» — популярное за год
            return { label: queryLabel(p, q), fetch: function (page, cb) {
                both(wantM ? 'discover/movie?primary_release_year=' + p.year + (p.anim ? '&with_genres=16' : '') + '&sort_by=popularity.desc' : '',
                    wantT ? 'discover/tv?first_air_date_year=' + p.year + '&sort_by=popularity.desc' : '', page, cb);
            } };
        }
        if (p.year && p.title) {                                          // «Доктор Стрендж 2026» — с годом, не нашлось — без
            var plain = false;
            return { label: '«' + q + '»', fetch: function (page, cb) {
                if (plain) return multi(page, cb);
                both(wantM ? 'search/movie?query=' + enc(p.title) + '&year=' + p.year : '', wantT ? 'search/tv?query=' + enc(p.title) + '&first_air_date_year=' + p.year : '', page, function (list, pages) {
                    if (list.length || page > 1) return cb(list, pages);
                    plain = true;
                    multi(page, cb);
                });
            } };
        }
        function multi(page, cb) {
            tmdbGet('search/multi?query=' + enc(p.title || q) + '&include_adult=false&page=' + page, function (j) {
                var list = onlyCards(j && j.results);
                if (p.type) list = list.filter(function (r) { return r.media_type === p.type; });
                cb(list, (j && j.total_pages) | 0);
            });
        }
        return { label: '«' + q + '»', fetch: multi };
    }

    /** more — у TMDB есть ещё страницы: ▶ на последней карточке — подгрузить, а не по кругу. */
    function slideButtons(list, i, more) {
        var r = list[i], k = r.media_type === 'tv' ? 't' : 'm', row2 = [{ text: '📺 Открыть на ТВ', callback_data: 'o:' + k + ':' + r.id }];
        if (k === 't') row2.push({ text: '🔔 Подписаться', callback_data: 's:t:' + r.id });
        var rows = [[{ text: '▶️ Смотреть', callback_data: 'v:' + k + ':' + r.id }, { text: '⭐ Хочу посмотреть', callback_data: 'w:' + k + ':' + r.id }], row2];
        if (list.length > 1 || more) rows.push([
            { text: '◀', callback_data: 'p:' + ((i - 1 + list.length) % list.length) },
            { text: (i + 1) + ' / ' + list.length + (more ? '+' : ''), callback_data: 'n' },
            { text: '▶', callback_data: 'p:' + (i + 1 < list.length ? i + 1 : more ? list.length : 0) }]);
        return rows;
    }

    function botSearch(query, viaAi) {
        // описали словами — сначала ИИ: что это за фильм; потом обычный поиск по названию
        if (!viaAi && aiReady() && isDescription(query)) {
            call('sendChatAction', { chat_id: to(), action: 'typing' }, null, null);
            var sid = 0, queued = '';
            var st = function (t) { if (sid) call('editMessageText', { chat_id: to(), message_id: sid, text: t }, null, null); else queued = t; };
            call('sendMessage', { chat_id: to(), text: '🤖 Спрашиваю ИИ…' }, function (m) { sid = m && m.message_id || 0; if (sid && queued) st(queued); }, null);
            return aiFlow(query, st);
        }
        // пока ищем — «печатает…» и сообщение «Ищу…»; результат пришёл — сообщение убираем (или пишем «не нашлось»)
        call('sendChatAction', { chat_id: to(), action: 'upload_photo' }, null, null);
        var statusId = 0, found = null, shown = false;
        var status = function (t) { if (statusId) call('editMessageText', { chat_id: to(), message_id: statusId, text: t }, null, null); else reply(t); };
        var finish = function () {
            if (!found || shown) return;
            shown = true;
            if (!found.list.length && !viaAi && aiReady()) return aiFlow(query, status);   // по названию пусто — спросить ИИ
            if (!found.list.length) {
                if (statusId) call('editMessageText', { chat_id: to(), message_id: statusId, text: '😔 По запросу «' + query + '» ничего не нашлось.\nПопробуйте написать иначе или по-английски.' }, null, null);
                else reply('😔 По запросу «' + query + '» ничего не нашлось.');
                return;
            }
            if (statusId) call('deleteMessage', { chat_id: to(), message_id: statusId }, null, null);
            showSlides(found.s);
        };
        var src = searchSource(query);
        call('sendMessage', { chat_id: to(), text: '🔎 Ищу ' + src.label + ' в базе фильмов и сериалов…' }, function (m) {
            statusId = m && m.message_id || 0;
            if (found) finish();                                          // поиск успел раньше — доделать
        }, null);
        src.fetch(1, function (list, pages) {
            found = { list: list, s: { list: list, src: src, page: 1, pages: pages } };
            if (statusId) finish();
            else setTimeout(keep(function () { if (!statusId) finish(); }), 3000);   // «Ищу…» не отправилось — без него
        });
    }

    function hasMore(ss) { return ss.page < ss.pages && ss.list.length < SLIDE_LIMIT; }

    function showSlides(ss) {
        var list = ss.list;
        call('sendPhoto', { chat_id: to(), photo: posterUrl(list[0].poster_path), caption: resultCaption(list[0]),
            reply_markup: JSON.stringify({ inline_keyboard: slideButtons(list, 0, hasMore(ss)) }) }, function (msg) {
            if (msg && msg.message_id) {
                slides[to() + ':' + msg.message_id] = ss;
                var keys = Object.keys(slides);
                if (keys.length > 20) delete slides[keys[0]];           // старые поиски — не держим
            }
        }, function (e) { log('поиск — не отправлено', e); });
    }

    /** ◀ ▶ — другая карточка в том же сообщении. */
    function slideTo(q, i) {
        var mid = q.message.message_id, ss = slides[to() + ':' + mid];
        var answer = function (t) { call('answerCallbackQuery', { callback_query_id: q.id, text: t || '' }, null, null); };
        if (!ss) return answer('Поиск устарел — напишите название ещё раз');
        i = i | 0;
        if (i >= ss.list.length && hasMore(ss)) {
            if (ss.loading) return answer('Загружаю…');
            ss.loading = true;
            return ss.src.fetch(ss.page + 1, function (more, pages) {
                ss.loading = false;
                ss.page++;
                if (pages) ss.pages = pages;
                var seen = {};
                ss.list.forEach(function (r) { seen[r.media_type + r.id] = 1; });
                more.forEach(function (r) { if (!seen[r.media_type + r.id]) ss.list.push(r); });
                if (i >= ss.list.length) i = hasMore(ss) ? ss.list.length - 1 : 0;   // страница пустая — не застрять
                show();
            });
        }
        show();
        function show() {
            i = Math.max(0, Math.min(ss.list.length - 1, i));
            var r = ss.list[i];
            call('editMessageMedia', { chat_id: to(), message_id: mid,
                media: JSON.stringify({ type: 'photo', media: posterUrl(r.poster_path), caption: resultCaption(r) }),
                reply_markup: JSON.stringify({ inline_keyboard: slideButtons(ss.list, i, hasMore(ss)) }) }, function () { answer(); }, function (e) { answer(); log('слайдер', e); });
        }
    }

    /** Выбрали ТВ: этот — открыть здесь, другой — команда по каналу и ответ в то же сообщение. */
    function openOn(q, dev, kind, id, play) {
        var mid = q.message.message_id, answer = function (t) { call('answerCallbackQuery', { callback_query_id: q.id, text: t || '' }, null, null); };
        var edit = function (t) { call('editMessageText', { chat_id: to(), message_id: mid, text: t }, null, null); };
        var name = dev === tvId ? tvName() : (devices[dev] || {}).name || 'ТВ';
        if (dev === tvId) return openHereLocal();
        var ref = randomTopic().slice(6, 14), timer = null;
        var expire = keep(function () { if (acks[ref]) { delete acks[ref]; edit('📺 «' + name + '» не ответил — возможно, выключен или Lampa закрыта.'); } });
        acks[ref] = keep(function (m) {
            clearTimeout(timer);
            if (m.wait) { edit('⏳ «' + name + '»: ' + (m.why || 'ждёт, пока закончится видео')); timer = setTimeout(expire, AFTER_VIDEO_MAX); return; }
            delete acks[ref];
            edit(m.ok ? (play ? '▶️ Включаю на «' : '📺 Открыто на «') + name + '»' : '📺 «' + name + '»: ' + (m.why || 'не получилось'));
        });
        timer = setTimeout(expire, ACK_WAIT);
        busSend({ t: 'open', to: dev, k: kind, id: id, ref: ref, play: !!play, g: !isOwner() });
        answer('Отправляю на «' + name + '»…');
        function openHereLocal(deferred) {
            if (tvPlaying()) {
                if (!isOwner()) { if (!deferred) answer('На этом ТВ сейчас смотрят — подождите'); return; }
                if (!deferred) { answer('Откроется после просмотра'); edit('⏳ Откроется на «' + name + '», когда закончится видео'); }
                return whenVideoEnds(function () { openHereLocal(true); });
            }
            tmdbGet((kind === 't' ? 'tv/' : 'movie/') + id, function (j) {
                if (!j || !j.id) return deferred ? null : answer('TMDB не ответил');
                try {
                    pushCard(toCard(j, kind), kind, play);
                    if (!deferred) answer();
                    edit((play ? '▶️ Включаю на «' : '📺 Открыто на «') + name + '»');
                } catch (e) { if (!deferred) answer('Не получилось открыть: ' + e.message); }
            });
        }
    }

    /* ---------- «⌨️ Набрать на ТВ»: текст с телефона — в поиск Lampa на телевизоре ---------- */

    var typeFor = null, TYPE_WAIT = 5 * 60000;

    /** Текст для поиска Lampa: она вставляет его как HTML (.search__input), поэтому разметку и
     *  управляющие символы вычищаем — иначе через бота можно было бы встроить код в страницу ТВ. */
    function typedText(t) {
        return String(t || '').replace(/[<>&"'`\\]/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ')
            .replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '').slice(0, 100);
    }
    /** Открыть поиск Lampa на этом ТВ с готовым текстом: Search.open сам ставит текст и ищет. */
    function typeHere(text) {
        var playing = false;
        try { playing = !!Lampa.Player.opened(); } catch (e) {}
        if (playing) return 'идёт видео — не прерываю';
        try {
            if (document.body.className.indexOf('search--open') >= 0) Lampa.Search.close();
            Lampa.Search.open({ input: text });
            return '';
        } catch (e) { return e.message || 'не получилось открыть поиск'; }
    }
    /** Кнопка в меню: выбрать ТВ (если их несколько) и ждать текст. */
    function typeStart() {
        if (!isOwner() && !guestPlay()) return reply('Владелец запретил гостям управлять ТВ.');
        var tvs = allTvs();
        if (tvs.length > 1) {
            return reply('⌨️ На каком телевизоре набрать?', tvs.map(function (d) { return [{ text: d.text, callback_data: 'tp:' + d.id }]; }));
        }
        typeWait(tvId);
    }
    function typeWait(dev) {
        typeFor = { chat: to(), at: Date.now(), tv: dev };
        var name = dev === tvId ? tvName() : (devices[dev] || {}).name || 'ТВ';
        reply('⌨️ Напишите, что искать, — текст появится в поиске Lampa на «' + name + '».');
    }
    /** Пришёл текст в режиме «Набрать на ТВ». */
    function typeSend(raw) {
        var dev = typeFor.tv, text = typedText(raw), again = [[{ text: '⌨️ Набрать ещё', callback_data: 'mn:type' }]];
        typeFor = null;
        if (!text) return reply('Текст пустой — нажмите «⌨️ Набрать на ТВ» ещё раз.');
        var name = dev === tvId ? tvName() : (devices[dev] || {}).name || 'ТВ';
        if (dev === tvId) {
            var why = typeHere(text);
            return reply(why ? '📺 «' + name + '»: ' + why : '📺 Ищу «' + text + '» на «' + name + '»', again);
        }
        var ref = randomTopic().slice(6, 14), timer = null;
        acks[ref] = keep(function (m) {
            clearTimeout(timer);
            reply(m.ok ? '📺 Ищу «' + text + '» на «' + name + '»' : '📺 «' + name + '»: ' + (m.why || 'не получилось'), again);
        });
        timer = setTimeout(keep(function () { if (acks[ref]) { delete acks[ref]; reply('📺 «' + name + '» не ответил — возможно, выключен или Lampa закрыта.'); } }), ACK_WAIT);
        busSend({ t: 'type', to: dev, text: text, ref: ref });
    }

    /** Кнопки под результатом поиска: w — «Хочу посмотреть», o — открыть на ТВ, s — подписаться. */
    function searchAction(q, act, kind, id) {
        var answer = function (t) { call('answerCallbackQuery', { callback_query_id: q.id, text: t }, null, null); };
        tmdbGet((kind === 't' ? 'tv/' : 'movie/') + id, function (j) {
            if (!j || !j.id) return answer('TMDB не ответил, попробуйте ещё раз');
            var card = toCard(j, kind), name = card.title || card.name || '';
            if ((act === 'o' || act === 'v') && !isOwner() && !guestPlay()) return answer('Владелец запретил гостям включать видео на ТВ');
            if (act !== 'o' && act !== 'v' && !isOwner()) {
                if (act === 's' && subscribed(card.id)) return answer('Вы уже подписаны');
                return guestAction(act, card, kind, name, answer);
            }
            if (act === 'x') {
                try { Lampa.Favorite.remove('wath', card); answer('✖ «' + name + '» убран из «Хочу посмотреть»'); }
                catch (e) { answer('Не получилось убрать: ' + e.message); }
            } else if (act === 'w') {
                try { Lampa.Favorite.add('wath', card); answer('⭐ «' + name + '» — в «Хочу посмотреть»'); }
                catch (e) { answer('Не получилось добавить: ' + e.message); }
            } else if (act === 's') {
                if (subscribed(card.id)) return answer('Вы уже подписаны');
                toggleSub(card, function () { answer('🔔 Подписка на «' + name + '»'); });
            } else {
                var others = otherTvs();
                if (others.length) {                                    // включено несколько ТВ — выбрать
                    answer('');
                    var rows = allTvs().map(function (d) { return [{ text: d.text, callback_data: (act === 'v' ? 'D:' : 'd:') + d.id + ':' + kind + ':' + card.id }]; });
                    rows.push([{ text: '✏️ Переименовать ТВ', callback_data: 'rn' }]);
                    return reply((act === 'v' ? 'На каком ТВ включить «' : 'На каком ТВ открыть «') + name + '»?', rows);
                }
                if (tvPlaying()) {
                    if (!isOwner()) return answer('На ТВ сейчас смотрят — подождите');
                    answer('Откроется после просмотра');
                    return whenVideoEnds(function () { try { pushCard(card, kind, act === 'v'); } catch (e) { log('после видео', e.message); } });
                }
                try {
                    pushCard(card, kind, act === 'v');
                    answer((act === 'v' ? '▶️ Включаю на ТВ: ' : '📺 Открыл на ТВ: ') + name);
                } catch (e) { answer('Не получилось открыть: ' + e.message); }
            }
        });
    }

    function panelRemove() { try { Lampa.PlayerPanel.render().find('.bs-sub').remove(); } catch (e) {} }

    /** Подписан ли кто-нибудь (владелец или любой из людей) — для надписи на кнопке плеера. */
    function anySub(id) {
        if (subscribed(id)) return true;
        return people().some(function (p) { var on = false; as(p.who, function () { on = subscribed(id); }); return on; });
    }
    function panelPaint(box, card) {
        var on = anySub(card.id), many = !!chat() && people().length > 0;
        box.find('.bs-sub__btn').toggleClass('bs-sub__btn--on', on).text(on ? (many ? 'Подписка ✓' : 'Вы подписаны ✓') : 'Подписаться');
    }

    /* Кнопка «Подписаться» в панели плеера — на любой серии идущего сериала. Нажали — кнопка остаётся той же (не
     * пересоздаётся), фокус пульта возвращается на неё: иначе фокус терялся и стрелки в панели не работали. */
    function panelDraw(card) {
        panelRemove();
        try {
            var panel = Lampa.PlayerPanel.render(), left = panel.find('.player-panel__left').first();
            if (!left.length) return;
            var box = $('<div class="bs-sub"><div class="button selector bs-sub__btn"></div><div class="bs-sub__next"></div></div>'), btn = box.find('.selector');
            box.find('.bs-sub__next').text(nextText(tvInfo && tvInfo.next, today()));
            panelPaint(box, card);
            var refocus = function () {
                panelPaint(box, card);
                try { Lampa.Controller.toggle('player_panel'); Lampa.Controller.collectionFocus(btn[0], panel); } catch (e) {}
            };
            btn.on('hover:enter', function () {
                tvSubscribe(card, function () {
                    var now = !subscribed(card.id);
                    setSubAll(card, now, tvInfo);
                    subNotify(card, now, tvInfo);
                    refocus();
                    if (!now) return noty('Подписка отменена', 2000);
                    noty(chat() ? 'Подписка: о новой серии придёт сообщение в Telegram' : 'Подписка сохранена. Уведомления — в Telegram: Настройки → Telegram', 5000);
                }, refocus);
            });
            left.append(box);
        } catch (e) { log('panel', e.message); }
    }

    /** Сериал ещё выходит: есть следующая серия, в производстве или не «завершён/отменён». */
    function ongoing(json) { return !!json && (!!json.next_episode_to_air || !!json.in_production || !/ended|canceled/i.test(String(json.status || ''))); }

    var playSeq = 0;
    function onPlayerStart(data) {
        panelRemove();
        tvInfo = null;
        var my = ++playSeq;
        var card = playerCard(data), s = data && data.season, e = data && data.episode;
        if (!card || !(s > 0) || !(e > 0) || !Lampa.TMDB || !Lampa.Reguest) return;
        var show = function (info) {
            var open = false;
            try { open = Lampa.Player.opened(); } catch (e) {}
            if (my !== playSeq || !open) return;                // плеер закрыли или уже другое видео
            tvInfo = info;
            log('подписка', 's' + s + 'e' + e + (info.ongoing ? ' — сериал идёт, кнопка' : ' — сериал завершён, без кнопки'));
            if (info.ongoing) setTimeout(function () { panelDraw(card); }, 300);
        };
        var c = tvCache[card.id];
        if (c && Date.now() - c.at < 3600000) return show(c);
        var url = Lampa.TMDB.api('tv/' + card.id + '?api_key=' + Lampa.TMDB.key() + '&language=ru');
        new Lampa.Reguest().silent(url, function (json) {
            if (!json) return;
            tvCache[card.id] = { id: card.id, last: json.last_episode_to_air, next: json.next_episode_to_air, ongoing: ongoing(json), at: Date.now() };
            show(tvCache[card.id]);
        }, function () {});
    }

    /* ---------- настройки ---------- */

    function refreshSettings() {
        try { $('.settings-param[data-name="bs_tg_link"] .settings-param__descr').text(chat() ? 'Подключено' : 'Не подключено'); } catch (e) {}
    }

    function addSettings() {
        if (!Lampa.SettingsApi) return;
        var C = 'bs_update', api = Lampa.SettingsApi;
        api.addParam({
            component: C, param: { name: 'bs_tg_phone', type: 'button' },
            field: { name: 'Подключить с телефона', description: 'QR-код: токен бота вставляется на телефоне, пультом вводить не нужно.' },
            onChange: pairPhone
        });
        api.addParam({
            component: C, param: { name: 'bs_tg_join', type: 'button' },
            field: { name: 'Подключить через бота', description: 'Бот уже работает на другом ТВ? Код с экрана — боту, токен не нужен.' },
            onChange: pairJoin
        });
        api.addParam({
            component: C, param: { name: 'bs_tg_help', type: 'static' },
            field: { name: 'Или вручную', description: 'Токен от @BotFather — в поле ниже, напишите своему боту и нажмите «Подключить».' }
        });
        api.addParam({
            component: C, param: { name: 'bs_tg_token', type: 'input', values: '', placeholder: '123456789:AA…', 'default': '' },
            field: { name: 'Токен бота', description: 'Хранится только на этом ТВ.' },
            onChange: function () { lsSet('bs_tg_chat', ''); refreshSettings(); busStart(); }
        });
        api.addParam({
            component: C, param: { name: 'bs_tg_link', type: 'button' },
            field: { name: 'Подключить', description: 'Не подключено' },
            onRender: function (item) { item.find('.settings-param__descr').text(chat() ? 'Подключено' : 'Не подключено'); },
            onChange: link
        });
        api.addParam({
            component: C, param: { name: 'bs_tv_name', type: 'input', values: '', placeholder: 'Гостиная', 'default': '' },
            field: { name: 'Название этого ТВ', description: 'Пусто — имя телевизора из его настроек. Можно сменить и в боте.' },
            onChange: function (v) { lsSet('bs_tv_name', String(v || '')); busHello(false); }
        });
        api.addParam({
            component: C, param: { name: 'bs_tg_shots', type: 'trigger', 'default': true },
            field: { name: 'Записи Shots — в Telegram', description: 'Записали момент кнопкой «Записать» в плеере — видео придёт в бот.' },
            onChange: function (v) { lsSet('bs_tg_shots', String(v === true || v === 'true')); }
        });
        api.addParam({
            component: C, param: { name: 'bs_tg_approve', type: 'trigger', 'default': true },
            field: { name: 'Новые люди — с разрешения', description: 'Подключился по QR — бот сначала спросит вас. Выключено — подключается сразу.' },
            onChange: function (v) { lsSet('bs_tg_approve', String(v === true || v === 'true')); cfgSend(); }
        });
        api.addParam({
            component: C, param: { name: 'bs_tg_guest_play', type: 'trigger', 'default': true },
            field: { name: 'Гости включают видео на ТВ', description: 'Выключено — гости могут искать, подписываться и вести свои списки, но не включать фильмы на ТВ.' },
            onChange: function (v) { lsSet('bs_tg_guest_play', String(v === true || v === 'true')); cfgSend(); }
        });
        api.addParam({
            component: C, param: { name: 'bs_tg_invite_reset', type: 'button' },
            field: { name: 'Сменить приглашение', description: 'Старый QR в поиске и пересланные ссылки перестанут подключать. Уже подключённые остаются.' },
            onChange: function () { inviteReset(); noty('Приглашение сменено — новый QR в поиске', 4000); }
        });
        api.addParam({
            component: C, param: { name: 'bs_search_qr', type: 'trigger', 'default': true },
            field: { name: 'QR бота в поиске', description: 'Под клавиатурой поиска — искать с телефона и открывать на ТВ.' },
            onChange: function (v) { lsSet('bs_search_qr', String(v === true || v === 'true')); }
        });
        api.addParam({
            component: C, param: { name: 'bs_tg_on', type: 'trigger', 'default': true },
            field: { name: 'Новые серии в Telegram', description: 'Подписки из плеера, закладки и сериалы, которые смотрите.' },
            onChange: function (v) { lsSet('bs_tg_on', String(v === true || v === 'true')); }
        });
        api.addParam({
            component: C, param: { name: 'bs_tg_check', type: 'button' },
            field: { name: 'Проверить сейчас', description: 'Обычно — сама, при запуске и раз в 6 часов.' },
            onChange: function () { if (!chat()) return noty('Сначала подключите бота', 3000); check(true, true); }
        });
    }

    function start() {
        try { addSettings(); } catch (e) { log('settings', e.message); }
        try { searchKeypad(); } catch (e) { log('клавиатура поиска', e.message); }
        try { Lampa.Player.listener.follow('destroy', onVideoClosed); } catch (e) {}
        try { Lampa.Search.listener.follow('sources', function () { setTimeout(function () { try { searchQr(); } catch (e) { log('qr поиска', e.message); } }, 50); }); } catch (e) {}
        try {
            Lampa.Listener.follow('full', cardButton);
            Lampa.Listener.follow('full', onFullWatch);
            Lampa.Listener.follow('shots_status', function (e) { try { onShot(e); } catch (x) { log('запись', x.message); } });
            setTimeout(function () { try { shotsSweep(); } catch (x) {} }, 30000);
            setInterval(function () { try { shotsSweep(); } catch (x) {} }, 5 * 60000);
            Lampa.Player.listener.follow('start', onPlayerStart);
            Lampa.Player.listener.follow('destroy', function () { panelRemove(); tvInfo = null; });
        } catch (e) { log('player', e.message); }
        setTimeout(function () { check(false); }, 40000);
        setInterval(function () { check(false); }, 30 * 60000);
        setTimeout(remind, 70000);
        setTimeout(function () {
            if (!token() || !chat() || lsGet('bs_tg_cmds') === '8') return;
            var first = lsGet('bs_tg_cmds') !== '7';
            lsSet('bs_tg_cmds', '8');
            if (!leading()) return;
            setCommands();
            var news = (first ? '✨ Новое меню: кнопка «📋 Меню» внизу — все разделы, «👤 Профиль» — что подключено.\n' : '') +
                '⌨️ Новое: «Набрать на ТВ» в меню — пишете здесь, а текст появляется в поиске Lampa на телевизоре.';
            as('', function () { sendKb(news); });
            var people = users();
            Object.keys(people).forEach(function (k) { if (active(people[k])) as(k, function () { sendKb(news); }); });
        }, 20000);
        setInterval(remind, 10 * 60000);
        setInterval(poll, 15000);                                    // страховка: опрос оборвался (сеть) — поднять
        loadDevName();
        setTimeout(function () {
            if (token() && chat() && !lsGet('bs_tg_owner')) call('getChat', { chat_id: chat() }, function (c) {
                var n = c && [c.first_name, c.last_name].filter(Boolean).join(' ');
                if (n) lsSet('bs_tg_owner', n.slice(0, 40));
            }, null);
        }, 15000);
        setTimeout(function () { if (token()) { busStart(); busHello(true); } }, 5000);
        var bye = function () { var was = isLeader; isLeader = false; if (was) leader = { id: '', at: 0 }; if (token()) busSend({ t: 'bye', lead: was }); };
        try {
            document.addEventListener('visibilitychange', function () { if (document.hidden) bye(); else { conflictUntil = 0; setTimeout(poll, 1000); } });
            window.addEventListener('unload', bye);
        } catch (e) {}
        setInterval(function () { if (token()) busStart(); }, 60000);
        var lastHello = Date.now();
        setInterval(function () {
            if (!token() || Date.now() - lastHello < HELLO_EVERY) return;
            lastHello = Date.now();
            busHello(false);
        }, 15000);
        // Failover: главный пропал (выключили, Lampa закрыта, сеть) - первый на экране по очереди берёт бота сразу.
        setInterval(function () {
            if (!token() || !chat() || pair || polling || !onScreen() || !leaderStale() || takeoverRank() > 0) return;
            conflictUntil = 0;
            poll();
        }, 15000);
    }

    return { start: start, _chatFrom: chatFrom, _isNew: isNew, _nextText: nextText, _isLatest: isLatest, _tokenFrom: tokenFrom, _weekLines: weekLines, _weekKey: weekKey, _caption: resultCaption, _slideButtons: slideButtons, _fnv: fnv, _parseQuery: parseQuery, _fromGemini: fromGemini, _isGeminiKey: isGeminiKey, _rankModels: rankModels, _cleanDevName: cleanDevName, _joinFrom: joinFrom, _shotCaption: shotCaption, _clock: clock, _verNum: verNum, _keyKind: keyKind, _groqPick: groqPick, _oaContent: oaContent, _ongoing: ongoing, _pushCard: pushCard, _tvSubscribe: tvSubscribe, _fromGeminiList: fromGeminiList, _geminiBody: geminiBody, _as: as, _geminiRun: geminiRun, _isDescription: isDescription, _chatFrom2: chatFrom, _onUserPart: onUserPart, _guestTracked: guestTracked, _mini: mini, _joinMsg: joinMsg, _joinTopic: joinTopic, _tvLabels: tvLabels, _geminiError: geminiError, _geminiSummary: geminiSummary, _menuRows: menuRows, _typedText: typedText, _typeHere: typeHere, _whenVideoEnds: whenVideoEnds, _onVideoClosed: onVideoClosed, _tvPlaying: tvPlaying, _leaderStale: leaderStale, _takeoverRank: takeoverRank, _onBus: onBus, _commands: COMMANDS, _crypt: Crypt, _busOpen: busOpen, _busKey: busKey, _inviteCode: inviteCode, _inviteReset: inviteReset, _active: active, _handle: handle };
})();
