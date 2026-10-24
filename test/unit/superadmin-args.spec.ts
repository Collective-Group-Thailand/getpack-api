import { generatePassword, MIN_PASSWORD, parseSuperadminArgs } from '../../scripts/superadmin-args';

describe('create-superadmin arguments (first staff account of an environment)', () => {
  const base = ['--email', 'Owner@Getpack.co', '--name', 'Owner'];

  it('takes e-mail (lower-cased), name and --confirm; the password from the environment when set', () => {
    expect(parseSuperadminArgs([...base, '--confirm'])).toEqual({
      email: 'owner@getpack.co',
      name: 'Owner',
      confirm: true,
    });
    expect(parseSuperadminArgs(base, 'x'.repeat(MIN_PASSWORD))).toEqual({
      email: 'owner@getpack.co',
      name: 'Owner',
      confirm: false,
      password: 'x'.repeat(MIN_PASSWORD),
    });
  });

  it('refuses a missing or fake e-mail, a missing name and a short password', () => {
    expect(parseSuperadminArgs(['--name', 'Owner'])).toHaveProperty('error');
    expect(parseSuperadminArgs(['--email', 'admin@example.invalid', '--name', 'A'])).toHaveProperty('error');
    expect(parseSuperadminArgs(['--email', 'owner@getpack.co', '--name', '--confirm'])).toHaveProperty(
      'error',
    );
    expect(parseSuperadminArgs(base, 'short')).toHaveProperty('error');
  });

  it('generates 24-character URL-safe passwords that differ every time', () => {
    const a = generatePassword();
    expect(a).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(generatePassword()).not.toBe(a);
  });
});
