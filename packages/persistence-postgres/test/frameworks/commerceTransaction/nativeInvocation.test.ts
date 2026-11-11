import { Cause, Context, Effect, Exit, Result } from "effect";
import { beforeAll, expect, it } from "vitest";
import { encodeDocumentId } from "flarex-protocol/document-id";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import type { CoreNativeBindingMetadata, CoreNativeOperations } from "../../../src/core/api";
import { coreNativePolicyForTable, makeCoreRelationalNativeDefinition, type CoreNativeDefinition } from "../../../src/core/nativePolicy";
import { makeBoundedRequestLifetime } from "../../../src/execution/preparation/boundedRequestLifetime";
import { defineCommerceCommand, getCommerceCommand, type CommerceCommand } from "../../../src/frameworks/commerceTransaction/commands";
import { commerceError, type CommerceTransactionError } from "../../../src/frameworks/commerceTransaction/model";
import { makeBorrowedNativeCommerceInvocation } from "../../../src/frameworks/commerceTransaction/nativeInvocation";
import { defaultCommerceResources } from "../../../src/frameworks/commerceTransaction/resources";

let definition: CoreNativeDefinition;
beforeAll(async () => {
  definition = await Effect.runPromise(Effect.gen(function* () {
    const origin = { kind: "synthetic", sourceId: "neutral-commerce-invocation" } as const;
    const schema = yield* Effect.fromResult(normalizeRelationalSchema({ owner: "medusa", lineageId: origin.sourceId,
      tables: [{ tableId: "entry", origin, columns: [{ columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin }],
        keys: [{ keyId: "entry.primary", kind: "primary", columns: ["id"], origin }], indexes: [], constraints: [], relationships: [] }], capabilities: [] }));
    const source = yield* captureLogicalSchemaSource({ key: "medusa.neutral-commerce-invocation", owner: "medusa",
      writeProfile: "medusa.neutral-commerce-invocation", evidence: { provenance: origin }, definition: { kind: "relational", schema },
      bindings: [{ kind: "definition", localName: "entry", table: { namespace: "medusa", logicalName: `${origin.sourceId}/entry` } }] });
    return yield* makeCoreRelationalNativeDefinition({ scopeUuid: "67100000-0000-4000-8000-000000000001",
      epochUuid: "67100000-0000-4000-8000-000000000002", source, provenance: origin, commands: [] });
  }));
});

function metadata(commands: readonly CommerceCommand[]): CoreNativeBindingMetadata {
  const schemaId = Result.getOrThrow(encodeDocumentId(100, new Uint8Array(16)));
  return { definition, namespace: null, schemaId, authorityEpoch: 1n,
    commands: commands.map(token => {
      const command = getCommerceCommand(token);
      if (command === undefined) throw new Error("Expected authentic test command");
      const { name, mode } = command;
      return { name, mode, identity: { source: definition.identity, name, mode } };
    }),
    tables: definition.tables.map((table, index) => ({ name: table.name, number: 101 + index,
      tabletId: new Uint8Array(16).fill(index + 1), namespace: null, state: "active", indexes: [],
      nativePolicy: coreNativePolicyForTable(definition, table, "active", schemaId) })) };
}

// These ports fail if a callback unexpectedly reaches storage. The cases below
// check confined command/lifetime boundaries, not persistence or Core algorithms.
function operations(): CoreNativeOperations {
  const unexpected = () => Effect.die(new Error("Unexpected storage access at Commerce invocation boundary"));
  return { get: unexpected, getMany: unexpected, insert: unexpected, patch: unexpected, replace: unexpected, delete: unexpected,
    nativeActivityCursor: () => { throw new Error("Unexpected Core activity at Commerce invocation boundary"); },
    nativeActivitySince: unexpected, matchRelational: unexpected, replayRows: unexpected, reconstituteRows: unexpected,
    checkpointReferences: unexpected, planSetNullReferences: unexpected,
    normalizeId: unexpected, incomingReferences: unexpected, pendingDelete: unexpected, assertPendingDelete: unexpected,
    writeRows: unexpected, deleteRows: unexpected, lifecycle: unexpected, prepareDeleteClosure: unexpected,
    replaceReferenceSet: unexpected, referenceReplacementChanges: unexpected, protectedReferencePage: unexpected,
    assertProtectedReferenceGeneration: unexpected, isEmpty: unexpected, find: unexpected, findPage: unexpected };
}

const lifetime = () => makeBoundedRequestLifetime(commerceError,
  { calls: 32, commandBytes: 65_536, commandMs: 10_000 }, {}, {}, "commerce-borrow", "write");
const Annotation = Context.Service<object>("NativeCommerceInvocationTest/annotation");

