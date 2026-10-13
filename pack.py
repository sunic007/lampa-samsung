# Сборка пакета Lampa для Samsung Tizen из src/.
#
#   python pack.py                    собрать текущую версию (из src/config.xml)
#   python pack.py --bump             поднять patch (1.4.5 -> 1.4.6) и собрать
#   python pack.py --bump minor       поднять minor (1.4.5 -> 1.5.0) и собрать
#   python pack.py --debug <IP>       отладочная сборка: журнал уходит на ПК с этим IP (debug/logserver.py)
#   python pack.py --force            пересобрать уже выпущенную версию (перезаписать dist/)
#
# Результат:
#   dist/samsung-<версия>.wgt   — архив выпуска (не перезаписывается без --force)
#   samsung.wgt                 — копия последней сборки, её ставят на ТВ
#   samsung-debug.wgt           — отладочная (с --debug)
#
# Проверки перед упаковкой: автотесты (tests/run.cjs), XML манифеста, файлы из index.html, встроенная копия
# Lampa совпадает с BS_BUNDLED_HASH, в архиве пути через '/', без старых подписей.
import os, re, sys, shutil, zipfile, hashlib, subprocess, xml.dom.minidom
for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding='utf-8')
    except Exception: pass

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'src')
DIST = os.path.join(ROOT, 'dist')
CONFIG = os.path.join(SRC, 'config.xml')


def die(msg):
    print('ОШИБКА:', msg)
    sys.exit(1)


def arg(name, default=None):
    if name not in sys.argv:
        return None
    i = sys.argv.index(name)
    return sys.argv[i + 1] if i + 1 < len(sys.argv) and not sys.argv[i + 1].startswith('--') else default


def read_version():
    cfg = open(CONFIG, encoding='utf-8').read()
    m = re.search(r'<widget[^>]*\sversion="(\d+)\.(\d+)\.(\d+)"', cfg)
    if not m:
        die('в config.xml нет version="X.Y.Z" у <widget>')
    return cfg, [int(x) for x in m.groups()]


def bump(kind):
    cfg, v = read_version()
    if kind == 'minor':
        v = [v[0], v[1] + 1, 0]
    elif kind == 'major':
        v = [v[0] + 1, 0, 0]
    else:
        v = [v[0], v[1], v[2] + 1]
    new = '.'.join(map(str, v))
    cfg = re.sub(r'(<widget[^>]*\sversion=")\d+\.\d+\.\d+(")', r'\g<1>' + new + r'\g<2>', cfg, count=1)
    open(CONFIG, 'w', encoding='utf-8').write(cfg)
    print('Версия поднята до', new, '— допишите CHANGELOG.md')
    return new


def check_sources():
    xml.dom.minidom.parse(CONFIG)
    html = open(os.path.join(SRC, 'index.html'), encoding='utf-8').read()
    refs = [r for r in re.findall(r'(?:src|href)="([^"]+)"', html) if not r.startswith(('http', '$WEBAPIS'))]
    missing = [r for r in refs if not os.path.exists(os.path.join(SRC, r.lstrip('./')))]
    if missing:
        die('index.html ссылается на отсутствующие файлы: %s' % missing)
    # Плитка приложения на главном экране ТВ 2016+ (фон и логотип 1920x1080): без них ТВ 2022 после запуска Lampa
    # ставит серую заглушку вместо значка (1.6.9 удалил их как «картинки для магазина» — ошибка, вернули в 1.7.6).
    need = ['icon.png', 'logo_appname_bg.png', 'logo_appname_fg.png', 'service/service.js']
    lost = [f for f in need if not os.path.exists(os.path.join(SRC, f))]
    if lost:
        die('нет обязательных файлов пакета: %s' % lost)
    # update.js: модули по порядку — все должны быть в src/ (их же скачивают ТВ с GitHub)
    mods = update_modules()
    gone = [f for f in mods if not os.path.exists(os.path.join(SRC, f))]
    if not mods or gone:
        die('update.js: нет модулей %s' % (gone or 'LOCAL'))
    loader =open(os.path.join(SRC, 'loader.js'), encoding='utf-8').read()
    m = re.search(r"var BS_BUNDLED_HASH = '([0-9a-f]+)'", loader)
    app = open(os.path.join(SRC, 'app.js'), encoding='utf-8', errors='ignore').read()
    if not m or m.group(1) not in app:
        die('встроенная копия app.js не совпадает с BS_BUNDLED_HASH в loader.js — запустите update_bundled.py')
    tests = os.path.join(ROOT, 'tests', 'run.cjs')
    if os.path.exists(tests):
        try:
            r = subprocess.run(['node', tests], capture_output=True, text=True, encoding='utf-8', errors='replace')
            print('Автотесты:', (r.stdout.strip().splitlines() or ['?'])[-1])
            if r.returncode != 0:
                print(r.stdout)
                die('автотесты не прошли — сборка остановлена')
        except FileNotFoundError:
            print('ВНИМАНИЕ: Node.js не найден — автотесты пропущены')
    for sig in ('author-signature.xml', 'signature1.xml'):
        if os.path.exists(os.path.join(SRC, sig)):
            die('в src/ лежит старая подпись %s — удалите (установщик подпишет заново)' % sig)


