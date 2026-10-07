#!/usr/bin/env node
/**
 * HTML → A4 PDF（Chromium 打印引擎 + pdf-lib 补页脚页码与元数据）
 *
 * 用法:
 *   node html_to_pdf.cjs <html> --out <pdf> [选项]
 *
 * 选项:
 *   --out <file>          输出 PDF（默认与输入 HTML 同名）
 *   --title <text>        PDF 标题元数据
 *   --subject <text>      PDF 主题元数据
 *   --no-footers          不写页脚页码
 *   --footers-skip <n>    前 n 页不写页码（默认 1：标题页不编号）
 *   --headings <json>     标题清单（md_to_html.cjs --headings 的产物）
 *   --map-out <json>      渲染后导出「标题 → 页码」映射，供目录填页码用
 *   --verify-map <json>   与给定映射比对，确认填号没有改变分页（不一致则退出码 3）
 *
 * 页宽按 HTML 里的 @page 规则走（preferCSSPageSize），所以 A4 版面由 CSS 决定。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i > -1 ? args[i + 1] : def;
};
const flag = name => args.includes(name);
const htmlPath = path.resolve(args.find((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--')) || '');
if (!htmlPath || !fs.existsSync(htmlPath)) {
  console.error('用法: node html_to_pdf.cjs <html> --out <pdf> [--footers-skip 1] [--headings h.json --map-out pages.json]');
  process.exit(1);
}
const outPath = path.resolve(opt('--out', htmlPath.replace(/\.html?$/i, '') + '.pdf'));

/* ---------- 1. Chromium 打印 ---------- */
(async () => {
  const exe = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const browser = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : {}) });
  const page = await browser.newPage();
  await page.goto('file://' + htmlPath, { waitUntil: 'networkidle' });
  await page.emulateMedia({ media: 'print' });

  // 打印前体检：超长元素会把 break-inside: avoid 变成大块空白，这里先量一下
  const tall = await page.evaluate(() => {
    const LIMIT = 1000;
    const out = [];
    document.querySelectorAll('table,figure').forEach(el => {
      if (el.getBoundingClientRect().height > LIMIT) out.push(el.tagName.toLowerCase());
    });
    return out;
  });
  if (tall.length) console.log(`  （${tall.join('/')} 中有超过 1000px 的元素，分页时会自然跨页）`);

  await page.pdf({ path: outPath, printBackground: true, preferCSSPageSize: true, tagged: true });
  await browser.close();

  /* ---------- 2. 标题 → 页码映射（可选） ---------- */
  const headingsPath = opt('--headings', null);
  const mapOut = opt('--map-out', null);
  const verifyMap = opt('--verify-map', null);
  if ((mapOut || verifyMap) && headingsPath) {
    const headings = JSON.parse(fs.readFileSync(headingsPath, 'utf8')).filter(h => h.level >= 2);
    const map = await headingPages(outPath, headings);
    if (mapOut) {
      fs.writeFileSync(mapOut, JSON.stringify(map, null, 1), 'utf8');
      console.log(`标题页码映射写出: ${mapOut}（命中 ${Object.keys(map).length}/${headings.length}）`);
    }
    if (verifyMap) {
      const want = JSON.parse(fs.readFileSync(verifyMap, 'utf8'));
      const diff = Object.keys(want).filter(k => want[k] !== map[k]);
      if (diff.length) {
        console.error(`⚠ ${diff.length} 个标题的页码在填号后发生变化：` + diff.slice(0, 5).map(k => `${k}: ${want[k]}→${map[k]}`).join(', '));
        process.exit(3);
      }
      console.log('✓ 目录页码与正文一致');
    }
  }

  /* ---------- 3. 页脚页码 + 元数据 ---------- */
  const doc = await PDFDocument.load(fs.readFileSync(outPath));
  if (!flag('--no-footers')) {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages();
    const total = pages.length;
    const skip = Number(opt('--footers-skip', '1'));
    pages.forEach((p, i) => {
      const n = i + 1;
      if (n <= skip) return;
      const text = `${n} / ${total}`;
      const w = font.widthOfTextAtSize(text, 8);
      const { width } = p.getSize();
      p.drawText(text, { x: (width - w) / 2, y: 26, size: 8, font, color: rgb(0.45, 0.5, 0.56) });
    });
    console.log(`页脚页码已写入（跳过前 ${skip} 页）`);
  }
  if (opt('--title', null)) doc.setTitle(opt('--title'));
  if (opt('--subject', null)) doc.setSubject(opt('--subject'));
  doc.setProducer('Chromium (Playwright) + pdf-lib');
  doc.setModificationDate(new Date());
  fs.writeFileSync(outPath, await doc.save());

  const size = fs.statSync(outPath).size;
  const pages = (await PDFDocument.load(fs.readFileSync(outPath))).getPageCount();
  console.log(`PDF 写出: ${outPath}`);
  console.log(`页数 ${pages}  大小 ${(size / 1024 / 1024).toFixed(2)} MB`);
})().catch(err => {
  console.error('✗ 转 PDF 失败:', err.message);
  process.exit(1);
});

/* ---------- 用 pdfjs 提取每页文本，定位标题所在页 ---------- */
async function headingPages(pdfPath, headings) {
  // NODE_PATH 对 ESM 的动态 import 不生效，先用 CJS 解析出真实路径再 import
  const { pathToFileURL } = require('url');
  const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)), useSystemFonts: true }).promise;
  const CJK = ch => /[\u4e00-\u9fff]/.test(ch);
  const norm = s => [...s.normalize('NFKC')].filter(ch => CJK(ch) || /[0-9A-Za-z]/.test(ch)).join('');
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(norm(content.items.map(it => it.str).join('')));
  }
  // 正文起点：首段特征串所在页（跳过目录页，目录里也含同样的标题文字）
  const bodyMarker = norm('SFRP2（secreted frizzled-related protein 2）');
  let bodyStart = pages.findIndex(t => t.includes(bodyMarker));
  if (bodyStart < 0) bodyStart = 0;

  const map = {};
  let cursor = bodyStart;
  for (const h of headings) {
    const key = norm(h.text);
    if (!key) continue;
    let hit = -1;
    for (let i = cursor; i < pages.length; i++) if (pages[i].includes(key)) { hit = i; break; }
    if (hit < 0) for (let i = bodyStart; i < pages.length; i++) if (pages[i].includes(key)) { hit = i; break; }
    if (hit >= 0) { map[h.id] = hit + 1; cursor = hit; }
  }
  return map;
}
