import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { forward, ORIGIN } from '../src/index.js';

const noSleep = async () => {};
const SECRET = 'a'.repeat(48);

test('передача: хостинг принял с первого раза — одна попытка, заголовок секрета как есть', async () => {
    const calls = [];
    const code = await forward('{"update_id":1}', SECRET, { sleep: noSleep, fetch: async (u, o) => { calls.push([u, o]); return { status: 200 }; } });
    assert.equal(code, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], ORIGIN);
    assert.equal(calls[0][1].headers['X-Telegram-Bot-Api-Secret-Token'], SECRET);
    assert.equal(calls[0][1].body, '{"update_id":1}');
});
test('передача: хостинг не ответил, потом 503 — повторяем, третья попытка проходит', async () => {
    let n = 0;
    const code = await forward('{}', SECRET, { sleep: noSleep, fetch: async () => { n++; if (n === 1) throw new Error('timeout'); return { status: n === 2 ? 503 : 200 }; } });
    assert.equal(code, 200);
    assert.equal(n, 3);
});
test('передача: 403 (чужой секрет) — не повторяем', async () => {
    let n = 0;
    assert.equal(await forward('{}', SECRET, { sleep: noSleep, fetch: async () => { n++; return { status: 403 }; } }), 403);
    assert.equal(n, 1);
});
test('передача: хостинг лежит — три попытки и 0', async () => {
    let n = 0;
    assert.equal(await forward('{}', SECRET, { sleep: noSleep, fetch: async () => { n++; throw new Error('down'); } }), 0);
    assert.equal(n, 3);
});
test('вебхук: без секрета — 403, чужой путь — 404, сообщение — сразу пустой 200', async () => {
    const waited = [];
    const ctx = { waitUntil: p => waited.push(p) };
    const req = (path, headers = {}, method = 'POST') => new Request('https://x.workers.dev' + path, { method, headers, body: method === 'POST' ? '{"update_id":5}' : undefined });
    assert.equal((await worker.fetch(req('/hook'), {}, ctx)).status, 403);
    assert.equal((await worker.fetch(req('/other', { 'X-Telegram-Bot-Api-Secret-Token': SECRET }), {}, ctx)).status, 404);
    assert.equal(waited.length, 0);
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ status: 200 });
    try {
        const r = await worker.fetch(req('/hook', { 'X-Telegram-Bot-Api-Secret-Token': SECRET }), {}, ctx);
        assert.equal(r.status, 200);
        assert.equal(await r.text(), '');
        assert.equal(waited.length, 1);
        assert.equal(await waited[0], 200);
    } finally { globalThis.fetch = realFetch; }
});
