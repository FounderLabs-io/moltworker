import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { MOLTBOT_PORT } from '../config';
import { findExistingMoltbotProcess, ensureMoltbotGateway } from '../gateway';
import { ai } from './ai';

/**
 * Public routes - NO Cloudflare Access authentication required
 * 
 * These routes are mounted BEFORE the auth middleware is applied.
 * Includes: health checks, static assets, and public API endpoints.
 */
const publicRoutes = new Hono<AppEnv>();

// GET /sandbox-health - Health check endpoint
publicRoutes.get('/sandbox-health', (c) => {
  return c.json({
    status: 'ok',
    service: 'moltbot-sandbox',
    gateway_port: MOLTBOT_PORT,
  });
});

// GET /logo.png - Serve logo from ASSETS binding
publicRoutes.get('/logo.png', (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

// GET /logo-small.png - Serve small logo from ASSETS binding
publicRoutes.get('/logo-small.png', (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

// GET /api/env-check - Debug endpoint to check if env vars are set (no sensitive data)
publicRoutes.get('/api/env-check', (c) => {
  // Inline the buildEnvVars logic to check what container would receive
  const normalizedBaseUrl = c.env.AI_GATEWAY_BASE_URL?.replace(/\/+$/, '');
  const isOpenAIGateway = normalizedBaseUrl?.endsWith('/openai');
  let hasExternalApiKey = false;
  
  if (c.env.AI_GATEWAY_API_KEY) hasExternalApiKey = true;
  if (c.env.ANTHROPIC_API_KEY) hasExternalApiKey = true;
  if (c.env.OPENAI_API_KEY) hasExternalApiKey = true;
  
  const wouldUseWorkersAI = !hasExternalApiKey && !!c.env.WORKER_URL;
  
  return c.json({
    worker_env: {
      has_anthropic_key: !!c.env.ANTHROPIC_API_KEY,
      anthropic_key_length: c.env.ANTHROPIC_API_KEY?.length || 0,
      has_openai_key: !!c.env.OPENAI_API_KEY,
      has_ai_gateway_key: !!c.env.AI_GATEWAY_API_KEY,
      ai_gateway_base_url: c.env.AI_GATEWAY_BASE_URL,
      has_gateway_token: !!c.env.MOLTBOT_GATEWAY_TOKEN,
      worker_url: c.env.WORKER_URL,
      dev_mode: c.env.DEV_MODE,
    },
    container_would_receive: {
      has_external_api_key: hasExternalApiKey,
      would_use_workers_ai: wouldUseWorkersAI,
      is_openai_gateway: isOpenAIGateway,
    }
  });
});

// GET /api/status - Public health check for gateway status (no auth required)
publicRoutes.get('/api/status', async (c) => {
  const sandbox = c.get('sandbox');
  
  try {
    const process = await findExistingMoltbotProcess(sandbox);
    if (!process) {
      return c.json({ ok: false, status: 'not_running' });
    }
    
    // Process exists, check if it's actually responding
    // Try to reach the gateway with a short timeout
    try {
      await process.waitForPort(18789, { mode: 'tcp', timeout: 5000 });
      return c.json({ ok: true, status: 'running', processId: process.id });
    } catch {
      return c.json({ ok: false, status: 'not_responding', processId: process.id });
    }
  } catch (err) {
    return c.json({ ok: false, status: 'error', error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// GET /_admin/assets/* - Admin UI static assets (CSS, JS need to load for login redirect)
// Assets are built to dist/client with base "/_admin/"
publicRoutes.get('/_admin/assets/*', async (c) => {
  const url = new URL(c.req.url);
  // Rewrite /_admin/assets/* to /assets/* for the ASSETS binding
  const assetPath = url.pathname.replace('/_admin/assets/', '/assets/');
  const assetUrl = new URL(assetPath, url.origin);
  return c.env.ASSETS.fetch(new Request(assetUrl.toString(), c.req.raw));
});

// POST /api/restart - Restart the gateway (requires token auth)
publicRoutes.post('/api/restart', async (c) => {
  const sandbox = c.get('sandbox');
  
  // Check token auth
  const url = new URL(c.req.url);
  const token = url.searchParams.get('token');
  if (!token || token !== c.env.MOLTBOT_GATEWAY_TOKEN) {
    return c.json({ error: 'Invalid or missing token' }, 401);
  }

  try {
    // Find and kill the existing gateway process
    const existingProcess = await findExistingMoltbotProcess(sandbox);
    
    if (existingProcess) {
      console.log('[RESTART] Killing existing gateway process:', existingProcess.id);
      try {
        await existingProcess.kill();
      } catch (killErr) {
        console.error('[RESTART] Error killing process:', killErr);
      }
      // Wait a moment for the process to die
      await new Promise(r => setTimeout(r, 2000));
    }

    // Start a new gateway in the background
    const bootPromise = ensureMoltbotGateway(sandbox, c.env).catch((err) => {
      console.error('[RESTART] Gateway restart failed:', err);
    });
    c.executionCtx.waitUntil(bootPromise);

    return c.json({
      success: true,
      message: existingProcess 
        ? 'Gateway process killed, new instance starting...'
        : 'No existing process found, starting new instance...',
      previousProcessId: existingProcess?.id,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

// =============================================================================
// NOTE: /v1/* routes are NOT forwarded to AI routes here.
// They fall through to the main app's catch-all handler which proxies to the container gateway.
// Container Workers AI callbacks use /ai/v1/* prefix explicitly.

export { publicRoutes };
