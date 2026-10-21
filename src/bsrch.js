/*
 * Защита от «вечной загрузки» источников Skaz, которым нужен RCH (Kinogo, Ashdi, UAkino, Lift, Lumina, ...).
 *
 * Как устроено у Skaz (onlines.js): сервер отвечает {rch:true, nws:...}, плагин открывает WebSocket
 * (NativeWsClient с online3.skaz.tv), ждёт 'Connected', регистрируется (RchRegistry), ждёт ответ
 * 'RchRegistry' и только тогда повторяет запрос. Таймаута и обработки ошибки на этом пути нет:
 * если сокет не открылся, оборвался или сервер не ответил — список источника крутится бесконечно,
 * а при выборе видео висит полноэкранная «Загрузка». В APK (Android) этого не видно: там сервер
 * сразу отвечает ошибкой, и плагин сам переходит к следующему источнику.
 *
 * Что делаем:
 *  - клиент Skaz загружаем заранее, и не только с online3 (если он не ответил — с 4/5/7);
 *  - каждому подключению даём CONNECT_LIMIT на 'Connected' (с одной повторной попыткой)
 *    и REGISTRY_LIMIT на ответ регистрации;
 *  - не уложились — закрываем сокет и отдаём ошибку штатному пути плагина: «Источник не ответил»
 *    и автопереход к следующему источнику (как в APK); если висела «Загрузка» видео — снимаем её.
 * Рабочий RCH на это не влияет: 'Connected' приходит за ~1 с, ответ регистрации — сразу за ним.
 */
