/**
 * Live verification helper (dev only — excluded from the npm file whitelist).
 *
 * Usage: pnpm run live-check
 *
 * Reads the SuperGrok OAuth access token from auth.json (dev probe only) and
 * prints a redacted snapshot. Never prints userId or the token.
 */

import * as nodeFs from "node:fs";
import * as nodeOs from "node:os";
import { accountFingerprint, createBillingClient, piAgentDir } from "../extensions/xai-usage.ts";

const configDir = piAgentDir(process.env as Record<string, string | undefined>, nodeOs.homedir());
const authPath = `${configDir}/auth.json`;
let token: string | undefined;
try {
	const raw = nodeFs.readFileSync(authPath, "utf8");
	const parsed = JSON.parse(raw) as Record<string, { type?: string; access?: string }>;
	const entry = parsed["xai"];
	if (entry?.type === "oauth" && typeof entry.access === "string") token = entry.access;
} catch {
	token = undefined;
}

console.log(`config dir : ${configDir}`);
if (!token) {
	console.log("token      : missing (run /login xai with a subscription)");
	process.exit(1);
}
console.log(`token      : length ${token.length} (not printed)`);
const client = createBillingClient({ fetchImpl: fetch });
const out = await client.fetchUsage(token);
if (out.status === "ok") {
	const s = out.snapshot;
	console.log(`fingerprint: ${s.fingerprint} (sha256 prefix; userId not shown)`);
	console.log(`tier       : ${s.tier ?? "?"}`);
	console.log(`period     : ${s.period}`);
	console.log(`used %     : ${s.percentage ?? "?"}`);
	console.log(`resetAt    : ${s.resetAt ? new Date(s.resetAt).toISOString() : "none"}`);
	console.log(`on-demand  : ${s.onDemandUsedUsd ?? "?"} / ${s.onDemandCapUsd ?? "?"}`);
	console.log(`prepaid    : ${s.prepaidUsd ?? "?"}`);
	void accountFingerprint;
} else if (out.status === "retry") {
	console.log(`quota      : retry after ${out.retryAfterMs} ms`);
} else {
	console.log(`quota      : ${out.message}`);
}
