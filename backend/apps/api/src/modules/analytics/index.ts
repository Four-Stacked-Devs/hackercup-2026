/**
 * EduOS Analytics Engine — pure functions only.
 *
 * The rule that defines this project: this module never asks a language model
 * what the student is weak at. Every finding is computed from logged responses
 * by a function you can point at. The LLM may *phrase* a finding; it must never
 * *produce* one.
 *
 * Therefore: no Prisma imports, no `fetch`, no LLM client, no `Date.now()`
 * hidden inside a rule. Inputs are plain objects; outputs are plain objects.
 * There is a lint-style test in `test/analytics/purity.test.ts` that fails if
 * this file's directory ever imports I/O.
 */
export * from './types.js';
export * from './mastery.js';
export * from './misconceptions.js';
export * from './trend.js';
export * from './adaptation.js';
