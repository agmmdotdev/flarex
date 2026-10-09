import { Effect, Schema } from "effect";
import { sql } from "drizzle-orm";
import { projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import type { AppDocumentIdV1 } from "flarex-protocol/app-document-id";
import {
  requireCmsAdmission,
  type CmsAdmission,
} from "../cmsTransaction/admission";
import {
  requireCmsPendingDeletion,
  requireCmsClosedPendingDeletion,
  type CmsPendingDeletions,
} from "../cmsTransaction/documents";
import type { CmsRequestLifetime } from "../cmsTransaction/lifetime";
import {
  cmsError,
  cmsLimits,
  type CmsRequestContext,
  type CmsPresentedTransactionId,
  type CmsTransactionError,
} from "../cmsTransaction/model";
import { capturePrivateJsonData } from "../../values/privateJsonData";
import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";
import { rowsFromDriverExecuteResult } from "../../database/driverExecuteResult";

export interface PayloadPreferenceCleanup {
  readonly deleteForPendingDocument: (
    context: CmsRequestContext,
    transactionId: CmsPresentedTransactionId,
    collectionSlug: string,
    selector: unknown,
  ) => Effect.Effect<void, CmsTransactionError>;
}
interface DeletionIntent {
  readonly documentId: AppDocumentIdV1;
  readonly collectionSlug: string;
  readonly key: string;
}
interface DeletionEvidence extends DeletionIntent {
  readonly preferenceIds: readonly string[];
}
declare const closureBrand: unique symbol;
export interface PayloadPreferenceCleanupClosure {
  readonly [closureBrand]: true;
}
const closures = new WeakMap<
  object,
  Readonly<{
    admission: CmsAdmission;
    lifetime: CmsRequestLifetime;
    pendingDeletions: CmsPendingDeletions;
    intents: readonly DeletionIntent[];
  }>
>();
const decodeSelector = Schema.decodeUnknownEffect(
  Schema.Struct({ key: Schema.Struct({ in: Schema.Tuple([Schema.String]) }) }),
  { onExcessProperty: "error" },
);
const decodeIds = Schema.decodeUnknownEffect(
  Schema.Array(
    Schema.Struct({
      id: Schema.String.check(
        Schema.makeFilter((value) =>
          value.length > 0 && value.length <= 512
            ? undefined
            : "Invalid preference identity",
        ),
      ),
    }),
  ),
);
const readIds = Effect.fn("PayloadPreferences.readIds")(function* (
  result: unknown,
) {
  const rows = yield* Effect.try({
    try: () =>
      rowsFromDriverExecuteResult(result, () => {
        throw cmsError("storedCorruption");
      }),
    catch: (cause) => cmsError("storedCorruption", cause),
  });
  return (yield* decodeIds(rows).pipe(
    Effect.mapError((cause) => cmsError("storedCorruption", cause)),
  )).map((row) => row.id);
});

/** Capture supported cleanup intent without acquiring business locks or issuing DML. */
export const makePayloadPreferenceCleanup = Effect.fn(
  "PayloadPreferences.makeCleanup",
)(function* (
  admission: CmsAdmission,
  lifetime: CmsRequestLifetime,
  pendingDeletions: CmsPendingDeletions,
) {
  const state = yield* requireCmsAdmission(admission);
  const intents: DeletionIntent[] = [];
  const keys = new Set<string>();
  let closed = false;
  const deleteForPendingDocument: PayloadPreferenceCleanup["deleteForPendingDocument"] =
    Effect.fn("PayloadPreferences.deleteForPendingDocument")(
      (context, transactionId, collectionSlug, selector) =>
        lifetime.operation(
          context,
          transactionId,
          "write",
          Effect.gen(function* () {
            yield* requireCmsAdmission(admission, state.tx);
            if (closed) return yield* Effect.fail(cmsError("closed"));
            if (state.preferenceAvailability === null)
              return yield* Effect.fail(cmsError("unsupportedProfile"));
            const captured = yield* Effect.fromResult(
              capturePrivateJsonData(
                selector,
                lifetime.remainingBytes(),
                cmsError,
              ),
            );
            yield* Effect.fromResult(lifetime.charge(captured.bytes));
            const value = yield* decodeSelector(captured.value).pipe(
              Effect.mapError((cause) => cmsError("invalidInput", cause)),
            );
            const prefix = `collection-${collectionSlug}-`;
            if (
              !state.configuration.tables.some(
                (table) => table.collectionSlug === collectionSlug,
              ) ||
              !value.key.in[0].startsWith(prefix)
            ) {
              return yield* Effect.fail(cmsError("invalidInput"));
            }
            const key = value.key.in[0];
            if (keys.has(key))
              return yield* Effect.fail(cmsError("invalidInput"));
            const pending = yield* requireCmsPendingDeletion(
              pendingDeletions,
              admission,
              lifetime,
              key.slice(prefix.length),
            );
            if (
              pending.collectionSlug !== collectionSlug ||
              key !==
                `collection-${pending.collectionSlug}-${pending.documentId}`
            ) {
              return yield* Effect.fail(cmsError("invalidAuthority"));
            }
            yield* Effect.fromResult(lifetime.charge(128));
            intents.push(
              Object.freeze({
                documentId: pending.documentId,
                collectionSlug,
                key,
              }),
            );
            keys.add(key);
          }),
        ),
    );
  const close = Effect.fn("PayloadPreferences.closeCleanup")(function* () {
    yield* requireCmsAdmission(admission);
    if (closed || !lifetime.isClosing())
      return yield* Effect.fail(cmsError("invalidAuthority"));
    closed = true;
    // SAFETY: the registry binds immutable intents to the closing request.
    const closure = Object.freeze({}) as PayloadPreferenceCleanupClosure;
    closures.set(
      closure,
      Object.freeze({
        admission,
        lifetime,
        pendingDeletions,
        intents: Object.freeze([...intents]),
      }),
    );
    return closure;
  });
  return Object.freeze({
    cleanup: Object.freeze({ deleteForPendingDocument }),
    close,
  });
});

/** Only settlement applies the captured intents; returned facts attest actual deletes. */
export const applyPayloadPreferenceCleanup = Effect.fn(
  "PayloadPreferences.applyCleanup",
)(function* (
  closure: PayloadPreferenceCleanupClosure,
  admission: CmsAdmission,
  lifetime: CmsRequestLifetime,
  pendingDeletions: CmsPendingDeletions,
) {
  const captured = closures.get(closure);
  if (
    captured === undefined ||
    captured.admission !== admission ||
    captured.lifetime !== lifetime ||
    captured.pendingDeletions !== pendingDeletions ||
    !lifetime.isClosing()
  )
    return yield* Effect.fail(cmsError("invalidAuthority"));
  const state = yield* requireCmsAdmission(admission);
  closures.delete(closure);
  const evidence: DeletionEvidence[] = [];
  if (captured.intents.length === 0) return Object.freeze(evidence);
  const availability = state.preferenceAvailability;
  if (availability === null)
    return yield* Effect.fail(cmsError("invalidAuthority"));
  const scope = yield* Effect.fromResult(
    projectScopeIdUuidV1Result(state.authority.scopeId),
  ).pipe(Effect.mapError((cause) => cmsError("invalidAuthority", cause)));
  const layout = availability.physicalLayout;
  const physical = layout.tables[0];
  if (physical === undefined)
    return yield* Effect.fail(cmsError("storedCorruption"));
  const generation = physical.columns.find(
    (column) => column.identity.columnId === "storage_generation",
  );
  const identity = physical.columns.find(
    (column) => column.identity.columnId === "id",
  );
  const lookup = physical.columns.find(
    (column) => column.identity.columnId === "key",
  );
  if (
    generation === undefined ||
    identity === undefined ||
    lookup === undefined
  )
    return yield* Effect.fail(cmsError("storedCorruption"));
  const table = sql`${sql.identifier(layout.targetNamespace.schemaName)}.${sql.identifier(physical.name)}`;
  const id = sql.identifier(identity.name);
  let identityCount = 0;
  for (const intent of captured.intents) {
    const pending = yield* requireCmsClosedPendingDeletion(
      pendingDeletions,
      admission,
      lifetime,
      intent.documentId,
    );
    if (
      pending.collectionSlug !== intent.collectionSlug ||
      intent.key !==
        `collection-${pending.collectionSlug}-${pending.documentId}`
    ) {
      return yield* Effect.fail(cmsError("invalidAuthority"));
    }
    const where = sql`${sql.identifier("scope_uuid")} = ${scope.scopeUuid}::uuid and ${sql.identifier(generation.name)} = ${state.authority.storageGeneration}
      and ${sql.identifier(lookup.name)} = ${intent.key}`;
    const budget = cmsLimits.identities - identityCount;
    const selected = yield* runDrizzleStatementEffect(
      state.tx.execute(sql`select
      case when octet_length(${id}) between 1 and 2048 then ${id} else null end as id
      from ${table} where ${where} order by ${id} limit ${budget + 1} for update`),
      (cause) => cmsError("statementFailure", cause),
    ).pipe(Effect.flatMap(readIds));
    if (selected.length > budget)
      return yield* Effect.fail(cmsError("limitExceeded"));
    yield* Effect.fromResult(
      lifetime.charge(
        selected.reduce(
          (bytes, preferenceId) => bytes + preferenceId.length * 4 + 64,
          0,
        ),
      ),
    );
    if (selected.length > 0) {
      const deleted = yield* runDrizzleStatementEffect(
        state.tx.execute(sql`delete from ${table} where ${where}
        and ${id} in (${sql.join(
          selected.map((preferenceId) => sql`${preferenceId}`),
          sql`, `,
        )}) returning ${id} as id`),
        (cause) => cmsError("statementFailure", cause),
      ).pipe(Effect.flatMap(readIds));
      const exact = new Set(selected);
      if (
        exact.size !== selected.length ||
        deleted.length !== selected.length ||
        new Set(deleted).size !== deleted.length ||
        deleted.some((preferenceId) => !exact.has(preferenceId))
      )
        return yield* Effect.fail(cmsError("storedCorruption"));
    }
    identityCount += selected.length;
    evidence.push(
      Object.freeze({ ...intent, preferenceIds: Object.freeze(selected) }),
    );
  }
  return Object.freeze(evidence);
});
