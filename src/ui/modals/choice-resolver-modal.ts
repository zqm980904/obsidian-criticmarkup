import { type App, Modal, Notice } from "obsidian";
import { type EditorView } from "@codemirror/view";
import { mount, unmount } from "svelte";

import {
	type ChoiceResolution,
	type ChoiceSite,
	findChoiceSites,
	rangeParser,
	resolveChoice,
} from "../../editor/base";
import ChoiceResolverModalView from "./ChoiceResolverModal.svelte";

export class ChoiceResolverModal extends Modal {
	private component: ReturnType<typeof ChoiceResolverModalView> | undefined;

	constructor(app: App, private view: EditorView, private start_at: number = 0) {
		super(app);
		this.contentEl.parentElement!.addClass("cmtr-choice-resolver-modal");
	}

	onOpen() {
		this.setTitle("Resolve suggested edit");

		const sites = findChoiceSites(this.view.state.field(rangeParser).ranges);
		if (sites.length === 0) {
			new Notice("No suggestions with choices in this note");
			this.close();
			return;
		}

		const index = Math.min(Math.max(this.start_at, 0), sites.length - 1);
		this.component = mount(ChoiceResolverModalView, {
			target: this.contentEl,
			props: {
				sites,
				index,
				onResolve: (site: ChoiceSite, resolution: ChoiceResolution) => {
					this.view.dispatch({ changes: resolveChoice(site, resolution) });
					return findChoiceSites(this.view.state.field(rangeParser).ranges);
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
