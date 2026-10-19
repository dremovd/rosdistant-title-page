import { renderTitle } from "./lib/docx.js";
import {
  fileNameFor, isValidYear, normalizeName, plural, programKey, templateData, toGuillemets, toInitials, validate,
} from "./lib/format.js";
import { clearState, loadState, saveState } from "./lib/storage.js";

const $ = (id) => document.getElementById(id);
const MANUAL = "__manual";
const NO_DEPARTMENT = "__none";
const TEXT_FIELDS = [
  "institute", "department", "direction", "profile",
  "studentFull", "student", "group",
  "course", "assignmentNumber", "variant", "teacherFull", "teacher", "year",
];
const FIELD_IDS = {
  institute: "institute", department: "department", direction: "direction", profile: "profile",
  studentFull: "student-full", student: "student", group: "group",
  course: "course", assignmentNumber: "assignment-number", variant: "variant",
  teacherFull: "teacher-full", teacher: "teacher", year: "year",
};
const WORK_FIELDS = ["course", "assignmentNumber", "variant", "teacherFull", "teacher"];
const FIELD_LABELS = {
  institute: "Институт", department: "Подразделение", direction: "Направление", profile: "Профиль",
  student: "Обучающийся (на листе)", teacher: "Преподаватель (на листе)",
};
const MAX_TEACHERS = 15;
const currentYear = String(new Date().getFullYear());

const assets = document.documentElement.dataset;
const assetUrl = (path) => new URL(path, document.baseURI);

let catalog = null;
let staff = null;
let templatePromise = null;
let attemptedDownload = false;
let state = {
  pick: { instituteId: "", departmentId: "", programId: "" },
  auto: {},
  teachers: [],
  pageBreak: false,
};

const input = (key) => $(FIELD_IDS[key]);
const value = (key) => input(key).value;

function setValue(key, text) {
  input(key).value = text ?? "";
}

// ---------- справочник ----------

