import { expect } from "vitest";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { decodeAppDocumentIdentityV1Result } from "flarex-protocol/app-document-id";
import { canonicalizeFlarexValueV1Effect } from "flarex-protocol/value";
import {
  encodeAppOrderedIndexKeyV1,
  orderedIndexCreationTimeV1,
  orderedIndexValueFromFlarexValueV1,
  orderedIndexKeyHexV1ToBytes,
} from "flarex-protocol/ordered-index";
import { appIndexPhysicalSpecSha256HexV1ToBytes } from "flarex-protocol/index-definition";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { getAppIndexDefinitionByIdEffect } from "../src/appIndexDefinitions";
import { canonicalizeAppUniqueKeyV1Result } from "../src/appUniqueKeyContract";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import type { RelationalSession } from "../src/relationalTransaction/session";
import { makeCmsHost } from "../src/cmsTransaction/host";
import { cmsExecutionMeasurementFixture } from "./cmsExecutionMeasurementFixture";
import { makeCe0CmsMutationReference } from "./ce0CmsMutationReference";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { ce0FirstInsertExecutionScenario } from "./ce0FirstInsertExecutionScenario";

const decodeDocuments = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      _id: Schema.String,
      _creationTime: Schema.Number,
      title: Schema.String,
    }),
  ),
);
const hash = async (bytes: Uint8Array) =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));

