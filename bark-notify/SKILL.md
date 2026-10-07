---
name: bark-notify
description: '通过 Bark 给用户手机发推送（本机与服务器/容器都可用，不写死路径）。触发：①用户任何要手机提醒、或设定触发条件的说法——「通知我」「发到我手机」「bark 一下」「推送给我」「跑完叫我」「完成后告诉我」「提醒我」「如果……就通知我」「到点提醒我」等，即使没提 Bark；②agent 自行判断值得叫用户时：长任务（≥约 10 分钟或后台/off-peak 运行）完成或失败、任务受阻需要用户处理、用户设的条件达成；③配置 Bark key、发自检/测试通知、登记/检查触发条件、用定时自动化盯条件。'
license: MIT
metadata:
  tags: "Bark, 推送, 手机通知, 提醒, 条件触发, 服务器"
  category: "productivity"
---

# Bark 手机通知

给用户手机发推送，两条路径：**你自行判断**（「什么时候发」）与**用户设的条件**（「条件通知」）。本机和服务器/容器都要能跑，所以**不要写死任何固定路径**：发送脚本在本 skill 目录里，配置和状态按下面这套规则解析。

## 路径（本机 / 服务器通用）

发送脚本 = **本 skill 目录**下的 `scripts/bark.sh`。ZCode 加载 skill 时会给出 base directory，执行时用它拼绝对路径。下文用 `$SKILL` 代表那个目录：

```bash
SKILL="<加载本 skill 时给出的 base directory>"     # 每次现取，别硬编码
"$SKILL/scripts/bark.sh" -g 项目 "标题" "正文"
```

配置与状态路径按顺序解析（本机与服务器同一套规则），用 `"$SKILL/scripts/bark.sh" --where` 直接打印结果：

1. `$BARK_CONFIG` —— 直接指到配置文件；
2. `$BARK_NOTIFY_HOME/config`；
3. `$XDG_CONFIG_HOME/bark-notify/config`；
4. `$HOME/.config/bark-notify/config`。

条件清单 `conditions.md` 和自检标记都放在同一目录（脚本的「状态目录」，`--where` 会显示；要单独指定就设 `$BARK_STATE_DIR`，适合配置放只读 `/etc` 的场景）。服务器/容器上推荐直接用环境变量 `BARK_KEY`（必要时加 `BARK_SERVER`），或把配置放到任意可写位置再用 `$BARK_CONFIG` 指过去。

## 硬约束

- **开工先自检，收尾只发真实通知**：判断到这次任务会用到通知（用户要求通知、长任务、后台任务）就在动手前先自检（见下节）；任务结束时只发真实通知，不要再补测试消息。
- **绝不谎报**：脚本没打 `✅` 就是没发出去。失败时把 Bark 返回的原话转告用户（脚本已对 key 打码），不许说「已通知」。
- **同一事件只发一条**：失败重试、多个步骤、进度更新都算同一事件，合并成一条，等有结论再发。
- **敏感信息不进通知**：正文经 Bark 服务器转发（自建除外），密钥、隐私、内部资料不写；`BARK_KEY` 只放环境变量或 600 权限的配置文件，**永远不要写进仓库、日志、对话或通知正文**。
- **深夜降级**：本机时间约 23:00–07:00（`date +%H` 判断）非急事降到 `passive`；急事（失败、需要用户处理）保持 `timeSensitive`。

## 开工自检（任务开始前发，不是发通知之前才发）

服务器上看不到终端，通道断了只会静默漏通知。所以**判断到这次任务会用到通知，就在动手前先自检**——用户在任务开头说「跑完叫我」，或你看出这是长任务/后台任务，都在这时就能判断：

```bash
"$SKILL/scripts/bark.sh" --self-check
```

