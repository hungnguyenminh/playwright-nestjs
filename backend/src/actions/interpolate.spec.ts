import { interpolate, lookup } from './interpolate.js';

describe('interpolate', () => {
  const vars = { q: 'laptop', page: 2, user: { name: 'An' }, items: [1, 2] };

  it('replaces references inside text', () => {
    expect(interpolate('https://x.com/?q={{q}}&p={{ page }}', vars)).toBe(
      'https://x.com/?q=laptop&p=2',
    );
    expect(interpolate('hi {{user.name}} {{missing}}!', vars)).toBe('hi An !');
  });

  it('keeps the raw value when the whole string is a reference', () => {
    expect(interpolate('{{items}}', vars)).toEqual([1, 2]);
    expect(interpolate('{{page}}', vars)).toBe(2);
  });

  it('recurses into objects but leaves nested actions and conditions alone', () => {
    const action = {
      type: 'if',
      label: '{{q}}',
      condition: { var: 'q', equals: '{{q}}' },
      then: [{ type: 'goto', url: '{{q}}' }],
    };
    expect(interpolate(action, vars)).toEqual({
      ...action,
      label: 'laptop',
    });
  });

  it('looks up array indexes in paths', () => {
    expect(lookup(vars, 'items.1')).toBe(2);
    expect(lookup(vars, 'user.age.x')).toBeUndefined();
  });
});
