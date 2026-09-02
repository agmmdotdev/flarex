import { captureRelationalSchemaArtifact } from
  "../src/relationalSchema/artifact";
import { captureFrameworkSchemaTargetNamespace } from
  "../src/migrationCoordination/targetNamespace";
import { captureFrameworkMigrationStepReceipt } from
  "../src/migrationCoordination/canonical";
import type {
  CapturedFrameworkMigrationValue,
  FrameworkMigrationAttemptStartFrame,
  FrameworkMigrationStepReceiptFrame,
  FreshRelationalMigrationPlan,
} from "../src/migrationCoordination/model";
import type {
  FrameworkMigrationAttemptStartSha256,
  FrameworkMigrationStepReceiptSha256,
} from "../src/migrationCoordination/identity";
import type { ScopePhysicalLocator } from "../src/scopeMetadataTypes";
import { runEffect } from "./effectTestRuntime";

export const FRAMEWORK_VALUE_LOCATOR = Object.freeze({
  kind: "shared_database",
  databaseKey: "primary",
  schemaName: "flarex_shared",
} satisfies ScopePhysicalLocator);

export async function syntheticSystemArtifact() {
  return runEffect(captureRelationalSchemaArtifact({
    deploymentId: "deployment-a",
    provenance: { kind: "synthetic", fixtureId: "relational-system" },
    schema: syntheticSchemaInput(),
  }));
}

export async function currencyArtifact() {
  return runEffect(captureRelationalSchemaArtifact({
    deploymentId: "deployment-a",
    provenance: { kind: "synthetic", fixtureId: "currency-lowering" },
    schema: currencySchemaInput(),
  }));
}

export async function frameworkTargetNamespace() {
  return runEffect(captureFrameworkSchemaTargetNamespace({
    deploymentId: "deployment-a",
    physicalDatabaseIdentity: "postgres-cluster-a/database-a",
    schemaName: FRAMEWORK_VALUE_LOCATOR.schemaName,
  }));
}

export async function completeFrameworkMigrationPlanSteps(
  plan: FreshRelationalMigrationPlan,
  attempt: CapturedFrameworkMigrationValue<
    FrameworkMigrationAttemptStartFrame,
    FrameworkMigrationAttemptStartSha256
  >,
  completedAt: string,
): Promise<readonly CapturedFrameworkMigrationValue<
  FrameworkMigrationStepReceiptFrame,
  FrameworkMigrationStepReceiptSha256
>[]> {
  const receipts = new Map<string, CapturedFrameworkMigrationValue<
    FrameworkMigrationStepReceiptFrame,
    FrameworkMigrationStepReceiptSha256
  >>();
  for (const step of plan.frame.steps) {
    const dependencies = step.dependencies.map(dependency => {
      const receipt = receipts.get(dependency.stepId);
      if (receipt === undefined) {
        throw new Error("Fixture migration dependency receipt is missing");
      }
      return receipt;
    });
    receipts.set(step.stepId, await runEffect(
      captureFrameworkMigrationStepReceipt({
        attempt,
        step,
        dependencyReceipts: dependencies,
        observedPostconditionSha256: step.postconditionSha256,
        completedAt,
      }),
    ));
  }
  return Object.freeze([...receipts.values()]);
}

export function syntheticSchemaInput() {
  return {
    owner: "system",
    lineageId: "relational-core",
    tables: [
      {
        tableId: "child",
        origin: synthetic("fixture.child"),
        columns: [
          scalarColumn("id", "text", synthetic("fixture.child.id")),
          scalarColumn(
            "parent_id",
            "text",
            synthetic("fixture.child.parent_id"),
          ),
          {
            columnId: "ordinal",
            type: "integer",
            nullable: false,
            default: { kind: "integerLiteral", value: 0 },
            origin: synthetic("fixture.child.ordinal"),
          },
        ],
        keys: [
          primaryKey("child.primary", ["id"], "fixture.child.primary"),
          {
            keyId: "child.parent",
            kind: "unique",
            columns: ["parent_id"],
            origin: synthetic("fixture.child.parent-key"),
          },
        ],
        indexes: [{
          indexId: "child.parent-lookup",
          kind: "btree",
          columns: ["parent_id"],
          predicate: null,
          origin: synthetic("fixture.child.parent-index"),
        }],
        constraints: [
          {
            constraintId: "child.parent",
            kind: "foreignKey",
            sourceColumns: ["parent_id"],
            targetColumns: [{ tableId: "parent", columnId: "id" }],
            onDelete: "restrict",
            onUpdate: "restrict",
            origin: synthetic("fixture.child.parent-fk"),
          },
          {
            constraintId: "child.ordinal-range",
            kind: "integerRange",
            columnId: "ordinal",
            minimum: 0,
            maximum: null,
            origin: synthetic("fixture.child.ordinal-range"),
          },
        ],
        relationships: [{
          relationshipId: "child.parent",
          kind: "oneToOne",
          foreignKeyConstraintId: "child.parent",
          origin: synthetic("fixture.child.parent-relation"),
        }],
      },
      {
        tableId: "parent",
        origin: synthetic("fixture.parent"),
        columns: [
          scalarColumn("id", "text", synthetic("fixture.parent.id")),
          scalarColumn("slug", "text", synthetic("fixture.parent.slug")),
        ],
        keys: [
          primaryKey("parent.primary", ["id"], "fixture.parent.primary"),
          {
            keyId: "parent.slug",
            kind: "unique",
            columns: ["slug"],
            origin: synthetic("fixture.parent.slug"),
          },
        ],
        indexes: [],
        constraints: [],
        relationships: [],
      },
    ],
    capabilities: [],
  };
}

