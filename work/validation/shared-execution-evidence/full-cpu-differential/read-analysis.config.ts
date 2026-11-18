import { defineConfig } from 'vitest/config';
import base from './analysis.config.ts';
export default defineConfig({...base,test:{...base.test,include:['work/validation/shared-execution-evidence/full-cpu-differential/read-analysis.test.ts'],maxWorkers:1,testTimeout:120000}});
