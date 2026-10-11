import { is, SQL } from "drizzle-orm";

export type CaptureProjectionField = Readonly<{ path: readonly string[]; field: SQL }>;
export function captureDriverDecoder(field: SQL) {
  if (!is(field, SQL)) throw new Error("Invalid fixed capture SQL projection");
  const decoder: unknown = Reflect.get(field, "decoder");
  if (decoder === null || typeof decoder !== "object") throw new Error("Missing fixed capture SQL decoder");
  const method: unknown = Reflect.get(decoder, "mapFromDriverValue");
  if (typeof method !== "function") throw new Error("Invalid fixed capture SQL decoder");
  const decodeDriverValue = method.bind(decoder);
  return (value: unknown): unknown => value === null ? null : decodeDriverValue(value);
}

/** Compile the actual positional projection into header and final body slots.
 * Native scalar conversion remains inside execute; layout refusals wait for
 * canonical header acceptance. No live authority or driver result is retained. */
export function compileFiniteCaptureResultMapper<Header>(fields: readonly CaptureProjectionField[],
  layout: Readonly<{ historicalIdentity: boolean; fullArtifact: boolean }>) {
  type HeaderRecord = Record<string, unknown> & Partial<Record<"frontier", Record<string, unknown>>>;
  const headerSlots: Array<Readonly<{ index: number; decode: (value: unknown) => unknown;
    assign: (header: HeaderRecord, value: unknown) => void; repeat: "null" | "epoch" | "false" | "identity" }>> = [];
  const bodySlots: Array<Readonly<{ index: number; name: string;
    decode: (value: unknown) => unknown }>> = [];
  let markerIndex = -1;
  for (const [index, { path, field }] of fields.entries()) {
    const decode = captureDriverDecoder(field);
    if (path.length < 1 || path.length > 2) throw new Error("Invalid finite capture projection path");
    const name = path[path.length - 1]!;
    if (path.length === 1 && name === "storagePresent") { markerIndex = index; continue; }
    if (path[0] === "raw") {
      if (path.length !== 2) throw new Error("Invalid finite capture body projection");
      bodySlots.push({ index, name, decode });
      continue;
    }
    let assign: (header: HeaderRecord, value: unknown) => void;
    if (path.length === 1) assign = (header, value) => { header[name] = value; };
    else {
      const group = path[0]!;
      if (group !== "frontier")
        throw new Error("Invalid finite capture header group");
      assign = (header, value) => {
        if (header.reason !== "attemptReplaced") return;
        let target = header[group];
        if (target === undefined) { target = {}; header[group] = target; }
        target[name] = value;
      };
    }
    const repeat = path.length === 1 && (name === "targetMetadataEpoch" || name === "controlMetadataEpoch") && layout.fullArtifact ? "epoch" :
      path.length === 1 && name === "exists" ? layout.historicalIdentity ? "identity" : "false" : "null";
    headerSlots.push({ index, decode, assign, repeat });
  }
  if (markerIndex < 0) throw new Error("Missing finite capture storage marker");
  return (rows: unknown[][]) => {
    let header: HeaderRecord | undefined;
    let layoutFailure: string | undefined;
    const rawRows: Record<string, unknown>[] = [];
    for (let ordinal = 0; ordinal < rows.length; ordinal++) {
      const row = rows[ordinal]!;
      if (row.length !== fields.length) layoutFailure ??= "Finite capture column count changed";
      if (ordinal === 0) {
        header = {};
        for (const slot of headerSlots) slot.assign(header, slot.index < row.length ? slot.decode(row[slot.index]) : undefined);
      } else {
        for (const slot of headerSlots) {
          if (slot.index >= row.length) continue;
          const value = row[slot.index];
          // Convert a malformed present scalar before reporting its layout.
          // This preserves the native driver's execute failure boundary.
          const decoded = value === null ? null : slot.decode(value);
          const valid = slot.repeat === "null" ? value === null : slot.repeat === "false" ? decoded === false :
            decoded === rows[0]![slot.index];
          if (!valid) layoutFailure ??= "Finite capture header repetition changed";
        }
      }
      const present = row[markerIndex];
      if (present !== true && present !== false) layoutFailure ??= "Invalid finite capture storage marker";
      const body: Record<string, unknown> | undefined = present === true ? {} : undefined;
      for (const slot of bodySlots) {
        if (slot.index >= row.length) continue;
        const value = row[slot.index];
        if (body !== undefined) body[slot.name] = slot.decode(value);
        else if (value !== null) {
          slot.decode(value);
          layoutFailure ??= "Inactive finite capture body is populated";
        }
      }
      if (body !== undefined) rawRows.push(Object.freeze(body));
    }
    // SAFETY: The fixed descriptor retains the declared native scalar decoders.
    // Only replacement constructs the optional foreign anchor frontier; its
    // authoritative Schema/anchor owner validates it before consumption.
    return { header: header as (Omit<Header, "frontier"> & Readonly<{ frontier?: Record<string, unknown> }>) | undefined, rawRows: Object.freeze(rawRows),
      layoutFailure };
  };
}

