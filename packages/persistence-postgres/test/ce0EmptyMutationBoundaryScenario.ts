import { expect } from "vitest";
import { Cause, Effect, Exit } from "effect";
import { and, eq } from "drizzle-orm";
import {
  LegacyV1StorageGenerationSchema,
  ScopeEpochSchema,
  StorageGenerationFenceSchema,
} from "flarex-protocol/storage-authority";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import {
  issueRelationalSession,
  runRelationalSession,
  type RelationalSession,
} from "../src/relationalTransaction/session";
import {
  RelationalSessionError,
  RelationalTransactionError,
} from "../src/relationalTransaction/model";
import { makeCmsHost } from "../src/cmsTransaction/host";
import { listAppSchemaVersionIndexBindingsEffect } from "../src/appIndexDefinitions";
import {
  fxControlIndexDefinitions,
  fxControlSchemaVersionIndexBindings,
  fxControlUniqueConstraintDefinitions,
  fxSystemScopeClocks,
  fxSystemIndexBuildStates,
  fxSystemUniqueConstraintBuilds,
  fxSystemIdempotency,
} from "../src/schema";
import { cmsExecutionMeasurementFixture } from "./cmsExecutionMeasurementFixture";
import { makeCe0CmsMutationReference } from "./ce0CmsMutationReference";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

type Fixture = Awaited<ReturnType<typeof cmsExecutionMeasurementFixture>>;

/** Real fixture metadata changes between preparation and accepting entry.
 * The decorator always delegates settlement to the existing physical session. */
