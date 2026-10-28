console.log('Start load');

/*
 * Сначала маленький assembly.json с сервера byskaz (версия и hash сборки). Если hash совпадает со встроенной
 * копией (app.js) — Lampa запускается из пакета: та же сборка, но без скачивания 2 МБ по HTTP на каждом старте.
 * Иначе (на сервере новая сборка) — app.min.js с сервера, обновления приходят сами.
 * Встроенная копия включается и тогда, когда сервер недоступен.
 * Всё, что происходит, показывается пользователю: строка статуса при запуске,
 * уведомление после запуска и раздел «Настройки → Sunic Apps → Обновление».
 */
var BS_SERVER = 'http://lampa.byskaz.ru/lampa-main/';
var BS_PACKAGE_VERSION = 'dev';   // версия пакета .wgt — pack.py подставляет её из config.xml
if (window.BS_REMOTE_VERSION) BS_PACKAGE_VERSION = window.BS_REMOTE_VERSION;   // модули пришли с GitHub (update.js)
var BS_BUNDLED_VERSION = '3.4.4'; // версия встроенной копии app.js — update_bundled.py
var BS_BUNDLED_HASH = 'cf2ea590a5db557d4ebb80f869c7c01a'; // hash из assembly.json этой копии — update_bundled.py
// loader.js пришёл с GitHub, а пакет на ТВ старее: app.js в пакете — та сборка, что записана в update.js пакета
if (window.BS_REMOTE_VERSION && window.BS_PKG_APP && window.BS_PKG_APP.hash) {
    BS_BUNDLED_HASH = window.BS_PKG_APP.hash;
    BS_BUNDLED_VERSION = window.BS_PKG_APP.version || BS_BUNDLED_VERSION;
}

var bsRemote = null;      // assembly.json с сервера: {app_version, hash, time}
var bsSource = '';        // 'server' | 'local' (из пакета, та же сборка что на сервере) | 'bundled' (сервер недоступен)
var bsStarted = false;

/* Версия функций с GitHub: update.js ставит bs_upd_try и снимает, когда Lampa поднялась; не снятый — следующий запуск
 * считает версию плохой, и ТВ сутки работает на модулях своего пакета (старых). Ушли из Lampa или выключили ТВ, пока
 * она грузилась, — это не сбой версии: метку снимаем. Но не больше двух раз подряд (bs_upd_intr), иначе версия, на
 * которой Lampa висит (человек не дождался и вышел), никогда не уйдёт. */
var BS_UPD_FORGIVE = 2;

/* «Кеш и данные → Очистить кеш и данные» в Lampa (и «Сбросить» в окне ошибок плагинов) делают localStorage.clear() —
 * стиралась и запись, какая версия функций скачана (bs_upd…): следующий запуск шёл на старых модулях пакета, пока
 * проверка не найдёт новую версию снова («Lampa вернулась на прошлую версию»). Записи обновления — не данные человека:
 * их переживаем, остальное стирается как обычно. */
// Telegram-бот (токен, чат, люди, подписки, ключи ИИ, имя и номер ТВ) — тоже: иначе бот отключался, и всё настраивать
// заново с телефона. Остальное («кеш и данные» — полный сброс) стирается как раньше.
// С пакета со службой Tizen сами токен и ключи ИИ лежат в её файле (service/service.js) — очистка localStorage их не
// трогает; здесь остаются метки «секрет в службе» (bs_tg_svc, bs_ai_svc) — их тоже бережём, иначе бот «отключится».
var BS_KEEP_ON_CLEAR = /^bs_(upd|tg_|subs$|gemini_|ai_|tv_name$|tv_id$)/;
function bsKeepUpdatesOnClear(S) {
    var clear = S && S.clear;
    if (!clear || clear.__bs) return;
    S.clear = function () {
        var keep = {}, k, i;
        try { for (i = 0; i < this.length; i++) { k = this.key(i); if (k && BS_KEEP_ON_CLEAR.test(k)) keep[k] = this.getItem(k); } } catch (e) {}
        var r = clear.apply(this, arguments);
        for (k in keep) if (keep.hasOwnProperty(k)) { try { this.setItem(k, keep[k]); } catch (e) {} }
        return r;
    };
    S.clear.__bs = true;
}
try { bsKeepUpdatesOnClear(window.Storage && window.Storage.prototype); } catch (e) {}

/* «Очистить кеш» (без данных) в Lampa пишет '' во все ключи, где есть 'online_', 'file_view_', 'storage_', — под это
 * попадали наши настройки bs_online_resume и bs_src_online_mod, а '' у нас читается как «выкл.»: функции тихо
 * выключались. Lampa сначала шлёт событие clear, потом чистит (в том же вызове) — запоминаем наши bs_* и сразу после
 * возвращаем те, что она обнулила. */
function bsKeepOursOnCacheClear(S) {
    if (!S || !S.listener || !S.listener.follow) return;
    S.listener.follow('clear', function (e) {
        if (e && e.full) return;                                   // «кеш и данные» — стирается всё (кроме bs_upd*)
        var ls = window.localStorage, keep = {}, k, i;
        try { for (i = 0; i < ls.length; i++) { k = ls.key(i); if (k && k.indexOf('bs_') === 0) keep[k] = ls.getItem(k); } } catch (x) {}
        setTimeout(function () {
            for (var n in keep) if (keep.hasOwnProperty(n) && keep[n] !== '') { try { if (ls.getItem(n) === '') ls.setItem(n, keep[n]); } catch (x) {} }
        }, 0);
    });
}
function bsStartInterrupted() {
    try {
        var ls = window.localStorage, v = window.BS_REMOTE_VERSION;
        if (window.appready || !v || ls.getItem('bs_upd_try') !== v) return;
        var n = parseInt(ls.getItem('bs_upd_intr'), 10) || 0;
        if (n >= BS_UPD_FORGIVE) return;
        ls.setItem('bs_upd_intr', String(n + 1));
        ls.removeItem('bs_upd_try');
    } catch (e) {}
}
document.addEventListener('visibilitychange', function () { if (document.hidden) bsStartInterrupted(); });
window.addEventListener('pagehide', bsStartInterrupted);

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

