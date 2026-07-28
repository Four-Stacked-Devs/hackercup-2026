# EducLM — Frontend Build Prompt

> Give this file to the agent/developer building the web app. It is written so you can build the entire product against mocks and switch to the real API by changing one environment variable. The data shapes here mirror `EducLM-BACKEND.md`; that file is authoritative if the two ever disagree.

---

## 0. Assumptions made (correct these before starting if wrong)

| # | Assumption | Change it here if wrong |
|---|---|---|
| 1 | Next.js 15, App Router, TypeScript strict, pnpm workspaces + Turborepo | — |
| 2 | Tailwind CSS v4 + shadcn/ui primitives, styled to the token system in §12 | — |
| 3 | TanStack Query for all server state; no Redux, no global store | — |
| 4 | MSW (Mock Service Worker) for mock mode, browser and node | — |
| 5 | Mobile-first. The spec's primary user studies on a phone, so the phone layout is the design, not a shrunk desktop | — |
| 6 | Anonymous device session — no login screen in the MVP | — |
| 7 | Web app only. No native shell. | — |

**Open question for the team:** the mockup is branded *Akses*, the spec is branded *EducLM*. This doc assumes **EducLM** as the product name. Pick one before the pitch.

---

## 1. What you are building

A mobile-first study workspace with four surfaces:

- **Upload** — put in a PDF module, watch it become a lesson.
- **Study** — read the accessible version, ask the agent, every answer citing a page.
- **Practice** — one question at a time, immediate source-grounded feedback.
- **Progress** — what you know, what you keep getting wrong, and what changed because of it.

The judged differentiator is not the chat. It is that the app can show *evidence*. Every insight on the Progress screen must be tappable down to the exact responses that produced it. Build that path first and build it well.

---

## 2. Non-goals for the MVP

No teacher/parent/admin views, no Classroom or Calendar, no leaderboards or social features, no multiple concurrent materials in the plan, no offline mode, no dark mode unless time allows (high-contrast mode is the accessibility requirement; dark mode is not).

---

## 3. Monorepo layout and your boundary

```
educlm/
├─ apps/
│  ├─ web/              ← YOU own this
│  │  ├─ app/
│  │  │  ├─ (onboarding)/upload/
│  │  │  ├─ study/[materialId]/
│  │  │  ├─ practice/[setId]/
│  │  │  ├─ progress/[materialId]/
│  │  │  ├─ settings/
│  │  │  └─ about/ai-use/
│  │  ├─ components/
│  │  ├─ lib/api/       typed client — the ONLY place fetch() appears
│  │  ├─ lib/hooks/     TanStack Query hooks
│  │  └─ mocks/         MSW browser worker setup
│  └─ api/              ← backend team owns, do not edit
├─ packages/
│  ├─ contracts/        ← backend owns. Zod schemas + TS types. IMPORT ONLY, never edit
│  └─ mocks/            ← YOU own. Fixtures + MSW handlers, validated against contracts
└─ turbo.json
```

### The working agreement

1. `packages/contracts` lands on day 1 from the backend team. Until then, do not hand-write types — wait or scaffold layout only.
2. Import types from `@educlm/contracts`. Never redeclare an API shape inside `apps/web`.
3. Every fixture in `packages/mocks` is parsed through its Zod schema in a test. If a fixture stops validating, the contract changed and you find out immediately instead of at integration time.
4. If a shape blocks you, ask the backend team to change the contract. Do not work around it locally — that is the bug that surfaces at 3am on demo night.

---

## 4. Mock mode — the part that makes concurrent work possible

One env var decides everything:

```
NEXT_PUBLIC_API_MODE=mock        # or "live"
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1
```

`lib/api/client.ts` is the single fetch wrapper. It reads `X-Device-Id` from localStorage, unwraps `{ data }`, throws a typed `ApiError` on `{ error }`. It does not know or care which mode it is in.

