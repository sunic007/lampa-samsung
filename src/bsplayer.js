/*
 * Дополнения плеера: метки пропуска и главы Skaz, ночной режим, память звуковой дорожки.
 *
 *  Метки пропуска. Сервис Skaz (report.php?segments=…) отдаёт заставку, титры, «в предыдущих
 *  сериях» и рекламу в начале ролика. Народные метки привязаны к точной длительности файла
 *  (±2 с), поэтому запрашиваем, когда плеер уже знает длительность. Показ — родной механизм
 *  Lampa: кнопка «Пропустить», отметки на шкале, автопропуск и «Следующая серия» на титрах;
 *  режим (сами/кнопкой) — в меню плеера Lampa «Сегменты». Модуль меток в Lampa наружу не
 *  выведен и читает их только при старте, поэтому вызываем ровно его обработчик старта.
 *  Главы (от ИИ CUB, раздаёт Skaz) — кнопка «Главы» в панели плеера, если они есть.
 *  Ночной режим — затемнение картинки поверх видео (30/50/70 %), кнопка в панели плеера.
 *  Звуковая дорожка — выбранная в серии дорожка (по названию) ставится в следующих сериях.
 */
var BSPlayer = (function () {
    var ENDPOINTS = ['https://skaz.team/report.php', 'https://list.skaz.tv/report.php', 'https://skaztv.online/report.php'];
    var TIMEOUT = 4000;
    var cache = {}, cacheKeys = [], CACHE_MAX = 50;   // ключ запроса -> ответ сервера; старые уходят, память не растёт
    var s = null;               // текущий сеанс: {card, season, episode, duration, asked, chapters}

    function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
    function on(k, def) { var v = lsGet(k); return v === null ? def : v === 'true'; }
    function noty(t, time) { try { Lampa.Noty.show(t, { time: time || 4000 }); } catch (e) {} }
    function log() { try { console.log.apply(console, ['BSPlayer'].concat([].slice.call(arguments))); } catch (e) {} }

    /* ---------- что сейчас играет ---------- */

    function currentCard(data) {
        var c = (data && (data.card || data.movie)) || null;
        if (!c) {
            try {
                var act = Lampa.Activity.active() || {};
                c = act.movie || act.card || (act.object && (act.object.movie || act.object.card)) || null;
            } catch (e) {}
        }
        if (!c || !(c.id > 0)) return null;
        var src = String(c.source || 'tmdb');
        if (src !== 'tmdb' && src !== 'cub') return null;      // id других каталогов — не TMDB
        return { id: c.id, tv: !!(c.name || c.number_of_seasons || c.first_air_date), source: src };
    }

    function fmtTime(sec) {
        sec = Math.max(0, Math.floor(sec));
        var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60;
        return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x;
    }

    /* ---------- запрос меток и глав ---------- */

    function request(query, cb) {
        if (cache[query]) return cb(cache[query]);
        var i = 0;
        (function next() {
            if (i >= ENDPOINTS.length) return cb(null);
            var xhr = new XMLHttpRequest(), done = false;
            var fin = function (data) {
                if (done) return; done = true;
                if (data) {
                    if (!(query in cache)) { cacheKeys.push(query); if (cacheKeys.length > CACHE_MAX) delete cache[cacheKeys.shift()]; }
                    cache[query] = data; cb(data);
                } else next();
            };
            try {
                xhr.open('GET', ENDPOINTS[i++] + '?' + query + '&t=' + Date.now(), true);
                xhr.timeout = TIMEOUT;
                xhr.onload = function () {
                    var d = null;
                    try { if (xhr.status === 200) d = JSON.parse(xhr.responseText); } catch (e) {}
                    fin(d && typeof d === 'object' ? d : null);
                };
                xhr.onerror = xhr.ontimeout = function () { fin(null); };
                xhr.send();
            } catch (e) { fin(null); }
        })();
    }

    /** Режим Lampa для типа меток (меню плеера «Сегменты»): auto — пропуск сам, user — кнопкой, none. */
    function segMode(type) { try { return Lampa.Storage.get('player_segments_' + type, 'auto'); } catch (e) { return 'auto'; } }

    /** Метки Skaz -> формат Lampa: {skip:[{start,end}], ad:[{start,end}]}.
     *  Непроверенные (trusted: false — народные, могут быть от другой версии файла: на ТВ «Гангстерленд» 1×01
     *  перемотал минуту фильма на 5:38) при автопропуске не отдаём: Lampa перематывала бы без спроса.
     *  Если в «Сегментах» выбран пропуск кнопкой — отдаём все: решает зритель. */
    function toLampa(list, duration) {
        var out = { skip: [], ad: [], dropped: 0 };
        for (var i = 0; i < (list || []).length; i++) {
            var m = list[i], st = +m.start, en = +m.end;
            var type = m.kind === 'ad' ? 'ad' : 'skip';
            if (m.trusted === false && segMode(type) === 'auto') { out.dropped++; continue; }
            if (duration) en = Math.min(en, duration);       // сначала обрезать по длине файла…
            if (!(st >= 0) || !(en > st + 1)) continue;      // …потом отбросить пустые и лежащие за концом
            (m.kind === 'ad' ? out.ad : out.skip).push({ start: st, end: en, kind: m.kind });
        }
        return out;
    }

    /** Вызвать ровно обработчик меток Lampa (тот, что на старте читает data.segments). */
    function feedLampa(segments) {
        try {
            var list = (Lampa.Player.listener._listeners || {}).start || [];
            for (var i = 0; i < list.length; i++) {
                var src = String(list[i]);
                if (src.indexOf('data.segments') >= 0 && src.length < 300) { list[i]({ segments: segments }); return true; }
            }
        } catch (e) { log('feed', e.message); }
        return false;
    }

    function ask() {
        if (!s || s.asked || !s.card || !(s.duration > 60)) return;
        s.asked = true;
        var session = s;
        var query = 'segments=' + encodeURIComponent(s.card.id) + '&season=' + (s.season | 0) + '&episode=' + (s.episode | 0) +
            '&duration=' + Math.floor(s.duration) + '&chapters=1&type=' + ((s.season | 0) > 0 || s.card.tv ? 'tv' : 'movie');
        request(query, function (d) {
            if (session !== s || !d) return;
            var seg = toLampa(d.segments, s.duration);
            var n = seg.skip.length + seg.ad.length;
            if (n && on('bs_segments', true) && feedLampa({ skip: seg.skip, ad: seg.ad })) {
                // метка титров в конце — Lampa сама покажет «Следующая серия», отсчёт bswatch.js не нужен
                s.endMark = seg.skip.some(function (x) { return x.kind === 'credits' || x.start >= s.duration * 0.7; });
                var kinds = [];
                for (var i = 0; i < seg.skip.length; i++) kinds.push({ intro: 'заставка', credits: 'титры', recap: '«ранее»' }[seg.skip[i].kind] || 'фрагмент');
                if (seg.ad.length) kinds.push('реклама');
                noty('Метки пропуска: ' + kinds.join(', '));
            }
            s.chapters = parseChapters(d.chapters);
            if (s.chapters.length) addPanelButton('chapters', 'Главы', showChapters);
            log('метки', n, 'глав', s.chapters.length, seg.dropped ? '(непроверенных не взято: ' + seg.dropped + ')' : '');
        });
    }

    /* Шаблоны Lampa (Template.get → Select) вставляют {title} как HTML, а названия глав — чужой текст
     * (разметка CUB/пользователей через сервер Skaz). Без экранирования <img onerror=…> в названии выполнился бы. */
    function esc(t) {
        return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function parseChapters(arr) {
        var out = [];
        for (var i = 0; i < (arr || []).length; i++) {
            var o = arr[i], st = +(o.start_sec !== undefined ? o.start_sec : o.start), title = String(o.title || '').replace(/^\s+|\s+$/g, '');
            if (st >= 0 && title) out.push({ start: st, title: esc(title.slice(0, 80)), descr: esc(String(o.description || '').slice(0, 160)) });
        }
        out.sort(function (a, b) { return a.start - b.start; });
        return out;
    }

    function showChapters() {
        if (!s || !s.chapters.length) return noty('Глав нет');
        var cur = 0, dur = s.duration || 0;
        try { cur = Lampa.PlayerVideo.video().currentTime || 0; } catch (e) {}
        // Только главы, которые есть в этом файле (разметка — на фильм, а файл бывает урезан).
        var list = s.chapters.filter(function (c) { return !dur || c.start < dur - 5; });
        if (!list.length) return noty('Глав для этого файла нет');
        var items = list.map(function (c, i) {
            var next = list[i + 1];
            return { title: fmtTime(c.start) + ' — ' + c.title, subtitle: c.descr, start: c.start,
                     selected: cur >= c.start && (!next || cur < next.start) };
        });
        var ctrl = Lampa.Controller.enabled().name;
        Lampa.Select.show({
            title: 'Главы',
            items: items,
            onBack: function () { Lampa.Controller.toggle(ctrl); },
            onSelect: function (a) { Lampa.Controller.toggle(ctrl); try { Lampa.PlayerVideo.to(a.start); } catch (e) {} }
        });
    }

    /* ---------- кнопки в панели плеера ---------- */

    function addPanelButton(id, title, action) {
        try {
            var panel = Lampa.PlayerPanel.render();
            if (!panel || panel.find('.bs-btn-' + id).length) return;
            var box = panel.find('.player-panel__right').first();
            if (!box.length) return;
            var btn = $('<div class="player-panel__box-buttons"><div class="button selector bs-panel-btn bs-btn-' + id + '" style="padding:0 .8em;width:auto;font-size:.9em">' + title + '</div></div>');
            btn.find('.selector').on('hover:enter', action);
            box.prepend(btn);
        } catch (e) { log('button', e.message); }
    }

    function removePanelButton(id) {
        try { Lampa.PlayerPanel.render().find('.bs-btn-' + id).parent().remove(); } catch (e) {}
    }

    /* ---------- «День» и «Ночь» — две кнопки панели ----------
     * «День»: ярче на 10/20/30 % по кругу (контраст и сочность — мягче, чтобы не пересвечивало) — для светлой комнаты.
 * «Ночь»: затемнение 30/50/70 % по кругу.
     * Вместе не включаются: одно включили — другое выключили. Качество видео не меняется — только отображение.
     * «День» — фильтр изображения у <video> встроенного плеера Lampa. Плеер ТВ (AVPlay) рисует видео мимо страницы,
     * прямо на экран: поверх можно только затемнить, сделать ярче нельзя (у Samsung для приложений такого нет) — там
     * подсказка про режим изображения ТВ. Хранится в bs_picture ('off' | 'd10'…'d30' | 'n30'…'n70'). */

    var NIGHT = [0, 30, 50, 70], DAY = [0, 10, 20, 30];
    function dayFilter(p) { var k = p / 100; return 'brightness(' + (1 + k) + ') contrast(' + (1 + k * 0.4).toFixed(2) + ') saturate(' + (1 + k * 0.7).toFixed(2) + ')'; }
    function picture() {
        var v = lsGet('bs_picture');
        if (!v) { var n = parseInt(lsGet('bs_night') || '0', 10); v = n ? 'n' + n : 'off'; }   // старая «Ночь»
        if (v === 'day') v = 'd20';                                                              // было вкл/выкл
        return /^(off|d10|d20|d30|n30|n50|n70)$/.test(v) ? v : 'off';
    }
    function nightLevel() { var p = picture(); return p.charAt(0) === 'n' ? parseInt(p.slice(1), 10) : 0; }
    function dayLevel() { var p = picture(); return p.charAt(0) === 'd' ? parseInt(p.slice(1), 10) : 0; }
    function onTvPlayer() { try { return Lampa.Platform.is('tizen') && Lampa.Storage.field('player') === 'tizen'; } catch (e) { return false; } }

    function nightApply() {
        try {
            var host = Lampa.PlayerVideo.render();
            var el = host.find('.bs-night');
            if (!el.length) {
                // сразу после картинки, без z-index: субтитры, загрузка и значки паузы идут дальше и остаются яркими
                el = $('<div class="bs-night" style="position:absolute;left:0;top:0;right:0;bottom:0;background:#000;pointer-events:none;-webkit-transition:opacity .3s;transition:opacity .3s"></div>');
                var display = host.find('.player-video__display').first();
                if (display.length) display.after(el); else host.append(el);
            }
            el.css('opacity', nightLevel() / 100);
            dayApply();
            var panel = Lampa.PlayerPanel.render();
            panel.find('.bs-btn-night').text(nightLevel() ? 'Ночь ' + nightLevel() + '%' : 'Ночь');
            panel.find('.bs-btn-day').text(dayLevel() ? 'День +' + dayLevel() + '%' : 'День');
        } catch (e) { log('night', e.message); }
    }

    /** «День» — фильтр у <video> встроенного плеера (видео пересоздаётся при смене качества и плеера — ставим заново). */
    function dayApply() {
        try {
            var v = Lampa.PlayerVideo.render().find('video');
            var f = dayLevel() ? dayFilter(dayLevel()) : '';
            v.each(function () { if (this.style.filter !== f) { this.style.webkitFilter = f; this.style.filter = f; } });
        } catch (e) {}
    }

    function nightNext() {
        var lv = NIGHT[(NIGHT.indexOf(nightLevel()) + 1) % NIGHT.length];
        lsSet('bs_picture', lv ? 'n' + lv : 'off');
        nightApply();
        noty(lv ? 'Ночь: затемнение ' + lv + '%' : 'Ночь выключена', 2000);
    }

    function dayNext() {
        var lv = DAY[(DAY.indexOf(dayLevel()) + 1) % DAY.length];
        lsSet('bs_picture', lv ? 'd' + lv : 'off');
        nightApply();
        if (lv && onTvPlayer()) noty('В плеере ТВ ярче не сделать: кнопка ⚙ на пульте → Изображение → Режим «Яркий» или «Динамический»', 6000);
        else noty(lv ? 'День: ярче на ' + lv + '%' : 'День выключен', 2000);
    }

    /* ---------- память звуковой дорожки ----------
     * У AVPlay дорожки — {index, language, extra}, а «enabled» только на запись; какая выбрана,
     * говорит webapis.avplay.getCurrentStreamInfo(). Во встроенном плеере — родные audioTracks.
     * Внутри одного сеанса Lampa сама переносит номер дорожки между сериями; мы добавляем
     * память между сеансами: номер и язык дорожки на сериал. */

    function trackLang(t) { return String((t && (t.language || t.lang || t.label || t.name)) || '').toLowerCase(); }
    function seriesKey() { return s && s.card && (s.season | 0) > 0 ? 'bs_track_' + s.card.id : null; }

    function currentTrack(tracks) {
        try {
            if (typeof webapis !== 'undefined' && webapis.avplay && webapis.avplay.getCurrentStreamInfo) {
                var info = webapis.avplay.getCurrentStreamInfo() || [];
                for (var i = 0; i < info.length; i++) if (info[i].type === 'AUDIO') {
                    var idx = parseInt(info[i].index, 10);
                    for (var j = 0; j < tracks.length; j++) if (tracks[j].index === idx) return tracks[j];
                }
            }
        } catch (e) {}
        for (var k = 0; k < tracks.length; k++) if (tracks[k].selected === true || tracks[k].enabled === true) return tracks[k];
        return null;
    }

    function onTracks(e) {
        var tracks = e && e.tracks;
        if (!s || !tracks || tracks.length < 2) return;
        s.tracks = tracks;
        var key = seriesKey(), saved = null;
        if (!key || !on('bs_track_memory', true)) return;
        try { saved = JSON.parse(lsGet(key) || 'null'); } catch (err) {}
        if (!saved) return;
        setTimeout(function () {                       // после выбора дорожки самой Lampa
            if (!s || s.tracks !== tracks) return;
            var cur = currentTrack(tracks), hit = null, i;
            for (i = 0; i < tracks.length && !hit; i++) if (tracks[i].index === saved.index && trackLang(tracks[i]) === saved.lang) hit = tracks[i];
            for (i = 0; i < tracks.length && !hit; i++) if (trackLang(tracks[i]) === saved.lang) hit = tracks[i];
            if (hit && hit !== cur) {
                try {
                    for (var k = 0; k < tracks.length; k++) tracks[k].selected = false;
                    hit.selected = true;
                    hit.enabled = true;
                    noty('Дорожка как в прошлый раз: ' + esc(saved.lang || '№' + saved.index), 3000);
                } catch (err) {}
            }
        }, 1500);
    }

    function rememberTrack() {
        var key = seriesKey();
        if (!key || !s.tracks || s.tracks.length < 2) return;
        var t = currentTrack(s.tracks);
        if (!t) return;
        lsSet(key, JSON.stringify({ index: t.index !== undefined ? t.index : s.tracks.indexOf(t), lang: trackLang(t) }));
        trimTracks(key);
    }

    /* Память дорожек — по ключу на сериал, иначе за годы набралось бы сотни записей в localStorage.
     * Держим последние TRACKS_MAX сериалов: список ключей по свежести в bs_track_index. */
    var TRACKS_MAX = 100;
    function trimTracks(key) {
        var list = [];
        try { list = JSON.parse(lsGet('bs_track_index') || '[]') || []; } catch (e) {}
        var i = list.indexOf(key);
        if (i >= 0) list.splice(i, 1);
        list.push(key);
        while (list.length > TRACKS_MAX) { var old = list.shift(); try { window.localStorage.removeItem(old); } catch (e) {} }
        lsSet('bs_track_index', JSON.stringify(list));
    }

    /* ---------- сеанс ---------- */

    function begin(data) {
        s = { card: currentCard(data), season: data && data.season, episode: data && data.episode, duration: 0, asked: false, chapters: [], tracks: null };
        removePanelButton('chapters');
        addPanelButton('night', 'Ночь', nightNext);
        addPanelButton('day', 'День', dayNext);
        // Значок источника (рядом с «Ночь»): с какого источника Skaz идёт видео; нажатие — закрыть плеер и выбрать
        // другой источник. Имя из страницы плагина — чужой текст, экранируем. С 1.7.9 по умолчанию скрыт: рабочий
        // источник подбирается сам (автоподбор, проверка источников), другой вручную — красная кнопка пульта.
        removePanelButton('src');
        try {
            var cur = window.BSFix && BSFix.current && BSFix.current();
            if (on('bs_src_badge', false) && cur && cur.name && Date.now() - cur.time < 180000) {
                addPanelButton('src', '&#9654; ' + esc(cur.name.slice(0, 24)), function () { BSFix.openSources(); });
            }
        } catch (e) {}
        nightApply();
        log('сеанс', s.card && s.card.id, 's' + (s.season | 0) + 'e' + (s.episode | 0));
    }

    /* Скорость канала. AVPlay сам меряет, как быстро скачивается поток (CURRENT_BANDWIDTH, бит/с).
     * Раз в 15 с во время просмотра — в копилку, медиана последних замеров — в bs_bw: по ней bsfix.js при следующем
     * запуске не даст стартовать в качестве, которое каналу не по силам.
     * Осторожно: когда буфер полон, плеер качает ровно со скоростью видео — у MP4 (Filmix и др.) это и есть «замер»
     * (эмулятор: 720p → ~2 Мбит/с на канале 200+ Мбит/с). Такой замер о канале ничего не говорит, а принятый всерьёз
     * опускал бы качество раз за разом (720 → 360 → …). Поэтому замер ниже битрейта текущего качества с запасом
     * берём, только если видео в этом сеансе останавливалось на подгрузку — тогда канал правда не тянет. */
    var bwSamples = [], bwLastAt = 0;
    function sampleBandwidth() {
        if (Date.now() - bwLastAt < 15000) return;
        bwLastAt = Date.now();
        var av = window.webapis && webapis.avplay, v = 0;
        try { if (av && av.getState && av.getState() === 'PLAYING') v = parseInt(av.getStreamingProperty('CURRENT_BANDWIDTH'), 10) || 0; } catch (e) { return; }
        if (!bwUsable(v, window.BSFix && BSFix.playingBitrate ? BSFix.playingBitrate() : 0, window.BSGuard && BSGuard.stalls ? BSGuard.stalls() : 0)) return;
        bwSamples.push(v);
        if (bwSamples.length > 12) bwSamples.shift();
        var sorted = bwSamples.slice().sort(function (a, b) { return a - b; });
        lsSet('bs_bw', JSON.stringify({ bps: sorted[Math.floor(sorted.length / 2)], n: sorted.length, at: Date.now(), v: 2 }));
    }
    /** Годится ли замер v (бит/с) при битрейте текущего качества nominal и числе остановок stalls. */
    function bwUsable(v, nominal, stalls) {
        if (v < 100000 || v > 2000000000) return false;          // не похоже на правду (меньше 0,1 или больше 2000 Мбит/с)
        if (stalls > 0) return true;                              // видео вставало — замер честный
        return !nominal || v >= nominal * 1.5;                    // иначе — только если явно быстрее самого видео
    }

    var dayCheckAt = 0;
    function onTime(e) {
        if (!s) return;
        try { sampleBandwidth(); } catch (err) {}
        // видео пересоздаётся при смене качества и плеера — «День» ставим заново (раз в 2 с хватает)
        if (Date.now() - dayCheckAt > 2000) { dayCheckAt = Date.now(); dayApply(); }
        var d = e && typeof e.duration === 'number' ? e.duration : 0;
        if (d > 60 && Math.abs(d - s.duration) > 2) {           // длительность пришла или сменилось качество
            if (s.duration) { s.asked = false; }
            s.duration = d;
            ask();
        }
    }

    function addSettings() {
        var C = 'bs_update', api = Lampa.SettingsApi;
        api.addParam({
            component: C, param: { name: 'bs_segments', type: 'trigger', 'default': true },
            field: { name: 'Метки пропуска Skaz', description: 'Заставка и титры. Сами — только проверенные метки.' },
            onChange: function (v) { lsSet('bs_segments', String(v === true || v === 'true')); }
        });
        api.addParam({
            component: C, param: { name: 'bs_buffer', type: 'select', values: { balanced: 'Сбалансировано — 4 с / 8 с', fast: 'Быстрый старт — 2 с / 6 с', reliable: 'Надёжно — 8 с / 15 с', auto: 'Как у Samsung — 10 с' }, 'default': lsGet('bs_buffer') || 'balanced' },
            field: { name: 'Буфер плеера ТВ', description: 'Запас видео перед стартом. При плохом интернете — «Надёжно».' },
            onChange: function (v) { lsSet('bs_buffer', v); noty('Буфер применится к следующему видео', 2500); }
        });
        api.addParam({
            component: C, param: { name: 'bs_src_badge', type: 'trigger', 'default': false },
            field: { name: 'Название источника в плеере', description: 'Кнопка рядом с «Ночь»: из какого источника идёт видео, нажатие — выбрать другой. Источник подбирается сам, другой вручную — красная кнопка пульта.' },
            onChange: function (v) { lsSet('bs_src_badge', String(v === true || v === 'true')); }
        });
        api.addParam({
            component: C, param: { name: 'bs_track_memory', type: 'trigger', 'default': true },
            field: { name: 'Помнить дорожку сериала', description: 'Выбранная озвучка ставится и в следующих сериях.' },
            onChange: function (v) { lsSet('bs_track_memory', String(v === true || v === 'true')); }
        });
    }

    function start() {
        try {
            Lampa.Player.listener.follow('start', begin);
            Lampa.Player.listener.follow('destroy', function () { rememberTrack(); s = null; });
            var v = Lampa.PlayerVideo.listener;
            v.follow('timeupdate', onTime);
            v.follow('tracks', onTracks);
            setInterval(function () { if (s) rememberTrack(); }, 15000);
        } catch (e) { log('не подключился', e.message); }
        try { addSettings(); } catch (e) {}
    }

    function hasEndMark() { return !!(s && s.endMark); }

    return { start: start, hasEndMark: hasEndMark, _toLampa: toLampa, _parseChapters: parseChapters, _feedLampa: feedLampa, _state: function () { return s; }, _trimTracks: trimTracks, _night: nightNext, _bwUsable: bwUsable };
})();
