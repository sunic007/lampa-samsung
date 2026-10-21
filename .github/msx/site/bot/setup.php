<?php
/*
 * Разовая настройка @SunicStreamBot после закрытия общего бота (2026-10-21): вебхук прямо на hook.php (он отвечает
 * «закрыт, подключите свой бот»), команд нет, описание — о закрытии. Открыть: https://sunic.stream/bot/setup.php?go=1
 * Только с разрешением: файл private/setup-allow (кладётся по FTP, вне сайта); разрешение одноразовое.
 */
require __DIR__ . '/lib.php';
header('Content-Type: text/plain; charset=utf-8');
if (!bot_token()) { http_response_code(503); exit("нет private/bot-token.txt\n"); }
if (($_GET['go'] ?? '') !== '1') exit("?go=1\n");
$allow = PRIVATE_DIR . '/setup-allow';
if (!is_file($allow)) { http_response_code(403); exit("нет разрешения: положите пустой файл private/setup-allow\n"); }
@unlink($allow);
$r = [];
$r['webhook'] = tg('setWebhook', ['url' => 'https://sunic.stream/bot/hook.php', 'secret_token' => hook_secret(),
    'allowed_updates' => ['message', 'callback_query', 'pre_checkout_query'], 'drop_pending_updates' => true]);
$desc = [
    'ru' => 'Общий бот Sunic Apps закрыт. Бот для Lampa бесплатный — свой: Lampa → Настройки → Sunic Apps → Telegram. Помощь: t.me/sunicapps',
    'en' => 'The Sunic Apps shared bot is closed. The Lampa bot is free — your own: Lampa → Settings → Sunic Apps → Telegram. Help: t.me/sunicapps',
    'uz' => "Sunic Apps umumiy boti yopildi. Lampa uchun bot bepul — o'zingizniki: Lampa → Sozlamalar → Sunic Apps → Telegram. Yordam: t.me/sunicapps",
];
foreach ($desc as $l => $d) {
    $lc = $l === 'en' ? [] : ['language_code' => $l];
    $r['cmd_' . $l] = tg('deleteMyCommands', $lc);
    $r['desc_' . $l] = tg('setMyDescription', ['description' => $d] + $lc);
    $r['about_' . $l] = tg('setMyShortDescription', ['short_description' => mb_substr($d, 0, 120)] + $lc);
}
foreach ($r as $k => $v) echo $k, ': ', ($v['ok'] ?? false) ? 'ok' : ('ошибка ' . ($v['description'] ?? '?')), "\n";
