#!/usr/bin/env bash
# PDF → PNG：需要把 PDF 里的图内联进 markdown 时用（报告的图本身 PNG/PDF 都可以）
# 用法: pdf2png.sh <输出目录> <pdf> [pdf...]
# 产物: <输出目录>/<pdf 基名>_p<页号>.png（页号从 1 开始，不补零）
# 回退链: pdftoppm → magick → python3(pymupdf) → Rscript(pdftools) → qlmanage（macOS 自带，只出第 1 页）
set -uo pipefail

if [ $# -lt 2 ]; then
  echo "用法: $(basename "$0") <输出目录> <pdf> [pdf...]" >&2
  exit 2
fi

outdir=$1; shift
mkdir -p "$outdir"

# macOS 自带的 sips 不用：转 PDF 只出 170px 量级的缩略图，放进报告等于废图
convert() {  # $1=pdf  $2=输出前缀（脚本内用，形如 <outdir>/.tmp_<基名>）；回显所用工具
  local pdf=$1 prefix=$2 tmpd
  if command -v pdftoppm >/dev/null 2>&1; then
    pdftoppm -png -r 200 "$pdf" "$prefix" || return 1
    echo pdftoppm
  elif command -v magick >/dev/null 2>&1; then
    magick -density 200 "$pdf" "$prefix-%d.png" || return 1
    echo magick
  elif python3 -c 'import fitz' >/dev/null 2>&1; then
    python3 - "$pdf" "$prefix" <<'PY' || return 1
import sys, fitz
doc = fitz.open(sys.argv[1])
for i, page in enumerate(doc, 1):
    page.get_pixmap(dpi=200).save(f"{sys.argv[2]}-{i}.png")
PY
    echo pymupdf
  elif command -v Rscript >/dev/null 2>&1 &&
       Rscript -e 'quit(status = !requireNamespace("pdftools", quietly = TRUE))' >/dev/null 2>&1; then
    Rscript -e 'a <- commandArgs(TRUE); pdftools::pdf_convert(a[1], format = "png", dpi = 200, filenames = sprintf("%s-%d.png", a[2], seq_len(pdftools::pdf_info(a[1])$pages)))' "$pdf" "$prefix" >/dev/null || return 1
    echo pdftools
  elif command -v qlmanage >/dev/null 2>&1; then
    tmpd=$(mktemp -d) || return 1
    qlmanage -t -s 2400 -o "$tmpd" "$pdf" >/dev/null 2>&1 || { rm -rf "$tmpd"; return 1; }
    # qlmanage 落的是 <pdf 全名>.png，且只渲染第 1 页
    mv -f "$tmpd/$(basename "$pdf").png" "$prefix-1.png" || { rm -rf "$tmpd"; return 1; }
    rm -rf "$tmpd"
    echo qlmanage
  else
    return 1
  fi
}

pages() {  # 页数粗估：object stream 压缩过的 PDF 会数成 0，仅用于提示
  strings "$1" 2>/dev/null | grep -c '/Type[[:space:]]*/Page[^s]'
}

status=0
for pdf in "$@"; do
  [ -f "$pdf" ] || { echo "跳过（不存在）: ${pdf}" >&2; status=1; continue; }
  base=$(basename "$pdf"); base=${base%.*}
  prefix="$outdir/.tmp_${base}"

  if ! tool=$(convert "$pdf" "$prefix"); then
    echo "失败: ${pdf}（本机可用工具都转不了，请让作图方直接导出 PNG）" >&2
    status=1
    continue
  fi

  n=0
  for f in "$prefix"-*.png; do
    [ -e "$f" ] || continue
    p=${f##*-}; p=${p%.png}
    case $p in ''|*[!0-9]*) continue;; esac
    mv -f "$f" "$outdir/${base}_p$((10#$p)).png" || status=1
    n=$((n + 1))
  done

  if [ "$n" -eq 0 ]; then
    echo "失败: ${pdf}（${tool} 未产出文件）" >&2
    status=1
    continue
  fi

  pngs=$(ls "$outdir/${base}_p"*.png 2>/dev/null | tr '\n' ' ')
  echo "${pdf} -> ${n} 页（${tool}）: ${pngs}"
  if [ "${tool}" = qlmanage ]; then
    total=$(pages "$pdf")
    case $total in ''|*[!0-9]*) total=0;; esac
    if [ "$total" -gt 1 ]; then
      echo "  ⚠️ ${pdf} 至少有 ${total} 页，qlmanage 只转出了第 1 页；装 poppler 后重跑（brew install poppler），或让作图方导出 PNG" >&2
    fi
  fi
done

exit $status
