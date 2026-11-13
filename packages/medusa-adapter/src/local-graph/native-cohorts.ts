import { Option, Result, Schema } from "effect";
import type { RemoteQueryFetchRequest } from "@medusajs/modules-sdk/remote-query";
import { commerceError, isJsonObject, type CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";
import type { ResolvedGraphDirectPath } from "./direct-paths";
import type { GraphReadSelection } from "./model";
import type { ResolvedGraphLinkEndpoint, ResolvedGraphRemotePath } from "./remote-paths";

const decodeKey = commerceDecoder(Schema.String.check(Schema.isBetweenLength(1, 256)), "storedCorruption");
const sameRead = (left: GraphReadSelection, right: GraphReadSelection) => left.participant === right.participant
  && left.read.command === right.read.command && left.read.model === right.read.model;
const parentPath = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf(".")));
const nativePath = (request: RemoteQueryFetchRequest) => request.expand.property === "" ? "_root"
  : `${request.expand.parent}.${request.expand.property}`;

type Edge = { readonly kind: "remote"; readonly path: ResolvedGraphRemotePath }
  | { readonly kind: "direct"; readonly path: ResolvedGraphDirectPath }
  | { readonly kind: "endpoint"; readonly path: ResolvedGraphLinkEndpoint; readonly source: GraphReadSelection };
const sourceRead = (edge: Edge) => edge.kind === "endpoint" ? edge.source : edge.path.source;

interface Location {
  readonly selected: GraphReadSelection;
  readonly publicPath: string;
  readonly nativePath: string;
  readonly serviceName: string;
  readonly nativeEntity: string | undefined;
  readonly groupedParentContexts?: RemoteQueryFetchRequest["groupedParentContexts"];
  readonly rows: readonly JsonObject[];
  readonly localBase?: string;
}
interface Source {
  readonly edge: Edge;
  readonly location: Location;
  readonly nativeParent: string;
  readonly nativeServiceName: string;
  readonly nativeEntity: string | undefined;
  readonly rows: readonly JsonObject[];
  readonly ids: readonly string[];
}
interface Target {
  readonly source: Source;
  readonly nativeParent: string;
  readonly serviceName: string;
  readonly ids: readonly string[];
  readonly links?: readonly JsonObject[];
}

function rowKeys(rows: readonly JsonObject[], column: string, nullable = false) {
  return Result.gen(function* () {
    const keys: string[] = [];
    for (const row of rows) {
      if (nullable && row[column] === null) continue;
      keys.push(yield* decodeKey(row[column]));
    }
    return keys;
  });
}

/** Read only a checked local descendant already returned by its native owner.
 * This counts admission evidence; it never populates or projects a relation. */
function localParents(location: Location, edge: Edge, edges: readonly Edge[]) {
  return Result.gen(function* () {
    const parent = parentPath(edge.path.path), prefix = location.publicPath;
    if (parent !== prefix && !parent.startsWith(prefix === "" ? "" : prefix + ".")) return Option.none<Source>();
    if (edges.some(other => other !== edge && other.path.path !== prefix && other.path.path.length > prefix.length
      && (parent === other.path.path || parent.startsWith(other.path.path + ".")))) return Option.none<Source>();
    const relative = parent === prefix ? "" : parent.slice(prefix === "" ? 0 : prefix.length + 1);
    const local = [location.localBase, relative].filter(part => part !== undefined && part !== "").join(".");
    const source = sourceRead(edge), relation = local === "" ? undefined : location.selected.read.paths.find(path => path.path === local);
    if (source.participant !== location.selected.participant || (local === ""
      ? !sameRead(source, location.selected) : relation?.table.name !== source.read.table.name)) return Option.none<Source>();
    let rows = location.rows;
    let path = "";
    for (const part of local === "" ? [] : local.split(".")) {
      path = path === "" ? part : path + "." + part;
      const declared = location.selected.read.paths.find(candidate => candidate.path === path);
      if (declared === undefined) return yield* Result.fail(commerceError("invalidAuthority"));
      const children: JsonObject[] = [];
      for (const row of rows) {
        const value = row[part];
        if (declared.many) {
          if (!Array.isArray(value) || !value.every(isJsonObject)) return yield* Result.fail(commerceError("storedCorruption"));
          children.push(...value);
        } else if (value !== null && !(value === undefined && declared.optional === true)) {
          if (value === undefined || !isJsonObject(value)) return yield* Result.fail(commerceError("storedCorruption"));
          children.push(value);
        }
      }
      rows = children;
    }
    if (rows.length > edge.path.maximumSources) return yield* Result.fail(commerceError("unsupportedProfile"));
    const ids = [...new Set(yield* rowKeys(rows, edge.path.sourceKey, edge.kind === "direct" && edge.path.nullableSourceKey))];
    if (edge.kind === "endpoint" && ids.length > edge.path.maximumTargets)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const nativeParent = location.nativePath + (local === "" ? "" : "." + local);
    // The native parser can retain the fetch entity or rebind a local alias.
    // Consume its resolved grouping evidence rather than resolving aliases here.
    const context = location.groupedParentContexts?.find(context => context.path === nativeParent);
    return Option.some({ edge, location, nativeParent, rows, ids,
      nativeServiceName: context === undefined ? location.serviceName : context.serviceName,
      nativeEntity: context === undefined ? location.nativeEntity : context.entity });
  });
}

