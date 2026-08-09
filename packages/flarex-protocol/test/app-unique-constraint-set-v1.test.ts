import { describe, expect, it } from "vitest";

import {
  canonicalizeAppUniqueConstraintSetV1,
} from "../src/app-unique-constraint-set-v1";

const member = (
  logicalUniqueConstraintId: number,
  uniqueConstraintDefinitionId: number,
  tableId: number,
  physicalSpecSha256Hex: string,
) => ({
  logicalUniqueConstraintId,
  uniqueConstraintDefinitionId,
  tableId,
  physicalSpecSha256Hex,
});

describe("app unique constraint set v1", () => {
  it("sorts and commits the exact definition set", async () => {
    const canonical = await canonicalizeAppUniqueConstraintSetV1([
      member(2, 9, 4, "bb".repeat(32)),
      member(1, 3, 2, "aa".repeat(32)),
    ]);

    expect(canonical.memberCount).toBe(2);
    expect(canonical.members.map((entry) => entry.uniqueConstraintDefinitionId))
      .toEqual([3, 9]);
    expect(canonical.canonicalText).toBe(
      '{"format":"flarexdb-app-unique-constraint-set","members":[{"logicalUniqueConstraintId":1,"physicalSpecSha256Hex":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","tableId":2,"uniqueConstraintDefinitionId":3},{"logicalUniqueConstraintId":2,"physicalSpecSha256Hex":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","tableId":4,"uniqueConstraintDefinitionId":9}],"setCodecVersion":1}',
    );
    expect(canonical.sha256Hex).toBe(
      "14feb5b1207118460f9ff4ed20cf1fc6a824e947abcd5fed7c5cf3ad9bc59db7",
    );
    expect(Object.isFrozen(canonical.members)).toBe(true);
  });

  it("rejects duplicate logical and physical identities", async () => {
    for (const candidate of [
      [member(1, 3, 2, "aa".repeat(32)), member(1, 4, 2, "bb".repeat(32))],
      [member(1, 3, 2, "aa".repeat(32)), member(2, 3, 2, "bb".repeat(32))],
    ]) {
      await expect(canonicalizeAppUniqueConstraintSetV1(candidate)).rejects
        .toBeDefined();
    }
  });

  it("commits the empty closed set", async () => {
    const canonical = await canonicalizeAppUniqueConstraintSetV1([]);
    expect(canonical.memberCount).toBe(0);
    expect(canonical.canonicalText).toBe(
      '{"format":"flarexdb-app-unique-constraint-set","members":[],"setCodecVersion":1}',
    );
    expect(canonical.sha256Hex).toBe(
      "df81e359d9cbbaa113a0e43a6cde675212b7b3d4d1ef6f79249a3fdf079647bf",
    );
  });
});
