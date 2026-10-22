#!/usr/bin/env python3
"""Чистые IPTV-списки для зеркала sunic.stream/iptv/ (iptv.php) и «Телеканалов» (src/bstv.js).

Раз в день (workflow iptv.yml) берём те же 14 открытых списков, что в iptv.php, и:
  - убираем закрытые каналы — по iptv-org/database (channels.csv: closed / replaced_by);
  - убираем мёртвые каналы — проверяем каждый поток. Проверка идёт с серверов GitHub (США/Европа), а многие наши
    каналы закрыты для зарубежа (403) или медленно отвечают издалека, поэтому «мёртвый» — только точно мёртвый:
    404/410, домена нет, сервер отказал в соединении. И только 3 дня подряд (STRIKES). 403, 401, 451, 429, 5xx,
    таймаут и страница вместо плейлиста (так выглядят заглушки «недоступно в вашей стране») — «не знаем», канал остаётся;
  - дорисовываем логотип каналу без tvg-logo — по iptv-org/database (logos.csv).
Выход (ветка `iptv` без истории, перезаписывается):
  <ключ>.m3u    — список для iptv.php (зеркало кеширует его, http-фильтр /iptv/s/ делает оно же)
  state.json    {"v":1, "at":<unix>, "dead":{url: [дней подряд, последняя причина]}} — память между запусками
  report.json   сводка: сколько было, сколько убрано и почему — по каждому списку
Предыдущий state.json берём с ветки (raw.githubusercontent → jsDelivr). Источник не ответил — список пропускаем,
iptv.php тогда отдаёт оригинал iptv-org. Только стандартная библиотека.
"""
import csv
import io
import json
import os
import re
import socket
import ssl
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

OUT = sys.argv[1] if len(sys.argv) > 1 else 'iptv-out'
REPO = 'sunic007/lampa-samsung'
UA = {'User-Agent': 'Mozilla/5.0 (SunicApps-IPTV-check/1.0; +https://sunic.stream)'}
ORG = 'https://iptv-org.github.io/iptv/'
# как $LISTS в .github/msx/site/iptv.php и IPTV_LISTS в src/bsfeatures.js — менять вместе
LISTS = {
    'uz': ORG + 'countries/uz.m3u', 'rus': ORG + 'languages/rus.m3u', 'ru': ORG + 'countries/ru.m3u',
    'kz': ORG + 'countries/kz.m3u', 'tr': ORG + 'countries/tr.m3u', 'movies': ORG + 'categories/movies.m3u',
    'series': ORG + 'categories/series.m3u', 'kids': ORG + 'categories/kids.m3u', 'animation': ORG + 'categories/animation.m3u',
    'documentary': ORG + 'categories/documentary.m3u', 'sports': ORG + 'categories/sports.m3u', 'music': ORG + 'categories/music.m3u',
    'news': ORG + 'categories/news.m3u', 'freetv': 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8',
}
DB = 'https://raw.githubusercontent.com/iptv-org/database/master/data/'
# Free-TV: разделы — страны; эти (СНГ и бывший Союз, смотрят по-русски) добавляем в «На русском» с русским названием.
# Узбекистана, Киргизии, Таджикистана у Free-TV пока нет — появятся, добавим строку. Прибалтика — не СНГ, не берём
FREETV_RU = {
    'Russia': 'Россия', 'Ukraine': 'Украина', 'Belarus': 'Беларусь', 'Kazakhstan': 'Казахстан', 'Uzbekistan': 'Узбекистан',
    'Kyrgyzstan': 'Кыргызстан', 'Tajikistan': 'Таджикистан', 'Turkmenistan': 'Туркменистан', 'Armenia': 'Армения',
    'Azerbaijan': 'Азербайджан', 'Georgia': 'Грузия', 'Moldova': 'Молдова',
}
STRIKES = 3                 # дней подряд «точно мёртв» — тогда убираем
TIMEOUT = 12
WORKERS = 48
MAX_LIST = 3 * 1024 * 1024  # как MAX в iptv.php


def get(url, timeout=60):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


