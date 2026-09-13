/** Reading the environment happens here and nowhere else. */

export type ApiMode = 'mock' | 'live';

const RAW_API_MODE = process.env.NEXT_PUBLIC_API_MODE;

/**
 * Mock mode is the zero-config local default, and that is deliberate: `npm run
 * dev` with nothing else running has to work.
 *
 * It must never be the *accidental* default. `NEXT_PUBLIC_*` is inlined at build
 * time, so a production build that forgets the variable used to ship MSW
 * fixtures — every accuracy figure, mastery band and finding on screen invented,
 * and indistinguishable from a real student's work. Failing the build is the only
 * point at which that is still cheap to notice.
 */
if (process.env.NODE_ENV === 'production' && RAW_API_MODE !== 'live' && RAW_API_MODE !== 'mock') {
  throw new Error(
    'NEXT_PUBLIC_API_MODE must be set to "live" or "mock" for a production build. ' +
      `Got ${RAW_API_MODE === undefined ? 'no value' : JSON.stringify(RAW_API_MODE)}. ` +
      'Set it to "live" to call the API, or "mock" to ship the demo fixtures on purpose.',
  );
}

export const API_MODE: ApiMode = RAW_API_MODE === 'live' ? 'live' : 'mock';

/**
 * Mock data reached a real deployment. Screens use this to say so out loud —
 * one line in Settings is not enough warning for fabricated numbers.
 */
export const IS_UNEXPECTED_MOCK: boolean =
  API_MODE === 'mock' && process.env.NODE_ENV === 'production';

/**
 * Contract route helpers already return absolute paths (`/api/v1/...`), so the
 * client only needs an origin to put in front of them. In mock mode that origin
 * is empty: the request stays same-origin and MSW intercepts it.
 */
export const API_ORIGIN: string =
  API_MODE === 'live'
    ? (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1').replace(
        /\/api\/v1\/?$/,
        '',
      )
    : '';

export const DEFAULT_DEVICE_ID =
  process.env.NEXT_PUBLIC_DEFAULT_DEVICE_ID ?? 'demo-device';

/** The material the sample-module escape hatch and the demo path open on. */
export const DEMO_MATERIAL_ID = process.env.NEXT_PUBLIC_DEMO_MATERIAL_ID ?? 'mat_demo_js';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
