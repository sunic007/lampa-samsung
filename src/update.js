/*
 * Автообновление с GitHub (sunic007/lampa-samsung): свои модули (bs*.js, loader.js, bs.css) берутся с jsDelivr по
 * тегу версии, если на GitHub она новее пакета. Сама Lampa (app.js), библиотеки и config.xml — из пакета; изменения
 * config.xml (разрешения, служба) по-прежнему требуют установки .wgt.
 *
 * Как: index.html грузит только этот файл, он вписывает теги <script> по порядку — из пакета или с CDN.
 * Когда Lampa поднялась (window.appready) — смотрим version.json на GitHub; новее — запоминаем, применится при
 * следующем запуске (посреди фильма ничего не перезагружаем).
 * Защита: файл с CDN не загрузился (нет сети) — перезапуск с пакетом, эту версию час не трогаем; с новой версией
 * Lampa не поднялась (bs_upd_try остался с прошлого запуска) — версия помечается плохой, работает пакет.
 */
(function () {
    // pack.py вписывает сюда hash и версию app.js из пакета (loader.js с GitHub про них не знает)
    var BS_PKG_APP = null;
    window.BS_PKG_APP = BS_PKG_APP;
    var REPO = 'sunic007/lampa-samsung';
    var MANIFEST = 'https://raw.githubusercontent.com/' + REPO + '/main/version.json';
    // Зеркала jsDelivr (разные сети одного CDN). Свежий тег основной иногда отдаёт с 503 — тогда следующее зеркало, а не
    // час на пакете. raw.githubusercontent не годится: text/plain + nosniff, такой скрипт ТВ не выполнит.
    var MIRRORS = ['https://cdn.jsdelivr.net/gh/', 'https://fastly.jsdelivr.net/gh/', 'https://gcore.jsdelivr.net/gh/'];
    var mirror = +(get('bs_upd_mirror') || 0);
    if (!(mirror >= 0 && mirror < MIRRORS.length)) mirror = 0;
    var CDN = MIRRORS[mirror] + REPO + '@v';
    // порядок важен: loader.js — последним (запускает остальное)
    var LOCAL = ['skazauto.js', 'playerguard.js', 'bsfeatures.js', 'bsplayer.js', 'bsrch.js', 'bsprobe.js', 'bsfix.js', 'bssources.js', 'bsmenu.js',
        'bscontinue.js', 'bswatch.js', 'bshub.js', 'bstg.js', 'bsvolume.js', 'loader.js'];

    function get(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
    function set(k, v) { try { if (v === null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v); } catch (e) {} }
    function num(v) { var m = /(\d+)\.(\d+)\.(\d+)/.exec(String(v || '')); return m ? +m[1] * 1e6 + +m[2] * 1e3 + +m[3] : 0; }
    function okName(f) { return /^[\w.-]+\.js$/.test(f); }

    var pkg = '';
    try { pkg = tizen.application.getCurrentApplication().appInfo.version; } catch (e) {}
    var upd = null;
    try { upd = JSON.parse(get('bs_upd') || 'null'); } catch (e) {}
    // зеркало, на котором check() нашёл все файлы версии; сбой по дороге (bs_upd_mirror) — важнее
    if (get('bs_upd_mirror') === null && upd && upd.m > 0 && upd.m < MIRRORS.length) { mirror = upd.m; CDN = MIRRORS[mirror] + REPO + '@v'; }
    // «v|время»: версия, на которой Lampa не поднялась, через сутки получает ещё попытку
    var badRaw = String(get('bs_upd_bad') || ''), badAt = +(badRaw.split('|')[1] || 0);
    var bad = badRaw && (!badAt || Date.now() - badAt < 86400000) ? badRaw.split('|')[0] : '', skipUntil = +(get('bs_upd_skip') || 0);
    var remote = get('bs_gh_update') !== 'false' && !!upd && /^\d+\.\d+\.\d+$/.test(String(upd.v)) && num(upd.v) > num(pkg) && upd.v !== bad && Date.now() > skipUntil &&
        !!upd.files && upd.files.length > 0 && upd.files.every(okName);
    if (remote && get('bs_upd_try') === upd.v) {            // прошлый запуск с этой версией до готовности не дошёл
        set('bs_upd_bad', upd.v + '|' + Date.now());
        bad = upd.v;
        remote = false;
    }
    var base = remote ? CDN + upd.v + '/src/' : '';
    var files = remote ? upd.files : LOCAL;
    if (remote) { set('bs_upd_try', upd.v); window.BS_REMOTE_VERSION = upd.v; }

    window.bsUpdFail = function () {                        // файл с CDN не пришёл: следующее зеркало, все не ответили — час на пакете
        if (!remote || window.bsUpdFailed) return;
        window.bsUpdFailed = true;
        set('bs_upd_try', null);                            // это сбой сети, а не плохая версия
        if (mirror + 1 < MIRRORS.length) set('bs_upd_mirror', String(mirror + 1));
        else { set('bs_upd_mirror', null); set('bs_upd_skip', String(Date.now() + 3600000)); }
        try { window.location.reload(); } catch (e) {}
    };
    // Статистика на экране загрузки: пока модули идут с CDN, видно, что происходит (вместо пустого фона Lampa)
    var statStart = Date.now(), statLoaded = 0, statEl = null, statTimer = null;
    function statText() {
        var sec = Math.round((Date.now() - statStart) / 1000);
        return 'Обновляю Lampa до ' + upd.v + ': загружено ' + statLoaded + ' из ' + files.length + ' · ' + sec + ' с';
    }
    function statShow() {
        if (!remote || statEl) return;
        statEl = document.createElement('div');
        statEl.id = 'bs-upd-stat';
        statEl.style.cssText = 'position:fixed;left:0;right:0;bottom:22%;z-index:999;text-align:center;font-family:sans-serif;' +
            'font-size:1.3em;color:rgba(255,255,255,.85);text-shadow:0 1px 3px rgba(0,0,0,.6);padding:0 5%';
        statEl.textContent = statText();
        document.body.appendChild(statEl);
        statTimer = setInterval(function () { if (statEl) statEl.textContent = statText(); }, 1000);
    }
    function statHide() {
        clearInterval(statTimer);
        if (statEl && statEl.parentNode) statEl.parentNode.removeChild(statEl);
        statEl = null;
    }
    window.bsUpdLoaded = function () { statLoaded++; if (statEl) statEl.textContent = statText(); };

    var html = remote ? '<link rel="stylesheet" href="' + base + 'bs.css">' : '';
    for (var i = 0; i < files.length; i++) html += '<script src="' + base + files[i] + '"' + (remote ? ' onload="bsUpdLoaded()" onerror="bsUpdFail()"' : '') + '><\/script>';
    document.write(html);
    try { statShow(); } catch (e) {}                        // статистика — украшение: её сбой не должен ломать обновление

    /* Все файлы версии v отдаёт зеркало i? Свежий тег CDN несколько минут отвечает 503 — такую версию не запоминаем,
     * иначе следующий запуск ушёл бы в перезагрузки по зеркалам и потом на час на пакет (так было до 1.7.63). */
    function verifyOn(i, v, list, cb) {
        var names = list.concat(['bs.css']), left = names.length, done = false;
        var fin = function (ok) { if (done) return; if (!ok) { done = true; return cb(false); } if (--left === 0) { done = true; cb(true); } };
        for (var n = 0; n < names.length; n++) (function (f) {
            try {
                var x = new XMLHttpRequest();
                x.open('HEAD', MIRRORS[i] + REPO + '@v' + v + '/src/' + f, true);
                x.timeout = 15000;
                x.onload = function () { fin(x.status === 200); };
                x.onerror = x.ontimeout = function () { fin(false); };
                x.send();
            } catch (e) { fin(false); }
        })(names[n]);
    }
    /** cb(номер зеркала, где есть все файлы, или -1). */
    function verify(v, list, cb) {
        (function next(i) {
            if (i >= MIRRORS.length) return cb(-1);
            verifyOn(i, v, list, function (ok) { if (ok) cb(i); else next(i + 1); });
        })(0);
    }

    /**
     * Есть ли новая версия функций. Готова (все файлы на CDN) — запоминается в bs_upd и встанет при следующем
     * запуске или когда Lampa уйдёт в фон (loader.js). cb(версия | '', manifest) — версия, только если готова.
     */
    function check(cb) {
        var fin = function (v, m) { if (!cb) return; var c = cb; cb = null; c(v || '', m || null); };
        if (get('bs_gh_update') === 'false') return fin('');
        var x = new XMLHttpRequest();
        try {
            x.open('GET', MANIFEST + '?t=' + Date.now(), true);
            x.timeout = 15000;
            x.onload = function () {
                var m = null;
                try { m = JSON.parse(x.responseText); } catch (e) {}
                if (x.status !== 200 || !m || !/^\d+\.\d+\.\d+$/.test(String(m.version)) || !m.files || !m.files.length || !m.files.every(okName)) return fin('');
                var now = window.BS_REMOTE_VERSION || pkg;
                if (num(m.version) <= num(now) || m.version === bad) return fin('');
                if (upd && upd.v === m.version && upd.ok) return fin(m.version, m);       // уже проверена
                verify(m.version, m.files, function (i) {
                    if (i < 0) return fin('');                                            // CDN ещё не готов — в следующий раз
                    var was = upd && upd.v;
                    upd = { v: m.version, files: m.files, m: i, ok: 1 };
                    set('bs_upd', JSON.stringify(upd));
                    set('bs_upd_mirror', null);
                    if (was !== m.version) {
                        try { console.log('BS update', 'на GitHub ' + m.version + ' (зеркало ' + i + '), сейчас ' + now); } catch (e) {}
                        try { Lampa.Noty.show('Готово обновление ' + m.version + ' — встанет само, когда выйдете из Lampa или при следующем запуске', { time: 6000 }); } catch (e) {}
                    }
                    fin(m.version, m);
                });
            };
            x.onerror = x.ontimeout = function () { fin(''); };
            x.send();
        } catch (e) { fin(''); }
    }
    var waits = 0, t = setInterval(function () {
        if (window.appready) { clearInterval(t); statHide(); set('bs_upd_try', null); setTimeout(check, 20000); }
        else if (++waits > 90) clearInterval(t);                // 3 минуты не поднялась — try остаётся, в следующий раз — пакет
    }, 2000);
    window.BSUpdate = { local: LOCAL, check: check, _num: num, _base: base, _mirror: mirror, _verify: verify };
})();
