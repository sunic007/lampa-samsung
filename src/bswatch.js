/*
 * Удобства просмотра, как у Netflix и Apple TV.
 *
 *  1. Отсчёт «Следующая серия через N» (bs_next_countdown, вкл.) — в последние COUNT секунд серии, если у неё нет
 *     метки титров Skaz (там Lampa показывает свою кнопку «Следующая серия»). ОК — сразу следующая, Назад — досмотреть
 *     титры без автоперехода. Переход по окончании делает сама Lampa (playlist_next), отсчёт только предупреждает;
 *     «Назад» на время этой серии выключает playlist_next и возвращает его на следующем старте.
 *  2. «Вы ещё смотрите?» (bs_still, 3 серии): столько серий подряд без единого нажатия на пульт — пауза и вопрос.
 *     ОК — смотреть дальше, Назад — закрыть плеер. Сериал не крутится всю ночь, трафик не тратится.
 *  3. Предыдущая и следующая серия — кнопки ⏮ ⏭ по бокам от пуска/паузы, как в YouTube («Что сказали?» убрано).
 *  4. Детский режим (bs_kids, ПИН): прячет «Клубничку» (18+), «Пиратские плагины» и установку плагинов, не открывает
 *     карточки «для взрослых» (adult у TMDB). Выключение — только с ПИН.
 *
 *  5. «Продолжить или сначала» (bs_resume_ask: давно/всегда/нет): фильм или серию не досмотрели и включили снова
 *     спустя RESUME_GAP — пауза и выбор по центру экрана, как в других плеерах: «Продолжить просмотр» / «Начать
 *     с начала». Ждёт ответа; «Назад» — продолжить (у родного «Спрашивать» Lampa по таймауту начиналось сначала).
 *     Пока окно открыто, Lampa место не ставит (timeline.waiting_for_user), «сначала» — timeline.continued.
 *     Только при «Тайм-код: Продолжить» в Lampa (по умолчанию) и не для почти досмотренного (>90 %) и первой минуты.
 *
 *  6. Плашка серии: при запуске серии слева сверху на EP_SHOW — сериал, «Сезон 12 · Серия 15» и название серии
 *     (Lampa передаёт его в title), плавно появляется и исчезает; пульт не трогает.
 *
 *  Клавиши в окнах 1, 2 и 5 ловим на document в фазе захвата — раньше Lampa, как таймер сна в bsfeatures.js.
 */
