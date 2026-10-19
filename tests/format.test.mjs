import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanText, fileNameFor, isValidYear, normalizeName, overflowRisk, plural, programKey, stripOuterQuotes, templateData, toGuillemets, toInitials, validate,
} from "../src/lib/format.js";

test("toInitials: полное ФИО", () => {
  assert.equal(toInitials("Иванова Анна Борисовна"), "А.Б. Иванова");
  assert.equal(toInitials("  иванов   Пётр  "), "П. иванов");
  assert.equal(toInitials("Сидоров Иван"), "И. Сидоров");
});

test("toInitials: двойные фамилии и имена, без отчества, оглы", () => {
  assert.equal(toInitials("Иванова-Петрова Анна Борисовна"), "А.Б. Иванова-Петрова");
  assert.equal(toInitials("Дюма Анна-Мария"), "А.-М. Дюма");
  assert.equal(toInitials("Алиев Рашид Гусейн оглы"), "Р.Г. Алиев");
});

test("toInitials: уже готовая форма нормализуется", () => {
  assert.equal(toInitials("А.Б. Иванова"), "А.Б. Иванова");
  assert.equal(toInitials("А. Б. Иванова"), "А.Б. Иванова");
  assert.equal(toInitials("Иванова А.Б."), "А.Б. Иванова");
  assert.equal(toInitials("Иванова"), "Иванова");
  assert.equal(toInitials(""), "");
});

test("кавычки: ёлочки и снятие внешних кавычек курса", () => {
  assert.equal(toGuillemets('Кафедра "Педагогика и психология"'), "Кафедра «Педагогика и психология»");
  assert.equal(stripOuterQuotes("«Гражданское право»"), "Гражданское право");
  assert.equal(stripOuterQuotes('"Гражданское право"'), "Гражданское право");
  assert.equal(stripOuterQuotes("«Право» и «Экономика»"), "«Право» и «Экономика»");
});

test("cleanText убирает управляющие символы и переводы строк", () => {
  assert.equal(cleanText("a\u0000b\u0007\n c\t"), "ab c");
});

test("normalizeName и programKey сводят написания с разных страниц", () => {
  assert.equal(normalizeName(" Гражданское  право «Ёлки» "), "гражданское право елки");
  assert.equal(programKey("40.04.01", "Гражданское право и процесс"), programKey(" 40.04.01", "гражданское право  и процесс"));
});

test("plural", () => {
  const forms = ["программа", "программы", "программ"];
  assert.equal(plural(1, forms), "1 программа");
  assert.equal(plural(24, forms), "24 программы");
  assert.equal(plural(12, forms), "12 программ");
  assert.equal(plural(142, forms), "142 программы");
  assert.equal(plural(111, forms), "111 программ");
});

test("isValidYear", () => {
  assert.ok(isValidYear("2026"));
  assert.ok(!isValidYear("26"));
  assert.ok(!isValidYear("1999"));
  assert.ok(!isValidYear("20a6"));
});

test("fileNameFor: безопасное имя файла", () => {
  assert.equal(
    fileNameFor({ course: "Право: теория/практика?", assignmentNumber: "1–3", year: "2026" }),
    "Титульный_Право-_теория-практика_задание-1–3_2026.docx",
  );
  const long = fileNameFor({ course: "Очень ".repeat(30), assignmentNumber: "1", year: "2026" });
  assert.ok(long.length < 100, long);
});

test("templateData: номер без «№», вариант, город по умолчанию", () => {
  const data = templateData({ assignmentNumber: "№ 3", course: "«Курс»", year: "2026" });
  assert.equal(data.assignmentNumber, "3");
  assert.equal(data.course, "Курс");
  assert.equal(data.city, "Тольятти");
  assert.equal(data.variant, "");
  assert.equal(data.pageBreak, false);
});

test("validate: обязательные поля и преподаватель", () => {
  const { errors, teacherMissing } = validate(templateData({ year: "2026" }));
  assert.equal(errors.length, 6);
  assert.ok(teacherMissing);
  const full = templateData({
    institute: "И", department: "Д", direction: "40.04.01 Юриспруденция", profile: "П", course: "К",
    student: "А.Б. Иванова", group: "Г", assignmentNumber: "1", teacher: "В.Г. Смирнов", year: "2026",
  });
  assert.deepEqual(validate(full), { errors: [], warnings: [], teacherMissing: false });
});

test("overflowRisk: длинные названия", () => {
  assert.equal(overflowRisk(templateData({ course: "Короткий" })).risky, false);
  assert.equal(overflowRisk(templateData({ course: "Очень длинное название ".repeat(12), profile: "x".repeat(200) })).risky, true);
});
