/*
 * Отладочный журнал для телевизора: консоль, ошибки, отказы Promise и снимки состояния Lampa
 * отправляются по локальной сети на компьютер разработчика (tools/debug/logserver.py).
 * Подключается только в отладочной сборке (pack.py --debug).
 */
(function () {
    var URL = 'http://__BS_LOG_HOST__:8799/log';
    var queue = [], t0 = Date.now(), seq = 0;

    function stringify(v) {
        if (typeof v === 'string') return v;
        if (v instanceof Error) return (v.name || 'Error') + ': ' + v.message + (v.stack ? '\n' + v.stack : '');
        try { return JSON.stringify(v); } catch (e) { return String(v); }
    }

    function log(kind, args) {
        var parts = [];
        for (var i = 0; i < args.length; i++) parts.push(stringify(args[i]));
        // почта, токены и id аккаунта в журнал не попадают
        var text = parts.join(' ').replace(/(account_email|email|token|uid|cub_id|nws_id|unic_id|profile_id|aesgcmkey|X-Kit-AesGcm)(["']?\s*[=:]\s*["']?)[^&"'\s,}]*/gi, '$1$2…')
            .replace(/\/bot\d+:[\w-]+/g, '/bot…').replace(/\b\d{6,12}:[A-Za-z0-9_-]{30,}/g, '…')   // токен Telegram-бота
            .replace(/AIza[\w-]{30,}/g, 'AIza…').replace(/AQ\.[\w.-]{30,}/g, 'AQ.…').replace(/gsk_\w{20,}/g, 'gsk_…').replace(/sk-or-[\w-]{20,}/g, 'sk-or-…');                                                      // ключ Gemini
        queue.push('[' + ((Date.now() - t0) / 1000).toFixed(1) + 's] ' + kind + ' ' + text.substring(0, 2000));
    }

    function flush() {
        if (!queue.length) return;
        var body = queue.join('\n');
        queue = [];
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', URL + '?n=' + (seq++), true);
            xhr.setRequestHeader('Content-Type', 'text/plain');
            xhr.send(body);
        } catch (e) {}
    }

    ['log', 'info', 'warn', 'error', 'debug'].forEach(function (m) {
        var orig = console[m];
        console[m] = function () {
            log(m.toUpperCase(), arguments);
            if (orig) try { orig.apply(console, arguments); } catch (e) {}
        };
    });

    /* ---- Сеть: XHR, fetch, WebSocket, <script>. Нужны, чтобы увидеть, где «висят» источники. ---- */
    function short(u) { u = String(u || ''); return u.length > 220 ? u.substring(0, 220) + '…' : u; }
    function isOwn(u) { return String(u).indexOf(':8799/log') >= 0; }

    (function () {
        var XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (m, u) { this.__bs = { m: m, u: u }; return XO.apply(this, arguments); };
        XMLHttpRequest.prototype.send = function () {
            var x = this, info = x.__bs || {}, t = Date.now();
            if (info.u && !isOwn(info.u)) {
                log('XHR>', [info.m, short(String(info.u).replace(/\/bot\d+:[\w-]+\//, '/bot***/'))]);
                var fin = function (kind) {
                    return function () {
                        var len = 0; try { len = (x.responseText || '').length; } catch (e) {}
                        log('XHR<', [kind, x.status, (Date.now() - t) + 'ms', len + 'b', short(info.u)]);
                        if (/\/lite\/|\/lifeevents/.test(info.u)) { var head = ''; try { head = (x.responseText || '').substring(0, 240); } catch (e) {} log('XHR body', [head]); }
                    };
                };
                x.addEventListener('load', fin('load'));
                x.addEventListener('error', fin('ERROR'));
                x.addEventListener('timeout', fin('TIMEOUT'));
                x.addEventListener('abort', fin('abort'));
            }
            return XS.apply(this, arguments);
        };
    })();

    if (window.fetch) {
        var F = window.fetch;
        window.fetch = function (input, init) {
            var u = typeof input === 'string' ? input : (input && input.url), t = Date.now();
            log('FETCH>', [(init && init.method) || 'GET', (init && init.mode) || '', short(u)]);
            return F.apply(this, arguments).then(function (r) {
                log('FETCH<', [r.status, r.type, (Date.now() - t) + 'ms', short(u)]);
                return r;
            }, function (e) {
                log('FETCH<', ['ERROR', e && e.message, (Date.now() - t) + 'ms', short(u)]);
                throw e;
            });
        };
    }

    if (window.WebSocket) {
        var WS = window.WebSocket;
        var Wrapped = function (url, protocols) {
            var ws = protocols !== undefined ? new WS(url, protocols) : new WS(url), n = 0, t = Date.now();
            log('WS>', [short(url)]);
            ws.addEventListener('open', function () { log('WS open', [(Date.now() - t) + 'ms', short(url)]); });
            ws.addEventListener('error', function () { log('WS ERROR', [short(url)]); });
            ws.addEventListener('close', function (e) { log('WS close', [e.code, e.reason, 'msgs=' + n, short(url)]); });
            ws.addEventListener('message', function (e) {
                n++;
                if (n <= 30) log('WS msg', [String(e.data).substring(0, 300)]);
            });
            var send = ws.send;
            ws.send = function (d) { log('WS send', [String(d).substring(0, 300)]); return send.apply(ws, arguments); };
            return ws;
        };
        Wrapped.prototype = WS.prototype;
        Wrapped.CONNECTING = 0; Wrapped.OPEN = 1; Wrapped.CLOSING = 2; Wrapped.CLOSED = 3;
        window.WebSocket = Wrapped;
    }

    document.addEventListener('error', function (e) {
        var el = e.target;
        if (el && el.tagName === 'SCRIPT') log('SCRIPT ERROR', [short(el.src)]);
    }, true);

    window.addEventListener('error', function (e) {
        log('WINDOW_ERROR', [e.message + ' @ ' + e.filename + ':' + e.lineno + ':' + e.colno, e.error && e.error.stack ? e.error.stack : '']);
    }, true);

    window.addEventListener('unhandledrejection', function (e) {
        log('UNHANDLED_REJECTION', [e.reason]);
    });

    function snapshot() {
        var st = document.querySelector('.lp-step'), ss = document.querySelector('.lp-status');
        var ls = {};
        try {
            ['language', 'lampac_initiale', 'platform', 'source', 'skaz_domain', 'bs_version', 'keyboard_type'].forEach(function (k) { ls[k] = localStorage.getItem(k); });
            ls._keys = localStorage.length;
            var size = 0;
            for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); size += k.length + (localStorage.getItem(k) || '').length; }
            ls._chars = size;
        } catch (e) { ls._err = e.message; }
        log('SNAPSHOT', [{
            step: st ? st.textContent : null,
            status: ss ? ss.textContent : null,
            appready: !!window.appready,
            prepared: !!window.prepared_app,
            lampa: typeof window.Lampa,
            tizen: typeof window.tizen,
            webapis: typeof window.webapis,
            loc: location.href,
            ls: ls,
            scripts: Array.prototype.map.call(document.scripts, function (s) { return s.src ? s.src.split('/').slice(-2).join('/') : 'inline'; }).join(','),
            bs_status: (document.getElementById('bs-status') || {}).textContent,
            bs_error: (document.getElementById('bs-error') || {}).textContent
        }]);
    }

    log('START', [navigator.userAgent, 'screen ' + screen.width + 'x' + screen.height, 'inner ' + window.innerWidth + 'x' + window.innerHeight]);
    try {
        if (typeof tizen !== 'undefined') {
            tizen.systeminfo.getPropertyValue('BUILD', function (b) { log('BUILD', [b.model, b.buildVersion]); });
        }
    } catch (e) { log('BUILD_ERR', [e.message]); }
    try { if (typeof webapis !== 'undefined' && webapis.productinfo) log('PRODUCT', [webapis.productinfo.getModel(), webapis.productinfo.getFirmware()]); } catch (e) { log('PRODUCT_ERR', [e.message]); }

    /* Разделы настроек: при открытии — список видимых пунктов (имя, ключ, значение), чтобы проверить их без экрана. */
    var settingsHook = setInterval(function () {
        var L = window.Lampa;
        if (!L || !L.Settings || !L.Settings.listener) return;
        clearInterval(settingsHook);
        L.Settings.listener.follow('open', function (e) {
            setTimeout(function () {
                try {
                    var rows = [];
                    e.body.find('.settings-param, .settings-param-title, .settings-folder').each(function () {
                        var el = window.$(this), hidden = el.hasClass('hide') || el.is(':hidden');
                        if (hidden) return;
                        var t = el.hasClass('settings-param-title') ? '## ' + el.text().trim()
                            : el.hasClass('settings-folder') ? '[раздел] ' + el.find('.settings-folder__name').text().trim() + ' (' + (el.attr('data-component') || '') + ')'
                            : el.find('.settings-param__name').text().trim() + ' {' + (el.attr('data-name') || '') + '} = ' + el.find('.settings-param__value').text().trim();
                        rows.push(t);
                    });
                    log('SETTINGS ' + e.name, [rows.join(' | ')]);
                    flush();
                } catch (x) { log('SETTINGS_ERR', [x.message]); }
            }, 300);
        });
    }, 1000);

    // Питание: что доступно приложению на этом ТВ (для «выключить ТВ после фильма»)
    var snaps = 0;
    var timer = setInterval(function () {
        snapshot();
        flush();
        if (++snaps > 60) { if (window.appready) { snapshot(); flush(); } clearInterval(timer); setInterval(flush, 3000); }
    }, 2000);
    setTimeout(flush, 300);
})();
