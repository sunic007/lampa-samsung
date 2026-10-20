/*
 * «Продолжить с места» — как у Netflix: один ОК, и фильм или серия идут дальше с того же места, из того же источника,
 * в той же озвучке.
 *
 *  Память. Во время просмотра через источники Skaz (BSFix.current() — видео пошло из плагина) запоминаем карточку,
 *  сезон, серию, позицию и длительность: bs_resume, до MAX записей, свежие сверху. Досмотренный фильм (>92 %)
 *  из списка уходит; досмотренная серия помечается done — продолжать будем со следующей.
 *  Запуск. Открываем карточку (как Lampa), на ней — кнопку Skaz (тот же обработчик, что у пульта). Сериал: плагин сам
 *  ставит источник, сезон и озвучку из своей памяти (online_watched_last) и умеет сразу включить серию
 *  (lampac_continue_episode в объекте экрана) — мы этот номер добавляем при открытии экрана источников. Фильм: когда
 *  плагин нарисует список, выбираем то, что он сам предлагает продолжить (uiPickResume), — как автоподбор в bsfix.js.
 *  Позицию внутри видео восстанавливает сама Lampa (таймлайн). Lampa.Timeline — главный источник: при запуске берём
 *  то место, что свежее (наше или Lampa/CUB), досмотренную в Lampa серию считаем досмотренной; нет timeline у
 *  плеера — пишем место в Lampa сами (Timeline.update). Нет API (старая Lampa) — только наша память.
 *
 *  Своего ряда на главной Lampa нет (1.7.0–1.7.11 был «Продолжить с места» — дублировал родной «Продолжить просмотр»
 *  Lampa; убран в 1.7.12): продолжение — плитками панели ТВ (bshub.js).
 *  Панель ТВ (Smart Hub) — bshub.js: берёт отсюда hubItems(); нажатие плитки (bs_resume в action_data) ловит noteResume.
 *  Новые серии: для досмотренных до конца сериалов раз в 12 часов спрашиваем TMDB о последней вышедшей серии; вышла
 *  новая — метка «Новая серия» на карточке и тихое уведомление при запуске (один раз на серию).
 */
