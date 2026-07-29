# EducLM — Backend

Upload a PDF module, get an accessible lesson, a grounded tutor, and a learning
plan that adapts to the mistakes you actually make — and tells you why it changed.

The authoritative contract for this API is [`EducLM-BACKEND.md`](./EducLM-BACKEND.md).
This README covers how to run it and where the implementation departs from that document.

---

## Quick start (no accounts, no keys, no Docker)

```bash
pnpm install
pnpm db:seed     # builds the demo material in an embedded database
pnpm dev
```

The API is on `http://localhost:4000`. That is the whole setup.

With no configuration the server runs on **PGlite** — a real Postgres compiled to
WASM, with `pgvector` — and a deterministic stub in place of a language model.
Same schema, same migrations, same queries as production; there is no separate
fixture layer to drift out of sync.

Every request needs a device id header. The seeded demo student is `demo-device`:

```bash
curl http://localhost:4000/api/v1/progress/overview?materialId=mat_demo_js \
  -H "X-Device-Id: demo-device"
```

`GET /api/v1/meta/health` reports which mode you are in.

---

## Going live

Both steps are optional and independent — turn on either one alone.

Put your settings in `backend/.env` (`cp .env.example .env`). `backend/apps/api/.env`
also works and wins per key if both exist. The server prints which file it read
at boot — check that line first if a setting seems to be ignored.

### 1. Supabase (free tier)

