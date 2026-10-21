<?php
/*
 * Общий бот Sunic Apps (@SunicStreamBot) на sunic.stream — общее для hook.php (Telegram → сервер) и tv.php (ТВ ↔ сервер).
 * Токен и база — вне сайта: domains/sunic.stream/private/ (bot-token.txt кладёт владелец, bot.sqlite создаётся сама).
 * «Sunic Apps Plus»: общий бот без токена — первый месяц бесплатно, дальше 75 Telegram Stars в месяц.
 */
const BOT_NAME = 'SunicStreamBot';
const PLUS_STARS = 75;
const PLUS_DAYS = 30;
const TRIAL_DAYS = 30;
const PAIR_LIFE = 600;         // код привязки ТВ живёт 10 минут
const CMD_LIFE = 600;          // команда «Смотреть» ждёт ТВ 10 минут, потом устарела
const PRIVATE_DIR = __DIR__ . '/../../private';

function bot_token() {
    static $t = null;
    if ($t === null) {
        $t = trim((string) @file_get_contents(PRIVATE_DIR . '/bot-token.txt'));
        if (!preg_match('/^\d{5,15}:[A-Za-z0-9_-]{30,}$/', $t)) $t = '';
    }
    return $t;
}

/** Секрет вебхука: Telegram шлёт его в заголовке — чужие запросы к hook.php отбрасываем. Из токена, отдельно не хранится. */
function hook_secret() { return substr(hash('sha256', 'sunic-hook:' . bot_token()), 0, 48); }

