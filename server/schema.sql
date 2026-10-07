CREATE TABLE IF NOT EXISTS deck_workspaces (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 0,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS deck_revisions (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  version integer NOT NULL,
  data jsonb NOT NULL,
  conflicts jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, version)
);
CREATE TABLE IF NOT EXISTS deck_tombstones (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  collection text NOT NULL,
  entity_id text NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  value jsonb,
  PRIMARY KEY (user_id, collection, entity_id)
);
CREATE INDEX IF NOT EXISTS deck_revisions_age ON deck_revisions(created_at);
CREATE TABLE IF NOT EXISTS deck_devices (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '90 days'
);
-- Additive migrations: existing accounts, Decks, revisions and device tokens are retained.
ALTER TABLE deck_devices ADD COLUMN IF NOT EXISTS platform text;
ALTER TABLE deck_devices ADD COLUMN IF NOT EXISTS architecture text;
ALTER TABLE deck_devices ADD COLUMN IF NOT EXISTS app_version text;
ALTER TABLE deck_devices ADD COLUMN IF NOT EXISTS installation_id text;
ALTER TABLE deck_devices ADD COLUMN IF NOT EXISTS last_sync timestamptz;
CREATE INDEX IF NOT EXISTS deck_devices_installation ON deck_devices(user_id, installation_id);
CREATE TABLE IF NOT EXISTS deck_pairings (
  id text PRIMARY KEY,
  secret_hash text NOT NULL,
  metadata text NOT NULL,
  user_id text REFERENCES "user"(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