/* Обычный запуск — только оригинальный экран загрузки Lampa, своих надписей не добавляем. Наша карточка (update.js,
 * BSBoot) — только при обновлении («Обновляю Sunic Apps до …») и при ошибке; при обновлении уходит, как только Lampa
 * показала свой экран загрузки (.lp-step). */
var bsLampaOwn = false;

/** Одна карточка загрузки (update.js, BSBoot): title — что делаем, detail — подробности, part — см. BSBoot.set. */
function bsStatus(text, detail, part) {
    if (window.BSBoot) return BSBoot.set(text, detail, part);
    var el = document.getElementById('bs-status');            // update.js не загрузился — простая строка, как раньше
    if (!el) {
        el = document.createElement('div');
        el.id = 'bs-status';
        el.style.cssText = 'position:fixed;left:0;right:0;bottom:9%;z-index:1000;text-align:center;' +
            'font-family:sans-serif;font-size:1.5em;color:rgba(255,255,255,.85);text-shadow:0 1px 3px rgba(0,0,0,.6);padding:0 5%';
        document.body.appendChild(el);
    }
    el.textContent = text + (detail ? ' — ' + detail : '');
}

/* Ошибки до готовности Lampa — выводим на экран, чтобы было видно, почему запуск встал. */
var bsErrors = [];

/* Ошибка скрипта до запуска — тёмная карточка над карточкой загрузки (стиль .bs-boot-err в bs.css), как и всё остальное,
 * а не красные строки поверх картинки. Видно, какой файл и строка: экран можно сфотографировать для поддержки. */
function bsError(text) {
    if (window.appready || bsErrors.indexOf(text) >= 0) return;
    bsErrors.push(text);
    var el = document.getElementById('bs-error');
    if (!el) {
        el = document.createElement('div');
        el.id = 'bs-error';
        el.className = 'bs-boot-err';
        el.innerHTML = '<div class="bs-boot-err__title">Ошибка плагина</div><div class="bs-boot-err__text"></div>';
        document.body.appendChild(el);
    }
    el.lastChild.textContent = bsErrors.slice(-3).join('\n');
}

/* Уведомления, которые показывает сама Lampa и плагины: ошибку — красной точкой, даже если стиль не указан, а длинное
 * «При загрузке приложения, часть плагинов не удалось загрузить (полные адреса)» — коротко, по именам файлов. */
var BS_NOTY_ERROR = /(ошибк|не удалось|не загрузил|недоступ|не отвечает|не работает|нет связи|error|failed)/i;
var BS_PLUGINS_FAIL = /^(При загрузке приложения, часть плагинов не удалось загрузить|When loading the application, some plugins could not be loaded) \((.*)\)$/;
function bsPluginName(u) {
    var m = /^[a-z]+:\/\/([^\/?#]+)(?:\/([^?#]*))?/i.exec(String(u).replace(/^\s+|\s+$/g, ''));
    if (!m) return String(u).slice(0, 30);
    var file = (m[2] || '').split('/').pop().replace(/\.js$/i, '');
    return file || m[1];
}
function bsNotyText(text, params) {
    if (params !== undefined && params !== null && typeof params !== 'object') return { text: text, params: params };  // новая Lampa поменяла вызов — не трогаем
    params = params || {};
    var t = String(text === undefined || text === null ? '' : text), m = BS_PLUGINS_FAIL.exec(t);
    if (m) {
        t = 'Не загрузились плагины: ' + m[2].split(/,\s*/).map(bsPluginName).join(', ');
        params.style = 'error';
    } else if (!params.style && BS_NOTY_ERROR.test(t.replace(/<[^>]*>/g, ''))) params.style = 'error';
    return { text: t, params: params };
}
function bsNotyPolish() {
    try {
        var N = window.Lampa && Lampa.Noty;
        if (!N || !N.show || N.show.__bs) return;
        var show = N.show;
        N.show = function (text, params) {
            var r;
            try { r = bsNotyText(text, params); } catch (e) { r = { text: text, params: params }; }   // наша правка не должна ломать уведомления Lampa
            return show.apply(this, [r.text, r.params].concat([].slice.call(arguments, 2)));
        };
        N.show.__bs = true;
    } catch (e) {}
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
        bsStatus('Lampa не запустилась за 2,5 минуты', (bsStage ? 'Этап: ' + (BS_STAGES[bsStage] || bsStage) + '. ' : '') +
            'Сфотографируйте экран и перезапустите приложение.', false);
        clearInterval(bsStageTimer);
    }
}, 150000);

function bsHideStatus() {
    if (window.BSBoot) BSBoot.hide();
    var el = document.getElementById('bs-status');
    if (!el) return;
    el.style.opacity = '0';
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 500);
}

