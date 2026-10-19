import { test } from "node:test";
import assert from "node:assert/strict";
import { inferFromGroup, normalizeGroup, parseGroup, scoreDirection } from "../src/lib/group.js";

const catalog = {
  programs: [
    { id: "a", instituteId: "law", departmentId: "civil", level: "Магистратура", code: "40.04.01", direction: "Юриспруденция", profile: "Гражданское право и процесс", form: "Заочная" },
    { id: "b", instituteId: "law", departmentId: "civil", level: "Магистратура", code: "40.04.01", direction: "Юриспруденция", profile: "Договорное право", form: "Заочная" },
    { id: "c", instituteId: "law", departmentId: "public", level: "Магистратура", code: "40.04.01", direction: "Юриспруденция", profile: "Уголовное право и процесс", form: "Очная" },
    { id: "d", instituteId: "law", departmentId: "civil", level: "Бакалавриат", code: "40.03.01", direction: "Юриспруденция", profile: "Гражданско-правовой", form: "Очная" },
    { id: "e", instituteId: "hum", departmentId: "psy", level: "Магистратура", code: "37.04.01", direction: "Психология", profile: "Психологическое консультирование", form: "Очно-заочная" },
    { id: "f", instituteId: "hum", departmentId: "psy", level: "Магистратура", code: "44.04.02", direction: "Психолого-педагогическое образование", profile: "Х", form: "Заочная" },
  ],
};
const groups = { groups: [["ЮРмд-2406а", "law", 2], ["ПСХмвд-2404а", "hum", 2]] };

test("parseGroup: уровень, префикс, год набора", () => {
  assert.deepEqual(parseGroup("ЮРмд-2406а"), { name: "ЮРмд-2406а", prefix: "ЮР", level: "Магистратура", year: 2024 });
  assert.equal(parseGroup("ЮРспоп-2501а").level, "СПО");
  assert.equal(parseGroup("ПО2б-2405а").prefix, "ПО2");
  assert.equal(parseGroup(" ЮРмд – 2406а ").name, "ЮРмд-2406а");
  assert.equal(parseGroup("группа 5"), null);
  assert.equal(normalizeGroup("ЮРмд−2406а"), "ЮРмд-2406а");
});

test("scoreDirection: начало слова и первые буквы выше вхождения", () => {
  assert.equal(scoreDirection("ЮР", "Юриспруденция"), 4);
  assert.equal(scoreDirection("ППО", "Психолого-педагогическое образование"), 4);
  assert.equal(scoreDirection("ПСХ", "Психология"), 3);
  assert.equal(scoreDirection("ЮР", "Психология"), 0);
});

test("inferFromGroup: институт из снапшота, форма сужает программы", () => {
  const r = inferFromGroup("ЮРмд-2406а", catalog, groups);
  assert.equal(r.known, true);
  assert.equal(r.instituteId, "law");
  assert.deepEqual(r.programs.map((p) => p.id), ["a", "b"]);
  assert.deepEqual(r.departmentIds, ["civil"]);
  assert.deepEqual(r.directions, ["40.04.01 Юриспруденция"]);
});

test("inferFromGroup: неизвестная группа — по шаблону, без института из снапшота", () => {
  const r = inferFromGroup("ЮРм-2601а", catalog, groups);
  assert.equal(r.known, false);
  assert.equal(r.instituteId, "law");
  assert.deepEqual(r.programs.map((p) => p.id), ["a", "b", "c"]);
});

test("inferFromGroup: неоднозначный префикс даёт несколько направлений", () => {
  const r = inferFromGroup("ПСХмвд-2404а", catalog, groups);
  assert.deepEqual(r.directions.sort(), ["37.04.01 Психология", "44.04.02 Психолого-педагогическое образование"]);
  assert.equal(inferFromGroup("непонятно", catalog, groups), null);
});
