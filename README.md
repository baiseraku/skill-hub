# skill-hub

我在用的 ZCode（一个编码 agent CLI）自定义 skills 合集，共 15 个。覆盖论文阅读（深度解读长文）、markdown 报告排版、单细胞 RNA-seq 分析、GitHub 上传、手机推送提醒、子代理模型与思考档位设置、以及一批约束 agent 行为的写作/流程规范。

ZCode 的 skills 装在 `~/.zcode/skills/<名字>/` 下，每个 skill 是一个目录，核心是一份 `SKILL.md`：frontmatter 里是 `name` 与 `description`（描述同时决定 agent 何时自动触发），正文是给 agent 看的操作说明；部分 skill 还带 `scripts/`、`references/`、`assets/`、`styles/` 等辅助文件。

## 目录

| Skill | 一句话用途 | 附带内容 |
|---|---|---|
| [agent-handoff](./agent-handoff/) | 把项目进度写成/持续维护项目根目录的 `HANDOFF.html`，供零上下文的接手 agent 继续 | `assets/HANDOFF-template.html` 模板 |
| [ask-gpt](./ask-gpt/) | 把整理好措辞的问题交给本机 Codex CLI 里的 GPT 回答，原样返回 | `scripts/ask_gpt.sh` |
| [bark-notify](./bark-notify/) | 通过 Bark 给用户手机发推送，含 agent 自行判断与用户设定的条件通知 | `scripts/bark.sh`、`references/api.md` |
| [grill](./grill/) | 用户明确调用后分轮追问其计划/决定，直到重要未知暴露 | `agents/openai.yaml`、`LICENSE`(MIT) |
| [grill-to-agents](./grill-to-agents/) | 追问后生成一份可复制的 Markdown 执行清单，交给其他 agent | `agents/openai.yaml`、`LICENSE`(MIT) |
| [i-have-adhd](./i-have-adhd/) | 把输出塑造成适合 ADHD 读者：动作先行、多步编号、每轮复述状态 | `agents/gemini.toml`、`agents/openai.yaml` |
| [lieflat-less-ai-tone](./lieflat-less-ai-tone/) | 按白名单规则改写文本里的 AI 写作痕迹，未命中的文字逐字保留 | SKILL.md |
| [md-render](./md-render/) | 把带图带表的 markdown 长文档排成阅读版 HTML，再审、再转 A4 PDF；从 PDF 取插图不丢矢量文字 | 4 个 `scripts/*.cjs`、`references/gotchas.md`、`references/setup.md` |
| [paper-analyzer](./paper-analyzer/) | 把学术论文转成深度 HTML 长文（6 轮工作流、三风格、公式与 Mermaid），含导出插图与 standalone 交付 | `styles/` 5 份、`scripts/` 4 个、封面 prompt 文件 |
| [r-code-requirements](./r-code-requirements/) | R 代码注释规范 + 强制把代码落盘到项目 .R 脚本 | SKILL.md |
| [research-report](./research-report/) | 把项目当前研究进度总结成 markdown 报告，落在项目根 `report/` | `scripts/pdf2png.sh` |
| [seurat-qc-annotate](./seurat-qc-annotate/) | 单细胞 RNA-seq 流水线：QC → 批次矫正聚类 → 细胞类型注释 | SKILL.md |
| [subagent-model](./subagent-model/) | 查看/设置子代理用的底层模型与思考档位，并说明生效时机 | `scripts/subagent_model.py` |
| [trash-instead-of-delete](./trash-instead-of-delete/) | 删除默认移入系统废纸篓，而非直接 `rm` | `scripts/trash.sh` |
| [upload-r-to-git](./upload-r-to-git/) | 把 R 脚本与导出小文件同步到 GitHub 私有仓库，并自动生成 README | SKILL.md |

## 安装与使用

