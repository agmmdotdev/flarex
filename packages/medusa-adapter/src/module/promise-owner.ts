import { Cause, Effect, Exit, Result } from "effect";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { MedusaError } from "@medusajs/framework/utils/portable";
import { captureExecutionDiagnosticContext } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { commerceError, commerceLimits, CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";

type FailureObserver = CommerceCommandContext["recordFailure"];

/** Own the executable native Promise edge. Only this owner's issued identities
 * transport a Cause; arbitrary foreign Cause objects remain defects. */
export function makeCommercePromiseOwner(recordFailure?: FailureObserver) {
  return Effect.withFiber(fiber => {
    const tracingContext = captureExecutionDiagnosticContext(fiber);
    const controller = new AbortController();
    const runners = new Map<Promise<unknown>, Promise<Exit.Exit<unknown, CommerceTransactionError>>>();
    const callbacks = new Set<Promise<unknown>>();
    const receipts = new WeakMap<object, Cause.Cause<CommerceTransactionError>>();
    // Only actual native classification issues this presentation provenance.
    // It changes the Promise view, never the registered typed failure.
    const nativePresentations = new WeakMap<CommerceTransactionError, MedusaError>();
    // Pending transport outcomes, not a competing first-failure latch. The
    // existing bounded lifetime remains the only sticky request authority.
    const unobserved = new Set<Cause.Cause<CommerceTransactionError>>();
    let open = true;
    let closed = false;
    const observeCompletion = (cause: Cause.Cause<CommerceTransactionError>) => {
      if (recordFailure === undefined) return cause;
      return Result.match(recordFailure(cause), {
        onSuccess: owned => owned,
        onFailure: error => Cause.combine(cause, Cause.fail(error)),
      });
    };
    const register = (cause: Cause.Cause<CommerceTransactionError>) => closed ? cause : observeCompletion(cause);
    const issue = (cause: Cause.Cause<CommerceTransactionError>, presentation?: Error): object => {
      // Preserve native single-error identity. Compound/primitive/interruption
      // transport has an inert private identity, never a structural Cause tag.
      const reason = cause.reasons.length === 1 ? cause.reasons[0] : undefined;
      const single = reason && (Cause.isFailReason(reason) ? reason.error : Cause.isDieReason(reason) ? reason.defect : undefined);
      const nativePresentation = reason !== undefined && Cause.isFailReason(reason)
        ? presentation ?? nativePresentations.get(reason.error) : undefined;
      const candidate = nativePresentation ?? (single !== null && (typeof single === "object" || typeof single === "function") ? single : undefined);
      // A reused error may complete distinct annotated failures concurrently.
      // Never overwrite an issued identity with a different complete Cause.
      const receipt = candidate !== undefined && (receipts.get(candidate) === undefined || receipts.get(candidate) === cause)
        ? candidate : Object.freeze({});
      receipts.set(receipt, cause);
      // A fenced late caller still receives its failure, but cannot reopen
      // cleanup after this owner has completed.
      if (!closed) unobserved.add(cause);
      return receipt;
    };
    const classify = (error: unknown, domain?: (error: unknown) => CommerceTransactionError | undefined): Cause.Cause<CommerceTransactionError> => {
      if (error !== null && (typeof error === "object" || typeof error === "function")) {
        const owned = receipts.get(error);
        if (owned !== undefined) return owned;
      }
      // Foreign thrown proxies can refuse prototype inspection. That refusal
      // does not make the original rejection an expected domain error.
      try {
        if (error instanceof CommerceTransactionError) return Cause.fail(error);
        if (error instanceof MedusaError) {
          const expected = commerceError("adapterFailure", error);
          nativePresentations.set(expected, error);
          return Cause.fail(expected);
        }
        const expected = domain?.(error);
        return expected === undefined ? Cause.die(error) : Cause.fail(expected);
      } catch { return Cause.die(error); }
    };
    const reject = (error: CommerceTransactionError): never => {
      const cause = Cause.fail(error);
      throw issue(register(cause));
    };
    const assertOpen = (): void => { if (!open) reject(commerceError("closed")); };
    const stop = () => { open = false; controller.abort(); };
    const run = <Value>(work: Effect.Effect<Value, CommerceTransactionError>,
      projectExpectedFailure?: (failure: CommerceTransactionError) => Error | undefined): Promise<Value> => {
      if (!open) return Promise.reject(commerceError("closed"));
      const exit = Effect.runPromiseExitWith(tracingContext)(work, { signal: controller.signal });
      const pending = exit.then(result => {
        if (Exit.isSuccess(result)) return result.value;
        const cause = register(result.cause);
        const reason = cause.reasons.length === 1 ? cause.reasons[0] : undefined;
        if (projectExpectedFailure !== undefined && reason !== undefined && Cause.isFailReason(reason)) {
          let presentation: Error | undefined;
          try {
            presentation = projectExpectedFailure(reason.error);
          } catch (defect) {
            // Presentation is a trusted native boundary. A broken formatter
            // adds its defect to the original chain; it cannot replace it.
            throw issue(register(Cause.combine(cause, Cause.die(defect))));
          }
          // Only the Promise rejection changes. Re-entry and cleanup retain
          // the original registered Cause, including its originating Reasons.
          throw issue(cause, presentation);
        }
        throw issue(cause);
      });
      runners.set(pending, exit);
      void pending.then(() => runners.delete(pending), () => runners.delete(pending));
      return pending;
    };
    const callback = <Value>(work: () => Promise<Value>, signal: AbortSignal): Promise<Value> => {
      if (!open || signal.aborted) return Promise.reject(commerceError("closed"));
      signal.addEventListener("abort", stop, { once: true });
      const pending = Promise.resolve().then(() => {
        if (!open) throw commerceError("closed");
        return work();
      }).finally(() => signal.removeEventListener("abort", stop));
      callbacks.add(pending);
      void pending.then(() => callbacks.delete(pending), () => callbacks.delete(pending));
      return pending;
    };
    const invoke = <Value>(work: () => Promise<Value>, domain?: (error: unknown) => CommerceTransactionError | undefined): Effect.Effect<Value, CommerceTransactionError> =>
      Effect.suspend(() => !open ? Effect.fail(commerceError("closed")) : Effect.callback<Value, CommerceTransactionError>((resume, signal) => {
        void callback(work, signal).then(value => resume(Effect.succeed(value)), error => {
          if (closed) return;
          const original = classify(error, domain);
          const cause = register(original);
          unobserved.add(cause);
          // Mark restored only when the owning fiber actually executes resume.
          // A cancelled callback can complete after resume has become inert.
          resume(Effect.sync(() => { unobserved.delete(original); unobserved.delete(cause); })
            .pipe(Effect.andThen(Effect.failCause(cause))));
        });
      }));
    const close = Effect.suspend(() => {
      const joining = [...runners.entries()];
      stop();
      return Effect.promise(async () => {
        await Promise.all(joining.map(([, exit]) => exit));
        if (callbacks.size !== 0) {
          await new Promise<void>(resolve => {
            const timer = setTimeout(resolve, commerceLimits.cleanupMs);
            void Promise.allSettled([...callbacks]).then(() => { clearTimeout(timer); resolve(); });
          });
        }
        let cleanup: Cause.Cause<CommerceTransactionError> = Cause.empty;
        for (const cause of unobserved) {
          cleanup = Cause.combine(cleanup, cause);
        }
        unobserved.clear();
        closed = true;
        return cleanup;
      }).pipe(Effect.map(cause => cause.reasons.length === 0 ? Exit.void : Exit.failCause(cause)));
    });
    const withClose = <Value, R>(work: Effect.Effect<Value, CommerceTransactionError, R>): Effect.Effect<Value, CommerceTransactionError, R> =>
      Effect.uninterruptibleMask(restore => Effect.gen(function* () {
        const result = yield* Effect.exit(restore(work));
        const cleanup = yield* close;
        // This synchronous completion owns the joined body and cleanup. Late
        // asynchronous callbacks remain fenced by closed above; the lifetime
        // still authenticates its live context and enforces the seal fence.
        if (Exit.isFailure(result)) return yield* Effect.failCause(observeCompletion(Exit.isFailure(cleanup)
          ? Cause.combine(result.cause, cleanup.cause) : result.cause));
        if (Exit.isFailure(cleanup)) return yield* Effect.failCause(observeCompletion(cleanup.cause));
        return result.value;
      }));
    return Effect.succeed({ run, invoke, close, withClose, reject, assertOpen, hasPending: () => runners.size !== 0 || callbacks.size !== 0 });
  });
}
export type CommercePromiseOwner = Effect.Success<ReturnType<typeof makeCommercePromiseOwner>>;
