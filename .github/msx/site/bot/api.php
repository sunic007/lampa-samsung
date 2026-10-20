<?php
/*
 * Полный бот Sunic Apps через общий бот: ТВ ведёт тот же бот (bstg.js — меню, закладки, подписки…), что и со своим
 * токеном, только запросы к Telegram идут сюда, а не на api.telegram.org: ?m=<метод>&tv=<id>, ключ — заголовок X-Sunic-Key.
 *  - getUpdates: апдейты, которые hook.php отложил для этого ТВ (ТВ на связи — им отвечает он); сразу, без долгого
 *    опроса — у хостинга мало процессов, ТВ сам спрашивает раз в пару секунд;
 *  - отправка: только разрешённые методы и только в чат, к которому привязан этот ТВ;
 *  - настройки бота (команды, описание, вебхук) — общие для всех, ТВ их не меняет: ответ «ok» без действия;
 *  - ?m=file&path=… — картинка из чата (узнать фильм по фото): токен на ТВ не уходит.
 * Работает, пока действует Sunic Apps Plus.
 */
require __DIR__ . '/lib.php';
header('Access-Control-Allow-Headers: X-Sunic-Key, Content-Type');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
if (!bot_token()) json_out(['ok' => false, 'description' => 'not configured'], 503);

$m = (string) ($_GET['m'] ?? '');
$tv = (string) ($_GET['tv'] ?? '');
$key = (string) ($_SERVER['HTTP_X_SUNIC_KEY'] ?? '');
if ($key === '' && $m === 'file') $key = (string) ($_GET['k'] ?? '');   // картинку ТВ берёт обычной загрузкой — ключ в адресе
if (!preg_match('/^[A-Za-z0-9]{12,40}$/', $tv) || !preg_match('/^[A-Za-z0-9]{24,64}$/', $key)) json_out(['ok' => false, 'description' => 'bad id'], 400);
$row = q('SELECT * FROM tvs WHERE id = ?', [$tv])->fetch();
if (!$row || !hash_equals($row['key_hash'], hash('sha256', $key))) json_out(['ok' => false, 'description' => 'wrong key'], 403);
$chat = (int) $row['chat_id'];
if (!$chat) json_out(['ok' => false, 'error_code' => 401, 'description' => 'TV is not linked'], 200);
$now = time();
db()->exec('CREATE TABLE IF NOT EXISTS updates (id INTEGER PRIMARY KEY AUTOINCREMENT, tv_id TEXT NOT NULL, uid INTEGER NOT NULL, body TEXT NOT NULL, at INTEGER NOT NULL)');
db()->exec('CREATE INDEX IF NOT EXISTS updates_tv ON updates (tv_id, uid)');
try { db()->exec('ALTER TABLE tvs ADD COLUMN relay_seen INTEGER'); } catch (Exception $e) {}

$plus = plus_until($chat) >= $now;
$p = $_POST + $_GET;
unset($p['m'], $p['tv']);

if ($m === 'getUpdates') {
    q('UPDATE tvs SET relay_seen = ?, seen = ? WHERE id = ?', [$now, $now, $tv]);
    q('DELETE FROM updates WHERE at < ?', [$now - 86400]);
    $off = (int) ($p['offset'] ?? 0);
    if ($off < 0) { q('DELETE FROM updates WHERE tv_id = ?', [$tv]); json_out(['ok' => true, 'result' => []]); }
    if ($off > 0) q('DELETE FROM updates WHERE tv_id = ? AND uid < ?', [$tv, $off]);
    // ждём до 3 с, пока hook.php положит апдейт: нажатие доходит до ТВ сразу, а не к следующему опросу
    $rows = [];
    for ($i = 0; $plus && $i < 15; $i++) {
        $rows = q('SELECT body FROM updates WHERE tv_id = ? ORDER BY uid LIMIT 50', [$tv])->fetchAll();
        if ($rows) break;
        usleep(200000);
    }
    json_out(['ok' => true, 'result' => array_map(function ($r) { return json_decode($r['body'], true); }, $rows)]);
}
if ($m === 'getWebhookInfo') {
    $n = (int) q('SELECT COUNT(*) c FROM updates WHERE tv_id = ?', [$tv])->fetch()['c'];
    json_out(['ok' => true, 'result' => ['url' => '', 'pending_update_count' => $n]]);
}
if ($m === 'getMe') json_out(tg('getMe') ?: ['ok' => false, 'description' => 'Telegram did not answer']);
if (in_array($m, ['setMyCommands', 'setMyDescription', 'setMyShortDescription', 'setChatMenuButton', 'deleteWebhook', 'setWebhook'], true)) json_out(['ok' => true, 'result' => true]);

