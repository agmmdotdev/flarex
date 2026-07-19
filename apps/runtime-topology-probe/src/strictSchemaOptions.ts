/** Runtime-topology wire policy for strict Effect Schema structs. */
export const StrictStructOptions = {
  parseOptions: { onExcessProperty: "error" },
} as const;

/** Runtime-topology wire policy for strict Effect Schema decoders. */
export const StrictParseOptions = { onExcessProperty: "error" } as const;
