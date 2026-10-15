/*
 * Сторонние онлайн-источники на выбор (плагины Lampa).
 *
 *  Skaz — основной источник, как и раньше. Остальные плагины по умолчанию выключены: человек сам включает нужные
 *  в «Онлайн-источниках». Подключаются только адреса из списка ниже (не произвольные ссылки). Включённый плагин
 *  грузится сразу; выключенный перестаёт грузиться после перезапуска Lampa (код уже загружен, выгрузить его нельзя).
 *
 *  Главная кнопка «Смотреть» на карточке открывает главный источник (по умолчанию Skaz, выбирается здесь же);
 *  вторая — родное меню Lampa со всеми источниками, трейлерами и Shots (bsmenu.js). Чтобы найти кнопку нужного
 *  плагина, у каждого описан её признак (match): у Z01 и arkmv тот же класс lampac--button, что у Skaz.
 *
 *  Общие ключи. Skaz, Z01, arkmv и Online Mod — переделки одного плагина и пишут в одни и те же настройки
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
        { id: 'z01', key: 'bs_src_z01', name: 'Z01', url: 'http://z01.online/live', comp: ['lampac_z'],
          note: 'Бесплатные источники и платный VIP. Есть реклама.',
          match: function (b) { return /^Z01\b/i.test(sub(b)); } },
        { id: 'online_mod', key: 'bs_src_online_mod', name: 'Online Mod', url: 'http://nb557.github.io/plugins/online_mod.js', comp: ['online_mod'], group: 'online_mod',
          note: 'Открытый код (GitHub nb557).', match: hasCls('view--online_mod') },
        { id: 'vod_llpp', key: 'bs_src_vod_llpp', name: 'VOD (llpp.in)', url: 'http://llpp.in/v/vod.js', comp: ['online_mod'], group: 'online_mod',
          note: 'Вариант Online Mod — включается вместо него.', match: hasCls('view--online_mod') },
        { id: 'showy', key: 'bs_src_showy', name: 'Showy', url: 'http://showy.online/m.js', comp: ['showy_free', 'showy'],
          note: 'Filmix, Rezka, Kodik. Есть реклама.', match: hasCls('showy--button') },
        { id: 'arkmv', key: 'bs_src_arkmv', name: 'Vod (arkmv)', url: 'http://arkmv.ru/vod', comp: ['vod'],
          note: 'Есть реклама.', match: function (b) { return b.hasClass('lampac--button') && /^Vod\b/i.test(sub(b)); } }
    ];
    var SKAZ_COMP = ['lampacskaz'];

    function byId(id) { for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i]; return null; }
    function enabled(s) { return on(s.key, false); }

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
        if (!fallback || main === 'skaz') return null;
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
    function load(url) {
        if (done[url] || loaded(url)) return;
        done[url] = true;
        try { Lampa.Utils.putScriptAsync([url], function () { log('подключён', url); }); } catch (e) { log('не подключён', url + ' ' + e.message); }
    }
    function loadAll() {
        var groups = {};
        for (var i = 0; i < LIST.length; i++) {
            var s = LIST[i];
            if (!enabled(s) || (s.group && groups[s.group])) continue;   // из группы — только первый включённый
            if (s.group) groups[s.group] = true;
            load(s.url);
        }
    }

    /* ---------- настройки ---------- */

    function addSettings() {
        if (!Lampa.SettingsApi) return;
        var api = Lampa.SettingsApi, C = 'bs_update', names = { skaz: 'Skaz' }, i;
        for (i = 0; i < LIST.length; i++) names[LIST[i].id] = LIST[i].name;
        api.addParam({
            component: C, param: { name: 'bs_src_main', type: 'select', values: names, 'default': 'skaz' },
            field: { name: 'Главный источник для «Смотреть»', description: 'Первая кнопка на карточке. Если выбранный источник выключен — Skaz.' },
            onChange: function (v) { lsSet('bs_src_main', String(v || 'skaz')); }
        });
        LIST.forEach(function (s) {
            api.addParam({
                component: C, param: { name: s.key, type: 'trigger', 'default': false },
                field: { name: 'Источник ' + s.name, description: s.note + ' Выключение — после перезапуска Lampa.' },
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
                    load(s.url);
                }
            });
        });
    }

    function start() {
        try { addSettings(); } catch (e) { log('настройки', e.message); }
        try { Lampa.Listener.follow('activity', onActivity); } catch (e) {}
        try { loadAll(); } catch (e) { log('подключение', e.message); }
    }

    return { start: start, owner: owner, mainId: mainId, isMain: isMain, pick: pick, list: LIST,
        _swapTo: swapTo, _compOwner: compOwner, _onActivity: onActivity, _loadAll: loadAll };
})();
