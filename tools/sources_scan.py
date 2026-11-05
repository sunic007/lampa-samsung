#!/usr/bin/env python3
"""Онлайн-источники Lampa: проверка своих и поиск новых на GitHub. Запуск: python tools/sources_scan.py out [--issue]

1. Свои источники (LIST в src/bssources.js, с запасными адресами alt): отвечает ли адрес, похож ли ответ на скрипт,
   время ответа. Источник «мёртв», если не ответил ни один его адрес.
2. Поиск на GitHub (code search; нужен GITHUB_TOKEN — в Actions он есть): файлы плагинов Lampa, которые добавляют
   онлайн-просмотр (Lampa.Component.add + балансеры). Код плагинов НЕ выполняется — только читается как текст:
   размер, запутан ли, нужен ли вход/подписка, реклама, какие серверы он зовёт и отвечают ли они, копия ли известного.
3. Отчёт: out/report.json, out/report.md (по-русски), out/state.json (когда кандидат замечен впервые, сколько раз
   подряд наш источник не отвечал). С --issue — одна открытая задача с меткой `sources` в репозитории: создаётся или
   обновляется, когда свой источник умер или нашлись новые сильные кандидаты.

В Lampa ничего не добавляется само: чужой код на телевизоры людей — только после проверки и «да» владельца.
Только стандартная библиотека Python 3.
"""
import concurrent.futures as cf
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.environ.get('GITHUB_REPOSITORY', 'sunic007/lampa-samsung')
TOKEN = os.environ.get('GITHUB_TOKEN', '')
UA = 'SunicApps-sources-scan/1.0 (+https://sunic.stream)'
STATE_URL = 'https://raw.githubusercontent.com/%s/sources/state.json' % REPO

# Поиск: признаки онлайн-плагина Lampa. Code search GitHub — до 10 запросов в минуту, поэтому пауза между ними.
QUERIES = [
    '"Lampa.Component.add" balanser language:JavaScript',
    '"view--online" "Lampa.Component" language:JavaScript',
    '"Lampa.Component.add" "Lampa.Player.play" online language:JavaScript',
    'lampa online balanser filename:online.js',
]
MAX_AGE_DAYS = 240          # не обновлялся дольше — не предлагаем
FRESH_DAYS = 120
NOISE_HOSTS = re.compile(r'(^|\.)(github\.com|githubusercontent\.com|github\.io|jsdelivr\.net|w3\.org|themoviedb\.org|tmdb\.org|'
                         r'imagetmdb\.com|google\.com|googleapis\.com|gstatic\.com|youtube\.com|ytimg\.com|t\.me|telegram\.org|'
                         r'cub\.red|cub\.best|cub\.watch|cubnotrip\.top|qrserver\.com|example\.com|localhost|schema\.org|'
                         r'mozilla\.org|apple\.com|yandex\.ru|vk\.com|wikipedia\.org)$')
UA_WORDS = re.compile(r'uakino|bandera|eneyida|uaflix|ukr|українськ|дивитис', re.I)
# только онлайн-видео: плагин запускает плеер и знает балансеры (иначе это трейлеры, оформление, каталоги)
ONLINE_WORDS = re.compile(r'balans|balanc|videos__item|filmix|rezka|kodik|collaps|videocdn|lumex|hdvb|alloha|zetflix|kinobase|cdnmovies|lampac', re.I)
# 18+ не предлагаем совсем
ADULT_WORDS = re.compile(r'jable|javhd|njav|123av|porn|xvideos|xhamster|pornhub|\bsisi\b|клубничк|onlyfans|18\+', re.I)


