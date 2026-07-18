import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  open,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

export interface H05EvidenceInputFileOptions {
  readonly workspaceRoot: string;
  readonly argument: string;
  readonly label: string;
  readonly maximumBytes: number;
  readonly maximumSizeLabel: string;
}

export interface H05EvidenceOutputPathOptions {
  readonly workspaceRoot: string;
  readonly argument: string;
  readonly label: string;
}

export function isPathInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(resolve(root), resolve(candidate));
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot))
  );
}

export async function readH05EvidenceInputFile(
  options: H05EvidenceInputFileOptions,
): Promise<string> {
  const path = await realpath(resolve(options.argument));
  if (isPathInside(options.workspaceRoot, path)) {
    throw new Error(
      `H05 ${options.label} evidence input must stay outside the Git worktree.`,
    );
  }
  const input = await open(path, "r");
  try {
    const inputStat = await input.stat();
    if (!inputStat.isFile() || inputStat.size > options.maximumBytes) {
      throw evidenceInputSizeError(options);
    }
    const bytes = Buffer.allocUnsafe(options.maximumBytes + 1);
    let totalBytesRead = 0;
    while (totalBytesRead < bytes.byteLength) {
      const { bytesRead } = await input.read(
        bytes,
        totalBytesRead,
        bytes.byteLength - totalBytesRead,
        totalBytesRead,
      );
      if (bytesRead === 0) break;
      totalBytesRead += bytesRead;
    }
    if (totalBytesRead > options.maximumBytes) {
      throw evidenceInputSizeError(options);
    }
    return bytes.toString("utf8", 0, totalBytesRead);
  } finally {
    await input.close();
  }
}

export async function resolveH05EvidenceOutputPath(
  options: H05EvidenceOutputPathOptions,
): Promise<string> {
  const requestedOutputPath = resolve(options.argument);
  const parentPath = dirname(requestedOutputPath);
  const parent = await stat(parentPath);
  if (!parent.isDirectory()) {
    throw new Error(`H05 ${options.label} output parent must be a directory.`);
  }
  const outputPath = resolve(
    await realpath(parentPath),
    basename(requestedOutputPath),
  );
  if (isPathInside(options.workspaceRoot, outputPath)) {
    throw new Error(
      `H05 ${options.label} output must stay outside the Git worktree.`,
    );
  }
  return outputPath;
}

export async function assertNewEvidencePath(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
  throw new Error("H05 evidence output already exists.");
}

export async function writeNewAtomicEvidenceFile(
  path: string,
  content: string,
): Promise<void> {
  const temporaryPath = resolve(
    dirname(path),
    `.${basename(path)}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, content, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await link(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function evidenceInputSizeError(
  options: H05EvidenceInputFileOptions,
): Error {
  return new Error(
    `H05 ${options.label} evidence input must be a regular file no larger than ${options.maximumSizeLabel}.`,
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
