# Dayframe PWA: Product and Technical Specification

**Status:** PWA-specific build specification  
**Primary devices:** iPhone, iPad, and Windows PC  
**Delivery:** Installable Progressive Web App  
**Cost requirement:** No purchase, subscription, paid hosting, Apple Developer membership, or paid API  
**Builder:** Codex working in a Git repository  

---

## 1. Product definition

Dayframe is a private, offline-first personal planner for tasks, routines, projects, appointments, shopping, and everyday decision support. It is designed for one user and particularly addresses:

- Chaotic lists and calendars
- Underestimating task duration
- Choice paralysis
- Difficulty starting tasks
- Abandoning productivity systems after complicated setup

The app must remain useful when the user enters only a task title. Optional metadata improves planning suggestions but never becomes required maintenance.

### Core promise

> See everything that matters, choose what to do without overwhelm, and build a realistic plan that can change without becoming a failure.

### PWA position

Dayframe is a web application that can be installed from Safari onto the iPhone or iPad Home Screen. It opens in a standalone app window, works offline after its first successful load, stores data locally, and can also run in a desktop browser.

It is not presented as an App Store application. It must not claim native capabilities that a PWA cannot reliably provide.

---

## 2. Non-negotiable constraints

- No Mac required
- No Apple Developer Program membership
- No paid hosting
- No paid API
- No advertising
- No account required
- No collaboration or shared lists
- No external AI service
- No premium features or artificial limits
- No Pomodoro timer
- No productivity score or punitive streak
- No dependency on an online service for core functionality
- No silent automatic rescheduling

---

## 3. PWA capability decisions

| Original native capability | PWA decision |
|---|---|
| App icon | Supported through Add to Home Screen |
| Standalone app window | Supported through the web app manifest |
| Offline use | Supported with service-worker caching and IndexedDB |
| Native Apple Calendar reading | Not supported |
| Native calendar editing | Use internal calendar and `.ics` export |
| Local native notifications | Not guaranteed; use in-app reminder centre |
| Push notifications | Deferred; not required for initial or core product |
| Home Screen widgets | Not supported |
| Widget replacement | Strong Home dashboard and optional icon badge where supported |
| Apple Watch app | Removed |
| iCloud/CloudKit sync | Replaced by local data plus backup/import |
| Cross-device automatic sync | Deferred; not promised under zero-cost constraint |
| App Intents/Siri | Removed |
| Live Activities | Removed |
| App Store distribution | Not required |

These are intentional product decisions, not incomplete tasks.

---

## 4. Product principles

1. **Calm by default.** Show the smallest useful amount of information.
2. **Works with incomplete data.** Only a title is required.
3. **Intent is not a deadline.** Planned dates and deadlines remain separate.
4. **Flexible time is valid.** Tasks may use exact times, time windows, date ranges, or no date.
5. **User approval is required.** Suggestions never silently change the plan.
6. **Replanning is normal.** Moving, deferring, and skipping are neutral actions.
7. **Progress without judgment.** Show history without scores or shame.
8. **Offline first.** Core functionality cannot depend on internet access.
9. **Portable data.** The user can export everything in a readable format.
10. **Progressive enhancement.** The app still functions when optional browser capabilities are unavailable.

---

## 5. Information architecture

### Primary navigation

Use five bottom destinations on mobile and a collapsible side rail on wider screens:

1. **Home** — configurable dashboard
2. **Plan** — agenda, timeline, and Session Builder
3. **Calendar** — internal calendar views
4. **Lists** — areas, lists, projects, routines, and shopping
5. **Insights** — descriptive patterns

Settings opens from the Home header.

A persistent Quick Add button is available throughout the app.

### Organisation hierarchy

`Area → List → Task → Steps`

Suggested starter areas:

- Personal
- Household
- Coreframe
- Projects
- Shopping

Users can rename, remove, reorder, recolour, and add areas.

### List modes

- Standard list
- Project
- Routine collection
- Shopping/purchase list
- Reference or backlog list

---

## 6. Home dashboard

Home is the replacement for native widgets. It must provide a useful overview immediately after the app launches.

### Default cards

1. Current routine item
2. Today overview
3. Up next
4. Any Time Today
5. Overdue and approaching deadlines
6. Reminder centre preview
7. Next three days
8. Quick actions

### Available cards

