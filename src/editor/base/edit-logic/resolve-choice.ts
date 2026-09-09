import { type ChangeSpec, type Text } from "@codemirror/state";

import type { PluginSettings } from "../../../types";
import { create_range } from "../edit-util/range-create";
import {
	type CommentRange,
	type CriticMarkupRange,
	type CriticMarkupRanges,
	HighlightRange,
	SubstitutionRange,
	SuggestionType,
} from "../ranges";

export const CHOICE_FRONTMATTER_KEY = "commentator-choices";

export interface ChoiceOption {
	label?: string;
	text: string;
	blank: boolean;
}

export interface ChoiceSpec {
	options: ChoiceOption[];
	note?: string;
}

export type ChoiceMarker =
	| { kind: "inline"; spec: ChoiceSpec }
	| { kind: "external"; uid: string };

export interface ChoiceContext {
	before: string;
	after: string;
}

export interface ChoiceSite {
	host: SubstitutionRange | HighlightRange;
	comment: CommentRange;
	marker: ChoiceMarker;
	spec: ChoiceSpec;
	uid?: string;
	original: string;
	suggested?: string;
	context: ChoiceContext;
}

export type ChoiceResolution =
	| { kind: "option"; option: ChoiceOption }
	| { kind: "custom"; text: string }
	| { kind: "reject" }
	| { kind: "comment"; text: string };

export type ChoiceSource = { mode: "inline" } | { mode: "external"; file: ChoiceFile };

export interface ChoiceFileOption {
	label?: string;
	text?: string;
	blank?: boolean;
}

export interface ChoiceFileEntry {
	options: ChoiceFileOption[];
	note?: string;
}

export interface ChoiceFile {
	version: 1;
	choices: Record<string, ChoiceFileEntry>;
}

export interface ResolvedComment {
	text: string;
	time: number;
}

/** What gets written to the resolved file: a document resolution, or an explicit skip (deferred/undone). */
export type ChoiceRecord = ChoiceResolution | { kind: "skip" };

export type ResolvedDecision =
	| { kind: "option"; label?: string; text: string; time: number }
	| { kind: "custom"; text: string; time: number }
	| { kind: "reject"; time: number }
	| { kind: "skip"; time: number };

export interface ResolvedEntry {
	comments?: ResolvedComment[];
	decision?: ResolvedDecision;
}

export interface ResolvedFile {
	version: 1;
	source: string;
	resolutions: Record<string, ResolvedEntry>;
}

export interface ChoiceMarkerSite {
	host: SubstitutionRange | HighlightRange;
	comment: CommentRange;
	marker: ChoiceMarker;
}

const LABEL_RE = /^\(([^)]+)\)\s*/;
const BLANK_RE = /^_{3,}$/;
const PICK_RE = /^pick:\s*(.*)$/i;
const UID_RE = /^#([A-Za-z0-9_-]+)$/;

export function parseChoiceComment(body: string): ChoiceSpec | null {
	const trimmed = body.trim();
	const newline = trimmed.indexOf("\n");
	const first_line = newline === -1 ? trimmed : trimmed.slice(0, newline);
	const match = first_line.match(PICK_RE);
	if (!match) return null;

	const options: ChoiceOption[] = [];
	for (const part of match[1].split("|")) {
		const trimmed_part = part.trim();
		if (!trimmed_part) continue;

		const label_match = trimmed_part.match(LABEL_RE);
		const label = label_match?.[1];
		const text = label_match ? trimmed_part.slice(label_match[0].length) : trimmed_part;
		const blank = BLANK_RE.test(text);
		const option: ChoiceOption = {
			text: blank ? "" : text,
			blank,
		};
		if (label !== undefined) option.label = label;
		options.push(option);
	}

	if (options.length === 0) return null;

	const spec: ChoiceSpec = { options };
	const note = (newline === -1 ? "" : trimmed.slice(newline + 1)).trim();
	if (note) spec.note = note;
	return spec;
}

export function parseChoiceMarker(body: string): ChoiceMarker | null {
	const trimmed = body.trim();
	const spec = parseChoiceComment(trimmed);
	if (spec)
		return { kind: "inline", spec };
	const uid_match = trimmed.match(UID_RE);
	if (uid_match)
		return { kind: "external", uid: uid_match[1] };
	return null;
}

export function isChoiceComment(range: CriticMarkupRange): boolean {
	return range.type === SuggestionType.COMMENT && parseChoiceMarker(range.unwrap()) !== null;
}

