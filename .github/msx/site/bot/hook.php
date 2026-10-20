<?php
/*
 * Вебхук @SunicStreamBot: Telegram шлёт сюда каждое сообщение (POST, заголовок с секретом — см. hook_secret()).
 * Поиск фильма → карточка с постером → «▶ Смотреть на ТВ» → команда в очередь ТВ (tv.php?a=poll забирает).
 * Привязка ТВ: /start tv<код> из QR на телевизоре. Plus: пробный месяц с первой привязки, дальше Stars (XTR).
 */
require __DIR__ . '/lib.php';
if (!bot_token()) { http_response_code(503); exit; }
if (!hash_equals(hook_secret(), (string) ($_SERVER['HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN'] ?? ''))) { http_response_code(403); exit; }
$u = json_decode((string) file_get_contents('php://input'), true);
http_response_code(200);
if (!is_array($u)) exit;

/* ---------- тексты (RU / EN / UZ — одно и то же) ---------- */
const T = [
    'ru' => [
        'hello' => "Привет! Я ищу фильмы и сериалы и включаю их на вашем телевизоре.\n\nНапишите название — например, «Синтел».\n\nЧтобы я включал на ТВ: Lampa → Настройки → Sunic Apps → Telegram → «Общий бот Sunic Apps» — и наведите камеру телефона на QR.",
        'linked' => "✅ Телевизор «%s» подключён.\nSunic Apps Plus: бесплатно до %s.\n\nНапишите название фильма или сериала.",
        'pair_old' => 'Код устарел — откройте QR на телевизоре ещё раз.',
        'none' => 'Ничего не нашёл. Попробуйте другое название.',
        'watch' => '▶ Смотреть на ТВ',
        'film' => 'Фильм', 'series' => 'Сериал',
        'sent' => 'Включаю на ТВ «%s»',
        'no_tv' => "Телевизор не подключён.\nLampa → Настройки → Sunic Apps → Telegram → «Общий бот Sunic Apps» — и наведите камеру на QR.",
        'tvs' => "Ваши телевизоры:\n%s\n\nОтвязать — кнопкой ниже.", 'unlink' => '✖ Отвязать «%s»', 'unlinked' => 'Телевизор отвязан.',
        'plus_on' => "Sunic Apps Plus действует до %s.\nОбщий бот без токена, ответы, когда ТВ выключен, уведомления о новых сериях.",
        'plus_off' => "Sunic Apps Plus закончился. Продлить на 30 дней — %d ⭐.\nБесплатно всегда: свой бот с токеном от @BotFather (Lampa → Sunic Apps → Telegram).",
        'pay_title' => 'Sunic Apps Plus — 30 дней', 'pay_desc' => 'Общий бот Sunic Apps без токена: поиск с телефона, «Смотреть на ТВ», уведомления о новых сериях.',
        'paid' => "Спасибо! Sunic Apps Plus продлён до %s.", 'expired' => "Чтобы включать на ТВ, продлите Sunic Apps Plus — /plus",
        'old' => 'Поиск устарел — напишите название ещё раз.',
        'tv_off' => 'Телевизор не на связи — откройте на нём Lampa, и кнопка заработает.',
        'which' => 'На каком ТВ включить?',
    ],
    'en' => [
        'hello' => "Hi! I find movies and series and play them on your TV.\n\nSend a title — for example, «Sintel».\n\nTo let me play on the TV: Lampa → Settings → Sunic Apps → Telegram → «Sunic Apps shared bot» — and point your phone camera at the QR.",
        'linked' => "✅ TV «%s» connected.\nSunic Apps Plus: free until %s.\n\nSend a movie or series title.",
        'pair_old' => 'The code has expired — open the QR on the TV again.',
        'none' => 'Nothing found. Try another title.',
        'watch' => '▶ Watch on TV',
        'film' => 'Movie', 'series' => 'Series',
        'sent' => 'Playing on the TV «%s»',
        'no_tv' => "No TV connected.\nLampa → Settings → Sunic Apps → Telegram → «Sunic Apps shared bot» — and point the camera at the QR.",
        'tvs' => "Your TVs:\n%s\n\nUnlink with the button below.", 'unlink' => '✖ Unlink «%s»', 'unlinked' => 'TV unlinked.',
        'plus_on' => "Sunic Apps Plus is active until %s.\nShared bot without a token, answers when the TV is off, new-episode alerts.",
        'plus_off' => "Sunic Apps Plus has ended. Renew for 30 days — %d ⭐.\nAlways free: your own bot with a @BotFather token (Lampa → Sunic Apps → Telegram).",
        'pay_title' => 'Sunic Apps Plus — 30 days', 'pay_desc' => 'Sunic Apps shared bot without a token: search from your phone, «Watch on TV», new-episode alerts.',
        'paid' => "Thank you! Sunic Apps Plus is renewed until %s.", 'expired' => "To play on the TV, renew Sunic Apps Plus — /plus",
        'old' => 'This search is outdated — send the title again.',
        'tv_off' => 'The TV is offline — open Lampa on it and the button will work.',
        'which' => 'Which TV should it play on?',
    ],
    'uz' => [
        'hello' => "Salom! Men film va seriallarni topaman va ularni televizoringizda yoqaman.\n\nNomini yozing — masalan, «Sintel».\n\nTelevizorda yoqishim uchun: Lampa → Sozlamalar → Sunic Apps → Telegram → «Sunic Apps umumiy boti» — va telefon kamerasini QR-kodga qarating.",
        'linked' => "✅ «%s» televizori ulandi.\nSunic Apps Plus: %s gacha bepul.\n\nFilm yoki serial nomini yozing.",
        'pair_old' => "Kod eskirgan — televizorda QR-kodni qayta oching.",
        'none' => "Hech narsa topilmadi. Boshqa nom bilan urinib ko'ring.",
        'watch' => "▶ Televizorda ko'rish",
        'film' => 'Film', 'series' => 'Serial',
        'sent' => "«%s» televizorida yoqyapman",
        'no_tv' => "Televizor ulanmagan.\nLampa → Sozlamalar → Sunic Apps → Telegram → «Sunic Apps umumiy boti» — va kamerani QR-kodga qarating.",
        'tvs' => "Televizorlaringiz:\n%s\n\nUzish — quyidagi tugma bilan.", 'unlink' => "✖ «%s» ni uzish", 'unlinked' => 'Televizor uzildi.',
        'plus_on' => "Sunic Apps Plus %s gacha amal qiladi.\nTokensiz umumiy bot, televizor o'chiq bo'lsa ham javoblar, yangi qismlar haqida xabarlar.",
        'plus_off' => "Sunic Apps Plus tugadi. 30 kunga uzaytirish — %d ⭐.\nDoim bepul: @BotFather tokeni bilan o'z botingiz (Lampa → Sunic Apps → Telegram).",
        'pay_title' => 'Sunic Apps Plus — 30 kun', 'pay_desc' => "Tokensiz Sunic Apps umumiy boti: telefondan qidirish, «Televizorda ko'rish», yangi qismlar haqida xabarlar.",
        'paid' => "Rahmat! Sunic Apps Plus %s gacha uzaytirildi.", 'expired' => "Televizorda yoqish uchun Sunic Apps Plus ni uzaytiring — /plus",
        'old' => "Qidiruv eskirgan — nomini qayta yozing.",
        'tv_off' => "Televizor aloqada emas — unda Lampa ni oching, tugma ishlaydi.",
        'which' => "Qaysi televizorda yoqay?",
    ],
];
function lang_of($from) {
    $c = strtolower(substr((string) ($from['language_code'] ?? 'ru'), 0, 2));
    return $c === 'uz' ? 'uz' : ($c === 'en' || !in_array($c, ['ru', 'uk', 'be', 'kk', 'ky', 'tg'], true) ? 'en' : 'ru');
}
function t($l, $k) { return T[$l][$k] ?? T['ru'][$k]; }
function day($ts) { return date('d.m.Y', $ts); }
function say($chat, $text, $kb = null) { tg('sendMessage', ['chat_id' => $chat, 'text' => $text] + ($kb ? ['reply_markup' => ['inline_keyboard' => $kb]] : [])); }

