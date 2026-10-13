# Third-party notices / Сторонние компоненты

The `.wgt` package bundles the following third-party software. Each part keeps its own license.
Пакет `.wgt` включает сторонние компоненты; у каждого — своя лицензия.

| Component | Where | License | Source |
|---|---|---|---|
| **Lampa** (yumata) | `src/app.js`, `src/css`, `src/img`, `src/fonts`, `src/sound`, `src/index.html` (base) | GPL-2.0 — see [LICENSE-GPL-2.0.txt](LICENSE-GPL-2.0.txt) | https://github.com/yumata/lampa, https://github.com/yumata/lampa-source |
| hls.js | `src/vender/hls` | Apache-2.0 | https://github.com/video-dev/hls.js |
| dash.js | `src/vender/dash` | BSD-3-Clause | https://github.com/Dash-Industry-Forum/dash.js |
| jQuery | `src/vender/jquery` | MIT | https://jquery.com |
| jQuery Scrollbar | `src/vender/scrollbar` | MIT | https://github.com/gromo/jquery.scrollbar |
| QR code generator | `src/vender/qrcode` | MIT | https://github.com/kazuhikoarase/qrcode-generator |

The Lampa source code is publicly available at the links above; this repository contains the bundled build unmodified.
The Skaz (byskaz) plugins are **not** included — Lampa loads them from the byskaz servers at runtime.

The package's own code (`src/bs*.js`, `src/loader.js`, `src/update.js`, `src/skazauto.js`, `src/playerguard.js`,
tools and tests) is MIT-licensed — see [LICENSE](LICENSE). Distributed together with Lampa, the combined `.wgt`
follows the terms of GPL-2.0.