export function findChoiceMarker(range: CriticMarkupRange): ChoiceMarkerSite | null {
	const host = range.base_range;
	if (!(host instanceof SubstitutionRange) && !(host instanceof HighlightRange))
		return null;

	for (const reply of host.replies) {
		const marker = parseChoiceMarker(reply.unwrap());
		if (marker)
			return { host, comment: reply, marker };
	}
	return null;
}

export function markerMatchesSource(marker: ChoiceMarker, source: ChoiceSource): boolean {
	if (source.mode === "inline")
		return marker.kind === "inline";
	return marker.kind === "external" && marker.uid in source.file.choices;
}

function unwrap_excluding_thread(
	ranges: CriticMarkupRanges,
	doc: Text,
	from: number,
	to: number,
	host: SubstitutionRange | HighlightRange,
): string {
	if (from === to)
		return "";
	const excluded = new Set<CriticMarkupRange>(host.full_thread);
	const in_interval = ranges.ranges_in_interval(from, to)
		.filter(range => !excluded.has(range))
		.sort((a, b) => a.from - b.from);
	return ranges.unwrap_in_range(doc, from, to, in_interval).output;
}

function choice_context(
	ranges: CriticMarkupRanges,
	doc: Text,
	host: SubstitutionRange | HighlightRange,
): ChoiceContext {
	const before_line = doc.lineAt(host.from);
	const after_line = doc.lineAt(host.full_range_back);
	return {
		before: unwrap_excluding_thread(ranges, doc, before_line.from, host.from, host),
		after: unwrap_excluding_thread(ranges, doc, host.full_range_back, after_line.to, host),
	};
}

function site_from_marker(
	ranges: CriticMarkupRanges,
	doc: Text,
	found: ChoiceMarkerSite,
	spec: ChoiceSpec,
	uid?: string,
): ChoiceSite {
	const { host, comment, marker } = found;
	const site: ChoiceSite = {
		host,
		comment,
		marker,
		spec,
		original: "",
		context: choice_context(ranges, doc, host),
	};
	if (host instanceof SubstitutionRange) {
		const parts = host.unwrap_parts();
		site.original = parts[0];
		site.suggested = parts[1];
	} else {
		site.original = host.unwrap();
	}
	if (uid !== undefined)
		site.uid = uid;
	return site;
}

export function findChoiceSites(ranges: CriticMarkupRanges, doc: Text, source: ChoiceSource): ChoiceSite[] {
	const sites: ChoiceSite[] = [];
	const seen = new Set<CriticMarkupRange>();
	for (const range of ranges.ranges) {
		const found = findChoiceMarker(range);
		if (!found || seen.has(found.host))
			continue;
		seen.add(found.host);
		if (!markerMatchesSource(found.marker, source))
			continue;

		if (found.marker.kind === "inline") {
			sites.push(site_from_marker(ranges, doc, found, found.marker.spec));
		} else if (source.mode === "external") {
			sites.push(site_from_marker(
				ranges,
				doc,
				found,
				choiceSpecFromEntry(source.file.choices[found.marker.uid]),
				found.marker.uid,
			));
		}
	}
	return sites.sort((a, b) => a.host.from - b.host.from);
}

export function choiceSpecFromEntry(entry: ChoiceFileEntry): ChoiceSpec {
	const options: ChoiceOption[] = entry.options.map(option => {
		if (option.blank) {
			const converted: ChoiceOption = { text: "", blank: true };
			if (option.label !== undefined) converted.label = option.label;
			return converted;
		}
		const converted: ChoiceOption = { text: option.text ?? "", blank: false };
		if (option.label !== undefined) converted.label = option.label;
		return converted;
	});
	const spec: ChoiceSpec = { options };
	if (entry.note)
		spec.note = entry.note;
	return spec;
}

export function resolveChoice(site: ChoiceSite, resolution: ChoiceResolution, settings: PluginSettings): ChangeSpec {
	if (resolution.kind === "comment") {
		return {
			from: site.host.full_range_back,
			to: site.host.full_range_back,
			insert: create_range(settings, SuggestionType.COMMENT, resolution.text),
		};
	}

	let insert: string;
	if (resolution.kind === "option")
		insert = resolution.option.text;
	else if (resolution.kind === "custom")
		insert = resolution.text;
	else if (site.host instanceof SubstitutionRange)
		insert = site.host.reject();
	else
		insert = site.host.unwrap();

	return {
		from: site.host.from,
		to: site.host.full_range_back,
		insert,
	};
}

