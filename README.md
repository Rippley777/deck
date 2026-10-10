# Deck

**Put what matters on deck.**

A local-first desktop task manager built with Tauri 2, Rust, React 19, TypeScript, Vite, Tailwind CSS, and SQLite. Warm charcoal and muted lavender, a quiet Today view, and an interactive graph of the same workspace.

## Run

Requires Node 22+ and npm. The desktop build also requires the Tauri prerequisites for your operating system. Rust 1.90 is pinned in `rust-toolchain.toml`.

```sh
npm install
npm run dev            # Browser: http://localhost:1432
npm run desktop        # Native desktop; reuses an existing Deck dev server
```

```sh
npm run build          # Typecheck and build the offline-capable web app
npm run preview        # Serve the production web build
npm run release        # Archive previous installers, then build for this OS
npm run desktop:build  # Alias for npm run release
```

The desktop app needs no web server or network after installation. The browser version caches its assets after the first successful production load, including SQLite WASM, graph workers, and fonts. Development mode requires Vite.

## Install on another Mac

Build separate Apple Silicon and Intel installers on macOS:

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run release
```

Installers are collected in `releases/current/macos/arm64/` and `releases/current/macos/x64/`. For a universal installer containing both architectures, use `npm run desktop:build:mac`; its output is `releases/current/macos/universal/Deck-0.1.0-macos-universal.dmg`. A target is successful only when its expected bundles were generated and verified. Copy the appropriate DMG to the other Mac, open it, drag Deck into Applications, eject the disk image, and launch Deck from Applications. The destination Mac needs no Node, Rust, or development server.

Every desktop release first copies existing distributables into `build-history/v<version>_YYYY-MM-DD_HH-mm-ss/` and verifies the copies. An archive failure stops the build. History is never automatically deleted. The same release command builds MSI/NSIS installers on Windows x64 and AppImage/DEB/RPM packages on Linux x64. GitHub Actions builds on four native runners, triggered manually or by a matching `v<version>` tag. See [Desktop releases](docs/releases.md) for prerequisites, manifests, checksums, failure behavior, signing, and CI downloads.

This personal build is not Developer ID signed or notarized. If macOS blocks the first launch because the developer cannot be verified, try opening Deck once, then choose **System Settings → Privacy & Security → Open Anyway**. See [Apple's instructions](https://support.apple.com/102445).

Your existing data is not included in the installer. To transfer it, export JSON from **Settings → Data** on the original computer, then import that file on the other Mac. Each Mac stores its own workspace. Optionally sign in under **Settings → Account** to sync through your Deck cloud service. See [account and sync setup](docs/portal.md).

## First launch and accounts

A new Deck opens to an empty Command Center: no tasks, Stacks, tags, headings, or templates. Capture a task immediately; accounts are optional. Tasks, templates, Graph View, Project Discovery, settings, exports, and rotating backups work locally.

The sidebar’s **Local only** footer opens **Settings → Account**. Sign in when you want cloud backup and access from other devices. Deck asks before uploading an existing local Deck, offers to restore an existing cloud Deck, and presents merge or explicit replacement choices when both contain data. Signing out defaults to keeping the local Deck. Different accounts use separate local profiles; retained content cannot be silently uploaded to another account.

## Command Center

Deck opens with ranked project attention, traceable health reasons, outstanding-work drill-downs, and recent GitHub activity. Import selected repositories through a read-only GitHub App, link them to existing Stacks, and keep external issues separate from Deck tasks. Project lifecycle, importance and scoring preferences persist with your workspace. Today and every existing task view remain available.

[Command Center setup and limits](docs/command-center.md) covers GitHub authorization, synchronization, security, migrations and Pit Boss references. Pit Boss execution requires a supported external contract that the inspected Pit Boss version does not expose; Deck does not execute its commands. See the [pre-implementation audit](docs/command-center-audit.md).

## Everyday use

- Inbox, Today, On Deck, Anytime, Someday, and the chronological Logbook.
- Editable cards with Markdown notes, checklists, separate work dates and deadlines, time, stack, section, tags, priority, effort, recurrence, and a parent card.
- Drag cards between sections, onto other cards, into sidebar destinations or stacks, and onto dates in the week strip. Drag sidebar stacks to reorder them.
- Check the selection boxes beside cards (or Shift/Cmd/Ctrl-click) for bulk scheduling, completion, stack changes, and deletion. Bulk deletion includes Undo.
- Right-click a heading inside a stack to delete it and keep its cards in the stack’s Cards section. Undo restores the heading and its card assignments.
- Completion includes Undo. Recurring completion creates one next occurrence, with a fresh checklist; Undo also removes that occurrence.
- Deal Your Day intentionally pulls cards into Today. Shuffle ranks actionable cards by priority, overdue deadlines, effort, age, and current stack; blocked cards are excluded.
- Stack settings include notes, a deadline, headings, and related stacks. New and existing stacks and templates can use 429 searchable Lucide icons with color swatches or a custom hex color; older symbol icons keep rendering. Goals and their stacks can be managed under Settings → Advanced.

Quick Add recognizes dates and times, `#StackName`, and `@tags` (an unknown `#name` also becomes a tag):

