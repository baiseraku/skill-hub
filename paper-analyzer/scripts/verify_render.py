#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""paper-analyzer · 渲染验证（固定流程）

在最终交付前，用 headless Chromium 打开项目的 index.html（file:// 直开），
① 输出渲染数据供 Round 6 自审清单逐项核对；② 滚动分段截图供逐段目视检查。

用法:
  <venv>/bin/python verify_render.py [项目目录 | index.html 路径] [--out 截图目录]

Chromium 复用顺序（⛔ 本脚本不下载；找不到会报错，是否下载由调用方与用户确认）:
  1. 环境变量 CHROMIUM_PATH
  2. macOS: ~/Library/Caches/ms-playwright/ 下的 headless shell 或 Chromium.app
  3. Linux: ~/.cache/ms-playwright/ 下的对应二进制

检查项（全部达标 → 退出码 0）:
  - KaTeX 渲染块数 == index.html 中 $$ 对数，且无 .katex-error
  - 图片全部加载成功（naturalWidth>0），且数量 == html 中的本地 <img>
  - 无横向溢出；正文无未渲染的 $ 残留

⛔ 已踩坑，勿改用其他方式:
  - ZCode 内置浏览器（IAB）截图: "surface preparation" 常态超时（缩页也超时），不可靠
  - qlmanage（QuickLook）: 不执行 JS、不加载相对路径资源 → 公式与本地图片都不渲染
  - 整页 clip 截图: 页面超过 16384px 会被 Chromium 拒绝
    （"Clipped area is either empty or outside the resulting image"）→ 必须滚动截图
  - playwright install chromium: 默认 CDN 下载常极慢/卡死（实测 15 分钟 0 进度）
"""
import argparse
import glob
import os
import re
import sys
from urllib.parse import quote

CHROMIUM_GLOBS = [
    "~/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-*/chrome-headless-shell",
    "~/Library/Caches/ms-playwright/chromium-*/chrome-mac-*/Chromium.app/Contents/MacOS/Chromium",
    "~/.cache/ms-playwright/chromium_headless_shell-*/chrome-linux*/chrome-headless-shell",
    "~/.cache/ms-playwright/chromium-*/chrome-linux*/chrome",
]


def find_chromium():
    env = os.environ.get("CHROMIUM_PATH")
    if env:
        if os.path.exists(env):
            return env
        print(f"× CHROMIUM_PATH 指定的二进制不存在: {env}")
    for pat in CHROMIUM_GLOBS:
        hits = sorted(glob.glob(os.path.expanduser(pat)))
        if hits:
            return hits[-1]
    return None


def main():
    ap = argparse.ArgumentParser(
        description="paper-analyzer 渲染验证：数据检查 + 滚动分段截图", add_help=True
    )
    ap.add_argument("target", nargs="?", default=".",
                    help="项目目录或 index.html 路径（默认当前目录）")
    ap.add_argument("--out", help="截图输出目录（默认 <项目>/build/shots）")
    ap.add_argument("--no-shots", action="store_true", help="只要数据检查，不截图")
    args = ap.parse_args()

    target = os.path.abspath(args.target)
    index = target if target.endswith(".html") else os.path.join(target, "index.html")
    if not os.path.exists(index):
        sys.exit(f"× 找不到 {index}")
    root = os.path.dirname(index)
    out = args.out or os.path.join(root, "build", "shots")

    chromium = find_chromium()
    if not chromium:
        sys.exit(
            "× 本机没有可复用的 Playwright Chromium。\n"
            "  请先与用户确认是否下载（约 150MB+），确认后手动执行：\n"
            "    playwright install chromium\n"
            "  （本脚本故意不自动下载。）"
        )
    print(f"Chromium: {chromium}")

    html = open(index, encoding="utf-8").read()
    # 只数正文里的 $$：<head> 中 KaTeX 的 delimiters 配置也含 '$$'，会把计数多算一对
    body = html.split("<body>", 1)[-1]
    expect_katex = body.count("$$") // 2
    expect_imgs = len(re.findall(r'<img[^>]+src="(?!https?:|data:)', html))
    print(f"index.html 对照: 期望公式块 {expect_katex} 个, 本地图片 {expect_imgs} 张")

    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=chromium)
        page = browser.new_page(viewport={"width": 1000, "height": 1300},
                                device_scale_factor=1)
        page.goto("file://" + quote(index), wait_until="load")
        if expect_katex > 0:
            try:
                page.wait_for_selector(".katex-display", timeout=12000)
            except Exception:
                pass
        page.wait_for_timeout(600)  # 给剩余渲染留时间

        stats = page.evaluate(
            """() => ({
                title: document.title,
                katexDisplay: document.querySelectorAll('.katex-display').length,
                katexErrors: document.querySelectorAll('.katex-error').length,
                images: Array.from(document.images).map(i => i.naturalWidth),
                tables: document.querySelectorAll('table').length,
                dollarLeftover: Array.from(
                    document.querySelectorAll('p,td,figcaption,li,h2,h3'))
                    .filter(e => e.innerText.includes('$')).length,
                overflowPx: document.documentElement.scrollWidth
                          - document.documentElement.clientWidth,
                height: document.documentElement.scrollHeight,
            })"""
        )
        loaded = sum(1 for w in stats["images"] if w > 0)
        ok = (
            stats["katexDisplay"] == expect_katex
            and stats["katexErrors"] == 0
            and len(stats["images"]) == expect_imgs
            and loaded == len(stats["images"])
            and stats["overflowPx"] <= 1
            and stats["dollarLeftover"] == 0
        )
        print(f"标题     : {stats['title']}")
        print(f"公式     : 渲染 {stats['katexDisplay']} 块（期望 {expect_katex}），"
              f"渲染错误 {stats['katexErrors']}")
        print(f"图片     : 加载 {loaded}/{len(stats['images'])}（期望 {expect_imgs}）")
        print(f"表格     : {stats['tables']} 张")
        print(f"横向溢出 : {stats['overflowPx']}px    "
              f"未渲染 $ 残留: {stats['dollarLeftover']} 处")
        print(f"页面高度 : {stats['height']}px")

        if not args.no_shots:
            os.makedirs(out, exist_ok=True)
            step = page.viewport_size["height"] - 200  # 相邻截图留 200px 重叠
            last_y, i, y = -1, 0, 0
            while True:
                actual = page.evaluate(
                    "(y) => { window.scrollTo(0, y); return Math.round(window.scrollY); }",
                    y,
                )
                if actual == last_y:
                    break
                page.wait_for_timeout(250)
                page.screenshot(path=os.path.join(out, f"seg{i:02d}.jpg"),
                                type="jpeg", quality=88)
                last_y, i, y = actual, i + 1, y + step
            print(f"截图     : {i} 段 → {out}")
        browser.close()

    if ok:
        print("\n✓ 渲染数据全部达标（截图请逐段目视过一遍）")
    else:
        print("\n× 有检查项未达标，回 index.html 修改后重跑")
        sys.exit(1)


if __name__ == "__main__":
    main()
