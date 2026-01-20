# Contributing to Maritaca

Thank you for your interest in contributing to Maritaca! This document provides guidelines and instructions for contributing.

## Code of Conduct

Please read and follow our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/yourusername/maritaca.git`
3. Install dependencies: `pnpm install`
4. Create a branch: `git checkout -b feature/your-feature-name`

## Development Workflow

### Prerequisites

- Node.js 22 LTS
- pnpm 8+
- Docker and Docker Compose

### Setup

1. Copy `.env.example` to `.env` and configure
2. Start services: `docker-compose up -d`
3. Run migrations: `cd packages/core && pnpm db:push`

### Making Changes

1. Make your changes in the appropriate package
2. Write tests for your changes (aim for 80%+ coverage)
3. Run tests: `pnpm test`
4. Check types: `pnpm typecheck`
5. Build: `pnpm build`

### Testing

All code must have tests with minimum 80% coverage:

```bash
# Run all tests
pnpm test

# Run tests with coverage
pnpm test:coverage
```

### Code Style

- Use TypeScript for all code
- Follow existing code style and patterns
- Write clear, descriptive commit messages
- All code, comments, and documentation must be in English

### Commit Messages

Use clear, descriptive commit messages:

```
feat: add email provider support
fix: resolve idempotency key collision
docs: update README with new examples
test: add tests for envelope validation
```

## Pull Request Process

1. Ensure all tests pass
2. Ensure coverage is at least 80%
3. Update documentation if needed
4. Create a pull request with a clear description
5. Reference any related issues

## Adding New Providers

To add a new provider:

1. Create a new provider class in `packages/worker/src/providers/`
2. Implement the `Provider` interface from `@maritaca/core`
3. Add provider to `getProviderForChannel` in `packages/worker/src/processors/message.ts`
4. Write comprehensive tests
5. Update documentation

## Questions?

Open an issue for questions or discussions.
