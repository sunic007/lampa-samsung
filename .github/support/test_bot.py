"""Тесты бота поддержки: python -m unittest discover -s .github/support -p "test_*.py"

Telegram, GitHub и ИИ подменены — сеть не нужна.
"""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bot  # noqa: E402

NOW = 1_800_000_000
GROUP = {'id': -1001234567890, 'type': 'supergroup', 'username': 'sunicapps', 'title': 'Sunic Apps'}
ME = {'id': 555, 'is_bot': True, 'username': 'sunicapps_news_bot'}


def msg(text, mid=10, user=42, **kw):
    m = {'message_id': mid, 'date': NOW - 60, 'chat': GROUP, 'text': text,
         'from': {'id': user, 'is_bot': False, 'first_name': 'Ann', 'language_code': 'ru'}}
    m.update(kw)
    return m


class FakeTG:
    def __init__(self, updates=None):
        self.calls = []
        self.updates = updates or []

    def call(self, method, **p):
        self.calls.append((method, p))
        if method == 'getMe':
            return ME
        if method == 'getUpdates':
            return self.updates if 'offset' not in p else []
        if method == 'sendMessage':
            return {'message_id': 900 + len(self.calls)}
        return True

    def sent(self):
        return [p for m, p in self.calls if m == 'sendMessage']


class FakeGH:
    def __init__(self, token='t', routes=None):
        self.token = token
        self.calls = []
        self.routes = routes or {}
        self.n = 100

    def req(self, method, path, body=None, params=None, ok=None):
        self.calls.append((method, path, body, params))
        for (m, p), res in self.routes.items():
            if m == method and path == p:
                if isinstance(res, Exception):
                    raise res
                return res
        if method == 'POST' and path.endswith('/issues'):
            self.n += 1
            return {'number': self.n, 'html_url': 'https://github.com%s/%d' % (path.replace('/repos', ''), self.n)}
        if method == 'GET' and path.endswith('/issues'):
            return []
        if method == 'GET' and path.endswith('/comments'):
            return []
        return {}

    def posts(self, suffix):
        return [c for c in self.calls if c[0] == 'POST' and c[1].endswith(suffix)]


class FakeLLM:
    def __init__(self, *answers, enabled=True):
        self.answers = list(answers)
        self.enabled = enabled
        self.calls = self.sent = 0

    def chat(self, messages):
        self.calls += 1
        self.sent += 1
        a = self.answers.pop(0) if self.answers else '{}'
        if isinstance(a, Exception):
            raise a
        return a if isinstance(a, str) else json.dumps(a)


def make_bot(tg=None, gh=None, llm=None):
    b = bot.Bot(tg or FakeTG(), gh or FakeGH(), llm or FakeLLM(enabled=False), kb='KB', secret='s3cret', now=lambda: NOW)
    b.me = ME
    return b


class ClassificationParsing(unittest.TestCase):
    def test_valid_json(self):
        r = bot.parse_classification(json.dumps({'kind': 'bug', 'product': 'tvinstaller', 'lang': 'uz',
                                                 'title': 'Televizor topilmayapti', 'answer': 'x'}), 'televizor')
        self.assertEqual((r['kind'], r['product'], r['lang'], r['answer']), ('bug', 'tvinstaller', 'uz', ''))

    def test_fenced_and_prose(self):
        r = bot.parse_classification('Here:\n```json\n{"kind":"question","product":"lampa","lang":"ru",'
                                     '"answer":"Откройте Настройки → Sunic Apps → Плеер.","title":""}\n```', 'как?')
        self.assertEqual(r['kind'], 'question')
        self.assertIn('Sunic Apps', r['answer'])

    def test_garbage(self):
        self.assertIsNone(bot.parse_classification('sorry, I cannot', 'x'))
        self.assertIsNone(bot.parse_classification('', 'x'))

    def test_question_without_answer_becomes_ticket(self):
        r = bot.parse_classification('{"kind":"question","product":"lampa","lang":"ru","answer":"","title":"Нет звука"}',
                                     'Почему нет звука?')
        self.assertEqual(r['kind'], 'question_unknown')
        self.assertEqual(r['title'], 'Нет звука')

    def test_unknown_values_normalized(self):
        r = bot.parse_classification('{"kind":"feature","product":"TV Installer!","lang":"de","title":"t"}',
                                     'Please add dark mode')
        self.assertEqual(r['kind'], 'suggestion')
        self.assertEqual(r['product'], 'unknown')
        self.assertEqual(r['lang'], 'en')
        self.assertTrue(len(r['title']) >= 4)    # слишком короткий заголовок → из текста
        r = bot.parse_classification('{"kind":"hack"}', 'привет')
        self.assertEqual(r['kind'], 'other')

    def test_limits(self):
        long = 'Слово. ' * 200
        r = bot.parse_classification(json.dumps({'kind': 'question', 'answer': long, 'title': 'x' * 300,
                                                 'lang': 'ru', 'product': 'lampa'}), 'q')
        self.assertLessEqual(len(r['answer']), bot.ANSWER_MAX)
        r = bot.parse_classification(json.dumps({'kind': 'bug', 'title': 'Ошибка ' * 40, 'lang': 'ru'}), 'q')
        self.assertLessEqual(len(r['title']), bot.TITLE_MAX)

    def test_title_sanitized(self):
        r = bot.parse_classification('{"kind":"bug","title":"Звонить +998 90 123 45 67","lang":"ru"}', 'q')
        self.assertNotIn('123 45', r['title'])

    def test_keyword_rules(self):
        self.assertEqual(bot.keyword_classify('Lampa не запускается после обновления')['kind'], 'bug')
        self.assertEqual(bot.keyword_classify('Lampa не запускается после обновления')['product'], 'lampa')
        self.assertEqual(bot.keyword_classify('Добавьте, пожалуйста, тёмную тему в TV Installer')['kind'], 'suggestion')
        self.assertEqual(bot.keyword_classify('Добавьте, пожалуйста, тёмную тему в TV Installer')['product'], 'tvinstaller')
        self.assertEqual(bot.keyword_classify('Как подключить второй телевизор?')['kind'], 'question_unknown')
        self.assertEqual(bot.keyword_classify('Спасибо!')['kind'], 'other')
        self.assertEqual(bot.keyword_classify('Televizor ishlamayapti, nima qilish kerak')['lang'], 'uz')
        self.assertEqual(bot.keyword_classify('The app does not work on my TV')['kind'], 'bug')


