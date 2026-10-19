// Собирает статический сайт в dist/ для GitHub Pages.
// Имена ресурсов содержат хэш содержимого: Pages кэширует файлы на 10 минут,
// и после обновления старый JS не смешается с новым шаблоном или справочником.
//   node tools/build-site.mjs
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
import PizZip from "pizzip";

const root = new URL("../", import.meta.url);
const path = (p) => new URL(p, root).pathname;
const DIST = path("dist/");

const hashed = (name, ext, content) => {
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 10);
  const file = `assets/${name}.${hash}.${ext}`;
  writeFileSync(DIST + file, content);
  return file;
};

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST + "assets", { recursive: true });

const js = await build({
  entryPoints: [path("src/app.js")],
  bundle: true,
  minify: true,
  format: "esm",
  target: ["es2020", "safari15"],
  write: false,
  legalComments: "eof",
});
const css = await build({
  entryPoints: [path("src/styles.css")],
  bundle: true,
  minify: true,
  write: false,
});

const template = readFileSync(path("template/title-template.docx"));
const background = new PizZip(template).file("word/media/image1.jpeg").asUint8Array();
const minJson = (p) => JSON.stringify(JSON.parse(readFileSync(path(p), "utf8")));
const catalog = minJson("data/catalog.json");
const staff = minJson("data/staff.json");
const groups = minJson("data/groups.json");
const plans = minJson("data/plans.json");

const files = {
  "%APP%": hashed("app", "js", js.outputFiles[0].contents),
  "%STYLES%": hashed("styles", "css", css.outputFiles[0].contents),
  "%TEMPLATE%": hashed("title-template", "docx", template),
  "%CATALOG%": hashed("catalog", "json", catalog),
  "%BACKGROUND%": hashed("background", "jpg", background),
  "%STAFF%": hashed("staff", "json", staff),
  "%GROUPS%": hashed("groups", "json", groups),
  "%PLANS%": hashed("plans", "json", plans),
};

let html = readFileSync(path("src/index.html"), "utf8");
for (const [token, file] of Object.entries(files)) {
  if (!html.includes(token)) throw new Error(`в index.html нет ${token}`);
  html = html.replaceAll(token, file);
}
writeFileSync(DIST + "index.html", html);
writeFileSync(DIST + ".nojekyll", "");

for (const [token, file] of Object.entries(files)) console.log(`${token.padEnd(13)} ${file}`);
