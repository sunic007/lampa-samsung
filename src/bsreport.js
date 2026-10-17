/*
 * «Сообщить о проблеме» (Настройки → Sunic Apps → Обновление → Помощь; пункт ставит loader.js, здесь — сам отчёт). Зритель выбирает, что случилось, и одной
 * кнопкой отправляет отчёт: бот поддержки (Cloudflare Worker sunicapps-support, POST /report) сам заводит задачу в
 * sunic007/lampa-samsung — с моделью ТВ, версиями, состоянием плеера и журналом. Фото экрана просить не нужно.
 *
 * Журнал — последние LOG_MAX строк консоли (свои модули и Lampa) и ошибки страницы; пишем с момента загрузки этого
 * файла, поэтому он первый в списке модулей (update.js LOCAL). Плюс журнал запросов к Skaz (BSFix.diagText).
 * Задача на GitHub открытая, поэтому всё, что уходит, чистим здесь (clean) и ещё раз в Worker (sanitize): токены ботов,
 * ключи ИИ, почта, коды подключения, адреса с параметрами (в них ключ аккаунта Skaz), внешние IP. Сам токен бота,
 * ключи и чаты Telegram в отчёт не кладём вовсе.
 *
 * Worker с ТВ недоступен (бывает: сеть блокирует *.workers.dev) — отчёт уходит через ntfy (REPORT_TOPIC), Worker
 * забирает его по расписанию; номер задачи тогда не известен сразу.
 */
