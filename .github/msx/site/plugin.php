<?php
/*
 * sunic.stream/sunic.js — Android-плагин Sunic Apps по короткому адресу. Копия файла с GitHub Pages (запасной — jsDelivr),
 * обновляется раз в 10 минут; GitHub недоступен — отдаём последнюю проверенную копию. Сам ничего не принимает.
 */
const LIFE = 600;
$from = [
    'https://sunic007.github.io/lampa-android/sunic.js',
    'https://cdn.jsdelivr.net/gh/sunic007/lampa-android@main/docs/sunic.js',
];
$cache = __DIR__ . '/lampa/.cache/sunic.js';

function fetch_js($u) {
    $h = curl_init($u);
    curl_setopt_array($h, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10, CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_FOLLOWLOCATION => true, CURLOPT_USERAGENT => 'sunic.stream']);
    $b = curl_exec($h);
    $ok = curl_getinfo($h, CURLINFO_HTTP_CODE) === 200;
    curl_close($h);
    // только наш плагин: узнаём по адресу плагина внутри файла
    return $ok && is_string($b) && strlen($b) > 1000 && strpos($b, "var PLUGIN_URL = 'https://sunic007.github.io/lampa-android/sunic.js'") !== false ? $b : null;
}

if (!is_file($cache) || time() - filemtime($cache) >= LIFE) {
    foreach ($from as $u) {
        $b = fetch_js($u);
        if ($b !== null) { @file_put_contents($cache . '.tmp', $b) && @rename($cache . '.tmp', $cache); break; }
    }
    if (is_file($cache)) @touch($cache);   // не вышло — старую копию отдаём ещё 10 минут, не дёргая GitHub на каждый запрос
}
if (!is_file($cache)) { header('Location: ' . $from[0], true, 302); exit; }
header('Content-Type: application/javascript; charset=utf-8');
header('Cache-Control: no-cache');
readfile($cache);
