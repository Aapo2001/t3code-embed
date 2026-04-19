import type { EnvironmentId } from "@t3tools/contracts";
import { CloudIcon, MonitorIcon } from "lucide-react";
import { memo, useMemo } from "react";

import type { EnvironmentOption } from "./BranchToolbar.logic";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

interface BranchToolbarEnvironmentSelectorProps {
  envLocked: boolean;
  environmentId: EnvironmentId;
  availableEnvironments: readonly EnvironmentOption[];
  onEnvironmentChange: (environmentId: EnvironmentId) => void;
}

export const BranchToolbarEnvironmentSelector = memo(function BranchToolbarEnvironmentSelector({
  envLocked,
  environmentId,
  availableEnvironments,
  onEnvironmentChange,
}: BranchToolbarEnvironmentSelectorProps) {
  const activeEnvironment = useMemo(() => {
    return availableEnvironments.find((env) => env.environmentId === environmentId) ?? null;
  }, [availableEnvironments, environmentId]);

  const environmentItems = useMemo(
    () =>
      availableEnvironments.map((env) => ({
        value: env.environmentId,
        label: env.label,
      })),
    [availableEnvironments],
  );

  if (envLocked) {
    return (
      <span className="app-pill inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-sm font-medium text-muted-foreground/74 sm:text-xs">
        {activeEnvironment?.isPrimary ? (
          <MonitorIcon className="size-3" />
        ) : (
          <CloudIcon className="size-3" />
        )}
        {activeEnvironment?.label ?? "Run on"}
      </span>
    );
  }

  return (
    <Select
      value={environmentId}
      onValueChange={(value) => onEnvironmentChange(value as EnvironmentId)}
      items={environmentItems}
    >
      <SelectTrigger
        variant="ghost"
        size="xs"
        className="app-pill rounded-xl px-3 font-medium text-muted-foreground/74 hover:text-foreground"
        aria-label="Run on"
      >
        {activeEnvironment?.isPrimary ? (
          <MonitorIcon className="size-3" />
        ) : (
          <CloudIcon className="size-3" />
        )}
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        <SelectGroup>
          <SelectGroupLabel>Run on</SelectGroupLabel>
          {availableEnvironments.map((env) => (
            <SelectItem key={env.environmentId} value={env.environmentId}>
              <span className="inline-flex items-center gap-1.5">
                {env.isPrimary ? (
                  <MonitorIcon className="size-3" />
                ) : (
                  <CloudIcon className="size-3" />
                )}
                {env.label}
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectPopup>
    </Select>
  );
});
