// node --test .github/support/worker/test/  — логика бота на Worker; эталоны — из bot.py (метки и очистка должны
// совпадать: метки читает bot.py notify).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../src/bot.js';

const NOW = 1800000000;
const GROUP = { id: -1001234567890, type: 'supergroup', username: 'sunicapps' };
const ME = { id: 999, username: 'sunicapps_news_bot' };
const msg = (text, extra = {}) => Object.assign({ message_id: 10, date: NOW - 60, chat: GROUP, text, from: { id: 42, is_bot: false, language_code: 'ru' } }, extra);

function env(llmAnswer, opts = {}) {
    const sent = [], ghCalls = [], issues = opts.issues || [];
    const tg = async (method, p) => { sent.push([method, p]); return method === 'sendMessage' ? { message_id: 900 + sent.length } : true; };
    const gh = async (method, path, body) => {
        ghCalls.push([method, path, body]);
        if (method === 'GET' && /\/issues\?labels=/.test(path)) return issues;
        if (method === 'POST' && /\/issues$/.test(path)) return { number: 101, html_url: 'https://github.com/x/issues/101' };
        if (method === 'GET' && /\/issues\/\d+$/.test(path)) return opts.issue || { state: 'open', labels: [{ name: 'from-telegram' }] };
        if (method === 'GET' && /\/comments/.test(path)) return opts.comments || [];
        return {};
    };
    const llm = async () => { if (llmAnswer instanceof Error) throw llmAnswer; return { text: JSON.stringify(llmAnswer), requests: 1 }; };
    const bot = new B.Bot({ tg, gh, llm, kb: 'KB', me: ME, hasGh: opts.hasGh !== false, hasLlm: llmAnswer !== null }, { secret: 's3cret' }, opts.state || null, () => NOW);
    return { bot, sent, ghCalls, msgs: () => sent.filter(s => s[0] === 'sendMessage').map(s => s[1]) };
}

