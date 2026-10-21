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
// одно сообщение — один раз: Cloudflare (bot-front) и сам Telegram при сбое присылают его повторно
if (isset($u['update_id']) && !q('INSERT OR IGNORE INTO seen (id, at) VALUES (?, ?)', [(int) $u['update_id'], time()])->rowCount()) exit;
/* Замер скорости (пока лежит private/speed-log): насколько сообщение опоздало от Telegram до нас и сколько мы его
 * обрабатывали — в журнал bot.log. Только числа и тип апдейта, без текста и чатов. */
if (is_file(PRIVATE_DIR . '/speed-log')) {
    $speedAt = microtime(true);
    $speedLag = isset($u['message']['date']) ? time() - (int) $u['message']['date'] : -1;
    $speedKind = isset($u['callback_query']) ? 'button' : (isset($u['message']) ? 'message' : 'other');
    register_shutdown_function(function () use ($speedAt, $speedLag, $speedKind) {
        bot_log(sprintf('speed %s: delivered after %s s, handled in %d ms', $speedKind, $speedLag < 0 ? '?' : $speedLag, round((microtime(true) - $speedAt) * 1000)));
    });
}

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
        'slow' => 'Слишком часто — подождите минуту и напишите ещё раз.',
        'refunded' => 'Оплата Sunic Apps Plus возвращена — подписка отменена.',
        'paysupport' => "Вопросы по оплате Sunic Apps Plus — напишите в группу https://t.me/sunicapps. Если Plus не включился или нужен возврат Stars — поможем.",
        'tv_off' => 'Телевизор не на связи — откройте на нём Lampa, и кнопка заработает.',
        'which' => 'На каком ТВ включить?',
        'kb' => '📋 Меню', 'b_find' => '🔎 Найти', 'b_tvs' => '📺 Телевизоры', 'b_help' => '❓ Помощь', 'b_set' => '⚙️ Настройки',
        'b_plus' => '⭐ Sunic Apps Plus', 'b_renew' => '⭐ Продлить на 30 дней — %d ⭐', 'b_back' => '⬅️ Настройки', 'b_menu' => '📋 Меню',
        'b_watch' => '▶️ Смотреть', 'b_open' => '📺 Открыть на ТВ', 'opened' => 'Открываю на ТВ «%s»',
        'menu' => "%s\n\nВыберите раздел:", 'tv_on' => '📺 На связи: %s', 'tv_wait' => '📺 Телевизор сейчас не на связи — работают поиск и «Смотреть»: фильм включится, когда на ТВ откроется Lampa. Закладки, подписки и «На неделе» — когда Lampa открыта.',
        'find' => '🔎 Напишите название фильма или сериала — например, «Синтел».',
        'settings' => "⚙️ Настройки\n\n⭐ Sunic Apps Plus: %s", 'until' => 'до %s', 'ended' => 'закончился',
        'help' => "❓ Помощь\n\n🔎 Напишите название — пришлю карточку с постером.\n▶️ «Смотреть» — фильм включится на ТВ, 📺 «Открыть на ТВ» — откроется его карточка.\nКогда на ТВ открыта Lampa, работают и закладки, подписки, «На неделе».\n\n⭐ Sunic Apps Plus — «⚙️ Настройки» или /plus\n💬 Вопросы, помощь и новости: https://t.me/sunicapps",
        'menu_off' => "Меню, закладки и подписки работают, когда на телевизоре открыта Lampa.
