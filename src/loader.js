console.log('Start load');

/*
 * Сначала маленький assembly.json с сервера byskaz (версия и hash сборки). Если hash совпадает со встроенной
 * копией (app.js) — Lampa запускается из пакета: та же сборка, но без скачивания 2 МБ по HTTP на каждом старте.
 * Иначе (на сервере новая сборка) — app.min.js с сервера, обновления приходят сами.
 * Встроенная копия включается и тогда, когда сервер недоступен.
 * Всё, что происходит, показывается пользователю: строка статуса при запуске,
 * уведомление после запуска и раздел «Настройки → Обновление».
 */
var BS_SERVER = 'http://lampa.byskaz.ru/lampa-main/';
var BS_PACKAGE_VERSION = 'dev';   // версия пакета .wgt — pack.py подставляет её из config.xml
if (window.BS_REMOTE_VERSION) BS_PACKAGE_VERSION = window.BS_REMOTE_VERSION;   // модули пришли с GitHub (update.js)
var BS_BUNDLED_VERSION = '3.3.6'; // версия встроенной копии app.js — update_bundled.py
var BS_BUNDLED_HASH = 'c5701b7be6da4427afd2403b298886e3'; // hash из assembly.json этой копии — update_bundled.py
// loader.js пришёл с GitHub, а пакет на ТВ старее: app.js в пакете — та сборка, что записана в update.js пакета
if (window.BS_REMOTE_VERSION && window.BS_PKG_APP && window.BS_PKG_APP.hash) {
    BS_BUNDLED_HASH = window.BS_PKG_APP.hash;
    BS_BUNDLED_VERSION = window.BS_PKG_APP.version || BS_BUNDLED_VERSION;
}

var bsRemote = null;      // assembly.json с сервера: {app_version, hash, time}
var bsSource = '';        // 'server' | 'local' (из пакета, та же сборка что на сервере) | 'bundled' (сервер недоступен)
var bsStarted = false;

/* Настройки по умолчанию: постоянное левое меню и плагин «ТВ by Skaz».
 * Ставим один раз, до запуска Lampa; если пользователь потом выключит — не трогаем. */
try {
    if (!window.localStorage.getItem('bs_menu_default')) {
        window.localStorage.setItem('menu_always', 'true');
        window.localStorage.setItem('bs_menu_default', '1');
    }
    // Плеер Tizen (AVPlay) вместо встроенного браузерного: он надёжно играет HLS/4K на Samsung.
    if (!window.localStorage.getItem('bs_player_default')) {
        window.localStorage.setItem('player', 'tizen');
        window.localStorage.setItem('player_iptv', 'tizen');
        window.localStorage.setItem('bs_player_default', '1');
    }
    // ТВ by Skaz: privateinit.js подключает плагин tv.js только при входе в CUB или
    // если включён skaz_enable. Включаем его по умолчанию, чтобы SkazTV был сразу.
    if (!window.localStorage.getItem('bs_skaz_default')) {
        window.localStorage.setItem('skaz_enable', 'true');
        window.localStorage.setItem('bs_skaz_default', '1');
    }
} catch (e) {}

/* Первый запуск без перезагрузки. lampainit.js byskaz при первом запуске (нет lampac_initiale) записывает свои
 * настройки по умолчанию и делает window.location.reload() — Lampa на ТВ поднимается дважды, и первый запуск самый
 * долгий. Пишем те же значения сами до старта Lampa (как Lampa.Storage.set: строки, объекты — JSON) и ставим
 * lampac_initiale — lampainit видит, что всё готово, и не перезагружает. Список — из lampainit.js (2026-10);
 * поменяет byskaz свои умолчания — у новых установок будут прежние, на работу это не влияет. */
try {
    if (!window.localStorage.getItem('lampac_initiale')) {
        var bsLs = window.localStorage, bsInit = {
            theme_select: 'default', source: 'cub', full_btn_priority: '1768041904', proxy_tmdb: 'true',
            poster_size: 'w300', online_mod_rezka2_mirror: 'http://cors.byskaz.ru/http://kvk.zone',
            keyboard_type: 'integrate', parser_use: 'false',
            menu_hide: '["Лента","Торренты","Персоны","Расписание","Подписки","Источник"]',
            lme_pubtorr_firstrun: 'true', porborki_kp: '1', porborki_kach: '1', porborki_okko: '1', porborki_mult14: '1',
            noskaz2: '1', jackett_url: 'jac.red', jackett_key: '', parser_torrent_type: 'jackett',
            video_quality_default: '2160', iptv_use_db: 'storage', iptv_favotite_save: 'name'
        };
        if (!bsLs.getItem('language')) { bsLs.setItem('language', 'ru'); bsLs.setItem('tmdb_lang', 'ru'); }
        for (var bsK in bsInit) if (bsInit.hasOwnProperty(bsK)) bsLs.setItem(bsK, bsInit[bsK]);
        bsLs.setItem('lampac_initiale', 'true');
    }
} catch (e) {}

/* Быстрый выбор серверов Skaz идёт параллельно с проверкой связи; Lampa стартует после него. */
var bsSrvReady = false, bsSrvWaiting = null;
try {
    BSSkaz.prepare(function () {
        bsSrvReady = true;
        if (bsSrvWaiting) { var go = bsSrvWaiting; bsSrvWaiting = null; go(); }
    });
} catch (e) { bsSrvReady = true; }

/* ---------- строка статуса на экране загрузки ---------- */

function bsStatus(text) {
    var el = document.getElementById('bs-status');
    if (!el) {
        el = document.createElement('div');
        el.id = 'bs-status';
        el.style.cssText = 'position:fixed;left:0;right:0;bottom:9%;z-index:1000;text-align:center;' +
            'font-family:sans-serif;font-size:1.5em;color:rgba(255,255,255,.85);text-shadow:0 1px 3px rgba(0,0,0,.6);' +
            'padding:0 5%;-webkit-transition:opacity .4s;transition:opacity .4s';
        document.body.appendChild(el);
    }
    el.textContent = text;
}

