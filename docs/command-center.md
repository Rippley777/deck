# Deck Command Center

Command Center is Deck's initial view. It uses existing Stacks as projects and existing tasks, milestones, deadlines and dependencies. Today, lists, templates, discovery and graph views remain available. Local planning and deterministic health require neither a GitHub account nor an AI key.

See [the implementation audit](command-center-audit.md) for what already existed.

## Connect GitHub

1. Register a **GitHub App**, not an OAuth App. Set the callback to `<APP_URL>/api/v1/command-center/github/callback`. Enable expiring user access tokens. Request only **read** repository permissions for Metadata, Contents, Issues, Pull requests, Actions and Deployments. No organization permissions or write scopes are needed.
2. Install the App on the personal account and each organization you want to include. Grant selected repositories; organization approval and SSO policy still apply. Any GitHub user can connect; there is no hardcoded account.
3. Configure `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` and `GITHUB_TOKEN_ENCRYPTION_KEY` on the server. Generate a random 32-byte base64 key, for example `openssl rand -base64 32`. Keep it stable and back it up separately from the database. Losing/changing it requires users to reconnect.
4. Apply `npm run db:migrate` for PostgreSQL or `npm run db:migrate:sql` for Azure SQL, then restart the API. Existing accounts, projects, tasks and revisions are retained.
5. In the signed-in Deck browser portal, open **Import repositories → Connect GitHub**, authorize the App, then discover repositories. Desktop users authorize through the same web portal and use their existing secure Deck desktop account connection to discover/import/refresh.

The flow binds one-use, ten-minute OAuth state and PKCE to the authenticated Deck session. Access/refresh tokens are encrypted using AES-256-GCM, authenticated to the Deck account, and never returned to browser or desktop clients. The existing origin/CSRF guard and account-switch guard cover mutation routes. Tokens refresh server-side under a durable account lease. Reconnect replaces authorization; disconnect removes server credentials, cache and pending authorization. Project links and deliberately imported metadata remain in the user's Deck. To revoke the App grant on GitHub itself, also remove it under GitHub Settings → Applications.

Reference: [GitHub App user authorization](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app).

## Import and matching

Discovery lists repositories in installations accessible to the connected GitHub user, including granted private and organization repositories. It does not list repositories the App cannot read.

Each repository offers **Create new project**, **Link to existing project**, or **Skip**. Name, URL, saved repository ID, metadata URL and local folder-name matches are suggestions, never automatic merges. A local folder name is only a weak signal; Deck does not send local filesystem paths to the server. A project already linked to a different repository cannot be selected.

GitHub's immutable numeric repository ID is the identity. Newly created projects use a deterministic ID, making retries and concurrent imports merge into one project. Reimport updates metadata rather than duplicating tasks/projects. Sync resolves repositories by ID, so renames and ownership transfers follow GitHub. Existing project names and notes are preserved. If the remote import succeeds but local saving is interrupted, Needs Review shows the repository for relinking.

Links, manual risks, priority preferences and Pit Boss references use optional, validated fields in the existing version-1 workspace document. They persist through SQLite and the existing cloud merge. JSON and CSV exports preserve project command metadata. Duplicating a Stack deliberately drops external identity, so the copy cannot double-count the same repository. External cache data and credentials are held separately in the additive `deck_github` table, keyed by Deck account.

## Synchronization and activity

Initial import queues sync immediately. The API runs a one-minute scheduling tick with two workers, one repository per account per tick, account leases and optimistic revision checks. `GITHUB_SYNC_INTERVAL_MINUTES` defaults to 30, with a minimum of 15. Manual refresh queues eligible repositories. GitHub rate-limit deadlines and exponential backoff remain in force even after manual refresh. API/network retries are bounded; failed snapshots cannot overwrite successful evidence with partial counts.

An Azure F1 host can sleep: scheduled work resumes when the API is awake. This is best-effort synchronization, not an always-on job guarantee. Large imports progress over multiple ticks. The dashboard reads one cached account snapshot every 30 seconds while visible; components never call GitHub independently. The cache endpoint is authenticated and `no-store`; external snapshots are held in UI memory and cleared on account changes, not placed in a shared browser cache.

Sync reads open issues, open PR details, direct requests for the connected user's review, blocked PRs, milestones, workflow runs, deployment statuses, recent commits/issue changes, merged PRs and releases. Commits and issue changes use the last successful timestamp with overlap. Stable event IDs deduplicate repeated synchronization; each repository retains up to 500 recent events. The activity view filters by repository, event type and time range. External work remains separate from Deck tasks, with optional links to tasks in the same project.

Latest workflow runs supersede older runs for the same workflow and branch. Workflow activity uses a 30-day window; the latest default-branch result for every workflow is also checked so quiet repositories retain unresolved failures. GitHub's explicit `production_environment` field identifies production deployments. If a deployment status points to the same workflow run, health counts only the larger urgency signal. Historical completed issues/PRs leave outstanding work on the next successful full open-work refresh. Direct user review requests are supported; team-membership expansion is not requested.

Pagination normally allows 20 pages of 100 records per resource (10 for deployments), and 200 open PR detail requests. Exceeding limits produces an incomplete/error state and retains the previous snapshot. It never silently reports a truncated count as complete. Repository errors carry last attempt, last success and next retry. Denied repository access clears its cached work/activity; revoked user authorization clears cached repository data and asks for reconnection. Previously imported local project metadata is retained.

