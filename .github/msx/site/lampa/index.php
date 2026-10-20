<?php
/*
 * Lampa «Sunic Apps» для Media Station X (sunic.stream — хостинг в Узбекистане, не Cloudflare: его диапазоны у
 * провайдеров блокируют). MSX открывает эту страницу сразу при старте (msx/start.json → "action": "link:…").
 * Сервер отдаёт index.html последнего выпуска (version.json в main) с <base> на jsDelivr по тегу — файлы оттуда же.
 * Обычной страницей, не document.write: Lampa тогда правильно считает размеры экрана. Обновлять не нужно — новые
 * выпуски приходят сами. Только http: источники Skaz работают по http.
 */
const GH = 'https://raw.githubusercontent.com/sunic007/lampa-samsung/main/version.json';
const CDN = 'https://cdn.jsdelivr.net/gh/sunic007/lampa-samsung@v';
const PIN = '2.3.4';    // если GitHub не ответил и ничего не запомнено
const LIFE = 600;       // версию и страницу держим 10 минут

function fetch_url($u) {
    $c = curl_init($u);
    curl_setopt_array($c, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => 10,
        CURLOPT_USERAGENT => 'sunic.stream']);
    $b = curl_exec($c);
    $ok = curl_getinfo($c, CURLINFO_HTTP_CODE) === 200;
    curl_close($c);
    return $ok ? $b : '';
}

$cache = __DIR__ . '/.cache';
if (!is_dir($cache)) @mkdir($cache, 0700);
$vf = $cache . '/version';
$v = is_file($vf) ? trim(file_get_contents($vf)) : '';
if (!$v || time() - filemtime($vf) > LIFE) {
    $j = json_decode(fetch_url(GH . '?t=' . time()), true);
    // GitHub не ответил — тот же version.json с jsDelivr (ветка main)
    if (!is_array($j)) $j = json_decode(fetch_url('https://cdn.jsdelivr.net/gh/sunic007/lampa-samsung@main/version.json'), true);
    if (is_array($j) && preg_match('/^\d+\.\d+\.\d+$/', $j['version'] ?? '')) { $v = $j['version']; @file_put_contents($vf, $v); }
    elseif ($v) @touch($vf);            // GitHub не ответил — прежняя версия ещё на 10 минут
}
if (!$v) $v = PIN;

$pf = $cache . '/page-' . $v . '.html';
$html = is_file($pf) ? file_get_contents($pf) : '';
if (!$html) {
    $html = fetch_url(CDN . $v . '/src/index.html');
    if ($html) @file_put_contents($pf, $html);
}
if (!$html) {
    http_response_code(503);
    header('Content-Type: text/html; charset=utf-8');
    echo '<body style="background:#1d1f20;color:#fff;font:28px sans-serif;padding:60px">Нет связи с GitHub/jsDelivr — откройте снова через минуту.</body>';
    exit;
}

// В MSX нет API Samsung (window.tizen): плеер «Tizen» (AVPlay) не запустится — встроенный плеер Lampa (loader.js на
// первом запуске ставит «tizen», если bs_player_default нет — ставим раньше). Ошибки файлов с jsDelivr браузер отдаёт без
// текста («Script error.») — Lampa показывала бы их уведомлением, понять по нему нечего: глушим только такие.
$head = '<base href="' . CDN . $v . '/src/">' . "\n    <script>"
    // страница и так всегда последнего выпуска — своё обновление модулей (update.js: окно «Вышло обновление») не нужно
    . '(function () { try { localStorage.setItem("bs_gh_update", "false"); } catch (x) {} })();'
    . '(function () { if (window.tizen) return; try { localStorage.setItem("bs_player_default", "1");'
    . ' ["player", "player_iptv"].forEach(function (k) { var p = localStorage.getItem(k); if (!p || p === "tizen") localStorage.setItem(k, "inner"); });'
    . ' } catch (x) {} })();'
    // <base> на jsDelivr: Lampa пишет в историю «?card=…» — браузер считал бы это адресом jsDelivr и запрещал
    // (SecurityError, карточка не открывается). Относительные адреса истории — от адреса страницы, не от <base>.
    . ' (function () { var h = window.history; if (!h || !h.pushState) return; ["pushState", "replaceState"].forEach(function (m) {'
    . ' var o = h[m]; h[m] = function (s, t, u) { if (typeof u === "string" && !/^[a-z]+:/i.test(u)) {'
    // Lampa с <base> пишет «/?card=…» — от корня сайта; у нас она в /lampa/
    . ' var p = location.pathname; if (/^\/[?#]/.test(u)) u = u.slice(1);'
    . ' u = location.origin + (u.charAt(0) === "?" ? p + u : u.charAt(0) === "#" ? p + location.search + u : u.charAt(0) === "/" ? u : p + u); }'
    . ' return o.call(h, s, t, u); }; }); })();'
    . ' window.addEventListener("error", function (e) { if (!e.lineno && /^Script error\.?$/i.test(e.message || "")) {'
    . ' try { e.stopImmediatePropagation(); } catch (x) {} } }, true);</script>';
$html = preg_replace('/<head>/', "<head>\n    " . $head, $html, 1);
$html = preg_replace('#<script src="\$WEBAPIS/webapis/webapis\.js"></script>#', '', $html);   // только у установленного .wgt
$html = str_replace('<title>Lampa</title>', '<title>Lampa · Sunic Apps</title>', $html);

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-cache');
echo $html;
