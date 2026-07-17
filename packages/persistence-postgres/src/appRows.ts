import { and, desc, eq, lte } from "drizzle-orm";
import type { PgTransactionConfig } from "drizzle-orm/pg-core";
import {
  decodeAppCreationTimeV1,
  verifyAppDocumentEvidenceV1,
  type AppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  appRowIdHexV1FromBytes,
  appRowIdHexV1ToBytes,
  decodeAppRowIdHexV1,
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  decodeCatalogTableId,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import {
  decodeCatalogSchemaVersionId,
  type CatalogSchemaVersionId,
} from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  SnapshotTokenSchema,
  decodeScopeEpochUuidV1,
  decodeScopeUuidV1,
  projectScopeEpochUuidV1,
  projectScopeIdUuidV1,
  type CommitSeq,
  type ScopeEpoch,
  type ScopeEpochUuidV1,
  type ScopeId,
  type ScopeUuidV1,
  type SnapshotToken,
} from "flarex-protocol/storage-authority";
import {
  FLAREX_VALUE_CODEC_VERSION_V1,
  type CanonicalFlarexValueBytesV1,
  type CanonicalFlarexValueV1,
  type FlarexValueCodecVersion,
  type FlarexValueSha256V1,
} from "flarex-protocol/value";

import type { FlarexMetadataDatabase } from "./deployments";
import {
  fxAppRowCurrent,
  fxAppRowRevisions,
  fxSystemScopeClocks,
} from "./schema";

export type AppRowTransaction = FlarexMetadataDatabase & {
  rollback(): never;
  setTransaction(config: PgTransactionConfig): Promise<void>;
};

export interface AppRowIdentityV1 {
  readonly scopeId: ScopeId;
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
}

export interface ReadAppRowAtSnapshotV1Input extends AppRowIdentityV1 {
  readonly snapshotCommitSeq: CommitSeq;
}

export interface GetAppRowAtSnapshotV1Input {
  readonly snapshotToken: SnapshotToken;
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
}

export interface PresentAppRowPointDependencyV1 {
  readonly kind: "present";
  readonly identity: AppRowIdentityV1;
  readonly revisionCommitSeq: CommitSeq;
}

export interface MissingAppRowPointDependencyV1 {
  readonly kind: "missing";
  readonly identity: AppRowIdentityV1;
  readonly basis:
    | Readonly<{ readonly kind: "noVisibleRevision" }>
    | Readonly<{
        readonly kind: "tombstone";
        readonly revisionCommitSeq: CommitSeq;
      }>;
}

export type AppRowPointDependencyV1 =
  | PresentAppRowPointDependencyV1
  | MissingAppRowPointDependencyV1;

export interface PresentAppRowPointReadResultV1 {
  readonly kind: "present";
  readonly document: CanonicalFlarexValueV1;
  readonly dependency: PresentAppRowPointDependencyV1;
}

export interface MissingAppRowPointReadResultV1 {
  readonly kind: "missing";
  readonly document: null;
  readonly dependency: MissingAppRowPointDependencyV1;
}

export type AppRowPointReadResultV1 =
  | PresentAppRowPointReadResultV1
  | MissingAppRowPointReadResultV1;

export interface AppRowValueEvidenceV1 {
  readonly codecVersion: FlarexValueCodecVersion;
  readonly valueJson: unknown;
  readonly canonicalBytes: CanonicalFlarexValueBytesV1;
  readonly sha256: FlarexValueSha256V1;
}

interface AppendAppRowRevisionV1Base extends AppRowIdentityV1 {
  readonly writeEpoch: ScopeEpoch;
  readonly commitSeq: CommitSeq;
  readonly prevCommitSeq: CommitSeq | null;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly creationTime: AppCreationTimeV1;
}

export interface AppendLiveAppRowRevisionV1Input
  extends AppendAppRowRevisionV1Base {
  readonly kind: "live";
  readonly value: AppRowValueEvidenceV1;
}

export interface AppendTombstoneAppRowRevisionV1Input
  extends AppendAppRowRevisionV1Base {
  readonly kind: "tombstone";
}

