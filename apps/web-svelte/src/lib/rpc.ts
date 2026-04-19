import { WsRpcGroup } from "@t3tools/contracts";
import type {
  ClientOrchestrationCommand,
  DispatchResult,
  OrchestrationShellStreamItem,
  OrchestrationSubscribeThreadInput,
  OrchestrationThreadStreamItem,
  ServerConfig,
  ServerConfigStreamEvent,
  ServerLifecycleStreamEvent,
} from "@t3tools/contracts";
import { ORCHESTRATION_WS_METHODS, WS_METHODS } from "@t3tools/contracts";
import { Duration, Effect, Exit, Layer, ManagedRuntime, Schedule, Scope, Stream } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Socket from "effect/unstable/socket/Socket";

const RETRY_DELAY_MS = Duration.millis(250);
const RETRY_COUNT = 7;
const NOOP = () => undefined;

export interface StreamSubscriptionOptions {
  readonly onResubscribe?: () => void;
}

export interface LifecycleHandlers {
  readonly onAttempt?: (socketUrl: string) => void;
  readonly onOpen?: () => void;
  readonly onError?: (message: string) => void;
  readonly onClose?: (details: { readonly code: number; readonly reason: string }) => void;
}

const makeRpcProtocolClient = RpcClient.make(WsRpcGroup);
type RpcProtocolClientFactory = typeof makeRpcProtocolClient;
type RpcProtocolClient =
  RpcProtocolClientFactory extends Effect.Effect<infer Client, any, any> ? Client : never;

interface TransportSession {
  readonly clientPromise: Promise<RpcProtocolClient>;
  readonly clientScope: Scope.Closeable;
  readonly runtime: ManagedRuntime.ManagedRuntime<RpcClient.Protocol, any>;
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return String(error);
}

function resolveSocketUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`Unsupported websocket transport URL protocol: ${url.protocol}`);
  }

  url.pathname = "/ws";
  return url.toString();
}

function createProtocolLayer(socketBaseUrl: string, handlers?: LifecycleHandlers) {
  const resolvedSocketUrl = resolveSocketUrl(socketBaseUrl);
  const socketConstructorLayer = Layer.succeed(
    Socket.WebSocketConstructor,
    (socketUrl, protocols) => {
      handlers?.onAttempt?.(socketUrl);
      const socket = new globalThis.WebSocket(socketUrl, protocols);

      socket.addEventListener(
        "open",
        () => {
          handlers?.onOpen?.();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          handlers?.onError?.("Unable to connect to the T3 server WebSocket.");
        },
        { once: true },
      );
      socket.addEventListener(
        "close",
        (event) => {
          handlers?.onClose?.({
            code: event.code,
            reason: event.reason,
          });
        },
        { once: true },
      );

      return socket;
    },
  );

  const socketLayer = Socket.layerWebSocket(resolvedSocketUrl).pipe(
    Layer.provide(socketConstructorLayer),
  );
  const retryPolicy = Schedule.addDelay(Schedule.recurs(RETRY_COUNT), () =>
    Effect.succeed(RETRY_DELAY_MS),
  );

  const protocolLayer = Layer.effect(
    RpcClient.Protocol,
    RpcClient.makeProtocolSocket({
      retryPolicy,
      retryTransientErrors: true,
    }),
  );

  return protocolLayer.pipe(Layer.provide(Layer.mergeAll(socketLayer, RpcSerialization.layerJson)));
}

class SimpleWsTransport {
  private readonly socketBaseUrl: string;
  private readonly lifecycleHandlers: LifecycleHandlers | undefined;
  private disposed = false;
  private reconnectChain: Promise<void> = Promise.resolve();
  private session: TransportSession;

  constructor(socketBaseUrl: string, lifecycleHandlers?: LifecycleHandlers) {
    this.socketBaseUrl = socketBaseUrl;
    this.lifecycleHandlers = lifecycleHandlers;
    this.session = this.createSession();
  }

  async request<TSuccess>(
    execute: (client: RpcProtocolClient) => Effect.Effect<TSuccess, Error, never>,
  ): Promise<TSuccess> {
    if (this.disposed) {
      throw new Error("Transport disposed");
    }

    const session = this.session;
    const client = await session.clientPromise;
    return session.runtime.runPromise(Effect.suspend(() => execute(client)));
  }

  subscribe<TValue>(
    connect: (client: RpcProtocolClient) => Stream.Stream<TValue, Error, never>,
    listener: (value: TValue) => void,
    options?: StreamSubscriptionOptions,
  ): () => void {
    if (this.disposed) {
      return NOOP;
    }

    let active = true;
    let cancelCurrentStream: () => void = NOOP;
    let hasReceivedValue = false;

    void (async () => {
      for (;;) {
        if (!active || this.disposed) {
          return;
        }

        const session = this.session;
        try {
          if (hasReceivedValue) {
            options?.onResubscribe?.();
          }

          const runningStream = this.runStreamOnSession(
            session,
            connect,
            listener,
            () => active,
            () => {
              hasReceivedValue = true;
            },
          );
          cancelCurrentStream = runningStream.cancel;
          await runningStream.completed;
          cancelCurrentStream = NOOP;
        } catch (error) {
          cancelCurrentStream = NOOP;
          if (!active || this.disposed) {
            return;
          }

          if (session !== this.session) {
            continue;
          }

          const message = formatErrorMessage(error);
          if (
            !/Socket(Open|Close)Error|ping timeout|Unable to connect to the T3 server WebSocket/i.test(
              message,
            )
          ) {
            console.warn("WebSocket subscription failed", { error: message });
            return;
          }

          await new Promise((resolve) => {
            setTimeout(resolve, Duration.toMillis(RETRY_DELAY_MS));
          });
        }
      }
    })();

    return () => {
      active = false;
      cancelCurrentStream();
    };
  }

