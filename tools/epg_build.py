#!/usr/bin/env python3
"""Программа передач для «Телеканалов» (src/bstv.js): открытые XMLTV → маленькие JSON по каналу.

Телевизор не может скачать и разобрать XMLTV на 100+ МБ, поэтому раз в день (workflow epg.yml) готовим:
  index.json      {"v":1, "at":<unix>, "ids":{tvg-id: key}, "names":{имя: key}} — как найти канал любого плейлиста
  c/<key>.json    {"n": имя, "p": [[начало, конец, название, описание], …]} — время в минутах unix, окно −2…+2 дня
Ветка `epg` (без истории, перезаписывается): raw.githubusercontent, jsDelivr и sunic.stream/gh/ отдают её файлы.

Источники по порядку (первый, где у канала есть передачи, — главный):
  iptvx  — https://iptvx.one/epg/epg_noarch.xml.gz; tvg-id iptv-org берём из их же таблицы соответствий
           (iptv-org/epg sites/epg.iptvx.one/epg.iptvx.one.channels.xml);
  epg.pw — https://epg.pw/xmltv/epg_RU.xml.gz (FREE EPG); только по имени.
Источник не ответил — пропускаем, остальные работают. Только стандартная библиотека.

Имя канала сравниваем через norm(): та же функция есть в bstv.js (tvNorm) — менять обе вместе.
"""
import calendar
import gzip
import io
import json
import os
import re
import shutil
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET

OUT = sys.argv[1] if len(sys.argv) > 1 else 'epg-out'
UA = {'User-Agent': 'SunicApps-EPG/1.0 (+https://sunic.stream)'}
MAP_BASE = 'https://raw.githubusercontent.com/iptv-org/epg/master/sites/'
SOURCES = [
    {'key': 'x', 'name': 'iptvx', 'url': 'https://iptvx.one/epg/epg_noarch.xml.gz', 'map': 'epg.iptvx.one/epg.iptvx.one.channels.xml'},
    {'key': 'p', 'name': 'epg.pw', 'url': 'https://epg.pw/xmltv/epg_RU.xml.gz', 'map': None},
]
# окно: позавчера … послезавтра (архив и «что будет»); описание — только у ближайших передач, иначе ветка весит сотни МБ
BACK, AHEAD = 2 * 86400, 2 * 86400
DESC_FROM, DESC_TO = 3 * 3600, 30 * 3600
DESC_MAX = 220

TR = dict(zip('абвгдеёжзийклмнопрстуфхцчшщъыьэюяўқғҳі',
              ['a', 'b', 'v', 'g', 'd', 'e', 'e', 'zh', 'z', 'i', 'y', 'k', 'l', 'm', 'n', 'o', 'p', 'r', 's', 't', 'u', 'f', 'h', 'ts',
               'ch', 'sh', 'sch', '', 'y', '', 'e', 'yu', 'ya', 'o', 'q', 'g', 'h', 'i']))
DROP = re.compile(r'\b(hd|fhd|uhd|sd|4k|8k|orig|original|hevc|h265|tv|тв|телеканал|канал)\b')


def norm(s, drop=True):
    """Имя для сравнения: без (1080p)/[…], без HD/TV, кириллица латиницей, только буквы и цифры."""
    raw = s
    s = (s or '').lower()
    # «+4», «(-1)» — другой часовой пояс, то есть другой канал: сдвиг оставляем словом, скобки вокруг него снимаем
    s = re.sub(r'[(\[]\s*([+-]\s*\d+)\s*[)\]]', r' \1 ', s)
    s = re.sub(r'\+\s*(\d)', r' plus\1', s)
    s = re.sub(r'(^|\s)-\s*(\d)', r'\1 minus\2', s)
    s = re.sub(r'\(.*?\)|\[.*?\]', ' ', s)
    if drop:
        s = DROP.sub(' ', s)
    s = ''.join(TR.get(c, c) for c in s)
    s = re.sub(r'[^a-z0-9]', '', s)
    for a, b in (('iy', 'y'), ('yy', 'y'), ('ii', 'y'), ('yi', 'y'), ('ij', 'y'), ('j', 'y'), ('kh', 'h'), ('x', 'h')):
        s = s.replace(a, b)
    if drop and (not s or s.isdigit()):
        return norm(raw, False)              # «ТВ-3» — без «ТВ» осталась бы одна цифра
    return s


