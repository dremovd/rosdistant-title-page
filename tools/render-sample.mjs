// Заполняет шаблон тестовыми данными и проверяет результат:
// не осталось тегов, XML валиден, вариант/разрыв страницы управляются флагами.
//   node tools/render-sample.mjs  ->  out/*.docx
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

const template = readFileSync(new URL("../template/title-template.docx", import.meta.url));
mkdirSync(new URL("../out/", import.meta.url), { recursive: true });

const base = {
  institute: "Институт права",
  department: "Департамент частного права",
  direction: "40.04.01 Юриспруденция",
  profile: "Гражданское право и процесс",
  assignmentNumber: "2",
  course: "Актуальные проблемы гражданского права",
  variant: "",
  student: "А.Б. Иванова-Петрова",
  group: "ЮРмд-2401а",
  teacher: "В.Г. Смирнов",
  city: "Тольятти",
  year: "2026",
  pageBreak: false,
};

const cases = {
  "sample-law": base,
  "sample-psy-variant": {
    ...base,
    institute: "Гуманитарно-педагогический институт",
    department: "Кафедра «Педагогика и психология»",
    direction: "37.04.01 Психология",
    profile: "Психологическое консультирование",
    course: "Психология & <консультирование> \"тест\"",
    variant: "7",
    pageBreak: true,
  },
};

let failed = false;
for (const [name, data] of Object.entries(cases)) {
  const doc = new Docxtemplater(new PizZip(template), { paragraphLoop: true, linebreaks: true });
  doc.render(data);
  const zip = doc.getZip();
  const xml = zip.file("word/document.xml").asText();
  const text = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
  const checks = {
    "нет тегов": !/\{[#/]?[a-zA-Z]+\}/.test(text),
    "нет «(при наличии)»/«____»": !text.includes("(при наличии)") && !text.includes("____"),
    "вариант": data.variant ? text.includes(`Вариант ${data.variant}`) : !text.includes("Вариант"),
    "разрыв страницы": xml.includes('w:type="page"') === data.pageBreak,
    "экранирование": !data.course.includes("&") || xml.includes("&amp;"),
    "фон на месте": xml.includes('r:embed="rId5"') && zip.file("word/media/image1.jpeg") !== null,
  };
  for (const [check, ok] of Object.entries(checks)) {
    if (!ok) failed = true;
    console.log(`${ok ? "✓" : "✗"} ${name}: ${check}`);
  }
  writeFileSync(new URL(`../out/${name}.docx`, import.meta.url), zip.generate({ type: "nodebuffer", compression: "DEFLATE" }));
}
process.exit(failed ? 1 : 0);
