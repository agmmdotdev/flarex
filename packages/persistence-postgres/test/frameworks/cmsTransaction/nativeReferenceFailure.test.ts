import { Cause, Context, Effect, Exit, Option, Result } from "effect";
import { beforeAll, expect, it } from "vitest";
import { prepareLogicalSchemaCandidate } from "@flarex/analysis/internal/logical-schema-candidate";
import { encodeDocumentId } from "flarex-protocol/document-id";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { compilePayloadCollections } from "../../../../payload-adapter/src/collections";
import { compileProductCoreDefinition } from "../../../../medusa-adapter/src/modules/product/schema";
import { CoreTransactionError, type CoreNativeBindingMetadata, type CoreNativeOperations } from "../../../src/core/api";
import { coreNativePolicyForTable, makeCoreNativeDefinition } from "../../../src/core/nativePolicy";
import { makeCoreSchemaBundle } from "../../../src/core/schemaBundle";
import { makeCmsRequestLifetime } from "../../../src/frameworks/cmsTransaction/lifetime";
import { CmsTransactionError } from "../../../src/frameworks/cmsTransaction/model";
import { makeNativeCmsDocuments } from "../../../src/frameworks/cmsTransaction/nativeDocuments";
import { prepareNativeReferenceSaveAccess } from "../../../src/frameworks/cmsTransaction/nativeReferenceAccess";
import { prepareNativeReferencePagesAccess, readNativeReferencePage } from "../../../src/frameworks/cmsTransaction/nativeReferencePages";

const target = { scopeUuid: "f2bfbf4a-271e-4a44-bcc8-7aa3c7fe59bd", epochUuid: "df564a72-4a2c-4265-8b96-83ac7c90ee1e" };
const principal = { scopeId: ScopeIdSchema.make(`scope_${target.scopeUuid}`), principalDigest: "a".repeat(64) };
const policyId = Result.getOrThrow(encodeDocumentId(100, new Uint8Array(16)));
const sourceIds = [1, 2].map(value => Result.getOrThrow(encodeDocumentId(101, new Uint8Array(16).fill(value))));
const Annotation = Context.Service<object>("NativeReferenceFailureTest/annotation");
let metadata: CoreNativeBindingMetadata | undefined;

beforeAll(() => Effect.runPromise(Effect.gen(function* () {
  const compiled = yield* compilePayloadCollections([{ slug: "articles", fields: [
    { name: "headline", type: "text", required: true }, { name: "featuredProduct", type: "text" },
  ] }]);
  const payload = yield* makeCoreNativeDefinition({ ...target, source: compiled.sourceContract });
  const product = yield* compileProductCoreDefinition(target);
  const candidate = yield* prepareLogicalSchemaCandidate({ kind: "logicalSchemaCandidate", definitionVersion: 2, state: "candidate",
    deploymentId: "cms-cause-test", scopeId: "cms-cause-test", applicationAnalysis: { candidateId: "cms-cause-test", analysisId: "cms-cause-test",
      manifestSha256: "a".repeat(64), sourceArtifactRootSha256: "b".repeat(64) },
    sources: [payload.source, product.source], extensions: [{ name: "article_product", sourceKey: "payload",
      source: { table: { namespace: "app", logicalName: "articles" }, field: "featuredProduct" },
      target: { table: { namespace: "medusa", logicalName: "commerce.product/product" }, field: "id" },
      policy: "strongReference", liveness: { source: { kind: "current" }, target: { kind: "softDeleteNull", field: "deleted_at" } },
      onTargetSoftDelete: "retain", onTargetDelete: "restrict" }] });
  const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition: payload }, { kind: "native", definition: product }], candidate });
  // Composition metadata only. Core persistence, authority, query and integrity
  // algorithms are not reproduced by these confined failing operation ports.
  metadata = { definition: payload, namespace: null, schemaId: policyId, authorityEpoch: 1n, commands: payload.commands,
    tables: payload.tables.map((table, index) => ({ name: table.name, number: 101 + index, tabletId: new Uint8Array(16).fill(index + 1),
      namespace: null, state: "active", indexes: [], nativePolicy: coreNativePolicyForTable(payload, table, "active", policyId, bundle.protectedReferences) })) };
})));

function operations(overrides: Partial<CoreNativeOperations>): CoreNativeOperations {
  const unexpected = () => Effect.die(new Error("Unexpected operation at CMS failure boundary"));
  return { get: unexpected, getMany: unexpected, insert: unexpected, patch: unexpected, replace: unexpected, delete: unexpected,
    nativeActivityCursor: () => { throw new Error("Unexpected Core activity at CMS failure boundary"); },
    nativeActivitySince: unexpected, matchRelational: unexpected, replayRows: unexpected, checkpointReferences: unexpected, planSetNullReferences: unexpected,
    normalizeId: unexpected, incomingReferences: unexpected, pendingDelete: unexpected, assertPendingDelete: unexpected,
    writeRows: unexpected, deleteRows: unexpected, lifecycle: unexpected, prepareDeleteClosure: unexpected,
    replaceReferenceSet: unexpected, referenceReplacementChanges: unexpected, protectedReferencePage: unexpected,
    assertProtectedReferenceGeneration: unexpected, isEmpty: unexpected, find: unexpected, findPage: unexpected, ...overrides };
}