/* Ошибки до готовности Lampa — выводим на экран, чтобы было видно, почему запуск встал. */
var bsErrors = [];

function bsError(text) {
    if (window.appready || bsErrors.indexOf(text) >= 0) return;
    bsErrors.push(text);
    var el = document.getElementById('bs-error');
    if (!el) {
        el = document.createElement('div');
        el.id = 'bs-error';
        el.style.cssText = 'position:fixed;left:0;right:0;bottom:3%;z-index:1000;text-align:center;' +
            'font-family:monospace;font-size:1.05em;color:#ff8a80;padding:0 5%;white-space:pre-wrap;word-break:break-all';
        document.body.appendChild(el);
    }
    el.textContent = 'Ошибка: ' + bsErrors.slice(-3).join('\n');
}

window.addEventListener('error', function (e) {
    // Ошибки скриптов с других доменов браузер отдаёт без текста («Script error.») —
    // по ним ничего не понять, а на экране они пугают. Показываем только осмысленные.
    if (!e.message || /^Script error\.?$/i.test(e.message)) return;
    var where = e.filename ? ' (' + String(e.filename).split('/').pop().split('?')[0] + ':' + e.lineno + ')' : '';
    bsError((e.message || 'неизвестная ошибка') + where);
});

// У каждого этапа запуска Lampa таймаут 16 с: при плохой связи с её серверами запуск
// может идти 1.5–2 минуты. Только после 150 с считаем, что загрузка действительно встала.
setTimeout(function () {
    if (!window.appready) {
        bsStatus('Lampa не запустилась за 2.5 минуты' + (bsStage ? ' (этап: ' + (BS_STAGES[bsStage] || bsStage) + ')' : '') +
            '. Сфотографируйте экран и перезапустите приложение.');
        clearInterval(bsStageTimer);
    }
}, 150000);

function bsHideStatus() {
    var el = document.getElementById('bs-status');
    if (!el) return;
    el.style.opacity = '0';
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 500);
}

function bsNoty(text, time) {
    try { Lampa.Noty.show(text, { time: time || 6000 }); } catch (e) { console.log('BS', text); }
}

