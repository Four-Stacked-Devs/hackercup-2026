import type { FastifyPluginAsync } from 'fastify';
import { API_BASE, DEVICE_ID_HEADER } from '@educlm/contracts';

/**
 * A status page at `/`.
 *
 * Hitting the root of a deployed API otherwise returns the device-id 401, which
 * reads as a broken deployment when it is actually the auth hook working. This
 * answers "is it up, and what is it running?" without a terminal.
 *
 * The markup is inlined rather than kept in a .html file on purpose: the build
 * is `tsc`, which emits .js and copies nothing else, so a sibling .html would
 * exist in src/ and 404 in dist/.
 *
 * The checks run in the browser, not here. A server-side probe of the server
 * doing the probing proves very little, and this way the latency shown is the
 * latency the viewer actually has — which is what made the 21s route problem
 * visible rather than invisible.
 */

const PUBLIC_ENDPOINTS = [
  {
    path: `${API_BASE}/meta/health`,
    label: 'Health',
    description: 'Database, model and embedding mode',
  },
  {
    path: `${API_BASE}/meta/ai-disclosure`,
    label: 'AI disclosure',
    description: 'Every model and library in use',
  },
] as const;

const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>EducLM API — status</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #fbfbfa;   --fg: #1a1a18;  --muted: #6b6b66;
    --card: #ffffff; --line: #e6e5e1;
    --ok: #1a7f4b;   --bad: #b3261e; --pending: #8a8a84;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #16161a;  --fg: #ececea;  --muted: #9a9a94;
      --card: #1e1e23; --line: #2e2e35;
      --ok: #4ade80;  --bad: #f87171; --pending: #7a7a74;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2.5rem 1.25rem; background: var(--bg); color: var(--fg);
    font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  main { max-width: 40rem; margin: 0 auto; }
  h1 { font-size: 1.35rem; margin: 0 0 .2rem; letter-spacing: -.01em; }
  .sub { color: var(--muted); margin: 0 0 2rem; font-size: .9rem; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .6rem; }
  li {
    background: var(--card); border: 1px solid var(--line); border-radius: 9px;
    padding: .85rem 1rem; display: flex; align-items: center; gap: .85rem;
  }
  .dot {
    width: .55rem; height: .55rem; border-radius: 50%; flex: none;
    background: var(--pending); transition: background .2s;
  }
  .dot[data-state="up"]   { background: var(--ok); }
  .dot[data-state="down"] { background: var(--bad); }
  .who { flex: 1; min-width: 0; }
  .name { font-weight: 550; }
  .desc { color: var(--muted); font-size: .82rem; }
  code {
    font: .8rem ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: var(--muted); word-break: break-all;
  }
  .ms { color: var(--muted); font-size: .8rem; font-variant-numeric: tabular-nums; flex: none; }
  .mode {
    margin-top: 1.5rem; background: var(--card); border: 1px solid var(--line);
    border-radius: 9px; padding: 1rem; font-size: .87rem;
  }
  .mode h2 { font-size: .75rem; text-transform: uppercase; letter-spacing: .07em;
             color: var(--muted); margin: 0 0 .7rem; font-weight: 600; }
  .row { display: flex; justify-content: space-between; gap: 1rem; padding: .28rem 0; }
  .row span:first-child { color: var(--muted); }
  .row span:last-child { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                         font-size: .82rem; text-align: right; word-break: break-all; }
  footer { margin-top: 1.75rem; color: var(--muted); font-size: .82rem; }
  footer code { color: inherit; }
  a { color: inherit; }
</style>
</head>
<body>
<main>
  <h1>EducLM API</h1>
  <p class="sub">Public endpoints. Checked from your browser, so the timings are yours.</p>

  <ul id="checks"></ul>

  <div class="mode" id="mode" hidden>
    <h2>Running mode</h2>
    <div id="mode-rows"></div>
  </div>

  <footer>
    Every other route is scoped to a student and needs a
    <code>${DEVICE_ID_HEADER}</code> header — without one it answers
    <code>401 UNAUTHORIZED</code>, which is the auth hook working, not an outage.
  </footer>
</main>

<script>
  const ENDPOINTS = __ENDPOINTS__;
  const list = document.getElementById('checks');

  const items = ENDPOINTS.map((ep) => {
    const li = document.createElement('li');

    const dot = document.createElement('span');
    dot.className = 'dot';

    const who = document.createElement('div');
    who.className = 'who';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = ep.label;
    const desc = document.createElement('div');
    desc.className = 'desc';
    desc.textContent = ep.description;
    const path = document.createElement('code');
    path.textContent = 'GET ' + ep.path;
    who.append(name, desc, path);

    const ms = document.createElement('span');
    ms.className = 'ms';
    ms.textContent = '…';

    li.append(dot, who, ms);
    list.append(li);
    return { ep, dot, ms };
  });

  function renderMode(mode) {
    const box = document.getElementById('mode');
    const rows = document.getElementById('mode-rows');
    rows.textContent = '';
    for (const [key, value] of Object.entries(mode)) {
      const row = document.createElement('div');
      row.className = 'row';
      const k = document.createElement('span');
      k.textContent = key;
      const v = document.createElement('span');
      v.textContent = String(value);
      row.append(k, v);
      rows.append(row);
    }
    box.hidden = false;
  }

  async function check({ ep, dot, ms }) {
    const started = performance.now();
    try {
      const res = await fetch(ep.path, { headers: { accept: 'application/json' } });
      const elapsed = Math.round(performance.now() - started);
      dot.dataset.state = res.ok ? 'up' : 'down';
      ms.textContent = res.ok ? elapsed + ' ms' : 'HTTP ' + res.status;
      if (res.ok && ep.label === 'Health') {
        const body = await res.json();
        if (body && body.data && body.data.mode) renderMode(body.data.mode);
      }
    } catch {
      dot.dataset.state = 'down';
      ms.textContent = 'unreachable';
    }
  }

  items.forEach(check);
</script>
</body>
</html>`;

export const statusRoutes: FastifyPluginAsync = async (app) => {
  // Built once at startup — the page is identical for every visitor.
  const html = PAGE.replace('__ENDPOINTS__', JSON.stringify(PUBLIC_ENDPOINTS));

  app.get('/', async (_request, reply) => reply.type('text/html; charset=utf-8').send(html));
};