function is_record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateChoiceFile(data: unknown): ChoiceFile | string {
	if (!is_record(data))
		return "expected an object";
	if (data.version !== 1)
		return "expected \"version\": 1";
	if (!is_record(data.choices))
		return "expected \"choices\" object";

	for (const [uid, entry] of Object.entries(data.choices)) {
		if (!is_record(entry))
			return `choices.${uid}: expected an object`;
		if (entry.note !== undefined && typeof entry.note !== "string")
			return `choices.${uid}.note: expected string`;
		if (!Array.isArray(entry.options) || entry.options.length === 0)
			return `choices.${uid}: expected non-empty "options" array`;
		for (let i = 0; i < entry.options.length; i++) {
			const option = entry.options[i];
			if (!is_record(option))
				return `choices.${uid}.options[${i}]: expected an object`;
			if (option.label !== undefined && typeof option.label !== "string")
				return `choices.${uid}.options[${i}].label: expected string`;
			if (option.blank === true)
				continue;
			if (typeof option.text !== "string" || option.text.length === 0)
				return `choices.${uid}.options[${i}]: expected non-empty "text" or "blank": true`;
		}
	}

	return data as unknown as ChoiceFile;
}

export function resolveChoiceFilePath(note_path: string, relative: string): string {
	const note = note_path.replace(/\\/g, "/");
	let rel = relative.replace(/\\/g, "/");
	const parts: string[] = [];

	if (rel.startsWith("/")) {
		rel = rel.slice(1);
	} else {
		const slash = note.lastIndexOf("/");
		if (slash !== -1) {
			for (const part of note.slice(0, slash).split("/")) {
				if (part)
					parts.push(part);
			}
		}
	}

	for (const part of rel.split("/")) {
		if (part === "" || part === ".")
			continue;
		if (part === "..") {
			if (parts.length)
				parts.pop();
			continue;
		}
		parts.push(part);
	}

	return parts.join("/");
}

export function resolvedPathFor(json_path: string): string {
	if (json_path.endsWith(".json"))
		return json_path.slice(0, -".json".length) + ".resolved.json";
	return json_path + ".resolved.json";
}

function clone_resolved_entry(entry: ResolvedEntry): ResolvedEntry {
	const cloned: ResolvedEntry = {};
	if (entry.comments)
		cloned.comments = entry.comments.map(comment => ({ text: comment.text, time: comment.time }));
	if (entry.decision)
		cloned.decision = { ...entry.decision };
	return cloned;
}

export function mergeResolution(
	existing: ResolvedFile | null,
	source: string,
	uid: string,
	resolution: ChoiceRecord,
	time: number,
): ResolvedFile {
	const resolutions: Record<string, ResolvedEntry> = {};
	if (existing) {
		for (const [key, value] of Object.entries(existing.resolutions))
			resolutions[key] = clone_resolved_entry(value);
	}

	const entry = resolutions[uid] ?? (resolutions[uid] = {});
	if (resolution.kind === "comment") {
		if (!entry.comments)
			entry.comments = [];
		entry.comments.push({ text: resolution.text, time });
		// A comment does not settle the choice; the site is deferred like a skip
		entry.decision = { kind: "skip", time };
	} else if (resolution.kind === "skip") {
		entry.decision = { kind: "skip", time };
	} else if (resolution.kind === "option") {
		const decision: ResolvedDecision = { kind: "option", text: resolution.option.text, time };
		if (resolution.option.label !== undefined)
			decision.label = resolution.option.label;
		entry.decision = decision;
	} else if (resolution.kind === "custom") {
		entry.decision = { kind: "custom", text: resolution.text, time };
	} else {
		entry.decision = { kind: "reject", time };
	}

	return { version: 1, source, resolutions };
}

/**
 * Mark the given uids as skipped if they currently hold a settling decision (option/custom/reject).
 * Returns null when nothing had to change.
 */
export function revertResolutionsToSkip(existing: ResolvedFile | null, uids: string[], time: number): ResolvedFile | null {
	if (!existing) return null;
	const to_revert = uids.filter(uid => {
		const decision = existing.resolutions[uid]?.decision;
		return decision !== undefined && decision.kind !== "skip";
	});
	if (to_revert.length === 0) return null;

	let result: ResolvedFile = existing;
	for (const uid of to_revert)
		result = mergeResolution(result, existing.source, uid, { kind: "skip" }, time);
	return result;
}

/** UIDs of external choice markers among the given ranges (e.g. the ranges (re)inserted or deleted by a transaction). */
export function uidMarkersIn(ranges: CriticMarkupRange[]): string[] {
	const uids: string[] = [];
	for (const range of ranges) {
		if (range.type !== SuggestionType.COMMENT) continue;
		const marker = parseChoiceMarker(range.unwrap());
		if (marker?.kind === "external")
			uids.push(marker.uid);
	}
	return uids;
}
