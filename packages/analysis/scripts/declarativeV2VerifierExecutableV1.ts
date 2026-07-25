import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DECLARATIVE_V2_CORE_DIAGNOSTICS_V1,
} from "../src/declarativeV2VerifierV1.contract";
import {
  GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1,
} from "../src/declarativeV2VerifierV1.generated";
import {
  DECLARATIVE_V2_ASI_RULES_V1,
  DECLARATIVE_V2_CANONICAL_NONTERMINALS_V1,
  DECLARATIVE_V2_CANONICAL_PRECEDENCE_V1,
  DECLARATIVE_V2_CANONICAL_PRODUCTIONS_V1,
  DECLARATIVE_V2_CANONICAL_SEMANTIC_OPCODES_V1,
  DECLARATIVE_V2_CANONICAL_TERMINALS_V1,
  DECLARATIVE_V2_CANONICAL_UTF8_BYTE_CLASSES_V1,
  DECLARATIVE_V2_CANONICAL_UTF8_STATES_V1,
  DECLARATIVE_V2_CANONICAL_UTF8_TRANSITIONS_V1,
  DECLARATIVE_V2_KEYWORDS_V1,
  DECLARATIVE_V2_LEXICAL_BYTE_CLASSES_V1,
  DECLARATIVE_V2_MODULE_PARSER_ACTIONS_V1,
  DECLARATIVE_V2_MODULE_PARSER_GOTOS_V1,
  DECLARATIVE_V2_MODULE_PARSER_STATES_V1,
  DECLARATIVE_V2_NUMBER_TRANSITIONS_V1,
  DECLARATIVE_V2_OPERATOR_PRECEDENCE_V1,
  DECLARATIVE_V2_PARSER_NONTERMINALS_V1,
  DECLARATIVE_V2_PARSER_NONTERMINAL_FLAG_V1,
  DECLARATIVE_V2_PARSER_PRODUCTIONS_V1,
  DECLARATIVE_V2_PARSER_RECOVERY_V1,
  DECLARATIVE_V2_PARSER_TERMINALS_V1,
  DECLARATIVE_V2_PUNCTUATORS_V1,
  DECLARATIVE_V2_REGEX_GOAL_AFTER_V1,
  DECLARATIVE_V2_SAFE_ABI_LOOKUP_V1,
  DECLARATIVE_V2_SEMANTIC_ACTIONS_V1,
  DECLARATIVE_V2_TEMPLATE_TRANSITIONS_V1,
  DECLARATIVE_V2_UTF8_TRANSITIONS_V1,
  DECLARATIVE_V2_VERIFIER_EXECUTABLE_CONTRACT_V1,
  DECLARATIVE_V2_VERIFIER_EXECUTABLE_SECTIONS_V1,
  DECLARATIVE_V2_VERIFIER_EXECUTABLE_TABLE_ALIGNMENT_V1,
  DECLARATIVE_V2_VERIFIER_EXECUTABLE_TABLE_HEADER_BYTES_V1,
  DECLARATIVE_V2_VERIFIER_EXECUTABLE_TABLE_MAGIC_V1,
  DECLARATIVE_V2_VERIFIER_EXECUTABLE_TABLE_SECTION_BYTES_V1,
  DECLARATIVE_V2_VERIFIER_EXECUTABLE_TABLE_VERSION_V1,
} from "../src/declarativeV2VerifierExecutableV1.contract";

const UTF8_ENCODER = new TextEncoder();
const GENERATED_FILE = "src/declarativeV2VerifierExecutableV1.generated.ts";
const CONTRACT_FILE = "src/declarativeV2VerifierExecutableV1.contract.ts";
const GENERATOR_FILE = "scripts/declarativeV2VerifierExecutableV1.ts";
const GENERATOR_VERSION = "1" as const;

interface AssetSection {
  readonly id: number;
  readonly recordBytes: number;
  readonly count: number;
  readonly bytes: Uint8Array;
}

export interface DeclarativeV2VerifierExecutableManifestV1 {
  readonly formatVersion: 1;
  readonly generatorVersion: "1";
  readonly assetSha256: string;
  readonly assetByteLength: number;
  readonly contractSha256: string;
  readonly contractSourceSha256: string;
  readonly generatorSourceSha256: string;
  readonly acceptedSpecificationManifestIdentity: string;
  readonly acceptedSpecificationAssetSha256: string;
  readonly sectionCount: number;
  readonly manifestIdentity: string;
}

