import { Effect, Result } from "effect";
import { expect, vi } from "vitest";
import { makeFrameworkInstaller } from "../src/migrationCoordination/installer";
import type { RunFreshFrameworkMigrationCoordinatorInput, RunAdditiveFrameworkMigrationCoordinatorInput } from "../src/migrationCoordination/coordinatorContracts";
import * as artifactRead from "../src/frameworkSchema/artifact/read";
import * as structuralRunner from "../src/migrationCoordination/relationalStructuralRunner";
import * as coordinator from "../src/migrationCoordination/freshCoordinator";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

export function installerFixture(input: RunFreshFrameworkMigrationCoordinatorInput, maximumStepsPerCall = 128) {
  return Result.getOrThrow(makeFrameworkInstaller({ target: input.target, artifactRepository: input.artifactRepository,
    policy: { leaseDurationMilliseconds: input.leaseDurationMilliseconds, lockTimeoutMilliseconds: input.lockTimeoutMilliseconds,
      statementTimeoutMilliseconds: input.statementTimeoutMilliseconds, runTimeoutMilliseconds: 120_000, maximumStepsPerCall } }));
}

export async function assertInstallerResume(input: RunFreshFrameworkMigrationCoordinatorInput) {
  const artifact = vi.spyOn(artifactRead, "getFrameworkSchemaArtifactEffect");
  const preparation = vi.spyOn(structuralRunner, "issueRelationalStructuralRunnerTokenEffect");
  try {
    const installer = installerFixture(input, 2);
    expect(artifact).not.toHaveBeenCalled();
    expect(preparation).not.toHaveBeenCalled();
    for (const maximumStepsPerCall of [0, 129, Number.NaN]) {
      expect(() => installerFixture(input, maximumStepsPerCall)).toThrow();
    }
    expect(Object.keys(installer).sort()).toEqual(["installAdditive", "installFresh"]);
    const partial = await runEffect(installer.installFresh(input));
    expect(partial).toEqual({ kind: "pending", completedStepCount: 2, requiredStepCount: 7 });
    expect(preparation).toHaveBeenCalledTimes(1);
    expect(await runEffect(installer.installFresh({ ...input, attemptId: "other-attempt", leaseOwnerId: "other-worker" })))
      .toMatchObject({ kind: "busy", attemptId: input.attemptId, leaseOwnerId: input.leaseOwnerId });
    expect(await runEffect(installer.installFresh(input)))
      .toEqual({ kind: "pending", completedStepCount: 4, requiredStepCount: 7 });
    expect(await runEffect(installer.installFresh(input)))
      .toEqual({ kind: "pending", completedStepCount: 6, requiredStepCount: 7 });
    expect(await runEffect(installer.installFresh(input))).toMatchObject({ kind: "ready", replayed: false });
    expect(await runEffect(installer.installFresh(input))).toMatchObject({ kind: "ready", replayed: true });
    expect(preparation).toHaveBeenCalledTimes(6);
    // A missing additive base must never dispatch a fresh installation.
    expect(await runEffectFailure(installer.installAdditive({ ...input,
      // @ts-expect-error deliberately invalid runtime request
      baseInstallation: undefined }))).toMatchObject({ reason: "invalidInput" });
  } finally { artifact.mockRestore(); preparation.mockRestore(); }
}

export async function assertInstallerDeadline(input: RunFreshFrameworkMigrationCoordinatorInput) {
  const pending = await runEffect(coordinator.runFreshFrameworkMigrationCoordinatorEffect({ ...input, maximumStepsPerRun: 1 }));
  if (pending.kind !== "pending") throw new Error("Expected initial durable prefix");
  // Delay a continuation after a real committed prefix. The first batch result
  // is supplied once so this witness isolates the installer's total deadline.
  const initial = vi.spyOn(coordinator, "runFreshFrameworkMigrationCoordinatorEffect").mockReturnValueOnce(Effect.succeed(pending));
  let released = false;
  const continuation = vi.spyOn(coordinator, "advanceFrameworkMigrationClaimBatchEffect")
    .mockReturnValueOnce(Effect.never.pipe(Effect.ensuring(Effect.sync(() => { released = true; }))));
  try {
    const installer = Result.getOrThrow(makeFrameworkInstaller({ target: input.target, artifactRepository: input.artifactRepository,
      policy: { leaseDurationMilliseconds: input.leaseDurationMilliseconds, lockTimeoutMilliseconds: input.lockTimeoutMilliseconds,
        statementTimeoutMilliseconds: input.statementTimeoutMilliseconds, runTimeoutMilliseconds: 25, maximumStepsPerCall: 128 } }));
    expect(await runEffectFailure(installer.installFresh(input))).toMatchObject({ reason: "resourceFailure",
      message: "Framework installation deadline expired; resume from durable state" });
    expect(continuation).toHaveBeenCalledTimes(1);
    expect(released).toBe(true);
  } finally { initial.mockRestore(); continuation.mockRestore(); }
  expect(await runEffect(installerFixture(input).installFresh(input))).toMatchObject({ kind: "ready" });
}

export async function assertAdditiveInstaller(input: RunAdditiveFrameworkMigrationCoordinatorInput) {
  const installer = installerFixture(input, 2);
  const pending = await runEffect(installer.installAdditive(input));
  expect(pending).toMatchObject({ kind: "pending", completedStepCount: 2 });
  expect(pending).not.toHaveProperty("claim");
  expect(await runEffect(installerFixture(input).installAdditive(input))).toMatchObject({ kind: "ready", replayed: false });
  expect(await runEffect(installer.installAdditive(input))).toMatchObject({ kind: "ready", replayed: true });
}
