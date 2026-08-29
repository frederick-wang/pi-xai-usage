/**
 * pi-xai-usage — xAI SuperGrok / X Premium consumer-subscription usage for pi.
 *
 * Unofficial. Not affiliated with xAI. Polls Grok Build identity + credits
 * endpoints while provider `xai` is active with a SuperGrok OAuth session.
 *
 * Erasable-syntax TypeScript only. Zero runtime dependencies. No runtime
 * value imports from @earendil-works packages.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import * as nodeFs from "node:fs";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";

export const STATUS_KEY = "pi-xai-usage";
export const PROVIDER_ID = "xai";
export const OFFICIAL_ORIGIN = "https://api.x.ai";
/** Grok Build 9684fa3 `xai-grok-version`; a stale value must degrade, not toast-loop. */
export const GROK_CLIENT_VERSION = "1.0.10";
export const XAI_USER_URL = "https://cli-chat-proxy.grok.com/v1/user?include=subscription";
export const XAI_BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
export const USER_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
export const ERR_AUTH = "pi-xai-usage: the usage endpoint rejected the credential";
export const ERR_ENTITLEMENT = "pi-xai-usage: this OAuth account has no consumer billing";
export const ERR_PARSE = "pi-xai-usage: unexpected response from the usage endpoint";
export const ERR_TIMEOUT = "pi-xai-usage: the usage endpoint timed out";
export const ERR_IDENTITY = "pi-xai-usage: xAI account identity could not be verified";

const HOUR_MS = 3_600_000;
const THROTTLE_MS = 180_000;
const THROTTLE_HIGH_USAGE_MS = 60_000;
const COUNTDOWN_TICK_MS = 30_000;
const COUNTDOWN_HORIZON_MS = HOUR_MS;
const PAIR_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 64 * 1024;
const USAGE_MAX_JSON_DEPTH = 12;
const USAGE_MAX_JSON_ARRAY_ITEMS = 64;
const USAGE_MAX_JSON_OBJECT_KEYS = 64;
const USAGE_MAX_JSON_NODES = 2048;
const SNAPSHOT_KEEP = 500;
const SNAPSHOT_COMPACT_AT = 1000;
const ALERT_DROP_REARM = 20;
const ALERT_ENTRY_TYPE = "pi-xai-usage-alerts";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function isXaiProvider(provider: string | undefined): boolean {
	return provider === PROVIDER_ID;
}

export function officialModelOrigin(baseUrl: string | undefined): boolean {
	if (!baseUrl) return true;
	try {
		return new URL(baseUrl).origin === OFFICIAL_ORIGIN;
	} catch {
		return false;
	}
}

export function accountFingerprint(userId: string): string {
	return createHash("sha256").update("pi-xai-usage\0").update(userId).digest("hex").slice(0, 16);
}

export function piAgentDir(env: Record<string, string | undefined>, homedir: string): string {
	return env["PI_CODING_AGENT_DIR"] ?? nodePath.join(homedir, ".pi", "agent");
}

export type Lang = "en" | "zh";

export function resolveLang(env: Record<string, string | undefined>): Lang {
	const explicit = env["PI_XAI_USAGE_LANG"];
	if (explicit === "zh" || explicit === "en") return explicit;
	const locale = new Intl.DateTimeFormat().resolvedOptions().locale;
	return locale.toLowerCase().startsWith("zh") ? "zh" : "en";
}

type MsgVars = Record<string, string | number>;

const MESSAGES: Record<Lang, Record<string, (v: MsgVars) => string>> = {
	en: {
		reportTitle: () => "xAI Usage Report",
		segIncluded: () => "Included allowance",
		segOnDemand: () => "On-demand",
		segPrepaid: () => "Prepaid balance",
		periodWeekly: () => "Weekly",
		periodMonthly: () => "Monthly",
		periodUnknown: () => "Current period",
		used: () => "used",
		resetsIn: (v) => `resets in ${v.t}`,
		pressClose: () => "Press Enter, Esc, or Ctrl+C to close",
		pressCloseShort: () => "Esc to close",
		scrollStatus: (v) => `${v.pos}/${v.total} lines · ↑↓ scroll · Enter closes`,
		alertCrossed: (v) => `xAI included allowance at ${v.pct}% used (crossed ${v.tier}%)`,
		needOAuth: () => "pi-xai-usage: SuperGrok OAuth required. Run /login xai and choose a subscription.",
		noKey: () => "pi-xai-usage: no xAI credential. Run /login xai (subscription).",
		rateLimited: () => "pi-xai-usage: the usage endpoint is rate-limiting; retry shortly.",
		jsonModeRestricted: () => "pi-xai-usage: --json requires TUI or print mode.",
		fetchFailed: () => "pi-xai-usage: usage fetch failed.",
		entitlement: () => "pi-xai-usage: this OAuth account has no consumer billing.",
		reportSummary: (v) => `xAI included allowance: ${v.pct}% used`,
	},
	zh: {
		reportTitle: () => "xAI 用量报告",
		segIncluded: () => "套餐额度",
		segOnDemand: () => "按需用量",
		segPrepaid: () => "预付余额",
		periodWeekly: () => "周",
		periodMonthly: () => "月",
		periodUnknown: () => "当前周期",
		used: () => "已用",
		resetsIn: (v) => `${v.t} 后重置`,
		pressClose: () => "按 Enter、Esc 或 Ctrl+C 关闭",
		pressCloseShort: () => "Esc 关闭",
		scrollStatus: (v) => `第 ${v.pos}/${v.total} 行 · ↑↓ 滚动 · Enter 关闭`,
		alertCrossed: (v) => `xAI 套餐额度已用 ${v.pct}%（越过 ${v.tier}%）`,
		needOAuth: () => "pi-xai-usage：需要 SuperGrok OAuth。请运行 /login xai 并选择订阅。",
		noKey: () => "pi-xai-usage：未找到 xAI 凭据。请运行 /login xai（订阅）。",
		rateLimited: () => "pi-xai-usage：用量接口限流中，稍后重试。",
		jsonModeRestricted: () => "pi-xai-usage：--json 仅支持 TUI 或 print 模式。",
		fetchFailed: () => "pi-xai-usage：用量获取失败。",
		entitlement: () => "pi-xai-usage：该 OAuth 账户没有消费者计费数据。",
		reportSummary: (v) => `xAI 套餐额度：已用 ${v.pct}%`,
	},
};

export type MsgKey = keyof typeof MESSAGES.en;

export function msg(lang: Lang, key: MsgKey, vars: MsgVars = {}): string {
	const fn = MESSAGES[lang][key] ?? MESSAGES.en[key];
	return fn ? fn(vars) : key;
}

export interface FooterTheme {
	fg(role: string, text: string): string;
}

const identityTheme: FooterTheme = { fg: (_role, text) => text };


// Terminal text helpers — S3 pure: ANSI-aware width, wrapping, scroll windows.
// ---------------------------------------------------------------------------

/**
 * Display width of a string, ANSI SGR sequences zero-width, CJK/emoji double.
 * A pragmatic subset of East-Asian-width: enough for every line we render
 * (currency rows, report text, JSON payload); surrogate pairs count as 2.
 */
export function visualWidth(s: string): number {
	let w = 0;
	for (let i = 0; i < s.length; ) {
		const cp = s.codePointAt(i) ?? 0;
		if (cp === 0x1b) {
			i = skipEscape(s, i);
			continue;
		}
		w += isWideChar(cp) ? 2 : 1;
		i += cp > 0xffff ? 2 : 1;
	}
	return w;
}

/**
 * Index just past an escape sequence starting at s[i] == ESC.
 * Handles CSI (ESC [ ... final) and OSC (ESC ] ... BEL|ST) forms.
 */
function skipEscape(s: string, i: number): number {
	if (s[i + 1] === "]") {
		// OSC: runs until BEL (0x07) or ST (ESC \\), may contain any bytes.
		let j = i + 2;
		while (j < s.length) {
			const b = s.charCodeAt(j);
			if (b === 0x07) {
				j += 1;
				break;
			}
			if (b === 0x1b && s[j + 1] === "\\") {
				j += 2;
				break;
			}
			j += 1;
		}
		return j;
	}
	let j = i + 1;
	while (j < s.length) {
		const b = s.charCodeAt(j);
		// '[' / ']' are CSI/OSC introducers, never finals.
		if (b >= 0x40 && b <= 0x7e && b !== 0x5b && b !== 0x5d) {
			j += 1;
			break;
		}
		j += 1;
	}
	return j;
}