var BSWatch = (function () {
    var COUNT = 15, RESUME_GAP = 12 * 3600 * 1000, EP_SHOW = 4500;
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

    /* ---------- 2. «Вы ещё смотрите?» ---------- */

    var idleEpisodes = 0;
    function stillLimit() { var n = parseInt(lsGet('bs_still') || '3', 10); return n >= 0 ? n : 3; }
    /** Спросить ли на старте серии: count — сколько серий подряд стартовало без нажатий (включая эту). */
    function wantStill(count, limit) { return limit > 0 && count > limit; }

    function askStill() {
        try { Lampa.PlayerVideo.pause(); } catch (e) {}
        overlay('<div class="bs-overlay__title">Вы ещё смотрите?</div>' +
            '<div class="bs-overlay__hint">ОК — продолжить · Назад — закрыть плеер</div>', function (code) {
            if (code === 13) { hide(); idleEpisodes = 0; try { Lampa.PlayerVideo.play(); } catch (x) {} return true; }
            if (BACK[code]) { hide(); idleEpisodes = 0; try { Lampa.Player.close(); } catch (x) {} return true; }
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

    /* ---------- 4. детский режим ---------- */

    var ADULT_TEXT = /клубничк|18\s*\+|xxx|porn|для взрослых/i;
    var ADULT_COMP = /^(sisi|xxx|porn|adult|strawberry)/i;
    // Без ПИН режим не действует: Lampa пишет переключатель в тот же ключ ещё до ввода ПИН, и отменённый ввод иначе
    // оставил бы режим включённым без способа выключить.
    function kids() { return on('bs_kids', false) && !!lsGet('bs_kids_pin'); }

    function hideAdult(root) {
        if (!kids()) return;
        try {
            $('.menu .menu__item', root || document).each(function () { if (ADULT_TEXT.test($(this).text())) $(this).remove(); });
        } catch (e) {}
    }

    function hookKidsPush() {
        var A = Lampa.Activity, push = A.push;
        if (!push || push.__bsKids) return;
        A.push = function (o) {
            if (kids() && o && (ADULT_COMP.test(String(o.component || '')) || ADULT_TEXT.test(String(o.title || '')) ||
                (o.card && o.card.adult) || (o.movie && o.movie.adult))) {
                noty('Недоступно в детском режиме');
                return;
            }
            return push.apply(this, arguments);
        };
        A.push.__bsKids = true;
    }

    function askPin(title, cb) {
        try {
            Lampa.Input.edit({ title: title, value: '', free: true, nosave: true }, function (v) { cb(String(v || '').replace(/\D/g, '')); });
        } catch (e) { cb(''); }
    }

    function kidsToggle(v) {
        var want = v === true || v === 'true';
        var revert = function (state) { try { Lampa.Storage.set('bs_kids', String(state)); } catch (e) {} lsSet('bs_kids', String(state)); };
        if (want) {
            askPin('Придумайте ПИН для выхода из детского режима (4 цифры)', function (pin) {
                if (pin.length < 4) { revert(false); return noty('ПИН — 4 цифры. Детский режим не включён'); }
                lsSet('bs_kids_pin', pin);
                lsSet('bs_kids', 'true');
                hideAdult();
                noty('Детский режим включён. Выключить — с этим ПИН');
            });
        } else {
            if (!lsGet('bs_kids_pin')) { lsSet('bs_kids', 'false'); return; }
            askPin('ПИН детского режима', function (pin) {
                if (pin && pin === lsGet('bs_kids_pin')) { lsSet('bs_kids', 'false'); try { window.localStorage.removeItem('bs_kids_pin'); } catch (e) {} noty('Детский режим выключен. Скрытые пункты вернутся после перезапуска'); }
                else { revert(true); noty('Неверный ПИН'); }
            });
        }
    }

    function settingsOpen(e) {
        if (!kids() || !e || e.name !== 'main' || !e.body) return;
        e.body.find('[data-component="pirate_store"],[data-component="sisi"],[data-component="plugins"],[data-component="skaz_plugins"]').remove();
        e.body.find('.settings-folder').each(function () { if (ADULT_TEXT.test($(this).text())) $(this).remove(); });
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
            component: C, param: { name: 'bs_still', type: 'select', values: { '0': 'Не спрашивать', '2': 'После 2 серий', '3': 'После 3 серий', '4': 'После 4 серий' }, 'default': lsGet('bs_still') || '3' },
            field: { name: '«Вы ещё смотрите?»', description: 'Пауза, если долго не нажимали пульт.' },
            onChange: function (v) { lsSet('bs_still', String(v)); }
        });
        api.addParam({
            component: C, param: { name: 'bs_resume_ask', type: 'select', values: { old: 'Если смотрели давно', always: 'Всегда спрашивать', off: 'Не спрашивать' }, 'default': lsGet('bs_resume_ask') || 'old' },
            field: { name: 'Продолжить или сначала', description: 'Не досмотрели и включили снова — спросит, откуда смотреть.' },
            onChange: function (v) { lsSet('bs_resume_ask', String(v)); }
        });
        api.addParam({
            component: C, param: { name: 'bs_kids', type: 'trigger', 'default': false },
            field: { name: 'Детский режим', description: 'Скрывает взрослое и плагины. Выключить — по ПИН.' },
            onChange: kidsToggle
        });
    }

    function start() {
        restoreAutonext();
        try { addSettings(); } catch (e) {}
        try { hookKidsPush(); } catch (e) { log('kids', e.message); }
        // любое нажатие на пульт — человек у экрана
        document.addEventListener('keydown', function () { idleEpisodes = 0; }, true);
        try {
            Lampa.Player.listener.follow('start', function (data) {
                hide();
                setTimeout(function () { epBanner(data); }, 800);
                clearInterval(resumeTimer); resumeTimer = null;
                cancelled = false;
                restoreAutonext();
                idleEpisodes++;
                setTimeout(addButton, 300);
                if (wantStill(idleEpisodes, stillLimit())) setTimeout(function () { if (!mode) askStill(); }, 2500);

            });
            // после 'start' Lampa (needToContinue) сама сбрасывает timeline.waiting_for_user — спрашиваем на 'ready',
            // он приходит сразу после, до первого кадра (место Lampa ставит на первом timeupdate)
            Lampa.Player.listener.follow('ready', function (data) { onResumeStart(data); });
            Lampa.Player.listener.follow('destroy', function () { clearTimeout(epTimer); $('.bs-ep-banner').remove(); clearInterval(resumeTimer); resumeTimer = null; hide(); restoreAutonext(); });
            Lampa.PlayerVideo.listener.follow('timeupdate', onTime);
            Lampa.PlayerVideo.listener.follow('timeupdate', onResumeFrame);
        } catch (e) { log('listen', e.message); }
        try {
            Lampa.Settings.listener.follow('open', settingsOpen);
            Lampa.Listener.follow('activity', function () { setTimeout(hideAdult, 300); });
            setTimeout(hideAdult, 1000); setTimeout(hideAdult, 8000);
        } catch (e) {}
    }

    return { start: start, _wantCountdown: wantCountdown, _wantStill: wantStill, _wantResume: wantResume, _epLines: epLines, _hideAdultText: ADULT_TEXT };
})();
