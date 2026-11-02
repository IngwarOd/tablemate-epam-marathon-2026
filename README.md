# Tablemate · EPAM IT Marathon 2026

**[▶ Подивитися живе демо](https://tablemate-epam-2026-igor.auralmetal.chatgpt.site/demo)** · [Відкрити сайт](https://tablemate-epam-2026-igor.auralmetal.chatgpt.site/)

Демо відкривається окремо й одразу створює стіл із двома гостями. GitHub Pages показує документацію репозиторію; робочий застосунок із API та сховищем доступний за посиланнями вище.

[Tablemate](tablemate/README.md) — самостійний ресторанний вебпроєкт із груповим передзамовленням для EPAM IT Marathon 2026. `tablemate/` містить локальний Node.js застосунок; `sites/tablemate/` — адаптер для публічного розгортання зі сталим сховищем груп у R2. Додаткові функції: «Баланс столу» та «Розділити рахунок».

```powershell
cd tablemate
npm start
```

Відкрийте <http://localhost:3000> й натисніть **«Подивитися живе демо»**. Автоматичні перевірки: `cd tablemate`, потім `npm test`.

Кодові й інтеграційні тести: `cd tablemate; npm test`. Фінальну анкету марафону заповнює власник роботи.