function isWideChar(cp: number): boolean {
	return (
		(cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
		(cp >= 0x2e80 && cp <= 0xa4cf) || // CJK radicals … Yi
		(cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
		(cp >= 0xf900 && cp <= 0xfaff) || // CJK compat ideographs
		(cp >= 0xfe30 && cp <= 0xfe4f) || // CJK compat forms
		(cp >= 0xff00 && cp <= 0xff60) || // Fullwidth forms
		(cp >= 0xffe0 && cp <= 0xffe6) || // Fullwidth signs
		(cp >= 0x1f300 && cp <= 0x1f64f) || // Emoji (pictographs)
		(cp >= 0x1f900 && cp <= 0x1f9ff) || // Emoji (supplement)
		(cp >= 0x20000 && cp <= 0x3fffd) // CJK ext B+ / ideographs
	);
}

/**
 * Wrap a line so no segment exceeds `width` visible columns. ANSI SGR codes
 * are preserved and re-applied at the start of each segment (pi resets styles
 * per line). Segments are cut at grapheme boundaries (surrogate pairs never
 * split; a wide char is never split across segments). Inline escape sequences
 * are carried through untouched.
 */
export function wrapLines(lines: string[], width: number): string[] {
	if (width <= 0) return [...lines];
	const out: string[] = [];
	for (const line of lines) {
		if (visualWidth(line) <= width) {
			out.push(line);
			continue;
		}
		// Tokenize so visible text and ANSI runs are handled separately: a
		// segment never splits an escape sequence, and styles stay intact.
		const tokens = ansiTokens(line);
		const wrapped: string[] = [];
		let cur = "";
		let curW = 0;
		for (const tok of tokens) {
			if (tok.ansi) {
				// Escape runs are zero-width and must stay with the segment.
				cur += tok.s;
				curW += 0;
				continue;
			}
		const cw = isWideChar(tok.cp) ? 2 : 1;
			if (curW + cw > width && visibleCharCount(cur) > 0) {
				wrapped.push(cur);
				// A single glyph wider than the whole line can never fit: drop it
				// rather than emit an overflowing row (a 2-col char in a 1-col
				// line would break the box frame).
				cur = cw <= width ? tok.s : "";
				curW = cw <= width ? cw : 0;
			} else if (cw > width) {
				// First char of a fresh segment can't fit either: drop silently.
				cur = "";
				curW = 0;
			} else {
				cur += tok.s;
				curW += cw;
			}
		}
		if (cur.length > 0) wrapped.push(cur);
		// Re-apply the line's leading style to every segment after the first:
		// the first already carries it (token flow), and pi resets styles per
		// rendered line, so without this only the first row keeps the color.
		// Strip ALL whitespace from the style prefix — a continuation segment
		// must not inherit the original indentation.
		const { ansiPrefix } = splitAnsi(line);
		const styleOnly = ansiPrefix.replace(/\s/g, "");
		for (let k = 0; k < wrapped.length; k++) {
			out.push(k === 0 ? wrapped[k] : `${styleOnly}${wrapped[k]}`);
		}
	}
	return out;
}

/** Visible (non-escape) character count of a segment. */
function visibleCharCount(s: string): number {
	let n = 0;
	let i = 0;
	while (i < s.length) {
		if (s[i] === "\x1b") {
			i = skipEscape(s, i);
		} else {
			const cp = s.codePointAt(i) ?? 0;
			n += 1;
			i += cp > 0xffff ? 2 : 1;
		}
	}
	return n;
}

/** Pad a line to `width` visible columns with trailing spaces (ANSI-aware). */
function padToWidth(line: string, width: number): string {
	const cur = visualWidth(line);
	return cur >= width ? line : `${line}${" ".repeat(width - cur)}`;
}

/**
 * Chrome lines (header/status/footer) are status-bar-like: never wrap —
 * truncate to the width by visible columns. Tokenizes so escape sequences
 * stay atomic; leading spaces + style prefix survive intact.
 */
function clampChrome(line: string, width: number): string {
	if (visualWidth(line) <= width) return line;
	const tokens = ansiTokens(line);
	let out = "";
	let w = 0;
	let sawVisible = false;
	for (const tok of tokens) {
		if (tok.ansi) {
			out += tok.s;
			continue;
		}
		const cw = isWideChar(tok.cp) ? 2 : 1;
		if (!sawVisible && tok.s.trim() === "") {
			// Leading whitespace is chrome formatting: keep up to width.
			if (w + cw > width) break;
			out += tok.s;
			w += cw;
			continue;
		}
		if (w + cw > width && w > 0) break;
		out += tok.s;
		w += cw;
		sawVisible = true;
	}
	return out;
}

interface AnsiToken {
	ansi: boolean;
	s: string;
	cp: number;
}

/** Split a line into [visible char | ANSI run] tokens, code-point aware. */
function ansiTokens(line: string): AnsiToken[] {
	const tokens: AnsiToken[] = [];
	let i = 0;
	while (i < line.length) {
		if (line[i] === "\x1b") {
			const j = skipEscape(line, i);
			tokens.push({ ansi: true, s: line.slice(i, j), cp: 0 });
			i = j;
		} else {
			const cp = line.codePointAt(i) ?? 0;
			const ch = String.fromCodePoint(cp);
			tokens.push({ ansi: false, s: ch, cp });
			i += cp > 0xffff ? 2 : 1;
		}
	}
	return tokens;
}

/** Strip leading and trailing ANSI SGR runs; return them separately. */
function splitAnsi(line: string): { text: string; ansiPrefix: string; ansiSuffix: string } {
	// Tokenize into [ansi | text] runs; prefix = leading spaces + leading ansi
	// tokens, suffix = trailing ansi tokens, text = everything in between.
	const tokens = ansiTokens(line);
	let prefix = "";
	let start = 0;
	// Leading whitespace is formatting, not content — keep with the prefix.
	while (start < tokens.length && (tokens[start].ansi || tokens[start].s.trim() === "")) {
		prefix += tokens[start].s;
		start += 1;
	}
	let suffix = "";
	let end = tokens.length;
	while (end > start && tokens[end - 1].ansi) {
		suffix = tokens[end - 1].s + suffix;
		end -= 1;
	}
	return { text: tokens.slice(start, end).map((t) => t.s).join(""), ansiPrefix: prefix, ansiSuffix: suffix };
}

/** Clamp scrollTop into [0, max(0, body.length - avail)]. */
export function clampScrollTop(scrollTop: number, bodyLength: number, avail: number): number {
	const max = Math.max(0, bodyLength - avail);
	return Math.min(Math.max(0, scrollTop), max);
}

export interface WindowResult {
	top: number;
	lines: string[];
	atEnd: boolean;
}

/** The visible window of a scrollable body, clamped, with end-of-content flag. */
export function windowSlice(body: string[], scrollTop: number, avail: number): WindowResult {
	const top = clampScrollTop(scrollTop, body.length, avail);
	return {
		top,
		lines: body.slice(top, top + avail),
		atEnd: top >= Math.max(0, body.length - avail),
	};
}

// Key matching — structural type for pi's injected KeybindingsManager.
// ---------------------------------------------------------------------------

export interface KeyLike {
	matches(data: string, id: string): boolean;
}

// Overlay component — hand-rolled per zero-runtime-dep rule; types local.
// ---------------------------------------------------------------------------

export interface OverlayComponent {
	render(width: number): string[];
	invalidate(): void;
	handleInput(data: string): void;
}

export interface OverlayComponentOpts {
	header: string;
	body: string[];
	footer: string;
	theme: FooterTheme;
	kb: KeyLike;
	done: (value: unknown) => void;
	// Live row source — read at render time so terminal resizes are honored.
	rowGen: () => number;
	lang: Lang;
}

/**
 * Fixed header + scrollable body + optional status line + fixed footer.
 * Body is never truncated: it scrolls. `render` recomputes styled lines so
 * `invalidate()` (called on theme change) really refreshes colors.
 */
export function createOverlayComponent(opts: OverlayComponentOpts): OverlayComponent {
	const { header, body, footer, theme, kb, done, rowGen, lang } = opts;
	let scrollTop = 0;
	let closed = false;
	// Last render width — scroll math must agree with the wrapping render used.
	let lastWidth = 80;
	// Drop a leading blank from the body: render already adds one after the
	// header, so a body starting with "" would double up the spacing.
	const body0 = body[0] === "" ? body.slice(1) : body;	

	const close = () => {
		if (closed) return;
		closed = true;
		done(undefined);
	};

	/**
	 * Row budget read live (terminal resizes), matching pi's maxHeight
	 * "80%" — the returned array must never exceed it or pi's head-keeping
	 * clip would drop the bottom border after a shrink.
	 */
	function maxRowsAt(): number {
		return Math.max(1, Math.floor(rowGen() * 0.8));
	}

	/**
	 * Body availability for a given maxRows. The box always keeps: top
	 * border(1) + blank(1) + footer row(1) + blank before footer(1) +
	 * bottom border(1) = 5 chrome rows; with a status line: + status row +
	 * its blank = 7. Body gets the rest; when maxRows can't fit a status
	 * line it's dropped (content wins over chrome). When maxRows < 6 the
	 * box cannot physically render (5-row minimum): degrade to borderless
	 * plain rows so the overlay still closes the budget.
	 */
	function layout(width: number): { avail: number; canStatus: boolean; boxed: boolean } {
		const maxRows = maxRowsAt();
		// Box needs 2 columns for the side bars + a title that fits; below that
		// (or tiny terminals) degrade to borderless plain rows.
		const boxed = maxRows >= 6 && width >= 8;
		// Boxed: borders(2) + title blank(1) + footer blank(1) + footer row(1) = 5.
		// Borderless (tiny): header(1) + blank(1) + footer(1) = 3 — body gets
		// whatever is left so content isn't dropped on short terminals.
		const chrome = boxed ? 5 : 3;
		const avail = Math.max(0, maxRows - chrome);
		const canStatus = boxed && maxRows >= chrome + 2 + 1;
		return { avail, canStatus, boxed };
	}

	/**
	 * Scroll window for the current body at the given inner width: how many
	 * body rows fit (status line costing two rows) and whether status shows.
	 * Shared by render and handleInput so the math never drifts.
	 */
	function scrollWindowAt(w: number): { bodyLines: string[]; avail: number; needsStatus: boolean } {
		const innerW = Math.max(1, w - 2);
		const bodyLines = wrapLines(body0, innerW);
		const { avail, canStatus } = layout(w);
		const needsStatus = canStatus && bodyLines.length > avail;
		const bodyAvail = needsStatus ? Math.max(0, avail - 2) : avail;
		return { bodyLines, avail: bodyAvail, needsStatus };
	}

	function renderLines(width: number): string[] {
		const w = Math.max(1, width);
		const innerW = Math.max(1, w - 2);
		const { bodyLines, avail: bodyAvail, needsStatus } = scrollWindowAt(w);
		const { boxed } = layout(w);
		const win = windowSlice(bodyLines, scrollTop, bodyAvail);
		scrollTop = win.top; // write back the clamp so input math agrees

		const statusRow = needsStatus
			? clampChrome(`  ${theme.fg("muted", msg(lang, "scrollStatus", { pos: win.atEnd ? bodyLines.length : win.top + win.lines.length, total: bodyLines.length }))}`, innerW)
			: null;
		const footerText = innerW < 20 ? msg(lang, "pressCloseShort") : footer;
		const footerRow = clampChrome(`  ${theme.fg("dim", footerText)}`, innerW);
		const titleRow = clampChrome(`  ${theme.fg("accent", header)}`, innerW);

		const blocks: string[] = [""]; // blank under the top border
		blocks.push(...win.lines);
		if (statusRow) {
			blocks.push("");
			blocks.push(statusRow);
		}
		blocks.push("");
		blocks.push(footerRow);

		if (!boxed) {
			// Degraded mode (maxRows < 6): borderless plain rows so the overlay
			// still closes the height budget on absurdly short terminals.
			const out: string[] = [titleRow];
			if (win.lines.length > 0) out.push("", ...win.lines);
			if (statusRow) out.push("", statusRow);
			out.push(footerRow);
			return out;
		}

		// Top border: ╭─[centered title]─╮ (single corner char each side)
		const titleStr = clampChrome(` ${theme.fg("accent", header)} `, innerW);
		const titleW = visualWidth(titleStr);
		const pad = Math.max(0, innerW - titleW);
		const topPad = Math.floor(pad / 2);
		const topPad2 = pad - topPad;
		const top = theme.fg("border", "╭") + theme.fg("border", "─".repeat(topPad)) + titleStr + theme.fg("border", "─".repeat(topPad2)) + theme.fg("border", "╮");
		const bottom = theme.fg("border", `╰${"─".repeat(Math.max(0, innerW))}╯`);

		const out: string[] = [top];
		for (const line of blocks) {
			const inner = line === "" ? " ".repeat(innerW) : padToWidth(line, innerW);
			out.push(`${theme.fg("border", "│")}${inner}${theme.fg("border", "│")}`);
		}
		out.push(bottom);
		return out;
	}

	return {
		render(width: number) {
			lastWidth = Math.max(1, width);
			return renderLines(lastWidth);
		},
		invalidate() {
			// render() recomputes everything from theme each call; nothing cached.
			// Kept as the pi contract entry point for theme changes.
		},
		handleInput(data: string) {
			if (closed) return;
			if (kb.matches(data, "tui.select.confirm") || kb.matches(data, "tui.select.cancel")) {
				close();
				return;
			}
			const w = Math.max(1, lastWidth);
			const { bodyLines, avail: bodyAvail } = scrollWindowAt(w);
			const max = Math.max(0, bodyLines.length - bodyAvail);
			if (kb.matches(data, "tui.select.up")) {
				scrollTop = clampScrollTop(scrollTop - 1, bodyLines.length, bodyAvail);
			} else if (kb.matches(data, "tui.select.down")) {
				scrollTop = clampScrollTop(scrollTop + 1, bodyLines.length, bodyAvail);
			} else if (kb.matches(data, "tui.select.pageUp") || kb.matches(data, "tui.altScreen.pageUp")) {
				scrollTop = clampScrollTop(scrollTop - Math.max(1, bodyAvail - 1), bodyLines.length, bodyAvail);
			} else if (kb.matches(data, "tui.select.pageDown") || kb.matches(data, "tui.altScreen.pageDown")) {
				scrollTop = clampScrollTop(scrollTop + Math.max(1, bodyAvail - 1), bodyLines.length, bodyAvail);
			} else if (kb.matches(data, "tui.altScreen.top")) {
				scrollTop = 0;
			} else if (kb.matches(data, "tui.altScreen.bottom")) {
				scrollTop = max;
			}
		},
	};
}


// ---------------------------------------------------------------------------
// Snapshot types and parser (S3).
// ---------------------------------------------------------------------------

export type PeriodKind = "weekly" | "monthly" | "unknown";

export interface UsageSnapshot {
	tier: string | undefined;
	percentage: number | null;
	period: PeriodKind;
	resetAt: number | undefined;
	periodStart: number | undefined;
	onDemandUsedUsd: number | undefined;
	onDemandCapUsd: number | undefined;
	prepaidUsd: number | undefined;
	fingerprint: string;
}

export class UsageError extends Error {
	readonly code: "auth" | "entitlement" | "parse" | "timeout" | "identity" | "http";
	readonly status?: number;
	constructor(code: UsageError["code"], message: string, status?: number) {
		super(message);
		this.name = "UsageError";
		this.code = code;
		this.status = status;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertBoundedJson(value: unknown, depth = 0, budget = { nodes: 0 }): void {
	if (depth > USAGE_MAX_JSON_DEPTH || ++budget.nodes > USAGE_MAX_JSON_NODES) {
		throw new UsageError("parse", ERR_PARSE);
	}
	if (Array.isArray(value)) {
		if (value.length > USAGE_MAX_JSON_ARRAY_ITEMS) throw new UsageError("parse", ERR_PARSE);
		for (const item of value) assertBoundedJson(item, depth + 1, budget);
		return;
	}
	if (!isRecord(value)) return;
	const values = Object.values(value);
	if (values.length > USAGE_MAX_JSON_OBJECT_KEYS) throw new UsageError("parse", ERR_PARSE);
	for (const item of values) assertBoundedJson(item, depth + 1, budget);
}

export function parseUserId(value: unknown): string {
	const userId = isRecord(value) ? value["userId"] : undefined;
	if (typeof userId !== "string" || !USER_ID_PATTERN.test(userId)) {
		throw new UsageError("identity", ERR_IDENTITY);
	}
	return userId;
}

export function parseSubscriptionTier(value: unknown): string | undefined {
	const raw = isRecord(value) ? value["subscriptionTier"] : undefined;
	if (raw === undefined || raw === null) return undefined;
	if (typeof raw !== "string" || raw.length > 160) throw new UsageError("parse", ERR_PARSE);
	const cleaned = [...raw].filter((ch) => {
		const cp = ch.codePointAt(0) ?? 0;
		return cp > 0x1f && !(cp >= 0x7f && cp <= 0x9f);
	}).join("").trim();
	return cleaned.length > 0 ? cleaned.slice(0, 80) : undefined;
}

function optionalCentsUsd(value: unknown): number | undefined {
	if (value === undefined || value === null) return undefined;
	if (!isRecord(value)) throw new UsageError("parse", ERR_PARSE);
	let cents: unknown = value["val"] === undefined ? 0 : value["val"];
	if (typeof cents === "string" && /^-?\d+$/.test(cents)) cents = Number(cents);
	if (typeof cents !== "number" || !Number.isSafeInteger(cents)) throw new UsageError("parse", ERR_PARSE);
	return cents / 100;
}

function optionalTimestampMs(value: unknown): number | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string" || value.length > 80) throw new UsageError("parse", ERR_PARSE);
	const ms = Date.parse(value);
	if (!Number.isFinite(ms)) throw new UsageError("parse", ERR_PARSE);
	return ms;
}

function periodKind(type: unknown): PeriodKind {
	if (typeof type !== "string") return "unknown";
	if (type.endsWith("WEEKLY")) return "weekly";
	if (type.endsWith("MONTHLY")) return "monthly";
	return "unknown";
}

export function parseUsage(billing: unknown, userId: string, tierFromUser?: string): UsageSnapshot {
	assertBoundedJson(billing);
	if (!isRecord(billing)) throw new UsageError("parse", ERR_PARSE);
	const configValue = billing["config"];
	if (configValue !== undefined && configValue !== null && !isRecord(configValue)) {
		throw new UsageError("parse", ERR_PARSE);
	}
	const config = isRecord(configValue) ? configValue : undefined;
	const fingerprint = accountFingerprint(userId);
	const tier = parseSubscriptionTier(billing) ?? tierFromUser;
	if (!config) {
		return {
			tier,
			percentage: null,
			period: "unknown",
			resetAt: undefined,
			periodStart: undefined,
			onDemandUsedUsd: undefined,
			onDemandCapUsd: undefined,
			prepaidUsd: undefined,
			fingerprint,
		};
	}
	const currentPeriod = config["currentPeriod"];
	if (currentPeriod !== undefined && currentPeriod !== null && !isRecord(currentPeriod)) {
		throw new UsageError("parse", ERR_PARSE);
	}
	const periodObj = isRecord(currentPeriod) ? currentPeriod : undefined;
	let percentage: number | null = null;
	const rawPct = config["creditUsagePercent"];
	if (rawPct !== undefined && rawPct !== null) {
		if (typeof rawPct !== "number" || !Number.isFinite(rawPct) || rawPct < 0 || rawPct > 100) {
			throw new UsageError("parse", ERR_PARSE);
		}
		percentage = rawPct;
	} else {
		const used = optionalCentsUsd(config["used"]);
		const limit = optionalCentsUsd(config["monthlyLimit"]);
		if (used !== undefined && limit !== undefined && limit > 0 && used >= 0) {
			percentage = Math.min(100, (used / limit) * 100);
		}
	}
	let period = periodKind(periodObj?.["type"]);
	if (period === "unknown" && (config["monthlyLimit"] !== undefined || config["used"] !== undefined || config["billingPeriodEnd"] !== undefined)) {
		period = "monthly";
	}
	const resetAt = optionalTimestampMs(periodObj?.["end"]) ?? optionalTimestampMs(config["billingPeriodEnd"]);
	const periodStart = optionalTimestampMs(periodObj?.["start"]) ?? optionalTimestampMs(config["billingPeriodStart"]);
	return {
		tier,
		percentage,
		period,
		resetAt,
		periodStart,
		onDemandUsedUsd: optionalCentsUsd(config["onDemandUsed"]),
		onDemandCapUsd: optionalCentsUsd(config["onDemandCap"]),
		prepaidUsd: optionalCentsUsd(config["prepaidBalance"]),
		fingerprint,
	};
}

export function displayPercent(percentage: number | null): number | null {
	if (percentage === null) return null;
	return Math.round(percentage);
}

function colorRoleFor(pct: number | null): string {
	if (pct === null) return "dim";
	if (pct < 50) return "success";
	if (pct < 80) return "warning";
	return "error";
}

export function renderBar(percentage: number | null, theme: FooterTheme): string {
	const width = 8;
	const filled = percentage === null ? 0 : Math.round((Math.min(100, Math.max(0, percentage)) / 100) * width);
	return theme.fg(colorRoleFor(percentage === null ? null : Math.round(percentage)), "█".repeat(filled)) + theme.fg("dim", "░".repeat(width - filled));
}

export function formatReset(resetMs: number | undefined, now: number): string {
	if (resetMs === undefined || !Number.isFinite(resetMs) || resetMs <= now) return "";
	const diff = resetMs - now;
	if (diff < 24 * HOUR_MS) {
		const h = Math.floor(diff / HOUR_MS);
		const m = Math.floor((diff % HOUR_MS) / 60_000);
		return h > 0 ? `${h}h ${m}m` : `${m}m`;
	}
	const at = new Date(resetMs);
	if (diff < 7 * 24 * HOUR_MS) {
		const hh = String(at.getHours()).padStart(2, "0");
		const mm = String(at.getMinutes()).padStart(2, "0");
		return `${WEEKDAYS[at.getDay()]} ${hh}:${mm}`;
	}
	return `${MONTHS[at.getMonth()]}${String(at.getDate()).padStart(2, "0")}`;
}

export interface QuotaSnapshot {
	t: number;
	percentage: number;
	fingerprint: string;
	periodStart?: number;
	periodEnd?: number;
}

export function estimateQuotaRate(snaps: QuotaSnapshot[], fingerprint: string, periodStart?: number, periodEnd?: number): number | null {
	const usable = snaps.filter((x) =>
		Number.isFinite(x.t) &&
		Number.isFinite(x.percentage) &&
		x.fingerprint === fingerprint &&
		(periodStart === undefined || x.periodStart === periodStart) &&
		(periodEnd === undefined || x.periodEnd === periodEnd),
	);
	if (usable.length < 3) return null;
	if (periodStart === undefined && periodEnd === undefined) return null;
	let start = usable.length - 1;
	while (start > 0 && usable[start - 1].percentage <= usable[start].percentage + 1e-9) start -= 1;
	const window = usable.slice(Math.max(start, 0));
	if (window.length < 3) return null;
	const span = window[window.length - 1].t - window[0].t;
	if (span < HOUR_MS) return null;
	const climb = window[window.length - 1].percentage - window[0].percentage;
	if (climb <= 0) return null;
	return (climb / span) * HOUR_MS;
}

export function quotaRunwayHours(percentage: number, perHour: number): number | null {
	if (perHour <= 0) return null;
	const remaining = 100 - percentage;
	if (remaining <= 0) return null;
	return remaining / perHour;
}

function formatHours(hours: number): string {
	if (hours >= 24) return `${(hours / 24).toFixed(1)}d`;
	if (hours >= 1) return `${hours.toFixed(1)}h`;
	return `${Math.round(hours * 60)}min`;
}

export function renderFooter(
	snapshot: UsageSnapshot,
	opts: { now: number; stale?: boolean; theme?: FooterTheme; snaps?: QuotaSnapshot[] },
): string {
	const theme = opts.theme ?? identityTheme;
	const pct = displayPercent(snapshot.percentage);
	const periodLabel = snapshot.period === "weekly" ? "W" : snapshot.period === "monthly" ? "M" : "";
	const bar = renderBar(pct, theme);
	const pctText = pct === null ? "?" : String(pct);
	const reset = formatReset(snapshot.resetAt, opts.now);
	const stale = opts.stale ? `${theme.fg("dim", "~")} ` : "";
	const periodBit = periodLabel ? `${periodLabel} ` : "";
	const coloredPct = theme.fg(colorRoleFor(pct), `${pctText}%`);
	let line = `${stale}xAI ${periodBit}${bar} ${coloredPct}`;
	if (reset) line += ` ↻${reset}`;
	if (opts.snaps && pct !== null && snapshot.resetAt !== undefined) {
		const rate = estimateQuotaRate(opts.snaps, snapshot.fingerprint, snapshot.periodStart, snapshot.resetAt);
		if (rate !== null) {
			const runway = quotaRunwayHours(pct, rate);
			if (runway !== null) {
				const untilReset = (snapshot.resetAt - opts.now) / HOUR_MS;
				if (runway < untilReset) {
					line += ` ${theme.fg("dim", `≈${formatHours(runway)}`)}`;
				}
			}
		}
	}
	return line;
}

export interface AlertUnitState {
	fingerprint: string;
	periodStart: number | null;
	periodEnd: number | null;
	lastPct: number | null;
	alerted80: boolean;
	alerted95: boolean;
}

export type AlertState = Record<string, AlertUnitState>;

export interface AlertEmission {
	tier: 80 | 95;
	pct: number;
}

function periodKey(fingerprint: string, start: number | null, end: number | null): string {
	return `${fingerprint}:${start ?? ""}:${end ?? ""}`;
}

export function evaluateAlerts(state: AlertState | null, snapshot: UsageSnapshot): { emitted: AlertEmission[]; state: AlertState } {
	const next: AlertState = { ...(state ?? {}) };
	const emitted: AlertEmission[] = [];
	if (snapshot.percentage === null) return { emitted, state: next };
	const pct = snapshot.percentage;
	const start = snapshot.periodStart ?? null;
	const end = snapshot.resetAt ?? null;
	const key = periodKey(snapshot.fingerprint, start, end);
	const hasIdentity = start !== null || end !== null;
	let prev = next[key];
	if (!prev && !hasIdentity) {
		const loose = Object.values(next).find((s) => s.fingerprint === snapshot.fingerprint && s.periodStart === null && s.periodEnd === null);
		if (loose) prev = loose;
	}
	let alerted80 = prev?.alerted80 ?? false;
	let alerted95 = prev?.alerted95 ?? false;
	if (!hasIdentity && prev?.lastPct !== null && prev?.lastPct !== undefined && prev.lastPct - pct >= ALERT_DROP_REARM) {
		alerted80 = false;
		alerted95 = false;
	}
	if (pct >= 95) {
		if (!alerted95) emitted.push({ tier: 95, pct: displayPercent(pct) ?? Math.round(pct) });
		alerted95 = true;
		alerted80 = true;
	} else if (pct >= 80) {
		if (!alerted80) emitted.push({ tier: 80, pct: displayPercent(pct) ?? Math.round(pct) });
		alerted80 = true;
	}
	next[key] = {
		fingerprint: snapshot.fingerprint,
		periodStart: start,
		periodEnd: end,
		lastPct: pct,
		alerted80,
		alerted95,
	};
	return { emitted, state: next };
}

export interface QuotaSnapshotStore {
	append(snap: QuotaSnapshot): void;
	load(): QuotaSnapshot[];
}

export function createQuotaSnapshotStore(
	dir: string,
	readFile: (p: string) => string | null,
	appendFile: (p: string, s: string) => void,
	writeFile: (p: string, s: string) => void,
	rename: (from: string, to: string) => void,
): QuotaSnapshotStore {
	const file = nodePath.join(dir, "pi-xai-usage-quota-snapshots.jsonl");
	const parseAll = (): QuotaSnapshot[] => {
		let raw: string | null;
		try {
			raw = readFile(file);
		} catch {
			raw = null;
		}
		if (raw === null) return [];
		const out: QuotaSnapshot[] = [];
		for (const line of raw.split("\n")) {
			const t = line.trim();
			if (!t) continue;
			try {
				const r = JSON.parse(t) as Record<string, unknown>;
				if (typeof r["t"] === "number" && typeof r["percentage"] === "number" && typeof r["fingerprint"] === "string") {
					if (typeof r["userId"] === "string") continue;
					out.push({
						t: r["t"],
						percentage: r["percentage"],
						fingerprint: r["fingerprint"],
						periodStart: typeof r["periodStart"] === "number" ? r["periodStart"] : undefined,
						periodEnd: typeof r["periodEnd"] === "number" ? r["periodEnd"] : undefined,
					});
				}
			} catch {
				// skip
			}
		}
		return out;
	};
	return {
		append(snap) {
			try {
				try { nodeFs.mkdirSync(dir, { recursive: true }); } catch { /* */ }
				const all = parseAll();
				all.push(snap);
				if (all.length > SNAPSHOT_COMPACT_AT) {
					const kept = all.slice(-SNAPSHOT_KEEP);
					const tmp = `${file}.tmp`;
					writeFile(tmp, kept.map((r) => JSON.stringify(r)).join("\n") + "\n");
					rename(tmp, file);
				} else {
					appendFile(file, JSON.stringify(snap) + "\n");
				}
			} catch {
				// best-effort
			}
		},
		load() {
			return parseAll().slice(-SNAPSHOT_KEEP);
		},
	};
}

export type BillingResult =
	| { status: "ok"; snapshot: UsageSnapshot }
	| { status: "retry"; retryAfterMs: number }
	| { status: "error"; message: string; code?: UsageError["code"] };

export interface BillingClientLike {
	fetchUsage(token: string, signal?: AbortSignal): Promise<BillingResult>;
	resetBreaker(): void;
}

const RETRY_AFTER_CAP_MS = 15 * 60_000;

function parseRetryAfter(value: string | null, now: number): number {
	let ms = 60_000;
	if (value !== null) {
		const seconds = Number(value);
		if (Number.isFinite(seconds) && seconds >= 0) ms = seconds * 1000;
		else {
			const date = Date.parse(value);
			if (!Number.isNaN(date)) ms = Math.max(0, date - now);
		}
	}
	return Math.min(ms, RETRY_AFTER_CAP_MS);
}

function redact(message: string, secrets: string[]): string {
	let out = message;
	for (const s of secrets) {
		if (s && s.length > 3) out = out.split(s).join("<redacted>");
	}
	return out;
}

async function readBoundedBody(response: Response, maxBytes: number, signal: AbortSignal): Promise<string> {
	if (!response.body) return "";
	const reader = response.body.getReader();
	const decoder = new TextDecoder("utf-8");
	let bytes = 0;
	let text = "";
	try {
		while (true) {
			if (signal.aborted) throw new UsageError("timeout", ERR_TIMEOUT);
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > maxBytes) {
				try { void reader.cancel(); } catch { /* */ }
				throw new UsageError("parse", ERR_PARSE);
			}
			text += decoder.decode(value, { stream: true });
		}
		return text + decoder.decode();
	} finally {
		try { reader.releaseLock(); } catch { /* */ }
	}
}

export function createBillingClient(deps: { fetchImpl: typeof fetch; timeoutMs?: number; nowFn?: () => number }): BillingClientLike {
	const timeoutMs = deps.timeoutMs ?? PAIR_TIMEOUT_MS;
	const now = () => (deps.nowFn ?? Date.now)();
	let consecutiveAuthFailures = 0;
	let breakerOpen = false;
	const identityCache = new Map<string, { userId: string; tier?: string }>();

	function tokenKey(token: string): string {
		return createHash("sha256").update(token).digest("hex").slice(0, 16);
	}

	async function requestJson(url: string, token: string, extra: Record<string, string>, signal: AbortSignal): Promise<{ status: number; body: unknown; retryAfter: string | null }> {
		const headers: Record<string, string> = {
			Authorization: `Bearer ${token}`,
			"X-XAI-Token-Auth": "xai-grok-cli",
			"x-grok-client-version": GROK_CLIENT_VERSION,
			"x-grok-client-mode": "interactive",
			Accept: "application/json",
			...extra,
		};
		let res: Response;
		try {
			res = await deps.fetchImpl(url, { method: "GET", redirect: "error", headers, signal });
		} catch (err) {
			const name = err instanceof Error ? err.name : "";
			if (name === "TimeoutError" || name === "AbortError") throw new UsageError("timeout", ERR_TIMEOUT);
			throw new UsageError("parse", ERR_PARSE);
		}
		if (res.status === 429 || res.status >= 500) {
			void res.body?.cancel().catch(() => undefined);
			return { status: res.status, body: null, retryAfter: res.headers.get("retry-after") };
		}
		if (!res.ok) {
			let errText = "";
			try { errText = await readBoundedBody(res, 4096, signal); } catch { errText = ""; }
			void errText;
			if (res.status === 401 || res.status === 403) {
				throw new UsageError(res.status === 401 ? "auth" : "entitlement", res.status === 401 ? ERR_AUTH : ERR_ENTITLEMENT, res.status);
			}
			throw new UsageError("http", ERR_PARSE, res.status);
		}
		const text = await readBoundedBody(res, MAX_BODY_BYTES, signal);
		let body: unknown;
		try {
			body = JSON.parse(text);
		} catch {
			throw new UsageError("parse", ERR_PARSE);
		}
		return { status: res.status, body, retryAfter: null };
	}

	async function fetchUsage(token: string, outer?: AbortSignal): Promise<BillingResult> {
		if (breakerOpen) return { status: "error", message: ERR_AUTH, code: "auth" };
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		const forward = () => controller.abort();
		outer?.addEventListener("abort", forward, { once: true });
		if (outer?.aborted) controller.abort();
		const secrets = [token];
		try {
			const tk = tokenKey(token);
			let ident = identityCache.get(tk);
			if (!ident) {
				const userRes = await requestJson(XAI_USER_URL, token, {}, controller.signal);
				if (userRes.status === 429 || userRes.status >= 500) {
					return { status: "retry", retryAfterMs: parseRetryAfter(userRes.retryAfter, now()) };
				}
				const userId = parseUserId(userRes.body);
				secrets.push(userId);
				ident = { userId, tier: parseSubscriptionTier(userRes.body) };
				identityCache.set(tk, ident);
			}
			secrets.push(ident.userId);
			const billRes = await requestJson(XAI_BILLING_URL, token, { "x-userid": ident.userId }, controller.signal);
			if (billRes.status === 429 || billRes.status >= 500) {
				return { status: "retry", retryAfterMs: parseRetryAfter(billRes.retryAfter, now()) };
			}
			const snapshot = parseUsage(billRes.body, ident.userId, ident.tier);
			consecutiveAuthFailures = 0;
			return { status: "ok", snapshot };
		} catch (err) {
			if (err instanceof UsageError) {
				if (err.code === "timeout") return { status: "error", message: ERR_TIMEOUT, code: "timeout" };
				if (err.code === "auth") {
					identityCache.clear();
					consecutiveAuthFailures += 1;
					if (consecutiveAuthFailures >= 2) breakerOpen = true;
					return { status: "error", message: redact(err.message, secrets), code: "auth" };
				}
				if (err.code === "entitlement") {
					return { status: "error", message: ERR_ENTITLEMENT, code: "entitlement" };
				}
				if (err.code === "identity") {
					identityCache.clear();
					return { status: "error", message: ERR_IDENTITY, code: "identity" };
				}
				return { status: "error", message: redact(err.message, secrets), code: err.code };
			}
			return { status: "error", message: ERR_PARSE };
		} finally {
			clearTimeout(timer);
			outer?.removeEventListener("abort", forward);
		}
	}

	return {
		fetchUsage,
		resetBreaker() {
			breakerOpen = false;
			consecutiveAuthFailures = 0;
		},
	};
}

export function buildReportText(snapshot: UsageSnapshot, opts: { now: number; lang?: Lang }): string {
	const lang = opts.lang ?? "en";
	const lines: string[] = [];
	if (snapshot.tier) lines.push(snapshot.tier);
	const pct = displayPercent(snapshot.percentage);
	const periodName = snapshot.period === "weekly" ? msg(lang, "periodWeekly") : snapshot.period === "monthly" ? msg(lang, "periodMonthly") : msg(lang, "periodUnknown");
	const pctBit = pct === null ? (lang === "zh" ? "未知" : "unknown") : `${pct}% ${msg(lang, "used")}`;
	const reset = formatReset(snapshot.resetAt, opts.now);
	lines.push(`  ${msg(lang, "segIncluded")}  ${periodName}  ${pctBit}${reset ? `   ${msg(lang, "resetsIn", { t: reset })}` : ""}`);
	if (snapshot.onDemandUsedUsd !== undefined || snapshot.onDemandCapUsd !== undefined) {
		const used = snapshot.onDemandUsedUsd !== undefined ? `$${snapshot.onDemandUsedUsd.toFixed(2)}` : "?";
		const cap = snapshot.onDemandCapUsd !== undefined ? `$${snapshot.onDemandCapUsd.toFixed(2)}` : "?";
		lines.push(`  ${msg(lang, "segOnDemand")}  ${used} / ${cap}`);
	}
	if (snapshot.prepaidUsd !== undefined) {
		lines.push(`  ${msg(lang, "segPrepaid")}  $${snapshot.prepaidUsd.toFixed(2)}`);
	}
	return lines.join("\n");
}

export function toJsonPayload(snapshot: UsageSnapshot): unknown {
	return {
		schema: 1,
		provider: PROVIDER_ID,
		tier: snapshot.tier ?? null,
		included: {
			percentage: snapshot.percentage,
			period: snapshot.period,
			resetAt: snapshot.resetAt ?? null,
		},
		onDemand: {
			usedUsd: snapshot.onDemandUsedUsd ?? null,
			capUsd: snapshot.onDemandCapUsd ?? null,
		},
		prepaidUsd: snapshot.prepaidUsd ?? null,
	};
}

export type AuthResolution =
	| { status: "oauth"; token: string }
	| { status: "api-key" }
	| { status: "none" }
	| { status: "bad-origin" }
	| { status: "auth-error" };

export interface UiLike {
	setStatus(key: string, text?: string): void;
	notify(message: string, level?: string): void;
	theme: FooterTheme;
	custom?(
		factory: (tui: unknown, theme: FooterTheme, kb: KeyLike, done: (value: unknown) => void) => OverlayComponent,
		options?: { overlay?: boolean; overlayOptions?: { maxHeight?: number | `${number}%` } },
	): Promise<unknown>;
}

interface CtxLike {
	mode?: string;
	hasUI?: boolean;
	ui: UiLike;
	model?: { provider?: string; id?: string; baseUrl?: string };
	modelRegistry?: {
		isUsingOAuth?(model: unknown): boolean;
		getProvider?(id: string): { auth?: { oauth?: { isSubscription?: boolean } } } | undefined;
		getProviderAuth?(id: string): Promise<{ auth?: { apiKey?: string; headers?: Record<string, string>; baseUrl?: string } } | undefined>;
		getProviderAuthStatus?(id: string): { configured?: boolean };
	};
	sessionManager?: { getEntries?: () => unknown[] };
	signal?: AbortSignal;
}

function tokenFromAuthResult(resolution: unknown): string | null {
	if (!resolution || typeof resolution !== "object") return null;
	const value = resolution as Record<string, unknown>;
	const nested = value["auth"];
	const auth = nested && typeof nested === "object" ? (nested as Record<string, unknown>) : value;
	if (typeof auth["apiKey"] === "string" && auth["apiKey"]) return auth["apiKey"];
	const headers = auth["headers"];
	const authorization =
		headers && typeof headers === "object" && typeof (headers as Record<string, unknown>)["Authorization"] === "string"
			? ((headers as Record<string, unknown>)["Authorization"] as string)
			: "";
	return authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() || null : null;
}

/** Always classify against provider `xai`, never against the active model's provider. */
export function classifyXaiAuth(ctx: CtxLike, opts: { requireActiveModel: boolean }): Exclude<AuthResolution, { status: "oauth"; token: string }> | { status: "oauth" } {
	if (isXaiProvider(ctx.model?.provider) && !officialModelOrigin(ctx.model?.baseUrl)) {
		return { status: "bad-origin" };
	}
	if (opts.requireActiveModel) {
		if (!isXaiProvider(ctx.model?.provider)) return { status: "none" };
	}
	const registry = ctx.modelRegistry;
	let usingOAuth = false;
	try {
		if (typeof registry?.isUsingOAuth === "function") {
			usingOAuth = registry.isUsingOAuth({ provider: PROVIDER_ID }) === true;
		}
	} catch {
		usingOAuth = false;
	}
	if (usingOAuth) return { status: "oauth" };
	let configured = false;
	try {
		configured = registry?.getProviderAuthStatus?.(PROVIDER_ID)?.configured === true;
	} catch {
		configured = false;
	}
	return configured ? { status: "api-key" } : { status: "none" };
}

export async function resolveXaiAuth(ctx: CtxLike, opts: { requireActiveModel: boolean; wantToken?: boolean }): Promise<AuthResolution> {
	const classified = classifyXaiAuth(ctx, opts);
	if (classified.status !== "oauth") return classified;
	if (opts.wantToken === false) return { status: "oauth", token: "" };
	try {
		const resolved = await ctx.modelRegistry?.getProviderAuth?.(PROVIDER_ID);
		const token = tokenFromAuthResult(resolved);
		if (!token) return { status: "auth-error" };
		return { status: "oauth", token };
	} catch {
		return { status: "auth-error" };
	}
}

export interface AlertStore {
	save(state: AlertState): void;
	load(): AlertState | null;
}

export interface ExtensionDeps {
	env?: Record<string, string | undefined>;
	nowFn?(): number;
	interactive?: boolean;
	setInterval?: typeof setInterval;
	clearInterval?: typeof clearInterval;
	billingClientFor(): BillingClientLike;
	authFor(ctx: CtxLike, opts: { requireActiveModel: boolean; wantToken?: boolean }): Promise<AuthResolution>;
	snapshotStore?: QuotaSnapshotStore;
	alertStore?: AlertStore;
}

export function createExtension(deps: ExtensionDeps) {
	const now = () => (deps.nowFn ?? Date.now)();
	const setIntervalImpl = deps.setInterval ?? setInterval;
	const clearIntervalImpl = deps.clearInterval ?? clearInterval;
	const isInteractive = (ctx: CtxLike) =>
		deps.interactive ?? (ctx.mode === "tui" || ctx.hasUI === true);
	return function install(pi: ExtensionAPI): void {
		let generation = 0;
		const lang = resolveLang(deps.env ?? {});
		const warnedNeedOAuth = { v: false };
		const warnedNoKey = { v: false };
		const warnedAuth = { v: false };

		let active = false;
		let billingUnavailable = false;
		let snapshot: UsageSnapshot | null = null;
		let stale = false;
		let lastFetchAt = Number.NEGATIVE_INFINITY;
		let nextAllowedAt = 0;
		let retryDeadline = 0;
		let inFlight = false;
		let timer: ReturnType<typeof setIntervalImpl> | null = null;
		let timerRunning = false;
		let lastUi: UiLike | null = null;
		let alertState: AlertState | null = null;
		const store: QuotaSnapshotStore = deps.snapshotStore ?? { append() {}, load: () => [] };
		let snaps: QuotaSnapshot[] = store.load();

		const alertStore: AlertStore =
			deps.alertStore ?? {
				save: (s) => {
					try {
						(pi as { appendEntry?: (type: string, data: unknown) => void }).appendEntry?.(ALERT_ENTRY_TYPE, s);
					} catch {
						// best-effort
					}
				},
				load: () => null,
			};

		function throttleMs(): number {
			const pct = snapshot?.percentage;
			return pct !== null && pct !== undefined && pct >= 80 ? THROTTLE_HIGH_USAGE_MS : THROTTLE_MS;
		}

		function clearTimer(): void {
			if (timer !== null) {
				clearIntervalImpl(timer as never);
				timer = null;
			}
			timerRunning = false;
		}

		function maybeStartTimer(ctx: CtxLike): void {
			lastUi = ctx.ui;
			if (!isInteractive(ctx) || !active || timerRunning) return;
			const resetAt = snapshot?.resetAt;
			if (resetAt === undefined || resetAt - now() >= COUNTDOWN_HORIZON_MS) return;
			timerRunning = true;
			timer = setIntervalImpl(() => {
				if (lastUi && snapshot !== null && active) {
					const remain = snapshot.resetAt !== undefined ? snapshot.resetAt - now() : Infinity;
					if (remain >= COUNTDOWN_HORIZON_MS) {
						clearTimer();
						render(lastUi);
						return;
					}
					render(lastUi);
				}
			}, COUNTDOWN_TICK_MS);
			timer?.unref?.();
		}

		function render(ui: UiLike): void {
			if (!active) {
				ui.setStatus(STATUS_KEY, undefined);
				return;
			}
			if (snapshot === null) {
				ui.setStatus(STATUS_KEY, ui.theme.fg("dim", "xAI …"));
				return;
			}
			ui.setStatus(STATUS_KEY, renderFooter(snapshot, { now: now(), stale, theme: ui.theme, snaps }));
		}

		function refresh(ctx: CtxLike, force: boolean): void {
			lastUi = ctx.ui;
			if (!isInteractive(ctx) || !active || inFlight) return;
			if (now() < retryDeadline) return;
			if (!force && now() < nextAllowedAt) return;
			inFlight = true;
			lastFetchAt = now();
			nextAllowedAt = Math.max(nextAllowedAt, lastFetchAt + throttleMs());
			const gen = generation;
			const ui = ctx.ui;
			void (async () => {
				try {
					const auth = await deps.authFor(ctx, { requireActiveModel: true, wantToken: true });
					if (gen !== generation) return;
					if (auth.status !== "oauth") {
						active = false;
						if (auth.status === "api-key") {
							if (!warnedNeedOAuth.v) {
								warnedNeedOAuth.v = true;
								ui.notify(msg(lang, "needOAuth"), "warning");
							}
							ui.setStatus(STATUS_KEY, ui.theme.fg("dim", "xAI need OAuth"));
						} else if (auth.status === "bad-origin") {
							ui.setStatus(STATUS_KEY, undefined);
						} else if (auth.status === "auth-error") {
							ui.setStatus(STATUS_KEY, ui.theme.fg("error", "xAI auth error"));
						} else if (snapshot !== null) {
							stale = true;
							render(ui);
						} else {
							ui.setStatus(STATUS_KEY, ui.theme.fg("dim", "xAI no key"));
						}
						return;
					}
					const res = await deps.billingClientFor().fetchUsage(auth.token);
					if (gen !== generation) return;
					if (res.status === "ok") {
						retryDeadline = 0;
						snapshot = res.snapshot;
						stale = false;
						if (res.snapshot.percentage !== null) {
							const row: QuotaSnapshot = {
								t: now(),
								percentage: res.snapshot.percentage,
								fingerprint: res.snapshot.fingerprint,
								periodStart: res.snapshot.periodStart,
								periodEnd: res.snapshot.resetAt,
							};
							snaps.push(row);
							snaps = snaps.slice(-SNAPSHOT_KEEP);
							store.append(row);
						}
						nextAllowedAt = Math.max(retryDeadline, Math.min(nextAllowedAt, Math.max(now(), lastFetchAt + throttleMs())));
						const alerts = evaluateAlerts(alertState, res.snapshot);
						alertState = alerts.state;
						if (alerts.emitted.length > 0) alertStore.save(alertState);
						for (const e of alerts.emitted) {
							ui.notify(msg(lang, "alertCrossed", { pct: String(e.pct), tier: String(e.tier) }), e.tier === 95 ? "error" : "warning");
						}
					} else if (res.status === "retry") {
						retryDeadline = Math.max(retryDeadline, now() + res.retryAfterMs);
						nextAllowedAt = Math.max(nextAllowedAt, retryDeadline);
						if (snapshot !== null) stale = true;
					} else if (res.code === "entitlement") {
						billingUnavailable = true;
						active = false;
						ui.notify(msg(lang, "entitlement"), "warning");
						ui.setStatus(STATUS_KEY, ui.theme.fg("dim", "xAI no billing"));
						return;
					} else if (res.code === "auth") {
						if (!warnedAuth.v) {
							warnedAuth.v = true;
							ui.notify(msg(lang, "fetchFailed"), "error");
						}
						if (snapshot !== null) stale = true;
						else ui.setStatus(STATUS_KEY, ui.theme.fg("error", "xAI auth error"));
						return snapshot !== null ? render(ui) : undefined;
					} else if (snapshot !== null) {
						stale = true;
					}
					render(ui);
				} catch {
					if (gen !== generation) return;
					if (snapshot !== null) stale = true;
					render(ui);
				} finally {
					inFlight = false;
				}
			})();
		}

		async function activate(ctx: CtxLike, fromSelect: boolean): Promise<void> {
			lastUi = ctx.ui;
			void fromSelect;
			if (!isXaiProvider(ctx.model?.provider)) {
				active = false;
				snapshot = null;
				stale = false;
				clearTimer();
				ctx.ui.setStatus(STATUS_KEY, undefined);
				return;
			}
			if (!officialModelOrigin(ctx.model?.baseUrl)) {
				active = false;
				snapshot = null;
				clearTimer();
				ctx.ui.setStatus(STATUS_KEY, undefined);
				return;
			}
			if (billingUnavailable) {
				active = false;
				ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", "xAI no billing"));
				return;
			}
			const auth = await deps.authFor(ctx, { requireActiveModel: true, wantToken: false });
			if (auth.status === "bad-origin") {
				active = false;
				ctx.ui.setStatus(STATUS_KEY, undefined);
				return;
			}
			if (auth.status === "api-key") {
				active = false;
				if (!warnedNeedOAuth.v) {
					warnedNeedOAuth.v = true;
					ctx.ui.notify(msg(lang, "needOAuth"), "warning");
				}
				ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", "xAI need OAuth"));
				return;
			}
			if (auth.status === "none") {
				active = false;
				if (!warnedNoKey.v) {
					warnedNoKey.v = true;
					ctx.ui.notify(msg(lang, "noKey"), "warning");
				}
				ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", "xAI no key"));
				return;
			}
			if (auth.status === "auth-error") {
				active = false;
				ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("error", "xAI auth error"));
				return;
			}
			active = true;
			deps.billingClientFor().resetBreaker();
			if (!isInteractive(ctx)) return;
			render(ctx.ui);
			refresh(ctx, true);
		}

		async function showOverlay(text: string, ctx: CtxLike): Promise<void> {
			await ctx.ui.custom?.(
				(tui: unknown, theme: FooterTheme, kb: KeyLike, done: (value: unknown) => void) => {
					const rowGen = () => (tui as { terminal?: { rows?: number } }).terminal?.rows ?? 24;
					return createOverlayComponent({
						header: msg(lang, "reportTitle"),
						body: text.split("\n"),
						footer: msg(lang, "pressClose"),
						theme,
						kb,
						done,
						rowGen,
						lang,
					});
				},
				{ overlay: true, overlayOptions: { maxHeight: "80%" } },
			);
		}

		pi.on("session_start", async (_event, ctx) => {
			try {
				const entries = (ctx as CtxLike).sessionManager?.getEntries?.() ?? [];
				for (let i = entries.length - 1; i >= 0; i -= 1) {
					const e = entries[i] as { type?: string; customType?: string; data?: unknown };
					if (e.type === "custom" && e.customType === ALERT_ENTRY_TYPE && e.data && typeof e.data === "object") {
						alertState = e.data as AlertState;
						break;
					}
				}
			} catch {
				alertState = null;
			}
			const loaded = alertStore.load();
			if (loaded) alertState = loaded;
			if (!isInteractive(ctx as CtxLike)) return;
			await activate(ctx as CtxLike, false);
		});

		pi.on("model_select", async (event, ctx) => {
			generation += 1;
			billingUnavailable = false;
			if (!isInteractive(ctx as CtxLike)) return;
			await activate({ ...(ctx as CtxLike), model: event.model }, true);
		});

		pi.on("turn_end", async (_event, ctx) => {
			const c = ctx as CtxLike;
			if (!isInteractive(c)) return;
			if (!isXaiProvider(c.model?.provider)) {
				if (active) {
					active = false;
					c.ui.setStatus(STATUS_KEY, undefined);
				}
				return;
			}
			if (!active) {
				await activate(c, false);
				return;
			}
			refresh(c, false);
		});

		pi.on("after_provider_response", async (event, ctx) => {
			const c = ctx as CtxLike;
			if (!isInteractive(c) || !isXaiProvider(c.model?.provider) || !active) return;
			if (event.status === 429) {
				const ra = event.headers?.["retry-after"] ?? event.headers?.["Retry-After"];
				const wait = parseRetryAfter(typeof ra === "string" ? ra : null, now());
				retryDeadline = Math.max(retryDeadline, now() + wait);
				nextAllowedAt = Math.max(nextAllowedAt, retryDeadline);
			}
			refresh(c, false);
		});

		pi.on("agent_start", async (_event, ctx) => {
			maybeStartTimer(ctx as CtxLike);
		});

		pi.on("agent_end", async () => {
			clearTimer();
		});

		pi.on("session_shutdown", async () => {
			generation += 1;
			clearTimer();
		});

		pi.registerCommand("xai-usage", {
			description: "Show xAI SuperGrok usage (add --json for raw output)",
			handler: async (args: string, ctxRaw: unknown) => {
				const ctx = ctxRaw as CtxLike;
				const auth = await deps.authFor(ctx, { requireActiveModel: false, wantToken: true });
				if (auth.status === "api-key") {
					ctx.ui.notify(msg(lang, "needOAuth"), "error");
					return;
				}
				if (auth.status === "bad-origin") {
					ctx.ui.notify(msg(lang, "fetchFailed"), "error");
					return;
				}
				if (auth.status !== "oauth") {
					ctx.ui.notify(msg(lang, "noKey"), "error");
					return;
				}
				if (now() < retryDeadline) {
					ctx.ui.notify(msg(lang, "rateLimited"), "error");
					return;
				}
				const res = await deps.billingClientFor().fetchUsage(auth.token, ctx.signal);
				if (res.status !== "ok") {
					ctx.ui.notify(
						res.status === "retry" ? msg(lang, "rateLimited") : res.message ?? msg(lang, "fetchFailed"),
						"error",
					);
					return;
				}
				if (active && isXaiProvider(ctx.model?.provider)) {
					snapshot = res.snapshot;
					stale = false;
					render(ctx.ui);
				}
				const wantJson = args.includes("--json");
				if (wantJson) {
					const payload = JSON.stringify(toJsonPayload(res.snapshot), null, 2);
					if (ctx.mode === "tui") {
						await showOverlay(payload, ctx);
					} else if (ctx.mode === "print") {
						console.log(payload);
					} else {
						ctx.ui.notify(msg(lang, "jsonModeRestricted"), "warning");
					}
					return;
				}
				const text = buildReportText(res.snapshot, { now: now(), lang });
				if (ctx.mode === "tui") {
					await showOverlay(text, ctx);
				} else {
					const pct = displayPercent(res.snapshot.percentage);
					ctx.ui.notify(msg(lang, "reportSummary", { pct: pct === null ? "?" : String(pct) }), "info");
				}
			},
		});
	};
}

export default function xaiUsage(pi: ExtensionAPI): void {
	const env = process.env as Record<string, string | undefined>;
	const homedir = nodeOs.homedir();
	const store = createQuotaSnapshotStore(
		piAgentDir(env, homedir),
		(p) => {
			try { return nodeFs.readFileSync(p, "utf8"); } catch { return null; }
		},
		(p, s) => { try { nodeFs.appendFileSync(p, s); } catch { /* */ } },
		(p, s) => { try { nodeFs.writeFileSync(p, s); } catch { /* */ } },
		(from, to) => { try { nodeFs.renameSync(from, to); } catch { /* */ } },
	);
	const client = createBillingClient({ fetchImpl: fetch });
	createExtension({
		env,
		billingClientFor: () => client,
		authFor: (ctx, opts) => resolveXaiAuth(ctx, opts),
		snapshotStore: store,
	})(pi);
}
