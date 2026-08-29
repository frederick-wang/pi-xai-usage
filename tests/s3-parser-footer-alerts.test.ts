import assert from "node:assert/strict";
import { test } from "node:test";
import {
	accountFingerprint,
	buildReportText,
	displayPercent,
	estimateQuotaRate,
	evaluateAlerts,
	formatReset,
	parseUsage,
	parseUserId,
	quotaRunwayHours,
	renderFooter,
	toJsonPayload,
	type QuotaSnapshot,
	type UsageSnapshot,
} from "../extensions/xai-usage.ts";

const NOW = Date.UTC(2026, 7, 27, 4, 0, 0);
const HOUR = 3_600_000;
const USER = "fixture-user-0001";
const FP = accountFingerprint(USER);
const identityTheme = { fg: (_r: string, t: string) => t };

const weeklyBilling = {
	config: {
		creditUsagePercent: 42.5,
		currentPeriod: {
			type: "USAGE_PERIOD_TYPE_WEEKLY",
			start: "2026-06-01T00:00:00Z",
			end: "2026-06-08T00:00:00Z",
		},
		onDemandCap: { val: 5000 },
		onDemandUsed: { val: 300 },
		prepaidBalance: { val: 1250 },
	},
	subscriptionTier: "SuperGrok",
};

test("parseUserId accepts conservative tokens and rejects CR/LF", () => {
	assert.equal(parseUserId({ userId: USER }), USER);
	assert.throws(() => parseUserId({ userId: "bad\r\nheader" }));
	assert.throws(() => parseUserId({ userId: "has space" }));
});

test("parseUsage weekly percent, distinct USD fields, sanitized tier", () => {
	const snap = parseUsage(weeklyBilling, USER);
	assert.equal(snap.percentage, 42.5);
	assert.equal(snap.period, "weekly");
	assert.equal(snap.resetAt, Date.parse("2026-06-08T00:00:00Z"));
	assert.equal(snap.onDemandUsedUsd, 3);
	assert.equal(snap.onDemandCapUsd, 50);
	assert.equal(snap.prepaidUsd, 12.5);
	assert.equal(snap.tier, "SuperGrok");
	assert.equal(snap.fingerprint, FP);
	assert.equal(displayPercent(snap.percentage), 43);
});

test("parseUsage legacy monthly cents when percent absent", () => {
	const snap = parseUsage({
		config: {
			monthlyLimit: { val: 2000 },
			used: { val: 1234 },
			billingPeriodEnd: "2025-05-01T00:00:00Z",
		},
	}, USER);
	assert.equal(snap.period, "monthly");
	assert.ok(snap.percentage !== null);
	assert.equal(Math.round(snap.percentage! * 100) / 100, 61.7);
});

test("parseUsage hostile control chars stripped from tier", () => {
	const snap = parseUsage({ config: { creditUsagePercent: 1 }, subscriptionTier: "Super\u0007Grok" }, USER);
	assert.equal(snap.tier, "SuperGrok");
});

test("parseUsage percent out of range throws", () => {
	assert.throws(() => parseUsage({ config: { creditUsagePercent: 101 } }, USER));
});

test("footer: used bar, W label, reset, stale prefix not glued to percent", () => {
	const snap: UsageSnapshot = {
		tier: "SuperGrok",
		percentage: 42.5,
		period: "weekly",
		resetAt: NOW + 2 * HOUR,
		periodStart: NOW - 5 * 24 * HOUR,
		onDemandUsedUsd: 3,
		onDemandCapUsd: 50,
		prepaidUsd: 12.5,
		fingerprint: FP,
	};
	const text = renderFooter(snap, { now: NOW, theme: identityTheme });
	assert.equal(text, "xAI W ███░░░░░ 43% ↻2h 0m");
	const stale = renderFooter(snap, { now: NOW, theme: identityTheme, stale: true });
	assert.equal(stale, "~ xAI W ███░░░░░ 43% ↻2h 0m");
	assert.doesNotMatch(stale, /43%~/);
});

test("footer: unknown period omits W/M; missing percent shows ?", () => {
	const snap: UsageSnapshot = {
		tier: undefined,
		percentage: null,
		period: "unknown",
		resetAt: undefined,
		periodStart: undefined,
		onDemandUsedUsd: undefined,
		onDemandCapUsd: undefined,
		prepaidUsd: undefined,
		fingerprint: FP,
	};
	assert.equal(renderFooter(snap, { now: NOW, theme: identityTheme }), "xAI ░░░░░░░░ ?%");
});

