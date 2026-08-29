# pi-xai-usage

English | [简体中文](./README.zh-CN.md)

> **Unofficial.** Not affiliated with xAI. Reads Grok Build consumer billing
> endpoints observed in the official CLI (`cli-chat-proxy.grok.com`); those
> endpoints are undocumented and may change without notice. This package may
> stop working at any time.

xAI SuperGrok / X Premium included-allowance usage in the
[pi coding agent](https://github.com/earendil-works/pi-mono) footer,
with threshold alerts and a `/xai-usage` report.

```
xAI W ███░░░░░ 43% ↻2h 0m
```

## Install

```bash
pi install npm:pi-xai-usage
```

Or from git:

```bash
pi install git:github.com/frederick-wang/pi-xai-usage
```

Do not load this package together with `pi-xai`'s usage statusbar or with
`pi-supergrok-usage`. Both register `/xai-usage`; Pi will suffix the command,
and the footers disagree on used vs remaining percent.

## Usage

### Footer

Appears when the active model's provider is `xai` and the session is a
SuperGrok / X Premium OAuth subscription. Cleared on any other provider.

| Element | Meaning |
| --- | --- |
| `███░░░░░` | 8-cell used bar; filled cells take the threshold color, empty cells are dim |
| `W` / `M` | weekly / monthly included-allowance window; omitted when unknown |
| `43%` | used percentage of that window (integer, 0–100) |
| `↻2h 0m` | time until reset, local timezone; under 24h a countdown, within 7 days weekday+time (`↻Sat 05:00`), beyond a date (`↻Sep06`) |
| `≈2.0h` | estimated time to exhaustion at the current burn rate (same account, same window, ≥3 snapshots spanning ≥1 h, and only when exhaustion would beat the reset) |
| `~` | prefix: last refresh failed, previous number kept |
| color | green < 50% used, yellow 50–79%, red ≥ 80% |

An inference `XAI_API_KEY` is not enough. The footer shows `xAI need OAuth`
and billing is not contacted. Run `/login xai` and choose a subscription.

### Threshold alerts

One toast per account per period per tier when used percent crosses 80% or 95%:

```
xAI included allowance at 85% used (crossed 80%)
```

Jitter around a threshold does not re-emit. A new billing period re-arms.
A drop of 20 points re-arms only when the payload has no period identity.

### `/xai-usage`

Overlay with plan tier, included allowance, on-demand USD, and prepaid USD.
Those last two stay out of the footer; they are different billing concepts.

`/xai-usage --json` prints `{ "schema": 1, ... }` with `null` for unknown
fields — TUI overlay or print mode. RPC refuses stdout.

The command works while another provider is selected; it does not turn the
footer on.

### Refresh

Fetches on activation and on `/xai-usage`; after each turn at most every
180 s (60 s once included usage is ≥ 80%). An xAI HTTP response may schedule
one refresh that still honors that floor. 429/5xx backs off honoring
`Retry-After` (absolute: even `/xai-usage` cannot shorten it). Two rejected
credentials trip a breaker. Headless runs (`pi -p`) make no requests.

The countdown `↻` ticks locally every 30 s only while the agent is running
and reset is under one hour away.

## Key setup

`/login xai` → **Use a subscription**. Tokens live in pi's auth.json and are
refreshed by pi. This extension does not read `~/.grok/auth.json` and does
not send API keys to the consumer billing host.

The selected model's origin must be `https://api.x.ai`. Custom/proxy base
URLs hide the footer.

## Language

The footer is language-neutral. Toasts, the report, and error guidance
follow `PI_XAI_USAGE_LANG` (`zh` or `en`) when set; otherwise the process
locale; otherwise English. `--json` keys stay English.

## Privacy

No telemetry. The access token is used only as `Authorization: Bearer` to
`cli-chat-proxy.grok.com` (`/v1/user?include=subscription` then
`/v1/billing?format=credits`). The proxy `userId` is never displayed or
written to disk; snapshots store a non-reversible fingerprint.

Required non-secret headers: `X-XAI-Token-Auth: xai-grok-cli` and Grok Build
client version/mode. This package does not claim to be the Grok CLI.

## Limitations

- Node's built-in `fetch` ignores `HTTPS_PROXY`.
- `creditUsagePercent` is an undocumented used-percent of an unpublished
  pool. The bar restates that number; it is not a token count.
- The billing endpoints may change without notice.

## Development

pnpm (see `packageManager` in `package.json`). Node ≥ 23.6 locally for type
stripping; CI runs Node 24.

```bash
pnpm install
pnpm run typecheck
pnpm test
pnpm run live-check
```

## License

MIT — see [LICENSE](./LICENSE).