db()->exec('CREATE TABLE IF NOT EXISTS searches (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER, items TEXT, at INTEGER)');
db()->exec('CREATE TABLE IF NOT EXISTS updates (id INTEGER PRIMARY KEY AUTOINCREMENT, tv_id TEXT NOT NULL, uid INTEGER NOT NULL, body TEXT NOT NULL, at INTEGER NOT NULL)');
try { db()->exec('ALTER TABLE tvs ADD COLUMN relay_seen INTEGER'); } catch (Exception $e) {}

/* ---------- полный бот на ТВ ----------
 * ТВ этого чата на связи (опрашивал api.php?m=getUpdates последние 20 с) и Plus действует — апдейт ему: отвечает
 * тот же бот, что со своим токеном (меню, закладки, подписки…). Своё сервер оставляет себе: привязка по QR, /plus,
 * /tv, оплата, кнопки своих карточек (s:, w:, u:). ТВ выключен — отвечает сервер (поиск и «Смотреть на ТВ»). */
function relay_tv($chat) {
    if (!$chat || plus_until($chat) < time()) return null;
    $tv = q('SELECT id FROM tvs WHERE chat_id = ? AND relay_seen >= ? ORDER BY relay_seen DESC LIMIT 1', [$chat, time() - 20])->fetch();
    return $tv ? $tv['id'] : null;
}
function server_own($u) {
    if (isset($u['pre_checkout_query'])) return true;
    if (isset($u['callback_query'])) return (bool) preg_match('/^([swtu]:|noop$)/', (string) ($u['callback_query']['data'] ?? ''));
    $m = $u['message'] ?? null;
    if (!$m || isset($m['successful_payment'])) return true;
    return (bool) preg_match('/^\/(start\s+tv[A-Z0-9]{10}|plus|tv)\b/', trim((string) ($m['text'] ?? '')));
}
if (!server_own($u) && isset($u['update_id'])) {
    $c = (int) ($u['callback_query']['message']['chat']['id'] ?? ($u['message']['chat']['id'] ?? 0));
    $to = relay_tv($c);
    if ($to) {
        q('INSERT INTO updates (tv_id, uid, body, at) VALUES (?, ?, ?, ?)', [$to, (int) $u['update_id'], json_encode($u, JSON_UNESCAPED_UNICODE), time()]);
        exit;
    }
}