function db() {
    static $db = null;
    if ($db) return $db;
    if (!is_dir(PRIVATE_DIR)) @mkdir(PRIVATE_DIR, 0700, true);
    $db = new PDO('sqlite:' . PRIVATE_DIR . '/bot.sqlite', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $db->exec('PRAGMA journal_mode=WAL');
    $db->exec('CREATE TABLE IF NOT EXISTS tvs (id TEXT PRIMARY KEY, key_hash TEXT NOT NULL, name TEXT, chat_id INTEGER, pair_code TEXT, pair_until INTEGER, seen INTEGER)');
    $db->exec('CREATE TABLE IF NOT EXISTS cmds (id INTEGER PRIMARY KEY AUTOINCREMENT, tv_id TEXT NOT NULL, body TEXT NOT NULL, at INTEGER NOT NULL)');
    $db->exec('CREATE TABLE IF NOT EXISTS users (chat_id INTEGER PRIMARY KEY, trial_until INTEGER, paid_until INTEGER, lang TEXT)');
    $db->exec('CREATE INDEX IF NOT EXISTS cmds_tv ON cmds (tv_id)');
    $db->exec('CREATE INDEX IF NOT EXISTS tvs_pair ON tvs (pair_code)');
    $db->exec('CREATE INDEX IF NOT EXISTS tvs_chat ON tvs (chat_id)');
    $db->exec('CREATE TABLE IF NOT EXISTS updates (id INTEGER PRIMARY KEY AUTOINCREMENT, tv_id TEXT NOT NULL, uid INTEGER NOT NULL, body TEXT NOT NULL, at INTEGER NOT NULL)');
    $db->exec('CREATE INDEX IF NOT EXISTS updates_tv ON updates (tv_id, uid)');
    $db->exec('CREATE TABLE IF NOT EXISTS searches (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER, items TEXT, at INTEGER)');
    $db->exec('CREATE TABLE IF NOT EXISTS rate (k TEXT PRIMARY KEY, n INTEGER NOT NULL, until INTEGER NOT NULL)');
    $db->exec('CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL, charge_id TEXT NOT NULL, stars INTEGER, at INTEGER NOT NULL)');
    // столбцы, добавленные позже: есть ли — по PRAGMA, без исключений на каждом запросе
    $cols = array_column($db->query('PRAGMA table_info(tvs)')->fetchAll(), 'name');
    if (!in_array('relay_seen', $cols, true)) $db->exec('ALTER TABLE tvs ADD COLUMN relay_seen INTEGER');
    if (!in_array('ip', $cols, true)) $db->exec('ALTER TABLE tvs ADD COLUMN ip TEXT');
    return $db;
}

function q($sql, $args = []) { $s = db()->prepare($sql); $s->execute($args); return $s; }

function http_json($url, $post = null, $timeout = 10) {
    $h = curl_init($url);
    // только IPv4: хостинг сперва пробует IPv6 до Telegram и теряет на этом 1–2,5 с (замер 2026-10-20: v4 — 0,3 с)
    $o = [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_USERAGENT => 'sunic.stream bot', CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4];
    if ($post !== null) { $o[CURLOPT_POST] = true; $o[CURLOPT_POSTFIELDS] = json_encode($post, JSON_UNESCAPED_UNICODE); $o[CURLOPT_HTTPHEADER] = ['Content-Type: application/json']; }
    curl_setopt_array($h, $o);
    $b = curl_exec($h);
    curl_close($h);
    $j = is_string($b) ? json_decode($b, true) : null;
    return is_array($j) ? $j : null;
}

/** Запрос к Telegram: связь хостинга с ним иногда подвисает — до 7 с и один повтор. */
function tg($method, $params = []) {
    $u = 'https://api.telegram.org/bot' . bot_token() . '/' . $method;
    $j = http_json($u, $params, 7) ?: http_json($u, $params, 7);
    if (!$j || empty($j['ok'])) bot_log($method . ': ' . ($j['description'] ?? 'no answer'));
    return $j;
}

/** Короткая строка в private/bot.log (без токена и содержимого сообщений); больше 1 МБ — начинаем заново. */
function bot_log($line) {
    $f = PRIVATE_DIR . '/bot.log';
    if (is_file($f) && filesize($f) > 1048576) @unlink($f);
    @file_put_contents($f, date('c') . ' ' . substr(preg_replace('/\s+/', ' ', $line), 0, 300) . PHP_EOL, FILE_APPEND);
}

/** Не чаще $max раз за $sec секунд по ключу (чат, хеш адреса…). true — можно. */
function rate_ok($k, $max, $sec) {
    $now = time();
    $r = q('SELECT n, until FROM rate WHERE k = ?', [$k])->fetch();
    if (!$r || (int) $r['until'] < $now) { q('INSERT OR REPLACE INTO rate (k, n, until) VALUES (?, 1, ?)', [$k, $now + $sec]); return true; }
    if ((int) $r['n'] >= $max) return false;
    q('UPDATE rate SET n = n + 1 WHERE k = ?', [$k]);
    return true;
}

/** Уборка раз в ~500 запросов: брошенные непривязанные ТВ (30 дней), старые апдейты, команды, поиски и счётчики. */
function housekeeping() {
    if (mt_rand(1, 500) !== 1) return;
    $now = time();
    q('DELETE FROM tvs WHERE chat_id IS NULL AND seen < ?', [$now - 30 * 86400]);
    q('DELETE FROM updates WHERE at < ?', [$now - 86400]);
    q('DELETE FROM cmds WHERE at < ?', [$now - CMD_LIFE]);
    q('DELETE FROM searches WHERE at < ?', [$now - 7 * 86400]);
    q('DELETE FROM rate WHERE until < ?', [$now]);
}

/** Ключ TMDB — тот же открытый, что в самой Lampa (её app.js у нас на хостинге); свой можно положить в private/tmdb-key.txt. */
function tmdb_key() {
    static $k = null;
    if ($k !== null) return $k;
    $k = trim((string) @file_get_contents(PRIVATE_DIR . '/tmdb-key.txt'));
    if (!preg_match('/^[0-9a-f]{32}$/', $k)) {
        $k = '';
        $vers = glob(__DIR__ . '/../lampa/v/*/app.js') ?: [];
        rsort($vers);
        foreach ($vers as $f) {
            if (preg_match("/function key\(\)\s*\{\s*return\s*'([0-9a-f]{32})'/", (string) file_get_contents($f), $m)) { $k = $m[1]; break; }
        }
        if ($k) @file_put_contents(PRIVATE_DIR . '/tmdb-key.txt', $k);   // дальше — из файла, без разбора app.js (2 МБ) на каждый поиск
    }
    return $k;
}

function tmdb($path, $lang = 'ru') {
    $sep = strpos($path, '?') === false ? '?' : '&';
    return http_json('https://api.themoviedb.org/3/' . $path . $sep . 'api_key=' . tmdb_key() . '&language=' . $lang, null, 10);
}

/** Plus действует: пробный месяц или оплачено. */
function plus_until($chat) {
    $u = q('SELECT trial_until, paid_until FROM users WHERE chat_id = ?', [$chat])->fetch();
    return $u ? max((int) $u['trial_until'], (int) $u['paid_until']) : 0;
}

function json_out($a, $code = 200) {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($a, JSON_UNESCAPED_UNICODE);
    exit;
}
