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
    function noty(t) { try { Lampa.Noty.show(t, { time: 5000 }); } catch (e) {} }
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
        // Showy (showy.online) с 2026-11 без входа через @showybot ничего не показывает — вместо него его версия без
        // регистрации (smotret24, два зеркала; только http). Ключ прежний: кто включал Showy, получит эту.
        { id: 'showy', key: 'bs_src_showy', name: 'Showy без регистрации', url: 'http://smotret24.ru/online.js', alt: ['http://smotret24.com/online.js'],
          comp: ['smotret24', 'smotret24_ru', 'smotret24_com'], note: 'Без входа, до 1080p · есть реклама', match: hasCls('smotret24--button') },
        // MODS's: бесплатно Lumex (1080p) и Filmix (720p), остальное — платная подписка у самого плагина
        { id: 'modss', key: 'bs_src_modss', name: "MODS's", url: 'http://lampa.stream/modss', alt: ['http://modss.tv'], comp: ['modss', 'mods'], https: true,
          note: 'Бесплатно Lumex и Filmix, остальное — платно', match: function (b) { return /mods/i.test(sub(b)) || b.hasClass('view--modss') || b.hasClass('modss--button'); } },
        // Lordfilm (github.com/lenorio/lenorio, 2.3.79): проверен в браузере — фильм и сериал, видео за доли секунды.
        // Закреплён на коммите, а не @main: автор не подменит код на ТВ незаметно; новую версию берём, проверив её
        // (sources-scan покажет изменения). Запасные — другие сети jsDelivr.
        { id: 'lordfilm', key: 'bs_src_lordfilm', name: 'Lordfilm', url: 'https://cdn.jsdelivr.net/gh/lenorio/lenorio@79710d2b24b5633265e9905684700e5bd4bf5724/plugins/lordfilm.js',
          alt: ['https://fastly.jsdelivr.net/gh/lenorio/lenorio@79710d2b24b5633265e9905684700e5bd4bf5724/plugins/lordfilm.js',
              'https://gcore.jsdelivr.net/gh/lenorio/lenorio@79710d2b24b5633265e9905684700e5bd4bf5724/plugins/lordfilm.js'],
          comp: ['lordfilm'], note: 'Без входа и рекламы', match: hasCls('view--lordfilm') },
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
    /** Главный источник: выбранный, если он включён; иначе Skaz. */
    function mainId() {
        var id = lsGet('bs_src_main') || 'skaz', s = byId(id);
        return s && enabled(s) ? id : 'skaz';
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
        return list.filter(function (u, k) { return list.indexOf(u) === k && (k === 0 || !https || /^https:/.test(u)); });
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
            put(urls[k], function () { log('подключён', urls[k]); end(); }, function () {
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
            onChange: function (v) { lsSet('bs_src_main', String(v || 'skaz')); }
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
        return ids;
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

    /** «Смотреть» нажали: поиск по источникам для этого фильма, первый — first (ключ кнопки). */
    function startSearch(movieId, first) {
        first = first || mainId();
        search = movieId ? { id: movieId, tried: [first], current: first, until: Date.now() + SEARCH_LIFE } : null;
    }
    /** Экран источника comp сдался (why: 'empty' | 'denied' | 'noanswer'). true — идём к следующему источнику. */
    function giveUp(comp, why) {
        if (!search || Date.now() > search.until || search.id != activeMovieId()) return false;
        var who = compOwner(comp) || search.current;
        if (!triedHas(who)) search.tried.push(who);
        var cur = labelOf(who), id = search.id, s = search;
        // Skaz — по подписке Skaz (к входу в CUB не относится): нет подписки — он пишет «Нет доступа». Человек должен
        // просто смотреть: идём к бесплатному источнику и делаем его главным, чтобы в следующий раз без этого крюка
        var skazOff = why === 'denied' && who === 'skaz' && mainId() === 'skaz';
        noty(skazOff ? 'Skaz — по подписке, её нет. Включаю бесплатный источник' :
            (why === 'denied' ? 'В «' + cur + '» нет доступа' : why === 'noanswer' ? '«' + cur + '» не отвечает' : 'В «' + cur + '» нет') +
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
                } catch (e) { return press(); }
                if (!list.length) {
                    search = null;
                    return noty('Фильма нет ни в одном источнике — попробуйте позже или другой фильм');
                }
                s.tried.push(list[0].key);
                s.current = list[0].key;
                if (skazOff && byId(list[0].key)) {
                    lsSet('bs_src_main', list[0].key);
                    try { Lampa.Storage.set('bs_src_main', list[0].key); } catch (e) {}
                    noty('Главный источник теперь «' + labelOf(list[0].key) + '». Вернуть Skaz: Sunic Apps → Онлайн-источники');
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
        Lampa.Listener.follow('request_secuses', function (e) {
            if (!e || !e.params) return;
            var out = dropBlocked(e.data);
            if (out === null) return;
            if (typeof e.abort === 'function') { var send = e.abort(); if (typeof send === 'function') send(out); return; }
            var orig = e.params.complite;
            if (typeof orig === 'function') e.params.complite = function () {
                var a = Array.prototype.slice.call(arguments);
                a[0] = out;
                return orig.apply(this, a);
            };
        });
    }

    function start() {
        try { addSettings(); } catch (e) { log('настройки', e.message); }
        try { Lampa.Listener.follow('activity', onActivity); } catch (e) {}
        try { hookBlocked(); } catch (e) { log('заблокированные', e.message); }
        try { loadAll(); } catch (e) { log('подключение', e.message); }
    }

    return { start: start, owner: owner, mainId: mainId, isMain: isMain, pick: pick, list: LIST, useMain: useMain,
        startSearch: startSearch, giveUp: giveUp, order: order, _search: function () { return search; }, _candidates: candidates, _looksOnline: looksOnline,
        _swapTo: swapTo, _compOwner: compOwner, _onActivity: onActivity, _loadAll: loadAll, _dropBlocked: dropBlocked };
})();
