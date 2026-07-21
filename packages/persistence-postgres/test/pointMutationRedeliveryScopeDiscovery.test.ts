import {
  replacementScopeIdV1FromUuid,
  type ReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import {
  MAX_POINT_MUTATION_REDELIVERY_SCOPE_DISCOVERY_LIMIT_V1,
  PointMutationRedeliveryScopeDiscoveryCorruptionV1Error,
  PointMutationRedeliveryScopeDiscoveryInputV1Error,
  PointMutationRedeliveryScopeDiscoverySqlV1Error,
  createPointMutationRedeliveryScopeDiscoveryV1,
} from "@flarex/persistence-postgres/point-mutation-redelivery-scope-discovery";
import {
  createPGlitePersistence,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import type { SharedDatabaseScopePhysicalLocator } from
  "../src/scopeMetadataTypes";
import * as persistencePackage from "../src";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const sharedLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "redelivery-scope-directory-primary",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

describe("O08-B2b2b2b1b2b1 inert redelivery scope discovery", () => {
  it("returns one frozen empty page without writing control state", async () => {
    const persistence = await scopeDirectoryPersistence();
    const before = await scopeCount(persistence);
    const page = await runEffect(
      discovery(persistence).discoverEffect({ limit: 1 }),
    );
    expect(page).toEqual({ candidates: [], continuation: null });
    expect(Object.isFrozen(page)).toBe(true);
    expect(Object.isFrozen(page.candidates)).toBe(true);
    await expect(scopeCount(persistence)).resolves.toBe(before);
  });

  it("returns only frozen inert replacement-scope locators", async () => {
    const persistence = await scopeDirectoryPersistence();
    const first = scopeIdAt(1);
    const second = scopeIdAt(2);
    await insertScope(persistence, second);
    await insertScope(persistence, first);

    const before = await scopeCount(persistence);
    const repository = discovery(persistence);
    const page = await runEffect(repository.discoverEffect({ limit: 1 }));

    expect(page.candidates).toEqual([
      { deploymentId: deploymentIdFor(first), scopeId: first },
    ]);
    expect(page.continuation).not.toBeNull();
    const next = await runEffect(repository.discoverEffect({
      limit: 1,
      continuation: page.continuation,
    }));
    expect(next).toEqual({
      candidates: [
        { deploymentId: deploymentIdFor(second), scopeId: second },
      ],
      continuation: null,
    });
    await expect(scopeCount(persistence)).resolves.toBe(before);
    expect(Object.isFrozen(page)).toBe(true);
    expect(Object.isFrozen(page.candidates)).toBe(true);
    expect(Object.isFrozen(page.candidates[0])).toBe(true);
    expect(page.candidates[0]).not.toHaveProperty("physicalLocator");
    expect(page.candidates[0]).not.toHaveProperty("activeSchemaVersionId");
    expect(page.candidates[0]).not.toHaveProperty("claimOwner");
    expect(page.candidates[0]).not.toHaveProperty("claimFence");
    expect(persistencePackage).not.toHaveProperty(
      "createPointMutationRedeliveryScopeDiscoveryV1",
    );
  });

  it("skips bounded in-range noncanonical directory rows without poisoning later replacement scopes", async () => {
    const persistence = await scopeDirectoryPersistence();
    for (let sequence = 1; sequence <= 25; sequence += 1) {
      await insertLegacyScope(persistence, sequence);
    }
    const first = scopeIdAt(1);
    const second = scopeIdAt(2);
    await insertScope(persistence, first);
    await insertScope(persistence, second);

    const repository = discovery(persistence);
    const discovered: ReplacementScopeIdV1[] = [];
    let continuation: unknown = undefined;
    let pageCount = 0;
    do {
      const page = await runEffect(repository.discoverEffect({
        limit: 10,
        ...(continuation === undefined ? {} : { continuation }),
      }));
      discovered.push(...page.candidates.map((candidate) => candidate.scopeId));
      continuation = page.continuation ?? undefined;
      pageCount += 1;
    } while (continuation !== undefined);

    expect(pageCount).toBe(3);
    expect(discovered).toEqual([first, second]);
  });

  it("keeps database-owned cursor ordering across mixed legacy spellings", async () => {
    const persistence = await scopeDirectoryPersistence();
    await insertLegacyScopeId(persistence, "Scope_uppercase_Ω", "upper");
    await insertLegacyScopeId(persistence, "scope_legacy_é", "accent");
    await insertLegacyScopeId(persistence, "scope_legacy_😀", "astral");
    const replacement = scopeIdAt(1);
    await insertScope(persistence, replacement);

    const repository = discovery(persistence);
    const discovered: ReplacementScopeIdV1[] = [];
    let continuation: unknown = undefined;
    let pageCount = 0;
    do {
      const page = await runEffect(repository.discoverEffect({
        limit: 1,
        ...(continuation === undefined ? {} : { continuation }),
      }));
      discovered.push(...page.candidates.map((candidate) => candidate.scopeId));
      continuation = page.continuation ?? undefined;
      pageCount += 1;
    } while (continuation !== undefined);

    expect(pageCount).toBe(4);
    expect(discovered).toEqual([replacement]);
  });

  it("paginates 100 plus overflow under one inert high-water fence", async () => {
    const persistence = await scopeDirectoryPersistence();
    for (let sequence = 1; sequence <= 102; sequence += 1) {
      await insertScope(persistence, scopeIdAt(sequence));
    }
    const repository = discovery(persistence);
    const first = await runEffect(repository.discoverEffect({
      limit: MAX_POINT_MUTATION_REDELIVERY_SCOPE_DISCOVERY_LIMIT_V1,
    }));
    expect(first.candidates).toHaveLength(100);
    expect(first.continuation).not.toBeNull();
    expect(Object.isFrozen(first.continuation)).toBe(true);

    const deferred = replacementScopeIdV1FromUuid(
      "89000000-0000-0000-0000-000000000001",
    );
    await insertScope(persistence, deferred);
    const second = await runEffect(repository.discoverEffect({
      limit: MAX_POINT_MUTATION_REDELIVERY_SCOPE_DISCOVERY_LIMIT_V1,
      continuation: first.continuation,
    }));
    expect(second.candidates).toHaveLength(2);
    expect(second.candidates.some((candidate) =>
      candidate.scopeId === deferred
    )).toBe(false);
    expect(second.continuation).toBeNull();

    const all = [...first.candidates, ...second.candidates].map(
      (candidate) => candidate.scopeId,
    );
    expect(all).toEqual(
      Array.from({ length: 102 }, (_, index) => scopeIdAt(index + 1)),
    );

    const fresh = await runEffect(repository.discoverEffect({ limit: 100 }));
    expect(fresh.continuation?.highWaterScopeId).toBe(deferred);
  }, 30_000);

  it("rejects malformed limits, excess fields, and inverted continuations", async () => {
    const persistence = await scopeDirectoryPersistence();
    const repository = discovery(persistence);
    for (const invalid of [
      { limit: 0 },
      { limit: 101 },
      { limit: 1.5 },
      { limit: 1, extra: true },
      {
        limit: 1,
        continuation: {
          codecVersion: 1,
          highWaterScopeId: "",
          lastScopeId: scopeIdAt(1),
        },
      },
    ]) {
      const failure = await runEffectFailure(
        repository.discoverEffect(invalid),
      );
      expect(failure).toBeInstanceOf(
        PointMutationRedeliveryScopeDiscoveryInputV1Error,
      );
      expect(failure).toMatchObject({ reason: "invalidInput" });
    }

    const inverted = await runEffectFailure(repository.discoverEffect({
      limit: 1,
      continuation: {
        codecVersion: 1,
        highWaterScopeId: scopeIdAt(1),
        lastScopeId: scopeIdAt(2),
      },
    }));
    expect(inverted).toMatchObject({
      _tag: "PointMutationRedeliveryScopeDiscoveryInputV1Error",
      reason: "continuationOrderingInvalid",
    });
  });

  it("fails closed when a replacement-scope directory row has invalid deployment evidence", async () => {
    const persistence = await scopeDirectoryPersistence();
    const scopeId = scopeIdAt(500);
    await persistence.insertDeploymentMetadata({
      deploymentId: "",
      projectId: "project_corrupt_redelivery_scope",
    });
    await persistence.insertScopeMetadata({
      scopeId,
      deploymentId: "",
      physicalLocator: sharedLocator,
    });

    const failure = await runEffectFailure(
      discovery(persistence).discoverEffect({ limit: 1 }),
    );
    expect(failure).toBeInstanceOf(
      PointMutationRedeliveryScopeDiscoveryCorruptionV1Error,
    );
    expect(failure).toMatchObject({ reason: "metadataInvalid" });
  });

  it("maps the foreign database rejection once at the persistence boundary", async () => {
    const persistence = await scopeDirectoryPersistence();
    await persistence.exec("drop table fx_control_scope cascade");
    const failure = await runEffectFailure(
      discovery(persistence).discoverEffect({ limit: 1 }),
    );
    expect(failure).toBeInstanceOf(
      PointMutationRedeliveryScopeDiscoverySqlV1Error,
    );
    expect(failure).toMatchObject({ operation: "discover" });
  });
});

function discovery(persistence: PGliteFlarexPersistence) {
  return createPointMutationRedeliveryScopeDiscoveryV1(persistence.drizzle);
}

async function scopeDirectoryPersistence(): Promise<PGliteFlarexPersistence> {
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  return persistence;
}

function scopeIdAt(sequence: number): ReplacementScopeIdV1 {
  return replacementScopeIdV1FromUuid(
    `88000000-0000-0000-0000-${sequence.toString().padStart(12, "0")}`,
  );
}

function deploymentIdFor(scopeId: ReplacementScopeIdV1): string {
  return `deployment_redelivery_${scopeId.slice(6)}`;
}

async function insertScope(
  persistence: PGliteFlarexPersistence,
  scopeId: ReplacementScopeIdV1,
): Promise<void> {
  const deploymentId = deploymentIdFor(scopeId);
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: `project_${deploymentId}`,
  });
  await persistence.insertScopeMetadata({
    scopeId,
    deploymentId,
    physicalLocator: sharedLocator,
  });
}

async function insertLegacyScope(
  persistence: PGliteFlarexPersistence,
  sequence: number,
): Promise<void> {
  await insertLegacyScopeId(
    persistence,
    `scope_87000000-0000-0000-0000-${
      sequence.toString().padStart(12, "0")
    }x`,
    sequence.toString(),
  );
}

async function insertLegacyScopeId(
  persistence: PGliteFlarexPersistence,
  scopeId: string,
  suffix: string,
): Promise<void> {
  const deploymentId = `deployment_legacy_redelivery_scope_${suffix}`;
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: `project_${deploymentId}`,
  });
  await persistence.query(
    `
      insert into fx_control_scope (
        id,
        deployment_id,
        isolation_kind,
        physical_locator_json
      ) values ($1, $2, 'shared_database', $3::jsonb)
    `,
    [
      scopeId,
      deploymentId,
      JSON.stringify(sharedLocator),
    ],
  );
}

async function scopeCount(
  persistence: PGliteFlarexPersistence,
): Promise<number> {
  const result = await persistence.query<{ readonly count: number }>(
    "select count(*)::int as count from fx_control_scope",
  );
  const count = result.rows[0]?.count;
  if (typeof count !== "number") {
    throw new Error("Expected one numeric scope count.");
  }
  return count;
}
