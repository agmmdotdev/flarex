import { Clock, Effect, Result } from "effect";
import { makePublicationCollection } from "../commitPublication/collection";
import { publicationError } from "../commitPublication/model";
import type {
  MutationRecorder,
  PublicationAdmissionError,
  PublicationTestHooks,
} from "../commitPublication/model";
import { projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { TrustedScopeAuthority } from "../scopeAuthorityResolution";
import type { RestoredFrameworkSchemaAvailabilityHead } from "../frameworkSchema/installation/storedMetadataRestoration";
import type { RelationalPhysicalTable } from "../relationalSchema/physical/model";
import { relationalError, relationalLimits } from "./model";
import type {
  RelationalTransaction,
  RelationalTransactionError,
} from "./model";

export interface RelationalLifetime {
  readonly tx: FlarexMetadataTransaction;
  readonly authority: TrustedScopeAuthority;
  readonly scopeUuid: string;
  readonly admission: RestoredFrameworkSchemaAvailabilityHead;
  readonly tables: readonly RelationalPhysicalTable[];
  readonly expiresAt: number;
  status: "open" | "rollbackOnly" | "closing" | "closed";
  busy: boolean;
  activeCommands: number;
  readonly recorder: MutationRecorder;
  mutationAttempted: boolean;
  calls: number;
  returnedRows: number;
  bytes: number;
  readonly onClose: (() => void)[];
}
const transactions = new WeakMap<object, RelationalLifetime>();
export const withRelationalLifetime = Effect.fn(
  "RelationalLifetime.withTransaction",
)(function* <Value, Failure>(
  tx: FlarexMetadataTransaction,
  authority: TrustedScopeAuthority,
  admission: RestoredFrameworkSchemaAvailabilityHead,
  work: (token: RelationalTransaction) => Effect.Effect<Value, Failure>,
  testHooks?: PublicationTestHooks,
) {
  const layout = admission.installation.plan.plan.physicalLayout.frame;
  if (
    layout.artifact.owner !== "system" ||
    layout.tables.length !== 1 ||
    layout.requiredPhysicalCapabilities.length !== 0 ||
    layout.relationships.length !== 0 ||
    layout.foreignKeys.some((key) => key.kind !== "scopeAuthorityForeignKey")
  )
    return yield* Effect.fail(relationalError("unsupportedProfile"));
  for (const table of layout.tables) {
    const primary = table.keys.filter((key) => key.kind === "primary");
    if (
      table.columns.length === 0 ||
      table.columns.length > relationalLimits.columns ||
      table.columns.some(
        (column) =>
          !["text", "integer"].includes(column.type) ||
          column.default.kind !== "none",
      ) ||
      primary.length !== 1 ||
      primary[0]?.columns.length !== 2 ||
      primary[0].columns[0] !== "scope_uuid" ||
      !table.columns.some(
        (column) =>
          column.name === primary[0]?.columns[1] &&
          column.type === "text" &&
          !column.nullable,
      )
    )
      return yield* Effect.fail(relationalError("unsupportedProfile"));
  }
  // SAFETY: the inert token is authenticated by this lifetime's WeakMap.
  const token = Object.freeze({}) as RelationalTransaction;
  const projected = yield* Effect.fromResult(
    projectScopeIdUuidV1Result(authority.scopeId),
  ).pipe(Effect.mapError(() => relationalError("invalidAuthority")));
  const collection = makePublicationCollection({
    ...(testHooks?.beforeComplete === undefined
      ? {}
      : { beforeComplete: testHooks.beforeComplete }),
    pins: { lifetime: token, transaction: tx, authority, admission },
    canRecord: () => state.status === "open" && state.busy,
    canSeal: () =>
      state.status === "closing" && !state.busy && state.activeCommands === 0,
    onFailure: () => {
      if (state.status === "open") state.status = "rollbackOnly";
    },
    charge: (bytes) => {
      if (state.bytes + bytes > relationalLimits.commandBytes)
        return Result.fail(publicationError("limitExceeded"));
      state.bytes += bytes;
      return Result.succeed(undefined);
    },
  });
  const state: RelationalLifetime = {
    tx,
    authority,
    scopeUuid: projected.scopeUuid,
    admission,
    tables: layout.tables,
    expiresAt: (yield* Clock.currentTimeMillis) + relationalLimits.commandMs,
    status: "open",
    busy: false,
    activeCommands: 0,
    recorder: collection.recorder,
    mutationAttempted: false,
    calls: 0,
    returnedRows: 0,
    bytes: 0,
    onClose: [],
  };
  transactions.set(token, state);
  return yield* Effect.sync(() =>
    testHooks?.onCollection?.(collection.owner),
  ).pipe(
    Effect.andThen(Effect.suspend(() => work(token))),
    Effect.tapCause(() =>
      Effect.sync(() => {
        if (state.status === "open") state.status = "rollbackOnly";
      }),
    ),
    Effect.flatMap((value) =>
      Effect.gen(function* () {
        if (state.status !== "open")
          return yield* Effect.fail(relationalError("rollbackOnly"));
        state.status = "closing";
        const seal = yield* collection.owner
          .seal(state.mutationAttempted)
          .pipe(Effect.mapError(projectPublicationError));
        if (testHooks?.beforeAdmission !== undefined)
          yield* testHooks
            .beforeAdmission(collection.owner, seal)
            .pipe(Effect.mapError(projectPublicationError));
        yield* collection.owner
          .admit(seal)
          .pipe(Effect.mapError(projectPublicationError));
        return value;
      }),
    ),
    Effect.ensuring(
      collection.owner.close.pipe(
        Effect.andThen(
          Effect.sync(() => {
            state.status = "closing";
            for (const close of state.onClose) close();
            state.onClose.length = 0;
            transactions.delete(token);
            state.status = "closed";
          }),
        ),
      ),
    ),
  );
});
/** One operation-boundary projection preserves the private admission reason and cause. */
export function projectPublicationError(
  error: PublicationAdmissionError,
): RelationalTransactionError {
  return relationalError(error.reason, error);
}
export const requireRelationalLifetime = Effect.fn(
  "RelationalLifetime.require",
)(function* (
  token: RelationalTransaction,
): Effect.fn.Return<RelationalLifetime, RelationalTransactionError> {
  const state = transactions.get(token);
  if (state === undefined)
    return yield* Effect.fail(relationalError("invalidAuthority"));
  if (state.status !== "open")
    return yield* Effect.fail(
      relationalError(
        state.status === "rollbackOnly" ? "rollbackOnly" : "closed",
      ),
    );
  if ((yield* Clock.currentTimeMillis) >= state.expiresAt) {
    if (state.status === "open") state.status = "rollbackOnly";
    return yield* Effect.fail(relationalError("deadlineExceeded"));
  }
  return state;
});
export const guardRelationalOperation = Effect.fn(
  "RelationalLifetime.operation",
)(function* <Value>(
  token: RelationalTransaction,
  work: (
    state: RelationalLifetime,
  ) => Effect.Effect<Value, RelationalTransactionError>,
) {
  const state = yield* requireRelationalLifetime(token);
  return yield* Effect.gen(function* () {
    state.calls += 1;
    if (state.busy)
      return yield* Effect.fail(relationalError("overlappingOperation"));
    if (state.calls > relationalLimits.calls)
      return yield* Effect.fail(relationalError("limitExceeded"));
    state.busy = true;
    return yield* work(state).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          state.busy = false;
        }),
      ),
    );
  }).pipe(
    Effect.tapCause(() =>
      Effect.sync(() => {
        if (state.status === "open") state.status = "rollbackOnly";
      }),
    ),
  );
});
