import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createMockSandbox, createMockProcess, createMockEnv, suppressConsole } from '../test-utils';
import type { AppEnv } from '../types';

// Mock the gateway module
vi.mock('../gateway', () => ({
  ensureMoltbotGateway: vi.fn().mockResolvedValue(undefined),
  waitForProcess: vi.fn().mockResolvedValue(undefined),
}));

// Mock the auth middleware to bypass authentication in tests
vi.mock('../auth', () => ({
  createAccessMiddleware: () => async (c: any, next: any) => next(),
}));

describe('Sessions API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    suppressConsole();
  });

  describe('GET /api/admin/sessions', () => {
    it('returns sessions list from CLI output', async () => {
      const mockSessionsOutput = JSON.stringify({
        path: '/root/.clawdbot/sessions/sessions.json',
        count: 2,
        activeMinutes: null,
        sessions: [
          {
            key: 'agent:main:telegram:123',
            kind: 'direct',
            updatedAt: 1700000000000,
            ageMs: 3600000,
            sessionId: 'abc-123',
            totalTokens: 1000,
            model: 'claude-3',
          },
          {
            key: 'agent:main:discord:456',
            kind: 'channel',
            updatedAt: 1699990000000,
            ageMs: 13600000,
            sessionId: 'def-456',
            totalTokens: 500,
            model: 'claude-3',
          },
        ],
      });

      const { sandbox, startProcessMock } = createMockSandbox();
      startProcessMock.mockResolvedValue(createMockProcess(mockSessionsOutput));

      // Import and test the route handler
      const { api } = await import('./api');
      
      const app = new Hono<AppEnv>();
      app.use('*', async (c, next) => {
        c.set('sandbox', sandbox);
        c.env = createMockEnv();
        await next();
      });
      app.route('/api', api);

      const res = await app.request('/api/admin/sessions');
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.sessions).toHaveLength(2);
      expect(data.sessions[0].key).toBe('agent:main:telegram:123');
      expect(data.count).toBe(2);
    });

    it('filters sessions by active minutes when provided', async () => {
      const { sandbox, startProcessMock } = createMockSandbox();
      startProcessMock.mockResolvedValue(createMockProcess('{"sessions": [], "count": 0}'));

      const { api } = await import('./api');
      
      const app = new Hono<AppEnv>();
      app.use('*', async (c, next) => {
        c.set('sandbox', sandbox);
        c.env = createMockEnv();
        await next();
      });
      app.route('/api', api);

      await app.request('/api/admin/sessions?active=60');
      
      // Verify the CLI was called with --active flag
      expect(startProcessMock).toHaveBeenCalledWith(
        expect.stringContaining('--active 60')
      );
    });

    it('handles empty sessions gracefully', async () => {
      const { sandbox, startProcessMock } = createMockSandbox();
      startProcessMock.mockResolvedValue(createMockProcess('{"sessions": [], "count": 0}'));

      const { api } = await import('./api');
      
      const app = new Hono<AppEnv>();
      app.use('*', async (c, next) => {
        c.set('sandbox', sandbox);
        c.env = createMockEnv();
        await next();
      });
      app.route('/api', api);

      const res = await app.request('/api/admin/sessions');
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.sessions).toEqual([]);
    });

    it('handles CLI parse errors', async () => {
      const { sandbox, startProcessMock } = createMockSandbox();
      startProcessMock.mockResolvedValue(createMockProcess('not valid json'));

      const { api } = await import('./api');
      
      const app = new Hono<AppEnv>();
      app.use('*', async (c, next) => {
        c.set('sandbox', sandbox);
        c.env = createMockEnv();
        await next();
      });
      app.route('/api', api);

      const res = await app.request('/api/admin/sessions');
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.sessions).toEqual([]);
      // When no JSON is found, raw output is included for debugging
      expect(data.raw).toBe('not valid json');
    });
  });

  describe('GET /api/admin/sessions/:sessionKey/history', () => {
    it('returns message history for a session', async () => {
      const sessionsJson = JSON.stringify({
        'agent:main:telegram:123': {
          sessionId: 'abc-123',
          sessionFile: '/root/.clawdbot/sessions/abc-123.jsonl',
        },
      });

      const messagesJsonl = [
        '{"role":"user","content":"Hello"}',
        '{"role":"assistant","content":"Hi there!"}',
        '{"role":"user","content":"How are you?"}',
      ].join('\n');

      const { sandbox, startProcessMock } = createMockSandbox();
      
      // First call: sessions --json
      // Second call: cat sessions.json
      // Third call: tail sessionFile
      let callCount = 0;
      startProcessMock.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(createMockProcess('{"path":"/root/.clawdbot/sessions/sessions.json"}'));
        } else if (callCount === 2) {
          return Promise.resolve(createMockProcess(sessionsJson));
        } else {
          return Promise.resolve(createMockProcess(messagesJsonl));
        }
      });

      const { api } = await import('./api');
      
      const app = new Hono<AppEnv>();
      app.use('*', async (c, next) => {
        c.set('sandbox', sandbox);
        c.env = createMockEnv();
        await next();
      });
      app.route('/api', api);

      const res = await app.request('/api/admin/sessions/agent%3Amain%3Atelegram%3A123/history');
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.messages).toHaveLength(3);
      expect(data.messages[0].role).toBe('user');
      expect(data.messages[0].content).toBe('Hello');
      expect(data.messages[1].role).toBe('assistant');
    });

    it('returns 404 for non-existent session', async () => {
      const { sandbox, startProcessMock } = createMockSandbox();
      startProcessMock
        .mockResolvedValueOnce(createMockProcess('{"path":"/sessions.json"}'))
        .mockResolvedValueOnce(createMockProcess('{}'));

      const { api } = await import('./api');
      
      const app = new Hono<AppEnv>();
      app.use('*', async (c, next) => {
        c.set('sandbox', sandbox);
        c.env = createMockEnv();
        await next();
      });
      app.route('/api', api);

      const res = await app.request('/api/admin/sessions/nonexistent/history');
      expect(res.status).toBe(404);
      
      const data = await res.json();
      expect(data.error).toBe('Session not found');
    });

    it('respects limit parameter', async () => {
      const { sandbox, startProcessMock } = createMockSandbox();
      
      startProcessMock
        .mockResolvedValueOnce(createMockProcess('{"path":"/sessions.json"}'))
        .mockResolvedValueOnce(createMockProcess('{"test-key":{"sessionFile":"/test.jsonl"}}'))
        .mockResolvedValueOnce(createMockProcess('{"role":"user","content":"test"}'));

      const { api } = await import('./api');
      
      const app = new Hono<AppEnv>();
      app.use('*', async (c, next) => {
        c.set('sandbox', sandbox);
        c.env = createMockEnv();
        await next();
      });
      app.route('/api', api);

      await app.request('/api/admin/sessions/test-key/history?limit=10');
      
      // Verify tail was called with the limit
      expect(startProcessMock).toHaveBeenCalledWith(
        expect.stringContaining('tail -n 10')
      );
    });
  });
});
