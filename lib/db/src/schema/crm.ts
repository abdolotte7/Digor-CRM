import { pgTable, serial, text, integer, numeric, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const crmCampaigns = pgTable("crm_campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  active: boolean("active").notNull().default(true),
  maxUsers: integer("max_users"),
  allowLeadDeletion: boolean("allow_lead_deletion").notNull().default(false),
  ownerUserId: integer("owner_user_id"),
  skipTraceDailyLimit: integer("skip_trace_daily_limit").notNull().default(1),
  fetchCompsDailyLimit: integer("fetch_comps_daily_limit").notNull().default(1),
  openPhoneNumberId: text("openphone_number_id"),
  openPhoneNumber: text("openphone_number"),
  dialerEnabled: boolean("dialer_enabled").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const crmUsers = pgTable("crm_users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  encryptedPassword: text("encrypted_password"),
  role: text("role").notNull().default("sales"),
  status: text("status").notNull().default("active"),
  campaignId: integer("campaign_id").references(() => crmCampaigns.id),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const crmLeads = pgTable("crm_leads", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").references(() => crmCampaigns.id),
  sellerName: text("seller_name").notNull(),
  phone: text("phone"),
  email: text("email"),
  leadSource: text("lead_source"),
  skipTracedPhones: text("skip_traced_phones"),
  skipTracedEmails: text("skip_traced_emails"),
  skipTracedName: text("skip_traced_name"),
  address: text("address").notNull(),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  propertyType: text("property_type"),
  beds: integer("beds"),
  baths: numeric("baths", { precision: 4, scale: 1 }),
  sqft: integer("sqft"),
  yearBuilt: integer("year_built"),
  ownerName: text("owner_name"),
  lastSaleDate: text("last_sale_date"),
  lastSalePrice: numeric("last_sale_price", { precision: 12, scale: 2 }),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  condition: integer("condition"),
  currentValue: numeric("current_value", { precision: 12, scale: 2 }),
  estimatedRepairCost: numeric("estimated_repair_cost", { precision: 12, scale: 2 }),
  arv: numeric("arv", { precision: 12, scale: 2 }),
  mao: numeric("mao", { precision: 12, scale: 2 }),
  occupancy: text("occupancy"),
  isRental: boolean("is_rental").notNull().default(false),
  rentalAmount: numeric("rental_amount", { precision: 12, scale: 2 }),
  reasonForSelling: text("reason_for_selling"),
  howSoon: text("how_soon"),
  askingPrice: numeric("asking_price", { precision: 12, scale: 2 }),
  askingPriceText: text("asking_price_text"),
  rentcastAvmValue: numeric("rentcast_avm_value", { precision: 12, scale: 2 }),
  rentcastAvmLow: numeric("rentcast_avm_low", { precision: 12, scale: 2 }),
  rentcastAvmHigh: numeric("rentcast_avm_high", { precision: 12, scale: 2 }),
  rentcastAvmFetchedAt: timestamp("rentcast_avm_fetched_at"),
  attomAvmValue: numeric("attom_avm_value", { precision: 12, scale: 2 }),
  attomAvmLow: numeric("attom_avm_low", { precision: 12, scale: 2 }),
  attomAvmHigh: numeric("attom_avm_high", { precision: 12, scale: 2 }),
  attomAvmConfidence: integer("attom_avm_confidence"),
  attomAvmFetchedAt: timestamp("attom_avm_fetched_at"),
  notes: text("notes"),
  status: text("status").notNull().default("new"),
  archived: boolean("archived").notNull().default(false),
  archivedAt: timestamp("archived_at"),
  assignedTo: integer("assigned_to").references(() => crmUsers.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("crm_leads_campaign_id_idx").on(t.campaignId),
  index("crm_leads_status_idx").on(t.status),
  index("crm_leads_archived_idx").on(t.archived),
  index("crm_leads_assigned_to_idx").on(t.assignedTo),
  index("crm_leads_created_at_idx").on(t.createdAt),
  // Composite: most common query is "active leads for a campaign ordered by date"
  index("crm_leads_campaign_archived_created_idx").on(t.campaignId, t.archived, t.createdAt),
]);

export const crmNotes = pgTable("crm_notes", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => crmLeads.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => crmUsers.id),
  content: text("content").notNull(),
  noteType: text("note_type").notNull().default("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("crm_notes_lead_id_idx").on(t.leadId),
]);

export const crmLeadFollowers = pgTable("crm_lead_followers", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => crmLeads.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => crmUsers.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("crm_lead_followers_lead_id_idx").on(t.leadId),
]);

export const crmNotifications = pgTable("crm_notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => crmUsers.id, { onDelete: "cascade" }),
  leadId: integer("lead_id").references(() => crmLeads.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("update"),
  content: text("content").notNull(),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const crmOpenPhoneMessages = pgTable("crm_openphone_messages", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").references(() => crmLeads.id, { onDelete: "cascade" }),
  campaignId: integer("campaign_id").references(() => crmCampaigns.id),
  openPhoneMessageId: text("openphone_message_id").unique(),
  direction: text("direction").notNull(),
  fromNumber: text("from_number"),
  toNumber: text("to_number"),
  content: text("content"),
  status: text("status"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("crm_op_messages_lead_id_idx").on(t.leadId),
  index("crm_op_messages_from_number_idx").on(t.fromNumber),
  index("crm_op_messages_created_at_idx").on(t.createdAt),
]);

export const crmTasks = pgTable("crm_tasks", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").references(() => crmCampaigns.id),
  leadId: integer("lead_id").references(() => crmLeads.id, { onDelete: "set null" }),
  assignedTo: integer("assigned_to").references(() => crmUsers.id),
  title: text("title").notNull(),
  description: text("description"),
  dueDate: timestamp("due_date"),
  status: text("status").notNull().default("pending"),
  priority: text("priority").notNull().default("normal"),
  source: text("source").notNull().default("manual"),
  escalated: boolean("escalated").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("crm_tasks_lead_id_idx").on(t.leadId),
]);

export const crmEmailSequences = pgTable("crm_email_sequences", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").references(() => crmCampaigns.id),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const crmSequenceSteps = pgTable("crm_sequence_steps", {
  id: serial("id").primaryKey(),
  sequenceId: integer("sequence_id").notNull().references(() => crmEmailSequences.id, { onDelete: "cascade" }),
  dayOffset: integer("day_offset").notNull().default(0),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const crmSequenceLogs = pgTable("crm_sequence_logs", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => crmLeads.id, { onDelete: "cascade" }),
  sequenceId: integer("sequence_id").notNull().references(() => crmEmailSequences.id, { onDelete: "cascade" }),
  stepId: integer("step_id").notNull().references(() => crmSequenceSteps.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("sent"),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
});

export const crmComps = pgTable("crm_comps", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => crmLeads.id, { onDelete: "cascade" }),
  address: text("address").notNull(),
  beds: integer("beds"),
  baths: numeric("baths", { precision: 4, scale: 1 }),
  sqft: integer("sqft"),
  yearBuilt: integer("year_built"),
  salePrice: numeric("sale_price", { precision: 12, scale: 2 }),
  adjustedPrice: numeric("adjusted_price", { precision: 12, scale: 2 }),
  soldDate: text("sold_date"),
  notes: text("notes"),
  source: text("source").notNull().default("manual"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("crm_comps_lead_id_idx").on(t.leadId),
]);

export const crmBuyers = pgTable("crm_buyers", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").references(() => crmCampaigns.id),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  notes: text("notes"),
  uploadedBy: integer("uploaded_by").references(() => crmUsers.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const crmSubmissionLinks = pgTable("crm_submission_links", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").references(() => crmCampaigns.id),
  token: text("token").notNull().unique(),
  label: text("label"),
  leadSource: text("lead_source"),
  active: boolean("active").notNull().default(true),
  createdBy: integer("created_by").references(() => crmUsers.id),
  submissionsCount: integer("submissions_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});