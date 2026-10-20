// Отчёт о проблеме с ТВ (Lampa → Настройки → Sunic Apps → «Сообщить о проблеме», src/bsreport.js) → задача в
// sunic007/lampa-samsung. Приходит напрямую (POST /report) или через ntfy (ТВ не достучался до *.workers.dev — Worker
// забирает по расписанию, pollNtfy). Задача открытая — всё ещё раз чистим sanitize(), как сообщения из группы.
// Лимиты (бесплатный KV — 1000 записей в сутки): с одного ТВ — REPORT_PER_DEVICE в сутки, с одного IP — REPORT_PER_IP,
// всего — REPORT_PER_DAY; тот же ТВ с той же проблемой за сутки — комментарий в ту же задачу, а не новая.
import { REPOS, sanitize, cut } from './bot.js';

export const REPORT_LABEL = 'from-tv';
export const REPORT_TOPIC = 'sunicapps-tv-report-v1';
export const REPORT_KINDS = {
    video: 'Видео не запускается', stall: 'Видео зависает или обрывается', missing: 'Нет фильма, серии или озвучки',
    bot: 'Не работает Telegram-бот', update: 'Не обновляется', other: 'Другое',
};
export const REPORT_PER_DEVICE = 3, REPORT_PER_IP = 6, REPORT_PER_DAY = 40;
const LOG_MAX = 24000;
const META = { tv: 'ТВ', tizen: 'Tizen', sunic: 'Sunic Apps', pkg: 'Пакет', lampa: 'Lampa', screen: 'Экран', player: 'Плеер', settings: 'Настройки', online: 'Сеть', net: 'Связь', uptime: 'Lampa работает' };

/** Разобрать и проверить отчёт. null — мусор. */
export function parseReport(raw) {
    let r;
    try { r = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return null; }
    if (!r || typeof r !== 'object' || !REPORT_KINDS[r.kind] || !/^[a-z0-9]{8,40}$/i.test(String(r.device || ''))) return null;
    const meta = {};
    for (const k of Object.keys(META)) {
        const v = r.meta && r.meta[k];
        if (v === undefined || v === null || v === '') continue;
        meta[k] = cut(sanitize(String(v)).replace(/[|\r\n]+/g, ' '), k === 'settings' ? 1500 : 300);
    }
    const log = sanitize(String(r.log || '')).slice(-LOG_MAX);
    return { kind: r.kind, device: String(r.device), meta, log };
}

async function devHash(device) {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('tv-report:' + device));
    return [...new Uint8Array(d)].slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Текст задачи. Журнал — в сворачиваемом блоке; ``` внутри журнала не даём закрыть блок. */
export function reportBody(rep, hash) {
    const rows = Object.keys(META).filter(k => rep.meta[k] !== undefined).map(k => `| ${META[k]} | ${rep.meta[k]} |`);
    const log = rep.log.replace(/```/g, 'ʼʼʼ') || '— пусто';
    return `Отчёт с ТВ — кнопка «Сообщить о проблеме».\n\n**Проблема:** ${REPORT_KINDS[rep.kind]}\n\n| | |\n|---|---|\n${rows.join('\n')}\n\n` +
        `<details><summary>Журнал (последние строки, без паролей и ключей)</summary>\n\n\`\`\`\n${log}\n\`\`\`\n</details>\n\n<!-- tv-report:${hash} -->`;
}
export function reportTitle(rep) {
    return cut(`[ТВ] ${REPORT_KINDS[rep.kind]}` + (rep.meta.tv ? ' — ' + rep.meta.tv : '') + (rep.meta.sunic ? ', Sunic Apps ' + rep.meta.sunic : ''), 120);
}

async function bump(store, key, max, ttl) {
    let n = 0;
    try { n = +(await store.get(key) || 0); } catch (e) { return true; }   // KV не ответил — отчёт важнее счётчика
    if (n >= max) return false;
    try { await store.put(key, String(n + 1), ttl); } catch (e) { /* квота KV — пропускаем счёт */ }
    return true;
}

