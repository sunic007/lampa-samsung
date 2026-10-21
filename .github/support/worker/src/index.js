// Cloudflare Worker бота группы t.me/sunicapps. Telegram присылает каждое обновление сюда (webhook) — ответ за секунды,
// без расписаний GitHub. Логика — bot.js. Секреты (wrangler secret put / панель Cloudflare): TELEGRAM_BOT_TOKEN,
// SUPPORT_TOKEN (GitHub: Issues r/w на lampa-samsung и tvinstaller), LLM_API_KEY (Gemini), WEBHOOK_SECRET (проверка, что
// пишет именно Telegram, и ключ для /setup). KV «STATE» — суточные счётчики и справочная база.
//   POST /tg            — обновления Telegram (заголовок X-Telegram-Bot-Api-Secret-Token = WEBHOOK_SECRET)
//   GET  /setup?key=…   — подключить webhook (key = WEBHOOK_SECRET)
//   GET  /health        — жив ли (без секретов)
//   POST /report        — отчёт о проблеме с ТВ (report.js); раз в 10 минут — отчёты, пришедшие через ntfy
import { Bot } from './bot.js';
import { handleReport, pollNtfy } from './report.js';

const KB_URL = 'https://raw.githubusercontent.com/sunic007/lampa-samsung/main/.github/support/kb.txt';
const KB_LIFE = 3600;
const PROVIDERS = [
    ['AIza', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-2.5-flash-lite']],
    ['gsk_', 'https://api.groq.com/openai/v1/chat/completions', ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']],
    ['sk-or-', 'https://openrouter.ai/api/v1/chat/completions', ['google/gemini-2.5-flash-lite', 'openai/gpt-4.1-mini']],
    ['sk-', 'https://api.openai.com/v1/chat/completions', ['gpt-4.1-mini']],
];
const log = (...a) => console.log(...a);
const redact = (s, env) => String(s).split(env.TELEGRAM_BOT_TOKEN || '\u0000').join('***');

function telegram(env) {
    return async (method, params) => {
        const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params || {}), signal: AbortSignal.timeout(15000) });
        const j = await r.json().catch(() => ({}));
        if (!j.ok) throw new Error(`telegram ${method}: ${j.error_code || r.status} ${j.description || ''}`);
        return j.result;
    };
}
function github(env) {
    return async (method, path, body, ok = [200, 201, 204]) => {
        const r = await fetch('https://api.github.com' + path, {
            method, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
            headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'sunicapps-support-bot',
                Authorization: 'Bearer ' + env.SUPPORT_TOKEN, 'Content-Type': 'application/json' } });
        if (!ok.includes(r.status)) throw new Error(`github ${method} ${path.split('?')[0]}: ${r.status}`);
        return r.status === 204 ? null : r.json();
    };
}
function llmTargets(env) {
    const out = [];
    for (const key of String(env.LLM_API_KEY || '').split(',').map(s => s.trim()).filter(Boolean)) {
        const p = PROVIDERS.find(x => key.startsWith(x[0])) || PROVIDERS[0];   // неизвестный формат — ключ Gemini
        for (const m of env.LLM_MODEL ? [env.LLM_MODEL] : p[2]) out.push([env.LLM_API_URL || p[1], key, m]);
    }
    return out;
}
function llm(env) {
    const targets = llmTargets(env);
    return async messages => {
        let requests = 0, last = 'no key';
        for (const [url, key, model] of targets.slice(0, 3)) {
            const body = { model, messages, temperature: 0.2, max_tokens: 900, response_format: { type: 'json_object' } };
            for (let attempt = 0; attempt < 2; attempt++) {
                requests++;
                let r;
                try {
                    r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
                        body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
                } catch (e) { last = 'network'; break; }
                if (r.status === 200) {
                    const j = await r.json().catch(() => null);
                    const text = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
                    if (typeof text === 'string') return { text, requests };
                    last = 'bad response'; break;
                }
                if (r.status === 400 && body.response_format) { delete body.response_format; continue; }   // модель без JSON-режима
                last = 'HTTP ' + r.status; break;
            }
            log(`llm ${model}: ${last}`);
        }
        const e = new Error('llm: ' + last); e.requests = requests; throw e;
    };
}
async function knowledge(env) {
    const cached = await env.STATE.get('kb', 'json');
    if (cached && Date.now() / 1000 - cached.at < KB_LIFE) return cached.text;
    try {
        const r = await fetch(KB_URL, { signal: AbortSignal.timeout(10000) });
        if (r.ok) { const text = await r.text(); await env.STATE.put('kb', JSON.stringify({ at: Date.now() / 1000, text })); return text; }
    } catch (e) { log('kb: ' + e.message); }
    return cached ? cached.text : '';
}

