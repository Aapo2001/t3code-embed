<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/stores";

  import AuthGate from "$lib/components/AuthGate.svelte";
  import HomeView from "$lib/components/HomeView.svelte";
  import SettingsView from "$lib/components/SettingsView.svelte";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import ThreadView from "$lib/components/ThreadView.svelte";
  import { appController } from "$lib/controller";
  import "$lib/styles.css";

  const state = appController.state;

  onMount(() => {
    void appController.bootstrap();
  });

  $: routeId = $page.route.id ?? "";
  $: environmentId = $page.params.environmentId ?? null;
  $: threadId = $page.params.threadId ?? null;
  $: appController.setActiveThread(
    environmentId && threadId
      ? {
          environmentId: environmentId as never,
          threadId: threadId as never,
        }
      : null,
  );
</script>

{#if $state.phase === "auth-required"}
  <AuthGate state={$state} />
{:else if $state.phase === "error"}
  <div class="app-shell" style="grid-template-columns: minmax(0, 1fr);">
    <section class="panel main-panel">
      <div class="panel-scroll center-state">
        <div class="kicker">T3 Code Svelte</div>
        <h1 class="title">The client failed to start</h1>
        <p class="muted">{$state.error ?? "Unknown startup failure."}</p>
        <div class="button-row">
          <button class="button" on:click={() => void appController.retry()}>Retry</button>
        </div>
      </div>
    </section>
  </div>
{:else if $state.phase === "booting" || $state.phase === "connecting"}
  <div class="app-shell" style="grid-template-columns: minmax(0, 1fr);">
    <section class="panel main-panel">
      <div class="panel-scroll center-state">
        <div class="kicker">T3 Code Svelte</div>
        <h1 class="title">Connecting to the backend</h1>
        <p class="muted">
          Reusing the existing T3 websocket server and orchestration pipeline.
        </p>
      </div>
    </section>
  </div>
{:else}
  <div class="app-shell">
    <Sidebar state={$state} />

    {#if routeId === "/settings"}
      <SettingsView state={$state} />
    {:else if threadId}
      <ThreadView state={$state} />
    {:else}
      <HomeView state={$state} />
    {/if}
  </div>
{/if}

<slot />
