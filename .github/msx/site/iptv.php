<?php
/*
 * Зеркало IPTV-плейлистов: sunic.stream/iptv/<ключ>.m3u — открытые каталоги (iptv-org, Free-TV), которые
 * расширение IPTV в Lampa качает каждый день. ТВ по всей стране били бы каждый день на GitHub Pages и
 * raw.githubusercontent и получали 503; теперь все ходят в наш кеш: сервер держит копию 6 часов, браузер —
 * час (ETag/304), при сбое источника отдаём старую копию. Ключи — белый список, как IPTV_LISTS в src/bsfeatures.js.
 *
 * Под нагрузкой (вечером сотни ТВ разом): копию обновляет один запрос (flock), остальные сразу получают старую;
 * файлы пишутся во временный и переименовываются — битой копии не бывает; рядом лежат готовые .gz и вариант
 * без http-каналов (/iptv/s/…) — на каждый запрос ничего не сжимаем и не разбираем. Cache-Control — только отсюда
 * (.htaccess снимает лишний no-cache хостинга).
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

/** Запись без битых файлов: во временный рядом, потом rename (атомарно в одной папке). */
function put_atomic($path, $data) {
    $t = @tempnam(dirname($path), 'tmp');
    if ($t === false) return false;
    if (@file_put_contents($t, $data) !== strlen($data)) { @unlink($t); return false; }
    @chmod($t, 0644);
    if (!@rename($t, $path)) { @unlink($t); return false; }
    return true;
}

/** Без каналов с адресом http:// — для страницы по https (браузер их не загрузит). */
function secure_only($body) {
    $out = []; $hold = [];
    foreach (preg_split('/\r?\n/', $body) as $line) {
        $t = trim($line);
        if ($t === '' || $t[0] === '#') { if (strpos($t, '#EXTM3U') === 0) $out[] = $line; else $hold[] = $line; continue; }
        if (stripos($t, 'http://') !== 0) { foreach ($hold as $h) $out[] = $h; $out[] = $line; }
        $hold = [];
    }
    return implode("\n", $out) . "\n";
}

/** Готовые варианты рядом с копией: <ключ>.s.m3u, по .gz и .md5 (ETag) у каждого. Главный .m3u — последним:
 *  его время — метка свежести. */
function store($base, $body) {
    foreach (['.s.m3u' => secure_only($body), '.m3u' => $body] as $ext => $b) {
        $gz = function_exists('gzencode') ? @gzencode($b, 9) : false;
        if ($gz !== false) put_atomic($base . $ext . '.gz', $gz);
        put_atomic($base . $ext . '.md5', md5($b));
        put_atomic($base . $ext, $b);
    }
}

$dir = __DIR__ . '/.cache/iptv';
$base = $dir . '/' . $l;
$cache = $base . '.m3u';
$refresh = false;                                        // старую копию отдадим сразу, а обновим после ответа
if (!is_file($cache) || time() - filemtime($cache) >= LIFE) {
    @mkdir($dir, 0755, true);
    $lock = @fopen($base . '.lock', 'c');
    if (!is_file($cache)) {
        // копии нет совсем — ждём того, кто уже качает (или качаем сами)
        if ($lock && flock($lock, LOCK_EX)) {
            clearstatcache();
            if (!is_file($cache) && ($b = fetch_upstream($LISTS[$l])) !== null) store($base, $b);
            flock($lock, LOCK_UN);
        }
    } elseif ($lock && flock($lock, LOCK_EX | LOCK_NB)) {
        clearstatcache();                                // пока брали замок, другой мог уже обновить
        if (time() - filemtime($cache) >= LIFE) $refresh = true; else flock($lock, LOCK_UN);
    }                                                    // замок у другого — он и обновит, мы отдаём старую
}
if (!is_file($cache)) { http_response_code(502); exit; } // и копии нет, и источник молчит

$file = !empty($_GET['s']) ? $base . '.s.m3u' : $cache;
if (!is_file($file) || !is_file($file . '.md5')) store($base, file_get_contents($cache)); // копия от прошлой версии скрипта
$sum = trim((string)@file_get_contents($file . '.md5'));
if ($sum === '') $sum = md5_file($file);
$etag = '"' . $sum . '"';
header('Content-Type: audio/x-mpegurl; charset=utf-8');
header('Cache-Control: public, max-age=3600');      // только 200/304: ошибки (404/502) не кешируются
header('Vary: Accept-Encoding');
header('ETag: ' . $etag);
// Apache (mod_deflate) дописывал к ETag «-gzip», и сверка не сходилась — ТВ каждый раз качали весь список.
// Сверяем по сути: без W/, без -gzip/-br, любой из перечисленных.
$same = false;
foreach (explode(',', $_SERVER['HTTP_IF_NONE_MATCH'] ?? '') as $t) {
    $t = preg_replace('/^W\//', '', trim($t));
    if ($t !== '' && ($t === '*' || trim(preg_replace('/-(gzip|br|deflate)"$/', '"', $t), '"') === $sum)) { $same = true; break; }
}
if ($same) {
    http_response_code(304);
} else {
    $gz = $file . '.gz';
    if (is_file($gz) && strpos($_SERVER['HTTP_ACCEPT_ENCODING'] ?? '', 'gzip') !== false) {
        header('Content-Encoding: gzip');                // готовый .gz — Apache не сжимает второй раз
        header('Content-Length: ' . filesize($gz));
        readfile($gz);
    } else {
        header('Content-Length: ' . filesize($file));
        readfile($file);
    }
}

if ($refresh) {
    // ответ уже ушёл человеку — источник качаем после (LSAPI/FPM), иначе — просто дольше этот один запрос
    ignore_user_abort(true);
    if (function_exists('litespeed_finish_request')) litespeed_finish_request();
    elseif (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
    $b = fetch_upstream($LISTS[$l]);
    if ($b !== null) store($base, $b);
    else @touch($cache);                                 // источник не ответил — старая копия ещё 6 часов
    flock($lock, LOCK_UN);
}
