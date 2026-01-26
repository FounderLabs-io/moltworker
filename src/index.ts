/**
 * Clawdbot + Cloudflare Sandbox
 *
 * This Worker runs Clawdbot personal AI assistant in a Cloudflare Sandbox container.
 * It proxies all requests to the Clawdbot Gateway's web UI and WebSocket endpoint.
 *
 * Features:
 * - Web UI (Control Dashboard + WebChat) at /
 * - WebSocket support for real-time communication
 * - Configuration via environment secrets
 *
 * Required secrets (set via `wrangler secret put`):
 * - ANTHROPIC_API_KEY: Your Anthropic API key
 *
 * Optional secrets:
 * - CLAWDBOT_GATEWAY_TOKEN: Token to protect gateway access
 * - TELEGRAM_BOT_TOKEN: Telegram bot token
 * - DISCORD_BOT_TOKEN: Discord bot token
 * - SLACK_BOT_TOKEN + SLACK_APP_TOKEN: Slack tokens
 */

import { Hono } from 'hono';
import { getSandbox, Sandbox } from '@cloudflare/sandbox';
import type { Process } from '@cloudflare/sandbox';

export { Sandbox };

const CLAWDBOT_PORT = 18789;
const STARTUP_TIMEOUT_MS = 180_000; // 2 minutes for clawdbot to start

// Types
interface ClawdbotEnv {
  Sandbox: DurableObjectNamespace<Sandbox>;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  CLAWDBOT_GATEWAY_TOKEN?: string;
  CLAWDBOT_DEV_MODE?: string;
  CLAWDBOT_BIND_MODE?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_DM_POLICY?: string;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_DM_POLICY?: string;
  SLACK_BOT_TOKEN?: string;
  SLACK_APP_TOKEN?: string;
  // TODO: Change default to 'false' before production release
  DEBUG_ROUTES_ENABLED?: string;
}

type AppEnv = { Bindings: ClawdbotEnv; Variables: { sandbox: Sandbox } };

// Helper functions
function buildEnvVars(env: ClawdbotEnv): Record<string, string> {
  const envVars: Record<string, string> = {};

  if (env.ANTHROPIC_API_KEY) envVars.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  if (env.OPENAI_API_KEY) envVars.OPENAI_API_KEY = env.OPENAI_API_KEY;
  if (env.CLAWDBOT_GATEWAY_TOKEN) envVars.CLAWDBOT_GATEWAY_TOKEN = env.CLAWDBOT_GATEWAY_TOKEN;
  if (env.CLAWDBOT_DEV_MODE) envVars.CLAWDBOT_DEV_MODE = env.CLAWDBOT_DEV_MODE;
  if (env.CLAWDBOT_BIND_MODE) envVars.CLAWDBOT_BIND_MODE = env.CLAWDBOT_BIND_MODE;
  if (env.TELEGRAM_BOT_TOKEN) envVars.TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
  if (env.TELEGRAM_DM_POLICY) envVars.TELEGRAM_DM_POLICY = env.TELEGRAM_DM_POLICY;
  if (env.DISCORD_BOT_TOKEN) envVars.DISCORD_BOT_TOKEN = env.DISCORD_BOT_TOKEN;
  if (env.DISCORD_DM_POLICY) envVars.DISCORD_DM_POLICY = env.DISCORD_DM_POLICY;
  if (env.SLACK_BOT_TOKEN) envVars.SLACK_BOT_TOKEN = env.SLACK_BOT_TOKEN;
  if (env.SLACK_APP_TOKEN) envVars.SLACK_APP_TOKEN = env.SLACK_APP_TOKEN;

  return envVars;
}

async function findExistingClawdbotProcess(sandbox: Sandbox): Promise<Process | null> {
  try {
    const processes = await sandbox.listProcesses();
    for (const proc of processes) {
      if (
        proc.command.includes('start-clawdbot.sh') ||
        proc.command.includes('clawdbot gateway')
      ) {
        if (proc.status === 'starting' || proc.status === 'running') {
          return proc;
        }
      }
    }
  } catch (e) {
    console.log('Could not list processes:', e);
  }
  return null;
}

