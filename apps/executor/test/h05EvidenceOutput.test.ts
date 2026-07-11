import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertNewEvidencePath,
  isPathInside,
  writeNewAtomicEvidenceFile,
} from "../scripts/h05EvidenceOutput";

describe("H05 evidence output boundary", () => {
  it("distinguishes worktree children from similarly prefixed siblings", () => {
    const root = join(tmpdir(), "flarex-worktree");

    expect(isPathInside(root, join(root, "receipt.json"))).toBe(true);
    expect(isPathInside(root, root)).toBe(true);
    expect(
      isPathInside(root, join(tmpdir(), "flarex-worktree-output", "receipt.json")),
    ).toBe(false);
  });

  it("publishes one new file atomically and never replaces evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "flarex-h05-evidence-"));
    const output = join(directory, "invocation.json");
    try {
      await expect(assertNewEvidencePath(output)).resolves.toBeUndefined();
      await writeNewAtomicEvidenceFile(output, "first\n");

      await expect(readFile(output, "utf8")).resolves.toBe("first\n");
      await expect(assertNewEvidencePath(output)).rejects.toThrow(
        "H05 evidence output already exists.",
      );
      await expect(
        writeNewAtomicEvidenceFile(output, "replacement\n"),
      ).rejects.toMatchObject({ code: "EEXIST" });
      await expect(readFile(output, "utf8")).resolves.toBe("first\n");
      await expect(readdir(directory)).resolves.toEqual(["invocation.json"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