- 它发一条带主机名、服务器、时间、打码 key 的推送，并写下自检标记；输出会告诉你上次自检是几分钟前、是不是同一台主机。
- 输出里写了「可跳过本次」才跳过（仅当同一主机、10 分钟内刚自检成功）；输出说「照发」「换了机器」「已超过 10 分钟」，或者没有自检记录，一律照发。
- 自检失败先按 references/api.md 排查，并在开工时就把问题告诉用户；别在通道不通时装作已通知——该发没发的消息攒着，收尾时一并说明。
- **收尾只发真实通知**：任务结束时不要补发测试消息，避免「测试 + 完成」连着来两条。
- 任务做到一半才发现需要通知、而本次会话还没自检过：直接发真实通知（失败就照实转告），自检留到下次任务开工时。
- 整场任务根本不需要通知，就不要自检，别平白打扰用户。
- 定时自动化**不要**自检，prompt 里直接发真实内容。

## Key 与配置

解析顺序：`--key` > `$BARK_KEY` > 配置文件（路径见上）。都没有时脚本直接报错；`"$SKILL/scripts/bark.sh" --where` 可看解析结果。

引导配置：让用户在 Bark App 首页复制 key 发来（粗看 20 位以上字母数字，明显不对先和用户确认）。本机可以落配置文件：

```bash
CONFIG="${BARK_CONFIG:-${BARK_NOTIFY_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}/bark-notify}/config}"
mkdir -p "$(dirname "$CONFIG")" && chmod 700 "$(dirname "$CONFIG")"
(umask 077 && { grep -v '^BARK_KEY=' "$CONFIG" 2>/dev/null; printf 'BARK_KEY=%s\n' '<收到的key>'; } > "$CONFIG.tmp")
mv "$CONFIG.tmp" "$CONFIG" && chmod 600 "$CONFIG"
"$SKILL/scripts/bark.sh" --self-check
```

服务器/容器上更推荐 `export BARK_KEY=<key>`（写进 shell profile，或服务/容器的环境变量），不落文件。注意这是 bash 脚本：精简镜像（如 Alpine）要先 `apk add bash curl`，否则连脚本都起不来。然后让用户确认手机收到自检消息；没收到照 references/api.md 的排查表处理，别猜。

## 什么时候发（自行判断）

**发：**

| 情形 | 处理 |
| --- | --- |
| 用户说了「通知我」「跑完叫我」等 | 必发——这是承诺。任务结束、失败、或最终决定不发，都要向用户交代 |
| 长任务（≥约 10 分钟，或后台/off-peak 运行）结束 | 发，失败也发；这是默认该叫用户的场合 |
| 失败或受阻，需要用户处理/决策，而他不在互动 | 发，`-l timeSensitive` |
| 用户设的条件达成 | 发（见「条件通知」） |
| 用户明确让你自主推进（离开过、稍后回来看），到了值得知道的节点 | 发，宁少勿多 |

**不发：** 几分钟内的小任务；用户正在来回互动（他就在屏前）；纯进度更新；同一事件已发过。

拿不准就问自己：这条消息让用户「回来知道结果/做点什么」，还是只是刷存在感？后者不发。

## 怎么发

```bash
"$SKILL/scripts/bark.sh" -g scRNA "✅ 跑完 · scRNA" "5.2 万细胞 QC+聚类完成，报告在 report/，无需操作。"
"$SKILL/scripts/bark.sh" -l timeSensitive -g 部署 "❌ 需处理 · 部署" "npm build 失败：TS2307 找不到模块。已停下等你。"
"$SKILL/scripts/bark.sh" -g 项目 "⏰ 到点提醒" - <<'EOF'      # 正文多行：写 - 从 stdin 读
第一行
第二行
EOF
```

- **标题**：`<状态> · <项目/任务>`，状态 ✅/❌/📌/⏰ 一眼可辨；在服务器上跑时带上机器名（如 `✅ 跑完 · scRNA@server1`），用户才知道是哪台机器发的。
- **正文**：一句话结果 +（需要时）用户下一步 + 关键产物位置；约 120 字内，脱离聊天记录也能看懂；不需要用户操作就写「无需操作」。
- `-g` 放项目名，手机端聚合；点通知要跳转加 `-u`；换铃声 `-s`。
- level：`passive` 纯知会 ｜ `active` 默认 ｜ `timeSensitive` 要尽快处理 ｜ `critical` 仅用户明确要求（Bark 里需开「重要警告」权限）。
- 发完核对输出：`✅` 即送出；`❌` 照实转告用户并查 references/api.md；可先重试一次，仍失败要在下次对话开头主动说明，别让它烂在日志里。

