<script lang="ts">
  import type { AppControllerState } from "$lib/controller";
  import { INITIAL_APP_CONTROLLER_STATE } from "$lib/controller";
  import { providerStatusTone } from "$lib/thread";

  export let state: AppControllerState = INITIAL_APP_CONTROLLER_STATE;
</script>

<div class="panel main-panel">
  <div class="panel-header">
    <div class="kicker">Settings</div>
    <h1 class="title">Environment and providers</h1>
  </div>

  <div class="panel-scroll stack">
    <section class="settings-grid">
      <article class="timeline-card">
        <div class="message-role">Environment</div>
        <div class="stack" style="margin-top: 10px;">
          <div><strong>Label:</strong> {state.environment?.label ?? "Unknown"}</div>
          <div><strong>Version:</strong> {state.environment?.serverVersion ?? "Unknown"}</div>
          <div>
            <strong>Platform:</strong>
            {state.environment ? `${state.environment.platform.os}/${state.environment.platform.arch}` : "Unknown"}
          </div>
        </div>
      </article>

      <article class="timeline-card">
        <div class="message-role">Auth Policy</div>
        <div class="stack" style="margin-top: 10px;">
          <div><strong>Policy:</strong> {state.authSession?.auth.policy ?? "Unknown"}</div>
          <div><strong>Authenticated:</strong> {state.authSession?.authenticated ? "Yes" : "No"}</div>
          <div><strong>Session:</strong> {state.authSession?.sessionMethod ?? "None"}</div>
        </div>
      </article>
    </section>

    <section class="stack">
      <div class="message-role">Providers</div>
      <div class="settings-grid">
        {#each state.serverConfig?.providers ?? [] as provider}
          <article class="timeline-card">
            <div class="title-row">
              <div>
                <div class="sidebar-project-title">{provider.provider}</div>
                <div class="muted" style="font-size: 13px;">
                  {provider.auth.label ?? provider.auth.status}
                </div>
              </div>
              <span class="chip" data-tone={providerStatusTone(provider)}>{provider.status}</span>
            </div>

            <div class="stack" style="margin-top: 14px;">
              <div><strong>Installed:</strong> {provider.installed ? "Yes" : "No"}</div>
              <div><strong>Enabled:</strong> {provider.enabled ? "Yes" : "No"}</div>
              <div><strong>Models:</strong> {provider.models.length}</div>
            </div>
          </article>
        {/each}
      </div>
    </section>
  </div>
</div>