/**
 * Принять отчёт: {ok, number, url, dup} | {ok:false, error:'bad'|'limit'|'github'}.
 * deps: gh(method, path, body, ok), store {get, put(k, v, ttl)}, ip, log.
 */
export async function handleReport(raw, deps) {
    const rep = parseReport(raw);
    if (!rep) return { ok: false, error: 'bad' };
    const { gh, store } = deps, log = deps.log || (() => {});
    const day = new Date().toISOString().slice(0, 10), DAY = 86400, hash = await devHash(rep.device);
    const repo = REPOS['lampa-samsung'];
    // тот же ТВ, та же проблема за сутки — дополняем прежнюю задачу (лимит ТВ не тратим, но IP — тратим)
    let prev = null;
    const dupKey = `rep:last:${hash}:${rep.kind}`;
    try { prev = await store.get(dupKey); } catch (e) { /* без KV — новая задача */ }
    if (deps.ip && !(await bump(store, `rep:ip:${deps.ip}:${day}`, REPORT_PER_IP, DAY))) return { ok: false, error: 'limit' };
    // дополнения тоже не бесконечны: свой лимит на ТВ в сутки (через ntfy IP нет — держит только он)
    if (prev && !(await bump(store, `rep:more:${hash}:${day}`, REPORT_PER_DEVICE * 2, DAY))) return { ok: false, error: 'limit' };
    if (prev) {
        try {
            const [number, url] = prev.split('|');
            await gh('POST', `/repos/${repo}/issues/${number}/comments`, { body: 'Ещё один отчёт с того же ТВ:\n\n' + reportBody(rep, hash) }, [201]);
            log(`report: дополнил #${number}`);
            return { ok: true, number: +number, url, dup: true };
        } catch (e) { log('report comment: ' + e.message); }
    }
    if (!(await bump(store, `rep:dev:${hash}:${day}`, REPORT_PER_DEVICE, DAY))) return { ok: false, error: 'limit' };
    if (!(await bump(store, `rep:all:${day}`, REPORT_PER_DAY, DAY))) return { ok: false, error: 'limit' };
    try { await gh('POST', `/repos/${repo}/labels`, { name: REPORT_LABEL, color: '1d76db', description: 'Отчёт с ТВ — кнопка «Сообщить о проблеме»' }, [201]); } catch (e) { /* 422 — уже есть */ }
    let issue;
    try {
        issue = await gh('POST', `/repos/${repo}/issues`, { title: reportTitle(rep), body: reportBody(rep, hash), labels: [REPORT_LABEL, 'bug'] }, [201]);
    } catch (e) { log('report issue: ' + e.message); return { ok: false, error: 'github' }; }
    try { await store.put(dupKey, `${issue.number}|${issue.html_url}`, DAY); } catch (e) { /* квота KV */ }
    log(`report: #${issue.number} ${rep.kind}`);
    return { ok: true, number: issue.number, url: issue.html_url };
}

/** Отчёты, пришедшие через ntfy (ТВ не достучался до Worker). since — в KV; за раз не больше max. */
export async function pollNtfy(deps, fetchText, max = 10) {
    const since = await deps.store.get('rep:since') || '12h';
    const text = await fetchText(`https://ntfy.sh/${REPORT_TOPIC}/json?poll=1&since=${encodeURIComponent(since)}`);
    let last = '', done = 0;
    for (const line of String(text || '').split('\n')) {
        let ev;
        try { ev = JSON.parse(line); } catch (e) { continue; }
        if (!ev || ev.event !== 'message') continue;
        if (done >= max) break;                                  // остальное — в следующий раз (since не сдвигаем дальше)
        done++;
        // больше 4 КБ ntfy хранит вложением — текст отчёта по ссылке
        let body = ev.message;
        if (ev.attachment && /^https:\/\/ntfy\.sh\/file\//.test(String(ev.attachment.url || ''))) {
            try { body = await fetchText(ev.attachment.url); } catch (e) { break; }   // вложение не скачалось — в следующий раз с этого места
        }
        await handleReport(body, { ...deps, ip: '' });
        last = ev.id;
    }
    if (last) await deps.store.put('rep:since', last, 3 * 86400);
    return done;
}