it("latches a same-name foreign token refusal before its callback executes", () => Effect.runPromise(Effect.gen(function* () {
  let selectedCalls = 0, foreignCalls = 0;
  const selected = defineCommerceCommand("read", "read", () => Effect.sync(() => { selectedCalls++; return "selected"; }));
  const foreign = defineCommerceCommand("read", "read", () => Effect.sync(() => { foreignCalls++; return "foreign"; }));
  const request = yield* lifetime();
  const binding = metadata([selected]);
  const borrowed = yield* makeBorrowedNativeCommerceInvocation({ operations: operations(), metadata: binding, commands: [selected],
    lifetime: request, transactionId: "commerce-borrow", unixTime: 0, resources: defaultCommerceResources,
    mode: "write", readBinding: Effect.succeed(binding) });
  const refused = yield* Effect.exit(borrowed.borrow(foreign, {}));
  expect(Exit.isFailure(refused)).toBe(true);
  if (Exit.isFailure(refused)) expect(refused.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error.reason)).toContain("invalidAuthority");
  expect(Exit.isFailure(yield* Effect.exit(request.seal))).toBe(true);
  expect({ selectedCalls, foreignCalls }).toEqual({ selectedCalls: 0, foreignCalls: 0 });
  yield* request.close;
})));

it("rechecks the selected binding before every borrowed callback", () => Effect.runPromise(Effect.gen(function* () {
  let calls = 0, selected = true;
  const command = defineCommerceCommand("read", "read", () => Effect.sync(() => { calls++; return { value: "current" }; }));
  const request = yield* lifetime(), binding = metadata([command]);
  const borrowed = yield* makeBorrowedNativeCommerceInvocation({ operations: operations(), metadata: binding, commands: [command],
    lifetime: request, transactionId: "commerce-borrow", unixTime: 0, resources: defaultCommerceResources, mode: "write",
    readBinding: Effect.sync(() => selected ? binding : { ...binding, commands: [] }) });
  expect(yield* borrowed.borrow(command, {})).toEqual({ value: "current" });
  selected = false;
  const refused = yield* Effect.exit(borrowed.borrow(command, {}));
  expect(Exit.isFailure(refused)).toBe(true);
  if (Exit.isFailure(refused)) expect(refused.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error.reason)).toContain("bindingChanged");
  expect(calls).toBe(1);
  expect(Exit.isFailure(yield* Effect.exit(request.seal))).toBe(true);
  yield* request.close;
})));

it("retains a caught command's complete failure through outer sealing", () => Effect.runPromise(Effect.gen(function* () {
  const original = commerceError("invalidInput"), defect = new Error("native command defect"), marker = {};
  const stopped = Cause.fromReasons(Cause.combine(Cause.combine(Cause.fail(original), Cause.die(defect)), Cause.interrupt(719))
    .reasons.map(reason => reason.annotate(Context.make(Annotation, marker))));
  const command = defineCommerceCommand("read", "read", () => Effect.failCause(stopped));
  const request = yield* lifetime(), binding = metadata([command]);
  const borrowed = yield* makeBorrowedNativeCommerceInvocation({ operations: operations(), metadata: binding, commands: [command],
    lifetime: request, transactionId: "commerce-borrow", unixTime: 0, resources: defaultCommerceResources,
    mode: "write", readBinding: Effect.succeed(binding) });
  const assertOriginal = (cause: Cause.Cause<CommerceTransactionError>) => {
    const reasons = cause.reasons.filter(reason => reason.annotations.get(Annotation.key) === marker);
    expect(reasons.map(reason => reason._tag)).toEqual(["Fail", "Die", "Interrupt"]);
    expect(reasons.filter(Cause.isFailReason).map(reason => reason.error)).toEqual([original]);
    expect(reasons.filter(Cause.isDieReason).map(reason => reason.defect)).toEqual([defect]);
    expect(reasons.filter(Cause.isInterruptReason).map(reason => reason.fiberId)).toEqual([719]);
  };
  const refused = yield* Effect.exit(borrowed.borrow(command, {}));
  expect(Exit.isFailure(refused)).toBe(true);
  if (Exit.isFailure(refused)) assertOriginal(refused.cause);
  const sealed = yield* Effect.exit(request.seal);
  expect(Exit.isFailure(sealed)).toBe(true);
  if (Exit.isFailure(sealed)) assertOriginal(sealed.cause);
  yield* request.close;
})));

it.each(["borrow", "outer-context"] as const)("prevents a read callback from borrowing an otherwise selected write command through %s", path => Effect.runPromise(Effect.gen(function* () {
  let writes = 0;
  const write = defineCommerceCommand("write", "write", () => Effect.sync(() => { writes++; return null; }));
  const read = defineCommerceCommand("read", "read", context => context.nested(write, {}));
  const request = yield* lifetime(), binding = metadata([read, write]);
  const borrowed = yield* makeBorrowedNativeCommerceInvocation({ operations: operations(), metadata: binding, commands: [read, write],
    lifetime: request, transactionId: "commerce-borrow", unixTime: 0, resources: defaultCommerceResources,
    mode: "write", readBinding: Effect.succeed(binding) });
  const execute = path === "borrow" ? borrowed.borrow(read, {}) : request.nested(request.context, "commerce-borrow",
    manager => borrowed.invoke(manager, read, {}), getCommerceCommand(read)?.mode);
  expect(Exit.isFailure(yield* Effect.exit(execute))).toBe(true);
  expect(Exit.isFailure(yield* Effect.exit(request.seal))).toBe(true);
  expect(writes).toBe(0);
  yield* request.close;
})));
