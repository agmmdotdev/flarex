import {
  ScopeIdSchema,
  type ScopeId,
} from "flarex-protocol/storage-authority";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  InvalidScopeMetadataInputError,
  InvalidScopeMetadataListLimitError,
  ScopeMetadataAlreadyExistsError,
  ScopeMetadataCorruptionError,
  type InsertScopeMetadataInput,
  type ScopeMetadataRecord,
  type ScopePhysicalLocator,
} from "../src";
import { createPGlitePersistence } from "../src/pglite";

const physicalLocators = [
  {
    kind: "shared_database",
    databaseKey: "primary",
    schemaName: "public",
  },
  {
    kind: "schema_per_scope",
    databaseKey: "primary",
    schemaName: "fx_scope_b",
  },
  {
    kind: "database_per_scope",
    databaseKey: "scope-c-database",
    schemaName: "public",
  },
] as const satisfies readonly ScopePhysicalLocator[];

describe("scope metadata", () => {
  it("keeps scope identity branded and the active schema pointer read-only", () => {
    expectTypeOf<InsertScopeMetadataInput["scopeId"]>()
      .toEqualTypeOf<ScopeId>();
    expectTypeOf<ScopeMetadataRecord["scopeId"]>().toEqualTypeOf<ScopeId>();
    expectTypeOf<
      Extract<keyof InsertScopeMetadataInput, "activeSchemaVersionId">
    >().toEqualTypeOf<never>();
  });

  it("rejects page limits that cannot produce an advancing cursor", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();

    for (const limit of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1_001,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      await expect(
        persistence.listScopeMetadata({ limit }),
      ).rejects.toMatchObject({
        name: "InvalidScopeMetadataListLimitError",
        limit,
      });
      await expect(
        persistence.listScopeMetadata({ limit }),
      ).rejects.toBeInstanceOf(InvalidScopeMetadataListLimitError);
    }
  });

  it("round-trips every physical topology and lists scopes stably", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();

    const inputs = [
      {
        scopeId: ScopeIdSchema.make("scope_c"),
        deploymentId: "deployment_scope_c",
        physicalLocator: physicalLocators[2],
      },
      {
        scopeId: ScopeIdSchema.make("scope_a"),
        deploymentId: "deployment_scope_a",
        physicalLocator: physicalLocators[0],
      },
      {
        scopeId: ScopeIdSchema.make("scope_b"),
        deploymentId: "deployment_scope_b",
        physicalLocator: physicalLocators[1],
      },
    ] satisfies readonly InsertScopeMetadataInput[];

    for (const input of inputs) {
      await persistence.insertDeploymentMetadata({
        deploymentId: input.deploymentId,
        projectId: `project_${input.deploymentId}`,
      });
      const scope = await persistence.insertScopeMetadata(input);
      expect(scope).toMatchObject({
        scopeId: input.scopeId,
        deploymentId: input.deploymentId,
        activeSchemaVersionId: null,
        isolationKind: input.physicalLocator.kind,
        physicalLocator: input.physicalLocator,
      });
      expect(scope.createdAt).toBeInstanceOf(Date);
      await expect(
        persistence.getScopeMetadata(input.scopeId),
      ).resolves.toEqual(scope);
      await expect(
        persistence.getScopeMetadataByDeploymentId(input.deploymentId),
      ).resolves.toEqual(scope);
    }

    const first = await persistence.listScopeMetadata({ limit: 2 });
    expect(first.scopes.map((scope) => scope.scopeId)).toEqual([
      "scope_a",
      "scope_b",
    ]);
    expect(first).toMatchObject({
      nextCursor: {
        scopeId: "scope_b",
      },
      hasMore: true,
    });
    if (first.nextCursor === null) {
      throw new Error("Expected the first scope page to have a cursor.");
    }
    await expect(
      persistence.listScopeMetadata({
        limit: 2,
        cursor: first.nextCursor,
      }),
    ).resolves.toMatchObject({
      scopes: [{ scopeId: "scope_c" }],
      nextCursor: null,
      hasMore: false,
    });
  });

  it("rejects whitespace-only input before it can claim a deployment", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const deploymentId = "deployment_whitespace_input";
    await persistence.insertDeploymentMetadata({
      deploymentId,
      projectId: "project_whitespace_input",
    });

    const invalidInputs = [
      {
        field: "scopeId",
        input: {
          scopeId: ScopeIdSchema.make("\t\n"),
          deploymentId,
          physicalLocator: physicalLocators[0],
        },
      },
      {
        field: "physicalLocator.databaseKey",
        input: {
          scopeId: ScopeIdSchema.make("scope_whitespace_database_key"),
          deploymentId,
          physicalLocator: {
            ...physicalLocators[0],
            databaseKey: "\u00a0\ufeff",
          },
        },
      },
      {
        field: "physicalLocator.schemaName",
        input: {
          scopeId: ScopeIdSchema.make("scope_whitespace_schema_name"),
          deploymentId,
          physicalLocator: {
            ...physicalLocators[0],
            schemaName: "\u2007\u202f",
          },
        },
      },
    ] as const satisfies readonly {
      field: InvalidScopeMetadataInputError["field"];
      input: InsertScopeMetadataInput;
    }[];

    for (const invalid of invalidInputs) {
      await expect(
        persistence.insertScopeMetadata(invalid.input),
      ).rejects.toMatchObject({
        name: "InvalidScopeMetadataInputError",
        field: invalid.field,
      });
      await expect(
        persistence.getScopeMetadataByDeploymentId(deploymentId),
      ).resolves.toBeNull();
    }

    await expect(
      persistence.insertScopeMetadata({
        scopeId: ScopeIdSchema.make("scope_whitespace_corrected"),
        deploymentId,
        physicalLocator: physicalLocators[0],
      }),
    ).resolves.toMatchObject({
      scopeId: "scope_whitespace_corrected",
      deploymentId,
    });
  });

  it("enforces scope ownership and locator constraints", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    for (const deploymentId of ["deployment_owner_a", "deployment_owner_b"]) {
      await persistence.insertDeploymentMetadata({
        deploymentId,
        projectId: `project_${deploymentId}`,
      });
    }

    const scopeId = ScopeIdSchema.make("scope_owner_a");
    await persistence.insertScopeMetadata({
      scopeId,
      deploymentId: "deployment_owner_a",
      physicalLocator: physicalLocators[0],
    });

    await expect(
      persistence.insertScopeMetadata({
        scopeId: ScopeIdSchema.make("scope_owner_duplicate"),
        deploymentId: "deployment_owner_a",
        physicalLocator: physicalLocators[0],
      }),
    ).rejects.toBeInstanceOf(ScopeMetadataAlreadyExistsError);
    await expect(
      persistence.insertScopeMetadata({
        scopeId,
        deploymentId: "deployment_owner_b",
        physicalLocator: physicalLocators[0],
      }),
    ).rejects.toBeInstanceOf(ScopeMetadataAlreadyExistsError);

    await expect(
      persistence.insertScopeMetadata({
        scopeId: ScopeIdSchema.make("scope_orphan"),
        deploymentId: "deployment_missing",
        physicalLocator: physicalLocators[0],
      }),
    ).rejects.toThrow();
    await expect(
      persistence.query(
        `delete from deployments where deployment_id = $1`,
        ["deployment_owner_a"],
      ),
    ).rejects.toThrow();
    await expect(
      persistence.query(
        `
          insert into fx_control_scope (
            id,
            deployment_id,
            isolation_kind,
            physical_locator_json
          ) values ($1, $2, $3, $4::jsonb)
        `,
        [
          "\t\n",
          "deployment_owner_b",
          "shared_database",
          JSON.stringify(physicalLocators[0]),
        ],
      ),
    ).rejects.toThrow();
    await expect(
      persistence.query(
        `
          insert into fx_control_scope (
            id,
            deployment_id,
            isolation_kind,
            physical_locator_json
          ) values ($1, $2, $3, $4::jsonb)
        `,
        [
          "scope_whitespace_locator",
          "deployment_owner_b",
          "shared_database",
          JSON.stringify({
            kind: "shared_database",
            databaseKey: "\t\n",
            schemaName: "public",
          }),
        ],
      ),
    ).rejects.toThrow();

    await expect(
      persistence.query(
        `
          insert into fx_control_scope (
            id,
            deployment_id,
            isolation_kind,
            physical_locator_json
          ) values ($1, $2, $3, $4::jsonb)
        `,
        [
          "scope_invalid_kind",
          "deployment_owner_b",
          "unknown_topology",
          JSON.stringify({
            kind: "unknown_topology",
            databaseKey: "primary",
            schemaName: "public",
          }),
        ],
      ),
    ).rejects.toThrow();
    await expect(
      persistence.query(
        `
          insert into fx_control_scope (
            id,
            deployment_id,
            isolation_kind,
            physical_locator_json
          ) values ($1, $2, $3, $4::jsonb)
        `,
        [
          "scope_mismatched_locator",
          "deployment_owner_b",
          "shared_database",
          JSON.stringify({
            kind: "schema_per_scope",
            databaseKey: "primary",
            schemaName: "public",
          }),
        ],
      ),
    ).rejects.toThrow();
    await expect(
      persistence.query(
        `
          insert into fx_control_scope (
            id,
            deployment_id,
            isolation_kind,
            physical_locator_json
          ) values ($1, $2, $3, $4::jsonb)
        `,
        [
          "scope_extra_locator_key",
          "deployment_owner_b",
          "shared_database",
          JSON.stringify({
            kind: "shared_database",
            databaseKey: "primary",
            schemaName: "public",
            connectionString: "must-not-be-stored",
          }),
        ],
      ),
    ).rejects.toThrow();

    await expect(
      persistence.getScopeMetadata(ScopeIdSchema.make("scope_missing")),
    ).resolves.toBeNull();
    await expect(
      persistence.getScopeMetadataByDeploymentId("deployment_owner_b"),
    ).resolves.toBeNull();
  });

  it("rejects malformed persisted locator JSON when decoding rows", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    await persistence.exec(`
      alter table fx_control_scope
      drop constraint fx_control_scope_physical_locator_check
    `);

    const corruptLocators = [
      {
        suffix: "scalar",
        value: "shared_database",
      },
      {
        suffix: "extra_key",
        value: {
          kind: "shared_database",
          databaseKey: "primary",
          schemaName: "public",
          connectionString: "must-not-be-stored",
        },
      },
      {
        suffix: "unsupported_kind",
        value: {
          kind: "unknown_topology",
          databaseKey: "primary",
          schemaName: "public",
        },
      },
      {
        suffix: "mismatched_kind",
        value: {
          kind: "schema_per_scope",
          databaseKey: "primary",
          schemaName: "public",
        },
      },
      {
        suffix: "empty_database_key",
        value: {
          kind: "shared_database",
          databaseKey: "",
          schemaName: "public",
        },
      },
    ] as const;

    for (const corruption of corruptLocators) {
      const scopeId = ScopeIdSchema.make(`scope_corrupt_${corruption.suffix}`);
      const deploymentId = `deployment_corrupt_${corruption.suffix}`;
      await persistence.insertDeploymentMetadata({
        deploymentId,
        projectId: `project_corrupt_${corruption.suffix}`,
      });
      await persistence.query(
        `
          insert into fx_control_scope (
            id,
            deployment_id,
            isolation_kind,
            physical_locator_json
          ) values ($1, $2, $3, $4::jsonb)
        `,
        [
          scopeId,
          deploymentId,
          "shared_database",
          JSON.stringify(corruption.value),
        ],
      );

      await expect(
        persistence.getScopeMetadata(scopeId),
      ).rejects.toMatchObject({
        name: "ScopeMetadataCorruptionError",
        scopeId,
      });
      await expect(
        persistence.getScopeMetadata(scopeId),
      ).rejects.toBeInstanceOf(ScopeMetadataCorruptionError);
    }
  });
});
