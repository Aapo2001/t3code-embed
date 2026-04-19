import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime";
import { ArrowUpRightIcon, ChevronRightIcon, PlusIcon, SparklesIcon } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { cn } from "~/lib/utils";
import {
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsAcrossEnvironments,
  useStore,
} from "~/store";
import { buildThreadRouteParams } from "~/threadRoutes";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { resolveThreadStatusPill } from "./Sidebar.logic";
import { SidebarInset, SidebarTrigger } from "./ui/sidebar";
import { isElectron } from "../env";

const SESSION_PREVIEW_LIMIT = 6;
const ACTIVITY_CELL_COUNT = 168;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type OverviewRange = "all" | "30d" | "7d";
type OverviewTab = "overview" | "sessions";

function threadActivityTimestamp(thread: {
  latestUserMessageAt: string | null;
  updatedAt?: string | undefined;
  createdAt: string;
}): string {
  return thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt;
}

function toLocalDayKey(input: Date | number | string): string {
  const date = new Date(input);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function activityCellClass(count: number): string {
  if (count >= 4) {
    return "bg-blue-400";
  }
  if (count >= 2) {
    return "bg-blue-300/90";
  }
  if (count >= 1) {
    return "bg-blue-200/78";
  }
  return "bg-white/[0.065]";
}

export function NoActiveThreadState() {
  const navigate = useNavigate();
  const { defaultProjectRef, handleNewThread } = useHandleNewThread();
  const [activeTab, setActiveTab] = useState<OverviewTab>("sessions");
  const [activeRange, setActiveRange] = useState<OverviewRange>("all");
  const projects = useStore(useShallow((state) => selectProjectsAcrossEnvironments(state)));
  const threads = useStore(useShallow((state) => selectSidebarThreadsAcrossEnvironments(state)));

  const projectNameByKey = useMemo(
    () =>
      new Map(
        projects.map(
          (project) => [`${project.environmentId}:${project.id}`, project.name] as const,
        ),
      ),
    [projects],
  );

  const defaultProject = useMemo(
    () =>
      defaultProjectRef
        ? (projects.find(
            (project) =>
              project.environmentId === defaultProjectRef.environmentId &&
              project.id === defaultProjectRef.projectId,
          ) ?? null)
        : null,
    [defaultProjectRef, projects],
  );

  const visibleThreads = useMemo(
    () => threads.filter((thread) => thread.archivedAt === null),
    [threads],
  );

  const sortedThreads = useMemo(
    () =>
      visibleThreads.toSorted(
        (left, right) =>
          Date.parse(threadActivityTimestamp(right)) - Date.parse(threadActivityTimestamp(left)),
      ),
    [visibleThreads],
  );

  const rangeCutoffMs = useMemo(() => {
    if (activeRange === "all") {
      return null;
    }

    const dayCount = activeRange === "7d" ? 7 : 30;
    return Date.now() - dayCount * MS_PER_DAY;
  }, [activeRange]);

  const rangeThreads = useMemo(() => {
    if (rangeCutoffMs === null) {
      return sortedThreads;
    }

    return sortedThreads.filter(
      (thread) => Date.parse(threadActivityTimestamp(thread)) >= rangeCutoffMs,
    );
  }, [rangeCutoffMs, sortedThreads]);

  const recentSessions = useMemo(() => {
    return sortedThreads.slice(0, SESSION_PREVIEW_LIMIT).map((thread) => ({
      projectName: projectNameByKey.get(`${thread.environmentId}:${thread.projectId}`) ?? "Project",
      status: resolveThreadStatusPill({ thread }),
      thread,
    }));
  }, [projectNameByKey, sortedThreads]);

  const activityCountByDay = useMemo(() => {
    const next = new Map<string, number>();

    for (const thread of rangeThreads) {
      const key = toLocalDayKey(threadActivityTimestamp(thread));
      next.set(key, (next.get(key) ?? 0) + 1);
    }

    return next;
  }, [rangeThreads]);

  const activityCells = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return Array.from({ length: ACTIVITY_CELL_COUNT }, (_unused, index) => {
      const date = new Date(today.getTime() - (ACTIVITY_CELL_COUNT - index - 1) * MS_PER_DAY);
      const key = toLocalDayKey(date);
      const count = activityCountByDay.get(key) ?? 0;
      return {
        count,
        key,
      };
    });
  }, [activityCountByDay]);

  const activeDayCount = useMemo(
    () => new Set(activityCountByDay.keys()).size,
    [activityCountByDay],
  );

  const overviewCards = useMemo(() => {
    const latestThread = rangeThreads[0] ?? null;
    const latestActivityLabel = latestThread
      ? formatRelativeTimeLabel(threadActivityTimestamp(latestThread))
      : "No activity";

    return [
      { label: "Sessions", value: String(rangeThreads.length) },
      { label: "Projects", value: String(projects.length) },
      {
        label: "Worktrees",
        value: String(rangeThreads.filter((thread) => thread.worktreePath).length),
      },
      { label: "Active days", value: String(activeDayCount) },
      {
        label: "Pending",
        value: String(
          rangeThreads.filter((thread) => thread.hasPendingApprovals || thread.hasPendingUserInput)
            .length,
        ),
      },
      {
        label: "Running",
        value: String(
          rangeThreads.filter(
            (thread) =>
              thread.session?.status === "running" || thread.session?.status === "connecting",
          ).length,
        ),
      },
      {
        label: "Plan ready",
        value: String(rangeThreads.filter((thread) => thread.hasActionableProposedPlan).length),
      },
      { label: "Latest activity", value: latestActivityLabel },
    ];
  }, [activeDayCount, projects.length, rangeThreads]);

  const handleCreateSession = useCallback(() => {
    if (!defaultProjectRef) {
      return;
    }

    void handleNewThread(
      scopeProjectRef(defaultProjectRef.environmentId, defaultProjectRef.projectId),
    );
  }, [defaultProjectRef, handleNewThread]);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-transparent text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col px-3 pb-4 pt-2 sm:px-5 sm:pb-5">
        <header
          className={cn(
            "mb-5 flex items-center justify-between px-1",
            isElectron
              ? "drag-region min-h-[52px] wco:min-h-[env(titlebar-area-height)] wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]"
              : "min-h-11",
          )}
        >
          {isElectron ? (
            <span className="text-xs font-medium tracking-[0.18em] text-muted-foreground/58 uppercase">
              Code
            </span>
          ) : (
            <div className="flex items-center gap-2">
              <SidebarTrigger className="size-8 shrink-0 rounded-md border border-border/80 bg-card md:hidden" />
              <span className="text-sm font-medium text-foreground/88">Code</span>
            </div>
          )}

          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!defaultProjectRef}
            onClick={handleCreateSession}
          >
            <PlusIcon className="size-3.5" />
            New session
          </button>
        </header>

        <div className="mx-auto flex w-full max-w-[1080px] flex-1 flex-col">
          <div className="mb-8 flex items-center gap-3">
            <SparklesIcon className="size-5 shrink-0 text-primary" />
            <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Welcome back
            </h1>
          </div>

          <section className="app-panel rounded-xl px-4 py-4 sm:px-5 sm:py-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex rounded-md border border-border bg-card p-1">
                {(
                  [
                    ["overview", "Overview"],
                    ["sessions", "Sessions"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={cn(
                      "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                      activeTab === value
                        ? "bg-card text-foreground"
                        : "text-muted-foreground/72 hover:text-foreground",
                    )}
                    onClick={() => setActiveTab(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {activeTab === "overview" ? (
                <div className="inline-flex rounded-md border border-border bg-card p-1">
                  {(
                    [
                      ["all", "All"],
                      ["30d", "30d"],
                      ["7d", "7d"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={cn(
                        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                        activeRange === value
                          ? "bg-card text-foreground"
                          : "text-muted-foreground/72 hover:text-foreground",
                      )}
                      onClick={() => setActiveRange(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {activeTab === "overview" ? (
              <>
                <div className="grid gap-2 sm:grid-cols-4">
                  {overviewCards.map((card) => (
                    <div
                      key={card.label}
                      className="rounded-lg bg-white/[0.045] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]"
                    >
                      <div className="text-muted-foreground/64 text-sm">{card.label}</div>
                      <div className="mt-1 truncate text-2xl font-semibold tracking-tight text-foreground">
                        {card.value}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-3 rounded-lg bg-white/[0.03] px-3 py-3.5">
                  <div className="grid auto-cols-max grid-flow-col grid-rows-7 gap-1.5 overflow-hidden">
                    {activityCells.map((cell) => (
                      <div
                        key={cell.key}
                        className={cn(
                          "size-3.5 rounded-[4px] transition-colors sm:size-4",
                          activityCellClass(cell.count),
                        )}
                        title={
                          cell.count > 0 ? `${cell.key}: ${cell.count} session updates` : cell.key
                        }
                      />
                    ))}
                  </div>
                  <p className="mt-4 text-sm text-muted-foreground/62">
                    {activeDayCount === 0
                      ? "No session activity in the selected range yet."
                      : `${activeDayCount} active day${activeDayCount === 1 ? "" : "s"} in the selected range.`}
                  </p>
                </div>
              </>
            ) : recentSessions.length === 0 ? (
              <div className="flex min-h-52 items-center justify-center rounded-lg bg-white/[0.03] px-6 text-center">
                <div>
                  <p className="text-lg font-medium text-foreground">No sessions yet</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground/68">
                    Start a session from the current workspace to see it here.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {recentSessions.map(({ projectName, status, thread }) => {
                  const timestamp = formatRelativeTimeLabel(threadActivityTimestamp(thread));

                  return (
                    <button
                      key={`${thread.environmentId}:${thread.id}`}
                      type="button"
                      className="flex w-full items-center gap-4 rounded-lg bg-white/[0.035] px-4 py-3 text-left transition-colors hover:bg-accent/86 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => {
                        void navigate({
                          to: "/$environmentId/$threadId",
                          params: buildThreadRouteParams(
                            scopeThreadRef(thread.environmentId, thread.id),
                          ),
                        });
                      }}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <span
                          className={cn(
                            "inline-flex size-2.5 shrink-0 rounded-full bg-muted-foreground/45",
                            status?.dotClass,
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-base font-medium text-foreground">
                            {thread.title}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground/66">
                            <span>{projectName}</span>
                            {status ? <span>{status.label}</span> : null}
                            {thread.branch ? <span>{thread.branch}</span> : null}
                          </div>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground/60">
                        <span>{timestamp}</span>
                        <ChevronRightIcon className="size-4" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <div className="mt-auto pt-6">
            <div className="mb-3 flex flex-wrap gap-2 text-sm text-muted-foreground/78">
              <span className="rounded-md border border-border bg-card px-3 py-1.5">Local</span>
              <span className="max-w-full truncate rounded-md border border-border bg-card px-3 py-1.5">
                {defaultProject?.name ?? "Select folder..."}
              </span>
            </div>

            <button
              type="button"
              className="app-panel flex h-16 w-full items-center justify-between rounded-xl px-4 text-left text-muted-foreground/74 transition-colors hover:bg-accent/86 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!defaultProjectRef}
              onClick={handleCreateSession}
            >
              <span className="text-base">Describe a task or ask a question</span>
              <ArrowUpRightIcon className="size-4 shrink-0 opacity-60" />
            </button>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground/62">
              <div className="flex flex-wrap items-center gap-4">
                <span>Accept edits</span>
                <span>Ready to start from the current workspace</span>
              </div>
              <span>{defaultProjectRef ? "Ready" : "Choose a project first"}</span>
            </div>
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}