- Current routine
- Today appointments
- Today tasks
- Any Time Today
- Next three items
- Next three days
- Overdue
- Deadlines
- Upcoming reminders
- Inbox
- Project progress
- Shopping estimate
- Help Me Choose
- Session Builder
- Recently completed
- Routine progress
- Weekly workload
- Backup status
- Install-app guidance, shown only when not installed

### Customisation

- Reorder cards by drag handle
- Hide/show cards
- Compact, standard, and expanded sizes where supported
- Save named layouts
- Duplicate/delete layouts
- Set default layout
- Restore recommended layout
- Switch layouts from the Home header

Suggested layouts:

- Normal Day
- Busy Day
- Weekend
- Project Day
- Low-Overwhelm

### Home presentations

- Dashboard
- Compact agenda
- Timeline

The app remembers the last view and lets the user set a default. It does not force the timeline before the user learns whether it is helpful.

---

## 7. Task system

### Required task fields

- ID
- Title
- Destination list
- Status
- Created and modified timestamps

### Optional fields

- Notes
- Steps
- Tags
- Priority: None, Low, Medium, High
- Importance: None, Helpful, Important, Essential
- Deadline
- Planned date
- Date range
- Time window: Morning, Afternoon, Evening, Any Time
- Scheduled start
- Estimated duration
- Actual duration
- Reminders
- Recurrence
- Preparation checklist
- Why it matters
- Energy: Low, Medium, High
- Difficulty: Easy, Moderate, Difficult
- Context/location
- Equipment/device
- Before/after relationship

Most optional fields live under **More Options**.

### Task statuses

- Inbox
- Available
- Planned
- Scheduled
- In progress
- Blocked
- Deferred
- Completed
- Cancelled
- Deleted

### Quick Add

Quick Add contains:

- Title
- List selector defaulting to Inbox
- Optional date shortcut
- Save
- Save and Add Another

The Coreframe shortcut preselects `Coreframe → Capture` and asks for:

- Client/business name
- Short task or idea

It creates a normal task.

### Completion

On completion:

- Play subtle haptic feedback when supported
- Check the task
- Grey and strike through its title
- Leave it visible in place

**Clear Completed** hides completed items without deleting them.

### Projects

A list marked as a project gains:

- Outcome/description
- Target date
- Sections
- Progress bar
- Next available action
- Blocked count
- Completed history
- Archive

### Lightweight task relationships

Support plain before/after links:

- Task B cannot start until Task A is complete
- Blocked tasks are excluded from task recommendations
- Projects display the next available action
- No formal dependency graph interface

---

## 8. Internal calendar and appointments

Because browser applications cannot freely read the calendars connected to iOS, Dayframe owns an internal appointment calendar.

### Appointment fields

- Title
- Date
- Start and end time
- All-day flag
- Location
- Notes
- URL
- Colour/calendar group
- Recurrence
- In-app reminders
- External calendar export state

### Views

- Day agenda
- Day timeline
- Three-day planner
- Seven-day agenda
- Week capacity
- Month workload

Month cells use workload indicators rather than tiny text.

### Calendar groups

Allow internal groups such as:

- Personal
- Work
- Appointments
- University
- Other

Groups can be coloured and hidden.

### `.ics` export

For an appointment or scheduled task, Dayframe can generate a standard `.ics` file containing:

- Title
- Start/end time
- Location
- Notes
- Recurrence where safely representable
- Alarm where supported by the receiving calendar

The user then chooses whether to add it to Apple, Google, Outlook, or another calendar application.

Important limitations:

- Export is one-way
- Later changes in Dayframe do not update the external event
- External changes do not return to Dayframe
- The UI explains this before export

### Calendar import

Support manual import of `.ics` files as a later enhancement. Import must preview events and detect duplicates before writing.

Do not build direct Apple/Google/Outlook authentication for the zero-cost version.

---

## 9. Planning model

A task may use:

- Exact start and duration
- Morning, Afternoon, or Evening
- Any Time on a selected day
- Flexible date range
- Before or after another task/appointment
- Deadline only
- No date

### Capacity calculation

Calculate:

- Internal appointment time
- Routine time
- Scheduled task time
- Flexible estimated time
- Available hours configured by the user
- Remaining or overplanned time

Warnings are advisory and never block scheduling.

### Agenda

Combine:

- Appointments
- Routine items
- Scheduled tasks
- Time-window tasks
- Any Time tasks
- Deadlines
- Reminders

