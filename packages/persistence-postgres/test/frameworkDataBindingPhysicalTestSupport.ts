import type { DataBindingHost } from "../src/frameworkSchema/binding/host";
import { Effect, Result } from "effect";
import { eq } from "drizzle-orm";
import { fxSystemDataBindingPhysicalLanes } from "../src/frameworkSchema/binding/schema";
import { expect } from "vitest";
import { captureRelationalSchemaArtifact } from "../src/relationalSchema/artifact";
import {
  currencySchemaInput,
  syntheticSchemaInput,
} from "./frameworkMigrationValueFixtures";
import {
  prepareFrameworkSchemaArtifactAdmission,
  type FrameworkSchemaArtifactRepository,
} from "../src/frameworkSchema/artifact/repository";
import { admitFrameworkSchemaArtifactEffect } from "../src/frameworkSchema/artifact/admission";
import { runFreshFrameworkMigrationCoordinatorEffect } from "../src/migrationCoordination/freshCoordinator";
import type { FrameworkMigrationTarget } from "../src/migrationCoordination/targetSession";
import type {
  ApplicationNativeMutationFixture,
  ApplicationNativeMutationPersistence,
} from "./fixtures/applicationNativeMutationTestFixture";
import {
  makeDataBindingHost,
  dataBindingActivationRequest,
} from "../src/frameworkSchema/binding/host";
import { makeDataBindingTestProfiles } from "../src/frameworkSchema/binding/profiles";
import {
  readAdmittedDataBinding,
  readSyntheticTestSelection,
  type AdmittedDataBinding,
} from "../src/frameworkSchema/binding/selection";
import type {
  DataBindingSetFrame,
  DataBindingHeadToken,
  CommerceBinding,
  BindingProfileReference,
  InstallationBindingReference,
} from "../src/frameworkSchema/binding/model";
import {
  captureFrameworkSchemaAvailabilityHistory,
  captureFrameworkSchemaAvailabilityHead,
} from "../src/frameworkSchema/installation/canonical";
import { appendFrameworkSchemaAvailabilityHistoryInTransactionEffect } from "../src/frameworkSchema/installation/availabilityHistoryRepository";
import { compareAndSwapFrameworkSchemaAvailabilityHeadInTransactionEffect } from "../src/frameworkSchema/installation/availabilityHeadRepository";
import type { RestoredFrameworkSchemaAvailabilityHead } from "../src/frameworkSchema/installation/storedMetadataRestoration";
import { bindingInput } from "./frameworkDataBindingTestSupport";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  isDataBindingSetFrame,
} from "../src/frameworkSchema/binding/canonical";
import { isStoredInstallationIdentity } from "../src/frameworkSchema/installation/storedValidation";
import { bindingError } from "../src/frameworkSchema/binding/errors";
import { compareBindingCoverage, isCommerceBinding, type BindingCoverage } from "../src/frameworkSchema/binding/commerceBindingSchema";

export async function installBindingFixture<
  P extends ApplicationNativeMutationPersistence,