export async function ce0EmptyMutationBoundaryScenario(
  tested: Fixture,
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  session: RelationalSession,
) {
  const other = await cmsExecutionMeasurementFixture(persistence, session);
  const reference = await runEffect(
    makeCe0CmsMutationReference(tested.input),
  );
  const otherReference = await runEffect(
    makeCe0CmsMutationReference(other.input),
  );
  const args = { count: 0, prefix: "same-input-in-distinct-scopes" };
  const key = tested.host.newRequestKey();
  const before = await tested.inventory();
  const otherBefore = await other.inventory();
  expect(tested.scope.scopeUuid).not.toBe(other.scope.scopeUuid);
  const first = await runEffect(tested.host.run(key, tested.insert, args));
  const after = await tested.verifyInsert(before, first, 0, args.prefix);
  expect(await other.inventory()).toEqual(otherBefore);
  const second = await runEffect(otherReference.run(key, args));
  expect(otherReference.executionCount()).toBe(1);
  const otherAfter = await other.verifyInsert(
    otherBefore,
    second,
    0,
    args.prefix,
  );
  expect(await tested.inventory()).toEqual(after);
  expect(await runEffect(reference.run(key, args))).toEqual([]);
  expect(reference.executionCount()).toBe(0);
  const otherCallbacks = other.executionCount();
  expect(await runEffect(other.host.run(key, other.insert, args))).toEqual([]);
  expect(other.executionCount()).toBe(otherCallbacks);

  // Damage only the second scope's outcome; its two readers must refuse while
  // both readers in the first scope continue authenticating their own result.
  const outcome = otherAfter.outcomes.find((row) => row.requestKey === key);
  if (outcome?.resultSha256 == null)
    throw new Error("Expected available scoped outcome");
  const slot = and(
    eq(fxSystemIdempotency.scopeUuid, other.scope.scopeUuid),
    eq(fxSystemIdempotency.requestKey, outcome.requestKey),
  );
  const damaged = new Uint8Array(outcome.resultSha256);
  damaged[0] = (damaged[0] ?? 0) ^ 1;
  await persistence.drizzle
    .update(fxSystemIdempotency)
    .set({ resultSha256: damaged })
    .where(slot);
  try {
    const corruptedOther = await other.inventory();
    expect(await runEffectFailure(otherReference.run(key, args))).toMatchObject(
      { reason: "storedCorruption" },
    );
    expect(
      await runEffectFailure(other.host.run(key, other.insert, args)),
    ).toMatchObject({ reason: "storedCorruption" });
    expect(await runEffect(reference.run(key, args))).toEqual([]);
    expect(await runEffect(tested.host.run(key, tested.insert, args))).toEqual(
      [],
    );
    expect(await tested.inventory()).toEqual(after);
    expect(await other.inventory()).toEqual(corruptedOther);
  } finally {
    await persistence.drizzle
      .update(fxSystemIdempotency)
      .set({ resultSha256: outcome.resultSha256 })
      .where(slot);
  }

  const clock = after.clock[0];
  if (clock === undefined) throw new Error("Expected scope clock");
  const clockSlot = eq(fxSystemScopeClocks.scopeId, clock.scopeId);
  const changes: {
    name: string;
    apply: () => Promise<unknown>;
    restore: () => Promise<unknown>;
  }[] = [
    {
      name: "generation",
      apply: () =>
        persistence.drizzle
          .update(fxSystemScopeClocks)
          .set({
            storageGeneration:
              LegacyV1StorageGenerationSchema.make("legacy_v1"),
          })
          .where(clockSlot),
      restore: () =>
        persistence.drizzle
          .update(fxSystemScopeClocks)
          .set({ storageGeneration: clock.storageGeneration })
          .where(clockSlot),
    },
    {
      name: "fence",
      apply: () =>
        persistence.drizzle
          .update(fxSystemScopeClocks)
          .set({
            storageGenerationFence: StorageGenerationFenceSchema.make(
              clock.storageGenerationFence + 1n,
            ),
          })
          .where(clockSlot),
      restore: () =>
        persistence.drizzle
          .update(fxSystemScopeClocks)
          .set({ storageGenerationFence: clock.storageGenerationFence })
          .where(clockSlot),
    },
    {
      name: "epoch",
      apply: () =>
        persistence.drizzle
          .update(fxSystemScopeClocks)
          .set({ epoch: ScopeEpochSchema.make(`epoch_${crypto.randomUUID()}`) })
          .where(clockSlot),
      restore: () =>
        persistence.drizzle
          .update(fxSystemScopeClocks)
          .set({ epoch: clock.epoch })
          .where(clockSlot),
    },
  ];
  const catalog = tested.fixture.control.drizzle;
  const bindingSlot = and(
    eq(
      fxControlSchemaVersionIndexBindings.deploymentId,
      tested.fixture.deploymentId,
    ),
    eq(
      fxControlSchemaVersionIndexBindings.schemaVersionId,
      tested.fixture.relation.binding.schemaVersionId,
    ),
  );
  const bindings = await catalog
    .select()
    .from(fxControlSchemaVersionIndexBindings)
    .where(bindingSlot);
  expect(bindings.length).toBeGreaterThan(0);
  const readBindings = (maximumBindings: number) =>
    listAppSchemaVersionIndexBindingsEffect(
      catalog,
      tested.fixture.deploymentId,
      tested.fixture.relation.binding.schemaVersionId,
      maximumBindings,
    );
  expect(await runEffect(readBindings(bindings.length))).toHaveLength(
    bindings.length,
  );
  expect(await runEffectFailure(readBindings(0))).toMatchObject({
    _tag: "AppIndexDefinitionCatalogCorruptionError",
    detail: "schema-version binding count exceeds the required maximum",
  });
  changes.push({
    name: "missing-ordered-bindings",
    apply: () =>
      catalog.delete(fxControlSchemaVersionIndexBindings).where(bindingSlot),
    restore: () =>
      catalog.insert(fxControlSchemaVersionIndexBindings).values(bindings),
  });
  const indexes = await catalog
    .select()
    .from(fxControlIndexDefinitions)
    .where(
      eq(fxControlIndexDefinitions.deploymentId, tested.fixture.deploymentId),
    );
  expect(indexes.length).toBeGreaterThan(0);
  for (const index of indexes) {
    const selected = and(
      eq(fxControlIndexDefinitions.deploymentId, index.deploymentId),
      eq(fxControlIndexDefinitions.indexDefinitionId, index.indexDefinitionId),
    );
    const corrupt = new Uint8Array(index.physicalSpecBytes);
    corrupt[0] = (corrupt[0] ?? 0) ^ 1;
    changes.push({
      name: `ordered-definition-${index.indexDefinitionId}`,
      apply: () =>
        catalog
          .update(fxControlIndexDefinitions)
          .set({ physicalSpecBytes: corrupt })
          .where(selected),
      restore: () =>
        catalog
          .update(fxControlIndexDefinitions)
          .set({ physicalSpecBytes: index.physicalSpecBytes })
          .where(selected),
    });
  }
  const unique = await catalog
    .select()
    .from(fxControlUniqueConstraintDefinitions)
    .where(
      eq(
        fxControlUniqueConstraintDefinitions.deploymentId,
        tested.fixture.deploymentId,
      ),
    );
  expect(unique.length).toBeGreaterThan(0);
  for (const definition of unique) {
    const selected = and(
      eq(
        fxControlUniqueConstraintDefinitions.deploymentId,
        definition.deploymentId,
      ),
      eq(
        fxControlUniqueConstraintDefinitions.uniqueConstraintDefinitionId,
        definition.uniqueConstraintDefinitionId,
      ),
    );
    const corrupt = new Uint8Array(definition.physicalSpecBytes);
    corrupt[0] = (corrupt[0] ?? 0) ^ 1;
    changes.push({
      name: `unique-definition-${definition.uniqueConstraintDefinitionId}`,
      apply: () =>
        catalog
          .update(fxControlUniqueConstraintDefinitions)
          .set({ physicalSpecBytes: corrupt })
          .where(selected),
      restore: () =>
        catalog
          .update(fxControlUniqueConstraintDefinitions)
          .set({ physicalSpecBytes: definition.physicalSpecBytes })
          .where(selected),
    });
  }
  for (const build of after.builds) {
    const selected = and(
      eq(fxSystemIndexBuildStates.scopeId, build.scopeId),
      eq(fxSystemIndexBuildStates.indexDefinitionId, build.indexDefinitionId),
    );
    changes.push({
      name: `retiring-ordered-build-${build.indexDefinitionId}`,
      apply: () =>
        persistence.drizzle
          .update(fxSystemIndexBuildStates)
          .set({
            lifecycle: "retiring",
            maintenanceBytes: null,
            maintenanceSha256: null,
            maintenanceActivationSequence: null,
          })
          .where(selected),
      restore: () =>
        persistence.drizzle
          .update(fxSystemIndexBuildStates)
          .set({
            lifecycle: build.lifecycle,
            maintenanceBytes: build.maintenanceBytes,
            maintenanceSha256: build.maintenanceSha256,
            maintenanceActivationSequence: build.maintenanceActivationSequence,
          })
          .where(selected),
    });
  }
  for (const build of after.uniqueBuilds) {
    const selected = and(
      eq(fxSystemUniqueConstraintBuilds.scopeId, build.scopeId),
      eq(
        fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId,
        build.uniqueConstraintDefinitionId,
      ),
    );
    changes.push({
      name: `uncertified-unique-build-${build.uniqueConstraintDefinitionId}`,
      apply: () =>
        persistence.drizzle
          .update(fxSystemUniqueConstraintBuilds)
          .set({
            maintenanceBytes: null,
            maintenanceSha256: null,
            maintenanceActivationSequence: null,
          })
          .where(selected),
      restore: () =>
        persistence.drizzle
          .update(fxSystemUniqueConstraintBuilds)
          .set({
            maintenanceBytes: build.maintenanceBytes,
            maintenanceSha256: build.maintenanceSha256,
            maintenanceActivationSequence: build.maintenanceActivationSequence,
          })
          .where(selected),
    });
  }

  for (const change of changes)
    for (const implementation of ["core", "reference"] as const)
      for (const request of ["fresh", "replay"] as const) {
        const stable = await tested.inventory();
        let injected = 0;
        let changed: Awaited<ReturnType<typeof tested.inventory>> | undefined;
        const staleSession = issueRelationalSession(
          persistence.drizzle,
          (profile, work) =>
            Effect.gen(function* () {
              yield* Effect.promise(async () => {
                await change.apply();
                changed = await tested.inventory();
                injected++;
              });
              return yield* runRelationalSession(session, profile, work).pipe(
                Effect.mapError((error) =>
                  error instanceof RelationalTransactionError
                    ? new RelationalSessionError({
                        reason: "resourceFailure",
                        cause: error,
                      })
                    : error,
                ),
              );
            }),
        );
        const core = await runEffect(
          makeCmsHost({ ...tested.input, session: staleSession }),
        );
        const ref = await runEffect(
          makeCe0CmsMutationReference({
            ...tested.input,
            session: staleSession,
          }),
        );
        const callbacks = tested.executionCount();
        try {
          const requestKey =
            request === "fresh" ? tested.host.newRequestKey() : key;
          const result = await runEffect(
            Effect.exit(
              implementation === "core"
                ? core.run(requestKey, tested.insert, args)
                : ref.run(requestKey, args),
            ),
          );
          const label = `${change.name}/${implementation}/${request}${Exit.isFailure(result) ? `: ${Cause.pretty(result.cause)}` : ""}`;
          expect(Exit.isFailure(result), label).toBe(true);
          if (Exit.isFailure(result)) {
            expect(result.cause.reasons, label).toHaveLength(1);
            expect(
              result.cause.reasons
                .filter(Cause.isFailReason)
                .map((reason) => reason.error),
              label,
            ).toMatchObject([{ reason: "invalidAuthority" }]);
          }
          expect(injected).toBe(1);
          expect(changed).toBeDefined();
          expect(await tested.inventory()).toEqual(changed);
          expect(await other.inventory()).toEqual(otherAfter);
          expect(tested.executionCount()).toBe(callbacks);
          expect(ref.executionCount()).toBe(0);
        } finally {
          await change.restore();
        }
        expect(await tested.inventory()).toEqual(stable);
      }
  return { other, otherReference };
}
