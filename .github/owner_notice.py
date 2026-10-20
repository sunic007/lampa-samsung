"""Личное сообщение владельцу после автообновления Lampa (lampa-watch.yml): коротко по-русски, что изменилось — без ссылок,
дат и номеров коммитов. Пересказ делает ИИ (ключ SUPPORT_LLM_KEY: Gemini / Groq / OpenRouter / OpenAI), не ответил —
названия изменений из changes.md без ссылок. python3 .github/owner_notice.py <версия пакета> <версия Lampa>"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request

PROVIDERS = [  # как в .github/support/bot.py
    ('AIza', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', 'gemini-flash-lite-latest'),
    ('gsk_', 'https://api.groq.com/openai/v1/chat/completions', 'openai/gpt-oss-20b'),
    ('sk-or-', 'https://openrouter.ai/api/v1/chat/completions', 'google/gemini-2.5-flash-lite'),
    ('sk-', 'https://api.openai.com/v1/chat/completions', 'gpt-4.1-mini'),
]


def titles():
    """Названия изменений из changes.md: «- Title (дата, [hash](url))» → «Title»; служебные («Fix», «Test») — прочь."""
    if not os.path.exists('changes.md'):
        return []
    out = []
    for line in open('changes.md', encoding='utf-8'):
        t = re.sub(r'\s*\(\d{4}-\d\d-\d\d.*$', '', line.strip().lstrip('-').strip())
        t = re.sub(r'\[[^\]]*\]\([^)]*\)', '', t).strip()
        if t and not re.fullmatch(r'(?i)(fix(ed)?|test|return|merge.*|update.*)', t):
            out.append(t)
    return out[:12]


def retell(items):
    """ИИ: 3–6 коротких пунктов по-русски для обычного человека. None — не вышло."""
    key = os.environ.get('LLM_KEY', '')
    prov = next((p for p in PROVIDERS if key.startswith(p[0])), None)
    if not key or not prov or not items:
        return None
    prompt = ('Это названия изменений в Lampa (приложение для фильмов на ТВ). Перескажи по-русски для обычного '
              'пользователя: 3–6 коротких пунктов, каждый с новой строки и с «• », только что изменилось, исправлено '
              'или добавлено. Без ссылок, дат, кода и технических слов, без вступления.\n\n' + '\n'.join(items))
    body = json.dumps({'model': prov[2], 'messages': [{'role': 'user', 'content': prompt}], 'temperature': 0.2}).encode()
    req = urllib.request.Request(prov[1], body, {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
    try:
        text = json.load(urllib.request.urlopen(req, timeout=40))['choices'][0]['message']['content'].strip()
    except Exception as e:  # noqa: BLE001 — уведомление уйдёт и без пересказа
        print('ИИ не ответил:', type(e).__name__)
        return None
    text = re.sub(r'https?://\S+', '', text)
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    return '\n'.join(l if l.startswith('•') else '• ' + l.lstrip('-* ') for l in lines[:6]) or None


def main():
    pkg, lampa = sys.argv[1], sys.argv[2]
    items = titles()
    what = retell(items) or '\n'.join('• ' + t for t in items[:6])
    text = 'Lampa обновилась сама: %s (Sunic Apps %s)\n' % (lampa, pkg)
    if what:
        text += '\nЧто нового:\n' + what + '\n'
    text += '\nПроверено автотестами, ТВ, Android и сайт обновятся сами.'
    d = urllib.parse.urlencode({'chat_id': os.environ['TG_CHAT'], 'text': text[:4000], 'disable_web_page_preview': 'true'}).encode()
    try:
        print('telegram', urllib.request.urlopen('https://api.telegram.org/bot%s/sendMessage' % os.environ['TG_TOKEN'], d, timeout=20).status)
    except Exception as e:  # noqa: BLE001
        print('telegram:', type(e).__name__)


if __name__ == '__main__':
    main()