it.each(["save policy", "page policy", "page window", "buffered generation", "documents"] as const)(
  "preserves and latches typed failure, defect, interruption and annotations at the %s boundary", boundary =>
    Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      if (metadata === undefined) return yield* Effect.die(new Error("Missing native source fixture"));
      const native = metadata;
      const lifetime = yield* Effect.acquireRelease(makeCmsRequestLifetime({ hostId: Symbol() }, { requestId: Symbol() }, "cause-test", "read"), value => value.close);
      const original = new CoreTransactionError({ reason: "unavailable" }), defect = new Error("Core stop finalizer defect");
      const marker = Object.freeze({ boundary });
      const stopped = Cause.fromReasons(Cause.combine(Cause.combine(Cause.fail(original), Cause.die(defect)), Cause.interrupt(712))
        .reasons.map(reason => reason.annotate(Context.make(Annotation, marker))));
      let policyReads = 0, windows = 0, generations = 0, targetReads = 0;
      const application = { get: () => { policyReads++; return boundary === "save policy" || boundary === "page policy"
        ? Effect.failCause(stopped) : Effect.succeed(Option.some({ _id: policyId, _creationTime: 1,
          policy: { format: "flarex.private-reference-read-permissions", version: 1, principal,
            collection: "articles", relation: "featuredProduct", enumerate: ["product-one"], articles: sourceIds } })); } };
      const input = { application, policyDocumentId: policyId, principal, native, collection: "articles", table: "articles",
        field: "featuredProduct", lifetime, transactionId: "cause-test" };
      const core = operations({ getMany: () => Effect.failCause(stopped),
        protectedReferencePage: () => { windows++; return boundary === "page window" ? Effect.failCause(stopped)
          : Effect.succeed({ ids: sourceIds, hasMore: false, position: null, generation: 0, inspectedMemberships: 2 }); },
        assertProtectedReferenceGeneration: () => { generations++; return Effect.failCause(stopped); } });
      const work: Effect.Effect<unknown, CmsTransactionError> = boundary === "save policy" ? prepareNativeReferenceSaveAccess(input)
        : boundary === "documents" ? makeNativeCmsDocuments(core, lifetime).getMany(lifetime.context, "cause-test", "articles", sourceIds)
        : Effect.gen(function* () {
          const access = yield* prepareNativeReferencePagesAccess({ ...input, operations: core, targetId: "product-one",
            readTarget: Effect.sync(() => { targetReads++; return { id: "product-one" }; }) });
          const first = () => readNativeReferencePage(access, lifetime, { limit: 1 });
          if (boundary === "page policy") return yield* Effect.die(new Error("Failed policy unexpectedly admitted a page"));
          return yield* lifetime.operation(lifetime.context, "cause-test", "read", Effect.gen(function* () {
            if (boundary !== "buffered generation") return yield* first();
            const page = yield* first();
            if (page.cursor === null) return yield* Effect.die(new Error("Missing buffered continuation"));
            return yield* readNativeReferencePage(access, lifetime, { limit: 1, cursor: page.cursor });
          }));
        });
      const completed = yield* Effect.exit(work);
      expect(Exit.isFailure(completed)).toBe(true);
      if (Exit.isSuccess(completed)) return yield* Effect.die(new Error("Stopped Core boundary succeeded"));
      const assertOriginal = (cause: Cause.Cause<CmsTransactionError>) => {
        const reasons = cause.reasons.filter(reason => reason.annotations.get(Annotation.key) === marker);
        expect(reasons.map(reason => reason._tag)).toEqual(["Fail", "Die", "Interrupt"]);
        expect(reasons.filter(Cause.isFailReason).map(reason => reason.error)).toMatchObject([{ reason: "resourceFailure", cause: original }]);
        expect(reasons.filter(Cause.isFailReason).every(reason => reason.error instanceof CmsTransactionError && reason.error.cause === original)).toBe(true);
        expect(reasons.filter(Cause.isDieReason).map(reason => reason.defect)).toEqual([defect]);
        expect(reasons.filter(Cause.isInterruptReason).map(reason => reason.fiberId)).toEqual([712]);
      };
      assertOriginal(completed.cause);
      const sealed = yield* Effect.exit(lifetime.seal);
      if (Exit.isSuccess(sealed)) return yield* Effect.die(new Error("Caught Core stop cleared request failure"));
      assertOriginal(sealed.cause);
      expect(sealed.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error.reason)).toContain("rollbackOnly");
      expect({ policyReads, windows, generations, targetReads }).toEqual(boundary === "save policy" || boundary === "page policy"
        ? { policyReads: 1, windows: 0, generations: 0, targetReads: 0 }
        : boundary === "documents" ? { policyReads: 0, windows: 0, generations: 0, targetReads: 0 }
          : { policyReads: 1, windows: 1, generations: boundary === "buffered generation" ? 1 : 0, targetReads: 1 });
    }))),
);