class Sanitize(unittest.TestCase):
    def test_secrets(self):
        s = bot.sanitize('token 1234567890:AAH' + 'x' * 32 + ' groq gsk_' + 'a' * 40 + ' gem AIza' + 'B' * 35 +
                         ' or sk-or-v1-' + 'c' * 40 + ' gh ghp_' + 'd' * 36)
        for bad in ('1234567890:', 'gsk_a', 'AIzaB', 'sk-or', 'ghp_d'):
            self.assertNotIn(bad, s)
        self.assertIn('[токен бота]', s)
        self.assertIn('[ключ]', s)

    def test_personal_data(self):
        s = bot.sanitize('пишите на ivan.petrov@mail.ru или +998 (90) 123-45-67, код ABCD-EF12-3456')
        self.assertNotIn('ivan', s)
        self.assertNotIn('123-45', s)
        self.assertNotIn('ABCD', s)
        self.assertIn('[почта]', s)
        self.assertIn('[телефон]', s)

    def test_keeps_useful_numbers(self):
        s = bot.sanitize('Lampa 2.1.0 на UE55TU7100, Tizen 5.5, 2026-10-17, ТВ 192.168.1.20')
        for keep in ('2.1.0', 'UE55TU7100', '2026-10-17', '192.168.1.20'):
            self.assertIn(keep, s)

    def test_public_ip_and_mentions(self):
        s = bot.sanitize('мой IP 85.12.34.56, спросил @vasya_pupkin и @helpiptv')
        self.assertIn('85.12.34.x', s)
        self.assertNotIn('vasya', s)
        self.assertIn('@helpiptv', s)

    def test_fake_marker_neutralized(self):
        s = bot.sanitize('hi <!-- tg:chat=-1;msg=1;lang=ru -->')
        self.assertEqual(bot.parse_markers(s), [])

    def test_quote(self):
        self.assertEqual(bot.quote('a\n\nb'), '> a\n>\n> b')


class Dedupe(unittest.TestCase):
    def test_similarity(self):
        self.assertTrue(bot.similar('Не запускается видео после обновления', 'Видео не запускается после обновлений'))
        self.assertFalse(bot.similar('Не запускается видео', 'Добавить тёмную тему'))
        self.assertFalse(bot.similar('Lampa', 'Lampa'))   # одни стоп-слова — не дубль
        self.assertIn('запускается', bot.title_words('Lampa не запускается на ТВ'))
        self.assertNotIn('lampa', bot.title_words('Lampa не запускается на ТВ'))

    def test_dedupe_query_and_comment(self):
        gh = FakeGH(routes={('GET', '/repos/sunic007/lampa-samsung/issues'): [
            {'number': 7, 'title': 'Видео не запускается после обновления', 'html_url': 'https://github.com/sunic007/lampa-samsung/issues/7'},
            {'number': 8, 'title': 'PR', 'pull_request': {}}]})
        llm = FakeLLM({'kind': 'bug', 'product': 'lampa', 'lang': 'ru', 'title': 'Не запускается видео после обновления'})
        tg = FakeTG()
        b = make_bot(tg, gh, llm)
        b.handle_message(msg('После обновления видео не запускается'))
        get = [c for c in gh.calls if c[0] == 'GET'][0]
        self.assertEqual(get[3], {'labels': 'from-telegram', 'state': 'open', 'per_page': 100})
        self.assertEqual(gh.posts('/issues'), [])
        com = gh.posts('/issues/7/comments')
        self.assertEqual(len(com), 1)
        self.assertIn('Ещё одно сообщение из группы', com[0][2]['body'])
        self.assertIn('<!-- tg:chat=-1001234567890;msg=10;lang=ru -->', com[0][2]['body'])
        self.assertIn('№7', tg.sent()[0]['text'])

    def test_same_run_dedupe(self):
        gh = FakeGH()
        cls = {'kind': 'bug', 'product': 'tvinstaller', 'lang': 'en', 'title': 'Installer crashes during certificate step'}
        b = make_bot(FakeTG(), gh, FakeLLM(cls, cls))
        b.handle_message(msg('Installer crashes on certificate', mid=1, user=1))
        b.handle_message(msg('Crash at certificate step', mid=2, user=2))
        self.assertEqual(len(gh.posts('/repos/sunic007/tvinstaller/issues')), 1)
        self.assertEqual(len(gh.posts('/repos/sunic007/tvinstaller/issues/101/comments')), 1)


