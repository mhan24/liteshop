# LiteShop

中文版：[README.md](README.md) ｜ Changelog: [CHANGELOG.md](CHANGELOG.md)

**LiteShop v0.2.0 (codename: Moon)** — an automated digital-goods delivery (card / activation-code) shop built with **Go + SQLite**, integrated with the [BEpusdt](https://github.com/v03413/BEpusdt) and [HashPay](https://github.com/TGDash/HashPay) crypto payment gateways (**both can run at once; buyers choose**). The buyer storefront uses Nuxt 3 SSR + Tailwind; the admin panel uses Vue 3 + TypeScript + Element Plus + Pinia; Go serves the JSON API, payment callbacks, the embedded admin SPA, and background jobs.

> Version history: v0.1.0 codename **Earth**; v0.2.0 codename **Moon** — layering, abstractions, observability, and stability upgrades, see [CHANGELOG](CHANGELOG.md).
>
> This project is not affiliated with the BEpusdt author. BEpusdt is GPL-3.0; this project is MIT.

---

## Features

### Storefront (Nuxt 3 SSR)

- Product listing: categories / pinned / sorting / search / price filter
- Product detail + Cloudflare Turnstile
- Checkout: open the checkout in a new tab, redirect to the order page
- Order detail: auto-poll while pending, cards revealed on payment success, cancel order (synchronously closes the gateway transaction)
- Order lookup: email-only recovery + "send view link to my email" (blurred response — never reveals whether an email has ordered)
- Access credentials: every order (including legacy backfilled ones) uses a **view token** sent by email to view cards / cancel; tokens are only mailed to the registered address, and the lookup API never returns order numbers or links
- Privacy / Terms / first-time `/setup`
- SEO: canonical / OG / JSON-LD / sitemap / robots / favicon

### Admin panel (Vue 3 SPA)

- Dashboard: products / cards / orders stats, sales trend & product share, profit (cost snapshot), low-stock alerts
- Products: create / edit / category / pinned / sorting / price / status / FAQ / wholesale tiers / purchase limits
- Cards: import (dedupe) / delete / export
- Orders: view / CSV export / mark expired / cancel / set status / resend / batch resend / redeliver
- Coupons: fixed / percent, minimum amount, max uses, product scope, validity window; **100% coupons complete the order automatically and deliver cards immediately**
- Payment: **dual gateways (BEpusdt / HashPay, each independently enabled)** with per-gateway config (base URL / token / merchant private key / trade types / currency / timeout / callback URL, changes apply immediately)
- Notifications: SMTP / Telegram / Webhook + **event templates** (order created / payment success / delivered / low stock / system error) + admin notification email + test buttons
- Site: title / announcement / **public base URL** / logo / favicon / SEO / links / copyright / privacy / terms / Turnstile
- Maintenance mode: toggle + notice + unlock password (hashed + AES-encrypted storage)
- Account: change username / change password
- Security: TOTP 2FA (Google Authenticator, AES-encrypted secret), admin RBAC + audit logs
- System: config backup / restore (excludes secrets) / wipe and re-init / **background job status** (last run per job + mail queue backlog + dead events)

### Backend (Go)

- SQLite storage (pure Go, no CGO); no application-level environment variables — **all configuration is written to the database** during `/setup` and from the admin panel
- Config system: `settings` + `secrets` (AES-GCM encrypted) + `settings_version` (config-structure upgrade versions)
- Layering: api (handler) → service (business) → db/repository (data) → db/schema (schema evolution)
- Domain events: typed events in `internal/events` (OrderPaid / OrderExpired / DeliveryFailed / LowStock …) with versioned payloads and **Fanout consumer isolation** — the service only publishes events, no scattered `bus.Publish`
- **Outbox pattern**: payment-success/delivery events are written to `outbox_events` **in the same transaction** as the order state change; a worker publishes them; 5 consecutive failures move to `dead_events`; published events are purged after 30 days
- Idempotency ledger: payment callbacks register the gateway trade ID as a unique key in `processed_events` (same transaction as the state change) — duplicates are processed once
- Payment abstraction: order business depends only on `payment.Gateway`; built-in BEpusdt and HashPay implementations, **buyers pick either gateway per order** (the order records its gateway; callbacks/idempotency are routed per gateway) without touching business code
- Task system: goroutine + channel (mail / Telegram / Webhook) + ticker; panic isolation, startup compensation, `job_runs` records
- Background jobs: auto-expire unpaid orders, retry failed mail, session/log/outbox/queue cleanup, daily verified backup
- Logging (zap): app / payment / security channels, 50MB rotation keeping 7 files; request_id / order_id / trace_id correlation
- Migration system: numbered .sql migrations (`internal/db/schema/migrations/`), each run exactly once and recorded
- Admin security: PBKDF2-SHA256, TOTP 2FA, **lockout after 5 failed logins for 10 minutes (keyed by IP+username)**, timing-equalized login
- Security: RBAC, audit logs (indexed), tiered rate limiting, Turnstile, CSP, HSTS, security headers, CSV injection guard, fully parameterized SQL
- Observability: component-level health check `/health` (database + jobs metrics), version injection, structured startup banner
- API docs: `/docs` (OpenAPI 3.0, JSON + YAML, `/swagger` alias), admin-only

---

## Architecture

```
User browser
    │
    ▼
Cloudflare (CDN/HTTPS)
    │
    ▼
Caddy (reverse proxy :443)
    ├── /api, /notify, /admin, /health  → Go :8080
    └── /*                               → Nuxt SSR :3001
```

| Process | Stack | Port |
| --- | --- | --- |
| Go API | Go 1.25.12+ + SQLite (modernc) | 8080 |
| Storefront SSR | Nuxt 3 + Tailwind | 3001 |
| Admin SPA | Vue 3 + TS + Element Plus + Pinia | embedded in Go |

### Layering

```
HTTP handler (internal/api)
    → service (internal/service)
        → interfaces (OrderRepository / ProductRepository / KeyRepository / SettingsStore / AdminStore)
        → internal/db/repository (SQLite implementation) + internal/db/schema (migrations)
```

- Handlers only parse requests, write responses, and enforce HTTP security (Turnstile / rate limiting / cookies / auth middleware / Origin check); they never touch the database directly, call the payment gateway, or send notifications;
- All business logic lives in `service`, which depends **only on interfaces** — never concrete SQLite — so tests use in-memory mocks; shared types/domain errors live in `internal/models`;
- `internal/db/repository` centralizes all SQL; a `Store` turns config/admin/session/audit access into interface implementations;
- Payments go through `payment.Gateway`; critical events go through Outbox; background jobs are scheduled by `internal/jobs`.

### Database migrations (Laravel style)

- Migration files live in `internal/db/schema/migrations/`, numbered, applied in order, **each exactly once**;
- Policy: new schema changes must be new numbered .sql files; no startup "table checks / auto column creation";
- Go migration steps are reserved for legacy upgrades SQLite cannot express in pure SQL;
- Config-structure upgrades go through `settings_version` (`internal/db/settings_migrations.go`).

### Task system & background jobs

- **Task bus**: goroutine + channel; notifications run asynchronously;
- **Background jobs**: Go ticker scheduling
  - `order_expire`: every 5 minutes, close overdue unpaid orders and release cards
  - `email_retry`: failed mail retried with exponential backoff (max 5 attempts)
  - `outbox_publish`: every 1 second, publishes outbox events (auto re-publish after a crash)
  - `cleanup`: sessions / 180-day logs / outbox 30 days / mail queue / job_runs 7 days / memory state
  - `backup`: daily `VACUUM INTO` snapshot + read-only `integrity_check` (corrupt files removed), keep 7
- Robustness: worker/scheduler panic isolation; startup compensation for order_expire / email_retry / outbox_publish / cleanup; every run recorded in `job_runs`

---

## Payment flow

```
Order (buyer picks gateway) → lock cards (atomic) → create transaction (payment.Gateway[selected]) → open checkout in a new tab
  → redirect to the order page (auto-polling)
  → user pays → gateway callback (path changeable at runtime; BEpusdt MD5 signature / HashPay RSA-encrypted envelope) → verify + processed_events idempotency → order paid
  → write outbox in the same transaction → worker sends delivery notification (mail/Telegram/Webhook) → cards shown
```

- Cancel / expire: release stock + close the gateway transaction (BEpusdt calls `cancel-transaction`; **HashPay has no merchant cancel API** — on cancel we proactively query the order status, wait for HashPay's expiry callback if unpaid, and alert the admin immediately if a cancel/pay race is detected (already paid); late callbacks never mis-deliver);
- Transaction boundaries: checkout is a single transaction (create order + lock cards + decrement stock); failures atomically mark `payment_failed` and release cards; payment success is a single transaction and events/mail are sent **only after COMMIT**;
- Dual gateways: each order records the chosen gateway, `processed_events` idempotency keys are gateway-prefixed, and callback routes are independent (`/notify/bepusdt`, `/notify/hashpay`); adding a gateway (future USDT / Stripe / PayPal) only requires a new `Gateway` adapter;
- **payment.log** records every creation/callback with request_id / trace_id.

---

## Tech stack

| Layer | Stack |
| --- | --- |
| Storefront | Nuxt 3 SSR + Tailwind CSS |
| Admin | Vue 3 + Vite + TypeScript + Element Plus + Pinia + VueUse + unplugin-auto-import |
| Admin quality | ESLint (flat config + typescript-eslint + eslint-plugin-vue) + Prettier |
| API types | OpenAPI → TS auto-generated (`admin-ui npm run gen:api` → `src/api/types.ts`) |
| Backend | Go 1.25.12+ (govulncheck clean) |
| Database | SQLite (modernc.org/sqlite), migrations + interface-based repository layering |
| Logging | go.uber.org/zap + lumberjack |
| Tasks | goroutine + channel + ticker (no MQ), Outbox pattern |
| Reverse proxy | Caddy |
| Payment | BEpusdt / HashPay coexist (behind the `payment.Gateway` interface, buyer chooses) |
| Security | Cloudflare Turnstile |

---

## Directory structure

```
cmd/shop/               Go entrypoint
internal/api/           HTTP routes, JSON API, payment callback, embedded admin, API docs (handler layer)
internal/service/       business logic (small files per domain)
internal/service/repository.go    data-access interfaces consumed by service
internal/db/            database connection layer: sqlite.go / postgres.go (future)
internal/db/schema/     schema evolution: migration runner + migrations/*.sql
internal/db/repository/ all data access: SQLite implementations + Store
internal/db/settings_migrations.go   config-structure upgrades (settings_version)
internal/models/        models, shared types and domain errors
internal/payment/       payment gateway abstraction: interface.go + bepusdt.go
internal/notify/        notifications (event templates / mail / Telegram / Webhook)
internal/jobs/          task bus + scheduler + order_expire / email_retry / outbox_publish / cleanup / backup
internal/logging/       zap logging + correlation IDs
internal/security/      TOTP & AES-GCM cipher
internal/events/        typed domain events + Fanout + versioned payloads
internal/version/       build version info (-ldflags injected)
internal/config/        configuration defaults
internal/testutil/      integration test facilities (temp SQLite + MockGateway + NotifyRecorder)
internal/integration/   order integration tests (callback / duplicate / cancel / expiry / concurrency)
admin-ui/               Element Plus admin (src/api|views|stores|hooks|utils|components)
storefront/             Nuxt 3 SSR storefront
logs/                   runtime logs (app.log / payment.log / security.log)
CHANGELOG.md            changelog (v0.1 Earth / v0.2 Moon)
AGENTS.md               engineering conventions
```

---

## Development

### Prerequisites

- Go 1.25.12+ (govulncheck baseline)
- Node.js 18+ / npm
- A BEpusdt instance or a HashPay instance (runs on Cloudflare Workers; the merchant panel generates an RSA key pair)

### Local development

Backend (8080):

```bash
go run ./cmd/shop
```

Admin (5174):

```bash
cd admin-ui && npm install && npm run dev
```

Storefront (3001):

```bash
cd storefront && npm install && npm run dev
```

### Build & validation

```bash
# Admin static assets → internal/api/admin-ui
cd admin-ui && npm install && npm run build && cd ..

# Storefront SSR output → storefront/.output
cd storefront && npm install && npm run build && cd ..

# Single binary (embeds the admin UI), optionally with version info
go build -ldflags "-X shop/internal/version.Version=0.2.0 -X shop/internal/version.Commit=$(git rev-parse --short HEAD)" -o shop ./cmd/shop
./shop

# Dependency security baselines
govulncheck ./...
cd admin-ui && npm audit --omit=dev

# Admin code quality
cd admin-ui && npm run lint && npm run format
```

> `internal/api/admin-ui` is a build artifact, ignored by `.gitignore`, not committed.

### Code conventions (see AGENTS.md)

- **Small service/repository files**: split by responsibility, keep each file under ~300 lines;
- **Interface-based repositories**: service depends only on interfaces; shared types/domain errors live in `internal/models`;
- New schema changes must be new numbered .sql migrations; config-structure upgrades go through `settings_version`; sensitive config always goes into the encrypted `secrets` table;
- Critical domain events must use Outbox (same transaction as state); external events must be idempotent (`processed_events`);
- API changes must update OpenAPI and re-run `npm run gen:api`; backups must verify with `integrity_check` and have a restore drill;
- Security baselines: Go ≥1.25.12 + govulncheck; login lockout includes IP; admin Origin check; keep tests and the bilingual README in sync.

---

## Deployment (server)

### Release process (tag → release)

Pushing a `v*` tag triggers the CI Release workflow: build admin-ui / storefront → Go binary (version from the tag) → package `liteshop-release.tgz` + `SHA256` checksum → create a GitHub Release with assets:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

The artifact feeds `install.sh` via `BUILD_ARTIFACT` for fast deployment (checksum guards against tampering).

### One-click install (install.sh)

On a fresh Ubuntu / Debian / CentOS / Rocky / Alma server, point the domain A record to the server:

```bash
# Source build mode (~10 min; installs Go/Node/Caddy/systemd/SSL automatically)
curl -sSL https://raw.githubusercontent.com/mhan24/liteshop/main/install.sh | DOMAIN=shop.example.com bash

# Fast mode (recommended): prebuilt artifact, ~2 min
curl -sSL https://raw.githubusercontent.com/mhan24/liteshop/main/install.sh | \
  DOMAIN=shop.example.com BUILD_ARTIFACT=https://…/liteshop-release.tgz bash
```

Install-time variables: `DOMAIN` (required), `EMAIL`, `BRANCH`, `SKIP_SSL=1` (plain http), `BUILD_ARTIFACT`, `SHOP_USER`.

> Runtime configuration is stored in the database via `/setup` and the admin panel; the app reads no application-level environment variables. The project does not rely on Docker.

### Adding HashPay

1. Deploy [HashPay](https://github.com/TGDash/HashPay) to Cloudflare Workers and finish its setup;
2. In the HashPay merchant panel create a **Native API** merchant, save the **private key** (shown only once), and set the merchant **Callback URL** to LiteShop's HashPay notify URL (visible on the payment settings page, default `https://your-domain/notify/hashpay`);
3. In LiteShop admin → Payment settings, enable **HashPay** (it can run alongside BEpusdt), fill in the HashPay site URL, merchant ID, private key, and currency (default USD), then save;
4. When more than one gateway is enabled the storefront shows a **payment-method picker**: choosing BEpusdt shows network options (TRC20/ERC20 etc.), choosing HashPay uses its hosted checkout for network/asset selection; orders are billed per the chosen gateway and cards are delivered automatically on payment — callbacks and idempotency are routed per gateway.

> The private key is shown only once when the merchant is created; after saving it is AES-encrypted in the `secrets` table; leave blank to keep the current key.

### Build deployment (build-release.sh)

```bash
bash build-release.sh /tmp/liteshop-release.tgz   # shop binary (git tag/commit/date injected) + storefront/.output
```

### Manual deployment

- Go: systemd `cardshop`, runs `/opt/cardshop/shop`, listens on 8080
- Storefront: systemd `liteshop-storefront`, runs `/opt/liteshop-storefront/server/index.mjs`, listens on 3001
- Caddy: route API/admin/callbacks to Go, everything else to Nuxt (storefront CSP included)

---

## Tests & CI

- Unit & integration: `go test ./...` (migrations, signatures, hashing, state machine, coupons/free orders, sessions, lockout, task bus, scheduler, panic isolation, backup verification, mail retry, health, security headers, concurrency stress, restore drill, legacy upgrade, events/idempotency/dead-letter)
- **Mock tests**: service depends on interfaces, so it can be tested without a database
- **Integration tests** (`internal/integration` + `internal/testutil`): BEpusdt/HashPay payment callback delivery, duplicate-callback idempotency, cancel/expiry stock release + gateway cancellation, real HTTP callback route (signature / RSA envelope decryption / dynamic path / bad signature), **100 concurrent buyers for the last card**, outbox dead-letter, backup restore drill, old-DB upgrade
- **Benchmarks**: `go test -bench=. ./internal/integration/` (order ~6.4ms / callback ~6.8ms / query ~21µs baseline)
- **Dependency baseline**: `govulncheck ./...` clean (Go 1.25.12); `npm audit` 0 runtime vulnerabilities (admin-ui js-yaml advisory is build-time only, unreachable)
- CI (`.github/workflows/ci.yml`): Go `vet` / `build` / `test` + gen:api diff check + storefront/admin builds

---

## Caching & SEO

| Path | Cache-Control |
| --- | --- |
| `/_nuxt/*`, `/assets/*`, `/admin/assets/*` | `public, max-age=31536000, immutable` |
| `/robots.txt`, `/sitemap.xml` | `public, max-age=3600` |
| `/favicon.svg` | `public, max-age=86400` |
| `/`, `/api/*`, `/admin/*`, `/order*`, `/product*`, `/page*`, `/setup`, `/health` | `no-store` + `X-Robots-Tag: noindex` |

- Dynamic pages are never cached; the site origin comes from the database `public_base_url` — no Host/env dependency;
- SSR caching policy: dynamic pages and product listings stay `no-store`; ISR / edge cache can be evaluated later under high traffic — not implemented today.

---

## Observability

- Logging (zap): `logs/app.log` / `logs/payment.log` / `logs/security.log`, 50MB rotation keeping 7 files
- Health check `GET /health`: app name, version, build ID, `config_version`, uptime and component status
- Health metrics: `database` (status / size_bytes / migration_version / last_backup / integrity) + `jobs` (mail_queue_size / last_success)
- Startup banner: `LiteShop vX.Y.Z (commit, date)` plus database / payment / listen / admin / notify info
- Version lives in `internal/version`, injected via `-ldflags` (build-release.sh / Release workflow pick up git tag / commit / date)
- Admin endpoints: `/api/v1/admin/version` (version/build/config_version) and `/api/v1/admin/jobs` (job runs / queue / dead events)
- Correlation: per-request `request_id` (X-Request-ID header); payment logs carry request_id / order_no / trace_id
- Security-header regression tests: `internal/api/security_test.go` pins nosniff / X-Frame-Options / Referrer-Policy / Permissions-Policy / admin CSP / HSTS / session-cookie Secure; the storefront CSP allows inline + eval (required by Nuxt bootstrap and vue-i18n message compilation, consistent with the admin policy) and allows challenges.cloudflare.com (Turnstile)

---

## API docs

- URL: `/docs` (alias `/swagger`), **visible only after admin login**
- Spec files: `/docs/openapi.json` and `/docs/openapi.yaml` (OpenAPI 3.0, covering storefront / admin / payment callback)
- Frontend types: `admin-ui/src/api/types.ts` auto-generated from the spec (`npm run gen:api`, CI diff check, zero drift)
- Usage: import the URL into Swagger UI / Postman etc.; public endpoints need no auth, admin endpoints need the session cookie
- Maintenance: API changes must be reflected in `internal/api/api_docs/openapi.json` (YAML and TS types are generated from it)

---

## Security notes

- Passwords: PBKDF2-SHA256 (100k) + constant-time compare; timing-equalized login; **lockout after 5 failed attempts for 10 minutes (IP+username)**
- TOTP 2FA secrets AES-GCM encrypted; sensitive config AES-encrypted in the `secrets` table
- Order view tokens delivered only by email; persisted sessions revoked immediately on logout / admin deletion / restore / reset
- Atomic order state machine; 100% coupons complete orders automatically; concurrent stock protected by `_txlock=immediate` + atomic conditional UPDATE
- Fully parameterized SQL; markdown disables HTML + link-scheme whitelist; CSV formula-injection guard; CSP / HSTS / security headers
- Config backups exclude secrets; explicit HTTP timeouts; async tasks never block callbacks; worker/event-consumer panic isolation
- Rate-limit trust boundary: `CF-Connecting-IP` is honored only from Cloudflare edge IPs; admin non-idempotent requests validate Origin same-origin
- security.log records login success/failure/lockout and TOTP verification
- The session master key (`session_secret`) is stored in plaintext in `settings` (a deliberate no-env tradeoff): protect DB access strictly; a server-local key file is planned via `settings_version` v2

---

## Versions & License

- v0.2.0 codename **Moon**; v0.1.0 codename **Earth**; full changelog: [CHANGELOG.md](CHANGELOG.md)
- MIT, see [LICENSE](LICENSE).
