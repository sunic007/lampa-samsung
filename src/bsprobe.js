/*
 * Проверка источников до запуска: вместо «переключился — подождал 25 с — переключился снова».
 *
 *  1. Проверка потока (check): как только плеер получил ссылку, параллельно с ним спрашиваем сам поток. Ответ
 *     404/410/5xx — ссылка мёртвая: сторож (playerguard.js) переключает сразу, а не через START_LIMIT (25 с).
 *     Плейлист m3u8 с ответом 200 и #EXTM3U — поток жив. Остальное (403, нет ответа, таймаут) — «не знаем»: CDN
 *     часто отказывают запросам страницы (Origin: null), хотя плеер Samsung тот же поток играет, — такое мёртвым
 *     не считаем, решает плеер.
 *  2. Гонка (race): когда источник не пошёл, вместо одного следующего берём RACE_N лучших (порядок самого плагина —
 *     sourceOrder) и в фоне у каждого ищем ту же серию: список источника → нужный сезон → озвучка как была → серия →
 *     ссылка → проверка потока. Первый «поток жив» — победитель; к нему переключаемся (bsfix.js autoNext, серию
 *     включает autoPick). Нет такого за RACE_BUDGET — источник, выдавший ссылку («не знаем»), иначе — как раньше.
 *     Запросы — те же, что делает плагин на экране (lite-ответ: .videos__item / .videos__button с data-json).
 *     Источники с RCH (нужно своё подключение) в фоне не проверить — пропускаем.
 *  3. Итоги проверок помним на фильм 10 минут (verdicts): плагин, переключаясь сам (пустой источник), берёт
 *     проверенный рабочий и обходит мёртвые — обёртка nextSource в bsfix.js.
 *
 *  Не все источники разом: десятки одновременных запросов на серию — серверы Skaz ограничивают частоту и могут
 *  временно отказать во всём; поэтому RACE_N за раз, как и фоновая проверка самого плагина (2 параллельно).
 */