test('метки и подпись оценки — как в bot.py', async () => {
    assert.equal(B.makeMarker(-1001234567890, 55, 'ru', 7), '<!-- tg:chat=-1001234567890;msg=55;lang=ru;thr=7 -->');
    assert.equal(await B.rateMarker('s3cret', 'sunic007/lampa-samsung', 3, 42), '<!-- tg-rate:0bc4cbbcb5860002 -->');
});
test('очистка личных данных — как в bot.py', () => {
    assert.equal(B.sanitize('Мой номер +998 90 123 45 67, почта a.b@mail.ru, токен 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw, ip 85.10.20.30 и 192.168.1.5, @someone и @sunicapps код ABCD-EF12-3456'),
        'Мой номер [телефон], почта [почта], токен [токен бота], ip 85.10.20.x и 192.168.1.5, @… и @sunicapps код [код]');
});
test('похожие задачи, «спасибо», язык, правила — как в bot.py', () => {
    assert.equal(B.similar('Не запускается видео после обновления', 'Видео не запускается после обновления Lampa'), true);
    assert.equal(B.similar('Тёмная тема в TV Installer', 'Не видит телевизор'), false);
    assert.equal(B.THANKS.test('Спасибо!'), true);
    assert.equal(B.THANKS.test('Большое спасибо'), false);
    assert.deepEqual(['Как установить?', 'Lampa ishlamayapti', 'It does not work', 'Ўрнатиш'].map(B.detectLang), ['ru', 'uz', 'en', 'uz']);
    assert.deepEqual(['TV Installer не видит телевизор', 'Добавьте тёмную тему в лампу', 'Как подключить бота?', 'Плагин на Lampa BS не грузится']
        .map(x => B.keywordClassify(x)).map(c => c.kind + '/' + c.product), ['bug/tvinstaller', 'suggestion/unknown', 'question_unknown/lampa', 'bug/android']);
    assert.equal(B.fallbackTitle('Видео не запускается. Уже пробовал всё'), 'Видео не запускается.');
    assert.equal(B.cut('а'.repeat(100), 80), 'а'.repeat(79) + '…');
});
test('вопрос — ответ по справке с подсказкой', async () => {
    const e = env({ kind: 'question', product: 'lampa', lang: 'ru', title: '', answer: 'Через TV Installer: подготовьте ТВ и установите.' });
    await e.bot.handleMessage(msg('Как установить Lampa?'));
    const m = e.msgs();
    assert.equal(m.length, 1);
    assert.ok(m[0].text.includes('Через <a href="https://github.com/sunic007/tvinstaller">TV Installer</a>'));
    assert.match(m[0].text, /Не помогло\?/);
    assert.equal(m[0].reply_parameters.message_id, 10);
});
test('ошибка — задача с метками и «мы приняли»', async () => {
    const e = env({ kind: 'bug', product: 'tvinstaller', lang: 'ru', title: 'Не видит телевизор', answer: '' });
    await e.bot.handleMessage(msg('TV Installer не видит телевизор, мой номер +998 90 123 45 67'));
    const create = e.ghCalls.find(c => c[0] === 'POST' && /sunic007\/tvinstaller\/issues$/.test(c[1]));
    assert.ok(create);
    assert.deepEqual(create[2].labels, ['from-telegram', 'bug']);
    assert.match(create[2].body, /<!-- tg:chat=-1001234567890;msg=10;lang=ru -->/);
    assert.doesNotMatch(create[2].body, /998 90/);
    assert.match(e.msgs()[0].text, /Мы приняли ваше сообщение об ошибке/);
});
test('похожая уже есть — комментарий туда, «похожее уже передано»', async () => {
    const e = env({ kind: 'bug', product: 'lampa', lang: 'ru', title: 'Не запускается видео после обновления' },
        { issues: [{ number: 7, title: 'Видео не запускается после обновления Lampa', html_url: 'https://github.com/sunic007/lampa-samsung/issues/7' }] });
    await e.bot.handleMessage(msg('Не запускается видео после обновления'));
    assert.ok(e.ghCalls.some(c => c[0] === 'POST' && /issues\/7\/comments$/.test(c[1])));
    assert.match(e.msgs()[0].text, /Похожее уже передано/);
});
test('Android — задача в lampa-samsung', async () => {
    const e = env({ kind: 'bug', product: 'android', lang: 'ru', title: 'Плагин не грузится' });
    await e.bot.handleMessage(msg('Плагин на Lampa BS не грузится'));
    assert.ok(e.ghCalls.some(c => c[0] === 'POST' && /sunic007\/lampa-samsung\/issues$/.test(c[1])));
});
test('ответ на сообщение бота со ссылкой на задачу — дополнение, закрытая открывается', async () => {
    const botMsg = { from: { id: 999 }, text: 'Готово', entities: [{ type: 'text_link', url: 'https://github.com/sunic007/lampa-samsung/issues/12' }] };
    const e = env(null, { issue: { state: 'closed', state_reason: 'completed', labels: [] } });
    const r = await e.bot.handleMessage(msg('Всё ещё не работает', { reply_to_message: botMsg }));
    assert.equal(r.kind, 'followup');
    assert.ok(e.ghCalls.some(c => c[0] === 'PATCH' && /issues\/12$/.test(c[1])));
    assert.match(e.msgs()[0].text, /добавил к/);
});
test('разговор людей, чужие чаты, старые и служебные — молчим', async () => {
    const e = env({ kind: 'bug' });
    await e.bot.handleMessage(msg('ответ соседу', { reply_to_message: { from: { id: 5 }, text: 'x' } }));
    await e.bot.handleMessage(msg('ошибка', { chat: { id: 1, type: 'supergroup', username: 'other' } }));
    await e.bot.handleMessage(msg('не работает', { date: NOW - 3 * 86400 }));
    await e.bot.handleMessage(msg('/start'));
    assert.equal(e.sent.length, 0);
});
test('анонимный администратор («от имени группы») — тоже человек, бот отвечает', async () => {
    const e = env({ kind: 'question', product: 'lampa', lang: 'ru', answer: 'Через TV Installer: подготовьте ТВ и установите.' });
    await e.bot.handleMessage(msg('Как установить Lampa?', { from: { id: 1087968824, is_bot: true, username: 'GroupAnonymousBot' }, sender_chat: GROUP }));
    assert.equal(e.msgs().length, 1);
    const e2 = env({ kind: 'question', answer: 'x'.repeat(20) });
    await e2.bot.handleMessage(msg('Как установить Lampa?', { from: { id: 5, is_bot: true, username: 'otherbot' } }));
    assert.equal(e2.msgs().length, 0);
});
test('ссылки: названия проектов — скрытыми ссылками на GitHub, адрес плагина — виден', () => {
    const s = B.linkify(B.escHtml('Поставьте TV Installer, затем Lampa для Samsung. Для Android — Sunic Apps для Lampa на Android: https://sunic007.github.io/lampa-android/sunic.js. TV Installer бесплатный. Скачать: https://github.com/sunic007/tvinstaller/releases/latest/download/SunicTvInstaller.apk'));
    assert.ok(s.includes('<a href="https://github.com/sunic007/tvinstaller">TV Installer</a>, затем'));
    assert.ok(s.includes('<a href="https://github.com/sunic007/lampa-samsung">Lampa для Samsung</a>'));
    assert.ok(s.includes('<a href="https://github.com/sunic007/lampa-android">Sunic Apps для Lampa на Android</a>'));
    assert.ok(s.includes(' https://sunic007.github.io/lampa-android/sunic.js'));       // вставлять руками — виден
    assert.equal(s.split('>TV Installer</a>').length - 1, 1);                           // только первое упоминание
    assert.ok(s.includes('<a href="https://github.com/sunic007/tvinstaller/releases/latest/download/SunicTvInstaller.apk">скачать TV Installer</a>'));
    assert.equal(B.linkify('Lampa на Android uchun plagin'), '<a href="https://github.com/sunic007/lampa-android">Lampa на Android uchun</a> plagin');
});
test('/id в личке — номер чата', async () => {
    const e = env(null);
    await e.bot.handleMessage({ message_id: 1, date: NOW, chat: { id: 555, type: 'private' }, text: '/id', from: { id: 555 } });
    assert.match(e.msgs()[0].text, /555/);
});
test('лимиты: человек исчерпал ИИ — правила по словам; задач больше 5 в сутки — нет', async () => {
    const day = new Date(NOW * 1000).toISOString().slice(0, 10);
    let called = false;
    const e = env({ kind: 'bug' }, { state: { day, llm: 0, u: { 42: 20 }, t: { 42: 5 } } });
    e.bot.llm = async () => { called = true; return { text: '{}' }; };
    const r = await e.bot.handleMessage(msg('TV Installer не видит телевизор'));
    assert.equal(called, false);
    assert.equal(r.source, 'rules');
    assert.ok(!e.ghCalls.some(c => c[0] === 'POST'));
});
test('ИИ упал — правила по словам, суточный счёт растёт', async () => {
    const err = new Error('llm: HTTP 503'); err.requests = 3;
    const e = env(err);
    const r = await e.bot.handleMessage(msg('Добавьте тёмную тему, пожалуйста'));
    assert.equal(r.source, 'rules');
    assert.equal(e.bot.state.llm, 3);
});
test('оценка ⭐ — комментарий с подписью, повторно — «уже оценили»', async () => {
    const q = { id: 'q1', data: 'rate:lampa-samsung:3:5', from: { id: 42 }, message: { message_id: 77, chat: GROUP, text: '✅ Готово' } };
    const e = env(null);
    assert.equal(await e.bot.handleCallback(q), 5);
    const c = e.ghCalls.find(x => x[0] === 'POST' && /issues\/3\/comments$/.test(x[1]));
    assert.match(c[2].body, /<!-- tg-rate:[0-9a-f]{16} -->/);
    const mark = /<!-- tg-rate:[0-9a-f]{16} -->/.exec(c[2].body)[0];
    const e2 = env(null, { comments: [{ body: 'x ' + mark }] });
    assert.equal(await e2.bot.handleCallback(q), 'again');
});
test('новые сутки — счётчики с нуля', () => {
    const e = env(null, { state: { day: '2000-01-01', llm: 500, u: { 1: 3 }, t: {} } });
    assert.equal(e.bot.state.llm, 0);
});

