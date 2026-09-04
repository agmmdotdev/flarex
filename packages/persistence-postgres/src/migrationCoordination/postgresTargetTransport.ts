import { Client, type PoolConfig } from "pg";

interface PostgresBackendKeyData { readonly processId: number; readonly secretKey: number; }

// Ported from artifact control-session transport; migration owns its own lifecycle and identities.
export function sendPostgresCancelRequest(
  backendKeyData: PostgresBackendKeyData,
  clientConfig: PoolConfig,
  timeoutMilliseconds: number,
): Promise<void> {
  const cancellationClient = new Client(clientConfig);
  if (cancellationClient.ssl !== false) {
    return Promise.reject(new Error(
      "PostgreSQL authenticated cancellation is not enabled for TLS connections.",
    ));
  }
  const connection = cancellationClient.connection;
  const connect = Reflect.get(connection, "connect");
  const cancel = Reflect.get(connection, "cancel");
  if (typeof connect !== "function" || typeof cancel !== "function") {
    return Promise.reject(new Error(
      "Installed node-postgres connection has no cancellation protocol capability.",
    ));
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let cancelSent = false;
    let observedError: unknown;
    const removeListeners = () => {
      connection.removeListener("connect", onConnect);
      connection.removeListener("end", onEnd);
      connection.removeListener("error", onError);
    };
    const settleFailure = (cause: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Retain the error observer until the destroyed transport emits end; a
      // late EventEmitter error must never become an uncaught host exception.
      connection.removeListener("connect", onConnect);
      reject(cause);
    };
    const destroyTransport = (cause: unknown) => {
      observedError ??= cause;
      try {
        cancellationClient.connection.stream.destroy();
      } catch (destroyCause) {
        observedError = aggregateCauses(
          [observedError, destroyCause],
          "PostgreSQL cancellation transport destruction failed.",
        );
      }
    };
    const onConnect = () => {
      try {
        Reflect.apply(cancel, connection, [
          backendKeyData.processId,
          backendKeyData.secretKey,
        ]);
        cancelSent = true;
      } catch (cause) {
        destroyTransport(cause);
        settleFailure(observedError);
      }
    };
    const onError = (cause: unknown) => {
      if (cancelSent && isExpectedPostgresCancelTransportClosure(cause)) {
        return;
      }
      destroyTransport(cause);
      settleFailure(observedError);
    };
    const onEnd = () => {
      removeListeners();
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (observedError !== undefined) {
        reject(observedError);
      } else if (!cancelSent) {
        reject(new Error(
          "PostgreSQL cancellation transport ended before sending CancelRequest.",
        ));
      } else {
        resolve();
      }
    };
    const timer = setTimeout(() => {
      const timeoutCause = new Error(
        "PostgreSQL authenticated CancelRequest did not settle within the quarantine budget.",
      );
      destroyTransport(timeoutCause);
      settleFailure(observedError);
    }, timeoutMilliseconds);

    connection.once("connect", onConnect);
    connection.once("end", onEnd);
    connection.on("error", onError);
    try {
      if (cancellationClient.host.startsWith("/")) {
        Reflect.apply(connect, connection, [
          `${cancellationClient.host}/.s.PGSQL.${cancellationClient.port}`,
        ]);
      } else {
        Reflect.apply(connect, connection, [
          cancellationClient.port,
          cancellationClient.host,
        ]);
      }
    } catch (cause) {
      destroyTransport(cause);
      settleFailure(observedError);
    }
  });
}

function isExpectedPostgresCancelTransportClosure(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  const code = Reflect.get(cause, "code");
  return code === "ECONNRESET" || code === "EPIPE";
}

export function settleWithinPlatformTimeout<Value>(
  promise: Promise<Value>,
  timeoutMilliseconds: number,
  timeoutMessage: string,
): Promise<Value> {
  return new Promise<Value>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(timeoutMessage));
    }, timeoutMilliseconds);
    void promise.then(
      value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      cause => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(cause);
      },
    );
  });
}

function aggregateCauses(causes: readonly unknown[], message: string) { return new AggregateError(causes, message); }
