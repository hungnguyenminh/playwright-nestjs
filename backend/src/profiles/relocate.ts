import { access, cp, mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );

export type RelocateResult = 'moved' | 'copied' | 'missing' | 'target-exists';

/**
 * Moves a Chrome user-data folder. Same drive: atomic rename. Another drive
 * (EXDEV): copy, then delete the original; if the delete fails (a leftover
 * Chrome still holds a file) the copy is kept and the old folder stays behind.
 * Never overwrites an existing target.
 */
export async function relocateDir(from: string, to: string): Promise<RelocateResult> {
  if (!(await exists(from))) return 'missing';
  if (await exists(to)) return 'target-exists';
  await mkdir(dirname(to), { recursive: true });
  try {
    await rename(from, to);
    return 'moved';
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
  }
  await cp(from, to, { recursive: true, errorOnExist: true, force: false });
  await rm(from, { recursive: true, force: true }).catch(() => undefined);
  return 'copied';
}
