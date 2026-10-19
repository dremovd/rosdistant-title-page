// Определение программы по номеру группы.
// Номер вида «ЮРмд-2411а»: префикс направления (ЮР), уровень (м — магистратура),
// признаки формы (в — очно-заочная, д — дистанционно), год набора (24),
// номер профиля (11) и подгруппа (а). Номер профиля и год совпадают с учебным планом
// «z40.04.01_11_do1_2024» (z — заочная, v — очно-заочная, do — дистанционно),
// из которого берутся профиль, кафедра и дисциплины. Без плана направление подбирается
// по буквам префикса. Результат только предлагается, пользователь его проверяет.

import { normalizeName } from "./format.js";

const GROUP_RE = /^([А-ЯЁ][А-ЯЁ0-9]*?)(спо|[бмса])([а-яё]*)-(\d{2})(\d{2})([а-яё]?)$/u;
const LEVELS = { б: "Бакалавриат", м: "Магистратура", с: "Специалитет", а: "Аспирантура", спо: "СПО" };
const STOP_WORDS = new Set(["и", "в", "по", "для", "с", "на"]);

export function normalizeGroup(value) {
  return String(value ?? "").replace(/\s+/g, "").replace(/[‐-―−]/g, "-");
}

export function parseGroup(value) {
  const name = normalizeGroup(value);
  const m = name.match(GROUP_RE);
  if (!m) return null;
  const flags = m[3];
  return {
    name,
    prefix: m[1],
    level: LEVELS[m[2]],
    year: 2000 + Number(m[4]),
    number: m[5],
    distance: flags.includes("д"),
    // Буква формы в имени плана: v — очно-заочная, z — заочная, "" — очная.
    formLetter: flags.includes("в") ? "v" : /[дп]/.test(flags) ? "z" : "",
  };
}

// Учебный план группы: тот же год набора, номер, уровень и институт; затем —
// дистанционность, форма и похожесть префикса на направление. Каждый шаг сужает
// список, только если что-то остаётся.
// Планы направлений с одним профилем без номера — запасной вариант, если по номеру ничего нет.
export function matchPlan(parsed, plans, instituteId) {
  if (!parsed || !plans?.length) return { plan: null, candidates: [] };
  const base = plans.filter((p) => p.year === parsed.year && p.level === parsed.level &&
    (!instituteId || !p.instituteId || p.instituteId === instituteId));
  let list = base.filter((p) => p.number === parsed.number);
  if (!list.length) {
    list = base.filter((p) => p.number === null && scoreDirection(parsed.prefix, p.direction) >= 3);
  }
  const narrow = (pred) => {
    const next = list.filter(pred);
    if (next.length) list = next;
  };
  narrow((p) => p.distance === parsed.distance);
  narrow((p) => p.formLetter === parsed.formLetter);
  const scores = list.map((p) => scoreDirection(parsed.prefix, p.direction));
  const best = Math.max(0, ...scores);
  if (best > 0) list = list.filter((_, i) => scores[i] === best);
  const variants = new Set(list.map((p) => `${p.code}|${p.profile}`));
  return { plan: variants.size === 1 ? list[0] : null, candidates: list };
}

// Текущий курс и семестр по году набора. Учебный год начинается 1 сентября.
export function currentPeriod(plan, date = new Date()) {
  const month = date.getMonth();
  const startYear = month >= 8 ? date.getFullYear() : date.getFullYear() - 1;
  const course = startYear - plan.year + 1;
  const semester = (course - 1) * 2 + (month >= 8 || month === 0 ? 1 : 2);
  return plan.periodUnit === "course"
    ? { course, semester, period: course, label: `${course}-й курс` }
    : { course, semester, period: semester, label: `${semester}-й семестр (${course}-й курс)` };
}

// Дисциплины плана: сначала текущего периода, затем остальные.
export function planDisciplines(plan, date = new Date()) {
  const { period } = currentPeriod(plan, date);
  const current = plan.disciplines.filter(([, periods]) => periods.includes(period)).map(([name]) => name);
  const other = plan.disciplines.map(([name]) => name).filter((name) => !current.includes(name));
  return { current, other };
}

const words = (text) =>
  text.toLowerCase().replace(/ё/g, "е").split(/[^а-яa-z0-9]+/u).filter((w) => w && !STOP_WORDS.has(w));

