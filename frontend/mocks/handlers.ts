import { HttpResponse, delay, http, type HttpResponseResolver } from 'msw';
import {
  API_ERROR_STATUS,
  ROUTES,
  createPracticeSetSchema,
  revertAdaptationSchema,
  submitResponseSchema,
  updatePreferencesSchema,
  type ApiErrorCode,
  type ChatMessage,
} from '@educlm/contracts';
import * as store from './store';

/**
 * Handlers for every endpoint in section 6.
 *
 * Two things here exist to make the UI honest:
 *  - latency, so loading states are built against something real (2.5s where
 *    the server does real work: upload and question generation);
 *  - `?__mock=error`, which forces any endpoint to return its realistic error,
 *    so error states can be built and demoed without editing code.
 */

const requestId = () => `mock_${Math.random().toString(36).slice(2, 10)}`;

function ok<T>(data: T, status = 200) {
  return HttpResponse.json(
    { data, meta: { requestId: requestId(), generatedAt: new Date().toISOString() } },
    { status },
  );
}

function fail(code: ApiErrorCode, message: string, details?: unknown) {
  return HttpResponse.json(
    { error: { code, message, requestId: requestId(), ...(details ? { details } : {}) } },
    { status: API_ERROR_STATUS[code] },
  );
}

function wantsError(request: Request): boolean {
  return new URL(request.url).searchParams.get('__mock') === 'error';
}

async function humanLatency(): Promise<void> {
  await delay(150 + Math.random() * 450);
}

/** Where the server genuinely does work, the mock waits like it. */
const WORK_LATENCY_MS = 2500;

/** Wraps a resolver with latency and the forced-error escape hatch. */
function handler(
  errorCase: { code: ApiErrorCode; message: string },
  resolver: HttpResponseResolver,
  latency: 'human' | 'work' = 'human',
): HttpResponseResolver {
  return async (input) => {
    if (latency === 'work') await delay(WORK_LATENCY_MS);
    else await humanLatency();

    if (wantsError(input.request)) return fail(errorCase.code, errorCase.message);
    return resolver(input);
  };
}

const path = (route: string) => route.split('?')[0] as string;

