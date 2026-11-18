/** Deterministic primitive I/O only. The real pg-cloudflare class owns every
 * transport transition, write callback, generation and terminal event. */
export class PrimitiveSocket {
  readonly events: string[] = [];
  readonly cancelReasons: unknown[] = [];
  readonly writes: Uint8Array[] = [];
  readonly closedResult = deferred();
  readonly closeResult = deferred();
  readonly cancelResult = deferred();
  readonly writeResult = deferred();
  readonly closed = this.closedResult.promise;
  readonly opened = Promise.resolve({});
  readonly readable: { getReader(): ReadableStreamDefaultReader<Uint8Array> };
  readonly writable: WritableStream<Uint8Array>;
  #reader: ReadableStreamDefaultController<Uint8Array> | undefined;
  #readerSettled = false;
  tls: PrimitiveSocket | undefined;
  closeCalls = 0;
  cancelCalls = 0;

  constructor(readonly options: Readonly<{
    holdCancel?: boolean;
    holdClose?: boolean;
    holdWrites?: boolean;
    holdWriterLock?: boolean;
    cloneCancellationReason?: boolean;
    cancelReadFailure?: Readonly<{ cause: unknown }>;
  }> = {}) {
    if (!options.holdCancel) this.cancelResult.resolve();
    if (!options.holdWrites) this.writeResult.resolve();
    const readable = new ReadableStream<Uint8Array>({
      start: controller => { this.#reader = controller; },
      cancel: reason => {
        this.#readerSettled = true;
        this.cancelCalls++;
        this.cancelReasons.push(reason);
        this.events.push("reader.cancel");
        return this.cancelResult.promise;
      },
    });
    this.readable = options.cloneCancellationReason ? { getReader: () => {
      const reader = readable.getReader();
      let cancelled = false;
      let reason: unknown;
      return {
        closed: reader.closed,
        read: () => reader.read().then(result => {
          if (result.done && cancelled) {
            if (options.cancelReadFailure !== undefined) throw options.cancelReadFailure.cause;
            // Native Workers' optimized TCP readable rejects its pending read
            // with a copy of the supplied object while cancel/closed fulfill.
            if (reason === undefined) throw new Error("Stream was cancelled.");
            throw structuredClone(reason);
          }
          return result;
        }),
        cancel: value => { cancelled = true; reason = value; return reader.cancel(value); },
        releaseLock: () => { reader.releaseLock(); },
      };
    } } : readable;
    this.writable = new WritableStream<Uint8Array>({ write: chunk => {
      this.events.push("writer.write");
      this.writes.push(new Uint8Array(chunk));
      return this.writeResult.promise;
    } });
    // Native getWriter() now throws when the driver tries to acquire it. The
    // fixture does not throw a replacement acquisition error or alter the driver.
    if (options.holdWriterLock) this.writable.getWriter();
  }

  receive(bytes: Uint8Array): void {
    if (this.#reader === undefined) throw new Error("Missing primitive reader.");
    this.#reader.enqueue(bytes);
  }

  readerError(cause: unknown): void {
    if (this.#reader === undefined) throw new Error("Missing primitive reader.");
    this.#readerSettled = true;
    this.#reader.error(cause);
  }

  readerEnd(): void {
    if (this.#reader === undefined) throw new Error("Missing primitive reader.");
    this.#readerSettled = true;
    this.#reader.close();
  }

  finishPeer(): void {
    if (!this.#readerSettled) this.readerEnd();
    this.closedResult.resolve();
  }

  close(): Promise<void> {
    this.events.push("socket.close");
    this.closeCalls++;
    if (!this.options.holdClose) this.finishClose();
    return this.closeResult.promise;
  }

  finishClose(): void {
    this.closedResult.resolve();
    this.closeResult.resolve();
  }

  startTls(): PrimitiveSocket {
    this.events.push("socket.startTls");
    if (this.tls === undefined) throw new Error("Missing primitive TLS socket.");
    return this.tls;
  }
}

const pending: PrimitiveSocket[] = [];

export function queuePrimitiveSocket(socket: PrimitiveSocket): void {
  pending.push(socket);
}

export function connect(address: string, options: Readonly<{ secureTransport?: string }>): PrimitiveSocket {
  const socket = pending.shift();
  if (socket === undefined) throw new Error("Unexpected primitive socket acquisition.");
  socket.events.push(`connect:${address}:${options.secureTransport ?? "off"}`);
  return socket;
}

function deferred() {
  let resolve!: () => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<void>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}
