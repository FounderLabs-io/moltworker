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
// FALLBACK: Forward /v1/* to AI routes (for container callbacks that miss /ai prefix)
// This handles cases where the OpenAI SDK strips or ignores the /ai prefix in baseUrl
// =============================================================================

// Forward /v1/chat/completions to /ai/v1/chat/completions
publicRoutes.post('/v1/chat/completions', async (c) => {
  console.log('[PUBLIC] Forwarding /v1/chat/completions to AI routes');
  // Rewrite the path and forward to AI routes
  const newUrl = new URL(c.req.url);
  newUrl.pathname = '/v1/chat/completions';
  const newRequest = new Request(newUrl.toString(), c.req.raw);
  return ai.fetch(newRequest, c.env, c.executionCtx);
});

// Forward /v1/responses to /ai/v1/responses
publicRoutes.post('/v1/responses', async (c) => {
  console.log('[PUBLIC] Forwarding /v1/responses to AI routes');
  const newUrl = new URL(c.req.url);
  newUrl.pathname = '/v1/responses';
  const newRequest = new Request(newUrl.toString(), c.req.raw);
  return ai.fetch(newRequest, c.env, c.executionCtx);
});

// Forward /v1/models to /ai/v1/models
publicRoutes.get('/v1/models', async (c) => {
  console.log('[PUBLIC] Forwarding /v1/models to AI routes');
  const newUrl = new URL(c.req.url);
  newUrl.pathname = '/v1/models';
  const newRequest = new Request(newUrl.toString(), c.req.raw);
  return ai.fetch(newRequest, c.env, c.executionCtx);
});

export { publicRoutes };
