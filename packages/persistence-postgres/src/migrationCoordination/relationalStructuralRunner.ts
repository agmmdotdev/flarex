import { isNonArrayRecord } from "@flarex/utils/records";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { Brand, Data, Effect, Result } from "effect";
import { sql, type SQL } from "drizzle-orm";

import { rowsFromDriverExecuteResult } from "../driverExecuteResult";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import {
  capturePrivateCanonicalValue,
} from "../frameworkSchema/privateCanonicalValue";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type {
  RelationalPhysicalColumn,
  RelationalPhysicalForeignKey,
  RelationalPhysicalIndex,
  RelationalPhysicalIntegerRangeCheck,
  RelationalPhysicalKey,
  RelationalPhysicalLayout,
  RelationalPhysicalTable,
} from "../relationalSchema/physical/model";
import type { RelationalTableIdentity } from "../relationalSchema/model";
import {
  capturedAuthorityForAttempt,
  capturedAuthorityForStepReceipt,
  capturedPlanForStep,
} from "./authority";
import { isCapturedFreshRelationalMigrationPlan } from "./canonical";
import type { FrameworkSchemaValidationSha256 } from "./identity";
import type {
  FrameworkMigrationStep,
  FreshRelationalMigrationPlan,
} from "./model";
import {
  isRestoredFrameworkMigrationAttemptStart,
  isRestoredFrameworkMigrationStepReceipt,
  type RestoredFrameworkMigrationAttemptStart,
  type RestoredFrameworkMigrationStepReceipt,
} from "./storedRestoration";
import {
  frameworkMigrationTargetSnapshot,
  withFrameworkMigrationRawTransactionEffect,
  type FrameworkMigrationTarget,
  type FrameworkMigrationTargetCompositionError,
  type FrameworkMigrationTransaction,
} from "./targetSession";

type RelationalPhysicalTableProjection = Pick<
  RelationalPhysicalTable,
  "identity" | "name" | "scopeColumn" | "columns" | "keys" | "checks"
>;

interface ExpectedPhysicalColumnProjection {
  readonly name: string;
  readonly type: RelationalPhysicalColumn["type"] | "uuid";
  readonly nullable: boolean;
  readonly default: RelationalPhysicalColumn["default"];
}

type StructuralObjectKind =
  | "plan"
  | "table"
  | "index"
  | "foreignKey"
  | "layout";

type StructuralOperationFormat =
  FrameworkMigrationStep["operation"]["codec"]["format"];

type TableStructuralOperation = FrameworkMigrationStep["operation"] &
  Readonly<{ readonly table: RelationalPhysicalTableProjection }>;
type IndexStructuralOperation = FrameworkMigrationStep["operation"] &
  Readonly<{ readonly index: RelationalPhysicalIndex }>;
type ForeignKeyStructuralOperation = FrameworkMigrationStep["operation"] &
  Readonly<{ readonly foreignKey: RelationalPhysicalForeignKey }>;

export type RelationalStructuralObservation = "absent" | "exact";

