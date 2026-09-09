import { Annotation, StateField } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorInfoField, Notice } from "obsidian";

import { type ChoiceRecord, rangeParser, uidMarkersIn } from "../../base";
import { getChoiceMode, recordResolution, revertResolutions } from "../../../util/choice-file";

/** Attached to transactions that settle an external choice (remove its marker), so redo can restore the decision. */
export const choiceDecisionAnnotation = Annotation.define<{ uid: string; record: ChoiceRecord }>();

const choiceDecisions = StateField.define<Map<string, ChoiceRecord>>({
	create: () => new Map(),
	update(value, tr) {
		const decision = tr.annotation(choiceDecisionAnnotation);
		if (!decision) return value;
		const next = new Map(value);
		next.set(decision.uid, decision.record);
		return next;
	},
});

/**
 * Keeps the resolved JSON in step with the editor history: undoing a settled choice brings its marker
 * back, so the decision reverts to "skip"; redoing removes the marker again and restores the decision.
 */
export const choiceHistorySync = [
	choiceDecisions,
	EditorView.updateListener.of(update => {
		if (!update.docChanged) return;
		const undo = update.transactions.some(tr => tr.isUserEvent("undo"));
		const redo = update.transactions.some(tr => tr.isUserEvent("redo"));
		if (!undo && !redo) return;

		const { app, file } = update.state.field(editorInfoField);
		const mode = getChoiceMode(app, file);
		if (mode.mode !== "external") return;

		const parser = update.state.field(rangeParser);
		const report = (error: unknown) => new Notice(error instanceof Error ? error.message : String(error));

		if (undo) {
			const restored = uidMarkersIn(parser.inserted_ranges);
			if (restored.length)
				revertResolutions(app, mode.path, restored).catch(report);
		}
		if (redo) {
			const decisions = update.state.field(choiceDecisions);
			for (const uid of uidMarkersIn(parser.deleted_ranges)) {
				const record = decisions.get(uid);
				if (record)
					recordResolution(app, mode.path, uid, record).catch(report);
			}
		}
	}),
];