class Tickets(unittest.TestCase):
    def test_new_issue(self):
        gh, tg = FakeGH(), FakeTG()
        llm = FakeLLM({'kind': 'suggestion', 'product': 'tvinstaller', 'lang': 'uz', 'title': "Qorong'i mavzu"})
        b = make_bot(tg, gh, llm)
        b.handle_message(msg("Qorong'i mavzu qo'shing, pochta a@b.uz", mid=33))
        post = gh.posts('/repos/sunic007/tvinstaller/issues')[0][2]
        self.assertEqual(post['labels'], ['from-telegram', 'enhancement'])
        self.assertEqual(post['title'], "Qorong'i mavzu")
        self.assertIn('https://t.me/sunicapps/33', post['body'])
        self.assertIn('<!-- tg:chat=-1001234567890;msg=33;lang=uz -->', post['body'])
        self.assertNotIn('a@b.uz', post['body'])
        self.assertNotIn('Ann', post['body'])
        sent = tg.sent()[0]
        self.assertIn('Taklifingizni', sent['text'])
        self.assertEqual(sent['reply_parameters']['message_id'], 33)
        self.assertEqual(len(gh.posts('/labels')), 1)

    def test_unknown_product_goes_to_lampa(self):
        gh = FakeGH()
        b = make_bot(FakeTG(), gh, FakeLLM({'kind': 'question_unknown', 'product': 'unknown', 'lang': 'ru', 'title': 'Вопрос про пульт'}))
        b.handle_message(msg('А пульт от LG подойдёт?'))
        self.assertEqual(gh.posts('/repos/sunic007/lampa-samsung/issues')[0][2]['labels'], ['from-telegram', 'question'])

    def test_answered_question(self):
        tg, gh = FakeTG(), FakeGH()
        b = make_bot(tg, gh, FakeLLM({'kind': 'question', 'product': 'lampa', 'lang': 'en',
                                      'answer': 'Settings → Sunic Apps → Player <b>', 'title': ''}))
        b.handle_message(msg('Where is the player setting?', mid=5))
        s = tg.sent()[0]
        self.assertIn('&lt;b&gt;', s['text'])                    # ответ ИИ экранирован
        self.assertIn("Didn't help? Reply to this message", s['text'])
        self.assertEqual(s['reply_parameters']['message_id'], 5)
        self.assertEqual(gh.calls, [])

    def test_no_support_token(self):
        tg, gh = FakeTG(), FakeGH(token='')
        b = make_bot(tg, gh, FakeLLM({'kind': 'bug', 'product': 'lampa', 'lang': 'ru', 'title': 'Сломалось'},
                                     {'kind': 'question', 'answer': 'Подождите 1–2 минуты.', 'lang': 'ru'}))
        b.handle_message(msg('Всё сломалось', mid=1))
        b.handle_message(msg('Долго грузится?', mid=2))
        self.assertEqual(gh.calls, [])
        self.assertEqual(len(tg.sent()), 1)

    def test_other_ignored(self):
        tg, gh = FakeTG(), FakeGH()
        make_bot(tg, gh, FakeLLM({'kind': 'other'})).handle_message(msg('Всем привет!'))
        self.assertEqual((tg.sent(), gh.calls), ([], []))

    def test_reply_to_bot_answer_becomes_ticket(self):
        tg, gh = FakeTG(), FakeGH()
        answer = {'message_id': 77, 'from': ME, 'chat': GROUP, 'text': 'Откройте Sunic Apps → Плеер.\n\nНе помогло? …'}
        b = make_bot(tg, gh, FakeLLM({'kind': 'other', 'lang': 'ru'}))
        b.handle_message(msg('не помогло', reply_to_message=answer))
        post = gh.posts('/issues')[0][2]
        self.assertIn('question', post['labels'])
        self.assertIn('Ответ бота, который не помог', post['body'])
        self.assertIn('Откройте Sunic Apps', post['title'])

    def test_thanks_to_bot_answer_ignored(self):
        tg, gh = FakeTG(), FakeGH()
        answer = {'message_id': 77, 'from': ME, 'chat': GROUP, 'text': 'Ответ'}
        make_bot(tg, gh, FakeLLM({'kind': 'other', 'lang': 'ru'})).handle_message(msg('Спасибо!', reply_to_message=answer))
        self.assertEqual(gh.calls, [])

    def test_followup_to_ticket_message(self):
        tg, gh = FakeTG(), FakeGH()
        accepted = {'message_id': 78, 'from': ME, 'chat': GROUP, 'text': 'Спасибо! Мы приняли ваш вопрос (№12)…',
                    'entities': [{'type': 'text_link', 'offset': 0, 'length': 3,
                                  'url': 'https://github.com/sunic007/tvinstaller/issues/12'}]}
        llm = FakeLLM()
        make_bot(tg, gh, llm).handle_message(msg('Модель ТВ UE43, Android 14', reply_to_message=accepted))
        self.assertEqual(llm.calls, 0)
        self.assertIn('Дополнение из группы', gh.posts('/repos/sunic007/tvinstaller/issues/12/comments')[0][2]['body'])
        self.assertIn('№12', tg.sent()[0]['text'])
        self.assertEqual([c for c in gh.calls if c[0] == 'PATCH'], [])

    def test_followup_reopens_completed_issue(self):
        gh = FakeGH(routes={('GET', '/repos/sunic007/lampa-samsung/issues/4'): {'state': 'closed', 'state_reason': 'completed'}})
        done = {'message_id': 79, 'from': ME, 'chat': GROUP, 'text': '✅ Готово: Звук. Проверьте, пожалуйста, и оцените:',
                'entities': [{'type': 'text_link', 'url': 'https://github.com/sunic007/lampa-samsung/issues/4'}]}
        make_bot(FakeTG(), gh, FakeLLM()).handle_message(msg('Всё ещё нет звука', reply_to_message=done))
        self.assertEqual([c[2] for c in gh.calls if c[0] == 'PATCH'], [{'state': 'open'}])

    def test_per_user_limit(self):
        gh = FakeGH()
        answers = [{'kind': 'bug', 'lang': 'ru', 'product': 'lampa', 'title': w}
                   for w in ('Пропал звук', 'Зависает пульт', 'Нет субтитров', 'Мигает экран')]
        b = make_bot(FakeTG(), gh, FakeLLM(*answers))
        for i in range(4):
            b.handle_message(msg('ошибка %d' % i, mid=i + 1))
        self.assertEqual(len(gh.posts('/repos/sunic007/lampa-samsung/issues')), bot.MAX_PER_USER)


