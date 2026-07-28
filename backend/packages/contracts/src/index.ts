/**
 * @educlm/contracts — the authoritative wire contract.
 *
 * Rules of engagement (section 3 of EducLM-BACKEND.md):
 *  1. Every endpoint's request and response is a Zod schema here BEFORE a handler exists.
 *  2. Types are inferred (`z.infer`), never hand-written twice.
 *  3. Changing a shipped schema means: announce it, bump the version,
 *     update `packages/mocks` fixtures in the same PR. Never a silent rename.
 *  4. Handlers validate with the same schema they publish.
 */
export * from './primitives.js';
export * from './envelope.js';
export * from './resources.js';
export * from './requests.js';
export * from './routes.js';