var BSRch = (function () {
    var cfg = { CONNECT_LIMIT: 8000, REGISTRY_LIMIT: 8000, RETRIES: 1, SCRIPT_LIMIT: 6000 };
    var NWS_PATH = '/js/nws-client-es5.js?v18112025';
    var stats = { connects: 0, ok: 0, retries: 0, fails: 0, last: '', failAt: 0 };
    var loadingActive = false;

    function noty(t, time) { try { Lampa.Noty.show(t, { time: time || 6000 }); } catch (e) {} }
    // о переходе к следующему источнику плагин и так пишет на экране — нам хватит тихой строки в углу
    function quiet(t) { try { if (window.BSSkaz && BSSkaz.toast) return BSSkaz.toast(t); } catch (e) {} noty(t, 4000); }
    function log() { try { console.log.apply(console, ['BS rch'].concat([].slice.call(arguments))); } catch (e) {} }

    /** Компонент онлайн-источников на экране (lampacskaz и т.п.) или null. */
    function activeComponent() {
        try {
            var a = Lampa.Activity.active();
            var c = a && a.activity && a.activity.component;
            return c && typeof c.doesNotAnswer === 'function' ? c : null;
        } catch (e) { return null; }
    }

    /* Поколение экрана: растёт при любом итоге загрузки (список, заметка, пусто, ошибка).
     * Если за время ожидания RCH экран уже сменился (сам плагин показал итог, пользователь ушёл,
     * выбран другой источник) — нашу ошибку не показываем. */
    var MARKS = ['uiDraw', 'uiNote', 'uiSimilars', 'empty', 'doesNotAnswer', 'noConnectToServer', 'request'];
    function generation(c) {
        if (!c) return -1;
        if (!c.__bsGen) {
            c.__bsGen = 1;
            MARKS.forEach(function (name) {
                var orig = c[name];
                if (typeof orig !== 'function') return;
                c[name] = function () { c.__bsGen++; return orig.apply(this, arguments); };
            });
        }
        return c.__bsGen;
    }

    function fail(client, why) {
        if (client.__bsDone) return;
        client.__bsDone = true;
        stats.fails++; stats.last = why; stats.failAt = Date.now();
        log('fail', why);
        try { client.close(); } catch (e) {}
        var c = client.__bsComp;
        if (loadingActive) {
            // ждали ссылку на видео (getFileUrl) — снимаем «Загрузку», список источника остаётся
            try { Lampa.Loading.stop(); } catch (e) {}
            noty('Нет связи с сервером Skaz — выберите другой источник');
            return;
        }
        if (c && c === activeComponent() && generation(c) === client.__bsGen) {
            quiet('Источник не ответил — пробую следующий');
            try { c.doesNotAnswer({ timeout: true }); } catch (e) { log('doesNotAnswer', e); }
        }
    }

    /** Этот клиент ещё тот, через который плагин ждёт ответ (а не брошенный ради другого источника). */
    function current(client) {
        var all = window.nwsClient;
        if (!all) return true;
        for (var k in all) if (all[k] === client) return true;
        return false;
    }

    function arm(client, stage, ms) {
        clearTimeout(client.__bsTimer);
        client.__bsStage = stage;
        client.__bsTimer = setTimeout(function () {
            if (client.__bsDone) return;
            if (!current(client)) { client.__bsDone = true; return; }
            if (stage === 'connect' && client.__bsTries < retries()) {
                // сокет не открылся или закрылся — одна повторная попытка новым сокетом
                client.__bsTries++; stats.retries++;
                log('retry connect');
                try { if (client.socket) { client.socket.onclose = null; client.socket.close(); } } catch (e) {}
                client.socket = null;
                arm(client, 'connect', limit('CONNECT_LIMIT'));
                client.connect();
                return;
            }
            fail(client, stage === 'connect' ? 'нет Connected' : 'нет ответа RchRegistry');
        }, ms);
    }

    /* Если RCH только что не сработал, следующий RCH-источник почти наверняка тоже не сработает:
     * ждём вдвое меньше и без повтора, чтобы автопереход по источникам не тянулся минутами. */
    function recentFail() { return stats.failAt && Date.now() - stats.failAt < 180000; }
    function limit(name) { return recentFail() ? Math.round(cfg[name] / 2) : cfg[name]; }
    function retries() { return recentFail() ? 0 : cfg.RETRIES; }

    function playerNow() { try { return !!(Lampa.Player && Lampa.Player.opened && Lampa.Player.opened()); } catch (e) { return false; } }

    function wrapClient(Orig) {
        if (!Orig || !Orig.prototype || Orig.__bs) return Orig;
        Orig.__bs = true;
        var P = Orig.prototype, connect = P.connect, emit = P._emit, close = P.close;
        P.connect = function () {
            // клиент подключается заново (плагин переиспользует его для следующего фильма) — сторож снова нужен: без него
            // зависшее переподключение оставляло бы «Загрузку» навсегда. Во время видео не трогаем: там переподключение —
            // дело самого клиента, а наш отказ переключил бы источник посреди фильма.
            if (this.__bsDone && !playerNow()) { this.__bsDone = false; this.__bsArmed = false; }
            if (!this.__bsArmed && !this.__bsDone) {
                this.__bsArmed = true;
                this.__bsTries = 0;
                this.__bsComp = activeComponent();
                this.__bsGen = generation(this.__bsComp);
                stats.connects++;
                arm(this, 'connect', limit('CONNECT_LIMIT'));
            }
            var r = connect.apply(this, arguments), self = this, s = this.socket;
            if (s && !s.__bs) {
                s.__bs = true;
                var onclose = s.onclose;
                // сокет закрылся до конца регистрации — не ждём таймер: сразу повтор или ошибка
                s.onclose = function () {
                    if (onclose) onclose.apply(this, arguments);
                    if (!self.__bsDone && self.socket === s) arm(self, self.__bsStage, 0);
                };
            }
            return r;
        };
        P._emit = function (method) {
            if (this.__bsArmed && !this.__bsDone) {
                if (method === 'Connected') arm(this, 'registry', limit('REGISTRY_LIMIT'));
                else if (method === 'RchRegistry') { clearTimeout(this.__bsTimer); this.__bsDone = true; stats.ok++; stats.failAt = 0; }
            }
            return emit.apply(this, arguments);
        };
        P.close = function () { clearTimeout(this.__bsTimer); this.__bsDone = true; return close.apply(this, arguments); };
        return Orig;
    }

    // Плагин Skaz проверяет `typeof NativeWsClient` и иначе грузит клиент сам — перехватываем присвоение
    (function hookGlobal() {
        var current = window.NativeWsClient;
        try {
            Object.defineProperty(window, 'NativeWsClient', {
                configurable: true,
                get: function () { return current; },
                set: function (v) { current = wrapClient(v); }
            });
        } catch (e) { current = wrapClient(current); }
        if (current) wrapClient(current);
    })();

    function servers() {
        var cf = false;
        try { cf = Lampa.Storage.get('skazonline_servers') === true || Lampa.Storage.get('skazonline_servers') === 'true'; } catch (e) {}
        var p = cf ? 'onlinecf' : 'online';
        return [3, 4, 5, 7].map(function (n) { return 'http://' + p + n + '.skaz.tv' + NWS_PATH; });
    }

    /** Загрузить клиент Skaz по очереди с серверов; done(true/false). */
    function loadClient(done) {
        if (typeof window.NativeWsClient === 'function') return done(true);
        var list = servers(), i = 0;
        (function next() {
            if (typeof window.NativeWsClient === 'function') return done(true);
            if (i >= list.length) return done(false);
            var s = document.createElement('script'), fin = false;
            var end = function (ok) {
                if (fin) return; fin = true; clearTimeout(t);
                if (ok && typeof window.NativeWsClient === 'function') return done(true);
                try { s.parentNode && s.parentNode.removeChild(s); } catch (e) {}
                next();
            };
            var t = setTimeout(function () { end(false); }, cfg.SCRIPT_LIMIT);
            s.onload = function () { end(true); };
            s.onerror = function () { end(false); };
            s.src = list[i++];
            document.head.appendChild(s);
        })();
    }

    function hookLampa() {
        // «Загрузка» поверх экрана — признак, что ждут ссылку на видео
        try {
            var L = Lampa.Loading, st = L.start, sp = L.stop;
            L.start = function () { loadingActive = true; return st.apply(this, arguments); };
            L.stop = function () { loadingActive = false; return sp.apply(this, arguments); };
        } catch (e) {}
        // если плагин всё же грузит клиент сам (наш не загрузился) — с других серверов и с ошибкой
        try {
            var U = Lampa.Utils, put = U.putScript;
            U.putScript = function (items, complite, error, success) {
                var list = [].concat(items || []);
                if (list.length === 1 && /nws-client-es5\.js/.test(list[0]) && typeof success === 'function') {
                    loadClient(function (ok) {
                        if (ok) return success();
                        if (loadingActive) { try { Lampa.Loading.stop(); } catch (e) {} }
                        var c = activeComponent();
                        noty('Нет связи с сервером Skaz — выберите другой источник');
                        if (c && !loadingActive) { try { c.doesNotAnswer({ timeout: true }); } catch (e) {} }
                        if (typeof complite === 'function') complite();
                    });
                    return;
                }
                return put.apply(this, arguments);
            };
        } catch (e) {}
    }

    function start() {
        hookLampa();
        setTimeout(function () { loadClient(function (ok) { log('client', ok); }); }, 3000);
    }

    return { start: start, cfg: cfg, stats: stats, _wrapClient: wrapClient, _loadClient: loadClient };
})();
