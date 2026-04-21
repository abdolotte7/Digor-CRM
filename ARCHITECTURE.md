# Architecture Reference — Digor CRM & Tools Platform

This document covers the internal design decisions, data contracts, and formulas
that are intentionally omitted from the top-level README to keep it readable.

---

## Table of Contents

- [Monorepo Layout](#monorepo-layout)
- [Request Lifecycle](#request-lifecycle)
- [Authentication & Multi-Tenancy](#authentication--multi-tenancy)
- [Comparable Sales & ARV Math](#comparable-sales--arv-math)
- [API Key Rotation](#api-key-rotation)
- [Email Sequence Background Job](#email-sequence-background-job)
- [Data Flow Diagrams](#data-flow-diagrams)

---

## Monorepo Layout

```
/
├── artifacts/
│   ├── api-server/         Express 5 API — all business logic and integrations
│   │   └── src/
│   │       ├── routes/     Route handlers (thin — delegates to services)
│   │       └── services/   attomApi.ts · propertyApi.ts · emailService.ts
│   ├── digor-crm/          React + Vite CRM portal  (base path: /crm/)
│   ├── digor-tools/        React + Vite internal tools portal (base path: /tools/)
│   └── digor-website/      React + Vite public site (base path: /)
├── lib/
│   ├── api-spec/           OpenAPI 3.1 spec + Orval codegen config
│   ├── api-client-react/   Generated TanStack Query hooks (do not edit manually)
│   ├── api-zod/            Generated Zod schemas  (do not edit manually)
│   └── db/                 Drizzle ORM schema + PostgreSQL client
└── scripts/                One-off scripts: seed, migrate, data repair
```

**Build outputs** (`artifacts/**/dist/`, `artifacts/**/.vite/`) are excluded from
git and generated at deploy time.

---

## Request Lifecycle

```
Browser (React app)
  │
  │  TanStack Query hook  →  generated API client  →  fetch(BASE_URL + path)
  ▼
Railway ingress (path-based routing)
  │
  ├─ /          →  digor-website static assets
  ├─ /crm/      →  digor-crm static assets
  ├─ /tools/    →  digor-tools static assets
  └─ /api/      →  api-server (Express 5, port $PORT)
                      │
                      ├─ JWT middleware (requireAuth)
                      ├─ Route handler
                      └─ Drizzle ORM  →  PostgreSQL
```

All three React apps are thin clients. Business logic, validation (Zod), and
all third-party API calls live exclusively in the api-server.

---

## Authentication & Multi-Tenancy

### JWT Payload

```ts
interface JwtPayload {
  userId:     number;
  email:      string;
  role:       'super_admin' | 'admin' | 'sales' | 'va';
  campaignId: number | null;   // null for super_admin only
  iat:        number;
  exp:        number;
}
```

Tokens are signed with **HS256** using `JWT_SECRET`. Default expiry: **7 days**.

### Campaign Isolation Rules

Every route that accesses CRM data applies one of the following patterns:

| Role | WHERE clause injected |
|---|---|
| `super_admin` | No campaign filter — sees all data |
| `admin` | `campaignId = jwt.campaignId` |
| `sales` | `campaignId = jwt.campaignId` |
| `va` | `campaignId = jwt.campaignId AND assignedUserId = jwt.userId` (leads only) |

Example (Drizzle):

```ts
const where = role === 'super_admin'
  ? undefined
  : eq(crmLeads.campaignId, campaignId!);

const leads = await db.select().from(crmLeads).where(where);
```

Super admins cannot be created through the API — the initial super admin is
seeded from `CRM_ADMIN_EMAIL` / `CRM_ADMIN_PASSWORD` on server startup.

---

## Comparable Sales & ARV Math

### Comp Fetch Strategy

The platform executes a 4-step expanding radius search against ATTOM
`sale/snapshot` until a sufficient number of comps is found:

| Attempt | Radius | Max comps returned |
|---|---|---|
| 1 | 0.10 mi | 8 |
| 2 | 0.25 mi | 8 |
| 3 | 0.50 mi | 8 |
| 4 | 1.00 mi | 8 |

**Lookback periods tried in order:** 24 months → 48 months → 84 months.

### Property Type Filter

The following ATTOM property type codes are excluded from comp selection:

```
MULTI, DUPLEX, TRIPLEX, QUADRUPLEX, COMMERCIAL, APARTMENT
```

Only single-family residential comps are used.

### Sqft Ratio Filter

A comp is discarded if its heated living area (`universalsize`) falls outside
the following ratio relative to the subject property:

```
0.57 × subject_sqft  ≤  comp_sqft  ≤  1.75 × subject_sqft
```

Rationale: a property ≥75% larger or ≥43% smaller than the subject is not
genuinely comparable and would skew the ARV.

### Per-Comp Adjustments

Each retained comp is adjusted to the subject property using these fixed rates:

| Attribute | Adjustment rate |
|---|---|
| Square footage delta | `(subject_sqft − comp_sqft) × price_per_sqft` |
| Bedroom delta | `(subject_beds − comp_beds) × $12,500` |
| Bathroom delta | `(subject_baths − comp_baths) × $7,500` |
| Year-built delta | `(subject_year − comp_year) × $150` |
| Time since sale | `comp_price × (months_since_sale / 12) × 0.03` (3%/yr appreciation) |

`price_per_sqft` is derived from the **median** of `salePrice / sqft` across
all retained comps. If fewer than 3 comps have valid sqft data, the ARV
calculator falls back to an AI-estimated market price-per-sqft (Groq,
city + state + ZIP context).

### ARV Calculation

```
adjusted_price[i] = comp_sale_price[i]
  + sqft_adjustment[i]
  + bed_adjustment[i]
  + bath_adjustment[i]
  + year_adjustment[i]
  + time_adjustment[i]

ARV = median(adjusted_price[0..n])
```

Median is used (not mean) to reduce sensitivity to outlier sales.

### Maximum Allowable Offer (MAO)

```
MAO = ARV × 0.70 − estimated_repair_cost
```

The 70% Rule is the standard wholesale acquisition threshold. Deals where
`ARV / asking_price < 1.7` trigger a "deal quality warning" in the UI.

### ATTOM AVM as Secondary Signal

The ATTOM AVM (`/propertyapi/v1.0.0/avm/detail
`) is fetched independently and displayed
alongside the comp-based ARV. It includes:
- Point estimate
- Low / high range
- Confidence score (0–100)
- Delta vs. comp-based ARV (shown as ± %)

The AVM does **not** override the comp-based ARV — it is informational only.

---

## API Key Rotation

### ATTOM (2 keys)

```
Keys: ATTOM_API_KEY, ATTOM_API_KEY_2
Rotation trigger: HTTP 401 or 403 response
Strategy: try primary → on failure mark depleted → retry with secondary
```

### PropertyAPI.co (up to 8 keys)

```
Keys: PROPERTY_API_KEY, PROPERTY_API_KEY_1 ... PROPERTY_API_KEY_7
Rotation trigger: HTTP 402 OR response body contains "Insufficient credits"
Strategy: round-robin across all configured keys; skip depleted keys
```

Key state is held **in-memory per process** — a server restart resets the
depletion flags. For high-volume environments, persist depletion state in the
database or Redis.

---

## Email Sequence Background Job

```
Frequency: every 1 hour (setInterval)
Entrypoint: artifacts/api-server/src/services/emailService.ts

Algorithm:
  FOR EACH active sequence step (day_offset, subject, body):
    target_send_date = lead.created_at + day_offset days
    IF today >= target_send_date:
      IF NOT EXISTS in crm_sequence_logs (leadId, stepId):
        render template ({{name}}, {{address}})
        send via SMTP (Nodemailer)
        INSERT into crm_sequence_logs
```

**Idempotency** is guaranteed by `crm_sequence_logs`. Even if the interval
fires multiple times or the server restarts mid-job, each step is sent exactly
once per lead.

**Production recommendation:** Replace `setInterval` with an external scheduler
(Railway cron, GitHub Actions scheduled workflow, or a cron container) to
guarantee execution independent of API server uptime and restarts.

---

## Data Flow Diagrams

### Lead Underwriting Flow

```
Agent opens lead detail
  │
  ├─ [Fetch Property Data]
  │     PropertyAPI.co  →  beds/baths/sqft/year/AVM/owner/coordinates
  │     └─ Auto-fills lead fields
  │
  ├─ [Fetch Comps + ARV]
  │     ATTOM sale/snapshot (radius search)
  │     └─ Type filter → Sqft ratio filter → Per-comp adjustments → Median ARV
  │     ATTOM AVM (parallel)
  │     └─ Secondary valuation signal
  │
  ├─ [AI Deal Score]
  │     Groq Llama 3.1 70B
  │     Input: ARV, asking, repairs, MAO, condition, motivation, timeline
  │     Output: score 1–10, summary, strengths, risks, recommendation
  │
  ├─ [AI Repair Estimate]
  │     Input: free-text walkthrough notes
  │     Output: line-item cost breakdown + total → applied to lead.erc
  │
  ├─ [AI Seller Script]
  │     Input: seller name, motivation, timeline, condition
  │     Output: structured call script (opener → discover → close)
  │
  └─ [AI Offer Letter]
        Input: lead financials, offer price, terms
        Output: printable HTML offer document
```

### Distressed List Building Flow

```
Acquisition agent enters: ZIP / City+State + filters
  │
  ├─ City input → Zippopotam.us → expand to all ZIPs in city
  │
  ├─ Per-ZIP: ATTOM /property/detailmortgageowner
  │     Returns: owner, absentee flag, corporate flag, mailing address,
  │              mortgage amount/date/lender/type/term, assessed value
  │
  ├─ Server-side filter: Free & Clear, Absentee, Pre-Foreclosure, etc.
  │
  ├─ Export: CSV download
  │
  └─ [Deep Skip Trace — optional]
        PropertyAPI.co batch skip trace (round-robin key rotation)
        Appends: phones, emails per owner record
        Export: enriched CSV
```
