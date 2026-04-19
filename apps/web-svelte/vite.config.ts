import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

const port = Number(process.env.PORT ?? 5833);
const host = process.env.HOST?.trim() || "localhost";
const configuredHttpUrl = process.env.VITE_HTTP_URL?.trim();
const configuredWsUrl = process.env.VITE_WS_URL?.trim();

function resolveDevProxyTarget(wsUrl: string | undefined): string | undefined {
  if (!wsUrl) {
    return undefined;
  }

  try {
    const url = new URL(wsUrl);
    if (url.protocol === "ws:") {
      url.protocol = "http:";
    } else if (url.protocol === "wss:") {
      url.protocol = "https:";
    }
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

const devProxyTarget = resolveDevProxyTarget(configuredWsUrl);

export default defineConfig({
  plugins: [sveltekit()],
  define: {
    "import.meta.env.VITE_HTTP_URL": JSON.stringify(configuredHttpUrl ?? ""),
    "import.meta.env.VITE_WS_URL": JSON.stringify(configuredWsUrl ?? ""),
  },
  server: {
    host,
    port,
    strictPort: true,
    ...(devProxyTarget
      ? {
          proxy: {
            "/.well-known": {
              target: devProxyTarget,
              changeOrigin: true,
            },
            "/api": {
              target: devProxyTarget,
              changeOrigin: true,
            },
            "/attachments": {
              target: devProxyTarget,
              changeOrigin: true,
            },
          },
        }
      : {}),
    hmr: {
      host,
      protocol: "ws",
    },
  },
});