function direction(request: RemoteQueryFetchRequest, sourceKey: string, targetKey: string) {
  const relationship = request.relationship;
  return relationship !== undefined && relationship.serviceName === request.serviceName && request.keyField === targetKey
    && (relationship.inverse === true
      ? relationship.primaryKey === sourceKey && relationship.foreignKey.split(".").at(-1) === targetKey
      : relationship.primaryKey === targetKey && relationship.foreignKey.split(".").at(-1) === sourceKey);
}

function admitIds(request: RemoteQueryFetchRequest, expected: readonly string[]) {
  return Result.gen(function* () {
    if (!Array.isArray(request.ids)) return yield* Result.fail(commerceError("invalidAuthority"));
    const ids: string[] = [];
    for (const id of request.ids) ids.push(yield* decodeKey(id));
    const selected = new Set(ids);
    if (selected.size !== expected.length || expected.some(id => !selected.has(id)))
      return yield* Result.fail(commerceError("invalidAuthority"));
  });
}

function admitTargets(source: Source, rows: readonly JsonObject[], expected: readonly string[], links?: readonly JsonObject[]) {
  return Result.gen(function* () {
    const { edge } = source, path = edge.path;
    if (rows.length > path.maximumTargets) return yield* Result.fail(commerceError("unsupportedProfile"));
    const keys = yield* rowKeys(rows, path.targetKey);
    if (keys.some(key => !expected.includes(key)) || edge.kind !== "direct" && new Set(keys).size !== rows.length)
      return yield* Result.fail(commerceError("storedCorruption"));
    if (edge.kind === "direct") {
      for (const id of source.ids) {
        const count = keys.filter(key => key === id).length;
        if (count > edge.path.maximumPerSource || !edge.path.many && count > 1)
          return yield* Result.fail(commerceError("unsupportedProfile"));
      }
    } else if (edge.kind === "remote" && edge.path.many === false) {
      const returned = new Set(keys);
      for (const id of source.ids) if ((links ?? []).filter(link => {
        const target = link[edge.path.targetColumn];
        return link[edge.path.sourceColumn] === id && typeof target === "string" && returned.has(target);
      }).length > 1)
        return yield* Result.fail(commerceError("storedCorruption"));
    }
  });
}

/** Invocation-local cohort admission over authentic raw native DTOs. All
 * traversal, grouping, ordering and attachment remain in RemoteJoiner. */
