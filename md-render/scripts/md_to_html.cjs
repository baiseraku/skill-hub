#!/usr/bin/env node
/**
 * Markdown 报告 → 屏幕阅读版 HTML（可顺带打印成 PDF）
 *
 * 用法:
 *   node md_to_html.cjs <input.md> --out <output.html> [选项]
 *
 * 选项:
 *   --out <file>         输出 HTML（默认：与输入 md 同名的 .html）
 *   --images-dir <dir>   markdown 里图片的相对目录（默认：md 所在目录）
 *   --colwidths <json>   measure_columns.cjs 的测量结果，用来写死表格列宽
 *   --pages <json>       标题 → 页码映射（有它才会在目录里显示页码）
 *   --placeholder <text> 占位轮：目录先放这个等宽占位（如 00），保证与填号轮分页一致
 *   --note-prefix <text> 以该文字开头的段落渲染成浅底提示框（可多次指定）
 *   --title <text>       覆盖 <title> 与文首大标题
 *   --inline-images      图片转 base64 内嵌，产出可单独传阅的单文件 HTML
 *   --no-source          图注下不显示「图源：文件名」
 *   --headings <json>    导出标题清单 {level,text,id}，供页码映射用
 *
 * 图按 markdown 里的出现顺序插在段落之间，alt 文本作为图注。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

marked.setOptions({ gfm: true, breaks: false });

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
function opt(name, def) {
  const i = argv.indexOf(name);
  return i > -1 ? argv[i + 1] : def;
}
const optAll = name => {
  const out = [];
  argv.forEach((a, i) => { if (a === name && argv[i + 1]) out.push(argv[i + 1]); });
  return out;
};

const VALUE_FLAGS = ['--out', '--in', '--images-dir', '--colwidths', '--pages', '--note-prefix', '--title', '--headings'];
const positionals = [];
for (let i = 0; i < argv.length; i++) {
  if (VALUE_FLAGS.includes(argv[i])) { i++; continue; }   // 跳过选项值
  if (argv[i].startsWith('--')) continue;                 // 无值开关
  positionals.push(argv[i]);
}

const mdPath = path.resolve(positionals[0] || opt('--in', ''));
if (!mdPath || !fs.existsSync(mdPath) || fs.statSync(mdPath).isDirectory()) {
  console.error('用法: node md_to_html.cjs <input.md> --out <output.html> [--colwidths cw.json] [--inline-images]');
  process.exit(1);
}
const MD_DIR = path.dirname(mdPath);
const outPath = path.resolve(opt('--out', mdPath.replace(/\.md$/i, '') + '.html'));
const OUT_DIR = path.dirname(outPath);
const imagesDir = path.resolve(opt('--images-dir', MD_DIR));
const inlineImages = flag('--inline-images');
const showSource = !flag('--no-source');
const notePrefixes = optAll('--note-prefix');
const pagesMap = opt('--pages') ? JSON.parse(fs.readFileSync(opt('--pages'), 'utf8')) : null;
// 两轮填页码时的第一轮：目录先放等宽占位数字，避免填号后重排（占位宽度要和真实页码一致）
const placeholder = opt('--placeholder', '');
const colwidths = opt('--colwidths') ? JSON.parse(fs.readFileSync(opt('--colwidths'), 'utf8')) : null;
const headingsOut = opt('--headings', null);
let tableSeq = 0;

/* ---------- 工具 ---------- */
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = s => marked.parseInline(String(s));
const stripMd = s => String(s).replace(/\*\*/g, '').replace(/`/g, '').replace(/\*/g, '');

/** 只处理标签之外的文字 */
function mapText(html, fn) {
  return html.split(/(<[^>]+>)/).map(seg => (seg.startsWith('<') ? seg : fn(seg))).join('');
}

/**
 * 块内 markdown → HTML。
 * CommonMark 的定界符规则在中文里会漏掉两种写法（开定界符前是汉字、后是标点，例如
 * 「一律是**"引号开头"**」；或闭定界符前是标点、后是汉字，例如「（供体）**比较」），
 * 漏掉时 ** 会原样显示。这里把这类残留的成对 ** 直接落成 <strong> 再解析一遍，
 * 内容里的 `code` 仍由 marked 解析成 <code>。
 */
function mdToHtml(text) {
  const html = marked.parse(text);
  if (!html.includes('**')) return html;
  return marked.parse(text.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>'));
}

/* ---------- 块级解析 ---------- */
const IMG_RE = /^!\[(.*)\]\(([^)]+)\)\s*$/;

function kindOf(s) {
  if (!s.trim()) return 'blank';
  if (/^#{1,6}\s/.test(s)) return 'head';
  if (s.startsWith('|')) return 'table';
  if (/^[-*]\s/.test(s)) return 'ul';
  if (/^\d+\.\s/.test(s)) return 'ol';
  if (/^-{3,}$/.test(s.trim())) return 'hr';
  if (IMG_RE.test(s.trim())) return 'img';
  return 'para';
}

const blocks = [];
let prevBlank = true;
for (const line of fs.readFileSync(mdPath, 'utf8').replace(/\r\n?/g, '\n').split('\n')) {
  const k = kindOf(line);
  if (k === 'blank') { prevBlank = true; continue; }
  const last = blocks[blocks.length - 1];
  // 只有相邻行才合并（表格行、列表项、软换行的段落）；空行分段，标题/分隔线/图各自成块
  if (last && last.kind === k && !prevBlank && !['head', 'hr', 'img'].includes(k)) last.lines.push(line);
  else blocks.push({ kind: k, lines: [line] });
  prevBlank = false;
}

/* ---------- 列宽：先满足每列的最小内容宽度，再分配余量 ---------- */
function colWidthsFor(cols, measured) {
  if (!colwidths || !measured || measured.cols.length !== cols) return null;
  const avail = colwidths.containerWidthPt;
  let mins = measured.cols.map(c => Math.min(c.min, avail));
  let sumMin = mins.reduce((a, b) => a + b, 0);
  // 整表放不下最小宽度时（例如满是长路径的表），整表字号按比例缩小，
  // 而不是让浏览器去拆文件名；缩小下限 0.82（基准 8.5pt → ≈7pt）。
  let scale = 1;
  if (sumMin > avail * 0.97) {
    scale = Math.max(0.82, avail * 0.95 / sumMin);
    mins = mins.map(m => m * scale);
    sumMin = mins.reduce((a, b) => a + b, 0);
    if (sumMin > avail * 0.99) return null;      // 实在放不下就退回自动布局
  }
  const maxs = measured.cols.map((c, i) => Math.max(mins[i], c.max * scale));
  const weights = maxs.map((mx, i) => Math.min(Math.max(0, mx - mins[i]), avail * 0.35));
  const sumW = weights.reduce((a, b) => a + b, 0) || 1;
  const extra = avail - sumMin;
  const widths = mins.map((mn, i) => mn + extra * weights[i] / sumW);
  const sum = widths.reduce((a, b) => a + b, 0);
  return { widths: widths.map(w => (w / sum * 100).toFixed(3) + '%'), scale };
}

/* ---------- 图片 ---------- */
const imgCache = new Map();
function imgSrc(src) {
  if (/^(https?:|data:)/.test(src)) return esc(src);
  if (!inlineImages) {
    // 输出 HTML 可能与图片不在同一层目录，按输出目录算相对路径
    const abs = path.resolve(imagesDir, src);
    const rel = path.relative(OUT_DIR, abs).split(path.sep).join('/');
    return esc(rel.startsWith('.') ? rel : './' + rel);
  }
  if (!imgCache.has(src)) {
    const mime = /\.png$/i.test(src) ? 'image/png'
      : /\.(jpe?g)$/i.test(src) ? 'image/jpeg'
      : /\.svg$/i.test(src) ? 'image/svg+xml' : 'application/octet-stream';
    imgCache.set(src, `data:${mime};base64,${fs.readFileSync(path.resolve(imagesDir, src)).toString('base64')}`);
  }
  return imgCache.get(src);
}

function figureHtml(alt, src) {
  const srcName = src.split('/').pop();
  const caption = inline(alt);
  const srcLine = showSource && srcName ? `<span class="src">图源：${esc(srcName)}</span>` : '';
  return `<figure class="fig"><img src="${imgSrc(src)}" alt="${esc(stripMd(alt))}">` +
    `<figcaption>${caption}${srcLine}</figcaption></figure>`;
}

/* ---------- 表格单元格的断行保护 ---------- */
// 1) 分隔符后加 <wbr>：断行落在 "_" "/" 之后，而不是词中间（<wbr> 不产生字符，复制路径不受影响）
function addBreakHints(html) {
  return html.replace(/(<t[hd][^>]*>)([\s\S]*?)(<\/t[hd]>)/g,
    (m, open, inner, close) => open + mapText(inner, t => t.replace(/([_/])/g, '$1<wbr>')) + close);
}
// 2) 数值不可断行：否则浏览器会贪心地把「2.44（P = 3.0e-」塞满一行，把指数尾数甩到下一行
function protectNumbers(html) {
  return html.replace(/(<t[hd][^>]*>)([\s\S]*?)(<\/t[hd]>)/g, (m, open, inner, close) =>
    open + mapText(inner, t => t.replace(
      /(?<![A-Za-z0-9_.])[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?%?[）)]?/g,
      n => (n.length <= 14 ? `<span class="nb">${n}</span>` : n))) + close);
}
// 3) 短连字符词（IFN-γ、NF-κB、IL-6 之类）不许从连字符处断开
function protectHyphenTokens(html) {
  return mapText(html, t => t.replace(/\b[A-Za-z]{1,4}-[A-Za-z\u0370-\u03ff0-9]{1,3}\b/g,
    m => (m.length <= 8 ? `<span class="nb">${m}</span>` : m)));
}

/* ---------- 渲染 ---------- */
const headings = [];
let headSeq = 0;
const pieces = [];

const titleText = opt('--title')
  || (blocks[0] && blocks[0].kind === 'head' ? blocks[0].lines[0].replace(/^#\s+/, '').trim() : '报告');

function headingHtml(level, text) {
  const id = `sec-${++headSeq}`;
  headings.push({ level, text: stripMd(text), id });
  return `<h${level} id="${id}">${inline(text)}</h${level}>`;
}

function buildToc() {
  const items = headings.filter(h => h.level >= 2);
  if (!items.length) return '';
  const rows = items.map(h => {
    const pg = pagesMap && pagesMap[h.id] != null ? String(pagesMap[h.id]) : placeholder;
    const pgSpan = pg ? `<span class="pg">${esc(pg)}</span>` : '';
    return `<li class="l${h.level}"><span class="tt"><a href="#${h.id}">${esc(h.text)}</a></span>` +
      `<span class="dots"></span>${pgSpan}</li>`;
  }).join('\n');
  return `<nav class="toc">\n<h2 class="toc-title">目录</h2>\n<ul class="toc-list">\n${rows}\n</ul>\n</nav>`;
}

let hrSeen = 0;
// 副标题：h1 之后第一个短段落（≤ 60 字）视为副标题
let subtitleBlock = null;
if (blocks[1] && blocks[1].kind === 'para' && blocks[1].lines.length === 1
    && stripMd(blocks[1].lines[0]).length <= 60) subtitleBlock = blocks[1];

for (let i = 0; i < blocks.length; i++) {
  const b = blocks[i];
  const text = b.lines.join('\n');
  switch (b.kind) {
    case 'head': {
      const m = /^(#{1,6})\s+(.*)$/.exec(b.lines[0].trim());
      if (i === 0) break;                    // 文首大标题放进 <header>
      pieces.push(headingHtml(m[1].length, m[2].trim()));
      break;
    }
    case 'hr':
      hrSeen++;
      pieces.push('<hr>');
      if (hrSeen === 1) pieces.push('__TOC__');   // 引言与正文之间的第一条分隔线后放目录
      break;
    case 'img': {
      for (const l of b.lines) {
        const m = IMG_RE.exec(l.trim());
        pieces.push(figureHtml(m[1], m[2]));
      }
      break;
    }
    case 'table':
    case 'ul':
    case 'ol':
    case 'para': {
      let html = mdToHtml(text);
      const first = b.lines[0];
      if (b.kind === 'para' && b !== subtitleBlock
          && notePrefixes.some(p => stripMd(first).startsWith(p))) {
        html = html.replace(/^<p>/, '<p class="note">');
      }
      if (b === subtitleBlock) html = html.replace(/^<p>/, '<p class="doc-subtitle">');
      if (b.kind === 'table') {
        const plain = b.lines[0].replace(/`[^`]*`/g, 'x');
        const cols = plain.replace(/\\\|/g, '').split('|').length - 2;
        const measured = colwidths && colwidths.tables[tableSeq];
        tableSeq++;
        const fit = colWidthsFor(cols, measured);
        const colgroup = fit ? `<colgroup>${fit.widths.map(w => `<col style="width:${w}">`).join('')}</colgroup>` : '';
        const colFactor = cols >= 9 ? 0.8235 : cols === 8 ? 0.8588 : cols === 7 ? 0.8941 : cols === 6 ? 0.9529 : 1;
        const fs = 8.5 * colFactor * (fit ? fit.scale : 1);
        html = html.replace('<table>', `<table class="cols-${cols}${fit ? ' fixed' : ''}" style="--tfs:${fs.toFixed(2)}pt">${colgroup}`);
        html = protectNumbers(protectHyphenTokens(addBreakHints(html)));
      } else {
        html = protectHyphenTokens(html);
      }
      pieces.push(html.trim());
      break;
    }
  }
}

