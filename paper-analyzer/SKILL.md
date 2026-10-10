---
name: paper-analyzer
description: |
  将学术论文转化为深度HTML长文。6轮强制工作流、代码仓库搜索、公式渲染、Mermaid图表。
  3种写作风格，输出可直接分享的精美HTML页面。
---

# Paper Analyzer — 学术论文深度解析

⚠️ **这是生产级指令。你的唯一任务：产出一篇让读者觉得"比我读论文还清楚"的深度HTML长文。**

## 快速使用

```
/paper-analyzer https://arxiv.org/abs/2605.07363
/paper-analyzer /path/to/paper.pdf
/paper-analyzer  粘贴文本
```

---

## 强制工作流（每一步必须执行，不可跳过）

### Round 1：获取论文全文 ⛔

| 输入 | 执行 |
|------|------|
| arxiv URL | **同时读** arxiv.org/abs/（摘要）和 arxiv.org/html/（全文HTML） |
| PDF路径 | 用PDF读取工具读全文。分多次直到全部获取 |
| 文本 | 全部使用 |

**自检**：有没有完整内容？没有 → 换方式继续。

### Round 1.5：导出插图（要把原图嵌进 HTML 时）⛔

⚠️ **别用「提取嵌入图片」的办法取图。** 出版排版里插图 = 位图（图形本身）+ **矢量文字层**
（面板字母 A/B/C、坐标轴标注、聚类/样本编号、图例、通路名、基因名、统计标注）。
`get_images()`、`pdfimages` 这类提取嵌入图片的手段只拿得到位图，**图上所有文字会静默消失**，
只剩图形。这不是清晰度问题——那些字根本不在提取出来的数据里，提高 JPEG 质量或渲染分辨率都救不回来。

**正确做法**：按**整幅图的区域渲染页面**（如 PyMuPDF 的 `page.get_pixmap(clip=...)`），
位图与矢量文字一起栅格化。区域按这样定：

1. 从位图 bbox 起步；
2. 并入**与之相交**、**紧邻其上方约 16pt 内**、以及**贴左/右外沿 16pt 内的单字母（A–H）面板标签**
   的文字块（面板字母可能画在上方也可能在侧边，不在 bbox 内，漏了会切掉 A/B）；
3. 纵向截到图注之前——以 `^Figure \d+\.` 开头文字块的 y0 作下界留 3pt 余量，否则图注会被切进图里；
4. 四周留 2pt。

**判别方法**：同一小块区域，把「嵌入位图」和「按页面渲染」两种结果各出一张对比，位图版有图形没文字即命中。

**分辨率**：图在 A4 正文栏宽（176mm）铺满时，渲染 zoom 取 3.5–4 可到 250–300 DPI。

**直接用现成脚本**（上述逻辑已固化，含图注边界与面板字母的处理）：

```bash
python3 ~/.agents/skills/paper-analyzer/scripts/extract_figures.py 论文.pdf ./assets/figures \
  --pages 4:fig1,6:fig2,8:fig3 --zoom 3.6
```

不传 `--pages` 时自动探测含位图的页。输出目录会附一份 `_figmeta.json` 记录每张图的图区、像素与宽高比。

⚠️ **图区改动会改变宽高比，进而改变分页。** 如果下游还要出 PDF（如交给 md-render），
重出图之后必须重算目录页码，不能沿用旧的映射。

### Round 2：搜索开源代码 ⛔

1. 从论文中提取代码仓库链接（通常在页脚或 Introduction 末）
2. 没有则用论文标题+作者名搜索 GitHub
3. 克隆：`git clone --depth 1 <url> /tmp/paper_code`
4. 阅读 README → 核心源码文件 → 配置文件

**根据代码状态分支处理**：