class Filter(unittest.TestCase):
    def setUp(self):
        self.b = make_bot()

    def test_accepts_group_message(self):
        self.assertEqual(self.b.message_filter(msg('Как обновить?'))[0], 'Как обновить?')

    def test_ignores(self):
        f = self.b.message_filter
        self.assertIsNone(f(msg('x', chat={'id': -1, 'type': 'supergroup', 'username': 'other'})))
        self.assertIsNone(f(msg('x', **{'from': {'id': 1, 'is_bot': True}})))
        self.assertIsNone(f(msg('old', date=NOW - 3 * 24 * 3600)))
        self.assertIsNone(f({**msg(''), 'text': None, 'new_chat_members': [{'id': 1}]}))
        self.assertIsNone(f(msg('/start')))
        self.assertIsNone(f(msg('news', is_automatic_forward=True)))
        human = {'message_id': 3, 'from': {'id': 43, 'is_bot': False}, 'text': 'a'}
        self.assertIsNone(f(msg('согласен', reply_to_message=human)))

    def test_mention_in_reply_to_human(self):
        human = {'message_id': 3, 'from': {'id': 43, 'is_bot': False}, 'text': 'У меня тоже не работает'}
        text, ctx = self.b.message_filter(msg('@sunicapps_news_bot почему?', reply_to_message=human))
        self.assertEqual(text, 'почему?')
        self.assertEqual(ctx['quoted'], 'У меня тоже не работает')

    def test_comment_under_channel_post_is_top_level(self):
        post = {'message_id': 2, 'from': {'id': bot.TG_SERVICE_USER}, 'is_automatic_forward': True, 'text': 'v2.1.1'}
        text, ctx = self.b.message_filter(msg('А как обновиться?', reply_to_message=post))
        self.assertIsNone(ctx)

    def test_chat_id_env(self):
        b = bot.Bot(FakeTG(), FakeGH(), FakeLLM(enabled=False), chat_id='-100777', now=lambda: NOW)
        b.me = ME
        self.assertIsNotNone(b.message_filter(msg('Как?', chat={'id': -100777, 'type': 'supergroup'})))


class Markers(unittest.TestCase):
    def test_roundtrip(self):
        m = bot.make_marker(-1001234567890, 42, 'uz')
        self.assertEqual(m, '<!-- tg:chat=-1001234567890;msg=42;lang=uz -->')
        self.assertEqual(bot.parse_markers('text\n' + m + '\n' + bot.make_marker(-1, 5, 'en', thread=9)),
                         [{'chat': -1001234567890, 'msg': 42, 'lang': 'uz', 'thread': None},
                          {'chat': -1, 'msg': 5, 'lang': 'en', 'thread': 9}])

    def test_issue_from_entities(self):
        m = {'entities': [{'type': 'text_link', 'url': 'https://github.com/sunic007/lampa-samsung/issues/3'}]}
        self.assertEqual(bot.issue_from_entities(m), ('sunic007/lampa-samsung', 3))
        self.assertIsNone(bot.issue_from_entities({'entities': [{'type': 'text_link', 'url': 'https://github.com/evil/x/issues/3'}]}))


class Rating(unittest.TestCase):
    def cb(self, data='rate:tvinstaller:12:4', user=42, chat=GROUP):
        return {'id': 'cb1', 'data': data, 'from': {'id': user, 'language_code': 'ru'},
                'message': {'message_id': 50, 'chat': chat, 'text': '✅ Готово: x. Проверьте, пожалуйста, и оцените:'}}

    def gh(self, comments=()):
        return FakeGH(routes={('GET', '/repos/sunic007/tvinstaller/issues/12'): {'labels': [{'name': 'from-telegram'}]},
                              ('GET', '/repos/sunic007/tvinstaller/issues/12/comments'): list(comments)})

    def test_parse(self):
        self.assertEqual(bot.parse_rate('rate:lampa-samsung:7:5'), ('lampa-samsung', 7, 5))
        for bad in ('rate:evil:7:5', 'rate:lampa-samsung:7:6', 'rate:lampa-samsung:x:1', 'rated', ''):
            self.assertIsNone(bot.parse_rate(bad))

    def test_first_rating(self):
        tg, gh = FakeTG(), self.gh()
        self.assertEqual(make_bot(tg, gh).handle_callback(self.cb()), 4)
        body = gh.posts('/issues/12/comments')[0][2]['body']
        self.assertIn('Оценка из Telegram: ⭐⭐⭐⭐ (4/5)', body)
        self.assertIn(bot.rate_marker('s3cret', 'sunic007/tvinstaller', 12, 42), body)
        self.assertNotIn('42', body.replace('(4/5)', ''))         # id человека не виден
        ans = [p for m, p in tg.calls if m == 'answerCallbackQuery'][0]
        self.assertEqual(ans['text'], 'Спасибо за оценку!')
        edit = [p for m, p in tg.calls if m == 'editMessageReplyMarkup'][0]
        self.assertEqual(edit['reply_markup']['inline_keyboard'][0][0]['text'], 'Оценка: ⭐⭐⭐⭐')

    def test_second_rating_ignored(self):
        mark = bot.rate_marker('s3cret', 'sunic007/tvinstaller', 12, 42)
        tg, gh = FakeTG(), self.gh([{'body': 'Оценка из Telegram: ⭐ (1/5)\n\n' + mark}])
        self.assertEqual(make_bot(tg, gh).handle_callback(self.cb()), 'again')
        self.assertEqual(gh.posts('/comments'), [])
        self.assertEqual([p for m, p in tg.calls if m == 'answerCallbackQuery'][0]['text'], 'Вы уже оценили — спасибо!')

    def test_bad_callbacks(self):
        tg, gh = FakeTG(), self.gh()
        b = make_bot(tg, gh)
        self.assertIsNone(b.handle_callback(self.cb('rate:evil:1:1')))
        self.assertIsNone(b.handle_callback(self.cb(chat={'id': -5, 'type': 'group', 'username': 'x'})))
        self.assertEqual(gh.calls, [])
        gh2 = FakeGH(routes={('GET', '/repos/sunic007/tvinstaller/issues/12'): {'labels': [{'name': 'bug'}]}})
        self.assertIsNone(make_bot(FakeTG(), gh2).handle_callback(self.cb()))
        self.assertEqual(gh2.posts('/comments'), [])


