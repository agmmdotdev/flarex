import {
  projectScopeIdUuidV1Result,
  ScopeIdSchema,
  ScopeEpochSchema,
} from "flarex-protocol/storage-authority";
import { insertInitialScopeClockInTransactionResult } from "../src/scopeClockInitialization";
import { expect } from "vitest";
import { Effect, Option, Result, Deferred, Fiber } from "effect";
import { sql } from "drizzle-orm";
import type {
  ApplicationNativeMutationFixture,
  ApplicationNativeMutationPersistence,
} from "./fixtures/applicationNativeMutationTestFixture";
import type { FrameworkMigrationTarget } from "../src/migrationCoordination/targetSession";
import type { FrameworkSchemaArtifactRepository } from "../src/frameworkSchema/artifact/repository";
import { prepareFrameworkSchemaArtifactAdmission } from "../src/frameworkSchema/artifact/repository";
import { admitFrameworkSchemaArtifactEffect } from "../src/frameworkSchema/artifact/admission";
import { captureRelationalSchemaArtifact } from "../src/relationalSchema/artifact";
import { runFreshFrameworkMigrationCoordinatorEffect } from "../src/migrationCoordination/freshCoordinator";
import {
  installationBindingReference,
  changeBindingAvailability,
} from "./frameworkDataBindingPhysicalTestSupport";
import {
  makeRelationalHost,
  defineRelationalCommand,
} from "../src/relationalTransaction/host";
import type { RelationalCommandContext } from "../src/relationalTransaction/host";
import type { RelationalSession } from "../src/relationalTransaction/session";
import { relationalStore } from "../src/relationalTransaction/store";
import { requireRelationalLifetime } from "../src/relationalTransaction/lifetime";
import { publicationError } from "../src/commitPublication/model";
import type {
  PublicationOwner,
  ReceiptObservation,
} from "../src/commitPublication/model";
import { relationalError } from "../src/relationalTransaction/model";
import type {
  RelationalTransaction,
  RelationalTable,
} from "../src/relationalTransaction/model";
import {
  fxSystemScopeClocks,
  fxSystemCommits,
  fxSystemCommitWakes,
  fxSystemCommitAppRowChanges,
  fxSystemCommitRelationAdjacencyChanges,
  fxSystemIdempotency,
} from "../src/schema";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

export async function prepareRelationalFixture<
  P extends ApplicationNativeMutationPersistence,
