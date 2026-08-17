import { Result } from "effect";
import { ReplacementScopeIdV1Schema } from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import {
  decodeAppSchemaResult,
  decodeClockAuthorityResult,
  decodeJsonObjectTextResult,
  decodeLeaseSnapshotResult,
  decodeSessionIdentityResult,
  decodeStoredSchemaArtifactResult,
} from "../src/storedCommitAuthority/materialization";

const SCOPE_UUID = "11111111-1111-4111-8111-111111111111";
const EPOCH_UUID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";

describe("stored commit-authority materialization decoders", () => {
  it("decodes the authority identity rows through ordered Results", () => {
    expect(Result.isSuccess(
      decodeClockAuthorityResult(validClockAuthorityRow()),
    )).toBe(true);
    expect(Result.isSuccess(decodeSessionIdentityResult({
      sessionId: SESSION_ID,
      attemptFence: 1n,
      storageGenerationFence: 1n,
    }))).toBe(true);
    expect(Result.isSuccess(decodeLeaseSnapshotResult(
      {
        scopeId: ReplacementScopeIdV1Schema.make(`scope_${SCOPE_UUID}`),
      },
      {
        snapshotEpochUuid: EPOCH_UUID,
        snapshotCommitSeq: 0n,
      },
    ))).toBe(true);
  });

  it("retains the owning corruption reasons for malformed rows", () => {
    const clock = decodeClockAuthorityResult({
      ...validClockAuthorityRow(),
      scopeUuid: "not-a-uuid",
    });
    const session = decodeSessionIdentityResult({
      sessionId: "not-a-uuid",
      attemptFence: 1n,
      storageGenerationFence: 1n,
    });
    const lease = decodeLeaseSnapshotResult(
      {
        scopeId: ReplacementScopeIdV1Schema.make(`scope_${SCOPE_UUID}`),
      },
      {
        snapshotEpochUuid: "not-a-uuid",
        snapshotCommitSeq: 0n,
      },
    );

    expect(Result.isFailure(clock) && clock.failure).toBe(
      "authorityProjectionInvalid",
    );
    expect(Result.isFailure(session) && session.failure).toBe(
      "sessionEvidenceInvalid",
    );
    expect(Result.isFailure(lease) && lease.failure).toBe(
      "snapshotLeaseInvalid",
    );
  });

  it("short-circuits later row access after a typed decode failure", () => {
    const clockRow = validClockAuthorityRow();
    let clockEpochUuidRead = false;
    Object.defineProperty(clockRow, "scopeUuid", {
      enumerable: true,
      value: "not-a-uuid",
    });
    Object.defineProperty(clockRow, "epochUuid", {
      enumerable: true,
      get() {
        clockEpochUuidRead = true;
        throw new Error("clock epoch UUID must not be read");
      },
    });

    const sessionRow = {
      sessionId: "not-a-uuid",
      get attemptFence(): unknown {
        throw new Error("attempt fence must not be read");
      },
      storageGenerationFence: 1n,
    };
    const leaseRow = {
      snapshotEpochUuid: "not-a-uuid",
      get snapshotCommitSeq(): unknown {
        throw new Error("snapshot commit sequence must not be read");
      },
    };

    expect(Result.isFailure(decodeClockAuthorityResult(clockRow))).toBe(true);
    expect(clockEpochUuidRead).toBe(false);
    expect(Result.isFailure(decodeSessionIdentityResult(sessionRow))).toBe(
      true,
    );
    expect(Result.isFailure(decodeLeaseSnapshotResult(
      {
        scopeId: ReplacementScopeIdV1Schema.make(`scope_${SCOPE_UUID}`),
      },
      leaseRow,
    ))).toBe(true);
  });

  it("preserves unexpected row-access defects", () => {
    const clockDefect = new Error("clock authority accessor defect");
    const clockRow = new Proxy(validClockAuthorityRow(), {
      get(target, property, receiver) {
        if (property === "scopeUuid") throw clockDefect;
        return Reflect.get(target, property, receiver);
      },
    });
    const sessionDefect = new Error("session identity accessor defect");
    const sessionRow = {
      sessionId: SESSION_ID,
      get attemptFence(): unknown {
        throw sessionDefect;
      },
      storageGenerationFence: 1n,
    };
    const leaseDefect = new Error("lease snapshot accessor defect");
    const leaseRow = {
      snapshotEpochUuid: EPOCH_UUID,
      get snapshotCommitSeq(): unknown {
        throw leaseDefect;
      },
    };

    expect(() => decodeClockAuthorityResult(clockRow)).toThrow(clockDefect);
    expect(() => decodeSessionIdentityResult(sessionRow)).toThrow(
      sessionDefect,
    );
    expect(() => decodeLeaseSnapshotResult(
      {
        scopeId: ReplacementScopeIdV1Schema.make(`scope_${SCOPE_UUID}`),
      },
      leaseRow,
    )).toThrow(leaseDefect);
  });

  it("decodes stored JSON and schema-artifact fields through Result", () => {
    expect(Result.getOrThrow(
      decodeJsonObjectTextResult('{"nested":{"value":1}}'),
    )).toEqual({ nested: { value: 1 } });
    expect(Result.isFailure(decodeJsonObjectTextResult("[1]"))).toBe(true);
    expect(Result.isFailure(decodeJsonObjectTextResult("{"))).toBe(true);

    const decoded = Result.getOrThrow(
      decodeStoredSchemaArtifactResult(validStoredSchemaArtifactRow()),
    );
    expect(decoded).toMatchObject({
      schemaVersionId: "schema_materialization_v1",
      codecVersion: 1,
      json: MINIMAL_APP_SCHEMA,
    });
    expect(decoded.canonicalBytes).toEqual(new Uint8Array([1]));
    expect(decoded.sha256).toEqual(new Uint8Array(32));
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Result.getOrThrow(
      decodeAppSchemaResult(MINIMAL_APP_SCHEMA),
    )).toEqual(MINIMAL_APP_SCHEMA);
  });

  it("retains schema corruption for every malformed stored field", () => {
    const valid = validStoredSchemaArtifactRow();
    const invalidRows = [
      { ...valid, schemaVersionId: " " },
      { ...valid, manifestCodecVersion: 2 },
      { ...valid, manifestJsonText: "{" },
      { ...valid, manifestJsonText: "[]" },
      { ...valid, manifestBytes: new Uint8Array(0) },
      { ...valid, manifestSha256: new Uint8Array(31) },
    ];
    for (const row of invalidRows) {
      const result = decodeStoredSchemaArtifactResult(row);
      expect(Result.isFailure(result) && result.failure).toBe(
        "schemaArtifactInvalid",
      );
    }
    expect(Result.isFailure(decodeAppSchemaResult({
      ...MINIMAL_APP_SCHEMA,
      kind: "not-app-schema",
    }))).toBe(true);
  });

  it("short-circuits schema rows and preserves non-schema defects", () => {
    const earlyFailure = validStoredSchemaArtifactRow();
    Object.defineProperty(earlyFailure, "schemaVersionId", {
      enumerable: true,
      value: " ",
    });
    Object.defineProperty(earlyFailure, "manifestCodecVersion", {
      enumerable: true,
      get() {
        throw new Error("schema codec must not be read");
      },
    });
    expect(Result.isFailure(
      decodeStoredSchemaArtifactResult(earlyFailure),
    )).toBe(true);

    const rowDefect = new Error("schema artifact row accessor defect");
    const defectiveRow = new Proxy(validStoredSchemaArtifactRow(), {
      get(target, property, receiver) {
        if (property === "manifestCodecVersion") throw rowDefect;
        return Reflect.get(target, property, receiver);
      },
    });
    expect(() => decodeStoredSchemaArtifactResult(defectiveRow)).toThrow(
      rowDefect,
    );

    const schemaDefect = new Error("app schema accessor defect");
    const defectiveSchema = new Proxy(MINIMAL_APP_SCHEMA, {
      getOwnPropertyDescriptor(): never {
        throw schemaDefect;
      },
    });
    expect(() => decodeAppSchemaResult(defectiveSchema)).toThrow(schemaDefect);
  });
});