function bsNoty(text, time) {
    try { Lampa.Noty.show(text, { time: time || 6000 }); } catch (e) { console.log('BS', text); }
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

/* lampainit.js byskaz грузится не блокирующим тегом (index.html): Lampa должна стартовать после него — он ставит
 * window.lampa_settings до запуска. Ждём, пока он выполнится или не загрузится, но не дольше BS_INIT_WAIT. */
var BS_INIT_WAIT = 8000;
function bsInitWait() {
    if (window.BS_INIT_DONE || !window.BS_INIT_AT) return false;      // готов, сорвался или старая страница (тег был обычным)
    if (Date.now() - window.BS_INIT_AT >= BS_INIT_WAIT) { console.log('lampainit.js не ответил за 8 с — запускаю без него'); return false; }
    return true;
}

function startAppWithDeepLink(){
    if (bsStarted) return;
    if (!bsSrvReady) {
        bsSrvWaiting = startAppWithDeepLink;
        return;
    }
    if (bsInitWait()) { setTimeout(startAppWithDeepLink, 200); return; }
    bsStarted = true;
    var localFirst = true;
    try { localFirst = window.localStorage.getItem('bs_local_first') !== 'false'; } catch (e) {}
    if (localFirst && bsRemote && bsRemote.hash === BS_BUNDLED_HASH) {
        bsSource = 'local';
        createScript('app.js', function () {
            console.log('Local copy error');
            bsSource = 'server';
            createScript(BS_SERVER + 'app.min.js?v' + Math.random(), function () { loadFromLocal(); });
        });
        return;
    }
    bsSource = 'server';

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

/** Запуск копии Lampa из пакета. source: 'bundled' (сервер недоступен — по умолчанию) или 'local' (сервер не нужен). */
function loadFromLocal(source){
	if(window.appready || bsSource === 'bundled') return

    // Сервер ответил новой сборкой, а скачать её не вышло — запоминаем, иначе автообновление через 15 с увидит
    // «новую версию», перезапустит, загрузка снова сорвётся — и так по кругу каждые полминуты.
    if (bsRemote && bsRemote.hash) { try { window.localStorage.setItem('bs_failed_hash', bsRemote.hash + '|' + Date.now()); } catch (e) {} }
    bsSource = source === 'local' ? 'local' : 'bundled';

    createScript('app.js', function(){
        console.log('Load local error');
        bsStatus('Не удалось запустить Lampa', 'Проверьте интернет и перезапустите приложение.', false);
    })
}

// Страница по https (браузер, sunic.stream), а сервер byskaz — только http: браузер не пустит запрос к нему, ждать 15 с
// и писать «Нет связи с сервером» незачем — сразу запускаем копию из пакета.
var BS_HTTPS_PAGE = false;
try { BS_HTTPS_PAGE = window.location.protocol === 'https:' && BS_SERVER.indexOf('http:') === 0; } catch (e) {}

var timeLeft = 15;
var timerId  = setInterval(countdown, 1000);

function checkConnection(url, successCb, errorCb, timeout) {
    var xhr = new XMLHttpRequest();
    var executed = false;

    xhr.open('GET', url, true);
    xhr.timeout = timeout || 3000;
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
    if (BS_HTTPS_PAGE) {
        clearInterval(timerId);
        timeLeft = -1;
        if (!bsStarted) { bsStarted = true; loadFromLocal('local'); }
        return;
    }
    if (checking && timeLeft > 0) { timeLeft--; return; }

    if (timeLeft <= 0) {
        clearInterval(timerId);

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
        // Проверяем связь маленьким файлом, а не всем app.min.js (2 МБ не успевали за таймаут).
        checking = true;
        checkConnection(
            BS_SERVER + 'assembly.json?v' + Math.random(),
            function (xhr) {
                checking = false;
                if (timeLeft < 0) return; // уже стартовали по таймауту
                clearInterval(timerId);

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
        bsNoty('Нет связи с сервером — встроенная Lampa ' + cur, 6000);
        return;
    }

    try {
        window.localStorage.setItem('bs_version', cur);
        window.localStorage.setItem('bs_checked', String(Date.now()));
    } catch (e) {}

    if (!last) bsNoty('Lampa ' + cur + ' запущена', 5000);
    else if (last !== cur) bsNoty('Lampa обновлена: ' + last + ' → ' + cur, 6000);
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
    // update.js: версия годится, только когда все её файлы уже есть на CDN (проверка — до 30 с)
    if (!window.BSUpdate || !BSUpdate.check) return fin('');
    BSUpdate.check(function (v, m) {
        if (!v) return fin('');
        fin(v, {
            notes: bsNotes(m && m.notes),
            apply: function () {
                // согласились обновить - даём версии ещё шанс, даже если раньше на ней не поднялась
                try {
                    if (String(ls.getItem('bs_upd_bad') || '').split('|')[0] === v) ls.removeItem('bs_upd_bad');
                    ls.removeItem('bs_upd_skip');
                } catch (e) {}
            }
        });
    });
    setTimeout(function () { fin(''); }, 30000);
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
        html += '<p><b>Sunic Apps: ' + bsEsc(window.BS_REMOTE_VERSION || BS_PACKAGE_VERSION) + ' → ' + bsEsc(gh) + '</b>' +
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
            { name: 'Позже', onSelect: function () { close(); bsNoty('Обновится при следующем запуске', 4000); } }
        ],
        onBack: close
    });
}

/** Последняя вышедшая версия Sunic Apps (version.json на GitHub, затем jsDelivr) — чтобы честно сказать «у вас
 *  последняя» или «GitHub не ответил». BSUpdate.check (update.js в пакете) этого не различает: и нет связи, и нет
 *  новой версии у него — пустой ответ. cb(версия | ''). */
var BS_LATEST_URLS = ['https://raw.githubusercontent.com/sunic007/lampa-samsung/main/version.json',
    'https://cdn.jsdelivr.net/gh/sunic007/lampa-samsung@main/version.json'];
function bsLatestVersion(cb, urls) {
    urls = (urls || BS_LATEST_URLS).slice();
    var url = urls.shift();
    if (!url) return cb('');
    checkConnection(url + '?t=' + Date.now(), function (xhr) {
        var v = '';
        try { v = String(JSON.parse(xhr.responseText).version || ''); } catch (e) {}
        if (/^\d+\.\d+\.\d+$/.test(v)) cb(v); else bsLatestVersion(cb, urls);
    }, function () { bsLatestVersion(cb, urls); }, 8000);
}
function bsFnRunning() { return window.BS_REMOTE_VERSION || window.BS_SITE_VERSION || BS_PACKAGE_VERSION; }

/** Итог «Проверить и обновить», когда обновлять нечего: что именно стоит и почему так считаем. */
function bsNoUpdateText(latest, lampaOk, fnRunning, lampaRunning, ghOff) {
    var fnBehind = latest && bsVerNum(latest) > bsVerNum(fnRunning);
    if (!latest && !lampaOk) return 'Не удалось проверить: сервер обновлений не ответил — проверьте интернет';
    // сайт sunic.stream (браузер, MSX) обновляется сам — переключателя там нет, просить его включить нельзя
    if (fnBehind && typeof window !== 'undefined' && window.BS_SITE_VERSION) return 'Вышла новая версия Sunic Apps ' + latest + ' — сайт обновится сам в течение нескольких минут';
    if (fnBehind && ghOff) return 'Вышла новая версия Sunic Apps ' + latest + ' — включите «Автообновление Sunic Apps» в разделе «Обновление» → «Дополнительно»';
    if (fnBehind) return 'Вышла новая версия Sunic Apps ' + latest + ' — файлы ещё выкладываются, она установится сама в течение часа';
    if (!latest) return 'Lampa ' + lampaRunning + ' — последняя. Sunic Apps ' + fnRunning + ': GitHub не ответил, проверю позже';
    return 'Обновлений нет — у вас последняя версия: Sunic Apps ' + fnRunning + ' · Lampa ' + lampaRunning;
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

/* Обновления не ставятся на глазах (до 1.7.63 Lampa перезапускалась посреди меню, на каждую сборку byskaz).
 * Готовое — новая сборка Lampa (byskaz) и новая версия функций (GitHub, все файлы на CDN) — ставится одним
 * перезапуском, когда Lampa уходит в фон (Home, другое приложение), или при следующем запуске. Во время видео — никогда. */
function bsApplyUpdate(a) {
    var told = !!bsUpdatePending;
    bsUpdatePending = a;
    if (document.hidden) return bsReloadForUpdate();
    if (!told) bsNoty('Lampa ' + (a.app_version || '') + ' обновится при следующем запуске', 6000);
}
function bsVerNum(v) { var m = /(\d+)\.(\d+)\.(\d+)/.exec(String(v || '')); return m ? +m[1] * 1e6 + +m[2] * 1e3 + +m[3] : 0; }
/** Новая версия функций уже проверена и ждёт перезапуска (update.js записал bs_upd с ok). */
function bsFnPending() {
    try {
        var u = JSON.parse(window.localStorage.getItem('bs_upd') || 'null'), pkg = '';
        try { pkg = tizen.application.getCurrentApplication().appInfo.version; } catch (e) {}
        return u && u.ok && bsVerNum(u.v) > bsVerNum(window.BS_REMOTE_VERSION || pkg) ? u.v : '';
    } catch (e) { return ''; }
}
/* Новая версия Sunic Apps — сначала окно «Вышло обновление»: коротко, что нового (из version.json), и «Обновить
 * сейчас» / «Позже» («Позже» — встанет при следующем запуске). Окно — один раз на версию (bs_upd_asked); во время
 * видео, в другом окне или когда Lampa скрыта — не показываем, ждём выхода из плеера или следующей проверки.
 * Молча (уход Lampa в фон) версия функций ставится только после того, как окно было показано. */
var bsOfferWaiting = null;
function bsUpdateAsked(v) { try { return !!v && window.localStorage.getItem('bs_upd_asked') === v; } catch (e) { return false; } }
function bsOfferUpdate(v, info) {
    if (!v || bsUpdateAsked(v)) return;
    var busy = document.hidden || bsPlayerOpen();
    // открыто меню (Select — класс на body; сам .selectbox есть всегда) или окно (.modal есть, только пока открыто)
    try { busy = busy || /^(modal|select)$/.test(Lampa.Controller.enabled().name) || $('body').hasClass('selectbox--open') || !!$('.modal').length; } catch (e) {}
    if (busy) { bsOfferWaiting = { v: v, info: info }; return; }
    bsOfferWaiting = null;
    try { window.localStorage.setItem('bs_upd_asked', v); } catch (e) {}
    bsUpdateDialog(v, info, '', function () {
        if (info && info.apply) info.apply();
        bsNoty('Обновляю — Lampa перезапустится', 3000);
        setTimeout(function () { location.reload(); }, 2000);
    });
}
function bsOfferLater() {
    var w = bsOfferWaiting;
    if (w) setTimeout(function () { bsOfferUpdate(w.v, w.info); }, 3000);
}

/** Lampa скрыта: применить всё готовое одним перезапуском. Не чаще раза в 10 минут — защита от кругов. */
function bsReloadForUpdate() {
    var fn = bsFnPending();
    if (!(bsUpdatePending || (fn && bsUpdateAsked(fn))) || bsPlayerOpen()) return false;
    var last = 0;
    try { last = parseInt(window.localStorage.getItem('bs_upd_reload_at') || '0', 10) || 0; } catch (e) {}
    if (Date.now() - last < 10 * 60 * 1000) return false;
    try { window.localStorage.setItem('bs_upd_reload_at', String(Date.now())); } catch (e) {}
    location.reload();
    return true;
}

function bsUpdateCheck() {
    bsLastUpdateCheck = Date.now();
    // функции пакета (Sunic Apps) — своя настройка «Обновлять с GitHub» (внутри check): есть готовая — окно «что нового»
    try { bsGhCheck(function (v, info) { if (v) bsOfferUpdate(v, info); }); } catch (e) {}
    if (!bsAutoUpdateOn() || BS_HTTPS_PAGE) return;
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
    try { Lampa.Player.listener.follow('destroy', bsOfferLater); } catch (e) {}   // окно обновления — после видео
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) { bsReloadForUpdate(); return; }               // ушли из Lampa — ставим готовое
        bsOfferLater();
        if (Date.now() - bsLastUpdateCheck > BS_UPDATE_ON_RESUME) bsUpdateCheck();
    });
    window.addEventListener('online', function () { setTimeout(bsUpdateCheck, 3000); });
    // Работаем из встроенной копии — сразу пробуем сервер: как только он ответит, перейдём на него.
    setTimeout(bsUpdateCheck, bsSource === 'bundled' ? 15000 : 60000);
}