class Localization(unittest.TestCase):
    def test_same_keys(self):
        keys = set(bot.TEXTS['ru'])
        for lang in bot.LANGS:
            self.assertEqual(set(bot.TEXTS[lang]), keys, lang)

    def test_placeholders_match(self):
        import string
        for key in bot.TEXTS['ru']:
            fields = {lang: {f[1] for f in string.Formatter().parse(bot.TEXTS[lang][key]) if f[1]} for lang in bot.LANGS}
            self.assertEqual(fields['ru'], fields['uz'], key)
            self.assertEqual(fields['ru'], fields['en'], key)

    def test_detect_lang(self):
        self.assertEqual(bot.detect_lang('Почему не работает?'), 'ru')
        self.assertEqual(bot.detect_lang("Lampa o'rnatilmayapti, yordam bering"), 'uz')
        self.assertEqual(bot.detect_lang('Лампа ишламаяпти, қандай қилиш керак'), 'uz')
        self.assertEqual(bot.detect_lang('How do I update?'), 'en')

    def test_texts(self):
        self.assertIn('Не помогло?', bot.t('ru', 'footer'))
        self.assertIn('Yordam bermadimi?', bot.t('uz', 'footer'))
        self.assertEqual(bot.t('xx', 'rate_thanks'), 'Спасибо за оценку!')
        self.assertEqual(bot.lang_of_user({'language_code': 'uz'}), 'uz')
        self.assertEqual(bot.lang_of_user({'language_code': 'en-US'}), 'en')


class RunLoop(unittest.TestCase):
    def test_confirms_after_processing(self):
        ups = [{'update_id': 5, 'message': msg('Привет всем')}, {'update_id': 6, 'message': msg('ok')}]
        tg = FakeTG(ups)
        make_bot(tg, FakeGH(), FakeLLM({'kind': 'other'}, {'kind': 'other'})).run()
        gets = [p for m, p in tg.calls if m == 'getUpdates']
        self.assertEqual(gets[0]['allowed_updates'], ['message', 'callback_query'])
        self.assertNotIn('offset', gets[0])
        self.assertEqual(gets[-1]['offset'], 7)

    def test_budget_leaves_rest_unconfirmed(self):
        ups = [{'update_id': i, 'message': msg('Вопрос номер %d?' % i, mid=i)} for i in range(1, 26)]
        tg = FakeTG(ups)
        llm = FakeLLM(*[{'kind': 'other'}] * 30)
        make_bot(tg, FakeGH(), llm).run()
        self.assertEqual(llm.calls, bot.MAX_LLM)
        self.assertEqual([p for m, p in tg.calls if m == 'getUpdates'][-1]['offset'], bot.MAX_LLM + 1)

    def test_one_broken_update_does_not_stop(self):
        ups = [{'update_id': 1, 'message': msg('ошибка в Lampa, не работает')}, {'update_id': 2, 'message': msg('ok')}]
        tg = FakeTG(ups)
        gh = FakeGH(routes={('GET', '/repos/sunic007/lampa-samsung/issues'): bot.ApiError('github 500')})
        make_bot(tg, gh, FakeLLM({'kind': 'bug', 'title': 'Не работает Lampa', 'lang': 'ru'}, {'kind': 'other'})).run()
        self.assertEqual([p for m, p in tg.calls if m == 'getUpdates'][-1]['offset'], 3)

    def test_llm_failure_falls_back_to_rules(self):
        b = make_bot(llm=FakeLLM(bot.ApiError('llm: HTTP 503')))
        self.assertEqual(b.classify('Lampa не запускается, ошибка', None)['source'], 'rules')


class FakeHttp:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests = []

    def request(self, method, url, headers=None, body=None, timeout=40, raw=False):
        self.requests.append((method, url, headers, json.loads(json.dumps(body)) if body else None))
        return self.responses.pop(0)


