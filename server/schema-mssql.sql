IF OBJECT_ID(N'dbo.deck_workspaces', N'U') IS NULL
CREATE TABLE dbo.deck_workspaces (
  user_id VARCHAR(36) NOT NULL PRIMARY KEY REFERENCES dbo.[user](id) ON DELETE CASCADE,
  version INT NOT NULL DEFAULT 0,
  data NVARCHAR(MAX) NOT NULL CHECK (ISJSON(data) = 1),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID(N'dbo.deck_revisions', N'U') IS NULL
CREATE TABLE dbo.deck_revisions (
  user_id VARCHAR(36) NOT NULL REFERENCES dbo.[user](id) ON DELETE CASCADE,
  version INT NOT NULL,
  data NVARCHAR(MAX) NOT NULL CHECK (ISJSON(data) = 1),
  conflicts NVARCHAR(MAX) NOT NULL DEFAULT N'[]' CHECK (ISJSON(conflicts) = 1),
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_deck_revisions PRIMARY KEY (user_id, version)
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_deck_revisions_age' AND object_id = OBJECT_ID(N'dbo.deck_revisions'))
CREATE INDEX IX_deck_revisions_age ON dbo.deck_revisions(created_at);

IF OBJECT_ID(N'dbo.deck_tombstones', N'U') IS NULL
CREATE TABLE dbo.deck_tombstones (
  user_id VARCHAR(36) NOT NULL REFERENCES dbo.[user](id) ON DELETE CASCADE,
  collection NVARCHAR(40) NOT NULL,
  entity_id NVARCHAR(255) NOT NULL,
  deleted_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  value NVARCHAR(MAX) NULL CHECK (value IS NULL OR ISJSON(value) = 1),
  CONSTRAINT PK_deck_tombstones PRIMARY KEY (user_id, collection, entity_id)
);

IF OBJECT_ID(N'dbo.deck_devices', N'U') IS NULL
CREATE TABLE dbo.deck_devices (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL REFERENCES dbo.[user](id) ON DELETE CASCADE,
  name NVARCHAR(100) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  last_active_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  expires_at DATETIME2 NOT NULL DEFAULT DATEADD(day, 90, SYSUTCDATETIME())
);

-- Additive migrations preserve all existing Deck and authentication data.
IF COL_LENGTH('dbo.deck_devices', 'platform') IS NULL
ALTER TABLE dbo.deck_devices ADD platform NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.deck_devices', 'architecture') IS NULL
ALTER TABLE dbo.deck_devices ADD architecture NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.deck_devices', 'app_version') IS NULL
ALTER TABLE dbo.deck_devices ADD app_version NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.deck_devices', 'installation_id') IS NULL
ALTER TABLE dbo.deck_devices ADD installation_id VARCHAR(36) NULL;
IF COL_LENGTH('dbo.deck_devices', 'last_sync') IS NULL
ALTER TABLE dbo.deck_devices ADD last_sync DATETIME2 NULL;
IF OBJECT_ID(N'dbo.deck_pairings', N'U') IS NULL
CREATE TABLE dbo.deck_pairings (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  secret_hash CHAR(64) NOT NULL,
  metadata NVARCHAR(MAX) NOT NULL CHECK (ISJSON(metadata)=1),
  user_id VARCHAR(36) NULL REFERENCES dbo.[user](id) ON DELETE CASCADE,
  expires_at DATETIME2 NOT NULL
);

IF OBJECT_ID(N'dbo.deck_github', N'U') IS NULL
CREATE TABLE dbo.deck_github (
  user_id VARCHAR(36) NOT NULL PRIMARY KEY REFERENCES dbo.[user](id) ON DELETE CASCADE,
  version INT NOT NULL,
  data NVARCHAR(MAX) NOT NULL CHECK (ISJSON(data)=1)
);
