# pi-xai-usage

**[English](./README.md)** | 简体中文

> **非官方项目。** 与 xAI 无关联。数据来自 Grok Build 消费者计费端点
> （`cli-chat-proxy.grok.com`，实现参考官方 CLI 的调用方式）。该端点未经文档化，
> 可能随时变更或失效。

在 [pi coding agent](https://github.com/earendil-works/pi-mono) 底部状态栏显示
xAI SuperGrok / X Premium 套餐额度，提供阈值提醒和 `/xai-usage` 报告。

```
xAI W ███░░░░░ 43% ↻2h 0m
```

## 安装

```bash
pi install npm:pi-xai-usage
```

或从 git：

```bash
pi install git:github.com/frederick-wang/pi-xai-usage
```

不要和 `pi-xai` 的 usage statusbar 或 `pi-supergrok-usage` 一起装。两者都注册
`/xai-usage`，Pi 会给命令加后缀；页脚一个显示已用、一个显示剩余，叠在一起会看错。

## 用法

### 状态栏

活动模型的供应商为 `xai`，且当前是 SuperGrok / X Premium 订阅 OAuth 时显示；
切到其他供应商即清除。

| 元素 | 含义 |
| --- | --- |
| `███░░░░░` | 8 格已用条；已用格按阈值颜色，空格为暗色 |
| `W` / `M` | 周 / 月套餐窗口；未知则省略 |
| `43%` | 该窗口已用百分比（整数，0–100） |
| `↻2h 0m` | 距重置的剩余时间，本地时区；24 小时内倒计时，7 天内星期+时间（`↻Sat 05:00`），更远为日期（`↻Sep06`） |
| `≈2.0h` | 按当前消耗速率预计的耗尽时间（同一账号、同一窗口、至少 3 个快照且跨度 ≥1 小时；仅当耗尽早于重置时显示） |
| `~` | 前缀：上次刷新失败，保留旧值 |
| 颜色 | 绿 < 50% 已用，黄 50–79%，红 ≥ 80% |

仅有推理用的 `XAI_API_KEY` 不够。状态栏显示 `xAI need OAuth`，不会去请求计费。
请运行 `/login xai` 并选择订阅。

### 阈值提醒

同一账号、同一计费周期、同一档位，已用百分比越过 80% 或 95% 时提醒一次：

```
xAI 套餐额度已用 85%（越过 80%）
```

在阈值附近抖动不会重复提醒。新的计费周期会重新允许提醒。
载荷没有周期身份时，用量回落 20 个百分点以上才会重新提醒。

### `/xai-usage`

覆盖层显示套餐档位、套餐额度、按需 USD、预付 USD。后两项不进状态栏，它们和套餐额度不是同一笔账。

`/xai-usage --json` 输出 `{ "schema": 1, ... }`，缺字段为 `null`。TUI 用覆盖层，print 模式写 stdout。RPC 拒绝占用 stdout。

当前模型不是 `xai` 时命令仍可出报告，但不会打开状态栏。

### 刷新

激活时和执行 `/xai-usage` 时各请求一次；每轮对话结束后最多每 180 秒一次
（套餐已用 ≥ 80% 后改为 60 秒）。xAI 的一次 HTTP 响应可以再排一次刷新，仍遵守上述间隔。
429/5xx 按 `Retry-After` 退避（绝对期限，`/xai-usage` 也不能提前）。凭据连续两次被拒后熔断。
`pi -p` 无头模式不发请求。

`↻` 倒计时仅在模型运行中且距重置不足 1 小时时每 30 秒本地重算，不拉网。

## 凭据

`/login xai` → **Use a subscription**。token 由 pi 存放并刷新。本扩展不读
`~/.grok/auth.json`，也不会把 API key 发到消费者计费主机。

所选模型的 origin 必须是 `https://api.x.ai`。自定义 / 代理 base URL 会隐藏状态栏。

## 界面语言

状态栏不分语言。toast、报告、错误说明：先看 `PI_XAI_USAGE_LANG`（`zh` 或 `en`），
否则进程 locale，否则英文。`--json` 的键保持英文。

## 隐私

无遥测。access token 只作为 `Authorization: Bearer` 发给
`cli-chat-proxy.grok.com`（先 `/v1/user?include=subscription`，再
`/v1/billing?format=credits`）。代理返回的 `userId` 不展示、不落盘；快照只存不可逆指纹。

请求会带非密钥头：`X-XAI-Token-Auth: xai-grok-cli` 以及 Grok Build 的 client version/mode。
本包不冒充 Grok CLI。

## 限制

- Node 内置 `fetch` 不走 `HTTPS_PROXY`。
- `creditUsagePercent` 是未文档化的已用百分比，分母不公开。进度条只是复述这个数字，不是 token 计数。
- 计费端点可能随时变更。

## 开发

使用 pnpm（见 `package.json` 的 `packageManager`）。本地开发需要 Node ≥ 23.6；CI 用 Node 24。

```bash
pnpm install
pnpm run typecheck
pnpm test
pnpm run live-check
```

## 许可证

MIT — 见 [LICENSE](./LICENSE)。
