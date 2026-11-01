import { Result } from "effect";
import { encodeAdmittedFrameworkOperationV1Result } from "flarex-protocol/internal/admitted-framework-operation-v1";
import { normalizeFlarexValueV1 } from "flarex-protocol/value";
import { detachCapabilityValue, disposeReceivedCapability, executeApplicationTransactionWorkerV1,
  type ApplicationWorkerExecutionInputV1 } from "./ApplicationWorkerCore";

// Capture the trusted call edge before loading developer modules. In
// particular a mutable Reflect.apply must never observe the raw RPC receiver.
const APPLY = Reflect.apply;
const GET = Reflect.get;
const OWN = Object.getOwnPropertyDescriptor;
const DESCRIPTORS = Object.getOwnPropertyDescriptors;
const DEFINE = Object.defineProperties;
const FREEZE = Object.freeze;
const PROTOTYPE = Object.getPrototypeOf;
const OBJECT_PROTOTYPE = Object.prototype;
const IS_ARRAY = Array.isArray;
const RESOLVE = Promise.resolve.bind(Promise);
const REJECT = Promise.reject.bind(Promise);
const ALL_SETTLED = Promise.allSettled.bind(Promise);
const JSON_PARSE = JSON.parse;
const UTF8 = new TextDecoder();
const DECODE_UTF8 = UTF8.decode.bind(UTF8);
const AGGREGATE_ERROR = AggregateError;

type NativeRecord = Readonly<Record<string, unknown>>;
const own = (value: NativeRecord, name: string): unknown => {
  const descriptor = OWN(value, name);
  if (descriptor === undefined || !("value" in descriptor)) throw new Error("Private native registration requires an own data field");
  return descriptor.value;
};
const record = (value: unknown): NativeRecord => {
  if (value === null || typeof value !== "object" || IS_ARRAY(value)
    || PROTOTYPE(value) !== null && PROTOTYPE(value) !== OBJECT_PROTOTYPE)
    throw new Error("Private native registration requires a plain record");
  // SAFETY: the boundary rejected null, arrays and non-plain prototypes. All
  // selected fields are independently inspected as own data before use.
  return value as NativeRecord;
};
const cloneWith = (value: NativeRecord, name: string, replacement: unknown): NativeRecord => {
  const descriptors = DESCRIPTORS(value);
  descriptors[name] = { value: replacement, enumerable: true, writable: false, configurable: false };
  return FREEZE(DEFINE({}, descriptors));
};

/** Private profile context translation above the unchanged CoreV6 Worker
 * kernel. The backend's same-root capability owns command/policy admission. */
