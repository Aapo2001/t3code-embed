import type {
  AuthBootstrapInput,
  AuthBootstrapResult,
  AuthSessionState,
  ExecutionEnvironmentDescriptor,
} from "@t3tools/contracts";

import { readDesktopBootstrapCredential, resolvePrimaryEnvironmentHttpUrl } from "./environment";

const TRANSIENT_STATUS_CODES = new Set([502, 503, 504]);
const RETRY_TIMEOUT_MS = 15_000;
const RETRY_STEP_MS = 500;
const SESSION_ESTABLISH_TIMEOUT_MS = 2_000;
const SESSION_ESTABLISH_STEP_MS = 100;

export class BootstrapHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "BootstrapHttpError";
    this.status = status;
  }
}

function isTransientBootstrapError(error: unknown): boolean {
  if (error instanceof BootstrapHttpError) {
    return TRANSIENT_STATUS_CODES.has(error.status);
  }

  if (error instanceof TypeError) {
    return true;
  }

  return error instanceof DOMException && error.name === "AbortError";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function retryTransientBootstrap<T>(operation: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();

  for (;;) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientBootstrapError(error) || Date.now() - startedAt >= RETRY_TIMEOUT_MS) {
        throw error;
      }
      await delay(RETRY_STEP_MS);
    }
  }
}

async function readResponseError(response: Response, fallbackMessage: string): Promise<string> {
  const text = await response.text();
  return text || fallbackMessage;
}

export async function fetchSessionState(): Promise<AuthSessionState> {
  return retryTransientBootstrap(async () => {
    const response = await fetch(resolvePrimaryEnvironmentHttpUrl("/api/auth/session"), {
      credentials: "include",
    });

    if (!response.ok) {
      throw new BootstrapHttpError(
        `Failed to load server auth session state (${response.status}).`,
        response.status,
      );
    }

    return (await response.json()) as AuthSessionState;
  });
}

export async function fetchEnvironmentDescriptor(): Promise<ExecutionEnvironmentDescriptor> {
  return retryTransientBootstrap(async () => {
    const response = await fetch(resolvePrimaryEnvironmentHttpUrl("/.well-known/t3/environment"));
    if (!response.ok) {
      throw new BootstrapHttpError(
        `Failed to load environment descriptor (${response.status}).`,
        response.status,
      );
    }

    return (await response.json()) as ExecutionEnvironmentDescriptor;
  });
}

export async function exchangeBootstrapCredential(
  credential: string,
): Promise<AuthBootstrapResult> {
  return retryTransientBootstrap(async () => {
    const payload: AuthBootstrapInput = { credential };
    const response = await fetch(resolvePrimaryEnvironmentHttpUrl("/api/auth/bootstrap"), {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new BootstrapHttpError(
        await readResponseError(response, `Failed to bootstrap auth session (${response.status}).`),
        response.status,
      );
    }

    return (await response.json()) as AuthBootstrapResult;
  });
}

export async function waitForAuthenticatedSession(): Promise<AuthSessionState> {
  const startedAt = Date.now();

  for (;;) {
    const session = await fetchSessionState();
    if (session.authenticated) {
      return session;
    }

    if (Date.now() - startedAt >= SESSION_ESTABLISH_TIMEOUT_MS) {
      throw new Error("Timed out waiting for the authenticated session cookie.");
    }

    await delay(SESSION_ESTABLISH_STEP_MS);
  }
}

export async function attemptSilentAuthentication(
  credential: string | null | undefined,
): Promise<AuthSessionState | null> {
  const trimmedCredential = credential?.trim();
  if (!trimmedCredential) {
    return null;
  }

  await exchangeBootstrapCredential(trimmedCredential);
  return waitForAuthenticatedSession();
}

export function readDesktopManagedCredential(): string | null {
  return readDesktopBootstrapCredential();
}