Сейчас ТВ не на связи. Напишите название фильма — найду, и он включится, когда ТВ включат.",
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
        'slow' => 'Too many requests — wait a minute and try again.',
        'refunded' => 'The Sunic Apps Plus payment was refunded — the subscription is cancelled.',
        'paysupport' => "Questions about paying for Sunic Apps Plus — write to the group https://t.me/sunicapps. If Plus didn't turn on or you need your Stars back — we'll help.",
        'tv_off' => 'The TV is offline — open Lampa on it and the button will work.',
        'which' => 'Which TV should it play on?',
        'kb' => '📋 Menu', 'b_find' => '🔎 Find', 'b_tvs' => '📺 TVs', 'b_help' => '❓ Help', 'b_set' => '⚙️ Settings',
        'b_plus' => '⭐ Sunic Apps Plus', 'b_renew' => '⭐ Renew for 30 days — %d ⭐', 'b_back' => '⬅️ Settings', 'b_menu' => '📋 Menu',
        'b_watch' => '▶️ Watch', 'b_open' => '📺 Open on TV', 'opened' => 'Opening on the TV «%s»',
        'menu' => "%s\n\nChoose a section:", 'tv_on' => '📺 Online: %s', 'tv_wait' => '📺 The TV is offline now — search and «Watch» work: the movie starts when Lampa opens on the TV. Bookmarks, subscriptions and «This week» — while Lampa is open.',
        'find' => '🔎 Send a movie or series title — for example, «Sintel».',
        'settings' => "⚙️ Settings\n\n⭐ Sunic Apps Plus: %s", 'until' => 'until %s', 'ended' => 'ended',
        'help' => "❓ Help\n\n🔎 Send a title — I reply with a card and poster.\n▶️ «Watch» — the movie starts on the TV, 📺 «Open on TV» — its card opens.\nWhile Lampa is open on the TV, bookmarks, subscriptions and «This week» work too.\n\n⭐ Sunic Apps Plus — «⚙️ Settings» or /plus\n💬 Questions, help and news: https://t.me/sunicapps",
        'menu_off' => "The menu, bookmarks and subscriptions work while Lampa is open on the TV.
The TV is offline now. Send a movie title — I'll find it and it will start when the TV is on.",
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
        'slow' => "Juda tez-tez — bir daqiqa kuting va qayta yozing.",
        'refunded' => "Sunic Apps Plus to'lovi qaytarildi — obuna bekor qilindi.",
        'paysupport' => "Sunic Apps Plus to'lovi bo'yicha savollar — https://t.me/sunicapps guruhiga yozing. Plus yoqilmagan bo'lsa yoki Stars'ni qaytarish kerak bo'lsa — yordam beramiz.",
        'tv_off' => "Televizor aloqada emas — unda Lampa ni oching, tugma ishlaydi.",
        'which' => "Qaysi televizorda yoqay?",
        'kb' => '📋 Menyu', 'b_find' => '🔎 Topish', 'b_tvs' => '📺 Televizorlar', 'b_help' => '❓ Yordam', 'b_set' => '⚙️ Sozlamalar',
        'b_plus' => '⭐ Sunic Apps Plus', 'b_renew' => '⭐ 30 kunga uzaytirish — %d ⭐', 'b_back' => '⬅️ Sozlamalar', 'b_menu' => '📋 Menyu',
        'b_watch' => "▶️ Ko'rish", 'b_open' => "📺 TV'da ochish", 'opened' => "«%s» televizorida ochyapman",
        'menu' => "%s\n\nBo'limni tanlang:", 'tv_on' => '📺 Aloqada: %s', 'tv_wait' => "📺 Televizor hozir aloqada emas — qidiruv va «Ko'rish» ishlaydi: film televizorda Lampa ochilganda yoqiladi. Xatcho'plar, obunalar va «Bu hafta» — Lampa ochiq bo'lganda.",
        'find' => "🔎 Film yoki serial nomini yozing — masalan, «Sintel».",
        'settings' => "⚙️ Sozlamalar\n\n⭐ Sunic Apps Plus: %s", 'until' => '%s gacha', 'ended' => 'tugagan',
        'help' => "❓ Yordam\n\n🔎 Nomini yozing — poster bilan kartochka yuboraman.\n▶️ «Ko'rish» — film televizorda yoqiladi, 📺 «TV'da ochish» — uning kartochkasi ochiladi.\nTelevizorda Lampa ochiq bo'lsa, xatcho'plar, obunalar va «Bu hafta» ham ishlaydi.\n\n⭐ Sunic Apps Plus — «⚙️ Sozlamalar» yoki /plus\n💬 Savollar, yordam va yangiliklar: https://t.me/sunicapps",
        'menu_off' => "Menyu, xatcho'plar va obunalar televizorda Lampa ochiq bo'lganda ishlaydi.