| 状态 | 处理 | 文章体现 |
|------|------|---------|
| ✅ 已发布 | 读核心文件，找 ≥2 处论文方法↔源码对应 | 贴代码段（≤30行），标注 `文件路径:行号` |
| ⏳ 待发布 | 检查 README/Release 标记 | 标注状态+仓库链接 |
| ❌ 无代码 | 搜索替代实现/相关项目 | 注明"本文未提供公开代码" |

### Round 3：深度分析 ⛔ 内部完成，不展示过程

1. 核心创新：论文做了什么别人没做的？（1-3个，每个一句话提炼）
2. 方法细节：输入→处理→输出→为什么更好（每个创新画清楚这条线）
3. 关键实验：哪个结果最有说服力？为什么？
4. 论文弱点：作者自述 + 你的判断
5. 代码对应：每个 component 对应哪个文件/函数

### Round 4：询问用户 ⛔

必须问风格选择，用户未回则默认 academic。

### Round 5：写作输出HTML ⛔

按选定风格的要求写，输出完整HTML。模板见下文。

#### 产出规格（硬要求）⛔

**交付物是 standalone 单文件版；但不要一开始就写内嵌版。顺序是：先出轻量 index → 在 index 上终审 → 通过后再转 standalone。**

**第一步：写 `index.html`（轻量、可审）。** 图片按相对路径引用（`<img src="assets/figures/fig1.jpg">`），
公式与图表用模板里的 CDN `<script>`。这样文件只有几十 KB，改一句话、调个措辞都很轻，也方便在浏览器里来回审。

**第二步：在 index 上做终审。** 按 Round 6 的清单逐项过，并按 **6.1 渲染验证（固定流程）** 在浏览器里实际打开看渲染。
**审查只发生在 index 上**——不要对着几百 KB 的 base64 去核对内容。

**第三步：终审通过后再转 standalone。** 一条命令：

```bash
python3 ~/.agents/skills/paper-analyzer/scripts/inline_images.py index.html
# → 生成 index_standalone.html（图片全部 base64 内嵌）

# 只想确认是否已达标：退出码 0 = 图片全部内嵌，2 = 还有外链
python3 ~/.agents/skills/paper-analyzer/scripts/inline_images.py index.html --check
```

**交付的是 `index_standalone.html`，不是 `index.html`。** 两个文件都在没问题——index 留作可维护的源
（以后要改就改它，再跑一次第三步），standalone 是拿去分享的那个。但**交付时要说清哪个是最终件**，
别让人误取 index 发出去（分享时只发 HTML、忘了发图目录，接收方看到的就是一整套裂图）。

- 内嵌后单文件通常 5–10 MB（8 张论文插图 base64 后膨胀约 1/3）。这是可接受的代价，不要为压体积退回外链。要压就压图片本身的质量或宽度（JPEG q≈88、宽 ≈1700px），不要改成引用。
- **不要用 `--in-place`**：那会把 index.html 本身变成几 MB 的重件，之后每次改措辞都要在这个巨型文件上定位，得不偿失。

**CDN 外链怎么办。** 模板里的 KaTeX 与 Mermaid 是 CDN 加载的 `<script>`，在线打开正常。图片内嵌是硬要求；公式与图表要做到完全离线可用，需在渲染后把**渲染结果**烘焙成静态标记再去掉这些 script（用无头浏览器跑一次）。这一项按需处理，但**交付时必须向用户说明还剩哪些外链**，不要让人以为断网也能完整显示。

### Round 6：自我审查 ⛔

逐项检查，不通过则修改直到通过。

**审查对象是 `index.html`**（轻量版），在浏览器里实际打开看。审查通过后才执行 Round 5 第三步转 standalone；
转了 standalone 若又改动内容，必须回到 index 改、重新审查、再转一次，不要直接编辑 standalone。

#### 6.1 渲染验证（固定流程）⛔

⛔ **禁止为了验证而下载浏览器。** 先探测复用本机已有 Chromium；失败也不要退回 IAB / QuickLook
（验证方式见下方"不可靠清单"），而是与用户确认后再决定是否下载。