`mocks/browser.ts` starts the MSW worker only when `NEXT_PUBLIC_API_MODE === 'mock'`. MSW intercepts at the network layer, so the app code, the hooks, the loading states, and the error handling are all identical in both modes. **Switching to live is deleting nothing and changing one string.**

Requirements for the mock layer:

- Handlers live in `packages/mocks/handlers.ts` and cover every endpoint in §6.
- Artificial latency: 150–600ms random, 2500ms for upload and question generation. Building against instant responses produces UIs with no loading states.
- `?__mock=error` on any request forces that endpoint to return its realistic error, so you can build error states without editing code.
- Fixtures use the **same IDs as the backend seed** (`mat_demo_js`, `topic_conditionals`, and so on) so the demo looks identical either way.
- Upload is a state machine: `processing` for ~8 seconds, walking through the real ingestion stages, then `ready`. Do not shortcut it — the progress UI is part of the demo.

---

## 5. Types

Mirrored from `EducLM-BACKEND.md` §6. Import them, don't retype them.

```ts
type MaterialStatus     = 'uploaded' | 'processing' | 'ready' | 'failed';
type IngestionStage     = 'extracting' | 'chunking' | 'extracting_topics'
                        | 'embedding' | 'building_lessons' | 'done';
type Difficulty         = 'beginner' | 'intermediate' | 'advanced';
type MasteryBand        = 'insufficient_data' | 'needs_attention' | 'developing' | 'strong';
type Confidence         = 'none' | 'low' | 'medium' | 'high';
type PracticeSetKind    = 'diagnostic' | 'focused' | 'retry';
type PracticeSetStatus  = 'in_progress' | 'completed' | 'abandoned';
type PlanStepKind       = 'read' | 'practice' | 'review' | 'advance';
type PlanStepStatus     = 'pending' | 'active' | 'completed' | 'skipped';
type SectionKind        = 'text' | 'table' | 'equation' | 'figure_description';
type TrendDirection     = 'improving' | 'flat' | 'declining' | 'insufficient_data';

type ApiSuccess<T> = { data: T; meta?: { requestId: string; generatedAt: string } };
type ApiError = { error: { code: ApiErrorCode; message: string; details?: unknown; requestId: string } };
type ApiErrorCode =
  | 'VALIDATION_ERROR' | 'UNAUTHORIZED' | 'NOT_FOUND' | 'UNSUPPORTED_FILE'
  | 'NO_TEXT_LAYER' | 'FILE_TOO_LARGE' | 'MATERIAL_NOT_READY'
  | 'INSUFFICIENT_EVIDENCE' | 'RATE_LIMITED' | 'LLM_UNAVAILABLE' | 'INTERNAL_ERROR';

interface Citation { chunkId: string; page: number; sectionTitle: string | null; snippet: string }

interface Material {
  id: string; title: string; originalFilename: string;
  status: MaterialStatus; pageCount: number | null; topicCount: number;
  processing: { stage: IngestionStage; percent: number; message: string } | null;
  failure: { code: ApiErrorCode; message: string } | null;
  createdAt: string; updatedAt: string;
}

interface Topic {
  id: string; materialId: string; name: string; slug: string; summary: string;
  orderIndex: number; sourcePages: number[]; prerequisiteTopicIds: string[];
  questionCount: number; mastery: TopicMastery | null;
}

interface LessonSection {
  id: string; topicId: string; heading: string; level: 2 | 3;
  bodyMarkdown: string; orderIndex: number; sourcePages: number[];
  kind: SectionKind; needsReview: boolean;
}
interface Lesson {
  topicId: string; topicName: string; readingTimeMinutes: number;
  sections: LessonSection[]; generatedBy: string; generatedAt: string;
}

interface QuestionOption { id: string; label: 'A' | 'B' | 'C' | 'D'; text: string }
interface Question {
  id: string; materialId: string; topicId: string; topicName: string;
  stem: string; options: QuestionOption[]; difficulty: Difficulty; sourcePage: number;
}
interface QuestionFeedback {
  questionId: string; selectedOptionId: string; correctOptionId: string; isCorrect: boolean;
  explanationMarkdown: string; citation: Citation;
  misconception: { tag: string; label: string; description: string } | null;
  responseId: string;
}

interface PracticeSet {
  id: string; materialId: string; topicId: string | null; topicName: string | null;
  kind: PracticeSetKind; status: PracticeSetStatus; reason: string | null;
  questions: Question[]; answeredCount: number; createdAt: string; completedAt: string | null;
}
interface PracticeSetResult {
  setId: string; correctCount: number; total: number;
  byTopic: { topicId: string; topicName: string; correct: number; total: number }[];
  newFindings: MisconceptionFinding[]; planUpdated: boolean;
}

interface TopicMastery {
  topicId: string; topicName: string; band: MasteryBand;
  score: number | null; confidence: Confidence;
  correctCount: number; totalCount: number; lastAnsweredAt: string | null;
}

interface EvidenceItem {
  responseId: string; questionId: string; questionStem: string;
  selectedOptionLabel: string; selectedOptionText: string; correctOptionText: string;
  sourcePage: number; answeredAt: string;
}
interface MisconceptionFinding {
  id: string; topicId: string; topicName: string; tag: string;
  label: string; description: string; occurrences: number; windowSize: number;
  evidence: EvidenceItem[]; status: 'active' | 'resolved' | 'dismissed'; detectedAt: string;
}

interface PlanStep {
  id: string; kind: PlanStepKind; title: string; description: string;
  topicId: string | null;
  target: { type: 'lesson' | 'practice_set' | 'page'; id?: string; page?: number } | null;
  estimatedMinutes: number; status: PlanStepStatus; orderIndex: number;
  insertedByAdaptation: boolean;
}
interface LearningPlan {
  id: string; materialId: string; steps: PlanStep[]; currentStepId: string | null;
  lastAdaptation: {
    at: string; reason: string; triggeredByFindingId: string;
    previousStepTitle: string; newStepTitle: string;
  } | null;
}

interface ProgressOverview {
  materialId: string;
  masteryByTopic: TopicMastery[];            // already ranked strongest → weakest
  topFinding: MisconceptionFinding | null;
  plan: LearningPlan;
  trend: { direction: TrendDirection; points: { date: string; accuracy: number; responseCount: number }[] };
  totals: { responseCount: number; practiceSetsCompleted: number; accuracy: number | null };
}

interface AccessibilityPreferences {
  fontScale: 1 | 1.25 | 1.5 | 1.75;
  lineSpacing: 'normal' | 'relaxed' | 'loose';
  highContrast: boolean; readableFont: boolean; lowDataMode: boolean;
  readAloud: { enabled: boolean; rate: 0.75 | 1 | 1.25 | 1.5 };
  reducedMotion: boolean;
}

interface ChatMessage {
  id: string; role: 'user' | 'assistant';
  content: string; citations: Citation[]; createdAt: string;
}
```

