/*
 * Дополнительные функции для телевизора.
 *
 *  1. Быстрый старт (bs_fast_start, вкл.): на плеере Tizen поток .m3u8 сразу уходит в AVPlay.
 *     Без этого Lampa сначала сама качает плейлист запросом страницы (с Origin: null) —
 *     CDN часто отказывает или молчит, и старт затягивается до 10 с таймаута.
 *     Цена: список качеств из плейлиста не строится, звуковые дорожки AVPlay отдаёт сам.
 *  2. Пропуск рекламы (bs_noads, выкл.): Lampa считает сборку личной и рекламу не запускает
 *     (штатная метка personal1.lampa). Реклама — часть сервиса byskaz, поэтому по умолчанию
 *     выключено. Применяется после перезапуска Lampa.
 *  3. Таймер сна (bs_sleep, кнопка «Сон» в плеере): через 30/60/90 минут или после текущей серии/фильма —
 *     пауза, и если за минуту не нажать кнопку, приложение закрывается.
 *  4. Цветные кнопки пульта в плеере: красная — другой источник (закрыть плеер),
 *     зелёная — качество, жёлтая — озвучка, синяя — субтитры.
 */
var BSFeatures = (function () {
    function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
    function on(k, def) { var v = lsGet(k); return v === null ? def : v === 'true'; }
    function noty(t, time) { try { Lampa.Noty.show(t, { time: time || 5000 }); } catch (e) {} }
    function playerOpen() { try { return !!Lampa.Player.opened(); } catch (e) { return false; } }
    /** Устройство — bsdevice.js (нет модуля — «нет»). */
    function dev(f) { try { return !!window.BSDevice[f](); } catch (e) { return false; } }

    /* ---------- 2. Пропуск рекламы и свежие плагины: ставится сразу, до запуска Lampa ----------
     * Реклама. Lampa не показывает рекламу личным сборкам: при старте она запрашивает рядом с
     * собой файл-метку ./personal1.lampa (Personal.confirm) — метка влияет только на рекламу.
     * Метка лежит в пакете; пока «Пропускать рекламу» выключено, мы прячем её от Lampa, и
     * реклама идёт как обычно. Блокировать рекламные запросы по сети нельзя: рекламная
     * библиотека тогда ждёт свой таймаут, и старт фильма затягивается (замер: 24 с против 4,5 с).
     *
     * Плагины byskaz/Skaz: у них есть Last-Modified, но нет Cache-Control, и телевизор вправе
     * держать старую копию ~10% её «возраста» (файл, не менявшийся полгода, — недели две).
     * Добавляем метку дня — обновлённый плагин приходит не позже чем через сутки (меняется в 05:00 по Ташкенту, ночью).
     * С меткой часа (1.4.5) ТВ каждый час заново качал все ~13 плагинов по одному. «Проверить и обновить» в настройках
     * меняет метку сразу (bs_plugins_salt) — свежие плагины без ожидания. */

    var FRESH_HOSTS = /^https?:\/\/([a-z0-9-]+\.)*(byskaz\.ru|skaz\.tv|skaz\.team|skaztv\.online|skaztv\.top)\//i;
    /** Адрес плагина byskaz/Skaz с меткой дня или '' (не наш хост / метка уже есть / сама Lampa). */
    function freshUrl(url) {
        url = String(url || '');
        if (!FRESH_HOSTS.test(url) || /[?&]_bs=/.test(url) || /\/app\.min\.js/.test(url)) return '';
        var salt = lsGet('bs_plugins_salt'), hash = '', h = url.indexOf('#');
        if (h >= 0) { hash = url.slice(h); url = url.slice(0, h); }
        return url + (url.indexOf('?') < 0 ? '?' : '&') + '_bs=' + Math.floor(Date.now() / 86400000) + (salt ? '-' + salt : '') + hash;
    }

    /* Видеобиблиотеки. На file:// Lampa берёт hls/dash/qrcode с сервера (~0,5 МБ на каждом старте), хотя они
     * лежат в пакете побайтно такими же (проверено md5). Берём из пакета — но только когда и сама Lampa из пакета
     * (bsSource 'local'/'bundled'): с новой сборкой с сервера могут прийти и новые библиотеки. */
    function localVender(url) {
        var m = /^https?:\/\/lampa\.byskaz\.ru\/lampa-main\/vender\/((hls|dash|qrcode)\/[a-z]+\.js)/.exec(String(url || ''));
        if (!m) return '';
        var src = typeof bsSource !== 'undefined' ? bsSource : '';
        return src === 'local' || src === 'bundled' ? 'vender/' + m[1] : '';
    }

    (function installNetHooks() {
        var XO = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (m, u) {
            if (/personal1\.lampa(\?|#|$)/.test(String(u)) && !on('bs_noads', false)) {
                arguments[1] = String(u).replace('personal1.lampa', 'bs-ads-on.lampa');   // такого файла нет — реклама включена
            }
            return XO.apply(this, arguments);
        };
        var AC = Node.prototype.appendChild;
        Node.prototype.appendChild = function (n) {
            if (n && n.tagName === 'SCRIPT' && n.src) {
                var local = localVender(n.getAttribute('src'));
                if (local) n.setAttribute('src', local);
                var bust = freshUrl(n.getAttribute('src'));
                if (bust) n.setAttribute('src', bust);
            }
            return AC.apply(this, arguments);
        };
    })();

    /* ---------- 1. Быстрый старт ---------- */

    function installFastStart() {
        var PV = Lampa.PlayerVideo, orig = PV.url;
        if (!orig || orig.__bs) return;
        var fast = function (src, change_quality) {
            if (on('bs_fast_start', true) && dev('tvPlayer') && /\.m3u8/i.test(String(src)) && !change_quality) {
                // url() решает «качать плейлист самим» по typeof Hls — на время вызова прячем hls.js,
                // и поток уходит прямо в AVPlay (тот же путь, что при смене качества).
                var H = window.Hls;
                try { window.Hls = undefined; return orig.apply(this, arguments); }
                finally { window.Hls = H; }
            }
            return orig.apply(this, arguments);
        };
        fast.__bs = true;
        PV.url = fast;
    }

    /* ---------- 3. Таймер сна ---------- */

    var sleepAt = 0, sleepTimer = null, sleepEpisode = false, exitTimer = null;

    function sleepCancel() {
        sleepAt = 0; sleepEpisode = false;
        clearInterval(sleepTimer); sleepTimer = null;
        clearTimeout(exitTimer); exitTimer = null;
    }

    function sleepSet(mode) {
        sleepCancel();
        sleepButton();
        if (mode === 'episode') { sleepEpisode = true; sleepButton(); noty('Сон: ' + sleepLabel() + ' — ' + sleepWhat()); sleepHint(); return; }
        var min = parseInt(mode, 10);
        if (!min) { noty('Сон выключен'); return; }
        sleepAt = Date.now() + min * 60000;
        sleepTimer = setInterval(function () {
            var left = sleepAt - Date.now();
            if (left <= 60000 && left > 59000) noty('Сон через 1 минуту');
            if (left <= 0) { clearInterval(sleepTimer); sleepTimer = null; sleepFire(); }
            else if (left % 60000 < 1000) sleepButton();
        }, 1000);
        sleepButton();
        noty('Сон: через ' + min + ' мин — ' + sleepWhat());
        sleepHint();
    }

    /* Выключить сам ТВ приложение не может: remotepower — только с партнёрским сертификатом Samsung, сетевой пульт ТВ
     * слушает лишь другие устройства (проверено на двух ТВ, пропуск с телефона Lampa не пускает). Поэтому «Сон»
     * закрывает Lampa, а один раз подсказываем «Автовыключение» самого ТВ — тогда он выключится сам. */
    function sleepWhat() { return dev('samsungApp') ? 'потом закрою Lampa' : 'потом остановлю видео'; }
    function sleepHint() {
        if (lsGet('bs_sleep_hint') || !dev('samsung')) return;
        lsSet('bs_sleep_hint', '1');
        setTimeout(function () { noty('Чтобы ТВ выключался сам: Общие → Экономия энергии → Автовыключение', 10000); }, 3500);
    }
    function tvOff() {
        try { tizen.application.getCurrentApplication().exit(); } catch (e) { try { Lampa.Player.close(); } catch (e2) {} }
    }

    /* Кнопка «Сон» в панели плеера: нажатие — по кругу: после этой серии/фильма → 30 → 60 → 90 мин → выкл. */
    function sleepMode() { return sleepEpisode ? 'episode' : sleepAt ? 'timer' : '0'; }
    function sleepNext() {
        var m = sleepMode(), next;
        if (m === 'episode') next = '30';
        else if (m === 'timer') {
            var left = (sleepAt - Date.now()) / 60000;
            next = left > 60 ? '0' : left > 30 ? '90' : '60';
        } else next = 'episode';
        sleepSet(next);
    }
    function sleepButton() {
        try {
            var panel = Lampa.PlayerPanel.render();
            if (!panel) return;
            var el = panel.find('.bs-btn-sleep');
            var text = sleepEpisode ? 'Сон: после этой' : sleepAt ? 'Сон: ' + Math.max(1, Math.ceil((sleepAt - Date.now()) / 60000)) + ' мин' : 'Сон';
            if (!el.length) {
                var box = panel.find('.player-panel__right').first();
                if (!box.length) return;
                var btn = $('<div class="player-panel__box-buttons"><div class="button selector bs-panel-btn bs-btn-sleep" style="padding:0 .8em;width:auto;font-size:.9em"></div></div>');
                btn.find('.selector').on('hover:enter', sleepNext);
                box.prepend(btn);
                el = btn.find('.selector');
            }
            el.text(text);
        } catch (e) {}
    }

    function sleepFire() {
        sleepAt = 0; sleepEpisode = false;
        try { if (playerOpen()) Lampa.PlayerVideo.pause(); } catch (e) {}
        sleepButton();
        noty('Сон: нажмите любую кнопку, иначе ' + (dev('samsungApp') ? 'Lampa закроется' : 'видео остановится') + ' через минуту', 15000);
        // минута до выключения — звук плавно тише (bsvolume.js); отменили или выключаем — громкость как была,
        // чтобы утром ТВ не включился еле слышным
        var unfade = function () {};
        try { if (window.BSVolume) unfade = BSVolume.fade(50000); } catch (e) {}
        var cancel = function () {
            document.removeEventListener('keydown', cancel, true);
            document.removeEventListener('touchstart', cancel, true);
            document.removeEventListener('mousedown', cancel, true);
            if (exitTimer) { clearTimeout(exitTimer); exitTimer = null; unfade(); noty('Сон отменён'); }
        };
        document.addEventListener('keydown', cancel, true);
        document.addEventListener('touchstart', cancel, true);
        document.addEventListener('mousedown', cancel, true);
        exitTimer = setTimeout(function () {
            exitTimer = null;
            document.removeEventListener('keydown', cancel, true);
            document.removeEventListener('touchstart', cancel, true);
            document.removeEventListener('mousedown', cancel, true);
            unfade();
            tvOff();
        }, 60000);
    }

    function sleepLabel() {
        if (sleepEpisode) return 'после этой серии или фильма';
        if (sleepAt) return 'через ' + Math.max(1, Math.round((sleepAt - Date.now()) / 60000)) + ' мин';
        return 'выключен';
    }

    /* ---------- 4. Цветные кнопки ---------- */

    var KEYS = { 403: 'red', 404: 'green', 405: 'yellow', 406: 'blue' };

    function registerColorKeys() {
        try {
            if (typeof tizen === 'undefined' || !tizen.tvinputdevice) return;
            ['ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue'].forEach(function (k) {
                try { tizen.tvinputdevice.registerKey(k); } catch (e) {}
            });
        } catch (e) {}
    }

    function panelButton(name) {
        var el = document.querySelector('.player-panel__' + name);
        if (!el || /\bhide\b/.test(el.className)) return false;
        try { Lampa.PlayerPanel.show(true); } catch (e) {}
        $(el).trigger('hover:enter');
        return true;
    }

    function onColorKey(e) {
        var color = KEYS[e.keyCode];
        if (!color || !playerOpen()) return;
        // открыто меню (главы, качество, дорожки) поверх плеера — красная закрыла бы плеер, а меню осталось бы висеть
        try { if (!/^player/.test(Lampa.Controller.enabled().name)) return; } catch (err) {}
        var done = false;
        if (color === 'red') { noty('Выберите другой источник'); try { Lampa.Player.close(); } catch (err) {} done = true; }
        if (color === 'green') done = panelButton('quality') || (noty('Других качеств нет'), true);
        if (color === 'yellow') done = panelButton('tracks') || (noty('Других озвучек нет'), true);
        if (color === 'blue') done = panelButton('subs') || (noty('Субтитров нет'), true);
        if (done) { e.preventDefault(); e.stopPropagation(); }
    }

    /* ---------- настройки и запуск ---------- */

    function addSettings() {
        var C = 'bs_update', api = Lampa.SettingsApi;
        api.addParam({ component: C, param: { name: 'bs_feat_title', type: 'title' }, field: { name: 'Плеер' } });
        if (dev('tvPlayer')) api.addParam({
            component: C,
            param: { name: 'bs_fast_start', type: 'trigger', 'default': true },
            field: { name: 'Быстрый старт видео', description: 'Поток сразу уходит в плеер Tizen, без предварительной загрузки плейлиста. Если пропали качества в меню — выключите.' },
            onChange: function (v) { lsSet('bs_fast_start', String(v === true || v === 'true')); }
        });
        api.addParam({
            component: C,
            param: { name: 'bs_noads', type: 'trigger', 'default': false },
            field: { name: 'Без рекламы перед фильмом', description: 'Lampa перезапустится' },
            onChange: function (v) {
                lsSet('bs_noads', String(v === true || v === 'true'));
                noty('Перезапускаю Lampa…', 2000);
                setTimeout(function () { location.reload(); }, 1500);
            }
        });
        api.addParam({
            component: C,
            param: { name: 'bs_sleep', type: 'select', values: { '0': 'Выключен', '30': '30 минут', '60': '1 час', '90': '1,5 часа', 'episode': 'После серии или фильма' }, 'default': '0' },
            field: { name: 'Таймер сна', description: 'Сейчас: выключен' },
            onRender: function (item) { item.find('.settings-param__descr').text('Сейчас: ' + sleepLabel()); },
            onChange: function (v) { sleepSet(v); try { Lampa.Storage.set('bs_sleep', '0'); } catch (e) {} }
        });
        if (dev('tv')) api.addParam({
            component: C,
            param: { name: 'bs_keys_info', type: 'static' },
            field: { name: 'Цветные кнопки в плеере', description: 'Красная — другой источник, зелёная — качество, жёлтая — озвучка, синяя — субтитры' }
        });
        api.addParam({
            component: C, param: { name: 'bs_iptv_lists', type: 'button' },
            field: { name: 'IPTV: открытые плейлисты', description: tvOn() ? 'Списки каналов для «Телеканалов» — выбрать и добавить' : 'Каналы для расширения IPTV — выбрать и добавить' },
            onChange: iptvChoose
        });
    }

    /* ---------- IPTV: открытые плейлисты ----------
     * Расширение IPTV (cub.red/plugin/iptv) приходит без плейлистов. Свои оно хранит в iptv_playlist_custom —
     * {id, custom, url, name}, так же, как его кнопка «Добавить плейлист». Здесь — выбор из открытых каталогов
     * бесплатных каналов: iptv-org (страны, языки, темы) и Free-TV (только официальные бесплатные трансляции).
     * Наши записи — с id «sunic-iptv-…»: повторное нажатие убирает только их, чужие плейлисты не трогаем.
     *
     * Адреса каталогов берём со своего зеркала (sunic.stream/iptv/<ключ>.m3u): сервер отдаёт их из кеша за один
     * запрос, github.com из наших стран открывается медленно и иногда не открывается вовсе. Зеркало — не точка
     * отказа: не ответило — качаем оригинал (правило «запас в обе стороны»).
     *
     * Качает и разбирает список расширение IPTV само. На телевизоре это заметно: скачать 137–537 КБ и разобрать
     * их на главном потоке — несколько секунд тишины после нажатия. Поэтому наши списки мы разбираем сами (пока
     * телевизор свободен) и кладём готовое в базу расширения — оно открывает плейлист мгновенно. */
    var IPTV_ORG = 'https://iptv-org.github.io/iptv/';
    var IPTV_MIRROR = 'https://sunic.stream/iptv/';
    var IPTV_MIRRORS = ['cub.red', 'cub.best'];             // запасные домены, если основной не отвечает
    // [ключ, название, зеркало, подпись на плитке, оригинал (запасной адрес)]
    var IPTV_LISTS = [
        ['uz', 'Узбекистан', IPTV_MIRROR + 'uz.m3u', 'Каналы страны', IPTV_ORG + 'countries/uz.m3u'],
        ['rus', 'На русском', IPTV_MIRROR + 'rus.m3u', 'Все страны', IPTV_ORG + 'languages/rus.m3u'],
        ['ru', 'Россия', IPTV_MIRROR + 'ru.m3u', 'Каналы страны', IPTV_ORG + 'countries/ru.m3u'],
        ['kz', 'Казахстан', IPTV_MIRROR + 'kz.m3u', 'Каналы страны', IPTV_ORG + 'countries/kz.m3u'],
        ['tr', 'Турция', IPTV_MIRROR + 'tr.m3u', 'Каналы страны', IPTV_ORG + 'countries/tr.m3u'],
        ['movies', 'Фильмы', IPTV_MIRROR + 'movies.m3u', 'Весь мир', IPTV_ORG + 'categories/movies.m3u'],
        ['series', 'Сериалы', IPTV_MIRROR + 'series.m3u', 'Весь мир', IPTV_ORG + 'categories/series.m3u'],
        ['kids', 'Детские', IPTV_MIRROR + 'kids.m3u', 'Весь мир', IPTV_ORG + 'categories/kids.m3u'],
        ['animation', 'Мультфильмы', IPTV_MIRROR + 'animation.m3u', 'Весь мир', IPTV_ORG + 'categories/animation.m3u'],
        ['documentary', 'Документальные', IPTV_MIRROR + 'documentary.m3u', 'Весь мир', IPTV_ORG + 'categories/documentary.m3u'],
        ['sports', 'Спорт', IPTV_MIRROR + 'sports.m3u', 'Весь мир', IPTV_ORG + 'categories/sports.m3u'],
        ['music', 'Музыка', IPTV_MIRROR + 'music.m3u', 'Весь мир', IPTV_ORG + 'categories/music.m3u'],
        ['news', 'Новости', IPTV_MIRROR + 'news.m3u', 'Весь мир', IPTV_ORG + 'categories/news.m3u'],
        ['freetv', 'Free-TV', IPTV_MIRROR + 'freetv.m3u', 'Официальные бесплатные, весь мир', 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8']
    ];
    /* По умолчанию кладём два списка: свой (Узбекистан) и русский — человек открывает IPTV и сразу видит каналы.
     * Остальные 12 — кнопкой в настройках: лишнее не качает трафик и не засоряет список. */
    var IPTV_DEFAULT = ['uz', 'rus'];
    var IPTV_DAY = 24 * 3600 * 1000;
    /* Браузер по https (сайт sunic.stream/lampa): канал с адресом http:// страница не загрузит (браузер запрещает
     * незащищённое видео на защищённой странице), а такие — почти половина iptv-org. Там берём списки без них
     * (зеркало /iptv/s/…) и при разборе тоже выкидываем http-каналы: в списке только то, что включится. ТВ, MSX и
     * страница по http — все каналы, как раньше. */
    function iptvSecure() { try { return window.location.protocol === 'https:' && !window.tizen; } catch (e) { return false; } }
    function iptvUrl(it, orig) { return orig ? it[4] : iptvSecure() ? IPTV_MIRROR + 's/' + it[0] + '.m3u' : it[2]; }
    /** Адреса наших плейлистов — под эту страницу (https/http) и источник (зеркало/оригинал); меняем только наши. */
    function iptvUrlsFix() {
        var list = iptvList(), i, at, it, url, changed = false, orig = lsGet('bs_iptv_src') === 'orig';
        for (i = 0; i < list.length; i++) {
            if (!list[i] || !/^sunic-iptv-/.test(String(list[i].id))) continue;
            at = iptvByKey(String(list[i].id).replace(/^sunic-iptv-/, ''));
            it = at >= 0 ? IPTV_LISTS[at] : null;
            url = it ? iptvUrl(it, orig) : '';
            if (url && list[i].url !== url) { list[i].url = url; changed = true; }
        }
        if (changed) try { Lampa.Storage.set('iptv_playlist_custom', list); } catch (e) {}
        return changed;
    }
    function iptvList() {
        var l = [];
        try { l = Lampa.Storage.get('iptv_playlist_custom', '[]'); } catch (e) {}
        return Object.prototype.toString.call(l) === '[object Array]' ? l : [];
    }
    function iptvHas(list, key) { for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === 'sunic-iptv-' + key) return i; return -1; }
    /** Добавить или убрать плейлист key в списке расширения IPTV. → true — добавлен, false — убран. */
    function iptvToggle(key) {
        var it = null, i, list = iptvList();
        for (i = 0; i < IPTV_LISTS.length; i++) if (IPTV_LISTS[i][0] === key) it = IPTV_LISTS[i];
        if (!it) return false;
        var at = iptvHas(list, key), added = at < 0;
        if (added) list.push({ id: 'sunic-iptv-' + key, custom: true, url: iptvUrl(it, lsGet('bs_iptv_src') === 'orig'), name: it[1] });
        else list.splice(at, 1);
        try { Lampa.Storage.set('iptv_playlist_custom', list); } catch (e) {}
        if (added) iptvFresh();
        return added;
    }
    /* Расширение IPTV качает плейлист один раз и хранит его («Обновление: никогда» по умолчанию) — а открытые списки
     * меняются каждый день. Нашим плейлистам ставим «каждый день» в его параметрах (база cub_iptv или Storage).
     * Один раз (метка sunic): если человек потом сам выберет другое в IPTV — не перебиваем. */
    function iptvFix(p) {
        p = p && typeof p === 'object' ? p : {};
        if (p.sunic) return null;
        p.update = 'day'; p.sunic = 1;
        if (!p.update_time) p.update_time = Date.now();             // не 0: расширение считает 0 просроченным и качает плейлист при каждом открытии
        return p;
    }
    function iptvFresh() {
        var mine = [], l = iptvList(), i;
        for (i = 0; i < l.length; i++) if (l[i] && /^sunic-iptv-/.test(l[i].id)) mine.push(l[i].id);
        if (!mine.length) return;
        for (i = 0; i < mine.length; i++) {
            try { var k = 'iptv_playlist_params_' + mine[i], p = iptvFix(Lampa.Storage.get(k, '{}')); if (p) Lampa.Storage.set(k, p); } catch (e) {}
        }
        iptvSeed();
        try {
            var Base = window.indexedDB || window.webkitIndexedDB;
            if (!Base) return;
            // без номера версии: открываем базу расширения как есть и сразу закрываем — не мешаем ему обновлять её схему
            var req = Base.open('lampa_cub_iptv');
            req.onsuccess = function () {
                var db = req.result;
                try {
                    if (!db.objectStoreNames.contains('params')) return db.close();
                    var tx = db.transaction(['params'], 'readwrite'), st = tx.objectStore('params');
                    mine.forEach(function (id) {
                        var g = st.get(id);
                        g.onsuccess = function () {
                            var p = iptvFix(g.result && g.result.value);
                            if (p) st.put({ key: id, value: p, time: Date.now() });
                        };
                    });
                    tx.oncomplete = tx.onerror = tx.onabort = function () { db.close(); };
                } catch (e) { try { db.close(); } catch (e2) {} }
            };
        } catch (e) {}
    }
    function iptvInstalled() {
        try {
            var p = Lampa.Storage.get('plugins', '[]');
            for (var i = 0; i < p.length; i++) if (/\/plugin\/iptv\b/.test(String((p[i] && (p[i].url || p[i].link)) || p[i]))) return true;
        } catch (e) {}
        return false;
    }

    /* ---------- IPTV: зеркало каталогов ----------
     * Решение — на сессию (ключ bs_iptv_src): «mirror» — качаем с нашего сервера, «orig» — с github. Переписываем
     * адреса только у наших плейлистов (id sunic-iptv-…), чужие не трогаем. */

    function iptvSourceSet(src) {
        if (lsGet('bs_iptv_src') === src) return;                  // уже так — не дёргаем Storage зря
        var list = iptvList(), i, at, it;
        for (i = 0; i < list.length; i++) {
            if (!list[i] || !/^sunic-iptv-/.test(String(list[i].id))) continue;
            at = iptvByKey(String(list[i].id).replace(/^sunic-iptv-/, ''));
            it = at >= 0 ? IPTV_LISTS[at] : null;
            if (it) list[i].url = iptvUrl(it, src === 'orig');
        }
        try { Lampa.Storage.set('iptv_playlist_custom', list); } catch (e) {}
        lsSet('bs_iptv_src', src);
    }
    /* Наш сервер отвечает? Проверяем раз в 6 часов (bs_iptv_probe — время проверки; старое «1» — давно): ответил —
     * возвращаемся на зеркало, нет — повторяем через 30–90 с (у каждого ТВ своё время) и только тогда переходим на
     * оригиналы. Иначе один короткий сбой зеркала разом уводил бы все ТВ на github — и навсегда. */
    var IPTV_PROBE_EVERY = 6 * 3600 * 1000;
    function iptvProbe(retry) {
        var last = +lsGet('bs_iptv_probe') || 0;
        if (!retry && last && Date.now() - last < IPTV_PROBE_EVERY && last <= Date.now()) return;
        var req;
        try { req = new Lampa.Reguest(); } catch (e) { return; }
        var done = false;
        var finish = function (ok) {
            if (done) return;
            done = true;
            if (!ok && !retry) { setTimeout(function () { iptvProbe(true); }, 30000 + Math.floor(Math.random() * 60000)); return; }
            lsSet('bs_iptv_probe', String(Date.now()));
            iptvSourceSet(ok ? 'mirror' : 'orig');
        };
        try {
            req.timeout(8000);
            req.silent(IPTV_MIRROR + 'uz.m3u', function () { finish(true); }, function () { finish(false); }, false, { dataType: 'text' });
            setTimeout(function () { finish(false); }, 12000);     // запрос завис — не ждём вечно
        } catch (e) { finish(false); }
    }
    /** Ссылка для скачивания: зеркало, а не ответило — оригинал (в том числе чужие зеркала cub.red/cub.best). */
    function iptvFetchText(url, ok, fail) {
        var req;
        try {
            req = new Lampa.Reguest();
            req.timeout(25000);
            req.silent(url, function (t) { ok(String(t == null ? '' : t)); }, function () { fail(); }, false, { dataType: 'text' });
        } catch (e) { fail(); }
    }

    /* ---------- IPTV: разбор m3u и подсадка списка в базу расширения ----------
     * Повторяем ровно то, что делает Parser расширения: имя — после последней запятой, tvg-rec → «догоняющее ТВ»,
     * #EXTGRP задаёт раздел, хвост «|User-Agent=…» отрезаем, играем только http/https. Результат — объект записи
     * расширения: {name:'', playlist:{menu, channels}, secuses:true}. */

    function iptvValidUrl(u) { return /^https?:\/\/\S+$/i.test(String(u || '')); }
    function iptvAttr(line, name) {
        var m = new RegExp(name + '="(.*?)"', 'gi').exec(line);
        return m && m[1] ? m[1] : '';
    }
    function iptvCatchup(line) {
        var t = iptvAttr(line, 'catchup'), d = iptvAttr(line, 'catchup-days'), r;
        if (!d) { r = /tvg-rec="(\d+)"/i.exec(line); if (r) d = r[1]; }
        if (!t && d) t = 'default';
        return { type: t, days: d, source: iptvAttr(line, 'catchup-source') };
    }
    function iptvParseInit(text) {
        return { lines: String(text == null ? '' : text).split('\n'), i: 1, head: '', out: [], cur: null, secure: iptvSecure() };
    }
    /** Одна строка для парсера. После каждой — st.i++; строки можно давать кусками (см. iptvParseRun). */
    function iptvParseLine(st) {
        var line = String(st.lines[st.i] || '').replace(/\r$/, '').replace(/^\s+|\s+$/g, '');
        var u, g, name;
        if (line.indexOf('#EXTINF:') === 0) {
            name = (line.split(',').pop() || '').replace(/^\s+|\s+$/g, '');
            st.cur = {
                id: iptvAttr(line, 'tvg-id'),
                name: name,
                logo: iptvAttr(line, 'tvg-logo'),
                group: iptvAttr(line, 'group-title'),
                url: undefined,
                raw: line,
                catchup: iptvCatchup(line),
                timeshift: iptvAttr(line, 'timeshift')
            };
        } else if (line.indexOf('#EXTGRP:') === 0) {
            g = line.slice(8).replace(/"/g, '').replace(/^\s+|\s+$/g, '');
            if (g && st.cur) { st.cur.group = g; st.cur.raw += '\n' + line; }
        } else if (line.charAt(0) !== '#') {
            u = line.split('|')[0];                                // хвост |User-Agent=… расширение отрезает
            if (u && iptvValidUrl(u)) { if (st.cur && !(st.secure && /^http:\/\//i.test(u))) { st.cur.url = u; st.out.push(st.cur); } st.cur = null; }
            else if (st.cur) st.cur.raw += '\n' + line;            // не ссылка — служебная строка внутри канала
        } else if (st.cur) {
            st.cur.raw += '\n' + line;
        }
        st.i++;
    }
    /** Итог разбора — ровно то, что кладём в базу: {name, playlist:{menu, channels}, secuses:true}. */
    function iptvParseFinish(st) {
        if (st.cur) st.out.push(st.cur);                           // последний #EXTINF без ссылки — у расширения он тоже в списке
        if (!st.out.length) return null;
        var channels = [], menu = [{ name: '', count: st.out.length }], i, j, ch, it, name, at;
        for (i = 0; i < st.out.length; i++) {
            it = st.out[i];
            name = String(it.name || '').replace(/ \((\+\d+)\)/g, ' $1').replace(/\s+(\s|ⓢ|ⓖ|ⓥ|ⓞ|Ⓢ|Ⓖ|Ⓥ|Ⓞ)/g, ' ').replace(/^\s+|\s+$/g, '');
            ch = { id: it.id || null, name: name, logo: /^http/i.test(it.logo || '') ? it.logo : '', group: it.group || '', url: it.url || undefined,
                catchup: { type: it.catchup.type || '', days: it.catchup.days || '', source: it.catchup.source || '' }, timeshift: it.timeshift || '' };
            channels.push(ch);
            at = -1;
            for (j = 0; j < menu.length; j++) if (menu[j].name === ch.group) { at = j; break; }
            if (at >= 0) menu[at].count++; else menu.push({ name: ch.group, count: 1 });
        }
        return { name: '', playlist: { menu: menu, channels: channels }, secuses: true };
    }
    function iptvParse(text) {
        var st = iptvParseInit(text);
        if (!/^#EXTM3U/i.test(String(st.lines[0] || ''))) return null;      // не m3u — не подсылаем
        var head = String(st.lines[0] || '');
        if (head.indexOf('catchup') < 0) st.noCatchup = true;
        while (st.i < st.lines.length) iptvParseLine(st);
        return iptvParseFinish(st);
    }
    /** Разбор кусками: столько строк за такт, между тактами отдаём поток ТВ (setTimeout 0). */
    function iptvParseRun(st, step, done) {
        var end = st.i + (step || 4000);
        while (st.i < st.lines.length && st.i < end) iptvParseLine(st);
        if (st.i < st.lines.length) return setTimeout(function () { iptvParseRun(st, step, done); }, 0);
        done(iptvParseFinish(st));
    }

    /* Подсадка: разбираем наш список и кладём готовое в базу расширения, чтобы открытие было мгновенным.
     * Своё не трогаем: есть свежая запись (моложе 20,4 ч) — расширение её и возьмёт, ничего не делаем.
     * Не получилось — молча уходим: расширение скачает и разберёт список само, как раньше. */

    function iptvSeedOne(it, cb) {
        if (!it || !it.length) return cb();
        var key = it[0], id = 'sunic-iptv-' + key, url = iptvUrl(it, lsGet('bs_iptv_src') === 'orig');
        var Base = window.indexedDB || window.webkitIndexedDB;
        if (!Base) return cb();
        var req;
        try { req = Base.open('lampa_cub_iptv'); } catch (e) { return cb(); }
        req.onerror = function () { cb(); };
        req.onsuccess = function () {
            var db = req.result;
            try {
                if (!db.objectStoreNames.contains('playlist') || !db.objectStoreNames.contains('params')) return cb(db.close());
                var tx = db.transaction(['playlist', 'params'], 'readonly'), op = tx.objectStore('playlist').get(id), oq = tx.objectStore('params').get(id);
                var fresh = false;
                var check = function () {
                    if (!(op.ready && oq.ready)) return;
                    try {
                        var rec = op.result, par = oq.result;
                        fresh = !!(rec && rec.value && par && par.value && par.value.update_time &&
                            Date.now() - par.value.update_time < IPTV_DAY * 0.85 &&   // расширение само переиспользует такую запись
                            !!par.value.secure === iptvSecure());                        // собрана для этой же страницы (https без http-каналов)
                    } catch (e) {}
                    if (fresh) return cb(db.close());
                    db.close();
                    iptvFetchText(url, function (text) {
                        var rec2 = iptvParse(text);
                        if (!rec2) return cb();
                        iptvSeedWrite(id, rec2, cb);
                    }, function () { cb(); });
                };
                op.ready = oq.ready = false;
                op.onsuccess = oq.onsuccess = function () { this.ready = true; check(); };
                op.onerror = oq.onerror = function () { this.ready = true; check(); };
            } catch (e) { cb(); try { db.close(); } catch (e2) {} }
        };
    }
    function iptvSeedWrite(id, rec, cb) {
        var Base = window.indexedDB || window.webkitIndexedDB;
        if (!Base) return cb();
        var req;
        try { req = Base.open('lampa_cub_iptv'); } catch (e) { return cb(); }
        req.onerror = function () { cb(); };
        req.onsuccess = function () {
            var db = req.result;
            try {
                if (!db.objectStoreNames.contains('playlist') || !db.objectStoreNames.contains('params')) return cb(db.close());
                var tx = db.transaction(['playlist', 'params'], 'readwrite'), now = Date.now();
                tx.objectStore('playlist').put({ key: id, value: rec, time: now });
                tx.objectStore('params').put({ key: id, value: { update: 'day', update_time: now, sunic: 1, secure: iptvSecure() ? 1 : 0 }, time: now });
                tx.oncomplete = function () { try { db.close(); } catch (e) {} iptvAltOff(); cb(); };
                tx.onerror = tx.onabort = function () { try { db.close(); } catch (e) {} cb(); };
            } catch (e) { cb(); try { db.close(); } catch (e2) {} }
        };
    }
    var iptvSeedQueue = null, iptvSeeded = false;
    function iptvSeed() {
        if (iptvSeeded) return;
        var list = iptvList(), mine = [], i, at;
        for (i = 0; i < list.length; i++) if (list[i] && /^sunic-iptv-/.test(String(list[i].id))) mine.push(list[i]);
        if (!mine.length) return;
        iptvSeeded = true;
        iptvSeedQueue = mine;
        iptvSeedNext();
    }
    /** По одному списку за раз и с паузой 3–12 с: сервер не заваливаем — обновление «каждый день» само докачает остальное. */
    function iptvSeedNext() {
        var it = iptvSeedQueue && iptvSeedQueue.shift();
        if (!it) { iptvSeedQueue = null; return; }
        iptvSeedOne(IPTV_LISTS[iptvByKey(String(it.id).replace(/^sunic-iptv-/, ''))], function () {
            setTimeout(iptvSeedNext, 3000 + Math.round(Math.random() * 9000));
        });
    }

    /* ---------- IPTV: запасные адреса канала ----------
     * Один и тот же канал в разных списках играет по разным адресам: если поток не отвечает, сторож пробует
     * другой адрес того же канала, прежде чем закрыть плеер. Индекс «название → адреса» собираем из записей
     * расширения один раз за сессию (первый канал). */

    var IPTV_ALT = null, iptvAltDone = false;
    function iptvNormName(n) {
        return String(n || '').toLowerCase().replace(/[\u00A9\u00AE\u2122]/g, '').replace(/^\s+|\s+$/g, '').replace(/\s+/g, ' ');
    }
    function iptvAltOff() { IPTV_ALT = null; iptvAltDone = false; }         // после перезаписи списков индекс пересоберём
    function iptvAltWarm() {
        if (iptvAltDone) return;
        iptvAltDone = true;
        var list = iptvList(), ids = [], i, map = {};
        for (i = 0; i < list.length; i++) if (list[i] && /^sunic-iptv-/.test(String(list[i].id))) ids.push(list[i].id);
        if (ids.length < 2) { IPTV_ALT = map; return; }                    // один список — запасных адресов нет
        var Base = window.indexedDB || window.webkitIndexedDB;
        if (!Base) { IPTV_ALT = map; return; }
        var req;
        try { req = Base.open('lampa_cub_iptv'); } catch (e) { IPTV_ALT = map; return; }
        req.onerror = function () { IPTV_ALT = map; };
        req.onsuccess = function () {
            var db = req.result;
            try {
                if (!db.objectStoreNames.contains('playlist')) { db.close(); IPTV_ALT = map; return; }
                var tx = db.transaction('playlist', 'readonly'), st = tx.objectStore('playlist'), left = ids.length;
                var addAll = function () {
                    if (--left > 0) return;
                    IPTV_ALT = map;
                    try { db.close(); } catch (e) {}
                };
                ids.forEach(function (id) {
                    var g = st.get(id);
                    g.onsuccess = function () {
                        try {
                            var rec = g.result && g.result.value, ch = rec && rec.playlist && rec.playlist.channels;
                            if (ch) for (var j = 0; j < ch.length; j++) {
                                var k = iptvNormName(ch[j].name), u = ch[j].url;
                                if (!k || !u || !/^https?:\/\//i.test(u)) continue;
                                if (!map[k]) map[k] = [];
                                if (map[k].indexOf(u) < 0) map[k].push(u);
                                if (map[k].length > 4) map[k].length = 4;          // хватит пары-трёх попыток
                            }
                        } catch (e) {}
                        addAll();
                    };
                    g.onerror = addAll;
                });
            } catch (e) { try { db.close(); } catch (e2) {} IPTV_ALT = map; }
        };
    }
    /** Другой адрес того же канала (по названию), кроме уже перебранных; такого нет — null. */
    function iptvAlt(name, url, tried) {
        if (!IPTV_ALT) return null;
        var a = IPTV_ALT[iptvNormName(name)], i;
        if (!a || a.length < 2) return null;
        for (i = 0; i < a.length; i++) if (a[i] !== url && (!tried || tried.indexOf(a[i]) < 0)) return a[i];
        return null;
    }
    function iptvAltIndex(map) { IPTV_ALT = map; iptvAltDone = true; }        // готовый индекс (в тестах)
    /* По умолчанию (один раз, метка bs_iptv_auto): ставим расширение IPTV и кладём в него два списка — Узбекистан
     * и русский (IPTV_DEFAULT): человек открывает IPTV и сразу видит каналы, без настроек. Остальные списки — кнопкой
     * в настройках. Убрал расширение или плейлист сам — больше не возвращаем. */
    function iptvAuto() {
        if (lsGet('bs_iptv_auto')) return;
        var l = iptvList(), i, had = false;
        for (i = 0; i < l.length; i++) if (l[i] && /^sunic-iptv-/.test(l[i].id)) had = true;
        if (!had) {
            for (i = 0; i < IPTV_DEFAULT.length; i++) {
                var at = iptvByKey(IPTV_DEFAULT[i]);
                if (at >= 0) l.push({ id: 'sunic-iptv-' + IPTV_DEFAULT[i], custom: true, url: iptvUrl(IPTV_LISTS[at], lsGet('bs_iptv_src') === 'orig'), name: IPTV_LISTS[at][1] });
            }
            try { Lampa.Storage.set('iptv_playlist_custom', l); } catch (e) {}
        }
        // как в привычных IPTV-плеерах: открыл — сразу каналы (на русском), сменить список — «Назад» в IPTV
        try {
            var book = Lampa.Storage.get('iptv_pilot_book', '{}');
            if (book && typeof book === 'object' && !book.playlist) { book.playlist = 'sunic-iptv-rus'; Lampa.Storage.set('iptv_pilot_book', book); }
        } catch (e) {}
        iptvFresh();
        if (!iptvInstalled() && !tvOn()) {                         // есть свои «Телеканалы» — расширение IPTV не ставим
            var dom = 'cub.red';
            try { dom = Lampa.Manifest.cub_domain || dom; } catch (e) {}
            try { Lampa.Plugins.add({ url: 'https://' + dom + '/plugin/iptv', status: 1, name: 'IPTV', author: '@lampa' }); } catch (e) { return; }
        }
        lsSet('bs_iptv_auto', '1');
    }
    /* «Телеканалы» (bstv.js) — свой IPTV-плеер; где он есть (bstv.js загружен), расширение IPTV новым
     * не ставим, а у кого стоит — прячем его пункт «IPTV» из меню (как «Редактировать меню»: menu_hide), «Телеканалы»
     * ставим на его место. Один раз (метка bs_iptv_menu_off): вернёт человек «IPTV» в меню сам — не прячем снова.
     * Само расширение и его данные не трогаем: свои плейлисты человека видны и в «Телеканалах». */
    function tvOn() { try { return !!window.BSTv; } catch (e) { return false; } }      // «Телеканалы» есть везде, где загружен bstv.js (с 2.3.63)
    function iptvMenuOff() {
        if (!tvOn() || lsGet('bs_iptv_menu_off')) return;
        try {
            var hide = Lampa.Storage.get('menu_hide', '[]'), sort = Lampa.Storage.get('menu_sort', '[]'), at, tv;
            hide = Object.prototype.toString.call(hide) === '[object Array]' ? hide.slice() : [];
            if (hide.indexOf('IPTV') < 0) { hide.push('IPTV'); Lampa.Storage.set('menu_hide', hide); }
            if (Object.prototype.toString.call(sort) === '[object Array]' && (at = sort.indexOf('IPTV')) >= 0) {
                sort = sort.slice();
                tv = sort.indexOf('Телеканалы');
                if (tv >= 0) sort.splice(tv, 1);
                sort.splice(sort.indexOf('IPTV'), 0, 'Телеканалы');
                Lampa.Storage.set('menu_sort', sort);
            }
            $('.menu .menu__item').each(function () { if ($(this).find('.menu__text').text().replace(/^\s+|\s+$/g, '') === 'IPTV') $(this).addClass('hidden'); });
        } catch (e) { return; }
        lsSet('bs_iptv_menu_off', '1');
    }
    /* ---------- IPTV: вид ----------
     * Экраны расширения IPTV сделаны под ссылки провайдеров: адреса m3u, «Метод загрузки CUB», совет зайти на cub.best,
     * разделы и названия каналов по-английски с пометками «[Not 24/7]». Для наших плейлистов приводим в порядок:
     * плитки с названием и подписью в нашем порядке, разделы по-русски, названия каналов без служебных пометок.
     * Только вид: данные и поведение расширения не трогаем. */
    var IPTV_GROUPS = { animation: 'Мультфильмы', auto: 'Авто', business: 'Бизнес', classic: 'Классика', comedy: 'Комедии',
        cooking: 'Кулинария', culture: 'Культура', documentary: 'Документальные', education: 'Образование',
        entertainment: 'Развлечения', family: 'Семейные', general: 'Общие', interactive: 'Интерактив', kids: 'Детские',
        legislative: 'Парламент', lifestyle: 'Стиль жизни', movies: 'Фильмы', music: 'Музыка', news: 'Новости',
        outdoor: 'Природа и отдых', 'public': 'Общественные', relax: 'Релакс', religious: 'Религия', science: 'Наука',
        series: 'Сериалы', shop: 'Магазины', sports: 'Спорт', travel: 'Путешествия', weather: 'Погода', undefined: 'Разное' };
    function iptvGroup(t) {
        var parts = String(t || '').split(';'), out = [], i, k, hit = false;
        for (i = 0; i < parts.length; i++) {
            k = parts[i].replace(/^\s+|\s+$/g, '');
            if (IPTV_GROUPS.hasOwnProperty(k.toLowerCase())) { k = IPTV_GROUPS[k.toLowerCase()]; hit = true; }
            if (k) out.push(k);
        }
        return hit ? out.join(' · ') : t;
    }
    function iptvChannel(t) {
        return String(t || '').replace(/\s*\[(Not 24\/7|Geo-blocked)\]/gi, '').replace(/\s*\((\d{3,4}[pi]|\d+K)\)/gi, '').replace(/^\s+|\s+$/g, '') || t;
    }
    function iptvByUrl(url) {
        for (var i = 0; i < IPTV_LISTS.length; i++) if (IPTV_LISTS[i][2] === url || IPTV_LISTS[i][4] === url || IPTV_MIRROR + 's/' + IPTV_LISTS[i][0] + '.m3u' === url) return i;
        return -1;
    }
    function iptvByKey(key) {
        for (var i = 0; i < IPTV_LISTS.length; i++) if (IPTV_LISTS[i][0] === key) return i;
        return -1;
    }
    function iptvText(el, f) {
        if (!el) return;
        var t = el.textContent, n = f(t);
        if (n !== t) el.textContent = n;
    }
    function iptvConst(v) { return function () { return v; }; }
    /** Порядок плиток: наши — как в IPTV_LISTS, чужие следом, «+ Свой плейлист» в конце. → true, если переставили. */
    function iptvSort(q) {
        var list = [], i, parent = q.length ? q[0].parentNode : null, moved = false;
        for (i = 0; i < q.length; i++) {
            if (q[i].parentNode !== parent) return false;
            list.push({ el: q[i], k: q[i].className.indexOf('bs-iptv-add') >= 0 ? 1000 : +(q[i].getAttribute('data-bs-at') || 500), i: i });
        }
        list.sort(function (a, b) { return a.k - b.k || a.i - b.i; });
        for (i = 0; i < list.length; i++) if (list[i].el !== q[i]) moved = true;
        if (moved) for (i = 0; i < list.length; i++) parent.appendChild(list[i].el);
        return moved;
    }
    function iptvTidy(root) {
        var i, q, el, u, at;
        q = root.querySelectorAll('.iptv-playlist-item');
        for (i = 0; i < q.length; i++) {
            el = q[i];
            if (!el.querySelector('.iptv-playlist-item__body')) {
                if (el.className.indexOf('bs-iptv-add') < 0) el.className += ' bs-iptv-add';
                continue;
            }
            u = el.querySelector('.iptv-playlist-item__url');
            at = u ? iptvByUrl(u.getAttribute('data-bs-url') || u.textContent) : -1;
            if (at < 0) continue;
            if (!u.getAttribute('data-bs-url')) u.setAttribute('data-bs-url', u.textContent);
            el.setAttribute('data-bs-at', at);
            iptvText(u, iptvConst(IPTV_LISTS[at][3]));
            iptvText(el.querySelector('.iptv-playlist-item__name-text'), iptvConst(IPTV_LISTS[at][1]));
            iptvText(el.querySelector('.iptv-playlist-item__name-ico span'), iptvConst(IPTV_LISTS[at][1].charAt(0)));
            if (el.className.indexOf('bs-iptv-own') < 0) el.className += ' bs-iptv-own bs-iptv-c' + (at % 6);
        }
        // переставили — фокус пульта на первую плитку (расширение ставит его на первую по своему порядку)
        if (q.length && iptvSort(q)) {
            try {
                var first = root.querySelector('.iptv-playlist-item'), sc = root.querySelector('.iptv-list__items .scroll');
                if (first && sc) Lampa.Controller.collectionFocus(first, sc);
            } catch (e) {}
        }
        q = root.querySelectorAll('.iptv-menu__list-item > div');
        for (i = 0; i < q.length; i++) {
            // «Комедии;Семейные;Фильмы — 1 канал»: такие сборные разделы только засоряют меню, каналы есть во «Все каналы»
            if (q[i].textContent.indexOf(';') >= 0) { el = q[i].parentNode; el.className = el.className.replace(/\bselector\b/, '') + ' hide'; }
            else iptvText(q[i], iptvGroup);
        }
        el = root.querySelector('.iptv-menu__title');
        if (el) {
            try { at = iptvByKey(String(Lampa.Storage.get('iptv_pilot_book', '{}').playlist || '').replace(/^sunic-iptv-/, '')); } catch (e) { at = -1; }
            if (at >= 0) iptvText(el, iptvConst(IPTV_LISTS[at][1]));
        }
        // мышь и касание (браузер, телефон): к выбору списка ведёт только «Назад» — о нём не догадаться. Рядом с названием
        // списка — кнопка «Сменить список» (на ТВ не нужна: «Назад» на пульте)
        el = root.querySelector('.iptv-menu__head');
        if (el && el.parentNode && !el.parentNode.querySelector('.bs-iptv-switch') && !iptvRemote()) {
            var sw = document.createElement('div');
            sw.className = 'bs-iptv-switch';
            sw.textContent = 'Сменить список';
            sw.onclick = function (ev) { try { ev.stopPropagation(); Lampa.Controller.back(); } catch (x) {} };
            el.parentNode.insertBefore(sw, el.nextSibling);           // под названием: само название не сжимается
        }
        q = root.querySelectorAll('.iptv-details__play span:last-child, .iptv-hud-menu-info__group');
        for (i = 0; i < q.length; i++) iptvText(q[i], iptvGroup);
        q = root.querySelectorAll('.iptv-channel__name, .iptv-details__title, .iptv-hud-menu-info__name');
        for (i = 0; i < q.length; i++) iptvText(q[i], iptvChannel);
        // логотип не пришёл за 4 с (часть картинок каталога недоступна) — пустая плитка; пусть расширение покажет букву и название
        q = root.querySelectorAll('img.iptv-channel__ico');
        for (i = 0; i < q.length; i++) {
            if (q[i].getAttribute('data-bs-wait')) continue;
            q[i].setAttribute('data-bs-wait', '1');
            setTimeout((function (img) {
                return function () {
                    try {
                        var f = img.onerror;
                        if (!img.parentNode || img.naturalWidth || !f || img.parentNode.querySelector('.iptv-channel__simb')) return;
                        img.onerror = img.onload = null;                // поздняя ошибка картинки не добавит название второй раз
                        img.removeAttribute('src');
                        img.style.display = 'none';
                        f.call(img);
                    } catch (e) {}
                };
            })(q[i]), 4000);
        }
    }
    function iptvRemote() { try { return !!(Lampa.Platform.tv && Lampa.Platform.tv()); } catch (e) { return false; } }
    function iptvTilesOn() {
        try { return Lampa.Activity.active().component === 'iptv' && !!document.querySelector('.activity--active .iptv-list__items'); } catch (e) { return false; }
    }
    function iptvWords() {
        try {
            Lampa.Lang.add({
                iptv_select_playlist: { ru: 'ТВ-каналы', en: 'TV channels', uk: 'ТБ-канали' },
                iptv_select_playlist_text: { ru: 'Бесплатные каналы из открытых источников. Списки обновляются каждый день.',
                    en: 'Free channels from open sources. Lists update every day.', uk: 'Безкоштовні канали з відкритих джерел. Списки оновлюються щодня.' },
                iptv_playlist_add_new: { ru: '+ Свой плейлист', en: '+ Own playlist', uk: '+ Свій плейлист' }
            });
        } catch (e) {}
    }
    var IPTV_CSS = '.iptv-list__ico{display:none}.iptv-list__title{font-size:2.2em;font-weight:600;margin-bottom:.4em}' +
        '.iptv-menu .iptv-menu__head .iptv-menu__title{font-size:1.9em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
        '.bs-iptv-switch{display:inline-block;margin:-.4em 0 1em;padding:.45em 1.1em;border-radius:2em;font-size:.95em;white-space:nowrap;cursor:pointer;' +
        'background:rgba(255,255,255,.12)}.bs-iptv-switch:hover{background:rgba(255,255,255,.22)}' +
        '.iptv-list__text{opacity:.6;margin-bottom:1.2em}.iptv-list__items{width:92%}.iptv-list__items .scroll{height:28em}' +
        '.iptv-list__items .scroll__body{display:-webkit-box;display:-webkit-flex;display:flex;-webkit-flex-wrap:wrap;flex-wrap:wrap}' +
        '.iptv-list__items .iptv-playlist-item{width:30%;width:calc(33.333% - 2em);box-sizing:border-box;margin:1em;padding:1.3em 1.4em;border-radius:1em}' +
        '.iptv-playlist-item.bs-iptv-own .iptv-playlist-item__body{-webkit-box-orient:vertical;-webkit-flex-direction:column;flex-direction:column;' +
        '-webkit-box-align:start;-webkit-align-items:flex-start;align-items:flex-start}' +
        '.iptv-playlist-item.bs-iptv-own .iptv-playlist-item__name{width:100%}' +
        '.iptv-playlist-item.bs-iptv-own .iptv-playlist-item__name-text{font-size:1.35em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
        '.iptv-playlist-item.bs-iptv-own .iptv-playlist-item__url{width:100%;padding:0;margin-top:.7em;text-align:left;opacity:.55;white-space:normal}' +
        '.iptv-playlist-item.bs-iptv-own .iptv-playlist-item__footer{display:none}' +
        '.iptv-playlist-item.bs-iptv-own .iptv-playlist-item__name-ico{color:#fff;border-radius:.6em;min-width:2.6em;padding:.45em .5em}' +
        '.bs-iptv-c0 .iptv-playlist-item__name-ico{background:#2f7cf6}.bs-iptv-c1 .iptv-playlist-item__name-ico{background:#e5484d}' +
        '.bs-iptv-c2 .iptv-playlist-item__name-ico{background:#12a594}.bs-iptv-c3 .iptv-playlist-item__name-ico{background:#f59e0b}' +
        '.bs-iptv-c4 .iptv-playlist-item__name-ico{background:#8e4ec6}.bs-iptv-c5 .iptv-playlist-item__name-ico{background:#e54666}' +
        '.iptv-playlist-item.bs-iptv-add{background:none;border:.15em dashed rgba(255,255,255,.3);' +
        'display:-webkit-box;display:-webkit-flex;display:flex;-webkit-box-align:center;-webkit-align-items:center;align-items:center;' +
        '-webkit-box-pack:center;-webkit-justify-content:center;justify-content:center}' +
        '.iptv-playlist-item.bs-iptv-add .iptv-playlist-item__title{padding:0;font-size:1.2em;opacity:.7}';
    function iptvLook() {
        try {
            var st = document.createElement('style');
            st.textContent = IPTV_CSS;
            document.head.appendChild(st);
            Lampa.Listener.follow('activity', function (e) {
                if (!e || e.type !== 'init' || e.component !== 'iptv' || !e.object || !e.object.activity) return;
                iptvWords();                                            // до создания экрана: тексты он берёт при создании
                var root = e.object.activity.render(true), wait = false;
                if (!root || !window.MutationObserver) return;
                new MutationObserver(function () {
                    if (wait) return;
                    wait = true;
                    setTimeout(function () { wait = false; try { iptvTidy(root); } catch (er) {} }, 30);
                }).observe(root, { childList: true, subtree: true, characterData: true });
            });
        } catch (e) {}
    }
    function iptvChoose() {
        var list = iptvList(), ctrl = 'settings_component';
        try { ctrl = Lampa.Controller.enabled().name; } catch (e) {}
        var items = IPTV_LISTS.map(function (it) { return { title: (iptvHas(list, it[0]) >= 0 ? '✓ ' : '') + it[1], key: it[0] }; });
        Lampa.Select.show({
            title: 'IPTV: открытые плейлисты',
            items: items,
            onSelect: function (a) {
                var added = iptvToggle(a.key);
                noty(added ? 'Добавлен: ' + a.title.replace(/^✓ /, '') + (tvOn() ? ' — откройте «Телеканалы»' : iptvInstalled() ? ' — откройте IPTV' : ' — установите расширение IPTV (Настройки → Расширения)')
                    : 'Убран: ' + a.title.replace(/^✓ /, ''), 5000);
                iptvChoose();                                           // список снова, с новыми отметками
            },
            onBack: function () { try { Lampa.Controller.toggle(ctrl); } catch (e) {} }
        });
    }

    /* Сколько людей пользуется Sunic Apps — цифры на главной sunic.stream (владелец, 2026-10-22). При запуске и раз
     * в 10 минут, пока Lampa открыта, — анонимный сигнал на sunic.stream/stat.php: случайный номер этого устройства
     * (создаётся здесь, bs_uid) и его тип. Ни IP, ни того, что смотрят, сервер не хранит. Картинкой — без CORS, на любом
     * ТВ; по http (у старых ТВ нет нужного TLS), со страницы по https — по https. Не ответил — не важно, повторов нет. */
    function statKind() {
        if (dev('samsungApp')) return 'samsung';
        if (window.BS_ANDROID) return 'android';
        return dev('tv') ? 'tv' : 'web';
    }
    function statPing() {
        var id = lsGet('bs_uid');
        if (!/^[a-f0-9]{16}$/.test(id || '')) {
            id = '';
            for (var i = 0; i < 16; i++) id += '0123456789abcdef'.charAt(Math.floor(Math.random() * 16));
            lsSet('bs_uid', id);
        }
        var proto = 'http:';
        try { if (window.location.protocol === 'https:') proto = 'https:'; } catch (e) {}
        try { new Image().src = proto + '//sunic.stream/stat.php?d=' + id + '&p=' + statKind() + '&t=' + new Date().getTime(); } catch (e) {}
    }

    /* YouTube IFrame API. Раньше грузилась на каждом старте (и дважды); Lampa 3.3.5 играет трейлеры своим мостом и
     * её не использует, плагины byskaz/Skaz тоже. Остался только старый Lampa.YouTube.play — для него подгружаем
     * API по требованию. */
    function lazyYouTube() {
        var Y = Lampa.YouTube, play = Y && Y.play;
        if (!play || play.__bs) return;
        var queued = null, loading = false;
        Y.play = function () {
            if (window.YT && window.YT.Player) return play.apply(this, arguments);
            queued = { self: this, args: arguments };            // пока API грузится — играем только последнее нажатие
            if (loading) return;
            loading = true;
            var prev = window.onYouTubeIframeAPIReady;
            window.onYouTubeIframeAPIReady = function () {
                if (prev) try { prev(); } catch (e) {}
                var q = queued; queued = null;
                if (q) play.apply(q.self, q.args);
            };
            var sc = document.createElement('script');
            sc.src = 'https://www.youtube.com/iframe_api';
            document.head.appendChild(sc);
        };
        Y.play.__bs = true;
    }

    /* Уведомления в плеере: панель внизу (кнопки, шкала) — плашка в правом нижнем углу легла бы на кнопки.
     * Пока панель видна, поднимаем уведомления над ней (bs.css, body.bs-panel-up). */
    function noticesAbovePanel() {
        Lampa.PlayerPanel.listener.follow('visible', function (e) { $('body').toggleClass('bs-panel-up', !!(e && e.status)); });
        Lampa.Player.listener.follow('destroy', function () { $('body').removeClass('bs-panel-up'); });
    }

    /* Клавиатура поиска - по кругу: на краю ряда «вправо» ведёт на первую клавишу этого ряда, «влево» -
     * на последнюю. Раньше курсор упирался в край, и к другому концу приходилось идти через весь ряд.
     * Только в поиске (.search__keypad): в других окнах Lampa край клавиатуры может вести в соседние элементы. */
    function keyboardWrapTarget(dir) {
        var cur = $('.search__keypad .simple-keyboard .hg-button.focus');
        if (cur.length !== 1) return null;
        var row = cur.closest('.hg-row').find('.hg-button');
        var i = row.index(cur);
        if (i < 0 || row.length < 2) return null;
        if (dir === 'right' && i === row.length - 1) return row.eq(0);
        if (dir === 'left' && i === 0) return row.eq(row.length - 1);
        return null;
    }
    function keyboardWrap() {
        var C = Lampa.Controller, add = C && C.add;
        if (!add || add.__bsWrap) return;
        C.add = function (name, obj) {
            if (name === 'keybord' && obj && obj.left && obj.right) {
                var left = obj.left, right = obj.right;
                var jump = function (dir, orig, self, args) {
                    var t = keyboardWrapTarget(dir);
                    if (!t) return orig.apply(self, args);
                    try { Lampa.Controller.collectionFocus(t[0], $('.search__keypad .simple-keyboard')); } catch (e) { orig.apply(self, args); }
                };
                obj.left = function () { jump('left', left, this, arguments); };
                obj.right = function () { jump('right', right, this, arguments); };
            }
            // плитки списков IPTV: расширение знает только «вверх/вниз» (у него был столбец) — даём «влево/вправо»
            if (name === 'content' && obj && !obj.right && iptvTilesOn()) {
                var back = obj.left;
                obj.right = function () { try { if (Navigator.canmove('right')) Navigator.move('right'); } catch (e) {} };
                obj.left = function () {
                    try { if (Navigator.canmove('left')) return Navigator.move('left'); } catch (e) {}
                    if (back) back.apply(this, arguments);
                };
            }
            return add.apply(this, arguments);
        };
        C.add.__bsWrap = true;
    }

    /* Кнопка «На весь экран» в шапке: Lampa прячет её на любом Android, считая, что это её приложение (там экран
     * делает оно само). В браузере на планшете или телефоне (сайт sunic.stream) она нужна — показываем, если браузер умеет. */
    /* iPhone: Safari не даёт странице весь экран (только видео) — кнопка подсказывает «На экран «Домой»» (сайт откроется
     * как приложение, без панелей Safari); видео само идёт во весь экран — плеер «iOS» (ставит страница sunic.stream). */
    function fullscreenButton() {
        if (!window.BS_SITE_VERSION || window.AndroidJS || window.Android) return;
        var el = document.documentElement, native = !!(el.requestFullscreen || el.webkitRequestFullScreen || el.mozRequestFullScreen);
        var homeScreen = window.navigator.standalone === true;
        if (!native && (!iphone() || homeScreen)) return;
        var b = document.querySelectorAll('.head .full--screen');
        for (var i = 0; i < b.length; i++) {
            b[i].classList.remove('hide');
            if (!native) $(b[i]).on('hover:enter', function () {
                noty('На iPhone во весь экран: «Поделиться» → «На экран «Домой»» — Lampa будет открываться без панелей Safari. Видео и так открывается на весь экран', 10000);
            });
        }
    }
    /* Браузер (компьютер, телефон, планшет): поле поиска и ввода — обычное (loader.js ставит системную клавиатуру).
     * Печать с клавиатуры сразу идёт в открытое поле — кликать в него не надо; на компьютере поиск открывается уже
     * с курсором в поле. На ТВ (пульт) — ничего не меняем. */
    function webKeys() {
        if (typeof bsIsTv !== 'function' || bsIsTv()) return;
        var field = function () { var f = $('.simple-keyboard-input:visible'); return f.length ? f[f.length - 1] : null; };
        var busy = function () {
            var a = document.activeElement;
            return a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
        };
        document.addEventListener('keydown', function (e) {
            if (e.ctrlKey || e.metaKey || e.altKey || !e.key || e.key.length !== 1 || busy()) return;
            var f = field();
            if (f) try { f.focus(); } catch (x) {}
        }, true);
        var touch = 'ontouchstart' in window && navigator.maxTouchPoints > 0;   // на телефоне не открываем клавиатуру сами
        if (touch || !Lampa.Controller || !Lampa.Controller.listener) return;
        Lampa.Controller.listener.follow('toggle', function (e) {
            if (e.name !== 'keybord') return;
            setTimeout(function () { var f = field(); if (f && !busy()) try { f.focus(); } catch (x) {} }, 100);
        });
    }
    function iphone() { try { return /iPhone|iPod/.test(navigator.userAgent || ''); } catch (e) { return false; } }

    function start() {
        try { keyboardWrap(); } catch (e) { console.log('BS keyboard wrap', e.message); }
        try { fullscreenButton(); } catch (e) {}
        try { webKeys(); } catch (e) {}
        try { noticesAbovePanel(); } catch (e) {}
        try { lazyYouTube(); } catch (e) {}
        try { installFastStart(); } catch (e) { console.log('BS fast start', e.message); }
        setTimeout(statPing, 15000);                                // после запуска, чтобы не мешать ему
        setInterval(function () { try { if (!document.hidden) statPing(); } catch (e) {} }, 600000);
        try { addSettings(); } catch (e) { console.log('BS features settings', e.message); }
        iptvLook();
        setTimeout(function () { try { iptvAuto(); iptvMenuOff(); iptvUrlsFix(); iptvFresh(); iptvProbe(); iptvSeed(); } catch (e) {} }, 8000);   // IPTV по умолчанию: два списка, зеркало, подсадка
        registerColorKeys();
        document.addEventListener('keydown', onColorKey, true);
        try {
            Lampa.PlayerVideo.listener.follow('ended', function () {
                if (sleepEpisode) { sleepEpisode = false; setTimeout(sleepFire, 500); }
            });
            // Автопропуск титров (метки Skaz) и «Следующая серия» включают следующую без 'ended' — ловим её старт.
            Lampa.Player.listener.follow('start', function () {
                if (sleepEpisode) { sleepEpisode = false; setTimeout(sleepFire, 500); }
                setTimeout(sleepButton, 300);
            });
        } catch (e) {}
    }

    return {
        _iptvToggle: iptvToggle, _iptvLists: IPTV_LISTS, _iptvFix: iptvFix, _iptvInstalled: iptvInstalled, _iptvAuto: iptvAuto, _iptvMenuOff: iptvMenuOff, _iptvGroup: iptvGroup, _iptvChannel: iptvChannel, _iptvLook: iptvLook,
        _iptvSource: iptvSourceSet, _iptvDefault: IPTV_DEFAULT, _iptvUrl: iptvUrl, _iptvParse: iptvParse, _iptvParseRun: iptvParseRun, _iptvAlt: iptvAlt, _iptvAltIndex: iptvAltIndex, _iptvNormName: iptvNormName,
        start: start, _kbWrapTarget: keyboardWrapTarget, _kbWrap: keyboardWrap, _freshUrl: freshUrl, _localVender: localVender, _sleepSet: sleepSet, _sleepLabel: sleepLabel, _sleepNext: sleepNext, _sleepMode: sleepMode };
})();
