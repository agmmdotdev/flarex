import { connect } from "cloudflare:sockets";

interface NativeCancellationEnv {
  readonly TCP_ADDRESS: string;
}

/** Native primitive contract only: no pg, application engine, SQL or I/O fake. */
export default {
  async fetch(_request: Request, env: NativeCancellationEnv): Promise<Response> {
    const reason = Object.freeze({ kind: "native-cancellation-contract", nonce: crypto.randomUUID() });
    const socket = connect(env.TCP_ADDRESS);
    const socketClosed = Promise.allSettled([socket.closed] as const);
    let closeAttempted = false;
    let primary: Readonly<{ cause: unknown }> | undefined;
    try {
      await socket.opened;
      const reader = socket.readable.getReader();
      const readerClosed = Promise.allSettled([reader.closed] as const);
      const pendingRead = Promise.allSettled([reader.read()] as const);
      const [cancel] = await Promise.allSettled([reader.cancel(reason)] as const);
      const [read] = await pendingRead;
      const [readerEnd] = await readerClosed;
      closeAttempted = true;
      const [close] = await Promise.allSettled([socket.close()] as const);
      const [closed] = await socketClosed;
      const rejection: unknown = read.status === "rejected" ? read.reason : undefined;
      const kind = typeof rejection === "object" && rejection !== null && "kind" in rejection
        ? rejection.kind : undefined;
      const nonce = typeof rejection === "object" && rejection !== null && "nonce" in rejection
        ? rejection.nonce : undefined;
      return Response.json({
        readRejected: read.status === "rejected",
        reasonCloned: rejection !== reason,
        kindMatches: kind === reason.kind,
        nonceMatches: nonce === reason.nonce,
        cancel: cancel.status,
        readerClosed: readerEnd.status,
        close: close.status,
        socketClosed: closed.status,
      });
    } catch (cause) {
      primary = { cause };
      throw cause;
    } finally {
      if (!closeAttempted) {
        const [cleanup] = await Promise.allSettled([socket.close()] as const);
        if (cleanup.status === "rejected") {
          throw new AggregateError(primary === undefined ? [cleanup.reason] : [primary.cause, cleanup.reason],
            "Native cancellation witness socket cleanup failed.");
        }
      }
    }
  },
};
