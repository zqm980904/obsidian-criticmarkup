import { type App, Modal, Notice, type TFile } from "obsidian";
import { type EditorView } from "@codemirror/view";
import { mount, unmount } from "svelte";

import {
	type ChoiceSource,
	type ResolvedDecision,
	findChoiceSites,
	rangeParser,
} from "../../editor/base";
import { getChoiceMode, loadChoiceSource, loadResolvedFile, revertResolutions } from "../../util/choice-file";
import RevertChoicesModalView from "./RevertChoicesModal.svelte";

export interface RevertChoiceRow {
	uid: string;
	original?: string;
	summary: string;
}

function summary_for(decision: ResolvedDecision): string {
	if (decision.kind === "reject")
		return "Rejected";
	if (decision.kind === "option" && decision.label !== undefined)
		return `(${decision.label}) ${decision.text}`;
	if (decision.kind === "option" || decision.kind === "custom")
		return decision.text;
	return "";
}

export class RevertChoicesModal extends Modal {
	private component: ReturnType<typeof RevertChoicesModalView> | undefined;

	constructor(app: App, private view: EditorView, private file: TFile | null) {
		super(app);
		this.contentEl.parentElement!.addClass("cmtr-revert-choices-modal");
	}

	async onOpen() {
		this.setTitle("Revert resolved choices");

		const mode = getChoiceMode(this.app, this.file);
		if (mode.mode !== "external") {
			new Notice("This note does not use an external choice file");
			this.close();
			return;
		}

		let source: ChoiceSource;
		try {
			source = await loadChoiceSource(this.app, mode);
		} catch (error) {
			new Notice(error instanceof Error ? error.message : String(error));
			this.close();
			return;
		}

		const resolved = await loadResolvedFile(this.app, mode.path);
		const sites = findChoiceSites(this.view.state.field(rangeParser).ranges, this.view.state.doc, source);
		const original_by_uid = new Map<string, string>();
		for (const site of sites) {
			if (site.uid)
				original_by_uid.set(site.uid, site.original);
		}

		const rows: RevertChoiceRow[] = [];
		if (resolved) {
			for (const [uid, entry] of Object.entries(resolved.resolutions)) {
				const decision = entry.decision;
				if (!decision || decision.kind === "skip")
					continue;
				const row: RevertChoiceRow = {
					uid,
					summary: summary_for(decision),
				};
				const original = original_by_uid.get(uid);
				if (original !== undefined)
					row.original = original;
				rows.push(row);
			}
		}

		if (rows.length === 0) {
			new Notice("No resolved choices to revert");
			this.close();
			return;
		}

		this.component = mount(RevertChoicesModalView, {
			target: this.contentEl,
			props: {
				rows,
				onRevert: async (uids: string[]) => {
					try {
						await revertResolutions(this.app, mode.path, uids);
						this.close();
					} catch (error) {
						new Notice(error instanceof Error ? error.message : String(error));
					}
				},
				onClose: () => this.close(),
			},
		});
	}

	onClose() {
		if (this.component) {
			unmount(this.component);
		}
	}
}
