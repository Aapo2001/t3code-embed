import type {
  ApprovalRequestId,
  ModelSelection,
  OrchestrationProjectShell,
  OrchestrationProposedPlan,
  OrchestrationThread,
  OrchestrationThreadActivity,
  OrchestrationThreadShell,
  ProviderInteractionMode,
  RuntimeMode,
  ServerConfig,
  ServerProvider,
  UserInputQuestion,
} from "@t3tools/contracts";

export interface PendingApproval {
  readonly requestId: ApprovalRequestId;
  readonly requestKind: "command" | "file-read" | "file-change";
  readonly createdAt: string;
  readonly detail?: string;
}

export interface PendingUserInput {
  readonly requestId: ApprovalRequestId;
  readonly createdAt: string;
  readonly questions: ReadonlyArray<UserInputQuestion>;
}

export type TimelineEntry =
  | {
      readonly id: string;
      readonly kind: "message";
      readonly createdAt: string;
      readonly value: OrchestrationThread["messages"][number];
    }
  | {
      readonly id: string;
      readonly kind: "activity";
      readonly createdAt: string;
      readonly value: OrchestrationThreadActivity;
    }
  | {
      readonly id: string;
      readonly kind: "proposed-plan";
      readonly createdAt: string;
      readonly value: OrchestrationProposedPlan;
    };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function compareIsoDates(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  const leftTime = left ? Date.parse(left) : Number.NEGATIVE_INFINITY;
  const rightTime = right ? Date.parse(right) : Number.NEGATIVE_INFINITY;
  return rightTime - leftTime;
}

function requestKindFromRequestType(requestType: unknown): PendingApproval["requestKind"] | null {
  switch (requestType) {
    case "command_execution_approval":
    case "exec_command_approval":
      return "command";
    case "file_read_approval":
      return "file-read";
    case "file_change_approval":
    case "apply_patch_approval":
      return "file-change";
    default:
      return null;
  }
}

function isStalePendingRequestFailureDetail(detail: string | undefined): boolean {
  const normalized = detail?.toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("stale pending approval request") ||
    normalized.includes("stale pending user-input request") ||
    normalized.includes("unknown pending approval request") ||
    normalized.includes("unknown pending permission request") ||
    normalized.includes("unknown pending user-input request")
  );
}

function parseUserInputQuestions(
  payload: Record<string, unknown> | null,
): ReadonlyArray<UserInputQuestion> | null {
  const questions = payload?.questions;
  if (!Array.isArray(questions)) {
    return null;
  }

  const parsed = questions
    .map<UserInputQuestion | null>((entry) => {
      const question = asRecord(entry);
      if (
        !question ||
        typeof question.id !== "string" ||
        typeof question.header !== "string" ||
        typeof question.question !== "string" ||
        !Array.isArray(question.options)
      ) {
        return null;
      }

      const options = question.options
        .map<UserInputQuestion["options"][number] | null>((option) => {
          const optionRecord = asRecord(option);
          if (
            !optionRecord ||
            typeof optionRecord.label !== "string" ||
            typeof optionRecord.description !== "string"
          ) {
            return null;
          }

          return {
            label: optionRecord.label,
            description: optionRecord.description,
          };
        })
        .filter((option): option is UserInputQuestion["options"][number] => option !== null);

      if (options.length === 0) {
        return null;
      }

      return {
        id: question.id,
        header: question.header,
        question: question.question,
        options,
      };
    })
    .filter((question): question is UserInputQuestion => question !== null);

  return parsed.length > 0 ? parsed : null;
}

export function sortProjectShells(
  projects: ReadonlyArray<OrchestrationProjectShell>,
): OrchestrationProjectShell[] {
  return [...projects].toSorted((left, right) => left.title.localeCompare(right.title));
}

export function sortThreadShells(
  threads: ReadonlyArray<OrchestrationThreadShell>,
): OrchestrationThreadShell[] {
  return [...threads].toSorted((left, right) => {
    const activityOrder = compareIsoDates(
      left.latestUserMessageAt ?? left.updatedAt ?? left.createdAt,
      right.latestUserMessageAt ?? right.updatedAt ?? right.createdAt,
    );
    if (activityOrder !== 0) {
      return activityOrder;
    }

    return right.createdAt.localeCompare(left.createdAt);
  });
}

export function groupThreadsByProject(
  threads: ReadonlyArray<OrchestrationThreadShell>,
): Map<string, OrchestrationThreadShell[]> {
  const grouped = new Map<string, OrchestrationThreadShell[]>();

  for (const thread of sortThreadShells(threads)) {
    const bucket = grouped.get(thread.projectId) ?? [];
    bucket.push(thread);
    grouped.set(thread.projectId, bucket);
  }

  return grouped;
}

