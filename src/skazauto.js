/*
 * Автовыбор серверов Skaz по пингу, джиттеру и потерям.
 *
 * Два набора серверов:
 *  1. Домен контента (настройка Lampa `skaz_domain`) — privateinit.js берёт с него ТВ by Skaz
 *     и прочее. Сам Skaz выбирает его только вручную.
 *  2. Семейство серверов онлайн-источников (`skazonline_servers`): прямые online3/4/5/7 или
 *     через Cloudflare onlinecf3/4/5/7. onlines.js пингует серверы только внутри выбранного
 *     семейства, одним замером; само семейство не переключает.
 *
 * Сервер «рабочий», только если отдал настоящий ответ: favicon.ico (image/*) у доменов
 * контента, число из /version у серверов источников. Заглушка провайдера — не рабочий.
 * Оценка = медиана + 2 × джиттер + штраф за потери; меньше — лучше.
 *
 * До запуска Lampa — быстрый замер (до 2.5 с). После запуска — полный замер через 20 с,
 * затем каждые 3 минуты и при появлении сети. Мёртвый сервер меняется сразу (перезапуск
 * Lampa откладывается, пока открыт плеер), просто медленный — со следующего запуска.
 */
var BSSkaz = (function () {
    var DOMAINS = ['skaz.tv', 'skaztv.online', 'skaz.team', 'skaztv.top', 'list.skaz.tv'];
    var FAMILIES = {
        direct: ['online3', 'online4', 'online5', 'online7'],
        cf: ['onlinecf3', 'onlinecf4', 'onlinecf5', 'onlinecf7']
    };
    var PROBE_TIMEOUT = 3000, FAST_BUDGET = 2500, WATCH_MS = 3 * 60 * 1000;

    var last = { domains: {}, online: {}, time: 0 };
    var pendingReload = null;   // причина перезапуска, отложенного до закрытия плеера
    /* Защита от перезапусков по кругу на плохом Wi-Fi (сервер «мёртв» уже при 2 потерянных пробах из 4):
     *  - мёртвым текущий сервер считается только после двух полных замеров подряд (suspect*);
     *  - переключаемся только на сервер без потерь;
     *  - автоперезапуск — не чаще раза в 30 мин (bs_srv_reload_at), иначе новый сервер — со следующего запуска;
     *  - «лучше, но работает» не пишется сразу (иначе curDomain() перестаёт быть тем, что реально работает), а
     *    откладывается до следующего запуска (bs_srv_pending); ручной выбор (bs_srv_manual) такие советы не перебивают. */
    var suspectDomain = '', suspectFamily = '', RELOAD_GAP = 30 * 60 * 1000, MANUAL_KEEP = 7 * 24 * 3600 * 1000;
    var notices = [];
    var running = false;

    /* ---------- хранилище (до и после запуска Lampa) ---------- */

    function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }

    function setLampa(k, v) {
        if (window.Lampa && Lampa.Storage) Lampa.Storage.set(k, v);
        else lsSet(k, String(v));
    }

    function enabled() { return lsGet('bs_srv_auto') !== 'false'; }

    function curDomain() {
        var d = (window.Lampa && Lampa.Storage) ? Lampa.Storage.get('skaz_domain', '') : lsGet('skaz_domain');
        return domainList().indexOf(d) >= 0 ? d : 'skaz.tv';
    }

    function curFamily() {
        var v = (window.Lampa && Lampa.Storage) ? Lampa.Storage.get('skazonline_servers', false) : lsGet('skazonline_servers');
        return (v === true || v === 'true') ? 'cf' : 'direct';
    }

    function domainList() {
        var list = DOMAINS.slice(), learned = [];
        try { learned = JSON.parse(lsGet('bs_skaz_list') || '[]') || []; } catch (e) {}
        for (var i = 0; i < learned.length; i++) {
            if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(learned[i]) && list.indexOf(learned[i]) < 0) list.push(learned[i]);
        }
        return list;
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

    function checkFavicon(xhr) {
        var t = (xhr.getResponseHeader('Content-Type') || '').toLowerCase();
        return t.indexOf('image') >= 0 || t.indexOf('icon') >= 0;
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

    /** Замер всех серверов обоих наборов параллельно. cb(result). */
    function measureAll(samples, cb, onEach) {
        var res = { domains: {}, online: {}, time: Date.now() }, left = 0;
        function done() { if (--left === 0) { last = res; save(); cb(res); } }
        var list = domainList();
        left += list.length;
        for (var i = 0; i < list.length; i++) (function (d) {
            measure('http://' + d + '/favicon.ico', checkFavicon, samples, function (st) { res.domains[d] = st; if (onEach) onEach(res); done(); });
        })(list[i]);
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

    function bestDomain(res) {
        var best = null;
        for (var d in res.domains) if (res.domains.hasOwnProperty(d)) {
            var st = res.domains[d];
            if (!dead(st) && (!best || st.score < res.domains[best].score)) best = d;
        }
        return best;
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
        var p = pending();
        if (p.domain && domainList().indexOf(p.domain) >= 0) setLampa('skaz_domain', p.domain);
        if (p.family) setLampa('skazonline_servers', p.family === 'cf');
        if (p.domain || p.family) lsSet('bs_srv_pending', '{}');
    }

    function decide(res, mode) {
        var reload = false;
        recheck = false;

        // 1. Домен контента
        var cd = curDomain(), bd = bestDomain(res), manual = manualRecently(), pend = pending();
        if (bd && bd !== cd) {
            var w = mode === 'fast' ? (dead(res.domains[cd]) ? true : false) : worse(res.domains[cd], res.domains[bd]);
            if (w === true && mode === 'full' && suspectDomain !== cd) { suspectDomain = cd; w = false; recheck = true; }
            if (w === true) {
                suspectDomain = '';
                setLampa('skaz_domain', bd);
                notice('Skaz: ' + cd + ' не отвечает, переключился на ' + bd);
                reload = mode === 'full';
            } else if (w === 'later' && !manual && pend.domain !== bd) {
                pend.domain = bd; savePending(pend);
                notice('Skaz: ' + bd + ' быстрее (' + fmt(res.domains[bd]) + ') — со следующего запуска');
            }
        } else if (mode === 'full') suspectDomain = '';

        // 2. Семейство серверов онлайн-источников
        var cf = curFamily(), other = cf === 'cf' ? 'direct' : 'cf';
        var sc = familyStat(res, cf), so = familyStat(res, other);
        if (so.alive) {
            var wf = mode === 'fast' ? (sc.alive ? false : true) : worse(sc.alive ? sc : null, so);
            if (wf === true && mode === 'full' && suspectFamily !== cf) { suspectFamily = cf; wf = false; recheck = true; }
            if (wf === true) {
                suspectFamily = '';
                setLampa('skazonline_servers', other === 'cf');
                notice('Источники: ' + famName(cf) + ' не отвечают, переключился на ' + famName(other));
                reload = reload || mode === 'full';
            } else if (wf === 'later' && !manual && pend.family !== other) {
                pend.family = other; savePending(pend);
                notice('Источники ' + famName(other) + ' быстрее (' + fmt(so) + ') — со следующего запуска');
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
            notice('Новый сервер Skaz включится при следующем запуске');
            return;
        }
        if (playerOpen()) {
            if (!pendingReload) notice('Новый сервер включу после закрытия плеера');
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
     * Lampa стартует, как только ответили текущий домен и хоть один сервер текущего семейства: до запуска мы меняем
     * сервер, только если текущий мёртв, — ждать остальные ответы (до 2,5 с, медленный или мёртвый чужой сервер)
     * незачем. Замер доходит в фоне; мёртвый текущий выяснится в полном замере и переключится с перезапуском. */
    function prepare(cb) {
        if (!enabled()) return cb();
        try { applyPending(); } catch (e) {}
        var called = false, cd = curDomain(), cf = curFamily();
        function go() { if (!called) { called = true; cb(); } }
        setTimeout(go, FAST_BUDGET);
        // Lampa уже стартовала (истёк бюджет) — плагины прочли сервер; молча менять его поздно и по одной пробе
        // рискованно: разберётся полный замер.
        measureAll(1, function (res) { if (!called) decide(res, 'fast'); go(); }, function (res) {
            if (called) return;
            var d = res.domains[cd];
            if (d && !dead(d) && familyStat(res, cf).alive > 0) go();
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
            else if (recheck) setTimeout(function () { check(false); }, 20000);   // подтвердить, что сервер правда умер
            else if (manual) say('Серверы Skaz: ' + curDomain() + ' ' + fmt(res.domains[curDomain()]) + '; источники ' + famName(curFamily()) + ' ' + fmt(familyStat(res, curFamily())));
            for (var i = 0; i < ws.length; i++) { try { ws[i](res); } catch (e) {} }
        });
    }

    /** Свежий список доменов прямо из плагина Skaz — новые серверы подхватываются сами. */
    function learnList() {
        var xhr = new XMLHttpRequest();
        try {
            xhr.open('GET', 'http://lampa.byskaz.ru/plugins/privateinit.js?_=' + Date.now(), true);
            xhr.timeout = 15000;
            xhr.onload = function () {
                var m = /SKAZ_DOMAINS\s*=\s*\[([^\]]+)\]/.exec(xhr.responseText || '');
                if (!m) return;
                var found = m[1].match(/['"]([a-z0-9.-]+\.[a-z]{2,})['"]/gi) || [];
                for (var i = 0; i < found.length; i++) found[i] = found[i].replace(/['"]/g, '');
                if (found.length) lsSet('bs_skaz_list', JSON.stringify(found));
            };
            xhr.send();
        } catch (e) {}
    }

    /** Экран выбора: все серверы с пингом, джиттером и потерями; выбор вручную. */
    function showPicker() {
        say('Проверяю серверы Skaz…');
        check(false, function (res) {
            var items = [], cd = curDomain(), bd = bestDomain(res);
            items.push({ title: 'Домен Skaz (ТВ и плагины)', separator: true });
            var list = domainList();
            for (var i = 0; i < list.length; i++) {
                var d = list[i];
                items.push({ title: d + (d === cd ? ' — текущий' : '') + (d === bd ? ' ★' : ''), subtitle: fmt(res.domains[d]), kind: 'domain', value: d });
            }
            items.push({ title: 'Серверы онлайн-источников', separator: true });
            ['direct', 'cf'].forEach(function (f) {
                items.push({ title: famName(f) + (f === curFamily() ? ' — текущие' : ''), subtitle: fmt(familyStat(res, f)) + ', живых ' + familyStat(res, f).alive + ' из 4', kind: 'family', value: f });
            });
            var ctrl = Lampa.Controller.enabled().name;
            Lampa.Select.show({
                title: 'Серверы Skaz',
                items: items,
                onBack: function () { Lampa.Controller.toggle(ctrl); },
                onSelect: function (a) {
                    Lampa.Controller.toggle(ctrl);
                    lsSet('bs_srv_manual', String(Date.now())); lsSet('bs_srv_pending', '{}');
                    if (a.kind === 'domain' && a.value !== curDomain()) setLampa('skaz_domain', a.value);
                    else if (a.kind === 'family' && a.value !== curFamily()) setLampa('skazonline_servers', a.value === 'cf');
                    else return;
                    say('Сервер выбран. Перезапускаю Lampa…');
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
                var d = curDomain(), f = curFamily();
                item.find('.settings-param__descr').text('Домен ' + d + ' (' + fmt(last.domains[d]) + '), источники ' + famName(f) + ' (' + fmt(familyStat(last, f)) + ')');
            }
        });
        Lampa.SettingsApi.addParam({
            component: C,
            param: { name: 'bs_srv_auto', type: 'trigger', 'default': true },
            field: { name: 'Автовыбор серверов', description: 'Сам меняет зависший сервер.' },
            onChange: function (v) { lsSet('bs_srv_auto', String(v === true || v === 'true')); }
        });
        Lampa.SettingsApi.addParam({
            component: C,
            param: { name: 'bs_srv_pick', type: 'button' },
            field: { name: 'Проверить и выбрать сервер', description: 'Пинг всех серверов, ★ — лучший.' },
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
        setTimeout(learnList, 10000);
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

    try { last = JSON.parse(lsGet('bs_srv_stats') || 'null') || last; } catch (e) {}

    return { prepare: prepare, start: start, check: check, showPicker: showPicker, toast: toast, _decide: decide, _stats: stats };
})();
