<?php
/*
 * Запасное зеркало обновлений: sunic.stream/gh/sunic007/<репо>@<v1.2.3|main>/<путь> — те же адреса, что у jsDelivr.
 * ТВ и Android-плагин идут сюда последними, когда у человека закрыты GitHub и jsDelivr (сервер в Узбекистане их видит).
 * Выпуск Lampa для Samsung, уже скачанный на хостинг (lampa/v/X.Y.Z/), отдаём с диска; остальное — с jsDelivr
 * или GitHub, небольшие файлы кешируем. Только наши два репозитория и обычные пути файлов, только чтение.
 */
const REPOS = ['lampa-samsung' => 1, 'lampa-android' => 1];
const LIFE_MAIN = 600;              // @main меняется — 10 минут; @vX.Y.Z не меняется никогда
const MAX = 3 * 1024 * 1024;

$repo = $_GET['repo'] ?? ''; $ref = $_GET['ref'] ?? ''; $path = $_GET['path'] ?? '';
if (!isset(REPOS[$repo]) || !preg_match('/^(v\d+\.\d+\.\d+|main)$/', $ref)
    || !preg_match('#^[A-Za-z0-9_./-]{1,200}$#', $path) || strpos($path, '..') !== false || $path[0] === '/') {
    http_response_code(404); exit;
}
$types = ['js' => 'application/javascript', 'json' => 'application/json', 'css' => 'text/css', 'html' => 'text/html',
    'png' => 'image/png', 'svg' => 'image/svg+xml', 'woff2' => 'font/woff2', 'woff' => 'font/woff', 'mp3' => 'audio/mpeg', 'lampa' => 'text/plain'];
$ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
$type = $types[$ext] ?? 'application/octet-stream';

function rrmdir($d) {
    foreach (scandir($d) ?: [] as $f) { if ($f === '.' || $f === '..') continue; $p = "$d/$f"; is_dir($p) ? rrmdir($p) : @unlink($p); }
    @rmdir($d);
}

function send($file, $type, $ref) {
    header('Content-Type: ' . $type . (strpos($type, 'image/') === 0 || strpos($type, 'font/') === 0 ? '' : '; charset=utf-8'));
    header('Access-Control-Allow-Origin: *');
    header($ref === 'main' ? 'Cache-Control: no-cache' : 'Cache-Control: public, max-age=31536000, immutable');
    header('Content-Length: ' . filesize($file));
    readfile($file);
    exit;
}

// 1. выпуск Samsung уже на хостинге
if ($repo === 'lampa-samsung' && $ref !== 'main' && strpos($path, 'src/') === 0) {
    $local = __DIR__ . '/lampa/v/' . substr($ref, 1);
    $f = $local . '/' . substr($path, 4);
    if (is_file("$local/.complete") && is_file($f)) send($f, $type, $ref);
}

// 2. кеш и источники
$dir = __DIR__ . '/lampa/.cache/gh';
$cache = $dir . '/' . $repo . '@' . $ref . '/' . $path;
$fresh = is_file($cache) && ($ref !== 'main' || time() - filemtime($cache) < LIFE_MAIN);
if (!$fresh) {
    $from = ["https://cdn.jsdelivr.net/gh/sunic007/$repo@$ref/$path", 'https://raw.githubusercontent.com/sunic007/' . $repo . '/' . $ref . '/' . $path];
    foreach ($from as $u) {
        $h = curl_init($u);
        curl_setopt_array($h, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_FOLLOWLOCATION => true, CURLOPT_USERAGENT => 'sunic.stream mirror']);
        $b = curl_exec($h);
        $ok = curl_getinfo($h, CURLINFO_HTTP_CODE) === 200 && is_string($b) && strlen($b) <= MAX;
        curl_close($h);
        if (!$ok) continue;
        @mkdir(dirname($cache), 0755, true);
        if (@file_put_contents($cache . '.tmp', $b) !== false) @rename($cache . '.tmp', $cache);
        if (!is_file($cache)) { header('Content-Type: ' . $type); header('Access-Control-Allow-Origin: *'); echo $b; exit; }
        break;
    }
    if (is_file($cache) && $ref === 'main') @touch($cache);   // GitHub не ответил — старая копия ещё 10 минут
}
if (is_file($cache)) {
    // раз в сутки убираем из кеша выпуски, к которым не обращались неделю
    if (mt_rand(1, 200) === 1) {
        foreach (glob($dir . '/*@v*', GLOB_ONLYDIR) ?: [] as $d) {
            if (time() - filemtime($d) > 7 * 86400) rrmdir($d);
        }
    }
    @touch($dir . '/' . $repo . '@' . $ref);
    send($cache, $type, $ref);
}
http_response_code(404);
