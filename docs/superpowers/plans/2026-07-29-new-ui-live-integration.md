# New UI + Full Live Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the frontend live against `backend/apps/api` (every endpoint in the contract), restyle all five screens to the provided mockups (desktop + mobile, real data only), and fix thread titles, header settings, sidebar collapse, and skeleton-on-outage behavior.

**Architecture:** The typed API layer (`frontend/lib/api/endpoints.ts` + `@educlm/contracts`) already covers the whole contract; work is env switching, seed verification, and UI. New Analytics screen is fed entirely by `GET /progress/overview`. Skeletons come from React Query pending states plus infinite retry on network failure.

**Tech Stack:** Next.js 15 (app router), React 19, TanStack Query 5, Tailwind 4, Radix dialog (already present), Fastify backend with PGlite.

## Global Constraints

- No vitest / no new tests. Verification = `npm run typecheck` + backend build + manual endpoint matrix drive + backend-stopped skeleton pass.
- Real data only: nothing rendered that the API doesn't serve. No ratings, student counts, streaks, study-time totals, mic/camera buttons.
- Commits: conventional messages, **no Co-Authored-By trailer**.
- Backend down ⇒ skeleton UI with quiet reconnect note; never an error wall.
- Follow existing code idiom: `cn()` for classes, design tokens (`bg-nav`, `text-lime`, `bg-surface`…), `'use client'` components, JSDoc-style comments where the file already has them.
- Contract wins on any live-mode mismatch.

---

### Task 1: Backend up, live mode on, endpoint matrix verified

**Files:**
- Create: `backend/apps/api/.env` (copy of `.env.example`, unmodified)
- Modify: `frontend/.env.local` (`NEXT_PUBLIC_API_MODE=mock` → `live`)

**Steps:**

- [ ] Copy `.env.example` → `.env` in `backend/apps/api`; `pnpm install` at `backend/`; run migrate + seed scripts from `backend/apps/api/package.json` (expect fixture ids `mat_demo_js`, device `demo-device`, active `assignment_vs_comparison` finding, adapted plan).
- [ ] Start API (`pnpm dev` filtered to api) on :4000; `curl http://localhost:4000/api/v1/meta/health` → `{status:"ok"}` envelope.
- [ ] Curl matrix with `-H "X-Device-Id: demo-device"`: GET materials, materials/mat_demo_js, /status, /topics, /lesson?topicId=topic_variables, /pages/1; GET chat/messages; POST chat `{message, stream:false}`; POST practice/sets `{materialId, kind:"diagnostic"}` → GET set → POST responses → POST complete; GET progress/overview?materialId=…, progress/topics/topic_conditionals, findings/:id (+ dismiss on a scratch finding), GET plan?materialId=…, POST steps/:id/complete + /skip + revert-adaptation; GET /me, PATCH /me/preferences, GET meta/ai-disclosure. Record any contract deviation and fix it (backend doc wins).
- [ ] Set `NEXT_PUBLIC_API_MODE=live` in `frontend/.env.local`; restart Next dev server; confirm the app boots without the MSW "demo mode" splash and chat streams from the API.
- [ ] Commit: `feat(web): run against the live API by default`

### Task 2: Thread titles from first message

**Files:**
- Modify: `frontend/lib/thread-index.ts`, `frontend/lib/threads.ts`, `frontend/lib/hooks/use-threads.ts`, `frontend/components/shell/thread-list.tsx`, `frontend/components/agent/agent-workspace.tsx`

**Interfaces:**
- `thread-index.ts` storage grows a v2 shape `{ topics: Record<msgId,topicId>, titles: Record<threadKey,string> }` per material, migrating the old flat map on read. New exports: `recordThreadTitle(materialId, threadKey, title)`, `readThreadTitles(materialId): Readonly<Record<string,string>>`.
- `threads.ts`: `UNGROUPED_TITLE = 'New chat'`; `buildThreads(messages, topicOf, topics, titles)` — title precedence: topic name → `titles[key]` → derived from first user message in the thread (`deriveTitle(content)`: whitespace-flatten, slice 40 chars + `…`) → `'New chat'`.

**Steps:**

