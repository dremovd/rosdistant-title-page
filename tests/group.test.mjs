import { test } from "node:test";
import assert from "node:assert/strict";
import {
  currentPeriod, findGroup, planCourses, groupKey, inferFromGroup, matchPlan, normalizeGroup, parseGroup, planDisciplines, scoreDirection,
} from "../src/lib/group.js";

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
  assert.deepEqual(parseGroup("ЮРмд-2406а"), {
    name: "ЮРмд-2406а", prefix: "ЮР", level: "Магистратура", year: 2024, number: "06", distance: true, formLetter: "z",
  });
  assert.equal(parseGroup("ПСХмвд-2404а").formLetter, "v");
  assert.equal(parseGroup("ЮРб-2402а").formLetter, "");
  assert.equal(parseGroup("ЮРб-2402а").distance, false);
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

const plan = (over) => ({
  id: "z40.04.01_11_do1_2024_3++", code: "40.04.01", direction: "Юриспруденция", number: "11", year: 2024,
  level: "Магистратура", formLetter: "z", distance: true, form: "Заочная", profile: "Гражданское право и процесс",
  department: "Департамент частного права", institute: "ИнПр", instituteId: "law", periodUnit: "course",
  disciplines: [["Проблемы деликтного права", [1]], ["Проблемы семейного права", [2]], ["Причинение вреда", [3]]],
  ...over,
});
const plans = {
  plans: [
    plan(),
    plan({ id: "z40.04.01_11_2024_3++", distance: false }),
    plan({ id: "z40.04.01_09_do1_2024_3++", number: "09", profile: "Уголовное право и процесс", department: "Департамент публичного права" }),
  ],
};

test("matchPlan: номер, год, дистанционность", () => {
  assert.equal(matchPlan(parseGroup("ЮРмд-2411а"), plans.plans, "law").plan.id, "z40.04.01_11_do1_2024_3++");
  assert.equal(matchPlan(parseGroup("ЮРмп-2411а"), plans.plans, "law").plan.id, "z40.04.01_11_2024_3++");
  assert.equal(matchPlan(parseGroup("ЮРмд-2412а"), plans.plans, "law").plan, null);
});

test("inferFromGroup с планом: точная программа и кафедра", () => {
  const withDep = { ...catalog, departments: [{ id: "civil", name: "Департамент частного права" }, { id: "public", name: "Департамент публичного права" }] };
  const r = inferFromGroup("ЮРмд-2411а", withDep, groups, plans);
  assert.equal(r.plan.profile, "Гражданское право и процесс");
  assert.deepEqual(r.programs.map((p) => p.id), ["a"]);
  assert.equal(r.department.id, "civil");
});

test("currentPeriod и planDisciplines: курс заочной формы", () => {
  const oct2026 = new Date(2026, 9, 20);
  assert.equal(currentPeriod(plan(), oct2026).course, 3);
  assert.deepEqual(planDisciplines(plan(), oct2026).current, ["Причинение вреда"]);
  const sem = currentPeriod(plan({ periodUnit: "semester" }), new Date(2027, 2, 1));
  assert.deepEqual([sem.course, sem.semester], [3, 6]);
});

test("группа без дефиса и в любом регистре", () => {
  const known = { groups: [["ЮРмд-2411а", "law", 2], ["ПСХмвд-2404а", "hum", 2], ["ПО2б-2405а", "hum", 1]] };
  for (const typed of ["юрмд2411а", "ЮРМД2411А", "юрмд-2411а", " ЮРмд 2411а ", "ЮРмд–2411а"]) {
    assert.equal(parseGroup(typed, known).name, "ЮРмд-2411а", typed);
    assert.equal(findGroup(typed, known)?.[0], "ЮРмд-2411а", typed);
  }
  assert.equal(parseGroup("псхмвд2404а", known).name, "ПСХмвд-2404а");
  assert.equal(parseGroup("по2б2405а", known).prefix, "ПО2");
  // Группы нет в списке: префикс по заглавным буквам или самый короткий подходящий.
  assert.equal(parseGroup("ЭКБВД2601А", known).name, "ЭКбвд-2601а");
  assert.equal(parseGroup("юрмд2611а", null).name, "ЮРмд-2611а");
  assert.equal(groupKey("ЮРмд - 2411а"), "юрмд2411а");
});

test("inferFromGroup принимает номер в любом виде и возвращает каноничный", () => {
  const r = inferFromGroup("юрмд2406а", catalog, groups);
  assert.equal(r.name, "ЮРмд-2406а");
  assert.equal(r.known, true);
});

test("matchPlan: план чужого направления с тем же номером не подходит", () => {
  const mixed = [
    plan({ id: "15.04.01_07_2025_3++", code: "15.04.01", direction: "Машиностроение", number: "07", year: 2025,
      distance: false, formLetter: "", institute: "", instituteId: null, profile: "Цифровые двойники" }),
    plan({ id: "z40.04.01_07_do1_2025_3++", number: "07", year: 2025, profile: "Правовое обеспечение предпринимательской деятельности" }),
  ];
  const r = matchPlan(parseGroup("ЮРмп-2507а"), mixed, "law");
  assert.equal(r.plan.id, "z40.04.01_07_do1_2025_3++");
  assert.equal(matchPlan(parseGroup("ЮРмп-2507а"), [mixed[0]], "law").plan, null);
});

test("курс и семестр можно задать вручную (сдвиг у Росдистанта)", () => {
  const oct2026 = new Date(2026, 9, 20);
  const p = plan({ periodUnit: "course" });
  assert.equal(currentPeriod(p, oct2026).course, 3);
  const override = { group: "ПИНЖбд-2401а", course: 2, semester: 4 };
  assert.deepEqual([currentPeriod(p, oct2026, override).course, currentPeriod(p, oct2026, override).semester], [2, 4]);
  assert.deepEqual(planDisciplines(p, oct2026, override).current, ["Проблемы семейного права"]);
  assert.equal(planCourses(p), 3);
});
