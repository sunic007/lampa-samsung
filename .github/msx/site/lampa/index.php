<?php
/*
 * Lampa «Sunic Apps» для Media Station X и браузера (sunic.stream — хостинг в Узбекистане, не Cloudflare: его диапазоны у
 * провайдеров блокируют). MSX открывает эту страницу сразу при старте (msx/start.json → "action": "link:…").
 *
 * Файлы — на этом же хостинге: lampa/v/<версия>/ — копия src последнего выпуска (без службы Tizen). Раз в 10 минут —
 * version.json на GitHub (или jsDelivr); вышла новая — сервер сам докачивает её после ответа (в фоне), а пока работает
 * прежняя. Держим две версии (новая и прошлая). Своей копии ещё нет (первый запуск) — файлы с jsDelivr (<base>).
 * Обновлять этот файл не нужно. По http и https: источники Skaz — только по http (их серверы https не умеют).
 */
const REPO = 'sunic007/lampa-samsung';
const GH = 'https://raw.githubusercontent.com/' . REPO . '/main/version.json';
const CDN = 'https://cdn.jsdelivr.net/gh/' . REPO . '@v';
const PIN = '2.3.17';   // если GitHub не ответил и ничего не запомнено
const LIFE = 600;       // версию проверяем раз в 10 минут
const KEEP = 2;         // версий на хостинге

function fetch_url($u, $timeout = 10) {
    $c = curl_init($u);
    curl_setopt_array($c, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => $timeout,
        CURLOPT_USERAGENT => 'sunic.stream']);
    $b = curl_exec($c);
    $ok = curl_getinfo($c, CURLINFO_HTTP_CODE) === 200;
    curl_close($c);
    return $ok ? $b : false;
}
function ok_ver($v) { return is_string($v) && preg_match('/^\d+\.\d+\.\d+$/', $v); }

$cache = __DIR__ . '/.cache';
$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
// «Открыть по http» с главной (/lampa/?http=1): человек сам выбрал страницу без защиты ради Skaz — браузер, который
// поднял адрес до https, отправляем обратно на http (Chrome и Vivaldi один раз спросят, открыть ли сайт без защиты)
if ($https && isset($_GET['http'])) {
    header('Location: http://' . preg_replace('/[^A-Za-z0-9.-]/', '', $_SERVER['HTTP_HOST'] ?? 'sunic.stream') . '/lampa/?http=1', true, 302);
    header('Cache-Control: no-store');
    exit;
}

$store = __DIR__ . '/v';
if (!is_dir($cache)) @mkdir($cache, 0700);
if (!is_dir($store)) @mkdir($store, 0755);

/* ---------- какая версия последняя ---------- */
$vf = $cache . '/version';
$v = is_file($vf) ? trim(file_get_contents($vf)) : '';
if (!ok_ver($v) || time() - filemtime($vf) > LIFE) {
    $j = json_decode((string) fetch_url(GH . '?t=' . time()), true);
    if (!is_array($j)) $j = json_decode((string) fetch_url('https://cdn.jsdelivr.net/gh/' . REPO . '@main/version.json'), true);
    if (is_array($j) && ok_ver($j['version'] ?? '')) { $v = $j['version']; @file_put_contents($vf, $v); }
    elseif (ok_ver($v)) @touch($vf);    // GitHub не ответил — прежняя версия ещё на 10 минут
}
if (!ok_ver($v)) $v = PIN;

