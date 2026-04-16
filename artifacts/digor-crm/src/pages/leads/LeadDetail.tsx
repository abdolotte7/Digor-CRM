import { useState, useEffect, useRef } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { format, differenceInDays } from "date-fns";
import {
  ArrowLeft, Trash2, Home, User, DollarSign, Calculator,
  MessageSquare, CheckSquare, Plus, Clock, AlertCircle, FileText,
  BarChart2, Mail, Bell, BellOff, UserCheck, Activity, Archive,
  RefreshCw, Zap, TrendingUp, TrendingDown, Database, Search,
  Phone, Send, PhoneCall, PhoneIncoming, ChevronDown, Copy, Check,
  Loader2, X, Wrench, Sparkles,
} from "lucide-react";
import {
  useCrmGetLead,
  useCrmUpdateLead,
  useCrmDeleteLead,
  useCrmAddLeadNote,
  useCrmCreateTask,
  useCrmGetMe,
  useCrmFetchPropertyData,
  useCrmSkipTrace,
  useCrmGetComps,
  useCrmCreateComp,
  useCrmDeleteComp,
  useCrmRecalculateComps,
} from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

// ─── Constants ────────────────────────────────────────────────────────────────
const STATUSES = ['new', 'contacted', 'qualified', 'negotiating', 'under_contract', 'closed'];

const PROPERTY_TYPES = ["Single Family", "Multi Family", "Condo", "Townhouse", "Mobile Home", "Commercial", "Land", "Other"];
const OCCUPANCY_OPTIONS = ["Owner Occupied", "Tenant Occupied", "Rented", "Vacant", "Unknown"];
const LEAD_SOURCES = ["Phone Outreach", "Direct Mail", "Text Blast", "Driving for Dollars", "Online Ads", "Referral", "Wholesale", "MLS", "Submission Form", "Other"];
const REASON_OPTIONS = ["Divorce", "Probate", "Job Loss", "Relocation", "Downsizing", "Inherited", "Behind on Payments", "Major Repairs Needed", "Tired Landlord", "Other"];
const HOW_SOON_OPTIONS = ["ASAP", "Within 30 Days", "1-3 Months", "3-6 Months", "6+ Months", "Just Exploring"];

