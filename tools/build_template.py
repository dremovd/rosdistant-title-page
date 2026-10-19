#!/usr/bin/env python3
"""Собирает шаблон с плейсхолдерами docxtemplater из исходного титульного листа.

Исходный файл не изменяется. Каждая замена обязана сработать ровно столько раз,
сколько ожидается, иначе сборка падает — так изменение исходника не пройдёт молча.

    python3 tools/build_template.py ["source/Титульный 2026.docx"] [template/title-template.docx]
"""
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "source" / "Титульный 2026.docx"
DST = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "template" / "title-template.docx"

SZ28 = '<w:rPr><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>'
CALIBRI28 = ('<w:rPr><w:rFonts w:eastAsia="Calibri"/><w:sz w:val="28"/><w:szCs w:val="28"/>'
             '<w:lang w:eastAsia="en-US"/></w:rPr>')
HEADING_RPR = '<w:rPr><w:b/><w:bCs/><w:caps/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>'


# (старый фрагмент, новый фрагмент, ожидаемое число вхождений)
DOCUMENT_EDITS = [
    # Путь к файлу на ПК автора в описании картинки.
    (r'descr="C:\Users\user\Desktop\фон.jpg"', 'descr="Фон Росдистант"', 2),
    # Ширина ячеек таблицы 1 не совпадала с сеткой (9355 = ширина текста страницы).
    ('<w:tcW w:w="9627" w:type="dxa"/>', '<w:tcW w:w="9355" w:type="dxa"/>', 7),
    # Институт, подразделение, направление, профиль.
    (f'{SZ28}<w:t>Гуманитарно-педагогический институт</w:t>', f'{SZ28}<w:t>{{institute}}</w:t>', 1),
    (f'{CALIBRI28}<w:t>Кафедра «Педагогика и психология»</w:t>', f'{CALIBRI28}<w:t>{{department}}</w:t>', 1),
    (f'{CALIBRI28}<w:t>37.04.01 Психология</w:t>', f'{CALIBRI28}<w:t>{{direction}}</w:t>', 1),
    (f'{CALIBRI28}<w:t>Психологическое консультирование</w:t>', f'{CALIBRI28}<w:t>{{profile}}</w:t>', 1),
    # Номер задания в том же фрагменте, что и «№».
    (f'{HEADING_RPR}<w:t xml:space="preserve"> № </w:t>',
     f'{HEADING_RPR}<w:t xml:space="preserve"> № {{assignmentNumber}}</w:t>', 1),
    # Курс внутри подчёркнутых кавычек.
    ('<w:u w:val="single"/></w:rPr><w:t>«»</w:t>', '<w:u w:val="single"/></w:rPr><w:t>«{course}»</w:t>', 1),
    # Вариант: при пустом значении абзац остаётся пустым (высота строки сохраняется),
    # подсказка «(при наличии)» и подчёркивания в итоговый лист не попадают.
    (f'{SZ28}<w:t xml:space="preserve">Вариант ____ </w:t></w:r>'
     '<w:r w:rsidRPr="00727C1D"><w:rPr><w:i/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>'
     '<w:t>(при наличии)</w:t></w:r>',
     f'{SZ28}<w:t xml:space="preserve">{{#variant}}Вариант {{variant}}{{/variant}}</w:t></w:r>', 1),
    # Город и год: обычный абзац вместо «Заголовка 1» (не попадёт в оглавление),
    # без отступа первой строки (был сдвиг вправо), разрыв страницы — по флагу.
    ('<w:pPr><w:pStyle w:val="1"/><w:ind w:firstLine="709"/><w:rPr><w:color w:val="008FC8"/></w:rPr></w:pPr>'
     '<w:r w:rsidRPr="00727C1D"><w:rPr><w:b w:val="0"/></w:rPr><w:t>Тольятти 2026</w:t></w:r>'
     '<w:r><w:rPr><w:color w:val="008FC8"/></w:rPr><w:br w:type="page"/></w:r>',
     f'<w:pPr><w:keepNext/><w:jc w:val="center"/>{SZ28}</w:pPr>'
     f'<w:r>{SZ28}<w:t xml:space="preserve">{{city}} {{year}}</w:t></w:r>'
     '<w:r><w:t>{#pageBreak}</w:t></w:r><w:r><w:br w:type="page"/></w:r><w:r><w:t>{/pageBreak}</w:t></w:r>', 1),
]

# Пустые абзацы ячеек значений таблицы 2 (по w14:paraId) и их теги.
VALUE_CELLS = {"43C5E88F": "student", "227642A9": "group", "697E1C7A": "teacher"}

CORE_EDITS = [
    ('<dc:creator>User</dc:creator>', '<dc:creator></dc:creator>', 1),
    ('<cp:lastModifiedBy>Archirect</cp:lastModifiedBy>', '<cp:lastModifiedBy></cp:lastModifiedBy>', 1),
]


def apply(text, edits, name):
    for old, new, count in edits:
        found = text.count(old)
        if found != count:
            sys.exit(f"{name}: ожидалось {count} вхождений, найдено {found}: {old[:80]}…")
        text = text.replace(old, new)
    return text


def fill_value_cells(text):
    tail = '<w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:pPr></w:p>'
    for para_id, tag in VALUE_CELLS.items():
        start = text.index(f'w14:paraId="{para_id}"')
        end = text.index('</w:p>', start) + len('</w:p>')
        para = text[start:end]
        if not para.endswith(tail) or '<w:r' in para.replace('<w:rPr', ''):
            sys.exit(f"ячейка {tag}: абзац {para_id} не пустой или изменился")
        para = para[: -len('</w:p>')] + f'<w:r>{SZ28}<w:t>{{{tag}}}</w:t></w:r></w:p>'
        text = text[:start] + para + text[end:]
    return text


def main():
    DST.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(SRC) as zin, zipfile.ZipFile(DST, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "word/document.xml":
                text = apply(data.decode("utf-8"), DOCUMENT_EDITS, item.filename)
                data = fill_value_cells(text).encode("utf-8")
            elif item.filename == "docProps/core.xml":
                data = apply(data.decode("utf-8"), CORE_EDITS, item.filename).encode("utf-8")
            zout.writestr(item, data, compress_type=zipfile.ZIP_DEFLATED)
    print(f"{SRC.name} -> {DST}")


if __name__ == "__main__":
    main()