1. Create a project at [supabase.com](https://supabase.com). Save the database
   password — it is shown once.
2. Click **Connect** (top right) → **ORMs** tab → **Prisma**. Copy the
   **session pooler** string (port `5432`) into **both** variables in `backend/.env`:

```bash
DATABASE_URL="postgresql://postgres.PROJECTREF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres"
DIRECT_URL="postgresql://postgres.PROJECTREF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres"
```

Identical values are correct. Prisma needs two variables because pooled
connections cannot run migrations — `DATABASE_URL` serves app queries and
`DIRECT_URL` is used only by `prisma migrate`, which issues DDL. Session mode
does both, so one string covers it.

`PASSWORD` is the **database** password from project creation, not your Supabase
account password.

Two traps: do not use the **transaction** pooler (`6543`) for `DIRECT_URL` — it
cannot run DDL. And do not use `db.PROJECT.supabase.co` — IPv6-only without the
paid IPv4 add-on, so it times out on most home networks.

Deploying to serverless later? Switch `DATABASE_URL` to `6543` and append
`?pgbouncer=true&connection_limit=1`; leave `DIRECT_URL` on `5432`.

```bash
pnpm db:setup    # migrate deploy + seed
```

### 2. Groq (free tier)

Get a key at [console.groq.com/keys](https://console.groq.com/keys) — no card required.

```bash
LLM_PROVIDER=groq
LLM_API_KEY=gsk_...
LLM_MODEL=llama-3.3-70b-versatile
```

Without a key the pipeline still runs end to end: topics come from the document's
own headings, lessons from a structural reformat, questions from cloze extraction.
Everything stays grounded in the source text — the difference is polish, not
whether it works.

Embeddings never need a key. `bge-small-en-v1.5` runs in-process via ONNX;
the ~130 MB model downloads once into `./.models`.

### 3. Deploying to Render (free tier)

`render.yaml` is a Blueprint — Dashboard → **New** → **Blueprint** → pick this
repo, and Render creates the service and prompts for the three secrets it does
not store in git (`DATABASE_URL`, `LLM_API_KEY`, `CORS_ORIGIN`).

Run migrations from your machine *first* (§1 above). The deployed service then
never needs DDL rights, and `DIRECT_URL` is deliberately absent from its
environment.

Five things in that file are load-bearing, and each one fails confusingly if
changed:

- **`npm install -g pnpm@11.17.0`, not `corepack enable`** — corepack writes its
  shims into `/usr/bin`, which is read-only on Render's image. It dies with
  `EROFS: read-only file system, unlink '/usr/bin/pnpm'`.
- **`backend/.node-version`** — root `package.json` says `engines: ">=20"`, and
  Render resolves that open range to the newest Node released, which is not a
  version this has been tested on. Precedence is `NODE_VERSION` env var, then
  `.node-version`, then `engines`.
- **`pnpm install --prod=false`** — Render sets `NODE_ENV=production`, which
  makes pnpm skip `devDependencies`. `typescript`, `tsx` and the `prisma` CLI
  all live there.
- **`EMBEDDING_DTYPE=q8`** — the free instance is 512 MB. fp32 weights are
  ~130 MB resident alongside Node, Fastify, Prisma and `unpdf` page buffers.
- **`pnpm --filter` in both `buildCommand` and `startCommand`** — it sets the
  working directory to `apps/api`, and `EMBEDDING_CACHE_DIR` is the relative
  `./.models`. A different cwd at start silently misses what the build cached
  and re-downloads the model on every boot.

Free instances sleep after 15 minutes idle and cold-start in 30–60s; at 0.1 CPU,
ingest demo material ahead of time rather than live. `.uploads/` is ephemeral,
which `getFile` tolerates because it is only read during ingestion — but a
restart between upload and ingestion strands that material.

---

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Run the API with reload |
| `pnpm test` | Analytics unit tests (90 tests) |
| `pnpm typecheck` | Strict typecheck across the workspace |
| `pnpm build` | Compile contracts + API |
| `pnpm db:seed` | Rebuild the section 12 demo data |
| `pnpm db:migrate` | Create a migration (needs `DIRECT_URL`) |
| `pnpm db:studio` | Browse the data |

`SEED_SKIP_EMBEDDINGS=1 pnpm db:seed` skips the model download.

---

## Layout

```
apps/api/src/
├─ routes/       thin HTTP handlers, one file per resource
├─ services/     impure orchestration (DB + engine + LLM)
├─ modules/
│  ├─ ingestion/ extract → chunk → topics → embed → lessons
│  ├─ agent/     retrieval, grounded chat, small talk, question generation
│  └─ analytics/ PURE functions. no I/O, no LLM, no clock
├─ db/           prisma client (Supabase or PGlite)
├─ jobs/         in-process ingestion queue
└─ lib/          llm, embeddings, pdf, storage, errors, serializers

packages/contracts/   Zod schemas + inferred types + route constants
```

### The rule that defines this project

The analytics engine never asks a language model what a student is weak at.
Mastery, misconceptions, trend and adaptation are computed by pure functions from
logged responses. The LLM may *phrase* a finding; it never *produces* one.

This is enforced, not just documented: `test/analytics/purity.test.ts` fails the
build if anything in `modules/analytics/` imports Prisma, `fetch`, an AI SDK, the
filesystem, or reads the clock. When a judge asks "how does it know?", the answer
is `computeTopicMastery` and `detectFindingsForTopic` — functions you can point at.

Walk the demo backwards: `GET /progress/overview` → `topFinding` → its `evidence`
array → the exact questions, the option chosen, and the source page.

---

## Deviations from the spec

Agreed before implementation. `EducLM-BACKEND.md` has been amended to match, so
the two documents do not disagree.

| # | Spec said | Built | Why |
|---|---|---|---|
| 1 | `text-embedding-3-small`, `vector(1536)` | `bge-small-en-v1.5`, **`vector(384)`**, run locally | Zero-cost constraint. Groq serves no embeddings endpoint and OpenAI is not free. This model needs no key and no network at query time. Its output is 384-dimensional, and a pgvector column's dimension is fixed at migration time. |
| 2 | LLM: Anthropic or OpenAI | **Groq** (free tier), provider-swappable, plus a deterministic stub | Zero-cost constraint. OpenAI and Anthropic adapters are still wired and selectable by env var. |
| 3 | `prisma-client-js` generator | `prisma-client` with explicit `output` | `prisma-client-js` is deprecated in Prisma 7. |
| 4 | `datasource { url = env(...) }` | URLs in `prisma.config.ts`; client uses a driver adapter | Prisma 7 rejects connection URLs in the schema. |
| 5 | — | `DIRECT_URL` added | Supabase's transaction pooler cannot execute DDL. |
| 6 | — | `PageText` model | `GET /materials/:id/pages/:page` must return the *original* page text; chunks overlap and cannot reconstruct it. |
| 7 | — | `MisconceptionTag` model | Section 9 requires a stored controlled vocabulary; findings read their label and description from it. |
| 8 | — | `Material.contentHash` | Section 8 requires an identical re-upload to reuse the previous extraction. |
| 9 | — | `ResponseInput.questionDistractorTags` | Finding resolution is defined as "3 consecutive correct answers on questions that carried the tag as a distractor" — impossible to evaluate without knowing which questions those were. |
| 10 | — | PGlite fallback when `DATABASE_URL` is unset | Makes the API runnable with zero configuration without introducing a second data path. |
| 11 | Trend thirds | Thirds taken over responses, not daily buckets | The spec's own floor ("fewer than 6 total responses") is expressed in responses, and a bucket split collapses to one bucket when a student practises in a single sitting. |
| 12 | `revert-adaptation` removes inserted steps | Removes *pending and active* inserted steps; keeps completed ones | Deleting work the student actually finished would erase real history from their progress view. |
| 13 | Every chat turn is retrieved and grounded | Greetings and "what can you do" answer conversationally, with no retrieval and no citations | "hi" put through the grounded prompt replies "the passages do not cover that", which reads as broken. Classification is anchored to the whole message, so anything carrying a real question ("what can you do with arrays?") stays on the grounded path. |

Not built, by design: `packages/mocks` (the frontend team owns it) and `apps/web`.

---

## Verification

Run against a clean checkout on Windows, Node 22, in fully-offline mode.

| Check | Result |
|---|---|
| Analytics unit tests | **90 passing** — empty input, 1–2 responses, exactly 3, tag ties, resolution, adaptation guards, revert round-trip, purity |
| API smoke tests, all endpoint groups | **56 passing** |
| Real PDF upload → ready | **22 passing**, 4-page PDF ingested in ~0.5s |
| Semantic retrieval (queries sharing no keywords with the source) | **4/4 cited the correct pages** |
| Local embeddings | identical 1.00, paraphrase 0.97, same-topic 0.73, unrelated 0.29 |
| Seed matches section 12 | Variables `strong`, Functions `developing`, Conditionals `needs_attention` with `assignment_vs_comparison` at 3 occurrences in a 5-response window |
| Migration SQL | Applied cleanly, including `CREATE EXTENSION vector` and the ivfflat index |

The seed *computes* those bands with the real analytics functions and throws if
they ever stop matching, so the demo cannot quietly drift from what section 12
promises.

**Verified against live Supabase on 2026-07-29.** `prisma migrate deploy` and the
seed both ran against the project in `ap-southeast-1`: pgvector 0.8.2,
`Chunk.embedding vector(384)`, the ivfflat index, all 16 tables, and the section
12 bands reproduced. The running server was then checked on the *other*
connection path — migrations use `DIRECT_URL`, the server uses `DATABASE_URL` —
and `/meta/health` reported `database=postgres  llm=groq:llama-3.3-70b-versatile`
with `/progress/overview` returning real computed mastery.

| Precision | File | Identical | Paraphrase | Same-topic | Unrelated | Ranking |
|---|---|---|---|---|---|---|
| `fp32` | 127 MB | 1.000 | 0.834 | 0.688 | 0.457 | 0 > 1 > 2 > 3 |
| `q8` | 33 MB | 1.000 | 0.834 | 0.694 | 0.471 | 0 > 1 > 2 > 3 |

Measured on a different sentence set than the row above, so compare the two rows
to each other, not to the 0.97/0.73/0.29 figures. Quantising costs at most 0.014
of cosine similarity and does not reorder retrieval results — which is what
makes `EMBEDDING_DTYPE=q8` an acceptable trade for a 512 MB container.

---

## Contract-first workflow

`packages/contracts` is the single source of truth for every request and response.
Handlers validate and serialize with the same schemas they publish, so a response
that does not match its contract fails loudly here rather than silently in the
frontend.

Changing a shipped schema means: announce it, bump the version, and update
`packages/mocks` fixtures in the same PR. Never a silent rename.