- [ ] Implement index v2 with migration (old shape values are all strings ⇒ treat as `topics`), plus the two new functions; keep write-failure tolerance.
- [ ] Implement `deriveTitle` and the precedence in `buildThreads`; export it.
- [ ] `use-threads.ts`: pass titles through; `record()` additionally records a derived title on first message of an untitled thread.
- [ ] `thread-list.tsx`: drop the italic `UNGROUPED_TITLE` special-case styling (a real title now shows); `agent-workspace.tsx` header shows `thread.title` alone (mockup: "Calculus I: Chain Rule" is the thread title, not `material: thread`).
- [ ] `npm run typecheck`; manually verify: new chat shows "New chat", becomes first-message title after sending.
- [ ] Commit: `feat(web): derive conversation titles from the first message`

### Task 3: Skeleton-first loading and outage behavior

**Files:**
- Modify: `frontend/components/providers/query-provider.tsx`, `frontend/components/ui/states.tsx`, every screen that renders `ErrorState` for query failures (`agent-workspace.tsx`, `explorer-view.tsx`, `plan-view.tsx`, `progress-view.tsx`, `study-view.tsx`, `settings-view.tsx`, others found by grep).

**Interfaces:**
- `states.tsx` adds `ReconnectNote()` (quiet inline "Trying to reconnect…" strip, `role="status"`) and `ScreenSkeleton({ variant: 'chat'|'grid'|'list'|'stats' })` composed from existing `Skeleton`/`SkeletonCard`.

**Steps:**

- [ ] Query provider: network-level failures retry indefinitely with capped backoff (`retry: true`-equivalent — `retry: (count, err) => isNetworkError(err)`, `retryDelay: attempt => Math.min(30_000, 1000 * 2 ** attempt)`), `refetchOnReconnect: true`. API-level errors (envelope with code) keep current behavior.
- [ ] Add `ScreenSkeleton` + `ReconnectNote`; grep `ErrorState` usages; for query-fetch failures render `ScreenSkeleton` + `ReconnectNote` instead (mutation/send errors keep `ErrorState`).
- [ ] Verify: stop the API → every screen shows skeletons + note, no error wall; start API → screens hydrate without reload.
- [ ] Commit: `feat(web): skeleton UI with background retry when the API is unreachable`

### Task 4: Sidebar — working collapse + mockup nav

