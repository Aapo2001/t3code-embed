import type { DesktopEnvironmentBootstrap } from "@t3tools/contracts";
import type { KnownEnvironment } from "@t3tools/client-runtime";

export interface PrimaryEnvironmentTarget {
  readonly source: KnownEnvironment["source"];
  readonly target: KnownEnvironment["target"];
}

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);

function normalizeBaseUrl(rawValue: string): string {
  return new URL(rawValue, window.location.origin).toString();
}

function swapBaseUrlProtocol(
  rawValue: string,
  nextProtocol: "http:" | "https:" | "ws:" | "wss:",
): string {
  const url = new URL(normalizeBaseUrl(rawValue));
  url.protocol = nextProtocol;
  return url.toString();
}

function normalizeHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1");
}

function readDesktopBootstrap(): DesktopEnvironmentBootstrap | null {
  return window.desktopBridge?.getLocalEnvironmentBootstrap() ?? null;
}

export function readDesktopBootstrapCredential(): string | null {
  const bootstrap = readDesktopBootstrap();
  return typeof bootstrap?.bootstrapToken === "string" && bootstrap.bootstrapToken.length > 0
    ? bootstrap.bootstrapToken
    : null;
}

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(normalizeHostname(hostname));
}

function resolveConfiguredPrimaryTarget(): PrimaryEnvironmentTarget | null {
  const configuredHttpBaseUrl = import.meta.env.VITE_HTTP_URL?.trim() || undefined;
  const configuredWsBaseUrl = import.meta.env.VITE_WS_URL?.trim() || undefined;

  if (!configuredHttpBaseUrl && !configuredWsBaseUrl) {
    return null;
  }

  const resolvedHttpBaseUrl =
    configuredHttpBaseUrl ??
    (configuredWsBaseUrl?.startsWith("wss:")
      ? swapBaseUrlProtocol(configuredWsBaseUrl, "https:")
      : swapBaseUrlProtocol(configuredWsBaseUrl!, "http:"));
  const resolvedWsBaseUrl =
    configuredWsBaseUrl ??
    (configuredHttpBaseUrl?.startsWith("https:")
      ? swapBaseUrlProtocol(configuredHttpBaseUrl, "wss:")
      : swapBaseUrlProtocol(configuredHttpBaseUrl!, "ws:"));

  return {
    source: "configured",
    target: {
      httpBaseUrl: normalizeBaseUrl(resolvedHttpBaseUrl),
      wsBaseUrl: normalizeBaseUrl(resolvedWsBaseUrl),
    },
  };
}

function resolveWindowOriginPrimaryTarget(): PrimaryEnvironmentTarget {
  const httpBaseUrl = normalizeBaseUrl(window.location.origin);
  const wsUrl = new URL(httpBaseUrl);

  if (wsUrl.protocol === "http:") {
    wsUrl.protocol = "ws:";
  } else if (wsUrl.protocol === "https:") {
    wsUrl.protocol = "wss:";
  } else {
    throw new Error(`Unsupported HTTP base URL protocol: ${wsUrl.protocol}`);
  }

  return {
    source: "window-origin",
    target: {
      httpBaseUrl,
      wsBaseUrl: wsUrl.toString(),
    },
  };
}

function resolveDesktopPrimaryTarget(): PrimaryEnvironmentTarget | null {
  const desktopBootstrap = readDesktopBootstrap();
  if (!desktopBootstrap?.httpBaseUrl || !desktopBootstrap?.wsBaseUrl) {
    return null;
  }

  return {
    source: "desktop-managed",
    target: {
      httpBaseUrl: normalizeBaseUrl(desktopBootstrap.httpBaseUrl),
      wsBaseUrl: normalizeBaseUrl(desktopBootstrap.wsBaseUrl),
    },
  };
}

function resolveHttpRequestBaseUrl(httpBaseUrl: string): string {
  const configuredDevServerUrl = import.meta.env.VITE_DEV_SERVER_URL?.trim();
  if (!configuredDevServerUrl) {
    return httpBaseUrl;
  }

  const currentUrl = new URL(window.location.href);
  const targetUrl = new URL(httpBaseUrl);
  const devServerUrl = new URL(configuredDevServerUrl, currentUrl.origin);

  const isCurrentOriginDevServer =
    (currentUrl.protocol === "http:" || currentUrl.protocol === "https:") &&
    currentUrl.origin === devServerUrl.origin;

  if (
    !isCurrentOriginDevServer ||
    currentUrl.origin === targetUrl.origin ||
    !isLoopbackHostname(currentUrl.hostname) ||
    !isLoopbackHostname(targetUrl.hostname)
  ) {
    return httpBaseUrl;
  }

  return currentUrl.origin;
}

export function readPrimaryEnvironmentTarget(): PrimaryEnvironmentTarget | null {
  return (
    resolveDesktopPrimaryTarget() ??
    resolveConfiguredPrimaryTarget() ??
    resolveWindowOriginPrimaryTarget()
  );
}

export function resolvePrimaryEnvironmentHttpUrl(
  pathname: string,
  searchParams?: Record<string, string>,
): string {
  const primaryTarget = readPrimaryEnvironmentTarget();
  if (!primaryTarget) {
    throw new Error("Unable to resolve the primary environment HTTP base URL.");
  }

  const url = new URL(resolveHttpRequestBaseUrl(primaryTarget.target.httpBaseUrl));
  url.pathname = pathname;
  url.search = searchParams ? new URLSearchParams(searchParams).toString() : "";
  return url.toString();
}

function getPairingTokenFromUrl(url: URL): string | null {
  const hashToken = url.hash.startsWith("#token=") ? url.hash.slice("#token=".length) : null;
  if (hashToken && hashToken.trim().length > 0) {
    return hashToken.trim();
  }

  const queryToken = url.searchParams.get("token");
  return queryToken && queryToken.trim().length > 0 ? queryToken.trim() : null;
}

export function peekPairingTokenFromUrl(): string | null {
  return getPairingTokenFromUrl(new URL(window.location.href));
}

export function stripPairingTokenFromUrl(): void {
  const current = new URL(window.location.href);
  const next = new URL(current);
  next.searchParams.delete("token");
  if (next.hash.startsWith("#token=")) {
    next.hash = "";
  }
  if (next.toString() !== current.toString()) {
    window.history.replaceState({}, document.title, next.toString());
  }
}

export function takePairingTokenFromUrl(): string | null {
  const token = peekPairingTokenFromUrl();
  if (token) {
    stripPairingTokenFromUrl();
  }
  return token;
}