var BSProbe = (function () {
    var CHECK_TIMEOUT = 6000, REQ_TIMEOUT = 7000, RACE_N = 3, RACE_BUDGET = 14000, VERDICT_LIFE = 10 * 60000, STEPS = 6;

    function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
    function enabled() { return lsGet('bs_race') !== 'false'; }
    function log(a, b) { try { console.log('BS probe', a, b === undefined ? '' : b); } catch (e) {} }
    function note(t) { try { if (window.BSFix && BSFix.note) BSFix.note(t); } catch (e) {} }

    /* ---------- 1. проверка потока ---------- */

    function firstUrl(u) { return String(u || '').split(' or ')[0].replace(/^\s+|\s+$/g, ''); }
    function isPlaylist(url, type) { return /\.m3u8(\?|#|$)/i.test(url) || /mpegurl/i.test(type || ''); }

    /** Вердикт по ответу: 'ok' — поток жив, 'dead' — ссылка мёртвая, 'unknown' — не знаем (решает плеер). */
    function verdict(status, body, playlist) {
        if (status === 404 || status === 410 || (status >= 500 && status < 600)) return 'dead';
        if (status === 200 || status === 206) {
            if (!playlist) return 'ok';
            return /#EXTM3U/.test(String(body || '').slice(0, 2048)) ? 'ok' : 'unknown';
        }
        return 'unknown';
    }

    /** Спросить поток. cb('ok' | 'dead' | 'unknown', статус). */
    function check(url, cb) {
        url = firstUrl(url);
        var done = false, x = null, t = null;
        var fin = function (v, st) { if (done) return; done = true; clearTimeout(t); try { if (x && x.readyState < 4) x.abort(); } catch (e) {} cb(v, st); };
        if (!/^https?:\/\//i.test(url)) return fin('unknown', 0);
        try {
            x = new XMLHttpRequest();
            x.open('GET', url, true);
            x.onreadystatechange = function () {
                if (x.readyState < 2) return;
                var st = x.status, type = '';
                try { type = x.getResponseHeader('Content-Type') || ''; } catch (e) {}
                var pl = isPlaylist(url, type);
                if (!st) { if (x.readyState === 4) fin('unknown', 0); return; }
                if (!pl || st !== 200) return fin(verdict(st, '', pl), st);   // видео — хватит заголовков, качать не будем
                if (x.readyState === 4) fin(verdict(st, x.responseText, true), st);
            };
            x.onerror = function () { fin('unknown', 0); };
            t = setTimeout(function () { fin('unknown', -1); }, CHECK_TIMEOUT);
            x.send();
        } catch (e) { fin('unknown', 0); }
    }

    /* ---------- 2. серия у источника в фоне ---------- */

    function isSeasonLabel(text) {
        text = String(text || '').replace(/^\s+|\s+$/g, '');
        return /^\d+\s*(-?[йя])?\s*(сезон|season)$/i.test(text) || /^(сезон|season)\s*\d+$/i.test(text);
    }
    function seasonNumber(t) { var m = String(t || '').match(/\d+/); return m ? parseInt(m[0], 10) : 0; }
    function norm(t) { return String(t || '').toLowerCase().replace(/ё/g, 'е').replace(/[^0-9a-zа-я]+/g, ' ').replace(/^\s+|\s+$/g, ''); }
    function sameVoice(a, b) {
        if (!a || !b) return false;
        var x = norm(a), y = norm(String(b).replace(/\.\.\.$/, ''));
        return x === y || (y.length > 3 && x.indexOf(y) === 0);
    }

    /* 3D-раздачи (стерео: SBS, OU, «3D»): на обычном ТВ — двойная или сплюснутая картинка. Сами их не выбираем,
     * пока есть обычная версия; человек может включить 3D вручную. Слово «ou» — только отдельным словом. */
    var STEREO = /(^|[^0-9a-zа-я])(3d|sbs|h-?sbs|half[\s-]?sbs|h?ou|over[\s-]?under|стерео|anaglyph|анаглиф)([^0-9a-zа-я]|$)/i;
    function is3D(it) {
        if (!it) return false;
        var t = typeof it === 'string' ? it : [it.title, it.text, it.translate, it.voice_name, it.details, it.info, it.quality_name]
            .filter(function (x) { return typeof x === 'string'; }).join(' ');
        if (STEREO.test(t)) return true;
        if (it.quality && typeof it.quality === 'object') {
            var keys = Object.keys(it.quality);
            return keys.length > 0 && keys.every(function (k) { return STEREO.test(k); });
        }
        return false;
    }
    /** Тот же список без 3D, если в нём есть обычные варианты (иначе — как был). */
    function prefer2D(list) {
        var flat = (list || []).filter(function (it) { return !is3D(it); });
        return flat.length ? flat : list || [];
    }

    /**
     * Что делать с ответом источника. items/buttons — data-json элементов .videos__item/.videos__button (+text, season,
     * episode, active), want — {season, episode, voice}. Возвращает {go: url} — идти дальше, {item} — нашли, {missing}.
     */
    function decide(items, buttons, want, state) {
        state = state || {};
        var seasons = buttons.filter(function (b) { return isSeasonLabel(b.text); });
        var voices = buttons.filter(function (b) { return !isSeasonLabel(b.text); });
        if (want.season && seasons.length > 1) {
            var sb = seasons.filter(function (b) { return seasonNumber(b.text) == want.season; })[0];
            if (!sb) return { missing: true };
            if (!sb.active) return { go: sb.url };
        }
        if (items.length === 1 && items[0].method === 'link' && !items[0].similar) return { go: items[0].url };
        var videos = prefer2D(items.filter(function (v) { return v.method === 'play' || v.method === 'call'; }));
        if (videos.length) {
            if (want.voice && voices.length && !state.voiceTried) {
                var vb = voices.filter(function (b) { return sameVoice(b.text, want.voice); })[0];
                if (vb && !vb.active) { state.voiceTried = true; return { go: vb.url }; }
            }
            if (want.episode) {
                var hit = videos.filter(function (v) { return v.episode == want.episode && (!want.season || !v.season || v.season == want.season); })[0];
                return hit ? { item: hit } : { missing: true };
            }
            return { item: videos[0] };
        }
        var links = prefer2D(items.filter(function (v) { return v.method === 'link' && !v.similar; }));
        if (links.length) {
            if (!want.season) return { go: links[0].url };
            var sl = links.filter(function (l) { return seasonNumber(l.text) == want.season; })[0];
            return sl ? { go: sl.url } : { missing: true };
        }
        return { missing: true };   // пусто или только «похожие» — этого фильма у источника нет
    }

    function parseLists(text) {
        var out = { items: [], buttons: [] };
        try {
            var doc = document.implementation.createHTMLDocument('');
            var html = $('<div>', doc).append($.parseHTML(String(text || ''), doc, false));
            var read = function (sel, to) {
                html.find(sel).each(function () {
                    var el = $(this), d = null;
                    try { d = JSON.parse(el.attr('data-json')); } catch (e) {}
                    if (!d) return;
                    if (el.attr('s')) d.season = parseInt(el.attr('s'), 10);
                    if (el.attr('e')) d.episode = parseInt(el.attr('e'), 10);
                    d.text = el.text();
                    d.active = el.hasClass('active');
                    to.push(d);
                });
            };
            read('.videos__item', out.items);
            read('.videos__button', out.buttons);
        } catch (e) {}
        return out;
    }

    function withAccount(url) {
        try {
            var U = Lampa.Utils, email = Lampa.Storage.get('account_email', ''), uid = Lampa.Storage.get('lampac_unic_id', '');
            if (email && url.indexOf('account_email=') < 0) url = U.addUrlComponent(url, 'account_email=' + encodeURIComponent(email));
            if (uid && url.indexOf('uid=') < 0) url = U.addUrlComponent(url, 'uid=' + encodeURIComponent(uid));
        } catch (e) {}
        return url;
    }
    function absolute(url, base) {
        url = String(url || '');
        if (/^https?:\/\//i.test(url)) return url;
        var m = /^(https?:\/\/[^\/]+)/i.exec(base || '');
        return m && url.charAt(0) === '/' ? m[1] + url : '';
    }

    /** Найти серию у источника и проверить поток. done({name, verdict: ok|unknown|dead|nolink|missing|skip|noanswer, url}). */
    function resolve(comp, src, want, deadline, nets, done) {
        var steps = 0, seen = {}, state = {}, finished = false;
        var fin = function (v, url) { if (finished) return; finished = true; done({ name: src.key, title: src.name, verdict: v, url: url || '' }); };
        var get = function (url, ok) {
            if (Date.now() > deadline) return fin('noanswer');
            var net = new Lampa.Reguest();
            nets.push(net);
            net.timeout(REQ_TIMEOUT);
            net['native'](withAccount(url), function (t) { ok(typeof t === 'string' ? t : JSON.stringify(t || {})); }, function () { fin('noanswer'); }, false,
                { dataType: 'text', headers: { 'X-Kit-AesGcm': Lampa.Storage.get('aesgcmkey', '') } });
        };
        var step = function (url) {
            url = absolute(url, src.url);
            if (!url || ++steps > STEPS || seen[url]) return fin('missing');
            seen[url] = true;
            get(url, function (text) {
                if (/"rch"\s*:\s*true|"accsdb"|"blocked"/.test(text.slice(0, 300))) return fin('skip');
                var L = parseLists(text), r = decide(L.items, L.buttons, want, state);
                if (r.go) return step(r.go);
                if (!r.item) return fin('missing');
                if (r.item.method === 'play') return test(r.item.url);
                get(absolute(r.item.url, url), function (t2) {
                    var j = null;
                    try { j = JSON.parse(t2); } catch (e) {}
                    if (j && j.rch) return fin('skip');
                    var u = j && (typeof j.url === 'string' ? j.url : j.url && j.url.url);
                    if (!u) return fin('nolink');
                    test(u);
                });
            });
        };
        var test = function (u) {
            u = firstUrl(u);
            if (!u) return fin('nolink');
            check(u, function (v) { fin(v, u); });
        };
        try { step(comp.requestParams(src.url)); } catch (e) { fin('missing'); }
    }

    /* ---------- источники фильма и итоги проверок ---------- */

    var verdicts = {};   // movieId -> {name: {v, t}}

    function movieId() { try { var m = Lampa.Activity.active().movie; return m && m.id; } catch (e) { return 0; } }
    function sourceList(id) {
        try { var all = Lampa.Storage.cache('skaz_sources', 500, {}) || {}; return (all[id] && all[id].list) || []; } catch (e) { return []; }
    }
    function remember(id, name, v) {
        if (!id || !name) return;
        var now = Date.now();
        (verdicts[id] = verdicts[id] || {})[name] = { v: v, t: now };
        // старые вердикты не читаются (state() ждёт VERDICT_LIFE) - убираем, чтобы память не росла
        for (var k in verdicts) if (verdicts.hasOwnProperty(k)) {
            for (var n in verdicts[k]) if (verdicts[k].hasOwnProperty(n) && now - verdicts[k][n].t > VERDICT_LIFE) delete verdicts[k][n];
            if (!Object.keys(verdicts[k]).length) delete verdicts[k];
        }
    }
    function state(id, name) {
        var r = verdicts[id] && verdicts[id][name];
        return r && Date.now() - r.t < VERDICT_LIFE ? r.v : '';
    }
    function bad(v) { return v === 'dead' || v === 'nolink' || v === 'missing' || v === 'failed'; }

    /** Кандидаты по порядку плагина: без исключённых, пустых (по проверке плагина) и наших плохих. */
    function candidates(comp, exclude) {
        var id = movieId(), list = sourceList(id), keys = [];
        exclude = exclude || [];
        for (var i = 0; i < list.length; i++) {
            var k = list[i].key;
            if (!k || !list[i].url || exclude.indexOf(k) >= 0 || bad(state(id, k))) continue;
            try { if (comp.sourceState && comp.sourceState(k) === 'empty') continue; } catch (e) {}
            keys.push(k);
        }
        try { if (comp.sourceOrder) keys = comp.sourceOrder(keys); } catch (e) {}
        return keys;
    }

    /** Предпочесть проверенный рабочий: для обёртки nextSource. '' — нечего советовать. */
    function preferred(comp, exclude) {
        var id = movieId(), c = candidates(comp, exclude);
        for (var i = 0; i < c.length; i++) if (state(id, c[i]) === 'ok') return c[i];
        return '';
    }

    /** Первый кандидат, которого проверка не признала плохим. */
    function first(comp, exclude) { return candidates(comp, exclude)[0] || ''; }

    /**
     * Гонка: RACE_N лучших кандидатов, у каждого — та же серия. cb(победитель {name, title, verdict} | null, все итоги).
     */
    function race(comp, exclude, want, cb) {
        var id = movieId(), names = candidates(comp, exclude).slice(0, RACE_N);
        var list = sourceList(id), byKey = {};
        list.forEach(function (s) { byKey[s.key] = s; });
        if (!names.length) return cb(null, []);
        var nets = [], results = [], left = names.length, ended = false, deadline = Date.now() + RACE_BUDGET;
        var end = function (win) {
            if (ended) return;
            ended = true;
            clearTimeout(timer);
            nets.forEach(function (n) { try { n.clear(); } catch (e) {} });
            note('гонка: ' + results.map(function (r) { return r.name + '=' + r.verdict; }).join(', ') + (win ? ' → ' + win.name : ' → нет'));
            cb(win, results);
        };
        var best = function () {
            for (var i = 0; i < names.length; i++) {
                var r = results.filter(function (x) { return x.name === names[i]; })[0];
                if (r && r.verdict === 'unknown') return r;    // ссылку дал — пусть решает плеер
            }
            return null;
        };
        var timer = setTimeout(function () { end(best()); }, RACE_BUDGET + 500);
        names.forEach(function (name) {
            resolve(comp, byKey[name], want, deadline, nets, function (r) {
                results.push(r);
                // want.peek — разведка серии, которой может ещё не быть: «нет серии» не делает источник плохим
                if (!(want.peek && r.verdict === 'missing')) remember(id, name, r.verdict);
                if (ended) return;
                if (r.verdict === 'ok') return end(r);
                if (--left === 0) end(best());
            });
        });
        log('гонка', names.join(','));
    }

    return {
        enabled: enabled, check: check, race: race, preferred: preferred, first: first, remember: function (name, v) { remember(movieId(), name, v); },
        state: function (name) { return state(movieId(), name); }, bad: bad, is3D: is3D, prefer2D: prefer2D,
        _verdict: verdict, _decide: decide, _sameVoice: sameVoice, _isSeasonLabel: isSeasonLabel
    };
})();
