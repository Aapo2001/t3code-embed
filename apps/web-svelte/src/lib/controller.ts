import type {
  AuthSessionState,
  ExecutionEnvironmentDescriptor,
  ModelSelection,
  OrchestrationCheckpointSummary,
  OrchestrationEvent,
  OrchestrationProjectShell,
  OrchestrationShellSnapshot,
  OrchestrationThread,
  OrchestrationThreadActivity,
  OrchestrationThreadShell,
  ProviderApprovalDecision,
  ProviderUserInputAnswers,
  ScopedThreadRef,
  ServerConfig,
} from "@t3tools/contracts";
import { get } from "svelte/store";
import { writable, type Writable } from "svelte/store";

import {
  attemptSilentAuthentication,
  exchangeBootstrapCredential,
  fetchEnvironmentDescriptor,
  fetchSessionState,
  readDesktopManagedCredential,
} from "./auth";
import { takePairingTokenFromUrl, readPrimaryEnvironmentTarget } from "./environment";
import { newCommandId, newMessageId, newProjectId, newThreadId, nowIso } from "./ids";
import { createRpcClient, type AppRpcClient } from "./rpc";

type Phase = "booting" | "auth-required" | "connecting" | "ready" | "error";
type ConnectionPhase = "idle" | "connecting" | "connected" | "reconnecting" | "error";

export interface AppControllerState {
  readonly phase: Phase;
  readonly connection: ConnectionPhase;
  readonly error: string | null;
  readonly authSession: AuthSessionState | null;
  readonly environment: ExecutionEnvironmentDescriptor | null;
  readonly serverConfig: ServerConfig | null;
  readonly shellSnapshot: OrchestrationShellSnapshot | null;
  readonly activeThreadRef: ScopedThreadRef | null;
  readonly activeThread: {
    readonly loading: boolean;
    readonly error: string | null;
    readonly thread: OrchestrationThread | null;
  };
  readonly isMutating: boolean;
}

export const INITIAL_APP_CONTROLLER_STATE: AppControllerState = {
  phase: "booting",
  connection: "idle",
  error: null,
  authSession: null,
  environment: null,
  serverConfig: null,
  shellSnapshot: null,
  activeThreadRef: null,
  activeThread: {
    loading: false,
    error: null,
    thread: null,
  },
  isMutating: false,
};

function sameThreadRef(
  left: ScopedThreadRef | null | undefined,
  right: ScopedThreadRef | null | undefined,
): boolean {
  return left?.environmentId === right?.environmentId && left?.threadId === right?.threadId;
}

function upsertById<T extends { readonly id: string }>(
  entries: ReadonlyArray<T>,
  nextEntry: T,
): T[] {
  return [...entries.filter((entry) => entry.id !== nextEntry.id), nextEntry];
}

function upsertCheckpoint(
  entries: ReadonlyArray<OrchestrationCheckpointSummary>,
  nextEntry: OrchestrationCheckpointSummary,
): OrchestrationCheckpointSummary[] {
  return [...entries.filter((entry) => entry.turnId !== nextEntry.turnId), nextEntry].toSorted(
    (left, right) =>
      (left.checkpointTurnCount ?? Number.MAX_SAFE_INTEGER) -
      (right.checkpointTurnCount ?? Number.MAX_SAFE_INTEGER),
  );
}

function applyShellEvent(
  snapshot: OrchestrationShellSnapshot | null,
  event:
    | OrchestrationEvent
    | {
        kind: string;
        project?: OrchestrationProjectShell;
        thread?: OrchestrationThreadShell;
        projectId?: string;
        threadId?: string;
      },
): OrchestrationShellSnapshot | null {
  if (!snapshot) {
    return snapshot;
  }

  if ("sequence" in event && "type" in event) {
    return snapshot;
  }

  switch (event.kind) {
    case "project-upserted":
      return {
        ...snapshot,
        projects: upsertById(snapshot.projects, event.project!),
      };
    case "project-removed":
      return {
        ...snapshot,
        projects: snapshot.projects.filter((project) => project.id !== event.projectId),
        threads: snapshot.threads.filter((thread) => thread.projectId !== event.projectId),
      };
    case "thread-upserted":
      return {
        ...snapshot,
        threads: upsertById(snapshot.threads, event.thread!),
      };
    case "thread-removed":
      return {
        ...snapshot,
        threads: snapshot.threads.filter((thread) => thread.id !== event.threadId),
      };
    default:
      return snapshot;
  }
}

