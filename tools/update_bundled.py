# Обновляет встроенную (запасную) копию Lampa в src/ с сервера byskaz:
# app.js, css/, vender/, img/, sound/ — и вписывает её версию и hash в src/loader.js.
#
#   python tools/update_bundled.py
#
# Список файлов берётся из репозитория github.com/yumata/lampa, сами файлы — с сервера byskaz
# (там та же Lampa с патчем byskaz). После обновления: python tools/pack.py --bump
import os, re, json, urllib.request, concurrent.futures as cf, sys
for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding='utf-8')
    except Exception: pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # скрипт лежит в tools/
SRC = os.path.join(ROOT, 'src')
MIRROR = 'http://lampa.byskaz.ru/lampa-main/'
TREE = 'https://api.github.com/repos/yumata/lampa/git/trees/main?recursive=1'
VERIFY = 'https://sunic.stream/lampa/verify.php?h='   # независимая сверка app.js (отчёт ревью 2026-10-21, S1)
UA = {'User-Agent': 'Mozilla/5.0'}


def get(url, timeout=60):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


def main():
    assembly = json.loads(get(MIRROR + 'assembly.json?t=1'))
    version, h = assembly['app_version'], assembly['hash']
    print('На сервере Lampa', version, h)

    tree = json.loads(get(TREE))
    if tree.get('truncated'):
        raise SystemExit('ОШИБКА: GitHub отдал неполный список файлов (truncated) — повторите позже')
    want = [x['path'] for x in tree['tree'] if x['type'] == 'blob' and x['path'].split('/')[0] in ('img', 'vender', 'sound', 'css')]
    jobs = [(p, p) for p in want] + [('app.min.js', 'app.js')]

    def fetch(job):
        src, dst = job
        try:
            return dst, get(MIRROR + src + '?t=' + h)
        except Exception as e:
            return dst, None

    # Сначала всё в память и проверка, потом запись: при обрыве сети встроенная копия не останется
    # перемешанной (новый app.js со старыми css/vender), а src/ — испорченным.
    got, fails = {}, []
    with cf.ThreadPoolExecutor(8) as ex:
        for dst, data in ex.map(fetch, jobs):
            if data: got[dst] = data
            else: fails.append(dst)
    if fails and '--allow-missing' not in sys.argv:
        raise SystemExit('ОШИБКА: не скачались %d файлов (%s) — ничего не записано. Повторите или --allow-missing'
                         % (len(fails), ', '.join(fails[:5])))
    app = got.get('app.js', b'').decode('utf-8', 'ignore')
    if h not in app:
        raise SystemExit('ОШИБКА: скачанный app.js не содержит hash %s — сервер отдал другую сборку, повторите позже' % h)
    # byskaz отдаёт Lampa только по http: hash из того же ответа подмену не выдаст. Сверяем с копией, которую скачал
    # наш хостинг другой сетью (site/lampa/verify.php). Не совпало или сверка недоступна — ничего не пишем.
    import hashlib
    mine = hashlib.sha256(got['app.js']).hexdigest()
    try:
        v = json.loads(get(VERIFY + h, timeout=90))
    except Exception as e:
        raise SystemExit('ОШИБКА: сверка app.js через sunic.stream недоступна (%s) — ничего не записано, повторите позже' % e)
    if not v.get('ok') or v.get('sha256') != mine:
        raise SystemExit('ОШИБКА: app.js отличается от скачанного хостингом (%s ≠ %s) — возможна подмена по дороге, ничего не записано'
                         % (mine[:12], str(v.get('sha256'))[:12]))
    print('app.js сверен с хостингом:', mine[:16])
    for dst, data in got.items():
        path = os.path.join(SRC, dst)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, 'wb').write(data)
    if fails:
        print('Не скачались (оставлены прежние):', fails)

    loader_path = os.path.join(SRC, 'loader.js')
    loader = open(loader_path, encoding='utf-8').read()
    loader = re.sub(r"var BS_BUNDLED_VERSION = '[^']*';", "var BS_BUNDLED_VERSION = '%s';" % version, loader, count=1)
    loader = re.sub(r"var BS_BUNDLED_HASH = '[^']*';", "var BS_BUNDLED_HASH = '%s';" % h, loader, count=1)
    open(loader_path, 'w', encoding='utf-8', newline='').write(loader)
    print('Обновлено файлов:', len(jobs) - len(fails), '— встроенная копия теперь', version)
    print('Дальше: допишите .github/CHANGELOG.md и выполните python tools/pack.py --bump')


if __name__ == '__main__':
    main()
