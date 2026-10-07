# 环境准备与浏览器下载

## 依赖

| 用途 | 包 | 缺失后果 |
|---|---|---|
| md → HTML | `marked` | 脚本直接报错 |
| 测列宽、自检、截图 | `playwright` + Chromium | 仍能出 HTML，但表格列宽写不死（会被浏览器拆词） |

装到缓存目录（可随时重装，不进项目）：

```bash
CACHE=~/Library/Caches/md-report-html        # Linux: ~/.cache/md-report-html
mkdir -p "$CACHE" && cd "$CACHE" && npm init -y >/dev/null
npm i marked playwright
npx playwright install chromium
export NODE_PATH="$CACHE/node_modules"       # 调用脚本前 export
```

## Chromium 下载不下来怎么办

大陆网络下 `npx playwright install chromium` 常卡在 `cdn.playwright.dev`（实测长期无字节、
或 `oopBrowserDownload` 挂着不动）。按顺序试：

1. **换镜像**：`PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright npx playwright install chromium`
   （只对老版本有效；Playwright 追随的最新 revision 镜像常常还没有，会 404）。
2. **直接用 Google 官方 Chrome for Testing**（实测可达，约 500 KB/s）：

   ```bash
   # 先看 playwright 期望哪个版本：npx playwright --version / 读 browsers.json
   V=156.0.8075.0
   curl -L -o chrome.zip "https://storage.googleapis.com/chrome-for-testing-public/$V/mac-arm64/chrome-mac-arm64.zip"
   unzip -q chrome.zip -d "$HOME/Library/Caches/ms-playwright/chromium-<rev>/"   # <rev> 见 playwright-core/browsers.json
   touch "$HOME/Library/Caches/ms-playwright/chromium-<rev>/INSTALLATION_COMPLETE"
   ```

   然后让脚本用它：

   ```bash
   export PLAYWRIGHT_CHROMIUM_PATH="$HOME/Library/Caches/ms-playwright/chromium-<rev>/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
   export PLAYWRIGHT_BROWSERS_PATH="$HOME/Library/Caches/ms-playwright-alt"   # 指向空目录，触发上面的回退路径
   mkdir -p "$PLAYWRIGHT_BROWSERS_PATH"
   ```

   三个脚本都支持 `PLAYWRIGHT_CHROMIUM_PATH`（`chromium.launch({ executablePath })`）。
   只想下载 `chrome-headless-shell`（体积约一半）也可以，但要放到 Playwright 期望的
   `chromium_headless_shell-<rev>/chrome-headless-shell-mac-arm64/chrome-headless-shell`。

坑：**不要**把 `chrome-headless-shell` 的位置做成指向完整 Chrome 二进制的符号链接——
macOS 上会因为找不到 app bundle 里的 framework 而崩溃，并弹出「意外退出」对话框。

## 中文字体

| 平台 | 正文（衬线） | 标题（无衬线） |
|---|---|---|
| macOS | Songti SC / STSong | Hiragino Sans GB / Heiti SC |
| Windows | SimSun / 宋体 | Microsoft YaHei |
| Linux | Noto Serif CJK SC | Noto Sans CJK SC |

macOS 上**不要指望 PingFang SC**：不少无头/沙箱环境取不到它，写了也会静默回退，
排查时表现为「标题看起来是宋体」。判断字体到底有没有生效：渲染一份 probe HTML，
比较不同 font-family 下的文字宽度，宽度和默认值完全一致的那个字体基本就是没装上。
