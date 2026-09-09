<script lang="ts">
  interface Row {
    uid: string;
    original?: string;
    summary: string;
  }

  interface Props {
    rows: Row[];
    onRevert: (uids: string[]) => void;
    onClose: () => void;
  }

  let { rows, onRevert, onClose }: Props = $props();

  let items = $state(rows.map(row => ({ ...row, checked: true })));
  let unticked = $derived(items.filter(item => !item.checked).map(item => item.uid));
</script>

<div class="cmtr-revert-choices">
  <div class="cmtr-revert-choices-list">
    {#each items as item, i}
      <label class="cmtr-revert-choices-row">
        <input type="checkbox" bind:checked={items[i].checked} />
        <span class="cmtr-revert-choices-uid">#{item.uid}</span>
        {#if item.original !== undefined}
          <span class="cmtr-revert-choices-original">{item.original}</span>
        {/if}
        <span class="cmtr-revert-choices-summary">{item.summary}</span>
      </label>
    {/each}
  </div>
  <div class="cmtr-revert-choices-footer">
    <button type="button" disabled={unticked.length === 0} onclick={() => onRevert(unticked)}>
      Revert unticked
    </button>
    <button type="button" onclick={onClose}>Close</button>
  </div>
</div>