var BSContinue = (function () {
    var MAX = 20, DONE = 0.92, KEY = 'bs_resume';

    function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
    function on(k, def) { var v = lsGet(k); return v === null ? def : v === 'true'; }
    function log(a, b) { try { console.log('BS continue', a, b === undefined ? '' : b); } catch (e) {} }
    function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function quiet(t, time) {
        try { if (window.BSSkaz && BSSkaz.toast) return BSSkaz.toast(t, time || 6000); } catch (e) {}
        try { Lampa.Noty.show(esc(t), { time: time || 6000 }); } catch (e) {}
    }

    /* ---------- память ---------- */

    function load() {
        var list = [];
        try { list = JSON.parse(lsGet(KEY) || '[]') || []; } catch (e) {}
        return Object.prototype.toString.call(list) === '[object Array]' ? list.filter(function (r) { return r && r.card && r.card.id; }) : [];
    }
    function save(list) { lsSet(KEY, JSON.stringify(list.slice(0, MAX))); }
    function keyOf(card) { return String(card.source || 'tmdb') + ':' + card.id; }
    function find(list, card) { var k = keyOf(card); for (var i = 0; i < list.length; i++) if (keyOf(list[i].card) === k) return i; return -1; }

    var CARD_FIELDS = ['id', 'title', 'name', 'original_title', 'original_name', 'poster_path', 'backdrop_path', 'release_date',
        'first_air_date', 'number_of_seasons', 'source', 'img', 'poster', 'vote_average', 'original_language'];
    function slim(card) {
        var o = {};
        for (var i = 0; i < CARD_FIELDS.length; i++) if (card[CARD_FIELDS[i]] !== undefined && card[CARD_FIELDS[i]] !== null) o[CARD_FIELDS[i]] = card[CARD_FIELDS[i]];
        return o;
    }
    function isTv(card) { return !!(card.name || card.original_name || card.number_of_seasons || card.first_air_date); }

    /** Записать позицию. card — карточка Lampa; s/e — сезон и серия (у фильма 0); pos/dur — секунды. */
    function record(card, s, e, pos, dur, now) {
        if (!card || !(card.id > 0) || !(dur > 120) || !(pos >= 0)) return null;
        now = now || Date.now();
        var list = load(), i = find(list, card), done = pos / dur >= DONE;
        var old = i >= 0 ? list[i] : null;
        if (i >= 0) list.splice(i, 1);
        if (!isTv(card) && done) { save(list); return null; }         // фильм досмотрен — продолжать нечего
        if (pos < 30 && !done && !(old && old.s === (s | 0) && old.e === (e | 0))) {
            // включили и сразу закрыли новую серию/фильм — прежнюю запись не теряем
            if (old) list.unshift(old);
            save(list);
            return old;
        }
        var r = { card: slim(card), s: s | 0, e: e | 0, pos: Math.floor(pos), dur: Math.floor(dur), at: now, done: done };
        if (old && old.news) r.news = old.news;
        if (old && old.checked) r.checked = old.checked;
        list.unshift(r);
        save(list);
        return r;
    }

    function remove(card) {
        var list = load(), i = find(list, card);
        if (i >= 0) { list.splice(i, 1); save(list); }
    }

    /** Подпись: «S2 E5 · осталось 23 мин», «S2 E6 — следующая», «осталось 1 ч 05 мин». */
    function label(r) {
        if (r.news) return 'Новая серия S' + r.news.s + ' E' + r.news.e;
        var left = Math.max(0, r.dur - r.pos), m = Math.round(left / 60), t;
        t = m >= 60 ? Math.floor(m / 60) + ' ч ' + (m % 60 < 10 ? '0' : '') + (m % 60) + ' мин' : Math.max(1, m) + ' мин';
        if (!r.s && !r.e) return 'осталось ' + t;
        if (r.done) return 'S' + r.s + ' E' + (r.e + 1) + ' — следующая';
        return 'S' + r.s + ' E' + r.e + ' · осталось ' + t;
    }

    /* ---------- таймлайн Lampa (Lampa.Timeline) ---------- */
    /* Lampa хранит своё место просмотра (file_view, синхронизация CUB). Наша запись — запасная: решаем по той, что
     * свежее (штамп updated есть в Lampa 3.x; нет штампа — по тому, где позиция дальше). В Lampa пишем только когда
     * плагин не передал плееру timeline (иначе Lampa пишет сама) — простым объектом, без функций (handler из view()
     * в $.param не попадает). Старые сборки Lampa без Timeline.view/update — всё как раньше, только наша память. */

    /** Хеш и привязка таймлайна Lampa — как в Timeline.watched/watchedEpisode. null — API нет или карточка без названия. */
    function lampaKey(card, s, e) {
        try {
            var T = Lampa.Timeline;
            if (!card || !T || typeof T.view !== 'function' || !Lampa.Utils || typeof Lampa.Utils.hash !== 'function') return null;
            s = s | 0; e = e | 0;
            var tv = s > 0 && e > 0, name = tv ? (card.original_name || card.original_title) : (card.original_title || card.original_name);
            if (!name) return null;
            var hash = Lampa.Utils.hash(tv ? [s, s > 10 ? ':' : '', e, name].join('') : name);
            var meta = null;
            if (typeof T.link === 'function') { try { meta = T.link(card, s, e) || null; } catch (x) { meta = null; } }
            return { hash: hash, meta: meta };
        } catch (x) { return null; }
    }

    /** Место из Lampa: {time, percent, duration, updated} — только числа (handler и прочее не берём). null — нет. */
    function lampaView(card, s, e) {
        var k = lampaKey(card, s, e);
        if (!k) return null;
        try {
            var v = k.meta ? Lampa.Timeline.view(k.hash, k.meta) : Lampa.Timeline.view(k.hash);
            if (!v) return null;
            return { time: +v.time || 0, percent: +v.percent || 0, duration: +v.duration || 0, updated: +v.updated || 0 };
        } catch (x) { return null; }
    }

    /** Чья запись главнее: ours — {pos, dur, at}, tl — {time, percent, duration, updated}. 'ours' | 'lampa' | ''. */
    function pickLater(ours, tl) {
        var tlTime = tl ? (+tl.time || 0) || (tl.percent > 0 && (tl.duration || (ours && ours.dur)) ? Math.round(tl.percent / 100 * (tl.duration || ours.dur)) : 0) : 0;
        var has = !!(tl && (tlTime > 0 || tl.percent > 0));
        if (!ours || !(ours.pos > 0)) return has ? 'lampa' : '';
        if (!has) return 'ours';
        if (tl.updated > 0 && ours.at > 0) return ours.at > tl.updated ? 'ours' : 'lampa';
        return ours.pos > tlTime ? 'ours' : 'lampa';
    }

    /** Поправить timeline плеера нашей записью, если она свежее: Lampa сама перемотает на time и запишет место
     *  (и в CUB). Только не досмотренное и с разницей больше 30 с. Вернёт true, если поправили. */
    function mergeTimeline(tl, rec) {
        if (!tl || !rec || rec.done || !(rec.dur > 120) || !(rec.pos > 30) || rec.pos / rec.dur >= 0.9) return false;
        if (pickLater(rec, tl) !== 'ours' || Math.abs(rec.pos - (+tl.time || 0)) <= 30) return false;
        tl.time = rec.pos;
        tl.percent = Math.round(rec.pos / rec.dur * 100);
        if (!(tl.duration > 0)) tl.duration = rec.dur;
        return true;
    }

    /** Записать место в таймлайн Lampa официальным Timeline.update — простыми полями. */
    function lampaSave(k, pos, dur) {
        try {
            var T = Lampa.Timeline;
            if (!k || !T || typeof T.update !== 'function' || !(dur > 0) || !(pos >= 0)) return false;
            var p = { hash: k.hash, percent: Math.min(100, Math.round(pos / dur * 100)), time: Math.round(pos), duration: Math.round(dur) };
            if (k.meta && k.meta.card) {
                p.card = String(k.meta.card);
                if (k.meta.season !== undefined) p.season = k.meta.season | 0;
                if (k.meta.episode !== undefined) p.episode = k.meta.episode | 0;
            }
            T.update(p);
            return true;
        } catch (x) { log('timeline', x.message); return false; }
    }

    /* ---------- что сейчас играет ---------- */

    var cur = null;     // {card, s, e, pos, dur}

    function activeCard() {
        try {
            var a = Lampa.Activity.active() || {};
            var c = a.movie || a.card || (a.object && (a.object.movie || a.object.card)) || null;
            return c && c.id > 0 ? c : null;
        } catch (e) { return null; }
    }

    function onStart(data) {
        // следующая серия в том же плеере — 'destroy' не было, сохраняем прежнюю
        if (cur && cur.dur > 120) {
            record(cur.card, cur.s, cur.e, cur.pos, cur.dur);
            if (cur.lk && cur.pos > 30) lampaSave(cur.lk, cur.pos, cur.dur);
        }
        cur = null;
        try {
            // только видео из источников Skaz: продолжить можно только через них
            var lp = window.BSFix && BSFix.current && BSFix.current();
            if (!lp) return;
            var card = (data && (data.card || data.movie)) || activeCard();
            if (!card || !(card.id > 0)) return;
            cur = { card: card, s: (data && data.season) | 0, e: (data && data.episode) | 0, pos: 0, dur: 0, saved: 0, lsaved: 0, lk: null };
            if (data && data.timeline) {
                // место ставит Lampa по timeline — наша запись свежее и дальше? подсказываем ей
                if (mergeTimeline(data.timeline, last(card, cur.s, cur.e))) log('место из нашей памяти', data.timeline.time);
            } else cur.lk = lampaKey(card, cur.s, cur.e);          // плагин не дал timeline — место в Lampa пишем сами
        } catch (e) { cur = null; }
    }

    function onTime(e) {
        if (!cur || !e) return;
        var d = typeof e.duration === 'number' ? e.duration : 0, c = typeof e.current === 'number' ? e.current : 0;
        if (d > 0 && isFinite(d)) cur.dur = d;
        if (c > 0) cur.pos = c;
        if (Date.now() - cur.saved > 15000 && cur.dur > 120 && cur.pos > 30) { cur.saved = Date.now(); record(cur.card, cur.s, cur.e, cur.pos, cur.dur); }
        if (cur.lk && Date.now() - cur.lsaved > 60000 && cur.dur > 120 && cur.pos > 30) { cur.lsaved = Date.now(); lampaSave(cur.lk, cur.pos, cur.dur); }
    }

    function onStop() {
        if (cur && cur.dur > 120) {
            record(cur.card, cur.s, cur.e, cur.pos, cur.dur);
            if (cur.lk && cur.pos > 30) lampaSave(cur.lk, cur.pos, cur.dur);
        }
        cur = null;
        setTimeout(function () { try { if (window.BSHub) BSHub.push(); } catch (e) {} }, 3000);
    }

    /* ---------- запуск с места ---------- */

    var pending = null;   // {id, tv, episode, until} — экран источников открыт, ждём список
    var want = null;      // {id, until} — открывается карточка, которую надо продолжить

    /* Карточку Lampa подменяет полными данными TMDB ещё до 'complite' — метку в ней не донести. Поэтому «продолжить»
     * помним здесь: из resume() и из плитки панели ТВ (bs_resume в action_data → объект экрана Lampa). */
    function noteResume(o) {
        if (o && o.component === 'full' && o.card && o.card.bs_resume) {
            want = { id: o.card.id, until: Date.now() + 90000 };
            delete o.card.bs_resume;
        }
    }

    /** Продолжить: открыть карточку и источники Skaz; дальше — handleFull и onDraw. */
    function resume(r) {
        if (!r || !r.card) return;
        var card = slim(r.card);
        want = { id: card.id, until: Date.now() + 90000 };
        try {
            Lampa.Activity.push({ url: '', component: 'full', id: card.id, method: isTv(card) ? 'tv' : 'movie', card: card, source: card.source || 'tmdb' });
        } catch (e) { log('push', e.message); }
    }

    /** Номер серии, которую включить: из памяти плагина (там источник/озвучка/сезон), +1, если мы видели её досмотренной. */
    function targetEpisode(card, r) {
        var w = null;
        try {
            var id = Lampa.Utils.hash(card.number_of_seasons || card.original_name ? card.original_name : card.original_title);
            w = (Lampa.Storage.cache('online_watched_last', 5000, {}) || {})[id] || null;
        } catch (e) {}
        var s = w && parseInt(w.season, 10) || (r && r.s) || 0, ep = w && parseInt(w.episode, 10) || (r && r.e) || 0;
        // у нас серия не досмотрена, а в Lampa (в т. ч. с другого устройства через CUB) — досмотрена и свежее: следующая
        if (r && !r.done && r.s === s && r.e === ep) {
            var tl = lampaView(card, s, ep);
            if (tl && tl.percent >= DONE * 100 && pickLater(r, tl) === 'lampa') r = { s: r.s, e: r.e, done: true, news: r.news };
        }
        if (r && r.done && r.s === s && r.e === ep) ep++;
        if (r && r.news && r.done && r.news.s === s) ep = Math.max(ep, r.e + 1);
        return { season: s, episode: ep, known: !!w };
    }

    function handleFull(e) {
        var obj = e && e.object, card = (obj && obj.card) || (e && e.data && e.data.movie);
        if (!want || !card || card.id != want.id || Date.now() > want.until) return;
        want = null;                                             // назад на карточку — снова не запускаем
        var r = null, list = load(), i = find(list, card);
        if (i >= 0) r = list[i];
        var tv = isTv(card), t = tv ? targetEpisode(card, r) : null;
        // номер серии — только когда плагин помнит сезон (иначе включилась бы серия из другого сезона)
        pending = { id: card.id, tv: tv, episode: t && t.known ? t.episode : 0, until: Date.now() + 60000 };
        var tries = 0;
        (function press() {
            var btn = e.body && e.body.find('.lampac--button').first();
            if (!btn || !btn.length) {
                if (++tries < 12) return setTimeout(press, 250);
                pending = null;
                return quiet('Источники Skaz не загрузились — выберите вручную');
            }
            quiet(tv && pending && pending.episode ? 'Продолжаю: сезон ' + t.season + ', серия ' + t.episode : 'Продолжаю с места', 3000);
            btn.trigger('hover:enter');
        })();
    }

    /* Экран источников открывается через Activity.push из плагина — сериалу добавляем номер серии, которую плагин
     * сам включит после отрисовки списка (lampac_continue_episode). Свой номер плагина заменяем: он не знает, что
     * серия досмотрена, и включил бы её заново.
     * «Онлайн» / «Смотреть» на начатом (bs_online_resume, вкл.): так же — сериал сразу со своей серии (досмотрена —
     * следующая), фильм — с места (onDraw). Не начатое — экран источников как обычно. */
    function autoResume(o) {
        if (pending || o.lampac_continue_episode || !o.movie || !(o.movie.id > 0)) return;
        var list = load(), i = find(list, o.movie);
        if (i < 0) {
            // фильм ещё не смотрели — «Смотреть» сразу включает русскую озвучку (bs_ru_auto), если в Skaz не выбрано иное
            if (!isTv(o.movie) && on('bs_ru_auto', true) && !skazWantsOriginal()) {
                pending = { id: o.movie.id, tv: false, episode: 0, until: Date.now() + 60000, ru: true, depth: 0 };
                quiet('Включаю русскую озвучку', 3000);
                log('фильм — сразу по-русски', o.movie.id);
            }
            return;
        }
        if (!on('bs_online_resume', true)) return;
        var r = list[i];
        if (isTv(o.movie) && skazAsksContinue()) return;    // Skaz уже спросил «Продолжить?» — его ответ, в том числе «Нет», не перебиваем
        if (isTv(o.movie)) {
            var t = targetEpisode(o.movie, r);
            if (!t.known || !t.episode) return;                 // плагин не помнит источник/сезон — пусть выбирают
            o.lampac_continue_episode = t.episode;
            quiet('Продолжаю: сезон ' + t.season + ', серия ' + t.episode, 3000);
        } else {
            pending = { id: o.movie.id, tv: false, episode: 0, until: Date.now() + 60000 };
            quiet('Продолжаю с места', 3000);
        }
        log('онлайн — сразу с места', o.movie.id);
    }

    /* Skaz — один из источников, не главный по умолчанию в логике: автозапуск — на экране любого онлайн-источника из
     * списка (Skaz и bssources.js: Z01, Vod, Online Mod, Showy…). Плагины на Lampac понимают lampac_continue_episode и
     * рисуют список через uiDraw (onDraw); остальным эти поля просто не мешают. */
    function lampacScreen(o) {
        if (!o || !o.component) return false;
        if (o.component === 'lampacskaz') return true;
        var list = window.BSSources && window.BSSources.list || [];
        for (var i = 0; i < list.length; i++) if ((list[i].comp || []).indexOf(o.component) >= 0) return true;
        return false;
    }

    function hookPush() {
        var A = Lampa.Activity, push = A.push;
        if (!push || push.__bsCont) return;
        A.push = function (o) {
            try { noteResume(o); } catch (e) {}
            try {
                if (lampacScreen(o) && pending && pending.tv && pending.episode && Date.now() < pending.until &&
                    o.movie && o.movie.id == pending.id) {
                    o.lampac_continue_episode = pending.episode;
                    pending = null;
                } else if (lampacScreen(o)) autoResume(o);
            } catch (e) {}
            return push.apply(this, arguments);
        };
        A.push.__bsCont = true;
    }

    /** Насколько вариант — русская озвучка: дубляж 3, многоголосый/профессиональный 2, прочая русская 1,
     *  не русская (украинская, оригинал, субтитры, казахская, узбекская, турецкая…) −1. */
    var NOT_RU = /укр|ukr|україн|оригинал|original|англ|\beng\b|english|субтит|\bsub|казах|qaz|узбек|uzb|o'zbek|турец|türk|\btr\b|грузин|армян|белорус/i;
    function ruScore(it) {
        var t = [it.translate, it.voice_name, it.title, it.text, it.details, it.info].filter(function (x) { return typeof x === 'string'; }).join(' ');
        if (NOT_RU.test(t)) return -1;
        if (/дубл|dub/i.test(t)) return 3;
        if (/многоголос|профессион|mvo/i.test(t)) return 2;
        return 1;
    }
    /** Skaz (onlines.js) запоминает тип перевода (skaz_voice_pref) — выбрали оригинал или субтитры: по-русски не включаем. */
    function skazWantsOriginal() {
        try {
            if (Lampa.Storage.get('skaz_voice_auto', true) === false) return false;
            var p = Lampa.Storage.get('skaz_voice_pref', '');
            return p === 'orig' || p === 'sub';
        } catch (e) { return false; }
    }
    /** Классический вид Skaz с «Предлагать продолжение» сам спрашивает «Продолжить?» перед экраном источников. */
    function skazAsksContinue() {
        try { return Lampa.Storage.get('skaz_ui_mode', 'modern') === 'classic' && Lampa.Storage.field('lampac_continue_play') === true; }
        catch (e) { return false; }
    }

    function pickRu(list) {
        var best = null, bs = 0;
        for (var i = 0; i < list.length; i++) { var sc = ruScore(list[i]); if (sc > bs) { bs = sc; best = list[i]; } }
        return best;
    }

    /** Зовёт bsfix.js, когда плагин нарисовал список. Фильм: включить то, что плагин предлагает продолжить,
     *  а не начатый — русскую озвучку (папка озвучки — зайти в неё, не глубже двух раз). */
    function onDraw(items, params, comp) {
        if (!pending || pending.tv || Date.now() > pending.until) return;
        var card = activeCard();
        if (!card || card.id != pending.id || !params || typeof params.onEnter !== 'function') return;
        // 3D (SBS/OU) сами не включаем, пока есть обычная версия (bsprobe.js prefer2D)
        var flat = window.BSProbe && BSProbe.prefer2D ? BSProbe.prefer2D : function (l) { return l; };
        var all = flat((items || []).filter(function (it) { return it; }));
        var playable = flat(all.filter(function (it) { return it.method !== 'link'; }));
        var hit = null, enter = function (it) { setTimeout(function () { try { params.onEnter(it, $('<div></div>')); } catch (e) { log('onEnter', e.message); } }, 600); };
        if (pending.ru) {
            hit = pickRu(playable);
            if (!hit && !playable.length && pending.depth < 2) {      // озвучки — папками: в русскую
                var folder = pickRu(all.filter(function (it) { return it.method === 'link' && !it.similar; }));
                if (folder) { pending.depth++; pending.until = Date.now() + 60000; return enter(folder); }
            }
            pending = null;
            if (!hit) return quiet('Русской озвучки нет — выберите вручную', 4000);
            log('русская озвучка', [hit.translate, hit.voice_name, hit.title].filter(Boolean).join(' / '));
            return enter(hit);
        }
        if (!playable.length) return;                            // папки озвучек — выбор за человеком
        try { if (comp && typeof comp.uiPickResume === 'function') hit = comp.uiPickResume(playable); } catch (e) {}
        if (!hit || playable.indexOf(hit) < 0) hit = playable[0];
        pending = null;
        enter(hit);
    }

    /* Запуск плиткой панели ТВ: Lampa кладёт объект экрана в start_deep_link до готовности (наша обёртка push ещё не
     * стоит) — ловим его, пока Lampa запускается. */
    (function early() {
        var t0 = Date.now(), timer = setInterval(function () {
            try { if (window.start_deep_link) noteResume(window.start_deep_link); } catch (e) {}
            if (window.appready || Date.now() - t0 > 120000) clearInterval(timer);
        }, 50);
    })();

    /* ---------- для панели ТВ (bshub.js) ---------- */

    /** Записи для ряда Smart Hub: карточка (с меткой bs_resume — нажатие плитки продолжит) и подпись. */
    function hubItems() {
        if (!on('bs_continue_row', true)) return [];
        var list = load();
        // вышла новая серия — такие сериалы первыми
        list = list.filter(function (r) { return r.news; }).concat(list.filter(function (r) { return !r.news; }));
        return list.slice(0, 8).map(function (r) {
            var c = slim(r.card);
            c.bs_resume = 1;
            return { card: c, subtitle: label(r) };
        });
    }

    /* ---------- новые серии ---------- */

    /** Вышла ли серия новее досмотренной: last — {season_number, episode_number, air_date} из TMDB. */
    function newer(r, last, now) {
        if (!r || !r.done || !last) return null;
        var s = last.season_number | 0, e = last.episode_number | 0;
        if (!s || !e || s * 10000 + e <= r.s * 10000 + r.e) return null;
        var air = Date.parse(last.air_date || '');
        if (!(air > 0) || (now || Date.now()) - air > 21 * 86400000) return null;   // давно вышла — это не «новая»
        return { s: s, e: e };
    }

    function checkNews() {
        if (!on('bs_continue_row', true) || !Lampa.TMDB || !Lampa.Reguest) return;
        var list = load().filter(function (r) { return isTv(r.card) && r.done && (r.card.source || 'tmdb') === 'tmdb' && Date.now() - (r.checked || 0) > 12 * 3600000; }).slice(0, 10);
        (function next() {
            var r = list.shift();
            if (!r) return;
            var url = Lampa.TMDB.api('tv/' + r.card.id + '?api_key=' + Lampa.TMDB.key() + '&language=ru');
            new Lampa.Reguest().silent(url, function (json) {
                var all = load(), i = find(all, r.card);
                if (i >= 0) {
                    var n = newer(all[i], json && json.last_episode_to_air);
                    all[i].checked = Date.now();
                    var was = all[i].news;
                    if (n) all[i].news = n; else delete all[i].news;
                    save(all);
                    var noted = lsGet('bs_news_noted') || '';
                    var tag = r.card.id + ':' + (n && n.s) + ':' + (n && n.e);
                    if (n && (!was || was.e !== n.e || was.s !== n.s) && noted.indexOf('|' + tag + '|') < 0) {
                        lsSet('bs_news_noted', ('|' + tag + '|' + noted).slice(0, 2000));
                        quiet('Вышла новая серия: ' + (r.card.name || r.card.title) + ', S' + n.s + ' E' + n.e, 8000);
                    }
                }
                setTimeout(next, 1500);
            }, function () { setTimeout(next, 1500); });
        })();
    }

    /* ---------- настройки и запуск ---------- */

    function addSettings() {
        if (!Lampa.SettingsApi) return;
        Lampa.SettingsApi.addParam({ component: 'bs_update', param: { name: 'bs_cont_title', type: 'title' }, field: { name: 'Просмотр' } });
        Lampa.SettingsApi.addParam({
            component: 'bs_update',
            param: { name: 'bs_continue_row', type: 'trigger', 'default': true },
            field: { name: 'Новые серии', description: 'Уведомление при запуске, когда у начатого сериала вышла новая серия.' },
            onChange: function (v) { lsSet('bs_continue_row', String(v === true || v === 'true')); }
        });
        Lampa.SettingsApi.addParam({
            component: 'bs_update',
            param: { name: 'bs_ru_auto', type: 'trigger', 'default': true },
            field: { name: 'Фильм — сразу по-русски', description: '«Смотреть» включает фильм в русской озвучке, без выбора.' },
            onChange: function (v) { lsSet('bs_ru_auto', String(v === true || v === 'true')); }
        });
        Lampa.SettingsApi.addParam({
            component: 'bs_update',
            param: { name: 'bs_online_resume', type: 'trigger', 'default': true },
            field: { name: '«Смотреть» — сразу с места', description: 'Начатый сериал или фильм включается там, где остановились.' },
            onChange: function (v) { lsSet('bs_online_resume', String(v === true || v === 'true')); }
        });
    }

    function start() {
        try { addSettings(); } catch (e) {}
        try { hookPush(); } catch (e) { log('hook', e.message); }
        try {
            Lampa.Player.listener.follow('start', onStart);
            Lampa.Player.listener.follow('destroy', onStop);
            Lampa.PlayerVideo.listener.follow('timeupdate', onTime);
            Lampa.Listener.follow('full', function (e) { if (e && e.type === 'complite') handleFull(e); });
        } catch (e) { log('listen', e.message); }
        setTimeout(checkNews, 20000);
    }

    /** Запись о прошлом просмотре этой карточки (и серии): {pos, dur, at} или null. */
    function last(card, s, e) {
        if (!card || !(card.id > 0)) return null;
        var list = load(), i = find(list, card);
        if (i < 0) return null;
        var r = list[i];
        return (r.s | 0) === (s | 0) && (r.e | 0) === (e | 0) ? r : null;
    }

    return { start: start, onDraw: onDraw, _ruScore: ruScore, _pickRu: pickRu, resume: resume, last: last, _record: record, _load: load, _label: label, _newer: newer, hubItems: hubItems, _targetEpisode: targetEpisode, _autoResume: autoResume, _sourceScreen: lampacScreen,
        _pickLater: pickLater, _mergeTimeline: mergeTimeline, _lampaKey: lampaKey, _lampaView: lampaView, _lampaSave: lampaSave, _onStart: onStart, _onTime: onTime, _onStop: onStop };
})();