export class RelationalStructuralRunnerError extends Data.TaggedError(
  "RelationalStructuralRunnerError",
)<{
  readonly operation: "preflight" | "observe" | "execute" | "validate";
  readonly reason:
    | "invalidAuthority"
    | "targetMismatch"
    | "unsupportedArtifact"
    | "catalogMismatch"
    | "unreceiptedStructure"
    | "resourceFailure";
  readonly objectKind: StructuralObjectKind;
  readonly objectName: string | null;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface RelationalStructuralStepExecution {
  readonly observedPostconditionSha256: string;
}

const relationalStructuralRunnerTokenBrand: unique symbol = Symbol(
  "FlarexDB/RelationalStructuralRunnerToken",
);

/**
 * Process-local authority for one exact target and one captured structural
 * plan. The handle exposes no registry, plan, target, SQL, or transaction.
 */
export interface RelationalStructuralRunnerToken {
  readonly [relationalStructuralRunnerTokenBrand]: true;
}

interface RegisteredStructuralStep {
  readonly objectKind: Exclude<StructuralObjectKind, "plan">;
  readonly objectName: string | null;
  readonly validation: boolean;
  readonly observe: (
    transaction: FlarexMetadataTransaction,
  ) => Effect.Effect<
    RelationalStructuralObservation,
    RelationalStructuralRunnerError
  >;
  readonly buildDdl: null | (() => Effect.Effect<
    string,
    RelationalStructuralRunnerError
  >);
}

interface RelationalStructuralRunnerState {
  readonly target: FrameworkMigrationTarget;
  readonly plan: FreshRelationalMigrationPlan;
  readonly steps: ReadonlyMap<FrameworkMigrationStep, RegisteredStructuralStep>;
}

type RegisteredStepFactory = (
  layout: RelationalPhysicalLayout,
  step: FrameworkMigrationStep,
) => Result.Result<RegisteredStructuralStep, RelationalStructuralRunnerError>;

const tokenStates = new WeakMap<
  RelationalStructuralRunnerToken,
  RelationalStructuralRunnerState
>();

/*
 * This is the only operation-codec dispatch boundary. Issuance resolves every
 * captured step to a fixed handler and stores that handler behind the opaque
 * token. Observation and execution never dispatch on caller-visible codec text.
 */
const registeredStepFactories: ReadonlyMap<string, RegisteredStepFactory> =
  new Map<string, RegisteredStepFactory>([
    [
      codecRegistryKey("flarex.relational-create-table", 1),
      (layout, step) => Result.map(tableOperationResult(step), table =>
        Object.freeze({
          objectKind: "table",
          objectName: table.name,
          validation: false,
          observe: transaction => observeTable(transaction, layout, table),
          buildDdl: () => buildTableDdl(layout, table),
        } satisfies RegisteredStructuralStep)
      ),
    ],
    [
      codecRegistryKey("flarex.relational-create-index", 1),
      (layout, step) => Result.flatMap(indexOperationResult(step), index =>
        tableForIdentity(layout, index.table) === undefined
          ? Result.fail(invalidAuthorityError(
            "preflight",
            "index",
            index.name,
          ))
          : Result.succeed(Object.freeze({
            objectKind: "index",
            objectName: index.name,
            validation: false,
            observe: transaction => observeIndex(transaction, layout, index),
            buildDdl: () => buildIndexDdl(layout, index),
          } satisfies RegisteredStructuralStep))
      ),
    ],
    [
      codecRegistryKey("flarex.relational-add-foreign-key", 1),
      (layout, step) => Result.flatMap(
        foreignKeyOperationResult(step),
        foreignKey => {
          const sourceIdentity =
            foreignKey.kind === "scopeAuthorityForeignKey"
              ? foreignKey.table
              : foreignKey.sourceTable;
          return tableForIdentity(layout, sourceIdentity) === undefined
            ? Result.fail(invalidAuthorityError(
              "preflight",
              "foreignKey",
              foreignKey.name,
            ))
            : Result.succeed(Object.freeze({
              objectKind: "foreignKey",
              objectName: foreignKey.name,
              validation: false,
              observe: transaction =>
                observeForeignKey(transaction, layout, foreignKey),
              buildDdl: () => buildForeignKeyDdl(layout, foreignKey),
            } satisfies RegisteredStructuralStep));
        },
      ),
    ],
    [
      codecRegistryKey("flarex.relational-validate-structure", 1),
      layout => Result.succeed(Object.freeze({
        objectKind: "layout",
        objectName: layout.layoutSha256,
        validation: true,
        observe: transaction => observeLayout(transaction, layout),
        buildDdl: null,
      } satisfies RegisteredStructuralStep)),
    ],
  ] satisfies readonly (readonly [string, RegisteredStepFactory])[]);

const brandValidationSha256 = Brand.nominal<FrameworkSchemaValidationSha256>();

export const issueRelationalStructuralRunnerTokenEffect = Effect.fn(
  "RelationalStructuralRunner.issueToken",
)(function* (
  target: FrameworkMigrationTarget,
  plan: FreshRelationalMigrationPlan,
): Effect.fn.Return<
  RelationalStructuralRunnerToken,
  RelationalStructuralRunnerError
> {
  yield* authenticateTargetPlan(target, plan, "preflight");
  const registeredSteps = new Map<
    FrameworkMigrationStep,
    RegisteredStructuralStep
  >();
  for (const step of plan.frame.steps) {
    if (!isExactPlanStep(plan, step)) {
      return yield* Effect.fail(invalidAuthorityError(
        "preflight",
        "plan",
        null,
      ));
    }
    const factory = registeredStepFactories.get(codecRegistryKey(
      step.operation.codec.format,
      step.operation.codec.version,
    ));
    if (factory === undefined) {
      return yield* Effect.fail(runnerError(
        "preflight",
        "unsupportedArtifact",
        "plan",
        null,
        "Relational structural operation codec is not registered",
      ));
    }
    registeredSteps.set(
      step,
      yield* Effect.fromResult(factory(plan.physicalLayout, step)),
    );
  }
  const token = Object.freeze({
    [relationalStructuralRunnerTokenBrand]: true,
  } satisfies RelationalStructuralRunnerToken);
  tokenStates.set(token, Object.freeze({
    target,
    plan,
    steps: registeredSteps,
  } satisfies RelationalStructuralRunnerState));
  return token;
});

export const preflightRelationalStructuralPlanEffect = Effect.fn(
  "RelationalStructuralRunner.preflightPlan",
)(function* (
  token: RelationalStructuralRunnerToken,
): Effect.fn.Return<void, RelationalStructuralRunnerError> {
  yield* runnerStateEffect(token, "preflight");
});

export const observeRelationalStructuralStepEffect = Effect.fn(
  "RelationalStructuralRunner.observeStep",
)(function* (
  token: RelationalStructuralRunnerToken,
  transaction: FrameworkMigrationTransaction,
  step: FrameworkMigrationStep,
): Effect.fn.Return<
  RelationalStructuralObservation,
  RelationalStructuralRunnerError | FrameworkMigrationTargetCompositionError
> {
  const { state, registered } = yield* registeredStepEffect(
    token,
    step,
    "observe",
  );
  return yield* withFrameworkMigrationRawTransactionEffect(
    transaction,
    state.target,
    registered.observe,
  );
});

export const executeRelationalStructuralStepEffect = Effect.fn(
  "RelationalStructuralRunner.executeStep",
)(function* (
  token: RelationalStructuralRunnerToken,
  transaction: FrameworkMigrationTransaction,
  step: FrameworkMigrationStep,
): Effect.fn.Return<
  RelationalStructuralStepExecution,
  RelationalStructuralRunnerError | FrameworkMigrationTargetCompositionError
> {
  const { state, registered } = yield* registeredStepEffect(
    token,
    step,
    "execute",
  );
  if (registered.validation) {
    const observed = yield* withFrameworkMigrationRawTransactionEffect(
      transaction,
      state.target,
      registered.observe,
    );
    if (observed !== "exact") {
      return yield* Effect.fail(catalogMismatchError(
        "validate",
        registered.objectKind,
        registered.objectName,
        "Relational layout is incomplete",
      ));
    }
    return Object.freeze({
      observedPostconditionSha256: step.postconditionSha256,
    });
  }

  const observedBefore = yield* withFrameworkMigrationRawTransactionEffect(
    transaction,
    state.target,
    registered.observe,
  );
  if (observedBefore === "exact") {
    return yield* Effect.fail(runnerError(
      "execute",
      "unreceiptedStructure",
      registered.objectKind,
      registered.objectName,
      "Exact structural postcondition exists without its step receipt",
    ));
  }
  if (registered.buildDdl === null) {
    return yield* Effect.fail(invalidAuthorityError(
      "execute",
      registered.objectKind,
      registered.objectName,
    ));
  }
  const ddl = yield* registered.buildDdl();
  yield* withFrameworkMigrationRawTransactionEffect(
    transaction,
    state.target,
    raw => executeDdl(raw, ddl, registered),
  );
  const observedAfter = yield* withFrameworkMigrationRawTransactionEffect(
    transaction,
    state.target,
    registered.observe,
  );
  if (observedAfter !== "exact") {
    return yield* Effect.fail(catalogMismatchError(
      "execute",
      registered.objectKind,
      registered.objectName,
      "Relational structural statement did not produce its exact projection",
    ));
  }
  return Object.freeze({
    observedPostconditionSha256: step.postconditionSha256,
  });
});

export const captureRelationalStructuralValidationSha256Effect = Effect.fn(
  "RelationalStructuralRunner.captureValidationSha256",
)(function* (
  token: RelationalStructuralRunnerToken,
  receipts: readonly RestoredFrameworkMigrationStepReceipt[],
): Effect.fn.Return<
  FrameworkSchemaValidationSha256,
  RelationalStructuralRunnerError
> {
  const state = yield* runnerStateEffect(token, "validate");
  const receiptEvidence = yield* Effect.fromResult(
    captureValidationReceiptEvidenceResult(state.plan, receipts),
  );
  const captured = yield* capturePrivateCanonicalValue(
    Object.freeze({
      format: "flarex.framework-schema-validation-evidence",
      version: 1,
      policy: "relational-postgres-exact-candidate-structure",
      migrationPlanSha256: state.plan.migrationPlanSha256,
      physicalLayoutSha256: state.plan.physicalLayout.layoutSha256,
      orderedStepReceiptSha256s: receiptEvidence.orderedSha256s,
      finalValidationStepReceiptSha256: receiptEvidence.finalSha256,
    }),
    1_048_576,
    {
      invalidInput: () => runnerError(
        "validate",
        "invalidAuthority",
        "layout",
        null,
        "Validation evidence is invalid",
      ),
      hashFailure: cause => runnerError(
        "validate",
        "resourceFailure",
        "layout",
        null,
        "Validation evidence hashing failed",
        cause,
      ),
    },
  );
  return brandValidationSha256(captured.sha256Hex);
});

function runnerStateEffect(
  token: RelationalStructuralRunnerToken,
  operation: RelationalStructuralRunnerError["operation"],
): Effect.Effect<
  RelationalStructuralRunnerState,
  RelationalStructuralRunnerError
> {
  const state = tokenStates.get(token);
  return state === undefined ||
      !isCapturedFreshRelationalMigrationPlan(state.plan)
    ? Effect.fail(invalidAuthorityError(operation, "plan", null))
    : Effect.succeed(state);
}

const registeredStepEffect = Effect.fn(
  "RelationalStructuralRunner.authenticateStep",
)(function* (
  token: RelationalStructuralRunnerToken,
  step: FrameworkMigrationStep,
  operation: RelationalStructuralRunnerError["operation"],
): Effect.fn.Return<
  Readonly<{
    readonly state: RelationalStructuralRunnerState;
    readonly registered: RegisteredStructuralStep;
  }>,
  RelationalStructuralRunnerError
> {
  const state = yield* runnerStateEffect(token, operation);
  const registered = state.steps.get(step);
  if (registered === undefined || !isExactPlanStep(state.plan, step)) {
    return yield* Effect.fail(invalidAuthorityError(
      operation,
      "plan",
      null,
    ));
  }
  return Object.freeze({ state, registered });
});

function authenticateTargetPlan(
  target: FrameworkMigrationTarget,
  plan: FreshRelationalMigrationPlan,
  operation: RelationalStructuralRunnerError["operation"],
): Effect.Effect<void, RelationalStructuralRunnerError> {
  const snapshot = frameworkMigrationTargetSnapshot(target);
  if (!isCapturedFreshRelationalMigrationPlan(plan) || snapshot === undefined) {
    return Effect.fail(invalidAuthorityError(operation, "plan", null));
  }
  const expected = plan.frame.targetNamespace;
  const actual = snapshot.namespace.frame;
  const locator = snapshot.physicalLocator;
  if (
    actual.deploymentId !== expected.deploymentId ||
    actual.physicalDatabaseIdentity !== expected.physicalDatabaseIdentity ||
    actual.schemaName !== expected.schemaName ||
    locator.kind !== plan.frame.physicalLocator.kind ||
    locator.databaseKey !== plan.frame.physicalLocator.databaseKey ||
    locator.schemaName !== plan.frame.physicalLocator.schemaName
  ) {
    return Effect.fail(runnerError(
      operation,
      "targetMismatch",
      "plan",
      null,
      "Relational migration plan is not bound to this target",
    ));
  }
  return Effect.void;
}

function isExactPlanStep(
  plan: FreshRelationalMigrationPlan,
  step: FrameworkMigrationStep,
): boolean {
  return capturedPlanForStep(step) === plan &&
    plan.frame.steps[step.ordinal] === step &&
    step.executionCapability ===
      "postgres-transactional-relational-structure" &&
    step.transactionMode === "transactionBound";
}

function captureValidationReceiptEvidenceResult(
  plan: FreshRelationalMigrationPlan,
  receipts: readonly RestoredFrameworkMigrationStepReceipt[],
): Result.Result<
  Readonly<{
    readonly orderedSha256s: readonly string[];
    readonly finalSha256: string;
  }>,
  RelationalStructuralRunnerError
> {
  const invalid = () => runnerError(
    "validate",
    "invalidAuthority",
    "layout",
    null,
    "Validation receipts do not authenticate the complete plan",
  );
  return Result.flatMap(Result.try({
    try: () => {
      if (receipts.length !== plan.frame.steps.length) {
        return undefined;
      }
      const orderedSha256s: string[] = [];
      const receiptsByStepId = new Map<
        string,
        RestoredFrameworkMigrationStepReceipt
      >();
      let commonAttempt: RestoredFrameworkMigrationAttemptStart | undefined;
      for (let ordinal = 0; ordinal < receipts.length; ordinal += 1) {
        const receipt = receipts[ordinal];
        const step = plan.frame.steps[ordinal];
        if (
          receipt === undefined ||
          step === undefined ||
          !isExactPlanStep(plan, step) ||
          !isRestoredFrameworkMigrationStepReceipt(receipt)
        ) {
          return undefined;
        }
        const attempt = receipt.attempt;
        if (
          !isRestoredFrameworkMigrationAttemptStart(attempt) ||
          attempt.plan.plan !== plan
        ) {
          return undefined;
        }
        commonAttempt ??= attempt;
        const attemptAuthority = capturedAuthorityForAttempt(attempt.attempt);
        const receiptAuthority = capturedAuthorityForStepReceipt(
          receipt.receipt,
        );
        const frame = receipt.receipt.frame;
        if (
          attempt !== commonAttempt ||
          attemptAuthority === undefined ||
          attemptAuthority.plan !== plan ||
          receiptAuthority === undefined ||
          receiptAuthority.attempt !== commonAttempt.attempt ||
          receiptAuthority.step !== step ||
          frame.planSha256 !== plan.migrationPlanSha256 ||
          frame.attemptId !== commonAttempt.attempt.frame.attemptId ||
          frame.attemptFence !== commonAttempt.attempt.frame.attemptFence ||
          frame.stepId !== step.stepId ||
          frame.stepSha256 !== step.stepSha256 ||
          frame.preconditionSha256 !== step.preconditionSha256 ||
          frame.postconditionSha256 !== step.postconditionSha256 ||
          frame.observedPostconditionSha256 !== step.postconditionSha256 ||
          frame.dependencyReceipts.length !== step.dependencies.length ||
          receiptsByStepId.has(step.stepId)
        ) {
          return undefined;
        }
        const expectedDependencies = step.dependencies.toSorted((left, right) =>
          compareUtf16Strings(left.stepId, right.stepId)
        );
        for (
          let dependencyOrdinal = 0;
          dependencyOrdinal < expectedDependencies.length;
          dependencyOrdinal += 1
        ) {
          const expectedDependency = expectedDependencies[dependencyOrdinal];
          const dependencyReference =
            frame.dependencyReceipts[dependencyOrdinal];
          const dependencyReceipt = expectedDependency === undefined
            ? undefined
            : receiptsByStepId.get(expectedDependency.stepId);
          if (
            expectedDependency === undefined ||
            dependencyReference === undefined ||
            dependencyReceipt === undefined ||
            dependencyReference.stepId !== expectedDependency.stepId ||
            dependencyReference.stepReceiptSha256 !==
              dependencyReceipt.receipt.sha256 ||
            dependencyReceipt.receipt.frame.stepSha256 !==
              expectedDependency.stepSha256
          ) {
            return undefined;
          }
        }
        orderedSha256s.push(receipt.receipt.sha256);
        receiptsByStepId.set(step.stepId, receipt);
      }
      const finalReceipt = receipts.at(-1);
      if (
        commonAttempt === undefined ||
        finalReceipt === undefined ||
        finalReceipt.receipt.frame.stepId !== plan.frame.steps.at(-1)?.stepId
      ) {
        return undefined;
      }
      return Object.freeze({
        orderedSha256s: Object.freeze(orderedSha256s),
        finalSha256: finalReceipt.receipt.sha256,
      });
    },
    catch: invalid,
  }), evidence => evidence === undefined
    ? Result.fail(invalid())
    : Result.succeed(evidence));
}

function codecRegistryKey(
  format: StructuralOperationFormat,
  version: number,
): string {
  return `${format}\u0000${version}`;
}

const observeLayout = Effect.fn(
  "RelationalStructuralRunner.observeLayout",
)(function* (
  transaction: FlarexMetadataTransaction,
  layout: RelationalPhysicalLayout,
): Effect.fn.Return<
  RelationalStructuralObservation,
  RelationalStructuralRunnerError
> {
  for (const table of layout.frame.tables) {
    if ((yield* observeTable(transaction, layout, table)) !== "exact") {
      return "absent";
    }
    for (const index of table.indexes) {
      if ((yield* observeIndex(transaction, layout, index)) !== "exact") {
        return "absent";
      }
    }
  }
  for (const foreignKey of layout.frame.foreignKeys) {
    if (
      (yield* observeForeignKey(transaction, layout, foreignKey)) !== "exact"
    ) {
      return "absent";
    }
  }
  return "exact";
});

const observeTable = Effect.fn(
  "RelationalStructuralRunner.observeTable",
)(function* (
  transaction: FlarexMetadataTransaction,
  layout: RelationalPhysicalLayout,
  table: RelationalPhysicalTableProjection,
): Effect.fn.Return<
  RelationalStructuralObservation,
  RelationalStructuralRunnerError
> {
  const context = catalogContext("table", table.name);
  const schemaName = layout.frame.targetNamespace.schemaName;
  const relationRows = yield* catalogRows(transaction, sql`
    select relation.oid::text as relation_oid,
      relation.relkind::text as relation_kind,
      relation.relpersistence::text as persistence_kind,
      relation.relispartition as is_partition,
      relation.relnatts::integer as declared_attribute_count,
      relation.reloptions is null as has_no_relation_options,
      not exists (
        select 1 from pg_inherits as parent_edge
        where parent_edge.inhrelid = relation.oid
      ) as has_no_parent,
      not exists (
        select 1 from pg_inherits as child_edge
        where child_edge.inhparent = relation.oid
      ) as has_no_child
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = ${schemaName}
      and relation.relname = ${table.name}
    limit 2
  `, context);
  if (relationRows.length === 0) return "absent";
  const relation = yield* Effect.fromResult(oneCatalogRowResult(
    relationRows,
    context,
  ));
  const relationOid = yield* Effect.fromResult(textMemberResult(
    relation,
    "relation_oid",
    context,
  ));
  const declaredAttributeCount = yield* Effect.fromResult(integerMemberResult(
    relation,
    "declared_attribute_count",
    context,
  ));
  if (
    (yield* Effect.fromResult(textMemberResult(
      relation,
      "relation_kind",
      context,
    ))) !== "r" ||
    (yield* Effect.fromResult(textMemberResult(
      relation,
      "persistence_kind",
      context,
    ))) !== "p" ||
    (yield* Effect.fromResult(booleanMemberResult(
      relation,
      "is_partition",
      context,
    ))) ||
    !(yield* Effect.fromResult(booleanMemberResult(
      relation,
      "has_no_relation_options",
      context,
    ))) ||
    !(yield* Effect.fromResult(booleanMemberResult(
      relation,
      "has_no_parent",
      context,
    ))) ||
    !(yield* Effect.fromResult(booleanMemberResult(
      relation,
      "has_no_child",
      context,
    )))
  ) {
    return yield* Effect.fail(catalogMismatchError(
      "observe",
      "table",
      table.name,
    ));
  }

  const columns = yield* catalogRows(transaction, sql`
    select attribute.attnum::integer as attribute_number,
      attribute.attname as column_name,
      format_type(attribute.atttypid, attribute.atttypmod) as type_name,
      attribute.attnotnull as not_null,
      attribute.atthasdef as has_default,
      attribute.atthasmissing as has_missing_value,
      attribute.attidentity::text as identity_kind,
      attribute.attgenerated::text as generated_kind,
      attribute.attislocal as is_local,
      attribute.attinhcount::integer as inherit_count,
      attribute.attcollation = type_row.typcollation as uses_type_collation,
      pg_get_expr(default_row.adbin, default_row.adrelid)
        as default_expression
    from pg_attribute as attribute
    join pg_type as type_row on type_row.oid = attribute.atttypid
    left join pg_attrdef as default_row
      on default_row.adrelid = attribute.attrelid
      and default_row.adnum = attribute.attnum
    where attribute.attrelid = ${relationOid}::oid
      and attribute.attnum > 0
      and not attribute.attisdropped
    order by attribute.attnum
  `, context);
  const expectedColumns: readonly ExpectedPhysicalColumnProjection[] = [
    Object.freeze({
      name: table.scopeColumn.name,
      type: table.scopeColumn.type,
      nullable: table.scopeColumn.nullable,
      default: Object.freeze({ kind: "none" as const }),
    }),
    ...table.columns,
  ];
  if (
    columns.length !== expectedColumns.length ||
    declaredAttributeCount !== expectedColumns.length
  ) {
    return yield* Effect.fail(catalogMismatchError(
      "observe",
      "table",
      table.name,
    ));
  }
  for (let ordinal = 0; ordinal < columns.length; ordinal += 1) {
    const row = columns[ordinal];
    const expected = expectedColumns[ordinal];
    if (row === undefined || expected === undefined) {
      return yield* Effect.fail(catalogMismatchError(
        "observe",
        "table",
        table.name,
      ));
    }
    const actualDefault = yield* Effect.fromResult(nullableTextMemberResult(
      row,
      "default_expression",
      context,
    ));
    const defaultIsExact = yield* defaultExpressionMatches(
      transaction,
      actualDefault,
      expected,
      context,
    );
    const actualName = yield* Effect.fromResult(textMemberResult(
      row,
      "column_name",
      context,
    ));
    const actualType = yield* Effect.fromResult(textMemberResult(
      row,
      "type_name",
      context,
    ));
    const actualNotNull = yield* Effect.fromResult(booleanMemberResult(
      row,
      "not_null",
      context,
    ));
    const actualIdentityKind = yield* Effect.fromResult(textMemberResult(
      row,
      "identity_kind",
      context,
    ));
    const actualGeneratedKind = yield* Effect.fromResult(textMemberResult(
      row,
      "generated_kind",
      context,
    ));
    const usesTypeCollation = yield* Effect.fromResult(booleanMemberResult(
      row,
      "uses_type_collation",
      context,
    ));
    if (
      (yield* Effect.fromResult(integerMemberResult(
        row,
        "attribute_number",
        context,
      ))) !== ordinal + 1 ||
      actualName !== expected.name ||
      actualType !== expected.type ||
      actualNotNull !== !expected.nullable ||
      (yield* Effect.fromResult(booleanMemberResult(
        row,
        "has_default",
        context,
      ))) !== (expected.default.kind !== "none") ||
      (yield* Effect.fromResult(booleanMemberResult(
        row,
        "has_missing_value",
        context,
      ))) ||
      actualIdentityKind !== "" ||
      actualGeneratedKind !== "" ||
      !(yield* Effect.fromResult(booleanMemberResult(
        row,
        "is_local",
        context,
      ))) ||
      (yield* Effect.fromResult(integerMemberResult(
        row,
        "inherit_count",
        context,
      ))) !== 0 ||
      !usesTypeCollation ||
      !defaultIsExact
    ) {
      return yield* Effect.fail(catalogMismatchError(
        "observe",
        "table",
        table.name,
      ));
    }
  }

  const constraints = yield* catalogRows(transaction, sql`
    select constraint_row.conname as constraint_name,
      constraint_row.contype::text as constraint_type,
      constraint_row.condeferrable as is_deferrable,
      constraint_row.condeferred as is_deferred,
      constraint_row.convalidated as is_validated,
      constraint_row.connoinherit as is_no_inherit,
      constraint_row.conislocal as is_local,
      constraint_row.coninhcount::integer as inherit_count,
      constraint_row.conparentid::text as parent_constraint_oid,
      constraint_row.conindid::text as backing_index_oid,
      array(
        select source_column.attname
        from unnest(constraint_row.conkey)
          with ordinality as key_column(attnum, ordinality)
        join pg_attribute as source_column
          on source_column.attrelid = constraint_row.conrelid
          and source_column.attnum = key_column.attnum
        order by key_column.ordinality
      ) as column_names,
      pg_get_expr(constraint_row.conbin, constraint_row.conrelid)
        as check_expression
    from pg_constraint as constraint_row
    where constraint_row.conrelid = ${relationOid}::oid
      and constraint_row.contype in ('p', 'u', 'c')
    order by constraint_row.conname
  `, context);
  if (constraints.length !== table.keys.length + table.checks.length) {
    return yield* Effect.fail(catalogMismatchError(
      "observe",
      "table",
      table.name,
    ));
  }
  const actualByName = new Map<
    string,
    Readonly<Record<string, unknown>>
  >();
  for (const row of constraints) {
    const name = yield* Effect.fromResult(textMemberResult(
      row,
      "constraint_name",
      context,
    ));
    if (actualByName.has(name)) {
      return yield* Effect.fail(catalogMismatchError(
        "observe",
        "table",
        table.name,
      ));
    }
    actualByName.set(name, row);
  }
  for (const key of table.keys) {
    const actual = actualByName.get(key.name);
    if (
      actual === undefined ||
      !(yield* keyConstraintMatches(
        transaction,
        schemaName,
        table.name,
        actual,
        key,
      ))
    ) {
      return yield* Effect.fail(catalogMismatchError(
        "observe",
        "table",
        table.name,
      ));
    }
  }
  for (const check of table.checks) {
    const actual = actualByName.get(check.name);
    if (
      actual === undefined ||
      !(yield* Effect.fromResult(checkConstraintMatchesResult(
        actual,
        check,
        context,
      )))
    ) {
      return yield* Effect.fail(catalogMismatchError(
        "observe",
        "table",
        table.name,
      ));
    }
  }
  return "exact";
});

const observeIndex = Effect.fn(
  "RelationalStructuralRunner.observeIndex",
)(function* (
  transaction: FlarexMetadataTransaction,
  layout: RelationalPhysicalLayout,
  index: RelationalPhysicalIndex,
): Effect.fn.Return<
  RelationalStructuralObservation,
  RelationalStructuralRunnerError
> {
  const sourceTable = tableForIdentity(layout, index.table);
  if (sourceTable === undefined) {
    return yield* Effect.fail(invalidAuthorityError(
      "observe",
      "index",
      index.name,
    ));
  }
  const schemaName = layout.frame.targetNamespace.schemaName;
  const context = catalogContext("index", index.name);
  const namedRows = yield* catalogRows(transaction, sql`
    select relation.oid::text as relation_oid,
      relation.relkind::text as relation_kind,
      relation.relpersistence::text as persistence_kind,
      relation.relispartition as is_partition
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = ${schemaName}
      and relation.relname = ${index.name}
    limit 2
  `, context);
  if (namedRows.length === 0) return "absent";
  const named = yield* Effect.fromResult(oneCatalogRowResult(
    namedRows,
    context,
  ));
  if (
    (yield* Effect.fromResult(textMemberResult(
      named,
      "relation_kind",
      context,
    ))) !== "i" ||
    (yield* Effect.fromResult(textMemberResult(
      named,
      "persistence_kind",
      context,
    ))) !== "p" ||
    (yield* Effect.fromResult(booleanMemberResult(
      named,
      "is_partition",
      context,
    )))
  ) {
    return yield* Effect.fail(catalogMismatchError(
      "observe",
      "index",
      index.name,
    ));
  }
  const indexOid = yield* Effect.fromResult(textMemberResult(
    named,
    "relation_oid",
    context,
  ));
  const exact = yield* indexProjectionMatches(
    transaction,
    indexOid,
    Object.freeze({
      schemaName,
      tableName: sourceTable.name,
      indexName: index.name,
      columns: index.columns,
      unique: false,
      primary: false,
      predicateColumn: index.predicate?.column ?? null,
    }),
    context,
  );
  if (!exact) {
    return yield* Effect.fail(catalogMismatchError(
      "observe",
      "index",
      index.name,
    ));
  }
  return "exact";
});

const observeForeignKey = Effect.fn(
  "RelationalStructuralRunner.observeForeignKey",
)(function* (
  transaction: FlarexMetadataTransaction,
  layout: RelationalPhysicalLayout,
  foreignKey: RelationalPhysicalForeignKey,
): Effect.fn.Return<
  RelationalStructuralObservation,
  RelationalStructuralRunnerError
> {
  const sourceIdentity = foreignKey.kind === "scopeAuthorityForeignKey"
    ? foreignKey.table
    : foreignKey.sourceTable;
  const sourceTable = tableForIdentity(layout, sourceIdentity);
  if (sourceTable === undefined) {
    return yield* Effect.fail(invalidAuthorityError(
      "observe",
      "foreignKey",
      foreignKey.name,
    ));
  }
  const schemaName = layout.frame.targetNamespace.schemaName;
  const context = catalogContext("foreignKey", foreignKey.name);
  const rows = yield* catalogRows(transaction, sql`
    select source_table.relname as source_table,
      constraint_row.contype::text as constraint_type,
      target_namespace.nspname as target_schema,
      target_table.relname as target_table,
      constraint_row.confmatchtype::text as match_type,
      constraint_row.confupdtype::text as update_action,
      constraint_row.confdeltype::text as delete_action,
      constraint_row.condeferrable as is_deferrable,
      constraint_row.condeferred as is_deferred,
      constraint_row.convalidated as is_validated,
      constraint_row.connoinherit as is_no_inherit,
      constraint_row.conislocal as is_local,
      constraint_row.coninhcount::integer as inherit_count,
      constraint_row.conparentid::text as parent_constraint_oid,
      constraint_row.conindid::text as referenced_index_oid,
      array(
        select equality_operator.operator_oid::text
        from unnest(constraint_row.conpfeqop)
          with ordinality as equality_operator(operator_oid, ordinality)
        order by equality_operator.ordinality
      ) as primary_foreign_equality_operators,
      array(
        select equality_operator.operator_oid::text
        from unnest(constraint_row.conppeqop)
          with ordinality as equality_operator(operator_oid, ordinality)
        order by equality_operator.ordinality
      ) as primary_primary_equality_operators,
      array(
        select equality_operator.operator_oid::text
        from unnest(constraint_row.conffeqop)
          with ordinality as equality_operator(operator_oid, ordinality)
        order by equality_operator.ordinality
      ) as foreign_foreign_equality_operators,
      array(
        select source_column.attname
        from unnest(constraint_row.conkey)
          with ordinality as key_column(attnum, ordinality)
        join pg_attribute as source_column
          on source_column.attrelid = constraint_row.conrelid
          and source_column.attnum = key_column.attnum
        order by key_column.ordinality
      ) as source_columns,
      array(
        select target_column.attname
        from unnest(constraint_row.confkey)
          with ordinality as key_column(attnum, ordinality)
        join pg_attribute as target_column
          on target_column.attrelid = constraint_row.confrelid
          and target_column.attnum = key_column.attnum
        order by key_column.ordinality
      ) as target_columns
    from pg_constraint as constraint_row
    join pg_class as source_table
      on source_table.oid = constraint_row.conrelid
    join pg_namespace as source_namespace
      on source_namespace.oid = source_table.relnamespace
    left join pg_class as target_table
      on target_table.oid = constraint_row.confrelid
    left join pg_namespace as target_namespace
      on target_namespace.oid = target_table.relnamespace
    where source_namespace.nspname = ${schemaName}
      and source_table.relname = ${sourceTable.name}
      and constraint_row.conname = ${foreignKey.name}
    limit 2
  `, context);
  if (rows.length === 0) return "absent";
  const row = yield* Effect.fromResult(oneCatalogRowResult(rows, context));
  if ((yield* Effect.fromResult(textMemberResult(
    row,
    "constraint_type",
    context,
  ))) !== "f") {
    return yield* Effect.fail(catalogMismatchError(
      "observe",
      "foreignKey",
      foreignKey.name,
    ));
  }
  const targetTable = foreignKey.kind === "scopeAuthorityForeignKey"
    ? foreignKey.targetTable
    : foreignKey.targetTableName;
  const primaryForeignOperators = yield* Effect.fromResult(
    stringArrayMemberResult(
      row,
      "primary_foreign_equality_operators",
      context,
    ),
  );
  const primaryPrimaryOperators = yield* Effect.fromResult(
    stringArrayMemberResult(
      row,
      "primary_primary_equality_operators",
      context,
    ),
  );
  const foreignForeignOperators = yield* Effect.fromResult(
    stringArrayMemberResult(
      row,
      "foreign_foreign_equality_operators",
      context,
    ),
  );
  const exact =
    (yield* Effect.fromResult(textMemberResult(
      row,
      "source_table",
      context,
    ))) === sourceTable.name &&
    (yield* Effect.fromResult(textMemberResult(
      row,
      "target_schema",
      context,
    ))) === schemaName &&
    (yield* Effect.fromResult(textMemberResult(
      row,
      "target_table",
      context,
    ))) === targetTable &&
    (yield* Effect.fromResult(textMemberResult(
      row,
      "match_type",
      context,
    ))) === "s" &&
    (yield* Effect.fromResult(textMemberResult(
      row,
      "update_action",
      context,
    ))) === "r" &&
    (yield* Effect.fromResult(textMemberResult(
      row,
      "delete_action",
      context,
    ))) === "r" &&
    !(yield* Effect.fromResult(booleanMemberResult(
      row,
      "is_deferrable",
      context,
    ))) &&
    !(yield* Effect.fromResult(booleanMemberResult(
      row,
      "is_deferred",
      context,
    ))) &&
    (yield* Effect.fromResult(booleanMemberResult(
      row,
      "is_validated",
      context,
    ))) &&
    (yield* Effect.fromResult(booleanMemberResult(
      row,
      "is_no_inherit",
      context,
    ))) &&
    (yield* Effect.fromResult(booleanMemberResult(
      row,
      "is_local",
      context,
    ))) &&
    (yield* Effect.fromResult(integerMemberResult(
      row,
      "inherit_count",
      context,
    ))) === 0 &&
    (yield* Effect.fromResult(textMemberResult(
      row,
      "parent_constraint_oid",
      context,
    ))) === "0" &&
    sameStringArray(
      yield* Effect.fromResult(stringArrayMemberResult(
        row,
        "source_columns",
        context,
      )),
      foreignKey.sourceColumns,
    ) &&
    sameStringArray(
      yield* Effect.fromResult(stringArrayMemberResult(
        row,
        "target_columns",
        context,
      )),
      foreignKey.targetColumns,
    ) &&
    primaryForeignOperators.length === foreignKey.sourceColumns.length &&
    sameStringArray(primaryForeignOperators, primaryPrimaryOperators) &&
    sameStringArray(primaryForeignOperators, foreignForeignOperators);
  if (!exact) {
    return yield* Effect.fail(catalogMismatchError(
      "observe",
      "foreignKey",
      foreignKey.name,
    ));
  }
  const referencedIndexOid = yield* Effect.fromResult(textMemberResult(
    row,
    "referenced_index_oid",
    context,
  ));
  if (!(yield* referencedKeyMatches(
    transaction,
    layout,
    foreignKey,
    referencedIndexOid,
    context,
  ))) {
    return yield* Effect.fail(catalogMismatchError(
      "observe",
      "foreignKey",
      foreignKey.name,
    ));
  }
  return "exact";
});

interface ExpectedReferencedKey {
  readonly tableName: string;
  readonly indexName: string;
  readonly columns: readonly string[];
  readonly primary: boolean;
}

const referencedKeyMatches = Effect.fn(
  "RelationalStructuralRunner.matchReferencedKey",
)(function* (
  transaction: FlarexMetadataTransaction,
  layout: RelationalPhysicalLayout,
  foreignKey: RelationalPhysicalForeignKey,
  referencedIndexOid: string,
  context: CatalogContext,
): Effect.fn.Return<boolean, RelationalStructuralRunnerError> {
  const candidates = referencedKeyCandidates(layout, foreignKey);
  for (const candidate of candidates) {
    if (yield* indexProjectionMatches(
      transaction,
      referencedIndexOid,
      Object.freeze({
        schemaName: layout.frame.targetNamespace.schemaName,
        tableName: candidate.tableName,
        indexName: candidate.indexName,
        columns: candidate.columns,
        unique: true,
        primary: candidate.primary,
        predicateColumn: null,
      }),
      context,
    )) {
      return true;
    }
  }
  return false;
});

function referencedKeyCandidates(
  layout: RelationalPhysicalLayout,
  foreignKey: RelationalPhysicalForeignKey,
): readonly ExpectedReferencedKey[] {
  if (foreignKey.kind === "scopeAuthorityForeignKey") {
    return Object.freeze([
      Object.freeze({
        tableName: foreignKey.targetTable,
        indexName: "fx_system_scope_clock_scope_uuid_unique",
        columns: foreignKey.targetColumns,
        primary: false,
      }),
    ]);
  }
  const targetTable = tableForIdentity(layout, foreignKey.targetTable);
  if (targetTable === undefined) return Object.freeze([]);
  return Object.freeze(targetTable.keys
    .filter(key => sameStringSet(key.columns, foreignKey.targetColumns))
    .map(key => Object.freeze({
      tableName: targetTable.name,
      indexName: key.name,
      columns: key.columns,
      primary: key.kind === "primary",
    })));
}

interface ExpectedIndexProjection {
  readonly schemaName: string;
  readonly tableName: string;
  readonly indexName: string;
  readonly columns: readonly string[];
  readonly unique: boolean;
  readonly primary: boolean;
  readonly predicateColumn: string | null;
}

const indexProjectionMatches = Effect.fn(
  "RelationalStructuralRunner.matchIndexProjection",
)(function* (
  transaction: FlarexMetadataTransaction,
  indexOid: string,
  expected: ExpectedIndexProjection,
  context: CatalogContext,
): Effect.fn.Return<boolean, RelationalStructuralRunnerError> {
  const rows = yield* catalogRows(transaction, sql`
    select source_namespace.nspname as source_schema,
      source_table.relname as source_table,
      source_table.relkind::text as source_relation_kind,
      source_table.relpersistence::text as source_persistence_kind,
      source_table.relispartition as source_is_partition,
      index_relation.relname as index_name,
      index_relation.reloptions is null as has_no_index_options,
      access_method.amname as access_method,
      index_row.indisvalid as is_valid,
      index_row.indisready as is_ready,
      index_row.indislive as is_live,
      index_row.indisunique as is_unique,
      index_row.indisprimary as is_primary,
      index_row.indisexclusion as is_exclusion,
      index_row.indisclustered as is_clustered,
      index_row.indisreplident as is_replica_identity,
      index_row.indimmediate as is_immediate,
      index_row.indnkeyatts::integer as key_attribute_count,
      index_row.indnatts::integer as total_attribute_count,
      index_row.indnullsnotdistinct as nulls_not_distinct,
      pg_get_expr(index_row.indexprs, index_row.indrelid) as expressions,
      pg_get_expr(index_row.indpred, index_row.indrelid) as predicate
    from pg_index as index_row
    join pg_class as index_relation
      on index_relation.oid = index_row.indexrelid
    join pg_class as source_table on source_table.oid = index_row.indrelid
    join pg_namespace as source_namespace
      on source_namespace.oid = source_table.relnamespace
    join pg_am as access_method on access_method.oid = index_relation.relam
    where index_row.indexrelid = ${indexOid}::oid
    limit 2
  `, context);
  const row = yield* Effect.fromResult(oneCatalogRowResult(rows, context));
  const keyAttributeCount = yield* Effect.fromResult(integerMemberResult(
    row,
    "key_attribute_count",
    context,
  ));
  const totalAttributeCount = yield* Effect.fromResult(integerMemberResult(
    row,
    "total_attribute_count",
    context,
  ));
  if (
    (yield* Effect.fromResult(textMemberResult(
      row,
      "source_schema",
      context,
    ))) !== expected.schemaName ||
    (yield* Effect.fromResult(textMemberResult(
      row,
      "source_table",
      context,
    ))) !== expected.tableName ||
    (yield* Effect.fromResult(textMemberResult(
      row,
      "source_relation_kind",
      context,
    ))) !== "r" ||
    (yield* Effect.fromResult(textMemberResult(
      row,
      "source_persistence_kind",
      context,
    ))) !== "p" ||
    (yield* Effect.fromResult(booleanMemberResult(
      row,
      "source_is_partition",
      context,
    ))) ||
    (yield* Effect.fromResult(textMemberResult(
      row,
      "index_name",
      context,
    ))) !== expected.indexName ||
    !(yield* Effect.fromResult(booleanMemberResult(
      row,
      "has_no_index_options",
      context,
    ))) ||
    (yield* Effect.fromResult(textMemberResult(
      row,
      "access_method",
      context,
    ))) !== "btree" ||
    !(yield* Effect.fromResult(booleanMemberResult(
      row,
      "is_valid",
      context,
    ))) ||
    !(yield* Effect.fromResult(booleanMemberResult(
      row,
      "is_ready",
      context,
    ))) ||
    !(yield* Effect.fromResult(booleanMemberResult(
      row,
      "is_live",
      context,
    ))) ||
    (yield* Effect.fromResult(booleanMemberResult(
      row,
      "is_unique",
      context,
    ))) !== expected.unique ||
    (yield* Effect.fromResult(booleanMemberResult(
      row,
      "is_primary",
      context,
    ))) !== expected.primary ||
    (yield* Effect.fromResult(booleanMemberResult(
      row,
      "is_exclusion",
      context,
    ))) ||
    (yield* Effect.fromResult(booleanMemberResult(
      row,
      "is_clustered",
      context,
    ))) ||
    (yield* Effect.fromResult(booleanMemberResult(
      row,
      "is_replica_identity",
      context,
    ))) ||
    !(yield* Effect.fromResult(booleanMemberResult(
      row,
      "is_immediate",
      context,
    ))) ||
    keyAttributeCount !== expected.columns.length ||
    totalAttributeCount !== expected.columns.length ||
    (yield* Effect.fromResult(booleanMemberResult(
      row,
      "nulls_not_distinct",
      context,
    ))) ||
    (yield* Effect.fromResult(nullableTextMemberResult(
      row,
      "expressions",
      context,
    ))) !== null ||
    !isNullPredicateExpressionMatch(
      yield* Effect.fromResult(nullableTextMemberResult(
        row,
        "predicate",
        context,
      )),
      expected.predicateColumn,
    )
  ) {
    return false;
  }

  const keyRows = yield* catalogRows(transaction, sql`
    select key_column.ordinality::integer as ordinal,
      source_column.attname as column_name,
      key_column.option_flags::integer as option_flags,
      operator_class.opcdefault as is_default_operator_class,
      operator_class.opcintype = source_column.atttypid
        as operator_class_matches_column_type,
      key_column.collation_oid = source_column.attcollation
        as uses_column_collation,
      source_column.attcollation = type_row.typcollation
        as column_uses_type_collation
    from pg_index as index_row
    cross join lateral unnest(
      index_row.indkey::smallint[],
      index_row.indcollation::oid[],
      index_row.indclass::oid[],
      index_row.indoption::smallint[]
    ) with ordinality as key_column(
      attnum,
      collation_oid,
      operator_class_oid,
      option_flags,
      ordinality
    )
    join pg_attribute as source_column
      on source_column.attrelid = index_row.indrelid
      and source_column.attnum = key_column.attnum
    join pg_type as type_row on type_row.oid = source_column.atttypid
    join pg_opclass as operator_class
      on operator_class.oid = key_column.operator_class_oid
    where index_row.indexrelid = ${indexOid}::oid
      and key_column.ordinality <= index_row.indnkeyatts
    order by key_column.ordinality
  `, context);
  if (keyRows.length !== expected.columns.length) return false;
  for (let ordinal = 0; ordinal < keyRows.length; ordinal += 1) {
    const keyRow = keyRows[ordinal];
    const expectedColumn = expected.columns[ordinal];
    if (keyRow === undefined || expectedColumn === undefined) return false;
    if (
      (yield* Effect.fromResult(integerMemberResult(
        keyRow,
        "ordinal",
        context,
      ))) !== ordinal + 1 ||
      (yield* Effect.fromResult(textMemberResult(
        keyRow,
        "column_name",
        context,
      ))) !== expectedColumn ||
      (yield* Effect.fromResult(integerMemberResult(
        keyRow,
        "option_flags",
        context,
      ))) !== 0 ||
      !(yield* Effect.fromResult(booleanMemberResult(
        keyRow,
        "is_default_operator_class",
        context,
      ))) ||
      !(yield* Effect.fromResult(booleanMemberResult(
        keyRow,
        "operator_class_matches_column_type",
        context,
      ))) ||
      !(yield* Effect.fromResult(booleanMemberResult(
        keyRow,
        "uses_column_collation",
        context,
      ))) ||
      !(yield* Effect.fromResult(booleanMemberResult(
        keyRow,
        "column_uses_type_collation",
        context,
      )))
    ) {
      return false;
    }
  }
  return true;
});

const keyConstraintMatches = Effect.fn(
  "RelationalStructuralRunner.matchKeyConstraint",
)(function* (
  transaction: FlarexMetadataTransaction,
  schemaName: string,
  tableName: string,
  actual: Readonly<Record<string, unknown>>,
  expected: RelationalPhysicalKey,
): Effect.fn.Return<boolean, RelationalStructuralRunnerError> {
  const context = catalogContext("table", tableName);
  if (
    (yield* Effect.fromResult(textMemberResult(
      actual,
      "constraint_type",
      context,
    ))) !== (expected.kind === "primary" ? "p" : "u") ||
    (yield* Effect.fromResult(booleanMemberResult(
      actual,
      "is_deferrable",
      context,
    ))) ||
    (yield* Effect.fromResult(booleanMemberResult(
      actual,
      "is_deferred",
      context,
    ))) ||
    !(yield* Effect.fromResult(booleanMemberResult(
      actual,
      "is_validated",
      context,
    ))) ||
    !(yield* Effect.fromResult(booleanMemberResult(
      actual,
      "is_no_inherit",
      context,
    ))) ||
    !(yield* Effect.fromResult(booleanMemberResult(
      actual,
      "is_local",
      context,
    ))) ||
    (yield* Effect.fromResult(integerMemberResult(
      actual,
      "inherit_count",
      context,
    ))) !== 0 ||
    (yield* Effect.fromResult(textMemberResult(
      actual,
      "parent_constraint_oid",
      context,
    ))) !== "0" ||
    !sameStringArray(
      yield* Effect.fromResult(stringArrayMemberResult(
        actual,
        "column_names",
        context,
      )),
      expected.columns,
    ) ||
    (yield* Effect.fromResult(nullableTextMemberResult(
      actual,
      "check_expression",
      context,
    ))) !== null
  ) {
    return false;
  }
  const indexOid = yield* Effect.fromResult(textMemberResult(
    actual,
    "backing_index_oid",
    context,
  ));
  return yield* indexProjectionMatches(
    transaction,
    indexOid,
    Object.freeze({
      schemaName,
      tableName,
      indexName: expected.name,
      columns: expected.columns,
      unique: true,
      primary: expected.kind === "primary",
      predicateColumn: null,
    }),
    context,
  );
});

function checkConstraintMatchesResult(
  actual: Readonly<Record<string, unknown>>,
  expected: RelationalPhysicalIntegerRangeCheck,
  context: CatalogContext,
): Result.Result<boolean, RelationalStructuralRunnerError> {
  return Result.gen(function* () {
    return (yield* textMemberResult(
        actual,
        "constraint_type",
        context,
      )) === "c" &&
      !(yield* booleanMemberResult(
        actual,
        "is_deferrable",
        context,
      )) &&
      !(yield* booleanMemberResult(actual, "is_deferred", context)) &&
      (yield* booleanMemberResult(actual, "is_validated", context)) &&
      !(yield* booleanMemberResult(actual, "is_no_inherit", context)) &&
      (yield* booleanMemberResult(actual, "is_local", context)) &&
      (yield* integerMemberResult(actual, "inherit_count", context)) === 0 &&
      (yield* textMemberResult(
        actual,
        "parent_constraint_oid",
        context,
      )) === "0" &&
      sameStringArray(
        yield* stringArrayMemberResult(actual, "column_names", context),
        [expected.column],
      ) &&
      rangeConstraintExpressionMatches(
        yield* nullableTextMemberResult(
          actual,
          "check_expression",
          context,
        ),
        expected,
      );
  });
}

const buildTableDdl = Effect.fn(
  "RelationalStructuralRunner.buildTableDdl",
)(function* (
  layout: RelationalPhysicalLayout,
  table: RelationalPhysicalTableProjection,
): Effect.fn.Return<string, RelationalStructuralRunnerError> {
  const schemaName = yield* Effect.fromResult(quoteIdentifierResult(
    layout.frame.targetNamespace.schemaName,
    "execute",
    "table",
    table.name,
  ));
  const tableName = yield* Effect.fromResult(quoteIdentifierResult(
    table.name,
    "execute",
    "table",
    table.name,
  ));
  const scopeColumn = yield* Effect.fromResult(quoteIdentifierResult(
    table.scopeColumn.name,
    "execute",
    "table",
    table.name,
  ));
  const definitions: string[] = [`${scopeColumn} uuid NOT NULL`];
  for (const column of table.columns) {
    definitions.push(yield* columnDefinition(column, table.name));
  }
  for (const key of table.keys) {
    const constraintName = yield* Effect.fromResult(quoteIdentifierResult(
      key.name,
      "execute",
      "table",
      table.name,
    ));
    const columns = yield* quotedIdentifierList(
      key.columns,
      "table",
      table.name,
    );
    const kind = key.kind === "primary" ? "PRIMARY KEY" : "UNIQUE";
    definitions.push(
      `CONSTRAINT ${constraintName} ${kind} (${columns}) NOT DEFERRABLE`,
    );
  }
  for (const check of table.checks) {
    const constraintName = yield* Effect.fromResult(quoteIdentifierResult(
      check.name,
      "execute",
      "table",
      table.name,
    ));
    const expression = yield* Effect.fromResult(rangeExpressionResult(
      check,
      "execute",
      "table",
      table.name,
    ));
    definitions.push(
      `CONSTRAINT ${constraintName} CHECK (${expression})`,
    );
  }
  return `CREATE TABLE ${schemaName}.${tableName} (${definitions.join(", ")})`;
});

const buildIndexDdl = Effect.fn(
  "RelationalStructuralRunner.buildIndexDdl",
)(function* (
  layout: RelationalPhysicalLayout,
  index: RelationalPhysicalIndex,
): Effect.fn.Return<string, RelationalStructuralRunnerError> {
  const table = tableForIdentity(layout, index.table);
  if (table === undefined) {
    return yield* Effect.fail(invalidAuthorityError(
      "execute",
      "index",
      index.name,
    ));
  }
  const schemaName = yield* Effect.fromResult(quoteIdentifierResult(
    layout.frame.targetNamespace.schemaName,
    "execute",
    "index",
    index.name,
  ));
  const indexName = yield* Effect.fromResult(quoteIdentifierResult(
    index.name,
    "execute",
    "index",
    index.name,
  ));
  const tableName = yield* Effect.fromResult(quoteIdentifierResult(
    table.name,
    "execute",
    "index",
    index.name,
  ));
  const columns: string[] = [];
  for (const column of index.columns) {
    const name = yield* Effect.fromResult(quoteIdentifierResult(
      column,
      "execute",
      "index",
      index.name,
    ));
    columns.push(`${name} ASC NULLS LAST`);
  }
  const predicate = index.predicate === null
    ? ""
    : ` WHERE ${yield* Effect.fromResult(quoteIdentifierResult(
      index.predicate.column,
      "execute",
      "index",
      index.name,
    ))} IS NULL`;
  return `CREATE INDEX ${indexName} ON ${schemaName}.${tableName} ` +
    `USING btree (${columns.join(", ")})${predicate}`;
});

const buildForeignKeyDdl = Effect.fn(
  "RelationalStructuralRunner.buildForeignKeyDdl",
)(function* (
  layout: RelationalPhysicalLayout,
  foreignKey: RelationalPhysicalForeignKey,
): Effect.fn.Return<string, RelationalStructuralRunnerError> {
  const sourceIdentity = foreignKey.kind === "scopeAuthorityForeignKey"
    ? foreignKey.table
    : foreignKey.sourceTable;
  const sourceTable = tableForIdentity(layout, sourceIdentity);
  if (sourceTable === undefined) {
    return yield* Effect.fail(invalidAuthorityError(
      "execute",
      "foreignKey",
      foreignKey.name,
    ));
  }
  const targetTable = foreignKey.kind === "scopeAuthorityForeignKey"
    ? foreignKey.targetTable
    : foreignKey.targetTableName;
  const schemaName = yield* Effect.fromResult(quoteIdentifierResult(
    layout.frame.targetNamespace.schemaName,
    "execute",
    "foreignKey",
    foreignKey.name,
  ));
  const sourceTableName = yield* Effect.fromResult(quoteIdentifierResult(
    sourceTable.name,
    "execute",
    "foreignKey",
    foreignKey.name,
  ));
  const targetTableName = yield* Effect.fromResult(quoteIdentifierResult(
    targetTable,
    "execute",
    "foreignKey",
    foreignKey.name,
  ));
  const constraintName = yield* Effect.fromResult(quoteIdentifierResult(
    foreignKey.name,
    "execute",
    "foreignKey",
    foreignKey.name,
  ));
  const sourceColumns = yield* quotedIdentifierList(
    foreignKey.sourceColumns,
    "foreignKey",
    foreignKey.name,
  );
  const targetColumns = yield* quotedIdentifierList(
    foreignKey.targetColumns,
    "foreignKey",
    foreignKey.name,
  );
  return `ALTER TABLE ${schemaName}.${sourceTableName} ` +
    `ADD CONSTRAINT ${constraintName} FOREIGN KEY (${sourceColumns}) ` +
    `REFERENCES ${schemaName}.${targetTableName} (${targetColumns}) ` +
    "MATCH SIMPLE ON DELETE RESTRICT ON UPDATE RESTRICT NOT DEFERRABLE";
});

const columnDefinition = Effect.fn(
  "RelationalStructuralRunner.columnDefinition",
)(function* (
  column: RelationalPhysicalColumn,
  tableName: string,
): Effect.fn.Return<string, RelationalStructuralRunnerError> {
  const name = yield* Effect.fromResult(quoteIdentifierResult(
    column.name,
    "execute",
    "table",
    tableName,
  ));
  const defaultClause = yield* defaultSql(column, tableName);
  return `${name} ${column.type}${column.nullable ? "" : " NOT NULL"}` +
    defaultClause;
});

const defaultSql = Effect.fn(
  "RelationalStructuralRunner.defaultSql",
)(function* (
  column: RelationalPhysicalColumn,
  tableName: string,
): Effect.fn.Return<string, RelationalStructuralRunnerError> {
  switch (column.default.kind) {
    case "none":
      return "";
    case "textLiteral":
      return ` DEFAULT ${yield* Effect.fromResult(dollarQuotedLiteralResult(
        column.default.value,
        "execute",
        "table",
        tableName,
      ))}::text`;
    case "integerLiteral":
      return ` DEFAULT ${column.default.value}`;
    case "exactNumericLiteral":
      if (!validNumericLiteral(column.default.value)) {
        return yield* Effect.fail(invalidAuthorityError(
          "execute",
          "table",
          tableName,
        ));
      }
      return ` DEFAULT ${column.default.value}::numeric`;
    case "exactNumericRawLiteral": {
      if (
        !validNumericLiteral(column.default.value) ||
        !Number.isSafeInteger(column.default.precision) ||
        column.default.precision <= 0 ||
        column.default.precision > 1_000
      ) {
        return yield* Effect.fail(invalidAuthorityError(
          "execute",
          "table",
          tableName,
        ));
      }
      const value = JSON.stringify({
        value: column.default.value,
        precision: column.default.precision,
      });
      return ` DEFAULT ${yield* Effect.fromResult(dollarQuotedLiteralResult(
        value,
        "execute",
        "table",
        tableName,
      ))}::jsonb`;
    }
    case "currentTimestamp":
      return " DEFAULT now()";
  }
});

const quotedIdentifierList = Effect.fn(
  "RelationalStructuralRunner.quoteIdentifierList",
)(function* (
  values: readonly string[],
  objectKind: StructuralObjectKind,
  objectName: string | null,
) {
  const quoted: string[] = [];
  for (const value of values) {
    quoted.push(yield* Effect.fromResult(quoteIdentifierResult(
      value,
      "execute",
      objectKind,
      objectName,
    )));
  }
  return quoted.join(", ");
});

function rangeExpressionResult(
  check: RelationalPhysicalIntegerRangeCheck,
  operation: RelationalStructuralRunnerError["operation"],
  objectKind: StructuralObjectKind,
  objectName: string | null,
): Result.Result<string, RelationalStructuralRunnerError> {
  return Result.gen(function* () {
    const column = yield* quoteIdentifierResult(
      check.column,
      operation,
      objectKind,
      objectName,
    );
    const clauses: string[] = [];
    if (check.minimum !== null) clauses.push(`${column} >= ${check.minimum}`);
    if (check.maximum !== null) clauses.push(`${column} <= ${check.maximum}`);
    if (clauses.length === 0) {
      return yield* Result.fail(invalidAuthorityError(
        operation,
        objectKind,
        objectName,
      ));
    }
    return clauses.join(" AND ");
  });
}

const defaultExpressionMatches = Effect.fn(
  "RelationalStructuralRunner.matchDefaultExpression",
)(function* (
  transaction: FlarexMetadataTransaction,
  actual: string | null,
  expected: Pick<RelationalPhysicalColumn, "default">,
  context: CatalogContext,
): Effect.fn.Return<boolean, RelationalStructuralRunnerError> {
  switch (expected.default.kind) {
    case "none":
      return actual === null;
    case "textLiteral":
      return samePostgresTextLiteralExpression(
        actual,
        yield* expectedLiteralExpression(
        transaction,
        expected.default.value,
        "text",
        context,
        ),
      );
    case "integerLiteral":
      return normalizedTypedNumericDefault(actual, "integer") ===
        String(expected.default.value);
    case "exactNumericLiteral":
      return normalizedTypedNumericDefault(actual, "numeric") ===
        expected.default.value;
    case "exactNumericRawLiteral": {
      const encoded = JSON.stringify({
        value: expected.default.value,
        precision: expected.default.precision,
      });
      const expectedExpression = yield* expectedLiteralExpression(
        transaction,
        encoded,
        "jsonb",
        context,
      );
      return actual === expectedExpression;
    }
    case "currentTimestamp":
      return actual === "now()";
  }
});

const expectedLiteralExpression = Effect.fn(
  "RelationalStructuralRunner.expectedLiteralExpression",
)(function* (
  transaction: FlarexMetadataTransaction,
  value: string,
  type: "text" | "jsonb",
  context: CatalogContext,
): Effect.fn.Return<string, RelationalStructuralRunnerError> {
  const rows = type === "text"
    ? yield* catalogRows(transaction, sql`
      select quote_literal(${value}::text) || '::text'
        as expected_expression
    `, context)
    : yield* catalogRows(transaction, sql`
      select quote_literal((${value}::text)::jsonb::text) || '::jsonb'
        as expected_expression
    `, context);
  const row = yield* Effect.fromResult(oneCatalogRowResult(rows, context));
  return yield* Effect.fromResult(textMemberResult(
    row,
    "expected_expression",
    context,
  ));
});

function normalizedTypedNumericDefault(
  value: string | null,
  type: "integer" | "numeric",
): string | null {
  if (value === null) return null;
  let normalized = value.trim();
  const cast = `::${type}`;
  if (normalized.endsWith(cast)) {
    normalized = normalized.slice(0, -cast.length).trim();
  }
  while (
    normalized.startsWith("(") &&
    normalized.endsWith(")")
  ) {
    normalized = normalized.slice(1, -1).trim();
  }
  if (
    normalized.length >= 2 &&
    normalized.startsWith("'") &&
    normalized.endsWith("'")
  ) {
    normalized = normalized.slice(1, -1);
  }
  return validNumericLiteral(normalized) ? normalized : null;
}

function samePostgresTextLiteralExpression(
  actual: string | null,
  expected: string,
): boolean {
  return actual === expected ||
    (expected.startsWith("E'") && actual === expected.slice(1));
}

function quoteIdentifierResult(
  value: string,
  operation: RelationalStructuralRunnerError["operation"],
  objectKind: StructuralObjectKind,
  objectName: string | null,
): Result.Result<string, RelationalStructuralRunnerError> {
  if (
    value.length === 0 ||
    value.includes("\0") ||
    new TextEncoder().encode(value).byteLength > 63
  ) {
    return Result.fail(invalidAuthorityError(
      operation,
      objectKind,
      objectName,
    ));
  }
  return Result.succeed(`"${value.replaceAll('"', '""')}"`);
}

function dollarQuotedLiteralResult(
  value: string,
  operation: RelationalStructuralRunnerError["operation"],
  objectKind: StructuralObjectKind,
  objectName: string | null,
): Result.Result<string, RelationalStructuralRunnerError> {
  if (value.includes("\0")) {
    return Result.fail(invalidAuthorityError(
      operation,
      objectKind,
      objectName,
    ));
  }
  let suffix = "";
  let delimiter = "$flarex$";
  while (value.includes(delimiter)) {
    suffix += "x";
    delimiter = `$flarex${suffix}$`;
  }
  return Result.succeed(`${delimiter}${value}${delimiter}`);
}

function validNumericLiteral(value: string): boolean {
  return /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value);
}

