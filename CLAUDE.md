# CLAUDE.md

> **Secrets Reference**: See `../.secrets.md` (gitignored) for master keys, server access, and MCP tokens.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: Cortex by Brainz Lab

Feature flags and rollout management system for Rails applications.

**Domain**: cortex.brainzlab.ai

**Tagline**: "Smart feature decisions"

**Status**: Not yet implemented - see cortex-claude-code-prompt.md for full specification

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CORTEX (Rails 8)                         │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │  Dashboard   │  │     API      │  │  MCP Server  │           │
│  │  (Hotwire)   │  │  (JSON API)  │  │   (Ruby)     │           │
│  │ /dashboard/* │  │  /api/v1/*   │  │   /mcp/*     │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
│                           │                  │                   │
│                           ▼                  ▼                   │
│              ┌─────────────────────────────────────┐            │
│              │       PostgreSQL + Redis            │            │
│              └─────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │
                    ┌─────────┴─────────┐
                    │   SDK Clients     │
                    │ Fast evaluation   │
                    └───────────────────┘
```

## Tech Stack

- **Backend**: Rails 8 API + Dashboard
- **Frontend**: Hotwire (Turbo + Stimulus), Tailwind CSS
- **Database**: PostgreSQL
- **Cache**: Redis (fast flag evaluation)
- **Background Jobs**: Solid Queue
- **Real-time**: ActionCable (flag change propagation)

## Key Models

- **Flag**: Feature flag definition
- **FlagRule**: Targeting rules for a flag
- **FlagVariant**: A/B test variants
- **Segment**: Reusable user segments
- **SegmentRule**: Rules defining segment membership
- **Environment**: Environment-specific flag states
- **FlagEnvironment**: Flag state per environment
- **EvaluationLog**: Flag evaluation history
- **AuditLog**: Change history

## Flag Types

- **Boolean**: Simple on/off toggle
- **Percentage**: Gradual rollout (0-100%)
- **Segment**: Target specific user groups
- **A/B Test**: Multiple variants with weights

## Key Services

- **Evaluator**: Evaluates flags for a given context
- **TargetingEngine**: Matches users to targeting rules
- **PercentageCalculator**: Consistent percentage bucketing
- **VariantAssigner**: A/B test variant assignment
- **CacheManager**: Redis cache for fast lookups

## MCP Tools

| Tool | Description |
|------|-------------|
| `cortex_check` | Check if a flag is enabled for context |
| `cortex_flags` | List all flags and their states |
| `cortex_toggle` | Enable/disable a flag |
| `cortex_rollout` | Adjust rollout percentage |

## API Endpoints

- `GET /api/v1/flags` - List flags
- `POST /api/v1/flags` - Create flag
- `GET /api/v1/evaluate` - Evaluate flags for context
- `GET /api/v1/segments` - List segments
- `POST /api/v1/flags/:id/toggle` - Toggle flag

Authentication: `Authorization: Bearer <key>` or `X-API-Key: <key>`

## SDK Usage

```ruby
if Cortex.enabled?(:new_checkout, user: current_user)
  render_new_checkout
else
  render_old_checkout
end
```

## Kamal Production Access

**IMPORTANT**: When using `kamal app exec --reuse`, docker exec doesn't inherit container environment variables. You must pass `SECRET_KEY_BASE` explicitly.

```bash
# Navigate to this service directory
cd /Users/afmp/brainz/brainzlab/cortex

# Get the master key (used as SECRET_KEY_BASE)
cat config/master.key

# Run Rails console commands
kamal app exec -p --reuse -e SECRET_KEY_BASE:<master_key> 'bin/rails runner "<ruby_code>"'

# Example: Count flags
kamal app exec -p --reuse -e SECRET_KEY_BASE:<master_key> 'bin/rails runner "puts Flag.count"'
```

### Running Complex Scripts

For multi-line Ruby scripts, create a local file, scp to server, docker cp into container, then run with rails runner. See main brainzlab/CLAUDE.md for details.

### Other Kamal Commands

```bash
kamal deploy              # Deploy
kamal app logs -f         # View logs
kamal lock release        # Release stuck lock
kamal secrets print       # Print evaluated secrets
```