### Timeline

Support:

- Adjustable scale
- Current-time marker
- Drag to schedule
- Resize duration
- Drag back to flexible planning
- Tap empty space to create
- Overlap display
- Available gaps

Touch interactions require accessible button/menu alternatives.

### Multi-day plan

- Three-day mobile view
- Seven-day agenda
- Week capacity view
- Backlog drawer
- Deadline tray
- Date-range tray

---

## 10. Help Me Choose

### Modes

- Random Task
- From Area/List/Project/Tag
- Next Deadline
- Quick Win
- Low Energy
- Available Time
- Continue a Project

### Eligibility

Exclude by default:

- Completed/cancelled/deleted tasks
- Blocked tasks
- Tasks outside a strict date window
- Tasks requiring unavailable prerequisites

### Result

Show one recommendation with:

- Reason selected
- Duration
- Preparation
- Deadline/importance
- First step

Actions:

- Start
- Show another
- Add to today
- Schedule
- Open

### Missing data

Use fallback logic. Do not require energy, difficulty, duration, or context. Offer occasional dismissible hints explaining which detail would improve future recommendations.

---

## 11. Starting support and Focus View

There is no Pomodoro mode.

### Start options

- Start now
- Break into steps
- Review preparation
- Set countdown
- Open Focus View

### Preparation checklist

Preparation is distinct from action steps and may include gathering equipment, opening a page, or clearing a workspace.

### Focus View

Show only:

- Task title
- Why it matters
- Preparation state
- Current step
- Optional next-step preview
- Countdown or elapsed time
- Pause, finish, and exit

Hide other tasks, navigation, insights, and backlog.

### Countdown limitation

The countdown works reliably while the PWA is open. If the browser suspends the app, calculate remaining time from stored timestamps when it resumes rather than relying on an uninterrupted JavaScript timer.

When time ends:

- Add 5/10/15 minutes
- Continue without timer
- Complete
- Stop and replan

---

## 12. Session Builder

### Inputs

- Available start/end time
- Selected tasks, list, project, or area
- Include breaks
- Break length
- Permission to suggest replacements
- Optional Hardest First override

It does not ask how the user feels.

### Default ordering

1. Respect fixed appointments and routines
2. Exclude blocked tasks
3. Respect before/after links
4. Protect nearest deadlines
5. Prefer higher importance
6. Schedule tasks that unlock others
7. Use quick wins where useful
8. Include preparation/cleanup
9. Reduce context switching
10. Fit within available time

Hardest First is opt-in.

### Preview

Always show before applying:

- Ordered blocks
- Preparation time
- Breaks
- Unused time
- Excluded tasks
- Conflicts/assumptions
- Reason for order

### When tasks do not fit

Offer:

- Remove task
- Move task to another day
- Suggest shorter replacement, with permission
- Extend time
- Keep partial plan

### Falling behind

Nothing moves automatically. Manually offer:

- Rebuild remaining session
- Move blocks
- Defer tasks
- Return to flexible planning
- Leave unchanged

---

## 13. Routines

### Optional groups

- Morning
- Evening
- Weekday
- Weekend
- Custom

### Styles

- Exact times
- Time windows
- Unscheduled checklist
- Triggered after another item
- Flexible Applies Today

Different routines and weekdays may mix styles.

### Applicability

An optional daily card asks which non-required routines apply. It can be disabled.

### Starter experiments

- Guided Day
- Flexible Day
- Checklist Day
- Mixed Day

The user may test different styles by day without committing permanently.

### Missed routine actions

- Move
- Skip occurrence
- Leave outstanding
- Return to routine list

Pattern suggestions never apply changes automatically.

---

## 14. Reminder centre and summaries

### Reminder reality

Dayframe must not promise native alarm-like delivery. Reminders are stored locally and evaluated when the app is active or reopened.

### In-app reminders

Support:

- At scheduled time
- Relative to scheduled time
- Relative to deadline
- Custom date/time
- Morning of planned day

### Reminder centre

Shows:

- Due now
- Overdue
- Upcoming
- Dismissed alerts
- Snoozed alerts
- Linked task/appointment

Dismissing an alert changes only that reminder occurrence, not the task.

### Active-app alerts

While Dayframe is open, display:

- In-app banner
- Optional sound where browser policy permits
- Optional vibration where supported

### Morning summary

- Appointments
- Applicable routines
- Planned tasks
- Deadlines
- Remaining capacity