## 条件通知（用户设的触发条件）

用户说「跑完通知我」「10 分钟后提醒我」「如果 X 就通知我」时：

1. **先变成一句可核对的检查**：查什么、什么时候查、达成后发什么。含糊就一句话问清（「跑完」指哪个文件/哪一步）。
2. **登记**到状态目录里的 `conditions.md`（路径用 `"$SKILL/scripts/bark.sh" --where` 查；没有就创建），一条一个块：

```markdown
## scRNA-run — 跑完通知
- 状态: pending | done | expired | cancelled
- 创建: 2026-10-02 15:00
- 怎么查: test -f report/final.rds
- 达成后发: 「✅ 跑完 · scRNA」/「聚类完成，报告在 report/」
- 定时: <automation id>（title=…；频率=…；maxRuns=…/recurring）或 本会话内检查
- 过期: 2026-10-03 12:00 或 无
```

3. **谁来回查**，按条件类型选：
   - **本会话内能判断**（当前任务收尾、某步骤完成、文件出现）→ 不用定时任务。在关键节点和收尾前读清单，核对 pending 项，达成即发 + 标 `done`。
   - **要过时间才有结果**（等训练/部署/外部状态，或纯定时提醒）→ 用 ZCode 定时自动化（CronCreate；首次创建会请求用户批准，属正常流程，被拒就退化成「本会话内检查 + 到时在对话里提」）：
     - 每次调用都必须给 `title`（保留用户原话的时间措辞，如「30分钟后跑完叫我」）和 `prompt`；
     - 纯时间提醒：「30 分钟后」这类相对时间用 `delayMinutes=<分钟数>`、`recurring=false`，不带 maxRuns；prompt 直接写明要发的内容；
     - 有限窗口的轮询（结果大概率 N 次检查内出现）：`cron`（或 `intervalUnit`+`interval`）定频率 + `recurring=false` + `maxRuns=N`，到期自然停；
     - 开放式轮询（结果时间不定）：`recurring=true` + `cron`，不带 maxRuns；
     - prompt 自包含、幂等，例：
       > 检查条件 scRNA-run：运行 `test -f /路径/report/final.rds`。满足则用本 skill 的 `scripts/bark.sh`（用加载时给出的 base directory 拼绝对路径）`-g scRNA "✅ 跑完 · scRNA" "聚类完成，报告在 report/"` 发通知，并把状态目录里 `conditions.md`（本 skill 的 `scripts/bark.sh --where` 可查路径）该条状态改成 done，然后 CronList 按 title 找到本自动化并 CronDelete 删掉它（只删这一个自动化）；不满足、或已是 done/已过期，就什么都不做直接结束。定时任务里不要自检。
     - 建成后把 automation id 与参数一起记回条件清单。
   - **其他 harness**：用该 harness 自己的调度能力；没有就退化成「下次会话开始 + 收尾时检查」。
4. **管理**：用户改/撤条件 → `CronList` 定位 → `CronUpdate`/`CronDelete`，同步改清单（取消的标 `cancelled`；CronUpdate 每次都要带 title）。
5. **跨会话**：接手会话开始实质工作时、以及任务收尾前，扫一眼清单：pending 项已达成就发 + 标 done；过期的标 `expired`；凡是已 done/expired/cancelled 却还挂着自动化（CronList 里 title 对得上）的，一律 CronDelete 清掉。

## 测试与排查

- 只看不发：`"$SKILL/scripts/bark.sh" -n "标题" "正文"` 打印将发送的 JSON（key 打码）；`--where` 看路径与配置解析；`--self-check` 发通道自检。
- 常见失败（key 无效 / 网络不通 / 走代理 / 缺 curl 或 bash / level 拼错 / critical 无权限）与全部 API 参数见 references/api.md；脚本全部 CLI 选项用 `"$SKILL/scripts/bark.sh" -h` 看。