/* Клавиатура: своя экранная клавиатура Lampa вместо системной Samsung (просили: «Samsung неудобная»). Один раз —
 * до запуска Lampa (она читает keyboard_type при старте); вернули «Системную» в настройках — больше не трогаем.
 * bs_kb_lampa2: 1.7.44 на день переключала на системную — возвращаем экранную и тем, у кого она успела сработать.
 * Прятать клавиатуру после набора - bstg.js (searchKeypad).
 * Это только для ТВ (пульт). В браузере компьютера, телефона, планшета экранная Lampa не принимает обычную
 * клавиатуру — там один раз (bs_kb_web) ставим системную: печатает и клавиатура, и экранная телефона. */
function bsIsTv() {
    var ua = navigator.userAgent || '', touch = 'ontouchstart' in window && navigator.maxTouchPoints > 0;
    if (/android/i.test(ua) && !touch) return true;   // приставка Android: пульт, экрана касаний нет
    return !!window.tizen || /tizen|web0s|webos|smart-?tv|netcast|maple|hbbtv|bravia|vidaa|philips|nettv|whaletv|googletv|google tv|android tv|mibox|mitv|aft[a-z]|crkey|large screen/i.test(ua);
}
(function () {
    try {
        var ls = window.localStorage;
        if (!bsIsTv()) {
            if (ls.getItem('bs_kb_web') !== '1') {
                ls.setItem('keyboard_type', 'integrate');
                ls.setItem('bs_kb_web', '1');
                ls.setItem('bs_kb_lampa2', '1');
            }
            // Планшет в альбомной ориентации (ширина от 1280) Lampa принимает за телевизор: интерфейс под пульт, листать
            // пальцем нельзя. Один раз (bs_touch_web) — управление «Касание», как на телефоне; выбрал другое — не трогаем.
            // Компьютер с сенсорным экраном (Windows) — не трогаем: там мышь.
            if (ls.getItem('bs_touch_web') !== '1') {
                if ('ontouchstart' in window && navigator.maxTouchPoints > 0 && !/windows nt/i.test(navigator.userAgent || '') && !ls.getItem('navigation_type')) {
                    ls.setItem('navigation_type', 'touch');
                    ls.setItem('is_true_mobile', 'true');
                }
                ls.setItem('bs_touch_web', '1');
            }
            // Заставка «Aerial» (по умолчанию) — видео Apple с sylvan.apple.com: его сертификат выдан внутренним центром
            // Apple, браузеры ему не доверяют — видео не грузится, на экране только колесо загрузки. В браузере один раз
            // (bs_ss_web) — «Природа» (картинки picsum.photos); выбрал потом другое — не трогаем.
            if (ls.getItem('bs_ss_web') !== '1') {
                var ss = ls.getItem('screensaver_type');
                if (!ss || ss === 'aerial') ls.setItem('screensaver_type', 'nature');
                ls.setItem('bs_ss_web', '1');
            }
            return;
        }
        if (ls.getItem('bs_kb_lampa2') !== '1') {
            if (ls.getItem('bs_kb_lampa') !== '1' || ls.getItem('bs_kb_system') === '1') ls.setItem('keyboard_type', 'lampa');
            ls.setItem('bs_kb_lampa', '1');
            ls.setItem('bs_kb_lampa2', '1');
        }
    } catch (e) {}
})();

