interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(opts: SendEmailOptions): Promise<boolean> {
  if (!process.env.BREVO_API_KEY || !process.env.BREVO_SENDER_EMAIL) return false;
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: "Digor CRM", email: process.env.BREVO_SENDER_EMAIL },
        to: [{ email: opts.to }],
        subject: opts.subject,
        htmlContent: opts.html,
        textContent: opts.text,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("[emailService] Failed to send email:", err);
    return false;
  }
}

export function buildNewLeadEmail(opts: {
  userName: string;
  address: string;
  leadId: number;
  campaignName: string;
  submittedBy: string;
}): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
      <div style="background: #1a2332; padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="color: #4f8cf7; margin: 0; font-size: 22px;">Digor CRM</h1>
        <p style="color: #9ea8ae; margin: 4px 0 0;">New Lead Notification</p>
      </div>
      <div style="background: #f9fafb; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb; border-top: none;">
        <p style="margin: 0 0 16px;">Hello <strong>${opts.userName}</strong>,</p>
        <p style="margin: 0 0 24px;">A new lead has been added to your <strong>${opts.campaignName}</strong> campaign by <strong>${opts.submittedBy}</strong>.</p>
        <div style="background: white; border: 1px solid #e5e7eb; border-left: 4px solid #4f8cf7; border-radius: 8px; padding: 20px; margin: 0 0 24px;">
          <p style="margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #6b7280;">Property Address</p>
          <p style="margin: 0; font-size: 18px; font-weight: 600;">${opts.address}</p>
        </div>
        <p style="margin: 0 0 8px; font-size: 14px; color: #6b7280;">A follow-up task has been automatically created. Log in to review the lead and take action.</p>
        <a href="https://digorva.com/crm/leads/${opts.leadId}"
           style="display: inline-block; background: #4f8cf7; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 16px;">
          View Lead in Digor CRM
        </a>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;" />
        <p style="margin: 0; font-size: 12px; color: #9ea8ae;">Digor LLC &bull; <a href="https://digorva.com" style="color: #4f8cf7;">digorva.com</a> &bull; Automated notification from Digor CRM</p>
      </div>
    </div>
  `;
}

export function buildTaskReminderEmail(opts: {
  userName: string;
  taskTitle: string;
  address: string | null;
  dueDate: string;
  leadId: number | null;
}): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
      <div style="background: #1a2332; padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="color: #4f8cf7; margin: 0; font-size: 22px;">Digor CRM</h1>
        <p style="color: #9ea8ae; margin: 4px 0 0;">Task Reminder</p>
      </div>
      <div style="background: #f9fafb; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb; border-top: none;">
        <p style="margin: 0 0 16px;">Hello <strong>${opts.userName}</strong>,</p>
        <p style="margin: 0 0 24px;">You have a task due soon:</p>
        <div style="background: white; border: 1px solid #e5e7eb; border-left: 4px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 0 0 24px;">
          <p style="margin: 0 0 8px; font-weight: 600; font-size: 16px;">${opts.taskTitle}</p>
          ${opts.address ? `<p style="margin: 4px 0; color: #6b7280; font-size: 14px;">📍 ${opts.address}</p>` : ""}
          <p style="margin: 4px 0; color: #f59e0b; font-size: 14px; font-weight: 600;">⏰ Due: ${opts.dueDate}</p>
        </div>
        ${opts.leadId ? `<a href="https://digorva.com/crm/leads/${opts.leadId}" style="display: inline-block; background: #4f8cf7; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600;">View Lead</a>` : ""}
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;" />
        <p style="margin: 0; font-size: 12px; color: #9ea8ae;">Digor LLC &bull; Automated reminder from Digor CRM</p>
      </div>
    </div>
  `;
}
