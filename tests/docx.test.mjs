import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import PizZip from "pizzip";
import { renderTitle } from "../src/lib/docx.js";
import { templateData } from "../src/lib/format.js";

const template = readFileSync(new URL("../template/title-template.docx", import.meta.url));
const original = new PizZip(readFileSync(new URL("../source/Титульный 2026.docx", import.meta.url)));

const base = {
  institute: "Институт права",
  department: "Департамент частного права",
  direction: "40.04.01 Юриспруденция",
  profile: "Гражданское право и процесс",
  assignmentNumber: "2",
  course: "Гражданское право",
  student: "А.Б. Иванова",
  group: "ЮРмд-2401а",
  teacher: "В.Г. Смирнов",
  year: "2026",
};

function render(form) {
  const zip = new PizZip(renderTitle(template, templateData(form), "nodebuffer", new Date("2026-10-20T10:00:00Z")));
  const xml = zip.file("word/document.xml").asText();
  const text = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
  return { zip, xml, text };
}

test("все поля подставлены, тегов не осталось", () => {
  const { text } = render(base);
  for (const v of Object.values(templateData(base))) if (typeof v === "string" && v) assert.ok(text.includes(v), v);
  assert.ok(text.includes("ПрактическИе заданиЯ № 2"));
  assert.ok(text.includes("«Гражданское право»"));
  assert.ok(text.includes("Тольятти 2026"));
  assert.doesNotMatch(text, /\{[#/]?\w+\}/);
});

test("вариант: пусто — строки нет, заполнен — без «(при наличии)»", () => {
  const empty = render(base).text;
  assert.ok(!empty.includes("Вариант"));
  assert.ok(!empty.includes("(при наличии)") && !empty.includes("____"));
  const filled = render({ ...base, variant: "7" }).text;
  assert.ok(filled.includes("Вариант 7"));
  assert.ok(!filled.includes("(при наличии)"));
});

test("разрыв страницы управляется флагом", () => {
  assert.ok(!render(base).xml.includes('w:type="page"'));
  assert.ok(render({ ...base, pageBreak: true }).xml.includes('w:type="page"'));
});

test("спецсимволы экранируются, XML остаётся валидным", () => {
  const { xml, text } = render({ ...base, course: 'A & B <c> "d" \u0001', student: "Ж.-Э. О'Нил" });
  assert.ok(xml.includes("A &amp; B &lt;c&gt;"));
  assert.ok(text.includes("О'Нил") || text.includes("О&apos;Нил"));
  assert.ok(!xml.includes("\u0001"));
});

test("графика, таблицы, поля и шапка сохранены", () => {
  const { zip, xml } = render(base);
  assert.deepEqual(
    zip.file("word/media/image1.jpeg").asUint8Array(),
    original.file("word/media/image1.jpeg").asUint8Array(),
  );
  assert.equal((xml.match(/<w:tbl>/g) ?? []).length, 2);
  assert.ok(xml.includes('<w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701"'));
  assert.ok(xml.includes("МИНИСТЕРСТВО НАУКИ И ВЫСШЕГО ОБРАЗОВАНИЯ РОССИЙСКОЙ ФЕДЕРАЦИИ"));
  assert.ok(xml.includes("«Тольяттинский государственный университет»"));
  assert.ok(!xml.includes('w:val="1"/><w:ind'), "«Тольятти» не должен быть Заголовком 1");
});

test("метаданные очищены и датированы моментом генерации", () => {
  const core = render(base).zip.file("docProps/core.xml").asText();
  assert.ok(!core.includes("User") && !core.includes("Archirect"));
  assert.ok(core.includes(">2026-10-20T10:00:00Z</dcterms:modified>"));
  assert.ok(!render(base).xml.includes("C:\\Users"));
  assert.ok(!core.includes("Иванова"));
});
