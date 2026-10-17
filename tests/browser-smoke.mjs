// Проверка совместимости в настоящем браузере: Lampa (ядро с сервера byskaz, как на ТВ) + плагины Skaz + наши модули
// из src/. Что сверяем — то, на чём держатся наши функции: модули загрузились, раздел «Sunic Apps» и пункты меню на месте,
// экран источников Skaz (компонент lampacskaz) открывается, наша обёртка bsfix.js на нём стоит и все функции плагина,
// которые мы вызываем, есть. Плюс — нет ошибок из наших файлов.
//
//   npm i --no-save playwright@1.48.2 && npx playwright install chromium
//   node tests/browser-smoke.mjs [--report smoke-report.json]
//
// Выход: 0 — всё в порядке; 1 — что-то сломалось (список в отчёте); 3 — серверы Skaz/byskaz не ответили (не наша поломка).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const REPORT = (() => { const i = process.argv.indexOf('--report'); return i > 0 ? process.argv[i + 1] : ''; })();
const OURS = /\/(bs\w*|playerguard|skazauto|loader|update|polyfills)\.js/;
// функции плагина онлайн-источников Skaz, которые вызывают bsfix.js, bsprobe.js, bssources.js, bsrch.js
const SKAZ_API = ['setDefaultQuality', 'find', 'getFileUrl', 'nextSource', 'switchSource', 'getChoice', 'saveChoice', 'requestParams',
    'seasonMemory', 'seasonIndexByMemory', 'uiSwitch', 'uiDraw', 'uiSourceMenu', 'sourceState', 'sourceOrder', 'doesNotAnswer', 'destroy'];
const MODULES = ['BSUpdate', 'BSSkaz', 'BSGuard', 'BSFeatures', 'BSPlayer', 'BSRch', 'BSProbe', 'BSFix', 'BSSources', 'BSMenu',
    'BSContinue', 'BSWatch', 'BSHub', 'BSTelegram', 'BSVolume', 'BSReport'];

const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
    '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.lampa': 'application/json' };
