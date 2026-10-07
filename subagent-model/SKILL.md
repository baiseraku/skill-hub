---
name: subagent-model
description: 查看或设置「子代理用什么底层模型和思考档位」。触发：用户说「换子代理模型」「子代理用 XX」「设一下 subagent 模型」「让子代理跑在 GLM/DeepSeek 上」「子代理别再用 X」「子代理思考档位用哪个」「看下子代理现在用什么模型」「/subagent-model」，或抱怨子代理报 Provider unavailable / provider-not-found / 供应商不存在或不可用 / reasoning-level-missing / 未选择思考档位。负责：列出本机可用模型让用户选、**选完模型再问一轮思考档位**（宿主强制要求档位，缺了子代理直接启动失败）、写进 ZCode 的子代理配置、说清哪些子代理立即生效哪些要新会话、以及修插件里被钉在不可用模型上的 agent。
---

# 子代理模型

把「子代理用哪个模型」做成一次问答加一次写入，并且**如实交代生效时机**。这是本技能的核心价值，因为 ZCode 里没有一处设置能让运行中的会话当场换掉 Agent 工具的子代理模型。

## 通道与生效时机（必须向用户说明）

| 通道 | 指什么 | 生效时机 |
| --- | --- | --- |
| Agent 工具的子代理 | `general-purpose`、`Explore`、插件 agent | **新会话 / 恢复会话后**才生效 |
| workflow 子代理 | `CreateWorkflow` 派发的子代理 | **立即**，本次对话内即生效 |

配置只有**一份、按用户全局**：`<storageRoot>/v2/agents-state.json`，不分项目也不分工作区（项目目录下的 `.zcode/` 只有 workflow 草稿/运行记录，没有、也不该有第二份子代理配置）。所以「生不生效」跟会话在哪个项目里无关，只取决于**会话是什么时候创建的**——新开的对话读到最新配置，已存在的对话（含当前这个）保持它创建时的那份快照。对用户就要这么讲：别笼统说「全局生效了」，要说清「对新对话生效、对已开着的对话不生效」。

证据基础，三条要分清：

- **已实测（2026-10-07，本机）**：子代理的模型是**会话级快照**，在会话创建那一刻读一次文件，之后不重读。当天的对照：会话 `sess_b3edf46f`（创建早于写入）在写入之后派出的子代理仍用旧值；会话 `sess_bcfa3c52`（创建晚于写入）取到的就是新值。在同一会话内部，配置落地 2 秒后再派子代理，快照仍是旧值——所以不是「每次派发重读」，是创建时定死。
- **可自行复现的证据位置**：`<storageRoot>/cli/agents/<会话id>/agent_*/metadata.json` 的 `profileSnapshot.modelSelection`（每次派发记下的那份快照），以及 `<storageRoot>/cli/db/db.sqlite` 的 `model_usage` 表（`agent` / `provider_id` / `model_id`，按 `started_at` 排就能看出哪个会话何时用的哪个模型）。两条都不依赖反编译。
- **反编译推导**：配置只在创建或恢复会话时被同步读一次（`XVo → vHa` 仅出现在创建/恢复会话的路径上），没有文件监听、没有热重载。其中「**恢复**会话也会重读」这一条**本机仍未实测**。

所以：当前会话不生效、新会话生效，是实测事实；恢复旧会话是否也随之重读，是推导，别说死，可用下面「怎么验证」一节自检。

`$SKILL` = 加载本技能时给出的 base directory，每次现取，别硬编码。脚本是 `"$SKILL/scripts/subagent_model.py"`。

## 流程

### 1. 判断调用方式

- 无参数 → 走问答框（第 3 步，模型一轮、思考档位一轮）。
- `/subagent-model <模型id>` → 直接定模型、跳过第一轮；命令里带了 `$级别` 或 `--level` 就不问档位，**否则要补问第二轮**再写。
- `/subagent-model <模型id>$max` → 模型和档位都定了，两轮问答都不开，直接写。
- `/subagent-model off` → 清掉内置两个子代理的覆盖。
- `/subagent-model status` → 只看不改。

### 2. 取候选模型

调用 **ListModels** 拿当前可用模型清单，然后：

- **只能列这份清单里的模型，并跳过被标为不可用 / 停用的条目**。不要凭记忆或从别的机器照抄 id——本机就存在插件把 agent 钉在不可用 provider 上的情况，选到就会直接报 `provider-not-found`。
- 顺手记下每个模型的可用推理级别（`low` / `high` / `max`），用户想指定时用得上。
- **ListModels 不可用时的兜底**（它可能返回 `model_catalog_unavailable` 之类的错）：退回读 `~/.zcode/v2/provider_config.json`，从各 provider 的 `personalModelIds` / `modelOrder` 取候选，排除 `providerModelRules` 里 `enabled: false` 的项，拼成 `<providerId>/<modelId>`。再拿不到就请用户直接把模型 id 报给你。