export function currencySchemaInput() {
  return {
    owner: "system",
    lineageId: "currency-core",
    tables: [{
      tableId: "currency",
      origin: authored("fixture.currency"),
      columns: [
        scalarColumn("code", "text", authored("fixture.currency.code")),
        scalarColumn("name", "text", authored("fixture.currency.name")),
        {
          columnId: "rounding",
          type: "numeric",
          nullable: false,
          default: { kind: "exactNumericLiteral", value: "0" },
          origin: authored("fixture.currency.rounding"),
        },
        {
          columnId: "raw_rounding",
          type: "jsonb",
          nullable: false,
          default: {
            kind: "exactNumericRawLiteral",
            value: "0",
            precision: 20,
          },
          origin: derived("fixture.currency.raw-rounding"),
        },
        timestampColumn("created_at", false, "currentTimestamp"),
        timestampColumn("updated_at", false, "currentTimestamp"),
        timestampColumn("deleted_at", true, "none"),
      ],
      keys: [primaryKey(
        "currency.primary",
        ["code"],
        "fixture.currency.primary",
      )],
      indexes: [{
        indexId: "currency.active",
        kind: "btree",
        columns: ["deleted_at"],
        predicate: { kind: "isNull", columnId: "deleted_at" },
        origin: implicit("fixture.currency.active"),
      }],
      constraints: [],
      relationships: [],
    }],
    capabilities: [
      {
        capabilityId: "currency.searchable",
        kind: "searchableText",
        columns: [
          { tableId: "currency", columnId: "code" },
          { tableId: "currency", columnId: "name" },
        ],
        origin: authored("fixture.currency.searchable"),
      },
      {
        capabilityId: "currency.exact-number",
        kind: "exactNumericCompanion",
        numericColumn: { tableId: "currency", columnId: "rounding" },
        rawColumn: { tableId: "currency", columnId: "raw_rounding" },
        origin: derived("fixture.currency.exact-number"),
      },
      {
        capabilityId: "currency.timestamps",
        kind: "managedTimestamps",
        createdAtColumn: { tableId: "currency", columnId: "created_at" },
        updatedAtColumn: { tableId: "currency", columnId: "updated_at" },
        updateBehavior: "currentTimestampOnUpdate",
        origin: implicit("fixture.currency.timestamps"),
      },
      {
        capabilityId: "currency.soft-delete",
        kind: "softDelete",
        deletedAtColumn: { tableId: "currency", columnId: "deleted_at" },
        activeRowsIndex: { tableId: "currency", indexId: "currency.active" },
        origin: implicit("fixture.currency.soft-delete"),
      },
    ],
  };
}

export function expectDeeplyFrozen(input: unknown): void {
  if (input === null || typeof input !== "object") return;
  if (!Object.isFrozen(input)) {
    throw new Error("Expected captured value to be recursively frozen");
  }
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor !== undefined && "value" in descriptor) {
      expectDeeplyFrozen(descriptor.value);
    }
  }
}

function scalarColumn(
  columnId: string,
  type: string,
  origin: Readonly<{ kind: string; sourceId: string }>,
) {
  return {
    columnId,
    type,
    nullable: false,
    default: { kind: "none" },
    origin,
  };
}

function timestampColumn(
  columnId: string,
  nullable: boolean,
  defaultKind: string,
) {
  return {
    columnId,
    type: "timestamptz",
    nullable,
    default: { kind: defaultKind },
    origin: implicit(`fixture.currency.${columnId}`),
  };
}

function primaryKey(keyId: string, columns: string[], sourceId: string) {
  return {
    keyId,
    kind: "primary",
    columns,
    origin: synthetic(sourceId),
  };
}

function synthetic(sourceId: string) {
  return { kind: "synthetic", sourceId };
}

function authored(sourceId: string) {
  return { kind: "authored", sourceId };
}

function derived(sourceId: string) {
  return { kind: "derived", sourceId };
}

function implicit(sourceId: string) {
  return { kind: "implicit", sourceId };
}