function isSubsequence(pattern, text) {
  let j = 0;
  for (const ch of text) {
    if (ch === pattern[j]) j++;
    if (j === pattern.length) return true;
  }
  return pattern.length === 0;
}

// 4 — начало названия или первые буквы слов; 3 — буквы внутри первого слова;
// 2 — по первому и следующим словам; 1 — с любого слова; 0 — не похоже.
export function scoreDirection(prefix, direction) {
  const p = prefix.toLowerCase().replace(/ё/g, "е").replace(/\d/g, "");
  const ws = words(direction);
  if (!p || !ws.length) return 0;
  if (ws[0].startsWith(p) || ws.map((w) => w[0]).join("").startsWith(p)) return 4;
  if (ws[0][0] === p[0] && isSubsequence(p, ws[0])) return 3;
  if (ws[0][0] === p[0] && isSubsequence(p, ws.join(""))) return 2;
  const start = ws.findIndex((w) => w[0] === p[0]);
  return start >= 0 && isSubsequence(p, ws.slice(start).join("")) ? 1 : 0;
}

/**
 * @param {string} value  номер группы
 * @param {object} catalog  data/catalog.json
 * @param {{groups: Array<[string, string|null, number]>}|null} groups  data/groups.json
 * @param {{plans: object[]}|null} plans  data/plans.json
 * @returns {null | {name, known, instituteId, level, year, plan, programs, departmentIds, directions}}
 */
export function inferFromGroup(value, catalog, groups, plans = null) {
  const parsed = parseGroup(value);
  if (!parsed || !catalog) return null;
  const record = groups?.groups.find(([name]) => name.toLowerCase() === parsed.name.toLowerCase());
  const instituteId = record?.[1] ?? null;
  const eduform = record?.[2] ?? null;

  const { plan } = matchPlan(parsed, plans?.plans, instituteId);
  if (plan) {
    const same = (a, b) => normalizeName(a) === normalizeName(b);
    let programs = catalog.programs.filter((p) => p.code === plan.code && same(p.profile, plan.profile) &&
      (!plan.instituteId || p.instituteId === plan.instituteId));
    const byForm = programs.filter((p) => same(p.form, plan.form));
    if (byForm.length) programs = byForm;
    const departments = catalog.departments.filter((d) => normalizeName(d.name).includes(normalizeName(plan.department)));
    const byDepartment = programs.filter((p) => departments.some((d) => d.id === p.departmentId));
    if (byDepartment.length) programs = byDepartment;
    return {
      name: record?.[0] ?? parsed.name,
      known: Boolean(record),
      instituteId: plan.instituteId ?? instituteId ?? programs[0]?.instituteId ?? null,
      level: parsed.level,
      year: parsed.year,
      plan,
      department: departments.length === 1 ? departments[0] : null,
      programs,
      departmentIds: [...new Set(programs.map((p) => p.departmentId))],
      directions: [`${plan.code} ${plan.direction}`],
    };
  }

  let pool = catalog.programs.filter((p) => p.level === parsed.level && (!instituteId || p.instituteId === instituteId));
  const scored = pool.map((p) => [scoreDirection(parsed.prefix, p.direction), p]).filter(([s]) => s > 0);
  const best = Math.max(0, ...scored.map(([s]) => s));
  let programs = scored.filter(([s]) => s === best).map(([, p]) => p);

  // Форма обучения из расписания: 1 — очная, 2 — заочная/очно-заочная. Сужаем, только если что-то остаётся.
  if (eduform === 1 || eduform === 2) {
    const byForm = programs.filter((p) => (eduform === 1) === (p.form === "Очная"));
    if (byForm.length) programs = byForm;
  }

  const unique = (list) => [...new Set(list)];
  return {
    name: record?.[0] ?? parsed.name,
    known: Boolean(record),
    instituteId: instituteId ?? (unique(programs.map((p) => p.instituteId)).length === 1 ? programs[0].instituteId : null),
    level: parsed.level,
    year: parsed.year,
    plan: null,
    department: null,
    programs,
    departmentIds: unique(programs.map((p) => p.departmentId)),
    directions: unique(programs.map((p) => `${p.code} ${p.direction}`)),
  };
}
