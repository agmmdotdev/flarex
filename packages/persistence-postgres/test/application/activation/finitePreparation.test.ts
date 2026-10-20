import { StorageGenerationFenceSchema } from "flarex-protocol/storage-authority";
import { webcrypto } from "node:crypto";
import { eq, ne } from "drizzle-orm";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Cause, Effect, Exit, Result, Schema, Scope, Tracer } from "effect";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { beforeAll, onTestFinished, describe, expect, it, vi } from "vitest";
import { newTestPGlite } from "../../support/pgliteSearchExtensions";
import { migratedPGliteDataDir } from "../../support/pgliteTestFixture";
import {
  prepareFiniteApplicationMutationAdmission,
  readPreparedFiniteApplicationMutationInputs,
  readPreparedFiniteApplicationMutationActivationInputs,
  withPreparedFiniteApplicationMutationAdmissionInTransaction,
} from "../../../src/application/applicationMutationAdmission";
import {
  claimApplicationExecutableActiveSelection,
} from "../../../src/application/activation/selectionIdentity";
import {
  makeApplicationActivationRepository,
} from "../../../src/application/activation/repository";
import {
  readPreparedFiniteApplicationOriginalControl,
} from "../../../src/application/activation/finiteIdentity";
import {
  withValidatedApplicationBindingBasisInTransaction,
} from "../../../src/application/activation/bindingAcceptance";
import {
  requireAcceptedApplicationBindingObservation,
} from "../../../src/application/activation/acceptedBinding";
import {
  type AcceptedApplicationBinding,
} from "../../../src/application/activation/contracts";
import {
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGlitePersistence,
} from "../../../src/database/pglite";
import {
  createApplicationMutationSessionActivationPersistenceV1,
} from "../../../src/execution/session/activation";
import { runEffect } from "../../support/effectTestRuntime";
import {
  makePreparedHostRuntime,
  retainPreparedHost,
} from "../../../src/execution/preparation/preparedHostRuntime";
import {
  prepareFiniteTerminalControlEffect,
  type ApplicationGraphSessionSelector,
} from "../../../src/commit/authority/postgresLoader";
import { createSessionJournalStorePersistence } from "../../../src/execution/sessionJournalStore";
import {
  prepareFiniteSessionJournalEntryControlEffect,
  readPreparedFiniteSessionJournalEntrySchema,
} from "../../../src/execution/journal/finiteEntryActivation";
import {
  abandonPreparedFiniteSessionJournalEntry,
  issuePreparedFiniteSessionJournalEntry,
  inspectPreparedFiniteSessionJournalEntry,
  retainPreparedFiniteEntryControl,
  runPreparedFiniteEntryCaptureEffect,
  type FiniteEntryRun,
} from "../../../src/execution/journal/finiteEntry";
import {
  TEST_GRANT_RETENTION_POLICY_V1,
} from "../../execution/session/support/activationEvidence";
import * as hostPreparation from "../../../src/execution/preparation/preparedHostRuntime";
import type { ScopePhysicalLocator } from "../../../src/scope/scopeMetadataTypes";
import { lockScopeClockForShareInTransactionEffect } from "../../../src/scope/scopeClock";
import {
  fxSystemApplicationFunctionsV1,
  fxSystemApplicationPublicationsV1,
  fxSystemApplicationReadinessFunctionsV1,
} from "../../../src/database/schema";
import {
  createReadinessPGlitePersistence,
  readinessFixture,
} from "../support/readinessFixture";
import { prepareReadinessAuthorities, enablePhysicalBuilds } from "../support/readinessPreparation";
import { uuidSequence } from "../support/readinessEvidence";
import { applicationMutationActivationInput } from "../admission/support/mutationActivation";

beforeAll(async () => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
  await migratedPGliteDataDir();
}, 120_000);

