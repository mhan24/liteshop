# LiteShop

中文版：[README.md](README.md) ｜ Changelog: [CHANGELOG.md](CHANGELOG.md) ｜ Engineering conventions: [AGENTS.md](AGENTS.md)

**LiteShop** — an automated digital-goods (coupon / card key) delivery shop built with **Go + SQLite**, integrated with the [BEpusdt](https://github.com/v03413/BEpusdt) and [HashPay](https://github.com/TGDash/HashPay) crypto payment gateways (**both can run at once; buyers choose**). The storefront is a Nuxt 3 SSR app and the admin panel is a Vue 3 SPA; both use **Tailwind CSS 4 + shadcn-vue**. Go serves the JSON API, payment callbacks, the embedded admin SPA, and background jobs.

> History: v0.1.0 codename **Earth**; v0.2.0 codename **Moon** (engineering overhaul); v0.3.0 migrated both UIs to shadcn-vue. See [CHANGELOG](CHANGELOG.md).
>
> This project is not affiliated with the BEpusdt author. BEpusdt is GPL-3.0; this project is MIT.

---

## Features

### Storefront (Nuxt 3 SSR + shadcn-vue)

- Product listing: categories / pinned / sorting / search / price filter, grid & list views
- Product detail with Cloudflare Turnstile verification, FAQ accordion, wholesale tiers
- Checkout: **choose a payment method (BEpusdt network / HashPay crypto)**, checkout opens in a new tab, current page redirects to the order detail
- Order detail: auto-polling while pending, card keys shown after payment, cancel support (closes the gateway transaction)
- Order lookup: recover by email only + "send view links to email" (vague responses, no email enumeration)
- Access credentials: every order is accessed via a **view token** emailed to the registered address; tokens are only sent to that email
- Privacy / Terms pages and first-run `/setup`
- SEO: canonical / OG / JSON-LD / sitemap / robots / favicon

### Admin panel (Vue 3 SPA + shadcn-vue)

- Dashboard: product / card / order stats, sales trend & product share, gross profit (cost snapshot), low-stock alerts
- Products: create / edit / category / pin / sort / price / list-unlist / FAQ / wholesale tiers / quantity limits
- Cards: import (dedupe) / delete / export
- Orders: view / CSV export / mark expired / cancel / change status / resend / batch resend / redeliver
- Coupons: fixed / percent, minimum amount, usage limit, product filter, expiry; **100% coupons auto-complete and deliver**
- Payments: **both gateways can run at once** with per-gateway config (base URL / token / merchant key / currency / timeout / callback path, applied immediately)
- Notifications: SMTP / Telegram / Webhook + **event templates** + admin email + test buttons
- Site: title / announcement / public URL / logo / favicon / SEO / links / copyright / privacy / terms / Turnstile
- Maintenance mode: toggle + message + unlock password (hashed & encrypted)
- Account: change username / password; TOTP 2FA (AES-encrypted secret)
- Security: admin RBAC + audit logs
- System: config backup / restore (no secrets) / full reset / background job status

### Backend (Go)

- SQLite storage (pure Go, no CGO); no app-level environment variables — **all configuration is written to the database** during setup or from the admin panel
- Config system: `settings` + `secrets` (AES-GCM encrypted) + `settings_version` (config schema upgrades)
- Layering: `api` (handler) → `service` (business) → `db/repository` (data) → `db/schema` (migrations)
- Domain events: typed events + versioned payloads + **Fanout consumer isolation**
- **Outbox pattern**: payment/delivery events are written to `outbox_events` in the same transaction; worker publishes them; 5 consecutive failures move to `dead_events`; published events are cleaned after 30 days
- Idempotency: payment callbacks register a unique key in `processed_events` (same transaction as the state change)
- Payment abstraction: business code depends only on the `payment.Gateway` interface; BEpusdt and HashPay are two implementations
- Jobs: goroutines + channels + ticker; panic isolation, startup compensation, `job_runs` records
- Background tasks: order expiry, email retry, cleanup, daily backup (`VACUUM INTO` + `integrity_check`)
- Logging (zap): app / payment / security channels, 50MB rotation x7; request_id / order_id / trace_id correlation
- Migrations: numbered .sql files (run once); config upgrades via `settings_version`
- Admin security: PBKDF2-SHA256, TOTP 2FA, login lockout (IP+username), timing equalization
- Observability: component health check `/health`, version injection, structured startup banner
- API docs: `/docs` (OpenAPI 3.0, json + yaml, `/swagger` alias), admin-only

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
| Storefront SSR | Nuxt 3 + Tailwind CSS 4 + shadcn-vue | 3001 |
| Admin SPA | Vue 3 + Vite + TS + Tailwind CSS 4 + shadcn-vue + Pinia | embedded in Go |

### Layering

```
HTTP handler (internal/api)
    → service (internal/service)
        → interfaces (OrderRepository / ProductRepository / KeyRepository / SettingsStore / AdminStore)
        → internal/db/repository (SQLite) + internal/db/schema (migrations)
```

- Handlers only adapt HTTP (parse / respond / rate limit / Turnstile / cookies / auth / Origin checks); no direct DB, gateway, or notification calls;
- Business logic lives in `service` and depends only on interfaces (mockable in tests); shared types and domain errors live in `internal/models`;
- All SQL lives in `internal/db/repository`; `internal/db/schema` is the only schema change entry point;
- Payments go through `payment.Gateway`; notifications run async via `internal/notify` + the job bus; critical events use the Outbox; background jobs run under `internal/jobs`.

### UI component conventions

- Each app has a `components.json` (shadcn-vue config: reka-nova style, aliases, CSS entry);
- `src/components/ui/` (admin) and `components/ui/` (storefront) contain **only shadcn-vue generated components**; add/remove them with `npx shadcn-vue@latest add <component>`, don't hand-edit core files;
- Business components live in the admin's `src/components/` (Modal / DataTable / FormField / PaginationBar / Toast / Confirm / PageCard / SideNav) and the storefront's `components/` (SiteHeader / SiteFooter);
- The theme uses shadcn-vue's default neutral CSS variables (inline in the CSS entry), with **no separate color/theme file**.

---

## Payment flow

```
Checkout (buyer picks gateway) → lock cards (atomic tx) → create transaction (payment.Gateway) → open checkout in new tab
  → current page redirects to order detail (auto-polling)
→ buyer transfers → gateway callback (BEpusdt MD5 / HashPay RSA envelope) → verify + processed_events idempotency → order paid
  → write outbox in same tx → worker sends card notification (email/Telegram/Webhook) → cards shown on the frontend
```

- Cancel / expiry: release stock + close the gateway transaction (HashPay has no merchant cancel API; it polls the order and relies on expiry callbacks as a fallback; late callbacks never deliver by mistake);
- Transaction boundaries: checkout = single tx (order + card lock + stock); failure atomically releases cards; payment success = single tx (paid + deliver), events/emails are only sent **after COMMIT**;
- Both gateways can run at once: each order records its gateway, `processed_events` keys are gateway-prefixed, callbacks use separate routes (`/notify/bepusdt`, `/notify/hashpay`);
- **payment.log** records every create/callback with order number, amount, trade ID, callback time, result, request_id / trace_id.

---

## Tech stack

| Layer | Stack |
| --- | --- |
| Storefront | Nuxt 3 SSR + Tailwind CSS 4 + shadcn-vue |
| Admin | Vue 3 + Vite + TypeScript + Tailwind CSS 4 + shadcn-vue + Pinia + VueUse + @lucide/vue |
| UI management | shadcn-vue CLI (`components.json`, powered by reka-ui) |
| Admin quality | ESLint (flat config + typescript-eslint + eslint-plugin-vue) + Prettier |
| API types | OpenAPI → TS generated (`admin-ui npm run gen:api` → `src/api/types.ts`) |
| Backend | Go 1.25.12+ (govulncheck clean) |
| Database | SQLite (modernc.org/sqlite), migrations + interface-based repositories |
| Logging | go.uber.org/zap + lumberjack |
| Jobs | goroutines + channels + ticker (no MQ), Outbox pattern |
| Reverse proxy | Caddy |
| Payments | BEpusdt / HashPay (via `payment.Gateway` interface, buyer-selectable) |
| Bot protection | Cloudflare Turnstile |

---

## Repository layout

```
cmd/shop/                Go entrypoint
internal/api/            HTTP routes, JSON API, payment callbacks, embedded admin, API docs (handler layer)
internal/service/        Business logic (small files per domain; repository.go defines interfaces)
internal/db/             Database connection layer
internal/db/schema/      Migration runner + migrations/*.sql (single schema entry point)
internal/db/repository/  All SQL (SQLite implementations + Store interfaces)
internal/db/settings_migrations.go   Config upgrades (settings_version)
internal/models/         Models, shared types, domain errors
internal/payment/        Gateway abstraction: interface.go + bepusdt.go + hashpay.go
internal/notify/         Notifications (templates / email / Telegram / Webhook)
internal/jobs/           Job bus + scheduler (order_expire / email_retry / outbox_publish / cleanup / backup)
internal/logging/        zap logging (app / payment / security) + correlation IDs
internal/security/       TOTP and AES-GCM encryption
internal/events/         Typed domain events + Fanout isolation + versioned payloads
internal/version/        Build info (injected via -ldflags)
internal/config/         Default configuration values
internal/testutil/       Integration test facilities (temp SQLite + MockGateway + NotifyRecorder)
internal/integration/    Order integration tests (callbacks / duplicate callbacks / cancel / timeout / concurrency)

admin-ui/                Vue 3 + Vite + shadcn-vue admin panel
  components.json        shadcn-vue component config
  src/components/        Business components (Modal / DataTable / FormField / PaginationBar / Toast / Confirm / PageCard / SideNav)
  src/components/ui/     shadcn-vue generated components
  src/views/             15 admin pages
  src/api/               API wrapper + generated types.ts
  src/stores|hooks|utils|i18n

storefront/              Nuxt 3 SSR storefront
  components.json        shadcn-vue component config
  components/ui/         shadcn-vue generated components (only the ones in use)
  components/            Business components (SiteHeader / SiteFooter)
  pages|layouts|composables|server|public
  lib/utils.ts           cn() helper (shadcn dependency)

data/                    Runtime data (SQLite + backups, gitignored)
logs/                    Runtime logs (gitignored)
AGENTS.md                Engineering conventions
```

> `internal/api/admin-ui` is the admin build output (embedded in the Go binary) and `storefront/.output` is the SSR build output; both are gitignored.

---

## Development

### Prerequisites

- Go 1.25.12+ (govulncheck baseline)
- Node.js 18+ / npm
- A BEpusdt instance or a HashPay instance (on Cloudflare Workers; the merchant panel generates the RSA key pair)

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

### Build & verify

```bash
# Admin assets → internal/api/admin-ui (embedded in the Go binary)
cd admin-ui && npm ci && npm run lint && npm run format:check && npm run typecheck && npm run build && cd ..

# Storefront SSR output → storefront/.output
cd storefront && npm ci && npm run lint && npm run format:check && npm run typecheck && npm run build && cd ..

# Single binary (embedded admin), optionally with version info
go build -ldflags "-X shop/internal/version.Version=0.3.0 -X shop/internal/version.Commit=$(git rev-parse --short HEAD)" -o shop ./cmd/shop
./shop

# Dependency baselines
govulncheck ./...
cd admin-ui && npm audit --omit=dev

# Admin code quality
cd admin-ui && npm run lint && npm run format
```

### Conventions (see AGENTS.md)

- Small-file rule for service/repository: split by responsibility, ~300 lines per file max;
- Repositories are interface-based; shared types/domain errors live in `internal/models`;
- Schema changes require new numbered .sql migrations; config upgrades go through `settings_version`; secrets are stored encrypted in the `secrets` table;
- Critical domain events go through the Outbox (same transaction); external events must be idempotent (`processed_events`);
- API changes must sync the OpenAPI spec and `npm run gen:api`; backups need `integrity_check` verification and restore drills;
- Manage shadcn components with the CLI; keep generated and business components in separate directories; no standalone color/theme file;
- Security baseline: Go ≥1.25.12 + govulncheck; login lockout includes IP; Origin checks on admin mutating endpoints; update tests and this README (zh/en) with changes.

---

## Deployment (server)

### Release flow (tag → release)

Pushing a `v*` tag triggers the CI Release: builds admin-ui / storefront → Go binary (version from the tag) → `liteshop-release.tgz` + `SHA256` → GitHub Release:

```bash
git tag v0.3.0 && git push origin v0.3.0
```

The artifact can be used directly with `install.sh`'s `BUILD_ARTIFACT` for fast deployment.

### One-click install (install.sh)

On a fresh Ubuntu / Debian / CentOS / Rocky / Alma server, with the domain A record pointing to it:

```bash
# Source build mode (~10 min; installs Go/Node/Caddy/systemd/SSL automatically)
curl -sSL https://raw.githubusercontent.com/mhan24/liteshop/main/install.sh | DOMAIN=shop.example.com bash

# Fast mode (recommended): prebuilt artifact, ~2 min
curl -sSL https://raw.githubusercontent.com/mhan24/liteshop/main/install.sh | \
  DOMAIN=shop.example.com BUILD_ARTIFACT=https://…/liteshop-release.tgz bash
```

Install variables: `DOMAIN` (required), `EMAIL`, `BRANCH`, `SKIP_SSL=1` (plain http), `BUILD_ARTIFACT`, `SHOP_USER`.

> Runtime configuration is initialized at `/setup` and written from the admin panel; the app reads no environment variables. No Docker dependency.

### HashPay integration

1. Deploy [HashPay](https://github.com/TGDash/HashPay) to Cloudflare Workers and finish its setup;
2. In the HashPay merchant panel create a **Native API** merchant, save the **private key** (shown once), and set the merchant Callback URL to LiteShop's HashPay callback (visible in the admin Payment page, default `https://your-domain/notify/hashpay`);
3. Enable **HashPay** in LiteShop admin → Payment (can run alongside BEpusdt) and fill in the site URL, merchant ID, private key, and currency (default USD);
4. With multiple gateways enabled, the storefront shows a **payment method choice**: BEpusdt shows network options (TRC20/ERC20 etc.), HashPay lets its hosted checkout pick the network/asset.

> The private key is shown once at merchant creation; LiteShop stores it AES-encrypted in the `secrets` table; leaving it blank keeps the current key.

### Build & deploy (build-release.sh)

```bash
bash build-release.sh /tmp/liteshop-release.tgz   # shop binary (injects git tag/commit/date) + storefront/.output
```

### Manual deployment

- Go: systemd unit `cardshop`, runs `/opt/cardshop/shop`, listens on 8080
- Storefront: systemd unit `liteshop-storefront`, runs `/opt/liteshop-storefront/server/index.mjs`, listens on 3001
- Caddy: proxies API/admin/callbacks to Go and everything else to Nuxt (CSP on the storefront)

---

## Tests & CI

- Unit/integration: `go test ./...` (migrations, signature verification, password hashing, state machines, coupons, sessions, login lockout, job bus, backups, health checks, security headers, concurrency, restore drills, legacy DB upgrades, events/idempotency/dead letters)
- **Mock tests**: services depend on interfaces and can run against in-memory stubs
- **Integration tests** (`internal/integration` + `internal/testutil`): temp SQLite + `MockGateway` / `NotifyRecorder`, covering both gateways' callbacks, **duplicate-callback idempotency**, cancel/timeout stock release, real HTTP callback routes, **100 concurrent buyers for 1 card**, Outbox dead letters, backup restore, legacy upgrades
- **Benchmarks**: `go test -bench=. ./internal/integration/`
- **Dependency baselines**: `govulncheck ./...` clean (Go 1.25.12); `npm audit` 0 runtime vulnerabilities (admin-ui only has the documented build-time js-yaml advisory)
- CI quality gates (`.github/workflows/quality.yml`, shared by CI and Release):
  - admin-ui: `npm ci` → lint → format:check → typecheck → gen:api diff → build
  - storefront: `npm ci` → lint → format:check → typecheck → build
  - Go: gofmt / vet / staticcheck / govulncheck / build / test + arm64 binary
- Release only packages (tgz + SHA256) after the same quality gates pass

---

## Caching & SEO

| Path | Cache-Control |
| --- | --- |
| `/_nuxt/*`, `/assets/*`, `/admin/assets/*` | `public, max-age=31536000, immutable` |
| `/robots.txt`, `/sitemap.xml` | `public, max-age=3600` |
| `/favicon.svg` | `public, max-age=86400` |
| `/`, `/api/*`, `/admin/*`, `/order*`, `/product*`, `/page*`, `/setup`, `/health` | `no-store` + `X-Robots-Tag: noindex` |

- Dynamic pages are never cached; the site origin comes from the database (`public_base_url`), not Host/env vars;
- SSR caching: dynamic pages and product listings stay `no-store`; ISR / edge cache is not implemented yet.

---

## Observability

- Logging (zap): `logs/app.log` / `logs/payment.log` / `logs/security.log`, 50MB rotation x7
- Health check `GET /health`: app name, version, build info, `config_version`, uptime, component status
- Health metrics: `database` (status / size_bytes / migration_version / last_backup / integrity) + `jobs` (mail_queue_size / last_success)
- Version is managed in `internal/version` and injected via `-ldflags` at build time
- Admin endpoints `/api/v1/admin/version` (build info) and `/api/v1/admin/jobs` (job records, queue/dead-letter metrics)
- Correlation: `request_id` per request; payment logs carry request_id / order_no / trace_id
- Security header regression tests in `internal/api/security_test.go`; because the site sits behind Cloudflare, the admin CSP allows edge-injected scripts and the Web Analytics beacon (consistent with the storefront), and the storefront CSP allows Turnstile

---

## API docs

- URL: `/docs` (alias `/swagger`), **visible to admins only**
- Spec files: `internal/api/api_docs/openapi.json` and `openapi.yaml` (OpenAPI 3.0 covering storefront / admin / payment callbacks; embedded in the binary)
- Frontend types: `admin-ui/src/api/types.ts` generated from the spec (`npm run gen:api`, CI diff check)
- Maintenance: API changes must update `internal/api/api_docs/openapi.json` (yaml and TS types are generated from the json)

---

## Security notes

- Passwords: PBKDF2-SHA256 (100k iterations) + constant-time compare; login timing equalized; **5 failed attempts lock for 10 minutes (IP+username)**
- TOTP 2FA secrets are AES-GCM encrypted; sensitive config (payment/email/notify/maintenance passwords) is AES-encrypted in the `secrets` table
- Order view tokens are only delivered by email; sessions are revoked immediately on delete/logout/restore/reset
- State machines are atomic (deliver/cancel/expire in single transactions); concurrent stock uses `_txlock=immediate` + atomic card locking
- All SQL is parameterized; markdown disables HTML and whitelists link protocols; CSV formula-injection protection; CSP/HSTS/security headers
- Config backups exclude secrets; explicit HTTP timeouts; async tasks never block payment callbacks; workers/event consumers are panic-isolated
- Rate-limit trust boundary: `CF-Connecting-IP` is only trusted when the peer is a Cloudflare edge IP; admin mutating endpoints validate Origin
- security.log records login success/failure/lockout and TOTP verification
- The session master secret (`session_secret`) is stored in plain `settings` (a no-env-vars design tradeoff): protect database access strictly; a server-local key file is planned via `settings_version` v2

---

## Versions & license

- v0.3.0: UIs migrated to shadcn-vue; v0.2.0 codename **Moon**; v0.1.0 codename **Earth**; full changelog in [CHANGELOG.md](CHANGELOG.md)
- MIT — see [LICENSE](LICENSE).
