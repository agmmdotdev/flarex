import { defineConfig } from 'vitest/config';
import base from './operation-profile.config.ts';
import { transformRead } from './read-transform.mjs';
const replace = (source:string,before:string,after:string) => {
  if (source.split(before).length !== 2) throw Error('Read detail marker changed: ' + before);
  return source.replace(before,after);
};
export default defineConfig({...base,plugins:[...base.plugins ?? [],{
  name:'read-detail',enforce:'pre',transform(source,id) {
    source=source.replaceAll('\r\n','\n');id=id.replaceAll('\\','/');
    if(id.endsWith('/execution/diagnostics/operation.ts')) return replace(source,
      'globalThis.__operationCpu.effect(name, work, true)',
      'globalThis.__operationCpu.effect(name, work, !["LogicalDocuments.compileRelationalRead","LogicalDocuments.withCandidateSelection","LogicalDocuments.consumeAccessMetadata"].includes(name))');
    if(id.endsWith('/execution/finiteStorageCapture.ts')) {
      source=replace(source,'const result = profile.kind === "installed" ? yield*',
        'const result = yield* globalThis.__operationCpu.effect("ReadDetail.command", Effect.gen(function* () { return profile.kind === "installed" ? yield*');
      source=replace(source,'cause => refused("resourceFailure", cause));\n      const accepted',
        'cause => refused("resourceFailure", cause)); }));\n      const accepted');
      source=replace(source,'const accepted = yield* Effect.gen(function* () {',
        'const accepted = yield* globalThis.__operationCpu.effect("ReadDetail.header", Effect.gen(function* () {');
      source=replace(source,'return { kind: "accepted" as const, first, observedEpoch };\n      });',
        'return { kind: "accepted" as const, first, observedEpoch };\n      }));');
    }
    return transformRead(source,id) ?? source;
  },
}],test:{...base.test,setupFiles:[...base.test?.setupFiles ?? [],'work/validation/shared-execution-evidence/full-cpu-differential/read-probe.ts']}});
