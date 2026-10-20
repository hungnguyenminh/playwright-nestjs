import { checkWritten, systemPrompt, textBudget, userMessage, type WrittenPost } from './post-writer.js';

const post = (content: string, idx = [0]): WrittenPost => ({ title: 't', content, hashtags: ['a'], source_indexes: idx });

describe('AI post writer checks', () => {
  it('needs one post per row, plain text, valid row indexes', () => {
    const o = { platforms: ['facebook' as const], mode: 'perRecord' as const };
    expect(checkWritten([post('Ổn')], 1, o)).toEqual([]);
    expect(checkWritten([post('**Đậm** quá')], 1, o)).toEqual(['Bài 1: có markdown (**, __, #), hãy viết văn bản thuần.']);
    expect(checkWritten([post('a'), post('b', [5])], 1, o)).toEqual(['Cần đúng 1 bài, nhận được 2.', 'Bài 2: source_indexes không hợp lệ.']);
  });

  it('digest mode groups rows; the strictest platform sets the length', () => {
    const o = { platforms: ['facebook' as const, 'threads' as const], mode: 'digest' as const, digestSize: 5 };
    expect(textBudget(o.platforms)).toBe(500);
    expect(systemPrompt(o)).toContain('dưới 500 ký tự');
    expect(systemPrompt(o)).toContain('mỗi bài gộp 5 dòng');
    expect(checkWritten([post('x'.repeat(600), [0, 1])], 7, o)).toEqual([
      'Cần đúng 2 bài, nhận được 1.',
      'Bài 1 (Threads): Nội dung dài 604 ký tự, tối đa 500',
    ]);
  });

  it('sends the rows (long values cut) and the user request', () => {
    const msg = userMessage([{ title: 'Vợt', text: 'x'.repeat(2000), empty: '' }], { platforms: ['facebook'], mode: 'perRecord', prompt: 'Giọng vui' });
    expect(msg).toContain('<row index="0">');
    expect(msg).toContain('title: Vợt');
    expect(msg).not.toContain('empty:');
    expect(msg).toContain('…');
    expect(msg).toContain('<request>\nGiọng vui\n</request>');
    expect(msg).toContain('Viết 1 bài.');
  });
});
