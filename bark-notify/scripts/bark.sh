#!/usr/bin/env bash
# bark.sh — 通过 Bark 把通知推送到用户手机（bark-notify skill 的发送脚本）
# 路径不写死：key 解析 --key > $BARK_KEY > 配置文件
#   配置文件解析 $BARK_CONFIG > $BARK_NOTIFY_HOME/config > $XDG_CONFIG_HOME/bark-notify/config
#   > $HOME/.config/bark-notify/config（本机与服务器/容器同一套规则）
# 用法与场景见 ../SKILL.md，API 细节见 ../references/api.md
set -euo pipefail

DEFAULT_SERVER="https://api.day.app"

usage() {
  cat <<'EOF'
用法: bark.sh [选项] <标题> <正文>
      bark.sh [选项] <标题> -        # 正文从 stdin 读（多行用）
      bark.sh --self-check           # 发一条通道自检消息（带主机名/服务器/时间），并记录自检标记
      bark.sh --where                # 只打印路径与配置解析结果，不发送

选项:
  -l, --level LEVEL   active(默认) | timeSensitive | passive | critical
  -g, --group GROUP   通知分组（建议放项目名，手机端会聚合）
  -u, --url URL       点通知跳转的链接
  -s, --sound SOUND   铃声名（如 birdsong；静音建议改 level passive）
  -i, --icon ICON     图标 URL
  -k, --key KEY       临时覆盖 Bark key
      --server URL    临时覆盖服务器（自建时用），默认 https://api.day.app
  -n, --dry-run       只打印将发送的 JSON（key 打码），不实际发送
  -h, --help          显示本帮助

key 解析顺序: --key > $BARK_KEY > 配置文件
配置文件解析顺序: $BARK_CONFIG > $BARK_NOTIFY_HOME/config
                 > $XDG_CONFIG_HOME/bark-notify/config > $HOME/.config/bark-notify/config
EOF
}

die() { printf '❌ %s\n' "$*" >&2; exit 1; }

LEVEL="" GROUP="" URL="" SOUND="" ICON="" KEY="" SERVER="" DRY=0 SELFCHECK=0 WHERE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    -l|--level)   [[ $# -ge 2 ]] || die "$1 缺少取值"; LEVEL="$2"; shift 2 ;;
    -g|--group)   [[ $# -ge 2 ]] || die "$1 缺少取值"; GROUP="$2"; shift 2 ;;
    -u|--url)     [[ $# -ge 2 ]] || die "$1 缺少取值"; URL="$2"; shift 2 ;;
    -s|--sound)   [[ $# -ge 2 ]] || die "$1 缺少取值"; SOUND="$2"; shift 2 ;;
    -i|--icon)    [[ $# -ge 2 ]] || die "$1 缺少取值"; ICON="$2"; shift 2 ;;
    -k|--key)     [[ $# -ge 2 ]] || die "$1 缺少取值"; KEY="$2"; shift 2 ;;
    --server)     [[ $# -ge 2 ]] || die "$1 缺少取值"; SERVER="$2"; shift 2 ;;
    -n|--dry-run) DRY=1; shift ;;
    --self-check) SELFCHECK=1; shift ;;
    --where)      WHERE=1; shift ;;
    -h|--help)    usage; exit 0 ;;
    --)           shift; break ;;
    -*)           usage >&2; die "未知选项: $1" ;;
    *)            break ;;
  esac
done

if (( WHERE && SELFCHECK )); then die "--where 与 --self-check 不能同时使用"; fi
command -v curl >/dev/null 2>&1 || die "环境里没有 curl，Bark 发送依赖它（Debian/Ubuntu: apt install curl；Alpine: apk add bash curl，本脚本需要 bash）"

# ---------- 路径解析：不绑死任何固定路径 ----------
resolve_config_file() {
  if [[ -n "${BARK_CONFIG:-}" ]]; then printf '%s' "$BARK_CONFIG"; return 0; fi
  local dir=""
  if [[ -n "${BARK_NOTIFY_HOME:-}" ]]; then dir="$BARK_NOTIFY_HOME"
  elif [[ -n "${XDG_CONFIG_HOME:-}" ]]; then dir="$XDG_CONFIG_HOME/bark-notify"
  elif [[ -n "${HOME:-}" ]]; then dir="$HOME/.config/bark-notify"
  fi
  [[ -n "$dir" ]] && printf '%s/config' "$dir"
  return 0
}
CONFIG_FILE="$(resolve_config_file)"
if [[ -n "$CONFIG_FILE" ]]; then
  STATE_DIR="$(dirname "$CONFIG_FILE")"
elif [[ -n "${HOME:-}" ]]; then
  STATE_DIR="$HOME/.config/bark-notify"
else
  STATE_DIR="${TMPDIR:-/tmp}/bark-notify-$(id -u 2>/dev/null || printf 0)"
fi
if [[ -n "${BARK_STATE_DIR:-}" ]]; then STATE_DIR="$BARK_STATE_DIR"; fi

config_get() {
  local k="$1"
  [[ -n "$CONFIG_FILE" && -f "$CONFIG_FILE" ]] || return 0
  sed -n -E "s/^[[:space:]]*${k}[[:space:]]*=[[:space:]]*//p" "$CONFIG_FILE" | tail -n 1 | sed -E "s/[[:space:]]+$//; s/[[:space:]]+#.*$//; s/[[:space:]]+$//; s/^[\"']//; s/[\"']$//; s/[[:space:]]+$//"
}

KEY="${KEY:-${BARK_KEY:-$(config_get BARK_KEY)}}"
SERVER="${SERVER:-${BARK_SERVER:-$(config_get BARK_SERVER)}}"
SERVER="${SERVER:-$DEFAULT_SERVER}"
while [[ "$SERVER" == */ ]]; do SERVER="${SERVER%/}"; done

json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  s="$(printf '%s' "$s" | LC_ALL=C tr -d '\000-\010\013\014\016-\037\177')"
  printf '%s' "$s"
}