**准备（每个项目一次）：** 项目内 venv；pip 默认走本地缓存，重复安装不会重新下载。

```bash
python3 -m venv .cache/venv
.cache/venv/bin/pip install pymupdf playwright   # pymupdf 出图用（Round 1.5），playwright 渲染用
```

**执行：** 用本 skill 自带脚本，**放在 `file://` 下直开 index.html**——headless Chromium 能正常加载
相对路径图片与 CDN 资源，不需要起本地 HTTP 服务器（起服务器可能被审批拦截）。

```bash
.cache/venv/bin/python ~/.agents/skills/paper-analyzer/scripts/verify_render.py .
# 自动对照 index.html 核对公式数/图片数，输出渲染数据 + build/shots/segNN.jpg 分段截图
# 退出码 0 = 数据全部达标；非 0 = 回 index.html 修改后重跑
```

Chromium 复用顺序（脚本已内置，不下载）：`CHROMIUM_PATH` 环境变量 → macOS
`~/Library/Caches/ms-playwright/` 下的 headless shell / Chromium.app → Linux `~/.cache/ms-playwright/`。

**数据达标后逐段目视过一遍截图**（图片/公式/表格/分栏）——这是"在浏览器里实际打开看过"的证据。

⛔ **以下方式已验证不可靠，不要改用：**

- **ZCode 内置浏览器（IAB）截图**：`surface preparation timed out`（3s 上限）常态出现，
  把页面缩短到一屏也照样超时——截图功能整体不可用。
- **qlmanage（系统 QuickLook）**：只做静态渲染——CSS 生效，但**不执行 JS**（公式显示为 `$$` 源码）、
  **不加载相对路径图片**，只能看排版，验证不了公式和图片。
- **整页 `clip` 截图**：页面超过 **16384px** 会被 Chromium 拒绝（`Clipped area is either empty
  or outside the resulting image`）→ 必须滚动 + 视口截图（verify_render.py 已处理）。
- **`playwright install chromium`**：默认 CDN 下载常极慢或卡死（实测 15 分钟 0 进度）。
  本机确实没有可复用二进制时，先告知用户体积（150MB+）再决定。

**止损原则**：任何渲染手段先做一次冒烟（30 秒内能否出结果），失败立即换路径，不要对同一失败方式
反复重试——排查 IAB 截图曾空耗四轮。

### Round 7：清理（交付后的固定动作）⛔

**验证通过、standalone 已生成、交付说明已发出后，必须清掉本次流程的全部过程产物，
只保留交付物与其源文件。** 删除一律走系统废纸篓（不用 `rm`）；截图等"审查证据"若用户可能想留，
删除前先告知落点。

**删除（存在才删）：**
- 渲染验证截图目录（`build/shots/`）及任何渲染测试页、临时 HTML
- 渲染/出图用的 venv（项目 `.cache/venv` 或 `$TMPDIR` 下的临时环境）
- 残缺/中断的浏览器下载缓存（如 `playwright install` 中断留下的目录）
- 一次性辅助脚本（复制到项目里的渲染脚本等；本 skill 自带的脚本不算项目产物）

**保留：**
- 交付件 `index_standalone.html` 与源文件 `index.html`、`README.md`
- `assets/figures/`（index.html 引用它，属于源文件的一部分；standalone 已内嵌全部图片）

清理后在 README 记录：交付物清单、验证结论、清理日期。项目里不应残留任何可再生的中间产物——
下一个人打开目录时，看到的应该只有交付物、源文件和说明。

---

## 三风格详细要求

---

### storytelling（故事型）— 像一篇公众号爆文

**硬标准**：
- 字数 ≥ 3000
- 段落 ≥ 15
- 引用论文原文 ≥ 3 处
- 生动类比/比喻 ≥ 2 个
- 结尾金句 1 句

**结构要求（按顺序，缺一不可）**：

