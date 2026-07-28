# EducLM — web app

The student-facing workspace: upload a module, read it, question it, practise it, and see the
evidence behind everything EducLM claims about your learning.

Built against `EducLM-FRONTEND.md`, in the EducLM design system: a white workspace, a near-black
navy rail (a five-tab bottom bar on a phone), one bright lime accent, thin grey rules, small
radii and compact black type. Home is the agent conversation; the plan, practice, progress and
the material itself open from it as panels or full workspaces.

## Running it

```bash
npm install          # links @educlm/contracts from ../backend/packages/contracts
npm run contracts    # builds that package (only needed once, or after a contract change)
npm run dev          # http://localhost:3000
```

Nothing else has to be running. `NEXT_PUBLIC_API_MODE=mock` (the default in `.env.local`) starts
Mock Service Worker, which answers every endpoint from a fixture generated out of the backend's
own demo seed — same ids, same text, same answer history.

### Switching to the real API

```bash
# .env.local
NEXT_PUBLIC_API_MODE=live
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1
```

That is the whole change. MSW intercepts at the network layer, so hooks, loading states and error
handling are identical in both modes. `NEXT_PUBLIC_DEFAULT_DEVICE_ID` defaults to `demo-device`,
the device the backend seed writes to, so live mode opens on the same demo material.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` / `start` | production build and server |
| `npm run typecheck` | `tsc --noEmit`, strict |
| `npm test` | validates every mock fixture against the published Zod contracts, and asserts the section 14 demo numbers |
| `npm run fixtures` | regenerates `mocks/fixtures/seed.json` from the backend seed |
| `npm run contracts` | builds `@educlm/contracts` |
| `npm run mascot` | regenerates the EDU sprites in `public/mascot` from `public/Asset` |

## The design system

| Token | Value | Where it appears |
|---|---|---|
| `--lime` | `#c4f135` | primary actions, active navigation, progress, selected controls |
| `--nav` | `#14171c` | desktop rail, mobile tab bar |
| `--ink` | `#0b0d10` | all body copy |
| `--line` | `#e5e7eb` | every border, 1px |
| `--surface` / `--canvas` | `#ffffff` | the workspace is white throughout |
| `--strong` / `--developing` / `--attention` / `--neutral` | green / blue / red / grey | status only, always beside its word |

Radii are 4–10px, the card shadow is a single 1px hairline, and the type scale tops out at
1.75rem — headings are small and heavy rather than large and light. Lime is never text on white;
it is a background, a bar or a rule, and near-black sits on top of it.

### EDU

The mascot is the delivered artwork in `public/Asset`. `npm run mascot` turns those four 1.5 MB
studio renders into web sprites in `public/mascot` — background and drop shadow removed by a
border flood fill that stops at EDU's own outline (so the white of the eye and the pencil ferrule
survive), edges feathered and un-premultiplied so no pale halo is left, then cropped square and
written at 256px and 96px. 1.5 MB becomes 12 KB at the size a chat avatar actually needs.

`components/brand/edu-mascot.tsx` is the only component that references the artwork, and the four
expressions each mean something:

| Mood | Where it appears |
|---|---|
| `default` | the brand mark, greetings, empty states |
| `thinking` | EDU is working — streaming an answer, building a practice set |
| `letsgo` | encouragement — a correct answer, a finished set |
| `wary` | a caution — a misconception, a weak topic |

EDU appears only where the agent speaks for itself. Never as decoration.

## How it is put together

```
app/                      routes: / (agent), study, practice, progress, plan, library,
                          upload, more, settings, about/ai-use
components/
  brand/                  the EDU mascot and the tip strip it speaks through
  agent/                  conversation, composer, generated panels
  study/  practice/       the reader and the one-question-per-screen loop
  progress/  plan/        mastery, the evidence trail, the plan and its adaptations
  shell/                  navy rail, mobile tab bar, header, reading controls
  source/                 the shared "open the original page" sheet
  ui/                     buttons, cards, chips, sheets, charts, icons
lib/api/                  the only place fetch() appears — client, endpoints, SSE
lib/hooks/                TanStack Query hooks, one per surface
mocks/                    MSW handlers, the in-memory store, the analytics it mirrors
```

Rules the code holds to:

- **No API type is declared here.** Everything comes from `@educlm/contracts`, and every response
  is parsed through the schema the backend publishes, so contract drift fails loudly and named.
- **No `fetch` outside `lib/api/`.**
- **Colour never carries meaning alone.** A mastery band is always a word; `MasteryPill` is the
  only component that renders one.
- **Never render a zero for missing data.** "Not enough data yet", plus the thing that would fix
  it, appears on topic rows, the finding card and the trend.

## The mock is not a stub

`mocks/store.ts` re-implements the backend's analytics rules — recency-weighted mastery, the
five-response misconception window, the plan adaptation — over its own in-memory responses. So
answering questions in mock mode really does move a band, really does raise a finding, and really
does change the plan. A mock that computed something friendlier would rehearse the wrong demo.

`?__mock=error` on any request forces that endpoint to return its realistic error, which is how
the error states were built. Uploading a file with `scan` in its name fails with `NO_TEXT_LAYER`.

## Accessibility

Reading controls (text size, line spacing, high contrast, read aloud) live in the header on every
screen, not in settings, and write custom properties on `<html>` — a change reflows the page
without re-rendering the tree.

Verified in-browser: axe reports no violations on Study, Practice (including the feedback panel)
and Progress (including the expanded evidence trail); no horizontal scrolling at 320px, 390px,
768px or 1440px, including at 1.75× text; every tab target is at least 44px; keyboard-operable
practice options with a visible focus ring.

The phone layout is its own design rather than a squeezed desktop: the plan is a table on `lg`
and up and stacked rows below it, the workspace panels become bottom sheets, and the five tabs
(Home, Learn, Practice, Progress, More) carry the navigation the rail carries on desktop.
