/*
 * Приёмник вебхука общего бота @SunicStreamBot на Cloudflare (бесплатный тариф).
 *
 * Зачем: Telegram (его серверы в Европе) не всегда может подключиться к хостингу sunic.stream в Узбекистане —
 * «Connection timed out», и после такой ошибки Telegram присылает сообщение повторно лишь через паузу: бот отвечает
 * медленно. Cloudflare для Telegram доступен всегда: принимаем сообщение, сразу отвечаем «принято», а на хостинг
 * передаём сами — со своими короткими повторами, без пауз Telegram.
 *
 * Секрета вебхука воркер не знает и не хранит: заголовок X-Telegram-Bot-Api-Secret-Token передаётся на hook.php как
 * есть, проверяет его хостинг (как и раньше). Повторная доставка того же сообщения на хостинге отбрасывается по
 * update_id (hook.php). Воркер лёг — setup.php?go=1&direct=1 возвращает вебхук прямо на хостинг.
 */
export const ORIGIN = 'https://sunic.stream/bot/hook.php';
// попытки: сразу, через 1,5 с, через 4 с; на каждую — до 7 с. Всё вместе укладывается в 30 с waitUntil бесплатного тарифа
export const WAITS = [0, 1500, 4000];
export const ATTEMPT_MS = 7000;
const MAX_BODY = 1000000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Передаёт апдейт на хостинг. → HTTP-код ответа хостинга или 0, если не достучались. */
export async function forward(body, secret, opts = {}) {
    const doFetch = opts.fetch || fetch, wait = opts.sleep || sleep, waits = opts.waits || WAITS;
    for (let i = 0; i < waits.length; i++) {
        if (waits[i]) await wait(waits[i]);
        try {
            const r = await doFetch(ORIGIN, {
                method: 'POST', body, signal: AbortSignal.timeout(opts.attemptMs || ATTEMPT_MS),
                headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret, 'X-Sunic-Front': 'cf' },
            });
            // 2xx — принято; 4xx (кроме 429) — повтор не поможет (чужой секрет, плохой запрос)
            if (r.status < 500 && r.status !== 429) return r.status;
        } catch (e) { /* хостинг не ответил — следующая попытка */ }
    }
    return 0;
}

export default {
    async fetch(req, env, ctx) {
        const url = new URL(req.url);
        if (url.pathname === '/ping') {
            // замер связи Cloudflare → хостинг (без данных бота)
            const t = Date.now();
            let code = 0;
            try { code = (await fetch(ORIGIN, { signal: AbortSignal.timeout(ATTEMPT_MS) })).status; } catch (e) {}
            return Response.json({ origin: code, ms: Date.now() - t, colo: req.cf && req.cf.colo });
        }
        if (req.method !== 'POST' || url.pathname !== '/hook') return new Response('Sunic Apps', { status: 404 });
        const secret = req.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
        if (!/^[A-Za-z0-9_-]{16,256}$/.test(secret)) return new Response('', { status: 403 });
        const body = await req.text();
        if (body.length > MAX_BODY) return new Response('', { status: 413 });
        ctx.waitUntil(forward(body, secret));
        return new Response('');
    },
};
