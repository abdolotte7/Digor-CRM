import { Router } from "express";
import { db } from "@workspace/db";
import { crmLeads, crmUsers, crmNotes, crmTasks, crmCampaigns, crmLeadFollowers, crmNotifications, crmComps } from "@workspace/db/schema";
import { eq, desc, ilike, and, or, sql, ne } from "drizzle-orm";
import { crmAuth, crmAdminOnly } from "./middleware";
import { onLeadCreated, onLeadStatusChanged } from "../../services/automation";
import { fetchPropertyData, checkCooldown, recordFetch, runSkipTrace, checkSkipTraceCooldown, recordSkipTrace, getLastSkipTraceError, calculateAdjustedComp, calculateArvFromComps, checkFetchCompsCooldown, recordFetchComps } from "../../services/propertyApi";
import { geocodeViaAttom, fetchCompsViaAttom, hasAttomKey } from "../../services/attomApi";

// ─── In-memory comps job store ────────────────────────────────────────────────
interface CompsJob {
  leadId: number;
  apiKey: string;
  exportToken: string;
  count: number;
  actualRadius: number;
  requestedRadius: number;
  startedAt: number;
  subjectProp: { beds: number | null; baths: number | null; sqft: number | null; yearBuilt: number | null };
  campaignId: number;
}
const compsJobs = new Map<string, CompsJob>();
// Clean up jobs older than 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [token, job] of compsJobs) {
    if (job.startedAt < cutoff) compsJobs.delete(token);
  }
}, 60_000);

const router = Router();

function parseMoney(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function formatLeadSummary(lead: any, assignedUser?: any, campaignName?: string | null) {
  return {
    id: lead.id,
    campaignId: lead.campaignId,
    campaignName: campaignName ?? null,
    sellerName: lead.sellerName,
    phone: lead.phone,
    email: lead.email,
    leadSource: lead.leadSource,
    address: lead.address,
    city: lead.city,
    state: lead.state,
    zip: lead.zip,
    propertyType: lead.propertyType,
    beds: lead.beds,
    baths: lead.baths ? parseFloat(lead.baths) : null,
    sqft: lead.sqft,
    condition: lead.condition,
    occupancy: lead.occupancy,
    isRental: lead.isRental ?? false,
    rentalAmount: lead.rentalAmount ? parseFloat(lead.rentalAmount) : null,
    askingPrice: lead.askingPrice ? parseFloat(lead.askingPrice) : null,
    askingPriceText: lead.askingPriceText ?? null,
    currentValue: lead.currentValue ? parseFloat(lead.currentValue) : null,
    estimatedRepairCost: lead.estimatedRepairCost ? parseFloat(lead.estimatedRepairCost) : null,
    arv: lead.arv ? parseFloat(lead.arv) : null,
    mao: lead.mao ? parseFloat(lead.mao) : null,
    status: lead.status,
    archived: lead.archived ?? false,
    archivedAt: lead.archivedAt ? lead.archivedAt.toISOString() : null,
    assignedTo: lead.assignedTo,
    assignedToName: assignedUser?.name || null,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
  };
}

function formatLead(lead: any, assignedUser?: any, campaignName?: string | null) {
  return {
    ...formatLeadSummary(lead, assignedUser, campaignName),
    notes: lead.notes,
    reasonForSelling: lead.reasonForSelling,
    howSoon: lead.howSoon,
    ownerName: lead.ownerName,
    yearBuilt: lead.yearBuilt,
    lastSaleDate: lead.lastSaleDate,
    lastSalePrice: lead.lastSalePrice ? parseFloat(lead.lastSalePrice) : null,
    skipTracedPhones: lead.skipTracedPhones ? JSON.parse(lead.skipTracedPhones) : [],
    skipTracedEmails: lead.skipTracedEmails ? JSON.parse(lead.skipTracedEmails) : [],
    skipTracedName: lead.skipTracedName ?? null,
  };
}

function getCampaignCondition(crmUser: any) {
  if (crmUser.role === "super_admin") return null;
  if (crmUser.campaignId) return eq(crmLeads.campaignId, crmUser.campaignId);
  return null;
}

// Field labels for audit log
const FIELD_LABELS: Record<string, string> = {
  sellerName: "Seller Name",
  phone: "Phone",
  email: "Email",
  leadSource: "Lead Source",
  address: "Address",
  city: "City",
  state: "State",
  zip: "ZIP",
  propertyType: "Property Type",
  status: "Status",
  occupancy: "Occupancy",
  isRental: "Rental Property",
  rentalAmount: "Monthly Rental Amount",
  reasonForSelling: "Reason for Selling",
  howSoon: "How Soon",
  beds: "Beds",
  baths: "Baths",
  sqft: "Sq Ft",
  condition: "Condition",
  askingPrice: "Asking Price",
  currentValue: "Current Value",
  estimatedRepairCost: "Estimated Repair Cost",
  arv: "ARV",
  assignedTo: "Assigned To",
};

function formatFieldValue(field: string, value: any): string {
  if (value === null || value === undefined || value === "") return "(empty)";
  if (field === "isRental") return value ? "Yes" : "No";
  if (["askingPrice","currentValue","estimatedRepairCost","arv","mao","rentalAmount"].includes(field)) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value));
  }
  return String(value);
}

// Notify all followers of a lead
async function notifyFollowers(leadId: number, excludeUserId: number, content: string, type = "update") {
  try {
    const followers = await db.select().from(crmLeadFollowers).where(
      and(eq(crmLeadFollowers.leadId, leadId), ne(crmLeadFollowers.userId, excludeUserId))
    );
    if (followers.length === 0) return;
    await db.insert(crmNotifications).values(
      followers.map(f => ({ userId: f.userId, leadId, type, content, read: false }))
    );
  } catch (_) {}
}