function applyServerConfigEvent(
  current: ServerConfig | null,
  event: {
    readonly type: string;
    readonly config?: ServerConfig;
    readonly payload?: Record<string, unknown>;
  },
): ServerConfig | null {
  if (event.type === "snapshot" && event.config) {
    return event.config;
  }

  if (!current || !event.payload) {
    return current;
  }

  switch (event.type) {
    case "providerStatuses":
      return {
        ...current,
        providers: (event.payload.providers as ServerConfig["providers"]) ?? current.providers,
      };
    case "settingsUpdated":
      return {
        ...current,
        settings: (event.payload.settings as ServerConfig["settings"]) ?? current.settings,
      };
    case "keybindingsUpdated":
      return {
        ...current,
        issues: (event.payload.issues as ServerConfig["issues"]) ?? current.issues,
      };
    default:
      return current;
  }
}

function applyThreadEvent(
  thread: OrchestrationThread,
  event: OrchestrationEvent,
): { readonly thread: OrchestrationThread | null; readonly refresh: boolean } {
  switch (event.type) {
    case "thread.meta-updated":
      return {
        refresh: false,
        thread: {
          ...thread,
          ...(event.payload.title ? { title: event.payload.title } : {}),
          ...(event.payload.modelSelection ? { modelSelection: event.payload.modelSelection } : {}),
          ...(event.payload.branch !== undefined ? { branch: event.payload.branch } : {}),
          ...(event.payload.worktreePath !== undefined
            ? { worktreePath: event.payload.worktreePath }
            : {}),
          updatedAt: event.payload.updatedAt,
        },
      };
    case "thread.runtime-mode-set":
      return {
        refresh: false,
        thread: {
          ...thread,
          runtimeMode: event.payload.runtimeMode,
          updatedAt: event.payload.updatedAt,
        },
      };
    case "thread.interaction-mode-set":
      return {
        refresh: false,
        thread: {
          ...thread,
          interactionMode: event.payload.interactionMode,
          updatedAt: event.payload.updatedAt,
        },
      };
    case "thread.message-sent": {
      const nextMessage = {
        id: event.payload.messageId,
        role: event.payload.role,
        text: event.payload.text,
        attachments: event.payload.attachments,
        turnId: event.payload.turnId,
        streaming: event.payload.streaming,
        createdAt: event.payload.createdAt,
        updatedAt: event.payload.updatedAt,
      };

      return {
        refresh: false,
        thread: {
          ...thread,
          messages: upsertById(thread.messages, nextMessage),
          updatedAt: event.occurredAt,
        },
      };
    }
    case "thread.session-set":
      return {
        refresh: false,
        thread: {
          ...thread,
          session: event.payload.session,
          updatedAt: event.occurredAt,
        },
      };
    case "thread.activity-appended":
      return {
        refresh: false,
        thread: {
          ...thread,
          activities: upsertById<OrchestrationThreadActivity>(
            thread.activities,
            event.payload.activity,
          ).toSorted(
            (left, right) =>
              left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
          ),
          updatedAt: event.occurredAt,
        },
      };
    case "thread.proposed-plan-upserted":
      return {
        refresh: false,
        thread: {
          ...thread,
          proposedPlans: upsertById(thread.proposedPlans, event.payload.proposedPlan).toSorted(
            (left, right) =>
              left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
          ),
          updatedAt: event.occurredAt,
        },
      };
    case "thread.turn-diff-completed":
      return {
        refresh: false,
        thread: {
          ...thread,
          checkpoints: upsertCheckpoint(thread.checkpoints, {
            turnId: event.payload.turnId,
            checkpointTurnCount: event.payload.checkpointTurnCount,
            checkpointRef: event.payload.checkpointRef,
            status: event.payload.status,
            files: event.payload.files,
            assistantMessageId: event.payload.assistantMessageId,
            completedAt: event.payload.completedAt,
          }),
          updatedAt: event.occurredAt,
        },
      };
    case "thread.archived":
      return {
        refresh: false,
        thread: {
          ...thread,
          archivedAt: event.payload.archivedAt,
          updatedAt: event.payload.updatedAt,
        },
      };
    case "thread.unarchived":
      return {
        refresh: false,
        thread: {
          ...thread,
          archivedAt: null,
          updatedAt: event.payload.updatedAt,
        },
      };
    case "thread.deleted":
      return {
        refresh: false,
        thread: null,
      };
    case "thread.reverted":
      return {
        refresh: true,
        thread,
      };
    default:
      return {
        refresh: false,
        thread,
      };
  }
}

