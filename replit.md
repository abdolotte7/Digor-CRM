# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 20
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server
│   ├── digor-website/      # Public marketing site (digorva.com)
│   ├── digor-crm/          # Digor CRM portal (/crm/)
│   └── digor-tools/        # Internal tools portal (/tools/) — skip trace, distressed finder, ARV, property lookup
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts, run via `pnpm --filter @workspace/scripts run <script>`
├── pnpm-workspace.yaml     # pnpm workspace (artifacts/*, lib/*, lib/integrations/*, scripts)
├── tsconfig.base.json      # Shared TS options (composite, bundler resolution, es2022)
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Artifacts

### `artifacts/digor-crm` (`@workspace/digor-crm`)

React + Vite CRM portal served at `/crm/`. Multi-tenant: each client gets their own isolated Campaign workspace.

**Roles & Access:**
- `super_admin` — Digor staff only (null campaignId). Can create campaigns + campaign admins, sees all data.
- `admin` — Campaign admin. Manages their campaign's users, leads, links, tasks. Cannot see other campaigns.
- `sales` — Can view/edit all leads in their campaign.
- `va` — Can only see leads assigned to them.

**Multi-tenancy:**
- `crm_campaigns` table: each client has one campaign (id, name, slug, active).
- All CRM tables (`crm_users`, `crm_leads`, `crm_tasks`, `crm_submission_links`) have a `campaign_id` FK.
- JWT token carries `{ userId, email, role, campaignId }`. All routes enforce campaign isolation from the token.
- Super admin sees all campaigns; campaign admins/users see only their own data.

**Login flow:** Login returns `user.role`. If `super_admin` → redirect to `/crm/campaigns`. Otherwise → `/crm/` dashboard.

**Super admin credentials:** `admin@digorcrm.com` / set via seed script (uses bcrypt, no plaintext stored).

**API routes:** `POST /api/crm/auth/login`, `GET /api/crm/me`, `GET|POST /api/crm/campaigns`, `GET|POST|PATCH|DELETE /api/crm/leads`, `GET|POST|PATCH|DELETE /api/crm/tasks`, `GET|POST|PATCH|DELETE /api/crm/users`, `GET|POST|PATCH|DELETE /api/crm/links`, `GET /api/crm/stats`.

**Security:** All secrets (JWT_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD) are loaded from env vars only — no hardcoded fallbacks. Server throws on startup if any are missing.

### `artifacts/digor-website` (`@workspace/digor-website`)

Digor LLC corporate B2B website. React + Vite SPA served at `/`. Features:
- Dark professional design with gold accents
- All sections: Hero, Services, Methodology, Case Studies, Team, About, Contact
- Framer Motion scroll-triggered animations
- Contact form connected to API at `POST /api/contact`
- AI-generated images for hero, about, and team avatars
- Bank-compliant professional language (no "cold callers", "leads", etc.)
- Contact: digorva@digorcom.com | (602) 654-3140 | 1309 Coffeen Ave STE 1200, Sheridan WY 82801

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, routes at `/api`
- Routes: `src/routes/index.ts` mounts sub-routers; `src/routes/health.ts` exposes `GET /health` (full path: `/api/health`)
- Depends on: `@workspace/db`, `@workspace/api-zod`
- `pnpm --filter @workspace/api-server run dev` — run the dev server
- `pnpm --filter @workspace/api-server run build` — production esbuild bundle (`dist/index.cjs`)
- Build bundles an allowlist of deps (express, cors, pg, drizzle-orm, zod, etc.) and externalizes the rest

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Exports a Drizzle client instance and schema models.

- `src/index.ts` — creates a `Pool` + Drizzle instance, exports schema
- `src/schema/index.ts` — barrel re-export of all models
- `src/schema/<modelname>.ts` — table definitions with `drizzle-zod` insert schemas (no models definitions exist right now)
- `drizzle.config.ts` — Drizzle Kit config (requires `DATABASE_URL`, automatically provided by Replit)
- Exports: `.` (pool, db, schema), `./schema` (schema only)

Production migrations are handled by Replit when publishing. In development, we just use `pnpm --filter @workspace/db run push`, and we fallback to `pnpm --filter @workspace/db run push-force`.

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and the Orval config (`orval.config.ts`). Running codegen produces output into two sibling packages:

1. `lib/api-client-react/src/generated/` — React Query hooks + fetch client
2. `lib/api-zod/src/generated/` — Zod schemas

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec (e.g. `HealthCheckResponse`). Used by `api-server` for response validation.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec (e.g. `useHealthCheck`, `healthCheck`).

