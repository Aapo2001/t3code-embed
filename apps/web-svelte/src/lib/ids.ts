import { CommandId, MessageId, ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Random from "effect/Random";

function randomUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return Effect.runSync(Random.nextUUIDv4);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newCommandId(): CommandId {
  return CommandId.make(randomUUID());
}

export function newMessageId(): MessageId {
  return MessageId.make(randomUUID());
}

export function newProjectId(): ProjectId {
  return ProjectId.make(randomUUID());
}

export function newThreadId(): ThreadId {
  return ThreadId.make(randomUUID());
}
