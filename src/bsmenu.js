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
 *
 *  «Мультики» — по просьбе из группы t.me/sunicapps (lampa-samsung#3). Как «Турецкие»: короткое меню — мультсериалы
 *  или мультфильмы, возраст (до 6 / 7–12 / до 12 лет — рейтинги TV-Y, TV-Y7 и G, PG; оба выбора запоминаются),
 *  популярные, новинки, лучшие, по теме (обучающие, природа, наука, исторические, сказки…), по годам, российские
 *  и турецкие, поиск по названию. Всегда без ужасов, криминала, триллеров и войны (у сериалов ещё без драм, реалити,
 *  ток-шоу и новостей). Пункт по умолчанию выключен — включается в «Настройки → Sunic Apps → Интерфейс»; стоит
 *  после «Турецких сериалов» (или «Сериалов»).
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
        searchIn('Название турецкого сериала', 'Турецких сериалов', isTurkish);
    }

    function searchIn(prompt, none, keep, type) {
        type = type || 'tv';
        Lampa.Input.edit({ title: prompt, value: '', free: true, nosave: true }, function (q) {
            q = String(q || '').replace(/^\s+|\s+$/g, '');
            if (!q) return;
            var found = [], seen = {}, left = 2;
            var done = function () {
                if (--left > 0) return;
                if (!found.length) return Lampa.Noty.show(none + ' «' + esc(q) + '» не нашлось');
                select('Найдено: ' + found.length, found.map(function (r) {
                    var y = (r.first_air_date || r.release_date || '').slice(0, 4), name = r.name || r.title, orig = r.original_name || r.original_title;
                    return { title: esc(name || orig) + (y ? ' (' + y + ')' : ''), subtitle: (orig && orig !== name ? esc(orig) + ' · ' : '') + (r.vote_average ? '★ ' + (+r.vote_average).toFixed(1) : ''), card: r };
                }), function (a) {
                    Lampa.Activity.push({ url: '', component: 'full', id: a.card.id, method: type, card: a.card, source: 'tmdb' });
                });
            };
            [1, 2].forEach(function (page) {
                tmdb('search/' + type + '?query=' + encodeURIComponent(q) + '&page=' + page, function (j) {
                    ((j && j.results) || []).forEach(function (r) { if (keep(r) && !seen[r.id]) { seen[r.id] = 1; found.push(r); } });
                    done();
                }, done);
            });
        });
    }

    var KIDS = { action: 'bs_kids', title: 'Мультики' };
    // мишка
    var KIDS_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">' +
        '<circle cx="5.5" cy="5.5" r="3"/><circle cx="18.5" cy="5.5" r="3"/>' +
        '<path d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm-3 6.5a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4zm6 0a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4zM12 14c1.4 0 2.5.8 2.5 1.6S13.4 17.5 12 17.5s-2.5-1.1-2.5-1.9S10.6 14 12 14z"/></svg>';
    function kidsEnabled() { return lsGet('bs_menu_kids') === 'true'; }
    var KIDS_TYPES = [['tv', 'Мультсериалы'], ['movie', 'Мультфильмы']];
    function kidsType() { return lsGet('bs_kids_type') === 'movie' ? 'movie' : 'tv'; }
    // возраст — американские рейтинги (у TMDB они есть у большинства мультиков): сериалы TV-Y «2–6 лет», TV-Y7 «7+»;
    // фильмы G «для всех», PG «детям — с родителями»
    var KIDS_AGES = [['до 6 лет', 'TV-Y', 'G'], ['7–12 лет', 'TV-Y7', 'PG'], ['до 12 лет', 'TV-Y%7CTV-Y7', 'G%7CPG']];
    function kidsAge() { var i = +lsGet('bs_kids_age'); return KIDS_AGES[i] ? i : 0; }
    // темы: g — жанры TMDB (вместе с «Мультфильмом»), k — ключевые слова (%7C — «любое из»); age: false — таких мало
    // и рейтинг у них редко указан: без возраста, для сериалов — жанр «Детский»
    var KW_HIST = '282633%7C15126%7C12995%7C15012%7C189119';
    var KIDS_THEMES = [
        { t: 'Обучающие', s: 'буквы, счёт, мир вокруг', k: '18257%7C206919%7C6009', movie: { g: [10751], k: '18257%7C206919%7C6009', age: false } },
        { t: 'Природа и животные', k: '18330%7C18165' },
        { t: 'Наука и динозавры', k: '287067%7C12616' },
        { t: 'Исторические', tv: { g: [10762], k: KW_HIST, age: false }, movie: { g: [36] } },
        { t: 'Сказки', k: '3205', tv: { g: [10762], k: '3205', age: false } },
        { t: 'Музыкальные', tv: { g: [10762], k: '283297', age: false }, movie: { g: [10402] } },
        { t: 'Приключения', tv: { g: [10759] }, movie: { g: [12] } },
        { t: 'Весёлые', s: 'комедии', g: [35] },
        { t: 'Семейные', g: [10751] }
    ];
    var KIDS_WITHOUT = { tv: '80,18,9648,10768,10764,10767,10763', movie: '27,80,53,10752' };

    /** Адрес каталога TMDB: мультики нужного типа; каждый параметр — один раз (повтор TMDB не прощает), взрослые
     *  жанры убраны всегда. o: g — жанры, k — ключевые слова, age — с возрастом (по умолчанию да), lang, q — остальное. */
    function kidsUrl(type, o) {
        var g = [16].concat(o.g || []), q = 'discover/' + type + '?with_genres=' + g.join(',') + '&without_genres=' + KIDS_WITHOUT[type];
        if (o.age !== false) q += '&certification_country=US&certification=' + KIDS_AGES[kidsAge()][type === 'tv' ? 1 : 2];
        if (o.k) q += '&with_keywords=' + o.k;
        if (o.lang) q += '&with_original_language=' + o.lang;
        return q + (o.q ? '&' + o.q : '');
    }
    function isKids(r) {
        var g = (r && r.genre_ids) || [], bad = [27, 80, 53, 10752];
        for (var i = 0; i < bad.length; i++) if (g.indexOf(bad[i]) >= 0) return false;
        if (g.indexOf(10762) >= 0) return true;
        return g.indexOf(16) >= 0 && (r.title !== undefined || g.indexOf(18) < 0);   // сериал-мультфильм с драмой — взрослый
    }

    function openKidsList(title, type, o) {
        Lampa.Activity.push({ url: kidsUrl(type, o), title: title, component: 'category_full', source: 'tmdb', card_type: true, page: 1 });
    }

    function openKids() {
        var type = kidsType(), tv = type === 'tv', age = KIDS_AGES[kidsAge()];
        var name = tv ? 'Мультсериалы' : 'Мультфильмы', T = name + ' (' + age[0] + ')';
        var date = tv ? 'first_air_date' : 'primary_release_date';
        select(KIDS.title, [
            { title: name, subtitle: 'нажмите — ' + (tv ? 'мультфильмы' : 'мультсериалы'), act: 'type' },
            { title: 'Возраст: ' + age[0], subtitle: 'нажмите, чтобы выбрать', act: 'age' },
            { title: 'Популярные', act: 'pop' },
            { title: 'Новинки', subtitle: 'вышли за последние 2 года', act: 'new' },
            { title: 'Лучшие по оценкам', act: 'top' },
            { title: 'По теме…', subtitle: 'обучающие, исторические, природа…', act: 'theme' },
            { title: 'По годам…', act: 'year' },
            { title: 'Российские', subtitle: tv ? 'Маша и Медведь, Смешарики, Фиксики…' : '', act: 'ru' },
            { title: 'Турецкие', act: 'tr' },
            { title: 'Поиск по названию…', act: 'search' }
        ], function (a) {
            if (a.act === 'type') { lsSet('bs_kids_type', tv ? 'movie' : 'tv'); openKids(); }
            else if (a.act === 'age') select('Возраст', KIDS_AGES.map(function (x, i) { return { title: x[0], selected: i === kidsAge(), i: i }; }), function (x) {
                lsSet('bs_kids_age', String(x.i)); openKids();
            });
            else if (a.act === 'pop') openKidsList(T + ': популярные', type, { q: 'sort_by=popularity.desc&vote_count.gte=' + (tv ? 5 : 20) });
            else if (a.act === 'new') {
                var y = new Date(); y.setFullYear(y.getFullYear() - 2);
                openKidsList(T + ': новинки', type, { q: 'sort_by=popularity.desc&' + date + '.gte=' + y.toISOString().slice(0, 10) + '&' + date + '.lte=' + today() });
            }
            else if (a.act === 'top') openKidsList(T + ': лучшие', type, { q: 'sort_by=vote_average.desc&vote_count.gte=' + (tv ? 30 : 200) });
            else if (a.act === 'theme') select('Тема', KIDS_THEMES.map(function (t) { return { title: t.t, subtitle: t.s || '', th: t }; }), function (x) {
                var t = x.th, o = t[type] || { g: t.g, k: t.k };
                openKidsList((o.age === false ? name : T) + ': ' + t.t.toLowerCase(), type, { g: o.g, k: o.k, age: o.age, q: 'sort_by=popularity.desc' });
            });
            else if (a.act === 'year') select('Годы', YEARS.map(function (y) { return { title: y[0], from: y[1], to: y[2] }; }), function (y) {
                openKidsList(T + ': ' + y.title.toLowerCase(), type, { q: 'sort_by=popularity.desc' + (y.from ? '&' + date + '.gte=' + y.from : '') + (y.to ? '&' + date + '.lte=' + y.to : '') });
            });
            // у российских и турецких рейтингов США нет: детские — по жанру («Детский» у сериалов, «Семейный» у фильмов)
            else if (a.act === 'ru' || a.act === 'tr') openKidsList(name + ': ' + (a.act === 'ru' ? 'российские' : 'турецкие'), type,
                { g: [tv ? 10762 : 10751], lang: a.act, age: false, q: 'sort_by=popularity.desc' });
            else if (a.act === 'search') searchIn(tv ? 'Название мультсериала' : 'Название мультфильма', tv ? 'Мультсериалов' : 'Мультфильмов', isKids, type);
        });
    }

    function addKidsButton() {
        if (!kidsEnabled() || $('.menu [data-action="' + KIDS.action + '"]').length) return;
        var el = Lampa.Menu.addButton(KIDS_ICON, KIDS.title, openKids);
        el.attr('data-action', KIDS.action);
        var after = $('.menu .menu__list:eq(0) [data-action="' + TURK.action + '"]');
        if (!after.length) after = $('.menu .menu__list:eq(0) [data-action="tv"]');
        if (after.length) el.insertAfter(after);
    }

    function removeKidsButton() { $('.menu [data-action="' + KIDS.action + '"]').remove(); }

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
        Lampa.SettingsApi.addParam({
            component: 'bs_update',
            param: { name: 'bs_menu_kids', type: 'trigger', 'default': false },
            field: { name: 'Кнопка «Мультики» в меню', description: 'Мультфильмы и мультсериалы: возраст (до 6, 7–12 лет), темы — обучающие, исторические, природа; по годам, поиск.' },
            onChange: function (v) {
                var on = v === true || v === 'true';
                lsSet('bs_menu_kids', String(on));
                if (on) addKidsButton(); else removeKidsButton();
            }
        });
    }

    function start() {
        try { addSettings(); } catch (e) {}
        try { addButton(); } catch (e) { console.log('BS menu', e); }
        try { addKidsButton(); } catch (e) { console.log('BS kids', e); }
        try { addWantButton(); } catch (e) { console.log('BS want', e); }
        try {
            Lampa.Listener.follow('full', function (e) {
                // после 'complite' Lampa сама группирует кнопки и ставит фокус — встаём следом
                if (e && e.type === 'complite' && e.body && watchEnabled()) setTimeout(function () { addWatchButton(e, 0); }, 0);
            });
        } catch (e) { console.log('BS watch', e); }
    }

    return { start: start, open: openTurk, search: search, TURK: TURK, KIDS: KIDS, openKids: openKids,
        _isTurkish: isTurkish, _esc: esc, _kidsUrl: kidsUrl, _kidsEnabled: kidsEnabled, _isKids: isKids, _kidsAge: kidsAge, _kidsType: kidsType };
})();
