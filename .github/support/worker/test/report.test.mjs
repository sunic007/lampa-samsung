import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReport, reportBody, reportTitle, handleReport, pollNtfy, REPORT_PER_DEVICE } from '../src/report.js';

function env() {
    const kv = new Map(), calls = [];
    let n = 100;
    const gh = async (method, path, body) => {
        calls.push({ method, path, body });
        if (path.endsWith('/labels')) return {};
        if (path.endsWith('/comments')) return {};
        n++;
        return { number: n, html_url: 'https://github.com/sunic007/lampa-samsung/issues/' + n };
    };
    const store = { get: async k => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } };
    return { gh, store, calls, kv, issues: () => calls.filter(c => c.path.endsWith('/issues')) };
}
const rep = (o = {}) => JSON.stringify(Object.assign({ v: 1, kind: 'video', device: 'abcdef1234567890',
    meta: { tv: 'QE55Q60BAU', tizen: '6.5', sunic: '2.2.6', lampa: '3.3.7', player: 'плеер Lampa: tizen' },
    log: '1s BSGuard зависание: не запускается шаг 1\n2s токен 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ' }, o));

test('отчёт: мусор и чужие виды отбрасываем', () => {
    assert.equal(parseReport('не json'), null);
    assert.equal(parseReport(rep({ kind: 'hack' })), null);
    assert.equal(parseReport(rep({ device: '../x' })), null);
});
test('отчёт: токены из журнала и полей убраны, таблицу не ломают', () => {
    const r = parseReport(rep({ meta: { tv: 'QE55 | <b>x</b>\nстрока', sunic: '2.2.6' } }));
    assert.doesNotMatch(r.log, /AAHdqTcv/);
    assert.match(r.log, /\[токен бота\]/);
    assert.doesNotMatch(r.meta.tv, /[|\n]/);
});
test('отчёт: задача с моделью, версией, журналом в свёрнутом блоке', () => {
    const r = parseReport(rep({ log: 'a ``` b' }));
    assert.equal(reportTitle(r), '[ТВ] Видео не запускается — QE55Q60BAU, Sunic Apps 2.2.6');
    const b = reportBody(r, 'h1');
    assert.match(b, /<details>/);
    assert.match(b, /\| ТВ \| QE55Q60BAU \|/);
    assert.equal((b.match(/```/g) || []).length, 2);          // ``` из журнала не закрывает блок
    assert.match(b, /tv-report:h1/);
});
test('отчёт: создаёт задачу с метками from-tv и bug', async () => {
    const e = env();
    const res = await handleReport(rep(), { gh: e.gh, store: e.store, ip: '1.2.3.4' });
    assert.equal(res.ok, true);
    assert.equal(res.number, 101);
    assert.deepEqual(e.issues()[0].body.labels, ['from-tv', 'bug']);
    assert.equal(e.issues()[0].path, '/repos/sunic007/lampa-samsung/issues');
});
test('отчёт: тот же ТВ и та же проблема — комментарий в ту же задачу', async () => {
    const e = env();
    await handleReport(rep(), { gh: e.gh, store: e.store, ip: '1.2.3.4' });
    const res = await handleReport(rep(), { gh: e.gh, store: e.store, ip: '1.2.3.4' });
    assert.equal(res.dup, true);
    assert.equal(res.number, 101);
    assert.equal(e.issues().length, 1);
    assert.equal(e.calls.filter(c => c.path.endsWith('/comments')).length, 1);
});
test('отчёт: лимит на ТВ в сутки и на IP', async () => {
    const e = env(), kinds = ['video', 'stall', 'missing', 'bot', 'update', 'other'];
    const out = [];
    for (const k of kinds) out.push(await handleReport(rep({ kind: k }), { gh: e.gh, store: e.store, ip: '' }));
    assert.equal(out.filter(r => r.ok).length, REPORT_PER_DEVICE);
    assert.equal(out[out.length - 1].error, 'limit');
    const e2 = env(), ip = [];
    for (let i = 0; i < 8; i++) ip.push(await handleReport(rep({ device: 'dev' + i + 'xxxxxxxx' }), { gh: e2.gh, store: e2.store, ip: '5.6.7.8' }));
    assert.equal(ip.filter(r => r.ok).length, 6);
});
test('ntfy: забирает отчёты, вложения по ссылке, since сдвигает', async () => {
    const e = env();
    const lines = [
        JSON.stringify({ event: 'open' }),
        JSON.stringify({ event: 'message', id: 'm1', message: rep() }),
        JSON.stringify({ event: 'message', id: 'm2', message: 'You received a file', attachment: { url: 'https://ntfy.sh/file/abc.txt' } }),
    ].join('\n');
    const fetched = [];
    const n = await pollNtfy({ gh: e.gh, store: e.store }, async url => { fetched.push(url); return url.includes('/file/') ? rep({ kind: 'stall' }) : lines; });
    assert.equal(n, 2);
    assert.equal(e.issues().length, 2);
    assert.match(fetched[0], /since=12h/);
    assert.equal(e.kv.get('rep:since'), 'm2');
    await pollNtfy({ gh: e.gh, store: e.store }, async url => { fetched.push(url); return ''; });
    assert.match(fetched[fetched.length - 1], /since=m2/);
});
test('ntfy: больше max — остальное в следующий раз', async () => {
    const e = env();
    const lines = [1, 2, 3].map(i => JSON.stringify({ event: 'message', id: 'm' + i, message: rep({ device: 'device' + i + 'xxxxx' }) })).join('\n');
    assert.equal(await pollNtfy({ gh: e.gh, store: e.store }, async () => lines, 2), 2);
    assert.equal(e.kv.get('rep:since'), 'm2');
});
