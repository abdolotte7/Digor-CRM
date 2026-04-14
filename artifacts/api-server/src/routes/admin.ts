import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db, contactsTable, subscribersTable } from "@workspace/db";
import { eq, desc, count } from "drizzle-orm";
import * as ZodSchemas from "@workspace/api-zod";

// Accessing them from the namespace ensures TS treats them as values
const {
  AdminLoginBody,
  AdminLoginResponse,
  AdminGetContactsResponse,
  AdminGetSubscribersResponse,
  AdminGetStatsResponse,
  AdminMarkContactReadResponse,
} = ZodSchemas;

const router: IRouter = Router();

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET environment variable is not set");
  return secret;
}

function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const token = auth.slice(7);
    jwt.verify(token, getJwtSecret());
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

// POST /api/admin/login
router.post("/admin/login", async (req, res) => {
  const parseResult = AdminLoginBody.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid credentials format" });
    return;
  }
  const { username, password } = parseResult.data;
  const adminUser = process.env.ADMIN_USERNAME;
  const adminPass = process.env.ADMIN_PASSWORD;

  if (!adminUser || !adminPass) {
    res.status(500).json({ error: "Admin credentials not configured" });
    return;
  }

  if (username !== adminUser || password !== adminPass) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  const token = jwt.sign({ role: "admin", username }, getJwtSecret(), { expiresIn: "24h" });
  res.json(AdminLoginResponse.parse({ token, message: "Login successful" }));
});

// GET /api/admin/contacts
router.get("/admin/contacts", authMiddleware, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
  const offset = (page - 1) * limit;

  const [contacts, totalResult] = await Promise.all([
    db.select().from(contactsTable).orderBy(desc(contactsTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: count() }).from(contactsTable),
  ]);

  res.json(AdminGetContactsResponse.parse({
    contacts: contacts.map(c => ({ ...c, createdAt: c.createdAt.toISOString() })),
    total: totalResult[0].count,
    page,
    limit,
  }));
});

// PATCH /api/admin/contacts/:id/read
router.patch("/admin/contacts/:id/read", authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }
  await db.update(contactsTable).set({ read: true }).where(eq(contactsTable.id, id));
  res.json(AdminMarkContactReadResponse.parse({ success: true, message: "Marked as read" }));
});

// GET /api/admin/subscribers
router.get("/admin/subscribers", authMiddleware, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
  const offset = (page - 1) * limit;

  const [subscribers, totalResult] = await Promise.all([
    db.select().from(subscribersTable).orderBy(desc(subscribersTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: count() }).from(subscribersTable),
  ]);

  res.json(AdminGetSubscribersResponse.parse({
    subscribers: subscribers.map(s => ({ ...s, createdAt: s.createdAt.toISOString() })),
    total: totalResult[0].count,
    page,
    limit,
  }));
});

// GET /api/admin/stats
router.get("/admin/stats", authMiddleware, async (req, res) => {
  const [totalContacts, unreadContacts, totalSubscribers, recentContacts] = await Promise.all([
    db.select({ count: count() }).from(contactsTable),
    db.select({ count: count() }).from(contactsTable).where(eq(contactsTable.read, false)),
    db.select({ count: count() }).from(subscribersTable),
    db.select().from(contactsTable).orderBy(desc(contactsTable.createdAt)).limit(5),
  ]);

  res.json(AdminGetStatsResponse.parse({
    totalContacts: totalContacts[0].count,
    unreadContacts: unreadContacts[0].count,
    totalSubscribers: totalSubscribers[0].count,
    recentContacts: recentContacts.map(c => ({ ...c, createdAt: c.createdAt.toISOString() })),
  }));
});

export default router;
