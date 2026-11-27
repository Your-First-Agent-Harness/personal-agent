import { describe, expect, it } from 'vitest';

import { runD098RcAcceptance } from '../src/demo/d098.ts';

describe('D098 v1.0.0-rc.1', () => {
  it('通过 RC 产品化验收', () => {
    expect(runD098RcAcceptance(process.cwd())).toBe('D098 RC ACCEPTANCE PASS');
  });
});
