/*
 * Сторонние онлайн-источники на выбор (плагины Lampa).
 *
 *  Skaz — основной источник, как и раньше. Бесплатные Z01 и Online Mod включены по умолчанию, остальные человек
 *  включает сам в «Онлайн-источниках». Подключаются только адреса из списка ниже (не произвольные ссылки); у каждого
 *  плагина есть запасные адреса (alt) — основной хост не открылся, берём зеркало. Включённый плагин грузится сразу;
 *  выключенный перестаёт грузиться после перезапуска Lampa (код уже загружен, выгрузить его нельзя).
 *
 *  Главная кнопка «Смотреть» на карточке открывает главный источник (по умолчанию Skaz, выбирается здесь же);
 *  вторая — родное меню Lampa со всеми источниками, трейлерами и Shots (bsmenu.js). Чтобы найти кнопку нужного
 *  плагина, у каждого описан её признак (match): у Z01 тот же класс lampac--button, что у Skaz.
 *
 *  Общие ключи. Skaz, Z01 и Online Mod — переделки одного плагина и пишут в одни и те же настройки
 *  (последний источник, «продолжить»). Без защиты чужой плагин сбивал бы выбор Skaz. Поэтому у каждого плагина свой
 *  набор этих ключей: перед входом в его экран текущий набор сохраняется (bs_src_snap_<кто>), а свой — возвращается;
 *  на остальных экранах (карточка, главная) действуют ключи Skaz.
 *
 *  Клубничку (18+) сами не подключаем: у Skaz свой переключатель «Клубничка — Скрыть из меню / Показывать в меню»
 *  (SISI_fix, раздел «ТВ by Skaz»). Своя загрузка в 1.7.57 его перекрывала — «Скрыть» не действовало.
 */
