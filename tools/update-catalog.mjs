// Собирает справочники с публичных страниц tltsu.ru:
//   data/catalog.json — институты, подразделения, программы, дисциплины;
//   data/staff.json   — преподаватели программ и их дисциплины («Педагогический состав»);
//   data/groups.json  — номера групп с институтом и формой обучения (открытый API расписания).
// Запускается при сборке (GitHub Actions), не в браузере: у tltsu.ru закрыт CORS.
//   node tools/update-catalog.mjs
// При сбое сети или подозрительном результате завершается с ошибкой,
// не трогая существующие файлы (ТЗ §4.4).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parse } from "node-html-parser";
import { normalizeName, programKey } from "../src/lib/format.js";

const BASE = "https://www.tltsu.ru";
const INDEX_URL = `${BASE}/education/institutions`;
const ALLOWED_PREFIX = `${BASE}/education/institutions/`;
const STAFF_INDEX_URL = `${BASE}/sveden/employees`;
const STAFF_PREFIX = `${BASE}/sveden/direction/`;
const GROUPS_API = "https://its.tltsu.ru/api/groups";
const INSTITUTES_API = "https://its.tltsu.ru/api/institutes";
const ALLOWED = [INDEX_URL, ALLOWED_PREFIX, STAFF_INDEX_URL, STAFF_PREFIX, GROUPS_API, INSTITUTES_API];
const OUT = new URL("../data/catalog.json", import.meta.url).pathname;
const STAFF_OUT = new URL("../data/staff.json", import.meta.url).pathname;
const GROUPS_OUT = new URL("../data/groups.json", import.meta.url).pathname;
// Сокращения институтов в API расписания → идентификаторы каталога.
const API_INSTITUTES = {
  "ИФЭиУ": "institut-finansov-ekonomiki-i-upravleniia",
  "ГумПИ": "gumanitarno-pedagogiceskii-institut",
  "ИнПр": "institut-prava",
  "ИФКиС": "institut-fiziceskoi-kultury-i-sporta",
  "ИИиЭБ": "institut-inzenernoi-i-ekologiceskoi-bezopasnosti",
  "ИОП": "institut-obshheinzenernoi-podgotovki",
  "ИЦТ": "institut-cifrovyx-texnologii",
  "ИМХиЭ": "institut-masinostroeniia-ximii-i-energetiki",
  "ИБАиБМС": "institut-bespilotnoi-aviacii-i-bespilotnyx-mobilnyx-sistem",
  "ИКИСиА": "institut-kreativnyx-industrii-stroitelstva-i-arxitektury",
};
const PARSER_VERSION = 2;
const TIMEOUT_MS = 90_000;
const MIN_SHARE_OF_PREVIOUS = 0.7;
// Страницы tltsu.ru весят ~1 МБ и отдаются ~9 с, поэтому грузим параллельно.
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY) || 20);

const clean = (s) => s.replace(/\s+/g, " ").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Параллельная обработка с ограничением; результаты — в исходном порядке.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// null — страница не найдена (404); вызывающий решает, критично ли это.
async function fetchPage(url) {
  if (!ALLOWED.some((prefix) => url === prefix || url.startsWith(prefix))) throw new Error(`URL вне списка разрешённых: ${url}`);
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "User-Agent": "rosdistant-title-page catalog builder (+https://github.com/dremovd/rosdistant-title-page)" },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parse(await res.text());
    } catch (err) {
      if (attempt >= 3) throw new Error(`${url}: ${err.message}`);
      await sleep(2000 * attempt);
    }
  }
}

function required(root, url) {
  if (!root) throw new Error(`${url}: HTTP 404`);
  return root;
}

const slugOf = (url) => url.slice(ALLOWED_PREFIX.length).replace(/\/+$/, "");