export const handlers = [
  // ── Materials ──────────────────────────────────────────────────────────────
  http.get(
    ROUTES.materials.list(),
    handler(
      { code: 'INTERNAL_ERROR', message: "We couldn't load your materials just now." },
      () => ok(store.listMaterials()),
    ),
  ),

  http.post(
    ROUTES.materials.create(),
    handler(
      {
        code: 'NO_TEXT_LAYER',
        message:
          "This PDF is a scanned image, so there's no text to read. Try a file where you can select the text.",
      },
      async ({ request }) => {
        const form = await request.formData();
        const file = form.get('file');
        const title = form.get('title');

        if (!(file instanceof File)) {
          return fail('VALIDATION_ERROR', 'No file was attached to that upload.');
        }
        if (file.type && file.type !== 'application/pdf') {
          return fail('UNSUPPORTED_FILE', 'EducLM reads PDF files. That one is not a PDF.');
        }
        if (file.size > 20 * 1024 * 1024) {
          return fail('FILE_TOO_LARGE', 'That file is over 20 MB. Try a smaller PDF.');
        }

        // A file named like a scan fails ingestion, so the NO_TEXT_LAYER path
        // can be shown with a real upload rather than a query parameter.
        const looksScanned = /scan|photo|image/i.test(file.name);

        return ok(
          store.startUpload(file.name, typeof title === 'string' ? title : null, looksScanned),
          202,
        );
      },
      'work',
    ),
  ),

  http.get(
    ROUTES.materials.get(':id'),
    handler(
      { code: 'NOT_FOUND', message: 'That material is no longer here.' },
      ({ params }) => {
        const material = store.findMaterial(String(params['id']));
        return material ? ok(material) : fail('NOT_FOUND', 'That material is no longer here.');
      },
    ),
  ),

  http.get(ROUTES.materials.status(':id'), async ({ params, request }) => {
    // Polled every 1.5s: it stays fast so the progress bar moves smoothly.
    await delay(120);
    if (wantsError(request)) {
      return fail('NOT_FOUND', 'That material is no longer here.');
    }

    store.advanceUploads();
    const material = store.findMaterial(String(params['id']));
    if (!material) return fail('NOT_FOUND', 'That material is no longer here.');

    return ok({
      status: material.status,
      processing: material.processing,
      failure: material.failure,
    });
  }),

  http.delete(
    ROUTES.materials.remove(':id'),
    handler(
      { code: 'INTERNAL_ERROR', message: "That material couldn't be deleted. Try again." },
      ({ params }) => {
        const deleted = store.deleteMaterial(String(params['id']));
        return deleted ? ok({ deleted: true }) : fail('NOT_FOUND', 'That material is already gone.');
      },
    ),
  ),

  http.get(
    ROUTES.materials.topics(':id'),
    handler(
      { code: 'MATERIAL_NOT_READY', message: 'This material is still being prepared.' },
      ({ params }) => ok(store.listTopics(String(params['id']))),
    ),
  ),

  http.get(
    path(ROUTES.materials.lesson(':id', 'x')),
    handler(
      { code: 'MATERIAL_NOT_READY', message: 'This lesson is still being built.' },
      ({ request }) => {
        const topicId = new URL(request.url).searchParams.get('topicId');
        if (!topicId) return fail('VALIDATION_ERROR', 'Pick a topic to open its lesson.');

        const lesson = store.getLesson(topicId);
        return lesson ? ok(lesson) : fail('NOT_FOUND', "That topic isn't in this material.");
      },
    ),
  ),

  http.get(
    `${ROUTES.materials.get(':id')}/pages/:page`,
    handler(
      { code: 'NOT_FOUND', message: 'That page is not in this material.' },
      ({ params }) => {
        const page = store.getPage(Number(params['page']));
        return page ? ok(page) : fail('NOT_FOUND', 'That page is not in this material.');
      },
    ),
  ),

  // ── Chat ───────────────────────────────────────────────────────────────────
  http.get(
    ROUTES.chat.messages(':id'),
    handler(
      { code: 'INTERNAL_ERROR', message: "The conversation couldn't be loaded." },
      () => ok(store.getChat()),
    ),
  ),

  http.delete(
    ROUTES.chat.clear(':id'),
    handler({ code: 'INTERNAL_ERROR', message: "That conversation couldn't be cleared." }, () => {
      store.clearChat();
      return ok({ cleared: true });
    }),
  ),

  http.post(ROUTES.chat.send(':id'), async ({ request, params }) => {
    const body = (await request.json()) as {
      message: string;
      topicId?: string;
      stream?: boolean;
    };

    const materialId = String(params['id']);
    const now = new Date().toISOString();

    store.appendChatMessage({
      id: store.nextChatId(),
      role: 'user',
      content: body.message,
      citations: [],
      createdAt: now,
    });

    if (wantsError(request)) {
      await delay(400);
      return fail('LLM_UNAVAILABLE', 'The tutor is unavailable right now. Please try again.');
    }

    const answer = store.answerQuestion(body.message, body.topicId);
    const assistantMessage: ChatMessage = {
      id: store.nextChatId(),
      role: 'assistant',
      content: answer.text,
      citations: answer.citations,
      createdAt: new Date().toISOString(),
    };

    if (body.stream === false) {
      await delay(900);
      store.appendChatMessage(assistantMessage);
      return ok({ message: assistantMessage });
    }

    const encoder = new TextEncoder();

    // Grouped into a bounded number of frames: one frame per word means one
    // service-worker round trip per word, which reads as a stall rather than
    // as typing.
    const words = answer.text.split(/(\s+)/);
    const perFrame = Math.max(1, Math.ceil(words.length / 60));
    const frames = Array.from({ length: Math.ceil(words.length / perFrame) }, (_, index) =>
      words.slice(index * perFrame, (index + 1) * perFrame).join(''),
    );

    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        };

        await delay(350);
        for (const frame of frames) {
          send('token', { text: frame });
          await delay(28);
        }

        // Citations land before `done`, as the contract promises.
        send('citations', { citations: answer.citations });
        await delay(120);

        store.appendChatMessage(assistantMessage);
        send('done', { message: assistantMessage });
        controller.close();
      },
    });

    void materialId;

    return new HttpResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  }),

  // ── Practice ───────────────────────────────────────────────────────────────
  http.post(
    ROUTES.practice.createSet(),
    handler(
      { code: 'LLM_UNAVAILABLE', message: "We couldn't build questions just now. Try again." },
      async ({ request }) => {
        const parsed = createPracticeSetSchema.safeParse(await request.json());
        if (!parsed.success) {
          return fail('VALIDATION_ERROR', 'That practice request was incomplete.');
        }

        const input: Parameters<typeof store.createPracticeSet>[0] = {
          materialId: parsed.data.materialId,
          kind: parsed.data.kind,
          count: parsed.data.count,
        };
        if (parsed.data.topicId) input.topicId = parsed.data.topicId;

        const set = store.createPracticeSet(input);
        return set.questions.length === 0
          ? fail('INSUFFICIENT_EVIDENCE', 'There are no questions for that topic yet.')
          : ok(set);
      },
      'work',
    ),
  ),

  http.get(
    ROUTES.practice.getSet(':id'),
    handler(
      { code: 'NOT_FOUND', message: 'That practice set has expired.' },
      ({ params }) => {
        const set = store.getPracticeSet(String(params['id']));
        return set ? ok(set) : fail('NOT_FOUND', 'That practice set has expired.');
      },
    ),
  ),

  http.post(
    ROUTES.practice.respond(':id'),
    handler(
      { code: 'INTERNAL_ERROR', message: "That answer didn't save. Try checking it again." },
      async ({ params, request }) => {
        const parsed = submitResponseSchema.safeParse(await request.json());
        if (!parsed.success) return fail('VALIDATION_ERROR', 'That answer was incomplete.');

        const feedback = store.submitResponse(String(params['id']), parsed.data);
        return feedback
          ? ok(feedback)
          : fail('NOT_FOUND', "That question isn't part of this set.");
      },
    ),
  ),

  http.post(
    ROUTES.practice.complete(':id'),
    handler(
      { code: 'INTERNAL_ERROR', message: "We couldn't finish that set. Try again." },
      ({ params }) => {
        const result = store.completePracticeSet(String(params['id']));
        return result ? ok(result) : fail('NOT_FOUND', 'That practice set has expired.');
      },
    ),
  ),

  // ── Progress ───────────────────────────────────────────────────────────────
  http.get(
    path(ROUTES.progress.overview('x')),
    handler(
      { code: 'INTERNAL_ERROR', message: "Your progress couldn't be loaded just now." },
      ({ request }) => {
        const materialId = new URL(request.url).searchParams.get('materialId');
        if (!materialId) return fail('VALIDATION_ERROR', 'No material was selected.');
        return ok(store.progressOverview(materialId));
      },
    ),
  ),

  http.get(
    ROUTES.progress.topic(':topicId'),
    handler(
      { code: 'INSUFFICIENT_EVIDENCE', message: 'Not enough answers on this topic yet.' },
      ({ params }) => ok(store.topicProgress(String(params['topicId']))),
    ),
  ),

  http.get(
    ROUTES.progress.finding(':id'),
    handler({ code: 'NOT_FOUND', message: 'That finding is no longer here.' }, ({ params }) => {
      const finding = store.getFinding(String(params['id']));
      return finding ? ok(finding) : fail('NOT_FOUND', 'That finding is no longer here.');
    }),
  ),

  http.post(
    ROUTES.progress.dismissFinding(':id'),
    handler(
      { code: 'INTERNAL_ERROR', message: "That couldn't be dismissed. Try again." },
      ({ params }) => {
        const finding = store.dismissFinding(String(params['id']));
        return finding ? ok(finding) : fail('NOT_FOUND', 'That finding is no longer here.');
      },
    ),
  ),

  // ── Plan ───────────────────────────────────────────────────────────────────
  http.get(
    path(ROUTES.plan.get('x')),
    handler(
      { code: 'INTERNAL_ERROR', message: "Your plan couldn't be loaded just now." },
      () => ok(store.getPlan()),
    ),
  ),

  http.post(
    ROUTES.plan.completeStep(':id'),
    handler(
      { code: 'INTERNAL_ERROR', message: "That step couldn't be updated." },
      ({ params }) => {
        const plan = store.completeStep(String(params['id']));
        return plan ? ok(plan) : fail('NOT_FOUND', 'That step is no longer in your plan.');
      },
    ),
  ),

  http.post(
    ROUTES.plan.skipStep(':id'),
    handler(
      { code: 'INTERNAL_ERROR', message: "That step couldn't be updated." },
      ({ params }) => {
        const plan = store.skipStep(String(params['id']));
        return plan ? ok(plan) : fail('NOT_FOUND', 'That step is no longer in your plan.');
      },
    ),
  ),

  http.post(
    ROUTES.plan.revertAdaptation(),
    handler(
      { code: 'INTERNAL_ERROR', message: "We couldn't restore the original plan." },
      async ({ request }) => {
        const parsed = revertAdaptationSchema.safeParse(await request.json());
        if (!parsed.success) return fail('VALIDATION_ERROR', 'No material was selected.');
        return ok(store.revertAdaptation());
      },
    ),
  ),

  // ── Me ─────────────────────────────────────────────────────────────────────
  http.get(
    ROUTES.me.get(),
    handler({ code: 'UNAUTHORIZED', message: 'This device session has expired.' }, () =>
      ok({
        userId: 'user_demo',
        displayName: 'Demo Student',
        preferences: store.getPreferences(),
      }),
    ),
  ),

  http.patch(
    ROUTES.me.preferences(),
    handler(
      { code: 'INTERNAL_ERROR', message: "That preference didn't save. It still applies here." },
      async ({ request }) => {
        const parsed = updatePreferencesSchema.safeParse(await request.json());
        if (!parsed.success) return fail('VALIDATION_ERROR', 'That preference is not valid.');
        return ok(store.updatePreferences(parsed.data));
      },
    ),
  ),

  // ── Meta ───────────────────────────────────────────────────────────────────
  http.get(
    ROUTES.meta.aiDisclosure(),
    handler(
      { code: 'INTERNAL_ERROR', message: "The AI disclosure couldn't be loaded." },
      () => ok(store.AI_DISCLOSURE),
    ),
  ),

  http.get(ROUTES.meta.health(), async () => {
    await delay(80);
    return ok({
      status: 'ok',
      mode: { database: 'mock', llm: 'mock', embeddings: 'mock' },
    });
  }),
];
