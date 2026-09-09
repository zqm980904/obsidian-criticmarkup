import { type ChangeSpec } from "@codemirror/state";

import {
	type CommentRange,
	type CriticMarkupRange,
	type CriticMarkupRanges,
	HighlightRange,
	SubstitutionRange,
	SuggestionType,
} from "../ranges";

export interface ChoiceOption {
	label?: string;
	text: string;
	blank: boolean;
}

export interface ChoiceSpec {
	options: ChoiceOption[];
	note?: string;
}

export interface ChoiceSite {
	host: SubstitutionRange | HighlightRange;
	comment: CommentRange;
	spec: ChoiceSpec;
	original: string;
	suggested?: string;
}

export type ChoiceResolution = { kind: "text"; text: string } | { kind: "reject" };

const LABEL_RE = /^\(([^)]+)\)\s*/;
const BLANK_RE = /^_{3,}$/;
const PICK_RE = /^pick:\s*(.*)$/i;

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

export function isChoiceComment(range: CriticMarkupRange): boolean {
	return range.type === SuggestionType.COMMENT && parseChoiceComment(range.unwrap()) !== null;
}

function siteFromHost(host: SubstitutionRange | HighlightRange, comment: CommentRange, spec: ChoiceSpec): ChoiceSite {
	if (host instanceof SubstitutionRange) {
		const parts = host.unwrap_parts();
		return {
			host,
			comment,
			spec,
			original: parts[0],
			suggested: parts[1],
		};
	}
	return {
		host,
		comment,
		spec,
		original: host.unwrap(),
	};
}

export function findChoiceSite(range: CriticMarkupRange): ChoiceSite | null {
	const host = range.base_range;
	if (!(host instanceof SubstitutionRange) && !(host instanceof HighlightRange))
		return null;

	for (const reply of host.replies) {
		const spec = parseChoiceComment(reply.unwrap());
		if (spec)
			return siteFromHost(host, reply, spec);
	}
	return null;
}

export function findChoiceSites(ranges: CriticMarkupRanges): ChoiceSite[] {
	const sites: ChoiceSite[] = [];
	for (const range of ranges.ranges) {
		if (range.type !== SuggestionType.SUBSTITUTION && range.type !== SuggestionType.HIGHLIGHT)
			continue;
		const site = findChoiceSite(range);
		if (site)
			sites.push(site);
	}
	return sites.sort((a, b) => a.host.from - b.host.from);
}

export function resolveChoice(site: ChoiceSite, resolution: ChoiceResolution): ChangeSpec {
	let insert: string;
	if (resolution.kind === "text")
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
