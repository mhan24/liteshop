# LiteShop

An automated digital-goods delivery (card/activation-code) shop built with **Go + SQLite**, integrated with the [BEpusdt](https://github.com/v03413/BEpusdt) crypto payment gateway. The buyer storefront uses Nuxt 3 SSR + Tailwind; the admin panel uses Vue 3 + TypeScript + Element Plus + Pinia; Go serves the JSON API and payment callbacks.

> This project is not affiliated with the BEpusdt author. BEpusdt is GPL-3.0; this project is MIT.

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

---

## Features

### Storefront (Nuxt 3 SSR)

- Product listing: categories / pinned / sorting
- Product detail + Cloudflare Turnstile
- Checkout: open the BEpusdt checkout in a new tab, redirect to the order page
- Order detail: auto-poll while waiting, cards shown on payment success, cancel order (closes the BEpusdt transaction)
- Order lookup by email
- Privacy / Terms / first-time `/setup`
- SEO: canonical / OG / JSON-LD / sitemap / robots / favicon

> Access note: Every order (including legacy ones) uses a view token delivered by email to view cards / cancel; the token is only mailed to the registered address. Legacy orders were backfilled with tokens by migration, so "email + order number" access is no longer supported. The lookup API never returns order numbers or view links — use "send view link to my email" to recover a lost link.

### Admin panel (Element Plus + Pinia)

- Dashboard: products / cards / orders stats
- Products: create / edit / category / pinned / sorting / price / status
- Cards: import / delete / export
- Orders: view / CSV export / mark expired / resend notification
- Payment: BEpusdt base URL / API token / trade types / timeout / public URL / callback URL
- Notifications: SMTP / Telegram / mail templates (placeholders)
- Site: title / announcement / SEO / links / copyright / privacy / terms / Turnstile
- Maintenance mode: toggle + notice + unlock password
- Account: username / password
- System: config backup / restore / wipe and re-init
- Admins: multi-account RBAC (admin / operator / viewer) + audit logs
- TOTP two-factor authentication
- Coupons (fixed / percent) and wholesale tiered pricing

### Backend (Go)

- SQLite storage (pure Go, no CGO); all configuration in the `settings` table, no `.env`
- BEpusdt integration: create / cancel transaction, callback signature verification (MD5)
- Rate limiting (orders 20/min, login 10/min, etc.)
- Security headers (X-Frame-Options / nosniff / Referrer-Policy / Permissions-Policy) + admin CSP
- Health check `/health`
- First-time initialization `/setup`

---

## Payment flow

```
Order → lock cards → create BEpusdt transaction → open checkout in a new tab
  → redirect to the order page (auto-polling)
  → user pays → BEpusdt callback /notify/bepusdt → verify signature → order paid
  → cards sold → email/Telegram notification → cards shown on the order page
```

Cancel / expire: release stock and call BEpusdt `cancel-transaction`.

---

## Tech stack

| Layer | Stack |
| --- | --- |
| Storefront | Nuxt 3 SSR + Tailwind CSS |
| Admin | Vue 3 + Vite + TypeScript + Element Plus + Pinia |
| Backend | Go 1.25+ |
| Database | SQLite (modernc.org/sqlite) |
| Reverse proxy | Caddy |
| Payment | BEpusdt |
| Security | Cloudflare Turnstile |

---

## Directory structure

```
cmd/shop/            Go entrypoint
internal/config/     configuration defaults
internal/db/         database layer: sqlite.go / postgres.go (future) / migrations / settings
internal/db/repository/  repositories: OrderRepository / ProductRepository / KeyRepository
internal/models/     models & helpers
internal/bepusdt/    BEpusdt create/cancel/sign/verify
internal/notify/     email / Telegram notifications
internal/order/      order business logic (service)
internal/product/    product business logic (service)
internal/security/   TOTP & AES-GCM cipher
internal/web/        HTTP routes, JSON API, embedded admin SPA
admin-ui/            Element Plus admin (TS + Pinia; src/api|views|stores|hooks|utils|components)
storefront/          Nuxt 3 SSR storefront (Tailwind)
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

### Build

```bash
# Admin static assets → internal/web/admin-ui
cd admin-ui && npm install && npm run build && cd ..

# Storefront SSR output → storefront/.output
cd storefront && npm install && npm run build && cd ..

# Single Go binary (embeds the admin UI)
go build -o shop ./cmd/shop
./shop
```

> `internal/web/admin-ui` is a build artifact, ignored by `.gitignore`, not committed.

---

## Deployment (server)

### One-click install

On a fresh Ubuntu / Debian / CentOS / Rocky / Alma server, point the domain A record to the server, then:

```bash
# Source build mode (~10 min; installs Go/Node/Caddy/systemd/SSL automatically)
curl -sSL https://raw.githubusercontent.com/mhan24/liteshop/main/install.sh | DOMAIN=shop.example.com bash

# Fast mode (recommended): prebuilt artifact, ~2 min
curl -sSL https://raw.githubusercontent.com/mhan24/liteshop/main/install.sh | \
  DOMAIN=shop.example.com BUILD_ARTIFACT=https://…/liteshop-release.tgz bash
```

Env vars: `DOMAIN` (required), `EMAIL` (Let's Encrypt), `BRANCH`, `SKIP_SSL=1` (plain http), `BUILD_ARTIFACT` (prebuilt tgz), `SHOP_USER`.

> Runtime configuration (site URL, payment, notifications, etc.) is stored in the database `settings` table via `/setup` and the admin panel; the app reads no application-level environment variables.

### Manual deployment

- Go: systemd `cardshop`, runs `/opt/cardshop/shop`, listens on 8080
- Storefront: systemd `liteshop-storefront`, runs `/opt/liteshop-storefront/server/index.mjs`, listens on 3001
- Caddy: route API/admin/callback to Go, everything else to Nuxt

---

## Tests & CI

- Go unit tests: `go test ./...` (BEpusdt signing/verification, price conversion, order numbers, password hashing, state machine)
- CI (`.github/workflows/ci.yml`): Go `vet` / `build` / `test` (linux-arm64 artifact) + admin-ui and storefront builds

---

## Caching & SEO

Caddy cache headers:

| Path | Cache-Control |
| --- | --- |
| `/_nuxt/*`, `/assets/*`, `/admin/assets/*` | `public, max-age=31536000, immutable` |
| `/robots.txt`, `/sitemap.xml` | `public, max-age=3600` |
| `/favicon.svg` | `public, max-age=86400` |
| `/api/*`, `/admin/*`, `/order*`, `/setup`, `/health` | `no-store` + `X-Robots-Tag: noindex` |

- HTML pages are not cached by default (SSR dynamic); Nuxt outputs canonical / OG / JSON-LD.
- `robots.txt` outputs a `Sitemap:` pointer; `sitemap.xml` dynamically includes product URLs.
- Security headers are set by Caddy / Go: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS.

> **Cloudflare note**: if Cloudflare's "Managed robots.txt" is enabled, it may merge/override `robots.txt`. Disable it in Cloudflare → Bots / Scrape Shield if you need the origin to fully control robots and cache headers.

---

## BEpusdt integration

- Get the API token from the BEpusdt admin panel
- Create transaction → redirect to checkout; cancel/expire calls `cancel-transaction`
- Payment success callback `/notify/bepusdt`
- Signature: sorted params + API token, MD5; empty/null values are excluded

> MD5 signing is the fixed requirement of the BEpusdt protocol and cannot be replaced unilaterally; security relies on the shared API token.

---

## Cloudflare Turnstile

- The storefront checkout embeds Turnstile
- Backend verifies via canonical siteverify before creating an order; the hostname must match (relaxed for IP/local access)

---

## Security notes

- Passwords: PBKDF2-SHA256 (100k iterations) + constant-time compare
- TOTP 2FA secrets encrypted with AES-GCM (derived from `session_secret`)
- Order view tokens: random per-order tokens delivered only by email; constant-time comparison
- Sessions persisted in SQLite with HMAC-signed cookies; revoked immediately on logout / admin deletion / restore / reset
- All SQL parameterized; markdown rendering disables HTML; CSV export guards formula injection
- Config backups exclude secret keys (payment / SMTP / Telegram / Webhook / Turnstile / maintenance password)
- Rate limits on orders / login / 2FA / maintenance unlock / order lookup / order detail / cancel / order links / setup

---

## License

MIT, see [LICENSE](LICENSE).
