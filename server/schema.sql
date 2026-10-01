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
