#!/bin/bash
# Startup script for Moltbot in Cloudflare Sandbox
# This script:
# 1. Restores config from R2 backup if available
# 2. Configures moltbot from environment variables
# 3. Starts a background sync to backup config to R2
# 4. Starts the gateway

set -e

# Check if clawdbot gateway is already running AND responsive
# Note: CLI is still named "clawdbot" until upstream renames it
if pgrep -f "clawdbot gateway" > /dev/null 2>&1; then
    # Process exists, but is it responsive? Check if port 18789 responds
    if curl -s --max-time 3 http://localhost:18789/health > /dev/null 2>&1; then
        echo "Moltbot gateway is already running and responsive, exiting."
        exit 0
    else
        echo "Moltbot gateway process exists but is not responsive, will restart..."
        # Don't exit - let the cleanup below handle it
    fi
fi

# Paths (clawdbot paths are used internally - upstream hasn't renamed yet)
CONFIG_DIR="/root/.clawdbot"
CONFIG_FILE="$CONFIG_DIR/clawdbot.json"
TEMPLATE_DIR="/root/.clawdbot-templates"
TEMPLATE_FILE="$TEMPLATE_DIR/moltbot.json.template"
BACKUP_DIR="/data/moltbot"

echo "Config directory: $CONFIG_DIR"
echo "Backup directory: $BACKUP_DIR"

# Create config directory
mkdir -p "$CONFIG_DIR"

# ============================================================
# RESTORE FROM R2 BACKUP
# ============================================================
# Check if R2 backup exists by looking for clawdbot.json
# The BACKUP_DIR may exist but be empty if R2 was just mounted
# Note: backup structure is $BACKUP_DIR/clawdbot/ and $BACKUP_DIR/skills/

# Helper function to check if R2 backup is newer than local
should_restore_from_r2() {
    local R2_SYNC_FILE="$BACKUP_DIR/.last-sync"
    local LOCAL_SYNC_FILE="$CONFIG_DIR/.last-sync"
    
    # If no R2 sync timestamp, don't restore
    if [ ! -f "$R2_SYNC_FILE" ]; then
        echo "No R2 sync timestamp found, skipping restore"
        return 1
    fi
    
    # If no local sync timestamp, restore from R2
    if [ ! -f "$LOCAL_SYNC_FILE" ]; then
        echo "No local sync timestamp, will restore from R2"
        return 0
    fi
    
    # Compare timestamps
    R2_TIME=$(cat "$R2_SYNC_FILE" 2>/dev/null)
    LOCAL_TIME=$(cat "$LOCAL_SYNC_FILE" 2>/dev/null)
    
    echo "R2 last sync: $R2_TIME"
    echo "Local last sync: $LOCAL_TIME"
    
    # Convert to epoch seconds for comparison
    R2_EPOCH=$(date -d "$R2_TIME" +%s 2>/dev/null || echo "0")
    LOCAL_EPOCH=$(date -d "$LOCAL_TIME" +%s 2>/dev/null || echo "0")
    
    if [ "$R2_EPOCH" -gt "$LOCAL_EPOCH" ]; then
        echo "R2 backup is newer, will restore"
        return 0
    else
        echo "Local data is newer or same, skipping restore"
        return 1
    fi
}

if [ -f "$BACKUP_DIR/clawdbot/clawdbot.json" ]; then
    if should_restore_from_r2; then
        echo "Restoring from R2 backup at $BACKUP_DIR/clawdbot..."
        cp -a "$BACKUP_DIR/clawdbot/." "$CONFIG_DIR/"
        # Copy the sync timestamp to local so we know what version we have
        cp -f "$BACKUP_DIR/.last-sync" "$CONFIG_DIR/.last-sync" 2>/dev/null || true
        echo "Restored config from R2 backup"
    fi
