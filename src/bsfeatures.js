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
            field: { name: 'IPTV: открытые плейлисты', description: 'Каналы для расширения IPTV — выбрать и добавить' },
            onChange: iptvChoose
        });
    }

    /* ---------- IPTV: открытые плейлисты ----------
     * Расширение IPTV (cub.red/plugin/iptv) приходит без плейлистов. Свои оно хранит в iptv_playlist_custom —
     * {id, custom, url, name}, так же, как его кнопка «Добавить плейлист». Здесь — выбор из открытых каталогов
     * бесплатных каналов: iptv-org (страны, языки, темы) и Free-TV (только официальные бесплатные трансляции).
     * Наши записи — с id «sunic-iptv-…»: повторное нажатие убирает только их, чужие плейлисты не трогаем. */
    var IPTV_ORG = 'https://iptv-org.github.io/iptv/';
    var IPTV_LISTS = [
        ['uz', 'Узбекистан', IPTV_ORG + 'countries/uz.m3u'],
        ['rus', 'На русском языке', IPTV_ORG + 'languages/rus.m3u'],
        ['ru', 'Россия', IPTV_ORG + 'countries/ru.m3u'],
        ['kz', 'Казахстан', IPTV_ORG + 'countries/kz.m3u'],
        ['tr', 'Турция', IPTV_ORG + 'countries/tr.m3u'],
        ['movies', 'Фильмы (весь мир)', IPTV_ORG + 'categories/movies.m3u'],
        ['series', 'Сериалы (весь мир)', IPTV_ORG + 'categories/series.m3u'],
        ['kids', 'Детские (весь мир)', IPTV_ORG + 'categories/kids.m3u'],
        ['animation', 'Мультфильмы (весь мир)', IPTV_ORG + 'categories/animation.m3u'],
        ['documentary', 'Документальные (весь мир)', IPTV_ORG + 'categories/documentary.m3u'],
        ['sports', 'Спорт (весь мир)', IPTV_ORG + 'categories/sports.m3u'],
        ['music', 'Музыка (весь мир)', IPTV_ORG + 'categories/music.m3u'],
        ['news', 'Новости (весь мир)', IPTV_ORG + 'categories/news.m3u'],
        ['freetv', 'Официальные бесплатные каналы (Free-TV)', 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8']
    ];
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
        if (added) list.push({ id: 'sunic-iptv-' + key, custom: true, url: it[2], name: it[1] });
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
        if (!p.update_time) p.update_time = 0;                      // давно не обновлялся — скачает при открытии
        return p;
    }
    function iptvFresh() {
        var mine = [], l = iptvList(), i;
        for (i = 0; i < l.length; i++) if (l[i] && /^sunic-iptv-/.test(l[i].id)) mine.push(l[i].id);
        if (!mine.length) return;
        for (i = 0; i < mine.length; i++) {
            try { var k = 'iptv_playlist_params_' + mine[i], p = iptvFix(Lampa.Storage.get(k, '{}')); if (p) Lampa.Storage.set(k, p); } catch (e) {}
        }
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
    /* По умолчанию (один раз, метка bs_iptv_auto): ставим расширение IPTV и кладём в него все открытые плейлисты —
     * человек открывает IPTV и сразу выбирает. Убрал расширение или плейлист сам — больше не возвращаем. */
    function iptvAuto() {
        if (lsGet('bs_iptv_auto')) return;
        var l = iptvList(), i, had = false;
        for (i = 0; i < l.length; i++) if (l[i] && /^sunic-iptv-/.test(l[i].id)) had = true;
        if (!had) {
            for (i = 0; i < IPTV_LISTS.length; i++) l.push({ id: 'sunic-iptv-' + IPTV_LISTS[i][0], custom: true, url: IPTV_LISTS[i][2], name: IPTV_LISTS[i][1] });
            try { Lampa.Storage.set('iptv_playlist_custom', l); } catch (e) {}
        }
        iptvFresh();
        if (!iptvInstalled()) {
            var dom = 'cub.red';
            try { dom = Lampa.Manifest.cub_domain || dom; } catch (e) {}
            try { Lampa.Plugins.add({ url: 'https://' + dom + '/plugin/iptv', status: 1, name: 'IPTV', author: '@lampa' }); } catch (e) { return; }
        }
        lsSet('bs_iptv_auto', '1');
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
                noty(added ? 'Добавлен: ' + a.title.replace(/^✓ /, '') + (iptvInstalled() ? ' — откройте IPTV' : ' — установите расширение IPTV (Настройки → Расширения)')
                    : 'Убран: ' + a.title.replace(/^✓ /, ''), 5000);
                iptvChoose();                                           // список снова, с новыми отметками
            },
            onBack: function () { try { Lampa.Controller.toggle(ctrl); } catch (e) {} }
        });
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
    function iphone() { try { return /iPhone|iPod/.test(navigator.userAgent || ''); } catch (e) { return false; } }

    function start() {
        try { keyboardWrap(); } catch (e) { console.log('BS keyboard wrap', e.message); }
        try { fullscreenButton(); } catch (e) {}
        try { noticesAbovePanel(); } catch (e) {}
        try { lazyYouTube(); } catch (e) {}
        try { installFastStart(); } catch (e) { console.log('BS fast start', e.message); }
        try { addSettings(); } catch (e) { console.log('BS features settings', e.message); }
        setTimeout(function () { try { iptvAuto(); iptvFresh(); } catch (e) {} }, 8000);   // IPTV по умолчанию; плейлисты 2.3.24 — тоже «каждый день»
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
        _iptvToggle: iptvToggle, _iptvLists: IPTV_LISTS, _iptvFix: iptvFix, _iptvInstalled: iptvInstalled, _iptvAuto: iptvAuto, start: start, _kbWrapTarget: keyboardWrapTarget, _kbWrap: keyboardWrap, _freshUrl: freshUrl, _localVender: localVender, _sleepSet: sleepSet, _sleepLabel: sleepLabel, _sleepNext: sleepNext, _sleepMode: sleepMode };
})();
