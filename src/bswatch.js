/*
 * Удобства просмотра, как у Netflix и Apple TV.
 *
 *  1. Отсчёт «Следующая серия через N» (bs_next_countdown, вкл.) — в последние COUNT секунд серии, если у неё нет
 *     метки титров Skaz (там Lampa показывает свою кнопку «Следующая серия»). ОК — сразу следующая, Назад — досмотреть
 *     титры без автоперехода. Переход по окончании делает сама Lampa (playlist_next), отсчёт только предупреждает;
 *     «Назад» на время этой серии выключает playlist_next и возвращает его на следующем старте.
 *  2. «Вы ещё смотрите?» (bs_still, час): столько времени без единого нажатия на пульт — на старте серии пауза и
 *     вопрос (серии по 30 мин — на 3-й, от часа — на 2-й).
 *     ОК — смотреть дальше, Назад — закрыть плеер. Сериал не крутится всю ночь, трафик не тратится.
 *  3. Предыдущая и следующая серия — кнопки ⏮ ⏭ по бокам от пуска/паузы, как в YouTube («Что сказали?» убрано).
 *  4. Детский режим — свой убран (2.0.1): у Lampa лучше — родительский контроль с ПИН и детский профиль CUB (фильмы
 *     по возрасту). У кого наш был включён — kidsMigrate включает родительский контроль Lampa с тем же ПИН.
 *
 *  5. «Продолжить или сначала» (bs_resume_ask: давно/всегда/нет): фильм или серию не досмотрели и включили снова
 *     спустя RESUME_GAP — пауза и выбор по центру экрана, как в других плеерах: «Продолжить просмотр» / «Начать
 *     с начала». Ждёт ответа; «Назад» — продолжить (у родного «Спрашивать» Lampa по таймауту начиналось сначала).
 *     Пока окно открыто, Lampa место не ставит (timeline.waiting_for_user), «сначала» — timeline.continued.
 *     Только при «Тайм-код: Продолжить» в Lampa (по умолчанию) и не для почти досмотренного (>90 %) и первой минуты.
 *
 *  7. Следующий сезон (bs_next_season, вкл.): последняя серия в списке источника (дальше плейлисту некуда) — заранее,
 *     за NS_ASK с до конца, спрашиваем TMDB, вышел ли следующий сезон (seasonAfter). Вышел — в последние COUNT секунд
 *     «Сезон 3 через N» (ОК — сейчас, Назад — досмотреть титры), потом плеер закрывается и BSFix.nextSeason включает
 *     его первую серию: в том же источнике, если там этот сезон есть, иначе ищет его в других (гонка bsprobe.js) и
 *     говорит, где нашёл. Не вышел — говорим, что дальше: «сезон 3 выйдет 12 марта», «сериал завершён», «следующая серия
 *     ещё не вышла» или «серия 9 уже вышла, но в этом источнике её нет». Только при автопереходе Lampa (playlist_next).
 *  6. Плашка серии: при запуске серии слева сверху на EP_SHOW — сериал, «Сезон 12 · Серия 15» и название серии
 *     (Lampa передаёт его в title), плавно появляется и исчезает; пульт не трогает.
 *
 *  Клавиши в окнах 1, 2 и 5 ловим на document в фазе захвата — раньше Lampa, как таймер сна в bsfeatures.js.
 */