async function loadJson(path) {
  const res = await fetch(assetUrl(path), { credentials: "omit" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadCatalog() {
  const data = await loadJson(assets.catalog);
  if (!Array.isArray(data.programs) || !data.programs.length) throw new Error("пустой справочник");
  return data;
}

async function loadStaff() {
  const data = await loadJson(assets.staff);
  if (!Array.isArray(data.people) || !data.programs) throw new Error("пустой список преподавателей");
  return data;
}

function option(value, label, selected) {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = label;
  if (selected) o.selected = true;
  return o;
}

function programLabel(p) {
  const profile = p.profile ? ` — ${p.profile}` : "";
  const form = p.form ? ` (${p.form.toLowerCase()})` : "";
  return `${p.code} ${p.direction}${profile}${form}`;
}

function programsInScope() {
  const { instituteId, departmentId } = state.pick;
  if (!catalog || !instituteId || instituteId === MANUAL) return [];
  return catalog.programs.filter((p) => {
    if (p.instituteId !== instituteId) return false;
    if (!departmentId || departmentId === MANUAL) return true;
    if (departmentId === NO_DEPARTMENT) return p.departmentId === null;
    return p.departmentId === departmentId;
  });
}

function fillPickers() {
  const inst = $("pick-institute");
  const dep = $("pick-department");
  const prog = $("pick-program");
  const { instituteId, departmentId, programId } = state.pick;

  if (!catalog) {
    for (const el of [inst, dep, prog]) {
      el.replaceChildren(option("", "Справочник недоступен — заполните поля ниже"));
      el.disabled = true;
    }
    return;
  }

  inst.replaceChildren(
    option("", "— выберите институт —"),
    ...catalog.institutes.map((i) => option(i.id, i.name, i.id === instituteId)),
    option(MANUAL, "Нет в списке — ввести вручную", instituteId === MANUAL),
  );

  const departments = catalog.departments.filter((d) => d.instituteId === instituteId);
  const withPrograms = new Set(catalog.programs.map((p) => p.departmentId));
  const hasOrphans = catalog.programs.some((p) => p.instituteId === instituteId && p.departmentId === null);
  dep.disabled = !instituteId || instituteId === MANUAL;
  dep.replaceChildren(
    option("", instituteId && instituteId !== MANUAL ? "— выберите подразделение —" : "— сначала институт —"),
    ...departments
      .sort((a, b) => Number(withPrograms.has(b.id)) - Number(withPrograms.has(a.id)))
      .map((d) => option(d.id, toGuillemets(d.name), d.id === departmentId)),
    ...(hasOrphans ? [option(NO_DEPARTMENT, "Без подразделения", departmentId === NO_DEPARTMENT)] : []),
    option(MANUAL, "Нет в списке — ввести вручную", departmentId === MANUAL),
  );

  const programs = programsInScope();
  prog.disabled = !programs.length;
  const groups = new Map();
  for (const p of programs) {
    if (!groups.has(p.level)) groups.set(p.level, []);
    groups.get(p.level).push(p);
  }
  prog.replaceChildren(
    option("", programs.length ? "— выберите направление и профиль —" : "— сначала институт и подразделение —"),
    ...[...groups].map(([level, list]) => {
      const g = document.createElement("optgroup");
      g.label = level;
      g.append(...list.map((p) => option(p.id, programLabel(p), p.id === programId)));
      return g;
    }),
    ...(programs.length ? [option(MANUAL, "Нет в списке — ввести вручную", programId === MANUAL)] : []),
  );

  const program = currentProgram();
  const source = $("program-source");
  source.replaceChildren();
  const url = program?.sourceUrl ?? catalog.departments.find((d) => d.id === departmentId)?.url;
  if (url) {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "Страница подразделения на tltsu.ru";
    source.append(a);
  }
}

function currentProgram() {
  return catalog?.programs.find((p) => p.id === state.pick.programId) ?? null;
}

// ---------- автоподстановка без потери ручных правок ----------

// Значение подставляется, если поле пустое или ещё содержит прошлую подстановку.
// Иначе под полем появляется предложение «Подставить» — ручной текст не теряется.
function suggest(key, text) {
  const current = value(key);
  const previous = state.auto[key];
  state.auto[key] = text;
  if (!current || current === previous || current === text) {
    setValue(key, text);
    showSuggestion(key, null);
  } else {
    showSuggestion(key, text);
  }
}

function showSuggestion(key, text) {
  const field = input(key).closest(".field");
  field.querySelector(".suggest")?.remove();
  if (!text) return;
  const box = document.createElement("span");
  box.className = "suggest";
  const label = document.createElement("span");
  label.textContent = `Справочник: «${text}»`;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Подставить";
  button.addEventListener("click", () => {
    setValue(key, text);
    box.remove();
    changed();
  });
  box.append(label, button);
  field.append(box);
  if (["institute", "department", "direction", "profile"].includes(key)) $("printed-program").open = true;
}

function onInstitute() {
  const id = $("pick-institute").value;
  state.pick = { instituteId: id, departmentId: "", programId: "" };
  if (id === MANUAL) {
    $("printed-program").open = true;
    input("institute").focus();
  } else if (id) {
    suggest("institute", toGuillemets(catalog.institutes.find((i) => i.id === id).name));
  }
  fillPickers();
  changed();
}

function onDepartment() {
  const id = $("pick-department").value;
  state.pick = { ...state.pick, departmentId: id, programId: "" };
  if (id === MANUAL) {
    $("printed-program").open = true;
    input("department").focus();
  } else if (id === NO_DEPARTMENT) {
    suggest("department", "");
  } else if (id) {
    suggest("department", toGuillemets(catalog.departments.find((d) => d.id === id).name));
  }
  fillPickers();
  changed();
}

function onProgram() {
  const id = $("pick-program").value;
  state.pick = { ...state.pick, programId: id };
  const program = currentProgram();
  if (id === MANUAL) {
    $("printed-program").open = true;
    input("direction").focus();
  } else if (program) {
    if (!state.pick.departmentId && program.departmentId) {
      state.pick.departmentId = program.departmentId;
      suggest("department", toGuillemets(catalog.departments.find((d) => d.id === program.departmentId).name));
    }
    suggest("direction", `${program.code} ${program.direction}`);
    suggest("profile", toGuillemets(program.profile));
  }
  fillPickers();
  changed();
}

// ---------- подсказки по курсу и преподавателю ----------

function fillCourseList() {
  const list = catalog?.disciplines?.[state.pick.programId] ?? [];
  $("course-list").replaceChildren(...list.map((d) => option(d, "")));
  const hint = $("course-hint");
  const course = value("course").trim();
  if (!list.length) {
    hint.textContent = state.pick.programId ? "Для программы нет списка дисциплин — введите название вручную." : "";
  } else if (course && !list.some((d) => d.toLowerCase() === course.toLowerCase())) {
    hint.textContent = "Нет в списке дисциплин программы — будет напечатано как введено.";
  } else {
    hint.textContent = `В списке программы ${plural(list.length, ["дисциплина", "дисциплины", "дисциплин"])} — начните вводить название.`;
  }
}

// Преподаватели выбранной программы из «Педагогического состава» tltsu.ru.
function programStaff() {
  const program = currentProgram();
  if (!staff || !program) return null;
  const entry = staff.programs[programKey(program.code, program.profile || program.direction)];
  if (!entry) return null;
  const people = entry.staff.map(([index, disciplines]) => {
    const [name, post] = staff.people[index];
    return { name, post, disciplines };
  });
  return { url: entry.url, people };
}

function fillTeacherList() {
  const names = [...state.teachers];
  for (const p of programStaff()?.people ?? []) if (!names.includes(p.name)) names.push(p.name);
  $("teacher-list").replaceChildren(...names.map((t) => option(t, "")));
}

// Подсказка, а не назначение (ТЗ §4.3 п.6): ничего не подставляем сами,
// показываем кнопки, по которым пользователь выбирает преподавателя.
function fillTeacherSuggest() {
  const box = $("teacher-suggest");
  box.replaceChildren();
  const found = programStaff();
  const course = normalizeName(value("course"));
  if (!found || !course) {
    box.hidden = true;
    return;
  }
  const matching = found.people.filter((p) => p.disciplines.some((d) => normalizeName(d) === course));
  box.hidden = false;
  const title = document.createElement("p");
  title.className = "hint";
  const source = document.createElement("a");
  source.href = found.url;
  source.target = "_blank";
  source.rel = "noopener noreferrer";
  source.textContent = "tltsu.ru";
  if (!matching.length) {
    title.append("Преподаватели этого курса в вашей программе не найдены на ", source,
      ". Список всех преподавателей программы — в подсказках поля.");
    box.append(title);
    return;
  }
  title.append(matching.length === 1
    ? "По данным "
    : `Курс в вашей программе ведут ${plural(matching.length, ["преподаватель", "преподавателя", "преподавателей"])} по данным `,
  source, matching.length === 1 ? " курс ведёт:" : ". Выберите своего:");
  const list = document.createElement("div");
  list.className = "chips";
  for (const person of matching) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.textContent = `${toInitials(person.name)}${person.post ? ` — ${person.post.toLowerCase()}` : ""}`;
    button.title = person.name;
    button.addEventListener("click", () => {
      setValue("teacherFull", person.name);
      suggest("teacher", toInitials(person.name));
      changed();
    });
    list.append(button);
  }
  box.append(title, list);
}

// ---------- предпросмотр и сообщения ----------

function formValues() {
  const values = Object.fromEntries(TEXT_FIELDS.map((k) => [k, value(k)]));
  return { ...values, pageBreak: $("page-break").checked };
}

const PLACEHOLDERS = {
  institute: "институт", department: "подразделение", direction: "код и направление", profile: "профиль",
  assignmentNumber: "…", course: "учебный курс", student: "", group: "", teacher: "", city: "", year: "",
};

function renderPreview(data) {
  for (const el of document.querySelectorAll("[data-preview]")) {
    const key = el.dataset.preview;
    const text = data[key];
    el.textContent = text || PLACEHOLDERS[key] || "";
    el.classList.toggle("empty", !text);
  }
  $("preview-variant").classList.toggle("invisible", !data.variant);
}

function renderMessages(data) {
  const { errors, warnings, teacherMissing } = validate(data);
  const list = $("messages");
  list.replaceChildren();
  const add = (text, kind) => {
    const li = document.createElement("li");
    li.className = kind;
    li.textContent = text;
    list.append(li);
  };
  if (attemptedDownload) errors.forEach((e) => add(e, "error"));
  warnings.forEach((w) => add(w, "warning"));
  const askTeacher = attemptedDownload && teacherMissing && !errors.length;
  $("no-teacher-confirm").hidden = !askTeacher;
  if (askTeacher && !$("no-teacher").checked) add("Не указан преподаватель. Укажите его или подтвердите скачивание без него.", "warning");
  return { errors, teacherMissing };
}

// ---------- сохранение ----------

let saveTimer = null;

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const fields = Object.fromEntries(TEXT_FIELDS.map((k) => [k, value(k)]));
    const ok = saveState({ pick: state.pick, auto: state.auto, teachers: state.teachers, fields, pageBreak: $("page-break").checked });
    $("save-status").textContent = ok
      ? "Данные сохранены только в этом браузере на этом устройстве."
      : "Браузер не разрешает сохранять данные (например, приватный режим) — после закрытия вкладки они пропадут.";
  }, 300);
}