async function handleTelegram(request, env) {
    if (!env.WEBHOOK_SECRET || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
    const u = await request.json().catch(() => null);
    if (!u || typeof u.update_id !== 'number') return new Response('ok');
    // Telegram повторяет обновление, если ответ не пришёл вовремя, — второй раз не обрабатываем
    // KV упал или кончилась суточная квота записей — бот всё равно отвечает (без защиты от повтора), иначе Telegram получит 500
    try {
        if (await env.STATE.get('u:' + u.update_id)) return new Response('ok');
        await env.STATE.put('u:' + u.update_id, '1', { expirationTtl: 86400 });
    } catch (e) { log('dedupe: ' + redact(e && e.message, env)); }
    const day = new Date().toISOString().slice(0, 10), stateKey = 'day:' + day;
    let state = null, me = null;
    try { state = await env.STATE.get(stateKey, 'json'); me = await env.STATE.get('me', 'json'); } catch (e) { log('state: ' + redact(e && e.message, env)); }
    const tg = telegram(env);
    try {
        if (!me) { me = await tg('getMe'); await env.STATE.put('me', JSON.stringify({ id: me.id, username: me.username }), { expirationTtl: 7 * 86400 }); }
        // кончилась суточная квота записей KV — модерация и счётчики работают дальше (запись пропускаем), а не падают молча
        const store = {
            get: k => env.STATE.get(k).catch(e => { log('kv get: ' + redact(e && e.message, env)); return null; }),
            put: (k, v, ttl) => env.STATE.put(k, v, ttl ? { expirationTtl: Math.max(60, ttl) } : undefined).catch(e => log('kv put: ' + redact(e && e.message, env)))
        };
        const bot = new Bot({ tg, gh: github(env), llm: llm(env), kb: await knowledge(env), me, log, store, hasGh: !!env.SUPPORT_TOKEN, hasLlm: llmTargets(env).length > 0 },
            { group: env.SUPPORT_GROUP || 'sunicapps', chatId: env.SUPPORT_CHAT_ID || '', secret: env.TELEGRAM_BOT_TOKEN,
                llmPerDay: +env.LLM_PER_DAY || 700, llmPerUserDay: +env.LLM_PER_USER_DAY || 20, issuesPerUserDay: +env.ISSUES_PER_USER_DAY || 5 }, state);
        const before = JSON.stringify(bot.state);
        await bot.handleUpdate(u);
        if (JSON.stringify(bot.state) !== before) await env.STATE.put(stateKey, JSON.stringify(bot.state), { expirationTtl: 3 * 86400 });
    } catch (e) {
        log('update failed: ' + redact(e && e.message, env));   // ответ Telegram — всё равно «ok», иначе он будет повторять
    }
    return new Response('ok');
}

async function setup(request, env) {
    const url = new URL(request.url);
    if (!env.WEBHOOK_SECRET || url.searchParams.get('key') !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
    const tg = telegram(env);
    await tg('setWebhook', { url: url.origin + '/tg', secret_token: env.WEBHOOK_SECRET, allowed_updates: ['message', 'edited_message', 'callback_query'], max_connections: 5 });
    const info = await tg('getWebhookInfo');
    return Response.json({ ok: true, url: info.url, pending: info.pending_update_count, last_error: info.last_error_message || '' });
}

/** Жив ли и что может: секреты есть (без значений), бот — администратор группы с правом удалять и ограничивать. */
async function health(env) {
    const out = { ok: true, bot: !!env.TELEGRAM_BOT_TOKEN, github: !!env.SUPPORT_TOKEN, ai: llmTargets(env).length > 0 };
    try {
        const tg = telegram(env), me = await tg('getMe'), chat = await tg('getChat', { chat_id: '@' + (env.SUPPORT_GROUP || 'sunicapps') });
        const m = await tg('getChatMember', { chat_id: chat.id, user_id: me.id });
        out.group = { status: m.status, can_delete: !!m.can_delete_messages, can_restrict: !!m.can_restrict_members };
    } catch (e) { out.group = { error: redact(e.message, env) }; }
    // ключ GitHub правда открывает задачи (истёк или без доступа — видно сразу): 200 — да, 401 — ключ недействителен, 403/404 — нет прав
    out.issues = {};
    for (const repo of ['sunic007/lampa-samsung', 'sunic007/tvinstaller']) {
        try {
            const r = await fetch(`https://api.github.com/repos/${repo}/issues?per_page=1`, { signal: AbortSignal.timeout(10000),
                headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'sunicapps-support-bot', Authorization: 'Bearer ' + env.SUPPORT_TOKEN } });
            out.issues[repo.split('/')[1]] = r.status;
        } catch (e) { out.issues[repo.split('/')[1]] = 'error'; }
    }
    return Response.json(out);
}

function kvStore(env) {
    return { get: k => env.STATE.get(k), put: (k, v, ttl) => env.STATE.put(k, v, ttl ? { expirationTtl: Math.max(60, ttl) } : undefined) };
}
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
async function report(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const raw = await request.text();
    if (raw.length > 60000) return Response.json({ ok: false, error: 'bad' }, { status: 413, headers: CORS });
    const res = await handleReport(raw, { gh: github(env), store: kvStore(env), ip: request.headers.get('CF-Connecting-IP') || '', log });
    const status = res.ok ? 200 : res.error === 'limit' ? 429 : res.error === 'bad' ? 400 : 502;
    return Response.json(res, { status, headers: CORS });
}
async function fetchText(url) {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('fetch ' + r.status);
    return r.text();
}

export default {
    async scheduled(event, env) {
        try { const n = await pollNtfy({ gh: github(env), store: kvStore(env), log }, fetchText); if (n) log(`ntfy: отчётов ${n}`); }
        catch (e) { log('ntfy poll: ' + e.message); }
    },
    async fetch(request, env) {
        const path = new URL(request.url).pathname;
        if (request.method === 'POST' && path === '/tg') return handleTelegram(request, env);
        if (path === '/report' && (request.method === 'POST' || request.method === 'OPTIONS')) return report(request, env).catch(e => Response.json({ ok: false, error: 'github' }, { status: 502, headers: CORS }));
        if (path === '/setup') return setup(request, env).catch(e => Response.json({ ok: false, error: redact(e.message, env) }, { status: 500 }));
        if (path === '/health') return health(env);
        return new Response('Sunic Apps support bot', { status: 404 });
    },
};
