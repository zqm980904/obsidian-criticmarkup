import { type ChangeSpec, Text } from "@codemirror/state";

import { DEFAULT_SETTINGS } from "../src/constants";
import {
	choiceSpecFromEntry,
	type ChoiceFile,
	type ChoiceSource,
	findChoiceMarker,
	findChoiceSites,
	isChoiceComment,
	markerMatchesSource,
	mergeResolution,
	parseChoiceComment,
	parseChoiceMarker,
	resolveChoice,
	resolveChoiceFilePath,
	resolvedPathFor,
	type ResolvedFile,
	revertResolutionsToSkip,
	uidMarkersIn,
	validateChoiceFile,
} from "../src/editor/base/edit-logic/resolve-choice";
import { getRangesInText } from "../src/editor/base/edit-util/range-parser";
import { CriticMarkupRanges, SuggestionType } from "../src/editor/base/ranges";

const SAMPLE =
	"Intro {~~the model shows~>the results indicate~~}{>>pick: (a) the results indicate | (b) we find | (c) ____\nreason: hedge less<<} middle {++x++}{>>plain<<} {==span==}{>>pick: alpha | beta<<} {>>pick: orphan | thread<<} end";

const CHOICE_FILE: ChoiceFile = {
	version: 1,
	choices: {
		c1: {
			options: [
				{ label: "a", text: "the results indicate" },
				{ label: "b", text: "we find" },
				{ label: "c", blank: true },
			],
			note: "hedge less",
		},
	},
};

function parse(text: string, settings = DEFAULT_SETTINGS) {
	return new CriticMarkupRanges(getRangesInText(text, settings));
}

function doc_of(text: string) {
	return Text.of(text.split("\n"));
}

