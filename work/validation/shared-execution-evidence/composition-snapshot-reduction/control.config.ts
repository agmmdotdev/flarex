import { defineConfig } from 'vitest/config';
import base from '../vitest.config.ts';
export default defineConfig({...base,test:{...base.test,include:['work/validation/shared-execution-evidence/composition-snapshot-reduction/control.test.ts'],testTimeout:600000}});
