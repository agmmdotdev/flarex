import { and, eq } from "drizzle-orm";
import { Cause, Effect, Exit, Fiber, Result, Schema, Tracer } from "effect";
import { describe, expect, it, vi } from "vitest";
import * as valueCodec from "flarex-protocol/value";
import { decodePointMutationExactRuntimeResultV1Effect } from "flarex-protocol/point-mutation-exact-runtime";
import {
  createPointCommitPublisherPortV1,
  createPointMutationAttemptReplacementPortV1,
} from "../../persistence-postgres/src/commit/point/construction";
import {
  PointCommitConflictV1Error,
  PointMutationAttemptReplacementFiniteEntryError,
} from "../../persistence-postgres/src/commit/point/errors";
import {
  type PointFiniteCommitCommand,
} from "../../persistence-postgres/src/commit/point/contracts";
import { fxControlScopes, fxControlSchemaVersions, fxSystemCommits, fxSystemIdempotency, fxSystemCommitWakes,
  fxSystemTransactionSessions, fxSystemSnapshotLeases } from "../../persistence-postgres/src/database/schema";
import {
  fxSystemCommitEvents,
  fxSystemCommitEventDeliveries,
} from "../../persistence-postgres/src/commit/events/schema";
import {
  advanceScopeAuthorizationRevocationEpochInTransactionEffect,
} from "../../persistence-postgres/src/scope/scopeClock";
import {
  createPGliteLocatedRetainedHistoryFloorTarget,
} from "../../persistence-postgres/src/database/pglite";
import {
  createPostgresLocatedRetainedHistoryFloorTarget,
} from "../../persistence-postgres/src/database/postgres";
import { createRetainedHistoryFloorObservationPort, createRetainedHistoryFloorPinFacet,
  observeRetainedHistoryFloorCandidateEffect } from "../../persistence-postgres/src/storage/history/retainedHistoryFloorObservation";
import {
  createPointMutationSessionAttemptTerminalizationPersistenceV1,
} from "../../persistence-postgres/src/execution/transactionSessionActivation";
import {
  TEST_GRANT_RETENTION_POLICY_V1,
} from "../../persistence-postgres/test/execution/transactionSessionActivationTestSupport";
import {
  readFrozenFiniteAttempt,
} from "../../persistence-postgres/src/testing/sessionJournalInspection";
import {
  borrowFrozenFiniteCommitValues,
  readFrozenFiniteCommitValues,
  readFrozenFiniteAttemptOrigin,
  readOwnedFrozenFiniteAttempt,
} from "../../persistence-postgres/src/execution/journal/frozenAttempt";
import { appRowIdHexV1ToBytes } from "flarex-protocol/app-document-id";
import {
  CanonicalFlarexValueBytesV1Schema,
  FlarexValueSha256V1Schema,
  canonicalizeFlarexValueV1Effect,
} from "flarex-protocol/value";
import {
  inspectLogicalParticipantAdmissionBundle,
  inspectFiniteOperationCommitAuthority,
} from "../../persistence-postgres/src/storage/documents/logicalDocuments/participantAdmission";
import { finiteMetadataTableKey } from "../../persistence-postgres/src/execution/finiteMetadataDependencies";
import { decodeReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import { fxAppRowRevisions, fxAppRowCurrent, fxAppIndexEntryRevisions, fxAppUniqueKeys,
  fxSystemScopeClocks, fxSystemMetadataContractObservations } from "../../persistence-postgres/src/database/schema";
import { createMixedMutationProductFixture } from "./support/mixedMutationWorkerdFixture";
import {
  installOneCommitResponseFault,
  installOneFiniteFenceCommitResponseFault,
} from "./support/postgresCommitResponseFault";

type Fixture = Awaited<ReturnType<typeof createMixedMutationProductFixture>>;
const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined
  ? ["pglite" as const] : ["pglite" as const, "postgres" as const];

async function execute(fixture: Fixture, source?: string) {
  const raw = await fixture.runExecution(source);
  const success = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
    result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }))(raw);
  return (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(success.result.result))).value;
}

function capturePublisher(fixture: Fixture, options = fixture.publisherOptions) {
  const publisher = createPointCommitPublisherPortV1(fixture.pointCommitPorts, options);
  let captured: PointFiniteCommitCommand | undefined;
  return {
    publisher: { ...publisher, publishFinite: (command: PointFiniteCommitCommand) => {
      captured = command;
      return publisher.publishFinite(command);
    } },
    actual: publisher,
    command: () => {
      if (captured === undefined) throw new Error("Expected the actual authenticated finite publication command");
      return captured;
    },
  };
}

async function session(fixture: Fixture) {
  const [row] = await fixture.currency.persistence.drizzle.select().from(fxSystemTransactionSessions)
    .where(eq(fxSystemTransactionSessions.sessionId, fixture.activation.anchor.sessionId));
  if (row === undefined) throw new Error("Missing genuine finite anchor");
  return row;
}

async function conflict(fixture: Fixture, captured: ReturnType<typeof capturePublisher>) {
  const value = await execute(fixture);
  await fixture.runStandaloneProductUpdate({ title: `${fixture.seed.newTitle} concurrent`,
    handle: `${fixture.seed.newHandle}-concurrent` });
  const verdict = await Effect.runPromise((await fixture.preparePublication(value, captured.publisher)).pipe(Effect.result));
  expect(verdict).toMatchObject({ _tag: "Failure", failure: { _tag: "PointCommitConflictV1Error" } });
  if (Result.isSuccess(verdict) || !(verdict.failure instanceof PointCommitConflictV1Error))
    throw new Error("Expected the real historical graph conflict");
  return verdict.failure;
}

function replacement(fixture: Fixture) {
  const prepare = fixture.journal.prepareFiniteEntry;
  if (prepare === undefined) throw new Error("Missing genuine finite entry preparation owner");
  return createPointMutationAttemptReplacementPortV1(fixture.pointCommitPorts, {
    ...(fixture.publisherOptions?.logicalOperationProfiles === undefined ? {} : {
      logicalOperationProfiles: fixture.publisherOptions.logicalOperationProfiles,
    }),
    leaseDurationMilliseconds: 120_000, executionClaimDurationMilliseconds: 60_000,
    finiteEntry: { application: fixture.preparedFiniteApplication,
      prepareEntry: () => prepare.call(fixture.journal).pipe(Effect.mapError(cause =>
        new PointMutationAttemptReplacementFiniteEntryError({ cause }))) },
  });
}