### `scripts` (`@workspace/scripts`)

Utility scripts package. Each script is a `.ts` file in `src/` with a corresponding npm script in `package.json`. Run scripts via `pnpm --filter @workspace/scripts run <script>`. Scripts can import any workspace package (e.g., `@workspace/db`) by adding it as a dependency in `scripts/package.json`.

## Digor CRM Features

### Database Schema (`lib/db/src/schema/crm.ts`)
Tables: `crm_campaigns`, `crm_users`, `crm_leads`, `crm_notes`, `crm_tasks`, `crm_submission_links`, `crm_email_sequences`, `crm_sequence_steps`, `crm_sequence_logs`, `crm_comps`

### Lead Fields
Seller info, property details (type/beds/baths/sqft/condition 1-10/occupancy/isRental), seller motivation (reasonForSelling/howSoon), financials (askingPrice/currentValue/ARV/ERC/MAO auto-calc), notes.

### CRM Pages & Routes
- `/` — Dashboard with stats
- `/leads` — Lead list with aging badges (7d orange, 14d+ red)
- `/leads/new` — 6-section new lead form
- `/leads/:id` — Lead detail with: status pipeline, comps section (adjusted ARV with deal flag), "Fetch Property Data" button (PropertyAPI.co), offer letter generator (print), email history, notes, tasks, MAO calculator
- `/pipeline` — Kanban board (drag-and-drop via @dnd-kit, all 7 status columns)
- `/tasks` — Task list
- `/campaigns` — Campaign management (super_admin only)
- `/admin/users` — Team users
- `/admin/links` — Submission links
- `/admin/sequences` — Email sequence automation (create sequences with day-offset steps, template variables {{name}} {{address}})

### API Routes (api-server)
All under `/api/crm/`:
- `auth/` — login, me
- `campaigns/` — CRUD
- `leads/` — CRUD + notes + tasks + estimate
- `leads/:id/comps/` — comparable sales CRUD with adjustment factors (beds $12.5k, baths $7.5k, sqft $50/sf, yearBuilt $150/yr), auto-recalculates ARV/MAO after each change, deal quality flag (ARV/asking < 1.7x = warn)
- `leads/:id/fetch-property-data` — calls PropertyAPI.co (X-Api-Key: PROPERTY_API_KEY), auto-fills beds/baths/sqft/propertyType/yearBuilt/latitude/longitude only for empty fields; stores lat/lng for later use
- `leads/:id/fetch-comps` — auto-fetches recently-sold comps from PropertyAPI 4-step radius search (count FREE → export → poll → download CSV); filters to last 24 months, up to 8 comps; auto-calculates adjusted prices & updates ARV/MAO; refuses if radius has >25 parcels; lat/lng resolved from stored value or fresh property lookup
- `tasks/` — CRUD
- `users/` — CRUD
- `links/` — CRUD + public submission endpoint
- `sequences/` — CRUD with steps + email logs
- `stats/` — dashboard stats
- `public/submit/:token` — public lead submission form

### Email Sequences
Background job runs every hour in-process (setInterval). Finds active sequences, checks leads matching campaign, sends emails via SMTP when day_offset matches days since lead creation. Skips if already sent (checked via crm_sequence_logs). Template vars: `{{name}}`, `{{address}}`.

### Offer Letter Generator
Client-side only — opens a new browser window with pre-styled HTML (Georgia serif, professional layout with property/seller/financial info, terms, signature lines) and auto-triggers `window.print()`. No server required.

### Lead Aging Alerts
Both LeadList and Pipeline/Kanban show time-since-last-update badges: orange (7-13 days), red (14+ days).

### Important Notes
- After schema changes: run `cd lib/db && pnpm run push` then `pnpm exec tsc --build` to update types
- CRM super admin credentials: set via `CRM_ADMIN_EMAIL` / `CRM_ADMIN_PASSWORD` secrets (seed syncs on startup)
- `apiUrl()` pattern: always `/api/crm${path}` (no BASE_URL prefix) in CRM pages
- Kanban: uses `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`
- **Production body parsing**: Replit autoscale proxy strips `Content-Type` header from POST requests. Fixed by: (1) `express.json()` with custom `type` function that accepts any non-form content type, (2) fallback raw stream reader middleware, (3) `req.body ?? {}` in auth route. CORS also includes `*.replit.app`.
- **Deployment**: `deploymentTarget = "autoscale"` in `.replit`. After any code change, rebuild with `pnpm --filter @workspace/api-server run build` then redeploy.
