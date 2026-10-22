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
const GZ_MIN = 50000;                // мельче не сжимаем: заголовки gzip дороже выигрыша

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

/* Сначала наш чистый список — ветка `iptv` (tools/iptv_build.py, раз в день: без закрытых и мёртвых каналов, с
 * логотипами): raw.githubusercontent, затем jsDelivr. Списка нет или он старше 3 дней (сборка сломалась, метка
 * x-sunic-at в #EXTM3U) — оригинал iptv-org / Free-TV, как раньше (правило «запас в обе стороны»). */
function fetch_list($l, $orig) {
    foreach (['https://raw.githubusercontent.com/sunic007/lampa-samsung/iptv/', 'https://cdn.jsdelivr.net/gh/sunic007/lampa-samsung@iptv/'] as $base) {
        $b = fetch_upstream($base . $l . '.m3u');
        if ($b !== null && preg_match('/x-sunic-at="(\d+)"/', substr($b, 0, 400), $m) && time() - (int)$m[1] < 3 * 86400) return $b;
    }
    return fetch_upstream($orig);
}

/** Запись без битых файлов: во временный рядом, потом rename (атомарно в одной папке). */
function put_atomic($path, $data) {
    $dir = dirname($path);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $t = @tempnam($dir, 'tmp');
    if ($t === false) return false;
    // tempnam мог уйти в системную папку — rename между файловыми системами не сработает
    $td = realpath(dirname($t)); $dd = realpath($dir);
    if ($td === false || $dd === false || $td !== $dd) {
        @unlink($t);
        $t = $dir . '/.tmp-' . getmypid() . '-' . mt_rand();
    }
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

/** Один вариант: тело первым, .gz — после. Старые .gz/.md5 не должны пережить новое тело. */
function store_one($path, $body) {
    @unlink($path . '.md5');                             // ETag теперь считаем по телу, .md5 больше не нужен
    @unlink($path . '.gz');                              // старый .gz не должен остаться у нового тела
    if (!put_atomic($path, $body)) return false;
    $gz = strlen($body) > GZ_MIN && function_exists('gzencode') ? @gzencode($body, 9) : false;
    if ($gz !== false && strlen($gz) < strlen($body)) put_atomic($path . '.gz', $gz);
    return true;
}

/** Готовые варианты рядом с копией: <ключ>.s.m3u и <ключ>.m3u, у каждого свой .gz. Главный .m3u — последним:
 *  его время — метка свежести. */
function store($base, $body) {
    store_one($base . '.s.m3u', secure_only($body));
    return store_one($base . '.m3u', $body);
}

/** Готовый .gz, только если он от этого же тела: в хвосте gzip лежат CRC32 и длина (ISIZE). */
function cached_gz($path, $body) {
    $gz = @file_get_contents($path);
    if (!is_string($gz) || strlen($gz) < 18 || strlen($gz) >= strlen($body)) return null;
    $t = @unpack('Vcrc/Vsize', substr($gz, -8));
    if (!$t || $t['size'] !== (strlen($body) & 0xFFFFFFFF)) return null;
    if (sprintf('%u', crc32($body)) !== sprintf('%u', $t['crc'])) return null;
    return $gz;
}

/** gzip принимается, только если он не запрещён q=0. */
function wants_gzip() {
    if (empty($_SERVER['HTTP_ACCEPT_ENCODING'])) return false;
    foreach (explode(',', strtolower($_SERVER['HTTP_ACCEPT_ENCODING'])) as $part) {
        $p = explode(';', trim($part));
        $name = trim($p[0]);
        if ($name !== 'gzip' && $name !== '*') continue;
        $q = 1.0;
        foreach (array_slice($p, 1) as $kv) {
            $kv = trim($kv);
            if (strpos($kv, 'q=') === 0) $q = (float) substr($kv, 2);
        }
        if ($q > 0) return true;
    }
    return false;
}

$dir = __DIR__ . '/.cache/iptv';
$base = $dir . '/' . $l;
$cache = $base . '.m3u';
$fetched = null;                                         // что скачали, если записать на диск не удалось
$refresh = false;                                        // старую копию отдадим сразу, а обновим после ответа
if (!is_file($cache) || time() - filemtime($cache) >= LIFE) {
    @mkdir($dir, 0755, true);
    $lock = @fopen($base . '.lock', 'c');
    if (!is_file($cache)) {
        // копии нет совсем — ждём того, кто уже качает (или качаем сами)
        if ($lock && flock($lock, LOCK_EX)) {
            clearstatcache();
            if (!is_file($cache)) {
                $b = fetch_list($l, $LISTS[$l]);
                if ($b !== null) { store($base, $b); $fetched = $b; }
            }
            flock($lock, LOCK_UN);
            @fclose($lock);
        } else {
            if ($lock) @fclose($lock);
            // замок не открылся — как раньше: качаем сами, атомарная запись не даст испортить кеш
            $b = fetch_list($l, $LISTS[$l]);
            if ($b !== null) { store($base, $b); $fetched = $b; }
        }
    } elseif ($lock && flock($lock, LOCK_EX | LOCK_NB)) {
        clearstatcache();                                // пока брали замок, другой мог уже обновить
        if (time() - filemtime($cache) >= LIFE) $refresh = true; else { flock($lock, LOCK_UN); @fclose($lock); }
    } elseif ($lock) {
        @fclose($lock);                                  // замок у другого — он и обновит, мы отдаём старую
    }
}

$file = !empty($_GET['s']) ? $base . '.s.m3u' : $cache;
$body = is_file($file) ? @file_get_contents($file) : false;
if ($body === false || $body === '') {
    // основной копии нет (или файл побился) — последний шанс: то, что только что скачали
    $raw = is_file($cache) ? @file_get_contents($cache) : false;
    if (($raw === false || $raw === '') && $fetched !== null) $raw = $fetched;
    if ($raw === false || $raw === '') { http_response_code(502); exit; } // и копии нет, и источник молчит
    // варианта ещё нет (или диск не пишется) — собираем из основной копии, не сбрасывая её время
    $b = !empty($_GET['s']) ? secure_only($raw) : $raw;
    store_one($file, $b);
    $body = is_file($file) ? @file_get_contents($file) : false;
    if ($body === false || $body === '') $body = $b;
}
$sum = md5($body);
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
    $gz = null;
    if (strlen($body) > GZ_MIN && wants_gzip()) {
        $gz = cached_gz($file . '.gz', $body);          // готовая копия того же тела
        if ($gz === null && function_exists('gzencode')) {
            $gz = @gzencode($body, 6);                  // .gz нет или он от другой версии — как раньше, на лету
            if ($gz === false || strlen($gz) >= strlen($body)) $gz = null;
        }
    }
    if ($gz !== null) {
        header('Content-Encoding: gzip');                // готовый .gz — Apache не сжимает второй раз
        header('Content-Length: ' . strlen($gz));
        echo $gz;
    } else {
        header('Content-Length: ' . strlen($body));
        echo $body;
    }
}

if ($refresh) {
    // ответ уже ушёл человеку — источник качаем после (LSAPI/FPM), иначе — просто дольше этот один запрос
    ignore_user_abort(true);
    if (function_exists('litespeed_finish_request')) litespeed_finish_request();
    elseif (function_exists('lsapi_finish_request')) lsapi_finish_request();
    elseif (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
    else { while (ob_get_level() > 0) { if (!@ob_end_flush()) break; } @flush(); }
    $b = fetch_list($l, $LISTS[$l]);
    if ($b !== null) {
        if (!store($base, $b)) @touch($cache);           // не записалось — старый ещё 6 часов
    } else {
        @touch($cache);                                  // источник не ответил — старая копия ещё 6 часов
    }
    flock($lock, LOCK_UN);
    @fclose($lock);
}
