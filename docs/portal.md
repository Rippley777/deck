# Deck web portal

Deck keeps the existing React/Vite application and SQLite repositories. The dedicated TypeScript API uses PostgreSQL and Better Auth. Browser and desktop clients share the Deck model, schema validation, and three-way merge implementation in `shared/`. Tasks, tags, notes, graph edges, recurrence, templates, settings, and ordering travel in the same versioned Deck document; this avoids a second implementation of Deck’s domain logic.

## Run locally

Use Node 22 or newer, PostgreSQL 14 or newer, and an SMTP service (a local mail catcher works for development).

1. Copy `.env.example` to `.env`.
2. Set `VITE_DECK_PORTAL=true`, `DATABASE_URL`, `APP_URL=http://localhost:1432`, `SMTP_URL`, and `MAIL_FROM`. Generate a random `BETTER_AUTH_SECRET` of at least 32 bytes, for example with `openssl rand -base64 48`.
3. Run `npm install`, then `npm run db:migrate`.
4. Run `npm run api:dev` and `npm run dev` in separate terminals.
5. Visit `/app`, create an account, and follow the verification email.

With `VITE_DECK_PORTAL=false`, the original standalone local application remains available without an account. Existing browser data stays in `deck-local`; authenticated browser databases use `deck-account-<user-id>`. Export from the standalone application, then import the JSON during first sync to bring existing browser cards into an account. Desktop continues using its existing SQLite file.

Google is enabled when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set. Register `${APP_URL}/api/auth/callback/google` as the Google OAuth callback. No secret is included in Vite configuration. Additional providers can be added to Better Auth’s `socialProviders` configuration and the sign-in provider UI.

## Production

Set `NODE_ENV=production` and `APP_URL` to the public HTTPS application origin. Build with `VITE_DECK_PORTAL=true npm run build`, migrate, then run `npm run api:start`. The API serves `dist` and `/app` on the same origin. Put the public marketing site on a separate hostname. Only set `TRUST_PROXY=1` behind one trusted reverse proxy which overwrites forwarded headers; otherwise leave it at zero. TLS terminates at that proxy. Protect PostgreSQL on a private network, use its TLS settings for remote connections, and back up the database.

Better Auth handles password hashing, OAuth state, trusted redirects, email verification, reset tokens, session cookies, and account linking. Production cookies are secure and HttpOnly. The API derives account identity from the session or a hashed desktop credential; supplied user IDs never select data. Queries are parameterized and scoped by account. Deleting an account cascades through all cloud data, history, and desktop credentials. It does not remotely wipe offline devices.

Do not cache `/api/*` at a CDN. The PWA precaches the app shell, fonts, icons, graph code, and SQLite WASM; it never caches authenticated API responses. Offline access is available only after an account has been opened on that device. Signing out clears the offline account pointer but keeps that account’s isolated local database, including pending changes. Browser profile/device access can expose local data, as with the standalone application. Session revocation is enforced when an offline device reconnects.

Run `npm run db:cleanup` daily. Deleted payloads and non-current revision bodies expire after 90 days; compact deletion IDs remain to stop old devices resurrecting deleted cards. Account deletion removes those markers immediately. Recovery data on a device is retained until the user clears that local database.

## Desktop connection

1. Sign in to the web portal. Open Settings → Account → Sessions.
2. Enter a desktop name and create a connection token. A sign-in within the last ten minutes is required.
3. In desktop Deck, open Settings → Account. Enter the HTTPS portal origin and paste the token.
4. Review first sync and choose **Connect & merge safely**.

The Rust transport stores the credential in macOS Keychain, Windows Credential Manager, or Linux Secret Service. Requests are HTTPS-only, route-allowlisted, and never follow redirects. Credentials do not live in SQLite or JavaScript storage. The server stores a SHA-256 hash, expires credentials after 90 days, and exposes revocation in web Sessions. Sign out everywhere also revokes desktop credentials. Desktop disconnect removes its local credential; web revocation invalidates it server-side. A desktop with an existing account binding rejects another account to prevent accidental cross-account uploads.