def text(url):
    try:
        return get(url).decode('utf-8', 'replace')
    except Exception as e:
        print('нет ответа', url, e)
        return None


def csv_rows(name):
    t = text(DB + name)
    return list(csv.DictReader(io.StringIO(t))) if t else []


def prev_state():
    for u in ('https://raw.githubusercontent.com/%s/iptv/state.json' % REPO, 'https://cdn.jsdelivr.net/gh/%s@iptv/state.json' % REPO):
        t = text(u + '?t=%d' % time.time())
        try:
            s = json.loads(t) if t else None
            if s and s.get('v') == 1:
                return s
        except ValueError:
            pass
    return {'v': 1, 'dead': {}}


def parse(body):
    """m3u → (шапка, [(строки перед адресом, адрес)]). Строки #EXTINF/#EXTVLCOPT/#EXTGRP идут вместе с адресом."""
    lines = body.replace('\r\n', '\n').split('\n')
    head = lines[0] if lines and lines[0].startswith('#EXTM3U') else '#EXTM3U'
    out, hold = [], []
    for ln in lines[1:] if lines and lines[0].startswith('#EXTM3U') else lines:
        s = ln.strip()
        if not s:
            continue
        if s.startswith('#'):
            hold.append(ln)
        else:
            out.append((hold, s))
            hold = []
    return head, out


def tvg_id(info):
    m = re.search(r'tvg-id="([^"]*)"', ' '.join(info))
    return m.group(1) if m else ''


def check(url):
    """'ok' | 'dead:<почему>' | 'unknown:<почему>'. Только http(s); остальное (rtmp…) не трогаем."""
    if not re.match(r'^https?://', url, re.I):
        return 'unknown:scheme'
    u = url.split('|')[0]                                    # хвост «|User-Agent=…» — для плеера, не для адреса
    try:
        req = urllib.request.Request(u, headers=UA)
        with urllib.request.urlopen(req, timeout=TIMEOUT, context=ssl._create_unverified_context()) as r:
            head = r.read(2048)
            ctype = (r.headers.get('Content-Type') or '').lower()
        if b'#EXTM3U' in head or b'#EXT-X' in head or 'mpegurl' in ctype or 'video' in ctype or 'octet-stream' in ctype or 'mp2t' in ctype:
            return 'ok'
        if 'text/html' in ctype or head.lstrip()[:15].lower().startswith((b'<!doctype', b'<html')):
            return 'unknown:html'
        return 'ok'                                          # неизвестный тип, но сервер отдал данные — не трогаем
    except urllib.error.HTTPError as e:
        return ('dead:%d' if e.code in (404, 410) else 'unknown:%d') % e.code
    except urllib.error.URLError as e:
        r = e.reason
        if isinstance(r, socket.gaierror):
            return 'dead:dns'
        if isinstance(r, ConnectionRefusedError):
            return 'dead:refused'
        if isinstance(r, (socket.timeout, TimeoutError)):
            return 'unknown:timeout'
        return 'unknown:' + type(r).__name__
    except (socket.timeout, TimeoutError):
        return 'unknown:timeout'
    except Exception as e:
        return 'unknown:' + type(e).__name__


