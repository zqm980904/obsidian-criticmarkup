<script lang="ts">
  import type { ChoiceOption, ChoiceResolution, ChoiceSite } from "../../editor/base";

  interface Props {
    sites: ChoiceSite[];
    index: number;
    onResolve: (site: ChoiceSite, resolution: ChoiceResolution) => ChoiceSite[];
    onClose: () => void;
  }

  let { sites, index, onResolve, onClose }: Props = $props();

  let current_sites = $state(sites);
  let current_index = $state(index);
  let custom_text = $state("");
  let custom_input: HTMLInputElement | undefined = $state();

  let site = $derived(current_sites[current_index] as ChoiceSite | undefined);

  function optionLetter(option: ChoiceOption, i: number): string {
    return option.label ?? String.fromCharCode(97 + i);
  }

  function optionLabel(option: ChoiceOption, i: number): string {
    const letter = optionLetter(option, i);
    return option.blank ? `(${letter}) Custom…` : `(${letter}) ${option.text}`;
  }

  function apply(resolution: ChoiceResolution) {
    if (!site) return;
    current_sites = onResolve(site, resolution);
    custom_text = "";
    if (current_sites.length === 0) {
      onClose();
      return;
    }
    if (current_index >= current_sites.length)
      current_index = current_sites.length - 1;
  }

  function skip() {
    if (current_index >= current_sites.length - 1) {
      onClose();
      return;
    }
    current_index += 1;
    custom_text = "";
  }

  function previous() {
    if (current_index > 0) {
      current_index -= 1;
      custom_text = "";
    }
  }

  function useCustom() {
    const text = custom_text.trim();
    if (!text) return;
    apply({ kind: "text", text });
  }

  function onOptionClick(option: ChoiceOption) {
    if (option.blank) {
      custom_input?.focus();
      return;
    }
    apply({ kind: "text", text: option.text });
  }
</script>

{#if site}
  <div class="cmtr-choice-resolver">
    <div class="cmtr-choice-resolver-counter">{current_index + 1} of {current_sites.length}</div>

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
        placeholder="Custom replacement"
        bind:value={custom_text}
        bind:this={custom_input}
        onkeydown={(e) => { if (e.key === "Enter") useCustom(); }}
      />
      <button type="button" class="mod-cta" disabled={!custom_text.trim()} onclick={useCustom}>
        Use custom
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
