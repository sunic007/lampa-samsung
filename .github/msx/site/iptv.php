<?php
/*
 * Зеркало IPTV-плейлистов: sunic.stream/iptv/<ключ>.m3u — открытые каталоги (iptv-org, Free-TV), которые
 * расширение IPTV в Lampa качает каждый день. ТВ по всей стране били бы каждый день на GitHub Pages и
 * raw.githubusercontent и получали 503; теперь все ходят в наш кеш: сервер держит копию 6 часов, браузер —
 * час (ETag/304), при сбое источника отдаём старую копию. Ключи — белый список, как IPTV_LISTS в src/bsfeatures.js.
 */
const LIFE = 21600;                  // источники обновляются раз в сутки — 6 часов
const MAX = 3 * 1024 * 1024;         // самый большой список (Free-TV) — 0,5 МБ

$LISTS = [
    'uz'          => 'https://iptv-org.github.io/iptv/countries/uz.m3u',
    'rus'         => 'https://iptv-org.github.io/iptv/languages/rus.m3u',
    'ru'          => 'https://iptv-org.github.io/iptv/countries/ru.m3u',
    'kz'          => 'https://iptv-org.github.io/iptv/countries/kz.m3u',
    'tr'          => 'https://iptv-org.github.io/iptv/countries/tr.m3u',
    'movies'      => 'https://iptv-org.github.io/iptv/categories/movies.m3u',
    'series'      => 'https://iptv-org.github.io/iptv/categories/series.m3u',
    'kids'        => 'https://iptv-org.github.io/iptv/categories/kids.m3u',
    'animation'   => 'https://iptv-org.github.io/iptv/categories/animation.m3u',
    'documentary' => 'https://iptv-org.github.io/iptv/categories/documentary.m3u',
    'sports'      => 'https://iptv-org.github.io/iptv/categories/sports.m3u',
    'music'       => 'https://iptv-org.github.io/iptv/categories/music.m3u',
    'news'        => 'https://iptv-org.github.io/iptv/categories/news.m3u',
    'freetv'      => 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8',
];

$l = $_GET['l'] ?? '';
if (!isset($LISTS[$l])) { http_response_code(404); exit; }

function fetch_upstream($url) {
    $h = curl_init($url);
    curl_setopt_array($h, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_FOLLOWLOCATION => true, CURLOPT_USERAGENT => 'sunic.stream mirror']);
    $b = curl_exec($h);
    $code = curl_getinfo($h, CURLINFO_HTTP_CODE);
    curl_close($h);
    if ($code === 200 && is_string($b) && $b !== '' && strlen($b) <= MAX && strpos($b, '#EXTM3U') !== false) return $b;
    return null;
}

$cache = __DIR__ . '/.cache/iptv/' . $l . '.m3u';
if (!is_file($cache) || time() - filemtime($cache) >= LIFE) {
    $b = fetch_upstream($LISTS[$l]);
    if ($b !== null) {
        @mkdir(dirname($cache), 0755, true);
        if (@file_put_contents($cache . '.tmp', $b) !== false) @rename($cache . '.tmp', $cache);
    } elseif (is_file($cache)) {
        @touch($cache);                                  // источник не ответил — старая копия ещё 6 часов
    }
}
if (!is_file($cache)) { http_response_code(502); exit; } // и копии нет, и источник молчит

$body = file_get_contents($cache);
$etag = '"' . md5($body) . '"';
header('Content-Type: audio/x-mpegurl; charset=utf-8');
header('Cache-Control: public, max-age=3600');
header('Vary: Accept-Encoding');
header('ETag: ' . $etag);
if (isset($_SERVER['HTTP_IF_NONE_MATCH']) && trim($_SERVER['HTTP_IF_NONE_MATCH']) === $etag) {
    http_response_code(304);
    exit;
}
if (strlen($body) > 50000 && function_exists('gzencode')
    && strpos($_SERVER['HTTP_ACCEPT_ENCODING'] ?? '', 'gzip') !== false) {
    $gz = @gzencode($body, 6);
    if ($gz !== false && strlen($gz) < strlen($body)) {
        header('Content-Encoding: gzip');
        header('Content-Length: ' . strlen($gz));
        echo $gz;
        exit;
    }
}
header('Content-Length: ' . strlen($body));
echo $body;
