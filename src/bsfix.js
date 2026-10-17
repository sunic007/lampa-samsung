/*
 * Исправления чужого кода (плагин онлайн-источников Skaz), без правки самих файлов: обёртки вокруг
 * компонентов, которые Lampa создаёт через Lampa.Component.create.
 *
 *  1. Качество объектом. Серверы Skaz отдают качества и строкой ({"1080p": "http://…"}), и объектом
 *     ({"1080p": {url: "http://…"}}) — Lampa понимает оба (PlayerPanel.setQualitys: qa.url). А
 *     setDefaultQuality в onlines.js зовёт data.quality[q].indexOf(…) и на объекте падает:
 *     «data.quality[q].indexOf is not a function» вместо фильма (KinoPub, 2026-10). На Android с внешним
 *     плеером этого не видно. Перед setDefaultQuality приводим значения к строкам-адресам.
 */
var BSFix = (function () {
    /** {q: строка | {url}} → {q: строка}; значения без адреса выбрасываем. Возвращает тот же объект. */
    function normQuality(qs) {
        if (!qs || typeof qs !== 'object') return qs;
        for (var q in qs) {
            if (!Object.prototype.hasOwnProperty.call(qs, q)) continue;
            var v = qs[q];
            if (typeof v === 'string') continue;
            if (v && typeof v === 'object' && typeof v.url === 'string' && v.url) qs[q] = v.url;
            else delete qs[q];
        }
        return qs;
    }

    var SKAZ_SRV = /^(https?:\/\/)(online|onlinecf)(\d+)(\.skaz\.tv\/)/i;
    /** Тот же адрес на следующем сервере Skaz из 3/4/5/7 или ''. */
    function otherServer(url) {
        var m = SKAZ_SRV.exec(String(url || ''));
        if (!m) return '';
        var list = ['3', '4', '5', '7'], i = list.indexOf(m[3]);
        return m[1] + m[2] + list[(i + 1) % list.length] + m[4] + String(url).slice(m[0].length);
    }

    /* Запасные адреса для ссылки на видео (по очереди).
     * HDRezka-премиум (rhsprem) и обычная Rezka у Skaz принимают одинаковые параметры серии (id, t — озвучка, s, e,
     * voice). 2026-10: rhsprem/movie — 503 на всех серверах (и в APK), online3 перед этим молчит до 23 с; rezka/movie —
     * ссылка за 0,1–0,3 с, но только на online3 (остальные 503). Поэтому для rhsprem: rezka на том же сервере, затем
     * rezka на online3. Для прочих источников — тот же запрос на следующем сервере. */
    function fallbacks(url) {
        url = String(url || '');
        if (url.indexOf('/lite/rhsprem/movie') > 0) {
            var rz = url.replace('/lite/rhsprem/movie', '/lite/rezka/movie');
            var on3 = rz.replace(SKAZ_SRV, function (all, pr, fam, n, rest) { return pr + fam + '3' + rest; });
            return on3 !== rz ? [rz, on3] : [rz];
        }
        var o = otherServer(url);
        return o ? [o] : [];
    }
    function fallbackUrl(url) { return fallbacks(url)[0] || ''; }
    // HDRezka-премиум отказала — серии сразу берём из Rezka, без 20 с ожидания на каждой
    // Запоминается и после выключения ТВ (localStorage); через 6 часов снова пробуем HDRezka — вдруг Skaz починил.
    var RHS_DOWN_MS = 6 * 3600000, HEDGE_MS = 6000, rhsDownUntil = 0;
    try { rhsDownUntil = parseInt(window.localStorage.getItem('bs_rhs_down') || '0', 10) || 0; } catch (e) {}
    function rhsDown() { rhsDownUntil = Date.now() + RHS_DOWN_MS; try { window.localStorage.setItem('bs_rhs_down', String(rhsDownUntil)); } catch (e) {} }
    function cloneFile(f) {
        var o = {}; for (var k in f) if (Object.prototype.hasOwnProperty.call(f, k)) o[k] = f[k];
        return o;
    }

    /* ---------- журнал запросов к серверам Skaz ---------- */
    // Отдельно — ссылки на видео (их немного, и их не должен вытеснять опрос lifeevents раз в секунду);
    // повторы одного и того же запроса подряд сворачиваются в одну строку «×N».
    var DIAG_MAX = 60, LINKS_MAX = 12, diag = [], links = [], t0 = Date.now();
    function mask(t) {
        return String(t).replace(/(account_email|email|token|uid|cub_id|nws_id|unic_id|profile_id)((?:%22|\\?["'])?\s*(?:[=:]|%3A|%3D)\s*(?:%22|\\?["'])?)(?:(?!%22)[^&"'\s,}\\])*/gi, '$1$2…');
    }
    function stamp() { return ((Date.now() - t0) / 1000).toFixed(0) + 's '; }
    function diagAdd(line, key) {
        var last = diag[diag.length - 1];
        if (key && last && last.key === key) { last.n++; last.text = stamp() + mask(line); return; }
        diag.push({ key: key || '', n: 1, text: stamp() + mask(line) });
        if (diag.length > DIAG_MAX) diag.shift();
    }
    function linkAdd(line) {
        links.push(stamp() + mask(line));
        if (links.length > LINKS_MAX) links.shift();
    }
    function shortUrl(u) {
        return String(u).replace(/^https?:\/\//, '').replace(/[?&](title|original_title|original_language|similar|source|serial|year|rjson|kinopoisk_id|imdb_id|clarification|cub_id|account_email|uid|token)=[^&]*/g, '').slice(0, 150);
    }
    /** Что вернул сервер на запрос ссылки — коротко. */
    function linkResult(json) {
        if (!json) return 'НЕТ ОТВЕТА (ошибка/таймаут или rch без подключения)';
        if (json.url) return 'ссылка есть: ' + String(json.url).slice(0, 60);
        try { return 'без ссылки: ' + JSON.stringify(json).slice(0, 140); } catch (e) { return 'без ссылки'; }
    }
    (function hookXhr() {
        var XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (m, u) { this.__bsd = /skaz\.tv\/(lite|lifeevents|rch)\b/i.test(String(u)) ? String(u) : ''; return XO.apply(this, arguments); };
        XMLHttpRequest.prototype.send = function () {
            var x = this, u = x.__bsd, t = Date.now();
            if (u) {
                var short = shortUrl(u), key = short.replace(/\?.*$/, '');
                var done = function (kind) {
                    return function () {
                        var head = ''; try { head = (x.responseText || '').replace(/\s+/g, ' ').slice(0, 90); } catch (e) {}
                        diagAdd(kind + ' ' + x.status + ' ' + (Date.now() - t) + 'мс ' + short + (kind === 'ok' ? ' → ' + head : ''), kind + key);
                    };
                };
                try {
                    x.addEventListener('load', done('ok'));
                    x.addEventListener('error', done('ОШИБКА'));
                    x.addEventListener('timeout', done('ТАЙМАУТ'));
                    x.addEventListener('abort', done('прервано'));
                } catch (e) {}
            }
            return XS.apply(this, arguments);
        };
    })();

    function showDiag() {
        var rch = window.BSRch ? BSRch.stats : null, bw = null;
        try { bw = JSON.parse(lsGetFix('bs_bw') || 'null'); } catch (e) {}
        var text = 'ССЫЛКИ НА ВИДЕО (новые сверху):\n' + (links.length ? links.slice().reverse().join('\n') : '— ещё не запрашивались') +
            (bw && bw.bps ? '\n\nСкорость канала (замер плеера): ~' + Math.round(bw.bps / 1e6) + ' Мбит/с, замеров ' + bw.n : '') +
            (rch ? '\n\nRCH: подключений ' + rch.connects + ', удачных ' + rch.ok + ', сбоев ' + rch.fails + (rch.last ? ' (' + rch.last + ')' : '') : '') +
            '\n\nВСЕ ЗАПРОСЫ К SKAZ (новые сверху):\n' +
            (diag.length ? diag.slice().reverse().map(function (d) { return d.text + (d.n > 1 ? '  ×' + d.n : ''); }).join('\n') : '— не было');
        var body = $('<div style="font-family:monospace;font-size:.7em;line-height:1.3;white-space:pre-wrap;word-break:break-all;padding:0 1em;max-width:100%;box-sizing:border-box"></div>').text(text);
        var ctrl = Lampa.Controller.enabled().name;
        Lampa.Modal.open({
            title: 'Запросы источников — новые сверху', html: body, size: 'large',
            onBack: function () { Lampa.Modal.close(); Lampa.Controller.toggle(ctrl); }
        });
    }

    /* Качество под скорость канала. Lampa у byskaz стартует в 2160p, а источники Skaz отдают каждое качество отдельной
     * ссылкой — без автоподстройки: на медленном канале 4K грузится долго и потом встаёт. Если известна скорость канала
     * (bs_bw — замеры AVPlay во время прошлых просмотров, не старше недели) и выбранное качество в неё не помещается,
     * стартуем в ближайшем посильном. Скорость неизвестна или её хватает — ничего не меняем.
     * Битрейты — типичные для источников Skaz (замер 2026-10: 1080p HLS ≈ 4,5–6 Мбит/с, 720p ≈ 3 Мбит/с; запас 30% на колебания канала). */
    var NOMINAL = { 2160: 16e6, 1440: 10e6, 1080: 5e6, 720: 3.5e6, 480: 1.6e6, 360: 0.9e6 };
    function qualityNum(label) {
        var t = String(label || '');
        if (/4k|uhd/i.test(t)) return 2160;
        var m = /(\d{3,4})/.exec(t);
        return m ? parseInt(m[1], 10) : 0;
    }
    function nominal(n) {
        var best = 0;
        for (var k in NOMINAL) if (n >= +k) best = Math.max(best, NOMINAL[k]);
        return best || NOMINAL[360];
    }
    function urlOf(v) { return v && typeof v === 'object' ? v.url : v; }
    /** Ключ качества для старта или '' (менять не нужно). quality — {метка: адрес}, current — выбранный адрес. */
    function pickQuality(quality, current, bps) {
        if (!quality || !bps) return '';
        var budget = bps * 0.7, cur = '', list = [];
        for (var k in quality) if (Object.prototype.hasOwnProperty.call(quality, k)) {
            var n = qualityNum(k);
            if (!n) continue;
            list.push({ k: k, n: n });
            if (urlOf(quality[k]) === current) cur = k;
        }
        if (!cur || nominal(qualityNum(cur)) <= budget) return '';
        list.sort(function (a, b) { return b.n - a.n; });
        for (var i = 0; i < list.length; i++) if (list[i].n < qualityNum(cur) && nominal(list[i].n) <= budget) return list[i].k;
        var lowest = list[list.length - 1];
        return lowest && lowest.k !== cur ? lowest.k : '';
    }
    function knownBandwidth() {
        if (lsGetFix('bs_bw_quality') === 'false') return 0;
        // v:2 — замеры с отсевом «полного буфера» (1.6.12); старые (1.6.11) могли быть занижены у MP4. Меньше 3 замеров — мало.
        try { var b = JSON.parse(lsGetFix('bs_bw') || 'null'); return b && b.v === 2 && b.n >= 3 && b.bps && Date.now() - b.at < 7 * 86400000 ? b.bps : 0; } catch (e) { return 0; }
    }
    /** Номинальный битрейт качества, которое сейчас играет (0 — не знаем). */
    function playingBitrate() {
        try {
            var d = Lampa.Player.playdata();
            if (!d || !d.quality) return 0;
            for (var q in d.quality) if (urlOf(d.quality[q]) === d.url && qualityNum(q)) return nominal(qualityNum(q));
        } catch (e) {}
        return 0;
    }
    /* Подменять адрес надо в момент запуска: Lampa сама ставит ссылку «качества по умолчанию» (video_quality_default,
     * у byskaz 2160) поверх data.url. На время этого (синхронного) вызова Storage.field отвечает выбранным
     * качеством — настройка пользователя не меняется. Пути запуска два: Player.play (из плагина) и выбор
     * в плейлисте плеера (следующая серия, в т. ч. автоматически) — он зовёт внутренний play в обход Player.play. */
    var qNoteAt = 0;
    function affordable(data, fn) {
        var undo = null;
        try {
            var bps = knownBandwidth(), P = Lampa.Player;
            if (bps && data && data.quality && typeof data.quality === 'object') {
                var cur = (P.getUrlQuality && P.getUrlQuality(data.quality, false)) || data.url;
                var k = pickQuality(data.quality, cur, bps);
                if (k) {
                    var from = '', S = Lampa.Storage, field = S.field, want = qualityNum(k);
                    for (var q in data.quality) if (urlOf(data.quality[q]) === cur) from = q;
                    data.url = urlOf(data.quality[k]);
                    S.field = function (name) { return name === 'video_quality_default' ? want : field.apply(this, arguments); };
                    undo = function () { S.field = field; };
                    var mb = Math.round(bps / 1e6);
                    linkAdd('качество ' + from + ' → ' + k + ' (канал ~' + mb + ' Мбит/с)');
                    if (Date.now() - qNoteAt > 30 * 60000) { qNoteAt = Date.now(); quiet('Включаю ' + k + ' — интернет ~' + mb + ' Мбит/с'); }
                }
            }
        } catch (e) {}
        try { return fn(); } finally { if (undo) undo(); }
    }
    function hookPlay() {
        var P = Lampa.Player, play = P && P.play;
        if (play && !play.__bs) {
            P.play = function (data) {
                var self = this, args = arguments;
                return affordable(data, function () { return play.apply(self, args); });
            };
            P.play.__bs = true;
        }
        // Плейлист: адрес серии бывает строкой (запуск сразу) или функцией, которая добудет его и вызовет колбэк.
        var L = Lampa.PlayerPlaylist && Lampa.PlayerPlaylist.listener, send = L && L.send;
        if (send && !send.__bs) {
            L.send = function (type, e) {
                var self = this, args = arguments;
                if (type !== 'select' || !e || !e.item) return send.apply(self, args);
                var item = e.item, getUrl = item.url;
                try { nextInList(item); } catch (x) { log('next', x.message); }
                if (typeof getUrl === 'function' && !getUrl.__bs) {
                    item.url = function (cb) {
                        var me = this;
                        return getUrl.call(me, function () { var a = arguments, t = this; return affordable(item, function () { return cb.apply(t, a); }); });
                    };
                    item.url.__bs = true;
                    return send.apply(self, args);
                }
                return affordable(item, function () { return send.apply(self, args); });
            };
            L.send.__bs = true;
        }
    }

    function patch(c) {
        if (!c || c.__bsFix || typeof c.setDefaultQuality !== 'function') return c;
        c.__bsFix = true;
        var sdq = c.setDefaultQuality;
        c.setDefaultQuality = function (data) {
            if (data) {
                normQuality(data.quality);
                if (data.url && typeof data.url === 'object' && typeof data.url.url === 'string') data.url = data.url.url;
            }
            return sdq.apply(this, arguments);
        };
        /* «Повторить» до того, как пришёл список источников: у выбранного источника ещё нет адреса, и
         * requestParams падает на url.indexOf — красный экран ошибки Lampa. Ловим: через 1,5 с ещё раз
         * (список обычно успевает прийти), не вышло — перезагружаем экран источников, как сам плагин. */
        if (typeof c.find === 'function') {
            var find = c.find, findFails = 0;
            c.find = function () {
                var self = this;
                try { var r = find.apply(this, arguments); findFails = 0; return r; }
                catch (e) {
                    findFails++;
                    linkAdd('поиск источника упал: ' + (e && e.message));
                    if (findFails === 1) setTimeout(function () { if (onScreen(self)) try { self.find(); } catch (x) {} }, 1500);
                    else if (findFails === 2 && onScreen(self)) { try { Lampa.Activity.replace(); } catch (x) {} }
                }
            };
        }
        if (typeof c.destroy === 'function') {
            var destroy = c.destroy;
            c.destroy = function () {
                if (lastPlay && lastPlay.comp === c) lastPlay = null;
                if (auto && auto.comp === c) auto = null;
                return destroy.apply(this, arguments);
            };
        }
        /* Плагин сам переключается, когда источник пуст, — пусть берёт проверенный рабочий и обходит мёртвые. */
        if (typeof c.nextSource === 'function') {
            var ns = c.nextSource;
            c.nextSource = function () {
                var n = ns.apply(this, arguments), P = probe();
                if (!P) return n;
                try {
                    var cur = [Lampa.Storage.get('online_balanser', ''), Lampa.Storage.get('active_balanser', '')];
                    if (auto && auto.comp === this) cur = cur.concat(auto.tried);
                    var pref = P.preferred(this, cur);
                    if (pref) return pref;
                    if (n && P.bad(P.state(n))) return P.first(this, cur) || n;
                } catch (e) {}
                return n;
            };
        }
        if (typeof c.uiDraw === 'function') {
            var draw = c.uiDraw;
            c.uiDraw = function (items, params) {
                var r = draw.apply(this, arguments);
                try { autoPick(items, params, this); } catch (e) { log('autoPick', e.message); }
                try { if (window.BSContinue) BSContinue.onDraw(items, params, this); } catch (e) { log('resume', e.message); }
                return r;
            };
        }
        if (typeof c.getFileUrl === 'function') {
            var gfu = c.getFileUrl;
            /* Плагин зовёт getFileUrl(item, cb, true) уже с флагом «RCH пробовали»: ответ {rch:true} сразу
             * превращается в «Не удалось извлечь ссылку», подключение даже не начинается. Первый вызов отдаём
             * с false — плагин подключит RCH и сам повторит запрос (этот внутренний повтор приходит с нашим же
             * обработчиком — cb.__bsCb — и идёт мимо нас). Зависнуть подключение не может — таймаут в bsrch.js. */
            c.getFileUrl = function (file, call, waiting) {
                var self = this;
                // Внутренний повтор плагина (после RCH) приходит с нашим же обработчиком — его пропускаем мимо.
                if (!file || typeof call !== 'function' || call.__bsCb) return gfu.apply(this, arguments);
                if (!file.__bsAlts && file.url && String(file.url).indexOf('/lite/rhsprem/movie') > 0 && Date.now() < rhsDownUntil) {
                    var direct = fallbacks(file.url);
                    linkAdd('HDRezka недавно не отвечала — сразу Rezka');
                    file = cloneFile(file); file.url = direct[0]; file.__bsAlts = direct.slice(1);
                }
                var t = Date.now();
                if (file.url) linkAdd('→ ' + shortUrl(file.url));
                /* HDRezka-премиум, когда сломана, не отказывает, а молчит до таймаута Lampa (20 с, замер на эмуляторе
                 * 2026-10-11). Не ждём: через HEDGE_MS параллельно спрашиваем Rezka, берём ответ, пришедший первым. */
                var hedge = null, hedged = false, settled = false, pending = 1;
                var finish = function (json, extra) {
                    if (settled) return;
                    if (!(json && json.url) && --pending > 0) return;   // другой запрос ещё может ответить
                    settled = true; if (hedge) clearTimeout(hedge);
                    call(json, extra);
                };
                if (!file.__bsRetry && file.url && String(file.url).indexOf('/lite/rhsprem/movie') > 0) {
                    hedge = setTimeout(function () {
                        hedge = null;
                        if (settled || Date.now() - lastCancel < 3000) return;
                        var alts = fallbacks(file.url);
                        if (!alts.length) return;
                        rhsDown(); pending++; hedged = true;
                        linkAdd('HDRezka молчит ' + HEDGE_MS / 1000 + ' с — параллельно Rezka');
                        var f3 = cloneFile(file); f3.url = alts[0]; f3.__bsAlts = alts.slice(1); f3.__bsRetry = true;
                        self.getFileUrl(f3, finish, waiting);
                    }, HEDGE_MS);
                }
                var cb = function (json, extra) {
                    if (file.url) linkAdd('← ' + (Date.now() - t) + 'мс ' + linkResult(json));
                    if (settled) return;
                    if (json && json.url) remember(self, file);
                    if (pending > 1 && !(json && json.url)) return finish(json, extra);   // запасной уже в пути
                    if (hedge) { clearTimeout(hedge); hedge = null; }
                    if (!json && !hedged && file.url && Date.now() - lastCancel > 3000) {
                        if (String(file.url).indexOf('/lite/rhsprem/movie') > 0) rhsDown();
                        var alts = file.__bsAlts || fallbacks(file.url);
                        if (alts.length) {
                            linkAdd('повтор через ' + alts[0].replace(/^https?:\/\/([^/]+)\/lite\/([a-z0-9]+).*/i, '$1 ($2)'));
                            var f2 = cloneFile(file);
                            f2.url = alts[0]; f2.__bsAlts = alts.slice(1); f2.__bsRetry = true;
                            return self.getFileUrl(f2, finish, waiting);
                        }
                    }
                    finish(json, extra);
                };
                cb.__bsCb = true;
                return gfu.call(this, file, cb, file.__bsRetry ? waiting : false);
            };
        }
        return c;
    }

    // «Назад» на «Загрузке» — человек сам отменил; повтор через другой сервер тогда не нужен
    var lastCancel = 0;
    /* Второй Loading.start без stop: Lampa заводит новый слой «Загрузка», а прежний (уже на экране) теряет — stop убирает
     * только последний, прежний висит навсегда, в том числе поверх фильма, и пульт остаётся у слоя загрузки. Так было при
     * параллельном запросе Rezka (HDRezka молчит 6 с — второй getFileUrl плагина, ТВ 2026-10-11). Перед новым start
     * убираем прежний слой. */
    var loadingOn = false;
    function hookLoading() {
        var L = Lampa.Loading, st = L.start, sp = L.stop;
        if (st.__bs) return;
        L.start = function (onCancel) {
            var args = [].slice.call(arguments);
            if (typeof onCancel === 'function') args[0] = function () { lastCancel = Date.now(); return onCancel.apply(this, arguments); };
            if (loadingOn) { try { sp.call(L); } catch (e) {} }
            loadingOn = true;
            return st.apply(this, args);
        };
        L.start.__bs = true;
        L.stop = function () { loadingOn = false; return sp.apply(this, arguments); };
    }

    /* ---------- источник текущего видео и автоподбор рабочего ----------
     * Что играет — запоминаем при выдаче ссылки (компонент, сезон, серия, имя источника). Сторож плеера, когда видео
     * так и не пошло, зовёт autoNext(): следующий источник плагина (nextSource — его же рейтинг), переключение
     * (switchSource), а когда новый источник нарисует список (uiDraw) — сами выбираем ту же серию (или фильм). Не больше
     * AUTO_MAX источников подряд; найти серию не удалось — оставляем список и подсказываем. */
    var lastPlay = null, auto = null, AUTO_MAX = 3;
    function log(a, b) { try { console.log('BS fix', a, b || ''); } catch (e) {} }
    function quiet(t) {
        try { if (window.BSSkaz && BSSkaz.toast) return BSSkaz.toast(t, 6000); } catch (e) {}
        try { Lampa.Noty.show(String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')); } catch (e) {}
    }

    function sourceName() {
        try {
            // кнопка «Источник» на панели плагина (data-skaz-focus=source); --active у неё — только пока открыто меню
            var t = ($('.activity--active .skaz-chip[data-skaz-focus="source"] .skaz-chip__label').last().text() || $('.skaz-chip[data-skaz-focus="source"] .skaz-chip__label').last().text()).replace(/\s+/g, ' ').replace(/^\s|\s$/g, '');
            if (t) return t;
        } catch (e) {}
        try { return String(Lampa.Storage.get('online_balanser', '') || ''); } catch (e) { return ''; }
    }

    function onScreen(c) {
        try { return Lampa.Activity.active().activity.component === c; } catch (e) { return false; }
    }

    function remember(comp, file) {
        lastPlay = { comp: comp, season: file.season, episode: file.episode, text: file.text || file.title || '',
            name: sourceName(), balanser: (function () { try { return Lampa.Storage.get('online_balanser', ''); } catch (e) { return ''; } })(),
            time: Date.now(), bound: false };
    }

    /* Следующая серия из плейлиста плеера (автопереход или кнопка «Следующая»). Источник тот же, что у прошлой серии, —
     * «что играет» переносим на неё (иначе через 90 с после первой серии current() пуст: сторож не может сменить
     * источник в плеере и пишет «выберите другой»). У плеера ТВ (не встроенного) плагин Skaz кладёт в плейлист ссылки
     * всех серий сразу, при запуске первой, — к третьей-четвёртой серии ссылка бывает уже просрочена (fromList): тогда
     * свежую ссылку можно взять и у того же источника (findInPlayer его не исключает). Ссылку-функцию плагин добудет
     * сам через getFileUrl — там remember() перезапишет всё сам. */
    function nextInList(item) {
        if (!lastPlay || !item || (!item.season && !item.episode)) return;
        lastPlay.season = item.season; lastPlay.episode = item.episode;
        lastPlay.text = item.title || lastPlay.text;
        lastPlay.time = Date.now(); lastPlay.bound = false;
        lastPlay.fromList = typeof item.url === 'string';
    }
    /* «Что играет» действительно только для видео, плеер которого стартовал сразу после выдачи ссылки
     * (bound при 'start' плеера; до него — 90 с свежести). Иначе чужое видео, не запустившееся через час,
     * переключило бы источник у прошлого сериала. После закрытия плеера остаётся до следующего старта. */
    function onPlayerStart() {
        if (lastPlay) lastPlay.bound = Date.now() - lastPlay.time < 90000;
    }
    function current() {
        return lastPlay && (lastPlay.bound || Date.now() - lastPlay.time < 90000) ? lastPlay : null;
    }
    /** Видео реально пошло — подбор закончен. Зовёт сторож плеера. */
    function played() { auto = null; }

    function autoNext() {
        if (lsGetFix('bs_auto_source') === 'false') return false;
        var lp = current(), c = lp && lp.comp;
        if (!c || typeof c.nextSource !== 'function' || typeof c.switchSource !== 'function' || !onScreen(c)) return false;
        if (!auto || auto.comp !== c || auto.season !== lp.season || auto.episode !== lp.episode)
            auto = { comp: c, tried: [], switches: 0, season: lp.season, episode: lp.episode };
        if (lp.balanser && auto.tried.indexOf(lp.balanser) < 0) auto.tried.push(lp.balanser);
        var P = probe();
        try { if (P) P.remember(lp.balanser, 'failed'); } catch (e) {}
        if (auto.switches >= AUTO_MAX) return giveUpAuto();
        var from = lp.name || lp.balanser;
        /* Гонка: та же серия у нескольких источников сразу, в фоне (bsprobe.js) — к первому, у кого поток жив. */
        if (P && typeof c.requestParams === 'function') {
            var voice = '';
            try { voice = (c.getChoice() || {}).voice_name || ''; } catch (e) {}
            var a = auto;
            a.racing = true;
            quiet('«' + from + '» не работает — ищу другой источник');
            P.race(c, a.tried.concat([lp.balanser]), { season: lp.season | 0, episode: lp.episode | 0, voice: voice }, function (win, results) {
                a.racing = false;
                if (auto !== a || !onScreen(c) || playerOpen()) return;          // ушли с экрана или уже смотрят другое
                results.forEach(function (r) { if (P.bad(r.verdict) && a.tried.indexOf(r.name) < 0) a.tried.push(r.name); });
                var next = win ? win.name : '';
                if (!next) { try { next = c.nextSource(); } catch (e) {} }
                switchTo(c, lp, next, win ? (win.verdict === 'ok' ? 'поток проверен' : 'ссылка есть') : 'пробую', win && win.title);
            });
            return true;
        }
        var nx = '';
        try { nx = c.nextSource(); } catch (e) {}
        quiet('«' + from + '» не работает — ищу другой источник');
        return switchTo(c, lp, nx, '');
    }

    function playerOpen() { try { return !!Lampa.Player.opened(); } catch (e) { return false; } }
    function giveUpAuto() {
        auto = null;
        quiet('Рабочий источник не найден — выберите вручную');
        return false;
    }

    /* Новый источник должен открыться на том же сезоне. У плагина для этого своя «память сезона»
     * (seasonMemory — номер сезона, z01_season_last): при открытии любого источника он выбирает сезон с этим
     * номером. Озвучку переносим, как сам плагин при смене источника (voice_name). */
    function prepSwitch(c, season, next) {
        try { if (season && typeof c.seasonMemory === 'function') c.seasonMemory(season); } catch (e) { log('season', e.message); }
        try {
            if (typeof c.getChoice === 'function' && typeof c.saveChoice === 'function') {
                var from = c.getChoice(), to = c.getChoice(next);
                if (from && from.voice_name && !to.voice_name) { to.voice_name = from.voice_name; c.saveChoice(to, next); }
            }
        } catch (e) { log('voice', e.message); }
    }

    function switchTo(c, lp, next, why, title) {
        if (!auto || auto.comp !== c) return false;
        if (!next || auto.tried.indexOf(next) >= 0) return giveUpAuto();
        auto.tried.push(next);
        auto.switches++;
        auto.target = next;
        auto.waiting = Date.now();
        if (why) quiet('Переключаю на «' + (title || next) + '» — ' + why);
        prepSwitch(c, auto.season, next);
        setTimeout(function () {
            if (!auto || auto.comp !== c || !onScreen(c)) return;   // человек ушёл с экрана — не переключаем
            try { c.switchSource(next); } catch (e) { auto = null; }
        }, 500);
        return true;
    }

    /* ---------- смена источника не выходя из плеера ----------
     * Сторож плеера (playerguard.js): видео не пошло или встало насовсем — findInPlayer() в фоне ищет ту же серию у
     * других источников (гонка bsprobe.js) и отдаёт ссылку на проверенный поток; сторож подменяет поток в открытом
     * плеере (как смену качества) и пишет, на какой источник переключил. Список под плеером (плагин) переключаем на
     * этот источник, когда человек выйдет из плеера: переключать его при открытом плеере нельзя — плагин перерисует
     * экран и заберёт пульт у плеера. cb({name, title, url, verdict}) | cb(null) — рабочего нет. false — искать не
     * можем (выключено, нет проверки источников, это не онлайн-источник): тогда по-старому, через закрытие плеера. */
    var inPlayer = null;   // {comp, name, season}: на что переключить список после выхода из плеера
    function findInPlayer(cb) {
        if (lsGetFix('bs_auto_source') === 'false') return false;
        var P = probe(), lp = current(), c = lp && lp.comp;
        if (!P || !c || typeof c.requestParams !== 'function' || typeof c.switchSource !== 'function' || !onScreen(c)) return false;
        if (!auto || auto.comp !== c || auto.season !== lp.season || auto.episode !== lp.episode)
            auto = { comp: c, tried: [], switches: 0, season: lp.season, episode: lp.episode };
        // ссылка из плейлиста (могла просрочиться) — сам источник не виноват: свежую ссылку можно взять и у него
        var stale = !!lp.fromList;
        lp.fromList = false;
        if (!stale) {
            if (lp.balanser && auto.tried.indexOf(lp.balanser) < 0) auto.tried.push(lp.balanser);
            try { P.remember(lp.balanser, 'failed'); } catch (e) {}
        }
        if (auto.switches >= AUTO_MAX) { auto = null; cb(null); return true; }
        var voice = '', a = auto;
        try { voice = (c.getChoice() || {}).voice_name || ''; } catch (e) {}
        a.racing = true;
        P.race(c, a.tried.slice(), { season: lp.season | 0, episode: lp.episode | 0, voice: voice }, function (win, results) {
            a.racing = false;
            if (auto !== a || !playerOpen()) return;                          // плеер закрыли, пока искали
            results.forEach(function (r) { if (P.bad(r.verdict) && a.tried.indexOf(r.name) < 0) a.tried.push(r.name); });
            if (!win || !win.url || a.tried.indexOf(win.name) >= 0) { auto = null; return cb(null); }
            a.tried.push(win.name);
            a.switches++;
            // дальше «что играет» — новый источник: его и пометим упавшим, если и он не пойдёт
            lp.balanser = win.name; lp.name = win.title || win.name; lp.time = Date.now(); lp.bound = true;
            inPlayer = { comp: c, name: win.name, season: a.season };
            log('в плеере', win.name + ' ' + win.verdict);
            cb({ name: win.name, title: win.title || win.name, url: win.url, verdict: win.verdict });
        });
        return true;
    }
    /** Вышли из плеера после смены источника в нём — список под плеером тоже на рабочий источник (серию не включаем). */
    function afterPlayer() {
        var p = inPlayer;
        inPlayer = null;
        if (!p || !onScreen(p.comp)) return;
        if (auto && auto.comp === p.comp) auto.waiting = 0;              // autoPick не должен снова включить серию
        prepSwitch(p.comp, p.season, p.name);
        setTimeout(function () {
            try { if (onScreen(p.comp) && !playerOpen() && Lampa.Storage.get('online_balanser', '') !== p.name) p.comp.switchSource(p.name); }
            catch (e) { log('после плеера', e.message); }
        }, 600);
    }

    function autoPick(items, params, comp) {
        if (!auto || !auto.waiting || Date.now() - auto.waiting > 90000) return;
        // только тот экран и тот источник, на который переключились сами (не другой фильм, не ручной выбор)
        if (comp && auto.comp !== comp) return;
        try { if (auto.target && Lampa.Storage.get('online_balanser', '') !== auto.target) return; } catch (e) {}
        if (!params || typeof params.onEnter !== 'function' || !items || !items.length) return;
        var playable = items.filter(function (it) { return it && it.method !== 'link'; });
        var hit = null;
        if (auto.episode) {
            hit = playable.filter(function (it) { return it.episode == auto.episode && (!auto.season || !it.season || it.season == auto.season); })[0];
        } else hit = playable[0];
        if (!hit) {
            if (playable.length) { auto.waiting = 0; quiet('Переключился на «' + sourceName() + '» — выберите серию'); }
            return;
        }
        auto.waiting = 0;
        setTimeout(function () { try { params.onEnter(hit, $('<div></div>')); } catch (e) { log('onEnter', e.message); } }, 400);
    }

    function openSources() {
        var lp = current();
        if (!lp || !lp.comp) return;
        try { Lampa.Player.close(); } catch (e) {}
        setTimeout(function () { try { if (lp && lp.comp && lp.comp.uiSourceMenu) lp.comp.uiSourceMenu(); } catch (e) {} }, 700);
    }

    function lsGetFix(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
    function probe() { var P = window.BSProbe; return P && P.enabled() ? P : null; }

    function addSettings() {
        if (!Lampa.SettingsApi) return;
        Lampa.SettingsApi.addParam({
            component: 'bs_update',
            param: { name: 'bs_diag', type: 'button' },
            field: { name: 'Журнал запросов источников', description: 'Последние запросы к серверам Skaz: время, ответ. Сфотографируйте экран, если источник не работает.' },
            onChange: showDiag
        });
        Lampa.SettingsApi.addParam({
            component: 'bs_update',
            param: { name: 'bs_bw_quality', type: 'trigger', 'default': true },
            field: { name: 'Качество под скорость интернета', description: 'Интернет не тянет 4K — старт в качестве пониже.' },
            onChange: function (v) { try { window.localStorage.setItem('bs_bw_quality', String(v === true || v === 'true')); } catch (e) {} }
        });
        Lampa.SettingsApi.addParam({
            component: 'bs_update',
            param: { name: 'bs_auto_source', type: 'trigger', 'default': true },
            field: { name: 'Автоподбор источника', description: 'Не запустилось — сам пробует другой источник.' },
            onChange: function (v) { try { window.localStorage.setItem('bs_auto_source', String(v === true || v === 'true')); } catch (e) {} }
        });
        Lampa.SettingsApi.addParam({
            component: 'bs_update',
            param: { name: 'bs_race', type: 'trigger', 'default': true },
            field: { name: 'Проверять источники заранее', description: 'Находит рабочий источник быстрее.' },
            onChange: function (v) { try { window.localStorage.setItem('bs_race', String(v === true || v === 'true')); } catch (e) {} }
        });
    }

    function start() {
        try { addSettings(); } catch (e) {}
        try { hookLoading(); } catch (e) {}
        try { hookPlay(); } catch (e) {}
        try { Lampa.Player.listener.follow('start', onPlayerStart); } catch (e) {}
        try { Lampa.Player.listener.follow('destroy', afterPlayer); } catch (e) {}
        try {
            var C = Lampa.Component, create = C.create;
            if (create.__bs) return;
            C.create = function () { return patch(create.apply(this, arguments)); };
            C.create.__bs = true;
        } catch (e) { console.log('BS fix', e); }
        // экран, открытый до установки обёртки
        try { patch(Lampa.Activity.active().activity.component); } catch (e) {}
    }

    return { start: start, show: showDiag, note: linkAdd, _hookLoading: hookLoading, current: current, played: played, autoNext: autoNext, findInPlayer: findInPlayer, _afterPlayer: afterPlayer, openSources: openSources, _autoPick: autoPick, playingBitrate: playingBitrate, _pickQuality: pickQuality, _hookPlay: hookPlay, _remember: remember, _state: function () { return { lastPlay: lastPlay, auto: auto }; }, _normQuality: normQuality, _patch: patch, _otherServer: otherServer, _fallbackUrl: fallbackUrl, _fallbacks: fallbacks, _mask: mask };
})();
