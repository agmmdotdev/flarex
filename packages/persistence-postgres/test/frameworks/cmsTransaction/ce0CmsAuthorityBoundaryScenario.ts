import { fxSystemScopeExecutionAuthorities } from "../../../src/database/schema";
import { expect } from "vitest";
import { Cause, Effect, Exit } from "effect";
import { and, eq } from "drizzle-orm";
import {
  LegacyV1StorageGenerationSchema,
  ScopeEpochSchema,
  StorageGenerationFenceSchema,
} from "flarex-protocol/storage-authority";
import type { PGliteFlarexPersistence } from "../../../src/database/pglite";
import type { PostgresFlarexPersistence } from "../../../src/database/postgres";
import {
  issueRelationalSession,
  runRelationalSession,
  type RelationalSession,
} from "../../../src/database/relationalTransaction/session";
import {
  RelationalSessionError,
  RelationalTransactionError,
} from "../../../src/database/relationalTransaction/model";
import { makeCmsHost } from "../../../src/frameworks/cmsTransaction/host";
import { fxSystemDataBindingHeads } from "../../../src/installation/frameworkSchema/binding/schema";
import { listAppSchemaVersionIndexBindingsEffect } from "../../../src/storage/indexes/appIndexDefinitions";
import {
  fxControlIndexDefinitions,
  fxControlSchemaVersionIndexBindings,
  fxControlUniqueConstraintDefinitions,
  fxSystemIndexBuildStates,
  fxSystemUniqueConstraintBuilds,
  fxSystemIdempotency,
} from "../../../src/database/schema";
import { cmsExecutionMeasurementFixture } from "./cmsExecutionMeasurementFixture";
import { makeCe0CmsMutationReference } from "./ce0CmsMutationReference";
import { makeCe0CmsReadReference } from "./ce0CmsReadReference";
import { decodeReadDocuments } from "./ce0CmsReadReferenceScenario";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";

type Fixture = Awaited<ReturnType<typeof cmsExecutionMeasurementFixture>>;

/** Real fixture metadata changes between preparation and accepting entry.
 * The decorator always delegates settlement to the existing physical session. */