function childLinks(root, parentUrl) {
  const prefix = parentUrl.replace(/\/+$/, "") + "/";
  const links = root
    .querySelectorAll("a[href]")
    .map((a) => a.getAttribute("href").replace(/[?#].*$/, "").replace(/\/+$/, ""))
    .map((href) => (href.startsWith("/") ? BASE + href : href))
    .filter((href) => href.startsWith(prefix) && !href.slice(prefix.length).includes("/"));
  return [...new Set(links)];
}

function pageTitle(root, url) {
  const h1 = root.querySelector("h1");
  const title = h1 && clean(h1.text);
  if (!title) throw new Error(`${url}: нет заголовка h1 — изменилась вёрстка?`);
  return title;
}

// Блок «Направления подготовки / специальности» и «Дисциплины» — оба h3 с соседним содержимым.
function sectionAfter(root, heading) {
  const h3 = root.querySelectorAll("h3").find((h) => clean(h.text) === heading);
  return h3 ? h3.parentNode : null;
}

function slideTitle(slide) {
  const title = slide.querySelector("template div") ?? slide.querySelector("div");
  return title ? clean(title.text) : "";
}

const LEVELS = [
  ["бакалавриат", "Бакалавриат"],
  ["магистратур", "Магистратура"],
  ["специалитет", "Специалитет"],
  ["аспирантур", "Аспирантура"],
  ["спо", "СПО"],
];
const levelOf = (title) => LEVELS.find(([needle]) => title.toLowerCase().includes(needle))?.[1] ?? title;

function splitForm(item) {
  const m = item.match(/^(.*\S)\s*\(([^()]+)\)$/);
  return m ? { profile: clean(m[1]), form: clean(m[2]) } : { profile: clean(item), form: "" };
}

function parsePrograms(root, url) {
  const section = sectionAfter(root, "Направления подготовки / специальности");
  if (!section) return [];
  const programs = [];
  for (const slide of section.querySelectorAll("slide-component")) {
    const level = levelOf(slideTitle(slide));
    // Внутри слайда: div с «код название», за ним section со списком профилей.
    for (const block of slide.childNodes.filter((n) => n.tagName === "DIV")) {
      const head = block.querySelector("div");
      const m = head && clean(head.text).match(/^(\d{2}\.\d{2}\.\d{2})\s+(.+)$/);
      if (!m) continue;
      const items = block.querySelectorAll("li").map((li) => clean(li.text)).filter(Boolean);
      for (const item of items.length ? items : [""]) {
        programs.push({ level, code: m[1], direction: m[2], ...splitForm(item), label: item });
      }
    }
  }
  if (!programs.length && /\d{2}\.\d{2}\.\d{2}/.test(section.text)) {
    throw new Error(`${url}: коды направлений есть, но не разобраны — изменилась вёрстка?`);
  }
  return programs;
}

function parseDisciplines(root) {
  const section = sectionAfter(root, "Дисциплины");
  const byLabel = new Map();
  if (!section) return byLabel;
  for (const slide of section.querySelectorAll("slide-component")) {
    const label = slideTitle(slide);
    const list = slide.querySelectorAll("li").map((li) => clean(li.text)).filter(Boolean);
    if (label && list.length) byLabel.set(label, [...new Set([...(byLabel.get(label) ?? []), ...list])]);
  }
  return byLabel;
}

async function main() {
  const institutes = [];
  const departments = [];
  const programs = [];
  const disciplines = {};

  const index = required(await fetchPage(INDEX_URL), INDEX_URL);
  const instituteUrls = childLinks(index, INDEX_URL);
  if (instituteUrls.length < 3) throw new Error(`найдено институтов: ${instituteUrls.length} — изменилась вёрстка?`);

  function addPage(root, url, instituteId, departmentId) {
    const found = parsePrograms(root, url);
    const byLabel = parseDisciplines(root);
    for (const p of found) {
      const id = [departmentId ?? instituteId, p.code, p.label || "-"].join("|");
      if (programs.some((x) => x.id === id)) continue;
      const { label, ...rest } = p;
      programs.push({ id, instituteId, departmentId, ...rest, sourceUrl: url });
      const list = byLabel.get(label);
      if (list) disciplines[id] = list;
    }
    return found.length;
  }

  const instRoots = await mapLimit(instituteUrls, CONCURRENCY, async (url) => required(await fetchPage(url), url));
  const depLists = instituteUrls.map((url, i) => childLinks(instRoots[i], url));
  const depUrlsAll = depLists.flat();
  let done = 0;
  const depRootsAll = await mapLimit(depUrlsAll, CONCURRENCY, async (url) => {
    const root = required(await fetchPage(url), url);
    console.log(`  [${++done}/${depUrlsAll.length}] ${slugOf(url)}`);
    return root;
  });
  const depRoot = new Map(depUrlsAll.map((url, i) => [url, depRootsAll[i]]));

  // Разбор — последовательно и в порядке сайта, чтобы diff справочника был стабильным.
  instituteUrls.forEach((instUrl, i) => {
    const instRoot = instRoots[i];
    const instituteId = slugOf(instUrl);
    institutes.push({ id: instituteId, name: pageTitle(instRoot, instUrl), url: instUrl });

    const depUrls = depLists[i];
    for (const depUrl of depUrls) {
      const root = depRoot.get(depUrl);
      const departmentId = slugOf(depUrl);
      departments.push({ id: departmentId, instituteId, name: pageTitle(root, depUrl), url: depUrl });
      addPage(root, depUrl, instituteId, departmentId);
    }
    // Программы, указанные только на странице института (без подразделения).
    const before = programs.length;
    const listed = new Set(programs.filter((p) => p.instituteId === instituteId).map((p) => `${p.code}|${p.profile}|${p.form}`));
    for (const p of parsePrograms(instRoot, instUrl)) {
      if (listed.has(`${p.code}|${p.profile}|${p.form}`)) continue;
      const id = [instituteId, p.code, p.label || "-"].join("|");
      const { label, ...rest } = p;
      programs.push({ id, instituteId, departmentId: null, ...rest, sourceUrl: instUrl });
      const list = parseDisciplines(instRoot).get(label);
      if (list) disciplines[id] = list;
    }
    console.log(`${instituteId}: ${depUrls.length} подразделений, ${programs.length - before} программ только на странице института`);
  });

  if (!programs.length) throw new Error("не найдено ни одной программы");
  if (existsSync(OUT)) {
    const prev = JSON.parse(readFileSync(OUT, "utf8"));
    if (prev.programs?.length && programs.length < prev.programs.length * MIN_SHARE_OF_PREVIOUS) {
      throw new Error(`программ стало ${programs.length}, было ${prev.programs.length} — результат не принят`);
    }
  }

  const fetchedAt = new Date().toISOString();
  const catalog = {
    catalogVersion: 1,
    parserVersion: PARSER_VERSION,
    fetchedAt,
    sources: [INDEX_URL],
    institutes,
    departments,
    programs,
    disciplines,
  };
  const staff = await collectStaff(fetchedAt, institutes, departments);
  const groups = await collectGroups(fetchedAt, institutes);

  const covered = programs.filter((p) => staff.programs[programKey(p.code, p.profile || p.direction)]).length;
  writeFileSync(OUT, JSON.stringify(catalog, null, 1) + "\n");
  writeFileSync(STAFF_OUT, JSON.stringify(staff, null, 1) + "\n");
  writeFileSync(GROUPS_OUT, JSON.stringify(groups, null, 1) + "\n");
  console.log(`Готово: ${institutes.length} институтов, ${departments.length} подразделений, ${programs.length} программ, ` +
    `дисциплины для ${Object.keys(disciplines).length} программ -> ${OUT}`);
  console.log(`Преподаватели: ${staff.people.length} человек, ${Object.keys(staff.programs).length} программ; ` +
    `сопоставлено с каталогом ${covered} из ${programs.length} -> ${STAFF_OUT}`);
}

// «Педагогический состав»: таблица программ со ссылками на страницы
// «Информация о составе педагогических работников образовательной программы».
// Сохраняем только ФИО, должность и дисциплины в этой программе — без контактов.
async function collectStaff(fetchedAt, institutes, departments) {
  const index = required(await fetchPage(STAFF_INDEX_URL), STAFF_INDEX_URL);
  const rows = [];
  for (const tr of index.querySelectorAll("table tbody tr")) {
    const cells = tr.querySelectorAll("td").map((td) => clean(td.text));
    const href = tr.querySelector(`a[href^="${STAFF_PREFIX}"]`)?.getAttribute("href");
    if (cells.length >= 3 && /^\d{2}\.\d{2}\.\d{2}$/.test(cells[0]) && href) {
      rows.push({ code: cells[0], direction: cells[1], profile: cells[2], url: href });
    }
  }
  if (rows.length < 20) throw new Error(`${STAFF_INDEX_URL}: найдено программ ${rows.length} — изменилась вёрстка?`);

  const people = [];
  const personIndex = new Map();
  const personUrls = [];
  const result = {};
  const seenUrls = new Set();
  const unique = rows.filter((row) => {
    if (seenUrls.has(row.url)) {
      console.warn(`  одна страница на несколько программ, пропускаю повтор: ${row.code} ${row.profile}`);
      return false;
    }
    seenUrls.add(row.url);
    return true;
  });
  let done = 0;
  const roots = await mapLimit(unique, CONCURRENCY, async (row) => {
    const root = required(await fetchPage(row.url), row.url);
    console.log(`  [${++done}/${unique.length}] ${row.code} ${row.profile}`);
    return root;
  });

  unique.forEach((row, i) => {
    const root = roots[i];
    const title = clean(root.querySelector("h1")?.text ?? "");
    if (!title.includes(row.code)) {
      console.warn(`  заголовок не совпадает с программой (${row.code} ${row.profile}): ${title}`);
      return;
    }
    const staff = [];
    for (const tr of root.querySelectorAll('tr[itemprop="teachingStaff"]')) {
      const fioCell = tr.querySelector('td[itemprop="fio"]');
      const name = clean(fioCell?.text ?? "");
      if (!name) continue;
      const href = fioCell.querySelector("a")?.getAttribute("href") ?? "";
      const id = href.split("/").pop() || name;
      const post = clean(tr.querySelector('td[itemprop="post"]')?.text ?? "");
      const list = (tr.querySelector('td[itemprop="teachingDiscipline"]')?.querySelectorAll("li") ?? [])
        .map((li) => clean(li.text))
        .filter(Boolean);
      if (!personIndex.has(id)) {
        personIndex.set(id, people.length);
        people.push([name, post]);
        personUrls.push(href.startsWith(`${STAFF_INDEX_URL}/`) ? href : null);
      }
      staff.push([personIndex.get(id), [...new Set(list)]]);
    }
    if (staff.length) result[programKey(row.code, row.profile)] = { url: row.url, staff };
  });

  const total = Object.values(result).reduce((n, p) => n + p.staff.length, 0);
  if (!total) throw new Error("не найдено ни одного преподавателя — изменилась вёрстка?");
  if (existsSync(STAFF_OUT)) {
    const prev = JSON.parse(readFileSync(STAFF_OUT, "utf8"));
    const prevTotal = Object.values(prev.programs ?? {}).reduce((n, p) => n + p.staff.length, 0);
    if (prevTotal && total < prevTotal * MIN_SHARE_OF_PREVIOUS) {
      throw new Error(`записей о преподавателях стало ${total}, было ${prevTotal} — результат не принят`);
    }
  }
  const profiles = await collectProfiles(personUrls, institutes, departments);
  return {
    staffVersion: 2, parserVersion: PARSER_VERSION, fetchedAt, sources: [STAFF_INDEX_URL],
    people, profiles, programs: result,
  };
}

// Личные страницы преподавателей: подразделение и полный список дисциплин.
// Нужны, когда в таблице программы преподаватель курса не указан.
// Сохраняем только привязку к институту/подразделению и дисциплины — без контактов.
// profiles[i] = [instituteIds, departmentIds, disciplines] для people[i].
async function collectProfiles(personUrls, institutes, departments) {
  const urls = personUrls.filter(Boolean);
  let done = 0;
  const pages = await mapLimit(personUrls, CONCURRENCY, async (url) => {
    if (!url) return null;
    const root = await fetchPage(url);
    if (++done % 50 === 0 || done === urls.length) console.log(`  личные страницы: ${done}/${urls.length}`);
    return root;
  });

  const instituteNames = institutes.map((i) => [i.id, normalizeName(i.name)]);
  const departmentNames = departments.map((d) => [d.id, normalizeName(d.name)]);
  let withDisciplines = 0;
  const profiles = pages.map((root) => {
    if (!root) return [[], [], []];
    const unitLabel = root.querySelectorAll("div").find((d) => clean(d.text) === "Подразделение" && !d.querySelector("div"));
    const unit = normalizeName(unitLabel?.nextElementSibling?.text ?? "");
    const heading = root.querySelectorAll("h2").find((h) => clean(h.text) === "Дисциплины");
    const disciplines = heading
      ? [...new Set(heading.parentNode.querySelectorAll("li").map((li) => clean(li.text)).filter(Boolean))]
      : [];
    if (disciplines.length) withDisciplines++;
    return [
      instituteNames.filter(([, name]) => unit.includes(name)).map(([id]) => id),
      departmentNames.filter(([, name]) => unit.includes(name)).map(([id]) => id),
      disciplines,
    ];
  });
  if (urls.length && withDisciplines < urls.length * 0.3) {
    throw new Error(`дисциплины найдены только на ${withDisciplines} из ${urls.length} личных страниц — изменилась вёрстка?`);
  }
  const linked = profiles.filter(([inst]) => inst.length).length;
  const missing = urls.length - pages.filter(Boolean).length;
  console.log(`Личные страницы: ${urls.length} (не найдено ${missing}), с дисциплинами ${withDisciplines}, привязаны к институту ${linked}`);
  return profiles;
}

async function fetchJson(url) {
  if (!ALLOWED.includes(url)) throw new Error(`URL вне списка разрешённых: ${url}`);
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 3) throw new Error(`${url}: ${err.message}`);
      await sleep(2000 * attempt);
    }
  }
}

