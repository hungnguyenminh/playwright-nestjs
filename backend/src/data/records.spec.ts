import { columnsOf, toCsv, toRecords, VALUES_DATASET } from './records.js';

describe('toRecords', () => {
  it('turns arrays into rows keyed by url/id, objects into one row, scalars into "kết quả"', () => {
    const rows = toRecords(
      {
        posts: [
          { author: 'A', url: 'https://fb.com/p/1', text: 'x' },
          { author: 'B', url: 'https://fb.com/p/2', text: 'y' },
          { title: 'no key' },
        ],
        tags: ['love', 'life', ''],
        page: { h1: 'Shop', id: 7 },
        collected: 2,
        title: 'Trang chủ',
      },
      { name: 'Nhóm A', vars: { url: 'https://fb.com/g/1' } },
    );
    const by = (d: string) => rows.filter((r) => r.dataset === d);
    expect(by('posts').map((r) => r.key)).toEqual(['url:https://fb.com/p/1', 'url:https://fb.com/p/2', expect.stringMatching(/^h:/)]);
    expect(by('tags').map((r) => r.data)).toEqual([{ value: 'love' }, { value: 'life' }]);
    expect(by('page')[0]).toMatchObject({ key: 'id:7', data: { h1: 'Shop', id: 7 } });
    expect(by(VALUES_DATASET)[0].data).toEqual({ task: 'Nhóm A', collected: 2, title: 'Trang chủ' });
  });

  it('gives the same input the same key for scalar results', () => {
    const a = toRecords({ title: 'x' }, { vars: { url: 'u' } })[0].key;
    const b = toRecords({ title: 'y' }, { vars: { url: 'u' } })[0].key;
    const c = toRecords({ title: 'x' }, { vars: { url: 'v' } })[0].key;
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('ignores empty results', () => {
    expect(toRecords({}, {})).toEqual([]);
    expect(toRecords(null, {})).toEqual([]);
  });
});

describe('toCsv', () => {
  it('writes a BOM, quotes special characters and serializes nested values', () => {
    const rows = [{ name: 'Bài "hay", mới', tags: ['a', 'b'] }, { name: 'Dòng\n2', extra: 1 }];
    const csv = toCsv(columnsOf(rows), rows);
    expect(csv.startsWith('\uFEFFname,tags,extra\r\n')).toBe(true);
    expect(csv).toContain('"Bài ""hay"", mới","[""a"",""b""]",');
    expect(csv).toContain('"Dòng\n2",,1');
  });
});