interface CatalogContext {
  readonly objectKind: Exclude<StructuralObjectKind, "plan">;
  readonly objectName: string;
}

function catalogContext(
  objectKind: CatalogContext["objectKind"],
  objectName: string,
): CatalogContext {
  return Object.freeze({ objectKind, objectName });
}

function catalogRows(
  transaction: FlarexMetadataTransaction,
  query: SQL,
  context: CatalogContext,
): Effect.Effect<
  readonly Readonly<Record<string, unknown>>[],
  RelationalStructuralRunnerError
> {
  const statement = Effect.try({
    try: () => transaction.execute(query),
    catch: cause => catalogResourceError(
      context,
      "Relational catalog statement construction failed",
      cause,
    ),
  });
  return statement.pipe(
    Effect.flatMap(promise => runDrizzleStatementEffect(
      promise,
      cause => catalogResourceError(
        context,
        "Relational catalog observation failed",
        cause,
      ),
    )),
    Effect.flatMap(result => Effect.fromResult(catalogRowsResult(
      result,
      context,
    ))),
  );
}

function catalogRowsResult(
  result: unknown,
  context: CatalogContext,
): Result.Result<
  readonly Readonly<Record<string, unknown>>[],
  RelationalStructuralRunnerError
> {
  return Result.gen(function* () {
    const rows = yield* Result.try({
      try: () => rowsFromDriverExecuteResult(result, () => {
        throw invalidDriverExecuteResult;
      }),
      catch: cause => cause === invalidDriverExecuteResult
        ? catalogResourceError(
          context,
          "Relational catalog driver result is invalid",
          cause,
        )
        : catalogResourceError(
          context,
          "Relational catalog driver result could not be read",
          cause,
        ),
    });
    const records: Readonly<Record<string, unknown>>[] = [];
    for (const row of rows) {
      records.push(yield* catalogRowResult(row, context));
    }
    return Object.freeze(records);
  });
}

