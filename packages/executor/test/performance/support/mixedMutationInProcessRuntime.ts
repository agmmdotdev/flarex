import { Effect, Result, Schema } from "effect";
import { withExecutionDiagnosticDefaults } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import type { MixedMutationEffectDiagnostics } from "./measurement";
import { executePointMutationV1 } from "../../../../function-runtime/src/pointMutation";
import { createFunctionRuntimeAuthV1, createFunctionRuntimePointDatabaseWriterV1,
  createFunctionRuntimePointReaderV1 } from "../../../../function-runtime/src/functionApiCore";
import {
  decodePointMutationExactRuntimeRequestV1Effect,
} from "flarex-protocol/point-mutation-exact-runtime";
import { AppDocumentIdV1Schema, decodeAppDocumentIdentityV1Result } from "flarex-protocol/app-document-id";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import {
  decodeAdmittedFrameworkOperationV1Result,
} from "flarex-protocol/internal/admitted-framework-operation-v1";
import {
  ApplicationRevisionSyscallDocumentValidationV1Error,
} from "@flarex/persistence-postgres/internal/application-syscall-errors";
import { isCanonicalFlarexRuntimeObjectV1, normalizeFlarexValueV1 } from "flarex-protocol/value";
import type {
  MixedMutationPerformanceTrace,
} from "../../../../persistence-postgres/test/performance/mixedMutationPerformanceTrace";

/** Test-only transport port. The core fixture owns all trusted journal work;
 * host adapters supply only invocation of the selected application source. */
export type MixedMutationExecutionHost = (input: Readonly<{
  source: string;
  request: string;
  executionModule: string;
  executionTime: number;
  bridge: (message: unknown) => Promise<unknown>;
  trace?: MixedMutationPerformanceTrace | undefined;
  onReady?: ((milliseconds: number) => void) | undefined;
}>) => Promise<unknown>;

const RecordSchema = Schema.Record(Schema.String, Schema.Unknown);
const RequestContextSchema = Schema.Struct({ randomSeed: Schema.Array(Schema.Number) });
const strict = { onExcessProperty: "error" } as const;
const decodeInsert = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("inserted"),
  documentId: AppDocumentIdV1Schema, document: Schema.Unknown }), strict);
const decodeRead = Schema.decodeUnknownSync(Schema.Union([
  Schema.Struct({ kind: Schema.Literal("missing"), document: Schema.Null }),
  Schema.Struct({ kind: Schema.Literal("present"), document: Schema.Unknown }),
]), strict);
const decodeUnit = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("unit"),
  operation: Schema.Literals(["patch", "replace", "delete"]) }), strict);
const decodeCreationTime = Schema.decodeUnknownSync(AppCreationTimeV1Schema);

// Test transport acknowledgements carry no authority. Match their contextual
// correlation here; the real journal remains the sole operation/admission owner.
function journalDocument(value: unknown, documentId: string, tableId: number) {
  const identity = Result.getOrThrow(decodeAppDocumentIdentityV1Result(documentId));
  const document = normalizeFlarexValueV1(value, "appDocument").value;
  if (!isCanonicalFlarexRuntimeObjectV1(document) || identity.tableId !== tableId || document._id !== documentId)
    throw new Error("Journal document identity does not match the requested table and ID");
  decodeCreationTime(document._creationTime);
  return document;
}

function developerFields(value: unknown) {
  const document = normalizeFlarexValueV1(value, "appDocument").value;
  if (!isCanonicalFlarexRuntimeObjectV1(document) || Object.hasOwn(document, "_id") || Object.hasOwn(document, "_creationTime"))
    throw new Error("Developer fields must be an object without system fields");
  return document;
}

function capturedPatch(value: unknown) {
  // Undefined is the owned patch deletion sentinel. Normalize a null probe to
  // validate every field/descriptor, then restore only its captured sentinels.
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Patch must be an object");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) throw new Error("Patch must be a plain object");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const probe: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new Error("Patch must not contain symbols");
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable)
      throw new Error("Patch must contain enumerable data fields");
    Object.defineProperty(probe, key, { value: descriptor.value === undefined ? null : descriptor.value, enumerable: true });
  }
  const normalized = normalizeFlarexValueV1(probe).value;
  if (!isCanonicalFlarexRuntimeObjectV1(normalized) || Object.hasOwn(normalized, "_id") || Object.hasOwn(normalized, "_creationTime"))
    throw new Error("Patch must not contain system fields");
  const captured: Record<string, unknown> = {};
  for (const key of Object.keys(normalized)) Object.defineProperty(captured, key, {
    value: descriptors[key]?.value === undefined ? undefined : normalized[key], enumerable: true,
  });
  return Object.freeze(captured);
}

/** Runs trusted benchmark source through the actual portable mutation kernel.
 * Node execution deliberately does not claim Worker sandbox or deterministic
 * global replacement. Scenarios receive only this restricted journal facade. */
