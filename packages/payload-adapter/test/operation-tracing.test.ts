import { describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Fiber, Layer, Option, Tracer } from "effect";
import { ExecutionDiagnostics, type ExecutionDiagnosticPolicy } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { isJsonObject, type Json } from "flarex-protocol/json";
import { compilePayloadCollections } from "../src/collections";
import { makePayloadNative } from "../src/runtime/native";
import { bindPayloadDirect } from "../src/direct/binding";
import { UnsupportedPayloadCapability } from "../src/errors";
import { payloadPostsCollectionDefinition, payloadScalarFields } from "../src/testing/profiles";
import { cmsHostFixture } from "../../persistence-postgres/test/cmsHostFixture";
import { preparedHostTestRuntime } from "../../persistence-postgres/test/preparedHostRuntimeTestSupport";
import { barrier, withDeadline } from "../../persistence-postgres/test/payloadRelationScenario";
import { runEffect } from "../../persistence-postgres/test/effectTestRuntime";
import { createRelationalPGliteFixture } from "../../persistence-postgres/test/relationalPGliteWorkerTestSupport";
import { postgresUrl, useFileScopedPostgresPersistence } from "../../persistence-postgres/test/postgresHelpers";
import { createIntrinsicCreationTimeIndexDefinitionPortV1 } from "../../persistence-postgres/src/intrinsicCreationTimeIndexBuildV1";
import { createAppDeveloperIndexDefinitionPortV1 } from "../../persistence-postgres/src/appDeveloperIndexCommitV1";
import { createAppUniqueConstraintDefinitionPortV1 } from "../../persistence-postgres/src/appUniqueConstraintCommitV1";
import { createAppSchemaCandidateWriteGuardPort } from "../../persistence-postgres/src/appSchemaCandidateValidation";
import { makePostgresRelationalSession, type RelationalSession } from "../../persistence-postgres/src/relationalTransaction/session";
import type { PGliteFlarexPersistence } from "../../persistence-postgres/src/pglite";
import type { PostgresFlarexPersistence } from "../../persistence-postgres/src/postgres";

function documentId(document: Json) {
  if (!isJsonObject(document) || typeof document.id !== "string") throw new Error("Expected native Payload document");
  return document.id;
}

function collector(traceId: string) {
  const spans: Tracer.NativeSpan[] = [];
  const tracer = Tracer.make({ span: options => {
    const span = new Tracer.NativeSpan(options);
    spans.push(span);
    return span;
  } });
  const policy: ExecutionDiagnosticPolicy = {
    observe: (name, work) => Effect.useSpan(name, {}, span => Effect.provideService(work, Tracer.ParentSpan, span)),
  };
  const diagnosticLayer = Layer.merge(Layer.succeed(Tracer.Tracer, tracer), Layer.succeed(ExecutionDiagnostics, policy));
  const parent = Tracer.externalSpan({ traceId, spanId: "1111111111111111" });
  const trace = <Value, Failure>(work: Effect.Effect<Value, Failure>) => work.pipe(
    Effect.provide(diagnosticLayer), Effect.provideService(Tracer.ParentSpan, parent));
  return { spans, parent, trace };
}

