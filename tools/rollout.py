#!/usr/bin/env python3
"""Поэтапная выкатка Sunic Apps на ТВ: правит поля выкатки в version.json (их читает src/update.js).

  python tools/rollout.py                 что сейчас: версия, доля, stable, остановленные
  python tools/rollout.py 10              новую версию — 10% ТВ (0 — только ТВ «Получать новые версии первым»)
  python tools/rollout.py 100             всем (поля rollout/stable убираются — как обычный выпуск)
  python tools/rollout.py hold 2.3.96     аварийно остановить версию: никому не ставим, кто на ней — вернётся на stable
  python tools/rollout.py unhold 2.3.96   снять остановку

Меняет только version.json; коммит и push — как обычно (ТВ читают version.json с ветки main).
Как выпускать: tools/pack.py --bump --rollout 0 → тег → владелец проверяет на своём ТВ → rollout.py 10 → 50 → 100.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, 'version.json')
VER = re.compile(r'^\d+\.\d+\.\d+$')


def load():
    with open(PATH, encoding='utf-8') as f:
        return json.load(f)


def save(m):
    with open(PATH, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(m, f, ensure_ascii=False, indent=1)
        f.write('\n')


def status(m):
    r = m.get('rollout')
    pct = r['pct'] if r and r.get('v') == m['version'] else 100
    print('версия', m['version'], '— доля', str(pct) + '%', '(+ ТВ «первым»)' if pct < 100 else '')
    if m.get('stable') and pct < 100:
        print('остальным — stable', m['stable']['version'])
    if m.get('hold'):
        print('остановлены:', ', '.join(m['hold']))


def main(argv):
    m = load()
    if not argv:
        return status(m)
    if argv[0] in ('hold', 'unhold'):
        if len(argv) < 2 or not VER.match(argv[1]):
            sys.exit('укажите версию: rollout.py %s 2.3.96' % argv[0])
        hold = [v for v in m.get('hold', []) if v != argv[1]]
        if argv[0] == 'hold':
            hold.append(argv[1])
            if argv[1] == m['version'] and not m.get('stable'):
                print('внимание: stable нет — ТВ на', argv[1], 'вернутся на версию из пакета')
        if hold:
            m['hold'] = hold
        else:
            m.pop('hold', None)
    else:
        try:
            pct = max(0, min(100, int(argv[0])))
        except ValueError:
            sys.exit(__doc__)
        if pct >= 100:
            m.pop('rollout', None)
            m.pop('stable', None)
        else:
            if not m.get('stable'):
                sys.exit('stable нет: выпускайте через tools/pack.py --bump --rollout 0 (stable = прежняя версия)')
            m['rollout'] = {'v': m['version'], 'pct': pct}
    save(m)
    status(m)


if __name__ == '__main__':
    main(sys.argv[1:])