ZCode 会扫描 `~/.zcode/skills/` 下的子目录并自动发现其中的 `SKILL.md`，无需额外注册。clone 本仓库后，把想要的 skill 目录复制或软链进去即可：

```bash
git clone <本仓库地址> ~/skill-hub

# 方式一：拷贝（独立副本，改动不影响本仓库）
cp -r ~/skill-hub/bark-notify ~/.zcode/skills/

# 方式二：软链（仓库更新后直接生效，适合持续维护）
ln -s ~/skill-hub/bark-notify ~/.zcode/skills/bark-notify
```

装好后按各 skill 的描述触发：既可以在对话里用自然语言（如「把这篇文章做成 PPT」），也可以直接调用带 `/` 前缀的显式命令（如 `/i-have-adhd`、`/paper-analyzer <论文链接>`）。部分 skill 有前置依赖（见下节），按需先装好本机环境。

## Skills 详情

### agent-handoff

把一个项目的当前状态写成任何接手 agent 都能「零上下文继续」的 HTML 交接文档，固定落盘到项目根目录的 `HANDOFF.html`。触发说法包括「写交接文档」「交接给下一个 agent」「更新 HANDOFF」「handoff」等，即使没说 HTML 或文件名也会用；文档一经建立，后续完成节点、出现阻塞、关键决策变化、会话收尾时都要主动同步更新。显著特点是把「读者是零上下文的接手 agent」当硬标准：只写可核验事实、每条结论带证据位置、下一步精确到 `文件:行号` 或第一条命令，并有固定 HTML 模板与配色标签。附带 `assets/HANDOFF-template.html`，新建时复制到目标项目再填。

### ask-gpt

把用户的问题整理措辞后交给本机 Codex CLI 里的 GPT 回答，再把 GPT 的回答原样返回。触发说法包括「问一下 GPT」「让 GPT 答一下」「听听另一个模型怎么说」等任何想要外部意见的场合。硬约束是「只整理措辞、不改原意」「返回原始回答、不加主 agent 修正」，并会明确标出所用模型与思考强度。依赖本机 Codex CLI（默认找 `ChatGPT.app` 内的 `codex` 可执行文件，可用环境变量覆盖），问题会经第三方 relay 转发；每次调用必须显式给思考档位。附 `scripts/ask_gpt.sh`。

### bark-notify

通过 Bark 给用户手机发推送，覆盖两条路径：agent 自行判断何时发（长任务完成/失败、任务受阻等），以及用户设定的条件通知。触发说法包括「通知我」「跑完叫我」「到点提醒我」，以及 agent 判断值得叫用户时；配置 Bark key、发自检/测试通知、用定时自动化盯条件也走它。显著特点是脚本不写死路径，本机与服务器/容器通用（凭 `BARK_KEY` 环境变量或 600 权限配置文件），条件轮询可结合 ZCode 的定时自动化，并强调「绝不谎报发送结果」。附 `scripts/bark.sh` 与 `references/api.md`（参数与排查表）。

### grill

仅在用户明确调用（或明确要求拷打/分轮追问当前想法）时，分轮追问其计划、决定或想法，直到重要未知暴露出来。开始前先让用户选拷打强度（浅问 / 常规 / 细问 / 深挖 / 拷打五档），可随时调整；只覆盖本次指定话题，用户要求总结、停止追问或转入执行即结束，不自动影响其他对话。追问遵循固定问题格式，并区分「能自己查清的事实」与「需用户决定的取舍」。目录内附 MIT License，版权归 Matt Pocock。

### grill-to-agents

基于 grill 的同一套追问流程，追问结束后产出一份可复制的 Markdown 执行清单，交给其他 agent 执行。触发条件是用户明确调用，或明确要求「追问后生成给其他 agent 的清单」。清单写成直接的执行指令、按依赖顺序列 `- [ ]` 步骤，并专门考虑跨设备交接（尽量用项目相对路径、不写死本机绝对路径与登录状态、未同步材料标「待提供」）。目录内附 MIT License，版权归 Matt Pocock。

