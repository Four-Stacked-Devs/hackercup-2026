/** Reading the environment happens here and nowhere else. */

export type ApiMode = 'mock' | 'live';

export const API_MODE: ApiMode =
  process.env.NEXT_PUBLIC_API_MODE === 'live' ? 'live' : 'mock';

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
