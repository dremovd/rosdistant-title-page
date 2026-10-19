// Чистые функции подготовки текста для титульного листа. Без DOM, тестируются в Node.

// Символы, недопустимые в XML 1.0; переводы строк в однострочных полях — в пробел.
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export function cleanText(value) {
  return String(value ?? "")
    .replace(XML_INVALID, "")
    .replace(/\s+/g, " ")
    .trim();
}

// "Педагогика и психология" → «Педагогика и психология» (так в исходном DOCX).
export function toGuillemets(value) {
  return cleanText(value)
    .replace(/[„“”"]([^„“”"]*)[„“”"]/g, "«$1»");
}

// Курс печатается внутри «…» шаблона: внешние кавычки пользователя снимаем,
// но только если внутри нет других кавычек («Право» и «Экономика» не трогаем).
export function stripOuterQuotes(value) {
  const text = toGuillemets(value);
  const m = text.match(/^«(.*)»$/);
  return m && !/[«»]/.test(m[1]) ? m[1].trim() : text;
}

const INITIALS_FIRST = /^((?:[A-ZА-ЯЁ](?:\.|\.?-[A-ZА-ЯЁ]\.)\s*){1,3})(\S.*)$/u;
const INITIALS_LAST = /^(\S.*?)\s+((?:[A-ZА-ЯЁ](?:\.|\.?-[A-ZА-ЯЁ]\.)\s*){1,3})$/u;

function compactInitials(initials) {
  return initials.replace(/\s+/g, "");
}

function initialOf(word) {
  return word
    .split("-")
    .filter(Boolean)
    .map((part) => part[0].toLocaleUpperCase("ru") + ".")
    .join("-");
}

// «Иванова Анна Борисовна» → «А.Б. Иванова». Порядок: фамилия, имя, отчество.
// Уже готовые формы «А.Б. Иванова», «А. Б. Иванова», «Иванова А.Б.» нормализуются.
// Слова со строчной буквы (оглы, кызы) в инициалы не входят.
export function toInitials(fullName) {
  const text = cleanText(fullName);
  if (!text) return "";
  let m = text.match(INITIALS_FIRST);
  if (m) return `${compactInitials(m[1])} ${m[2].trim()}`;
  m = text.match(INITIALS_LAST);
  if (m) return `${compactInitials(m[2])} ${m[1].trim()}`;

  const words = text.split(" ");
  if (words.length < 2) return text;
  const [surname, ...rest] = words;
  const initials = rest
    .filter((w) => /^[A-ZА-ЯЁ]/u.test(w))
    .slice(0, 2)
    .map(initialOf)
    .join("");
  return initials ? `${initials} ${surname}` : text;
}

// plural(5, ["программа", "программы", "программ"]) → "5 программ"
export function plural(n, [one, few, many]) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11 ? one
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few
    : many;
  return `${n} ${word}`;
}

export function isValidYear(value) {
  const year = Number(value);
  return /^\d{4}$/.test(String(value).trim()) && year >= 2000 && year <= 2100;
}

// Титульный_<Дисциплина>_задание-<Номер>_<Год>.docx
export function fileNameFor({ course, assignmentNumber, year }) {
  const safe = (s, max) =>
    cleanText(s)
      .replace(/[«»"'`]/g, "")
      .replace(/[\\/:*?<>|]/g, "-")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^[-_.]+|[-_.]+$/g, "")
      .slice(0, max)
      .replace(/[-_.]+$/, "");
  const parts = ["Титульный", safe(course, 60), assignmentNumber && `задание-${safe(assignmentNumber, 20)}`, safe(year, 4)];
  return parts.filter(Boolean).join("_") + ".docx";
}

// Данные для шаблона docxtemplater. Пустой вариант убирает строку «Вариант».
export function templateData(form) {
  return {
    institute: toGuillemets(form.institute),
    department: toGuillemets(form.department),
    direction: cleanText(form.direction),
    profile: toGuillemets(form.profile),
    assignmentNumber: cleanText(form.assignmentNumber).replace(/^№\s*/, ""),
    course: stripOuterQuotes(form.course),
    variant: cleanText(form.variant),
    student: cleanText(form.student),
    group: cleanText(form.group),
    teacher: cleanText(form.teacher),
    city: cleanText(form.city) || "Тольятти",
    year: cleanText(form.year),
    pageBreak: Boolean(form.pageBreak),
  };
}

// Грубая оценка, уместится ли лист на одной странице. Свободного места под
// «Тольятти» в шаблоне ~2,7 см; считаем добавочную высоту от переносов строк.
// Ёмкость строк — для Times New Roman: 14 pt на ширину 16,5 см ≈ 72 знака.
const LINE_RULES = [
  { key: "institute", chars: 72, cm: 0.56 },
  { key: "department", chars: 72, cm: 0.56 },
  { key: "direction", chars: 72, cm: 0.56 },
  { key: "profile", chars: 72, cm: 0.56 },
  { key: "course", chars: 72, cm: 0.56, prefix: "по учебному курсу «»".length },
  { key: "assignmentNumber", chars: 38, cm: 0.65, prefix: "ПРАКТИЧЕСКИЕ ЗАДАНИЯ № ".length },
  { key: "student", chars: 30, cm: 0.84 },
  { key: "group", chars: 30, cm: 0.84 },
  { key: "teacher", chars: 30, cm: 0.84 },
];
const SPARE_CM = 2.4;

export function overflowRisk(data) {
  let extra = 0;
  const long = [];
  for (const rule of LINE_RULES) {
    const length = (rule.prefix ?? 0) + (data[rule.key] ?? "").length;
    const lines = Math.max(1, Math.ceil(length / rule.chars));
    if (lines > 1) {
      extra += (lines - 1) * rule.cm;
      long.push(rule.key);
    }
  }
  return { extraCm: extra, risky: extra > SPARE_CM, long };
}

const REQUIRED = [
  ["direction", "направление подготовки"],
  ["profile", "направленность (профиль)"],
  ["course", "учебный курс"],
  ["student", "обучающийся"],
  ["group", "группа"],
  ["assignmentNumber", "номер задания"],
];

export function validate(data) {
  const errors = REQUIRED.filter(([key]) => !data[key]).map(([, label]) => `Не заполнено: ${label}.`);
  if (!isValidYear(data.year)) errors.push("Год должен быть четырёхзначным числом от 2000 до 2100.");
  const warnings = [];
  if (!data.institute) warnings.push("Не указан институт — строка останется пустой.");
  if (!data.department) warnings.push("Не указано подразделение — строка останется пустой.");
  if (overflowRisk(data).risky) {
    warnings.push("Длинные названия могут не уместиться на одной странице. Проверьте файл в Word или сократите текст.");
  }
  return { errors, warnings, teacherMissing: !data.teacher };
}
