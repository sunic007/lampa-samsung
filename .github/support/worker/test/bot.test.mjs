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
    assert.match(m[0].text, /Через TV Installer/);
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
