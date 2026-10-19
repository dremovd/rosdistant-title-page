// Предварительное определение программы по номеру группы.
// Номер вида «ЮРмд-2406а»: префикс направления (ЮР), уровень (м — магистратура),
// признаки формы (д), год набора (24), номер и подгруппа. Префиксы не опубликованы
// как справочник, поэтому направление подбирается по совпадению букв с названием —
// результат только предлагается, пользователь подтверждает выбор.

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
  return { name, prefix: m[1], level: LEVELS[m[2]], year: 2000 + Number(m[4]) };
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
 * @returns {null | {name, known, instituteId, level, year, programs, departmentIds, directions}}
 */
export function inferFromGroup(value, catalog, groups) {
  const parsed = parseGroup(value);
  if (!parsed || !catalog) return null;
  const record = groups?.groups.find(([name]) => name.toLowerCase() === parsed.name.toLowerCase());
  const instituteId = record?.[1] ?? null;
  const eduform = record?.[2] ?? null;

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
    programs,
    departmentIds: unique(programs.map((p) => p.departmentId)),
    directions: unique(programs.map((p) => `${p.code} ${p.direction}`)),
  };
}