### 3. 问答框（两轮：先选模型，再选思考档位）

**第一轮：选模型。** 用 AskUserQuestion 问一个问题，选项按这个优先级排：

1. 当前已设置的模型（先跑一次 `status` 看有没有，有就放第一项并注明「当前」）。
2. 用户在本对话里点名过、或本次任务明显更合适的模型。
3. 其余可用模型。

两条硬限制：

- **选项最多 4 个、最少 2 个**。可用模型多于 4 个时，把**完整清单写进 question 正文**，并说明「其余模型可以直接选 Other 填 id」。**只剩 1 个可用模型时不要开问答框**——选项不足 2 个会让这次调用直接失败；直接告诉用户只有这一个，然后进入第二轮。
- 模型 id 一律用 ListModels 给出的整串原样填（如 `account:bigmodel-start-plan/GLM-5.3-Flash`），不要自己拆开或改写。

**第二轮：选思考档位。** 模型定下来后**必须再问一轮档位**，不要替用户默认、也不要跳过：宿主启动子代理时强制要求档位，缺了就直接启动失败（见「缺思考档位会直接失败」一节）。

- 选项取自 `ListModels` 给该模型标出的 `levels`，**原样照抄**；把标着 `default` 的那个放第一项并注明「默认」。常见是 `low` / `high` / `max` 三个，正好够用。
- 选项同样**最多 4 个、最少 2 个**：报出的档位多于 4 个就把清单写进 question 正文并提示可用 Other；只有 1 个档位时不开问答框，直接用那一个。
- 用户已经点名档位时（说「用 max」、命令里带 `$max` 或 `--level`）直接采用，跳过本轮。
- 该模型在 ListModels 里**没有** `levels`（宿主不报档位）时，跳过本轮、`set` 不带 `--level`，并在汇报里说明「该模型不报档位」。**这是唯一可以不带档位的情况，而且本机未实测过**——写入后应派一个子代理确认能不能起来，起不来就回来按 `--level` 补一个能用的档位。

### 4. 写入

```bash
"$SKILL/scripts/subagent_model.py" set "<providerId>/<modelId>" --level <low|high|max>
```

`ListModels` 给出的 `account:bigmodel-start-plan/GLM-5.3-Flash` 这类 id 直接整体传进去即可，脚本按第一个 `/` 拆成 providerId 和 modelId。

**`--level` 要带上**，值就用第二轮问答里选定的档位（或用户点名的档位）。也可以照抄 `CreateWorkflow` 的写法带 `$级别` 后缀（`.../GLM-5.3-Flash$max`），脚本会把 `$max` 剥成 `options.reasoningLevel`，**不会**把它留在 modelId 里——这两个通道对 `$级别` 的处理必须一致，别手写状态文件绕过这一步。两边同时给时以 `--level` 为准。

`--level` 省略或写 `off` 会写出「没有 reasoningLevel」的选择项，宿主启动子代理时会**硬失败**（见「缺思考档位会直接失败」一节）；只在确认该模型不吃档位时才允许这么写。脚本写出无档位覆盖项时会在 stderr 上提醒一句，看到那句提醒就该回头确认是不是漏了第二轮问答。

**不要手写 `agents-state.json`**：那份文件里还有插件覆盖、禁用清单等其他键，用脚本写才不会被破坏。脚本每次写入前会留一份 `<文件名>.bak`。

### 5. 本次对话内立即生效（针对 workflow 子代理）

写完之后，把模型 id 记进当前对话的上下文，并在**每一次** `CreateWorkflow` / `AmendWorkflow` 调用里带上：

```
subagent_model: "<providerId>/<modelId>"
```

这一步是让「当前对话中后续调用」真正跟着走的关键；Agent 工具那条通道要等新会话，只有这条能当场兑现。

### 6. 汇报（四件事都要说）

- 已把哪个模型、哪个思考档位写给哪些子代理。
- **Agent 工具的子代理：要新开会话或恢复会话才生效**，当前会话不生效。
- **workflow 子代理：本次对话内立即生效**，并说明后续会自动带 `subagent_model`。
- 怎么改回来（再跑一次本技能）和怎么关掉（`off`）。

## 缺思考档位会直接失败（已实测）