const invalidDriverExecuteResult = Object.freeze({});
const invalidCatalogRow = Object.freeze({});

function catalogRowResult(
  row: unknown,
  context: CatalogContext,
): Result.Result<
  Readonly<Record<string, unknown>>,
  RelationalStructuralRunnerError
> {
  return Result.flatMap(Result.try({
    try: () => isNonArrayRecord(row) ? row : undefined,
    catch: cause => catalogResourceError(
        context,
        "Relational catalog row could not be classified",
        cause,
      ),
  }), captured => captured === undefined
    ? Result.fail(catalogResourceError(
      context,
      "Relational catalog row is invalid",
      invalidCatalogRow,
    ))
    : Result.succeed(captured));
}

function oneCatalogRowResult(
  rows: readonly Readonly<Record<string, unknown>>[],
  context: CatalogContext,
): Result.Result<
  Readonly<Record<string, unknown>>,
  RelationalStructuralRunnerError
> {
  const row = rows[0];
  return rows.length === 1 && row !== undefined
    ? Result.succeed(row)
    : Result.fail(catalogMismatchError(
      "observe",
      context.objectKind,
      context.objectName,
      "Relational catalog identity is absent or ambiguous",
    ));
}

function unknownMemberResult(
  row: Readonly<Record<string, unknown>>,
  key: string,
  context: CatalogContext,
): Result.Result<unknown, RelationalStructuralRunnerError> {
  return Result.try({
    try: () => row[key],
    catch: cause => catalogResourceError(
      context,
      `Relational catalog member ${key} could not be read`,
      cause,
    ),
  });
}