**Files:**
- Modify: `frontend/components/shell/sidebar.tsx`, `frontend/components/shell/nav-items.tsx`, `frontend/components/ui/icons.tsx` (add `AnalyticsIcon` — bar-chart glyph matching the icon set's 20px/1.5 stroke idiom)

**Interfaces:**
- `railNav(materialId)` returns, in order: Course Explorer `/materials`, Learning Plan `/plan/:id`, Analytics `/analytics/:id`, Progress `/progress/:id`. Settings leaves the rail (account row + header popover reach it).
- Collapse state: `useState` initialized from `localStorage['educlm.sidebar-collapsed']`, persisted on toggle.

**Steps:**

- [ ] Nav items per above; Analytics href null-guarded like Plan/Progress.
- [ ] Collapse: enabled toggle button (`aria-expanded`, labels "Collapse sidebar"/"Expand sidebar"); collapsed rail is `w-16`: mascot only (links home), toggle, New Chat as icon button (`title="New Chat"`), nav icons with `title`, thread list hidden, account row avatar only. Expanded = current 256px layout. Width transition `transition-[width]`.
- [ ] Persist + read `localStorage` guarded for SSR (init in `useEffect` to avoid hydration mismatch; default expanded).
- [ ] Section heading copy: "Chat History" per mockup (keep search toggle).
- [ ] Typecheck; verify toggle + persistence across reload.
- [ ] Commit: `feat(web): collapsible sidebar and Analytics destination`

### Task 5: Header — one settings popover

**Files:**
- Create: `frontend/components/shell/display-settings.tsx`
- Modify: `frontend/components/shell/workspace-header.tsx`; delete `frontend/components/shell/a11y-toolbar.tsx` after inlining what it owned (read the file first; its handlers move into the popover)

**Interfaces:**
- `DisplaySettings()` — gear/Aa trigger button opening an accessible popover (Radix `Dialog` styled as anchored popover, or a focus-trapped absolutely-positioned panel with `aria-expanded` + outside-click/Escape close — match whichever primitive `sheet.tsx` already uses): font-size stepper (1/1.25/1.5/1.75×), line-spacing select (normal/relaxed/loose), high-contrast switch, read-aloud switch — all via `usePreferences` (which PATCHes `/me/preferences` in live mode; verify that in `preferences-provider.tsx` and wire it if it only writes locally); footer link "All settings →" `/settings`.

**Steps:**

- [ ] Build the popover; replace `<A11yToolbar />` with `<DisplaySettings />` in the header; keep `AgentStatus` pill.
- [ ] Confirm `PATCH /me/preferences` fires in live mode when a control changes (network tab), and prefs survive reload via `GET /me`.
- [ ] Typecheck; commit: `feat(web): consolidate reading controls into a settings popover`

### Task 6: Chat surface to mockup

**Files:**
- Modify: `frontend/components/agent/greeting.tsx`, `conversation.tsx`, `composer.tsx`, `action-chips.tsx` (copy check only), `agent-workspace.tsx`

**Steps:**

- [ ] Greeting: large mascot left, right column "Hi {displayName || 'there'}! 👋" (display font, ~3xl) + "I'm EDU, your AI learning partner." + "How can I help you learn today?" muted lines; `usePreferences` supplies the name.
- [ ] Conversation: user messages right-aligned bubbles (`bg-surface-sunken` rounded-2xl), assistant rows left with small mascot avatar; assistant footer icon row (thumbs up/down, copy) only where handlers exist — copy-to-clipboard is implementable, thumbs are not backed by any endpoint ⇒ copy button only.
- [ ] Composer: rounded-2xl bordered container; inside bottom row: `+` (opens `/upload`), paperclip (same `/upload`, `title="Attach a PDF"`), material selector chip (existing), topic chip (existing), lime circular send button right. No mic/camera. Placeholder "Message EDU…". Footer line: "AI can make mistakes. Consider checking important information."
- [ ] Typecheck; visual check against mockup at desktop + 390px widths.
- [ ] Commit: `feat(web): restyle the chat surface to the new design`

### Task 7: Analytics screen (new)

**Files:**
- Create: `frontend/app/analytics/[materialId]/page.tsx`, `frontend/components/analytics/analytics-view.tsx`
- Modify: `frontend/components/ui/charts.tsx` only if a needed mark is missing (read it first — a line/spark chart and bars exist for progress; reuse)

**Interfaces:**
- Route mirrors `app/progress/[materialId]/page.tsx` pattern (server component passing `materialId` into a client view).
- Data: single `useProgressOverview(materialId)` (exists in `lib/hooks/use-progress.ts` — verify name, reuse).

**Steps:**

- [ ] Read the dataviz skill before chart code (required trigger), then build sections, all from `ProgressOverview`, in mockup order: (1) stat tiles — Quiz Accuracy `totals.accuracy` %, Responses `totals.responseCount`, Sets Completed `totals.practiceSetsCompleted`, Topics Mastered `count(masteryByTopic.band === 'strong')`; each tile shows `InsufficientData`-style dash when null. (2) Accuracy Trend line chart from `trend.points` (date → accuracy), direction chip from `trend.direction`, hidden behind `InsufficientData` when `insufficient_data`. (3) Weak Topics — `masteryByTopic` filtered `needs_attention`, horizontal bars of score. (4) Topic Mastery — donut of band counts (strong/developing/needs_attention/insufficient) + per-topic bars. No study-time, no streaks.
- [ ] Skeleton variant `stats` while pending; `ReconnectNote` on network failure.
- [ ] Typecheck; verify against live API and in backend-down state.
- [ ] Commit: `feat(web): add the Analytics screen from progress overview data`

### Task 8: Learning Plan restyle

**Files:**
- Modify: `frontend/components/plan/plan-view.tsx` (and `plan-screen.tsx` if layout lives there — read both first)

**Steps:**

- [ ] Header block "Your Learning Plan" + subtitle "Personalized study plan generated with EDU."; overview card: Goal = material title, overall progress ring = completed steps / total steps (SVG ring, existing chart idiom), estimated total minutes = sum of remaining `estimatedMinutes`. No target date, no streak, no weekly hours (not in API).
- [ ] Step list as rows: kind icon, title, description, estimated minutes, status chip (pending/active/completed/skipped); adaptation-inserted rows get the existing "added by EDU" affordance; keep complete/skip actions and the `lastAdaptation` explainer + revert button.
- [ ] "Up Next" card at bottom from `currentStepId` with primary "Start" button routing to the step's target (lesson `/study/:materialId?topic=…` or practice — follow existing target routing in this file).
- [ ] Typecheck; live + skeleton pass; commit: `feat(web): restyle the learning plan to the new design`

### Task 9: Progress restyle

**Files:**
- Modify: `frontend/components/progress/progress-view.tsx` (+ `progress-screen.tsx`, `finding-card.tsx` as needed — read first)

**Steps:**

- [ ] Layout per mockup: top stat row (Overall Progress ring = mean of non-null mastery scores; Topics Mastered `strong` count/total; Sets Completed; Accuracy) — only API-backed numbers; Recent Milestones timeline derived from real events (completed plan steps and `lastAdaptation`, newest first); Mastery by Topic bars (all topics, `InsufficientData` row state); EDU Recommendation card from `topFinding` (label, description, evidence link, dismiss + focused-practice CTA — existing finding-card behavior restyled).
- [ ] Typecheck; live + skeleton pass; commit: `feat(web): restyle progress to the new design`

### Task 10: Course Explorer restyle

**Files:**
- Modify: `frontend/components/explorer/explorer-view.tsx` (+ `cover.ts`)

**Steps:**

- [ ] "Explore Courses" heading + subtitle; search input filtering materials by title (client-side); card grid: generated cover (existing `cover.ts`), title, topic count + page count, progress bar = mean mastery score of its topics (from `listTopics`), "Open course" button → `/study/:id`. Upload card/CTA kept. No ratings/students/level chips.
- [ ] All-courses table section below grid (title, topics, progress) only if data adds value at ≥2 materials; otherwise grid only — decide in-code, single source of truth for rows.
- [ ] Typecheck; live + skeleton pass; commit: `feat(web): restyle course explorer to the new design`

### Task 11: Mobile tab bar

**Files:**
- Modify: `frontend/components/shell/nav-items.tsx`, `frontend/components/shell/mobile-tab-bar.tsx`

**Steps:**

- [ ] `mobileTabs`: Home `/`, Explore `/materials`, Plan `/plan/:id`, Analytics `/analytics/:id`, Progress `/progress/:id` (null-guard → `/materials` as today). More tab removed; `/more` stays routable for settings/about links; `isActive` maps `/settings|/about|/more` to no tab.
- [ ] Verify at 390px: five tabs, active states, Analytics reachable.
- [ ] Commit: `feat(web): mobile tabs match the new navigation`

### Task 12: Settings page calibration

**Files:**
- Modify: `frontend/components/settings/settings-view.tsx` (read first)

**Steps:**

- [ ] Restructure into standard grouped settings sections with card-per-group and row-per-setting (label left, control right): Profile (display name), Reading & Display (font scale, line spacing, readable font, high contrast, reduced motion), Read Aloud (enabled, rate), Data (low-data mode, clear conversation, delete material), About (AI disclosure link). Same `usePreferences`/endpoints underneath; PATCH on change.
- [ ] Typecheck; verify persistence via `GET /me` after reload.
- [ ] Commit: `feat(web): standard grouped settings page`

### Task 13: Final verification

**Steps:**

- [ ] `npm run typecheck` (frontend) clean; backend build/typecheck clean.
- [ ] Full manual matrix from Task 1 driven through the UI where screens exist (upload a real PDF end-to-end included).
- [ ] Backend-stopped pass: every screen skeleton + reconnect note; restart → hydrate.
- [ ] Desktop (≥1024px) and mobile (390px) visual pass against the three mockup images.
- [ ] Commit any stragglers; report results with evidence.