elif [ -f "$BACKUP_DIR/clawdbot.json" ]; then
    # Legacy backup format (flat structure)
    if should_restore_from_r2; then
        echo "Restoring from legacy R2 backup at $BACKUP_DIR..."
        cp -a "$BACKUP_DIR/." "$CONFIG_DIR/"
        cp -f "$BACKUP_DIR/.last-sync" "$CONFIG_DIR/.last-sync" 2>/dev/null || true
        echo "Restored config from legacy R2 backup"
    fi
elif [ -d "$BACKUP_DIR" ]; then
    echo "R2 mounted at $BACKUP_DIR but no backup data found yet"
else
    echo "R2 not mounted, starting fresh"
fi

# Restore skills from R2 backup if available (only if R2 is newer)
SKILLS_DIR="/root/clawd/skills"
if [ -d "$BACKUP_DIR/skills" ] && [ "$(ls -A $BACKUP_DIR/skills 2>/dev/null)" ]; then
    if should_restore_from_r2; then
        echo "Restoring skills from $BACKUP_DIR/skills..."
        mkdir -p "$SKILLS_DIR"
        cp -a "$BACKUP_DIR/skills/." "$SKILLS_DIR/"
        echo "Restored skills from R2 backup"
    fi
fi

# ============================================================
# INITIALIZE WORKSPACE WITH DEFAULT TEMPLATES
# ============================================================
# Copy default identity/memory files if they don't exist
WORKSPACE_DIR="/root/clawd"
WORKSPACE_TEMPLATES="/root/.clawdbot-templates/workspace"