function bsFormatDate(ms) {
    var d = new Date(ms);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/* ---------- загрузка ---------- */

/* Скрипт Lampa: ошибка, «загрузился, но это не Lampa» (страница-заглушка провайдера или Wi-Fi с авторизацией
 * отдаёт HTML с кодом 200) и зависшая загрузка (30 с) — всё считается ошибкой, иначе до запасной копии не дойти. */
function createScript(src,error){
    console.log('Load script:' + src);

    var done = false;
    var fail = function () { if (done || window.Lampa) return; done = true; clearTimeout(timer); if (error) error(); };
    var timer = setTimeout(fail, 30000);
    var script         = document.createElement('script');
        script.onerror = fail;
        script.onload  = function () { clearTimeout(timer); if (!window.Lampa) setTimeout(fail, 1500); else done = true; };
        script.src     = src;
        script.type    = 'text/javascript';

    document.getElementsByTagName("body")[0].appendChild(script);
}

function startAppWithDeepLink(){
    if (bsStarted) return;
    if (!bsSrvReady) {
        bsStatus('Выбираю лучший сервер Skaz…');
        bsSrvWaiting = startAppWithDeepLink;
        return;
    }
    bsStarted = true;
    var localFirst = true;
    try { localFirst = window.localStorage.getItem('bs_local_first') !== 'false'; } catch (e) {}
    if (localFirst && bsRemote && bsRemote.hash === BS_BUNDLED_HASH) {
        bsSource = 'local';
        bsStatus('Запускаю Lampa ' + BS_BUNDLED_VERSION + ' (последняя версия, из пакета)…');
        createScript('app.js', function () {
            console.log('Local copy error');
            bsSource = 'server';
            createScript(BS_SERVER + 'app.min.js?v' + Math.random(), function () { loadFromLocal(); });
        });
        return;
    }
    bsSource = 'server';
    bsStatus('Загружаю Lampa' + (bsRemote && bsRemote.app_version ? ' ' + bsRemote.app_version : '') + ' с сервера byskaz…');

    createScript(BS_SERVER + 'app.min.js?v' + Math.random(), function(){
        console.log('Server app.min.js failed — bundled copy');

        loadFromLocal()
    })
}

function bsDropOldCopy(){
    // Раньше тут копия app.min.js (2+ МБ) писалась в localStorage и забивала его почти целиком,
    // ломая сохранение настроек Lampa. Запасная копия теперь свежая и лежит в пакете (app.js).
    try { window.localStorage.removeItem('app.js') } catch (e) {}
}

function loadFromLocal(){
	if(window.appready || bsSource === 'bundled') return

    // Сервер ответил новой сборкой, а скачать её не вышло — запоминаем, иначе автообновление через 15 с увидит
    // «новую версию», перезапустит, загрузка снова сорвётся — и так по кругу каждые полминуты.
    if (bsRemote && bsRemote.hash) { try { window.localStorage.setItem('bs_failed_hash', bsRemote.hash + '|' + Date.now()); } catch (e) {} }
    bsSource = 'bundled';
    bsStatus('Сервер обновлений недоступен — запускаю встроенную версию ' + BS_BUNDLED_VERSION);

    createScript('app.js', function(){
        console.log('Load local error');
        bsStatus('Не удалось запустить Lampa. Проверьте интернет и перезапустите приложение.');
    })
}

var timeLeft = 15;
var timerId  = setInterval(countdown, 1000);

function checkConnection(url, successCb, errorCb) {
    var xhr = new XMLHttpRequest();
    var executed = false;

    xhr.open('GET', url, true);
    xhr.timeout = 3000;
    xhr.onload = function () {
        if (executed) {
            return;
        }
        executed = true;
        if (xhr.status == '200') {
            successCb && successCb(xhr);
        } else {
            errorCb && errorCb(xhr);
        }
    };
    xhr.onerror = function () {
        if (executed) {
            return;
        }
        executed = true;
        errorCb && errorCb(xhr);
    };
    xhr.ontimeout = function () {
        if (executed) {
            return;
        }
        executed = true;
        errorCb && errorCb(xhr);
    };
    xhr.send(null);
}

function parseAssembly(xhr) {
    try { return JSON.parse(xhr.responseText); } catch (e) { return null; }
}


var checking = false;

function countdown() {
    if (checking && timeLeft > 0) { timeLeft--; return; }

    if (timeLeft <= 0) {
        clearTimeout(timerId);

        // Сервер обновлений за 15 с так и не ответил — сеть плохая или её нет. Качать 2 МБ Lampa по такой сети незачем:
        // запускаем проверенную копию из пакета. Окажется на сервере новее — автообновление перейдёт на неё само,
        // когда связь появится (первая проверка через 15 с).
        if (!bsStarted) {
            bsStarted = true;
            loadFromLocal();
        }

        bsDropOldCopy();
    }
    else {
        if (timeLeft < 15) bsStatus('Нет связи с сервером обновлений, пробую ещё… (' + timeLeft + ' с)');
        else bsStatus('Проверяю связь с сервером обновлений…');

        // Проверяем связь маленьким файлом, а не всем app.min.js (2 МБ не успевали за таймаут).
        checking = true;
        checkConnection(
            BS_SERVER + 'assembly.json?v' + Math.random(),
            function (xhr) {
                checking = false;
                if (timeLeft < 0) return; // уже стартовали по таймауту
                clearTimeout(timerId);

                bsRemote = parseAssembly(xhr);
                if (bsRemote && !bsRemote.hash) bsRemote = null;
                startAppWithDeepLink();

                bsDropOldCopy();
            },
            function () {
                checking = false;
                console.log('No Network');
            });
    }

    timeLeft--;
}

/* ---------- после запуска: уведомление и раздел «Обновление» ---------- */

function bsRunningVersion() {
    try { if (Lampa.Manifest && Lampa.Manifest.app_version) return String(Lampa.Manifest.app_version); } catch (e) {}
    return bsSource === 'bundled' || bsSource === 'local' ? BS_BUNDLED_VERSION : (bsRemote && bsRemote.app_version) || '?';
}

function bsAnnounce() {
    var cur = bsRunningVersion();
    var last = null;
    try { last = window.localStorage.getItem('bs_version'); } catch (e) {}

    if (bsSource === 'bundled') {
        bsNoty('Нет связи с сервером обновлений — работает встроенная версия Lampa ' + cur +
            '. Обновится автоматически, когда сервер станет доступен.', 9000);
        return;
    }

    try {
        window.localStorage.setItem('bs_version', cur);
        window.localStorage.setItem('bs_checked', String(Date.now()));
    } catch (e) {}

    if (!last) bsNoty('Lampa ' + cur + ' запущена. Обновления с сервера byskaz ставятся автоматически.', 8000);
    else if (last !== cur) bsNoty('Lampa обновлена: ' + last + ' → ' + cur, 8000);
}

/** Запрос assembly.json. onResult(assembly) или onResult(null), если сервер недоступен. */
/* «Проверить и обновить»: новая версия функций пакета на GitHub — сразу запомнить её (bs_upd) для update.js, чтобы
 * перезагрузка тут же подняла новую версию. Раньше проверка шла параллельно с перезагрузкой, не успевала, и после
 * перезагрузки Lampa писала «обновится при следующем запуске». cb(версия | ''). */
/** Проверка новой версии функций на GitHub. cb(версия, info): info.notes - «что нового» из version.json,
 *  info.apply() - запомнить версию к перезагрузке. Сама проверка ничего не меняет: обновление ставится
 *  только после «Обновить сейчас» в окне (а без нажатия - как обычно, при следующем запуске). */
function bsGhCheck(cb) {
    var done = false, fin = function (v, info) { if (!done) { done = true; cb(v || '', info || null); } };
    var ls = window.localStorage;
    try { if (ls.getItem('bs_gh_update') === 'false') return fin(''); } catch (e) { return fin(''); }
    var num = function (v) { var m = /(\d+)\.(\d+)\.(\d+)/.exec(String(v || '')); return m ? +m[1] * 1e6 + +m[2] * 1e3 + +m[3] : 0; };
    var pkg = '';
    try { pkg = tizen.application.getCurrentApplication().appInfo.version; } catch (e) {}
    try {
        var x = new XMLHttpRequest();
        x.open('GET', 'https://raw.githubusercontent.com/sunic007/lampa-samsung/main/version.json?t=' + Date.now(), true);
        x.timeout = 10000;
        x.onload = function () {
            try {
                var m = JSON.parse(x.responseText), now = window.BS_REMOTE_VERSION || pkg || BS_PACKAGE_VERSION;
                var ok = x.status === 200 && m && m.version && m.files && m.files.length &&
                    m.files.every(function (f) { return /^[\w.-]+\.js$/.test(f); });
                if (!ok || !/^\d+\.\d+\.\d+$/.test(m.version) || num(m.version) <= num(now)) return fin('');
                // тег версии на jsDelivr уже есть? иначе перезагрузка ушла бы впустую
                var c = new XMLHttpRequest();
                c.open('GET', 'https://cdn.jsdelivr.net/gh/sunic007/lampa-samsung@v' + m.version + '/src/loader.js', true);
                c.timeout = 8000;
                c.onload = function () {
                    if (c.status !== 200) return fin('');
                    fin(m.version, {
                        notes: bsNotes(m.notes),
                        apply: function () {
                            // согласились обновить - даём версии ещё шанс, даже если раньше на ней не поднялась
                            if (String(ls.getItem('bs_upd_bad') || '').split('|')[0] === m.version) ls.removeItem('bs_upd_bad');
                            ls.setItem('bs_upd', JSON.stringify({ v: m.version, files: m.files }));
                            ls.removeItem('bs_upd_skip');
                        }
                    });
                };
                c.onerror = c.ontimeout = function () { fin(''); };
                c.send();
            } catch (e) { fin(''); }
        };
        x.onerror = x.ontimeout = function () { fin(''); };
        x.send();
    } catch (e) { fin(''); }
    setTimeout(function () { fin(''); }, 12000);
}

/** «Что нового» из version.json: только строки, не больше 6 пунктов - это идёт в окно на ТВ. */
function bsNotes(n) {
    if (!n || typeof n !== 'object') return null;
    var items = (Object.prototype.toString.call(n.items) === '[object Array]' ? n.items : []).slice(0, 6).map(function (i) { return String(i).slice(0, 240); });
    return { title: String(n.title || '').slice(0, 120), items: items };
}
function bsEsc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}
/** Окно «Вышло обновление»: что нового и кнопки «Обновить сейчас» / «Позже». Раньше кнопка сразу перезагружала Lampa,
 *  и человек не успевал понять, что обновляется, - а мог и смотреть что-то. */
