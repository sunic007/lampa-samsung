<?php
/*
 * Сколько людей пользуется Sunic Apps — цифры для главной sunic.stream (владелец, 2026-10-22).
 *
 * Lampa (ТВ, Android, браузер, MSX) при запуске и раз в 10 минут, пока открыта, присылает анонимный сигнал:
 *   /stat.php?d=<16 hex — случайный номер устройства, создаётся в самой Lampa>&p=<samsung|tv|android|web>
 * Храним только этот номер и тип устройства — ни IP, ни имён, ни того, что смотрят. Ответ — 204, ничего не кешируется.
 * Без d — цифры для главной (JSON, кеш на сервере 60 с):
 *   {"now": устройств за последние 15 минут, "month": разных устройств за 30 дней, "by": {тип: за 30 дней}, "at": unix}
 *
 * Файлы в .cache/stat (наружу не отдаются): s-<10-минутка>.txt — кто был в эту 10-минутку, d-<ГГГГММДД>.txt — кто был
 * за день (строка «номер тип», каждый номер раз в день). Старше 31 дня — удаляем.
 */
const DAYS = 30;
const SLOT = 600;                    // 10 минут: «сейчас» = эта и прошлая 10-минутка

$dir = __DIR__ . '/.cache/stat';
if (!is_dir($dir)) @mkdir($dir, 0755, true);
$d = $_GET['d'] ?? '';
$p = $_GET['p'] ?? '';

if ($d !== '') {
    header('Cache-Control: no-store');
    if (!preg_match('/^[a-f0-9]{16}$/', $d) || !in_array($p, ['samsung', 'tv', 'android', 'web'], true)) { http_response_code(400); exit; }
    $now = time();
    add_once($dir . '/s-' . intdiv($now, SLOT) . '.txt', $d . "\n");
    add_once($dir . '/d-' . gmdate('Ymd', $now) . '.txt', $d . ' ' . $p . "\n");
    if (mt_rand(1, 500) === 1) clean($dir, $now);
    http_response_code(204);
    exit;
}

/** Дописать строку, если номера в файле ещё нет (замок — чтобы два сигнала разом не испортили файл). */
function add_once($file, $line) {
    $h = @fopen($file, 'c+');
    if (!$h) return;
    if (flock($h, LOCK_EX)) {
        $all = stream_get_contents($h);
        if (strpos($all, substr($line, 0, 16)) === false) { fseek($h, 0, SEEK_END); fwrite($h, $line); }
        flock($h, LOCK_UN);
    }
    fclose($h);
}
function clean($dir, $now) {
    foreach (glob($dir . '/*.txt') ?: [] as $f) if ($now - filemtime($f) > (DAYS + 1) * 86400) @unlink($f);
    foreach (glob($dir . '/s-*.txt') ?: [] as $f) if ($now - filemtime($f) > 3600) @unlink($f);
}

// цифры для главной
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=60');
$cache = $dir . '/summary.json';
if (is_file($cache) && time() - filemtime($cache) < 60) { readfile($cache); exit; }
$now = time();
$on = [];
foreach ([0, 1] as $back) {
    $f = $dir . '/s-' . (intdiv($now, SLOT) - $back) . '.txt';
    if (is_file($f)) foreach (file($f, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $id) $on[$id] = 1;
}
$month = []; $by = [];
for ($i = 0; $i < DAYS; $i++) {
    $f = $dir . '/d-' . gmdate('Ymd', $now - $i * 86400) . '.txt';
    if (!is_file($f)) continue;
    foreach (file($f, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $row) {
        $x = explode(' ', $row);
        if (isset($month[$x[0]])) continue;
        $month[$x[0]] = 1;
        $k = $x[1] ?? 'web';
        $by[$k] = ($by[$k] ?? 0) + 1;
    }
}
$out = json_encode(['now' => count($on), 'month' => count($month), 'by' => $by, 'at' => $now]);
@file_put_contents($cache, $out);
echo $out;