### Evening review

- Completed work
- Unfinished tasks
- Missed routines
- Tomorrow overview
- Move/defer/skip/return/leave actions

### Week summary

- Appointments
- Deadlines
- Workload by day
- Overloaded days
- Important unscheduled tasks

### Optional future push

Web Push may be explored later as a progressive enhancement using a zero-cost service, but it is not part of the offline core and must not become required for task reliability.

---

## 15. Shopping and purchase planning

Shopping is a specialised list mode for groceries and hobby/project purchases.

Example lists:

- Household groceries
- Video games
- 3D printing
- Garden renovation

### Item fields

- Name
- Custom category
- Quantity
- Unit
- Optional unit price
- Optional estimated total
- Optional actual price
- Notes
- Shop/source
- Link
- Frequently purchased flag
- Purchased state
- Source task/meal reference

### Totals

- Estimated total
- Actual total
- Category subtotals
- Difference
- Count/value of unpriced items

Currency defaults to device locale and can be overridden.

### Reuse

- Save as template
- Duplicate list
- Reset purchased state
- Add frequent items
- Preserve optional quantity and price

### Task/meal conversion

Tasks and simple meal notes may create proposed shopping items. Preview, select destination list, and detect likely duplicates before adding.

Full meal planning is out of initial scope.

---

## 16. Insights without scoring

Include:

- Tasks completed daily, weekly, monthly
- Planned versus actual time
- Frequently deferred tasks
- Commonly underestimated tasks
- Best completion days/times by category
- Routines regularly skipped
- Routine-style comparisons
- Cluttered-list suggestions
- Upcoming workload
- Shopping estimates over time

Never include:

- Overall productivity score
- Daily grade
- Streak
- Broken-streak warning
- Comparison with other users
- Negative messaging for quiet days

Insights describe evidence, for example:

> Tasks estimated at 30 minutes in Household usually take around 50 minutes.

The user can dismiss individual suggestions or disable a suggestion type.

---

## 17. Search and smart lists

### Search coverage

- Task titles
- Notes
- Steps
- Tags
- Areas/lists
- Shopping items
- Completed items
- Archived projects

### Default smart lists

- Inbox
- Today
- Next Three Days
- Upcoming
- Deadlines
- Overdue
- Unscheduled
- Blocked
- Deferred
- Completed
- Recently Deleted

### Saved filters

Filter by area/list, tag, date, duration, importance, energy, difficulty, context, status, recurrence, and reminder presence. Saved filters can become Home cards.

---

## 18. Installation experience

### Install detection

Detect standalone display mode where supported. When running in Safari and not installed, show a dismissible installation card.

### iPhone/iPad instructions

Provide clear steps:

1. Open Dayframe in Safari
2. Tap Share
3. Choose Add to Home Screen
4. Confirm the name and icon
5. Open Dayframe from the new icon

Do not claim that other iOS browsers can perform every installation step identically.

### Manifest

Include:

- Name: Dayframe
- Short name: Dayframe
- Standalone display
- Portrait-primary orientation without preventing landscape on iPad
- Theme/background colours for light and dark launch appearance
- Maskable and standard icons in required sizes
- Start URL
- App description

### Update behaviour

When a new service worker is ready, show:

> An update is ready. Reload now?

Never refresh while a form contains unsaved changes.

---

## 19. Offline and storage architecture

### Local-first rule

All primary reads and writes go to IndexedDB. Network availability does not affect task creation, completion, planning, routines, shopping, or insights.

### Recommended implementation

- React
- TypeScript with strict mode
- Vite
- `vite-plugin-pwa` or Workbox
- IndexedDB through Dexie
- React Router
- Zustand or another lightweight state layer only where it adds value
- Zod for runtime validation and import validation
- date-fns for date manipulation
- dnd-kit for accessible drag-and-drop
- Vitest
- React Testing Library
- Playwright for browser flows

Avoid a large UI framework if it makes the interface look generic. Build a small accessible component system.

### Storage layers

1. IndexedDB for application data
2. Cache Storage for the app shell and static resources
3. `localStorage` only for tiny non-critical preferences if necessary
4. In-memory state as a view cache, never the source of truth

### Service-worker strategy

- Precache versioned app shell
- Cache-first for hashed static assets
- Network-first with cached fallback for the HTML entry point
- Do not cache user data in HTTP caches
- Provide offline fallback
- Clean obsolete caches after activation
- Coordinate schema migrations with application startup

