(function () {
  var T = {
    uz: {
      h1: 'Barcha filmlar va seriallar — televizoringizda',
      sub: 'Sunic Apps bilan Lampa: keyingi qismni o\'zi yoqadi, filmni barcha manbalardan topadi, qidirishni esa telefondan Telegram orqali qilish mumkin.',
      cta_tv: 'Televizorga qanday o‘rnatiladi', cta_web: 'Ko‘rish',
      tab_tv: '📺 Har qanday Smart TV', tab_tv_s: 'Samsung, LG, Android TV — Media Station X', tab_phone: '📱 Samsung uchun ilova', tab_phone_s: 'telefondan — TV Installer',
      tab_android: '🤖 Android TV / pristavka', tab_android_s: 'Lampa uchun plagin', tab_web: '💻 Brauzerda', tab_web_s: 'kompyuter yoki telefon',
      tv_h: 'Har qanday Smart TV — Media Station X', tv_1: 'Televizorning ilovalar do‘konidan Media Station X ni o‘rnating — Samsung, LG, Android TV va boshqalarda bor.',
      tv_2: 'Uni oching: Settings → Start Parameter → Setup.', tv_3: 'Manzilni kiriting va tasdiqlang:', tv_4: 'Tayyor: Media Station X har ochilganda Sunic Apps bilan Lampa darhol ishga tushadi.',
      tv_note: 'Dasturchi rejimi va kompyuter kerak emas. Skaz manbalari CUB ga kirgandan keyin ishlaydi (Sozlamalar → Akkaunt); kirmasdan — Online Mod va Z01.',
      ph_h: 'Samsung: televizorga o‘z ilovasi — TV Installer', ph_1: 'TV Installer ni Android telefonga yuklab oling (QR-kod yoki pastdagi tugma).',
      ph_2: 'Telefon va televizor bitta Wi-Fi tarmog‘ida; televizorda bir marta dasturchi rejimini yoqing (TV Installer ko‘rsatadi).', ph_3: 'Lampa ni tanlang — bir necha daqiqada u televizorda. Bu eng to‘liq versiya: televizor ovozi, Smart Hub paneli, «Uyqu» ilovani yopadi.',
      ph_btn: 'TV Installer ni yuklab olish', ph_qr: 'Telefon kamerasini qarating',
      an_h: 'Android TV, pristavka yoki telefon — Lampa uchun plagin', an_1: 'Lampa ni oching → Sozlamalar → Kengaytmalar → Plagin qo‘shish.', an_2: 'Manzilni qo‘ying:',
      an_3: 'Lampa ni qayta ishga tushiring — «Sunic Apps» bo‘limi paydo bo‘ladi.', copy: 'Nusxalash', copied: 'Nusxalandi',
      web_h: 'Brauzerda', web_p: 'Lampa shu saytning o‘zida ochiladi — kompyuter yoki telefonda.',
      web_http_btn: 'http orqali ochish — Skaz bilan', web_http_note: '⚠️ O‘z xavfingizga: ulanish himoyalanmagan (http) — brauzer sayt «himoyalanmagan» deb ogohlantiradi. Faqat Skaz manbalari uchun kerak; u yerda parol va karta ma’lumotlarini kiritmang. http va https uchun sozlamalar va tarix alohida.',
      web_note: 'Himoyalangan ulanishda (https) Online Mod va Z01 ishlaydi; Skaz — televizorda, Media Station X da yoki http orqali (yuqoridagi tugma): uning serverlari https ni qo‘llamaydi.',
      trust_h: 'Nega ishonsa bo‘ladi', trust_ver: 'oxirgi versiya', trust_src: 'Ochiq kod', trust_reg: 'Ro‘yxatdan o‘tmasdan', trust_reg_s: 'va bizdan reklamasiz',
      trust_chk: 'Sayt tekshiriladi', trust_chk_s: 'har 30 daqiqada: fayllar GitHub bilan bir xil',
      faq_tg: '💬 Telegram’da yordam', faq_tg_s: 'Sunic Apps guruhi: savollar, yordam va yangi versiyalar',
      faq_h: 'Savollar', q1: 'Dasturchi rejimi kerakmi?', a1: 'Media Station X uchun — yo‘q. TV Installer orqali o‘rnatish uchun — bir marta, ilova ko‘rsatadi.',
      q2: 'Nega manbalar yo‘q yoki «kirish yo‘q»?', a2: 'Skaz manbalariga CUB ga kirish kerak (Sozlamalar → Akkaunt, cub.red da kod). Kirmasdan «Ko‘rish» filmni Online Mod va Z01 dan o‘zi qidiradi.',
      q3: '«Video topilmadi» — nima qilish kerak?', a3: 'Sunic Apps boshqa balanserlar va manbalarni o‘zi sinab ko‘radi. Film hech qayerda bo‘lmasa — hali yaxshi sifatda chiqmagan, keyinroq urinib ko‘ring.',
      q4: 'Bu xavfsizmi?', a4: 'Ha: kod ochiq, biz shaxsiy ma’lumotlarni yig‘maymiz. Lampa va manbalar — uchinchi tomon xizmatlari; filmlarni biz saqlamaymiz va tarqatmaymiz.',
      q5: 'Ishlamayapti — qayerga yozish kerak?', a5: 't.me/sunicapps guruhiga yoki Sunic Apps sozlamalaridagi «Muammo haqida xabar berish» tugmasi orqali — hisobot o‘zi yuboriladi.',
      foot: 'Savollar', notsam: 'televizor ishlab chiqaruvchilari va Media Station X bilan bog‘liq emas; logotiplar — egalarining tovar belgilari', st_ok: 'ishlaydi', st_slow: 'sekin', st_bad: 'javob bermayapti', news: 'Yangi:',
      st_cub: 'Katalog (CUB)', st_skaz_api: 'Skaz serverlari', st_github: 'Yangilanishlar (GitHub)',
      nav_f: 'Imkoniyatlar',
      nav_s: 'Boshlash',
      nav_q: 'Savollar',
      eyebrow: 'Bepul · ro\'yxatdan o\'tmasdan · bizdan reklamasiz',
      cta_start: '2 daqiqada boshlash',
      pl_line: 'Samsung · LG · Android TV · telefon · kompyuter',
      art_next: 'Keyingi qism 5 dan keyin',
      art_q: 'Dyuna',
      art_found: 'Topildi ✓',
      art_play: '▶ Televizorda ko\'rish',
      f_h: 'Sunic Apps nimalar qiladi',
      f1: 'Keyingi qism — o\'zi',
      f1d: 'Tugadi — keyingi qism, fasl tugagach — yangi fasl yoqiladi.',
      f2: 'Barcha manbalardan qidiradi',
      f2d: 'Bitta manbada yo\'q bo\'lsa — boshqasidan, hatto siz qo\'shganlaridan ham topadi.',
      f3: 'Telefon — pult o\'rnida',
      f3d: 'Telegram-botda filmni topdingiz — «Ko\'rish»ni bosdingiz, u allaqachon televizorda.',
      f4: 'To\'xtagan joydan',
      f4d: 'To\'xtagan joyingizdan, o\'sha ovoz bilan davom etadi.',
      f5: 'Qotib qolmaydi',
      f5d: 'Video to\'xtadi — o\'zi qayta ishga tushiradi, sifat yoki manbani almashtiradi.',
      f6: 'Kechqurun qulay',
      f6d: '«Hali ko\'ryapsizmi?», qismdan keyin uyqu, tunda ovoz baland emas.',
      s_h: 'Boshlash — 3 qadam',
      s1: 'Quyida qurilmangizni tanlang',
      s2: 'Manzilni kiriting yoki ilovani o\'rnating',
      s3: 'Ko\'ring — qolganini Sunic Apps o\'zi qiladi',
      pl_h: 'Siz ko\'radigan joyda ishlaydi',
      pl_phone: 'Android telefon',
      pl_web: 'Kompyuter va iPhone',
      pl_s_sam: 'O‘z ilovasi — to‘liq versiya', pl_s_msx: 'Media Station X orqali', pl_s_msx2: 'Media Station X orqali',
      pl_s_atv: 'Media Station X yoki plagin', pl_s_phone: 'Lampa uchun plagin', pl_s_web: 'To‘g‘ridan-to‘g‘ri brauzerda',
      fin_h: 'Bugun kechqurun ko\'rishni boshlang',
      fin_p: 'O\'rnatishga ikki daqiqa — va hammasi o\'zi ishlaydi.',
      fin_tg: 'Telegramda so\'rash',
      credits: 'Rasmlar va posterlarda — Blender Foundation filmlari (CC BY), blender.org'
    },
    en: {
      h1: 'All movies and series — on your TV',
      sub: 'Lampa with Sunic Apps: plays the next episode by itself, finds a movie in every source, and you can search from your phone in Telegram.',
      cta_tv: 'How to install on a TV', cta_web: 'Watch',
      tab_tv: '📺 Any Smart TV', tab_tv_s: 'Samsung, LG, Android TV — Media Station X', tab_phone: '📱 App for Samsung', tab_phone_s: 'from your phone — TV Installer',
      tab_android: '🤖 Android TV / box', tab_android_s: 'plugin for Lampa', tab_web: '💻 In the browser', tab_web_s: 'computer or phone',
      tv_h: 'Any Smart TV — Media Station X', tv_1: 'Install <b>Media Station X</b> from your TV app store — it is on Samsung, LG, Android TV and others.',
      tv_2: 'Open it: <b>Settings → Start Parameter → Setup</b>.', tv_3: 'Enter the address and confirm:', tv_4: 'Done: every time you open Media Station X, Lampa with Sunic Apps starts right away.',
      tv_note: 'No developer mode or computer needed. Skaz sources work after signing in to CUB (Settings → Account); without it — Online Mod and Z01.',
      ph_h: 'Samsung: its own app on the TV — TV Installer', ph_1: 'Download TV Installer to your Android phone (QR code or the button below).',
      ph_2: 'Phone and TV on the same Wi-Fi; turn on developer mode on the TV once (TV Installer shows how).', ph_3: 'Choose Lampa — in a couple of minutes it is on the TV. This is the fullest version: TV volume, Smart Hub panel, «Sleep» closes the app.',
      ph_btn: 'Download TV Installer', ph_qr: 'Point your phone camera',
      an_h: 'Android TV, box or phone — plugin for Lampa', an_1: 'Open Lampa (Lampa BS or another build) → Settings → Extensions → Add plugin.', an_2: 'Paste the address:',
      an_3: 'Restart Lampa — the «Sunic Apps» section appears.', copy: 'Copy', copied: 'Copied',
      web_h: 'In the browser', web_p: 'Lampa opens right on this site — on a computer or phone.',
      web_http_btn: 'Open over http — with Skaz', web_http_note: '⚠️ At your own risk: the connection is not protected (http) — the browser will warn that the site is «not secure». Only needed for Skaz sources; do not enter passwords or card details there. Settings and history are separate for http and https.',
      web_note: 'Over a secure connection (https) Online Mod and Z01 work; Skaz — on TVs, in Media Station X or over http (button above): its servers do not support https.',
      trust_h: 'Why you can trust it', trust_ver: 'latest version', trust_src: 'Open source', trust_reg: 'No sign-up', trust_reg_s: 'and no ads from us',
      trust_chk: 'The site is checked', trust_chk_s: 'every 30 minutes: files match GitHub',
      faq_tg: '💬 Help in Telegram', faq_tg_s: 'The Sunic Apps group: questions, help and new versions',
      faq_h: 'Questions', q1: 'Do I need developer mode?', a1: 'For Media Station X — no. For installing via TV Installer — once, the app shows how.',
      q2: 'Why no sources or «no access»?', a2: 'Skaz sources need a CUB sign-in (Settings → Account, code at cub.red). Without it «Watch» looks for the movie in Online Mod and Z01 by itself.',
      q3: '«Video not found» — what to do?', a3: 'Sunic Apps tries other balancers and sources by itself. If the movie is nowhere — it is not out in good quality yet, try later.',
      q4: 'Is it safe?', a4: 'Yes: the code is open, we do not collect personal data. Lampa and the sources are third-party services; we do not store or share movies.',
      q5: 'Not working — where to write?', a5: 'To the t.me/sunicapps group or with «Report a problem» in Sunic Apps settings — the report is sent by itself.',
      foot: 'Questions', notsam: 'not affiliated with TV makers or Media Station X; logos are trademarks of their owners', st_ok: 'works', st_slow: 'slow', st_bad: 'not responding', news: 'New:',
      st_cub: 'Catalog (CUB)', st_skaz_api: 'Skaz servers', st_github: 'Updates (GitHub)',
      nav_f: 'Features',
      nav_s: 'Get started',
      nav_q: 'FAQ',
      eyebrow: 'Free · no sign-up · no ads from us',
      cta_start: 'Start in 2 minutes',
      pl_line: 'Samsung · LG · Android TV · phone · computer',
      art_next: 'Next episode in 5',
      art_q: 'Dune',
      art_found: 'Found ✓',
      art_play: '▶ Watch on TV',
      f_h: 'What Sunic Apps does',
      f1: 'Next episode — by itself',
      f1d: 'Finished — the next episode starts, and after the season — the new season.',
      f2: 'Searches every source',
      f2d: 'Not in one source — it finds it in another, even in the ones you added.',
      f3: 'Your phone as a remote',
      f3d: 'Found a movie in the Telegram bot — tap «Watch» and it is already on the TV.',
      f4: 'Right where you stopped',
      f4d: 'Continues where you left off, with the same dub.',
      f5: 'Does not freeze',
      f5d: 'Video stalled — it restarts, changes quality or source by itself.',
      f6: 'Made for evenings',
      f6d: '«Are you still watching?», sleep after the episode, no louder at night.',
      s_h: 'Get started — 3 steps',
      s1: 'Choose your device below',
      s2: 'Enter the address or install the app',
      s3: 'Watch — Sunic Apps does the rest',
      pl_h: 'Works wherever you watch',
      pl_phone: 'Android phone',
      pl_web: 'Computer and iPhone',
      pl_s_sam: 'Own app — the full version', pl_s_msx: 'Via Media Station X', pl_s_msx2: 'Via Media Station X',
      pl_s_atv: 'Media Station X or a plugin', pl_s_phone: 'A plugin for Lampa', pl_s_web: 'Right in the browser',
      fin_h: 'Start watching tonight',
      fin_p: 'Two minutes to set up — and everything works by itself.',
      fin_tg: 'Ask in Telegram',
      credits: 'Screenshots and posters show Blender Foundation films (CC BY), blender.org'
    },
    ru: { news: 'Что нового:', copied: 'Скопировано', st_ok: 'работает', st_slow: 'медленно', st_bad: 'не отвечает' }
  };
  var ru = {};
  document.querySelectorAll('[data-t]').forEach(function (e) { ru[e.getAttribute('data-t')] = e.innerHTML; });
  var lang = 'ru';
  try {
    var nl = (navigator.language || '').toLowerCase().slice(0, 2);
    lang = localStorage.getItem('lang') || (nl === 'uz' ? 'uz' : /^(ru|uk|be|kk|ky|tg)$/.test(nl) || !nl ? 'ru' : 'en');
  } catch (e) {}
  if (!T[lang] && lang !== 'ru') lang = 'ru';
  function t(k) { return (T[lang] && T[lang][k]) || T.ru[k] || ru[k] || k; }
  function setLang(l) {
    lang = l; document.documentElement.lang = l;
    try { localStorage.setItem('lang', l); } catch (e) {}
    document.querySelectorAll('[data-t]').forEach(function (e) { var k = e.getAttribute('data-t'); e.innerHTML = l === 'ru' ? ru[k] : (T[l][k] || ru[k]); });
    document.querySelectorAll('[data-lang]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-lang') === l); });
    status(); version();
  }
  document.querySelectorAll('[data-lang]').forEach(function (b) { b.onclick = function () { setLang(b.getAttribute('data-lang')); }; });

  // какое устройство — тот способ первым
  var ua = navigator.userAgent || '';
  var dev = /SMART-TV|Tizen|Web0S|SmartTV/i.test(ua) ? 'tv' : /Android/i.test(ua) ? (/Mobile/i.test(ua) ? 'phone' : 'android') : /iPhone|iPad/i.test(ua) ? 'web' : 'web';
  function tab(id) {
    document.querySelectorAll('[data-tab]').forEach(function (b) { var on = b.getAttribute('data-tab') === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    document.querySelectorAll('[data-pane]').forEach(function (p) { p.classList.toggle('on', p.getAttribute('data-pane') === id); });
  }
  document.querySelectorAll('[data-tab]').forEach(function (b) { b.onclick = function () { tab(b.getAttribute('data-tab')); }; });
  tab(dev === 'web' ? 'tv' : dev);

  document.querySelectorAll('[data-copy]').forEach(function (b) {
    b.onclick = function () {
      var s = document.getElementById(b.getAttribute('data-copy')).textContent;
      var done = function () { b.textContent = t('copied'); setTimeout(function () { b.textContent = t('copy'); }, 2000); };
      if (navigator.clipboard) navigator.clipboard.writeText(s).then(done, done); else done();
    };
  });

  var stData = null;
  function status() {
    var box = document.getElementById('status');
    if (!stData) return;
    box.innerHTML = '';
    stData.items.forEach(function (i) {
      var s = document.createElement('span');
      s.className = i.ok ? (i.slow ? 'slow' : 'ok') : 'bad';
      s.textContent = (lang === 'ru' ? i.name : t('st_' + i.id) !== 'st_' + i.id ? t('st_' + i.id) : i.name) + ' — ' + t(i.ok ? (i.slow ? 'st_slow' : 'st_ok') : 'st_bad');
      box.appendChild(s);
    });
  }
  var x = new XMLHttpRequest();
  x.open('GET', '/status.php', true);
  x.onload = function () { try { stData = JSON.parse(x.responseText); status(); } catch (e) {} };
  x.send();

  var verData = null;
  function version() {
    if (!verData) return;
    var d = verData.date ? new Date(verData.date) : null;
    var mon = lang === 'en' ? ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
      : lang === 'uz' ? ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr']
      : ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    document.getElementById('ver').textContent = verData.v + (d ? ' · ' + (lang === 'en' ? mon[d.getMonth()] + ' ' + d.getDate() : d.getDate() + ' ' + mon[d.getMonth()]) : '');
    var n = verData.notes;
    document.getElementById('news').innerHTML = n && n.title ? t('news') + ' <b>' + esc(n.title) + '</b>' : '';
  }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function getJSON(urls, cb) {
    (function next(i) {
      if (i >= urls.length) return cb(null);
      var r = new XMLHttpRequest();
      r.open('GET', urls[i], true); r.timeout = 8000;
      r.onload = function () { var j = null; try { j = JSON.parse(r.responseText); } catch (e) {} if (r.status === 200 && j) cb(j); else next(i + 1); };
      r.onerror = r.ontimeout = function () { next(i + 1); };
      r.send();
    })(0);
  }
  getJSON(['https://raw.githubusercontent.com/sunic007/lampa-samsung/main/version.json', 'https://cdn.jsdelivr.net/gh/sunic007/lampa-samsung@main/version.json'], function (m) {
    if (!m) return;
    verData = { v: m.version, notes: m.notes };
    version();
    getJSON(['https://api.github.com/repos/sunic007/lampa-samsung/releases/latest'], function (r) { if (r && r.published_at) { verData.date = r.published_at; version(); } });
  });
  setLang(lang);
  document.documentElement.className += ' ready';
})();