describe.each(drivers)("compact finite settlement on %s", driver => {
  it("retains the closed root's complete canonical documents through finite preparation", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `finite-retained-values-${driver}` });
    try {
      const value = await execute(fixture);
      const frozen = await Effect.runPromise(fixture.freeze(value));
      const projected = readFrozenFiniteAttempt(frozen);
      if (projected === undefined) throw new Error("Missing genuine frozen projection");
      const borrowed = borrowFrozenFiniteCommitValues(frozen);
      if (borrowed === undefined) throw new Error("Missing genuine closed-root validator projection");
      expect(Object.keys(borrowed).sort()).toEqual(["rowIntents", "successfulResult"]);
      expect(Object.isFrozen(borrowed)).toBe(true);
      expect(Object.isFrozen(borrowed.rowIntents)).toBe(true);
      expect(Reflect.set(borrowed.rowIntents, "0", undefined)).toBe(false);
      expect(borrowed.rowIntents).toHaveLength(projected.rowIntents.length);
      expect(Object.keys(borrowed.successfulResult)).toEqual(["valueJson"]);
      expect(Object.isFrozen(borrowed.successfulResult)).toBe(true);
      if (typeof borrowed.successfulResult.valueJson === "object" && borrowed.successfulResult.valueJson !== null) {
        expect(Object.isFrozen(borrowed.successfulResult.valueJson)).toBe(true);
        expect(Reflect.set(borrowed.successfulResult.valueJson, "borrowedMutation", true)).toBe(false);
      }
      for (const row of borrowed.rowIntents) {
        expect(Object.isFrozen(row)).toBe(true);
        expect("canonicalBytes" in row).toBe(false);
        expect("dependency" in row).toBe(false);
        if (row.kind === "live") {
          expect(Object.isFrozen(row.valueJson)).toBe(true);
          if (typeof row.valueJson !== "object" || row.valueJson === null)
            throw new Error("Expected a canonical live document object in the validator projection");
          expect(Reflect.set(row.valueJson, "borrowedMutation", true)).toBe(false);
        }
      }
      expect(borrowFrozenFiniteCommitValues({ ...frozen })).toBeUndefined();
      expect(readFrozenFiniteAttempt(frozen)).toEqual(projected);
      const ids = new Set<string>(projected.rowIntents.map(row => row.documentId));
      const canonicalize = vi.spyOn(valueCodec, "canonicalizeFlarexValueV1");
      try {
        expect(await Effect.runPromise(await fixture.prepareFrozenPublication(frozen))).toMatchObject({ kind: "published" });
        const repeated = canonicalize.mock.calls.filter(([document, context]) => context === "appDocument" &&
          typeof document === "object" && document !== null && "_id" in document && typeof document._id === "string" && ids.has(document._id));
        expect(repeated).toEqual([]);
      } finally { canonicalize.mockRestore(); }
      expect(await fixture.readCurrentProduct()).toMatchObject({ title: fixture.seed.newTitle });
      expect(readFrozenFiniteAttempt(frozen)?.rowIntents).toEqual(projected.rowIntents);
    } finally { await fixture.close(); }
  }, 180_000);

  it("replays a known outcome before checking an unissued planning capability", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `finite-prepared-planning-${driver}` });
    try {
      const guard = fixture.publisherOptions?.candidateSchemaWriteGuard;
      if (guard === undefined) throw new Error("Missing genuine Application candidate guard");
      const accepted = capturePublisher(fixture);
      const value = await execute(fixture);
      // The accepting Promise bridge owns its Effect runtime. An outer tracer
      // cannot establish its nested lock or final-guard spans; the connected
      // rollback witness and server SQL lane verify those accepting owners.
      const published = await Effect.runPromise(await fixture.preparePublication(value, accepted.publisher));
      expect(published).toMatchObject({ kind: "published" });
      const command = accepted.command();
      const originalFrozen = readFrozenFiniteAttempt(command.frozenAttempt);
      const commitValues = readFrozenFiniteCommitValues(command.frozenAttempt);
      if (originalFrozen === undefined || commitValues === undefined) throw new Error("Missing genuine frozen value reader");
      if (published.kind !== "published") throw new Error("Expected fresh publication before escaped-result mutation");
      published.successfulResult.canonicalBytes.fill(0);
      if (typeof published.successfulResult.valueJson === "object" && published.successfulResult.valueJson !== null)
        Reflect.set(published.successfulResult.valueJson, "escaped", true);
      expect(readFrozenFiniteCommitValues(command.frozenAttempt)?.successfulResult).toEqual(originalFrozen.successfulResult);
      expect(commitValues).toEqual({ rowIntents: originalFrozen.rowIntents, successfulResult: originalFrozen.successfulResult });
      expect(readFrozenFiniteAttemptOrigin(command.frozenAttempt)?.originalEntry).toBe(originalFrozen.originalEntry);
      commitValues.successfulResult.canonicalBytes.fill(0);
      for (const row of commitValues.rowIntents) if (row.kind === "live") row.canonicalBytes.fill(0);
      const afterValueMutation = readFrozenFiniteAttempt(command.frozenAttempt);
      expect(afterValueMutation?.rowIntents).toEqual(originalFrozen.rowIntents);
      expect(afterValueMutation?.successfulResult).toEqual(originalFrozen.successfulResult);
      expect(afterValueMutation?.originalEntry).toBe(originalFrozen.originalEntry);
      expect(readFrozenFiniteCommitValues({ ...command.frozenAttempt })).toBeUndefined();
      // Every inspection projection detaches from the exact closed-root issuer.
      // It cannot be reissued as trusted canonical evidence.
      const issuanceInput = readFrozenFiniteAttempt(command.frozenAttempt);
      if (issuanceInput === undefined) throw new Error("Missing authentic issuance projection");
      issuanceInput.successfulResult.canonicalBytes.fill(0);
      Reflect.set(issuanceInput.attemptState.selector, "attemptFence", 999n);
      for (const row of issuanceInput.rowIntents) if (row.kind === "live") row.canonicalBytes.fill(0);
      for (const change of issuanceInput.graph.changes) if (change.kind === "live") {
        change.document.canonicalBytes.fill(0);
        const document = change.document.valueJson;
        if (typeof document !== "object" || document === null || Array.isArray(document))
          throw new Error("Expected a live Product document object for the issuer-mutation witness");
        Reflect.set(document, "title", "issuer-mutated");
      }
      for (const operation of issuanceInput.operations) if (operation.kind === "participant") {
        Reflect.set(operation.sourceRefs[0] ?? {}, "sourceKey", "issuer-source-mutated");
        if (typeof operation.result === "object" && operation.result !== null) Reflect.set(operation.result, "escaped", true);
        for (const event of operation.eventIntents) if (typeof event.intent === "object" && event.intent !== null)
          Reflect.set(event.intent, "escaped", true);
      }
      const afterIssuanceMutation = readFrozenFiniteAttempt(command.frozenAttempt);
      expect(afterIssuanceMutation?.graph).toEqual(originalFrozen.graph);
      expect(afterIssuanceMutation?.rowIntents).toEqual(originalFrozen.rowIntents);
      expect(afterIssuanceMutation?.successfulResult).toEqual(originalFrozen.successfulResult);
      expect(afterIssuanceMutation?.attemptState).toEqual(originalFrozen.attemptState);
      expect(afterIssuanceMutation?.operations).toEqual(originalFrozen.operations);
      const committed = await fixture.currency.persistence.drizzle.select().from(fxSystemCommits);
      const currentProduct = await fixture.readCurrentProduct();
      expect(currentProduct).toMatchObject({ title: fixture.seed.newTitle });
      const callbacks = [...fixture.nativeInvokeCount.entries()];
      let acceptingTransactions = 0;
      let targetResolutions = 0;
      let controlReads = 0;
      const unissuedPlanning = createPointCommitPublisherPortV1({ ...fixture.pointCommitPorts,
        scopeMetadata: { ...fixture.pointCommitPorts.scopeMetadata, getScopeMetadata: async () => {
          controlReads++; throw new Error("Replay must precede fallible control reads");
        } },
        provisioningReceipts: { getScopeAuthorityProvisioningReceipt: async () => {
          controlReads++; throw new Error("Replay must precede fallible receipt reads");
        } },
        scopeSessionTargets: { resolve: async () => { targetResolutions++; throw new Error("Replay must retain its original target"); } },
      }, { ...fixture.publisherOptions,
        candidateSchemaWriteGuard: { ...guard }, afterTransactionStep: async event => {
          if (event.step === "clockLocked") acceptingTransactions++;
        } });
      expect(await Effect.runPromise(unissuedPlanning.publishFinite(command))).toMatchObject({ kind: "replayed" });
      expect(await Effect.runPromise(unissuedPlanning.resolveFinite(command))).toMatchObject({ kind: "committed" });
      expect(await Effect.runPromise(unissuedPlanning.resolveFinite({ ...command, frozenAttempt: { ...command.frozenAttempt } }).pipe(Effect.result)))
        .toMatchObject({ _tag: "Failure", failure: { _tag: "PointCommitCorruptionV1Error", reason: "commandInvalid" } });
      expect(await Effect.runPromise(accepted.actual.publishFinite({ ...command,
        authorityPins: { ...command.authorityPins, scopeId: decodeReplacementScopeIdV1("scope_00000000-0000-0000-0000-000000000001") },
      }).pipe(Effect.result))).toMatchObject({ _tag: "Failure" });
      expect(targetResolutions).toBe(0);
      expect(controlReads).toBe(0);
      expect(acceptingTransactions).toBe(0);
      expect(await fixture.currency.persistence.drizzle.select().from(fxSystemCommits)).toEqual(committed);
      expect(await fixture.readCurrentProduct()).toEqual(currentProduct);
      expect([...fixture.nativeInvokeCount.entries()]).toEqual(callbacks);
    } finally { await fixture.close(); }
  }, 180_000);

  it.skipIf(driver !== "postgres")("rolls back installed publication when its final protected artifact guard changes", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `finite-final-artifact-guard-${driver}` });
    try {
      const value = await execute(fixture);
      const productBefore = await fixture.readCurrentProduct();
      const commitsBefore = await fixture.currency.persistence.drizzle.select().from(fxSystemCommits);
      const outcomesBefore = await fixture.currency.persistence.drizzle.select().from(fxSystemIdempotency);
      const eventsBefore = await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      const deliveriesBefore = await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEventDeliveries);
      const wakesBefore = await fixture.currency.persistence.drizzle.select().from(fxSystemCommitWakes);
      let changedArtifact = false;
      const actual = createPointCommitPublisherPortV1(fixture.pointCommitPorts, { ...fixture.publisherOptions,
        afterTransactionStep: async event => {
          if (event.step !== "beforeCommit") return;
          const identity = eq(fxControlSchemaVersions.schemaVersionId, fixture.currency.application.active.basis.schemaVersionId);
          const [artifact] = await fixture.currency.control.drizzle.select().from(fxControlSchemaVersions).where(identity);
          if (artifact === undefined) throw new Error("Missing actual protected Application artifact");
          await fixture.currency.control.drizzle.update(fxControlSchemaVersions)
            .set({ createdAt: new Date(artifact.createdAt.getTime() + 1_000) }).where(identity);
          changedArtifact = true;
        },
      });
      let publicationRollbackObserved = false;
      const publisher = { ...actual, publishFinite: (command: PointFiniteCommitCommand) => Effect.promise(() => session(fixture)).pipe(
        Effect.flatMap(sessionAtPublication => actual.publishFinite(command).pipe(Effect.tapError(() => Effect.promise(async () => {
          // Observe the actual publication rollback before the outer finite
          // settlement owner records its permanent terminal refusal.
          expect(await session(fixture)).toEqual(sessionAtPublication);
          expect(await fixture.currency.persistence.drizzle.select().from(fxSystemIdempotency)).toEqual(outcomesBefore);
          expect(await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(eventsBefore);
          expect(await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEventDeliveries)).toEqual(deliveriesBefore);
          expect(await fixture.currency.persistence.drizzle.select().from(fxSystemCommitWakes)).toEqual(wakesBefore);
          publicationRollbackObserved = true;
        }))))) };
      expect(await Effect.runPromise((await fixture.preparePublication(value, publisher)).pipe(Effect.result)))
        .toMatchObject({ _tag: "Failure", failure: { _tag: "PointCommitStaleAuthorityV1Error", reason: "activeSchemaChanged" } });
      expect(changedArtifact).toBe(true);
      expect(publicationRollbackObserved).toBe(true);
      expect(await fixture.currency.persistence.drizzle.select().from(fxSystemCommits)).toEqual(commitsBefore);
      expect(await fixture.readCurrentProduct()).toEqual(productBefore);
    } finally { await fixture.close(); }
  }, 180_000);

  it("refuses moved placement through its original full-proof or installed target without rerouting", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `finite-original-target-${driver}` });
    try {
      const value = await execute(fixture);
      const original = createPointCommitPublisherPortV1(fixture.pointCommitPorts, fixture.publisherOptions);
      let targetResolutions = 0;
      let acceptingTransactions = 0;
      let observedRefusal = false;
      const ports = driver === "postgres" ? fixture.pointCommitPorts : { ...fixture.pointCommitPorts,
        scopeSessionTargets: { resolve: async () => { targetResolutions++; throw new Error("Publication must never resolve the moved target"); } },
      };
      const spans: string[] = [];
      const tracer = Tracer.make({ span(options) {
        spans.push(options.name);
        return new Tracer.NativeSpan(options);
      } });
      const confined = createPointCommitPublisherPortV1(ports, { ...fixture.publisherOptions, afterTransactionStep: async event => {
        if (event.step === "clockLocked") acceptingTransactions++;
      } });
      const publisher = { ...original, publishFinite: (command: PointFiniteCommitCommand) => Effect.gen(function* () {
        const frozen = readFrozenFiniteAttempt(command.frozenAttempt);
        if (frozen === undefined) throw new Error("Missing genuine frozen publication target");
        const locator = frozen.resolvedTarget.authority.physicalLocator;
        const committed = yield* Effect.promise(() => fixture.currency.persistence.drizzle.select().from(fxSystemCommits));
        const before = yield* Effect.promise(() => session(fixture));
        const updateLocator = async (physicalLocator: typeof locator): Promise<void> => {
          await fixture.currency.control.drizzle.update(fxControlScopes)
            .set({ physicalLocator }).where(eq(fxControlScopes.scopeId, fixture.currency.application.authority.scopeId));
        };
        yield* Effect.promise(() => updateLocator({ ...locator, databaseKey: `${locator.databaseKey}-moved` }));
        const verdict = yield* confined.publishFinite(command).pipe(Effect.provideService(Tracer.Tracer, tracer), Effect.result,
          Effect.ensuring(Effect.promise(() => updateLocator(locator))));
        expect(verdict).toMatchObject({ _tag: "Failure", failure: { _tag: "PointCommitStaleAuthorityV1Error",
          reason: driver === "postgres" ? "scopeChanged" : "placementChanged" } });
        expect(targetResolutions).toBe(0);
        expect(spans).not.toContain("ScopeAuthority.resolveAtTarget");
        expect(acceptingTransactions).toBe(0);
        expect(yield* Effect.promise(() => fixture.currency.persistence.drizzle.select().from(fxSystemCommits))).toEqual(committed);
        expect(yield* Effect.promise(() => session(fixture))).toEqual(before);
        observedRefusal = true;
        return yield* Effect.fromResult(verdict);
      }) };
      expect(await Effect.runPromise((await fixture.preparePublication(value, publisher)).pipe(Effect.result)))
        .toMatchObject({ _tag: "Failure" });
      expect(observedRefusal).toBe(true);
    } finally { await fixture.close(); }
  }, 180_000);

  it("validates each final native row once across repeated genuine source receipts", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `finite-validation-owner-${driver}`,
      payloadProfile: "ordinary" });
    try {
      const payload = fixture.publisherOptions?.logicalOperationProfiles?.find(profile => profile.participant.startsWith("payload.posts."));
      if (payload === undefined) throw new Error("Missing actual selected Payload profile");
      const source = `export default { users: { create: { isMutation: true, isPublic: true, _handler: async ctx => {
        const id = await ctx.db.insert("users", { name: "before" });
        await ctx.privateMixed.call("medusa.product", "retrieve", ${JSON.stringify(fixture.seed.retrieveInput)});
        const updated = await ctx.privateMixed.call("medusa.product", "update", ${JSON.stringify(fixture.seed.updateInput)});
        const pending = await ctx.privateMixed.call("medusa.product", "retrieve", ${JSON.stringify(fixture.seed.retrieveInput)});
        const listed = await ctx.privateMixed.call("medusa.product", "listByHandle", ${JSON.stringify(fixture.seed.listInput)});
        const posts = [];
        for (let ordinal = 0; ordinal < 2; ordinal++) {
          const created = await ctx.privateMixed.call(${JSON.stringify(payload.participant)}, "payload-create",
            { collection: "posts", data: { title: pending.title + ordinal, publishedAt: "2026-01-01" } });
          await ctx.privateMixed.call(${JSON.stringify(payload.participant)}, "payload-findByID", { collection: "posts", id: created.id });
          await ctx.privateMixed.call(${JSON.stringify(payload.participant)}, "payload-update", { collection: "posts", id: created.id, data: { enabled: true } });
          posts.push(await ctx.privateMixed.call(${JSON.stringify(payload.participant)}, "payload-findByID", { collection: "posts", id: created.id }));
        }
        await ctx.db.patch(id, { name: pending.title });
        return { id, updated, pending, listed, posts };
      } } } };`;
      const value = await execute(fixture, source);
      expect(value).toMatchObject({ posts: [{ enabled: true }, { enabled: true }] });
      let validatedRows = 0;
      const predecessorQueries: string[] = [];
      const observedSteps: string[] = [];
      const observed = capturePublisher(fixture, { ...fixture.publisherOptions, observeQuery: query => {
        predecessorQueries.push(query.name);
      }, afterTransactionStep: async event => {
        observedSteps.push(event.step);
        if (event.step === "finiteParticipantDocumentValidated") validatedRows++;
      } });
      // The business graph has one Product row and two independently created
      // posts, despite twelve method receipts including eight Payload calls
      // and a read-only first Product receipt before its later write.
      expect(await Effect.runPromise((await fixture.preparePublication(value, observed.publisher)))).toMatchObject({ kind: "published" });
      const graph = readFrozenFiniteAttempt(observed.command().frozenAttempt);
      if (graph === undefined) throw new Error("Missing authentic frozen graph");
      expect(graph.operations.filter(operation => operation.kind === "participant")).toHaveLength(12);
      expect(graph.rowIntents.filter(intent => intent.kind === "live")).toHaveLength(4);
      expect(graph.originalRows).toHaveLength(1);
      const original = graph.originalRows[0];
      if (original === undefined) throw new Error("Missing authentic original Product revision");
      const originalBytes = original.document.canonicalBytes.slice();
      original.document.canonicalBytes.fill(0);
      original.document.sha256.fill(0);
      expect(readFrozenFiniteAttempt(observed.command().frozenAttempt)?.originalRows[0]?.document.canonicalBytes).toEqual(originalBytes);
      expect(predecessorQueries.filter(name => name === "loadRowHeads")).toHaveLength(1);
      expect(predecessorQueries).not.toContain("loadPriorDocuments");
      expect(observedSteps).toEqual(expect.arrayContaining(["clockLocked", "sessionLocked", "beforeCommit"]));
      expect(validatedRows).toBe(3);
      expect(await fixture.readCurrentProduct()).toMatchObject({ title: fixture.seed.newTitle });
    } finally { await fixture.close(); }
  }, 180_000);

  it.each(["currentClosure", "laterClosure", "validClosures"] as const)(
    "retains the original source document refusal at its acceptance boundary with %s", async damage => {
      const fixture = await createMixedMutationProductFixture({ driver,
        suffix: `finite-source-order-${damage.toLowerCase()}-${driver}`, payloadProfile: "ordinary" });
      try {
        const value = await execute(fixture);
        const steps: string[] = [];
        const submittedQueries: string[] = [];
        const actual = createPointCommitPublisherPortV1(fixture.pointCommitPorts, { ...fixture.publisherOptions,
          observeQuery: query => { submittedQueries.push(query.name); },
          afterTransactionStep: async event => { steps.push(event.step); } });
        let inspected = false;
        const publisher = { ...actual, publishFinite: (command: PointFiniteCommitCommand) => Effect.gen(function* () {
          const frozen = readFrozenFiniteAttempt(command.frozenAttempt);
          if (frozen === undefined) throw new Error("Missing genuine frozen publication input");
          const selectedSources = frozen.operations.flatMap(operation => {
            if (operation.kind !== "participant") return [];
            const bundle = inspectLogicalParticipantAdmissionBundle(operation.admission, frozen.attempt,
              operation.participant, operation.method, operation.profileRevision);
            const profile = fixture.publisherOptions?.logicalOperationProfiles?.find(member =>
              member.participant === operation.participant && member.profileRevision === operation.profileRevision);
            if (bundle === null || profile === undefined) throw new Error("Missing original source admission");
            return bundle.admissions.map((admission, ordinal) => {
              const token = profile.sources[ordinal], methods = bundle.sourceMethods[ordinal];
              if (token === undefined || methods === undefined) throw new Error("Missing original source authority");
              const selected = inspectFiniteOperationCommitAuthority(token, admission, frozen.attempt, operation.participant, methods);
              if (selected === null) throw new Error("Original source authority did not authenticate");
              return selected;
            });
          });
          const productSource = selectedSources.find(source => source.sourceKey === "medusa.product");
          const laterSource = selectedSources.find(source => source.sourceKey !== "medusa.product");
          if (productSource === undefined || laterSource === undefined) throw new Error("Missing real ordered Product and Payload sources");
          const original = frozen.rowIntents.find(row => row.kind === "live" && productSource.tableIds.has(row.tableId));
          if (original?.kind !== "live" || typeof original.value !== "object" || original.value === null || Array.isArray(original.value))
            throw new Error("Missing genuine final Product document");
          const invalid = yield* canonicalizeFlarexValueV1Effect({ ...original.value, title: 123 }, "appDocument").pipe(Effect.orDie);
          expect(Result.isFailure(productSource.validateDocument(original.tableId, invalid))).toBe(true);
          // Test-only fault in the private retained value; public projections
          // cannot mint a replacement frozen issuer. Native settlement must
          // still validate its schema independently of working-set close.
          const owned = readOwnedFrozenFiniteAttempt(command.frozenAttempt)?.rowIntents.find(row => row.documentId === original.documentId);
          if (owned?.kind !== "live") throw new Error("Missing owned native value for fault injection");
          Object.assign(owned.document, invalid);
          const db = fixture.currency.persistence.drizzle;
          if (damage !== "validClosures") {
            const source = damage === "currentClosure" ? productSource : laterSource;
            const row = frozen.rowIntents.find(intent => source.tableIds.has(intent.tableId));
            if (row === undefined) throw new Error("Missing actual touched source table");
            const key = finiteMetadataTableKey(source.metadataProjection, row.tableId, "writeClosure");
            if (key === null) throw new Error("Missing canonical source closure identity");
            const identity = and(eq(fxSystemMetadataContractObservations.scopeId, command.authorityPins.scopeId),
              eq(fxSystemMetadataContractObservations.namespace, key.namespace),
              eq(fxSystemMetadataContractObservations.ownerKey, key.ownerKey),
              eq(fxSystemMetadataContractObservations.contractKey, key.contractKey));
            const [stored] = yield* Effect.promise(() => db.select().from(fxSystemMetadataContractObservations).where(identity));
            if (stored === undefined || stored.semanticBytes === null) throw new Error("Missing real current source closure");
            const changed = stored.semanticBytes.slice();
            changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 1;
            yield* Effect.promise(async () => await db.update(fxSystemMetadataContractObservations).set({ semanticBytes: changed }).where(identity));
          }
          const durable = async () => ({ rows: await db.select().from(fxAppRowRevisions),
            current: await db.select().from(fxAppRowCurrent), indexes: await db.select().from(fxAppIndexEntryRevisions),
            unique: await db.select().from(fxAppUniqueKeys), clocks: await db.select().from(fxSystemScopeClocks),
            commits: await db.select().from(fxSystemCommits), outcomes: await db.select().from(fxSystemIdempotency),
            events: await db.select().from(fxSystemCommitEvents) });
          const before = yield* Effect.promise(durable);
          const callbacks = [...fixture.nativeInvokeCount.entries()];
          const verdict = yield* actual.publishFinite(command).pipe(Effect.result);
          expect(verdict).toMatchObject({ _tag: "Failure", failure: damage === "currentClosure"
            ? { _tag: "PointCommitStaleAuthorityV1Error", reason: "activeSchemaChanged" }
            : { _tag: "PointCommitCorruptionV1Error", reason: "rowWriteInvalid" } });
          expect(yield* Effect.promise(durable)).toEqual(before);
          expect([...fixture.nativeInvokeCount.entries()]).toEqual(callbacks);
          expect(steps).toContain("sessionLocked");
          expect(steps).not.toContain("finiteParticipantDocumentValidated");
          expect(submittedQueries).not.toContain("applyPublication");
          inspected = true;
          return yield* Effect.fromResult(verdict);
        }) };
        expect(await Effect.runPromise((await fixture.preparePublication(value, publisher)).pipe(Effect.result)))
          .toMatchObject({ _tag: "Failure" });
        expect(inspected).toBe(true);
      } finally { await fixture.close(); }
    }, 180_000);

  it.each(["storedSha", "body", "oversize"] as const)(
    "refuses a changed original predecessor %s before a retained key failure and leaves no publication", async damage => {
      const fixture = await createMixedMutationProductFixture({ driver, suffix: `finite-prior-${damage.toLowerCase()}-${driver}` });
      try {
        const value = await execute(fixture);
        const actual = fixture.makePublisher();
        let checkedOriginal = false;
        const publisher = { ...actual, publishFinite: (command: PointFiniteCommitCommand) => Effect.gen(function* () {
          const frozen = readFrozenFiniteAttempt(command.frozenAttempt);
          const original = frozen?.originalRows[0];
          if (frozen === undefined || original === undefined) throw new Error("Missing genuine original predecessor");
          const intent = frozen.rowIntents.find(row => row.kind === "live" && row.tableId === original.tableId && row.rowId === original.rowId);
          if (intent?.kind !== "live" || typeof intent.value !== "object" || intent.value === null || Array.isArray(intent.value))
            throw new Error("Missing genuine final native row");
          const oversizedKeyDocument = yield* canonicalizeFlarexValueV1Effect({ ...intent.value,
            handle: "h".repeat(3000) }, "appDocument").pipe(Effect.orDie);
          const owned = readOwnedFrozenFiniteAttempt(command.frozenAttempt)?.rowIntents.find(row => row.documentId === intent.documentId);
          if (owned?.kind !== "live") throw new Error("Missing owned native key value for fault injection");
          Object.assign(owned.document, oversizedKeyDocument);
          const keyFailureCommand = command;
          const db = fixture.currency.persistence.drizzle;
          const identity = and(eq(fxAppRowRevisions.scopeUuid, original.scopeUuid), eq(fxAppRowRevisions.tableId, original.tableId),
            eq(fxAppRowRevisions.rowId, appRowIdHexV1ToBytes(original.rowId)), eq(fxAppRowRevisions.commitSeq, original.commitSeq));
          if (damage === "storedSha") yield* Effect.promise(async () => await db.update(fxAppRowRevisions)
            .set({ valueSha256: FlarexValueSha256V1Schema.make(new Uint8Array(32)) }).where(identity));
          else {
            const bytes = damage === "oversize" ? new Uint8Array(original.document.canonicalBytes.byteLength + 1)
              : original.document.canonicalBytes.slice();
            if (damage === "oversize") bytes.set(original.document.canonicalBytes);
            else bytes[0] = (bytes[0] ?? 0) ^ 1;
            yield* Effect.promise(async () => await db.update(fxAppRowRevisions)
              .set({ valueBytes: CanonicalFlarexValueBytesV1Schema.make(bytes) }).where(identity));
          }
          const durable = async () => ({
            rows: await db.select().from(fxAppRowRevisions), current: await db.select().from(fxAppRowCurrent),
            indexes: await db.select().from(fxAppIndexEntryRevisions), unique: await db.select().from(fxAppUniqueKeys),
            clock: await db.select().from(fxSystemScopeClocks), commits: await db.select().from(fxSystemCommits),
            outcomes: await db.select().from(fxSystemIdempotency), events: await db.select().from(fxSystemCommitEvents),
          });
          const before = yield* Effect.promise(durable);
          const verdict = yield* actual.publishFinite(keyFailureCommand).pipe(Effect.result);
          expect(verdict).toMatchObject({ _tag: "Failure", failure: { _tag: "PointCommitCorruptionV1Error", reason: "priorDocumentInvalid" } });
          expect(yield* Effect.promise(durable)).toEqual(before);
          // With that exact predecessor repaired, the same canonical final
          // graph reaches its real key planner and proves the later failure.
          yield* Effect.promise(async () => await db.update(fxAppRowRevisions).set({
            valueBytes: original.document.canonicalBytes, valueSha256: original.document.sha256,
          }).where(identity));
          const repaired = yield* Effect.promise(durable);
          expect(yield* actual.publishFinite(keyFailureCommand).pipe(Effect.result)).toMatchObject({ _tag: "Failure",
            failure: { _tag: "PointCommitDeveloperIndexMaintenanceUnavailableV1Error", reason: "entryKeyLimitExceeded" } });
          expect(yield* Effect.promise(durable)).toEqual(repaired);
          checkedOriginal = true;
          return yield* Effect.fromResult(verdict);
        }) };
        expect(await Effect.runPromise((await fixture.preparePublication(value, publisher)).pipe(Effect.result)))
          .toMatchObject({ _tag: "Failure" });
        expect(checkedOriginal).toBe(true);
      } finally { await fixture.close(); }
    }, 180_000);

  it("preserves genuine OCC refusal before checking a damaged original predecessor", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `finite-prior-occ-${driver}` });
    try {
      const value = await execute(fixture);
      const actual = fixture.makePublisher();
      let checkedConflict = false;
      const publisher = { ...actual, publishFinite: (command: PointFiniteCommitCommand) => Effect.gen(function* () {
        const original = readFrozenFiniteAttempt(command.frozenAttempt)?.originalRows[0];
        if (original === undefined) throw new Error("Missing genuine original predecessor");
        yield* Effect.promise(() => fixture.runStandaloneProductUpdate({ title: `${fixture.seed.newTitle} concurrent`,
          handle: `${fixture.seed.newHandle}-concurrent` }));
        yield* Effect.promise(async () => await fixture.currency.persistence.drizzle.update(fxAppRowRevisions)
          .set({ valueSha256: FlarexValueSha256V1Schema.make(new Uint8Array(32)) }).where(and(
            eq(fxAppRowRevisions.scopeUuid, original.scopeUuid), eq(fxAppRowRevisions.tableId, original.tableId),
            eq(fxAppRowRevisions.rowId, appRowIdHexV1ToBytes(original.rowId)), eq(fxAppRowRevisions.commitSeq, original.commitSeq))));
        const before = yield* Effect.promise(() => fixture.currency.persistence.drizzle.select().from(fxSystemCommits));
        const verdict = yield* actual.publishFinite(command).pipe(Effect.result);
        expect(verdict).toMatchObject({ _tag: "Failure", failure: { _tag: "PointCommitConflictV1Error" } });
        expect(yield* Effect.promise(() => fixture.currency.persistence.drizzle.select().from(fxSystemCommits))).toEqual(before);
        checkedConflict = true;
        return yield* Effect.fromResult(verdict);
      }) };
      expect(await Effect.runPromise((await fixture.preparePublication(value, publisher)).pipe(Effect.result)))
        .toMatchObject({ _tag: "Failure" });
      expect(checkedConflict).toBe(true);
    } finally { await fixture.close(); }
  }, 180_000);

  it("refuses an invalid native document before accepting its close receipt", async () => {
    let attemptedInvalidWrite = false;
    let fixture: Fixture;
    fixture = await createMixedMutationProductFixture({ driver, suffix: `finite-native-validation-refusal-${driver}`,
      hooks: { beforeProductClose: (method, borrowed) => method !== "update" ? Effect.void : Effect.gen(function* () {
        const product = yield* borrowed.context.table("product");
        const refused = yield* Effect.result(product.write(borrowed.context.manager, "update", [
          { id: fixture.seed.productId, title: 123 },
        ]));
        expect(refused).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
        attemptedInvalidWrite = true;
        return yield* Effect.fromResult(refused).pipe(Effect.asVoid);
      }) } });
    try {
      const before = await fixture.readCurrentProduct();
      const commits = await fixture.currency.persistence.drizzle.select().from(fxSystemCommits);
      await expect(fixture.runExecution()).rejects.toBeDefined();
      expect(attemptedInvalidWrite).toBe(true);
      await expect(Effect.runPromise(fixture.freeze(null))).rejects.toBeDefined();
      expect(await fixture.currency.persistence.drizzle.select().from(fxSystemCommits)).toEqual(commits);
      expect(await fixture.readCurrentProduct()).toEqual(before);
    } finally { await fixture.close(); }
  }, 180_000);

  it("enforces bounded canonical anchor storage without changing the admitted row", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `finite-anchor-bounds-${driver}` });
    try {
      const original = await session(fixture);
      for (const bytes of [new Uint8Array(0), new Uint8Array(131_073)]) {
        await expect(fixture.currency.persistence.drizzle.update(fxSystemTransactionSessions)
          .set({ finiteAttemptBytes: bytes }).where(eq(fxSystemTransactionSessions.sessionId, original.sessionId)))
          .rejects.toMatchObject({ cause: { code: "23514",
            message: expect.stringContaining('violates check constraint "fx_system_tx_session_finite_anchor_check"'),
          } });
        expect(await session(fixture)).toEqual(original);
      }
      expect(fixture.nativeInvokeCount.size).toBe(0);
    } finally { await fixture.close(); }
  }, 180_000);

  it("pins the original history floor from the anchor until its real terminalization", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `finite-history-pin-${driver}` });
    try {
      await execute(fixture);
      await fixture.runStandaloneProductUpdate({ title: `${fixture.seed.newTitle} concurrent`,
        handle: `${fixture.seed.newHandle}-concurrent` });
      const resource = fixture.currency.resource;
      const observation = createRetainedHistoryFloorObservationPort({
        authority: { ...fixture.application.authorityPorts, scopeClockTargets: {
          resolve: async locator => resource.kind === "pglite"
            ? createPGliteLocatedRetainedHistoryFloorTarget(resource.target, locator)
            : createPostgresLocatedRetainedHistoryFloorTarget(resource.target, locator),
        } },
        grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
        pinFacets: [createRetainedHistoryFloorPinFacet("test", { kind: "absent" })],
      });
      const original = fixture.activation.anchor.snapshotToken.commitSeq;
      const pinned = await Effect.runPromise(observeRetainedHistoryFloorCandidateEffect(observation, fixture.currency.deploymentId));
      expect(pinned.lastCommitSeq).toBeGreaterThan(original);
      expect(pinned.leaseCeiling).toBe(original);
      expect(await fixture.currency.persistence.drizzle.select().from(fxSystemSnapshotLeases)
        .where(eq(fxSystemSnapshotLeases.sessionId, fixture.activation.anchor.sessionId))).toEqual([]);
      const terminalized = await Effect.runPromise(createPointMutationSessionAttemptTerminalizationPersistenceV1(
        fixture.pointCommitPorts).abortEffect({ selector: fixture.selector,
          expectedSnapshotToken: fixture.activation.anchor.snapshotToken,
          executionClaim: { claimOwner: fixture.activation.executionClaim.claimOwner,
            claimFence: fixture.activation.executionClaim.claimFence } }));
      expect(terminalized).toMatchObject({ status: "terminalized", terminal: { lifecycle: "aborted" } });
      const released = await Effect.runPromise(observeRetainedHistoryFloorCandidateEffect(observation, fixture.currency.deploymentId));
      expect(released.leaseCeiling).toBe(released.lastCommitSeq);
    } finally { await fixture.close(); }
  }, 180_000);

  it("issues proofs from the same committed fence and consumes exactly one replacement", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `finite-fence-race-${driver}` });
    try {
      const captured = capturePublisher(fixture);
      await conflict(fixture, captured);
      const fenced = await session(fixture);
      expect(fenced).toMatchObject({ lifecycle: "retrying", attemptFence: fixture.activation.anchor.attemptFence,
        finiteClaimFence: fixture.activation.executionClaim.claimFence + 1n });
      const resolutions = await Promise.all([captured.actual.resolveFinite(captured.command()),
        captured.actual.resolveFinite(captured.command())].map(effect => Effect.runPromise(effect)));
      const proofs = resolutions.map(resolution => {
        if (resolution.kind !== "noncommit") throw new Error("Expected an issued nonacceptance proof");
        return resolution.proof;
      });
      const replacer = replacement(fixture);
      const calls = Object.fromEntries(fixture.nativeInvokeCount);
      const committedBeforeReplacement = await fixture.currency.persistence.drizzle.select().from(fxSystemCommits);
      const command = captured.command();
      const firstProof = proofs[0];
      if (firstProof === undefined) throw new Error("Missing authentic replacement proof");
      const forged = await Effect.runPromise(replacer.replaceFinite({ ...command,
        frozenAttempt: structuredClone(command.frozenAttempt), proof: firstProof }).pipe(Effect.result));
      expect(forged).toMatchObject({ _tag: "Failure", failure: { _tag: "PointMutationAttemptReplacementCorruptionV1Error", reason: "commandInvalid" } });
      const recoveredWithCertificate = await Effect.runPromise(replacer.replaceRecoveredFinite({
        ...command, proof: firstProof,
        // @ts-expect-error Recovered redispatch explicitly excludes every frozen certificate.
        frozenAttempt: command.frozenAttempt,
      }).pipe(Effect.result));
      expect(recoveredWithCertificate).toMatchObject({ _tag: "Failure", failure: { reason: "replacementMutationInvalid" } });
      expect(await session(fixture)).toEqual(fenced);
      expect(Object.fromEntries(fixture.nativeInvokeCount)).toEqual(calls);
      const results = await Promise.all(proofs.map(proof => Effect.runPromise(
        replacer.replaceFinite({ ...captured.command(), proof }).pipe(Effect.result))));
      expect(results.filter(Result.isSuccess), results.filter(Result.isFailure)
        .map(result => Cause.pretty(Cause.fail(result.failure))).join("\n")).toHaveLength(1);
      expect(results.filter(Result.isFailure)).toHaveLength(1);
      const fresh = await session(fixture);
      expect(fresh.attemptFence).toBe(fenced.attemptFence + 1n);
      expect(fresh.finiteClaimFence).toBe(fenced.finiteClaimFence === null ? null : fenced.finiteClaimFence + 1n);
      expect(fresh.lifecycle).toBe("running");
      expect(Object.fromEntries(fixture.nativeInvokeCount)).toEqual(calls);
      expect(await fixture.currency.persistence.drizzle.select().from(fxSystemCommits)).toEqual(committedBeforeReplacement);
    } finally { await fixture.close(); }
  }, 180_000);

  it("commits a revoked refusal before original predecessor corruption and resolves it without a retry callback", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `finite-revoked-${driver}` });
    try {
      const value = await execute(fixture);
      const captured = capturePublisher(fixture);
      const before = await fixture.currency.persistence.drizzle.select().from(fxSystemCommits);
      await fixture.currency.persistence.drizzle.transaction(tx => Effect.runPromise(
        advanceScopeAuthorizationRevocationEpochInTransactionEffect(tx, fixture.activation.anchor.scopeId)));
      let damagedOriginal = false;
      const publisher = { ...captured.publisher, publishFinite: (command: PointFiniteCommitCommand) => Effect.gen(function* () {
        const original = readFrozenFiniteAttempt(command.frozenAttempt)?.originalRows[0];
        if (original === undefined) throw new Error("Missing genuine revoked attempt predecessor");
        const db = fixture.currency.persistence.drizzle;
        yield* Effect.promise(async () => await db.update(fxAppRowRevisions)
          .set({ valueSha256: FlarexValueSha256V1Schema.make(new Uint8Array(32)) }).where(and(
            eq(fxAppRowRevisions.scopeUuid, original.scopeUuid), eq(fxAppRowRevisions.tableId, original.tableId),
            eq(fxAppRowRevisions.rowId, appRowIdHexV1ToBytes(original.rowId)), eq(fxAppRowRevisions.commitSeq, original.commitSeq))));
        const corrupted = yield* Effect.promise(() => db.select().from(fxAppRowRevisions));
        const result = yield* captured.publisher.publishFinite(command).pipe(Effect.result);
        expect(yield* Effect.promise(() => db.select().from(fxAppRowRevisions))).toEqual(corrupted);
        damagedOriginal = true;
        return yield* Effect.fromResult(result);
      }) };
      const result = await Effect.runPromise((await fixture.preparePublication(value, publisher)).pipe(Effect.result));
      expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "PointCommitStaleAuthorityV1Error" } });
      expect(damagedOriginal).toBe(true);
      const terminal = await session(fixture);
      expect(terminal).toMatchObject({ lifecycle: "aborted", validatedArgsCanonicalBytes: null,
        authorizationGrantCanonicalBytes: null, applicationExecutionAuthorityCanonicalBytes: null });
      expect(terminal.finiteClaimFence).toBe(fixture.activation.executionClaim.claimFence + 1n);
      const repeated = await Effect.runPromise(captured.actual.resolveFinite(captured.command()));
      expect(repeated).toMatchObject({ kind: "rejected", error: { _tag: "PointCommitStaleAuthorityV1Error" } });
      expect(await session(fixture)).toEqual(terminal);
      expect(await fixture.currency.persistence.drizzle.select().from(fxSystemCommits)).toEqual(before);
      expect(fixture.retryContexts).toHaveLength(0);
      expect(fixture.nativeInvokeCount.get("update")).toBe(1);
    } finally { await fixture.close(); }
  }, 180_000);

  it("commits an expired signed grant refusal after frozen work without readmitting callbacks", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `finite-expired-${driver}`,
      hooks: { finiteGrantLifetimeMilliseconds: 30_000 } });
    try {
      const value = await execute(fixture);
      const captured = capturePublisher(fixture);
      const publication = await fixture.preparePublication(value, captured.publisher);
      const original = await session(fixture);
      const commits = await fixture.currency.persistence.drizzle.select().from(fxSystemCommits);
      const expiresAt = Math.min(original.authorizationGrantExpiresAt.getTime(), original.hardExpiresAt.getTime());
      const deadline = Date.now() + 45_000;
      let databaseNow = 0;
      while (databaseNow < expiresAt && Date.now() < deadline) {
        const clock = await fixture.currency.resource.target.query<{ milliseconds: string }>(
          "select floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text as milliseconds");
        databaseNow = Number(clock.rows[0]?.milliseconds);
        if (!Number.isSafeInteger(databaseNow)) throw new Error("Missing real database time for expiry witness");
        if (databaseNow < expiresAt) await new Promise(resolve => setTimeout(resolve, Math.min(500, expiresAt - databaseNow)));
      }
      expect(databaseNow).toBeGreaterThanOrEqual(expiresAt);
      const verdict = await Effect.runPromise(publication.pipe(Effect.result));
      expect(verdict).toMatchObject({ _tag: "Failure", failure: { _tag: "PointCommitStaleAuthorityV1Error", reason: "expired" } });
      const terminal = await session(fixture);
      expect(terminal).toMatchObject({ lifecycle: "expired", validatedArgsCanonicalBytes: null,
        authorizationGrantCanonicalBytes: null, applicationExecutionAuthorityCanonicalBytes: null });
      expect(terminal.finiteClaimFence).toBe(fixture.activation.executionClaim.claimFence + 1n);
      const resolution = await Effect.runPromise(captured.actual.resolveFinite(captured.command()));
      expect(resolution).toMatchObject({ kind: "rejected", error: { _tag: "PointCommitStaleAuthorityV1Error", reason: "expired" } });
      expect(await session(fixture)).toEqual(terminal);
      expect(await fixture.currency.persistence.drizzle.select().from(fxSystemCommits)).toEqual(commits);
      expect(fixture.retryContexts).toHaveLength(0);
      expect(fixture.nativeInvokeCount.get("update")).toBe(1);
    } finally { await fixture.close(); }
  }, 180_000);

  it("refuses changed canonical body bytes with the original digest before another fence", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `finite-body-corrupt-${driver}` });
    try {
      const captured = capturePublisher(fixture);
      await conflict(fixture, captured);
      const original = await session(fixture);
      if (original.finiteAttemptBytes === null) throw new Error("Missing canonical finite anchor bytes");
      const corrupt = original.finiteAttemptBytes.slice();
      corrupt[0] = corrupt[0] === 123 ? 91 : 123;
      const database = fixture.currency.persistence.drizzle;
      try {
        await database.update(fxSystemTransactionSessions).set({ finiteAttemptBytes: corrupt })
          .where(eq(fxSystemTransactionSessions.sessionId, original.sessionId));
        const before = await session(fixture);
        const verdict = await Effect.runPromise(captured.actual.resolveFinite(captured.command()).pipe(Effect.result));
        expect(verdict).toMatchObject({ _tag: "Failure", failure: { _tag: "PointCommitCorruptionV1Error", reason: "sessionInvalid" } });
        expect(await session(fixture)).toEqual(before);
        expect(fixture.retryContexts).toHaveLength(0);
      } finally {
        await database.update(fxSystemTransactionSessions).set({ finiteAttemptBytes: original.finiteAttemptBytes })
          .where(eq(fxSystemTransactionSessions.sessionId, original.sessionId));
      }
    } finally { await fixture.close(); }
  }, 180_000);
});

