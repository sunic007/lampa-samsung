<?php
/*
 * Запасное зеркало обновлений: sunic.stream/gh/sunic007/<репо>@<v1.2.3|main>/<путь> — те же адреса, что у jsDelivr.
 * ТВ и Android-плагин идут сюда последними, когда у человека закрыты GitHub и jsDelivr (сервер в Узбекистане их видит).
 * Выпуск Lampa для Samsung, уже скачанный на хостинг (lampa/v/X.Y.Z/), отдаём с диска; остальное — с jsDelivr
 * Ветка epg — программа передач «Телеканалов» (index.json, c/<канал>.json): в кеше на час.
 * или GitHub (ветку main — в кеше на 10 минут). Только наши два репозитория, только version.json, src/ и docs/sunic.js.
 */
const REPOS = ['lampa-samsung' => 1, 'lampa-android' => 1];
const LIFE_MAIN = 600;              // @main меняется — 10 минут; @vX.Y.Z не меняется никогда
const LIFE_EPG = 3600;              // @epg — раз в день, час в кеше хватает
const MAX = 3 * 1024 * 1024;

$repo = $_GET['repo'] ?? ''; $ref = $_GET['ref'] ?? ''; $path = $_GET['path'] ?? '';
$epg = $ref === 'epg';
if (!isset(REPOS[$repo]) || !preg_match('/^(v\d+\.\d+\.\d+|main|epg)$/', $ref)
    || ($epg ? $repo !== 'lampa-samsung' || !preg_match('#^(index\.json|c/[A-Za-z0-9_-]{1,70}\.json)$#', $path)
        : !preg_match('#^(version\.json|docs/sunic\.js|src/[A-Za-z0-9_./-]{1,200})$#', $path)) || strpos($path, '..') !== false) {
    http_response_code(404); exit;
}
$types = ['js' => 'application/javascript', 'json' => 'application/json', 'css' => 'text/css', 'html' => 'text/html',
    'png' => 'image/png', 'svg' => 'image/svg+xml', 'woff2' => 'font/woff2', 'woff' => 'font/woff', 'mp3' => 'audio/mpeg', 'lampa' => 'text/plain'];
$ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
$type = $types[$ext] ?? 'application/octet-stream';

function send($body, $type, $ref) {
    header('Content-Type: ' . $type . (strpos($type, 'image/') === 0 || strpos($type, 'font/') === 0 ? '' : '; charset=utf-8'));
    header('Access-Control-Allow-Origin: *');
    header($ref === 'main' || $ref === 'epg' ? 'Cache-Control: no-cache' : 'Cache-Control: public, max-age=31536000, immutable');
    header('Content-Length: ' . strlen($body));
    echo $body;
    exit;
}

// 1. выпуск Samsung уже на хостинге
if ($repo === 'lampa-samsung' && $ref !== 'main' && strpos($path, 'src/') === 0) {
    $local = __DIR__ . '/lampa/v/' . substr($ref, 1);
    $f = $local . '/' . substr($path, 4);
    if (is_file("$local/.complete") && is_file($f)) send(file_get_contents($f), $type, $ref);
}

// 2. с jsDelivr или GitHub. На диск — только @main (несколько файлов, 10 минут): выпуски @vX.Y.Z не кешируем, иначе
//    перебором всех тегов и файлов можно забить диск хостинга
function fetch_from($repo, $ref, $path) {
    foreach (["https://cdn.jsdelivr.net/gh/sunic007/$repo@$ref/$path", "https://raw.githubusercontent.com/sunic007/$repo/$ref/$path"] as $u) {
        $h = curl_init($u);
        curl_setopt_array($h, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_FOLLOWLOCATION => true, CURLOPT_USERAGENT => 'sunic.stream mirror']);
        $b = curl_exec($h);
        $ok = curl_getinfo($h, CURLINFO_HTTP_CODE) === 200 && is_string($b) && strlen($b) <= MAX;
        curl_close($h);
        if ($ok) return $b;
    }
    return null;
}

if ($ref !== 'main' && !$epg) {
    $b = fetch_from($repo, $ref, $path);
    if ($b === null) { http_response_code(404); exit; }
    send($b, $type, $ref);
}

$cache = __DIR__ . '/lampa/.cache/gh/' . $repo . '@' . $ref . '/' . $path;
if (!is_file($cache) || time() - filemtime($cache) >= ($epg ? LIFE_EPG : LIFE_MAIN)) {
    $b = fetch_from($repo, $ref, $path);
    if ($b !== null) {
        @mkdir(dirname($cache), 0755, true);
        if (@file_put_contents($cache . '.tmp', $b) !== false) @rename($cache . '.tmp', $cache);
    } elseif (is_file($cache)) {
        @touch($cache);                                  // GitHub не ответил — старая копия ещё 10 минут
    }
}
if (is_file($cache)) send(file_get_contents($cache), $type, $ref);
http_response_code(404);