export type AppendAppRowRevisionV1Input =
  | AppendLiveAppRowRevisionV1Input
  | AppendTombstoneAppRowRevisionV1Input;

export interface AppendPreparedLiveAppRowRevisionV1Input
  extends AppendAppRowRevisionV1Base {
  readonly kind: "live";
  readonly document: CanonicalFlarexValueV1;
}

export interface AppendPreparedTombstoneAppRowRevisionV1Input
  extends AppendAppRowRevisionV1Base {
  readonly kind: "tombstone";
}

export type AppendPreparedAppRowRevisionV1Input =
  | AppendPreparedLiveAppRowRevisionV1Input
  | AppendPreparedTombstoneAppRowRevisionV1Input;

interface AppRowRevisionV1Base extends AppRowIdentityV1 {
  readonly scopeUuid: ScopeUuidV1;
  readonly writeEpochUuid: ScopeEpochUuidV1;
  readonly commitSeq: CommitSeq;
  readonly prevCommitSeq: CommitSeq | null;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly creationTime: AppCreationTimeV1;
}

export interface LiveAppRowRevisionV1 extends AppRowRevisionV1Base {
  readonly kind: "live";
  readonly document: CanonicalFlarexValueV1;
}

export interface TombstoneAppRowRevisionV1 extends AppRowRevisionV1Base {
  readonly kind: "tombstone";
}

export type AppRowRevisionV1 =
  | LiveAppRowRevisionV1
  | TombstoneAppRowRevisionV1;

export interface MissingAppRowRevisionV1 {
  readonly kind: "missing";
}

export type AppRowReadResultV1 =
  | MissingAppRowRevisionV1
  | AppRowRevisionV1;

const MISSING_APP_ROW_REVISION_V1 = Object.freeze({
  kind: "missing",
} satisfies MissingAppRowRevisionV1);

export class InvalidAppRowRevisionV1InputError extends Error {
  constructor(
    readonly issue:
      | { readonly reason: "nonPositiveCommitSeq"; readonly value: bigint }
      | {
          readonly reason: "invalidPreviousCommitSeq";
          readonly value: bigint;
          readonly commitSeq: bigint;
        },
  ) {
    super(
      issue.reason === "nonPositiveCommitSeq"
        ? `App-row revision commit sequence must be positive: ${issue.value}`
        : `App-row previous commit sequence ${issue.value} must be positive and less than ${issue.commitSeq}`,
    );
    this.name = "InvalidAppRowRevisionV1InputError";
  }
}

export class AppRowScopeAuthorityUnavailableError extends Error {
  constructor(readonly scopeId: ScopeId) {
    super(`Replacement app-row scope authority is unavailable: ${scopeId}`);
    this.name = "AppRowScopeAuthorityUnavailableError";
  }
}

export class AppRowRevisionAlreadyExistsError extends Error {
  constructor(
    readonly identity: AppRowIdentityV1,
    readonly commitSeq: CommitSeq,
  ) {
    super(
      `App-row revision already exists at ${identity.scopeId}/${identity.tableId}/${identity.rowId}/${commitSeq}`,
    );
    this.name = "AppRowRevisionAlreadyExistsError";
  }
}

export class AppRowRevisionChainConflictError extends Error {
  constructor(
    readonly identity: AppRowIdentityV1,
    readonly expectedPrevCommitSeq: CommitSeq | null,
    readonly actualCurrentCommitSeq: CommitSeq | null,
  ) {
    super(
      `App-row current pointer for ${identity.scopeId}/${identity.tableId}/${identity.rowId} is ` +
        `${actualCurrentCommitSeq ?? "missing"}; expected ${expectedPrevCommitSeq ?? "missing"}`,
    );
    this.name = "AppRowRevisionChainConflictError";
  }
}

export class AppRowCreationTimeConflictError extends Error {
  constructor(
    readonly identity: AppRowIdentityV1,
    readonly expectedCreationTime: AppCreationTimeV1,
    readonly actualCreationTime: AppCreationTimeV1,
  ) {
    super(
      `App-row creation time for ${identity.scopeId}/${identity.tableId}/${identity.rowId} is ` +
        `${actualCreationTime}; expected immutable value ${expectedCreationTime}`,
    );
    this.name = "AppRowCreationTimeConflictError";
  }
}