export async function ce0FirstInsertReferenceScenario(
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  session: RelationalSession,
) {
  const tested = await cmsExecutionMeasurementFixture(persistence, session);
  const reference = await runEffect(makeCe0CmsMutationReference(tested.input));
  const core = (key: string, args: { count: number; prefix: string }) =>
    tested.host.run(key, tested.insert, args);
  for (const count of [1, 8, 32])
    for (const implementation of ["core", "reference"] as const) {
      const args = { count, prefix: `${implementation}-${count}` };
      const before = await tested.inventory();
      const key = tested.host.newRequestKey();
      const value = await runEffect(
        implementation === "core" ? core(key, args) : reference.run(key, args),
      );
      const after = await tested.verifyInsert(
        before,
        value,
        count,
        args.prefix,
      );
      const seq = after.clock[0]?.lastCommitSeq;
      if (seq === undefined) throw new Error("Missing scope clock");
      for (const document of decodeDocuments(value)) {
        const identity = Result.getOrThrow(
          decodeAppDocumentIdentityV1Result(document._id),
        );
        const canonical = await runEffect(
          canonicalizeFlarexValueV1Effect(document, "appDocument"),
        );
        const isRow = (row: { rowId: Uint8Array }) =>
          encodeBytesToLowercaseHex(row.rowId) === identity.rowId;
        const revision = after.revisions.filter(isRow);
        expect(revision).toHaveLength(1);
        const stored = revision[0];
        if (
          stored === undefined ||
          stored.valueBytes === null ||
          stored.valueSha256 === null
        )
          throw new Error("Missing live revision evidence");
        expect({
          ...stored,
          valueBytes: new Uint8Array(stored.valueBytes),
          valueSha256: new Uint8Array(stored.valueSha256),
        }).toMatchObject({
          tableId: identity.tableId,
          commitSeq: seq,
          prevCommitSeq: null,
          creationTime: document._creationTime,
          isTombstone: false,
          valueBytes: canonical.canonicalBytes,
          valueSha256: canonical.sha256,
        });
        expect(after.rows.filter(isRow)).toMatchObject([
          { tableId: identity.tableId, commitSeq: seq },
        ]);
        const memberships = after.indexRevisions.filter(isRow);
        expect(memberships).toHaveLength(2);
        for (const member of memberships) {
          const definition = await runEffect(
            getAppIndexDefinitionByIdEffect(
              tested.fixture.control.drizzle,
              tested.fixture.deploymentId,
              member.indexDefinitionId,
            ),
          );
          if (definition === null) throw new Error("Missing index definition");
          const values =
            definition.access.kind === "by_creation_time"
              ? [orderedIndexCreationTimeV1(document._creationTime)]
              : [
                  orderedIndexValueFromFlarexValueV1(document.title),
                  orderedIndexCreationTimeV1(document._creationTime),
                ];
          const bytes = orderedIndexKeyHexV1ToBytes(
            encodeAppOrderedIndexKeyV1({
              spec: definition.physicalSpec,
              values,
            }),
          );
          expect({
            ...member,
            physicalSpecSha256: new Uint8Array(member.physicalSpecSha256),
            encodedKey: new Uint8Array(member.encodedKey),
            keySha256: new Uint8Array(member.keySha256),
          }).toMatchObject({
            tableId: identity.tableId,
            commitSeq: seq,
            isTombstone: false,
            physicalSpecSha256: appIndexPhysicalSpecSha256HexV1ToBytes(
              definition.physicalSpecSha256Hex,
            ),
            encodedKey: bytes,
            keySha256: await hash(bytes),
          });
          expect(
            after.indexes
              .filter(
                (row) =>
                  isRow(row) &&
                  row.indexDefinitionId === member.indexDefinitionId,
              )
              .map((row) => ({
                ...row,
                encodedKey: new Uint8Array(row.encodedKey),
              })),
          ).toMatchObject([{ commitSeq: seq, encodedKey: bytes }]);
        }
        const claim = Result.getOrThrow(
          canonicalizeAppUniqueKeyV1Result({
            sparse: false,
            localeKey: null,
            values: [orderedIndexValueFromFlarexValueV1(document.title)],
          }),
        );
        if (claim.kind !== "claim")
          throw new Error("Missing expected title claim");
        expect(
          after.claims.filter(isRow).map((row) => ({
            ...row,
            encodedKey: new Uint8Array(row.encodedKey),
            canonicalKeySha256: new Uint8Array(row.canonicalKeySha256),
          })),
        ).toMatchObject([
          {
            tableId: identity.tableId,
            localeKey: claim.localeKey,
            keyCodecVersion: claim.keyCodecVersion,
            encodedKey: claim.canonicalKeyBytes,
            canonicalKeySha256: await hash(claim.canonicalKeyBytes),
          },
        ]);
      }
      const callbacks = [tested.executionCount(), reference.executionCount()];
      for (const replay of [core, reference.run]) {
        expect(await runEffect(replay(key, args))).toEqual(value);
        expect(
          await runEffectFailure(replay(key, { ...args, prefix: "changed" })),
        ).toMatchObject({ reason: "requestConflict" });
      }
      expect([tested.executionCount(), reference.executionCount()]).toEqual(
        callbacks,
      );
      for (const duplicate of [core, reference.run]) {
        expect(
          await runEffectFailure(duplicate(tested.host.newRequestKey(), args)),
        ).toMatchObject({
          reason: "uniqueConflict",
          uniqueConstraint: { tableName: "posts", orderedFields: ["title"] },
        });
        expect(await tested.inventory()).toEqual(after);
      }
    }
  for (const implementation of ["core", "reference"] as const)
    for (const mode of ["defect", "cancel"] as const)
      for (const step of [
        "rowBatchWritten",
        "indexBatchWritten",
        "uniquePublicationApplied",
        "clockAdvanced",
      ]) {
        const fault = new Error(`rollback ${implementation} after ${step}`);
        const controller = new AbortController();
        let injected = 0;
        const input = {
          ...tested.input,
          materialization: {
            ...tested.input.materialization,
            afterTransactionStep: async (event: { readonly step: string }) => {
              if (event.step === step) {
                injected++;
                if (mode === "cancel") controller.abort();
                else throw fault;
              }
            },
          },
        };
        const faultyCore = await runEffect(makeCmsHost(input));
        const faultyReference = await runEffect(
          makeCe0CmsMutationReference(input),
        );
        const before = await tested.inventory();
        const key = tested.host.newRequestKey();
        const args = {
          count: step === "indexBatchWritten" ? 32 : 8,
          prefix: `rollback-${mode}-${implementation}-${step}`,
        };
        const failure = await Effect.runPromiseExit(
          implementation === "core"
            ? faultyCore.run(key, tested.insert, args)
            : faultyReference.run(key, args),
          { signal: controller.signal },
        );
        expect(injected).toBe(1);
        expect(Exit.isFailure(failure)).toBe(true);
        if (Exit.isFailure(failure) && mode === "cancel") {
          expect(failure.cause.reasons.length).toBeGreaterThan(0);
          expect(failure.cause.reasons.every(Cause.isInterruptReason)).toBe(
            true,
          );
        }
        if (Exit.isFailure(failure) && mode === "defect") {
          expect(failure.cause.reasons).toHaveLength(1);
          expect(
            failure.cause.reasons
              .filter(Cause.isDieReason)
              .map((reason) => reason.defect),
          ).toEqual([fault]);
        }
        expect(await tested.inventory()).toEqual(before);
        const value = await runEffect(reference.run(key, args));
        const after = await tested.verifyInsert(
          before,
          value,
          args.count,
          args.prefix,
        );
        expect(await runEffect(core(key, args))).toEqual(value);
        expect(await tested.inventory()).toEqual(after);
      }
  await ce0FirstInsertExecutionScenario(persistence, tested);
  // Actual storage-return corruption must not be mistaken for a business
  // uniqueness conflict, nor accepted just because identity and digest match.
  for (const mode of ["alter", "suppress"] as const) {
    await persistence.query(`create function ce50_claim_fault() returns trigger language plpgsql as $$
      begin
        ${
          mode === "suppress"
            ? "return null;"
            : `new.encoded_key := set_byte(new.encoded_key, octet_length(new.encoded_key) - 1,
          get_byte(new.encoded_key, octet_length(new.encoded_key) - 1) # 1); return new;`
        }
      end $$`);
    try {
      await persistence.query(
        "create trigger ce50_claim_fault before insert on fx_app_unique_key for each row execute function ce50_claim_fault()",
      );
      try {
        for (const run of [core, reference.run]) {
          const before = await tested.inventory();
          expect(
            await runEffectFailure(
              run(tested.host.newRequestKey(), {
                count: 8,
                prefix: `fault-${mode}`,
              }),
            ),
          ).toMatchObject({ reason: "storedCorruption" });
          expect(await tested.inventory()).toEqual(before);
        }
      } finally {
        await persistence.query(
          "drop trigger ce50_claim_fault on fx_app_unique_key",
        );
      }
    } finally {
      await persistence.query("drop function ce50_claim_fault()");
    }
  }
}