/* Все наши настройки — в одном своём разделе «Sunic Apps» (BS_ROOT), внутри — подразделы (BS_SECTIONS). В разделы
 * самой Lampa ничего не кладём: новая Lampa может их переименовать или переделать, а наш раздел от неё не зависит, и
 * сразу видно, где Lampa, а где наши функции. Модули регистрируют пункты в 'bs_update'; здесь они собираются и после
 * запуска модулей (bsFlushSettings) выкладываются по BS_SETTINGS_LAYOUT — по смыслу, с заголовками групп ('#…'), а не
 * в порядке загрузки модулей. Не из раскладки — остаются в «Обновление» (версия, обновления). BS_SETTINGS_HIDDEN — в меню
 * не показываются, работают по сохранённым значениям. BS_SETTINGS_NEEDS — пункт виден, только когда включено то, без
 * чего он не работает. */
var BS_ROOT = 'bs_apps';
var BS_SECTIONS = [                                            // [раздел, название, подсказка]
    ['bs_player', 'Плеер', 'Надёжность воспроизведения, продолжение, сон, громкость'],
    ['bs_online', 'Онлайн-источники', 'Источники фильмов и серверы Skaz'],
    ['bs_telegram', 'Telegram-бот', 'Управление Lampa с телефона'],
    ['bs_iface', 'Интерфейс', 'Кнопки на карточке, строки и меню'],
    ['bs_update', 'Обновление', 'Версии и автообновление']
];
var BS_SETTINGS_LAYOUT = [
    ['bs_player', ['#Надёжность воспроизведения', 'bs_player_auto', 'bs_guard', 'bs_bw_quality', 'bs_buffer',
        '#Во время просмотра', 'bs_resume_ask', 'bs_noads', 'bs_segments', 'bs_track_memory', 'bs_next_countdown', 'bs_next_season', 'bs_still', 'bs_sleep', 'bs_vol_memory', 'bs_vol_night']],
    ['bs_iface', ['bs_watch_btn', 'bs_online_resume', 'bs_ru_auto', 'bs_menu_turk', 'bs_menu_kids', 'bs_continue_row', 'bs_iptv_lists']],
    ['bs_telegram', ['#Свой бот (бесплатно)', 'bs_tg_phone', 'bs_tg_join', 'bs_tg_help', 'bs_tg_token', 'bs_tg_link', 'bs_tv_name', 'bs_tg_off',
        '#Бот', 'bs_tg_on', 'bs_tg_shots', 'bs_search_qr', 'bs_tg_check',
        '#Люди и доступ', 'bs_tg_approve', 'bs_tg_guest_play', 'bs_tg_invite_reset']],
    ['bs_online', ['#Источники', 'bs_auto_source', 'bs_race', 'bs_torrents', 'bs_srv_title', 'bs_srv_now', 'bs_srv_auto', 'bs_srv_pick',
        '#Источники на выбор', 'bs_src_main', 'bs_src_z01', 'bs_src_online_mod', 'bs_src_vod_llpp', 'bs_src_showy', 'bs_src_arkmv']]
];
// заголовки старой общей вкладки; подсказка про цветные кнопки (на Smart Remote их нет); «Быстрый старт» (техническое,
// всегда вкл.); журнал запросов (отладка — есть журнал на компьютере); «Название источника» (выкл., просили скрыть)
// «Таймер сна» — то же, что кнопка «Сон» в плеере; «Сейчас» у серверов Skaz — технический список
var BS_SETTINGS_HIDDEN = ['bs_feat_title', 'bs_cont_title', 'bs_keys_info', 'bs_fast_start', 'bs_diag', 'bs_src_badge', 'bs_sleep', 'bs_srv_now'];
var BS_SETTINGS_NEEDS = {
    bs_player_auto: { on: 'bs_guard' },                      // запасной плеер включает сторож
    bs_race: { on: 'bs_auto_source' },
};