export function prepareNativeCohorts(input: Readonly<{
  root: GraphReadSelection;
  fields: readonly string[];
  remote: ReadonlyMap<string, ResolvedGraphRemotePath>;
  direct: ReadonlyMap<string, ResolvedGraphDirectPath>;
  endpoints: ReadonlyMap<string, ResolvedGraphLinkEndpoint>;
}>) {
    const active = (path: string) => input.fields.some(field => field === path || field.startsWith(path + "."));
    const edges: Edge[] = [
      ...[...input.remote.values()].filter(path => active(path.path)).map(path => ({ kind: "remote" as const, path })),
      ...[...input.direct.values()].filter(path => active(path.path)).map(path => ({ kind: "direct" as const, path })),
      ...[...input.endpoints.values()].filter(path => active(path.path)).map(path => ({ kind: "endpoint" as const, path, source: input.root })),
    ];
    const sources: Source[] = [], targets: Target[] = [];
    const register = (location: Location): Result.Result<void, CommerceTransactionError> => Result.gen(function* () {
      for (const edge of edges) {
        const found = yield* localParents(location, edge, edges);
        if (Option.isNone(found)) continue;
        const source = found.value;
        sources.push(source);
        // Same-service native expansions can be returned inside their parent
        // DTO without another fetch. Admit those raw rows at this same owner.
        if (edge.kind === "direct" && edge.path.source.participant === edge.path.target.participant) {
          const name = edge.path.path.split(".").at(-1);
          if (name === undefined || !source.rows.some(row => Object.hasOwn(row, name))) continue;
          const rows: JsonObject[] = [];
          for (const row of source.rows) {
            const value = row[name], children: JsonObject[] = [];
            if (edge.path.many) {
              if (!Array.isArray(value) || !value.every(isJsonObject)) return yield* Result.fail(commerceError("storedCorruption"));
              children.push(...value);
            } else if (value !== undefined && value !== null) {
              if (!isJsonObject(value)) return yield* Result.fail(commerceError("storedCorruption"));
              children.push(value);
            }
            if (children.length > edge.path.maximumPerSource)
              return yield* Result.fail(commerceError("unsupportedProfile"));
            // Native DAL population and its authenticated receipt already own
            // the local parent/child association. Its selected child DTO need
            // not carry the inverse FK used by an independent target fetch.
            // If that key is present, retain its exact parent/value check.
            for (const child of children) if (Object.hasOwn(child, edge.path.targetKey)) {
              const key = yield* decodeKey(child[edge.path.targetKey]);
              if (key !== row[edge.path.sourceKey]) return yield* Result.fail(commerceError("storedCorruption"));
            }
            rows.push(...children);
          }
          if (rows.length > edge.path.maximumTargets)
            return yield* Result.fail(commerceError("unsupportedProfile"));
          yield* register({ selected: edge.path.target, publicPath: edge.path.path,
            nativePath: source.nativeParent + "." + name, serviceName: location.serviceName, nativeEntity: location.nativeEntity,
            groupedParentContexts: location.groupedParentContexts, rows });
        }
      }
    });
    const observe = (request: RemoteQueryFetchRequest, selected: GraphReadSelection, rows: readonly JsonObject[]) => Result.gen(function* () {
      const path = nativePath(request);
      if (path === "_root" && request.relationship === undefined && sameRead(selected, input.root))
        return yield* register({ selected, publicPath: "", nativePath: path, serviceName: request.serviceName,
          nativeEntity: request.expand.serviceConfig.entity, groupedParentContexts: request.groupedParentContexts, rows });
      const matchedSources = sources.filter(source => source.nativeParent === request.expand.parent
        && source.nativeServiceName === request.expand.parentConfig?.serviceName
        && source.nativeEntity === request.expand.parentConfig.entity);
      const linkSources = matchedSources.filter(source => source.edge.kind === "remote" && sameRead(selected, source.edge.path.link)
        && direction(request, source.edge.path.sourceKey, source.edge.path.sourceColumn));
      const directSources = matchedSources.filter(source => source.edge.kind !== "remote" && sameRead(selected, source.edge.path.target)
        && direction(request, source.edge.path.sourceKey, source.edge.path.targetKey));
      const pending = targets.filter(target => target.nativeParent === request.expand.parent && target.serviceName === request.expand.parentConfig?.serviceName
        && sameRead(selected, target.source.edge.path.target) && target.source.edge.kind === "remote"
        && direction(request, target.source.edge.path.targetColumn, target.source.edge.path.targetKey));
      if (linkSources.length === 0 && directSources.length === 0 && pending.length === 0)
        return yield* Result.fail(commerceError("invalidAuthority"));
      yield* admitIds(request, [...new Set([...linkSources, ...directSources].flatMap(source => source.ids).concat(pending.flatMap(target => target.ids)))]);
      for (const source of linkSources) {
        const edge = source.edge;
        if (edge.kind !== "remote") continue;
        if (rows.length > edge.path.maximumLinks) return yield* Result.fail(commerceError("unsupportedProfile"));
        const linked = yield* rowKeys(rows, edge.path.sourceColumn);
        if (linked.some(id => !source.ids.includes(id))) return yield* Result.fail(commerceError("storedCorruption"));
        for (const id of source.ids) if (linked.filter(key => key === id).length > edge.path.maximumPerSource)
          return yield* Result.fail(commerceError("unsupportedProfile"));
        const ids = [...new Set(yield* rowKeys(rows, edge.path.targetColumn))];
        if (ids.length > edge.path.maximumTargets) return yield* Result.fail(commerceError("unsupportedProfile"));
        targets.push({ source, nativeParent: path, serviceName: request.serviceName, ids, links: rows });
      }
      const admitted: Target[] = [...directSources.map(source => ({ source, ids: source.ids, nativeParent: request.expand.parent,
        serviceName: request.expand.parentConfig?.serviceName ?? "" })), ...pending];
      for (const target of admitted) {
        yield* admitTargets(target.source, rows, target.ids, target.links);
        const edge = target.source.edge;
        yield* register({ selected, publicPath: edge.path.path, nativePath: path, serviceName: request.serviceName,
          nativeEntity: request.expand.serviceConfig.entity, groupedParentContexts: request.groupedParentContexts, rows,
          ...(edge.kind === "remote" && edge.path.targetSuffix !== undefined ? { localBase: edge.path.targetSuffix } : {}) });
      }
    });
    return Result.succeed({ observe });
}