```
1. 钩子开头（2-3段）
   — 反常识问题 / 引人共鸣的场景 / 让人"等等再说一遍？"的事实
   — 不要直接讲技术。先让读者好奇。

2. "为什么会这样"（3-4段）
   — 解释现有方法的逻辑和它的瓶颈
   — 用简单例子说明
   — 让读者感到"确实需要一种新方法"

3. 核心洞察（1-2段）
   — 论文最关键的那一句话发现
   — 用一句话说清楚 + 一个类比强化

4. 方法详解（5-8段，全文最重点）
   — 分步骤展开：怎么做 → 为什么这样设计 → 和旧方法的关键区别
   — 每个步骤配一个类比
   — 引用论文原文（公式/算法描述）≥ 3 处
   — 用对比表呈现新旧方法差异

5. 实验效果（3-4段）
   — 最重要的实验结果 + 数据解读
   — 不只是报数字，要解释"这意味着什么"
   — 用表格呈现关键对比数据

6. 深层意义（2-3段）
   — 这个工作对行业意味着什么
   — 不止一个角度：技术意义、产业意义、方法学意义

7. 局限（1-2段）
   — 作者自述的局限 + 你的判断

8. 收束（1段）
   — 回到开头的场景/问题，形成闭环
   — 读者带着"我懂了"的感觉离开

9. 金句
   — 一句话，让人能记住并转述
```

**写法要求**：
- 多用"你"和读者对话（"你有没有想过""你猜怎么着"）
- 段落短，一段不超过 4 句话
- 技术词出现时要立刻给"人话解释"
- 数据要翻译成可感知的东西（"15 斤荔枝"而不只是"15 斤"）

---

### academic（学术型）— 比论文更清晰的深度解析

**硬标准**：
- 字数 ≥ 4000（⚠️ 学术型必须长于故事型）
- 段落 ≥ 20
- 论文公式引用 ≥ 5 处（用 KaTeX 渲染）
- 论文图片/图表引用 ≥ 3 处（标注 Figure number）
- 实验数据表格 ≥ 2 张
- 代码段 ≥ 2 段（如有代码）
- 指出局限 ≥ 2 处

**结构要求**：

```
1. 论文元信息
   标题 · 作者 · 链接 · 代码状态

2. 一句话总结（100字内）

3. 研究背景与动机（4-5段）
   — 这个领域在解决什么问题
   — 现有方法及其局限（按时间线或方法论分类）
   — 本文的出发点

4. 预备知识（2-3段，如需要）
   — 理解本文需要的核心概念
   — 本文用到的基础方法简介

5. 方法详解（8-10段，全文最重点）
   — 对每个创新点独立成节
   — 每个创新点包含：①问题 ②怎么做（配公式）③为什么有效 ④与已有方法的差异
   — 公式用 $$...$$ KaTeX 渲染
   — 引论文原文 Figure/Table 编号
   — 有代码则穿插源码分析

6. 实验分析（4-6段）
   — 实验设置概述
   — 主要结果（配表格 + 深入解读）
   — 不同维度的对比分析
   — 消融实验说明了什么
   — 不是报数据，是解读数据背后的含义

7. 讨论（2-3段）
   — 方法的适用边界
   — 未解决的问题
   — 对未来工作的启示

8. 局限分析（2-3段）
   — 作者自述 ≥ 1 处
   — 你的独立判断 ≥ 1 处

9. 结论（1-2段）
   — 凝练贡献
   — 展望
```

**写法要求**：
- 保持学术严谨但不死板——比论文好读
- 每个公式后要跟一句"人话"解释：这个公式在说什么
- 引用论文的 Fig/Table/Section 编号
- 表格数据要有解读，不只贴数据
- 数学符号首次出现要解释含义

---

### concise（精炼型）— 最快掌握核心

⚠️ **精炼 ≠ 敷衍。精炼是信息密度极高、但该有的全有。**

