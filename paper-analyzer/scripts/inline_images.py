#!/usr/bin/env python3
"""
把已写好的 HTML 转成 standalone 单文件版：把所有图片 base64 内嵌，并报告残留的外部依赖。

为什么单独有这个脚本：generate_html.py 是从 markdown 走 markdown→HTML 的路子，
而 Round 5 是直接手写完整 HTML，那条路上没人负责内嵌图片，一分享就出现"图全是裂的"。

用法:
  python3 inline_images.py 文章.html                  # 输出 文章_standalone.html
  python3 inline_images.py 文章.html --out 交付.html   # 指定输出
  python3 inline_images.py 文章.html --in-place        # 就地覆盖（先自动备份 .bak）
  python3 inline_images.py 文章.html --check           # 只检查是否已是单文件，不改写

退出码: 0 = 图片全部内嵌（已是单文件）；2 = 仍有图片需要内嵌；1 = 用法/文件错误
"""
import base64
import re
import shutil
import sys
from pathlib import Path

MIME = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp', '.avif': 'image/avif',
}

IMG_RE = re.compile(r'<img\b[^>]*?\bsrc\s*=\s*(["\'])(.*?)\1', re.I | re.S)


def analyze(html_path: Path):
    """只做分析，不改动。返回 (html, 待内嵌列表)
    待内嵌项: (src, 绝对路径 或 None, 类型 local/missing/remote)"""
    html = html_path.read_text(encoding='utf-8')
    base_dir = html_path.parent
    todo = []
    for m in IMG_RE.finditer(html):
        src = m.group(2).strip()
        if src.startswith('data:'):
            continue
        if re.match(r'https?://', src, re.I):
            todo.append((src, None, 'remote'))
            continue
        p = (base_dir / src.split('?')[0].split('#')[0]).resolve()
        todo.append((src, p, 'local' if p.is_file() else 'missing'))
    return html, todo


def apply(html: str, todo) -> tuple:
    """执行内嵌，返回 (新 html, 内嵌张数, base64 字节数)"""
    n = total = 0
    cache = {}
    for src, p, kind in todo:
        if kind != 'local':
            continue
        if p not in cache:
            cache[p] = base64.b64encode(p.read_bytes()).decode()
        b64 = cache[p]
        mime = MIME.get(p.suffix.lower(), 'application/octet-stream')
        total += len(b64)
        for q in ('"', "'"):
            html = html.replace(f'src={q}{src}{q}', f'src={q}data:{mime};base64,{b64}{q}')
        n += 1
    return html, n, total


def residual_externals(html: str):
    """图片之外仍依赖网络的东西：CDN 脚本/样式、远程图、CSS url()"""
    out = []
    for pat, kind in ((r'<script\b[^>]*?\bsrc\s*=\s*["\'](https?://[^"\']+)', 'script'),
                      (r'<link\b[^>]*?\bhref\s*=\s*["\'](https?://[^"\']+)', 'stylesheet'),
                      (r'<img\b[^>]*?\bsrc\s*=\s*["\'](https?://[^"\']+)', 'image'),
                      (r'url\(\s*["\']?(https?://[^)"\']+)', 'css url()')):
        for m in re.finditer(pat, html, re.I):
            out.append((kind, m.group(1)))
    return out


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 1
    src = Path(args[0])
    if not src.is_file():
        print(f'✗ 找不到文件: {src}')
        return 1
    check_only = '--check' in args
    in_place = '--in-place' in args
    out = Path(args[args.index('--out') + 1]) if '--out' in args else \
        src.with_name(src.stem + '_standalone.html')

    html, todo = analyze(src)
    local = [t for t in todo if t[2] == 'local']
    missing = [t for t in todo if t[2] == 'missing']
    remote = [t for t in todo if t[2] == 'remote']

    print(f'源文件   : {src}（{src.stat().st_size/1024:.0f} KB）')
    if not todo:
        print('图片     : 全部已是 data: 内嵌，无需处理')
    else:
        print(f'图片     : 待内嵌 {len(local)} 张' +
              (f'，缺失 {len(missing)} 张' if missing else '') +
              (f'，远程 {len(remote)} 张' if remote else ''))
    for s, _, kind in missing:
        print(f'  ✗ 文件不存在: {s}')
    for s, _, kind in remote:
        print(f'  ⚠ 远程图无法内嵌，交付后会依赖网络: {s[:80]}')

    if check_only:
        # 检查语义：这个文件现在是不是已经是单文件版
        if local or missing or remote:
            print('✗ 不是单文件版（仍有图片需要内嵌）')
            return 2
        ext = residual_externals(html)
        if ext:
            kinds = sorted({k for k, _ in ext})
            print(f'ℹ 图片已是单文件；另有 {len(ext)} 处非图片外链（离线时失效）: {", ".join(kinds)}')
        print('✓ 所有图片均已内嵌')
        return 0

    if not (local or missing or remote):
        print('✓ 已经是单文件版，未做改动')
        return 0

    html, n, total = apply(html, todo)
    ext = residual_externals(html)
    if ext:
        kinds = sorted({k for k, _ in ext})
        print(f'ℹ 仍有 {len(ext)} 处非图片外部依赖（离线打开时相关功能失效）: {", ".join(kinds)}')
        for k, u in ext[:6]:
            print(f'    [{k}] {u[:88]}')

    if in_place:
        shutil.copy2(src, src.with_suffix(src.suffix + '.bak'))
        out = src
        print(f'已备份原文件 → {src.name}.bak')
    out.write_text(html, encoding='utf-8')
    print(f'✓ 内嵌 {n} 张图（{total/1024/1024:.1f} MB base64）→ {out}'
          f'（{out.stat().st_size/1024/1024:.1f} MB）')
    if missing or remote:
        print('✗ 还有未内嵌的图片，交付前请修掉')
        return 2
    print('✓ 单文件可直接分享')
    return 0


if __name__ == '__main__':
    sys.exit(main())