const MINIMAL_APP_SCHEMA = {
  kind: "appSchema",
  manifestVersion: 1,
  tableDefinitions: {
    kind: "tableDefinitions",
    sectionVersion: 1,
    tables: [],
  },
  indexBindings: {
    kind: "indexBindings",
    sectionVersion: 1,
    indexes: [],
  },
} as const;

function validClockAuthorityRow() {
  return {
    scopeId: `scope_${SCOPE_UUID}`,
    storageGeneration: "flarexdb_v1",
    storageGenerationFence: 1n,
    lastCommitSeq: 0n,
    oldestAvailableCommitSeq: 0n,
    lastOutboxSeq: 0n,
    epoch: `epoch_${EPOCH_UUID}`,
    updatedAt: new Date("2026-07-19T00:00:00.000Z"),
    scopeUuid: SCOPE_UUID,
    epochUuid: EPOCH_UUID,
    authorizationRevocationEpoch: 0n,
  };
}

function validStoredSchemaArtifactRow() {
  return {
    schemaVersionId: "schema_materialization_v1",
    manifestCodecVersion: 1,
    manifestJsonText: JSON.stringify(MINIMAL_APP_SCHEMA),
    manifestBytes: new Uint8Array([1]),
    manifestSha256: new Uint8Array(32),
  };
}