/* ---------- своя копия выпуска ---------- */
function ready($store, $ver) { return ok_ver($ver) && is_file("$store/$ver/.complete"); }
/** Список файлов src выпуска: GitHub API, иначе jsDelivr. [путь => размер] */
function release_files($ver) {
    // список файлов выпуска не меняется — запоминаем: иначе каждый запрос спрашивал бы GitHub (лимит 60 в час с адреса
    // хостинга), а долгий ответ съедал бы 30 с, что хостинг даёт PHP, — и до скачивания дело не доходило
    $memo = __DIR__ . '/.cache/files-' . $ver . '.json';
    $m = is_file($memo) ? json_decode((string) file_get_contents($memo), true) : null;
    if (is_array($m) && count($m) >= 20) return $m;
    $out = [];
    $t = json_decode((string) fetch_url('https://api.github.com/repos/' . REPO . '/git/trees/v' . $ver . '?recursive=1', 8), true);
    if (is_array($t) && !empty($t['tree'])) {
        foreach ($t['tree'] as $f) if (($f['type'] ?? '') === 'blob' && strpos($f['path'], 'src/') === 0) $out[substr($f['path'], 4)] = (int) ($f['size'] ?? 0);
    } else {
        $d = json_decode((string) fetch_url('https://data.jsdelivr.com/v1/packages/gh/' . REPO . '@v' . $ver . '?structure=flat', 8), true);
        foreach (($d['files'] ?? []) as $f) if (strpos($f['name'], '/src/') === 0) $out[substr($f['name'], 5)] = (int) ($f['size'] ?? 0);
    }
    // служба Tizen, проект Tizen Studio и config.xml странице не нужны
    foreach (array_keys($out) as $p) if (preg_match('#^(service/|\.tproject|config\.xml$)#', $p)) unset($out[$p]);
    if (count($out) >= 20) @file_put_contents($memo, json_encode($out));
    return $out;
}
/** Скачать выпуск в v/<версия>/ (сначала во временную папку). true — готово. */
function sync_release($store, $cache, $ver) {
    $lock = fopen($cache . '/sync.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) return false;    // уже качаем в другом запросе
    $files = release_files($ver);
    if (count($files) < 20 || !isset($files['index.html'], $files['app.js'], $files['loader.js'])) return false;
    $tmp = "$store/.tmp-$ver";
    @mkdir($tmp, 0755, true);
    /* Хостинг обрывает PHP через 30 с (и после ответа тоже) — качаем пачками по 12 файлов параллельно и следим за
     * временем: не успели — остальное докачает следующий запрос (готовые файлы не перекачиваются). */
    $t0 = microtime(true);
    $todo = [];
    foreach ($files as $p => $size) {
        if (!preg_match('#^[A-Za-z0-9_./ -]+$#', $p) || strpos($p, '..') !== false) continue;   // только обычные пути
        if (is_file("$tmp/$p") && filesize("$tmp/$p") === $size) continue;                   // уже скачан
        $todo[$p] = $size;
    }
    $url = function ($base, $p) { return $base . str_replace('%2F', '/', rawurlencode($p)); };
    foreach (array_chunk($todo, 12, true) as $chunk) {
        if (microtime(true) - $t0 > 20) return false;                                        // время на исходе — в следующий раз
        $mh = curl_multi_init(); $hs = [];
        foreach ($chunk as $p => $size) {
            // сначала GitHub: jsDelivr свежий тег отдаёт минутами (503, пока не прогреет кеш); он — запасной
            $h = curl_init($url('https://raw.githubusercontent.com/' . REPO . '/v' . $ver . '/src/', $p));
            curl_setopt_array($h, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => 15, CURLOPT_USERAGENT => 'sunic.stream']);
            curl_multi_add_handle($mh, $h); $hs[$p] = $h;
        }
        do { $st = curl_multi_exec($mh, $run); if ($run) curl_multi_select($mh, 1); } while ($run && $st === CURLM_OK);
        foreach ($hs as $p => $h) {
            $b = curl_getinfo($h, CURLINFO_HTTP_CODE) === 200 ? curl_multi_getcontent($h) : false;
            curl_multi_remove_handle($mh, $h); curl_close($h);
            if ($b === false || ($chunk[$p] && strlen($b) !== $chunk[$p])) $b = microtime(true) - $t0 < 20 ? fetch_url($url(CDN . $ver . '/src/', $p), 8) : false;
            if ($b === false || ($chunk[$p] && strlen($b) !== $chunk[$p])) continue;           // в следующий раз докачаем
            @mkdir(dirname("$tmp/$p"), 0755, true);
            file_put_contents("$tmp/$p", $b);
        }
        curl_multi_close($mh);
    }
    foreach ($todo as $p => $size) if (!is_file("$tmp/$p") || filesize("$tmp/$p") !== $size) return false;   // не всё — докачаем
    // в папке выпусков PHP не выполняется — только файлы Lampa
    file_put_contents("$tmp/.htaccess", "RemoveHandler .php .phtml\nRemoveType .php .phtml\n<FilesMatch \"\\.(php|phtml|phar)$\">\n    Require all denied\n</FilesMatch>\n# файлы выпуска не меняются — кеш браузера надолго\n<IfModule mod_headers.c>\n    Header set Cache-Control \"public, max-age=31536000, immutable\"\n</IfModule>\n");
    file_put_contents("$tmp/.complete", date('c'));
    if (is_dir("$store/$ver")) rrmdir("$store/$ver");
    rename($tmp, "$store/$ver");
    // старые версии — прочь (держим KEEP новейших)
    $vers = array_values(array_filter(scandir($store), 'ok_ver'));
    usort($vers, 'version_compare');
    foreach (array_slice($vers, 0, max(0, count($vers) - KEEP)) as $old) rrmdir("$store/$old");
    return true;
}
function rrmdir($d) {
    foreach (array_diff(scandir($d), ['.', '..']) as $f) is_dir("$d/$f") && !is_link("$d/$f") ? rrmdir("$d/$f") : @unlink("$d/$f");
    @rmdir($d);
}