Optional webhooks: set `GITHUB_WEBHOOK_SECRET` and configure the App webhook URL as `<APP_URL>/api/v1/command-center/github/webhook`. Use GitHub's JSON payload format and subscribe to relevant push, issues, pull request, workflow run, release and deployment status events. Deck validates the SHA-256 signature over raw request bytes, bounds payload size and rate, remembers recent delivery IDs, and invalidates matching caches. It never trusts webhook content as health evidence: workers re-fetch with each user's permissions. Polling recovers deliveries that overlap a running job.

## Health and priority

Priority uses current Deck evidence and fresh GitHub evidence. GitHub data becomes stale after two hours, on errors, or while an incomplete sync is pending. Stale external counts are explicitly labeled; unsynchronized counts show a dash. Stale GitHub evidence does not produce recommendations. Current Deck problems can still require attention while GitHub is stale.

| Evidence                                                   |                    Default points |
| ---------------------------------------------------------- | --------------------------------: |
| Failed production deployment                               |                                40 |
| Explicit critical blocker / high-priority blocked task     |                                35 |
| Failed default-branch CI / other deployment failure        |                                25 |
| Overdue high-priority task                                 |                                20 |
| Deadline within 48 hours / overdue project deadline        |                                15 |
| PR awaiting your review / blocked PR / high-priority issue |                                10 |
| Other overdue task                                         |               Half overdue weight |
| Other blocked task                                         | One-third blocker weight, rounded |
| Failed non-default-branch workflow                         |           Half CI weight, rounded |

Change weights under **Command Center preferences**. Multiple signals for one task, explicitly linked task/external work, or a traceably identical deployment/workflow failure use the maximum weight. Every reason links to its task, resource or project. High-priority GitHub issues require an explicit label: `priority: high`, `priority: critical`, `p0`, `p1`, `critical` or `high priority` (case-insensitive). Labels never execute code.

Critical means an explicit critical blocker, production failure, or score at least 60. Needs Attention means other actionable evidence. Unknown means insufficient/stale repository evidence without known local urgency. Idle means no activity in 30 days (or no recorded activity), without an urgent signal. Otherwise the project is On Track. Inactivity adds no points. Paused/archived projects have no focus score and remain visible; importance (0–100) is a separate user sort preference. Deadlines, open Deck tasks, issues, review requests, workflows, deployments, milestones, blockers and risks have drill-down lists.

## Pit Boss boundary

The inspected Pit Boss version has private native Tauri IPC, **no externally supported API or registered deep-link protocol**. Deck stores an explicit project ID and optional action ID/name references under project settings. References can be changed or unlinked. They are not discovered or verified live, and action buttons remain disabled with the reason shown.

On macOS, Deck Desktop can open the registered Pit Boss application using its fixed bundle ID; this opens the application only. Other desktop platforms direct the user to their application launcher. Remote browsers cannot detect or reach local Pit Boss and cannot execute commands. There is no shell endpoint or copied command runner in Deck. GitHub evidence opens in the system browser from Desktop through an HTTPS/github.com allowlist.

Live action discovery/execution, project matching against Pit Boss data, correlation IDs, idempotent run submission, run status/log links and production confirmation are blocked on a supported Pit Boss contract. They are **not implemented or simulated as successful execution**. A future authenticated, versioned bridge must verify the saved project and action, require explicit confirmation for destructive/production operations, and keep execution/log ownership in Pit Boss. No other application's database is read or written.

## Troubleshooting and validation

- No connection button: sign into Deck; configure the three GitHub App secrets on the API. No `VITE_` token settings exist.
- Missing private/org repository: install the App there, confirm repository selection/read permissions, complete organization approval/SSO, reconnect and discover again.
- Pending status: the host may be asleep or earlier repositories may be processing. Wait for the next scheduling tick. A restarted worker lease expires after 20 minutes.
- Rate-limited: wait for the displayed retry time. Repeated manual refresh cannot bypass it.
- Unknown health: check Needs Review and last successful sync; local task management continues during integration outages.
- Pit Boss execution unavailable: use Pit Boss itself; no execution bridge exists in the inspected version.

Automated fixtures cover GitHub permission scope, authorization state/PKCE, credential encryption, revoked access, pagination, retries, repeated sync, renamed repositories, cleared work, health, links and desktop/mobile dashboard interactions. The browser workflow imports three fixture repositories, creates an overdue task, surfaces a failed workflow, links external work and Pit Boss references, and reimports without duplication. It does **not** authorize a real GitHub account or execute a Pit Boss command. PostgreSQL integration tests exercise real sessions, CSRF/account isolation, secret-free API projection, disconnect and repeatable migrations. Azure SQL schema/type checks are available; a live Azure SQL smoke test and live GitHub/OS launch validation still require configured services.

Commands: `npm test`, `npm run test:e2e`, `npm run test:e2e:portal`, `npm run test:integration`, `npm run typecheck:server`, `npm run build`, `npm run test:native`, and `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`. Prettier checks changed TS/TSX/CSS, Markdown and test files. This repository has no JavaScript lint script/configuration; TypeScript and Rust Clippy are the available static checks.
