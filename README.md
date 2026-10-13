# Lampa for Samsung Smart TV (Tizen)

[![Release](https://img.shields.io/github/v/release/sunic007/lampa-samsung?label=release&color=3d8bff)](https://github.com/sunic007/lampa-samsung/releases/latest) [![Downloads](https://img.shields.io/github/downloads/sunic007/lampa-samsung/total?color=2ea043)](https://github.com/sunic007/lampa-samsung/releases) ![Tizen](https://img.shields.io/badge/Tizen-2.3%2B-1428a0) [![Telegram bot](https://img.shields.io/badge/Telegram-bot-26a5e4?logo=telegram&logoColor=white)](#-telegram-bot--search-watch-on-the-tv-and-notifications) [![License](https://img.shields.io/badge/license-MIT%20%2B%20GPL--2.0%20(Lampa)-lightgrey)](THIRD_PARTY_NOTICES.md)

**English** · [Русский](README.ru.md)

A build of the open-source **Lampa** media center for Samsung Smart TVs. It installs as a single `samsung.wgt` file
and is tuned for the TV: it updates itself, keeps the player from freezing and adds a Telegram bot to control the TV
from your phone. It is a player — it does not host or provide any movies or series.

**⬇️ [Download samsung.wgt](https://github.com/sunic007/lampa-samsung/releases/latest/download/samsung.wgt)** — latest version
· all versions — [Releases](https://github.com/sunic007/lampa-samsung/releases)
· changelog — [CHANGELOG.md](CHANGELOG.md) (RU)
· for developers — [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) (RU)
· install from your phone — **[TV Installer](https://github.com/sunic007/tvinstaller)**
· ❤️ [sponsor the project](https://github.com/sponsors/sunic007)

Tested on a 2022 Samsung TV (Tizen 6.5) and on the official Samsung TV emulator (Tizen 10.0).

> Lampa itself supports several languages. The extra features of this package and the Telegram bot are in Russian.

---

## 🤖 Telegram bot — search, “Watch” on the TV and notifications

Your own Telegram bot for Lampa: find movies and **start them on the TV right from your phone**, and get notified
about new episodes. No server needed — the bot runs inside Lampa on the TV.

- 🔎 **Search** by title, year or studio; results come as one swipeable message with poster and description.
- ▶️ **Watch** — the TV opens the title and starts playback by itself: a series continues from the episode and
  position you stopped at.
- 🖼 **Search by screenshot** and 🧠 **by description** (“the movie where a guy is stuck on Mars”) with a free AI key
  (Groq, Gemini or OpenRouter).
- 🔔 **Notifications**: new episode, “airs today”, “remind me tomorrow”, weekly digest.
- 👨‍👩‍👧 **The whole family in one bot** — everyone connects with their own Telegram via a QR code in Lampa's search
  and gets their own watch list and subscriptions. **Several TVs** share one bot; if one is turned off, another
  takes over within a minute.

**Connect:** create a bot with [@BotFather](https://t.me/BotFather) → in Lampa open
**Settings → Telegram → “Подключить с телефона”**, scan the QR code and paste the token → send any message to your bot.

## What this package adds

- 🔄 **Auto-update** of Lampa, the plugins and the package itself (from this repository) — no reinstall needed.
- 📡 **Automatic Skaz server choice** by ping, jitter and loss; a stuck server is replaced automatically.
- 🛟 **Player watchdog** — restarts a frozen video from the same position, then tries another quality or source.
- ▶️ **One-press “Watch”**, ⏯ **continue where you left off**, ⏭ **next-episode countdown**,
  skip intros and credits, chapters.
- 📺 **Samsung AVPlay** hardware playback (4K/HLS), faster start, quality matched to your internet speed.
- 🔈 Per-title volume with a night limit, 🌙 day/night brightness, audio track memory, sleep timer.
- 🧒 **Kids mode** (PIN), 💤 “Are you still watching?”, 🇹🇷 Turkish series section.
- 🛡 **Works without the server** — a bundled copy of Lampa starts if the server is unavailable.

The full feature table is in the [Russian README](README.ru.md#что-добавляет-этот-пакет).

## Content sources

The package contains no movies, series or streams. What you watch depends on the content source you connect
yourself — for example the **[Skaz TV](https://skaz.tv)** subscription service, which the package is set up for
(subscribe: [skaz.tv/oplata.php](https://skaz.tv/oplata.php), support: [@helpiptv](https://t.me/helpiptv)).
Use only sources you have the right to use.

## Installation

The easiest way is from an Android phone with **[TV Installer](https://github.com/sunic007/tvinstaller)**: it finds
the TV, gets the Samsung certificate and installs the latest Lampa from GitHub; an animation shows what to press on the TV.

1. On the TV: **Apps** → scroll down to **App Settings** → press `12345` on the remote → switch **Developer mode**
   **On**, enter the IP of the phone (or PC) you will install from, restart the TV.
2. In TV Installer choose Lampa — or download
   **[samsung.wgt](https://github.com/sunic007/lampa-samsung/releases/latest/download/samsung.wgt)** and install it with
   any installer that signs the package.
3. Start Lampa. The package applies the byskaz starter settings itself.

New versions install over the old one; settings are kept. Package settings are in **Settings → “Обновление”**.

## Support the project

The package and TV Installer are free. If they are useful to you, you can support development on
**[GitHub Sponsors](https://github.com/sponsors/sunic007)** (in Lampa: Settings → “Обновление” → “Поддержать проект”).

## Disclaimer

This project does not host, store or distribute any films, series or other media, and is not affiliated with
the content services it can be used with. Samsung and Tizen are trademarks of Samsung Electronics; this project is
not affiliated with or endorsed by Samsung. Third-party components and their licenses —
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

Lampa is the [yumata/lampa](https://github.com/yumata/lampa) project; plugins and server — [byskaz](https://lampabs.com).
This package does not modify them: it loads Lampa from the byskaz server and adds TV features around it.
