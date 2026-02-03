/**
 * Workers AI Routes
 * 
 * Provides an OpenAI-compatible API endpoint using Cloudflare Workers AI.
 * This allows the Moltbot container to use Workers AI as its LLM backend
 * without needing external API keys.
 * 
 * Endpoint: /ai/v1/chat/completions (OpenAI-compatible)
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppEnv } from '../types';

// Default model to use if none specified (needs 16k+ context for Clawdbot)
const DEFAULT_MODEL = '@cf/meta/llama-3.1-8b-instruct';

// Model mapping: OpenAI-style names to Workers AI model names
const MODEL_MAP: Record<string, string> = {
  // Short names
  'llama-3.2-3b': '@cf/meta/llama-3.2-3b-instruct',
  'llama-3.2-3b-instruct': '@cf/meta/llama-3.2-3b-instruct',
  'llama-3.1-8b': '@cf/meta/llama-3.1-8b-instruct',
  'llama-3.1-8b-instruct': '@cf/meta/llama-3.1-8b-instruct',
  'mistral-7b': '@cf/mistral/mistral-7b-instruct-v0.2',
  'mistral-7b-instruct': '@cf/mistral/mistral-7b-instruct-v0.2',
  // With openai/ prefix (how Clawdbot sends them)
  'openai/llama-3.2-3b-instruct': '@cf/meta/llama-3.2-3b-instruct',
  'openai/llama-3.1-8b-instruct': '@cf/meta/llama-3.1-8b-instruct',
  'openai/mistral-7b-instruct': '@cf/mistral/mistral-7b-instruct-v0.2',
  // Allow using full Workers AI model names directly
  '@cf/meta/llama-3.2-3b-instruct': '@cf/meta/llama-3.2-3b-instruct',
  '@cf/meta/llama-3.1-8b-instruct': '@cf/meta/llama-3.1-8b-instruct',
  '@cf/mistral/mistral-7b-instruct-v0.2': '@cf/mistral/mistral-7b-instruct-v0.2',
};

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export const ai = new Hono<AppEnv>();

// CORS middleware - allow container to call this endpoint
ai.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Length'],
  maxAge: 86400,
}));

// Explicit OPTIONS handler for preflight requests
ai.options('*', (c) => {
  console.log('[AI] OPTIONS preflight request received');
  return c.text('', 204);
});

// OpenAI-compatible chat completions endpoint
ai.post('/v1/chat/completions', async (c) => {
  console.log('[AI] ============= CHAT COMPLETION REQUEST =============');
  console.log('[AI] Headers:', JSON.stringify(Object.fromEntries(c.req.raw.headers)));
  console.log('[AI] URL:', c.req.url);
  
  try {
    const body: ChatCompletionRequest = await c.req.json();
    console.log('[AI] Body received:', JSON.stringify(body).slice(0, 500));
    
    if (!body.messages || !Array.isArray(body.messages)) {
      return c.json({ error: { message: 'messages is required and must be an array' } }, 400);
    }

    // Map model name to Workers AI model
    const requestedModel = body.model || 'llama-3.2-3b';
    const workersAiModel = MODEL_MAP[requestedModel] || DEFAULT_MODEL;
    
    console.log(`[AI] Chat completion request: model=${requestedModel} -> ${workersAiModel}, messages=${body.messages.length}`);

    // Call Workers AI
    const response = await c.env.AI.run(workersAiModel, {
      messages: body.messages,
      max_tokens: body.max_tokens || 1024,
      temperature: body.temperature,
    });

    // Format response in OpenAI-compatible format
    const result: ChatCompletionResponse = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: requestedModel,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: response.response || '',
        },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: 0, // Workers AI doesn't provide token counts
        completion_tokens: 0,
        total_tokens: 0,
      },
    };

    return c.json(result);
  } catch (error) {
    console.error('[AI] Error:', error);
    return c.json({ 
      error: { 
        message: error instanceof Error ? error.message : 'Internal server error',
        type: 'internal_error',
      } 
    }, 500);
  }
});

// List available models (OpenAI-compatible)
ai.get('/v1/models', async (c) => {
  const models = [
    {
      id: 'llama-3.2-3b-instruct',
      object: 'model',
      created: 1700000000,
      owned_by: 'meta',
    },
    {
      id: 'llama-3.1-8b-instruct',
      object: 'model',
      created: 1700000000,
      owned_by: 'meta',
    },
    {
      id: 'mistral-7b-instruct',
      object: 'model',
      created: 1700000000,
      owned_by: 'mistral',
    },
  ];

  return c.json({
    object: 'list',
    data: models,
  });
});

// Health check for AI endpoint
ai.get('/health', async (c) => {
  return c.json({ 
    status: 'ok', 
    service: 'workers-ai',
    default_model: DEFAULT_MODEL,
  });
});

// OpenAI Responses API endpoint (used by openai-responses API type)
// This is a different API format than chat completions
ai.post('/v1/responses', async (c) => {
  console.log('[AI] ============= RESPONSES API REQUEST =============');
  console.log('[AI] Headers:', JSON.stringify(Object.fromEntries(c.req.raw.headers)));
  console.log('[AI] URL:', c.req.url);
  
  try {
    const body = await c.req.json();
    console.log('[AI] Responses body:', JSON.stringify(body).slice(0, 500));
    
    // The responses API has a different format - extract messages from input
    const messages = body.input || body.messages || [];
    const model = body.model || 'llama-3.1-8b';
    const workersAiModel = MODEL_MAP[model] || DEFAULT_MODEL;
    
    console.log(`[AI] Responses API: model=${model} -> ${workersAiModel}`);
    
    // Call Workers AI
    const response = await c.env.AI.run(workersAiModel, {
      messages: Array.isArray(messages) ? messages : [{ role: 'user', content: String(messages) }],
      max_tokens: body.max_tokens || 1024,
      temperature: body.temperature,
    });

    // Format in OpenAI Responses API format
    const result = {
      id: `resp-${Date.now()}`,
      object: 'response',
      created_at: Math.floor(Date.now() / 1000),
      model: model,
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{
          type: 'output_text',
          text: response.response || '',
        }],
      }],
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
      },
    };

    return c.json(result);
  } catch (error) {
    console.error('[AI] Responses API Error:', error);
    return c.json({ 
      error: { 
        message: error instanceof Error ? error.message : 'Internal server error',
        type: 'internal_error',
      } 
    }, 500);
  }
});

// Catch-all to log any unmatched AI requests
ai.all('*', (c) => {
  console.log('[AI] ============= UNMATCHED REQUEST =============');
  console.log('[AI] Method:', c.req.method);
  console.log('[AI] URL:', c.req.url);
  console.log('[AI] Path:', c.req.path);
  return c.json({ 
    error: 'Unknown AI endpoint',
    method: c.req.method,
    path: c.req.path,
    hint: 'Use /v1/chat/completions or /v1/responses',
  }, 404);
});