export class AppController {
  readonly state: Writable<AppControllerState> = writable(INITIAL_APP_CONTROLLER_STATE);

  private client: AppRpcClient | null = null;
  private shellUnsubscribe: (() => void) | null = null;
  private configUnsubscribe: (() => void) | null = null;
  private lifecycleUnsubscribe: (() => void) | null = null;
  private threadUnsubscribe: (() => void) | null = null;
  private bootstrapPromise: Promise<void> | null = null;
  private refreshThreadTimeout: ReturnType<typeof setTimeout> | null = null;

  private patch(updater: (current: AppControllerState) => AppControllerState): void {
    this.state.update(updater);
  }

  private async disposeClient(): Promise<void> {
    this.clearActiveThreadSubscription();
    this.shellUnsubscribe?.();
    this.configUnsubscribe?.();
    this.lifecycleUnsubscribe?.();
    this.shellUnsubscribe = null;
    this.configUnsubscribe = null;
    this.lifecycleUnsubscribe = null;
    await this.client?.dispose();
    this.client = null;
  }

  private clearActiveThreadSubscription(): void {
    if (this.refreshThreadTimeout) {
      clearTimeout(this.refreshThreadTimeout);
      this.refreshThreadTimeout = null;
    }
    this.threadUnsubscribe?.();
    this.threadUnsubscribe = null;
  }

  async bootstrap(): Promise<void> {
    if (this.bootstrapPromise) {
      return this.bootstrapPromise;
    }

    this.bootstrapPromise = this.performBootstrap().finally(() => {
      this.bootstrapPromise = null;
    });

    return this.bootstrapPromise;
  }