class Transport(unittest.TestCase):
    def test_telegram_429_retry(self):
        slept = []
        http = FakeHttp((429, {'ok': False, 'error_code': 429, 'parameters': {'retry_after': 3}}, {}),
                        (200, {'ok': True, 'result': {'message_id': 1}}, {}))
        res = bot.Telegram('123:abc', http, sleep=slept.append).call('sendMessage', chat_id=1, text='x')
        self.assertEqual(res, {'message_id': 1})
        self.assertEqual(slept, [4])

    def test_telegram_error_has_no_token(self):
        http = FakeHttp((400, {'ok': False, 'error_code': 400, 'description': 'Bad Request'}, {}))
        with self.assertRaises(bot.ApiError) as e:
            bot.Telegram('123456789:SECRETSECRETSECRETSECRETSECRETSECRET', http).call('sendMessage')
        self.assertNotIn('SECRET', str(e.exception))

    def test_llm_providers(self):
        self.assertIn('generativelanguage', bot.LLM('AIzaXXX', None).targets[0][0])
        self.assertIn('groq', bot.LLM('gsk_x', None).targets[0][0])
        self.assertIn('openrouter', bot.LLM('sk-or-v1-x', None).targets[0][0])
        self.assertIn('api.openai.com', bot.LLM('sk-proj-x', None).targets[0][0])
        self.assertEqual(bot.LLM('gsk_x', None, model='m1').targets, [(bot.PROVIDERS[1][1], 'gsk_x', 'm1')])
        self.assertFalse(bot.LLM('', None).enabled)
        self.assertEqual(len(bot.LLM('gsk_a, AIzaB', None).targets), 5)

    def test_llm_json_mode_fallback_and_next_model(self):
        ok = (200, {'choices': [{'message': {'content': '{"kind":"other"}'}}]}, {})
        http = FakeHttp((400, {'error': 'response_format'}, {}), (500, {}, {}), ok)
        out = bot.LLM('gsk_x', http, sleep=lambda s: None).chat([{'role': 'user', 'content': 'hi'}])
        self.assertEqual(out, '{"kind":"other"}')
        self.assertIn('response_format', http.requests[0][3])
        self.assertNotIn('response_format', http.requests[1][3])
        self.assertNotEqual(http.requests[1][3]['model'], http.requests[2][3]['model'])


class KnowledgeBase(unittest.TestCase):
    def test_build_kb(self):
        readme = ('# T\n<p><img src="x"></p>\n## Возможности\n' + 'Фича. ' * 150 +
                  '\n## Частые вопросы\n<details><summary><b>Видео не запускается</b></summary>Подождите 25 с.</details>'
                  '\n## Поддержать проект\nДонат')
        log = '# История\n## 2.1.1 — новое\n- Пункт A\n## 2.1.0 — старое\n- Пункт B\n## 2.0.0\n- Пункт C\n'
        tlog = '# CL\n## 2.3.8 — x\n- **EN:** english\n- **RU:** русский\n'
        kb = bot.build_kb(readme, log, '## Частые вопросы\nТВ не находится — мастер.', tlog, limit=3000)
        self.assertLessEqual(len(kb), 3000)
        self.assertIn('Видео не запускается', kb)          # FAQ идёт первым и не обрезается
        self.assertNotIn('Донат', kb)
        self.assertNotIn('<img', kb)
        self.assertIn('Пункт B', kb)
        self.assertNotIn('Пункт C', kb)
        self.assertIn('русский', kb)
        self.assertNotIn('english', kb)
        self.assertIn('ТВ не находится', kb)

    def test_real_kb_fits(self):
        texts = []
        for p in ('README.ru.md', 'CHANGELOG.md'):
            with open(os.path.join(bot.ROOT, '.github', p), encoding='utf-8') as f:
                texts.append(f.read())
        kb = bot.build_kb(*texts)
        self.assertLessEqual(len(kb), bot.KB_LIMIT)
        self.assertIn('Частые вопросы', kb)


