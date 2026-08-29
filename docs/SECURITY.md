# Security

## Auth

- Argon2id passwords
- JWT access tokens (short TTL) + rotating refresh tokens (hashed at rest)
- API keys shown once, stored as SHA-256, prefix indexed
- RBAC: SUPER_ADMIN, ORG_ADMIN, MANAGER, AGENT
- Agents cannot read WhatsApp session files or channel credentials

## Tenant isolation

Every query includes `organizationId` from the JWT/API key. Super-admins are installation-wide. Do not expose another org’s contacts, calls, recordings, sessions, campaigns, or keys.

## Transport and headers

- Helmet on the API
- CORS allowlist (`CORS_ORIGINS`)
- Rate limiting
- Cookies: httpOnly, SameSite=lax, Secure in production
- Nginx TLS 1.2/1.3 and HSTS after certificates exist

## Secrets

Never commit `.env`. Setup generates `JWT_SECRET`, `ENCRYPTION_KEY`, `INTERNAL_TOKEN`, and the database password. The WhatsApp service requires `x-internal-token` on `/internal/*`.

Session directories are `SESSION_DIR/{organizationId}/{channelId}` on a Docker volume. They are credentials.

## WhatsApp policy

Linked-device automation can violate WhatsApp terms and result in bans. WaCalls does not implement ban evasion, account rotation, or spam tools. Honor DO_NOT_CALL.

## Recording / AI

Obtain lawful consent. Do not log session keys, API secrets, or raw auth state.