```text
Finish README tomorrow #Oddware @writing
Call mechanic Friday at 3pm
Water plants every Sunday
```

Dates accept natural language such as “next Monday”, “in 3 days”, or “Oct 14”. Repeats support daily, weekdays, named weekdays, monthly, and custom intervals such as “every 3 days”, “every 2 weeks”, or “every 2 months”. They advance from the later of the scheduled date and completion day; missed occurrences are not backfilled.

### Keyboard

| Action                               | Shortcut                           |
| ------------------------------------ | ---------------------------------- |
| Quick Add                            | Cmd/Ctrl N, or N outside an editor |
| New from template                    | Cmd/Ctrl Shift N                   |
| Search and commands                  | Cmd/Ctrl K, or /                   |
| Complete open card                   | Cmd/Ctrl Enter                     |
| Navigate the seven main destinations | Alt 1–7                            |
| Navigate/open/complete list cards    | Arrow keys / Enter / Space         |
| Schedule open card today             | T outside an editor                |
| Focus the stack selector             | M outside an editor                |
| Settings                             | Cmd/Ctrl ,                         |
| All shortcuts                        | ?                                  |

Search includes titles, notes, stack names, tags, and completed cards. Filters can be combined:

```text
project:Oddware tag:development
completed:true
before:Friday overdue:true
```

## Templates

Open **Templates** in the sidebar to manage the library, or **New from template** with Cmd/Ctrl Shift N or the command palette. New Card and New Stack both offer **Start from template**. Right-click a card or sidebar stack (or press Shift F10 while focused) for template actions. Card details can insert a checklist; cards and stacks can also be saved as templates.

The library starts empty. **Add starter templates** explicitly installs ten built-ins covering Software Project, New Feature, Bug Fix, App Launch, App Deployment, Website Launch, Open Source Release, Home Project, Trip Planning, and Deploy Checklist. The picker supports fuzzy search, favors recent use, then favorites, then your library order.

Choose **Customize** on any template card, or **Customize template** from its preview, to edit built-in or custom templates. Change the name, description, icon, color, defaults, notes, headings, variables, and starter items. **Save changes** updates the saved template; **Save as copy** creates a separate version. Editing from a preview returns you there with your entered values and selections preserved, and Cancel discards your edits. Changes apply to future uses; cards already created keep their content.

Every application opens a preview. Select All, Clear All, and individual checkboxes control what is generated. Variables such as `{{project_name}}` are substituted in titles, notes, tags, and headings. Required variables and variables referenced by checked items must have values. Choice variables can control simple “include when this value equals that value” conditions; hidden items are never generated.

- Stack templates create a new stack with headings, independent cards, and optional milestone cards.
- Task templates create a parent card with child cards, checklist items, or both. A task template can also contain only the parent’s notes, tags, effort, and priority.
- Applying a template to an existing stack creates a top-level heading using the generated title, with all generated cards beneath it. Repeated applications get separate numbered headings. Parent cards, checklists, and dependencies are preserved; templates used to create a new stack keep their original section headings.
- Checklist templates append checked items to the existing card, or create a new card when used from the global picker.
- Dependencies connect generated cards using fresh IDs and appear in Graph View. Dependencies on skipped items are omitted. A checklist’s parent must be selected; a child card whose parent is skipped becomes a top-level card (or belongs to the generated root task).
- Milestones remain ordinary editable, completable cards, identified by a badge in lists and a diamond in Graph View.

The visual builder supports task/checklist/milestone types, headings, default selections, drag reordering and keyboard reorder buttons, variables, conditions, parent relationships, dependencies, notes, tags, priority, effort, and a default stack. Cycles and missing references are rejected before saving. Library controls edit, duplicate, delete (with Undo), reorder, favorite, export, and import templates. Standalone exports use a versioned `deck-templates` JSON envelope; importing creates new library entries. Full workspace JSON exports and SQLite backups also include templates, favorites, and recent use. Existing saved templates remain intact; missing or intentionally empty libraries stay empty.

