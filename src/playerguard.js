/*
 * Сторож плеера: если видео зависло, пробует другое качество, а потом закрывает плеер,
 * чтобы можно было выбрать другой источник. Работает с плеером Tizen (AVPlay) и встроенным:
 * оба отдают события времени через Lampa.PlayerVideo.listener.
 *
 * Зависание — видео не стартовало за START_LIMIT или время не двигалось дольше PLAY_LIMIT
 * (пауза и перемотка пользователя не считаются), либо после ошибки плеера видео не пошло
 * за ERROR_GRACE (разовые ошибки сети, после которых плеер восстанавливается, не считаются).
 * Шаг 0: видео уже шло — перезапуск того же потока с того же места (лечит оборванное соединение).
 * Шаг 1: следующее качество вниз от текущего (как ручная смена качества — позиция сохраняется).
 * Обрыв сети: пока сети нет, простой не считаем; вернулась — продолжаем с того же места.
 * Шаг 2: качеств больше нет — уведомление и закрытие плеера через CLOSE_DELAY; если видео
 *        за это время пошло, закрытие отменяется.
 * ТВ-каналы: одно переподключение к тому же адресу. Торренты не трогаем: им нужна раскачка.
 *
 * Запасной плеер для HLS. Плеер ТВ (AVPlay) на части серверов не играет поток .m3u8: список качеств получает,
 * куски видео — нет (Q60B, Tizen 6.5: Alloha/vkvideo.cloud — CONNECTION_FAILED, KinoPub/cdntogo.net — висит),
 * а встроенный плеер Lampa с программной обработкой (hls.js) тот же поток играет за 3 с. Поэтому: AVPlay не
 * запустил .m3u8 — та же серия сразу во встроенном плеере (hls.js), а сервер видео запоминается на HLS_LEARN —
 * с него потоки сразу идут во встроенный. «Автовыбор плеера» (bs_player_auto, включён): так — всегда, какой бы
 *  «Тип плеера» ни стоял в меню; выключен — ручная настройка, запасной плеер — только от плеера ТВ.
 *  Настройки плеера меняются только на этот просмотр и потом
 * возвращаются (bs_player_forced хранит прежние, если приложение закрыли посреди просмотра).
 */