  async reconnect(): Promise<void> {
    if (this.disposed) {
      throw new Error("Transport disposed");
    }

    const reconnectOperation = this.reconnectChain.then(async () => {
      if (this.disposed) {
        throw new Error("Transport disposed");
      }

      const previousSession = this.session;
      this.session = this.createSession();
      await this.closeSession(previousSession);
    });

    this.reconnectChain = reconnectOperation.catch(() => undefined);
    await reconnectOperation;
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    await this.closeSession(this.session);
  }

  private createSession(): TransportSession {
    const runtime = ManagedRuntime.make(
      createProtocolLayer(this.socketBaseUrl, this.lifecycleHandlers),
    );
    const clientScope = runtime.runSync(Scope.make());

    return {
      runtime,
      clientScope,
      clientPromise: runtime.runPromise(Scope.provide(clientScope)(makeRpcProtocolClient)),
    };
  }

  private async closeSession(session: TransportSession): Promise<void> {
    await session.runtime.runPromise(Scope.close(session.clientScope, Exit.void)).finally(() => {
      session.runtime.dispose();
    });
  }

  private runStreamOnSession<TValue>(
    session: TransportSession,
    connect: (client: RpcProtocolClient) => Stream.Stream<TValue, Error, never>,
    listener: (value: TValue) => void,
    isActive: () => boolean,
    markValueReceived: () => void,
  ): {
    readonly cancel: () => void;
    readonly completed: Promise<void>;
  } {
    let resolveCompleted!: () => void;
    let rejectCompleted!: (error: unknown) => void;
    const completed = new Promise<void>((resolve, reject) => {
      resolveCompleted = resolve;
      rejectCompleted = reject;
    });

    const cancel = session.runtime.runCallback(
      Effect.promise(() => session.clientPromise).pipe(
        Effect.flatMap((client) =>
          Stream.runForEach(connect(client), (value) =>
            Effect.sync(() => {
              if (!isActive()) {
                return;
              }

              markValueReceived();
              try {
                listener(value);
              } catch {
                // Swallow listener errors so the stream can stay alive.
              }
            }),
          ),
        ),
      ),
      {
        onExit: (exit) => {
          if (Exit.isSuccess(exit)) {
            resolveCompleted();
            return;
          }

          rejectCompleted(Exit.isFailure(exit) ? exit.cause : new Error("Unknown stream exit"));
        },
      },
    );

    return {
      cancel,
      completed,
    };
  }
}

export interface AppRpcClient {
  readonly dispose: () => Promise<void>;
  readonly reconnect: () => Promise<void>;
  readonly server: {
    readonly getConfig: () => Promise<ServerConfig>;
    readonly subscribeConfig: (
      listener: (event: ServerConfigStreamEvent) => void,
      options?: StreamSubscriptionOptions,
    ) => () => void;
    readonly subscribeLifecycle: (
      listener: (event: ServerLifecycleStreamEvent) => void,
      options?: StreamSubscriptionOptions,
    ) => () => void;
  };
  readonly orchestration: {
    readonly dispatchCommand: (input: ClientOrchestrationCommand) => Promise<DispatchResult>;
    readonly subscribeShell: (
      listener: (item: OrchestrationShellStreamItem) => void,
      options?: StreamSubscriptionOptions,
    ) => () => void;
    readonly subscribeThread: (
      input: OrchestrationSubscribeThreadInput,
      listener: (item: OrchestrationThreadStreamItem) => void,
      options?: StreamSubscriptionOptions,
    ) => () => void;
  };
}

export function createRpcClient(
  socketBaseUrl: string,
  lifecycleHandlers?: LifecycleHandlers,
): AppRpcClient {
  const transport = new SimpleWsTransport(socketBaseUrl, lifecycleHandlers);

  return {
    dispose: () => transport.dispose(),
    reconnect: () => transport.reconnect(),
    server: {
      getConfig: () => transport.request((client) => client[WS_METHODS.serverGetConfig]({})),
      subscribeConfig: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeServerConfig]({}),
          listener,
          options,
        ),
      subscribeLifecycle: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeServerLifecycle]({}),
          listener,
          options,
        ),
    },
    orchestration: {
      dispatchCommand: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.dispatchCommand](input)),
      subscribeShell: (listener, options) =>
        transport.subscribe(
          (client) => client[ORCHESTRATION_WS_METHODS.subscribeShell]({}),
          listener,
          options,
        ),
      subscribeThread: (input, listener, options) =>
        transport.subscribe(
          (client) => client[ORCHESTRATION_WS_METHODS.subscribeThread](input),
          listener,
          options,
        ),
    },
  };
}