export async function executePrivateNativeApplicationTransactionWorker(input: ApplicationWorkerExecutionInputV1) {
  if (input.definition.documentIdFormat !== "convex" || input.definition.rootFunction.kind !== "mutation")
    throw new Error("Private native execution requires the selected Core mutation profile");
  const capability = input.capability;
  if ((typeof capability !== "object" || capability === null) && typeof capability !== "function")
    throw new Error("Private native capability is missing");
  const nativeMethod: unknown = GET(capability, "runPrivateNativeOperation");
  if (typeof nativeMethod !== "function") throw new Error("Private native capability is missing");
  const selected = input.definition.rootFunction;
  return executeApplicationTransactionWorkerV1({ ...input, loadExecution: async () => {
    const loaded = record(await input.loadExecution()), modules = record(own(loaded, "default"));
    const module = record(own(modules, selected.moduleName)), registration = record(own(module, selected.exportName));
    const handler = own(registration, "_handler");
    if (typeof handler !== "function") throw new Error("Private native function handler is missing");
    // Keep every genuine registration field. The shared kernel still checks
    // its source-bound kind/visibility/validators and executes the original body.
    const wrapped = cloneWith(registration, "_handler", async (context: unknown, args: unknown) => {
      const supplied = record(context), database = record(own(supplied, "db"));
      let accepting = true, nativePending = false, databasePending = 0;
      let firstFailure: Readonly<{ cause: unknown }> | undefined;
      const pending = new Set<Promise<unknown>>();
      const refuse = (message: string): never => {
        const cause = new Error(message);
        firstFailure ??= { cause };
        throw cause;
      };
      const observe = <Value>(work: () => Value | PromiseLike<Value>): Promise<Value> => {
        let completion: Promise<Value>;
        try { completion = RESOLVE(work()); }
        catch (cause) { completion = REJECT(cause); }
        const tracked = completion.catch((cause: unknown) => { firstFailure ??= { cause }; throw cause; });
        pending.add(tracked);
        void tracked.then(() => pending.delete(tracked), () => pending.delete(tracked));
        return tracked;
      };
      const dbDescriptors = DESCRIPTORS(database);
      for (const name of ["get", "insert", "patch", "replace", "delete"] as const) {
        const method = dbDescriptors[name];
        if (method === undefined || !("value" in method) || typeof method.value !== "function") continue;
        const original: unknown = method.value;
        if (typeof original !== "function") continue;
        dbDescriptors[name] = { ...method, value: (...values: readonly unknown[]) => {
          if (!accepting || nativePending) return refuse("Private native and Application operations must be sequential");
          databasePending++;
          const returned = observe(() => APPLY(original, database, values)).finally(() => { databasePending--; });
          void returned.catch(() => undefined);
          return returned;
        } };
      }
      const privateMixed = FREEZE({ call: (participant: string, operation: string, nativeArgs: unknown) => {
        if (!accepting || nativePending || databasePending !== 0) return refuse("Private native operations must be sequential");
        if (firstFailure !== undefined) throw firstFailure.cause;
        const capturedOperation = Result.match(encodeAdmittedFrameworkOperationV1Result({ format: "flarex.admitted-framework-operation", version: 1,
          participant, operation, args: nativeArgs }), { onFailure: cause => { firstFailure ??= { cause }; throw cause; }, onSuccess: value => value });
        nativePending = true;
        const returned = observe(async () => {
          // The protocol capture owns null-prototype records. Workerd RPC needs
          // ordinary JSON records; this projection carries data, never authority.
          const transport: unknown = JSON_PARSE(DECODE_UTF8(capturedOperation.bytes));
          const received: unknown = await APPLY(nativeMethod, capability, [transport]);
          let decoded: Readonly<{ kind: "value"; value: ReturnType<typeof normalizeFlarexValueV1>["value"] }>
            | Readonly<{ kind: "failure"; cause: unknown }>;
          try {
            decoded = { kind: "value", value: normalizeFlarexValueV1(detachCapabilityValue(received, "ApplicationWorkerJournalBoundaryV1Error")).value };
          } catch (cause) { decoded = { kind: "failure", cause }; }
          let cleanup: Readonly<{ cause: unknown }> | undefined;
          try { disposeReceivedCapability(received); }
          catch (cause) { cleanup = { cause }; }
          if (decoded.kind === "failure") {
            if (cleanup !== undefined) throw new AGGREGATE_ERROR([decoded.cause, cleanup.cause], "Private native result and cleanup failed");
            throw decoded.cause;
          }
          if (cleanup !== undefined) throw cleanup.cause;
          return decoded.value;
        })
          .finally(() => { nativePending = false; });
        void returned.catch(() => undefined);
        return returned;
      } });
      const borrowed = cloneWith(cloneWith(supplied, "db", FREEZE(DEFINE({}, dbDescriptors))), "privateMixed", privateMixed);
      let value: unknown, failure: Readonly<{ cause: unknown }> | undefined;
      try { value = await APPLY(handler, undefined, [borrowed, args]); }
      catch (cause) { failure = { cause }; }
      finally {
        accepting = false;
        while (pending.size !== 0) await ALL_SETTLED([...pending]);
      }
      if (failure !== undefined) throw failure.cause;
      if (firstFailure !== undefined) throw firstFailure.cause;
      return value;
    });
    return cloneWith(loaded, "default", cloneWith(modules, selected.moduleName, cloneWith(module, selected.exportName, wrapped)));
  } });
}
