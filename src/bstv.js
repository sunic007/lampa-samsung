/*
 * «Телеканалы» — свой IPTV-плеер Sunic Apps, как у приставок: канал сразу на весь экран, остальное — поверх видео.
 *
 *   OK — плашка канала (что за канал, номер, раздел, подсказки по кнопкам); ещё раз OK — спрятать.
 *   ▲ ▼ — соседний канал сразу, без меню; цифры — канал по номеру; CH+/CH- на пульте — то же, что ▲ ▼.
 *   ◄ — список каналов (видео идёт дальше); в списке ещё ◄ — разделы: поиск, избранное, недавние, все, группы
 *       плейлиста и сами плейлисты. ► — действия с каналом: в избранное, другой плейлист, обновить.
 *   Назад — закрыть то, что открыто; на чистом экране — выйти из плеера.
 *
 * Играет плеер Lampa (Lampa.Player.iptv: и телевизор, и браузер, и hls). Его панели прячем и его переключение каналов
 * выключаем (total: 1) — номера, ▲▼ и список ведём сами, а новый канал отдаём плееру событием 'play' — так же, как
 * это делает он сам. Кнопки, которые плеер ловит своим контроллером (player, player_tv…), пока открыт наш экран,
 * перенаправляем на свой.
 *
 * Плейлисты — те, что человек добавил в IPTV (iptv_playlist_custom, в том числе наши «sunic-iptv-…» из «Sunic Apps →
 * IPTV»); нет ни одного — «На русском» и «Узбекистан» с нашего зеркала. Зеркало не ответило — оригинал iptv-org
 * (запас в обе стороны). Разбираем список сами, кусками, чтобы телевизор не замирал.
 *
 * Работает в любой Lampa: только Lampa API и localStorage, без наших модулей.
 */