/* Пункты Lampa и плагинов, которые прячем, пока они не нужны (проверено по коду и журналу ТВ, 2026-10-13):
 *  — «Тип плеера» и «Обработка .m3u8» выбирает автовыбор плеера — вручную менять бессмысленно;
 *  — торренты: «Парсер», «TorrServer», плеер для торрентов — на ТВ не используются (онлайн-источники),
 *    вернуть — «Торренты» в «Онлайн-источниках». Выключили автоматику — пункты снова видны;
 *  — «Родительский контроль» Клубнички (sisi_pin_manage): PIN и Telegram хранит сервер Skaz, он отвечает ошибкой,
 *    и пункт ничего не делает. Прячем всегда; защита от 18+ — родительский контроль Lampa и детский профиль CUB. */
function bsLsOn(k, def) { var v = null; try { v = window.localStorage.getItem(k); } catch (e) {} return v === null ? def : v === 'true'; }
var BS_SETTINGS_HIDE_IF = [
    { sel: '[data-name="player"], [data-name="player_hls_method"]', when: function () { return bsLsOn('bs_player_auto', true); } },
    { sel: '[data-name="player_torrent"], .settings-folder[data-component="parser"], .settings-folder[data-component="server"]',
        when: function () { return !bsLsOn('bs_torrents', false); } },
    { sel: '[data-name="sisi_pin_manage"]', when: function () { return true; } }
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
function bsSettingsAdd(add, api, data, to) {
    var copy = {}, k, name = data.param.name;
    for (k in data) if (data.hasOwnProperty(k)) copy[k] = data[k];
    copy.component = to;
    var render = data.onRender, change = data.onChange;
    copy.onRender = function (item) {
        if (render) render.apply(this, arguments);
        if (BS_SETTINGS_NEEDS[name] && !bsSettingsNeedOk(name)) item.addClass('hide');
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
    // В главном списке настроек — одна папка «Sunic Apps»; подразделы — только шаблоны (не addComponent), их открывают кнопки
    api.addComponent({
        component: BS_ROOT,
        name: 'Sunic Apps',
        icon: '<svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<rect x="4" y="4" width="12" height="12" rx="3" stroke="currentColor" stroke-width="3"/>' +
            '<rect x="20" y="4" width="12" height="12" rx="3" stroke="currentColor" stroke-width="3"/>' +
            '<rect x="4" y="20" width="12" height="12" rx="3" stroke="currentColor" stroke-width="3"/>' +
            '<rect x="20" y="20" width="12" height="12" rx="3" fill="currentColor"/></svg>'
    });
    BS_SECTIONS.forEach(function (s) {
        Lampa.Template.add('settings_' + s[0], '<div></div>');
        add.call(api, { component: BS_ROOT, param: { name: 'bs_go_' + s[0], type: 'button' }, field: { name: s[1], description: s[2] },
            onChange: function () { bsOpenSection(s[0]); } });
    });
    try { bsPinRegister(); } catch (e) { console.log('BS pin', e); }
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
    try {
        Lampa.Settings.listener.follow('open', function (e) {
            if (e && e.body && e.body.find) bsSettingsHideLampa(e.body);
            if (e && e.name === 'main' && e.body && e.body.find) bsSettingsRootUp(e.body);
            bsSectionBack(e);
        });
    } catch (e) {}
    bsSettingsLayerClose();
}

/* Мышь и касание (браузер, телефон): щелчок мимо панели настроек Lampa считает «Назад» на один уровень. Из нашего
 * подраздела «Назад» ведёт в «Sunic Apps», потом в общие настройки — закрыть панель удавалось только с третьего
 * щелчка, казалось, что окно зависло. Щелчок мимо панели закрывает настройки сразу; «Назад» пультом — как было. */
function bsSettingsLayerClose() {
    try {
        document.addEventListener('click', function (ev) {
            var t = ev.target;
            if (!t || !t.className || String(t.className).indexOf('settings__layer') < 0) return;
            var name = '';
            try { name = Lampa.Controller.enabled().name; } catch (e) {}
            if (name !== 'settings_component') return;          // главный список — Lampa сама закроет
            ev.stopPropagation();
            try { Lampa.Controller.toggle('settings'); Lampa.Controller.back(); } catch (e) {}
        }, true);
    } catch (e) {}
}

/* ПИН родительского контроля Lampa перед «Telegram-бот» и «Онлайн-источники» (Lampa.ParentalControl.add/personal):
 * пункты появляются в списке Lampa «Где спрашивать ПИН», отмечены по умолчанию один раз — дальше решает человек.
 * Спрашивает сама Lampa и только при включённом родительском контроле (и по её «Как часто спрашивать»).
 * Нет API (старая сборка Lampa) или ошибка — раздел открывается как раньше. */
var BS_SECTIONS_PIN = { bs_telegram: 'Telegram-бот (Sunic Apps)', bs_online: 'Онлайн-источники (Sunic Apps)' };
function bsPinApi() {
    var P = window.Lampa && Lampa.ParentalControl;
    return P && typeof P.add === 'function' && typeof P.personal === 'function' ? P : null;
}
function bsPinRegister() {
    var P = bsPinApi();
    if (!P) return false;
    for (var name in BS_SECTIONS_PIN) if (BS_SECTIONS_PIN.hasOwnProperty(name)) {
        var once = 'bs_pin_init_' + name, first = true;
        try { first = window.localStorage.getItem(once) !== '1'; } catch (e) {}
        try {
            P.add('bs_pin_' + name, { title: BS_SECTIONS_PIN[name], 'default': first });
            if (first) window.localStorage.setItem(once, '1');
        } catch (e) { console.log('BS pin', name, e); }
    }
    return true;
}
function bsOpenSection(name) {
    var P = BS_SECTIONS_PIN.hasOwnProperty(name) ? bsPinApi() : null;
    if (P) {
        try {
            // как Lampa для своих «Настроек»: ПИН верный — открыть, нет — вернуть пульт в «Sunic Apps»
            P.personal('bs_pin_' + name, function () { Lampa.Settings.create(name); }, false, true);
            return;
        } catch (e) { console.log('BS pin', name, e); }
    }
    Lampa.Settings.create(name);
}

/** «Sunic Apps» в главном списке настроек — сразу под «Синхронизацией» (Lampa добавляет свои папки плагинов в конец).
 *  Нет «Синхронизации» (другая сборка Lampa) — первым. */
function bsSettingsRootUp(body) {
    try {
        var me = body.find('.settings-folder[data-component="' + BS_ROOT + '"]');
        if (!me.length) return;
        var sync = body.find('.settings-folder[data-component="account"]');
        if (sync.length) { if (sync.next()[0] !== me[0]) me.insertAfter(sync); }
        else { var first = body.find('.settings-folder').first(); if (first[0] !== me[0]) me.insertBefore(first); }
    } catch (e) {}
}

/** «Назад» из подраздела — в «Sunic Apps» на ту же кнопку, а не в главный список. Lampa хранит params открытого раздела
 * (и пересоздаёт его с новыми при обновлении) — поэтому ставим onBack при каждом открытии. */
function bsSectionBack(e) {
    if (!e || !e.params || e.params.onBack) return;
    for (var i = 0; i < BS_SECTIONS.length; i++) {
        if (BS_SECTIONS[i][0] !== e.name) continue;
        e.params.onBack = (function (idx) {
            return function () { Lampa.Settings.create(BS_ROOT, { last_index: idx }); };
        })(i);
        return;
    }
}

/* Пункт или заголовок группы показывается, только когда подходит к состоянию (window.BS_SETTINGS_WHEN[имя или '#заголовок']
 * — функция модуля → true/false): например, «Отключить» — только когда подключено. Проверяется при каждом открытии раздела. */
function bsWhen(key) {
    var f = window.BS_SETTINGS_WHEN && window.BS_SETTINGS_WHEN[key];
    if (typeof f !== 'function') return null;
    return function (item) { var show = true; try { show = !!f(); } catch (e) {} try { item.toggleClass('hide', !show); } catch (e) {} };
}
function bsWhenWrap(data, when) {
    var o = {}, k, was = data.onRender;
    for (k in data) if (data.hasOwnProperty(k)) o[k] = data[k];
    o.onRender = function (item) { if (was) was.apply(this, arguments); when(item); };
    return o;
}

/** После запуска модулей: пункты — по разделам в порядке раскладки, с заголовками групп. */
function bsFlushSettings() {
    var api = Lampa.SettingsApi, add = api.addParam && api.addParam.__bsOrig;
    if (!add || bsSettingsFlushed) return;
    bsSettingsFlushed = true;
    for (var i = 0; i < BS_SETTINGS_LAYOUT.length; i++) {
        var to = BS_SETTINGS_LAYOUT[i][0], list = BS_SETTINGS_LAYOUT[i][1], title = '';
        for (var j = 0; j < list.length; j++) {
            var name = list[j];
            if (name.charAt(0) === '#') { title = name.slice(1); continue; }
            var data = bsSettingsPending[name];
            if (!data) continue;
            if (title) {                                       // заголовок — только если в группе есть пункты
                add.call(api, { component: to, param: { name: 'bs_hdr_' + to + '_' + j, type: 'title' }, field: { name: title }, onRender: bsWhen('#' + title) });
                title = '';
            }
            if (bsWhen(name)) data = bsWhenWrap(data, bsWhen(name));
            bsSettingsAdd(add, api, data, to);
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
        field: { name: 'Торренты', description: 'Показать «Парсер» и «TorrServer»' },
        onChange: function (v) { try { window.localStorage.setItem('bs_torrents', String(v === true || v === 'true')); } catch (e) {} }
    });

    /* Раздел «Обновление» — коротко, для обычного человека: какая версия, «Проверить и обновить», помощь.
     * Откуда что обновляется (сервер byskaz, плагины Skaz, GitHub) — в README, не на экране. */
    var pkgVer = '';
    try { pkgVer = tizen.application.getCurrentApplication().appInfo.version; } catch (e) {}
    var fnVer = window.BS_REMOTE_VERSION || pkgVer || window.BS_SITE_VERSION || BS_PACKAGE_VERSION;
    var title = function (name, text) { Lampa.SettingsApi.addParam({ component: C, param: { name: name, type: 'title' }, field: { name: text } }); };

    Lampa.SettingsApi.addParam({
        component: C,
        param: { name: 'bs_info_version', type: 'static' },
        field: { name: (/^\d+\.\d+\.\d+$/.test(String(fnVer)) ? 'Sunic Apps ' + fnVer + ' · ' : '') + 'Lampa ' + bsRunningVersion(), description: 'Обновляется само' }
    });
    Lampa.SettingsApi.addParam({
        component: C,
        param: { name: 'bs_check_now', type: 'button' },
        field: { name: 'Проверить и обновить', description: 'Покажет, что нового' },
        onChange: function () {
            // «Проверяю…» держится до ответа (GitHub с ТВ бывает отвечает 10–15 с — раньше надпись гасла через 3 с, и
            // казалось, что проверка пропала). Три проверки сразу, итог — когда ответили все или через 20 с.
            bsNoty('Проверяю обновление…', 25000);
            var r = { left: 3 }, done = false;
            var finish = function () {
                if (done) return;
                done = true;
                var gh = r.gh || '', info = r.info, a = r.a, lampaNew = !!(a && bsHasUpdate(a));
                // обновлять нечего — не перезагружаем (плагины Skaz и так обновляются сами при запуске)
                if (!gh && !lampaNew) return bsNoty(bsNoUpdateText(r.latest || '', !!a, bsFnRunning(), bsRunningVersion(), (function () { try { return window.localStorage.getItem('bs_gh_update') === 'false'; } catch (e) { return false; } })()), 8000);
                // есть что обновить - сначала показываем, что именно, и спрашиваем
                try { $('.noty').removeClass('noty--visible'); } catch (e) {}
                bsUpdateDialog(gh, info, lampaNew ? (a.app_version || '') : '', function () {
                    if (info) info.apply();
                    // плагины byskaz/Skaz кэшируются на сутки — при обновлении берём и свежие плагины
                    try { window.localStorage.setItem('bs_plugins_salt', String(Date.now() % 100000)); } catch (e) {}
                    bsNoty('Обновляю — Lampa перезапустится', 3000);
                    setTimeout(function () { location.reload(); }, 2000);
                });
            };
            var got = function () { if (--r.left <= 0) finish(); };
            bsGhCheck(function (gh, info) { r.gh = gh; r.info = info; got(); });
            bsCheckNow(function (a) { r.a = a; got(); });
            bsLatestVersion(function (v) { r.latest = v; got(); });
            setTimeout(finish, 20000);
        }
    });

    Lampa.SettingsApi.addParam({
        component: C,
        param: { name: 'bs_report', type: 'button' },
        field: { name: 'Сообщить о проблеме', description: 'Отчёт уйдёт разработчику' },
        onChange: function () { try { BSReport.open(); } catch (e) { bsNoty('Напишите в группу t.me/sunicapps', 6000); } }
    });

    Lampa.SettingsApi.addParam({
        component: C,
        param: { name: 'bs_support', type: 'button' },
        field: { name: 'Поддержать проект', description: 'GitHub Sponsors' },
        onChange: bsSupportQr
    });
    // автообновление — только в приложении на ТВ: страница sunic.stream (браузер, MSX) и так всегда последней версии
    if (!BS_HTTPS_PAGE && !window.BS_SITE_VERSION) {
        title('bs_t_more', 'Дополнительно');
        Lampa.SettingsApi.addParam({
            component: C,
            param: { name: 'bs_autoupdate', type: 'trigger', 'default': true },
            field: { name: 'Автообновление Lampa' },
            onChange: function (v) { try { window.localStorage.setItem('bs_autoupdate', String(v === true || v === 'true')); } catch (e) {} }
        });
        Lampa.SettingsApi.addParam({
            component: C,
            param: { name: 'bs_gh_update', type: 'trigger', 'default': true },
            field: { name: 'Автообновление Sunic Apps' },
            onChange: function (v) { try { window.localStorage.setItem('bs_gh_update', String(v === true || v === 'true')); } catch (e) {} }
        });
    }
    // условие API TMDB: указать источник данных о фильмах (бот и строки пакета берут их у TMDB)
    Lampa.SettingsApi.addParam({
        component: C,
        param: { name: 'bs_info_tmdb', type: 'static' },
        field: { name: 'Данные о фильмах: TMDB', description: 'Этот продукт использует API TMDB, но не одобрен и не сертифицирован TMDB.' }
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
    bsNotyPolish();
    if (window.appready) { clearInterval(bsStageTimer); return; }
    var el = document.querySelector('.lp-status'), st = document.querySelector('.lp-step');
    var raw = el ? el.textContent : '';
    if (raw && raw !== bsStage) { bsStage = raw; bsStageSince = Date.now(); }    // этап — для сообщения «не запустилась»
    if (st || bsLampaOwn) {                                         // Lampa показала свой экран загрузки — дальше только он
        if (!bsLampaOwn) { bsLampaOwn = true; bsHideStatus(); }
        return;
    }
}, 500);

var bsReadyTimer = setInterval(function () {
    if (!window.appready || !window.Lampa) return;
    clearInterval(bsReadyTimer);
    try { window.localStorage.removeItem('bs_upd_intr'); } catch (e) {}      // поднялась — счёт прерванных запусков с нуля
    try { bsKeepOursOnCacheClear(Lampa.Storage); } catch (e) {}
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
    try { BSTv.start(); } catch (e) { console.log('BS tv', e); }                // «Телеканалы» — везде (с 2.3.63)
    try { bsFlushSettings(); } catch (e) { console.log('BS settings flush', e); }
    try { bsStartAutoUpdate(); } catch (e) { console.log('BS autoupdate', e); }
    setTimeout(bsAnnounce, 2500);
}, 300);

countdown();