async function ensureClawdbotGateway(sandbox: Sandbox, env: ClawdbotEnv): Promise<Process> {
  // Check if Clawdbot is already running or starting
  const existingProcess = await findExistingClawdbotProcess(sandbox);
  if (existingProcess) {
    console.log('Found existing Clawdbot process:', existingProcess.id, 'status:', existingProcess.status);

    // Always use full startup timeout - a process can be "running" but not ready yet
    // (e.g., just started by another concurrent request). Using a shorter timeout
    // causes race conditions where we kill processes that are still initializing.
    try {
      console.log('Waiting for Clawdbot gateway on port', CLAWDBOT_PORT, 'timeout:', STARTUP_TIMEOUT_MS);
      await existingProcess.waitForPort(CLAWDBOT_PORT, { mode: 'tcp', timeout: STARTUP_TIMEOUT_MS });
      console.log('Clawdbot gateway is reachable');
      return existingProcess;
    } catch (e) {
      // Timeout waiting for port - process is likely dead or stuck, kill and restart
      console.log('Existing process not reachable after full timeout, killing and restarting...');
      try {
        await existingProcess.kill();
      } catch (killError) {
        console.log('Failed to kill process:', killError);
      }
    }
  }

  // Start a new Clawdbot gateway
  console.log('Starting new Clawdbot gateway...');
  const envVars = buildEnvVars(env);
  const command = '/usr/local/bin/start-clawdbot.sh';

  console.log('Starting process with command:', command);
  console.log('Environment vars being passed:', Object.keys(envVars));

  let process: Process;
  try {
    process = await sandbox.startProcess(command, {
      env: Object.keys(envVars).length > 0 ? envVars : undefined,
    });
    console.log('Process started with id:', process.id, 'status:', process.status);
  } catch (startErr) {
    console.error('Failed to start process:', startErr);
    throw startErr;
  }

  // Wait for the gateway to be ready
  try {
    console.log('Waiting for Clawdbot gateway to be ready on port', CLAWDBOT_PORT);
    await process.waitForPort(CLAWDBOT_PORT, { mode: 'tcp', timeout: STARTUP_TIMEOUT_MS });
    console.log('Clawdbot gateway is ready!');

    const logs = await process.getLogs();
    if (logs.stdout) console.log('Clawdbot stdout:', logs.stdout);
    if (logs.stderr) console.log('Clawdbot stderr:', logs.stderr);
  } catch (e) {
    console.error('waitForPort failed:', e);
    try {
      const logs = await process.getLogs();
      console.error('Clawdbot startup failed. Stderr:', logs.stderr);
      console.error('Clawdbot startup failed. Stdout:', logs.stdout);
      throw new Error(`Clawdbot gateway failed to start. Stderr: ${logs.stderr || '(empty)'}`);
    } catch (logErr) {
      console.error('Failed to get logs:', logErr);
      throw e;
    }
  }

  return process;
}

// Debug routes sub-router
const debug = new Hono<AppEnv>();

// GET /debug/version - Returns build info from inside the container
debug.get('/version', async (c) => {
  const sandbox = c.get('sandbox');
  try {
    // Read the build info file
    const buildProcess = await sandbox.startProcess('cat /root/.clawdbot/build-info.json');
    await new Promise(resolve => setTimeout(resolve, 500));
    const buildLogs = await buildProcess.getLogs();

    let buildInfo = null;
    try {
      buildInfo = JSON.parse(buildLogs.stdout || '{}');
    } catch {
      // File might not exist in older deployments
    }

    // Also get clawdbot version
    const versionProcess = await sandbox.startProcess('clawdbot --version');
    await new Promise(resolve => setTimeout(resolve, 500));
    const versionLogs = await versionProcess.getLogs();
    const clawdbotVersion = (versionLogs.stdout || versionLogs.stderr || '').trim();

    return c.json({
      container: buildInfo || { error: 'build-info.json not found (older deployment?)' },
      clawdbot_version: clawdbotVersion,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ status: 'error', message: `Failed to get version info: ${errorMessage}` }, 500);
  }
});

