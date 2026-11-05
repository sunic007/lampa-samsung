<?php
/*
 * Независимая сверка ядра Lampa (tools/update_bundled.py, отчёт ревью 2026-10-21, S1; с 2.3.82 — и своя копия ядра на ТВ,
 * loader.js bsCoreKeep). Сервер byskaz отдаёт Lampa только по http: подменить файл по дороге может кто угодно на пути.
 * Тот, кто качает app.min.js у себя, спрашивает здесь — хостинг качает его другой сетью и отдаёт sha256. Не совпало —
 * копия не сохраняется.
 *   GET /lampa/verify.php?h=<hash из assembly.json>  ->  {"ok":true,"hash":"…","sha256":"…","size":N}
 * Защита хостинга (пентест 2026-11-05): сверяем только сборку, которую byskaz отдаёт сейчас (assembly.json, кеш 5 мин),
 * качаем по одной (замок), ответ на сборку хранится, пока она не устарела; лишние файлы сверки удаляем (держим 6).
 */
ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
// CORS (ТВ и сайт спрашивают отсюда) ставит .htaccess для всего сайта; второй такой заголовок браузер отвергает
$h = $_GET['h'] ?? '';
if (!is_string($h) || !preg_match('/^[0-9a-f]{32}$/', $h)) { http_response_code(400); exit('{"ok":false,"error":"h"}'); }
$dir = __DIR__ . '/../../private';
$cache = $dir . '/verify-' . $h . '.json';
// пустой файл (диск хостинга был полон) — не ответ: сверяем заново
if (is_file($cache) && filesize($cache) > 50) { readfile($cache); exit; }

function fetch_url($url, $timeout) {
    $c = curl_init($url);
    curl_setopt_array($c, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_FOLLOWLOCATION => false, CURLOPT_USERAGENT => 'Mozilla/5.0']);
    $body = curl_exec($c);
    $code = curl_getinfo($c, CURLINFO_HTTP_CODE);
    curl_close($c);
    return $code === 200 && is_string($body) ? $body : null;
}

// какую сборку byskaz отдаёт сейчас — чужие хеши не качаем (иначе любой мог занять PHP и диск хостинга)
$cur = $dir . '/verify-current.json';
$a = is_file($cur) && time() - filemtime($cur) < 300 ? @file_get_contents($cur) : null;
if (!$a) {
    $a = fetch_url('http://lampa.byskaz.ru/lampa-main/assembly.json?t=' . time(), 10);
    if ($a) @file_put_contents($cur, $a);
}
$j = $a ? json_decode($a, true) : null;
if (!is_array($j) || ($j['hash'] ?? '') !== $h) { http_response_code(404); exit('{"ok":false,"error":"unknown"}'); }

$lock = @fopen($dir . '/verify.lock', 'c');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) { http_response_code(503); exit('{"ok":false,"error":"busy"}'); }
if (is_file($cache) && filesize($cache) > 50) { readfile($cache); exit; }    // пока ждали замок, сверил другой запрос
$body = fetch_url('http://lampa.byskaz.ru/lampa-main/app.min.js?t=' . $h, 25);
if ($body === null || strlen($body) < 100000) { http_response_code(502); exit('{"ok":false,"error":"fetch"}'); }
$out = json_encode(['ok' => true, 'hash' => $h, 'sha256' => hash('sha256', $body), 'size' => strlen($body)]);
@file_put_contents($cache, $out);
$old = array_values(array_filter(glob($dir . '/verify-*.json') ?: [], function ($f) { return preg_match('/verify-[0-9a-f]{32}\.json$/', $f); }));
if (count($old) > 6) {
    usort($old, function ($x, $y) { return filemtime($y) - filemtime($x); });
    foreach (array_slice($old, 6) as $f) @unlink($f);
}
echo $out;
