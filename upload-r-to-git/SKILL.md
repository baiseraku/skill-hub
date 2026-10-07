---
name: upload-r-to-git
description: >-
  把项目文件夹内的 R 脚本与导出的小文件（pdf/csv/png 等）上传/同步到 GitHub 私有仓库：
  远程仓库已存在则直接推送同步，不存在则按项目文件夹名新建私有仓库；每次上传根据脚本注释
  总结生成 README.md，并随代码一起提交。
whenToUse: >-
  用户提出“上传到 GitHub / 同步到仓库 / 推送代码 / 上传项目”等上传意图时。
  开始操作前先读本要求；若与用户当次指定范围冲突，以用户指定为准。
when_to_use: >-
  用户提出“上传到 GitHub / 同步到仓库 / 推送代码 / 上传项目”等上传意图时。
  开始操作前先读本要求；若与用户当次指定范围冲突，以用户指定为准。
metadata:
  version: 1.2.0
  source: 用户口述规范（2025-09-09）
disable-model-invocation: false
---

# GitHub 上传同步（R 仓库）：R 脚本 + 导出小文件 + 自动 README

## 环境事实（本机已配好，不要再重新配置）

- gh 位于 `~/.local/bin/gh`，已登录 baiseraku；SSH 密钥已配（走 ssh.github.com:443）
- git 身份：baiseraku / baiseraku@gmail.com
- 推送一律走 SSH（`git@github.com:...`），不需要用户再输密码或授权

## 上传内容规则

- 传：`*.R` 脚本、导出数据与图（output/ 下的 .pdf .csv .png .xlsx .tsv 等小文件）
- 不传：`Rawdata/`、任何 >100MB 的文件、`output/*.rds`、`.DS_Store`、`.Rhistory`
- 每次上传前先检查 >100MB 文件；超限文件一律写进 .gitignore，绝不 add

## 执行步骤

1. 快照：确认在项目根目录，运行 `git status` / `git remote -v`，记录当前改动
2. .gitignore：没有则按模板创建（见文末）；有则按本次文件清单补充规则
3. 生成/更新 README.md（规则见下）
4. `git add .` → 核对暂存清单：只应有脚本、导出小文件、README.md、.gitignore
5. **向用户展示将提交的文件清单（git status / git diff --cached --stat），并等用户明确确认后再继续**；用户指出不该传的文件时，修正 .gitignore 或取消暂存后重新展示；未得到确认不得 commit / push
6. 判定远程仓库：
   - 远程已存在（`gh repo view <owner/name>` 返回仓库，或 `git remote -v` 有 origin）
     → 直接 `git commit` + `git push` 同步
   - 本地无 .git 但远程已存在 → `git init -b main` + `git remote add origin`，
     先 `git pull --rebase --allow-unrelated-histories` 再提交推送
   - 远程不存在 → `gh repo create <项目文件夹名> --private --source . --push`
     —— 一律私有，分支 main
7. 验证：`gh repo view <owner/name> --json visibility` 应为 PRIVATE；
   推送出现分支/对象回显才算成功，失败必须报告原因，不得假装成功

## README 生成规则

- 逐一阅读根目录 .R 脚本：从 `# 标题 ----` 分节与开头注释提炼每步在做什么；
  同名作者、输入输出、运行顺序以脚本实际内容为准，不编造
- 结构（markdown，中文）：
  - 项目简介：一两句话说明分析与目标
  - 文件清单：脚本 + 导出文件各一行，说明名称、用途或产出
  - 运行顺序：按逻辑顺序列出，注明每步的输入输出
  - 数据说明：注明 Rawdata/ 与大数据文件不入库、需放回本地对应路径才能复现
- 已有 README 时更新而非重写：只增改本次新增/修改的分析与产出部分

## 提交信息

- 中文，概括本次改动；首次提交用“初始提交：<分析目标>”，
  后续用“更新：<新增/修改内容概要>”

## 自查清单

- 仓库 visibility = PRIVATE
- 暂存清单无 Rawdata、>100MB 文件、.DS_Store、.Rhistory
- README.md 与本次代码/产出一致，并已随本次提交
- 提交前已向用户展示将提交的文件清单，并获得明确确认
- 推送输出正常，与用户确认完成

## .gitignore 模板

```gitignore
# macOS
.DS_Store
.Rhistory
.RData
.Rproj.user/

# 大文件（超过 GitHub 100MB 限制）
output/*.rds
Rawdata/
```
