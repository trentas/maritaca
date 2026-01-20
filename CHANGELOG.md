# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2024-12-XX

### Added

- Initial release of Maritaca v0.1
- Core package with envelope types, validation, and provider interfaces
- API package with Fastify HTTP server
- Worker package with BullMQ worker for processing notifications
- SDK package with TypeScript client
- Slack provider with real API integration
- Email provider (mock implementation)
- PostgreSQL database schema with Drizzle ORM
- Redis queue integration with BullMQ
- Docker Compose setup for all services
- Comprehensive test suite with 80%+ coverage
- API Key authentication
- Event system for tracking message lifecycle
- Idempotency support
- Multi-channel notification support

### Technical Details

- Node.js 22 LTS
- TypeScript 5.6+
- Fastify 4.x
- Drizzle ORM
- BullMQ
- Vitest for testing
- pnpm monorepo with Turborepo