/* ---------- карточка результата поиска ---------- */
function card_msg($l, $sid, $items, $i) {
    $it = $items[$i];
    $cap = $it['title'] . ($it['year'] ? ' (' . $it['year'] . ')' : '') . "\n" . t($l, $it['kind'] === 't' ? 'series' : 'film') . ($it['vote'] ? ' · ★ ' . $it['vote'] : '') . ($it['about'] ? "\n\n" . $it['about'] : '');
    $kb = [[['text' => t($l, 'watch'), 'callback_data' => "w:$sid:$i"]]];
    if (count($items) > 1) $kb[] = [
        ['text' => '◀', 'callback_data' => "s:$sid:" . (($i + count($items) - 1) % count($items))],
        ['text' => ($i + 1) . ' / ' . count($items), 'callback_data' => 'noop'],
        ['text' => '▶', 'callback_data' => "s:$sid:" . (($i + 1) % count($items))],
    ];
    return [$cap, $kb, $it['poster']];
}

function search($chat, $l, $text) {
    $j = tmdb('search/multi?include_adult=false&query=' . rawurlencode($text), $l === 'uz' ? 'ru' : $l);
    $items = [];
    foreach (($j['results'] ?? []) as $r) {
        if (!in_array($r['media_type'] ?? '', ['movie', 'tv'], true)) continue;
        $tv = $r['media_type'] === 'tv';
        $about = trim((string) ($r['overview'] ?? ''));
        if (mb_strlen($about) > 300) $about = mb_substr($about, 0, 297) . '…';
        $items[] = ['kind' => $tv ? 't' : 'm', 'id' => (int) $r['id'], 'title' => (string) ($tv ? ($r['name'] ?? '') : ($r['title'] ?? '')),
            'year' => substr((string) ($tv ? ($r['first_air_date'] ?? '') : ($r['release_date'] ?? '')), 0, 4),
            'vote' => !empty($r['vote_average']) ? number_format($r['vote_average'], 1) : '', 'about' => $about,
            'poster' => !empty($r['poster_path']) ? 'https://image.tmdb.org/t/p/w500' . $r['poster_path'] : ''];
        if (count($items) >= 8) break;
    }
    if (!$items) return say($chat, t($l, 'none'));
    q('DELETE FROM searches WHERE at < ?', [time() - 7 * 86400]);
    q('INSERT INTO searches (chat_id, items, at) VALUES (?, ?, ?)', [$chat, json_encode($items, JSON_UNESCAPED_UNICODE), time()]);
    $sid = (int) db()->lastInsertId();
    list($cap, $kb, $poster) = card_msg($l, $sid, $items, 0);
    if ($poster) tg('sendPhoto', ['chat_id' => $chat, 'photo' => $poster, 'caption' => $cap, 'reply_markup' => ['inline_keyboard' => $kb]]);
    else say($chat, $cap, $kb);
}