### Storage durability

Where supported, request persistent storage after the user has created meaningful data. Explain that browser/device storage can still be cleared and that backups remain important.

---

## 20. Backup, restore, and portability

Because there is no paid sync service, backup is a first-class feature.

### Full backup

Export a versioned JSON file containing:

- All app entities
- Settings
- Dashboard layouts
- Tags
- Relationships
- Insights history needed for calculations
- Schema version
- Export timestamp

### Restore

Before import:

- Validate structure and schema
- Show summary counts
- Offer Replace All or Merge
- Create an automatic pre-import backup
- Detect duplicate IDs
- Report skipped invalid records

### Other exports

- Tasks CSV
- Shopping CSV
- Project/list Markdown
- Appointment `.ics`

### Backup reminders

Home may show a neutral backup-status card:

> Last backup: 18 days ago

This is dismissible and configurable.

### Cross-device use

For initial zero-cost operation:

1. Export backup on device A
2. Transfer through Files, email to self, or another method chosen by the user
3. Import on device B

The specification does not promise automatic merging across simultaneously active devices.

---

## 21. Conceptual data model

Primary tables/collections:

- `areas`
- `lists`
- `tasks`
- `taskSteps`
- `tags`
- `taskTags`
- `taskRelationships`
- `reminders`
- `recurrenceRules`
- `recurrenceExceptions`
- `plannedPlacements`
- `timeEntries`
- `appointments`
- `calendarGroups`
- `routines`
- `routineItems`
- `routineApplicability`
- `shoppingDetails`
- `templates`
- `dashboardLayouts`
- `dashboardCards`
- `savedFilters`
- `suggestionRecords`
- `changeHistory`
- `settings`
- `metadata`

### Data rules

- Use stable UUIDs
- Store dates as ISO timestamps plus explicit local-date fields where calendar-day semantics matter
- Store time zone with appointments and scheduled tasks
- Use soft deletion before permanent removal
- Track schema version
- Make migrations deterministic and tested
- Store recurrence as structured rules, not display strings

---

## 22. Privacy and security

- No account
- No tracking
- No analytics SDK
- No ads
- No external AI
- No task data sent to the hosting provider after static files load
- Content Security Policy
- No secrets embedded in the client
- Safe HTML rendering; notes are plain text or sanitised structured markup
- Validate imported files
- Confirm destructive imports and deletes
- Do not store calendar-provider credentials

Hosting serves only the static application bundle. Personal data remains in the browser database unless the user exports it.

---

## 23. Responsive design

### iPhone

- Bottom navigation
- Single-column dashboard
- Sheets and drawers
- Three-day planning as horizontally paged/scrollable layout
- Large touch targets
- Safe-area support

### iPad

- Sidebar/rail where space permits
- Two-column dashboard
- Split list/detail views
- Wider timeline
- Keyboard support

### Desktop Windows browser

- Persistent side navigation
- Multi-column dashboard
- Keyboard shortcuts
- Drag-and-drop planning
- Wider week and month views
- Import/export convenience

The same database remains device-local unless backups are manually moved.

---

## 24. Visual system

### Direction

- Clean
- Calm
- Modular dashboard
- Not overcrowded
- Colour-coded areas/lists
- Native-feeling but not a fake reproduction of iOS controls
- Minimal decorative imagery
- No mascot or gamified celebration

### Light palette

| Role | Hex |
|---|---|
| Primary indigo | `#5B67C8` |
| Accent teal | `#3D9F98` |
| Background | `#F7F7F4` |
| Surface | `#FFFFFF` |
| Secondary surface | `#EFF0F4` |
| Primary text | `#252731` |
| Secondary text | `#6B6E78` |
| Success | `#4C956C` |
| Warning | `#CE9138` |
| Destructive | `#CF5E62` |

### Dark palette

| Role | Hex |
|---|---|
| Primary | `#A2AAFF` |
| Accent | `#69C5BE` |
| Background | `#15161B` |
| Surface | `#202127` |
| Secondary surface | `#2A2B33` |
| Primary text | `#F4F3F0` |
| Secondary text | `#AAABB4` |

### Completion treatment

- Checkmark
- Subtle supported haptic/vibration
- Grey text
- Strikethrough
- Remain visible until Clear Completed

### Motion

