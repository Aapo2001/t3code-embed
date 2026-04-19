<script lang="ts">
  import { goto } from "$app/navigation";
  import type { AppControllerState } from "$lib/controller";
  import { appController, INITIAL_APP_CONTROLLER_STATE } from "$lib/controller";
  import {
    formatModelSelection,
    getAvailableModelSelections,
    INTERACTION_MODE_OPTIONS,
    parseModelSelection,
    pickDefaultModelSelection,
    RUNTIME_MODE_OPTIONS,
    sortProjectShells,
  } from "$lib/thread";

  export let state: AppControllerState = INITIAL_APP_CONTROLLER_STATE;

  let projectTitle = "";
  let workspaceRoot = "";
  let prompt = "";
  let selectedProjectId = "";
  let selectedModelValue = "";
  let runtimeMode = "full-access";
  let interactionMode = "default";

  $: projects = sortProjectShells(state.shellSnapshot?.projects ?? []);
  $: if (!projects.some((project) => project.id === selectedProjectId)) {
    selectedProjectId = projects[0]?.id ?? "";
  }
  $: selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  $: availableModels = getAvailableModelSelections(state.serverConfig);
  $: defaultModelSelection = pickDefaultModelSelection({
    config: state.serverConfig,
    project: selectedProject,
  });
  $: if (
    selectedModelValue.length === 0 ||
    !availableModels.some((selection) => formatModelSelection(selection) === selectedModelValue)
  ) {
    selectedModelValue = defaultModelSelection ? formatModelSelection(defaultModelSelection) : "";
  }

  async function addProject() {
    await appController.createProject({
      title: projectTitle,
      workspaceRoot,
    });
    projectTitle = "";
    workspaceRoot = "";
  }

  async function startThread() {
    const modelSelection = parseModelSelection(selectedModelValue, state.serverConfig, selectedProject);
    if (!selectedProject || !modelSelection) {
      return;
    }

    const route = await appController.startNewThread({
      projectId: selectedProject.id,
      prompt,
      modelSelection,
      runtimeMode: runtimeMode as "approval-required" | "auto-accept-edits" | "full-access",
      interactionMode: interactionMode as "default" | "plan",
    });
    prompt = "";
    await goto(`/${route}`);
  }
</script>

<div class="panel main-panel">
  <div class="panel-header">
    <div class="kicker">Home</div>
    <h1 class="title">Start a new thread</h1>
  </div>

  <div class="panel-scroll stack">
    {#if projects.length === 0}
      <section class="empty-state">
        <div>
          <div class="message-role">Project setup</div>
          <h2 style="margin: 6px 0 0;">Add a workspace</h2>
          <p class="muted">
            The SvelteKit client reuses the existing T3 backend. Start by adding a project workspace root,
            then create a thread and send your first prompt.
          </p>
        </div>

        <div class="split-grid">
          <div class="field">
            <label for="project-title">Project name</label>
            <input id="project-title" class="input" bind:value={projectTitle} placeholder="My repo" />
          </div>
          <div class="field">
            <label for="workspace-root">Workspace root</label>
            <input
              id="workspace-root"
              class="input"
              bind:value={workspaceRoot}
              placeholder="C:\Users\you\code\repo"
            />
          </div>
        </div>

        <div class="button-row">
          <button
            class="button"
            disabled={state.isMutating || projectTitle.trim().length === 0 || workspaceRoot.trim().length === 0}
            on:click={() => void addProject()}
          >
            {state.isMutating ? "Creating…" : "Create project"}
          </button>
        </div>
      </section>
    {:else}
      <section class="stack">
        <div class="message-role">Thread bootstrap</div>

        <div class="split-grid">
          <div class="field">
            <label for="project-select">Project</label>
            <select id="project-select" class="select" bind:value={selectedProjectId}>
              {#each projects as project}
                <option value={project.id}>{project.title}</option>
              {/each}
            </select>
          </div>

          <div class="field">
            <label for="model-select">Model</label>
            <select id="model-select" class="select" bind:value={selectedModelValue}>
              {#each availableModels as selection}
                <option value={formatModelSelection(selection)}>{formatModelSelection(selection)}</option>
              {/each}
            </select>
          </div>

          <div class="field">
            <label for="runtime-mode">Runtime mode</label>
            <select id="runtime-mode" class="select" bind:value={runtimeMode}>
              {#each RUNTIME_MODE_OPTIONS as option}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </div>

          <div class="field">
            <label for="interaction-mode">Interaction mode</label>
            <select id="interaction-mode" class="select" bind:value={interactionMode}>
              {#each INTERACTION_MODE_OPTIONS as option}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </div>
        </div>

        <div class="field">
          <label for="starter-prompt">First message</label>
          <textarea
            id="starter-prompt"
            class="textarea"
            bind:value={prompt}
            placeholder="Describe the change you want the agent to make."
            on:keydown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void startThread();
              }
            }}
          ></textarea>
        </div>

        <div class="button-row">
          <button
            class="button"
            disabled={state.isMutating || !selectedProject || !selectedModelValue || prompt.trim().length === 0}
            on:click={() => void startThread()}
          >
            {state.isMutating ? "Starting…" : "Create thread and send"}
          </button>
        </div>

        <section class="timeline-card">
          <div class="message-role">Need another project?</div>
          <div class="split-grid" style="margin-top: 12px;">
            <div class="field">
              <label for="secondary-project-title">Project name</label>
              <input id="secondary-project-title" class="input" bind:value={projectTitle} />
            </div>
            <div class="field">
              <label for="secondary-workspace-root">Workspace root</label>
              <input id="secondary-workspace-root" class="input" bind:value={workspaceRoot} />
            </div>
          </div>
          <div class="button-row" style="margin-top: 12px;">
            <button
              class="button secondary"
              disabled={state.isMutating || projectTitle.trim().length === 0 || workspaceRoot.trim().length === 0}
              on:click={() => void addProject()}
            >
              Add project
            </button>
          </div>
        </section>
      </section>
    {/if}
  </div>
</div>
