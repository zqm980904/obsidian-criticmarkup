<script lang="ts">
  import type { ChoiceOption, ChoiceResolution, ChoiceSite, ResolvedDecision } from "../../editor/base";

  interface Props {
    sites: ChoiceSite[];
    index: number;
    source_path?: string;
    record_only?: boolean;
    decisions?: Record<string, ResolvedDecision>;
    onResolve: (site: ChoiceSite, resolution: ChoiceResolution) => ChoiceSite[];
    onSkip: (site: ChoiceSite) => void;
    onClose: () => void;
  }

  let {
    sites,
    index,
    source_path,
    record_only = false,
    decisions: initial_decisions = {},
    onResolve,
    onSkip,
    onClose,
  }: Props = $props();

  let current_sites = $state(sites);
  let current_index = $state(index);
  let custom_text = $state("");
  let custom_mode = $state<"revision" | "comment">("revision");
  let custom_input: HTMLInputElement | undefined = $state();
  let decisions = $state<Record<string, ResolvedDecision>>({ ...initial_decisions });

  let site = $derived(current_sites[current_index] as ChoiceSite | undefined);
  let decision = $derived(site?.uid ? decisions[site.uid] : undefined);

  function optionLetter(option: ChoiceOption, i: number): string {
    return option.label ?? String.fromCharCode(97 + i);
  }

  function optionLabel(option: ChoiceOption, i: number): string {
    const letter = optionLetter(option, i);
    return option.blank ? `(${letter}) Custom…` : `(${letter}) ${option.text}`;
  }

  function resetInput() {
    custom_text = "";
    custom_mode = "revision";
  }

  function advance() {
    if (current_index >= current_sites.length - 1) {
      onClose();
      return;
    }
    current_index += 1;
    resetInput();
  }

  function setDecision(target: ChoiceSite, resolution: ChoiceResolution | { kind: "skip" }) {
    if (!target.uid) return;
    const time = Date.now();
    let next: ResolvedDecision;
    if (resolution.kind === "comment" || resolution.kind === "skip")
      next = { kind: "skip", time };
    else if (resolution.kind === "option") {
      next = { kind: "option", text: resolution.option.text, time };
      if (resolution.option.label !== undefined)
        next.label = resolution.option.label;
    } else if (resolution.kind === "custom")
      next = { kind: "custom", text: resolution.text, time };
    else
      next = { kind: "reject", time };
    decisions = { ...decisions, [target.uid]: next };
  }

  function decisionLine(current: ResolvedDecision): string {
    if (current.kind === "reject")
      return "Rejected";
    if (current.kind === "custom")
      return `Decided: ${current.text}`;
    if (current.kind === "option")
      return current.label !== undefined ? `Decided: (${current.label}) ${current.text}` : `Decided: ${current.text}`;
    return "";
  }

  function optionIsActive(option: ChoiceOption): boolean {
    if (!decision || decision.kind !== "option")
      return false;
    if (option.label !== undefined && decision.label !== undefined)
      return option.label === decision.label;
    return option.text === decision.text;
  }

  function apply(resolution: ChoiceResolution) {
    if (!site) return;
    const target = site;
    current_sites = onResolve(site, resolution);
    setDecision(target, resolution);
    resetInput();
    if (record_only) {
      advance();
      return;
    }
    if (current_sites.length === 0) {
      onClose();
      return;
    }
    // A comment leaves the site in place, so move on to the next one like a skip
    if (resolution.kind === "comment") {
      advance();
      return;
    }
    if (current_index >= current_sites.length)
      current_index = current_sites.length - 1;
  }

  function skip() {
    if (site) {
      onSkip(site);
      setDecision(site, { kind: "skip" });
    }
    advance();
  }

  function previous() {
    if (current_index > 0) {
      current_index -= 1;
      resetInput();
    }
  }

  function useCustom() {
    const text = custom_text.trim();
    if (!text) return;
    if (custom_mode === "comment")
      apply({ kind: "comment", text });
    else
      apply({ kind: "custom", text });
  }

  function onOptionClick(option: ChoiceOption) {
    if (option.blank) {
      custom_input?.focus();
      return;
    }
    apply({ kind: "option", option });
  }
</script>

{#if site}
  <div class="cmtr-choice-resolver">
    <div class="cmtr-choice-resolver-counter">
      {current_index + 1} of {current_sites.length}{#if site.uid}<span class="cmtr-choice-resolver-uid"> · #{site.uid}</span>{/if}
    </div>
    {#if source_path}
      <div class="cmtr-choice-resolver-source">{source_path}</div>
    {/if}

    <div>
      <div class="cmtr-choice-resolver-label">Context</div>
      <div class="cmtr-choice-resolver-context">
        {site.context.before}<span class="cmtr-choice-resolver-context-target">{site.original}</span>{site.context.after}
      </div>
    </div>

    <div>
      <div class="cmtr-choice-resolver-label">Original</div>
      <div class="cmtr-choice-resolver-block">{site.original}</div>
    </div>

    {#if site.suggested !== undefined}
      <div>
        <div class="cmtr-choice-resolver-label">Suggested</div>
        <div class="cmtr-choice-resolver-block">{site.suggested}</div>
      </div>
    {/if}

    {#if decision && decision.kind !== "skip"}
      <div class="cmtr-choice-resolver-decision">{decisionLine(decision)}</div>
    {/if}

    <div class="cmtr-choice-resolver-options">
      {#each site.spec.options as option, i}
        <button type="button" class:is-active={optionIsActive(option)} onclick={() => onOptionClick(option)}>
          {optionLabel(option, i)}
        </button>
      {/each}
    </div>

    <div class="cmtr-choice-resolver-custom">
      <input
        type="text"
        placeholder={custom_mode === "comment" ? "Comment text" : "Custom replacement"}
        bind:value={custom_text}
        bind:this={custom_input}
        onkeydown={(e) => { if (e.key === "Enter") useCustom(); }}
      />
      <div class="cmtr-choice-resolver-mode">
        <button
          type="button"
          class:is-active={custom_mode === "revision"}
          onclick={() => custom_mode = "revision"}
        >Revision</button>
        <button
          type="button"
          class:is-active={custom_mode === "comment"}
          onclick={() => custom_mode = "comment"}
        >Comment</button>
      </div>
      <button type="button" class="mod-cta" disabled={!custom_text.trim()} onclick={useCustom}>
        {custom_mode === "revision" ? "Use as revision" : "Add comment"}
      </button>
    </div>

    {#if site.spec.note}
      <div class="cmtr-choice-resolver-note">{site.spec.note}</div>
    {/if}

    <div class="cmtr-choice-resolver-footer">
      <button type="button" disabled={current_index === 0} onclick={previous}>Previous</button>
      <button type="button" onclick={skip}>Skip</button>
      <button type="button" onclick={() => apply({ kind: "reject" })}>Reject</button>
      <button type="button" onclick={onClose}>Close</button>
    </div>
  </div>
{/if}
