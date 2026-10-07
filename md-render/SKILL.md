---
name: md-render
description: 把 markdown 报告/长文档排版成 HTML（屏幕阅读版或单文件版），审过后可再转 A4 PDF：图按原文位置插在段落间、表格列宽按实测写死（数值与文件名不被拆行）、CJK 加粗与标点正确、自动生成可点击目录，屏幕居中栏两侧留白、打印走 A4。用户说「md 转 html」「报告做成网页/单文件 html」「排一下版」「图片插到对应段落」「顺便给一份 A4 pdf」时都用，即使没说「要排版」。
---

# markdown 报告 → 阅读版 HTML → A4 PDF

把一份带图、带表的 markdown 长文档（中文技术/科研报告最常见）转成能直接打开阅读的 HTML：
屏幕上是居中栏 + 两侧留白 + 白卡片，图片按原位置插在段落之间，表格不拆数值、不拆文件名，
目录可点击；HTML 审查通过后，再从同一份 HTML 转出 A4 PDF（同一份文件打印/另存也是这样）。

## 产出

| 文件 | 用途 |
|---|---|
| `<name>.html` | 图片用相对路径引用，和 md 放在同一目录即可，便于后续改样式 |
| `<name>_standalone.html` | 图片 base64 内嵌，单文件可传阅（科研报告约 5 MB，可接受） |
| `<name>.pdf` | 需要纸质/存档时，从 standalone 版转出的 A4 PDF（第 5 步，可选） |

只想给用户一个文件时，给 standalone 版；要 PDF 时先审 HTML，再从 standalone 版转。

## 环境准备（一次性）

脚本要 `marked`；测量列宽、自检、转 PDF 要 `playwright` + Chromium；写页脚页码要 `pdf-lib`；
提取标题页码（可选）要 `pdfjs-dist`。装在一个可再生缓存目录里，不要污染项目：

```bash
CACHE=~/Library/Caches/md-report-html        # Linux: ~/.cache/md-report-html；目录名与 skill 名无关，装一次长期复用
mkdir -p "$CACHE" && cd "$CACHE" && npm init -y >/dev/null
npm i marked playwright pdf-lib pdfjs-dist
npx playwright install chromium              # 下载不到就照 references/setup.md 换 Chrome for Testing
export NODE_PATH="$CACHE/node_modules"       # 每次调用脚本前 export 一次
```

`marked` 缺失脚本会直接报错；`playwright` 只影响第 2、4、5 步（无它也能出 HTML，但表格会被浏览器拆词）。

## 工作流

下面命令里的 `$SKILL` 指这个 skill 的目录：

```bash
SKILL=~/.agents/skills/md-render
```

### 1. 先出一版 HTML（不含列宽）

```bash
node "$SKILL/scripts/md_to_html.cjs" 报告.md --out 报告.html --headings headings.json
```

看输出行：`标题 N（目录 M 条） 图 X 表 Y`。**图和表的数量必须和 md 里的 `![...]()` 与表格块数量一致**，
不一致就是块级解析漏了东西，先解决再往下走。

### 2. 测量表格列宽

```bash
node "$SKILL/scripts/measure_columns.cjs" 报告.html colwidths.json
```

它会按 HTML 里 `@page` 规则推算正文栏宽，用同样的宽度在 Chromium 里量每列的最小/最大内容宽度。
输出里出现 `⚠ 最小宽度已超栏宽` 是正常的——渲染时会自动给那张表整体缩字号（下限 ≈7pt），
比让浏览器把 `GSE241664_read_counts.csv.gz` 从中间劈开更好。

### 3. 出正式版（写死列宽，出相对路径版 + standalone 版）

```bash
node "$SKILL/scripts/md_to_html.cjs" 报告.md --out 报告.html --colwidths colwidths.json \
  --note-prefix "解释修订说明"        # 可选：以该文字开头的段落渲染成浅底提示框
node "$SKILL/scripts/md_to_html.cjs" 报告.md --out 报告_standalone.html \
  --colwidths colwidths.json --inline-images
```

目录默认不显示页码（纯 HTML 阅读不需要）。要显示就加 `--pages pages.json`
（`{标题 id: 页码}` 映射，通常在另外生成 PDF 时才拿得到）。

### 4. 审查 HTML（这一步是必须的，别跳过）

```bash
node "$SKILL/scripts/check_html.cjs" 报告_standalone.html --shots /tmp/shots \
  --expect-figures 33 --expect-tables 16
```

通过标准：`✓ 自检通过`（无图片未加载、无表格/单元格溢出、正文无字面 `**`、图/表数量符合预期）。
加了 `--shots` 会写出顶部/目录/首表/首图/窄窗口五张截图，**自己看一眼这些截图**：
两侧留白是否舒服、表格字号是否还读得清、图有没有被压扁。这一步比读脚本输出有用得多。