def get(url, timeout=120):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def tvg(i):
    """tvg-id без фида: «Aqlvoy.uz@SD» → «aqlvoy.uz»."""
    return (i or '').split('@')[0].strip().lower()


def unix(t):
    # 20261022080000 +0300
    m = re.match(r'(\d{14})\s*([+-]\d{4})?', t or '')
    if not m:
        return None
    sec = calendar.timegm(time.strptime(m.group(1), '%Y%m%d%H%M%S'))
    z = m.group(2)
    if z:
        off = (int(z[1:3]) * 60 + int(z[3:5])) * 60
        sec -= off if z[0] == '+' else -off
    return sec


def load_map(path):
    """iptv-org/epg channels.xml: site_id → xmltv_id."""
    out = {}
    try:
        root = ET.fromstring(get(MAP_BASE + path, 60))
    except Exception as e:
        print('map', path, 'failed:', e)
        return out
    for ch in root.iter('channel'):
        sid, xid = ch.get('site_id'), ch.get('xmltv_id')
        if sid and xid:
            out[sid] = tvg(xid)
    return out


def read_source(src, now):
    """→ {id: {'names': [...], 'p': [...]}} в окне now−BACK … now+AHEAD."""
    try:
        raw = get(src['url'], 600)
    except Exception as e:
        print(src['name'], 'not reachable:', e)
        return {}
    data = gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw
    print(src['name'], 'xml', len(data) // 1024, 'KB')
    chans = {}
    lo, hi = now - BACK, now + AHEAD
    for ev, el in ET.iterparse(io.BytesIO(data), events=('end',)):
        if el.tag == 'channel':
            cid = el.get('id')
            names = [d.text for d in el.findall('display-name') if d.text]
            chans.setdefault(cid, {'names': [], 'p': []})['names'] = names
            el.clear()
        elif el.tag == 'programme':
            a, b = unix(el.get('start')), unix(el.get('stop'))
            if a is not None and b is not None and b > lo and a < hi:
                t = el.findtext('title') or ''
                d = (el.findtext('desc') or '').strip() if b > now - DESC_FROM and a < now + DESC_TO else ''
                if len(d) > DESC_MAX:
                    d = d[:DESC_MAX].rsplit(' ', 1)[0] + '…'
                chans.setdefault(el.get('channel'), {'names': [], 'p': []})['p'].append([a // 60, b // 60, t.strip(), d])
            el.clear()
    return chans


def main():
    now = int(time.time())
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(os.path.join(OUT, 'c'))
    ids, names, files, total = {}, {}, 0, 0
    for src in SOURCES:
        chans = read_source(src, now)
        mp = load_map(src['map']) if src['map'] and chans else {}
        used = 0
        for cid, ch in chans.items():
            if not ch['p'] or not ch['names']:
                continue
            ch['p'].sort(key=lambda r: r[0])
            key = src['key'] + re.sub(r'[^A-Za-z0-9_-]', '_', cid)[:60]
            tid = mp.get(cid)
            fresh_id = bool(tid) and tid not in ids
            fresh_names = [n for n in {norm(x) for x in ch['names']} if n and n not in names]
            if not fresh_id and not fresh_names:
                continue                     # канал уже есть из прошлого источника
            if fresh_id:
                ids[tid] = key
            for n in fresh_names:
                names[n] = key
            body = json.dumps({'n': ch['names'][0], 'p': ch['p']}, ensure_ascii=False, separators=(',', ':'))
            with open(os.path.join(OUT, 'c', key + '.json'), 'w', encoding='utf-8', newline='') as f:
                f.write(body)
            files += 1
            used += 1
            total += len(body.encode('utf-8'))
        print(src['name'], 'channels', len(chans), 'used', used)
    with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8', newline='') as f:
        f.write(json.dumps({'v': 1, 'at': now, 'ids': ids, 'names': names}, ensure_ascii=False, separators=(',', ':')))
    print('files', files, 'total', total // 1024, 'KB', 'ids', len(ids), 'names', len(names))
    if not files:
        sys.exit('no EPG at all')


if __name__ == '__main__':
    main()