Two things the API deliberately withholds — design around them, don't fight them:

- `Question` has **no** `correctOptionId` and **no** explanation. You get those from `QuestionFeedback` after submitting. So the answer reveal is always a server round-trip, and the feedback panel is a separate render state, not a client-side check.
- `QuestionOption` has no misconception tag. Misconceptions only ever appear as findings on Progress or in feedback.

---

## 6. Endpoints you will call

Base `/api/v1`, header `X-Device-Id`.

| Screen | Call | Notes |
|---|---|---|
| Upload | `POST /materials` (multipart) | 202, returns `processing` |
| Upload | `GET /materials/:id/status` | poll 1.5s until `ready` or `failed` |
| Study | `GET /materials/:id/topics` | left nav / topic sheet |
| Study | `GET /materials/:id/lesson?topicId=` | the accessible lesson |
| Study | `GET /materials/:id/pages/:page` | original page, for "compare with source" |
| Study | `POST /materials/:id/chat` | SSE stream |
| Study | `GET /materials/:id/chat/messages` | history on mount |
| Practice | `POST /practice/sets` | `{ materialId, kind, topicId?, count? }` |
| Practice | `GET /practice/sets/:id` | resume |
| Practice | `POST /practice/sets/:id/responses` | → `QuestionFeedback` |
| Practice | `POST /practice/sets/:id/complete` | → `PracticeSetResult` |
| Progress | `GET /progress/overview?materialId=` | the whole screen in one call |
| Progress | `GET /progress/findings/:id` | evidence drill-down |
| Progress | `POST /progress/findings/:id/dismiss` | |
| Progress | `GET /plan?materialId=` | |
| Progress | `POST /plan/steps/:id/complete` · `/skip` | |
| Progress | `POST /plan/revert-adaptation` | `{ materialId }` |
| Settings | `GET /me` · `PATCH /me/preferences` | |
| About | `GET /meta/ai-disclosure` | renders the AI-use page |

