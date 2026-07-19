import { decodeSchemaManifestAppIndexFieldPath } from "flarex-protocol/schema-manifest";
import { Result } from "effect";
import {
  MAX_ORDERED_INDEX_KEY_BYTES_V1,
  compileAppOrderedIndexBoundsV1,
  encodeAppOrderedIndexKeyV1,
  lowerAppDeveloperOrderedIndexPhysicalSpecV1,
  orderedIndexBoundHexV1ToBytes,
  orderedIndexBytesV1FromBytes,
  orderedIndexCreationTimeV1,
  orderedIndexKeyHexV1ToBytes,
  orderedIndexRowIdHexV1FromBytesResult,
  orderedIndexRowIdHexV1ToBytes,
  type AppOrderedIndexPhysicalFieldV1,
  type AppOrderedIndexPhysicalSpecV1,
  type OrderedIndexKeyHexV1,
  type OrderedIndexValueV1,
} from "flarex-protocol/ordered-index";
import { describe, expect, it } from "vitest";

import type { PostgresFlarexPersistence } from "../src/postgres";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("real Postgres ordered index key codec", () => {
  it("supports ordered half-open scans and the accepted composite B-tree ceiling", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await persistence.query(`
        create table ordered_index_key_probe (
          scope_id uuid not null,
          index_definition_id bigint not null,
          encoded_key bytea not null,
          row_id bytea not null check (octet_length(row_id) = 16),
          label text not null,
          primary key (scope_id, index_definition_id, encoded_key, row_id)
        )
      `);
      const spec = physicalSpec("teamId", "score");
      const bounds = compileAppOrderedIndexBoundsV1({
        spec,
        expressions: [
          {
            op: "eq",
            field: requiredField(spec, 0),
            value: stringValue("team-a"),
          },
          {
            op: "gte",
            field: requiredField(spec, 1),
            value: int64(2n),
          },
          {
            op: "lt",
            field: requiredField(spec, 1),
            value: int64(10n),
          },
        ],
      });

      for (const [label, teamId, score, rowByte] of [
        ["before", "team-a", 1n, 1],
        ["first", "team-a", 2n, 1],
        ["first-tie", "team-a", 2n, 2],
        ["middle", "team-a", 9n, 1],
        ["after", "team-a", 10n, 1],
        ["escaped-team", "team-a\u0000", 3n, 1],
        ["other-team", "team-b", 3n, 1],
      ] as const) {
        await insertProbe(persistence, {
          label,
          encodedKey: encodeAppOrderedIndexKeyV1({
            spec,
            values: [
              stringValue(teamId),
              int64(score),
              orderedIndexCreationTimeV1(100),
            ],
          }),
          rowByte,
        });
      }

      if (
        bounds.startInclusive === undefined ||
        bounds.endExclusive === undefined
      ) {
        throw new Error("Expected bounded real-Postgres interval.");
      }
      const selected = await persistence.query<{ label: string }>(
        `
          select label
          from ordered_index_key_probe
          where scope_id = $1
            and index_definition_id = $2
            and encoded_key >= $3
            and encoded_key < $4
          order by encoded_key, row_id
        `,
        [
          PROBE_SCOPE_ID,
          1,
          orderedIndexBoundHexV1ToBytes(bounds.startInclusive),
          orderedIndexBoundHexV1ToBytes(bounds.endExclusive),
        ],
      );
      expect(selected.rows).toEqual([
        { label: "first" },
        { label: "first-tie" },
        { label: "middle" },
      ]);

      const equalityBounds = compileAppOrderedIndexBoundsV1({
        spec,
        expressions: [
          {
            op: "eq",
            field: requiredField(spec, 0),
            value: stringValue("team-a"),
          },
        ],
      });
      if (
        equalityBounds.startInclusive === undefined ||
        equalityBounds.endExclusive === undefined
      ) {
        throw new Error("Expected bounded real-Postgres equality interval.");
      }
      const equalitySelected = await persistence.query<{ label: string }>(
        `
          select label
          from ordered_index_key_probe
          where scope_id = $1
            and index_definition_id = $2
            and encoded_key >= $3
            and encoded_key < $4
          order by encoded_key, row_id
        `,
        [
          PROBE_SCOPE_ID,
          1,
          orderedIndexBoundHexV1ToBytes(equalityBounds.startInclusive),
          orderedIndexBoundHexV1ToBytes(equalityBounds.endExclusive),
        ],
      );
      expect(equalitySelected.rows).toEqual([
        { label: "before" },
        { label: "first" },
        { label: "first-tie" },
        { label: "middle" },
        { label: "after" },
      ]);

      const maximumKey = encodeAppOrderedIndexKeyV1({
        spec: physicalSpec("value"),
        values: [
          bytesValue(nonZeroPseudoRandomBytes(2_037)),
          orderedIndexCreationTimeV1(1),
        ],
      });
      expect(maximumKey.length / 2).toBe(MAX_ORDERED_INDEX_KEY_BYTES_V1);
      await expect(
        insertProbe(persistence, {
          label: "maximum",
          encodedKey: maximumKey,
          rowByte: 3,
        }),
      ).resolves.toBeUndefined();
      const maximum = await persistence.query<{
        encodedKeyBytes: number;
        rowIdBytes: number;
      }>(
        `
          select
            octet_length(encoded_key)::int as "encodedKeyBytes",
            octet_length(row_id)::int as "rowIdBytes"
          from ordered_index_key_probe
          where label = 'maximum'
        `,
      );
      expect(maximum.rows).toEqual([{
        encodedKeyBytes: MAX_ORDERED_INDEX_KEY_BYTES_V1,
        rowIdBytes: 16,
      }]);
    });
  }, 30_000);
});