test("formatReset: relative under 24h, weekday within 7d, date beyond", () => {
	assert.equal(formatReset(NOW + 100 * 60 * 1000, NOW), "1h 40m");
	const d = new Date(NOW + 2 * 24 * HOUR + HOUR);
	const expectDay = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
	assert.ok(formatReset(NOW + 2 * 24 * HOUR + HOUR, NOW).startsWith(expectDay));
	assert.match(formatReset(NOW + 12 * 24 * HOUR, NOW), /^[A-Z][a-z]{2}\d{1,2}$/);
	assert.equal(formatReset(NOW - 1000, NOW), "");
});

test("alerts: 97% first observation emits 95 only; jitter does not re-fire; new period re-arms", () => {
	const base: UsageSnapshot = {
		tier: "SuperGrok",
		percentage: 97,
		period: "weekly",
		resetAt: NOW + 7 * 24 * HOUR,
		periodStart: NOW,
		onDemandUsedUsd: undefined,
		onDemandCapUsd: undefined,
		prepaidUsd: undefined,
		fingerprint: FP,
	};
	const s0 = evaluateAlerts(null, base);
	assert.deepEqual(s0.emitted.map((e) => e.tier), [95]);
	const s1 = evaluateAlerts(s0.state, { ...base, percentage: 96 });
	assert.equal(s1.emitted.length, 0);
	const rolled = evaluateAlerts(s1.state, {
		...base,
		percentage: 81,
		periodStart: NOW + 7 * 24 * HOUR,
		resetAt: NOW + 14 * 24 * HOUR,
	});
	assert.deepEqual(rolled.emitted.map((e) => e.tier), [80]);
});

test("alerts: other fingerprint does not inherit", () => {
	const a: UsageSnapshot = {
		tier: undefined,
		percentage: 81,
		period: "weekly",
		resetAt: NOW + HOUR,
		periodStart: NOW,
		onDemandUsedUsd: undefined,
		onDemandCapUsd: undefined,
		prepaidUsd: undefined,
		fingerprint: FP,
	};
	const s0 = evaluateAlerts(null, a);
	assert.equal(s0.emitted.length, 1);
	const other = evaluateAlerts(s0.state, { ...a, fingerprint: accountFingerprint("other-user") });
	assert.equal(other.emitted.length, 1);
});

test("alerts: missing period identity uses 20pt drop to re-arm", () => {
	const a: UsageSnapshot = {
		tier: undefined,
		percentage: 81,
		period: "unknown",
		resetAt: undefined,
		periodStart: undefined,
		onDemandUsedUsd: undefined,
		onDemandCapUsd: undefined,
		prepaidUsd: undefined,
		fingerprint: FP,
	};
	const s0 = evaluateAlerts(null, a);
	assert.equal(s0.emitted.length, 1);
	const s1 = evaluateAlerts(s0.state, { ...a, percentage: 60 });
	assert.equal(s1.emitted.length, 0);
	const s2 = evaluateAlerts(s1.state, { ...a, percentage: 82 });
	assert.equal(s2.emitted.length, 1);
});

test("rate: null without resetAt, 1h span, or across fingerprint/period", () => {
	const snaps: QuotaSnapshot[] = [
		{ t: NOW, percentage: 10, fingerprint: FP, periodStart: 1, periodEnd: 2 },
		{ t: NOW + 10 * 60_000, percentage: 20, fingerprint: FP, periodStart: 1, periodEnd: 2 },
	];
	assert.equal(estimateQuotaRate(snaps, FP, 1, 2), null);
	const long: QuotaSnapshot[] = [
		{ t: NOW, percentage: 10, fingerprint: FP, periodStart: 1, periodEnd: 2 },
		{ t: NOW + HOUR, percentage: 20, fingerprint: FP, periodStart: 1, periodEnd: 2 },
		{ t: NOW + 2 * HOUR, percentage: 30, fingerprint: FP, periodStart: 1, periodEnd: 2 },
	];
	assert.ok(estimateQuotaRate(long, FP, 1, 2)! > 0);
	assert.equal(estimateQuotaRate(long, "other", 1, 2), null);
	assert.equal(estimateQuotaRate(long, FP, 9, 2), null);
	assert.equal(quotaRunwayHours(30, 10), 7);
});

test("json schema 1 uses null not omitted fields; no userId", () => {
	const snap = parseUsage(weeklyBilling, USER);
	const payload = JSON.stringify(toJsonPayload(snap));
	assert.match(payload, /"schema":1/);
	assert.doesNotMatch(payload, /fixture-user/);
	assert.match(payload, /"percentage":42.5/);
});

test("report text lists included and on-demand separately", () => {
	const snap = parseUsage(weeklyBilling, USER);
	const text = buildReportText(snap, { now: Date.parse("2026-06-07T00:00:00Z"), lang: "en" });
	assert.match(text, /SuperGrok/);
	assert.match(text, /Included allowance/);
	assert.match(text, /On-demand/);
	assert.match(text, /Prepaid/);
});
