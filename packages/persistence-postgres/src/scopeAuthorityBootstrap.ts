import {
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
} from "@flarex/utils/numbers";
import { isNonArrayRecord as isRecord } from "@flarex/utils/records";
import { and, asc, desc, gt, lte, sql } from "drizzle-orm";

import {
  type FlarexMetadataDatabase,
} from "./deployments";
import {
  bootstrapExistingSharedScopeAuthorityInTransaction,
  captureSharedScopePhysicalLocator,
  type BootstrapExistingSharedScopeAuthorityResult,
  type SharedScopeAuthorityProvisionerOptions,
} from "./scopeAuthorityProvisioning";
import type { SharedDatabaseScopePhysicalLocator } from "./scopeMetadataTypes";
import { deployments } from "./schema";

export const SharedScopeAuthorityBootstrapFrontierVersion =
  "shared_scope_authority_bootstrap_v1" as const;
export const MAX_SHARED_SCOPE_AUTHORITY_BOOTSTRAP_BATCH_SIZE = 1_000;

export type SharedScopeAuthorityBootstrapperOptions =
  SharedScopeAuthorityProvisionerOptions;

export interface SharedScopeAuthorityBootstrapCursor {
  readonly deploymentId: string;
}

interface SharedScopeAuthorityBootstrapFrontierBase {
  readonly version: typeof SharedScopeAuthorityBootstrapFrontierVersion;
}

export type SharedScopeAuthorityBootstrapFrontier =
  | (SharedScopeAuthorityBootstrapFrontierBase & {
      readonly kind: "empty";
    })
  | (SharedScopeAuthorityBootstrapFrontierBase & {
      readonly kind: "bounded";
      readonly through: SharedScopeAuthorityBootstrapCursor;
    });

export interface RunSharedScopeAuthorityBootstrapBatchInput {
  readonly frontier: SharedScopeAuthorityBootstrapFrontier;
  readonly after?: SharedScopeAuthorityBootstrapCursor;
  readonly limit: number;
}

export type SharedScopeAuthorityBootstrapItemResult =
  BootstrapExistingSharedScopeAuthorityResult;

export type RunSharedScopeAuthorityBootstrapBatchResult =
  | {
      readonly status: "complete";
      readonly frontier: SharedScopeAuthorityBootstrapFrontier;
      readonly items: readonly SharedScopeAuthorityBootstrapItemResult[];
    }
  | {
      readonly status: "more";
      readonly frontier: Extract<
        SharedScopeAuthorityBootstrapFrontier,
        { readonly kind: "bounded" }
      >;
      readonly items: readonly SharedScopeAuthorityBootstrapItemResult[];
      readonly nextAfter: SharedScopeAuthorityBootstrapCursor;
    };

export interface SharedScopeAuthorityParityCounts {
  readonly deployments: bigint;
  readonly completePairs: bigint;
  readonly missingScopes: bigint;
  readonly missingClocks: bigint;
  readonly locatorConflicts: bigint;
  readonly orphanClocks: bigint;
}

interface SharedScopeAuthorityParityReportBase {
  readonly frontier: SharedScopeAuthorityBootstrapFrontier;
  readonly counts: SharedScopeAuthorityParityCounts;
}

export type SharedScopeAuthorityParityReport =
  | (SharedScopeAuthorityParityReportBase & {
      readonly status: "complete_through_frontier";
    })
  | (SharedScopeAuthorityParityReportBase & {
      readonly status: "needs_bootstrap_pass";
    })
  | (SharedScopeAuthorityParityReportBase & {
      readonly status: "blocked";
    });

export interface SharedScopeAuthorityBootstrapper {
  captureFrontier(): Promise<SharedScopeAuthorityBootstrapFrontier>;
  runBatch(
    input: RunSharedScopeAuthorityBootstrapBatchInput,
  ): Promise<RunSharedScopeAuthorityBootstrapBatchResult>;
  verifyFrontier(
    frontier: SharedScopeAuthorityBootstrapFrontier,
  ): Promise<SharedScopeAuthorityParityReport>;
}