Applying a template makes one workspace commit. Later template edits never change generated cards, and all generated content remains freely editable.

## Deck Ring progress

The same SVG primitive appears in Today, stack headers, 16px sidebar glyphs, section headings, and the Graph insights overlay. The [visual study](design/progress-study.html) compares the segmented ring with layered arcs, a card fan, and a stack meter. The ring was selected for its clear silhouette at sidebar sizes; production arcs are hollow cards that fill as tasks are completed.

- **1–12 cards:** one stable, separately keyed arc per task.
- **13–40 cards:** 12 proportional groups, preserving fractional completion within each group.
- **More than 40 cards:** 24 percentage segments, or 12 at tiny sizes. SVG complexity stays bounded.
- Empty decks use a quiet dashed outline and “No tasks yet”, never 100% or a loading animation.
- In the enhanced variant, blocked work gets a notch, overdue work an outer accent, and Someday work a dim dashed outline. Tooltips always include the textual breakdown. Blocked and overdue are overlapping subsets of remaining cards, not additional tasks.
- Stack and section totals include completed and deferred cards. Today uses its full daily scope. Search, priority filters, hiding completed cards, and collapsing sections do not change the denominator. Graph’s summary is explicitly workspace-wide.
- Clicking a header ring toggles incomplete/all cards. Sidebar rings open their stack; section rings share the collapse control. Hover and keyboard focus show the tooltip; Escape dismisses it.
- Completion transitions take 200ms. Only completing the final card briefly joins the ring (420ms total, then the gaps return). Opening a completed stack or deleting the last incomplete card does not play this effect. Both reduced-motion preferences and Deck’s animation setting are respected.

The primitive is independent of the application store:

```tsx
import { DeckProgress } from './components/progress/DeckProgress';
import { taskProgress } from './lib/progress';

<DeckProgress total={8} completed={3} size={16} />
<DeckProgress
  items={taskProgress(stackTasks, allTasks)}
  label="Oddware"
  size={48}
  showLabel="percentage"
  variant="enhanced"
/>
```

`items` overrides count props and preserves exact task identity. Other props include `deferred`, `blocked`, `overdue`, `interactive`, `onClick`, `actionLabel`, `pressed`, `tooltip`, `animate`, and `className`. `showLabel` supports a fraction or percentage and never renders center text below 36px. `DeckProgressTooltip` can wrap an existing button to avoid nested interactive controls. Progress is exposed through numeric ARIA values and a text description; no color-only interpretation is required.

## Graph

Cytoscape renders a projection of cards, stacks, tags, stack headings, goals, parent cards, related links, and dependencies. It does not maintain a second graph database.

- Force layout uses fCoSE in a Web Worker; larger networks use its faster spectral layout. Hierarchy, radial, and timeline layouts are also available.
- Pan, zoom, drag nodes, search, click cards to open the regular editor, double-click stacks, and use node context menus.
- Focus highlights 1–3 hops or all connected nodes. Local Graph restricts the projection to that neighborhood; clear focus to return to the global graph.
- Filter by stack, tag, status, priority, completed, overdue, orphans, and date range. Small labels hide at distant zoom levels.
- `[[` in notes suggests cards, stacks, and goals. Explicit links and backlinks appear in the card editor. Dependencies reject loops and render directional arrows.
- Graph position is retained during navigation within the session; layout preference persists between launches.

## Storage and safety

`src/lib/repository.ts` defines the asynchronous persistence contract.

- **Desktop:** Rust `rusqlite`, bundled SQLite, WAL journaling, `synchronous=FULL`, transactional writes, versioned SQL migrations, and a mutex around the connection. The database is in the platform app-data directory for `app.deck.desktop`; its exact location appears in Settings → Advanced.
- **Browser:** the same versioned workspace format in a real SQLite database using SQL.js, with binary snapshots committed to IndexedDB transactions. Browser and native workspaces are independent local copies. Optional account sync or JSON export/import transfers between them.
- Up to 14 rotating database backups, daily or weekly on writes. Manual backup and restore are in Settings. Restore keeps a before-restore snapshot.
- Data uses a versioned workspace document inside SQLite. Stable IDs, durable baselines, three-way merges, server revision history, and deletion markers support optional background sync. Device-specific profile identity and discovered repository paths remain local. Cloud failures leave local data available. See [the portal architecture](docs/portal.md).
- Browser storage can be removed by clearing site data; export important work. Local backups are on the same device and are not an off-device backup.

