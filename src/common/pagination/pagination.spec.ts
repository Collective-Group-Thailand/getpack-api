import { DomainException } from '../errors/domain.exception';
import { cursorPaginated, decodeCursor, encodeCursor, paginated, toSkipTake } from './pagination';

describe('pagination', () => {
  it('computes skip/take', () => {
    expect(toSkipTake({ page: 3, perPage: 25 })).toEqual({ skip: 50, take: 25 });
  });

  it('builds a page', () => {
    expect(paginated([1, 2], 12, { page: 1, perPage: 2 })).toEqual({
      data: [1, 2],
      meta: { page: 1, perPage: 2, total: 12 },
    });
  });

  it('builds a cursor page from limit + 1 rows', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const page = cursorPaginated(rows, 2, (r) => ({ id: r.id }));
    expect(page.data).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(decodeCursor(page.meta.nextCursor!)).toEqual({ id: 'b' });
    expect(cursorPaginated(rows.slice(0, 2), 2, (r) => ({ id: r.id })).meta.nextCursor).toBeNull();
  });

  it('round-trips cursors and rejects tampered ones', () => {
    expect(decodeCursor(encodeCursor({ createdAt: '2026-09-23T00:00:00Z', id: 7 }))).toEqual({
      createdAt: '2026-09-23T00:00:00Z',
      id: 7,
    });
    expect(() => decodeCursor('not-a-cursor')).toThrow(DomainException);
    expect(() => decodeCursor(encodeCursor({}).replace(/./, '!'))).toThrow(DomainException);
    expect(() => decodeCursor(Buffer.from('[1]').toString('base64url'))).toThrow(DomainException);
  });
});
