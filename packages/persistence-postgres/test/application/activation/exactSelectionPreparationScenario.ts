import { Effect, Exit, Result, Tracer } from "effect";
import { expect } from "vitest";
import {
  prepareFiniteApplicationMutationAdmission,
  readPreparedFiniteApplicationMutationInputs,
  type ApplicationMutationAdmissionContext,
  type PreparedFiniteApplicationMutationInputs,
} from "../../../src/application/applicationMutationAdmission";
import { prepareCurrentApplicationBinding } from "../../../src/application/activation/currentBinding";
import { readApplicationSelectionState } from "../../../src/application/activation/selectionIdentity";
import { prepareFiniteActiveApplication, prepareRetainedApplicationBindingSelection } from "../../../src/application/activation/repositoryIdentity";
import { makePreparedHostRuntime, retainPreparedHost } from "../../../src/execution/preparation/preparedHostRuntime";
import type { ApplicationBindingInput } from "../../../src/application/activation/contracts";
import type { PGliteFlarexPersistence } from "../../../src/database/pglite";
import type { PostgresFlarexPersistence } from "../../../src/database/postgres";
import type { SplitScopePhysicalLocator } from "../../../src/scope/scopeMetadataTypes";
import { createApplicationNativeMutationMixedFixture } from "../applicationNativeMutationTestFixture";
import { LOCATOR } from "../support/readinessArtifacts";
import { prepareAdditionalRelationRevision, prepareReadinessEvidence, relationReadinessFixture } from "../relations/applicationRelationReadinessFixture";
import { preparedHostTestRuntime } from "../../execution/preparation/preparedHostRuntimeTestSupport";
import { runEffect } from "../../support/effectTestRuntime";

/** Genuine registered owners on independent control/target databases. Tracing
 * observes the original finite reader, never a repository-shaped substitute. */
