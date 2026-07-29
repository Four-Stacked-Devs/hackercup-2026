# Live backend integration + UI fixes — design

Date: 2026-07-29 · Branch: `refactor/ui`

## Problem

The app currently runs in mock mode (`NEXT_PUBLIC_API_MODE=mock`): chat answers
are canned seed text from `frontend/mocks/store.ts`, which reads as "hardcoded
responses". Three UI defects compound it: the open conversation is titled with
the hardcoded fallback "All messages", the header's four accessibility buttons
(Aa 1×, Normal, Contrast, Read aloud) don't read as a standard settings
control, and the sidebar collapse button is rendered permanently disabled.

## Goal

Run the frontend fully against the real API (`backend/apps/api`) — every
endpoint in `EducLM-BACKEND.md` exercised and working — and fix the three UI
defects. Mock mode remains available behind the env flag; it is no longer the
default.

## 1. Full live integration

Both sides already implement the contract (`@educlm/contracts` is shared;
`frontend/lib/api/endpoints.ts` has one typed function per endpoint;
`backend/apps/api/src/routes/*` serves them). The work is wiring, seeding,
verification, and fixing whatever the live path exposes.

Steps:

1. Backend boot: copy `backend/apps/api/.env.example` → `.env` (zero-config:
   embedded PGlite, deterministic stub model, local embeddings). Install,
   migrate, seed. The seed must produce the shared fixture ids: material
   `mat_demo_js`, device `demo-device`, the active
   `assignment_vs_comparison` finding, and the pre-adapted plan.
2. Frontend switch: `NEXT_PUBLIC_API_MODE=live` in `frontend/.env.local`.
   `NEXT_PUBLIC_API_BASE_URL` stays `http://localhost:4000/api/v1`.
3. Verification matrix — every endpoint, via the UI where a screen exists,
   via `curl` (with `X-Device-Id`) where not:

   | Group | Endpoints | Driven by |
   |---|---|---|
   | Materials | POST upload (202), GET list/get/status, DELETE, topics, lesson, pages/:page | Library + Materials screens, upload flow, status polling |
   | Chat | POST chat (SSE: token → citations → done), GET messages, DELETE chat | Agent workspace |
   | Practice | POST sets, GET set, POST responses, POST complete | Practice flow |
   | Progress | overview, topics/:id, findings/:id, findings/:id/dismiss | Progress screen |
   | Plan | GET plan, steps complete/skip, revert-adaptation | Learning Plan screen |
   | Me | GET /me, PATCH /me/preferences | Settings + header popover |
   | Meta | ai-disclosure, health | Disclosure page, "Agent online" pill |

4. Fix any live-mode mismatch (schema parse failure, missing field, wrong
   status code). The backend doc's contract wins; fixes land wherever the
   deviation is.

Out of scope: deleting the MSW mock layer; backend feature work beyond
contract-conformance fixes; deployment.

## 2. Conversation titles

- `frontend/lib/thread-index.ts` additionally records, per thread, a derived
  title: the first user message, whitespace-flattened, truncated to ~40 chars.
- `frontend/lib/threads.ts` title precedence: topic name → recorded derived
  title → `"New chat"`. The `"All messages"` fallback is removed from the
  sidebar row and the workspace header.
- Pure-function change, verified by the manual end-to-end pass (no vitest).

## 3. Header settings control

- Replace the four inline header buttons with a single settings button opening
  a Radix popover: font-size stepper, line-spacing toggle, high-contrast
  toggle, read-aloud toggle, and an "All settings →" link to `/settings`.
- State stays in `usePreferences`; in live mode changes persist via
  `PATCH /me/preferences`. The "Agent online" pill is unchanged.

## 4. Sidebar collapse

- The toggle in `frontend/components/shell/sidebar.tsx` becomes functional:
  collapses the 256px rail to a ~64px icon rail (mascot, expand button,
  New Chat icon, nav icons with `title` tooltips; thread list and account text
  hidden, avatar kept).
- Persisted in `localStorage`; `aria-expanded` on the toggle; default
  expanded; desktop only (mobile keeps the tab bar).

## 5. New UI (from the provided mockups)

Restyle the app to the mockup design — desktop and mobile — across the five
screens: Chat/Home, Course Explorer, Learning Plan, Analytics, Progress.

- **Real data only.** Elements with no backing in the API contract are
  dropped, not faked: course ratings, student counts, streaks, study-time
  totals/trend, mic and camera composer buttons. Everything rendered comes
  from the live endpoints (mastery, plan, findings, accuracy trend, chat).
- Chat/Home: mascot greeting block ("Hi {displayName}"), user bubbles right /
  assistant rows left, action chips under answers, thread history in the
  sidebar with per-thread titles, share/… header actions only where they have
  behavior (otherwise omitted).
- Course Explorer: material cards grid built from `GET /materials` +
  `/topics` (title, topic count, progress from mastery); no fake catalog.
- Learning Plan: plan overview header (goal = material title, overall
  progress ring computed from step completion), weekly-style step list from
  `GET /plan`, "Up next" card from `currentStepId`.
- Analytics: new screen fed entirely by `GET /progress/overview` — accuracy
  stat tiles, trend chart from `trend.points`, weak topics from
  `masteryByTopic` (needs_attention first), topic mastery donut/bars.
- Progress: overall progress, milestones from plan adaptations/completions,
  mastery-by-topic bars, EDU recommendation card from `topFinding`.
- Mobile: bottom tab bar becomes Home / Explore / Plan / Analytics /
  Progress, matching the mockups.
- Sidebar (desktop): dark rail per mockup with New Chat, five nav items,
  searchable chat history, account row — collapse per section 4.

## Error handling and loading

- **Backend down → skeleton UI.** Every screen renders skeleton placeholders
  (shimmering blocks matching its layout) while queries are pending; if the
  API is unreachable, screens stay in skeleton state with a quiet "Trying to
  reconnect" note and the header pill shows offline. React Query retries in
  the background and the screen hydrates when the API returns. No hard error
  walls, no silent fallback to mock.
- Chat send failures keep the existing inline error path.

## Testing

- No vitest. Verification is: `npm run typecheck` (frontend), backend build,
  and a manual end-to-end drive of the full verification matrix against the
  running pair (frontend :3000, API :4000), including one real PDF upload,
  plus a backend-stopped pass to confirm every screen shows skeletons.

## Done means

- [ ] Frontend runs live by default; chat streams real answers with citations
- [ ] Every endpoint in the matrix verified against the live API
- [ ] New conversations titled from the first message; no "All messages"
- [ ] Header has one standard settings popover persisting via PATCH /me/preferences
- [ ] Sidebar collapse toggles, persists, and is accessible
- [ ] All five screens match the new mockups, desktop and mobile, real data only
- [ ] With the backend stopped, every screen shows skeleton UI, not errors
- [ ] Typecheck passes; manual matrix verified
