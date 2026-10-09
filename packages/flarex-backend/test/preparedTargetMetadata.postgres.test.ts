import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Effect, Option, Result } from "effect";
import { describe, expect, it, vi } from "vitest";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { encodeCanonicalJson, isJson } from "flarex-protocol/json";
import { logicalCurrencyFixture } from "../../medusa-adapter/test/support/logical-currency-fixture";
import {
  prepareApplicationBindingSelection,
  readApplicationBindingTargetProtection,
} from "../../persistence-postgres/src/application/applicationActivation";
import {
  prepareLogicalSourceEvidence,
  withSharedLogicalSourceBindingChecks,
} from "../../persistence-postgres/src/storage/documents/logicalDocuments/sourceAdmission";
import * as hostPreparation from "../../persistence-postgres/src/execution/preparation/preparedHostRuntime";
import { prepareApplicationActiveHeadStructure, readCheckedCoherentApplicationActiveHeadForShareInTransactionEffect,
  readCheckedApplicationSchemaForHeadForShareInTransactionEffect, releaseCheckedApplicationActiveHead } from
  "../../persistence-postgres/src/application/applicationActiveHeadRead";
import {
  applicationActivationFrame,
  applicationActiveHeadFrame,
} from "../../persistence-postgres/src/application/applicationActivationFrames";
import {
  fxSystemApplicationActivations,
  fxSystemApplicationActiveHeads,
  fxSystemApplicationReadBindings,
} from "../../persistence-postgres/src/application/applicationActivationSchema";
import {
  fxSystemApplicationRevisionSchemasV1,
  fxSystemIndexBuildStates,
} from "../../persistence-postgres/src/database/schema";
import {
  lockScopeClockForShareInTransactionEffect,
  type ScopeClockRecord,
} from "../../persistence-postgres/src/scope/scopeClock";
import { openProtectedMetadataFinalGuardScope, flushProtectedMetadataFinalGuards,
  closeProtectedMetadataFinalGuardScope } from "../../persistence-postgres/src/execution/preparation/preparedMetadataEpoch";
import type { FlarexMetadataTransaction } from "../../persistence-postgres/src/database/metadataTransaction";
import { prepareBindingSelectedStructure, readBindingSelectedEvidence, readBindingActivation } from
  "../../persistence-postgres/src/installation/frameworkSchema/binding/repository";
import { captureBindingValue, isDataBindingActivationFrame, isDataBindingHeadFrame } from
  "../../persistence-postgres/src/installation/frameworkSchema/binding/canonical";
import { fxSystemDataBindingActivations, fxSystemDataBindingHeads } from
  "../../persistence-postgres/src/installation/frameworkSchema/binding/schema";
import { postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import {
  makeDataBindingHost,
  dataBindingActivationRequest,
} from "../../persistence-postgres/src/installation/frameworkSchema/binding/host";

const native = postgresUrl !== null && process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL ? describe : describe.skip;
const bytes = (frame: unknown) => {
  if (!isJson(frame)) throw new Error("Expected a canonical fixture frame");
  return new TextEncoder().encode(encodeCanonicalJson(frame, () => { throw new Error("Invalid fixture frame"); }));
};
const digest = (value: Uint8Array) => Uint8Array.from(createHash("sha256").update(value).digest());

native("protected target first-fill rollback integrity", () => {
  it("charges binding structure to its real issuer and refuses clone, closed and overflowed uses on every lane", async () => {
    const cleanup: Array<() => Promise<void>> = [];
    try {
      const fixture = await logicalCurrencyFixture("postgres", close => cleanup.push(close), { protectedRuntime: true });
      const target = fixture.persistence.drizzle;
      const scopeId = fixture.application.authority.scopeId;
      const logical = fixture.hostInput.logicalStorage;
      const currency = fixture.currencyDefinition;
      const location = { scopeId, storageGeneration: "flarexdb_v1" };
      const issuerStructures: unknown[] = [];
      const sourceStructures: unknown[] = [];
      const actualLifetime = hostPreparation.captureHostPreparationLifetime;
      const actualCharge = hostPreparation.captureHostPreparationCharge;
      const isStructure = (value: unknown) => typeof value === "object" && value !== null &&
        "candidate" in value && "activation" in value;
      const lifetimeSpy = vi.spyOn(hostPreparation, "captureHostPreparationLifetime").mockImplementation(() => actualLifetime().pipe(
        Effect.map(lifetime => lifetime === undefined ? undefined : { ...lifetime, charge: value => {
          if (isStructure(value)) issuerStructures.push(value);
          return lifetime.charge(value);
        } })));
      const sourceChargeSpy = vi.spyOn(hostPreparation, "captureHostPreparationCharge").mockImplementation(() => actualCharge().pipe(
        Effect.map(charge => charge === undefined ? undefined : value => {
          if (isStructure(value)) sourceStructures.push(value);
          return charge(value);
        })));
      try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const runtime = yield* hostPreparation.makePreparedHostRuntime({ maximumHosts: 2, maximumPreparedBytes: 16_777_216 });
          const sourceHost = yield* hostPreparation.retainPreparedHost(runtime, prepareLogicalSourceEvidence(
            logical.ports, logical.unique, { deploymentId: fixture.deploymentId, scopeId, schemaVersionId: logical.schemaVersionId },
            { sourceKey: "medusa.currency", writeProfile: "medusa.currency",
              definition: { kind: "relational", schema: currency.schema }, evidence: currency.provenance },
            "medusa", "relational", { kind: "standalone" }));
          const source = yield* sourceHost.use(Effect.succeed);
          const issuerHost = yield* hostPreparation.retainPreparedHost(runtime,
            fixture.application.activation.readActive().pipe(Effect.map(active => Object.freeze({ active }))));
          const issuer = yield* issuerHost.use(value => Effect.succeed(value.active));
          const lineage = yield* Effect.fromResult(readApplicationBindingTargetProtection(issuer.selection));
          if (lineage.protection === undefined || lineage.lifetime === undefined) return yield* Effect.die("Missing actual retained issuer");
          const prepared = Result.getOrThrow(prepareBindingSelectedStructure(location, lineage.protection, lineage.lifetime));
          const guarded = <A, E>(work: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>) => Effect.tryPromise({
            try: () => target.transaction(async tx => {
              openProtectedMetadataFinalGuardScope(tx);
              try {
                const result = await Effect.runPromise(work(tx));
                await Effect.runPromise(flushProtectedMetadataFinalGuards(tx));
                return result;
              } finally { closeProtectedMetadataFinalGuardScope(tx); }
            }), catch: cause => cause,
          });
          const read = () => guarded(tx => Effect.gen(function* () {
            const clock = yield* lockScopeClockForShareInTransactionEffect(tx, scopeId);
            return yield* source.withBinding(issuer.selection, tx, issuer.basis.authority, clock, () => Effect.void);
          }));
          yield* read();
          yield* read();
          expect(issuerStructures).toHaveLength(1);
          expect(sourceStructures).toHaveLength(0);
          // Disposable request tokens have no issuer lease and spend no retained
          // binding budget while source-owned descriptors retain their own owner.
          for (let index = 0; index < 8; index++) {
            const request = yield* prepareApplicationBindingSelection(fixture.application.activation);
            expect(Result.getOrThrow(readApplicationBindingTargetProtection(request)).lifetime).toBeUndefined();
            yield* guarded(tx => Effect.gen(function* () {
              const clock = yield* lockScopeClockForShareInTransactionEffect(tx, scopeId);
              yield* source.withBinding(request, tx, issuer.basis.authority, clock, () => Effect.void);
            }));
          }
          expect(issuerStructures).toHaveLength(1);
          expect(sourceStructures).toHaveLength(0);
          yield* guarded(tx => readBindingSelectedEvidence(tx, location, prepared));
          yield* guarded(tx => readBindingSelectedEvidence(tx, location, prepared));
          expect(issuerStructures).toHaveLength(2); // One successful fill for each actual prepared handle.
          const clone = structuredClone(prepared);
          const unguarded = (handle = prepared) => Effect.tryPromise({
            try: () => target.transaction(tx => Effect.runPromise(readBindingSelectedEvidence(tx, location, handle))), catch: cause => cause,
          });
          expect(yield* Effect.result(unguarded(clone))).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
          expect(Result.isFailure(lineage.lifetime.charge(new Uint8Array(16_777_216)))).toBe(true);
          expect(yield* Effect.result(unguarded())).toMatchObject({ _tag: "Failure", failure: { reason: "resourceFailure", cause: { reason: "capacityExceeded" } } });
          expect(yield* Effect.result(read())).toMatchObject({ _tag: "Failure", failure: { reason: "invalidComposition", cause: { reason: "capacityExceeded" } } });
          yield* issuerHost.close;
          expect(yield* Effect.result(unguarded())).toMatchObject({ _tag: "Failure", failure: { reason: "resourceFailure", cause: { reason: "closed" } } });
          const secondIssuer = yield* hostPreparation.retainPreparedHost(runtime,
            fixture.application.activation.readActive().pipe(Effect.map(active => Object.freeze({ active }))));
          const second = yield* secondIssuer.use(value => Effect.succeed(value.active));
          let afterCloseEntered = false;
          expect(yield* Effect.result(guarded(tx => Effect.gen(function* () {
            const clock = yield* lockScopeClockForShareInTransactionEffect(tx, scopeId);
            yield* withSharedLogicalSourceBindingChecks(tx, () => source.withBinding(second.selection, tx, second.basis.authority, clock,
              () => secondIssuer.close.pipe(Effect.andThen(source.withBinding(second.selection, tx, second.basis.authority, clock,
                () => Effect.sync(() => { afterCloseEntered = true; }))))));
          })))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidComposition", cause: { reason: "closed" } } });
          expect(afterCloseEntered).toBe(false);
          const openIssuer = yield* hostPreparation.retainPreparedHost(runtime,
            fixture.application.activation.readActive().pipe(Effect.map(active => Object.freeze({ active }))));
          const openSelection = yield* openIssuer.use(value => Effect.succeed(value.active.selection));
          yield* sourceHost.close;
          expect(yield* Effect.result(sourceHost.use(() => Effect.void))).toMatchObject({
            _tag: "Failure", failure: { reason: "closed" },
          });
          expect(Result.isSuccess(readApplicationBindingTargetProtection(openSelection))).toBe(true);
        })));
      } finally { lifetimeSpy.mockRestore(); sourceChargeSpy.mockRestore(); }
    } finally { for (const close of cleanup.reverse()) await close(); }
  }, 180_000);

  it("defers protected standalone physical refusal to fresh acceptance before business work", async () => {
    const cleanup: Array<() => Promise<void>> = [];
    try {
      const fixture = await logicalCurrencyFixture("postgres", close => cleanup.push(close), { protectedRuntime: true });
      const target = fixture.persistence.drizzle;
      const selected = await Effect.runPromise(fixture.application.activation.readActive());
      const scopeId = fixture.application.authority.scopeId;
      const logical = fixture.hostInput.logicalStorage;
      const currency = fixture.currencyDefinition;
      const source = await Effect.runPromise(prepareLogicalSourceEvidence(logical.ports, logical.unique,
        { deploymentId: fixture.deploymentId, scopeId, schemaVersionId: logical.schemaVersionId },
        { sourceKey: "medusa.currency", writeProfile: "medusa.currency",
          definition: { kind: "relational", schema: currency.schema }, evidence: currency.provenance },
        "medusa", "relational", { kind: "standalone" }));
      const definition = selected.basis.physicalRequirements.definitions[0];
      if (definition === undefined) throw new Error("Expected actual Application physical requirements");
      const subject = and(eq(fxSystemIndexBuildStates.scopeId, scopeId),
        eq(fxSystemIndexBuildStates.indexDefinitionId, definition.indexDefinitionId));
      const original = (await target.select().from(fxSystemIndexBuildStates).where(subject).limit(1))[0];
      if (original === undefined) throw new Error("Expected enabled Application build evidence");
      let entered = 0;
      for (const timing of ["before-capture", "after-capture"] as const) {
        const early = timing === "after-capture"
          ? await Effect.runPromise(prepareApplicationBindingSelection(fixture.application.activation)) : undefined;
        try {
          await fixture.testOwner.drizzle.update(fxSystemIndexBuildStates).set({ lifecycle: "validating",
            maintenanceActivationSequence: null, }).where(subject);
          const request = early ?? await Effect.runPromise(prepareApplicationBindingSelection(fixture.application.activation));
          const lineage = Result.getOrThrow(readApplicationBindingTargetProtection(request));
          expect(lineage.protection).toBeDefined();
          expect(lineage.lifetime).toBeUndefined();
          await expect(Effect.runPromise(fixture.application.activation.readActive())).rejects.toMatchObject({ reason: "notReady" });
          await expect(target.transaction(async tx => {
            const clock = await Effect.runPromise(lockScopeClockForShareInTransactionEffect(tx, scopeId));
            openProtectedMetadataFinalGuardScope(tx);
            try {
              const value = await Effect.runPromise(source.withBinding(request, tx, selected.basis.authority, clock,
                () => Effect.sync(() => { entered++; })));
              await Effect.runPromise(flushProtectedMetadataFinalGuards(tx));
              return value;
            } finally { closeProtectedMetadataFinalGuardScope(tx); }
          })).rejects.toMatchObject({ _tag: "ApplicationReadinessError", operation: "settle", reason: "authorityChanged" });
          expect(entered).toBe(0);
        } finally { await fixture.testOwner.drizzle.update(fxSystemIndexBuildStates).set(original).where(subject); }
      }
    } finally { for (const close of cleanup.reverse()) await close(); }
  }, 180_000);

  it("refuses uncommitted activation, schema and binding bodies before retention", async () => {
    const cleanup: Array<() => Promise<void>> = [];
    try {
      const fixture = await logicalCurrencyFixture("postgres", close => cleanup.push(close), { protectedRuntime: true });
      const target = fixture.persistence.drizzle;
      const selected = await Effect.runPromise(fixture.application.activation.readActive());
      const { protection } = Result.getOrThrow(readApplicationBindingTargetProtection(selected.selection));
      if (protection === undefined) throw new Error("Expected an actual protected readiness issuer");
      const scopeId = fixture.application.authority.scopeId;
      const guarded = <Value>(work: (tx: FlarexMetadataTransaction, clock: ScopeClockRecord) => Promise<Value>) =>
        target.transaction(async tx => {
          const clock = await Effect.runPromise(lockScopeClockForShareInTransactionEffect(tx, scopeId));
          openProtectedMetadataFinalGuardScope(tx);
          try {
            const value = await work(tx, clock);
            await Effect.runPromise(flushProtectedMetadataFinalGuards(tx));
            return value;
          } finally { closeProtectedMetadataFinalGuardScope(tx); }
        });
      const unchangedEpoch = protection.epoch.generation.toString();
      const originalReadBindings = await target.select().from(fxSystemApplicationReadBindings)
        .where(eq(fxSystemApplicationReadBindings.scopeId, scopeId));
      const assertRolledBack = async () => {
        const result = await fixture.persistence.query<{ generation: string }>(
          "select generation::text from fx_system_prepared_metadata_epoch");
        expect(result.rows[0]?.generation).toBe(unchangedEpoch);
        expect(await target.select().from(fxSystemApplicationReadBindings)
          .where(eq(fxSystemApplicationReadBindings.scopeId, scopeId))).toEqual(originalReadBindings);
      };

      const activationPreparation = prepareApplicationActiveHeadStructure(protection, undefined, selected.basis);
      let originalActivatedAt: Date | undefined;
      await expect(guarded(async (tx, clock) => {
        const activation = (await tx.select().from(fxSystemApplicationActivations)
          .where(eq(fxSystemApplicationActivations.scopeId, scopeId)).limit(1))[0];
        const head = (await tx.select().from(fxSystemApplicationActiveHeads)
          .where(eq(fxSystemApplicationActiveHeads.scopeId, scopeId)).limit(1))[0];
        if (activation === undefined || head === undefined || activation.readinessContractVersion !== 1)
          throw new Error("Expected the retained legacy Application graph");
        originalActivatedAt = activation.activatedAt;
        const activatedAt = new Date(activation.activatedAt.getTime() + 1000);
        const readiness = { kind: "legacy" as const, contractVersion: 1 as const,
          readinessSha256: encodeBytesToLowercaseHex(activation.readinessSha256) };
        const activationBytes = bytes(applicationActivationFrame({ scopeId,
          activationSequence: activation.activationSequence.toString(),
          previousActivationSequence: activation.previousActivationSequence?.toString() ?? null,
          revisionId: activation.revisionId, readiness,
          activationRequestSha256: encodeBytesToLowercaseHex(activation.activationRequestSha256),
          activatedAt: activatedAt.toISOString() }));
        // Immutable read bindings prevent changing the referenced activation
        // hash. Poison its body while keeping the live head and identity fixed;
        // cached preparation must still authenticate that body before retention.
        await tx.update(fxSystemApplicationActivations).set({ activatedAt, activationBytes })
          .where(eq(fxSystemApplicationActivations.scopeId, scopeId));
        return Effect.runPromise(readCheckedCoherentApplicationActiveHeadForShareInTransactionEffect(tx, clock,
          checked => releaseCheckedApplicationActiveHead(checked), activationPreparation));
      // The full body fails canonical authentication before epoch settlement.
      })).rejects.toMatchObject({ _tag: "ApplicationActiveHeadStateError", reason: "storedState", retryable: false });
      await assertRolledBack();
      const restoredActivation = await guarded(async (tx, clock) => {
        let issued: Parameters<typeof releaseCheckedApplicationActiveHead>[0];
        try { return await Effect.runPromise(readCheckedCoherentApplicationActiveHeadForShareInTransactionEffect(
          tx, clock, checked => { issued = checked; }, activationPreparation)); }
        finally { releaseCheckedApplicationActiveHead(issued); }
      });
      expect(restoredActivation?.active.activation.activatedAt).toEqual(originalActivatedAt);

      const schemaPreparation = prepareApplicationActiveHeadStructure(protection, undefined, selected.basis);
      await expect(guarded(async (tx, clock) => {
        let issued: Parameters<typeof releaseCheckedApplicationActiveHead>[0];
        try {
          const observed = await Effect.runPromise(readCheckedCoherentApplicationActiveHeadForShareInTransactionEffect(
            tx, clock, checked => { issued = checked; }, schemaPreparation));
          if (observed === null) throw new Error("Missing Application head");
          await tx.update(fxSystemApplicationRevisionSchemasV1).set({ deploymentId: "rolled_back_schema_poison" })
            .where(eq(fxSystemApplicationRevisionSchemasV1.scopeId, scopeId));
          return await Effect.runPromise(readCheckedApplicationSchemaForHeadForShareInTransactionEffect(observed.checked, tx, clock));
        } finally { releaseCheckedApplicationActiveHead(issued); }
      })).rejects.toMatchObject({ reason: "resourceFailure", cause: { reason: "changed" } });
      await assertRolledBack();
      const restoredSchema = await guarded(async (tx, clock) => {
        let issued: Parameters<typeof releaseCheckedApplicationActiveHead>[0];
        try {
          const observed = await Effect.runPromise(readCheckedCoherentApplicationActiveHeadForShareInTransactionEffect(
            tx, clock, checked => { issued = checked; }, schemaPreparation));
          if (observed === null) throw new Error("Missing Application head");
          return await Effect.runPromise(readCheckedApplicationSchemaForHeadForShareInTransactionEffect(observed.checked, tx, clock));
        } finally { releaseCheckedApplicationActiveHead(issued); }
      });
      expect(restoredSchema).toMatchObject({ deploymentId: fixture.deploymentId });

      const location = { scopeId, storageGeneration: "flarexdb_v1" };
      const bindingPreparation = Result.getOrThrow(prepareBindingSelectedStructure(location, protection, undefined));
      const original = await target.transaction(tx => Effect.runPromise(readBindingSelectedEvidence(tx, location)));
      if (Option.isNone(original)) throw new Error("Missing selected logical binding");
      await expect(guarded(async tx => {
        const activation = await Effect.runPromise(readBindingActivation(tx, scopeId, "logical-currency-activate"));
        const headRow = (await tx.select().from(fxSystemDataBindingHeads)
          .where(eq(fxSystemDataBindingHeads.scopeId, scopeId)).limit(1))[0];
        if (Option.isNone(activation) || headRow === undefined) throw new Error("Missing binding activation");
        const changed = await Effect.runPromise(captureBindingValue({ ...activation.value.frame,
          request: { ...activation.value.frame.request, requestId: "rolled_back_binding_poison" } }, isDataBindingActivationFrame));
        const changedHead = await Effect.runPromise(captureBindingValue({ ...original.value.head.frame,
          activationSha256: changed.sha256Hex }, isDataBindingHeadFrame));
        await tx.delete(fxSystemDataBindingHeads).where(eq(fxSystemDataBindingHeads.scopeId, scopeId));
        await tx.update(fxSystemDataBindingActivations).set({ requestId: "rolled_back_binding_poison",
          sha256: changed.sha256Hex, canonicalBytes: changed.copyCanonicalBytes(), canonicalByteLength: changed.canonicalByteLength })
          .where(and(eq(fxSystemDataBindingActivations.scopeId, scopeId),
            eq(fxSystemDataBindingActivations.sequence, headRow.sequence)));
        await tx.insert(fxSystemDataBindingHeads).values({ ...headRow, activationSha256: changed.sha256Hex,
          sha256: changedHead.sha256Hex, canonicalBytes: changedHead.copyCanonicalBytes(), canonicalByteLength: changedHead.canonicalByteLength });
        return Effect.runPromise(readBindingSelectedEvidence(tx, location, bindingPreparation));
      })).rejects.toMatchObject({ reason: "resourceFailure", cause: { reason: "changed" } });
      await assertRolledBack();
      const restoredBinding = await guarded(tx => Effect.runPromise(readBindingSelectedEvidence(tx, location, bindingPreparation)));
      expect(restoredBinding).toEqual(original);

      // Both activations exist before this readiness anchor. Only a live head
      // moves inside the refusing transaction, so the immutable epoch stays fixed.
      const originalHeadRow = (await target.select().from(fxSystemDataBindingHeads)
        .where(eq(fxSystemDataBindingHeads.scopeId, scopeId)).limit(1))[0];
      if (originalHeadRow === undefined) throw new Error("Missing original binding head");
      const bindings = await Effect.runPromise(makeDataBindingHost({ database: target,
        selection: { deploymentId: fixture.deploymentId, scopeId }, target: fixture.bindingTarget,
        authority: fixture.application.authorityPorts, application: fixture.application.activation,
        logicalStorage: { controlDb: fixture.control.drizzle, schemaVersionId: fixture.schemaVersionId,
          unique: fixture.application.uniqueConstraintEligibility } }));
      await Effect.runPromise(bindings.activate(dataBindingActivationRequest(scopeId, location.storageGeneration,
        "existing-second-binding-activation", original.value.candidate.sha256,
        { sequence: original.value.head.frame.sequence, sha256: original.value.head.sha256 })));
      const secondHeadRow = (await target.select().from(fxSystemDataBindingHeads)
        .where(eq(fxSystemDataBindingHeads.scopeId, scopeId)).limit(1))[0];
      if (secondHeadRow === undefined) throw new Error("Missing second binding head");
      await target.update(fxSystemDataBindingHeads).set(originalHeadRow)
        .where(eq(fxSystemDataBindingHeads.scopeId, scopeId));
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const runtime = yield* hostPreparation.makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 16_777_216 });
        const issuerHost = yield* hostPreparation.retainPreparedHost(runtime,
          fixture.application.activation.readActive().pipe(Effect.map(active => Object.freeze({ active }))));
        yield* issuerHost.use(({ active }) => Effect.gen(function* () {
          const lineage = yield* Effect.fromResult(readApplicationBindingTargetProtection(active.selection));
          if (lineage.protection === undefined || lineage.lifetime === undefined) {
            return yield* Effect.die("Missing renewed retained readiness anchor");
          }
          let charges = 0;
          const lifetime = lineage.lifetime;
          const headOnlyPreparation = yield* Effect.fromResult(prepareBindingSelectedStructure(location, lineage.protection,
            { ...lifetime, charge: value => { charges++; return lifetime.charge(value); } }));
          yield* Effect.tryPromise({ try: async () => {
            await expect(guarded(async tx => {
              await tx.update(fxSystemDataBindingHeads).set(secondHeadRow)
                .where(eq(fxSystemDataBindingHeads.scopeId, scopeId));
              const temporary = await Effect.runPromise(readBindingSelectedEvidence(tx, location, headOnlyPreparation));
              expect(Option.isSome(temporary) ? temporary.value.head.frame.sequence : undefined).toBe(secondHeadRow.sequence.toString());
              throw new Error("Rollback only the temporary live binding head");
            })).rejects.toThrow("Rollback only the temporary live binding head");
            const afterHeadRollback = await guarded(tx => Effect.runPromise(readBindingSelectedEvidence(tx, location, headOnlyPreparation)));
            expect(afterHeadRollback).toEqual(original);
            expect(charges).toBe(1);
          }, catch: cause => cause });
        }));
      })));
    } finally {
      for (const close of cleanup.reverse()) await close();
    }
  }, 180_000);
});