var BSTv = (function () {
    var MIRROR = 'https://sunic.stream/iptv/';
    var ORG = 'https://iptv-org.github.io/iptv/';
    // наши ключи → путь у iptv-org: запасной адрес, если зеркало не ответило
    var ORG_PATH = { uz: 'countries/uz', rus: 'languages/rus', ru: 'countries/ru', kz: 'countries/kz', tr: 'countries/tr', movies: 'categories/movies',
        series: 'categories/series', kids: 'categories/kids', animation: 'categories/animation', documentary: 'categories/documentary',
        sports: 'categories/sports', music: 'categories/music', news: 'categories/news' };
    var DEFAULT = [['rus', 'На русском'], ['uz', 'Узбекистан']];
    var ROWS = 9, INFO_MS = 6000, NUM_MS = 1600, ZAP_MS = 900, FAV_MAX = 300, RECENT_MAX = 30;
    var ICON = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2.5" y="5" width="19" height="13" rx="2.5" stroke="currentColor" stroke-width="2"/>' +
        '<path d="M8 21h8M9 2l3 3 3-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
    function lsJson(k, def) { try { var v = JSON.parse(lsGet(k) || 'null'); return v == null ? def : v; } catch (e) { return def; } }
    function log() { try { console.log.apply(console, ['BS tv'].concat([].slice.call(arguments))); } catch (e) {} }
    function noty(t) { try { Lampa.Noty.show(t); } catch (e) {} }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function isArr(a) { return Object.prototype.toString.call(a) === '[object Array]'; }
    function pad(n) { n = String(n); return n.length < 2 ? '0' + n : n; }
    function clock() { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

    /* ---------- плейлисты ---------- */

    /* Страница по https (браузер) не загрузит видео по http — а это почти половина открытых каналов. Списки берём
     * полные: http-канал на такой странице помечаем, а выбрали его — предлагаем открыть Lampa по http (тот же сайт,
     * http://…/lampa/?http=1), канал и плейлист передаём в адресе (#bstv=…) — там он включается сразу. */
    function secure() { try { return window.location.protocol === 'https:' && !window.tizen; } catch (e) { return false; } }
    function blocked(ch) { return !!ch && secure() && /^http:\/\//i.test(ch.url); }
    function ourUrl(key) { return MIRROR + key + '.m3u'; }
    function playlists() {
        var out = [], l = [], i, it, key;
        try { l = Lampa.Storage.get('iptv_playlist_custom', '[]'); } catch (e) {}
        if (!isArr(l)) l = [];
        for (i = 0; i < l.length; i++) {
            it = l[i];
            if (!it || !/^https?:\/\//i.test(String(it.url || ''))) continue;
            key = /^sunic-iptv-(\w+)$/.exec(String(it.id || ''));
            out.push({ id: String(it.id || it.url), name: String(it.name || it.url), url: String(it.url), key: key ? key[1] : '' });
        }
        if (!out.length) for (i = 0; i < DEFAULT.length; i++) out.push({ id: 'sunic-iptv-' + DEFAULT[i][0], name: DEFAULT[i][1], url: ourUrl(DEFAULT[i][0]), key: DEFAULT[i][0] });
        // плейлист, с которым пришли со страницы по https (#bstv=…), если его тут нет
        var ex = lsJson('bs_tv_extra', null), has = false;
        if (ex && ex.id && /^https?:\/\//i.test(String(ex.url || ''))) {
            for (i = 0; i < out.length; i++) if (out[i].id === ex.id) has = true;
            if (!has) out.push({ id: String(ex.id), name: String(ex.name || 'Плейлист'), url: String(ex.url), key: ex.key || '' });
        }
        return out;
    }
    function playlistById(id) {
        var l = playlists(), i;
        for (i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
        return l[0];
    }
    /** Адреса списка по порядку: основной, а для наших — ещё оригинал iptv-org. */
    function urlsOf(pl) {
        // наши — всегда полный список с зеркала (у IPTV на https адрес /iptv/s/… — без http-каналов), запасной — iptv-org
        var u = pl.key && pl.url.indexOf(MIRROR) === 0 ? [ourUrl(pl.key)] : [pl.url];
        if (pl.key && ORG_PATH[pl.key] && pl.url.indexOf(MIRROR) === 0) u.push(ORG + ORG_PATH[pl.key] + '.m3u');
        return u;
    }

    function fetchText(url, ok, fail) {
        var req, done = false;
        var end = function (f, a) { if (!done) { done = true; f(a); } };
        try {
            req = new Lampa.Reguest();
            req.timeout(25000);
            req.silent(url, function (t) { end(ok, String(t == null ? '' : t)); }, function () { end(fail); }, false, { dataType: 'text' });
            setTimeout(function () { end(fail); }, 30000);
        } catch (e) { end(fail); }
    }

    /** Значение атрибута #EXTINF: name="…", name='…' или name=слово (у провайдеров встречается всё). */
    function attr(line, name) {
        var m = new RegExp('(?:^|[\\s:])' + name + '=(?:"([^"]*)"|\'([^\']*)\'|([^\\s,"\']+))', 'i').exec(line);
        return m ? m[1] || m[2] || m[3] || '' : '';
    }
    /** Имя канала — после запятой, что идёт за атрибутами (в самих атрибутах тоже бывают запятые). */
    function infName(line) {
        var q = line.lastIndexOf('"'), c = line.indexOf(',', q > 0 ? q : 0);
        if (c < 0) c = line.indexOf(',');
        return c < 0 ? '' : line.slice(c + 1).replace(/^\s+|\s+$/g, '');
    }
    /* Разделы в плейлистах пишут по-разному — понимаем всё распространённое:
     *   group-title="…" (и в одинарных кавычках, и без них), tvg-group="…" — у канала;
     *   #EXTGRP:… после #EXTINF — у этого канала; #EXTGRP:… до #EXTINF — у всех следующих, пока не сменится;
     *   TXT-списки «Раздел,#genre#» и «Канал,ссылка» (без #EXTM3U). */
    function parseTxt(lines) {
        var out = [], grp = '', i, line, m;
        for (i = 0; i < lines.length; i++) {
            line = String(lines[i]).replace(/^\s+|\s+$/g, '');
            if (/,\s*#genre#$/i.test(line)) { grp = line.replace(/,\s*#genre#$/i, '').replace(/^\s+|\s+$/g, ''); continue; }
            m = /^([^,]+),\s*(https?:\/\/\S+)/i.exec(line);
            if (m) out.push({ name: m[1].replace(/^\s+|\s+$/g, ''), logo: '', group: grp, tid: '', url: m[2].split('|')[0].split('#')[0], num: out.length + 1 });
        }
        return out.length ? out : null;
    }
    /** Разбор m3u кусками (step строк за такт): каналы {num, name, logo, group, url, tid}. */
    function parse(text, done) {
        var lines = String(text || '').replace(/^\uFEFF/, '').split('\n'), i = 0, cur = null, out = [], sticky = '';
        if (!/^\s*#EXTM3U/i.test(lines[0] || '')) return done(parseTxt(lines));
        // архив: catchup="…" catchup-days="…" catchup-source="…" у канала, а по умолчанию — в строке #EXTM3U
        var head = lines[0], hType = attr(head, 'catchup'), hDays = attr(head, 'catchup-days'), hSrc = attr(head, 'catchup-source');
        var catchup = function (line) {
            var t = attr(line, 'catchup') || hType, d = attr(line, 'catchup-days') || attr(line, 'tvg-rec') || hDays, s = attr(line, 'catchup-source') || hSrc;
            if (!t && +d > 0) t = s ? 'default' : 'shift';
            return t && +d > 0 ? { t: t.toLowerCase(), d: +d, s: s } : null;
        };
        var step = function () {
            var end = Math.min(lines.length, i + 3000), line, u, g;
            for (; i < end; i++) {
                line = String(lines[i]).replace(/^\s+|\s+$/g, '');
                if (line.indexOf('#EXTINF') === 0) {
                    cur = { name: infName(line), logo: attr(line, 'tvg-logo') || attr(line, 'logo'), group: attr(line, 'group-title') || attr(line, 'tvg-group'), tid: attr(line, 'tvg-id') };
                    g = catchup(line);
                    if (g) cur.arc = g;
                } else if (line.indexOf('#EXTGRP:') === 0) {
                    g = line.slice(8).replace(/^\s+|\s+$/g, '');
                    if (cur) { if (g) cur.group = g; } else sticky = g;     // до #EXTINF — раздел для всех следующих
                } else if (line && line.charAt(0) !== '#') {
                    u = line.split('|')[0];
                    if (cur && /^https?:\/\/\S+$/i.test(u)) {
                        cur.url = u;
                        cur.name = cur.name || u;
                        cur.group = (cur.group || sticky || '').split(';')[0].replace(/^\s+|\s+$/g, '');
                        if (!/^https?:/i.test(cur.logo)) cur.logo = '';
                        cur.num = out.length + 1;
                        out.push(cur);
                    }
                    cur = null;
                }
            }
            if (i < lines.length) setTimeout(step, 0); else done(out);
        };
        step();
    }

    var cache = {};             // id плейлиста → {channels, groups, at}
    function load(pl, done, force) {
        var c = cache[pl.id];
        if (c && !force && Date.now() - c.at < 6 * 3600000) return done(c);
        var urls = urlsOf(pl), n = 0;
        var next = function () {
            if (n >= urls.length) return done(null);
            fetchText(urls[n++], function (t) {
                parse(t, function (list) {
                    if (!list || !list.length) return next();
                    var groups = [], seen = {}, i, g;
                    for (i = 0; i < list.length; i++) {
                        g = list[i].group;
                        if (!g) continue;
                        if (seen[g] === undefined) { seen[g] = groups.length; groups.push({ name: g, count: 0 }); }
                        groups[seen[g]].count++;
                    }
                    groups.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
                    cache[pl.id] = { channels: list, groups: groups, at: Date.now() };
                    done(cache[pl.id]);
                });
            }, next);
        };
        next();
    }

    /* ---------- избранное и недавние (общие для всех плейлистов) ---------- */

    function chKey(ch) { return String(ch.name || '').toLowerCase() + '|' + ch.url; }
    function short(ch) { var s = { name: ch.name, logo: ch.logo, group: ch.group, url: ch.url, tid: ch.tid }; if (ch.arc) s.arc = ch.arc; return s; }
    function favs() { var f = lsJson('bs_tv_fav', []); return isArr(f) ? f : []; }
    function isFav(ch) { var f = favs(), k = chKey(ch), i; for (i = 0; i < f.length; i++) if (chKey(f[i]) === k) return i; return -1; }
    function toggleFav(ch) {
        var f = favs(), at = isFav(ch);
        if (at >= 0) f.splice(at, 1); else f.unshift(short(ch));
        lsSet('bs_tv_fav', JSON.stringify(f.slice(0, FAV_MAX)));
        return at < 0;
    }
    function recents() { var r = lsJson('bs_tv_recent', []); return isArr(r) ? r : []; }
    function addRecent(ch) {
        var r = recents(), k = chKey(ch), i;
        for (i = r.length - 1; i >= 0; i--) if (chKey(r[i]) === k) r.splice(i, 1);
        r.unshift(short(ch));
        lsSet('bs_tv_recent', JSON.stringify(r.slice(0, RECENT_MAX)));
    }
    function numbered(list) {
        var out = [], i;
        for (i = 0; i < list.length; i++) { out.push(list[i]); if (!list[i].num) list[i].num = i + 1; }
        return out;
    }

    /* ---------- программа передач ----------
     * Собирает её раз в день tools/epg_build.py (workflow epg.yml) в ветку epg: index.json — как найти канал
     * (по tvg-id или по имени), c/<ключ>.json — передачи канала [начало, конец, название, описание] в минутах unix.
     * Адресов три, по очереди (запас в обе стороны). Имя сравниваем через tvNorm — она повторяет norm() сборщика. */
    var EPG_BASES = ['https://raw.githubusercontent.com/sunic007/lampa-samsung/epg/', 'https://cdn.jsdelivr.net/gh/sunic007/lampa-samsung@epg/',
        'https://sunic.stream/gh/sunic007/lampa-samsung@epg/'];
    var TR = { 'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
        'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '',
        'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya', 'ў': 'o', 'қ': 'q', 'ғ': 'g', 'ҳ': 'h', 'і': 'i' };
    var TV_DROP = /(^|[^a-zа-яё0-9_])(hd|fhd|uhd|sd|4k|8k|orig|original|hevc|h265|tv|тв|телеканал|канал)(?=$|[^a-zа-яё0-9_])/g;
    function tvNorm(raw, keep) {
        var s = String(raw || '').toLowerCase()
            .replace(/[(\[]\s*([+-]\s*\d+)\s*[)\]]/g, ' $1 ')
            .replace(/\+\s*(\d)/g, ' plus$1')
            .replace(/(^|\s)-\s*(\d)/g, '$1 minus$2')
            .replace(/\(.*?\)|\[.*?\]/g, ' ');
        if (!keep) s = s.replace(TV_DROP, '$1 ').replace(TV_DROP, '$1 ');      // дважды: «hd tv» — соседние слова
        var out = '', i, c;
        for (i = 0; i < s.length; i++) { c = s.charAt(i); out += TR[c] !== undefined ? TR[c] : c; }
        out = out.replace(/[^a-z0-9]/g, '');
        var rep = [['iy', 'y'], ['yy', 'y'], ['ii', 'y'], ['yi', 'y'], ['ij', 'y'], ['j', 'y'], ['kh', 'h'], ['x', 'h']];
        for (i = 0; i < rep.length; i++) out = out.split(rep[i][0]).join(rep[i][1]);
        if (!keep && /^\d*$/.test(out)) return tvNorm(raw, true);            // «ТВ-3» — без «ТВ» осталась бы одна цифра
        return out;
    }
    function fetchJson(path, ok, fail) {
        var n = 0;
        var next = function () {
            if (n >= EPG_BASES.length) return fail();
            fetchText(EPG_BASES[n++] + path, function (t) {
                var j = null;
                try { j = JSON.parse(t); } catch (e) {}
                if (j) ok(j); else next();
            }, next);
        };
        next();
    }
    var epgIdx = null, epgIdxWait = null, epgData = {}, epgOrder = [], epgWait = {};
    function epgIndex(done) {
        if (epgIdx) return done(epgIdx);
        if (epgIdxWait) return epgIdxWait.push(done);
        epgIdxWait = [done];
        fetchJson('index.json', function (j) {
            epgIdx = j && j.names ? j : { ids: {}, names: {} };
            var w = epgIdxWait; epgIdxWait = null;
            for (var i = 0; i < w.length; i++) w[i](epgIdx);
        }, function () {
            var w = epgIdxWait; epgIdxWait = null;
            epgIdx = null;                                              // в следующий раз попробуем снова
            for (var i = 0; i < w.length; i++) w[i](null);
        });
    }
    function epgKey(ch, idx) {
        if (!idx || !ch) return '';
        var t = String(ch.tid || '').split('@')[0].toLowerCase();
        return (t && idx.ids[t]) || idx.names[tvNorm(ch.name)] || '';
    }
    /** Передачи канала: done(list|null). Держим в памяти 80 последних каналов. */
    function epgGet(ch, done) {
        epgIndex(function (idx) {
            var key = epgKey(ch, idx);
            if (!key) return done(null);
            if (epgData[key]) return done(epgData[key]);
            if (epgWait[key]) return epgWait[key].push(done);
            epgWait[key] = [done];
            var fin = function (p) {
                var w = epgWait[key] || [];
                delete epgWait[key];
                if (p) {
                    epgData[key] = p;
                    epgOrder.push(key);
                    if (epgOrder.length > 80) delete epgData[epgOrder.shift()];
                }
                for (var i = 0; i < w.length; i++) w[i](p);
            };
            fetchJson('c/' + key + '.json', function (j) { fin(j && isArr(j.p) && j.p.length ? j.p : null); }, function () { fin(null); });
        });
    }
    function nowMin() { return Date.now() / 60000; }
    /** Что идёт сейчас: {cur, next, at} (at — номер текущей передачи), или null. */
    function epgNow(p) {
        if (!p) return null;
        var t = nowMin(), i;
        for (i = 0; i < p.length; i++) if (p[i][0] <= t && t < p[i][1]) return { cur: p[i], next: p[i + 1] || null, at: i };
        return null;
    }
    function hm(min) { var d = new Date(min * 60000); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
    function left(min) {
        var m = Math.max(0, Math.round(min - nowMin())), h = Math.floor(m / 60);
        return (h ? h + ' ч ' : '') + (m % 60) + ' мин';
    }
    function pct(pr) { return Math.max(0, Math.min(100, (nowMin() - pr[0]) / (pr[1] - pr[0]) * 100)); }

    /* ---------- архив ----------
     * Только у каналов, где плейлист сам говорит, как его смотреть (catchup=…): shift, append/default с шаблоном
     * catchup-source, flussonic, xc (Xtream Codes). Свой сервер архива мы не придумываем. */
    function fmt2(n) { return pad(n); }
    function arcUrl(ch, pr) {
        var a = ch.arc;
        if (!a) return '';
        var start = pr[0] * 60, end = pr[1] * 60, now = Math.floor(Date.now() / 1000), dur = end - start, url = ch.url;
        var d = new Date(start * 1000);
        var fill = function (s) {
            return String(s)
                .replace(/\$?\{(utc|start|timestamp_start)\}/g, start).replace(/\$?\{(utcend|end)\}/g, end)
                .replace(/\$?\{(lutc|now|timestamp)\}/g, now).replace(/\$?\{duration\}/g, dur).replace(/\$?\{offset\}/g, now - start)
                .replace(/\$?\{Y\}/g, d.getFullYear()).replace(/\$?\{m\}/g, fmt2(d.getMonth() + 1)).replace(/\$?\{d\}/g, fmt2(d.getDate()))
                .replace(/\$?\{H\}/g, fmt2(d.getHours())).replace(/\$?\{M\}/g, fmt2(d.getMinutes())).replace(/\$?\{S\}/g, fmt2(d.getSeconds()));
        };
        if (a.t === 'shift' || (a.t === 'default' && !a.s)) return url + (url.indexOf('?') < 0 ? '?' : '&') + 'utc=' + start + '&lutc=' + now;
        if (a.t === 'append') return url + fill(a.s || '');
        if (a.t === 'default') return fill(/^https?:\/\//i.test(a.s) ? a.s : url + a.s);
        if (a.t === 'flussonic' || a.t === 'fs' || a.t === 'flussonic-hls') {
            if (/\/mpegts(\?|$)/.test(url)) return url.replace(/\/mpegts(\?|$)/, '/timeshift_abs-' + start + '.ts$1');
            return url.replace(/\/([\w-]+)\.m3u8(\?|$)/, '/$1-' + start + '-' + dur + '.m3u8$2');
        }
        if (a.t === 'xc') {
            var m = /^(https?:\/\/[^/]+)\/(?:live\/)?([^/]+)\/([^/]+)\/(\d+)(\.\w+)?$/.exec(url);
            if (m) return m[1] + '/timeshift/' + m[2] + '/' + m[3] + '/' + Math.ceil(dur / 60) + '/' + d.getFullYear() + '-' + fmt2(d.getMonth() + 1) + '-' +
                fmt2(d.getDate()) + ':' + fmt2(d.getHours()) + '-' + fmt2(d.getMinutes()) + '/' + m[4] + (m[5] || '.ts');
        }
        return '';
    }
    /** Передачу можно посмотреть в архиве: уже началась и не старше catchup-days. */
    function inArchive(ch, pr) { return !!(ch && ch.arc && pr[0] <= nowMin() && pr[0] >= nowMin() - ch.arc.d * 1440); }

    /* ---------- состояние сеанса ---------- */

    var S = null;   // {pl, data, view:{type,name,title,list}, cur, pos, info, panel, focus, cfocus, cats, num, numTimer, infoTimer, root, ctrl}
    var styled = false;

    function viewOf(type, name, q) {
        var d = S.data, list = [], title = '', i, low;
        if (type === 'fav') { list = numbered(favs()); title = 'Избранное'; }
        else if (type === 'recent') { list = numbered(recents()); title = 'Недавние'; }
        else if (type === 'group') {
            for (i = 0; i < d.channels.length; i++) if (d.channels[i].group === name) list.push(d.channels[i]);
            title = name;
        } else if (type === 'search') {
            low = String(q || '').toLowerCase();
            for (i = 0; i < d.channels.length; i++) if (String(d.channels[i].name).toLowerCase().indexOf(low) >= 0) list.push(d.channels[i]);
            title = 'Поиск: ' + q;
        } else { type = 'all'; list = d.channels; title = 'Все каналы'; }
        return { type: type, name: name || q || '', title: title, list: list };
    }
    function indexIn(list, ch) {
        if (!ch) return -1;
        var k = chKey(ch), i;
        for (i = 0; i < list.length; i++) if (chKey(list[i]) === k) return i;
        return -1;
    }

    /* ---------- экран ---------- */

    function css() {
        if (styled) return;
        styled = true;
        var s = document.createElement('style');
        s.textContent =
            '.player.bstv-on .player-panel,.player.bstv-on .player-info,.player.bstv-on .player-footer{display:none!important}' +
            '.bstv{position:absolute;left:0;top:0;right:0;bottom:0;z-index:20;pointer-events:none;color:#fff;font-size:1em}' +
            '.bstv>*{pointer-events:auto}' +
            '.bstv-info{position:absolute;left:0;right:0;bottom:0;padding:4em 3em 1.6em;background:linear-gradient(to top,rgba(0,0,0,.92),rgba(0,0,0,.55) 65%,transparent);transition:opacity .25s}' +
            '.bstv-info.hide,.bstv-side.hide,.bstv-num.hide{display:none}' +
            '.bstv-info__row{display:flex;align-items:center}' +
            '.bstv-logo{width:5.2em;height:3.4em;flex-shrink:0;border-radius:.6em;background:rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center;overflow:hidden;margin-right:1.2em}' +
            '.bstv-logo img{max-width:88%;max-height:80%}' +
            '.bstv-logo span{font-size:1.4em;font-weight:700;opacity:.7}' +
            '.bstv-info__num{font-size:1.3em;padding:.15em .55em;border-radius:.4em;background:rgba(255,255,255,.14);margin-right:.7em}' +
            '.bstv-info__name{font-size:2em;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.bstv-info__sub{opacity:.6;margin-top:.3em;font-size:1.1em}' +
            '.bstv-info__right{margin-left:auto;display:flex;align-items:center;flex-shrink:0;padding-left:1em}' +
            '.bstv-live{background:#e53935;border-radius:.4em;padding:.2em .6em;font-weight:700;margin-left:.8em}' +
            '.bstv-clock{font-size:1.4em;opacity:.85}' +
            '.bstv-state{margin-top:1em;font-size:1.15em;color:#ffcc80}' +
            '.bstv-keys{display:flex;flex-wrap:wrap;margin-top:1.3em;opacity:.8}' +
            '.bstv-key{display:flex;align-items:center;margin-right:2em;margin-bottom:.4em}' +
            '.bstv-key b{border:1px solid rgba(255,255,255,.4);border-radius:.35em;padding:.05em .45em;margin-right:.5em;font-weight:400;min-width:1.2em;text-align:center}' +
            '.bstv-side{position:absolute;left:0;top:0;bottom:0;display:flex;background:rgba(12,14,18,.94)}' +
            '.bstv-col{width:26em;display:flex;flex-direction:column;border-right:1px solid rgba(255,255,255,.07)}' +
            '.bstv-cats{width:19em;background:rgba(0,0,0,.25)}' +
            '.bstv-cats.hide{display:none}' +
            '.bstv-col__head{display:flex;align-items:center;justify-content:space-between;padding:1.3em 1.2em 1em;font-size:1.25em;font-weight:700}' +
            '.bstv-col__count{font-size:.8em;background:rgba(80,140,255,.25);color:#9ec1ff;border-radius:1em;padding:.2em .7em;margin-left:.6em}' +
            '.bstv-col__body{flex:1;overflow:hidden;padding:0 .6em}' +
            '.bstv-col__foot{padding:.8em 1.2em;opacity:.45;font-size:.95em}' +
            '.bstv-row{display:flex;align-items:center;height:4.3em;padding:0 .7em;border-radius:.7em;cursor:pointer}' +
            '.bstv-row.focus{background:rgba(255,255,255,.14)}' +
            '.bstv-side.side--cats .bstv-list .bstv-row.focus{background:rgba(255,255,255,.06)}' +
            '.bstv-row__num{width:2.6em;opacity:.55;flex-shrink:0}' +
            '.bstv-row.play .bstv-row__num{color:#4cd964;opacity:1}' +
            '.bstv-row .bstv-logo{width:3.6em;height:2.5em;margin-right:.9em;border-radius:.4em}' +
            '.bstv-row .bstv-logo span{font-size:1em}' +
            '.bstv-row__body{min-width:0;flex:1}' +
            '.bstv-row__name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:1.1em}' +
            '.bstv-row__sub{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.5;font-size:.9em;margin-top:.15em}' +
            '.bstv-row__fav{color:#ffcc00;margin-left:.5em}' +
            '.bstv-row__http{font-size:.7em;border:1px solid rgba(255,255,255,.35);border-radius:.3em;padding:0 .35em;margin-left:.5em;opacity:.6;vertical-align:middle}' +
            '.bstv-row__count{opacity:.5;margin-left:auto;padding-left:.6em}' +
            '.bstv-empty{opacity:.5;padding:1.2em}' +
            '.bstv-num{position:absolute;right:3em;top:2em;font-size:3em;font-weight:700;background:rgba(0,0,0,.6);border-radius:.3em;padding:.1em .5em}' +
            '.bstv-load{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:1.3em;background:rgba(0,0,0,.6);padding:.8em 1.4em;border-radius:.6em}' +
            '.bstv-load.hide{display:none}' +
            '.bstv-tap{position:absolute;left:0;top:0;right:0;bottom:0}' +
            '.bstv-touch,.bstv-x{display:none}' +
            '.bstv--touch .bstv-touch{display:flex;flex-wrap:wrap;margin-top:1em}' +
            '.bstv--touch .bstv-keys,.bstv--touch .bstv-col__foot{display:none}' +
            '.bstv-touch div{padding:.6em 1.1em;border-radius:.6em;background:rgba(255,255,255,.14);margin:0 .8em .5em 0;cursor:pointer}' +
            '.bstv--touch .bstv-x{display:block;margin-left:.6em;padding:.25em .65em;border-radius:.5em;background:rgba(255,255,255,.12);cursor:pointer;font-weight:400;font-size:.9em}' +
            '.bstv--touch .bstv-row:hover,.bstv--touch .bstv-day{cursor:pointer}' +
            '.bstv-arc{background:#f59e0b;color:#1a1a1a;border-radius:.4em;padding:.2em .6em;font-weight:700;margin-left:.8em}' +
            '.bstv-prog{margin-top:1.2em;max-width:60em}' +
            '.bstv-prog__title{font-size:1.3em;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.bstv-bar{height:.3em;border-radius:.2em;background:rgba(255,255,255,.18);margin:.6em 0 .4em;overflow:hidden}' +
            '.bstv-bar div{height:100%;background:#4f8cff}' +
            '.bstv-prog__times{display:flex;justify-content:space-between;opacity:.65}' +
            '.bstv-prog__next{margin-top:.6em;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.bstv-prog__next b{font-weight:600;opacity:1}' +
            '.bstv-row__time{opacity:.5;margin-left:.6em;flex-shrink:0;font-size:.95em}' +
            '.bstv-detail{width:24em;padding:1.4em 1.4em 1em;overflow:hidden;background:rgba(0,0,0,.2)}' +
            '.bstv-detail__name{font-size:1.4em;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.bstv-detail__sub{opacity:.5;margin-top:.2em}' +
            '.bstv-onair{display:inline-block;border:1px solid #e53935;color:#ff6b66;border-radius:.4em;padding:.1em .5em;margin:1.2em 0 .6em;font-size:.85em;font-weight:700}' +
            '.bstv-detail__title{font-size:1.2em;font-weight:600}' +
            '.bstv-detail__time{color:#7fb0ff;margin-top:.3em}' +
            '.bstv-detail__left{opacity:.5;font-size:.9em}' +
            '.bstv-detail__desc{opacity:.7;margin-top:.8em;line-height:1.4;max-height:9.8em;overflow:hidden}' +
            '.bstv-detail__next{margin-top:1em;opacity:.8}' +
            '.bstv-muted{opacity:.45;margin-top:1.2em}' +
            '.bstv-epg{position:absolute;right:0;top:0;bottom:0;display:flex;background:rgba(12,14,18,.95)}' +
            '.bstv-epg.hide{display:none}' +
            '.bstv-epg__main{width:32em;display:flex;flex-direction:column;border-right:1px solid rgba(255,255,255,.07)}' +
            '.bstv-epg__head{display:flex;align-items:center;padding:1.2em 1.2em .6em}' +
            '.bstv-epg__head .bstv-logo{width:3.6em;height:2.5em;margin-right:.9em}' +
            '.bstv-epg__name{font-size:1.3em;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}' +
            '.bstv-epg__date{opacity:.5;margin-left:.8em;white-space:nowrap}' +
            '.bstv-days{display:flex;padding:.4em .9em .8em;overflow:hidden;border-bottom:1px solid rgba(255,255,255,.07)}' +
            '.bstv-day{padding:.35em .8em;border-radius:.5em;opacity:.55;white-space:nowrap;margin-right:.3em}' +
            '.bstv-day.on{background:rgba(80,140,255,.22);color:#9ec1ff;opacity:1}' +
            '.bstv-epg .bstv-row{height:3.4em}' +
            '.bstv-epg .bstv-row.past{opacity:.55}' +
            '.bstv-epg .bstv-row.focus{opacity:1}' +
            '.bstv-epg__t{width:3.6em;flex-shrink:0;opacity:.7;font-variant-numeric:tabular-nums}' +
            '.bstv-row.live .bstv-epg__t{color:#4cd964;opacity:1}' +
            '.bstv-epg__mark{margin-left:auto;padding-left:.6em;color:#7fb0ff;flex-shrink:0}' +
            '.bstv-epg .bstv-bar{margin:.3em 0 0}' +
            '.bstv-epg__desc{width:22em;padding:1.4em}' +
            '@media (max-width:767px){.bstv-col{width:78vw}.bstv-cats{width:60vw}.bstv-detail,.bstv-epg__desc{display:none}.bstv-epg__main{width:100vw}' +
                '.bstv-info{padding:3em 1.2em 1.2em}.bstv-info__name{font-size:1.5em}.bstv-keys{display:none}}';
        document.head.appendChild(s);
    }

    function logoHtml(ch) {
        var letter = esc(String(ch.name || '?').replace(/^[^\wа-яё]+/i, '').charAt(0).toUpperCase() || '?');
        if (!ch.logo) return '<div class="bstv-logo"><span>' + letter + '</span></div>';
        return '<div class="bstv-logo"><img src="' + esc(ch.logo) + '" onerror="this.parentNode.innerHTML=\'<span>' + letter + '</span>\'"></div>';
    }

    function build() {
        css();
        var root = $('<div class="bstv">' +
            '<div class="bstv-tap"></div>' +
            '<div class="bstv-load hide"></div>' +
            '<div class="bstv-num hide"></div>' +
            '<div class="bstv-info hide"></div>' +
            '<div class="bstv-side hide">' +
                '<div class="bstv-col bstv-cats hide"><div class="bstv-col__head"><span>Разделы</span><span class="bstv-x" data-act="close">✕</span></div><div class="bstv-col__body"></div><div class="bstv-col__foot">OK — открыть · ► — каналы</div></div>' +
                '<div class="bstv-col bstv-list"><div class="bstv-col__head"><span class="bstv-list__title"></span><span class="bstv-col__count"></span><span class="bstv-x" data-act="cats">Разделы</span><span class="bstv-x" data-act="close">✕</span></div><div class="bstv-col__body"></div>' +
                    '<div class="bstv-col__foot">◄ разделы · OK смотреть · ► действия</div></div>' +
                '<div class="bstv-detail"></div>' +
            '</div>' +
            '<div class="bstv-epg hide"><div class="bstv-epg__main"><div class="bstv-epg__head"></div><div class="bstv-days"></div><div class="bstv-col__body"></div>' +
                '<div class="bstv-col__foot"></div></div><div class="bstv-epg__desc"></div></div>' +
            '</div>');
        root.on('click', '.bstv-list .bstv-row', function () { listFocus(+$(this).attr('data-i')); playFocused(); });
        root.on('click', '.bstv-epg .bstv-row', function () { S.epg.focus = +$(this).attr('data-i'); epgEnter(); });
        root.on('click', '.bstv-day', function () { epgDay(+$(this).attr('data-d') - S.epg.di); });
        root.on('click', '.bstv-cats .bstv-row', function () { S.cfocus = +$(this).attr('data-i'); openCat(); });
        root.on('click', '[data-act]', function (e) { e.stopPropagation(); touchAct($(this).attr('data-act')); });
        touchArea(root);
        // колёсико мыши в списках — как ▲▼
        root.on('wheel', '.bstv-side,.bstv-epg', function (e) {
            var d = e.originalEvent && e.originalEvent.deltaY;
            if (d) { e.preventDefault(); Lampa.Controller.move(d > 0 ? 'down' : 'up'); }
        });
        // пальцем по списку — листаем: каждые 45 px — строка (список рисуется окном, своей прокрутки у него нет)
        var ly = null, moved = false;
        root.on('touchstart', '.bstv-col__body', function (e) { ly = e.originalEvent.touches[0].clientY; moved = false; });
        root.on('touchmove', '.bstv-col__body', function (e) {
            if (ly === null) return;
            var y = e.originalEvent.touches[0].clientY;
            e.preventDefault();
            while (Math.abs(y - ly) >= 45) { Lampa.Controller.move(y < ly ? 'down' : 'up'); ly += y < ly ? -45 : 45; moved = true; }
        });
        root.on('touchend', '.bstv-col__body', function (e) { ly = null; if (moved) { e.preventDefault(); e.stopPropagation(); } });
        return root;
    }
    /* Касание и мышь по самому видео (слой bstv-tap — иначе плеер Lampa ставил бы паузу):
     * нажатие — плашка или закрыть открытое; свайп ▲▼ — соседний канал, вправо — список, влево — программа. */
    function touchArea(root) {
        var tap = root.find('.bstv-tap'), x0 = 0, y0 = 0, touchAt = 0;
        var act = function (dx, dy) {
            if (!S) return;
            if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx)) { if (!S.panel) step(dy < 0 ? 1 : -1); return; }
            if (Math.abs(dx) > 60) { if (!S.panel) { if (dx > 0) openList(); else openEpg(); } return; }
            if (S.panel === 'epg') closeEpg();
            else if (S.panel) closeSide();
            else if (S.zap >= 0) zapNow();
            else info(!S.info);
        };
        tap.on('touchstart', function (e) {
            var t = e.originalEvent.touches[0];
            x0 = t.clientX; y0 = t.clientY;
        });
        tap.on('touchend', function (e) {
            var t = e.originalEvent.changedTouches[0];
            touchAt = Date.now();
            e.preventDefault();
            act(t.clientX - x0, t.clientY - y0);
        });
        tap.on('click', function () { if (Date.now() - touchAt > 600) act(0, 0); });
    }

    function showLoad(text) { if (S) S.root.find('.bstv-load').toggleClass('hide', !text).text(text || ''); }

    /* Передачи канала уже в памяти — сразу; нет — грузим, а нарисовать заново зовём then (только если пришли). */
    function progCached(ch) { var k = epgIdx ? epgKey(ch, epgIdx) : ''; return k ? epgData[k] || null : null; }
    function progLoad(ch, then) { epgGet(ch, function (p) { if (p && S) then(p); }); }

    function progHtml(pr, next, arc) {
        if (!pr) return '';
        var end = arc ? 'в архиве' : 'осталось ' + left(pr[1]);
        return '<div class="bstv-prog"><div class="bstv-prog__title">' + esc(pr[2]) + '</div>' +
            (arc ? '' : '<div class="bstv-bar"><div style="width:' + pct(pr).toFixed(1) + '%"></div></div>') +
            '<div class="bstv-prog__times"><span>' + hm(pr[0]) + '</span><span>' + end + '</span><span>' + hm(pr[1]) + '</span></div>' +
            (next && !arc ? '<div class="bstv-prog__next">Далее: <b>' + esc(next[2]) + '</b> · ' + hm(next[0]) + '</div>' : '') + '</div>';
    }
    function drawInfo(note) {
        var zap = S.zap >= 0, ch = zap ? S.view.list[S.zap] : S.cur, num = (zap ? S.zap : S.pos) + 1;
        if (!ch) return;
        var arc = !zap && S.arc, p = progCached(ch), n = arc ? null : epgNow(p), bl = blocked(ch);
        if (bl) note = 'Этот канал идёт по http — на защищённой странице (https) браузер его не включит. OK — открыть Lampa по http';
        var keys = arc ? [['◄►', 'Перемотка'], ['OK', 'Пауза'], ['Назад', 'В эфир'], ['▲▼', 'Каналы']]
            : bl ? [['OK', 'Открыть по http'], ['▲▼', 'Другой канал'], ['◄', 'Каналы']]
            : [['◄', 'Каналы'], ['►', 'Программа'], ['▲▼', 'Переключить'], ['OK', 'Скрыть']];
        var k = '', i;
        for (i = 0; i < keys.length; i++) k += '<div class="bstv-key"><b>' + keys[i][0] + '</b>' + keys[i][1] + '</div>';
        S.root.find('.bstv-info').html(
            '<div class="bstv-info__row">' + logoHtml(ch) +
                '<div style="min-width:0"><div class="bstv-info__row"><span class="bstv-info__num">' + num + '</span><div class="bstv-info__name">' + esc(ch.name) + '</div></div>' +
                '<div class="bstv-info__sub">' + esc([ch.group, S.view.title === 'Все каналы' ? S.pl.name : S.view.title].filter(Boolean).join(' · ')) + '</div></div>' +
                '<div class="bstv-info__right"><span class="bstv-clock">' + clock() + '</span>' + (arc ? '<span class="bstv-arc">Архив</span>' : '<span class="bstv-live">Прямой эфир</span>') + '</div>' +
            '</div>' +
            (arc ? progHtml(arc, null, true) : n ? progHtml(n.cur, n.next) : '') +
            (note ? '<div class="bstv-state">' + esc(note) + '</div>' : '') +
            '<div class="bstv-keys">' + k + '</div>' +
            '<div class="bstv-touch">' + (bl ? '<div data-act="http">Открыть по http</div>' : '') + '<div data-act="list">Каналы</div><div data-act="epg">Программа</div><div data-act="prev">▲</div><div data-act="next">▼</div>' +
                '<div data-act="menu">Действия</div><div data-act="exit">Выйти</div></div>');
        if (!p) progLoad(ch, function () {
            var now = S.zap >= 0 ? S.view.list[S.zap] : S.cur;
            if (S.info && now && chKey(now) === chKey(ch)) drawInfo(note);
        });
    }
    function info(show, note, stay) {
        clearTimeout(S.infoTimer);
        S.info = !!show;
        if (show) drawInfo(note);
        S.root.find('.bstv-info').toggleClass('hide', !show);
        if (show && !stay) S.infoTimer = setTimeout(function () { if (S) info(false); }, INFO_MS);
    }

    /* ---------- список и разделы ---------- */

    function windowOf(total, focus) {
        var from = Math.max(0, Math.min(focus - Math.floor(ROWS / 2), total - ROWS));
        return { from: from, to: Math.min(total, from + ROWS) };
    }
    var redrawTimer = null;
    function redrawSoon() {
        clearTimeout(redrawTimer);
        redrawTimer = setTimeout(function () { if (S && S.panel === 'list') drawList(); else if (S && S.panel === 'cats') drawList(); }, 200);
    }
    function drawList() {
        var list = S.view.list, w = windowOf(list.length, S.focus), html = '', i, ch, n, p, playing = S.cur ? chKey(S.cur) : '';
        for (i = w.from; i < w.to; i++) {
            ch = list[i];
            p = progCached(ch);
            if (!p) progLoad(ch, redrawSoon);                       // передачи видимых строк — подгружаем
            n = epgNow(p);
            html += '<div class="bstv-row' + (i === S.focus ? ' focus' : '') + (chKey(ch) === playing ? ' play' : '') + '" data-i="' + i + '">' +
                '<div class="bstv-row__num">' + (chKey(ch) === playing ? '● ' : '') + (i + 1) + '</div>' + logoHtml(ch) +
                '<div class="bstv-row__body"><div class="bstv-row__name">' + esc(ch.name) + (isFav(ch) >= 0 ? '<span class="bstv-row__fav">★</span>' : '') + (blocked(ch) ? '<span class="bstv-row__http">http</span>' : '') + '</div>' +
                '<div class="bstv-row__sub">' + esc(n ? n.cur[2] : ch.group || '') + '</div></div>' +
                (n ? '<div class="bstv-row__time">' + hm(n.cur[0]) + '</div>' : '') + '</div>';
        }
        if (!list.length) html = '<div class="bstv-empty">' + (S.view.type === 'fav' ? 'Пока пусто: ► на канале → «В избранное»' : 'Каналов нет') + '</div>';
        S.root.find('.bstv-list .bstv-col__body').html(html);
        S.root.find('.bstv-list__title').text(S.view.title);
        S.root.find('.bstv-list .bstv-col__count').text(list.length);
        drawDetail();
    }
    /** Колонка справа от списка: что идёт на канале под фокусом и что дальше. */
    function drawDetail() {
        var ch = S.view.list[S.focus], box = S.root.find('.bstv-detail');
        if (!ch) return box.html('');
        var p = progCached(ch), n = epgNow(p), h = '<div class="bstv-detail__name">' + esc(ch.name) + '</div><div class="bstv-detail__sub">' + esc(ch.group || S.pl.name) + '</div>';
        if (n) {
            h += '<div class="bstv-onair">● СЕЙЧАС</div><div class="bstv-detail__title">' + esc(n.cur[2]) + '</div>' +
                '<div class="bstv-detail__time">' + hm(n.cur[0]) + ' – ' + hm(n.cur[1]) + '</div>' +
                '<div class="bstv-bar"><div style="width:' + pct(n.cur).toFixed(1) + '%"></div></div><div class="bstv-detail__left">осталось ' + left(n.cur[1]) + '</div>' +
                (n.cur[3] ? '<div class="bstv-detail__desc">' + esc(n.cur[3]) + '</div>' : '') +
                (n.next ? '<div class="bstv-detail__next">Далее: <b>' + esc(n.next[2]) + '</b><br>' + hm(n.next[0]) + ' – ' + hm(n.next[1]) + '</div>' : '');
        } else h += '<div class="bstv-muted">' + (p ? 'Сейчас передач нет' : 'Программы для этого канала нет') + '</div>';
        box.html(h);
    }

    /* ---------- программа передач канала (►) ---------- */

    var DAY_NAMES = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
    function dayStart(min) { var d = new Date(min * 60000); d.setHours(0, 0, 0, 0); return d.getTime() / 60000; }
    function dayLabel(start) {
        var today = dayStart(nowMin()), diff = Math.round((start - today) / 1440), d = new Date(start * 60000);
        return diff === 0 ? 'Сегодня' : diff === -1 ? 'Вчера' : diff === 1 ? 'Завтра' : DAY_NAMES[d.getDay()] + ' ' + d.getDate();
    }
    var WEEK = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
    var MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    // свой формат: toLocaleDateString на старых ТВ пишет по-английски
    function dateLong(min) { var d = new Date(min * 60000); return WEEK[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; }
    function openEpg(ch) {
        ch = ch || S.cur;
        if (!ch) return;
        zapCancel();
        info(false);
        showLoad('Загружаю программу…');
        epgGet(ch, function (p) {
            if (!S) return;
            showLoad('');
            if (!p) { noty('Программы для этого канала нет'); return Lampa.Controller.toggle(ctrlName()); }
            var days = [], seen = {}, i, ds, today = dayStart(nowMin()), di = 0;
            for (i = 0; i < p.length; i++) { ds = dayStart(p[i][0]); if (!seen[ds]) { seen[ds] = 1; days.push(ds); } }
            for (i = 0; i < days.length; i++) if (days[i] === today) di = i;
            S.epg = { ch: ch, p: p, days: days, di: -1, focus: 0, back: S.panel };
            S.panel = 'epg';
            S.root.find('.bstv-side').addClass('hide');
            S.root.find('.bstv-epg').removeClass('hide');
            epgDay(di + 1, true);
            Lampa.Controller.toggle('bstv_epg');
        });
    }
    function epgRows() {
        var e = S.epg, from = e.days[e.di], to = from + 1440, out = [], i;
        for (i = 0; i < e.p.length; i++) if (e.p[i][0] >= from && e.p[i][0] < to) out.push(i);
        return out;
    }
    function epgDay(dir, first) {
        var e = S.epg, di = first ? dir - 1 : e.di + dir, n = nowMin(), i;
        if (di < 0 || di >= e.days.length || di === e.di) return;
        e.di = di;
        e.rows = epgRows();
        e.focus = 0;
        for (i = 0; i < e.rows.length; i++) if (e.p[e.rows[i]][0] <= n) e.focus = i;   // сегодня — на том, что идёт сейчас
        drawEpg();
    }
    function epgFocus(i) { var e = S.epg; e.focus = Math.max(0, Math.min(e.rows.length - 1, i)); drawEpg(); }
    function drawEpg() {
        var e = S.epg, ch = e.ch, n = nowMin(), w = windowOf(e.rows.length, e.focus), html = '', tabs = '', i, pr, live, past, mark;
        S.root.find('.bstv-epg__head').html(logoHtml(ch) + '<div class="bstv-epg__name">' + esc(ch.name) + '</div><div class="bstv-epg__date">' +
            dateLong(e.days[e.di]) + '</div><span class="bstv-x" data-act="close">✕</span>');
        for (i = 0; i < e.days.length; i++) tabs += '<div class="bstv-day' + (i === e.di ? ' on' : '') + '" data-d="' + i + '">' + dayLabel(e.days[i]) + '</div>';
        S.root.find('.bstv-days').html(tabs);
        for (i = w.from; i < w.to; i++) {
            pr = e.p[e.rows[i]];
            live = pr[0] <= n && n < pr[1];
            past = pr[1] <= n;
            mark = live ? '<span class="bstv-live" style="font-size:.8em">Эфир</span>' : past && inArchive(ch, pr) ? '▶' : '';
            html += '<div class="bstv-row' + (i === e.focus ? ' focus' : '') + (live ? ' live' : '') + (past ? ' past' : '') + '" data-i="' + i + '">' +
                '<div class="bstv-epg__t">' + hm(pr[0]) + '</div><div class="bstv-row__body"><div class="bstv-row__name">' + esc(pr[2]) + '</div>' +
                (live ? '<div class="bstv-bar"><div style="width:' + pct(pr).toFixed(1) + '%"></div></div>' : '') + '</div>' +
                (mark ? '<div class="bstv-epg__mark">' + mark + '</div>' : '') + '</div>';
        }
        if (!e.rows.length) html = '<div class="bstv-empty">Передач нет</div>';
        S.root.find('.bstv-epg .bstv-col__body').html(html);
        pr = e.p[e.rows[e.focus]];
        var act = !pr ? '' : pr[1] <= n ? (inArchive(ch, pr) ? 'OK — смотреть' : 'архива нет') : pr[0] <= n ? (ch.arc ? 'OK — с начала' : 'OK — смотреть') : 'OK — напомнить';
        S.root.find('.bstv-epg .bstv-col__foot').text('▲▼ передачи · ◄► дни' + (act ? ' · ' + act : '') + ' · Назад — закрыть');
        var d = '';
        if (pr) {
            live = pr[0] <= n && n < pr[1];
            d = '<div class="bstv-detail__title" style="font-size:1.4em">' + esc(pr[2]) + '</div><div class="bstv-detail__time">' + hm(pr[0]) + ' – ' + hm(pr[1]) + '</div>' +
                (live ? '<div class="bstv-bar"><div style="width:' + pct(pr).toFixed(1) + '%"></div></div><div class="bstv-detail__left">осталось ' + left(pr[1]) + '</div>'
                    : pr[0] > n ? '<div class="bstv-detail__left">через ' + left(pr[0]) + '</div>' : '') +
                (pr[3] ? '<div class="bstv-detail__desc">' + esc(pr[3]) + '</div>' : '');
        }
        S.root.find('.bstv-epg__desc').html(d);
    }
    function closeEpg() {
        var back = S.epg ? S.epg.back : '';
        S.root.find('.bstv-epg').addClass('hide');
        S.epg = null;
        if (back === 'list') return openList();
        S.panel = '';
        Lampa.Controller.toggle('bstv');
        info(true);
    }
    function epgEnter() {
        var e = S.epg, pr = e && e.p[e.rows[e.focus]], n = nowMin(), ch = e && e.ch;
        if (!pr) return;
        if (pr[0] > n) return remind(ch, pr);
        if (pr[1] <= n && !inArchive(ch, pr)) return noty('Архива у этого канала нет');
        var live = pr[1] > n;
        if (live && !ch.arc) { closeEpgTo(ch); return; }
        var url = arcUrl(ch, pr);
        if (!url) return noty('Архив этого канала не поддерживается');
        closeEpgTo(ch, pr, url);
    }
    /** Из программы — на канал: в эфир или (pr, url) в архив. */
    function closeEpgTo(ch, pr, url) {
        S.root.find('.bstv-epg').addClass('hide');
        S.epg = null;
        S.panel = '';
        Lampa.Controller.toggle('bstv');
        var at = indexIn(S.view.list, ch);
        if (at < 0) { setView(viewOf('all')); at = indexIn(S.view.list, ch); }
        if (!url) { if (!S.cur || chKey(S.cur) !== chKey(ch) || S.arc) play(at >= 0 ? at : S.pos); else info(true); return; }
        if (at >= 0) S.pos = at;
        S.cur = ch;
        S.arc = pr;
        S.failed = false;
        try { Lampa.PlayerIPTV.listener.send('play', { channel: { name: ch.name, url: url, group: ch.group, logo: ch.logo }, position: 0 }); }
        catch (e) { log('archive', e && e.message); }
        info(true);
    }
    /** «Напомнить»: в начале передачи, если «Телеканалы» ещё открыты, сами включаем канал. */
    function remind(ch, pr) {
        var ms = pr[0] * 60000 - Date.now();
        if (ms > 24 * 3600000) return noty('Напомнить можно о передачах в ближайшие сутки');
        S.timers = S.timers || [];
        S.timers.push(setTimeout(function () {
            if (!S || !S.playing) return;
            noty('Начинается «' + pr[2] + '»');
            var at = indexIn(S.view.list, ch);
            if (at < 0) { setView(viewOf('all')); at = indexIn(S.view.list, ch); }
            if (at >= 0) play(at);
        }, ms));
        noty('Напомню в ' + hm(pr[0]) + ': включу «' + ch.name + '»');
    }
    function cats() {
        var out = [{ t: 'search', title: 'Поиск', sub: '' }, { t: 'fav', title: 'Избранное', sub: favs().length + '' },
            { t: 'recent', title: 'Недавние', sub: recents().length + '' }, { t: 'all', title: 'Все каналы', sub: S.data.channels.length + '' }], i, g, pls;
        // плейлисты — сразу под «Все каналы»: внизу, под десятками разделов, их не найти
        pls = playlists();
        if (pls.length > 1) for (i = 0; i < pls.length; i++) out.push({ t: 'pl', id: pls[i].id, title: (pls[i].id === S.pl.id ? '● ' : '') + pls[i].name, sub: 'плейлист' });
        if (skazItem().length) out.push({ t: 'skaz', title: 'TV Skaz', sub: 'каналы Skaz' });
        out.push({ t: 'addpl', title: '+ Добавить свой плейлист', sub: '' });
        for (i = 0; i < S.data.groups.length; i++) { g = S.data.groups[i]; out.push({ t: 'group', name: g.name, title: g.name, sub: g.count + '' }); }
        return out;
    }
    /* TV Skaz — телеканалы сборки Skaz (свой плеер, их VIP и реклама). Каналы у них не берём: даём переход на их экран —
     * тот же пункт меню «TV Skaz» (есть он — значит, их плагин загружен). */
    function skazItem() {
        try { return $('.menu .menu__item').filter(function () { return $(this).find('.menu__text').text().replace(/^\s+|\s+$/g, '') === 'TV Skaz'; }).first(); }
        catch (e) { return { length: 0 }; }
    }
    function openSkaz() {
        var it = skazItem();
        if (!it.length) return noty('TV Skaz сейчас недоступен');
        exit();
        setTimeout(function () { try { it.trigger('hover:enter'); } catch (e) {} }, 300);
    }
    function drawCats() {
        var c = S.cats, w = windowOf(c.length, S.cfocus), html = '', i, on;
        for (i = w.from; i < w.to; i++) {
            on = (c[i].t === S.view.type && (c[i].t !== 'group' || c[i].name === S.view.name));
            html += '<div class="bstv-row' + (i === S.cfocus ? ' focus' : '') + (on ? ' play' : '') + '" data-i="' + i + '">' +
                '<div class="bstv-row__body"><div class="bstv-row__name">' + esc(c[i].title) + '</div></div><div class="bstv-row__count">' + esc(c[i].sub) + '</div></div>';
        }
        S.root.find('.bstv-cats .bstv-col__body').html(html);
    }
    function listFocus(i) {
        var n = S.view.list.length;
        if (!n) { S.focus = 0; return drawList(); }
        S.focus = Math.max(0, Math.min(n - 1, i));
        drawList();
    }
    function openList() {
        zapCancel();
        info(false);
        S.panel = 'list';
        var at = indexIn(S.view.list, S.cur);
        S.focus = at >= 0 ? at : S.focus || 0;
        S.root.find('.bstv-side').removeClass('hide side--cats');
        S.root.find('.bstv-cats').addClass('hide');
        drawList();
        Lampa.Controller.toggle('bstv_list');
    }
    function openCats() {
        S.panel = 'cats';
        S.cats = cats();
        S.cfocus = 0;
        for (var i = 0; i < S.cats.length; i++) if (S.cats[i].t === S.view.type && (S.view.type !== 'group' || S.cats[i].name === S.view.name)) S.cfocus = i;
        S.root.find('.bstv-side').addClass('side--cats');
        S.root.find('.bstv-cats').removeClass('hide');
        drawCats();
        Lampa.Controller.toggle('bstv_cats');
    }
    function closeSide() {
        S.panel = '';
        S.root.find('.bstv-side').addClass('hide');
        Lampa.Controller.toggle('bstv');
    }
    function setView(v) {
        S.view = v;
        var at = indexIn(v.list, S.cur);
        S.focus = at >= 0 ? at : 0;
        lsSet('bs_tv_view', JSON.stringify({ type: v.type, name: v.type === 'group' ? v.name : '' }));
    }
    /** Раздел под фокусом сразу показываем в списке каналов — без OK (поиск и плейлисты — только по OK). */
    function catPreview() {
        var c = S.cats[S.cfocus];
        if (c && c.t !== 'search' && c.t !== 'pl' && c.t !== 'skaz' && c.t !== 'addpl') { setView(viewOf(c.t, c.name)); drawList(); }
        drawCats();
    }
    function openCat() {
        var c = S.cats[S.cfocus];
        if (!c) return;
        if (c.t === 'search') {
            try {
                Lampa.Input.edit({ title: 'Поиск канала', value: '', free: true, nosave: true }, function (q) {
                    q = String(q || '').replace(/^\s+|\s+$/g, '');
                    if (q) setView(viewOf('search', '', q));
                    openList();
                });
            } catch (e) { openList(); }
            return;
        }
        if (c.t === 'pl') return switchPlaylist(c.id);
        if (c.t === 'skaz') return openSkaz();
        if (c.t === 'addpl') return addPlaylist('bstv_cats');
        setView(viewOf(c.t, c.name));
        openList();
    }
    function playFocused() {
        var ch = S.view.list[S.focus];
        if (!ch) return;
        if (S.cur && chKey(ch) === chKey(S.cur)) return closeSide();     // тот же канал — просто закрыть список
        closeSide();
        play(S.focus);
    }

    /* ---------- воспроизведение ---------- */

    function play(pos) {
        var list = S.view.list, n = list.length;
        if (!n) return;
        pos = ((pos % n) + n) % n;
        var ch = list[pos];
        zapCancel();
        S.pos = pos;
        S.cur = ch;
        S.arc = null;
        S.failed = false;
        S.playAt = Date.now();
        if (blocked(ch)) {                                           // не включится — стоп и подсказка «открыть по http»
            try { Lampa.PlayerVideo.pause(); } catch (e) {}
            if (!S.panel) info(true, '', true);
            return;
        }
        addRecent(ch);
        lsSet('bs_tv_last', JSON.stringify({ pl: S.pl.id, ch: short(ch) }));
        try { Lampa.PlayerIPTV.listener.send('play', { channel: { name: ch.name, url: ch.url, group: ch.group, logo: ch.logo }, position: 0 }); }
        catch (e) { log('play', e && e.message); }
        if (!S.panel) info(true);
    }
    /* ▲▼ как у приставки: плашка сразу показывает соседний канал, а включаем его, когда человек перестал листать
     * (ZAP_MS) — пролистать пять каналов можно, не дожидаясь каждого. OK — включить сразу, Назад — остаться. */
    function step(dir) {
        var n = S.view.list.length;
        if (!n) return;
        S.zap = (((S.zap >= 0 ? S.zap : S.pos) + dir) % n + n) % n;
        clearTimeout(S.zapTimer);
        info(true);
        S.zapTimer = setTimeout(zapNow, ZAP_MS);
    }
    function zapNow() {
        if (!S || S.zap < 0) return;
        var p = S.zap;
        S.zap = -1;
        play(p);
    }
    function zapCancel() { clearTimeout(S.zapTimer); S.zap = -1; }

    function digit(d) {
        clearTimeout(S.numTimer);
        S.num = (S.num + d).slice(-4);
        S.root.find('.bstv-num').removeClass('hide').text(S.num);
        S.numTimer = setTimeout(function () {
            if (!S) return;
            var n = parseInt(S.num, 10);
            S.num = '';
            S.root.find('.bstv-num').addClass('hide');
            if (n >= 1 && n <= S.view.list.length) play(n - 1); else noty('Нет канала с номером ' + n);
        }, NUM_MS);
    }

    function actions() {
        var ch = S.panel === 'list' ? S.view.list[S.focus] : S.cur, back = S.panel === 'list' ? 'bstv_list' : 'bstv';
        if (!ch) return;
        var items = [
            { title: isFav(ch) >= 0 ? 'Убрать из избранного' : 'В избранное', act: 'fav' },
            { title: 'Сменить плейлист', act: 'pl' },
            { title: 'Обновить список каналов', act: 'reload' },
            { title: 'Выйти из телеканалов', act: 'exit' }
        ];
        Lampa.Select.show({
            title: ch.name,
            items: items,
            onBack: function () { Lampa.Controller.toggle(back); },
            onSelect: function (a) {
                if (a.act === 'fav') {
                    noty(toggleFav(ch) ? 'Добавлено в избранное' : 'Убрано из избранного');
                    if (S.view.type === 'fav') setView(viewOf('fav'));
                    if (S.panel === 'list') drawList();
                    Lampa.Controller.toggle(back);
                } else if (a.act === 'pl') choosePlaylist(back);
                else if (a.act === 'reload') { Lampa.Controller.toggle(back); reload(); }
                else exit();
            }
        });
    }
    /* Свои плейлисты (от провайдера и т. п.) — в тот же список, что у расширения IPTV (iptv_playlist_custom): расширение
     * у нас больше не главное, добавить ссылку теперь можно и здесь. Убрать можно только свой, наши «sunic-iptv-…» —
     * в «Sunic Apps → IPTV: открытые плейлисты». */
    function customList() {
        var l = [];
        try { l = Lampa.Storage.get('iptv_playlist_custom', '[]'); } catch (e) {}
        return isArr(l) ? l.slice() : [];
    }
    function addPlaylist(back) {
        var ask = function (title, value, done) {
            try { Lampa.Input.edit({ title: title, value: value, free: true, nosave: true }, done); } catch (e) { Lampa.Controller.toggle(back); }
        };
        ask('Ссылка на плейлист (m3u)', '', function (url) {
            url = String(url || '').replace(/^\s+|\s+$/g, '');
            if (!/^https?:\/\/\S+$/i.test(url)) { if (url) noty('Нужна ссылка, начинается с http:// или https://'); return Lampa.Controller.toggle(back); }
            var host = (/^https?:\/\/([^\/?#]+)/i.exec(url) || [])[1] || 'Плейлист';
            ask('Название', host, function (name) {
                var l = customList(), id = '', i;
                for (i = 0; i < l.length; i++) if (l[i] && l[i].url === url) id = String(l[i].id || url);   // уже есть — просто включаем
                if (!id) {
                    id = 'bstv-' + new Date().getTime();
                    l.push({ id: id, custom: true, url: url, name: String(name || '').replace(/^\s+|\s+$/g, '') || host });
                    try { Lampa.Storage.set('iptv_playlist_custom', l); } catch (e) {}
                }
                Lampa.Controller.toggle(back);
                switchPlaylist(id);
            });
        });
    }
    function mine(id) { var l = customList(), i; for (i = 0; i < l.length; i++) if (l[i] && String(l[i].id || l[i].url) === id) return true; return false; }
    function removePlaylist(pl, back) {
        var l = customList(), out = [], i;
        for (i = 0; i < l.length; i++) if (!(l[i] && String(l[i].id || l[i].url) === pl.id)) out.push(l[i]);
        try { Lampa.Storage.set('iptv_playlist_custom', out); } catch (e) {}
        noty('Плейлист «' + pl.name + '» убран');
        Lampa.Controller.toggle(back);
        switchPlaylist(playlists()[0].id);
    }
    function choosePlaylist(back) {
        var pls = playlists(), items = [], i;
        for (i = 0; i < pls.length; i++) items.push({ title: pls[i].name, id: pls[i].id, selected: pls[i].id === S.pl.id });
        if (skazItem().length) items.push({ title: 'TV Skaz', act: 'skaz' });
        items.push({ title: '+ Добавить свой плейлист', act: 'add' });
        if (!S.pl.key && mine(S.pl.id)) items.push({ title: 'Убрать «' + S.pl.name + '»', act: 'del' });
        Lampa.Select.show({
            title: 'Плейлист',
            items: items,
            onBack: function () { Lampa.Controller.toggle(back); },
            onSelect: function (a) {
                if (a.act === 'add') return addPlaylist(back);
                if (a.act === 'skaz') return openSkaz();
                if (a.act === 'del') return removePlaylist(S.pl, back);
                Lampa.Controller.toggle(back); switchPlaylist(a.id);
            }
        });
    }
    function switchPlaylist(id) {
        var pl = playlistById(id);
        if (S.panel) closeSide();
        showLoad('Загружаю «' + pl.name + '»…');
        load(pl, function (data) {
            if (!S) return;
            showLoad('');
            if (!data) return noty('Плейлист «' + pl.name + '» не загрузился');
            S.pl = pl;
            S.data = data;
            lsSet('bs_tv_pl', pl.id);
            setView(viewOf('all'));
            play(0);
        });
    }
    function reload() {
        var id = S.pl.id;
        showLoad('Обновляю список…');
        load(S.pl, function (data) {
            if (!S) return;
            showLoad('');
            if (!data || S.pl.id !== id) return noty('Список не обновился');
            S.data = data;
            setView(viewOf(S.view.type, S.view.type === 'group' ? S.view.name : ''));
            noty('Каналов: ' + data.channels.length);
        }, true);
    }

    function touchAct(a) {
        if (!S) return;
        if (a === 'list') openList();
        else if (a === 'prev') step(-1);
        else if (a === 'next') step(1);
        else if (a === 'menu') actions();
        else if (a === 'epg') openEpg();
        else if (a === 'cats') openCats();
        else if (a === 'http') goHttp(S.cur);
        else if (a === 'close') { if (S.panel === 'epg') closeEpg(); else if (S.panel === 'cats') openList(); else closeSide(); }
        else if (a === 'exit') exit();
    }

    /* ---------- контроллеры ---------- */

    function controllers() {
        Lampa.Controller.add('bstv', {
            invisible: true,
            toggle: function () { Lampa.Controller.clear(); },
            up: function () { step(-1); },
            down: function () { step(1); },
            // в архиве ◄► — перемотка, OK — пауза; в эфире ◄ — каналы, ► — программа
            left: function () { if (S.arc) { Lampa.PlayerVideo.rewind(false); info(true); } else openList(); },
            right: function () { if (S.arc) { Lampa.PlayerVideo.rewind(true); info(true); } else openEpg(); },
            enter: function () { if (S.zap >= 0) zapNow(); else if (blocked(S.cur)) goHttp(S.cur); else if (S.arc) { Lampa.PlayerVideo.playpause(); info(true); } else info(!S.info); },
            back: function () {
                if (S.zap >= 0) { zapCancel(); info(true); }
                else if (S.arc) play(S.pos);                                // из архива — обратно в эфир
                else if (S.info) info(false); else exit();
            }
        });
        Lampa.Controller.add('bstv_epg', {
            invisible: true,
            toggle: function () { Lampa.Controller.clear(); },
            up: function () { epgFocus(S.epg.focus - 1); },
            down: function () { epgFocus(S.epg.focus + 1); },
            left: function () { epgDay(-1); },
            right: function () { epgDay(1); },
            enter: epgEnter,
            back: closeEpg
        });
        Lampa.Controller.add('bstv_list', {
            invisible: true,
            toggle: function () { Lampa.Controller.clear(); },
            up: function () { listFocus(S.focus - 1); },
            down: function () { listFocus(S.focus + 1); },
            left: openCats,
            right: actions,
            enter: playFocused,
            back: closeSide
        });
        Lampa.Controller.add('bstv_cats', {
            invisible: true,
            toggle: function () { Lampa.Controller.clear(); },
            up: function () { S.cfocus = Math.max(0, S.cfocus - 1); catPreview(); },
            down: function () { S.cfocus = Math.min(S.cats.length - 1, S.cfocus + 1); catPreview(); },
            right: function () { openList(); },
            enter: openCat,
            back: function () { openList(); }
        });
    }

    function ctrlName() { return !S ? '' : S.panel === 'cats' ? 'bstv_cats' : S.panel === 'list' ? 'bstv_list' : S.panel === 'epg' ? 'bstv_epg' : 'bstv'; }
    var hooked = false;
    function hooks() {
        if (hooked) return;
        hooked = true;
        // пока открыт наш экран, кнопки плеера Lampa (его панели, перемотка, IPTV-переключатель) — наши
        Lampa.Controller.listener.follow('toggle', function (e) {
            if (S && S.playing && /^player(_tv|_panel|_rewind|_footer)?$/.test(e.name)) Lampa.Controller.toggle(ctrlName());
        });
        Lampa.Player.listener.follow('destroy', function () { if (S && S.playing) end(); });
        Lampa.PlayerVideo.listener.follow('error', function () {
            // ошибка прошлого канала, пока включается новый, — не про него
            if (!S || !S.playing || S.failed || blocked(S.cur) || Date.now() - (S.playAt || 0) < 2500) return;
            S.failed = true;
            if (!S.panel) info(true, S.arc ? 'Архив не открылся — Назад, в эфир' : 'Канал не отвечает — ▲▼ другой канал', true);
        });
        var ok = function () { if (S && S.failed) { S.failed = false; if (S.info) info(true); } };
        Lampa.PlayerVideo.listener.follow('canplay', ok);
        Lampa.PlayerVideo.listener.follow('play', ok);
        Lampa.Keypad.listener.follow('keydown', function (e) {
            if (!S || !S.playing || S.panel === 'cats' || S.panel === 'epg') return;
            var c = e.code, d = -1;
            if (c >= 48 && c <= 57) d = c - 48; else if (c >= 96 && c <= 105) d = c - 96;
            if (d >= 0 && !S.panel) return digit(String(d));
            if (c === 427 || c === 33) { if (S.panel) listFocus(S.focus - ROWS); else step(-1); }      // CH+ / PageUp
            else if (c === 428 || c === 34) { if (S.panel) listFocus(S.focus + ROWS); else step(1); }  // CH- / PageDown
        });
    }

    function end() {
        clearTimeout(S.infoTimer);
        clearTimeout(S.numTimer);
        clearTimeout(S.zapTimer);
        for (var i = 0; S.timers && i < S.timers.length; i++) clearTimeout(S.timers[i]);
        try { S.root.remove(); } catch (e) {}
        try { Lampa.Player.render().removeClass('bstv-on'); } catch (e) {}
        S = null;
    }
    function exit() { try { Lampa.Player.close(); } catch (e) { if (S) end(); } }

    /* ---------- запуск ---------- */

    function startWith(pl, data) {
        var last = lsJson('bs_tv_last', null), saved = lsJson('bs_tv_view', null), pos = 0, at;
        S.pl = pl;
        S.data = data;
        S.view = viewOf(saved && saved.type !== 'search' ? saved.type : 'all', saved && saved.name);
        if (!S.view.list.length) S.view = viewOf('all');
        if (last && last.ch) { at = indexIn(S.view.list, last.ch); if (at >= 0) pos = at; }
        // на https первый канал должен включиться: http-канал — заменяем ближайшим, который включится
        for (at = 0; blocked(S.view.list[pos]) && at < S.view.list.length; at++) pos = (pos + 1) % S.view.list.length;
        var first = S.view.list[pos];
        S.pos = pos;
        S.cur = first;
        S.playing = true;
        hooks();
        controllers();
        addRecent(first);
        lsSet('bs_tv_last', JSON.stringify({ pl: pl.id, ch: short(first) }));
        var stub = { name: first.name, url: first.url };
        // total: 1 — переключение каналов самого плеера Lampa выключено (номера и CH ведём сами, см. hooks)
        Lampa.Player.iptv({
            title: first.name, url: first.url, position: 0, total: 1, bstv: true,
            onGetChannel: function () { return stub; },
            onGetProgram: function () {},
            onPlay: function () {}
        });
        // не пульт (телефон, планшет, мышь на ПК) — кнопки на экране и ✕ у списков
        var remote = false;
        try { remote = Lampa.Platform.tv() && !('ontouchstart' in window && navigator.maxTouchPoints > 0); } catch (e) {}
        S.root.toggleClass('bstv--touch', !remote);
        var holder = Lampa.Player.render();
        holder.addClass('bstv-on');
        holder.append(S.root);
        Lampa.Controller.toggle('bstv');
        info(true);
    }

    function open() {
        if (S) return;
        var pls = playlists(), pl = playlistById(lsGet('bs_tv_pl') || pls[0].id);
        S = { root: build(), panel: '', num: '', zap: -1, info: false, focus: 0, cfocus: 0, playing: false };
        try { Lampa.Loading.start(function () { S = null; Lampa.Loading.stop(); }); } catch (e) {}
        var tryLoad = function (list, n) {
            load(list[n], function (data) {
                if (!S) return;
                if (data && data.channels.length) { try { Lampa.Loading.stop(); } catch (e) {} return startWith(list[n], data); }
                if (n + 1 < list.length) return tryLoad(list, n + 1);
                try { Lampa.Loading.stop(); } catch (e) {}
                S = null;
                noty('Каналы не загрузились — проверьте интернет');
            });
        };
        // сначала выбранный плейлист, не загрузился — остальные по порядку
        var order = [pl], i;
        for (i = 0; i < pls.length; i++) if (pls[i].id !== pl.id) order.push(pls[i]);
        tryLoad(order, 0);
    }

    /** Открыть этот канал в Lampa по http: тот же адрес страницы, http и ?http=1, канал — в #bstv=… */
    function goHttp(ch) {
        if (!ch || !S) return;
        var pl = S.pl, data = { pl: pl.id, name: pl.name, url: pl.key ? ourUrl(pl.key) : pl.url, key: pl.key || '', ch: short(ch) };
        try { window.location.href = 'http://' + window.location.host + window.location.pathname + '?http=1#bstv=' + encodeURIComponent(JSON.stringify(data)); }
        catch (e) { log('http', e && e.message); }
    }
    /** Пришли со страницы по https с каналом (#bstv=…): запоминаем плейлист и канал и сразу открываем. */
    function fromHash() {
        var m = /[#&]bstv=([^&]+)/.exec(String(window.location.hash || '')), d = null;
        if (!m) return false;
        try { d = JSON.parse(decodeURIComponent(m[1])); } catch (e) {}
        try { window.history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) {}
        if (!d || !d.pl || !d.ch || !/^https?:\/\//i.test(String(d.url || '')) || !/^https?:\/\//i.test(String(d.ch.url || ''))) return false;
        lsSet('bs_tv_extra', JSON.stringify({ id: d.pl, name: d.name, url: d.url, key: /^\w+$/.test(String(d.key || '')) ? d.key : '' }));
        lsSet('bs_tv_pl', String(d.pl));
        lsSet('bs_tv_last', JSON.stringify({ pl: d.pl, ch: d.ch }));
        lsSet('bs_tv_view', JSON.stringify({ type: 'all', name: '' }));
        return true;
    }
    function start() {
        if (!window.Lampa || !Lampa.Menu || !Lampa.Player || !Lampa.Player.iptv) return;
        try { Lampa.Menu.addButton(ICON, 'Телеканалы', open); } catch (e) { log('menu', e && e.message); }
        if (fromHash()) setTimeout(open, 800);
    }

    return { start: start, open: open, _parse: parse, _playlists: playlists, _norm: tvNorm, _arcUrl: arcUrl, _epgNow: epgNow };
})();