- Short, purposeful transitions
- No confetti
- Respect `prefers-reduced-motion`
- Never require animation to understand status

---

## 25. Accessibility

- Semantic HTML first
- Correct heading hierarchy
- Labelled form controls
- Screen-reader announcements for completion and scheduling
- Full keyboard operation
- Visible focus styles
- Accessible drag-and-drop alternatives
- Minimum 44×44 CSS-pixel touch targets
- High-contrast theme
- Status not communicated by colour alone
- `prefers-reduced-motion`
- `prefers-contrast` enhancement where supported
- Agenda alternative to timeline
- Adjustable density and text scale
- Plain-language recurrence summaries

Test with VoiceOver on iPhone as well as automated browser accessibility tooling.

---

## 26. Onboarding

Keep onboarding short and skippable:

1. One-screen product explanation
2. Choose/edit starter areas
3. Choose suggested dashboard layout
4. Optionally choose a routine style
5. Create first task
6. Land on Home
7. Offer installation guidance after initial value is demonstrated

Do not request detailed schedules, tags, shopping categories, or every routine up front.

---

## 27. Hosting and deployment

### Recommended zero-cost host

Use GitHub Pages for a static build if the repository may be public, or another static host with a free tier if repository/privacy requirements differ. The application contains no server-side code.

### Deployment requirements

- HTTPS
- Correct SPA fallback or hash-based routing compatible with the host
- Immutable caching for hashed assets
- Conservative caching for HTML/service worker
- Automated build/test/deploy through GitHub Actions if supported without cost
- No credentials stored in the repository

### Repository contents

- Source code
- Tests
- PWA icons and manifest
- Architecture notes
- Data schema documentation
- Backup format documentation
- Development and deployment instructions
- `AGENTS.md` with build/test conventions for Codex

---

## 28. Test strategy

### Unit tests

- Capacity calculation
- Date-window eligibility
- Task-choice modes
- Session Builder ordering
- Before/after relationships
- Recurrence generation
- Shopping totals
- Insight calculations
- Import validation and migrations

### Component tests

- Task creation/editing
- Dashboard card configuration
- Completion/clear behaviour
- Reminder centre
- Shopping fields
- Backup/restore preview

### End-to-end tests

- First-run onboarding
- Offline task creation and reload
- Installable manifest checks
- Plan and complete a day
- Session Builder preview/approval
- Backup/export/wipe/restore
- Service-worker upgrade
- Mobile navigation

### Manual device matrix

- iPhone Safari in browser
- Installed iPhone Home Screen mode
- iPad Safari and installed mode
- Windows Firefox/Chrome/Edge as available
- Offline mode
- Low storage warning scenario where reproducible
- Light/dark mode
- Larger text and VoiceOver

---

## 29. Build roadmap

### Phase 0: Repository and PWA foundation

- React/TypeScript/Vite project
- Strict linting and formatting
- Test setup
- PWA manifest and icons
- Service worker
- Responsive shell and navigation
- Design tokens/components
- IndexedDB wrapper and migration foundation
- Error boundary and logging
- `AGENTS.md`

**Exit:** Installable shell loads on iPhone and works offline.

### Phase 1: Organisation and tasks

- Areas and lists
- Task CRUD
- Steps and tags
- Completion/Clear Completed
- Search
- Smart lists
- Projects and next action
- Before/after links
- Recently Deleted and undo

**Exit:** Dayframe replaces a normal task-list app.

### Phase 2: Dashboard and flexible planning

- Dashboard cards
- Reorder/hide/resize
- Saved layouts
- Planned dates, deadlines, date ranges, time windows, durations
- Agenda
- Any Time Today
- Capacity calculations

**Exit:** A realistic day can be organised without a timeline.

### Phase 3: Internal calendar and timeline

- Appointments and calendar groups
- Day/three-day/week/month views
- Timeline interactions
- Drag scheduling and resizing
- `.ics` export

**Exit:** Tasks can be planned around appointments stored in Dayframe.

### Phase 4: Reminders and recurrence

- In-app reminder engine
- Reminder centre
- Morning/evening/week summaries
- Recurrence and exceptions
- Resume-time reminder checks

**Exit:** The app accurately surfaces reminders whenever active or reopened.

### Phase 5: Choice and starting support

- Help Me Choose
- Preparation checklist
- Manual breakdown
- Focus View
- Resilient countdown