function bsUpdateDialog(gh, info, lampaV, onYes) {
    var html = '<div style="line-height:1.5">';
    if (gh) {
        html += '<p><b>Функции пакета: ' + bsEsc(BS_PACKAGE_VERSION) + ' → ' + bsEsc(gh) + '</b>' +
            (info && info.notes && info.notes.title ? ' — ' + bsEsc(info.notes.title) : '') + '</p>';
        if (info && info.notes && info.notes.items.length) {
            html += '<ul style="margin:.3em 0 .8em 1.2em;padding:0">' + info.notes.items.map(function (i) {
                return '<li style="margin-bottom:.4em">' + bsEsc(i) + '</li>';
            }).join('') + '</ul>';
        }
    }
    if (lampaV) html += '<p><b>Lampa: ' + bsEsc(bsRunningVersion()) + ' → ' + bsEsc(lampaV) + '</b> (сервер byskaz)</p>';
    html += '<p style="opacity:.7">После обновления Lampa перезапустится — это несколько секунд.</p></div>';
    var ctrl = 'settings_component';
    try { ctrl = Lampa.Controller.enabled().name; } catch (e) {}
    var close = function () { try { Lampa.Modal.close(); Lampa.Controller.toggle(ctrl); } catch (e) {} };
    Lampa.Modal.open({
        title: 'Вышло обновление',
        html: $(html),
        size: 'medium',
        buttons_position: 'outside',
        buttons: [
            { name: 'Обновить сейчас', onSelect: function () { close(); onYes(); } },
            { name: 'Позже', onSelect: function () { close(); bsNoty('Хорошо. Обновление встанет само при следующем запуске Lampa.', 5000); } }
        ],
        onBack: close
    });
}

function bsCheckNow(onResult) {
    checkConnection(BS_SERVER + 'assembly.json?v' + Math.random(), function (xhr) {
        var a = parseAssembly(xhr);
        try { window.localStorage.setItem('bs_checked', String(Date.now())); } catch (e) {}
        onResult(a && a.hash ? a : null);
    }, function () { onResult(null); });
}

/* ---------- автообновление во время работы ----------
 * Телевизор не перезапускает приложение: по кнопке Home Tizen держит его в памяти и при
 * следующем открытии просто показывает ту же страницу (prelaunch + reload="disable").
 * Поэтому проверяем сервер каждые 30 минут и при каждом возврате в приложение и сравниваем
 * hash сборки (byskaz может обновить сборку, не меняя номер версии). */
var BS_UPDATE_EVERY = 30 * 60 * 1000, BS_UPDATE_ON_RESUME = 5 * 60 * 1000;
var bsRunningHash = null, bsLastUpdateCheck = 0, bsUpdatePending = null;

function bsAutoUpdateOn() {
    try { return window.localStorage.getItem('bs_autoupdate') !== 'false'; } catch (e) { return true; }
}

function bsPlayerOpen() {
    try { return !!(Lampa.Player && Lampa.Player.opened()); } catch (e) { return false; }
}

function bsHasUpdate(a) {
    return !!(a && a.hash && bsRunningHash && a.hash !== bsRunningHash);
}

function bsApplyUpdate(a) {
    var what = 'Lampa ' + (a.app_version || '');
    if (bsPlayerOpen()) {
        if (!bsUpdatePending) bsNoty('Вышла новая версия ' + what + '. Обновлю после закрытия плеера.', 8000);
        bsUpdatePending = a;
        return;
    }
    bsUpdatePending = null;
    bsNoty('Вышла новая версия ' + what + ' — обновляю…', 5000);
    setTimeout(function () {
        if (bsPlayerOpen()) { bsUpdatePending = a; return; }
        location.reload();
    }, 5000);
}

function bsUpdateCheck() {
    if (!bsAutoUpdateOn()) return;
    bsLastUpdateCheck = Date.now();
    bsCheckNow(function (a) {
        if (!a) return;
        if (!bsRunningHash) { bsRunningHash = a.hash; return; }   // запущены без данных о сборке — запоминаем текущую
        if (bsHasUpdate(a) && !bsRecentlyFailed(a.hash)) bsApplyUpdate(a);
    });
}

/** Эту сборку уже пробовали скачать и не смогли (меньше 30 минут назад) — автоматически не перезапускаемся ради неё. */
function bsRecentlyFailed(hash) {
    var v = null;
    try { v = window.localStorage.getItem('bs_failed_hash'); } catch (e) {}
    if (!v) return false;
    var p = v.split('|');
    return p[0] === hash && Date.now() - (parseInt(p[1], 10) || 0) < 30 * 60 * 1000;
}