// GET /debug/processes - List all processes with optional logs
debug.get('/processes', async (c) => {
  const sandbox = c.get('sandbox');
  try {
    const processes = await sandbox.listProcesses();
    const includeLogs = c.req.query('logs') === 'true';

    const processData = await Promise.all(processes.map(async p => {
      const data: Record<string, unknown> = {
        id: p.id,
        command: p.command,
        status: p.status,
      };

      if (includeLogs) {
        try {
          const logs = await p.getLogs();
          data.stdout = logs.stdout || '';
          data.stderr = logs.stderr || '';
        } catch {
          data.logs_error = 'Failed to retrieve logs';
        }
      }

      return data;
    }));

    return c.json({ count: processes.length, processes: processData });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

// GET /debug/logs - Returns container logs for debugging
debug.get('/logs', async (c) => {
  const sandbox = c.get('sandbox');
  try {
    const processId = c.req.query('id');
    let process: Process | null | undefined;

    if (processId) {
      const processes = await sandbox.listProcesses();
      process = processes.find(p => p.id === processId);
      if (!process) {
        return c.json({
          status: 'not_found',
          message: `Process ${processId} not found`,
          stdout: '',
          stderr: '',
        }, 404);
      }
    } else {
      process = await findExistingClawdbotProcess(sandbox);
      if (!process) {
        return c.json({
          status: 'no_process',
          message: 'No Clawdbot process is currently running',
          stdout: '',
          stderr: '',
        });
      }
    }

    const logs = await process.getLogs();
    return c.json({
      status: 'ok',
      process_id: process.id,
      process_status: process.status,
      stdout: logs.stdout || '',
      stderr: logs.stderr || '',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({
      status: 'error',
      message: `Failed to get logs: ${errorMessage}`,
      stdout: '',
      stderr: '',
    }, 500);
  }
});

// Main app
const app = new Hono<AppEnv>();

// Middleware: Initialize sandbox for all requests
app.use('*', async (c, next) => {
  const sandbox = getSandbox(c.env.Sandbox, 'clawdbot');
  c.set('sandbox', sandbox);
  await next();
});

// Health check endpoint (before starting clawdbot)
app.get('/sandbox-health', (c) => {
  return c.json({
    status: 'ok',
    service: 'clawdbot-sandbox',
    gateway_port: CLAWDBOT_PORT,
  });
});

// Mount debug routes (protected by env var)
// TODO: Change default to false before production release!
// These routes expose sensitive information about processes and logs
app.use('/debug/*', async (c, next) => {
  const debugEnabled = c.env.DEBUG_ROUTES_ENABLED !== 'false'; // Default: true (TODO: flip to false)
  if (!debugEnabled) {
    return c.json({ error: 'Debug routes are disabled' }, 404);
  }
  await next();
});
app.route('/debug', debug);

// All other routes: ensure clawdbot is running and proxy
app.all('*', async (c) => {
  const sandbox = c.get('sandbox');
  const request = c.req.raw;

  // Ensure Clawdbot is running
  try {
    await ensureClawdbotGateway(sandbox, c.env);
  } catch (error) {
    console.error('Failed to start Clawdbot:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    let hint = 'Check worker logs with: wrangler tail';
    if (!c.env.ANTHROPIC_API_KEY) {
      hint = 'ANTHROPIC_API_KEY is not set. Run: wrangler secret put ANTHROPIC_API_KEY';
    } else if (errorMessage.includes('heap out of memory') || errorMessage.includes('OOM')) {
      hint = 'Gateway ran out of memory. Try again or check for memory leaks.';
    }

    return c.json({
      error: 'Clawdbot gateway failed to start',
      details: errorMessage,
      hint,
    }, 503);
  }

  // Proxy to Clawdbot
  const url = new URL(request.url);

  if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
    console.log('Proxying WebSocket connection to Clawdbot');
    console.log('WebSocket URL:', request.url);
    console.log('WebSocket search params:', url.search);
    return sandbox.wsConnect(request, CLAWDBOT_PORT);
  }

  console.log('Proxying HTTP request:', url.pathname + url.search);
  return sandbox.containerFetch(request, CLAWDBOT_PORT);
});

export default app;
