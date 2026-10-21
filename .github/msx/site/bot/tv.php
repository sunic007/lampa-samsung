<?php
/*
 * Общий бот Sunic Apps закрыт (2026-10-21, решение владельца). Старые ТВ (до 2.3.45) ещё спрашивают сервер — короткий
 * ответ «закрыт», без базы. С 2.3.45 модуля общего бота на ТВ нет. Бот — свой, бесплатно: Lampa → Sunic Apps → Telegram.
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
echo '{"ok":false,"closed":true,"description":"Sunic Apps shared bot is closed"}';