### i-have-adhd

把每一轮输出塑造成适合 ADHD 读者的形状：第一行给下一步动作、多步任务编号、最后一句话给一个两分钟内可做的动作、每轮复述当前状态、给具体时间估计、把已完成的工作显式可见、错误直说原因与修法，并禁掉开场白与收尾客套。用 `/i-have-adhd` 或「adhd mode」开启，说「stop adhd mode」后恢复默认风格。附带 `agents/gemini.toml` 与 `agents/openai.yaml`，可顺带装给 Gemini CLI / Codex 等其他 harness。

### lieflat-less-ai-tone

识别并改写写作中的 AI 痕迹，采用白名单式改写：只处理 SKILL.md 里明确列出的规则（如翻案腔、顿号罗列过密、相邻句同款、破折号/冒号滥用、序数词当小标题、翻译腔的几种结构等），未命中任何规则的文字必须逐字保留，也不改动文章框架。适用于写作完成后的成稿清理，每条规则都给了触发标记、改法和实测数据；若有同目录的风格文档，以风格文档为准。只含 SKILL.md。

### md-render

把带图、带表的 markdown 长文档（中文技术/科研报告最常见）排成可直接阅读的 HTML：屏幕端居中栏 + 两侧留白，图按原文位置插在段落间，表格列宽按实测写死（数值与文件名不被拆行），目录可点击；HTML 审查通过后再从同一份 HTML 转出 A4 PDF。触发说法包括「md 转 html」「报告做成网页/单文件 html」「排一下版」「顺便给一份 A4 pdf」。依赖 Node 环境：`marked` 必需，`playwright` + Chromium、`pdf-lib`、`pdfjs-dist` 分别用于测列宽、自检、转 PDF 与页码。`references/gotchas.md` 第 11 条记的是从 PDF 取插图的坑：出版排版里图 = 位图 + 矢量文字层，「提取嵌入图片」会把面板字母、坐标轴、图例等文字整批静默丢掉，正确做法是按整幅图区域渲染页面。附 4 个 `scripts/*.cjs` 与 `references/gotchas.md`、`references/setup.md`。

### paper-analyzer

把一篇学术论文转成深度 HTML 长文，目标读者觉得「比我读论文还清楚」。走 6 轮强制工作流：获取全文 → 搜索并阅读开源代码仓库 → 深度分析 → 询问风格 → 写作输出 HTML → 自我审查；提供 storytelling / academic / concise 三种写作风格，各带篇幅与结构硬标准。触发方式是给论文链接、PDF 或粘贴文本。输出模板内置 KaTeX 公式渲染与 Mermaid 图表支持。要把论文原图嵌进 HTML 时有专设的 Round 1.5：不「提取嵌入图片」（那会静默丢掉图上的矢量文字层），改按整幅图区域渲染页面，`scripts/extract_figures.py` 固化了这套图区判定逻辑。交付口径是先写轻量 `index.html` → 在 index 上终审 → 通过后用 `scripts/inline_images.py` 转 `index_standalone.html`，最终件是 standalone。附 `styles/` 下 5 份风格与专项规范、`scripts/` 下 4 个 Python 辅助脚本及封面 prompt 文件。

### r-code-requirements

R 代码书写与落盘要求：注释只讲必要信息（代码自明处不写注释、禁解释性废话、禁装饰框与序号铺陈），`# 标题 ----` 短分节只留给阶段级，同组注释用冒号对齐清单，行内 `#` 说明「为什么」；并且所有 R 代码必须写入并持续更新到项目 `.R` 脚本，禁止只在对话中贴代码。触发场景是编写、修改或补全任何 R 分析代码（Seurat 单细胞、统计检验、绘图、数据整理等）。只含 SKILL.md。

### research-report