function textMemberResult(
  row: Readonly<Record<string, unknown>>,
  key: string,
  context: CatalogContext,
): Result.Result<string, RelationalStructuralRunnerError> {
  return Result.flatMap(unknownMemberResult(row, key, context), value =>
    typeof value === "string"
      ? Result.succeed(value)
      : Result.fail(catalogMismatchError(
        "observe",
        context.objectKind,
        context.objectName,
        `Relational catalog member ${key} is not text`,
      ))
  );
}

function nullableTextMemberResult(
  row: Readonly<Record<string, unknown>>,
  key: string,
  context: CatalogContext,
): Result.Result<string | null, RelationalStructuralRunnerError> {
  return Result.flatMap(unknownMemberResult(row, key, context), value =>
    value === null || typeof value === "string"
      ? Result.succeed(value)
      : Result.fail(catalogMismatchError(
        "observe",
        context.objectKind,
        context.objectName,
        `Relational catalog member ${key} is not nullable text`,
      ))
  );
}

function booleanMemberResult(
  row: Readonly<Record<string, unknown>>,
  key: string,
  context: CatalogContext,
): Result.Result<boolean, RelationalStructuralRunnerError> {
  return Result.flatMap(unknownMemberResult(row, key, context), value =>
    typeof value === "boolean"
      ? Result.succeed(value)
      : Result.fail(catalogMismatchError(
        "observe",
        context.objectKind,
        context.objectName,
        `Relational catalog member ${key} is not boolean`,
      ))
  );
}

