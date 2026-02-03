# Learnings Directory

This folder stores lessons learned from errors, corrections, and discoveries.

## When to Add a Learning

1. **When something fails** — What went wrong? How to avoid it?
2. **When you're corrected** — What was the mistake? What's the right approach?
3. **When you discover something** — New capability, better method, gotcha to remember

## File Format

Name files descriptively: `YYYY-MM-DD-topic.md`

Example:
```markdown
# Learning: API Rate Limits

**Date:** 2026-01-15
**Category:** Error

## What Happened
Tried to send 100 requests in a loop, got rate limited.

## Lesson
Always check rate limits before bulk operations.
Add delays between requests.

## How to Avoid
- Check API docs for rate limits
- Use exponential backoff
- Batch where possible
```

## Review Your Learnings

Before major tasks, scan this folder for relevant lessons.
Don't repeat mistakes you've already logged.
