-- U5.B6 (schema-design A-112; D-303): scorecard journey facts and their weekly comparison (schema `analytics`, outside
-- the Prisma models like the rest of the star model, schema-design §3.9).

-- Consented sessions that reached each step of a journey on a Bangkok day (nightly rollup `fact_journey_steps`).
CREATE TABLE analytics.fact_journey_steps (
    "date_key" DATE NOT NULL,
    "journey" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "step_index" SMALLINT NOT NULL,
    "sessions" INTEGER NOT NULL,
    CONSTRAINT "pk_fact_journey_steps" PRIMARY KEY ("date_key", "journey", "step"),
    CONSTRAINT "fk_fact_journey_steps__date_key" FOREIGN KEY ("date_key") REFERENCES analytics.dim_date ("date_key"),
    CONSTRAINT "ck_fact_journey_steps__keys" CHECK (journey ~ '^[a-z][a-z0-9_]{0,39}$' AND step ~ '^[a-z][a-z0-9_]{0,39}$'),
    CONSTRAINT "ck_fact_journey_steps__counts" CHECK (step_index >= 0 AND sessions >= 0)
);

-- Every Monday: the last 7 Bangkok days (Monday–Sunday) against the 7 before, per journey.
CREATE TABLE analytics.journey_week_checks (
    "week_start" DATE NOT NULL,
    "journey" TEXT NOT NULL,
    "first_sessions" INTEGER NOT NULL,
    "last_sessions" INTEGER NOT NULL,
    "previous_first_sessions" INTEGER NOT NULL,
    "previous_last_sessions" INTEGER NOT NULL,
    "conversion_pct" NUMERIC(7, 2),
    "previous_conversion_pct" NUMERIC(7, 2),
    "drop_pct" NUMERIC(7, 2),
    "alert" BOOLEAN NOT NULL,
    "threshold_pct" NUMERIC(7, 2) NOT NULL,
    "min_sessions" INTEGER NOT NULL,
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pk_journey_week_checks" PRIMARY KEY ("week_start", "journey"),
    CONSTRAINT "ck_journey_week_checks__monday" CHECK (extract(isodow FROM week_start) = 1)
);