def update_modules():
    js = open(os.path.join(SRC, 'update.js'), encoding='utf-8').read()
    m = re.search(r'var LOCAL = \[([^\]]*)\]', js)
    return re.findall(r"'([^']+)'", m.group(1)) if m else []


def write_manifest(version):
    """version.json в корне репозитория: ТВ сверяют с ним свою версию (update.js), модули берут с jsDelivr по тегу v<версия>."""
    import json
    with open(os.path.join(ROOT, 'version.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump({'version': version, 'files': update_modules()}, f, ensure_ascii=False, indent=1)
        f.write('\n')


def build(out, version, debug_host=None):
    tmp = out + '.tmp'
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(SRC):
            for f in sorted(files):
                full = os.path.join(root, f)
                name = os.path.relpath(full, SRC).replace(os.sep, '/')
                if name == 'loader.js':
                    js = open(full, encoding='utf-8').read()
                    js = js.replace("var BS_PACKAGE_VERSION = 'dev';", "var BS_PACKAGE_VERSION = '%s%s';" % (version, '-debug' if debug_host else ''), 1)
                    z.writestr(name, js)
                elif debug_host and name == 'index.html':
                    html = open(full, encoding='utf-8').read()
                    z.writestr(name, html.replace('<head>', '<head>\n    <script src="debug.js"></script>', 1))
                else:
                    z.write(full, name)
        if debug_host:
            js = open(os.path.join(ROOT, 'debug', 'debug.js'), encoding='utf-8').read().replace('__BS_LOG_HOST__', debug_host)
            z.writestr('debug.js', js)
    names = zipfile.ZipFile(tmp).namelist()
    if any('\\' in n for n in names):
        os.remove(tmp)
        die('в архиве пути с обратным слэшем')
    os.replace(tmp, out)
    return len(names)


def digest(path):
    h = hashlib.md5()
    with zipfile.ZipFile(path) as z:
        for n in sorted(z.namelist()):
            h.update(n.encode()); h.update(z.read(n))
    return h.hexdigest()


if __name__ == '__main__':
    os.chdir(ROOT)
    debug_host = arg('--debug')
    if '--debug' in sys.argv and not debug_host:
        die('укажите IP компьютера: python pack.py --debug 192.168.1.10')
    # сначала проверки, потом версия: иначе упавшие тесты «съедают» номер (1.6.6 поднята, но не выпущена)
    check_sources()
    if '--bump' in sys.argv:
        bump(arg('--bump', 'patch'))
    _, v = read_version()
    version = '.'.join(map(str, v))

    if debug_host:
        n = build(os.path.join(ROOT, 'samsung-debug.wgt'), version, debug_host)
        print('samsung-debug.wgt', version, n, 'файлов, журнал ->', debug_host)
        sys.exit(0)

    os.makedirs(DIST, exist_ok=True)
    release = os.path.join(DIST, 'samsung-%s.wgt' % version)
    fresh = os.path.join(DIST, '.candidate.wgt')
    n = build(fresh, version)
    if os.path.exists(release) and '--force' not in sys.argv:
        if digest(release) != digest(fresh):
            os.remove(fresh)
            die('версия %s уже выпущена с другим содержимым. Поднимите версию: python pack.py --bump' % version)
        os.remove(fresh)
        print('Версия', version, 'уже собрана, изменений нет')
    else:
        os.replace(fresh, release)
        print('Выпуск', os.path.relpath(release, ROOT), n, 'файлов', round(os.path.getsize(release) / 1e6, 2), 'МБ')
    shutil.copyfile(release, os.path.join(ROOT, 'samsung.wgt'))
    write_manifest(version)
    print('samsung.wgt = версия', version, '· version.json для GitHub')