function sites_in(text: string, source: ChoiceSource = { mode: "inline" }, settings = DEFAULT_SETTINGS) {
	const ranges = parse(text, settings);
	return { ranges, sites: findChoiceSites(ranges, doc_of(text), source) };
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

describe("parseChoiceMarker", () => {
	test("pick: → inline", () => {
		expect(parseChoiceMarker("pick: alpha | beta")).toEqual({
			kind: "inline",
			spec: {
				options: [
					{ text: "alpha", blank: false },
					{ text: "beta", blank: false },
				],
			},
		});
	});

	test("#c1 → external", () => {
		expect(parseChoiceMarker("#c1")).toEqual({ kind: "external", uid: "c1" });
		expect(parseChoiceMarker("#c1-foo_2")).toEqual({ kind: "external", uid: "c1-foo_2" });
	});

	test("invalid UIDs → null", () => {
		expect(parseChoiceMarker("#c 1")).toBeNull();
		expect(parseChoiceMarker("#")).toBeNull();
		expect(parseChoiceMarker("c1")).toBeNull();
	});

	test("trims whitespace", () => {
		expect(parseChoiceMarker("  #c1  ")).toEqual({ kind: "external", uid: "c1" });
		expect(parseChoiceMarker("  pick: a | b  ")).toEqual({
			kind: "inline",
			spec: {
				options: [
					{ text: "a", blank: false },
					{ text: "b", blank: false },
				],
			},
		});
	});
});

describe("findChoiceSites", () => {
	const { ranges, sites } = sites_in(SAMPLE);

	test("exactly two sites: substitution then highlight", () => {
		expect(sites).toHaveLength(2);
		expect(sites[0].host.type).toBe(SuggestionType.SUBSTITUTION);
		expect(sites[1].host.type).toBe(SuggestionType.HIGHLIGHT);
		expect(sites[0].host.from).toBeLessThan(sites[1].host.from);
		expect(sites[0].marker.kind).toBe("inline");
		expect(sites[1].marker.kind).toBe("inline");
		expect(sites[0].uid).toBeUndefined();
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
		expect(findChoiceMarker(orphan!)).toBeNull();
	});

	test("{++x++} with plain comment is not a site", () => {
		const addition = ranges.ranges.find(range => range.type === SuggestionType.ADDITION);
		expect(addition).toBeDefined();
		expect(findChoiceMarker(addition!)).toBeNull();
		expect(addition!.replies).toHaveLength(1);
		expect(isChoiceComment(addition!.replies[0])).toBe(false);
	});

	test("findChoiceMarker resolves from host or reply", () => {
		expect(findChoiceMarker(sites[0].host)?.comment.from).toBe(sites[0].comment.from);
		expect(findChoiceMarker(sites[0].comment)?.comment.from).toBe(sites[0].comment.from);
		expect(findChoiceMarker(sites[0].host)?.marker.kind).toBe("inline");
	});

	test("inline mode ignores UID comments", () => {
		const text = "A {~~old~>new~~}{>>#c1<<} B {==span==}{>>pick: a | b<<}";
		const { sites: inline_sites } = sites_in(text, { mode: "inline" });
		expect(inline_sites).toHaveLength(1);
		expect(inline_sites[0].marker.kind).toBe("inline");
		expect(inline_sites[0].host.type).toBe(SuggestionType.HIGHLIGHT);
	});

	test("external mode ignores pick comments and UIDs missing from the file", () => {
		const text = "A {~~old~>new~~}{>>#c1<<} B {==span==}{>>pick: a | b<<} C {~~x~>y~~}{>>#missing<<}";
		const { sites: external_sites } = sites_in(text, { mode: "external", file: CHOICE_FILE });
		expect(external_sites).toHaveLength(1);
		expect(external_sites[0].marker).toEqual({ kind: "external", uid: "c1" });
		expect(external_sites[0].uid).toBe("c1");
		expect(external_sites[0].spec).toEqual(choiceSpecFromEntry(CHOICE_FILE.choices.c1));
		expect(external_sites[0].host.type).toBe(SuggestionType.SUBSTITUTION);
	});
});

describe("markerMatchesSource", () => {
	const inline = parseChoiceMarker("pick: a | b")!;
	const external = parseChoiceMarker("#c1")!;

	test("inline source matches only inline markers", () => {
		expect(markerMatchesSource(inline, { mode: "inline" })).toBe(true);
		expect(markerMatchesSource(external, { mode: "inline" })).toBe(false);
	});

	test("external source matches only UIDs present in the file", () => {
		const source: ChoiceSource = { mode: "external", file: CHOICE_FILE };
		expect(markerMatchesSource(external, source)).toBe(true);
		expect(markerMatchesSource(inline, source)).toBe(false);
		expect(markerMatchesSource({ kind: "external", uid: "missing" }, source)).toBe(false);
	});
});

describe("choice context", () => {
	test("unwraps other markup on the host line; host/marker stay out of before/after", () => {
		const text = "Intro {++x++} {~~a~>b~~}{>>#c1<<} tail {--gone--} end";
		const { sites, ranges } = sites_in(text, { mode: "external", file: CHOICE_FILE });
		expect(sites).toHaveLength(1);
		const { before, after } = sites[0].context;
		expect(before).toBe("Intro x ");
		expect(after).toBe(" tail gone end");
		expect(before).not.toContain("{");
		expect(after).not.toContain("{");
		expect(before + after).not.toContain("#c1");
		expect(before + after).not.toContain("~~");
		expect(before).toContain("Intro");
		expect(after).toContain("tail");
		expect(after).toContain("end");
		const deletion = ranges.ranges.find(range => range.type === SuggestionType.DELETION)!;
		expect(deletion.unwrap_slice(deletion.from, deletion.to)).toBe("gone");
	});

	test("empty before when host is at line start", () => {
		const text = "{~~a~>b~~}{>>pick: x | y<<} after";
		const { sites } = sites_in(text);
		expect(sites[0].context.before).toBe("");
		expect(sites[0].context.after).toBe(" after");
	});

	test("empty after when host thread is at line end", () => {
		const text = "before {~~a~>b~~}{>>pick: x | y<<}";
		const { sites } = sites_in(text);
		expect(sites[0].context.before).toBe("before ");
		expect(sites[0].context.after).toBe("");
	});

	test("uses the host line in a multi-line document", () => {
		const text = "first line\nsecond {~~a~>b~~}{>>pick: x | y<<} after\nthird";
		const { sites } = sites_in(text);
		expect(sites).toHaveLength(1);
		expect(sites[0].context.before).toBe("second ");
		expect(sites[0].context.after).toBe(" after");
	});

	test("multi-line host: before from first line, after from last-reply line", () => {
		const text = "head {~~old\nmid~>new\nlast~~}{>>pick: x | y<<} tail";
		const { sites } = sites_in(text);
		expect(sites).toHaveLength(1);
		expect(sites[0].context.before).toBe("head ");
		expect(sites[0].context.after).toBe(" tail");
	});
});

describe("resolveChoice", () => {
	const { sites } = sites_in(SAMPLE);
	const substitution = sites[0];
	const highlight = sites[1];

	test("pick option (b) replaces substitution + comment with we find", () => {
		const option_b = substitution.spec.options.find(option => option.label === "b")!;
		const result = applyChange(SAMPLE, resolveChoice(substitution, { kind: "option", option: option_b }, DEFAULT_SETTINGS));
		expect(result).toBe(
			"Intro we find middle {++x++}{>>plain<<} {==span==}{>>pick: alpha | beta<<} {>>pick: orphan | thread<<} end",
		);
		expect(result).toContain("{++x++}{>>plain<<}");
	});

	test("custom text replaces the substitution thread", () => {
		const result = applyChange(SAMPLE, resolveChoice(substitution, { kind: "custom", text: "we conclude" }, DEFAULT_SETTINGS));
		expect(result).toBe(
			"Intro we conclude middle {++x++}{>>plain<<} {==span==}{>>pick: alpha | beta<<} {>>pick: orphan | thread<<} end",
		);
	});

	test("reject on substitution restores original", () => {
		const result = applyChange(SAMPLE, resolveChoice(substitution, { kind: "reject" }, DEFAULT_SETTINGS));
		expect(result).toBe(
			"Intro the model shows middle {++x++}{>>plain<<} {==span==}{>>pick: alpha | beta<<} {>>pick: orphan | thread<<} end",
		);
	});

	test("reject on highlight restores unwrapped text", () => {
		const result = applyChange(SAMPLE, resolveChoice(highlight, { kind: "reject" }, DEFAULT_SETTINGS));
		expect(result).toBe(
			"Intro {~~the model shows~>the results indicate~~}{>>pick: (a) the results indicate | (b) we find | (c) ____\nreason: hedge less<<} middle {++x++}{>>plain<<} span {>>pick: orphan | thread<<} end",
		);
	});

	test("comment inserts at full_range_back and leaves the host untouched", () => {
		const change = resolveChoice(substitution, { kind: "comment", text: "not sure about tense" }, DEFAULT_SETTINGS);
		expect(change).toEqual({
			from: substitution.host.full_range_back,
			to: substitution.host.full_range_back,
			insert: "{>>not sure about tense<<}",
		});
		const result = applyChange(SAMPLE, change);
		const host_markup = SAMPLE.slice(substitution.host.from, substitution.host.full_range_back);
		expect(result).toContain(host_markup);
		expect(result.slice(substitution.host.full_range_back)).toMatch(/^\{>>not sure about tense<<\}/);
		expect(result).toBe(
			SAMPLE.slice(0, substitution.host.full_range_back) +
			"{>>not sure about tense<<}" +
			SAMPLE.slice(substitution.host.full_range_back),
		);
	});
});

describe("choice comments with metadata", () => {
	const text = `{~~{"author":"x"}@@old~>new~~}{>>{"author":"y"}@@pick: p | q<<}`;
	const { sites } = sites_in(text, { mode: "inline" }, { ...DEFAULT_SETTINGS, enable_metadata: true });

	test("parses substitution site through metadata", () => {
		expect(sites).toHaveLength(1);
		expect(sites[0].original).toBe("old");
		expect(sites[0].suggested).toBe("new");
		expect(sites[0].spec.options.map(option => option.text)).toEqual(["p", "q"]);
	});

	test("resolving with q removes all markup", () => {
		const result = applyChange(text, resolveChoice(sites[0], { kind: "custom", text: "q" }, DEFAULT_SETTINGS));
		expect(result).toBe("q");
	});
});

describe("validateChoiceFile", () => {
	test("accepts a valid file and returns the same object", () => {
		expect(validateChoiceFile(CHOICE_FILE)).toBe(CHOICE_FILE);
	});

	test("accepts blank options with optional label and ignores text", () => {
		const data = {
			version: 1,
			choices: {
				c1: {
					options: [
						{ text: "keep" },
						{ blank: true, label: "c", text: "ignored" },
					],
				},
			},
		};
		expect(validateChoiceFile(data)).toBe(data);
	});

	test("rejects non-objects and wrong version", () => {
		expect(validateChoiceFile(null)).toEqual(expect.any(String));
		expect(validateChoiceFile("nope")).toEqual(expect.any(String));
		expect(validateChoiceFile({ version: 2, choices: {} })).toBe("expected \"version\": 1");
		expect(validateChoiceFile({ version: 1, choices: [] })).toBe("expected \"choices\" object");
	});

	test("rejects empty options and missing text/blank", () => {
		expect(validateChoiceFile({
			version: 1,
			choices: { c1: { options: [] } },
		})).toBe("choices.c1: expected non-empty \"options\" array");
		expect(validateChoiceFile({
			version: 1,
			choices: { c1: { options: [{ text: "ok" }, { text: "also" }, { label: "c" }] } },
		})).toBe("choices.c1.options[2]: expected non-empty \"text\" or \"blank\": true");
		expect(validateChoiceFile({
			version: 1,
			choices: { c1: { options: [{ text: "" }] } },
		})).toBe("choices.c1.options[0]: expected non-empty \"text\" or \"blank\": true");
	});
});

describe("choiceSpecFromEntry", () => {
	test("maps label, blank, and text options", () => {
		expect(choiceSpecFromEntry({
			options: [
				{ label: "a", text: "the results indicate" },
				{ blank: true },
				{ label: "c", blank: true, text: "ignored" },
				{ text: "we find" },
			],
			note: "hedge less",
		})).toEqual({
			options: [
				{ label: "a", text: "the results indicate", blank: false },
				{ text: "", blank: true },
				{ label: "c", text: "", blank: true },
				{ text: "we find", blank: false },
			],
			note: "hedge less",
		});
	});
});

describe("resolveChoiceFilePath", () => {
	test("joins relative to the note folder and normalises", () => {
		expect(resolveChoiceFilePath("notes/a.md", "./a.choices.json")).toBe("notes/a.choices.json");
		expect(resolveChoiceFilePath("notes/sub/a.md", "../x.json")).toBe("notes/x.json");
		expect(resolveChoiceFilePath("a.md", "b.json")).toBe("b.json");
		expect(resolveChoiceFilePath("notes/a.md", "/abs.json")).toBe("abs.json");
		expect(resolveChoiceFilePath("notes/a.md", "../x.json")).toBe("x.json");
	});
});

describe("resolvedPathFor", () => {
	test("replaces trailing .json or appends", () => {
		expect(resolvedPathFor("x.json")).toBe("x.resolved.json");
		expect(resolvedPathFor("note.choices.json")).toBe("note.choices.resolved.json");
		expect(resolvedPathFor("x")).toBe("x.resolved.json");
		expect(resolvedPathFor("x.JSON")).toBe("x.JSON.resolved.json");
	});
});

describe("mergeResolution", () => {
	const option_a = { label: "a", text: "the results indicate", blank: false as const };

	test("null existing creates a new file", () => {
		expect(mergeResolution(null, "note.choices.json", "c1", { kind: "option", option: option_a }, 10)).toEqual({
			version: 1,
			source: "note.choices.json",
			resolutions: {
				c1: {
					decision: { kind: "option", label: "a", text: "the results indicate", time: 10 },
				},
			},
		});
	});

	test("comment append twice keeps both; decision overwrites; other uid preserved; no mutation", () => {
		const existing: ResolvedFile = {
			version: 1,
			source: "old.json",
			resolutions: {
				other: { decision: { kind: "reject", time: 1 } },
				c1: { comments: [{ text: "first", time: 2 }] },
			},
		};
		const snapshot = JSON.parse(JSON.stringify(existing));

		const with_comment = mergeResolution(existing, "note.choices.json", "c1", { kind: "comment", text: "second" }, 3);
		expect(with_comment.resolutions.c1.comments).toEqual([
			{ text: "first", time: 2 },
			{ text: "second", time: 3 },
		]);
		expect(with_comment.resolutions.other).toEqual({ decision: { kind: "reject", time: 1 } });

		const with_second_comment = mergeResolution(with_comment, "note.choices.json", "c1", { kind: "comment", text: "third" }, 4);
		expect(with_second_comment.resolutions.c1.comments).toHaveLength(3);

		const with_decision = mergeResolution(with_second_comment, "note.choices.json", "c1", { kind: "custom", text: "rewritten" }, 5);
		expect(with_decision.resolutions.c1.decision).toEqual({ kind: "custom", text: "rewritten", time: 5 });
		expect(with_decision.resolutions.c1.comments).toHaveLength(3);
		expect(with_decision.resolutions.other).toEqual({ decision: { kind: "reject", time: 1 } });

		const unlabelled = mergeResolution(null, "s.json", "c1", { kind: "option", option: { text: "x", blank: false } }, 9);
		expect(unlabelled.resolutions.c1.decision).toEqual({ kind: "option", text: "x", time: 9 });
		expect("label" in unlabelled.resolutions.c1.decision!).toBe(false);

		expect(existing).toEqual(snapshot);
		existing.resolutions.c1.comments!.push({ text: "mutated", time: 99 });
		expect(with_comment.resolutions.c1.comments).toEqual([
			{ text: "first", time: 2 },
			{ text: "second", time: 3 },
		]);
	});

	test("skip sets decision skip on a fresh uid", () => {
		expect(mergeResolution(null, "note.choices.json", "c1", { kind: "skip" }, 10)).toEqual({
			version: 1,
			source: "note.choices.json",
			resolutions: {
				c1: {
					decision: { kind: "skip", time: 10 },
				},
			},
		});
	});

	test("skip overwrites an option decision and keeps comments", () => {
		const existing: ResolvedFile = {
			version: 1,
			source: "old.json",
			resolutions: {
				c1: {
					comments: [{ text: "keep", time: 1 }],
					decision: { kind: "option", label: "a", text: "the results indicate", time: 2 },
				},
			},
		};
		const result = mergeResolution(existing, "note.choices.json", "c1", { kind: "skip" }, 3);
		expect(result.resolutions.c1).toEqual({
			comments: [{ text: "keep", time: 1 }],
			decision: { kind: "skip", time: 3 },
		});
	});

	test("comment appends and sets decision skip; later option overwrites skip", () => {
		const with_comment = mergeResolution(null, "s.json", "c1", { kind: "comment", text: "hmm" }, 1);
		expect(with_comment.resolutions.c1).toEqual({
			comments: [{ text: "hmm", time: 1 }],
			decision: { kind: "skip", time: 1 },
		});

		const with_option = mergeResolution(with_comment, "s.json", "c1", { kind: "option", option: option_a }, 2);
		expect(with_option.resolutions.c1.decision).toEqual({
			kind: "option",
			label: "a",
			text: "the results indicate",
			time: 2,
		});
		expect(with_option.resolutions.c1.comments).toEqual([{ text: "hmm", time: 1 }]);
	});
});

describe("revertResolutionsToSkip", () => {
	test("null existing → null", () => {
		expect(revertResolutionsToSkip(null, ["c1"], 10)).toBeNull();
	});

	test("no settled decisions (only skip / only comments / unknown uid) → null", () => {
		const only_skip: ResolvedFile = {
			version: 1,
			source: "s.json",
			resolutions: { c1: { decision: { kind: "skip", time: 1 } } },
		};
		expect(revertResolutionsToSkip(only_skip, ["c1"], 10)).toBeNull();

		const only_comments: ResolvedFile = {
			version: 1,
			source: "s.json",
			resolutions: { c1: { comments: [{ text: "x", time: 1 }] } },
		};
		expect(revertResolutionsToSkip(only_comments, ["c1"], 10)).toBeNull();

		const settled_other: ResolvedFile = {
			version: 1,
			source: "s.json",
			resolutions: { c1: { decision: { kind: "option", text: "a", time: 1 } } },
		};
		expect(revertResolutionsToSkip(settled_other, ["unknown"], 10)).toBeNull();
		expect(revertResolutionsToSkip(settled_other, [], 10)).toBeNull();
	});

	test("reverts listed option/custom uids only; keeps comments; uses time; no mutation", () => {
		const existing: ResolvedFile = {
			version: 1,
			source: "s.json",
			resolutions: {
				c1: {
					comments: [{ text: "keep me", time: 1 }],
					decision: { kind: "option", label: "a", text: "the results indicate", time: 2 },
				},
				c2: { decision: { kind: "custom", text: "rewritten", time: 3 } },
				c3: { decision: { kind: "reject", time: 4 } },
				c4: { comments: [{ text: "other", time: 5 }] },
			},
		};
		const snapshot = JSON.parse(JSON.stringify(existing));

		const result = revertResolutionsToSkip(existing, ["c1", "c2", "missing"], 99);
		expect(result).not.toBeNull();
		expect(result!.source).toBe("s.json");
		expect(result!.resolutions.c1).toEqual({
			comments: [{ text: "keep me", time: 1 }],
			decision: { kind: "skip", time: 99 },
		});
		expect(result!.resolutions.c2).toEqual({
			decision: { kind: "skip", time: 99 },
		});
		expect(result!.resolutions.c3).toEqual({ decision: { kind: "reject", time: 4 } });
		expect(result!.resolutions.c4).toEqual({ comments: [{ text: "other", time: 5 }] });
		expect(existing).toEqual(snapshot);
		existing.resolutions.c1.comments!.push({ text: "mutated", time: 0 });
		expect(result!.resolutions.c1.comments).toEqual([{ text: "keep me", time: 1 }]);
	});
});

describe("uidMarkersIn", () => {
	test("COMMENT #uid markers only; pick, plain, and addition bodies ignored", () => {
		const text = "{~~a~>b~~}{>>#c1<<} {>>pick: x | y<<} {>>#c2<<} {>>plain<<} {++#c3++}";
		const ranges = parse(text);
		expect(ranges.ranges.map(range => ({ type: range.type, unwrap: range.unwrap() }))).toEqual([
			{ type: SuggestionType.SUBSTITUTION, unwrap: "ab" },
			{ type: SuggestionType.COMMENT, unwrap: "#c1" },
			{ type: SuggestionType.COMMENT, unwrap: "pick: x | y" },
			{ type: SuggestionType.COMMENT, unwrap: "#c2" },
			{ type: SuggestionType.COMMENT, unwrap: "plain" },
			{ type: SuggestionType.ADDITION, unwrap: "#c3" },
		]);
		expect(uidMarkersIn(ranges.ranges)).toEqual(["c1", "c2"]);
	});
});
