import {
  type ApplicationRelationQuerySystemTestFixture,
} from
  "@flarex/persistence-postgres/internal/system-test/application-relation-query-fixture";
import {
  openApplicationRelationQuerySnapshot,
  readApplicationRelationQueryIncomingSources,
} from
  "@flarex/persistence-postgres/internal/application-query-snapshot";
import {
  ScopeExecutionLive,
} from "@flarex/persistence-postgres/internal/scope-execution";
import {
  ApplicationRelationQuerySystem,
  decodeTakeIncomingRelationSourcesInput,
  makeApplicationRelationQuerySystemLayer,
  type TakeIncomingRelationSourcesInput,
} from
  "@flarex/standard-application-invocation/internal/application-relation-query-system";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Effect, Result } from "effect";
import {
  appRowIdHexV1ToBytes,
  decodeAppDocumentIdentityV1,
} from "flarex-protocol/app-document-id";

interface IncomingPageQueryObservation {
  readonly name: string;
  readonly sql: string;
  readonly params: ReadonlyArray<unknown>;
}

export interface ApplicationRelationQueryProof {
  readonly invalidInput: Readonly<{
    readonly activeReadCount: number;
    readonly failures: ReadonlyArray<Readonly<{
      readonly tag: string;
      readonly path: string;
    }>>;
    readonly accessorReadCount: number;
  }>;
  readonly fullPage: Readonly<{
    readonly sourceDocumentIds: ReadonlyArray<string>;
    readonly duplicateOrdinals: ReadonlyArray<number>;
    readonly positions: ReadonlyArray<number | null>;
    readonly exhausted: boolean;
  }>;
  readonly emptyPage: Readonly<{
    readonly sourceCount: number;
    readonly exhausted: boolean;
  }>;
  readonly exactLimitPage: Readonly<{
    readonly sourceDocumentIds: ReadonlyArray<string>;
    readonly exhausted: boolean;
  }>;
  readonly expectedFullPageSourceDocumentIds: ReadonlyArray<string>;
  readonly expectedExactLimitSourceDocumentIds: ReadonlyArray<string>;
  readonly activeReadCountAfterSuccess: number;
  readonly readOnlyStateStable: boolean;
  readonly legacyActive: Readonly<{
    readonly tag: string;
    readonly operation: string | null;
    readonly reason: string | null;
    readonly retryable: boolean | null;
    readonly edgeStorageGuarded: boolean;
  }>;
  readonly staleSelection: Readonly<{
    readonly tag: string;
    readonly operation: string | null;
    readonly reason: string | null;
    readonly edgeStorageGuarded: boolean;
  }>;
  readonly foreignTableTarget: Readonly<{
    readonly tag: string;
    readonly operation: string | null;
    readonly reason: string | null;
    readonly retryable: boolean | null;
    readonly edgeStorageGuarded: boolean;
  }>;
  readonly snapshotChanged: Readonly<{
    readonly tag: string;
    readonly operation: string | null;
    readonly reason: string | null;
    readonly retryable: boolean | null;
    readonly observedPageQueries: number;
    readonly pageQuery: Readonly<{
      readonly name: string;
      readonly normalizedSql: string;
      readonly placeholders: ReadonlyArray<string>;
      readonly parameterCount: number;
      readonly parametersMatch: boolean;
      readonly limitParameter: number | null;
    }>;
  }>;
}

