import assert from "node:assert/strict";
import { test } from "node:test";
import { createExtension, STATUS_KEY, type AuthResolution, type BillingResult, type UsageSnapshot } from "../extensions/xai-usage.ts";
import { fakePi, freshCtx } from "./helpers.ts";

const settle = () => new Promise((r) => setTimeout(r, 20));
const NOW0 = Date.UTC(2026, 7, 27, 4, 0, 0);
const HOUR = 3_600_000;

const snap = (pct = 42.5): UsageSnapshot => ({
	tier: "SuperGrok",
	percentage: pct,
	period: "weekly",
	resetAt: NOW0 + 2 * HOUR,
	periodStart: NOW0 - 5 * 24 * HOUR,
	onDemandUsedUsd: 3,
	onDemandCapUsd: 50,
	prepaidUsd: 12.5,
	fingerprint: "abcdabcdabcdabcd",
});

function harness(opts: {
	auth?: AuthResolution;
	queue?: BillingResult[];
	interactive?: boolean;
} = {}) {
	const pi = fakePi();
	let now = NOW0;
	const calls: number[] = [];
	const queue = opts.queue ?? [{ status: "ok", snapshot: snap() }];
	let cursor = 0;
	const auth: AuthResolution = opts.auth ?? { status: "oauth", token: "tok" };
	const appended: unknown[] = [];
	const install = createExtension({
		env: { PI_XAI_USAGE_LANG: "en" },
		nowFn: () => now,
		interactive: opts.interactive ?? true,
		authFor: async () => auth,
		billingClientFor: () => ({
			fetchUsage: async () => {
				calls.push(now);
				const next = queue[Math.min(cursor, queue.length - 1)];
				cursor += 1;
				return next;
			},
			resetBreaker: () => {},
		}),
		snapshotStore: {
			append: (s) => appended.push(s),
			load: () => [],
		},
	});
	install(pi as never);
	return {
		pi,
		calls,
		appended,
		tick: (ms: number) => {
			now += ms;
		},
		start: async (provider?: string, mode = "tui") => {
			const { ctx, log } = freshCtx(mode, provider ? { provider, id: "grok-4.5", baseUrl: "https://api.x.ai/v1" } : undefined);
			await pi.emit("session_start", { reason: "new" }, ctx);
			return log;
		},
		select: async (provider: string, baseUrl = "https://api.x.ai/v1") => {
			const { ctx, log } = freshCtx("tui", { provider, id: "m", baseUrl });
			await pi.emit("model_select", { model: { provider, id: "m", baseUrl }, previousModel: undefined, source: "set" }, ctx);
			return log;
		},
		turnEnd: async (provider = "xai") => {
			const { ctx, log } = freshCtx("tui", { provider, id: "m", baseUrl: "https://api.x.ai/v1" });
			await pi.emit("turn_end", { turnIndex: 0 }, ctx);
			return log;
		},
		after: async (status = 200, provider = "xai") => {
			const { ctx, log } = freshCtx("tui", { provider, id: "m", baseUrl: "https://api.x.ai/v1" });
			await pi.emit("after_provider_response", { status, headers: {} }, ctx);
			return log;
		},
	};
}

test("session_start with xai default model fetches and paints used bar", async () => {
	const h = harness();
	const log = await h.start("xai");
	await settle();
	assert.equal(h.calls.length, 1);
	assert.match(log.status.at(-1)?.text ?? "", /xAI W ███░░░░░ 43%/);
	assert.equal(log.status.at(-1)?.key, STATUS_KEY);
});

test("session_start with non-xai model stays inactive", async () => {
	const h = harness();
	const log = await h.start("anthropic");
	await settle();
	assert.equal(h.calls.length, 0);
	assert.equal(log.status.filter((e) => e.key === STATUS_KEY && e.text).length, 0);
});

test("model_select away from xai clears footer", async () => {
	const h = harness();
	await h.select("xai");
	await settle();
	const off = await h.select("openai");
	assert.equal(off.status.at(-1)?.text, undefined);
});

test("api-key auth: one toast, dim footer, zero fetch", async () => {
	const h = harness({ auth: { status: "api-key" } });
	const log = await h.select("xai");
	await settle();
	assert.equal(h.calls.length, 0);
	assert.equal(log.notifications.filter((n) => /OAuth/.test(n.message)).length, 1);
	assert.match(log.status.at(-1)?.text ?? "", /need OAuth/);
});

