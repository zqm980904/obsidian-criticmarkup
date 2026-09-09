<script lang="ts">
  import type { ChoiceOption, ChoiceResolution, ChoiceSite } from "../../editor/base";

  interface Props {
    sites: ChoiceSite[];
    index: number;
    source_path?: string;
    onResolve: (site: ChoiceSite, resolution: ChoiceResolution) => ChoiceSite[];
    onSkip: (site: ChoiceSite) => void;
    onClose: () => void;
  }

  let { sites, index, source_path, onResolve, onSkip, onClose }: Props = $props();

  let current_sites = $state(sites);
  let current_index = $state(index);
  let custom_text = $state("");
  let custom_mode = $state<"revision" | "comment">("revision");
  let custom_input: HTMLInputElement | undefined = $state();

  let site = $derived(current_sites[current_index] as ChoiceSite | undefined);

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

  function apply(resolution: ChoiceResolution) {
    if (!site) return;
    current_sites = onResolve(site, resolution);
    resetInput();
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
    if (site) onSkip(site);
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

    <div class="cmtr-choice-resolver-options">
      {#each site.spec.options as option, i}
        <button type="button" onclick={() => onOptionClick(option)}>
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
