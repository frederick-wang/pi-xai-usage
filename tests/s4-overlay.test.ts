import assert from "node:assert/strict";
import { test } from "node:test";
import { createOverlayComponent, visualWidth, wrapLines, clampScrollTop, windowSlice } from "../extensions/xai-usage.ts";
import { stubKb } from "./helpers.ts";

test("visualWidth: ANSI zero-width, CJK double", () => {
	assert.equal(visualWidth("\x1b[31mabc\x1b[0m"), 3);
	assert.equal(visualWidth("余额"), 4);
});

test("wrapLines preserves content", () => {
	assert.deepEqual(wrapLines(["abcdefghij"], 4), ["abcd", "efgh", "ij"]);
});

test("clampScrollTop / windowSlice", () => {
	assert.equal(clampScrollTop(99, 10, 5), 5);
	const w = windowSlice(["a", "b", "c", "d", "e", "f"], 99, 4);
	assert.deepEqual(w.lines, ["c", "d", "e", "f"]);
	assert.equal(w.atEnd, true);
});

test("createOverlayComponent: render returns string[], box closed, width exact", () => {
	const kb = stubKb();
	let done = 0;
	const c = createOverlayComponent({
		header: "xAI Usage Report",
		body: ["SuperGrok", "  Included allowance  Weekly  43% used"],
		footer: "press close",
		theme: { fg: (_r: string, t: string) => t },
		kb,
		done: () => {
			done += 1;
		},
		rowGen: () => 24,
		lang: "en",
	});
	const out = c.render(60);
	assert.ok(Array.isArray(out));
	for (const l of out) assert.ok(!l.includes("\n"));
	assert.match(out[0]!, /^╭/);
	assert.match(out.at(-1)!, /^╰/);
	for (const l of out) assert.equal(visualWidth(l), 60, JSON.stringify(l));
	c.handleInput("\r");
	assert.equal(done, 1);
});

test("overlay closes on Kitty Esc and Ctrl+C", () => {
	const kb = stubKb();
	let done = 0;
	const make = () =>
		createOverlayComponent({
			header: "t",
			body: ["line"],
			footer: "f",
			theme: { fg: (_r, t) => t },
			kb,
			done: () => {
				done += 1;
			},
			rowGen: () => 24,
			lang: "en",
		});
	make().handleInput("\x1b[27u");
	make().handleInput("\x1b[99;5u");
	assert.equal(done, 2);
});

test("overlay height stays within floor(rows * 0.8)", () => {
	const c = createOverlayComponent({
		header: "t",
		body: Array.from({ length: 80 }, (_, i) => `row ${i}`),
		footer: "press close",
		theme: { fg: (_r, t) => t },
		kb: stubKb(),
		done: () => {},
		rowGen: () => 20,
		lang: "en",
	});
	const out = c.render(40);
	assert.ok(out.length <= Math.floor(20 * 0.8));
	assert.match(out.at(-1)!, /^╰/);
});
