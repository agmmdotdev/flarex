import type { AppRowTransaction } from "../../../src/storage/documents/appRows";
import { Schema } from "effect";

const decodeCapturedUniqueProgress=Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String,Schema.Unknown)));

/** Fault only the mapped result of the genuine selected build statement. Native
 * preparation, SQL, locks, and post-lock clock observations still run normally. */
export function observeUniqueBuildReturnedRows<T extends AppRowTransaction>(
  transaction: T,
  marker: Error,
  observation: {
    selectedReads: number;
    laterRowVisits: number;
    statementsAfterRows: string[];
  },
  faults: Readonly<{ laterCompactFault?: boolean; captureSyntaxFault?: boolean; postLockClockFailure?: Error }> = {},
): T {
  let selectedRowsReturned = false;
  const wrap = (value: unknown): unknown => {
    if (typeof value !== "object" || value === null) return value;
    return new Proxy(value, {
      get(target, property) {
        const member = Reflect.get(target, property, target);
        if (typeof member !== "function") return wrap(member);
        return (...args: ReadonlyArray<unknown>) => {
          const prepared: unknown = Reflect.apply(member, target, args);
          if (property !== "prepareQuery") return prepared;
          const query = args[0];
          if (typeof query !== "object" || query === null || !("sql" in query) || typeof query.sql !== "string")
            return prepared;
          if (selectedRowsReturned) observation.statementsAfterRows.push(query.sql);
          if (selectedRowsReturned && faults.postLockClockFailure !== undefined && query.sql.includes("fx_system_scope_clock") &&
            typeof prepared === "object" && prepared !== null) {
            Object.defineProperty(prepared,"execute",{value:()=>Promise.reject(faults.postLockClockFailure)});
            return prepared;
          }
          if (!query.sql.includes("fx_system_unique_constraint_build") || !query.sql.includes("left join") ||
            typeof prepared !== "object" || prepared === null) return prepared;
          return new Proxy(prepared, {
            get(statement, method) {
              const execute = Reflect.get(statement, method, statement);
              if (method !== "execute" || typeof execute !== "function")
                return typeof execute === "function" ? execute.bind(statement) : execute;
              return async (...bindings: ReadonlyArray<unknown>) => {
                const rows: unknown = await Reflect.apply(execute, statement, bindings);
                if (!Array.isArray(rows) || rows.length !== 3) throw new Error("Expected capture header and two genuine invalid unique build rows");
                observation.selectedReads += 1;
                selectedRowsReturned = true;
                return rows.map((row: unknown, ordinal) => {
                  if (typeof row !== "object" || row === null) throw new Error("Expected native mapped unique build row");
                  if (ordinal===0) {
                    if (faults.captureSyntaxFault) Object.defineProperty(row,"progress",{value:"{"});
                    else if (faults.laterCompactFault) {
                      if (!("progress" in row) || typeof row.progress !== "string") throw new Error("Missing actual unique capture");
                      const capture=decodeCapturedUniqueProgress(row.progress);
                      const later=Object.keys(capture).sort((left,right)=>Number(left)-Number(right))[1];
                      if (later===undefined) throw new Error("Missing later captured unique member");
                      Object.defineProperty(row,"progress",{value:JSON.stringify({...capture,[later]:"malformed"})});
                    }
                    return row;
                  }
                  if (!("rawBuild" in row) || typeof row.rawBuild!=="object" || row.rawBuild===null)
                    throw new Error("Expected complete native invalid unique build row");
                  Object.defineProperty(row.rawBuild, "scopeId", {
                    enumerable: true,
                    get(): never {
                      if (ordinal !== 1) observation.laterRowVisits += 1;
                      throw ordinal === 1 ? marker : new Error("Later unique build row must not be decoded");
                    },
                  });
                  return row;
                });
              };
            },
          });
        };
      },
    });
  };
  return new Proxy(transaction, {
    get(target, property) {
      const member = Reflect.get(target, property, target);
      return property === "_" ? wrap(member) : typeof member === "function" ? member.bind(target) : member;
    },
  });
}