function integerMemberResult(
  row: Readonly<Record<string, unknown>>,
  key: string,
  context: CatalogContext,
): Result.Result<number, RelationalStructuralRunnerError> {
  return Result.flatMap(unknownMemberResult(row, key, context), value =>
    typeof value === "number" && Number.isSafeInteger(value)
      ? Result.succeed(value)
      : Result.fail(catalogMismatchError(
        "observe",
        context.objectKind,
        context.objectName,
        `Relational catalog member ${key} is not an integer`,
      ))
  );
}

function stringArrayMemberResult(
  row: Readonly<Record<string, unknown>>,
  key: string,
  context: CatalogContext,
): Result.Result<readonly string[], RelationalStructuralRunnerError> {
  return Result.flatMap(unknownMemberResult(row, key, context), value =>
    Result.flatMap(Result.try<readonly string[] | undefined, RelationalStructuralRunnerError>({
      try: () => isStringArray(value) ? value : undefined,
      catch: cause => catalogResourceError(
        context,
        `Relational catalog member ${key} could not be classified`,
        cause,
      ),
    }), captured => captured !== undefined
      ? Result.succeed(captured)
      : Result.fail(catalogMismatchError(
        "observe",
        context.objectKind,
        context.objectName,
        `Relational catalog member ${key} is not a text array`,
      )))
  );
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) &&
    value.every(item => typeof item === "string");
}