function link_tv($chat, $l, $code) {
    $tv = q('SELECT * FROM tvs WHERE pair_code = ? AND pair_until >= ?', [$code, time()])->fetch();
    if (!$tv) return say($chat, t($l, 'pair_old'));
    q('UPDATE tvs SET chat_id = ?, pair_code = NULL WHERE id = ?', [$chat, $tv['id']]);
    if (!q('SELECT 1 FROM users WHERE chat_id = ?', [$chat])->fetch()) q('INSERT INTO users (chat_id, trial_until, paid_until, lang) VALUES (?, ?, 0, ?)', [$chat, time() + TRIAL_DAYS * 86400, $l]);
    say($chat, sprintf(t($l, 'linked'), $tv['name'] ?: 'TV', day(plus_until($chat))));
}

function plus_info($chat, $l) {
    $until = plus_until($chat);
    if ($until > time()) return say($chat, sprintf(t($l, 'plus_on'), day($until)));
    say($chat, sprintf(t($l, 'plus_off'), PLUS_STARS));
    tg('sendInvoice', ['chat_id' => $chat, 'title' => t($l, 'pay_title'), 'description' => t($l, 'pay_desc'), 'payload' => 'plus30',
        'currency' => 'XTR', 'prices' => [['label' => t($l, 'pay_title'), 'amount' => PLUS_STARS]]]);
}

/* ---------- оплата Stars ---------- */
if (isset($u['pre_checkout_query'])) {
    $p = $u['pre_checkout_query'];
    tg('answerPreCheckoutQuery', ['pre_checkout_query_id' => $p['id'], 'ok' => ($p['invoice_payload'] ?? '') === 'plus30' && ($p['currency'] ?? '') === 'XTR' && (int) ($p['total_amount'] ?? 0) === PLUS_STARS]);
    exit;
}

