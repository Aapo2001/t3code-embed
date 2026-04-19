<script lang="ts">
  import type { AppControllerState } from "$lib/controller";
  import { appController, INITIAL_APP_CONTROLLER_STATE } from "$lib/controller";
  import { describeAuthPolicy } from "$lib/thread";

  export let state: AppControllerState = INITIAL_APP_CONTROLLER_STATE;

  let credential = "";
  let submitting = false;
  let localError: string | null = null;

  async function submitCredential() {
    localError = null;
    submitting = true;

    try {
      await appController.authenticate(credential);
      credential = "";
    } catch (error) {
      localError = error instanceof Error ? error.message : String(error);
    } finally {
      submitting = false;
    }
  }
</script>

<div class="app-shell" style="grid-template-columns: minmax(0, 1fr);">
  <section class="panel main-panel">
    <div class="panel-scroll center-state">
      <div class="kicker">T3 Code Svelte</div>
      <div class="stack" style="max-width: 520px;">
        <h1 class="title">Authentication required</h1>
        <p class="muted">
          {describeAuthPolicy(state.authSession?.auth.policy)}
        </p>

        <div class="field">
          <label for="pairing-token">Pairing token</label>
          <input
            id="pairing-token"
            class="input"
            bind:value={credential}
            placeholder="Paste a one-time token or local bootstrap credential"
            on:keydown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submitCredential();
              }
            }}
          />
        </div>

        {#if state.error || localError}
          <div class="chip" data-tone="error">{localError ?? state.error}</div>
        {/if}

        <div class="button-row" style="justify-content: center;">
          <button class="button" disabled={submitting || credential.trim().length === 0} on:click={() => void submitCredential()}>
            {submitting ? "Connecting…" : "Authenticate"}
          </button>
          <button class="button secondary" on:click={() => void appController.retry()}>
            Retry bootstrap
          </button>
        </div>
      </div>
    </div>
  </section>
</div>
