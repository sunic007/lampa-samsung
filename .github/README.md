<picture><img src="../docs/logo.png" width="210" align="left" alt="Lampa"></picture>

<p align="center">The open-source <b>Lampa</b> media center for <b>Samsung Smart TV</b>.<br>Updates itself, keeps the player from freezing and adds a Telegram bot.</p>

<p align="center">
<a href="https://github.com/sunic007/lampa-samsung/releases/latest"><img src="https://img.shields.io/github/v/release/sunic007/lampa-samsung?style=flat-square&label=release&color=2f81f7" alt="release"></a>
<a href="https://github.com/sunic007/lampa-samsung/releases"><img src="https://img.shields.io/github/downloads/sunic007/lampa-samsung/total?style=flat-square&color=2ea043" alt="downloads"></a>
<picture><img src="https://img.shields.io/badge/Samsung-Tizen%202.3%2B-1428a0?style=flat-square" alt="Tizen 2.3+"></picture>
<picture><img src="https://img.shields.io/badge/Telegram-bot-26a5e4?style=flat-square&logo=telegram&logoColor=white" alt="Telegram bot"></picture>
</p>

<p align="center"><a href="https://github.com/sunic007/lampa-samsung/releases/latest/download/samsung.wgt"><img src="../docs/badges/download-en.svg" height="40" align="middle" alt="Download samsung.wgt"></a>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<picture><img src="https://flagcdn.com/h60/gb.png" height="30" align="middle" alt=""></picture> <b>English</b>&nbsp;&nbsp;&nbsp;<a href="README.ru.md"><img src="https://flagcdn.com/h60/ru.png" height="30" align="middle" alt=""> Русский</a>&nbsp;&nbsp;&nbsp;<a href="README.uz.md"><img src="https://flagcdn.com/h60/uz.png" height="30" align="middle" alt=""> O'zbekcha</a></p>

<p align="center"><sub>Free · Tizen 2.3+ · <a href="CHANGELOG.md">What's new</a> (RU) · <a href="../docs/DEVELOPMENT.md">For developers</a> (RU)</sub></p>

<br clear="left">

## How it works

<div align="justify">

1. <b>Prepare the TV</b> — turn on Developer Mode with your phone's address (<a href="https://github.com/sunic007/tvinstaller">TV Installer</a> shows how).
2. <b>Install Lampa</b> — in TV Installer pick Lampa, or download <code>samsung.wgt</code> and install it with any installer that signs the package.
3. <b>Start Lampa</b> — the package applies the starter settings and then updates itself.
4. <b>Connect the Telegram bot</b> (optional) — <b>Settings → Sunic Apps → Telegram-бот</b>.

</div>

<p align="center">
  <picture><img src="../docs/screenshots/en/01.png" width="24.4%" alt=""></picture>
  <a href="../docs/screenshots/en/02.gif"><img src="../docs/screenshots/en/02.gif" width="24.4%" alt="Telegram bot"></a>
  <picture><img src="../docs/screenshots/en/03.png" width="24.4%" alt=""></picture>
  <picture><img src="../docs/screenshots/en/04.png" width="24.4%" alt=""></picture>
</p>

<details>
<summary><b>More screenshots</b></summary>
<br>
<p align="center">
  <picture><img src="../docs/screenshots/en/05.png" width="49%" alt=""></picture>
  <picture><img src="../docs/screenshots/en/06.png" width="49%" alt=""></picture>
</p>
</details>

<sub>Screenshots show only open movies by the Blender Foundation (Sintel, Spring, Wing It! and others), licensed under Creative Commons Attribution — © Blender Foundation | studio.blender.org. No copyrighted content is shown.</sub>

## Install and connect

<p align="center">
  <picture><img src="../docs/screenshots/en/install.gif" width="20.4%" alt=""></picture>
  <picture><img src="../docs/screenshots/en/bot-setup.gif" width="76.6%" alt=""></picture>