test("print mode lifecycle emits no fetch", async () => {
	const h = harness({ interactive: false });
	await h.start("xai", "print");
	await settle();
	assert.equal(h.calls.length, 0);
});

test("turn_end burst inside 180s does not refetch; 80% tightens to 60s", async () => {
	const h = harness({
		queue: [
			{ status: "ok", snapshot: snap(85) },
			{ status: "ok", snapshot: snap(86) },
		],
	});
	await h.select("xai");
	await settle();
	assert.equal(h.calls.length, 1);
	for (let i = 0; i < 3; i++) await h.turnEnd();
	assert.equal(h.calls.length, 1);
	h.tick(61_000);
	await h.turnEnd();
	await settle();
	assert.equal(h.calls.length, 2);
});

test("Retry-After blocks even a command force via refresh deadline on turn_end", async () => {
	const h = harness({
		queue: [
			{ status: "ok", snapshot: snap(10) },
			{ status: "retry", retryAfterMs: 300_000 },
		],
	});
	await h.select("xai");
	await settle();
	h.tick(181_000);
	await h.turnEnd();
	await settle();
	assert.equal(h.calls.length, 2);
	h.tick(10_000);
	await h.turnEnd();
	await settle();
	assert.equal(h.calls.length, 2, "still inside retry deadline");
});

test("failed refresh keeps last value with stale prefix", async () => {
	const h = harness({
		queue: [
			{ status: "ok", snapshot: snap(30) },
			{ status: "error", message: "boom" },
		],
	});
	const first = await h.select("xai");
	await settle();
	assert.match(first.status.at(-1)?.text ?? "", /30%/);
	assert.doesNotMatch(first.status.at(-1)?.text ?? "", /~/);
	h.tick(181_000);
	const after = await h.turnEnd();
	await settle();
	assert.match(after.status.at(-1)?.text ?? "", /~/);
	assert.match(after.status.at(-1)?.text ?? "", /30%/);
});

test("after_provider_response on xai can refresh when throttle allows", async () => {
	const h = harness({
		queue: [
			{ status: "ok", snapshot: snap(10) },
			{ status: "ok", snapshot: snap(11) },
		],
	});
	await h.select("xai");
	await settle();
	h.tick(181_000);
	await h.after(200);
	await settle();
	assert.equal(h.calls.length, 2);
	const other = await h.after(200, "anthropic");
	void other;
	assert.equal(h.calls.length, 2);
});

test("command on non-xai still reports and does not paint footer", async () => {
	const h = harness();
	const { ctx, log } = freshCtx("tui", { provider: "anthropic", id: "s" });
	await h.pi.runCommand("xai-usage", "", ctx);
	await settle();
	assert.equal(h.calls.length, 1);
	assert.equal(log.customCalls, 1);
	assert.equal(log.status.filter((s) => s.key === STATUS_KEY && s.text).length, 0);
});

test("/xai-usage --json in print writes schema 1; rpc refuses stdout", async () => {
	const h = harness();
	const printed: string[] = [];
	const orig = console.log;
	console.log = (s: unknown) => {
		printed.push(String(s));
	};
	try {
		const { ctx } = freshCtx("print", { provider: "xai", id: "g", baseUrl: "https://api.x.ai/v1" });
		await h.pi.runCommand("xai-usage", "--json", ctx);
		assert.match(printed.join("\n"), /"schema": 1/);
		assert.doesNotMatch(printed.join("\n"), /abcdabcd/);
	} finally {
		console.log = orig;
	}
	const { ctx, log } = freshCtx("rpc", { provider: "xai", id: "g", baseUrl: "https://api.x.ai/v1" });
	await h.pi.runCommand("xai-usage", "--json", ctx);
	assert.ok(log.notifications.some((n) => /TUI or print/.test(n.message)));
});

test("entitlement does not refetch every turn", async () => {
	const h = harness({
		queue: [{ status: "error", message: "no billing", code: "entitlement" }],
	});
	await h.select("xai");
	await settle();
	assert.equal(h.calls.length, 1);
	await h.turnEnd();
	await settle();
	assert.equal(h.calls.length, 1);
});

test("proxy origin never fetches", async () => {
	const h = harness();
	const log = await h.select("xai", "https://proxy.example.test/v1");
	await settle();
	assert.equal(h.calls.length, 0);
	assert.equal(log.status.at(-1)?.text, undefined);
});
