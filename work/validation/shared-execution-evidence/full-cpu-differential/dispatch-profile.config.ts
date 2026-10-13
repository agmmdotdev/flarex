import { defineConfig } from 'vitest/config';
import base from './continuation-profile.config.ts';
const replace = (source: string, before: string, after: string) => {
  if (source.split(before).length !== 2) throw Error('Dispatch probe source changed: ' + before);
  return source.replace(before, after);
};
export default defineConfig({ ...base, plugins: [...base.plugins ?? [], {
  name: 'dispatch-observer-composition', enforce: 'pre', transform(source, id) {
    const file = id.replaceAll('\\', '/');
    if (file.endsWith('/continuation-observer.ts')) return replace(source,
      "import { createCyclePartition, type CycleReader, type CycleEvidence } from '../../../../packages/executor/test/performance/measurement/cycleAttribution';",
      "import { type CycleReader, type CycleEvidence } from '../../../../packages/executor/test/performance/measurement/cycleAttribution';\nimport { createDispatchPartition as createCyclePartition } from './dispatch-partition';");
    if (!file.endsWith('/launch-probe.ts')) return;
    source = replace(source, "import { createLaunchObserverWithContinuations as createLaunchObserver } from './continuation-runtime';",
      "import { createLaunchObserverWithDispatch as createLaunchObserver } from './dispatch-runtime';");
    source = replace(source, "const fileNames=['continuation-observer.ts'",
      "const fileNames=['dispatch-runtime.ts','dispatch-partition.ts','dispatch-profile.config.ts','continuation-observer.ts'");
    return replace(source, "mode:process.env.FLAREX_CONTINUATION_MODE??'detailed',",
      "dispatchMode:process.env.FLAREX_DISPATCH_MODE??'nodes',mode:process.env.FLAREX_CONTINUATION_MODE??'detailed',");
  },
} ] });