async function nativeTracingScenario(persistence: PGliteFlarexPersistence | PostgresFlarexPersistence, session: RelationalSession, overlappingReads: boolean) {
  const compiled = await runEffect(compilePayloadCollections([payloadPostsCollectionDefinition()]));
  const { fixture } = await cmsHostFixture(persistence, { cmsFields: payloadScalarFields }, compiled);
  const arrived = barrier<void>();
  const cancelArrived = barrier<void>();
  const cancelRelease = barrier<void>();
  const cancelledCallbackRelease = barrier<void>();
  const cancellation = new AbortController();
  const lateRelease = barrier<void>();
  let concurrentReads = false;
  let readArrivals = 0;
  let nestedReads = 0;
  let executions = 0;
  const touched = new Set<string>();
  let lateCall: Promise<unknown> | undefined;
  let cancelledLateCall: Promise<unknown> | undefined;
  await runEffect(Effect.scoped(Effect.gen(function* () {
    const native = yield* makePayloadNative(compiled, {
      onExecute: () => { executions++; }, onCollection: collection => { touched.add(collection); }, hooks: {
        afterChange: [async ({ doc, req }) => {
          if (doc.title === "trace-rollback") await req.payload.db.countVersions({ collection: "posts", req });
          if (doc.title === "trace-cancel") {
            cancelledLateCall = cancelledCallbackRelease.promise.then(() => req.payload.findByID({ collection: "posts", id: doc.id, req, depth: 0, overrideAccess: false }));
            const release = () => { cancelRelease.resolve(); };
            cancellation.signal.addEventListener("abort", release, { once: true });
            try {
              cancelArrived.resolve();
              await withDeadline(cancelRelease.promise);
            } finally { cancellation.signal.removeEventListener("abort", release); }
            return doc;
          }
          if (doc.title === "trace-late") lateCall = lateRelease.promise.then(() => req.payload.findByID({ collection: "posts", id: doc.id, req, depth: 0, overrideAccess: false }));
          const found = await req.payload.findByID({ collection: "posts", id: doc.id, req, depth: 0, overrideAccess: false });
          expect(found.id).toBe(doc.id);
          nestedReads++;
          return doc;
        }],
        afterRead: [async ({ doc, req }) => {
          if (concurrentReads) {
            readArrivals++;
            if (overlappingReads) {
              if (readArrivals === 2) arrived.resolve();
              await withDeadline(arrived.promise);
            }
            await req.payload.count({ collection: "posts", req, overrideAccess: false });
          }
          return doc;
        }],
      },
    });
    const host = yield* bindPayloadDirect(native).bind({
      hostRuntime: preparedHostTestRuntime(persistence.drizzle), database: persistence.drizzle,
      controlDatabase: fixture.control.drizzle, session, deploymentId: fixture.deploymentId,
      scopeId: fixture.authority.scopeId, authority: fixture.authorityPorts,
      pointCommitAuthority: fixture.pointCommitAuthority, application: fixture.relationActivation,
      identityAndAccessPolicy: { profile: "payload.scalar", trace: "native-hook-conformance" },
      materialization: {
        intrinsicCreationTimeIndexes: createIntrinsicCreationTimeIndexDefinitionPortV1(fixture.control.drizzle),
        developerIndexes: createAppDeveloperIndexDefinitionPortV1(fixture.control.drizzle),
        uniqueConstraints: createAppUniqueConstraintDefinitionPortV1(fixture.control.drizzle),
        candidateSchemaWriteGuard: createAppSchemaCandidateWriteGuardPort({ candidateValidation: fixture.candidateValidation, pointCommitAuthority: fixture.pointCommitAuthority }),
      },
    });
    // Registered after the host so failed witnesses release foreign hooks
    // before Scope closes retained hosts and the native Payload instance.
    yield* Effect.addFinalizer(() => Effect.promise(async () => {
      const escaped = Promise.allSettled([lateCall, cancelledLateCall]);
      concurrentReads = false;
      cancellation.abort();
      arrived.resolve();
      cancelRelease.resolve();
      cancelledCallbackRelease.resolve();
      lateRelease.resolve();
      await withDeadline(escaped);
    }));
    const create = (title: string) => host.run(host.newRequestKey(), native.commands.create,
      { collection: "posts", data: { title, publishedAt: "2026-01-01" } });
    const enabled = collector("22222222222222222222222222222222");
    const linked = Tracer.externalSpan({ traceId: "33333333333333333333333333333333", spanId: "3333333333333333" });
    const created = yield* enabled.trace(create("trace-enabled")).pipe(Effect.withTracerTiming(false),
      Effect.annotateSpans({ nativeInvocation: "enabled" }), Effect.linkSpans(linked));
    expect(nestedReads).toBe(1);
    const call = enabled.spans.find(span => span.name === "PayloadAdapter.call");
    if (call === undefined) throw new Error("Missing native invocation span");
    const dal = enabled.spans.filter(span => ["LogicalDocuments.insert", "LogicalDocuments.find"].includes(span.name));
    expect(dal.map(span => span.name)).toEqual(expect.arrayContaining(["LogicalDocuments.insert", "LogicalDocuments.find"]));
    for (const span of dal) {
      expect(Option.getOrUndefined(span.parent)?.spanId).toBe(call.spanId);
      expect(span.traceId).toBe(enabled.parent.traceId);
      expect(span.attributes.get("nativeInvocation")).toBe("enabled");
      expect(span.links.some(link => link.span === linked)).toBe(true);
      expect(span.startTime).toBe(0n);
      expect(span.status).toMatchObject({ _tag: "Ended", endTime: 0n });
    }
    const disabled = collector("44444444444444444444444444444444");
    yield* disabled.trace(host.read(native.commands.count, { collection: "posts" })).pipe(Effect.withTracerEnabled(false));
    expect(disabled.spans).toEqual([]);

    const first = collector("55555555555555555555555555555555");
    const second = collector("66666666666666666666666666666666");
    concurrentReads = true;
    try {
      // The PGlite fixture owns one serialized transaction lease. PostgreSQL
      // has distinct pooled connections and proves overlapping native contexts.
      yield* Effect.all([first.trace(host.read(native.commands.findByID, { collection: "posts", id: documentId(created) })),
        second.trace(host.read(native.commands.findByID, { collection: "posts", id: documentId(created) }))],
      { concurrency: overlappingReads ? "unbounded" : 1 });
    } finally { concurrentReads = false; }
    expect(readArrivals).toBe(2);
    for (const invocation of [first, second]) {
      const invocationCall = invocation.spans.find(span => span.name === "PayloadAdapter.call");
      if (invocationCall === undefined) throw new Error("Missing concurrent native span");
      const nativeReads = invocation.spans.filter(span => span.name === "LogicalDocuments.find");
      expect(nativeReads.length).toBeGreaterThanOrEqual(2);
      for (const span of nativeReads) {
        expect(Option.getOrUndefined(span.parent)?.spanId).toBe(invocationCall.spanId);
        expect(span.traceId).toBe(invocation.parent.traceId);
      }
    }

    const rollback = collector("77777777777777777777777777777777");
    expect(yield* Effect.flip(rollback.trace(create("trace-rollback")))).toMatchObject({ reason: "unsupportedProfile" });
    const rollbackCall = rollback.spans.find(span => span.name === "PayloadAdapter.call");
    const settlements = rollback.spans.filter(span => span.name === "BoundedRequest.adapterSettlement");
    expect(settlements.length).toBeGreaterThan(0);
    expect(settlements.some(span => Option.getOrUndefined(span.parent)?.spanId === rollbackCall?.spanId)).toBe(true);
    expect(yield* host.read(native.commands.count, { collection: "posts", where: { title: { equals: "trace-rollback" } } })).toEqual({ totalDocs: 0 });
    const disabledRollback = collector("88888888888888888888888888888888");
    expect(yield* Effect.flip(disabledRollback.trace(create("trace-rollback")).pipe(Effect.withTracerEnabled(false))))
      .toMatchObject({ reason: "unsupportedProfile" });
    expect(disabledRollback.spans).toEqual([]);

    yield* create("trace-late");
    lateRelease.resolve();
    if (lateCall === undefined) throw new Error("Missing escaped native callback");
    yield* Effect.promise(() => expect(lateCall).rejects.toBeInstanceOf(UnsupportedPayloadCapability));
    const pending = Effect.runFork(create("trace-cancel"), { signal: cancellation.signal });
    try {
      yield* Effect.promise(() => withDeadline(cancelArrived.promise));
      cancellation.abort();
      const interrupted = yield* Fiber.await(pending).pipe(Effect.timeout(5_000));
      if (!Exit.isFailure(interrupted)) throw new Error("Expected cancelled native invocation");
      expect(interrupted.cause.reasons.some(Cause.isInterruptReason)).toBe(true);
    } finally {
      cancellation.abort();
      cancelRelease.resolve();
      yield* Fiber.await(pending).pipe(Effect.timeout(5_000));
    }
    cancelledCallbackRelease.resolve();
    if (cancelledLateCall === undefined) throw new Error("Missing cancelled native callback");
    yield* Effect.promise(() => expect(cancelledLateCall).rejects.toBeInstanceOf(UnsupportedPayloadCapability));
    expect(yield* host.read(native.commands.count, { collection: "posts", where: { title: { equals: "trace-cancel" } } })).toEqual({ totalDocs: 0 });
    yield* host.close;
    expect(yield* Effect.flip(host.read(native.commands.count, { collection: "posts" }))).toMatchObject({ reason: "closed" });
    expect(executions).toBeGreaterThan(5);
    expect([...touched]).toEqual(["posts"]);
  })));
}

it("inherits caller tracing across real Payload Local API hooks and DAL (PGlite)", async () => {
  const fixture = await createRelationalPGliteFixture();
  await nativeTracingScenario(fixture.persistence, fixture.session, false);
}, 180_000);

describe.skipIf(postgresUrl === null)("Payload native tracing (ordinary-role PostgreSQL)", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it("preserves tracing, rollback and native invocation lifetimes", () => withPersistence(persistence =>
    nativeTracingScenario(persistence, makePostgresRelationalSession(persistence), true)), 180_000);
});
