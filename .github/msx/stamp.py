"""Метка версии у site.css / site.js в главной (site/index.html): ?v=<первые 8 знаков md5 файла>.
Запускать после любой правки site.css или site.js — браузеры сразу возьмут новые, а кешировать их можно надолго.
Запуск: python .github/msx/stamp.py"""
import hashlib
import os
import re

SITE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'site')
page = os.path.join(SITE, 'index.html')
html = open(page, encoding='utf-8', newline='').read()
for name in ('site.css', 'site.js'):
    tag = hashlib.md5(open(os.path.join(SITE, name), 'rb').read()).hexdigest()[:8]
    html = re.sub(r'/%s(\?v=[0-9a-f]+)?"' % re.escape(name), '/%s?v=%s"' % (name, tag), html)
open(page, 'w', encoding='utf-8', newline='').write(html)
print('index.html:', ', '.join(re.findall(r'/site\.(?:css|js)\?v=[0-9a-f]+', html)))