router.get("/", crmAuth, async (req, res) => {
  const { status, search, page = "1", limit = "20", archived } = req.query as any;
  const crmUser = (req as any).crmUser;
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const offset = (pageNum - 1) * limitNum;

  try {
    const conditions: any[] = [];
    const campaignCond = getCampaignCondition(crmUser);
    if (campaignCond) conditions.push(campaignCond);
    // By default hide archived leads; pass ?archived=true to show only archived
    if (archived === "true") {
      conditions.push(eq(crmLeads.archived, true));
    } else {
      conditions.push(eq(crmLeads.archived, false));
    }
    if (status) conditions.push(eq(crmLeads.status, status));
    if (search) {
      conditions.push(or(
        ilike(crmLeads.sellerName, `%${search}%`),
        ilike(crmLeads.address, `%${search}%`),
        ilike(crmLeads.phone, `%${search}%`),
        ilike(crmLeads.email, `%${search}%`),
      ));
    }
    if (crmUser.role === "va") {
      conditions.push(eq(crmLeads.assignedTo, crmUser.userId));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [leads, [{ count }]] = await Promise.all([
      db.select().from(crmLeads).where(where).orderBy(desc(crmLeads.createdAt)).limit(limitNum).offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(crmLeads).where(where),
    ]);

    const userIds = [...new Set(leads.map(l => l.assignedTo).filter(Boolean))];
    let usersMap: Record<number, string> = {};
    if (userIds.length > 0) {
      const users = await db.select({ id: crmUsers.id, name: crmUsers.name }).from(crmUsers);
      usersMap = Object.fromEntries(users.map(u => [u.id, u.name]));
    }

    // For super admin: fetch campaign names
    let campaignsMap: Record<number, string> = {};
    if (crmUser.role === "super_admin") {
      const camps = await db.select({ id: crmCampaigns.id, name: crmCampaigns.name }).from(crmCampaigns);
      campaignsMap = Object.fromEntries(camps.map(c => [c.id, c.name]));
    }

    res.json({
      leads: leads.map(l => formatLeadSummary(l, l.assignedTo ? { name: usersMap[l.assignedTo!] } : null, l.campaignId ? campaignsMap[l.campaignId] : null)),
      total: count,
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    console.error("CRM get leads error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", crmAuth, async (req, res) => {
  const crmUser = (req as any).crmUser;
  if (crmUser.role === "va") {
    res.status(403).json({ error: "VAs cannot create leads directly" });
    return;
  }
  const campaignId = crmUser.campaignId ?? (req.body.campaignId ? parseInt(req.body.campaignId) : null);
  if (!campaignId && crmUser.role !== "super_admin") {
    res.status(400).json({ error: "Campaign is required" });
    return;
  }
  try {
    const data = req.body;
    const arv = parseMoney(data.arv);
    const erc = parseMoney(data.estimatedRepairCost);
    const mao = arv !== null && erc !== null ? arv * 0.80 - erc : parseMoney(data.mao);

    const [lead] = await db.insert(crmLeads).values({
      campaignId: campaignId || (data.campaignId ? parseInt(data.campaignId) : null),
      sellerName: data.sellerName,
      phone: data.phone || null,
      email: data.email || null,
      leadSource: data.leadSource || null,
      address: data.address,
      city: data.city || null,
      state: data.state || null,
      zip: data.zip || null,
      propertyType: data.propertyType || null,
      beds: data.beds ? parseInt(data.beds) : null,
      baths: data.baths ? data.baths.toString() : null,
      sqft: data.sqft ? parseInt(data.sqft) : null,
      condition: data.condition ? parseInt(data.condition) : null,
      occupancy: data.occupancy || null,
      isRental: data.isRental ?? false,
      rentalAmount: parseMoney(data.rentalAmount)?.toString() || null,
      reasonForSelling: data.reasonForSelling || null,
      howSoon: data.howSoon || null,
      askingPrice: parseMoney(data.askingPrice)?.toString() || null,
      currentValue: parseMoney(data.currentValue)?.toString() || null,
      estimatedRepairCost: erc?.toString() || null,
      arv: arv?.toString() || null,
      mao: mao?.toString() || null,
      notes: data.notes || null,
      status: data.status || "new",
      assignedTo: data.assignedTo || null,
    }).returning();
    // Fire automation: auto-task creation, email notifications, in-app notifications
    if (lead.campaignId) {
      const [actorUser] = await db.select({ name: crmUsers.name }).from(crmUsers).where(eq(crmUsers.id, crmUser.userId)).limit(1);
      onLeadCreated({
        leadId: lead.id,
        address: lead.address,
        campaignId: lead.campaignId,
        actorUserId: crmUser.userId,
        actorName: actorUser?.name || "A team member",
      }).catch(e => console.error("automation.onLeadCreated error:", e));
    }
    res.status(201).json(formatLead(lead));
  } catch (err) {
    console.error("CRM create lead error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", crmAuth, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const crmUser = (req as any).crmUser;
  try {
    const [lead] = await db.select().from(crmLeads).where(eq(crmLeads.id, id)).limit(1);
    if (!lead) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }
    // Enforce campaign isolation
    if (crmUser.role !== "super_admin" && lead.campaignId !== crmUser.campaignId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const [notes, tasks, followers, assignedUserRow] = await Promise.all([
      db.select({
        id: crmNotes.id, leadId: crmNotes.leadId, userId: crmNotes.userId,
        content: crmNotes.content, noteType: crmNotes.noteType, createdAt: crmNotes.createdAt, userName: crmUsers.name,
      }).from(crmNotes).leftJoin(crmUsers, eq(crmNotes.userId, crmUsers.id)).where(eq(crmNotes.leadId, id)).orderBy(crmNotes.createdAt),
      db.select({
        id: crmTasks.id, leadId: crmTasks.leadId, assignedTo: crmTasks.assignedTo,
        title: crmTasks.title, description: crmTasks.description, dueDate: crmTasks.dueDate,
        status: crmTasks.status, createdAt: crmTasks.createdAt, assignedToName: crmUsers.name,
      }).from(crmTasks).leftJoin(crmUsers, eq(crmTasks.assignedTo, crmUsers.id)).where(eq(crmTasks.leadId, id)).orderBy(crmTasks.dueDate),
      db.select().from(crmLeadFollowers).where(eq(crmLeadFollowers.leadId, id)),
      lead.assignedTo
        ? db.select().from(crmUsers).where(eq(crmUsers.id, lead.assignedTo)).limit(1).then(r => r[0] ?? null)
        : Promise.resolve(null),
    ]);

    const assignedUser = assignedUserRow;

    const isFollowing = followers.some(f => f.userId === crmUser.userId);

    res.json({
      ...formatLead(lead, assignedUser),
      notes: notes.map(n => ({
        id: n.id, leadId: n.leadId, userId: n.userId, userName: n.userName || "Unknown",
        content: n.content, noteType: n.noteType || "note", createdAt: n.createdAt.toISOString(),
      })),
      tasks: tasks.map(t => ({
        id: t.id, leadId: t.leadId, assignedTo: t.assignedTo, assignedToName: t.assignedToName || null,
        title: t.title, description: t.description, dueDate: t.dueDate ? t.dueDate.toISOString() : null,
        status: t.status, createdAt: t.createdAt.toISOString(), leadAddress: lead.address,
      })),
      followerCount: followers.length,
      isFollowing,
    });
  } catch (err) {
    console.error("CRM get lead error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /:id/full — lead + comps in a single round-trip (used by LeadDetail page)
router.get("/:id/full", crmAuth, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const crmUser = (req as any).crmUser;
  try {
    const [lead] = await db.select().from(crmLeads).where(eq(crmLeads.id, id)).limit(1);
    if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
    if (crmUser.role !== "super_admin" && lead.campaignId !== crmUser.campaignId) {
      res.status(403).json({ error: "Access denied" }); return;
    }

    const [notes, tasks, followers, assignedUserRow, comps] = await Promise.all([
      db.select({
        id: crmNotes.id, leadId: crmNotes.leadId, userId: crmNotes.userId,
        content: crmNotes.content, noteType: crmNotes.noteType, createdAt: crmNotes.createdAt, userName: crmUsers.name,
      }).from(crmNotes).leftJoin(crmUsers, eq(crmNotes.userId, crmUsers.id)).where(eq(crmNotes.leadId, id)).orderBy(crmNotes.createdAt),
      db.select({
        id: crmTasks.id, leadId: crmTasks.leadId, assignedTo: crmTasks.assignedTo,
        title: crmTasks.title, description: crmTasks.description, dueDate: crmTasks.dueDate,
        status: crmTasks.status, createdAt: crmTasks.createdAt, assignedToName: crmUsers.name,
      }).from(crmTasks).leftJoin(crmUsers, eq(crmTasks.assignedTo, crmUsers.id)).where(eq(crmTasks.leadId, id)).orderBy(crmTasks.dueDate),
      db.select().from(crmLeadFollowers).where(eq(crmLeadFollowers.leadId, id)),
      lead.assignedTo
        ? db.select().from(crmUsers).where(eq(crmUsers.id, lead.assignedTo)).limit(1).then(r => r[0] ?? null)
        : Promise.resolve(null),
      db.select().from(crmComps).where(eq(crmComps.leadId, id)).orderBy(desc(crmComps.createdAt)),
    ]);

    const isFollowing = followers.some(f => f.userId === crmUser.userId);

    res.json({
      ...formatLead(lead, assignedUserRow),
      notes: notes.map(n => ({
        id: n.id, leadId: n.leadId, userId: n.userId, userName: n.userName || "Unknown",
        content: n.content, noteType: n.noteType || "note", createdAt: n.createdAt.toISOString(),
      })),
      tasks: tasks.map(t => ({
        id: t.id, leadId: t.leadId, assignedTo: t.assignedTo, assignedToName: t.assignedToName || null,
        title: t.title, description: t.description, dueDate: t.dueDate ? t.dueDate.toISOString() : null,
        status: t.status, createdAt: t.createdAt.toISOString(), leadAddress: lead.address,
      })),
      followerCount: followers.length,
      isFollowing,
      comps: comps.map(c => ({
        id: c.id, leadId: c.leadId, address: c.address, beds: c.beds,
        baths: c.baths ? parseFloat(c.baths) : null, sqft: c.sqft, yearBuilt: c.yearBuilt,
        salePrice: c.salePrice ? parseFloat(c.salePrice) : null,
        adjustedPrice: c.adjustedPrice ? parseFloat(c.adjustedPrice) : null,
        soldDate: c.soldDate, notes: c.notes, source: c.source || "manual",
        pricePerSqft: c.sqft && c.salePrice ? Math.round(parseFloat(c.salePrice) / c.sqft) : null,
        createdAt: c.createdAt,
      })),
    });
  } catch (err) {
    console.error("CRM get lead full error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", crmAuth, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const crmUser = (req as any).crmUser;
  try {
    const [existing] = await db.select().from(crmLeads).where(eq(crmLeads.id, id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }
    if (crmUser.role !== "super_admin" && existing.campaignId !== crmUser.campaignId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    if (crmUser.role === "va" && existing.assignedTo !== crmUser.userId) {
      res.status(403).json({ error: "You can only edit leads assigned to you" });
      return;
    }

    const data = req.body;
    const arv = data.arv !== undefined ? parseMoney(data.arv) : parseMoney(existing.arv);
    const erc = data.estimatedRepairCost !== undefined ? parseMoney(data.estimatedRepairCost) : parseMoney(existing.estimatedRepairCost);
    const mao = arv !== null && erc !== null ? arv * 0.80 - erc : (data.mao !== undefined ? parseMoney(data.mao) : parseMoney(existing.mao));

    const updates: any = { updatedAt: new Date() };
    const fields = ["sellerName","phone","email","leadSource","address","city","state","zip","propertyType","status","occupancy","reasonForSelling","howSoon","notes","ownerName","lastSaleDate"];
    fields.forEach(f => { if (data[f] !== undefined) updates[f] = data[f]; });
    if (data.isRental !== undefined) updates.isRental = data.isRental;
    if (data.rentalAmount !== undefined) updates.rentalAmount = parseMoney(data.rentalAmount)?.toString() || null;
    if (data.beds !== undefined) updates.beds = data.beds ? parseInt(data.beds) : null;
    if (data.baths !== undefined) updates.baths = data.baths ? data.baths.toString() : null;
    if (data.sqft !== undefined) updates.sqft = data.sqft ? parseInt(data.sqft) : null;
    if (data.yearBuilt !== undefined) updates.yearBuilt = data.yearBuilt ? parseInt(data.yearBuilt) : null;
    if (data.condition !== undefined) updates.condition = data.condition ? parseInt(data.condition) : null;
    if (data.askingPrice !== undefined) updates.askingPrice = parseMoney(data.askingPrice)?.toString() || null;
    if (data.currentValue !== undefined) updates.currentValue = parseMoney(data.currentValue)?.toString() || null;
    if (data.lastSalePrice !== undefined) updates.lastSalePrice = parseMoney(data.lastSalePrice)?.toString() || null;
    if (data.estimatedRepairCost !== undefined) updates.estimatedRepairCost = erc?.toString() || null;
    if (data.arv !== undefined) updates.arv = arv?.toString() || null;
    updates.mao = mao?.toString() || null;
    if (data.assignedTo !== undefined) updates.assignedTo = data.assignedTo || null;

    const [lead] = await db.update(crmLeads).set(updates).where(eq(crmLeads.id, id)).returning();

    // Build audit log entries
    const [actorUser] = await db.select().from(crmUsers).where(eq(crmUsers.id, crmUser.userId)).limit(1);
    const actorName = actorUser?.name || "Unknown";
    const auditFields = [...fields, "isRental","rentalAmount","beds","baths","sqft","condition","askingPrice","currentValue","estimatedRepairCost","arv","assignedTo"];
    const auditEntries: string[] = [];

    for (const field of auditFields) {
      if (data[field] === undefined) continue;
      const label = FIELD_LABELS[field] || field;
      const oldRaw = (existing as any)[field];
      const newRaw = (lead as any)[field];
      const oldStr = formatFieldValue(field, oldRaw);
      const newStr = formatFieldValue(field, newRaw);
      if (oldStr !== newStr) {
        auditEntries.push(`@${actorName} changed ${label} from "${oldStr}" to "${newStr}"`);
      }
    }

    // Write audit notes and notify followers
    if (auditEntries.length > 0) {
      const auditContent = auditEntries.join("\n");
      await db.insert(crmNotes).values({ leadId: id, userId: crmUser.userId, content: auditContent, noteType: "audit" });
      await notifyFollowers(id, crmUser.userId, `${actorName} updated lead: ${lead.address}`, "update");
    }

    // If assignedTo changed, auto-follow and notify the new assignee
    const newAssigned = data.assignedTo !== undefined ? (data.assignedTo ? Number(data.assignedTo) : null) : undefined;
    if (newAssigned !== undefined && newAssigned && newAssigned !== existing.assignedTo) {
      const alreadyFollows = await db.select({ id: crmLeadFollowers.id }).from(crmLeadFollowers)
        .where(and(eq(crmLeadFollowers.leadId, id), eq(crmLeadFollowers.userId, newAssigned))).limit(1);
      if (alreadyFollows.length === 0) {
        await db.insert(crmLeadFollowers).values({ leadId: id, userId: newAssigned });
      }
      if (newAssigned !== crmUser.userId) {
        await db.insert(crmNotifications).values({
          userId: newAssigned, leadId: id, type: "assigned",
          content: `${actorName} assigned you to: ${lead.address}`, read: false,
        });
      }
    }

    // Automation: auto-close tasks if lead status changed to a closed state
    if (data.status !== undefined && data.status !== existing.status) {
      onLeadStatusChanged(id, existing.status, data.status)
        .catch(e => console.error("automation.onLeadStatusChanged error:", e));
    }

    res.json(formatLead(lead));
  } catch (err) {
    console.error("CRM update lead error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", crmAuth, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const crmUser = (req as any).crmUser;
  try {
    const [existing] = await db.select().from(crmLeads).where(eq(crmLeads.id, id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }
    if (crmUser.role !== "super_admin") {
      if (crmUser.role !== "admin") {
        res.status(403).json({ error: "Only admins can delete leads." });
        return;
      }
      if (existing.campaignId !== crmUser.campaignId) {
        res.status(403).json({ error: "Access denied." });
        return;
      }
      const [campaign] = await db.select({ allowLeadDeletion: crmCampaigns.allowLeadDeletion })
        .from(crmCampaigns).where(eq(crmCampaigns.id, existing.campaignId!)).limit(1);
      if (!campaign?.allowLeadDeletion) {
        res.status(403).json({ error: "Lead deletion is not enabled for this campaign. Ask your super admin to enable it in campaign settings." });
        return;
      }
    }
    await db.delete(crmLeads).where(eq(crmLeads.id, id));
    res.json({ success: true, message: "Lead deleted" });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Archive a lead (admin or super_admin only)
router.post("/:id/archive", crmAuth, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const crmUser = (req as any).crmUser;
  if (crmUser.role !== "super_admin" && crmUser.role !== "admin") {
    res.status(403).json({ error: "Only admins can archive leads." });
    return;
  }
  try {
    const [existing] = await db.select().from(crmLeads).where(eq(crmLeads.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Lead not found" }); return; }
    if (crmUser.role !== "super_admin" && existing.campaignId !== crmUser.campaignId) {
      res.status(403).json({ error: "Access denied" }); return;
    }
    await db.update(crmLeads).set({ archived: true, archivedAt: new Date(), updatedAt: new Date() }).where(eq(crmLeads.id, id));
    await db.insert(crmNotes).values({ leadId: id, userId: crmUser.id, content: "Lead archived.", noteType: "audit" });
    res.json({ success: true, message: "Lead archived" });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Unarchive a lead (admin or super_admin only)
router.post("/:id/unarchive", crmAuth, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const crmUser = (req as any).crmUser;
  if (crmUser.role !== "super_admin" && crmUser.role !== "admin") {
    res.status(403).json({ error: "Only admins can unarchive leads." });
    return;
  }
  try {
    const [existing] = await db.select().from(crmLeads).where(eq(crmLeads.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Lead not found" }); return; }
    if (crmUser.role !== "super_admin" && existing.campaignId !== crmUser.campaignId) {
      res.status(403).json({ error: "Access denied" }); return;
    }
    await db.update(crmLeads).set({ archived: false, archivedAt: null, updatedAt: new Date() }).where(eq(crmLeads.id, id));
    await db.insert(crmNotes).values({ leadId: id, userId: crmUser.id, content: "Lead unarchived.", noteType: "audit" });
    res.json({ success: true, message: "Lead unarchived" });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id/notes", crmAuth, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const notes = await db.select({
      id: crmNotes.id, leadId: crmNotes.leadId, userId: crmNotes.userId,
      content: crmNotes.content, noteType: crmNotes.noteType, createdAt: crmNotes.createdAt, userName: crmUsers.name,
    }).from(crmNotes).leftJoin(crmUsers, eq(crmNotes.userId, crmUsers.id)).where(eq(crmNotes.leadId, id)).orderBy(crmNotes.createdAt);
    res.json(notes.map(n => ({
      id: n.id, leadId: n.leadId, userId: n.userId, userName: n.userName || "Unknown",
      content: n.content, noteType: n.noteType || "note", createdAt: n.createdAt.toISOString(),
    })));
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/notes", crmAuth, async (req, res) => {
  const leadId = parseInt(req.params.id as string);
  const crmUser = (req as any).crmUser;
  const { content } = req.body;
  if (!content) {
    res.status(400).json({ error: "Content required" });
    return;
  }
  try {
    const [note] = await db.insert(crmNotes).values({ leadId, userId: crmUser.userId, content, noteType: "note" }).returning();
    const [user] = await db.select().from(crmUsers).where(eq(crmUsers.id, crmUser.userId)).limit(1);

    // Notify followers about new note
    const [lead] = await db.select().from(crmLeads).where(eq(crmLeads.id, leadId)).limit(1);
    if (lead) {
      await notifyFollowers(leadId, crmUser.userId, `${user?.name || "Someone"} added a note on: ${lead.address}`, "note");

      // Notify the assignee if they're not already a follower
      if (lead.assignedTo && lead.assignedTo !== crmUser.userId) {
        const isFollowing = await db.select({ id: crmLeadFollowers.id }).from(crmLeadFollowers)
          .where(and(eq(crmLeadFollowers.leadId, leadId), eq(crmLeadFollowers.userId, lead.assignedTo))).limit(1);
        if (isFollowing.length === 0) {
          await db.insert(crmNotifications).values({
            userId: lead.assignedTo, leadId, type: "note",
            content: `${user?.name || "Someone"} added a note on your assigned lead: ${lead.address}`, read: false,
          });
        }
      }

      // Parse @mentions and notify mentioned users
      if (lead.campaignId) {
        const mentionMatches = [...content.matchAll(/@([\w\s]+?)(?=\s@|\s*$|[^a-zA-Z\s])/g)];
        const mentionedNames = mentionMatches.map(m => m[1].trim()).filter(Boolean);
        if (mentionedNames.length > 0) {
          const campaignUsers = await db.select().from(crmUsers).where(eq(crmUsers.campaignId, lead.campaignId));
          const mentionNotifs: any[] = [];
          for (const name of mentionedNames) {
            const nameLower = name.toLowerCase();
            const found = campaignUsers.find(u => u.name.toLowerCase() === nameLower || u.name.toLowerCase().startsWith(nameLower));
            if (found && found.id !== crmUser.userId) {
              mentionNotifs.push({ userId: found.id, leadId, type: "mention", content: `${user?.name || "Someone"} mentioned you in a note on: ${lead.address}`, read: false });
            }
          }
          if (mentionNotifs.length > 0) await db.insert(crmNotifications).values(mentionNotifs);
        }
      }
    }

    res.status(201).json({
      id: note.id, leadId: note.leadId, userId: note.userId,
      userName: user?.name || "Unknown", content: note.content, noteType: "note", createdAt: note.createdAt.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Follow/unfollow a lead
router.get("/:id/followers", crmAuth, async (req, res) => {
  const leadId = parseInt(req.params.id as string);
  const crmUser = (req as any).crmUser;
  try {
    const followers = await db.select().from(crmLeadFollowers).where(eq(crmLeadFollowers.leadId, leadId));
    const isFollowing = followers.some(f => f.userId === crmUser.userId);
    res.json({ count: followers.length, isFollowing });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/follow", crmAuth, async (req, res) => {
  const leadId = parseInt(req.params.id as string);
  const crmUser = (req as any).crmUser;
  try {
    const existing = await db.select().from(crmLeadFollowers).where(
      and(eq(crmLeadFollowers.leadId, leadId), eq(crmLeadFollowers.userId, crmUser.userId))
    );
    if (existing.length === 0) {
      await db.insert(crmLeadFollowers).values({ leadId, userId: crmUser.userId });
    }
    res.json({ following: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id/follow", crmAuth, async (req, res) => {
  const leadId = parseInt(req.params.id as string);
  const crmUser = (req as any).crmUser;
  try {
    await db.delete(crmLeadFollowers).where(
      and(eq(crmLeadFollowers.leadId, leadId), eq(crmLeadFollowers.userId, crmUser.userId))
    );
    res.json({ following: false });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/estimate", crmAuth, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const crmUser = (req as any).crmUser;
  try {
    const [lead] = await db.select().from(crmLeads).where(eq(crmLeads.id, id)).limit(1);
    if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
    if (crmUser.role !== "super_admin" && lead.campaignId !== crmUser.campaignId) {
      res.status(403).json({ error: "Access denied" }); return;
    }
    const sqft = lead.sqft || 1500;
    const condition = lead.condition || 5;
    const propertyType = lead.propertyType || "Single Family";
    const baseRepairPerSqft = condition <= 3 ? 45 : condition <= 6 ? 25 : 12;
    const baseRepair = sqft * baseRepairPerSqft;
    const breakdown = [
      { item: "Roof", cost: condition <= 4 ? 8000 : condition <= 7 ? 3000 : 500 },
      { item: "HVAC", cost: condition <= 5 ? 5500 : 1200 },
      { item: "Plumbing", cost: condition <= 4 ? 6000 : condition <= 7 ? 2500 : 800 },
      { item: "Electrical", cost: condition <= 4 ? 5000 : condition <= 7 ? 2000 : 600 },
      { item: "Flooring", cost: Math.round(sqft * (condition <= 5 ? 8 : 4)) },
      { item: "Kitchen", cost: condition <= 4 ? 25000 : condition <= 7 ? 12000 : 4000 },
      { item: "Bathrooms", cost: condition <= 4 ? 15000 : condition <= 7 ? 8000 : 2500 },
      { item: "Paint (interior)", cost: Math.round(sqft * 2.5) },
      { item: "Landscaping", cost: condition <= 5 ? 3500 : 1200 },
      { item: "Miscellaneous", cost: Math.round(baseRepair * 0.1) },
    ];
    const totalERC = breakdown.reduce((sum, item) => sum + item.cost, 0);
    const arvEstimate = lead.arv ? parseFloat(lead.arv) : (lead.currentValue ? parseFloat(lead.currentValue) * 1.35 : null);
    const mao = arvEstimate ? arvEstimate * 0.80 - totalERC : null;
    await db.update(crmLeads).set({ estimatedRepairCost: totalERC.toString(), mao: mao ? mao.toString() : null, updatedAt: new Date() }).where(eq(crmLeads.id, id));
    res.json({ estimatedRepairCost: totalERC, breakdown, notes: `Estimate based on ${sqft} sqft ${propertyType} in condition ${condition}/10.`, arv: arvEstimate, mao });
  } catch (err) {
    console.error("CRM estimate error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /crm/leads/:id/ai-repair-estimate — AI-powered repair cost estimator from free-text description
router.post("/:id/ai-repair-estimate", crmAuth, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const crmUser = (req as any).crmUser;
  const { description } = req.body as { description: string };

  if (!description || description.trim().length < 5) {
    res.status(400).json({ error: "Please describe the repairs needed." }); return;
  }

  try {
    const [lead] = await db.select().from(crmLeads).where(eq(crmLeads.id, id)).limit(1);
    if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
    if (crmUser.role !== "super_admin" && lead.campaignId !== crmUser.campaignId) {
      res.status(403).json({ error: "Access denied" }); return;
    }

    const sqft = lead.sqft || 1500;
    const state = lead.state || "OH";
    const propType = lead.propertyType || "Single Family";

    const aiBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const aiApiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (!aiBaseUrl || !aiApiKey) {
      res.status(503).json({ error: "AI service not configured" }); return;
    }

    const systemPrompt = `You are a professional real estate contractor estimator in the US. 
Given a description of repairs needed, produce a detailed cost breakdown for a ${propType} in ${state} with approximately ${sqft} sqft.
Use realistic 2024-2025 US contractor pricing (include labor + materials).
Always add a 10% contingency line item at the end.
Respond ONLY with a valid JSON object in this exact shape:
{
  "items": [
    { "item": "Roof Replacement", "qty": 1, "unit": "lump sum", "unitCost": 8500, "total": 8500, "notes": "30-year architectural shingles" },
    ...
  ],
  "totalCost": 12345,
  "currency": "USD",
  "disclaimer": "Estimates are approximate and may vary by contractor."
}
Do not include markdown, only the raw JSON object.`;

    const userMessage = `Property: ${propType}, ~${sqft} sqft, ${state}\nRepairs needed:\n${description.trim()}`;

    const aiRes = await fetch(`${aiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${aiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL || "llama-3.1-70b-versatile",
        max_tokens: 1200,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text().catch(() => "");
      console.error("AI repair estimate error:", errText);
      res.status(502).json({ error: "AI service returned an error. Please try again." }); return;
    }

    const aiJson = await aiRes.json() as any;
    const rawContent = aiJson?.choices?.[0]?.message?.content || "";

    let parsed: any;
    try {
      // response_format: json_object guarantees JSON, but strip any accidental markdown fences as fallback
      const cleaned = rawContent.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("AI repair estimate parse error. Raw content:", rawContent, "Parse err:", parseErr);
      res.status(502).json({ error: "AI returned an unexpected format. Please try again." }); return;
    }

    const totalCost = parsed.totalCost || 0;
    const arv = lead.arv ? parseFloat(lead.arv) : null;
    const mao = arv ? arv * 0.80 - totalCost : null;

    await db.update(crmLeads).set({
      estimatedRepairCost: totalCost.toString(),
      ...(mao != null ? { mao: Math.max(0, mao).toString() } : {}),
      updatedAt: new Date(),
    }).where(eq(crmLeads.id, id));

    res.json({
      items: parsed.items || [],
      totalCost,
      currency: "USD",
      disclaimer: parsed.disclaimer || "",
      arv,
      mao: mao != null ? Math.max(0, mao) : null,
    });
  } catch (err) {
    console.error("AI repair estimate error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /crm/leads/:id/fetch-property-data  — calls PropertyAPI.co to auto-fill lead
// Cooldown rules: per-lead max 2 fetches w/ 5h gap; per-campaign 10min gap; super_admin bypasses all
router.post("/:id/fetch-property-data", crmAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const user = (req as any).crmUser;
  const isSuperAdmin = user?.role === "super_admin";

  try {
    const [lead] = await db.select().from(crmLeads).where(eq(crmLeads.id, id)).limit(1);
    if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

    // ── Cooldown check ─────────────────────────────────────────────────────
    const campaignId = lead.campaignId ?? user?.campaignId ?? 0;
    const cooldown = checkCooldown(id, campaignId, isSuperAdmin);
    if (!cooldown.allowed) {
      res.status(429).json({
        error: "cooldown",
        message: cooldown.reason,
        retryAfterMs: cooldown.retryAfterMs,
      });
      return;
    }

    // ── Build a clean address for the API call ─────────────────────────────
    const parts = [lead.address, lead.city, lead.state, lead.zip].filter(Boolean);
    const address = parts.join(", ");
    if (!address) { res.status(400).json({ error: "Lead has no address" }); return; }

    const data = await fetchPropertyData(address);
    if (!data) {
      res.status(503).json({
        error: "PropertyAPI lookup failed — API may be unreachable from this environment (works in production)"
      });
      return;
    }

    // ── Record fetch only on success ───────────────────────────────────────
    if (!isSuperAdmin) recordFetch(id, campaignId);

    // ── Build update — fill property details; NEVER auto-set ARV (must come from comps/manual) ─
    const updates: Record<string, any> = { updatedAt: new Date() };
    if (data.beds != null)          updates.beds = data.beds;
    if (data.baths != null)         updates.baths = data.baths.toString();
    if (data.sqft != null)          updates.sqft = data.sqft;
    if (data.yearBuilt != null)     updates.yearBuilt = data.yearBuilt;
    if (data.ownerName)             updates.ownerName = data.ownerName;
    if (data.lastSaleDate)          updates.lastSaleDate = data.lastSaleDate;
    if (data.lastSalePrice != null) updates.lastSalePrice = data.lastSalePrice.toString();
    if (data.propertyType)          updates.propertyType = data.propertyType;
    if (data.latitude != null)      updates.latitude = data.latitude.toString();
    if (data.longitude != null)     updates.longitude = data.longitude.toString();
    // currentValue: use the HIGHER of (AVM, tax assessed) — both are estimates, take the better one
    // Do NOT auto-set ARV — ARV must come from comparable sales analysis or manual input
    if (!lead.currentValue) {
      const bestEstimate = Math.max(data.avm ?? 0, data.taxAssessedValue ?? 0);
      if (bestEstimate > 0) updates.currentValue = bestEstimate.toString();
    }

    // Log what was returned vs what changed for debugging
    console.log("[fetch-property-data] API returned:", JSON.stringify({ beds: data.beds, baths: data.baths, sqft: data.sqft, yearBuilt: data.yearBuilt, ownerName: data.ownerName, lastSaleDate: data.lastSaleDate, lastSalePrice: data.lastSalePrice, propertyType: data.propertyType, avm: data.avm }));
    console.log("[fetch-property-data] Fields being updated:", Object.keys(updates).filter(k => k !== "updatedAt"));

    await db.update(crmLeads).set(updates).where(eq(crmLeads.id, id));

    res.json({
      success: true,
      fetched: {
        beds: data.beds,
        baths: data.baths,
        sqft: data.sqft,
        yearBuilt: data.yearBuilt,
        ownerName: data.ownerName,
        lastSalePrice: data.lastSalePrice,
        lastSaleDate: data.lastSaleDate,
        propertyType: data.propertyType,
        avm: data.avm,
        taxAssessedValue: data.taxAssessedValue,
        // Include currentValue so frontend can patch formData immediately
        currentValue: updates.currentValue != null ? parseFloat(updates.currentValue) : null,
        // ARV/MAO are NOT auto-set from API — must come from comparables or manual input
        arv: null,
        mao: null,
        creditsRemaining: data.creditsRemaining,
      },
      fieldsUpdated: Object.keys(updates).filter(k => k !== "updatedAt"),
      cooldownBypassed: isSuperAdmin,
    });
  } catch (err) {
    console.error("Fetch property data error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /crm/leads/:id/skip-trace
router.post("/:id/skip-trace", crmAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const crmUser = (req as any).crmUser;
  const isSuperAdmin = crmUser.role === "super_admin";

  try {
    const [lead] = await db.select().from(crmLeads).where(eq(crmLeads.id, id)).limit(1);
    if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

    if (!isSuperAdmin && lead.campaignId !== crmUser.campaignId) {
      res.status(403).json({ error: "Access denied" }); return;
    }
    if (crmUser.role === "va" && lead.assignedTo !== crmUser.userId) {
      res.status(403).json({ error: "You can only skip trace leads assigned to you" }); return;
    }

    const campaignId = lead.campaignId ?? crmUser.campaignId ?? 0;
    let skipTraceDailyLimit = 1;
    if (campaignId) {
      const [camp] = await db.select({ skipTraceDailyLimit: crmCampaigns.skipTraceDailyLimit })
        .from(crmCampaigns).where(eq(crmCampaigns.id, campaignId)).limit(1);
      if (camp) skipTraceDailyLimit = camp.skipTraceDailyLimit ?? 1;
    }
    const cooldown = checkSkipTraceCooldown(campaignId, isSuperAdmin, skipTraceDailyLimit);
    if (!cooldown.allowed) {
      res.status(429).json({ error: "cooldown", message: cooldown.reason, retryAfterMs: cooldown.retryAfterMs });
      return;
    }

    if (!lead.address) { res.status(400).json({ error: "Lead has no address" }); return; }

    // Parse owner name to first/last for better match accuracy
    let firstName: string | null = null;
    let lastName: string | null = null;
    if (lead.ownerName) {
      const parts = lead.ownerName.trim().split(/\s+/);
      if (parts.length >= 2) { firstName = parts[0]!; lastName = parts.slice(1).join(" "); }
      else { lastName = parts[0]!; }
    }

    const result = await runSkipTrace(lead.address, lead.city, lead.state, lead.zip, firstName, lastName);
    if (!result) {
      const apiErr = getLastSkipTraceError();
      res.status(503).json({
        error: "skip_trace_api_error",
        message: apiErr?.apiMessage ?? "Skip trace API did not return results",
        httpStatus: apiErr?.httpStatus,
      });
      return;
    }

    if (!isSuperAdmin) recordSkipTrace(campaignId);

    // Auto-fill phone/email only if not already set on the lead
    // Always store all skip-traced phones/emails/name in dedicated fields
    const updates: Record<string, any> = { updatedAt: new Date() };
    const fieldsUpdated: string[] = [];
    const bestPhone = result.phones.find(p => !p.isDisconnected)?.number ?? result.phones[0]?.number;
    const bestEmail = result.emails[0];
    if (bestPhone && !lead.phone) { updates["phone"] = bestPhone; fieldsUpdated.push("phone"); }
    if (bestEmail && !lead.email) { updates["email"] = bestEmail; fieldsUpdated.push("email"); }
    // Always save full skip trace results
    updates["skipTracedPhones"] = JSON.stringify(result.phones);
    updates["skipTracedEmails"] = JSON.stringify(result.emails);
    if (result.name) updates["skipTracedName"] = result.name;
    await db.update(crmLeads).set(updates).where(eq(crmLeads.id, id));

    res.json({
      success: true,
      matchStatus: result.matchStatus,
      phones: result.phones,
      emails: result.emails,
      fieldsUpdated,
      creditsRemaining: result.creditsRemaining,
      cooldownBypassed: isSuperAdmin,
    });
  } catch (err) {
    console.error("Skip trace error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /crm/leads/:id/comp-address-lookup — look up a single comparable property address (1 credit)
// Returns property details to pre-fill the comp form
router.post("/:id/comp-address-lookup", crmAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (!id) { res.status(400).json({ error: "Invalid lead ID" }); return; }

  const { address } = req.body;
  if (!address || typeof address !== "string" || address.trim().length < 5) {
    res.status(400).json({ error: "Valid address required" });
    return;
  }

  try {
    const [lead] = await db.select({ id: crmLeads.id }).from(crmLeads).where(eq(crmLeads.id, id)).limit(1);
    if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

    const data = await fetchPropertyData(address.trim());
    if (!data) {
      res.status(503).json({ error: "PropertyAPI lookup failed — check API key or address" });
      return;
    }

    res.json({
      success: true,
      beds: data.beds ?? null,
      baths: data.baths ?? null,
      sqft: data.sqft ?? null,
      yearBuilt: data.yearBuilt ?? null,
      lastSalePrice: data.lastSalePrice ?? null,
      lastSaleDate: data.lastSaleDate ?? null,
      propertyType: data.propertyType ?? null,
      ownerName: data.ownerName ?? null,
      creditsRemaining: data.creditsRemaining,
    });
  } catch (err) {
    console.error("Comp address lookup error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── AI Comps Fallback ────────────────────────────────────────────────────────
// Used when all PropertyAPI credits are exhausted. Asks the AI for realistic
// estimated comparable sales based on the subject property's market knowledge.

async function fetchCompsViaAI(lead: any, leadId: number, subjectProp: {
  beds: number | null; baths: number | null; sqft: number | null; yearBuilt: number | null;
}): Promise<{ added: number; comps: any[]; arv: number | null; mao: number | null }> {
  const aiBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const aiApiKey  = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!aiBaseUrl || !aiApiKey) return { added: 0, comps: [], arv: null, mao: null };

  const location = [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(", ");
  const today = new Date().toISOString().split("T")[0];

  const systemPrompt =
    "You are a real estate comparable sales analyst with deep knowledge of US housing markets. " +
    "Generate realistic MLS-style comparable sales data. Answer only with valid JSON.";

  const userPrompt =
    `Generate 6 realistic recent comparable sales for this subject property:\n` +
    `Address: ${location}\n` +
    `Beds: ${subjectProp.beds ?? "?"}, Baths: ${subjectProp.baths ?? "?"}, ` +
    `Sqft: ${subjectProp.sqft ?? "?"}, Year Built: ${subjectProp.yearBuilt ?? "?"}\n` +
    `Property Type: ${lead.propertyType ?? "Single Family"}\n\n` +
    `Requirements:\n` +
    `- Similar homes in the same neighborhood or nearby streets in ${lead.city ?? ""}, ${lead.state ?? ""}\n` +
    `- Sold within the last 24 months (on or before ${today})\n` +
    `- Similar size (±500 sqft), age (±15 years), and bed/bath count (±1)\n` +
    `- Realistic market-accurate sale prices for this area and time period\n\n` +
    `Reply ONLY with this JSON:\n` +
    `{ "comps": [ { "address": "...", "beds": 3, "baths": 2.0, "sqft": 1450, "yearBuilt": 1985, "salePrice": 185000, "soldDate": "2024-06-15" } ] }`;

  try {
    const aiRes = await fetch(`${aiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${aiApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.AI_MODEL || "llama-3.1-70b-versatile",
        max_tokens: 1200,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt },
        ],
      }),
    });

    if (!aiRes.ok) {
      console.error("[AI comps fallback] AI call failed:", aiRes.status);
      return { added: 0, comps: [], arv: null, mao: null };
    }

    const json = await aiRes.json();
    const raw = json?.choices?.[0]?.message?.content ?? "";
    const content = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
    const parsed = JSON.parse(content);
    const rawComps: any[] = parsed?.comps ?? [];

    if (!rawComps.length) return { added: 0, comps: [], arv: null, mao: null };

    // Calculate market sqft rate from the AI comps themselves
    const sqftRates = rawComps
      .filter(c => c.salePrice > 0 && c.sqft > 0)
      .map(c => c.salePrice / c.sqft)
      .sort((a, b) => a - b);
    const marketPricePerSqft = sqftRates.length > 0 ? sqftRates[Math.floor(sqftRates.length / 2)] : undefined;

    const insertedComps: any[] = [];
    const adjustedPrices: number[] = [];

    for (const c of rawComps) {
      if (!c.salePrice || c.salePrice <= 0) continue;
      const adjustedPrice = calculateAdjustedComp(
        { beds: subjectProp.beds, baths: subjectProp.baths, sqft: subjectProp.sqft, yearBuilt: subjectProp.yearBuilt },
        { salePrice: c.salePrice, beds: c.beds ?? null, baths: c.baths ?? null, sqft: c.sqft ?? null, yearBuilt: c.yearBuilt ?? null, soldDate: c.soldDate ?? null },
        marketPricePerSqft,
      );
      const [inserted] = await db.insert(crmComps).values({
        leadId,
        address: c.address || location,
        beds: c.beds ?? null,
        baths: c.baths != null ? c.baths.toString() : null,
        sqft: c.sqft ?? null,
        yearBuilt: c.yearBuilt ?? null,
        salePrice: c.salePrice.toString(),
        soldDate: c.soldDate ?? null,
        adjustedPrice: adjustedPrice.toString(),
        notes: "AI-estimated comp (PropertyAPI credits exhausted — for reference only)",
      }).returning();
      adjustedPrices.push(adjustedPrice);
      insertedComps.push({
        id: inserted.id, address: inserted.address, beds: inserted.beds,
        baths: inserted.baths ? parseFloat(inserted.baths) : null,
        sqft: inserted.sqft, yearBuilt: inserted.yearBuilt,
        salePrice: c.salePrice, soldDate: inserted.soldDate, adjustedPrice, notes: inserted.notes,
      });
    }

    const newArv = calculateArvFromComps(adjustedPrices);
    const erc = lead.estimatedRepairCost ? parseFloat(lead.estimatedRepairCost) : null;
    const newMao = newArv && erc != null ? Math.round(newArv * 0.80 - erc) : null;

    if (newArv) {
      await db.update(crmLeads)
        .set({ arv: newArv.toString(), mao: newMao != null ? newMao.toString() : null, updatedAt: new Date() })
        .where(eq(crmLeads.id, leadId));
    }

    return { added: insertedComps.length, comps: insertedComps, arv: newArv, mao: newMao };
  } catch (err) {
    console.error("[AI comps fallback] error:", err);
    return { added: 0, comps: [], arv: null, mao: null };
  }
}

// POST /crm/leads/:id/fetch-comps — starts async export job, returns immediately
router.post("/:id/fetch-comps", crmAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const crmUser = (req as any).crmUser;
  const isSuperAdmin = crmUser.role === "super_admin";
  if (!id) { res.status(400).json({ error: "Invalid lead ID" }); return; }

  const radiusMiles: number = parseFloat(req.body.radiusMiles) || 0.25;
  if (radiusMiles < 0.05 || radiusMiles > 5) {
    res.status(400).json({ error: "radiusMiles must be between 0.05 and 5" });
    return;
  }

  try {
    const [lead] = await db.select().from(crmLeads).where(eq(crmLeads.id, id)).limit(1);
    if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

    const campaignId = lead.campaignId;
    let fetchCompsDailyLimit = 1;
    if (campaignId) {
      const [camp] = await db.select({ fetchCompsDailyLimit: crmCampaigns.fetchCompsDailyLimit })
        .from(crmCampaigns).where(eq(crmCampaigns.id, campaignId)).limit(1);
      if (camp) fetchCompsDailyLimit = camp.fetchCompsDailyLimit ?? 1;
    }
    const cooldown = checkFetchCompsCooldown(campaignId, isSuperAdmin, fetchCompsDailyLimit);
    if (!cooldown.allowed) {
      res.status(429).json({ error: cooldown.reason, retryAfterMs: cooldown.retryAfterMs });
      return;
    }
    if (!isSuperAdmin) recordFetchComps(campaignId);

    // ── Resolve lat/lng — use ATTOM geocoding (free on trial) ────────────────
    let lat: number | null = lead.latitude ? parseFloat(lead.latitude) : null;
    let lng: number | null = lead.longitude ? parseFloat(lead.longitude) : null;

    if (!lat || !lng) {
      if (!lead.address) { res.status(400).json({ error: "Lead has no address to geocode" }); return; }

      if (hasAttomKey()) {
        const coords = await geocodeViaAttom(lead.address, lead.city, lead.state, lead.zip);
        if (coords) {
          lat = coords.lat;
          lng = coords.lng;
          await db.update(crmLeads)
            .set({ latitude: lat.toString(), longitude: lng.toString(), updatedAt: new Date() })
            .where(eq(crmLeads.id, id));
        }
      }

      // Last resort: PropertyAPI geocoding
      if (!lat || !lng) {
        const propData = await fetchPropertyData(
          [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(", ")
        );
        if (propData?.latitude && propData?.longitude) {
          lat = propData.latitude;
          lng = propData.longitude;
          await db.update(crmLeads)
            .set({ latitude: lat.toString(), longitude: lng.toString(), updatedAt: new Date() })
            .where(eq(crmLeads.id, id));
        }
      }
    }

    // If still no coordinates → AI fallback
    if (!lat || !lng) {
      const subjectProp = {
        beds: lead.beds ?? null,
        baths: lead.baths ? parseFloat(lead.baths) : null,
        sqft: lead.sqft ?? null,
        yearBuilt: lead.yearBuilt ?? null,
      };
      const aiResult = await fetchCompsViaAI(lead, id, subjectProp);
      if (aiResult.added > 0) {
        res.json({ status: "done", success: true, aiGenerated: true, added: aiResult.added, comps: aiResult.comps, arv: aiResult.arv, mao: aiResult.mao });
      } else {
        res.status(503).json({ error: "Could not resolve property coordinates. Please verify the address." });
      }
      return;
    }

    // ── Fetch comps via ATTOM sale/snapshot (synchronous, no polling needed) ─
    const subjectProp = {
      beds: lead.beds ?? null,
      baths: lead.baths ? parseFloat(lead.baths) : null,
      sqft: lead.sqft ?? null,
      yearBuilt: lead.yearBuilt ?? null,
    };

    if (!hasAttomKey()) {
      const aiResult = await fetchCompsViaAI(lead, id, subjectProp);
      if (aiResult.added > 0) {
        res.json({ status: "done", success: true, aiGenerated: true, added: aiResult.added, comps: aiResult.comps, arv: aiResult.arv, mao: aiResult.mao });
      } else {
        res.status(503).json({ error: "ATTOM API key not configured and AI fallback failed." });
      }
      return;
    }

    let rawComps;
    try {
      rawComps = await fetchCompsViaAttom(lat, lng, radiusMiles, 8);
    } catch (attomErr: any) {
      console.error("[ATTOM comps] failed:", attomErr?.message);
      // ATTOM failed → fall back to AI
      const aiResult = await fetchCompsViaAI(lead, id, subjectProp);
      if (aiResult.added > 0) {
        res.json({ status: "done", success: true, aiGenerated: true, added: aiResult.added, comps: aiResult.comps, arv: aiResult.arv, mao: aiResult.mao });
      } else {
        res.status(503).json({ error: `ATTOM comps failed: ${attomErr?.message}` });
      }
      return;
    }

    if (rawComps.length === 0) {
      res.json({ status: "done", success: true, added: 0, comps: [], message: `No recently-sold properties (last 24 months) found within ${radiusMiles} mi.` });
      return;
    }

    // Derive market $/sqft from actual comps
    const sqftRates = rawComps
      .filter(c => c.salePrice > 0 && (c.sqft ?? 0) > 0)
      .map(c => c.salePrice / c.sqft!)
      .sort((a, b) => a - b);
    const marketPricePerSqft = sqftRates.length > 0
      ? sqftRates[Math.floor(sqftRates.length / 2)]
      : undefined;

    const insertedComps: any[] = [];
    for (const c of rawComps) {
      const adjustedPrice = calculateAdjustedComp(
        { beds: subjectProp.beds, baths: subjectProp.baths, sqft: subjectProp.sqft, yearBuilt: subjectProp.yearBuilt },
        { salePrice: c.salePrice, beds: c.beds ?? null, baths: c.baths ?? null, sqft: c.sqft ?? null, yearBuilt: c.yearBuilt ?? null, soldDate: c.soldDate || null },
        marketPricePerSqft,
      );
      const [inserted] = await db.insert(crmComps).values({
        leadId: id,
        address: c.address,
        beds: c.beds ?? null,
        baths: c.baths != null ? c.baths.toString() : null,
        sqft: c.sqft ?? null,
        yearBuilt: c.yearBuilt ?? null,
        salePrice: c.salePrice.toString(),
        soldDate: c.soldDate || null,
        adjustedPrice: adjustedPrice.toString(),
        source: "attom",
        notes: `Auto-fetched via ATTOM (${radiusMiles} mi radius)${c.propertyType ? ` — ${c.propertyType}` : ""}`,
      }).returning();
      insertedComps.push({
        id: inserted.id, address: inserted.address, beds: inserted.beds,
        baths: inserted.baths ? parseFloat(inserted.baths) : null,
        sqft: inserted.sqft, yearBuilt: inserted.yearBuilt,
        salePrice: c.salePrice, soldDate: inserted.soldDate, adjustedPrice, notes: inserted.notes,
      });
    }

    // Recalculate ARV from all comps on this lead
    const allComps = await db.select().from(crmComps).where(eq(crmComps.leadId, id));
    const adjustedPrices: number[] = allComps
      .filter(c => c.adjustedPrice)
      .map(c => parseFloat(c.adjustedPrice as string));

    const newArv = calculateArvFromComps(adjustedPrices);
    const erc = lead.estimatedRepairCost ? parseFloat(lead.estimatedRepairCost) : null;
    const newMao = newArv && erc != null ? Math.round(newArv * 0.80 - erc) : null;

    if (newArv) {
      await db.update(crmLeads)
        .set({ arv: newArv.toString(), mao: newMao != null ? newMao.toString() : null, updatedAt: new Date() })
        .where(eq(crmLeads.id, id));
    }

    res.json({
      status: "done",
      success: true,
      added: insertedComps.length,
      arv: newArv,
      mao: newMao,
      comps: insertedComps,
    });
  } catch (err) {
    console.error("Fetch comps start error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /crm/leads/:id/fetch-comps/poll?token=... — poll export status; finalize when done
router.get("/:id/fetch-comps/poll", crmAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const token = req.query["token"] as string;
  if (!token) { res.status(400).json({ error: "token required" }); return; }

  const job = compsJobs.get(token);
  if (!job || job.leadId !== id) {
    res.status(404).json({ error: "Job not found or expired — please try Fetch Comps again" });
    return;
  }

  try {
    const poll = await pollCompsExport(job.apiKey, job.exportToken);

    if (poll.status === "running") {
      res.json({ status: "pending", count: job.count, actualRadius: job.actualRadius });
      return;
    }

    compsJobs.delete(token); // clean up regardless of outcome

    if (poll.status === "failed") {
      res.status(422).json({ error: "PropertyAPI export job failed — please try again" });
      return;
    }

    // ── completed: download CSV, insert comps, recalculate ARV ─────────────
    const [lead] = await db.select().from(crmLeads).where(eq(crmLeads.id, id)).limit(1);
    if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

    const rawComps = await downloadComps(job.apiKey, poll.downloadUrl!);

    if (rawComps.length === 0) {
      res.json({
        status: "done",
        success: true,
        added: 0,
        comps: [],
        message: `No recently-sold properties (last 24 months) found within ${job.actualRadius} mi.`,
        totalInRadius: job.count,
        creditsUsed: job.count,
      });
      return;
    }

    const insertedComps = [];
    for (const c of rawComps) {
      const adjustedPrice = calculateAdjustedComp(
        { beds: job.subjectProp.beds, baths: job.subjectProp.baths, sqft: job.subjectProp.sqft, yearBuilt: job.subjectProp.yearBuilt },
        { salePrice: c.salePrice, beds: c.beds ?? null, baths: c.baths ?? null, sqft: c.sqft ?? null, yearBuilt: c.yearBuilt ?? null, soldDate: c.soldDate ?? null },
      );
      const fullAddress = [c.address, c.city, c.state, c.zip].filter(Boolean).join(", ");
      const [inserted] = await db.insert(crmComps).values({
        leadId: id,
        address: fullAddress || c.address,
        beds: c.beds ?? null,
        baths: c.baths != null ? c.baths.toString() : null,
        sqft: c.sqft ?? null,
        yearBuilt: c.yearBuilt ?? null,
        salePrice: c.salePrice.toString(),
        soldDate: c.soldDate,
        adjustedPrice: adjustedPrice.toString(),
        notes: `Auto-fetched via PropertyAPI (${job.actualRadius} mi radius)${c.propertyType ? ` — ${c.propertyType}` : ""}`,
      }).returning();
      insertedComps.push({
        id: inserted.id, address: inserted.address, beds: inserted.beds,
        baths: inserted.baths ? parseFloat(inserted.baths) : null,
        sqft: inserted.sqft, yearBuilt: inserted.yearBuilt,
        salePrice: c.salePrice, soldDate: inserted.soldDate, adjustedPrice, notes: inserted.notes,
      });
    }

    // ── Recalculate ARV ─────────────────────────────────────────────────────
    const allComps = await db.select().from(crmComps).where(eq(crmComps.leadId, id));
    const adjustedPrices: number[] = [];
    for (const comp of allComps) {
      if (!comp.salePrice) continue;
      const adj = calculateAdjustedComp(
        { beds: job.subjectProp.beds, baths: job.subjectProp.baths, sqft: job.subjectProp.sqft, yearBuilt: job.subjectProp.yearBuilt },
        { salePrice: parseFloat(comp.salePrice as string), beds: comp.beds ?? null, baths: comp.baths ? parseFloat(comp.baths as string) : null, sqft: comp.sqft ?? null, yearBuilt: comp.yearBuilt ?? null, soldDate: comp.soldDate ?? null },
      );
      await db.update(crmComps).set({ adjustedPrice: adj.toString() }).where(eq(crmComps.id, comp.id));
      adjustedPrices.push(adj);
    }

    const newArv = calculateArvFromComps(adjustedPrices);
    const erc = lead.estimatedRepairCost ? parseFloat(lead.estimatedRepairCost) : null;
    const newMao = newArv && erc != null ? Math.round(newArv * 0.80 - erc) : null;

    if (newArv) {
      await db.update(crmLeads)
        .set({ arv: newArv.toString(), mao: newMao != null ? newMao.toString() : null, updatedAt: new Date() })
        .where(eq(crmLeads.id, id));
    }

    res.json({
      status: "done",
      success: true,
      added: insertedComps.length,
      totalInRadius: job.count,
      creditsUsed: job.count,
      arv: newArv,
      mao: newMao,
      comps: insertedComps,
    });
  } catch (err) {
    console.error("Fetch comps poll error:", err);
    compsJobs.delete(token);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── AI Deal Scorer (Complete Backend) ───────────────────────────
router.post("/:id/ai-deal-score", crmAuth, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const crmUser = (req as any).crmUser;

  try {
    // 1. Fetch Lead
    const [lead] = await db.select().from(crmLeads).where(eq(crmLeads.id, id)).limit(1);
    if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

    // Permissions check
    if (crmUser.role !== "super_admin" && lead.campaignId !== crmUser.campaignId) {
      res.status(403).json({ error: "Access denied" }); return;
    }

    // 2. Fetch Activity Log (Notes)
    const notes = await db.select().from(crmNotes)
      .where(eq(crmNotes.leadId, id))
      .orderBy(desc(crmNotes.createdAt))
      .limit(15);

    const activityLogSummary = notes.length > 0 
      ? notes.map(n => `[${n.createdAt?.toLocaleDateString()}]: ${n.content}`).join("\n")
      : "No recent activity notes available.";

    // 3. Environment & Service Config
    const aiBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const aiApiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (!aiBaseUrl || !aiApiKey) { res.status(503).json({ error: "AI service not configured" }); return; }

    // 4. Financial Calculations & Data Cleaning
    const arv = lead.arv ? parseFloat(lead.arv) : null;
    const mao = lead.mao ? parseFloat(lead.mao) : null;

    // Handle "Want an offer" or text-based prices
    const askingPriceRaw = lead.askingPrice || "Want an offer";
    const askingPriceNum = parseFloat(askingPriceRaw.replace(/[^0-9.]/g, ""));

    const formattedMao = mao ? "$" + mao.toLocaleString() : "not set";
    const formattedAsking = isNaN(askingPriceNum) ? askingPriceRaw : "$" + askingPriceNum.toLocaleString();
    const suggestedOpening = mao ? (mao * 0.85).toLocaleString(undefined, { style: 'currency', currency: 'USD' }) : "a discounted price";

    const occupancyInfo = lead.isRental 
      ? `Currently rented ($${lead.rentalAmount}/mo) with tenant in place` 
      : (lead.occupancy || "unknown");

    const prompt = `You are a Real Estate Wholesale Investment Analyst. Analyze this deal for a BUYER.

FINANCIAL DATA:
- Our MAO (Absolute Ceiling): ${formattedMao}
- Seller Asking Price: ${formattedAsking}
- ARV: ${arv ? "$" + arv.toLocaleString() : "Unknown"}

SELLER CONTEXT & ACTIVITY LOG:
- Motivation: ${lead.reasonForSelling || "Not provided"}
- Timeline: ${lead.howSoon || "Not provided"}
- Occupancy: ${occupancyInfo}
- RECENT NOTES:
${activityLogSummary}

STRICT SCORING RULES:
1. Every "score" field MUST be an integer between 1 and 10.
2. 10 is the BEST outcome for the buyer (Safe, Profitable, Highly Motivated). 
3. Never use percentages (e.g., use 6 instead of 60).

Reply ONLY with this JSON:
{
  "score": 0,
  "grade": "A-F",
  "verdict": "Investor summary regarding the spread from ${formattedMao}.",
  "profitPotential": { "score": 0, "note": "Analysis of the profit spread relative to ${formattedMao}." },
  "sellerMotivation": { "score": 0, "note": "Analysis based on motivation and notes." },
  "dealRisk": { "score": 0, "note": "Analysis of repairs and ${occupancyInfo} and notes." },
  "urgency": { "score": 0, "note": "Analysis of the timeline." },
  "recommendation": "Suggest opening at ${suggestedOpening} and walking away at ${formattedMao}.",
  "redFlags": [],
  "positives": []
}`;

    const aiRes = await fetch(`${aiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${aiApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.1-70b-versatile", // Use the 70B model for accurate math/reasoning
        max_tokens: 1200,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are a Real Estate Wholesaling Coach. Your goal is to maximize buyer profit by keeping the purchase price below the MAO." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!aiRes.ok) { 
      const e = await aiRes.text().catch(() => ""); 
      console.error("AI deal score error:", e); 
      res.status(502).json({ error: "AI service returned an error." }); 
      return; 
    }

    const aiJson = await aiRes.json() as any;
    const raw = aiJson?.choices?.[0]?.message?.content || "";

    // Clean potential markdown or extra characters
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "").trim();

    res.json(JSON.parse(cleaned));
  } catch (err) {
    console.error("AI deal score error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});


// ─── AI Seller Script (Fixed for Hallucinations) ─────────────────────────────
router.post("/:id/ai-seller-script", crmAuth, async (req, res) => {
  // ... (keep lead fetching and auth logic the same) ...

  const mao = lead.mao ? parseFloat(lead.mao) : null;
  const askingPrice = lead.askingPrice ? parseFloat(lead.askingPrice) : null;
  const sanitizedNotes = (lead.notes || "none").substring(0, 800);
  const reason = lead.reasonForSelling || "Not provided";

  const prompt = `You are an expert real estate wholesaler coach. Generate a personalized phone call script.

DATA TO USE:
- Seller: ${lead.sellerName}
- Property: ${lead.address}, ${lead.city}
- Reason for Selling: ${reason}
- Our MAO: ${mao ? "$" + mao.toLocaleString() : "Not calculated yet"}
- Prev Call Notes: ${sanitizedNotes}

INSTRUCTIONS:
1. OPENING: Reference the property at ${lead.address}.
2. RAPPORT: Specifically mention their situation: "${reason}".
3. OBJECTIONS: Base the objections on the "Prev Call Notes". If notes are empty, use common wholesale objections.
4. OFFER: Use the MAO of ${mao ? "$" + mao.toLocaleString() : "a fair cash offer"} as your anchor.

Reply ONLY with this JSON structure:
{
  "opening": "Write a professional opening script...",
  "buildRapport": "Write a rapport building script based on ${reason}...",
  "discoverPain": "List 2-3 specific questions to uncover their motivation...",
  "presentOffer": "Script to present our offer based on the $${mao} target...",
  "handleObjections": [
    { "objection": "Anticipated objection based on notes", "response": "How to handle it" }
  ],
  "closing": "Next steps script...",
  "tipsForThisLead": ["Specific tip 1", "Specific tip 2"]
}`;

  const aiRes = await fetch(`${aiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${aiApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.AI_MODEL || "llama-3.1-70b-versatile",
      max_tokens: 1200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You are a real estate wholesaling coach. You must output valid JSON." },
        { role: "user", content: prompt },
      ],
    }),
  });

  // ... (keep the existing parsing and error handling) ...
});



// ─── AI Offer Letter (Fixed for Length and Hallucination) ─────────────────────
router.post("/:id/ai-offer-letter", crmAuth, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const crmUser = (req as any).crmUser;
  try {
    const [lead] = await db.select().from(crmLeads).where(eq(crmLeads.id, id)).limit(1);
    if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

    // Auth check (ensure user has access to this lead's campaign)
    if (crmUser.role !== "super_admin" && lead.campaignId !== crmUser.campaignId) {
      res.status(403).json({ error: "Access denied" }); return;
    }

    const aiBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const aiApiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (!aiBaseUrl || !aiApiKey) { res.status(503).json({ error: "AI service not configured" }); return; }

    const mao = lead.mao ? parseFloat(lead.mao) : null;
    const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const address = lead.address || "the property";

    const prompt = `Generate a professional real estate cash offer Letter of Intent (LOI).

DATA:
Date: ${today}
Seller: ${lead.sellerName || "Property Owner"}
Property: ${address}, ${lead.city}, ${lead.state}
Offer Price: ${mao ? "$" + mao.toLocaleString() : "[To be determined]"}
Timeline: ${lead.howSoon || "30 days"}
Company/Buyer: ${crmUser.name || "Our Investment Group"}

INSTRUCTIONS:
1. Subject line must include the address: ${address}.
2. Use professional, non-combative language.
3. Explicitly state the offer is ALL-CASH and "AS-IS".
4. Signature should use: ${crmUser.name || "Acquisitions Manager"}.

Reply ONLY with this JSON structure:
{
  "subject": "Cash Offer – ${address}",
  "letter": "Full letter text with double newlines (\\n\\n) for paragraphs. Must include greeting, the $${mao} price, as-is terms, and signature."
}`;

    const aiRes = await fetch(`${aiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${aiApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.1-70b-versatile", 
        // FIX: Increased to 1200. 400 is too short for a letter and will break the JSON.
        max_tokens: 1200, 
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are a professional real estate acquisitions specialist. Reply ONLY with valid JSON." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!aiRes.ok) { 
      const e = await aiRes.text().catch(() => ""); 
      console.error("AI offer letter error:", e); 
      res.status(502).json({ error: "AI service returned an error." }); 
      return; 
    }

    const aiJson = await aiRes.json() as any;
    const raw = aiJson?.choices?.[0]?.message?.content || "";
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "").trim();

    res.json(JSON.parse(cleaned));
  } catch (err) {
    console.error("AI offer letter error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