export function formatRelativeTime(value: string | null | undefined): string {
  if (!value) {
    return "just now";
  }

  const deltaMs = Date.now() - Date.parse(value);
  if (!Number.isFinite(deltaMs)) {
    return value;
  }

  const seconds = Math.max(1, Math.round(deltaMs / 1_000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function formatThreadStatus(
  thread: Pick<OrchestrationThreadShell, "session" | "latestTurn">,
): string {
  const status = thread.session?.status;
  if (status) {
    return status;
  }
  if (thread.latestTurn?.state) {
    return thread.latestTurn.state;
  }
  return "idle";
}

export function getAvailableModelSelections(config: ServerConfig | null): ModelSelection[] {
  if (!config) {
    return [];
  }

  const selections: ModelSelection[] = [];
  for (const provider of config.providers) {
    if (!provider.enabled || !provider.installed) {
      continue;
    }
    for (const model of provider.models) {
      selections.push({
        provider: provider.provider,
        model: model.slug,
      } as ModelSelection);
    }
  }

  return selections;
}

export function pickDefaultModelSelection(input: {
  readonly config: ServerConfig | null;
  readonly project?: Pick<OrchestrationProjectShell, "defaultModelSelection"> | null;
  readonly fallback?: ModelSelection | null;
}): ModelSelection | null {
  if (input.project?.defaultModelSelection) {
    return input.project.defaultModelSelection;
  }

  if (input.fallback) {
    return input.fallback;
  }

  return getAvailableModelSelections(input.config)[0] ?? null;
}

export function derivePendingApprovals(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): PendingApproval[] {
  const openByRequestId = new Map<ApprovalRequestId, PendingApproval>();
  const ordered = [...activities].toSorted(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );

  for (const activity of ordered) {
    const payload = asRecord(activity.payload);
    const requestId =
      payload && typeof payload.requestId === "string"
        ? (payload.requestId as ApprovalRequestId)
        : null;
    const requestKind =
      payload &&
      (payload.requestKind === "command" ||
        payload.requestKind === "file-read" ||
        payload.requestKind === "file-change")
        ? payload.requestKind
        : requestKindFromRequestType(payload?.requestType);
    const detail = payload && typeof payload.detail === "string" ? payload.detail : undefined;

    if (activity.kind === "approval.requested" && requestId && requestKind) {
      openByRequestId.set(requestId, {
        requestId,
        requestKind,
        createdAt: activity.createdAt,
        ...(detail ? { detail } : {}),
      });
      continue;
    }

    if (activity.kind === "approval.resolved" && requestId) {
      openByRequestId.delete(requestId);
      continue;
    }

    if (
      activity.kind === "provider.approval.respond.failed" &&
      requestId &&
      isStalePendingRequestFailureDetail(detail)
    ) {
      openByRequestId.delete(requestId);
    }
  }

  return [...openByRequestId.values()].toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

export function derivePendingUserInputs(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): PendingUserInput[] {
  const openByRequestId = new Map<ApprovalRequestId, PendingUserInput>();
  const ordered = [...activities].toSorted(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );

  for (const activity of ordered) {
    const payload = asRecord(activity.payload);
    const requestId =
      payload && typeof payload.requestId === "string"
        ? (payload.requestId as ApprovalRequestId)
        : null;
    const detail = payload && typeof payload.detail === "string" ? payload.detail : undefined;

    if (activity.kind === "user-input.requested" && requestId) {
      const questions = parseUserInputQuestions(payload);
      if (!questions) {
        continue;
      }

      openByRequestId.set(requestId, {
        requestId,
        createdAt: activity.createdAt,
        questions,
      });
      continue;
    }

    if (activity.kind === "user-input.resolved" && requestId) {
      openByRequestId.delete(requestId);
      continue;
    }

    if (
      activity.kind === "provider.user-input.respond.failed" &&
      requestId &&
      isStalePendingRequestFailureDetail(detail)
    ) {
      openByRequestId.delete(requestId);
    }
  }

  return [...openByRequestId.values()].toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

export function deriveTimelineEntries(thread: OrchestrationThread): TimelineEntry[] {
  const messageEntries: TimelineEntry[] = thread.messages.map((message) => ({
    id: message.id,
    kind: "message",
    createdAt: message.createdAt,
    value: message,
  }));
  const activityEntries: TimelineEntry[] = thread.activities.map((activity) => ({
    id: activity.id,
    kind: "activity",
    createdAt: activity.createdAt,
    value: activity,
  }));
  const proposedPlanEntries: TimelineEntry[] = thread.proposedPlans.map((proposedPlan) => ({
    id: proposedPlan.id,
    kind: "proposed-plan",
    createdAt: proposedPlan.createdAt,
    value: proposedPlan,
  }));

  return [...messageEntries, ...activityEntries, ...proposedPlanEntries].toSorted(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
}

export function describeAuthPolicy(policy: string | undefined): string {
  switch (policy) {
    case "desktop-managed-local":
      return "This environment expects a trusted local desktop bootstrap.";
    case "loopback-browser":
      return "This environment uses a local browser pairing flow.";
    case "remote-reachable":
      return "This environment expects an explicit one-time pairing token.";
    case "unsafe-no-auth":
      return "This environment is intentionally running without authentication.";
    default:
      return "Enter a valid credential to continue.";
  }
}

export function formatModelSelection(selection: ModelSelection | null | undefined): string {
  if (!selection) {
    return "No model";
  }

  return `${selection.provider}:${selection.model}`;
}

export function parseModelSelection(
  value: string,
  config: ServerConfig | null,
  project?: Pick<OrchestrationProjectShell, "defaultModelSelection"> | null,
): ModelSelection | null {
  const [provider, ...modelParts] = value.split(":");
  const model = modelParts.join(":").trim();
  if (!provider || !model) {
    return pickDefaultModelSelection({ config, project });
  }

  return {
    provider: provider as ModelSelection["provider"],
    model,
  } as ModelSelection;
}

export const RUNTIME_MODE_OPTIONS: ReadonlyArray<{
  readonly value: RuntimeMode;
  readonly label: string;
}> = [
  { value: "approval-required", label: "Approval Required" },
  { value: "auto-accept-edits", label: "Auto Accept Edits" },
  { value: "full-access", label: "Full Access" },
];

export const INTERACTION_MODE_OPTIONS: ReadonlyArray<{
  readonly value: ProviderInteractionMode;
  readonly label: string;
}> = [
  { value: "default", label: "Default" },
  { value: "plan", label: "Plan" },
];

export function providerStatusTone(provider: ServerProvider): "ready" | "warning" | "error" {
  if (provider.status === "ready") {
    return "ready";
  }
  if (provider.status === "warning") {
    return "warning";
  }
  return "error";
}
