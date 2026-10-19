# Генератор титульных листов ТГУ / Росдистант

Статический сайт (GitHub Pages), который заполняет титульный лист практического задания и отдаёт готовый DOCX. Всё выполняется в браузере, персональные данные никуда не отправляются.

Статус: спецификация и шаблон готовы, интерфейса пока нет.

- [`docs/SPEC.md`](docs/SPEC.md) — техническое задание (v1.1).
- [`source/Титульный 2026.docx`](source/) — исходный образец, не изменяется.
- [`template/title-template.docx`](template/) — шаблон с плейсхолдерами docxtemplater, собирается из исходника.

## Шаблон

```sh
npm install
npm run build:template   # source/ -> template/title-template.docx
npm run test:template    # заполняет тестовыми данными -> out/*.docx и проверяет результат
```

Теги шаблона: `{institute}`, `{department}`, `{direction}`, `{profile}`, `{assignmentNumber}`, `{course}`, `{variant}` (условный блок `{#variant}…{/variant}`), `{student}`, `{group}`, `{teacher}`, `{city}`, `{year}`, флаг `{#pageBreak}…{/pageBreak}`. Подробно — в разделе 3.2 ТЗ.
