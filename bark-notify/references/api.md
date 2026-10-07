# Bark API 速查（bark-notify 用）

来源：Bark 官方 README + 本机实测（2026-10-02）。

## 发送

- 官方服务器 `https://api.day.app`；自建则用 `--server` 或 config 里 `BARK_SERVER=`。
- 本 skill 用 POST（已实测可用）：

```http
POST {server}/push
Content-Type: application/json

{"device_key":"<key>","title":"t","body":"b","level":"active","group":"g","url":"u","sound":"s","icon":"i"}
```

- GET 形式同样可用：`{server}/{key}/{title}/{body}?level=..&group=..`（title/body 需 URL 编码，中文易出错，优先 POST）。
- 成功响应：`{"code":200,"message":"success","timestamp":...}`
- 失败响应（实测，无效 key）：`{"code":400,"message":"failed to get device token: failed to get [xxx] device token from database","timestamp":...}`，HTTP 状态码随 code 一起变。

脚本以响应体里出现 `"code":200` 判定成功，其余一律算失败并把 `message` 原文打出来。

## 参数

| 字段 | 说明 |
| --- | --- |
| `device_key` | 必填。Bark App 首页复制的那串 key |
| `title` | 标题 |
| `body` | 正文 |
| `subtitle` | 副标题；本 skill 未用。README 称 POST 参数与 GET 同名，未实测 |
| `level` | `active` 默认，亮屏展示 ｜ `timeSensitive` 可穿透专注模式 ｜ `passive` 静默进通知列表，不亮屏 ｜ `critical` 忽略静音与勿扰，需在 App 里开「重要警告」权限 |
| `sound` | 铃声名，如 `birdsong`、`alarm`（见官方 Sounds 目录）；静音建议用 `level=passive` |
| `group` | 通知分组，同一 group 在手机上聚合 |
| `url` | 点击通知跳转的 URL |
| `icon` | 自定义图标 URL |
| `ciphertext` | 加密推送（进阶，本 skill 未用） |
| `call` | 持续响铃（进阶，本 skill 未用） |

## 拿 key

Bark App 首页显示的那串（形如 `abcdef1234567890ghijkl`，此处为虚构示例），点复制。App 里也可新建/重置。

## 排查

| 症状 | 处理 |
| --- | --- |
| `failed to get device token` | key 不对或已被重置，让用户在 App 里重新复制 |
| curl 报错 / HTTP 000 | 网络不通，或自建 server 地址拼错 |
| 手机不弹 | Bark App 通知权限没开；专注/静音模式下 `active` 会被压住，急事改 `timeSensitive` |
| `critical` 不生效 | App 里「重要警告」权限没开（需在 App 内单独设置） |
| 想换服务器 | `--server https://自建域名` 或 config/环境变量里 `BARK_SERVER=`，脚本自动去尾部 `/` |
| 服务器出不了外网 / 走代理 | curl 自动读 `https_proxy` / `http_proxy` 环境变量，设好即可 |
| 容器里跑不起来 | 脚本需要 bash 和 curl：Alpine 用 `apk add bash curl`；Debian/Ubuntu 用 `apt install curl`（bash 通常自带） |
| 想确认路径/key 解析对不对 | 本 skill 的 `scripts/bark.sh --where`（打印配置文件、服务器、打码 key、状态目录） |
