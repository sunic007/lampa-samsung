/*
 * Автовыбор серверов онлайн-источников Skaz (фильмы и сериалы) по пингу, джиттеру и потерям.
 *
 * Только семейство серверов источников (`skazonline_servers`): прямые online3/4/5/7 или через Cloudflare
 * onlinecf3/4/5/7. onlines.js пингует серверы только внутри выбранного семейства, одним замером; само
 * семейство не переключает.
 *
 * Сервер ТВ by Skaz (`skaz_domain`, онлайн-ТВ) НЕ трогаем: его выбирает человек в настройках Skaz («Сервер Skaz»),
 * а свой резерв по потокам ТВ by Skaz делает сам (stream.<домен>/ok.php). До 1.7.61 мы выбирали и его — по
 * favicon сайта, а не по серверу потоков, и брали skaztv.top, у которого сайт жив, а сертификат потоков сломан.
 *
 * Сервер «рабочий», только если отдал настоящий ответ: число из /version. Заглушка провайдера — не рабочий.
 * Оценка = медиана + 2 × джиттер + штраф за потери; меньше — лучше.
 *
 * До запуска Lampa — быстрый замер (до 2.5 с). После запуска — полный замер через 20 с,
 * затем каждые 3 минуты и при появлении сети. Мёртвый сервер меняется сразу (перезапуск
 * Lampa откладывается, пока открыт плеер), просто медленный — со следующего запуска.
 */
