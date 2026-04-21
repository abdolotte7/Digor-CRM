import { db } from "@workspace/db";
import { crmTasks, crmUsers, crmCampaigns, crmNotifications, crmLeadFollowers, crmLeads } from "@workspace/db/schema";
import { eq, and, lte, lt, gt, ne } from "drizzle-orm";
import { sendEmail, buildNewLeadEmail, buildTaskReminderEmail } from "./emailService";
import { logger } from "../lib/logger";

async function getCampaignAdmin(campaignId: number) {
  const [campaign] = await db.select().from(crmCampaigns).where(eq(crmCampaigns.id, campaignId)).limit(1);
  if (campaign?.ownerUserId) {
    const [owner] = await db.select().from(crmUsers).where(eq(crmUsers.id, campaign.ownerUserId)).limit(1);
    if (owner) return { admin: owner, campaign };
  }
  const [firstAdmin] = await db.select().from(crmUsers)
    .where(and(eq(crmUsers.campaignId, campaignId), eq(crmUsers.role, "admin"), eq(crmUsers.status, "active")))
    .limit(1);
  return { admin: firstAdmin || null, campaign: campaign || null };
}

export async function onLeadCreated(opts: {
  leadId: number;
  address: string;
  campaignId: number;
  actorUserId: number;
  actorName: string;
}) {
  const { leadId, address, campaignId, actorUserId, actorName } = opts;

  try {
    const { admin, campaign } = await getCampaignAdmin(campaignId);
    const campaignName = campaign?.name || "Your Campaign";

    const dueDate = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.insert(crmTasks).values({
      campaignId,
      leadId,
      assignedTo: admin?.id || null,
      title: "Call lead within 24h",
      description: `New lead added: ${address}. Follow up with a call within 24 hours.`,
      dueDate,
      status: "pending",
      priority: "high",
      source: "automation",
      escalated: false,
    });

    if (admin?.id && admin.id !== actorUserId) {
      await db.insert(crmNotifications).values({
        userId: admin.id,
        leadId,
        type: "task_created",
        content: `Auto-task created: "Call lead within 24h" for ${address}`,
        read: false,
      });
    }

    const campaignUsers = await db.select().from(crmUsers)
      .where(and(eq(crmUsers.campaignId, campaignId), eq(crmUsers.status, "active")));

    for (const user of campaignUsers) {
      if (user.email) {
        sendEmail({
          to: user.email,
          subject: `New Lead Added: ${address}`,
          html: buildNewLeadEmail({
            userName: user.name,
            address,
            leadId,
            campaignName,
            submittedBy: actorName,
          }),
        }).catch(() => {});
      }
    }
  } catch (err) {
    console.error("[automation] onLeadCreated error:", err);
  }
}

export async function onLeadStatusChanged(leadId: number, oldStatus: string, newStatus: string) {
  const closedStatuses = ["closed_won", "closed_lost", "closed", "dead", "not_interested"];
  if (closedStatuses.includes(newStatus) && !closedStatuses.includes(oldStatus)) {
    try {
      const result = await db.update(crmTasks)
        .set({ status: "completed" })
        .where(and(eq(crmTasks.leadId, leadId), eq(crmTasks.status, "pending")))
        .returning({ id: crmTasks.id, title: crmTasks.title });

      if (result.length > 0) {
        const [lead] = await db.select({ assignedTo: crmLeads.assignedTo, campaignId: crmLeads.campaignId })
          .from(crmLeads).where(eq(crmLeads.id, leadId)).limit(1);

        if (lead?.assignedTo) {
          await db.insert(crmNotifications).values({
            userId: lead.assignedTo,
            leadId,
            type: "tasks_autoclosed",
            content: `${result.length} task(s) automatically closed — lead marked as ${newStatus.replace(/_/g, " ")}`,
            read: false,
          });
        }
      }
    } catch (err) {
      console.error("[automation] onLeadStatusChanged error:", err);
    }
  }
}