export async function proveApplicationRelationQuery(
  createFixture: () => Promise<ApplicationRelationQuerySystemTestFixture>,
): Promise<ApplicationRelationQueryProof> {
  const fixture = await createFixture();
  let activeReadCount = 0;
  const layer = makeApplicationRelationQuerySystemLayer({
    activation: {
      readActive: () => {
        activeReadCount += 1;
        return fixture.activation.readActive();
      },
    },
    snapshot: fixture.snapshot,
  });
  const input = takeInput(fixture, fixture.target, 128);
  const emptyInput = takeInput(fixture, fixture.emptyTarget, 128);
  const exactInput = takeInput(fixture, fixture.exactTarget, 128);
  let accessorReadCount = 0;
  const accessorInput: Record<string, unknown> = {
    relation: input.relation,
    limit: input.limit,
  };
  Object.defineProperty(accessorInput, "target", {
    enumerable: true,
    get: () => {
      accessorReadCount += 1;
      throw new Error("The relation query decoder invoked an accessor.");
    },
  });
  Object.freeze(accessorInput);
  const invalidInputs = Object.freeze([
    Object.freeze({ ...input, extra: true }),
    Object.freeze({
      ...input,
      relation: Object.freeze({ ...input.relation, extra: true }),
    }),
    Object.freeze({
      ...input,
      relation: Object.freeze({
        source: Object.freeze({
          ...input.relation.source,
          path: Object.freeze([
            ...input.relation.source.path,
            Object.freeze({ kind: "field", name: "extra" }),
          ]),
        }),
      }),
    }),
    accessorInput,
    Object.freeze({ ...input, limit: 129 }),
  ]);
  const invalidResults = await Effect.runPromise(Effect.gen(function* () {
    const system = yield* ApplicationRelationQuerySystem;
    return yield* Effect.forEach(
      invalidInputs,
      candidate => Effect.result(
        system.takeIncomingRelationSources(candidate),
      ),
      { concurrency: 1 },
    );
  }).pipe(Effect.provide(layer)));
  const invalidFailures = Object.freeze(invalidResults.map(result =>
    summarizeInputFailure(result)
  ));
  const invalidActiveReadCount = activeReadCount;

  const legacyActiveResult = await fixture.withEdgeStorageUnavailable(() =>
    Effect.runPromise(Effect.gen(function* () {
      const system = yield* ApplicationRelationQuerySystem;
      return yield* Effect.result(
        system.takeIncomingRelationSources(input),
      );
    }).pipe(Effect.provide(layer)))
  );
  const legacyActiveFailure = summarizeFailure(legacyActiveResult);

  await fixture.activateSuccessor();
  const stateBefore = await fixture.captureCoreState();
  const pages = await Effect.runPromise(Effect.gen(function* () {
    const system = yield* ApplicationRelationQuerySystem;
    const full = yield* system.takeIncomingRelationSources(input);
    const exact = yield* system.takeIncomingRelationSources(exactInput);
    const empty = yield* system.takeIncomingRelationSources(emptyInput);
    return Object.freeze({ full, exact, empty });
  }).pipe(Effect.provide(layer)));

  const staleResult = await fixture.withEdgeStorageUnavailable(() =>
    Effect.runPromise(Effect.gen(function* () {
      const system = yield* ApplicationRelationQuerySystem;
      return yield* Effect.result(
        system.selectionRelation.takeIncomingRelationSources(
          fixture.initialSelection,
          input,
        ),
      );
    }).pipe(Effect.provide(layer)))
  );
  const staleFailure = summarizeFailure(staleResult);

  const current = await Effect.runPromise(fixture.activation.readActive());
  const foreignTarget = fixture.expectedSources[0];
  if (foreignTarget === undefined) {
    throw new Error("Expected a relation-query source for table-mismatch proof.");
  }
  const foreignInput = takeInput(fixture, foreignTarget, 1);
  const foreignTargetResult = await fixture.withEdgeStorageUnavailable(() =>
    Effect.runPromise(Effect.gen(function* () {
      const system = yield* ApplicationRelationQuerySystem;
      return yield* Effect.result(
        system.selectionRelation.takeIncomingRelationSources(
          current.selection,
          foreignInput,
        ),
      );
    }).pipe(Effect.provide(layer)))
  );
  const foreignTargetFailure = summarizeFailure(foreignTargetResult);
  const stateAfter = await fixture.captureCoreState();

  const observedPageQueries: IncomingPageQueryObservation[] = [];
  const snapshotChangedResult = await Effect.runPromise(Effect.scoped(
    Effect.gen(function* () {
      const opened = yield* openApplicationRelationQuerySnapshot(
        current.selection,
        fixture.relation,
        fixture.snapshot,
      );
      yield* Effect.promise(() => fixture.applySnapshotChangingSource());
      return yield* Effect.result(
        readApplicationRelationQueryIncomingSources(
          opened.snapshot,
          fixture.target,
          128,
          {
            observeQuery: query => observedPageQueries.push(query),
          },
        ),
      );
    }),
  ).pipe(Effect.provide(ScopeExecutionLive)));
  const snapshotChangedFailure = summarizeFailure(snapshotChangedResult);
  const pageQuery = summarizeIncomingPageQuery(
    observedPageQueries,
    fixture,
  );

  return Object.freeze({
    invalidInput: Object.freeze({
      activeReadCount: invalidActiveReadCount,
      failures: invalidFailures,
      accessorReadCount,
    }),
    fullPage: Object.freeze({
      sourceDocumentIds: Object.freeze(
        pages.full.sources.map(source => source.sourceDocumentId),
      ),
      duplicateOrdinals: Object.freeze(
        pages.full.sources.map(source => source.duplicateOrdinal),
      ),
      positions: Object.freeze(
        pages.full.sources.map(source => source.position),
      ),
      exhausted: pages.full.exhausted,
    }),
    emptyPage: Object.freeze({
      sourceCount: pages.empty.sources.length,
      exhausted: pages.empty.exhausted,
    }),
    exactLimitPage: Object.freeze({
      sourceDocumentIds: Object.freeze(
        pages.exact.sources.map(source => source.sourceDocumentId),
      ),
      exhausted: pages.exact.exhausted,
    }),
    expectedFullPageSourceDocumentIds: Object.freeze(
      fixture.expectedSources.slice(0, 128),
    ),
    expectedExactLimitSourceDocumentIds: fixture.expectedExactSources,
    activeReadCountAfterSuccess: activeReadCount,
    readOnlyStateStable: deepStateEqual(stateBefore, stateAfter),
    legacyActive: Object.freeze({
      ...legacyActiveFailure,
      edgeStorageGuarded: true,
    }),
    staleSelection: Object.freeze({
      ...staleFailure,
      edgeStorageGuarded: true,
    }),
    foreignTableTarget: Object.freeze({
      ...foreignTargetFailure,
      edgeStorageGuarded: true,
    }),
    snapshotChanged: Object.freeze({
      ...snapshotChangedFailure,
      observedPageQueries: observedPageQueries.length,
      pageQuery,
    }),
  });
}