// ---------------------------------------------------------------- защита группы
function modEnv(opts = {}) {
    const sent = [], data = new Map();
    const tg = async (method, p) => {
        sent.push([method, p]);
        if (method === 'getChatMember') return { status: opts.admin ? 'administrator' : 'member' };
        if (method === 'deleteMessage' && opts.noRights) throw new Error('telegram deleteMessage: 400 message can\'t be deleted');
        return method === 'sendMessage' ? { message_id: 1 } : true;
    };
    const store = { get: async k => data.get(k) || null, put: async (k, v) => { data.set(k, v); } };
    const llm = async () => ({ text: JSON.stringify(opts.llm || { kind: 'other' }), requests: 1 });
    const bot = new B.Bot({ tg, gh: async () => ({}), llm, kb: '', me: ME, store, hasGh: false, hasLlm: !!opts.llm }, {}, null, () => NOW);
    const calls = name => sent.filter(s => s[0] === name).map(s => s[1]);
    return { bot, sent, calls, data };
}
const apk = (extra = {}) => msg('', Object.assign({ text: undefined, caption: 'Новая версия TV Installer, ставьте', document: { file_name: 'SunicTvInstaller-2.4.0.apk', mime_type: 'application/vnd.android.package-archive' } }, extra));

test('защита: чужой APK — удалён, предупреждение с официальными ссылками', async () => {
    const e = modEnv();
    const r = await e.bot.handleMessage(apk());
    assert.equal(r.kind, 'removed');
    assert.equal(e.calls('deleteMessage').length, 1);
    const w = e.calls('sendMessage')[0].text;
    assert.match(w, /удалено: в группе нельзя присылать файлы приложений/);
    assert.ok(w.includes('https://github.com/sunic007/tvinstaller/releases/latest/download/SunicTvInstaller.apk'));
    assert.equal(e.calls('restrictChatMember').length + e.calls('banChatMember').length, 0);
});
test('защита: второе нарушение — молчание на 7 дней, третье — бан', async () => {
    const e = modEnv();
    await e.bot.handleMessage(apk());
    await e.bot.handleMessage(apk({ message_id: 11 }));
    assert.equal(e.calls('restrictChatMember').length, 1);
    assert.equal(e.calls('restrictChatMember')[0].until_date, NOW + 7 * 86400);
    assert.match(e.calls('sendMessage')[1].text, /через 7 дней/);
    await e.bot.handleMessage(apk({ message_id: 12 }));
    assert.equal(e.calls('banChatMember').length, 1);
});
test('защита: администратор и анонимный администратор — не трогаем', async () => {
    const e = modEnv({ admin: true });
    await e.bot.handleMessage(apk());
    assert.equal(e.calls('deleteMessage').length, 0);
    const e2 = modEnv();
    await e2.bot.handleMessage(apk({ from: { id: 1087968824, is_bot: true, username: 'GroupAnonymousBot' }, sender_chat: GROUP }));
    assert.equal(e2.calls('deleteMessage').length + e2.calls('getChatMember').length, 0);
});
test('защита: ссылки — свои и известные можно, чужие и спрятанные под текстом нельзя', () => {
    for (const ok of ['https://github.com/sunic007/tvinstaller', 'https://sunic007.github.io/lampa-android/sunic.js', 'https://t.me/sunicapps', 't.me/sunicapps_uzb/24',
        'https://skaz.tv', 'http://online3.skaz.tv/x', 'https://youtu.be/abc', 'https://github.com/yumata/lampa']) assert.equal(B.linkAllowed(ok), true, ok);
    for (const bad of ['https://github.com/evil/tvinstaller-mod/releases/x.apk', 'https://t.me/joinchat/AAAA', 'https://t.me/other_channel', 'bit.ly/abc',
        'https://sunic007-github.io.evil.com/x', 'https://mega.nz/file/x', 'javascript:alert(1)']) assert.equal(B.linkAllowed(bad), false, bad);
    const hidden = msg('Скачать новую версию', { entities: [{ type: 'text_link', offset: 0, length: 7, url: 'https://evil.example/tvi.apk' }] });
    assert.equal(B.violation(hidden), 'link');
    const own = msg('Вот https://github.com/sunic007/tvinstaller', { entities: [{ type: 'url', offset: 4, length: 39 }] });
    assert.equal(B.violation(own), '');
});
test('защита: журнал .txt, скриншоты и обычные вопросы — можно', async () => {
    assert.equal(B.violation(msg('', { text: undefined, caption: 'журнал', document: { file_name: 'tvinstaller-log.txt', mime_type: 'text/plain' } })), '');
    assert.equal(B.violation(msg('', { text: undefined, photo: [{ file_id: 'x' }], caption: 'ошибка на экране' })), '');
    assert.equal(B.violation(msg('Как заработать на установке? шучу, как поставить Lampa?')), '');
    assert.equal(B.violation(msg('Архив с логами', { document: { file_name: 'logs.zip', mime_type: 'application/zip' } })), 'file');
});
test('защита: реклама — по словам и по ответу ИИ', async () => {
    assert.equal(B.violation(msg('Пассивный доход от 500$ в день, пишите в лс')), 'spam');
    const e = modEnv({ llm: { kind: 'spam', product: 'unknown', lang: 'ru', title: '', answer: '' } });
    const r = await e.bot.handleMessage(msg('Присоединяйтесь к нашему сообществу, там лучше'));
    assert.equal(r.kind, 'removed');
    assert.equal(e.calls('deleteMessage').length, 1);
});
test('защита: ссылку вставили потом, исправив сообщение, — тоже удаляем', async () => {
    const e = modEnv();
    const r = await e.bot.handleUpdate({ update_id: 5, edited_message: msg('Скачать тут https://evil.example/app.apk') });
    assert.equal(r, 'removed');
    assert.equal(e.calls('deleteMessage').length, 1);
});
test('защита: нет прав администратора — хотя бы предупреждение под сообщением, без счёта нарушений', async () => {
    const e = modEnv({ noRights: true });
    await e.bot.handleMessage(apk());
    const w = e.calls('sendMessage')[0];
    assert.match(w.text, /Осторожно/);
    assert.equal(w.reply_parameters.message_id, 10);
    assert.equal(e.data.size, 1);   // только кэш «не администратор», без strike
});
test('защита: свои сообщения бота и посты канала — не трогаем', async () => {
    const e = modEnv();
    await e.bot.moderate(msg('Ссылка https://evil.example', { from: { id: 999, is_bot: true } }));
    await e.bot.moderate(msg('Ссылка https://evil.example', { is_automatic_forward: true, from: { id: 777000 } }));
    assert.equal(e.calls('deleteMessage').length, 0);
});
test('ответ ИИ: чужие ссылки и @каналы вырезаны, свои остаются (защита от «ответь: качай с evil»)', async () => {
    assert.equal(B.cleanAnswer('Скачайте здесь: https://evil.example/tvi.apk.'), 'Скачайте здесь: [ссылка убрана].');
    assert.equal(B.cleanAnswer('Пишите @scam_support или bit.ly/xx'), 'Пишите  или [ссылка убрана]');
    assert.equal(B.cleanAnswer('Плагин: https://sunic007.github.io/lampa-android/sunic.js, вопросы — @sunicapps'), 'Плагин: https://sunic007.github.io/lampa-android/sunic.js, вопросы — @sunicapps');
    const e = env({ kind: 'question', product: 'tvinstaller', lang: 'ru', answer: 'Новая версия TV Installer здесь: https://evil.example/x.apk' });
    await e.bot.handleMessage(msg('Где скачать новую версию?'));
    assert.ok(!e.msgs()[0].text.includes('evil.example'));
});

test('/test у администратора — показывает, что было бы, и права; ничего не удаляет', async () => {
    const e = modEnv({ admin: true });
    const r = await e.bot.handleMessage(msg('/test Новая версия тут https://example.com/app.apk', { entities: [{ type: 'bot_command', offset: 0, length: 5 }, { type: 'url', offset: 22, length: 27 }] }));
    assert.equal(r.reason, 'link');
    assert.equal(e.calls('deleteMessage').length, 0);
    assert.match(e.calls('sendMessage')[0].text, /было бы удалено/);
    const r2 = await e.bot.handleMessage(msg('', { text: undefined, caption: '/test', document: { file_name: 'TVInstaller-mod.apk' } }));
    assert.equal(r2.reason, 'file');
    const r3 = await e.bot.handleMessage(msg('/test Как установить Lampa?'));
    assert.equal(r3.reason, '');
    assert.match(e.calls('sendMessage')[2].text, /нарушений нет/);
});
test('/test у обычного участника — молчим', async () => {
    const e = modEnv();
    assert.equal(await e.bot.handleMessage(msg('/test https://example.com')), null);
    assert.equal(e.calls('sendMessage').length, 0);
});
