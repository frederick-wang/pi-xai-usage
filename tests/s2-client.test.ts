import assert from "node:assert/strict";
import { test } from "node:test";
import {
	GROK_CLIENT_VERSION,
	XAI_BILLING_URL,
	XAI_USER_URL,
	createBillingClient,
} from "../extensions/xai-usage.ts";
import { fakeFetch } from "./helpers.ts";

const USER = { userId: "fixture-user-0001", subscriptionTier: "SuperGrok" };
const BILLING = {
	config: {
		creditUsagePercent: 42.5,
		currentPeriod: {
			type: "USAGE_PERIOD_TYPE_WEEKLY",
			start: "2026-06-01T00:00:00Z",
			end: "2026-06-08T00:00:00Z",
		},
	},
};

test("identity then billing; x-userid only on billing; required headers present", async () => {
	const { fetch, requests } = fakeFetch([
		{ status: 200, body: USER },
		{ status: 200, body: BILLING },
	]);
	const client = createBillingClient({ fetchImpl: fetch });
	const res = await client.fetchUsage("oauth-access");
	assert.equal(res.status, "ok");
	if (res.status === "ok") assert.equal(res.snapshot.percentage, 42.5);
	assert.deepEqual(requests.map((r) => r.url), [XAI_USER_URL, XAI_BILLING_URL]);
	assert.equal(requests[0].headers["x-userid"], undefined);
	assert.equal(requests[0].headers["X-XAI-Token-Auth"], "xai-grok-cli");
	assert.equal(requests[0].headers["x-grok-client-version"], GROK_CLIENT_VERSION);
	assert.equal(requests[0].headers.Authorization, "Bearer oauth-access");
	assert.equal(requests[1].headers["x-userid"], "fixture-user-0001");
});

test("identity 401 does not call billing; two auth failures open breaker", async () => {
	const { fetch, requests } = fakeFetch([{ status: 401, body: { error: "no" } }]);
	const client = createBillingClient({ fetchImpl: fetch });
	const a = await client.fetchUsage("tok");
	assert.equal(a.status, "error");
	if (a.status === "error") {
		assert.equal(a.code, "auth");
		assert.doesNotMatch(a.message, /tok/);
	}
	assert.equal(requests.length, 1);
	await client.fetchUsage("tok");
	const c = await client.fetchUsage("tok");
	assert.equal(c.status, "error");
	assert.equal(requests.length, 2, "breaker skips the third round");
});

test("identity 403 is entitlement, not breaker", async () => {
	const { fetch } = fakeFetch([{ status: 403, body: {} }]);
	const client = createBillingClient({ fetchImpl: fetch });
	const a = await client.fetchUsage("tok");
	assert.equal(a.status, "error");
	if (a.status === "error") assert.equal(a.code, "entitlement");
	const b = await client.fetchUsage("tok");
	assert.equal(b.status, "error");
	if (b.status === "error") assert.equal(b.code, "entitlement");
});

test("unsafe userId never reaches billing", async () => {
	const { fetch, requests } = fakeFetch([{ status: 200, body: { userId: "bad\nid" } }]);
	const client = createBillingClient({ fetchImpl: fetch });
	const res = await client.fetchUsage("tok");
	assert.equal(res.status, "error");
	if (res.status === "error") assert.equal(res.code, "identity");
	assert.equal(requests.length, 1);
});

test("429 returns retry honoring Retry-After seconds", async () => {
	const { fetch } = fakeFetch([{ status: 429, body: {}, headers: { "retry-after": "12" } }]);
	const client = createBillingClient({ fetchImpl: fetch });
	const res = await client.fetchUsage("tok");
	assert.equal(res.status, "retry");
	if (res.status === "retry") assert.equal(res.retryAfterMs, 12_000);
});

test("error message redacts bearer token and userId", async () => {
	const { fetch } = fakeFetch([
		{ status: 200, body: USER },
		{ status: 401, body: "Bearer oauth-access fixture-user-0001" },
	]);
	const client = createBillingClient({ fetchImpl: fetch });
	const res = await client.fetchUsage("oauth-access");
	assert.equal(res.status, "error");
	if (res.status === "error") {
		assert.doesNotMatch(res.message, /oauth-access/);
		assert.doesNotMatch(res.message, /fixture-user-0001/);
	}
});
