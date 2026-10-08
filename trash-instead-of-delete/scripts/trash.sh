#!/usr/bin/env bash
# 把路径移入系统废纸篓（回收站），永不直接删除。
# 用法: trash.sh <路径> [路径...]
# 退出码: 0 全部移入成功；1 有路径不存在或移入失败。

set -uo pipefail

if [ "$#" -eq 0 ]; then
  printf '用法: %s <路径> [路径...]\n' "$(basename "$0")" >&2
  exit 2
fi

status=0

for p in "$@"; do
  if [ ! -e "$p" ] && [ ! -L "$p" ]; then
    printf '跳过（不存在）: %s\n' "$p" >&2
    status=1
    continue
  fi

  abs="$(cd -- "$(dirname -- "$p")" && pwd)/$(basename -- "$p")"

  # 1) 系统自带或 Homebrew 的 trash（首选，保留 Finder 的「放回原处」）
  if command -v trash >/dev/null 2>&1 && trash -v "$abs"; then
    continue
  fi

  # 2) Linux 的 gio
  if command -v gio >/dev/null 2>&1 && gio trash "$abs"; then
    printf '已移入回收站 (gio): %s\n' "$abs"
    continue
  fi

  # 3) macOS Finder（同样保留「放回原处」）；路径含双引号时跳过，避免 AppleScript 转义问题
  case "$abs" in
    *'"'*) ;;
    *)
      if command -v osascript >/dev/null 2>&1 &&
         osascript -e "tell application \"Finder\" to delete POSIX file \"$abs\"" >/dev/null 2>&1; then
        printf '已移入废纸篓 (Finder): %s\n' "$abs"
        continue
      fi
      ;;
  esac

  # 4) 兜底：直接移到废纸篓目录（会丢「放回原处」，重名加时间戳避免覆盖）
  trash_dir="$HOME/.Trash"
  if [ -d "$HOME/.local/share/Trash/files" ]; then
    trash_dir="$HOME/.local/share/Trash/files"
  elif [ -d /Trash ]; then
    trash_dir="/Trash"
  fi
  dest="$trash_dir/$(basename -- "$abs").$(date +%Y%m%d%H%M%S)"

  if mv -- "$abs" "$dest"; then
    printf '已移入废纸篓 (mv，无「放回原处」): %s -> %s\n' "$abs" "$dest"
  else
    printf '移入废纸篓失败: %s\n' "$abs" >&2
    status=1
  fi
done

exit "$status"
