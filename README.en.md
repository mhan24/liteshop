# LiteShop

中文版：[README.md](README.md)

**LiteShop v0.1.0** — an automated digital-goods delivery (card / activation-code) shop built with **Go + SQLite**, integrated with the [BEpusdt](https://github.com/v03413/BEpusdt) crypto payment gateway. The buyer storefront uses Nuxt 3 SSR + Tailwind; the admin panel uses Vue 3 + TypeScript + Element Plus + Pinia; Go serves the JSON API, payment callbacks, the embedded admin SPA, and background jobs.

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
- Payment: gateway base URL / token / trade types / timeout / callback URL
- Notifications: SMTP / Telegram / Webhook + **event templates** (order created / payment success / delivered / low stock / system error) + admin notification email + test buttons
- Site: title / announcement / **public base URL** / logo / favicon / SEO / links / copyright / privacy / terms / Turnstile
- Maintenance mode: toggle + notice + unlock password (hashed + AES-encrypted storage)
- Account: change username / change password
- Security: TOTP 2FA (Google Authenticator, AES-encrypted secret), admin RBAC + audit logs
- System: config backup / restore (excludes secrets) / wipe and re-init / **background job status** (last run result per job + pending mail queue count)

### Backend (Go)

- SQLite storage (pure Go, no CGO); no application-level environment variables — **all configuration is written to the database** during `/setup` and from the admin panel
- Config system: `settings` (system config) + `secrets` (sensitive config AES-GCM encrypted)
- Config versioning: `settings_version` records config-structure upgrade versions (numbered Laravel-style steps, run once); config upgrades no longer require guessing — exposed via `/health` and `/api/v1/admin/version`
- Layering: api (handler) → service (business) → db/repository (data) → db/schema (schema evolution); payment / notify / jobs / logging each isolated by responsibility
- Payment abstraction: order business depends only on the `payment.Gateway` interface (currently implemented by BEpusdt); switching gateways does not touch business code
- Separated status models: **order status** (fulfillment lifecycle: created / waiting_payment / paid / processing / delivered / completed / cancelled / expired / payment_failed / delivery_failed) is decoupled from **payment status** (dedicated `payment_status` column: created / pending / confirmed / failed / cancelled); payment anomalies never pollute order semantics (e.g. "paid but delivery failed" = order `delivery_failed` + payment `confirmed`)
- Task system: in-process goroutine + channel (mail / Telegram / Webhook); the HTTP layer only publishes events
- Domain events: typed events in `internal/events` (OrderPaid / OrderExpired / DeliveryFailed / LowStock …); the service only publishes events — no scattered `bus.Publish` — and the composition root dispatches them
- **Outbox pattern**: payment-success/delivery events are written to `outbox_events` **in the same transaction** as the order state change; an outbox worker (1s) reads and publishes them — even after a crash right after COMMIT, events are re-published on restart, keeping DB state and events permanently consistent
- Outbox lifecycle: published events are kept for 30 days and purged by `cleanup` (unpublished events are never purged); event payloads carry a `version` — bump it when the structure changes, and old events stay decodable
- Idempotency ledger: external events (payment callbacks) register a unique key (`transaction_id`) in `processed_events` within the same transaction as the order state change, so duplicate notifications are processed once
- Background jobs (ticker + worker): auto-expire unpaid orders, retry failed mail, session/log cleanup, daily database backup (with integrity verification)
- Logging (zap): app / payment / security channels, 50MB rotation keeping 7 files
- Migration system: numbered .sql migrations (`internal/db/schema/migrations/`), each run exactly once and recorded
- Admin security: PBKDF2-SHA256, TOTP 2FA, **lockout after 5 failed logins for 10 minutes**, timing-equalized login
- Security: RBAC, audit logs, endpoint-wide rate limiting, Turnstile, CSP, HSTS, security headers, CSV injection guard, fully parameterized SQL
- Observability: component-level health check `/health` (database / payment), version injection, structured startup banner
- Log correlation: every HTTP request gets an auto-generated `request_id` (response header `X-Request-ID`); payment logs carry `request_id` / `order_id` / `trace_id` (gateway trade ID), so one payment flow can be traced end to end
- Database connection: `journal_mode=WAL` + `busy_timeout=5000` + `foreign_keys=ON` + `_txlock=immediate` applied at startup
- Graceful shutdown: SIGTERM/SIGINT → stop accepting requests → drain in-flight → stop workers → close DB (systemd/Docker friendly)
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
| Go API | Go 1.25+ + SQLite (modernc) | 8080 |
| Storefront SSR | Nuxt 3 + Tailwind | 3001 |
| Admin SPA | Vue 3 + TS + Element Plus + Pinia | embedded in Go |

### Layering

```
HTTP handler (internal/api)
    → service (internal/service)
        → interfaces (OrderRepository / ProductRepository / KeyRepository / SettingsStore / AdminStore)
        → internal/db/repository (SQLite implementation) + internal/db/schema (migrations)
```

- Handlers only parse requests, write responses, and enforce HTTP security (Turnstile / rate limiting / cookies / auth middleware); they never touch the database directly, call the payment gateway, or send notifications;
- All business logic lives in `service` (Order / Product / Admin / Settings / Notify / Stats), which depends **only on interfaces** — never on concrete SQLite, so tests use in-memory mocks; shared types and domain errors live in `internal/models`;
- `internal/db/repository` centralizes all SQL (Order / Product / Key / Coupon / Admin / Session / Setting / Secret / MailQueue / Log), plus a `Store` that turns config/admin/session/audit access into interface implementations;
- Payments go through the `payment.Gateway` interface (BEpusdt implementation); business is not bound to a specific gateway;
- Notifications run asynchronously via `internal/notify` + the task bus; background jobs are scheduled by `internal/jobs`.

### Database migrations (Laravel style)

- Migration files live in `internal/db/schema/migrations/`, numbered (`001_init.sql`, `002_...`, …), applied in order;
- Every applied migration is recorded in `schema_migrations` and **runs exactly once** — never re-run on restart;
- Policy: **new schema changes must be new numbered .sql files**; no startup "table checks / auto column creation";
- Go migration steps are reserved for legacy upgrades SQLite cannot express in pure SQL (conditional ALTER / table rebuild / data migration).

### Task system & background jobs

- **Task bus** (`internal/jobs/bus.go`): goroutine + channel; notifications (mail / Telegram / Webhook) run asynchronously;
- **Background jobs** (`internal/jobs/scheduler.go`): Go ticker scheduling
  - `order_expire`: every 5 minutes, close overdue unpaid orders and release cards (no user access required)
  - `email_retry`: failed mail goes into `mail_queue`, retried with exponential backoff (max 5 attempts)
  - `cleanup`: expired sessions / 180-day logs / in-memory state cleanup
  - `backup`: daily `VACUUM INTO` consistent snapshot + **read-only `integrity_check` verification** (corrupt files are removed automatically), keeping the last 7
- Robustness: worker/scheduler panics are isolated (one crashing job never takes down the process); `order_expire` / `email_retry` / `cleanup` also run once at startup (compensation after a crash/restart)
- **Run records**: every job execution is written to `job_runs` (job_name / started_at / finished_at / status / error); the admin endpoint `GET /api/v1/admin/jobs` shows "last backup: ok / mail queue: N" directly instead of relying on logs

---

## Payment flow

```
Order → lock cards → create transaction (payment.Gateway) → open checkout in a new tab
  → redirect to the order page (auto-polling)
  → user pays → gateway callback → verify signature (Gateway.VerifyCallback) → order paid
  → publish task → worker sends delivery notification (mail/Telegram/Webhook) → cards shown
```

- Cancel / expire: release stock + call the gateway `cancel-transaction` to close the trade;
- Transaction boundaries: checkout is a single transaction (create order + lock cards + decrement stock); failures atomically mark `payment_failed` and release cards; payment success is a single transaction (paid + deliver) and notifications are sent asynchronously **only after COMMIT** — never inside a DB transaction;
- Concurrent stock: SQLite `_txlock=immediate` (write lock acquired at BEGIN) + a single conditional UPDATE that locks cards and verifies affected rows — when two users buy the last card simultaneously, exactly one succeeds; no oversell, no double-locking;
- The callback path is configurable (default `/notify/bepusdt`), stored in the database;
- Switching gateways (other USDT / Stripe / PayPal) only requires a new `Gateway` adapter; business and callback handling stay unchanged;
- **payment.log** records every creation/callback: order number, amount, trade ID, callback time, result — for payment-chain troubleshooting.
- Idempotency: payment callbacks register `transaction_id` as a unique key in `processed_events`, committed in the same transaction as the order state change — duplicate callbacks have zero side effects.

---

## Tech stack

| Layer | Stack |
| --- | --- |
| Storefront | Nuxt 3 SSR + Tailwind CSS |
| Admin | Vue 3 + Vite + TypeScript + Element Plus + Pinia + VueUse + unplugin-auto-import |
| Admin quality | ESLint (flat config + typescript-eslint + eslint-plugin-vue) + Prettier |
| API types | OpenAPI → TS auto-generated (`admin-ui npm run gen:api` → `src/api/types.ts`), zero drift from the backend spec |
| Backend | Go 1.25+ |
| Database | SQLite (modernc.org/sqlite), migrations + interface-based repository layering |
| Logging | go.uber.org/zap + lumberjack |
| Tasks | goroutine + channel + ticker (no MQ) |
| Reverse proxy | Caddy |
| Payment | BEpusdt (behind the `payment.Gateway` interface) |
| Security | Cloudflare Turnstile |

---

## Directory structure

```
cmd/shop/               Go entrypoint
internal/api/           HTTP routes, JSON API, payment callback, embedded admin, API docs (handler layer, HTTP adaptation only)
internal/service/       business logic (small files per domain: order_create.go / settings_payment.go / admin_users.go …)
internal/service/repository.go    data-access interfaces consumed by service (Order/Product/Key/SettingsStore/AdminStore)
internal/db/            database connection layer: sqlite.go / postgres.go (future)
internal/db/schema/     schema evolution: migration runner + migrations/*.sql (single entry for schema changes)
internal/db/repository/ all data access: SQLite implementations + Store; order split into small files (order_query.go / order_create.go / order_state.go / order_stats.go / order_log.go)
internal/models/        models, shared types (ProductView/AdminRow/…) and domain errors
internal/payment/       payment gateway abstraction: interface.go (Gateway) + bepusdt.go (BEPusdt impl)
internal/notify/        notifications (event templates / mail / Telegram / Webhook)
internal/jobs/          task bus + scheduler + order_expire / email_retry / cleanup / backup
internal/logging/       zap logging (app / payment / security)
internal/security/      TOTP & AES-GCM cipher
internal/version/       build version info (-ldflags injected)
internal/config/        configuration defaults
internal/testutil/      integration test facilities: temp SQLite DB + MockGateway + NotifyRecorder
internal/integration/   order integration tests (payment callback / duplicate / cancel / expiry)
admin-ui/               Element Plus admin (src/api|views|stores|hooks|utils|components)
storefront/             Nuxt 3 SSR storefront
logs/                   runtime logs (app.log / payment.log / security.log)
AGENTS.md               engineering conventions (layering / small files / interfaces / migrations / secrets / tests)
```

---

## Development

### Prerequisites

- Go 1.25+
- Node.js 18+ / npm
- A BEpusdt instance (or another `Gateway` implementation)

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
go build -ldflags "-X shop/internal/version.Version=0.1.0 -X shop/internal/version.Commit=$(git rev-parse --short HEAD)" -o shop ./cmd/shop
./shop

# Admin code quality
cd admin-ui && npm run lint && npm run format
```

> `internal/api/admin-ui` is a build artifact, ignored by `.gitignore`, not committed.

### Code conventions (see AGENTS.md)

- **Small service files**: split by responsibility (e.g. `order_create.go` / `order_cancel.go` / `order_deliver.go`); keep each file under ~300 lines;
- **Small repository files**: the order repository is split by responsibility (query / create / state / stats / log), also keeping each file under ~300 lines;
- **Interface-based repositories**: service depends only on interfaces, never concrete SQLite; shared types/domain errors live in `internal/models`;
- New schema changes must be new numbered .sql migrations; sensitive config always goes into the encrypted `secrets` table;
- API changes must be reflected in `internal/api/api_docs/openapi.json` (YAML generated from the JSON);
- Payment/notification changes must run the integration tests; backup logic must verify with `integrity_check`;
- Keep tests and the bilingual README in sync with changes.

---

## Deployment (server)

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

> Runtime configuration (site URL, payment, notifications, etc.) is stored in the database via `/setup` and the admin panel; the app reads no application-level environment variables. The project does not rely on Docker.

### Build deployment (build-release.sh)

```bash
bash build-release.sh /tmp/liteshop-release.tgz   # shop binary (git tag/commit/date injected) + storefront/.output
```

### Manual deployment

- Go: systemd `cardshop`, runs `/opt/cardshop/shop`, listens on 8080
- Storefront: systemd `liteshop-storefront`, runs `/opt/liteshop-storefront/server/index.mjs`, listens on 3001
- Caddy: route API/admin/callbacks to Go, everything else to Nuxt

---

## Tests & CI

- Unit & integration: `go test ./...` (migrations, signature verification, password hashing, state machine, coupons/free orders, sessions, login lockout, task bus, scheduler, worker panic isolation, backup verification, mail retry, health check)
- **Mock tests**: service depends on interfaces, so it can be tested without a database using in-memory stubs (e.g. settings save/validation)
- **Integration tests** (`internal/integration` + `internal/testutil`):
  - Temp SQLite test DB (full migrations + seeding)
  - `MockGateway` (records create/cancel calls) and `NotifyRecorder` (collects notification callbacks)
  - Coverage: payment callback delivery, **duplicate-callback idempotency** (no double delivery/notify), cancel-order stock release + gateway cancellation, stale-order expiry, and the real HTTP callback route (MD5 verification / status=3 gateway stub / bad-signature rejection)
- **Benchmarks**: `go test -bench=. ./internal/integration/` (BenchmarkCreateOrder / BenchmarkPaymentCallback / BenchmarkRepositoryQuery) to catch performance regressions from future refactors
- **Restore drill**: `TestBackupRestoreDrill` automates "backup → copy to a new DB → re-run migrations → query data" (a successful backup does not prove it can be restored)
- CI (`.github/workflows/ci.yml`): Go `vet` / `build` / `test` + admin-ui and storefront builds

---

## Caching & SEO

| Path | Cache-Control |
| --- | --- |
| `/_nuxt/*`, `/assets/*`, `/admin/assets/*` | `public, max-age=31536000, immutable` |
| `/robots.txt`, `/sitemap.xml` | `public, max-age=3600` |
| `/favicon.svg` | `public, max-age=86400` |
| `/`, `/api/*`, `/admin/*`, `/order*`, `/product*`, `/page*`, `/setup`, `/health` | `no-store` + `X-Robots-Tag: noindex` |

- Dynamic pages are never cached; canonical / OG / JSON-LD are emitted by Nuxt; sitemap includes product URLs dynamically.
- The site origin comes from the database `public_base_url` — no Host/env dependency.
- SSR caching policy: dynamic pages and product listings stay `no-store` (correct for now); ISR / edge cache can be evaluated later under high traffic — not implemented today.

---

## Observability

- Logging (zap): `logs/app.log` / `logs/payment.log` / `logs/security.log`, 50MB rotation keeping 7 files
- Health check `GET /health`: app name, version, build ID, uptime and component status (`database` / `payment`); returns 503 when the database is down
- Health metrics: `database` (status / size_bytes / migration_version / last_backup / integrity) and `jobs` (mail_queue_size / last_success)
- Startup banner: logs `LiteShop vX.Y.Z (commit, date)` plus database / payment / listen / admin / notify info on boot
- Version lives in `internal/version` and is injected via `-ldflags` at build time (`build-release.sh` picks up git tag / commit / date automatically)
- Admin endpoint `/api/v1/admin/version` returns version and build info
- Request logging: `app.log` writes one line per request (request_id / method / path / status / duration_ms); payment logs carry request_id / order_no / trace_id
- Security-header regression tests: `internal/api/security_test.go` pins nosniff / X-Frame-Options / Referrer-Policy / Permissions-Policy / admin CSP / HSTS / session-cookie Secure

---

## API docs

- URL: `/docs` (alias `/swagger`), **visible only after admin login** to avoid exposing the full API surface publicly
- Spec files: `/docs/openapi.json` and `/docs/openapi.yaml` (OpenAPI 3.0, covering storefront / admin / payment callback endpoints)
- Usage: import the URL into Swagger UI / Postman etc.; public endpoints need no auth, admin endpoints need the session cookie
- Maintenance: API changes must be reflected in `internal/api/api_docs/openapi.json` (YAML is generated from the JSON)

---

## Security notes

- Passwords: PBKDF2-SHA256 (100k) + constant-time compare; timing-equalized login; **lockout after 5 failed attempts for 10 minutes**
- TOTP 2FA secrets AES-GCM encrypted; sensitive config (payment / mail / notifications / maintenance password) AES-encrypted in the `secrets` table
- Order view tokens delivered only by email; persisted sessions revoked immediately on logout / admin deletion / restore / reset
- Atomic order state machine (deliver/cancel/expire in single transactions); 100% coupons complete orders automatically
- Fully parameterized SQL; markdown disables HTML; CSV formula-injection guard; CSP / HSTS / security headers
- Config backups exclude secrets; explicit HTTP server timeouts; async tasks never block payment callbacks; worker panics are isolated
- security.log records login success/failure/lockout and TOTP verification

---

## License

MIT, see [LICENSE](LICENSE).