def get(url, timeout=15, head=False, data=None, method=None, auth=False):
    """(status, body bytes, seconds). Сеть не ответила — (0, b'', seconds)."""
    h = {'User-Agent': UA, 'Accept-Encoding': 'identity'}
    if auth and TOKEN:
        h['Authorization'] = 'Bearer ' + TOKEN
        h['Accept'] = 'application/vnd.github+json'
    if data is not None:
        h['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=data, headers=h, method=method or ('HEAD' if head else 'GET'))
    t = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, (b'' if head else r.read(3 * 1024 * 1024)), time.time() - t
    except urllib.error.HTTPError as e:
        try:
            body = e.read(200000)
        except Exception:
            body = b''
        return e.code, body, time.time() - t
    except Exception:
        return 0, b'', time.time() - t


def gh(path, params=None):
    q = ('?' + urllib.parse.urlencode(params)) if params else ''
    st, body, _ = get('https://api.github.com' + path + q, timeout=30, auth=True)
    try:
        return st, json.loads(body.decode('utf-8') or 'null')
    except Exception:
        return st, None


# ---------- свои источники ----------

def our_sources():
    """[{id, name, urls}] из LIST в src/bssources.js."""
    text = open(os.path.join(ROOT, 'src', 'bssources.js'), encoding='utf-8').read()
    body = text[text.index('var LIST = ['):text.index('];', text.index('var LIST = ['))]
    out = []
    for m in re.finditer(r"\{ id: '([\w-]+)'[^{}]*?name: (['\"])(.*?)\2, url: '([^']+)'(.*?)(?=\n\s*\{ id: |\Z)", body, re.S):
        sid, name, url, rest = m.group(1), m.group(3), m.group(4), m.group(5)
        https = re.search(r'https: true', rest) is not None
        alt = re.findall(r"'(https?://[^']+)'", (re.search(r'alt: \[([^\]]*)\]', rest) or re.match('', '')).group(1) or '') \
            if re.search(r'alt: \[', rest) else []
        urls = ([url.replace('http://', 'https://', 1)] if https else []) + [url] + alt
        out.append({'id': sid, 'name': name, 'urls': list(dict.fromkeys(urls))})
    return out


def looks_js(body):
    head = body[:4000].decode('utf-8', 'ignore').lstrip('﻿ \r\n\t')
    return bool(head) and not head.lower().startswith(('<!doctype', '<html')) and re.search(r'function|=>|var |Lampa', head) is not None


def check_url(url):
    st, body, sec = get(url, timeout=20)
    ok = st == 200 and len(body) > 100 and looks_js(body)
    return {'url': url, 'status': st, 'bytes': len(body), 'sec': round(sec, 2), 'ok': ok}


# ---------- поиск на GitHub ----------

def search_candidates():
    if not TOKEN:
        print('нет GITHUB_TOKEN — поиск на GitHub пропущен', file=sys.stderr)
        return []
    found = {}
    for i, q in enumerate(QUERIES):
        if i:
            time.sleep(8)
        for page in (1, 2):
            st, j = gh('/search/code', {'q': q, 'per_page': 50, 'page': page})
            if st != 200 or not j:
                print('поиск: %s → %s' % (q, st), file=sys.stderr)
                break
            for it in j.get('items', []):
                repo = it['repository']['full_name']
                if repo.lower() == REPO.lower():
                    continue
                found.setdefault(repo + '/' + it['path'], {'repo': repo, 'path': it['path']})
            if len(j.get('items', [])) < 50:
                break
            time.sleep(8)
    return list(found.values())


def repo_info(repo, cache={}):
    if repo not in cache:
        st, j = gh('/repos/' + repo)
        cache[repo] = j if st == 200 and j else None
    return cache[repo]


def install_url(repo, branch, path):
    owner, name = repo.split('/', 1)
    if name.lower() == owner.lower() + '.github.io':
        return 'https://%s.github.io/%s' % (owner.lower(), path)
    return 'https://cdn.jsdelivr.net/gh/%s@%s/%s' % (repo, branch, path)


def analyse(text):
    t = text
    hosts = set()
    for h in re.findall(r'https?://([a-z0-9.-]+\.[a-z]{2,})', t, re.I):
        h = h.lower().strip('.')
        if not NOISE_HOSTS.search(h) and not re.match(r'^\d+\.\d+\.\d+\.\d+$', h):
            hosts.add(h)
    comps = sorted(set(re.findall(r"Component\.add\(\s*['\"]([\w-]+)['\"]", t)))
    obf = len(re.findall(r'_0x[0-9a-f]{4,}', t)) > 40
    flags = []
    if re.search(r'авториз|войдите|login|access_token|premium|vip|подписк', t, re.I):
        flags.append('вход/подписка')
    if re.search(r'@\w+bot\b|t\.me/\w+bot', t, re.I):
        flags.append('бот Telegram')
    if re.search(r'\bvast\b|preroll|реклам', t, re.I):
        flags.append('реклама')
    if obf:
        flags.append('запутан')
    if re.search(r'kinopub|kino\.pub', t, re.I):
        flags.append('KinoPub (платно)')
    if re.search(r'filmix', t, re.I) and re.search(r'token', t, re.I):
        flags.append('свой аккаунт Filmix')
    if UA_WORDS.search(t):
        flags.append('украинские источники')
    if 'online_mod' in comps or 'nb557' in t:
        flags.append('копия Online Mod')
    if 'lampac' in t.lower() and not comps:
        flags.append('загрузчик Lampac')
    norm = re.sub(r'\s+', '', t)
    return {'hosts': sorted(hosts)[:40], 'components': comps[:10], 'flags': flags, 'obfuscated': obf,
            'fingerprint': hashlib.sha1(norm.encode('utf-8', 'ignore')).hexdigest()[:16], 'size': len(t)}


def host_alive(host):
    for scheme in ('https://', 'http://'):
        st, _, sec = get(scheme + host + '/', timeout=8)
        if st and st < 500:                     # сервер ответил (404 на корне — обычное дело) — живой
            return True
    return False


def evaluate(c, our_prints):
    info = repo_info(c['repo'])
    if not info or info.get('archived') or info.get('disabled'):
        return None
    pushed = info.get('pushed_at') or ''
    age = (time.time() - time.mktime(time.strptime(pushed[:10], '%Y-%m-%d'))) / 86400 if pushed else 9999
    if age > MAX_AGE_DAYS:
        return None
    branch = info.get('default_branch') or 'main'
    st, body, _ = get('https://raw.githubusercontent.com/%s/%s/%s' % (c['repo'], branch, urllib.parse.quote(c['path'])), timeout=20)
    if st != 200 or len(body) < 500:
        return None
    text = body.decode('utf-8', 'ignore')
    if 'Player.play' not in text or not ONLINE_WORDS.search(text) or ADULT_WORDS.search(text):
        return None
    a = analyse(text)
    if a['fingerprint'] in our_prints:
        return None
    alive = [h for h in a['hosts'][:8] if host_alive(h)]
    score = 0
    score += 3 if len(alive) >= 1 else -5
    score += 2 if len(alive) >= 3 else 0
    score += 2 if age <= FRESH_DAYS else 0
    score += min(int(info.get('stargazers_count') or 0), 20) // 5
    score -= 4 if a['obfuscated'] else 0
    score -= 3 if 'вход/подписка' in a['flags'] or 'бот Telegram' in a['flags'] else 0
    score -= 2 if 'копия Online Mod' in a['flags'] else 0
    score -= 2 if 'KinoPub (платно)' in a['flags'] or 'свой аккаунт Filmix' in a['flags'] else 0
    score -= 1 if 'реклама' in a['flags'] else 0
    score -= 3 if 'украинские источники' in a['flags'] else 0
    score -= 2 if info.get('fork') else 0
    return dict(c, url=install_url(c['repo'], branch, c['path']), pushed=pushed[:10], stars=info.get('stargazers_count') or 0,
                fork=bool(info.get('fork')), alive_hosts=alive, score=score, **a)


# ---------- отчёт и задача ----------

def load_state():
    st, body, _ = get(STATE_URL + '?t=%d' % time.time(), timeout=20)
    try:
        return json.loads(body.decode('utf-8')) if st == 200 else {}
    except Exception:
        return {}


def md_report(ours, cands, new_ids, dead):
    L = ['# Онлайн-источники: проверка ' + time.strftime('%Y-%m-%d'), '',
         '_Отчёт `tools/sources_scan.py`. Код плагинов не выполнялся — только прочитан. В Lampa ничего не добавлено:_',
         '_новый источник подключается только после проверки на ТВ и «да» владельца._', '', '## Наши источники', '',
         '| Источник | Адреса | Итог |', '|---|---|---|']
    for s in ours:
        cells = ', '.join('%s %s (%s с)' % ('✅' if u['ok'] else '❌', u['url'], u['sec']) for u in s['checks'])
        L.append('| %s | %s | %s |' % (s['name'], cells, 'работает' if s['alive'] else '**не отвечает (%d раз подряд)**' % s['dead_runs']))
    if dead:
        L += ['', '**Не отвечают:** ' + ', '.join(dead)]
    L += ['', '## Кандидаты с GitHub (лучшие)', '', 'Счёт: живые серверы, свежесть, звёзды; минус — запутанный код, вход, копия Online Mod, KinoPub/Filmix-аккаунт, реклама, украинские источники.', '',
          '| Счёт | Новый | Плагин | Обновлён | Живые серверы | Пометки |', '|---|---|---|---|---|---|']
    for c in cands[:25]:
        L.append('| %d | %s | [%s](https://github.com/%s/blob/HEAD/%s) `%s` | %s | %s | %s |' % (
            c['score'], '🆕' if c['repo'] + '/' + c['path'] in new_ids else '', c['repo'] + '/' + c['path'], c['repo'], c['path'], c['url'],
            c['pushed'], ', '.join(c['alive_hosts'][:4]) or '—', ', '.join(c['flags']) or '—'))
    return '\n'.join(L) + '\n'


def upsert_issue(title, body):
    if not TOKEN:
        return
    st, items = gh('/repos/%s/issues' % REPO, {'labels': 'sources', 'state': 'open', 'per_page': 5})
    data = json.dumps({'title': title, 'body': body[:60000], 'labels': ['sources']}).encode('utf-8')
    if st == 200 and items:
        get('https://api.github.com/repos/%s/issues/%d' % (REPO, items[0]['number']), data=data, method='PATCH', auth=True)
    else:
        get('https://api.github.com/repos/%s/issues' % REPO, data=data, method='POST', auth=True)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else 'out'
    os.makedirs(out, exist_ok=True)
    state = load_state()
    seen = state.get('seen', {})
    dead_runs = state.get('dead_runs', {})

    ours = our_sources()
    with cf.ThreadPoolExecutor(8) as ex:
        for s in ours:
            s['checks'] = list(ex.map(check_url, s['urls']))
    our_prints = set()
    for s in ours:
        s['alive'] = any(u['ok'] for u in s['checks'])
        dead_runs[s['id']] = 0 if s['alive'] else dead_runs.get(s['id'], 0) + 1
        s['dead_runs'] = dead_runs[s['id']]
        for u in s['urls'][:1]:
            st, body, _ = get(u, timeout=20)
            if st == 200:
                our_prints.add(analyse(body.decode('utf-8', 'ignore'))['fingerprint'])
    dead = [s['name'] for s in ours if s['dead_runs'] >= 2]     # два прогона подряд — не случайный сбой

    raw = search_candidates()
    cands = []
    with cf.ThreadPoolExecutor(6) as ex:
        for r in ex.map(lambda c: evaluate(c, our_prints), raw):
            if r:
                cands.append(r)
    # одинаковый код в разных репозиториях — один кандидат (самый свежий)
    best = {}
    for c in sorted(cands, key=lambda c: c['pushed'], reverse=True):
        best.setdefault(c['fingerprint'], c)
    cands = sorted(best.values(), key=lambda c: (-c['score'], c['pushed']), reverse=False)
    now = time.strftime('%Y-%m-%d')
    new_ids = set()
    for c in cands:
        k = c['repo'] + '/' + c['path']
        if k not in seen:
            seen[k] = now
            new_ids.add(k)
    strong_new = [c for c in cands if c['repo'] + '/' + c['path'] in new_ids and c['score'] >= 4]

    report = {'time': now, 'ours': ours, 'dead': dead, 'searched': len(raw), 'candidates': cands[:60],
              'new_strong': [c['url'] for c in strong_new]}
    json.dump(report, open(os.path.join(out, 'report.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    md = md_report(ours, cands, new_ids, dead)
    open(os.path.join(out, 'report.md'), 'w', encoding='utf-8', newline='\n').write(md)
    json.dump({'seen': seen, 'dead_runs': dead_runs}, open(os.path.join(out, 'state.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('наши: %d, не отвечают: %s; найдено файлов: %d, кандидатов: %d, новых сильных: %d' %
          (len(ours), ', '.join(dead) or 'нет', len(raw), len(cands), len(strong_new)))
    if '--issue' in sys.argv and (dead or strong_new):
        why = []
        if dead:
            why.append('не отвечает: ' + ', '.join(dead))
        if strong_new:
            why.append('новых кандидатов: %d' % len(strong_new))
        upsert_issue('Онлайн-источники: ' + '; '.join(why), md)


if __name__ == '__main__':
    main()
