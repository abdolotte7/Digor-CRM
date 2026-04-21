/**
 * seed-demo.ts
 * Populates the database with a realistic demo campaign + leads for public demos.
 * Safe to re-run — uses upsert logic so it won't duplicate data.
 *
 * Run: pnpm --filter @workspace/api-server seed:demo
 */

import { db } from "@workspace/db";
import {
  crmCampaigns,
  crmUsers,
  crmLeads,
  crmNotes,
  crmTasks,
  crmComps,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";

const DEMO_SLUG = "demo";
const DEMO_EMAIL = "demo@digorva.com";
const DEMO_PASSWORD = "Demo2026!";

// ── Fake leads (no real PII — all fictional) ─────────────────────────────────
const FAKE_LEADS = [
  {
    sellerName: "James Morrison",
    phone: "216-555-0101",
    email: "jmorrison.demo@example.com",
    address: "1453 W 107th St",
    city: "Cleveland",
    state: "OH",
    zip: "44102",
    propertyType: "Single Family",
    beds: 3,
    baths: "1.5",
    sqft: 1240,
    yearBuilt: 1958,
    condition: 2,
    arv: "185000",
    estimatedRepairCost: "28000",
    mao: "120000",
    askingPrice: "145000",
    reasonForSelling: "Divorce",
    howSoon: "ASAP",
    status: "contacted",
    notes: "Very motivated — divorce finalized next month. Open to cash offer.",
    leadSource: "Direct Mail",
  },
  {
    sellerName: "Patricia Hayes",
    phone: "313-555-0142",
    email: "p.hayes.demo@example.com",
    address: "8820 Gratiot Ave",
    city: "Detroit",
    state: "MI",
    zip: "48213",
    propertyType: "Single Family",
    beds: 4,
    baths: "2.0",
    sqft: 1680,
    yearBuilt: 1945,
    condition: 1,
    arv: "145000",
    estimatedRepairCost: "55000",
    mao: "61000",
    askingPrice: "75000",
    reasonForSelling: "Inherited Property",
    howSoon: "Within 60 days",
    status: "offer_made",
    notes: "Inherited from mother. Property vacant 2 years. Roof needs full replacement.",
    leadSource: "Cold Call",
  },
  {
    sellerName: "Robert Collins",
    phone: "404-555-0193",
    email: "rcollins.demo@example.com",
    address: "342 Glenwood Ave SE",
    city: "Atlanta",
    state: "GA",
    zip: "30312",
    propertyType: "Multi Family",
    beds: 6,
    baths: "3.0",
    sqft: 2800,
    yearBuilt: 1965,
    condition: 3,
    isRental: true,
    rentalAmount: "2400",
    arv: "420000",
    estimatedRepairCost: "18000",
    mao: "318000",
    askingPrice: "375000",
    reasonForSelling: "Tired Landlord",
    howSoon: "Within 90 days",
    status: "new",
    notes: "Duplex with 2 long-term tenants. Owner self-manages and burned out.",
    leadSource: "Driving for Dollars",
  },
  {
    sellerName: "Sandra Mitchell",
    phone: "901-555-0167",
    email: "s.mitchell.demo@example.com",
    address: "1108 Nelson Ave",
    city: "Memphis",
    state: "TN",
    zip: "38107",
    propertyType: "Single Family",
    beds: 3,
    baths: "1.0",
    sqft: 980,
    yearBuilt: 1952,
    condition: 2,
    arv: "128000",
    estimatedRepairCost: "32000",
    mao: "70400",
    askingPrice: "85000",
    reasonForSelling: "Job Relocation",
    howSoon: "Within 30 days",
    status: "under_contract",
    notes: "Signed PSA at $72k. Inspection scheduled Friday. Title opened.",
    leadSource: "Google Ads",
  },
  {
    sellerName: "Michael Turner",
    phone: "216-555-0231",
    email: "mturner.demo@example.com",
    address: "3710 E 131st St",
    city: "Cleveland",
    state: "OH",
    zip: "44120",
    propertyType: "Single Family",
    beds: 3,
    baths: "1.5",
    sqft: 1320,
    yearBuilt: 1960,
    condition: 3,
    arv: "210000",
    estimatedRepairCost: "14000",
    mao: "154000",
    askingPrice: "170000",
    reasonForSelling: "Downsizing",
    howSoon: "Within 90 days",
    status: "new",
    notes: "Kids moved out, wants smaller place. Not urgent but price is firm.",
    leadSource: "Facebook Ads",
  },
  {
    sellerName: "Linda Foster",
    phone: "412-555-0288",
    email: "lfoster.demo@example.com",
    address: "2241 Perrysville Ave",
    city: "Pittsburgh",
    state: "PA",
    zip: "15214",
    propertyType: "Single Family",
    beds: 4,
    baths: "2.0",
    sqft: 1870,
    yearBuilt: 1940,
    condition: 2,
    arv: "195000",
    estimatedRepairCost: "42000",
    mao: "114000",
    askingPrice: "130000",
    reasonForSelling: "Financial Hardship",
    howSoon: "ASAP",
    status: "contacted",
    notes: "Behind on mortgage by 4 months. Pre-foreclosure filing imminent.",
    leadSource: "Pre-Foreclosure List",
  },
  {
    sellerName: "David Nguyen",
    phone: "713-555-0345",
    email: "d.nguyen.demo@example.com",
    address: "7840 Westheimer Rd",
    city: "Houston",
    state: "TX",
    zip: "77063",
    propertyType: "Single Family",
    beds: 3,
    baths: "2.0",
    sqft: 1560,
    yearBuilt: 1978,
    condition: 4,
    arv: "285000",
    estimatedRepairCost: "8000",
    mao: "220000",
    askingPrice: "235000",
    reasonForSelling: "Moving Out of State",
    howSoon: "Within 60 days",
    status: "new",
    notes: "Clean property, just dated finishes. Moving to Austin for new job.",
    leadSource: "Zillow FSBO",
  },
  {
    sellerName: "Barbara King",
    phone: "314-555-0412",
    email: "bking.demo@example.com",
    address: "4523 Natural Bridge Ave",
    city: "St. Louis",
    state: "MO",
    zip: "63115",
    propertyType: "Single Family",
    beds: 2,
    baths: "1.0",
    sqft: 860,
    yearBuilt: 1948,
    condition: 1,
    arv: "95000",
    estimatedRepairCost: "38000",
    mao: "38000",
    askingPrice: "55000",
    reasonForSelling: "Inherited Property",
    howSoon: "ASAP",
    status: "offer_made",
    notes: "Estate sale. Executor wants it gone. Very flexible on terms.",
    leadSource: "Probate List",
  },
  {
    sellerName: "Charles Bennett",
    phone: "216-555-0489",
    email: "cbennett.demo@example.com",
    address: "18809 Brick Store Rd",
    city: "Hampstead",
    state: "MD",
    zip: "21074",
    propertyType: "Single Family",
    beds: 4,
    baths: "2.5",
    sqft: 2200,
    yearBuilt: 1992,
    condition: 3,
    arv: "523563",
    estimatedRepairCost: "0",
    mao: "418850",
    askingPrice: "495000",
    reasonForSelling: "Estate Sale",
    howSoon: "Within 60 days",
    status: "closed",
    notes: "CLOSED at $422,000. Assigned to buyer Marcus Realty Group. Net spread $4,150.",
    leadSource: "Direct Mail",
  },
  {
    sellerName: "Jennifer Walsh",
    phone: "502-555-0521",
    email: "jwalsh.demo@example.com",
    address: "936 S 28th St",
    city: "Louisville",
    state: "KY",
    zip: "40211",
    propertyType: "Single Family",
    beds: 3,
    baths: "1.5",
    sqft: 1140,
    yearBuilt: 1955,
    condition: 2,
    arv: "162000",
    estimatedRepairCost: "24000",
    mao: "105600",
    askingPrice: "118000",
    reasonForSelling: "Divorce",
    howSoon: "Within 30 days",
    status: "contacted",
    notes: "Second call went well. Husband needs quick close for legal settlement.",
    leadSource: "Cold Call",
  },
  {
    sellerName: "Thomas Graham",
    phone: "216-555-0577",
    email: "tgraham.demo@example.com",
    address: "12201 Harvard Ave",
    city: "Cleveland",
    state: "OH",
    zip: "44105",
    propertyType: "Single Family",
    beds: 3,
    baths: "1.0",
    sqft: 1050,
    yearBuilt: 1962,
    condition: 2,
    arv: "155000",
    estimatedRepairCost: "19500",
    mao: "104500",
    askingPrice: "98000",
    reasonForSelling: "Tired Landlord",
    howSoon: "Within 90 days",
    status: "new",
    notes: "Tenant moved out after 7 years. Owner doesn't want to fix it up.",
    leadSource: "Facebook Ads",
  },
  {
    sellerName: "Angela Ross",
    phone: "901-555-0634",
    email: "aross.demo@example.com",
    address: "2750 Lamar Ave",
    city: "Memphis",
    state: "TN",
    zip: "38114",
    propertyType: "Single Family",
    beds: 3,
    baths: "1.0",
    sqft: 1020,
    yearBuilt: 1950,
    condition: 1,
    arv: "118000",
    estimatedRepairCost: "47000",
    mao: "47400",
    askingPrice: "65000",
    reasonForSelling: "Financial Hardship",
    howSoon: "ASAP",
    status: "lost",
    notes: "Lost — seller went with another buyer offering $68k cash, faster close.",
    leadSource: "Tax Delinquent List",
  },
  {
    sellerName: "Kevin Simmons",
    phone: "313-555-0689",
    email: "ksimmons.demo@example.com",
    address: "5419 Nottingham Dr",
    city: "Detroit",
    state: "MI",
    zip: "48224",
    propertyType: "Multi Family",
    beds: 4,
    baths: "2.0",
    sqft: 2100,
    yearBuilt: 1958,
    condition: 2,
    isRental: true,
    rentalAmount: "1800",
    arv: "248000",
    estimatedRepairCost: "35000",
    mao: "163400",
    askingPrice: "185000",
    reasonForSelling: "Tired Landlord",
    howSoon: "Within 90 days",
    status: "new",
    notes: "One unit occupied, one vacant. Wants to retire and liquidate.",
    leadSource: "Driving for Dollars",
  },
  {
    sellerName: "Michelle Carter",
    phone: "404-555-0745",
    email: "mcarter.demo@example.com",
    address: "701 Whitehall St SW",
    city: "Atlanta",
    state: "GA",
    zip: "30303",
    propertyType: "Condo",
    beds: 2,
    baths: "2.0",
    sqft: 1100,
    yearBuilt: 2002,
    condition: 4,
    arv: "275000",
    estimatedRepairCost: "5000",
    mao: "215000",
    askingPrice: "240000",
    reasonForSelling: "Job Relocation",
    howSoon: "Within 30 days",
    status: "offer_made",
    notes: "Sent offer at $218k. Seller countered at $228k. Negotiating.",
    leadSource: "Google Ads",
  },
  {
    sellerName: "Gary Henderson",
    phone: "713-555-0801",
    email: "ghenderson.demo@example.com",
    address: "3211 Almeda Rd",
    city: "Houston",
    state: "TX",
    zip: "77004",
    propertyType: "Single Family",
    beds: 3,
    baths: "1.5",
    sqft: 1380,
    yearBuilt: 1965,
    condition: 2,
    arv: "320000",
    estimatedRepairCost: "28000",
    mao: "228000",
    askingPrice: "245000",
    reasonForSelling: "Downsizing",
    howSoon: "Within 60 days",
    status: "contacted",
    notes: "Widow, children live out of state. Wants simple close with no hassle.",
    leadSource: "Direct Mail",
  },
];

// ── Notes per lead (realistic call logs / activity) ───────────────────────────
const LEAD_NOTES: Record<number, string[]> = {
  0: [
    "Initial contact — answered on 3rd ring. Very open to talking.",
    "Follow-up call. Confirmed divorce is finalized April 30. Wants cash close.",
    "Sent comps via email. ARV confirmed at $185k. Preparing written offer.",
  ],
  1: [
    "First contact. Inherited house from mother in 2022, never lived there.",
    "Second call — sent offer letter at $62,000. Waiting on response.",
  ],
  3: [
    "Signed PSA at $72k on 4/12.",
    "Inspection completed — minor plumbing issues found, credit of $1,500 agreed.",
    "Title search clear. Closing scheduled for May 3.",
  ],
  5: [
    "Called via skip trace. Confirmed pre-foreclosure notice received.",
    "Explained cash offer and quick close timeline. She was relieved.",
    "Sent written offer at $115,000. Awaiting signed acceptance.",
  ],
  8: [
    "Deal closed April 9. Buyer: Marcus Realty Group.",
    "Assignment fee collected: $4,150. Great first deal for this campaign.",
  ],
};

async function run() {
  console.log("🌱 Starting demo seed...");

  // ── 1. Upsert demo campaign ─────────────────────────────────────────────────
  let [campaign] = await db
    .select()
    .from(crmCampaigns)
    .where(eq(crmCampaigns.slug, DEMO_SLUG))
    .limit(1);

  if (!campaign) {
    [campaign] = await db
      .insert(crmCampaigns)
      .values({
        name: "Digor Demo",
        slug: DEMO_SLUG,
        active: true,
        skipTraceDailyLimit: 999,
        fetchCompsDailyLimit: 999,
      })
      .returning();
    console.log("  ✓ Created demo campaign");
  } else {
    console.log("  · Demo campaign already exists");
  }

  // ── 2. Upsert demo user ─────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  let [demoUser] = await db
    .select()
    .from(crmUsers)
    .where(eq(crmUsers.email, DEMO_EMAIL))
    .limit(1);

  if (!demoUser) {
    [demoUser] = await db
      .insert(crmUsers)
      .values({
        name: "Demo User",
        email: DEMO_EMAIL,
        passwordHash,
        role: "admin",
        status: "active",
        campaignId: campaign.id,
      })
      .returning();
    console.log(`  ✓ Created demo user: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  } else {
    await db
      .update(crmUsers)
      .set({ passwordHash, campaignId: campaign.id, status: "active" })
      .where(eq(crmUsers.email, DEMO_EMAIL));
    console.log(`  · Demo user already exists — password reset to: ${DEMO_PASSWORD}`);
    [demoUser] = await db.select().from(crmUsers).where(eq(crmUsers.email, DEMO_EMAIL)).limit(1);
  }

  // ── 3. Seed leads (skip if campaign already has leads) ─────────────────────
  const existingLeads = await db
    .select({ id: crmLeads.id })
    .from(crmLeads)
    .where(eq(crmLeads.campaignId, campaign.id));

  if (existingLeads.length > 0) {
    console.log(`  · ${existingLeads.length} leads already exist — skipping lead seed`);
    console.log("\n✅ Demo seed complete (no changes needed).");
    console.log(`   Login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
    process.exit(0);
  }

  const insertedLeadIds: number[] = [];

  for (const lead of FAKE_LEADS) {
    const [inserted] = await db
      .insert(crmLeads)
      .values({
        campaignId: campaign.id,
        sellerName: lead.sellerName,
        phone: lead.phone,
        email: lead.email,
        address: lead.address,
        city: lead.city,
        state: lead.state,
        zip: lead.zip,
        propertyType: lead.propertyType,
        beds: lead.beds,
        baths: lead.baths,
        sqft: lead.sqft,
        yearBuilt: lead.yearBuilt,
        condition: lead.condition,
        arv: lead.arv,
        estimatedRepairCost: lead.estimatedRepairCost,
        mao: lead.mao,
        askingPrice: lead.askingPrice,
        isRental: lead.isRental ?? false,
        rentalAmount: lead.rentalAmount,
        reasonForSelling: lead.reasonForSelling,
        howSoon: lead.howSoon,
        status: lead.status,
        leadSource: lead.leadSource,
        assignedTo: demoUser.id,
      })
      .returning({ id: crmLeads.id });

    insertedLeadIds.push(inserted.id);
  }

  console.log(`  ✓ Inserted ${insertedLeadIds.length} demo leads`);

  // ── 4. Seed notes ──────────────────────────────────────────────────────────
  let noteCount = 0;
  for (const [leadIndex, noteTexts] of Object.entries(LEAD_NOTES)) {
    const leadId = insertedLeadIds[parseInt(leadIndex)];
    if (!leadId) continue;
    for (const content of noteTexts) {
      await db.insert(crmNotes).values({
        leadId,
        userId: demoUser.id,
        content,
        noteType: "call",
      });
      noteCount++;
    }
  }

  console.log(`  ✓ Inserted ${noteCount} activity notes`);

  // ── 5. Seed tasks ──────────────────────────────────────────────────────────
  const tasks = [
    { leadIdx: 0, title: "Send written offer letter", dueInDays: 1 },
    { leadIdx: 1, title: "Follow up on $62k offer — no response after 3 days", dueInDays: 0 },
    { leadIdx: 2, title: "Run comps and calculate ARV", dueInDays: 2 },
    { leadIdx: 4, title: "Pull comps and prepare offer", dueInDays: 3 },
    { leadIdx: 5, title: "Check for signed acceptance on $115k offer", dueInDays: 0 },
    { leadIdx: 13, title: "Counteroffer at $222k — final walkthrough price", dueInDays: 1 },
    { leadIdx: 14, title: "Schedule property walkthrough", dueInDays: 5 },
  ];

  for (const t of tasks) {
    const leadId = insertedLeadIds[t.leadIdx];
    if (!leadId) continue;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + t.dueInDays);
    await db.insert(crmTasks).values({
      leadId,
      campaignId: campaign.id,
      assignedTo: demoUser.id,
      title: t.title,
      dueDate,
      status: "pending",
    });
  }

  console.log(`  ✓ Inserted ${tasks.length} demo tasks`);

  // ── 6. Seed comps for the closed deal ─────────────────────────────────────
  const closedLeadId = insertedLeadIds[8]; // Charles Bennett / Hampstead MD
  if (closedLeadId) {
    const comps = [
      { address: "18819 BRICK STORE RD, HAMPSTEAD, MD", salePrice: "430000", beds: 0, baths: "2", sqft: 2363, adjustedPrice: "387050", distanceMiles: "0.05" },
      { address: "18816 BRICK STORE RD, HAMPSTEAD, MD", salePrice: "510000", beds: 0, baths: "4", sqft: 2264, adjustedPrice: "455650", distanceMiles: "0.07" },
      { address: "4615 BECKLEYSVILLE RD, HAMPSTEAD, MD", salePrice: "867000", beds: 0, baths: "6", sqft: 4516, adjustedPrice: "697650", distanceMiles: "0.14" },
      { address: "18738 UPPER BECKLEYSVILLE RD, HAMPSTEAD, MD", salePrice: "749615", beds: 0, baths: "2.5", sqft: 3374, adjustedPrice: "645615", distanceMiles: "0.17" },
      { address: "4515 BECKLEYSVILLE RD, HAMPSTEAD, MD", salePrice: "449900", beds: 0, baths: "2", sqft: 1940, adjustedPrice: "431850", distanceMiles: "0.19" },
    ];

    for (const comp of comps) {
      await db.insert(crmComps).values({
        leadId: closedLeadId,
        address: comp.address,
        salePrice: comp.salePrice,
        beds: comp.beds,
        baths: comp.baths,
        sqft: comp.sqft,
        adjustedPrice: comp.adjustedPrice,
        distanceMiles: comp.distanceMiles,
        saleDate: "2024-09-15",
      });
    }

    console.log(`  ✓ Inserted 5 comps for closed lead`);
  }

  console.log("\n✅ Demo seed complete!");
  console.log(`   Campaign: Digor Demo (slug: ${DEMO_SLUG})`);
  console.log(`   Login:    ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  process.exit(0);
}

run().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