</p>

<sub>Left — installing Lampa with TV Installer, right — connecting the Telegram bot.</sub>

<a href="https://github.com/sunic007/tvinstaller"><img src="https://raw.githubusercontent.com/sunic007/tvinstaller/main/docs/logo.png" width="96" align="left" alt="TV Installer"></a>

<div align="justify">

<b>TV Installer</b> is the easiest way to install Lampa: the Android app finds your TV, gets the Samsung certificate and installs the latest version. No PC needed.<br>
<a href="https://github.com/sunic007/tvinstaller/releases/latest/download/SunicTvInstaller.apk"><b>Download TV Installer →</b></a>

</div>

<br clear="left">

## Features

<div align="justify">

- <b>One-press “Watch”</b> — a movie starts at once, a series resumes from the episode and position you stopped at.
- <b>Telegram bot</b> — search on your phone and start on the TV, notifications about new episodes, the whole family in one bot, several TVs.
- <b>Player watchdog</b> — restarts a frozen video from the same position, then tries another quality or source.
- <b>Auto-update</b> — Lampa, the plugins and the package update themselves — no reinstall.
- <b>Samsung AVPlay</b> — hardware 4K/HLS playback, faster start, quality matched to your internet.
- <b>Comfort</b> — next-episode countdown, “Are you still watching?”, sleep timer, day/night brightness, per-title volume.
- <b>Works without the server</b> — a bundled copy of Lampa starts if the server is unavailable.
- <b>All in one place</b> — every package setting is in <b>Settings → Sunic Apps</b>.

<b>AI search for free.</b> No CUB subscription? Search by description and by screenshot in the bot works with a free key from <a href="https://console.groq.com/keys">Groq</a>, <a href="https://aistudio.google.com/apikey">Gemini</a> or <a href="https://openrouter.ai/keys">OpenRouter</a> — just send the key to the bot.

</div>
<br>

<sub>The extra features of this package and the Telegram bot are in Russian; Lampa itself supports several languages. The full feature table is in the <a href="README.ru.md#возможности">Russian README</a>.</sub>

## Content sources

<div align="justify">

The package contains no movies, series or streams. What you watch depends on the content source you connect yourself — for example the <a href="https://skaz.tv">Skaz TV</a> subscription the package is set up for (support: <a href="https://t.me/helpiptv">@helpiptv</a>). Use only sources you have the right to use.

</div>

## FAQ

<details>
<summary><b>The video does not start</b></summary>
<br>
<div align="justify">

Wait: if it hasn't started in 25 s (about 9 s after a player error) the package restarts the stream or opens another variant. If nothing works, check your <a href="https://skaz.tv">Skaz TV</a> subscription and contact its support.

</div>
</details>

<details>
<summary><b>How do I know it updated?</b></summary>
<br>
<div align="justify">

After an update you see “Lampa обновлена: X → Y”; versions are in <b>Settings → Sunic Apps → Обновление</b>.

</div>
</details>

<details>
<summary><b>Does it host movies?</b></summary>
<br>
<div align="justify">

No. It is a player; it does not host, store or distribute any media.

</div>
</details>

## Support the project

<div align="justify">

Lampa for Samsung and TV Installer are free. If they help you, you can support development on <a href="https://github.com/sponsors/sunic007"><b>GitHub Sponsors</b></a>.

</div>

---

<div align="justify"><sub>This project does not host, store or distribute any films, series or other media and is not affiliated with the content services it can be used with. Samsung and Tizen are trademarks of Samsung Electronics; this project is not affiliated with or endorsed by Samsung. Lampa is the <a href="https://github.com/yumata/lampa">yumata/lampa</a> project, plugins and server — <a href="https://lampabs.com">byskaz</a>; this package does not modify them. Third-party licenses — <a href="../licenses/THIRD_PARTY_NOTICES.md">THIRD_PARTY_NOTICES.md</a>.</sub></div>