把项目文件夹的当前研究进度总结成一份 markdown 报告，统一落在项目根目录的 `report/`（没有就新建，已有则按覆盖语义重建、旧版移入废纸篓），并附支撑结论的图与表。报告覆盖研究方向与问题、原始数据来源（带 accession）、关键方法与参数、当前进度、结果与结论、已知问题、后续方向等固定骨架，读者设定为没参与项目的人或 agent。红线是只写当前项目文件夹里、有出处的真实数据，查不到就标「未记录」，不许估算或编造，也不混入兄弟项目/其他会话/外部常识。附 `scripts/pdf2png.sh`（带多级回退链的 PDF 转 PNG 脚本）。

### seurat-qc-annotate

单细胞 RNA-seq 标准流水线，入口是已合并好的 Seurat 对象（含 sample 分组、条码已加样本前缀）。分阶段 A–E：QC 指标重算与带分位数/参考线标注的 QC 小提琴图 → 手动逐样本阈值过滤 → 细胞周期评分 → Harmony 批次矫正、肘图定 dims 与聚类 UMAP → FindAllMarkers 加 presto AUC / 供者 pseudobulk 双筛 marker → 细胞类型注释；也可只复用其中任一阶段。交付物是按数据改好并写入项目 `.R` 脚本的代码（可以不用运行），流程明确标注了每次应用前必须核对的修改点。依赖 R 环境（实测 R 4.5.3 + Seurat 5.5.1 + harmony 2.0.5，另需 ggplot2、patchwork、presto 等）。只含 SKILL.md。

### subagent-model

查看或设置「子代理用什么底层模型和思考档位」。流程是先列出本机可用模型让用户选、再问一轮思考档位，然后写进 ZCode 的子代理配置，并如实交代生效时机：Agent 工具的子代理要新会话或恢复会话才生效，workflow 子代理在本次对话内立即生效。触发说法包括「换子代理模型」「/subagent-model」，以及子代理报 `Provider unavailable` / `provider-not-found` / 缺思考档位时。附 `scripts/subagent_model.py`（只通过脚本写状态文件，不手写 JSON）。

### trash-instead-of-delete

文件删除的默认安全策略：除非用户明确确认要永久删除，否则一切删除动作（`rm`、`rmdir`、`find -delete`、`git clean`、`rsync --delete`、覆盖写等）都改成移入系统废纸篓/回收站，并告知落点与恢复方式。触发场景是所有可能让文件内容再也回不来的操作之前，包括用户只是随口说「清理一下」。同源的破坏性操作（覆盖已有文件、`git reset --hard`、数据库 `DROP`/`DELETE`）也按此处理。附 `scripts/trash.sh`，封装了 `trash` → `gio trash`（Linux）→ Finder → `mv` 兜底的回退链。

### upload-r-to-git

把项目文件夹内的 R 脚本与导出的小文件（pdf/csv/png 等）上传或同步到 GitHub 私有仓库：远程仓库已存在则直接推送同步，不存在则按项目文件夹名新建私有仓库；每次上传根据脚本注释总结生成/更新 README.md 并随代码一起提交。触发说法包括「上传到 GitHub」「同步到仓库」「推送代码」「上传项目」。依赖本机已配置好的 `gh` CLI 与 SSH 身份（仓库固定为私有），并规定提交前先向用户展示待提交文件清单、确认后才 commit/push。只含 SKILL.md。

## 致谢与许可

- `grill` 与 `grill-to-agents` 两个目录源自 Matt Pocock 的作品，目录内各附一份 MIT License，版权声明（Copyright (c) 2026 Matt Pocock）予以保留。
- 其余 skills 为本仓库作者本人编写。

---

这些 skills 偏向个人工作流，路径、外部服务、模型环境与软件版本都带有个人色彩（如依赖本机 Codex CLI、Bark App、特定的 R/Seurat 版本或某台机器上的播放器/字体），他人使用需按自己环境调整。