**不通过就回到第 1 步改（CSS 或 md），重出 HTML 再审；HTML 没审过不要往下转 PDF**——
PDF 是这棵树的叶子，HTML 错了 PDF 一定错，而且改 PDF 比改 HTML 贵得多。

### 5. 转 A4 PDF（不需要再审）

```bash
node "$SKILL/scripts/html_to_pdf.cjs" 报告_standalone.html --out 报告.pdf \
  --title "报告标题" --subject "副标题"
```

页宽按 HTML 里的 `@page` 规则（A4），页脚居中「n / N」由 pdf-lib 补写，首页默认不编号
（`--footers-skip 0` 可改）。用 standalone 版转，PDF 才不依赖同目录的图片文件。

**想让 PDF 目录带页码**（可选，两轮）：Chromium 不能在页边写 CSS 页码框，
页码只能渲染后补，而目录里的页码又必须在渲染前写进 HTML，所以是两轮：

```bash
# 5a 占位轮：出 PDF 并导出「标题 → 页码」
node "$SKILL/scripts/md_to_html.cjs" 报告.md --out 报告_standalone.html \
  --colwidths colwidths.json --inline-images --headings headings.json --placeholder 00
node "$SKILL/scripts/html_to_pdf.cjs" 报告_standalone.html --out /tmp/pass1.pdf \
  --headings headings.json --map-out pages.json

# 5b 填号轮：目录填真实页码后重出，并复验分页没被填号改掉
node "$SKILL/scripts/md_to_html.cjs" 报告.md --out 报告_standalone.html \
  --colwidths colwidths.json --inline-images --pages pages.json
node "$SKILL/scripts/html_to_pdf.cjs" 报告_standalone.html --out 报告.pdf \
  --headings headings.json --verify-map pages.json --title "报告标题"
```

`--verify-map` 不一致会以退出码 3 结束——说明填号改变了分页，得拿新映射再跑一轮 5b。
纯 HTML 阅读不需要页码，就不必做这两轮。

## 风格是锁定的，不要另行设计

视觉样式全部写死在 `scripts/md_to_html.cjs` 的 `<style>` 里，HTML、standalone、PDF 三份产物
共用同一份样式表（屏幕端只多一条「居中版心 + 两侧留白」，字号/配色/表格/图注与打印完全一致）。
因此：

- **不要换主题、配色、字体或重排间距**，也不要给某些文档"定制设计"。要改样式就改这段 CSS，
  改完重新走一遍第 1–5 步，让三份产物一起更新——三份风格必须永远一致。
- 参照标准是 2026-09-27 交付的那份 `SFRP2_ICI_colitis.pdf`（同一套 CSS 出的 A4 版式）。

## 排版约定（为什么这么定）

- **正文左对齐，不用两端对齐。** 报告里满是 `scripts/13_GSE189184_spatial_download.sh` 这类长 token，
  两端对齐会把行拉出 3–4 个字宽的空洞，`、` 浮在空白中间。
- **图整幅独占一行**（`figure` + `break-inside: avoid`），图注在下方、图源文件名另起一行小字。
  单栏横排图被正文绕排是报告里最容易出错的版式，不做。
- **表格字号按列数递减**（`--tfs` 变量：≤5 列 8.5pt，6 列 8.1，7 列 7.6，8 列 7.3），列越多越挤，
  不缩字号就必然出现折行拆数值。
- **单元格换行只允许落在 `_` `/` `-` 和空格处**：靠两个手段叠加——`<wbr>` 插在分隔符后（提供断点），
  数值 token 包 `white-space: nowrap`（禁止断点）。`th,td` 用 `overflow-wrap: break-word`
  而**不是** `anywhere`：`anywhere` 会让最小内容宽度塌成 1 个字符，浏览器于是随便拆。
- **屏幕与打印两套样式**：`@media screen` 里卡片居中（`max-width: 800px` ≈ 40–50 汉字/行）、
  字号放大 1.18 倍、更宽的页边留白；`@page` 与打印分支保持 A4 版式，浏览器直接打印就是一册文档。
- **字体栈带跨平台回退**：中文正文 `Songti SC → STSong → Source Han Serif → Noto Serif CJK → SimSun`，
  标题走无衬线（`Hiragino Sans GB → Heiti SC → Microsoft YaHei → Noto Sans`）。
  注意：macOS 无头环境里 **PingFang SC 常常不可用**，字体栈里写了它也只会静默回退成宋体。

## 已知坑

写文件前先读 `references/gotchas.md`，里面是每条规则背后的真实翻车记录（CJK 加粗定界符、
`$` 被误判数学公式、按宽度分配列宽的正确与错误做法、页脚/页码策略等）。
遇到浏览器下载失败、`PLAYWRIGHT_CHROMIUM_PATH` 之类环境问题看 `references/setup.md`。
