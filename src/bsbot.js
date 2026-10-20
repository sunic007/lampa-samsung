/*
 * Общий бот Sunic Apps (@SunicStreamBot, «Sunic Apps Plus») — без своего токена от @BotFather.
 *
 * Бот живёт на сервере sunic.stream (bot/hook.php), ТВ с ним — через bot/tv.php:
 *  - «Подключить»: ТВ один раз придумывает себе id и ключ (хранит у себя, сервер помнит только хеш ключа), получает
 *    ссылку t.me/SunicStreamBot?start=tv<код> и показывает её QR-кодом. Человек наводит камеру — чат привязан;
 *  - пока Lampa открыта, ТВ раз в 5 с забирает команды («Смотреть» из бота) и открывает фильм сам — как свой бот
 *    (BSTelegram.open: карточка → «Смотреть»; идёт видео — после него).
 * Свой бот с токеном (bstg.js) остаётся как был — бесплатно и как запасной путь, если сервер недоступен.
 */
var BSBot = (function () {
    var URLS = ['https://sunic.stream/bot/tv.php', 'http://sunic.stream/bot/tv.php'];   // https; старый ТВ без нового корня — http
    var POLL = 5000, POLL_IDLE = 30000, PAIR_WAIT = 10 * 60000;
    var C = 'bs_update';

    function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { if (v === null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v); } catch (e) {} }
    function noty(t, time) { try { Lampa.Noty.show(t, { time: time || 4000 }); } catch (e) {} }
    function log() { try { console.log.apply(console, ['BS bot'].concat([].slice.call(arguments))); } catch (e) {} }

    function rnd(n) {
        var abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', out = '', b = null, i;
        try { b = new Uint8Array(n); (window.crypto || window.msCrypto).getRandomValues(b); } catch (e) { b = null; }
        for (i = 0; i < n; i++) out += abc.charAt((b ? b[i] : Math.floor(Math.random() * 256)) % abc.length);
        return out;
    }
    /** id и ключ этого ТВ для общего бота (создаются один раз). */
    function ident() {
        var id = lsGet('bs_sb_tv'), key = lsGet('bs_sb_key');
        if (!/^[A-Za-z0-9]{12,40}$/.test(id || '') || !/^[A-Za-z0-9]{24,64}$/.test(key || '')) {
            id = rnd(20); key = rnd(40);
            lsSet('bs_sb_tv', id); lsSet('bs_sb_key', key);
        }
        return { id: id, key: key };
    }
    function tvName() { try { return window.BSTelegram && BSTelegram.tvName ? BSTelegram.tvName() : ''; } catch (e) { return ''; } }

    /** Запрос к серверу: https, не ответил — http. cb(ответ | null). */
    function api(action, cb) {
        var me = ident(), qs = '?a=' + action + '&tv=' + me.id + (action === 'hello' ? '&name=' + encodeURIComponent(tvName()) : '');
        (function next(i) {
            if (i >= URLS.length) return cb(null);
            var x = new XMLHttpRequest(), done = false;
            var fin = function (j) { if (done) return; done = true; if (j) cb(j); else next(i + 1); };
            try {
                x.open('GET', URLS[i] + qs, true);
                x.setRequestHeader('X-Sunic-Key', me.key);
                x.timeout = 10000;
                x.onload = function () { var j = null; try { j = JSON.parse(x.responseText); } catch (e) {} fin(j && typeof j.ok === 'boolean' ? j : null); };
                x.onerror = x.ontimeout = function () { fin(null); };
                x.send();
            } catch (e) { fin(null); }
        })(0);
    }

    /* ---------- команды с сервера ---------- */

    var timer = null;
    function run(c) {
        if (!c || c.t !== 'open' || !/^[mt]$/.test(c.kind) || !(c.id > 0)) return;
        try { BSTelegram.open(c.kind, c.id, !!c.play); } catch (e) { log('open', e.message); }
    }
    function tick() {
        timer = null;
        if (lsGet('bs_sb_on') !== '1') return;
        if (ownFirst()) return;
        if (document.hidden) return schedule(POLL_IDLE);
        api('poll', function (j) {
            if (j && j.ok && j.linked === false) { off(true); return log('отвязан в боте'); }
            if (j && j.ok) for (var i = 0; i < (j.cmds || []).length; i++) run(j.cmds[i]);
            schedule(j ? POLL : POLL_IDLE);
        });
    }
    function schedule(ms) { if (!timer) timer = setTimeout(tick, ms); }

    /* ---------- подключение по QR ---------- */

    function connect() {
        var ctrl = 'settings_component';
        try { ctrl = Lampa.Controller.enabled().name; } catch (e) {}
        noty('Подключаю…', 2000);
        api('hello', function (j) {
            if (!j || !j.ok) return noty('Сервер Sunic Apps не ответил — попробуйте позже или подключите свой бот ниже', 6000);
            if (j.linked) { linked(j); return noty('Общий бот уже подключён. Пишите @' + j.bot + ' название фильма', 6000); }
            show(j.link, j.bot, ctrl);
        });
    }
    function show(link, bot, ctrl) {
        var body = $('<div class="bs-tg-pair"><div class="bs-tg-pair__side"><div class="bs-tg-pair__qr"></div></div><div class="bs-tg-pair__steps">' +
            '<p>1. Наведите камеру телефона на QR-код.</p>' +
            '<p>2. В Telegram нажмите <b>«Запустить»</b>.</p>' +
            '<p>3. Готово: пишите боту <b>@' + bot + '</b> название фильма — он включится здесь.</p>' +
            '<p>Первый месяц бесплатно, дальше — Sunic Apps Plus.</p>' +
            '<div class="bs-tg-pair__url"></div><div class="bs-tg-pair__status">Жду телефон…</div></div></div>');
        body.find('.bs-tg-pair__url').text(link);
        try { Lampa.Utils.qrcode(link, body.find('.bs-tg-pair__qr')[0]); } catch (e) { log('qr', e.message); }
        var until = Date.now() + PAIR_WAIT, wait = null, closed = false;
        var close = function () {
            closed = true; clearInterval(wait);
            try { Lampa.Modal.close(); } catch (e) {}
            try { Lampa.Controller.toggle(ctrl); } catch (e) {}
        };
        Lampa.Modal.open({ title: 'Общий бот Sunic Apps', html: body, size: 'medium', onBack: close });
        wait = setInterval(function () {
            if (closed) return clearInterval(wait);
            if (Date.now() > until) { body.find('.bs-tg-pair__status').text('Время вышло — откройте подключение ещё раз'); return clearInterval(wait); }
            api('hello', function (j) {
                if (closed || !j || !j.ok || !j.linked) return;
                linked(j);
                close();
                noty('Готово, Telegram подключён. Пишите @' + bot + ' название фильма', 6000);
            });
        }, 3000);
    }

    /** Привязали в боте: бот на ТВ (bstg.js) работает через сервер — ему номер чата и имя бота, опрос — с нуля. */
    function linked(j) {
        lsSet('bs_sb_on', '1');
        if (j.chat) lsSet('bs_tg_chat', String(j.chat));
        if (j.bot) lsSet('bs_tg_bot', j.bot);
        lsSet('bs_tg_offset', null);
        try { BSTelegram.refresh(); } catch (e) {}
        schedule(500);
    }
    /** Отключить общий бот. silent — отвязали в самом боте (/tv): без уведомления, просто перестаём опрашивать. */
    function off(silent) {
        var shared = lsGet('bs_sb_on') === '1';
        api('unlink', function () {});
        lsSet('bs_sb_on', null);
        if (shared && !lsGet('bs_tg_secret') && lsGet('bs_tg_svc') !== '1') { lsSet('bs_tg_chat', null); lsSet('bs_tg_offset', null); }
        try { BSTelegram.refresh(); } catch (e) {}
        if (silent !== true) noty('Общий бот отключён', 3000);
    }

    function shared() { return lsGet('bs_sb_on') === '1'; }
    /** Один ТВ — один бот: на этом ТВ подключили свой бот (токен) — от общего отвязываемся, иначе общий бот считал бы ТВ
     *  своим и предлагал включать на нём. true — отвязали (или своего нет — false). */
    function ownFirst() {
        var own = false;
        try { own = !!BSTelegram.hasOwn && BSTelegram.hasOwn(); } catch (e) {}
        if (!own || !shared()) return false;
        api('unlink', function () {});
        lsSet('bs_sb_on', null);
        noty('Общий бот отключён: на этом ТВ подключён свой бот', 6000);
        return true;
    }
    function ownBot() { try { return BSTelegram.state() === 'own'; } catch (e) { return false; } }
    function addSettings() {
        var api2 = Lampa.SettingsApi, W = window.BS_SETTINGS_WHEN = window.BS_SETTINGS_WHEN || {};
        W['#Общий бот — без токена'] = function () { return !ownBot(); };
        W.bs_sb_link = function () { return !ownBot(); };
        W.bs_sb_off = shared;
        api2.addParam({ component: C, param: { name: 'bs_sb_link', type: 'button' },
            field: { name: 'Общий бот Sunic Apps', description: 'Без токена: QR-код — и готово' },
            onRender: function (item) {
                if (!shared()) return;
                item.find('.settings-param__name').text('Общий бот подключён');
                item.find('.settings-param__descr').text('Пишите @' + (lsGet('bs_tg_bot') || 'SunicStreamBot') + ' название фильма');
            },
            onChange: function () { if (shared()) noty('Уже подключён. Пишите @' + (lsGet('bs_tg_bot') || 'SunicStreamBot') + ' название фильма', 5000); else connect(); } });
        api2.addParam({ component: C, param: { name: 'bs_sb_off', type: 'button' },
            field: { name: 'Отключить общий бот', description: 'Этот ТВ перестанет получать команды' }, onChange: function () { off(); } });
    }

    function start() {
        try { addSettings(); } catch (e) { log('settings', e.message); }
        // подключён раньше (2.3.16: без номера чата) — спросить сервер; он же скажет, если в боте отвязали
        if (lsGet('bs_sb_on') === '1' && !ownFirst()) api('hello', function (j) { if (j && j.ok && j.linked) linked(j); else if (j && j.ok) off(true); else schedule(8000); });
        try { document.addEventListener('visibilitychange', function () { if (!document.hidden && lsGet('bs_sb_on') === '1') { clearTimeout(timer); timer = null; schedule(1000); } }); } catch (e) {}
    }

    return { start: start, connect: connect, ident: ident, _api: api, _ident: ident, _run: run, _ownFirst: ownFirst };
})();
