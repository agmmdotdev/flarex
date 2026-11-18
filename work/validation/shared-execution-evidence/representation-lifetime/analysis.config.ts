import { defineConfig } from 'vitest/config';
import base from '../vitest.config.ts';
export default defineConfig({...base,test:{...base.test,
  include:['work/validation/shared-execution-evidence/representation-lifetime/analysis.test.ts'],testTimeout:60000}});