function restore() {
  const saved = loadState();
  if (!saved) {
    setValue("year", currentYear);
    return;
  }
  state.pick = { instituteId: "", departmentId: "", programId: "", ...saved.pick };
  state.auto = saved.auto ?? {};
  state.teachers = Array.isArray(saved.teachers) ? saved.teachers.slice(0, MAX_TEACHERS) : [];
  for (const key of TEXT_FIELDS) setValue(key, saved.fields?.[key] ?? "");
  // Год из прошлого учебного года не переносим.
  const year = saved.fields?.year;
  setValue("year", isValidYear(year) && Number(year) >= Number(currentYear) ? year : currentYear);
  $("page-break").checked = Boolean(saved.pageBreak);
}

function changed() {
  const data = templateData(formValues());
  renderPreview(data);
  renderMessages(data);
  fillCourseList();
  fillTeacherList();
  fillTeacherSuggest();
  persist();
}

// ---------- скачивание ----------

function fetchTemplate() {
  templatePromise ??= fetch(assetUrl(assets.template), { credentials: "omit" }).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.arrayBuffer();
  });
  templatePromise.catch(() => {
    templatePromise = null;
  });
  return templatePromise;
}

function rememberTeacher() {
  const name = value("teacherFull").trim() || value("teacher").trim();
  if (!name) return;
  state.teachers = [name, ...state.teachers.filter((t) => t !== name)].slice(0, MAX_TEACHERS);
  fillTeacherList();
}

