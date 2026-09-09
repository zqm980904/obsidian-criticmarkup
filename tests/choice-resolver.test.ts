import { type ChangeSpec } from "@codemirror/state";

import { DEFAULT_SETTINGS } from "../src/constants";
import {
	findChoiceSite,
	findChoiceSites,
	isChoiceComment,
	parseChoiceComment,
	resolveChoice,
} from "../src/editor/base/edit-logic/resolve-choice";
import { getRangesInText } from "../src/editor/base/edit-util/range-parser";
import { CriticMarkupRanges, SuggestionType } from "../src/editor/base/ranges";

const SAMPLE =
	"Intro {~~the model shows~>the results indicate~~}{>>pick: (a) the results indicate | (b) we find | (c) ____\nreason: hedge less<<} middle {++x++}{>>plain<<} {==span==}{>>pick: alpha | beta<<} {>>pick: orphan | thread<<} end";

function parse(text: string, settings = DEFAULT_SETTINGS) {
	return new CriticMarkupRanges(getRangesInText(text, settings));
}

function applyChange(text: string, change: ChangeSpec) {
	const spec = change as { from: number; to: number; insert: string };
	return text.slice(0, spec.from) + spec.insert + text.slice(spec.to);
}

describe("parseChoiceComment", () => {
	test("labelled options + blank + note", () => {
		const spec = parseChoiceComment(
			"pick: (a) the results indicate | (b) we find | (c) ____\nreason: hedge less",
		);
		expect(spec).toEqual({
			options: [
				{ label: "a", text: "the results indicate", blank: false },
				{ label: "b", text: "we find", blank: false },
				{ label: "c", text: "", blank: true },
			],
			note: "reason: hedge less",
		});
	});

	test("unlabelled options", () => {
		expect(parseChoiceComment("pick: alpha | beta")).toEqual({
			options: [
				{ text: "alpha", blank: false },
				{ text: "beta", blank: false },
			],
		});
	});

	test("case-insensitive PICK:", () => {
		expect(parseChoiceComment("PICK: one | two")).toEqual({
			options: [
				{ text: "one", blank: false },
				{ text: "two", blank: false },
			],
		});
	});

	test("ordinary comment → null", () => {
		expect(parseChoiceComment("just a regular comment")).toBeNull();
	});

	test("pick: with no options → null", () => {
		expect(parseChoiceComment("pick:")).toBeNull();
		expect(parseChoiceComment("pick:   ")).toBeNull();
		expect(parseChoiceComment("pick: | |")).toBeNull();
	});
});

describe("findChoiceSites", () => {
	const ranges = parse(SAMPLE);
	const sites = findChoiceSites(ranges);

	test("exactly two sites: substitution then highlight", () => {
		expect(sites).toHaveLength(2);
		expect(sites[0].host.type).toBe(SuggestionType.SUBSTITUTION);
		expect(sites[1].host.type).toBe(SuggestionType.HIGHLIGHT);
		expect(sites[0].host.from).toBeLessThan(sites[1].host.from);
	});

	test("substitution original/suggested and spec", () => {
		expect(sites[0].original).toBe("the model shows");
		expect(sites[0].suggested).toBe("the results indicate");
		expect(sites[0].spec).toEqual({
			options: [
				{ label: "a", text: "the results indicate", blank: false },
				{ label: "b", text: "we find", blank: false },
				{ label: "c", text: "", blank: true },
			],
			note: "reason: hedge less",
		});
	});

	test("highlight original and spec; no suggested", () => {
		expect(sites[1].original).toBe("span");
		expect(sites[1].suggested).toBeUndefined();
		expect(sites[1].spec.options).toEqual([
			{ text: "alpha", blank: false },
			{ text: "beta", blank: false },
		]);
	});

	test("standalone pick: comment thread is not a site", () => {
		const orphan = ranges.ranges.find(range =>
			range.type === SuggestionType.COMMENT && range.unwrap().startsWith("pick: orphan")
		);
		expect(orphan).toBeDefined();
		expect(isChoiceComment(orphan!)).toBe(true);
		expect(findChoiceSite(orphan!)).toBeNull();
	});

	test("{++x++} with plain comment is not a site", () => {
		const addition = ranges.ranges.find(range => range.type === SuggestionType.ADDITION);
		expect(addition).toBeDefined();
		expect(findChoiceSite(addition!)).toBeNull();
		expect(addition!.replies).toHaveLength(1);
		expect(isChoiceComment(addition!.replies[0])).toBe(false);
	});

	test("findChoiceSite resolves from host or reply", () => {
		expect(findChoiceSite(sites[0].host)?.comment.from).toBe(sites[0].comment.from);
		expect(findChoiceSite(sites[0].comment)?.comment.from).toBe(sites[0].comment.from);
	});
});

describe("resolveChoice", () => {
	const ranges = parse(SAMPLE);
	const sites = findChoiceSites(ranges);
	const substitution = sites[0];
	const highlight = sites[1];

	test("pick option (b) replaces substitution + comment with we find", () => {
		const option_b = substitution.spec.options.find(option => option.label === "b")!;
		const result = applyChange(SAMPLE, resolveChoice(substitution, { kind: "text", text: option_b.text }));
		expect(result).toBe(
			"Intro we find middle {++x++}{>>plain<<} {==span==}{>>pick: alpha | beta<<} {>>pick: orphan | thread<<} end",
		);
		expect(result).toContain("{++x++}{>>plain<<}");
	});

	test("custom text replaces the substitution thread", () => {
		const result = applyChange(SAMPLE, resolveChoice(substitution, { kind: "text", text: "we conclude" }));
		expect(result).toBe(
			"Intro we conclude middle {++x++}{>>plain<<} {==span==}{>>pick: alpha | beta<<} {>>pick: orphan | thread<<} end",
		);
	});

	test("reject on substitution restores original", () => {
		const result = applyChange(SAMPLE, resolveChoice(substitution, { kind: "reject" }));
		expect(result).toBe(
			"Intro the model shows middle {++x++}{>>plain<<} {==span==}{>>pick: alpha | beta<<} {>>pick: orphan | thread<<} end",
		);
	});

	test("reject on highlight restores unwrapped text", () => {
		const result = applyChange(SAMPLE, resolveChoice(highlight, { kind: "reject" }));
		expect(result).toBe(
			"Intro {~~the model shows~>the results indicate~~}{>>pick: (a) the results indicate | (b) we find | (c) ____\nreason: hedge less<<} middle {++x++}{>>plain<<} span {>>pick: orphan | thread<<} end",
		);
	});
});

describe("choice comments with metadata", () => {
	const text = `{~~{"author":"x"}@@old~>new~~}{>>{"author":"y"}@@pick: p | q<<}`;
	const ranges = parse(text, { ...DEFAULT_SETTINGS, enable_metadata: true });
	const sites = findChoiceSites(ranges);

	test("parses substitution site through metadata", () => {
		expect(sites).toHaveLength(1);
		expect(sites[0].original).toBe("old");
		expect(sites[0].suggested).toBe("new");
		expect(sites[0].spec.options.map(option => option.text)).toEqual(["p", "q"]);
	});

	test("resolving with q removes all markup", () => {
		const result = applyChange(text, resolveChoice(sites[0], { kind: "text", text: "q" }));
		expect(result).toBe("q");
	});
});