def main():
    os.makedirs(OUT, exist_ok=True)
    channels = {r['id']: r for r in csv_rows('channels.csv')}
    closed = {i for i, r in channels.items() if (r.get('closed') or '').strip() or (r.get('replaced_by') or '').strip()}
    logos = {}
    for r in csv_rows('logos.csv'):                          # лучший логотип: у своей ленты, иначе у канала; крупнее и png
        key = (r.get('channel') or '') + ('@' + r['feed'] if r.get('feed') else '')
        score = (1 if (r.get('format') or '').upper() in ('PNG', 'SVG') else 0, int(r.get('width') or 0))
        if r.get('url') and (key not in logos or score > logos[key][0]):
            logos[key] = (score, r['url'])
    print('база iptv-org: каналов', len(channels), 'закрытых', len(closed), 'логотипов', len(logos))

    lists = {}
    for k, u in LISTS.items():
        t = text(u)
        if t and '#EXTM3U' in t and len(t) <= MAX_LIST:
            lists[k] = parse(t)
        else:
            print('пропускаю список', k)
    urls = sorted({url for _, items in lists.values() for _, url in items})
    t0 = time.time()
    with ThreadPoolExecutor(WORKERS) as ex:
        res = dict(zip(urls, ex.map(check, urls)))
    print('проверено потоков', len(urls), 'за', int(time.time() - t0), 'с;',
          'ok', sum(1 for v in res.values() if v == 'ok'), 'мёртвых сегодня', sum(1 for v in res.values() if v.startswith('dead')))

    old = prev_state().get('dead', {})
    dead = {}
    for url, v in res.items():
        if v.startswith('dead'):
            dead[url] = [(old.get(url) or [0])[0] + 1, v[5:]]
    gone = {u for u, (n, _) in dead.items() if n >= STRIKES}

    clean = {}
    for k, (head, items) in lists.items():
        kept, why = [], {'closed': 0, 'dead': 0, 'logo': 0}
        for info, url in items:
            cid = tvg_id(info)
            if cid.split('@')[0] in closed:
                why['closed'] += 1
                continue
            if url in gone:
                why['dead'] += 1
                continue
            ext = [i for i, l in enumerate(info) if l.startswith('#EXTINF')]
            if ext and cid and not re.search(r'tvg-logo="[^"]+"', info[ext[0]]):
                logo = (logos.get(cid) or logos.get(cid.split('@')[0]) or (None, None))[1]
                if logo:
                    l = info[ext[0]]
                    info = list(info)
                    info[ext[0]] = re.sub(r'tvg-logo="[^"]*"', 'tvg-logo="%s"' % logo, l) if 'tvg-logo=' in l \
                        else l.replace('#EXTINF:-1 ', '#EXTINF:-1 tvg-logo="%s" ' % logo, 1)
                    why['logo'] += 1
            kept.append((info, url))
        clean[k] = (head, kept, why, len(items))

    # «На русском» — общий список по умолчанию: добавляем каналы Free-TV (только официальные бесплатные) из стран СНГ и
    # бывшего Союза, где смотрят по-русски; раздел — страна по-русски. Тот же адрес уже есть в списке — не дублируем.
    if 'rus' in clean and 'freetv' in clean:
        head, kept, why, was = clean['rus']
        have = {u for _, u in kept}
        why['freetv'] = 0
        for info, url in clean['freetv'][1]:
            m = re.search(r'group-title="([^"]*)"', ' '.join(info))
            country = FREETV_RU.get(m.group(1)) if m else None
            if not country or url in have:
                continue
            have.add(url)
            kept.append(([re.sub(r'group-title="[^"]*"', 'group-title="%s"' % country, l) for l in info], url))
            why['freetv'] += 1

    report = {}
    for k, (head, kept, why, was) in clean.items():
        # защита: источник или проверка сломались и выкинули больше половины — такой список не публикуем
        if len(kept) < was * 0.5:
            print('список', k, 'похудел подозрительно (%d из %d) — не публикую' % (len(kept), was))
            continue
        # метка времени: iptv.php не берёт список старше 3 дней (сборка сломалась — лучше оригинал)
        out = [head + ' x-sunic-at="%d"' % time.time()]
        for info, url in kept:
            out.extend(info)
            out.append(url)
        with open(os.path.join(OUT, k + '.m3u'), 'w', encoding='utf-8', newline='\n') as f:
            f.write('\n'.join(out) + '\n')
        report[k] = dict(was=was, kept=len(kept), **why)
        print(k, report[k])

    with open(os.path.join(OUT, 'state.json'), 'w', encoding='utf-8') as f:
        json.dump({'v': 1, 'at': int(time.time()), 'dead': dead}, f, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(OUT, 'report.json'), 'w', encoding='utf-8') as f:
        json.dump({'at': int(time.time()), 'checked': len(urls), 'strikes': STRIKES, 'lists': report}, f, ensure_ascii=False, indent=1)
    if not report:
        sys.exit('ни одного списка — ветку не трогаем')


if __name__ == '__main__':
    main()
