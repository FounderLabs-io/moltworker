FROM docker.io/cloudflare/sandbox:0.7.0

# Install Node.js 22 and rsync only - clawdbot will be installed at runtime
# This dramatically reduces image size and build disk usage
ENV NODE_VERSION=22.13.1
RUN apt-get update && apt-get install -y --no-install-recommends xz-utils ca-certificates rsync \
    && curl -fsSLk https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz -o /tmp/node.tar.xz \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
    && rm /tmp/node.tar.xz \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* \
    && node --version \
    && npm --version

# Create moltbot directories
RUN mkdir -p /root/.clawdbot \
    && mkdir -p /root/.clawdbot-templates \
    && mkdir -p /root/clawd \
    && mkdir -p /root/clawd/skills

# Copy startup script (will install clawdbot on first run if not present)
COPY start-moltbot.sh /usr/local/bin/start-moltbot.sh
RUN chmod +x /usr/local/bin/start-moltbot.sh

# Copy templates and skills
COPY moltbot.json.template /root/.clawdbot-templates/moltbot.json.template
COPY templates/workspace/ /root/.clawdbot-templates/workspace/
COPY skills/ /root/clawd/skills/

# Set working directory
WORKDIR /root/clawd

# Expose the gateway port
EXPOSE 18789
