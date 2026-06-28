import type { Json as ProtocolJson } from "flarex-protocol/json";
import type { Json } from "../types";

export function backendJson(value: ProtocolJson): Json {
  if (Array.isArray(value)) {
    return value.map(backendJson);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, backendJson(entry)]),
    );
  }
  return value;
}

export function backendJsonRecord(
  value: { readonly [key: string]: ProtocolJson },
): { [key: string]: Json } {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, backendJson(entry)]),
  );
}
