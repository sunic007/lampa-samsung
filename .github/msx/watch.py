"""Сторож sunic.stream (Media Station X): на сайте — только наши файлы, без чужих скриптов.
Сравнивает start.json и главную с копией в репозитории (.github/msx/site), а страницу Lampa (/lampa/) проверяет по
правилам: <base> на наш jsDelivr, внешние скрипты — только из списка, встроенные скрипты — только наши.
Что-то не так — выход с ошибкой: GitHub Actions пришлёт письмо владельцу. Запуск: python .github/msx/watch.py"""
import json
import os
import re
import sys
import urllib.request

SITE = 'http://sunic.stream'
HERE = os.path.dirname(os.path.abspath(__file__))
# внешние скрипты страницы Lampa: всё остальное — относительные пути от <base> (наш jsDelivr)
ALLOWED_SRC = {'http://lampa.byskaz.ru/lampainit.js', 'polyfills.js', 'update.js'}
ALLOWED_SRC_PREFIX = ('./vender/',)
# встроенные скрипты: наш из index.php (плеер, «Script error», история, обновление) и защита Smart Hub из index.html
INLINE_MARKS = ['bs_player_default', 'launchAppControl']


def get(path):
    req = urllib.request.Request(SITE + path, headers={'User-Agent': 'sunic-watch', 'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode('utf-8', 'replace')


def main():
    bad = []
    want = json.load(open(os.path.join(HERE, 'site', 'msx', 'start.json'), encoding='utf-8'))
    try:
        if json.loads(get('/msx/start.json')) != want:
            bad.append('msx/start.json отличается от репозитория')
    except Exception as e:
        bad.append('msx/start.json: %s' % e)
    try:
        if get('/').strip() != open(os.path.join(HERE, 'site', 'index.html'), encoding='utf-8').read().strip():
            bad.append('главная (index.html) отличается от репозитория')
    except Exception as e:
        bad.append('главная: %s' % e)
    try:
        page = get('/lampa/')
        base = re.search(r'<base href="([^"]+)"', page)
        local = base and re.fullmatch(r'/lampa/v/(\d+\.\d+\.\d+)/', base.group(1))
        if not base or not (local or re.fullmatch(r'https://cdn\.jsdelivr\.net/gh/sunic007/lampa-samsung@v\d+\.\d+\.\d+/src/', base.group(1))):
            bad.append('/lampa/: <base> не на свою копию и не на наш jsDelivr: %s' % (base.group(1) if base else 'нет'))
        if local:
            # своя копия выпуска на хостинге — байт в байт как выпуск на GitHub (подмену файла видно сразу)
            ver = local.group(1)
            for f in ['index.html', 'update.js', 'loader.js', 'bsfix.js', 'bssources.js', 'bstg.js', 'app.js', 'bs.css']:
                try:
                    mine = get(base.group(1) + f)
                    with urllib.request.urlopen('https://raw.githubusercontent.com/sunic007/lampa-samsung/v%s/src/%s' % (ver, f), timeout=60) as r:
                        orig = r.read().decode('utf-8', 'replace')
                    if mine != orig:
                        bad.append('/lampa/v/%s/%s отличается от выпуска на GitHub' % (ver, f))
                except Exception as e:
                    bad.append('/lampa/v/%s/%s: %s' % (ver, f, e))
        for src in re.findall(r'<script[^>]*\ssrc="([^"]+)"', page):
            if src not in ALLOWED_SRC and not src.startswith(ALLOWED_SRC_PREFIX):
                bad.append('/lampa/: чужой скрипт %s' % src)
        for body in re.findall(r'<script(?![^>]*\ssrc=)[^>]*>(.*?)</script>', page, re.S):
            if body.strip() and not any(m in body for m in INLINE_MARKS):
                bad.append('/lampa/: чужой встроенный скрипт: %s' % body.strip()[:120])
        if re.search(r'<(iframe|object|embed)\b', page, re.I):
            bad.append('/lampa/: iframe/object/embed на странице')
    except Exception as e:
        bad.append('/lampa/: %s' % e)
    if bad:
        print('ТРЕВОГА sunic.stream:\n- ' + '\n- '.join(bad))
        sys.exit(1)
    print('sunic.stream: всё как в репозитории')


if __name__ == '__main__':
    main()
