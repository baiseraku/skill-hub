#!/usr/bin/env bash
# 把整理后的问题（从 stdin）交给本机 Codex CLI 里的 GPT 回答：答案打到 stdout，模型与思考强度打到 stderr。
# 失败时把 Codex 自己的报错打到 stderr 并以 1 退出——不要把报错当成答案。
#
# 默认不留任何文件：codex 加 --ephemeral（不写 rollout 记录），中间文件放 $TMPDIR 且跑完即清。
# 需要留一份可核验的证据（证据目录 + rollout + 哈希）时设 ASK_GPT_KEEP=1。
#
# 问题只从 stdin 读（建议 heredoc），不收任何命令行参数。
# 环境变量：
#   ASK_GPT_EFFORT     思考强度，**必填**：low / medium / high / xhigh / max / ultra（实测均可）
#                      由主 agent 按问题难度决定，用户指定则优先；写 config 才用 config.toml 里的值
#   ASK_GPT_MODEL      换模型，默认用 ~/.codex/config.toml 里的 model
#   ASK_GPT_CWD        codex 的工作目录（问项目相关问题时用），默认本次的一次性目录
#   ASK_GPT_KEEP       设为 1 则保留本次证据，默认 0（不留文件）
#   ASK_GPT_HOME       证据根目录，默认 ~/Library/Caches/ask-gpt（清理软件会清，不永久占存储）
#   ASK_GPT_CODEX      覆盖 codex CLI 路径
set -uo pipefail

if [ "$#" -gt 0 ]; then
  echo "ask-gpt: 这个脚本不收参数，问题请从 stdin 传（heredoc）。收到 ${#} 个：$*" >&2
  echo "ask-gpt: 要换模型用 ASK_GPT_MODEL=<模型>，要改思考强度用 ASK_GPT_EFFORT=<档位>。" >&2
  exit 2
fi

CODEX="${ASK_GPT_CODEX:-/Applications/ChatGPT.app/Contents/Resources/codex}"

if [ ! -x "$CODEX" ]; then
  echo "ask-gpt: 找不到 Codex CLI：$CODEX" >&2
  exit 127
fi

# 思考强度必须显式给出：约定是"由主 agent 按问题难度决定，用户指定则优先"。
# 所以不允许静默落到 codex 配置文件的值上——想用配置值就显式写 ASK_GPT_EFFORT=config。
if [ -z "${ASK_GPT_EFFORT:-}" ]; then
  echo "ask-gpt: 必须指定思考强度（由主 agent 判断问题难度来定；用户有指定就用用户的）。" >&2
  echo "ask-gpt: 例如 ASK_GPT_EFFORT=medium；确实想用 ~/.codex/config.toml 里的值，就显式写 ASK_GPT_EFFORT=config。" >&2
  echo "ask-gpt: 可选 low / medium / high / xhigh / max / ultra，实测均可用。" >&2
  exit 2
fi

# 先把问题落到临时文件并确认非空，再建本次运行目录——避免为一次空调用留下垃圾
PROMPT_TMP=$(mktemp "${TMPDIR:-/tmp}/ask-gpt-prompt.XXXXXX")
cat > "$PROMPT_TMP"
if [ ! -s "$PROMPT_TMP" ]; then
  echo "ask-gpt: stdin 上没有收到问题" >&2
  rm -f "$PROMPT_TMP"
  exit 2
fi

if [ "${ASK_GPT_KEEP:-0}" = "1" ]; then
  KEEP=1
  # 证据放在清理软件会清的地方（~/Library/Caches），可留一阵但不永久占存储
  ROOT="${ASK_GPT_HOME:-$HOME/Library/Caches/ask-gpt}"
  mkdir -p "$ROOT/calls"
  # 带时间戳前缀 + 随机后缀，同一秒内并发调用也不会互相覆盖
  CALLDIR=$(mktemp -d "$ROOT/calls/$(date +%Y%m%d-%H%M%S).XXXXXX")
