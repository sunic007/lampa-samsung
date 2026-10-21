<?php
/*
 * Независимая сверка встроенной копии Lampa (tools/update_bundled.py, отчёт ревью 2026-10-21, S1).
 * Сервер byskaz отдаёт Lampa только по http: подменить файл по дороге может кто угодно на пути. update_bundled.py
 * качает app.min.js у себя (ПК или GitHub Actions), а этот файл — с хостинга, другой сетью, и отдаёт его sha256.
 * Не совпали — копия не обновляется.
 * Адрес зашит, снаружи приходит только hash сборки (32 hex) — чужой адрес так не запросить. Ответ кэшируется.
 *   GET /lampa/verify.php?h=<hash из assembly.json>  ->  {"ok":true,"hash":"…","sha256":"…","size":N}
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
$h = (string) ($_GET['h'] ?? '');
if (!preg_match('/^[0-9a-f]{32}$/', $h)) { http_response_code(400); exit('{"ok":false,"error":"h"}'); }
$cache = __DIR__ . '/../../private/verify-' . $h . '.json';
if (is_file($cache) && time() - filemtime($cache) < 3600) { readfile($cache); exit; }
$c = curl_init('http://lampa.byskaz.ru/lampa-main/app.min.js?t=' . $h);
curl_setopt_array($c, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 25, CURLOPT_CONNECTTIMEOUT => 8,
    CURLOPT_FOLLOWLOCATION => false, CURLOPT_USERAGENT => 'Mozilla/5.0']);
$body = curl_exec($c);
$code = curl_getinfo($c, CURLINFO_HTTP_CODE);
curl_close($c);
if (!is_string($body) || $code !== 200 || strlen($body) < 100000) { http_response_code(502); exit('{"ok":false,"error":"fetch"}'); }
$out = json_encode(['ok' => true, 'hash' => $h, 'sha256' => hash('sha256', $body), 'size' => strlen($body)]);
@file_put_contents($cache, $out);
echo $out;
