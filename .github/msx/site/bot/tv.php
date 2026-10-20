<?php
/*
 * ТВ ↔ общий бот. ТВ сам придумывает свой id и ключ (храня их у себя), сервер помнит только хеш ключа.
 *   ?a=hello&tv=<id>&name=<имя ТВ>  — регистрация; не привязан — код и ссылка для QR (t.me/SunicStreamBot?start=…)
 *   ?a=poll&tv=…                    — команды для ТВ («Смотреть»), забранные удаляются
 *   ?a=unlink&tv=…                  — отвязать ТВ от чата
 * Ключ — в заголовке X-Sunic-Key (не в адресе: адреса попадают в журналы сервера).
 * Только GET (сайт ничего не принимает, см. .htaccess), ответы — JSON, CORS открыт: ТВ, MSX и Android — разные origin.
 */
require __DIR__ . '/lib.php';
// Access-Control-Allow-Origin: * ставит .htaccess сайта — второй такой же заголовок браузер счёл бы ошибкой
header('Access-Control-Allow-Headers: X-Sunic-Key');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
if (!bot_token()) json_out(['ok' => false, 'why' => 'not configured'], 503);

$a = $_GET['a'] ?? '';
$tv = $_GET['tv'] ?? '';
$key = (string) ($_SERVER['HTTP_X_SUNIC_KEY'] ?? '');
if (!preg_match('/^[A-Za-z0-9]{12,40}$/', $tv) || !preg_match('/^[A-Za-z0-9]{24,64}$/', $key)) json_out(['ok' => false, 'why' => 'bad id'], 400);
$name = mb_substr(trim(preg_replace('/[\x00-\x1f<>]/u', '', (string) ($_GET['name'] ?? ''))), 0, 40);
$now = time();
$kh = hash('sha256', $key);

$row = q('SELECT * FROM tvs WHERE id = ?', [$tv])->fetch();
if ($row && !hash_equals($row['key_hash'], $kh)) json_out(['ok' => false, 'why' => 'wrong key'], 403);
if (!$row) {
    if ($a !== 'hello') json_out(['ok' => false, 'why' => 'unknown tv'], 404);
    q('INSERT INTO tvs (id, key_hash, name, seen) VALUES (?, ?, ?, ?)', [$tv, $kh, $name, $now]);
    $row = q('SELECT * FROM tvs WHERE id = ?', [$tv])->fetch();
}
q('UPDATE tvs SET seen = ?' . ($name !== '' ? ', name = ?' : '') . ' WHERE id = ?', $name !== '' ? [$now, $name, $tv] : [$now, $tv]);

if ($a === 'hello') {
    $out = ['ok' => true, 'linked' => !empty($row['chat_id']), 'bot' => BOT_NAME];
    if (empty($row['chat_id'])) {
        $code = $row['pair_code'];
        if (!$code || (int) $row['pair_until'] < $now) {
            $code = '';
            $abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            for ($i = 0; $i < 10; $i++) $code .= $abc[random_int(0, strlen($abc) - 1)];
            q('UPDATE tvs SET pair_code = ?, pair_until = ? WHERE id = ?', [$code, $now + PAIR_LIFE, $tv]);
        }
        $out['link'] = 'https://t.me/' . BOT_NAME . '?start=tv' . $code;
    } else {
        $out['plus_until'] = plus_until((int) $row['chat_id']);
        $out['chat'] = (int) $row['chat_id'];              // боту на ТВ (bstg.js) — с кем говорить через api.php
    }
    json_out($out);
}

if ($a === 'poll') {
    q('DELETE FROM cmds WHERE at < ?', [$now - CMD_LIFE]);
    $cmds = q('SELECT id, body FROM cmds WHERE tv_id = ? ORDER BY id', [$tv])->fetchAll();
    if ($cmds) q('DELETE FROM cmds WHERE tv_id = ? AND id <= ?', [$tv, end($cmds)['id']]);
    json_out(['ok' => true, 'linked' => !empty($row['chat_id']), 'cmds' => array_map(function ($c) { return json_decode($c['body'], true); }, $cmds)]);
}

if ($a === 'unlink') {
    q('UPDATE tvs SET chat_id = NULL, pair_code = NULL WHERE id = ?', [$tv]);
    q('DELETE FROM cmds WHERE tv_id = ?', [$tv]);
    json_out(['ok' => true]);
}

json_out(['ok' => false, 'why' => 'bad action'], 400);
