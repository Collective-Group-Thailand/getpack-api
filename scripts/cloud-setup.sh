#!/usr/bin/env bash
# Claude Code cloud VM setup for getpack-api (Ubuntu 24.04, root or passwordless sudo). Idempotent: safe to re-run.
#
#   bash scripts/cloud-setup.sh            # Node 24 + pnpm, PostgreSQL 16 + pgvector, Redis, install, migrate, seed
#   SEED_MODE=dev bash scripts/cloud-setup.sh    # dev seed instead of the UAT rehearsal seed (uat | dev | none)
#
# Uses .env.cloud.example (safe values only: INTEGRATIONS_MODE=fake, local Postgres/Redis, no secrets).
# Never points at UAT/production: refuses any DATABASE_URL / REDIS_URL that is not localhost.
#
# PostgreSQL 16 note: the migrations call uuidv7(), built into PostgreSQL 18 only. This script installs an
# equivalent SQL function as pg_catalog.uuidv7() (RFC 9562 v7: 48-bit ms timestamp + random) when the server has
# none, in each database and in template1. Production, CI and docker-compose use PostgreSQL 18 and never see it.
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE="${ENV_FILE:-.env.cloud.example}"
SEED_MODE="${SEED_MODE:-uat}"
NODE_MAJOR="$(grep -oP '"node":\s*">=\s*\K[0-9]+' package.json)"
PNPM_VERSION="$(grep -oP '"packageManager":\s*"pnpm@\K[^"]+' package.json)"
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"

log() { printf '\n==> %s\n' "$*"; }

# --- Node (package.json engines) --------------------------------------------------------------------
current_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$current_major" != "$NODE_MAJOR" ]; then
  if [ ! -x "/opt/node${NODE_MAJOR}/bin/node" ]; then
    log "Installing Node ${NODE_MAJOR}.x (engines) into /opt/node${NODE_MAJOR}"
    base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
    tarball="$(curl -fsSL "$base/SHASUMS256.txt" | awk '/linux-x64\.tar\.xz$/ {print $2}')"
    tmp="$(mktemp -d)"
    curl -fsSL -o "$tmp/$tarball" "$base/$tarball"
    (cd "$tmp" && curl -fsSL "$base/SHASUMS256.txt" | grep " $tarball\$" | sha256sum -c -)
    $SUDO mkdir -p "/opt/node${NODE_MAJOR}"
    $SUDO tar -xJf "$tmp/$tarball" -C "/opt/node${NODE_MAJOR}" --strip-components=1
    rm -rf "$tmp"
  fi
  export PATH="/opt/node${NODE_MAJOR}/bin:$PATH"
  line="export PATH=\"/opt/node${NODE_MAJOR}/bin:\$PATH\""
  echo "$line" | $SUDO tee /etc/profile.d/getpack-node.sh >/dev/null
  grep -qxF "$line" "$HOME/.bashrc" 2>/dev/null || echo "$line" >>"$HOME/.bashrc"
fi
log "Node $(node -v)"

# --- pnpm (packageManager; npm, not corepack) ----------------------------------------------------------
# Installed into the active Node's global prefix, so it never runs on another Node.
if [ -n "$PNPM_VERSION" ] && { [ ! -x "$(npm prefix -g)/bin/pnpm" ] || [ "$("$(npm prefix -g)/bin/pnpm" -v)" != "$PNPM_VERSION" ]; }; then
  log "Installing pnpm@${PNPM_VERSION}"
  npm install -g "pnpm@${PNPM_VERSION}"
fi
log "pnpm $(pnpm -v) ($(command -v pnpm))"

# --- PostgreSQL + pgvector + Redis ------------------------------------------------------------------
if ! command -v psql >/dev/null || ! command -v redis-server >/dev/null \
  || ! ls /usr/share/postgresql/*/extension/vector.control >/dev/null 2>&1; then
  log "Installing PostgreSQL, pgvector and Redis (apt)"
  $SUDO apt-get update -qq
  pg_major="$(apt-cache policy postgresql | awk '/Candidate/ {split($2, v, "+"); print v[1]}')"
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    postgresql "postgresql-${pg_major}-pgvector" redis-server
fi
$SUDO service postgresql start >/dev/null
$SUDO service redis-server start >/dev/null
for _ in $(seq 1 30); do pg_isready -q -h localhost && break; sleep 1; done
redis-cli ping >/dev/null

# --- Environment -------------------------------------------------------------------------------------
set -a
# shellcheck disable=SC1090
. "./$ENV_FILE"
set +a
for url in "$DATABASE_URL" "$SHADOW_DATABASE_URL" "$REDIS_URL"; do
  case "$url" in
    *@localhost:* | *@127.0.0.1:* | redis://localhost:* | redis://127.0.0.1:*) ;;
    *) echo "refusing a non-local data store URL from $ENV_FILE" >&2; exit 1 ;;
  esac
done
[ -f .env ] || cp "$ENV_FILE" .env
[ -n "${FAKE_OBJECT_STORAGE_DIR:-}" ] && mkdir -p "$FAKE_OBJECT_STORAGE_DIR"

# --- Role, databases, extensions (idempotent) ---------------------------------------------------------
db_user="$(node -p "new URL(process.argv[1]).username" "$DATABASE_URL")"
db_pass="$(node -p "decodeURIComponent(new URL(process.argv[1]).password)" "$DATABASE_URL")"
db_name="$(node -p "new URL(process.argv[1]).pathname.slice(1)" "$DATABASE_URL")"
shadow_name="$(node -p "new URL(process.argv[1]).pathname.slice(1)" "$SHADOW_DATABASE_URL")"
psql_su() {
  if [ "$(id -u)" -eq 0 ]; then runuser -u postgres -- psql -v ON_ERROR_STOP=1 -qAt "$@"
  else sudo -u postgres psql -v ON_ERROR_STOP=1 -qAt "$@"; fi
}

log "Role ${db_user}, databases ${db_name} and ${shadow_name}"
psql_su -v u="$db_user" -v p="$db_pass" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN CREATEDB PASSWORD %L', :'u', :'p')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'u') \gexec
SQL
for db in "$db_name" "$shadow_name"; do
  psql_su -v d="$db" -v u="$db_user" <<'SQL'
SELECT format('CREATE DATABASE %I OWNER %I', :'d', :'u')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'d') \gexec
SQL
done

UUIDV7_SQL=$(cat <<'SQL'
DO $do$
BEGIN
  IF to_regprocedure('uuidv7()') IS NULL THEN
    CREATE FUNCTION pg_catalog.uuidv7() RETURNS uuid
    LANGUAGE sql VOLATILE PARALLEL SAFE AS $fn$
      SELECT encode(
        set_bit(set_bit(
          overlay(uuid_send(gen_random_uuid())
                  placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
                  FROM 1 FOR 6),
          52, 1), 53, 1),
        'hex')::uuid
    $fn$;
  END IF;
END
$do$;
SQL
)
for db in template1 "$db_name" "$shadow_name"; do
  psql_su -d "$db" -c "$UUIDV7_SQL"
  [ "$db" = template1 ] || psql_su -d "$db" -c 'CREATE EXTENSION IF NOT EXISTS vector'
done
log "PostgreSQL $(psql_su -c 'SHOW server_version'), pgvector $(psql_su -d "$db_name" -c "SELECT extversion FROM pg_extension WHERE extname = 'vector'")"

# --- Install, migrate, seed --------------------------------------------------------------------------
log "pnpm install"
pnpm install --frozen-lockfile

log "Migrate (${db_name})"
pnpm db:migrate

case "$SEED_MODE" in
  uat) log "Seed (UAT rehearsal data, fake entity)"; pnpm db:seed:uat ;;
  dev) log "Seed (dev)"; pnpm db:seed:dev ;;
  none) ;;
  *) echo "SEED_MODE must be uat, dev or none" >&2; exit 1 ;;
esac

log "Done. Start with: set -a; . ./${ENV_FILE}; set +a; pnpm dev   (worker: pnpm dev:worker)"