>(
  fixture: ApplicationNativeMutationFixture<P>,
  target: FrameworkMigrationTarget,
  repository: FrameworkSchemaArtifactRepository,
) {
  const origin = { kind: "synthetic", sourceId: "scalar-store" };
  const artifact = await runEffect(
    captureRelationalSchemaArtifact({
      deploymentId: fixture.deploymentId,
      provenance: { kind: "synthetic", fixtureId: "scalar-store" },
      schema: {
        owner: "system",
        lineageId: "scalar-store",
        capabilities: [],
        tables: [
          {
            tableId: "items",
            origin,
            columns: ["id", "__proto__", "slug", "rank"].map((columnId) => ({
              columnId,
              origin,
              nullable: false,
              type: columnId === "rank" ? "integer" : "text",
              default: { kind: "none" },
            })),
            keys: [
              {
                keyId: "items.primary",
                kind: "primary",
                columns: ["id"],
                origin,
              },
              {
                keyId: "items.slug",
                kind: "unique",
                columns: ["slug"],
                origin,
              },
            ],
            indexes: [],
            relationships: [],
            constraints: [
              {
                constraintId: "items.rank",
                kind: "integerRange",
                columnId: "rank",
                minimum: 0,
                maximum: 100,
                origin,
              },
            ],
          },
        ],
      },
    }),
  );
  await runEffect(
    admitFrameworkSchemaArtifactEffect(
      repository,
      Result.getOrThrow(
        prepareFrameworkSchemaArtifactAdmission(artifact.artifact),
      ),
    ),
  );
  const ready = await runEffect(
    runFreshFrameworkMigrationCoordinatorEffect({
      target,
      artifactRepository: repository,
      artifactIdentity: artifact.artifact.identity,
      attemptId: "scalar-store",
      leaseOwnerId: "scalar-test",
      leaseDurationMilliseconds: 120_000,
      lockTimeoutMilliseconds: 5_000,
      statementTimeoutMilliseconds: 30_000,
      maximumStepsPerRun: 16,
    }),
  );
  if (ready.kind !== "ready")
    throw new Error(`Scalar installation failed: ${ready.kind}`);
  const layout = ready.availability.installation.plan.plan.physicalLayout.frame;
  const table = layout.tables[0];
  if (table === undefined) throw new Error("Missing scalar table");
  const relation = sql`${sql.identifier(layout.targetNamespace.schemaName)}.${sql.identifier(table.name)}`;
  const column = (id: string) => {
    const value = table.columns.find(
      (column) =>
        column.identity.columnId === (id === "label" ? "__proto__" : id),
    );
    if (value === undefined) throw new Error("Missing fixture column");
    return sql.identifier(value.name);
  };
  const otherScope = ScopeIdSchema.make(
    "scope_34000000-0000-4000-8000-000000009998",
  );
  await fixture.target.drizzle.transaction(async (tx) => {
    Result.getOrThrow(
      await insertInitialScopeClockInTransactionResult(tx, {
        scopeId: otherScope,
        initialEpoch: ScopeEpochSchema.make(
          "epoch_34000000-0000-4000-8000-000000009998",
        ),
      }),
    );
  });
  await fixture.target.drizzle
    .execute(sql`insert into ${relation} (scope_uuid, ${column("id")}, ${column("label")}, ${column("slug")}, ${column("rank")}) values
    (${Result.getOrThrow(projectScopeIdUuidV1Result(otherScope)).scopeUuid}::uuid, 'z', 'Foreign scope', 'slug-z', 1),
    (${Result.getOrThrow(projectScopeIdUuidV1Result(otherScope)).scopeUuid}::uuid, 'a', 'Foreign Alpha', 'slug-a', 1)`);
  // Physical schema fixture setup is not runtime publication authority.
  await fixture.target.drizzle
    .execute(sql`insert into ${relation} (scope_uuid, ${column("id")}, ${column("label")}, ${column("slug")}, ${column("rank")}) values
    (${Result.getOrThrow(projectScopeIdUuidV1Result(fixture.active.basis.authority.scopeId)).scopeUuid}::uuid, 'a', 'Alpha', 'slug-a', 1), (${Result.getOrThrow(projectScopeIdUuidV1Result(fixture.active.basis.authority.scopeId)).scopeUuid}::uuid, 'b', 'Beta', 'slug-b', 2), (${Result.getOrThrow(projectScopeIdUuidV1Result(fixture.active.basis.authority.scopeId)).scopeUuid}::uuid, 'c', 'Gamma', 'slug-c', 3)`);
  return {
    fixture,
    target: target.schema,
    availability: ready.availability,
    reference: installationBindingReference(ready.availability),
    identity: table.identity,
    relation,
    column,
    otherScopeUuid: Result.getOrThrow(projectScopeIdUuidV1Result(otherScope))
      .scopeUuid,
  };
}
export type RelationalFixture<P extends ApplicationNativeMutationPersistence> =
  Awaited<ReturnType<typeof prepareRelationalFixture<P>>>;

export async function exerciseRelationalStore<
  P extends ApplicationNativeMutationPersistence,