Hozir televizor aloqada emas. Film nomini yozing — topaman, televizor yoqilganda u ishga tushadi.",
    ],
];
function lang_of($from) {
    $c = strtolower(substr((string) ($from['language_code'] ?? 'ru'), 0, 2));
    return $c === 'uz' ? 'uz' : ($c === 'en' || !in_array($c, ['ru', 'uk', 'be', 'kk', 'ky', 'tg'], true) ? 'en' : 'ru');
}
function t($l, $k) { return T[$l][$k] ?? T['ru'][$k]; }
function day($ts) { return date('d.m.Y', $ts); }
function say($chat, $text, $kb = null) { tg('sendMessage', ['chat_id' => $chat, 'text' => $text] + ($kb ? ['reply_markup' => ['inline_keyboard' => $kb]] : [])); }
/** Как у бесплатного бота: постоянная кнопка «📋 Меню» внизу чата. */
function reply_kb($l) { return ['keyboard' => [[['text' => t($l, 'kb')]]], 'resize_keyboard' => true, 'is_persistent' => true]; }
function say_kb($chat, $l, $text) { tg('sendMessage', ['chat_id' => $chat, 'text' => $text, 'reply_markup' => reply_kb($l)]); }
/** Экран из кнопки — меняем её сообщение на месте (чат не растёт); без кнопки — новое сообщение. */
function screen($chat, $mid, $text, $kb) {
    if ($mid) { $r = tg('editMessageText', ['chat_id' => $chat, 'message_id' => $mid, 'text' => $text, 'reply_markup' => ['inline_keyboard' => $kb]]); if (!empty($r['ok'])) return; }
    say($chat, $text, $kb);
}
function sv_btn($l, $k, $a) { return ['text' => t($l, $k), 'callback_data' => 'sv:' . $a]; }

housekeeping();

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
    if (isset($u['callback_query'])) return (bool) preg_match('/^([swto]:\d+:\d+(:[A-Za-z0-9]{12,40})?|u:[A-Za-z0-9]{12,40}|sv:[a-z]+|noop)$/', (string) ($u['callback_query']['data'] ?? ''));
    $m = $u['message'] ?? null;
    if (!$m || isset($m['successful_payment']) || isset($m['refunded_payment'])) return true;
    return (bool) preg_match('/^\/(start\s+tv[A-Z0-9]{10}|plus|tv|paysupport|plustest)\b/', trim((string) ($m['text'] ?? '')));
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
    $kb = [[['text' => t($l, 'b_watch'), 'callback_data' => "w:$sid:$i"], ['text' => t($l, 'b_open'), 'callback_data' => "o:$sid:$i"]]];
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
    q('INSERT INTO searches (chat_id, items, at) VALUES (?, ?, ?)', [$chat, json_encode($items, JSON_UNESCAPED_UNICODE), time()]);
    $sid = (int) db()->lastInsertId();
    list($cap, $kb, $poster) = card_msg($l, $sid, $items, 0);
    if ($poster) tg('sendPhoto', ['chat_id' => $chat, 'photo' => $poster, 'caption' => $cap, 'reply_markup' => ['inline_keyboard' => $kb]]);
    else say($chat, $cap, $kb);
}