var BSWatch = (function () {
    var COUNT = 15, RESUME_GAP = 12 * 3600 * 1000, EP_SHOW = 4500, NS_ASK = 120, NS_LIFE = 6 * 3600000;
    var BACK = { 8: 1, 27: 1, 461: 1, 10009: 1 };

    function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
    function on(k, def) { var v = lsGet(k); return v === null ? def : v === 'true'; }
    function noty(t, time) { try { Lampa.Noty.show(t, { time: time || 4000 }); } catch (e) {} }
    function log(a, b) { try { console.log('BS watch', a, b === undefined ? '' : b); } catch (e) {} }
    function video() { try { return Lampa.PlayerVideo.video(); } catch (e) { return null; } }

    /* ---------- окно поверх плеера ---------- */

    var box = null, keys = null;
    function overlay(html, onKey, cls) {
        hide();
        box = $('<div class="bs-overlay' + (cls ? ' ' + cls : '') + '">' + html + '</div>');
        $('body').append(box);
        keys = function (e) {
            var r = onKey(e.keyCode);
            if (r) { e.preventDefault(); e.stopPropagation(); }
        };
        document.addEventListener('keydown', keys, true);
    }
    function hide() {
        if (keys) document.removeEventListener('keydown', keys, true);
        keys = null;
        if (box) box.remove();
        box = null;
        mode = '';
    }
    var mode = '';

    /* ---------- 1. отсчёт до следующей серии ---------- */

    var cancelled = false;
    function playlistNext() { try { return !!Lampa.Storage.field('playlist_next'); } catch (e) { return false; } }
    function canNext() { try { return Lampa.PlayerPlaylist.canNext(); } catch (e) { return false; } }
    function endMark() { try { return !!(window.BSPlayer && BSPlayer.hasEndMark && BSPlayer.hasEndMark()); } catch (e) { return false; } }
    function skipShown() { return $('.player-skip').not('.hide').length > 0; }

    /** Показать ли отсчёт: осталось left с из dur. */
    function wantCountdown(left, dur, flags) {
        if (!flags.enabled || !flags.autonext || !flags.next || flags.cancelled || flags.endMark || flags.skip) return false;
        return dur > 300 && left > 0.8 && left <= COUNT;
    }

    function onTime(e) {
        if (!e || !(e.duration > 0)) return;
        var left = e.duration - (e.current || 0);
        if (seasonEnd(left, e.duration)) return;
        var want = wantCountdown(left, e.duration, {
            enabled: on('bs_next_countdown', true), autonext: playlistNext(), next: canNext(),
            cancelled: cancelled, endMark: endMark(), skip: skipShown()
        });
        if (!want) { if (mode === 'next' && left > COUNT + 2) hide(); return; }
        var sec = Math.max(1, Math.ceil(left));
        if (mode !== 'next') {
            overlay('<div class="bs-overlay__title">Следующая серия через <b class="bs-overlay__n">' + sec + '</b></div>' +
                '<div class="bs-overlay__hint">ОК — сейчас · Назад — досмотреть титры</div>', function (code) {
                if (code === 13) { hide(); try { Lampa.PlayerPlaylist.next(); } catch (x) {} return true; }
                if (BACK[code]) { hide(); cancelAutonext(); return true; }
                return false;
            });
            mode = 'next';
        } else box.find('.bs-overlay__n').text(sec);
    }

    function cancelAutonext() {
        cancelled = true;
        try { Lampa.Storage.set('playlist_next', 'false'); lsSet('bs_restore_next', '1'); } catch (e) {}
        noty('Автопереход выключен для этой серии', 2500);
    }
    function restoreAutonext() {
        if (lsGet('bs_restore_next') !== '1') return;
        try { Lampa.Storage.set('playlist_next', 'true'); } catch (e) {}   // переключатели Lampa хранит строками
        lsSet('bs_restore_next', '0');
    }

    /* ---------- 7. следующий сезон ---------- */

    var MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    function dayText(iso) {
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
        return m ? (+m[3]) + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1] : '';
    }
    function aired(iso, now) { var t = Date.parse(String(iso || '') + 'T00:00:00Z'); return t > 0 && t <= now; }
    /**
     * Что после серии e сезона s по данным TMDB (tv/{id}): {state, season, episode, date}
     *  next     — вышел сезон s+1: включаем его первую серию;
     *  more     — в сезоне s уже вышла серия e+1 (в источнике её нет);
     *  wait-ep  — следующая серия сезона s ещё не вышла (date — когда, если известно);
     *  soon     — сезон s+1 объявлен, но не вышел (date);
     *  ended    — сериал завершён; none — нового сезона пока нет.
     */
    function seasonAfter(json, s, e, now) {
        if (!json || !(s > 0)) return null;
        now = now || Date.now();
        var seasons = (json.seasons || []).filter(function (x) { return x && x.season_number > 0; });
        var cur = seasons.filter(function (x) { return x.season_number === s; })[0];
        var nxt = seasons.filter(function (x) { return x.season_number === s + 1; })[0];
        var last = json.last_episode_to_air || null, next = json.next_episode_to_air || null;
        // сколько серий сезона s уже вышло
        var out = cur ? cur.episode_count | 0 : 0;
        if (last && last.season_number === s) out = last.episode_number | 0;
        if (last && last.season_number < s) out = 0;
        if (e > 0 && out > e) return { state: 'more', season: s, episode: e + 1 };
        if (next && next.season_number === s) return { state: 'wait-ep', season: s, episode: next.episode_number | 0, date: next.air_date || '' };
        var nxtAired = nxt && (last && last.season_number > s || aired(nxt.air_date, now) && !(next && next.season_number === s + 1 && next.episode_number === 1));
        if (nxtAired) return { state: 'next', season: s + 1, episode: 1 };
        if (nxt || next && next.season_number === s + 1) return { state: 'soon', season: s + 1, episode: 1, date: next && next.season_number === s + 1 ? next.air_date || '' : (nxt && nxt.air_date) || '' };
        if (/ended|canceled|cancelled/i.test(json.status || '')) return { state: 'ended', season: s };
        return { state: 'none', season: s };
    }
    function seasonText(r) {
        if (!r) return '';
        if (r.state === 'more') return 'Серия ' + r.episode + ' уже вышла, но в этом источнике её нет — выберите другой источник';
        if (r.state === 'wait-ep') return 'Это последняя вышедшая серия' + (r.date ? ' — следующая выйдет ' + dayText(r.date) : '');
        if (r.state === 'soon') return 'Сезон ' + r.season + (r.date ? ' выйдет ' + dayText(r.date) : ' объявлен, но ещё не вышел');
        if (r.state === 'ended') return 'Это была последняя серия — сериал завершён';
        if (r.state === 'none') return 'Это последняя серия — нового сезона пока нет';
        return '';
    }

    var ep = null;          // текущая серия: {card, s, e, info, asked, told, going}
    var nsCache = {};       // card.id -> {at, json}
    function cardOf(data) {
        var card = data && (data.card || data.movie);
        try { if (!card || !card.id) { var a = Lampa.Activity.active() || {}; card = a.movie || a.card || card; } } catch (x) {}
        return card && card.id ? card : null;
    }
    function tvCard(card) { return !!card && !!(card.name || card.original_name || card.number_of_seasons || card.first_air_date); }
    function nsAsk(cb) {
        var id = ep.card.id, c = nsCache[id];
        if (c && Date.now() - c.at < NS_LIFE) return cb(c.json);
        if (!Lampa.TMDB || !Lampa.Reguest || (ep.card.source && ep.card.source !== 'tmdb' && ep.card.source !== 'cub')) return cb(null);
        try {
            new Lampa.Reguest().silent(Lampa.TMDB.api('tv/' + id + '?api_key=' + Lampa.TMDB.key() + '&language=ru'), function (json) {
                nsCache[id] = { at: Date.now(), json: json };
                cb(json);
            }, function () { cb(null); });
        } catch (e) { cb(null); }
    }
    /** Конец последней серии в списке источника. true — отсчёт серии не нужен (этот кадр — наш). */
    function seasonEnd(left, dur) {
        if (!ep || !on('bs_next_season', true) || !playlistNext() || canNext() || !(dur > 300) || cancelled) return false;
        if (!ep.asked && left <= NS_ASK) {
            ep.asked = true;
            var mine = ep;
            nsAsk(function (json) {
                if (ep !== mine) return;
                mine.info = seasonAfter(json, mine.s, mine.e);
                log('после серии', mine.info && mine.info.state);
                lookAhead(mine);
            });
        }
        var r = ep.info;
        if (!r || left > COUNT || left <= 0) return false;
        if (r.state !== 'next' && ep.found) r = ep.found;        // по TMDB ещё нет, а в источнике уже вышла
        if (r.state !== 'next') {
            if (!ep.told) { ep.told = true; noty(seasonText(r), 9000); }
            return false;
        }
        if (ep.going) return true;
        if (left <= 0.8) { goSeason(r.season, r.episode); return true; }
        var sec = Math.max(1, Math.ceil(left));
        if (mode !== 'season') {
            var what = r.season === ep.s ? 'Серия ' + r.episode : 'Сезон ' + r.season;
            overlay('<div class="bs-overlay__title">' + what + ' через <b class="bs-overlay__n">' + sec + '</b></div>' +
                '<div class="bs-overlay__hint">' + (r.where ? 'Есть в «' + esc(r.where) + '» · ' : '') + 'ОК — сейчас · Назад — досмотреть титры</div>', function (code) {
                if (code === 13) { goSeason(r.season, r.episode); return true; }
                if (BACK[code]) { hide(); cancelled = true; noty('Остаюсь в этом сезоне', 2500); return true; }
                return false;
            });
            mode = 'season';
        } else box.find('.bs-overlay__n').text(sec);
        return true;
    }
    /* TMDB часто отстаёт от озвучки (и считает выход по показу в Турции): «ещё не вышла» — проверяем сами источники.
     * Пока идёт последняя серия списка, тихо ищем следующую серию этого сезона, потом первую серию следующего
     * (BSFix.findEpisode — гонка bsprobe.js). Нашли — ep.found, и в конце серии отсчёт, как у нового сезона. */
    function lookAhead(mine) {
        var r = mine.info;
        if (!r || r.state === 'next' || r.state === 'ended' || !window.BSFix || !BSFix.findEpisode) return;
        var tries = [{ season: mine.s, episode: mine.e + 1 }];
        if (r.state !== 'more') tries.push({ season: mine.s + 1, episode: 1 });
        (function one(i) {
            if (i >= tries.length || ep !== mine) return;
            var t = tries[i], ok = false;
            try {
                ok = BSFix.findEpisode(t.season, t.episode, function (win) {
                    if (ep !== mine) return;
                    if (!win) return one(i + 1);
                    mine.found = { state: 'next', season: t.season, episode: t.episode, where: win.title, early: r.state !== 'more' };
                    log('уже вышла в источнике', win.name + ' S' + t.season + 'E' + t.episode);
                });
            } catch (e) { log('поиск серии', e.message); }
            if (!ok) one(i + 1);
        })(0);
    }
    function goSeason(n, episode) {
        if (!ep || ep.going) return;
        ep.going = true;
        var from = ep.s, e = episode > 0 ? episode : 1, same = n === from;
        var what = same ? 'серию ' + e : 'сезон ' + n + ', серию ' + e;
        hide();
        noty((same ? 'Следующая серия! ' : 'Новый сезон! ') + 'Включаю ' + what, 5000);
        try { Lampa.Player.close(); } catch (e2) {}
        setTimeout(function () {
            var started = false;
            try {
                started = window.BSFix && BSFix.nextSeason && BSFix.nextSeason(n, from, function (res) {
                    if (!res) return noty((same ? 'Серии ' + e : 'Сезона ' + n) + ' пока нет в источниках — вышла недавно, попробуйте позже', 9000);
                    if (!res.same) noty((same ? 'Серия ' + e : 'Сезон ' + n) + ' нашлась в «' + res.title + '» — включаю', 6000);
                }, e);
            } catch (x) { log('сезон', x.message); }
            if (!started) noty('Откройте ' + what + ' в списке серий', 6000);
        }, 900);
    }

    /* ---------- 2. «Вы ещё смотрите?» ---------- */

    /* Считаем не серии, а время без пульта: серия по 30 мин — вопрос на 3-й, серия от часа — уже на 2-й (как Netflix:
     * спрашивает по времени без нажатий, а не по числу серий). Серия, которую досмотрели хотя бы наполовину, идёт целиком
     * (титры и пропуск заставки не уменьшают счёт); STILL_SLACK — запас, чтобы серии по 28 мин тоже дали «на 3-й». */
    var STILL_SLACK = 300;
    var idleSec = 0, watch = { dur: 0, played: 0, last: null };
    /** Минуты без пульта до вопроса; 0 — не спрашивать. Старые значения «после N серий» → по времени (60 мин). */
    function stillMinutes() {
        var v = String(lsGet('bs_still') || 'auto');
        if (v === '0') return 0;
        return /^(90|120)$/.test(v) ? +v : 60;
    }
    /** Сколько секунд добавить за закончившуюся серию: досмотрели наполовину — вся длина, иначе — что реально шло. */
    function epSeconds(dur, played) { return dur > 0 && played >= dur / 2 ? dur : played; }
    /** Спросить ли на старте новой серии: idle — секунд просмотра без нажатий до неё. */
    function wantStill(idle, minutes) { return minutes > 0 && idle >= minutes * 60 - STILL_SLACK; }
    function stillTick(e) {
        if (!e || !(e.duration > 0)) return;
        var c = e.current || 0;
        watch.dur = e.duration;
        if (watch.last !== null && c > watch.last && c - watch.last <= 5) watch.played += c - watch.last;   // перемотку не считаем
        watch.last = c;
    }
    function stillReset() { idleSec = 0; watch.played = 0; }
    function stillValue() { var v = String(lsGet('bs_still') || 'auto'); return v === '0' || v === '90' || v === '120' ? v : 'auto'; }

    function askStill() {
        try { Lampa.PlayerVideo.pause(); } catch (e) {}
        overlay('<div class="bs-overlay__title">Вы ещё смотрите?</div>' +
            '<div class="bs-overlay__hint">ОК — продолжить · Назад — закрыть плеер</div>', function (code) {
            if (code === 13) { hide(); stillReset(); try { Lampa.PlayerVideo.play(); } catch (x) {} return true; }
            if (BACK[code]) { hide(); stillReset(); try { Lampa.Player.close(); } catch (x) {} return true; }
            return true;                                         // остальное — мимо плеера, пока не ответили
        });
        mode = 'still';
    }

    /* ---------- 5. «Продолжить или сначала» ---------- */

    function fmt(sec) {
        sec = Math.max(0, Math.floor(sec));
        var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60;
        return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x;
    }

    /** Спросить ли: tl — таймлайн Lampa {percent, time}; rec — наша запись {at}; askMode — 'old' | 'always' | 'off';
     *  timecode — настройка Lampa «Тайм-код». */
    function wantResume(tl, rec, now, askMode, timecode) {
        if (askMode === 'off' || (timecode && timecode !== 'continue') || !tl) return false;
        var pct = +tl.percent || 0, time = +tl.time || 0;
        if (!(pct >= 3 && pct < 90 && time >= 60)) return false;
        if (askMode === 'always') return true;
        return !!rec && now - (rec.at || 0) >= RESUME_GAP;
    }

    var resumeTimer = null;
    function askResume(tl) {
        var sel = 0;
        tl.waiting_for_user = true;                       // Lampa не ставит место, пока не ответили
        var draw = function () { box.find('.bs-overlay__btn').each(function (i) { $(this).toggleClass('focus', i === sel); }); };
        var done = function (again) {
            hide();
            if (again) { tl.continued = true; tl.continued_bloc = true; try { Lampa.PlayerVideo.to(0); } catch (x) {} }
            tl.waiting_for_user = false;                  // «продолжить»: Lampa сама поставит место на следующем кадре
            try { Lampa.PlayerVideo.play(); } catch (x) {}
            log('продолжить или сначала', again ? 'сначала' : 'продолжить с ' + fmt(tl.time));
        };
        overlay('<div class="bs-overlay__btn">Продолжить просмотр<small>с ' + fmt(tl.time) + '</small></div>' +
            '<div class="bs-overlay__btn">Начать с начала</div>', function (code) {
            if (code === 37 || code === 38) { sel = 0; draw(); return true; }
            if (code === 39 || code === 40) { sel = 1; draw(); return true; }
            if (code === 13) { done(sel === 1); return true; }
            if (BACK[code]) { done(false); return true; }
            return true;                                         // остальное — мимо плеера, пока не ответили
        }, 'bs-overlay--choice');
        mode = 'resume';
        draw();
    }

    function onResumeFrame() { if (mode === 'resume') { try { Lampa.PlayerVideo.pause(); } catch (x) {} } }

    function onResumeStart(data) {
        try {
            var tl = data && data.timeline;
            if (!tl || data.iptv && !data.card) return;
            var card = (data.card || data.movie) || (Lampa.Activity.active() || {}).movie;
            var rec = window.BSContinue && BSContinue.last ? BSContinue.last(card, data.season, data.episode) : null;
            var timecode = '';
            try { timecode = Lampa.Storage.field('player_timecode'); } catch (e) {}
            if (wantResume(tl, rec, Date.now(), lsGet('bs_resume_ask') || 'old', timecode)) askResume(tl);
        } catch (e) { log('resume', e.message); }
    }

    /* ---------- 6. плашка серии ---------- */

    var epTimer = null;
    function esc(t) { return String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    /** Текст плашки: show — название сериала, title — то, что Lampa показывает в плеере (название серии или «Серия 15»). */
    function epLines(show, s, e, title) {
        var t = String(title || '').replace(/^\s+|\s+$/g, '');
        // «Серия 15», «15 серия», «S12E15» — не название, его не повторяем
        if (/^(\d+\s*)?(серия|эпизод|episode|s\d+\s*e\d+)(\s*\d+)?$/i.test(t) || t === show) t = '';
        return { show: show || '', ep: 'Сезон ' + s + ' · Серия ' + e, name: t };
    }
    function epBanner(data) {
        clearTimeout(epTimer);
        $('.bs-ep-banner').remove();
        var s = data && data.season, e = data && data.episode;
        if (!(s > 0) || !(e > 0)) return;
        var card = (data.card || data.movie) || {};
        try { if (!card.name) { var a = Lampa.Activity.active() || {}; card = a.movie || a.card || card; } } catch (x) {}
        var l = epLines(card.name || card.original_name || '', s, e, data.title);
        var el = $('<div class="bs-ep-banner">' + (l.show ? '<div class="bs-ep-banner__show">' + esc(l.show) + '</div>' : '') +
            '<div class="bs-ep-banner__ep">' + esc(l.ep) + '</div>' + (l.name ? '<div class="bs-ep-banner__name">' + esc(l.name) + '</div>' : '') + '</div>');
        $('body').append(el);
        setTimeout(function () { el.addClass('bs-ep-banner--on'); }, 50);
        epTimer = setTimeout(function () { el.removeClass('bs-ep-banner--on'); setTimeout(function () { el.remove(); }, 600); }, EP_SHOW);
    }

    /* ---------- 3. предыдущая и следующая серия ---------- */

    function plPos() { try { return Lampa.PlayerPlaylist.position(); } catch (e) { return -1; } }
    function plLen() { try { return (Lampa.PlayerPlaylist.get() || []).length; } catch (e) { return 0; } }

    /** ⏮ и ⏭ — по бокам от пуска/паузы, как в YouTube. Видны, только если в ту сторону есть серия (у фильма — нет). */
    function addButton() {
        try {
            var panel = Lampa.PlayerPanel.render();
            if (!panel) return;
            var pp = panel.find('.player-panel__playpause').first();
            if (!pp.length) return;
            if (!panel.find('.bs-btn-prev').length) {
                var mk = function (cls, go) {
                    var b = $('<div class="button selector bs-panel-btn bs-ep ' + cls + '"><svg><use xlink:href="#sprite-player-next"></use></svg></div>');
                    b.on('hover:enter', function () { try { Lampa.PlayerPlaylist[go](); } catch (e) {} });
                    return b;
                };
                pp.before(mk('bs-btn-prev', 'prev'));
                pp.after(mk('bs-btn-next', 'next'));
            }
            var pos = plPos(), len = plLen();
            panel.find('.bs-btn-prev').toggleClass('hide', !(len > 1 && pos > 0));
            panel.find('.bs-btn-next').toggleClass('hide', !(len > 1 && pos >= 0 && pos < len - 1));
        } catch (e) { log('button', e.message); }
    }

    /* ---------- 4. детский режим: перенос в родительский контроль Lampa ---------- */

    function kidsMigrate() {
        var was = lsGet('bs_kids') === 'true', pin = lsGet('bs_kids_pin');
        try { window.localStorage.removeItem('bs_kids'); window.localStorage.removeItem('bs_kids_pin'); } catch (e) {}
        if (!was || !pin) return false;
        try {
            // включён ли контроль — у Lampa.ParentalControl.enabled() (учитывает и детский профиль CUB); нет API — по
            // настройке. ПИН пишем в те же ключи, что ParentalControl.install: задать готовый ПИН без окна ввода API не умеет
            var P = Lampa.ParentalControl, already = false;
            if (P && typeof P.enabled === 'function') { try { already = !!P.enabled(); } catch (x) { already = !!Lampa.Storage.field('parental_control'); } }
            else already = !!Lampa.Storage.field('parental_control');
            if (!already) {
                Lampa.Storage.set('parental_control_pin', pin);
                Lampa.Storage.set('parental_control', true);
            }
        } catch (e) { log('kids', e.message); }
        setTimeout(function () { noty('Детский режим — теперь родительский контроль Lampa, ПИН прежний', 8000); }, 6000);
        return true;
    }

    /* ---------- настройки и запуск ---------- */

    function addSettings() {
        if (!Lampa.SettingsApi) return;
        var C = 'bs_update', api = Lampa.SettingsApi;
        api.addParam({
            component: C, param: { name: 'bs_next_countdown', type: 'trigger', 'default': true },
            field: { name: 'Отсчёт до следующей серии', description: 'ОК — сразу следующая, Назад — досмотреть титры.' },
            onChange: function (v) { lsSet('bs_next_countdown', String(v === true || v === 'true')); }
        });
        api.addParam({
            component: C, param: { name: 'bs_next_season', type: 'trigger', 'default': true },
            field: { name: 'Следующий сезон сам', description: 'После последней серии сезона — первая серия нового, если он вышел. Нет — скажет, когда выйдет.' },
            onChange: function (v) { lsSet('bs_next_season', String(v === true || v === 'true')); }
        });
        api.addParam({
            component: C, param: { name: 'bs_still', type: 'select', values: { auto: 'Через час без пульта', '90': 'Через 1,5 часа', '120': 'Через 2 часа', '0': 'Не спрашивать' }, 'default': stillValue() },
            field: { name: '«Вы ещё смотрите?»', description: 'Пауза, если долго не нажимали пульт: серии по 30 мин — на 3-й, от часа — на 2-й.' },
            onChange: function (v) { lsSet('bs_still', String(v)); }
        });
        api.addParam({
            component: C, param: { name: 'bs_resume_ask', type: 'select', values: { old: 'Если смотрели давно', always: 'Всегда спрашивать', off: 'Не спрашивать' }, 'default': lsGet('bs_resume_ask') || 'old' },
            field: { name: 'Продолжить или сначала', description: 'Не досмотрели и включили снова — спросит, откуда смотреть.' },
            onChange: function (v) { lsSet('bs_resume_ask', String(v)); }
        });
    }

    function start() {
        restoreAutonext();
        try { addSettings(); } catch (e) {}
        try { kidsMigrate(); } catch (e) { log('kids', e.message); }
        // любое нажатие на пульт — человек у экрана
        // человек у экрана — всё, что делает он сам: кнопки пульта (пауза, перемотка, ОК, громкость, если она доходит до
        // приложения), касание и мышь на Android, громкость ТВ на Samsung (bsvolume.js → BSWatch.activity). Перемотки,
        // которые плеер делает сам (пропуск заставки, «продолжить с места»), — не нажатия и счёт не сбрасывают.
        document.addEventListener('keydown', stillReset, true);
        ['touchstart', 'mousedown', 'wheel'].forEach(function (ev) { try { document.addEventListener(ev, stillReset, true); } catch (e) {} });
        try {
            Lampa.Player.listener.follow('start', function (data) {
                hide();
                var card = cardOf(data);
                ep = data && data.season > 0 && data.episode > 0 && tvCard(card) ? { card: card, s: data.season | 0, e: data.episode | 0 } : null;
                setTimeout(function () { epBanner(data); }, 800);
                clearInterval(resumeTimer); resumeTimer = null;
                cancelled = false;
                restoreAutonext();
                idleSec += epSeconds(watch.dur, watch.played);
                watch = { dur: 0, played: 0, last: null };
                setTimeout(addButton, 300);
                if (wantStill(idleSec, stillMinutes())) setTimeout(function () { if (!mode) askStill(); }, 2500);

            });
            // после 'start' Lampa (needToContinue) сама сбрасывает timeline.waiting_for_user — спрашиваем на 'ready',
            // он приходит сразу после, до первого кадра (место Lampa ставит на первом timeupdate)
            Lampa.Player.listener.follow('ready', function (data) { onResumeStart(data); });
            Lampa.Player.listener.follow('destroy', function () { clearTimeout(epTimer); $('.bs-ep-banner').remove(); clearInterval(resumeTimer); resumeTimer = null; hide(); restoreAutonext(); });
            Lampa.PlayerVideo.listener.follow('timeupdate', onTime);
            Lampa.PlayerVideo.listener.follow('timeupdate', stillTick);
            Lampa.PlayerVideo.listener.follow('timeupdate', onResumeFrame);
        } catch (e) { log('listen', e.message); }
    }

    return { start: start, activity: stillReset, _seasonAfter: seasonAfter, _seasonText: seasonText, _seasonEnd: seasonEnd, _setEp: function (x) { ep = x; }, _wantCountdown: wantCountdown, _wantStill: wantStill, _epSeconds: epSeconds, _stillMinutes: stillMinutes, _wantResume: wantResume, _epLines: epLines, _kidsMigrate: kidsMigrate };
})();
