import { type App, TFile } from "obsidian";

import {
	CHOICE_FRONTMATTER_KEY,
	type ChoiceRecord,
	type ChoiceSource,
	mergeResolution,
	resolveChoiceFilePath,
	type ResolvedFile,
	resolvedPathFor,
	revertResolutionsToSkip,
	validateChoiceFile,
} from "../editor/base";

export type ChoiceMode = { mode: "inline" } | { mode: "external"; path: string };

function file_by_path(app: App, path: string): TFile | null {
	if (typeof app.vault.getFileByPath === "function")
		return app.vault.getFileByPath(path);
	const abstract = app.vault.getAbstractFileByPath(path);
	return abstract instanceof TFile ? abstract : null;
}

export function getChoiceMode(app: App, file: TFile | null): ChoiceMode {
	if (!file)
		return { mode: "inline" };

	const value = app.metadataCache.getFileCache(file)?.frontmatter?.[CHOICE_FRONTMATTER_KEY];
	if (typeof value !== "string" || value.trim() === "")
		return { mode: "inline" };

	return { mode: "external", path: resolveChoiceFilePath(file.path, value.trim()) };
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

		let existing: ResolvedFile | null = null;
		if (existing_file) {
			try {
				const parsed = JSON.parse(await app.vault.read(existing_file)) as Partial<ResolvedFile>;
				if (parsed && typeof parsed.resolutions === "object" && parsed.resolutions !== null)
					existing = parsed as ResolvedFile;
			} catch {
				existing = null;
			}
		}

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