describe("Application activation/finitePreparation", { timeout: 30_000 }, () => {
  it("prepares private finite mutation inputs with detached getters and fresh unprotected acceptance", async () => {
    const fixture = await readinessFixture(
      ...await Promise.all([
        createReadinessPGlitePersistence(),
        createReadinessPGlitePersistence(),
      ]),
      { functionKind: "mutation" },
    );
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" }, deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId, readiness: fixture.repository, authority: fixture.authorityPorts });
    await runEffect(activation.activate({ revisionId: fixture.input.revisionId, expectedActiveHead: null }));
    const context = Object.freeze({ deploymentId: fixture.input.deploymentId,
      controlDb: fixture.control.drizzle, schema: fixture.schema, authority: fixture.authorityPorts });
    let targetOpen = false;
    let targetCaptures = 0;
    const originalTransaction = fixture.target.drizzle.transaction.bind(fixture.target.drizzle);
    const transaction = vi.spyOn(fixture.target.drizzle, "transaction").mockImplementation(async (work, config) => {
      targetCaptures++;
      return originalTransaction(async tx => {
        targetOpen = true;
        try { return await work(tx); } finally { targetOpen = false; }
      }, config);
    });
    const originalHash = crypto.subtle.digest.bind(crypto.subtle);
    const hashBoundaries: boolean[] = [];
    const digest = vi.spyOn(crypto.subtle, "digest").mockImplementation((algorithm, data) => {
      hashBoundaries.push(targetOpen);
      return originalHash(algorithm, data);
    });
    const constructionMembership = vi.spyOn(fixture.control.drizzle, "execute");
    const prepared = await (async () => {
      try {
        const result = await runEffect(prepareFiniteApplicationMutationAdmission(activation, "users:get", context));
        expect(constructionMembership).toHaveBeenCalledTimes(1);
        return result;
      } finally {
        constructionMembership.mockRestore(); digest.mockRestore(); transaction.mockRestore();
      }
    })();
    expect(targetCaptures).toBe(1);
    expect(hashBoundaries.length).toBeGreaterThan(0);
    expect(hashBoundaries.every(open => !open)).toBe(true);
    const first = Result.getOrThrow(readPreparedFiniteApplicationMutationInputs(prepared, context));
    expect("schema" in first).toBe(true);
    const originalInspectionSchema = structuredClone(first.schema);
    Reflect.set(first.schema.manifest.tableDefinitions, "tables", [{ logicalName: "tampered", tableId: 1 }]);
    const originalDigest = encodeBytesToLowercaseHex(first.basis.manifestSha256);
    first.basis.manifestSha256.fill(0);
    Reflect.set(first.basis.manifest.functions[0]!, "path", "tampered:path");
    first.executionAuthority.canonicalBytes.fill(0);
    const second = Result.getOrThrow(readPreparedFiniteApplicationMutationInputs(prepared, context));
    expect(encodeBytesToLowercaseHex(second.basis.manifestSha256)).toBe(originalDigest);
    expect(second.basis.manifest.functions[0]?.path).toBe("users:get");
    expect(second.executionAuthority.canonicalBytes.some(value => value !== 0)).toBe(true);
    expect(second.schema).toEqual(originalInspectionSchema);
    const narrow = Result.getOrThrow(readPreparedFiniteApplicationMutationActivationInputs(prepared, context));
    expect("manifest" in narrow.basis).toBe(false);
    expect("physicalRequirements" in narrow.basis).toBe(false);
    expect("schema" in narrow).toBe(false);
    expect(encodeBytesToLowercaseHex(narrow.basis.manifestSha256)).toBe(originalDigest);
    narrow.basis.manifestSha256.fill(0);
    narrow.executionAuthority.canonicalBytes.fill(0);
    const narrowAgain = Result.getOrThrow(readPreparedFiniteApplicationMutationActivationInputs(prepared, context));
    expect(encodeBytesToLowercaseHex(narrowAgain.basis.manifestSha256)).toBe(originalDigest);
    expect(narrowAgain.executionAuthority.canonicalBytes.some(value => value !== 0)).toBe(true);
    expect(Result.isFailure(readPreparedFiniteApplicationMutationActivationInputs({ ...prepared }, context))).toBe(true);
    expect(Result.isFailure(readPreparedFiniteApplicationMutationActivationInputs(prepared, { ...context }))).toBe(true);
    // Inspecting inert copies does not admit terminal work; the terminal owner
    // below supplies its mandatory aggregate budget independently.
    const inspectOriginalSizes = () => Result.succeed(undefined);
    const originals = Result.getOrThrow(readPreparedFiniteApplicationOriginalControl(first.application, context.controlDb, inspectOriginalSizes));
    const expectedOriginals = structuredClone(originals);
    const payload = originals.original.artifact.payload;
    const binding = originals.original.schemaAuthority.row;
    if (payload === null || binding.bindingBytes === null || binding.bindingSha256 === null ||
      binding.schemaManifestSha256 === null || binding.publishedAt === null) {
      throw new Error("Missing genuinely admitted Application control payload");
    }
    payload.manifestBytes.fill(0);
    payload.manifestSha256.fill(0);
    payload.createdAt.setTime(0);
    originals.original.artifact.sizes.manifestSha256.fill(0);
    originals.original.artifact.sizes.createdAt.setTime(0);
    binding.bindingBytes.fill(0);
    binding.bindingSha256.fill(0);
    binding.applicationSchemaSha256.fill(0);
    binding.schemaManifestSha256.fill(0);
    binding.createdAt.setTime(0);
    binding.publishedAt.setTime(0);
    expect(Result.getOrThrow(readPreparedFiniteApplicationOriginalControl(second.application, context.controlDb, inspectOriginalSizes)))
      .toEqual(expectedOriginals);
    expect(Result.isFailure(readPreparedFiniteApplicationOriginalControl(first.application, fixture.target.drizzle, inspectOriginalSizes))).toBe(true);
    expect(Result.isFailure(readPreparedFiniteApplicationOriginalControl(Object.freeze({ ...first.application }), context.controlDb, inspectOriginalSizes))).toBe(true);
    expect(Result.isFailure(readPreparedFiniteApplicationMutationInputs(Object.freeze({ ...prepared }), context))).toBe(true);
    expect(Result.isFailure(readPreparedFiniteApplicationMutationInputs(prepared, Object.freeze({ ...context })))).toBe(true);
    const closedPreparation = await runEffect(Effect.scoped(Effect.gen(function* () {
      const runtime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 16_777_216 });
      const host = yield* retainPreparedHost(runtime, prepareFiniteApplicationMutationAdmission(
        activation, "users:get", context).pipe(Effect.map(preparation => Object.freeze({ preparation }))));
      return yield* host.use(value => Effect.succeed({ preparation: value.preparation,
        application: Result.getOrThrow(readPreparedFiniteApplicationMutationInputs(value.preparation, context)).application }));
    })));
    expect(Result.isFailure(readPreparedFiniteApplicationMutationInputs(closedPreparation.preparation, context))).toBe(true);
    expect(Result.isFailure(readPreparedFiniteApplicationMutationActivationInputs(closedPreparation.preparation, context))).toBe(true);
    expect(Result.isFailure(readPreparedFiniteApplicationOriginalControl(closedPreparation.application, context.controlDb, inspectOriginalSizes))).toBe(true);
    const terminalPorts = {
      scopeMetadata: fixture.control,
      provisioningReceipts: fixture.authorityPorts.provisioningReceipts,
      scopeSessionTargets: {
        resolve: async (locator: ScopePhysicalLocator) => createPGliteLocatedPointMutationSessionActivationTargetV1(fixture.target, locator),
      },
      applicationControlDb: context.controlDb,
    };
    const sessionActivation = createApplicationMutationSessionActivationPersistenceV1(terminalPorts, {
      leaseDurationMilliseconds: 60_000, randomUuid: uuidSequence(80, 81, 82, 83),
    });
    const otherActive = await runEffect(activation.readActive());
    const created = await runEffect(sessionActivation.activateEffect(await applicationMutationActivationInput(
      fixture, otherActive,
    )));
    if (created.status !== "created") throw new Error("Expected genuine Application session anchor");
    const authority = { deploymentId: created.anchor.deploymentId, scopeId: created.anchor.scopeId,
      sessionId: created.anchor.sessionId, attemptFence: created.anchor.attemptFence,
      storageGeneration: created.anchor.storageGeneration, storageGenerationFence: created.anchor.storageGenerationFence,
      snapshotToken: created.anchor.snapshotToken, schemaVersionId: second.basis.schemaVersionId };
    const execution = second.executionAuthority.authority;
    expect(encodeBytesToLowercaseHex(second.basis.applicationSchemaSha256)).toBe(execution.runtimeTarget.schemaSha256);
    const terminalSelector = {
      executionAuthorityGeneration: "application_v1",
      applicationExecutionAuthorityFormat: execution.format,
      applicationExecutionAuthorityVersionText: execution.version.toString(),
      applicationExecutionAuthorityActivationSequence: execution.activationSequence,
      applicationExecutionAuthorityRevisionId: execution.runtimeTarget.revisionId,
      applicationExecutionAuthorityFunctionPath: execution.runtimeTarget.function.path,
      applicationExecutionAuthoritySchemaSha256: execution.runtimeTarget.schemaSha256,
    } satisfies ApplicationGraphSessionSelector;
    const stableMembership = vi.spyOn(fixture.control.drizzle, "execute");
    const rawReacquisition = vi.spyOn(fixture.control.drizzle, "select");
    try {
      for (const refused of [
        prepareFiniteTerminalControlEffect({ ...terminalPorts, applicationControlDb: fixture.target.drizzle }, authority, terminalSelector, second.application),
        prepareFiniteTerminalControlEffect(terminalPorts, { ...authority, schemaVersionId: decodeCatalogSchemaVersionId("wrong_native_schema") }, terminalSelector, second.application),
        prepareFiniteTerminalControlEffect(terminalPorts, authority, { ...terminalSelector, applicationExecutionAuthorityFunctionPath: "missing:function" }, second.application),
        prepareFiniteTerminalControlEffect(terminalPorts, authority, { ...terminalSelector, applicationExecutionAuthorityRevisionId: "wrong_revision" }, second.application),
        prepareFiniteTerminalControlEffect(terminalPorts, authority, { ...terminalSelector, applicationExecutionAuthoritySchemaSha256: "0".repeat(64) }, second.application),
        prepareFiniteTerminalControlEffect(terminalPorts, authority, terminalSelector, Object.freeze({ ...second.application })),
        prepareFiniteTerminalControlEffect(terminalPorts, authority, terminalSelector, closedPreparation.application),
      ]) {
        await expect(runEffect(refused)).rejects.toMatchObject({ _tag: "StoredCommitAuthorityEvidencePersistenceV1Error", operation: "beforeSchemaArtifactDecode" });
      }
      expect(stableMembership).not.toHaveBeenCalled();
      expect(rawReacquisition).not.toHaveBeenCalled();
      const terminal = await runEffect(prepareFiniteTerminalControlEffect(terminalPorts, authority, terminalSelector, second.application));
      const originalPayload = expectedOriginals.original.artifact.payload;
      if (originalPayload === null) throw new Error("Missing original prepared schema payload");
      expect(Object.keys(terminal).sort()).toEqual(["schemaManifest", "stableBindings"]);
      expect(terminal.schemaManifest).toEqual(JSON.parse(originalPayload.manifestJsonText));
      expect(Reflect.set(terminal.schemaManifest.tableDefinitions, "tables", [])).toBe(false);
      expect(Reflect.set(terminal.stableBindings, "0", { logicalName: "tampered", tableId: 1 })).toBe(false);
      const escapedSchema = structuredClone(terminal);
      Reflect.set(escapedSchema.schemaManifest.tableDefinitions, "tables", [{ logicalName: "tampered", tableId: 1 }]);
      const repeated = await runEffect(prepareFiniteTerminalControlEffect(terminalPorts, authority, terminalSelector, second.application));
      expect(repeated.schemaManifest).toEqual(JSON.parse(originalPayload.manifestJsonText));
      expect(repeated.stableBindings).toEqual(terminal.stableBindings);
      expect(stableMembership).not.toHaveBeenCalled();
      expect(rawReacquisition).not.toHaveBeenCalled();
    } finally {
      stableMembership.mockRestore();
      rawReacquisition.mockRestore();
    }
    const entryScope = await runEffect(Scope.make());
    try {
      const entryStore = createSessionJournalStorePersistence(terminalPorts, { grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1 });
      const entry = await runEffect(Scope.provide(entryStore.prepareFiniteEntryEffect([]), entryScope));
      const entryControl = await runEffect(prepareFiniteSessionJournalEntryControlEffect(entry, {
        ...authority, kind: "claimedAttempt", scopeUuid: projectScopeIdUuidV1(authority.scopeId).scopeUuid,
        executionClaim: created.executionClaim,
      }, terminalSelector, second.application));
      const reservedEntry = inspectPreparedFiniteSessionJournalEntry(entry);
      if (reservedEntry === undefined) throw new Error("Missing original finite entry reservation");
      const accept = () => fixture.target.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
        const clock = yield* lockScopeClockForShareInTransactionEffect(tx, fixture.input.scopeId);
        let escaped: AcceptedApplicationBinding | undefined;
        const accepted = yield* withPreparedFiniteApplicationMutationAdmissionInTransaction(prepared, context, tx, clock,
          (admitted, binding) => Effect.gen(function* () {
            escaped = binding;
            expect(Result.isSuccess(requireAcceptedApplicationBindingObservation(binding, admitted.selection, tx, clock))).toBe(true);
            expect(Result.isFailure(claimApplicationExecutableActiveSelection(binding))).toBe(true);
            // SAFETY: cloned nominal token/transaction deliberately exercise identity refusal.
            expect(Result.isFailure(requireAcceptedApplicationBindingObservation({ ...binding } as AcceptedApplicationBinding,
              admitted.selection, tx, clock))).toBe(true);
            expect(Result.isFailure(requireAcceptedApplicationBindingObservation(binding, admitted.selection, { ...tx } as typeof tx, clock))).toBe(true);
            expect(Result.isFailure(requireAcceptedApplicationBindingObservation(binding, admitted.selection, tx,
              { ...clock, storageGenerationFence: Schema.decodeUnknownSync(StorageGenerationFenceSchema)(
                (clock.storageGenerationFence + 1n).toString()) }))).toBe(true);
            expect(Result.isFailure(requireAcceptedApplicationBindingObservation(binding,
              { ...admitted.selection }, tx, clock))).toBe(true);
            const borrowedSpans: string[] = [];
            const borrowedTracer = Tracer.make({ span(options) { borrowedSpans.push(options.name); return new Tracer.NativeSpan(options); } });
            const borrowed = yield* withValidatedApplicationBindingBasisInTransaction(admitted.selection, tx, clock,
              (validated, _checked, finiteBinding) => Effect.sync(() => {
                // Weak finite entry cannot masquerade as full ordinary readiness.
                expect(finiteBinding).not.toBe(binding);
                return validated;
              }), binding).pipe(Effect.provideService(Tracer.Tracer, borrowedTracer));
            expect(borrowed.basis.revisionId).toBe(admitted.basis.revisionId);
            expect(borrowedSpans.filter(name => name === "ApplicationReadiness.validateFiniteEntry")).toHaveLength(1);
            expect(borrowedSpans).not.toContain("ApplicationReadiness.validateStoredForActivationInTransaction");
            expect(borrowedSpans).not.toContain("ApplicationActiveHead.readCheckedCoherentForShare");
            // Exercise only process-local control consumption. The actual Store
            // reservation remains Scope-owned; accepting kernel/entry SQL is
            // covered by the connected finite-entry fixtures.
            expect(Result.isFailure(readPreparedFiniteSessionJournalEntrySchema(entry, admitted.selection, entryControl))).toBe(true);
            const callbackDefect = new Error("local control callback stops before kernel capture");
            const install = vi.fn();
            const discard = vi.fn();
            const release = vi.fn();
            const unexpectedKernelRead = vi.fn(() => { throw new Error("Local control proof must not read kernel inputs"); });
            // SAFETY: deliberately unused unit-boundary inputs cannot substitute
            // a kernel context or target. Any attempted read fails immediately.
            const unusedContext = new Proxy({} as Parameters<FiniteEntryRun>[1], { get: unexpectedKernelRead });
            const unusedTarget = new Proxy({} as Parameters<FiniteEntryRun>[2], { get: unexpectedKernelRead });
            const closedControlEntry = yield* Effect.scoped(Effect.gen(function* () {
              const controlEntry = yield* Effect.acquireRelease(Effect.sync(() => issuePreparedFiniteSessionJournalEntry({
                issuer: terminalPorts, attempt: reservedEntry.attempt,
                run: () => Effect.die(callbackDefect), install, discard, release,
              })), value => Effect.sync(() => abandonPreparedFiniteSessionJournalEntry(value)));
              expect(Result.getOrThrow(retainPreparedFiniteEntryControl(controlEntry, second.application, entryControl))).toBe(entryControl);
              expect(Result.isFailure(readPreparedFiniteSessionJournalEntrySchema(controlEntry, admitted.selection, entryControl))).toBe(true);
              const stopped = yield* Effect.exit(runPreparedFiniteEntryCaptureEffect(controlEntry, tx,
                unusedContext, unusedTarget, admitted.selection, binding, entryControl, second.executionAuthority, Effect.void));
              expect(Exit.isFailure(stopped)).toBe(true);
              if (Exit.isFailure(stopped)) expect(Result.getOrThrow(Cause.findDefect(stopped.cause))).toBe(callbackDefect);
              expect(inspectPreparedFiniteSessionJournalEntry(controlEntry)).toMatchObject({ status: "running", hasCapture: false });
              expect(Result.getOrThrow(readPreparedFiniteSessionJournalEntrySchema(controlEntry, admitted.selection, entryControl))).toBe(entryControl);
              expect(Result.isFailure(readPreparedFiniteSessionJournalEntrySchema(controlEntry, admitted.selection, structuredClone(entryControl)))).toBe(true);
              expect(Result.isFailure(readPreparedFiniteSessionJournalEntrySchema(controlEntry, admitted.selection, new Proxy(entryControl, {})))).toBe(true);
              expect(Result.isFailure(readPreparedFiniteSessionJournalEntrySchema({ ...controlEntry }, admitted.selection, entryControl))).toBe(true);
              expect(Result.isFailure(readPreparedFiniteSessionJournalEntrySchema(controlEntry, { ...admitted.selection }, entryControl))).toBe(true);
              expect(Result.isFailure(readPreparedFiniteSessionJournalEntrySchema(controlEntry, otherActive.selection, entryControl))).toBe(true);
              return controlEntry;
            }));
            expect(inspectPreparedFiniteSessionJournalEntry(closedControlEntry)?.status).toBe("abandoned");
            expect(Result.isFailure(readPreparedFiniteSessionJournalEntrySchema(closedControlEntry, admitted.selection, entryControl))).toBe(true);
            expect(inspectPreparedFiniteSessionJournalEntry(entry)?.status).toBe("prepared");
            expect(unexpectedKernelRead).not.toHaveBeenCalled();
            expect(install).not.toHaveBeenCalled();
            expect(discard).not.toHaveBeenCalled();
            expect(release).toHaveBeenCalledTimes(1);
            return admitted;
          }));
        if (escaped === undefined) throw new Error("Missing finite callback observation");
        expect(Result.isFailure(requireAcceptedApplicationBindingObservation(escaped, accepted.selection, tx, clock))).toBe(true);
        return accepted;
      })));
      expect((await accept()).basis.revisionId).toBe(fixture.input.revisionId);
      await fixture.target.drizzle.update(fxSystemApplicationFunctionsV1).set({ entryBytes: new Uint8Array([1]) })
        .where(eq(fxSystemApplicationFunctionsV1.functionPath, "users:get"));
      await expect(accept()).rejects.toMatchObject({ _tag: "ApplicationReadinessError", reason: "storedState" });
    } finally { await runEffect(Scope.close(entryScope, Exit.succeed(undefined))); }
  })

  it("charges retained finite opaque index lifecycle evidence before issuing a usable handle", async () => {
    const fixture = await readinessFixture(
      ...await Promise.all([
        createReadinessPGlitePersistence(),
        createReadinessPGlitePersistence(),
      ]),
      { includeTable: true, includeIndex: true, functionKind: "mutation" },
    );
    const schemaVersionId = await prepareReadinessAuthorities(fixture);
    await enablePhysicalBuilds(fixture, schemaVersionId);
    await runEffect(fixture.repository.settle(fixture.input));
    const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" }, deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId, readiness: fixture.repository, authority: fixture.authorityPorts });
    await runEffect(activation.activate({ revisionId: fixture.input.revisionId, expectedActiveHead: null }));
    const context = Object.freeze({ deploymentId: fixture.input.deploymentId,
      controlDb: fixture.control.drizzle, schema: fixture.schema, authority: fixture.authorityPorts });
    const payloads: unknown[] = [];
    const actualCharge = hostPreparation.chargeHostPreparation;
    const isOpaque = (value: unknown) => typeof value === "object" && value !== null &&
      "uniqueSetSha256" in value && "indexDefinitions" in value && "requirements" in value;
    let observing = true;
    const chargeSpy = vi.spyOn(hostPreparation, "chargeHostPreparation").mockImplementation(value => {
      if (observing) payloads.push(value);
      return actualCharge(value);
    });
    try {
      await runEffect(Effect.scoped(Effect.gen(function* () {
        const runtime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 16_777_216 });
        const host = yield* retainPreparedHost(runtime, prepareFiniteApplicationMutationAdmission(activation, "users:get", context)
          .pipe(Effect.map(preparation => Object.freeze({ preparation }))));
        const prepared = yield* host.use(value => Effect.succeed(value.preparation));
        expect(Result.isSuccess(readPreparedFiniteApplicationMutationInputs(prepared, context))).toBe(true);
      })));
      observing = false;
      const opaqueIndex = payloads.findIndex(isOpaque);
      expect(opaqueIndex).toBeGreaterThanOrEqual(0);
      expect(payloads[opaqueIndex]).toMatchObject({ indexDefinitions: expect.arrayContaining([expect.objectContaining({})]),
        requirements: expect.arrayContaining([expect.objectContaining({})]) });
      // Calibrate this owner's real meter with its actual successful charge
      // prefix. No copy of the generic byte-accounting algorithm is involved.
      const prefix = payloads.slice(0, opaqueIndex + 1);
      const admits = (maximumPreparedBytes: number) => runEffect(Effect.scoped(Effect.gen(function* () {
        const runtime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes });
        return yield* Effect.result(retainPreparedHost(runtime, Effect.forEach(prefix,
          value => hostPreparation.chargeHostPreparation(value), { discard: true }).pipe(Effect.as(Object.freeze({})))));
      }))).then(Result.isSuccess);
      let low = 1;
      let high = 16_777_216;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (await admits(middle)) high = middle;
        else low = middle + 1;
      }
      expect(await admits(low)).toBe(true);
      expect(await admits(low - 1)).toBe(false);
      payloads.length = 0;
      observing = true;
      let usable = false;
      await runEffect(Effect.scoped(Effect.gen(function* () {
        const runtime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: low - 1 });
        const failed = yield* Effect.result(retainPreparedHost(runtime, Effect.gen(function* () {
          const lifetime = yield* hostPreparation.captureHostPreparationLifetime();
          if (lifetime === undefined) return yield* Effect.die("Missing actual finite preparation lease");
          return yield* prepareFiniteApplicationMutationAdmission(activation, "users:get", context).pipe(
            Effect.tapError(() => Effect.sync(() => {
              expect(lifetime.checkOpen()).toMatchObject({ _tag: "Failure", failure: { reason: "capacityExceeded" } });
              expect(lifetime.charge({})).toMatchObject({ _tag: "Failure", failure: { reason: "capacityExceeded" } });
            })),
            Effect.tap(() => Effect.sync(() => { usable = true; })),
            Effect.map(preparation => Object.freeze({ preparation })));
        })));
        expect(failed).toMatchObject({ _tag: "Failure", failure: { reason: "resourceFailure",
          cause: { reason: "capacityExceeded" } } });
        expect(usable).toBe(false);
        expect(payloads).toHaveLength(opaqueIndex + 1);
        expect(isOpaque(payloads.at(-1))).toBe(true);
        // Failed construction releases its host reservation and all bytes.
        const replacement = yield* retainPreparedHost(runtime, Effect.succeed(Object.freeze({})));
        yield* replacement.use(() => Effect.void);
        yield* replacement.close;
        expect(yield* Effect.result(replacement.use(() => Effect.void))).toMatchObject({
          _tag: "Failure", failure: { reason: "closed" },
        });
      })));
    } finally { chargeSpy.mockRestore(); }
  })

  it("refuses aggregate function bytes and oversized cold receipts before driver payload capture", async () => {
    const db = newTestPGlite({ loadDataDir: await migratedPGliteDataDir() });
    onTestFinished(() => db.close());
    let observing = false;
    const driverBytes: number[] = [];
    const observeBytes = (value: unknown): void => {
      if (value instanceof Uint8Array) driverBytes.push(value.byteLength);
      else if (Array.isArray(value)) value.forEach(observeBytes);
      else if (typeof value === "object" && value !== null) Object.values(value).forEach(observeBytes);
    };
    const targetPersistence = await createPGlitePersistence({ db: {
      exec: db.exec.bind(db), query: db.query.bind(db),
      transaction: run => db.transaction(tx => run({ exec: tx.exec.bind(tx),
        query: new Proxy(tx.query, { apply(targetQuery, _receiver, args: unknown[]) {
          return Promise.resolve(Reflect.apply(targetQuery, tx, args)).then(result => {
            if (observing) observeBytes(result);
            return result;
          });
        } }),
      })),
    } });
    const fixture = await readinessFixture(
      await createReadinessPGlitePersistence(),
      targetPersistence,
      { functionKind: "mutation" },
    );
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" }, deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId, readiness: fixture.repository, authority: fixture.authorityPorts });
    await runEffect(activation.activate({ revisionId: fixture.input.revisionId, expectedActiveHead: null }));
    const context = Object.freeze({ deploymentId: fixture.input.deploymentId,
      controlDb: fixture.control.drizzle, schema: fixture.schema, authority: fixture.authorityPorts });
    const original = (await fixture.target.drizzle.select().from(fxSystemApplicationFunctionsV1))[0];
    if (original === undefined) throw new Error("Expected stored function");
    const inflated = new Uint8Array(65_536);
    await fixture.target.drizzle.update(fxSystemApplicationFunctionsV1).set({ entryBytes: inflated });
    await fixture.target.drizzle.insert(fxSystemApplicationFunctionsV1).values(Array.from({ length: 16 }, (_, index) => ({ ...original,
      functionPath: `users:peer${index}`, exportName: `peer${index}`, entrySha256: new Uint8Array(32).fill(index + 1),
      entryBytes: inflated })));
    observing = true;
    await expect(runEffect(prepareFiniteApplicationMutationAdmission(activation, "users:get", context)))
      .rejects.toMatchObject({ reason: "storedState" });
    expect(driverBytes.length).toBeGreaterThan(0);
    expect(Math.max(...driverBytes)).toBeLessThan(16_384);
    observing = false;
    await fixture.target.drizzle.delete(fxSystemApplicationFunctionsV1).where(ne(
      fxSystemApplicationFunctionsV1.functionPath, original.functionPath));
    await fixture.target.drizzle.update(fxSystemApplicationFunctionsV1).set({ entryBytes: original.entryBytes });
    // Deliberate unprotected corruption beyond the persisted check: the capture
    // owner must still prevent the oversized value crossing the driver boundary.
    await fixture.target.query("alter table fx_system_application_readiness_function_v1 drop constraint fx_application_readiness_function_v1_identity_check");
    await fixture.target.drizzle.update(fxSystemApplicationReadinessFunctionsV1).set({
      coldReceiptBytes: new Uint8Array(16_385),
    });
    driverBytes.length = 0;
    observing = true;
    await expect(runEffect(prepareFiniteApplicationMutationAdmission(activation, "users:get", context)))
      .rejects.toMatchObject({ reason: "storedState" });
    expect(driverBytes.length).toBeGreaterThan(0);
    expect(Math.max(...driverBytes)).toBeLessThan(16_384);
  })

  it("refuses unchanged-digest publication body corruption before issuing finite preparation", async () => {
    const fixture = await readinessFixture(
      ...await Promise.all([
        createReadinessPGlitePersistence(),
        createReadinessPGlitePersistence(),
      ]),
      { functionKind: "mutation" },
    );
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" }, deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId, readiness: fixture.repository, authority: fixture.authorityPorts });
    await runEffect(activation.activate({ revisionId: fixture.input.revisionId, expectedActiveHead: null }));
    const context = Object.freeze({ deploymentId: fixture.input.deploymentId,
      controlDb: fixture.control.drizzle, schema: fixture.schema, authority: fixture.authorityPorts });
    await fixture.target.drizzle.update(fxSystemApplicationPublicationsV1).set({ schemaBytes: new Uint8Array([1]) })
      .where(eq(fxSystemApplicationPublicationsV1.revisionId, fixture.input.revisionId));
    await expect(runEffect(prepareFiniteApplicationMutationAdmission(activation, "users:get", context)))
      .rejects.toMatchObject({ _tag: "ApplicationReadinessError", reason: "storedState" });
  })
});