const server = http.createServer((req, res) => {
    const p = path.normalize(path.join(ROOT, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const report = { time: new Date().toISOString(), ok: false, problems: [], warnings: [], lampa: '', skazScripts: {}, ourErrors: [] };
const fail = t => report.problems.push(t);
const browser = await chromium.launch();
try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'ru-RU' })).newPage();
    // модули — из src/, а не опубликованные с jsDelivr
    await page.addInitScript(() => { try { localStorage.setItem('bs_gh_update', 'false'); } catch (e) {} });
    page.on('pageerror', e => { const s = String(e.stack || e.message); if (OURS.test(s)) report.ourErrors.push(s.split('\n').slice(0, 3).join(' | ')); });
    page.on('console', m => { if (m.type() === 'error' && OURS.test((m.location() || {}).url || '')) report.ourErrors.push(m.text().slice(0, 300)); });
    // отпечатки сторонних скриптов (Skaz, byskaz): изменились — видно в отчёте
    page.on('response', async r => {
        const u = r.url();
        if (!/\.js(\?|$)/.test(u) || u.startsWith(base) || !/skaz|byskaz/.test(u)) return;
        try { const b = await r.body(); report.skazScripts[u.split('?')[0]] = crypto.createHash('sha256').update(b).digest('hex').slice(0, 16); } catch (e) {}
    });

    await page.goto(base + 'index.html');
    const ready = await page.waitForFunction(() => !!(window.Lampa && Lampa.Activity && Lampa.Activity.active && document.querySelector('.menu .menu__item')),
        null, { timeout: 120000 }).then(() => true, () => false);
    if (!ready) {
        const net = await page.evaluate(() => !!window.Lampa);
        report.unreachable = !net;
        fail(net ? 'Lampa загрузилась, но меню так и не появилось за 2 минуты' : 'Lampa не загрузилась (сервер byskaz не ответил?)');
        throw new Error('not ready');
    }
    await page.waitForTimeout(8000);   // плагины Skaz догружаются после меню
    const st = await page.evaluate(MODS => {
        const r = { lampa: '', missingModules: [], settings: {}, menu: {} };
        try { r.lampa = String(Lampa.Manifest.app_version || ''); } catch (e) {}
        MODS.forEach(n => { if (typeof window[n] !== 'object' || !window[n]) r.missingModules.push(n); });
        try {
            const all = Lampa.SettingsApi.allParams() || {}, names = {};
            Object.keys(all).forEach(c => (all[c] || []).forEach(p => { if (p && p.param) names[p.param.name] = c; }));
            r.settings = { check_now: !!names.bs_check_now, menu_kids: !!names.bs_menu_kids, tg: !!names.bs_tg_on, guard: !!names.bs_guard };
            r.section = !!(Lampa.SettingsApi.getComponent && Lampa.SettingsApi.getComponent('bs_apps'));
        } catch (e) { r.settingsErr = e.message; }
        r.menu = { turk: !!document.querySelector('.menu [data-action="bs_turk"]'), want: !!document.querySelector('.menu [data-action="bs_want"]') };
        try { r.skaz = !!Lampa.Component.get('lampacskaz'); } catch (e) { r.skaz = false; }
        r.kidsSource = !!(Lampa.Api && Lampa.Api.sources && Lampa.Api.sources.bskids);
        return r;
    }, MODULES);
    report.lampa = st.lampa;
    if (st.missingModules.length) fail('не загрузились модули: ' + st.missingModules.join(', '));
    if (!st.section) fail('нет раздела настроек «Sunic Apps» (bs_apps)');
    Object.keys(st.settings).forEach(k => { if (!st.settings[k]) fail('нет пункта настроек: ' + k); });
    if (st.settingsErr) fail('настройки: ' + st.settingsErr);
    if (!st.menu.turk) fail('нет пункта меню «Турецкие сериалы»');
    if (!st.kidsSource) fail('не зарегистрирован источник «Мультиков» (bskids)');

    if (!st.skaz) {
        const anySkaz = Object.keys(report.skazScripts).some(u => /skaz\.tv/.test(u));
        if (anySkaz) fail('плагин Skaz загрузился, но компонента lampacskaz нет — Skaz переименовал экран источников?');
        else { report.warnings.push('плагины Skaz не загрузились (сервер skaz.tv не ответил) — экран источников не проверен'); report.unreachable = true; }
    } else {
        const sk = await page.evaluate(async API => {
            const movie = { id: 1399, title: 'Игра престолов', name: 'Игра престолов', original_title: 'Game of Thrones', original_name: 'Game of Thrones',
                first_air_date: '2011-04-17', number_of_seasons: 8, source: 'tmdb', imdb_id: 'tt0944947' };
            Lampa.Activity.push({ url: '', title: 'Онлайн', component: 'lampacskaz', search: movie.name, search_one: movie.name,
                search_two: movie.original_name, movie: movie, page: 1 });
            await new Promise(r => setTimeout(r, 8000));
            const a = Lampa.Activity.active(), c = a && a.activity && a.activity.component;
            return { comp: a && a.component, patched: !!(c && c.__bsFix), missing: API.filter(m => !c || typeof c[m] !== 'function') };
        }, SKAZ_API);
        if (sk.comp !== 'lampacskaz') fail('экран источников Skaz не открылся (на экране: ' + sk.comp + ')');
        if (!sk.patched) fail('наша обёртка bsfix.js не встала на экран источников Skaz');
        if (sk.missing.length) fail('в плагине Skaz нет функций, которыми пользуется наш код: ' + sk.missing.join(', '));
    }
    if (report.ourErrors.length) fail('ошибки из наших файлов: ' + report.ourErrors.length);
} catch (e) {
    if (!report.problems.length) fail('проверка упала: ' + e.message);
} finally {
    await browser.close();
    server.close();
}
report.ok = !report.problems.length;
const out = JSON.stringify(report, null, 1);
console.log(out);
if (REPORT) fs.writeFileSync(REPORT, out);
process.exit(report.ok ? 0 : report.unreachable ? 3 : 1);
