import {
  APP_UNIQUE_KEY_CODEC_IDENTITY_V1,
  APP_UNIQUE_KEY_CODEC_VERSION_V1,
  decodeAppUniqueConstraintPhysicalSpecV1,
} from "flarex-protocol/app-unique-constraint-definition";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  SchemaManifestAppIndexDescriptorSchema,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import { ScopeEpochSchema, ScopeIdSchema } from
  "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import {
  AppSchemaVersionUniqueConstraintSetClosedError,
  ensureAppUniqueConstraintDefinitionBindingV1InTransaction,
  prepareAppUniqueConstraintDefinitionBindingV1Effect,
} from "../src/appUniqueConstraintDefinitions";
import {
  AppUniqueConstraintSetBuildIntegrationV1Error,
  createLocatedAppUniqueConstraintSetBuildTargetV1,
  reconcileAppUniqueConstraintSetBuildV1Effect,
} from "../src/appUniqueConstraintSetBuildV1";
import {
  AppUniqueConstraintSetChangedV1Error,
  closeAppUniqueConstraintSetV1InTransactionEffect,
  prepareAppUniqueConstraintSetClosureV1Effect,
  readAppUniqueConstraintSetClosureV1Effect,
} from "../src/appUniqueConstraintSetClosureV1";
import { createPGlitePersistence } from "../src/pglite";
import type { ScopePhysicalLocator } from "../src/scopeMetadataTypes";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const LOCATOR = Object.freeze({
  kind: "shared_database",
  databaseKey: "primary",
  schemaName: "public",
} as const satisfies ScopePhysicalLocator);