var BSSkaz = (function () {
    var FAMILIES = {
        direct: ['online3', 'online4', 'online5', 'online7'],
        cf: ['onlinecf3', 'onlinecf4', 'onlinecf5', 'onlinecf7']
    };
    var PROBE_TIMEOUT = 3000, FAST_BUDGET = 2500, WATCH_MS = 3 * 60 * 1000;

    var last = { online: {}, time: 0 };
    var pendingReload = null;   // причина перезапуска, отложенного до закрытия плеера
    /* Защита от перезапусков по кругу на плохом Wi-Fi (сервер «мёртв» уже при 2 потерянных пробах из 4):
     *  - мёртвым текущий сервер считается только после двух полных замеров подряд (suspect*);
     *  - переключаемся только на сервер без потерь;
     *  - автоперезапуск — не чаще раза в 30 мин (bs_srv_reload_at), иначе новый сервер — со следующего запуска;
     *  - «лучше, но работает» не пишется сразу (иначе curFamily() перестаёт быть тем, что реально работает), а
     *    откладывается до следующего запуска (bs_srv_pending); ручной выбор (bs_srv_manual) такие советы не перебивают. */
    var suspectFamily = '', RELOAD_GAP = 30 * 60 * 1000, MANUAL_KEEP = 7 * 24 * 3600 * 1000;
    var notices = [];
    var running = false;

    /* ---------- хранилище (до и после запуска Lampa) ---------- */

    function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }

    function setLampa(k, v) {
        if (window.Lampa && Lampa.Storage) Lampa.Storage.set(k, v);
        else lsSet(k, String(v));
        if (k === 'skazonline_servers') lsSet('bs_srv_set', v === true ? 'cf' : 'direct');
    }
    /** Серверы переключили сами в настройках Skaz («Проксировать серверы»), а не мы — это ручной выбор: советы
     *  «быстрее — со следующего запуска» его не перебивают (как и выбор в нашем пункте). Мёртвые серверы — всё равно меняем. */
    function noteSkazToggle() {
        var set = lsGet('bs_srv_set'), cur = curFamily();
        if (set && set !== cur) { lsSet('bs_srv_manual', String(Date.now())); lsSet('bs_srv_pending', '{}'); }
        lsSet('bs_srv_set', cur);
    }

    function enabled() { return lsGet('bs_srv_auto') !== 'false'; }

    function curFamily() {
        var v = (window.Lampa && Lampa.Storage) ? Lampa.Storage.get('skazonline_servers', false) : lsGet('skazonline_servers');
        return (v === true || v === 'true') ? 'cf' : 'direct';
    }

    /* ---------- замеры ---------- */

    function probeOnce(url, check, cb) {
        var t0 = Date.now(), done = false, xhr;
        function fin(ok) { if (done) return; done = true; cb(ok ? Date.now() - t0 : null); }
        try {
            xhr = new XMLHttpRequest();
            xhr.open('GET', url + (url.indexOf('?') < 0 ? '?' : '&') + '_=' + Date.now() + Math.floor(Math.random() * 1e6), true);
            xhr.timeout = PROBE_TIMEOUT;
            xhr.onload = function () { fin(xhr.status === 200 && check(xhr)); };
            xhr.onerror = xhr.ontimeout = function () { fin(false); };
            xhr.send();
        } catch (e) { fin(false); }
    }

    function checkVersion(xhr) {
        return /^\s*\d+/.test(String(xhr.responseText || ''));
    }

    /** samples замеров подряд. cb({ok, loss, median, jitter, score}). */
    function measure(url, check, samples, cb) {
        var ms = [], n = 0;
        (function next() {
            if (n >= samples) return cb(stats(ms, samples));
            n++;
            probeOnce(url, check, function (v) {
                if (v !== null) ms.push(v);
                setTimeout(next, samples > 1 ? 200 : 0);
            });
        })();
    }

    function stats(ms, samples) {
        var ok = ms.length, loss = (samples - ok) / samples;
        if (!ok) return { ok: 0, loss: 1, median: null, jitter: null, score: Infinity };
        var s = ms.slice().sort(function (a, b) { return a - b; });
        var median = s[Math.floor(s.length / 2)];
        var jitter = 0;
        for (var i = 1; i < ms.length; i++) jitter += Math.abs(ms[i] - ms[i - 1]);
        jitter = ms.length > 1 ? Math.round(jitter / (ms.length - 1)) : 0;
        return { ok: ok, loss: loss, median: median, jitter: jitter, score: median + 2 * jitter + loss * 1500 };
    }

    function dead(st) { return !st || st.ok === 0 || st.loss >= 0.5; }

    /** Замер серверов источников обоих семейств параллельно. cb(result). */
    function measureAll(samples, cb, onEach) {
        var res = { online: {}, time: Date.now() }, left = 0;
        function done() { if (--left === 0) { last = res; save(); cb(res); } }
        for (var f in FAMILIES) if (FAMILIES.hasOwnProperty(f)) {
            for (var j = 0; j < FAMILIES[f].length; j++) (function (h) {
                left++;
                measure('http://' + h + '.skaz.tv/version', checkVersion, samples, function (st) { res.online[h] = st; if (onEach) onEach(res); done(); });
            })(FAMILIES[f][j]);
        }
    }

    /** Оценка семейства: среднее двух лучших живых серверов (одного живого мало для запаса). */
    function familyStat(res, fam) {
        var alive = [];
        for (var i = 0; i < FAMILIES[fam].length; i++) {
            var st = res.online[FAMILIES[fam][i]];
            if (st && !dead(st)) alive.push(st);
        }
        if (!alive.length) return { alive: 0, score: Infinity, median: null, jitter: null };
        alive.sort(function (a, b) { return a.score - b.score; });
        var top = alive.slice(0, 2), score = 0, med = 0, jit = 0;
        for (var k = 0; k < top.length; k++) { score += top[k].score; med += top[k].median; jit += top[k].jitter; }
        return { alive: alive.length, score: score / top.length, median: Math.round(med / top.length), jitter: Math.round(jit / top.length) };
    }

    function save() {
        try { lsSet('bs_srv_stats', JSON.stringify(last)); } catch (e) {}
    }

    /* ---------- решения ---------- */

    function fmt(st) {
        if (!st || st.median === null) return 'нет ответа';
        return st.median + ' мс' + (st.jitter ? ' ±' + st.jitter : '') + (st.loss > 0 ? ', потери ' + Math.round(st.loss * 100) + '%' : '');
    }

    function famName(f) { return f === 'cf' ? 'через Cloudflare' : 'прямые'; }

    /* Фоновые сообщения (сам сменил сервер) — не плашкой Lampa посреди экрана, а тихой полупрозрачной строкой
     * в нижнем углу: не перекрывает картинку, не забирает пульт, гаснет сама. Ответы на действия человека
     * («Проверить и выбрать сервер») — обычной плашкой Lampa: их он ждёт. */
    var toastEl = null, toastTimer = null;
    function toast(text, time) {
        // один вид для всех уведомлений — карточка Lampa.Noty (оформление в bs.css); своя строка — только до запуска Lampa
        try { if (window.appready && window.Lampa && Lampa.Noty) return Lampa.Noty.show(text, { time: time || 5000 }); } catch (e) {}
        try {
            if (!toastEl) {
                var st = document.createElement('style');
                st.textContent = '.bs-toast{position:fixed;right:2.2em;bottom:1.6em;z-index:9999;max-width:38%;padding:.45em .9em;' +
                    'border-radius:.6em;background:rgba(0,0,0,.35);color:rgba(255,255,255,.7);font-size:.95em;line-height:1.35;' +
                    'pointer-events:none;opacity:0;transition:opacity .6s}.bs-toast.show{opacity:1}';
                document.head.appendChild(st);
                toastEl = document.createElement('div');
                toastEl.className = 'bs-toast';
                document.body.appendChild(toastEl);
            }
            toastEl.textContent = text;
            toastEl.className = 'bs-toast show';
            clearTimeout(toastTimer);
            toastTimer = setTimeout(function () { toastEl.className = 'bs-toast'; }, time || 5000);
        } catch (e) {}
    }

    function notice(text) {
        if (window.appready && document.body) return toast(text);
        notices.push(text);
    }

    function say(text) {
        try { Lampa.Noty.show(text, { time: 7000 }); } catch (e) { toast(text); }
    }

    /** true — переключаться сразу (текущий не работает); 'later' — только со следующего запуска. */
    function worse(cur, best) {
        if (dead(cur)) return best && best.loss > 0 ? false : true;
        if (best.score < cur.score * 0.6 && cur.score - best.score > 150) return 'later';
        if (cur.jitter > 150 && best.jitter < 60 && best.median < cur.median + 100) return 'later';
        return false;
    }

    /** Применить результаты замера. mode: 'fast' (до запуска) или 'full' (в работе). Возвращает, нужен ли перезапуск. */
    var recheck = false;
    function pending() { try { return JSON.parse(lsGet('bs_srv_pending') || '{}') || {}; } catch (e) { return {}; } }
    function savePending(p) { lsSet('bs_srv_pending', JSON.stringify(p)); }
    function manualRecently() { return Date.now() - (parseInt(lsGet('bs_srv_manual') || '0', 10) || 0) < MANUAL_KEEP; }
    /** Отложенный совет «со следующего запуска» — применить до старта Lampa. */
    function applyPending() {
        noteSkazToggle();                                       // переключили в Skaz после совета — совет снят
        var p = pending();
        // p.domain — совет из версий до 1.7.61 (сервер ТВ by Skaz): не применяем, просто убираем
        if (p.family) setLampa('skazonline_servers', p.family === 'cf');
        if (p.domain || p.family) lsSet('bs_srv_pending', '{}');
    }

    function decide(res, mode) {
        noteSkazToggle();
        var reload = false, manual = manualRecently(), pend = pending();
        recheck = false;

        // Семейство серверов онлайн-источников (сервер ТВ by Skaz не трогаем — см. шапку)
        var cf = curFamily(), other = cf === 'cf' ? 'direct' : 'cf';
        var sc = familyStat(res, cf), so = familyStat(res, other);
        if (so.alive) {
            var wf = mode === 'fast' ? (sc.alive ? false : true) : worse(sc.alive ? sc : null, so);
            if (wf === true && mode === 'full' && suspectFamily !== cf) { suspectFamily = cf; wf = false; recheck = true; }
            if (wf === true) {
                suspectFamily = '';
                setLampa('skazonline_servers', other === 'cf');
                notice('Серверы фильмов не отвечают — перешёл на ' + (other === 'cf' ? 'резервные' : 'основные'));
                reload = mode === 'full';
            } else if (wf === 'later' && !manual && pend.family !== other) {
                pend.family = other; savePending(pend);
                notice('Нашёл серверы быстрее — включу при следующем запуске');
            }
        } else if (mode === 'full') suspectFamily = '';
        return reload;
    }

    function playerOpen() {
        try { return !!(Lampa.Player && Lampa.Player.opened && Lampa.Player.opened()); } catch (e) { return false; }
    }

    /** Перезапуск Lampa, чтобы плагины подхватили новый сервер. Во время просмотра — после плеера. */
    function reloadSoon(reason) {
        var lastAt = parseInt(lsGet('bs_srv_reload_at') || '0', 10) || 0;
        if (Date.now() - lastAt < RELOAD_GAP) {
            notice('Новый сервер — при следующем запуске');
            return;
        }
        if (playerOpen()) {
            if (!pendingReload) notice('Новый сервер — после закрытия плеера');
            pendingReload = reason;
            return;
        }
        setTimeout(function () {
            if (playerOpen()) { pendingReload = reason; return; }
            lsSet('bs_srv_reload_at', String(Date.now()));
            location.reload();
        }, 4000);
    }

    /* ---------- публичное ---------- */

    /** До запуска Lampa: быстрый замер, cb() не позже чем через FAST_BUDGET.
     * Lampa стартует, как только ответил хоть один сервер текущего семейства: до запуска мы меняем
     * сервер, только если текущий мёртв, — ждать остальные ответы (до 2,5 с, медленный или мёртвый чужой сервер)
     * незачем. Замер доходит в фоне; мёртвый текущий выяснится в полном замере и переключится с перезапуском. */
    function prepare(cb) {
        if (!enabled()) return cb();
        try { applyPending(); } catch (e) {}
        var called = false, cf = curFamily();
        function go() { if (!called) { called = true; cb(); } }
        setTimeout(go, FAST_BUDGET);
        // Lampa уже стартовала (истёк бюджет) — плагины прочли сервер; молча менять его поздно и по одной пробе
        // рискованно: разберётся полный замер.
        measureAll(1, function (res) { if (!called) decide(res, 'fast'); go(); }, function (res) {
            if (called) return;
            if (familyStat(res, cf).alive > 0) go();
        });
    }

    var waiters = [];

    function check(manual, done) {
        if (done) waiters.push(done);
        if (running) return;
        running = true;
        measureAll(4, function (res) {
            running = false;
            var ws = waiters; waiters = [];
            var reload = enabled() && decide(res, 'full');
            if (reload) reloadSoon('server');
            else if (recheck && enabled()) setTimeout(function () { check(false); }, 20000);   // подтвердить, что сервер правда умер
            else if (recheck) recheck = false;                  // автовыбор выключили — перепроверка больше не нужна
            else if (manual) say('Серверы фильмов: ' + famName(curFamily()) + ' · ' + fmt(familyStat(res, curFamily())));
            for (var i = 0; i < ws.length; i++) { try { ws[i](res); } catch (e) {} }
        });
    }

    /** Экран выбора серверов источников с пингом, джиттером и потерями; выбор вручную. Сервер ТВ by Skaz — в его настройках. */
    function showPicker() {
        say('Проверяю серверы…');
        check(false, function (res) {
            var items = [];
            items.push({ title: 'Серверы онлайн-источников (фильмы и сериалы)', separator: true });
            ['direct', 'cf'].forEach(function (f) {
                items.push({ title: famName(f) + (f === curFamily() ? ' — текущие' : ''), subtitle: fmt(familyStat(res, f)) + ', живых ' + familyStat(res, f).alive + ' из 4', kind: 'family', value: f });
            });
            var ctrl = Lampa.Controller.enabled().name;
            Lampa.Select.show({
                title: 'Серверы источников',
                items: items,
                onBack: function () { Lampa.Controller.toggle(ctrl); },
                onSelect: function (a) {
                    Lampa.Controller.toggle(ctrl);
                    lsSet('bs_srv_manual', String(Date.now())); lsSet('bs_srv_pending', '{}');
                    if (a.kind === 'family' && a.value !== curFamily()) setLampa('skazonline_servers', a.value === 'cf');
                    else return;
                    say('Сервер выбран — перезапускаю Lampa');
                    setTimeout(function () { location.reload(); }, 1500);
                }
            });
        });
    }

    function addSettings() {
        if (!Lampa.SettingsApi) return;
        var C = 'bs_update';
        Lampa.SettingsApi.addParam({ component: C, param: { name: 'bs_srv_title', type: 'title' }, field: { name: 'Серверы Skaz' } });
        Lampa.SettingsApi.addParam({
            component: C,
            param: { name: 'bs_srv_now', type: 'static' },
            field: { name: 'Сейчас', description: '…' },
            onRender: function (item) {
                var f = curFamily();
                item.find('.settings-param__descr').text('Источники ' + famName(f) + ' (' + fmt(familyStat(last, f)) + '). Сервер ТВ by Skaz — в настройках Skaz.');
            }
        });
        Lampa.SettingsApi.addParam({
            component: C,
            param: { name: 'bs_srv_auto', type: 'trigger', 'default': true },
            field: { name: 'Автовыбор серверов источников', description: 'Сам меняет зависшие серверы' },
            onChange: function (v) { lsSet('bs_srv_auto', String(v === true || v === 'true')); }
        });
        Lampa.SettingsApi.addParam({
            component: C,
            param: { name: 'bs_srv_pick', type: 'button' },
            field: { name: 'Выбрать сервер вручную', description: 'Покажет скорость серверов' },
            onChange: showPicker
        });
    }

    /** После готовности Lampa: уведомления, фоновый контроль, отложенный перезапуск. */
    function start() {
        for (var i = 0; i < notices.length; i++) (function (t, k) {
            setTimeout(function () { toast(t); }, 3000 + k * 5500);
        })(notices[i], i);
        notices = [];
        try { addSettings(); } catch (e) {}
        try {
            Lampa.Player.listener.follow('destroy', function () {
                if (pendingReload) setTimeout(function () { lsSet('bs_srv_reload_at', String(Date.now())); location.reload(); }, 1000);
            });
        } catch (e) {}
        /* Во время просмотра не меряем: канал забит видео, очередь в роутере раздувает задержки (bufferbloat) — замер
         * показал бы «скачки» у вполне живого сервера, а ~50 запросов за раз ещё и отнимают у видео. Сервер видео уже
         * выбран; новые запросы к Skaz пойдут после плеера — тогда и проверим. */
        var due = false;
        var tryCheck = function () { if (!enabled()) return; if (playerOpen() || document.hidden) { due = true; return; } due = false; check(false); };
        setTimeout(tryCheck, 20000);
        setInterval(tryCheck, WATCH_MS);
        try { Lampa.Player.listener.follow('destroy', function () { if (due) setTimeout(tryCheck, 5000); }); } catch (e) {}
        window.addEventListener('online', function () { if (enabled()) setTimeout(function () { if (!playerOpen()) check(false); }, 3000); });
    }

    try { last = JSON.parse(lsGet('bs_srv_stats') || 'null') || last; if (!last.online) last.online = {}; } catch (e) {}

    return { prepare: prepare, start: start, check: check, showPicker: showPicker, toast: toast, _decide: decide, _stats: stats };
})();
