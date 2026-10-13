/*
 * Панель Samsung Smart Hub: ряд «Lampa» при наведении на значок приложения.
 *
 *  Lampa (Tizen.init) раз в 10 минут собирает ряды — уведомления (position 0), «Продолжить» (1: только сериалы,
 *  открывает карточку), популярное (2) — и через app control 'pick' отдаёт их службе превью (service/service.js →
 *  webapis.preview). Плитки у неё постерами 1:1. Перехватываем tizen.application.launchAppControl и сразу же (тот же
 *  момент, что в оригинале) отправляем службе свои ряды (send):
 *   - разделы по порядку: «Продолжить с места» (bscontinue.js hubItems; новые серии первыми, плитка сразу продолжает
 *     просмотр; пусто — «Продолжить» Lampa), уведомления Lampa, турецкие сериалы (TMDB, раз в 12 ч; вместе с кнопкой
 *     «Турецкие сериалы» — bs_menu_turk), популярные фильмы Lampa. ТВ 2022+ склеивает разделы в один ряд и названий
 *     разделов не показывает — поэтому раздел виден в подписи плитки: «Турецкий сериал · 2025», «Популярное · 2026»;
 *   - форма (bs_hub_mode, ниже): по умолчанию — постеры, в точности как у Lampa (ТВ 2022 с широкими плитками стирал
 *     значок Lampa на главном экране); на выбор — широкие 16:9 с названием фильма, как у TVCOM и Allplay: кадр TMDB с
 *     языком ru, en, оригинала, иначе без надписей (bs_hub_art, раз в 30 дней; плитка без кадра выпадает).
 *  Свои внеочередные отправки (после просмотра, после запуска) — не чаще раза в 10 минут (требование Samsung к
 *  setPreviewData; время последней — bs_hub_sent): request() ставит таймер. Чего не хватило (турецкие, кадры) —
 *  узнаётся в фоне к следующей отправке (refreshLater).
 *
 *  Запуск плиткой, когда Lampa уже работает в фоне. Нажали «Домой» во время фильма — плеер остался открытым; плитка
 *  будит приложение, Lampa (deepLink) открывает карточку под плеером, и на экране снова прежний фильм. Поэтому на
 *  'appcontrol' с данными плитки сначала закрываем плеер. Слушатель ставим при загрузке файла — раньше слушателя Lampa.
 */
