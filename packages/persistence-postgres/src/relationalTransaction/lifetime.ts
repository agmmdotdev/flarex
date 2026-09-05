import { Clock, Effect } from "effect";
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
  const state: RelationalLifetime = {
    tx,
    authority,
    scopeUuid: projected.scopeUuid,
    admission,
    tables: layout.tables,
    expiresAt: (yield* Clock.currentTimeMillis) + relationalLimits.commandMs,
    status: "open",
    busy: false,
    mutationAttempted: false,
    calls: 0,
    returnedRows: 0,
    bytes: 0,
    onClose: [],
  };
  transactions.set(token, state);
  return yield* Effect.suspend(() => work(token)).pipe(
    Effect.tapCause(() =>
      Effect.sync(() => {
        state.status = "rollbackOnly";
      }),
    ),
    Effect.flatMap((value) =>
      state.status !== "open"
        ? Effect.fail(relationalError("rollbackOnly"))
        : state.mutationAttempted
          ? Effect.fail(relationalError("unadmittedFinalization"))
          : Effect.succeed(value),
    ),
    Effect.ensuring(
      Effect.sync(() => {
        state.status = "closing";
        for (const close of state.onClose) close();
        state.onClose.length = 0;
        transactions.delete(token);
        state.status = "closed";
      }),
    ),
  );
});
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
    state.status = "rollbackOnly";
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
        state.status = "rollbackOnly";
      }),
    ),
  );
});