>(
  fixture: ApplicationNativeMutationFixture<P>,
  target: FrameworkMigrationTarget,
  repository: FrameworkSchemaArtifactRepository,
  owner: "medusa" | "system",
) {
  const captured = await runEffect(
    captureRelationalSchemaArtifact({
      deploymentId: fixture.deploymentId,
      provenance: { kind: "synthetic", fixtureId: `binding-${owner}` },
      schema:
        owner === "medusa"
          ? { ...currencySchemaInput(), owner: "medusa" }
          : syntheticSchemaInput(),
    }),
  );
  await runEffect(
    admitFrameworkSchemaArtifactEffect(
      repository,
      Result.getOrThrow(
        prepareFrameworkSchemaArtifactAdmission(captured.artifact),
      ),
    ),
  );
  const ready = await runEffect(
    runFreshFrameworkMigrationCoordinatorEffect({
      target,
      artifactRepository: repository,
      artifactIdentity: captured.artifact.identity,
      attemptId: `binding-${owner}`,
      leaseOwnerId: "binding-test",
      leaseDurationMilliseconds: 120_000,
      lockTimeoutMilliseconds: 5_000,
      statementTimeoutMilliseconds: 30_000,
      maximumStepsPerRun: 16,
    }),
  );
  if (ready.kind !== "ready")
    throw new Error(`Binding installation incomplete: ${ready.kind}`);
  return ready.availability;
}
export function installationBindingReference(
  availability: RestoredFrameworkSchemaAvailabilityHead,
): InstallationBindingReference {
  return {
    installation: availability.installation.installation.frame.identity,
    installationReceiptSha256: availability.installation.installation.sha256,
    readinessSha256: availability.readiness.readiness.sha256,
    availabilitySequence: availability.head.frame.availabilitySequence,
    availabilityHistorySha256: availability.history.history.sha256,
    status: "ready",
  };
}
export function bindingProfiles(
  availability: RestoredFrameworkSchemaAvailabilityHead,
): readonly BindingProfileReference[] {
  const coverage =
    availability.readiness.readiness.frame.residualRequirements.map(
      (requirement) => {
        const physical =
          availability.readiness.readiness.frame.validatedPhysicalCapabilities.find(
            (value) =>
              value.identity.capabilityId ===
              requirement.capability.capabilityId,
          );
        if (physical === undefined)
          throw new Error("Missing physical fixture capability");
        return { requirement, physical };
      },
    );
  return testBindingProfiles(coverage);
}
export function testBindingProfiles(coverage: BindingCoverage): readonly BindingProfileReference[] {
  return [
    {
      kind: "adapter",
      profileId: "test-only-currency-adapter",
      contractSha256: "a".repeat(64),
      coverage: [],
    },
    {
      kind: "query",
      profileId: "test-only-currency-query",
      contractSha256: "b".repeat(64),
      coverage: coverage.filter(
        (value) => value.physical.kind === "searchableText",
      ),
    },
    {
      kind: "store",
      profileId: "test-only-currency-store",
      contractSha256: "c".repeat(64),
      coverage: coverage.filter(
        (value) => value.physical.kind !== "searchableText",
      ),
    },
  ];
}
export async function changeBindingAvailability<
  P extends ApplicationNativeMutationPersistence,
>(
  fixture: ApplicationNativeMutationFixture<P>,
  current: RestoredFrameworkSchemaAvailabilityHead,
  status: "ready" | "withdrawn" | "quarantined",
) {
  return fixture.target.drizzle.transaction((tx) =>
    runEffect(
      Effect.gen(function* () {
        const history = yield* captureFrameworkSchemaAvailabilityHistory({
          readiness: current.readiness.readiness,
          previous: current.history.history,
          status,
          reasonSha256: status === "ready" ? null : "f".repeat(64),
          recordedAt: new Date().toISOString(),
        });
        const stored =
          yield* appendFrameworkSchemaAvailabilityHistoryInTransactionEffect(
            tx,
            current.readiness,
            current.history,
            history,
          );
        const head = yield* captureFrameworkSchemaAvailabilityHead(
          stored.history,
        );
        return yield* compareAndSwapFrameworkSchemaAvailabilityHeadInTransactionEffect(
          tx,
          current,
          stored,
          head,
        );
      }),
    ),
  );
}

export async function exercisePhysicalBindings<
  P extends ApplicationNativeMutationPersistence,