export class AppRowStorageCorruptionError extends Error {
  constructor(
    readonly identity: AppRowIdentityV1,
    readonly reason: string,
    options?: ErrorOptions,
  ) {
    super(
      `App-row storage ${identity.scopeId}/${identity.tableId}/${identity.rowId} is invalid: ${reason}`,
      options,
    );
    this.name = "AppRowStorageCorruptionError";
  }
}

export async function readAppRowAtSnapshotInTransaction(
  tx: AppRowTransaction,
  input: ReadAppRowAtSnapshotV1Input,
): Promise<AppRowReadResultV1> {
  const identity = decodeIdentity(input);
  const scopeUuid = await requireScopeUuidInTransaction(tx, identity.scopeId);
  const snapshotCommitSeq = CommitSeqSchema.make(input.snapshotCommitSeq);
  const rows = await tx
    .select()
    .from(fxAppRowRevisions)
    .where(
      and(
        eq(fxAppRowRevisions.scopeUuid, scopeUuid),
        eq(fxAppRowRevisions.tableId, identity.tableId),
        eq(fxAppRowRevisions.rowId, appRowIdHexV1ToBytes(identity.rowId)),
        lte(fxAppRowRevisions.commitSeq, snapshotCommitSeq),
      ),
    )
    .orderBy(desc(fxAppRowRevisions.commitSeq))
    .limit(1);
  const row = rows[0];
  return row === undefined
    ? MISSING_APP_ROW_REVISION_V1
    : decodeRevisionRow(identity, row);
}

/**
 * Projects authoritative history into the logical point-read result and OCC
 * evidence for one immutable snapshot. This private kernel does not authorize
 * an execution attempt or apply staged read-your-writes state; C03 owns that
 * composition before a syscall can consume it.
 */
export async function getAppRowAtSnapshotInTransaction(
  tx: AppRowTransaction,
  input: GetAppRowAtSnapshotV1Input,
): Promise<AppRowPointReadResultV1> {
  const snapshotToken = SnapshotTokenSchema.make(input.snapshotToken);
  const identity = decodeIdentity({
    scopeId: snapshotToken.scopeId,
    tableId: input.tableId,
    rowId: input.rowId,
  });
  const revision = await readAppRowAtSnapshotInTransaction(tx, {
    ...identity,
    snapshotCommitSeq: snapshotToken.commitSeq,
  });

  switch (revision.kind) {
    case "live":
      return Object.freeze({
        kind: "present",
        document: revision.document,
        dependency: Object.freeze({
          kind: "present",
          identity,
          revisionCommitSeq: revision.commitSeq,
        } satisfies PresentAppRowPointDependencyV1),
      } satisfies PresentAppRowPointReadResultV1);
    case "tombstone":
      return Object.freeze({
        kind: "missing",
        document: null,
        dependency: Object.freeze({
          kind: "missing",
          identity,
          basis: Object.freeze({
            kind: "tombstone",
            revisionCommitSeq: revision.commitSeq,
          }),
        } satisfies MissingAppRowPointDependencyV1),
      } satisfies MissingAppRowPointReadResultV1);
    case "missing":
      return Object.freeze({
        kind: "missing",
        document: null,
        dependency: Object.freeze({
          kind: "missing",
          identity,
          basis: Object.freeze({ kind: "noVisibleRevision" }),
        } satisfies MissingAppRowPointDependencyV1),
      } satisfies MissingAppRowPointReadResultV1);
  }
}

