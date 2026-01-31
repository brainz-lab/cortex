# Cortex

Feature flags and rollout management for Rails apps.

[![CI](https://github.com/brainz-lab/cortex/actions/workflows/ci.yml/badge.svg)](https://github.com/brainz-lab/cortex/actions/workflows/ci.yml)
[![CodeQL](https://github.com/brainz-lab/cortex/actions/workflows/codeql.yml/badge.svg)](https://github.com/brainz-lab/cortex/actions/workflows/codeql.yml)
[![codecov](https://codecov.io/gh/brainz-lab/cortex/graph/badge.svg)](https://codecov.io/gh/brainz-lab/cortex)
[![License: OSAaSy](https://img.shields.io/badge/License-OSAaSy-blue.svg)](LICENSE)
[![Ruby](https://img.shields.io/badge/Ruby-3.2+-red.svg)](https://www.ruby-lang.org)

## Quick Start

```ruby
# In your application
if Cortex.enabled?(:new_checkout, user: current_user)
  render_new_checkout
else
  render_old_checkout
end
```

## Installation

### With Docker

```bash
docker pull brainzllc/cortex:latest

docker run -d \
  -p 3000:3000 \
  -e DATABASE_URL=postgres://user:pass@host:5432/cortex \
  -e REDIS_URL=redis://host:6379/5 \
  -e RAILS_MASTER_KEY=your-master-key \
  brainzllc/cortex:latest
```

### Local Development

```bash
bin/setup
bin/rails server
```

## Configuration

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection | Yes |
| `REDIS_URL` | Redis for fast flag evaluation | Yes |
| `RAILS_MASTER_KEY` | Rails credentials | Yes |
| `BRAINZLAB_PLATFORM_URL` | Platform URL for auth | Yes |

### Tech Stack

- **Ruby** 3.4.7 / **Rails** 8.1
- **PostgreSQL** 16
- **Redis** 7 (fast flag evaluation)
- **Hotwire** (Turbo + Stimulus) / **Tailwind CSS**
- **Solid Queue** / **ActionCable** (flag change propagation)

## Usage

### SDK Integration

```ruby
# Check if flag is enabled
if Cortex.enabled?(:new_checkout, user: current_user)
  render_new_checkout
else
  render_old_checkout
end

# Get variant for A/B test
variant = Cortex.variant(:pricing_page, user: current_user)
case variant
when "control"
  render_control_pricing
when "variant_a"
  render_variant_a_pricing
end
```

### Flag Types

| Type | Description | Use Case |
|------|-------------|----------|
| **Boolean** | Simple on/off toggle | Kill switches, feature gates |
| **Percentage** | Gradual rollout (0-100%) | Progressive rollouts |
| **Segment** | Target specific user groups | Beta users, premium plans |
| **A/B Test** | Multiple variants with weights | Experiments |

### Targeting Rules

Target users based on:
- User attributes (plan, role, company)
- Request context (country, device, browser)
- Custom properties
- Percentage-based sampling

### Segments

Create reusable segments:
- Beta users
- Enterprise customers
- Internal team
- Specific regions

## API Reference

### Flags
- `GET /api/v1/flags` - List flags
- `POST /api/v1/flags` - Create flag
- `GET /api/v1/evaluate` - Evaluate flags for context
- `POST /api/v1/flags/:id/toggle` - Toggle flag

### Segments
- `GET /api/v1/segments` - List segments
- `POST /api/v1/segments` - Create segment

### MCP Tools

| Tool | Description |
|------|-------------|
| `cortex_check` | Check if a flag is enabled for context |
| `cortex_flags` | List all flags and their states |
| `cortex_toggle` | Enable/disable a flag |
| `cortex_rollout` | Adjust rollout percentage |

Full documentation: [docs.brainzlab.ai/products/cortex](https://docs.brainzlab.ai/products/cortex/overview)

## Self-Hosting

### Docker Compose

```yaml
services:
  cortex:
    image: brainzllc/cortex:latest
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://user:pass@db:5432/cortex
      REDIS_URL: redis://redis:6379/5
      RAILS_MASTER_KEY: ${RAILS_MASTER_KEY}
      BRAINZLAB_PLATFORM_URL: http://platform:3000
    depends_on:
      - db
      - redis
```

### Testing

```bash
bin/rails test
bin/rubocop
```

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for development setup and contribution guidelines.

## License

This project is licensed under the [OSAaSy License](LICENSE).
