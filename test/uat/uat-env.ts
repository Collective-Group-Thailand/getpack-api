import { config } from 'dotenv';

/**
 * Environment of `pnpm uat:populate`: `.env` for the keys, the UAT rehearsal database instead of the dev one, fake
 * integrations (the driver reads OTP codes from the fake SMS sender and settles payments through the fake SCB).
 */
config({ quiet: true });
const url = process.env['UAT_DATABASE_URL'];
if (!url) throw new Error('uat:populate needs UAT_DATABASE_URL (the database seeded by `pnpm db:seed:uat`)');
process.env['DATABASE_URL'] = url;
process.env['INTEGRATIONS_MODE'] = 'fake';