function bsStartAutoUpdate() {
    bsRunningHash = bsSource === 'bundled' || bsSource === 'local' ? BS_BUNDLED_HASH : (bsRemote && bsRemote.hash) || null;
    setInterval(function () { if (!document.hidden) bsUpdateCheck(); }, BS_UPDATE_EVERY);
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden && Date.now() - bsLastUpdateCheck > BS_UPDATE_ON_RESUME) bsUpdateCheck();
    });
    window.addEventListener('online', function () { setTimeout(bsUpdateCheck, 3000); });
    try {
        Lampa.Player.listener.follow('destroy', function () {
            if (bsUpdatePending) { var a = bsUpdatePending; setTimeout(function () { bsApplyUpdate(a); }, 1500); }
        });
    } catch (e) {}
    // Работаем из встроенной копии — сразу пробуем сервер: как только он ответит, перейдём на него.
    setTimeout(bsUpdateCheck, bsSource === 'bundled' ? 15000 : 60000);
}

/* Клавиатура: своя экранная клавиатура Lampa вместо системной Samsung (просили: «Samsung неудобная»). Один раз —
 * до запуска Lampa (она читает keyboard_type при старте); вернули «Системную» в настройках — больше не трогаем.
 * bs_kb_lampa2: 1.7.44 на день переключала на системную — возвращаем экранную и тем, у кого она успела сработать.
 * Прятать клавиатуру после набора - bstg.js (searchKeypad). */
(function () {
    try {
        var ls = window.localStorage;
        if (ls.getItem('bs_kb_lampa2') !== '1') {
            if (ls.getItem('bs_kb_lampa') !== '1' || ls.getItem('bs_kb_system') === '1') ls.setItem('keyboard_type', 'lampa');
            ls.setItem('bs_kb_lampa', '1');
            ls.setItem('bs_kb_lampa2', '1');
        }
    } catch (e) {}
})();

/* Настройки дополнений — по разделам Lampa, а не все в «Обновление». Модули регистрируют пункты в 'bs_update';
 * здесь они собираются и после запуска модулей (bsFlushSettings) выкладываются по BS_SETTINGS_LAYOUT — по смыслу,
 * с заголовками групп, а не в порядке загрузки модулей. '#…' — заголовок группы, '#^…' — группа встаёт в начало
 * раздела, выше пунктов Lampa (главное: автовыбор плеера — над «Типом плеера»), остальные — после них. Не из раскладки — остаются
 * в «Обновление» (версия, обновления). BS_SETTINGS_HIDDEN — в меню не показываются, работают по сохранённым значениям.
 * BS_SETTINGS_NEEDS — пункт виден, только когда включено то, без чего он не работает. */
var BS_SETTINGS_LAYOUT = [
    ['player', ['#^Надёжность воспроизведения', 'bs_player_auto', 'bs_guard', 'bs_bw_quality', 'bs_buffer',
        '#Во время просмотра', 'bs_resume_ask', 'bs_noads', 'bs_segments', 'bs_track_memory', 'bs_next_countdown', 'bs_still', 'bs_sleep', 'bs_vol_memory', 'bs_vol_night']],
    ['interface', ['#Дополнительно', 'bs_watch_btn', 'bs_online_resume', 'bs_ru_auto', 'bs_menu_turk', 'bs_continue_row', 'bs_sisi']],
    ['parental_control', ['#Дополнительно', 'bs_kids']],
    ['bs_telegram', ['#Подключение', 'bs_tg_phone', 'bs_tg_join', 'bs_tg_help', 'bs_tg_token', 'bs_tg_link', 'bs_tv_name',
        '#Бот', 'bs_tg_on', 'bs_tg_shots', 'bs_search_qr', 'bs_tg_check',
        '#Люди и доступ', 'bs_tg_approve', 'bs_tg_guest_play', 'bs_tg_invite_reset']],
    ['bs_online', ['#Источники', 'bs_auto_source', 'bs_race', 'bs_torrents', 'bs_srv_title', 'bs_srv_now', 'bs_srv_auto', 'bs_srv_pick',
        '#Другие источники (на выбор)', 'bs_src_main', 'bs_src_z01', 'bs_src_online_mod', 'bs_src_vod_llpp', 'bs_src_showy', 'bs_src_arkmv']]
];
// заголовки старой общей вкладки; подсказка про цветные кнопки (на Smart Remote их нет); «Быстрый старт» (техническое,
// всегда вкл.); журнал запросов (отладка — есть журнал на компьютере); «Название источника» (выкл., просили скрыть)
var BS_SETTINGS_HIDDEN = ['bs_feat_title', 'bs_cont_title', 'bs_keys_info', 'bs_fast_start', 'bs_diag', 'bs_src_badge'];
var BS_SETTINGS_NEEDS = {
    bs_player_auto: { on: 'bs_guard' },                      // запасной плеер включает сторож
    bs_race: { on: 'bs_auto_source' },
};

/* Пункты Lampa и плагинов, которые прячем, пока они не нужны (проверено по коду и журналу ТВ, 2026-10-13):
 *  — «Тип плеера» и «Обработка .m3u8» выбирает автовыбор плеера — вручную менять бессмысленно;
 *  — пункт Skaz «Сервер Skaz» (skaz_domain) выбирает автовыбор серверов; сам раздел настроек Skaz виден всегда;
 *  — торренты: «Парсер», «TorrServer», плеер для торрентов — на ТВ не используются (онлайн-источники),
 *    вернуть — «Торренты» в «Онлайн-источниках». Выключили автоматику — пункты снова видны. */