export async function exactSelectionPreparationScenario(
  control: PGliteFlarexPersistence | PostgresFlarexPersistence,
  target: PGliteFlarexPersistence | PostgresFlarexPersistence,
  profile: "legacy" | "boundedV3",
  physicalLocator: SplitScopePhysicalLocator = LOCATOR,
) {
  const peer = await createApplicationNativeMutationMixedFixture({ runtimeHostIdentity: "flarex.test/exact-selection-peer",
    compatibilityDate: "2026-10-11", includeTask: false, physicalLocator,
    fixtureIdentity: { deploymentId: "exact_selection_peer", projectId: "exact_selection_peer", uuidOffset: 20_000 } }, { control, target });
  const native = profile === "legacy" ? await createApplicationNativeMutationMixedFixture({
    runtimeHostIdentity: "flarex.test/exact-selection", compatibilityDate: "2026-10-11", includeTask: false, physicalLocator }, { control, target }) : undefined;
  const relation = profile === "boundedV3" ? await relationReadinessFixture({ persistence: target,
    controlPersistence: control, writePolicy: true, includeFunction: true, bindingAdmission: true, physicalLocator }) : undefined;
  if (relation !== undefined) {
    await prepareReadinessEvidence(relation);
    await runEffect(relation.relationActivation.activate({ revisionId: relation.input.revisionId, expectedActiveHead: null }));
  }
  const repository = native?.activation ?? relation?.relationActivation;
  const schema = native?.schema ?? relation?.servingOwners.schema;
  const authority = native?.authorityPorts ?? relation?.authorityPorts;
  const deploymentId = native?.deploymentId ?? relation?.deploymentId;
  const scopeId = native?.authority.scopeId ?? relation?.authority.scopeId;
  if (repository === undefined || schema === undefined || authority === undefined || deploymentId === undefined || scopeId === undefined)
    throw new Error("Missing genuine preparation profile");
  const context: ApplicationMutationAdmissionContext = Object.freeze({ deploymentId, controlDb: control.drizzle, schema, authority,
    ...(relation === undefined ? {} : { relationSchema: relation.foldContext.schema }) });
  const functionPath = profile === "legacy" ? "users:create" : "functions:write";
  const original = await runEffect(repository.readActive());
  const originalBasis = readApplicationSelectionState(original.selection)?.basis;
  if (originalBasis === undefined) throw new Error("Missing issuer-owned original executable basis");
  expect(originalBasis.manifest.version).toBe(profile === "legacy" ? 1 : 3);
  const spans: string[] = [];
  const tracer = Tracer.make({ span(options) { spans.push(options.name); return new Tracer.NativeSpan(options); } });
  let escapedBinding: ApplicationBindingInput | undefined;
  const construct = prepareCurrentApplicationBinding(repository, target.drizzle, binding => Effect.gen(function* () {
    escapedBinding = binding;
    const prepared = yield* prepareFiniteApplicationMutationAdmission(repository, functionPath, context, binding).pipe(
      Effect.provideService(Tracer.Tracer, tracer));
    const inputs = yield* Effect.fromResult(readPreparedFiniteApplicationMutationInputs(prepared, context));
    expect(inputs.basis).toEqual(originalBasis);
    expect(inputs.executionAuthority.authority.runtimeTarget.function.path).toBe(functionPath);
    const copied = yield* Effect.result(prepareFiniteActiveApplication(repository, Object.freeze({ ...binding })));
    expect(Result.isFailure(copied)).toBe(true);
    const peerBinding = yield* prepareRetainedApplicationBindingSelection(peer.activation);
    expect(Result.isFailure(yield* Effect.result(prepareFiniteActiveApplication(repository, peerBinding)))).toBe(true);
    expect(Result.isFailure(yield* Effect.result(prepareFiniteApplicationMutationAdmission(repository, functionPath,
      Object.freeze({ ...context, controlDb: target.drizzle }), binding)))).toBe(true);
    expect(Result.isFailure(yield* Effect.result(prepareFiniteActiveApplication(Object.freeze({ ...repository }), binding)))).toBe(true);
    return { prepared };
  }), { selection: { deploymentId, scopeId } });
  const retained = await runEffect(retainPreparedHost(preparedHostTestRuntime(target.drizzle), construct));
  const preparation = await runEffect(retained.use(current => current.withFiniteEntry(graph => Effect.succeed(graph.payload.prepared))));
  const charged = Result.getOrThrow(retained.readUsage()).chargedBytes;
  expect(charged).toBeGreaterThan(0);
  expect(spans).toContain("ApplicationMutationAdmission.prepareFinite");
  expect(spans).not.toContain("ApplicationActivation.readActive");
  expect(spans).not.toContain("ApplicationActivation.readActiveDispatched");
  expect(spans).not.toContain("ApplicationActivation.readLegacyTransaction");
  expect(spans).not.toContain("ApplicationActivation.readRelationTransaction");
  expect(Result.getOrThrow(readPreparedFiniteApplicationMutationInputs(preparation, context)).basis).toEqual(originalBasis);
  await runEffect(retained.close);
  expect(Result.isFailure(readPreparedFiniteApplicationMutationInputs(preparation, context))).toBe(true);
  if (escapedBinding === undefined) throw new Error("Missing original issued binding");
  const closedBinding = escapedBinding;
  await runEffect(Effect.scoped(Effect.gen(function* () {
    const runtime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: charged * 2 });
    expect(Result.isFailure(yield* Effect.result(retainPreparedHost(runtime,
      prepareFiniteActiveApplication(repository, closedBinding))))).toBe(true);
    const replacement = yield* retainPreparedHost(runtime, Effect.succeed(Object.freeze({ available: true })));
    yield* replacement.close;
  })));

  // The complete calibrated graph exceeds this allocation by one byte. Its
  // failure must release the actual host slot and charged staged generation.
  await runEffect(Effect.scoped(Effect.gen(function* () {
    const runtime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: charged - 1 });
    const failed = yield* Effect.exit(retainPreparedHost(runtime, construct));
    expect(Exit.isFailure(failed)).toBe(true);
    const replacement = yield* retainPreparedHost(runtime, Effect.succeed(Object.freeze({ available: true })));
    yield* replacement.close;
  })));

  // A canonical activation races after the original binding was issued and
  // before finite preparation. A successful local derivation must still be the
  // original basis; the outer before/after observation refuses this generation.
  let raceInputs: PreparedFiniteApplicationMutationInputs | undefined;
  const race = await runEffect(Effect.scoped(Effect.gen(function* () {
    const runtime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: charged * 3 });
    return yield* Effect.exit(retainPreparedHost(runtime, prepareCurrentApplicationBinding(repository, target.drizzle,
      binding => Effect.gen(function* () {
        yield* Effect.promise(async () => {
          if (native !== undefined) await native.moveHead();
          else if (relation !== undefined) {
            const next = await prepareAdditionalRelationRevision(relation);
            await runEffect(relation.relationActivation.activate({ revisionId: next.publication.revisionId,
              expectedActiveHead: original.expectedActiveHead }));
          }
        });
        const result = yield* Effect.result(prepareFiniteApplicationMutationAdmission(repository, functionPath, context, binding));
        if (Result.isSuccess(result)) {
          raceInputs = yield* Effect.fromResult(readPreparedFiniteApplicationMutationInputs(result.success, context));
          expect(raceInputs.basis).toEqual(originalBasis);
        } else expect(result.failure).toMatchObject({ reason: "concurrentHead" });
        return {};
      }), { selection: { deploymentId, scopeId } })));
  })));
  expect(Exit.isFailure(race)).toBe(true);
  if (Exit.isSuccess(race)) { await runEffect(race.value.close); throw new Error("Racing preparation published a substituted generation"); }
  expect(race.cause.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ _tag: "Fail",
    error: expect.objectContaining({ reason: "concurrentHead" }) })]));
  const current = await runEffect(repository.readActive());
  expect(current.basis.revisionId).not.toBe(originalBasis.revisionId);
  if (raceInputs !== undefined) expect(raceInputs.basis.headSha256).not.toEqual(current.basis.headSha256);

  const retiring = await runEffect(retainPreparedHost(preparedHostTestRuntime(target.drizzle),
    prepareCurrentApplicationBinding(repository, target.drizzle, binding =>
      prepareFiniteApplicationMutationAdmission(repository, functionPath, context, binding).pipe(
        Effect.map(prepared => ({ prepared }))), { selection: { deploymentId, scopeId } })));
  try {
    const priorPreparation = await runEffect(retiring.use(owner => owner.withFiniteEntry(graph => Effect.succeed(graph.payload.prepared))));
    if (native !== undefined) await native.moveHead();
    else if (relation !== undefined) {
      const active = await runEffect(relation.relationActivation.readActive());
      const next = await prepareAdditionalRelationRevision(relation, 1);
      await runEffect(relation.relationActivation.activate({ revisionId: next.publication.revisionId,
        expectedActiveHead: active.expectedActiveHead }));
    }
    const refreshed = await runEffect(retiring.use(owner => Effect.scoped(owner.acquireFreshFinitePreparation.pipe(
      Effect.map(graph => graph.payload.prepared)))));
    expect(Result.isFailure(readPreparedFiniteApplicationMutationInputs(priorPreparation, context))).toBe(true);
    const freshInputs = Result.getOrThrow(readPreparedFiniteApplicationMutationInputs(refreshed, context));
    expect(freshInputs.basis.revisionId).toBe((await runEffect(repository.readActive())).basis.revisionId);
    expect(refreshed).not.toBe(priorPreparation);
  } finally { await runEffect(retiring.close); }
}
