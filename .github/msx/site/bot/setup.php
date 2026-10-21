<?php
/*
 * Разовая настройка @SunicStreamBot: вебхук на hook.php (с секретом), команды и описание на трёх языках.
 * Повторный запуск безопасен — ставит то же самое. Открыть: https://sunic.stream/bot/setup.php?go=1
 * Только с разрешением: файл private/setup-allow (кладётся по FTP, в папку вне сайта) — иначе любой мог бы сбросить
 * очередь сообщений бота (drop_pending_updates). Разрешение одноразовое: после запуска файл удаляется.
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
$cmds = [
    'ru' => [['command' => 'start', 'description' => 'Начать'], ['command' => 'tv', 'description' => 'Мои телевизоры'], ['command' => 'plus', 'description' => 'Sunic Apps Plus'], ['command' => 'paysupport', 'description' => 'Помощь с оплатой']],
    'en' => [['command' => 'start', 'description' => 'Start'], ['command' => 'tv', 'description' => 'My TVs'], ['command' => 'plus', 'description' => 'Sunic Apps Plus'], ['command' => 'paysupport', 'description' => 'Payment help']],
    'uz' => [['command' => 'start', 'description' => 'Boshlash'], ['command' => 'tv', 'description' => 'Televizorlarim'], ['command' => 'plus', 'description' => 'Sunic Apps Plus'], ['command' => 'paysupport', 'description' => "To'lov bo'yicha yordam"]],
];
$about = [
    'ru' => 'Ищу фильмы и сериалы и включаю их на вашем телевизоре с Lampa и Sunic Apps. sunic.stream',
    'en' => 'I find movies and series and play them on your TV with Lampa and Sunic Apps. sunic.stream',
    'uz' => "Film va seriallarni topaman va ularni Lampa va Sunic Apps bilan televizoringizda yoqaman. sunic.stream",
];
$desc = [
    'ru' => "Ищу фильмы и сериалы и включаю их на вашем телевизоре.

• Напишите название — пришлю карточку с постером.
• «▶ Смотреть на ТВ» — фильм включится на телевизоре с Lampa и Sunic Apps.

Подключить ТВ: Lampa → Настройки → Sunic Apps → Telegram → «Общий бот Sunic Apps» — и наведите камеру на QR.

Первый месяц бесплатно, дальше Sunic Apps Plus. sunic.stream",
    'en' => "I find movies and series and play them on your TV.

• Send a title — I reply with a card and poster.
• «▶ Watch on TV» — it starts on the TV with Lampa and Sunic Apps.

Connect a TV: Lampa → Settings → Sunic Apps → Telegram → «Sunic Apps shared bot» — and point the camera at the QR.

First month free, then Sunic Apps Plus. sunic.stream",
    'uz' => "Film va seriallarni topaman va ularni televizoringizda yoqaman.

• Nomini yozing — poster bilan kartochka yuboraman.
• «▶ Televizorda ko'rish» — film Lampa va Sunic Apps bilan televizorda yoqiladi.

Televizorni ulash: Lampa → Sozlamalar → Sunic Apps → Telegram → «Sunic Apps umumiy boti» — va kamerani QR-kodga qarating.

Birinchi oy bepul, keyin Sunic Apps Plus. sunic.stream",
];
foreach ($cmds as $l => $c) {
    $lc = $l === 'en' ? [] : ['language_code' => $l];
    $r['name_' . $l] = tg('setMyName', ['name' => 'Sunic Apps'] + $lc);
    $r['desc_' . $l] = tg('setMyDescription', ['description' => $desc[$l]] + $lc);
    $r['cmd_' . $l] = tg('setMyCommands', ['commands' => $c] + ($l === 'en' ? [] : ['language_code' => $l]));
    $r['about_' . $l] = tg('setMyShortDescription', ['short_description' => $about[$l]] + ($l === 'en' ? [] : ['language_code' => $l]));
}
$me = tg('getMe');
echo 'bot: @', $me['result']['username'] ?? '?', ' — ', $me['result']['first_name'] ?? '?', "
";
foreach ($r as $k => $v) echo $k, ': ', ($v['ok'] ?? false) ? 'ok' : ('ошибка ' . ($v['description'] ?? '?')), "\n";