  private async performBootstrap(): Promise<void> {
    this.patch((current) => ({
      ...current,
      phase: "booting",
      error: null,
    }));

    try {
      const descriptor = await fetchEnvironmentDescriptor();
      this.patch((current) => ({
        ...current,
        environment: descriptor,
      }));

      let session = await fetchSessionState();
      this.patch((current) => ({
        ...current,
        authSession: session,
      }));

      if (!session.authenticated) {
        const bootstrapCredential = takePairingTokenFromUrl() ?? readDesktopManagedCredential();
        const authenticatedSession = await attemptSilentAuthentication(bootstrapCredential);
        if (authenticatedSession) {
          session = authenticatedSession;
          this.patch((current) => ({
            ...current,
            authSession: authenticatedSession,
          }));
        }
      }

      if (!session.authenticated) {
        this.patch((current) => ({
          ...current,
          phase: "auth-required",
          error: null,
        }));
        return;
      }

      await this.initializeRpc();
    } catch (error) {
      this.patch((current) => ({
        ...current,
        phase: "error",
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async authenticate(credential: string): Promise<void> {
    this.patch((current) => ({
      ...current,
      phase: "booting",
      error: null,
    }));

    await exchangeBootstrapCredential(credential.trim());
    await this.bootstrap();
  }

  retry(): Promise<void> {
    return this.bootstrap();
  }

  private async initializeRpc(): Promise<void> {
    await this.disposeClient();

    const target = readPrimaryEnvironmentTarget();
    if (!target) {
      throw new Error("Unable to resolve the primary environment target.");
    }

    let resolveShellReady!: () => void;
    const shellReady = new Promise<void>((resolve) => {
      resolveShellReady = resolve;
    });

    this.patch((current) => ({
      ...current,
      phase: "connecting",
      connection: "connecting",
    }));

    this.client = createRpcClient(target.target.wsBaseUrl, {
      onAttempt: () => {
        this.patch((current) => ({
          ...current,
          connection: current.connection === "connected" ? "reconnecting" : "connecting",
        }));
      },
      onOpen: () => {
        this.patch((current) => ({
          ...current,
          connection: "connected",
        }));
      },
      onError: (message) => {
        this.patch((current) => ({
          ...current,
          connection: "error",
          error: current.phase === "ready" ? current.error : message,
        }));
      },
      onClose: () => {
        this.patch((current) => ({
          ...current,
          connection: "reconnecting",
        }));
      },
    });

    this.configUnsubscribe = this.client.server.subscribeConfig((event) => {
      this.patch((current) => ({
        ...current,
        serverConfig: applyServerConfigEvent(current.serverConfig, event as never),
      }));
    });

    this.lifecycleUnsubscribe = this.client.server.subscribeLifecycle((event) => {
      if (event.type !== "welcome") {
        return;
      }

      this.patch((current) => ({
        ...current,
        environment: event.payload.environment,
      }));
    });

    this.shellUnsubscribe = this.client.orchestration.subscribeShell(
      (item) => {
        if (item.kind === "snapshot") {
          this.patch((current) => ({
            ...current,
            shellSnapshot: item.snapshot,
            phase: "ready",
            error: null,
          }));
          resolveShellReady();
          return;
        }

        this.patch((current) => ({
          ...current,
          shellSnapshot: applyShellEvent(current.shellSnapshot, item),
        }));
      },
      {
        onResubscribe: () => {
          this.patch((current) => ({
            ...current,
            connection: "reconnecting",
          }));
        },
      },
    );

    const config = await this.client.server.getConfig();
    this.patch((current) => ({
      ...current,
      serverConfig: config,
      environment: config.environment,
      authSession: current.authSession,
    }));

    await shellReady;
    this.patch((current) => ({
      ...current,
      phase: "ready",
      error: null,
    }));

    await this.syncActiveThreadSubscription();
  }

  setActiveThread(ref: ScopedThreadRef | null): void {
    const current = get(this.state);
    if (sameThreadRef(current.activeThreadRef, ref)) {
      return;
    }

    this.patch((state) => ({
      ...state,
      activeThreadRef: ref,
      activeThread: ref
        ? {
            loading: true,
            error: null,
            thread: null,
          }
        : {
            loading: false,
            error: null,
            thread: null,
          },
    }));

    void this.syncActiveThreadSubscription();
  }

  private scheduleActiveThreadRefresh(): void {
    if (this.refreshThreadTimeout) {
      return;
    }

    this.refreshThreadTimeout = setTimeout(() => {
      this.refreshThreadTimeout = null;
      void this.syncActiveThreadSubscription();
    }, 50);
  }

  private async syncActiveThreadSubscription(): Promise<void> {
    this.clearActiveThreadSubscription();

    const current = get(this.state);
    const ref = current.activeThreadRef;
    if (!ref || !this.client || current.phase !== "ready") {
      return;
    }

    this.patch((state) => ({
      ...state,
      activeThread: {
        loading: true,
        error: null,
        thread: state.activeThread.thread,
      },
    }));

    this.threadUnsubscribe = this.client.orchestration.subscribeThread(
      { threadId: ref.threadId },
      (item) => {
        const latestState = get(this.state);
        if (!sameThreadRef(latestState.activeThreadRef, ref)) {
          return;
        }

        if (item.kind === "snapshot") {
          this.patch((state) => ({
            ...state,
            activeThread: {
              loading: false,
              error: null,
              thread: item.snapshot.thread,
            },
          }));
          return;
        }

        this.patch((state) => {
          if (!sameThreadRef(state.activeThreadRef, ref) || !state.activeThread.thread) {
            return state;
          }

          const applied = applyThreadEvent(state.activeThread.thread, item.event);
          if (applied.refresh) {
            this.scheduleActiveThreadRefresh();
          }

          return {
            ...state,
            activeThread: {
              loading: false,
              error: null,
              thread: applied.thread,
            },
          };
        });
      },
      {
        onResubscribe: () => {
          this.patch((state) => ({
            ...state,
            activeThread: {
              ...state.activeThread,
              loading: true,
            },
          }));
        },
      },
    );
  }

  private async runMutation<T>(operation: () => Promise<T>): Promise<T> {
    this.patch((current) => ({
      ...current,
      isMutating: true,
      error: null,
    }));

    try {
      return await operation();
    } catch (error) {
      this.patch((current) => ({
        ...current,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    } finally {
      this.patch((current) => ({
        ...current,
        isMutating: false,
      }));
    }
  }

  private async dispatchCommand(
    command: Parameters<AppRpcClient["orchestration"]["dispatchCommand"]>[0],
  ) {
    if (!this.client) {
      throw new Error("The app is not connected to the backend.");
    }

    return this.client.orchestration.dispatchCommand(command);
  }

  async createProject(input: {
    readonly title: string;
    readonly workspaceRoot: string;
  }): Promise<string> {
    const projectId = newProjectId();

    await this.runMutation(() =>
      this.dispatchCommand({
        type: "project.create",
        commandId: newCommandId(),
        projectId,
        title: input.title.trim(),
        workspaceRoot: input.workspaceRoot.trim(),
        createdAt: nowIso(),
      }),
    );

    return projectId;
  }

  async startNewThread(input: {
    readonly projectId: string;
    readonly prompt: string;
    readonly modelSelection: ModelSelection;
    readonly runtimeMode: OrchestrationThread["runtimeMode"];
    readonly interactionMode: OrchestrationThread["interactionMode"];
  }): Promise<string> {
    const current = get(this.state);
    const environmentId = current.environment?.environmentId;
    if (!environmentId) {
      throw new Error("Environment is not ready.");
    }

    const threadId = newThreadId();
    const createdAt = nowIso();
    const titleSeed = input.prompt.trim().split(/\r?\n/u)[0]?.slice(0, 80).trim() || "New thread";

    await this.runMutation(async () => {
      await this.dispatchCommand({
        type: "thread.create",
        commandId: newCommandId(),
        threadId,
        projectId: input.projectId as never,
        title: titleSeed,
        modelSelection: input.modelSelection,
        runtimeMode: input.runtimeMode,
        interactionMode: input.interactionMode,
        branch: null,
        worktreePath: null,
        createdAt,
      });

      await this.dispatchCommand({
        type: "thread.turn.start",
        commandId: newCommandId(),
        threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: input.prompt,
          attachments: [],
        },
        runtimeMode: input.runtimeMode,
        interactionMode: input.interactionMode,
        createdAt: nowIso(),
        titleSeed,
      });
    });

    return `${environmentId}/${threadId}`;
  }

  async sendMessage(prompt: string): Promise<void> {
    const current = get(this.state);
    const thread = current.activeThread.thread;
    if (!thread) {
      throw new Error("No active thread selected.");
    }

    await this.runMutation(() =>
      this.dispatchCommand({
        type: "thread.turn.start",
        commandId: newCommandId(),
        threadId: thread.id,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: prompt,
          attachments: [],
        },
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        createdAt: nowIso(),
      }),
    );
  }

  async stopActiveThread(): Promise<void> {
    const current = get(this.state);
    const thread = current.activeThread.thread;
    if (!thread) {
      return;
    }

    await this.runMutation(() => {
      if (thread.latestTurn?.turnId) {
        return this.dispatchCommand({
          type: "thread.turn.interrupt",
          commandId: newCommandId(),
          threadId: thread.id,
          turnId: thread.latestTurn.turnId,
          createdAt: nowIso(),
        });
      }

      return this.dispatchCommand({
        type: "thread.session.stop",
        commandId: newCommandId(),
        threadId: thread.id,
        createdAt: nowIso(),
      });
    });
  }

  async respondToApproval(requestId: string, decision: ProviderApprovalDecision): Promise<void> {
    const thread = get(this.state).activeThread.thread;
    if (!thread) {
      return;
    }

    await this.runMutation(() =>
      this.dispatchCommand({
        type: "thread.approval.respond",
        commandId: newCommandId(),
        threadId: thread.id,
        requestId: requestId as never,
        decision,
        createdAt: nowIso(),
      }),
    );
  }

  async respondToUserInput(requestId: string, answers: ProviderUserInputAnswers): Promise<void> {
    const thread = get(this.state).activeThread.thread;
    if (!thread) {
      return;
    }

    await this.runMutation(() =>
      this.dispatchCommand({
        type: "thread.user-input.respond",
        commandId: newCommandId(),
        threadId: thread.id,
        requestId: requestId as never,
        answers,
        createdAt: nowIso(),
      }),
    );
  }
}

export const appController = new AppController();