**Exit:** The app helps select and begin work.

### Phase 6: Session Builder

- Task/list selection
- Ordering engine
- Preview/explanations
- Replacement permission flow
- Rebuild/defer controls

**Exit:** A free block can be turned into a credible approved plan.

### Phase 7: Routines and insights

- Routine groups/styles
- Applicability card
- Starter experiments
- Deferral and estimation patterns
- Clutter suggestions
- Non-scoring charts and summaries

### Phase 8: Shopping

- Shopping-list mode
- Custom categories
- Quantities/notes
- Optional pricing
- Estimated/actual totals
- Frequent and reusable items
- Task/meal conversion

### Phase 9: Backup and hardening

- Full JSON export/import
- CSV/Markdown export
- Merge/replace restore
- Pre-import backup
- Persistent-storage request
- Performance and accessibility audits
- Cross-browser and service-worker tests

### Phase 10: Optional enhancements

- Manual `.ics` import
- Install/badge refinements
- Optional Web Push research
- Optional zero-cost sync experiment, clearly separated from the offline core

---

## 30. First usable release

The first useful personal release must contain:

- Installable PWA shell
- Offline application loading
- Areas, lists, tasks, steps, and tags
- Projects and next available actions
- Configurable Home dashboard
- Planned date, deadline, duration, and time windows
- Internal appointments
- Today and three-day agenda
- Any Time Today
- In-app reminder centre
- Morning/evening summaries
- Basic routines
- Help Me Choose
- Preparation checklist and Focus View
- Coreframe quick capture
- JSON backup/restore

The full timeline, Session Builder, pattern insights, and shopping depth may follow after this core is stable.

---

## 31. Acceptance scenarios

### Morning overview

Opening the Home Screen icon immediately shows the current routine, appointments, due tasks, overdue tasks, reminders, and next three days.

### Offline capture

With airplane mode enabled, the user creates and completes tasks. Data remains after closing and reopening the installed PWA.

### Coreframe capture

The user records a client name and short idea into Coreframe Capture in under ten seconds.

### Choice paralysis

Help Me Choose returns one actionable Quick Win with an explanation and can open Focus View.

### Sunday planning

The user selects a six-hour block and five tasks. Session Builder respects appointments, deadlines, task order, and preparation, then waits for approval.

### Quiet day

The app shows unfinished options without a broken streak, productivity score, or failure language.

### Calendar handoff

The user exports an appointment as `.ics`, understands it is a one-way copy, and opens it in an external calendar.

### Backup recovery

The user exports a JSON backup, clears app data, imports the backup, and recovers areas, tasks, layouts, routines, and shopping data.

### App update

A new service worker becomes available while a task form is open. Dayframe waits for confirmation and preserves unsaved work before reloading.

---

## 32. Explicit exclusions

- Native Apple/Google/Outlook calendar synchronisation
- Guaranteed background notifications
- Native widgets
- Apple Watch app
- Siri/App Intents
- iCloud/CloudKit
- App Store distribution
- Automatic cross-device sync
- Team workspaces
- Shared lists
- Habit gamification
- Pomodoro
- AI chatbot
- Online task-breakdown service
- Productivity scoring
- Paid themes or features

---

## 33. Final build instruction

Codex should implement this specification one phase at a time. It must not attempt the entire product in a single prompt.

For every phase, Codex must:

1. Inspect the current repository and specification
2. State the scoped implementation plan
3. Preserve completed behaviour
4. Add or update tests
5. Run lint, type-checking, unit tests, and relevant end-to-end tests
6. Verify offline behaviour when affected
7. Document material architecture decisions
8. Stop at the phase boundary

The initial Codex request should cover **Phase 0 only**. Phase 1 begins only after the installable offline shell has been tested successfully on the user's iPhone.

---

## 34. Final product position

Dayframe PWA is a zero-cost, private personal command centre. Its strongest value does not depend on App Store distribution or native Apple frameworks. It comes from:

- Flexible planning instead of a rigid productivity method
- Clear separation between deadlines and intentions
- Choice and task-starting support
- Approval-based session planning
- Routines that can be experimented with
- Serious personal shopping and project planning
- Descriptive insights without shame or scoring
- An offline dashboard that remains useful with incomplete information

The PWA succeeds when it is easy to install, safe to trust offline, simple to reopen after a chaotic period, and capable of showing what matters next without requiring constant system maintenance.