export class InvalidSharedScopeAuthorityBootstrapBatchLimitError extends Error {
  constructor(readonly limit: number) {
    super(
      `Shared scope authority bootstrap batch limit must be an integer from 1 to ${MAX_SHARED_SCOPE_AUTHORITY_BOOTSTRAP_BATCH_SIZE}: ${limit}`,
    );
    this.name = "InvalidSharedScopeAuthorityBootstrapBatchLimitError";
  }
}

export class InvalidSharedScopeAuthorityBootstrapFrontierError extends Error {
  constructor(readonly reason: string) {
    super(`Shared scope authority bootstrap frontier is invalid: ${reason}`);
    this.name = "InvalidSharedScopeAuthorityBootstrapFrontierError";
  }
}

export class SharedScopeAuthorityParityRowError extends Error {
  constructor(
    readonly field: keyof SharedScopeAuthorityParityCounts,
    readonly value: unknown,
  ) {
    super(`Shared scope authority parity field ${field} is invalid`);
    this.name = "SharedScopeAuthorityParityRowError";
  }
}

export function createSharedScopeAuthorityBootstrapper(
  db: FlarexMetadataDatabase,
  options: SharedScopeAuthorityBootstrapperOptions,
): SharedScopeAuthorityBootstrapper {
  const physicalLocator = captureSharedScopePhysicalLocator(
    options.physicalLocator,
  );
  const randomUuid = options.randomUuid ?? (() => crypto.randomUUID());

  return {
    captureFrontier: () => captureBootstrapFrontier(db),
    runBatch: (input) =>
      runBootstrapBatch(db, physicalLocator, randomUuid, input),
    verifyFrontier: (frontier) =>
      verifyBootstrapFrontier(db, physicalLocator, frontier),
  } satisfies SharedScopeAuthorityBootstrapper;
}

async function captureBootstrapFrontier(
  db: FlarexMetadataDatabase,
): Promise<SharedScopeAuthorityBootstrapFrontier> {
  const rows = await db
    .select({ deploymentId: deployments.deploymentId })
    .from(deployments)
    .orderBy(desc(deployments.deploymentId))
    .limit(1);
  const last = rows[0];
  if (last === undefined) {
    return Object.freeze({
      version: SharedScopeAuthorityBootstrapFrontierVersion,
      kind: "empty",
    });
  }
  return Object.freeze({
    version: SharedScopeAuthorityBootstrapFrontierVersion,
    kind: "bounded",
    through: Object.freeze({ deploymentId: last.deploymentId }),
  });
}

async function runBootstrapBatch(
  db: FlarexMetadataDatabase,
  physicalLocator: SharedDatabaseScopePhysicalLocator,
  randomUuid: () => string,
  input: RunSharedScopeAuthorityBootstrapBatchInput,
): Promise<RunSharedScopeAuthorityBootstrapBatchResult> {
  validateBootstrapBatchLimit(input.limit);
  const frontier = captureAndValidateFrontier(input.frontier);
  const after = captureAndValidateCursor(input.after, "after");
  if (frontier.kind === "empty") {
    if (after !== undefined) {
      throw new InvalidSharedScopeAuthorityBootstrapFrontierError(
        "an empty frontier cannot have an after cursor",
      );
    }
    return { status: "complete", frontier, items: [] };
  }
  await requireCursorWithinFrontier(db, after, frontier.through);

  const rows = await db
    .select()
    .from(deployments)
    .where(
      and(
        after === undefined
          ? undefined
          : gt(deployments.deploymentId, after.deploymentId),
        lte(
          deployments.deploymentId,
          frontier.through.deploymentId,
        ),
      ),
    )
    .orderBy(asc(deployments.deploymentId))
    .limit(input.limit + 1);
  const hasMore = rows.length > input.limit;
  const page = rows.slice(0, input.limit);
  const items: SharedScopeAuthorityBootstrapItemResult[] = [];

  for (const deployment of page) {
    const item = await db.transaction((tx) =>
      bootstrapExistingSharedScopeAuthorityInTransaction(
        tx,
        deployment,
        physicalLocator,
        randomUuid,
      ),
    );
    items.push(item);
  }

  const last = page.at(-1);
  if (hasMore) {
    if (last === undefined) {
      throw new Error(
        "Shared scope authority bootstrap page has more rows without a continuation item",
      );
    }
    return {
      status: "more",
      frontier,
      items,
      nextAfter: Object.freeze({ deploymentId: last.deploymentId }),
    };
  }
  return { status: "complete", frontier, items };
}