export async function readCurrentAppRowInTransaction(
  tx: AppRowTransaction,
  input: AppRowIdentityV1,
): Promise<AppRowReadResultV1> {
  const identity = decodeIdentity(input);
  const scopeUuid = await requireScopeUuidInTransaction(tx, identity.scopeId);
  const rowIdBytes = appRowIdHexV1ToBytes(identity.rowId);
  const pointers = await tx
    .select({ commitSeq: fxAppRowCurrent.commitSeq })
    .from(fxAppRowCurrent)
    .where(
      and(
        eq(fxAppRowCurrent.scopeUuid, scopeUuid),
        eq(fxAppRowCurrent.tableId, identity.tableId),
        eq(fxAppRowCurrent.rowId, rowIdBytes),
      ),
    )
    .limit(1);
  const pointer = pointers[0];
  if (pointer === undefined) return MISSING_APP_ROW_REVISION_V1;
  const revisions = await tx
    .select()
    .from(fxAppRowRevisions)
    .where(
      and(
        eq(fxAppRowRevisions.scopeUuid, scopeUuid),
        eq(fxAppRowRevisions.tableId, identity.tableId),
        eq(fxAppRowRevisions.rowId, rowIdBytes),
        eq(fxAppRowRevisions.commitSeq, pointer.commitSeq),
      ),
    )
    .limit(1);
  const revision = revisions[0];
  if (revision === undefined) {
    throw new AppRowStorageCorruptionError(
      identity,
      `current pointer references absent revision ${pointer.commitSeq}`,
    );
  }
  return decodeRevisionRow(identity, revision);
}

export async function appendAppRowRevisionAndAdvanceCurrentInTransaction(
  tx: AppRowTransaction,
  input: AppendAppRowRevisionV1Input,
): Promise<AppRowRevisionV1> {
  const decoded = await decodeAppendInput(tx, input);
  return appendDecodedAppRowRevisionAndAdvanceCurrentInTransaction(
    tx,
    decoded,
  );
}

/**
 * Internal O06/O07 lowering primitive. Canonical document verification must
 * already have completed before the transaction starts.
 */
export async function appendPreparedAppRowRevisionAndAdvanceCurrentInTransaction(
  tx: AppRowTransaction,
  input: AppendPreparedAppRowRevisionV1Input,
): Promise<AppRowRevisionV1> {
  const decoded = await decodePreparedAppendInput(tx, input);
  return appendDecodedAppRowRevisionAndAdvanceCurrentInTransaction(
    tx,
    decoded,
  );
}

type DecodedAppendAppRowRevisionV1 =
  | (AppendAppRowRevisionV1Base & {
      readonly kind: "live";
      readonly identity: AppRowIdentityV1;
      readonly scopeUuid: ScopeUuidV1;
      readonly writeEpochUuid: ScopeEpochUuidV1;
      readonly document: CanonicalFlarexValueV1;
    })
  | (AppendAppRowRevisionV1Base & {
      readonly kind: "tombstone";
      readonly identity: AppRowIdentityV1;
      readonly scopeUuid: ScopeUuidV1;
      readonly writeEpochUuid: ScopeEpochUuidV1;
    });