var BSGuard = (function () {
    var cfg = { BUFFER_GRACE: 60000, START_LIMIT: 25000, PLAY_LIMIT: 20000, ERROR_GRACE: 6000, START_ERROR_GRACE: 2000, CLOSE_DELAY: 4000, TICK: 1000 };
    var s = null;          // текущий сеанс просмотра
    var timer = null;
    var HLS_START_LIMIT = 10000, HLS_QUIET = 6000, HLS_HINT = 3000, HLS_LEARN = 30 * 24 * 3600 * 1000, LEARN_KEY = 'bs_hls_inner', FORCED_KEY = 'bs_player_forced';

    function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
    function enabled() { return lsGet('bs_guard') !== 'false'; }

    // Noty вставляет текст как HTML, а названия качеств приходят с серверов источников
    function noty(t, time) { try { Lampa.Noty.show(String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'), { time: time || 5000 }); } catch (e) {} }
    function log() { try { console.log.apply(console, ['BSGuard'].concat([].slice.call(arguments))); } catch (e) {} }

    function playerOpen() {
        try { return !!Lampa.Player.opened(); } catch (e) { return false; }
    }

    /* ---------- качества ---------- */

    function qualityNum(name) {
        var m = /(\d{3,4})/.exec(String(name));
        if (m) return parseInt(m[1], 10);
        if (/4k|uhd/i.test(name)) return 2160;
        if (/2k/i.test(name)) return 1440;
        if (/fhd|full/i.test(name)) return 1080;
        if (/hd/i.test(name)) return 720;
        if (/sd/i.test(name)) return 480;
        return 0;
    }

    function urlOf(q) {
        if (typeof q === 'string') return q;
        if (q && typeof q === 'object' && typeof q.url === 'string' && !q.call) return q.url;
        return '';   // качества с отложенным получением ссылки (call) пропускаем
    }

    /** Качества текущего видео от лучшего к худшему: [{name, url, n}]. */
    function qualities(work) {
        var list = [], q = work && work.quality;
        if (!q || typeof q !== 'object') return list;
        for (var name in q) if (q.hasOwnProperty(name)) {
            var u = urlOf(q[name]);
            if (u) list.push({ name: name, url: u, n: qualityNum(name) });
        }
        list.sort(function (a, b) { return b.n - a.n; });
        return list;
    }

    /** Следующее качество ниже текущего, которое ещё не пробовали. */
    function nextQuality(work) {
        var list = qualities(work), cur = work.url, curN = null;
        for (var i = 0; i < list.length; i++) if (list[i].url === cur) curN = list[i].n;
        if (curN === null && work.quality_switched) curN = qualityNum(work.quality_switched);
        for (var j = 0; j < list.length; j++) {
            var q = list[j];
            if (s.tried.indexOf(q.url) >= 0 || q.url === cur) continue;
            if (curN === null || q.n < curN) return q;
        }
        // ниже ничего нет — любое непробованное
        for (var k = 0; k < list.length; k++) if (s.tried.indexOf(list[k].url) < 0 && list[k].url !== cur) return list[k];
        return null;
    }

    /* ---------- запасной плеер для HLS ---------- */

    function isHls(u) { return /\.m3u8(\?|#|$)|\/hls\//i.test(String(u || '')); }
    /** Сервер видео без поддомена: 4c-2f-63-r505.vkvideo.cloud → vkvideo.cloud. */
    function hostKey(u) {
        var m = /^https?:\/\/([^\/:?#]+)/i.exec(String(u || ''));
        if (!m) return '';
        return /^[\d.]+$/.test(m[1]) ? m[1] : m[1].split('.').slice(-2).join('.');   // IP — целиком
    }
    function learnedMap() { try { return JSON.parse(lsGet(LEARN_KEY) || '{}') || {}; } catch (e) { return {}; } }
    function learned(u) { var t = learnedMap()[hostKey(u)]; return !!t && Date.now() - t < HLS_LEARN; }
    function learn(u) {
        var m = learnedMap(), h = hostKey(u), now = Date.now(), k;
        if (!h) return;
        for (k in m) if (m.hasOwnProperty(k) && now - m[k] > HLS_LEARN) delete m[k];
        m[h] = now;
        lsSet(LEARN_KEY, JSON.stringify(m));
    }
    function field(k) { try { return Lampa.Storage.field(k); } catch (e) { return null; } }
    function onTizen() { try { return !!Lampa.Platform.is('tizen'); } catch (e) { return false; } }
    function onTizenPlayer() { return onTizen() && field('player') === 'tizen'; }
    function autoPlayer() { return lsGet('bs_player_auto') !== 'false'; }

    /** На этот просмотр — такой плеер (Lampa выбирает его сразу после 'start' и при смене качества).
     *  Тихо (без 'change': синхронизация аккаунта, экран настроек); прежние значения — в FORCED_KEY. */
    function forcePlayer(player, hls) {
        if (field('player') === player && field('player_hls_method') === hls) return true;
        if (!lsGet(FORCED_KEY)) lsSet(FORCED_KEY, JSON.stringify({ player: field('player'), hls: field('player_hls_method') }));
        try { Lampa.Storage.set('player', player, true); Lampa.Storage.set('player_hls_method', hls, true); } catch (e) { return false; }
        return true;
    }
    /** Встроенный плеер с hls.js — только вместо плеера ТВ. */
    function forceInner() { return onTizenPlayer() && forcePlayer('inner', 'hlsjs'); }
    function restorePlayer() {
        var o = null;
        try { o = JSON.parse(lsGet(FORCED_KEY) || 'null'); } catch (e) {}
        if (!o) return;
        try { window.localStorage.removeItem(FORCED_KEY); } catch (e) {}
        try { Lampa.Storage.set('player', o.player || 'tizen', true); Lampa.Storage.set('player_hls_method', o.hls || 'application', true); } catch (e) {}
        log('плеер — снова', o.player);
    }

    /** AVPlay не запустил .m3u8 — та же серия во встроенном плеере (hls.js), сервер видео запомнить.
     *  Не закрывая плеер: как смена качества — Lampa убирает видео и создаёт новое, выбирая тип плеера заново. */
    function fallbackInner(work) {
        if (!forceInner()) return false;
        learn(work.url);
        log('HLS: плеер ТВ не справился — встроенный', hostKey(work.url));
        noty('Плеер ТВ не справился с этим потоком — переключаю на плеер Lampa…', 4000);
        s.avplay = false;
        switchTo({ name: work.quality_switched || 'auto', url: work.url });
        return true;
    }

    /** Перед запуском. Автовыбор: плеер ТВ, а для сервера, который ему не по силам, — сразу встроенный (hls.js).
     *  Без автовыбора — ручная настройка, кроме уже известных таких серверов при плеере ТВ. */
    function beforeStart(data) {
        restorePlayer();                        // прошлый просмотр мог оставить свой плеер
        if (!enabled() || !data || !onTizen() || isChannel(data) || isTorrent(data)) return;
        var hard = isHls(data.url) && learned(data.url);
        if (autoPlayer()) {
            if (hard) { if (forcePlayer('inner', 'hlsjs')) log('автовыбор: встроенный (сервер', hostKey(data.url) + ')'); }
            else forcePlayer('tizen', 'application');
            return;
        }
        if (hard && forceInner()) log('HLS: сервер', hostKey(data.url), '— сразу встроенный плеер');
    }
    function isTorrent(data) { return !!(data.torrent_hash || /\/stream\/|torrserver|:8090\//i.test(String(data.url || ''))); }

    /* ---------- сеанс ---------- */

    function begin(data) {
        stop();
        if (!enabled() || !data) return;
        if (isTorrent(data)) { log('torrent — не следим'); return; }
        s = {
            iptv: isChannel(data),
            startedAt: Date.now(),
            lastProgressAt: Date.now(),
            lastTime: -1,
            played: false,          // этот поток (после перезапуска/смены качества — заново)
            everPlayed: false,      // видео в этом сеансе хоть раз шло
            paused: false,
            tried: [String(data.url || '')],
            steps: 0,
            errorAt: 0,
            restarted: false,
            resumeAt: 0,
            bufPct: -1, bufSince: 0, // идёт подгрузка буфера (растёт %) — не зависание
            offline: false,
            stalls: 0,              // остановки на подгрузку после того, как видео пошло
            closing: null,
            avplay: onTizenPlayer(),             // играет плеер ТВ (AVPlay)
            avSignal: false,                     // AVPlay сообщил о загрузке данных (буферизация, проценты)
            hls: isHls(data.url)
        };
        timer = setInterval(tick, cfg.TICK);
        log('сеанс', s.iptv ? 'канал' : 'фильм', s.avplay ? 'плеер ТВ' : 'встроенный', s.hls ? 'HLS' : 'файл', String(data.url).slice(0, 80));
        quickCheck(data.url);
    }

    /* Ссылка онлайн-источника мёртвая (поток ответил 404/410/5xx — bsprobe.js) — не ждём START_LIMIT, переключаем
     * сразу. «Не знаем» (403, нет ответа) — ждём, как раньше: решает плеер. Видео успело пойти — проверку забываем. */
    function quickCheck(url) {
        var sess = s;
        try {
            var P = window.BSProbe;
            if (!P || !P.enabled() || !autoAvailable() || !url || typeof url !== 'string') return;
            P.check(url, function (v, status) {
                if (s !== sess || !s || s.everPlayed || s.closing || v !== 'dead') return;
                log('ссылка мёртвая', status);
                escalate('не отвечает (поток ' + status + ')');
            });
        } catch (e) {}
    }

    /* ТВ-канал, а не фильм. Плагин Skaz помечает iptv: true и обычные фильмы и серии (журнал с ТВ, 2026-10-13) —
     * сторож считал их каналами и только переподключался: без смены качества, запасного плеера и другого источника.
     * Фильм/серия из онлайн-источника — есть ссылка от источника (BSFix.current) или данные карточки. */
    function isChannel(data) {
        if (!data || !data.iptv) return false;
        if (data.timeline || data.card || data.season || data.episode) return false;
        try { if (window.BSFix && BSFix.current && BSFix.current()) return false; } catch (e) {}
        return true;
    }

    function stop() {
        if (timer) clearInterval(timer);
        timer = null;
        if (s && s.closing) clearTimeout(s.closing);
        s = null;
    }

    function progress() {
        if (!s) return;
        s.lastProgressAt = Date.now();
        s.errorAt = 0;                        // видео идёт — прошлая ошибка была разовой
        if (s.closing) {
            clearTimeout(s.closing);
            s.closing = null;
            noty('Видео пошло — остаёмся в плеере');
        }
    }

    function onTime(e) {
        if (!s || !e) return;
        var t = typeof e.current === 'number' ? e.current : NaN;
        if (isNaN(t)) {                       // AVPlay иногда шлёт timeupdate без данных
            try { t = Lampa.PlayerVideo.video().currentTime; } catch (err) {}
        }
        if (typeof t !== 'number' || isNaN(t)) return;
        // После перезапуска потока возвращаемся на место, где остановились.
        if (s.resumeAt > 5 && t < s.resumeAt - 5 && (e.duration || 0) > s.resumeAt) {
            var to = s.resumeAt; s.resumeAt = 0;
            try { Lampa.PlayerVideo.to(to); } catch (err) {}
            return;
        }
        if (t > s.lastTime + 0.2 || t < s.lastTime - 2) {
            s.bufPct = -1; s.bufSince = 0;
            if (s.lastTime >= 0 || t > 0.2) {
                if (!s.everPlayed) {
                    try { if (window.BSFix && BSFix.played) BSFix.played(); } catch (err) {}   // автоподбор нашёл рабочий
                    log('видео пошло через', ((Date.now() - s.startedAt) / 1000).toFixed(1), 'с,', s.avplay ? 'плеер ТВ' : 'встроенный', s.hls ? 'HLS' : 'файл', s.avSignal ? '(был сигнал загрузки)' : '');
                }
                s.played = true; s.everPlayed = true;
            }
            s.lastTime = t;
            progress();
        }
    }

    /* Подгрузка буфера. Картинка стоит, но AVPlay сообщает «буфер 10%… 40%… 70%» — данные идут, поток жив.
     * Перезапуск в этот момент выбросил бы почти набранный буфер, и на медленной линии (4K, «Надёжно: 15 с»)
     * видео не пошло бы никогда. Пока процент растёт, простой не считаем — но не дольше BUFFER_GRACE подряд. */
    function onBuffer(e) {
        if (!s || s.paused || s.closing || !e) return;
        var p = parseFloat(e.down);
        if (!isNaN(p) && p > 0) s.avSignal = true;
        if (isNaN(p) || p <= 0 || p <= s.bufPct) return;
        s.bufPct = p;
        if (!s.bufSince) s.bufSince = Date.now();
        if (Date.now() - s.bufSince < cfg.BUFFER_GRACE) s.lastProgressAt = Date.now();
    }

    function tick() {
        if (!s) return;
        if (!playerOpen()) return stop();
        if (s.paused || document.hidden || s.closing) return;
        // Нет сети — ничего не переключаем, ждём её возвращения (см. 'online').
        if (navigator.onLine === false || s.offline) { s.lastProgressAt = Date.now(); return; }
        // Ошибка плеера: ждём ERROR_GRACE — плеер (hls.js, AVPlay) часто восстанавливается сам. Ошибка до первой картинки
        // (сервер отдал пустой плейлист — так бывает у TV Skaz) сама не проходит: переключаем через START_ERROR_GRACE.
        if (s.errorAt && Date.now() - s.errorAt > (s.everPlayed ? cfg.ERROR_GRACE : cfg.START_ERROR_GRACE)) { s.errorAt = 0; return escalate('выдал ошибку'); }
        var hlsWait = s.avplay && s.hls && !s.everPlayed;
        // Картинки нет — сразу сказать, что происходит, иначе кажется, что всё зависло
        if (hlsWait && !s.hinted && Date.now() - s.lastProgressAt > HLS_HINT) {
            s.hinted = true;
            noty('Подключаюсь к потоку… Если плеер ТВ не справится, включу плеер Lampa', HLS_START_LIMIT - HLS_HINT);
        }
        var limit = s.played ? cfg.PLAY_LIMIT : hlsWait ? (s.avSignal ? HLS_START_LIMIT : HLS_QUIET) : cfg.START_LIMIT;
        if (Date.now() - s.lastProgressAt > limit) escalate(s.played ? 'остановился' : 'не запускается');
    }

    function escalate(why) {
        if (!s || s.closing) return;
        var work = null;
        try { work = Lampa.Player.playdata(); } catch (e) {}
        s.steps++;
        log('зависание:', why, 'шаг', s.steps);

        if (s.iptv) {
            if (s.steps === 1 && work && work.url) {
                noty('Канал ' + why + ' — переподключаюсь…');
                switchTo({ name: work.quality_switched || 'auto', url: work.url });
                return;
            }
            return giveUp('Канал не отвечает. Попробуйте другой канал.');
        }

        // Плеер ТВ не запустил поток .m3u8 — та же серия во встроенном плеере (hls.js), до смены источника
        if (!s.everPlayed && s.avplay && s.hls && !/^не отвечает/.test(why) && work && work.url && fallbackInner(work)) return;

        // Видео ни разу не пошло, а это онлайн-источник с автоподбором — перебор качеств (по 25 с на каждое)
        // только тянет время: сразу другой источник.
        if (!s.everPlayed && autoAvailable()) return giveUp('Источник не запускается — подбираю другой…', function () { try { BSFix.autoNext(); } catch (e) {} });

        // Шаг 0: видео шло и встало — сначала тот же поток с того же места.
        if (!s.restarted && s.played && s.lastTime > 5 && work && work.url) return restartSame(why === 'выдал ошибку' ? 'Ошибка потока' : 'Поток ' + why);

        var next = work ? nextQuality(work) : null;
        if (next && s.steps <= 3) {
            noty('Поток ' + why + ' — переключаю качество на ' + next.name + '…', 6000);
            s.tried.push(next.url);
            switchTo(next);
            return;
        }
        // онлайн-источник: после закрытия плеера автоподбор пробует следующий источник с той же серией (bsfix.js)
        var auto = autoAvailable();
        giveUp(auto ? 'Источник не отвечает — подбираю другой…' : 'Источник не отвечает. Закрываю плеер — выберите другой источник или озвучку.',
            auto ? function () { try { BSFix.autoNext(); } catch (e) {} } : null);
    }

    function fmtPos(sec) { sec = Math.floor(sec); var m = Math.floor(sec / 60), x = sec % 60; return Math.floor(m / 60) + ':' + ('0' + m % 60).slice(-2) + ':' + ('0' + x).slice(-2); }

    function restartSame(reason) {
        var work = null;
        try { work = Lampa.Player.playdata(); } catch (e) {}
        if (!s || !work || !work.url) return;
        var pos = s.lastTime;
        s.restarted = true;
        noty(reason + ' — перезапускаю с ' + fmtPos(pos) + '…', 5000);
        switchTo({ name: work.quality_switched || 'auto', url: work.url });
        s.resumeAt = pos;
    }

    function switchTo(q) {
        s.errorAt = 0;
        s.lastProgressAt = Date.now();
        s.lastTime = -1;
        s.played = false;
        try { Lampa.PlayerPanel.listener.send('quality', { name: q.name, url: q.url }); }
        catch (e) { log('смена качества не удалась', e.message); giveUp('Не удалось переключить качество.'); }
    }

    function autoAvailable() {
        try { return !!(window.BSFix && BSFix.current && BSFix.current()) && window.localStorage.getItem('bs_auto_source') !== 'false'; } catch (e) { return false; }
    }

    function giveUp(text, after) {
        if (s.closing) return;               // закрытие уже назначено — второй таймер не нужен
        noty(text, 7000);
        s.closing = setTimeout(function () {
            if (!s) return;
            s.closing = null;
            try { Lampa.Player.close(); } catch (e) { log('close', e.message); }
            stop();
            if (after) setTimeout(after, 600);
        }, cfg.CLOSE_DELAY);
    }

    /* ---------- подключение к Lampa ---------- */

    function addSettings() {
        if (!Lampa.SettingsApi) return;
        Lampa.SettingsApi.addParam({
            component: 'bs_update',
            param: { name: 'bs_player_auto', type: 'trigger', 'default': true },
            field: {
                name: 'Автовыбор плеера',
                description: 'Плеер ТВ, а если он не тянет поток — плеер Lampa.'
            },
            onChange: function (v) { lsSet('bs_player_auto', String(v === true || v === 'true')); }
        });
        Lampa.SettingsApi.addParam({
            component: 'bs_update',
            param: { name: 'bs_guard', type: 'trigger', 'default': true },
            field: {
                name: 'Сторож плеера',
                description: 'Видео зависло — перезапуск, другое качество или источник.'
            },
            onChange: function (v) { lsSet('bs_guard', String(v === true || v === 'true')); if (!(v === true || v === 'true')) stop(); }
        });
    }

    function start() {
        try {
            Lampa.Player.listener.follow('start', function (data) { beforeStart(data); begin(data); });
            Lampa.Player.listener.follow('destroy', function () {
                // не дождался: плеер ТВ так и не запустил .m3u8 — с этого сервера в следующий раз сразу встроенный
                if (s && s.avplay && s.hls && !s.everPlayed && !s.closing && Date.now() - s.startedAt > 5000) {
                    var w = null; try { w = Lampa.Player.playdata(); } catch (e) {}
                    if (w && w.url) { learn(w.url); log('HLS: закрыли, не дождавшись, — сервер', hostKey(w.url), 'запомнен'); }
                }
                stop(); restorePlayer();
            });
            var v = Lampa.PlayerVideo.listener;
            v.follow('timeupdate', onTime);
            v.follow('progress', onBuffer);
            v.follow('play', function () { if (s) { s.paused = false; progress(); } });
            v.follow('pause', function () { if (s) s.paused = true; });
            v.follow('rewind', function () { if (s) progress(); });
            v.follow('error', function (e) {
                if (s && !s.closing && !s.errorAt && (!e || e.fatal !== false)) s.errorAt = Date.now();
                // hls.js: «буфер на миг опустел, догружаю» (fatal false) — Lampa пишет это на экран на 10 с
                // («details [bufferStalledError] fatal [false]»), хотя видео идёт. Такие — не показывать.
                if (e && e.fatal === false && /buffer(Stalled|Nudge|Full|SeekOver)Error/.test(String(e.error || ''))) {
                    setTimeout(function () { try { $('.player-info__error').addClass('hide'); } catch (x) {} }, 0);
                }
            });
            window.addEventListener('offline', function () { if (s) { s.offline = true; noty('Нет сети — жду, видео продолжится само', 5000); } });
            window.addEventListener('online', function () {
                if (!s || !s.offline) return;
                s.offline = false; s.lastProgressAt = Date.now();
                setTimeout(function () {
                    // Сеть вернулась: если видео стоит — тот же поток с того же места (флаг шага 0 не тратим).
                    if (s && !s.paused && Date.now() - s.lastProgressAt > 2500 && s.lastTime > 0) {
                        var was = s.restarted; restartSame('Сеть вернулась'); s.restarted = was;
                    }
                }, 3000);
            });
            // Пока приложение свёрнуто, простой не считаем: при возврате отсчёт с нуля.
            document.addEventListener('visibilitychange', function () {
                if (s && !document.hidden) s.lastProgressAt = Date.now();
            });
            Lampa.PlayerPanel.listener.follow('quality', function (e) {
                if (!s || !e) return;          // смена качества пользователем — даём новому потоку время
                if (s.tried.indexOf(e.url) < 0) s.tried.push(e.url);
                s.lastProgressAt = Date.now(); s.lastTime = -1; s.played = false; s.errorAt = 0;
                // ручная смена качества пользователем — шаг 0 снова доступен для нового потока
            });
        } catch (e) { log('не подключился', e.message); }
        try { hookAvplay(); } catch (e) {}
        try { addSettings(); } catch (e) {}
        try { if (!playerOpen()) restorePlayer(); } catch (e) {}    // закрыли приложение посреди просмотра
    }

    /* Ошибки AVPlay до сторожа не доходят: Lampa пересылает их в обработчик 'error', а он читает video.error,
     * которого у обёртки AVPlay нет, — и молчит. Без этого сторож ждал полный START_LIMIT (25 с) после
     * PLAYER_ERROR_CONNECTION_FAILED, пришедшего через 3 с (проверено на эмуляторе ТВ). Берём ошибку у самого AVPlay. */
    function avError(what) {
        if (s && !s.closing && !s.errorAt) { s.errorAt = Date.now(); log('AVPlay: ' + what); }
    }
    function hookAvplay() {
        var av = window.webapis && window.webapis.avplay;
        if (!av || !av.setListener || av.setListener.__bsGuard) return;
        var setListener = av.setListener, prepareAsync = av.prepareAsync, play = av.play;
        av.setListener = function (l) {
            if (l && typeof l === 'object') {
                var copy = {}, k;
                for (k in l) copy[k] = l[k];
                var onerror = l.onerror;
                copy.onerror = function (type) { avError(type); if (onerror) return onerror.apply(this, arguments); };
                var onbs = l.onbufferingstart;
                copy.onbufferingstart = function () { if (s) { s.avSignal = true; if (s.everPlayed) s.stalls++; } if (onbs) return onbs.apply(this, arguments); };
                var onbp = l.onbufferingprogress;
                copy.onbufferingprogress = function () { if (s) s.avSignal = true; if (onbp) return onbp.apply(this, arguments); };
                return setListener.call(av, copy);
            }
            return setListener.apply(av, arguments);
        };
        av.setListener.__bsGuard = true;
        // PLAYER_ERROR_INVALID_STATE (пустой плейлист) AVPlay бросает исключением из play(), а не в onerror
        if (play) {
            av.play = function () {
                try { return play.apply(av, arguments); } catch (e) { avError('play ' + (e && (e.name || e.message) || '')); throw e; }
            };
        }
        if (prepareAsync) {
            av.prepareAsync = function (ok, fail) {
                return prepareAsync.call(av, ok, function (e) { avError('prepare ' + (e && (e.name || e.message) || '')); if (fail) return fail.apply(this, arguments); });
            };
        }
    }

    return { start: start, cfg: cfg, _hls: { isHls: isHls, hostKey: hostKey, learned: learned, learn: learn }, stalls: function () { return s ? s.stalls : 0; }, _state: function () { return s; } };
})();