**硬标准**：
- 字数 ≥ 1200（不能低于这个数）
- 必须有：核心摘要盒 + 表格 + 可视化图表 + 金句
- ⚠️ **必须包含至少 1 个 Mermaid 图表**（架构图或对比图）

**结构要求**：

```
1. 头图（Mermaid图表）—— 全文最核心架构/对比的一张图
   类型可以是：flowchart（流程图）、graph（对比图）、或 timeline

2. 核心摘要盒
   — 5 行以内
   — 覆盖：做什么 / 怎么做 / 效果 / 适用场景

3. 关键创新（3-5 个，编号列出）
   — 每个 2-4 句
   — 一句话说创新点 → 一句话说怎么做的 → 一句话说为什么重要

4. 核心数据表
   — 最多 5 行数据
   — 突出和 baseline 的对比

5. 金句收尾
```

**Mermaid 图表示例**（⚠️ 节点文本避免中文特殊字符，用英文或简单ASCII。用 `<br/>` 换行）：
```mermaid
flowchart TB
    subgraph DSA["DSA: 64 heads scan all L tokens"]
        Q1[Query] --> H1[Head 1..64]
        H1 --> TK1[Score: O(64L)]
    end
    subgraph MISA["MISA: route to h=8 heads"]
        Q2[Query] --> RTR[Router: O(64M)]
        RTR -->|top-8| H2[8 active heads]
        H2 --> TK2[Score: O(8L)]
    end
    DSA -->|8x fewer heads| MISA
```

---

## HTML 输出模板

