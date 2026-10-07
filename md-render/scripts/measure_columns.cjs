#!/usr/bin/env node
/**
 * 在 Chromium 里测量每张表每列的最小/最大内容宽度，供 md_to_html.cjs 写死列宽。
 *
 * 为什么需要：表格用自动布局时，Chromium 按各列「最长一行」的比例分配宽度，
 * 中文列的最长一行往往极宽，会把含长路径/标识符的窄列挤到低于其最小内容宽度，
 * 于是文件名、P 值就从词中间断开。测量后按「先满足最小宽度、再分配余量」写死列宽，
 * 断行就只会落在 "_" "/" "-" 和空格处。
 *
 * 用法: node measure_columns.cjs <html> <out.json> [--content-width <css 长度>]
 *   --content-width 覆盖正文栏宽（默认从 HTML 的 @page 规则推算：页宽 - 左右页边距）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

/** 把 CSS 长度转成 px（96dpi） */
function toPx(v) {
  const m = /^(-?[\d.]+)(px|pt|mm|cm|in)?$/.exec(String(v).trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  switch (m[2] || 'px') {
    case 'px': return n;
    case 'pt': return n * 96 / 72;
    case 'mm': return n * 96 / 25.4;
    case 'cm': return n * 96 / 2.54;
    case 'in': return n * 96;
    default: return n;
  }
}
/** A4/A3/Letter/A5 之类的具名页宽（mm） */
const NAMED_MM = { a3: 297, a4: 210, a5: 148, letter: 215.9, legal: 215.9 };

/** 从 HTML 的 @page 规则推算正文栏宽（px，96dpi = 打印时的排版宽度） */
function contentWidthFromHtml(html) {
  const styleText = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
  const page = /@page\s*\{([^}]*)\}/.exec(styleText);      // 只认无名字的 @page
  if (!page) return null;
  const body = page[1];

  const sizeM = /size:\s*([^;]+)/.exec(body);
  let widthPx = null;
  if (sizeM) {
    const first = sizeM[1].trim().toLowerCase().split(/\s+/)[0];
    if (NAMED_MM[first]) widthPx = NAMED_MM[first] * 96 / 25.4;   // 具名尺寸是 mm
    else {
      const px = toPx(first);
      if (px) widthPx = px;                                        // 显式长度按 96dpi 换算
    }
  }
  if (!widthPx) return null;

  const marginM = /margin:\s*([^;]+)/.exec(body);
  let leftRightPx = 0;
  if (marginM) {
    const parts = marginM[1].trim().split(/\s+/).map(toPx).filter(v => v != null);
    if (parts.length === 1) leftRightPx = parts[0] * 2;
    else if (parts.length === 2) leftRightPx = parts[1] * 2;
    else if (parts.length === 3) leftRightPx = parts[1] * 2;
    else if (parts.length >= 4) leftRightPx = parts[1] + parts[3];
  }
  return widthPx - leftRightPx;
}

(async () => {
  const args = process.argv.slice(2);
  const htmlPath = path.resolve(args[0] || '');
  const outPath = path.resolve(args[1] || 'colwidths.json');
  const cwIdx = args.indexOf('--content-width');
  if (!htmlPath || !fs.existsSync(htmlPath)) {
    console.error('用法: node measure_columns.cjs <html> <out.json> [--content-width 665px]');
    process.exit(1);
  }
  const html = fs.readFileSync(htmlPath, 'utf8');
  const contentWidth = (cwIdx > -1 ? toPx(args[cwIdx + 1]) : null) || contentWidthFromHtml(html) || 665.2;

  const exe = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const browser = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : {}) });
  // 视口必须等于打印时的正文栏宽，否则量到的是屏幕宽度，列宽会算错
  const page = await browser.newPage({ viewport: { width: Math.round(contentWidth), height: 1123 } });
  await page.goto('file://' + htmlPath, { waitUntil: 'networkidle' });
  await page.emulateMedia({ media: 'print' });

  const result = await page.evaluate(() => {
    const CJK = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/;
    const RE_BREAK = /[\s\/_\-]/;
    const meter = document.createElement('span');
    meter.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:pre;';
    document.body.appendChild(meter);
    const measure = (text, font) => {
      meter.style.font = font;
      meter.textContent = text;
      return meter.getBoundingClientRect().width;
    };

    const tables = [];
    for (const table of document.querySelectorAll('table')) {
      const firstRow = table.querySelector('tr');
      const nCols = firstRow ? firstRow.children.length : 0;
      if (!nCols) continue;
      const cols = Array.from({ length: nCols }, () => ({ min: 0, max: 0 }));
      const seen = new Set();
      for (const row of table.querySelectorAll('tr')) {
        Array.from(row.children).forEach((cell, ci) => {
          if (ci >= nCols) return;
          const cs = getComputedStyle(cell);
          const font = cs.font || `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
          const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
          const text = (cell.innerText || '').replace(/\s+/g, ' ').trim();
          if (!text) return;
          const key = ci + '|' + font + '|' + text;
          if (seen.has(key)) return;
          seen.add(key);
          cols[ci].max = Math.max(cols[ci].max, measure(text, font) + pad);
          // 最小内容宽度：只允许在空白、/ _ - 之后以及汉字之间换行
          let widest = 0;
          let seg = '';
          const flush = () => {
            const s = seg.replace(/\s+$/, '');
            if (s) widest = Math.max(widest, measure(s, font));
            seg = '';
          };
          for (const ch of text) {
            seg += ch;
            if (RE_BREAK.test(ch) || CJK.test(ch)) flush();
          }
          flush();
          cols[ci].min = Math.max(cols[ci].min, widest + pad);
        });
      }
      tables.push({ cols, tableWidth: table.getBoundingClientRect().width });
    }
    meter.remove();
    const container = document.querySelector('main.doc') || document.body;
    return { containerWidthPt: container.getBoundingClientRect().width * 72 / 96, tables };
  });

  fs.writeFileSync(outPath, JSON.stringify(result, null, 1), 'utf8');
  const avail = result.containerWidthPt;
  console.log(`测量 ${result.tables.length} 张表，正文栏宽 ${avail.toFixed(1)}pt（视口 ${Math.round(contentWidth)}px）`);
  result.tables.forEach((t, i) => {
    const sumMin = t.cols.reduce((a, c) => a + c.min, 0);
    const sumMax = t.cols.reduce((a, c) => a + c.max, 0);
    const flag = sumMin > avail * 0.97 ? '  ⚠ 最小宽度已超栏宽（渲染时会整体缩字号）' : '';
    console.log(`  表${String(i + 1).padStart(2)}: ${String(t.cols.length).padStart(2)} 列  最小 ${sumMin.toFixed(0)}pt  最长 ${sumMax.toFixed(0)}pt${flag}`);
  });
  await browser.close();
})().catch(err => {
  console.error('✗ 列宽测量失败:', err.message);
  process.exit(1);
});
