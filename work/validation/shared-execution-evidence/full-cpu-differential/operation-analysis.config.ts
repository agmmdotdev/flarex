import { defineConfig } from 'vitest/config';
import base from './analysis.config.ts';
export default defineConfig({...base,test:{...base.test,env:{FLAREX_PROFILE_OPERATION_CORRELATION:'on'},include:['work/validation/shared-execution-evidence/full-cpu-differential/analysis.test.ts','work/validation/shared-execution-evidence/full-cpu-differential/operation-analysis.test.ts']}});