mask_key() {
  local k="$1"
  if (( ${#k} >= 16 )); then printf '%s****%s' "${k:0:4}" "${k: -4}"; else printf '****'; fi
}

build_payload() {
  local out
  out="{\"device_key\":\"$(json_escape "$1")\",\"title\":\"$(json_escape "$TITLE")\",\"body\":\"$(json_escape "$BODY")\""
  [[ -n "$LEVEL" ]] && out+=",\"level\":\"$(json_escape "$LEVEL")\""
  [[ -n "$GROUP" ]] && out+=",\"group\":\"$(json_escape "$GROUP")\""
  [[ -n "$URL"   ]] && out+=",\"url\":\"$(json_escape "$URL")\""
  [[ -n "$SOUND" ]] && out+=",\"sound\":\"$(json_escape "$SOUND")\""
  [[ -n "$ICON"  ]] && out+=",\"icon\":\"$(json_escape "$ICON")\""
  out+="}"
  printf '%s' "$out"
}

# --where：只报告解析结果，不发送、不因缺 key 报错
if (( WHERE )); then
  KEY_NOTE="（未找到）"
  [[ -n "$KEY" ]] && KEY_NOTE="$(mask_key "$KEY")"
  if [[ -n "$CONFIG_FILE" ]]; then
    CF_NOTE="（不存在）"
    [[ -f "$CONFIG_FILE" ]] && CF_NOTE="（存在）"
    printf '配置文件: %s%s\n' "$CONFIG_FILE" "$CF_NOTE"
  else
    printf '配置文件: 未解析到（可用 $BARK_CONFIG / $BARK_NOTIFY_HOME / $XDG_CONFIG_HOME / $HOME 指定，或直接 export BARK_KEY）\n'
  fi
  printf '服务器:   %s\n' "${SERVER:-（为空，检查 BARK_SERVER / --server）}"
  printf 'key:      %s\n' "$KEY_NOTE"
  printf '状态目录: %s\n' "$STATE_DIR"
  printf '条件清单: %s/conditions.md\n' "$STATE_DIR"
  exit 0
fi

[[ -n "$SERVER" ]] || die "server 地址为空：检查 BARK_SERVER / --server（bark.sh --where 可看解析结果）"
[[ -n "$KEY" ]] || die "没有找到 Bark key。任选一种：① export BARK_KEY=<key>（服务器/容器推荐）；② 命令加 --key <key>；③ 写进配置文件 ${CONFIG_FILE:-<用 \$BARK_CONFIG 指定一个可写位置>}（内容 BARK_KEY=<key>）。key 在 Bark App 首页复制；路径解析用 bark.sh --where 看。"

if (( SELFCHECK )); then
  [[ $# -eq 0 ]] || die "--self-check 不接受 <标题> <正文>"
  HOST_ID="$(hostname 2>/dev/null || printf 'unknown-host')"
  TITLE="🔌 通道自检 · ${HOST_ID}"
  BODY="Bark 通道可用。主机: ${HOST_ID}；服务器: ${SERVER}；时间: $(date '+%F %T')；key: $(mask_key "$KEY")"
  [[ -n "$GROUP" ]] || GROUP="自检"
  [[ -n "$LEVEL" ]] || LEVEL="active"
else
  [[ $# -eq 2 ]] || { usage >&2; die "需要正好 2 个位置参数：<标题> <正文>（正文写 - 表示从 stdin 读）"; }
  TITLE="$1"
  BODY="$2"
  if [[ "$BODY" == "-" ]]; then BODY="$(cat)"; fi
fi

[[ "$TITLE" =~ [^[:space:]] ]] || die "标题为空（或只有空白）"
[[ "$BODY" =~ [^[:space:]] ]] || die "正文为空（或只有空白）"
if [[ -n "$LEVEL" ]]; then
  case " active timeSensitive passive critical " in
    *" $LEVEL "*) ;;
    *) die "level 无效: ${LEVEL}（可选: active / timeSensitive / passive / critical）" ;;
  esac
fi

CHECK_MARKER="$STATE_DIR/last-selfcheck"
if (( SELFCHECK )); then
  now="$(date +%s)"
  prev_epoch=""; prev_host=""
  if [[ -s "$CHECK_MARKER" ]]; then
    read -r prev_epoch prev_host < "$CHECK_MARKER" 2>/dev/null || true
  fi
  [[ "${prev_epoch:-}" =~ ^[0-9]+$ ]] || prev_epoch=""
  if [[ -z "$prev_epoch" ]]; then
    printf 'ℹ️ 没有可用的自检记录（首次自检，或标记文件损坏——按首次处理）\n'
  elif (( prev_epoch > now )); then
    printf 'ℹ️ 自检记录时间在未来（时钟异常或标记被改）——照发\n'
  else
    mins=$(( (now - prev_epoch) / 60 ))
    if [[ -z "${prev_host:-}" ]]; then
      printf 'ℹ️ 上次自检: %s 分钟前（上次主机未记录，本次 %s）——照发\n' "$mins" "$HOST_ID"
    elif [[ "$prev_host" != "$HOST_ID" ]]; then
      printf 'ℹ️ 上次自检: %s 分钟前（主机 %s → 本次 %s，换了机器）——应当自检\n' "$mins" "$prev_host" "$HOST_ID"
    elif (( mins < 10 )); then
      printf 'ℹ️ 上次自检: %s 分钟前（同主机 %s）——10 分钟内刚自检成功、期间没换环境也没收到失败，可跳过本次\n' "$mins" "$HOST_ID"
    else
      printf 'ℹ️ 上次自检: %s 分钟前（同主机 %s，已超过 10 分钟）——照发\n' "$mins" "$HOST_ID"
    fi
  fi
fi

if (( DRY )); then
  printf 'DRY-RUN → POST %s/push\n%s\n' "$SERVER" "$(build_payload "$(mask_key "$KEY")")"
  exit 0
fi

resp="$(build_payload "$KEY" | curl -sS --max-time 20 -X POST "$SERVER/push" \
  -H 'Content-Type: application/json' \
  --data-binary @- \
  -w $'\n%{http_code}')" || die "网络请求失败：${resp:-（curl 无输出）}"

http_code="${resp##*$'\n'}"
body="${resp%$'\n'*}"

if [[ "$http_code" == "200" ]] && grep -Eq '"code"[[:space:]]*:[[:space:]]*200([^0-9]|$)' <<<"$body"; then
  printf '✅ Bark 已发送 → %s\n' "$TITLE"
  if (( SELFCHECK )); then
    mkdir -p "$STATE_DIR" 2>/dev/null || true
    printf '%s %s\n' "$now" "$HOST_ID" > "$CHECK_MARKER" 2>/dev/null || true
  fi
  exit 0
fi

masked="$(mask_key "$KEY")"
msg="$(sed -n 's/.*"message":"\([^"]*\)".*/\1/p' <<<"$body")"
msg="${msg//"$KEY"/$masked}"
body="${body//"$KEY"/$masked}"
die "Bark 发送失败（HTTP ${http_code}）：${msg:-$body}"
