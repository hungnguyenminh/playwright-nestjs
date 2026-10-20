import { describe, expect, it } from 'vitest';
import type { Action } from '../actions/action.types.js';
import { buildPublishJob, postFingerprint, type PublishInput } from './publishers.js';

const input = (over: Partial<PublishInput> = {}): PublishInput => ({
  platform: 'facebook',
  kind: 'group',
  url: 'https://www.facebook.com/groups/123?locale=vi_VN',
  format: 'text',
  text: 'Xin chào 👋 mọi người!\nBài test #1',
  options: {},
  media: [],
  ...over,
});
/** All actions, nested ones included. */
const flat = (actions: Action[]): Action[] =>
  actions.flatMap((a) => {
    const r = a as unknown as Record<string, unknown>;
    return [a, ...flat([...((r.then as Action[]) ?? []), ...((r.else as Action[]) ?? []), ...((r.actions as Action[]) ?? [])])];
  });

describe('postFingerprint', () => {
  it('keeps letters and digits only, so emoji and punctuation do not matter', () => {
    expect(postFingerprint('Xin chào 👋 mọi người!\nBài test #1')).toBe('xinchàomọingườibàitest1');
  });
  it('is at most 40 characters', () => {
    expect(postFingerprint('a'.repeat(100))).toHaveLength(40);
  });
});

describe('facebook publisher', () => {
  it('reads the post link after posting, falling back to the group "my posts" list', () => {
    const actions = flat(buildPublishJob(input()).actions);
    const find = actions.find((a) => a.type === 'evaluate' && (a as { as?: string }).as === 'postUrl') as { arg: string };
    expect(find.arg).toBe(postFingerprint(input().text));
    expect(actions.some((a) => a.type === 'goto' && (a as { url: string }).url === 'https://www.facebook.com/groups/123/my_posted_content')).toBe(true);
  });
  it('looks for the link only after "submitted"', () => {
    const actions = flat(buildPublishJob(input()).actions);
    const submitted = actions.findIndex((a) => (a as { as?: string }).as === 'submitted');
    const find = actions.findIndex((a) => (a as { as?: string }).as === 'postUrl');
    expect(submitted).toBeGreaterThan(-1);
    expect(find).toBeGreaterThan(submitted);
  });
});