>(prepared: RelationalFixture<P>, session: RelationalSession) {
  const { fixture, target, identity, reference, relation, column } = prepared;
  const baseline = await fixture.target.drizzle
    .select()
    .from(fxSystemScopeClocks);
  const commits = await fixture.target.drizzle.select().from(fxSystemCommits);
  const wakes = await fixture.target.drizzle.select().from(fxSystemCommitWakes);
  const appFacts = await fixture.target.drizzle
    .select()
    .from(fxSystemCommitAppRowChanges);
  const relationFacts = await fixture.target.drizzle
    .select()
    .from(fxSystemCommitRelationAdjacencyChanges);
  const outcomes = await fixture.target.drizzle
    .select()
    .from(fxSystemIdempotency);
  const receiptState: {
    owner?: PublicationOwner;
    observations: readonly ReceiptObservation[];
    failReceipt: boolean;
    completions: number;
  } = { observations: [], failReceipt: false, completions: 0 };
  const rejectAcceptedText = Effect.tap(() =>
    Effect.die("Invalid SQL text reached a successful store result"),
  );
  const read = defineRelationalCommand(
    (context: RelationalCommandContext, _input: null) =>
      Effect.gen(function* () {
        const table = yield* context.store.table(context.transaction, identity);
        let rereads = 0;
        const options = new Proxy(
          { limit: 2 },
          {
            get: () => {
              rereads++;
              return 33;
            },
          },
        );
        const page = yield* context.store.list(
          context.transaction,
          table,
          options,
        );
        expect(rereads).toBe(0);
        expect(page.rows.map((row) => row.id)).toEqual(["a", "b"]);
        expect(Option.getOrThrow(page.next)).toBe("b");
        const second = yield* context.store.list(context.transaction, table, {
          limit: 2,
          after: Option.getOrThrow(page.next),
        });
        expect(second.rows.map((row) => row.id)).toEqual(["c"]);
        expect(Option.isNone(second.next)).toBe(true);
        expect(
          (yield* context.store.list(context.transaction, table, {
            limit: 2,
            equal: { column: "rank", value: 2 },
          })).rows[0]?.id,
        ).toBe("b");
        expect(
          Option.isNone(
            yield* context.store.get(context.transaction, table, "missing"),
          ),
        ).toBe(true);
        held = { transaction: context.transaction, table };
        return "read";
      }),
  );
  const insert = defineRelationalCommand(
    (context: RelationalCommandContext, _input: null) =>
      Effect.gen(function* () {
        const table = yield* context.store.table(context.transaction, identity);
        expect(
          Option.getOrThrow(
            yield* context.store.get(context.transaction, table, "a"),
          )["__proto__"],
        ).toBe("Alpha");
        yield* context.store.update(context.transaction, table, "a", {
          ["__proto__"]: "Changed Alpha",
        });
        yield* context.store.insert(context.transaction, table, {
          id: "new",
          ["__proto__"]: "New 😀",
          slug: "slug-new",
          rank: 4,
        });
        expect(
          Option.getOrThrow(
            yield* context.store.get(context.transaction, table, "new"),
          )["__proto__"],
        ).toBe("New 😀");
        return "nested-complete";
      }),
  );
  const mutate = defineRelationalCommand(
    (context: RelationalCommandContext, _input: null) =>
      Effect.gen(function* () {
        expect(yield* context.nested(context.transaction, insert, null)).toBe(
          "nested-complete",
        );
        const table = yield* context.store.table(context.transaction, identity);
        expect(
          Option.getOrThrow(
            yield* context.store.update(context.transaction, table, "new", {
              ["__proto__"]: "Changed",
            }),
          )["__proto__"],
        ).toBe("Changed");
        expect(
          Option.getOrThrow(
            yield* context.store.delete(context.transaction, table, "a"),
          ).id,
        ).toBe("a");
        expect(
          Option.isNone(
            yield* context.store.get(context.transaction, table, "a"),
          ),
        ).toBe(true);
        // Trusted fixture observation uses the actual open transaction to detect cross-scope
        // UPDATE/DELETE damage before the mandatory outer rollback could conceal it.
        const state = yield* requireRelationalLifetime(context.transaction);
        const foreignRows = yield* Effect.promise(() =>
          state.tx.execute(
            sql`select ${column("label")} as label from ${relation} where scope_uuid = ${prepared.otherScopeUuid}::uuid and ${column("id")} = 'a'`,
          ),
        );
        expect(foreignRows).toMatchObject({
          rows: [{ label: "Foreign Alpha" }],
        });
      }),
  );
  const bad = defineRelationalCommand(
    (context: RelationalCommandContext, kind: string) =>
      Effect.gen(function* () {
        const table = yield* context.store.table(context.transaction, identity);
        switch (kind) {
          case "unique":
            return yield* context.store.insert(context.transaction, table, {
              id: "dup",
              ["__proto__"]: "Duplicate",
              slug: "slug-a",
              rank: 1,
            });
          case "check":
            return yield* context.store.insert(context.transaction, table, {
              id: "bad",
              ["__proto__"]: "Bad",
              slug: "bad",
              rank: -1,
            });
          case "primary":
            return yield* context.store.update(
              context.transaction,
              table,
              "a",
              { id: "changed" },
            );
          case "scope":
            return yield* context.store.update(
              context.transaction,
              table,
              "a",
              { scope_uuid: fixture.active.basis.authority.scopeId },
            );
          case "oversize":
            return yield* context.store.update(
              context.transaction,
              table,
              "a",
              { ["__proto__"]: "x".repeat(70_000) },
            );
          case "list":
            return yield* context.store.list(context.transaction, table, {
              limit: 33,
            });
          case "list-getter":
            return yield* context.store.list(context.transaction, table, {
              get limit(): number {
                throw new Error("Must never invoke accessor");
              },
            });
          case "text-key":
            return yield* context.store
              .get(context.transaction, table, "\uD800")
              .pipe(rejectAcceptedText);
          case "text-row":
            return yield* context.store
              .update(context.transaction, table, "a", {
                ["__proto__"]: "\uDC00",
              })
              .pipe(rejectAcceptedText);
          case "text-equal":
            return yield* context.store
              .list(context.transaction, table, {
                limit: 2,
                equal: { column: "id", value: "\uD800" },
              })
              .pipe(rejectAcceptedText);
          case "text-after":
            return yield* context.store
              .list(context.transaction, table, { limit: 2, after: "\uD800" })
              .pipe(rejectAcceptedText);
          case "calls":
            for (let count = 0; count < 65; count++)
              yield* context.store.get(context.transaction, table, "a");
            return;
          case "rows":
            for (let count = 0; count < 29; count++)
              yield* context.store.insert(context.transaction, table, {
                id: `r${count}`,
                ["__proto__"]: "Row",
                slug: `r${count}`,
                rank: 0,
              });
            for (let count = 0; count < 9; count++)
              yield* context.store.list(context.transaction, table, {
                limit: 32,
              });
            return;
          case "owner":
            return yield* context.store.table(context.transaction, {
              ...identity,
              owner: "medusa",
            });
          case "forged":
            return yield* context.store.get(
              context.transaction,
              {} as RelationalTable,
              "a",
            );
          case "borrowed":
            // SAFETY: deliberate forged runtime token in the negative authority test.
            return yield* context.nested(
              {} as RelationalTransaction,
              insert,
              null,
            );
          case "transaction":
            // SAFETY: deliberate forged runtime token in the negative authority test.
            return yield* context.store.get(
              {} as RelationalTransaction,
              table,
              "a",
            );
          case "overlap":
            return yield* Effect.all(
              [
                context.store.get(context.transaction, table, "a"),
                context.store.get(context.transaction, table, "b"),
              ],
              { concurrency: 2 },
            );
          case "zero":
            yield* context.store.delete(context.transaction, table, "missing");
            return;
          case "same-value":
            yield* context.store.update(context.transaction, table, "a", {
              ["__proto__"]: "Alpha",
            });
            return;
          case "net-zero":
            yield* context.store.insert(context.transaction, table, {
              id: "net",
              ["__proto__"]: "Net",
              slug: "slug-net",
              rank: 1,
            });
            yield* context.store.delete(context.transaction, table, "net");
            return;
          case "receipt":
            yield* context.store.update(context.transaction, table, "a", {
              ["__proto__"]: "Pending receipt",
            });
            return;
          case "last-failure":
            yield* context.store.update(context.transaction, table, "a", {
              ["__proto__"]: "Pending failure",
            });
            return yield* Effect.fail(relationalError("invalidInput"));
          default:
            return yield* Effect.fail(relationalError("invalidInput"));
        }
      }),
  );
  const caught = defineRelationalCommand(
    (context: RelationalCommandContext, kind: string) =>
      Effect.gen(function* () {
        const failure = yield* context
          .nested(context.transaction, bad, kind)
          .pipe(Effect.result);
        expect(Result.isFailure(failure)).toBe(true);
        if (kind === "unique" || kind === "check") {
          expect(receiptState.owner?.receipts()).toEqual([]);
          expect(failure).toMatchObject({
            _tag: "Failure",
            failure: {
              reason: "statementFailure",
              cause: { cause: { code: kind === "unique" ? "23505" : "23514" } },
            },
          });
        }
        const next = yield* context.store
          .table(context.transaction, identity)
          .pipe(Effect.result);
        expect(next).toMatchObject({
          _tag: "Failure",
          failure: { reason: "rollbackOnly" },
        });
        return "caught";
      }),
  );
  let held:
    | { transaction: RelationalTransaction; table: RelationalTable }
    | undefined;
  const foreign = defineRelationalCommand(
    (context: RelationalCommandContext, _input: null) =>
      held === undefined
        ? Effect.die("Missing token test fixture")
        : context.store.get(context.transaction, held.table, "a"),
  );
  const entered = await runEffect(Deferred.make<void>());
  const cancelled = defineRelationalCommand(
    (context: RelationalCommandContext, _input: null) =>
      Effect.gen(function* () {
        const table = yield* context.store.table(context.transaction, identity);
        yield* context.store.update(context.transaction, table, "a", {
          ["__proto__"]: "pending-cancel",
        });
        yield* Deferred.succeed(entered, undefined);
        yield* Effect.never;
      }),
  );
  const timeout = defineRelationalCommand(
    (_context: RelationalCommandContext, _input: null) => Effect.never,
  );
  const large = defineRelationalCommand(
    (_context: RelationalCommandContext, input: string) =>
      Effect.succeed(input.length),
  );
  const largeOutput = defineRelationalCommand(
    (_context: RelationalCommandContext, _input: null) =>
      Effect.succeed("x".repeat(1_100_000)),
  );
  const childEntered = await runEffect(Deferred.make<void>());
  const child = defineRelationalCommand(
    (_context: RelationalCommandContext, _input: null) =>
      Effect.gen(function* () {
        yield* Deferred.succeed(childEntered, undefined);
        yield* Effect.sleep("100 millis");
      }),
  );
  const openChild = defineRelationalCommand(
    (context: RelationalCommandContext, _input: null) =>
      Effect.gen(function* () {
        yield* Effect.forkChild(
          context.nested(context.transaction, child, null),
        );
        yield* Deferred.await(childEntered);
      }),
  );
  const host = await runEffect(
    makeRelationalHost(
      {
        database: fixture.target.drizzle,
        session,
        target,
        deploymentId: fixture.deploymentId,
        authority: fixture.authorityPorts,
        commands: [
          read,
          insert,
          mutate,
          bad,
          caught,
          foreign,
          cancelled,
          timeout,
          large,
          largeOutput,
          child,
          openChild,
        ],
      },
      {
        onCollection: (owner) => {
          receiptState.owner = owner;
        },
        beforeComplete: () =>
          Effect.gen(function* () {
            receiptState.completions++;
            if (receiptState.failReceipt)
              return yield* Effect.fail(
                publicationError("invalidReceiptAuthority"),
              );
          }),
        beforeAdmission: (owner, seal) =>
          owner.inspect(seal).pipe(
            Effect.tap((observations) =>
              Effect.sync(() => {
                receiptState.observations = observations;
              }),
            ),
          ),
      },
    ),
  );
  await runEffect(host.run(reference, read, null));
  expect(
    await runEffectFailure(host.run(reference, openChild, null)),
  ).toMatchObject({ reason: "receiptAdmissionClosed" });
  if (held === undefined) throw new Error("Missing captured transaction token");
  expect(
    await runEffectFailure(
      relationalStore.get(held.transaction, held.table, "a"),
    ),
  ).toMatchObject({ reason: "invalidAuthority" });
  expect(
    await runEffectFailure(host.run(reference, mutate, null)),
  ).toMatchObject({ reason: "unadmittedFinalization" });
  expect(
    receiptState.observations.map(
      ({ ordinal, operation, key, affectedRows }) => ({
        ordinal,
        operation,
        key,
        affectedRows,
      }),
    ),
  ).toEqual([
    { ordinal: 1, operation: "update", key: "a", affectedRows: 1 },
    { ordinal: 2, operation: "insert", key: "new", affectedRows: 1 },
    { ordinal: 3, operation: "update", key: "new", affectedRows: 1 },
    { ordinal: 4, operation: "delete", key: "a", affectedRows: 1 },
  ]);
  expect(receiptState.owner?.receipts()).toEqual([]);
  expect(
    await runEffectFailure(host.run(reference, foreign, null)),
  ).toMatchObject({ reason: "invalidAuthority" });
  for (const kind of [
    "unique",
    "check",
    "primary",
    "scope",
    "oversize",
    "list",
    "list-getter",
    "text-key",
    "text-row",
    "text-equal",
    "text-after",
    "calls",
    "rows",
    "owner",
    "forged",
    "borrowed",
    "transaction",
    "overlap",
  ]) {
    expect(
      await runEffectFailure(host.run(reference, caught, kind)),
      kind,
    ).toMatchObject({ reason: "rollbackOnly" });
  }
  expect(
    await runEffectFailure(host.run(reference, bad, "zero")),
  ).toMatchObject({ reason: "unadmittedFinalization" });
  expect(receiptState.observations).toMatchObject([
    { ordinal: 1, operation: "delete", affectedRows: 0 },
  ]);
  for (const kind of ["same-value", "net-zero"]) {
    expect(
      await runEffectFailure(host.run(reference, bad, kind)),
    ).toMatchObject({ reason: "unadmittedFinalization" });
    expect(receiptState.observations.length).toBe(
      kind === "same-value" ? 1 : 2,
    );
  }
  const beforeFailedReceipt = receiptState.completions;
  receiptState.failReceipt = true;
  expect(
    await runEffectFailure(host.run(reference, caught, "receipt")),
  ).toMatchObject({ reason: "rollbackOnly" });
  receiptState.failReceipt = false;
  expect(receiptState.completions).toBe(beforeFailedReceipt + 1);
  expect(receiptState.owner?.receipts()).toEqual([]);
  expect(
    await runEffectFailure(host.run(reference, bad, "last-failure")),
  ).toMatchObject({ reason: "invalidInput" });
  const fiber = Effect.runFork(host.run(reference, cancelled, null));
  await runEffect(Deferred.await(entered));
  await runEffect(Fiber.interrupt(fiber));
  await runEffect(host.run(reference, read, null));
  const unregistered = defineRelationalCommand(() => Effect.void);
  expect(
    await runEffectFailure(host.run(reference, unregistered, null)),
  ).toMatchObject({ reason: "invalidAuthority" });
  expect(
    await runEffectFailure(host.run(reference, large, "x".repeat(1_100_000))),
  ).toMatchObject({ reason: "limitExceeded" });
  expect(
    await runEffectFailure(host.run(reference, largeOutput, null)),
  ).toMatchObject({ reason: "limitExceeded" });
  await fixture.target.drizzle.execute(
    sql`update ${relation} set ${column("label")} = repeat('x', 70000) where scope_uuid = ${Result.getOrThrow(projectScopeIdUuidV1Result(fixture.active.basis.authority.scopeId)).scopeUuid}::uuid and ${column("id")} = 'a'`,
  );
  expect(await runEffectFailure(host.run(reference, read, null))).toMatchObject(
    { reason: "limitExceeded" },
  );
  await fixture.target.drizzle.execute(
    sql`update ${relation} set ${column("label")} = 'Alpha' where scope_uuid = ${Result.getOrThrow(projectScopeIdUuidV1Result(fixture.active.basis.authority.scopeId)).scopeUuid}::uuid and ${column("id")} = 'a'`,
  );
  const persisted = await fixture.target.drizzle.execute(
    sql`select ${column("id")} as id, ${column("label")} as label from ${relation} where scope_uuid = ${Result.getOrThrow(projectScopeIdUuidV1Result(fixture.active.basis.authority.scopeId)).scopeUuid}::uuid order by ${column("id")}`,
  );
  expect(persisted).toMatchObject({
    rows: [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
    ],
  });
  expect(
    await fixture.target.drizzle.select().from(fxSystemScopeClocks),
  ).toEqual(baseline);
  expect(await fixture.target.drizzle.select().from(fxSystemCommits)).toEqual(
    commits,
  );
  expect(await fixture.target.drizzle.select().from(fxSystemCommitWakes)).toEqual(
    wakes,
  );
  expect(
    await fixture.target.drizzle.select().from(fxSystemCommitAppRowChanges),
  ).toEqual(appFacts);
  expect(
    await fixture.target.drizzle
      .select()
      .from(fxSystemCommitRelationAdjacencyChanges),
  ).toEqual(relationFacts);
  expect(
    await fixture.target.drizzle.select().from(fxSystemIdempotency),
  ).toEqual(outcomes);
  const withdrawn = await changeBindingAvailability(
    fixture,
    prepared.availability,
    "withdrawn",
  );
  expect(await runEffectFailure(host.run(reference, read, null))).toMatchObject(
    { reason: "unavailableInstallation" },
  );
  const restored = await changeBindingAvailability(fixture, withdrawn, "ready");
  const currentReference = installationBindingReference(restored);
  return { host, read, timeout, reference: currentReference, restored };
}
