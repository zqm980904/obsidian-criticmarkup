import { ChangeSet, Text } from "@codemirror/state";
import { type App, Notice, TFile } from "obsidian";

import type CommentatorPlugin from "../main";
import {
	applyResolutions,
	CHOICE_FRONTMATTER_KEY,
	CHOICE_INLINE_FRONTMATTER_KEY,
	type ChoiceRecord,
	type ChoiceSource,
	CriticMarkupRanges,
	findChoiceSites,
	getRangesInText,
	mergeResolution,
	resolveChoiceFilePath,
	type ResolvedFile,
	resolvedPathFor,
	revertResolutionsToSkip,
	stripChoiceFrontmatter,
	validateChoiceFile,
} from "../editor/base";

export type ChoiceMode = { mode: "inline" } | { mode: "external"; path: string; inline: boolean };

function file_by_path(app: App, path: string): TFile | null {
	if (typeof app.vault.getFileByPath === "function")
		return app.vault.getFileByPath(path);
	const abstract = app.vault.getAbstractFileByPath(path);
	return abstract instanceof TFile ? abstract : null;
}

export function getChoiceMode(app: App, file: TFile | null): ChoiceMode {
	if (!file)
		return { mode: "inline" };

	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	const value = frontmatter?.[CHOICE_FRONTMATTER_KEY];
	if (typeof value !== "string" || value.trim() === "")
		return { mode: "inline" };

	return {
		mode: "external",
		path: resolveChoiceFilePath(file.path, value.trim()),
		inline: frontmatter?.[CHOICE_INLINE_FRONTMATTER_KEY] === true,
	};
}

export async function loadChoiceSource(app: App, mode: ChoiceMode): Promise<ChoiceSource> {
	if (mode.mode === "inline")
		return { mode: "inline" };

	const path = mode.path;
	const file = file_by_path(app, path);
	if (!file)
		throw new Error(`Choice file not found: ${path}`);

	let raw: string;
	try {
		raw = await app.vault.read(file);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Could not read choice file ${path}: ${message}`);
	}

	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Choice file is not valid JSON: ${message}`);
	}

	const validated = validateChoiceFile(data);
	if (typeof validated === "string")
		throw new Error(`Invalid choice file ${path}: ${validated}`);

	return { mode: "external", file: validated };
}

export async function loadResolvedFile(app: App, json_path: string): Promise<ResolvedFile | null> {
	const existing_file = file_by_path(app, resolvedPathFor(json_path));
	if (!existing_file)
		return null;

	try {
		const parsed = JSON.parse(await app.vault.read(existing_file)) as Partial<ResolvedFile>;
		if (parsed && typeof parsed.resolutions === "object" && parsed.resolutions !== null)
			return parsed as ResolvedFile;
	} catch {
		return null;
	}
	return null;
}

function resolved_note_path(note_path: string): string {
	if (note_path.endsWith(".md"))
		return note_path.slice(0, -".md".length) + ".resolved.md";
	return note_path + ".resolved.md";
}

export async function exportResolvedNote(plugin: CommentatorPlugin, file: TFile, with_comments: boolean): Promise<void> {
	const { app } = plugin;
	const mode = getChoiceMode(app, file);
	if (mode.mode !== "external") {
		new Notice("This note does not use an external choice file");
		return;
	}

	try {
		const source = await loadChoiceSource(app, mode);
		const resolved = await loadResolvedFile(app, mode.path);
		const text = await app.vault.read(file);
		const ranges = new CriticMarkupRanges(getRangesInText(text, plugin.settings));
		const doc = Text.of(text.split("\n"));
		const change_specs = applyResolutions(ranges, doc, source, resolved, plugin.settings, with_comments);
		const output = stripChoiceFrontmatter(ChangeSet.of(change_specs, doc.length).apply(doc).toString());
		const out_path = resolved_note_path(file.path);

		const existing = file_by_path(app, out_path);
		if (existing)
			await app.vault.modify(existing, output);
		else
			await app.vault.create(out_path, output);

		let exported = 0;
		for (const site of findChoiceSites(ranges, doc, source)) {
			const decision = site.uid ? resolved?.resolutions[site.uid]?.decision : undefined;
			if (decision && decision.kind !== "skip")
				exported += 1;
		}
		new Notice(`Exported ${exported} resolved choices to ${out_path}`);
	} catch (error) {
		new Notice(error instanceof Error ? error.message : String(error));
	}
}

// All resolved-file writes go through one queue so a read-modify-write never interleaves with another
let write_queue: Promise<void> = Promise.resolve();

function update_resolved_file(
	app: App,
	json_path: string,
	update: (existing: ResolvedFile | null) => ResolvedFile | null,
): Promise<void> {
	const run = async () => {
		const resolved_path = resolvedPathFor(json_path);
		const existing_file = file_by_path(app, resolved_path);
		const existing = await loadResolvedFile(app, json_path);

		const data = update(existing);
		if (!data) return;
		const content = JSON.stringify(data, null, 2);
		if (existing_file)
			await app.vault.modify(existing_file, content);
		else
			await app.vault.create(resolved_path, content);
	};

	const result = write_queue.then(run);
	write_queue = result.catch(() => {});
	return result;
}

export function recordResolution(app: App, json_path: string, uid: string, record: ChoiceRecord): Promise<void> {
	return update_resolved_file(app, json_path, existing => mergeResolution(existing, json_path, uid, record, Date.now()));
}

/** After an undo re-inserted choice markers, their settled decisions no longer hold: mark them as skipped. */
export function revertResolutions(app: App, json_path: string, uids: string[]): Promise<void> {
	return update_resolved_file(app, json_path, existing => revertResolutionsToSkip(existing, uids, Date.now()));
}
