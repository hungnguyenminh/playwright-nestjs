import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { relocateDir } from './relocate.js';

describe('relocateDir', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'relocate-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('moves a profile folder with its nested files into a new parent', async () => {
    const from = join(root, 'old', 'p1');
    await mkdir(join(from, 'Default', 'Network'), { recursive: true });
    await writeFile(join(from, 'Default', 'Network', 'Cookies'), 'cookie-db');
    const to = join(root, 'new', 'deep', 'p1');
    expect(await relocateDir(from, to)).toBe('moved');
    expect(await readFile(join(to, 'Default', 'Network', 'Cookies'), 'utf8')).toBe('cookie-db');
    expect(await relocateDir(from, to)).toBe('missing');
  });

  it('never overwrites an existing target', async () => {
    const from = join(root, 'a');
    const to = join(root, 'b');
    await mkdir(from);
    await mkdir(to);
    await writeFile(join(to, 'keep'), 'x');
    expect(await relocateDir(from, to)).toBe('target-exists');
    expect(await readFile(join(to, 'keep'), 'utf8')).toBe('x');
  });
});