## Import and export

Export JSON, CSV, or Markdown under Settings → Data. Desktop export uses a native save dialog; browser export downloads a file.

JSON and CSV exports include every stack and card, including empty stacks, completed cards, and unstacked cards, regardless of the current view or filters. JSON also includes goals, templates, headings, and settings. CSV uses a `recordType` column (`stack` or `card`), preserves stack details and card relationships, and stores array fields (tags, headings, checklists, links, and dependencies) as JSON arrays inside quoted cells. Stack rows use `name`; card rows use `title`, `stackId`, and a readable `stack` name.

Import a Deck JSON or CSV export, an array of card objects, or a legacy CSV with a `title` column and semicolon-separated tags. A preview shows the resulting card/stack count. Matching IDs update existing records; unmatched IDs are added. A backup is taken before applying the import. Dates are ISO `YYYY-MM-DD`. Specialized Things/Todoist/Reminders adapters are not included.

## Structure

```text
src/components/          Shell, navigation, accessible dialogs, daily planning
src/features/tasks/      Lists, drag-and-drop, card editor
src/features/graph/      Pure graph projection, canvas UI, layout worker
src/features/settings/   Preferences, import/export, backup controls
src/features/templates/  Picker, selective preview, visual template builder
src/lib/                 Dates, recurrence, search, import validation, repository
src/stores/              Workspace actions, serialized persistence, UI state
src/types/               Shared entity definitions
src-tauri/src/           Native commands and SQLite repository
src-tauri/migrations/    Versioned database migrations
```

## Validation

```sh
npm test                  # Domain tests: dates, search, graph, dependencies, import
npx playwright install chromium
npm run test:e2e           # Browser workflows, SQLite persistence, backup restore
npm run test:native       # Rust migration, durability, validation, backup tests
npm run build
```

The initial workspace contains realistic demo cards. An empty workspace is seeded only when no saved workspace exists. Distribution signing, notarization, and automatic native updates are not configured; configure these before publicly shipping installers.

## License

[MIT NON-AI License](LICENSE). This custom, source-available license permits use, modification, and redistribution subject to its terms, but **prohibits all AI/ML use of the code**, including training, inference, AI integrations, and supplying the code to AI coding tools, unless separately authorized in writing by the applicable copyright holder(s). It is not the standard MIT License or an OSI-approved open-source license.

Third-party components and assets retain their own licenses. Previously granted licenses are not retroactively revoked. See the license file for the full terms.

## House Edge browser analytics

The browser version includes House Edge page/view tracking, anonymous sessions, errors, and Web Vitals. Native Tauri sessions are always excluded, even when analytics environment variables are set. Named views are mapped to fixed paths; project names, file contents, and search text are not used as page names.

Create a House Edge project with key `deck` and allow this site's exact origin. Set `VITE_HOUSE_EDGE_KEY` to its **browser ingestion key** and `VITE_HOUSE_EDGE_ENDPOINT` to your collector URL ending in `/api/collect`, using `.env.local` or your build environment. `.env.example` lists the settings. Rebuild and redeploy the browser version, then check Live Activity for `page_view` and `session_start` after about five seconds.

Tracking is off when the key or endpoint is missing, and development requires `VITE_HOUSE_EDGE_TRACK_DEVELOPMENT=true`. Do Not Track is respected. The SDK is installed from the checked-in `vendor/house-edge-analytics-0.1.1.tgz`, so independent builds need no sibling House Edge checkout. Commit the tarball with its package manifest and lockfile.

### Web accounts and synchronization

Deck now includes an opt-in authenticated web portal, a PostgreSQL/Better Auth API,
automatic browser/desktop sync, recovery history, account exports, mobile navigation,
and an offline PWA shell. The existing standalone mode remains available.

See [the portal setup and architecture guide](docs/portal.md) for environment variables,
Google OAuth, migrations, desktop connection, deployment, retention, and integration tests.
The [Azure free-tier deployment guide](docs/azure-free.md) describes the hosted
Azure SQL, App Service, and Microsoft Entra External ID variant.

## macOS Release

Run `npm run release:mac:check` to validate prerequisites, then `npm run release:desktop` for Developer ID signed, notarized ARM64, Intel and universal apps/DMGs. See [macOS release setup, credentials, outputs and verification](docs/MACOS_RELEASE.md). Existing development and Windows/Linux commands remain available.