class Notify(unittest.TestCase):
    REPO = 'sunic007/lampa-samsung'

    def event(self, reason='completed', labels=('from-telegram', 'bug'), body=None):
        return {'issue': {'number': 9, 'state_reason': reason, 'title': 'Видео <не> запускается',
                          'closed_at': '2026-10-17T10:00:00Z',
                          'user': {'login': 'sunic007'}, 'labels': [{'name': n} for n in labels],
                          'body': body if body is not None else 'text\n' + bot.make_marker(-100123, 77, 'ru')}}

    def gh(self, comments=(), release=None, events=(), compare=None):
        routes = {('GET', '/repos/%s/issues/9/comments' % self.REPO): list(comments),
                  ('GET', '/repos/%s/issues/9/events' % self.REPO): list(events),
                  ('GET', '/repos/%s/releases/latest' % self.REPO): release or bot.ApiError('404')}
        if compare:
            routes[('GET', '/repos/%s/compare/v2.1.2...abc' % self.REPO)] = compare
        return FakeGH(routes=routes)

    def test_completed_in_release(self):
        tg = FakeTG()
        gh = self.gh(release={'tag_name': 'v2.1.2', 'html_url': 'https://github.com/r/releases/tag/v2.1.2',
                              'body': '- Исправлен запуск видео (#9)'})
        sent = bot.notify(self.event(), gh, tg, self.REPO)
        self.assertEqual(len(sent), 1)
        p = tg.sent()[0]
        self.assertIn('✅ Готово: <a href="https://github.com/sunic007/lampa-samsung/issues/9">'
                      '<b>Видео &lt;не&gt; запускается</b></a>.', p['text'])
        self.assertIn('Вошло в версию 2.1.2', p['text'])
        self.assertEqual(p['reply_parameters'], {'message_id': 77, 'allow_sending_without_reply': True})
        self.assertEqual(p['chat_id'], -100123)
        kb = p['reply_markup']['inline_keyboard'][0]
        self.assertEqual([b['text'] for b in kb], ['⭐1', '⭐2', '⭐3', '⭐4', '⭐5'])
        self.assertEqual(kb[2]['callback_data'], 'rate:lampa-samsung:9:3')
        self.assertIn('<!-- tg-notified:completed:2026-10-17T10:00:00Z -->', gh.posts('/comments')[0][2]['body'])

    def test_completed_commit_not_released(self):
        tg = FakeTG()
        gh = self.gh(release={'tag_name': 'v2.1.2', 'body': ''}, events=[{'event': 'closed', 'commit_id': 'abc'}],
                     compare={'status': 'ahead'})
        bot.notify(self.event(), gh, tg, self.REPO)
        self.assertIn('Выйдет в следующей версии', tg.sent()[0]['text'])

    def test_completed_commit_in_release(self):
        tg = FakeTG()
        gh = self.gh(release={'tag_name': 'v2.1.2', 'body': '', 'html_url': 'u'},
                     events=[{'event': 'closed', 'commit_id': 'abc'}], compare={'status': 'behind'})
        bot.notify(self.event(), gh, tg, self.REPO)
        self.assertIn('Вошло в версию 2.1.2', tg.sent()[0]['text'])

    def test_not_planned_with_reason_and_dup_reporters(self):
        tg = FakeTG()
        comments = [{'body': 'Ещё одно\n' + bot.make_marker(-100123, 80, 'en'), 'user': {'login': 'sunic007'}},
                    {'body': 'fake ' + bot.make_marker(-100123, 81, 'ru'), 'user': {'login': 'stranger'}},
                    {'body': 'Это ограничение **Tizen**, обойти нельзя.', 'user': {'login': 'sunic007'},
                     'author_association': 'OWNER'}]
        sent = bot.notify(self.event('not_planned', ('from-telegram', 'enhancement')), self.gh(comments), tg, self.REPO)
        self.assertEqual([m['msg'] for m in sent], [77, 80])
        texts = [p['text'] for p in tg.sent()]
        self.assertEqual(texts[0], 'Спасибо за предложение! Пока не планируем: Это ограничение Tizen, обойти нельзя. '
                                   '(<a href="https://github.com/sunic007/lampa-samsung/issues/9">№9</a>)')
        self.assertTrue(texts[1].startswith('Thanks for the suggestion! Not planned for now: '))
        self.assertNotIn('reply_markup', tg.sent()[0])

    def test_skips(self):
        tg = FakeTG()
        self.assertEqual(bot.notify(self.event(labels=('bug',)), self.gh(), tg, self.REPO), [])
        self.assertEqual(bot.notify(self.event('duplicate'), self.gh(), tg, self.REPO), [])
        self.assertEqual(bot.notify(self.event(body='no marker'), self.gh(), tg, self.REPO), [])
        done = [{'body': 'Сообщено\n<!-- tg-notified:completed:2026-10-17T10:00:00Z -->'}]
        self.assertEqual(bot.notify(self.event(), self.gh(done), tg, self.REPO), [])
        reopened = [{'body': 'Сообщено\n<!-- tg-notified:completed:2026-10-01T10:00:00Z -->'}]   # закрыли повторно
        self.assertEqual(len(bot.notify(self.event(), self.gh(reopened), FakeTG(), self.REPO)), 1)
        self.assertEqual(bot.notify(self.event(), self.gh(), tg, 'evil/repo'), [])
        self.assertEqual(bot.notify(self.event(), self.gh(), tg, self.REPO, allowed_chats={'-1'}), [])
        self.assertEqual(tg.sent(), [])



class NetworkErrors(unittest.TestCase):
    def test_timeout_is_status_zero(self):
        old = bot.urllib.request.urlopen

        def boom(*a, **k):
            raise TimeoutError('The read operation timed out')
        bot.urllib.request.urlopen = boom
        try:
            self.assertEqual(bot.Http().request('POST', 'https://example.invalid/x', body={}), (0, None, {}))
        finally:
            bot.urllib.request.urlopen = old

    def test_llm_timeout_falls_to_next_model(self):
        class H:
            calls = []

            def request(self, method, url, headers=None, body=None, timeout=40, raw=False):
                self.calls.append(body['model'])
                if len(self.calls) == 1:
                    return 0, None, {}
                return 200, {'choices': [{'message': {'content': '{"ok":true}'}}]}, {}
        h = H()
        self.assertEqual(bot.LLM('AIzaTEST', h).chat([]), '{"ok":true}')
        self.assertEqual(len(h.calls), 2)



