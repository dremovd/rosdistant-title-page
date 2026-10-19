// Заполнение шаблона DOCX. Работает одинаково в браузере и в Node (тесты).
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function stampCoreProps(zip, now) {
  const file = zip.file("docProps/core.xml");
  if (!file) return;
  const iso = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const xml = file
    .asText()
    .replace(/(<dcterms:created[^>]*>)[^<]*(<\/dcterms:created>)/, `$1${iso}$2`)
    .replace(/(<dcterms:modified[^>]*>)[^<]*(<\/dcterms:modified>)/, `$1${iso}$2`)
    .replace(/<cp:revision>[^<]*<\/cp:revision>/, "<cp:revision>1</cp:revision>");
  zip.file("docProps/core.xml", xml);
}

/**
 * @param {ArrayBuffer|Uint8Array} template  шаблон template/title-template.docx
 * @param {object} data  результат templateData()
 * @param {"blob"|"uint8array"|"nodebuffer"} type
 */
export function renderTitle(template, data, type = "blob", now = new Date()) {
  const doc = new Docxtemplater(new PizZip(template), {
    paragraphLoop: true,
    linebreaks: false,
    nullGetter: () => "",
  });
  doc.render(data);
  const zip = doc.getZip();
  stampCoreProps(zip, now);
  return zip.generate({ type, mimeType: DOCX_MIME, compression: "DEFLATE" });
}
