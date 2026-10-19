// Cloudflare Worker: Lampa «Sunic Apps» в Media Station X (магазин Samsung, без режима разработчика и .wgt).
// В MSX: Настройки → Start Parameter → Setup → адрес этого Worker'а. MSX берёт /msx/start.json и сразу выполняет
// "action" — открывает /lampa/ (так же делают Skaz и lampa.mx). Страница — index.html пакета, файлы — с jsDelivr
// по тегу последнего выпуска (version.json в main). Только http: Lampa и источники Skaz работают по http, со страницы
// https браузер ТВ их заблокировал бы.
const GH = 'https://raw.githubusercontent.com/sunic007/lampa-samsung/main/';
const CDN = 'https://cdn.jsdelivr.net/gh/sunic007/lampa-samsung@v';
const LIFE = 600;

async function latest(ctx) {
    const cache = caches.default, key = new Request('https://msx.cache/version');
    const hit = await cache.match(key);
    if (hit) return hit.text();
    const r = await fetch(GH + 'version.json', { cf: { cacheTtl: LIFE } });
    const v = r.ok ? String((await r.json()).version || '') : '';
    if (/^\d+\.\d+\.\d+$/.test(v)) ctx.waitUntil(cache.put(key, new Response(v, { headers: { 'Cache-Control': 'max-age=' + LIFE } })));
    return v;
}

async function page(ctx) {
    const v = await latest(ctx);
    if (!v) return new Response('GitHub недоступен — попробуйте позже', { status: 503 });
    const r = await fetch(CDN + v + '/src/index.html');
    if (!r.ok) return new Response('Файлы выпуска ' + v + ' ещё не на CDN — попробуйте через минуту', { status: 503 });
    let html = await r.text();
    html = html
        // файлы — с другого домена (jsDelivr): их ошибки браузер отдаёт без текста («Script error.»), Lampa показывает
        // это уведомлением, а понять по нему нечего. Глушим только такие, до обработчика Lampa.
        .replace('<head>', '<head>\n    <base href="' + CDN + v + '/src/">\n    <script>window.addEventListener("error", function (e) {' +
            ' if (!e.lineno && /^Script error\\.?$/i.test(e.message || "")) { try { e.stopImmediatePropagation(); } catch (x) {} } }, true);</script>')
        // webapis.js есть только у установленного пакета (.wgt); в MSX — нет
        .replace(/<script src="\$WEBAPIS\/webapis\/webapis\.js"><\/script>/, '')
        .replace('<title>Lampa</title>', '<title>Lampa · Sunic Apps</title>');
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } });
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url), origin = 'http://' + url.host;
        if (url.pathname === '/msx/start.json') {
            return Response.json({
                name: 'Lampa · Sunic Apps',
                version: '1.0.0',
                parameter: 'content:' + origin + '/msx/start.json',
                action: 'link:' + origin + '/lampa/'
            }, { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' } });
        }
        if (url.pathname === '/lampa/' || url.pathname === '/lampa') return page(ctx);
        return new Response('Lampa · Sunic Apps для Media Station X: Start Parameter — ' + url.host, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
};