/* ---------- кнопки ---------- */
if (isset($u['callback_query'])) {
    $c = $u['callback_query'];
    $chat = (int) ($c['message']['chat']['id'] ?? 0);
    $l = lang_of($c['from'] ?? []);
    $data = (string) ($c['data'] ?? '');
    $answer = ['callback_query_id' => $c['id']];
    if (preg_match('/^([swt]):(\d+):(\d+)(?::([A-Za-z0-9]{12,40}))?$/', $data, $m)) {
        $row = q('SELECT items FROM searches WHERE id = ? AND chat_id = ?', [(int) $m[2], $chat])->fetch();
        $items = $row ? json_decode($row['items'], true) : null;
        $i = (int) $m[3];
        if (!$items || !isset($items[$i])) { $answer['text'] = t($l, 'old'); }
        elseif ($m[1] === 's') {
            list($cap, $kb, $poster) = card_msg($l, (int) $m[2], $items, $i);
            $mid = $c['message']['message_id'];
            if ($poster) tg('editMessageMedia', ['chat_id' => $chat, 'message_id' => $mid, 'media' => ['type' => 'photo', 'media' => $poster, 'caption' => $cap], 'reply_markup' => ['inline_keyboard' => $kb]]);
            else tg('editMessageCaption', ['chat_id' => $chat, 'message_id' => $mid, 'caption' => $cap, 'reply_markup' => ['inline_keyboard' => $kb]]);
        } else {
            // ТВ этого чата: несколько — спросить, на каком (кнопки под карточкой); выбрали (t:) или один — включаем
            $tvs = q('SELECT id, name FROM tvs WHERE chat_id = ? ORDER BY seen DESC', [$chat])->fetchAll();
            $tv = null;
            if ($m[1] === 't') { foreach ($tvs as $x) if ($x['id'] === ($m[4] ?? '')) $tv = $x; }
            elseif (count($tvs) === 1) $tv = $tvs[0];
            if (!$tvs) { $answer['text'] = t($l, 'no_tv'); $answer['show_alert'] = true; }
            elseif (plus_until($chat) < time()) { $answer['text'] = t($l, 'expired'); $answer['show_alert'] = true; }
            elseif (!$tv) {
                $kb = array_map(function ($x) use ($m, $i) { return [['text' => '📺 ' . ($x['name'] ?: 'TV'), 'callback_data' => 't:' . $m[2] . ':' . $i . ':' . $x['id']]]; }, array_slice($tvs, 0, 6));
                tg('editMessageReplyMarkup', ['chat_id' => $chat, 'message_id' => $c['message']['message_id'], 'reply_markup' => ['inline_keyboard' => $kb]]);
                $answer['text'] = t($l, 'which');
            } else {
                q('INSERT INTO cmds (tv_id, body, at) VALUES (?, ?, ?)', [$tv['id'], json_encode(['t' => 'open', 'kind' => $items[$i]['kind'], 'id' => $items[$i]['id'], 'play' => true]), time()]);
                $answer['text'] = sprintf(t($l, 'sent'), $tv['name'] ?: 'TV');
                if ($m[1] === 't') { list(, $kb) = card_msg($l, (int) $m[2], $items, $i); tg('editMessageReplyMarkup', ['chat_id' => $chat, 'message_id' => $c['message']['message_id'], 'reply_markup' => ['inline_keyboard' => $kb]]); }
            }
        }
    } elseif (preg_match('/^u:([A-Za-z0-9]{12,40})$/', $data, $m)) {
        q('UPDATE tvs SET chat_id = NULL WHERE id = ? AND chat_id = ?', [$m[1], $chat]);
        $answer['text'] = t($l, 'unlinked');
    } elseif ($data !== 'noop') {
        // кнопка из сообщения бота на ТВ (меню, закладки…), а ТВ сейчас не опрашивает сервер — сказать, а не молчать
        $answer['text'] = t($l, 'tv_off'); $answer['show_alert'] = true;
    }
    tg('answerCallbackQuery', $answer);
    exit;
}

/* ---------- сообщения ---------- */
$msg = $u['message'] ?? null;
if (!$msg || ($msg['chat']['type'] ?? '') !== 'private') exit;
$chat = (int) $msg['chat']['id'];
$l = lang_of($msg['from'] ?? []);

if (isset($msg['successful_payment'])) {
    $p = $msg['successful_payment'];
    if (($p['invoice_payload'] ?? '') === 'plus30' && ($p['currency'] ?? '') === 'XTR') {
        $from = max(time(), plus_until($chat));
        if (!q('SELECT 1 FROM users WHERE chat_id = ?', [$chat])->fetch()) q('INSERT INTO users (chat_id, trial_until, paid_until, lang) VALUES (?, 0, 0, ?)', [$chat, $l]);
        q('UPDATE users SET paid_until = ? WHERE chat_id = ?', [$from + PLUS_DAYS * 86400, $chat]);
        say($chat, sprintf(t($l, 'paid'), day($from + PLUS_DAYS * 86400)));
    }
    exit;
}

$text = trim((string) ($msg['text'] ?? ''));
if ($text === '') exit;
if (preg_match('/^\/start(?:\s+tv([A-Z0-9]{10}))?$/', $text, $m)) { empty($m[1]) ? say($chat, t($l, 'hello')) : link_tv($chat, $l, $m[1]); exit; }
if ($text === '/plus') { plus_info($chat, $l); exit; }
if ($text === '/tv') {
    $tvs = q('SELECT id, name FROM tvs WHERE chat_id = ?', [$chat])->fetchAll();
    if (!$tvs) { say($chat, t($l, 'no_tv')); exit; }
    $kb = array_map(function ($r) use ($l) { return [['text' => sprintf(t($l, 'unlink'), $r['name'] ?: 'TV'), 'callback_data' => 'u:' . $r['id']]]; }, $tvs);
    say($chat, sprintf(t($l, 'tvs'), implode("\n", array_map(function ($r) { return '📺 ' . ($r['name'] ?: 'TV'); }, $tvs))), $kb);
    exit;
}
if ($text[0] === '/') { say($chat, t($l, 'hello')); exit; }
search($chat, $l, mb_substr($text, 0, 100));
