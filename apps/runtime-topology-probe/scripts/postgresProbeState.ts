import { randomUUID } from "node:crypto";
import {
  type FileHandle,
  open,
  rename,
  rm,
} from "node:fs/promises";

export type ProbeProvisionPhase =
  | "planned"
  | "database-ready"
  | "hyperdrive-create-attempted"
  | "ready";

export interface ProbeState {
  readonly protocolVersion: 1;
  readonly phase: ProbeProvisionPhase;
  readonly schemaName: string;
  readonly roleName: string;
  readonly rolePassword: string;
  readonly directHost: string;
  readonly database: string;
  readonly port: number;
  readonly hyperdriveId: string | null;
  readonly hyperdriveName: string;
  readonly hyperdriveDeleted: boolean;
}

export function decodeProbeState(value: unknown): ProbeState {
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    (value as { protocolVersion?: unknown }).protocolVersion !== 1
  ) throw new Error("Invalid P28 Postgres state.");
  const state = value as Partial<ProbeState>;
  if (
    (state.phase !== "planned" &&
      state.phase !== "database-ready" &&
      state.phase !== "hyperdrive-create-attempted" &&
      state.phase !== "ready") ||
    !isPostgresIdentifier(state.schemaName) ||
    !isPostgresIdentifier(state.roleName) ||
    typeof state.rolePassword !== "string" ||
    state.rolePassword.length < 16 ||
    typeof state.directHost !== "string" ||
    state.directHost.length === 0 ||
    typeof state.database !== "string" ||
    state.database.length === 0 ||
    !Number.isSafeInteger(state.port) ||
    (state.port ?? 0) < 1 ||
    (state.port ?? 0) > 65_535 ||
    typeof state.hyperdriveName !== "string" ||
    !/^flarex-runtime-topology-probe-p28-[0-9a-f]{10}$/.test(
      state.hyperdriveName,
    ) ||
    (state.hyperdriveId !== null &&
      (typeof state.hyperdriveId !== "string" ||
        !/^[0-9a-f]{32}$/i.test(state.hyperdriveId))) ||
    typeof state.hyperdriveDeleted !== "boolean" ||
    (state.hyperdriveDeleted && state.hyperdriveId === null) ||
    (state.phase === "ready" && state.hyperdriveId === null)
  ) throw new Error("Incomplete P28 Postgres state.");
  return state as ProbeState;
}

export function hyperdriveAbsenceLookupAttempts(
  phase: ProbeProvisionPhase,
): 1 | 3 {
  return phase === "hyperdrive-create-attempted" ? 3 : 1;
}

export function isPostgresIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,62}$/.test(value);
}

type PublishProbeState = (source: URL, target: URL) => Promise<void>;

export interface ProbeStateWriteOperations {
  readonly prepare?: (
    handle: FileHandle,
    contents: string,
  ) => Promise<void>;
  readonly publish?: PublishProbeState;
}

export async function writeProbeStateAtomically(
  target: URL,
  state: ProbeState,
  operations: ProbeStateWriteOperations = {},
): Promise<void> {
  const temporary = new URL(
    `p28-postgres.${randomUUID()}.tmp`,
    target,
  );
  const contents = `${JSON.stringify(state, null, 2)}\n`;
  const prepare = operations.prepare ?? (async (handle, value) => {
    await handle.writeFile(value, "utf8");
    await handle.sync();
  });
  const publish = operations.publish ?? (async (source, destination) => {
    await rename(source, destination);
  });
  let handle: FileHandle | undefined;
  try {
    handle = await open(temporary, "wx", 0o600);
    try {
      await prepare(handle, contents);
    } finally {
      await handle.close();
      handle = undefined;
    }
    await publish(temporary, target);
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true });
  }
}
