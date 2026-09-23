import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

config({ quiet: true });

// Multi-file schema (prisma/schema/*.prisma). Migrations start in B1.2 after the schema-design review gate.
// DATABASE_URL is optional here so `prisma generate` works without a database (install, Docker build);
// migrate commands fail with a clear error when it is missing.
export default defineConfig({
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