else
  KEEP=0
  CALLDIR=$(mktemp -d "${TMPDIR:-/tmp}/ask-gpt.XXXXXX")
fi
mv "$PROMPT_TMP" "$CALLDIR/prompt.txt"

# codex 跑在一个空目录里，免得它去翻项目、白烧 token
WORKDIR="${ASK_GPT_CWD:-$CALLDIR/work}"
mkdir -p "$WORKDIR"

# 用 set -- 拼参数，避免引号被拆坏（bash 3.2 下空数组配 set -u 会报错，不用数组）
# 不留证据时加 --ephemeral，让 codex 不写 rollout；-s read-only 问问题不需要写权限
set -- -s read-only --skip-git-repo-check -C "$WORKDIR" -o "$CALLDIR/answer.md" -
[ "$KEEP" = "0" ] && set -- --ephemeral "$@"
[ -n "${ASK_GPT_MODEL:-}" ] && set -- -m "$ASK_GPT_MODEL" "$@"
[ "$ASK_GPT_EFFORT" != "config" ] && set -- -c "model_reasoning_effort=$ASK_GPT_EFFORT" "$@"

# 问题走 stdin（末尾的 -）
"$CODEX" exec "$@" < "$CALLDIR/prompt.txt" \
  > "$CALLDIR/stdout.log" 2> "$CALLDIR/stderr.log"
status=$?

# banner 里的 model / reasoning effort 是本次生效值（-m、-c 覆盖后也会跟着变）
MODEL=$(sed -n 's/^model: //p' "$CALLDIR/stderr.log" | head -1)
EFFORT=$(sed -n 's/^reasoning effort: //p' "$CALLDIR/stderr.log" | head -1)
TOKENS=$(grep -A1 '^tokens used' "$CALLDIR/stderr.log" | tail -1 | tr -d ' ,')

if [ -s "$CALLDIR/answer.md" ]; then
  cat "$CALLDIR/answer.md"
  echo >&2
  echo "ask-gpt: 模型 ${MODEL:-未知} ｜ 思考强度 ${EFFORT:-未知} ｜ tokens ${TOKENS:-未知}" >&2
  if [ "$KEEP" = "1" ]; then
    SESSION_ID=$(sed -n 's/^session id: //p' "$CALLDIR/stderr.log" | head -1)
    PROVIDER=$(sed -n 's/^provider: //p' "$CALLDIR/stderr.log" | head -1)
    ROLLOUT=$(find "$HOME/.codex/sessions" -name "rollout-*-${SESSION_ID}.jsonl" 2>/dev/null | head -1)
    SHA_PROMPT=$(shasum -a 256 "$CALLDIR/prompt.txt" 2>/dev/null | cut -c1-16)
    SHA_ANSWER=$(shasum -a 256 "$CALLDIR/answer.md" 2>/dev/null | cut -c1-16)
    echo "ask-gpt: 证据 ${CALLDIR} ｜ provider ${PROVIDER:-未知}" >&2
    echo "ask-gpt: codex 会话 ${SESSION_ID:-未知} ｜ rollout ${ROLLOUT:-未找到}" >&2
    echo "ask-gpt: prompt sha256 ${SHA_PROMPT} / answer sha256 ${SHA_ANSWER}" >&2
  fi
  [ "$status" -ne 0 ] && echo "ask-gpt: 注意，Codex 退出码为 ${status}，以上回答可能不完整" >&2
  [ "$KEEP" = "0" ] && rm -rf "$CALLDIR"
  exit 0
fi

echo "ask-gpt: Codex 没有给出回答（退出码 ${status}），它的最后几行报错：" >&2
tail -n 15 "$CALLDIR/stderr.log" >&2
[ "$KEEP" = "1" ] && echo "ask-gpt: 证据 ${CALLDIR}" >&2
[ "$KEEP" = "0" ] && rm -rf "$CALLDIR"
exit 1
