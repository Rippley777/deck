# Deck accounts and local-first sync

Deck opens empty and works without an account on desktop, web, and the installed PWA. The UI always reads the local SQLite workspace. Browser SQLite snapshots are persisted to IndexedDB; desktop SQLite uses transactional writes and rotating backups. Account and server outages never block opening the local app.

The existing React/Vite client, Rust transport, Better Auth service, and PostgreSQL/Azure SQL backend remain in place. Deck owns its data; no other application’s database or integration contract changes.

## Configure and run

Use Node 22+, PostgreSQL, and SMTP or Azure Communication Services Email for Deck-managed accounts. Copy `.env.example`, set `VITE_DECK_PORTAL=true`, `DATABASE_URL`, `APP_URL`, `BETTER_AUTH_SECRET`, email transport, and `MAIL_FROM`. Run `npm run db:migrate`, `npm run api:dev`, and `npm run dev`. `/app` starts locally; Account settings offer email sign-in, registration, verification, forgot password, and reset.

Google is available when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are configured. Register `${APP_URL}/api/auth/callback/google`. Google works with either database provider. Server secrets must never have the `VITE_` prefix.

Azure SQL uses `DATABASE_PROVIDER=mssql`, the `AZURE_SQL_*` settings, `npm run db:migrate:sql`, and `npm run api:start:sql`. Existing Entra External ID accounts remain available with the `ENTRA_*` configuration. SMTP/ACS plus `MAIL_FROM` additionally enable Deck-managed email/password on Azure SQL. See [Azure deployment](azure-free.md).

For production, set `NODE_ENV=production`, use an HTTPS `APP_URL`, build with `VITE_DECK_PORTAL=true npm run build`, run the appropriate database migration, then start the API. The API and app share an origin. Set `TRUST_PROXY=1` only behind one trusted proxy. Cookie sessions are secure and HttpOnly in production; identity comes from the verified session or a hashed desktop credential, never a request-supplied account ID. Better Auth manages password hashing, verification/reset tokens, OAuth state, and trusted redirects.

`VITE_DECK_PORTAL=false` builds the standalone browser app with all local features. Optional `VITE_DECK_CLOUD_URL` prefills the HTTPS portal address in desktop Account settings. Desktop does not require a network or running server to use local features.

## Desktop sign-in

Open Settings → Account, enter the configured HTTPS portal address, and choose **Sign in or create an account**. Deck opens the browser’s email/Google/Entra account flow. Approve the named device there, then return to Deck to review sync. A random 256-bit proof protects the ten-minute pairing request; the browser URL contains only its random ID. Credential exchange is one-use. The credential is stored in the OS vault, and its SHA-256 hash is stored on the server. Requests are HTTPS-only, route-allowlisted, and never follow redirects. Desktop tokens expire after 90 days and can be revoked in web Account → Sessions.

Manual desktop tokens remain available under web Account → Sessions and desktop **Connect with a desktop token**. Neither credentials nor pairing proofs are placed in SQLite, cloud workspace documents, or persistent JavaScript storage.

Device registration records installation ID, name, platform, architecture, app version, last activity, and last sync. Web Account → Sessions and desktop Account settings display devices.

## First sync and profiles

- **Local content, empty cloud:** show task/Stack/template counts and require **Sync This Deck**. Keep Local Only persists the choice without repeated prompts.
- **Empty local, cloud content:** offer **Restore and Sync** with the cloud timestamp. Download into the existing local repository after confirmation.
- **Both contain content:** offer **Merge Decks**, **Use Cloud Deck**, or **Keep This Device’s Deck**. Replacement requires confirmation, a local backup, and a cloud revision check. A changed cloud revision requires another review.
- **Both empty:** establish sync and show a single subtle confirmation.

Each local workspace persists its Deck ID, stable account ID, consent, baseline, version, and recovery alternatives. Sign-out defaults to keeping the Deck and stopping sync. Explicit removal clears only the active profile’s local document and backups; cloud data and other local profiles survive. Removing unsynced changes requires confirmation.

