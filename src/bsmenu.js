/*
 * Свои пункты левого меню.
 *
 *  «Турецкие сериалы» — каталог TMDB: сериалы с турецким языком оригинала, сначала популярные, названия и описания
 *  по-русски (язык интерфейса Lampa). Без ток-шоу, реалити, новостей и мультфильмов (жанры TMDB 10767, 10764,
 *  10763, 16) и без совсем безвестных (меньше 5 оценок). Открывается штатным экраном каталога Lampa
 *  (category_full), карточки и «Смотреть» — как везде. Пункт стоит сразу после «Сериалов»; выключается в
 *  «Настройки → Sunic Apps → Интерфейс».
 *
 *  По нажатию — короткое меню (первым выделено «Популярные», для мамы это одно лишнее «ОК»): популярные, новинки,
 *  лучшие по оценкам, по жанру, по годам, поиск по названию. Поиск TMDB по языку оригинала фильтровать не умеет —
 *  ищем по названию (2 страницы) и оставляем только турецкие (язык оригинала tr или страна TR).
 */
var BSMenu = (function () {
    var TURK = {
        action: 'bs_turk',
        title: 'Турецкие сериалы'
    };
    // полумесяц и звезда
    var ICON = '<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M10.5 3a9 9 0 1 0 6.4 15.4A7.2 7.2 0 1 1 16.9 5.6 8.97 8.97 0 0 0 10.5 3z"/>' +
        '<path d="M17.6 9.2l.9 2 2.2.2-1.7 1.4.5 2.1-1.9-1.1-1.9 1.1.5-2.1-1.7-1.4 2.2-.2z"/></svg>';

    function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
    function enabled() { return lsGet('bs_menu_turk') !== 'false'; }

    // vote_count.gte — у каждого пункта свой: повтор параметра TMDB не прощает («Invalid parameters», пустой список)
    var BASE = 'discover/tv?with_original_language=tr&without_genres=16,10763,10764,10767';
    var GENRES = [
        [18, 'Драма'], [10766, 'Мелодрама (мыльная опера)'], [35, 'Комедия'], [10751, 'Семейный'],
        [80, 'Криминал'], [9648, 'Детектив'], [10759, 'Боевик и приключения'], [10768, 'Исторический, война'],
        [10765, 'Фэнтези']
    ];
    var YEARS = [['Новые: 2023 и позже', '2023-01-01', ''], ['2018–2022', '2018-01-01', '2022-12-31'],
        ['2010–2017', '2010-01-01', '2017-12-31'], ['До 2010', '', '2009-12-31']];

    function openList(title, query) {
        if (query.indexOf('vote_count.gte') < 0) query += '&vote_count.gte=5';
        Lampa.Activity.push({ url: BASE + query, title: title, component: 'category_full', source: 'tmdb', card_type: true, page: 1 });
    }

    function select(title, items, onSelect) {
        var ctrl = Lampa.Controller.enabled().name;
        Lampa.Select.show({
            title: title, items: items,
            onBack: function () { Lampa.Controller.toggle(ctrl); },
            onSelect: function (a) { Lampa.Controller.toggle(ctrl); onSelect(a); }
        });
    }

    function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

    function openTurk() {
        select(TURK.title, [
            { title: 'Популярные', act: 'pop' },
            { title: 'Новинки', subtitle: 'вышли за последний год', act: 'new' },
            { title: 'Лучшие по оценкам', act: 'top' },
            { title: 'По жанру…', act: 'genre' },
            { title: 'По годам…', act: 'year' },
            { title: 'Поиск по названию…', act: 'search' }
        ], function (a) {
            if (a.act === 'pop') openList(TURK.title, '&sort_by=popularity.desc');
            else if (a.act === 'new') {
                var y = new Date(); y.setFullYear(y.getFullYear() - 1);
                openList('Турецкие: новинки', '&sort_by=first_air_date.desc&first_air_date.gte=' + y.toISOString().slice(0, 10) + '&first_air_date.lte=' + today());
            }
            else if (a.act === 'top') openList('Турецкие: лучшие', '&sort_by=vote_average.desc&vote_count.gte=50');
            else if (a.act === 'genre') select('Жанр', GENRES.map(function (g) { return { title: g[1], id: g[0] }; }), function (g) {
                openList('Турецкие: ' + g.title.toLowerCase(), '&sort_by=popularity.desc&with_genres=' + g.id);
            });
            else if (a.act === 'year') select('Годы', YEARS.map(function (y) { return { title: y[0], from: y[1], to: y[2] }; }), function (y) {
                openList('Турецкие: ' + y.title.toLowerCase(), '&sort_by=popularity.desc' + (y.from ? '&first_air_date.gte=' + y.from : '') + (y.to ? '&first_air_date.lte=' + y.to : ''));
            });
            else if (a.act === 'search') search();
        });
    }

    function tmdb(path, ok, fail) {
        var url = Lampa.TMDB.api(path + (path.indexOf('?') < 0 ? '?' : '&') + 'api_key=' + Lampa.TMDB.key() + '&language=ru');
        var net = new Lampa.Reguest();
        net.timeout(15000);
        net.silent(url, ok, fail);
    }

    // названия из TMDB — чужой текст, а шаблоны Lampa (Select, Noty) вставляют его как HTML
    function esc(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    function isTurkish(r) {
        return r && (r.original_language === 'tr' || (r.origin_country || []).indexOf('TR') >= 0);
    }

    /** Поиск только среди турецких сериалов: выдача TMDB по названию (2 страницы), из неё — турецкие. */
    function search() {
        Lampa.Input.edit({ title: 'Название турецкого сериала', value: '', free: true, nosave: true }, function (q) {
            q = String(q || '').replace(/^\s+|\s+$/g, '');
            if (!q) return;
            var found = [], seen = {}, left = 2;
            var done = function () {
                if (--left > 0) return;
                if (!found.length) return Lampa.Noty.show('Турецких сериалов «' + esc(q) + '» не нашлось');
                select('Найдено: ' + found.length, found.map(function (r) {
                    var y = (r.first_air_date || '').slice(0, 4);
                    return { title: esc(r.name || r.original_name) + (y ? ' (' + y + ')' : ''), subtitle: (r.original_name && r.original_name !== r.name ? esc(r.original_name) + ' · ' : '') + (r.vote_average ? '★ ' + (+r.vote_average).toFixed(1) : ''), card: r };
                }), function (a) {
                    Lampa.Activity.push({ url: '', component: 'full', id: a.card.id, method: 'tv', card: a.card, source: 'tmdb' });
                });
            };
            [1, 2].forEach(function (page) {
                tmdb('search/tv?query=' + encodeURIComponent(q) + '&page=' + page, function (j) {
                    ((j && j.results) || []).forEach(function (r) { if (isTurkish(r) && !seen[r.id]) { seen[r.id] = 1; found.push(r); } });
                    done();
                }, done);
            });
        });
    }

    function addButton() {
        if (!enabled() || $('.menu [data-action="' + TURK.action + '"]').length) return;
        var el = Lampa.Menu.addButton(ICON, TURK.title, openTurk);
        el.attr('data-action', TURK.action);
        var tv = $('.menu .menu__list:eq(0) [data-action="tv"]');   // «Сериалы»
        if (tv.length) el.insertAfter(tv);
    }

    function removeButton() { $('.menu [data-action="' + TURK.action + '"]').remove(); }

    /* «Хочу посмотреть» — встроенная закладка Lampa «Позже» (wath) отдельным пунктом меню: туда добавляет и бот Telegram.
     * Если такой пункт в меню уже есть (своя сборка, плагин) — второй не ставим. */
    var WANT = { action: 'bs_want', title: 'Хочу посмотреть' };
    var WANT_ICON = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
    function addWantButton() {
        if ($('.menu [data-action="' + WANT.action + '"]').length) return;
        var has = false;
        $('.menu .menu__item').each(function () { if (/хочу посмотреть|^позже$/i.test($.trim($(this).text()))) has = true; });
        if (has) return;
        var el = Lampa.Menu.addButton(WANT_ICON, WANT.title, function () {
            Lampa.Activity.push({ url: '', title: WANT.title, component: 'favorite', type: 'wath', page: 1 });
        });
        el.attr('data-action', WANT.action);
    }

    /* Две кнопки на карточке: «Смотреть» — сразу главный источник (Skaz или выбранный в «Онлайн-источниках», bssources.js),
     * «Источники» — родное меню Lampa со всеми источниками, трейлерами и Shots.
     *
     * Кнопка «Онлайн» на карточке фильма. В Lampa «Смотреть» открывает меню источников (Shots / Онлайн / Трейлеры) —
     * лишнее нажатие каждый раз. Lampa умеет выносить источник отдельной кнопкой (долгое ОК в этом меню →
     * full_btn_priority), но об этом мало кто знает. Если человек свою кнопку не выбрал — выносим «Онлайн by Skaz»
     * сами и ставим на неё фокус: карточка → ОК → источники. Своя кнопка (долгое ОК) заменяет нашу — это делает Lampa. */
    function watchEnabled() { return lsGet('bs_watch_btn') !== 'false'; }
    // без bssources.js (старый пакет с новым модулем): прежнее правило; с ним — BSSources.pick (у Z01 и arkmv тот же класс)
    function isSkazButton(btn) {
        var sub = String(btn.data('subtitle') || ''), text = $.trim(btn.text());
        // Shots тоже ставит класс view--online — узнаём Skaz по его классу и подписи «by Skaz»
        return btn.hasClass('lampac--button') || /skaz/i.test(sub) || /^(Онлайн|Online)$/i.test(text);
    }
    function addWatchButton(e, tries) {
        try {
            var body = e.body, cont = body.find('.full-start-new__buttons');
            if (!cont.length || cont.find('.button--priority').length || !body.closest('body').length) return;
            // Своя кнопка человека (full_btn_priority) уже стоит — .button--priority выше. Сам ключ бывает «мёртвым»
            // (hash кнопки, которой больше нет) — тогда Lampa ничего не выносит, а мы выносим.
            var src = null, btns = [];
            body.find('.buttons--container > .full-start__button').not('.hide').each(function () { btns.push($(this)); });
            // главный источник; не загрузился (последняя попытка) — Skaz
            if (window.BSSources) src = BSSources.pick(btns, tries >= 8);
            else for (var i = 0; i < btns.length && !src; i++) if (isSkazButton(btns[i])) src = btns[i];
            if (!src) { if (tries < 8) setTimeout(function () { addWatchButton(e, tries + 1); }, 250); return; }  // плагин ещё не добавил
            var play = cont.find('.button--play'), hadFocus = play.hasClass('focus');
            var clon = src.clone().removeClass('focus hide view--torrent').addClass('selector button--priority bs-watch');
            // подпись — «Смотреть» (у плагина «Онлайн»); родное «Смотреть» Lampa (меню источников) остаётся второй кнопкой
            var label = clon.find('span').first();
            if (label.length) label.text('Смотреть');
            else clon.contents().filter(function () { return this.nodeType === 3 && $.trim(this.nodeValue); }).first().replaceWith('Смотреть');
            var playLabel = play.find('span').first();
            if (playLabel.length) playLabel.text('Источники');
            play.removeClass('hide');
            clon.on('hover:enter', function () { src.trigger('hover:enter'); })
                .on('hover:focus', function () { try { e.link.items[0].last = clon[0]; } catch (err) {} });
            cont.prepend(clon);
            // Фокус на новую кнопку, если он стоял на «Смотреть» (карточка только открылась)
            if (hadFocus || !cont.find('.focus').length) {
                try { e.link.items[0].last = clon[0]; } catch (err) {}
                var start = cont.closest('.full-start-new');
                Lampa.Controller.collectionSet(start.length ? start : body);
                Lampa.Controller.collectionFocus(clon[0], start.length ? start : body);
            }
        } catch (err) { console.log('BS watch', err); }
    }

    function addSettings() {
        if (!Lampa.SettingsApi) return;
        Lampa.SettingsApi.addParam({
            component: 'bs_update',
            param: { name: 'bs_watch_btn', type: 'trigger', 'default': true },
            field: { name: 'Кнопка «Смотреть» на карточке', description: 'Источники открываются одним нажатием.' },
            onChange: function (v) { lsSet('bs_watch_btn', String(v === true || v === 'true')); }
        });
        Lampa.SettingsApi.addParam({
            component: 'bs_update',
            param: { name: 'bs_menu_turk', type: 'trigger', 'default': true },
            field: { name: 'Кнопка «Турецкие сериалы» в меню', description: 'Пункт в левом меню.' },
            onChange: function (v) {
                var on = v === true || v === 'true';
                lsSet('bs_menu_turk', String(on));
                if (on) addButton(); else removeButton();
            }
        });
    }

    function start() {
        try { addSettings(); } catch (e) {}
        try { addButton(); } catch (e) { console.log('BS menu', e); }
        try { addWantButton(); } catch (e) { console.log('BS want', e); }
        try {
            Lampa.Listener.follow('full', function (e) {
                // после 'complite' Lampa сама группирует кнопки и ставит фокус — встаём следом
                if (e && e.type === 'complite' && e.body && watchEnabled()) setTimeout(function () { addWatchButton(e, 0); }, 0);
            });
        } catch (e) { console.log('BS watch', e); }
    }

    return { start: start, open: openTurk, search: search, TURK: TURK, _isTurkish: isTurkish, _esc: esc };
})();
