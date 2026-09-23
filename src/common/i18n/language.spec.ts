import { resolveLanguage } from './language';

describe('resolveLanguage', () => {
  it.each([
    [undefined, 'th'],
    ['', 'th'],
    ['en', 'en'],
    ['en-US,en;q=0.9', 'en'],
    ['th-TH', 'th'],
    ['fr-FR, en;q=0.5, th;q=0.8', 'th'],
    ['fr, de', 'th'],
    ['en;q=0, th', 'th'],
    [['en-GB', 'th'], 'en'],
  ])('%p → %s', (header, expected) => {
    expect(resolveLanguage(header)).toBe(expected);
  });
});
