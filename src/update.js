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
    var CDN = 'https://cdn.jsdelivr.net/gh/' + REPO + '@v';
    // порядок важен: loader.js — последним (запускает остальное)
    var LOCAL = ['skazauto.js', 'playerguard.js', 'bsfeatures.js', 'bsplayer.js', 'bsrch.js', 'bsprobe.js', 'bsfix.js', 'bsmenu.js',
        'bscontinue.js', 'bswatch.js', 'bshub.js', 'bstg.js', 'bsvolume.js', 'loader.js'];

    function get(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
    function set(k, v) { try { if (v === null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v); } catch (e) {} }
    function num(v) { var m = /(\d+)\.(\d+)\.(\d+)/.exec(String(v || '')); return m ? +m[1] * 1e6 + +m[2] * 1e3 + +m[3] : 0; }
    function okName(f) { return /^[\w.-]+\.js$/.test(f); }

    var pkg = '';
    try { pkg = tizen.application.getCurrentApplication().appInfo.version; } catch (e) {}
    var upd = null;
    try { upd = JSON.parse(get('bs_upd') || 'null'); } catch (e) {}
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

    window.bsUpdFail = function () {                        // файл с CDN не пришёл — сеть: час работаем с пакетом
        if (!remote || window.bsUpdFailed) return;
        window.bsUpdFailed = true;
        set('bs_upd_try', null);
        set('bs_upd_skip', String(Date.now() + 3600000));
        try { window.location.reload(); } catch (e) {}
    };
    var html = remote ? '<link rel="stylesheet" href="' + base + 'bs.css">' : '';
    for (var i = 0; i < files.length; i++) html += '<script src="' + base + files[i] + '"' + (remote ? ' onerror="bsUpdFail()"' : '') + '><\/script>';
    document.write(html);

    function check() {
        if (get('bs_gh_update') === 'false') return;
        var x = new XMLHttpRequest();
        try {
            x.open('GET', MANIFEST + '?t=' + Date.now(), true);
            x.timeout = 15000;
            x.onload = function () {
                var m = null;
                try { m = JSON.parse(x.responseText); } catch (e) {}
                if (x.status !== 200 || !m || !/^\d+\.\d+\.\d+$/.test(String(m.version)) || !m.files || !m.files.length || !m.files.every(okName)) return;
                var now = window.BS_REMOTE_VERSION || pkg;
                if (num(m.version) <= num(now) || m.version === bad) return;
                var was = upd && upd.v;
                set('bs_upd', JSON.stringify({ v: m.version, files: m.files }));
                if (was !== m.version) {
                    try { console.log('BS update', 'на GitHub ' + m.version + ', сейчас ' + now); } catch (e) {}
                    try { Lampa.Noty.show('Lampa обновится до ' + m.version + ' при следующем запуске', { time: 6000 }); } catch (e) {}
                }
            };
            x.send();
        } catch (e) {}
    }
    var waits = 0, t = setInterval(function () {
        if (window.appready) { clearInterval(t); set('bs_upd_try', null); setTimeout(check, 20000); }
        else if (++waits > 90) clearInterval(t);                // 3 минуты не поднялась — try остаётся, в следующий раз — пакет
    }, 2000);
    window.BSUpdate = { local: LOCAL, check: check, _num: num };
})();