A retained Account A Deck cannot sync to Account B. The user can keep it local, open B’s separate profile, or create a separate local profile. Browser profiles use separate IndexedDB databases; native profiles use separate SQLite files and backup directories. Profile switching clears selections and Undo state and ignores old network responses. Existing browser account databases reopen in place during upgrade. Existing saved content is never cleared or reseeded.

## Sync and recovery

Local saves precede uploads. The persisted workspace and last acknowledged baseline form the durable pending-change queue: changes remain across restarts and outages without a separate volatile HTTP queue. A 700 ms debounce uploads edits, a ten-second foreground poll discovers remote changes, and connectivity events trigger retries. Sidebar states are Local only, Synced, Syncing, Offline, Changes pending, and Sync issue.

Both backends serialize account writes in transactions. Ordinary writes use three-way merges against retained revisions. Stable entity IDs preserve unique tasks, Stacks, goals, and templates; embedded headings, tags, links, dependencies, checklist items, notes, recurrence, scheduling, and settings travel with them. Concurrent membership edits combine; checklist/items merge by ID. Field conflicts preserve alternatives in cloud revisions and local downloadable recovery. Deletions win against concurrent edits, with those edits retained for recovery. Compact deletion markers stop stale devices resurrecting deleted entities.

The response schema validates complete collections, settings, versions, and unique IDs before the local repository changes. Errors, expired credentials, malformed/incomplete responses, and older cloud revisions preserve local content and surface a recoverable status. Edits made while a request is in flight merge into the response. Generation checks discard responses belonging to a signed-out account or previous profile. The optional `X-Deck-Account` request guard rejects a stale client if its cookie or desktop credential now belongs to a different account; it never selects the account dataset. The cloud projection strips local identity and discovered repository paths.

Backups remain independent of cloud sync. Run `npm run db:cleanup` or `npm run db:cleanup:sql` periodically; non-current revision bodies and deletion payloads expire after 90 days, while compact deletion IDs remain. Expired sync baselines return `409` and require an explicit export/review workflow.

This protocol uses complete versioned documents, with a 12 MB request cap and foreground polling. Large datasets or background mobile delivery will need an incremental cursor protocol. Future native mobile clients can use the same account-owned API.

## API and migrations

Existing `/api/auth/*` endpoints and account-scoped `/api/v1/me`, `/sync`, `/history`, `/export`, and `/devices` remain. New routes are:

- `POST /api/v1/sync`: optional `mode: "replace"` requires the exact current `baseVersion`; stale replacement returns `409`. Ordinary clients retain existing merge behavior.
- `POST /api/v1/devices/register`: validated installation and platform metadata; account identity is server-derived.
- `POST /api/v1/devices/pair/start`: native pairing proof and device metadata.
- `GET /api/v1/devices/pair/:id`: pending device description.
- `POST /api/v1/devices/pair/approve`: approval by a fresh browser session.
- `POST /api/v1/devices/pair/poll`: proof-protected one-use credential exchange.

SQL migrations add device metadata columns and a pairing table. They preserve all workspace, revision, deletion, and authentication records. Deploy migrations/API before the new clients so the new routes and replacement revision guard are available.

## Verification

```sh
npm test
npm run test:e2e
npm run test:e2e:portal
npm run test:integration
npm run typecheck:server
npm run build
npm run test:native
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

The integration test requires local `initdb` and `postgres` binaries. It creates a disposable database and SMTP capture service in a temporary directory, exercises real email verification/reset, secure sessions, account isolation, concurrent writes, tombstones, pairing, revocation, and repeated migrations, then removes its fixtures. It never uses production configuration. Browser account tests mock the network while exercising the actual session, storage, and UI flow.

Live Google/Entra provider callbacks and OS-vault/browser handoff on each release platform require configured provider credentials and installed-app testing. The local integration run validates PostgreSQL; Azure SQL deployment still needs its own smoke test.