SSE events on chat: `token` → `{ text }`, `citations` → `{ citations }`, `done` → `{ message }`, `error` → `{ code, message }`. Render tokens as they arrive; citations land before `done`, so source chips appear just as the answer finishes.

### Query keys

```ts
['materials']
['material', id]
['material-status', id]          // refetchInterval 1500 while processing
['topics', materialId]
['lesson', materialId, topicId]
['chat', materialId]
['practice-set', setId]
['progress', materialId]
['finding', findingId]
['plan', materialId]
['me']
```

After `POST /practice/sets/:id/complete`, invalidate `['progress']` and `['plan']`. That is what makes the plan visibly change in front of the judges.

---

## 7. Screens

### Upload / onboarding — `/upload`

Empty state is an invitation, not a shrug: a large drop target, "Add your own material," and a line about what happens next. Accept one PDF, ≤20 MB.

While processing, show the real stages with plain-language labels: reading the pages → finding the topics → building the lesson. Not a spinner. This is where the judge first sees that something is actually happening. Estimated time under the bar.

Errors are specific and actionable. `NO_TEXT_LAYER`: "This PDF is a scanned image, so there's no text to read. Try a file where you can select the text." Include a "Use the sample module" escape hatch that loads `mat_demo_js` — this is your demo insurance if a live upload fails on stage.

### Study — `/study/[materialId]`

Layout: the material is the centre of the screen. The agent supports it. Do not build a chat app with a document sidebar; build a reader with an assistant.

- **Mobile:** lesson fills the screen. Topic list opens as a bottom sheet. Agent opens as a bottom sheet at ~70% height with the lesson still visible above it.
- **Desktop:** three columns — topics (240px) · lesson (flex) · agent (380px).

Lesson rendering: markdown sections, each with a subtle page reference (`p. 27`) that opens the original page in a sheet. Sections with `needsReview: true` get a quiet inline note — "Converted from a table. Check the original." — not a scary warning banner. Honesty at conversational volume.

Accessibility controls live in a persistent toolbar, not buried in settings: text size, spacing, high contrast, read aloud. Changing text size must reflow the lesson immediately, with no layout break at 1.75×. Test this; it is 10% of the score.

Read-aloud uses the Web Speech API on the current section, with visible play/pause and the sentence being read highlighted.

Agent panel: message list, citation chips under each assistant message (`p. 27 →` opens the source sheet), and four quick actions above the input — Explain simply · Give an example · Summarise this section · Make practice questions. "Make practice questions" creates a focused set and routes to Practice.

Low-data mode: skip page images, text-only source view, no non-essential fetches.

### Practice — `/practice/[setId]`

One question per screen. Nothing else competing for attention.

