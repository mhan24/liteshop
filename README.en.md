# LiteShop

中文版：[README.md](README.md)

An automated digital-goods delivery (card / activation code) shop built with **Go + SQLite**, integrated with the [BEpusdt](https://github.com/v03413/BEpusdt) crypto payment gateway. The buyer storefront uses Nuxt 3 SSR + Tailwind; the admin panel uses Vue 3 + TypeScript + Element Plus + Pinia; Go serves the JSON API, payment callbacks, the embedded admin SPA, and background jobs.

> This project is not affiliated with the BEpusdt author. BEpusdt is GPL-3.0; this project is MIT.

---

## Features

### Storefront (Nuxt 3 SSR)

- Product listing: categories / pinned / sorting / search / price filter
- Product detail + Cloudflare Turnstile
- Checkout: open the BEpusdt checkout in a new tab, redirect to the order page
- Order detail: auto-poll while pending, cards revealed on payment success, cancel order (synchronously closes the BEpusdt transaction)
- Order lookup: email-only recovery + "send view link to my email"
- Access note: every order (including legacy ones) uses a view token sent by email to view cards / cancel; tokens are only mailed to the registered address, and the lookup API never returns order numbers or links
- Privacy / Terms / first-time `/setup`
- SEO: canonical / OG / JSON-LD / sitemap / robots / favicon

### Admin panel (Vue 3 SPA)

- Dashboard: products / cards / orders stats, sales trend & product share, profit (cost snapshot)
- Products: create / edit / category / pinned / sorting / price / status / FAQ / wholesale tiers
- Cards: import (dedupe) / delete / export
- Orders: view / CSV export / mark expired / resend / batch resend / redeliver
- Coupons: fixed / percent, minimum amount, max uses, product scope, validity window; **100% coupons complete the order automatically and deliver cards immediately**
- Payment: BEpusdt base URL / token / trade types / timeout / callback URL
- Notifications: SMTP / Telegram / Webhook + **event templates** (order created / payment success / delivered / low stock / system error) + admin notification email + test buttons
- Site: title / announcement / **public base URL** / logo / favicon / SEO / links / copyright / privacy / terms / Turnstile
- Maintenance mode: toggle + notice + unlock password (hashed + AES-encrypted storage)
- Account: change username / change password
- Security: TOTP 2FA (Google Authenticator, AES-encrypted secret), admin RBAC + audit logs
- System: config backup / restore (excludes secrets) / wipe and re-init

### Backend (Go)

- SQLite storage (pure Go, no CGO); no application-level environment variables — **all configuration is written to the database** during `/setup` and from the admin panel
- Config system: `settings` (system config) + `secrets` (sensitive config AES-GCM encrypted)
- Layering: api (handler) → service (business) → db/repository (data) → db/schema (schema evolution); payment / notify / jobs / logging each isolated by responsibility
- Task system: in-process goroutine + channel (mail / Telegram / Webhook); the HTTP layer only publishes events
- Background jobs (cron + worker): auto-expire unpaid orders, retry failed mail, session/log cleanup, daily database backup
- Logging (zap): app / payment / security channels, 50MB rotation keeping 7 files
- Migration system: numbered .sql migrations (`internal/db/schema/migrations/`), each run exactly once and recorded
- Admin security: PBKDF2-SHA256, TOTP 2FA, **lockout after 5 failed logins for 10 minutes**, timing-equalized login
- Security: RBAC, audit logs, endpoint-wide rate limiting, Turnstile, CSP, HSTS, security headers, CSV injection guard, fully parameterized SQL
- Health check `/health`, first-time setup `/setup`

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

### Layering & data access

```
HTTP handler (internal/api)
    → service (internal/service)
    → repository (internal/db/repository)
    → database/sql (internal/db)
```

- Handlers only parse requests, write responses, and enforce HTTP security (Turnstile / rate limiting / cookies / auth middleware);
- Order, payment, notification, settings, and admin business logic all live in `service` (Order / Product / Admin / Settings / Notify / Stats); handlers never touch the database directly, call the payment gateway, or send notifications;
- `internal/db/repository` centralizes all SQL: Order / Product / Key / Coupon / Admin / Session / Setting / Secret / MailQueue / Log; business code has no scattered `db.Exec`;
- Switching databases only requires a new driver (sqlite.go / postgres.go future) + a migration dialect.

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
  - `backup`: daily `VACUUM INTO` consistent snapshot, keeping the last 7

---

## Payment flow

```
Order → lock cards → create BEpusdt transaction → open checkout in a new tab
  → redirect to the order page (auto-polling)
  → user pays → BEpusdt callback /notify/bepusdt → verify signature → order paid
  → publish task → worker sends delivery notification (mail/Telegram) → cards shown
```

Cancel / expire: release stock + call BEpusdt `cancel-transaction`.

**payment.log** records every creation/callback: order number, amount, trade ID, callback time, result — for payment-chain troubleshooting.

---

## Tech stack

| Layer | Stack |
| --- | --- |
| Storefront | Nuxt 3 SSR + Tailwind CSS |
| Admin | Vue 3 + Vite + TypeScript + Element Plus + Pinia + VueUse + unplugin-auto-import |
| Admin quality | ESLint (flat config + typescript-eslint + eslint-plugin-vue) + Prettier |
| Backend | Go 1.25+ |
| Database | SQLite (modernc.org/sqlite) |
| Logging | go.uber.org/zap + lumberjack |
| Reverse proxy | Caddy |
| Payment | BEpusdt (behind a Gateway interface) |
| Security | Cloudflare Turnstile |

---

## Directory structure

```
cmd/shop/               Go entrypoint
internal/api/           HTTP routes, JSON API, payment callback, embedded admin (handler layer)
internal/service/       business logic (OrderService / ProductService / AdminService / SettingsService / NotifyService / StatsService)
internal/db/            database connection layer: sqlite.go / postgres.go (future)
internal/db/schema/     schema evolution: migration runner + migrations/*.sql (single entry for schema changes)
internal/db/repository/ all data access (Order / Product / Key / Coupon / Admin / Session / Setting / Secret / MailQueue / Log)
internal/models/        models & helpers
internal/payment/       payment gateway abstraction: interface.go (Gateway) + bepusdt.go (BEPusdt impl)
internal/notify/        notifications (event templates / mail / Telegram / Webhook)
internal/jobs/          task bus + scheduler + order_expire / email_retry / cleanup / backup
internal/logging/       zap logging (app / payment / security)
internal/security/      TOTP & AES-GCM cipher
internal/config/        configuration defaults
admin-ui/               Element Plus admin (src/api|views|stores|hooks|utils|components)
storefront/             Nuxt 3 SSR storefront
logs/                   runtime logs (app.log / payment.log / security.log)
```

---

## Development

### Prerequisites

- Go 1.25+
- Node.js 18+ / npm
- A BEpusdt instance

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

# Single binary (embeds the admin UI)
go build -o shop ./cmd/shop
./shop

# Admin code quality
cd admin-ui && npm run lint && npm run format
```

> `internal/api/admin-ui` is a build artifact, ignored by `.gitignore`, not committed.

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

> Runtime configuration (site URL, payment, notifications, etc.) is stored in the database via `/setup` and the admin panel; the app reads no application-level environment variables.

### Build deployment (build-release.sh)

```bash
bash build-release.sh /tmp/liteshop-release.tgz   # shop binary + storefront/.output
```

### Manual deployment

- Go: systemd `cardshop`, runs `/opt/cardshop/shop`, listens on 8080
- Storefront: systemd `liteshop-storefront`, runs `/opt/liteshop-storefront/server/index.mjs`, listens on 3001
- Caddy: route API/admin/callbacks to Go, everything else to Nuxt

---

## Tests & CI

- Go: `go test ./...` (migrations, signature verification, password hashing, state machine, coupons/free orders, sessions, login lockout, task bus, scheduler, backup, mail retry)
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

---

## BEpusdt integration

- The payment layer depends only on the `payment.Gateway` interface (create transaction / cancel transaction / verify callback); order business logic is not bound to BEpusdt;
- Switching gateways (other USDT / Stripe / PayPal) only requires a new `Gateway` adapter; business and callback handling stay unchanged;
- Get the API token from the BEpusdt admin panel (stored encrypted)
- Create transaction → redirect to checkout; cancel/expire calls `cancel-transaction`
- Payment success callback `/notify/bepusdt` (path customizable)
- Signature: sorted params + token, MD5 (fixed protocol requirement; empty values excluded)

---

## Cloudflare Turnstile

- Storefront checkout / order lookup embed Turnstile
- Backend verifies via canonical siteverify (with hostname match; relaxed for IP/local access)

---

## Security notes

- Passwords: PBKDF2-SHA256 (100k) + constant-time compare; timing-equalized login; **lockout after 5 failed attempts for 10 minutes**
- TOTP 2FA secrets AES-GCM encrypted; sensitive config (payment / mail / notifications / maintenance password) AES-encrypted in the `secrets` table
- Order view tokens delivered only by email; persisted sessions revoked immediately on logout / admin deletion / restore / reset
- Atomic order state machine (deliver/cancel/expire in single transactions); 100% coupons complete orders automatically
- Fully parameterized SQL; markdown disables HTML; CSV formula-injection guard; CSP / HSTS / security headers
- Config backups exclude secrets; explicit HTTP server timeouts; async tasks never block payment callbacks
- security.log records login success/failure/lockout and TOTP verification

---

## License

MIT, see [LICENSE](LICENSE).