async function download(event) {
  event.preventDefault();
  attemptedDownload = true;
  const data = templateData(formValues());
  const { errors, teacherMissing } = renderMessages(data);
  if (errors.length) {
    const first = document.querySelector("#messages .error");
    first?.scrollIntoView({ block: "center", behavior: "smooth" });
    return;
  }
  if (teacherMissing && !$("no-teacher").checked) return;

  const button = $("download");
  button.disabled = true;
  button.textContent = "Готовлю файл…";
  try {
    const template = await fetchTemplate();
    const blob = renderTitle(template, data, "blob");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileNameFor(data);
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    rememberTeacher();
    persist();
  } catch (err) {
    const li = document.createElement("li");
    li.className = "error";
    li.textContent = `Не удалось сформировать файл: ${err.message}. Обновите страницу и попробуйте ещё раз.`;
    $("messages").append(li);
  } finally {
    button.disabled = false;
    button.textContent = "Скачать DOCX";
  }
}

function clearWork() {
  for (const key of WORK_FIELDS) setValue(key, "");
  delete state.auto.teacher;
  $("no-teacher").checked = false;
  attemptedDownload = false;
  showSuggestion("teacher", null);
  changed();
  input("course").focus();
}

let resetArmed = null;

function resetAll() {
  const button = $("reset-all");
  if (!resetArmed) {
    button.textContent = "Точно удалить? Нажмите ещё раз";
    resetArmed = setTimeout(() => {
      resetArmed = null;
      button.textContent = "Удалить все мои данные";
    }, 4000);
    return;
  }
  clearTimeout(resetArmed);
  resetArmed = null;
  button.textContent = "Удалить все мои данные";
  clearTimeout(saveTimer);
  clearState();
  state = { pick: { instituteId: "", departmentId: "", programId: "" }, auto: {}, teachers: [], pageBreak: false };
  for (const key of TEXT_FIELDS) setValue(key, "");
  for (const key of Object.keys(FIELD_LABELS)) showSuggestion(key, null);
  setValue("year", currentYear);
  $("page-break").checked = false;
  $("no-teacher").checked = false;
  attemptedDownload = false;
  fillPickers();
  fillTeacherList();
  changed();
  clearTimeout(saveTimer);
  clearState();
  $("save-status").textContent = "Все данные удалены из этого браузера.";
}

