import { assertValidActions } from '../actions/action-validator.js';
import { buildSourceJob, checkSource, SOURCE_INFO, SOURCE_TYPES } from './connectors.js';

describe('source connectors', () => {
  it.each(SOURCE_TYPES)('%s builds a valid job', (type) => {
    const target = SOURCE_INFO[type].target === 'link' ? (type === 'facebook' ? 'https://www.facebook.com/groups/abc' : 'https://shop.test/') : 'áo khoác & mũ';
    const job = buildSourceJob({ type, targets: [target, target, ' '], limit: 25 });
    expect(() => assertValidActions(job.actions)).not.toThrow();
    expect(job.inputs).toHaveLength(1);
    expect(JSON.stringify(job.actions)).toContain(`"as":"${type}"`);
  });

  it('website: one task per link × keyword, or per link without keywords', () => {
    const both = buildSourceJob({ type: 'website', targets: ['https://a.test/', 'https://b.test/x'], keywords: ['áo', 'quần', ''] });
    expect(both.inputs.map((i) => i.name)).toEqual(['a.test · áo', 'a.test · quần', 'b.test/x · áo', 'b.test/x · quần']);
    const plain = buildSourceJob({ type: 'website', targets: ['https://a.test/'] });
    expect(plain.inputs).toEqual([{ name: 'a.test', url: 'https://a.test/', keyword: '' }]);
  });

  it('keyword sources URL-encode the keyword; google pages by 10', () => {
    const job = buildSourceJob({ type: 'google', targets: ['a&b c'], limit: 25 });
    expect(job.inputs[0]).toMatchObject({ keyword: 'a&b c', q: 'a%26b%20c' });
    expect(job.vars.pages).toEqual([0, 10, 20]);
  });

  it('facebook asks for the newest posts first', () => {
    const job = buildSourceJob({ type: 'facebook', targets: ['https://www.facebook.com/groups/abc', 'https://www.facebook.com/groups/x?sorting_setting=TOP'] });
    expect(job.inputs.map((i) => i.feedUrl)).toEqual([
      'https://www.facebook.com/groups/abc?sorting_setting=CHRONOLOGICAL',
      'https://www.facebook.com/groups/x?sorting_setting=TOP',
    ]);
  });

  it('reports problems in Vietnamese', () => {
    expect(checkSource({ type: 'youtube', targets: [' '] })).toEqual(['YouTube: nhập ít nhất một từ khoá']);
    expect(checkSource({ type: 'website', targets: ['thegioididong.com'] })[0]).toContain('link không hợp lệ');
    expect(checkSource({ type: 'facebook', targets: ['https://example.com/x'] })).toEqual(['Facebook group: link phải là facebook.com/groups/…']);
    expect(checkSource({ type: 'shopee', targets: ['a'], limit: 0 })[0]).toContain('từ 1 đến 500');
    expect(checkSource({ type: 'tiktok', targets: ['a'] })).toEqual([]);
  });
});