export const runMixedMutationInProcess = async (input: Parameters<MixedMutationExecutionHost>[0],
  diagnostics?: MixedMutationEffectDiagnostics): ReturnType<MixedMutationExecutionHost> => {
  const rawRequest = Schema.decodeUnknownSync(RecordSchema)(JSON.parse(input.request));
  const rawContext = Schema.decodeUnknownSync(RecordSchema)(rawRequest.context);
  const seed = Schema.decodeUnknownSync(RequestContextSchema)(rawContext).randomSeed;
  const decodeRequest = decodePointMutationExactRuntimeRequestV1Effect({
    ...rawRequest, context: { ...rawContext, randomSeed: new Uint8Array(seed) },
  });
  const request = await Effect.runPromise(diagnostics === undefined ? withExecutionDiagnosticDefaults(decodeRequest)
    : diagnostics.provide(decodeRequest));
  // These benchmark modules contain only authored JS and no imports. Evaluation
  // is the fixture's executable boundary, never a production untrusted runner.
  const namespace = Schema.decodeUnknownSync(RecordSchema)(
    new Function(input.source.replace(/^export default /, "return "))(),
  );
  let sequence = 0n;
  let tail: Promise<void> = Promise.resolve();
  let accepting = true;
  let firstFailure: Readonly<{ cause: unknown }> | undefined;
  let admittedPending = false;
  const enqueue = <A>(run: (next: string) => Promise<unknown>, decode: (value: unknown) => A, catchableDocumentRejection = false): Promise<A> => {
    if (!accepting) {
      const cause = new Error("Core benchmark journal operation started after handler settlement");
      firstFailure ??= { cause };
      throw cause;
    }
    const result = tail.then(async () => {
      if (firstFailure !== undefined) throw firstFailure.cause;
      let value: unknown;
      try { value = await run(String(sequence + 1n)); }
      catch (cause) {
        if (catchableDocumentRejection && cause instanceof ApplicationRevisionSyscallDocumentValidationV1Error) throw cause;
        firstFailure ??= { cause };
        throw cause;
      }
      sequence++;
      try { return decode(value); }
      catch (cause) { firstFailure ??= { cause }; throw cause; }
    });
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
  const tableForId = (id: string): string => {
    const identity = Result.getOrThrow(decodeAppDocumentIdentityV1Result(id));
    const table = request.tables.find(entry => entry.tableId === identity.tableId);
    if (table === undefined) throw new Error("Document belongs to an unprojected table");
    return table.logicalName;
  };
  const point = <A>(tableName: string, operation: Readonly<Record<string, unknown>>, decode: (value: unknown, tableId: number) => A) => {
    const table = request.tables.find(entry => entry.logicalName === tableName);
    if (table === undefined) throw new Error("Unknown projected table");
    return enqueue(next => input.bridge({ kind: "point", tableName, operation: { ...operation, syscallSequence: next } }),
      value => decode(value, table.tableId), true);
  };
  const reader = createFunctionRuntimePointReaderV1((documentId: string) => point(tableForId(documentId),
    { kind: "get", documentId }, (value, tableId) => {
      const outcome = decodeRead(value);
      return outcome.kind === "missing" ? null : journalDocument(outcome.document, documentId, tableId);
    }));
  const unit = (kind: "patch" | "replace" | "delete", documentId: string, fields: Readonly<Record<string, unknown>>) =>
    point(tableForId(documentId), { kind, documentId, ...fields }, value => {
      if (decodeUnit(value).operation !== kind) throw new Error("Journal unit acknowledgement does not match the requested operation");
    });
  const database = createFunctionRuntimePointDatabaseWriterV1(reader, {
    insertPointDocument: (tableName: string, fields: unknown): Promise<string> => point(tableName,
      { kind: "insert", fields: developerFields(fields) }, (value, tableId) => {
        const outcome = decodeInsert(value);
        journalDocument(outcome.document, outcome.documentId, tableId);
        return outcome.documentId;
      }),
    patchPointDocument: (documentId: string, patch: unknown) => unit("patch", documentId, { patch: capturedPatch(patch) }),
    replacePointDocument: (documentId: string, fields: unknown) => unit("replace", documentId, { fields: developerFields(fields) }),
    deletePointDocument: (documentId: string) => unit("delete", documentId, {}),
  });
  const context = Object.freeze({ auth: createFunctionRuntimeAuthV1({ kind: "anonymous" }), db: database,
    privateMixed: Object.freeze({ call(participant: string, operation: string, args: unknown) {
      if (!accepting) {
        const cause = new Error("Private mixed operation started after handler settlement");
        firstFailure ??= { cause };
        throw cause;
      }
      if (admittedPending) {
        const cause = new Error("Parallel private mixed operations are unsupported");
        firstFailure ??= { cause };
        throw cause;
      }
      try {
        const frame = decodeAdmittedFrameworkOperationV1Result({ format: "flarex.admitted-framework-operation", version: 1, participant, operation, args });
        const captured = Result.getOrThrow(frame);
        admittedPending = true;
        const pending = enqueue(next => input.bridge({ kind: "admitted", sequence: next, frame: captured }), value => value);
        const returned = pending.finally(() => { admittedPending = false; });
        void returned.catch(() => undefined);
        return returned;
      } catch (cause) {
        firstFailure ??= { cause };
        throw cause;
      }
    } }) });
  const value = await executePointMutationV1(request, {
    resolve(path) {
      const [moduleName, functionName] = path.split(":");
      if (moduleName === undefined || functionName === undefined) return undefined;
      const functions = Schema.decodeUnknownSync(RecordSchema)(namespace[moduleName]);
      return functions[functionName];
    },
  }, { open: () => ({ context, isCoreApplicationError: () => false,
    journal: { close: () => { accepting = false; }, drain: async () => {
      let observed: Promise<void>;
      do { observed = tail; await observed; await Promise.resolve(); } while (tail !== observed);
      if (firstFailure !== undefined) throw firstFailure.cause;
    } } }) });
  return { kind: "result", result: { kind: "success", result: {
    format: "flarex.point-mutation-exact-runtime-result", version: 1, value,
  } } };
};