function tv_list($chat, $l) {
    $tvs = q('SELECT id, name FROM tvs WHERE chat_id = ?', [$chat])->fetchAll();
    if (!$tvs) return say($chat, t($l, 'no_tv'));
    $kb = array_map(function ($r) use ($l) { return [['text' => sprintf(t($l, 'unlink'), $r['name'] ?: 'TV'), 'callback_data' => 'u:' . $r['id']]]; }, $tvs);
    say($chat, sprintf(t($l, 'tvs'), implode("\n", array_map(function ($r) { return '📺 ' . ($r['name'] ?: 'TV'); }, $tvs))), $kb);
}

function link_tv($chat, $l, $code) {
    $tv = q('SELECT * FROM tvs WHERE pair_code = ? AND pair_until >= ?', [$code, time()])->fetch();
    if (!$tv) return say($chat, t($l, 'pair_old'));
    q('UPDATE tvs SET chat_id = ?, pair_code = NULL WHERE id = ?', [$chat, $tv['id']]);
    if (!q('SELECT 1 FROM users WHERE chat_id = ?', [$chat])->fetch()) q('INSERT INTO users (chat_id, trial_until, paid_until, lang) VALUES (?, ?, 0, ?)', [$chat, time() + TRIAL_DAYS * 86400, $l]);
    say_kb($chat, $l, sprintf(t($l, 'linked'), $tv['name'] ?: 'TV', day(plus_until($chat))));
}

function server_menu($chat, $l, $mid = 0) {
    $tvs = q('SELECT id, name FROM tvs WHERE chat_id = ?', [$chat])->fetchAll();
    if (!$tvs) return screen($chat, $mid, t($l, 'no_tv'), [[sv_btn($l, 'b_help', 'help'), sv_btn($l, 'b_set', 'set')]]);
    $on = relay_tv($chat) ? sprintf(t($l, 'tv_on'), implode(', ', array_map(function ($r) { return $r['name'] ?: 'TV'; }, $tvs))) : t($l, 'tv_wait');
    screen($chat, $mid, sprintf(t($l, 'menu'), $on), [[sv_btn($l, 'b_find', 'find'), sv_btn($l, 'b_tvs', 'tvs')], [sv_btn($l, 'b_help', 'help'), sv_btn($l, 'b_set', 'set')]]);
}
function plus_state($chat, $l) { $u = plus_until($chat); return $u > time() ? sprintf(t($l, 'until'), day($u)) : t($l, 'ended'); }
function server_settings($chat, $l, $mid = 0) {
    screen($chat, $mid, sprintf(t($l, 'settings'), plus_state($chat, $l)), [[sv_btn($l, 'b_plus', 'plus')], [sv_btn($l, 'b_tvs', 'tvs'), sv_btn($l, 'b_menu', 'menu')]]);
}
/** «⭐ Sunic Apps Plus»: срок и «Продлить» — и пока действует (оплата добавляет 30 дней к концу срока). Назад — в
 *  настройки бота на ТВ, если он на связи (оттуда и пришли), иначе — в настройки сервера. */
