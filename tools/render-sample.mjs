// Формирует примеры титульных листов в out/ для визуальной сверки в Word/LibreOffice.
//   npm run sample
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { renderTitle } from "../src/lib/docx.js";
import { fileNameFor, templateData } from "../src/lib/format.js";

const template = readFileSync(new URL("../template/title-template.docx", import.meta.url));
const outDir = new URL("../out/", import.meta.url);
mkdirSync(outDir, { recursive: true });

const law = {
  institute: "Институт права",
  department: "Департамент частного права",
  direction: "40.04.01 Юриспруденция",
  profile: "Гражданское право и процесс",
  assignmentNumber: "2",
  course: "Актуальные проблемы российского гражданского права",
  variant: "",
  student: "А.Б. Иванова-Петрова",
  group: "ЮРмд-2401а",
  teacher: "В.Г. Смирнов",
  year: "2026",
};
const samples = [
  law,
  {
    ...law,
    institute: "Гуманитарно-педагогический институт",
    department: 'Кафедра "Педагогика и психология"',
    direction: "37.04.01 Психология",
    profile: "Психологическое консультирование",
    course: "«Психологическое консультирование»",
    variant: "7",
    pageBreak: true,
  },
];

for (const form of samples) {
  const data = templateData(form);
  const file = fileNameFor(data);
  writeFileSync(new URL(file, outDir), renderTitle(template, data, "nodebuffer"));
  console.log(`out/${file}`);
}
