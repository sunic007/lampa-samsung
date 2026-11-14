# Онлайн-источники: проверка 2026-11-14

_Отчёт `tools/sources_scan.py`. Код плагинов не выполнялся — только прочитан. В Lampa ничего не добавлено:_
_новый источник подключается только после проверки на ТВ и «да» владельца._

## Наши источники

| Источник | Адреса | Итог |
|---|---|---|
| Z01 | ✅ https://z01.online/live (0.74 с), ✅ http://z01.online/live (0.49 с) | работает |
| Online Mod | ✅ https://nb557.github.io/plugins/online_mod.js (0.11 с), ✅ http://nb557.github.io/plugins/online_mod.js (0.22 с), ✅ https://nb557.surge.sh/online_mod.js (0.15 с), ✅ http://nb557.surge.sh/online_mod.js (0.14 с) | работает |
| VOD (llpp.in) | ❌ https://llpp.in/v/vod.js (20.04 с), ❌ http://llpp.in/v/vod.js (20.04 с) | **не отвечает (2 раз подряд)** |
| Lordfilm | ✅ https://cdn.jsdelivr.net/gh/lenorio/lenorio@79710d2b24b5633265e9905684700e5bd4bf5724/plugins/lordfilm.js (0.14 с), ✅ https://fastly.jsdelivr.net/gh/lenorio/lenorio@79710d2b24b5633265e9905684700e5bd4bf5724/plugins/lordfilm.js (0.37 с), ✅ https://gcore.jsdelivr.net/gh/lenorio/lenorio@79710d2b24b5633265e9905684700e5bd4bf5724/plugins/lordfilm.js (0.4 с) | работает |
| Showy без регистрации | ✅ http://smotret24.ru/online.js (4.31 с), ✅ http://smotret24.com/online.js (2.03 с) | работает |
| MODS's | ✅ https://lampa.stream/modss (0.67 с), ✅ http://lampa.stream/modss (0.64 с), ✅ http://modss.tv (0.33 с) | работает |

**Не отвечают:** VOD (llpp.in)

## Кандидаты с GitHub (лучшие)

Счёт: живые серверы, свежесть, звёзды; минус — запутанный код, вход, копия Online Mod, KinoPub/Filmix-аккаунт, реклама, украинские источники.