describe.skipIf(process.env.FLAREX_POSTGRES_DATABASE_URL === undefined)("real PostgreSQL finite fence acknowledgement", () => {
  it("recovers the original outcome after COMMIT acknowledgement and immediate receipt lookup fail while control routing is unavailable", async () => {
    const fixture = await createMixedMutationProductFixture({ driver: "postgres", suffix: "finite-original-outcome-recovery" });
    try {
      const value = await execute(fixture);
      const commitsBefore = await fixture.currency.persistence.drizzle.select().from(fxSystemCommits);
      const eventsBefore = await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      const captured = capturePublisher(fixture);
      let controlReads = 0;
      let targetResolutions = 0;
      const unavailableControl = createPointCommitPublisherPortV1({ ...fixture.pointCommitPorts,
        scopeMetadata: { ...fixture.pointCommitPorts.scopeMetadata, getScopeMetadata: async () => {
          controlReads++; throw new Error("Control placement is unavailable after COMMIT");
        } },
        provisioningReceipts: { getScopeAuthorityProvisioningReceipt: async () => {
          controlReads++; throw new Error("Control receipt is unavailable after COMMIT");
        } },
        scopeSessionTargets: { resolve: async () => {
          targetResolutions++; throw new Error("Target routing is unavailable after COMMIT");
        } },
      }, fixture.publisherOptions);
      let publicationFailure: unknown;
      const publisher = { ...captured.publisher,
        publishFinite: (command: PointFiniteCommitCommand) => captured.publisher.publishFinite(command).pipe(
          Effect.tapError(error => Effect.sync(() => { publicationFailure = error; }))),
        resolveFinite: unavailableControl.resolveFinite,
      };
      const publication = await fixture.preparePublication(value, publisher);
      let receiptLookupFailures = 0;
      const fault = await installOneCommitResponseFault(fixture, commitsBefore.length,
        () => { throw new Error("Actual forwarded finite COMMIT acknowledgement lost"); }, text => {
          if (receiptLookupFailures !== 0 || !/^\s*select\b/i.test(text) || !/\bfx_system_idempotency\b/i.test(text)) return;
          receiptLookupFailures++;
          throw new Error("First original committed receipt lookup unavailable");
        });
      const resolved = await Effect.runPromise(publication).finally(fault.restore);
      expect(fault.fired()).toBe(true);
      expect(receiptLookupFailures).toBe(1);
      expect(publicationFailure).toMatchObject({ _tag: "PointCommitDecisionUncertainV1Error" });
      expect(resolved).toMatchObject({ kind: "replayed" });
      expect(controlReads).toBe(0);
      expect(targetResolutions).toBe(0);
      expect((await fixture.currency.persistence.drizzle.select().from(fxSystemCommits)).length).toBe(commitsBefore.length + 1);
      expect((await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents)).length).toBe(eventsBefore.length + 1);
      expect((await session(fixture)).lifecycle).toBe("committed");
      expect(fixture.nativeInvokeCount.get("update")).toBe(1);
      expect(fixture.retryContexts).toHaveLength(0);
    } finally { await fixture.close(); }
  }, 180_000);

  it("waits for final COMMIT and resolves its outcome before considering nonacceptance", async () => {
    const fixture = await createMixedMutationProductFixture({ driver: "postgres", suffix: "finite-final-resolve-race" });
    let releaseCommit: () => void = () => undefined;
    const release = new Promise<void>(resolve => { releaseCommit = resolve; });
    let enteredCommit: () => void = () => undefined;
    const entered = new Promise<void>(resolve => { enteredCommit = resolve; });
    try {
      if (fixture.currency.resource.kind !== "postgres") throw new Error("Expected ordinary-role PostgreSQL");
      const value = await execute(fixture);
      const captured = capturePublisher(fixture, { ...fixture.publisherOptions,
        afterTransactionStep: async event => {
          if (event.step === "beforeCommit") { enteredCommit(); await release; }
        },
      });
      const publishing = Effect.runFork(await fixture.preparePublication(value, captured.publisher));
      let resolving: Promise<Effect.Success<ReturnType<typeof captured.actual.resolveFinite>>> | undefined;
      let entryTimeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([entered, Effect.runPromise(Fiber.await(publishing)).then(() => {
          throw new Error("Final publication settled before the real pre-COMMIT barrier");
        }), new Promise<never>((_, reject) => {
          entryTimeout = setTimeout(() => reject(new Error("Final publication did not reach COMMIT")), 30_000);
        })]);
        if (entryTimeout !== undefined) { clearTimeout(entryTimeout); entryTimeout = undefined; }
        let resolved = false;
        resolving = Effect.runPromise(captured.actual.resolveFinite(captured.command())).finally(() => { resolved = true; });
        const deadline = Date.now() + 5_000;
        let blocked = false;
        while (Date.now() < deadline && !resolved) {
          const waiters = await fixture.currency.resource.target.query<{ count: number }>(
            `select count(*)::int as count from pg_stat_activity
              where datname = current_database() and cardinality(pg_blocking_pids(pid)) > 0
                and query like '%fx_system_scope_execution_authority%'`);
          if ((waiters.rows[0]?.count ?? 0) > 0) { blocked = true; break; }
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        expect(blocked).toBe(true);
        expect(resolved).toBe(false);
        releaseCommit();
        const published = await Effect.runPromise(Fiber.await(publishing));
        expect(Exit.isSuccess(published)).toBe(true);
        if (Exit.isFailure(published)) throw new Error("Expected accepted final publication");
        const resolution = await resolving;
        expect(resolution).toMatchObject({ kind: "committed", outcome: { kind: "available", token: published.value.token } });
        expect((await session(fixture)).lifecycle).toBe("committed");
        expect(fixture.retryContexts).toHaveLength(0);
        expect(fixture.nativeInvokeCount.get("update")).toBe(1);
      } finally {
        if (entryTimeout !== undefined) clearTimeout(entryTimeout);
        releaseCommit();
        await Effect.runPromise(Fiber.interrupt(publishing));
        if (resolving !== undefined) await Promise.allSettled([resolving]);
      }
    } finally { releaseCommit(); await fixture.close(); }
  }, 180_000);

  it("reconstructs nonacceptance only after locking the fence whose COMMIT acknowledgement was lost", async () => {
    const fixture = await createMixedMutationProductFixture({ driver: "postgres", suffix: "finite-fence-ack-loss" });
    try {
      const value = await execute(fixture);
      await fixture.runStandaloneProductUpdate({ title: `${fixture.seed.newTitle} concurrent`,
        handle: `${fixture.seed.newHandle}-concurrent` });
      const captured = capturePublisher(fixture);
      const publication = await fixture.preparePublication(value, captured.publisher);
      const fault = installOneFiniteFenceCommitResponseFault(fixture);
      const result = await Effect.runPromise(publication.pipe(Effect.result)).finally(fault.restore);
      expect(fault.fired()).toBe(true);
      expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "FinitePointMutationOutcomeUnresolvedError",
        secondary: { _tag: "PointCommitDecisionUncertainV1Error" } } });
      const fenced = await session(fixture);
      expect(fenced.lifecycle).toBe("retrying");
      expect(fenced.finiteClaimFence).toBe(fixture.activation.executionClaim.claimFence + 1n);
      const resolution = await Effect.runPromise(captured.actual.resolveFinite(captured.command()));
      expect(resolution.kind).toBe("noncommit");
      expect(await session(fixture)).toEqual(fenced);
      if (resolution.kind !== "noncommit") throw new Error("Expected the issuer's reconstructed proof");
      const fresh = await Effect.runPromise(replacement(fixture).replaceFinite({ ...captured.command(), proof: resolution.proof }));
      expect(fresh).toMatchObject({ kind: "replaced", attemptFence: fenced.attemptFence + 1n });
      expect((await session(fixture)).attemptFence).toBe(fenced.attemptFence + 1n);
      expect(fixture.retryContexts).toHaveLength(0);
      expect(fixture.nativeInvokeCount.get("update")).toBe(1);
    } finally { await fixture.close(); }
  }, 180_000);
});