function sameStringArray(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

function sameStringSet(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return actual.length === expected.length &&
    actual.every(value => expected.includes(value));
}

function isNullPredicateExpressionMatch(
  actual: string | null,
  expectedColumn: string | null,
): boolean {
  if (actual === null || expectedColumn === null) {
    return actual === null && expectedColumn === null;
  }
  const expression = stripRedundantOuterParentheses(actual);
  const match = /^("(?:[^"]|"")*"|[a-z_][a-z0-9_$]*)\s+IS\s+NULL$/iu
    .exec(expression);
  return match !== null &&
    decodeCatalogIdentifier(match[1] ?? "") === expectedColumn;
}

function rangeConstraintExpressionMatches(
  actual: string | null,
  expected: RelationalPhysicalIntegerRangeCheck,
): boolean {
  if (actual === null) return false;
  const expectedTerms: readonly Readonly<{
    readonly operator: ">=" | "<=";
    readonly value: string;
  }>[] = [
    ...(expected.minimum === null
      ? []
      : [Object.freeze({
        operator: ">=" as const,
        value: String(expected.minimum),
      })]),
    ...(expected.maximum === null
      ? []
      : [Object.freeze({
        operator: "<=" as const,
        value: String(expected.maximum),
      })]),
  ];
  const actualTerms = splitTopLevelAnd(stripRedundantOuterParentheses(actual));
  if (actualTerms.length !== expectedTerms.length) return false;
  for (let index = 0; index < actualTerms.length; index += 1) {
    const actualTerm = stripRedundantOuterParentheses(actualTerms[index] ?? "");
    const match = /^("(?:[^"]|"")*"|[a-z_][a-z0-9_$]*)\s*(>=|<=)\s*(?:(-?(?:0|[1-9][0-9]*))|'(-?(?:0|[1-9][0-9]*))'::integer)$/u
      .exec(actualTerm);
    const expectedTerm = expectedTerms[index];
    if (
      match === null ||
      expectedTerm === undefined ||
      decodeCatalogIdentifier(match[1] ?? "") !== expected.column ||
      match[2] !== expectedTerm.operator ||
      (match[3] ?? match[4]) !== expectedTerm.value
    ) {
      return false;
    }
  }
  return true;
}