function bsLsOn(k, def) { var v = null; try { v = window.localStorage.getItem(k); } catch (e) {} return v === null ? def : v === 'true'; }
var BS_SETTINGS_HIDE_IF = [
    { sel: '[data-name="player"], [data-name="player_hls_method"]', when: function () { return bsLsOn('bs_player_auto', true); } },
    { sel: '[data-name="skaz_domain"]', when: function () { return bsLsOn('bs_srv_auto', true); } },
    { sel: '[data-name="player_torrent"], .settings-folder[data-component="parser"], .settings-folder[data-component="server"]',
        when: function () { return !bsLsOn('bs_torrents', false); } }
];
function bsSettingsHideLampa(body) {
    var root = body && body.find ? body : $('body');
    for (var i = 0; i < BS_SETTINGS_HIDE_IF.length; i++) {
        try { root.find(BS_SETTINGS_HIDE_IF[i].sel).toggleClass('hide', !!BS_SETTINGS_HIDE_IF[i].when()); } catch (e) {}
    }
}

var bsSettingsPending = {}, bsSettingsFlushed = false;

function bsSettingsPlace(name) {
    for (var i = 0; i < BS_SETTINGS_LAYOUT.length; i++) if (BS_SETTINGS_LAYOUT[i][1].indexOf(name) >= 0) return BS_SETTINGS_LAYOUT[i][0];
    return '';
}

/** Условие пункта выполнено? Триггеры по умолчанию включены (значение 'false' — выключен). */
function bsSettingsNeedOk(name) {
    var n = BS_SETTINGS_NEEDS[name], v;
    if (!n) return true;
    try { v = window.localStorage.getItem(n.on || n.name); } catch (e) { v = null; }
    if (n.on) return v !== 'false';
    return (v || n.not) !== n.not;
}
function bsSettingsRefresh() {
    for (var name in BS_SETTINGS_NEEDS) if (BS_SETTINGS_NEEDS.hasOwnProperty(name)) {
        try { $('.settings-param[data-name="' + name + '"]').toggleClass('hide', !bsSettingsNeedOk(name)); } catch (e) {}
    }
    bsSettingsHideLampa(null);
}

/** Пункт в его раздел: зависимый — со скрытием, а тот, от кого зависят, — с обновлением видимости. */
function bsSettingsAdd(add, api, data, to, top) {
    var copy = {}, k, name = data.param.name;
    for (k in data) if (data.hasOwnProperty(k)) copy[k] = data[k];
    copy.component = to;
    var render = data.onRender, change = data.onChange;
    copy.onRender = function (item) {
        if (render) render.apply(this, arguments);
        if (BS_SETTINGS_NEEDS[name] && !bsSettingsNeedOk(name)) item.addClass('hide');
        if (top) item.addClass('bs-top');
    };
    copy.onChange = function () {
        var r = change ? change.apply(this, arguments) : undefined;
        setTimeout(bsSettingsRefresh, 0);                      // значение уже записано — показать/спрятать зависимые
        return r;
    };
    return add.call(api, copy);
}

function bsRouteSettings() {
    var api = Lampa.SettingsApi, add = api.addParam;
    if (!add || add.__bsRoute) return;
    api.addComponent({
        component: 'bs_online',
        name: 'Онлайн-источники',
        icon: '<svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<rect x="4" y="7" width="28" height="18" rx="3" stroke="currentColor" stroke-width="3"/>' +
            '<path d="M15 12l7 4-7 4z" fill="currentColor"/><path d="M11 30h14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>'
    });
    api.addComponent({
        component: 'bs_telegram',
        name: 'Telegram',
        icon: '<svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<path d="M5 17l25-10-4 22-8-6-4 5v-7l12-11-15 9z" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/></svg>'
    });
    api.addParam = function (data) {
        var name = data && data.component === 'bs_update' && data.param ? data.param.name : '';
        if (name && BS_SETTINGS_HIDDEN.indexOf(name) >= 0) return;
        var to = name ? bsSettingsPlace(name) : '';
        if (!to) return add.apply(api, arguments);
        if (bsSettingsFlushed) return bsSettingsAdd(add, api, data, to);   // зарегистрирован позже — сразу
        bsSettingsPending[name] = data;
    };
    api.addParam.__bsRoute = true;
    api.addParam.__bsOrig = add;
    // Группы '#^' — в начало раздела: Lampa добавляет пункты плагинов в конец, переставляем при открытии
    try {
        Lampa.Settings.listener.follow('open', function (e) {
            if (e && e.body && e.body.find) bsSettingsHideLampa(e.body);
            var tops = e && e.body && e.body.find ? e.body.find('.bs-top') : null;
            if (!tops || !tops.length) return;
            var first = e.body.find('.settings-param, .settings-param-title, .settings-folder').not('.bs-top').first();
            if (first.length) tops.insertBefore(first);
        });
    } catch (e) {}
}

/** После запуска модулей: пункты — по разделам в порядке раскладки, с заголовками групп. */
function bsFlushSettings() {
    var api = Lampa.SettingsApi, add = api.addParam && api.addParam.__bsOrig;
    if (!add || bsSettingsFlushed) return;
    bsSettingsFlushed = true;
    for (var i = 0; i < BS_SETTINGS_LAYOUT.length; i++) {
        var to = BS_SETTINGS_LAYOUT[i][0], list = BS_SETTINGS_LAYOUT[i][1], title = '', top = false;
        for (var j = 0; j < list.length; j++) {
            var name = list[j];
            if (name.charAt(0) === '#') { top = name.charAt(1) === '^'; title = name.slice(top ? 2 : 1); continue; }
            var data = bsSettingsPending[name];
            if (!data) continue;
            if (title) {                                       // заголовок — только если в группе есть пункты
                add.call(api, { component: to, param: { name: 'bs_hdr_' + to + '_' + j, type: 'title' }, field: { name: title },
                    onRender: top ? function (item) { item.addClass('bs-top'); } : null });
                title = '';
            }
            bsSettingsAdd(add, api, data, to, top);
            delete bsSettingsPending[name];
        }
    }
}

