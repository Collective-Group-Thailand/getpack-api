import { ipAllowed, parseCidrList } from './cidr';

describe('CIDR allow-list', () => {
  const list = parseCidrList('10.0.0.0/8, 203.0.113.7, 2001:db8::/32');

  it.each([
    ['10.1.2.3', true],
    ['::ffff:10.1.2.3', true],
    ['203.0.113.7', true],
    ['203.0.113.8', false],
    ['2001:db8::1', true],
    ['2001:db9::1', false],
    ['192.168.1.1', false],
    [undefined, false],
    ['not-an-ip', false],
  ])('%s → %s', (ip, expected) => {
    expect(ipAllowed(list, ip)).toBe(expected);
  });

  it('treats an empty list as nobody', () => {
    expect(ipAllowed(parseCidrList(''), '127.0.0.1')).toBe(false);
    expect(ipAllowed(parseCidrList(undefined), '127.0.0.1')).toBe(false);
  });

  it.each(['10.0.0.0/33', 'nope', '10.0.0.0/x', '::1/129'])('rejects %s', (value) => {
    expect(() => parseCidrList(value)).toThrow();
  });
});