Header: topic name, difficulty chip, `3 of 5` progress. Body: stem, then four large tap targets (minimum 48px, full width on mobile). Selecting highlights; a separate Check button submits. Never auto-submit on tap — accidental answers pollute the very data the analytics engine depends on.

After submit, the feedback panel slides up: correct/incorrect, the explanation, and the source citation as a tappable chip. When `misconception` is present, name it plainly — "This mixes up assignment with comparison" — and keep it descriptive, never scolding. Then Next question.

On completion, show `PracticeSetResult`: score, per-topic breakdown, and if `newFindings.length > 0` or `planUpdated`, a card saying what changed with a link straight to Progress. That handoff is the demo's hinge.

Loading state while a set generates: a real skeleton and a line about building questions from the material. It can take a few seconds.

### Progress — `/progress/[materialId]`

The most important screen. Order matters — it goes weakness first, evidence second, action third. Resist the urge to open with charts.

1. **Topic mastery** — ranked list, strongest to weakest. Each row: topic name, band as a labelled pill, and `4/6 correct`. Bands must be distinguishable without colour: pair every colour with a word. Rows with `band: 'insufficient_data'` read "Not enough data yet" with no score and no fake bar.

2. **What keeps tripping you up** — `topFinding`, in the student's language: "You confused assignment with comparison in 3 of your last 5 answers." Under it, a **Show the evidence** control that expands `EvidenceItem[]`: each question, the option they picked, the correct one, and the source page. This is the moment the whole product argument lands. Make the expansion fast and make the evidence readable. Also offer "This isn't right" → dismiss the finding.

3. **What changed** — `plan.lastAdaptation`, stated plainly: what the next step was, what it is now, and why. Steps with `insertedByAdaptation: true` get a marker in the plan list. Include "Go back to the original plan" → `revert-adaptation`. Students who cannot say no to the system do not trust it.

4. **Next step** — the current step as one prominent action. Start focused practice, or open the lesson section.

5. **Trend** — last. One small line chart, or a plain sentence when `direction: 'insufficient_data'`. Do not add a second chart. The spec says the goal is to help the student act, not to look analytical.

### Settings — `/settings`

Accessibility preferences (mirroring the study toolbar), plus data controls: delete a material, delete everything. Deletion asks once, then actually deletes.

### AI use — `/about/ai-use`

Renders `GET /meta/ai-disclosure`: which models do what, and the third-party libraries used. Link it from the footer. The competition requires documented AI usage; having it live in the app is a cheap point and an honest one.

---

## 8. States you must build for every screen

Loading (skeletons matching final layout, not spinners) · empty · error with a retry that actually retries · **insufficient data**. That last one is specific to this product and appears in at least three places: topic rows, the finding card, the trend. The copy is "Not enough data yet" plus what would fix it — "Answer a few more questions on this topic." Never render a zero, a 0% bar, or a guess.

---

## 9. Accessibility bar

This product's pitch is accessibility, so the app itself has to pass. Non-negotiable:

- WCAG AA contrast throughout; high-contrast mode goes beyond it.
- Full keyboard operation with a visible focus ring. Practice options are radios in a `radiogroup`, arrow-key navigable.
- Semantic headings, real landmarks, correct list semantics.
- `aria-live="polite"` on feedback panels and streaming agent messages.
- `prefers-reduced-motion` respected, plus the manual `reducedMotion` preference.
- Font scale to 1.75× with no clipping, no overlap, no horizontal scroll at 320px.
- Every icon-only button has an accessible name.
- Read-aloud never traps focus and stops on navigation.

Run axe on Study, Practice, and Progress before you call anything done.

---

## 10. Performance

- Target under 3s to interactive on a mid-range Android over 4G. This is the actual user.
- Route-level code splitting; the PDF source viewer loads on demand only.
- Optimistic UI on answer selection; the submit round-trip is the only wait.
- `lowDataMode` disables page images and prefetching.
- Keep the bundle honest — one heavyweight chart library for a single line chart is not a trade worth making. A small SVG line is fine.