const PROBE_SCOPE_ID = "11111111-1111-4111-8111-111111111111";

async function insertProbe(
  persistence: PostgresFlarexPersistence,
  input: {
    readonly label: string;
    readonly encodedKey: OrderedIndexKeyHexV1;
    readonly rowByte: number;
  },
): Promise<void> {
  const rowId = new Uint8Array(16);
  rowId[15] = input.rowByte;
  await persistence.query(
    `
      insert into ordered_index_key_probe
        (scope_id, index_definition_id, encoded_key, row_id, label)
      values ($1, $2, $3, $4, $5)
    `,
    [
      PROBE_SCOPE_ID,
      1,
      orderedIndexKeyHexV1ToBytes(input.encodedKey),
      orderedIndexRowIdHexV1ToBytes(
        Result.getOrThrow(orderedIndexRowIdHexV1FromBytesResult(rowId)),
      ),
      input.label,
    ],
  );
}

function physicalSpec(...fields: string[]): AppOrderedIndexPhysicalSpecV1 {
  return lowerAppDeveloperOrderedIndexPhysicalSpecV1({
    kind: "developerOrdered",
    specVersion: 1,
    fields: fields.map((field) => decodeSchemaManifestAppIndexFieldPath(field)),
  });
}

function requiredField(
  spec: AppOrderedIndexPhysicalSpecV1,
  index: number,
): AppOrderedIndexPhysicalFieldV1 {
  const field = spec.orderedFields[index];
  if (field === undefined) throw new Error(`Missing physical field ${index}.`);
  return field;
}

function stringValue(value: string): OrderedIndexValueV1 {
  return { kind: "string", value };
}

function int64(value: bigint): OrderedIndexValueV1 {
  return { kind: "int64", value };
}

function bytesValue(value: Uint8Array): OrderedIndexValueV1 {
  return orderedIndexBytesV1FromBytes(value);
}

function nonZeroPseudoRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let state = 0x9e37_79b9;
  for (let index = 0; index < bytes.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    const byte = state & 0xff;
    bytes[index] = byte === 0 ? 0x80 : byte;
  }
  return bytes;
}