>(
  fixture: ApplicationNativeMutationFixture<P>,
  target: FrameworkMigrationTarget,
  repository: FrameworkSchemaArtifactRepository,
  baseFrame: DataBindingSetFrame,
  previousHead: DataBindingHeadToken,
) {
  const input = bindingInput(fixture, target);
  const disabled = await runEffect(makeDataBindingHost(input));
  const syntheticHost = await runEffect(
    makeDataBindingHost({ ...input, testOnly: { syntheticSelection: true } }),
  );
  const system = await installBindingFixture(
    fixture,
    target,
    repository,
    "system",
  );
  const reference = installationBindingReference(system);
  expect(
    await runEffectFailure(
      disabled.withSynthetic(reference, readSyntheticTestSelection),
    ),
  ).toMatchObject({ reason: "invalidAuthority" });
  const token = await runEffect(
    syntheticHost.withSynthetic(reference, (selection) =>
      Effect.gen(function* () {
        const value = yield* readSyntheticTestSelection(selection);
        expect(value.reference).toEqual(reference);
        expect(value.authority.scopeId).toBe(baseFrame.application.scopeId);
        // SAFETY: intentional cross-family forgery must never acquire serving authority.
        expect(
          yield* readAdmittedDataBinding(
            selection as unknown as AdmittedDataBinding,
          ).pipe(Effect.result),
        ).toMatchObject({
          _tag: "Failure",
          failure: { reason: "invalidAuthority" },
        });
        return selection;
      }),
    ),
  );
  expect(
    await runEffectFailure(readSyntheticTestSelection(token)),
  ).toMatchObject({ reason: "invalidAuthority" });
  const availability = await installBindingFixture(
    fixture,
    target,
    repository,
    "medusa",
  );
  const profiles = bindingProfiles(availability);
  const registry = await runEffect(
    makeDataBindingTestProfiles(fixture.target.drizzle, target, profiles),
  );
  const host = await runEffect(
    makeDataBindingHost({
      ...input,
      testOnly: { profiles: registry, syntheticSelection: true },
    }),
  );
  const commerce: CommerceBinding = {
    ...installationBindingReference(availability),
    coverage: profiles.flatMap(value => value.coverage).sort(compareBindingCoverage),
    profiles: profiles.map(({ profileId, contractSha256 }) => ({ profileId, contractSha256 })),
  };
  const frame: DataBindingSetFrame = { ...baseFrame, commerce: [commerce] };
  expect(
    isStoredInstallationIdentity(commerce.installation),
    JSON.stringify(commerce.installation),
  ).toBe(true);
  expect(isCommerceBinding(commerce), JSON.stringify(commerce)).toBe(true);
  expect(isDataBindingSetFrame(frame)).toBe(true);
  expect(await runEffectFailure(disabled.prepare(frame))).toMatchObject({
    reason: "unsupportedProfile",
  });
  expect(
    await runEffectFailure(
      host.prepare({
        ...frame,
        commerce: [{
          ...commerce,
          coverage: [],
        }],
      }),
    ),
  ).toMatchObject({ reason: "unsupportedProfile" });
  const candidate = await runEffect(host.prepare(frame));
  const uncoveredProfiles = profiles.map((value) => ({
    ...value,
    coverage: [],
  }));
  const uncoveredRegistry = await runEffect(
    makeDataBindingTestProfiles(
      fixture.target.drizzle,
      target,
      uncoveredProfiles,
    ),
  );
  const uncoveredHost = await runEffect(
    makeDataBindingHost({
      ...input,
      testOnly: { profiles: uncoveredRegistry },
    }),
  );
  expect(
    await runEffectFailure(
      uncoveredHost.prepare({
        ...frame,
        commerce: [{ ...commerce, coverage: [] }],
      }),
    ),
  ).toMatchObject({ reason: "unsupportedProfile" });
  const request = dataBindingActivationRequest(
    frame.application.scopeId,
    frame.application.storageGeneration,
    "activate-commerce",
    candidate.sha256,
    previousHead,
  );
  const first = await runEffect(host.activate(request));
  expect(Result.getOrThrow(first.current).selected).toBe(true);
  const withdrawn = await changeBindingAvailability(
    fixture,
    availability,
    "withdrawn",
  );
  expect(
    await runEffectFailure(host.withCurrent(readAdmittedDataBinding)),
  ).toMatchObject({ reason: "unavailableInstallation" });
  expect((await runEffect(host.recover(request))).current).toMatchObject({
    _tag: "Failure",
    failure: { reason: "unavailableInstallation" },
  });
  const restored = await changeBindingAvailability(fixture, withdrawn, "ready");
  expect(
    await runEffectFailure(host.withCurrent(readAdmittedDataBinding)),
  ).toMatchObject({ reason: "unavailableInstallation" });
  const nextFrame: DataBindingSetFrame = {
    ...frame,
    commerce: [{ ...commerce, ...installationBindingReference(restored) }],
  };
  const next = await runEffect(host.prepare(nextFrame));
  const nextRequest = dataBindingActivationRequest(
    frame.application.scopeId,
    frame.application.storageGeneration,
    "reactivate-commerce",
    next.sha256,
    Result.getOrThrow(first.current).head,
  );
  const second = await runEffect(host.activate(nextRequest));
  expect(Result.getOrThrow(second.current).selected).toBe(true);
  const rollbackHost = await runEffect(
    makeDataBindingHost({
      ...input,
      testOnly: {
        profiles: registry,
        afterAcceptance: () => Effect.fail(bindingError("resourceFailure")),
      },
    }),
  );
  const failedRequest = {
    ...nextRequest,
    requestId: "commerce-atomic-rollback",
    expectedHead: Result.getOrThrow(second.current).head,
  };
  expect(
    await runEffectFailure(rollbackHost.activate(failedRequest)),
  ).toMatchObject({ reason: "resourceFailure" });
  expect(
    (await runEffect(host.withCurrent(readAdmittedDataBinding))).head,
  ).toEqual(Result.getOrThrow(second.current).head);
  const newRegistry = await runEffect(
    makeDataBindingTestProfiles(fixture.target.drizzle, target, profiles),
  );
  const coldHost = await runEffect(
    makeDataBindingHost({ ...input, testOnly: { profiles: newRegistry } }),
  );
  expect(
    (await runEffect(coldHost.withCurrent(readAdmittedDataBinding))).frame,
  ).toEqual(nextFrame);

  expect(
    await runEffectFailure(
      host.prepare({ ...nextFrame, commerce: [{ ...commerce, ...reference }] }),
    ),
  ).toMatchObject({ reason: "invalidInput" });
  const laneCondition = eq(
    fxSystemDataBindingPhysicalLanes.candidateSha256,
    next.sha256,
  );
  const laneRows = await fixture.target.drizzle
    .select()
    .from(fxSystemDataBindingPhysicalLanes)
    .where(laneCondition);
  expect(laneRows).toHaveLength(1);
  await fixture.target.drizzle
    .delete(fxSystemDataBindingPhysicalLanes)
    .where(laneCondition);
  expect(await runEffectFailure(host.prepare(nextFrame))).toMatchObject({
    reason: "storedCorruption",
  });
  expect(
    await fixture.target.drizzle
      .select()
      .from(fxSystemDataBindingPhysicalLanes)
      .where(laneCondition),
  ).toEqual([]);
  await fixture.target.drizzle
    .insert(fxSystemDataBindingPhysicalLanes)
    .values(laneRows);

  return {
    input,
    host,
    profiles: registry,
    availability: restored,
    frame: nextFrame,
    request: nextRequest,
    activation: second,
  };
}

