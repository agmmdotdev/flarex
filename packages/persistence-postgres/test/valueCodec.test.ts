import {
  canonicalizeFlarexValueV1,
  verifyFlarexValueEvidenceV1,
} from "flarex-protocol/value";
import { describe, expect, it } from "vitest";

import { createPGlitePersistence } from "../src/pglite";

type StoredValueRow = Record<string, unknown> & {
  readonly codec_version: number;
  readonly value_json: unknown;
  readonly canonical_bytes: Uint8Array;
  readonly sha256: Uint8Array;
};

describe("Flarex value codec on PGlite jsonb", () => {
  it("round-trips canonical value evidence without losing NUL strings or specials", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.exec(`
      create temporary table value_codec_probe (
        id integer primary key,
        codec_version integer not null,
        value_json jsonb not null,
        canonical_bytes bytea not null,
        sha256 bytea not null
      )
    `);
    const canonical = await canonicalizeFlarexValueV1({
      nul: "before\u0000after",
      integer: 9_007_199_254_740_993n,
      negativeZero: -0,
      bytes: new Uint8Array([0, 127, 255]).buffer,
    }, "appDocument");

    await expect(
      persistence.query("select $1::jsonb", [JSON.stringify("a\u0000b")]),
    ).rejects.toThrow();
    await persistence.query(
      `
        insert into value_codec_probe
          (id, codec_version, value_json, canonical_bytes, sha256)
        values ($1, $2, $3::jsonb, $4, $5)
      `,
      [
        1,
        canonical.codecVersion,
        JSON.stringify(canonical.valueJson),
        canonical.canonicalBytes,
        canonical.sha256,
      ],
    );

    const selected = await persistence.query<StoredValueRow>(`
      select codec_version, value_json, canonical_bytes, sha256
      from value_codec_probe
      where id = 1
    `);
    const row = selected.rows[0];
    if (row === undefined) throw new Error("PGlite lost the codec probe row.");

    expect(row.value_json).toEqual(canonical.valueJson);
    expect(row.canonical_bytes).toEqual(canonical.canonicalBytes);
    expect(row.sha256).toEqual(canonical.sha256);
    const verified = await verifyFlarexValueEvidenceV1({
      codecVersion: row.codec_version,
      valueJson: row.value_json,
      canonicalBytes: row.canonical_bytes,
      sha256: row.sha256,
      profile: "appDocument",
    });
    expect(verified.value).toEqual(canonical.value);
    expect(verified.canonicalText).toBe(canonical.canonicalText);
  });
});
