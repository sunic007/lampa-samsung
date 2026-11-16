#!/usr/bin/env python3
"""Поэтапная выкатка Sunic Apps на ТВ: правит version.json (его читает src/update.js на ТВ).

  python tools/rollout.py                 что сейчас: проверенная версия, новая и её доля, остановленные
  python tools/rollout.py 10              новую версию (next) — 10% ТВ; 0 — только ТВ «Получать новые версии первым»
  python tools/rollout.py 100             новая становится проверенной — для всех (и для ТВ со старым update.js,
                                          Android, сайта)
  python tools/rollout.py hold 2.3.96     аварийно остановить версию: никому не ставим, кто на ней — вернётся на
                                          проверенную
  python tools/rollout.py unhold 2.3.96   снять остановку

Меняет только version.json; дальше коммит и push (ТВ читают version.json с ветки main).
Порядок: tools/pack.py --bump --rollout 0 → тег → владелец проверяет на своём ТВ → rollout.py 10 → 50 → 100.
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
    print('проверенная (всем):', m['version'])
    nx = m.get('next')
    if nx:
        print('новая:', nx['version'], '— доля', str(nx.get('pct', 0)) + '% + ТВ «первым»')
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
            if argv[1] == m['version']:
                print('внимание: это проверенная версия — ТВ с новым update.js вернутся на пакет, старые её не знают')
            hold.append(argv[1])
        if hold:
            m['hold'] = hold
        else:
            m.pop('hold', None)
    else:
        try:
            pct = max(0, min(100, int(argv[0])))
        except ValueError:
            sys.exit(__doc__)
        nx = m.get('next')
        if not nx:
            sys.exit('новой версии нет: выпускайте через tools/pack.py --bump --rollout 0')
        if pct >= 100:
            m['version'], m['files'] = nx['version'], nx['files']
            if nx.get('notes'):
                m['notes'] = nx['notes']
            else:
                m.pop('notes', None)
            m.pop('next')
        else:
            nx['pct'] = pct
    save(m)
    status(m)


if __name__ == '__main__':
    main(sys.argv[1:])