export async function exerciseBindingAvailabilityLimit<
  P extends ApplicationNativeMutationPersistence,
  Failure,
>(
  fixture: ApplicationNativeMutationFixture<P>,
  host: DataBindingHost<Failure>,
  frame: DataBindingSetFrame,
  initial: RestoredFrameworkSchemaAvailabilityHead,
  expectedHead: DataBindingHeadToken,
) {
  const commerce = commerceBindings(frame)[0];
  if (commerce === undefined) throw new Error("Missing bounded commerce fixture");
  let history = initial;
  while (BigInt(history.head.frame.availabilitySequence) < 8n) {
    const nextSequence = BigInt(history.head.frame.availabilitySequence) + 1n;
    const status =
      nextSequence === 7n
        ? "quarantined"
        : nextSequence === 8n
          ? "ready"
          : history.head.frame.status === "ready"
            ? "withdrawn"
            : "ready";
    history = await changeBindingAvailability(fixture, history, status);
  }
  expect(history.head.frame.availabilitySequence).toBe("8");
  const atLimitFrame = {
    ...frame,
    commerce: [{ ...commerce, ...installationBindingReference(history) }],
  };
  const candidate = await runEffect(host.prepare(atLimitFrame));
  const request = dataBindingActivationRequest(
    frame.application.scopeId,
    frame.application.storageGeneration,
    "availability-at-limit",
    candidate.sha256,
    expectedHead,
  );
  const selected = await runEffect(host.activate(request));
  expect(Result.getOrThrow(selected.current).selected).toBe(true);
  expect(
    (await runEffect(host.withCurrent(readAdmittedDataBinding))).frame,
  ).toEqual(atLimitFrame);
  const ninth = await changeBindingAvailability(fixture, history, "withdrawn");
  expect(
    await runEffectFailure(host.withCurrent(readAdmittedDataBinding)),
  ).toMatchObject({ reason: "referenceRefusal" });
  const tenth = await changeBindingAvailability(fixture, ninth, "ready");
  expect(
    await runEffectFailure(
      host.prepare({
        ...frame,
        commerce: [{ ...commerce, ...installationBindingReference(tenth) }],
      }),
    ),
  ).toMatchObject({ reason: "referenceRefusal" });
  expect(
    await runEffectFailure(host.withCurrent(readAdmittedDataBinding)),
  ).toMatchObject({ reason: "referenceRefusal" });
  expect((await runEffect(host.recover(request))).current).toMatchObject({
    _tag: "Failure",
    failure: { reason: "referenceRefusal" },
  });
}
import { commerceBindings } from "../src/frameworkSchema/binding/model";