// ---------- запуск ----------

function bind() {
  $("pick-institute").addEventListener("change", onInstitute);
  $("pick-department").addEventListener("change", onDepartment);
  $("pick-program").addEventListener("change", onProgram);
  input("studentFull").addEventListener("input", () => {
    suggest("student", toInitials(value("studentFull")));
    changed();
  });
  input("teacherFull").addEventListener("input", () => {
    suggest("teacher", toInitials(value("teacherFull")));
    changed();
  });
  for (const key of TEXT_FIELDS) {
    if (key === "studentFull" || key === "teacherFull") continue;
    input(key).addEventListener("input", () => {
      if (key in FIELD_LABELS) showSuggestion(key, null);
      changed();
    });
  }
  $("page-break").addEventListener("change", changed);
  $("no-teacher").addEventListener("change", changed);
  $("form").addEventListener("submit", download);
  $("clear-work").addEventListener("click", clearWork);
  $("reset-all").addEventListener("click", resetAll);
}

async function main() {
  $("sheet-bg").src = assetUrl(assets.background).href;
  restore();
  bind();
  fillTeacherList();
  changed();
  // Шаблон загружаем сразу, чтобы скачивание работало и после отключения сети.
  fetchTemplate().catch(() => {});
  try {
    catalog = await loadCatalog();
    const date = new Date(catalog.fetchedAt).toLocaleDateString("ru-RU");
    $("catalog-info").textContent =
      `Справочник: ${plural(catalog.institutes.length, ["институт", "института", "институтов"])}, ` +
      `${plural(catalog.programs.length, ["программа", "программы", "программ"])}; обновлён ${date}.`;
  } catch (err) {
    catalog = null;
    $("printed-program").open = true;
    $("catalog-info").textContent = `Справочник не загрузился (${err.message}) — заполните поля программы вручную.`;
  }
  if (catalog && state.pick.instituteId && state.pick.instituteId !== MANUAL &&
      !catalog.institutes.some((i) => i.id === state.pick.instituteId)) {
    state.pick = { instituteId: "", departmentId: "", programId: "" };
  }
  if (!state.pick.instituteId && (value("institute") || value("direction"))) $("printed-program").open = true;
  fillPickers();
  changed();
  // Список преподавателей — дополнительная подсказка; без него сайт работает как обычно.
  try {
    staff = await loadStaff();
    fillTeacherList();
    fillTeacherSuggest();
  } catch {
    staff = null;
  }
}

main();