function summarizeIncomingPageQuery(
  observations: ReadonlyArray<IncomingPageQueryObservation>,
  fixture: ApplicationRelationQuerySystemTestFixture,
): ApplicationRelationQueryProof["snapshotChanged"]["pageQuery"] {
  const observation = observations[0];
  if (observation === undefined) {
    throw new Error("Expected one observed incoming-page query.");
  }
  const expectedTargetRowId = decodeAppDocumentIdentityV1(
    fixture.target,
  ).rowId;
  const expectedParams: ReadonlyArray<unknown> = Object.freeze([
    fixture.incomingPageQueryExpectation.scopeUuid,
    fixture.incomingPageQueryExpectation.edgeDefinitionId,
    appRowIdHexV1ToBytes(expectedTargetRowId),
    129,
  ]);
  const limitParameter = observation.params[3];
  return Object.freeze({
    name: observation.name,
    normalizedSql: normalizeSql(observation.sql),
    placeholders: Object.freeze(observation.sql.match(/\$[0-9]+/g) ?? []),
    parameterCount: observation.params.length,
    parametersMatch: queryParametersEqual(observation.params, expectedParams),
    limitParameter: typeof limitParameter === "number" ? limitParameter : null,
  });
}

function normalizeSql(sql: string): string {
  return sql.replaceAll('"', "").replace(/\s+/g, " ").trim();
}

function queryParametersEqual(
  actual: ReadonlyArray<unknown>,
  expected: ReadonlyArray<unknown>,
): boolean {
  return actual.length === expected.length && actual.every((value, index) => {
    const expectedValue = expected[index];
    if (value instanceof Uint8Array && expectedValue instanceof Uint8Array) {
      return value.length === expectedValue.length &&
        value.every((byte, byteIndex) => byte === expectedValue[byteIndex]);
    }
    return Object.is(value, expectedValue);
  });
}

function takeInput(
  fixture: ApplicationRelationQuerySystemTestFixture,
  target: ApplicationRelationQuerySystemTestFixture["target"],
  limit: number,
): TakeIncomingRelationSourcesInput {
  return Result.getOrThrow(decodeTakeIncomingRelationSourcesInput({
    relation: fixture.relation,
    target,
    limit,
  }));
}

function summarizeInputFailure(
  result: Result.Result<unknown, unknown>,
): Readonly<{ readonly tag: string; readonly path: string }> {
  if (Result.isSuccess(result)) {
    throw new Error("Expected strict relation-query input rejection.");
  }
  const failure = asRecord(result.failure);
  return Object.freeze({
    tag: readString(failure, "_tag") ?? "unknown",
    path: readString(failure, "path") ?? "unknown",
  });
}

function summarizeFailure(
  result: Result.Result<unknown, unknown>,
): Readonly<{
  readonly tag: string;
  readonly operation: string | null;
  readonly reason: string | null;
  readonly retryable: boolean | null;
}> {
  if (Result.isSuccess(result)) {
    throw new Error("Expected a relation-query failure.");
  }
  const failure = asRecord(result.failure);
  const issue = asRecord(failure?.issue);
  return Object.freeze({
    tag: readString(failure, "_tag") ?? "unknown",
    operation: readString(failure, "operation"),
    reason: readString(failure, "reason") ?? readString(issue, "reason"),
    retryable: readBoolean(failure, "retryable"),
  });
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return isNonArrayRecord(value) ? value : null;
}

function readString(
  record: Readonly<Record<string, unknown>> | null,
  key: string,
): string | null {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}

function readBoolean(
  record: Readonly<Record<string, unknown>> | null,
  key: string,
): boolean | null {
  const value = record?.[key];
  return typeof value === "boolean" ? value : null;
}

function deepStateEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left, jsonStateReplacer) ===
    JSON.stringify(right, jsonStateReplacer);
}

function jsonStateReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return `${value}n`;
  if (value instanceof Uint8Array) {
    return Object.freeze({ bytes: Array.from(value) });
  }
  if (value instanceof Date) return value.toISOString();
  return value;
}
