import { validateActions } from './action-validator.js';

describe('validateActions', () => {
  it('accepts a nested script', () => {
    expect(
      validateActions([
        { type: 'goto', url: 'https://example.com' },
        { type: 'click', selector: 'a', optional: true },
        {
          type: 'forEach',
          selector: '.item',
          actions: [
            { type: 'extract', selector: ':scope', fields: { t: 'h2' } },
            { type: 'if', condition: { exists: '.x' }, then: [{ type: 'break' }] },
          ],
        },
        { type: 'repeat', times: '{{n}}', actions: [{ type: 'sleep', ms: 10 }] },
      ]),
    ).toEqual([]);
  });

  it('rejects unknown types, missing fields and typos', () => {
    expect(validateActions([{ type: 'fly' }])).not.toEqual([]);
    expect(validateActions([{ type: 'goto' }])[0]).toMatch(/url/);
    expect(
      validateActions([{ type: 'click', selecter: 'a', selector: 'a' }])[0],
    ).toMatch(/selecter/);
    expect(
      validateActions([
        { type: 'if', condition: { exists: 'a' }, then: [{ type: 'goto' }] },
      ])[0],
    ).toMatch(/^\/0\/then\/0/);
  });

  it('requires an array', () => {
    expect(validateActions({ type: 'goto' })).not.toEqual([]);
  });
});
