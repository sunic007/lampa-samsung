/*
 * Где запущена Lampa — одно место для всех модулей, чтобы настройки и подсказки говорили только правду об устройстве.
 *
 *  - samsungApp(): наше приложение .wgt на ТВ Samsung (есть tizen.application) — может закрыться само, громкость ТВ,
 *    панель Smart Hub;
 *  - samsung():    любой ТВ Samsung — приложение или Media Station X (браузер ТВ без tizen) — подсказки про меню Samsung;
 *  - tv():         телевизор или приставка, которыми управляют пультом (Samsung, LG webOS, Android TV, Fire TV, VIDAA…):
 *    «пульт», цветные кнопки;
 *  - tvPlayer():   играет плеер ТВ Samsung (AVPlay) — буфер, быстрый старт;
 *  - kind():       'samsung-app' | 'tv' | 'android' | 'browser' — для отчёта и журнала.
 * Всё считается при вызове: Android-плагин ставит BS_ANDROID до запуска модулей, игрок меняется в настройках Lampa.
 */
var BSDevice = (function () {
    var TV_UA = /Tizen|SMART-TV|SmartTV|Web0S|webOS|NetCast|HbbTV|VIDAA|Android TV|GoogleTV|AFT|BRAVIA|CrKey|AppleTV/i;

    function ua() { try { return String(navigator.userAgent || ''); } catch (e) { return ''; } }
    function samsungApp() { try { return typeof tizen !== 'undefined' && !!tizen.application; } catch (e) { return false; } }
    function samsung() { return samsungApp() || /Tizen|SMART-TV/i.test(ua()); }
    function touch() { try { return 'ontouchstart' in window || (navigator.maxTouchPoints | 0) > 0; } catch (e) { return false; } }
    function tv() {
        if (samsung() || TV_UA.test(ua())) return true;
        // Android-приставка без сенсора (WebView Lampa ТВ-сборок не всегда пишет «Android TV» в UA)
        return !!window.BS_ANDROID && !touch();
    }
    function tvPlayer() {
        try { return Lampa.Platform.is('tizen') && Lampa.Storage.field('player') === 'tizen'; } catch (e) { return false; }
    }
    function kind() { return samsungApp() ? 'samsung-app' : tv() ? 'tv' : window.BS_ANDROID ? 'android' : 'browser'; }

    return { samsungApp: samsungApp, samsung: samsung, tv: tv, tvPlayer: tvPlayer, kind: kind };
})();
