import { defineConfig } from 'vitest/config';
import base from '../../../../packages/executor/test/performance/measurement/attribution.vitest.config.ts';
export default defineConfig({...base,plugins:[],test:{...base.test,include:['work/validation/shared-execution-evidence/full-cpu-differential/analysis.test.ts'],testTimeout:120000}});
