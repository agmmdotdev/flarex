import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertNewEvidencePath,
  isPathInside,
  readH05EvidenceInputFile,
  resolveH05EvidenceOutputPath,
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

  it("reads only bounded regular input files outside the worktree", async () => {
    const directory = await mkdtemp(join(tmpdir(), "flarex-h05-input-"));
    const workspaceRoot = join(directory, "worktree");
    const outsideRoot = join(directory, "outside");
    const insideInput = join(workspaceRoot, "inside.json");
    const outsideInput = join(outsideRoot, "outside.json");
    try {
      await mkdir(workspaceRoot);
      await mkdir(outsideRoot);
      await writeFile(insideInput, "inside", "utf8");
      await writeFile(outsideInput, "outside", "utf8");

      await expect(
        readH05EvidenceInputFile({
          workspaceRoot,
          argument: outsideInput,
          label: "trace",
          maximumBytes: 7,
          maximumSizeLabel: "7 bytes",
        }),
      ).resolves.toBe("outside");
      await expect(
        readH05EvidenceInputFile({
          workspaceRoot,
          argument: insideInput,
          label: "trace",
          maximumBytes: 7,
          maximumSizeLabel: "7 bytes",
        }),
      ).rejects.toThrow(
        "H05 trace evidence input must stay outside the Git worktree.",
      );
      await expect(
        readH05EvidenceInputFile({
          workspaceRoot,
          argument: outsideInput,
          label: "trace",
          maximumBytes: 6,
          maximumSizeLabel: "6 bytes",
        }),
      ).rejects.toThrow(
        "H05 trace evidence input must be a regular file no larger than 6 bytes.",
      );
      await expect(
        readH05EvidenceInputFile({
          workspaceRoot,
          argument: outsideRoot,
          label: "trace",
          maximumBytes: 1024,
          maximumSizeLabel: "1 KiB",
        }),
      ).rejects.toThrow(
        "H05 trace evidence input must be a regular file no larger than 1 KiB.",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("resolves output names through a real outside-worktree parent", async () => {
    const directory = await mkdtemp(join(tmpdir(), "flarex-h05-output-"));
    const workspaceRoot = join(directory, "worktree");
    const outsideRoot = join(directory, "outside");
    const nonDirectoryParent = join(outsideRoot, "not-a-directory");
    try {
      await mkdir(workspaceRoot);
      await mkdir(outsideRoot);
      await writeFile(nonDirectoryParent, "file", "utf8");

      await expect(
        resolveH05EvidenceOutputPath({
          workspaceRoot,
          argument: join(outsideRoot, "trace.json"),
          label: "trace evidence",
        }),
      ).resolves.toBe(join(outsideRoot, "trace.json"));
      await expect(
        resolveH05EvidenceOutputPath({
          workspaceRoot,
          argument: join(workspaceRoot, "trace.json"),
          label: "trace evidence",
        }),
      ).rejects.toThrow(
        "H05 trace evidence output must stay outside the Git worktree.",
      );
      await expect(
        resolveH05EvidenceOutputPath({
          workspaceRoot,
          argument: join(nonDirectoryParent, "trace.json"),
          label: "trace evidence",
        }),
      ).rejects.toThrow(
        "H05 trace evidence output parent must be a directory.",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects outside aliases that resolve back into the worktree", async () => {
    const directory = await mkdtemp(join(tmpdir(), "flarex-h05-alias-"));
    const workspaceRoot = join(directory, "worktree");
    const outsideRoot = join(directory, "outside");
    const workspaceAlias = join(outsideRoot, "worktree-alias");
    const insideInput = join(workspaceRoot, "inside.json");
    try {
      await mkdir(workspaceRoot);
      await mkdir(outsideRoot);
      await writeFile(insideInput, "inside", "utf8");
      await symlink(
        workspaceRoot,
        workspaceAlias,
        process.platform === "win32" ? "junction" : "dir",
      );

      await expect(
        readH05EvidenceInputFile({
          workspaceRoot,
          argument: join(workspaceAlias, "inside.json"),
          label: "trace",
          maximumBytes: 7,
          maximumSizeLabel: "7 bytes",
        }),
      ).rejects.toThrow(
        "H05 trace evidence input must stay outside the Git worktree.",
      );
      await expect(
        resolveH05EvidenceOutputPath({
          workspaceRoot,
          argument: join(workspaceAlias, "trace.json"),
          label: "trace evidence",
        }),
      ).rejects.toThrow(
        "H05 trace evidence output must stay outside the Git worktree.",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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
