/*
 * Совместимость новой Lampa со старыми телевизорами Samsung (Tizen 2.4–4.0, Chromium 38–56).
 * Lampa 3.x вызывает document.body.append(...) на первом же шаге («Подготовка») — в Chromium < 54
 * этого метода нет, и загрузка обрывается. Здесь добавлено то, чего нет в старых браузерах.
 * Всё ставится только если метода нет, на новых ТВ файл ничего не меняет.
 */
(function () {
    function def(obj, name, fn) {
        if (!obj || obj[name]) return;
        try { Object.defineProperty(obj, name, { value: fn, configurable: true, writable: true, enumerable: false }); }
        catch (e) { obj[name] = fn; }
    }

    function toNode(args) {
        if (args.length === 1) return args[0] instanceof Node ? args[0] : document.createTextNode(String(args[0]));
        var frag = document.createDocumentFragment();
        for (var i = 0; i < args.length; i++) {
            frag.appendChild(args[i] instanceof Node ? args[i] : document.createTextNode(String(args[i])));
        }
        return frag;
    }

    /* ---- DOM ---- */
    var parents = [window.Element && Element.prototype, window.Document && Document.prototype, window.DocumentFragment && DocumentFragment.prototype];
    for (var p = 0; p < parents.length; p++) {
        def(parents[p], 'append', function () { this.appendChild(toNode(arguments)); });
        def(parents[p], 'prepend', function () { this.insertBefore(toNode(arguments), this.firstChild); });
    }

    var children = [window.Element && Element.prototype, window.CharacterData && CharacterData.prototype, window.DocumentType && DocumentType.prototype];
    for (var c = 0; c < children.length; c++) {
        def(children[c], 'remove', function () { if (this.parentNode) this.parentNode.removeChild(this); });
        def(children[c], 'before', function () { if (this.parentNode) this.parentNode.insertBefore(toNode(arguments), this); });
        def(children[c], 'after', function () { if (this.parentNode) this.parentNode.insertBefore(toNode(arguments), this.nextSibling); });
        def(children[c], 'replaceWith', function () { if (this.parentNode) this.parentNode.replaceChild(toNode(arguments), this); });
    }

    var EP = window.Element && Element.prototype;
    if (EP) {
        def(EP, 'matches', EP.webkitMatchesSelector || EP.msMatchesSelector);
        def(EP, 'closest', function (sel) {
            var el = this;
            while (el && el.nodeType === 1) { if (el.matches(sel)) return el; el = el.parentElement || el.parentNode; }
            return null;
        });
        def(EP, 'toggleAttribute', function (name, force) {
            var has = this.hasAttribute(name);
            if (force === undefined) force = !has;
            if (force) this.setAttribute(name, ''); else this.removeAttribute(name);
            return force;
        });
    }

    if (window.NodeList) def(NodeList.prototype, 'forEach', Array.prototype.forEach);
    if (window.HTMLCollection) def(HTMLCollection.prototype, 'forEach', Array.prototype.forEach);

    if (typeof window.CustomEvent !== 'function') {
        var CE = function (type, params) {
            params = params || {};
            var e = document.createEvent('CustomEvent');
            e.initCustomEvent(type, !!params.bubbles, !!params.cancelable, params.detail);
            return e;
        };
        CE.prototype = window.Event.prototype;
        window.CustomEvent = CE;
    }

    /* ---- Object ---- */
    def(Object, 'assign', function (target) {
        var to = Object(target);
        for (var i = 1; i < arguments.length; i++) {
            var src = arguments[i];
            if (src == null) continue;
            for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) to[k] = src[k];
        }
        return to;
    });
    def(Object, 'values', function (o) { var r = []; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r.push(o[k]); return r; });
    def(Object, 'entries', function (o) { var r = []; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r.push([k, o[k]]); return r; });
    def(Object, 'fromEntries', function (list) {
        var o = {};
        var arr = Array.from ? Array.from(list) : list;
        for (var i = 0; i < arr.length; i++) o[arr[i][0]] = arr[i][1];
        return o;
    });

    /* ---- Array ---- */
    def(Array, 'from', function (src, fn, self) {
        var r = [], i;
        if (src == null) return r;
        if (typeof src.length === 'number') { for (i = 0; i < src.length; i++) r.push(src[i]); }
        else if (typeof src.forEach === 'function') { src.forEach(function (v) { r.push(v); }); }
        return fn ? r.map(fn, self) : r;
    });
    def(Array, 'of', function () { return Array.prototype.slice.call(arguments); });
    var AP = Array.prototype;
    def(AP, 'includes', function (v, from) {
        for (var i = from || 0; i < this.length; i++) if (this[i] === v || (v !== v && this[i] !== this[i])) return true;
        return false;
    });
    def(AP, 'find', function (fn, self) { for (var i = 0; i < this.length; i++) if (fn.call(self, this[i], i, this)) return this[i]; });
    def(AP, 'findIndex', function (fn, self) { for (var i = 0; i < this.length; i++) if (fn.call(self, this[i], i, this)) return i; return -1; });
    def(AP, 'fill', function (v, s, e) {
        var len = this.length; s = s || 0; e = e === undefined ? len : e;
        if (s < 0) s += len; if (e < 0) e += len;
        for (var i = s; i < e; i++) this[i] = v;
        return this;
    });
    def(AP, 'flat', function (depth) {
        depth = depth === undefined ? 1 : depth;
        var out = [];
        (function walk(a, d) {
            for (var i = 0; i < a.length; i++) {
                if (Array.isArray(a[i]) && d > 0) walk(a[i], d - 1); else out.push(a[i]);
            }
        })(this, depth);
        return out;
    });
    def(AP, 'flatMap', function (fn, self) { return AP.map.call(this, fn, self).flat(1); });

    /* ---- String / Number ---- */
    var SP = String.prototype;
    def(SP, 'includes', function (s, from) { return this.indexOf(s, from || 0) !== -1; });
    def(SP, 'startsWith', function (s, pos) { pos = pos || 0; return this.substr(pos, s.length) === s; });
    def(SP, 'endsWith', function (s, len) {
        len = len === undefined || len > this.length ? this.length : len;
        return this.substring(len - s.length, len) === s;
    });
    def(SP, 'repeat', function (n) { var r = ''; for (var i = 0; i < n; i++) r += this; return r; });
    function pad(str, len, fill, start) {
        str = String(str); fill = fill === undefined ? ' ' : String(fill);
        if (str.length >= len || !fill) return str;
        var add = '';
        while (add.length < len - str.length) add += fill;
        add = add.substring(0, len - str.length);
        return start ? add + str : str + add;
    }
    def(SP, 'padStart', function (len, fill) { return pad(this, len, fill, true); });
    def(SP, 'padEnd', function (len, fill) { return pad(this, len, fill, false); });
    def(SP, 'trimStart', SP.trimLeft || function () { return this.replace(/^\s+/, ''); });
    def(SP, 'trimEnd', SP.trimRight || function () { return this.replace(/\s+$/, ''); });
    def(SP, 'replaceAll', function (a, b) {
        if (a instanceof RegExp) return this.replace(a, b);
        return this.split(a).join(b);
    });
    def(Number, 'isNaN', function (v) { return typeof v === 'number' && v !== v; });
    def(Number, 'isFinite', function (v) { return typeof v === 'number' && isFinite(v); });
    def(Number, 'isInteger', function (v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; });
    def(Math, 'trunc', function (v) { return v < 0 ? Math.ceil(v) : Math.floor(v); });
    def(Math, 'sign', function (v) { v = +v; return v === 0 || v !== v ? v : (v > 0 ? 1 : -1); });

    /* ---- Пульт Samsung ----
     * Lampa регистрирует кнопки пульта на первом шаге. Если телевизор не выдал приложению
     * привилегию tv.inputdevice, вызов бросает исключение и загрузка обрывается. */
    try {
        if (typeof tizen !== 'undefined' && tizen.tvinputdevice && tizen.tvinputdevice.registerKey) {
            var input = tizen.tvinputdevice, reg = input.registerKey;
            var safe = function (key) {
                try { return reg.apply(input, arguments); } catch (e) { console.log('registerKey ' + key + ': ' + e.message); }
            };
            try { input.registerKey = safe; } catch (e) {}
            if (input.registerKey !== safe) {
                try { Object.defineProperty(input, 'registerKey', { value: safe, configurable: true, writable: true }); } catch (e) {}
            }
        }
    } catch (e) {}

    /* ---- AVPlay: тот же User-Agent, что у страницы ----
     * Ссылку на поток Lampa получает запросами страницы (с её User-Agent), а AVPlay
     * ходит за видео со своим. CDN части балансеров (interkh/lumex, Collaps и родня)
     * отдают сегменты только тому UA, которым была добыта ссылка, — иначе плеер
     * «подключается и висит». Lampa сама UA в AVPlay не передаёт, делаем это здесь. */
    try {
        if (typeof webapis !== 'undefined' && webapis.avplay && webapis.avplay.open && !webapis.avplay.open.__bs) {
            var av = webapis.avplay, avOpen = av.open;
            var openUA = function () {
                var r = avOpen.apply(av, arguments);
                try { av.setStreamingProperty('USER_AGENT', navigator.userAgent); } catch (e) { console.log('AVPlay USER_AGENT: ' + e.message); }
                // Буфер (настройка «Буфер плеера»): между open() и prepare — единственное место, где AVPlay его принимает.
                try {
                    // [до старта, после подгрузки], секунды. По умолчанию — «Сбалансировано» 4/8: у Samsung по умолчанию
                    // старт после 10 с буфера, а HLS-источники режут видео кусками по 6 с — это два куска (1080p ~9 МБ)
                    // до первого кадра вместо одного. Продолжение после остановки — с запасом 8 с.
                    var mode = window.localStorage.getItem('bs_buffer') || 'balanced';
                    var sec = mode === 'fast' ? [2, 6] : mode === 'balanced' ? [4, 8] : mode === 'reliable' ? [8, 15] : null;
                    if (sec && av.setBufferingParam) {
                        av.setBufferingParam('PLAYER_BUFFER_FOR_PLAY', 'PLAYER_BUFFER_SIZE_IN_SECOND', sec[0]);
                        av.setBufferingParam('PLAYER_BUFFER_FOR_RESUME', 'PLAYER_BUFFER_SIZE_IN_SECOND', sec[1]);
                    }
                } catch (e) { console.log('AVPlay buffer: ' + e.message); }
                return r;
            };
            openUA.__bs = true;
            try { av.open = openUA; } catch (e) {}
            if (av.open !== openUA) {
                try { Object.defineProperty(av, 'open', { value: openUA, configurable: true, writable: true }); } catch (e) {}
            }
        }
    } catch (e) {}

    /* ---- IndexedDB: ограничение времени на открытие базы ----
     * Lampa ждёт indexedDB.open без таймаута и без onblocked. На части телевизоров Samsung
     * запрос не отвечает вовсе — и загрузка висит на «Подготовке» без единой ошибки.
     * Отдаём Lampa обёртку запроса: если за 6 с нет ответа, сообщаем ошибку, и Lampa
     * продолжает без кэша (этот случай она обрабатывает сама). */
    try {
        var IDBF = window.IDBFactory && IDBFactory.prototype;
        if (IDBF && IDBF.open && !IDBF.open.__bs) {
            var realOpen = IDBF.open;
            var guarded = function () {
                var real = realOpen.apply(this, arguments);
                var fake = { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null,
                             result: null, error: null, readyState: 'pending', source: null, transaction: null };
                var listeners = {};
                fake.addEventListener = function (t, fn) { (listeners[t] = listeners[t] || []).push(fn); };
                fake.removeEventListener = function (t, fn) {
                    var l = listeners[t] || [];
                    for (var i = l.length - 1; i >= 0; i--) if (l[i] === fn) l.splice(i, 1);
                };
                var done = false;
                function emit(type, ev) {
                    ev = ev || {};
                    var e = { type: type, target: fake, currentTarget: fake, oldVersion: ev.oldVersion, newVersion: ev.newVersion,
                              preventDefault: function () {}, stopPropagation: function () {} };
                    if (typeof fake['on' + type] === 'function') { try { fake['on' + type](e); } catch (err) { console.log('idb ' + type + ': ' + err.message); } }
                    var l = (listeners[type] || []).slice();
                    for (var i = 0; i < l.length; i++) { try { l[i](e); } catch (err) {} }
                }
                var upgrading = false;
                real.onupgradeneeded = function (ev) {
                    upgrading = true; // база ответила, просто обновляет схему — таймаут не нужен
                    fake.result = real.result; fake.transaction = real.transaction;
                    emit('upgradeneeded', ev);
                };
                real.onsuccess = function (ev) {
                    if (done) { try { real.result.close(); } catch (e) {} return; }
                    done = true; fake.readyState = 'done'; fake.result = real.result;
                    emit('success', ev);
                };
                real.onerror = function (ev) {
                    if (done) return;
                    done = true; fake.readyState = 'done'; fake.error = real.error;
                    emit('error', ev);
                };
                real.onblocked = function (ev) { emit('blocked', ev); };
                setTimeout(function () {
                    if (done || upgrading) return;
                    done = true; fake.readyState = 'done';
                    fake.error = new Error('IndexedDB не ответил за 6 с');
                    window.bs_idb_timeout = true;
                    console.log('IndexedDB open timeout — продолжаем без кэша');
                    emit('error');
                }, 6000);
                return fake;
            };
            guarded.__bs = true;
            IDBF.open = guarded;
        }
    } catch (e) {}

    /* ---- URLSearchParams (упрощённый) ---- */
    if (typeof window.URLSearchParams !== 'function') {
        var USP = function (init) {
            this._l = [];
            if (typeof init === 'string') {
                var q = init.charAt(0) === '?' ? init.substring(1) : init;
                var parts = q ? q.split('&') : [];
                for (var i = 0; i < parts.length; i++) {
                    var kv = parts[i].split('=');
                    this._l.push([decodeURIComponent(kv[0].replace(/\+/g, ' ')), decodeURIComponent((kv[1] || '').replace(/\+/g, ' '))]);
                }
            } else if (init && typeof init === 'object') {
                for (var k in init) if (init.hasOwnProperty(k)) this._l.push([k, String(init[k])]);
            }
        };
        USP.prototype.get = function (k) { for (var i = 0; i < this._l.length; i++) if (this._l[i][0] === k) return this._l[i][1]; return null; };
        USP.prototype.has = function (k) { return this.get(k) !== null; };
        USP.prototype.set = function (k, v) { this['delete'](k); this._l.push([k, String(v)]); };
        USP.prototype.append = function (k, v) { this._l.push([k, String(v)]); };
        USP.prototype['delete'] = function (k) { this._l = this._l.filter(function (p) { return p[0] !== k; }); };
        USP.prototype.forEach = function (fn, self) { for (var i = 0; i < this._l.length; i++) fn.call(self, this._l[i][1], this._l[i][0], this); };
        USP.prototype.toString = function () {
            return this._l.map(function (p) { return encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1]); }).join('&');
        };
        window.URLSearchParams = USP;
    }
})();
