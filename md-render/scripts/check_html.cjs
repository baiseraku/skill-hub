#!/usr/bin/env node
/**
 * HTML 交付物自检：内容完整性 + 版面（表格溢出、图片加载、字面残留的 markdown 标记）。
 * 表格列宽与断行保护只改 CSS，问题往往只在不渲染的时候才暴露，所以必须有这一步。
 *
 * 用法: node check_html.cjs <html> [--shots <目录>] [--expect-figures N] [--expect-tables N]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const htmlPath = path.resolve(args[0] || '');
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i > -1 ? args[i + 1] : def;
};
const shotsDir = opt('--shots', null);
if (!htmlPath || !fs.existsSync(htmlPath)) {
  console.error('用法: node check_html.cjs <html> [--shots <目录>]');
  process.exit(1);
}

(async () => {
  const exe = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const browser = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const failed = [];
  page.on('requestfailed', r => failed.push(r.url().slice(0, 80)));
  await page.goto('file://' + htmlPath, { waitUntil: 'networkidle' });

  const r = await page.evaluate(() => {
    const docW = (document.querySelector('main.doc') || document.body).clientWidth;
    const imgs = [...document.querySelectorAll('img')];
    const tables = [...document.querySelectorAll('table')];
    const overflow = [];
    tables.forEach((t, i) => {
      if (t.getBoundingClientRect().width > docW + 1) overflow.push(`表${i + 1} 超出正文栏`);
      t.querySelectorAll('td,th').forEach(c => {
        if (c.scrollWidth > c.clientWidth + 1) {
          overflow.push(`表${i + 1} 单元格溢出 ${c.scrollWidth - c.clientWidth}px: ${(c.textContent || '').trim().slice(0, 24)}`);
        }
      });
    });
    const bodyText = document.body.innerText || '';
    return {
      figures: document.querySelectorAll('figure.fig').length,
      images: imgs.length,
      imagesBroken: imgs.filter(i => i.naturalWidth === 0).map(i => i.getAttribute('src').slice(0, 60)),
      tables: tables.length,
      headings: document.querySelectorAll('main.doc h2, main.doc h3, main.doc h4').length,
      tocEntries: document.querySelectorAll('ul.toc-list li').length,
      tocNumbered: document.querySelectorAll('ul.toc-list li .pg').length,
      literalBold: (bodyText.match(/\*\*/g) || []).length,
      literalBacktick: (bodyText.match(/`/g) || []).length,
      docW,
      cardW: Math.round(document.body.getBoundingClientRect().width),
      overflow: overflow.slice(0, 12),
      overflowCount: overflow.length,
    };
  });

  const expFig = Number(opt('--expect-figures', '0'));
  const expTab = Number(opt('--expect-tables', '0'));
  const problems = [];
  if (r.imagesBroken.length) problems.push(`图片未加载：${r.imagesBroken.join(' / ')}`);
  if (failed.length) problems.push(`请求失败：${failed.slice(0, 3).join(' / ')}`);
  if (r.literalBold) problems.push(`正文里有 ${r.literalBold} 处字面 "**"（markdown 加粗没渲染）`);
  if (r.overflowCount) problems.push(`版面溢出 ${r.overflowCount} 处`);
  if (expFig && r.figures !== expFig) problems.push(`图数量 ${r.figures} ≠ 预期 ${expFig}`);
  if (expTab && r.tables !== expTab) problems.push(`表数量 ${r.tables} ≠ 预期 ${expTab}`);

  console.log(`图 ${r.figures}（img ${r.images}）  表 ${r.tables}  标题 ${r.headings}  目录 ${r.tocEntries} 条（${r.tocNumbered} 条带页码）`);
  console.log(`正文栏 ${r.docW}px，卡片 ${r.cardW}px，两侧留白约 ${Math.round((1440 - r.cardW) / 2)}px（1440 窗口）`);
  console.log(problems.length ? '⚠ 问题:\n  · ' + problems.join('\n  · ') : '✓ 自检通过');
  if (r.overflowCount) console.log('  溢出明细: ' + r.overflow.join(' | '));

  if (shotsDir) {
    fs.mkdirSync(shotsDir, { recursive: true });
    await page.screenshot({ path: path.join(shotsDir, '01-顶部.png') });
    for (const [sel, name] of [['nav.toc', '02-目录.png'], ['table', '03-首表.png'], ['figure.fig', '04-首图.png']]) {
      const el = await page.$(sel);
      if (el) await el.screenshot({ path: path.join(shotsDir, name) });
    }
    const narrow = await browser.newPage({ viewport: { width: 820, height: 900 } });
    await narrow.goto('file://' + htmlPath, { waitUntil: 'networkidle' });
    await narrow.screenshot({ path: path.join(shotsDir, '05-窄窗口.png') });
    console.log('截图写出 →', shotsDir);
  }

  await browser.close();
  process.exit(problems.length ? 2 : 0);
})().catch(err => {
  console.error('✗ 自检失败:', err.message);
  process.exit(1);
});
