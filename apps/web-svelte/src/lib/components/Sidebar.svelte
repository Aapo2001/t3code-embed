<script lang="ts">
  import { goto } from "$app/navigation";
  import type { AppControllerState } from "$lib/controller";
  import { INITIAL_APP_CONTROLLER_STATE } from "$lib/controller";
  import {
    formatRelativeTime,
    formatThreadStatus,
    groupThreadsByProject,
    sortProjectShells,
  } from "$lib/thread";

  export let state: AppControllerState = INITIAL_APP_CONTROLLER_STATE;

  $: projects = sortProjectShells(state.shellSnapshot?.projects ?? []);
  $: threadsByProject = groupThreadsByProject(state.shellSnapshot?.threads ?? []);
  $: environmentId = state.environment?.environmentId ?? "";

  function openThread(threadId: string) {
    if (!environmentId) {
      return;
    }

    void goto(`/${environmentId}/${threadId}`);
  }
</script>

<aside class="panel sidebar-panel">
  <div class="sidebar-header stack">
    <div class="kicker">T3 Code Svelte</div>
    <div class="title-row">
      <div>
        <div class="sidebar-project-title">{state.environment?.label ?? "Local environment"}</div>
        <div class="muted" style="font-size: 13px;">{state.connection}</div>
      </div>
      <span class="chip" data-tone={state.connection === "connected" ? "ready" : "warning"}>
        {state.connection}
      </span>
    </div>
    <div class="button-row">
      <button class="button" on:click={() => void goto("/")}>New Thread</button>
      <button class="button secondary" on:click={() => void goto("/settings")}>Settings</button>
    </div>
  </div>

  <div class="sidebar-scroll">
    {#if projects.length === 0}
      <div class="sidebar-project">
        <div class="sidebar-project-title">No projects yet</div>
        <div class="sidebar-project-path">Create a project from the home view to start chatting.</div>
      </div>
    {:else}
      <div class="sidebar-section">
        {#each projects as project}
          <section class="sidebar-project">
            <div class="sidebar-project-title">{project.title}</div>
            <div class="sidebar-project-path">{project.workspaceRoot}</div>

            <div class="thread-list">
              {#if (threadsByProject.get(project.id) ?? []).length === 0}
                <div class="muted" style="font-size: 13px;">No threads yet.</div>
              {:else}
                {#each threadsByProject.get(project.id) ?? [] as thread}
                  <button
                    class:active={state.activeThreadRef?.threadId === thread.id}
                    class="thread-link"
                    on:click={() => openThread(thread.id)}
                  >
                    <div class="thread-link-title">{thread.title}</div>
                    <div class="thread-link-meta">
                      <span>{formatThreadStatus(thread)}</span>
                      <span>{formatRelativeTime(thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt)}</span>
                    </div>
                  </button>
                {/each}
              {/if}
            </div>
          </section>
        {/each}
      </div>
    {/if}
  </div>
</aside>
