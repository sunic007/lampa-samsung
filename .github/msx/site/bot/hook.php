<?php
/*
 * Вебхук @SunicStreamBot. Общий бот Sunic Apps закрыт (2026-10-21, решение владельца): на любое сообщение — одно
 * объяснение, как подключить свой бот (бесплатно); кнопки старых сообщений — то же во всплывающем окне; оплату не принимаем.
 */
require __DIR__ . '/lib.php';
if (!bot_token()) { http_response_code(503); exit; }
if (!hash_equals(hook_secret(), (string) ($_SERVER['HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN'] ?? ''))) { http_response_code(403); exit; }
$u = json_decode((string) file_get_contents('php://input'), true);
http_response_code(200);
if (!is_array($u)) exit;

const CLOSED = [
    'ru' => "Общий бот Sunic Apps закрыт.\n\nБот для Lampa по-прежнему бесплатный — свой: Lampa → Настройки → Sunic Apps → Telegram → «Свой бот». Подключается за минуту с телефона.\n\nВопросы и помощь: https://t.me/sunicapps",
    'en' => "The Sunic Apps shared bot is closed.\n\nThe Lampa bot is still free — your own: Lampa → Settings → Sunic Apps → Telegram → «Own bot». It connects from your phone in a minute.\n\nQuestions and help: https://t.me/sunicapps",
    'uz' => "Sunic Apps umumiy boti yopildi.\n\nLampa uchun bot avvalgidek bepul — o'zingizniki: Lampa → Sozlamalar → Sunic Apps → Telegram → «O'z botingiz». Telefondan bir daqiqada ulanadi.\n\nSavollar va yordam: https://t.me/sunicapps",
];
const CLOSED_SHORT = [
    'ru' => 'Общий бот Sunic Apps закрыт. Свой бот — бесплатно: Lampa → Настройки → Sunic Apps → Telegram.',
    'en' => 'The Sunic Apps shared bot is closed. Your own bot is free: Lampa → Settings → Sunic Apps → Telegram.',
    'uz' => "Sunic Apps umumiy boti yopildi. O'z botingiz — bepul: Lampa → Sozlamalar → Sunic Apps → Telegram.",
];
function lang_of($from) {
    $c = strtolower(substr((string) ($from['language_code'] ?? 'ru'), 0, 2));
    return $c === 'uz' ? 'uz' : ($c === 'en' || !in_array($c, ['ru', 'uk', 'be', 'kk', 'ky', 'tg'], true) ? 'en' : 'ru');
}

if (isset($u['pre_checkout_query'])) {
    $p = $u['pre_checkout_query'];
    tg('answerPreCheckoutQuery', ['pre_checkout_query_id' => $p['id'], 'ok' => false, 'error_message' => CLOSED_SHORT[lang_of($p['from'] ?? [])]]);
    exit;
}
if (isset($u['callback_query'])) {
    $c = $u['callback_query'];
    tg('answerCallbackQuery', ['callback_query_id' => $c['id'], 'text' => CLOSED_SHORT[lang_of($c['from'] ?? [])], 'show_alert' => true]);
    exit;
}
$msg = $u['message'] ?? null;
if (!$msg || ($msg['chat']['type'] ?? '') !== 'private') exit;
$chat = (int) $msg['chat']['id'];
if (!rate_ok('closed:' . $chat, 5, 3600)) exit;   // не больше 5 ответов в час одному чату
tg('sendMessage', ['chat_id' => $chat, 'text' => CLOSED[lang_of($msg['from'] ?? [])], 'disable_web_page_preview' => true, 'reply_markup' => ['remove_keyboard' => true]]);
