import { webcrypto } from "node:crypto";
import { eq } from "drizzle-orm";
import { Effect, Result } from "effect";
import { CommitSeqSchema } from "flarex-protocol/storage-authority";
import { beforeAll, describe, expect, it } from "vitest";
import { useFileScopedPersistence } from "../../support/fileScopedPersistenceFixture";
import {
  makeApplicationReadinessRepository,
} from "../../../src/application/readiness/repository";
import {
  makeApplicationActivationRepository,
} from "../../../src/application/activation/repository";
import {
  fxSystemApplicationActiveHeads,
  fxSystemApplicationActivations,
} from "../../../src/application/applicationActivationSchema";
import { runEffect } from "../../support/effectTestRuntime";
import {
  fxSystemIndexBuildStates,
  fxSystemIndexMaintenanceObligations,
  fxSystemScopeClocks,
} from "../../../src/database/schema";
import {
  createFileScopedReadinessControlFixture,
  createFileScopedReadinessTargetFixture,
  readinessFixture,
} from "../support/readinessFixture";
import { prepareReadinessAuthorities, enablePhysicalBuilds } from "../support/readinessPreparation";
import { scalarCount } from "../support/readinessEvidence";

beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
});

describe("Application readiness/physicalCoverage", { timeout: 30_000, concurrent: false }, () => {
  const withControl = useFileScopedPersistence(createFileScopedReadinessControlFixture, false);
  const withTarget = useFileScopedPersistence(createFileScopedReadinessTargetFixture, false);

  it("rejects a structurally copied physical lifecycle capability", async () => {
    return withControl(async control => {
      return withTarget(async ({ persistence }) => {
        const fixture = await readinessFixture(control, persistence);
        const repository = makeApplicationReadinessRepository(Object.freeze({
          ...fixture.readinessContext,
          physicalDefinitionLifecycle: Object.freeze({
            ...fixture.physicalDefinitionLifecycle,
          }),
        }));

        const result = await runEffect(Effect.result(
          repository.settle(fixture.input),
        ));

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure).toMatchObject({ reason: "invalidComposition" });
        }
        expect(await scalarCount(
          fixture.control,
          "fx_control_application_schema_authority_v1",
        )).toBe(0);
      });
    });
  })

  it("requires the existing physical-build owner for a table-bearing schema", async () => {
    return withControl(async control => {
      return withTarget(async ({ persistence }) => {
        const fixture = await readinessFixture(control, persistence, { includeTable: true });
        await prepareReadinessAuthorities(fixture);

        const result = await runEffect(fixture.repository.settle(fixture.input));

        expect(result).toMatchObject({
          status: "not_ready",
          reason: "physicalBuildMissing",
        });
        expect(fixture.materializationCount()).toBe(0);
        expect(await scalarCount(
          fixture.target,
          "fx_system_application_readiness_v1",
        )).toBe(0);
      });
    });
  })

  it("settles a table-bearing schema only after the real physical build enables", async () => {
    return withControl(async control => {
      const targetFixture = await createFileScopedReadinessTargetFixture();
      try {
        const persistence = targetFixture.persistence.persistence;
        const fixture = await readinessFixture(control, persistence, { includeTable: true });
        const schemaVersionId = await prepareReadinessAuthorities(fixture);
        await enablePhysicalBuilds(fixture, schemaVersionId);

        const first = await runEffect(fixture.repository.settle(fixture.input));
        const replay = await runEffect(fixture.repository.settle(fixture.input));

        expect(first).toMatchObject({
          status: "ready",
          disposition: "inserted",
          schemaVersionId,
        });
        expect(replay).toMatchObject({ ...first, disposition: "replayed" });
        expect(fixture.materializationCount()).toBe(1);
        expect(await scalarCount(
          fixture.target,
          "fx_system_application_readiness_v1",
        )).toBe(1);
      } finally {
        await targetFixture.dispose();
      }
    });
  })

  it("binds immutable first-readable authority across bounded and continuous coverage", async () => {
    return withControl(async control => {
      const targetFixture = await createFileScopedReadinessTargetFixture();
      try {
        const persistence = targetFixture.persistence.persistence;
        const fixture = await readinessFixture(control, persistence, { includeTable: true });
        const schemaVersionId = await prepareReadinessAuthorities(fixture);
        await enablePhysicalBuilds(fixture, schemaVersionId);
        const ready = await runEffect(fixture.repository.settle(fixture.input));
        if (ready.status !== "ready") throw new Error("Expected physical readiness");
        // A candidate can seal a later complete prefix without changing readiness.
        // Once active, its certificate owns coverage and build progress stays fixed.
        await fixture.target.drizzle.update(fxSystemScopeClocks).set({ lastCommitSeq: CommitSeqSchema.make(1n) })
          .where(eq(fxSystemScopeClocks.scopeId, fixture.authority.scopeId));
        await fixture.target.drizzle.update(fxSystemIndexBuildStates).set({ coveredThroughCommitSeq: CommitSeqSchema.make(1n) })
          .where(eq(fxSystemIndexBuildStates.scopeId, fixture.authority.scopeId));
        expect(await runEffect(fixture.repository.readReady(fixture.input))).toMatchObject({
          status: "ready", readinessSha256: ready.readinessSha256,
        });
        const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" },
          deploymentId: fixture.input.deploymentId,
          scopeId: fixture.input.scopeId, readiness: fixture.repository, authority: fixture.authorityPorts,
        });
        await runEffect(activation.activate({ revisionId: fixture.input.revisionId, expectedActiveHead: null }));
        const before = await runEffect(activation.readActive());
        const builds = await fixture.target.drizzle.select().from(fxSystemIndexBuildStates);
        // No table writes: only the scope advances beyond the certificate opening.
        await fixture.target.drizzle.update(fxSystemScopeClocks).set({ lastCommitSeq: CommitSeqSchema.make(2n) })
          .where(eq(fxSystemScopeClocks.scopeId, fixture.authority.scopeId));
        const advanced = await runEffect(activation.readActive());
        expect(advanced.basis).toEqual({
          ...before.basis,
          authority: {
            ...before.basis.authority,
            lastCommitSeq: before.basis.authority.lastCommitSeq + 1n,
          },
        });
        expect(advanced.expectedActiveHead).toEqual(before.expectedActiveHead);
        expect(await fixture.target.drizzle.select().from(fxSystemIndexBuildStates)).toEqual(builds);
        const inventory = async () => ({
          builds: await fixture.target.drizzle.select().from(fxSystemIndexBuildStates)
            .orderBy(fxSystemIndexBuildStates.indexDefinitionId),
          openings: await fixture.target.drizzle.select().from(fxSystemIndexMaintenanceObligations)
            .orderBy(fxSystemIndexMaintenanceObligations.indexDefinitionId, fxSystemIndexMaintenanceObligations.activationSequence),
          heads: await fixture.target.drizzle.select().from(fxSystemApplicationActiveHeads),
          activations: await fixture.target.drizzle.select().from(fxSystemApplicationActivations)
            .orderBy(fxSystemApplicationActivations.activationSequence),
          clocks: await fixture.target.drizzle.select().from(fxSystemScopeClocks),
        });
        const beforeRefusal = await inventory();
        await expect(fixture.target.drizzle.update(fxSystemIndexBuildStates).set({ firstReadableCommitSeq: CommitSeqSchema.make(1n) })
          .where(eq(fxSystemIndexBuildStates.scopeId, fixture.authority.scopeId)))
          .rejects.toMatchObject({ cause: { code: "23503", constraint: "fx_index_build_maintenance_opening_fk" } });
        expect(await inventory()).toEqual(beforeRefusal);
        expect((await runEffect(activation.readActive())).expectedActiveHead).toEqual(advanced.expectedActiveHead);
      } finally {
        await targetFixture.dispose();
      }
    });
  })

  it("fails closed when enabled physical evidence starts after the scope frontier", async () => {
    return withControl(async control => {
      const targetFixture = await createFileScopedReadinessTargetFixture();
      try {
        const persistence = targetFixture.persistence.persistence;
        const fixture = await readinessFixture(control, persistence, { includeTable: true });
        const schemaVersionId = await prepareReadinessAuthorities(fixture);
        await enablePhysicalBuilds(fixture, schemaVersionId);
        const clock = await fixture.target.getScopeClock(fixture.authority.scopeId);
        if (clock === null) throw new Error("Expected Application readiness clock.");
        await fixture.target.query(
          `update fx_system_index_build_state
          set start_commit_seq = $1
        where scope_id = $2`,
          [clock.lastCommitSeq + 1n, fixture.authority.scopeId],
        );

        const result = await runEffect(Effect.result(
          fixture.repository.settle(fixture.input),
        ));

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure).toMatchObject({ reason: "storedState" });
        }
        expect(fixture.materializationCount()).toBe(0);
        expect(await scalarCount(
          fixture.target,
          "fx_system_application_readiness_v1",
        )).toBe(0);
      } finally {
        await targetFixture.dispose();
      }
    });
  })

  it("rejects a scope-fence change during cold proof without committing", async () => {
    return withControl(async control => {
      return withTarget(async ({ persistence }) => {
        const fixture = await readinessFixture(control, persistence, { coldMode: "advanceAuthority" });
        await prepareReadinessAuthorities(fixture);

        const result = await runEffect(Effect.result(
          fixture.repository.settle(fixture.input),
        ));

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure).toMatchObject({ reason: "authorityChanged" });
        }
        expect(fixture.materializationCount()).toBe(1);
        expect(await scalarCount(
          fixture.target,
          "fx_system_application_readiness_v1",
        )).toBe(0);
      });
    });
  })
});
