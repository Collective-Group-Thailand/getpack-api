import { defineConfig } from 'prisma/config';

// Prisma config for `migrate deploy` inside the production image (Dockerfile stage `prisma-cli`).
// The runtime image has no devDependencies, so the Prisma CLI lives in /opt/prisma-cli with this
// file beside it (imports resolve from there) and absolute paths into /app. Local work keeps using
// prisma.config.ts.
export default defineConfig({
  schema: '/app/prisma/schema',
  migrations: {
    path: '/app/prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