async function verifyBootstrapFrontier(
  db: FlarexMetadataDatabase,
  physicalLocator: SharedDatabaseScopePhysicalLocator,
  inputFrontier: SharedScopeAuthorityBootstrapFrontier,
): Promise<SharedScopeAuthorityParityReport> {
  const frontier = captureAndValidateFrontier(inputFrontier);
  const locatorJson = JSON.stringify(physicalLocator);
  const frontierPredicate =
    frontier.kind === "empty"
      ? sql`false`
      : sql`d.deployment_id <= ${frontier.through.deploymentId}`;
  const rawResult: unknown = await db.execute(sql`
    with deployment_inventory as (
      select
        case
          when s.id is null then 'missing_scope'
          when s.isolation_kind <> 'shared_database'
            or s.physical_locator_json <> ${locatorJson}::jsonb
            then 'locator_conflict'
          when c.scope_id is null then 'missing_clock'
          else 'complete_pair'
        end as category
      from deployments d
      left join fx_control_scope s
        on s.deployment_id = d.deployment_id
      left join fx_system_scope_clock c
        on c.scope_id = s.id
      where ${frontierPredicate}
    )
    select
      count(*)::text as deployments,
      count(*) filter (where category = 'complete_pair')::text as complete_pairs,
      count(*) filter (where category = 'missing_scope')::text as missing_scopes,
      count(*) filter (where category = 'missing_clock')::text as missing_clocks,
      count(*) filter (where category = 'locator_conflict')::text as locator_conflicts,
      (
        select count(*)::text
        from fx_system_scope_clock orphan_clock
        left join fx_control_scope owner_scope
          on owner_scope.id = orphan_clock.scope_id
        where owner_scope.id is null
      ) as orphan_clocks
    from deployment_inventory
  `);
  const row = parityResultRows(rawResult)[0];
  const counts = {
    deployments: parityBigIntField(row, "deployments"),
    completePairs: parityBigIntField(row, "completePairs", "complete_pairs"),
    missingScopes: parityBigIntField(row, "missingScopes", "missing_scopes"),
    missingClocks: parityBigIntField(row, "missingClocks", "missing_clocks"),
    locatorConflicts: parityBigIntField(
      row,
      "locatorConflicts",
      "locator_conflicts",
    ),
    orphanClocks: parityBigIntField(row, "orphanClocks", "orphan_clocks"),
  } satisfies SharedScopeAuthorityParityCounts;
  const base = { frontier, counts } satisfies SharedScopeAuthorityParityReportBase;

  if (counts.locatorConflicts > 0n || counts.orphanClocks > 0n) {
    return { status: "blocked", ...base };
  }
  if (
    counts.missingScopes > 0n ||
    counts.missingClocks > 0n ||
    counts.completePairs !== counts.deployments
  ) {
    return { status: "needs_bootstrap_pass", ...base };
  }
  return { status: "complete_through_frontier", ...base };
}

function validateBootstrapBatchLimit(limit: number): void {
  if (
    !isPositiveSafeInteger(limit) ||
    limit > MAX_SHARED_SCOPE_AUTHORITY_BOOTSTRAP_BATCH_SIZE
  ) {
    throw new InvalidSharedScopeAuthorityBootstrapBatchLimitError(limit);
  }
}

