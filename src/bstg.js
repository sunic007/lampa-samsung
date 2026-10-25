/*
 * Уведомления в Telegram о новых сериях — через собственного бота пользователя.
 *
 *  Подключение с телефона (QR): токен длинный, пультом его не набрать. ТВ показывает QR со страницей ntfy.sh/<случайная
 *  тема> (открытая служба сообщений — своего сервера у нас нет); на телефоне: @BotFather → /newbot → скопировать токен
 *  → открыть QR → вставить → отправить. ТВ опрашивает тему, проверяет токен (getMe), просит написать боту и сам находит
 *  чат (getUpdates), бот присылает проверочное сообщение. Вручную — токен в поле и «Подключить».
 *  Сервера у нас нет: запросы к api.telegram.org идут прямо с ТВ, токен хранится только на нём. С пакета, где есть
 *  служба Tizen (service/service.js), токен и ключи ИИ лежат в ней, а не в localStorage (его читают и чужие плагины
 *  Lampa); без службы — как раньше, в localStorage (bs_tg_token). Подробнее — «служба Tizen» ниже.
 *  Lampa скрыта или закрыта — бота держит служба: копит сообщения до открытия Lampa, на «▶️ Смотреть» и другие кнопки
 *  «на ТВ» сама открывает Lampa (см. «бот, пока Lampa закрыта»).
 *
 *  Что отслеживаем: сериалы из закладок Lampa («Закладки», «Смотрю», «Запланировано») и все, что смотрели (bs_resume).
 *  Проверка: при запуске и потом раз в CHECK_EVERY на сериал — TMDB tv/{id}, last_episode_to_air. Серия новее той,
 *  что видели в прошлый раз, и вышла не раньше FRESH — сообщение с постером, один раз на серию (bs_tg_seen).
 *  Сериал впервые — только запоминаем текущую серию: старыми сериями не засыпаем.
 *  Ограничение: проверяет сам ТВ — пока Lampa не запущена, сообщения не уходят (придут при следующем запуске).
 *
 *  Ещё (пока Lampa запущена): утром в день выхода — «Сегодня выходит»; раз в неделю (с понедельника, первый запуск
 *  недели) — сводка «На этой неделе»; кнопки в сообщениях «Отписаться» / «Напомнить завтра»; команды боту: /subs —
 *  подписки, /find название (или просто текст) — поиск фильмов и сериалов (TMDB): постер, год, рейтинг и кнопки
 *  «Хочу посмотреть» (закладка Lampa «Позже» — wath, синхронизируется аккаунтом), «Открыть на ТВ», у сериала —
 *  «Подписаться». Бот слушает только свой чат (bs_tg_chat).
 *  Без команд со слешем: постоянная клавиатура внизу Telegram — «Найти», «Хочу посмотреть», «Мои подписки»,
 *  «На этой неделе», «Помощь»; название можно писать и просто текстом. Меню команд бота слева от поля ввода — те же разделы
 *  (setMyCommands, на каждом языке своё).
 *  Несколько ТВ на одном боте: Telegram отдаёт сообщения только одному опрашивающему (второй получает «Conflict») —
 *  поэтому один ТВ главный (опрашивает бота, шлёт уведомления), остальные слушают общий канал ntfy.sh, тема которого
 *  вычисляется из токена (без токена не угадать). По каналу: «я здесь» (название ТВ, главный ли, чат), «открой
 *  фильм на таком-то ТВ» и ответ, подписки и отправленные уведомления — чтобы у всех ТВ было одно и то же.
 *  «Открыть на ТВ» при нескольких включённых ТВ — выбор по названию (Настройки → Sunic Apps → Telegram-бот → «Название этого ТВ»).
 *  Главный выключили — его место после паузы занимает другой (через тот же «Conflict» Telegram).
 *  Родная кнопка Lampa «Подписаться» на карточке сериала (платная подписка CUB — у нас «Нет подписки») подписывает
 *  через бота, как кнопка в плеере.
 *
 *  Подписка в плеере, как в YouTube: на самой последней вышедшей серии сериала слева в панели плеера — «Подписаться» /
 *  «Вы подписаны ✓» (bs_subs) и когда выйдет следующая серия (TMDB next_episode_to_air): «через 3 дня (16 окт)».
 *  Подписанные сериалы отслеживаются вместе с закладками.
 */
var BSTelegram = (function () {
    var API = 'https://api.telegram.org/bot';
    var CHECK_EVERY = 6 * 3600 * 1000, FRESH = 7 * 86400000, MAX = 30, TIMEOUT = 15000;
    var BOOKMARKS = ['book', 'look', 'scheduled'];

    function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
    function lsDel(k) { try { window.localStorage.removeItem(k); } catch (e) {} }
    function on(k, def) { var v = lsGet(k); return v === null ? def : v === 'true'; }
    function noty(t, time) { try { Lampa.Noty.show(esc(t), { time: time || 4000 }); } catch (e) {} }
    /** Текст в HTML Lampa (Noty, Select): имена из Telegram и с других ТВ - чужие, разметку из них не исполняем. */
    function esc(t) { return String(t === undefined || t === null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    /** Имя человека/ТВ: без символов разметки, не длиннее 40. */
    function cleanName(t) { return String(t || '').replace(/[<>&"'`]/g, '').replace(/^\s+|\s+$/g, '').slice(0, 40); }
    function log(a, b) { try { console.log('BS telegram', a, b === undefined ? '' : b); } catch (e) {} }

    /** Токен в localStorage (без службы или ещё не перенесён в неё); в службе — '' (см. svcTg, hasToken). */
    /* Токен — в скрытом ключе bs_tg_secret, не в поле настройки bs_tg_token: поле Lampa показывает своё значение целиком
     * (на экране и при правке), токен там видел бы любой с пультом. Поле — только для ввода: сохранили — оно пустеет. */
    function token() { return String(lsGet('bs_tg_secret') || lsGet('bs_tg_token') || '').replace(/\s+/g, ''); }
    function setToken(t) { lsSet('bs_tg_secret', t); fieldClear(); }
    function fieldClear() { lsDel('bs_tg_token'); try { Lampa.Storage.set('bs_tg_token', '', true); } catch (e) {} }
    function tokenDel() { lsDel('bs_tg_secret'); fieldClear(); }
    /** Токен от прежних версий — в поле настройки: в скрытый ключ. */
    function tokenMigrate() { var t = String(lsGet('bs_tg_token') || '').replace(/\s+/g, ''); if (t) setToken(t); }
    /** Токен лежит в службе Tizen: в localStorage его нет, есть метка bs_tg_svc. */
    function svcTg() { return !token() && lsGet('bs_tg_svc') === '1'; }
    /** Бот подключён (токен есть — у нас или в службе). */
    function hasToken() { return !!token() || lsGet('bs_tg_svc') === '1'; }
    function state() { return hasToken() && chat() ? 'own' : 'none'; }
    function chat() { return lsGet('bs_tg_chat') || ''; }
    /** Токен сменился (подключение с телефона, по коду, вручную): номер апдейта bs_tg_offset — от прежнего бота, с ним
     *  новый бот молчал бы (его номера могут быть меньше). Без номера опрос начинается заново (offset=-1). */
    function offsetReset() { lsDel('bs_tg_offset'); try { svc.pend = 0; } catch (e) {} }

    /* Кому отвечаем сейчас: владелец (bs_tg_chat) или человек, подключившийся по QR в поиске, — у него свой чат и свои
     * списки. cur ставит разбор сообщения (as); keep переносит его в ответы Telegram/TMDB/Gemini, которые придут позже. */
    var cur = '', tmpMs = 0;
    function to() { return cur || chat(); }
    function isOwner() { return to() === chat(); }
    /* keep переносит и tmpMs: служебный ответ, отправленный позже (после TMDB и т. п.), тоже сам удалится. */
    function keep(fn) {
        if (typeof fn !== 'function') return fn;
        var c = cur, t = tmpMs;
        return function () { var p = cur, pt = tmpMs; cur = c; tmpMs = t; try { return fn.apply(this, arguments); } finally { cur = p; tmpMs = pt; } };
    }
    function as(c, fn) { var p = cur, pt = tmpMs; cur = String(c || ''); tmpMs = 0; try { fn(); } finally { cur = p; tmpMs = pt; } }

    /* ---------- чистый чат: служебное сменяется новым ----------
     * Команды человека («📋 Меню», /lang, слова с клавиатуры), нажатое меню и служебные ответы бота (меню, помощь,
     * списки, настройки, «Напишите название», «Включаю на ТВ») ждут в очереди bs_tg_del и удаляются, только когда
     * бот покажет следующее служебное сообщение, — по времени ничего не исчезает. Остаются результаты поиска,
     * уведомления о сериях и качестве, запросы на подключение. Telegram даёт удалять сообщения 48 часов —
     * старше из очереди просто выбрасываем. */
    var TMP_SHORT = 60000, TMP_LONG = 10 * 60000, lastMenu = {};
    function delLater(c, id, ms) {
        if (!c || !id) return;
        var q = lsJson('bs_tg_del', []);
        q.push({ c: String(c), id: id, at: Date.now() });
        lsSet('bs_tg_del', JSON.stringify(q.slice(-300)));
    }
    function delNow(c, id) { if (c && id) call('deleteMessage', { chat_id: c, message_id: id }, null, null); }
    function delTick() {
        var now = Date.now(), q = lsJson('bs_tg_del', []), left = [];
        if (!q.length) return;
        q.forEach(function (x) { if (now - x.at < 47 * 3600000) left.push(x); });
        if (left.length === q.length) return;
        lsSet('bs_tg_del', JSON.stringify(left));
    }
    /** fn отправит служебные сообщения — их уберёт следующее служебное. */
    function tmp(ms, fn) { var p = tmpMs; tmpMs = ms; try { return fn(); } finally { tmpMs = p; } }
    /** Отправлено сообщение: служебное — в очередь на удаление. */
    function sent(m) {
        if (tmpMs && m && m.message_id) { clearTmp(to(), m.message_id); delLater(to(), m.message_id, tmpMs); }
        return m;
    }
    /** Появилось новое служебное сообщение — прежние служебные в этом чате убираем сразу: в чате одно, последнее. */
    function clearTmp(c, except) {
        var q = lsJson('bs_tg_del', []), left = [];
        // только более ранние: номера сообщений в чате растут, а ответы Telegram могут прийти не по порядку
        q.forEach(function (x) { if (x.c === String(c) && x.id < except) delNow(x.c, x.id); else left.push(x); });
        if (left.length !== q.length) lsSet('bs_tg_del', JSON.stringify(left));
        if (lastMenu[c] && lastMenu[c] !== except) lastMenu[c] = 0;
    }

    /* ---------- язык бота: у каждого человека свой (ru / en / uz) ----------
     * Выбор хранится в bs_tg_lang ({чат: язык}) и ходит по каналу на другие ТВ. Кто не выбирал — русский, как раньше;
     * чужому (ещё не подключённому) отвечаем на языке его Telegram (language_code). Тексты на ТВ (Lampa) не трогаем. */
    var LANGS = ['ru', 'en', 'uz'], langHint = {};
    function langMap() { var m = lsJson('bs_tg_lang', {}); return m && typeof m === 'object' ? m : {}; }
    function codeLang(code) {
        code = String(code || '').toLowerCase().slice(0, 2);
        return code === 'uz' ? 'uz' : !code || /^(ru|uk|be|kk|ky|tg)$/.test(code) ? 'ru' : 'en';
    }
    /** Язык Lampa на этом ТВ, приведённый к языкам бота (ru/en/uz): украинский, белорусский и т. п. — русский. */
    function lampaLang() {
        var l = '';
        try { l = String(Lampa.Storage.get('language', 'ru') || ''); } catch (e) {}
        return l === 'uz' ? 'uz' : l === 'en' ? 'en' : 'ru';
    }
    /** Выбрал сам — его язык; подключённый, но не выбирал, — язык Lampa на ТВ; чужой — язык его Telegram. */
    function lang() {
        var c = to(), l = langMap()[c];
        if (LANGS.indexOf(l) >= 0) return l;
        return allowed(c) ? lampaLang() : (langHint[c] || 'ru');
    }
    /** Текст на языке того, кому отвечаем. uz не задан — русский. */
    function L(ru, en, uz) { var l = lang(); return l === 'en' ? en : l === 'uz' ? (uz || ru) : ru; }
    /** Когда выбран язык ({чат: время}) — по каналу побеждает более свежий выбор (ТВ мог быть выключен). */
    function langAt() { var m = lsJson('bs_tg_lang_at', {}); return m && typeof m === 'object' ? m : {}; }
    function putLang(id, l, at) {
        var m = langMap(), a = langAt();
        if (LANGS.indexOf(l) < 0 || (a[id] || 0) > (at || 0)) return;
        m[id] = l; a[id] = at || 0;
        lsSet('bs_tg_lang', JSON.stringify(m)); lsSet('bs_tg_lang_at', JSON.stringify(a));
    }
    function setLang(l) {
        if (LANGS.indexOf(l) < 0) return;
        var at = Date.now();
        putLang(to(), l, at);
        busSend({ t: 'lang', id: to(), l: l, at: at });
    }
    /** Кнопки выбора языка. */
    function langRows() {
        return [[{ text: '🇷🇺 Русский', callback_data: 'lg:ru' }, { text: '🇬🇧 English', callback_data: 'lg:en' }, { text: "🇺🇿 O'zbekcha", callback_data: 'lg:uz' }]];
    }

    /* ---------- Bot API ---------- */

    /** wait — своё время ожидания ответа, мс (длинный опрос getUpdates). */
    /* Часы ТВ бывают сбиты на минуты: «пришло, пока Lampa была выключена» считаем по часам Telegram (заголовок Date
     * его ответа), а не по часам ТВ — иначе свежие сообщения выглядели старыми и не выполнялись. */
    var serverSkew = 0;
    function noteServerTime(x) {
        try { var d = Date.parse(x.getResponseHeader('Date') || ''); if (d) serverSkew = d - Date.now(); } catch (e) {}
    }
    function serverNow() { return Date.now() + serverSkew; }
    /* «Слишком часто» (429): Telegram говорит, через сколько секунд можно снова (parameters.retry_after). Повторяем
     * тот же запрос один раз, ждём не дольше RETRY_MAX; опять 429 — ошибка, как раньше. */
    var RETRY_MAX = 60;
    function retryAfter(x, j) {
        if (x.status !== 429 && !(j && j.error_code === 429)) return 0;
        var s = j && j.parameters ? j.parameters.retry_after | 0 : 0;
        return Math.min(Math.max(s, 1), RETRY_MAX);
    }
    /* POST с телом формы, а не GET: длинный текст или клавиатура в адресе давали 414 (адрес слишком длинный). */
    function call(method, params, ok, fail, wait) {
        ok = keep(ok); fail = keep(fail);
        var q = [], k, retried = false;
        for (k in params) if (params.hasOwnProperty(k)) q.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
        (function go() {
            var x = new XMLHttpRequest(), done = false, viaSvc = svcTg();
            var end = function (f, v) { if (!done) { done = true; if (f) f(v); } };
            try {
                // токен в службе — через неё (тело и ответ те же, Date — от Telegram); нет — напрямую, как раньше
                if (viaSvc) svcOpen(x, 'POST', SVC + '/tg/' + method);
                else x.open('POST', API + token() + '/' + method, true);
                x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
                x.timeout = wait || TIMEOUT;
                x.onload = function () {
                    var j = null;
                    try { j = JSON.parse(x.responseText); } catch (e) {}
                    if (viaSvc && svcSeen(x.status, j)) return end(fail, 'служба Lampa не отвечает');
                    noteServerTime(x);
                    if (j && j.ok) return end(ok, j.result);
                    var after = retryAfter(x, j);
                    if (after && !retried && !done) {
                        retried = done = true;
                        log('Telegram: слишком часто, повтор через ' + after + ' с', method);
                        return setTimeout(go, after * 1000);
                    }
                    end(fail, (j && j.description) || ('ответ ' + x.status));
                };
                x.onerror = function () { if (viaSvc) svcLost(); end(fail, viaSvc ? 'служба Lampa не отвечает' : 'нет связи с Telegram'); };
                x.ontimeout = function () { end(fail, 'Telegram не ответил'); };
                x.send(q.join('&'));
            } catch (e) { end(fail, e.message); }
        })();
    }

    /* ---------- служба Tizen: токен бота и ключи ИИ — только в ней ----------
     * В пакете есть служба (service/service.js: Node.js на ТВ, http://127.0.0.1:8897). Токен и ключи ИИ лежат в её
     * файле, а не в localStorage: localStorage читает любой плагин Lampa на этой странице. Запросы к Telegram и ИИ идут
     * через службу — секрет подставляет она, назад не отдаёт; то, что раньше выводилось из токена (тема и ключ канала
     * ТВ, код приглашения), считает тоже она (/derive), подключение ещё одного ТВ — /join.
     * Перенос: служба ответила — каждый секрет из localStorage отправляем ей и стираем у себя, только когда она
     * подтвердила, что сохранила. Остаётся метка без секрета: bs_tg_svc = '1' (токен в службе) и bs_ai_svc — какие ключи
     * ИИ в ней: последние 4 знака (показ в боте) и FNV ключа (кэши моделей и лимитов — те же, что от самого ключа).
     * Новый токен или ключ сначала, как раньше, ложится в localStorage и тут же уходит в службу (svcMove).
     * Службы нет (старый пакет, проверка в браузере) — всё как раньше, в localStorage. Служба пропала — запускаем снова;
     * секреты не теряются: перенесённые — в её файле, остальные — ещё в localStorage. */
    /* Ключ доступа: все запросы к службе (кроме /health) — с заголовком X-Lampa-Key. Ключ служба пишет на старте в
     * svc.key своей папки данных (apps_rw/<пакет>/data) — у страницы это виртуальная папка 'wgt-private'
     * (tizen.filesystem). Держим его только в памяти. Не прочитался (не Tizen, старый пакет, нет прав) — службы для нас
     * нет: всё как раньше, в localStorage; ничего не стираем. Служба перезапустилась — ключ новый: 401 «key» —
     * перечитать. store из /health: стирать метки и секреты по ответу службы — только при 'ok' (файл прочитан). */
    var SVC = 'http://127.0.0.1:8897', SVC_WAIT = [300, 700, 1500, 3000, 5000, 8000], SVC_WAKE_GAP = 30000;
    var svc = { up: false, wakeAt: 0, probing: false, moving: false, again: false, deriving: false, d: null, aliveAt: 0, pend: 0, away: false, awayAt: 0,
        store: '', reviving: false, told: {}, absent: false };
    /* Ключ доступа к службе — отдельно от svc: svc виден снаружи (тесты), ключ — только здесь, в замыкании. */
    var svcKey = '';
    var AI_LIST = ['groq', 'gemini', 'openrouter'];
    /** Один раз за запуск — в лог (а не на каждой проверке). */
    function logOnce(k, a, b) { if (svc.told[k]) return; svc.told[k] = 1; log(a, b); }
    /** Открыть запрос к службе: с ключом доступа. */
    function svcOpen(x, method, url) {
        x.open(method, url, true);
        if (svcKey) x.setRequestHeader('X-Lampa-Key', svcKey);
    }
    /** Ключ доступа из svc.key в wgt-private. cb(ключ или ''). Tizen 5+: openFile; старее — resolve и readAsText. */
    function svcKeyRead(cb) {
        var done = false, fin = function (k) { if (done) return; done = true; k = String(k || '').replace(/\s+/g, ''); cb(/^[0-9a-f]{64}$/.test(k) ? k : ''); };
        try {
            var fsys = tizen.filesystem;
            if (typeof fsys.openFile === 'function') {
                try { var h = fsys.openFile('wgt-private/svc.key', 'r'), t = h.readString(); h.close(); if (t) return fin(t); } catch (e) {}
            }
            fsys.resolve('wgt-private/svc.key', function (f) {
                try { f.readAsText(function (t) { fin(t); }, function () { fin(''); }, 'UTF-8'); } catch (e) { fin(''); }
            }, function () { fin(''); }, 'r');
        } catch (e) { return fin(''); }
        setTimeout(function () { fin(''); }, 3000);
    }
    function onTizen() { try { return typeof tizen !== 'undefined' && !!tizen.application; } catch (e) { return false; } }

    function svcId() {
        try { return tizen.application.getCurrentApplication().appInfo.packageId + '.LampaService'; } catch (e) { return '0SG81L944p.LampaService'; }
    }
    /** Службы в пакете нет (старый пакет без неё): до перезапуска Lampa её больше не ищем и не запускаем. */
    function svcAbsent(e) {
        if (!e || e.name !== 'NotFoundError' || svc.absent) return false;
        svc.absent = true; svc.up = false;
        log('службы в пакете нет — больше не ищу (до перезапуска Lampa)', '');
        return true;
    }
    /** Запустить службу (уже запущена — ничего не будет). Не Tizen — молча нет. */
    function svcLaunch() {
        try {
            // старый пакет без службы: запуск отвечает NotFoundError — тогда больше не пробуем (svcAbsent)
            tizen.application.launchAppControl(new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/service'), svcId(),
                function () { log('служба запущена', ''); }, function (e) { if (!svcAbsent(e)) log('служба не запустилась', e && e.message); });
        } catch (e) { svcAbsent(e); }
    }
    /** Запрос к службе: тело — JSON текстом (без Content-Type: без лишнего предзапроса CORS). cb(статус, json); 0 — нет связи. */
    function svcAsk(method, p, body, cb, wait) {
        var x = new XMLHttpRequest(), done = false;
        var end = function (st, j) { if (!done) { done = true; if (cb) cb(st, j); } };
        try {
            svcOpen(x, method, SVC + p);
            x.timeout = wait || 5000;
            x.onload = function () {
                var j = null;
                try { j = JSON.parse(x.responseText); } catch (e) {}
                if (p !== '/health' && svcSeen(x.status, j)) return end(0, null);
                end(x.status, j);
            };
            x.onerror = x.ontimeout = function () { end(0, null); };
            x.send(body === undefined ? null : JSON.stringify(body));
        } catch (e) { end(0, null); }
    }
    /** /health с ключом: cb(ответ — служба наша и ключ подошёл, или null). Ключа нет или он старый — читаем заново. */
    function svcHealth(cb, wait) {
        var ask = function () {
            svcAsk('GET', '/health', undefined, function (st, j) {
                if (st === 200 && j && j.ok && j.auth === true) return cb(j);
                if (st === 200 && j && j.ok) { svcKey = ''; logOnce('key', 'служба есть, но ключ доступа не подошёл — без неё', ''); }
                cb(null, st);
            }, wait || 3000);
        };
        if (svcKey || !onTizen()) return ask();
        svcKeyRead(function (k) { svcKey = k; ask(); });
    }
    /** Запустить и дождаться ответа /health (несколько попыток — служба стартует не сразу). */
    function svcStart() {
        if (svc.probing || svc.absent) return;
        svcLaunch();
        if (svc.absent) return;
        svc.wakeAt = Date.now(); svc.probing = true;
        (function probe(i) {
            setTimeout(function () {
                if (svc.absent) { svc.probing = false; return; }       // запуск ответил: такой службы нет
                svcHealth(function (j, st) {
                    if (j) { svc.probing = false; return svcOn(j); }
                    if (i + 1 < SVC_WAIT.length) return probe(i + 1);
                    svc.probing = false; svc.up = false;
                    log('службы нет — секреты в localStorage, как раньше', st);
                });
            }, SVC_WAIT[i]);
        })(0);
    }
    /** Служба не ответила на запрос — запустить снова (не чаще раза в SVC_WAKE_GAP). */
    function svcLost() {
        svc.up = false;
        if (svc.probing || svc.absent || Date.now() - svc.wakeAt < SVC_WAKE_GAP) return;
        log('служба не отвечает — запускаю снова', '');
        svcStart();
    }
    /* Ответ службы на запрос (не /health). -> true: ответа как бы нет (ключ не тот — перечитаем). Служба считалась
     * пропавшей (не успела к 6 пробам), а ответила — поднять её как обычно (svcOn). */
    function svcSeen(st, j) {
        if (st === 401 && j && j.error === 'key') { svcKey = ''; svcLost(); return true; }
        if (st && st !== 403 && !svc.up && !svc.probing && !svc.reviving) {
            svc.reviving = true;
            svcHealth(function (h) { svc.reviving = false; if (h && !svc.up) { log('служба ответила позже — работаю с ней', ''); svcOn(h); } });
        }
        return false;
    }
    /** Проверка: жива ли, всё ли перенесено (первые 10 минут — раз в минуту, потом раз в 5 минут; см. start). */
    function svcCheck() {
        if (svc.probing || svc.absent || (!svc.up && !hasSvcMarks() && !onTizen())) return;
        svcHealth(function (j) { if (j) svcOn(j); else svcLost(); });
    }
    function hasSvcMarks() { return lsGet('bs_tg_svc') === '1' || Object.keys(aiMarks()).length > 0; }
    function svcOn(h) {
        var was = svc.up;
        svc.up = true; svc.v = h.v; svc.store = String(h.store || '');
        if (svc.store !== 'ok') logOnce('store' + svc.store, 'служба: файл секретов — ' + (svc.store || '?') + ', ничего не стираю и не переношу', '');
        var go = function () {
            if (svc.store === 'ok') { svcSync(h.has || {}); svcMove(); }
            if (svcTg() && !svc.d) svcDerive();
            if (svcTg()) svcCmds();
            if (!was && svcBot()) setTimeout(poll, 500);        // Lampa открыла служба (кнопка «на ТВ») — очередь сразу
        };
        // «Отключить Telegram», пока служба не отвечала: стереть и в ней — раньше, чем переносить новое
        // (и поверх файла, который не прочитался: его и просили стереть)
        if (lsGet('bs_tg_forget') === '1' && (svc.store === 'ok' || svc.store === 'unreadable')) return svcForget(function (ok) {
            if (ok) { lsDel('bs_tg_forget'); h = { has: {} }; }
            go();
        });
        go();
    }

    /* Метки ключей ИИ в службе: {провайдер: {h, l}, 'провайдер.чат': {h, l}} — чат гостя; без чата — владелец. */
    function aiMarks() { var m = lsJson('bs_ai_svc', {}); return m && typeof m === 'object' ? m : {}; }
    function aiMarksSave(m) { if (Object.keys(m).length) lsSet('bs_ai_svc', JSON.stringify(m)); else lsDel('bs_ai_svc'); }
    function slotId(p, c) { return c ? p + '.' + c : p; }
    function secretName(p, c) { return c ? 'aiu.' + p + '.' + c : 'ai.' + p; }
    function keyMark(k) { k = String(k || '').replace(/\s+/g, ''); return { h: fnv(k, 2166136261), l: k.slice(-4) }; }
    /* Где ключи ИИ лежали раньше (и лежат без службы): владельца — bs_ai_<p> (Gemini — bs_gemini_key), людей — {чат: ключ}
     * в bs_ai_<p>_u (Gemini — bs_gemini_keys). */
    function lsKeyName(p) { return p === 'gemini' ? 'bs_gemini_key' : 'bs_ai_' + p; }
    function lsMapName(p) { return p === 'gemini' ? 'bs_gemini_keys' : 'bs_ai_' + p + '_u'; }
    function lsKeyMap(p) { var m = lsJson(lsMapName(p), {}); return m && typeof m === 'object' ? m : {}; }
    function lsKey(p, c) { return String((c ? lsKeyMap(p)[c] : lsGet(lsKeyName(p))) || ''); }
    function lsKeySet(p, c, k) {
        if (!c) return lsSet(lsKeyName(p), k);
        var m = lsKeyMap(p); m[c] = k; lsSet(lsMapName(p), JSON.stringify(m));
    }
    function lsKeyDel(p, c) {
        if (!c) return lsDel(lsKeyName(p));
        var m = lsKeyMap(p); delete m[c]; lsSet(lsMapName(p), JSON.stringify(m));
    }

    /* Ключи ИИ, удалённые человеком (setAiKey с пустым ключом), пока служба не ответила: список слотов bs_ai_forget —
     * сотрём и в ней, как только ответит. Без такой явной пометки ключи в службе не трогаем никогда: «у страницы нет
     * метки» — ещё не «удалили» (метки могли пропасть вместе с localStorage). */
    function aiForget() { var a = lsJson('bs_ai_forget', []); return Object.prototype.toString.call(a) === '[object Array]' ? a : []; }
    function aiForgetSet(id, on) {
        var a = aiForget(), i = a.indexOf(id);
        if (on && i < 0) a.push(id);
        if (!on && i >= 0) a.splice(i, 1);
        if (a.length) lsSet('bs_ai_forget', JSON.stringify(a.slice(-50))); else lsDel('bs_ai_forget');
    }
    /** Удалить ключ ИИ в службе: удалось — пометку снять, нет — оставить (повторим в svcSync). */
    function aiDrop(p, c) {
        var id = slotId(p, c);
        aiForgetSet(id, true);
        if (!svc.up) return;
        svcAsk('POST', '/secret', { name: secretName(p, c), value: '' }, function (st, j) {
            if (st === 200 && j && j.ok && !lsKey(p, c) && !aiMarks()[id]) aiForgetSet(id, false);
            else if (!st) svcLost();
        });
    }
    /** Служба — главная: чего в ней нет (файл пропал), той метки и у нас нет. Стираем в ней только то, что человек
     *  удалил сам (bs_ai_forget, bs_tg_forget — в svcOn), а не всё, на что у страницы нет метки.
     *  Токена в службе нет, а метка есть (служба потеряла файл) — метку снимаем и один раз говорим об этом на ТВ:
     *  бот молча не отключается. */
    function svcSync(has) {
        var ai = has.ai || [], aiu = has.aiu || {}, marks = aiMarks(), changed = false, id;
        if (lsGet('bs_tg_svc') === '1' && !has.tg && !token()) {
            lsDel('bs_tg_svc'); svc.d = null; busStop();
            log('в службе нет токена — бот не подключён', '');
            noty('Telegram-бот: служба потеряла подключение — подключите бота заново', 10000);
            refreshSettings();
        } else if (has.tg && lsGet('bs_tg_svc') !== '1' && !token() && chat()) lsSet('bs_tg_svc', '1');
        var inSvc = function (p, c) { return c ? (aiu[p] || []).indexOf(c) >= 0 : ai.indexOf(p) >= 0; };
        for (id in marks) if (marks.hasOwnProperty(id)) {
            var dot = id.indexOf('.'), p = dot < 0 ? id : id.slice(0, dot), c = dot < 0 ? '' : id.slice(dot + 1);
            if (!inSvc(p, c)) { delete marks[id]; changed = true; }
        }
        if (changed) aiMarksSave(marks);
        aiForget().forEach(function (fid) {
            var d = fid.indexOf('.'), fp = d < 0 ? fid : fid.slice(0, d), fc = d < 0 ? '' : fid.slice(d + 1);
            if (AI_LIST.indexOf(fp) < 0 || lsKey(fp, fc) || marks[fid]) return aiForgetSet(fid, false);   // ключ задали снова — не стираем
            if (inSvc(fp, fc)) aiDrop(fp, fc); else aiForgetSet(fid, false);
        });
    }

    /** Всё, что ещё в localStorage, — в службу; из localStorage стираем, только когда служба сохранила. */
    function svcMove() {
        if (!svc.up || svc.store !== 'ok') return;
        if (svc.moving) { svc.again = true; return; }
        var jobs = [], t = token();
        if (t) jobs.push(function (next) { svcPutTg(t, next); });
        AI_LIST.forEach(function (p) {
            var own = lsKey(p, '').replace(/\s+/g, ''), m = lsKeyMap(p), c;
            if (own) jobs.push(function (next) { svcPutKey(p, '', next); });
            for (c in m) if (m.hasOwnProperty(c) && m[c] && /^-?\d{1,20}$/.test(c)) (function (c) { jobs.push(function (next) { svcPutKey(p, c, next); }); })(c);
        });
        if (!jobs.length) return;
        svc.moving = true; svc.again = false;
        (function next() {
            var j = jobs.shift();
            if (j) return j(next);
            svc.moving = false;
            if (svc.again) svcMove();
        })();
    }
    function svcPutKey(p, c, next) {
        var raw = lsKey(p, c), k = raw.replace(/\s+/g, '');
        svcAsk('POST', '/secret', { name: secretName(p, c), value: k }, function (st, j) {
            if (st === 200 && j && j.ok) {
                if (lsKey(p, c) === raw) {                               // пока сохраняли, ключ не сменили
                    var m = aiMarks(), mk = keyMark(k); m[slotId(p, c)] = mk; aiMarksSave(m);   // сначала метка, потом стираем ключ
                    // метка записалась (localStorage мог быть полон) — только тогда ключ у себя стираем
                    var back = aiMarks()[slotId(p, c)];
                    if (back && back.h === mk.h) {
                        lsKeyDel(p, c);
                        log('ключ ИИ — в службе', slotId(p, c).replace(/\..*/, ' (человек)'));
                    } else logOnce('full', 'localStorage полон: метка не записалась — секрет остаётся у страницы', '');
                } else svc.again = true;
            } else if (!st) svcLost();
            next();
        });
    }
    function svcPutTg(t, next) {
        svcAsk('POST', '/secret', { name: 'tg', value: t }, function (st, j) {
            if (!(st === 200 && j && j.ok)) { if (!st) svcLost(); return next(); }
            // тема и ключ канала — от службы, до того как токен уйдёт из localStorage: канал не прерывается
            svcDerive(function (ok) {
                if (ok && token() === t) {
                    lsSet('bs_tg_svc', '1');
                    if (lsGet('bs_tg_svc') !== '1') { logOnce('full', 'localStorage полон: метка не записалась — секрет остаётся у страницы', ''); return next(); }
                    // Lampa.Storage держит прочитанное в памяти (readed): без этого токен остался бы виден плагинам
                    tokenDel();
                    log('токен бота — в службе', '');
                    busStart();
                } else if (token() !== t) svc.again = true;
                next();
            });
        });
    }
    /** Выведенное из токена — от службы (сам токен у страницы не появляется). cb(удалось). */
    function svcDerive(cb) {
        var salt = lsGet('bs_tg_invite_salt') || '', first = !svc.d;
        svc.deriving = true;
        svcAsk('POST', '/derive', { salt: salt }, function (st, j) {
            svc.deriving = false;
            var ok = st === 200 && !!j && j.ok === true && /^lampa-tv-[0-9a-f]{16}$/.test(j.topic || '') && /^[0-9a-f]{64}$/.test(j.key || '');
            if (ok) {
                var kb = [];
                for (var i = 0; i < 64; i += 2) kb.push(parseInt(j.key.substr(i, 2), 16));
                svc.d = { topic: j.topic, key: kb, salt: salt, inv: String(j.invite || '') };
                if (first && svcTg()) { busStart(); busHello(true); }
            } else if (!st) svcLost();
            if (cb) cb(ok);
        });
    }
    /** Стереть все секреты в службе (см. tgOff). */
    function svcForget(cb) {
        svcAsk('POST', '/forget', {}, function (st, j) {
            var ok = st === 200 && !!j && j.ok;
            if (ok) { lsDel('bs_tg_svc'); lsDel('bs_ai_svc'); svc.d = null; busStop(); if (j.store) svc.store = String(j.store); }
            if (cb) cb(ok);
        });
    }

    /** Чат из последних сообщений боту (getUpdates): самое свежее личное сообщение. skip — чаты подключённых людей:
     *  владельцем при подключении ТВ не может стать гость, который писал боту последним. */
    function chatFrom(updates, skip) {
        for (var i = (updates || []).length - 1; i >= 0; i--) {
            var u = updates[i], m = u && (u.message || u.edited_message || u.my_chat_member);
            if (m && m.chat && m.chat.id && m.chat.type === 'private' && !(skip && skip[String(m.chat.id)])) return String(m.chat.id);
        }
        return '';
    }

    /** buttons — [[{text, callback_data}]] под сообщением (необязательно). */
    function send(text, photo, ok, fail, buttons) {
        if (!hasToken() || !chat()) { if (fail) fail('не подключено'); return; }
        var extra = function (p) { if (buttons) p.reply_markup = JSON.stringify({ inline_keyboard: buttons }); return p; };
        var done = function (m) { sent(m); if (ok) ok(m); };
        var plain = function () { call('sendMessage', extra({ chat_id: to(), text: text }), done, fail); };
        if (photo) call('sendPhoto', extra({ chat_id: to(), photo: photo, caption: text }), done, plain);
        else plain();
    }
    /** Текст на заданном языке l (не того, кому отвечаем): меню команд и описание бота для каждого языка. */
    function T3(l, ru, en, uz) { return l === 'en' ? en : l === 'uz' ? uz : ru; }
    // Внизу — только «Меню»: «Профиль» и «Помощь» есть в самом меню (раньше дублировались здесь).
    function kb() { return { keyboard: [[{ text: L('📋 Меню', '📋 Menu', '📋 Menyu') }]], resize_keyboard: true, is_persistent: true }; }
    function help() {
        return L('Я — ваш помощник Lampa 🎬\n\n' +
            '🔎 Напишите название фильма или сериала — найду и покажу кнопки: «▶️ Смотреть» (сразу включится на ТВ), «⭐ Хочу посмотреть», «🔔 Подписаться». Не помните название — опишите сюжет, поможет ИИ.\n' +
            'Можно добавить год или студию: «Доктор Стрендж 2026», «2026», «фильмы Марвел 2026», «сериалы Netflix».\n' +
            '🖼 Пришлите скриншот, кадр или постер — узнаю фильм.\n' +
            '⌨️ «Набрать на ТВ» — пишете текст здесь, и он появляется в поиске Lampa на телевизоре.\n' +
            '➕ Ещё один ТВ: в его Lampa откройте Настройки → Sunic Apps → Telegram-бот → «Подключить через бота» и пришлите сюда код с экрана.\n' +
            '🔔 Сообщу, когда выйдет новая серия, а утром в день выхода — напомню.\n' +
            '🗓 По понедельникам — что выходит на этой неделе.\n' +
            '🎬 Записали момент кнопкой «Записать» в плеере — видео придёт сюда.\n' +
            '👥 Для всей семьи: каждый подключает свой Telegram через QR-код в поиске Lampa — у каждого свои «Хочу посмотреть» и подписки. Кто подключён — в «⚙️ Настройки» → «👥 Люди».\n\n' +
            '📋 Кнопка «Меню» внизу — все разделы. ' + (svcBot() ? 'Работаю, пока ТВ включён в розетку, даже если Lampa закрыта.' : 'Работаю, пока Lampa запущена на ТВ.') + '\n\n' +
            'Данные о фильмах — TMDB. Этот продукт использует API TMDB, но не одобрен и не сертифицирован TMDB.',
            "I'm your Lampa assistant 🎬\n\n" +
            "🔎 Type the name of a movie or series — I'll find it and show buttons: “▶️ Watch” (starts on the TV right away), “⭐ Want to watch”, “🔔 Subscribe”. Don't remember the name? Describe the plot — AI will help.\n" +
            'You can add a year or a studio: “Doctor Strange 2026”, “2026”, “Marvel movies 2026”, “Netflix series”.\n' +
            "🖼 Send a screenshot, a frame or a poster — I'll recognize the movie.\n" +
            '⌨️ “Type on TV” — type text here and it appears in Lampa search on the TV.\n' +
            '➕ Another TV: in its Lampa open Settings → Sunic Apps → Telegram-бот → “Подключить через бота” (Connect via bot) and send the code from the screen here.\n' +
            "🔔 I'll let you know when a new episode is out and remind you on the morning of release day.\n" +
            "🗓 On Mondays — what's coming out this week.\n" +
            '🎬 Record a moment with the “Записать” (Record) button in the player — the video will arrive here.\n' +
            '👥 For the whole family: everyone connects their own Telegram via the QR code in Lampa search — each gets their own “Want to watch” and subscriptions. Who is connected — “⚙️ Settings” → “👥 People”.\n\n' +
            '📋 The “Menu” button below opens all sections. ' + (svcBot() ? 'I work while the TV is plugged in, even when Lampa is closed.' : 'I work while Lampa is running on the TV.') + '\n\n' +
            'Movie data: TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.',
            "Men — Lampa yordamchingizman 🎬\n\n" +
            "🔎 Film yoki serial nomini yozing — topib, tugmalarni ko'rsataman: «▶️ Ko'rish» (darhol televizorda yoqiladi), «⭐ Ko'rmoqchiman», «🔔 Obuna bo'lish». Nomini eslay olmasangiz — syujetini yozing, sun'iy intellekt yordam beradi.\n" +
            "Yil yoki studiyani ham qo'shishingiz mumkin: «Doktor Strendj 2026», «2026», «Marvel filmlari 2026», «Netflix seriallari».\n" +
            "🖼 Skrinshot, kadr yoki poster yuboring — filmni aniqlayman.\n" +
            "⌨️ «TV'da yozish» — matnni shu yerda yozasiz, u televizordagi Lampa qidiruvida paydo bo'ladi.\n" +
            "➕ Yana bir televizor: uning Lampa'sida Настройки → Sunic Apps → Telegram-бот → «Подключить через бота» ga kiring va ekrandagi kodni shu yerga yuboring.\n" +
            "🔔 Yangi qism chiqqanda xabar beraman, chiqish kuni ertalab esa eslataman.\n" +
            "🗓 Har dushanba — shu hafta nimalar chiqishini yozaman.\n" +
            "🎬 Pleerdagi «Записать» tugmasi bilan yozib olingan lavha shu yerga keladi.\n" +
            "👥 Butun oila uchun: har kim o'z Telegramini Lampa qidiruvidagi QR-kod orqali ulaydi — har kimning o'z «Ko'rmoqchiman» ro'yxati va obunalari bo'ladi. Kim ulangani — «⚙️ Sozlamalar» → «👥 Odamlar».\n\n" +
            "📋 Pastdagi «Menyu» tugmasi — barcha bo'limlar. " + (svcBot() ? "Televizor tokka ulangan ekan, Lampa yopiq bo'lsa ham ishlayman." : "Lampa televizorda ishlab turganda ishlayman.") + "\n\n" +
            "Film ma'lumotlari — TMDB. Ushbu mahsulot TMDB API'dan foydalanadi, lekin TMDB tomonidan tasdiqlanmagan yoki sertifikatlanmagan.");
    }
    function helpText() {
        var h = help();
        return isOwner() ? h : h.replace(/➕[^\n]*\n/, '').replace(/👥[^\n]*\n/, L('👥 Ваши «Хочу посмотреть» и подписки — только ваши, другие их не видят.\n',
            "👥 Your “Want to watch” and subscriptions are yours only — others can't see them.\n",
            "👥 «Ko'rmoqchiman» ro'yxatingiz va obunalaringiz faqat sizniki — boshqalar ularni ko'rmaydi.\n"));
    }
    function sendKb(text) { call('sendMessage', { chat_id: to(), text: text, reply_markup: JSON.stringify(kb()) }, sent, null); }
    /** Выбор языка — тому, кто ещё не выбирал (первое знакомство): подпись сразу на трёх языках. */
    function langAsk() { reply('🌐 Выберите язык / Choose a language / Tilni tanlang', langRows()); }
    function langAskOnce() { if (!langMap()[to()]) setTimeout(keep(langAsk), 900); }

    function epButtons(id) { return [[{ text: L('🔕 Отписаться', '🔕 Unsubscribe', "🔕 Obunani bekor qilish"), callback_data: 'u:' + id }, { text: L('⏰ Напомнить завтра', '⏰ Remind me tomorrow', '⏰ Ertaga eslatish'), callback_data: 'l:' + id }]]; }
    /** Меню команд слева от поля ввода - те же разделы, что в «📋 Меню». l — язык меню (у Telegram своё на каждый язык). */
    function commands(l) {
        return [
            { command: 'menu', description: T3(l, '📋 Главное меню', '📋 Main menu', '📋 Asosiy menyu') },
            { command: 'find', description: T3(l, '🔎 Найти фильм или сериал', '🔎 Find a movie or series', '🔎 Film yoki serial topish') },
            { command: 'type', description: T3(l, '⌨️ Набрать текст в поиске Lampa на ТВ', '⌨️ Type text into Lampa search on the TV', "⌨️ Televizordagi Lampa qidiruviga matn yozish") },
            { command: 'want', description: T3(l, '⭐ Хочу посмотреть', '⭐ Want to watch', "⭐ Ko'rmoqchiman") },
            { command: 'subs', description: T3(l, '🔔 Мои подписки', '🔔 My subscriptions', '🔔 Obunalarim') },
            { command: 'week', description: T3(l, '🗓 На этой неделе', '🗓 This week', '🗓 Bu hafta') },
            { command: 'tvs', description: T3(l, '📺 Телевизоры', '📺 TVs', '📺 Televizorlar') },
            { command: 'profile', description: T3(l, '👤 Профиль', '👤 Profile', '👤 Profil') },
            { command: 'help', description: T3(l, '❓ Помощь', '❓ Help', '❓ Yordam') },
            { command: 'settings', description: T3(l, '⚙️ Настройки и ключи ИИ', '⚙️ Settings and AI keys', "⚙️ Sozlamalar va AI kalitlari") },
            { command: 'lang', description: '🌐 Язык / Language / Til' }
        ];
    }
    /** s — на ТВ есть служба (бот отвечает и при закрытой Lampa). */
    function botDesc(l, s) {
        if (s) return T3(l, 'Помощник Lampa для телевизора: найдёт фильм или сериал и включит его на ТВ, сообщит о новых сериях и о том, что фильм вышел в хорошем качестве.\n\n⚠️ Бот работает на телевизоре: отвечает, пока ТВ включён в розетку и подключён к интернету, даже если Lampa закрыта. Бот молчит? Проверьте, что ТВ включён в розетку и в сети.',
            "Lampa assistant for your TV: finds a movie or series and plays it on the TV, tells you about new episodes and when a movie is out in good quality.\n\n⚠️ The bot runs on your TV: it answers while the TV is plugged in and online, even when Lampa is closed. Bot not answering? Check that the TV is plugged in and online.",
            "Televizor uchun Lampa yordamchisi: film yoki serialni topib, televizorda yoqadi, yangi qismlar va film yaxshi sifatda chiqqani haqida xabar beradi.\n\n⚠️ Bot televizorda ishlaydi: televizor tokka va internetga ulangan ekan, Lampa yopiq bo'lsa ham javob beradi. Bot javob bermayaptimi? Televizor tokka va internetga ulanganini tekshiring.");
        return T3(l, 'Помощник Lampa для телевизора: найдёт фильм или сериал и включит его на ТВ, сообщит о новых сериях и о том, что фильм вышел в хорошем качестве.\n\n⚠️ Бот работает внутри Lampa на телевизоре — отвечает, только пока Lampa открыта хотя бы на одном ТВ. Бот молчит? Включите Lampa на ТВ.',
            "Lampa assistant for your TV: finds a movie or series and plays it on the TV, tells you about new episodes and when a movie is out in good quality.\n\n⚠️ The bot runs inside Lampa on the TV — it answers only while Lampa is open on at least one TV. Bot not answering? Open Lampa on the TV.",
            "Televizor uchun Lampa yordamchisi: film yoki serialni topib, televizorda yoqadi, yangi qismlar va film yaxshi sifatda chiqqani haqida xabar beradi.\n\n⚠️ Bot televizordagi Lampa ichida ishlaydi — Lampa kamida bitta televizorda ochiq bo'lgandagina javob beradi. Bot javob bermayaptimi? Televizorda Lampa'ni oching.");
    }
    function botShort(l, s) {
        if (s) return T3(l, 'Lampa на ТВ: найдёт фильм, включит его на телевизоре, сообщит о новых сериях. Работает, даже когда Lampa закрыта.',
            'Lampa on your TV: finds movies, plays them on the TV, tells you about new episodes. Works even when Lampa is closed.',
            "Lampa TV'da: film topadi, televizorda yoqadi, yangi qismlar haqida xabar beradi. Lampa yopiq bo'lsa ham ishlaydi.");
        return T3(l, 'Lampa на ТВ: найдёт фильм, включит его на телевизоре, сообщит о новых сериях. Работает, пока Lampa открыта.',
            'Lampa on your TV: finds movies, plays them on the TV, tells you about new episodes. Works while Lampa is open.',
            "Lampa TV'da: film topadi, televizorda yoqadi, yangi qismlar haqida xabar beradi. Lampa ochiq ekan, ishlaydi.");
    }
    /* Разовое сообщение «что нового» после обновления бота. Раньше — метка bs_tg_cmds с проверкой «равно»: '7' в 1.7.43–51,
     * '8' в 1.7.52–58, '9' с 1.7.59. ТВ, где версию с GitHub пометили плохой, на сутки уходит на модули своего пакета —
     * и старый и новый код видели «чужую» метку, слали каждый своё «новое меню» и ставили свою: при каждом таком переходе
     * сообщение приходило снова. Теперь номер (bs_tg_news) только растёт, а старому коду пакета ставим ту метку,
     * которую он ждёт, — он молчит. */
    var BOT_NEWS = 9;
    function newsSeen() { return Math.max(parseInt(lsGet('bs_tg_news'), 10) || 0, parseInt(lsGet('bs_tg_cmds'), 10) || 0); }
    /** Метка, которую ждёт bstg.js этой версии пакета ('' — тот код ничего такого не шлёт). */
    function newsPkgFlag(pkg) { var n = verNum(pkg); return n >= 1007059 ? '9' : n >= 1007052 ? '8' : n >= 1007043 ? '7' : ''; }
    /** Пора разослать «что нового»? Отмечает его увиденным (раз и навсегда) и ставит метку для кода пакета. */
    function newsDue() {
        var seen = newsSeen();                                      // до newsPkgMark: та может понизить bs_tg_cmds
        lsSet('bs_tg_news', String(Math.max(seen, BOT_NEWS)));
        newsPkgMark();
        return seen < BOT_NEWS;
    }
    function newsPkgMark() {
        var pkg = '';
        try { pkg = tizen.application.getCurrentApplication().appInfo.version; } catch (e) {}
        var f = newsPkgFlag(pkg);
        if (f && lsGet('bs_tg_cmds') !== f) lsSet('bs_tg_cmds', f);
    }

    /** Меню команд и описание — на каждом языке свои (default — русский, у кого Telegram на en/uz — свои). */
    function setCommands() {
        [['', 'ru'], ['en', 'en'], ['uz', 'uz']].forEach(function (x) {
            var lc = function (p) { if (x[0]) p.language_code = x[0]; return p; };
            call('setMyCommands', lc({ commands: JSON.stringify(commands(x[1])) }), null, null);
            call('setMyDescription', lc({ description: botDesc(x[1], svcBot()) }), null, null);
            call('setMyShortDescription', lc({ short_description: botShort(x[1], svcBot()) }), null, null);
        });
        call('setChatMenuButton', { menu_button: JSON.stringify({ type: 'commands' }) }, null, null);
    }

    /** «📋 Меню»: сообщение «Выберите раздел» с кнопками-плитками, как у бота Skaz. */
    function menuRows() {
        var b = function (text, a) { return { text: text, callback_data: 'mn:' + a }; };
        var rows = [
            [b(L('🔎 Найти', '🔎 Find', '🔎 Topish'), 'find'), b(L('🖼 По картинке', '🖼 By picture', "🖼 Rasm bo'yicha"), 'pic')],
            [b(L('⌨️ Набрать на ТВ', '⌨️ Type on TV', "⌨️ TV'da yozish"), 'type'), b(L('📺 Телевизоры', '📺 TVs', '📺 Televizorlar'), 'tvs')],
            [b(L('⭐ Хочу посмотреть', '⭐ Want to watch', "⭐ Ko'rmoqchiman"), 'want'), b(L('🔔 Подписки', '🔔 Subscriptions', '🔔 Obunalar'), 'subs')]
        ];
        // остальное — парами: у владельца есть «Люди», у гостя нет; «Поддержать» — внизу «Помощи»
        // «Профиль» и «Люди» — в «⚙️ Настройках»; сами настройки — рядом с «Помощью»
        rows.push([b(L('🗓 На неделе', '🗓 This week', '🗓 Bu hafta'), 'week'), b(L('❓ Помощь', '❓ Help', '❓ Yordam'), 'help'), b(L('⚙️ Настройки', '⚙️ Settings', '⚙️ Sozlamalar'), 'settings')]);
        return rows;
    }
    function tvNames() { return allTvs().map(function (d) { return d.text.replace(/^📺 /, ''); }); }
    function sendMenu() {
        var tvs = tvNames(), c = to();
        tmp(TMP_LONG, function () { send(L('📺 На связи: ', '📺 Online: ', '📺 Aloqada: ') + tvs.join(', ') + (anyAi() ? L(' · 🧠 ИИ-поиск включён', ' · 🧠 AI search is on', " · 🧠 AI qidiruv yoqilgan") : '') +
            L('\n\nВыберите раздел:', '\n\nChoose a section:', "\n\nBo'limni tanlang:"), null, function (m) { if (m && m.message_id) lastMenu[c] = m.message_id; }, null, menuRows()); });
    }
    function profileText() {
        var g = guest(), people = users(), me = people[to()] || {}, ai = aiProviders().map(function (x) { return x.p === 'gemini' ? 'Gemini' : OA[x.p].name; });
        if (cubAiReady()) ai.unshift(L('AI-ассистент Lampa (CUB)', 'Lampa AI assistant (CUB)', 'Lampa AI yordamchisi (CUB)'));
        var subsN = (isOwner() ? subs() : ((g || {}).subs || [])).length;
        var lines = [
            '👤 ' + (isOwner() ? L('Владелец бота', 'Bot owner', 'Bot egasi') : L('Вы подключены' + (me.name ? ' как ' + me.name : '') + ' — у вас свои списки и подписки',
                "You're connected" + (me.name ? ' as ' + me.name : '') + ' — you have your own lists and subscriptions',
                'Siz ulangansiz' + (me.name ? ' (' + me.name + ')' : '') + " — ro'yxat va obunalaringiz o'zingizniki")),
            L('📺 Телевизоры на связи: ', '📺 TVs online: ', '📺 Aloqadagi televizorlar: ') + tvNames().join(', '),
            L('🔔 Подписок: ', '🔔 Subscriptions: ', '🔔 Obunalar: ') + subsN,
            L('📀 Жду хорошего качества: ', '📀 Waiting for good quality: ', '📀 Yaxshi sifat kutilmoqda: ') + (isOwner() ? qwOwner() : ((g || {}).qwait || [])).length,
            L('🧠 ИИ-поиск: ', '🧠 AI search: ', "🧠 AI qidiruv: ") + (ai.length ? ai.join(', ') : L('нет ключа — пришлите ключ Groq, Gemini или OpenRouter (как получить — «⚙️ Настройки» → «🧠 ИИ-поиск»)',
                'no key — send a Groq, Gemini or OpenRouter key (how to get one — “⚙️ Settings” → “🧠 AI search”)',
                "kalit yo'q — Groq, Gemini yoki OpenRouter kalitini yuboring (qanday olish — «⚙️ Sozlamalar» → «🧠 AI qidiruv»)"))
        ];
        if (isOwner()) {
            var guests = Object.keys(people).filter(function (k) { return active(people[k]); }).length;
            lines.push(L('👥 Подключено людей: ', '👥 People connected: ', '👥 Ulangan odamlar: ') + guests);
        }
        return lines.join('\n');
    }
    function tvsInfo() {
        screenCheck();                                                         // обновить в фоне; список — сразу, по кэшу
        tvsShow();
    }
    function tvsShow() {
        var tvs = allTvs();
        var rows = isOwner() ? [[{ text: L('✏️ Переименовать ТВ', '✏️ Rename TV', "✏️ TV nomini o'zgartirish"), callback_data: 'rn' }]] : null;
        reply(L('📺 Телевизоры на связи (', '📺 TVs online (', '📺 Aloqadagi televizorlar (') + tvs.length + '):\n' + tvs.map(function (d) { return '• ' + d.text.replace(/^📺 /, ''); }).join('\n') +
            L('\n\nЕщё один ТВ: в его Lampa откройте Настройки → Sunic Apps → Telegram-бот → «Подключить через бота» и пришлите сюда код с экрана.',
                '\n\nAnother TV: in its Lampa open Settings → Sunic Apps → Telegram-бот → “Подключить через бота” (Connect via bot) and send the code from the screen here.',
                "\n\nYana bir televizor: uning Lampa'sida Настройки → Sunic Apps → Telegram-бот → «Подключить через бота» ga kiring va ekrandagi kodni shu yerga yuboring."), rows);
    }
    function supportText() {
        return L('💬 Вопросы, помощь и новости: https://t.me/sunicapps\n\n❤️ Lampa для Samsung и TV Installer бесплатны.\nПоддержать проект: https://github.com/sponsors/sunic007',
            '💬 Questions, help and news: https://t.me/sunicapps\n\n❤️ Lampa for Samsung and TV Installer are free.\nSupport the project: https://github.com/sponsors/sunic007',
            "💬 Savollar, yordam va yangiliklar: https://t.me/sunicapps\n\n❤️ Samsung uchun Lampa va TV Installer bepul.\nLoyihani qo'llab-quvvatlash: https://github.com/sponsors/sunic007");
    }
    /* ---------- «⚙️ Настройки» в боте: язык, ИИ-поиск (ключи), телевизоры, люди ----------
     * Экраны — одно сообщение: кнопки меняют его на месте (editMessageText), чат не растёт. */
    var AI_INFO = {
        groq: { icon: '⚡', name: 'Groq', url: 'https://console.groq.com/keys', starts: 'gsk_' },
        gemini: { icon: '🔷', name: 'Gemini', url: 'https://aistudio.google.com/apikey', starts: 'AIza / AQ.' },
        openrouter: { icon: '🌐', name: 'OpenRouter', url: 'https://openrouter.ai/keys', starts: 'sk-or-' }
    };
    /** Экран: q (нажатая кнопка) — меняем её сообщение; нет — новое служебное сообщение. */
    function screen(q, text, rows) {
        if (q && q.message) {
            return call('editMessageText', { chat_id: to(), message_id: q.message.message_id, text: text, disable_web_page_preview: 'true',
                reply_markup: JSON.stringify({ inline_keyboard: rows }) }, null, null);
        }
        tmp(TMP_LONG, function () { send(text, null, null, null, rows); });
    }
    function settingsText() {
        return L('⚙️ Настройки\n\n🌐 Язык: русский\n🧠 ИИ-поиск: ', '⚙️ Settings\n\n🌐 Language: English\n🧠 AI search: ', "⚙️ Sozlamalar\n\n🌐 Til: o'zbekcha\n🧠 AI qidiruv: ") +
            (aiReady() ? aiProviders().map(function (x) { return AI_INFO[x.p].name; }).join(', ') : L('нет ключа', 'no key', "kalit yo'q"));
    }
    function settingsRows() {
        var rows = [[{ text: L('👤 Профиль', '👤 Profile', '👤 Profil'), callback_data: 'st:prof' }, { text: '🌐 Язык / Language / Til', callback_data: 'mn:lang' }],
            [{ text: L('🧠 ИИ-поиск — ключи API', '🧠 AI search — API keys', "🧠 AI qidiruv — API kalitlari"), callback_data: 'st:ai' }]];
        if (isOwner()) rows.push([{ text: L('📺 Телевизоры', '📺 TVs', '📺 Televizorlar'), callback_data: 'mn:tvs' }, { text: L('👥 Люди', '👥 People', '👥 Odamlar'), callback_data: 'st:people' }]);
        rows.push([{ text: L('📋 Меню', '📋 Menu', '📋 Menyu'), callback_data: 'mn:menu' }]);
        return rows;
    }
    function backRow() { return [{ text: L('⬅️ Настройки', '⬅️ Settings', '⬅️ Sozlamalar'), callback_data: 'st:main' }]; }
    /** Ключ в списке — только последние знаки: чат могут видеть другие. */
    /** i — ключ из aiSlot/ownSlot (в localStorage или метка службы): последние 4 знака. */
    function keyMask(i) { return i && i.l ? '…' + i.l : ''; }
    function aiText() {
        var lines = [L('🧠 ИИ-поиск — поиск по описанию («фильм, где…») и по скриншоту. Нужен бесплатный ключ API любого сервиса. Можно добавить несколько — бот будет обращаться к ним по очереди.',
            '🧠 AI search — search by description (“the movie where…”) and by screenshot. You need a free API key from any service. You can add several — the bot will use them in turn.',
            "🧠 AI qidiruv — tavsif («…bo'lgan film») va skrinshot bo'yicha qidirish. Istalgan xizmatning bepul API kaliti kerak. Bir nechtasini qo'shsa ham bo'ladi — bot ulardan navbat bilan foydalanadi."), ''];
        ['groq', 'gemini', 'openrouter'].forEach(function (p) {
            var k = aiKey(p), own = ownSlot(p);
            lines.push(AI_INFO[p].icon + ' ' + AI_INFO[p].name + ': ' + (own ? '✅ ' + keyMask(k) : k ? L('✅ ключ владельца', "✅ owner's key", '✅ bot egasining kaliti') : L('— нет', '— none', "— yo'q")));
        });
        if (cubAiReady()) lines.push(L('🤖 AI-ассистент Lampa (CUB) — включён по подписке', '🤖 Lampa AI assistant (CUB) — on via subscription', '🤖 Lampa AI yordamchisi (CUB) — obuna orqali yoqilgan'));
        lines.push('', L('Нет подписки CUB? Хватит бесплатного ключа. Выберите сервис:', 'No CUB subscription? A free key is enough. Choose a service:', "CUB obunasi yo'qmi? Bepul kalit yetarli. Xizmatni tanlang:"));
        return lines.join('\n');
    }
    function aiRows() {
        var rows = ['groq', 'gemini', 'openrouter'].map(function (p) {
            return [{ text: AI_INFO[p].icon + ' ' + AI_INFO[p].name + (p === 'groq' ? L(' — самый быстрый', ' — the fastest', ' — eng tezkori') : ''), callback_data: 'st:k:' + p }];
        });
        if (aiReady()) rows.push([{ text: L('🔍 Проверить ключи', '🔍 Check keys', '🔍 Kalitlarni tekshirish'), callback_data: 'mn:pic' }]);
        rows.push([{ text: L('⬅️ Настройки', '⬅️ Settings', '⬅️ Sozlamalar'), callback_data: 'st:main' }]);
        return rows;
    }
    function aiKeyText(p) {
        var i = AI_INFO[p], has = ownSlot(p);
        return i.icon + ' ' + i.name + '\n\n' + L('1. Откройте сайт кнопкой ниже и войдите (бесплатно).\n2. Создайте ключ API — он начинается с ' + i.starts + '.\n3. Скопируйте ключ и пришлите сюда обычным сообщением.\n\nКлюч сохранится на ТВ, а сообщение с ним я сразу удалю.',
            "1. Open the site with the button below and sign in (it's free).\n2. Create an API key — it starts with " + i.starts + ".\n3. Copy the key and send it here as a regular message.\n\nThe key will be saved on the TV, and I'll delete your message with it right away.",
            "1. Quyidagi tugma orqali saytni oching va kiring (bepul).\n2. API kalitini yarating — u " + i.starts + " bilan boshlanadi.\n3. Kalitni nusxalang va shu yerga oddiy xabar qilib yuboring.\n\nKalit televizorda saqlanadi, kalitli xabarni esa darhol o'chiraman.") +
            (has ? '\n\n' + L('Сейчас: ✅ ', 'Now: ✅ ', 'Hozir: ✅ ') + keyMask(has) : '') + (isOwner() ? '' : '\n' + L('Это будет ваш личный ключ — его лимит тратите только вы.', 'This will be your personal key — only you use up its limit.', "Bu shaxsiy kalitingiz bo'ladi — uning limitidan faqat siz foydalanasiz."));
    }
    function aiKeyRows(p) {
        var has = ownSlot(p);
        var rows = [[{ text: L('🔗 Получить ключ ', '🔗 Get a key at ', '🔗 Kalit olish: ') + AI_INFO[p].name, url: AI_INFO[p].url }]];
        if (has) rows.push([{ text: L('🗑 Удалить ключ', '🗑 Delete key', "🗑 Kalitni o'chirish"), callback_data: 'st:d:' + p }]);
        rows.push([{ text: L('⬅️ ИИ-поиск', '⬅️ AI search', "⬅️ AI qidiruv"), callback_data: 'st:ai' }]);
        return rows;
    }
    /** Кнопки экранов настроек (st:…). */
    function settingsAction(q, a) {
        if (a === 'main') return screen(q, settingsText(), settingsRows());
        if (a === 'ai') return screen(q, aiText(), aiRows());
        if (a === 'prof') return screen(q, profileText(), [backRow()]);
        if (a === 'people') return isOwner() ? peopleList(q) : null;
        var k = /^k:(groq|gemini|openrouter)$/.exec(a);
        if (k) return screen(q, aiKeyText(k[1]), aiKeyRows(k[1]));
        var d = /^d:(groq|gemini|openrouter)$/.exec(a);
        if (d) {
            setAiKey(d[1], '');
            call('answerCallbackQuery', { callback_query_id: q.id, text: L('Ключ удалён', 'Key deleted', "Kalit o'chirildi") }, null, null);
            return screen(q, aiText(), aiRows());
        }
    }
    function askTitle() { return reply(L('Напишите название фильма или сериала 👇', 'Type the name of a movie or series 👇', 'Film yoki serial nomini yozing 👇')); }
    /** Всё, что отправляет раздел меню, — служебное: уберётся, когда бот покажет следующее. */
    function menuAction(a) { return tmp(a === 'find' || a === 'type' || a === 'lang' ? 2 * TMP_SHORT : TMP_LONG, function () { return menuDo(a); }); }
    function menuDo(a) {
        if (a === 'find') return askTitle();
        if (a === 'type') return typeStart();
        if (a === 'pic') return aiReady() ? aiStatus() : reply(geminiHow());
        if (a === 'want') return wantList();
        if (a === 'subs') return subsList();
        if (a === 'week') return reply(weekText(true));
        if (a === 'tvs') return tvsInfo();
        if (a === 'people') return isOwner() ? peopleList() : null;
        if (a === 'profile') return reply(profileText(), [[{ text: L('📋 Меню', '📋 Menu', '📋 Menyu'), callback_data: 'mn:menu' }]]);
        if (a === 'help') return tmp(0, function () { sendKb(helpText() + '\n\n' + supportText()); });   // с кнопкой «Меню» — не удаляем
        if (a === 'support') return reply(supportText());              // кнопка из старых сообщений
        if (a === 'lang') return reply('🌐 ' + L('Выберите язык', 'Choose a language', 'Tilni tanlang'), langRows());
        if (a === 'settings') return screen(null, settingsText(), settingsRows());
        if (a === 'menu') return sendMenu();
    }

    function link() {
        if (!hasToken()) return noty('Сначала впишите токен бота', 3000);
        noty('Подключаю…', 2000);
        call('getMe', {}, function (me) {
            if (me && me.username) lsSet('bs_tg_bot', me.username);
            call('getUpdates', {}, function (updates) {
                var c = chatFrom(updates, users());
                if (!c) return noty('Напишите боту @' + me.username + ' и нажмите «Подключить» ещё раз', 7000);
                lsSet('bs_tg_chat', c);
                svcMove();
                call('sendMessage', { chat_id: c, text: L('✅ Lampa подключена.\n\n', '✅ Lampa is connected.\n\n', '✅ Lampa ulandi.\n\n') + help(), reply_markup: JSON.stringify(kb()) },
                    function () { noty('Telegram подключён: @' + me.username, 4000); refreshSettings(); setCommands(); check(false); langAskOnce(); },
                    function (e) { noty('Сообщение не ушло: ' + e, 6000); });
            }, function (e) { noty('Telegram: ' + e, 5000); });
        }, function (e) { noty('Токен не подошёл: ' + e, 6000); });
    }

    /* ---------- подключение с телефона (QR через ntfy.sh) ---------- */

    /* ---------- шифрование и подпись сообщений через ntfy (ES5, без WebCrypto: старые ТВ) ----------
     * SHA-256 и HMAC-SHA256 на чистом JS. seal: поток HMAC(ключ шифрования, nonce|счётчик) XOR текст, подпись
     * HMAC(ключ подписи, nonce|шифртекст) — подделать, прочитать или изменить сообщение без ключа нельзя.
     * Та же копия — в docs/pair.html (страница на телефоне шифрует токен). */
    var Crypt = (function () {
        var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
            0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
            0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
            0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
            0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
            0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
            0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
            0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
        function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
        /** SHA-256 массива байт -> массив из 32 байт. */
        function sha256(msg) {
            var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
            var m = msg.slice(0), bitLen = msg.length * 8, i, j;
            m.push(0x80);
            while (m.length % 64 !== 56) m.push(0);
            for (i = 7; i >= 0; i--) m.push(i > 3 ? 0 : (bitLen >>> (i * 8)) & 255);
            var w = new Array(64);
            for (var off = 0; off < m.length; off += 64) {
                for (i = 0; i < 16; i++) w[i] = (m[off + i * 4] << 24) | (m[off + i * 4 + 1] << 16) | (m[off + i * 4 + 2] << 8) | m[off + i * 4 + 3];
                for (i = 16; i < 64; i++) {
                    var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
                    var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
                    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
                }
                var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
                for (i = 0; i < 64; i++) {
                    var t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
                    var t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
                    hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
                }
                h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
                h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
            }
            var out = [];
            for (i = 0; i < 8; i++) for (j = 3; j >= 0; j--) out.push((h[i] >>> (j * 8)) & 255);
            return out;
        }
        function hmac(key, msg) {
            if (key.length > 64) key = sha256(key);
            var ik = [], ok = [];
            for (var i = 0; i < 64; i++) { var k = key[i] || 0; ik.push(k ^ 0x36); ok.push(k ^ 0x5c); }
            return sha256(ok.concat(sha256(ik.concat(msg))));
        }
        function bytes(s) { var u = unescape(encodeURIComponent(String(s))), b = []; for (var i = 0; i < u.length; i++) b.push(u.charCodeAt(i)); return b; }
        function text(b) { var s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return decodeURIComponent(escape(s)); }
        function b64(b) { var s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
        function unb64(s) { var r = atob(String(s || '')), b = []; for (var i = 0; i < r.length; i++) b.push(r.charCodeAt(i)); return b; }
        function hex(b) { var s = ''; for (var i = 0; i < b.length; i++) s += ('0' + b[i].toString(16)).slice(-2); return s; }
        function rnd(n) {
            var a = [], i;
            try {
                var c = window.crypto || window.msCrypto, u = new Uint8Array(n);
                c.getRandomValues(u);
                for (i = 0; i < n; i++) a.push(u[i]);
                return a;
            } catch (e) {}
            for (i = 0; i < n; i++) a.push(Math.floor(Math.random() * 256));
            return a;
        }
        function stream(ek, nonce, data) {
            var out = [];
            for (var i = 0; i < data.length; i += 32) {
                var ks = hmac(ek, nonce.concat([(i >>> 24) & 255, (i >>> 16) & 255, (i >>> 8) & 255, i & 255]));
                for (var j = 0; j < 32 && i + j < data.length; j++) out.push(data[i + j] ^ ks[j]);
            }
            return out;
        }
        /** Ключ из строки (токен, код, секрет из QR). */
        function key(str) { return sha256(bytes(str)); }
        /** Зашифровать и подписать строку: {z:2, n, c, s}. */
        function seal(k, str) {
            var n = rnd(16), ct = stream(hmac(k, bytes('enc')), n, bytes(str));
            return { z: 2, n: b64(n), c: b64(ct), s: b64(hmac(hmac(k, bytes('mac')), n.concat(ct)).slice(0, 16)) };
        }
        /** Проверить подпись и расшифровать; чужое или изменённое — null. */
        function open(k, m) {
            try {
                if (!m || m.z !== 2) return null;
                var n = unb64(m.n), ct = unb64(m.c), tag = unb64(m.s);
                if (n.length !== 16 || tag.length !== 16) return null;
                var want = hmac(hmac(k, bytes('mac')), n.concat(ct)).slice(0, 16), diff = 0;
                for (var i = 0; i < 16; i++) diff |= want[i] ^ tag[i];
                if (diff) return null;
                return text(stream(hmac(k, bytes('enc')), n, ct));
            } catch (e) { return null; }
        }
        /** PBKDF2-HMAC-SHA256, 32 байта (один блок) — ключ из короткого кода: подбирать его перебором дорого. */
        function pbkdf(pass, salt, iter) {
            var p = bytes(pass), u = hmac(p, bytes(salt).concat([0, 0, 0, 1])), out = u.slice(0);
            for (var i = 1; i < iter; i++) { u = hmac(p, u); for (var j = 0; j < 32; j++) out[j] ^= u[j]; }
            return out;
        }
        /** Случайный секрет для QR: 22 символа без похожих букв. */
        function secret() {
            var a = 'abcdefghijkmnpqrstuvwxyz23456789', r = rnd(22), s = '';
            for (var i = 0; i < r.length; i++) s += a.charAt(r[i] % a.length);
            return s;
        }
        /* X25519 (RFC 7748) на чистом JS — порт crypto_scalarmult из TweetNaCl (общественное достояние). Нужен для
         * подключения второго ТВ по 6 цифрам: общий ключ двух ТВ, который не узнать, даже зная цифры. Та же копия —
         * в service/service.js (Node на старых ТВ без X25519). sk, pk — 32 байта (массив или Uint8Array) -> 32 байта. */
        function x25519(sk, pk) {
            function gf(init) { var r = new Float64Array(16); if (init) for (var i = 0; i < init.length; i++) r[i] = init[i]; return r; }
            function car(o) { var c = 1, v; for (var i = 0; i < 16; i++) { v = o[i] + c + 65535; c = Math.floor(v / 65536); o[i] = v - c * 65536; } o[0] += c - 1 + 37 * (c - 1); }
            function sel(p, q, b) { var t, c = ~(b - 1); for (var i = 0; i < 16; i++) { t = c & (p[i] ^ q[i]); p[i] ^= t; q[i] ^= t; } }
            function A(o, a, b) { for (var i = 0; i < 16; i++) o[i] = a[i] + b[i]; }
            function Z(o, a, b) { for (var i = 0; i < 16; i++) o[i] = a[i] - b[i]; }
            function M(o, a, b) {
                var t = new Float64Array(31), i, j;
                for (i = 0; i < 16; i++) for (j = 0; j < 16; j++) t[i + j] += a[i] * b[j];
                for (i = 0; i < 15; i++) t[i] += 38 * t[i + 16];
                for (i = 0; i < 16; i++) o[i] = t[i];
                car(o); car(o);
            }
            function inv(o, x) { var c = gf(), a; for (a = 0; a < 16; a++) c[a] = x[a]; for (a = 253; a >= 0; a--) { M(c, c, c); if (a !== 2 && a !== 4) M(c, c, x); } for (a = 0; a < 16; a++) o[a] = c[a]; }
            function pack(n) {
                var m = gf(), t = gf(), i, j, b, out = [];
                for (i = 0; i < 16; i++) t[i] = n[i];
                car(t); car(t); car(t);
                for (j = 0; j < 2; j++) {
                    m[0] = t[0] - 0xffed;
                    for (i = 1; i < 15; i++) { m[i] = t[i] - 0xffff - ((m[i - 1] >> 16) & 1); m[i - 1] &= 0xffff; }
                    m[15] = t[15] - 0x7fff - ((m[14] >> 16) & 1);
                    b = (m[15] >> 16) & 1;
                    m[14] &= 0xffff;
                    sel(t, m, 1 - b);
                }
                for (i = 0; i < 16; i++) { out.push(t[i] & 0xff); out.push((t[i] >> 8) & 0xff); }
                return out;
            }
            var z = [], x = gf(), a = gf(), b = gf(), c = gf(), d = gf(), e = gf(), f = gf(), k121665 = gf([0xdb41, 1]), i, r;
            for (i = 0; i < 32; i++) z.push(sk[i] & 255);
            z[31] = (z[31] & 127) | 64; z[0] &= 248;
            for (i = 0; i < 16; i++) x[i] = (pk[2 * i] & 255) + ((pk[2 * i + 1] & 255) << 8);
            x[15] &= 0x7fff;
            for (i = 0; i < 16; i++) b[i] = x[i];
            a[0] = d[0] = 1;
            for (i = 254; i >= 0; --i) {
                r = (z[i >>> 3] >>> (i & 7)) & 1;
                sel(a, b, r); sel(c, d, r);
                A(e, a, c); Z(a, a, c); A(c, b, d); Z(b, b, d);
                M(d, e, e); M(f, a, a); M(a, c, a); M(c, b, e);
                A(e, a, c); Z(a, a, c); M(b, a, a); Z(c, d, f);
                M(a, c, k121665); A(a, a, d); M(c, c, a); M(a, d, f); M(d, b, x); M(b, e, e);
                sel(a, b, r); sel(c, d, r);
            }
            inv(c, c); M(a, a, c);
            return pack(a);
        }
        return { sha256: sha256, hmac: hmac, bytes: bytes, hex: hex, key: key, seal: seal, open: open, secret: secret, rnd: rnd, pbkdf: pbkdf, x25519: x25519, b64: b64, unb64: unb64 };
    })();

    /* ---------- серверы ntfy: основной и запасные ----------
     * ntfy.sh даёт 250 сообщений в сутки на IP, а дома IP один на ТВ, телефон и гостей — бывает 429. Запасные — серверы с
     * тем же API (без регистрации, CORS *): публикуем в первый, ответил 429 / 5xx / нет связи — в следующий (relayPost).
     * Подключение (QR, код второго ТВ) слушает тему на всех по очереди — один запрос в такт. Канал ТВ — см. busRelay. */
    var RELAYS = ['https://ntfy.sh/', 'https://ntfy.envs.net/', 'https://ntfy.adminforge.de/', 'https://ntfy.hostux.net/'];
    var TOKEN_RE = /(\d{6,12}:[A-Za-z0-9_-]{30,})/, PAIR_TIME = 15 * 60000, PAIR_LAN_V = 3;
    var pair = null;     // {topic, since: {сервер: id}, ri, until, stage: 'token' | 'chat', busy, timer, lan}
    /** Опубликовать в тему: с сервера from, не принял (429, 5xx, нет связи) — следующий; one — только from.
     *  cb(статус, номер сервера; -1 — ни один не принял, статус — последний отказ: 429 или 0 — нет связи). */
    function relayPost(topic, body, from, cb, one) {
        var n = RELAYS.length, i = 0, last = 0;
        (function next() {
            if (i >= (one ? 1 : n)) { if (cb) cb(last, -1); return; }
            var idx = (from + i) % n, x = new XMLHttpRequest(), done = false;
            i++;
            var fin = function (st) {
                if (done) return;
                done = true;
                if (!st || st === 429 || st >= 500) { if (st === 429 || !last) last = st; return next(); }
                if (cb) cb(st, idx);
            };
            try {
                x.open('POST', RELAYS[idx] + topic, true);
                x.timeout = TIMEOUT;
                x.onload = function () { fin(x.status); };
                x.onerror = x.ontimeout = function () { fin(0); };
                x.send(body);
            } catch (e) { fin(0); }
        })();
    }

    /** Тема для QR: случайность из crypto.getRandomValues (Crypt.rnd; нет его на ТВ — Math.random). 32 буквы — без перекоса. */
    function randomTopic() {
        var a = 'abcdefghijkmnpqrstuvwxyz23456789', t = 'lampa-', r = Crypt.rnd(16);
        for (var i = 0; i < r.length; i++) t += a.charAt(r[i] % a.length);
        return t;
    }
    /** Закрыть подключение; по Wi-Fi — закрыть и сервер для телефона в службе. */
    function pairStop() {
        if (!pair) return;
        clearInterval(pair.timer);
        if (pair.lan) svcAsk('POST', '/pair/stop', { secret: pair.secret });   // служба закроет, только если секрет наш
        pair = null;
    }
    /* Окна подключения — Lampa.Modal. Закрываем своё окно один раз и только пока оно сверху: после «Готово!» окно
     * закрывается по таймеру, а человек мог уже нажать «Назад» и уйти — второй Modal.close() закрыл бы чужое окно, а
     * toggle(ctrl) увёл бы фокус. В Lampa со стеком окон (Controller.windowOpen/windowClose/windowTop) окна могут
     * лежать друг на друге: наше спрятано под другим (.modal.hide) — его не трогаем; фокус после Modal.close() Lampa
     * сама вернёт в окно ниже, а наш toggle(ctrl) перенаправит туда же. Старая Lampa — как раньше: close + toggle. */
    function modalOpen(mo) {
        var h = { el: mo && mo.html && mo.html[0] || null, closed: false };
        Lampa.Modal.open(mo);
        return h;
    }
    /** Наше окно ещё на экране и сверху? Не понять (нет DOM) — считаем, что да (прежнее поведение). */
    function modalOnTop(h) {
        try {
            if (!h.el || typeof document === 'undefined' || !document.body || !document.body.contains) return true;
            if (!document.body.contains(h.el)) return false;     // Lampa уже закрыла (новый экран, closeAll)
            var m = $(h.el).closest('.modal');
            return !m.length || !m.hasClass('hide');            // под другим окном (стек Lampa 3.3.8+)
        } catch (e) { return true; }
    }
    function modalClose(h, ctrl, noFocus) {
        if (!h || h.closed) return false;
        h.closed = true;
        if (!modalOnTop(h)) return false;
        try { Lampa.Modal.close(); } catch (e) {}
        if (!noFocus && ctrl) { try { Lampa.Controller.toggle(ctrl); } catch (e) {} }
        return true;
    }

    /** Какой сервер спросить в этот такт: все по очереди (since у каждого свой — id сообщений у серверов разные). */
    function relayTurn(p) { var i = (p.ri | 0) % RELAYS.length; p.ri = i + 1; return i; }

    /** Новые сообщения темы (ntfy: построчный JSON) на очередном сервере. cb(токен или '', id последнего сообщения, сервер). */
    function pollRelay(p, cb) {
        var x = new XMLHttpRequest(), done = false, i = relayTurn(p);
        var end = function (tok, last) { if (!done) { done = true; cb(tok || '', last || '', i); } };
        try {
            x.open('GET', RELAYS[i] + p.topic + '/json?poll=1&since=' + encodeURIComponent(p.since[i] || '2m'), true);
            x.timeout = TIMEOUT;
            x.onload = function () { if (x.status !== 200) return end('', ''); end.apply(null, tokenFrom(x.responseText, p.secret)); };
            x.onerror = x.ontimeout = function () { end('', ''); };
            x.send();
        } catch (e) { end('', ''); }
    }
    /** Токен из ответа ntfy (последний подходящий) и id последнего сообщения — дальше читаем после него (по id, а не по
     *  часам ТВ: часы нового ТВ могут спешить, и «с такого-то времени» отсеяло бы присланный токен). */
    function tokenFrom(text, secret) {
        var tok = '', last = '', k = secret ? Crypt.key('lampa-pair-v2|' + secret) : null;
        String(text || '').split('\n').forEach(function (line) {
            var ev = null, body = '';
            try { ev = JSON.parse(line); } catch (e) { return; }
            if (!ev || ev.event !== 'message') return;
            if (ev.id) last = ev.id;
            body = String(ev.message || '');
            if (k) {                                   // с секретом из QR - только зашифрованный им токен
                var sealed = null;
                try { sealed = JSON.parse(body); } catch (e) { return; }
                body = Crypt.open(k, sealed) || '';
            }
            var m = TOKEN_RE.exec(body.replace(/\s+/g, ''));
            if (m && !tok) tok = m[1];
        });
        return [tok, last];
    }

    /* Подключение с телефона, по порядку:
     *  1) по домашней Wi-Fi напрямую в службу (v3, /pair/start): QR — http://<ip ТВ>:<порт>/p/<секрет>, страницу отдаёт
     *     служба, токен она сама проверяет и сохраняет; страница ждёт got в /pair/status. Без ntfy — без лимита 250/сутки.
     *  2) не открывается (телефон в другой сети, «изоляция клиентов» в роутере) — кнопка «Не открывается? Другой
     *     способ»; службы нет, она старая или /pair/start не удался — сразу: QR на docs/pair.html, токен через ntfy
     *     (основной и запасные серверы, зашифрован секретом из QR);
     *  3) вручную — поле токена в настройках. */
    var pairStarting = false;
    function pairPhone() {
        pairStop();
        var ctrl = 'settings_component';
        try { ctrl = Lampa.Controller.enabled().name; } catch (e) {}
        if (!(svc.up && (svc.v | 0) >= PAIR_LAN_V && svc.store === 'ok')) return pairShow(null, ctrl);
        if (pairStarting) return;
        pairStarting = true;
        var secret = Crypt.secret();
        svcAsk('POST', '/pair/start', { secret: secret }, function (st, j) {
            pairStarting = false;
            var ip = j && typeof j.ip === 'string' ? j.ip : '';
            if (st === 200 && j && j.ok && j.port > 0 && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return pairShow({ secret: secret, url: 'http://' + ip + ':' + j.port + '/p/' + secret }, ctrl);
            if (st === 200 && j && j.ok) svcAsk('POST', '/pair/stop', { secret: secret });   // адреса в сети нет — сервер не нужен
            log('подключение по Wi-Fi не открылось — через ntfy', st + (ip ? '' : ' без адреса'));
            pairShow(null, ctrl);
        }, 4000);
    }

    /** Окно подключения: lan — {secret, url} (по Wi-Fi через службу) или null (через ntfy и docs/pair.html). */
    function pairShow(lan, ctrl) {
        pairStop();
        // своя лёгкая страница на GitHub Pages (поле и кнопка) — веб-приложение ntfy на телефоне тяжёлое и тормозит;
        // токен она отправляет в ту же тему ntfy одним запросом
        // в адресе после # - тема и секрет: страница шифрует им токен, в кэше ntfy его не прочитать
        var topic = randomTopic(), secret = lan ? lan.secret : Crypt.secret();
        var url = lan ? lan.url : 'https://sunic007.github.io/lampa-samsung/pair.html#' + topic + '.' + secret;
        var body = $('<div class="bs-tg-pair"><div class="bs-tg-pair__side"><div class="bs-tg-pair__qr"></div>' +
            (lan ? '<div class="bs-tg-pair__hint">Телефон — в той же Wi-Fi, что и телевизор</div>' : '') + '</div><div class="bs-tg-pair__steps">' +
            '<p>1. В Telegram откройте <b>@BotFather</b> → <b>/newbot</b> → придумайте имя → нажмите на токен, чтобы скопировать.</p>' +
            '<p>2. Наведите камеру телефона на QR-код. На открывшейся странице вставьте токен и нажмите ' + (lan ? '«Отправить»' : '«Отправить на ТВ»') + '.</p>' +
            '<p>3. Напишите своему боту любое сообщение.</p>' +
            (lan ? '<p>Страница на телефоне не открывается? Нажмите «Другой способ» внизу.</p>' : '') +
            '<div class="bs-tg-pair__url"></div><div class="bs-tg-pair__status">Жду токен с телефона…</div></div></div>');
        body.find('.bs-tg-pair__url').text(url);
        try { Lampa.Utils.qrcode(url, body.find('.bs-tg-pair__qr')[0]); } catch (e) { log('qr', e.message); }
        var status = function (t) { body.find('.bs-tg-pair__status').text(t); };
        var win = null;
        var close = function () { pairStop(); modalClose(win, ctrl); };
        var other = function () { pairStop(); modalClose(win, ctrl, true); pairShow(null, ctrl); };   // QR через ntfy
        var mo = { title: 'Telegram — подключить с телефона', html: body, size: 'medium', onBack: close };
        if (lan) mo.buttons = [{ name: 'Не открывается? Другой способ', onSelect: other }];
        win = modalOpen(mo);
        var p = pair = { topic: topic, secret: secret, since: {}, ri: 0, until: Date.now() + PAIR_TIME, stage: 'token', busy: false, lan: !!lan };
        /* Токен подошёл (getMe): дальше одинаково — ждём первое сообщение боту. Токен в службе — тема канала ТВ тоже от
         * неё (svcDerive сам запускает канал); в localStorage — сначала в службу (svcMove). */
        var tokenOk = function (me) {
            if (me && me.username) lsSet('bs_tg_bot', me.username);
            p.stage = 'chat'; p.busy = false;
            if (svcTg()) { svc.d = null; svcDerive(function (ok) { if (ok) busSend({ t: 'who' }); }); }
            else { svcMove(); busStart(); busSend({ t: 'who' }); }          // токен подошёл — в службу; бот уже на другом ТВ — чат пришлёт он
            status('Токен получен ✓  Теперь напишите боту @' + me.username + ' любое сообщение');
        };
        /* По Wi-Fi: токен уже в службе (проверен и сохранён ею) — у страницы только метка, как после переноса. */
        var lanGot = function () {
            tokenDel();
            offsetReset();
            lsSet('bs_tg_chat', '');
            lsSet('bs_tg_svc', '1');
            svc.d = null;
            call('getMe', {}, function (me) { if (pair === p) tokenOk(me); },
                function (e) { p.busy = false; status('Токен у ТВ, но Telegram пока не отвечает (' + e + '). Пробую ещё раз…'); });
        };
        p.timer = setInterval(function () {
            if (pair !== p) return;
            if (Date.now() > p.until) { status('Время вышло — откройте подключение ещё раз'); return pairStop(); }
            if (p.busy) return;
            p.busy = true;
            if (p.stage === 'token' && p.lan) {
                svcAsk('GET', '/pair/status', undefined, function (st, j) {
                    if (pair !== p) return;
                    if (st === 200 && j && j.got) return lanGot();
                    p.busy = false;
                    if (st === 200 && j && !j.open) status('Подключение по Wi-Fi закрылось — нажмите «Другой способ» или откройте подключение ещё раз');
                }, 4000);
            } else if (p.stage === 'token') {
                pollRelay(p, function (tok, time, i) {
                    if (time) p.since[i] = time;                        // это сообщение больше не перечитываем (id)
                    if (!tok) { p.busy = false; return; }
                    offsetReset();
                    setToken(tok);
                    lsSet('bs_tg_chat', '');
                    call('getMe', {}, tokenOk, function (e) { p.busy = false; status('Токен не подошёл (' + e + '). Отправьте токен ещё раз'); });
                });
            } else {
                if (chat()) { p.busy = false; return pairDone(); }        // чат прислал главный ТВ
                call('getUpdates', {}, function (updates) {
                    p.busy = false;
                    var c = chatFrom(updates, users());
                    if (!c || pair !== p) return;
                    lsSet('bs_tg_chat', c);
                    pairDone();
                }, function () { p.busy = false; });
            }
        }, 3000);
        function pairDone() {
            if (pair !== p) return;
            pairStop();
            sendKb(L('✅ Lampa подключена.\n\n', '✅ Lampa is connected.\n\n', '✅ Lampa ulandi.\n\n') + help());
            langAskOnce();
            status('Готово! Telegram подключён ✓');
            refreshSettings();
            setCommands();
            busHello(true);
            check(false);
            setTimeout(close, 2500);
        }
    }

    /* ---------- ещё один ТВ: подключение по коду, без токена ----------
     * До 2.3.0 (v3, главный ТВ принимает и теперь; новый ТВ показывает 6 цифр — v4 ниже): код из 12 знаков (XXXX-XXXX-XXXX: цифры 2–9 и латинские буквы без похожих — I, L, O; ~59 бит)
     * и слушает тему ntfy, выведенную из него. Человек присылает код боту; ТВ, где бот уже работает, кладёт в эту тему
     * токен и чат, зашифрованные ключом из кода. Тема и ключ — из кода через PBKDF2 (JOIN_ITER шагов): по теме или
     * перехваченному сообщению код перебором не подобрать. Бот принимает сообщения только из своего чата, так что код
     * может прислать только хозяин. Прежний код из 8 цифр больше не принимаем. Та же схема — в service.js (/join). */
    var JOIN_ABC = '23456789ABCDEFGHJKMNPQRSTUVWXYZ', JOIN_LEN = 12, JOIN_ITER = 2000, JOIN_SALT = 'lampa-join-v3';

    /** 12 знаков из JOIN_ABC (Crypt.rnd; байты 248–255 отбрасываем — знаки равновероятны); хотя бы одна цифра и одна
     *  буква — так код не спутать с обычным словом или числом в сообщении (см. joinFrom). */
    function joinCode() {
        var c = '';
        while (!joinOk(c)) {
            c = '';
            while (c.length < JOIN_LEN) Crypt.rnd(24).forEach(function (b) { if (b < 248 && c.length < JOIN_LEN) c += JOIN_ABC.charAt(b % 31); });
        }
        return c;
    }
    function joinOk(c) { return c.length === JOIN_LEN && /^[2-9A-HJKMNP-Z]+$/.test(c) && /\d/.test(c) && /[A-Z]/.test(c); }
    /** Код на экране: XXXX-XXXX-XXXX. */
    function joinShow(c) { return c.slice(0, 4) + '-' + c.slice(4, 8) + '-' + c.slice(8); }
    /** Тема и ключ из кода (PBKDF2 считается один раз на код). */
    var joinKeysFor = '', joinKeysVal = null;
    function joinKeys(code) {
        if (code !== joinKeysFor) {
            var dk = Crypt.pbkdf(code, JOIN_SALT, JOIN_ITER);
            joinKeysFor = code;
            joinKeysVal = { topic: 'lampa-join-' + Crypt.hex(Crypt.hmac(dk, Crypt.bytes('topic'))).slice(0, 24), key: Crypt.hmac(dk, Crypt.bytes('key')) };
        }
        return joinKeysVal;
    }
    function joinTopic(code) { return joinKeys(code).topic; }
    /** Код из сообщения: 6 цифр («481 527») или прежний из 12 знаков — с дефисами или пробелами и без них, любыми буквами. */
    function joinFrom(t) {
        t = String(t || '');
        if (t.length > 40) return '';
        var c = t.replace(/[\s-]+/g, '').toUpperCase();
        if (/^\d{6}$/.test(c)) return c;
        return joinOk(c) ? c : '';
    }

    /* v4 (2.3.0): код — 6 цифр, как у CUB. Сам код ничего не шифрует: новый ТВ создаёт пару ключей X25519 и кладёт
     * открытый ключ в тему ntfy из кода ({t:'hi4', pk}). Главный ТВ, получив цифры в боте, читает тему на всех серверах:
     * ровно один ключ — шифрует токен и чат общим ключом X25519 (своя одноразовая пара, {t:'join4', epk, box}); прочитать
     * это может только тот ТВ, даже зная цифры. Ключей два и больше (кто-то подсунул свой) — отказ, нужен новый код;
     * ни одного — «ТВ с таким кодом нет». Старый код из 12 знаков (v3, ключ из кода) главный ТВ тоже принимает.
     * Та же схема — в service.js (/join). */
    var JOIN4_LEN = 6, JOIN4_SALT = 'lampa-join-v4', BASE9 = [9];
    while (BASE9.length < 32) BASE9.push(0);
    function join4Code() {
        var c = '';
        while (c.length < JOIN4_LEN) Crypt.rnd(12).forEach(function (b) { if (b < 250 && c.length < JOIN4_LEN) c += String(b % 10); });
        return c;
    }
    function join4Show(c) { return c.slice(0, 3) + ' ' + c.slice(3); }
    function join4Topic(code) { return 'lampa-join4-' + Crypt.hex(Crypt.sha256(Crypt.bytes(JOIN4_SALT + '|topic|' + code))).slice(0, 24); }
    function join4Key(code, pk, epk, sh) { return Crypt.sha256(Crypt.bytes(JOIN4_SALT + '|' + code + '|').concat(pk, epk, sh)); }
    function allZero(b) { var d = 0; for (var i = 0; i < b.length; i++) d |= b[i]; return d === 0; }
    function pk32(s) { try { var b = Crypt.unb64(s); return b.length === 32 ? b : null; } catch (e) { return null; } }
    /** Открытые ключи новых ТВ ({t:'hi4'}) из ответов ntfy — без повторов. */
    function join4Hellos(texts) {
        var seen = {}, out = [];
        texts.forEach(function (text) {
            String(text || '').split('\n').forEach(function (line) {
                var ev = null, m = null;
                try { ev = JSON.parse(line); m = JSON.parse(ev.message); } catch (e) { return; }
                if (!ev || ev.event !== 'message' || !m || m.t !== 'hi4' || typeof m.pk !== 'string' || !pk32(m.pk) || seen[m.pk]) return;
                seen[m.pk] = 1;
                out.push(m.pk);
            });
        });
        return out;
    }
    /** Главный ТВ: подключение для ТВ с ключом pk — {t:'join4', epk, box}; плохой ключ — null. */
    function join4Box(code, pkB64, payload) {
        var pk = pk32(pkB64), e = Crypt.rnd(32);
        if (!pk) return null;
        var epk = Crypt.x25519(e, BASE9), sh = Crypt.x25519(e, pk);
        if (allZero(sh)) return null;
        return { t: 'join4', epk: Crypt.b64(epk), box: Crypt.seal(join4Key(code, pk, epk, sh), payload) };
    }
    /** Новый ТВ: открыть join4 своим ключом — текст или null. */
    function join4Open(p, m) {
        var epk = pk32(m && m.epk);
        if (!epk) return null;
        var sh = Crypt.x25519(p.sk, epk);
        if (allZero(sh)) return null;
        return Crypt.open(join4Key(p.code, p.pk, epk, sh), m.box);
    }

    /** Сообщение с подключением из темы: {token, chat} или null. */
    function joinMsg(text, p) {
        var found = null, k = p && p.code && !p.sk ? joinKeys(p.code).key : null;
        String(text || '').split('\n').forEach(function (line) {
            var ev = null, m = null;
            try { ev = JSON.parse(line); } catch (e) { return; }
            if (!ev || ev.event !== 'message') return;
            if (p && ev.id) p.since = ev.id;                        // дальше — после этого сообщения (по id, не по часам ТВ)
            try { m = JSON.parse(ev.message); } catch (e) { return; }
            if (p && p.sk) {                                        // v4: только join4, открывается своим ключом (без sk — v3, ключ из кода)
                if (!m || m.t !== 'join4') return;
                try { m = JSON.parse(join4Open(p, m) || 'null'); } catch (e) { return; }
            } else if (k) { try { m = JSON.parse(Crypt.open(k, m) || 'null'); } catch (e) { return; } }   // зашифровано ключом из кода
            if (m && m.t === 'join' && TOKEN_RE.test(String(m.token || ''))) found = { token: String(m.token), chat: String(m.chat || '') };
        });
        return found;
    }

    /** long — прежний код из 12 знаков (v3): для главного ТВ, у которого служба ещё старая (пакет до 2.3.0). */
    function pairJoin(long) {
        pairStop();
        var code = long ? joinCode() : join4Code(), sk = long ? null : Crypt.rnd(32), pk = long ? null : Crypt.x25519(sk, BASE9);
        var body = $('<div class="bs-tg-pair"><div class="bs-tg-pair__steps">' +
            '<p>Telegram уже подключён на другом ТВ? Токен вводить не нужно.</p>' +
            '<p>1. На том ТВ должна быть запущена Lampa.</p><p>2. Отправьте своему боту код:</p>' +
            '<div class="bs-tg-join__code"></div><div class="bs-tg-pair__status">Жду код в боте…</div></div></div>');
        body.find('.bs-tg-join__code').text(long ? joinShow(code) : join4Show(code));
        var status = function (t) { body.find('.bs-tg-pair__status').text(t); };
        var ctrl = 'settings_component';
        try { ctrl = Lampa.Controller.enabled().name; } catch (e) {}
        var win = null;
        var close = function () { pairStop(); modalClose(win, ctrl); };
        var mo = { title: 'Telegram — подключить через бота', html: body, size: 'medium', onBack: close };
        // служба с подключением по Wi-Fi есть — QR для телефона тоже под рукой (токен вставить там)
        mo.buttons = [];
        if (svc.up && (svc.v | 0) >= PAIR_LAN_V && svc.store === 'ok') mo.buttons.push({ name: 'Подключить с телефона по Wi-Fi', onSelect: function () { close(); pairPhone(); } });
        if (!long) mo.buttons.push({ name: 'Длинный код (если бот просит)', onSelect: function () { close(); setTimeout(function () { pairJoin(true); }, 300); } });
        if (!mo.buttons.length) delete mo.buttons;
        win = modalOpen(mo);
        // since — сначала «за 2 минуты» по часам ntfy: часы ТВ могут спешить, и ответ отсеялся бы
        var p = pair = { topic: long ? joinTopic(code) : join4Topic(code), code: code, sk: sk, pk: pk, since: {}, ri: 0, until: Date.now() + PAIR_TIME, busy: false, start: Date.now(), helloAt: 0, helloOk: false };
        // свой открытый ключ — в тему кода; не приняли (нет связи, 429) — ещё раз через 20 с
        var hello = function () {
            if (!p.sk) { p.helloOk = true; return; }                  // длинный код — ключ не нужен
            p.helloAt = Date.now();
            relayPost(p.topic, JSON.stringify({ t: 'hi4', pk: Crypt.b64(p.pk), ts: Date.now() }), 0, function (st) { if (st > 0 && st < 300) p.helloOk = true; });
        };
        hello();
        p.timer = setInterval(function () {
            if (pair !== p) return;
            if (!p.helloOk && Date.now() - p.helloAt > 20000) hello();
            if (Date.now() > p.until) { status('Время вышло — откройте подключение ещё раз'); return pairStop(); }
            if (!p.hinted && Date.now() - p.start > 30000) {
                p.hinted = true;                                     // код никто не принял — бот сейчас никто не ведёт
                status('Ответа пока нет. Похоже, Lampa не запущена ни на одном подключённом ТВ — включите её там и отправьте код ещё раз (на том ТВ нужна Sunic Apps 2.3.0 или новее — она обновляется сама). Или подключите этот ТВ с телефона: «Подключить с телефона».');
            }
            if (p.busy) return;
            p.busy = true;
            // ответ главный ТВ кладёт в первый сервер, который его принял, — спрашиваем все по очереди
            var x = new XMLHttpRequest(), ri = relayTurn(p), q = { code: p.code, sk: p.sk, pk: p.pk, since: p.since[ri] || '2m' };
            try {
                x.open('GET', RELAYS[ri] + p.topic + '/json?poll=1&since=' + encodeURIComponent(q.since), true);
                x.timeout = TIMEOUT;
                x.onload = function () {
                    p.busy = false;
                    var m = x.status === 200 ? joinMsg(x.responseText, q) : null;
                    p.since[ri] = q.since;
                    if (!m || pair !== p) return;
                    offsetReset();
                    setToken(m.token);
                    lsSet('bs_tg_chat', m.chat);
                    svcMove();
                    pairStop();
                    status('Готово! Telegram подключён ✓');
                    refreshSettings();
                    busStart(); busHello(true);                         // главный пришлёт и список людей
                    send(L('✅ Подключён ещё один ТВ: «' + tvName() + '»', '✅ Another TV is connected: “' + tvName() + '”', "✅ Yana bir televizor ulandi: «" + tvName() + '»'), null, null, null);
                    setTimeout(close, 2500);
                };
                x.onerror = x.ontimeout = function () { p.busy = false; };
                x.send();
            } catch (e) { p.busy = false; }
        }, 3000);
    }

    /** Главный ТВ: код от человека -> токен и чат в тему нового ТВ. Токен в службе — шифрует и отправляет она (/join):
     *  только код, который сейчас пришёл боту из этого чата, — страница сама токен не получит. */
    function joinSend(code) {
        var done = keep(function (st) {
            if (st === 404) return reply(L('Не нашёл ТВ с кодом ' + join4Show(code) + '. Проверьте цифры на экране нового ТВ (код действует 15 минут).',
                'No TV with code ' + join4Show(code) + '. Check the digits on the new TV (the code works for 15 minutes).',
                join4Show(code) + " kodli televizor topilmadi. Yangi televizordagi raqamlarni tekshiring (kod 15 daqiqa amal qiladi)."));
            if (st === 409) return reply(L('С этим кодом откликнулись два ТВ — так подключать небезопасно. На новом ТВ откройте подключение заново и пришлите новый код.',
                'Two TVs answered this code — connecting is not safe. Reopen the connection on the new TV and send the new code.',
                "Bu kodga ikkita televizor javob berdi — ulash xavfsiz emas. Yangi televizorda ulanishni qayta oching va yangi kodni yuboring."));
            if (!st) return reply(L('Нет связи — отправьте код ещё раз.', 'No connection — send the code again.', "Aloqa yo'q — kodni qayta yuboring."));
            reply(st < 300 ? L('⏳ Передаю подключение на новый ТВ…', '⏳ Passing the connection to the new TV…', "⏳ Ulanishni yangi televizorga uzatyapman…")
                : L('Не получилось передать (' + st + ') — отправьте код ещё раз.', "Couldn't send it (" + st + ') — send the code again.', "Uzatib bo'lmadi (" + st + ") — kodni qayta yuboring."));
        });
        // 6 цифр, токен у страницы — ключ нового ТВ из темы кода, шифруем сами (токен в службе — она, /join)
        if (code.length === JOIN4_LEN && !svcTg()) return join4Send(code, done);
        // служба из пакета до 2.3.0 (v3) 6 цифр не знает, а код службы меняется только с новым .wgt — просим длинный код
        if (code.length === JOIN4_LEN && (svc.v | 0) < 4) return reply(L('Этот ТВ пока не умеет подключать по 6 цифрам — нужна новая установка Lampa через TV Installer. А сейчас: на новом ТВ нажмите «Длинный код» и пришлите его сюда.',
            "This TV can't connect by 6 digits yet — reinstall Lampa with TV Installer. For now: on the new TV press “Длинный код” (long code) and send it here.",
            "Bu televizor hozircha 6 raqam bilan ulay olmaydi — Lampa'ni TV Installer orqali qayta o'rnating. Hozir esa: yangi televizorda «Длинный код» ni bosing va uni shu yerga yuboring."));
        // токен у страницы — шифруем сами и кладём в первый сервер ntfy, который примет (новый ТВ слушает все)
        if (!svcTg()) return relayPost(joinTopic(code), JSON.stringify(Crypt.seal(joinKeys(code).key, JSON.stringify({ t: 'join', token: token(), chat: chat(), ts: Date.now() }))), 0,
            function (st) { done(st); });
        var x = new XMLHttpRequest();
        try {
            svcOpen(x, 'POST', SVC + '/join');                                // служба сама переходит на запасные серверы
            x.timeout = TIMEOUT * 4;
            x.onload = function () { done(x.status); };
            x.onerror = x.ontimeout = function () { done(0); };
            x.send(JSON.stringify({ code: code, chat: chat(), ts: Date.now() }));
        } catch (e) { reply(L('Не получилось: ', "Didn't work: ", "Bo'lmadi: ") + e.message); }
    }

    /** v4 со страницы: тема кода на всех серверах сразу; ровно один ключ — подключение туда. done(статус). */
    function join4Send(code, done) {
        var topic = join4Topic(code), texts = [], answered = 0, left = RELAYS.length;
        var go = function () {
            if (!answered) return done(0);
            var pks = join4Hellos(texts);
            if (!pks.length) return done(404);
            if (pks.length > 1) return done(409);
            var box = join4Box(code, pks[0], JSON.stringify({ t: 'join', token: token(), chat: chat(), ts: Date.now() }));
            if (!box) return done(409);
            relayPost(topic, JSON.stringify(box), 0, function (st) { done(st); });
        };
        RELAYS.forEach(function (r) {
            var x = new XMLHttpRequest(), ended = false, fin = function () { if (ended) return; ended = true; if (--left === 0) go(); };
            try {
                x.open('GET', r + topic + '/json?poll=1&since=15m', true);
                x.timeout = TIMEOUT;
                x.onload = function () { if (x.status === 200) { answered++; texts.push(x.responseText); } fin(); };
                x.onerror = x.ontimeout = fin;
                x.send();
            } catch (e) { fin(); }
        });
    }

    /* ---------- несколько людей: у каждого свои списки ----------
     * Владелец — первый подключивший бота: его «Хочу посмотреть» и подписки — это списки самой Lampa на ТВ. Другие
     * подключаются, наведя камеру на QR в поиске Lampa (t.me/бот?start=приглашение): у них свои «Хочу посмотреть»,
     * подписки, «напомнить завтра» и сводка — в bs_tg_users, видны только им в боте. Владельцу — «Подключился…» с
     * кнопкой «Отключить». Приглашение выводится из токена бота — одно на все ТВ, без синхронизации. */

    function users() { var u = lsJson('bs_tg_users', {}); return u && typeof u === 'object' ? u : {}; }
    function active(g) { return !!g && !g.banned && !g.pending; }
    /** Сохранить и разослать другим ТВ изменённых людей (ids). У записи rev — время правки: старое новое не затрёт. */
    function saveUsers(u, ids) {
        var now = Date.now();
        (ids || []).forEach(function (id) { if (u[id]) u[id].rev = now; });
        lsSet('bs_tg_users', JSON.stringify(u));
        (ids || []).forEach(function (id) { if (u[id]) busUser(id, u[id]); });
    }
    function guest() { if (isOwner()) return null; var g = users()[to()]; return active(g) ? g : null; }
    function updGuest(fn) { var u = users(), g = u[to()]; if (!active(g)) return; fn(g); saveUsers(u, [to()]); }
    function allowed(c) { c = String(c); return !!chat() && (c === chat() || active(users()[c])); }

    /* Канал ТВ (ntfy) берёт до 4 КБ на сообщение — запись человека идёт кусками {t:'u', id, rev, i, n, d}. */
    var USER_PART = 900, userParts = {};
    function busUser(id, g) {
        var str = JSON.stringify(g), n = Math.max(1, Math.ceil(str.length / USER_PART));
        for (var i = 0; i < n; i++) busSend({ t: 'u', id: id, rev: g.rev || 0, i: i, n: n, d: str.slice(i * USER_PART, (i + 1) * USER_PART) });
    }
    function onUserPart(m) {
        var k = m.id + ':' + m.rev;
        if (Object.keys(userParts).length > 50) userParts = {};
        var b = userParts[k] = userParts[k] || { got: 0, parts: [] };
        if (b.parts[m.i] === undefined) { b.parts[m.i] = String(m.d || ''); b.got++; }
        if (b.got < (m.n | 0)) return;
        delete userParts[k];
        var g = null;
        try { g = JSON.parse(b.parts.join('')); } catch (e) { return; }
        if (!g || typeof g !== 'object') return;
        if (g.name) g.name = cleanName(g.name);
        var all = users();
        if (all[m.id] && (all[m.id].rev || 0) >= m.rev) return;
        all[m.id] = g;
        lsSet('bs_tg_users', JSON.stringify(all));
    }
    function sendAllUsers() {
        var u = users(); for (var k in u) if (u.hasOwnProperty(k)) busUser(k, u[k]);
        var lm = langMap(); if (Object.keys(lm).length) busSend({ t: 'langs', map: lm, at: langAt() });
    }
    function inviteCode() {
        var t = token(), salt = lsGet('bs_tg_invite_salt') || '';
        if (!t && svcTg()) {                                         // токен в службе — код посчитала она (/derive)
            if (svc.d && svc.d.salt === salt) return svc.d.inv;
            if (!svc.deriving) svcDerive();
            return '';
        }
        return t ? fnv(t + '#invite' + salt, 2166136261) + fnv('#invite' + salt + t, 2166136261) : '';
    }
    /** Настройки бота владельца - общие для всех ТВ (ходят по каналу): одобрение новых людей, видео от гостей, приглашение. */
    function needApprove() { return on('bs_tg_approve', true); }
    function guestPlay() { return on('bs_tg_guest_play', true); }
    function cfgSend() { busSend({ t: 'cfg', approve: needApprove(), play: guestPlay(), salt: lsGet('bs_tg_invite_salt') || '' }); }
    function onCfg(m) {
        lsSet('bs_tg_approve', String(m.approve !== false));
        lsSet('bs_tg_guest_play', String(m.play !== false));
        if (typeof m.salt === 'string' && /^[a-z0-9]{0,32}$/.test(m.salt) && m.salt !== (lsGet('bs_tg_invite_salt') || '')) {
            lsSet('bs_tg_invite_salt', m.salt);
            if (svcTg()) svcDerive();                                // код приглашения — заново
        }
    }
    /** Новое приглашение: старые QR и ссылки перестают подключать. Уже подключённые остаются. */
    function inviteReset() {
        lsSet('bs_tg_invite_salt', Crypt.secret().slice(0, 12));
        if (svcTg()) svcDerive();
        cfgSend();
    }
    /** Карточка для списка человека — только нужное. */
    function mini(card, kind) {
        return { id: card.id, tv: kind === 't', name: String(card.name || card.title || '').slice(0, 60) };
    }
    /** Сериалы человека для уведомлений: подписки и «Хочу посмотреть» (только сериалы), без отписанных. */
    function guestTracked(g) {
        var out = [], seen = {}, muted = (g && g.muted) || [];
        ((g && g.subs) || []).concat((g && g.want) || []).forEach(function (c) {
            if (!c || !(c.id > 0) || !c.tv || seen[c.id] || muted.indexOf(String(c.id)) >= 0) return;
            seen[c.id] = 1;
            out.push(c);
        });
        return out;
    }
    /** Кому слать уведомления: владелец (его сериалы — как раньше) и каждый подключившийся. */
    function recipients() {
        var out = [{ c: '', owner: true, list: tracked() }], u = users();
        for (var k in u) if (u.hasOwnProperty(k) && active(u[k])) out.push({ c: k, owner: false, list: guestTracked(u[k]) });
        return out;
    }
    function trackedNow() { return isOwner() ? tracked() : guestTracked(guest()); }

    /* Чужим отвечаем не чаще раза в 10 минут на чат: кто шлёт боту сообщения пачками, не съест лимит Telegram на
     * отправку (и не завалит владельца запросами). Только в памяти — после перезапуска Lampa можно снова. */
    var STRANGER_GAP = 10 * 60000, strangerAt = {};
    function strangerOnce(c) {
        var now = Date.now();
        if (strangerAt[c] && now - strangerAt[c] < STRANGER_GAP) return false;
        strangerAt[c] = now;
        return true;
    }
    /** Чужой чат: приглашение из QR — подключить; иначе — подсказать, где QR. */
    function stranger(u, c) {
        var msg = u.message;
        if (!msg || typeof msg.text !== 'string' || !msg.chat || msg.chat.type !== 'private') return;
        var st = /^\/start(?:@\w+)?\s+(\S+)/.exec(msg.text);
        if (st && inviteCode() && st[1] === inviteCode()) {
            var name = cleanName([msg.from && msg.from.first_name, msg.from && msg.from.last_name].filter(Boolean).join(' ')) || 'Гость';
            var all = users();
            var allow = function () { return { text: L('✅ Разрешить', '✅ Allow', '✅ Ruxsat berish'), callback_data: 'ok:' + c }; };
            if (all[c] && all[c].banned) {                       // отключённый — снова только с разрешения владельца
                if (!strangerOnce(c)) return;
                as(c, function () { reply(L('Владелец отключил вас от Lampa. Я отправил ему запрос — когда разрешит, напишу.', "The owner disconnected you from Lampa. I've sent them a request — I'll let you know when they allow it.", "Bot egasi sizni Lampa'dan uzgan. Unga so'rov yubordim — ruxsat bersa, yozaman.")); });
                as('', function () { reply(L('👤 ' + name + ' хочет снова подключиться к Lampa.', '👤 ' + name + ' wants to connect to Lampa again.', "👤 " + name + " Lampa'ga qayta ulanmoqchi."), [[allow()]]); });
                return;
            }
            if (needApprove()) {
                if (all[c] && all[c].pending && Date.now() - (all[c].at || 0) < 3600000) {   // уже спросили - не заваливаем владельца
                    if (!strangerOnce(c)) return;
                    return as(c, function () { reply(L('⏳ Запрос уже отправлен владельцу — когда разрешит, напишу.', "⏳ Your request has already been sent to the owner — I'll let you know when they allow it.", "⏳ So'rov bot egasiga allaqachon yuborilgan — ruxsat bersa, yozaman.")); });
                }
                all[c] = { name: name, pending: true, at: Date.now() };
                saveUsers(all, [c]);
                as(c, function () { reply(L('⏳ Я спросил владельца бота — когда разрешит, напишу.', "⏳ I've asked the bot owner — I'll let you know when they allow it.", "⏳ Bot egasidan so'radim — ruxsat bersa, yozaman.")); });
                as('', function () {
                    reply(L('👤 ' + name + ' хочет подключиться к Lampa (через QR в поиске).', '👤 ' + name + ' wants to connect to Lampa (via the QR code in search).', "👤 " + name + " Lampa'ga ulanmoqchi (qidiruvdagi QR orqali)."),
                        [[allow(), { text: L('🚫 Отклонить', '🚫 Decline', '🚫 Rad etish'), callback_data: 'ku:' + c }]]);
                });
                log('просит подключиться', name);
                return;
            }
            all[c] = { name: name, at: Date.now(), want: [], subs: [], muted: [], later: [] };
            saveUsers(all, [c]);
            as(c, function () {
                sendKb(L('👋 ' + name + ', вы подключены к Lampa.\nУ вас свои «Хочу посмотреть» и подписки — другие их не видят.\n\n',
                    '👋 ' + name + ", you are connected to Lampa.\nYou have your own “Want to watch” and subscriptions — others can't see them.\n\n",
                    '👋 ' + name + ", siz Lampa'ga ulandingiz.\n«Ko'rmoqchiman» ro'yxatingiz va obunalaringiz faqat sizniki — boshqalar ularni ko'rmaydi.\n\n") + helpText());
                langAskOnce();
            });
            as('', function () { reply(L('👤 Новый пользователь: ' + name + ' (через QR-код в поиске Lampa). У него свои списки и уведомления.', '👤 New user: ' + name + ' (via the QR code in Lampa search). They have their own lists and notifications.', "👤 Yangi foydalanuvchi: " + name + " (Lampa qidiruvidagi QR-kod orqali). Uning o'z ro'yxatlari va bildirishnomalari bor."), [[{ text: L('🚫 Отключить', '🚫 Disconnect', '🚫 Uzish'), callback_data: 'ku:' + c }]]); });
            log('подключился', name);
            return;
        }
        if (!strangerOnce(c)) return;
        as(c, function () { reply(L('Этот бот — для Lampa на ТВ. Чтобы подключиться, наведите камеру телефона на QR-код в поиске Lampa.', 'This bot is for Lampa on a TV. To connect, point your phone camera at the QR code in Lampa search.', "Bu bot televizordagi Lampa uchun. Ulanish uchun telefon kamerasini Lampa qidiruvidagi QR-kodga qarating.")); });
    }

    /** q — открыто из настроек: показываем в том же сообщении. */
    function peopleList(q) {
        if (!isOwner()) return reply(L('Список людей видит только владелец бота.', 'Only the bot owner can see the list of people.', "Odamlar ro'yxatini faqat bot egasi ko'radi."));
        var u = users(), ids = Object.keys(u).filter(function (i) { return active(u[i]); });
        var waiting = Object.keys(u).filter(function (i) { return u[i] && u[i].pending; });
        var rows = ids.slice(0, 10).map(function (i) { return [{ text: '🚫 ' + u[i].name, callback_data: 'ku:' + i }]; });
        waiting.slice(0, 5).forEach(function (i) { rows.push([{ text: '✅ ' + u[i].name, callback_data: 'ok:' + i }, { text: L('🚫 Отклонить', '🚫 Decline', '🚫 Rad etish'), callback_data: 'ku:' + i }]); });
        rows.push([{ text: (needApprove() ? '✅' : '⬜') + L(' Новые — с моего разрешения', ' New people — with my approval', " Yangilar — mening ruxsatim bilan"), callback_data: 'cfg:ap' }]);
        rows.push([{ text: (guestPlay() ? '✅' : '⬜') + L(' Гости включают видео на ТВ', ' Guests can play videos on the TV', " Mehmonlar TV'da video yoqa oladi"), callback_data: 'cfg:play' }]);
        rows.push([{ text: L('🔄 Сменить приглашение (QR)', '🔄 Reset invite (QR)', "🔄 Taklifni yangilash (QR)"), callback_data: 'cfg:inv' }]);
        var text = ids.length ? L('👥 Ботом также пользуются:\n', '👥 Also using the bot:\n', "👥 Botdan yana bular foydalanadi:\n") + ids.map(function (i) { return '• ' + u[i].name; }).join('\n') +
            L('\n\nНажмите на имя, чтобы отключить человека.', '\n\nTap a name to disconnect that person.', '\n\nUzish uchun ismni bosing.')
            : L('👥 Кроме вас ботом пока никто не пользуется.\nДругие подключаются, наведя камеру телефона на QR-код в поиске Lampa на ТВ.',
                '👥 Nobody else uses the bot yet.\nOthers connect by pointing their phone camera at the QR code in Lampa search on the TV.',
                "👥 Sizdan boshqa hali hech kim botdan foydalanmaydi.\nBoshqalar telefon kamerasini televizordagi Lampa qidiruvidagi QR-kodga qaratib ulanadi.");
        if (waiting.length) text += L('\n\n⏳ Ждут разрешения: ', '\n\n⏳ Waiting for approval: ', '\n\n⏳ Ruxsat kutayotganlar: ') + waiting.map(function (i) { return u[i].name; }).join(', ');
        rows.push(backRow());
        screen(q, text, rows);
    }

    /** Человек (не владелец): «Хочу посмотреть», убрать, подписаться — в его списках. */
    function guestAction(act, card, kind, name, answer) {
        var m = mini(card, kind);
        var other = function (c) { return !(c && c.id == m.id && !!c.tv === m.tv); };
        updGuest(function (g) {
            if (act === 'x') g.want = (g.want || []).filter(other);
            else if (act === 'w') g.want = [m].concat((g.want || []).filter(other)).slice(0, 100);
            else if (act === 's') {
                g.subs = [m].concat((g.subs || []).filter(other)).slice(0, 100);
                g.muted = (g.muted || []).filter(function (x) { return x !== String(m.id); });
            }
        });
        answer(act === 'x' ? wantRemoved(name) : act === 'w' ? wantAdded(name) : subAdded(name));
    }
    function wantRemoved(name) { return L('✖ «' + name + '» убран из «Хочу посмотреть»', '✖ “' + name + '” removed from “Want to watch”', "✖ «" + name + "» «Ko'rmoqchiman»dan olib tashlandi"); }
    function wantAdded(name) { return L('⭐ «' + name + '» — в «Хочу посмотреть»', '⭐ “' + name + '” added to “Want to watch”', "⭐ «" + name + "» — «Ko'rmoqchiman»ga qo'shildi"); }
    function subAdded(name) { return L('🔔 Подписка на «' + name + '»', '🔔 Subscribed to “' + name + '”', "🔔 «" + name + "»ga obuna bo'ldingiz"); }
    function watchBtn(k, id) { return { text: L('▶️ Смотреть', '▶️ Watch', "▶️ Ko'rish"), callback_data: 'v:' + k + ':' + id }; }
    function openBtn(k, id) { return { text: L('📺 Открыть на ТВ', '📺 Open on TV', "📺 TV'da ochish"), callback_data: 'o:' + k + ':' + id }; }

    /* ---------- записи Shots → Telegram ----------
     * Shots (плагин CUB): кнопка «Записать» в плеере — момент до 5 мин; CUB обрабатывает его и шлёт событие
     * shots_status {id, status: 'ready', file, screen}. Готовая запись — сразу в бот: видео (не взял Telegram — кадр со
     * ссылкой), фильм, серия и момент, кнопки «▶️ Смотреть» и «📺 Открыть на ТВ». Переслать — обычной пересылкой. */
    function clock(sec) {
        sec = Math.max(0, Math.round(+sec || 0));
        var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60;
        return (h ? h + ':' + ('0' + m).slice(-2) : m) + ':' + ('0' + x).slice(-2);
    }
    function shotCaption(info, tv) {
        info = info || {};
        var ep = info.season > 0 && info.episode > 0 ? L(' — ' + info.season + ' сезон, ' + info.episode + ' серия', ' — season ' + info.season + ', episode ' + info.episode, ' — ' + info.season + '-fasl, ' + info.episode + '-qism') : '';
        var at = info.start_point > 0 ? L(' (с ', ' (from ', ' (') + clock(info.start_point) + L(')', ')', '-dan boshlab)') : '';
        var yr = info.card_year && info.card_year !== '----' ? ' (' + info.card_year + ')' : '';
        return L('🎬 Запись из «' + (info.card_title || 'фильма') + '»', '🎬 Clip from “' + (info.card_title || 'a movie') + '”', "🎬 «" + (info.card_title || 'film') + "»dan lavha") + yr + ep + at +
            L('\nЗаписано на ТВ «' + tv + '». Переслать друзьям — как обычное видео в Telegram.', '\nRecorded on TV “' + tv + '”. You can forward it to friends like any other video.',
                "\n«" + tv + "» televizorida yozib olindi. Uni do'stlaringizga oddiy video kabi uzatishingiz mumkin.");
    }
    function onShot(e) {
        if (!e || e.status !== 'ready' || !e.file || !on('bs_tg_shots', true) || !hasToken() || !chat()) return;
        var sent = lsJson(SHOTS_SENT, []);
        if (Object.prototype.toString.call(sent) !== '[object Array]') sent = [];
        if (sent.indexOf(String(e.id)) >= 0) return;
        sent.unshift(String(e.id));
        lsSet(SHOTS_SENT, JSON.stringify(sent.slice(0, 100)));
        var info = null;
        try { (Lampa.Storage.get('shots_created', '[]') || []).forEach(function (x) { if (x && x.id == e.id) info = x; }); } catch (x) {}
        info = info || {};
        var kind = info.card_type === 'tv' ? 't' : 'm', caption = shotCaption(info, tvName());
        var buttons = info.card_id > 0 ? [[watchBtn(kind, info.card_id), openBtn(kind, info.card_id)]] : null;
        var asLink = function (why) {
            log('запись — видео не принято, шлю ссылку', why);
            send(caption + '\n▶️ ' + e.file, e.screen || null, null, function (er) { log('запись не отправлена', er); }, buttons);
        };
        var p = { chat_id: chat(), video: e.file, caption: caption, supports_streaming: 'true' };
        if (e.screen) p.thumbnail = e.screen;
        if (buttons) p.reply_markup = JSON.stringify({ inline_keyboard: buttons });
        call('sendVideo', p, function () { log('запись в Telegram', e.id); }, asLink, 60000);
    }

    /* Список уже отправленных записей. До 1.7.63 он лежал в bs_tg_shots — в том же ключе, что переключатель «Записи
     * Shots — в Telegram»: список затирал «вкл» (функция молча выключалась), а «вкл» ломал список (onShot падал).
     * shotsMigrate: список — в свой ключ, переключатель — снова по умолчанию (вкл.). Явное «выкл.» не трогаем. */
    var SHOTS_SENT = 'bs_tg_shots_sent';
    function shotsMigrate() {
        var v = lsGet('bs_tg_shots');
        if (v === null || v === 'true' || v === 'false') return;
        if (lsGet(SHOTS_SENT) === null && v.charAt(0) === '[') lsSet(SHOTS_SENT, v);
        try { window.localStorage.removeItem('bs_tg_shots'); } catch (e) {}
    }

    /** Готовые записи, которые прошли мимо (Lampa закрыли, пока CUB их обрабатывал), — прислать. Первый раз — только
     *  запомнить уже сделанные, старые в чат не сыплем. */
    function shotsSweep() {
        var created = [];
        try { created = Lampa.Storage.get('shots_created', '[]') || []; } catch (e) {}
        if (lsGet(SHOTS_SENT) === null) return lsSet(SHOTS_SENT, JSON.stringify(created.map(function (x) { return String(x && x.id); }).slice(0, 100)));
        created.forEach(function (x) { if (x && x.status === 'ready' && x.file) onShot({ id: x.id, status: 'ready', file: x.file, screen: x.screen }); });
    }

    /* ---------- QR бота в поиске Lampa ----------
     * Под клавиатурой поиска: бот подключён — QR на него (t.me/имя): найти с телефона, «Открыть на ТВ» — откроется
     * здесь; не подключён — одна строка, где подключить. Не выбирается пультом — клавиатуре не мешает. */

    function botName(cb) {
        var n = lsGet('bs_tg_bot');
        if (n || !hasToken()) return cb(n || '');
        call('getMe', {}, function (me) { if (me && me.username) lsSet('bs_tg_bot', me.username); cb((me && me.username) || ''); }, function () { cb(''); });
    }
    /** Экранная клавиатура поиска: набрали текст и ушли вниз (история, источники, результаты) - прячется, результаты
     *  поднимаются наверх; вернулись к вводу - появляется снова. Lampa сама её не прячет. Контроллер клавиатуры в
     *  Lampa называется 'keybord'. */
    function searchKeypad() {
        if (searchKeypad.on || !Lampa.Controller || !Lampa.Controller.listener) return;
        searchKeypad.on = true;
        Lampa.Controller.listener.follow('toggle', function (e) {
            try {
                var body = $('body'), input = $('.search .search__input');
                if (!body.hasClass('search--open')) return body.removeClass('bs-kb-hidden');
                var typed = input.hasClass('filled') && $.trim(input.text()) !== '';
                body.toggleClass('bs-kb-hidden', !!typed && e.name !== 'keybord' && e.name !== 'search');
            } catch (x) {}
        });
    }

    function searchQr() {
        if (!on('bs_search_qr', true)) return;
        var body = $('.search .search__body').first();
        if (!body.length || body.find('.bs-search-tg').length) return;
        var box = $('<div class="bs-search-tg"><div class="bs-search-tg__qr"></div><div class="bs-search-tg__text"></div></div>');
        // ниже истории и вкладок источников: сразу под строкой поиска - история, как в Lampa
        var under = body.find('.search__sources');
        if (under.length) under.after(box); else body.append(box);
        var text = function (t) { box.find('.bs-search-tg__text').text(t); };
        if (!hasToken() || !chat()) {
            box.addClass('bs-search-tg--off');
            return text('📱 Искать можно и с телефона — подключите Telegram-бот: Настройки → Sunic Apps → Telegram-бот.');
        }
        botName(function (n) {
            if (!n) { box.addClass('bs-search-tg--off'); return text('📱 Искать с телефона: напишите своему Telegram-боту название — «Открыть на ТВ» откроет фильм здесь.'); }
            try { Lampa.Utils.qrcode('https://t.me/' + n + (inviteCode() ? '?start=' + inviteCode() : ''), box.find('.bs-search-tg__qr')[0]); } catch (e) { box.addClass('bs-search-tg--off'); }
            text('📱 Искать с телефона: наведите камеру — откроется бот @' + n + '. Напишите название или пришлите скриншот, «📺 Открыть на ТВ» — фильм откроется здесь. У каждого, кто подключится, свои «Хочу посмотреть» и подписки.');
        });
    }

    /* ---------- несколько ТВ: общий канал ntfy.sh ---------- */

    // Кто ведёт бота, решает сам Telegram: опрашивать может один — новый getUpdates обрывает прежний ответом «409 занято».
    // Получивший 409 уступает (yieldHold) и сам больше не опрашивает. Уходя (ТВ выключают, Lampa в фоне), главный шлёт
    // «bye» — другие берут бота сразу. Главного выдернули из розетки («bye» нет) — уступивший видит по getWebhookInfo, что
    // апдейты копятся, и берёт бота через минуту-полторы (watchTick); запасной путь — главный молчит дольше LEADER_ALIVE.
    // ntfy.sh бесплатно — 250 сообщений в сутки на один интернет-адрес (ТВ, телефон и гости дома — один адрес). «Я здесь»
    // каждые 40 с съедало их за 3 часа, и дальше не проходили ни QR-подключение (429), ни команды между ТВ. Теперь «я здесь»
    // по таймеру — только если на боте есть другие ТВ, раз в 20 минут; уход — сразу («bye»), так что передача бота не ждёт.
    var HELLO_EVERY = 20 * 60000, LEADER_ALIVE = 25 * 60000, CONFLICT_PAUSE = 60000, STALE_UPDATE = 180;
    // Telegram ответил «занято» (409) — значит, бота прямо сейчас опрашивает другой ТВ, он жив. До LEADER_ALIVE после
    // этого не перехватываем: иначе два ТВ берут сообщения по очереди, и разрешение гостя, данное на одном, другой
    // ещё не знает (1.7.56–1.7.61: гость «разрешён», а «Меню» отвечает как незнакомому).
    var lastConflictAt = 0;
    // Уступили бота (два 409 подряд): сами больше не опрашиваем — иначе раз в CONFLICT_PAUSE отнимали бы его у живого
    // главного, а он у нас (пинг-понг). Снимается: главный ушёл («bye»), Telegram показал, что апдейты копятся (watch),
    // главный молчит дольше LEADER_ALIVE, Lampa снова на экране, свой удачный опрос. ТВ на боте один — не действует.
    var yieldHold = false;
    var DEVICE_ALIVE = 70 * 60000, ACK_WAIT = 10000;
    var tvId = lsGet('bs_tv_id');
    if (!tvId) { tvId = randomTopic().slice(6, 14); lsSet('bs_tv_id', tvId); }
    var devices = {}, leader = { id: '', at: 0 }, isLeader = false, conflictUntil = 0, acks = {};

    function tvName() {
        var n = String(lsGet('bs_tv_name') || '').replace(/^\s+|\s+$/g, '');
        if (n) return n;
        try { n = String(Lampa.Storage.get('device_name', '') || ''); } catch (e) {}
        if (n && n !== 'Lampa') return n;
        n = String(lsGet('bs_tv_devname') || '');
        return n || 'ТВ ' + tvId.slice(0, 3).toUpperCase();
    }
    /** Имя телевизора из него самого: «Имя устройства» Samsung (Общие → Диспетчер системы), без «[TV] ». */
    function cleanDevName(j) {
        var d = (j && j.device) || {}, n = String(d.name || j && j.name || '').replace(/^\s*\[TV\]\s*/i, '').replace(/^\s+|\s+$/g, '');
        return n.slice(0, 40);
    }
    function loadDevName() {
        try { if (window.BSDevice && !BSDevice.samsung()) return; } catch (e) {}   // имя отдаёт только ТВ Samsung (приложение или MSX)
        var x = new XMLHttpRequest();
        try {
            x.open('GET', 'http://127.0.0.1:8001/api/v2/', true);
            x.timeout = 8000;
            x.onload = function () {
                var j = null;
                try { j = JSON.parse(x.responseText); } catch (e) {}
                var n = cleanDevName(j), was = lsGet('bs_tv_devname') || '';
                if (j && j.device && j.device.modelName) lsSet('bs_tv_model', String(j.device.modelName));
                if (n && n !== was) { lsSet('bs_tv_devname', n); busHello(false); }
            };
            x.send();
        } catch (e) {}
    }
    /** Подпись ТВ в списке: одинаковые имена различаем моделью или кусочком id. */
    function tvLabels(list) {
        var count = {};
        list.forEach(function (d) { count[d.name] = (count[d.name] || 0) + 1; });
        return list.map(function (d) {
            var extra = count[d.name] > 1 ? ' · ' + (d.model && list.filter(function (o) { return o.name === d.name && o.model === d.model; }).length === 1 ? d.model : d.id.slice(0, 3).toUpperCase()) : '';
            // старая Lampa (до 1.7.18) не присылает адрес — не умеет пульт и переименование, пусть будет видно
            var old = d.id !== tvId && (!d.ip || (d.v && verNum(d.v) < verNum(appVer())));
            // Lampa там закрыта (ответила служба): откроется по команде; экран выключен — картинки не будет, пока не включат
            var closed = d.svc ? (d.pw === 'standby' ? L(' (экран выключен)', ' (screen off)', " (ekran o'chiq)") : L(' (Lampa закрыта)', ' (Lampa closed)', ' (Lampa yopiq)')) : '';
            return { id: d.id, ip: d.ip, old: old, text: '📺 ' + d.name + extra + (old ? L(' (старая Lampa)', ' (old Lampa)', ' (eski Lampa)') : closed) };
        });
    }
    function myIp() { try { return String(webapis.network.getIp() || ''); } catch (e) { return ''; } }
    /** Все ТВ: этот первым, потом включённые. */
    function allTvs() {
        var me = tvLabels([{ id: tvId, name: tvName(), model: lsGet('bs_tv_model') || '', ip: myIp() }].concat(otherTvs()));
        if (me[0] && screenOff()) me[0].text += L(' (экран выключен)', ' (screen off)', " (ekran o'chiq)");
        return me;
    }
    /* Экран этого ТВ (служба спрашивает сам ТВ, порт 8001): standby — выключен пультом, Lampa работает «в темноте».
     * Тогда «▶️ Включаю» без оговорки сбивает с толку — человек ждёт картинку. Кэш на SCREEN_TTL, обновляется сам. */
    var tvScreen = { st: '', at: 0 }, SCREEN_TTL = 20000, queuedTv = false;
    function screenOff() { return tvScreen.st === 'standby' && Date.now() - tvScreen.at < SCREEN_TTL; }
    /** fresh — спросить сейчас (кнопка «на ТВ»: ТВ могли только что включить), иначе — кэш SCREEN_TTL. */
    function screenCheck(cb, fresh) {
        if (!svc.up || (svc.v | 0) < 3) { if (cb) cb(''); return; }
        if (!fresh && Date.now() - tvScreen.at < SCREEN_TTL) { if (cb) cb(tvScreen.st); return; }
        svcAsk('GET', '/power', undefined, function (st, j) {
            if (st === 200 && j && j.ok) tvScreen = { st: String(j.state || ''), at: Date.now() };
            if (cb) cb(tvScreen.st);
        }, 5000);
    }
    /** 32-битный FNV-1a: тема канала из токена — без токена не угадать, сам токен в канал не попадает. */
    function fnv(str, h) {
        for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24); h = h >>> 0; }
        return ('0000000' + h.toString(16)).slice(-8);
    }
    function busTopic() {
        var t = token();
        if (!t) return svcTg() && svc.d ? svc.d.topic : '';         // токен в службе — тема от неё
        return 'lampa-tv-' + fnv(t, 2166136261) + fnv(t + '#', 2166136261);
    }

    /** Ключ канала из токена: без токена сообщение не прочитать и не подделать. */
    var busKeyFor = '', busKeyVal = null;
    function busKey() {
        var t = token();
        if (!t) return svcTg() && svc.d ? svc.d.key : null;
        if (t !== busKeyFor) { busKeyFor = t; busKeyVal = t ? Crypt.key('lampa-bus-v2|' + t) : null; }
        return busKeyVal;
    }
    /* Сервер канала ТВ. Публикуем в запомненный (bs_tg_relay, номер в RELAYS; нет — ntfy.sh); не принял (429 — суточный
     * лимит на IP, 5xx, нет связи) — в следующий, и принявший запоминаем. Слушаем запомненный и ntfy.sh. ТВ одного дома
     * упираются в один лимит (IP общий) и сами переходят туда же; а если сообщение пришло по ntfy.sh от ТВ, который
     * нас не слышит, — говорим ему, где мы ({t: 'relay'}; каждому ТВ — не чаще раза в 6 часов: старая Lampa его не
     * понимает, а лимит ntfy.sh тратить нельзя), и он переходит. */
    function busRelay() { var i = parseInt(lsGet('bs_tg_relay'), 10); return i > 0 && i < RELAYS.length ? i : 0; }
    /** Перейти на сервер i. Сами перешли (прежний не принял) — сказать об этом ({t: 'relay'}) на ntfy.sh и на прежнем:
     *  другие ТВ слушают свой запомненный сервер и ntfy.sh — услышат хоть там и перейдут следом. quiet — перешли, потому
     *  что сказал другой ТВ: не повторяем (иначе два ТВ, сменившие сервер одновременно, перекидывали бы друг друга). */
    function relaySet(i, quiet) {
        var was = busRelay();
        if (i === was) return;
        if (i > 0) lsSet('bs_tg_relay', String(i)); else lsDel('bs_tg_relay');
        log('канал ТВ — через ' + RELAYS[i], '');
        busStart();
        if (quiet) return;
        busSend({ t: 'relay', r: i }, 0);
        if (was !== 0) busSend({ t: 'relay', r: i }, was);
    }
    var relayTold = {}, RELAY_TELL_GAP = 6 * 3600000;
    /** Сообщение от ТВ from пришло по серверу i, а мы публикуем в другой: он нас не слышит — сказать ему, где мы. */
    function relayTell(i, from) {
        var cur = busRelay(), now = Date.now();
        if (cur === i || now - (relayTold[from] || 0) < RELAY_TELL_GAP) return;
        relayTold[from] = now;
        busSend({ t: 'relay', r: cur }, i);
    }
    /** at — только этот сервер (без перехода на запасные). */
    function busSend(obj, at) {
        var topic = busTopic(), k = busKey();
        if (!topic || !k) return;
        obj.from = tvId; obj.ts = Date.now();
        var one = typeof at === 'number', body;
        try { body = JSON.stringify(Crypt.seal(k, JSON.stringify(obj))); } catch (e) { return; }
        relayPost(topic, body, one ? at : busRelay(), function (st, i) {
            if (i < 0) return log('канал ТВ: ни один сервер ntfy не принял', st);
            if (!one) relaySet(i);
        }, one);
    }
    /** Сообщение канала: зашифрованное нашим ключом - разбираем; повтор (тот же nonce) и старше суток - мимо.
     *  Незашифрованное - мимо целиком: тему канала видит любой, кто подсмотрел запрос, и поддельное «hello» с большой
     *  версией (newerOnline) или «bye» главного остановило бы опрос на всех ТВ. Открытым текстом писали только Lampa
     *  до 1.7.49 — их всё равно нужно обновить (oldWarn). */
    var busSeen = {}, busSeenN = 0;
    function busOpen(raw) {
        var m = null;
        try { m = JSON.parse(raw); } catch (e) { return null; }
        if (m && m.z === 2) {
            if (busSeen[m.n]) return null;
            var t = Crypt.open(busKey(), m);
            if (!t) return null;
            if (++busSeenN > 500) { busSeen = {}; busSeenN = 0; }
            busSeen[m.n] = 1;
            try { m = JSON.parse(t); } catch (e) { return null; }
            if (!m || (m.ts && Math.abs(Date.now() - m.ts) > 86400000)) return null;
            return m;
        }
        return null;
    }
    function appVer() { try { return window.BS_REMOTE_VERSION || (typeof BS_PACKAGE_VERSION !== 'undefined' ? String(BS_PACKAGE_VERSION) : ''); } catch (e) { return ''; } }
    function onScreen() { try { return !document.hidden; } catch (e) { return true; } }
    function busHello(ask) { busSend({ t: 'hello', v: appVer(), name: tvName(), model: lsGet('bs_tv_model') || '', ip: myIp(), leader: isLeader, fg: onScreen(), chat: chat(), ask: !!ask }); }
    /** Главный молчит дольше LEADER_ALIVE (или его вовсе нет) - бота можно брать. */
    function leaderStale() {
        var now = Date.now();
        return !isLeader && (!leader.id || now - leader.at > LEADER_ALIVE) && now - lastConflictAt > LEADER_ALIVE;
    }
    /** 409 от Telegram: бота ведёт другой ТВ — ждём CONFLICT_PAUSE и считаем главного живым. */
    function onConflict() {
        if (isLeader) log('главный теперь другой ТВ', '');
        isLeader = false;
        lastConflictAt = Date.now();
        conflictUntil = lastConflictAt + CONFLICT_PAUSE;
        yieldHold = true;
    }
    /** Бота ведёт другой ТВ, мы уступили — не опрашиваем. Других ТВ не знаем — это была своя служба: как раньше. */
    function held() { return yieldHold && !isLeader && (othersKnown() > 0 || peersOnScreen() > 0); }
    /** Очередь на бота: сколько ТВ на экране с свежим «я здесь» и меньшим id. 0 - берём первым. */
    function takeoverRank() {
        var now = Date.now(), rank = 0, k;
        for (k in devices) if (devices.hasOwnProperty(k) && devices[k].fg && now - devices[k].at < LEADER_ALIVE && k < tvId) rank++;
        return rank;
    }

    /* Failover по самому Telegram, без канала ntfy (его лимит — 250 сообщений в сутки). getWebhookInfo не мешает чужому
     * getUpdates (409 не будет) и говорит, сколько апдейтов ждёт (pending_update_count). Главный жив и опрашивает — их 0:
     * Telegram отдаёт апдейт сразу, следующий опрос его подтверждает. Главного выдернули из розетки (без «bye») — копятся.
     * Уступивший ТВ (held) раз в WATCH_EVERY спрашивает: больше 0 на проверках подряд дольше WATCH_SPAN, и «занято» за это
     * время не было — главный пропал, берём бота (через минуту-полторы, а не через LEADER_ALIVE). Очередь — как в
     * takeoverRank, но без самого главного: каждый ТВ на экране впереди — ещё WATCH_RANK_GAP (взял он — апдейты снова 0,
     * и мы не берём); плюс случайные доли секунды. ТВ на боте один — не спрашиваем вовсе (held — нет). Lampa скрыта —
     * то же делает служба (service.js, loop.takeover). Недавно видели 0 (WATCH_ZERO) — главный опрашивает: «молчит
     * дольше LEADER_ALIVE» (пропали «я здесь» в ntfy) бота не отнимает. */
    var WATCH_EVERY = 30000, WATCH_SPAN = 45000, WATCH_RANK_GAP = 60000, WATCH_ZERO = 2 * 60000;
    var watch = { at: 0, since: 0, zeroAt: 0, busy: false, n: 0 };
    var RECLAIM_EVERY = 3 * 60000, reclaimAt = 0;
    /** Главный — живой ТВ с Lampa на экране (его «я здесь» с fg, не служба). */
    function leaderOnScreen() {
        var d = leader.id ? devices[leader.id] : null;
        return !!d && !d.svc && !!d.fg && Date.now() - leader.at < LEADER_ALIVE;
    }
    function watchRank() {
        var now = Date.now(), rank = 0, k;
        for (k in devices) if (devices.hasOwnProperty(k) && k !== leader.id && devices[k].fg && now - devices[k].at < LEADER_ALIVE && k < tvId) rank++;
        return rank;
    }
    function watchTick() {
        if (watch.busy) return;
        if (!held() || polling || pair || svc.away || !hasToken() || !chat()) { watch.since = 0; return; }
        var now = Date.now();
        // мы на экране, а главный — нет (его Lampa закрыта и бота держит его служба, или о нём ничего не слышно): бот
        // должен быть у того, кто на экране. Раз в RECLAIM_EVERY берём сами — служба на «занято» сразу уступает; живой
        // главный на экране (его «я здесь» с fg) не трогаем. Иначе служба спящего ТВ держала бота часами (2026-10-22)
        if (onScreen() && !leaderOnScreen() && now - lastConflictAt > RECLAIM_EVERY && now - reclaimAt > RECLAIM_EVERY) {
            reclaimAt = now; watch.since = 0;
            log('главный не на экране — беру бота', leader.id || '?');
            yieldHold = false; conflictUntil = 0;
            return setTimeout(poll, 300 + Math.floor(Math.random() * 1500));
        }
        if (now - watch.at < WATCH_EVERY - 1000) return;                 // не чаще 2 раз в минуту
        watch.at = now; watch.busy = true; watch.n++;
        call('getWebhookInfo', {}, function (w) {
            watch.busy = false;
            var n = w && typeof w.pending_update_count === 'number' ? w.pending_update_count : -1, t = Date.now();
            if (n < 0) return;
            if (n === 0) { watch.since = 0; watch.zeroAt = t; return; }
            if (!watch.since || lastConflictAt >= watch.since) { watch.since = t; return; }   // первый раз (или было «занято») — ждём
            if (!held() || t - watch.since < WATCH_SPAN + watchRank() * WATCH_RANK_GAP) return;
            watch.since = 0;
            log('главный ТВ не опрашивает бота (апдейты копятся) — беру', String(n));
            yieldHold = false; conflictUntil = 0;
            setTimeout(poll, 300 + Math.floor(Math.random() * 1500));
        }, function () { watch.busy = false; }, 15000);
    }

    /* Поток канала: на каждом слушаемом сервере (busRelay и ntfy.sh) один длинный запрос (ntfy шлёт сообщения
     * построчно); раз в 30 мин — заново, чтобы ответ не рос. Одно и то же сообщение с двух серверов не разберём дважды
     * (busSeen по nonce). since — свой у каждого сервера (id сообщений у них разные). */
    var busNow = '', busS = {}, busSince = {};
    function streamStop(s) { clearTimeout(s.timer); clearTimeout(s.life); s.timer = s.life = null; if (s.x) { var x = s.x; s.x = null; try { x.abort(); } catch (e) {} } }
    function busStop() { for (var k in busS) if (busS.hasOwnProperty(k)) streamStop(busS[k]); busS = {}; busNow = ''; }
    function busStart() {
        var topic = busTopic();
        if (!topic) return busStop();
        if (busNow !== topic) busStop();
        busNow = topic;
        var want = busRelay() ? [busRelay(), 0] : [0], k;
        for (k in busS) if (busS.hasOwnProperty(k) && want.indexOf(+k) < 0) { streamStop(busS[k]); delete busS[k]; }
        want.forEach(function (i) {
            if (!busS[i]) busS[i] = { i: i, x: null, pos: 0, timer: null, life: null };
            if (!busS[i].x && !busS[i].timer) streamGo(busS[i]);
        });
    }
    function streamGo(s) {
        clearTimeout(s.timer); clearTimeout(s.life); s.timer = s.life = null;
        if (busS[s.i] !== s || !busNow) return;
        s.pos = 0;
        var x = s.x = new XMLHttpRequest(), again = function (ms) { s.timer = setTimeout(function () { s.timer = null; streamGo(s); }, ms); };
        try {
            x.open('GET', RELAYS[s.i] + busNow + '/json?since=' + (busSince[s.i] || Math.floor(Date.now() / 1000) - 120), true);
            x.onprogress = function () { if (s.x === x) busRead(x, s); };
            x.onload = x.onerror = x.onabort = function () {
                if (s.x !== x) return;
                busRead(x, s);
                s.x = null;
                clearTimeout(s.life); s.life = null;
                again(x.status === 429 ? 60000 : 5000);                 // сервер сказал «слишком часто» — не долбим
            };
            x.send();
            s.life = setTimeout(function () { if (s.x === x) { s.x = null; try { x.abort(); } catch (e) {} streamGo(s); } }, 30 * 60000);
        } catch (e) { s.x = null; again(15000); }
    }
    function busRead(x, s) {
        var text = '';
        try { text = x.responseText || ''; } catch (e) { return; }
        var chunk = text.slice(s.pos), nl = chunk.lastIndexOf('\n');
        if (nl < 0) return;
        s.pos += nl + 1;
        chunk.slice(0, nl).split('\n').forEach(function (line) {
            var ev = null, m = null;
            try { ev = JSON.parse(line); } catch (e) { return; }
            if (!ev || ev.event !== 'message') return;
            busSince[s.i] = ev.id || busSince[s.i];
            m = busOpen(ev.message);
            if (!m) return;
            if (m.from && m.from !== tvId && m.t !== 'relay') relayTell(s.i, String(m.from));
            try { onBus(m); } catch (e) { log('канал', e.message); }
        });
    }

    function onBus(m) {
        if (!m || !m.t || !m.from || m.from === tvId) return;
        var now = Date.now();
        if (m.name) {
            tvsNote(m.from);
            var dv = devices[m.from] || {};
            // svc — за ТВ отвечает его служба (Lampa там закрыта), pw — его экран (on / standby); их несёт только «я здесь»
            devices[m.from] = { name: cleanName(m.name), at: now, model: m.model || dv.model || '', ip: m.ip || dv.ip || '', v: m.v || dv.v || '',
                svc: m.t === 'hello' ? !!m.svc : !!dv.svc, pw: m.t === 'hello' ? String(m.pw || '') : dv.pw || '' };
            if (m.t === 'hello') oldWarn(m.from);
        }
        if (m.t === 'hello') {
            if (renameWait && renameWait.to === m.from && m.name === renameWait.title) {
                var rw = renameWait;
                clearTimeout(rw.timer); renameWait = null;
                as(rw.chat, function () { reply(renamed(m.name)); });
            }
            if (m.leader) leader = { id: m.from, at: now };
            if (devices[m.from]) devices[m.from].fg = !!m.fg;
            if (m.chat && !chat()) { lsSet('bs_tg_chat', String(m.chat)); refreshSettings(); }
            if (m.ask) busHello(false);
            if (m.ask && isLeader) { sendAllUsers(); cfgSend(); }                   // новый/включившийся ТВ — люди от главного
        } else if (m.t === 'who') { busHello(false); if (m.users) sendAllUsers(); }
        else if (m.t === 'relay') { var ri = m.r | 0; if (ri >= 0 && ri < RELAYS.length) relaySet(ri, true); }   // другой ТВ публикует туда — и мы
        else if (m.t === 'bye') {                                      // ТВ ушёл (выключили, Lampa в фоне)
            delete devices[m.from];
            if (leader.id === m.from) leader = { id: '', at: 0 };
            if (m.lead !== false) { conflictUntil = 0; yieldHold = false; setTimeout(poll, 300 + Math.floor(Math.random() * 1500)); }   // вёл бота — взять сейчас
        }
        else if (m.t === 'u' && m.id && m.rev) onUserPart(m);
        else if (m.t === 'cfg') onCfg(m);
        else if (m.t === 'lang' && m.id) putLang(String(m.id), m.l, m.at | 0 || 1);
        else if (m.t === 'langs' && m.map && typeof m.map === 'object') {
            var k2, ats = m.at && typeof m.at === 'object' ? m.at : {};
            for (k2 in m.map) if (m.map.hasOwnProperty(k2)) putLang(k2, m.map[k2], ats[k2] || 1);
        }
        else if (m.t === 'rename' && m.to === tvId && cleanName(m.title)) { lsSet('bs_tv_name', cleanName(m.title)); busHello(false); refreshSettings(); }
        else if (m.t === 'open' && m.to === tvId && now - (m.ts || 0) < 60000) openHere(m.k, m.id, m.ref, !!m.play, !!m.g, m.n);
        else if (m.t === 'type' && m.to === tvId && now - (m.ts || 0) < 60000) {
            var why = typedText(m.text) ? typeHere(typedText(m.text)) : 'пустой текст';
            if (m.ref) busSend({ t: 'ack', ref: m.ref, ok: !why, why: why, name: tvName() });
        }
        else if (m.t === 'ack' && m.ref && acks[m.ref]) { var a = acks[m.ref]; delete acks[m.ref]; a(m); }
        else if (m.t === 'sub' && m.card && m.card.id) setSub(m.card, !!m.on, null);
        else if (m.t === 'seen' && m.id) {
            var all = loadSeen(), r = all[m.id] || {};
            r.s = m.s | 0; r.e = m.e | 0; r.at = r.at || now;
            all[m.id] = r;
            lsSet('bs_tg_seen', JSON.stringify(trimSeen(all)));
        } else if (m.t === 'qw' && Object.prototype.toString.call(m.list) === '[object Array]') {
            lsSet('bs_tg_qwait', JSON.stringify(m.list.slice(0, QWAIT_MAX)));
        } else if (m.t === 'today' && m.tag) {
            var done = lsJson('bs_tg_today', []);
            if (done.indexOf(m.tag) < 0) { done.unshift(m.tag); lsSet('bs_tg_today', JSON.stringify(done.slice(0, 200))); }
        }
    }

    /* Разные версии Lampa на ТВ: бота ведёт тот, кто успел, — старая версия не знает новых кнопок («▶️ Смотреть» и
     * т.п.), нажатие пропадает. Поэтому ТВ уступает бота включённому ТВ с более новой Lampa, а владельцу один раз
     * пишем, где обновить. Совсем старые (до 1.7.33) этого правила не знают — их нужно обновить. */
    function verNum(v) { var m = /(\d+)\.(\d+)\.(\d+)/.exec(String(v || '')); return m ? +m[1] * 1e6 + +m[2] * 1e3 + +m[3] : 0; }
    function newerOnline() {
        var mine = verNum(appVer()), now = Date.now(), k;
        if (!mine) return false;
        for (k in devices) if (devices.hasOwnProperty(k) && !devices[k].svc && now - devices[k].at < 30 * 60000 && verNum(devices[k].v) > mine) return true;
        return false;
    }
    function oldWarn(id) {
        var d = devices[id], mine = verNum(appVer());
        if (!d || !isLeader || !mine || !d.v || verNum(d.v) >= mine) return;
        var tag = id + '@' + d.v, warned = lsJson('bs_tg_oldwarn', []);
        if (warned.indexOf(tag) >= 0) return;
        warned.unshift(tag);
        lsSet('bs_tg_oldwarn', JSON.stringify(warned.slice(0, 50)));
        var dv = String(d.v).replace(/-debug$/, ''), here = String(appVer()).replace(/-debug$/, '');
        as('', function () {
            reply(L('⚠️ На ТВ «' + d.name + '» старая Lampa ' + dv + ' (на этом — ' + here + '). Пока её не обновить, тот ТВ иногда перехватывает бота, и новые кнопки («▶️ Смотреть» и другие) не работают. Обновите на нём Lampa.',
                '⚠️ TV “' + d.name + '” has an old Lampa ' + dv + ' (this one has ' + here + "). Until it's updated, that TV sometimes takes over the bot, and new buttons (“▶️ Watch” and others) don't work. Please update Lampa on it.",
                "⚠️ «" + d.name + "» televizorida eski Lampa " + dv + ' (bunda — ' + here + "). U yangilanmaguncha ba'zan botni o'ziga oladi va yangi tugmalar («▶️ Ko'rish» va boshqalar) ishlamaydi. Undagi Lampa'ni yangilang."));
        });
    }

    /** Другие включённые ТВ (отзывались за последний час). */
    function otherTvs() {
        var out = [], now = Date.now(), k;
        for (k in devices) if (devices.hasOwnProperty(k) && now - devices[k].at < DEVICE_ALIVE) out.push({ id: k, name: devices[k].name, model: devices[k].model, ip: devices[k].ip, v: devices[k].v, svc: devices[k].svc, pw: devices[k].pw });
        out.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
        return out;
    }
    /** Главный — этот ТВ (только он шлёт уведомления; один ТВ — всегда он). */
    function leading() { return isLeader || !(leader.id && leader.id !== tvId && Date.now() - leader.at < LEADER_ALIVE); }
    /** Подписка — и всем ТВ. */
    function setSubAll(card, on, info) {
        setSub(card, on, info);
        busSend({ t: 'sub', on: on, card: { id: card.id, name: card.name || card.title || '', original_name: card.original_name || '', poster_path: card.poster_path || '', source: card.source || 'tmdb', first_air_date: card.first_air_date || '' } });
    }

    /** Открыть карточку на этом ТВ (команда с главного или свой выбор). */
    /* «▶️ Смотреть» из бота: открыть карточку и самим нажать на ней «Смотреть» (кнопка bsmenu.js или «Онлайн» Skaz).
     * Дальше — как с пульта: сериал — с той серии, где остановились, новый фильм — сразу в русской озвучке (bscontinue). */
    var watchFor = null;
    /* Пока на ТВ идёт видео, карточку открыть нельзя: её перекрыл бы плеер. Запрос владельца не отбрасываем,
     * а ставим в очередь - когда плеер закроют, бот откроет карточку сам. Гостям очереди нет: видео смотрит
     * владелец, гость получает отказ. */
    var afterVideo = null, AFTER_VIDEO_MAX = 10 * 60000;
    function tvPlaying() { try { return !!Lampa.Player.opened(); } catch (e) { return false; } }
    function whenVideoEnds(run) { afterVideo = { run: run, at: Date.now() }; }
    function onVideoClosed() {
        if (asking) asking(true);                               // видео кончилось, пока висел вопрос, — откроем сейчас
        var w = afterVideo;
        afterVideo = null;
        if (w && Date.now() - w.at < AFTER_VIDEO_MAX) setTimeout(keep(function () { w.run(); }), 1500);
    }
    /* Во время видео запрос из бота не ставим в очередь молча: на ТВ спрашиваем того, кто смотрит, — «Имя отправил(а)
     * фильм «…»: открыть сейчас или после этого видео» (владелец, 2026-10-25). Никто не ответил за минуту — в очередь. */
    var asking = null, ASK_WAIT = 60000;
    function senderName() { if (isOwner()) return ownerName(); var g = users()[to()]; return (g && g.name) || 'Гость'; }
    function askDuringVideo(who, kind, title, now, later) {
        if (asking) asking();                                   // прошлый вопрос ещё висит — тот запрос в очередь
        var ctrl = '', done = false, timer;
        try { ctrl = Lampa.Controller.enabled().name; } catch (e) {}
        var finish = function (fn) {
            if (done) return;
            done = true; asking = null; clearTimeout(timer);
            try { if (ctrl) Lampa.Controller.toggle(ctrl); } catch (e) {}
            fn();
        };
        // shut — меню уже убрал сам плеер (видео кончилось): Select.close не зовём
        asking = function (shut) { if (!shut) try { Lampa.Select.close(); } catch (e) {} finish(later); };
        timer = setTimeout(asking, ASK_WAIT);
        try {
            Lampa.Select.show({
                title: esc(who + ' отправил(а) ' + (kind === 't' ? 'сериал' : 'фильм') + (title ? ' «' + title + '»' : '')),
                items: [{ title: '▶️ Открыть сейчас', now: true }, { title: '⏳ После этого видео' }],
                onSelect: function (a) { finish(a && a.now ? now : later); },
                onBack: function () { finish(later); }
            });
        } catch (e) { log('спросить на ТВ', e.message); finish(later); }
    }
    /** «Открыть сейчас»: закрыть плеер и открыть. То, что уже стояло в очереди, ждёт конца следующего видео. */
    function stopVideo(open) {
        var w = afterVideo;
        afterVideo = null;
        try { Lampa.Player.close(); } catch (e) {}
        afterVideo = null;
        setTimeout(keep(function () {
            if (w && !afterVideo) afterVideo = { run: w.run, at: Date.now() };
            open();
        }), 700);
    }
    /** Запрос во время видео: спросить на ТВ. tell('ask' | 'later') — что написать отправителю. */
    function videoAsk(card, kind, open, tell) {
        var title = card.title || card.name || card.original_title || card.original_name || '';
        tell('ask');
        askDuringVideo(senderName(), kind, title, keep(function () { stopVideo(open); }),
            keep(function () { tell('later'); whenVideoEnds(open); }));
    }
    /* Заставка Lampa — слой поверх всего (z-index 10000), и сама она снимается только от пульта или мыши: карточку и
     * плеер бот открывал под ней, на экране оставалась заставка (владелец, 2026-10-25). Снимаем её сами. */
    function wakeScreen() {
        try { if (Lampa.Screensaver && Lampa.Screensaver.isWorked()) Lampa.Screensaver.stopSlideshow(); else if (Lampa.Screensaver) Lampa.Screensaver.resetTimer(); } catch (e) { }
    }
    function pushCard(card, kind, play) {
        wakeScreen();
        // карточка у нас грузится и по 30–60 с (TMDB через прокси, Lampa только открылась): ждём её дольше — иначе на ТВ
        // оставалось кольцо загрузки, а «Смотреть» никто не нажимал (2026-10-23)
        watchFor = play ? { id: card.id, until: Date.now() + 90000 } : null;
        Lampa.Activity.push({ url: '', component: 'full', id: card.id, method: kind === 't' ? 'tv' : 'movie', card: card, source: 'tmdb' });
    }
    function onFullWatch(e) {
        if (!watchFor || !e || e.type !== 'complite' || !e.body || Date.now() > watchFor.until) return;
        var card = e.data && e.data.movie;
        if (!card || card.id != watchFor.id) return;
        watchFor = null;
        var tries = 0;
        (function click() {
            var b = e.body.find('.bs-watch').first();
            if (!b.length) e.body.find('.buttons--container > .full-start__button').each(function () {
                var x = $(this);
                if (!b.length && (x.hasClass('lampac--button') || /^(Онлайн|Online)$/i.test($.trim(x.text())))) b = x;
            });
            if (b.length) {
                log('смотреть сразу', card.id);
                window.BS_BOT_PLAY = { id: card.id, until: Date.now() + 60000 };   // сериал без памяти — с 1-й серии (bscontinue)
                wakeScreen();   // карточка грузилась до 90 с — заставка могла включиться снова
                return b.trigger('hover:enter');
            }
            if (++tries < 40) setTimeout(click, 300);
            else noty('Нажмите «Смотреть» на карточке', 4000);
        })();
    }

    function openHere(kind, id, ref, play, guest, who) {
        var ack = function (ok, why, wait) { if (ref) busSend({ t: 'ack', ref: ref, ok: ok, why: why || '', name: tvName(), wait: !!wait }); };
        tmdbGet((kind === 't' ? 'tv/' : 'movie/') + id, function (j) {
            if (j === BLOCKED || (j && j.bs_blocked)) return ack(false, 'заблокирован по просьбе правообладателя');
            if (!j || !j.id) return ack(false, 'TMDB не ответил');
            var card = toCard(j, kind), again = function () { openHere(kind, id, ref, play, guest, who); };
            if (tvPlaying()) {                                  // имя отправителя пришло с другого ТВ (старый ТВ его не шлёт)
                ack(true, 'спрашиваю на ТВ: открыть сейчас или после видео', true);
                return askDuringVideo(cleanName(String(who || '')) || (guest ? 'Гость' : ownerName()), kind, card.title || card.name || '',
                    function () { stopVideo(again); },
                    function () { ack(true, 'откроется, когда закончится видео', true); whenVideoEnds(again); });
            }
            try {
                pushCard(card, kind, play);
                ack(true);
            } catch (e) { ack(false, e.message); }
        });
    }

    /* ---------- новые серии ---------- */

    function epKey(s, e) { return (s | 0) * 10000 + (e | 0); }

    /** Новая ли серия: prev — {s, e} из прошлой проверки (нет — сериал впервые), last — last_episode_to_air TMDB. */
    function isNew(prev, last, now) {
        if (!prev || !last) return false;
        var s = last.season_number | 0, e = last.episode_number | 0;
        if (!s || !e || epKey(s, e) <= epKey(prev.s, prev.e)) return false;
        var air = Date.parse(last.air_date || '');
        return air > 0 && (now || Date.now()) - air <= FRESH;
    }

    /** Сериалы: закладки Lampa и то, что смотрели (bs_resume). Только каталог TMDB/CUB (id — TMDB). */
    function tracked() {
        var out = [], seen = {};
        var add = function (c) {
            if (!c || !(c.id > 0) || seen[c.id]) return;
            var src = String(c.source || 'tmdb');
            if (src !== 'tmdb' && src !== 'cub') return;
            if (!(c.name || c.original_name || c.number_of_seasons || c.first_air_date)) return;     // только сериалы
            seen[c.id] = 1;
            out.push(c);
        };
        BOOKMARKS.forEach(function (type) { try { (Lampa.Favorite.get({ type: type }) || []).forEach(add); } catch (e) {} });
        try { (window.BSContinue && BSContinue._load ? BSContinue._load() : []).forEach(function (r) { add(r.card); }); } catch (e) {}
        subs().forEach(add);
        var muted = mutedList();
        return out.filter(function (c) { return muted.indexOf(String(c.id)) < 0; });
    }

    /** Не больше 300 сериалов: самые давние (по at) выбрасываем. */
    function trimSeen(all) {
        var ids = Object.keys(all || {});
        if (ids.length <= 300) return all;
        ids.sort(function (x, y) { return ((all[y] || {}).at || 0) - ((all[x] || {}).at || 0); });
        var out = {};
        ids.slice(0, 300).forEach(function (k) { out[k] = all[k]; });
        return out;
    }
    function loadSeen() { try { return JSON.parse(lsGet('bs_tg_seen') || '{}') || {}; } catch (e) { return {}; } }

    var running = false;
    function check(force, report) {
        if (running || !on('bs_tg_on', true) || !hasToken() || !chat() || !Lampa.TMDB || !Lampa.Reguest) return;
        if (!leading()) { if (report) noty('Уведомления шлёт главный ТВ: ' + ((devices[leader.id] || {}).name || 'другой'), 3500); return; }
        var seen = loadSeen(), now = Date.now(), sent = 0, pool = [], have = {};
        recipients().forEach(function (r) { r.list.forEach(function (c) { if (!have[c.id]) { have[c.id] = 1; pool.push(c); } }); });
        var list = pool.filter(function (c) { var r = seen[c.id] || {}; return force || r.name === undefined || now - (r.at || 0) > CHECK_EVERY; }).slice(0, MAX);
        if (!list.length) { if (report) noty('Новых серий нет', 2500); return; }
        running = true;
        (function next() {
            var c = list.shift();
            if (!c) {
                running = false;
                log('проверено, новых', sent);
                if (report) noty(sent ? 'Отправлено новых серий: ' + sent : 'Новых серий нет', 3000);
                return;
            }
            var url = Lampa.TMDB.api('tv/' + c.id + '?api_key=' + Lampa.TMDB.key() + '&language=ru');
            new Lampa.Reguest().silent(url, function (json) {
                var last = json && json.last_episode_to_air, all = loadSeen(), prev = all[c.id];
                var fresh = !!(last && isNew(prev, last, Date.now()));
                // новая серия станет «увиденной», только когда сообщение ушло хоть кому-то: не ушло (429, сеть) —
                // остаётся прежняя, и следующая проверка (через CHECK_EVERY) пришлёт её снова, а не потеряет
                var nx = json && json.next_episode_to_air;
                all[c.id] = {
                    s: last && !fresh ? last.season_number | 0 : prev ? prev.s : 0, e: last && !fresh ? last.episode_number | 0 : prev ? prev.e : 0, at: Date.now(),
                    name: (json && json.name) || c.name || c.title || '', poster: (json && json.poster_path) || '',
                    next: nx && nx.air_date ? { s: nx.season_number | 0, e: nx.episode_number | 0, d: nx.air_date } : null
                };
                lsSet('bs_tg_seen', JSON.stringify(trimSeen(all)));
                if (fresh) {
                    var name = json.name || c.name || c.title || '', sNo = last.season_number | 0, eNo = last.episode_number | 0, marked = false;
                    var epName = last.name && !/^(серия|episode)\s*\d+$/i.test(last.name) ? ' — ' + last.name : '';
                    var poster = json.poster_path ? 'https://image.tmdb.org/t/p/w500' + json.poster_path : null;
                    var mark = function () {
                        if (marked) return;
                        marked = true; sent++;
                        var a = loadSeen(), r0 = a[c.id] || { at: Date.now() };
                        if (epKey(sNo, eNo) > epKey(r0.s, r0.e)) { r0.s = sNo; r0.e = eNo; }
                        a[c.id] = r0;
                        lsSet('bs_tg_seen', JSON.stringify(trimSeen(a)));
                        busSend({ t: 'seen', id: c.id, s: sNo, e: eNo });
                    };
                    if (tracked().some(function (x) { return x.id == c.id; }))
                        tvBell('ep:' + c.id + ':' + sNo + ':' + eNo, name, 'Вышла новая серия: сезон ' + sNo + ', серия ' + eNo + epName, bellCard(c.id, name, json.poster_path, true));
                    recipients().forEach(function (r) {
                        if (!r.list.some(function (x) { return x.id == c.id; })) return;
                        as(r.c, function () {
                            var text = L('🎬 Вышла новая серия\n', '🎬 New episode is out\n', '🎬 Yangi qism chiqdi\n') + name + '\n' + seEp(last.season_number, last.episode_number) + epName;
                            send(text, poster, mark, function (e) { log('не отправлено', e); }, epButtons(c.id));
                        });
                    });
                }
                setTimeout(next, 1200);
            }, function () { setTimeout(next, 1200); });
        })();
    }

    /* ---------- «Сегодня выходит», «Напомнить завтра», сводка на неделю ---------- */

    function lsJson(k, def) { try { var v = JSON.parse(lsGet(k) || 'null'); return v === null ? def : v; } catch (e) { return def; } }
    function mutedList() { return lsJson('bs_tg_muted', []); }
    function dayStr(t) { var d = new Date(t); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
    function posterUrl(p) { return p ? 'https://image.tmdb.org/t/p/w500' + p : null; }

    /* Колокольчик Lampa на ТВ: то же событие, что ушло в бот (новая серия, «сегодня выходит», хорошее качество), — ещё
     * и в список уведомлений Lampa (Lampa.Notice.pushNotice('lampa', …): колокольчик в шапке, ОК — карточка). Нет
     * Notice — короткое всплывающее Lampa.Bell.push. Только события владельца ТВ, по-русски, как весь интерфейс ТВ;
     * одно на событие: ключ помним в bs_bell_seen (у Notice ещё и свой id). Нет API (старая Lampa) — только бот. */
    var BELL_MAX = 200;
    function bellSeen() { var l = lsJson('bs_bell_seen', []); return Object.prototype.toString.call(l) === '[object Array]' ? l : []; }
    function tvBell(key, title, text, card) {
        try {
            if (!key || typeof Lampa === 'undefined' || !Lampa) return false;
            var N = Lampa.Notice, B = Lampa.Bell;
            var list = !!(N && typeof N.pushNotice === 'function'), pop = !!(B && typeof B.push === 'function');
            if (!list && !pop) return false;
            var seen = bellSeen();
            if (seen.indexOf(key) >= 0) return false;
            lsSet('bs_bell_seen', JSON.stringify([key].concat(seen).slice(0, BELL_MAX)));
            if (list) {
                var el = { id: 'bs_' + key, from: 'Sunic Apps', title: esc(title), text: esc(text), time: Date.now() };
                if (card && card.id) { el.card = card; if (card.poster_path) el.poster = card.poster_path; }
                N.pushNotice('lampa', el, function () {}, function (e) { log('колокольчик', e); });
            } else B.push({ text: esc(title + ' — ' + text), from: 'Sunic Apps' });
            return true;
        } catch (e) { log('колокольчик', e.message); return false; }
    }
    /** Карточка для уведомления: ОК в списке Lampa открывает её (tv — с number_of_seasons, иначе Lampa откроет фильм). */
    function bellCard(id, name, poster, tv) {
        var c = { id: +id || id, source: 'tmdb' };
        if (tv) { c.name = name || ''; c.number_of_seasons = 1; } else c.title = name || '';
        if (poster) c.poster_path = poster;
        return c;
    }
    var WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
    var WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], WEEKDAYS_UZ = ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh'];
    /** «Сезон 2, серия 5» на языке того, кому пишем. */
    function seEp(s, e) { return L('Сезон ' + s + ', серия ' + e, 'Season ' + s + ', episode ' + e, s + '-fasl, ' + e + '-qism'); }
    function weekHead() { return L('🗓 На этой неделе выходят\n', '🗓 Coming out this week\n', '🗓 Bu hafta chiqadiganlar\n'); }

    /** Сводка: серии с датой выхода в ближайшие 7 дней (от today, полночь) — строки по дате. */
    function weekLines(seen, ids, today) {
        var out = [], wd = L(WEEKDAYS, WEEKDAYS_EN, WEEKDAYS_UZ), mon = L(MONTHS, MONTHS_EN, MONTHS_UZ);
        ids.forEach(function (id) {
            var r = seen[id], n = r && r.next;
            if (!n || !n.d) return;
            var p = n.d.split('-'), t = new Date(+p[0], +p[1] - 1, +p[2]).getTime();
            if (t < today || t >= today + 7 * 86400000) return;
            out.push({ t: t, line: wd[new Date(t).getDay()] + ' ' + (+p[2]) + ' ' + mon[+p[1] - 1] + ' — ' + (r.name || '') + ' ' + n.s + '×' + n.e });
        });
        out.sort(function (a, b) { return a.t - b.t; });
        return out.map(function (x) { return '• ' + x.line; });
    }
    /** Понедельник недели, в которую попадает t — ключ «сводка этой недели уже была». */
    function weekKey(t) { var d = new Date(t), back = (d.getDay() + 6) % 7; return dayStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime()); }

    function weekText(all) {
        var seen = loadSeen(), ids = trackedNow().map(function (c) { return String(c.id); }), d0 = new Date();
        var lines = weekLines(seen, ids, new Date(d0.getFullYear(), d0.getMonth(), d0.getDate()).getTime());
        return lines.length ? weekHead() + lines.slice(0, 20).join('\n') : (all ? L('🗓 На этой неделе новых серий у ваших сериалов нет.', '🗓 No new episodes of your series this week.', "🗓 Bu hafta seriallaringizning yangi qismlari yo'q.") : '');
    }

    /* Несколько сообщений в один чат — не пачкой, а через SPACING: Telegram пускает в один чат примерно одно сообщение
     * в секунду, чаще — «слишком часто» (429). jobs — функции, уже обёрнутые keep (у каждой свой чат). */
    var SPACING = 1100;
    function spaced(jobs) {
        (function next() {
            var f = jobs.shift();
            if (!f) return;
            f();
            if (jobs.length) setTimeout(next, SPACING);
        })();
    }
    /* Напоминание не ушло (429, сеть) — вернуть его, чтобы следующий remind (через 10 минут) отправил снова, а не
     * потерял. Вызываются из ответа Telegram — в контексте чата (keep). */
    function todayBack(tag) {
        var l = lsJson('bs_tg_today', []), i = l.indexOf(tag);
        if (i >= 0) { l.splice(i, 1); lsSet('bs_tg_today', JSON.stringify(l)); }
    }
    function laterBack(x) {
        var same = function (y) { return y && y.id === x.id; };
        if (isOwner()) { var l = lsJson('bs_tg_later', []); if (!l.some(same)) { l.push(x); lsSet('bs_tg_later', JSON.stringify(l.slice(-50))); } }
        else updGuest(function (g) { if (!(g.later || []).some(same)) g.later = (g.later || []).concat([x]); });
    }
    function weekBack(wk, prev) {
        if (isOwner()) { if (lsGet('bs_tg_week') === wk) lsSet('bs_tg_week', prev || ''); }
        else updGuest(function (g) { if (g.week === wk) g.week = prev || ''; });
    }

    function remind() {
        if (!on('bs_tg_on', true) || !hasToken() || !chat() || !leading()) return;
        var now = Date.now(), hour = new Date(now).getHours(), seen = loadSeen();
        var done = lsJson('bs_tg_today', []), today = dayStr(now), changed = false, people = users(), peopleChanged = [], queues = [];
        recipients().forEach(function (r) {
            var ids = r.list.map(function (c) { return String(c.id); }), g = r.owner ? null : people[r.c], jobs = [];
            if (!r.owner && !active(g)) return;
            queues.push(jobs);
            as(r.c, function () {
                // утром в день выхода (метка владельца — как раньше, у остальных — с номером чата); метку ставим сразу,
                // чтобы не отправить дважды, другим ТВ сообщаем, когда ушло, не ушло — метку снимаем
                if (hour >= 8) ids.forEach(function (id) {
                    var x = seen[id], n = x && x.next;
                    if (!n || n.d !== today) return;
                    var tag = (r.owner ? '' : r.c + '@') + id + ':' + n.s + ':' + n.e;
                    if (done.indexOf(tag) >= 0) return;
                    done.unshift(tag); changed = true;
                    if (r.owner) tvBell('today:' + id + ':' + n.s + ':' + n.e, x.name || '', 'Сегодня выходит: сезон ' + n.s + ', серия ' + n.e, bellCard(id, x.name, x.poster, true));
                    jobs.push(keep(function () {
                        send(L('📅 Сегодня выходит\n', '📅 Out today\n', '📅 Bugun chiqadi\n') + (x.name || '') + '\n' + seEp(n.s, n.e), posterUrl(x.poster),
                            function () { busSend({ t: 'today', tag: tag }); }, function () { todayBack(tag); }, [[epButtons(id)[0][0]]]);
                    }));
                });
                // «напомнить завтра»
                var later = r.owner ? lsJson('bs_tg_later', []) : (g.later || []), keepL = later.filter(function (x) { return x.at > now; });
                later.filter(function (x) { return x.at <= now; }).forEach(function (x) {
                    var y = seen[x.id] || {};
                    jobs.push(keep(function () {
                        send(L('⏰ Напоминание\n', '⏰ Reminder\n', '⏰ Eslatma\n') + (y.name || x.name || '') + (y.s ? L(' — вышла серия ', ' — episode out: ', ' — chiqqan qism: ') + y.s + '×' + y.e : ''), posterUrl(y.poster),
                            null, function () { laterBack(x); });
                    }));
                });
                if (keepL.length !== later.length) { if (r.owner) lsSet('bs_tg_later', JSON.stringify(keepL)); else { g.later = keepL; peopleChanged.push(r.c); } }
                // сводка на неделю — с понедельника, при первом запуске недели после 9:00
                var wk = weekKey(now), fresh = ids.every(function (id) { return seen[id] && seen[id].name !== undefined; });
                var last = r.owner ? lsGet('bs_tg_week') : g.week;
                if (hour >= 9 && fresh && last !== wk) {
                    if (r.owner) lsSet('bs_tg_week', wk); else { g.week = wk; peopleChanged.push(r.c); }
                    var d0 = new Date(now), lines = weekLines(seen, ids, new Date(d0.getFullYear(), d0.getMonth(), d0.getDate()).getTime());
                    if (lines.length) jobs.push(keep(function () { send(weekHead() + lines.slice(0, 20).join('\n'), null, null, function () { weekBack(wk, last); }); }));
                }
            });
        });
        if (changed) lsSet('bs_tg_today', JSON.stringify(done.slice(0, 400)));
        if (peopleChanged.length) saveUsers(people, peopleChanged);
        queues.forEach(spaced);                                      // после записи: ответ «не ушло» правит уже сохранённое
    }

    /* ---------- команды и кнопки бота (getUpdates, пока Lampa запущена) ---------- */

    var polling = false, LONG_POLL = 25, conflictRetry = false, CONFLICT_RETRY = 2500;
    function poll() {
        if (polling || pair || !hasToken() || !chat()) return;
        if (Date.now() < conflictUntil || held()) return;
        if (svc.away) return;                                    // Lampa скрыта — бота ведёт служба, не мешаем ей
        // Lampa запустилась уже скрытой (ТВ в ждущем режиме: автообновление, установка) — visibilitychange не было.
        // Такой ТВ не должен вести бота: сеть у него придержана (TMDB «не отвечает»), фильм на экране не откроешь.
        // Уходим, как при выключении: бота берёт ТВ на экране, а если других нет — своя служба.
        if (!onScreen() && svcBot() && !svc.woken) {              // открыла служба («Смотреть») — бот у нас, даже если экран не включился
            var was = isLeader; isLeader = false; if (was) leader = { id: '', at: 0 };
            if (othersKnown() > 0) busSend({ t: 'bye', lead: was });
            try { svcAway(was); } catch (e) {}
            return;
        }
        if (newerOnline()) { if (isLeader) { isLeader = false; log('бота ведёт ТВ с новой Lampa', ''); } return; }
        // служба на связи: сначала «я здесь» с правилами, и если, пока нас не было, она копила апдейты, — их первыми
        if (svcBot() && (svc.pend > 0 || Date.now() - svc.aliveAt >= SVC_ALIVE)) {
            polling = true;
            return svcAlive(false, function (n) {
                if (n > 0) return svcTake(function () { polling = false; poll(); });
                polling = false; poll();
            });
        }
        var off = lsGet('bs_tg_offset');
        polling = true;
        if (off === null) {                                      // впервые — старые сообщения не разбираем
            return call('getUpdates', { offset: -1 }, function (u) {
                polling = false;
                lsSet('bs_tg_offset', String(u && u.length ? u[u.length - 1].update_id + 1 : 0));
            }, function () { polling = false; });
        }
        // длинный опрос: Telegram держит запрос до LONG_POLL с, пока не придёт нажатие или сообщение — отклик сразу
        call('getUpdates', { offset: off, timeout: LONG_POLL }, function (updates) {
            polling = false; conflictRetry = false; yieldHold = false;
            if (!isLeader) {
                isLeader = true; leader = { id: tvId, at: Date.now() }; busHello(false); log('главный ТВ', tvName());
                svc.aliveAt = 0;                                     // службе — сразу: этот ТВ теперь главный
                busSend({ t: 'who', users: true });                  // люди со всех ТВ: вдруг гостя разрешили на другом
            }
            var staleTold = {};
            (updates || []).forEach(function (u) { takeUpdate(u, staleTold); });
            // общий бот: пусто — следующий вопрос через 1 с (сервер ждёт ещё 1 с сам; дольше держать хостинг не может)
            setTimeout(poll, 200);
        }, function (e) {
            polling = false;
            if (!/conflict/i.test(String(e))) return;
            // 409: бота опрашивает другой. Это может быть своя служба, взявшая бота после перезагрузки ТВ, — она уступает
            // на первом же 409, поэтому один быстрый повтор, и только потом долгая пауза (другой ТВ — он главный)
            if (!conflictRetry) { conflictRetry = true; return setTimeout(poll, CONFLICT_RETRY); }
            conflictRetry = false;
            onConflict();
        }, (LONG_POLL + 10) * 1000);
    }

    /* Один апдейт — из getUpdates или из очереди службы (u._q = {at, tv}: когда служба его получила, по часам Telegram,
     * и было ли это действие «на ТВ», на которое она уже открыла Lampa). «Пришло, пока Lampa была выключена» (старое,
     * не выполняем) считаем от времени, когда апдейт дошёл до ТВ: для очереди это время службы, а не «сейчас» —
     * сообщение, честно пролежавшее в очереди, пока Lampa была закрыта, свежее. Но из очереди — не старше QUEUE_FRESH,
     * а «на ТВ» — не старше TV_FRESH: фильм, нажатый вчера, сам не включится. Пролежавшие нажатия — молча мимо. */
    var QUEUE_FRESH = 6 * 3600, TV_FRESH = 15 * 60, CMD_FRESH = 120;
    /** Из очереди службы — служебная команда (Помощь, Меню, списки, кнопки меню), отправленная давно: человек уже получил
     *  «Lampa закрыта», а запоздалая помощь или меню — только мусор в чате. Поиск и «на ТВ» сюда не попадают. */
    function lateCommand(u, age) {
        if (age <= CMD_FRESH) return false;
        // кнопки: молча — только переходы по меню (mn:, st:, lg:); «Хочу посмотреть», «Подписаться» и прочие действия
        // выполняем и с опозданием — служба обещала «отвечу, как только откроют»
        if (u.callback_query) return !u._q.tv && /^(mn|st|lg):/.test(String(u.callback_query.data || ''));
        var t = u.message && u.message.text;
        if (!t) return false;
        var c = /^\/(\w+)/.exec(t);
        if (c) return !/^(start|find|type)$/i.test(c[1]);
        return KB_WORDS.indexOf(plainOf(t)) >= 0 && !isWord(plainOf(t), 'type');
    }
    function takeUpdate(u, staleTold) {
        if (!u || typeof u.update_id !== 'number') return;
        var q = u._q;
        if (q && u.update_id < (parseInt(lsGet('bs_tg_offset'), 10) || 0)) return;   // из очереди, но уже разобрано
        lsSet('bs_tg_offset', String(u.update_id + 1));
        if (q && u.message && u.message._k) return keyAgain(u);                 // ключ ИИ — служба его не сохранила
        if (q && u._big) return bigAgain(u);                                   // слишком большое — служба его не сохранила
        // q.at = 0: служба не знает, когда пришло (догоняющий ответ без даты) — «на ТВ» такое не выполняем
        var now = serverNow() / 1000, got = q && q.at ? q.at / 1000 : now, md = u.message && u.message.date;
        var old = !!q && ((!!q.at && now - got > QUEUE_FRESH) || (!!q.tv && (!q.at || now - got > TV_FRESH)));
        if (old && !md) return;
        if (md && u.message.chat && (got - md > STALE_UPDATE || old)) {         // пришло, пока Lampa была выключена - не выполняем
            var sc = String(u.message.chat.id);
            if (!staleTold[sc]) {                                                  // одно объяснение на чат, а не на каждое сообщение
                staleTold[sc] = 1;
                hintLang(u, sc);
                as(sc, function () {
                    call('sendMessage', { chat_id: sc, text: L('⏳ Ваше сообщение от ' + hhmm(md * 1000) + ' пришло, когда Lampa на ТВ была выключена ' +
                        '(бот работает внутри Lampa). Сейчас ТВ на связи — напишите ещё раз.',
                        '⏳ Your message from ' + hhmm(md * 1000) + ' arrived while Lampa on the TV was off (the bot runs inside Lampa). The TV is online now — please send it again.',
                        '⏳ Soat ' + hhmm(md * 1000) + " da yuborgan xabaringiz televizordagi Lampa o'chiq paytda keldi (bot Lampa ichida ishlaydi). Hozir televizor aloqada — qayta yozing.") }, null, null);
                });
            }
            return;
        }
        if (q && lateCommand(u, now - (md || got))) {                            // запоздалая команда — молча (и убрать её из чата)
            if (u.message && u.message.chat && md && now - md < 48 * 3600 - 60) delNow(String(u.message.chat.id), u.message.message_id);
            return;
        }
        queuedTv = !!(q && q.tv);                                               // «на ТВ» из очереди: служба уже сказала «включите ТВ»
        try { handle(u); } catch (e) { log('команда', e.message); } finally { queuedTv = false; }
    }

    /** Апдейт был слишком большим для очереди службы (u._big = {chat, date}): содержимого нет — подключённого человека
     *  попросить прислать ещё раз, если это было недавно (не старше QUEUE_FRESH). Чужим и давнее — молча. */
    function bigAgain(u) {
        var b = u._big || {}, c = String(b.chat || ''), when = b.date > 0 ? b.date : (u._q.at || 0) / 1000;
        if (!c || !allowed(c) || !when || serverNow() / 1000 - when > QUEUE_FRESH) return;
        as(c, function () {
            reply(L('⚠️ Ваше сообщение пришло, пока Lampa на ТВ была закрыта, и оказалось слишком большим — я его не сохранил. Пришлите ещё раз.',
                "⚠️ Your message arrived while Lampa on the TV was closed and was too large — I couldn't keep it. Please send it again.",
                "⚠️ Xabaringiz televizordagi Lampa yopiq paytda keldi va juda katta ekan — uni saqlay olmadim. Qayta yuboring."));
        });
    }
    /** Ключ ИИ прислали, пока Lampa была закрыта: служба его на диск не писала (текст заменён, _k). Сообщение с ключом —
     *  из чата (Telegram даёт удалять 48 часов), человека — попросить прислать ещё раз. */
    function keyAgain(u) {
        var m = u.message, c = m.chat ? String(m.chat.id) : '';
        if (!c) return;
        if (m.message_id && m.date && serverNow() / 1000 - m.date < 48 * 3600 - 60) call('deleteMessage', { chat_id: c, message_id: m.message_id }, null, null);
        if (!allowed(c)) return;
        hintLang(u, c);
        as(c, function () {
            reply(L('🔑 Похоже, вы прислали ключ ИИ, пока Lampa на ТВ была закрыта. Я его не сохранил и удалил сообщение из чата — пришлите ключ ещё раз.',
                '🔑 Looks like you sent an AI key while Lampa on the TV was closed. I did not save it and deleted the message — please send the key again.',
                "🔑 Televizordagi Lampa yopiq paytda AI kalitini yuborganga o'xshaysiz. Uni saqlamadim va xabarni o'chirdim — kalitni qayta yuboring."));
        });
    }

    /* ---------- бот, пока Lampa закрыта: опрашивает служба ----------
     * Lampa скрыта или закрыта — бота опрашивает служба (service.js, «бот, пока Lampa закрыта»): копит апдейты, на кнопки
     * «на ТВ» открывает Lampa, остальным подключённым отвечает «Lampa закрыта». Про bstg.js служба ничего не знает:
     * правила и тексты (уже на языке каждого человека) ей шлёт страница — /alive при опросе (не реже SVC_ALIVE) и уходя
     * (away). Вернулась страница — сначала очередь (/pending, тем же takeUpdate, что и getUpdates), потом обычный опрос
     * с номера службы. Несколько ТВ: служба берёт бота, только если этот ТВ был главным (leader) и других ТВ на экране
     * не было (peers) — иначе бота подхватит ТВ на экране; подробно — в service.js. Служба старая (v1) или её нет —
     * всё как раньше. */
    var SVC_ALIVE = 20000;
    function svcBot() { return svc.up && (svc.v | 0) >= 2 && svcTg(); }
    /** Что требует этот ТВ: «▶️ Смотреть» и «📺 Открыть на ТВ» (v:, o: — поиск, «Хочу посмотреть», записи), этот ТВ в
     *  «На каком ТВ…» (D:, d:), «⌨️ Набрать на ТВ» (mn:type, tp:, /type, слово с клавиатуры). Остальное (поиск, меню,
     *  списки, подписки, настройки, язык) — ответы в чате: ради них Lampa не открываем.
     *  Только простые списки — служба не собирает RegExp из присланного: cbp — начало данных кнопки, дальше только
     *  номер; cbx — данные целиком; cmd — команды; words — слова клавиатуры (служба сравнивает без эмодзи в начале). */
    function tvRules() {
        var cbp = [];
        ['v:', 'o:', 'D:' + tvId + ':', 'd:' + tvId + ':'].forEach(function (a) { cbp.push(a + 'm:', a + 't:'); });
        return { cbp: cbp, cbx: ['mn:type', 'tp:' + tvId], cmd: ['type'], words: WORDS.type.slice(0) };
    }
    /* Другие ТВ на этом боте — запомненные (bs_tg_tvs: {id: когда слышали}, 30 дней): служба после перезагрузки ТВ сама
     * берёт бота, только если ТВ на боте один (см. service.js). Список devices — только в памяти и пуст сразу после
     * запуска, поэтому — свой. */
    var TVS_KEEP = 30 * 86400000;
    function tvsNote(id) {
        if (!id || id === tvId) return;
        var m = lsJson('bs_tg_tvs', {}), now = Date.now(), k;
        if (!m || typeof m !== 'object') m = {};
        if (m[id] && now - m[id] < 86400000) return;                  // раз в сутки на ТВ — не чаще
        m[id] = now;
        for (k in m) if (m.hasOwnProperty(k) && now - m[k] > TVS_KEEP) delete m[k];
        lsSet('bs_tg_tvs', JSON.stringify(m));
    }
    function othersKnown() {
        var m = lsJson('bs_tg_tvs', {}), now = Date.now(), n = 0, k;
        if (m && typeof m === 'object') for (k in m) if (m.hasOwnProperty(k) && k !== tvId && now - m[k] < TVS_KEEP) n++;
        return Math.max(n, otherTvs().length);
    }
    /** Другие ТВ на экране (свежее «я здесь»): уйдём — бота возьмут они, а не наша служба. */
    function peersOnScreen() {
        var now = Date.now(), n = 0, k;
        for (k in devices) if (devices.hasOwnProperty(k) && devices[k].fg && now - devices[k].at < LEADER_ALIVE) n++;
        return n;
    }
    /** Правила для службы: кому отвечать (known), кому можно открыть Lampa (allowed), тексты каждому на его языке. */
    function svcCfg(lead) {
        var u = users(), known = [chat()], tv = [chat()], texts = {}, typing = {}, r = tvRules(), k;
        for (k in u) if (u.hasOwnProperty(k) && active(u[k])) { known.push(k); if (guestPlay()) tv.push(k); }
        known.forEach(function (c) {
            as(c, function () {
                texts[c] = {
                    closed: L('Lampa на ТВ закрыта — отвечу, как только её откроют.', "Lampa on the TV is closed — I'll reply as soon as it's opened.",
                        'Televizordagi Lampa yopiq — uni ochishlari bilan javob beraman.'),
                    tvOff: L('📺 Телевизор выключен — включите его: Lampa уже открыта с фильмом.', '📺 The TV is off — turn it on: Lampa is already open with your movie.',
                        "📺 Televizor o'chiq — uni yoqing: Lampa film bilan allaqachon ochilgan."),
                    offWait: L('📺 Телевизор выключен — включите его, и я сразу отвечу.', '📺 The TV is off — turn it on and I will answer right away.',
                        "📺 Televizor o'chiq — uni yoqing, darhol javob beraman."),
                    opening: L('📺 Открываю Lampa на ТВ…', '📺 Opening Lampa on the TV…', "📺 Televizorda Lampa'ni ochyapman…")
                };
            });
        });
        // «⌨️ Набрать на ТВ» ждёт текст: следующее сообщение этого чата — тоже «на ТВ»
        // сколько ещё ждать (мс), а не «до скольких»: часы службы — свои
        if (typeFor && typeFor.tv === tvId && Date.now() - typeFor.at < TYPE_WAIT) typing[typeFor.chat] = typeFor.at + TYPE_WAIT - Date.now();
        r.typing = typing;
        // me — этот ТВ в канале ТВ: служба (v5) говорит за него, пока Lampa закрыта (см. service.js, «канал ТВ»)
        return { leader: !!lead, peers: peersOnScreen(), others: othersKnown(), allowed: tv, known: known, texts: texts, tv: r,
            me: { id: tvId, name: tvName(), model: lsGet('bs_tv_model') || '', v: appVer(), relay: busRelay() } };
    }
    /** «Я здесь» (или away — ухожу) и правила. cb(сколько апдейтов ждёт в очереди службы). */
    function svcAlive(away, cb, lead) {
        if (!svcBot()) { if (cb) cb(0); return; }
        var off = parseInt(lsGet('bs_tg_offset'), 10);
        svc.aliveAt = Date.now();
        svcAsk('POST', '/alive', { away: !!away, offset: off >= 0 ? off : -1, cfg: svcCfg(away ? lead : isLeader) }, function (st, j) {
            if (st === 200 && j && j.ok) svc.pend = j.pending | 0;
            else if (!st) svcLost();
            if (cb) cb(svc.pend);
        });
    }
    /** Очередь службы — по порядку, тем же разбором; потом подтвердить (/pending/ack) и продолжить с её номера. */
    function svcTake(done) {
        svc.pend = 0;
        svcAsk('GET', '/pending', undefined, function (st, j) {
            if (!(st === 200 && j && j.ok && j.items && j.items.length)) return done();
            var told = {}, upTo = -1;
            j.items.forEach(function (it) {
                if (!it || !it.u || typeof it.u.update_id !== 'number') return;
                it.u._q = { at: +it.at || 0, tv: it.tv ? 1 : 0 };
                if (it.u.update_id > upTo) upTo = it.u.update_id;
                try { takeUpdate(it.u, told); } catch (e) { log('очередь', e.message); }
            });
            var next = +j.next || 0, off = parseInt(lsGet('bs_tg_offset'), 10) || 0;
            if (j.more) svc.pend = 1;                                // отдала не всё — остальное следующим опросом
            else if (next > off) lsSet('bs_tg_offset', String(next));
            if (upTo < 0) return done();
            svcAsk('POST', '/pending/ack', { upTo: upTo }, function () { done(); });
        }, 10000);
    }
    /** Lampa уходит с экрана: бота — службе (если она есть и новая). lead — был ли этот ТВ главным. */
    function svcAway(lead) {
        if (!svcBot()) return;
        // «ушла» приходит и дважды (выключили ТВ: visibilitychange, потом unload) — второй раз bye() уже снял isLeader
        // и сказал бы службе «не главная»: бот бы замолчал. Уже ушли — не повторяем.
        if (svc.away) return;
        // ТВ на боте один (других не видели) — он и есть главный, даже если не успел им стать (включили и сразу выключили)
        if (!lead && othersKnown() === 0 && peersOnScreen() === 0) lead = true;
        svc.away = true; svc.awayAt = Date.now();
        svcAlive(true, null, lead);
    }
    /* Lampa ушла, а таймеры идут — её снова открыли. На экране — бот снова наш. Не на экране — может быть, её открыла
     * служба (кнопка «на ТВ») при выключенном экране, где visibilitychange может и не прийти: служба открыла Lampa
     * после нашего ухода (/health.launched) — тоже забираем бота, иначе «▶️ Смотреть» из очереди не выполнится. */
    function svcWake() {
        if (!svc.away) return;
        if (onScreen()) { svcBack(); return poll(); }
        svcAsk('GET', '/health', undefined, function (st, j) {
            if (st === 200 && j && j.launched > svc.awayAt && svc.away) { log('Lampa открыла служба — бот снова здесь', ''); svcBack(); svc.woken = true; poll(); }
        }, 3000);
    }
    /** Lampa снова на экране: 409 на брошенный при уходе опрос — от своей же службы, не от другого ТВ. */
    function svcBack() { svc.away = false; svc.aliveAt = 0; conflictUntil = 0; yieldHold = false; svcCmds(); }
    /** Команды этому ТВ, которые служба (v5) приняла из канала ТВ, пока Lampa была закрыта, — выполнить как обычно.
     *  Служба уже проверила, что они свежие, и открыла ради них Lampa: время — «сейчас» (иначе open/type устарели бы). */
    function svcCmds() {
        if (!(svc.up && (svc.v | 0) >= 5)) return;
        svcAsk('GET', '/bus/cmds', undefined, function (st, j) {
            if (!(st === 200 && j && j.ok && j.items && j.items.length)) return;
            j.items.forEach(function (m) {
                if (!m || typeof m !== 'object' || m.to !== tvId) return;
                m.ts = Date.now();
                log('команда, пока Lampa была закрыта', m.t);
                try { onBus(m); } catch (e) { log('канал', e.message); }
            });
        }, 5000);
    }

    function reply(text, buttons) { send(text, null, null, null, buttons); }

    function wantList() {
        var list = [];
        if (isOwner()) { try { list = Lampa.Favorite.get({ type: 'wath' }) || []; } catch (e) {} }
        else list = (guest() || {}).want || [];
        if (!list.length) return reply(L('⭐ В «Хочу посмотреть» пока пусто.\nНапишите название фильма или сериала и нажмите «⭐ Хочу посмотреть».',
            '⭐ “Want to watch” is empty for now.\nType the name of a movie or series and tap “⭐ Want to watch”.',
            "⭐ «Ko'rmoqchiman» ro'yxati hozircha bo'sh.\nFilm yoki serial nomini yozing va «⭐ Ko'rmoqchiman» tugmasini bosing."));
        var rows = list.slice(0, 12).map(function (c) {
            var k = (c.tv !== undefined ? c.tv : c.name || c.number_of_seasons || c.first_air_date) ? 't' : 'm', name = c.title || c.name || c.original_title || c.original_name || '';
            return [{ text: '▶️ ' + name, callback_data: 'v:' + k + ':' + c.id }, { text: '📺', callback_data: 'o:' + k + ':' + c.id }, { text: '✖', callback_data: 'x:' + k + ':' + c.id }];
        });
        reply(L('⭐ Хочу посмотреть (', '⭐ Want to watch (', "⭐ Ko'rmoqchiman (") + list.length + L(')\n▶️ — включить на ТВ, 📺 — открыть карточку, ✖ — убрать из списка',
            ')\n▶️ — play on the TV, 📺 — open the card, ✖ — remove from the list', ")\n▶️ — televizorda yoqish, 📺 — kartochkani ochish, ✖ — ro'yxatdan olib tashlash"), rows);
    }

    /* ---------- поиск по картинке (Gemini) ----------
     * Прислали фото, скриншот или постер: Lampa скачивает его из Telegram, спрашивает Gemini «что за фильм» и
     * отдаёт ответ обычному поиску (слайдер, «Хочу посмотреть», «Открыть на ТВ»). Ключ Gemini (AIza…) человек
     * присылает боту сообщением — хранится на этом ТВ, сообщение с ключом из чата удаляем. Картинка уходит в Google. */

    var GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models/';
    // если список моделей ключа получить не удалось
    var GEMINI_FALLBACK = ['gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'];
    var MODELS_TTL = 24 * 3600 * 1000;
    var GEMINI_ASK = 'Это скриншот, кадр или постер фильма, сериала или мультфильма. Определи, что это. ' +
        'Ответь только JSON: {"title": "название по-русски", "original_title": "оригинальное название", "year": год выхода числом или 0, ' +
        '"type": "movie" или "tv", "sure": true или false}. Если не узнал — title и original_title пустые.';
    /* Ключ Gemini: у каждого человека может быть свой (bs_gemini_keys, по чату; только на этом ТВ, в канал не уходит),
     * нет своего — ключ владельца. Лимиты моделей считаются по ключу. */
    /* Ключ в localStorage (без службы) — {k: ключ, h, l}; в службе — {k: '', h, l} по метке bs_ai_svc. h — FNV ключа
     * (метка кэшей, та же, что раньше считалась от ключа), l — последние 4 знака. c — чей: чат человека или '' (владелец). */
    function keyInfo(p, c) {
        var k = lsKey(p, c).replace(/\s+/g, '');
        if (k) return { k: k, h: fnv(k, 2166136261), l: k.slice(-4), c: c };
        var m = aiMarks()[slotId(p, c)];
        return m && m.h ? { k: '', h: String(m.h), l: String(m.l || ''), c: c } : null;
    }
    /** Свой ключ того, кому отвечаем (владелец — ключ владельца, человек — его личный). */
    function ownSlot(p) { return keyInfo(p, isOwner() ? '' : to()); }
    /** Ключ для запроса: свой, нет — владельца (как раньше: свой || ключ владельца). */
    function aiSlot(p) { return ownSlot(p) || (isOwner() ? null : keyInfo(p, '')); }
    function geminiMark() { var g = aiSlot('gemini'); return g ? g.h : fnv('', 2166136261); }
    function skipKey() { return 'bs_gemini_skip_' + geminiMark(); }
    /** Похоже на ключ, с чего бы он ни начинался (AIza…, AQ.…, завтра другое): одно «слово» 30–200 знаков, латиница
     *  с цифрами, без пробелов. Название фильма так не выглядит. Проверяет сам Gemini (geminiCheck). */
    function isGeminiKey(t) {
        t = String(t || '').replace(/^\s+|\s+$/g, '');
        return t.length >= 30 && t.length <= 200 && /^[\x21-\x7e]+$/.test(t) && /[A-Za-z]/.test(t) && /\d/.test(t) && !/^https?:/i.test(t) &&
            t.indexOf('/') < 0 && !/^\d{6,}:[\w-]{30,}$/.test(t);
    }

    /** Рабочий ли ключ: ok(true) — да, ok(false, why) — Gemini его не принял; нет связи — ok(null). */
    function geminiCheck(key, ok) {
        ok = keep(ok);
        var x = new XMLHttpRequest();
        try {
            x.open('GET', GEMINI + '?pageSize=1', true);
            x.setRequestHeader('x-goog-api-key', key);
            x.timeout = 20000;
            x.onload = keep(function () {
                if (x.status === 200) return ok(true);
                var j = null;
                try { j = JSON.parse(x.responseText); } catch (e) {}
                var why = (j && j.error && j.error.message) || (L('ответ ', 'response ', 'javob ') + x.status);
                if (x.status === 429 || x.status >= 500) return ok(null);       // ключ, похоже, свой — Gemini занят
                ok(false, /location is not supported/i.test(why) ? L('Gemini недоступен в вашей стране', 'Gemini is not available in your country', 'Gemini mamlakatingizda mavjud emas') : why);
            });
            x.onerror = x.ontimeout = function () { ok(null); };
            x.send();
        } catch (e) { ok(null); }
    }

    /** Ответ Gemini -> {title, query} или null. */
    function fromGemini(j) {
        var text = '';
        try { text = j.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join(''); } catch (e) { return null; }
        var m = /\{[\s\S]*\}/.exec(text), r = null;
        try { r = JSON.parse(m ? m[0] : text); } catch (e) { return null; }
        if (!r) return null;
        var ru = String(r.title || '').replace(/^\s+|\s+$/g, ''), orig = String(r.original_title || '').replace(/^\s+|\s+$/g, '');
        if (!ru && !orig) return null;
        var year = (r.year | 0) > 1900 ? r.year | 0 : 0;
        var name = ru && orig && ru.toLowerCase() !== orig.toLowerCase() ? ru + ' / ' + orig : ru || orig;
        return { title: name + (year ? ' (' + year + ')' : ''), query: (orig || ru) + (year ? ' ' + year : ''), sure: r.sure !== false };
    }

    function bytesB64(buf) {
        var b = new Uint8Array(buf), s = '', CH = 0x8000;
        for (var i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH));
        return btoa(s);
    }

    /** hdr — заголовки запроса ({имя: значение}): общий бот передаёт ключ ТВ заголовком, не в адресе. */
    function httpGetBin(url, ok, fail, hdr) {
        ok = keep(ok); fail = keep(fail);
        var x = new XMLHttpRequest(), k;
        try {
            if (url.indexOf(SVC) === 0) svcOpen(x, 'GET', url); else x.open('GET', url, true);
            if (hdr) for (k in hdr) if (hdr.hasOwnProperty(k)) x.setRequestHeader(k, hdr[k]);
            x.responseType = 'arraybuffer';
            x.timeout = 30000;
            x.onload = keep(function () { if (x.status === 200 && x.response) ok(x.response); else fail(L('ответ ', 'response ', 'javob ') + x.status); });
            x.onerror = keep(function () { fail(L('нет связи', 'no connection', "aloqa yo'q")); });
            x.ontimeout = keep(function () { fail(L('сервер не отвечает', 'the server timed out', 'server javob bermayapti')); });
            x.send();
        } catch (e) { fail(e.message); }
    }

    /* Модели — какие есть у ключа (ListModels, раз в сутки): умеют generateContent и видят картинки. Порядок: Flash
     * Lite (самый большой бесплатный лимит, быстрая) → Flash; Pro не берём — бесплатно её почти нет. Внутри — новее
     * первыми, стабильные раньше preview.
     * Лимит у каждой модели свой: кончился на сегодня — модель пропускаем до сброса (полночь в Калифорнии),
     * «много запросов в минуту» — на минуту. Не вышло ни у одной — говорим по каждой, что с ней. */

    function rankModels(list) {
        var out = [];
        (list || []).forEach(function (m) {
            var id = String(m && m.name || '').replace(/^models\//, ''), how = (m && m.supportedGenerationMethods) || [];
            if (!/^gemini-/.test(id) || how.indexOf('generateContent') < 0) return;
            if (/embed|tts|image|live|audio|computer|robotics|aqa|learnlm|gemma/i.test(id)) return;   // не про картинки «что это»
            if (!/flash/.test(id)) return;                     // Pro и прочие: бесплатного лимита нет или он крошечный
            var tier = /lite/.test(id) ? 0 : 1;                // Lite — самый большой бесплатный лимит и быстрее всех
            var v = /latest/.test(id) ? 99 : parseFloat((/gemini-(\d+(?:\.\d+)?)/.exec(id) || [])[1] || '0');
            out.push({ id: id, tier: tier, pre: /preview|exp/.test(id) ? 1 : 0, v: v });
        });
        out.sort(function (a, b) { return a.tier - b.tier || a.pre - b.pre || b.v - a.v || (a.id < b.id ? -1 : 1); });
        return out.map(function (x) { return x.id; });
    }

    function geminiModels(cb, force) {
        cb = keep(cb);
        var key = aiSlot('gemini'), mark = geminiMark(), c = lsJson('bs_gemini_models2', null);
        if (!force && c && c.k === mark && Date.now() - c.at < MODELS_TTL && c.list && c.list.length) return cb(c.list, true);
        var x = new XMLHttpRequest();
        var fallback = function () { cb(c && c.k === mark && c.list && c.list.length ? c.list : GEMINI_FALLBACK, false); };
        try {
            aiOpen(x, 'GET', 'gemini', 'models/?pageSize=200', key);
            x.timeout = 20000;
            x.onload = function () {
                var j = null;
                try { j = JSON.parse(x.responseText); } catch (e) {}
                var list = x.status === 200 ? rankModels(j && j.models) : [];
                if (!list.length) return fallback();
                lsSet('bs_gemini_models2', JSON.stringify({ k: mark, at: Date.now(), list: list }));
                cb(list, true);
            };
            x.onerror = x.ontimeout = fallback;
            x.send();
        } catch (e) { fallback(); }
    }

    /** Когда сбросится суточный лимит: полночь в Калифорнии (~8:00 UTC). */
    function quotaReset(now) {
        var d = new Date(now), r = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 8, 0);
        return r > now ? r : r + 86400000;
    }
    function hhmm(t) { var d = new Date(t); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }

    /** Ответ с ошибкой -> {kind, until}: day — лимит на сегодня, minute — много запросов в минуту, busy — перегружена,
     *  missing — модели нет у ключа, key — ключ не подошёл, region — страна, other. */
    function geminiError(status, text, now) {
        var j = null, why = '';
        try { j = JSON.parse(text); } catch (e) {}
        why = (j && j.error && j.error.message) || '';
        if (/location is not supported/i.test(why)) return { kind: 'region' };
        if (status === 400 && /API key|API_KEY/i.test(why + text) || status === 401 || status === 403 && /key/i.test(why)) return { kind: 'key', why: why };
        if (status === 429) {
            if (/PerDay|per day|daily/i.test(text)) return { kind: 'day', until: quotaReset(now) };
            var wait = /"retryDelay"\s*:\s*"(\d+)/.exec(text);
            return { kind: 'minute', until: now + Math.max(30, Math.min(300, wait ? +wait[1] : 60)) * 1000 };
        }
        if (status === 404) return { kind: 'missing' };
        if (status >= 500 || /high demand|overloaded|unavailable/i.test(why)) return { kind: 'busy' };
        return { kind: 'other', why: why || (L('ответ ', 'response ', 'javob ') + status) };
    }

    var KIND_TEXT = { day: 'лимит на сегодня закончился', minute: 'много запросов в минуту', busy: 'перегружена',
        missing: 'недоступна с этим ключом', other: 'ошибка' };
    var KIND_EN = { day: "today's limit is used up", minute: 'too many requests per minute', busy: 'overloaded', missing: 'not available for this key', other: 'error' };
    var KIND_UZ = { day: 'bugungi limit tugadi', minute: "daqiqasiga so'rovlar ko'p", busy: "haddan tashqari band", missing: 'bu kalit uchun mavjud emas', other: 'xato' };
    function kindText(k) { return L(KIND_TEXT, KIND_EN, KIND_UZ)[k] || k; }
    /** «(до 11:00)» */
    function untilText(t) { return L(' (до ', ' (until ', ' (') + hhmm(t) + L(')', ')', ' gacha)'); }

    /** Итог, когда ни одна модель не ответила. tried — [{id, kind, until, why}]. */
    function geminiSummary(tried, now) {
        if (!tried.length) return L('нет моделей Gemini, которые видят картинки', 'no Gemini models that can see pictures', "rasmlarni ko'ra oladigan Gemini modellari yo'q");
        var kinds = tried.map(function (t) { return t.kind; }), all = function (k) { return kinds.every(function (x) { return x === k; }); };
        var head;
        if (all('day')) {
            var at = hhmm(tried[0].until || quotaReset(now));
            head = L('🔋 Бесплатный лимит Gemini на сегодня закончился у всех моделей. Он обновится в ' + at + '.', "🔋 Gemini's free limit for today is used up on all models. It resets at " + at + '.',
                "🔋 Gemini'ning bugungi bepul limiti barcha modellarda tugadi. Limit soat " + at + ' da yangilanadi.');
        } else if (kinds.indexOf('busy') >= 0 || kinds.indexOf('minute') >= 0) head = L('⏳ Gemini сейчас занят — пришлите картинку ещё раз через минуту.', '⏳ Gemini is busy now — send the picture again in a minute.', "⏳ Gemini hozir band — rasmni bir daqiqadan keyin qayta yuboring.");
        else head = L('😔 Gemini не ответил.', "😔 Gemini didn't answer.", '😔 Gemini javob bermadi.');
        return head + '\n' + tried.map(function (t) {
            return '• ' + t.id + ' — ' + kindText(t.kind) + (t.kind === 'day' && t.until ? untilText(t.until) : '') + (t.kind === 'other' && t.why ? ': ' + String(t.why).slice(0, 80) : '');
        }).join('\n');
    }

    function skipped(sk) {
        var m = lsJson(sk || skipKey(), {}), now = Date.now(), out = {};
        for (var k in m) if (m.hasOwnProperty(k) && m[k].until > now) out[k] = m[k];
        return out;
    }

    /** Спросить модели по очереди. ok(json, model); fail(text) — текст для человека. */
    function geminiAsk(b64, mime, hint, ok, fail) {
        aiRun([{ text: aiPrompt(GEMINI_ASK) + (hint ? '\nПодсказка от человека: ' + hint : '') }, { inline_data: { mime_type: mime, data: b64 } }], ok, fail);
    }
    /** Название в ответе ИИ человек видит — на английском тому, кто выбрал английский (узбекских названий у ИИ почти нет). */
    function aiPrompt(p) { return lang() === 'en' ? p.replace('название по-русски', 'название по-английски') : p;
    }

    /* ---------- несколько ИИ: Groq → Gemini → OpenRouter ----------
     * Ключ любого из них человек присылает боту — кто это, видно по началу: gsk_ — Groq (быстрый, ~1000 бесплатных
     * запросов в день), sk-or- — OpenRouter (бесплатные модели, 50 в день), остальное — Gemini. Ключи — как у Gemini:
     * у каждого человека свои, нет своего — ключ владельца. Бот спрашивает по очереди: не ответил один — следующий.
     * Groq и OpenRouter — API в стиле OpenAI (chat/completions); ответ приводим к виду Gemini — разбор тот же. */
    var OA = {
        groq: { name: 'Groq', base: 'https://api.groq.com/openai/v1/', site: 'console.groq.com/keys' },
        openrouter: { name: 'OpenRouter', base: 'https://openrouter.ai/api/v1/', site: 'openrouter.ai/keys' }
    };
    function keyKind(k) { k = String(k || ''); return /^gsk_/.test(k) ? 'groq' : /^sk-or-/.test(k) ? 'openrouter' : 'gemini'; }
    /** Ключ ИИ p для того, кому отвечаем: свой, нет — владельца; null — нет. См. keyInfo. */
    function aiKey(p) { return aiSlot(p); }
    /** Новый ключ (или '' — удалить): как раньше — в localStorage, служба есть — сразу переносим в неё (svcMove). */
    function setAiKey(p, key) {
        var c = isOwner() ? '' : to();
        key = String(key || '').replace(/\s+/g, '');
        lsKeySet(p, c, key);
        if (!key) {                                                   // удалить — и метку, и в службе
            var m = aiMarks(), had = !!m[slotId(p, c)];
            if (had) { delete m[slotId(p, c)]; aiMarksSave(m); }
            if (had || svc.up || hasSvcMarks()) aiDrop(p, c);       // служба не ответила — сотрём, когда ответит
        } else aiForgetSet(slotId(p, c), false);                       // задали снова — прежнее «удалить» уже не нужно
        if (p === 'gemini') { lsSet(skipKey(), '{}'); lsSet('bs_gemini_models2', ''); }
        else lsSet('bs_ai_models_' + p, '');
        if (key) svcMove();
    }
    /* Запрос к ИИ: ключ в localStorage — напрямую, ключ в заголовке, как раньше (Groq и OpenRouter — Authorization:
     * Bearer, Gemini — x-goog-api-key); ключ в службе — через неё: /ai/<p>/<путь>?chat=<чей>, ключ подставит она. */
    var AI_BASE = { gemini: 'https://generativelanguage.googleapis.com/v1beta/', groq: 'https://api.groq.com/openai/v1/', openrouter: 'https://openrouter.ai/api/v1/' };
    function aiOpen(x, method, p, rest, info) {
        if (info && info.k) {
            x.open(method, AI_BASE[p] + rest, true);
            if (p === 'gemini') x.setRequestHeader('x-goog-api-key', info.k);
            else x.setRequestHeader('Authorization', 'Bearer ' + info.k);
            return;
        }
        var u = SVC + '/ai/' + p + '/' + rest;
        if (info && info.c) u += (u.indexOf('?') < 0 ? '?' : '&') + 'chat=' + encodeURIComponent(info.c);
        svcOpen(x, method, u);
    }
    /** Нет связи с ИИ через службу — может, служба пропала. */
    function aiNet(info) { if (info && !info.k) svcLost(); }
    /** Какие ИИ есть у этого человека — по порядку, с ключами (берём сейчас: ответы придут в другом контексте). */
    function aiProviders() {
        var out = [];
        ['groq', 'gemini', 'openrouter'].forEach(function (p) { var k = aiKey(p); if (k) out.push({ p: p, key: k }); });
        return out;
    }
    function aiReady() { return aiProviders().length > 0; }

    /** Модели Groq под задачу: картинка — только «зрячие», текст — сильные и быстрые первыми. */
    var GROQ_DEFAULT = ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'meta-llama/llama-4-scout-17b-16e-instruct', 'meta-llama/llama-4-maverick-17b-128e-instruct'];
    function groqPick(ids, img) {
        ids = (ids || []).filter(function (id) { return !/whisper|tts|guard|playai|orpheus|compound|distil|safeguard/i.test(id); });
        var vision = /scout|maverick|vision|\bvl\b|-vl|omni/i;
        if (img) return ids.filter(function (id) { return vision.test(id); }).slice(0, 2);
        var order = [/llama-3\.3-70b/, /gpt-oss-120b/, /llama-4-maverick/, /llama-4-scout/, /qwen/, /kimi/, /gpt-oss-20b/, /llama/], out = [];
        order.forEach(function (re) { ids.forEach(function (id) { if (re.test(id) && out.indexOf(id) < 0) out.push(id); }); });
        return out.slice(0, 3);
    }
    function oaModels(p, key, img, cb) {
        if (p === 'openrouter') return cb(['openrouter/free']);           // роутер бесплатных моделей, картинки понимает
        var mark = key.h, c = lsJson('bs_ai_models_' + p, null);
        if (c && c.k === mark && Date.now() - c.at < 86400000 && c.ids && c.ids.length) return cb(groqPick(c.ids, img));
        var x = new XMLHttpRequest(), done = function (ids) { cb(groqPick(ids, img)); };
        try {
            aiOpen(x, 'GET', p, 'models', key);
            x.timeout = 10000;
            x.onload = function () {
                var j = null;
                try { j = JSON.parse(x.responseText); } catch (e) {}
                var ids = x.status === 200 && j && j.data ? j.data.map(function (m) { return m.id; }) : [];
                if (ids.length) lsSet('bs_ai_models_' + p, JSON.stringify({ k: mark, at: Date.now(), ids: ids }));
                done(ids.length ? ids : GROQ_DEFAULT);
            };
            x.onerror = function () { aiNet(key); done(GROQ_DEFAULT); };
            x.ontimeout = function () { done(GROQ_DEFAULT); };
            x.send();
        } catch (e) { done(GROQ_DEFAULT); }
    }
    /** Части запроса Gemini (text / inline_data) -> сообщение OpenAI. */
    function oaContent(parts) {
        return parts.map(function (pt) {
            return pt.inline_data ? { type: 'image_url', image_url: { url: 'data:' + pt.inline_data.mime_type + ';base64,' + pt.inline_data.data } } : { type: 'text', text: pt.text };
        });
    }
    function oaRun(p, key, parts, ok, fail, onTry) {
        var img = parts.some(function (pt) { return !!pt.inline_data; });
        oaModels(p, key, img, keep(function (models) {
            if (!models.length) return fail(img ? L('нет модели, которая видит картинки', 'no model that can see pictures', "rasmlarni ko'ra oladigan model yo'q") : L('нет подходящей модели', 'no suitable model', "mos model yo'q"));
            var i = 0, deadline = Date.now() + 30000, last = '';
            (function next() {
                if (i >= models.length || Date.now() > deadline) return fail(last || L('не ответил', "didn't answer", 'javob bermadi'));
                var id = models[i++], x = new XMLHttpRequest();
                if (onTry) try { onTry(OA[p].name + ' ' + id); } catch (e) {}
                try {
                    aiOpen(x, 'POST', p, 'chat/completions', key);
                    x.setRequestHeader('Content-Type', 'application/json');
                    if (p === 'openrouter') x.setRequestHeader('X-Title', 'Lampa TV');
                    x.timeout = Math.max(5000, Math.min(20000, deadline - Date.now()));
                    x.onload = keep(function () {
                        var j = null;
                        try { j = JSON.parse(x.responseText); } catch (e) {}
                        var text = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
                        if (x.status === 200 && text) return ok({ candidates: [{ content: { parts: [{ text: String(text) }] } }] }, OA[p].name + ' ' + id);
                        var why = (j && j.error && (j.error.message || j.error)) || (L('ответ ', 'response ', 'javob ') + x.status);
                        log('ии ' + p, id + ': ' + x.status);
                        if (x.status === 401 || x.status === 403) return fail(L('ключ не подошёл (', 'the key was rejected (', 'kalit mos kelmadi (') + String(why).slice(0, 100) + ')');
                        last = x.status === 429 ? L('лимит на сегодня или в минуту', 'daily or per-minute limit', 'kunlik yoki daqiqalik limit') : String(why).slice(0, 120);
                        next();
                    });
                    x.onerror = keep(function () { aiNet(key); fail(L('нет связи', 'no connection', "aloqa yo'q")); });
                    x.ontimeout = keep(function () { last = L('долго не отвечает', 'takes too long to answer', 'uzoq vaqt javob bermayapti'); next(); });
                    x.send(JSON.stringify({ model: id, messages: [{ role: 'user', content: oaContent(parts) }], temperature: 0, max_tokens: 700 }));
                } catch (e) { fail(e.message); }
            })();
        }));
    }

    /** Спросить ИИ: по очереди все, у кого есть ключ. ok(ответ в виде Gemini, «кто ответил»), fail(текст для человека). */
    function aiRun(parts, ok, fail, onTry) {
        ok = keep(ok); fail = keep(fail); onTry = keep(onTry);
        var list = aiProviders(), errs = [], i = 0;
        if (!list.length) return fail(L('нет ключа ИИ — как его получить, смотрите в «🖼 По картинке»', 'no AI key — see “🖼 By picture” for how to get one', "AI kaliti yo'q — uni qanday olishni «🖼 Rasm bo'yicha» bo'limida ko'ring"));
        (function next() {
            if (i >= list.length) return fail(errs.join('\n'));
            var it = list[i++];
            var f = keep(function (why) { errs.push((it.p === 'gemini' ? 'Gemini' : OA[it.p].name) + ': ' + String(why).replace(/^[^\wА-Яа-яЁё]+/, '').split('\n')[0].slice(0, 160)); next(); });
            if (it.p === 'gemini') return geminiRun(parts, ok, f, onTry);
            oaRun(it.p, it.key, parts, ok, f, onTry);
        })();
    }
    /** Ключ Groq/OpenRouter рабочий? ok(true) / ok(false, почему) / ok(null) — проверить не удалось. */
    function oaCheck(p, key, ok) {
        ok = keep(ok);
        var x = new XMLHttpRequest();
        try {
            x.open('GET', OA[p].base + (p === 'openrouter' ? 'key' : 'models'), true);
            x.setRequestHeader('Authorization', 'Bearer ' + key);
            x.timeout = 15000;
            x.onload = keep(function () { if (x.status === 200) return ok(true); if (x.status === 401 || x.status === 403) return ok(false, L('ответ ', 'response ', 'javob ') + x.status); ok(null); });
            x.onerror = x.ontimeout = function () { ok(null); };
            x.send();
        } catch (e) { ok(null); }
    }

    /* ИИ в поиске по тексту: описали словами («фильм где мужик застрял на Марсе») или по названию ничего не нашлось —
     * Gemini говорит, что это, и ищем уже по названию. Только если ключ Gemini есть. */
    var GEMINI_TEXT = 'Человек ищет фильм, сериал или мультфильм и написал: «{q}». Это может быть название с ошибками, ' +
        'описание сюжета, тема или жанр, актёр, фраза из фильма. Ответь только JSON: {"sure": true или false, "items": [{"title": ' +
        '"название по-русски", "original_title": "оригинальное название", "year": год выхода числом или 0, "type": "movie" или "tv"}]}. ' +
        'Конкретный фильм — один элемент и sure: true. Описание подходит ко многим (тема, жанр) — до 8 самых известных, sure: false. ' +
        'Не понятно — items пустой.';
    /** Ответ ИИ на текст: [{title, query}] (до 8) и sure. */
    function fromGeminiList(j) {
        var text = '';
        try { text = j.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join(''); } catch (e) { return null; }
        var m = /\{[\s\S]*\}/.exec(text), r = null;
        try { r = JSON.parse(m ? m[0] : text); } catch (e) { return null; }
        if (!r) return null;
        var raw = r.items && r.items.length ? r.items : (r.title || r.original_title ? [r] : []), out = [];
        raw.slice(0, 8).forEach(function (it) {
            var one = fromGemini({ candidates: [{ content: { parts: [{ text: JSON.stringify(it) }] } }] });
            if (one) out.push(one);
        });
        return out.length ? { items: out, sure: r.sure !== false && out.length === 1 } : null;
    }
    /** cb(результат или null, почему). Сторож: что бы ни случилось, ответ не позже 50 с. */
    function aiSearch(q, cb, onTry) {
        var done = false, end = keep(function (r, why) { if (done) return; done = true; clearTimeout(guard); cb(r, why); });
        var guard = setTimeout(keep(function () { end(null, geminiSlow()); }), GEMINI_TOTAL + 5000);
        aiRun([{ text: aiPrompt(GEMINI_TEXT).replace('{q}', String(q).slice(0, 300)) }], function (j) { end(fromGeminiList(j), ''); }, function (why) { end(null, why); }, onTry);
    }

    /** Фильмы, которые назвал ИИ, — найти в TMDB (по первому совпадению на каждый) и показать слайдером. */
    function aiSlides(items, status, query) {
        var results = [], left = items.length, have = {};
        items.forEach(function (it, n) {
            searchSource(it.query).fetch(1, function (list) {
                results[n] = list && list[0];
                if (--left) return;
                var all = results.filter(function (r) { if (!r || have[r.media_type + r.id]) return false; have[r.media_type + r.id] = 1; return true; });
                var names = items.map(function (x) { return x.title; }).join(', ');
                if (!all.length) return status(L('😔 ИИ предложил: ' + names + ', но в базе таких нет.', '😔 AI suggested: ' + names + ", but they're not in the database.", "😔 Sun'iy intellekt taklif qildi: " + names + ", lekin ular bazada topilmadi."));
                status(fits(query, names));
                showSlides({ list: all, src: { fetch: function (p, cb) { cb([], 0); } }, page: 1, pages: 1 });
            });
        });
    }
    /* AI-ассистент CUB — тот же, что во вкладке «AI-ассистент» поиска Lampa: запрос от аккаунта CUB на ТВ, свои ключи
     * не нужны. Лимит запросов — у CUB (больше с CUB Premium); исчерпан, нет аккаунта или пусто — ИИ бота по ключу. */
    function cubAccount() {
        try { var a = Lampa.Storage.get('account', {}) || {}; return a.token && a.profile && a.profile.id ? a : null; } catch (e) { return null; }
    }
    function cubAiReady() {
        try {
            var st = window.lampa_settings || {};
            if (!st.account_use || (st.disable_features && st.disable_features.ai)) return false;
            return !!cubAccount() && !!(Lampa.Manifest && Lampa.Manifest.cub_domain);
        } catch (e) { return false; }
    }
    function anyAi() { return cubAiReady() || aiReady(); }
    /** Ответ CUB — карточки TMDB без media_type: у сериала name вместо title. */
    function cubCards(results) {
        return (results || []).filter(function (c) { return c && c.id && c.poster_path; }).map(function (c) {
            if (!c.media_type) c.media_type = c.name && !c.title ? 'tv' : 'movie';
            return c;
        }).slice(0, SLIDE_LIMIT);
    }
    /** cb(карточки или null, почему). */
    function cubAiSearch(q, cb) {
        cb = keep(cb);
        var acc = cubAccount(), done = false, end = function (list, why) { if (done) return; done = true; cb(list, why); };
        if (!acc) return end(null, 'нет аккаунта CUB');
        try {
            var x = new XMLHttpRequest();
            x.open('GET', Lampa.Utils.protocol() + Lampa.Manifest.cub_domain + '/api/ai/search/' + encodeURIComponent(String(q).slice(0, 300)), true);
            x.timeout = 45000;
            x.setRequestHeader('token', acc.token);
            x.setRequestHeader('profile', acc.profile.id);
            x.onload = function () {
                var j = null;
                try { j = JSON.parse(x.responseText); } catch (e) {}
                if (x.status !== 200 || !j || !j.results) return end(null, x.status === 429 || (j && (j.code === 600 || j.decode_code === 600)) ? 'лимит' : 'ответ ' + x.status);
                end(cubCards(j.results), '');
            };
            x.onerror = function () { end(null, 'нет связи'); };
            x.ontimeout = function () { end(null, 'долго не отвечает'); };
            x.send();
        } catch (e) { end(null, e.message); }
    }
    /** Поиск по описанию: AI-ассистент CUB, не вышло — ИИ бота по ключу, ключа нет — честное «не нашлось». */
    function smartFlow(query, status) {
        if (!cubAiReady()) return aiFlow(query, status);
        status(L('🤖 Спрашиваю AI-ассистента…', '🤖 Asking the AI assistant…', "🤖 AI yordamchisidan so'rayapman…"));
        cubAiSearch(query, function (list, why) {
            if (list && list.length) {
                status(fits(query, list.slice(0, 5).map(function (c) { return c.title || c.name; }).join(', ') + (list.length > 5 ? '…' : '')));
                return showSlides({ list: list, src: { fetch: function (p, cb) { cb([], 0); } }, page: 1, pages: 1 });
            }
            if (aiReady()) return aiFlow(query, status);
            status(notFound(query) + (why === 'лимит' ? L(' — лимит AI-ассистента CUB исчерпан, попробуйте позже.', " — the CUB AI assistant's limit is used up, try again later.", " — CUB AI yordamchisi limiti tugadi, keyinroq urinib ko'ring.") : '.'));
        });
    }
    /** «🤖 Под «запрос» подходят: …» */
    function fits(query, names) { return L('🤖 Под «' + query + '» подходят: ', '🤖 Matches for “' + query + '”: ', "🤖 «" + query + "» so'roviga mos keladi: ") + names; }
    /** «😔 По запросу «…» ничего не нашлось» (без точки). */
    function notFound(query) { return L('😔 По запросу «' + query + '» ничего не нашлось', '😔 Nothing found for “' + query + '”', "😔 «" + query + "» bo'yicha hech narsa topilmadi"); }
    function askingAi(id) { return L('🤖 Спрашиваю ИИ', '🤖 Asking AI', "🤖 Sun'iy intellektdan so'rayapman") + (id ? ' (' + id + ')' : '') + '…'; }
    /** Спросить ИИ и показать: один фильм — обычный поиск по названию, несколько — слайдер из них. */
    function aiFlow(query, status) {
        status(askingAi());
        aiSearch(query, function (r, why) {
            if (!r) return status(notFound(query) + (why ? ' — ' + String(why).replace(/^[^\wА-Яа-яЁё]+/, '').split('\n')[0].slice(0, 160) : L(', и ИИ не понял', " and AI didn't understand", " va sun'iy intellekt tushunmadi")) +
                L('.\nПопробуйте иначе или пришлите скриншот.', '.\nTry different words or send a screenshot.', ".\nBoshqacha yozib ko'ring yoki skrinshot yuboring."));
            if (r.items.length === 1) { status((r.sure ? L('🤖 Похоже, вы ищете: ', "🤖 Looks like you're looking for: ", "🤖 Siz izlayotganingiz shu bo'lsa kerak: ") : L('🤖 Возможно, это: ', "🤖 Maybe it's: ", "🤖 Balki bu: ")) + r.items[0].title); return botSearch(r.items[0].query, true); }
            aiSlides(r.items, status, query);
        }, function (id) { status(askingAi(id)); });
    }
    /** Описание, а не название: 5+ слов, без года и студии. */
    function isDescription(q) {
        var w = String(q || '').replace(/^\s+|\s+$/g, '').split(/\s+/);
        if (w.length < 5) return false;
        var p = parseQuery(q);
        return !p.year && !p.studio;
    }

    /* Сроки: на модель до 20 с, на весь запрос — 45 с, потом честное «долго не отвечает». Flash-моделям — без долгого
     * «обдумывания» (thinkingBudget 0): ответ за 1–3 с вместо 10–30; модель такое не принимает — спросить её без этого. */
    var GEMINI_MODEL_WAIT = 20000, GEMINI_TOTAL = 45000;
    function geminiBody(parts, id, plain) {
        var gc = { temperature: 0, responseMimeType: 'application/json' };
        if (!plain && /flash/.test(id) && !/gemini-(1\.|2\.0)/.test(id)) gc.thinkingConfig = { thinkingBudget: 0 };
        return JSON.stringify({ contents: [{ parts: parts }], generationConfig: gc });
    }

    function geminiSlow() { return L('⏳ Gemini долго не отвечает — попробуйте ещё раз через минуту.', '⏳ Gemini is taking too long to answer — try again in a minute.', "⏳ Gemini uzoq vaqt javob bermayapti — bir daqiqadan keyin qayta urinib ko'ring."); }

    /** onTry(id) — какую модель спрашиваем сейчас (для «Спрашиваю ИИ…»). */
    function geminiRun(parts, ok, fail, onTry) {
        ok = keep(ok); fail = keep(fail); onTry = keep(onTry);
        // чей ключ — решаем сразу: ответы моделей приходят позже, когда «кто спрашивал» уже другой
        var key = aiSlot('gemini'), sk = skipKey(), deadline = Date.now() + GEMINI_TOTAL, plain = {};
        geminiModels(function (models) {
            var skip = skipped(sk), tried = [], i = 0;
            models.forEach(function (id) { if (skip[id]) tried.push({ id: id, kind: skip[id].kind, until: skip[id].until }); });
            var queue = models.filter(function (id) { return !skip[id]; });
            (function next() {
                if (i >= queue.length || i >= 6) return fail(geminiSummary(tried, Date.now()));
                if (Date.now() > deadline - 3000) return fail(geminiSlow());
                var id = queue[i++], x = new XMLHttpRequest();
                if (onTry) try { onTry(id); } catch (e) {}
                try {
                    aiOpen(x, 'POST', 'gemini', 'models/' + id + ':generateContent', key);   // ключ — заголовком, не в адресе
                    x.setRequestHeader('Content-Type', 'application/json');
                    x.timeout = Math.max(5000, Math.min(GEMINI_MODEL_WAIT, deadline - Date.now()));
                    x.onload = keep(function () {
                        if (x.status === 200) {
                            var j = null;
                            try { j = JSON.parse(x.responseText); } catch (e) {}
                            lsSet('bs_gemini_last', id);
                            return ok(j, id);
                        }
                        if (x.status === 400 && !plain[id] && /thinking/i.test(x.responseText)) { plain[id] = 1; i--; return next(); }
                        var er = geminiError(x.status, x.responseText, Date.now());
                        log('gemini', id + ': ' + x.status + ' ' + er.kind);
                        if (er.kind === 'key') {
                            var kw = er.why ? ': ' + String(er.why).slice(0, 160) : '';
                            return fail(L('❌ Ключ Gemini не подошёл' + kw + ' — пришлите новый (aistudio.google.com/apikey).', '❌ The Gemini key was rejected' + kw + ' — send a new one (aistudio.google.com/apikey).',
                                '❌ Gemini kaliti mos kelmadi' + kw + ' — yangisini yuboring (aistudio.google.com/apikey).'));
                        }
                        if (er.kind === 'region') return fail(L('🌍 Gemini недоступен в вашей стране.', '🌍 Gemini is not available in your country.', '🌍 Gemini mamlakatingizda mavjud emas.'));
                        if (er.until) { var sm = lsJson(sk, {}); sm[id] = { kind: er.kind, until: er.until }; lsSet(sk, JSON.stringify(sm)); }
                        if (er.kind === 'missing') lsSet('bs_gemini_models2', '');       // список устарел — перечитать в следующий раз
                        tried.push({ id: id, kind: er.kind, until: er.until, why: er.why });
                        next();
                    });
                    x.onerror = keep(function () { aiNet(key); fail(L('📡 Нет связи с Gemini — проверьте интернет на ТВ.', '📡 No connection to Gemini — check the internet on the TV.', "📡 Gemini bilan aloqa yo'q — televizorda internetni tekshiring.")); });
                    x.ontimeout = keep(function () { tried.push({ id: id, kind: 'busy' }); next(); });
                    x.send(geminiBody(parts, id, plain[id]));
                } catch (e) { fail(e.message); }
            })();
        });
    }

    /** «🖼 По картинке»: что с Gemini сейчас — модели, лимиты, кто отвечал последним. */
    function aiStatus() {
        var list = aiProviders(), names = list.map(function (x) { return x.p === 'gemini' ? '🔷 Gemini' : x.p === 'groq' ? '⚡ Groq' : '🌐 OpenRouter'; });
        var head = L('🖼 Пришлите скриншот, кадр или постер — узнаю фильм.\n\n🤖 ИИ (по очереди): ', "🖼 Send a screenshot, a frame or a poster — I'll recognize the movie.\n\n🤖 AI (in turn): ",
            "🖼 Skrinshot, kadr yoki poster yuboring — filmni aniqlayman.\n\n🤖 Sun'iy intellekt (navbat bilan): ") + names.join(' → ') +
            (list.length < 3 ? L('\nДобавьте ещё ключ — будет запасной ИИ (Groq: console.groq.com/keys, OpenRouter: openrouter.ai/keys).', '\nAdd another key for a backup AI (Groq: console.groq.com/keys, OpenRouter: openrouter.ai/keys).',
                "\nYana bir kalit qo'shing — zaxira sun'iy intellekt bo'ladi (Groq: console.groq.com/keys, OpenRouter: openrouter.ai/keys).") : '');
        if (!aiKey('gemini')) return reply(head + '\n\n' + newKeyHint());
        reply(head);
        geminiStatus();
    }
    function newKeyHint() { return L('Чтобы добавить новый ключ, просто пришлите его сообщением.', 'To add a new key, just send it as a message.', "Yangi kalit qo'shish uchun uni shunchaki xabar qilib yuboring."); }
    function geminiStatus() {
        geminiModels(function (models, fresh) {
            var skip = skipped(), last = lsGet('bs_gemini_last') || '';
            var free = models.filter(function (id) { return !skip[id]; });
            var lines = [];
            lines.push(fresh ? L('🔷 Модели Gemini для вашего ключа: ', '🔷 Gemini models for your key: ', '🔷 Kalitingiz uchun Gemini modellari: ') + models.length
                : L('🤖 Не удалось получить список моделей — пробую известные.', "🤖 Couldn't get the model list — trying the known ones.", "🤖 Modellar ro'yxatini olib bo'lmadi — ma'lum modellarni sinab ko'raman."));
            if (free.length) lines.push(L('✅ Доступны: ', '✅ Available: ', '✅ Mavjud: ') + free.slice(0, 4).join(', ') + (free.length > 4 ? L(' и ещё ', ' and ', ' va yana ') + (free.length - 4) + L('', ' more', '') : ''));
            models.forEach(function (id) { if (skip[id]) lines.push('⛔ ' + id + ' — ' + kindText(skip[id].kind) + untilText(skip[id].until)); });
            if (!free.length) lines.push(L('🔋 Сейчас ни одна модель не доступна — лимит закончился.', '🔋 No model is available right now — the limit is used up.', '🔋 Hozir birorta ham model mavjud emas — limit tugadi.'));
            if (last) lines.push(L('Последней отвечала: ', 'Last answered by: ', 'Oxirgi javob bergan: ') + last);
            lines.push('', newKeyHint());
            reply(lines.join('\n'));
        }, true);
    }

    function geminiHow() {
        return L('🤖 Поиск по картинке и по описанию работает через ИИ — нужен бесплатный ключ (можно несколько — бот будет обращаться к ним по очереди):\n' +
            '⚡ Groq — самый быстрый: console.groq.com/keys → «Create API Key» (ключ начинается с gsk_)\n' +
            '🔷 Gemini (Google): aistudio.google.com/apikey → «Create API key» (AQ. или AIza)\n' +
            '🌐 OpenRouter: openrouter.ai/keys → «Create» (sk-or-), бесплатно 50 запросов в день\n\n' +
            'Пришлите ключ сюда сообщением — сохраню его на ТВ и удалю из чата.' + (isOwner() ? '' : ' Это будет ваш личный ключ — его лимит тратите только вы.'),
            '🤖 Search by picture and by description works through AI — you need a free key (you can add several — the bot will use them in turn):\n' +
            '⚡ Groq — the fastest: console.groq.com/keys → “Create API Key” (the key starts with gsk_)\n' +
            '🔷 Gemini (Google): aistudio.google.com/apikey → “Create API key” (AQ. or AIza)\n' +
            '🌐 OpenRouter: openrouter.ai/keys → “Create” (sk-or-), 50 free requests a day\n\n' +
            "Send the key here as a message — I'll save it on the TV and delete it from the chat." + (isOwner() ? '' : ' This will be your personal key — only you use up its limit.'),
            "🤖 Rasm va tavsif bo'yicha qidiruv sun'iy intellekt orqali ishlaydi — bepul kalit kerak (bir nechtasini qo'shsa ham bo'ladi — bot ulardan navbat bilan foydalanadi):\n" +
            '⚡ Groq — eng tezkori: console.groq.com/keys → «Create API Key» (kalit gsk_ bilan boshlanadi)\n' +
            '🔷 Gemini (Google): aistudio.google.com/apikey → «Create API key» (AQ. yoki AIza)\n' +
            "🌐 OpenRouter: openrouter.ai/keys → «Create» (sk-or-), kuniga 50 ta bepul so'rov\n\n" +
            "Kalitni shu yerga xabar qilib yuboring — televizorda saqlayman va chatdan o'chiraman." + (isOwner() ? '' : " Bu shaxsiy kalitingiz bo'ladi — uning limitidan faqat siz foydalanasiz."));
    }

    function photoSearch(msg) {
        if (!aiReady()) return reply(geminiHow());
        var file = null, mime = 'image/jpeg';
        if (msg.photo && msg.photo.length) {
            file = msg.photo[msg.photo.length - 1];
            for (var i = 0; i < msg.photo.length; i++) if (msg.photo[i].width >= 1000) { file = msg.photo[i]; break; }   // хватит и 1280
        } else if (msg.document && /^image\//.test(msg.document.mime_type || '')) { file = msg.document; mime = msg.document.mime_type; }
        if (!file) return;
        if (file.file_size > 15 * 1024 * 1024) return reply(L('Картинка слишком большая — отправьте её как фото (со сжатием).', 'The picture is too big — send it as a photo (compressed).', "Rasm juda katta — uni siqilgan foto sifatida yuboring."));
        call('sendChatAction', { chat_id: to(), action: 'typing' }, null, null);
        var statusId = 0, status = function (t) {
            if (statusId) call('editMessageText', { chat_id: to(), message_id: statusId, text: t }, null, null);
            else reply(t);
        };
        call('sendMessage', { chat_id: to(), text: L('🖼 Узнаю по картинке…', '🖼 Recognizing the picture…', '🖼 Rasm bo\'yicha aniqlayapman…') }, function (m) { statusId = m && m.message_id || 0; }, null);
        var fail = function (why) { log('картинка', why); status(/^[^\wА-Яа-яЁё]/.test(why) ? why : L('😔 Не получилось узнать: ', "😔 Couldn't recognize it: ", "😔 Aniqlab bo'lmadi: ") + whyText(why) + '.'); };
        call('getFile', { file_id: file.file_id }, function (f) {
            if (!f || !f.file_path) return fail(L('Telegram не отдал картинку', "Telegram didn't send the picture", 'Telegram rasmni bermadi'));
            httpGetBin(svcTg() ? SVC + '/tgfile/' + f.file_path : 'https://api.telegram.org/file/bot' + token() + '/' + f.file_path, function (buf) {
                geminiAsk(bytesB64(buf), mime, String(msg.caption || '').slice(0, 200), function (j, model) {
                    var r = fromGemini(j);
                    if (!r) return status(L('🤔 Не удалось узнать фильм (' + model + '). Напишите название — найду.', "🤔 Couldn't tell which movie this is (" + model + "). Type the name and I'll find it.",
                        "🤔 Bu qaysi film ekanini aniqlay olmadim (" + model + "). Nomini yozing — topaman."));
                    status((r.sure ? L('🎬 Похоже на: ', '🎬 Looks like: ', "🎬 Bunga o'xshaydi: ") : L('🤔 Возможно, это: ', '🤔 Maybe it is: ', '🤔 Balki bu: ')) + r.title + '\n🤖 ' + model);
                    log('картинка', r.query);
                    botSearch(r.query);
                }, fail);
            }, function (e) { fail(L('не скачалась из Telegram (', "couldn't download from Telegram (", "Telegram'dan yuklab bo'lmadi (") + e + ')'); }, null);
        }, function (e) { fail(e); });
    }

    var renameFor = null, renameWait = null;
    /* Слова кнопок и разделов, написанные текстом, — на всех трёх языках (у каждого своё меню). */
    var WORDS = {
        help: ['помощь', 'help', 'yordam'],
        menu: ['меню', 'menu', 'menyu'],
        profile: ['профиль', 'profile', 'profil'],
        tvs: ['телевизоры', 'tvs', 'televizorlar'],
        find: ['найти', 'find', 'topish'],
        type: ['набрать на тв', 'type on tv', "tv'da yozish"],
        want: ['хочу посмотреть', 'want to watch', "ko'rmoqchiman"],
        people: ['люди', 'people', 'odamlar'],
        pic: ['по картинке', 'by picture', "rasm bo'yicha"],
        week: ['на этой неделе', 'на неделе', 'this week', 'bu hafta'],
        subs: ['мои подписки', 'подписки', 'my subscriptions', 'subscriptions', 'obunalarim', 'obunalar'],
        lang: ['язык', 'language', 'til', 'язык / language / til'],
        settings: ['настройки', 'settings', 'sozlamalar']
    };
    var KB_WORDS = [];
    (function () { for (var k in WORDS) if (WORDS.hasOwnProperty(k)) KB_WORDS = KB_WORDS.concat(WORDS[k]); })();
    /** Текст без эмодзи и знаков в начале, строчными; узбекские ʻ ’ — как обычный апостроф. */
    function plainOf(t) { return String(t || '').replace(/^\s+|\s+$/g, '').replace(/^[^\wА-Яа-яЁё]+/, '').replace(/[ʻʼ‘’`]/g, "'").toLowerCase(); }
    function isWord(p, k) { return WORDS[k].indexOf(p) >= 0; }

    /** Чей это апдейт; чужим — только подключение по приглашению. */
    function chatOf(u) { var m = u.callback_query ? u.callback_query.message : u.message; return m && m.chat ? String(m.chat.id) : ''; }
    /** Кто не выбирал язык: подключённым — русский (как раньше), чужим — язык их Telegram. */
    function hintLang(u, c) {
        var from = u.callback_query ? u.callback_query.from : u.message && u.message.from;
        if (from && from.language_code && !langMap()[c]) langHint[c] = allowed(c) ? 'ru' : codeLang(from.language_code);
    }
    function handle(u) {
        var c = chatOf(u);
        if (!c) return;
        hintLang(u, c);
        if (!allowed(c)) return stranger(u, c);
        as(c, function () { handleIn(u); });
    }

    function handleIn(u) {
        if (u.callback_query) {
            var q = u.callback_query, sm = /^([wosxvq]):([mt]):(\d+)$/.exec(q.data || ''), m = /^([ul]):(\d+)$/.exec(q.data || '');
            if (!q.message) return;
            var st = /^st:([\w:]+)$/.exec(q.data || '');
            if (st) {
                if (!/^d:/.test(st[1])) call('answerCallbackQuery', { callback_query_id: q.id }, null, null);
                delLater(to(), q.message.message_id, TMP_LONG);
                return settingsAction(q, st[1]);
            }
            var lg = /^lg:(ru|en|uz)$/.exec(q.data || '');
            if (lg) {
                call('answerCallbackQuery', { callback_query_id: q.id }, null, null);
                setLang(lg[1]);
                delNow(to(), q.message.message_id);
                // с подтверждением приходит нижняя кнопка «Меню» на новом языке — его не удаляем (вместе с ним
                // некоторые Telegram убирают и кнопку); меню — когда оно дошло
                return call('sendMessage', { chat_id: to(), text: L('✅ Язык: русский', '✅ Language: English', "✅ Til: o'zbekcha"), reply_markup: JSON.stringify(kb()) },
                    function () { sendMenu(); }, function () { sendMenu(); });
            }
            var mn = /^mn:(\w+)$/.exec(q.data || '');
            if (mn) {                                                   // нажали плитку — само меню больше не нужно
                call('answerCallbackQuery', { callback_query_id: q.id }, null, null);
                if (q.message.message_id === lastMenu[to()]) lastMenu[to()] = 0;
                delLater(to(), q.message.message_id);              // уберётся, когда появится ответ
                return menuAction(mn[1]);
            }
            var ku = /^ku:(-?\d+)$/.exec(q.data || '');
            var okk = /^ok:(-?\d+)$/.exec(q.data || '');
            if (okk) {
                call('answerCallbackQuery', { callback_query_id: q.id }, null, null);
                if (!isOwner()) return;
                var back = users(), was = back[okk[1]];
                if (!was || !(was.banned || was.pending)) return reply(L('Уже подключён.', 'Already connected.', 'Allaqachon ulangan.'));
                var first = !!was.pending;
                back[okk[1]] = { name: was.name, at: Date.now(), want: [], subs: [], muted: [], later: [] };
                saveUsers(back, [okk[1]]);
                as(okk[1], function () {
                    sendKb((first ? L('✅ Владелец разрешил — вы подключены к Lampa.\nУ вас свои «Хочу посмотреть» и подписки — другие их не видят.',
                        "✅ The owner allowed it — you're connected to Lampa.\nYou have your own “Want to watch” and subscriptions — others can't see them.",
                        "✅ Bot egasi ruxsat berdi — siz Lampa'ga ulandingiz.\n«Ko'rmoqchiman» ro'yxatingiz va obunalaringiz faqat sizniki — boshqalar ularni ko'rmaydi.")
                        : L('✅ Владелец разрешил — вы снова подключены к Lampa.', "✅ The owner allowed it — you're connected to Lampa again.", "✅ Bot egasi ruxsat berdi — siz Lampa'ga qayta ulandingiz.")) + '\n\n' + helpText());
                    langAskOnce();
                });
                return reply('✅ ' + was.name + (first ? L(' подключён.', ' is connected.', ' ulandi.') : L(' снова подключён.', ' is connected again.', ' qayta ulandi.')));
            }
            if (ku) {
                call('answerCallbackQuery', { callback_query_id: q.id }, null, null);
                if (!isOwner()) return;
                var people = users(), gone = people[ku[1]];
                if (gone && gone.pending) {
                    people[ku[1]] = { name: gone.name, banned: true, at: Date.now() };
                    saveUsers(people, [ku[1]]);
                    as(ku[1], function () { reply(L('Владелец не разрешил подключение.', "The owner didn't allow the connection.", 'Bot egasi ulanishga ruxsat bermadi.')); });
                    return reply(L('🚫 Запрос от ' + gone.name + ' отклонён.', '🚫 ' + gone.name + "'s request was declined.", '🚫 ' + gone.name + " so'rovi rad etildi."));
                }
                if (!active(gone)) return reply(L('Уже отключён.', 'Already disconnected.', 'Allaqachon uzilgan.'));
                people[ku[1]] = { name: gone.name, banned: true, at: Date.now() };   // запомнить: по старому QR не вернётся
                saveUsers(people, [ku[1]]);
                as(ku[1], function () { reply(L('Вас отключили от Lampa. Чтобы подключиться снова, отсканируйте QR-код в поиске Lampa на ТВ.', 'You were disconnected from Lampa. To connect again, scan the QR code in Lampa search on the TV.', "Siz Lampa'dan uzildingiz. Qayta ulanish uchun televizordagi Lampa qidiruvidagi QR-kodni skanerlang.")); });
                return reply(L('🚫 ' + gone.name + ' отключён.', '🚫 ' + gone.name + ' is disconnected.', '🚫 ' + gone.name + ' uzildi.'));
            }
            var tp = /^tp:(\w+)$/.exec(q.data || '');
            if (tp) {
                call('answerCallbackQuery', { callback_query_id: q.id }, null, null);
                if (!isOwner() && !guestPlay()) return reply(noRemote());
                return typeWait(tp[1]);
            }
            var pg = /^p:(\d+)$/.exec(q.data || ''), dv = /^([dD]):(\w+):([mt]):(\d+)$/.exec(q.data || '');
            if (pg) return slideTo(q, +pg[1]);
            if (dv && !isOwner() && !guestPlay()) return call('answerCallbackQuery', { callback_query_id: q.id, text: noPlay() }, null, null);
            if (dv) return openOn(q, dv[2], dv[3], dv[4], dv[1] === 'D');
            var cf = /^cfg:(\w+)$/.exec(q.data || '');
            if (cf) {
                call('answerCallbackQuery', { callback_query_id: q.id }, null, null);
                if (!isOwner()) return;
                if (cf[1] === 'inv') {
                    inviteReset();
                    return reply(L('🔄 Приглашение обновлено: старые QR-коды и ссылки больше не работают. Кто уже подключён, останется подключён.', '🔄 Invite reset: old QR codes and links no longer work. People already connected stay connected.',
                        "🔄 Taklif yangilandi: eski QR-kodlar va havolalar endi ishlamaydi. Ulanganlar ulangan holda qoladi."));
                }
                if (cf[1] === 'ap') lsSet('bs_tg_approve', String(!needApprove()));
                if (cf[1] === 'play') lsSet('bs_tg_guest_play', String(!guestPlay()));
                cfgSend();
                return peopleList(q);
            }
            if (q.data === 'n') return call('answerCallbackQuery', { callback_query_id: q.id }, null, null);
            var rn = /^rn(?::(\w+))?$/.exec(q.data || '');
            if (rn) {
                call('answerCallbackQuery', { callback_query_id: q.id }, null, null);
                if (!isOwner()) return reply(L('Переименовать ТВ может только владелец бота.', 'Only the bot owner can rename a TV.', "Televizor nomini faqat bot egasi o'zgartira oladi."));
                var tvs = allTvs();
                if (!rn[1] && tvs.length > 1) return reply(L('✏️ Какой ТВ переименовать?', '✏️ Which TV to rename?', "✏️ Qaysi televizor nomini o'zgartiramiz?"), tvs.map(function (d) { return [{ text: d.text, callback_data: 'rn:' + d.id }]; }));
                var who = tvs.filter(function (d) { return d.id === (rn[1] || tvId); })[0];
                if (!who) return reply(L('Этот ТВ сейчас не на связи.', 'This TV is offline now.', 'Bu televizor hozir aloqada emas.'));
                renameFor = { id: who.id, at: Date.now(), chat: to() };
                var wn = who.text.replace(/^📺 /, '');
                return reply(L('✏️ Напишите новое название для «' + wn + '» — например «Зал» или «Спальня».', '✏️ Type a new name for “' + wn + '” — for example “Living room” or “Bedroom”.',
                    "✏️ «" + wn + "» uchun yangi nom yozing — masalan, «Mehmonxona» yoki «Yotoqxona»."));
            }
            if (sm) return searchAction(q, sm[1], sm[2], sm[3]);
            if (!m) return;
            var id = m[2], name = (loadSeen()[id] || {}).name || '';
            if (!isOwner()) {
                updGuest(function (g) {
                    if (m[1] === 'u') {
                        g.subs = (g.subs || []).filter(function (c) { return c.id != id; });
                        if ((g.muted || []).indexOf(id) < 0) g.muted = [id].concat(g.muted || []).slice(0, 500);
                    } else {
                        var d0 = new Date();
                        g.later = (g.later || []).filter(function (x) { return x.id !== id; }).concat([{ id: id, name: name, at: new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + 1, 9, 0).getTime() }]).slice(-50);
                    }
                });
                return call('answerCallbackQuery', { callback_query_id: q.id, text: m[1] === 'u' ? noMore(name) : remindAt() }, null, null);
            }
            if (m[1] === 'u') {
                setSubAll({ id: id }, false);
                var mu = mutedList(); if (mu.indexOf(id) < 0) mu.unshift(id);
                lsSet('bs_tg_muted', JSON.stringify(mu.slice(0, 500)));
                call('answerCallbackQuery', { callback_query_id: q.id, text: noMore(name) }, null, null);
            } else {
                var d = new Date(), at = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 9, 0).getTime();
                var later = lsJson('bs_tg_later', []).filter(function (x) { return x.id !== id; });
                later.push({ id: id, name: name, at: at });
                lsSet('bs_tg_later', JSON.stringify(later.slice(-50)));
                call('answerCallbackQuery', { callback_query_id: q.id, text: remindAt() }, null, null);
            }
            return;
        }
        var msg = u.message;
        if (!msg) return;
        if (msg.photo || (msg.document && /^image\//.test(msg.document.mime_type || ''))) return photoSearch(msg);
        if (typeof msg.text !== 'string') return;
        // ключ ИИ — раньше переименования и «Набрать на ТВ»: иначе ключ мог стать названием ТВ или уйти в поиск
        if (isGeminiKey(msg.text)) {                                         // похоже на ключ — сразу из чата, в поиск не отдаём (у каждого свой)
            var key = msg.text.replace(/\s+/g, ''), kind = keyKind(key), kname = kind === 'gemini' ? 'Gemini' : OA[kind].name;
            call('deleteMessage', { chat_id: to(), message_id: msg.message_id }, null, null);
            return (kind === 'gemini' ? geminiCheck : function (k, cb) { oaCheck(kind, k, cb); })(key, function (good, why) {
                if (good === false) return reply(L('❌ Похоже на ключ ' + kname + ', но он не подошёл: ' + why + '\nСообщение удалено. Проверьте ключ и пришлите ещё раз.',
                    '❌ Looks like a ' + kname + ' key, but it was rejected: ' + why + '\nI deleted the message. Check the key and send it again.',
                    "❌ " + kname + " kalitiga o'xshaydi, lekin qabul qilinmadi: " + why + "\nXabar o'chirildi. Kalitni tekshirib, qayta yuboring."));
                setAiKey(kind, key);
                reply(L('✅ ' + (isOwner() ? 'Ключ' : 'Ваш ключ') + ' ' + kname + ' сохранён на ТВ «' + tvName() + '», сообщение с ним удалено.',
                    '✅ ' + (isOwner() ? 'The ' : 'Your ') + kname + ' key is saved on TV “' + tvName() + '” and the message with it is deleted.',
                    '✅ ' + (isOwner() ? '' : 'Sizning ') + kname + " kalitingiz «" + tvName() + "» televizorida saqlandi, kalitli xabar o'chirildi.") +
                    (good ? '' : L('\n(Проверить сейчас не удалось — проверю на первой картинке.)', "\n(Couldn't check it now — I'll check it with the first picture.)", "\n(Hozir tekshirib bo'lmadi — birinchi rasmda tekshiraman.)")) +
                    L('\nТеперь пришлите скриншот или постер 🖼', '\nNow send a screenshot or a poster 🖼', '\nEndi skrinshot yoki poster yuboring 🖼'));
            });
        }
        if (renameFor && renameFor.chat === to() && Date.now() - renameFor.at < 5 * 60000 && !/^\//.test(msg.text) && KB_WORDS.indexOf(plainOf(msg.text)) < 0) {
            var title = cleanName(msg.text), target = renameFor.id;          // как другие имена: без символов разметки
            renameFor = null;
            if (!title) return reply(L('Название пустое — нажмите «✏️ Переименовать ТВ» ещё раз.', 'The name is empty — tap “✏️ Rename TV” again.', "Nom bo'sh — «✏️ TV nomini o'zgartirish» tugmasini qayta bosing."));
            if (target === tvId) { lsSet('bs_tv_name', title); busHello(false); refreshSettings(); }
            if (target === tvId) return reply(renamed(title));
            // другой ТВ: подтвердит своим «hello» с новым именем; молчит — значит, на нём старая Lampa или он выключен
            if (renameWait) clearTimeout(renameWait.timer);
            var oldName = ((devices[target] || {}).name) || L('ТВ', 'TV', 'TV');
            renameWait = { to: target, title: title, chat: to(), timer: setTimeout(keep(function () {
                renameWait = null;
                reply(L('⚠️ «' + oldName + '» не ответил. Похоже, на нём старая версия Lampa или он выключен — обновите Lampa на нём и переименуйте снова.',
                    "⚠️ “" + oldName + "” didn't answer. It probably has an old Lampa version or is off — update Lampa on it and rename again.",
                    "⚠️ «" + oldName + "» javob bermadi. Ehtimol, unda Lampa'ning eski versiyasi o'rnatilgan yoki u o'chiq — undagi Lampa'ni yangilang va qayta nomlang."));
            }), 15000) };
            busSend({ t: 'rename', to: target, title: title });
            return;
        }
        renameFor = null;
        // «⌨️ Набрать на ТВ»: следующее сообщение (не команда и не кнопка) — в поиск Lampa
        if (typeFor && typeFor.chat === to() && Date.now() - typeFor.at < TYPE_WAIT && !/^\//.test(msg.text) &&
            KB_WORDS.indexOf(plainOf(msg.text)) < 0) { delLater(to(), msg.message_id); return tmp(TMP_SHORT, function () { typeSend(msg.text); }); }
        if (typeFor && typeFor.chat === to()) typeFor = null;
        var jc = isOwner() && joinFrom(msg.text);
        if (jc) return joinSend(jc);
        var t = msg.text.replace(/^\s+|\s+$/g, ''), cmd = /^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/.exec(t);
        var c = cmd ? cmd[1].toLowerCase() : '', arg = cmd ? cmd[2] : t, plain = plainOf(t);
        // команда или слово с клавиатуры — техническое: убираем сразу, ответ на него тоже служебный
        if ((c && c !== 'find' && c !== 'start') || KB_WORDS.indexOf(plain) >= 0) {
            delLater(to(), msg.message_id);                       // уберётся вместе с прошлым ответом, когда придёт новый
            return tmp(TMP_LONG, function () { return command(c, plain, arg, t); });
        }
        return command(c, plain, arg, t);
    }
    function command(c, plain, arg, t) {
        if (c === 'start') {
            sendKb(L('👋 Это бот вашей Lampa на ТВ.\nНапишите название фильма или сериала — или выберите раздел 👇', '👋 This is the bot for your Lampa on the TV.\nType the name of a movie or series — or choose a section 👇',
                "👋 Bu televizoringizdagi Lampa boti.\nFilm yoki serial nomini yozing — yoki bo'limni tanlang 👇"));
            langAskOnce();
            return setTimeout(keep(sendMenu), 400);
        }
        if (c === 'help' || isWord(plain, 'help')) return menuAction('help');
        if (c === 'menu' || isWord(plain, 'menu')) return sendMenu();
        if (c === 'profile' || isWord(plain, 'profile')) return menuAction('profile');
        if (c === 'tvs' || isWord(plain, 'tvs')) return tvsInfo();
        if (c === 'lang' || isWord(plain, 'lang')) return menuAction('lang');
        if (c === 'settings' || isWord(plain, 'settings')) return menuAction('settings');
        if (isWord(plain, 'find')) return askTitle();
        if (c === 'type' || isWord(plain, 'type')) return typeStart();
        if (c === 'want' || isWord(plain, 'want')) return wantList();
        if (isWord(plain, 'people')) return peopleList();
        if (isWord(plain, 'pic')) return aiReady() ? aiStatus() : reply(geminiHow());
        if (c === 'week' || isWord(plain, 'week')) return reply(weekText(true));
        if (c === 'subs' || isWord(plain, 'subs')) return subsList();
        if (c && c !== 'find') return sendMenu();
        var query = (c === 'find' ? arg : t).replace(/^(найти|topish)\s+/i, '').replace(/^\s+|\s+$/g, '');
        if (!query) return askTitle();
        botSearch(query);
    }

    /** «🔔 Мои подписки»: список с датами следующих серий и кнопками «Отписаться». */
    function subsList() {
        var l = isOwner() ? subs() : ((guest() || {}).subs || []), seen = loadSeen();
        if (!l.length) return reply(L('🔔 Подписок пока нет.\nНапишите название сериала и нажмите «🔔 Подписаться» — или подпишитесь кнопкой на карточке в Lampa.',
            '🔔 No subscriptions yet.\nType the name of a series and tap “🔔 Subscribe” — or use the button on the series card in Lampa.',
            "🔔 Hozircha obunalar yo'q.\nSerial nomini yozing va «🔔 Obuna bo'lish» tugmasini bosing — yoki Lampa'dagi kartochkadagi tugma orqali obuna bo'ling."));
        var lines = l.slice(0, 30).map(function (s) {
            var r = seen[s.id] || {}, n = r.next;
            return '• ' + (s.name || r.name || '') + (n && n.d ? ' — ' + n.s + '×' + n.e + ', ' + n.d.split('-').reverse().slice(0, 2).join('.') : '');
        });
        return reply(L('🔔 Ваши подписки:\n', '🔔 Your subscriptions:\n', '🔔 Obunalaringiz:\n') + lines.join('\n') + L('\n\nНажмите, чтобы отписаться:', '\n\nTap to unsubscribe:', '\n\nObunani bekor qilish uchun bosing:'),
            l.slice(0, 8).map(function (s) { return [{ text: '🔕 ' + (s.name || s.id), callback_data: 'u:' + s.id }]; }));
    }

    /* ---------- подписка в плеере ---------- */

    function subs() { try { var l = JSON.parse(lsGet('bs_subs') || '[]'); return Object.prototype.toString.call(l) === '[object Array]' ? l : []; } catch (e) { return []; } }
    function subscribed(id) { var g = guest(); return (g ? g.subs || [] : subs()).some(function (c) { return c && c.id == id; }); }
    function setSub(card, state, info) {
        info = info || tvInfo;
        var l = subs().filter(function (c) { return c && c.id != card.id; });
        if (state) l.unshift({ id: card.id, name: card.name || card.title || '', original_name: card.original_name || '', poster_path: card.poster_path || '', source: card.source || 'tmdb', first_air_date: card.first_air_date || '' });
        lsSet('bs_subs', JSON.stringify(l.slice(0, 200)));
        if (state) {                                   // текущая серия — уже известная, сообщать будем о следующих
            var all = loadSeen();
            if (!all[card.id] && info && info.id == card.id && info.last) all[card.id] = { s: info.last.season_number | 0, e: info.last.episode_number | 0, at: Date.now() };
            var mu = mutedList().filter(function (x) { return x !== String(card.id); });   // подписался снова — снова пишем
            lsSet('bs_tg_muted', JSON.stringify(mu));
            lsSet('bs_tg_seen', JSON.stringify(trimSeen(all)));
        }
    }

    var MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    var MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var MONTHS_UZ = ['yan', 'fev', 'mar', 'apr', 'may', 'iyun', 'iyul', 'avg', 'sen', 'okt', 'noy', 'dek'];
    /** «Следующая серия: 12×17 — через 3 дня (16 окт)»; next — next_episode_to_air TMDB, today — полночь сегодня.
     *  l — язык (для Telegram); без него — русский: та же строка идёт и в панель плеера на ТВ. */
    function nextText(next, today, l) {
        if (!next || !next.air_date) return T3(l, 'Дата следующей серии пока не объявлена', 'The next episode date is not announced yet', "Keyingi qism sanasi hali e'lon qilinmagan");
        var p = next.air_date.split('-'), air = new Date(+p[0], +p[1] - 1, +p[2]).getTime();
        var days = Math.round((air - today) / 86400000), when;
        if (days <= 0) when = T3(l, 'сегодня', 'today', 'bugun');
        else if (days === 1) when = T3(l, 'завтра', 'tomorrow', 'ertaga');
        else {
            var n = days % 10, nn = days % 100;
            when = T3(l, 'через ' + days + ' ' + (n === 1 && nn !== 11 ? 'день' : n >= 2 && n <= 4 && (nn < 12 || nn > 14) ? 'дня' : 'дней'), 'in ' + days + ' days', days + ' kundan keyin');
        }
        return T3(l, 'Следующая серия: ', 'Next episode: ', 'Keyingi qism: ') + next.season_number + '×' + next.episode_number + ' — ' + when +
            ' (' + (+p[2]) + ' ' + T3(l, MONTHS, MONTHS_EN, MONTHS_UZ)[+p[1] - 1] + ')';
    }
    /** Последняя ли вышедшая серия смотрится. */
    function isLatest(s, e, last) { return !!last && (s | 0) === (last.season_number | 0) && (e | 0) === (last.episode_number | 0); }

    var tvInfo = null, tvCache = {};
    function playerCard(data) {
        var c = (data && (data.card || data.movie)) || null;
        if (!c) { try { var a = Lampa.Activity.active() || {}; c = a.movie || a.card || null; } catch (e) {} }
        return c && c.id > 0 && (c.name || c.original_name || c.number_of_seasons || c.first_air_date) ? c : null;
    }
    function today() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }

    /** Подписался / отписался — подтверждение в Telegram (если бот подключён). */
    function subNotify(card, on, info) {
        info = info || tvInfo;
        if (!hasToken() || !chat()) return;
        var name = card.name || card.title || card.original_name || '';
        if (!on) return send(L('🔕 Подписка отменена: ', '🔕 Unsubscribed: ', '🔕 Obuna bekor qilindi: ') + name, null, null, function (e) { log('не отправлено', e); });
        var text = L('🔔 Вы подписались: ', '🔔 Subscribed: ', "🔔 Obuna bo'ldingiz: ") + name + '\n' + nextText(info && info.id == card.id ? info.next : null, today(), lang()) +
            L('\nСообщу, когда выйдет новая серия.', "\nI'll let you know when a new episode is out.", '\nYangi qism chiqqanda xabar beraman.');
        var poster = card.poster_path ? 'https://image.tmdb.org/t/p/w500' + card.poster_path : null;
        send(text, poster, null, function (e) { log('не отправлено', e); });
    }

    /** Данные о сериале из TMDB (на час — из памяти): {id, last, next, json}. */
    function tvLoad(id, cb) {
        var c = tvCache[id];
        if (c && Date.now() - c.at < 3600000) return cb(c);
        new Lampa.Reguest().silent(Lampa.TMDB.api('tv/' + id + '?api_key=' + Lampa.TMDB.key() + '&language=ru'), function (json) {
            if (!json || !json.id) return cb(null);
            tvCache[id] = { id: json.id, last: json.last_episode_to_air, next: json.next_episode_to_air, ongoing: ongoing(json), json: json, at: Date.now() };
            cb(tvCache[id]);
        }, function () { cb(null); });
    }
    /** Подписаться / отписаться (карточка, бот): TMDB — дата следующей серии, подтверждение в Telegram. */
    function toggleSub(card, done) {
        var now = !subscribed(card.id);
        var finish = keep(function (info) {
            setSubAll(card, now, info);
            subNotify(card, now, info);
            noty(now ? (chat() ? 'Подписка: о новой серии напишу в Telegram' : 'Подписка сохранена') : 'Подписка отменена', 3500);
            if (done) done(now);
        });
        if (!now) return finish(null);
        tvLoad(card.id, finish);
    }

    /* Родная кнопка «Подписаться» на карточке сериала — через нашего бота (у CUB это платная подписка). */
    /* «Подписаться» на самом ТВ (карточка, плеер): в боте несколько людей — спросить, кому. У каждого свои подписки и
     * уведомления; выбрали владельца — как раньше (его список — список Lampa на ТВ). */
    function ownerName() { return lsGet('bs_tg_owner') || 'Владелец бота'; }
    function people() { var u = users(); return Object.keys(u).filter(function (k) { return active(u[k]); }).map(function (k) { return { who: k, name: u[k].name }; }); }
    function tvSubscribe(card, ownerToggle, cancel) {
        var list = people();
        if (!chat() || !list.length) return ownerToggle();
        var ctrl = '';
        try { ctrl = Lampa.Controller.enabled().name; } catch (e) {}
        var back = function () { try { if (ctrl) Lampa.Controller.toggle(ctrl); } catch (e) {} };
        var items = [{ title: esc(ownerName()), who: '' }].concat(list.map(function (p) { return { title: esc(p.name), who: p.who }; }));
        items.forEach(function (it) { as(it.who, function () { if (subscribed(card.id)) it.subtitle = 'подписан(а) — выберите, чтобы отписать'; }); });
        try {
            Lampa.Select.show({
                title: esc('Кому подписка на «' + (card.name || card.title || card.original_name || '') + '»?'), items: items,
                onSelect: function (a) { back(); if (!a.who) return ownerToggle(); guestToggleTv(a.who, card); if (cancel) cancel(); },
                onBack: function () { back(); if (cancel) cancel(); }
            });
        } catch (e) { log('кому подписка', e.message); ownerToggle(); }
    }
    function guestToggleTv(who, card) {
        as(who, function () {
            var g = guest();
            if (!g) return;
            var on = !subscribed(card.id), m = mini(card, 't');
            updGuest(function (x) {
                x.subs = (x.subs || []).filter(function (c) { return c.id != m.id; });
                if (on) { x.subs.unshift(m); x.subs = x.subs.slice(0, 100); x.muted = (x.muted || []).filter(function (y) { return y !== String(m.id); }); }
            });
            subNotify(card, on, null);                                   // подтверждение — в его чат
            noty(on ? 'Подписка для «' + g.name + '»: о новых сериях — ему в Telegram' : 'Подписка «' + g.name + '» отменена', 4000);
        });
    }

    function paintCardButton(btn, on) {
        btn.toggleClass('active', on).find('path').eq(1).attr('fill', on ? 'currentColor' : 'transparent');
        btn.find('span').text(on ? 'Вы подписаны' : 'Подписаться');
    }
    function cardButton(e) {
        try {
            if (!e || e.type !== 'complite' || !e.body) return;
            var card = e.data && e.data.movie;
            if (!card || !(card.id > 0) || !(card.number_of_seasons || card.first_air_date || card.original_name)) return;
            var btn = e.body.find('.button--subscribe');
            if (!btn.length) return;
            btn.removeClass('hide').off('hover:enter').on('hover:enter', function () {
                if (btn.hasClass('loading')) return;
                btn.addClass('loading');
                tvSubscribe(card, function () { toggleSub(card, function (on) { btn.removeClass('loading'); paintCardButton(btn, on); }); },
                    function () { btn.removeClass('loading'); });
            });
            paintCardButton(btn, subscribed(card.id));
        } catch (x) { log('кнопка карточки', x.message); }
    }

    /* ---------- поиск в боте ---------- */

    /* TMDB без таймаута: если сервер не отвечает, поиск висел бы до минут. Через TMDB_TIMEOUT отвечаем «не ответил». */
    var TMDB_TIMEOUT = 10000, TMDB_FIRST = 6000, TMDB_DIRECT = 'https://api.themoviedb.org/3/', BLOCKED = { blocked: true };
    /* {"blocked":true} прокси CUB отвечает и по-настоящему (фильм закрыт по требованию правообладателя), и когда сам
     * отдаёт ерунду — тогда карточка «заблокирована», хотя на ТВ всё играет. Сверяемся с открытым списком CUB
     * (tmdb.<домен>/blocked — тот же, что тянет ядро Lampa): фильм в списке — правда закрыт, в обход не ходим (BLOCKED);
     * проверить не удалось — тоже не ходим. Нет в списке — сбой прокси, метаданные берём напрямую из официального
     * TMDB (те же открытые данные, что и в Lampa без прокси; сам фильм это не открывает). */
    var BLOCK_LIFE = 12 * 3600000, BLOCK_RETRY = 300000;
    var blockIds = null, blockAt = 0;
    /** id TMDB из списка CUB; часть записей хранит только imdb/kpid — их как tmdb id не проверить. */
    function blockParse(j) {
        if (Object.prototype.toString.call(j) !== '[object Array]') return null;
        var set = {}, i, e, n = 0;
        for (i = 0; i < j.length; i++) {
            e = j[i] || {};
            if (e.id > 0) { set['' + e.id] = 1; n++; }
        }
        log('список закрытых фильмов CUB', n);
        return n ? set : null;
    }
    /** Список с кэшем на сутки; null — проверить не удалось (повтор не чаще BLOCK_RETRY, старый кэш лучше нуля). */
    function blockCheck(cb) {
        var now = Date.now(), saved = lsJson('bs_tg_block', null);
        if (blockIds && now - blockAt < BLOCK_LIFE) return cb(blockIds);
        if (blockAt && now - blockAt < BLOCK_RETRY) return cb(blockIds);
        blockAt = now;
        if (saved && saved.ids && saved.at && now - saved.at < BLOCK_LIFE) { blockIds = saved.ids; return cb(blockIds); }
        var domain = '';
        try { domain = Lampa.Manifest.cub_domain || ''; } catch (e) {}
        if (!domain) return cb(blockIds);
        var req = new Lampa.Reguest();
        try { req.timeout(TMDB_TIMEOUT); } catch (e) {}
        req.silent('https://tmdb.' + domain + '/blocked', function (j) {
            var set = blockParse(j);
            if (set) {
                blockIds = set;
                lsSet('bs_tg_block', JSON.stringify({ at: now, ids: set }));
            }
            cb(blockIds);
        }, function () {
            log('список закрытых фильмов CUB не ответил', domain);
            if (!blockIds && saved && saved.ids) blockIds = saved.ids;  // устаревший список лучше пустого
            cb(blockIds);
        });
    }
    /** Язык TMDB для того, кому отвечаем: английский — en-US; узбекских данных у TMDB почти нет — русский. */
    function tmdbLang() { return lang() === 'en' ? 'en-US' : 'ru'; }
    function tmdbGet(path, cb, retried, mark) {
        cb = keep(cb);
        var q = path + (path.indexOf('?') < 0 ? '?' : '&') + 'api_key=' + Lampa.TMDB.key() + '&language=' + tmdbLang();
        // сначала как Lampa (её прокси TMDB), не ответил — сам TMDB напрямую: у каждого адреса есть запасной
        var url = retried ? TMDB_DIRECT + q : Lampa.TMDB.api(q), wait = retried ? TMDB_TIMEOUT : TMDB_FIRST;
        var done = false, finish = function (j) {
            if (done) return; done = true;
            // {"blocked":true} — сверяемся со списком CUB: сбой прокси (фильма в списке нет) обходим официальным TMDB,
            // а настоящую блокировку не обходим — но карточку в боте всё равно показываем (bs_blocked), на ТВ не отправляем
            if (j && typeof j === 'object' && j.blocked && !j.id) {
                var m = /^(movie|tv)\/(\d+)/.exec(path || ''), id = m ? parseInt(m[2], 10) : 0;
                if (!id) return cb(BLOCKED);
                return blockCheck(function (set) {
                    if (!set) return cb(BLOCKED);                          // список CUB не ответил — проверить нечем, в обход не ходим
                    if (!set['' + id]) {                                   // в списке нет — прокси соврал «заблокирован»
                        log('CUB ответил blocked, но фильма нет в его списке — TMDB напрямую', path.split('?')[0]);
                        if (!retried) return tmdbGet(path, cb, true, false);
                        return cb(null);
                    }
                    // правда закрыт: человек читает бот, а не смотрит через него — карточку берём из открытого TMDB
                    // и помечаем (bs_blocked), сам фильм это не открывает
                    if (!retried) return tmdbGet(path, cb, true, true);
                    cb(j && j.id ? j : BLOCKED);
                });
            }
            if (j && mark && j.id) j.bs_blocked = 1;
            if (!j && !retried) return tmdbGet(path, cb, true, mark);
            if (!j) log('TMDB не ответил', path.split('?')[0]);
            cb(j || (mark ? BLOCKED : null));
        };
        var req = new Lampa.Reguest();
        try { req.timeout(wait); } catch (e) {}
        req.silent(url, function (j) { finish(j); }, function () { finish(null); });
        setTimeout(function () { finish(null); }, wait + 1000);
    }
    /** Ответ, когда на ТВ не откроется: в боте карточка есть, фильм остаётся закрытым по требованию правообладателя. */
    function blockedText() {
        return L('🚫 На ТВ не откроется — закрыт по просьбе правообладателя', '🚫 Won’t open on the TV — blocked at the copyright holder’s request',
            "🚫 Televizorida ochilmaydi — mualliflik huquqi egasining talabi bilan bloklangan");
    }
    /** Карточка Lampa из ответа TMDB (подробности фильма/сериала). */
    function toCard(j, kind) {
        var c = {}, k;
        for (k in j) if (j.hasOwnProperty(k)) c[k] = j[k];
        c.source = 'tmdb';
        if (kind === 't' && !c.name) c.name = c.original_name || '';
        return c;
    }
    /** Подпись результата поиска: «Название (год)\nСериал · ★ 7.7\nописание…». */
    function resultCaption(r) {
        var tv = r.media_type === 'tv', name = (tv ? r.name : r.title) || r.original_name || r.original_title || '';
        var y = String((tv ? r.first_air_date : r.release_date) || '').slice(0, 4), about = String(r.overview || '');
        if (about.length > 180) about = about.slice(0, 177).replace(/\s+\S*$/, '') + '…';
        var ql = qualityLine(r);
        return name + (y ? ' (' + y + ')' : '') + '\n' + (tv ? L('Сериал', 'Series', 'Serial') : L('Фильм', 'Movie', 'Film')) + (r.vote_average ? ' · ★ ' + (+r.vote_average).toFixed(1) : '') +
            (ql ? '\n' + ql : '') + (about ? '\n\n' + about : '');
    }
    /* ---------- качество фильма (как значок на карточке Lampa: release_quality от CUB) ----------
     * В поиске бота под фильмом — «📀 Качество: WEB-DL»; только экранка или ещё нет — кнопка «🔔 Сообщить о качестве»:
     * главный ТВ раз в 3 часа проверяет такие фильмы и пишет человеку, когда вышло нормальное качество. */
    var QUAL = {}, QUAL_LIFE = 6 * 3600000, QWAIT_MAX = 30, QWAIT_LIFE = 180 * 86400000;
    var Q_NAMES = { bd: 'Blu-ray', bdrip: 'BDRip', bluray: 'Blu-ray', webdl: 'WEB-DL', webrip: 'WEBRip', hdrip: 'HDRip', dvdrip: 'DVDRip',
        dvd: 'DVD', tvrip: 'TVRip', hdtv: 'HDTV', ts: 'TS', telesync: 'TS', tc: 'TC', telecine: 'TC', camrip: 'CAMRip', cam: 'CAMRip',
        scr: 'Screener', screener: 'Screener', '4k': '4K', uhd: '4K' };
    function qualityKey(q) { return String(q || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
    function qualityName(q) { var k = qualityKey(q); return k ? (Q_NAMES[k] || String(q).toUpperCase().slice(0, 16)) : ''; }
    /** Экранка: снято в кинотеатре — смотреть такое никто не хочет. */
    function qualityLow(q) { return /^(cam|camrip|ts|telesync|tc|telecine|scr|screener)$/.test(qualityKey(q)); }
    /** Фильм, вышедший недавно (или ещё не вышедший): качества нет — ждать есть смысл. Старый без качества — у CUB нет данных. */
    function recentMovie(r, now) {
        var d = Date.parse(String(r.release_date || '')), day = 86400000;
        return !d || d > (now || Date.now()) - 180 * day;
    }
    /** Есть смысл ждать хорошее качество: только экранка или пока ничего (r._q уже узнали). */
    function waitable(r, now) {
        if (r.media_type === 'tv' || r._q === undefined) return false;
        return qualityLow(r._q) || (!r._q && recentMovie(r, now));
    }
    function qualityLine(r, now) {
        if (r.media_type === 'tv' || r._q === undefined) return '';
        if (qualityLow(r._q)) return L('⚠️ Пока только экранка (', '⚠️ Only a cam rip so far (', '⚠️ Hozircha faqat kinoteatrdan yozib olingan versiya (') + qualityName(r._q) + ')';
        if (r._q) return L('📀 Качество: ', '📀 Quality: ', '📀 Sifat: ') + qualityName(r._q);
        return recentMovie(r, now) ? L('⏳ В хорошем качестве ещё нет', '⏳ Not out in good quality yet', "⏳ Yaxshi sifatda hali yo'q") : '';
    }
    /** cb(release_quality или ''), не дольше 4 с. Кэш на QUAL_LIFE. */
    function qualityGet(id, cb) {
        cb = keep(cb);
        var c = QUAL[id];
        if (c && Date.now() - c.at < QUAL_LIFE) return cb(c.q);
        var done = false, fin = function (q) { if (done) return; done = true; QUAL[id] = { q: q || '', at: Date.now() }; cb(q || ''); };
        setTimeout(function () { if (!done) { done = true; cb(''); } }, 4000);
        try {
            Lampa.Api.sources.cub.full({ id: id, method: 'movie', card: { id: id, source: 'cub' } }, function (j) {
                var m = j && (j.movie || j);
                fin(m && m.release_quality);
            }, function () { fin(''); });
        } catch (e) { fin(''); }
    }
    /** Перед показом карточки узнать качество фильма (сериалам не нужно). */
    function withQuality(r, cb) {
        if (!r || r.media_type === 'tv' || r._q !== undefined) return cb();
        qualityGet(r.id, function (q) { r._q = q; cb(); });
    }
    function qwOwner() { var l = lsJson('bs_tg_qwait', []); return Object.prototype.toString.call(l) === '[object Array]' ? l : []; }
    /** Список владельца — общий для всех ТВ (по каналу), как его подписки. */
    function qwSaveOwner(l) { lsSet('bs_tg_qwait', JSON.stringify(l)); busSend({ t: 'qw', list: l }); }
    function qualityWait(card, kind, name, answer) {
        var m = mini(card, kind), has = function (l) { return l.some(function (x) { return x && x.id == m.id; }); };
        m.at = Date.now();
        m.poster = card.poster_path || '';
        var said = L('🔔 Сообщу, когда «' + name + '» выйдет в хорошем качестве', "🔔 I'll let you know when “" + name + '” is out in good quality', "🔔 «" + name + "» yaxshi sifatda chiqqanda xabar beraman"),
            already = L('Уже жду — сообщу, когда «' + name + '» выйдет в хорошем качестве', "Already waiting — I'll let you know when “" + name + '” is out in good quality', "Allaqachon kutyapman — «" + name + "» yaxshi sifatda chiqqanda xabar beraman");
        if (isOwner()) {
            var l = qwOwner();
            if (has(l)) return answer(already);
            qwSaveOwner([m].concat(l).slice(0, QWAIT_MAX));
        } else {
            var g = guest();
            if (!g) return answer(L('Нет доступа', 'No access', "Ruxsat yo'q"));
            if (has(g.qwait || [])) return answer(already);
            updGuest(function (x) { x.qwait = [m].concat(x.qwait || []).slice(0, QWAIT_MAX); });
        }
        answer(said);
    }
    /** Сообщение «вышел в хорошем качестве» не ушло (429, сеть) — фильм снова в ожидании: следующая проверка напишет. */
    function qwBack(x) {
        var has = function (l) { return l.some(function (y) { return y && y.id == x.id; }); };
        if (isOwner()) { var l = qwOwner(); if (!has(l)) qwSaveOwner(l.concat([x]).slice(0, QWAIT_MAX)); }
        else updGuest(function (g) { if (!has(g.qwait || [])) g.qwait = (g.qwait || []).concat([x]).slice(0, QWAIT_MAX); });
    }
    /** Главный ТВ: фильмы, которых ждут, — вышло нормальное качество? Написать и убрать из ожидания. */
    function qualityCheck() {
        if (!hasToken() || !chat() || !leading()) return;
        var now = Date.now(), jobs = [{ c: '', list: qwOwner() }], people = users(), ids = {}, res = {};
        Object.keys(people).forEach(function (k) { var g = people[k]; if (active(g) && g.qwait && g.qwait.length) jobs.push({ c: k, list: g.qwait }); });
        jobs.forEach(function (j) { j.list.forEach(function (x) { if (x && x.id) ids[x.id] = 1; }); });
        var list = Object.keys(ids);
        (function next(i) {
            if (i >= list.length) return apply();
            delete QUAL[list[i]];                                     // нужен свежий ответ, не кэш
            qualityGet(list[i], function (q) { res[list[i]] = q; setTimeout(keep(function () { next(i + 1); }), 500); });
        })(0);
        function apply() {
            jobs.forEach(function (j) {
                var stay = [], ready = [];
                j.list.forEach(function (x) {
                    var q = res[x.id];
                    if (q && !qualityLow(q)) ready.push({ x: x, q: q });
                    else if (now - (x.at || now) < QWAIT_LIFE) stay.push(x);
                });
                if (stay.length === j.list.length) return;
                if (j.c) { var all = users(), g = all[j.c]; if (g) { g.qwait = stay; saveUsers(all, [j.c]); } }
                else qwSaveOwner(stay);
                var jobs = [];                                        // несколько фильмов одному человеку — не пачкой
                as(j.c, function () {
                    ready.forEach(function (r) {
                        if (!j.c) tvBell('q:' + r.x.id, r.x.name || '', 'Вышел в хорошем качестве: ' + qualityName(r.q), bellCard(r.x.id, r.x.name, r.x.poster, false));
                        jobs.push(keep(function () {
                            send(L('🎬 «' + r.x.name + '» вышел в хорошем качестве: ', '🎬 “' + r.x.name + '” is out in good quality: ', "🎬 «" + r.x.name + "» yaxshi sifatda chiqdi: ") + qualityName(r.q), posterUrl(r.x.poster), null,
                                function (e) { log('качество — не отправлено', e); qwBack(r.x); },
                                [[watchBtn('m', r.x.id), openBtn('m', r.x.id)]]);
                        }));
                    });
                });
                spaced(jobs);
            });
        }
    }
    /* Результаты поиска — одним сообщением-слайдером: постер и описание, ◀ 3 / 20+ ▶ меняют их в том же сообщении
     * (editMessageMedia). Все найденные: TMDB отдаёт по 20 на страницу — дошли до конца, а страницы ещё есть, ▶
     * подгружает следующую («+» в счётчике). Найденное помним по номеру сообщения, пока Lampa запущена. */
    var slides = {}, SLIDE_LIMIT = 200;

    /* Умный поиск: «Доктор Стрендж 2026» — название с годом; «2026» — популярное за год; «фильмы Марвел 2026»,
     * «сериалы Netflix», «мультфильмы Pixar» — по студии (и типу, и году). Иначе — обычный поиск по названию. */
    var STUDIOS = [
        [/марвел|marvel/, 420, 'Marvel'], [/\bdc\b|диси|ди\s*си/, 9993, 'DC'], [/пиксар|pixar/, 3, 'Pixar'],
        [/дисне[йи]|disney/, 2, 'Disney'], [/нетфликс|netflix/, 0, 'Netflix', 213], [/\bhbo\b|эйчбио/, 0, 'HBO', 49],
        [/уорнер|ворнер|warner/, 174, 'Warner Bros.'], [/юниверсал|universal/, 33, 'Universal'],
        [/дримворкс|dreamworks/, 521, 'DreamWorks'], [/\ba24\b|а24/, 41077, 'A24'], [/лукасфильм|lucasfilm/, 1, 'Lucasfilm'],
        [/парамаунт|paramount/, 4, 'Paramount'], [/сони|sony/, 34, 'Sony Pictures'], [/блюмхаус|blumhouse/, 3172, 'Blumhouse'],
        [/иллюминейшн|illumination/, 6704, 'Illumination'], [/гибли|ghibli/, 10342, 'Studio Ghibli'], [/apple\s*tv|эпл\s*тв|апл\s*тв/, 0, 'Apple TV+', 2552],
        [/амазон|amazon|prime/, 0, 'Prime Video', 1024]
    ];
    // \b в регулярных JS не видит русских букв — слова-заполнители убираем по словам
    var FILLER = ['фильмы', 'фильм', 'кино', 'сериалы', 'сериал', 'мультфильмы', 'мультфильм', 'мультики', 'мульт', 'аниме', 'компании', 'компания',
        'студии', 'студия', 'от', 'за', 'в', 'год', 'года', 'году', 'новинки', 'новые', 'лучшие', 'movie', 'movies', 'series', 'from',
        'film', 'films', 'cartoon', 'cartoons', 'anime', 'filmlar', 'filmlari', 'serial', 'seriallar', 'seriallari', 'multfilm', 'multfilmlar', 'multfilmlari'];

    /** Разбор запроса: {title, year, type: '' | 'movie' | 'tv', anim, studio: {name, company, network}}. */
    function parseQuery(q) {
        var low = ' ' + String(q || '').toLowerCase().replace(/ё/g, 'е') + ' ', out = { title: '', year: 0, type: '', anim: false, studio: null };
        var y = /(?:^|\D)((?:19|20)\d{2})(?:\D|$)/.exec(low);
        if (y) { out.year = +y[1]; low = low.replace(y[1], ' '); }
        if (/сериал|series|(^|\s)serial/.test(low)) out.type = 'tv';
        else if (/мульт|аниме|(^|\s)(anime|cartoons?|multfilm)/.test(low)) { out.type = 'movie'; out.anim = true; }
        else if (/фильм|кино|movie|(^|\s)films?(\s|$)|(^|\s)filmlar/.test(low)) out.type = 'movie';
        for (var i = 0; i < STUDIOS.length; i++) if (STUDIOS[i][0].test(low)) {
            out.studio = { name: STUDIOS[i][2], company: STUDIOS[i][1], network: STUDIOS[i][3] || 0 };
            low = low.replace(STUDIOS[i][0], ' ');
            break;
        }
        out.title = low.split(/\s+/).filter(function (w) { return w && FILLER.indexOf(w) < 0; }).join(' ');
        return out;
    }
    /** Название в кавычках: «…» по-русски и по-узбекски, “…” по-английски. */
    function quoted(s) { return L('«', '“', '«') + s + L('»', '”', '»'); }
    /** Что показать в «Ищу…»: «фильмы Marvel за 2026». */
    function queryLabel(p, q) {
        var o = L('«', '“', '«'), c = L('»', '”', '»');
        if (!p.studio && !(p.year && !p.title)) return quoted(q);
        return (p.anim ? L('мультфильмы', 'cartoons', 'multfilmlar') : p.type === 'tv' ? L('сериалы', 'series', 'seriallar') : p.type === 'movie' ? L('фильмы', 'movies', 'filmlar') : L('фильмы и сериалы', 'movies and series', 'filmlar va seriallar')) +
            (p.studio ? ' ' + p.studio.name : '') + (p.title && p.studio ? ' ' + o + p.title + c : '') + (p.year ? L(' за ', ' of ', ', ') + p.year + L('', '', '-yil') : '');
    }

    function onlyCards(list, kind) {
        return (list || []).filter(function (r) {
            if (kind) r.media_type = kind;
            return (r.media_type === 'movie' || r.media_type === 'tv') && r.poster_path;
        });
    }
    /** Фильмы и сериалы одной страницей: обе выдачи вместе, по популярности. */
    function both(pathMovie, pathTv, page, cb) {
        var left = 0, all = [], pages = 0;
        var take = function (kind) { return function (j) { all = all.concat(onlyCards(j && j.results, kind)); pages = Math.max(pages, (j && j.total_pages) | 0); if (--left === 0) done(); }; };
        var done = function () { all.sort(function (a, b) { return (b.popularity || 0) - (a.popularity || 0); }); cb(all, pages); };
        if (pathMovie) { left++; tmdbGet(pathMovie + '&page=' + page, take('movie')); }
        if (pathTv) { left++; tmdbGet(pathTv + '&page=' + page, take('tv')); }
        if (!left) cb([], 0);
    }

    /** Источник страниц для запроса: fetch(page, cb(list, pages)). */
    function searchSource(q) {
        var p = parseQuery(q), enc = encodeURIComponent;
        var wantM = p.type !== 'tv', wantT = p.type !== 'movie';
        if (p.studio) {
            var st = p.studio, yM = p.year ? '&primary_release_year=' + p.year : '', yT = p.year ? '&first_air_date_year=' + p.year : '';
            var anim = p.anim ? '&with_genres=16' : '', sort = '&sort_by=' + (p.year ? 'popularity.desc' : 'primary_release_date.desc') + '&vote_count.gte=' + (p.year ? 0 : 20);
            var mPath = wantM && st.company ? 'discover/movie?with_companies=' + st.company + yM + anim + sort : '';
            var tPath = wantT ? 'discover/tv?' + (st.network ? 'with_networks=' + st.network : 'with_companies=' + st.company) + yT + anim + '&sort_by=popularity.desc' : '';
            if (st.network && !st.company) mPath = '';                   // стриминг — только сериалы TMDB-сети
            return { label: queryLabel(p, q), fetch: function (page, cb) {
                both(mPath, tPath, page, function (list, pages) {
                    if (!p.title) return cb(list, pages);
                    var t = p.title;                                       // «Марвел Мстители» — среди фильмов студии
                    cb(list.filter(function (r) { return String(r.title || r.name || '').toLowerCase().indexOf(t) >= 0 || String(r.original_title || r.original_name || '').toLowerCase().indexOf(t) >= 0; }), pages);
                });
            } };
        }
        if (!p.title && p.year) {                                         // «2026» — популярное за год
            return { label: queryLabel(p, q), fetch: function (page, cb) {
                both(wantM ? 'discover/movie?primary_release_year=' + p.year + (p.anim ? '&with_genres=16' : '') + '&sort_by=popularity.desc' : '',
                    wantT ? 'discover/tv?first_air_date_year=' + p.year + '&sort_by=popularity.desc' : '', page, cb);
            } };
        }
        if (p.year && p.title) {                                          // «Доктор Стрендж 2026» — с годом, не нашлось — без
            var plain = false;
            return { label: quoted(q), fetch: function (page, cb) {
                if (plain) return multi(page, cb);
                both(wantM ? 'search/movie?query=' + enc(p.title) + '&year=' + p.year : '', wantT ? 'search/tv?query=' + enc(p.title) + '&first_air_date_year=' + p.year : '', page, function (list, pages) {
                    if (list.length || page > 1) return cb(list, pages);
                    plain = true;
                    multi(page, cb);
                });
            } };
        }
        function multi(page, cb) {
            tmdbGet('search/multi?query=' + enc(p.title || q) + '&include_adult=false&page=' + page, function (j) {
                var list = onlyCards(j && j.results);
                if (p.type) list = list.filter(function (r) { return r.media_type === p.type; });
                cb(list, (j && j.total_pages) | 0);
            });
        }
        return { label: quoted(q), fetch: multi };
    }

    /** more — у TMDB есть ещё страницы: ▶ на последней карточке — подгрузить, а не по кругу. */
    function slideButtons(list, i, more) {
        var r = list[i], k = r.media_type === 'tv' ? 't' : 'm', row2 = [openBtn(k, r.id)];
        if (k === 't') row2.push({ text: L('🔔 Подписаться', '🔔 Subscribe', "🔔 Obuna bo'lish"), callback_data: 's:t:' + r.id });
        else if (waitable(r)) row2.push({ text: L('🔔 Ждать хорошего качества', '🔔 Wait for good quality', '🔔 Yaxshi sifatni kutish'), callback_data: 'q:m:' + r.id });
        var rows = [[watchBtn(k, r.id), { text: L('⭐ Хочу посмотреть', '⭐ Want to watch', "⭐ Ko'rmoqchiman"), callback_data: 'w:' + k + ':' + r.id }], row2];
        if (list.length > 1 || more) rows.push([
            { text: '◀', callback_data: 'p:' + ((i - 1 + list.length) % list.length) },
            { text: (i + 1) + ' / ' + list.length + (more ? '+' : ''), callback_data: 'n' },
            { text: '▶', callback_data: 'p:' + (i + 1 < list.length ? i + 1 : more ? list.length : 0) }]);
        return rows;
    }

    function botSearch(query, viaAi) {
        // описали словами — сначала ИИ: что это за фильм; потом обычный поиск по названию
        if (!viaAi && anyAi() && isDescription(query)) {
            call('sendChatAction', { chat_id: to(), action: 'typing' }, null, null);
            var sid = 0, queued = '';
            var st = function (t) { if (sid) call('editMessageText', { chat_id: to(), message_id: sid, text: t }, null, null); else queued = t; };
            call('sendMessage', { chat_id: to(), text: askingAi() }, function (m) { sid = m && m.message_id || 0; if (sid && queued) st(queued); }, null);
            return smartFlow(query, st);
        }
        // пока ищем — «печатает…» и сообщение «Ищу…»; результат пришёл — сообщение убираем (или пишем «не нашлось»)
        call('sendChatAction', { chat_id: to(), action: 'upload_photo' }, null, null);
        var statusId = 0, found = null, shown = false;
        var status = function (t) { if (statusId) call('editMessageText', { chat_id: to(), message_id: statusId, text: t }, null, null); else reply(t); };
        var finish = function () {
            if (!found || shown) return;
            shown = true;
            if (!found.list.length && !viaAi && anyAi()) return smartFlow(query, status);   // по названию пусто — спросить ИИ
            if (!found.list.length) {
                if (statusId) call('editMessageText', { chat_id: to(), message_id: statusId, text: notFound(query) + L('.\nПопробуйте написать иначе или по-английски.', '.\nTry different wording or the English title.', ".\nBoshqacha yoki inglizcha yozib ko'ring.") }, null, null);
                else reply(notFound(query) + '.');
                return;
            }
            if (statusId) call('deleteMessage', { chat_id: to(), message_id: statusId }, null, null);
            showSlides(found.s);
        };
        var src = searchSource(query);
        call('sendMessage', { chat_id: to(), text: L('🔎 Ищу ', '🔎 Searching for ', '🔎 ') + src.label + L(' в базе фильмов и сериалов…', ' in the movie and series database…', ' filmlar va seriallar bazasidan qidirilmoqda…') }, function (m) {
            statusId = m && m.message_id || 0;
            if (found) finish();                                          // поиск успел раньше — доделать
        }, null);
        src.fetch(1, function (list, pages) {
            found = { list: list, s: { list: list, src: src, page: 1, pages: pages } };
            if (statusId) finish();
            else setTimeout(keep(function () { if (!statusId) finish(); }), 3000);   // «Ищу…» не отправилось — без него
        });
    }

    function hasMore(ss) { return ss.page < ss.pages && ss.list.length < SLIDE_LIMIT; }

    function showSlides(ss) {
        var list = ss.list;
        withQuality(list[0], function () { showFirst(ss, list); });
    }
    function showFirst(ss, list) {
        call('sendPhoto', { chat_id: to(), photo: posterUrl(list[0].poster_path), caption: resultCaption(list[0]),
            reply_markup: JSON.stringify({ inline_keyboard: slideButtons(list, 0, hasMore(ss)) }) }, function (msg) {
            if (msg && msg.message_id) {
                slides[to() + ':' + msg.message_id] = ss;
                var keys = Object.keys(slides);
                if (keys.length > 20) delete slides[keys[0]];           // старые поиски — не держим
            }
        }, function (e) { log('поиск — не отправлено', e); });
    }

    /** ◀ ▶ — другая карточка в том же сообщении. */
    function slideTo(q, i) {
        var mid = q.message.message_id, ss = slides[to() + ':' + mid];
        var answer = function (t) { call('answerCallbackQuery', { callback_query_id: q.id, text: t || '' }, null, null); };
        if (!ss) return answer(L('Поиск устарел — напишите название ещё раз', 'This search has expired — type the name again', 'Qidiruv eskirdi — nomini qayta yozing'));
        i = i | 0;
        if (i >= ss.list.length && hasMore(ss)) {
            if (ss.loading) return answer(L('Загружаю…', 'Loading…', 'Yuklanmoqda…'));
            ss.loading = true;
            return ss.src.fetch(ss.page + 1, function (more, pages) {
                ss.loading = false;
                ss.page++;
                if (pages) ss.pages = pages;
                var seen = {};
                ss.list.forEach(function (r) { seen[r.media_type + r.id] = 1; });
                more.forEach(function (r) { if (!seen[r.media_type + r.id]) ss.list.push(r); });
                if (i >= ss.list.length) i = hasMore(ss) ? ss.list.length - 1 : 0;   // страница пустая — не застрять
                show();
            });
        }
        show();
        function show() {
            i = Math.max(0, Math.min(ss.list.length - 1, i));
            var r = ss.list[i];
            withQuality(r, function () { showOne(r); });
        }
        function showOne(r) {
            call('editMessageMedia', { chat_id: to(), message_id: mid,
                media: JSON.stringify({ type: 'photo', media: posterUrl(r.poster_path), caption: resultCaption(r) }),
                reply_markup: JSON.stringify({ inline_keyboard: slideButtons(ss.list, i, hasMore(ss)) }) }, function () { answer(); }, function (e) { answer(); log('слайдер', e); });
        }
    }

    /** Выбрали ТВ: этот — открыть здесь, другой — команда по каналу и ответ в то же сообщение. */
    function openOn(q, dev, kind, id, play) {
        var mid = q.message.message_id, answer = function (t) { call('answerCallbackQuery', { callback_query_id: q.id, text: t || '' }, null, null); };
        var edit = function (t) { call('editMessageText', { chat_id: to(), message_id: mid, text: t }, null, null); };
        delLater(to(), mid, 2 * TMP_SHORT);                                // «На каком ТВ…» → «Включаю…» — служебное
        var name = dev === tvId ? tvName() : (devices[dev] || {}).name || L('ТВ', 'TV', 'TV');
        if (dev === tvId) return openHereLocal();
        var ref = randomTopic().slice(6, 14), timer = null;
        var expire = keep(function () { if (acks[ref]) { delete acks[ref]; edit(noAnswer(name)); } });
        acks[ref] = keep(function (m) {
            clearTimeout(timer);
            if (m.wait) { edit('⏳ ' + quoted(name) + ': ' + whyText(m.why || 'ждёт, пока закончится видео')); timer = setTimeout(expire, AFTER_VIDEO_MAX); return; }
            delete acks[ref];
            edit(m.ok ? openedOn(play, name) : '📺 ' + quoted(name) + ': ' + whyText(m.why || 'не получилось'));
        });
        timer = setTimeout(expire, ACK_WAIT);
        busSend({ t: 'open', to: dev, k: kind, id: id, ref: ref, play: !!play, g: !isOwner(), n: senderName() });
        answer(L('Отправляю на «' + name + '»…', 'Sending to “' + name + '”…', "«" + name + "»ga yuboryapman…"));
        function openHereLocal(deferred) {
            tmdbGet((kind === 't' ? 'tv/' : 'movie/') + id, function (j) {
                if (j === BLOCKED || (j && j.bs_blocked)) return deferred ? null : answer(blockedText());
                if (!j || !j.id) return deferred ? null : answer(whyText('TMDB не ответил'));
                if (tvPlaying()) return videoAsk(toCard(j, kind), kind, function () { openHereLocal(true); }, function (st) {
                    if (st === 'ask') { if (!deferred) answer(askingText()); edit(askingOn(name)); }
                    else edit(L('⏳ Откроется на «' + name + '», когда закончится видео', '⏳ Will open on “' + name + '” when the video ends', "⏳ Video tugagach, «" + name + "»da ochiladi"));
                });
                try {
                    pushCard(toCard(j, kind), kind, play);
                    if (!deferred) answer();
                    edit(openedOn(play, name));
                } catch (e) { if (!deferred) answer(cantOpen() + e.message); }
            });
        }
    }
    /** «▶️ Включаю на ТВ «Зал»» / «📺 Открыто на ТВ «Зал»» (после «на» имя в кавычках не склоняется — с «ТВ» читается правильно). */
    function openedOn(play, name) {
        return play ? L('▶️ Включаю на ТВ «' + name + '»', '▶️ Playing on the TV “' + name + '”', "▶️ «" + name + "» televizorida yoqyapman") : L('📺 Открыто на ТВ «' + name + '»', '📺 Opened on the TV “' + name + '”', "📺 «" + name + "» televizorida ochildi");
    }
    function noAnswer(name) {
        return L('📺 «' + name + '» не ответил — возможно, выключен или Lampa закрыта.', "📺 “" + name + "” didn't answer — maybe it's off or Lampa is closed.", "📺 «" + name + "» javob bermadi — ehtimol, o'chiq yoki Lampa yopiq.");
    }
    function askingText() { return L('На ТВ идёт видео — спрашиваю, открыть сейчас или после', 'A video is playing on the TV — asking whether to open it now or after', "Televizorda video ketyapti — hozir yoki keyin ochishni so'rayapman"); }
    function askingOn(name) { return L('⏳ На «' + name + '» идёт видео — спрашиваю, открыть сейчас или после него', '⏳ A video is playing on “' + name + '” — asking whether to open it now or after it', "⏳ «" + name + "»da video ketyapti — hozir yoki undan keyin ochishni so'rayapman"); }
    function cantOpen() { return L('Не получилось открыть: ', "Couldn't open: ", "Ochib bo'lmadi: "); }
    function noPlay() { return L('Владелец запретил гостям включать видео на ТВ', "The owner doesn't allow guests to play videos on the TV", "Bot egasi mehmonlarga televizorda video yoqishni taqiqlagan"); }
    function noRemote() { return L('Владелец запретил гостям управлять ТВ.', "The owner doesn't allow guests to control the TV.", "Bot egasi mehmonlarga televizorni boshqarishni taqiqlagan."); }
    function noMore(name) { return L('Больше не буду писать про ' + (name ? '«' + name + '»' : 'этот сериал'), "I won't write about " + (name ? '“' + name + '”' : 'this series') + ' anymore', (name ? "«" + name + "»" : 'Bu serial') + " haqida boshqa yozmayman"); }
    function remindAt() { return L('Напомню завтра в 9:00', "I'll remind you tomorrow at 9:00", 'Ertaga soat 9:00 da eslataman'); }
    function renamed(title) { return L('✅ ТВ теперь называется «' + title + '».', '✅ The TV is now called “' + title + '”.', "✅ Televizor endi «" + title + "» deb ataladi."); }
    /* Причины с других ТВ и из запросов приходят по-русски (старые ТВ шлют так же) — для человека переводим известные. */
    var WHY = {
        'на этом ТВ сейчас смотрят — подождите': ['Someone is watching this TV now — please wait', "Bu televizorda hozir video ko'rilmoqda — biroz kuting"],
        'откроется, когда закончится видео': ['will open when the video ends', 'video tugagach ochiladi'],
        'спрашиваю на ТВ: открыть сейчас или после видео': ['asking on the TV: open now or after the video', "televizorda so'rayapman: hozir yoki videodan keyin ochish"],
        'ждёт, пока закончится видео': ['waiting for the video to end', 'video tugashini kutyapti'],
        'TMDB не ответил': ["TMDB didn't answer", 'TMDB javob bermadi'],
        'заблокирован по просьбе правообладателя': ['blocked at the copyright holder’s request', 'mualliflik huquqi egasining talabi bilan bloklangan'],
        'идёт видео — не прерываю': ["a video is playing — I won't interrupt it", "video ko'rilmoqda — to'xtatmayman"],
        'пустой текст': ['empty text', "bo'sh matn"],
        'не получилось': ["didn't work", "bo'lmadi"],
        'не получилось открыть поиск': ["couldn't open search", "qidiruvni ochib bo'lmadi"],
        'нет связи с Telegram': ['no connection to Telegram', "Telegram bilan aloqa yo'q"],
        'Lampa была закрыта — открываю': ['Lampa was closed — opening it', "Lampa yopiq edi — ochyapman"],
        'экран выключен — включите ТВ: Lampa уже открывается': ['the screen is off — turn the TV on: Lampa is already opening', "ekran o'chiq — televizorni yoqing: Lampa allaqachon ochilmoqda"],
        'Telegram не ответил': ["Telegram didn't answer", 'Telegram javob bermadi']
    };
    function whyText(w) { var t = WHY[w]; return t ? L(w, t[0], t[1]) : w; }

    /* ---------- «⌨️ Набрать на ТВ»: текст с телефона — в поиск Lampa на телевизоре ---------- */

    var typeFor = null, TYPE_WAIT = 5 * 60000;

    /** Текст для поиска Lampa: она вставляет его как HTML (.search__input), поэтому разметку и
     *  управляющие символы вычищаем — иначе через бота можно было бы встроить код в страницу ТВ. */
    function typedText(t) {
        return String(t || '').replace(/[<>&"'`\\]/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ')
            .replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '').slice(0, 100);
    }
    /** Открыть поиск Lampa на этом ТВ с готовым текстом: Search.open сам ставит текст и ищет. */
    function typeHere(text) {
        var playing = false;
        try { playing = !!Lampa.Player.opened(); } catch (e) {}
        if (playing) return 'идёт видео — не прерываю';
        try {
            if (document.body.className.indexOf('search--open') >= 0) Lampa.Search.close();
            Lampa.Search.open({ input: text });
            return '';
        } catch (e) { return e.message || 'не получилось открыть поиск'; }
    }
    /** Кнопка в меню: выбрать ТВ (если их несколько) и ждать текст. */
    function typeStart() {
        if (!isOwner() && !guestPlay()) return reply(noRemote());
        var tvs = allTvs();
        if (tvs.length > 1) {
            return reply(L('⌨️ На каком телевизоре набрать?', '⌨️ Which TV to type on?', '⌨️ Qaysi televizorda yozamiz?'), tvs.map(function (d) { return [{ text: d.text, callback_data: 'tp:' + d.id }]; }));
        }
        typeWait(tvId);
    }
    function typeWait(dev) {
        typeFor = { chat: to(), at: Date.now(), tv: dev };
        var name = dev === tvId ? tvName() : (devices[dev] || {}).name || L('ТВ', 'TV', 'TV');
        reply(L('⌨️ Напишите, что искать, — текст появится в поиске Lampa на «' + name + '».', '⌨️ Type what to search for — the text will appear in Lampa search on “' + name + '”.',
            "⌨️ Nimani qidirishni yozing — matn «" + name + "»dagi Lampa qidiruvida paydo bo'ladi."));
    }
    /** «📺 Ищу «текст» на «Зал»». */
    function typedOn(text, name) { return L('📺 Ищу «' + text + '» на «' + name + '»', '📺 Searching for “' + text + '” on “' + name + '”', "📺 «" + name + "»da «" + text + "»ni qidiryapman"); }
    /** Пришёл текст в режиме «Набрать на ТВ». */
    function typeSend(raw) {
        var dev = typeFor.tv, text = typedText(raw), again = [[{ text: L('⌨️ Набрать ещё', '⌨️ Type more', '⌨️ Yana yozish'), callback_data: 'mn:type' }]];
        typeFor = null;
        if (!text) return reply(L('Текст пустой — нажмите «⌨️ Набрать на ТВ» ещё раз.', 'The text is empty — tap “⌨️ Type on TV” again.', "Matn bo'sh — «⌨️ TV'da yozish» tugmasini qayta bosing."));
        var name = dev === tvId ? tvName() : (devices[dev] || {}).name || L('ТВ', 'TV', 'TV');
        if (dev === tvId) {
            var why = typeHere(text);
            return reply(why ? '📺 ' + quoted(name) + ': ' + whyText(why) : typedOn(text, name), again);
        }
        var ref = randomTopic().slice(6, 14), timer = null;
        acks[ref] = keep(function (m) {
            clearTimeout(timer);
            reply(m.ok ? typedOn(text, name) : '📺 ' + quoted(name) + ': ' + whyText(m.why || 'не получилось'), again);
        });
        timer = setTimeout(keep(function () { if (acks[ref]) { delete acks[ref]; reply(noAnswer(name)); } }), ACK_WAIT);
        busSend({ t: 'type', to: dev, text: text, ref: ref });
    }

    /** Кнопки под результатом поиска: w — «Хочу посмотреть», o — открыть на ТВ, s — подписаться. */
    function searchAction(q, act, kind, id) {
        var answer = function (t) { call('answerCallbackQuery', { callback_query_id: q.id, text: t }, null, null); };
        tmdbGet((kind === 't' ? 'tv/' : 'movie/') + id, function (j) {
            if (j === BLOCKED) return answer(blockedText());
            // закрытый фильм в боте карточку показывает (подписаться, «хочу посмотреть» — можно), на ТВ не открываем
            if (j && j.bs_blocked && (act === 'o' || act === 'v')) return answer(blockedText());
            if (!j || !j.id) return answer(L('TMDB не ответил, попробуйте ещё раз', "TMDB didn't answer, try again", "TMDB javob bermadi, qayta urinib ko'ring") + ' (' + tvName() + ')');
            var card = toCard(j, kind), name = card.title || card.name || '';
            var already = function () { return answer(L('Вы уже подписаны', "You're already subscribed", "Siz allaqachon obuna bo'lgansiz")); };
            if (act === 'q') return qualityWait(card, kind, name, answer);
            if ((act === 'o' || act === 'v') && !isOwner() && !guestPlay()) return answer(noPlay());
            if (act !== 'o' && act !== 'v' && !isOwner()) {
                if (act === 's' && subscribed(card.id)) return already();
                return guestAction(act, card, kind, name, answer);
            }
            if (act === 'x') {
                try { Lampa.Favorite.remove('wath', card); answer(wantRemoved(name)); }
                catch (e) { answer(L('Не получилось убрать: ', "Couldn't remove: ", "Olib tashlab bo'lmadi: ") + e.message); }
            } else if (act === 'w') {
                try { Lampa.Favorite.add('wath', card); answer(wantAdded(name)); }
                catch (e) { answer(L('Не получилось добавить: ', "Couldn't add: ", "Qo'shib bo'lmadi: ") + e.message); }
            } else if (act === 's') {
                if (subscribed(card.id)) return already();
                toggleSub(card, function () { answer(subAdded(name)); });
            } else {
                var others = otherTvs();
                if (others.length) {                                    // включено несколько ТВ — выбрать
                    answer('');
                    var rows = allTvs().map(function (d) { return [{ text: d.text, callback_data: (act === 'v' ? 'D:' : 'd:') + d.id + ':' + kind + ':' + card.id }]; });
                    rows.push([{ text: L('✏️ Переименовать ТВ', '✏️ Rename TV', "✏️ TV nomini o'zgartirish"), callback_data: 'rn' }]);
                    return reply(act === 'v' ? L('На каком ТВ включить «' + name + '»?', 'Which TV to play “' + name + '” on?', "«" + name + "»ni qaysi televizorda yoqamiz?")
                        : L('На каком ТВ открыть «' + name + '»?', 'Which TV to open “' + name + '” on?', "«" + name + "»ni qaysi televizorda ochamiz?"), rows);
                }
                if (tvPlaying()) return videoAsk(card, kind, function () { try { pushCard(card, kind, act === 'v'); } catch (e) { log('после видео', e.message); } }, function (st) {
                    if (st === 'ask') return answer(askingText());
                    tmp(TMP_SHORT, function () { reply(L('⏳ «' + name + '» откроется на ТВ, когда закончится видео', '⏳ “' + name + '” will open on the TV when the video ends', "⏳ «" + name + "» video tugagach televizorda ochiladi")); });
                });
                try {
                    pushCard(card, kind, act === 'v');
                    var told = queuedTv;                                // служба уже написала «включите ТВ»
                    screenCheck(keep(function (scr) {
                        if (scr === 'standby') {                        // экран выключен пультом: картинки не будет, пока не включат
                            answer('');
                            if (told) return;
                            return reply(L('📺 Телевизор выключен — включите его: «' + name + '» уже открыт в Lampa.',
                                '📺 The TV is off — turn it on: “' + name + '” is already open in Lampa.',
                                "📺 Televizor o'chiq — uni yoqing: «" + name + "» Lampa'da allaqachon ochiq."));
                        }
                        answer((act === 'v' ? L('▶️ Включаю на ТВ: ', '▶️ Playing on the TV: ', '▶️ Televizorda yoqyapman: ') : L('📺 Открыл на ТВ: ', '📺 Opened on the TV: ', '📺 Televizorda ochdim: ')) + name);
                    }), true);
                } catch (e) { answer(cantOpen() + e.message); }
            }
        });
    }

    function panelRemove() { try { Lampa.PlayerPanel.render().find('.bs-sub').remove(); } catch (e) {} }

    /** Подписан ли кто-нибудь (владелец или любой из людей) — для надписи на кнопке плеера. */
    function anySub(id) {
        if (subscribed(id)) return true;
        return people().some(function (p) { var on = false; as(p.who, function () { on = subscribed(id); }); return on; });
    }
    /* Кнопка — значок-колокольчик, как остальные кнопки плеера (надписью она была широкой и на узком экране налезала
     * на паузу); подписан — колокольчик залит. Надпись — в подсказке. */
    var BELL = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 3a6 6 0 0 0-6 6v3.6L4.2 16h15.6L18 12.6V9a6 6 0 0 0-6-6z" ' +
        'fill="FILL" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9.5 19a2.5 2.5 0 0 0 5 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    function panelPaint(box, card) {
        var on = anySub(card.id), many = !!chat() && people().length > 0;
        var title = on ? (many ? 'Подписка ✓' : 'Вы подписаны ✓') : 'Подписаться на новые серии';
        box.find('.bs-sub__btn').toggleClass('bs-sub__btn--on', on).attr('title', title)
            .html(BELL.replace('FILL', on ? 'currentColor' : 'none') + '<div class="tooltip">' + title + '</div>');
    }

    /* Кнопка «Подписаться» в панели плеера — на любой серии идущего сериала. Нажали — кнопка остаётся той же (не
     * пересоздаётся), фокус пульта возвращается на неё: иначе фокус терялся и стрелки в панели не работали. */
    function panelDraw(card) {
        panelRemove();
        try {
            var panel = Lampa.PlayerPanel.render(), left = panel.find('.player-panel__left').first();
            if (!left.length) return;
            var box = $('<div class="bs-sub"><div class="button selector bs-sub__btn"></div><div class="bs-sub__next"></div></div>'), btn = box.find('.selector');
            box.find('.bs-sub__next').text(nextText(tvInfo && tvInfo.next, today()));
            panelPaint(box, card);
            var refocus = function () {
                panelPaint(box, card);
                try { Lampa.Controller.toggle('player_panel'); Lampa.Controller.collectionFocus(btn[0], panel); } catch (e) {}
            };
            btn.on('hover:enter', function () {
                tvSubscribe(card, function () {
                    var now = !subscribed(card.id);
                    setSubAll(card, now, tvInfo);
                    subNotify(card, now, tvInfo);
                    refocus();
                    if (!now) return noty('Подписка отменена', 2000);
                    noty(chat() ? 'Подписка: о новой серии напишу в Telegram' : 'Подписка сохранена', 5000);
                }, refocus);
            });
            left.append(box);
        } catch (e) { log('panel', e.message); }
    }

    /** Сериал ещё выходит: есть следующая серия, в производстве или не «завершён/отменён». */
    function ongoing(json) { return !!json && (!!json.next_episode_to_air || !!json.in_production || !/ended|canceled/i.test(String(json.status || ''))); }

    var playSeq = 0;
    function onPlayerStart(data) {
        panelRemove();
        tvInfo = null;
        var my = ++playSeq;
        var card = playerCard(data), s = data && data.season, e = data && data.episode;
        if (!card || !(s > 0) || !(e > 0) || !Lampa.TMDB || !Lampa.Reguest) return;
        var show = function (info) {
            var open = false;
            try { open = Lampa.Player.opened(); } catch (e) {}
            if (my !== playSeq || !open) return;                // плеер закрыли или уже другое видео
            tvInfo = info;
            log('подписка', 's' + s + 'e' + e + (info.ongoing ? ' — сериал идёт, кнопка' : ' — сериал завершён, без кнопки'));
            if (info.ongoing) setTimeout(function () { panelDraw(card); }, 300);
        };
        var c = tvCache[card.id];
        if (c && Date.now() - c.at < 3600000) return show(c);
        var url = Lampa.TMDB.api('tv/' + card.id + '?api_key=' + Lampa.TMDB.key() + '&language=ru');
        new Lampa.Reguest().silent(url, function (json) {
            if (!json) return;
            tvCache[card.id] = { id: card.id, last: json.last_episode_to_air, next: json.next_episode_to_air, ongoing: ongoing(json), at: Date.now() };
            show(tvCache[card.id]);
        }, function () {});
    }

    /* ---------- отключить Telegram ----------
     * Кнопка в настройках (и пустое поле токена): стереть токен, чат, ключи ИИ (владельца и людей) — у себя и в службе.
     * Служба не ответила — у себя всё равно стираем, а bs_tg_forget = '1': сотрём и в ней, как только ответит (svcOn). */
    function tgOff(done) {
        var fin = function (ok) {
            if (!ok && (hasSvcMarks() || svc.up)) lsSet('bs_tg_forget', '1');
            tokenDel();
            ['bs_tg_token', 'bs_tg_secret', 'bs_tg_chat', 'bs_tg_svc', 'bs_ai_svc', 'bs_ai_forget', 'bs_tg_offset', 'bs_tg_tvs'].forEach(lsDel);
            AI_LIST.forEach(function (p) { lsDel(lsKeyName(p)); lsDel(lsMapName(p)); });
            svc.d = null; svc.pend = 0; busStop();
            if (isLeader) { isLeader = false; leader = { id: '', at: 0 }; }
            // службе — «главный не я»: опрашивать бота не будет (токена у неё уже и нет)
            if (svc.up) svcAsk('POST', '/alive', { away: false, offset: -1, cfg: { leader: false, peers: 0, others: 0, allowed: [], known: [], texts: {}, tv: {} } });
            refreshSettings();
            log('Telegram отключён', ok ? '' : '(служба сотрёт, когда ответит)');
            if (done) done(ok);
        };
        if (!svc.up && !hasSvcMarks()) return fin(true);
        svcForget(function (ok) { fin(ok); });
    }
    /** Спросить и отключить. cancel — передумали. */
    function tgOffAsk(cancel) {
        var ctrl = '';
        try { ctrl = Lampa.Controller.enabled().name; } catch (e) {}
        var back = function () { try { if (ctrl) Lampa.Controller.toggle(ctrl); } catch (e) {} };
        try {
            Lampa.Select.show({
                title: esc('Отключить Telegram-бота на этом ТВ?'),
                items: [{ title: esc('Отключить'), subtitle: esc('Токен, чат и ключи ИИ будут стёрты с этого ТВ'), off: true }, { title: esc('Отмена') }],
                onSelect: function (a) { back(); if (!a.off) { if (cancel) cancel(); return; } tgOff(function () { noty('Telegram отключён', 3000); }); },
                onBack: function () { back(); if (cancel) cancel(); }
            });
        } catch (e) { log('отключить', e.message); if (cancel) cancel(); }
    }

    /* ---------- настройки ---------- */

    function refreshSettings() {
        try { $('.settings-param[data-name="bs_tg_link"] .settings-param__descr').text(chat() ? 'Подключено' : 'Не подключено'); } catch (e) {}
    }

    function addSettings() {
        if (!Lampa.SettingsApi) return;
        var C = 'bs_update', api = Lampa.SettingsApi;
        api.addParam({
            component: C, param: { name: 'bs_tg_phone', type: 'button' },
            field: { name: 'Подключить с телефона', description: 'QR-код — токен вводится на телефоне' },
            onChange: pairPhone
        });
        api.addParam({
            component: C, param: { name: 'bs_tg_join', type: 'button' },
            field: { name: 'Подключить через бота', description: 'Бот уже есть на другом ТВ — без токена' },
            onChange: pairJoin
        });
        api.addParam({
            component: C, param: { name: 'bs_tg_help', type: 'static' },
            field: { name: 'Или вручную', description: 'Токен от @BotFather — ниже, затем «Подключить»' }
        });
        // раздел — по состоянию: не подключено — только способы подключения; подключено — «Отключить» и настройки бота
        var W = window.BS_SETTINGS_WHEN = window.BS_SETTINGS_WHEN || {};
        var linked = function () { return state() !== 'none'; }, none = function () { return state() === 'none'; };
        W.bs_tg_phone = W.bs_tg_join = W.bs_tg_help = W.bs_tg_token = none;
        W.bs_tg_link = function () { return state() === 'own' || (none() && hasToken()); };
        W.bs_tg_off = function () { return state() === 'own'; };
        W.bs_tv_name = linked;
        W['#Бот'] = W['#Люди и доступ'] = linked;
        W.bs_tg_on = W.bs_tg_shots = W.bs_search_qr = W.bs_tg_check = W.bs_tg_approve = W.bs_tg_guest_play = W.bs_tg_invite_reset = linked;
        // поле только для ввода: сохранённый токен не показываем (ни на экране, ни при правке) — «Сохранён»
        api.addParam({
            component: C, param: { name: 'bs_tg_token', type: 'input', values: '', placeholder: '123456789:AA…', 'default': '' },
            field: { name: 'Токен бота', description: 'Хранится только на этом ТВ' },
            onRender: function (item) { if (hasToken()) item.find('.settings-param__descr').text('Сохранён — показать его нельзя. Новый токен заменит старый'); },
            onChange: function () {
                var t = String(lsGet('bs_tg_token') || '').replace(/\s+/g, '');
                if (!t) return;                                       // пустое поле — токен как был («Отключить Telegram» — ниже)
                var was = token();
                setToken(t);
                if (t !== was) offsetReset();                        // другой бот — номер апдейта с нуля
                lsSet('bs_tg_chat', ''); refreshSettings(); busStart(); svcMove();
            }
        });
        api.addParam({
            component: C, param: { name: 'bs_tg_link', type: 'button' },
            field: { name: 'Подключить', description: 'Не подключено' },
            onRender: function (item) { item.find('.settings-param__descr').text(chat() ? 'Подключено' : 'Не подключено'); },
            onChange: link
        });
        api.addParam({
            component: C, param: { name: 'bs_tv_name', type: 'input', values: '', placeholder: 'Гостиная', 'default': '' },
            field: { name: 'Название этого ТВ', description: 'Пусто — имя из настроек ТВ' },
            onChange: function (v) { lsSet('bs_tv_name', String(v || '')); busHello(false); }
        });
        api.addParam({
            component: C, param: { name: 'bs_tg_shots', type: 'trigger', 'default': true },
            field: { name: 'Записи Shots — в Telegram', description: 'Видео с кнопки «Записать» придёт в бот' },
            onChange: function (v) { lsSet('bs_tg_shots', String(v === true || v === 'true')); }
        });
        api.addParam({
            component: C, param: { name: 'bs_tg_approve', type: 'trigger', 'default': true },
            field: { name: 'Новые люди — с разрешения', description: 'Бот сначала спросит вас' },
            onChange: function (v) { lsSet('bs_tg_approve', String(v === true || v === 'true')); cfgSend(); }
        });
        api.addParam({
            component: C, param: { name: 'bs_tg_guest_play', type: 'trigger', 'default': true },
            field: { name: 'Гости включают видео на ТВ', description: 'Выключено — гости только ищут и подписываются' },
            onChange: function (v) { lsSet('bs_tg_guest_play', String(v === true || v === 'true')); cfgSend(); }
        });
        api.addParam({
            component: C, param: { name: 'bs_tg_invite_reset', type: 'button' },
            field: { name: 'Сменить приглашение', description: 'Старый QR и ссылки перестанут работать' },
            onChange: function () { inviteReset(); noty('Приглашение сменено — новый QR в поиске', 4000); }
        });
        api.addParam({
            component: C, param: { name: 'bs_search_qr', type: 'trigger', 'default': true },
            field: { name: 'QR бота в поиске', description: 'Искать с телефона, смотреть на ТВ' },
            onChange: function (v) { lsSet('bs_search_qr', String(v === true || v === 'true')); }
        });
        api.addParam({
            component: C, param: { name: 'bs_tg_on', type: 'trigger', 'default': true },
            field: { name: 'Новые серии в Telegram', description: 'Подписки, закладки и начатые сериалы' },
            onChange: function (v) { lsSet('bs_tg_on', String(v === true || v === 'true')); }
        });
        api.addParam({
            component: C, param: { name: 'bs_tg_check', type: 'button' },
            field: { name: 'Проверить новые серии сейчас', description: 'Обычно сама, раз в 6 часов' },
            onChange: function () { if (!chat()) return noty('Сначала подключите бота', 3000); check(true, true); }
        });
        api.addParam({
            component: C, param: { name: 'bs_tg_off', type: 'button' },
            field: { name: 'Отключить Telegram', description: 'Стереть токен, чат и ключи ИИ с этого ТВ' },
            onChange: function () { if (!hasToken() && !chat() && !hasSvcMarks()) return noty('Telegram не подключён', 3000); tgOffAsk(); }
        });
    }

    function start() {
        try { tokenMigrate(); } catch (e) {}
        try { svcStart(); } catch (e) { log('служба', e.message); }
        // служба может стартовать позже 6 проб (медленный ТВ после включения): первые 10 минут — раз в минуту, потом раз в 5
        var svcT0 = Date.now();
        (function svcTick() {
            setTimeout(function () { try { svcCheck(); } catch (e) {} svcTick(); }, Date.now() - svcT0 < 10 * 60000 ? 60000 : 5 * 60000);
        })();
        // общий бот Sunic Apps закрыт (2.3.45): его метки на ТВ больше не нужны
        try { ['bs_sb_on', 'bs_sb_key', 'bs_sb_tv', 'bs_sb_users'].forEach(lsDel); if (lsGet('bs_tg_bot') === 'SunicStreamBot') lsDel('bs_tg_bot'); } catch (e) {}
        try { addSettings(); } catch (e) { log('settings', e.message); }
        try { searchKeypad(); } catch (e) { log('клавиатура поиска', e.message); }
        try { Lampa.Player.listener.follow('destroy', onVideoClosed); } catch (e) {}
        try { Lampa.Search.listener.follow('sources', function () { setTimeout(function () { try { searchQr(); } catch (e) { log('qr поиска', e.message); } }, 50); }); } catch (e) {}
        try {
            Lampa.Listener.follow('full', cardButton);
            Lampa.Listener.follow('full', onFullWatch);
            try { shotsMigrate(); } catch (x) {}
            Lampa.Listener.follow('shots_status', function (e) { try { onShot(e); } catch (x) { log('запись', x.message); } });
            setTimeout(function () { try { shotsSweep(); } catch (x) {} }, 30000);
            setInterval(function () { try { shotsSweep(); } catch (x) {} }, 5 * 60000);
            Lampa.Player.listener.follow('start', onPlayerStart);
            Lampa.Player.listener.follow('destroy', function () { panelRemove(); tvInfo = null; });
        } catch (e) { log('player', e.message); }
        setTimeout(function () { check(false); }, 40000);
        setInterval(function () { check(false); }, 30 * 60000);
        setTimeout(remind, 70000);
        setTimeout(qualityCheck, 90000);
        setInterval(qualityCheck, 3 * 3600000);
        // описание бота — один раз на каждый вид (главный ТВ), без рассылки людям: '1' — «отвечает, пока Lampa открыта»,
        // '2' — со службой «работает, даже когда Lampa закрыта». Служба к 25-й секунде уже ответила (опрос — до ~18 с).
        setTimeout(function () {
            var kind = svcBot() ? '2' : '1';
            if (!hasToken() || !chat() || lsGet('bs_tg_desc') === kind || !leading()) return;
            lsSet('bs_tg_desc', kind);
            setCommands();
        }, 25000);
        setTimeout(function () {
            // новая нижняя клавиатура — старая (с «Профилем» и «Помощью») у людей остаётся, пока бот не пришлёт новую
            if (!newsDue() || !hasToken() || !chat()) return;
            if (!leading()) return;
            setCommands();
            var news = function () {
                return L('✨ Меню стало компактнее: внизу одна кнопка «📋 Меню», внутри все разделы.\n' +
                    '🤖 Опишите фильм словами («фильм про космос, где…») — подберу через AI-ассистента Lampa, свой ключ ИИ не нужен.',
                    '✨ The menu is more compact now: one “📋 Menu” button below, all sections inside.\n' +
                    "🤖 Describe a movie in words (“a movie about space where…”) — I'll find it with the Lampa AI assistant, no AI key of your own needed.",
                    "✨ Menyu ixchamroq bo'ldi: pastda bitta «📋 Menyu» tugmasi, ichida barcha bo'limlar.\n" +
                    "🤖 Filmni so'z bilan tasvirlang («kosmos haqidagi film, unda…») — Lampa AI yordamchisi orqali topaman, o'z kalitingiz kerak emas.");
            };
            as('', function () { sendKb(news()); });
            var people = users();
            Object.keys(people).forEach(function (k) { if (active(people[k])) as(k, function () { sendKb(news()); }); });
        }, 20000);
        setInterval(remind, 10 * 60000);
        setInterval(function () { try { delTick(); } catch (e) {} }, 15000);       // очередь служебных: старше 48 ч — забыть
        setInterval(poll, 15000);                                    // страховка: опрос оборвался (сеть) — поднять
        // служба: «я здесь» и правила, даже когда этот ТВ не опрашивает (ведёт другой) — иначе служба сочтёт, что Lampa ушла
        setInterval(function () {
            try { if (svcBot() && !svc.away && Date.now() - svc.aliveAt >= SVC_ALIVE) svcAlive(false, function (n) { if (n > 0) poll(); }); } catch (e) {}
        }, SVC_ALIVE);
        setInterval(function () { try { svcWake(); } catch (e) {} }, 3000);
        loadDevName();
        setTimeout(function () {
            if (hasToken() && chat() && !lsGet('bs_tg_owner')) call('getChat', { chat_id: chat() }, function (c) {
                var n = c && [c.first_name, c.last_name].filter(Boolean).join(' ');
                if (n) lsSet('bs_tg_owner', n.slice(0, 40));
            }, null);
        }, 15000);
        setTimeout(function () { if (hasToken()) { busStart(); busHello(true); } }, 5000);
        var bye = function () {
            var was = isLeader; isLeader = false; if (was) leader = { id: '', at: 0 };
            if (hasToken()) busSend({ t: 'bye', lead: was });
            try { svcAway(was); } catch (e) {}
        };
        try {
            document.addEventListener('visibilitychange', function () {
                if (document.hidden) return bye();
                svcBack(); conflictUntil = 0; setTimeout(poll, 1000);
                if (hasToken() && othersKnown() > 0) { lastHello = Date.now(); busHello(false); }   // другие ТВ: я снова на экране
            });
            window.addEventListener('unload', bye);
        } catch (e) {}
        setInterval(function () { if (hasToken()) busStart(); }, 60000);
        var lastHello = Date.now();
        setInterval(function () {
            if (!hasToken() || Date.now() - lastHello < HELLO_EVERY || othersKnown() === 0) return;
            lastHello = Date.now();
            busHello(false);
        }, 15000);
        // Failover: главный пропал (выключили, Lampa закрыта, сеть) - первый на экране по очереди берёт бота сразу.
        // Медленный запасной путь (LEADER_ALIVE); быстрый — по апдейтам, которые копятся в Telegram (watchTick).
        setInterval(function () {
            if (!hasToken() || !chat() || pair || polling || !onScreen() || !leaderStale() || takeoverRank() > 0) return;
            if (watch.zeroAt && Date.now() - watch.zeroAt < WATCH_ZERO) return;     // Telegram: апдейты не копятся — главный опрашивает
            conflictUntil = 0; yieldHold = false;
            poll();
        }, 15000);
        setInterval(function () { try { watchTick(); } catch (e) {} }, 15000);
    }

    return { start: start,
        /** 'own' — свой бот подключён, 'none' — не подключено. */
        state: state, refresh: function () { try { refreshSettings(); } catch (e) {} },
        tvName: tvName,
        _chatFrom: chatFrom, _isNew: isNew, _nextText: nextText, _isLatest: isLatest, _tokenFrom: tokenFrom, _weekLines: weekLines, _weekKey: weekKey, _caption: resultCaption, _slideButtons: slideButtons, _fnv: fnv, _parseQuery: parseQuery, _fromGemini: fromGemini, _isGeminiKey: isGeminiKey, _rankModels: rankModels, _cleanDevName: cleanDevName, _joinFrom: joinFrom, _shotCaption: shotCaption, _clock: clock, _verNum: verNum, _keyKind: keyKind, _groqPick: groqPick, _oaContent: oaContent, _ongoing: ongoing, _pushCard: pushCard, _tvSubscribe: tvSubscribe, _fromGeminiList: fromGeminiList, _geminiBody: geminiBody, _as: as, _geminiRun: geminiRun, _isDescription: isDescription, _chatFrom2: chatFrom, _onUserPart: onUserPart, _guestTracked: guestTracked, _mini: mini, _joinMsg: joinMsg, _join4: { code: join4Code, show: join4Show, topic: join4Topic, hellos: join4Hellos, box: join4Box, open: join4Open, send: join4Send, BASE9: BASE9 }, _joinTopic: joinTopic, _joinShow: joinShow, _joinKeys: joinKeys, _aiForget: aiForget, _relaySet: relaySet, _svcSync: svcSync, _tvLabels: tvLabels, _geminiError: geminiError, _geminiSummary: geminiSummary, _menuRows: menuRows, _typedText: typedText, _typeHere: typeHere, _whenVideoEnds: whenVideoEnds, _onVideoClosed: onVideoClosed, _tvPlaying: tvPlaying, _askDuringVideo: askDuringVideo, _stopVideo: stopVideo, _leaderStale: leaderStale, _leaderOnScreen: leaderOnScreen, _watchTick: watchTick, _takeoverRank: takeoverRank, _onBus: onBus, _qualityLine: qualityLine, _waitable: waitable, _qualityName: qualityName, _qualityLow: qualityLow, _lateCommand: lateCommand, _botDesc: function (l, s) { return [botDesc(l || 'ru', s), botShort(l || 'ru', s)]; }, _newsSeen: newsSeen, _newsDue: newsDue, _newsPkgFlag: newsPkgFlag, _shotsMigrate: shotsMigrate, _onShot: onShot, _onConflict: onConflict, _cubCards: cubCards, _commands: commands('ru'), _commandsFor: commands, _L: L, _plainOf: plainOf, _isWord: isWord, _kbWords: KB_WORDS, _help: helpText, _tmdbLang: tmdbLang, _tmdbGet: tmdbGet, _blockParse: blockParse, _blockReset: function () { blockIds = null; blockAt = 0; }, _crypt: Crypt, _busOpen: busOpen, _busKey: busKey, _inviteCode: inviteCode, _inviteReset: inviteReset, _active: active, _handle: handle, _tmp: tmp, _sent: sent, _delTick: delTick, _noteServerTime: noteServerTime, _serverNow: serverNow,
        _call: call, _check: check, _remind: remind, _joinCode: joinCode, _randomTopic: randomTopic,
        _busTopic: busTopic, _svc: svc, _svcKey: function (k) { if (window.BS_TEST_HOOKS !== true) return undefined; if (typeof k === 'string') svcKey = k; return svcKey; },
        _svcStart: svcStart, _svcMove: svcMove, _svcCheck: svcCheck, _svcForget: svcForget, _tgOff: tgOff, _tgOffAsk: tgOffAsk, _svcSeen: svcSeen, _tvRules: tvRules, _addSettings: addSettings, _aiRun: aiRun, _aiSlot: aiSlot, _setAiKey: setAiKey,
        _poll: poll, _takeUpdate: takeUpdate, _pairPhone: pairPhone, _pairJoin: pairJoin, _pairStop: pairStop, _pairNow: function () { return pair; }, _modalOpen: modalOpen, _modalClose: modalClose, _tvBell: tvBell, _bellCard: bellCard, _relays: RELAYS, _relayPost: relayPost, _busRelay: busRelay, _busSend: busSend, _busStart: busStart, _busStop: busStop, _busStreams: function () { return busS; },
        _svcAlive: svcAlive, _svcAway: svcAway, _svcBack: svcBack, _svcWake: svcWake, _svcCfg: svcCfg, _svcBot: svcBot,
        _watchTick: watchTick, _lead: function () { return { isLeader: isLeader, held: held(), polling: polling, watch: watch }; } };
})();
