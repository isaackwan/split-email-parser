import { serve } from '@hono/node-server';

import { loadConfig } from './config.js';
import { createWebApp } from './webApp.js';

let cfg;
try {
  cfg = loadConfig();
} catch (err) {
  process.stderr.write(`[config] ${err.message}\n`);
  process.exit(1);
}

const port = Number.parseInt(process.env.PORT || '3000', 10);
const app = createWebApp({ cfg });

serve({
  fetch: app.fetch,
  port,
});

process.stdout.write(`[web] Listening on http://localhost:${port}\n`);

export default app;