function bsAddSettings() {
    if (!window.Lampa || !Lampa.SettingsApi) return;
    try { bsRouteSettings(); } catch (e) { console.log('BS settings route', e); }
    var C = 'bs_update';

    Lampa.SettingsApi.addParam({
        component: C,
        param: { name: 'bs_torrents', type: 'trigger', 'default': false },
        field: { name: 'Торренты', description: 'Показать настройки «Парсер» и «TorrServer».' },
        onChange: function (v) { try { window.localStorage.setItem('bs_torrents', String(v === true || v === 'true')); } catch (e) {} }
    });

    Lampa.SettingsApi.addComponent({
        component: C,
        name: 'Обновление',
        icon: '<svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<path d="M30 18a12 12 0 1 1-3.5-8.5" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>' +
            '<path d="M28 4v7h-7" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    });

    /* Раздел «Обновление» — три части, у каждой сказано, откуда она обновляется:
     *  Lampa (сервер byskaz) · плагины Skaz (их серверы, каждый запуск) · функции пакета (GitHub). */
    var pkgVer = '';
    try { pkgVer = tizen.application.getCurrentApplication().appInfo.version; } catch (e) {}
    var title = function (name, text) { Lampa.SettingsApi.addParam({ component: C, param: { name: name, type: 'title' }, field: { name: text } }); };

    title('bs_t_lampa', 'Lampa');
    Lampa.SettingsApi.addParam({
        component: C,
        param: { name: 'bs_info_version', type: 'static' },
        field: { name: 'Lampa ' + bsRunningVersion(), description: 'Проверяю сервер…' },
        onRender: function (item) {
            var descr = item.find('.settings-param__descr');
            var from = bsSource === 'bundled' ? 'встроенная копия — сервер byskaz был недоступен при запуске'
                : bsSource === 'local' ? 'из пакета — та же версия, что на сервере byskaz (без скачивания)'
                    : 'с сервера byskaz (lampa.byskaz.ru)';
            descr.text('Сейчас: ' + from + '.');
            bsCheckNow(function (a) {
                if (!a) return descr.text('Сейчас: ' + from + '. Сервер обновлений недоступен.');
                descr.text('Сейчас: ' + from + '. На сервере ' + (a.app_version || '?') +
                    (bsHasUpdate(a) ? ' — есть новее, нажмите «Проверить и обновить».' : ' — у вас последняя.'));
            });
        }
    });
    Lampa.SettingsApi.addParam({
        component: C,
        param: { name: 'bs_autoupdate', type: 'trigger', 'default': true },
        field: { name: 'Обновлять Lampa сама', description: 'Сервер byskaz проверяется каждые 30 минут; новая версия ставится сама (во время фильма — после закрытия плеера).' },
        onChange: function (v) { try { window.localStorage.setItem('bs_autoupdate', String(v === true || v === 'true')); } catch (e) {} }
    });

    title('bs_t_skaz', 'Плагины Skaz — просмотр и ТВ by Skaz');
    Lampa.SettingsApi.addParam({
        component: C,
        param: { name: 'bs_info_skaz', type: 'static' },
        field: {
            name: 'Обновляются сами',
            description: 'Загружаются с серверов Skaz при каждом запуске Lampa: новая версия приходит не позже чем через сутки, ' +
                'сразу — кнопкой «Проверить и обновить». Работают по подписке Skaz TV — skaz.tv.'
        }
    });

    title('bs_t_pkg', 'Функции пакета — бот, плеер, настройки');
    Lampa.SettingsApi.addParam({
        component: C,
        param: { name: 'bs_info_pkg', type: 'static' },
        field: {
            name: 'Версия ' + (window.BS_REMOTE_VERSION || pkgVer || BS_PACKAGE_VERSION),
            description: (window.BS_REMOTE_VERSION ? 'Сейчас: с GitHub (sunic007/lampa-samsung).' : 'Сейчас: из установленного пакета.') +
                ' Установлен пакет ' + (pkgVer || '?') + ' со встроенной Lampa ' + BS_BUNDLED_VERSION + '.'
        }
    });
    Lampa.SettingsApi.addParam({
        component: C,
        param: { name: 'bs_gh_update', type: 'trigger', 'default': true },
        field: { name: 'Обновлять с GitHub', description: 'Новая версия функций ставится сама при следующем запуске Lampa, без установки .wgt.' },
        onChange: function (v) { try { window.localStorage.setItem('bs_gh_update', String(v === true || v === 'true')); } catch (e) {} }
    });

    title('bs_t_check', 'Проверка');
    var checked = null;
    try { checked = window.localStorage.getItem('bs_checked'); } catch (e) {}
    Lampa.SettingsApi.addParam({
        component: C,
        param: { name: 'bs_info_checked', type: 'static' },
        field: { name: 'Последняя проверка Lampa', description: checked ? bsFormatDate(parseInt(checked, 10)) : '—' }
    });
    Lampa.SettingsApi.addParam({
        component: C,
        param: { name: 'bs_check_now', type: 'button' },
        field: { name: 'Проверить и обновить', description: 'Есть новая версия Lampa (сервер byskaz) или функций пакета (GitHub) — покажет, что нового, и обновит, если согласитесь; нет — просто скажет.' },
        onChange: function () {
            bsNoty('Проверяю обновление…', 3000);
            // сначала GitHub (функции пакета), потом сервер Lampa; перезагрузка — только когда оба ответили
            bsGhCheck(function (gh, info) { bsCheckNow(function (a) {
                var lampaNew = !!(a && bsHasUpdate(a));
                if (!gh && !a) return bsNoty('Сервер обновлений недоступен. Попробуйте позже.');
                // обновлять нечего — не перезагружаем (плагины Skaz и так обновляются сами при запуске)
                if (!gh && !lampaNew) {
                    return bsNoty('Обновлений нет: Lampa ' + bsRunningVersion() + ', функции ' +
                        BS_PACKAGE_VERSION + ' — последние.', 5000);
                }
                // есть что обновить - сначала показываем, что именно, и спрашиваем
                bsUpdateDialog(gh, info, lampaNew ? (a.app_version || '') : '', function () {
                    if (info) info.apply();
                    // плагины byskaz/Skaz кэшируются на сутки — при обновлении берём и свежие плагины
                    try { window.localStorage.setItem('bs_plugins_salt', String(Date.now() % 100000)); } catch (e) {}
                    bsNoty('Обновляю… Lampa перезапустится через пару секунд.', 3000);
                    setTimeout(function () { location.reload(); }, 2000);
                });
            }); });
        }
    });

    title('bs_t_support', 'Проект');
    Lampa.SettingsApi.addParam({
        component: C,
        param: { name: 'bs_support', type: 'button' },
        field: { name: 'Поддержать проект', description: 'Пакет бесплатный. Помочь развитию можно на GitHub Sponsors — QR-код для телефона.' },
        onChange: bsSupportQr
    });
}

/* Обновление функций с GitHub: Tizen по Home держит Lampa в памяти, «следующий запуск» может быть через недели —
 * при возврате в приложение смотрим version.json (не чаще раза в 30 минут); новое применится при запуске. */
(function () {
    var last = Date.now();
    try {
        document.addEventListener('visibilitychange', function () {
            if (document.hidden || Date.now() - last < 30 * 60000) return;
            last = Date.now();
            try { if (window.BSUpdate && BSUpdate.check) BSUpdate.check(); } catch (e) {}
        });
    } catch (e) {}
})();

/* Поддержка проекта: на ТВ ссылку не откроешь — показываем QR-код для телефона. */
var BS_SPONSORS_URL = 'https://github.com/sponsors/sunic007';
function bsSupportQr() {
    var body = $('<div style="display:flex;align-items:center;padding:.5em 0">' +
        '<div class="bs-support__qr" style="width:12em;height:12em;background:#fff;padding:.6em;border-radius:.6em;flex:none;margin-right:1.5em"></div>' +
        '<div style="line-height:1.5"><p>Lampa для Samsung и TV Installer — бесплатные. ' +
        'Если они вам полезны, поддержать развитие можно на GitHub Sponsors.</p>' +
        '<p>Наведите камеру телефона на QR-код.</p>' +
        '<p style="opacity:.7">' + BS_SPONSORS_URL + '</p></div></div>');
    try { Lampa.Utils.qrcode(BS_SPONSORS_URL, body.find('.bs-support__qr')[0]); } catch (e) {}
    var ctrl = 'settings_component';
    try { ctrl = Lampa.Controller.enabled().name; } catch (e) {}
    Lampa.Modal.open({
        title: 'Поддержать проект',
        html: body,
        size: 'medium',
        onBack: function () { try { Lampa.Modal.close(); Lampa.Controller.toggle(ctrl); } catch (e) {} }
    });
}

/* Этап загрузки Lampa. lampainit.js прячет её строку статуса — показываем её сами,
 * чтобы было видно, на чём Lampa ждёт, если загрузка встала. */
var BS_STAGES = {
    'Prepare ready': 'подготовка',
    'Open cache database': 'открываю базу данных',
    'Storage load reserve': 'читаю сохранённые настройки',
    'Mirrors initialization': 'ищу рабочий сервер CUB',
    'Plugins initialization': 'готовлю плагины',
    'Proxy initialization': 'проверяю регион и прокси',
    'Account initialization': 'вход в аккаунт',
    'Loading plugins': 'загружаю плагины',
    'Loading language': 'загружаю язык'
};
var bsStage = '', bsStageSince = 0;

var bsStageTimer = setInterval(function () {
    if (window.appready) { clearInterval(bsStageTimer); return; }
    var el = document.querySelector('.lp-status');
    var raw = el ? el.textContent : '';
    if (!raw || !bsStarted) return;
    if (raw !== bsStage) { bsStage = raw; bsStageSince = Date.now(); }
    var name = BS_STAGES[raw] || raw;
    var waited = Math.round((Date.now() - bsStageSince) / 1000);
    if (waited >= 15) bsStatus('Lampa ждёт: ' + name + ' — уже ' + waited + ' с');
    else bsStatus('Lampa: ' + name + '…');
}, 500);

var bsReadyTimer = setInterval(function () {
    if (!window.appready || !window.Lampa) return;
    clearInterval(bsReadyTimer);
    bsHideStatus();
    var err = document.getElementById('bs-error');
    if (err && err.parentNode) err.parentNode.removeChild(err);
    try { bsAddSettings(); } catch (e) { console.log('BS settings', e); }
    try { BSSkaz.start(); } catch (e) { console.log('BS servers', e); }
    try { BSGuard.start(); } catch (e) { console.log('BS guard', e); }
    try { BSFeatures.start(); } catch (e) { console.log('BS features', e); }
    try { BSPlayer.start(); } catch (e) { console.log('BS player', e); }
    try { BSRch.start(); } catch (e) { console.log('BS rch', e); }
    try { BSFix.start(); } catch (e) { console.log('BS fix', e); }
    try { BSSources.start(); } catch (e) { console.log('BS sources', e); }
    try { BSMenu.start(); } catch (e) { console.log('BS menu', e); }
    try { BSContinue.start(); } catch (e) { console.log('BS continue', e); }
    try { BSWatch.start(); } catch (e) { console.log('BS watch', e); }
    try { BSHub.start(); } catch (e) { console.log('BS hub', e); }
    try { BSTelegram.start(); } catch (e) { console.log('BS telegram', e); }
    try { BSVolume.start(); } catch (e) { console.log('BS volume', e); }
    try { bsFlushSettings(); } catch (e) { console.log('BS settings flush', e); }
    try { bsStartAutoUpdate(); } catch (e) { console.log('BS autoupdate', e); }
    setTimeout(bsAnnounce, 2500);
}, 300);

countdown();