async function appendDecodedAppRowRevisionAndAdvanceCurrentInTransaction(
  tx: AppRowTransaction,
  decoded: DecodedAppendAppRowRevisionV1,
): Promise<AppRowRevisionV1> {
  const inserted = await tx
    .insert(fxAppRowRevisions)
    .values({
      scopeUuid: decoded.scopeUuid,
      tableId: decoded.identity.tableId,
      rowId: appRowIdHexV1ToBytes(decoded.identity.rowId),
      commitSeq: decoded.commitSeq,
      prevCommitSeq: decoded.prevCommitSeq,
      writeEpochUuid: decoded.writeEpochUuid,
      schemaVersionId: decoded.schemaVersionId,
      creationTime: decoded.creationTime,
      valueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
      isTombstone: decoded.kind === "tombstone",
      valueJson: decoded.kind === "live" ? decoded.document.valueJson : null,
      valueBytes:
        decoded.kind === "live" ? decoded.document.canonicalBytes : null,
      valueSha256: decoded.kind === "live" ? decoded.document.sha256 : null,
    })
    .onConflictDoNothing()
    .returning({ commitSeq: fxAppRowRevisions.commitSeq });
  if (inserted[0] === undefined) {
    throw new AppRowRevisionAlreadyExistsError(
      decoded.identity,
      decoded.commitSeq,
    );
  }

  const advanced =
    decoded.prevCommitSeq === null
      ? await tx
          .insert(fxAppRowCurrent)
          .values({
            scopeUuid: decoded.scopeUuid,
            tableId: decoded.identity.tableId,
            rowId: appRowIdHexV1ToBytes(decoded.identity.rowId),
            commitSeq: decoded.commitSeq,
          })
          .onConflictDoNothing()
          .returning({ commitSeq: fxAppRowCurrent.commitSeq })
      : await tx
          .update(fxAppRowCurrent)
          .set({ commitSeq: decoded.commitSeq })
          .where(
            and(
              eq(fxAppRowCurrent.scopeUuid, decoded.scopeUuid),
              eq(fxAppRowCurrent.tableId, decoded.identity.tableId),
              eq(
                fxAppRowCurrent.rowId,
                appRowIdHexV1ToBytes(decoded.identity.rowId),
              ),
              eq(fxAppRowCurrent.commitSeq, decoded.prevCommitSeq),
            ),
          )
          .returning({ commitSeq: fxAppRowCurrent.commitSeq });
  if (advanced[0] === undefined) {
    await deleteInsertedRevisionInTransaction(tx, decoded);
    const actual = await readCurrentPointerCommitSeq(
      tx,
      decoded.scopeUuid,
      decoded.identity,
    );
    throw new AppRowRevisionChainConflictError(
      decoded.identity,
      decoded.prevCommitSeq,
      actual,
    );
  }

  return decoded.kind === "live"
    ? Object.freeze({
        kind: "live",
        ...decoded.identity,
        scopeUuid: decoded.scopeUuid,
        writeEpochUuid: decoded.writeEpochUuid,
        commitSeq: decoded.commitSeq,
        prevCommitSeq: decoded.prevCommitSeq,
        schemaVersionId: decoded.schemaVersionId,
        creationTime: decoded.creationTime,
        document: decoded.document,
      } satisfies LiveAppRowRevisionV1)
    : Object.freeze({
        kind: "tombstone",
        ...decoded.identity,
        scopeUuid: decoded.scopeUuid,
        writeEpochUuid: decoded.writeEpochUuid,
        commitSeq: decoded.commitSeq,
        prevCommitSeq: decoded.prevCommitSeq,
        schemaVersionId: decoded.schemaVersionId,
        creationTime: decoded.creationTime,
      } satisfies TombstoneAppRowRevisionV1);
}

async function deleteInsertedRevisionInTransaction(
  tx: AppRowTransaction,
  revision: {
    readonly identity: AppRowIdentityV1;
    readonly scopeUuid: ScopeUuidV1;
    readonly commitSeq: CommitSeq;
  },
): Promise<void> {
  const deleted = await tx
    .delete(fxAppRowRevisions)
    .where(
      and(
        eq(fxAppRowRevisions.scopeUuid, revision.scopeUuid),
        eq(fxAppRowRevisions.tableId, revision.identity.tableId),
        eq(
          fxAppRowRevisions.rowId,
          appRowIdHexV1ToBytes(revision.identity.rowId),
        ),
        eq(fxAppRowRevisions.commitSeq, revision.commitSeq),
      ),
    )
    .returning({ commitSeq: fxAppRowRevisions.commitSeq });
  if (deleted[0] === undefined) {
    throw new AppRowStorageCorruptionError(
      revision.identity,
      `rejected revision ${revision.commitSeq} could not be removed`,
    );
  }
}

type AppRowRevisionRow = typeof fxAppRowRevisions.$inferSelect;