function decodeCatalogIdentifier(value: string): string | undefined {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replaceAll('""', '"');
  }
  return /^[a-z_][a-z0-9_$]*$/u.test(value) ? value : undefined;
}

function stripRedundantOuterParentheses(value: string): string {
  let current = value.trim();
  while (hasSingleOuterParentheses(current)) {
    current = current.slice(1, -1).trim();
  }
  return current;
}

function hasSingleOuterParentheses(value: string): boolean {
  if (!value.startsWith("(") || !value.endsWith(")")) return false;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"') {
      if (quoted && value[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (quoted) continue;
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth === 0 && index < value.length - 1) return false;
    if (depth < 0) return false;
  }
  return depth === 0 && !quoted;
}

function splitTopLevelAnd(value: string): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"') {
      if (quoted && value[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (quoted) continue;
    if (character === "(") {
      depth += 1;
      continue;
    }
    if (character === ")") {
      depth -= 1;
      if (depth < 0) return Object.freeze([]);
      continue;
    }
    if (
      depth === 0 &&
      value.slice(index, index + 3).toUpperCase() === "AND" &&
      /\s/u.test(value[index - 1] ?? "") &&
      /\s/u.test(value[index + 3] ?? "")
    ) {
      parts.push(value.slice(start, index).trim());
      start = index + 3;
      index += 2;
    }
  }
  if (quoted || depth !== 0) return Object.freeze([]);
  parts.push(value.slice(start).trim());
  return Object.freeze(parts);
}

function tableForIdentity(
  layout: RelationalPhysicalLayout,
  identity: RelationalTableIdentity,
): RelationalPhysicalTable | undefined {
  return layout.frame.tables.find(table =>
    table.identity.owner === identity.owner &&
    table.identity.lineageId === identity.lineageId &&
    table.identity.tableId === identity.tableId
  );
}

function tableOperationResult(
  step: FrameworkMigrationStep,
): Result.Result<
  RelationalPhysicalTableProjection,
  RelationalStructuralRunnerError
> {
  const operation = step.operation;
  return isTableStructuralOperation(operation)
    ? Result.succeed(operation.table)
    : Result.fail(invalidAuthorityError("preflight", "plan", null));
}

function indexOperationResult(
  step: FrameworkMigrationStep,
): Result.Result<RelationalPhysicalIndex, RelationalStructuralRunnerError> {
  const operation = step.operation;
  return isIndexStructuralOperation(operation)
    ? Result.succeed(operation.index)
    : Result.fail(invalidAuthorityError("preflight", "plan", null));
}

function foreignKeyOperationResult(
  step: FrameworkMigrationStep,
): Result.Result<RelationalPhysicalForeignKey, RelationalStructuralRunnerError> {
  const operation = step.operation;
  return isForeignKeyStructuralOperation(operation)
    ? Result.succeed(operation.foreignKey)
    : Result.fail(invalidAuthorityError("preflight", "plan", null));
}

function isTableStructuralOperation(
  operation: FrameworkMigrationStep["operation"],
): operation is TableStructuralOperation {
  return operation.codec.format === "flarex.relational-create-table" &&
    isNonArrayRecord(operation.table);
}

function isIndexStructuralOperation(
  operation: FrameworkMigrationStep["operation"],
): operation is IndexStructuralOperation {
  return operation.codec.format === "flarex.relational-create-index" &&
    isNonArrayRecord(operation.index);
}

function isForeignKeyStructuralOperation(
  operation: FrameworkMigrationStep["operation"],
): operation is ForeignKeyStructuralOperation {
  return operation.codec.format === "flarex.relational-add-foreign-key" &&
    isNonArrayRecord(operation.foreignKey);
}

function executeDdl(
  transaction: FlarexMetadataTransaction,
  ddl: string,
  registered: RegisteredStructuralStep,
): Effect.Effect<void, RelationalStructuralRunnerError> {
  const statement = Effect.try({
    try: () => transaction.execute(sql.raw(ddl)),
    catch: cause => runnerError(
      "execute",
      "resourceFailure",
      registered.objectKind,
      registered.objectName,
      "Relational structural statement construction failed",
      cause,
    ),
  });
  return statement.pipe(
    Effect.flatMap(promise => runDrizzleStatementEffect(
      promise,
      cause => runnerError(
        "execute",
        "resourceFailure",
        registered.objectKind,
        registered.objectName,
        "Relational structural statement failed",
        cause,
      ),
    )),
    Effect.asVoid,
  );
}

function invalidAuthorityError(
  operation: RelationalStructuralRunnerError["operation"],
  objectKind: StructuralObjectKind,
  objectName: string | null,
): RelationalStructuralRunnerError {
  return runnerError(
    operation,
    "invalidAuthority",
    objectKind,
    objectName,
    "Relational structural authority is invalid",
  );
}

function catalogMismatchError(
  operation: RelationalStructuralRunnerError["operation"],
  objectKind: StructuralObjectKind,
  objectName: string | null,
  message = "Relational catalog projection does not exactly match the plan",
): RelationalStructuralRunnerError {
  return runnerError(
    operation,
    "catalogMismatch",
    objectKind,
    objectName,
    message,
  );
}

function catalogResourceError(
  context: CatalogContext,
  message: string,
  cause: unknown,
): RelationalStructuralRunnerError {
  return runnerError(
    "observe",
    "resourceFailure",
    context.objectKind,
    context.objectName,
    message,
    cause,
  );
}

function runnerError(
  operation: RelationalStructuralRunnerError["operation"],
  reason: RelationalStructuralRunnerError["reason"],
  objectKind: StructuralObjectKind,
  objectName: string | null,
  message: string,
  cause?: unknown,
): RelationalStructuralRunnerError {
  return new RelationalStructuralRunnerError({
    operation,
    reason,
    objectKind,
    objectName,
    message,
    ...(cause === undefined ? {} : { cause }),
  });
}