var BSReport = (function () {
    var WORKER = 'https://sunicapps-support.sunic007.workers.dev/report';
    var NTFY = ['https://ntfy.sh/'], REPORT_TOPIC = 'sunicapps-tv-report-v1';
    var LOG_MAX = 250, LINE_MAX = 300, SEND_MAX = 24000, GAP = 10 * 60000;
    var KINDS = [
        ['video', 'Видео не запускается'],
        ['stall', 'Видео зависает или обрывается'],
        ['missing', 'Нет фильма, серии или озвучки'],
        ['bot', 'Не работает Telegram-бот'],
        ['update', 'Не обновляется'],
        ['other', 'Другое']
    ];
    var lines = [], t0 = Date.now();

    function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
    function noty(t, time) { try { Lampa.Noty.show(String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'), { time: time || 6000 }); } catch (e) {} }

    /** Убрать секреты и личное: тот же набор, что sanitize() в боте поддержки, плюс параметры адресов. */
    function clean(s) {
        s = String(s == null ? '' : s);
        s = s.replace(/\b\d{6,12}:[A-Za-z0-9_-]{30,}/g, '[токен бота]');
        s = s.replace(/\b(?:gsk_[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, '[ключ]');
        s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[почта]');
        s = s.replace(/\b[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}\b/g, '[код]');
        // адрес: оставляем сервер и путь, параметры (ключ аккаунта, id, токены) — нет
        s = s.replace(/(https?:\/\/[^\s?#"'<>]+)\?[^\s"'<>]*/g, '$1?…');
        s = s.replace(/(account_email|email|token|uid|cub_id|nws_id|unic_id|profile_id|key|password|secret)(["']?\s*[=:]\s*["']?)[^&"'\s,}]+/gi, '$1$2…');
        s = s.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, function (ip) {
            return /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) ? ip : ip.replace(/\.\d+$/, '.x');
        });
        return s;
    }
    function stamp() { return ((Date.now() - t0) / 1000).toFixed(0) + 's '; }
    /* Служебный шум Lampa (сотни строк при каждом запуске: хранилище, экран загрузки, премьеры) вытеснил бы из журнала
     * то, что нужно. Ошибки (warn/error) пишем всегда. */
    var NOISE = /^(\[(StorageWorker|LoadingProgress|Premiere|Timetable|DB|Script|Ad|Socket|Lang|Shots)\]|LoadingProgress )/;
    /** Объект в строку — дёшево: ТВ медленный, а Lampa пишет в консоль целые карточки фильмов. */
    function brief(a) {
        if (a instanceof Error) return a.message || String(a);
        if (Object.prototype.toString.call(a) === '[object Array]') return '[' + a.length + ']';
        var keys = [];
        try { for (var k in a) { if (keys.length >= 6) { keys.push('…'); break; } var v = a[k]; keys.push(k + (v === null || typeof v !== 'object' && typeof v !== 'function' ? ':' + String(v).slice(0, 40) : '')); } } catch (e) {}
        return '{' + keys.join(', ') + '}';
    }
    function add(kind, args) {
        if (!kind && typeof args[0] === 'string' && NOISE.test(args[0])) return;
        var parts = [];
        for (var i = 0; i < args.length; i++) {
            var a = args[i];
            if (a && typeof a === 'object') a = brief(a);
            parts.push(String(a));
        }
        var text = parts.join(' ').replace(/\s+/g, ' ');
        if (!text) return;
        if (text.length > LINE_MAX) text = text.slice(0, LINE_MAX) + '…';
        var last = lines[lines.length - 1];
        if (last && last.text === text) { last.n++; return; }
        lines.push({ at: stamp(), kind: kind, text: text, n: 1 });
        if (lines.length > LOG_MAX) lines.shift();
    }
    (function hook() {
        var c = window.console;
        if (!c || c.__bsReport) return;
        ['log', 'warn', 'error'].forEach(function (k) {
            var orig = c[k];
            if (typeof orig !== 'function') return;
            c[k] = function () {
                try { add(k === 'log' ? '' : k.toUpperCase() + ' ', arguments); } catch (e) {}
                return orig.apply(c, arguments);
            };
        });
        c.__bsReport = true;
        try {
            window.addEventListener('error', function (e) { add('ОШИБКА ', [(e && e.message) || 'error', e && e.filename ? String(e.filename).split('/').pop() + ':' + e.lineno : '']); });
            window.addEventListener('unhandledrejection', function (e) { add('ОШИБКА ', ['promise', e && e.reason && (e.reason.message || e.reason)]); });
        } catch (e) {}
    })();

    function logText() {
        return lines.map(function (l) { return l.at + l.kind + l.text + (l.n > 1 ? '  ×' + l.n : ''); }).join('\n');
    }

    function tvModel() {
        var m = lsGet('bs_tv_model') || '';
        try { if (!m && window.webapis && webapis.productinfo) m = webapis.productinfo.getRealModel() || webapis.productinfo.getModel(); } catch (e) {}
        return m;
    }
    function tizenVer() { try { return tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version'); } catch (e) { return ''; } }
    function lampaVer() { try { return typeof bsRunningVersion === 'function' ? bsRunningVersion() : (Lampa.Manifest.app_version || ''); } catch (e) { return ''; } }
    function pkgVer() { try { return tizen.application.getCurrentApplication().appInfo.version; } catch (e) { return ''; } }
    function screen() {
        try { var a = Lampa.Activity.active(); return (a.component || (a.activity && a.activity.component) || '') + (a.movie ? ' · ' + (a.movie.name || a.movie.title || '') : ''); } catch (e) { return ''; }
    }
    /** Только наши настройки-переключатели и выбор (без токенов, ключей, имён). */
    function settings() {
        var out = [], skip = /report|checked|token|key|chat|owner|name|users|pin|invite|join|relay|seen|qwait|today|_at$|_id$|devname|model|ai_|hub_art|hub_turk|cache|upd|bw$|learn|forced|sent|subs|news/i;
        try {
            for (var i = 0; i < window.localStorage.length; i++) {
                var k = window.localStorage.key(i), v = lsGet(k);
                if (!/^bs_/.test(k) || skip.test(k) || v === null || v.length > 20) continue;
                out.push(k.replace(/^bs_/, '') + '=' + v);
            }
        } catch (e) {}
        return out.sort().join(', ');
    }
    function player() {
        var out = [];
        try { out.push('плеер Lampa: ' + Lampa.Storage.field('player')); } catch (e) {}
        try { if (window.BSSources && window.BSSources.mainId) out.push('главный источник: ' + window.BSSources.mainId()); } catch (e) {}
        try { if (Lampa.Player.opened()) out.push('сейчас открыт'); } catch (e) {}
        try {
            var cur = window.BSFix && BSFix.current && BSFix.current();
            if (cur) out.push('источник: ' + (cur.name || cur.balanser) + (cur.season ? ', сезон ' + cur.season : '') + (cur.episode ? ', серия ' + cur.episode : ''));
        } catch (e) {}
        try { var st = window.BSGuard && BSGuard._state && BSGuard._state(); if (st) out.push('сторож: шаг ' + st.steps + (st.everPlayed ? ', видео шло' : ', видео не пошло')); } catch (e) {}
        return out.join('; ');
    }
    function device() {
        var id = lsGet('bs_report_dev');
        if (!id) {
            id = '';
            while (id.length < 16) id += Math.random().toString(36).slice(2);
            id = id.slice(0, 16);
            lsSet('bs_report_dev', id);
        }
        return id;
    }

    /** Отчёт целиком (то, что уходит). */
    function build(kind, title, net) {
        var diag = '';
        try { if (window.BSFix && BSFix.diagText) diag = BSFix.diagText(); } catch (e) {}
        var log = clean(logText() + (diag ? '\n\n' + diag : ''));
        if (log.length > SEND_MAX) log = '…\n' + log.slice(log.length - SEND_MAX);
        return {
            v: 1, kind: kind, title: title, device: device(),
            meta: {
                tv: clean(tvModel()), tizen: tizenVer(), sunic: String(window.BS_REMOTE_VERSION || pkgVer() || (typeof BS_PACKAGE_VERSION !== 'undefined' ? BS_PACKAGE_VERSION : '')), pkg: pkgVer(), lampa: lampaVer(),
                screen: clean(screen()).slice(0, 120), player: clean(player()).slice(0, 300), settings: settings().slice(0, 1500),
                online: navigator.onLine !== false, net: net ? net.text : '', uptime: Math.round((Date.now() - t0) / 60000) + ' мин'
            },
            log: log
        };
    }

    /* ---------- проверка связи перед отчётом ----------
     * Частая причина «ничего не грузится» — провайдер не пускает к серверам (TMDB, Skaz, byskaz), а интернет есть.
     * Тогда подсказка сразу на экране (DNS 1.1.1.1), а результат — в отчёт. Ответил сервер хоть чем-то (любой код HTTP) —
     * связь есть; status 0 (сеть не пустила, таймаут) — нет. Пакет Tizen разрешает запросы к любым адресам (<access *>).
     * Кроме Skaz проверяем и включённые источники на выбор — зритель мог сделать главным другой. */
    var NET_WAIT = 6000;
    var PROBES = [
        ['internet', 'интернет', ['https://connectivitycheck.gstatic.com/generate_204', 'https://1.1.1.1/cdn-cgi/trace']],
        ['tmdb', 'TMDB', ['https://api.themoviedb.org/3/configuration', 'http://imagetmdb.com/']],
        ['skaz', 'Skaz', ['http://skaz.tv/ping.js']],
        ['byskaz', 'byskaz', ['http://lampa.byskaz.ru/lampainit.js']]
    ];
    function reach(url, cb) {
        var x = new XMLHttpRequest(), done = false, t = Date.now();
        var fin = function (ok) { if (done) return; done = true; cb(ok, Date.now() - t); };
        try {
            x.open('HEAD', url, true);
            x.timeout = NET_WAIT;
            x.onload = function () { fin(x.status > 0); };
            x.onerror = x.ontimeout = x.onabort = function () { fin(false); };
            x.send();
        } catch (e) { fin(false); }
    }
    /** cb({internet, tmdb, skaz, byskaz, text, blocked: [имена], offline}) — все проверки сразу, не дольше NET_WAIT. */
    /** Что проверять: интернет, TMDB, Skaz, byskaz и каждый включённый источник на выбор (bssources.js: Z01, Online Mod…). */
    function probes() {
        var out = PROBES.slice();
        try {
            ((window.BSSources && window.BSSources.list) || []).forEach(function (src) {
                if (lsGet(src.key) === 'true' && src.url) out.push([src.id, src.name, [src.url]]);
            });
        } catch (e) {}
        return out;
    }
    function netCheck(cb) {
        var list = probes(), res = {}, left = list.length, ended = false;
        var end = function () {
            if (ended) return;
            ended = true;
            var blocked = [], parts = [];
            list.forEach(function (p) {
                var r = res[p[0]];
                parts.push(p[1] + (r && r.ok ? ' ✓' : ' ✗'));
                if (p[0] !== 'internet' && !(r && r.ok)) blocked.push(p[1]);
            });
            var internet = !!(res.internet && res.internet.ok);
            cb({ internet: internet, offline: !internet && blocked.length === list.length - 1, blocked: internet ? blocked : [], text: parts.join(', ') });
        };
        list.forEach(function (p) {
            var urls = p[2], i = 0;
            (function next() {
                reach(urls[i], function (ok, ms) {
                    if (!ok && ++i < urls.length) return next();
                    res[p[0]] = { ok: ok, ms: ms };
                    if (--left === 0) end();
                });
            })();
        });
        setTimeout(end, NET_WAIT * 2 + 500);
    }
    /** Подсказка по итогам проверки или ''. */
    function netHint(net) {
        if (!net) return '';
        if (net.offline) return 'Нет интернета — проверьте подключение ТВ к сети (Wi-Fi или кабель).';
        if (net.blocked.length) return 'Похоже, провайдер не пускает к ' + net.blocked.join(', ') + '. Попробуйте в настройках ТВ: Общие → Сеть → Состояние сети → Настройки IP → DNS → вручную 1.1.1.1. Не помогло — отправьте отчёт.';
        return '';
    }

    function post(url, body, cb) {
        var x = new XMLHttpRequest(), done = false;
        var fin = function (st, text) { if (done) return; done = true; cb(st, text); };
        try {
            x.open('POST', url, true);
            x.timeout = 15000;
            x.setRequestHeader('Content-Type', 'text/plain');            // без предзапроса CORS
            x.onload = function () { fin(x.status, x.responseText || ''); };
            x.onerror = x.ontimeout = function () { fin(0, ''); };
            x.send(body);
        } catch (e) { fin(0, ''); }
    }
    /** Отправить: Worker, не ответил — ntfy. cb({ok, number, url, queued}) */
    function send(rep, cb) {
        var body = JSON.stringify(rep);
        post(WORKER, body, function (st, text) {
            var j = null;
            try { j = JSON.parse(text); } catch (e) {}
            if (st === 200 && j && j.ok) return cb({ ok: true, number: j.number, url: j.url, dup: !!j.dup });
            if (st === 429 || (j && j.error === 'limit')) return cb({ ok: false, limit: true });
            if (st >= 400 && st < 500) return cb({ ok: false });
            var i = 0;
            (function next() {
                if (i >= NTFY.length) return cb({ ok: false });
                post(NTFY[i++] + REPORT_TOPIC, body, function (s2) { if (s2 === 200) cb({ ok: true, queued: true }); else next(); });
            })();
        });
    }

    function back(ctrl) { return function () { try { Lampa.Modal.close(); } catch (e) {} try { Lampa.Controller.toggle(ctrl); } catch (e) {} }; }
    function result(res, ctrl) {
        if (!res.ok) return noty(res.limit ? 'Сегодня отчётов уже достаточно — напишите в группу t.me/sunicapps' : 'Не удалось отправить — проверьте интернет или напишите в группу t.me/sunicapps', 9000);
        lsSet('bs_report_at', String(Date.now()));
        var head = res.queued ? 'Отчёт отправлен — задача появится в течение 10 минут.'
            : (res.dup ? 'Такой отчёт уже есть — дополнил задачу №' : 'Отчёт отправлен — задача №') + res.number + '.';
        var link = res.url || 'https://t.me/sunicapps';
        var body = $('<div style="display:flex;align-items:center;padding:.5em 0">' +
            '<div class="bs-report__qr" style="width:11em;height:11em;background:#fff;padding:.6em;border-radius:.6em;flex:none;margin-right:1.5em"></div>' +
            '<div style="line-height:1.5"><p></p><p>Ответ придёт в задаче и в группе t.me/sunicapps. Наведите камеру телефона на QR-код, чтобы следить.</p>' +
            '<p style="opacity:.7" class="bs-report__link"></p></div></div>');
        body.find('p').first().text(head);
        body.find('.bs-report__link').text(link);
        try { Lampa.Utils.qrcode(link, body.find('.bs-report__qr')[0]); } catch (e) {}
        try { Lampa.Modal.open({ title: 'Спасибо!', html: body, size: 'medium', onBack: back(ctrl) }); } catch (e) { noty(head); }
    }

    function open() {
        var ctrl = 'settings_component';
        try { ctrl = Lampa.Controller.enabled().name; } catch (e) {}
        var last = +(lsGet('bs_report_at') || 0);
        if (Date.now() - last < GAP) return noty('Отчёт уже отправлен недавно — подождите несколько минут', 6000);
        Lampa.Select.show({
            title: 'Что случилось?',
            items: KINDS.map(function (k) { return { title: k[1], kind: k[0] }; }),
            onBack: function () { try { Lampa.Controller.toggle(ctrl); } catch (e) {} },
            onSelect: function (it) {
                try { Lampa.Controller.toggle(ctrl); } catch (e) {}
                noty('Проверяю связь с серверами…', NET_WAIT * 2);
                netCheck(function (net) {
                    try { $('.noty').removeClass('noty--visible'); } catch (e) {}
                    confirm(it, net, ctrl);
                });
            }
        });
    }

    function confirm(it, net, ctrl) {
        var hint = netHint(net), items = [];
        if (hint) items.push({ title: net.offline ? '⚠️ Нет интернета' : '⚠️ Не открывается: ' + net.blocked.join(', '), subtitle: hint, hint: true });
        items.push({ title: 'Отправить отчёт', send: true, subtitle: 'Модель ТВ, версии, проверка связи, журнал ошибок. Без паролей, ключей и личных данных.' });
        items.push({ title: 'Отмена' });
        Lampa.Select.show({
            title: it.title,
            items: items,
            onBack: function () { try { Lampa.Controller.toggle(ctrl); } catch (e) {} },
            onSelect: function (a) {
                if (a.hint) return confirm(it, net, ctrl);             // подсказка — просто текст, меню остаётся
                try { Lampa.Controller.toggle(ctrl); } catch (e) {}
                if (!a.send) return;
                noty('Отправляю отчёт…', 15000);
                send(build(it.kind, it.title, net), function (res) {
                    try { $('.noty').removeClass('noty--visible'); } catch (e) {}
                    result(res, ctrl);
                });
            }
        });
    }

    return { open: open, _netCheck: netCheck, _netHint: netHint, _clean: clean, _build: build, _send: send, _add: add, _lines: function () { return lines; }, KINDS: KINDS, TOPIC: REPORT_TOPIC };
})();