async function decodeRevisionRow(
  identity: AppRowIdentityV1,
  row: AppRowRevisionRow,
): Promise<AppRowRevisionV1> {
  const storedRowId = appRowIdHexV1FromBytes(row.rowId);
  if (storedRowId !== identity.rowId) {
    throw new AppRowStorageCorruptionError(identity, "row identity changed");
  }
  const base = {
    ...identity,
    scopeUuid: decodeScopeUuidV1(row.scopeUuid),
    writeEpochUuid: decodeScopeEpochUuidV1(row.writeEpochUuid),
    commitSeq: requirePositiveCommitSeq(row.commitSeq),
    prevCommitSeq:
      row.prevCommitSeq === null
        ? null
        : requirePositiveCommitSeq(row.prevCommitSeq),
    schemaVersionId: decodeCatalogSchemaVersionId(row.schemaVersionId),
    creationTime: decodeAppCreationTimeV1(row.creationTime),
  } satisfies AppRowRevisionV1Base;
  if (row.isTombstone) {
    if (
      row.valueJson !== null ||
      row.valueBytes !== null ||
      row.valueSha256 !== null
    ) {
      throw new AppRowStorageCorruptionError(
        identity,
        "tombstone retains value evidence",
      );
    }
    return Object.freeze({
      kind: "tombstone",
      ...base,
    } satisfies TombstoneAppRowRevisionV1);
  }
  if (
    row.valueJson === null ||
    row.valueBytes === null ||
    row.valueSha256 === null
  ) {
    throw new AppRowStorageCorruptionError(
      identity,
      "live revision is missing value evidence",
    );
  }
  try {
    const document = await verifyAppDocumentEvidenceV1({
      tableId: identity.tableId,
      rowId: identity.rowId,
      creationTime: base.creationTime,
      codecVersion: row.valueCodecVersion,
      valueJson: row.valueJson,
      canonicalBytes: row.valueBytes,
      sha256: row.valueSha256,
    });
    return Object.freeze({
      kind: "live",
      ...base,
      document,
    } satisfies LiveAppRowRevisionV1);
  } catch (cause) {
    throw new AppRowStorageCorruptionError(
      identity,
      "live revision value evidence or trusted system fields do not verify",
      { cause },
    );
  }
}

async function requireScopeUuidInTransaction(
  tx: AppRowTransaction,
  scopeId: ScopeId,
): Promise<ScopeUuidV1> {
  const projection = projectScopeIdUuidV1(scopeId);
  const rows = await tx
    .select({
      scopeId: fxSystemScopeClocks.scopeId,
      scopeUuid: fxSystemScopeClocks.scopeUuid,
    })
    .from(fxSystemScopeClocks)
    .where(eq(fxSystemScopeClocks.scopeId, projection.scopeId))
    .limit(1);
  const row = rows[0];
  if (row?.scopeUuid !== projection.scopeUuid) {
    throw new AppRowScopeAuthorityUnavailableError(scopeId);
  }
  return decodeScopeUuidV1(row.scopeUuid);
}

function decodeIdentity(input: AppRowIdentityV1): AppRowIdentityV1 {
  return Object.freeze({
    scopeId: input.scopeId,
    tableId: decodeCatalogTableId(input.tableId),
    rowId: decodeAppRowIdHexV1(input.rowId),
  } satisfies AppRowIdentityV1);
}

async function decodeAppendInput(
  tx: AppRowTransaction,
  input: AppendAppRowRevisionV1Input,
): Promise<DecodedAppendAppRowRevisionV1> {
  const identity = decodeIdentity(input);
  const scopeUuid = await requireScopeUuidInTransaction(tx, identity.scopeId);
  const commitSeq = requirePositiveCommitSeq(input.commitSeq);
  const prevCommitSeq =
    input.prevCommitSeq === null
      ? null
      : requirePreviousCommitSeq(input.prevCommitSeq, commitSeq);
  const writeEpochUuid = projectScopeEpochUuidV1(input.writeEpoch).epochUuid;
  const schemaVersionId = decodeCatalogSchemaVersionId(input.schemaVersionId);
  const creationTime = decodeAppCreationTimeV1(input.creationTime);
  if (prevCommitSeq !== null) {
    await requireImmutableCreationTime(
      tx,
      identity,
      scopeUuid,
      prevCommitSeq,
      creationTime,
    );
  }
  const base = {
    ...input,
    identity,
    scopeUuid,
    writeEpochUuid,
    commitSeq,
    prevCommitSeq,
    schemaVersionId,
    creationTime,
  };
  if (input.kind === "tombstone") {
    return Object.freeze({ ...base, kind: "tombstone" });
  }
  const document = await verifyAppDocumentEvidenceV1({
    tableId: identity.tableId,
    rowId: identity.rowId,
    creationTime,
    codecVersion: input.value.codecVersion,
    valueJson: input.value.valueJson,
    canonicalBytes: input.value.canonicalBytes,
    sha256: input.value.sha256,
  });
  return Object.freeze({ ...base, kind: "live", document });
}

