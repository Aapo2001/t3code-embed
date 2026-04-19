<script lang="ts">
  import type { OrchestrationThreadActivity, ProviderUserInputAnswers } from "@t3tools/contracts";
  import type { AppControllerState } from "$lib/controller";
  import { appController, INITIAL_APP_CONTROLLER_STATE } from "$lib/controller";
  import {
    derivePendingApprovals,
    derivePendingUserInputs,
    deriveTimelineEntries,
    formatModelSelection,
    formatRelativeTime,
  } from "$lib/thread";

  export let state: AppControllerState = INITIAL_APP_CONTROLLER_STATE;

  let prompt = "";
  let userInputAnswers: Record<string, ProviderUserInputAnswers> = {};

  $: thread = state.activeThread.thread;
  $: timeline = thread ? deriveTimelineEntries(thread) : [];
  $: pendingApprovals = thread ? derivePendingApprovals(thread.activities) : [];
  $: pendingUserInputs = thread ? derivePendingUserInputs(thread.activities) : [];

  function activityDetail(activity: OrchestrationThreadActivity): string | null {
    if (typeof activity.payload === "object" && activity.payload && "detail" in activity.payload) {
      const detail = (activity.payload as { detail?: unknown }).detail;
      return typeof detail === "string" && detail.trim().length > 0 ? detail : null;
    }

    return null;
  }

  function activityTone(activity: OrchestrationThreadActivity): "ready" | "warning" | "error" | "info" {
    switch (activity.tone) {
      case "error":
        return "error";
      case "approval":
        return "warning";
      case "tool":
        return "info";
      default:
        return "ready";
    }
  }

  async function sendMessage() {
    const nextPrompt = prompt.trim();
    if (!nextPrompt) {
      return;
    }

    await appController.sendMessage(nextPrompt);
    prompt = "";
  }

  function updateUserInputAnswer(requestId: string, questionId: string, value: string) {
    userInputAnswers = {
      ...userInputAnswers,
      [requestId]: {
        ...userInputAnswers[requestId],
        [questionId]: value,
      },
    };
  }

  async function submitUserInput(requestId: string) {
    const answers = userInputAnswers[requestId];
    if (!answers) {
      return;
    }

    await appController.respondToUserInput(requestId, answers);
  }
</script>

{#if !thread}
  <div class="panel main-panel">
    <div class="panel-scroll center-state">
      <div class="kicker">Thread</div>
      <h1 class="title">Loading thread</h1>
      <p class="muted">{state.activeThread.error ?? "Waiting for the thread snapshot."}</p>
    </div>
  </div>
{:else}
  <div class="panel main-panel">
    <div class="panel-header stack">
      <div class="title-row">
        <div>
          <div class="kicker">Thread</div>
          <h1 class="title">{thread.title}</h1>
        </div>
        <div class="button-row">
          <button class="button secondary" disabled={state.isMutating} on:click={() => void appController.stopActiveThread()}>
            Stop
          </button>
        </div>
      </div>

      <div class="chip-row">
        <span class="chip">{formatModelSelection(thread.modelSelection)}</span>
        <span class="chip">{thread.runtimeMode}</span>
        <span class="chip">{thread.interactionMode}</span>
        <span class="chip">{thread.session?.status ?? "idle"}</span>
        <span class="chip">{formatRelativeTime(thread.updatedAt ?? thread.createdAt)}</span>
      </div>
    </div>

    <div class="panel-scroll stack">
      {#if pendingApprovals.length > 0}
        <section class="timeline-card approval-card stack">
          <div class="message-role">Approvals required</div>
          {#each pendingApprovals as approval}
            <div class="stack">
              <div><strong>{approval.requestKind}</strong></div>
              {#if approval.detail}
                <div class="muted">{approval.detail}</div>
              {/if}
              <div class="button-row">
                <button class="button" disabled={state.isMutating} on:click={() => void appController.respondToApproval(approval.requestId, "accept")}>
                  Accept
                </button>
                <button class="button secondary" disabled={state.isMutating} on:click={() => void appController.respondToApproval(approval.requestId, "acceptForSession")}>
                  Accept for Session
                </button>
                <button class="button secondary" disabled={state.isMutating} on:click={() => void appController.respondToApproval(approval.requestId, "decline")}>
                  Decline
                </button>
              </div>
            </div>
          {/each}
        </section>
      {/if}

      {#if pendingUserInputs.length > 0}
        <section class="timeline-card stack">
          <div class="message-role">Questions pending</div>
          {#each pendingUserInputs as request}
            <div class="stack">
              {#each request.questions as question}
                <div class="field">
                  <label for={`${request.requestId}:${question.id}`}>{question.header}</label>
                  <div class="muted">{question.question}</div>
                  <select
                    id={`${request.requestId}:${question.id}`}
                    class="select"
                    value={(userInputAnswers[request.requestId] as Record<string, string> | undefined)?.[question.id] ?? ""}
                    on:change={(event) =>
                      updateUserInputAnswer(
                        request.requestId,
                        question.id,
                        (event.currentTarget as HTMLSelectElement).value,
                      )}
                  >
                    <option value="">Choose an answer</option>
                    {#each question.options as option}
                      <option value={option.label}>{option.label}</option>
                    {/each}
                  </select>
                </div>
              {/each}

              <div class="button-row">
                <button class="button" disabled={state.isMutating} on:click={() => void submitUserInput(request.requestId)}>
                  Submit answers
                </button>
              </div>
            </div>
          {/each}
        </section>
      {/if}

      <section class="timeline">
        {#each timeline as entry}
          {#if entry.kind === "message"}
            <article class="timeline-card message-card" data-role={entry.value.role}>
              <div class="message-role">{entry.value.role}</div>
              <div class="message-body">{entry.value.text}</div>
            </article>
          {:else if entry.kind === "activity"}
            <article class="timeline-card">
              <div class="title-row">
                <div class="message-role">{entry.value.kind}</div>
                <span class="chip" data-tone={activityTone(entry.value)}>{entry.value.tone}</span>
              </div>
              <div style="margin-top: 8px; font-weight: 700;">{entry.value.summary}</div>
              {#if activityDetail(entry.value)}
                <div class="activity-detail">{activityDetail(entry.value)}</div>
              {/if}
            </article>
          {:else}
            <article class="timeline-card">
              <div class="message-role">Proposed plan</div>
              <div class="proposed-plan-body">{entry.value.planMarkdown}</div>
            </article>
          {/if}
        {/each}
      </section>
    </div>

    <div class="panel-footer">
      <div class="composer">
        <textarea
          class="textarea"
          bind:value={prompt}
          placeholder="Send a follow-up prompt"
          disabled={state.isMutating || thread.archivedAt !== null}
          on:keydown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void sendMessage();
            }
          }}
        ></textarea>
        <div class="button-row">
          <button
            class="button"
            disabled={state.isMutating || prompt.trim().length === 0 || thread.archivedAt !== null}
            on:click={() => void sendMessage()}
          >
            {state.isMutating ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