宿主启动子代理时**强制要求** `reasoningLevel`，缺了就拒绝启动，而且**不回退**到会话模型：

```
Cannot start subagent: No reasoning level selected / 未选择思考档位
[reason=reasoning-level-missing; selection=bigmodel-api/GLM-5.3]
```

2026-10-07 本机实测：`set bigmodel-api/GLM-5.3` 不带 `--level` 写出无档位的覆盖项后，`Explore` 与 `general-purpose` 的派发全都在启动阶段失败，当日日志里 `reasoning-level-missing` 出现 3 次。注意这不是「供应商不可用」——provider 本身是好的，缺的只是档位这一项。

两点容易踩空：

- `ListModels` 标的「default max」只是展示用的默认值，**不会**在缺档位时代替它。
- 补上档位后，**已创建的会话照旧失败**——它们的快照仍是写坏的那份，得等新会话（或按上面推导会重读配置的恢复会话）。别把「配置改对了」当成「刚才那次失败的调用恢复了」。

这条约束对插件 agent（`set-plugin`）同样成立——同一个宿主机制，本机未单独实测，但别省档位。

## 插件 agent 被钉在不可用模型上

症状：

```
Cannot start subagent: Provider unavailable / 供应商不存在或不可用
[reason=provider-not-found; selection=<providerId>/<modelId>]
```

这是**硬失败，不会回退**到会话模型。原因是 agent 定义 frontmatter 里的 `model:` 指向了一个在本机不可用的 provider。本机实测：`documents`、`pdf`、`presentations`、`spreadsheets` 四个官方插件的 `visual-judge` 都钉在 `account:bigmodel-individual-coding-plan/GLM-5.3-Flash`，而这个 provider 在本机 `enabled: false`。

修法：

```bash
"$SKILL/scripts/subagent_model.py" set-plugin <插件id> <agent名> <providerId>/<modelId> --level <low|high|max>
```

- 覆盖键 = `plugin:<插件id>:<agent名小写>`，脚本自动拼。
- **档位照样要带**：插件 agent 也受同一个「缺档位就启动失败」的约束，用户没点名就先按第 3 步第二轮问一次。
- **修完要新开会话或恢复会话才生效**，和内置子代理同一条限制；当前对话里刚才那次失败的调用不会因此自动恢复。别把「以后能用了」说成「现在能用了」。
- 插件 id 形如 `documents@zcode-plugins-official`（插件 manifest 的 `name` @ 市场 id，市场 id 见 `~/.zcode/cli/plugins/known_marketplaces.json`）。
- 插件 agent 在工具里的类型名写作 `<插件名>:<agent名>`（如 `documents:visual-judge`），但**覆盖键里用的是插件 id，不是插件名**，两者容易混。
- 排查时可以直接看 agent 定义的 frontmatter：`~/.zcode/cli/plugins/cache/<市场>/<插件>/<版本>/agents/*.md`。

## 怎么验证有没有生效

派一个 `general-purpose` 子代理，让它**只回答**下面这件事，不要读文件、不要跑命令：

> 你的系统提示/环境信息里那句 `You are powered by the model named <X>` 中的 `<X>` 逐字是什么？找不到就写「未找到」，不要猜。

它回答的模型名就是真正在跑的模型。这样能区分开「配置写了」和「配置生效了」——两者经常不是一回事。

## 文件与恢复

- 状态文件：`"$SKILL/scripts/subagent_model.py" where`
- 默认 `~/.zcode/v2/agents-state.json`；若 `~/.zcode/cli/config.json` 里有 `storage.dir`，或设了 `$ZCODE_STORAGE_DIR`，脚本按那个走。
- 这个文件就是客户端「Settings → Subagents」写的那份，用户手动改界面会覆盖脚本的写入。
- 完全恢复默认：`off` 清内置、`off-plugin <插件id> <agent名>` 清插件，或者把状态文件里的 `builtInModelSelectionOverrides` / `pluginAgentModelSelectionOverrides` 清空。

## 硬约束

- **绝不谎报生效时机**。Agent 工具的子代理改完当场不会变，说了就是错的。
- **只列 ListModels 给出的模型**，不编造 id。
- **一律带思考档位**：选完模型必须问一轮档位并写进 `--level`。只有 ListModels 不报该模型的档位时才允许省略，且要说明、要事后派子代理确认能起来。绝不默默写出无档位的覆盖项——那会让子代理启动时硬失败。
- **只通过脚本写状态文件**，不手写 JSON，避免破坏同一文件里的其他键。
- 用户只是问「子代理现在用什么模型」时，只跑 `status` 汇报，不要顺手改。