---

## 11. Design direction

Ground this in the existing mockup rather than inventing a new identity. The mockup runs a confident blue as the primary with warm red and yellow accents, generous white space, and rounded cards — a palette that reads Filipino without being a flag pastiche.

**Palette** (define as CSS custom properties, light mode plus a high-contrast override):

| Token | Value | Use |
|---|---|---|
| `--ink` | `#0F172A` | body text |
| `--ink-muted` | `#475569` | secondary text, captions |
| `--primary` | `#1E4FD8` | actions, active nav, links |
| `--primary-soft` | `#EAF0FF` | selected states, chips |
| `--surface` | `#FFFFFF` | cards |
| `--canvas` | `#F7F9FC` | page background |
| `--strong` | `#0E9F6E` | mastery: strong |
| `--developing` | `#D9A404` | mastery: developing |
| `--attention` | `#DC2626` | mastery: needs attention |
| `--neutral` | `#94A3B8` | insufficient data |

Mastery colour is **always** paired with a word. Colour alone never carries meaning here.

**Type:** one characterful but highly legible sans for headings and UI — Plus Jakarta Sans or General Sans — and a system stack for body so long lesson reading stays fast and familiar. Scale: 32 / 24 / 20 / 16 / 14 / 12, everything multiplied by `fontScale`. Lesson body caps at 68 characters per line.

**Signature element:** the *evidence trail*. When a student expands a finding, the evidence items unfold as a connected vertical thread — each response linked down to the source page it came from, ending at the plan change it caused. It is the one place to spend visual boldness, because it is the one thing no competitor's demo will have. Everything else stays quiet and disciplined.

**Motion:** restrained. Sheet transitions, the feedback panel slide, and the evidence trail unfold. Nothing else animates.

**Copy:** sentence case, active voice, plain verbs. A button that says "Start focused practice" leads to a screen headed "Focused practice." Errors explain what happened and what to do. The system never scolds — "You confused assignment with comparison," not "You got this wrong again."

---

## 12. Build order

1. Layout shell, navigation, tokens, accessibility toolbar with font scaling working end to end
2. `packages/mocks` with fixtures + MSW handlers for every endpoint (**do this before any screen** — every screen after it is real work, not throwaway)
3. Upload flow with the full processing state machine
4. Study screen: lesson rendering, topic nav, source sheet
5. Practice loop: question → submit → feedback → next → result
6. Progress screen, evidence trail first
7. Agent panel with SSE streaming and citation chips
8. Settings, AI-use page, delete flows
9. Accessibility audit, 320px pass, 1.75× pass
10. Flip `NEXT_PUBLIC_API_MODE=live` and fix whatever surfaces

Step 10 should be boring. If it isn't, the contract discipline slipped somewhere in steps 2–9.

## 13. Done means

- [ ] Every screen works in mock mode with no backend running
- [ ] Every screen works in live mode with only the env var changed
- [ ] No `fetch` call outside `lib/api/`
- [ ] No API type declared outside `@educlm/contracts`
- [ ] Loading, empty, error, and insufficient-data states exist everywhere they can occur
- [ ] Evidence trail expands from a finding to the responses to the source page to the plan change
- [ ] Font scale 1.75× and 320px width both hold on all four screens
- [ ] axe reports no critical issues on Study, Practice, Progress
- [ ] The demo path in `EducLM-BACKEND.md` §12 runs start to finish without a reload

---

## 14. The demo path this UI has to serve

Rehearse against this. It is the sequence from the spec, and every screen above exists to make it work:

Open **Progress** → "EducLM found Conditionals is your weakest topic" → *"But how does it know?"* → expand the evidence trail → same wrong option, three times → the misconception, named → the source page that explains it → the plan, already changed, with the reason → start the focused practice → show the same material at 1.5× text with read-aloud running.

If any step of that stalls, fix it before adding a feature.
