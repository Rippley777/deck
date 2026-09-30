# Deck

**Put what matters on deck.**

A local-first desktop task manager built with Tauri 2, Rust, React 19, TypeScript, Vite, Tailwind CSS, and SQLite. Warm charcoal and muted lavender, a quiet Today view, and an interactive graph of the same workspace.

## Run

Requires Node 20.19+ (or Node 22+) and npm. The desktop build also requires the Tauri prerequisites for your operating system. Rust 1.90 is pinned in `rust-toolchain.toml`.

```sh
npm install
npm run dev            # Browser: http://localhost:1432
npm run desktop        # Native desktop; reuses an existing Deck dev server
```

```sh
npm run build          # Typecheck and build the offline-capable web app
npm run preview        # Serve the production web build
npm run desktop:build  # Native executable and platform installers
```

The desktop app needs no web server or network after installation. The browser version caches its assets after the first successful production load, including SQLite WASM, graph workers, and fonts. Development mode requires Vite.

## Everyday use

- Inbox, Today, On Deck, Anytime, Someday, and the chronological Logbook.
- Editable cards with Markdown notes, checklists, separate work dates and deadlines, time, stack, section, tags, priority, effort, recurrence, and a parent card.
- Drag cards between sections, onto other cards, into sidebar destinations or stacks, and onto dates in the week strip. Drag sidebar stacks to reorder them.
- Shift/Cmd/Ctrl-click cards for bulk scheduling, completion, and stack changes.
- Completion includes Undo. Recurring completion creates one next occurrence, with a fresh checklist; Undo also removes that occurrence.
- Deal Your Day intentionally pulls cards into Today. Shuffle ranks actionable cards by priority, overdue deadlines, effort, age, and current stack; blocked cards are excluded.
- Stack settings include notes, a deadline, headings, and related stacks. Goals and their stacks can be managed under Settings → Advanced.

Quick Add recognizes dates and times, `#StackName`, and `@tags` (an unknown `#name` also becomes a tag):

```text
Finish README tomorrow #Oddware @writing
Call mechanic Friday at 3pm
Water plants every Sunday
```

Dates accept natural language such as “next Monday”, “in 3 days”, or “Oct 14”. Repeats support daily, weekdays, named weekdays, monthly, and custom intervals such as “every 3 days”, “every 2 weeks”, or “every 2 months”. They advance from the later of the scheduled date and completion day; missed occurrences are not backfilled.

### Keyboard

| Action | Shortcut |
| --- | --- |
| Quick Add | Cmd/Ctrl N, or N outside an editor |
| New from template | Cmd/Ctrl Shift N |
| Search and commands | Cmd/Ctrl K, or / |
| Complete open card | Cmd/Ctrl Enter |
| Navigate the seven main destinations | Alt 1–7 |
| Navigate/open/complete list cards | Arrow keys / Enter / Space |
| Schedule open card today | T outside an editor |
| Focus the stack selector | M outside an editor |
| Settings | Cmd/Ctrl , |
| All shortcuts | ? |

Search includes titles, notes, stack names, tags, and completed cards. Filters can be combined:

```text
project:Oddware tag:development
completed:true
before:Friday overdue:true
```

## Templates

Open **Templates** in the sidebar to manage the library, or **New from template** with Cmd/Ctrl Shift N or the command palette. New Card and New Stack both offer **Start from template**. Right-click a card or sidebar stack (or press Shift F10 while focused) for template actions. Card details can insert a checklist; cards and stacks can also be saved as templates.

Ten built-ins cover Software Project, New Feature, Bug Fix, App Launch, App Deployment, Website Launch, Open Source Release, Home Project, Trip Planning, and Deploy Checklist. The picker supports fuzzy search, favors recent use, then favorites, then your library order.

Every application opens a preview. Select All, Clear All, and individual checkboxes control what is generated. Variables such as `{{project_name}}` are substituted in titles, notes, tags, and headings. Required variables and variables referenced by checked items must have values. Choice variables can control simple “include when this value equals that value” conditions; hidden items are never generated.

- Stack templates create a new stack with headings, independent cards, and optional milestone cards.
- Task templates create a parent card with child cards, checklist items, or both. A task template can also contain only the parent’s notes, tags, effort, and priority.
- Checklist templates append checked items to the existing card, or create a new card when used from the global picker.
- Dependencies connect generated cards using fresh IDs and appear in Graph View. Dependencies on skipped items are omitted. A checklist’s parent must be selected; a child card whose parent is skipped becomes a top-level card (or belongs to the generated root task).
- Milestones remain ordinary editable, completable cards, identified by a badge in lists and a diamond in Graph View.

The visual builder supports task/checklist/milestone types, headings, default selections, drag reordering and keyboard reorder buttons, variables, conditions, parent relationships, dependencies, notes, tags, priority, effort, and a default stack. Cycles and missing references are rejected before saving. Library controls edit, duplicate, delete (with Undo), reorder, favorite, export, and import templates. Standalone exports use a versioned `deck-templates` JSON envelope; importing creates new library entries. Full workspace JSON exports and SQLite backups also include templates, favorites, and recent use. Existing databases receive the starter library once; an intentionally empty library stays empty.

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
- **Browser:** the same versioned workspace format in a real SQLite database using SQL.js, with binary snapshots committed to IndexedDB transactions. Browser and native workspaces are independent; JSON export/import transfers between them.
- Up to 14 rotating database backups, daily or weekly on writes. Manual backup and restore are in Settings. Restore keeps a before-restore snapshot.
- Data currently uses a versioned workspace document inside SQLite. Stable entity IDs and the repository interface provide the boundary for future storage/sync changes. No cloud sync, account service, telemetry, or network API is implemented.
- Browser storage can be removed by clearing site data; export important work. Local backups are on the same device and are not an off-device backup.

## Import and export

Export JSON, CSV, or Markdown under Settings → Data. Desktop export uses a native save dialog; browser export downloads a file.

Import a Deck JSON export, an array of card objects, or CSV with a `title` column. A preview shows the resulting card/stack count. Matching IDs update existing records; unmatched IDs are added. A backup is taken before applying the import. Dates are ISO `YYYY-MM-DD`; CSV tags use semicolons. CSV checklist, link, and dependency fields use JSON arrays. Specialized Things/Todoist/Reminders adapters are not included.

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
