import { defineConfig } from 'vitest/config';
import base from './profile.config';

const replace = (source: string, before: string, after: string) => {
  if (source.split(before).length !== 2) throw Error('Operation diagnostic source changed: ' + before);
  return source.replace(before, after);
};
export default defineConfig({ ...base, plugins: [...base.plugins ?? [], {
  name: 'existing-operation-counter-correlation', enforce: 'pre', transform(source, file) {
    const id = file.replaceAll('\\', '/');
    source = source.replaceAll('\r\n', '\n');
    if (id.endsWith('/measurement/rootCounters.ts')) return replace(source,
      'try { return await invoke(); } finally { end(); }',
      'try { return await globalThis.__operationCpu.root(invoke); } finally { end(); }');
    if (id.endsWith('/support/mixedMutationProductFixture.ts')) {
      source = replace(source, 'if (publicationObservation === undefined) return invoke();',
        'if (publicationObservation === undefined) return globalThis.__operationCpu.phase(name, invoke);');
      source = replace(source, 'performance?.diagnostics === undefined ? traced() :',
        'performance?.diagnostics === undefined ? globalThis.__operationCpu.phase(name, traced) :');
      return replace(source, 'performance?.diagnostics === undefined ? traceMixedMutationEffect(performance?.trace, name, operation)',
        'performance?.diagnostics === undefined ? globalThis.__operationCpu.effect(name, traceMixedMutationEffect(performance?.trace, name, operation))');
    }
    if (id.endsWith('/execution/diagnostics/operation.ts')) return replace(source,
      'if (tracing === "sdk") return work;',
      'if (tracing === "sdk") return globalThis.__operationCpu.effect(name, work, true);');
  },
}], test: { ...base.test, setupFiles: ['work/validation/shared-execution-evidence/full-cpu-differential/markers.ts',
  'work/validation/shared-execution-evidence/full-cpu-differential/operation-probe.ts'] } });
