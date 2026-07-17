import { describe, expect, it } from "vitest";

import { selectorNameForPartitionField } from "flarex-protocol/partition-selector";

describe("partition selector naming", () => {
  it.each([
    ["_id", "byId"],
    ["id", "byId"],
    ["slug", "bySlug"],
    ["clerkId", "byClerkId"],
    ["URL", "byURL"],
    ["team-slug", "byTeamSlug"],
    ["team__slug", "byTeamSlug"],
    ["123", "by123"],
    ["", "byPartition"],
    ["---", "byPartition"],
    ["é", "byPartition"],
  ] as const)("maps %j to %s", (field, expected) => {
    expect(selectorNameForPartitionField(field)).toBe(expected);
  });
});
