<?php
/*
 * Статус сервисов для главной sunic.stream: отвечают ли каталог и источники — проверка с этого сервера (Узбекистан),
 * раз в 10 минут (кеш), ответ — JSON. Ничего не принимает, проверяет только адреса из списка ниже.
 */
const LIFE = 600;
$checks = [
    'cub'        => ['Каталог (CUB)', 'https://cub.red/'],
    'skaz'       => ['Skaz', 'http://lampa.byskaz.ru/lampainit.js'],
    'skaz_api'   => ['Серверы Skaz', 'http://online3.skaz.tv/cors/check'],
    'online_mod' => ['Online Mod', 'https://nb557.github.io/plugins/online_mod.js'],
    'z01'        => ['Z01', 'http://z01.online/live'],
    'github'     => ['Обновления (GitHub)', 'https://raw.githubusercontent.com/sunic007/lampa-samsung/main/version.json'],
];
$cache = __DIR__ . '/lampa/.cache/status.json';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache');
if (is_file($cache) && time() - filemtime($cache) < LIFE) { readfile($cache); exit; }

$mh = curl_multi_init();
$hs = [];
foreach ($checks as $id => $c) {
    $h = curl_init($c[1]);
    curl_setopt_array($h, [CURLOPT_NOBODY => false, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8, CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_FOLLOWLOCATION => true, CURLOPT_USERAGENT => 'sunic.stream status', CURLOPT_RANGE => '0-1023']);
    curl_multi_add_handle($mh, $h);
    $hs[$id] = $h;
}
do { $st = curl_multi_exec($mh, $run); if ($run) curl_multi_select($mh, 1); } while ($run && $st === CURLM_OK);
$out = ['at' => gmdate('c'), 'items' => []];
foreach ($hs as $id => $h) {
    $code = curl_getinfo($h, CURLINFO_HTTP_CODE);
    $ms = (int) round(curl_getinfo($h, CURLINFO_TOTAL_TIME) * 1000);
    $ok = $code >= 200 && $code < 400;
    $out['items'][] = ['id' => $id, 'name' => $checks[$id][0], 'ok' => $ok, 'slow' => $ok && $ms > 3000, 'ms' => $ms];
    curl_multi_remove_handle($mh, $h);
    curl_close($h);
}
curl_multi_close($mh);
$json = json_encode($out, JSON_UNESCAPED_UNICODE);
@file_put_contents($cache, $json);
echo $json;