describe("C08-B1 closed unique-set build foundation", () => {
  it("closes the exact set, replays it, and refuses late bindings", async () => {
    const fixture = await fixtureFor("closure");
    const first = await prepareBinding(fixture, "by_email", false);
    await ensureBinding(fixture, first);
    const late = await prepareBinding(fixture, "by_tenant_email", true);

    const preparedClosure = await runEffect(
      prepareAppUniqueConstraintSetClosureV1Effect(
        fixture.persistence.drizzle,
        input(fixture),
      ),
    );
    const closed = await fixture.persistence.drizzle.transaction((tx) =>
      runEffect(closeAppUniqueConstraintSetV1InTransactionEffect(
        tx,
        preparedClosure,
      ))
    );
    expect(closed).toMatchObject({
      status: "closed",
      closure: { definitionCount: 1 },
      members: [{ uniqueConstraintDefinitionId: 1 }],
    });

    const replayPrepared = await runEffect(
      prepareAppUniqueConstraintSetClosureV1Effect(
        fixture.persistence.drizzle,
        input(fixture),
      ),
    );
    await expect(fixture.persistence.drizzle.transaction((tx) =>
      runEffect(closeAppUniqueConstraintSetV1InTransactionEffect(
        tx,
        replayPrepared,
      ))
    )).resolves.toMatchObject({ status: "replayed" });

    await expect(ensureBinding(fixture, late)).rejects.toBeInstanceOf(
      AppSchemaVersionUniqueConstraintSetClosedError,
    );
    await expect(ensureBinding(
      fixture,
      await prepareBinding(fixture, "by_email", false),
    )).resolves.toMatchObject({ bindingStatus: "existing" });
    expect(await bindingCount(fixture)).toBe(1);
  });

  it("rejects a set changed after preparation and rolls back closure", async () => {
    const fixture = await fixtureFor("changed");
    await ensureBinding(
      fixture,
      await prepareBinding(fixture, "by_email", false),
    );
    const prepared = await runEffect(
      prepareAppUniqueConstraintSetClosureV1Effect(
        fixture.persistence.drizzle,
        input(fixture),
      ),
    );
    await ensureBinding(
      fixture,
      await prepareBinding(fixture, "by_tenant_email", true),
    );
    await expect(fixture.persistence.drizzle.transaction((tx) =>
      runEffect(closeAppUniqueConstraintSetV1InTransactionEffect(tx, prepared))
    )).rejects.toBeInstanceOf(AppUniqueConstraintSetChangedV1Error);
    expect(await closureCount(fixture)).toBe(0);

    const exact = await runEffect(prepareAppUniqueConstraintSetClosureV1Effect(
      fixture.persistence.drizzle,
      input(fixture),
    ));
    await expect(fixture.persistence.drizzle.transaction(async (tx) => {
      await runEffect(closeAppUniqueConstraintSetV1InTransactionEffect(tx, exact));
      tx.rollback();
    })).rejects.toBeDefined();
    expect(await closureCount(fixture)).toBe(0);
  });

  it("declares one fenced target build, replays, and redeclares stale authority", async () => {
    const fixture = await closedFixture("build");
    const created = await reconcile(fixture);
    expect(created).toMatchObject({
      status: "reconciled",
      disposition: "created",
      definitionCount: 1,
      startCommitSeq: 0n,
      attemptFence: 1n,
    });
    await expect(reconcile(fixture)).resolves.toMatchObject({
      disposition: "replayed",
      attemptFence: 1n,
    });

    await fixture.persistence.query(
      `update fx_system_unique_constraint_set_build
          set lifecycle = 'backfilling', cursor_definition_id = 1,
              cursor_row_id = decode('00112233445566778899aabbccddeeff', 'hex')
        where scope_id = $1 and schema_version_id = $2`,
      [fixture.scopeId, fixture.schemaVersionId],
    );
    await expect(reconcile(fixture)).resolves.toMatchObject({
      disposition: "replayed",
      attemptFence: 1n,
    });
    expect(await buildRows(fixture)).toMatchObject([{
      lifecycle: "backfilling",
      cursor_definition_id: 1,
      cursor_row_hex: "00112233445566778899aabbccddeeff",
    }]);

    await fixture.persistence.query(
      `update fx_system_scope_clock
       set storage_generation_fence = 2, epoch = $2, last_commit_seq = 7
       where scope_id = $1`,
      [fixture.scopeId, ScopeEpochSchema.make("epoch_unique_build_2")],
    );
    await expect(reconcile(fixture)).resolves.toMatchObject({
      disposition: "redeclared",
      startCommitSeq: 7n,
      attemptFence: 2n,
    });
    expect(await buildRows(fixture)).toMatchObject([{
      storage_generation_fence: "2",
      epoch: "epoch_unique_build_2",
      lifecycle: "declared",
      attempt_fence: "2",
      cursor_definition_id: null,
      cursor_row_hex: null,
    }]);
  });

  it("rolls back an injected target fault and resumes deterministically", async () => {
    const fixture = await closedFixture("rollback");
    const failure = await runEffectFailure(
      reconcileAppUniqueConstraintSetBuildV1Effect(
        ports(fixture),
        input(fixture),
        { faultAfter: () => { throw new Error("injected unique build fault"); } },
      ),
    );
    expect(failure).toBeInstanceOf(
      AppUniqueConstraintSetBuildIntegrationV1Error,
    );
    expect(await buildRows(fixture)).toEqual([]);
    await expect(reconcile(fixture)).resolves.toMatchObject({
      disposition: "created",
    });
  });

  it("returns absent until the control set is closed", async () => {
    const fixture = await fixtureFor("absent");
    await expect(reconcile(fixture)).resolves.toEqual({
      status: "absent",
      reason: "setNotClosed",
      deploymentId: fixture.deploymentId,
      schemaVersionId: fixture.schemaVersionId,
    });
  });

  it("reads and verifies the durable closure against current bindings", async () => {
    const fixture = await closedFixture("read");
    const located = await runEffect(readAppUniqueConstraintSetClosureV1Effect(
      fixture.persistence.drizzle,
      fixture.deploymentId,
      fixture.schemaVersionId,
    ));
    expect(located).toMatchObject({
      closure: { definitionCount: 1 },
      members: [{ logicalUniqueConstraintId: 1 }],
    });
  });
});

type Persistence = Awaited<ReturnType<typeof createPGlitePersistence>>;

interface Fixture {
  readonly persistence: Persistence;
  readonly deploymentId: string;
  readonly scopeId: ReturnType<typeof ScopeIdSchema.make>;
  readonly schemaVersionId: ReturnType<typeof CatalogSchemaVersionIdSchema.make>;
  readonly tableId: ReturnType<typeof CatalogTableIdSchema.make>;
  readonly target: ReturnType<
    typeof createLocatedAppUniqueConstraintSetBuildTargetV1
  >;
}

async function fixtureFor(suffix: string): Promise<Fixture> {
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  const deploymentId = `deployment_unique_set_${suffix}`;
  const scopeId = ScopeIdSchema.make(`scope_unique_set_${suffix}`);
  const schemaVersionId = CatalogSchemaVersionIdSchema.make(
    `schema_unique_set_${suffix}`,
  );
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: `project_unique_set_${suffix}`,
  });
  await persistence.insertScopeMetadata({
    scopeId,
    deploymentId,
    physicalLocator: LOCATOR,
  });
  await persistence.query(
    `insert into fx_system_scope_clock
      (scope_id, storage_generation, storage_generation_fence,
       last_commit_seq, last_outbox_seq, epoch)
     values ($1, 'flarexdb_v1', 1, 0, 0, $2)`,
    [scopeId, ScopeEpochSchema.make(`epoch_unique_set_${suffix}`)],
  );
  const published = await persistence.publishAppSchemaV1({
    deploymentId,
    schemaVersionId,
    version: CatalogSchemaVersionSchema.make(1),
    tables: [appTable("users")],
    indexes: [],
  });
  const table = published.manifest.tableDefinitions.tables[0];
  if (table === undefined) throw new Error("Missing unique-set test table.");
  return Object.freeze({
    persistence,
    deploymentId,
    scopeId,
    schemaVersionId,
    tableId: table.tableId,
    target: createLocatedAppUniqueConstraintSetBuildTargetV1(
      persistence.drizzle,
      LOCATOR,
    ),
  });
}