$serve = '';
if (ready($store, $v)) $serve = $v;
else {
    $vers = array_values(array_filter(scandir($store), function ($x) use ($store) { return ready($store, $x); }));
    usort($vers, 'version_compare');
    if ($vers) $serve = end($vers);                    // пока новая качается — прежняя своя
}

if ($serve) {
    $html = (string) @file_get_contents("$store/$serve/index.html");
    $base = '/lampa/v/' . $serve . '/';
} else {                                               // своей копии ещё нет — с jsDelivr
    $pf = $cache . '/page-' . $v . '.html';
    $html = is_file($pf) ? file_get_contents($pf) : '';
    if (!$html) { $html = (string) fetch_url(CDN . $v . '/src/index.html'); if ($html) @file_put_contents($pf, $html); }
    $base = CDN . $v . '/src/';
}
if (!$html) {
    http_response_code(503);
    header('Content-Type: text/html; charset=utf-8');
    echo '<body style="background:#1d1f20;color:#fff;font:28px sans-serif;padding:60px">Нет связи с GitHub/jsDelivr — откройте снова через минуту.</body>';
    exit;
}

// В MSX нет API Samsung (window.tizen): плеер «Tizen» (AVPlay) не запустится — встроенный плеер Lampa (loader.js на
// первом запуске ставит «tizen», если bs_player_default нет — ставим раньше). Файлы с jsDelivr (первый запуск): их ошибки
// браузер отдаёт без текста («Script error.») — Lampa показывала бы их уведомлением, понять по нему нечего: глушим такие.
// referrer — в самой странице: хостинг дописывает свой, слабее нашего из .htaccess, и браузер берёт последний заголовок
$head = '<meta name="referrer" content="no-referrer">' . "\n    " . '<base href="' . $base . '">' . "\n    <script>"
    // страница и так всегда последнего выпуска — своё обновление модулей (update.js: окно «Вышло обновление») не нужно
    . '(function () { try { localStorage.setItem("bs_gh_update", "false"); } catch (x) {} })();'
    // версия Sunic Apps этой страницы — для «Обновление» (на сайте нет пакета .wgt, откуда её берёт ТВ)
    . 'window.BS_SITE_VERSION = ' . json_encode($serve ?: $v) . ';'
    . '(function () { if (window.tizen) return; try { localStorage.setItem("bs_player_default", "1");'
    . ' ["player", "player_iptv"].forEach(function (k) { var p = localStorage.getItem(k); if (!p || p === "tizen") localStorage.setItem(k, "inner"); });'
    . ' } catch (x) {} })();'
    // <base>: Lampa пишет в историю «/?card=…» от корня или от <base> — адрес истории всегда от этой страницы
    // (иначе SecurityError на jsDelivr или переход на корень сайта)
    . ' (function () { var h = window.history; if (!h || !h.pushState) return; ["pushState", "replaceState"].forEach(function (m) {'
    . ' var o = h[m]; h[m] = function (s, t, u) { if (typeof u === "string" && !/^[a-z]+:/i.test(u)) {'
    . ' var p = location.pathname; if (/^\/[?#]/.test(u)) u = u.slice(1);'
    . ' u = location.origin + (u.charAt(0) === "?" ? p + u : u.charAt(0) === "#" ? p + location.search + u : u.charAt(0) === "/" ? u : p + u); }'
    . ' return o.call(h, s, t, u); }; }); })();'
    . ' window.addEventListener("error", function (e) { if (!e.lineno && /^Script error\.?$/i.test(e.message || "")) {'
    . ' try { e.stopImmediatePropagation(); } catch (x) {} } }, true);</script>';
$html = preg_replace('/<head>/', "<head>\n    " . $head, $html, 1);
$html = preg_replace('#<script src="\$WEBAPIS/webapis/webapis\.js"></script>#', '', $html);   // только у установленного .wgt
$html = str_replace('<title>Lampa</title>', '<title>Lampa · Sunic Apps</title>', $html);

// ответ — сразу; докачка новой версии — после него, человек не ждёт
// По https браузер сам переводит запросы страницы на https: что умеет https (Z01, Online Mod, CUB) — грузится, чего нет
// (Skaz, локальные адреса ТВ) — просто не отвечает, без «Не защищено». По http (ТВ, Media Station X) — ничего не меняется.
if ($https) header('Content-Security-Policy: upgrade-insecure-requests');
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-cache');
header('Content-Length: ' . strlen($html));
header('Connection: close');
echo $html;
if ($serve === $v) exit;
ignore_user_abort(true);
@set_time_limit(900);
if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
else { @ob_end_flush(); flush(); }
sync_release($store, $cache, $v);