export async function ce0CmsAuthorityBoundaryScenario(
  tested: Fixture,
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  session: RelationalSession,
) {
  const other = await cmsExecutionMeasurementFixture(persistence, session, undefined,
    { controlPersistence: tested.fixture.control });
  const reference = await runEffect(makeCe0CmsMutationReference(tested.input));
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

  const insertArgs = { count: 8, prefix: "authority-eight" };
  const insertKey = tested.host.newRequestKey();
  const beforeInsert = await tested.inventory();
  const inserted = await runEffect(
    tested.host.run(insertKey, tested.insert, insertArgs),
  );
  const afterInsert = await tested.verifyInsert(
    beforeInsert,
    inserted,
    8,
    insertArgs.prefix,
  );
  const ids = decodeReadDocuments(inserted).map((document) => document._id);
  const readReference = await runEffect(makeCe0CmsReadReference(tested.input));
  expect(await runEffect(readReference.read(ids))).toEqual(inserted);
  expect(await tested.inventory()).toEqual(afterInsert);

  const clock = afterInsert.clock[0];
  if (clock === undefined) throw new Error("Expected scope clock");
  const clockSlot = eq(fxSystemScopeExecutionAuthorities.scopeId, clock.scopeId);
  const changes: {
    name: string;
    reason: "invalidAuthority" | "bindingChanged";
    apply: () => Promise<unknown>;
    restore: () => Promise<unknown>;
  }[] = [
    {
      name: "generation",
      reason: "invalidAuthority",
      apply: () =>
        persistence.drizzle
          .update(fxSystemScopeExecutionAuthorities)
          .set({
            storageGeneration:
              LegacyV1StorageGenerationSchema.make("legacy_v1"),
          })
          .where(clockSlot),
      restore: () =>
        persistence.drizzle
          .update(fxSystemScopeExecutionAuthorities)
          .set({ storageGeneration: clock.storageGeneration })
          .where(clockSlot),
    },
    {
      name: "fence",
      reason: "invalidAuthority",
      apply: () =>
        persistence.drizzle
          .update(fxSystemScopeExecutionAuthorities)
          .set({
            storageGenerationFence: StorageGenerationFenceSchema.make(
              clock.storageGenerationFence + 1n,
            ),
          })
          .where(clockSlot),
      restore: () =>
        persistence.drizzle
          .update(fxSystemScopeExecutionAuthorities)
          .set({ storageGenerationFence: clock.storageGenerationFence })
          .where(clockSlot),
    },
    {
      name: "epoch",
      reason: "invalidAuthority",
      apply: () =>
        persistence.drizzle
          .update(fxSystemScopeExecutionAuthorities)
          .set({ epoch: ScopeEpochSchema.make(`epoch_${crypto.randomUUID()}`) })
          .where(clockSlot),
      restore: () =>
        persistence.drizzle
          .update(fxSystemScopeExecutionAuthorities)
          .set({ epoch: clock.epoch })
          .where(clockSlot),
    },
  ];
  const headSlot = eq(
    fxSystemDataBindingHeads.scopeId,
    tested.fixture.authority.scopeId,
  );
  const heads = await persistence.drizzle
    .select()
    .from(fxSystemDataBindingHeads)
    .where(headSlot);
  const head = heads[0];
  if (head === undefined || heads.length !== 1)
    throw new Error("Expected one active binding head");
  const damagedHead = new Uint8Array(head.canonicalBytes);
  damagedHead[0] = (damagedHead[0] ?? 0) ^ 1;
  changes.push(
    {
      name: "missing-active-binding",
      reason: "bindingChanged",
      apply: () =>
        persistence.drizzle.delete(fxSystemDataBindingHeads).where(headSlot),
      restore: () =>
        persistence.drizzle.insert(fxSystemDataBindingHeads).values(head),
    },
    {
      name: "damaged-active-binding",
      reason: "invalidAuthority",
      apply: () =>
        persistence.drizzle
          .update(fxSystemDataBindingHeads)
          .set({ canonicalBytes: damagedHead })
          .where(headSlot),
      restore: () =>
        persistence.drizzle
          .update(fxSystemDataBindingHeads)
          .set({ canonicalBytes: head.canonicalBytes })
          .where(headSlot),
    },
  );
  const inspect = async () => ({
    data: await tested.inventory(),
    heads: await persistence.drizzle
      .select()
      .from(fxSystemDataBindingHeads)
      .where(headSlot),
  });
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
    reason: "invalidAuthority",
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
      reason: "invalidAuthority",
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
      reason: "invalidAuthority",
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
  for (const build of afterInsert.builds) {
    const selected = and(
      eq(fxSystemIndexBuildStates.scopeId, build.scopeId),
      eq(fxSystemIndexBuildStates.indexDefinitionId, build.indexDefinitionId),
    );
    changes.push({
      name: `retiring-ordered-build-${build.indexDefinitionId}`,
      reason: "invalidAuthority",
      apply: () =>
        persistence.drizzle
          .update(fxSystemIndexBuildStates)
          .set({
            lifecycle: "retiring",
            maintenanceAuthorityKind: null,
            maintenanceActivationSequence: null,
          })
          .where(selected),
      restore: () =>
        persistence.drizzle
          .update(fxSystemIndexBuildStates)
          .set({
            lifecycle: build.lifecycle,
            maintenanceAuthorityKind: build.maintenanceAuthorityKind,
            maintenanceActivationSequence: build.maintenanceActivationSequence,
          })
          .where(selected),
    });
  }
  for (const build of afterInsert.uniqueBuilds) {
    const selected = and(
      eq(fxSystemUniqueConstraintBuilds.scopeId, build.scopeId),
      eq(
        fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId,
        build.uniqueConstraintDefinitionId,
      ),
    );
    changes.push({
      name: `uncertified-unique-build-${build.uniqueConstraintDefinitionId}`,
      reason: "invalidAuthority",
      apply: () =>
        persistence.drizzle
          .update(fxSystemUniqueConstraintBuilds)
          .set({
            maintenanceAuthorityKind: null,
            maintenanceActivationSequence: null,
          })
          .where(selected),
      restore: () =>
        persistence.drizzle
          .update(fxSystemUniqueConstraintBuilds)
          .set({
            maintenanceAuthorityKind: build.maintenanceAuthorityKind,
            maintenanceActivationSequence: build.maintenanceActivationSequence,
          })
          .where(selected),
    });
  }

  for (const change of changes)
    for (const implementation of ["core", "reference"] as const)
      for (const request of [
        "fresh-empty",
        "replay-empty",
        "fresh-insert",
        "replay-insert",
        "empty-read",
        "point-read",
      ] as const) {
        const stable = await inspect();
        let injected = 0;
        let changed: Awaited<ReturnType<typeof inspect>> | undefined;
        const staleSession = issueRelationalSession(
          persistence.drizzle,
          (profile, work) =>
            Effect.gen(function* () {
              yield* Effect.promise(async () => {
                await change.apply();
                changed = await inspect();
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
        const readRef = await runEffect(
          makeCe0CmsReadReference({ ...tested.input, session: staleSession }),
        );
        const callbacks = tested.executionCount();
        const readCallbacks = tested.readExecutionCount();
        try {
          const execute = () => {
            if (request === "empty-read" || request === "point-read") {
              const readIds = request === "empty-read" ? [] : ids;
              return implementation === "core"
                ? core.read(tested.read, readIds)
                : readRef.read(readIds);
            }
            const nonempty =
              request === "fresh-insert" || request === "replay-insert";
            const requestArgs = nonempty ? insertArgs : args;
            const requestKey =
              request === "replay-insert"
                ? insertKey
                : request === "replay-empty"
                  ? key
                  : tested.host.newRequestKey();
            return implementation === "core"
              ? core.run(requestKey, tested.insert, requestArgs)
              : ref.run(requestKey, requestArgs);
          };
          const result = await runEffect(Effect.exit(execute()));
          const label = `${change.name}/${implementation}/${request}${Exit.isFailure(result) ? `: ${Cause.pretty(result.cause)}` : ""}`;
          expect(Exit.isFailure(result), label).toBe(true);
          if (Exit.isFailure(result)) {
            expect(result.cause.reasons, label).toHaveLength(1);
            expect(
              result.cause.reasons
                .filter(Cause.isFailReason)
                .map((reason) => reason.error),
              label,
            ).toMatchObject([{ reason: change.reason }]);
          }
          expect(injected).toBe(1);
          expect(changed).toBeDefined();
          expect(await inspect()).toEqual(changed);
          expect(await other.inventory()).toEqual(otherAfter);
          expect(tested.executionCount()).toBe(callbacks);
          expect(tested.readExecutionCount()).toBe(readCallbacks);
          expect(ref.executionCount()).toBe(0);
          expect(readRef.executionCount()).toBe(0);
        } finally {
          try {
            await change.restore();
          } finally {
            await runEffect(Effect.all([core.close, ref.close, readRef.close], { discard: true }));
          }
        }
        expect(await inspect()).toEqual(stable);
      }
  return { other, otherReference };
}
