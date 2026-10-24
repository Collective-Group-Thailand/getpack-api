import { randomBytes } from 'node:crypto';

export interface SuperadminArgs {
  email: string;
  name: string;
  confirm: boolean;
  /** From `SUPERADMIN_PASSWORD`; undefined → generate one. */
  password?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD = 16;

/** Arguments of `scripts/create-superadmin.ts`; an `{ error }` names what is wrong. */
export function parseSuperadminArgs(
  argv: readonly string[],
  envPassword?: string,
): SuperadminArgs | { error: string } {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    const v = i >= 0 ? argv[i + 1] : undefined;
    return v && !v.startsWith('--') ? v.trim() : undefined;
  };
  const email = value('--email')?.toLowerCase();
  const name = value('--name');
  if (!email || !EMAIL.test(email)) return { error: '--email <e-mail> is required' };
  if (/@example\.(invalid|com|org|net)$/.test(email))
    return { error: 'an example.* address is not a real mailbox' };
  if (!name) return { error: '--name "<display name>" is required' };
  const password = envPassword?.length ? envPassword : undefined;
  if (password !== undefined && password.length < MIN_PASSWORD)
    return { error: `SUPERADMIN_PASSWORD must be at least ${MIN_PASSWORD} characters` };
  return { email, name, confirm: argv.includes('--confirm'), ...(password !== undefined && { password }) };
}

/** 24 characters from a URL-safe alphabet (~143 bits). */
export function generatePassword(): string {
  return randomBytes(18).toString('base64url');
}