if [ -d "$WORKSPACE_TEMPLATES" ]; then
    echo "Checking workspace templates..."
    
    # Copy SOUL.md if not exists
    if [ ! -f "$WORKSPACE_DIR/SOUL.md" ] && [ -f "$WORKSPACE_TEMPLATES/SOUL.md" ]; then
        cp "$WORKSPACE_TEMPLATES/SOUL.md" "$WORKSPACE_DIR/"
        echo "  Initialized SOUL.md"
    fi
    
    # Copy HEARTBEAT.md if not exists
    if [ ! -f "$WORKSPACE_DIR/HEARTBEAT.md" ] && [ -f "$WORKSPACE_TEMPLATES/HEARTBEAT.md" ]; then
        cp "$WORKSPACE_TEMPLATES/HEARTBEAT.md" "$WORKSPACE_DIR/"
        echo "  Initialized HEARTBEAT.md"
    fi
    
    # Copy MEMORY.md if not exists
    if [ ! -f "$WORKSPACE_DIR/MEMORY.md" ] && [ -f "$WORKSPACE_TEMPLATES/MEMORY.md" ]; then
        cp "$WORKSPACE_TEMPLATES/MEMORY.md" "$WORKSPACE_DIR/"
        echo "  Initialized MEMORY.md"
    fi
    
    # Copy IDENTITY.md if not exists
    if [ ! -f "$WORKSPACE_DIR/IDENTITY.md" ] && [ -f "$WORKSPACE_TEMPLATES/IDENTITY.md" ]; then
        cp "$WORKSPACE_TEMPLATES/IDENTITY.md" "$WORKSPACE_DIR/"
        echo "  Initialized IDENTITY.md"
    fi
    
    # Copy USER.md if not exists
    if [ ! -f "$WORKSPACE_DIR/USER.md" ] && [ -f "$WORKSPACE_TEMPLATES/USER.md" ]; then
        cp "$WORKSPACE_TEMPLATES/USER.md" "$WORKSPACE_DIR/"
        echo "  Initialized USER.md"
    fi
    
    # Create memory directory and copy templates
    mkdir -p "$WORKSPACE_DIR/memory"
    if [ -d "$WORKSPACE_TEMPLATES/memory" ]; then
        for f in "$WORKSPACE_TEMPLATES/memory"/*.md; do
            [ -f "$f" ] || continue
            basename_f=$(basename "$f")
            if [ ! -f "$WORKSPACE_DIR/memory/$basename_f" ]; then
                cp "$f" "$WORKSPACE_DIR/memory/"
                echo "  Initialized memory/$basename_f"
            fi
        done
    fi
    
    # Create .learnings directory and copy templates
    mkdir -p "$WORKSPACE_DIR/.learnings"
    if [ -d "$WORKSPACE_TEMPLATES/.learnings" ]; then
        for f in "$WORKSPACE_TEMPLATES/.learnings"/*.md; do
            [ -f "$f" ] || continue
            basename_f=$(basename "$f")
            if [ ! -f "$WORKSPACE_DIR/.learnings/$basename_f" ]; then
                cp "$f" "$WORKSPACE_DIR/.learnings/"
                echo "  Initialized .learnings/$basename_f"
            fi
        done
    fi
    
    echo "Workspace initialization complete"
else
    echo "No workspace templates found, skipping initialization"
fi

# If config file still doesn't exist, create from template
if [ ! -f "$CONFIG_FILE" ]; then
    echo "No existing config found, initializing from template..."
    if [ -f "$TEMPLATE_FILE" ]; then
        cp "$TEMPLATE_FILE" "$CONFIG_FILE"
    else
        # Create minimal config if template doesn't exist
        cat > "$CONFIG_FILE" << 'EOFCONFIG'
{
  "agents": {
    "defaults": {
      "workspace": "/root/clawd"
    }
  },
  "gateway": {
    "port": 18789,
    "mode": "local"
  }
}
EOFCONFIG
    fi
else
    echo "Using existing config"
fi

# ============================================================
# UPDATE CONFIG FROM ENVIRONMENT VARIABLES
# ============================================================
node << EOFNODE
const fs = require('fs');

const configPath = '/root/.clawdbot/clawdbot.json';
console.log('Updating config at:', configPath);
let config = {};

try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
    console.log('Starting with empty config');
}

// Ensure nested objects exist
config.agents = config.agents || {};
config.agents.defaults = config.agents.defaults || {};
config.agents.defaults.model = config.agents.defaults.model || {};
config.gateway = config.gateway || {};
config.channels = config.channels || {};

// Clean up any broken anthropic provider config from previous runs
// (older versions didn't include required 'name' field)
if (config.models?.providers?.anthropic?.models) {
    const hasInvalidModels = config.models.providers.anthropic.models.some(m => !m.name);
    if (hasInvalidModels) {
        console.log('Removing broken anthropic provider config (missing model names)');
        delete config.models.providers.anthropic;
    }
}



// Gateway configuration
config.gateway.port = 18789;
config.gateway.mode = 'local';
config.gateway.trustedProxies = ['10.1.0.0'];

// Enable HTTP endpoints for API access
config.gateway.http = config.gateway.http || {};
config.gateway.http.endpoints = config.gateway.http.endpoints || {};
config.gateway.http.endpoints.chatCompletions = { enabled: true };

// Set gateway token if provided
if (process.env.CLAWDBOT_GATEWAY_TOKEN) {
    config.gateway.auth = config.gateway.auth || {};
    config.gateway.auth.token = process.env.CLAWDBOT_GATEWAY_TOKEN;
}

// Allow insecure auth for dev mode
if (process.env.CLAWDBOT_DEV_MODE === 'true') {
    config.gateway.controlUi = config.gateway.controlUi || {};
    config.gateway.controlUi.allowInsecureAuth = true;
}

// Telegram configuration
if (process.env.TELEGRAM_BOT_TOKEN) {
    config.channels.telegram = config.channels.telegram || {};
    config.channels.telegram.botToken = process.env.TELEGRAM_BOT_TOKEN;
    config.channels.telegram.enabled = true;
    config.channels.telegram.dm = config.channels.telegram.dm || {};
    config.channels.telegram.dmPolicy = process.env.TELEGRAM_DM_POLICY || 'pairing';
}

// Discord configuration
if (process.env.DISCORD_BOT_TOKEN) {
    config.channels.discord = config.channels.discord || {};
    config.channels.discord.token = process.env.DISCORD_BOT_TOKEN;
    config.channels.discord.enabled = true;
    config.channels.discord.dm = config.channels.discord.dm || {};
    config.channels.discord.dm.policy = process.env.DISCORD_DM_POLICY || 'pairing';
}

// Slack configuration
if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN) {
    config.channels.slack = config.channels.slack || {};
    config.channels.slack.botToken = process.env.SLACK_BOT_TOKEN;
    config.channels.slack.appToken = process.env.SLACK_APP_TOKEN;
    config.channels.slack.enabled = true;
}

// Base URL override (e.g., for Cloudflare AI Gateway, Groq, Workers AI, etc.)
// Usage: Set AI_GATEWAY_BASE_URL or ANTHROPIC_BASE_URL to your endpoint like:
//   https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/anthropic
//   https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/openai
//   https://api.groq.com/openai/v1
//   ${WORKER_URL}/ai/v1  (Workers AI - auto-configured when no external keys)
const baseUrl = (process.env.AI_GATEWAY_BASE_URL || process.env.OPENAI_BASE_URL || process.env.ANTHROPIC_BASE_URL || '').replace(/\/+$/, '');
const isWorkersAI = process.env.USE_WORKERS_AI === 'true' || baseUrl.includes('/ai/v1');
const isGroq = baseUrl.includes('groq.com');
const isOpenAI = baseUrl.includes('/openai') || isGroq || isWorkersAI;  // Workers AI uses OpenAI-compatible API

// Debug logging for AI provider detection
console.log('=== AI Provider Detection ===');
console.log('USE_WORKERS_AI:', process.env.USE_WORKERS_AI);
console.log('AI_GATEWAY_BASE_URL:', process.env.AI_GATEWAY_BASE_URL);
console.log('OPENAI_BASE_URL:', process.env.OPENAI_BASE_URL);
console.log('ANTHROPIC_BASE_URL:', process.env.ANTHROPIC_BASE_URL);
console.log('baseUrl:', baseUrl);
console.log('isWorkersAI:', isWorkersAI);
console.log('isGroq:', isGroq);
console.log('isOpenAI:', isOpenAI);
console.log('==============================');

if (isWorkersAI) {
    // Workers AI - provided by the worker's /ai/v1 endpoint
    console.log('Configuring Workers AI provider with base URL:', baseUrl);
    config.models = config.models || {};
    config.models.providers = config.models.providers || {};
    
    config.models.providers.openai = {
        baseUrl: baseUrl,
        api: 'openai-responses',
        apiKey: process.env.OPENAI_API_KEY || 'workers-ai',
        models: [
            { id: 'llama-3.1-8b-instruct', name: 'Llama 3.1 8B', contextWindow: 128000 },
            { id: 'mistral-7b-instruct', name: 'Mistral 7B', contextWindow: 32000 },
            { id: 'llama-3.2-3b-instruct', name: 'Llama 3.2 3B', contextWindow: 8192 },
        ]
    };
    
    config.agents.defaults.models = config.agents.defaults.models || {};
    config.agents.defaults.models['openai/llama-3.1-8b-instruct'] = { alias: 'Llama 3.1 8B' };
    config.agents.defaults.models['openai/mistral-7b-instruct'] = { alias: 'Mistral 7B' };
    config.agents.defaults.models['openai/llama-3.2-3b-instruct'] = { alias: 'Llama 3.2 3B' };
    
    // Use Llama 3.1 8B as primary (meets 16k context requirement)
    config.agents.defaults.model.primary = 'openai/llama-3.1-8b-instruct';
    console.log('Using Workers AI Llama 3.1 8B as primary');
} else if (isOpenAI) {
    // Create custom openai provider config with baseUrl override
    console.log('Configuring OpenAI-compatible provider with base URL:', baseUrl);
    config.models = config.models || {};
    config.models.providers = config.models.providers || {};
    
    // Include API key if set
    const apiKey = process.env.AI_GATEWAY_API_KEY || process.env.OPENAI_API_KEY;
    
    if (isGroq) {
        // Groq as primary provider
        console.log('Detected Groq provider');
        config.models.providers.openai = {
            baseUrl: baseUrl,
            api: 'openai-responses',
            apiKey: apiKey,
            models: [
                { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', contextWindow: 128000 },
                { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', contextWindow: 128000 },
                { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', contextWindow: 32768 },
            ]
        };
        
        // Add Mistral as fallback provider (free tier: 500K tokens/min, 1B tokens/month)
        const mistralApiKey = process.env.MISTRAL_API_KEY;
        if (mistralApiKey) {
            console.log('Adding Mistral as fallback provider');
            config.models.providers.mistral = {
                baseUrl: 'https://api.mistral.ai/v1',
                api: 'openai-responses',
                apiKey: mistralApiKey,
                models: [
                    { id: 'mistral-small-latest', name: 'Mistral Small', contextWindow: 32000 },
                    { id: 'mistral-large-latest', name: 'Mistral Large', contextWindow: 128000 },
                ]
            };
        }
        
        config.agents.defaults.models = config.agents.defaults.models || {};
        config.agents.defaults.models['openai/llama-3.3-70b-versatile'] = { alias: 'Llama 3.3 70B' };
        config.agents.defaults.models['openai/llama-3.1-8b-instant'] = { alias: 'Llama 3.1 8B' };
        config.agents.defaults.models['openai/mixtral-8x7b-32768'] = { alias: 'Mixtral 8x7B' };
        if (mistralApiKey) {
            config.agents.defaults.models['mistral/mistral-small-latest'] = { alias: 'Mistral Small' };
            config.agents.defaults.models['mistral/mistral-large-latest'] = { alias: 'Mistral Large' };
        }
        
        // Set primary model - use Mistral if available (Groq free tier has strict limits)
        if (mistralApiKey) {
            config.agents.defaults.model.primary = 'mistral/mistral-small-latest';
            console.log('Using Mistral as primary (better rate limits)');
        } else {
            config.agents.defaults.model.primary = 'openai/llama-3.3-70b-versatile';
        }
    } else {
        // Generic OpenAI-compatible provider
        config.models.providers.openai = {
            baseUrl: baseUrl,
            api: 'openai-responses',
            apiKey: apiKey,
            models: [
                { id: 'gpt-5.2', name: 'GPT-5.2', contextWindow: 200000 },
                { id: 'gpt-5', name: 'GPT-5', contextWindow: 200000 },
                { id: 'gpt-4.5-preview', name: 'GPT-4.5 Preview', contextWindow: 128000 },
            ]
        };
        config.agents.defaults.models = config.agents.defaults.models || {};
        config.agents.defaults.models['openai/gpt-5.2'] = { alias: 'GPT-5.2' };
        config.agents.defaults.models['openai/gpt-5'] = { alias: 'GPT-5' };
        config.agents.defaults.models['openai/gpt-4.5-preview'] = { alias: 'GPT-4.5' };
        config.agents.defaults.model.primary = 'openai/gpt-5.2';
    }
} else if (baseUrl) {
    console.log('Configuring Anthropic provider with base URL:', baseUrl);
    config.models = config.models || {};
    config.models.providers = config.models.providers || {};
    const providerConfig = {
        baseUrl: baseUrl,
        api: 'anthropic-messages',
        models: [
            { id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5', contextWindow: 200000 },
            { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', contextWindow: 200000 },
            { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', contextWindow: 200000 },
        ]
    };
    // Include API key in provider config if set (required when using custom baseUrl)
    if (process.env.ANTHROPIC_API_KEY) {
        providerConfig.apiKey = process.env.ANTHROPIC_API_KEY;
    }
    config.models.providers.anthropic = providerConfig;
    // Add models to the allowlist so they appear in /models
    config.agents.defaults.models = config.agents.defaults.models || {};
    config.agents.defaults.models['anthropic/claude-opus-4-5-20251101'] = { alias: 'Opus 4.5' };
    config.agents.defaults.models['anthropic/claude-sonnet-4-5-20250929'] = { alias: 'Sonnet 4.5' };
    config.agents.defaults.models['anthropic/claude-haiku-4-5-20251001'] = { alias: 'Haiku 4.5' };
    config.agents.defaults.model.primary = 'anthropic/claude-opus-4-5-20251101';
} else if (process.env.ANTHROPIC_API_KEY) {
    // Direct Anthropic API key without custom base URL
    console.log('Configuring Anthropic provider with direct API key');
    config.models = config.models || {};
    config.models.providers = config.models.providers || {};
    config.models.providers.anthropic = {
        baseUrl: 'https://api.anthropic.com',
        apiKey: process.env.ANTHROPIC_API_KEY,
        api: 'anthropic-messages',
        models: [
            { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet', contextWindow: 200000 },
            { id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku', contextWindow: 200000 },
            { id: 'claude-3-opus-latest', name: 'Claude 3 Opus', contextWindow: 200000 },
        ]
    };
    config.agents.defaults.models = config.agents.defaults.models || {};
    config.agents.defaults.models['anthropic/claude-3-5-sonnet-latest'] = { alias: 'Sonnet 3.5' };
    config.agents.defaults.models['anthropic/claude-3-5-haiku-latest'] = { alias: 'Haiku 3.5' };
    config.agents.defaults.models['anthropic/claude-3-opus-latest'] = { alias: 'Opus 3' };
    config.agents.defaults.model.primary = 'anthropic/claude-3-5-sonnet-latest';
} else {
    // Default to Anthropic without custom base URL (uses built-in pi-ai catalog)
    config.agents.defaults.model.primary = 'anthropic/claude-opus-4-5';
}

// Write updated config
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log('Configuration updated successfully');
console.log('Config:', JSON.stringify(config, null, 2));
EOFNODE

# ============================================================
# START GATEWAY
# ============================================================
# Note: R2 backup sync is handled by the Worker's cron trigger
echo "Starting Moltbot Gateway..."
echo "Gateway will be available on port 18789"

# Kill any orphan gateway processes (they may have lost their lock but still hold the port)
echo "Cleaning up orphan processes..."
pkill -9 -f "clawdbot gateway" 2>/dev/null || true
pkill -9 -f "node.*clawdbot" 2>/dev/null || true

# Wait a moment for processes to die
sleep 2

# Kill anything on port 18789
fuser -k 18789/tcp 2>/dev/null || true

# Clean up ALL stale lock files
rm -f /tmp/clawdbot-gateway.lock 2>/dev/null || true
rm -f /tmp/clawdbot*.lock 2>/dev/null || true
rm -f "$CONFIG_DIR/gateway.lock" 2>/dev/null || true
rm -f "$CONFIG_DIR/*.lock" 2>/dev/null || true

# Wait for port to be released
sleep 1

BIND_MODE="lan"
echo "Dev mode: ${CLAWDBOT_DEV_MODE:-false}, Bind mode: $BIND_MODE"

if [ -n "$CLAWDBOT_GATEWAY_TOKEN" ]; then
    echo "Starting gateway with token auth..."
    exec clawdbot gateway --port 18789 --verbose --allow-unconfigured --bind "$BIND_MODE" --token "$CLAWDBOT_GATEWAY_TOKEN"
else
    echo "Starting gateway with device pairing (no token)..."
    exec clawdbot gateway --port 18789 --verbose --allow-unconfigured --bind "$BIND_MODE"
fi
