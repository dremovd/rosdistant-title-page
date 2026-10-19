# Генератор титульных листов ТГУ / Росдистант

Статический сайт на GitHub Pages: студент выбирает программу, вводит ФИО, группу, курс и номер задания и скачивает готовый титульный лист в DOCX по шаблону 2026 года.

**Сайт:** https://dremovd.github.io/rosdistant-title-page/

- Всё выполняется в браузере: DOCX собирается локально, введённые данные никуда не отправляются.
- ФИО, группа и программа запоминаются в `localStorage` этого браузера.
- Справочник институтов, подразделений, программ и дисциплин собирается с открытых страниц tltsu.ru при сборке сайта (у tltsu.ru закрыт CORS, из браузера его не прочитать).
- Подсказки преподавателей — из раздела «Педагогический состав» tltsu.ru (ФИО, должность, дисциплины в программе). Сайт только предлагает, проверяющего студент сверяет в СДО.
- Любое подставленное значение можно исправить вручную.

ТЗ: [`docs/SPEC.md`](docs/SPEC.md).

## Структура

| Путь | Что это |
|---|---|
| `source/Титульный 2026.docx` | Исходный образец, не изменяется |
| `template/title-template.docx` | Шаблон с плейсхолдерами docxtemplater, собирается из исходника |
| `data/catalog.json` | Справочник программ и дисциплин, собирается с tltsu.ru |
| `data/staff.json` | Преподаватели программ и их дисциплины, собираются с tltsu.ru |
| `src/` | Сайт: `index.html`, `app.js`, `styles.css`, `lib/` (форматирование, DOCX, хранилище) |
| `tools/` | Сборка шаблона, справочника и сайта |
| `tests/` | Тесты `node --test` |
| `.github/workflows/` | Деплой на Pages и еженедельное обновление справочника |

## Команды

```sh
npm ci
npm test                 # тесты форматирования и заполнения DOCX
npm run build            # сайт -> dist/ (имена ресурсов с хэшем)
npm run serve            # http://localhost:8080 — локальный просмотр dist/
npm run sample           # примеры DOCX -> out/ для сверки в Word/LibreOffice
npm run update:catalog   # пересобрать data/catalog.json и data/staff.json с tltsu.ru (~2 мин, CONCURRENCY=20)
npm run build:template   # пересобрать шаблон из source/ (нужен python3)
```

## Деплой

- Push в `main` → workflow **Deploy to GitHub Pages**: тесты, сборка, публикация `dist/`.
- Workflow **Update catalog from tltsu.ru** — по понедельникам и вручную. Если справочник изменился (не только дата), коммитит его и запускает деплой. При сбое сети или резком сокращении числа программ падает, старый справочник остаётся.
- В настройках репозитория: Pages → Source: **GitHub Actions**.

## Шаблон

Теги: `{institute}`, `{department}`, `{direction}`, `{profile}`, `{assignmentNumber}`, `{course}`, `{#variant}Вариант {variant}{/variant}`, `{student}`, `{group}`, `{teacher}`, `{city}`, `{year}`, `{#pageBreak}…{/pageBreak}`. Подробно — в разделе 3.2 ТЗ.
