import { Effect, Option } from "effect";
import {
  AppCreationTimeV1Schema,
  type AppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1FromBytesResult,
  type AppDocumentIdV1,
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import { isJsonObject } from "flarex-protocol/json";
import {
  canonicalizeFlarexValueV1Effect,
  type CanonicalFlarexValueV1,
} from "flarex-protocol/value";
import {
  readBoundedCurrentAppRowsInTransactionEffect,
  InvalidAppRowReadInputError,
  AppRowReadPersistenceError,
  type AppRowRevisionV1,
} from "../../src/storage/documents/appRows";
import {
  deriveApplicationSyscallValidator,
  validateApplicationRevisionSyscallDocumentInTransactionV1,
} from "../../src/application/revision/applicationRevisionSyscallValidatorV1";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../../src/storage/unique/appUniqueConstraintDefinitions";
import { lowerCanonicalAppUniqueConstraintV1Result } from "../../src/storage/unique/appUniqueConstraintCommitV1";
import {
  readAppUniqueKeySlotInTransactionEffect,
} from "../../src/storage/unique/appUniqueKeys";
import {
  AppUniqueKeyPersistenceError,
  AppUniqueKeyHashError,
} from "../../src/storage/unique/appUniqueKeyErrors";
import { capturePrivateJsonData } from "../../src/values/privateJsonData";
import {
  requireCmsAdmission,
  type CmsAdmission,
} from "../../src/frameworks/cmsTransaction/admission";
import {
  cmsError,
  cmsLimits,
  CmsTransactionError,
} from "../../src/frameworks/cmsTransaction/model";
import type { CmsRequestLifetime } from "../../src/frameworks/cmsTransaction/lifetime";
import type { LogicalDocumentChange } from "../../src/storage/documents/logicalDocuments/workingSet";

/** Fixed test-only first-insert execution; no public document API or closure capability.
 * Schema validation, bounded readers and lifetime are explicit common components. */
export const makeCe0FirstInsertDocuments = Effect.fn("Ce0InsertDocuments.make")(
  function* (
    admission: CmsAdmission,
    lifetime: CmsRequestLifetime,
    transactionId: string,
    creationTime: AppCreationTimeV1,
    uniqueDefinitions: readonly LocatedAppUniqueConstraintDefinitionV1[],
  ) {
    const state = yield* requireCmsAdmission(admission);
    const managed = new Set(
      state.frame.payloadContent?.tables.map((table) => table.tableId),
    );
    const table = state.schema.tables.find(
      (table) =>
        table.logicalName === "posts" && managed.has(table.tableId.toString()),
    );
    if (table === undefined)
      return yield* Effect.fail(cmsError("invalidAuthority"));
    const validator = yield* deriveApplicationSyscallValidator({
      scopeId: state.authority.scopeId,
      schemaVersionId: state.schema.schemaVersionId,
      schemaManifest: state.schema.manifest,
    });
    const definitions = uniqueDefinitions.filter(
      (definition) => definition.tableId === table.tableId,
    );
    const loaded = new Map<AppDocumentIdV1, AppRowRevisionV1>();
    const pending = new Map<
      AppDocumentIdV1,
      Extract<LogicalDocumentChange, { readonly kind: "live" }>
    >();
    let closed = false;
    let inserted = 0;
    const observed = new Set<AppDocumentIdV1>();
    const observedUnique = new Set<string>();
    const charge = (bytes: number) => Effect.fromResult(lifetime.charge(bytes));
    const read = Effect.fn("Ce0InsertDocuments.readIdentity")(function* (
      rowId: AppRowIdHexV1,
    ) {
      yield* requireCmsAdmission(admission, state.tx);
      if (closed) return yield* Effect.fail(cmsError("closed"));
      const id = appDocumentIdV1FromRowIdentity({
        tableId: table.tableId,
        rowId,
      });
      if (pending.has(id) || observed.has(id)) return;
      const rows = yield* readBoundedCurrentAppRowsInTransactionEffect(
        state.tx,
        {
          scopeId: state.authority.scopeId,
          tableId: table.tableId,
          minimumCommitSeq: state.clock.lastCommitSeq,
          maximumIdentities: cmsLimits.identities,
          maximumDocumentBytes: cmsLimits.documentBytes,
          maximumTotalValueBytes: lifetime.remainingBytes(),
          rowId,
        },
      ).pipe(
        Effect.mapError((cause) =>
          cmsError(
            cause instanceof InvalidAppRowReadInputError &&
              cause.issue.reason === "rowLimitExceeded"
              ? "limitExceeded"
              : cause instanceof AppRowReadPersistenceError
                ? "statementFailure"
                : "storedCorruption",
            cause,
          ),
        ),
      );
      yield* charge(128);
      observed.add(id);
      for (const row of rows.rows) {
        if (pending.size + loaded.size >= cmsLimits.identities)
          return yield* Effect.fail(cmsError("limitExceeded"));
        yield* charge(
          128 +
            (row.kind === "live" ? row.document.canonicalBytes.byteLength : 0),
        );
        loaded.set(appDocumentIdV1FromRowIdentity(row), row);
      }
    });
    const insert = Effect.fn("Ce0InsertDocuments.insert")((title: string) =>
      lifetime.operation(
        lifetime.context,
        transactionId,
        "write",
        Effect.gen(function* () {
          const fields = yield* Effect.fromResult(
            capturePrivateJsonData(
              { title },
              Math.min(cmsLimits.documentBytes, lifetime.remainingBytes()),
              cmsError,
            ),
          );
          if (!isJsonObject(fields.value))
            return yield* Effect.fail(cmsError("documentInvalid"));
          yield* charge(fields.bytes);
          if (pending.size + loaded.size >= cmsLimits.identities)
            return yield* Effect.fail(cmsError("limitExceeded"));
          yield* charge(128);
          const rowId = yield* Effect.fromResult(
            appRowIdHexV1FromBytesResult(
              crypto.getRandomValues(new Uint8Array(16)),
            ),
          ).pipe(
            Effect.mapError((cause) => cmsError("resourceFailure", cause)),
          );
          const documentId = appDocumentIdV1FromRowIdentity({
            tableId: table.tableId,
            rowId,
          });
          yield* read(rowId);
          if (pending.has(documentId) || loaded.has(documentId))
            return yield* Effect.fail(cmsError("uniqueConflict"));
          const time = AppCreationTimeV1Schema.make(creationTime + inserted++);
          const document = yield* canonicalizeFlarexValueV1Effect(
            {
              ...fields.value,
              _id: documentId,
              _creationTime: time,
            },
            "appDocument",
          ).pipe(
            Effect.mapError((cause) => cmsError("documentInvalid", cause)),
          );
          if (document.canonicalBytes.byteLength > cmsLimits.documentBytes)
            return yield* Effect.fail(cmsError("limitExceeded"));
          yield* validateApplicationRevisionSyscallDocumentInTransactionV1(
            validator,
            state.tx,
            {
              anchor: { scopeId: state.authority.scopeId },
              executionPin: { schemaVersionId: state.schema.schemaVersionId },
              scopeClock: state.clock,
            },
            {
              operation: "insert",
              tableName: table.logicalName,
              tableId: table.tableId,
              documentId,
              creationTime: time,
              document,
            },
          ).pipe(
            Effect.mapError((cause) => cmsError("documentInvalid", cause)),
          );
          for (const definition of definitions) {
            const key = yield* Effect.fromResult(
              lowerCanonicalAppUniqueConstraintV1Result(definition, document),
            ).pipe(
              Effect.mapError((cause) => cmsError("documentInvalid", cause)),
            );
            if (key.kind !== "claim") continue;
            const slot = yield* readAppUniqueKeySlotInTransactionEffect(
              state.tx,
              {
                scopeId: state.authority.scopeId,
                constraintId: definition.uniqueConstraintDefinitionId,
                key: key.projection,
              },
            ).pipe(
              Effect.mapError((cause) =>
                cmsError(
                  cause instanceof AppUniqueKeyPersistenceError
                    ? "statementFailure"
                    : cause instanceof AppUniqueKeyHashError
                      ? "resourceFailure"
                      : "storedCorruption",
                  cause,
                ),
              ),
            );
            const observation = JSON.stringify([definition.uniqueConstraintDefinitionId, key.localeKey, key.encodedKey]);
            if (!observedUnique.has(observation)) {
              yield* charge(128 + key.canonicalKeyBytes.byteLength);
              observedUnique.add(observation);
            }
            if (Option.isSome(slot)) {
              if (slot.value.tableId !== table.tableId)
                return yield* Effect.fail(cmsError("storedCorruption"));
              yield* read(slot.value.rowId);
              const owner = loaded.get(
                appDocumentIdV1FromRowIdentity(slot.value),
              );
              if (owner?.kind !== "live")
                return yield* Effect.fail(cmsError("storedCorruption"));
              const actual = yield* Effect.fromResult(
                lowerCanonicalAppUniqueConstraintV1Result(
                  definition,
                  owner.document,
                ),
              ).pipe(
                Effect.mapError((cause) => cmsError("storedCorruption", cause)),
              );
              if (
                actual.kind !== "claim" ||
                actual.localeKey !== key.localeKey ||
                actual.encodedKey !== key.encodedKey
              )
                return yield* Effect.fail(cmsError("storedCorruption"));
            }
            // A first-insert profile cannot release a committed owner's claim.
            // Still authenticate that owner above before reporting business conflict.
            const prior: CanonicalFlarexValueV1[] = [
              ...Array.from(loaded.values()).flatMap((row) =>
                row.kind === "live" ? [row.document] : [],
              ),
              ...Array.from(pending.values(), (row) => row.document),
            ];
            for (const other of prior) {
              const actual = yield* Effect.fromResult(
                lowerCanonicalAppUniqueConstraintV1Result(definition, other),
              ).pipe(
                Effect.mapError((cause) => cmsError("storedCorruption", cause)),
              );
              if (
                actual.kind === "claim" &&
                actual.localeKey === key.localeKey &&
                actual.encodedKey === key.encodedKey
              )
                return yield* Effect.fail(
                  new CmsTransactionError({
                    reason: "uniqueConflict",
                    uniqueConstraint: Object.freeze({
                      tableName: table.logicalName,
                      orderedFields: Object.freeze([
                        ...definition.physicalSpec.orderedFields,
                      ]),
                    }),
                  }),
                );
            }
          }
          if (pending.size + loaded.size >= cmsLimits.identities)
            return yield* Effect.fail(cmsError("limitExceeded"));
          yield* charge(document.canonicalBytes.byteLength);
          yield* charge(128);
          pending.set(
            documentId,
            Object.freeze({
            kind: "live",
            readAt: state.clock.lastCommitSeq,
              tableId: table.tableId,
              rowId,
              documentId,
              creationTime: time,
              document,
              dependency: {
                kind: "appRowPoint",
                documentId,
                observed: {
                  kind: "missing",
                  basis: { kind: "noVisibleRevision" },
                },
              },
            } satisfies LogicalDocumentChange),
          );
          const output = yield* Effect.fromResult(
            capturePrivateJsonData(
              document.value,
              cmsLimits.documentBytes,
              cmsError,
            ),
          );
          if (!isJsonObject(output.value))
            return yield* Effect.fail(cmsError("storedCorruption"));
          yield* charge(output.bytes);
          return output.value;
        }),
      ),
    );
    const close = Effect.fn("Ce0InsertDocuments.close")(function* () {
      if (closed || !lifetime.isClosing())
        return yield* Effect.fail(cmsError("invalidAuthority"));
      yield* requireCmsAdmission(admission);
      closed = true;
      const changes = Object.freeze(
        Array.from(pending.values()).sort(
          (a, b) => a.tableId - b.tableId || a.rowId.localeCompare(b.rowId),
        ),
      );
      return Object.freeze({ changes, receiptCount: changes.length });
    });
    return Object.freeze({ insert, close });
  },
);