var BSHub = (function () {
    var IMG = 'http://imagetmdb.com/t/p/w780', ART_KEY = 'bs_hub_art', ART_MAX = 300, ART_LIFE = 30 * 86400000;
    var GAP = 10 * 60000, ART_WAIT = 20000, TURK_KEY = 'bs_hub_turk', TURK_LIFE = 12 * 3600000, TURK_N = 6, POPULAR_N = 8;
    var TURK_PATH = 'discover/tv?with_original_language=tr&sort_by=popularity.desc&vote_count.gte=5&without_genres=16,10763,10764,10767';

    function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
    function log(a, b) { try { console.log('BS hub', a, b === undefined ? '' : b); } catch (e) {} }
    /* Режим ряда (bs_hub_mode):
     *  'off' (по умолчанию с 1.7.13) — ничего не отправлять, служба превью не запускается. Ряд в Smart Hub обновляет
     *            только фоновая служба (webapis.preview в самом приложении нет — проверено на эмуляторе), а запущенная
     *            служба (скрытое приложение пакета) становится для ТВ «последним приложением»: в ряду недавних на
     *            вкладке «Узнать» вместо значка Lampa — серая заглушка (ТВ 2022, до перезагрузки или запуска Lampa без
     *            службы; проверено на ТВ: с 'off' значок держится). В Smart Hub остаются плитки, присланные раньше;
     *  'posters' — наши разделы в форме данных Lampa: постеры 1:1 w300, без «Play», без своих полей, ≤ 3 разделов;
     *  'wide'    — широкие кадры 16:9 с названием; 'lampa' — данные Lampa как есть. */
    function mode() { var m = lsGet('bs_hub_mode'); return m === 'wide' || m === 'lampa' || m === 'posters' ? m : 'off'; }
    function ours() { var m = mode(); return m === 'wide' || m === 'posters'; }
    // Один раз: на ТВ, где режим остался от 1.7.11–1.7.12 (тогда по умолчанию ряд обновлялся), — 'off', иначе служба
    // превью запускается и значок Lampa снова пропадает (ТВ 2022). Сразу при загрузке: Lampa шлёт ряд на старте.
    if (lsGet('bs_hub_mode_v') !== '2') {
        lsSet('bs_hub_mode_v', '2');
        if (mode() !== 'off') { log('режим ряда сброшен на «не обновлять», был', mode()); lsSet('bs_hub_mode', 'off'); }
    }
    function json(k, def) { try { var v = JSON.parse(lsGet(k) || 'null'); return v === null ? def : v; } catch (e) { return def; } }

    /* ---------- кадры с названием ---------- */

    function artCache() { var c = json(ART_KEY, {}); return c && typeof c === 'object' ? c : {}; }
    function artSave(c) {
        var keys = Object.keys(c);
        if (keys.length > ART_MAX) {
            keys.sort(function (a, b) { return (c[a].t || 0) - (c[b].t || 0); });
            for (var i = 0; i < keys.length - ART_MAX; i++) delete c[keys[i]];
        }
        lsSet(ART_KEY, JSON.stringify(c));
    }
    function mediaOf(card) { return card.name || card.original_name || card.first_air_date || card.number_of_seasons ? 'tv' : 'movie'; }
    function artKey(card) { return mediaOf(card) + ':' + card.id; }

    /** Лучший широкий кадр из ответа TMDB images: с названием на ru, en, языке оригинала; иначе без надписей; '' — нет. */
    function pickArt(json, card) {
        var list = (json && json.backdrops) || [];
        var better = function (a, b) { return (b.vote_average || 0) - (a.vote_average || 0) || (b.vote_count || 0) - (a.vote_count || 0) || (b.width || 0) - (a.width || 0); };
        var langs = ['ru', 'en'];
        if (card.original_language && langs.indexOf(card.original_language) < 0) langs.push(card.original_language);
        for (var i = 0; i < langs.length; i++) {
            var hit = list.filter(function (b) { return b && b.file_path && b.iso_639_1 === langs[i] && (b.width || 0) >= 780; }).sort(better)[0];
            if (hit) return hit.file_path;
        }
        if (card.backdrop_path) return card.backdrop_path;
        var plain = list.filter(function (b) { return b && b.file_path && !b.iso_639_1; }).sort(better)[0];
        return plain ? plain.file_path : '';
    }

    /* ---------- переделка рядов ---------- */

    function cardOf(tile) {
        try { var c = JSON.parse(tile.action_data); return c && c.id ? c : null; } catch (e) { return null; }
    }
    function year(c) { return String(c.release_date || c.first_air_date || '').slice(0, 4); }
    function tileOf(c, subtitle, playable) {
        return {
            title: c.title || c.name || '', subtitle: subtitle || '', image_ratio: '1by1',
            image_url: c.poster ? c.poster : c.img ? c.img : 'http://imagetmdb.com/t/p/w300/' + c.poster_path,
            action_data: JSON.stringify(c), is_playable: !!playable
        };
    }

    /** Плитку — в широкую. Кадра нет — null (кроме keep: своя плитка «Продолжить» остаётся с постером). */
    function wide(tile, card, cache, missing, now, keep) {
        if (!card) return keep ? tile : null;
        var k = artKey(card), hit = cache[k];
        if ((!hit || now - (hit.t || 0) > ART_LIFE) && missing.indexOf(k) < 0) missing.push(k);
        var path = (hit && hit.p) || card.backdrop_path;
        if (!path) return keep ? tile : null;
        tile.image_url = IMG + path;
        tile.image_ratio = '16by9';
        return tile;
    }

    /**
     * Ряды Lampa → наши. json — данные Lampa (или '' — Lampa ещё не прислала), mine — [{card, subtitle}] из
     * BSContinue.hubItems(), turk — карточки турецких сериалов, cache — кадры.
     * Возвращает {json, missing: ['tv:123', …] — кадры, которые стоит узнать у TMDB, cards: {ключ: карточка}}.
     */
    function rewrite(json, mine, turk, cache, now, isWide) {
        var data = null, missing = [], cards = {}, lampa = { other: [] }, own = [];
        now = now || Date.now();
        if (json) {
            try { data = JSON.parse(json); } catch (e) { return { json: json, missing: missing, cards: cards }; }
            if (!data || !data.sections) return { json: json, missing: missing, cards: cards };
        }
        data = data || { sections: [] };
        data.sections.forEach(function (s) {
            if (!s) return;
            if (s.position === 0) lampa.notice = s; else if (s.position === 1) lampa.cont = s;
            else if (s.position === 2) lampa.popular = s; else lampa.other.push(s);
        });
        var order = [], cont = null;
        if (mine.length) {
            cont = { title: 'Продолжить с места', tiles: mine.map(function (m) { return tileOf(m.card, m.subtitle, isWide); }) };
            order.push(cont); own.push(cont);
        } else if (lampa.cont) order.push(lampa.cont);
        if (lampa.notice) order.push(lampa.notice);
        // постеры — не больше 3 разделов, как у Lampa: при уведомлениях турецкие не добавляем
        if (turk && turk.length && (isWide || !lampa.notice)) {
            var ts = { title: 'Турецкие сериалы', tiles: turk.slice(0, TURK_N).map(function (c) { return tileOf(c, 'Турецкий сериал' + (year(c) ? ' · ' + year(c) : '')); }) };
            order.push(ts); own.push(ts);
        }
        if (lampa.popular) {
            lampa.popular.tiles = (lampa.popular.tiles || []).slice(0, POPULAR_N);
            lampa.popular.tiles.forEach(function (t) { var c = cardOf(t); if (!t.subtitle || /^\d{4}$/.test(t.subtitle)) t.subtitle = 'Популярное' + (c && year(c) ? ' · ' + year(c) : ''); });
            order.push(lampa.popular);
        }
        order = order.concat(lampa.other);
        if (!isWide) order = order.slice(0, 3);
        order.forEach(function (s, i) {
            s.position = i;
            s.tiles = (s.tiles || []).map(function (t) {
                var card = cardOf(t);
                if (!isWide) return own.indexOf(s) < 0 || (card && (card.poster_path || card.poster || card.img)) ? t : null;
                if (card) cards[artKey(card)] = card;
                return wide(t, card, cache, missing, now, s === cont);
            }).filter(Boolean);
        });
        data.sections = order.filter(function (s) { return s.tiles.length; });
        data.sections.forEach(function (s, i) { s.position = i; });
        return { json: JSON.stringify(data), missing: missing, cards: cards };
    }

    /** Когда можно отправить: сейчас (0) или через сколько мс — не чаще раза в GAP. */
    function waitFor(sentAt, now) { return Math.max(0, (sentAt || 0) + GAP - now); }

    /* ---------- TMDB: кадры и турецкие сериалы ---------- */

    function ready() { return window.Lampa && Lampa.TMDB && Lampa.Reguest && window.appready; }
    function tmdb(path, ok, fail) {
        var url = Lampa.TMDB.api(path + (path.indexOf('?') < 0 ? '?' : '&') + 'api_key=' + Lampa.TMDB.key() + '&language=ru');
        try { new Lampa.Reguest().silent(url, ok, fail); } catch (e) { fail(); }
    }

    /** Узнать кадры по ключам, потом done(). Не дольше ART_WAIT — остальные узнаются к следующей отправке. */
    function fetchArt(keys, cards, done) {
        var queue = keys.slice(0, 30), until = Date.now() + ART_WAIT, finished = false;
        var fin = function () { if (!finished) { finished = true; done(); } };
        if (!queue.length || !ready()) return fin();
        setTimeout(fin, ART_WAIT + 1000);
        (function next() {
            var k = queue.shift();
            if (!k || Date.now() > until) return fin();
            var card = cards[k];
            var done1 = function (j) {
                var c = artCache();
                c[k] = { p: j ? pickArt(j, card) : (c[k] && c[k].p) || '', t: Date.now() };
                artSave(c);
                setTimeout(next, 200);
            };
            tmdb(mediaOf(card) + '/' + card.id + '/images?include_image_language=ru,en,' + (card.original_language || 'en') + ',null', done1, function () { done1(null); });
        })();
    }

    function turkOn() { return lsGet('bs_menu_turk') !== 'false'; }
    function turkCards() { var t = json(TURK_KEY, null); return turkOn() && t && t.cards ? t.cards : []; }
    function fetchTurk(done) {
        var t = json(TURK_KEY, null);
        if (!turkOn() || !ready() || (t && Date.now() - (t.at || 0) < TURK_LIFE)) return done();
        tmdb(TURK_PATH, function (j) {
            var cards = ((j && j.results) || []).filter(function (c) { return c && c.id && (c.backdrop_path || c.poster_path); }).slice(0, TURK_N).map(function (c) {
                return { id: c.id, name: c.name, original_name: c.original_name, poster_path: c.poster_path, backdrop_path: c.backdrop_path,
                    first_air_date: c.first_air_date, original_language: c.original_language, source: 'tmdb' };
            });
            if (cards.length) lsSet(TURK_KEY, JSON.stringify({ at: Date.now(), cards: cards }));
            done();
        }, done);
    }

    /* ---------- отправка службе превью ---------- */

    var lastPick = '', launch = null, timer = null, busy = false;

    function mine() { try { return window.BSContinue && BSContinue.hubItems ? BSContinue.hubItems() : []; } catch (e) { return []; } }

    /** Попросить отправить свежие ряды: сразу, если 10 минут с прошлой прошли, иначе — когда пройдут. */
    function request() {
        if (!launch || timer || busy || !ours()) return;
        var wait = waitFor(parseInt(lsGet('bs_hub_sent') || '0', 10), Date.now());
        timer = setTimeout(function () {
            timer = null;
            // пока ждали, ряды могли уйти по сигналу Lampa — тогда ещё 10 минут от той отправки
            if (waitFor(parseInt(lsGet('bs_hub_sent') || '0', 10), Date.now()) > 1000) return request();
            prepare();
        }, wait);
        if (wait) log('отправка через', Math.round(wait / 1000) + ' с');
    }

    var waited = 0;
    function prepare() {
        // до готовности Lampa TMDB не спросить; ждём её (до минуты)
        if (!ready() && waited++ < 60) { timer = setTimeout(function () { timer = null; prepare(); }, 1000); return; }
        busy = true;
        fetchTurk(function () {
            if (mode() !== 'wide') { busy = false; return send(); }
            var r = rewrite(lastPick, mine(), turkCards(), artCache(), 0, true);
            fetchArt(r.missing, r.cards, function () { busy = false; send(); });
        });
    }

    /** Узнать в фоне то, чего не хватило (турецкие, кадры), — пригодится к следующей отправке (не чаще раза в 10 мин). */
    function refreshLater() {
        if (!ready() || !ours()) return;
        fetchTurk(function () {
            if (mode() !== 'wide') return;
            var r = rewrite(lastPick, mine(), turkCards(), artCache(), 0, true);
            if (r.missing.length) fetchArt(r.missing, r.cards, request);
        });
    }

    function send() {
        if (!ours()) return;
        var r = rewrite(lastPick, mine(), turkCards(), artCache(), 0, mode() === 'wide');
        logSections(r);
        try { if (!JSON.parse(r.json).sections.length) return; } catch (e) { return; }   // пустым рядом панель не затираем
        try {
            var id = tizen.application.getCurrentApplication().appInfo.id.split('.')[0] + '.service';
            lsSet('bs_hub_sent', String(Date.now()));
            launch.call(tizen.application, new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/pick', null, 'image/*', null,
                [new tizen.ApplicationControlData('caller', ['ForegroundApp', r.json])]), id,
                function () { log('ряды отправлены'); }, function (e) { log('служба превью', e && e.message); });
        } catch (e) { log('send', e.message); }
    }

    /** Что ушло в панель — коротко, для журнала: «Раздел (плиток, формат) …, первая картинка, кадров не узнано». */
    function logSections(r) {
        try {
            var d = JSON.parse(r.json), first = '';
            var text = (d.sections || []).map(function (s) {
                if (!first && s.tiles[0]) first = s.tiles[0].image_url;
                return s.title + ' (' + s.tiles.length + ', ' + (s.tiles[0] && s.tiles[0].image_ratio) + ')';
            }).join('; ');
            log('ряды', text + ' | ' + first + ' | кадров не узнано: ' + r.missing.length);
        } catch (e) {}
    }

    (function hookLaunch() {
        try {
            var app = typeof tizen !== 'undefined' && tizen.application, orig = app && app.launchAppControl;
            if (!orig || orig.__bs) return;
            launch = orig;
            app.launchAppControl = function (ctrl) {
                try {
                    var d = ctrl && ctrl.data && ctrl.data[0];
                    if (ctrl.operation === 'http://tizen.org/appcontrol/operation/pick' && d && d.value && d.value[0] === 'ForegroundApp') {
                        var m = mode();
                        if (m === 'lampa') { log('ряды Lampa как есть'); return orig.apply(this, arguments); }
                        if (m === 'off') { log('ряд панели выключен'); return; }
                        // ряды Lampa — сразу наши, в тот же момент, что и в оригинале (Lampa шлёт на старте и раз в 10 минут);
                        // чего не хватило — узнаём в фоне к следующему разу
                        lastPick = d.value[1];
                        send();
                        setTimeout(refreshLater, 3000);
                        return;
                    }
                } catch (e) { log('hook', e.message); }
                return orig.apply(this, arguments);
            };
            app.launchAppControl.__bs = true;
        } catch (e) {}
    })();

    /* ---------- запуск плиткой, когда Lampa в фоне ---------- */

    function hasPayload() {
        try {
            var rc = tizen.application.getCurrentApplication().getRequestedAppControl();
            var data = (rc && rc.appControl && rc.appControl.data) || [];
            for (var i = 0; i < data.length; i++) if (data[i].key === 'PAYLOAD') return true;
        } catch (e) {}
        return false;
    }
    try {
        if (typeof window.addEventListener === 'function') window.addEventListener('appcontrol', function () {
            try { if (window.Lampa && Lampa.Player && Lampa.Player.opened() && hasPayload()) { log('плитка панели — закрываю плеер'); Lampa.Player.close(); } }
            catch (e) { log('appcontrol', e.message); }
        });
    } catch (e) {}

    function addSettings() {
        if (!window.Lampa || !Lampa.SettingsApi) return;
        Lampa.SettingsApi.addParam({
            component: 'bs_update',
            param: { name: 'bs_hub_mode', type: 'select', values: { off: 'Не обновлять (по умолчанию)', posters: 'Постеры — пропадает значок Lampa', wide: 'Широкие кадры — пропадает значок Lampa', lampa: 'Как в Lampa — пропадает значок Lampa' }, 'default': mode() },
            field: { name: 'Ряд Lampa на панели ТВ', description: 'Плитки Lampa на главном экране ТВ. Может скрыть значок Lampa.' },
            onChange: function (v) { lsSet('bs_hub_mode', String(v)); }
        });
    }

    function start() { try { addSettings(); } catch (e) {} request(); }

    return { start: start, push: request, _rewrite: rewrite, _pickArt: pickArt, _waitFor: waitFor };
})();