// ─── Address auto-parser ──────────────────────────────────────────────────────
function parseFullAddress(raw: string): { address?: string; city?: string; state?: string; zip?: string } | null {
  const s = raw.trim();
  // Format 1: "Street, City, ST ZIP"  (two commas)
  let m = s.match(/^(.+?),\s*(.+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (m) return { address: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), zip: m[4].trim() };
  // Format 2: "Street City, ST ZIP"  (city runs into street, one comma before state)
  m = s.match(/^(.*\b(?:St|Ave|Blvd|Dr|Rd|Ct|Ln|Way|Pl|Ter|Cir|Hwy|Pkwy|Sq|Loop|Trl|Pass)\.?)\s+(.+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
  if (m) return { address: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), zip: m[4].trim() };
  // Format 3: "Street, ST ZIP"  (no city field)
  m = s.match(/^(.+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (m) return { address: m[1].trim(), city: undefined, state: m[2].toUpperCase(), zip: m[3].trim() };
  return null;
}

// ─── apiFetch helper ─────────────────────────────────────────────────────────
function apiFetch(path: string, options?: RequestInit) {
  const token = localStorage.getItem("crm_token");
  return fetch(`/api/crm${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers || {}),
    },
  }).then(r => r.json());
}

function fmt$(v: any) {
  if (!v && v !== 0) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(v));
}

// ─── Property Map ─────────────────────────────────────────────────────────────
function PropertyMap({ address, city, state, zip }: { address?: string; city?: string; state?: string; zip?: string }) {
  const parts = [address, city, state, zip].filter(Boolean);
  if (parts.length === 0) return null;
  const query = encodeURIComponent(parts.join(", "));
  const src = `https://maps.google.com/maps?q=${query}&output=embed&z=15`;
  return (
    <div className="md:col-span-3 mt-1 rounded-xl overflow-hidden border border-border">
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${query}`}
        target="_blank"
        rel="noopener noreferrer"
        className="block text-xs text-muted-foreground bg-secondary/30 px-3 py-1.5 hover:bg-secondary transition-colors flex items-center gap-1.5"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>
        </svg>
        {parts.join(", ")}
        <span className="ml-auto opacity-50">Open in Maps ↗</span>
      </a>
      <iframe
        title="Property Location"
        src={src}
        width="100%"
        height="220"
        style={{ border: 0, display: "block" }}
        allowFullScreen={false}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  );
}

// ─── Select helper ────────────────────────────────────────────────────────────
function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <select
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        className="w-full h-10 rounded-xl border border-border bg-background/50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        <option value="">— Select —</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

// ─── @Mention Textarea ────────────────────────────────────────────────────────
function MentionTextarea({
  value, onChange, users, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  users: any[];
  placeholder?: string;
}) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [query, setQuery] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    onChange(val);

    const cursor = e.target.selectionStart;
    const textUpToCursor = val.slice(0, cursor);
    const atMatch = textUpToCursor.match(/@(\w*)$/);
    if (atMatch) {
      setQuery(atMatch[1].toLowerCase());
      setShowDropdown(true);
    } else {
      setShowDropdown(false);
    }
  };

  const insertMention = (username: string) => {
    if (!textareaRef.current) return;
    const cursor = textareaRef.current.selectionStart;
    const textUpToCursor = value.slice(0, cursor);
    const atIdx = textUpToCursor.lastIndexOf("@");
    const newVal = value.slice(0, atIdx) + `@${username} ` + value.slice(cursor);
    onChange(newVal);
    setShowDropdown(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const filtered = users.filter(u =>
    u.username?.toLowerCase().includes(query) || u.name?.toLowerCase().includes(query)
  ).slice(0, 6);

  return (
    <div className="relative">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        placeholder={placeholder || "Add a note... (use @username to mention someone)"}
        className="bg-background/80 rounded-xl resize-none min-h-[80px] text-sm"
      />
      {showDropdown && filtered.length > 0 && (
        <div className="absolute bottom-full left-0 mb-1 w-56 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden">
          {filtered.map(u => (
            <button
              key={u.id}
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-secondary text-sm flex items-center gap-2"
              onClick={() => insertMention(u.username || u.name)}
            >
              <div className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center font-bold flex-shrink-0">
                {(u.name || u.username || "?").charAt(0).toUpperCase()}
              </div>
              <span className="font-medium">{u.name}</span>
              <span className="text-muted-foreground text-xs">@{u.username}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Offer Letter ─────────────────────────────────────────────────────────────
function openOfferLetter(lead: any, mao: number, campaign?: any) {
  const companyName = campaign?.name || "Digor LLC";
  const formattedMao = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(mao);
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Purchase Offer - ${lead.address}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Georgia', serif; color: #1a1a1a; background: white; padding: 60px; max-width: 800px; margin: 0 auto; line-height: 1.7; }

    /* ── Edit toolbar (hidden on print) ── */
    #toolbar {
      position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
      background: #1a1a1a; color: white; padding: 10px 20px;
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      font-family: system-ui, sans-serif; font-size: 14px;
    }
    #toolbar .hint { opacity: 0.65; font-size: 12px; }
    #toolbar button {
      background: white; color: #1a1a1a; border: none; border-radius: 6px;
      padding: 7px 20px; font-size: 14px; font-weight: 700; cursor: pointer;
    }
    #toolbar button:hover { background: #e8e8e8; }
    body { padding-top: 100px; }

    /* ── Editable highlight ── */
    [contenteditable]:hover { outline: 2px dashed #aaa; border-radius: 2px; cursor: text; }
    [contenteditable]:focus { outline: 2px solid #1a1a1a; border-radius: 2px; }

    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1a1a1a; padding-bottom: 24px; margin-bottom: 32px; }
    .company-name { font-size: 28px; font-weight: bold; letter-spacing: -0.5px; }
    .company-sub { font-size: 13px; color: #555; margin-top: 4px; }
    .date-right { text-align: right; font-size: 14px; color: #555; }
    h1 { font-size: 22px; text-align: center; margin-bottom: 28px; text-transform: uppercase; letter-spacing: 2px; }
    .section { margin-bottom: 24px; }
    .section-title { font-size: 12px; text-transform: uppercase; letter-spacing: 1.5px; color: #888; border-bottom: 1px solid #eee; padding-bottom: 6px; margin-bottom: 14px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 40px; }
    .field label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
    .field p { font-size: 15px; font-weight: 600; }
    .offer-box { background: #f8f8f8; border: 2px solid #1a1a1a; border-radius: 4px; padding: 24px; text-align: center; margin: 28px 0; }
    .offer-label { font-size: 13px; text-transform: uppercase; letter-spacing: 2px; color: #666; }
    .offer-amount { font-size: 48px; font-weight: bold; color: #1a1a1a; margin: 8px 0; }
    .offer-note { font-size: 12px; color: #888; }
    .terms { background: #fafafa; padding: 20px; border-left: 4px solid #1a1a1a; margin: 24px 0; font-size: 14px; }
    .terms ul { padding-left: 20px; }
    .terms li { margin-bottom: 8px; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 60px; margin-top: 60px; }
    .sig-line { border-top: 1px solid #1a1a1a; padding-top: 8px; font-size: 13px; margin-top: 50px; }
    .sig-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }
    @media print { #toolbar { display: none !important; } body { padding-top: 60px !important; } [contenteditable] { outline: none !important; } }
  </style>
</head>
<body>
  <div id="toolbar">
    <div>
      <div style="font-weight:700;font-size:15px;">Preview &amp; Edit Offer Letter</div>
      <div class="hint">Click any text to edit before printing</div>
    </div>
    <button onclick="window.print()">🖨 Print</button>
  </div>

  <div class="header">
    <div>
      <div class="company-name" contenteditable="true">${companyName}</div>
      <div class="company-sub" contenteditable="true">${campaign?.address || ""}</div>
      <div class="company-sub" contenteditable="true">${campaign?.email || ""}</div>
    </div>
    <div class="date-right">
      <strong>Date:</strong> <span contenteditable="true">${today}</span><br>
      <strong>Ref:</strong> OL-${lead.id}-${Date.now().toString(36).toUpperCase()}
    </div>
  </div>
  <h1 contenteditable="true">Letter of Intent to Purchase</h1>
  <div class="section">
    <div class="section-title">Property Information</div>
    <div class="grid">
      <div class="field"><label>Property Address</label><p contenteditable="true">${lead.address || "—"}</p></div>
      <div class="field"><label>City, State, ZIP</label><p contenteditable="true">${[lead.city, lead.state, lead.zip].filter(Boolean).join(", ") || "—"}</p></div>
      <div class="field"><label>Property Type</label><p contenteditable="true">${lead.propertyType || "Residential"}</p></div>
      <div class="field"><label>Beds / Baths / Sq Ft</label><p contenteditable="true">${lead.beds || "—"} bd / ${lead.baths || "—"} ba / ${lead.sqft ? lead.sqft.toLocaleString() : "—"} sqft</p></div>
      <div class="field"><label>Year Built</label><p contenteditable="true">${lead.yearBuilt || "—"}</p></div>
      <div class="field"><label>Owner Name</label><p contenteditable="true">${lead.ownerName || "—"}</p></div>
      <div class="field"><label>Last Sale Date</label><p contenteditable="true">${lead.lastSaleDate || "—"}</p></div>
      <div class="field"><label>Last Sale Price</label><p contenteditable="true">${lead.lastSalePrice ? "$" + Number(lead.lastSalePrice).toLocaleString() : "—"}</p></div>
    </div>
  </div>
  <div class="section">
    <div class="section-title">Seller Information</div>
    <div class="grid">
      <div class="field"><label>Seller Name</label><p contenteditable="true">${lead.sellerName}</p></div>
      <div class="field"><label>Phone</label><p contenteditable="true">${lead.phone || "—"}</p></div>
      <div class="field"><label>Email</label><p contenteditable="true">${lead.email || "—"}</p></div>
      <div class="field"><label>Lead Source</label><p contenteditable="true">${lead.leadSource || "—"}</p></div>
    </div>
  </div>
  <div class="offer-box">
    <div class="offer-label">All-Cash Purchase Offer</div>
    <div class="offer-amount" contenteditable="true">${formattedMao}</div>
    <div class="offer-note" contenteditable="true">Subject to inspection and due diligence · As-is condition</div>
  </div>
  <div class="section">
    <div class="section-title">Financial Summary</div>
    <div class="grid">
      <div class="field"><label>After Repair Value (ARV)</label><p contenteditable="true">${fmt$(lead.arv)}</p></div>
      <div class="field"><label>Est. Repair Cost (ERC)</label><p contenteditable="true">${fmt$(lead.estimatedRepairCost)}</p></div>
      <div class="field"><label>Seller's Asking Price</label><p contenteditable="true">${fmt$(lead.askingPrice)}</p></div>
      <div class="field"><label>Market Estimate</label><p contenteditable="true">${fmt$(lead.currentValue)}</p></div>
    </div>
  </div>
  <div class="terms" contenteditable="true">
    <div class="section-title">Terms &amp; Conditions</div>
    <ul>
      <li>This is a Letter of Intent only and is not legally binding until a formal Purchase &amp; Sale Agreement is executed by both parties.</li>
      <li>Buyer: ${companyName}, or its assigns.</li>
      <li>Closing: within 14–21 business days of accepted offer, subject to title search.</li>
      <li>Earnest Money: to be determined upon execution of Purchase &amp; Sale Agreement.</li>
      <li>Property to be purchased in <strong>as-is</strong> condition with no repairs required by Seller.</li>
      <li>Buyer reserves the right to assign this contract.</li>
      <li>This offer is valid for 5 business days from the date above.</li>
    </ul>
  </div>
  <div class="signatures">
    <div>
      <div class="sig-line">_________________________________</div>
      <div class="sig-label" contenteditable="true">Authorized Buyer – ${companyName}</div>
      <div class="sig-line" style="margin-top: 16px;">Date: ___________________</div>
    </div>
    <div>
      <div class="sig-line">_________________________________</div>
      <div class="sig-label" contenteditable="true">Seller – ${lead.sellerName}</div>
      <div class="sig-line" style="margin-top: 16px;">Date: ___________________</div>
    </div>
  </div>
</body>
</html>`;
  const win = window.open("", "_blank");
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}

// ─── Zillow Card ──────────────────────────────────────────────────────────────
function ZillowCard({ address, city, state, zip }: { address?: string; city?: string; state?: string; zip?: string }) {
  const parts = [address, city, state, zip].filter(Boolean);
  if (parts.length === 0) return null;

  const slug = parts.join(" ")
    .replace(/,/g, "")
    .replace(/\s+/g, "-");
  const searchQuery = encodeURIComponent(parts.join(", "));
  const zillowUrl = `https://www.zillow.com/homes/${slug}_rb/`;
  const realtorUrl = `https://www.realtor.com/realestateandhomes-search/${encodeURIComponent(parts.join(" "))}`;

  return (
    <Card className="rounded-2xl overflow-hidden border-white/5 bg-card shadow-lg">
      <div className="bg-gradient-to-r from-[#006AFF]/10 to-transparent p-4 border-b border-border flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-[#006AFF] flex items-center justify-center flex-shrink-0 shadow-lg shadow-[#006AFF]/30">
          <svg viewBox="0 0 40 40" fill="white" xmlns="http://www.w3.org/2000/svg" className="w-5 h-5">
            <path d="M20 3L1 16.5h6V37h26V16.5h6L20 3zm0 4.5l14 10.5v15.5h-6V24h-16v9.5H6V18L20 7.5z"/>
          </svg>
        </div>
        <div>
          <h2 className="font-display font-semibold">Zillow Property Lookup</h2>
          <p className="text-xs text-muted-foreground">View listing, Zestimate, and public records</p>
        </div>
      </div>
      <div className="p-5">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-muted-foreground mb-1">Property Address</p>
            <p className="font-semibold text-foreground truncate">{parts.join(", ")}</p>
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
              Click "View on Zillow" to see the Zestimate, tax history, price history, and comparable listings directly on Zillow's platform.
            </p>
          </div>
          <div className="flex flex-col gap-2 flex-shrink-0">
            <a
              href={zillowUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#006AFF] text-white text-sm font-semibold hover:bg-[#0057d4] transition-colors shadow-md shadow-[#006AFF]/20"
            >
              <svg viewBox="0 0 40 40" fill="white" xmlns="http://www.w3.org/2000/svg" className="w-4 h-4">
                <path d="M20 3L1 16.5h6V37h26V16.5h6L20 3zm0 4.5l14 10.5v15.5h-6V24h-16v9.5H6V18L20 7.5z"/>
              </svg>
              View on Zillow
            </a>
            <a
              href={realtorUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
              View on Realtor.com
            </a>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { label: "Zestimate", hint: "AI valuation" },
            { label: "Tax History", hint: "Annual records" },
            { label: "Price History", hint: "Sales & listings" },
            { label: "Comps", hint: "Nearby sold homes" },
          ].map(({ label, hint }) => (
            <a
              key={label}
              href={zillowUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center p-3 bg-secondary/30 rounded-xl border border-border hover:bg-secondary hover:border-[#006AFF]/30 transition-all group text-center"
            >
              <span className="text-xs font-semibold text-foreground group-hover:text-[#006AFF] transition-colors">{label}</span>
              <span className="text-xs text-muted-foreground mt-0.5">{hint}</span>
            </a>
          ))}
        </div>

        <p className="text-xs text-muted-foreground/50 mt-3 text-center">
          Zillow data is provided externally and not controlled by Digor CRM
        </p>
      </div>
    </Card>
  );
}

// ─── Comps Section ────────────────────────────────────────────────────────────
function CompsSection({ leadId, lead }: { leadId: number; lead: any }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ address: "", beds: "", baths: "", sqft: "", yearBuilt: "", salePrice: "", soldDate: "", notes: "" });
  const [radiusMiles, setRadiusMiles] = useState("0.25");
  const [fetchingComps, setFetchingComps] = useState(false);
  const [compsPolling, setCompsPolling] = useState<{ jobToken: string; count: number; actualRadius: number } | null>(null);
  const [expandedBreakdown, setExpandedBreakdown] = useState<number | null>(null);

  const { data: comps = [], isLoading: compsLoading } = useCrmGetComps(leadId);
  const compsKey = [`/api/crm/leads/${leadId}/comps`];
  const leadKey = [`/api/crm/leads/${leadId}`];

  // Derive the market $/sqft rate used in adjustments — median of (salePrice/sqft) across all comps
  const marketSqftRate = (() => {
    const rates = (comps as any[])
      .filter((c: any) => c.salePrice > 0 && c.sqft > 0)
      .map((c: any) => c.salePrice / c.sqft)
      .sort((a: number, b: number) => a - b);
    return rates.length > 0 ? rates[Math.floor(rates.length / 2)] : 50;
  })();

  function calcBreakdown(comp: any) {
    const subjectBeds  = lead?.beds != null ? Number(lead.beds) : null;
    const subjectBaths = lead?.baths != null ? parseFloat(lead.baths) : null;
    const subjectSqft  = lead?.sqft != null ? Number(lead.sqft) : null;
    const subjectYear  = lead?.yearBuilt != null ? Number(lead.yearBuilt) : null;
    const compBeds     = comp.beds != null ? Number(comp.beds) : null;
    const compBaths    = comp.baths != null ? parseFloat(comp.baths) : null;
    const compSqft     = comp.sqft != null ? Number(comp.sqft) : null;
    const compYear     = comp.yearBuilt != null ? Number(comp.yearBuilt) : null;
    const salePrice    = comp.salePrice ?? 0;

    const bedAdj  = subjectBeds  != null && compBeds  != null ? (subjectBeds  - compBeds)  * 12500 : 0;
    const bathAdj = subjectBaths != null && compBaths != null ? (subjectBaths - compBaths) * 7500  : 0;
    const sqftAdj = subjectSqft  != null && compSqft  != null ? Math.round((subjectSqft - compSqft) * marketSqftRate) : 0;
    const yearAdj = subjectYear  != null && compYear  != null ? (subjectYear  - compYear)  * 150   : 0;
    let   timeAdj = 0;
    if (comp.soldDate) {
      const soldMs = new Date(comp.soldDate).getTime();
      if (!isNaN(soldMs)) {
        const monthsAgo = (Date.now() - soldMs) / (1000 * 60 * 60 * 24 * 30.5);
        timeAdj = Math.round(salePrice * 0.03 * (monthsAgo / 12));
      }
    }
    return { bedAdj, bathAdj, sqftAdj, yearAdj, timeAdj, marketSqftRate,
             subjectBeds, subjectBaths, subjectSqft, subjectYear,
             compBeds, compBaths, compSqft, compYear };
  }

  const lookupCompMutation = useMutation({
    mutationFn: async (address: string) => {
      const resp = await fetch(`/api/crm/leads/${leadId}/comp-address-lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ address }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "Lookup failed");
      return data;
    },
    onSuccess: (data) => {
      setForm(f => ({
        ...f,
        beds:      data.beds       != null ? String(data.beds)       : f.beds,
        baths:     data.baths      != null ? String(data.baths)      : f.baths,
        sqft:      data.sqft       != null ? String(data.sqft)       : f.sqft,
        yearBuilt: data.yearBuilt  != null ? String(data.yearBuilt)  : f.yearBuilt,
        salePrice: data.lastSalePrice != null ? String(data.lastSalePrice) : f.salePrice,
        soldDate:  data.lastSaleDate  || f.soldDate,
      }));
      toast({ title: "Property data filled from PropertyAPI" });
    },
    onError: (err: any) => {
      toast({ title: "Lookup failed", description: err.message, variant: "destructive" });
    },
  });

  function applyFetchCompsResult(data: any) {
    qc.invalidateQueries({ queryKey: compsKey });
    qc.invalidateQueries({ queryKey: leadKey });
    if (data.added === 0) {
      toast({ title: data.message ?? "No recent sales found in that radius" });
    } else if (data.aiGenerated) {
      toast({
        title: `${data.added} AI-estimated comp${data.added !== 1 ? "s" : ""} added`,
        description: (data.arv ? `ARV estimated at ${fmt$(data.arv)}. ` : "") +
          "PropertyAPI credits exhausted — comps are AI-estimated and labeled. Verify before making offers.",
        variant: "default",
      });
    } else {
      toast({
        title: `${data.added} comp${data.added !== 1 ? "s" : ""} added from PropertyAPI`,
        description: data.arv ? `ARV updated to ${fmt$(data.arv)}` : undefined,
      });
    }
  }

  async function handleFetchComps() {
    if (fetchingComps || compsPolling) return;
    setFetchingComps(true);
    try {
      const resp = await fetch(`/api/crm/leads/${leadId}/fetch-comps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ radiusMiles: parseFloat(radiusMiles) }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "Failed to start fetch");
      if (data.status === "pending") {
        setCompsPolling({ jobToken: data.jobToken, count: data.count, actualRadius: data.actualRadius });
      } else {
        applyFetchCompsResult(data);
      }
    } catch (err: any) {
      toast({ title: "Fetch comps failed", description: err.message, variant: "destructive" });
    } finally {
      setFetchingComps(false);
    }
  }

  useEffect(() => {
    if (!compsPolling) return;
    const interval = setInterval(async () => {
      try {
        const resp = await fetch(
          `/api/crm/leads/${leadId}/fetch-comps/poll?token=${encodeURIComponent(compsPolling.jobToken)}`,
          { credentials: "include" },
        );
        const data = await resp.json();
        if (!resp.ok) {
          setCompsPolling(null);
          toast({ title: "Fetch comps failed", description: data.error ?? "Export failed", variant: "destructive" });
          return;
        }
        if (data.status === "done") {
          setCompsPolling(null);
          applyFetchCompsResult(data);
        }
      } catch {
        // network blip — keep polling
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [compsPolling?.jobToken]);

  const createMutation = useCrmCreateComp({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: compsKey });
        qc.invalidateQueries({ queryKey: leadKey });
        setForm({ address: "", beds: "", baths: "", sqft: "", yearBuilt: "", salePrice: "", soldDate: "", notes: "" });
        setShowForm(false);
        toast({ title: "Comp added — ARV updated" });
      },
      onError: () => toast({ title: "Failed to add comp", variant: "destructive" }),
    },
  });
  const deleteMutation = useCrmDeleteComp({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: compsKey });
        qc.invalidateQueries({ queryKey: leadKey });
        toast({ title: "Comp removed — ARV updated" });
      },
    },
  });
  const recalcMutation = useCrmRecalculateComps({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: compsKey });
        qc.invalidateQueries({ queryKey: leadKey });
        toast({ title: "ARV recalculated from comps" });
      },
    },
  });

  // Summary stats from adjusted prices
  const compsWithAdj = (comps as any[]).filter((c: any) => c.adjustedPrice != null && c.adjustedPrice > 0);
  const avgAdjusted = compsWithAdj.length > 0
    ? Math.round(compsWithAdj.reduce((s: number, c: any) => s + c.adjustedPrice, 0) / compsWithAdj.length)
    : null;

  // Deal quality flag: ARV / asking price
  const arv = lead?.arv ? parseFloat(lead.arv) : null;
  const askingPrice = lead?.askingPrice ? parseFloat(lead.askingPrice) : null;
  const dealRatio = arv && askingPrice ? arv / askingPrice : null;
  const dealFlag = dealRatio != null
    ? (dealRatio >= 1.7 ? "good" : dealRatio >= 1.3 ? "warning" : "bad")
    : null;

  return (
    <Card className="rounded-2xl border-white/5 bg-card shadow-lg overflow-hidden">
      {/* Header */}
      <div className="bg-secondary/30 p-4 border-b border-border flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-5 h-5 text-primary" />
          <h2 className="font-display font-semibold">Comparable Sales</h2>
          <Badge variant="secondary" className="text-xs">{(comps as any[]).length} comps</Badge>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {(comps as any[]).length > 0 && (
            <Button
              size="sm" variant="outline"
              className="h-7 text-xs gap-1"
              disabled={recalcMutation.isPending}
              onClick={() => recalcMutation.mutate({ leadId })}
            >
              <RefreshCw className={`w-3 h-3 ${recalcMutation.isPending ? "animate-spin" : ""}`} />
              Recalculate
            </Button>
          )}
          {/* Auto-fetch comps from PropertyAPI radius search */}
          <div className="flex items-center gap-1">
            <select
              value={radiusMiles}
              onChange={e => setRadiusMiles(e.target.value)}
              disabled={fetchingComps || !!compsPolling}
              className="h-7 text-xs rounded border border-border bg-background px-1.5 cursor-pointer"
              title="Search radius in miles"
            >
              <option value="0.25">0.25 mi</option>
              <option value="0.5">0.5 mi</option>
              <option value="1">1 mi</option>
              <option value="2">2 mi</option>
            </select>
            <Button
              size="sm" variant="outline"
              className="h-7 text-xs gap-1 border-primary/40 text-primary hover:bg-primary/10"
              disabled={fetchingComps || !!compsPolling}
              onClick={handleFetchComps}
              title="Auto-fetch recently-sold comparable properties from PropertyAPI within the selected radius"
            >
              {(fetchingComps || compsPolling)
                ? <><RefreshCw className="w-3 h-3 animate-spin" /> {fetchingComps ? "Starting…" : "Processing…"}</>
                : <><Database className="w-3 h-3" /> Fetch Comps</>
              }
            </Button>
          </div>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowForm(s => !s)}>
            <Plus className="w-3.5 h-3.5" /> Add Comp
          </Button>
        </div>
      </div>

      {/* Fetch comps progress notice */}
      {(fetchingComps || compsPolling) && (
        <div className="mx-4 mt-3 p-2.5 bg-primary/5 border border-primary/20 rounded-lg text-xs text-muted-foreground flex items-center gap-2">
          <RefreshCw className="w-3 h-3 animate-spin text-primary shrink-0" />
          {fetchingComps
            ? <span>Starting PropertyAPI search within {radiusMiles} mi…</span>
            : <span>
                Processing {compsPolling!.count} properties within {compsPolling!.actualRadius} mi
                {compsPolling!.actualRadius < parseFloat(radiusMiles) ? ` (auto-shrunk from ${radiusMiles} mi)` : ""} — PropertyAPI export in progress, checking every 2 seconds…
              </span>
          }
        </div>
      )}

      {/* ARV summary banner */}
      {(avgAdjusted || arv) && (
        <div className="mx-4 mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {avgAdjusted && (
            <div className="p-3 bg-primary/5 border border-primary/20 rounded-xl">
              <p className="text-xs text-muted-foreground mb-0.5">Avg Adjusted Comp Value</p>
              <p className="text-lg font-bold text-primary">{fmt$(avgAdjusted)}</p>
              <p className="text-xs text-muted-foreground">{compsWithAdj.length} comp{compsWithAdj.length !== 1 ? "s" : ""} with adjustments</p>
            </div>
          )}
          {arv && (
            <div className={`p-3 rounded-xl border ${
              dealFlag === "good"    ? "bg-green-500/10 border-green-500/30" :
              dealFlag === "warning" ? "bg-yellow-500/10 border-yellow-500/30" :
              dealFlag === "bad"     ? "bg-red-500/10 border-red-500/30" :
              "bg-primary/5 border-primary/20"
            }`}>
              <p className="text-xs text-muted-foreground mb-0.5">Auto-Calculated ARV</p>
              <p className={`text-lg font-bold ${
                dealFlag === "good" ? "text-green-400" :
                dealFlag === "warning" ? "text-yellow-400" :
                dealFlag === "bad" ? "text-red-400" : "text-primary"
              }`}>{fmt$(arv)}</p>
              {dealRatio != null && (
                <div className="flex items-center gap-1 mt-0.5">
                  {dealFlag === "good" ? <TrendingUp className="w-3 h-3 text-green-400" /> :
                   dealFlag === "bad"  ? <TrendingDown className="w-3 h-3 text-red-400" /> :
                   <AlertCircle className="w-3 h-3 text-yellow-400" />}
                  <span className={`text-xs font-medium ${
                    dealFlag === "good" ? "text-green-400" :
                    dealFlag === "bad"  ? "text-red-400" : "text-yellow-400"
                  }`}>
                    ARV/Asking = {dealRatio.toFixed(2)}x
                    {dealFlag === "good" ? " — Strong deal" :
                     dealFlag === "warning" ? " — Borderline" : " — Below 1.7x threshold"}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Adjustment factor legend */}
      {(comps as any[]).length > 0 && (
        <div className="mx-4 mt-3 px-3 py-2 bg-blue-500/5 border border-blue-500/10 rounded-xl text-xs text-muted-foreground">
          <span className="font-medium text-blue-400">Adjustment factors: </span>
          ±$12,500/bed · ±$7,500/bath · ±market $/sqft · ±$150/year built · +3%/yr time adj (sold date)
        </div>
      )}

      {/* Add Comp Form */}
      {showForm && (
        <div className="p-4 border-b border-border bg-secondary/20 space-y-3 mt-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="col-span-2 md:col-span-3">
              <Label className="text-xs">Address *</Label>
              <div className="flex gap-1.5 mt-1">
                <Input
                  className="h-8 text-sm flex-1"
                  value={form.address}
                  onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  placeholder="123 Main St, City, ST 12345"
                />
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  className="h-8 text-xs px-2 gap-1 border-primary/40 text-primary hover:bg-primary/10 shrink-0"
                  disabled={!form.address || form.address.length < 5 || lookupCompMutation.isPending}
                  onClick={() => lookupCompMutation.mutate(form.address)}
                  title="Auto-fill beds, baths, sqft, year, sale price and date from PropertyAPI (1 credit)"
                >
                  {lookupCompMutation.isPending
                    ? <><RefreshCw className="w-3 h-3 animate-spin" /> Looking up…</>
                    : <><Database className="w-3 h-3" /> Auto-Fill</>
                  }
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">Enter address then click Auto-Fill to pull sale data from PropertyAPI (1 credit)</p>
            </div>
            <div>
              <Label className="text-xs">Beds</Label>
              <Input type="number" className="mt-1 h-8 text-sm" value={form.beds} onChange={e => setForm(f => ({ ...f, beds: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Baths</Label>
              <Input type="number" step="0.5" className="mt-1 h-8 text-sm" value={form.baths} onChange={e => setForm(f => ({ ...f, baths: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Sq Ft</Label>
              <Input type="number" className="mt-1 h-8 text-sm" value={form.sqft} onChange={e => setForm(f => ({ ...f, sqft: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Year Built</Label>
              <Input type="number" placeholder="e.g. 1995" className="mt-1 h-8 text-sm" value={form.yearBuilt} onChange={e => setForm(f => ({ ...f, yearBuilt: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Sale Price *</Label>
              <Input type="number" className="mt-1 h-8 text-sm" value={form.salePrice} onChange={e => setForm(f => ({ ...f, salePrice: e.target.value }))} placeholder="$" />
            </div>
            <div>
              <Label className="text-xs">Sold Date</Label>
              <Input type="date" className="mt-1 h-8 text-sm" value={form.soldDate} onChange={e => setForm(f => ({ ...f, soldDate: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => createMutation.mutate({ leadId, data: { ...form, beds: form.beds ? Number(form.beds) : undefined, baths: form.baths ? Number(form.baths) : undefined, sqft: form.sqft ? Number(form.sqft) : undefined, yearBuilt: form.yearBuilt ? Number(form.yearBuilt) : undefined, salePrice: form.salePrice ? Number(form.salePrice) : undefined } })} disabled={createMutation.isPending || !form.address || !form.salePrice}>
              {createMutation.isPending ? "Adding..." : "Add & Auto-Adjust"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Comps List */}
      <div className="p-4 space-y-2">
        {(comps as any[]).length === 0 && !showForm && (
          <p className="text-center text-muted-foreground text-sm italic py-4">
            No comps yet. Add comparable sales and ARV will be auto-calculated.
          </p>
        )}
        {(comps as any[]).map((comp: any) => (
          <div key={comp.id} className="p-3 bg-secondary/30 rounded-xl group">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{comp.address}</p>
                <div className="flex gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap items-center">
                  {comp.beds   != null && <span>{comp.beds}bd</span>}
                  {comp.baths  != null && <span>{comp.baths}ba</span>}
                  {comp.sqft   != null && <span>{comp.sqft.toLocaleString()} sqft</span>}
                  {comp.yearBuilt != null && <span>Built {comp.yearBuilt}</span>}
                  {comp.soldDate && (() => {
                    const months = Math.floor((Date.now() - new Date(comp.soldDate).getTime()) / (1000 * 60 * 60 * 24 * 30.5));
                    const label = `Sold ${comp.soldDate}`;
                    if (months > 18) return <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 font-medium">{label} · {months}mo old ⚠</span>;
                    if (months > 12) return <span className="px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400 font-medium">{label} · {months}mo old</span>;
                    return <span className="text-green-400/80">{label}</span>;
                  })()}
                </div>
              </div>
              <div className="text-right flex-shrink-0 space-y-0.5">
                {comp.salePrice != null && <p className="text-sm text-muted-foreground line-through">{fmt$(comp.salePrice)}</p>}
                {comp.adjustedPrice != null && (
                  <p className="text-sm font-semibold text-green-400">{fmt$(comp.adjustedPrice)} <span className="text-xs font-normal text-muted-foreground">adj.</span></p>
                )}
                {comp.adjustedPrice != null && lead?.sqft ? (
                  <p className="text-xs text-muted-foreground">${Math.round(comp.adjustedPrice / lead.sqft)}/sqft adj.</p>
                ) : comp.pricePerSqft != null && (
                  <p className="text-xs text-muted-foreground">${comp.pricePerSqft}/sqft raw</p>
                )}
              </div>
              <button
                className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive/80 ml-1 mt-0.5"
                onClick={() => deleteMutation.mutate({ leadId, compId: comp.id })}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            {/* Adjustment delta badge — click to expand breakdown */}
            {comp.adjustedPrice != null && comp.salePrice != null && (() => {
              const delta = comp.adjustedPrice - comp.salePrice;
              const isOpen = expandedBreakdown === comp.id;
              const bd = isOpen ? calcBreakdown(comp) : null;
              const fmt = (n: number) => n === 0 ? "—" : `${n > 0 ? "+" : ""}${Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}`;
              return (
                <div className="mt-1.5">
                  <button
                    onClick={() => setExpandedBreakdown(isOpen ? null : comp.id)}
                    className={`text-xs px-2 py-0.5 rounded-md w-fit cursor-pointer transition-opacity hover:opacity-80 ${delta > 0 ? "bg-green-500/10 text-green-400" : delta < 0 ? "bg-red-500/10 text-red-400" : "bg-secondary text-muted-foreground"}`}
                  >
                    {delta > 0 ? "+" : ""}{fmt$(delta)} adjustment {isOpen ? "▲" : "▼"}
                  </button>
                  {isOpen && bd && (
                    <div className="mt-1.5 text-xs rounded-lg bg-background/60 border border-white/8 p-2.5 space-y-1 font-mono">
                      <div className="flex justify-between text-muted-foreground pb-1 border-b border-white/8 mb-1">
                        <span>Base sale price</span>
                        <span className="text-white">{fmt$(comp.salePrice)}</span>
                      </div>
                      {bd.compBeds != null && bd.subjectBeds != null && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Beds ({bd.compBeds} → {bd.subjectBeds} bed, ×$12,500)</span>
                          <span className={bd.bedAdj >= 0 ? "text-green-400" : "text-red-400"}>{fmt(bd.bedAdj)}</span>
                        </div>
                      )}
                      {bd.compBaths != null && bd.subjectBaths != null && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Baths ({bd.compBaths} → {bd.subjectBaths} ba, ×$7,500)</span>
                          <span className={bd.bathAdj >= 0 ? "text-green-400" : "text-red-400"}>{fmt(bd.bathAdj)}</span>
                        </div>
                      )}
                      {bd.compSqft != null && bd.subjectSqft != null && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Sqft ({bd.compSqft.toLocaleString()} → {bd.subjectSqft.toLocaleString()}, ×${Math.round(bd.marketSqftRate)}/sqft)</span>
                          <span className={bd.sqftAdj >= 0 ? "text-green-400" : "text-red-400"}>{fmt(bd.sqftAdj)}</span>
                        </div>
                      )}
                      {bd.compYear != null && bd.subjectYear != null && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Year ({bd.compYear} → {bd.subjectYear}, ×$150)</span>
                          <span className={bd.yearAdj >= 0 ? "text-green-400" : "text-red-400"}>{fmt(bd.yearAdj)}</span>
                        </div>
                      )}
                      {bd.timeAdj !== 0 && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Time adj (3%/yr since sold)</span>
                          <span className="text-green-400">{fmt(bd.timeAdj)}</span>
                        </div>
                      )}
                      <div className="flex justify-between border-t border-white/8 pt-1 mt-1 font-semibold">
                        <span className="text-muted-foreground">Adjusted price</span>
                        <span className="text-white">{fmt$(comp.adjustedPrice)}</span>
                      </div>
                      <p className="text-muted-foreground/60 text-[10px] pt-0.5">Market rate: ${Math.round(bd.marketSqftRate)}/sqft (median of {(comps as any[]).filter((c:any) => c.salePrice > 0 && c.sqft > 0).length} comps)</p>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Email History ─────────────────────────────────────────────────────────────
function EmailHistory({ leadId }: { leadId: number }) {
  const { data: logs = [] } = useQuery<any[]>({
    queryKey: ["crm-email-logs", leadId],
    queryFn: () => apiFetch(`/sequences/logs/${leadId}`),
    staleTime: 60_000,
  });
  if (logs.length === 0) return null;
  return (
    <Card className="rounded-2xl border-white/5 bg-card shadow-lg overflow-hidden">
      <div className="bg-secondary/30 p-4 border-b border-border flex items-center gap-2">
        <Mail className="w-5 h-5 text-primary" />
        <h2 className="font-display font-semibold">Email History</h2>
        <Badge variant="secondary" className="text-xs">{logs.length}</Badge>
      </div>
      <div className="p-4 space-y-2 max-h-48 overflow-y-auto">
        {logs.map((log: any) => (
          <div key={log.id} className="flex items-center gap-3 p-2 rounded-lg bg-secondary/30">
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${log.status === "sent" ? "bg-green-400" : "bg-red-400"}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">{log.subject || "Email sent"}</p>
              <p className="text-xs text-muted-foreground">{format(new Date(log.sentAt), "MMM d, h:mm a")}</p>
            </div>
            <Badge variant={log.status === "sent" ? "secondary" : "destructive"} className="text-xs">{log.status}</Badge>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── AI Repair Estimator ──────────────────────────────────────────────────────
function AiRepairEstimator({ leadId, onApplied }: { leadId: number; onApplied: (total: number) => void }) {
  const { toast } = useToast();
  const [desc, setDesc] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ items: any[]; totalCost: number; disclaimer: string } | null>(null);

  async function handleEstimate() {
    if (!desc.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const token = localStorage.getItem("crm_token");
      const resp = await fetch(`/api/crm/leads/${leadId}/ai-repair-estimate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ description: desc }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Estimate failed");
      setResult(data);
      toast({ title: `AI Repair Estimate: ${fmt$(data.totalCost)}`, description: "Review the breakdown and click Apply to save." });
    } catch (err: any) {
      toast({ title: "Estimate failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="rounded-2xl border-white/5 bg-card shadow-lg overflow-hidden">
      <div className="bg-secondary/30 p-4 border-b border-border flex items-center gap-2">
        <Wrench className="w-5 h-5 text-primary" />
        <h2 className="font-display font-semibold">AI Repair Estimator</h2>
        <Badge variant="secondary" className="text-xs gap-1"><Sparkles className="w-3 h-3" />AI</Badge>
      </div>
      <div className="p-4 space-y-4">
        <div>
          <Label className="text-muted-foreground text-xs mb-1 block">Describe the repairs needed (plain language)</Label>
          <Textarea
            value={desc}
            onChange={e => setDesc(e.target.value)}
            rows={4}
            className="bg-background/80 rounded-xl border-white/10 text-sm resize-none"
            placeholder="e.g. Roof needs full replacement, living room carpet, bathroom needs new tiles, kitchen needs new fridge and countertops, HVAC is old…"
          />
        </div>
        <Button
          className="w-full gap-2 rounded-xl"
          onClick={handleEstimate}
          disabled={loading || !desc.trim()}
        >
          {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Estimating…</> : <><Sparkles className="w-4 h-4" /> Estimate Repair Cost</>}
        </Button>

        {result && (
          <div className="space-y-3">
            <div className="overflow-auto rounded-xl border border-white/10">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-secondary/50 text-muted-foreground">
                    <th className="text-left p-2 font-medium">Item</th>
                    <th className="text-right p-2 font-medium">Qty</th>
                    <th className="text-right p-2 font-medium">Unit Cost</th>
                    <th className="text-right p-2 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item: any, i: number) => (
                    <tr key={i} className="border-t border-white/5 hover:bg-secondary/20">
                      <td className="p-2">
                        <div className="font-medium text-foreground">{item.item}</div>
                        {item.notes && <div className="text-muted-foreground/70">{item.notes}</div>}
                      </td>
                      <td className="p-2 text-right text-muted-foreground">{item.qty} {item.unit}</td>
                      <td className="p-2 text-right text-muted-foreground">{fmt$(item.unitCost)}</td>
                      <td className="p-2 text-right font-semibold text-foreground">{fmt$(item.total)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-primary/30 bg-primary/5">
                    <td colSpan={3} className="p-2 font-bold text-primary">Total Estimated Repair Cost</td>
                    <td className="p-2 text-right font-bold text-primary text-sm">{fmt$(result.totalCost)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {result.disclaimer && (
              <p className="text-[10px] text-muted-foreground/60 italic">{result.disclaimer}</p>
            )}
            <Button
              variant="default"
              size="sm"
              className="w-full rounded-xl gap-2"
              onClick={() => { onApplied(result.totalCost); toast({ title: `ERC set to ${fmt$(result.totalCost)}` }); }}
            >
              <Check className="w-3.5 h-3.5" /> Apply as Est. Repair Cost (ERC)
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}



function AiDealScorer({ leadId }: { leadId: number }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any | null>(null);

  // Safety function to fix "90/10" errors by forcing numbers into 1-10 range
  const clamp = (s: any) => {
    let num = parseInt(s);
    if (isNaN(num)) return 5;
    if (num > 10) return Math.round(num / 10); // Converts 60 to 6
    return Math.min(Math.max(num, 1), 10);
  };

  async function handleScore() {
    setLoading(true);
    setResult(null);
    try {
      const token = localStorage.getItem("crm_token");
      const resp = await fetch(`/api/crm/leads/${leadId}/ai-deal-score`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });

      if (!resp.ok) throw new Error("Scoring failed");
      const data = await resp.json();
      setResult(data);

      setTimeout(() => {
        document.getElementById(`score-result-${leadId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
    } catch (err: any) {
      toast({ title: "Scoring failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  const scoreColor = (s: any) => {
    const val = clamp(s);
    return val >= 8 ? "text-green-400" : val >= 6 ? "text-yellow-400" : "text-red-400";
  };

  const gradeColor = (g: string) => 
    g?.startsWith("A") ? "bg-green-500/20 text-green-400" : 
    g?.startsWith("B") ? "bg-yellow-500/20 text-yellow-400" : "bg-red-500/20 text-red-400";

  return (
    <Card className="rounded-2xl border-white/5 bg-card shadow-lg overflow-hidden">
      <div className="bg-secondary/30 p-4 border-b border-border flex items-center gap-2">
        <TrendingUp className="w-5 h-5 text-primary" />
        <h2 className="font-display font-semibold">AI Deal Scorer</h2>
        <Badge variant="secondary" className="text-xs gap-1"><Sparkles className="w-3 h-3" />AI</Badge>
      </div>
      
      <div className="p-4 space-y-4">
        <Button className="w-full gap-2 rounded-xl" onClick={handleScore} disabled={loading}>
          {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing Activity Logs…</> : <><Sparkles className="w-4 h-4" /> Score This Deal</>}
        </Button>

        {result && (
          <div id={`score-result-${leadId}`} className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
            {/* Header Score Block */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-secondary/40 border border-white/5">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Deal Score</p>
                <p className={`text-4xl font-bold ${scoreColor(result.score)}`}>
                  {clamp(result.score)}<span className="text-lg text-muted-foreground">/10</span>
                </p>
                <p className="text-sm text-muted-foreground mt-1">{result.verdict}</p>
              </div>
              <Badge className={`text-2xl font-bold px-4 py-2 ${gradeColor(result.grade)}`}>{result.grade}</Badge>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Profit Potential", data: result.profitPotential },
                { label: "Seller Motivation", data: result.sellerMotivation },
                { label: "Deal Risk", data: result.dealRisk },
                { label: "Urgency", data: result.urgency },
              ].map(({ label, data }) => data && (
                <div key={label} className="p-3 rounded-xl bg-secondary/30 border border-white/5">
                  <p className="text-xs text-muted-foreground mb-1">{label}</p>
                  <p className={`text-lg font-bold ${scoreColor(data.score)}`}>{clamp(data.score)}/10</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-tight">{data.note}</p>
                </div>
              ))}
            </div>

            {/* Recommendation */}
            {result.recommendation && (
              <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
                <p className="text-xs font-semibold text-primary mb-1">Recommendation</p>
                <p className="text-sm italic">"{result.recommendation}"</p>
              </div>
            )}

            {/* Lists */}
            {result.positives?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-green-400 mb-2">Positives</p>
                <ul className="space-y-1">
                  {result.positives.map((p: string, i: number) => (
                    <li key={i} className="text-xs text-muted-foreground flex gap-2"><span className="text-green-400">✓</span>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            {result.redFlags?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-red-400 mb-2">Red Flags</p>
                <ul className="space-y-1">
                  {result.redFlags.map((f: string, i: number) => (
                    <li key={i} className="text-xs text-muted-foreground flex gap-2"><span className="text-red-400">⚠</span>{f}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}



// ─── AI Seller Script ──────────────────────────────────────────────────────────
function AiSellerScript({ leadId }: { leadId: number }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    setResult(null);
    try {
      const token = localStorage.getItem("crm_token");
      const resp = await fetch(`/api/crm/leads/${leadId}/ai-seller-script`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Script generation failed");
      setResult(data);
    } catch (err: any) {
      toast({ title: "Script generation failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  function copyAll() {
    if (!result) return;
    const text = [
      "OPENING:\n" + result.opening,
      "BUILD RAPPORT:\n" + result.buildRapport,
      "DISCOVER PAIN:\n" + result.discoverPain,
      "PRESENT OFFER:\n" + result.presentOffer,
      "HANDLE OBJECTIONS:\n" + result.handleObjections?.map((o: any) => `Q: ${o.objection}\nA: ${o.response}`).join("\n\n"),
      "CLOSING:\n" + result.closing,
      result.tipsForThisLead?.length ? "TIPS:\n" + result.tipsForThisLead.map((t: string) => "• " + t).join("\n") : "",
    ].filter(Boolean).join("\n\n---\n\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const Section = ({ title, content }: { title: string; content: string }) => (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-primary uppercase tracking-wide">{title}</p>
      <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap bg-secondary/30 p-3 rounded-xl border border-white/5">{content}</p>
    </div>
  );

  return (
    <Card className="rounded-2xl border-white/5 bg-card shadow-lg overflow-hidden">
      <div className="bg-secondary/30 p-4 border-b border-border flex items-center gap-2">
        <Phone className="w-5 h-5 text-primary" />
        <h2 className="font-display font-semibold">AI Seller Script</h2>
        <Badge variant="secondary" className="text-xs gap-1"><Sparkles className="w-3 h-3" />AI</Badge>
      </div>
      <div className="p-4 space-y-4">
        <Button className="w-full gap-2 rounded-xl" onClick={handleGenerate} disabled={loading}>
          {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating Script…</> : <><Sparkles className="w-4 h-4" /> Generate Call Script</>}
        </Button>
        {result && (
          <div className="space-y-4">
            <Button variant="outline" size="sm" className="w-full gap-2 rounded-xl" onClick={copyAll}>
              {copied ? <><Check className="w-4 h-4" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy Full Script</>}
            </Button>
            {result.opening && <Section title="Opening" content={result.opening} />}
            {result.buildRapport && <Section title="Build Rapport" content={result.buildRapport} />}
            {result.discoverPain && <Section title="Discover Pain Points" content={result.discoverPain} />}
            {result.presentOffer && <Section title="Present Offer" content={result.presentOffer} />}
            {result.handleObjections?.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-primary uppercase tracking-wide">Handle Objections</p>
                {result.handleObjections.map((o: any, i: number) => (
                  <div key={i} className="bg-secondary/30 p-3 rounded-xl border border-white/5 space-y-1">
                    <p className="text-xs font-semibold text-yellow-400">"{o.objection}"</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{o.response}</p>
                  </div>
                ))}
              </div>
            )}
            {result.closing && <Section title="Closing" content={result.closing} />}
            {result.tipsForThisLead?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-green-400 uppercase tracking-wide mb-2">Tips for This Lead</p>
                <ul className="space-y-1">{result.tipsForThisLead.map((t: string, i: number) => <li key={i} className="text-xs text-muted-foreground flex gap-2"><span className="text-green-400">•</span>{t}</li>)}</ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── AI Offer Letter ───────────────────────────────────────────────────────────
function AiOfferLetter({ leadId }: { leadId: number }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ subject: string; letter: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    setResult(null);
    try {
      const token = localStorage.getItem("crm_token");
      const resp = await fetch(`/api/crm/leads/${leadId}/ai-offer-letter`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Letter generation failed");
      setResult(data);
    } catch (err: any) {
      toast({ title: "Letter generation failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  function copyLetter() {
    if (!result) return;
    navigator.clipboard.writeText(`Subject: ${result.subject}\n\n${result.letter}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card className="rounded-2xl border-white/5 bg-card shadow-lg overflow-hidden">
      <div className="bg-secondary/30 p-4 border-b border-border flex items-center gap-2">
        <FileText className="w-5 h-5 text-primary" />
        <h2 className="font-display font-semibold">AI Offer Letter</h2>
        <Badge variant="secondary" className="text-xs gap-1"><Sparkles className="w-3 h-3" />AI</Badge>
      </div>
      <div className="p-4 space-y-4">
        <Button className="w-full gap-2 rounded-xl" onClick={handleGenerate} disabled={loading}>
          {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating Letter…</> : <><Sparkles className="w-4 h-4" /> Generate Offer Letter</>}
        </Button>
        {result && (
          <div className="space-y-3">
            <div className="p-3 rounded-xl bg-secondary/40 border border-white/5">
              <p className="text-xs text-muted-foreground mb-1">Subject Line</p>
              <p className="text-sm font-semibold">{result.subject}</p>
            </div>
            <div className="p-4 rounded-xl bg-secondary/30 border border-white/5">
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{result.letter}</p>
            </div>
            <Button variant="outline" size="sm" className="w-full gap-2 rounded-xl" onClick={copyLetter}>
              {copied ? <><Check className="w-4 h-4" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy Letter</>}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function LeadDetail() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const leadId = Number(id);

  // Cache me for the whole session — it never changes while logged in
  const { data: me } = useQuery<any>({
    queryKey: ["/api/crm/me"],
    queryFn: () => apiFetch("/me"),
    staleTime: 10 * 60 * 1000,
  });

  // Fetch lead + comps in one round-trip, pre-populate comps cache for child panels
  const { data: lead, isLoading } = useQuery<any>({
    queryKey: [`/api/crm/leads/${leadId}`],
    queryFn: async () => {
      const r = await apiFetch(`/leads/${leadId}/full`);
      queryClient.setQueryData([`/api/crm/leads/${leadId}/comps`], r.comps ?? []);
      return r;
    },
    enabled: !!leadId,
    staleTime: 30 * 1000,
  });
  const notes: any[] = (lead as any)?.notes ?? [];
  const tasks: any[] = (lead as any)?.tasks ?? [];

  // Campaign governance — changes rarely, cache 5 minutes
  const { data: campaignData } = useQuery<any>({
    queryKey: ["crm-campaign-lead", me?.campaignId],
    queryFn: async () => {
      if (!me?.campaignId) return null;
      const r = await apiFetch(`/campaigns`);
      const list = Array.isArray(r) ? r : [];
      return list.find((c: any) => c.id === me.campaignId) ?? null;
    },
    enabled: !!me?.campaignId,
    staleTime: 300_000,
  });

  // Campaign users — changes rarely, cache 2 minutes
  const { data: campaignUsers = [] } = useQuery<any[]>({
    queryKey: ["crm-users-campaign"],
    queryFn: () => apiFetch("/users"),
    enabled: !!me,
    staleTime: 120_000,
  });

  // Follow state — derived from lead detail response (no separate fetch needed)
  const isFollowing: boolean = (lead as any)?.isFollowing ?? false;
  const followerCount: number = (lead as any)?.followerCount ?? 0;

  const followMutation = useMutation({
    mutationFn: () => apiFetch(`/leads/${leadId}/follow`, { method: isFollowing ? "DELETE" : "POST" }),
    onSuccess: () => {
      // Optimistically flip the state in cache, then refetch for accurate count
      queryClient.setQueryData([`/api/crm/leads/${leadId}`], (old: any) =>
        old ? { ...old, isFollowing: !isFollowing, followerCount: followerCount + (isFollowing ? -1 : 1) } : old
      );
    },
  });

  const isSuperAdmin = me?.role === "super_admin";
  const isAdmin = me?.role === "admin" || isSuperAdmin;
  const isVA = me?.role === "va";
  const canDeleteLeads = isSuperAdmin || (isAdmin && campaignData?.allowLeadDeletion === true);
  const canArchive = isAdmin;

  const updateMutation = useCrmUpdateLead();
  const deleteMutation = useCrmDeleteLead();
  const addNoteMutation = useCrmAddLeadNote();
  const addTaskMutation = useCrmCreateTask();
  const fetchPropertyMutation = useCrmFetchPropertyData({
    mutation: {
      onSuccess: (data: any) => {
        const fields: string[] = data?.fieldsUpdated ?? [];
        const fetched = data?.fetched ?? {};

        // Build the patch object from the API response
        const patch: Record<string, any> = {};
        if (fetched.beds         != null) patch.beds         = fetched.beds;
        if (fetched.baths        != null) patch.baths        = fetched.baths;
        if (fetched.sqft         != null) patch.sqft         = fetched.sqft;
        if (fetched.yearBuilt    != null) patch.yearBuilt    = fetched.yearBuilt;
        if (fetched.ownerName    != null) patch.ownerName    = fetched.ownerName;
        if (fetched.lastSaleDate != null) patch.lastSaleDate = fetched.lastSaleDate;
        if (fetched.lastSalePrice!= null) patch.lastSalePrice= fetched.lastSalePrice;
        if (fetched.propertyType != null) patch.propertyType = fetched.propertyType;
        if (fetched.arv          != null) patch.arv          = fetched.arv;
        if (fetched.mao          != null) patch.mao          = fetched.mao;
        if (fetched.currentValue != null) patch.currentValue = fetched.currentValue;

        if (fields.length > 0 && Object.keys(patch).length > 0) {
          // Patch formData immediately. Data was already saved to DB by the
          // fetch endpoint — do NOT mark dirty so the Save button stays hidden.
          setFormData((f: any) => ({ ...f, ...patch }));

          // Update the React Query cache directly — no network refetch needed,
          // and prevents useEffect([lead]) from overwriting formData.
          queryClient.setQueryData([`/api/crm/leads/${leadId}`], (old: any) =>
            old ? { ...old, ...patch } : old
          );
        }

        const apiReturned = Object.entries(fetched).filter(([k, v]) => v != null && k !== "creditsRemaining" && k !== "arv" && k !== "mao").map(([k]) => k);
        if (fields.length > 0) {
          toast({
            title: `Property data fetched — updated: ${fields.join(", ")}`,
            description: "ARV is not set automatically — add comparable sales below to calculate it.",
          });
        } else if (apiReturned.length > 0) {
          toast({ title: "Property data fetched — fields up to date", description: `API returned: ${apiReturned.join(", ")}` });
        } else {
          toast({ title: "Property not found", description: "No data returned for this address. Check address is complete and try again.", variant: "destructive" });
        }
      },
      onError: (err: any) => {
        const body = err?.response?.data ?? err?.data ?? {};
        if (body?.error === "cooldown") {
          const mins = body.retryAfterMs ? Math.ceil(body.retryAfterMs / 60000) : null;
          toast({
            title: "Cooldown active",
            description: body.message ?? (mins ? `Try again in ${mins} minute(s)` : "Please wait before fetching again"),
            variant: "destructive",
          });
        } else {
          toast({ title: "Could not fetch property data", description: "Check the address is complete and try again", variant: "destructive" });
        }
      },
    },
  });

  const skipTraceMutation = useCrmSkipTrace({
    mutation: {
      onSuccess: (data: any) => {
        const fieldsUpdated: string[] = data?.fieldsUpdated ?? [];
        const phones: any[] = data?.phones ?? [];
        const emails: string[] = data?.emails ?? [];

        const patch: Record<string, any> = {};
        if (fieldsUpdated.includes("phone") && phones[0]?.number) patch.phone = phones[0].number;
        if (fieldsUpdated.includes("email") && emails[0]) patch.email = emails[0];
        patch.skipTracedPhones = phones;
        patch.skipTracedEmails = emails;

        setFormData((f: any) => ({ ...f, ...patch }));
        queryClient.setQueryData([`/api/crm/leads/${leadId}`], (old: any) =>
          old ? { ...old, ...patch } : old
        );

        const matched = data?.matchStatus === "matched";
        const phoneCount = phones.length;
        const emailCount = emails.length;

        if (!matched || (phoneCount === 0 && emailCount === 0)) {
          toast({
            title: "No match found",
            description: "No contact data found for this address.",
            variant: "destructive",
          });
        } else if (fieldsUpdated.length > 0) {
          toast({ title: `Contact data found — auto-filled: ${fieldsUpdated.join(", ")}`, description: `Found ${phoneCount} phone(s), ${emailCount} email(s)` });
        } else {
          toast({ title: "Contact data matched", description: `Found ${phoneCount} phone(s), ${emailCount} email(s) — fields already filled` });
        }
      },
      onError: (err: any) => {
        const body = err?.response?.data ?? err?.data ?? {};
        if (body?.error === "cooldown") {
          const hours = body.retryAfterMs ? Math.ceil(body.retryAfterMs / 3600000) : null;
          toast({
            title: "Daily limit reached",
            description: body.message ?? (hours ? `Contact enrichment available again in ~${hours} hour(s)` : "1 contact enrichment allowed per campaign per day"),
            variant: "destructive",
          });
        } else {
          const apiMsg = body?.message ?? body?.error;
          const httpStatus = body?.httpStatus;
          const description = apiMsg
            ? (httpStatus ? `API error ${httpStatus}: ${apiMsg}` : apiMsg)
            : "Could not reach the contact enrichment service. Check your PropertyAPI plan.";
          toast({ title: "Contact enrichment failed", description, variant: "destructive" });
        }
      },
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (archive: boolean) =>
      apiFetch(`/leads/${leadId}/${archive ? "archive" : "unarchive"}`, { method: "POST" }),
    onSuccess: (_data, archive) => {
      toast({ title: archive ? "Lead archived" : "Lead restored" });
      queryClient.invalidateQueries({ queryKey: [`/api/crm/leads/${leadId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/crm/leads`] });
    },
  });

  const [formData, setFormData] = useState<any>({});
  const [newNote, setNewNote] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const initializedRef = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formDataRef = useRef<any>({});

  // ── SignalWire state ───────────────────────────────────────────────────────
  const [opPhoneNumbers, setOpPhoneNumbers] = useState<any[]>([]);
  const [opSelectedId, setOpSelectedId] = useState<string>("");
  const [opMessages, setOpMessages] = useState<any[]>([]);
  const [opCalls, setOpCalls] = useState<any[]>([]);
  const [opSmsContent, setOpSmsContent] = useState("");
  const [opSending, setOpSending] = useState(false);
  const [opCalling, setOpCalling] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [opLoadingMsgs, setOpLoadingMsgs] = useState(false);
  const [opError, setOpError] = useState("");
  const [opTab, setOpTab] = useState<"messages" | "calls">("messages");
  const [callModalOpen, setCallModalOpen] = useState(false);
  const [agentPhone, setAgentPhone] = useState(() => localStorage.getItem("crm_agent_phone") || "");
  const [callDialing, setCallDialing] = useState(false);
  const [callSuccess, setCallSuccess] = useState("");
  const [callErr, setCallErr] = useState("");

  function opFetch(path: string, options?: RequestInit) {
    const token = localStorage.getItem("crm_token");
    // Redirect openphone paths to signalwire equivalent
    const swPath = path.replace("/openphone/", "/signalwire/");
    return fetch(`/api${swPath}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options?.headers || {}),
      },
    }).then(async r => {
      const json = await r.json();
      if (!r.ok) throw new Error(json?.error || "SignalWire error");
      return json;
    });
  }

  // State-match helper — finds OpenPhone number matching lead's state
  function pickNumberForState(numbers: any[], state: string | null | undefined): string | null {
    if (!state || !numbers.length) return null;
    const abbr = state.trim().toUpperCase().slice(0, 2);
    const match = numbers.find(n => {
      const name = (n.name || "").toUpperCase().trim();
      return name === abbr || name.startsWith(abbr + " ") || name.startsWith(abbr + "1") || name.startsWith(abbr + "2") || name.startsWith(abbr + "3");
    }) || numbers.find(n => {
      const name = (n.name || "").toUpperCase();
      return name.includes(` ${abbr}`) || name.endsWith(abbr);
    });
    return match?.id ?? null;
  }

  // Load phone numbers once + auto-select by campaign → state → first
  useEffect(() => {
    opFetch("/openphone/phone-numbers")
      .then(d => {
        const numbers = d.phoneNumbers || [];
        setOpPhoneNumbers(numbers);
        // Priority 1: campaign's assigned number
        if (campaignData?.openPhoneNumberId) {
          const campaignNum = numbers.find((n: any) => n.id === campaignData.openPhoneNumberId);
          if (campaignNum) { setOpSelectedId(campaignNum.id); return; }
        }
        // Priority 2: state match
        const stateMatch = pickNumberForState(numbers, lead?.state);
        if (stateMatch) { setOpSelectedId(stateMatch); return; }
        // Priority 3: first number
        if (numbers[0]?.id) setOpSelectedId(numbers[0].id);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignData?.openPhoneNumberId, lead?.state]);

  // Load stored messages from DB (includes inbound replies) + live calls from OpenPhone API
  const loadStoredMessages = () => {
    if (!leadId) return;
    setOpLoadingMsgs(true);
    setOpError("");
    const callsPromise = opSelectedId && lead?.phone
      ? opFetch(`/openphone/calls?phoneNumberId=${encodeURIComponent(opSelectedId)}&contactPhone=${encodeURIComponent(lead.phone)}`)
          .then(d => d.calls || []).catch(() => [])
      : Promise.resolve([]);
    Promise.all([
      opFetch(`/openphone/lead-messages/${leadId}`).then(d => d.messages || []).catch(() => []),
      callsPromise,
    ])
      .then(([msgs, calls]) => {
        setOpMessages(msgs);
        setOpCalls(calls);
      })
      .catch(e => setOpError(e.message))
      .finally(() => setOpLoadingMsgs(false));
  };

  useEffect(() => {
    const shouldLoad = leadId && (isSuperAdmin || campaignData?.dialerEnabled);
    if (shouldLoad) loadStoredMessages();
    const interval = setInterval(() => {
      if (leadId && (isSuperAdmin || campaignData?.dialerEnabled)) loadStoredMessages();
    }, 8000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, opSelectedId, lead?.phone, isSuperAdmin, campaignData?.dialerEnabled]);

  const refreshOpMessages = () => { loadStoredMessages(); };

  const sendOpSms = async () => {
    if (!opSmsContent.trim() || !opSelectedId || !lead?.phone) return;
    setOpSending(true);
    setOpError("");
    try {
      await opFetch("/openphone/messages", {
        method: "POST",
        body: JSON.stringify({
          phoneNumberId: opSelectedId,
          to: lead.phone,
          content: opSmsContent.trim(),
          leadId,
          campaignId: (lead as any)?.campaignId,
        }),
      });
      setOpSmsContent("");
      addNoteMutation.mutate({ id: leadId, data: { content: `📱 SMS sent: "${opSmsContent.trim()}"` } });
      setTimeout(refreshOpMessages, 1500);
    } catch (e: any) {
      setOpError(e.message);
    } finally {
      setOpSending(false);
    }
  };

  const initiateClickToCall = async () => {
    if (!lead?.phone || !opSelectedId) return;
    setCallErr("");
    setCallSuccess("");
    setCallDialing(true);
    try {
      const token = localStorage.getItem("crm_token");
      // Normalize agent phone to E.164 before sending
      const digits = agentPhone.replace(/\D/g, "");
      const agentPhoneE164 = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : agentPhone;
      const resp = await fetch("/api/signalwire/click-to-call", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ fromNumber: opSelectedId, agentPhone: agentPhoneE164, leadPhone: lead.phone }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Call failed");
      setCallSuccess(`Calling your phone now. Pick up — you'll be connected to ${lead.phone}`);
      addNoteMutation.mutate({ id: leadId, data: { content: `📞 Click-to-call initiated to ${lead.phone}` } });
      setTimeout(() => { setCallModalOpen(false); setCallSuccess(""); }, 7000);
    } catch (e: any) {
      setCallErr(e.message);
    } finally {
      setCallDialing(false);
    }
  };

  // Keep a ref in sync so the auto-save timeout can read the latest formData.
  useEffect(() => {
    formDataRef.current = formData;
  }, [formData]);

  // Initialize formData ONCE when the lead first loads — never reset on background refetches.
  useEffect(() => {
    if (lead && !initializedRef.current) {
      setFormData(lead);
      formDataRef.current = lead;
      initializedRef.current = true;
    }
  }, [lead]);

  // Auto-save: 1.5 s after the last change, save silently.
  useEffect(() => {
    if (!isDirty) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      const latest = formDataRef.current;
      updateMutation.mutate(
        { id: leadId, data: latest },
        {
          onSuccess: () => {
            setIsDirty(false);
            queryClient.setQueryData([`/api/crm/leads/${leadId}`], (old: any) =>
              old ? { ...old, ...latest } : old
            );
          },
        }
      );
    }, 1500);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, formData]);

  if (isLoading || !lead) return <div className="p-8 text-center text-muted-foreground animate-pulse">Loading property details...</div>;

  const field = (key: string) => (val: any) => {
    setIsDirty(true);
    setFormData((f: any) => ({ ...f, [key]: val }));
  };

  const handleUpdate = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    updateMutation.mutate(
      { id: leadId, data: formData },
      {
        onSuccess: () => {
          toast({ title: "Changes saved" });
          setIsDirty(false);
          queryClient.setQueryData([`/api/crm/leads/${leadId}`], (old: any) =>
            old ? { ...old, ...formData } : old
          );
        },
        onError: () => {
          toast({ title: "Save failed", description: "Check your connection and try again", variant: "destructive" });
        },
      }
    );
  };

  const handleDelete = () => {
    if (confirm("Are you sure you want to permanently delete this lead? This cannot be undone.")) {
      deleteMutation.mutate(
        { id: leadId },
        {
          onSuccess: () => {
            toast({ title: "Lead deleted" });
            setLocation("/leads");
          },
          onError: (err: any) => {
            toast({ title: "Cannot delete this lead", description: err?.message || "Lead deletion is not enabled for this campaign.", variant: "destructive" });
          },
        }
      );
    }
  };

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim()) return;
    addNoteMutation.mutate(
      { id: leadId, data: { content: newNote } },
      {
        onSuccess: () => {
          setNewNote("");
          queryClient.invalidateQueries({ queryKey: [`/api/crm/leads/${leadId}`] });
        },
      }
    );
  };

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    addTaskMutation.mutate(
      { data: { title: newTaskTitle, leadId, status: "pending" } },
      {
        onSuccess: () => {
          setNewTaskTitle("");
          queryClient.invalidateQueries({ queryKey: [`/api/crm/leads/${leadId}`] });
        },
      }
    );
  };

  const arv = Number(formData.arv) || 0;
  const erc = Number(formData.estimatedRepairCost) || 0;
  const mao = arv > 0 ? (arv * 0.8) - erc : 0;

  const agingDays = differenceInDays(new Date(), new Date(lead.updatedAt || lead.createdAt));
  const isRented = formData.occupancy === "Rented" || formData.isRental === true;

  // Split notes into regular and audit
  const regularNotes = (notes || []).filter((n: any) => n.noteType !== "audit");
  const auditNotes = (notes || []).filter((n: any) => n.noteType === "audit");

  return (
    <div className="space-y-6 pb-20">
      {/* Header */}
      <div className="flex items-center gap-4 flex-wrap">
        <Link href="/leads">
          <Button variant="ghost" size="icon" className="rounded-xl border border-white/10 bg-card hover:bg-secondary">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-display font-bold truncate">{lead.address}</h1>
            {agingDays >= 7 && (
              <Badge className={`text-xs ${agingDays >= 14 ? "bg-red-500/20 text-red-400 border-red-500/30" : "bg-orange-500/20 text-orange-400 border-orange-500/30"}`}>
                <Clock className="w-3 h-3 mr-1" /> {agingDays}d no update
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground text-sm">Added {format(new Date(lead.createdAt), "MMM d, yyyy")}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Follow button */}
          <Button
            variant={isFollowing ? "default" : "outline"}
            size="sm"
            className={`rounded-xl gap-1.5 ${isFollowing ? "bg-primary/20 text-primary border-primary/30 hover:bg-primary/30" : ""}`}
            onClick={() => followMutation.mutate()}
            disabled={followMutation.isPending}
          >
            {isFollowing ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
            {isFollowing ? "Following" : "Follow"}
            {followerCount > 0 && <span className="ml-1 text-xs opacity-70">({followerCount})</span>}
          </Button>
          <Button
            variant="outline"
            className="rounded-xl h-9 px-4 text-sm gap-2 border-primary/30 text-primary hover:bg-primary/10"
            onClick={() => openOfferLetter(formData, mao, campaignData)}
          >
            <FileText className="w-4 h-4" /> Offer Letter
          </Button>
          {/* Manual Save Button — only visible when there are unsaved changes */}
          {isDirty && (
            <Button
              onClick={handleUpdate}
              disabled={updateMutation.isPending}
              className="rounded-xl h-9 px-5 text-sm gap-2 bg-primary text-primary-foreground hover:bg-primary/90 animate-pulse"
            >
              {updateMutation.isPending ? "Saving…" : "⬆ Save Changes"}
            </Button>
          )}
        </div>
      </div>

      {/* Pipeline Status Bar */}
      <Card className="p-6 rounded-2xl bg-card border-white/5 shadow-lg">
        <div className="flex items-center justify-between gap-2 overflow-x-auto pb-2">
          {STATUSES.map((status, index) => {
            const currentIndex = STATUSES.indexOf(formData.status);
            const isCompleted = index <= currentIndex && formData.status !== "dead";
            const isActive = index === currentIndex && formData.status !== "dead";
            return (
              <div key={status} className="flex-1 flex flex-col items-center min-w-[100px] relative">
                <button
                  onClick={() => {
                    const updated = { ...formData, status };
                    setFormData(updated);
                    updateMutation.mutate({ id: leadId, data: updated });
                  }}
                  className={`w-full h-2 rounded-full mb-3 transition-colors ${isCompleted ? "bg-primary shadow-[0_0_10px_rgba(99,102,241,0.5)]" : "bg-secondary"}`}
                />
                <span className={`text-xs font-medium uppercase tracking-wider ${isActive ? "text-primary" : "text-muted-foreground"}`}>
                  {status.replace("_", " ")}
                </span>
              </div>
            );
          })}
        </div>
        {/* Dead toggle */}
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={() => {
              const newStatus = formData.status === "dead" ? "new" : "dead";
              const updated = { ...formData, status: newStatus };
              setFormData(updated);
              updateMutation.mutate({ id: leadId, data: updated });
            }}
            className={`px-4 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${formData.status === "dead" ? "bg-destructive/20 text-destructive border-destructive/30" : "border-border text-muted-foreground hover:bg-secondary"}`}
          >
            {formData.status === "dead" ? "✗ Deal is DEAD — Click to Reopen" : "Mark as Dead"}
          </button>
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* LEFT COL */}
        <div className="xl:col-span-2 space-y-6">

          {/* Contact + Lead Source */}
          <Card className="rounded-2xl border-white/5 bg-card shadow-lg overflow-hidden">
            <div className="bg-secondary/30 p-4 border-b border-border flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <User className="w-5 h-5 text-primary" />
                <h2 className="font-display font-semibold">Contact & Lead Source</h2>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5 border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
                disabled={skipTraceMutation.isPending}
                onClick={() => skipTraceMutation.mutate({ id: leadId })}
              >
                {skipTraceMutation.isPending ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <Search className="w-3 h-3" />
                )}
                {skipTraceMutation.isPending ? "Running..." : "Enrich Contact"}
              </Button>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Seller Name</Label>
                <Input className="bg-background/50 rounded-xl" value={formData.sellerName || ""} onChange={e => field("sellerName")(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Phone Number</Label>
                <Input className="bg-background/50 rounded-xl" value={formData.phone || ""} onChange={e => field("phone")(e.target.value)} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Email</Label>
                <Input type="email" className="bg-background/50 rounded-xl" value={formData.email || ""} onChange={e => field("email")(e.target.value)} />
              </div>
              <SelectField label="Lead Source" value={formData.leadSource || ""} onChange={field("leadSource")} options={LEAD_SOURCES} />
              {isAdmin && (
                <div className="space-y-2">
                  <Label>Assigned To</Label>
                  <select
                    value={formData.assignedTo || ""}
                    onChange={e => field("assignedTo")(e.target.value ? Number(e.target.value) : null)}
                    className="w-full h-10 rounded-xl border border-border bg-background/50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    <option value="">— Unassigned —</option>
                    {campaignUsers.map((u: any) => (
                      <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Contact Data */}
            {((lead as any).skipTracedPhones?.length > 0 || (lead as any).skipTracedEmails?.length > 0) && (
              <div className="px-6 pb-6">
                <div className="border-t border-border pt-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Search className="w-4 h-4 text-purple-400" />
                    <span className="text-sm font-medium text-purple-400">Contact Data</span>
                    {(lead as any).skipTracedName && (lead as any).skipTracedName !== lead.sellerName && (
                      <span className="text-xs text-muted-foreground">— {(lead as any).skipTracedName}</span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {(lead as any).skipTracedPhones?.length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Phones</p>
                        <div className="space-y-1.5">
                          {(lead as any).skipTracedPhones.map((p: any, i: number) => (
                            <div key={i} className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-mono">{p.number}</span>
                              {p.type && (
                                <Badge className={`text-[10px] px-1.5 border ${p.type === 'Mobile' ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-blue-500/20 text-blue-400 border-blue-500/30'}`}>
                                  {p.type}
                                </Badge>
                              )}
                              {p.isDisconnected && (
                                <Badge className="text-[10px] px-1.5 bg-red-500/20 text-red-400 border-red-500/30 border">Disconnected</Badge>
                              )}
                              {p.carrier && (
                                <span className="text-[10px] text-muted-foreground">{p.carrier}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {(lead as any).skipTracedEmails?.length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Emails</p>
                        <div className="space-y-1.5">
                          {(lead as any).skipTracedEmails.map((email: string, i: number) => (
                            <div key={i} className="text-sm break-all text-muted-foreground hover:text-foreground transition-colors">{email}</div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </Card>

          {/* ── SignalWire Communication Panel ─────────────────────────────── */}
          {/* ── Click-to-Call Modal ── */}
          {callModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setCallModalOpen(false)}>
              <div className="bg-card border border-border rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2">
                    <PhoneCall className="w-5 h-5 text-blue-400" />
                    <h3 className="font-semibold text-base">Call Lead</h3>
                  </div>
                  <button onClick={() => setCallModalOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
                </div>

                {/* Big phone number + copy */}
                <div className="flex items-center gap-2 mb-5 p-3 rounded-xl bg-muted/40 border border-border">
                  <Phone className="w-5 h-5 text-green-400 shrink-0" />
                  <span className="flex-1 font-mono font-semibold text-lg">{lead?.phone}</span>
                  <button
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-xs font-medium transition-colors"
                    onClick={() => {
                      navigator.clipboard.writeText(lead?.phone || "");
                      addNoteMutation.mutate({ id: leadId, data: { content: `📞 Call initiated to ${lead?.phone}` } });
                    }}
                  >
                    <Copy className="w-3.5 h-3.5" /> Copy
                  </button>
                </div>

                <p className="text-xs text-muted-foreground mb-4 text-center">
                  Copy the number and dial it from your phone — or use the bridge below to call with your business caller ID.
                </p>

                {/* Log call outcomes */}
                <div className="mb-5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Log Call Result</p>
                  <div className="grid grid-cols-2 gap-2">
                    {["Answered", "No Answer", "Left Voicemail", "Wrong Number"].map(outcome => (
                      <button
                        key={outcome}
                        className="px-3 py-2 rounded-lg border border-border text-xs hover:bg-muted/60 transition-colors text-left"
                        onClick={() => {
                          addNoteMutation.mutate({ id: leadId, data: { content: `📞 Call to ${lead?.phone} — ${outcome}` } });
                          setCallModalOpen(false);
                        }}
                      >
                        {outcome}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Divider */}
                <div className="flex items-center gap-2 mb-4">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-muted-foreground">bridge via business number</span>
                  <div className="flex-1 h-px bg-border" />
                </div>

                <div className="mb-3">
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Your Personal Cell (SignalWire calls you first)</label>
                  <input
                    type="tel"
                    placeholder="Your cell, e.g. (703) 555-9876"
                    value={agentPhone}
                    onChange={e => {
                      setAgentPhone(e.target.value);
                      const digits = e.target.value.replace(/\D/g, "");
                      const normalized = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : e.target.value;
                      localStorage.setItem("crm_agent_phone", normalized);
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background/50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>
                {callSuccess && <div className="mb-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm">{callSuccess}</div>}
                {callErr && (
                  <div className="mb-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                    {callErr}
                    {callErr.includes("Trial") && (
                      <p className="mt-2 text-yellow-400/90">
                        Fix: In your <strong>SignalWire dashboard</strong>, go to <strong>Phone Numbers → Verified Caller IDs</strong> and verify your personal cell number. Or upgrade your SignalWire Space from Trial.
                      </p>
                    )}
                  </div>
                )}
                <Button
                  className="w-full gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                  disabled={callDialing || !agentPhone.trim()}
                  onClick={initiateClickToCall}
                >
                  {callDialing ? <><Loader2 className="w-4 h-4 animate-spin" /> Ringing your cell...</> : <><PhoneCall className="w-4 h-4" /> Bridge Call (shows business caller ID)</>}
                </Button>
              </div>
            </div>
          )}

          {(isSuperAdmin || campaignData?.dialerEnabled) && <Card className="rounded-2xl border-white/5 bg-card shadow-lg overflow-hidden">
            <div className="bg-secondary/30 p-4 border-b border-border flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Phone className="w-5 h-5 text-blue-400" />
                <h2 className="font-display font-semibold">Dialer & SMS</h2>
                {lead?.phone && (
                  <span className="text-xs text-muted-foreground font-mono">{lead.phone}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* From number selector */}
                {opPhoneNumbers.length > 0 && (
                  <div className="relative">
                    <select
                      value={opSelectedId}
                      onChange={e => setOpSelectedId(e.target.value)}
                      className="h-7 pl-2 pr-7 rounded-lg border border-border bg-background/50 text-xs focus:outline-none focus:ring-1 focus:ring-primary/40 appearance-none"
                    >
                      {opPhoneNumbers.map((n: any) => (
                        <option key={n.id} value={n.id}>
                          {n.number || n.name || n.id}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
                  </div>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1 border-blue-500/40 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                  disabled={!lead?.phone || !opSelectedId}
                  onClick={() => { setCallModalOpen(true); setCallErr(""); setCallSuccess(""); }}
                  title="Call this contact via SignalWire"
                >
                  <PhoneCall className="w-3 h-3" />
                  Call
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={`h-7 text-xs gap-1 transition-colors ${copiedPhone ? "border-green-500/50 text-green-400" : "border-border text-muted-foreground hover:text-foreground"}`}
                  disabled={!lead?.phone}
                  onClick={() => {
                    if (!lead?.phone) return;
                    navigator.clipboard.writeText(lead.phone);
                    setCopiedPhone(true);
                    setTimeout(() => setCopiedPhone(false), 2000);
                  }}
                  title="Copy phone number"
                >
                  {copiedPhone ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copiedPhone ? "Copied!" : "Copy #"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                  disabled={opLoadingMsgs}
                  onClick={refreshOpMessages}
                >
                  <RefreshCw className={`w-3 h-3 ${opLoadingMsgs ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>

            {!lead?.phone ? (
              <div className="p-6 text-center text-muted-foreground text-sm">
                Add a phone number to this contact to enable calling and texting.
              </div>
            ) : opPhoneNumbers.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">
                No phone numbers configured. Add a number in your SignalWire account to enable calling & texting.
              </div>
            ) : (
              <div className="flex flex-col">
                {/* Tabs */}
                <div className="flex border-b border-border">
                  {([
                    { key: "messages", label: "Messages", count: opMessages.length },
                    { key: "calls", label: "Calls", count: opCalls.length },
                  ] as const).map(t => (
                    <button
                      key={t.key}
                      onClick={() => setOpTab(t.key)}
                      className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
                        opTab === t.key
                          ? "border-primary text-primary"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t.label}
                      {t.count > 0 && (
                        <span className="ml-1.5 bg-secondary text-muted-foreground rounded-full px-1.5 py-0.5 text-[10px]">
                          {t.count}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {opError && (
                  <div className="mx-4 mt-3 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                    {opError}
                  </div>
                )}

                {/* Messages tab */}
                {opTab === "messages" && (
                  <>
                    <div className="flex-1 overflow-y-auto max-h-72 p-4 space-y-2">
                      {opLoadingMsgs ? (
                        <div className="text-center py-6 text-muted-foreground text-xs">
                          <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-1" /> Loading messages...
                        </div>
                      ) : opMessages.length === 0 ? (
                        <div className="text-center py-6 text-muted-foreground text-xs">
                          No messages yet with this contact.
                        </div>
                      ) : (
                        [...opMessages].reverse().map((msg: any, i: number) => {
                          const isOutbound = msg.direction === "outgoing";
                          return (
                            <div key={i} className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}>
                              <div className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm ${
                                isOutbound
                                  ? "bg-primary text-primary-foreground rounded-br-sm"
                                  : "bg-secondary text-foreground rounded-bl-sm"
                              }`}>
                                <p>{msg.content || msg.text || msg.body}</p>
                                <p className={`text-[10px] mt-1 ${isOutbound ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                                  {msg.createdAt ? format(new Date(msg.createdAt), "MMM d, h:mm a") : ""}
                                </p>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                    {/* SMS Composer */}
                    <div className="p-4 border-t border-border">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={opSmsContent}
                          onChange={e => setOpSmsContent(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendOpSms(); } }}
                          placeholder={`Text ${lead?.phone || "contact"}...`}
                          className="flex-1 h-9 px-3 rounded-xl border border-border bg-background/50 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                        />
                        <Button
                          size="sm"
                          className="h-9 px-3 gap-1.5"
                          disabled={opSending || !opSmsContent.trim()}
                          onClick={sendOpSms}
                        >
                          {opSending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                          Send
                        </Button>
                      </div>
                    </div>
                  </>
                )}

                {/* Calls tab */}
                {opTab === "calls" && (
                  <div className="max-h-72 overflow-y-auto p-4 space-y-2">
                    {opLoadingMsgs ? (
                      <div className="text-center py-6 text-muted-foreground text-xs">
                        <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-1" /> Loading calls...
                      </div>
                    ) : opCalls.length === 0 ? (
                      <div className="text-center py-6 text-muted-foreground text-xs">
                        No call history with this contact yet.
                      </div>
                    ) : (
                      opCalls.map((call: any, i: number) => {
                        const isOut = call.direction === "outgoing";
                        const dur = call.duration;
                        return (
                          <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-secondary/30 border border-border/50">
                            {isOut
                              ? <PhoneCall className="w-4 h-4 text-green-400 shrink-0" />
                              : <PhoneIncoming className="w-4 h-4 text-blue-400 shrink-0" />
                            }
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium">{isOut ? "Outbound call" : "Inbound call"}</p>
                              <p className="text-xs text-muted-foreground">
                                {call.createdAt ? format(new Date(call.createdAt), "MMM d, yyyy h:mm a") : ""}
                                {dur ? ` · ${Math.floor(dur / 60)}m ${dur % 60}s` : ""}
                              </p>
                            </div>
                            <Badge className={`text-[10px] ${
                              call.status === "completed" ? "bg-green-500/20 text-green-400 border-green-500/30" :
                              call.status === "missed" ? "bg-red-500/20 text-red-400 border-red-500/30" :
                              "bg-secondary text-muted-foreground"
                            } border`}>
                              {call.status || "unknown"}
                            </Badge>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            )}
          </Card>}

          {/* Property Details */}
          <Card className="rounded-2xl border-white/5 bg-card shadow-lg overflow-hidden">
            <div className="bg-secondary/30 p-4 border-b border-border flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Home className="w-5 h-5 text-primary" />
                <h2 className="font-display font-semibold">Property Details</h2>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5 border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                disabled={fetchPropertyMutation.isPending}
                onClick={() => fetchPropertyMutation.mutate({ id: leadId })}
              >
                {fetchPropertyMutation.isPending ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <Database className="w-3 h-3" />
                )}
                {fetchPropertyMutation.isPending ? "Fetching..." : "Fetch Property Data"}
              </Button>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2 md:col-span-3">
                <Label>Street Address</Label>
                <Input
                  className="bg-background/50 rounded-xl"
                  value={formData.address || ""}
                  placeholder="Paste full address or type street only"
                  onChange={e => {
                    const val = e.target.value;
                    const parsed = parseFullAddress(val);
                    if (parsed && (parsed.city || parsed.state || parsed.zip)) {
                      setFormData((f: any) => ({
                        ...f,
                        address: parsed.address || val,
                        ...(parsed.city ? { city: parsed.city } : {}),
                        ...(parsed.state ? { state: parsed.state } : {}),
                        ...(parsed.zip ? { zip: parsed.zip } : {}),
                      }));
                    } else {
                      field("address")(val);
                    }
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>City</Label>
                <Input className="bg-background/50 rounded-xl" value={formData.city || ""} onChange={e => field("city")(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>State</Label>
                <Input className="bg-background/50 rounded-xl" value={formData.state || ""} onChange={e => field("state")(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>ZIP Code</Label>
                <Input className="bg-background/50 rounded-xl" value={formData.zip || ""} onChange={e => field("zip")(e.target.value)} />
              </div>
              <PropertyMap
                address={lead.address}
                city={lead.city ?? undefined}
                state={lead.state ?? undefined}
                zip={lead.zip ?? undefined}
              />
              <div className="space-y-2 md:col-span-3">
                <SelectField label="Property Type" value={formData.propertyType || ""} onChange={field("propertyType")} options={PROPERTY_TYPES} />
              </div>
              <div className="space-y-2">
                <Label>Beds</Label>
                <Input type="number" className="bg-background/50 rounded-xl" value={formData.beds || ""} onChange={e => field("beds")(Number(e.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Baths</Label>
                <Input type="number" step="0.5" className="bg-background/50 rounded-xl" value={formData.baths || ""} onChange={e => field("baths")(Number(e.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Sq Ft</Label>
                <Input type="number" className="bg-background/50 rounded-xl" value={formData.sqft || ""} onChange={e => field("sqft")(Number(e.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Year Built</Label>
                <Input type="number" placeholder="e.g. 1995" className="bg-background/50 rounded-xl" value={(formData as any).yearBuilt || ""} onChange={e => field("yearBuilt")(e.target.value ? Number(e.target.value) : null)} />
              </div>
              <div className="space-y-2">
                <Label>Owner Name</Label>
                <Input className="bg-background/50 rounded-xl" placeholder="Current owner" value={(formData as any).ownerName || ""} onChange={e => field("ownerName")(e.target.value || null)} />
              </div>
              <div className="space-y-2">
                <Label>Last Sale Date</Label>
                <Input className="bg-background/50 rounded-xl" placeholder="e.g. 2022-06-15" value={(formData as any).lastSaleDate || ""} onChange={e => field("lastSaleDate")(e.target.value || null)} />
              </div>
              <div className="space-y-2">
                <Label>Last Sale Price</Label>
                <Input type="number" className="bg-background/50 rounded-xl" placeholder="$0" value={(formData as any).lastSalePrice || ""} onChange={e => field("lastSalePrice")(e.target.value ? Number(e.target.value) : null)} />
              </div>
              <div className="space-y-2">
                <Label>Condition (1–5)</Label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map(v => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => field("condition")(v)}
                      className={`flex-1 h-10 rounded-xl border text-sm font-semibold transition-colors ${formData.condition === v ? "bg-primary text-primary-foreground border-primary" : "border-border bg-background/50 text-muted-foreground hover:bg-secondary"}`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">1 = Poor · 5 = Excellent</p>
              </div>
              <SelectField label="Occupancy" value={formData.occupancy || ""} onChange={field("occupancy")} options={OCCUPANCY_OPTIONS} />
              {isRented && (
                <div className="space-y-2">
                  <Label>Monthly Rental Amount</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input type="number" className="bg-background/50 rounded-xl pl-8" value={formData.rentalAmount || ""} onChange={e => field("rentalAmount")(Number(e.target.value))} />
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Seller Motivation */}
          <Card className="rounded-2xl border-white/5 bg-card shadow-lg overflow-hidden">
            <div className="bg-secondary/30 p-4 border-b border-border flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-primary" />
              <h2 className="font-display font-semibold">Seller Motivation</h2>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <SelectField label="Reason for Selling" value={formData.reasonForSelling || ""} onChange={field("reasonForSelling")} options={REASON_OPTIONS} />
              <SelectField label="How Soon?" value={formData.howSoon || ""} onChange={field("howSoon")} options={HOW_SOON_OPTIONS} />
            </div>
          </Card>

          {/* Comps */}
          <CompsSection leadId={leadId} lead={lead} />

          {/* Unsaved changes indicator + Archive / Delete */}
          <div className="flex gap-3 flex-wrap items-center">
            <div className="flex-1 min-w-[140px] flex items-center gap-2 text-sm text-muted-foreground">
              {isDirty && (
                <><span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse inline-block" /> Unsaved changes</>
              )}
              {!isDirty && (
                <><span className="w-2 h-2 rounded-full bg-green-400 inline-block" /> All changes saved</>
              )}
            </div>
            {canArchive && !lead.archived && (
              <Button
                onClick={() => { if (confirm("Archive this lead? It will be hidden from the main list but can be restored later.")) archiveMutation.mutate(true); }}
                disabled={archiveMutation.isPending}
                variant="outline"
                className="rounded-xl h-12 px-5 border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10"
              >
                <Archive className="w-5 h-5 mr-2" /> Archive
              </Button>
            )}
            {canArchive && lead.archived && (
              <Button
                onClick={() => archiveMutation.mutate(false)}
                disabled={archiveMutation.isPending}
                variant="outline"
                className="rounded-xl h-12 px-5 border-green-500/40 text-green-400 hover:bg-green-500/10"
              >
                <Archive className="w-5 h-5 mr-2" /> Restore
              </Button>
            )}
            {canDeleteLeads && (
              <Button onClick={handleDelete} disabled={deleteMutation.isPending} variant="destructive" className="rounded-xl h-12 px-5 shadow-lg shadow-destructive/20">
                <Trash2 className="w-5 h-5" />
              </Button>
            )}
          </div>
          {lead.archived && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-sm">
              <Archive className="w-4 h-4 flex-shrink-0" />
              <span>This lead is archived and hidden from the main list.{canArchive ? " Click Restore to make it active again." : ""}</span>
            </div>
          )}

          {/* Audit Log */}
          {auditNotes.length > 0 && (
            <Card className="rounded-2xl border-white/5 bg-card shadow-lg overflow-hidden">
              <div className="bg-secondary/30 p-4 border-b border-border flex items-center gap-2">
                <Activity className="w-5 h-5 text-primary" />
                <h2 className="font-display font-semibold">Activity Log</h2>
                <Badge variant="secondary" className="text-xs">{auditNotes.length}</Badge>
              </div>
              <div className="p-4 space-y-2 max-h-60 overflow-y-auto">
                {auditNotes.slice().reverse().map((note: any) => (
                  <div key={note.id} className="flex items-start gap-3 p-2.5 bg-blue-500/5 border border-blue-500/10 rounded-xl">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground leading-relaxed">{note.content}</p>
                      <p className="text-xs text-muted-foreground/60 mt-0.5">{format(new Date(note.createdAt), "MMM d, h:mm a")}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* RIGHT COL */}
        <div className="space-y-6">

          {/* Financials */}
          <Card className="rounded-2xl border-primary/30 bg-card shadow-[0_10px_30px_-10px_rgba(99,102,241,0.15)] overflow-hidden relative">
            <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
              <Calculator className="w-32 h-32 text-primary" />
            </div>
            <div className="bg-gradient-to-r from-primary/10 to-transparent p-4 border-b border-white/5 flex items-center gap-2 relative z-10">
              <DollarSign className="w-5 h-5 text-primary" />
              <h2 className="font-display font-semibold">Financials & MAO</h2>
            </div>
            <div className="p-6 space-y-4 relative z-10">
              {/* Submitted asking price text (read-only, from submission form) */}
              {lead.askingPriceText && (
                <div className="p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-sm">
                  <span className="text-muted-foreground text-xs block mb-0.5">Submitted Asking Price</span>
                  <span className="text-yellow-300 font-medium">{lead.askingPriceText}</span>
                </div>
              )}
              {[
                { label: "Seller Asking Price (Numeric)", key: "askingPrice" },
                { label: "After Repair Value (ARV) — set via comparables below", key: "arv" },
                { label: "Est. Repair Cost (ERC)", key: "estimatedRepairCost" },
                { label: "Current Market Value", key: "currentValue" },
              ].map(({ label, key }) => (
                <div key={key} className="space-y-2">
                  <Label className="text-muted-foreground">{label}</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input type="number" className="bg-background/80 pl-8 rounded-xl border-white/10" value={formData[key] || ""} onChange={e => field(key)(Number(e.target.value))} />
                  </div>
                </div>
              ))}
              <div className="pt-4 border-t border-white/10">
                <div className="flex justify-between items-center mb-1">
                  <Label className="text-primary font-semibold">Max Allowable Offer</Label>
                  <span className="text-xs text-muted-foreground">(ARV × 80%) - ERC</span>
                </div>
                <div className="text-3xl font-display font-bold text-white tracking-tight bg-background/50 p-3 rounded-xl border border-white/5 text-center shadow-inner">
                  {mao > 0 ? fmt$(mao) : "—"}
                </div>
                {mao > 0 && (
                  <div className="mt-3 p-3 rounded-xl bg-background/30 border border-white/5 text-xs space-y-1.5 font-mono">
                    <div className="flex justify-between text-muted-foreground">
                      <span>ARV</span>
                      <span className="text-white">{fmt$(arv ?? 0)}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>× 80%</span>
                      <span className="text-white">{fmt$(Math.round((arv ?? 0) * 0.8))}</span>
                    </div>
                    {Number(formData.estimatedRepairCost) > 0 && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>− ERC</span>
                        <span className="text-red-400">−{fmt$(Number(formData.estimatedRepairCost))}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-white/10 pt-1.5 font-semibold text-primary">
                      <span>= MAO</span>
                      <span>{fmt$(mao)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Card>

          {/* AI Repair Estimator */}
          <AiRepairEstimator
            leadId={leadId}
            onApplied={(total) => {
              field("estimatedRepairCost")(total);
            }}
          />

          {/* AI Deal Scorer */}
          <AiDealScorer leadId={leadId} />

          {/* AI Seller Script */}
          <AiSellerScript leadId={leadId} />

          {/* AI Offer Letter */}
          <AiOfferLetter leadId={leadId} />
          
          {/* Notes */}
          <Card className="rounded-2xl border-white/5 bg-card shadow-lg flex flex-col">
            <div className="bg-secondary/30 p-4 border-b border-border flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-primary" />
              <h2 className="font-display font-semibold">Notes</h2>
              {regularNotes.length > 0 && <Badge variant="secondary" className="text-xs">{regularNotes.length}</Badge>}
            </div>
            <div className="p-4 flex-1 overflow-y-auto space-y-3 max-h-80">
              {regularNotes.length === 0 ? (
                <div className="text-center text-muted-foreground text-sm italic py-4">No notes yet.</div>
              ) : (
                regularNotes.map((note: any) => (
                  <div key={note.id} className="bg-secondary/50 p-3 rounded-xl border border-white/5">
                    <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                      {note.content.split(/(@\w+)/g).map((part: string, i: number) =>
                        part.startsWith("@") ? (
                          <span key={i} className="text-primary font-semibold">{part}</span>
                        ) : part
                      )}
                    </p>
                    <div className="flex justify-between items-center mt-2 text-xs text-muted-foreground">
                      <span className="font-medium">{note.userName}</span>
                      <span>{format(new Date(note.createdAt), "MMM d, h:mm a")}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
            <form onSubmit={handleAddNote} className="p-3 border-t border-border bg-secondary/20 space-y-2">
              <MentionTextarea
                value={newNote}
                onChange={setNewNote}
                users={campaignUsers}
              />
              <div className="flex justify-end">
                <Button type="submit" disabled={addNoteMutation.isPending || !newNote.trim()} size="sm" className="rounded-xl px-4">
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add Note
                </Button>
              </div>
            </form>
          </Card>

          {/* Tasks */}
          <Card className="rounded-2xl border-white/5 bg-card shadow-lg">
            <div className="bg-secondary/30 p-4 border-b border-border flex items-center gap-2">
              <CheckSquare className="w-5 h-5 text-primary" />
              <h2 className="font-display font-semibold">Tasks</h2>
            </div>
            <div className="p-4 space-y-2 max-h-[250px] overflow-y-auto">
              {tasks?.length === 0 ? (
                <div className="text-center text-muted-foreground text-sm italic py-4">No pending tasks.</div>
              ) : (
                tasks?.map((task: any) => (
                  <div key={task.id} className="flex items-start gap-3 p-3 bg-background/50 rounded-xl border border-white/5">
                    <div className={`mt-0.5 w-4 h-4 rounded-full border flex-shrink-0 ${task.status === "completed" ? "bg-primary border-primary" : "border-muted-foreground"}`} />
                    <div>
                      <p className={`text-sm font-medium ${task.status === "completed" ? "line-through text-muted-foreground" : "text-foreground"}`}>{task.title}</p>
                      {task.dueDate && <p className="text-xs text-muted-foreground mt-1 flex items-center"><Clock className="w-3 h-3 mr-1" /> {format(new Date(task.dueDate), "MMM d")}</p>}
                    </div>
                  </div>
                ))
              )}
            </div>
            <form onSubmit={handleAddTask} className="p-3 border-t border-border bg-secondary/20">
              <div className="flex gap-2">
                <Input value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)} placeholder="Add a task..." className="bg-background/80 rounded-xl" />
                <Button type="submit" disabled={addTaskMutation.isPending || !newTaskTitle} size="icon" className="rounded-xl shrink-0">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </form>
          </Card>

          <EmailHistory leadId={leadId} />
        </div>
      </div>

      {/* Zillow + Realtor Lookup — full width at bottom */}
      <ZillowCard
        address={lead.address}
        city={lead.city ?? undefined}
        state={lead.state ?? undefined}
        zip={lead.zip ?? undefined}
      />
    </div>
  );
}