## Synchronization and recovery

- Local edits persist first. A 700 ms debounce starts uploads; a 10-second poll discovers changes from other devices. Reconnection also starts sync.
- Each local save carries its account binding, last acknowledged version, and server baseline in the same SQLite document. IndexedDB also journals each tab’s pending edits so one tab cannot erase another tab’s offline changes by replacing the shared database bytes.
- PostgreSQL serializes account writes inside a transaction using an advisory lock. The server compares the client’s baseline revision to the current document. Independent fields merge; conflicting values use the incoming value and retain both documents and field alternatives in revision history. Deletions win against concurrent edits, whose content remains recoverable.
- Edits made while a request is in flight are merged back into the response; any conflicting local document is retained in Account → Sync as a downloadable recovery copy.
- Soft deletes store entity IDs, deletion times, and recoverable payloads. Intentional undo can recreate an entity and remove its deletion marker.
- First sync shows local/cloud card counts, an export option, and archive import. It requires an explicit connection action. Empty devices download; existing cards merge. Built-in templates are included.
- Clients older than retained history receive `409`, keep local edits, and show a recovery action to export and review a fresh safe merge. No stale snapshot replaces the cloud wholesale.

This first version uses complete document snapshots, not an incremental event stream. Requests are capped at 12 MB, revision storage grows with edits until cleanup, and foreground polling determines propagation latency. Large workspaces and background mobile delivery should move to a paginated entity/cursor protocol before increasing these limits. The shared merge protocol is the extension point.

## API

Authentication uses Better Auth’s `/api/auth/*` endpoints. Account-owned routes are versioned:

- `GET /api/v1/config`: public provider availability.
- `GET /api/v1/me`: authenticated identity.
- `GET /api/v1/sync`: current version and Deck document.
- `POST /api/v1/sync`: `{ baseVersion, data }`; returns merged data, version, and conflict count.
- `GET /api/v1/history`: latest 100 revisions with conflict metadata.
- `GET /api/v1/history/:version`: downloadable revision and recoverable alternatives.
- `GET /api/v1/export`: complete cloud archive, history, and deletions.
- `GET/POST /api/v1/devices`: inspect connections or mint a credential from a fresh browser session.
- `POST /api/v1/devices/revoke`: `{ id }`, always ownership-scoped.
- `POST /api/v1/devices/revoke-all`: revoke all desktop credentials.

Relationships and tags are embedded in task/Stack documents rather than duplicated in separate API resources. JSON/CSV/Markdown exports remain available from the shared client even offline.

## Verification

`npm test`, `npm run build`, `npm run typecheck:server`, and `cargo check --manifest-path src-tauri/Cargo.toml` cover shared logic and both build targets. Existing browser regression tests use standalone mode.

The live API test uses a disposable database whose URL contains `deck_test`. It starts an SMTP capture service on 11025 and an API on 3002, sends real verification/reset emails, and tests ownership, CSRF, input validation, concurrent sync, tombstones, device revocation, and sign-out:

```sh
# Configure DATABASE_URL for a disposable deck_test DB, and the other server variables.
# APP_URL=http://localhost:1432, SMTP_URL=smtp://127.0.0.1:11025
npm run db:migrate
node --env-file=.env --import tsx tests/integration/portal.ts
```

Google’s live OAuth flow needs deployment credentials. OS credential prompts and full installed desktop-to-server networking need testing on each release platform. These cannot be validated by the headless API tests.

With the local API and Vite portal running, `node --env-file=.env --import tsx tests/integration/browser.ts` uses the test-only Bob fixture created above. It checks desktop and phone sign-in, cross-browser sync, offline/reconnection, multi-tab journal recovery, and horizontal overflow. Screenshots are written to `test-results/portal`. The fixture’s workspace is reset; never point this test at real data.

For the built PWA check, build with `VITE_DECK_PORTAL=true`, serve the API with `APP_URL=http://localhost:3001`, then run `node --env-file=.env --import tsx tests/integration/pwa.ts`. It verifies offline shell reload, an offline task surviving reload, and automatic upload after reconnection.
