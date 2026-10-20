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
 *  «Мультики» — по просьбе из группы t.me/sunicapps (lampa-samsung#3), устроено как детские разделы Иви, Okko и
 *  Netflix Kids: мультсериалы или мультфильмы; возраст — группа («все детские», «малыши до 6», «7–12»), а не
 *  рейтинг одной страны; темы-полки (обучающие, животные, машинки, принцессы, динозавры…); годы десятилетиями;
 *  советские, российские, турецкие; поиск. Каталог — свой источник «bskids»: несколько запросов TMDB сразу
 *  (рейтинги США и России, жанр «Детский», советские), без повторов, без непереведённого и без обложки.
 *  Всегда без ужасов, криминала, триллеров и войны (у сериалов ещё без драм, реалити, ток-шоу и новостей).
 *  Пункт по умолчанию выключен — «Настройки → Sunic Apps → Интерфейс»; стоит после «Турецких сериалов».
 *
 *  «Смотреть» без входа в CUB (источники Skaz тогда пишут «Нет доступа»): один раз — выбор «Войти в CUB» / «Смотреть
 *  без входа — Z01» / «Всё равно Skaz» (cubChoice).
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
        var ctrl = 'content';
        try { ctrl = Lampa.Controller.enabled().name; } catch (e) {}
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
    function kidsType() { return lsGet('bs_kids_type') === 'movie' ? 'movie' : 'tv'; }

    /* Возраст — как на детских сервисах (Иви, Okko, Netflix Kids): группа, а не рейтинг одной страны. Каталог группы —
     * объединение нескольких запросов TMDB (у одного мультика есть рейтинг США, у другого — российский, у третьего
     * только жанр «Детский»): по одному признаку теряется больше половины, а советских нет совсем.
     * Участник: g — жанры (вместе), cc/c — страна и рейтинг (%7C — «любой из»), lang — язык оригинала, to — вышел до,
     * vc — минимум оценок (отсекает безвестное). */
    var KIDS_BANDS = [
        { t: 'все детские', tv: [{ g: [16, 10762], vc: 3 }, { g: [16], cc: 'US', c: 'TV-Y%7CTV-Y7' }, { g: [16], cc: 'RU', c: '0%2B%7C6%2B' }],
            movie: [{ g: [16, 10751], vc: 10 }, { g: [16], cc: 'US', c: 'G%7CPG' }, { g: [16], cc: 'RU', c: '0%2B%7C6%2B' }, { g: [16], lang: 'ru', to: '1991-12-31' }] },
        { t: 'малыши до 6 лет', tv: [{ g: [16], cc: 'US', c: 'TV-Y' }, { g: [16], cc: 'RU', c: '0%2B' }, { g: [16, 10762], lang: 'ru' }],
            movie: [{ g: [16], cc: 'US', c: 'G' }, { g: [16], cc: 'RU', c: '0%2B' }, { g: [16], lang: 'ru', to: '1991-12-31' }] },
        { t: '7–12 лет', tv: [{ g: [16], cc: 'US', c: 'TV-Y7' }, { g: [16], cc: 'RU', c: '6%2B' }],
            movie: [{ g: [16], cc: 'US', c: 'PG' }, { g: [16], cc: 'RU', c: '6%2B' }] }
    ];
    function kidsBand() { var i = +lsGet('bs_kids_band'); return KIDS_BANDS[i] ? i : 0; }

    // темы — как полки детских сервисов; k — ключевые слова TMDB (любое из), g — добавочный жанр (у сериалов и фильмов свои)
    var KIDS_THEMES = [
        { t: 'Обучающие', s: 'буквы, счёт, наука', k: '18257%7C206919%7C6009%7C287067' },
        { t: 'Животные', k: '18165%7C267848%7C15162%7C977%7C18330' },
        { t: 'Машинки и транспорт', k: '310324%7C13008%7C293629' },
        { t: 'Принцессы и феи', k: '7376%7C2710%7C208705' },
        { t: 'Супергерои', k: '9715%7C191219' },
        { t: 'Динозавры', k: '12616' },
        { t: 'Космос и роботы', k: '252634%7C14544' },
        { t: 'Сказки', k: '3205%7C351899%7C179411' },
        { t: 'Новогодние', k: '207317%7C252123%7C5570', tv: false },   // у мультсериалов таких меток нет — только фильмы
        { t: 'Исторические', tv: false, movie: { g: 36 } },
        { t: 'Музыка и песни', tv: { k: '283297' }, movie: { g: 10402 } },
        { t: 'Приключения', tv: { g: 10759 }, movie: { g: 12 } },
        { t: 'Весёлые', s: 'комедии', g: 35 }
    ];
    var KIDS_DECADES = [['2020-е', '2020-01-01', ''], ['2010-е', '2010-01-01', '2019-12-31'], ['2000-е', '2000-01-01', '2009-12-31'],
        ['1990-е', '1990-01-01', '1999-12-31'], ['Классика: до 1990', '', '1989-12-31']];
    var KIDS_WITHOUT = { tv: '80,18,9648,10768,10764,10767,10763', movie: '27,80,53,10752' };

    /** Запросы TMDB для подборки: по одному на участника группы; o — g, k (тема), p — свои параметры (сортировка, даты,
     *  vote_count.gte — берётся больший), only — свой список участников вместо группы. Каждый параметр — один раз. */
    function kidsQueries(type, o) {
        var date = type === 'tv' ? 'first_air_date' : 'primary_release_date';
        var list = o.only || KIDS_BANDS[kidsBand()][type];
        return list.map(function (m) {
            var p = { with_genres: m.g.slice(), without_genres: KIDS_WITHOUT[type] }, k;
            if (o.g && p.with_genres.indexOf(o.g) < 0) p.with_genres.push(o.g);
            p.with_genres = p.with_genres.join(',');
            if (m.cc) { p.certification_country = m.cc; p.certification = m.c; }
            if (m.lang) p.with_original_language = m.lang;
            if (m.to) p[date + '.lte'] = m.to;
            if (m.vc) p['vote_count.gte'] = m.vc;
            if (o.k) p.with_keywords = o.k;
            for (k in o.p || {}) {
                var v = o.p[k].replace('{date}', date);
                k = k.replace('{date}', date);
                if (k === 'vote_count.gte' && p[k] > +v) continue;
                if (v === '') delete p[k]; else p[k] = v;
            }
            var q = [];
            for (k in p) q.push(k + '=' + p[k]);
            return 'discover/' + type + '?' + q.join('&');
        });
    }

    // не детское, хоть и с детским рейтингом или жанром: «Царь горы» (RU 0+), «Фитиль» (сатирический киножурнал)
    var KIDS_BLOCK = { 2122: 1, 16656: 1 };
    // без перевода (ни описания, ни русского названия) и без обложки — в Lampa такое не посмотреть, только засоряет;
    // raw — перевод не нужен (турецкие: русского у них почти нет)
    function kidsJunk(r, raw) {
        var n = r.name || r.title, o = r.original_name || r.original_title;
        return KIDS_BLOCK[r.id] || !r.poster_path || (!raw && !r.overview && n === o && r.original_language !== 'ru');
    }
    /** Объединить ответы участников: без повторов (seen — по всем страницам), без мусора, сначала популярные. */
    function kidsMerge(answers, seen, raw) {
        var out = [];
        answers.forEach(function (j) {
            ((j && j.results) || []).forEach(function (r) {
                if (!r || seen[r.id] || kidsJunk(r, raw)) return;
                seen[r.id] = 1;
                r.source = 'tmdb';   // карточка открывается обычным TMDB
                out.push(r);
            });
        });
        out.sort(function (a, b) { return (b.popularity || 0) - (a.popularity || 0); });
        return out;
    }

    /* Источник «bskids» для штатного каталога Lampa (category_full): страница = страницы всех запросов подборки,
     * склеенные. Всё остальное (карточка, персоны) — как у TMDB. */
    function kidsList(params, oncomplite, onerror) {
        // запросы — и в адресе (url «bskids:…»): Lampa восстанавливает экран после перезапуска только по нему
        var qs = params.bs_q || (String(params.url || '').indexOf('bskids:') === 0 ? params.url.slice(7).split('||') : []), tries = 0;
        if (!params.bs_seen) try { Object.defineProperty(params, 'bs_seen', { value: {}, enumerable: false, writable: true }); } catch (e) { params.bs_seen = {}; }
        function load() {
            var page = params.page || 1, answers = [], left = qs.length, tp = 1, total = 0, ok = 0;
            if (!left) return onerror && onerror();
            qs.forEach(function (q, i) {
                tmdb(q + '&page=' + page, function (j) {
                    answers[i] = j; ok++;
                    tp = Math.max(tp, Math.min((j && j.total_pages) || 1, 500));
                    total += (j && j.total_results) || 0;
                    if (--left === 0) done();
                }, function () { if (--left === 0) done(); });
            });
            function done() {
                if (!ok) return onerror && onerror();
                var res = kidsMerge(answers, params.bs_seen, params.bs_raw);
                // вся страница — повторы и мусор: берём следующую (иначе каталог решит, что пусто)
                if (!res.length && page < tp && ++tries < 4) { params.page = page + 1; return load(); }
                // для выбранного возраста ничего — показываем «все детские» (лучше, чем пустой экран)
                if (!res.length && params.bs_fb && (params.page || 1) <= 4) {
                    qs = params.bs_q = params.bs_fb; params.bs_fb = null; params.page = 1; tries = 0;
                    try { Lampa.Noty.show('Для этого возраста мало — показаны все детские'); } catch (e) {}
                    return load();
                }
                oncomplite({ results: res, page: page, total_pages: tp, total_results: total });
            }
        }
        load();
    }
    function kidsSource() {
        var src = {}, tm = Lampa.Api.sources.tmdb, k;
        for (k in tm) src[k] = tm[k];
        src.list = kidsList;
        return src;
    }
    function registerKidsSource() {
        if (Lampa.Api && Lampa.Api.sources && Lampa.Api.sources.tmdb && !Lampa.Api.sources.bskids) Lampa.Api.sources.bskids = kidsSource();
    }

    function openKidsList(title, type, o) {
        registerKidsSource();
        var fb = null;
        if (!o.only && kidsBand()) { o.only = KIDS_BANDS[0][type]; fb = kidsQueries(type, o); o.only = null; }
        var qs = kidsQueries(type, o);
        Lampa.Activity.push({ url: 'bskids:' + qs.join('||'), title: title, component: 'category_full', source: 'bskids', card_type: true, page: 1,
            bs_q: qs, bs_fb: fb, bs_raw: !!o.raw });
    }

    function isKids(r) {
        var g = (r && r.genre_ids) || [], bad = [27, 80, 53, 10752];
        for (var i = 0; i < bad.length; i++) if (g.indexOf(bad[i]) >= 0) return false;
        if (g.indexOf(10762) >= 0) return true;
        return g.indexOf(16) >= 0 && (r.title !== undefined || g.indexOf(18) < 0);   // сериал-мультфильм с драмой — взрослый
    }

    function openKids() {
        var type = kidsType(), tv = type === 'tv', band = kidsBand(), bandName = KIDS_BANDS[band].t;
        var name = tv ? 'Мультсериалы' : 'Мультфильмы', T = band ? name + ' (' + bandName + ')' : name;
        var POP = { sort_by: 'popularity.desc' };
        select(KIDS.title, [
            { title: name, subtitle: 'нажмите — ' + (tv ? 'мультфильмы' : 'мультсериалы'), act: 'type' },
            { title: 'Возраст: ' + bandName, subtitle: 'нажмите, чтобы выбрать', act: 'age' },
            { title: 'Популярные', act: 'pop' },
            { title: 'Новинки', subtitle: 'вышли за последние 2 года', act: 'new' },
            { title: 'Лучшие по оценкам', act: 'top' },
            { title: 'По теме…', subtitle: 'обучающие, животные, машинки, принцессы…', act: 'theme' },
            { title: 'По годам…', subtitle: '2020-е, 2010-е… классика', act: 'year' },
            { title: 'Советские', subtitle: 'Винни-Пух, Ну, погоди!, Простоквашино…', act: 'su' },
            { title: 'Российские', subtitle: tv ? 'Маша и Медведь, Смешарики, Фиксики…' : 'Три богатыря, Снежная королева…', act: 'ru' },
            { title: 'Турецкие', act: 'tr' },
            { title: 'Поиск по названию…', act: 'search' }
        ], function (a) {
            var y;
            if (a.act === 'type') { lsSet('bs_kids_type', tv ? 'movie' : 'tv'); openKids(); }
            else if (a.act === 'age') select('Возраст', KIDS_BANDS.map(function (x, i) { return { title: x.t, selected: i === band, i: i }; }), function (x) {
                lsSet('bs_kids_band', String(x.i)); openKids();
            });
            else if (a.act === 'pop') openKidsList(T + ': популярные', type, { p: POP });
            else if (a.act === 'new') {
                y = new Date(); y.setFullYear(y.getFullYear() - 2);
                openKidsList(T + ': новинки', type, { p: { sort_by: 'popularity.desc', '{date}.gte': y.toISOString().slice(0, 10), '{date}.lte': today() } });
            }
            else if (a.act === 'top') openKidsList(T + ': лучшие', type, { p: { sort_by: 'vote_average.desc', 'vote_count.gte': tv ? '30' : '150' } });
            else if (a.act === 'theme') select('Тема', KIDS_THEMES.filter(function (t) { return t[type] !== false; }).map(function (t) { return { title: t.t, subtitle: t.s || '', th: t }; }), function (x) {
                var t = x.th, o = t[type] || t;
                openKidsList(T + ': ' + t.t.toLowerCase(), type, { g: o.g, k: o.k, p: POP });
            });
            else if (a.act === 'year') select('Годы', KIDS_DECADES.map(function (d) { return { title: d[0], from: d[1], to: d[2] }; }), function (d) {
                // «до 1991» у советских участников заменяется границами десятилетия
                openKidsList(T + ': ' + d.title.toLowerCase(), type, { p: { sort_by: 'popularity.desc', '{date}.gte': d.from, '{date}.lte': d.to } });
            });
            // советские: самые оцениваемые первыми — так наверху «Ёжик в тумане» и «Винни-Пух», а не безвестное
            else if (a.act === 'su') openKidsList(name + ': советские', type, { only: [{ g: [16], lang: 'ru', to: '1991-12-31' }], p: { sort_by: 'vote_count.desc' } });
            // у российских и турецких рейтингов США нет: детские — по жанру («Детский» у сериалов, «Семейный» у фильмов)
            else if (a.act === 'ru') openKidsList(name + ': российские', type, { only: [{ g: [16, tv ? 10762 : 10751], lang: 'ru' }], p: { sort_by: 'popularity.desc', '{date}.gte': '1992-01-01' } });
            else if (a.act === 'tr') openKidsList(name + ': турецкие', type, { only: [{ g: [16, tv ? 10762 : 10751], lang: 'tr' }], p: POP, raw: true });
            else if (a.act === 'search') searchIn(tv ? 'Название мультсериала' : 'Название мультфильма', tv ? 'Мультсериалов' : 'Мультфильмов', isKids, type);
        });
    }

    /** Порядок меню Lampa (menu_sort, «Редактировать»): нового пункта там нет — Lampa допишет его в конец и при
     *  каждом запуске поставит последним. Вписываем сами после первого найденного из after. */
    function menuSortPlace(sort, title, after) {
        if (!sort || !sort.length || sort.indexOf(title) >= 0) return sort;
        sort = sort.slice();
        for (var i = 0; i < after.length; i++) {
            var at = sort.indexOf(after[i]);
            if (at >= 0) { sort.splice(at + 1, 0, title); return sort; }
        }
        sort.push(title);
        return sort;
    }

    function addKidsButton() {
        if (!kidsEnabled() || $('.menu [data-action="' + KIDS.action + '"]').length) return;
        try {
            var sort = Lampa.Storage.get('menu_sort', '[]'), placed = menuSortPlace(sort, KIDS.title, [TURK.title, 'Сериалы']);
            if (placed !== sort) Lampa.Storage.set('menu_sort', placed);
        } catch (e) {}
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
    /* Skaz без входа в CUB показывает «Нет доступа» — человек не понимает, нужно ли ему это. Первое «Смотреть» без CUB
     * (главный источник — Skaz): выбор — войти в CUB, смотреть без входа через Z01 (бесплатный, с рекламой) или всё
     * равно открыть Skaz. Спрашиваем один раз (bs_cub_choice); поменять потом — «Онлайн-источники». */
    function cubLogged() {
        try { var P = Lampa.Account && Lampa.Account.Permit; if (P && 'access' in P) return !!P.access; } catch (e) {}
        try { return !!Lampa.Storage.get('account_email', ''); } catch (e) { return true; }
    }
    function cardId() { try { var a = Lampa.Activity.active(); return (a.card || a.movie || {}).id || 0; } catch (e) { return 0; } }
    function needCubChoice() {
        return lsGet('bs_cub_choice') !== 'done' && !cubLogged() && (!window.BSSources || BSSources.mainId() === 'skaz');
    }
    function cubChoice(open) {
        var ctrl = '';
        try { ctrl = Lampa.Controller.enabled().name; } catch (e) {}
        var back = function () { try { if (ctrl) Lampa.Controller.toggle(ctrl); } catch (e) {} };
        var items = [{ title: 'Войти в CUB', subtitle: 'Бесплатно: код на cub.red — и источники Skaz заработают', id: 'login' }];
        if (window.BSSources && BSSources.useMain) items.push({ title: 'Смотреть без входа — источник Z01', subtitle: 'Бесплатные источники, есть реклама. Поменять: Sunic Apps → Онлайн-источники', id: 'z01' });
        items.push({ title: 'Всё равно открыть Skaz', id: 'skaz' });
        Lampa.Select.show({
            title: 'Источникам Skaz нужен вход в CUB',
            items: items,
            onSelect: function (a) {
                lsSet('bs_cub_choice', 'done');
                back();
                if (a.id === 'login') {
                    try { Lampa.Settings.create('account'); } catch (e) { Lampa.Noty.show('Вход в CUB: Настройки → Аккаунт', { time: 6000 }); }
                } else if (a.id === 'z01') {
                    Lampa.Noty.show('Подключаю Z01…', { time: 3000 });
                    BSSources.useMain('z01', function () {
                        // карточку — заново: кнопка Z01 появится, «Смотреть» откроет его
                        setTimeout(function () { try { Lampa.Activity.replace(); } catch (e) {} }, 300);
                    });
                } else open();
            },
            onBack: back
        });
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
            clon.on('hover:enter', function () {
                var go = function () {
                    // поиск по всем источникам: этот не нашёл — следующий (bssources.js giveUp)
                    try { if (window.BSSources && BSSources.startSearch) BSSources.startSearch(((e.data || {}).movie || {}).id || cardId(), BSSources.owner(src)); } catch (err) {}
                    src.trigger('hover:enter');
                };
                if (needCubChoice()) return cubChoice(go);
                go();
            })
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
            field: { name: 'Кнопка «Смотреть» на карточке', description: 'Источники — одним нажатием' },
            onChange: function (v) { lsSet('bs_watch_btn', String(v === true || v === 'true')); }
        });
        Lampa.SettingsApi.addParam({
            component: 'bs_update',
            param: { name: 'bs_menu_turk', type: 'trigger', 'default': true },
            field: { name: 'Кнопка «Турецкие сериалы» в меню', description: 'В левом меню' },
            onChange: function (v) {
                var on = v === true || v === 'true';
                lsSet('bs_menu_turk', String(on));
                if (on) addButton(); else removeButton();
            }
        });
        Lampa.SettingsApi.addParam({
            component: 'bs_update',
            param: { name: 'bs_menu_kids', type: 'trigger', 'default': false },
            field: { name: 'Кнопка «Мультики» в меню', description: 'В левом меню' },
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
        try { registerKidsSource(); addKidsButton(); } catch (e) { console.log('BS kids', e); }
        try { addWantButton(); } catch (e) { console.log('BS want', e); }
        try {
            Lampa.Listener.follow('full', function (e) {
                // после 'complite' Lampa сама группирует кнопки и ставит фокус — встаём следом
                if (e && e.type === 'complite' && e.body && watchEnabled()) setTimeout(function () { addWatchButton(e, 0); }, 0);
            });
        } catch (e) { console.log('BS watch', e); }
    }

    return { start: start, open: openTurk, search: search, TURK: TURK, KIDS: KIDS, openKids: openKids,
        _isTurkish: isTurkish, _esc: esc, _kidsEnabled: kidsEnabled, _isKids: isKids, _kidsBand: kidsBand, _kidsType: kidsType,
        _kidsQueries: kidsQueries, _kidsMerge: kidsMerge, _kidsJunk: kidsJunk, _menuSortPlace: menuSortPlace,
        _needCubChoice: needCubChoice, _cubChoice: cubChoice };
})();
