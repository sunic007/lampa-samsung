# Third-party notices / Сторонние компоненты

The `.wgt` package bundles the following third-party software. Each part keeps its own license.
Пакет `.wgt` включает сторонние компоненты; у каждого — своя лицензия.

| Component | Where | License | Source |
|---|---|---|---|
| **Lampa** (yumata) | `src/app.js`, `src/css/app.css`, `src/img`, `src/sound`, `src/plugins_black_list.json`, `src/index.html` (base) | GPL-2.0 — see [GPL-2.0.txt](GPL-2.0.txt) | https://github.com/yumata/lampa, https://github.com/yumata/lampa-source |
| hls.js | `src/vender/hls` | Apache-2.0 | https://github.com/video-dev/hls.js |
| dash.js | `src/vender/dash` | BSD-3-Clause | https://github.com/Dash-Industry-Forum/dash.js |
| jQuery | `src/vender/jquery` | MIT | https://jquery.com |
| jQuery Scrollbar (Yuriy Khabarov) | `src/vender/scrollbar` | MIT or GPL-2.0 (dual) | https://github.com/gromo/jquery.scrollbar |
| QR code generator (Kazuhiko Arase) | `src/vender/qrcode` | MIT | https://github.com/kazuhikoarase/qrcode-generator |
| Notify.js | `src/vender/notify` | MIT | http://notifyjs.com |
| simple-keyboard 2.32.123 (Francisco Hodge) | `src/vender/keypad` | MIT | https://github.com/hodgef/simple-keyboard |
| SpatialNavigator | `src/vender/navigator` | not stated in the file; shipped as part of Lampa's `vender/` | https://github.com/yumata/lampa |
| vast-player 0.2.10 | `src/vender/vast` | not stated in the file; shipped as part of Lampa's `vender/` | https://github.com/yumata/lampa |
| **Segoe UI** font | `src/fonts/SegoeUI` | © Microsoft Corporation — **not** GPL-2.0 and not MIT; see below | shipped as part of Lampa's resources |

The bundled Lampa build is version **3.3.7** (`src/app.js`, the version is in its `app_version`; the build served by
lampa.byskaz.ru, i.e. Lampa with the byskaz server addresses). Its source code is
[yumata/lampa-source, version 3.3.7](https://github.com/yumata/lampa-source/tree/85ea34321f39b6a2d15d2cd437ae2f07066a7c05)
(GPL-2.0). `src/app.js` and Lampa's resources are included as served by lampa.byskaz.ru,
without changes by this project; `src/index.html` is based on Lampa's page with the package's loader added. If a link
stops working, ask in the [Telegram group](https://t.me/sunicapps) or open an issue — the matching source will be
provided.

**Fonts.** `src/fonts/SegoeUI` is the Segoe UI typeface of Microsoft Corporation (web versions made with Transfonter,
see `stylesheet.css`). It comes with Lampa's resources unchanged and is not licensed by this project: neither the
GPL-2.0 of Lampa nor this project's MIT license covers it; all rights stay with Microsoft. The `.wgt` keeps only the
`.woff` files (the TV uses only `.woff`; the `.eot`/`.ttf` copies stay in the repository and are left out by
`tools/pack.py`).

The Skaz (byskaz) plugins are **not** included — Lampa loads them from the byskaz servers at runtime. They belong to their authors.

The package's own code is MIT-licensed — see [LICENSE](../LICENSE): `src/bs*.js`, `src/bs.css`, `src/loader.js`,
`src/update.js`, `src/skazauto.js`, `src/playerguard.js`, `src/polyfills.js`, `src/service/service.js`,
`src/plugins/modification.js`, `docs/pair.html`, `.github/support/`, tools and tests. Distributed together with Lampa,
the combined `.wgt` follows the terms of GPL-2.0.