// Открытый API расписания (rasp.tltsu.ru). Берём только номер группы, институт
// и признак формы обучения; списков студентов там нет и мы их не запрашиваем.
async function collectGroups(fetchedAt, institutes) {
  const [apiInstitutes, apiGroups] = await Promise.all([fetchJson(INSTITUTES_API), fetchJson(GROUPS_API)]);
  const known = new Set(institutes.map((i) => i.id));
  for (const inst of apiInstitutes) {
    const id = API_INSTITUTES[inst.name];
    if (!id || !known.has(id)) console.warn(`  институт API расписания «${inst.name}» не сопоставлен с каталогом`);
  }
  const groups = apiGroups
    .filter((g) => typeof g.name === "string" && g.name.trim())
    .map((g) => {
      const id = API_INSTITUTES[g.institute?.name];
      return [clean(g.name), id && known.has(id) ? id : null, g.eduform ?? null];
    })
    .sort((a, b) => a[0].localeCompare(b[0], "ru"));
  if (groups.length < 100) throw new Error(`групп в API расписания: ${groups.length} — что-то не так`);
  if (existsSync(GROUPS_OUT)) {
    const prev = JSON.parse(readFileSync(GROUPS_OUT, "utf8"));
    if (prev.groups?.length && groups.length < prev.groups.length * MIN_SHARE_OF_PREVIOUS) {
      throw new Error(`групп стало ${groups.length}, было ${prev.groups.length} — результат не принят`);
    }
  }
  console.log(`Группы: ${groups.length}, с институтом ${groups.filter((g) => g[1]).length}`);
  return { groupsVersion: 1, fetchedAt, sources: [GROUPS_API], groups };
}

main().catch((err) => {
  console.error(`Ошибка: ${err.message}`);
  process.exit(1);
});
