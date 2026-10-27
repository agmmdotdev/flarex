import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { Effect } from "effect";
import type { Definition, Document } from "./definition.ts";
import type { Command, Database, Persistence } from "./persistence.ts";
import type { TableDependencies, TextEquality } from "./query.ts";
import { CoreError } from "./errors.ts";
import * as tables from "./schema.ts";
import { textFingerprint } from "./equality-key.ts";

const admittedEquality = (definition: Definition, selection: TextEquality) =>
  definition.equalities.some(index => index.name === selection.index && index.field === selection.field);
const equalityPredicate = (selection: TextEquality) => and(eq(tables.equalityVersions.index, selection.index),
  or(...selection.keys.map(key => and(eq(tables.equalityVersions.hash, textFingerprint(key)),
    sql`${tables.equalityVersions.key} collate "C" = ${key} collate "C"`))));

/** Limit examined fingerprint candidates before visibility/full-text filtering.
 * Identities mode never joins or transfers the potentially large document body.
 * The same builder is exercised by ordinary-role EXPLAIN witnesses. */
export function historicalEqualityQuery(transaction: Database, scope: string, table: string, sequence: number,
  selection: TextEquality, remainingRows: number, remainingBytes: number, projection: "identities" | "documents") {
  const candidates = transaction.select().from(tables.equalityVersions).where(and(
    eq(tables.equalityVersions.scope, scope), eq(tables.equalityVersions.table, table),
    eq(tables.equalityVersions.index, selection.index),
    inArray(tables.equalityVersions.hash, [...new Set(selection.keys.map(textFingerprint))])))
    .orderBy(asc(tables.equalityVersions.hash), asc(tables.equalityVersions.id), asc(tables.equalityVersions.fromSeq))
    .limit(remainingRows + 1).as("equality_candidates");
  const matches = and(lte(candidates.fromSeq, sequence), or(isNull(candidates.untilSeq), gt(candidates.untilSeq, sequence)),
    or(...selection.keys.map(key => sql`${candidates.key} collate "C" = ${key} collate "C"`)));
  const keyBytes = sql<number>`octet_length(${candidates.key})`.mapWith(Number);
  const identity = { id: candidates.id, revision: candidates.fromSeq, matches: sql<boolean>`${matches}`, keyBytes };
  if (projection === "identities") return transaction.select({ ...identity, bytes: sql<number>`0`.mapWith(Number), body: sql<Document | null>`null` })
    .from(candidates).orderBy(asc(candidates.hash), asc(candidates.id), asc(candidates.fromSeq));
  const bytes = sql<number>`case when ${matches} then coalesce(octet_length(${tables.history.body}::text),0) else 0 end`.mapWith(Number);
  const consumed = sql<number>`sum(${bytes} + ${keyBytes}) over(order by ${candidates.hash},${candidates.id},${candidates.fromSeq})`.mapWith(Number);
  return transaction.select({ ...identity, bytes, body: sql<Document | null>`case when ${matches} and ${consumed} <= ${remainingBytes} then ${tables.history.body} else null end` })
    .from(candidates).innerJoin(tables.history, and(eq(tables.history.scope, candidates.scope), eq(tables.history.table, candidates.table),
      eq(tables.history.id, candidates.id), eq(tables.history.commitSeq, candidates.fromSeq)))
    .orderBy(asc(candidates.hash), asc(candidates.id), asc(candidates.fromSeq));
}

/** Framework mutation-query dependency, checked for both direct and mixed
 * profiles under the existing scope clock. Hashes locate; exact text proves. */
export async function checkEqualityDependencies(transaction: Database, scope: string, sequence: number, candidates: readonly TableDependencies[]) {
  const predicates = candidates.flatMap(({ definition, dependencies }) => dependencies.flatMap(dependency => {
    if (dependency.kind !== "equality") return [];
    if (!admittedEquality(definition, dependency.selection)) throw new CoreError({ reason: "invalid" });
    return dependency.selection.keys.length === 0 ? [] : [and(eq(tables.equalityVersions.table, definition.table), equalityPredicate(dependency.selection))];
  }));
  if (predicates.length !== 0 && (await transaction.select({ id: tables.equalityVersions.id }).from(tables.equalityVersions)
    .where(and(eq(tables.equalityVersions.scope, scope), or(...predicates),
      or(gt(tables.equalityVersions.fromSeq, sequence), gt(tables.equalityVersions.untilSeq, sequence)))).limit(1)).length !== 0)
    throw new CoreError({ reason: "conflict" });
}

export function createEqualityStorage(persistence: Persistence) {
  const acquire = async (transaction: Database, scope: string, definition: Definition, sequence: number, selection: TextEquality,
    remainingRows: number, remainingBytes: number, projection: "identities" | "documents") => {
    if (!admittedEquality(definition, selection)) throw new CoreError({ reason: "unsupported" });
    if (remainingRows < 0 || remainingRows > 256 || remainingBytes < 0 || selection.keys.length > 256 ||
      Buffer.byteLength(JSON.stringify(selection)) > 262144) throw new CoreError({ reason: "limit" });
    const rows = selection.keys.length === 0 ? [] : await historicalEqualityQuery(transaction, scope,
      definition.table, sequence, selection, remainingRows, remainingBytes, projection);
    const bytes = rows.reduce((total, { body: _body, ...row }) => total + row.bytes + row.keyBytes + Buffer.byteLength(JSON.stringify(row)), 0);
    if (rows.length > remainingRows || bytes > remainingBytes) throw new CoreError({ reason: "limit" });
    return { rows: rows.filter(row => row.matches), examined: rows.length, bytes };
  };
  const observe = Effect.fn("ExperimentEquality.observe")((command: Command, selection: TextEquality,
    remainingRows: number, remainingBytes: number, projection: "identities" | "documents") => persistence.operation(async transaction => {
    const { stored, admitted } = await persistence.observeCommand(transaction, command);
    // Include every examined key and projected identity, even invisible history
    // and fingerprint collisions. These are bounded work bytes, not wire bytes.
    return acquire(transaction, stored.scope, admitted.definition, stored.snapshot, selection, remainingRows, remainingBytes, projection);
  }));
  return {
    observeEquality: (command: Command, selection: TextEquality, rows: number, bytes: number) => observe(command, selection, rows, bytes, "identities"),
    observeEqualityRows: (command: Command, selection: TextEquality, rows: number, bytes: number) => observe(command, selection, rows, bytes, "documents"),
    readEqualityRows: Effect.fn("ExperimentEquality.read")((scope: string, definition: Definition, selection: TextEquality,
      rows: number, bytes: number) => persistence.operation(async transaction => {
      const authority = await persistence.readAuthority(transaction, scope, [definition]);
      return acquire(transaction, scope, definition, authority.seq, selection, rows, bytes, "documents");
    })),
  };
}
