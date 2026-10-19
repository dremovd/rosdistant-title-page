// Собирает справочник программ и дисциплин с публичных страниц tltsu.ru.
// Запускается при сборке (GitHub Actions), не в браузере: у tltsu.ru закрыт CORS.
//   node tools/update-catalog.mjs [data/catalog.json]
// При сбое сети или подозрительном результате завершается с ошибкой,
// не трогая существующий файл (ТЗ §4.4).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parse } from "node-html-parser";

const BASE = "https://www.tltsu.ru";
const INDEX_URL = `${BASE}/education/institutions`;
const ALLOWED_PREFIX = `${BASE}/education/institutions/`;
const OUT = process.argv[2] ?? new URL("../data/catalog.json", import.meta.url).pathname;
const PARSER_VERSION = 1;
const TIMEOUT_MS = 30_000;
const MIN_SHARE_OF_PREVIOUS = 0.7;

const clean = (s) => s.replace(/\s+/g, " ").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(url) {
  if (url !== INDEX_URL && !url.startsWith(ALLOWED_PREFIX)) throw new Error(`URL вне списка разрешённых: ${url}`);
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "User-Agent": "rosdistant-title-page catalog builder (+https://github.com/dremovd/rosdistant-title-page)" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parse(await res.text());
    } catch (err) {
      if (attempt >= 3) throw new Error(`${url}: ${err.message}`);
      await sleep(2000 * attempt);
    }
  }
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

  const index = await fetchPage(INDEX_URL);
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

  for (const instUrl of instituteUrls) {
    await sleep(300);
    const instRoot = await fetchPage(instUrl);
    const instituteId = slugOf(instUrl);
    institutes.push({ id: instituteId, name: pageTitle(instRoot, instUrl), url: instUrl });

    const depUrls = childLinks(instRoot, instUrl);
    for (const depUrl of depUrls) {
      await sleep(300);
      const depRoot = await fetchPage(depUrl);
      const departmentId = slugOf(depUrl);
      departments.push({ id: departmentId, instituteId, name: pageTitle(depRoot, depUrl), url: depUrl });
      const n = addPage(depRoot, depUrl, instituteId, departmentId);
      console.log(`  ${departmentId}: ${n} программ`);
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
  }

  if (!programs.length) throw new Error("не найдено ни одной программы");
  if (existsSync(OUT)) {
    const prev = JSON.parse(readFileSync(OUT, "utf8"));
    if (prev.programs?.length && programs.length < prev.programs.length * MIN_SHARE_OF_PREVIOUS) {
      throw new Error(`программ стало ${programs.length}, было ${prev.programs.length} — результат не принят`);
    }
  }

  const catalog = {
    catalogVersion: 1,
    parserVersion: PARSER_VERSION,
    fetchedAt: new Date().toISOString(),
    sources: [INDEX_URL],
    institutes,
    departments,
    programs,
    disciplines,
  };
  writeFileSync(OUT, JSON.stringify(catalog, null, 1) + "\n");
  console.log(`Готово: ${institutes.length} институтов, ${departments.length} подразделений, ${programs.length} программ, ` +
    `дисциплины для ${Object.keys(disciplines).length} программ -> ${OUT}`);
}

main().catch((err) => {
  console.error(`Ошибка: ${err.message}`);
  process.exit(1);
});