async function closedFixture(suffix: string): Promise<Fixture> {
  const fixture = await fixtureFor(suffix);
  await ensureBinding(
    fixture,
    await prepareBinding(fixture, "by_email", false),
  );
  const prepared = await runEffect(prepareAppUniqueConstraintSetClosureV1Effect(
    fixture.persistence.drizzle,
    input(fixture),
  ));
  await fixture.persistence.drizzle.transaction((tx) =>
    runEffect(closeAppUniqueConstraintSetV1InTransactionEffect(tx, prepared))
  );
  return fixture;
}

function prepareBinding(
  fixture: Fixture,
  descriptor: string,
  sparse: boolean,
) {
  return runEffect(prepareAppUniqueConstraintDefinitionBindingV1Effect(
    fixture.persistence.drizzle,
    {
      deploymentId: fixture.deploymentId,
      schemaVersionId: fixture.schemaVersionId,
      tableId: fixture.tableId,
      descriptor: SchemaManifestAppIndexDescriptorSchema.make(descriptor),
      physicalSpec: decodeAppUniqueConstraintPhysicalSpecV1({
        kind: "appUniqueConstraint",
        specVersion: 1,
        orderedFields: descriptor === "by_email"
          ? ["email"]
          : ["tenantId", "email"],
        sparse,
        localePolicy: { kind: "none" },
        keyCodecIdentity: APP_UNIQUE_KEY_CODEC_IDENTITY_V1,
        keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1,
      }),
    },
  ));
}

function ensureBinding(
  fixture: Fixture,
  prepared: Awaited<ReturnType<typeof prepareBinding>>,
) {
  return fixture.persistence.drizzle.transaction((tx) =>
    runEffect(ensureAppUniqueConstraintDefinitionBindingV1InTransaction(
      tx,
      prepared,
    ))
  );
}

function ports(fixture: Fixture) {
  return {
    controlDb: fixture.persistence.drizzle,
    authority: {
      scopeMetadata: {
        getScopeMetadataByDeploymentId: (deploymentId: string) =>
          fixture.persistence.getScopeMetadataByDeploymentId(deploymentId),
      },
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => null,
      },
      scopeClockTargets: {
        resolve: async () => fixture.target,
      },
    },
  } as const;
}

function input(fixture: Fixture) {
  return Object.freeze({
    deploymentId: fixture.deploymentId,
    schemaVersionId: fixture.schemaVersionId,
  });
}

function reconcile(fixture: Fixture) {
  return runEffect(reconcileAppUniqueConstraintSetBuildV1Effect(
    ports(fixture),
    input(fixture),
  ));
}

function closureCount(fixture: Fixture) {
  return fixture.persistence.query<{ count: number }>(
    "select count(*)::int count from fx_control_schema_unique_constraint_set",
  ).then((result) => result.rows[0]?.count ?? -1);
}

function bindingCount(fixture: Fixture) {
  return fixture.persistence.query<{ count: number }>(
    "select count(*)::int count from fx_control_schema_version_unique_constraint_binding",
  ).then((result) => result.rows[0]?.count ?? -1);
}

function buildRows(fixture: Fixture) {
  return fixture.persistence.query<{
    storage_generation_fence: string;
    epoch: string;
    lifecycle: string;
    attempt_fence: string;
    cursor_definition_id: number | null;
    cursor_row_hex: string | null;
  }>(
    `select storage_generation_fence::text, epoch, lifecycle,
            attempt_fence::text, cursor_definition_id,
            encode(cursor_row_id, 'hex') cursor_row_hex
       from fx_system_unique_constraint_set_build
      where scope_id = $1 and schema_version_id = $2`,
    [fixture.scopeId, fixture.schemaVersionId],
  ).then((result) => result.rows);
}

function appTable(logicalName: string): SchemaManifestAppTableDeclarationInputV1 {
  return {
    logicalName,
    definition: {
      kind: "appDocument",
      definitionVersion: 1,
      documentType: {
        type: "object",
        value: {
          tenantId: {
            fieldType: { type: "string" },
            optional: false,
          },
          email: {
            fieldType: { type: "string" },
            optional: false,
          },
        },
      },
    },
  };
}