var BSSources = (function () {
    'use strict';

    function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
    function on(k, def) { var v = lsGet(k); return v === null ? def : v === 'true'; }
    function noty(t) { if (veil) return veilSay(t); try { Lampa.Noty.show(t, { time: 5000 }); } catch (e) {} }
    function notyOut(t) { try { Lampa.Noty.show(t, { time: 6000 }); } catch (e) {} }   // мимо заставки
    function log(a, b) { try { console.log('BS sources', a, b === undefined ? '' : b); } catch (e) {} }
    function sub(btn) { return String(btn.attr('data-subtitle') || btn.data('subtitle') || ''); }
    function hasCls(c) { return function (btn) { return btn.hasClass(c); }; }

    /* Плагины на выбор. comp — компонент Lampa, который открывает плагин (по нему знаем, чей сейчас экран). group —
     * плагины с одинаковым компонентом и кнопкой: включить можно только один из группы. */
    var LIST = [
        { id: 'z01', key: 'bs_src_z01', name: 'Z01', url: 'http://z01.online/live', comp: ['lampac_z'], on: true, https: true,
          note: 'Есть реклама',
          match: function (b) { return /^Z01\b/i.test(sub(b)); } },
        // запасной адрес — зеркало автора на surge.sh: GitHub закрыт у человека — Online Mod всё равно грузится
        { id: 'online_mod', key: 'bs_src_online_mod', name: 'Online Mod', url: 'http://nb557.github.io/plugins/online_mod.js', comp: ['online_mod'], group: 'online_mod', on: true, https: true,
          alt: ['https://nb557.surge.sh/online_mod.js', 'http://nb557.surge.sh/online_mod.js'],
          note: 'Без рекламы', match: hasCls('view--online_mod') },
        { id: 'vod_llpp', key: 'bs_src_vod_llpp', name: 'VOD (llpp.in)', url: 'http://llpp.in/v/vod.js', comp: ['online_mod'], group: 'online_mod', https: true,
          note: 'Вместо Online Mod', match: hasCls('view--online_mod') },
        // Lordfilm (github.com/lenorio/lenorio, 2.3.79): проверен в браузере — фильм и сериал, видео за доли секунды.
        // Закреплён на коммите, а не @main: автор не подменит код на ТВ незаметно; новую версию берём, проверив её
        // (sources-scan покажет изменения). Запасные — другие сети jsDelivr.
        { id: 'lordfilm', key: 'bs_src_lordfilm', name: 'Lordfilm', url: 'https://cdn.jsdelivr.net/gh/lenorio/lenorio@79710d2b24b5633265e9905684700e5bd4bf5724/plugins/lordfilm.js',
          alt: ['https://fastly.jsdelivr.net/gh/lenorio/lenorio@79710d2b24b5633265e9905684700e5bd4bf5724/plugins/lordfilm.js',
              'https://gcore.jsdelivr.net/gh/lenorio/lenorio@79710d2b24b5633265e9905684700e5bd4bf5724/plugins/lordfilm.js'],
          comp: ['lordfilm'], on: true, note: 'Без входа и рекламы', match: hasCls('view--lordfilm') },
        // Showy (showy.online) с 2026-11 без входа через @showybot ничего не показывает — вместо него его версия без
        // регистрации (smotret24, два зеркала; только http). Ключ прежний: кто включал Showy, получит эту.
        { id: 'showy', key: 'bs_src_showy', name: 'Showy без регистрации', url: 'http://smotret24.ru/online.js', alt: ['http://smotret24.com/online.js'],
          comp: ['smotret24', 'smotret24_ru', 'smotret24_com'], on: true, note: 'Без входа, до 1080p · есть реклама', match: hasCls('smotret24--button') },
        // MODS's: бесплатно Lumex (1080p) и Filmix (720p), остальное — платная подписка у самого плагина
        { id: 'modss', key: 'bs_src_modss', name: "MODS's", url: 'http://lampa.stream/modss', alt: ['http://modss.tv'], comp: ['modss', 'mods'], https: true,
          note: 'Бесплатно Lumex и Filmix, остальное — платно', match: function (b) { return /mods/i.test(sub(b)) || b.hasClass('view--modss') || b.hasClass('modss--button'); } },
        // arkmv («Онлайн Stream», http://arkmv.ru/vod) убран в 2.3.78: адрес плагина отвечает 404, каталоги пишут «не работает»
    ];
    var SKAZ_COMP = ['lampacskaz'];

    function byId(id) { for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i]; return null; }
    // бесплатные Z01 и Online Mod включены по умолчанию — «Смотреть» ищет фильм во всех источниках по очереди
    function enabled(s) { return on(s.key, !!s.on); }

    /** Чья это кнопка на карточке: id плагина из списка, 'skaz' или ''. */
    function owner(btn) {
        for (var i = 0; i < LIST.length; i++) if (LIST[i].match(btn)) return LIST[i].id;
        var s = sub(btn), text = $.trim(btn.text());
        if (/skaz/i.test(s) || btn.hasClass('lampac--button') || /^(Онлайн|Online)$/i.test(text)) return 'skaz';
        return '';
    }
    /* Нет доступа (Skaz без подписки, платный балансер): источник сказал «нет доступа» — помним DENIED_LIFE и в поиске
     * «Смотреть» ставим его последним, а главным берём первый бесплатный: без подписки человек сразу попадает туда, где
     * видео есть, а не ждёт отказа платного каждый раз. Выбрал главный в настройках сам — отметку снимаем. */
    var DENIED_LIFE = 7 * 86400000;
    function denied(id, now) {
        var t = parseInt(lsGet('bs_src_denied_' + id) || '0', 10) || 0;
        return t > 0 && (now || Date.now()) - t < DENIED_LIFE;
    }
    function markDenied(id) { if (id && id.indexOf('x:') !== 0) lsSet('bs_src_denied_' + id, String(Date.now())); }
    function clearDenied(id) { try { window.localStorage.removeItem('bs_src_denied_' + id); } catch (e) {} }
    /** Главный источник: выбранный, если он включён и доступен; нет доступа — первый доступный включённый; иначе Skaz. */
    function mainId() {
        var id = lsGet('bs_src_main') || 'skaz', s = byId(id);
        if (!(s && enabled(s))) id = 'skaz';
        if (!denied(id)) return id;
        if (id !== 'skaz' && !denied('skaz')) return 'skaz';        // подписка Skaz есть — он раньше бесплатных
        for (var i = 0; i < LIST.length; i++) if (enabled(LIST[i]) && !denied(LIST[i].id)) return LIST[i].id;
        return id;
    }
    function isMain(btn) {
        var who = owner(btn), main = mainId();
        if (main !== 'skaz' && who === main) return true;
        // плагины одной группы рисуют одинаковую кнопку — главный из группы узнаём по группе
        var m = byId(main), w = byId(who);
        if (m && w && m.group && m.group === w.group) return true;
        return main === 'skaz' && who === 'skaz';
    }
    /** Кнопка Skaz наверняка — по подписи «by Skaz»; класс lampac--button бывает и у других плагинов на Lampac. */
    function skazSure(btn) { return /skaz/i.test(sub(btn)); }
    /**
     * Кнопка для «Смотреть» среди кнопок карточки (массив jQuery). Сначала точная кнопка Skaz, потом похожая.
     * fallback — плагин главного источника так и не добавил кнопку (не загрузился): тогда Skaz.
     */
    function pick(btns, fallback) {
        var main = mainId(), i, loose = null;
        for (i = 0; i < btns.length; i++) {
            if (main === 'skaz' ? isMain(btns[i]) && skazSure(btns[i]) : isMain(btns[i])) return btns[i];
            if (!loose && isMain(btns[i])) loose = btns[i];
        }
        if (loose) return loose;
        if (!fallback) return null;
        // главный — Skaz, а его кнопки нет (страница по https: Skaz работает только по http) — первый другой источник
        if (main === 'skaz') {
            for (i = 0; i < btns.length; i++) { var w = owner(btns[i]); if (w && w !== 'skaz') return btns[i]; }
            return null;
        }
        for (i = 0; i < btns.length; i++) if (skazSure(btns[i])) return btns[i];
        for (i = 0; i < btns.length; i++) if (owner(btns[i]) === 'skaz') return btns[i];
        return null;
    }

    /* ---------- свой набор общих ключей у каждого плагина ---------- */

    var SHARED = ['online_balanser', 'active_balanser', 'online_last_balanser', 'online_watched_last'];
    function compOwner(comp) {
        comp = String(comp || '');
        if (SKAZ_COMP.indexOf(comp) >= 0) return 'skaz';
        for (var i = 0; i < LIST.length; i++) if (LIST[i].comp.indexOf(comp) >= 0) return LIST[i].group || LIST[i].id;
        return '';
    }
    function storeGet(k) { try { return Lampa.Storage.get(k, ''); } catch (e) { return lsGet(k) || ''; } }
    function storeSet(k, v) { try { Lampa.Storage.set(k, v); } catch (e) { lsSet(k, typeof v === 'string' ? v : JSON.stringify(v)); } }

    /** Экран плагина next открывается — сохранить ключи прежнего хозяина, вернуть свои. */
    function swapTo(next) {
        var cur = lsGet('bs_src_owner') || 'skaz';
        if (!next || next === cur) return false;
        var snap = {}, saved = null, i;
        for (i = 0; i < SHARED.length; i++) snap[SHARED[i]] = storeGet(SHARED[i]);
        lsSet('bs_src_snap_' + cur, JSON.stringify(snap));
        try { saved = JSON.parse(lsGet('bs_src_snap_' + next) || 'null'); } catch (e) { saved = null; }
        // впервые — с чистого листа: чужой выбор (например, источник Skaz) новому плагину не достаётся
        for (i = 0; i < SHARED.length; i++) storeSet(SHARED[i], saved && saved[SHARED[i]] !== undefined ? saved[SHARED[i]] : '');
        lsSet('bs_src_owner', next);
        return true;
    }
    function onActivity(e) {
        if (!e || (e.type !== 'init' && e.type !== 'archive')) return;
        // вне экранов сторонних плагинов ключи — Skaz: их читают «продолжить» и автопереход (bscontinue, bsfix)
        swapTo(compOwner(e.component) || 'skaz');
    }

    /* ---------- подключение ---------- */

    function loaded(url) {
        try {
            var list = Lampa.Plugins && Lampa.Plugins.get ? Lampa.Plugins.get() : [];
            for (var i = 0; i < list.length; i++) if (list[i] && list[i].url === url) return true;   // человек уже добавил сам
        } catch (e) {}
        return false;
    }
    var done = {};
    /* Сначала https (исполняемый скрипт по открытому http можно подменить по дороге); у кого его нет (s.https false) —
     * как было, http. https не открылся (старый TLS на ТВ, кривой сертификат у хоста) — тогда http, с отметкой в журнале:
     * у каждого адреса есть запасной. Страница по https (браузер) — http браузер всё равно не пустит, его не пробуем. */
    function pageHttps() { try { return window.location.protocol === 'https:'; } catch (e) { return false; } }
    function urlFor(s) { return s.https ? s.url.replace(/^http:\/\//, 'https://') : s.url; }
    /** Адреса плагина по порядку: https основного, его http (если https не открылся), затем зеркала (alt).
     *  Страница по https — http-адреса браузер не пустит, их не пробуем. */
    function urlsFor(s) {
        var list = [urlFor(s)], https = pageHttps(), i;
        if (list[0] !== s.url) list.push(s.url);
        for (i = 0; s.alt && i < s.alt.length; i++) list.push(s.alt[i]);
        // https у этого плагина уже открывался на этом ТВ — на http больше не откатываемся: иначе тот, кто на пути
        // (чужой Wi-Fi), мог бы заблокировать 443 и подсунуть свой код по http (пентест 2026-11-05)
        var tls = https || lsGet('bs_src_tls_' + s.id) === '1';
        var out = list.filter(function (u, k) { return list.indexOf(u) === k && (k === 0 || !tls || /^https:/.test(u)); });
        return out.length ? out : list.slice(0, 1);
    }
    function put(url, ok, bad) {
        try { Lampa.Utils.putScriptAsync([url], null, bad, ok, false); } catch (e) { log('не подключён', url + ' ' + e.message); bad(); }
    }
    /** Подключить плагин s (один раз); cb() — когда загружен или все адреса не открылись. */
    function load(s, cb) {
        var urls = urlsFor(s), end = function () { if (cb) cb(); }, i;
        if (done[s.id]) return end();
        for (i = 0; i < urls.length; i++) if (loaded(urls[i])) return end();
        if (loaded(s.url)) return end();
        done[s.id] = true;
        (function next(k) {
            if (k >= urls.length) return end();
            if (k > 0) log('не открылся ' + urls[k - 1] + ' — пробую', urls[k]);
            put(urls[k], function () {
                log('подключён', urls[k]);
                if (/^https:/.test(urls[k])) lsSet('bs_src_tls_' + s.id, '1');       // запомнить: https здесь работает
                end();
            }, function () {
                if (k + 1 >= urls.length) log('не подключён', urls[k]);
                next(k + 1);
            });
        })(0);
    }
    function loadAll() {
        var groups = {};
        for (var i = 0; i < LIST.length; i++) {
            var s = LIST[i];
            if (!enabled(s) || (s.group && groups[s.group])) continue;   // из группы — только первый включённый
            if (s.group) groups[s.group] = true;
            load(s);
        }
    }

    /* ---------- настройки ---------- */

    function addSettings() {
        if (!Lampa.SettingsApi) return;
        var api = Lampa.SettingsApi, C = 'bs_update', names = { skaz: 'Skaz' }, i;
        for (i = 0; i < LIST.length; i++) names[LIST[i].id] = LIST[i].name;
        api.addParam({
            component: C, param: { name: 'bs_src_main', type: 'select', values: names, 'default': 'skaz' },
            field: { name: 'Главный источник для «Смотреть»', description: 'Первая кнопка на карточке' },
            onChange: function (v) { lsSet('bs_src_main', String(v || 'skaz')); clearDenied(String(v || 'skaz')); }
        });
        LIST.forEach(function (s) {
            api.addParam({
                component: C, param: { name: s.key, type: 'trigger', 'default': !!s.on },
                field: { name: 'Источник ' + s.name, description: s.note },   // «выключится после перезапуска» — в уведомлении при выключении
                onChange: function (v) {
                    var want = v === true || v === 'true';
                    lsSet(s.key, String(want));
                    if (!want) return noty(s.name + ' отключится после перезапуска Lampa');
                    if (s.group) LIST.forEach(function (o) {                 // один плагин из группы — второй выключаем
                        if (o !== s && o.group === s.group && enabled(o)) {
                            lsSet(o.key, 'false');
                            try { Lampa.Storage.set(o.key, false); } catch (e) {}
                            noty(o.name + ' выключен — включён ' + s.name);
                        }
                    });
                    load(s);
                }
            });
        });
    }

    /** Включить плагин из списка и сделать его главным для «Смотреть» (bsmenu.js: выбор без входа в CUB).
     *  cb() — когда плагин загружен (или уже был). */
    function useMain(id, cb) {
        var s = byId(id);
        if (!s) return false;
        lsSet(s.key, 'true');
        lsSet('bs_src_main', id);
        try { Lampa.Storage.set(s.key, true); Lampa.Storage.set('bs_src_main', id); } catch (e) {}
        load(s, cb);
        return true;
    }

    /* ---------- поиск по всем источникам ----------
     * «Смотреть» (bsmenu.js) начинает поиск с главного источника. Источник сдался — нет фильма, нет доступа (Skaz без
     * CUB), сервер не отвечает и свои балансеры кончились (bsfix.js зовёт giveUp) — назад на карточку и кнопка
     * следующего включённого источника. Только в течение поиска, начатого «Смотреть» (не при ручном выборе). */
    var SEARCH_LIFE = 180000;
    var search = null;   // {id: фильм, tried: [id источника], until}
    function order() {
        var main = mainId(), ids = [main];
        if (main !== 'skaz') ids.push('skaz');
        var groups = {};
        LIST.forEach(function (s) {
            if (!enabled(s) || (s.group && groups[s.group])) return;
            if (s.group) groups[s.group] = true;
            if (ids.indexOf(s.id) < 0) ids.push(s.id);
        });
        return sortDenied(ids, Date.now());
    }
    /** Источники без доступа — в конец (порядок остальных не меняется). */
    function sortDenied(ids, now) {
        var ok = [], no = [];
        ids.forEach(function (id) { (denied(id, now) ? no : ok).push(id); });
        return ok.concat(no);
    }
    /** Один и тот же источник: id совпадают или это плагины одной группы (одинаковая кнопка — Online Mod / VOD). */
    function sameSource(a, b) { var x = byId(a), y = byId(b); return a === b || !!(x && y && x.group && x.group === y.group); }
    function nameOf(id) { var s = byId(id); return s ? s.name : 'Skaz'; }
    function activeMovieId() { try { var a = Lampa.Activity.active(); return (a.movie || a.card || {}).id || 0; } catch (e) { return 0; } }

    /* Источники, которые человек добавил сам (свои плагины в «Расширениях»), тоже участвуют: на карточке — любая кнопка
     * онлайн-источника. Известные — по порядку order(), свои — за ними, как стоят на карточке. Ключ кнопки: id из списка
     * или «x:подпись» для своих. Торренты, трейлеры, Shots, «Подписаться» и наши «Смотреть»/«Источники» — не источники. */
    function looksOnline(b) {
        if (b.hasClass('bs-watch') || b.hasClass('button--play') || b.hasClass('view--torrent') || b.hasClass('view--trailer')) return false;
        var t = sub(b) + ' ' + $.trim(b.text());
        if (/нарезк|shots|трейлер|trailer|торрент|torrent|подписа|subscribe|закладк/i.test(t)) return false;
        return b.hasClass('view--online') || b.hasClass('lampac--button') || /онлайн|online/i.test(t);
    }
    function keyOf(b) {
        var o = owner(b), s = $.trim(sub(b));
        if (o === 'skaz' && s && !skazSure(b)) return 'x:' + s;    // свой плагин на Lampac (класс как у Skaz, подпись своя)
        if (o) return o;
        s = s || $.trim(b.text());
        return s ? 'x:' + s : '';
    }
    function labelOf(k) { return k.indexOf('x:') === 0 ? k.slice(2) : nameOf(k); }
    /** Кнопки источников на карточке по порядку поиска: [{key, btn}]. */
    function candidates(btns) {
        var known = [], own = [], ids = order(), i;
        for (i = 0; i < btns.length; i++) {
            var b = btns[i], k = keyOf(b);
            if (!k || !looksOnline(b) && !byId(k) && k !== 'skaz') continue;
            if (k === 'skaz' || byId(k)) {
                var at = -1;
                for (var j = 0; j < ids.length; j++) if (sameSource(ids[j], k)) { at = j; break; }
                if (at >= 0) known.push({ key: ids[at], btn: b, at: at });
            } else own.push({ key: k, btn: b });
        }
        known.sort(function (a, b) { return a.at - b.at; });
        return known.concat(own);
    }
    function triedHas(k) {
        for (var i = 0; i < search.tried.length; i++) if (sameSource(search.tried[i], k)) return true;
        return false;
    }

    /** Видео не пошло, а свои источники плагина кончились (bsfix.js, playerguard.js): не «выберите вручную», а
     *  следующий плагин — как при поиске «Смотреть». Поиска не было (выбрали источник сами) или он устарел — начинаем
     *  с текущего. true — идём к следующему; false — некуда (не карточка, нет фильма). */
    /* Переход к следующему плагину из плеера — только под заставкой «Подбираю, где посмотреть» (veil): человек не
     * видит, как экраны открываются и закрываются (2.3.93 делал это на виду — пугало). Без заставки — как в 2.3.94:
     * «выберите вручную». */
    function fallback(why) {
        if (!veil) return false;
        var id = activeMovieId(), comp = '';
        if (!id) return false;
        try { if (Lampa.Player.opened()) return false; } catch (e) {}   // пока закрывали, включили другое видео — не мешаем
        try { comp = Lampa.Activity.active().component; } catch (e) {}
        var who = compOwner(comp);
        if (!who) return false;                                  // не экран онлайн-источника
        if (!search || search.id != id || Date.now() > search.until) startSearch(id, who);
        search.until = Date.now() + SEARCH_LIFE;
        search.fallback = true;
        return giveUp(comp, why || 'noanswer');
    }
    /* ---------- заставка «Подбираю, где посмотреть» ----------
     * «Смотреть» на фильме (или на начатом сериале — плагин сам включит его серию): поверх всего (и плеера) — постер и
     * «Подбираю, где посмотреть…»; под ней поиск по источникам идёт как обычно (экраны плагинов, плеер, переход к
     * следующему), но человек этого не видит, а пульт ловим мы: «Назад» — отмена, остальное — ничего. Снимаем, когда
     * видео пошло (и это не подделка), когда источник показал список и сам ничего не включает (выбрать вручную) —
     * STEP_WAIT, и не дольше VEIL_MAX. Подделка — видео гораздо короче фильма по TMDB (заглушка, реклама под чужим
     * названием): источник помним для этого фильма (bs_src_fake, 7 дней) и ищем дальше. */
    var VEIL_MAX = 75000, STEP_WAIT = 20000, FAKE_LIFE = 7 * 86400000, BACK_KEYS = [8, 27, 10009, 461, 4];
    var veil = null;     // {el, card, all, step, keys, playing}
    function isTv(card) { return !!(card && (card.original_name || card.number_of_seasons || card.first_air_date)); }
    /** Ставить ли заставку: фильм — всегда; сериал — только начатый (иначе плагин ждёт выбора серии). */
    function veilWanted(card) {
        if (!card || !(card.id > 0) || lsGet('bs_auto_source') === 'false') return false;
        if (!isTv(card)) return true;
        try { return (window.BSContinue && BSContinue._load ? BSContinue._load() : []).some(function (r) { return r && r.card && r.card.id == card.id; }); }
        catch (e) { return false; }
    }
    function veilCss() {
        if (document.getElementById('bs-veil-css')) return;
        var st = document.createElement('style');
        st.id = 'bs-veil-css';
        st.textContent = '.bs-veil{position:fixed;left:0;top:0;right:0;bottom:0;z-index:100000;background:#0b0d10;display:flex;align-items:center;justify-content:center;color:#fff}' +
            '.bs-veil__box{text-align:center;max-width:70%}.bs-veil__img{width:12em;border-radius:.6em;margin-bottom:1.5em;box-shadow:0 1em 3em rgba(0,0,0,.6)}' +
            '.bs-veil__title{font-size:1.8em;font-weight:600;margin-bottom:.6em}.bs-veil__text{font-size:1.3em;opacity:.85}' +
            '.bs-veil__hint{margin-top:2em;font-size:1em;opacity:.5}';
        document.head.appendChild(st);
    }
    function veilOn(card) {
        veilOff();
        if (!veilWanted(card)) return false;
        try {
            veilCss();
            var el = $('<div class="bs-veil"><div class="bs-veil__box"><div class="bs-veil__title"></div><div class="bs-veil__text"></div><div class="bs-veil__hint">Назад — отменить</div></div></div>');
            el.find('.bs-veil__title').text(card.title || card.name || '');
            el.find('.bs-veil__text').text('Подбираю, где посмотреть…');
            if (card.poster_path) el.find('.bs-veil__box').prepend($('<img class="bs-veil__img">').attr('src', 'https://image.tmdb.org/t/p/w300' + card.poster_path));
            $('body').append(el);
            var keys = function (e) {
                if (!veil) return;
                var k = e.keyCode || e.which;
                e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation();
                if (e.type === 'keydown' && BACK_KEYS.indexOf(k) >= 0) veilCancel();
            };
            ['keydown', 'keyup', 'keypress'].forEach(function (t) { window.addEventListener(t, keys, true); });
            veil = { el: el, card: card, keys: keys, playing: false, step: 0, all: setTimeout(function () { veilGiveUp('Не нашёл быстро — выберите вручную'); }, VEIL_MAX) };
            veilStep();
            return true;
        } catch (e) { log('заставка', e.message); veilOff(); return false; }
    }
    function veilSay(t) { try { if (veil) veil.el.find('.bs-veil__text').text(String(t)); } catch (e) {} }
    function veilOff() {
        var v = veil;
        veil = null;
        if (!v) return;
        clearTimeout(v.all); clearTimeout(v.step);
        ['keydown', 'keyup', 'keypress'].forEach(function (t) { window.removeEventListener(t, v.keys, true); });
        try { v.el.remove(); } catch (e) {}
    }
    /** Новый шаг поиска (открыли источник, закрыли плеер): если STEP_WAIT ничего не играет — источник ждёт выбора. */
    function veilStep() {
        if (!veil) return;
        clearTimeout(veil.step);
        veil.step = setTimeout(function () {
            if (!veil || veil.playing) return;
            var name = '';
            try { name = labelOf(compOwner(Lampa.Activity.active().component) || (search && search.current) || ''); } catch (e) {}
            veilOff();
            notyOut(name ? 'Выберите, что включить в «' + name + '»' : 'Выберите источник');
        }, STEP_WAIT);
    }
    function veilGiveUp(t) {
        if (!veil) return;
        veilOff();
        search = null;
        try { if (Lampa.Player.opened()) Lampa.Player.close(); } catch (e) {}
        notyOut(t);
    }
    /** «Назад» на заставке: всё остановить и вернуться на карточку. */
    function veilCancel() {
        veilOff();
        search = null;
        try { if (Lampa.Player.opened()) Lampa.Player.close(); } catch (e) {}
        setTimeout(function () { try { if (compOwner(Lampa.Activity.active().component)) Lampa.Activity.backward(); } catch (e) {} }, 300);
    }
    function onPlayer(e) {
        if (!veil || !e) return;
        if (e.type === 'start') { veil.playing = true; clearTimeout(veil.step); }
        else if (e.type === 'destroy') { veil.playing = false; veilStep(); }   // не пошло — сторож закрыл, ищем дальше
    }

    function fakes() { var m = null; try { m = JSON.parse(lsGet('bs_src_fake') || 'null'); } catch (e) {} return m && typeof m === 'object' ? m : {}; }
    function isFake(movie, src) { var r = fakes()[movie + ':' + src]; return !!r && Date.now() - r < FAKE_LIFE; }
    function markFake(movie, src) {
        if (!movie || !src) return;
        var m = fakes(), now = Date.now(), out = {};
        m[movie + ':' + src] = now;
        Object.keys(m).filter(function (k) { return now - m[k] < FAKE_LIFE; }).slice(-100).forEach(function (k) { out[k] = m[k]; });
        lsSet('bs_src_fake', JSON.stringify(out));
    }
    /** Подделка ли: фильм по TMDB (runtime, минуты) от 40 мин, а видео (dur, секунды) короче половины или 10 мин.
     *  Сериалы, неизвестная длина, прямой эфир (Infinity) — не судим. */
    function fakeVideo(card, dur) {
        var rt = +(card && card.runtime) || 0;
        if (isTv(card) || rt < 40 || !(dur > 0) || !isFinite(dur)) return false;
        return dur < 600 || dur < rt * 60 * 0.5;
    }
    /** Сторож плеера: видео пошло (dur — длина в секундах, если знает). 'fake' — подделка: плеер закрываем сами и
     *  ищем дальше; иначе заставку снимаем и отметку «нет доступа» у источника стираем. */
    function played(dur) {
        var w = '';
        try { w = compOwner(Lampa.Activity.active().component); } catch (e) {}
        if (veil && fakeVideo(veil.card, dur)) {
            var v = veil, who = w || (search && search.current) || '';
            markFake(v.card.id, who);
            log('подделка', who + ' ' + Math.round(dur) + ' с при ' + v.card.runtime + ' мин');
            veilSay('В «' + labelOf(who) + '» под этим названием другое видео — ищу дальше');
            v.playing = false;
            try { Lampa.Player.close(); } catch (e) {}
            setTimeout(function () { if (veil === v && !fallback('fake')) veilGiveUp('Рабочий источник не найден — выберите вручную'); }, 900);
            return 'fake';
        }
        if (w) clearDenied(w);
        if (veil) { veilOff(); if (w) notyOut('Нашёл в «' + labelOf(w) + '»'); }
        return '';
    }

    /** «Смотреть» нажали: поиск по источникам для этого фильма, первый — first (ключ кнопки). */
    function startSearch(movieId, first) {
        first = first || mainId();
        search = movieId ? { id: movieId, tried: [first], current: first, until: Date.now() + SEARCH_LIFE } : null;
    }
    /** Экран источника comp сдался (why: 'empty' | 'denied' | 'noanswer'). true — идём к следующему источнику. */
    function giveUp(comp, why) {
        // «нет доступа» помним и без поиска «Смотреть» (источник открыли сами) — в следующий раз он последний
        var mainWas = mainId(), fresh = !!search && Date.now() <= search.until && search.id == activeMovieId();
        if (why === 'denied') markDenied(compOwner(comp) || (fresh ? search.current : ''));
        var closed = why === 'denied' || why === 'noconnect';    // для поиска «нет связи» — как «нет доступа»
        if (!fresh) return false;
        var who = compOwner(comp) || search.current;
        if (!triedHas(who)) search.tried.push(who);
        var cur = labelOf(who), id = search.id, s = search;
        // Skaz — по подписке Skaz (к входу в CUB не относится): нет подписки — он пишет «Нет доступа». Человек должен
        // просто смотреть: идём к бесплатному источнику и делаем его главным, чтобы в следующий раз без этого крюка
        var skazOff = closed && sameSource(who, mainWas);   // главный без доступа — дальше главным бесплатный
        if (why === 'denied') markDenied(who);                     // кнопка без экрана (search.current)
        noty(skazOff ? (who === 'skaz' ? 'Skaz — по подписке, её нет' : 'В «' + cur + '» нет доступа') + '. Включаю бесплатный источник' :
            (closed ? 'В «' + cur + '» нет доступа' : why === 'fake' ? 'В «' + cur + '» не тот фильм' : why === 'noanswer' ? '«' + cur + '» не отвечает' : 'В «' + cur + '» нет') +
            ' — ищу в других источниках');
        log('поиск: ' + who + ' сдался', why);
        try { Lampa.Activity.backward(); } catch (e) {}
        var tries = 0;
        (function press() {
            if (++tries > 15 || search !== s) return;
            setTimeout(function () {
                var list = null;
                try {
                    var a = Lampa.Activity.active(), btns = [];
                    if (a.component !== 'full' || (a.card || a.movie || {}).id != id) return press();
                    $(a.activity.render()).find('.buttons--container > .full-start__button').each(function () { btns.push($(this)); });
                    list = candidates(btns).filter(function (c) { return !triedHas(c.key); });
                    list = list.filter(function (c) { return !isFake(id, c.key); }).concat(list.filter(function (c) { return isFake(id, c.key); }));
                } catch (e) { return press(); }
                if (!list.length) {
                    var fb = s.fallback;
                    search = null;
                    veilOff();
                    // видео не пошло нигде (fallback) — фильм есть, просто не играет: выбрать вручную
                    return notyOut(fb ? 'Рабочий источник не найден — выберите вручную' : 'Фильма нет ни в одном источнике — попробуйте позже или другой фильм');
                }
                veilStep();
                s.tried.push(list[0].key);
                s.current = list[0].key;
                if (skazOff && byId(list[0].key)) {
                    lsSet('bs_src_main', list[0].key);
                    try { Lampa.Storage.set('bs_src_main', list[0].key); } catch (e) {}
                    noty('Главный источник теперь «' + labelOf(list[0].key) + '». Вернуть «' + cur + '»: Sunic Apps → Онлайн-источники');
                } else noty('Ищу в «' + labelOf(list[0].key) + '»');
                list[0].btn.trigger('hover:enter');
            }, 300);
        })();
        return true;
    }

    /* Списки Lampac (Skaz, Z01): варианты с пометкой «Заблокировано» (правообладатель закрыл в этой стране) не
     * откроются — убираем их из ответа, прежде чем плагин нарисует список. Тогда «Смотреть» не упирается в них, а
     * если заблокировано всё — список пуст, и поиск переходит к следующему источнику. Дешёвая проверка первой:
     * разбираем HTML, только если в ответе есть и пункты, и это слово. */
    function dropBlocked(html) {
        if (typeof html !== 'string' || html.indexOf('videos__item') < 0 || html.indexOf('Заблокировано') < 0) return null;
        var doc = null, items, i, n = 0;
        try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch (e) {}
        if (!doc || !doc.body) return null;
        items = doc.querySelectorAll('.videos__item');
        for (i = 0; i < items.length; i++) {
            if (/заблокировано/i.test(items[i].textContent || '') && items[i].parentNode) { items[i].parentNode.removeChild(items[i]); n++; }
        }
        if (!n) return null;
        log('убраны заблокированные', n + ' из ' + items.length);
        return doc.body.innerHTML;
    }
    function hookBlocked() {
        // Lampa переименовывает опечатки (lampa-source #411): request_secuses → request_success; слушаем оба имени
        ['request_secuses', 'request_success'].forEach(function (ev) { Lampa.Listener.follow(ev, onReply); });
        function onReply(e) {
            if (!e || !e.params) return;
            var out = dropBlocked(e.data);
            if (out === null) return;
            if (typeof e.abort === 'function') { var send = e.abort(); if (typeof send === 'function') send(out); return; }
            ['complite', 'complete'].forEach(function (k) {             // старое и новое имя (#411)
                var orig = e.params[k];
                if (typeof orig === 'function') e.params[k] = function () {
                    var a = Array.prototype.slice.call(arguments);
                    a[0] = out;
                    return orig.apply(this, a);
                };
            });
        }
    }

    function start() {
        try { addSettings(); } catch (e) { log('настройки', e.message); }
        try { Lampa.Listener.follow('activity', onActivity); } catch (e) {}
        try { hookBlocked(); } catch (e) { log('заблокированные', e.message); }
        try { Lampa.Player.listener.follow('start', onPlayer); Lampa.Player.listener.follow('destroy', onPlayer); } catch (e) {}
        try { loadAll(); } catch (e) { log('подключение', e.message); }
    }

    return { start: start, owner: owner, mainId: mainId, isMain: isMain, pick: pick, list: LIST, useMain: useMain,
        startSearch: startSearch, giveUp: giveUp, fallback: fallback,
        /** Видео пошло: этот источник доступен (купили подписку) — отметку «нет доступа» снимаем. */
        played: played, veilOn: veilOn, veilOff: veilOff, veilWanted: veilWanted, _veil: function () { return veil; }, _isFake: isFake, _fakeVideo: fakeVideo, here: function () { if (!veil) return false; try { return !!compOwner(Lampa.Activity.active().component); } catch (e) { return false; } }, _denied: denied, _sortDenied: sortDenied, order: order, _search: function () { return search; }, _candidates: candidates, _looksOnline: looksOnline,
        _swapTo: swapTo, _compOwner: compOwner, _onActivity: onActivity, _loadAll: loadAll, _dropBlocked: dropBlocked };
})();
