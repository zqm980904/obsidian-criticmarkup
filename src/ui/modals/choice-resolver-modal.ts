import { type App, Modal, Notice, type TFile } from "obsidian";
import { type EditorView } from "@codemirror/view";
import { mount, unmount } from "svelte";

import {
	type ChoiceRecord,
	type ChoiceResolution,
	type ChoiceSite,
	type ChoiceSource,
	type ResolvedDecision,
	findChoiceSites,
	rangeParser,
	resolveChoice,
} from "../../editor/base";
import { choiceDecisionAnnotation, pluginSettingsField } from "../../editor/uix";
import { getChoiceMode, loadChoiceSource, loadResolvedFile, recordResolution } from "../../util/choice-file";
import ChoiceResolverModalView from "./ChoiceResolverModal.svelte";

export class ChoiceResolverModal extends Modal {
	private component: ReturnType<typeof ChoiceResolverModalView> | undefined;

	constructor(app: App, private view: EditorView, private file: TFile | null, private start_from?: number) {
		super(app);
		this.contentEl.parentElement!.addClass("cmtr-choice-resolver-modal");
	}

	async onOpen() {
		this.setTitle("Resolve suggested edit");

		const mode = getChoiceMode(this.app, this.file);

		let source: ChoiceSource;
		try {
			source = await loadChoiceSource(this.app, mode);
		} catch (error) {
			new Notice(error instanceof Error ? error.message : String(error));
			this.close();
			return;
		}

		const sites = findChoiceSites(this.view.state.field(rangeParser).ranges, this.view.state.doc, source);
		if (sites.length === 0) {
			new Notice("No suggestions with choices in this note");
			this.close();
			return;
		}

		const decisions: Record<string, ResolvedDecision> = {};
		if (mode.mode === "external") {
			const resolved = await loadResolvedFile(this.app, mode.path);
			if (resolved) {
				for (const [uid, entry] of Object.entries(resolved.resolutions)) {
					if (entry.decision)
						decisions[uid] = entry.decision;
				}
			}
		}

		const record_only = mode.mode === "external" && !mode.inline;

		let index = 0;
		if (this.start_from !== undefined) {
			const found = sites.findIndex(site => site.host.from === this.start_from);
			if (found !== -1)
				index = found;
		} else {
			const found = sites.findIndex(site => {
				const decision = site.uid ? decisions[site.uid] : undefined;
				return decision === undefined || decision.kind === "skip";
			});
			if (found !== -1)
				index = found;
		}

		const record = (site: ChoiceSite, entry: ChoiceRecord) => {
			if (mode.mode !== "external") return;
			recordResolution(this.app, mode.path, site.uid!, entry).catch(error => {
				new Notice(error instanceof Error ? error.message : String(error));
			});
		};

		this.component = mount(ChoiceResolverModalView, {
			target: this.contentEl,
			props: {
				sites,
				index,
				source_path: mode.mode === "external" ? mode.path : undefined,
				record_only,
				decisions,
				onResolve: (site: ChoiceSite, resolution: ChoiceResolution) => {
					if (record_only) {
						record(site, resolution);
						return sites;
					}
					const settings = this.view.state.field(pluginSettingsField);
					const settles = resolution.kind !== "comment";
					this.view.dispatch({
						changes: resolveChoice(site, resolution, settings),
						// Lets the undo/redo sync restore this decision when the removal of the marker is redone
						annotations: mode.mode === "external" && settles ?
							choiceDecisionAnnotation.of({ uid: site.uid!, record: resolution }) :
							undefined,
					});
					const next_sites = findChoiceSites(
						this.view.state.field(rangeParser).ranges,
						this.view.state.doc,
						source,
					);
					record(site, resolution);
					return next_sites;
				},
				onSkip: (site: ChoiceSite) => record(site, { kind: "skip" }),
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