生成HTML时使用此模板，确保含 KaTeX 公式渲染 + Mermaid 图表支持：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>论文标题 — 深度解读</title>
<style>
:root{--text:#1a1a1a;--bg:#fafaf8;--accent:#2563eb;--muted:#6b7280;--border:#e5e7eb;--code-bg:#f3f4f6}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,"PingFang SC","Noto Serif SC",serif;color:var(--text);background:var(--bg);line-height:1.85;padding:2.5rem 1.5rem;max-width:720px;margin:0 auto;font-size:17px}
h1{font-size:2rem;margin:0 0 .3rem;line-height:1.3}
h2{font-size:1.35rem;margin:2.8rem 0 .8rem;color:var(--accent);padding-bottom:.4rem;border-bottom:1px solid var(--border)}
h3{font-size:1.1rem;margin:1.5rem 0 .5rem;color:#333}
.meta{color:var(--muted);font-size:.9rem;margin-bottom:2.5rem;line-height:1.8}
.meta a{color:var(--accent);text-decoration:none}
blockquote{border-left:3px solid var(--accent);padding:.6rem 1.2rem;margin:1.5rem 0;background:#f0f4ff;border-radius:0 8px 8px 0}
pre{background:var(--code-bg);padding:1rem 1.2rem;border-radius:8px;overflow-x:auto;font-size:.85rem;line-height:1.5;margin:1.5rem 0;border:1px solid var(--border)}
code{font-family:"SF Mono","Fira Code",monospace;font-size:.9em}
p{margin:1rem 0}
strong{color:#111}
table{width:100%;border-collapse:collapse;margin:1.5rem 0;font-size:.93rem}
td,th{border:1px solid var(--border);padding:.6rem .9rem;text-align:left}
th{background:#f9fafb;font-weight:600}
.summary-box{background:linear-gradient(135deg,#f0f4ff,#faf5ff);padding:1.5rem;border-radius:12px;margin:1.5rem 0}
.summary-box h3{margin:0 0 .5rem;color:var(--accent)}
.golden{font-size:1.25rem;font-weight:600;color:var(--accent);text-align:center;padding:2rem 1rem;border-top:2px solid var(--accent);border-bottom:2px solid var(--accent);margin:2.5rem 0;line-height:1.5}
@media(max-width:600px){body{font-size:16px;padding:1.2rem 1rem}h1{font-size:1.5rem}}
</style>
<!-- KaTeX -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"
  onload="renderMathInElement(document.body,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}]})"></script>
<!-- Mermaid -->
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<script>mermaid.initialize({startOnLoad:true,theme:'default',securityLevel:'loose'});</script>
</head>
<body>
<!-- 内容 -->
</body>
</html>
```

**公式用 `$$...$$` 或 `$...$`，KaTeX 自动渲染。**
- ✅ 正确：`$H^I$`、`$H^{I}$`、`$\mathbf{q}_{t,j}^I$`
- ❌ 错误：`$H^\I$`（`\I` 未定义）、`$H^I$` 写在 `<pre>` 标签内

**Mermaid 图用 `<pre class="mermaid">...</pre>` 包裹。节点文本避免中文标点和特殊字符。**

---

## 自我审查清单（Round 6）

生成后逐条检查，不通过则修改：

### 通用
- [ ] 字数达标？（story≥3000 / academic≥4000 / concise≥1200）
- [ ] 引用论文原文 ≥ 3 处？
- [ ] 每个核心创新独立深度展开？
- [ ] 至少 1 个实验结果做深入解读？
- [ ] 代码状态已提及？
- [ ] 有代码则源码 ≥ 2 段 + 文件路径？
- [ ] 指出局限 ≥ 2 处（至少 1 处是作者自述的）？
- [ ] HTML 格式完整，可在浏览器打开？
- [ ] 无 AI 套话（"深入探讨""至关重要""值得注意的是"）？
- [ ] **交付的是 standalone 单文件版？图片全部 base64 内嵌，无 `<img src="相对路径">`？**
- [ ] **终审是在 `index.html`（轻量版）上做的，并在浏览器里实际打开看过？**
- [ ] **审过之后才转的 standalone，且交付时说明了哪个是最终件？**
      （`inline_images.py index.html --check` 对 index 返回 2、对 standalone 返回 0 是正常的：
      index 有外链、standalone 必须没有）
- [ ] **残留的 CDN 外链已向用户说明？**（还有哪些、离线时会失效什么）
- [ ] **6.1 渲染验证已跑过，数据达标（退出码 0）且截图逐段看过？**
- [ ] **Round 7 清理已执行？**（过程产物已移废纸篓，目录只剩交付物/源文件/说明）

### storytelling 专属
- [ ] 有钩子开头？
- [ ] 有 ≥ 2 个类比/比喻？
- [ ] 用"你"和读者对话？
- [ ] 有收束段落形成闭环？
- [ ] 有金句？

### academic 专属
- [ ] 字数 ≥ storytelling？
- [ ] 公式 ≥ 5 处（KaTeX 渲染）？
- [ ] 论文图/表引用 ≥ 3 处（Fig/Table 编号）？
- [ ] 实验数据表 ≥ 2 张？
- [ ] 方法部分 ≥ 8 段？

### concise 专属
- [ ] 有 Mermaid 图表？
- [ ] 有核心摘要盒？
- [ ] 有对比数据表？
- [ ] 有金句？
- [ ] 字数 ≥ 1200？

---

## 参考文件

- `styles/storytelling.md` — 故事型补充规范
- `styles/academic.md` — 学术型补充规范
- `styles/concise.md` — 精炼型补充规范
- `styles/with-formulas.md` — 公式详解
- `styles/with-code.md` — 代码分析规范
- `scripts/generate_html.py` — HTML生成辅助脚本（markdown → HTML，含 base64 内嵌图片）
- `scripts/verify_render.py` — 渲染验证（固定流程，见 6.1）：复用本机 Chromium 打开 index.html，
  自动对照核对公式数/图片数并检查溢出与 `$` 残留，输出 `build/shots/` 分段截图；找不到本机
  Chromium 时直接报错退出（不下载）
- `scripts/inline_images.py` — 把已写好的 HTML 转成 standalone 单文件版（图片全部 base64 内嵌），
  带 `--check` 可判断是否已是单文件、`--in-place` 就地覆盖并备份
