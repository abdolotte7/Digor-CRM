# Digor CRM & Tools Platform

![CI](https://github.com/abdolotte7/digor/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Node 20](https://img.shields.io/badge/node-20-brightgreen)
![pnpm 10](https://img.shields.io/badge/pnpm-10-orange)
![Deploy: Railway](https://img.shields.io/badge/deploy-Railway-blueviolet)

A full-stack real estate wholesaling platform built to solve real acquisition, communication, and analysis problems for real estate investors, wholesalers, and agents. The system combines a multi-tenant CRM, an internal tools suite, a public-facing marketing website, and a shared API server — all running as a monorepo deployed on Railway.

---

## Table of Contents

- [Getting Started (dev)](#getting-started-dev)
- [Business Problem & Case Study](#business-problem--case-study)
- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Applications](#applications)
  - [Digor CRM](#digor-crm)
  - [Digor Tools](#digor-tools)
  - [Digor Website](#digor-website)
  - [API Server](#api-server)
- [AI Integrations](#ai-integrations)
- [Third-Party APIs & Integrations](#third-party-apis--integrations)
- [Database Schema](#database-schema)
- [Key Engineering Decisions](#key-engineering-decisions)
- [Environment Variables](#environment-variables)
- [Production Notes](#production-notes)

---

## Getting Started (dev)

### Prerequisites

- [Node.js 20](https://nodejs.org/) (see `.nvmrc`)
- [pnpm 10](https://pnpm.io/installation) — `npm install -g pnpm`
- PostgreSQL (local or remote — see `DATABASE_URL` below)

### Setup

```bash
# 1. Clone and install all workspace dependencies
git clone https://github.com/abdolotte7/digor.git
cd digor
pnpm install

# 2. Copy the environment template and fill in your values
cp .env.example .env
#    At minimum: DATABASE_URL, JWT_SECRET, CRM_ADMIN_EMAIL, CRM_ADMIN_PASSWORD, TOOLS_PIN

# 3. Push the schema to your database (runs Drizzle migrations)
cd lib/db && pnpm run push && cd ../..

# 4. Run the full type-check across the monorepo
pnpm run typecheck
```

### Running locally

Each application has its own dev server. Open separate terminals:

```bash
# API server (Express 5 — required by all front-ends)
pnpm --filter @workspace/api-server run dev

# CRM portal  →  http://localhost:<PORT>/crm/
pnpm --filter @workspace/digor-crm run dev

# Tools portal  →  http://localhost:<PORT>/tools/
pnpm --filter @workspace/digor-tools run dev

# Public website  →  http://localhost:<PORT>/
pnpm --filter @workspace/digor-website run dev
```

> **Replit users:** workflows for each service are pre-configured. Use the
> Run button or the workflow panel to start them individually.

### Build (production)

```bash
pnpm run build        # typecheck + build all packages
```

For architecture details, JWT rules, and comp math see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Business Problem & Case Study

### The Problem

Real estate wholesalers and investors typically rely on 4–6 disconnected tools:

- A lead capture form (Typeform, JotForm)
- A spreadsheet or basic CRM for tracking deals
- A separate phone dialer (Google Voice, SignalWire)
- Manual comps from Zillow or MLS
- A third-party skip trace service ($0.15–$0.50/record)
- A separate distressed list provider ($200–$800/month)

This fragmentation causes deals to fall through the cracks, data to go stale, and teams to waste hours on manual lookups. A wholesaler working 50 leads per month would spend 20–30% of their time on data entry and cross-referencing tools that don't talk to each other.

### The Solution

Digor is a unified platform that consolidates every step of the wholesaling workflow:

1. **Lead intake** — Public submission links let motivated sellers submit directly; CRM agents capture inbound leads in a structured 6-section form
2. **Property intelligence** — One click pulls property data (beds/baths/sqft/year/value), skip traces the owner for phone and email, and fetches recently-sold comps automatically
3. **AI-assisted underwriting** — Llama 3.1 70B scores deals 1–10, estimates repair costs from free-text descriptions, generates seller scripts, and writes offer letters — all from within the deal record
4. **ARV calculation** — ATTOM comp data filtered by property type and sqft ratio, adjusted for beds/baths/year/time, with ATTOM AVM as a secondary signal
5. **Communication** — SignalWire and OpenPhone integrations log calls and SMS messages directly inside the lead record; no context switching
6. **Distressed list building** — ATTOM mortgage data used to find absentee owners and free-and-clear properties by ZIP or city; enriched with skip trace in one job
7. **Automated follow-up** — Email sequences with per-day-offset scheduling run in the background without any manual trigger

### Measured Impact

| Problem | Before | After |
|---|---|---|
| Time to underwrite a deal | 45–90 minutes across 4 tools | Under 3 minutes in one screen |
| Skip trace cost per record | $0.15–$0.50 (third-party) | Self-hosted via PropertyAPI key rotation |
| ARV accuracy (multi-family contamination) | Frequent 20–40% overestimates | Filtered to SFR comps within ±43% sqft |
| Lead follow-up consistency | Manual and inconsistent | Automated day-offset email sequences |
| Team accountability | Spreadsheets with no audit trail | Role-gated CRM with task assignments and aging alerts |

### Case Study Walkthrough — Lead to Offer in Under 3 Minutes

**Scenario:** Inbound motivated-seller call. Homeowner at `4821 W Cholla St, Phoenix, AZ 85029`
is behind on payments and wants to close in 30 days.

**Step 1 — Lead captured (0:00)**

Agent opens "New Lead" in the CRM, fills in seller name, phone, address, and motivation
("behind on payments"). Saves the record. Total time: ~40 seconds.

**Step 2 — Property data fetched (0:40)**

Agent clicks "Fetch Property Data". One API call to PropertyAPI.co returns:
- 3 bed / 2 bath / 1,420 sqft / built 1978 / SFR
- Owner-confirmed absentee (matches mailing address in another state)
- AVM estimate: $285,000

Fields auto-populate into the lead record. No manual entry.

**Step 3 — Comps pulled and ARV calculated (1:10)**

Agent clicks "Fetch Comps". ATTOM returns 6 SFR sales within 0.5 mi, last 18 months,
all filtered to 810–2,485 sqft. After per-comp adjustments:

| Address | Sale Price | Adjusted |
|---|---|---|
| 4803 W Dahlia Dr | $272,000 | $278,400 |
| 4915 W Cholla St | $265,000 | $271,500 |
| 4701 W Joan De Arc | $291,000 | $284,200 |
| 5003 W Cinnabar Ave | $288,500 | $280,100 |
| 4822 W Gardenia Ave | $275,000 | $277,800 |
| 4600 W Eva St | $269,000 | $275,600 |

**Comp-based ARV: $278,950** (median of adjusted values)
**ATTOM AVM: $281,000** (confidence: 82%) — delta: +0.7% ✓

**Step 4 — AI deal score (1:45)**

Asking price: $195,000. Estimated repairs (from seller description — "roof is 15 years old,
kitchen needs update"): AI Repair Estimator returns `$28,500` line-item breakdown.

- MAO = $278,950 × 0.70 − $28,500 = **$166,765**
- AI Deal Score: **8 / 10**
  - Strengths: strong comp coverage, motivated seller, 30-day close timeline
  - Risk: roof age — confirm scope before locking in repair budget
  - Recommendation: Submit offer at $162,000 with 7-day inspection contingency

**Step 5 — Offer letter generated (2:30)**

Agent clicks "Generate Offer Letter". AI produces a professional PDF-ready offer
document with the property address, offer price ($162,000), 7-day inspection period,
and 30-day closing. Printed and emailed to seller in one click.

**Total elapsed time: ~2 minutes 45 seconds.**

Without Digor, this same workflow required pulling up Zillow/MLS for comps (15–20 min),
running a separate skip trace ($0.35/record), manually calculating MAO on a spreadsheet,
and drafting an offer letter in Word. Typical elapsed time: 60–90 minutes.

---

## Architecture Overview

```
monorepo/
├── artifacts/
│   ├── api-server/        Express 5 API — all business logic and integrations
│   ├── digor-crm/         React + Vite CRM portal  (/crm/)
│   ├── digor-tools/       React + Vite internal tools (/tools/)
│   └── digor-website/     React + Vite public marketing site (/)
├── lib/
│   ├── api-spec/          OpenAPI 3.1 spec + Orval codegen config
│   ├── api-client-react/  Generated React Query hooks
│   ├── api-zod/           Generated Zod schemas
│   └── db/                Drizzle ORM schema + PostgreSQL connection
└── scripts/               One-off utility scripts (seeding, migrations)
```

All four applications share a single PostgreSQL database and are served behind a single Railway deployment. The API server runs on a dedicated port; the three React apps are built as static assets and served at path-based routes.

---

## Tech Stack

### Backend
| Technology | Version | Purpose |
|---|---|---|
| Node.js | 23 | Runtime |
| TypeScript | 5.9 | Type safety across the entire monorepo |
| Express | 5 | HTTP framework |
| PostgreSQL | — | Primary database |
| Drizzle ORM | latest | Type-safe query builder + schema management |
| drizzle-zod | latest | Zod schemas auto-generated from Drizzle tables |
| Zod | v4 | Runtime validation |
| esbuild | latest | Production bundler (CJS output) |
| pnpm workspaces | 10 | Monorepo package management |

### Frontend (CRM + Tools + Website)
| Technology | Version | Purpose |
|---|---|---|
| React | 18 | UI framework |
| Vite | 7 | Dev server and build tool |
| TypeScript | 5.9 | Type safety |
| TanStack Query | v5 | Server state, caching, mutations |
| TanStack Router | latest | File-based routing |
| Tailwind CSS | v4 | Utility-first styling |
| shadcn/ui | latest | Component library (Radix UI primitives) |
| Framer Motion | latest | Scroll-triggered animations (website) |
| @dnd-kit | latest | Drag-and-drop Kanban board |
| Orval | latest | OpenAPI → React Query hooks codegen |

### AI / LLM
| Technology | Purpose |
|---|---|
| Groq API | Inference provider — sub-second responses via Llama 3.1 70B |
| Meta Llama 3.1 70B Versatile | Deal scoring, repair estimation, seller scripts, offer letters |
| Market price-per-sqft estimation | AI fallback when ATTOM comp data is insufficient |

### Communications
| Technology | Purpose |
|---|---|
| SignalWire | VoIP call logging and SMS, stored per-lead |
| OpenPhone | Alternative telephony integration with per-lead message threading |
| SMTP (Nodemailer) | Outbound email for automated sequences and contact form |

### Data & Valuation APIs
| API | Purpose |
|---|---|
| ATTOM Data | Comps (`sale/snapshot`), property snapshot, AVM (`attomavm/detail`), mortgage/owner detail (`detailmortgageowner`) |
| PropertyAPI.co | Property data enrichment, skip trace (up to 7 key rotation), AVM |
| Rentcast | Rental valuation and AVM for CRM leads |
| US Census Bureau | Free county FIPS resolution for geo-targeted distressed searches |
| Zippopotam.us | Free ZIP code lookup by city/state for distressed search expansion |

### Infrastructure & Payments
| Technology | Purpose |
|---|---|
| Railway | Deployment platform (Railpack builder) |
| Stripe | Subscription management and checkout |
| JWT + bcrypt | Authentication, password hashing |
| Papa Parse | CSV parsing/generation for skip trace exports |

---

## Applications

### Digor CRM

Multi-tenant CRM built for real estate wholesaling teams. Each client organization is isolated in its own Campaign workspace.

#### Role-Based Access Control

| Role | Access |
|---|---|
| `super_admin` | Digor staff; cross-campaign visibility; can create campaigns and campaign admins |
| `admin` | Campaign admin; manages their campaign's users, leads, tasks, links |
| `sales` | Full lead read/write within their campaign |
| `va` | View/edit leads assigned to them only |

#### CRM Pages

| Page | Description |
|---|---|
| Dashboard | Live deal stats: active leads, tasks due, pipeline value, ARV totals |
| Lead List | Paginated lead table with aging badges (7-day orange, 14-day+ red) and quick filters |
| New Lead | 6-section structured intake form: seller info, property details, motivation, financials, notes |
| Lead Detail | Full deal workspace — see below |
| Pipeline | Drag-and-drop Kanban board with all 7 status columns; visual aging indicators |
| Tasks | Cross-lead task list with due dates and assignees |
| Buyers List | Buyer database for deal assignment and co-wholesaling |
| Email Sequences | Automated follow-up sequences with day-offset steps and template variables |
| Campaign Management | Super admin: create/manage client campaigns |
| Team Users | Admin: invite and manage team members |
| Submission Links | Tokenized public links for seller self-submission |

#### Lead Detail — Full Feature Breakdown

The lead detail page is the core of the CRM. Every feature below is accessible from a single screen:

**Property Data**
- One-click property data fetch via PropertyAPI.co (auto-fills beds/baths/sqft/type/year/coordinates)
- Manual field editing with condition scoring (1–10 slider), occupancy, and rental flag

**Comparable Sales & ARV**
- Auto-fetch comps: 4-step radius search (0.1mi → 0.25mi → 0.5mi → 1mi), filters to last 24 months, up to 8 comps
- Manual comp entry with address, beds/baths/sqft/year/sale price
- Adjustment engine: `$12,500/bed`, `$7,500/bath`, `$50/sqft`, `$150/year-built`
- Automatic ARV recalculation and MAO update after each comp change
- Deal quality flag: warns when `ARV / asking price < 1.7x`
- **ATTOM comp fetch**: radius-based lat/lon query via `sale/snapshot`, property-type filter (excludes multi-family), sqft ratio filter (0.57–1.75×), time-appreciation adjustment (3%/year)
- **Rentcast AVM**: on-demand rental/sale valuation with range
- **ATTOM AVM**: secondary automated valuation from `/attomavm/detail` with confidence score and low/high range

**AI Features (Groq — Llama 3.1 70B)**
- **AI Deal Scorer**: Scores the deal 1–10 with detailed reasoning; considers ARV, asking price, repair estimate, MAO, seller motivation, property condition, and timeline
- **AI Repair Estimator**: Parses a free-text property description ("roof needs work, kitchen dated, HVAC is 15 years old") and returns a line-item cost breakdown with total; one-click apply to the deal record
- **AI Seller Script**: Generates a structured call script with an opener, discovery questions, objection handling, and close — personalized to the seller's motivation and situation
- **AI Offer Letter**: Generates a professional offer letter with deal terms, contingencies, and closing timeline; rendered as a printable HTML document

**Communications**
- **SignalWire**: In-lead call and SMS log with message history; polling-based refresh
- **OpenPhone**: Alternative telephony panel with per-lead message threading
- Call notes and disposition logging within the lead record

**Workflow**
- Status pipeline: `new_lead → contacted → negotiating → under_contract → closed_won → closed_lost → on_hold`
- Task assignment and due dates directly from the lead detail
- Note history with `@username` mention support
- Offer letter print (client-side HTML rendering, no server required)

#### Email Sequences

Background job (hourly `setInterval`) sends automated emails based on `day_offset` since lead creation. Template variables: `{{name}}`, `{{address}}`. Deduplication via `crm_sequence_logs` table prevents double-sends. Sequences are campaign-scoped and role-gated.

#### Public Lead Submission

Tokenized submission links allow motivated sellers to fill out a form directly. Submissions are validated, created in the CRM, and assigned to the campaign automatically. No account required for the seller.

---

### Digor Tools

PIN-gated internal tools portal for acquisition and research work. Separate from the CRM — accessible to staff without a CRM login.

#### Tools Pages

**Skip Trace (Bulk)**
- Upload CSV or XLSX file (parsed client-side via SheetJS/Papa Parse)
- Automatic column detection: street, city, state, ZIP, owner name — or detects combined address columns (e.g., `120 W 3RD ST, TULSA, OK 74103`)
- Batches of 10 records; passes owner name when available to save credits (1 vs 2 credits/lookup)
- Up to 7 PropertyAPI.co keys in round-robin rotation with automatic depletion detection
- Background job with real-time progress polling
- CSV export with `_status`, `_phones`, `_emails`, `_owner` columns appended

**Distressed Property Finder**
- ATTOM `property/detailmortgageowner` endpoint
- Search by ZIP code or city (auto-expands to all ZIPs in the city via Zippopotam.us)
- Filters: Absentee Owner, Free & Clear (no mortgage), Pre-Foreclosure, Foreclosure, Tax Delinquent, Vacant
- Server-side filtering for mortgage-based categories; label-tagging for others
- Returns: owner name, corporate indicator, mailing address, absentee status, mortgage amount/date/lender/type, LTV %, assessed value
- CSV export
- **Deep Skip Trace**: Enrich distressed results with owner phone and email in one additional job

**ARV Calculator**
- Full address input with smart auto-parse (paste `123 Main St, Phoenix, AZ 85001` and fields auto-fill)
- Step 1: PropertyAPI geocode + property details (beds/baths/sqft/year/AVM)
- Step 2: ATTOM subject sqft via `property/snapshot` (uses `universalsize` — heated living area — to match comp scale)
- Step 3: ATTOM `sale/snapshot` radius comp fetch
- Step 4: Property type filter — excludes MULTI, DUPLEX, TRIPLEX, QUADRUPLEX, COMMERCIAL, APARTMENT
- Step 5: Sqft ratio filter — excludes comps outside 0.57–1.75× subject sqft
- Step 6: Per-comp adjustments (sqft at market rate, baths, year-built, time appreciation at 3%/year)
- Step 7: ATTOM AVM secondary valuation — shows value, range, confidence %, and delta vs comp-based ARV
- Progressive lookback: tries 24 months → 48 months → 84 months until comps are found
- Market price-per-sqft: derived from median of actual comp data; falls back to AI estimate if insufficient

**Property Lookup**
- Single-property deep lookup: PropertyAPI data + ATTOM mortgage/owner + skip trace run in parallel
- Returns: AVM, assessed value, last sale, owner names, absentee status, mailing address, corporate flag, mortgage amount/lender/type/term/due date, equity estimate, LTV, phones, emails

**Lead Scraper** (Bulk Property Research)
- Upload a list of addresses
- Batch enrichment with PropertyAPI
- Progress tracking with per-record status

---

### Digor Website

Public-facing B2B marketing site for Digor LLC.

- Dark professional design with gold accent palette
- Sections: Hero, Services, Methodology, Case Studies, Team, About, Contact
- Framer Motion scroll-triggered animations
- Contact form connected to API
- Chatbot component
- Stripe checkout integration for service subscriptions
- Professional industry language (compliance-aware copy)

---

### API Server

Express 5 API server. All business logic lives here; the React apps are thin clients.

**Route Groups**

| Prefix | Description |
|---|---|
| `/api/crm/auth/` | Login, session, JWT issuance |
| `/api/crm/campaigns/` | Campaign CRUD (super admin) |
| `/api/crm/leads/` | Lead CRUD + all AI, valuation, comps, and comms routes |
| `/api/crm/tasks/` | Task CRUD |
| `/api/crm/users/` | User management |
| `/api/crm/links/` | Submission link management + public submit endpoint |
| `/api/crm/sequences/` | Email sequence + step CRUD |
| `/api/crm/buyers/` | Buyer database |
| `/api/crm/stats/` | Dashboard statistics |
| `/api/tools/` | Skip trace, distressed finder, ARV, property lookup |
| `/api/signalwire/` | Call and SMS webhook + retrieval |
| `/api/openphone/` | OpenPhone webhook + message retrieval |
| `/api/stripe/` | Checkout session creation + webhook |
| `/api/contact/` | Public contact form (SMTP delivery) |
| `/api/subscribe/` | Email subscription management |
| `/api/health/` | Health check |

---

## AI Integrations

All LLM calls go through the **Groq API** using **Meta Llama 3.1 70B Versatile**. Groq's inference speed (typically 200–400 tokens/second) makes the AI features feel interactive rather than batch-processed.

### AI Deal Scorer (`POST /api/crm/leads/:id/ai-deal-score`)

Inputs the full deal record: ARV, asking price, estimated repair cost, MAO, beds/baths/sqft/condition, seller motivation, occupancy, and how soon the seller needs to close.

Returns:
- `score` (1–10)
- `summary` — one paragraph narrative
- `strengths` — array of positive signals
- `risks` — array of risk factors
- `recommendation` — actionable next step

The model is explicitly prompted to apply the 70% Rule (MAO = ARV × 0.70 − repairs) as a baseline and penalize deals that don't meet it.

### AI Repair Estimator (`POST /api/crm/leads/:id/ai-repair-estimate`)

Takes a free-text property description from the agent's notes or a walkthrough description. Parses it into line-item repair categories (roof, HVAC, kitchen, baths, flooring, paint, electrical, plumbing, foundation) and returns itemized costs with a total. One-click applies the total to the deal's `erc` field.

### AI Seller Script (`POST /api/crm/leads/:id/ai-seller-script`)

Generates a personalized outbound call script using the seller's name, address, reason for selling, timeline, asking price, and property condition. Output is structured with:
- Opener
- Rapport building
- Discover pain (open-ended questions)
- Present solution
- Handle objections
- Close / next step

### AI Offer Letter (`POST /api/crm/leads/:id/ai-offer-letter`)

Generates a professional purchase offer letter in plain English with:
- Subject property details
- Offer price (MAO or custom)
- Closing timeline
- Contingencies
- Terms and conditions

Rendered as a printable HTML document the agent can hand to the seller or send by email.

### Market Price-Per-Sqft Estimation (ARV Calculator fallback)

When the ATTOM comp data doesn't include enough sqft readings to derive a median, the ARV calculator requests an AI estimate of the local price-per-sqft. The model is provided the city, state, and ZIP and returns a market-calibrated value used in comp adjustments.

---

## Third-Party APIs & Integrations

### ATTOM Data Solutions

Used across both the CRM and Tools:

| Endpoint | Usage |
|---|---|
| `property/snapshot` | Geocoding, subject property sqft (universalsize) |
| `sale/snapshot` | Recently sold comparable sales by lat/lon radius |
| `attomavm/detail` | Automated valuation model — value, range, confidence score |
| `property/detailmortgageowner` | Owner name, absentee status, mortgage data for distressed search |

Key rotation: supports `ATTOM_API_KEY` and `ATTOM_API_KEY_2` with automatic failover. 401/403 responses mark the key as depleted and rotate to the next.

### PropertyAPI.co

Used for skip trace, property enrichment, and AVM:

| Feature | Usage |
|---|---|
| `parcels/search-by-address` | Property details: beds/baths/sqft/year/AVM/last-sale/owner/coordinates |
| `skip-trace` (POST, batch) | Owner phones and emails; 1 credit with name, 2 without |

Up to 7 API keys in round-robin rotation (`PROPERTY_API_KEY_1` through `PROPERTY_API_KEY_7` plus legacy `PROPERTY_API_KEY`). Depletion detection from both HTTP 402 status and response body inspection.

### Rentcast

On-demand rental and sale AVM for CRM leads. Called from the Lead Detail panel and returns a valuation with range.

### SignalWire

VoIP and SMS platform. Webhooks log inbound/outbound calls and messages to the `crm_openphone_messages` (or dedicated SignalWire table) keyed by lead. Messages are displayed in a threaded panel inside the lead detail. Polling interval: configurable (recommended 30–60s to avoid request storms).

### OpenPhone

Alternative telephony provider. Same pattern as SignalWire: webhook ingestion + per-lead message display with a dedicated panel in Lead Detail.

### Stripe

Subscription checkout for Digor's service tiers. Checkout session creation and webhook handling for subscription lifecycle events.

### US Census Bureau API

Free public API used to resolve county names to ATTOM-compatible FIPS-based geoid strings (e.g., `CO24031` for Montgomery County, MD). Used in the distressed finder's county/state search modes. Results are in-memory cached per process lifetime.

### Zippopotam.us

Free ZIP code lookup by city and state. Used in the distressed finder to expand a "City, ST" input into all ZIP codes for that city before querying ATTOM.

---

## Database Schema

PostgreSQL via Drizzle ORM. All CRM tables are campaign-scoped.

| Table | Description |
|---|---|
| `crm_campaigns` | Client organizations — id, name, slug, active |
| `crm_users` | Team members — role, email, bcrypt password, campaign FK |
| `crm_leads` | Core deal record — all property, seller, financial, and status fields |
| `crm_notes` | Lead notes with @mention support |
| `crm_tasks` | Tasks linked to leads and users with due dates |
| `crm_submission_links` | Tokenized public intake URLs |
| `crm_comps` | Comparable sales per lead with adjustment fields |
| `crm_email_sequences` | Sequence definition with campaign scope |
| `crm_sequence_steps` | Per-step day offset + email subject/body template |
| `crm_sequence_logs` | Sent-email deduplication log |
| `crm_openphone_messages` | Inbound/outbound messages from SignalWire/OpenPhone |
| `contacts` | Website contact form submissions |
| `subscribers` | Email list subscribers |

---

## Key Engineering Decisions

### Why Groq instead of OpenAI

Groq's LPU hardware delivers token generation at 200–400 tokens/second versus OpenAI's 40–80 tokens/second on GPT-4. For interactive features like deal scoring and script generation that run inside a CRM workflow, latency matters. Llama 3.1 70B on Groq provides GPT-4-class reasoning at near-real-time speeds.

### ARV comp quality filters

ATTOM's `sale/snapshot` returns all property sales within the radius regardless of type. A quadruplex has 4× the living area of a single-family home — if included as a comp, it inflates the ARV by 30–60%. The property type filter and sqft ratio filter (0.57–1.75×) together ensure that only genuinely comparable properties influence the ARV calculation.

### ATTOM `universalsize` vs `livingsize`

ATTOM exposes two sqft fields: `universalsize` (heated living area, consistent across all property types) and `livingsize` (sometimes missing or unreliable for older records). The platform explicitly uses `universalsize` for both the subject property lookup and comp selection, ensuring the sqft adjustments are apples-to-apples.

### PropertyAPI key rotation

Single API keys for skip trace services deplete quickly on bulk jobs. The platform supports up to 7 keys with round-robin rotation and automatic depletion detection — both from HTTP 402 responses and from JSON error bodies that contain "Insufficient credits". This allows a single bulk job to seamlessly continue across multiple keys without manual intervention.

### Multi-tenancy via JWT campaign isolation

Rather than separate databases or schemas per client, campaign isolation is enforced at the query level: every route reads `campaignId` from the verified JWT and appends it as a WHERE clause. Super admins have a null `campaignId` and see all data. This makes the system operationally simple (one schema, one connection pool) while maintaining strict data separation.

### Email sequence background job

Rather than a separate worker process or queue system, the sequence sender runs as an in-process `setInterval` on the API server. This works because the job is idempotent (checked against `crm_sequence_logs`) and low-frequency (hourly). It avoids the operational overhead of Redis/BullMQ for a use case that doesn't require sub-minute precision.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | JWT signing secret |
| `CRM_ADMIN_EMAIL` | Yes | Super admin email (seeded on startup) |
| `CRM_ADMIN_PASSWORD` | Yes | Super admin password (bcrypt hashed) |
| `GROQ_API_KEY` | Yes (AI features) | Groq inference API key |
| `AI_MODEL` | No | Override default model (default: `llama-3.1-70b-versatile`) |
| `ATTOM_API_KEY` | Yes (comps/AVM) | Primary ATTOM Data API key |
| `ATTOM_API_KEY_2` | No | Secondary ATTOM key for rotation |
| `PROPERTY_API_KEY` | Yes (property/skip trace) | PropertyAPI.co key (legacy single-key) |
| `PROPERTY_API_KEY_1`–`_7` | No | Additional PropertyAPI keys for rotation |
| `RENTCAST_API_KEY` | No | Rentcast AVM key |
| `SIGNALWIRE_PROJECT_ID` | No | SignalWire project ID |
| `SIGNALWIRE_API_TOKEN` | No | SignalWire auth token |
| `SIGNALWIRE_SPACE_URL` | No | SignalWire space domain |
| `OPENPHONE_API_KEY` | No | OpenPhone API key |
| `STRIPE_SECRET_KEY` | No | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | No | Stripe webhook signing secret |
| `SMTP_HOST` | No | SMTP server for email sequences |
| `SMTP_PORT` | No | SMTP port |
| `SMTP_USER` | No | SMTP username |
| `SMTP_PASS` | No | SMTP password |
| `TOOLS_PIN` | Yes (tools portal) | PIN to access the tools portal |

---

## Production Notes

### Email Sequence Sender

The automated email sequence runs as an **in-process `setInterval`** on the API server
(fires every hour). This is intentional for simplicity — the job is idempotent (guarded by
`crm_sequence_logs`) and low-frequency, so it survives restarts safely.

**For production environments with strict uptime requirements**, replace the `setInterval`
with an external scheduler:

| Option | Notes |
|---|---|
| Railway cron job | Native — add a second Railway service with a `0 * * * *` schedule |
| GitHub Actions scheduled workflow | Free for public repos; reliable if repo is on GitHub |
| External cron container | Full control; runs independently of the API server |

The sequence sender code lives in `artifacts/api-server/src/services/emailService.ts`.

### JWT Secret Rotation

JWTs are signed with `JWT_SECRET`. Rotating this secret invalidates **all active sessions
immediately** — users will be logged out. Coordinate rotations during off-peak hours and
notify your team in advance.

### PropertyAPI Key Depletion State

Key depletion flags (which keys are out of credits) are held **in memory per process**.
A server restart resets these flags. For high-volume bulk operations, consider persisting
depletion state in the database or Redis so restarts don't retry exhausted keys.

### Database Migrations

This project uses **Drizzle Kit `push`** (schema push) rather than a migration file system.
This is appropriate for early-stage development. Before going to production with real customer
data, switch to `drizzle-kit generate` + `migrate` so schema changes are tracked and
reversible.

---

## Project Structure Details

```
artifacts/api-server/src/
├── routes/
│   ├── crm/
│   │   ├── leads.ts          # Core deal routes + all AI endpoints
│   │   ├── comps.ts          # Comparable sales CRUD + adjustment math
│   │   ├── sequences.ts      # Email sequence management
│   │   ├── auth.ts           # JWT login/session
│   │   └── ...               # campaigns, users, tasks, links, stats, buyers
│   ├── tools.ts              # Tools portal: skip trace, distressed, ARV, lookup
│   ├── signalwire.ts         # SignalWire webhook + message retrieval
│   ├── openphone.ts          # OpenPhone webhook + message retrieval
│   └── stripe.ts             # Stripe checkout + webhook
├── services/
│   ├── attomApi.ts           # ATTOM client with key rotation + fetchAttomAvm
│   ├── propertyApi.ts        # Adjustment math + AI price-per-sqft fallback
│   └── emailService.ts       # Nodemailer SMTP wrapper
└── lib/
    └── logger.ts             # Pino structured logging
```