class DailyLimits(unittest.TestCase):
    Q = {'kind': 'question', 'product': 'lampa', 'lang': 'ru', 'title': 'Вопрос', 'answer': 'Ответ'}

    def test_user_limit_switches_to_rules(self):
        llm = FakeLLM(*[self.Q] * 30)
        b = make_bot(FakeTG(), FakeGH(), llm)
        b.state['u']['42'] = bot.LLM_PER_USER_DAY
        b.handle_message(msg('Как установить Lampa на телевизор?'))
        self.assertEqual(llm.calls, 0)
        b.handle_message(msg('Как установить Lampa на телевизор?', user=7))
        self.assertEqual(llm.calls, 1)

    def test_daily_limit_switches_to_rules(self):
        llm = FakeLLM(self.Q)
        b = make_bot(FakeTG(), FakeGH(), llm)
        b.state['llm'] = bot.LLM_PER_DAY
        b.handle_message(msg('Как установить Lampa на телевизор?'))
        self.assertEqual(llm.calls, 0)

    def test_state_from_other_day_is_reset(self):
        b = bot.Bot(FakeTG(), FakeGH(), FakeLLM(), now=lambda: NOW,
                    state={'day': '2000-01-01', 'llm': 999, 'u': {'42': 99}, 't': {'42': 9}})
        self.assertEqual((b.state['llm'], b.state['u'], b.state['t']), (0, {}, {}))
        today = b.state['day']
        b = bot.Bot(FakeTG(), FakeGH(), FakeLLM(), now=lambda: NOW, state={'day': today, 'llm': 5, 'u': {}, 't': {}})
        self.assertEqual(b.state['llm'], 5)

    def test_issue_limit_per_day(self):
        gh = FakeGH()
        b = make_bot(FakeTG(), gh, FakeLLM({'kind': 'bug', 'product': 'lampa', 'lang': 'ru', 'title': 'Сломалось'}))
        b.state['t']['42'] = bot.ISSUES_PER_USER_DAY
        b.handle_message(msg('Lampa не запускается после обновления'))
        self.assertEqual(b.issues, 0)

    def test_requests_are_spaced(self):
        waits, clock = [], [100.0]

        class H:
            def request(self, *a, **k):
                return 200, {'choices': [{'message': {'content': '{}'}}]}, {}
        llm = bot.LLM('AIzaTEST', H(), sleep=waits.append, gap=5, clock=lambda: clock[0])
        llm.chat([])
        clock[0] += 1
        llm.chat([])
        self.assertEqual(waits, [4.0])
        self.assertEqual(llm.sent, 2)



class DoneNote(unittest.TestCase):
    def c(self, body, assoc='OWNER'):
        return {'body': body, 'author_association': assoc}

    def test_owner_reply_goes_to_group(self):
        note = bot.done_note([self.c('Ответ: включите в «Настройки → Sunic Apps → Интерфейс».'), self.c('технический комментарий')])
        self.assertEqual(note, 'включите в «Настройки → Sunic Apps → Интерфейс».')

    def test_strangers_and_bot_markers_are_ignored(self):
        self.assertEqual(bot.done_note([self.c('Ответ: реклама', 'NONE'), self.c('Ответ: x <!-- tg:chat=1;msg=2 -->')]), '')
        self.assertEqual(bot.done_note([self.c('просто комментарий')]), '')

    def test_note_is_escaped_in_message(self):
        text = bot.done_text('ru', 'Мультики', ('in', '2.2.0', 'https://x'), None, 'нажмите <b>ОК</b>')
        self.assertIn('нажмите &lt;b&gt;ОК&lt;/b&gt;', text)
        self.assertLess(text.index('нажмите'), text.index('2.2.0'))



class Serve(unittest.TestCase):
    def test_long_poll_handles_and_acks(self):
        clock = [0.0]

        class TG(FakeTG):
            def __init__(self):
                super().__init__()
                self.polls = []

            def call(self, method, **p):
                if method == 'getUpdates':
                    self.polls.append(p)
                    clock[0] += 30
                    if len(self.polls) == 1:
                        return [{'update_id': 7, 'message': msg('Всем привет!')}]
                    return []
                return super().call(method, **p)
        tg = TG()
        b = make_bot(tg, FakeGH(), FakeLLM({'kind': 'other'}))
        n = b.serve(100, clock=lambda: clock[0], sleep=lambda s: None)
        self.assertEqual(n, 1)
        self.assertEqual(tg.polls[0]['timeout'], 50)
        self.assertEqual(tg.polls[1].get('offset'), 8)          # следующий круг подтверждает обработанное
        self.assertEqual(tg.polls[-1]['offset'], 8)

    def test_new_day_resets_counters(self):
        b = make_bot(FakeTG(), FakeGH(), FakeLLM())
        b.state = {'day': '2000-01-01', 'llm': 500, 'u': {'1': 20}, 't': {}}
        b.roll_day()
        self.assertEqual((b.state['llm'], b.state['u']), (0, {}))

    def test_private_id_command(self):
        tg = FakeTG()
        b = make_bot(tg, FakeGH(), FakeLLM())
        b.handle_message({'message_id': 1, 'date': NOW, 'chat': {'id': 555, 'type': 'private'}, 'text': '/id', 'from': {'id': 555}})
        self.assertTrue(any('555' in str(x) for x in tg.sent()))



class AndroidProduct(unittest.TestCase):
    def test_kb_has_android_block(self):
        kb = bot.build_kb('## Установка\nТВ', '## 2.2.4 — x\n- a', '## TVI\nt', '', '## Установка\nНастройки → Расширения', '## 2.2.4 — п\n- b')
        self.assertIn('ANDROID', kb)
        self.assertIn('Расширения', kb)

    def test_keywords_android(self):
        self.assertEqual(bot.keyword_classify('Плагин на Lampa BS не грузится, ошибка')['product'], 'android')
        self.assertEqual(bot.keyword_classify('TV Installer не видит телевизор, ошибка')['product'], 'tvinstaller')

    def test_android_issue_goes_to_lampa_samsung(self):
        self.assertEqual(make_bot().repo_for('android'), 'sunic007/lampa-samsung')
        self.assertEqual(bot.parse_classification('{"kind":"bug","product":"android","lang":"ru","title":"x"}', 'x')['product'], 'android')


if __name__ == '__main__':
    unittest.main()