function captureAndValidateFrontier(
  frontier: SharedScopeAuthorityBootstrapFrontier,
): SharedScopeAuthorityBootstrapFrontier {
  const value: unknown = frontier;
  if (!isRecord(value)) {
    throw new InvalidSharedScopeAuthorityBootstrapFrontierError(
      "the frontier must be an object",
    );
  }
  if (value.version !== SharedScopeAuthorityBootstrapFrontierVersion) {
    throw new InvalidSharedScopeAuthorityBootstrapFrontierError(
      "the version is unsupported",
    );
  }
  switch (value.kind) {
    case "empty": {
      requireExactKeys(value, ["kind", "version"]);
      return Object.freeze({
        version: SharedScopeAuthorityBootstrapFrontierVersion,
        kind: value.kind,
      });
    }
    case "bounded": {
      requireExactKeys(value, ["kind", "through", "version"]);
      const through = captureAndValidateCursorValue(value.through, "through");
      if (through === undefined) {
        throw new InvalidSharedScopeAuthorityBootstrapFrontierError(
          "a bounded frontier requires a through cursor",
        );
      }
      return Object.freeze({
        version: SharedScopeAuthorityBootstrapFrontierVersion,
        kind: value.kind,
        through,
      });
    }
    default:
      throw new InvalidSharedScopeAuthorityBootstrapFrontierError(
        "the kind is unsupported",
      );
  }
}

function captureAndValidateCursor(
  cursor: SharedScopeAuthorityBootstrapCursor | undefined,
  field: "after" | "through",
): SharedScopeAuthorityBootstrapCursor | undefined {
  return captureAndValidateCursorValue(cursor, field);
}

function captureAndValidateCursorValue(
  value: unknown,
  field: "after" | "through",
): SharedScopeAuthorityBootstrapCursor | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new InvalidSharedScopeAuthorityBootstrapFrontierError(
      `${field} must be an object`,
    );
  }
  requireExactKeys(value, ["deploymentId"]);
  if (typeof value.deploymentId !== "string") {
    throw new InvalidSharedScopeAuthorityBootstrapFrontierError(
      `${field}.deploymentId must be a string`,
    );
  }
  return Object.freeze({ deploymentId: value.deploymentId });
}

async function requireCursorWithinFrontier(
  db: FlarexMetadataDatabase,
  after: SharedScopeAuthorityBootstrapCursor | undefined,
  through: SharedScopeAuthorityBootstrapCursor,
): Promise<void> {
  if (after === undefined) return;
  const rows = await db
    .select({
      isWithin: sql<boolean>`${after.deploymentId}::text <= ${through.deploymentId}::text`,
    })
    .from(sql`(values (1)) as cursor_validation`)
    .limit(1);
  if (rows[0]?.isWithin !== true) {
    throw new InvalidSharedScopeAuthorityBootstrapFrontierError(
      "after.deploymentId is beyond the captured frontier",
    );
  }
}

function parityBigIntField(
  row: Record<string, unknown> | undefined,
  field: keyof SharedScopeAuthorityParityCounts,
  databaseField: string = field,
): bigint {
  const value = row?.[databaseField];
  if (typeof value === "bigint" && value >= 0n) return value;
  if (isNonNegativeSafeInteger(value)) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) {
    return BigInt(value);
  }
  throw new SharedScopeAuthorityParityRowError(field, value);
}

function parityResultRows(value: unknown): readonly Record<string, unknown>[] {
  if (!isRecord(value) || !Array.isArray(value.rows)) {
    throw new SharedScopeAuthorityParityRowError("deployments", value);
  }
  const rows: Record<string, unknown>[] = [];
  for (const row of value.rows) {
    if (!isRecord(row)) {
      throw new SharedScopeAuthorityParityRowError("deployments", row);
    }
    rows.push(row);
  }
  return rows;
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  const actual = Object.keys(value).toSorted();
  const sortedExpected = [...expected].toSorted();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new InvalidSharedScopeAuthorityBootstrapFrontierError(
      `expected only ${sortedExpected.join(", ")}`,
    );
  }
}