export async function onTaskCreated(taskId: number, assignedTo: number | null, leadId: number | null, title: string, actorUserId: number) {
  if (!assignedTo || assignedTo === actorUserId) return;
  try {
    let leadAddress: string | null = null;
    if (leadId) {
      const [lead] = await db.select({ address: crmLeads.address }).from(crmLeads).where(eq(crmLeads.id, leadId)).limit(1);
      leadAddress = lead?.address || null;
    }
    await db.insert(crmNotifications).values({
      userId: assignedTo,
      leadId,
      type: "task_assigned",
      content: `You've been assigned a task: "${title}"${leadAddress ? ` for ${leadAddress}` : ""}`,
      read: false,
    });
  } catch (err) {
    console.error("[automation] onTaskCreated error:", err);
  }
}

export async function runTaskAutomationCron() {
  logger.info("[automation] Running task cron...");
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  try {
    const soonTasks = await db.select({
      id: crmTasks.id,
      title: crmTasks.title,
      leadId: crmTasks.leadId,
      assignedTo: crmTasks.assignedTo,
      dueDate: crmTasks.dueDate,
      userName: crmUsers.name,
      userEmail: crmUsers.email,
      leadAddress: crmLeads.address,
    }).from(crmTasks)
      .leftJoin(crmUsers, eq(crmTasks.assignedTo, crmUsers.id))
      .leftJoin(crmLeads, eq(crmTasks.leadId, crmLeads.id))
      .where(
        and(
          eq(crmTasks.status, "pending"),
          eq(crmTasks.escalated, false),
          lte(crmTasks.dueDate, in24h),
          gt(crmTasks.dueDate, now),
        )
      );

    for (const task of soonTasks) {
      if (!task.assignedTo) continue;
      await db.insert(crmNotifications).values({
        userId: task.assignedTo,
        leadId: task.leadId,
        type: "task_reminder",
        content: `Reminder: "${task.title}" is due within 24 hours`,
        read: false,
      });

      if (task.userEmail && task.dueDate) {
        sendEmail({
          to: task.userEmail,
          subject: `Task Due Soon: ${task.title}`,
          html: buildTaskReminderEmail({
            userName: task.userName || "Team Member",
            taskTitle: task.title,
            address: task.leadAddress || null,
            dueDate: task.dueDate.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }),
            leadId: task.leadId,
          }),
        }).catch(() => {});
      }
    }

    const overdueTasks = await db.select({
      id: crmTasks.id,
      title: crmTasks.title,
      leadId: crmTasks.leadId,
      assignedTo: crmTasks.assignedTo,
      campaignId: crmTasks.campaignId,
      dueDate: crmTasks.dueDate,
      leadAddress: crmLeads.address,
    }).from(crmTasks)
      .leftJoin(crmLeads, eq(crmTasks.leadId, crmLeads.id))
      .where(
        and(
          eq(crmTasks.status, "pending"),
          eq(crmTasks.escalated, false),
          lt(crmTasks.dueDate, now),
        )
      );

    for (const task of overdueTasks) {
      const notified = new Set<number>();

      if (task.assignedTo) {
        await db.insert(crmNotifications).values({
          userId: task.assignedTo,
          leadId: task.leadId,
          type: "task_overdue",
          content: `Your task "${task.title}" is overdue`,
          read: false,
        });
        notified.add(task.assignedTo);
      }

      if (task.campaignId) {
        const { admin } = await getCampaignAdmin(task.campaignId);
        if (admin && !notified.has(admin.id)) {
          await db.insert(crmNotifications).values({
            userId: admin.id,
            leadId: task.leadId,
            type: "task_overdue",
            content: `Overdue task: "${task.title}"${task.leadAddress ? ` for ${task.leadAddress}` : ""} needs attention`,
            read: false,
          });
        }
      }

      await db.update(crmTasks).set({ escalated: true }).where(eq(crmTasks.id, task.id));
    }

    logger.info(`[automation] Cron done — ${soonTasks.length} reminders, ${overdueTasks.length} escalations`);
  } catch (err) {
    console.error("[automation] runTaskAutomationCron error:", err);
  }
}
