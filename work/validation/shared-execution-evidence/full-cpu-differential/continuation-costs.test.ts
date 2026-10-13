import { it } from 'vitest';
import { reduceContinuationCampaigns } from './continuation-evidence';
it('conserves continuation campaigns and their original contracts', () => reduceContinuationCampaigns('continuation'));