/** Запрос к Telegram с полями формы как есть (как прислал ТВ). Связь хостинга с Telegram иногда «подвисает» на 10–20 с:
 *  короткие ожидания и один повтор — новое соединение обычно проходит сразу. → [тело ответа | false, HTTP-код]. */
function tg_raw($m, $p) {
    for ($try = 0; $try < 2; $try++) {
        $h = curl_init('https://api.telegram.org/bot' . bot_token() . '/' . $m);
        curl_setopt_array($h, [CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_TIMEOUT => 6, CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => http_build_query($p), CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4, CURLOPT_FORBID_REUSE => true]);
        $b = curl_exec($h);
        $code = curl_getinfo($h, CURLINFO_HTTP_CODE);
        curl_close($h);
        if ($b !== false && $code) return [$b, $code];
    }
    return [false, 0];
}

if ($m === 'file') {
    $path = (string) ($_GET['path'] ?? '');
    if (!preg_match('#^photos/[A-Za-z0-9_.-]{1,120}$#', $path)) { http_response_code(404); exit; }
    $h = curl_init('https://api.telegram.org/file/bot' . bot_token() . '/' . $path);
    curl_setopt_array($h, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4]);
    $b = curl_exec($h);
    $ok = curl_getinfo($h, CURLINFO_HTTP_CODE) === 200 && is_string($b) && strlen($b) < 10 * 1024 * 1024;
    curl_close($h);
    if (!$ok) { http_response_code(502); exit; }
    header('Content-Type: image/jpeg');
    header('Cache-Control: no-store');
    echo $b;
    exit;
}

if (!$plus) json_out(['ok' => false, 'error_code' => 402, 'description' => 'Sunic Apps Plus has ended — /plus in the bot']);
$allow = ['sendMessage', 'sendPhoto', 'sendVideo', 'editMessageText', 'editMessageMedia', 'editMessageCaption', 'editMessageReplyMarkup',
    'deleteMessage', 'answerCallbackQuery', 'sendChatAction', 'getChat', 'getFile'];
if (!in_array($m, $allow, true)) json_out(['ok' => false, 'description' => 'method not allowed'], 200);
if (array_key_exists('chat_id', $p) && (int) $p['chat_id'] !== $chat) json_out(['ok' => false, 'description' => 'chat not linked to this TV'], 200);
if (in_array($m, ['getChat'], true) && (int) ($p['chat_id'] ?? 0) !== $chat) json_out(['ok' => false, 'description' => 'chat not linked to this TV'], 200);
// у остальных методов адресат — chat_id (callback_query_id и file_id привязаны к чатам бота самим Telegram)
// ответ Telegram ТВ не нужен («печатает…», ответ на кнопку, удаление) — «ok» сразу, отправка уже после ответа
if (in_array($m, ['answerCallbackQuery', 'sendChatAction', 'deleteMessage'], true)) {
    $body = json_encode(['ok' => true, 'result' => true]);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('Content-Length: ' . strlen($body));
    header('Connection: close');                   // иначе хостинг держит ответ до конца скрипта
    ignore_user_abort(true);
    echo $body;
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request(); else flush();
    tg_raw($m, $p);
    exit;
}
list($b, $code) = tg_raw($m, $p);
$j = is_string($b) ? json_decode($b, true) : null;
json_out(is_array($j) ? $j : ['ok' => false, 'description' => 'Telegram did not answer'], $code === 429 ? 429 : 200);
