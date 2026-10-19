// Разбор PDF учебного плана ТГУ (выгрузка из «Планы» ММИС, файлы *.plx).
// Нужны: идентификатор плана, профиль, кафедра, институт, год, форма и
// дисциплины с номерами семестров из колонок «Экзамен / Зачёт / Зачёт с оц. / КП / КР».
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const clean = (s) => s.replace(/\s+/g, " ").trim();
const INDEX_RE = /^(Б\d|ФТД)(\.[\wА-Яа-яЁё]+)*(\([А-ЯЁа-яё]+\))?$/u;
const SECTION_NAMES = /^(Обязательная часть|Часть, формируемая участниками образовательных отношений|Государственная итоговая аттестация|Факультативные дисциплины|Элективные дисциплины.*)$/;
const SEMESTER_RE = /^[0-9A-FА-Г]+$/u;
// Семестры больше 9 в выгрузке обозначаются буквами.
const semesterNumber = (ch) => (/\d/.test(ch) ? Number(ch) : 10 + "ABCDEF".indexOf(ch.toUpperCase().replace("А", "A").replace("В", "B")));

// Идентификатор плана: [z|v]<код>[_<номер>][_do<n>]_<год>_...plx
// z — заочная, v — очно-заочная, без буквы — очная; do — дистанционное обучение.
// У направлений с одним профилем номера нет: «27.03.02_2023_3++.plx» → number = null.
export function parsePlanId(text) {
  const m = text.match(/\b([zv]?)(\d{2}\.\d{2}\.\d{2})(?:_(\d{2}))?((?:_[a-z]+\d*)*)_(\d{4})_[^\s'"]*\.plx/);
  if (!m) return null;
  return {
    id: m[0].replace(/\.plx$/, ""),
    formLetter: m[1],
    code: m[2],
    number: m[3] ?? null,
    distance: /_do\d*/.test(m[4]),
    year: Number(m[5]),
  };
}

async function pageItems(page) {
  const { items } = await page.getTextContent();
  return items
    .filter((i) => i.str.trim())
    .map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5] }));
}

function headerValue(lines, label) {
  const line = lines.find((l) => l.startsWith(label));
  return line ? clean(line.slice(label.length)) : "";
}

// Строки страницы 1: собираем по y, слева направо.
function textLines(items) {
  const byY = new Map();
  for (const it of items) {
    const key = Math.round(it.y);
    if (!byY.has(key)) byY.set(key, []);
    byY.get(key).push(it);
  }
  return [...byY.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, list]) => clean(list.sort((a, b) => a.x - b.x).map((i) => i.s).join(" ")));
}

function columns(items) {
  const find = (re) => items.find((i) => re.test(i.s.trim()));
  const exam = find(/^Экза$/);
  const expert = items.filter((i) => /^Экспер$/.test(i.s.trim())).sort((a, b) => a.x - b.x)[0];
  const name = find(/^Наименование$/);
  if (!exam || !expert || !name) return null;
  return { nameX: name.x - 25, semFrom: exam.x - 2, semTo: expert.x - 1 };
}

function disciplinesFromPage(items, cols) {
  const indexes = items.filter((i) => i.x < cols.nameX && INDEX_RE.test(i.s.trim()));
  if (!indexes.length) return [];
  const rows = indexes.map((i) => ({ index: i.s.trim(), y: i.y, name: [], sem: "" }));
  const nearest = (y) => rows.reduce((best, r) => (Math.abs(r.y - y) < Math.abs(best.y - y) ? r : best));
  for (const it of items) {
    if (it.x >= cols.nameX && it.x < cols.semFrom) {
      const row = nearest(it.y);
      if (Math.abs(row.y - it.y) <= 5) row.name.push(it);
    } else if (it.x >= cols.semFrom && it.x < cols.semTo && SEMESTER_RE.test(it.s.trim())) {
      const row = nearest(it.y);
      if (Math.abs(row.y - it.y) <= 1.5) row.sem += it.s.trim();
    }
  }
  return rows.map((r) => ({
    index: r.index,
    name: clean(r.name.sort((a, b) => b.y - a.y || a.x - b.x).map((i) => i.s).join(" ")).replace(/- /g, "-"),
    semesters: [...new Set([...r.sem].map(semesterNumber))].filter((n) => n > 0).sort((a, b) => a - b),
  }));
}

/**
 * periods — номера, в которых стоит контроль: для заочной формы это курсы
 * (таблица разбита по сессиям курсов), для остальных — семестры; см. periodUnit.
 * @returns {Promise<null | {id, formLetter, code, number, distance, year, direction, profile, department, institute, form, periodUnit, disciplines}>}
 */
export async function parsePlanPdf(data) {
  const doc = await getDocument({ data, verbosity: 0, isEvalSupported: false }).promise;
  try {
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) pages.push(await pageItems(await doc.getPage(p)));
    const allText = pages.flat().map((i) => i.s).join(" ");
    const plan = parsePlanId(allText);
    if (!plan) return null;

    const lines = textLines(pages[0]);
    const profile = headerValue(lines, "Профиль:") || headerValue(lines, "Направленность (профиль):") ||
      headerValue(lines, "Направленности (профили):") || headerValue(lines, "Специализация:");
    const directionLine = lines.find((l) => /^(Направлени[ея] подготовки|Специальность)\s+\d{2}\.\d{2}\.\d{2}/.test(l)) ?? "";
    const direction = clean(directionLine.replace(/^.*?\d{2}\.\d{2}\.\d{2}/, ""));
    const department = headerValue(lines, "Кафедра:");
    const institute = headerValue(lines, "Институт:");
    const form = headerValue(lines, "Форма обучения:").split(" ")[0] ?? "";

    let cols = null;
    const all = [];
    for (const items of pages.slice(1)) {
      cols = columns(items) ?? cols;
      if (cols) all.push(...disciplinesFromPage(items, cols));
    }
    // Модули с вложенными дисциплинами (Б1.О.02 при наличии Б1.О.02.01) не нужны.
    const indexes = new Set(all.map((d) => d.index));
    const disciplines = all
      .filter((d) => d.name && !SECTION_NAMES.test(d.name) && ![...indexes].some((i) => i.startsWith(`${d.index}.`)))
      .map(({ name, semesters }) => ({ name, periods: semesters }));
    const periodUnit = pages.slice(1).flat().some((i) => /сессия/i.test(i.s)) ? "course" : "semester";
    return { ...plan, direction, profile, department, institute, form, periodUnit, disciplines };
  } finally {
    await doc.destroy();
  }
}
