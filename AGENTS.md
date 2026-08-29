# AGENTS.md — pi-xai-usage

A [pi coding agent](https://github.com/earendil-works/pi-mono) extension that surfaces xAI SuperGrok / X Premium consumer-subscription usage in the footer, with threshold alerts and a `/xai-usage` report.

## Project standards

- **No personal information in any file**, including git history. Package coordinates (`pi-xai-usage`, the GitHub repo URL) are the only identity allowed. Set the repo-local neutral git identity before the first commit.
- **Shipped text is English**; `README.zh-CN.md` mirrors it in idiomatic Chinese — same content, natural phrasing, never word-for-word; both language versions change together, with no notes about the sync process in reader-facing text.
- **UI language** follows `PI_XAI_USAGE_LANG`, then locale, then English; `--json` keys stay English.
- **Zero runtime dependencies.** No runtime value imports from `@earendil-works/pi-*` packages (`--omit=dev` installs break otherwise); the overlay renders plain text and compares raw key bytes via `kb.matches`.
- **Single extension file** (`extensions/xai-usage.ts`); the message catalog lives in it.
- **OAuth subscription only.** Never send `XAI_API_KEY` to `cli-chat-proxy.grok.com`. Never persist or display the proxy `userId`.
- **MIT license** — keep the `LICENSE` file and the `license` field in sync.

## Hard-won implementation notes (carried from pi-glm-usage / pi-deepseek-balance)

- Seed activation in `session_start` from `ctx.model` (`SessionStartEvent` may carry no model). `model_select` alone never fires on a plain startup.
- Gate automatic polling on `ctx.mode`/`ctx.hasUI` per event, never `stdout.isTTY`; `json` mode is treated like `rpc` (no stdout writes); only `print` mode may `console.log`. The explicit `/xai-usage` command may fetch in print mode; lifecycle events must not resolve auth or hit the network when not interactive.
- `getProviderAuth` can throw and can refresh+persist a token. Call it only inside the throttled fetch, in try/catch. Never on countdown ticks.
- Re-evaluate OAuth vs API-key on every `turn_end` (there is no login event).
- `ctx.ui.setStatus(key, undefined)` clears the slot.
- Overlay: `render(width): string[]` (never a joined string); `maxHeight: "80%"` matching pi's clip; live `rowGen`; keybinding ids `tui.select.confirm` / `cancel` / `up` / `down` / `pageUp` / `pageDown` / `tui.altScreen.top` / `bottom`.
- Stale marker must not read as a percent literal (`43%~` is wrong); put it before the bar or as a dim prefix.
- `≈Nh` only when `resetAt` is known, runway < untilReset, same account fingerprint, same period, ≥3 snapshots spanning ≥1 h. Do not port glm's `minExhaustionHours` guard as-written.
- Before any release: install the packed tarball into a throwaway project and run it under real `pi` once. Live-check must cover: subscription gate, `getProviderAuth` throw, whether a pi-issued token is accepted by `cli-chat-proxy.grok.com`.
- pnpm 11 build policy: `pnpm-workspace.yaml` `allowBuilds` with `true`/`false` values (v10 names are ignored; `block` is invalid).
- Editing `package.json` dependencies requires regenerating the lockfile in the same commit.
- `gh pr checks` emits `pass`/`fail`; `gh run view` emits `success`/`failure`.
- First npm publish uses repository secret `NPM_TOKEN` (`NODE_AUTH_TOKEN` via `actions/setup-node` + `registry-url`, then `npm publish --access public --provenance`). pnpm does not read `NODE_AUTH_TOKEN`. Later publishes can move to OIDC trusted publishing. `repository.url` must use the `git+https://` form. An anonymous PUT is **404**, not 401.
- Reader-facing text carries no maintainer meta-notes; the zh README is written as Chinese a Chinese engineer would write.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles with default names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`.
