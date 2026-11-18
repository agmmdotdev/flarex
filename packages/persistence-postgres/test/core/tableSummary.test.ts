import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { encodeDocumentId } from "flarex-protocol/document-id";
import { parseCoreTableSummary, serializeCoreTableSummary } from "../../src/core/tableSummary";
import { CoreTableCounts, CORE_COUNT_MAX } from "../../src/core/tableCounts";
import { initialRegistry } from "../../src/core/registry";
import type { CoreTableDefinition } from "../../src/core/api";
import { captureCoreDocument } from "../../src/core/document";

const tabletId=new Uint8Array(16);
const table:CoreTableDefinition={name:"items",number:10001,tabletId,namespace:null,state:"active",indexes:[]};

describe("source table summary and exact count roots",()=>{
  it("round trips numeric u64 lexemes above JavaScript integer precision",()=>{
    const counts=CoreTableCounts.fromEntries([["00000000000000000000000000000000",{numValues:CORE_COUNT_MAX,totalSize:CORE_COUNT_MAX}]]);
    const bytes=serializeCoreTableSummary(0x7fff_ffff_ffff_ffffn,counts);
    expect(new TextDecoder().decode(bytes)).toContain('"numValues":18446744073709551615');
    const restored=Result.getOrThrow(parseCoreTableSummary(bytes));
    expect(restored.timestamp).toBe(0x7fff_ffff_ffff_ffffn);
    expect(restored.counts.count(tabletId)).toBe(CORE_COUNT_MAX);
    expect(restored.counts.tables.get("00000000000000000000000000000000")?.totalSize).toBe(CORE_COUNT_MAX);
  });
  it("rejects true overflow without rounding a valid high counter into corruption",()=>{
    const source='{"tables":{"00000000000000000000000000000000":{"totalSize":"0","inferredTypeWithOptionalFields":{"numValues":18446744073709551616,"variant":{"kind":"Unknown"}}}},"ts":"0"}';
    expect(Result.isFailure(parseCoreTableSummary(new TextEncoder().encode(source)))).toBe(true);
  });
  it("updates the exact count and bytes from the coalesced first-original/final pair",()=>{
    const document={_id:Result.getOrThrow(encodeDocumentId(10001,new Uint8Array(16))),_creationTime:1,value:"hello"};
    const size=BigInt(Result.getOrThrow(captureCoreDocument(document,true)).semanticSizeBytes);
    const original=CoreTableCounts.fromEntries([]);
    const inserted=Result.getOrThrow(original.apply(Result.getOrThrow(initialRegistry([table])),[{table,id:new Uint8Array(16),original:undefined,originalDocument:null,finalDocument:document}]));
    expect(original.count(tabletId)).toBe(0n);
    expect(inserted.count(tabletId)).toBe(1n);
    expect(inserted.tables.get("00000000000000000000000000000000")?.totalSize).toBe(size);
    const deleted=Result.getOrThrow(inserted.apply(Result.getOrThrow(initialRegistry([table])),[{table,id:new Uint8Array(16),original:undefined,originalDocument:document,finalDocument:null}]));
    expect(deleted.count(tabletId)).toBe(0n);
    expect(deleted.tables.get("00000000000000000000000000000000")?.totalSize).toBe(0n);
    expect(Result.isFailure(original.apply(Result.getOrThrow(initialRegistry([table])),[{table,id:new Uint8Array(16),original:undefined,originalDocument:document,finalDocument:null}]))).toBe(true);
  });
});
