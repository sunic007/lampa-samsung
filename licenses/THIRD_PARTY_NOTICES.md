# Third-party notices / Сторонние компоненты

The `.wgt` package bundles the following third-party software. Each part keeps its own license.
Пакет `.wgt` включает сторонние компоненты; у каждого — своя лицензия.

| Component | Where | License | Source |
|---|---|---|---|
| **Lampa** (yumata) | `src/app.js`, `src/css`, `src/img`, `src/fonts`, `src/sound`, `src/index.html` (base) | GPL-2.0 — see [GPL-2.0.txt](GPL-2.0.txt) | https://github.com/yumata/lampa, https://github.com/yumata/lampa-source |
| hls.js | `src/vender/hls` | Apache-2.0 | https://github.com/video-dev/hls.js |
| dash.js | `src/vender/dash` | BSD-3-Clause | https://github.com/Dash-Industry-Forum/dash.js |
| jQuery | `src/vender/jquery` | MIT | https://jquery.com |
| jQuery Scrollbar | `src/vender/scrollbar` | MIT | https://github.com/gromo/jquery.scrollbar |
| QR code generator | `src/vender/qrcode` | MIT | https://github.com/kazuhikoarase/qrcode-generator |

The bundled Lampa build is version **3.3.6** (`src/app.js`, the version is in its `app_version`). Its source code is
[yumata/lampa-source at commit c1f06f9](https://github.com/yumata/lampa-source/tree/c1f06f9820e7709bca4c4c6677c802840f5cbe51)
(GPL-2.0). `src/app.js` and Lampa's resources are included unmodified; `src/index.html` is based on Lampa's page with
the package's loader added. If a link stops working, ask in the [Telegram group](https://t.me/sunicapps) or open an
issue — the matching source will be provided.
The Skaz (byskaz) plugins are **not** included — Lampa loads them from the byskaz servers at runtime.

The package's own code (`src/bs*.js`, `src/loader.js`, `src/update.js`, `src/skazauto.js`, `src/playerguard.js`,
tools and tests) is MIT-licensed — see [LICENSE](../LICENSE). Distributed together with Lampa, the combined `.wgt`
follows the terms of GPL-2.0.