| Счёт | Новый | Плагин | Обновлён | Живые серверы | Пометки |
|---|---|---|---|---|---|
| 6 |  | [GideonWhite1029/lampa-desktop/src/plugins/online.js](https://github.com/GideonWhite1029/lampa-desktop/blob/HEAD/src/plugins/online.js) `https://cdn.jsdelivr.net/gh/GideonWhite1029/lampa-desktop@main/src/plugins/online.js` | 2026-11-12 | api.delivembd.ws, cdnmovies.net, filmix.ac, filmixapp.cyou | вход/подписка, свой аккаунт Filmix |
| 5 |  | [imjamoe1/imjamoe1.github.io/online_pro.js](https://github.com/imjamoe1/imjamoe1.github.io/blob/HEAD/online_pro.js) `https://imjamoe1.github.io/online_pro.js` | 2026-11-08 | beta.mitsu.tv | — |
| 4 | 🆕 | [olgyvsyv-lang/lampa-rezka-tizen/rezka_samsung_compat.js](https://github.com/olgyvsyv-lang/lampa-rezka-tizen/blob/HEAD/rezka_samsung_compat.js) `https://cdn.jsdelivr.net/gh/olgyvsyv-lang/lampa-rezka-tizen@main/rezka_samsung_compat.js` | 2026-11-13 | a.mp, corsproxy.io, hdrezka.ag | вход/подписка |
| 3 |  | [entropious/lampa-online/online.js](https://github.com/entropious/lampa-online/blob/HEAD/online.js) `https://cdn.jsdelivr.net/gh/entropious/lampa-online@main/online.js` | 2026-11-06 | anilibria.top, lam.akter-black.com, lam.maxvol.pro, rc.bwa.ad | вход/подписка, реклама, загрузчик Lampac |
| 3 |  | [GideonWhite1029/lampa-desktop/src/plugins/online_prestige.js](https://github.com/GideonWhite1029/lampa-desktop/blob/HEAD/src/plugins/online_prestige.js) `https://cdn.jsdelivr.net/gh/GideonWhite1029/lampa-desktop@main/src/plugins/online_prestige.js` | 2026-11-12 | api.delivembd.ws, filmix.ac, filmixapp.cyou, kinobase.org | вход/подписка, свой аккаунт Filmix, украинские источники |
| 2 |  | [war100ck/war100ck.github.io/Lampa/plugins/online.js](https://github.com/war100ck/war100ck.github.io/blob/HEAD/Lampa/plugins/online.js) `https://war100ck.github.io/Lampa/plugins/online.js` | 2026-09-15 | api.delivembd.ws, cdnmovies.net, filmix.ac, filmixapp.cyou | вход/подписка, свой аккаунт Filmix |
| 2 |  | [datalabMD/lampa-plugins/rezka2.js](https://github.com/datalabMD/lampa-plugins/blob/HEAD/rezka2.js) `https://cdn.jsdelivr.net/gh/datalabMD/lampa-plugins@main/rezka2.js` | 2026-10-22 | kvk.pub, lampa.datalab.md | вход/подписка |
| 2 |  | [VitaliyPA/Pages/filmix.js](https://github.com/VitaliyPA/Pages/blob/HEAD/filmix.js) `https://cdn.jsdelivr.net/gh/VitaliyPA/Pages@main/filmix.js` | 2026-10-28 | back.freebie.tom.ru, cf.freebie.tom.ru, filmix.ac, filmixapp.cyou | вход/подписка, KinoPub (платно), свой аккаунт Filmix |
| 1 | 🆕 | [Kirill9732/Alcopac_docker/app/wwwroot/plugins/prestige.js](https://github.com/Kirill9732/Alcopac_docker/blob/HEAD/app/wwwroot/plugins/prestige.js) `https://cdn.jsdelivr.net/gh/Kirill9732/Alcopac_docker@main/app/wwwroot/plugins/prestige.js` | 2026-05-12 | api.delivembd.ws, filmix.ac, filmixapp.cyou, kinopoiskapiunofficial.tech | вход/подписка, свой аккаунт Filmix, украинские источники |
| 1 |  | [you-oops-dev/lampa_plugins_mods_sync/o.js](https://github.com/you-oops-dev/lampa_plugins_mods_sync/blob/HEAD/o.js) `https://cdn.jsdelivr.net/gh/you-oops-dev/lampa_plugins_mods_sync@main/o.js` | 2026-10-27 | online3.skaz.tv, online4.skaz.tv, online5.skaz.tv, skaztv.top | реклама, KinoPub (платно), свой аккаунт Filmix, украинские источники |
| 1 |  | [cevamnelampaplagin/tytnemanichogodobrogo/smarton.js](https://github.com/cevamnelampaplagin/tytnemanichogodobrogo/blob/HEAD/smarton.js) `https://cdn.jsdelivr.net/gh/cevamnelampaplagin/tytnemanichogodobrogo@main/smarton.js` | 2026-11-05 | lampaua.mooo.com | реклама, украинские источники, загрузчик Lampac |
| 1 |  | [max-lampa/MAX/smartt.js](https://github.com/max-lampa/MAX/blob/HEAD/smartt.js) `https://cdn.jsdelivr.net/gh/max-lampa/MAX@main/smartt.js` | 2026-11-09 | beta.l-vid.online | реклама, украинские источники, загрузчик Lampac |
| 1 |  | [max-lampa/MAX/smartmod.js](https://github.com/max-lampa/MAX/blob/HEAD/smartmod.js) `https://cdn.jsdelivr.net/gh/max-lampa/MAX@main/smartmod.js` | 2026-11-09 | bwa.ad | реклама, украинские источники, загрузчик Lampac |
| 1 |  | [max-lampa/MAX/smartonline_modified.js](https://github.com/max-lampa/MAX/blob/HEAD/smartonline_modified.js) `https://cdn.jsdelivr.net/gh/max-lampa/MAX@main/smartonline_modified.js` | 2026-11-09 | bwa.ad | реклама, украинские источники, загрузчик Lampac |
| 1 |  | [voipoddsns/voipoddsns.github.io/plugins/lampa_plugins/o.js](https://github.com/voipoddsns/voipoddsns.github.io/blob/HEAD/plugins/lampa_plugins/o.js) `https://voipoddsns.github.io/plugins/lampa_plugins/o.js` | 2026-11-12 | online3.skaz.tv, online4.skaz.tv, online5.skaz.tv, online7.skaz.tv | реклама, KinoPub (платно), свой аккаунт Filmix, украинские источники |
| 0 |  | [alexlulchak/alexlulchak/rezka.js](https://github.com/alexlulchak/alexlulchak/blob/HEAD/rezka.js) `https://cdn.jsdelivr.net/gh/alexlulchak/alexlulchak@main/rezka.js` | 2026-09-12 | rezka.fi, your-proxy.com | вход/подписка, копия Online Mod |
| 0 |  | [mailinternetx-sudo/plugins1/4.js](https://github.com/mailinternetx-sudo/plugins1/blob/HEAD/4.js) `https://cdn.jsdelivr.net/gh/mailinternetx-sudo/plugins1@main/4.js` | 2026-09-21 | beta.mitsu.tv, my-proxy-worker.mail-internetx.workers.dev | свой аккаунт Filmix, украинские источники, загрузчик Lampac |
| 0 |  | [aa1286901/aa1286901.github.io/kp/showy.js](https://github.com/aa1286901/aa1286901.github.io/blob/HEAD/kp/showy.js) `https://aa1286901.github.io/kp/showy.js` | 2026-11-09 | showy.online | KinoPub (платно), украинские источники |
| 0 |  | [lampaplugins/store/fx.js](https://github.com/lampaplugins/store/blob/HEAD/fx.js) `https://cdn.jsdelivr.net/gh/lampaplugins/store@main/fx.js` | 2026-11-11 | cors.jacred.stream, filmix.my, filmixapp.vip | вход/подписка, свой аккаунт Filmix, украинские источники |
| 0 |  | [serg-kara/plugin/showy.js](https://github.com/serg-kara/plugin/blob/HEAD/showy.js) `https://cdn.jsdelivr.net/gh/serg-kara/plugin@main/showy.js` | 2026-11-13 | showy.online | KinoPub (платно), украинские источники |
| -1 |  | [Kirill9732/Alcopac_docker/app/wwwroot/plugins/fx.js](https://github.com/Kirill9732/Alcopac_docker/blob/HEAD/app/wwwroot/plugins/fx.js) `https://cdn.jsdelivr.net/gh/Kirill9732/Alcopac_docker@main/app/wwwroot/plugins/fx.js` | 2026-05-12 | filmix.my, filmixapp.vip | вход/подписка, свой аккаунт Filmix, украинские источники |
| -1 |  | [Dzhinn/iptv/onlines.js](https://github.com/Dzhinn/iptv/blob/HEAD/onlines.js) `https://cdn.jsdelivr.net/gh/Dzhinn/iptv@main/onlines.js` | 2026-05-23 | online3.skaz.tv, online4.skaz.tv, online5.skaz.tv, online7.skaz.tv | реклама, KinoPub (платно), свой аккаунт Filmix, украинские источники |
| -1 |  | [gorshkovkv/gorshkovkv.github.io/scr/showww.js](https://github.com/gorshkovkv/gorshkovkv.github.io/blob/HEAD/scr/showww.js) `https://gorshkovkv.github.io/scr/showww.js` | 2026-08-09 | cdnjs.cloudflare.com, cdnmovies.net, showy.online | вход/подписка, бот Telegram, KinoPub (платно), свой аккаунт Filmix, украинские источники |
| -1 |  | [gorshkovkv/gorshkovkv.github.io/scr/stream.js](https://github.com/gorshkovkv/gorshkovkv.github.io/blob/HEAD/scr/stream.js) `https://gorshkovkv.github.io/scr/stream.js` | 2026-08-09 | cdnjs.cloudflare.com, player.cdnvideohub.com | реклама, KinoPub (платно), украинские источники |
| -1 |  | [zubsverlo/vod/vod.js](https://github.com/zubsverlo/vod/blob/HEAD/vod.js) `https://cdn.jsdelivr.net/gh/zubsverlo/vod@main/vod.js` | 2026-09-08 | hdpoisk.ru | реклама, KinoPub (платно), свой аккаунт Filmix, украинские источники |
