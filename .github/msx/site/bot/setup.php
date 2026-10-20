<?php
/*
 * Разовая настройка @SunicStreamBot: вебхук на hook.php (с секретом), команды и описание на трёх языках.
 * Повторный запуск безопасен — ставит то же самое. Открыть: https://sunic.stream/bot/setup.php?go=1
 */
require __DIR__ . '/lib.php';
header('Content-Type: text/plain; charset=utf-8');
if (!bot_token()) { http_response_code(503); exit("нет private/bot-token.txt\n"); }
if (($_GET['go'] ?? '') !== '1') exit("?go=1\n");
$r = [];
$r['webhook'] = tg('setWebhook', ['url' => 'https://sunic.stream/bot/hook.php', 'secret_token' => hook_secret(),
    'allowed_updates' => ['message', 'callback_query', 'pre_checkout_query'], 'drop_pending_updates' => true]);
$cmds = [
    'ru' => [['command' => 'start', 'description' => 'Начать'], ['command' => 'tv', 'description' => 'Мои телевизоры'], ['command' => 'plus', 'description' => 'Sunic Apps Plus']],
    'en' => [['command' => 'start', 'description' => 'Start'], ['command' => 'tv', 'description' => 'My TVs'], ['command' => 'plus', 'description' => 'Sunic Apps Plus']],
    'uz' => [['command' => 'start', 'description' => 'Boshlash'], ['command' => 'tv', 'description' => 'Televizorlarim'], ['command' => 'plus', 'description' => 'Sunic Apps Plus']],
];
$about = [
    'ru' => 'Ищу фильмы и сериалы и включаю их на вашем телевизоре с Lampa и Sunic Apps. sunic.stream',
    'en' => 'I find movies and series and play them on your TV with Lampa and Sunic Apps. sunic.stream',
    'uz' => "Film va seriallarni topaman va ularni Lampa va Sunic Apps bilan televizoringizda yoqaman. sunic.stream",
];
foreach ($cmds as $l => $c) {
    $r['cmd_' . $l] = tg('setMyCommands', ['commands' => $c] + ($l === 'en' ? [] : ['language_code' => $l]));
    $r['about_' . $l] = tg('setMyShortDescription', ['short_description' => $about[$l]] + ($l === 'en' ? [] : ['language_code' => $l]));
}
foreach ($r as $k => $v) echo $k, ': ', ($v['ok'] ?? false) ? 'ok' : ('ошибка ' . ($v['description'] ?? '?')), "\n";
