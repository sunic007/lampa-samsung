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
            field: { name: 'Пропускать рекламу перед фильмом', description: 'Без рекламы перед фильмом. Lampa перезапустится.' },
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

    function start() {
        try { keyboardWrap(); } catch (e) { console.log('BS keyboard wrap', e.message); }
        try { noticesAbovePanel(); } catch (e) {}
        try { lazyYouTube(); } catch (e) {}
        try { installFastStart(); } catch (e) { console.log('BS fast start', e.message); }
        try { addSettings(); } catch (e) { console.log('BS features settings', e.message); }
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

    return { start: start, _kbWrapTarget: keyboardWrapTarget, _kbWrap: keyboardWrap, _freshUrl: freshUrl, _localVender: localVender, _sleepSet: sleepSet, _sleepLabel: sleepLabel, _sleepNext: sleepNext, _sleepMode: sleepMode };
})();