async function decodePreparedAppendInput(
  tx: AppRowTransaction,
  input: AppendPreparedAppRowRevisionV1Input,
): Promise<DecodedAppendAppRowRevisionV1> {
  const identity = decodeIdentity(input);
  const scopeUuid = await requireScopeUuidInTransaction(tx, identity.scopeId);
  const commitSeq = requirePositiveCommitSeq(input.commitSeq);
  const prevCommitSeq = input.prevCommitSeq === null
    ? null
    : requirePreviousCommitSeq(input.prevCommitSeq, commitSeq);
  const writeEpochUuid = projectScopeEpochUuidV1(input.writeEpoch).epochUuid;
  const schemaVersionId = decodeCatalogSchemaVersionId(input.schemaVersionId);
  const creationTime = decodeAppCreationTimeV1(input.creationTime);
  if (prevCommitSeq !== null) {
    await requireImmutableCreationTime(
      tx,
      identity,
      scopeUuid,
      prevCommitSeq,
      creationTime,
    );
  }
  const base = {
    ...input,
    identity,
    scopeUuid,
    writeEpochUuid,
    commitSeq,
    prevCommitSeq,
    schemaVersionId,
    creationTime,
  };
  return input.kind === "tombstone"
    ? Object.freeze({ ...base, kind: "tombstone" })
    : Object.freeze({ ...base, kind: "live", document: input.document });
}

async function requireImmutableCreationTime(
  tx: AppRowTransaction,
  identity: AppRowIdentityV1,
  scopeUuid: ScopeUuidV1,
  prevCommitSeq: CommitSeq,
  creationTime: AppCreationTimeV1,
): Promise<void> {
  const rows = await tx
    .select({ creationTime: fxAppRowRevisions.creationTime })
    .from(fxAppRowRevisions)
    .where(
      and(
        eq(fxAppRowRevisions.scopeUuid, scopeUuid),
        eq(fxAppRowRevisions.tableId, identity.tableId),
        eq(fxAppRowRevisions.rowId, appRowIdHexV1ToBytes(identity.rowId)),
        eq(fxAppRowRevisions.commitSeq, prevCommitSeq),
      ),
    )
    .limit(1);
  const predecessor = rows[0];
  if (predecessor === undefined) {
    const actual = await readCurrentPointerCommitSeq(tx, scopeUuid, identity);
    throw new AppRowRevisionChainConflictError(
      identity,
      prevCommitSeq,
      actual,
    );
  }
  const expectedCreationTime = decodeAppCreationTimeV1(
    predecessor.creationTime,
  );
  if (creationTime !== expectedCreationTime) {
    throw new AppRowCreationTimeConflictError(
      identity,
      expectedCreationTime,
      creationTime,
    );
  }
}

function requirePositiveCommitSeq(value: CommitSeq): CommitSeq {
  const decoded = CommitSeqSchema.make(value);
  if (decoded < 1n) {
    throw new InvalidAppRowRevisionV1InputError({
      reason: "nonPositiveCommitSeq",
      value: decoded,
    });
  }
  return decoded;
}

function requirePreviousCommitSeq(
  value: CommitSeq,
  commitSeq: CommitSeq,
): CommitSeq {
  const decoded = CommitSeqSchema.make(value);
  if (decoded < 1n || decoded >= commitSeq) {
    throw new InvalidAppRowRevisionV1InputError({
      reason: "invalidPreviousCommitSeq",
      value: decoded,
      commitSeq,
    });
  }
  return decoded;
}

async function readCurrentPointerCommitSeq(
  tx: AppRowTransaction,
  scopeUuid: ScopeUuidV1,
  identity: AppRowIdentityV1,
): Promise<CommitSeq | null> {
  const rows = await tx
    .select({ commitSeq: fxAppRowCurrent.commitSeq })
    .from(fxAppRowCurrent)
    .where(
      and(
        eq(fxAppRowCurrent.scopeUuid, scopeUuid),
        eq(fxAppRowCurrent.tableId, identity.tableId),
        eq(fxAppRowCurrent.rowId, appRowIdHexV1ToBytes(identity.rowId)),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : requirePositiveCommitSeq(row.commitSeq);
}