const body = pieces.join('\n');
const toc = buildToc();
const html = body.includes('__TOC__') ? body.replace('__TOC__', toc) : body + toc;

if (headingsOut) {
  fs.mkdirSync(path.dirname(path.resolve(headingsOut)), { recursive: true });
  fs.writeFileSync(headingsOut, JSON.stringify(headings, null, 1), 'utf8');
}

const subM = /<p class="doc-subtitle">([^<]*)<\/p>/.exec(html);
const subtitleHtml = subM ? `<p class="doc-subtitle">${subM[1]}</p>` : '';
const bodyHtml = subM ? html.replace(subM[0], '') : html;

const doc = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titleText)}</title>
<style>
/* ========== 打印 / 另存 PDF ========== */
@page { size: A4; margin: 19mm 17mm 17mm 17mm; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { background: #ffffff; }
body {
  margin: 0;
  padding: 0;
  font-family: "Songti SC", "STSong", "Source Han Serif SC", "Noto Serif CJK SC", "SimSun", serif;
  font-size: 10.5pt;
  line-height: 1.74;
  color: #141414;
  text-align: left;   /* 两端对齐遇到长路径/标识符会拉出字间空洞 */
}
.nb { white-space: nowrap; }
main.doc { display: block; }

/* ========== 文首标题 ========== */
.doc-head { margin: 0 0 14pt; padding-bottom: 10pt; border-bottom: 1.6pt solid #24476b; }
h1 {
  font-family: "Hiragino Sans GB", "Heiti SC", "STHeiti", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  font-size: 18.5pt;
  line-height: 1.42;
  font-weight: 600;
  letter-spacing: 0.2pt;
  text-align: center;
  margin: 0 0 10pt;
  color: #10233a;
}
.doc-subtitle {
  font-family: "Hiragino Sans GB", "Heiti SC", "STHeiti", "Microsoft YaHei", sans-serif;
  font-size: 10pt;
  color: #5c6672;
  text-align: center;
  letter-spacing: 0.6pt;
  margin: 0;
}

/* ========== 标题层级 ========== */
h2, h3, h4 {
  font-family: "Hiragino Sans GB", "Heiti SC", "STHeiti", "Microsoft YaHei", sans-serif;
  color: #10233a;
  break-after: avoid;
  page-break-after: avoid;
}
h2 { font-size: 14pt; font-weight: 600; margin: 18pt 0 8pt; padding-bottom: 3.5pt; border-bottom: 0.9pt solid #b9c6d4; break-inside: avoid; }
h3 { font-size: 11.8pt; font-weight: 600; margin: 13.5pt 0 5.5pt; }
h4 { font-size: 10.8pt; font-weight: 600; margin: 11pt 0 4.5pt; color: #24476b; }

/* ========== 正文 ========== */
p { margin: 0 0 7pt; orphans: 2; widows: 2; }
p.note {
  background: #f5f7fa;
  border-left: 2.4pt solid #24476b;
  padding: 7pt 9pt;
  margin: 0 0 10pt;
  font-size: 9.6pt;
  line-height: 1.7;
  color: #2b2b2b;
}
strong { font-weight: 700; }
a { color: #24476b; text-decoration: none; }
code {
  font-family: "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.86em;
  background: #f2f3f5;
  border-radius: 2px;
  padding: 0.4pt 1.8pt;
  word-break: break-word;
  overflow-wrap: anywhere;
}
hr { border: none; border-top: 0.7pt solid #cccccc; margin: 14pt 0; }

/* ========== 列表 ========== */
ul, ol { margin: 5pt 0 9pt; padding-left: 1.55em; }
li { margin: 2.2pt 0; }
li::marker { color: #5c6672; }
li p { margin: 0; }

/* ========== 表格 ========== */
table {
  width: 100%;
  border-collapse: collapse;
  font-family: "Hiragino Sans GB", "Heiti SC", "STHeiti", "Microsoft YaHei", sans-serif;
  font-size: var(--tfs, 8.5pt);
  line-height: 1.52;
  margin: 7pt 0 12pt;
  text-align: left;
}
table.fixed { table-layout: fixed; }   /* 列宽由测量结果写死，断行只落在 _ / - 与空格处 */
table.cols-6 th, table.cols-6 td { padding: 3.1pt 4.2pt; }
table.cols-7 th, table.cols-7 td { padding: 2.9pt 3.6pt; }
table.cols-8 th, table.cols-8 td { padding: 2.7pt 3.2pt; }
table.cols-9 th, table.cols-9 td, table.cols-10 th, table.cols-10 td { padding: 2.5pt 3pt; }
thead { display: table-header-group; }
th { background: #eef2f7; border-top: 0.9pt solid #9fb0c2; border-bottom: 0.9pt solid #9fb0c2; font-weight: 600; color: #10233a; }
td { border-bottom: 0.5pt solid #dde3e9; vertical-align: top; }
/* break-word（不是 anywhere）：只在整词放不下时才断，数值不会被拆开；中文照常逐字换行 */
th, td { padding: 3.4pt 5pt; overflow-wrap: break-word; word-break: normal; }
tbody tr:nth-child(even) { background: #f8fafc; }
tr { break-inside: avoid; page-break-inside: avoid; }

/* ========== 插图 ========== */
figure.fig { margin: 9pt 0 11pt; break-inside: avoid; page-break-inside: avoid; text-align: center; }
figure.fig img { max-width: 100%; max-height: 232mm; width: auto; height: auto; }
figure.fig figcaption { margin-top: 5pt; font-size: 8.6pt; line-height: 1.55; color: #333333; text-align: left; }
figure.fig figcaption .src { display: block; margin-top: 2pt; font-family: "SF Mono", Menlo, monospace; font-size: 8pt; color: #8a8a8a; }

/* ========== 屏幕阅读：只改版心与留白，字号/配色/表格样式与打印（PDF）一致 ========== */
@media screen {
  html { background: #ffffff; }
  body {
    width: 176mm;                          /* 与 PDF 的正文栏同宽（A4 210mm − 左右各 17mm） */
    max-width: calc(100% - 40px);          /* 窄窗口时收边距，不横向滚动 */
    margin: 0 auto;
    padding: 48px 0 72px;
  }
  a { text-decoration: underline; text-underline-offset: 2px; }   /* 屏幕上的可点击提示 */
}

/* ========== 目录 ========== */
nav.toc { break-before: page; page-break-before: always; break-after: page; page-break-after: always; }
h2.toc-title { font-size: 15pt; border: none; margin: 0 0 12pt; padding: 0; letter-spacing: 3pt; text-align: center; }
ul.toc-list { list-style: none; margin: 0; padding: 0; }
ul.toc-list li {
  display: flex; align-items: baseline; gap: 3pt; margin: 0 0 3.4pt;
  font-family: "Hiragino Sans GB", "Heiti SC", "STHeiti", "Microsoft YaHei", sans-serif;
  break-inside: avoid;
}
ul.toc-list li .tt { flex: 0 1 auto; }
ul.toc-list li .dots { flex: 1 1 auto; border-bottom: 0.5pt dotted #b8b8b8; transform: translateY(-2.6pt); min-width: 8pt; }
ul.toc-list li .pg { flex: 0 0 auto; color: #44546a; font-variant-numeric: tabular-nums; }
ul.toc-list li.l2 { font-size: 10pt; font-weight: 600; margin-top: 7pt; color: #10233a; }
ul.toc-list li.l3 { font-size: 9.2pt; padding-left: 1.1em; }
ul.toc-list li.l4 { font-size: 8.7pt; padding-left: 2.2em; color: #44546a; }
ul.toc-list li a { color: inherit; }
</style>
</head>
<body>
<!-- 正文里的 $ 常出现在 R 代码标识符（如 sc$donor）里，本文档没有数学公式。
     这个空实现让后续若用 Chromium 打印成 PDF 时，不会再因 $ 误判而去 CDN 注入 KaTeX。 -->
<script>window.renderMathInElement = function () {};</script>
<header class="doc-head">
<h1>${inline(titleText)}</h1>
${subtitleHtml}
</header>
<main class="doc">
${bodyHtml}
</main>
</body>
</html>
`;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(outPath, doc, 'utf8');
const figs = (doc.match(/<figure class="fig">/g) || []).length;
const tabs = (doc.match(/<table /g) || []).length;
console.log(`HTML 写出: ${outPath}`);
console.log(`标题 ${headings.length}（目录 ${headings.filter(h => h.level >= 2).length} 条）  图 ${figs}  表 ${tabs}  大小 ${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)} MB`);
if (!pagesMap && !placeholder) console.log('目录未显示页码（未提供 --pages；纯 HTML 阅读不需要）');