function plus_screen($chat, $l, $mid = 0) {
    $until = plus_until($chat);
    $text = $until > time() ? sprintf(t($l, 'plus_on'), day($until)) : sprintf(t($l, 'plus_off'), PLUS_STARS);
    $back = relay_tv($chat) ? ['text' => t($l, 'b_back'), 'callback_data' => 'st:main'] : sv_btn($l, 'b_back', 'set');
    screen($chat, $mid, $text, [[['text' => sprintf(t($l, 'b_renew'), PLUS_STARS), 'callback_data' => 'sv:pay']], [$back]]);
}
function send_invoice($chat, $l) {
    tg('sendInvoice', ['chat_id' => $chat, 'title' => t($l, 'pay_title'), 'description' => t($l, 'pay_desc'), 'payload' => 'plus30',
        'currency' => 'XTR', 'prices' => [['label' => t($l, 'pay_title'), 'amount' => PLUS_STARS]]]);
}
function plus_info($chat, $l) {
    if (plus_until($chat) > time()) return plus_screen($chat, $l);
    say($chat, sprintf(t($l, 'plus_off'), PLUS_STARS));
    send_invoice($chat, $l);
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
    $mid = (int) ($c['message']['message_id'] ?? 0);
    if (preg_match('/^sv:([a-z]+)$/', $data, $m)) {
        if ($m[1] === 'menu') server_menu($chat, $l, $mid);
        elseif ($m[1] === 'set') server_settings($chat, $l, $mid);
        elseif ($m[1] === 'plus') plus_screen($chat, $l, $mid);
        elseif ($m[1] === 'pay') send_invoice($chat, $l);
        elseif ($m[1] === 'help') screen($chat, $mid, t($l, 'help'), [[sv_btn($l, 'b_menu', 'menu')]]);
        elseif ($m[1] === 'find') say($chat, t($l, 'find'));
        elseif ($m[1] === 'tvs') tv_list($chat, $l);
        tg('answerCallbackQuery', $answer);
        exit;
    }
    if (preg_match('/^([swto]):(\d+):(\d+)(?::([A-Za-z0-9]{12,40}))?$/', $data, $m)) {
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
            elseif (count($tvs) === 1 || $m[1] === 'o') $tv = $tvs[0] ?? null;   // «Открыть» — на ТВ, который был на связи последним
            if (!$tvs) { $answer['text'] = t($l, 'no_tv'); $answer['show_alert'] = true; }
            elseif (plus_until($chat) < time()) { $answer['text'] = t($l, 'expired'); $answer['show_alert'] = true; }
            elseif (!$tv) {
                $kb = array_map(function ($x) use ($m, $i) { return [['text' => '📺 ' . ($x['name'] ?: 'TV'), 'callback_data' => 't:' . $m[2] . ':' . $i . ':' . $x['id']]]; }, array_slice($tvs, 0, 6));
                tg('editMessageReplyMarkup', ['chat_id' => $chat, 'message_id' => $c['message']['message_id'], 'reply_markup' => ['inline_keyboard' => $kb]]);
                $answer['text'] = t($l, 'which');
            } else {
                q('INSERT INTO cmds (tv_id, body, at) VALUES (?, ?, ?)', [$tv['id'], json_encode(['t' => 'open', 'kind' => $items[$i]['kind'], 'id' => $items[$i]['id'], 'play' => $m[1] !== 'o']), time()]);
                $answer['text'] = sprintf(t($l, $m[1] === 'o' ? 'opened' : 'sent'), $tv['name'] ?: 'TV');
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

if (isset($msg['refunded_payment'])) {                  // Stars вернули — оплаченный срок снимаем (пробный месяц остаётся)
    if (($msg['refunded_payment']['invoice_payload'] ?? '') === 'plus30') { q('UPDATE users SET paid_until = 0 WHERE chat_id = ?', [$chat]); say($chat, t($l, 'refunded')); }
    exit;
}
if (isset($msg['successful_payment'])) {
    $p = $msg['successful_payment'];
    if (($p['invoice_payload'] ?? '') === 'plus30' && ($p['currency'] ?? '') === 'XTR') {
        $from = max(time(), plus_until($chat));
        if (!q('SELECT 1 FROM users WHERE chat_id = ?', [$chat])->fetch()) q('INSERT INTO users (chat_id, trial_until, paid_until, lang) VALUES (?, 0, 0, ?)', [$chat, $l]);
        q('UPDATE users SET paid_until = ? WHERE chat_id = ?', [$from + PLUS_DAYS * 86400, $chat]);
        // номер платежа — чтобы вернуть Stars по просьбе (/paysupport) и при споре
        q('INSERT INTO payments (chat_id, charge_id, stars, at) VALUES (?, ?, ?, ?)', [$chat, (string) ($p['telegram_payment_charge_id'] ?? ''), (int) ($p['total_amount'] ?? 0), time()]);
        say($chat, sprintf(t($l, 'paid'), day($from + PLUS_DAYS * 86400)));
    }
    exit;
}

$text = trim((string) ($msg['text'] ?? ''));
if ($text === '') exit;
if (preg_match('/^\/start(?:\s+tv([A-Z0-9]{10}))?$/', $text, $m)) { empty($m[1]) ? say_kb($chat, $l, t($l, 'hello')) : link_tv($chat, $l, $m[1]); exit; }
if ($text === '/menu' || in_array($text, ['📋 Меню', '📋 Menu', '📋 Menyu'], true)) { server_menu($chat, $l); exit; }
if ($text === '/settings') { server_settings($chat, $l); exit; }
if ($text === '/help') { screen($chat, 0, t($l, 'help'), [[sv_btn($l, 'b_menu', 'menu')]]); exit; }
if ($text === '/plus') { plus_info($chat, $l); exit; }
// правило Telegram для оплаты Stars: у бота должна быть /paysupport — куда писать по оплате
if ($text === '/paysupport') { say($chat, t($l, 'paysupport')); exit; }
/* Проверка оплаты владельцем: работает, только пока на хостинге лежит private/plus-test-allow (кладём на время
 * теста и убираем). «end» — пробный месяц и оплата этого чата закончились (прежний срок запоминается);
 * «refund» — вернуть Stars последнего платежа этого чата; «back» — вернуть прежний срок. */
if (preg_match('/^\/plustest\s+(end|refund|back)$/', $text, $m) && is_file(PRIVATE_DIR . '/plus-test-allow')) {
    $u0 = q('SELECT trial_until, paid_until FROM users WHERE chat_id = ?', [$chat])->fetch();
    if (!$u0) { say($chat, 'plustest: чат не привязан'); exit; }
    if ($m[1] === 'end') {
        q('INSERT OR REPLACE INTO rate (k, n, until) VALUES (?, ?, ?)', ['plustest:' . $chat, 0, (int) $u0['trial_until']]);
        q('UPDATE users SET trial_until = 1, paid_until = 0 WHERE chat_id = ?', [$chat]);
        say($chat, 'plustest: Plus закончился — теперь /plus');
    } elseif ($m[1] === 'refund') {
        $pay = q('SELECT charge_id FROM payments WHERE chat_id = ? ORDER BY id DESC LIMIT 1', [$chat])->fetch();
        if (!$pay || $pay['charge_id'] === '') { say($chat, 'plustest: платежей нет'); exit; }
        $r = tg('refundStarPayment', ['user_id' => $chat, 'telegram_payment_charge_id' => $pay['charge_id']]);
        say($chat, 'plustest: возврат — ' . (!empty($r['ok']) ? 'ok' : (string) ($r['description'] ?? 'ошибка')));
    } else {
        $old = q('SELECT until FROM rate WHERE k = ?', ['plustest:' . $chat])->fetch();
        if ($old) q('UPDATE users SET trial_until = ? WHERE chat_id = ?', [(int) $old['until'], $chat]);
        q('DELETE FROM rate WHERE k = ?', ['plustest:' . $chat]);
        say($chat, 'plustest: срок вернул — ' . day(plus_until($chat)));
    }
    exit;
}
if ($text === '/tv') { tv_list($chat, $l); exit; }
if ($text[0] === '/') { say($chat, t($l, 'hello')); exit; }
// кнопки бота на ТВ («📋 Меню», «⭐ Закладки»…: начинаются со значка), а ТВ не на связи — не искать фильм с таким названием
if (preg_match('/^\p{So}/u', $text) && q('SELECT 1 FROM tvs WHERE chat_id = ?', [$chat])->fetch()) { say($chat, t($l, 'menu_off')); exit; }
if (!rate_ok('search:' . $chat, 20, 60)) { say($chat, t($l, 'slow')); exit; }   // поиск: не чаще 20 в минуту на чат
search($chat, $l, mb_substr($text, 0, 100));
