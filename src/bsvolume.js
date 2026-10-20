/*
 * Громкость телевизора в плеере (право tv.audio — громкость ТВ читается и ставится напрямую).
 *
 *  1. Своя громкость для каждого фильма и сериала (bs_vol_memory, вкл.): прибавили или убавили звук во время
 *     просмотра — запоминаем для этой карточки; в следующий раз ставим сами. Тихая озвучка у одного сериала и
 *     громкая у другого — каждый раз руками не крутить. Ушли из плеера — возвращаем громкость, какая была до него,
 *     если ставили её мы (свою поправку человек оставляет сам).
 *  2. Ночью не громче (bs_vol_night): с 23:00 до 7:00 плеер не стартует громче заданного.
 *  3. Тихо перед сном: минута до выключения по «Сну» — звук плавно убавляется (fade зовёт bsfeatures.js).
 *
 * Мерить громкость самого фильма нельзя: плеер ТВ (AVPlay) отдаёт звук мимо страницы. Выравнивание «на лету»
 * умеет сам телевизор — «Звук → Экспертные настройки → Автогромкость».
 */
var BSVolume = (function () {
    function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
    function on(k, def) { var v = lsGet(k); return v === null ? def : v === 'true'; }
    function noty(t, time) { try { Lampa.Noty.show(t, { time: time || 3000 }); } catch (e) {} }
    function log() { try { console.log.apply(console, ['BS volume'].concat([].slice.call(arguments))); } catch (e) {} }

    var KEY = 'bs_vol_cards', MAX = 300, NIGHT_FROM = 23, NIGHT_TO = 7;
    var cur = null;              // сеанс плеера: {key, before, auto}
    var ours = -1, oursAt = 0;   // своё изменение — не принимать за человека
    var holdUntil = 0;           // пока идёт плавное убавление «Сна» (и чуть после) — изменения не запоминаем
    var saveTimer = null;

    function audio() { try { return tizen.tvaudiocontrol; } catch (e) { return null; } }
    function getVol() { try { return audio().getVolume(); } catch (e) { return -1; } }
    function setVol(v) {
        v = Math.max(0, Math.min(100, v | 0));
        ours = v; oursAt = Date.now();
        try { audio().setVolume(v); return true; } catch (e) { log('set', e.message); return false; }
    }

    function load() { try { return JSON.parse(lsGet(KEY) || '{}') || {}; } catch (e) { return {}; } }
    function save(map) {
        var keys = Object.keys(map);
        if (keys.length > MAX) {
            keys.sort(function (a, b) { return (map[a].t || 0) - (map[b].t || 0); });
            keys.slice(0, keys.length - MAX).forEach(function (k) { delete map[k]; });
        }
        lsSet(KEY, JSON.stringify(map));
    }

    function cardKey(data) {
        var c = (data && (data.card || data.movie)) || null;
        if (!c) {
            try { var a = Lampa.Activity.active() || {}; c = a.movie || a.card || null; } catch (e) {}
        }
        if (!c || !c.id) return '';
        return (c.name || c.first_air_date || c.number_of_seasons ? 'tv' : 'movie') + ':' + c.id;
    }

    function nightCap(now) {
        var cap = parseInt(lsGet('bs_vol_night') || '0', 10);
        if (!cap) return 0;
        var h = (now || new Date()).getHours();
        return h >= NIGHT_FROM || h < NIGHT_TO ? cap : 0;
    }

    /** Какую громкость поставить на старте: {vol, why} или null — не трогать. */
    function target(before, saved, cap) {
        var v = saved >= 0 && on('bs_vol_memory', true) ? saved : before, why = v !== before ? 'memory' : '';
        if (cap && v > cap) { v = cap; why = 'night'; }
        return v !== before ? { vol: v, why: why } : null;
    }

    function onStart(data) {
        if (!audio()) return;
        var key = cardKey(data);
        if (cur && cur.key === key) return;                       // следующая серия того же сериала
        var before = cur ? cur.before : getVol();                  // в плеере сменили карточку — «до плеера» прежнее
        cur = { key: key, before: before, auto: cur ? cur.auto : false };
        if (before < 0) return;
        var rec = key ? load()[key] : null;
        var t = target(getVol(), rec ? rec.v : -1, nightCap());
        if (!t) return;
        if (setVol(t.vol)) {
            cur.auto = true;
            noty(t.why === 'night' ? 'Ночь: громкость ' + t.vol : 'Громкость ' + t.vol + ' — как в прошлый раз');
            log('старт', key, before, '->', t.vol, t.why);
        }
    }

    function onChange(v) {
        if (!cur || !cur.key) return;
        if (v === ours && Date.now() - oursAt < 2000) return;
        if (Date.now() < holdUntil) return;
        try { if (window.BSWatch && BSWatch.activity) BSWatch.activity(); } catch (e) {}   // громкость меняли сами — человек у экрана
        try { if (!Lampa.Player.opened()) return; } catch (e) { return; }
        cur.auto = false;                                          // человек выбрал сам — на выходе не возвращаем
        if (!on('bs_vol_memory', true)) return;
        var key = cur.key;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(function () {                       // кнопку держат — пишем, когда отпустили
            var map = load();
            map[key] = { v: v, t: Date.now() };
            save(map);
            log('запомнил', key, v);
        }, 3000);
    }

    function onDestroy() {
        if (cur && cur.auto && cur.before >= 0 && getVol() !== cur.before) setVol(cur.before);
        cur = null;
    }

    /** Плавно убавить звук до трети за ms. Возвращает «вернуть как было». */
    function fade(ms) {
        var from = getVol();
        if (from <= 0) return function () {};
        var to = Math.floor(from / 3), steps = from - to, step = 0, timer = null;
        holdUntil = Date.now() + ms + 5000;
        if (steps > 0) timer = setInterval(function () {
            if (++step > steps) return clearInterval(timer);
            setVol(from - step);
        }, Math.max(300, Math.floor(ms / steps)));
        return function () { clearInterval(timer); holdUntil = Date.now() + 3000; if (getVol() !== from) setVol(from); };
    }

    function addSettings() {
        if (!audio()) return;                                     // не ТВ Samsung (Media Station X, браузер) — громкость не наша
        var api = Lampa.SettingsApi;
        api.addParam({
            component: 'bs_update',
            param: { name: 'bs_vol_memory', type: 'trigger', 'default': true },
            field: { name: 'Своя громкость для каждого фильма', description: 'Запоминает громкость, которую вы ставили, и в следующий раз ставит её сама.' },
            onChange: function (v) { lsSet('bs_vol_memory', String(v === true || v === 'true')); }
        });
        api.addParam({
            component: 'bs_update',
            param: { name: 'bs_vol_night', type: 'select', values: { '0': 'Выключено', '10': '10', '15': '15', '20': '20', '25': '25' }, 'default': '0' },
            field: { name: 'Ночью не громче', description: 'С 23:00 до 7:00 плеер не начинает громче.' },
            onChange: function (v) { lsSet('bs_vol_night', String(v)); }
        });
    }

    function start() {
        try { addSettings(); } catch (e) { log('settings', e.message); }
        if (!audio()) return log('нет tvaudiocontrol');
        try { audio().setVolumeChangeListener(onChange); } catch (e) { log('listener', e.message); }
        try {
            Lampa.Player.listener.follow('start', onStart);
            Lampa.Player.listener.follow('destroy', onDestroy);
        } catch (e) { log('player', e.message); }
    }

    return { start: start, fade: fade, _onChange: onChange, _hold: function () { return holdUntil; }, _target: target, _nightCap: nightCap, _cardKey: cardKey };
})();
