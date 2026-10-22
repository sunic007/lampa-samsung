"""Сторож sunic.stream (Media Station X): на сайте — только наши файлы, без чужих скриптов.
Сравнивает start.json и главную с копией в репозитории (.github/msx/site), а страницу Lampa (/lampa/) проверяет по
правилам: <base> на наш jsDelivr, внешние скрипты — только из списка, встроенные скрипты — только наши.
Что-то не так — выход с ошибкой: GitHub Actions пришлёт письмо владельцу. Запуск: python .github/msx/watch.py"""
import json
import os
import re
import sys
import time
import urllib.request

SITE = 'http://sunic.stream'
HERE = os.path.dirname(os.path.abspath(__file__))
# внешние скрипты страницы Lampa: всё остальное — относительные пути от <base> (наш jsDelivr)
ALLOWED_SRC = {'http://lampa.byskaz.ru/lampainit.js', 'polyfills.js', 'update.js'}
ALLOWED_SRC_PREFIX = ('./vender/',)
# встроенные скрипты: наш из index.php (плеер, «Script error», история, обновление) и защита Smart Hub из index.html
INLINE_MARKS = ['bs_player_default', 'launchAppControl', 'BS_INIT_AT']   # BS_INIT_AT — загрузчик lampainit.js (2.3.36), адрес проверяем ниже


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
    for path, name in (('/', 'index.html'), ('/site.js', 'site.js'), ('/site.css', 'site.css'), ('/nojs.css', 'nojs.css'), ('/lampa/manifest.json', 'lampa/manifest.json'), ('/.well-known/security.txt', '.well-known/security.txt')):
        try:
            if get(path).strip() != open(os.path.join(HERE, 'site', name), encoding='utf-8').read().strip():
                bad.append('%s отличается от репозитория' % name)
        except Exception as e:
            bad.append('%s: %s' % (name, e))
    try:
        # сертификат https: меньше 14 дней — хостинг его не продлил; security.txt — поле Expires (RFC 9116) не просрочено
        import socket, ssl, datetime
        with socket.create_connection(('sunic.stream', 443), timeout=30) as raw:
            with ssl.create_default_context().wrap_socket(raw, server_hostname='sunic.stream') as tls:
                left = ssl.cert_time_to_seconds(tls.getpeercert()['notAfter']) - time.time()
        if left < 14 * 86400:
            bad.append('сертификат https кончается через %d дн.' % (left // 86400))
        exp = re.search(r'^Expires: (\d{4}-\d\d-\d\d)', open(os.path.join(HERE, 'site', '.well-known', 'security.txt'), encoding='utf-8').read(), re.M)
        if not exp or datetime.date.fromisoformat(exp.group(1)) - datetime.date.today() < datetime.timedelta(days=30):
            bad.append('security.txt: обновите Expires (меньше 30 дней)')
    except Exception as e:
        bad.append('сертификат: %s' % e)
    try:
        # Android-плагин по короткому адресу — копия с GitHub Pages (plugin.php обновляет её раз в 10 минут)
        for attempt in (1, 2):
            mine = get('/sunic.js')
            with urllib.request.urlopen('https://sunic007.github.io/lampa-android/sunic.js', timeout=60) as r:
                orig = r.read().decode('utf-8', 'replace')
            if mine == orig:
                break
            if attempt == 1:
                time.sleep(660)          # только что вышла новая версия — копия обновится в течение 10 минут
        else:
            bad.append('/sunic.js отличается от плагина на GitHub')
    except Exception as e:
        bad.append('/sunic.js: %s' % e)
    try:
        # запасное зеркало обновлений sunic.stream/gh/ (gh.php): этот код ТВ выполняют — байт в байт как выпуск на GitHub
        for repo, files in (('lampa-samsung', ['src/update.js', 'src/loader.js', 'src/bsfix.js']), ('lampa-android', ['src/android.js'])):
            with urllib.request.urlopen('https://raw.githubusercontent.com/sunic007/%s/main/version.json' % repo, timeout=60) as r:
                ver = json.loads(r.read().decode('utf-8'))['version']
            for f in files:
                mine = get('/gh/sunic007/%s@v%s/%s' % (repo, ver, f))
                with urllib.request.urlopen('https://raw.githubusercontent.com/sunic007/%s/v%s/%s' % (repo, ver, f), timeout=60) as r:
                    if mine != r.read().decode('utf-8', 'replace'):
                        bad.append('/gh/ %s@v%s/%s отличается от выпуска на GitHub' % (repo, ver, f))
    except Exception as e:
        bad.append('/gh/: %s' % e)
    try:
        page = get('/lampa/')
        base = re.search(r'<base href="([^"]+)"', page)
        local = base and re.fullmatch(r'/lampa/v/(\d+\.\d+\.\d+)/', base.group(1))
        # файлы — с jsDelivr, своя копия — запасная (window.BS_SITE_OWN): сверяем и её
        own = re.search(r', o = "(\\/lampa\\/v\\/[0-9.]+\\/)"', page)
        own_path = own.group(1).replace('\\/', '/') if own else (base.group(1) if local else '')
        local = re.fullmatch(r'/lampa/v/(\d+\.\d+\.\d+)/', own_path)
        if not base or not ((local and base.group(1) == own_path) or re.fullmatch(r'https://cdn\.jsdelivr\.net/gh/sunic007/lampa-samsung@v\d+\.\d+\.\d+/src/', base.group(1))):
            bad.append('/lampa/: <base> не на свою копию и не на наш jsDelivr: %s' % (base.group(1) if base else 'нет'))
        if local:
            # своя копия выпуска на хостинге — байт в байт как выпуск на GitHub (подмену файла видно сразу)
            ver = local.group(1)
            for f in ['index.html', 'update.js', 'loader.js', 'bsfix.js', 'bssources.js', 'bstg.js', 'app.js', 'bs.css']:
                try:
                    mine = get(own_path + f)
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
            # встроенный загрузчик lampainit.js может звать только его, никакого другого адреса
            elif 'BS_INIT_AT' in body and set(re.findall(r"https?://[^'\"\s]+", body)) - {'http://lampa.byskaz.ru/lampainit.js'}:
                bad.append('/lampa/: загрузчик lampainit.js зовёт чужой адрес')
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