export interface GeneratedDeclarativeV2VerifierExecutableV1 {
  readonly asset: Uint8Array;
  readonly manifest: DeclarativeV2VerifierExecutableManifestV1;
  readonly source: string;
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Executable-table generator rejects non-finite numbers.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",")}}`;
  }
  throw new Error("Executable-table generator received an unsupported value.");
}

function align(value: number, alignment: number): number {
  const remainder = value % alignment;
  return remainder === 0 ? value : value + alignment - remainder;
}

function writeU16(target: Uint8Array, offset: number, value: number): void {
  new DataView(target.buffer, target.byteOffset, target.byteLength)
    .setUint16(offset, value, false);
}

function writeU32(target: Uint8Array, offset: number, value: number): void {
  new DataView(target.buffer, target.byteOffset, target.byteLength)
    .setUint32(offset, value, false);
}

function hexToBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error("Expected a lowercase SHA-256 value.");
  }
  return Uint8Array.from({ length: 32 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  );
}

function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (const byte of UTF8_ENCODER.encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function assertUniqueHashes(name: string, values: ReadonlyArray<string>): void {
  const seen = new Map<number, string>();
  for (const value of values) {
    const hash = fnv1a32(value);
    const previous = seen.get(hash);
    if (previous !== undefined) {
      throw new Error(
        `${name} has a deterministic FNV-1a collision: ${previous} and ${value}.`,
      );
    }
    seen.set(hash, value);
  }
}

function encodeHashedStrings(values: ReadonlyArray<string>): Uint8Array {
  assertUniqueHashes("string table", values);
  const bytes = new Uint8Array(values.length * 12);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    const encoded = UTF8_ENCODER.encode(value);
    if (encoded.byteLength > 0xffff) throw new Error("Lookup spelling is too long.");
    const offset = index * 12;
    writeU32(bytes, offset, fnv1a32(value));
    writeU16(bytes, offset + 4, encoded.byteLength);
    writeU16(bytes, offset + 6, index + 1);
    writeU32(bytes, offset + 8, 0);
  }
  return bytes;
}

function byteClassTable(): Uint8Array {
  const classes = new Uint8Array(256);
  const claim = (byte: number, id: number): void => {
    if (classes[byte] === 0) classes[byte] = id;
  };
  for (const definition of DECLARATIVE_V2_LEXICAL_BYTE_CLASSES_V1) {
    for (const byte of "bytes" in definition ? definition.bytes ?? [] : []) {
      claim(byte, definition.id);
    }
    for (const range of "ranges" in definition ? definition.ranges ?? [] : []) {
      for (let byte = range[0]; byte <= range[1]; byte += 1) {
        claim(byte, definition.id);
      }
    }
  }
  for (let byte = 0; byte < classes.length; byte += 1) {
    if (classes[byte] === 0) classes[byte] = 12;
  }
  const bytes = new Uint8Array(512);
  for (let byte = 0; byte < classes.length; byte += 1) {
    bytes[byte * 2] = byte;
    bytes[byte * 2 + 1] = classes[byte]!;
  }
  return bytes;
}

function encodeRowHashes(
  rows: ReadonlyArray<Readonly<{ id: number }>>,
  recordBytes: number,
): Uint8Array {
  const bytes = new Uint8Array(rows.length * recordBytes);
  const seen = new Set<number>();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    if (row.id !== index + 1 || seen.has(row.id)) {
      throw new Error("Executable table rows require contiguous stable IDs.");
    }
    seen.add(row.id);
    const offset = index * recordBytes;
    writeU32(bytes, offset, row.id);
    bytes.set(
      hexToBytes(sha256(canonicalJson(row))).subarray(0, recordBytes - 4),
      offset + 4,
    );
  }
  return bytes;
}

function assertContiguousIds(
  name: string,
  rows: ReadonlyArray<Readonly<{ id: number }>>,
): void {
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index]?.id !== index + 1) {
      throw new Error(`${name} requires contiguous stable IDs.`);
    }
  }
}

function encodeNumericRows<T extends Readonly<{ id: number }>>(
  name: string,
  rows: ReadonlyArray<T>,
  recordBytes: number,
  fields: ReadonlyArray<(row: T) => number>,
): Uint8Array {
  assertContiguousIds(name, rows);
  if (recordBytes !== (fields.length + 1) * 4) {
    throw new Error(`${name} has an invalid fixed-width record definition.`);
  }
  const bytes = new Uint8Array(rows.length * recordBytes);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const offset = index * recordBytes;
    writeU32(bytes, offset, row.id);
    for (let field = 0; field < fields.length; field += 1) {
      const value = fields[field]!(row);
      if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
        throw new Error(`${name} row ${row.id} contains an invalid U32.`);
      }
      writeU32(bytes, offset + 4 + field * 4, value);
    }
  }
  return bytes;
}

function assertUniqueTransitionKeys(
  name: string,
  rows: ReadonlyArray<Readonly<{
    state: string | number;
    input?: string | number;
    terminal?: number;
    nonterminal?: number;
    byteClass?: number;
  }>>,
): void {
  const seen = new Set<string>();
  for (const row of rows) {
    const input = row.input ?? row.terminal ?? row.nonterminal ?? row.byteClass;
    const key = `${row.state}\0${String(input)}`;
    if (seen.has(key)) {
      throw new Error(
        `${name} contains a nondeterministic transition for ${row.state}/${row.input}.`,
      );
    }
    seen.add(key);
  }
}

const CANONICAL_NONTERMINAL_FLAG = 0x8000_0000;
const CANONICAL_ACTION_SHIFT = 1;
const CANONICAL_ACTION_REDUCE = 2;
const CANONICAL_ACTION_ACCEPT = 3;
const CANONICAL_SYNTAX_DIAGNOSTIC_ID = 4;

export interface DeclarativeV2CanonicalTerminalV1 {
  readonly id: number;
  readonly name: string;
}

export interface DeclarativeV2CanonicalNonterminalV1 {
  readonly id: number;
  readonly name: string;
}

export interface DeclarativeV2CanonicalProductionV1 {
  readonly id: number;
  readonly lhs: string;
  readonly rhs: ReadonlyArray<string>;
  readonly semanticOpcode: number;
  readonly precedenceTerminal?: string;
}

export interface DeclarativeV2CanonicalPrecedenceV1 {
  readonly id: number;
  readonly terminal: string;
  readonly precedence: number;
  readonly associativity: number;
}

export interface DeclarativeV2CanonicalGrammarSourceV1 {
  readonly terminals: ReadonlyArray<DeclarativeV2CanonicalTerminalV1>;
  readonly nonterminals: ReadonlyArray<DeclarativeV2CanonicalNonterminalV1>;
  readonly productions: ReadonlyArray<DeclarativeV2CanonicalProductionV1>;
  readonly precedence: ReadonlyArray<DeclarativeV2CanonicalPrecedenceV1>;
  readonly semanticOpcodes: ReadonlyArray<Readonly<{
    readonly id: number;
    readonly name: string;
  }>>;
}

export interface DeclarativeV2CompiledProductionHeaderV1 {
  readonly id: number;
  readonly lhs: number;
  readonly rhsOffset: number;
  readonly rhsLength: number;
  readonly precedenceTerminal: number;
  readonly semanticOpcode: number;
}

export interface DeclarativeV2CompiledProductionRhsV1 {
  readonly id: number;
  readonly symbol: number;
}

export interface DeclarativeV2CompiledLrItemV1 {
  readonly id: number;
  readonly production: number;
  readonly dot: number;
  readonly lookahead: number;
}

export interface DeclarativeV2CompiledLrStateV1 {
  readonly id: number;
  readonly itemOffset: number;
  readonly itemCount: number;
}

export interface DeclarativeV2CompiledLrActionV1 {
  readonly id: number;
  readonly state: number;
  readonly terminal: number;
  readonly action: number;
  readonly value: number;
}

export interface DeclarativeV2CompiledLrGotoV1 {
  readonly id: number;
  readonly state: number;
  readonly nonterminal: number;
  readonly nextState: number;
}

export interface DeclarativeV2CompiledLrRecoveryV1 {
  readonly id: number;
  readonly state: number;
  readonly terminal: number;
  readonly diagnostic: number;
  readonly consumes: 0;
}

export interface DeclarativeV2CompiledCanonicalGrammarV1 {
  readonly productionHeaders:
    ReadonlyArray<DeclarativeV2CompiledProductionHeaderV1>;
  readonly productionRhs: ReadonlyArray<DeclarativeV2CompiledProductionRhsV1>;
  readonly items: ReadonlyArray<DeclarativeV2CompiledLrItemV1>;
  readonly states: ReadonlyArray<DeclarativeV2CompiledLrStateV1>;
  readonly actions: ReadonlyArray<DeclarativeV2CompiledLrActionV1>;
  readonly gotos: ReadonlyArray<DeclarativeV2CompiledLrGotoV1>;
  readonly recovery: ReadonlyArray<DeclarativeV2CompiledLrRecoveryV1>;
  readonly unresolvedConflictCount: 0;
}

interface CanonicalNormalizedProduction {
  readonly id: number;
  readonly lhs: number;
  readonly rhs: ReadonlyArray<number>;
  readonly semanticOpcode: number;
  readonly precedenceTerminal: number;
}

interface CanonicalItem {
  readonly production: number;
  readonly dot: number;
  readonly lookahead: number;
}

interface CanonicalActionCandidate {
  readonly action: number;
  readonly value: number;
}

function assertUniqueNamesAndIds(
  name: string,
  rows: ReadonlyArray<Readonly<{ readonly id: number; readonly name: string }>>,
): void {
  assertContiguousIds(name, rows);
  const names = new Set<string>();
  for (const row of rows) {
    if (row.name.length === 0 || names.has(row.name)) {
      throw new Error(`${name} contains a duplicate or empty name.`);
    }
    names.add(row.name);
  }
}

function canonicalItemKey(item: CanonicalItem): string {
  return `${item.production}/${item.dot}/${item.lookahead}`;
}

function canonicalItemSetKey(items: ReadonlyArray<CanonicalItem>): string {
  return items.map(canonicalItemKey).join("|");
}

function compareCanonicalItems(
  left: CanonicalItem,
  right: CanonicalItem,
): number {
  return left.production - right.production ||
    left.dot - right.dot ||
    left.lookahead - right.lookahead;
}

function canonicalGrammarSource(
  overrides?: Partial<DeclarativeV2CanonicalGrammarSourceV1>,
): DeclarativeV2CanonicalGrammarSourceV1 {
  return {
    terminals: overrides?.terminals ?? DECLARATIVE_V2_CANONICAL_TERMINALS_V1,
    nonterminals:
      overrides?.nonterminals ?? DECLARATIVE_V2_CANONICAL_NONTERMINALS_V1,
    productions:
      overrides?.productions ?? DECLARATIVE_V2_CANONICAL_PRODUCTIONS_V1,
    precedence:
      overrides?.precedence ?? DECLARATIVE_V2_CANONICAL_PRECEDENCE_V1,
    semanticOpcodes:
      overrides?.semanticOpcodes ??
      DECLARATIVE_V2_CANONICAL_SEMANTIC_OPCODES_V1,
  };
}

export function compileDeclarativeV2CanonicalGrammarV1(
  overrides?: Partial<DeclarativeV2CanonicalGrammarSourceV1>,
): DeclarativeV2CompiledCanonicalGrammarV1 {
  const source = canonicalGrammarSource(overrides);
  assertUniqueNamesAndIds("canonical terminals", source.terminals);
  assertUniqueNamesAndIds("canonical nonterminals", source.nonterminals);
  assertUniqueNamesAndIds("canonical semantic opcodes", source.semanticOpcodes);
  assertContiguousIds("canonical productions", source.productions);
  assertContiguousIds("canonical precedence", source.precedence);

  const terminalByName = new Map(
    source.terminals.map((terminal) => [terminal.name, terminal.id] as const),
  );
  const nonterminalByName = new Map(
    source.nonterminals.map((nonterminal) =>
      [nonterminal.name, nonterminal.id] as const
    ),
  );
  const semanticIds = new Set(
    source.semanticOpcodes.map(({ id }) => id),
  );
  const precedenceByTerminal = new Map<number, {
    readonly precedence: number;
    readonly associativity: number;
  }>();
  for (const row of source.precedence) {
    const terminal = terminalByName.get(row.terminal);
    if (
      terminal === undefined ||
      precedenceByTerminal.has(terminal) ||
      !Number.isSafeInteger(row.precedence) ||
      row.precedence < 1 ||
      (row.associativity !== 1 &&
        row.associativity !== 2 &&
        row.associativity !== 3)
    ) {
      throw new Error(
        `Canonical precedence ${row.id} has an inconsistent relation.`,
      );
    }
    precedenceByTerminal.set(terminal, {
      precedence: row.precedence,
      associativity: row.associativity,
    });
  }

  const normalizedProductions: CanonicalNormalizedProduction[] = [];
  for (const production of source.productions) {
    const lhs = nonterminalByName.get(production.lhs);
    if (lhs === undefined || !semanticIds.has(production.semanticOpcode)) {
      throw new Error(
        `Canonical production ${production.id} has a missing reference.`,
      );
    }
    const rhs: number[] = [];
    for (const name of production.rhs) {
      const terminal = terminalByName.get(name);
      const nonterminal = nonterminalByName.get(name);
      if (
        (terminal === undefined) === (nonterminal === undefined)
      ) {
        throw new Error(
          `Canonical production ${production.id} has a missing or ambiguous RHS reference.`,
        );
      }
      rhs.push(
        terminal ??
          ((CANONICAL_NONTERMINAL_FLAG |
            (nonterminal ?? 0)) >>> 0),
      );
    }
    const explicitPrecedence = production.precedenceTerminal === undefined
      ? undefined
      : terminalByName.get(production.precedenceTerminal);
    if (
      production.precedenceTerminal !== undefined &&
      (explicitPrecedence === undefined ||
        !precedenceByTerminal.has(explicitPrecedence))
    ) {
      throw new Error(
        `Canonical production ${production.id} has an inconsistent precedence reference.`,
      );
    }
    let precedenceTerminal = explicitPrecedence ?? 0;
    if (precedenceTerminal === 0) {
      for (let index = rhs.length - 1; index >= 0; index -= 1) {
        const symbol = rhs[index]!;
        if (
          (symbol & CANONICAL_NONTERMINAL_FLAG) === 0 &&
          precedenceByTerminal.has(symbol)
        ) {
          precedenceTerminal = symbol;
          break;
        }
      }
    }
    normalizedProductions.push({
      id: production.id,
      lhs,
      rhs: Object.freeze(rhs),
      semanticOpcode: production.semanticOpcode,
      precedenceTerminal,
    });
  }
  const eof = terminalByName.get("eof");
  const augmented = normalizedProductions[0];
  const moduleNonterminal = nonterminalByName.get("Module");
  if (
    eof === undefined ||
    augmented === undefined ||
    augmented.lhs !== nonterminalByName.get("$accept") ||
    augmented.rhs.length !== 1 ||
    augmented.rhs[0] !==
      ((CANONICAL_NONTERMINAL_FLAG | (moduleNonterminal ?? 0)) >>> 0)
  ) {
    throw new Error(
      "Canonical grammar requires one augmented $accept -> Module production.",
    );
  }

  const productive = new Set<number>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const production of normalizedProductions) {
      if (
        !productive.has(production.lhs) &&
        production.rhs.every((symbol) =>
          (symbol & CANONICAL_NONTERMINAL_FLAG) === 0 ||
          productive.has(symbol & ~CANONICAL_NONTERMINAL_FLAG)
        )
      ) {
        productive.add(production.lhs);
        changed = true;
      }
    }
  }
  for (const nonterminal of source.nonterminals) {
    if (!productive.has(nonterminal.id)) {
      throw new Error(
        `Canonical nonterminal ${nonterminal.name} is nonproductive.`,
      );
    }
  }

  const reachable = new Set<number>([augmented.lhs]);
  changed = true;
  while (changed) {
    changed = false;
    for (const production of normalizedProductions) {
      if (!reachable.has(production.lhs)) continue;
      for (const symbol of production.rhs) {
        if ((symbol & CANONICAL_NONTERMINAL_FLAG) === 0) continue;
        const nonterminal = symbol & ~CANONICAL_NONTERMINAL_FLAG;
        if (!reachable.has(nonterminal)) {
          reachable.add(nonterminal);
          changed = true;
        }
      }
    }
  }
  for (const nonterminal of source.nonterminals) {
    if (!reachable.has(nonterminal.id)) {
      throw new Error(
        `Canonical nonterminal ${nonterminal.name} is unreachable.`,
      );
    }
  }

  const nullable = new Set<number>();
  const first = new Map<number, Set<number>>();
  for (const nonterminal of source.nonterminals) {
    first.set(nonterminal.id, new Set());
  }
  changed = true;
  while (changed) {
    changed = false;
    for (const production of normalizedProductions) {
      let allNullable = true;
      for (const symbol of production.rhs) {
        if ((symbol & CANONICAL_NONTERMINAL_FLAG) === 0) {
          const target = first.get(production.lhs)!;
          if (!target.has(symbol)) {
            target.add(symbol);
            changed = true;
          }
          allNullable = false;
          break;
        }
        const referenced = symbol & ~CANONICAL_NONTERMINAL_FLAG;
        const target = first.get(production.lhs)!;
        for (const terminal of first.get(referenced) ?? []) {
          if (!target.has(terminal)) {
            target.add(terminal);
            changed = true;
          }
        }
        if (!nullable.has(referenced)) {
          allNullable = false;
          break;
        }
      }
      if (allNullable && !nullable.has(production.lhs)) {
        nullable.add(production.lhs);
        changed = true;
      }
    }
  }

  const productionsByLhs = new Map<number, CanonicalNormalizedProduction[]>();
  for (const production of normalizedProductions) {
    const rows = productionsByLhs.get(production.lhs) ?? [];
    rows.push(production);
    productionsByLhs.set(production.lhs, rows);
  }
  const productionById = new Map(
    normalizedProductions.map((production) =>
      [production.id, production] as const
    ),
  );
  const firstOfSuffix = (
    production: CanonicalNormalizedProduction,
    offset: number,
    lookahead: number,
  ): ReadonlyArray<number> => {
    const terminals = new Set<number>();
    for (let index = offset; index < production.rhs.length; index += 1) {
      const symbol = production.rhs[index]!;
      if ((symbol & CANONICAL_NONTERMINAL_FLAG) === 0) {
        terminals.add(symbol);
        return [...terminals].sort((left, right) => left - right);
      }
      const referenced = symbol & ~CANONICAL_NONTERMINAL_FLAG;
      for (const terminal of first.get(referenced) ?? []) {
        terminals.add(terminal);
      }
      if (!nullable.has(referenced)) {
        return [...terminals].sort((left, right) => left - right);
      }
    }
    terminals.add(lookahead);
    return [...terminals].sort((left, right) => left - right);
  };
  const closure = (
    seed: ReadonlyArray<CanonicalItem>,
  ): ReadonlyArray<CanonicalItem> => {
    const items = new Map<string, CanonicalItem>();
    const queue: CanonicalItem[] = [];
    const add = (item: CanonicalItem): void => {
      const key = canonicalItemKey(item);
      if (items.has(key)) return;
      items.set(key, item);
      queue.push(item);
    };
    for (const item of seed) add(item);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const item = queue[cursor]!;
      const production = productionById.get(item.production);
      if (production === undefined) {
        throw new Error("Canonical LR item has a missing production.");
      }
      const symbol = production.rhs[item.dot];
      if (
        symbol === undefined ||
        (symbol & CANONICAL_NONTERMINAL_FLAG) === 0
      ) {
        continue;
      }
      const nonterminal = symbol & ~CANONICAL_NONTERMINAL_FLAG;
      const lookaheads = firstOfSuffix(
        production,
        item.dot + 1,
        item.lookahead,
      );
      for (const child of productionsByLhs.get(nonterminal) ?? []) {
        for (const lookahead of lookaheads) {
          add({ production: child.id, dot: 0, lookahead });
        }
      }
    }
    return Object.freeze([...items.values()].sort(compareCanonicalItems));
  };

  const states: ReadonlyArray<CanonicalItem>[] = [
    closure([{ production: augmented.id, dot: 0, lookahead: eof }]),
  ];
  const stateByKey = new Map<string, number>([
    [canonicalItemSetKey(states[0]!), 1],
  ]);
  const transitions = new Map<string, number>();
  for (let stateIndex = 0; stateIndex < states.length; stateIndex += 1) {
    const state = states[stateIndex]!;
    const symbols = new Set<number>();
    for (const item of state) {
      const production = productionById.get(item.production)!;
      const symbol = production.rhs[item.dot];
      if (symbol !== undefined) symbols.add(symbol);
    }
    for (const symbol of [...symbols].sort((left, right) => left - right)) {
      const moved = closure(
        state.flatMap((item) => {
          const production = productionById.get(item.production)!;
          return production.rhs[item.dot] === symbol
            ? [{
              production: item.production,
              dot: item.dot + 1,
              lookahead: item.lookahead,
            }]
            : [];
        }),
      );
      if (moved.length === 0) continue;
      const key = canonicalItemSetKey(moved);
      let nextState = stateByKey.get(key);
      if (nextState === undefined) {
        nextState = states.length + 1;
        states.push(moved);
        stateByKey.set(key, nextState);
      }
      transitions.set(`${stateIndex + 1}/${symbol}`, nextState);
    }
  }

  const actionMap = new Map<string, CanonicalActionCandidate>();
  const resolveAction = (
    state: number,
    terminal: number,
    candidate: CanonicalActionCandidate,
  ): void => {
    const key = `${state}/${terminal}`;
    const existing = actionMap.get(key);
    if (existing === undefined) {
      actionMap.set(key, candidate);
      return;
    }
    if (
      existing.action === candidate.action &&
      existing.value === candidate.value
    ) {
      return;
    }
    const shift = existing.action === CANONICAL_ACTION_SHIFT
      ? existing
      : candidate.action === CANONICAL_ACTION_SHIFT
      ? candidate
      : undefined;
    const reduce = existing.action === CANONICAL_ACTION_REDUCE
      ? existing
      : candidate.action === CANONICAL_ACTION_REDUCE
      ? candidate
      : undefined;
    if (shift === undefined || reduce === undefined) {
      throw new Error(
        `Canonical LR conflict at state ${state}, terminal ${terminal}: ` +
          `${existing.action}/${existing.value} versus ` +
          `${candidate.action}/${candidate.value}.`,
      );
    }
    const terminalPrecedence = precedenceByTerminal.get(terminal);
    const reducedProduction = productionById.get(reduce.value);
    const productionPrecedence = reducedProduction === undefined ||
        reducedProduction.precedenceTerminal === 0
      ? undefined
      : precedenceByTerminal.get(reducedProduction.precedenceTerminal);
    if (
      terminalPrecedence === undefined ||
      productionPrecedence === undefined
    ) {
      throw new Error(
        `Canonical LR unresolved shift/reduce conflict at state ${state}, terminal ${terminal}.`,
      );
    }
    if (terminalPrecedence.precedence > productionPrecedence.precedence) {
      actionMap.set(key, shift);
      return;
    }
    if (terminalPrecedence.precedence < productionPrecedence.precedence) {
      actionMap.set(key, reduce);
      return;
    }
    if (terminalPrecedence.associativity === 1) {
      actionMap.set(key, reduce);
      return;
    }
    if (terminalPrecedence.associativity === 2) {
      actionMap.set(key, shift);
      return;
    }
    throw new Error(
      `Canonical LR nonassociative conflict at state ${state}, terminal ${terminal}.`,
    );
  };
  for (let stateIndex = 0; stateIndex < states.length; stateIndex += 1) {
    const stateId = stateIndex + 1;
    for (const item of states[stateIndex]!) {
      const production = productionById.get(item.production)!;
      const symbol = production.rhs[item.dot];
      if (symbol !== undefined) {
        if ((symbol & CANONICAL_NONTERMINAL_FLAG) === 0) {
          const nextState = transitions.get(`${stateId}/${symbol}`);
          if (nextState === undefined) {
            throw new Error("Canonical LR shift has a missing state.");
          }
          resolveAction(stateId, symbol, {
            action: CANONICAL_ACTION_SHIFT,
            value: nextState,
          });
        }
        continue;
      }
      if (production.id === augmented.id) {
        if (item.lookahead !== eof) {
          throw new Error("Canonical augmented production accepts before EOF.");
        }
        resolveAction(stateId, eof, {
          action: CANONICAL_ACTION_ACCEPT,
          value: 0,
        });
      } else {
        resolveAction(stateId, item.lookahead, {
          action: CANONICAL_ACTION_REDUCE,
          value: production.id,
        });
      }
    }
  }

  const productionRhs: DeclarativeV2CompiledProductionRhsV1[] = [];
  const productionHeaders =
    normalizedProductions.map((production) => {
      const rhsOffset = productionRhs.length;
      for (const symbol of production.rhs) {
        productionRhs.push({
          id: productionRhs.length + 1,
          symbol,
        });
      }
      return {
        id: production.id,
        lhs: production.lhs,
        rhsOffset,
        rhsLength: production.rhs.length,
        precedenceTerminal: production.precedenceTerminal,
        semanticOpcode: production.semanticOpcode,
      };
    });
  const compiledItems: DeclarativeV2CompiledLrItemV1[] = [];
  const compiledStates = states.map((state, stateIndex) => {
    const itemOffset = compiledItems.length;
    const kernel = state.filter((item) =>
      item.dot > 0 || item.production === augmented.id
    );
    for (const item of kernel) {
      compiledItems.push({
        id: compiledItems.length + 1,
        production: item.production,
        dot: item.dot,
        lookahead: item.lookahead,
      });
    }
    return {
      id: stateIndex + 1,
      itemOffset,
      itemCount: kernel.length,
    };
  });
  const actions = [...actionMap.entries()]
    .map(([key, action]) => {
      const [stateText, terminalText] = key.split("/");
      return {
        state: Number(stateText),
        terminal: Number(terminalText),
        action: action.action,
        value: action.value,
      };
    })
    .sort((left, right) =>
      left.state - right.state || left.terminal - right.terminal
    )
    .map((row, index) => ({ id: index + 1, ...row }));
  const gotos = [...transitions.entries()]
    .flatMap(([key, nextState]) => {
      const [stateText, symbolText] = key.split("/");
      const symbol = Number(symbolText);
      return (symbol & CANONICAL_NONTERMINAL_FLAG) === 0
        ? []
        : [{
          state: Number(stateText),
          nonterminal: symbol & ~CANONICAL_NONTERMINAL_FLAG,
          nextState,
        }];
    })
    .sort((left, right) =>
      left.state - right.state || left.nonterminal - right.nonterminal
    )
    .map((row, index) => ({ id: index + 1, ...row }));
  const recovery: DeclarativeV2CompiledLrRecoveryV1[] = [{
    id: 1,
    state: 0,
    terminal: 0,
    diagnostic: CANONICAL_SYNTAX_DIAGNOSTIC_ID,
    consumes: 0,
  }];
  const acceptCount = actions.filter(
    ({ action }) => action === CANONICAL_ACTION_ACCEPT,
  ).length;
  if (acceptCount !== 1) {
    throw new Error("Canonical LR table requires exactly one accept action.");
  }
  if (!actions.some(({ action }) => action === CANONICAL_ACTION_REDUCE)) {
    throw new Error("Canonical LR table requires executable reduce actions.");
  }
  return Object.freeze({
    productionHeaders: Object.freeze(productionHeaders),
    productionRhs: Object.freeze(productionRhs),
    items: Object.freeze(compiledItems),
    states: Object.freeze(compiledStates),
    actions: Object.freeze(actions),
    gotos: Object.freeze(gotos),
    recovery: Object.freeze(recovery),
    unresolvedConflictCount: 0 as const,
  });
}

export function validateDeclarativeV2CompiledCanonicalGrammarV1(
  overrides?: Partial<DeclarativeV2CompiledCanonicalGrammarV1>,
  expectedBaseline?: DeclarativeV2CompiledCanonicalGrammarV1,
): void {
  const expected =
    expectedBaseline ?? compileDeclarativeV2CanonicalGrammarV1();
  const compiled: DeclarativeV2CompiledCanonicalGrammarV1 = {
    productionHeaders:
      overrides?.productionHeaders ?? expected.productionHeaders,
    productionRhs: overrides?.productionRhs ?? expected.productionRhs,
    items: overrides?.items ?? expected.items,
    states: overrides?.states ?? expected.states,
    actions: overrides?.actions ?? expected.actions,
    gotos: overrides?.gotos ?? expected.gotos,
    recovery: overrides?.recovery ?? expected.recovery,
    unresolvedConflictCount:
      overrides?.unresolvedConflictCount ?? expected.unresolvedConflictCount,
  };
  assertContiguousIds(
    "compiled canonical production headers",
    compiled.productionHeaders,
  );
  assertContiguousIds(
    "compiled canonical production RHS",
    compiled.productionRhs,
  );
  assertContiguousIds("compiled canonical LR items", compiled.items);
  assertContiguousIds("compiled canonical LR states", compiled.states);
  assertContiguousIds("compiled canonical LR actions", compiled.actions);
  assertContiguousIds("compiled canonical LR gotos", compiled.gotos);
  assertContiguousIds("compiled canonical LR recovery", compiled.recovery);
  let rhsCursor = 0;
  for (const header of compiled.productionHeaders) {
    if (
      header.rhsOffset !== rhsCursor ||
      header.rhsLength < 0 ||
      header.rhsOffset + header.rhsLength > compiled.productionRhs.length
    ) {
      throw new Error(
        `Compiled canonical production ${header.id} has an incomplete RHS span.`,
      );
    }
    rhsCursor += header.rhsLength;
  }
  if (rhsCursor !== compiled.productionRhs.length) {
    throw new Error("Compiled canonical production RHS has trailing symbols.");
  }
  let itemCursor = 0;
  for (const state of compiled.states) {
    if (
      state.itemOffset !== itemCursor ||
      state.itemCount < 1 ||
      state.itemOffset + state.itemCount > compiled.items.length
    ) {
      throw new Error(
        `Compiled canonical state ${state.id} has an incomplete item span.`,
      );
    }
    itemCursor += state.itemCount;
  }
  if (itemCursor !== compiled.items.length) {
    throw new Error("Compiled canonical states have trailing LR items.");
  }
  assertUniqueTransitionKeys("compiled canonical LR actions", compiled.actions);
  assertUniqueTransitionKeys("compiled canonical LR gotos", compiled.gotos);
  assertUniqueTransitionKeys(
    "compiled canonical LR recovery",
    compiled.recovery,
  );
  const stateIds = new Set(compiled.states.map(({ id }) => id));
  const terminalIds = new Set<number>(
    DECLARATIVE_V2_CANONICAL_TERMINALS_V1.map(({ id }) => id),
  );
  const nonterminalIds = new Set<number>(
    DECLARATIVE_V2_CANONICAL_NONTERMINALS_V1.map(({ id }) => id),
  );
  const productionIds = new Set(
    compiled.productionHeaders.map(({ id }) => id),
  );
  for (const action of compiled.actions) {
    if (
      !stateIds.has(action.state) ||
      !terminalIds.has(action.terminal) ||
      (action.action === CANONICAL_ACTION_SHIFT &&
        !stateIds.has(action.value)) ||
      (action.action === CANONICAL_ACTION_REDUCE &&
        !productionIds.has(action.value)) ||
      (action.action === CANONICAL_ACTION_ACCEPT && action.value !== 0) ||
      (action.action !== CANONICAL_ACTION_SHIFT &&
        action.action !== CANONICAL_ACTION_REDUCE &&
        action.action !== CANONICAL_ACTION_ACCEPT)
    ) {
      throw new Error(`Compiled canonical action ${action.id} is invalid.`);
    }
  }
  for (const row of compiled.gotos) {
    if (
      !stateIds.has(row.state) ||
      !nonterminalIds.has(row.nonterminal) ||
      !stateIds.has(row.nextState)
    ) {
      throw new Error(`Compiled canonical goto ${row.id} is invalid.`);
    }
  }
  for (const row of compiled.recovery) {
    if (
      row.state !== 0 ||
      row.terminal !== 0 ||
      row.diagnostic !== CANONICAL_SYNTAX_DIAGNOSTIC_ID ||
      row.consumes !== 0
    ) {
      throw new Error(`Compiled canonical recovery ${row.id} is invalid.`);
    }
  }
  if (compiled.unresolvedConflictCount !== 0) {
    throw new Error("Compiled canonical grammar retains unresolved conflicts.");
  }
  if (canonicalJson(compiled) !== canonicalJson(expected)) {
    throw new Error(
      "Compiled canonical grammar differs from deterministic LR construction.",
    );
  }
}

export function validateDeclarativeV2CanonicalUtf8V1(
  overrides?: Readonly<{
    readonly byteClasses?: ReadonlyArray<Readonly<{
      readonly id: number;
      readonly name: string;
      readonly first: number;
      readonly last: number;
    }>>;
    readonly states?: ReadonlyArray<Readonly<{
      readonly id: number;
      readonly name: string;
      readonly accepting: number;
    }>>;
    readonly transitions?: ReadonlyArray<Readonly<{
      readonly id: number;
      readonly state: number;
      readonly byteClass: number;
      readonly nextState: number;
    }>>;
  }>,
): void {
  const byteClasses = overrides?.byteClasses ??
    DECLARATIVE_V2_CANONICAL_UTF8_BYTE_CLASSES_V1;
  const states = overrides?.states ?? DECLARATIVE_V2_CANONICAL_UTF8_STATES_V1;
  const transitions = overrides?.transitions ??
    DECLARATIVE_V2_CANONICAL_UTF8_TRANSITIONS_V1;
  assertUniqueNamesAndIds("canonical UTF-8 byte classes", byteClasses);
  assertUniqueNamesAndIds("canonical UTF-8 states", states);
  assertContiguousIds("canonical UTF-8 transitions", transitions);
  const stateIds = new Set(states.map(({ id }) => id));
  const classIds = new Set(byteClasses.map(({ id }) => id));
  const accepting = states.filter(({ accepting: value }) => value === 1);
  if (
    accepting.length !== 1 ||
    accepting[0]?.id !== 1 ||
    states.some(({ accepting: value }) => value !== 0 && value !== 1)
  ) {
    throw new Error("Canonical UTF-8 graph has an invalid accepting state.");
  }
  const classified = new Uint8Array(256);
  const invalidClass = byteClasses.find(({ name }) => name === "invalid");
  if (invalidClass === undefined) {
    throw new Error("Canonical UTF-8 graph is missing the invalid byte class.");
  }
  for (const row of byteClasses) {
    if (
      !Number.isSafeInteger(row.first) ||
      !Number.isSafeInteger(row.last) ||
      row.first < 0 ||
      row.last > 0xff ||
      row.first > row.last
    ) {
      throw new Error(`Canonical UTF-8 byte class ${row.id} is invalid.`);
    }
    if (row.id === invalidClass.id) continue;
    for (let byte = row.first; byte <= row.last; byte += 1) {
      if (classified[byte] !== 0) {
        throw new Error("Canonical UTF-8 byte classes overlap.");
      }
      classified[byte] = row.id;
    }
  }
  for (let byte = 0; byte < classified.length; byte += 1) {
    if (classified[byte] === 0) classified[byte] = invalidClass.id;
  }
  assertUniqueTransitionKeys("canonical UTF-8 transitions", transitions);
  if (transitions.length !== states.length * byteClasses.length) {
    throw new Error("Canonical UTF-8 graph is incomplete.");
  }
  for (const row of transitions) {
    if (
      !stateIds.has(row.state) ||
      !classIds.has(row.byteClass) ||
      !stateIds.has(row.nextState)
    ) {
      throw new Error(
        `Canonical UTF-8 transition ${row.id} has a missing reference.`,
      );
    }
  }
  const transitionByKey = new Map(
    transitions.map((row) =>
      [`${row.state}/${row.byteClass}`, row.nextState] as const
    ),
  );
  const decodeAccepts = (bytes: ReadonlyArray<number>): boolean => {
    let state = 1;
    for (const byte of bytes) {
      const next = transitionByKey.get(`${state}/${classified[byte]}`);
      if (next === undefined) {
        throw new Error("Canonical UTF-8 graph is incomplete.");
      }
      state = next;
    }
    return state === 1;
  };
  const validBoundaryScalars = [
    [0x00],
    [0x7f],
    [0xc2, 0x80],
    [0xdf, 0xbf],
    [0xe0, 0xa0, 0x80],
    [0xed, 0x9f, 0xbf],
    [0xee, 0x80, 0x80],
    [0xef, 0xbf, 0xbf],
    [0xf0, 0x90, 0x80, 0x80],
    [0xf4, 0x8f, 0xbf, 0xbf],
  ];
  const invalidBoundaryScalars = [
    [0x80],
    [0xc0, 0x80],
    [0xc1, 0xbf],
    [0xe0, 0x80, 0x80],
    [0xed, 0xa0, 0x80],
    [0xf0, 0x80, 0x80, 0x80],
    [0xf4, 0x90, 0x80, 0x80],
    [0xf5, 0x80, 0x80, 0x80],
    [0xff],
  ];
  if (
    validBoundaryScalars.some((bytes) => !decodeAccepts(bytes)) ||
    invalidBoundaryScalars.some((bytes) => decodeAccepts(bytes))
  ) {
    throw new Error("Canonical UTF-8 graph admits an invalid scalar path.");
  }
  const reachable = new Set<number>([1]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of transitions) {
      if (reachable.has(row.state) && !reachable.has(row.nextState)) {
        reachable.add(row.nextState);
        changed = true;
      }
    }
  }
  for (const state of states) {
    if (!reachable.has(state.id)) {
      throw new Error(`Canonical UTF-8 state ${state.name} is unreachable.`);
    }
  }
  if (
    canonicalJson({
      byteClasses,
      states,
      transitions,
    }) !== canonicalJson({
      byteClasses: DECLARATIVE_V2_CANONICAL_UTF8_BYTE_CLASSES_V1,
      states: DECLARATIVE_V2_CANONICAL_UTF8_STATES_V1,
      transitions: DECLARATIVE_V2_CANONICAL_UTF8_TRANSITIONS_V1,
    })
  ) {
    throw new Error(
      "Canonical UTF-8 graph differs from the pinned complete state/class graph.",
    );
  }
}

export function validateDeclarativeV2VerifierExecutableRowsV1(
  overrides?: Readonly<{
    readonly parserActions?: ReadonlyArray<Readonly<{
      readonly id: number;
      readonly state: number;
      readonly terminal: number;
      readonly action: number;
      readonly value: number;
    }>>;
    readonly parserGotos?: ReadonlyArray<Readonly<{
      readonly id: number;
      readonly state: number;
      readonly nonterminal: number;
      readonly nextState: number;
    }>>;
    readonly recovery?: ReadonlyArray<Readonly<{
      readonly id: number;
      readonly state: number;
      readonly terminal: number;
      readonly action: number;
      readonly consumes: number;
    }>>;
    readonly parserProductions?: ReadonlyArray<Readonly<{
      readonly id: number;
      readonly lhs: number;
      readonly rhsLength: number;
      readonly semanticOpcode: number;
      readonly rhs: ReadonlyArray<number>;
    }>>;
    readonly utf8Transitions?: ReadonlyArray<Readonly<{
      readonly id: number;
      readonly state: number;
      readonly byteClass: number;
      readonly nextState: number;
      readonly action: number;
    }>>;
    readonly numberTransitions?: ReadonlyArray<Readonly<{
      readonly id: number;
      readonly state: number;
      readonly input: number;
      readonly nextState: number;
      readonly action: number;
    }>>;
    readonly templateTransitions?: ReadonlyArray<Readonly<{
      readonly id: number;
      readonly state: number;
      readonly input: number;
      readonly nextState: number;
      readonly action: number;
    }>>;
  }>,
): void {
  const parserActions = overrides?.parserActions ??
    DECLARATIVE_V2_MODULE_PARSER_ACTIONS_V1;
  const parserGotos = overrides?.parserGotos ??
    DECLARATIVE_V2_MODULE_PARSER_GOTOS_V1;
  const recoveryRows = overrides?.recovery ??
    DECLARATIVE_V2_PARSER_RECOVERY_V1;
  const parserProductions = overrides?.parserProductions ??
    DECLARATIVE_V2_PARSER_PRODUCTIONS_V1;
  const utf8Transitions = overrides?.utf8Transitions ??
    DECLARATIVE_V2_UTF8_TRANSITIONS_V1;
  const numberTransitions = overrides?.numberTransitions ??
    DECLARATIVE_V2_NUMBER_TRANSITIONS_V1;
  const templateTransitions = overrides?.templateTransitions ??
    DECLARATIVE_V2_TEMPLATE_TRANSITIONS_V1;
  assertContiguousIds("parser terminals", DECLARATIVE_V2_PARSER_TERMINALS_V1);
  assertContiguousIds(
    "parser nonterminals",
    DECLARATIVE_V2_PARSER_NONTERMINALS_V1,
  );
  assertContiguousIds(
    "parser productions",
    parserProductions,
  );
  assertContiguousIds("parser recovery", recoveryRows);
  assertContiguousIds("utf8 transitions", utf8Transitions);
  assertContiguousIds("number transitions", numberTransitions);
  assertContiguousIds("template transitions", templateTransitions);
  assertUniqueTransitionKeys(
    "parser actions",
    parserActions,
  );
  assertUniqueTransitionKeys(
    "parser gotos",
    parserGotos,
  );
  assertUniqueTransitionKeys(
    "utf8 transitions",
    utf8Transitions,
  );
  assertUniqueTransitionKeys(
    "number transitions",
    numberTransitions,
  );
  assertUniqueTransitionKeys(
    "template transitions",
    templateTransitions,
  );
  const terminalIds = new Set<number>(
    DECLARATIVE_V2_PARSER_TERMINALS_V1.map(({ id }) => id),
  );
  const parserStateIds = new Set<number>(
    DECLARATIVE_V2_MODULE_PARSER_STATES_V1.map(({ id }) => id),
  );
  const nonterminalIds = new Set<number>(
    DECLARATIVE_V2_PARSER_NONTERMINALS_V1.map(({ id }) => id),
  );
  const semanticIds = new Set<number>(
    DECLARATIVE_V2_SEMANTIC_ACTIONS_V1.map(({ id }) => id),
  );
  const productionIds = new Set<number>(
    parserProductions.map(({ id }) => id),
  );
  for (const production of parserProductions) {
    if (
      !nonterminalIds.has(production.lhs) ||
      !semanticIds.has(production.semanticOpcode) ||
      production.rhsLength !==
        production.rhs.filter((symbol) => symbol !== 0).length
    ) {
      throw new Error(`Parser production ${production.id} has a missing reference.`);
    }
    for (const symbol of production.rhs.slice(0, production.rhsLength)) {
      const isNonterminal =
        (symbol & DECLARATIVE_V2_PARSER_NONTERMINAL_FLAG_V1) !== 0;
      const symbolId = isNonterminal
        ? symbol & ~DECLARATIVE_V2_PARSER_NONTERMINAL_FLAG_V1
        : symbol;
      if (
        isNonterminal
          ? !nonterminalIds.has(symbolId)
          : !terminalIds.has(symbolId)
      ) {
        throw new Error(
          `Parser production ${production.id} has a missing reference.`,
        );
      }
    }
  }
  for (const row of parserActions) {
    if (
      !parserStateIds.has(row.state) ||
      !terminalIds.has(row.terminal) ||
      row.action < 1 ||
      row.action > 3 ||
      (row.action === 1 && !parserStateIds.has(row.value)) ||
      (row.action === 2 && !productionIds.has(row.value)) ||
      (row.action === 3 && row.value !== 0)
    ) {
      throw new Error(`Parser action ${row.id} has a missing reference.`);
    }
  }
  for (const row of parserGotos) {
    if (
      !parserStateIds.has(row.state) ||
      !nonterminalIds.has(row.nonterminal) ||
      !parserStateIds.has(row.nextState)
    ) {
      throw new Error(`Parser goto ${row.id} has a missing reference.`);
    }
  }
  const productive = new Set<number>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const production of parserProductions) {
      const rhsIsProductive = production.rhs
        .slice(0, production.rhsLength)
        .every((symbol) => {
          const isNonterminal =
            (symbol & DECLARATIVE_V2_PARSER_NONTERMINAL_FLAG_V1) !== 0;
          return !isNonterminal ||
            productive.has(
              symbol & ~DECLARATIVE_V2_PARSER_NONTERMINAL_FLAG_V1,
            );
        });
      if (!productive.has(production.lhs) && rhsIsProductive) {
        productive.add(production.lhs);
        changed = true;
      }
    }
  }
  for (const nonterminal of DECLARATIVE_V2_PARSER_NONTERMINALS_V1) {
    if (!productive.has(nonterminal.id)) {
      throw new Error(`Parser nonterminal ${nonterminal.name} is nonproductive.`);
    }
  }
  // Module and function-body parsing are separate generated entry points.
  const reachable = new Set<number>([1, 4]);
  changed = true;
  while (changed) {
    changed = false;
    for (const production of parserProductions) {
      if (!reachable.has(production.lhs)) continue;
      for (const symbol of production.rhs.slice(0, production.rhsLength)) {
        if ((symbol & DECLARATIVE_V2_PARSER_NONTERMINAL_FLAG_V1) === 0) {
          continue;
        }
        const symbolId =
          symbol & ~DECLARATIVE_V2_PARSER_NONTERMINAL_FLAG_V1;
        if (!reachable.has(symbolId)) {
          reachable.add(symbolId);
          changed = true;
        }
      }
    }
  }
  for (const nonterminal of DECLARATIVE_V2_PARSER_NONTERMINALS_V1) {
    if (!reachable.has(nonterminal.id)) {
      throw new Error(`Parser nonterminal ${nonterminal.name} is unreachable.`);
    }
  }
  for (const recovery of recoveryRows) {
    if (
      !parserStateIds.has(recovery.state) ||
      !terminalIds.has(recovery.terminal)
    ) {
      throw new Error(`Parser recovery ${recovery.id} has a missing reference.`);
    }
    if (recovery.action !== 1 || recovery.consumes !== 0) {
      throw new Error(
        `Recovery row ${recovery.id} has a zero-consumption cycle.`,
      );
    }
  }
  const utf8States = new Set([0, 1, 2, 3, 4, 6, 7]);
  for (const row of utf8Transitions) {
    if (
      !utf8States.has(row.state) ||
      !utf8States.has(row.nextState) ||
      row.byteClass < 1 ||
      row.byteClass > 6 ||
      row.action < 1 ||
      row.action > 4
    ) {
      throw new Error(`UTF-8 transition ${row.id} has a missing reference.`);
    }
  }
  for (const row of numberTransitions) {
    if (
      row.state < 0 ||
      row.state > 5 ||
      row.nextState < 0 ||
      row.nextState > 5 ||
      row.input < 1 ||
      row.input > 5 ||
      row.action !== 1
    ) {
      throw new Error(`Number transition ${row.id} has a missing reference.`);
    }
  }
  for (const row of templateTransitions) {
    if (
      row.state < 1 ||
      row.state > 3 ||
      row.nextState < 0 ||
      row.nextState > 3 ||
      row.input < 1 ||
      row.input > 5 ||
      row.action < 1 ||
      row.action > 5
    ) {
      throw new Error(`Template transition ${row.id} has a missing reference.`);
    }
  }
}

function sectionData(contractSha256: string): ReadonlyMap<string, Uint8Array> {
  validateDeclarativeV2VerifierExecutableRowsV1();
  validateDeclarativeV2CanonicalUtf8V1();
  const canonicalGrammar = compileDeclarativeV2CanonicalGrammarV1();
  const regexKeys = DECLARATIVE_V2_REGEX_GOAL_AFTER_V1.map((row) =>
    `${row.token}:${row.goal}`
  );
  const abiNames = [...DECLARATIVE_V2_SAFE_ABI_LOOKUP_V1];
  const diagnosticNames = DECLARATIVE_V2_CORE_DIAGNOSTICS_V1.map((row) =>
    row.code
  );
  return new Map([
    ["byteClasses", byteClassTable()],
    ["keywords", encodeHashedStrings(DECLARATIVE_V2_KEYWORDS_V1)],
    ["punctuators", encodeHashedStrings(DECLARATIVE_V2_PUNCTUATORS_V1)],
    ["regexGoals", encodeHashedStrings(regexKeys)],
    ["utf8Transitions", encodeNumericRows(
      "utf8 transitions",
      DECLARATIVE_V2_UTF8_TRANSITIONS_V1,
      20,
      [
        (row) => row.state,
        (row) => row.byteClass,
        (row) => row.nextState,
        (row) => row.action,
      ],
    )],
    ["numberTransitions", encodeNumericRows(
      "number transitions",
      DECLARATIVE_V2_NUMBER_TRANSITIONS_V1,
      20,
      [
        (row) => row.state,
        (row) => row.input,
        (row) => row.nextState,
        (row) => row.action,
      ],
    )],
    ["asiTransitions", encodeNumericRows(
      "ASI transitions",
      DECLARATIVE_V2_ASI_RULES_V1,
      12,
      [
        (row) => row.context,
        (row) => row.action,
      ],
    )],
    ["templateTransitions", encodeNumericRows(
      "template transitions",
      DECLARATIVE_V2_TEMPLATE_TRANSITIONS_V1,
      20,
      [
        (row) => row.state,
        (row) => row.input,
        (row) => row.nextState,
        (row) => row.action,
      ],
    )],
    ["terminals", encodeHashedStrings(
      DECLARATIVE_V2_PARSER_TERMINALS_V1.map(({ name }) => name),
    )],
    ["nonterminals", encodeHashedStrings(
      DECLARATIVE_V2_PARSER_NONTERMINALS_V1.map(({ name }) => name),
    )],
    ["productions", encodeNumericRows(
      "parser productions",
      DECLARATIVE_V2_PARSER_PRODUCTIONS_V1,
      32,
      [
        (row) => row.lhs,
        (row) => row.rhsLength,
        (row) => row.semanticOpcode,
        (row) => row.rhs[0] ?? 0,
        (row) => row.rhs[1] ?? 0,
        (row) => row.rhs[2] ?? 0,
        (row) => row.rhs[3] ?? 0,
      ],
    )],
    ["precedence", encodeNumericRows(
      "operator precedence",
      DECLARATIVE_V2_OPERATOR_PRECEDENCE_V1,
      16,
      [
        (row) => row.precedence,
        (row) => row.associativity,
        (row) => fnv1a32(row.spelling),
      ],
    )],
    ["parserActions", encodeNumericRows(
      "parser actions",
      DECLARATIVE_V2_MODULE_PARSER_ACTIONS_V1,
      20,
      [
        (row) => row.state,
        (row) => row.terminal,
        (row) => row.action,
        (row) => row.value,
      ],
    )],
    ["parserGotos", encodeNumericRows(
      "parser gotos",
      DECLARATIVE_V2_MODULE_PARSER_GOTOS_V1,
      16,
      [
        (row) => row.state,
        (row) => row.nonterminal,
        (row) => row.nextState,
      ],
    )],
    ["recovery", encodeNumericRows(
      "parser recovery",
      DECLARATIVE_V2_PARSER_RECOVERY_V1,
      20,
      [
        (row) => row.state,
        (row) => row.terminal,
        (row) => row.action,
        (row) => row.consumes,
      ],
    )],
    ["semanticActions", encodeNumericRows(
      "semantic actions",
      DECLARATIVE_V2_SEMANTIC_ACTIONS_V1,
      8,
      [
        (row) => row.opcode,
      ],
    )],
    ["abiLookup", encodeHashedStrings(abiNames)],
    ["diagnosticLookup", encodeHashedStrings(diagnosticNames)],
    ["canonicalContract", UTF8_ENCODER.encode(canonicalJson({
      contract: DECLARATIVE_V2_VERIFIER_EXECUTABLE_CONTRACT_V1,
      contractSha256,
    }))],
    ["canonicalTerminals", encodeRowHashes(
      DECLARATIVE_V2_CANONICAL_TERMINALS_V1,
      12,
    )],
    ["canonicalNonterminals", encodeRowHashes(
      DECLARATIVE_V2_CANONICAL_NONTERMINALS_V1,
      12,
    )],
    ["canonicalProductionHeaders", encodeNumericRows(
      "canonical production headers",
      canonicalGrammar.productionHeaders,
      24,
      [
        (row) => row.lhs,
        (row) => row.rhsOffset,
        (row) => row.rhsLength,
        (row) => row.precedenceTerminal,
        (row) => row.semanticOpcode,
      ],
    )],
    ["canonicalProductionRhs", encodeNumericRows(
      "canonical production RHS",
      canonicalGrammar.productionRhs,
      8,
      [(row) => row.symbol],
    )],
    ["canonicalLrItems", encodeNumericRows(
      "canonical LR items",
      canonicalGrammar.items,
      16,
      [
        (row) => row.production,
        (row) => row.dot,
        (row) => row.lookahead,
      ],
    )],
    ["canonicalLrStates", encodeNumericRows(
      "canonical LR states",
      canonicalGrammar.states,
      16,
      [
        (row) => row.itemOffset,
        (row) => row.itemCount,
        () => 0,
      ],
    )],
    ["canonicalLrActions", encodeNumericRows(
      "canonical LR actions",
      canonicalGrammar.actions,
      20,
      [
        (row) => row.state,
        (row) => row.terminal,
        (row) => row.action,
        (row) => row.value,
      ],
    )],
    ["canonicalLrGotos", encodeNumericRows(
      "canonical LR gotos",
      canonicalGrammar.gotos,
      16,
      [
        (row) => row.state,
        (row) => row.nonterminal,
        (row) => row.nextState,
      ],
    )],
    ["canonicalLrRecovery", encodeNumericRows(
      "canonical LR recovery",
      canonicalGrammar.recovery,
      20,
      [
        (row) => row.state,
        (row) => row.terminal,
        (row) => row.diagnostic,
        (row) => row.consumes,
      ],
    )],
    ["canonicalPrecedence", encodeNumericRows(
      "canonical precedence",
      DECLARATIVE_V2_CANONICAL_PRECEDENCE_V1,
      20,
      [
        (row) =>
          DECLARATIVE_V2_CANONICAL_TERMINALS_V1.find(
            ({ name }) => name === row.terminal,
          )?.id ?? 0,
        (row) => row.precedence,
        (row) => row.associativity,
        (row) => fnv1a32(row.terminal),
      ],
    )],
    ["canonicalSemanticOpcodes", encodeRowHashes(
      DECLARATIVE_V2_CANONICAL_SEMANTIC_OPCODES_V1,
      12,
    )],
    ["canonicalUtf8ByteClasses", encodeNumericRows(
      "canonical UTF-8 byte classes",
      DECLARATIVE_V2_CANONICAL_UTF8_BYTE_CLASSES_V1,
      16,
      [
        (row) => row.first,
        (row) => row.last,
        (row) => fnv1a32(row.name),
      ],
    )],
    ["canonicalUtf8States", encodeNumericRows(
      "canonical UTF-8 states",
      DECLARATIVE_V2_CANONICAL_UTF8_STATES_V1,
      12,
      [
        (row) => row.accepting,
        (row) => fnv1a32(row.name),
      ],
    )],
    ["canonicalUtf8Transitions", encodeNumericRows(
      "canonical UTF-8 transitions",
      DECLARATIVE_V2_CANONICAL_UTF8_TRANSITIONS_V1,
      16,
      [
        (row) => row.state,
        (row) => row.byteClass,
        (row) => row.nextState,
      ],
    )],
  ]);
}

function buildAsset(
  sections: ReadonlyArray<AssetSection>,
  contractSha256: string,
): Uint8Array {
  const tableEnd = DECLARATIVE_V2_VERIFIER_EXECUTABLE_TABLE_HEADER_BYTES_V1 +
    sections.length *
      DECLARATIVE_V2_VERIFIER_EXECUTABLE_TABLE_SECTION_BYTES_V1;
  let cursor = align(
    tableEnd,
    DECLARATIVE_V2_VERIFIER_EXECUTABLE_TABLE_ALIGNMENT_V1,
  );
  const placements = sections.map((section) => {
    const offset = cursor;
    cursor = align(
      cursor + section.bytes.byteLength,
      DECLARATIVE_V2_VERIFIER_EXECUTABLE_TABLE_ALIGNMENT_V1,
    );
    return Object.freeze({ ...section, offset });
  });
  const bytes = new Uint8Array(cursor);
  bytes.set(
    UTF8_ENCODER.encode(DECLARATIVE_V2_VERIFIER_EXECUTABLE_TABLE_MAGIC_V1),
    0,
  );
  writeU32(bytes, 8, DECLARATIVE_V2_VERIFIER_EXECUTABLE_TABLE_VERSION_V1);
  writeU32(
    bytes,
    12,
    DECLARATIVE_V2_VERIFIER_EXECUTABLE_TABLE_HEADER_BYTES_V1,
  );
  writeU32(bytes, 16, placements.length);
  writeU32(
    bytes,
    20,
    DECLARATIVE_V2_VERIFIER_EXECUTABLE_TABLE_SECTION_BYTES_V1,
  );
  writeU32(
    bytes,
    24,
    DECLARATIVE_V2_VERIFIER_EXECUTABLE_TABLE_ALIGNMENT_V1,
  );
  writeU32(bytes, 28, 0);
  bytes.set(
    hexToBytes(GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1.manifestIdentity),
    32,
  );
  bytes.set(hexToBytes(contractSha256), 64);
  bytes.set(
    hexToBytes(GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1.assetSha256),
    96,
  );
  for (let index = 0; index < placements.length; index += 1) {
    const section = placements[index]!;
    const offset =
      DECLARATIVE_V2_VERIFIER_EXECUTABLE_TABLE_HEADER_BYTES_V1 +
      index * DECLARATIVE_V2_VERIFIER_EXECUTABLE_TABLE_SECTION_BYTES_V1;
    writeU32(bytes, offset, section.id);
    writeU32(bytes, offset + 4, section.recordBytes);
    writeU32(bytes, offset + 8, section.offset);
    writeU32(bytes, offset + 12, section.bytes.byteLength);
    writeU32(bytes, offset + 16, section.count);
    writeU32(bytes, offset + 20, 0);
    bytes.set(section.bytes, section.offset);
  }
  return bytes;
}

export async function generateDeclarativeV2VerifierExecutableV1(
  packageRoot: string,
): Promise<GeneratedDeclarativeV2VerifierExecutableV1> {
  const [contractSource, generatorSource] = await Promise.all([
    readFile(resolve(packageRoot, CONTRACT_FILE)),
    readFile(resolve(packageRoot, GENERATOR_FILE)),
  ]);
  const canonicalContract = canonicalJson(
    DECLARATIVE_V2_VERIFIER_EXECUTABLE_CONTRACT_V1,
  );
  const contractSha256 = sha256(canonicalContract);
  const data = sectionData(contractSha256);
  const sections = DECLARATIVE_V2_VERIFIER_EXECUTABLE_SECTIONS_V1.map(
    (definition) => {
      const bytes = data.get(definition.name);
      if (
        bytes === undefined ||
        bytes.byteLength % definition.recordBytes !== 0
      ) {
        throw new Error(
          `Executable section ${definition.name} is not fixed-width.`,
        );
      }
      return Object.freeze({
        id: definition.id,
        recordBytes: definition.recordBytes,
        count: bytes.byteLength / definition.recordBytes,
        bytes,
      });
    },
  );
  const asset = buildAsset(sections, contractSha256);
  const manifestWithoutIdentity = Object.freeze({
    formatVersion: 1 as const,
    generatorVersion: GENERATOR_VERSION,
    assetSha256: sha256(asset),
    assetByteLength: asset.byteLength,
    contractSha256,
    contractSourceSha256: sha256(contractSource),
    generatorSourceSha256: sha256(generatorSource),
    acceptedSpecificationManifestIdentity:
      GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1.manifestIdentity,
    acceptedSpecificationAssetSha256:
      GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1.assetSha256,
    sectionCount: sections.length,
  });
  const manifest = Object.freeze({
    ...manifestWithoutIdentity,
    manifestIdentity: sha256(canonicalJson(manifestWithoutIdentity)),
  });
  const source = [
    "/* Generated by scripts/declarativeV2VerifierExecutableV1.ts. Do not edit. */",
    `const GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_MANIFEST_VALUE_V1 = ${JSON.stringify(manifest, null, 2)} as const;`,
    "export const GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_MANIFEST_V1 = Object.freeze(GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_MANIFEST_VALUE_V1);",
    `export const GENERATED_DECLARATIVE_V2_VERIFIER_EXECUTABLE_ASSET_BASE64_V1 = ${JSON.stringify(Buffer.from(asset).toString("base64"))} as const;`,
    "",
  ].join("\n");
  return Object.freeze({ asset: new Uint8Array(asset), manifest, source });
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== "update" && command !== "check") {
    throw new Error(
      "Usage: declarativeV2VerifierExecutableV1.ts <update|check>",
    );
  }
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const first = await generateDeclarativeV2VerifierExecutableV1(packageRoot);
  const second = await generateDeclarativeV2VerifierExecutableV1(packageRoot);
  if (
    first.source !== second.source ||
    !Buffer.from(first.asset).equals(Buffer.from(second.asset))
  ) {
    throw new Error("Two clean executable-table generations diverged.");
  }
  const generatedPath = resolve(packageRoot, GENERATED_FILE);
  if (command === "update") {
    await writeFile(generatedPath, first.source, "utf8");
    process.stdout.write(
      `updated ${GENERATED_FILE} ${first.manifest.assetSha256} ${first.manifest.assetByteLength}\n`,
    );
    return;
  }
  const existing = await readFile(generatedPath, "utf8");
  if (existing !== first.source) {
    throw new Error("Declarative V2 executable-table asset is stale.");
  }
  process.stdout.write(
    `verified ${GENERATED_FILE} ${first.manifest.assetSha256} ${first.manifest.assetByteLength}\n`,
  );
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
