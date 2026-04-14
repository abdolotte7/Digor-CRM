import { Router, type IRouter } from "express";
import * as ZodSchemas from "@workspace/api-zod";
const { SubmitContactBody, SubmitContactResponse } = ZodSchemas;
import { db, contactsTable } from "@workspace/db";
import nodemailer from "nodemailer";

const router: IRouter = Router();

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host, port, secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });
}

router.post("/contact", async (req, res) => {
  const parseResult = SubmitContactBody.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid request data." });
    return;
  }

  const { name, email, company, phone, message, service } = parseResult.data;
  const serviceLabels: Record<string, string> = {
    "data-engineering": "Data Engineering",
    "managed-outreach": "Managed Outreach Operations",
    "crm-infrastructure": "Technical CRM Infrastructure",
    "full-suite": "Full Suite Managed Infrastructure",
  };
  const serviceLabel = service ? (serviceLabels[service] || service) : "Not specified";

  // Save to database
  try {
    await db.insert(contactsTable).values({ name, email, company, phone, service, message });
  } catch (err) {
    req.log.error({ err }, "Failed to save contact to database");
  }

  // Send email
  const emailHtml = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f9f9f9;">
      <div style="background:#0a0e1a;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
        <h1 style="color:#d4af37;margin:0;font-size:24px;">DIGOR LLC</h1>
        <p style="color:#aaa;margin:8px 0 0;font-size:13px;">New Contact Form Inquiry</p>
      </div>
      <div style="background:#fff;padding:32px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;">
        <h2 style="color:#0a0e1a;margin-top:0;">New Inquiry from ${name}</h2>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:8px 0;font-weight:bold;color:#555;width:140px;">Name:</td><td style="padding:8px 0;color:#222;">${name}</td></tr>
          <tr><td style="padding:8px 0;font-weight:bold;color:#555;">Email:</td><td style="padding:8px 0;color:#222;"><a href="mailto:${email}" style="color:#d4af37;">${email}</a></td></tr>
          <tr><td style="padding:8px 0;font-weight:bold;color:#555;">Company:</td><td style="padding:8px 0;color:#222;">${company || "Not provided"}</td></tr>
          <tr><td style="padding:8px 0;font-weight:bold;color:#555;">Phone:</td><td style="padding:8px 0;color:#222;">${phone || "Not provided"}</td></tr>
          <tr><td style="padding:8px 0;font-weight:bold;color:#555;">Service:</td><td style="padding:8px 0;color:#222;">${serviceLabel}</td></tr>
        </table>
        <div style="margin-top:24px;padding:16px;background:#f5f5f5;border-left:4px solid #d4af37;border-radius:4px;">
          <p style="font-weight:bold;color:#555;margin:0 0 8px;">Message:</p>
          <p style="color:#222;margin:0;line-height:1.6;">${message.replace(/\n/g, "<br>")}</p>
        </div>
        <p style="margin-top:24px;color:#888;font-size:12px;border-top:1px solid #eee;padding-top:16px;">
          Digor LLC | 1095 Sugar View Dr Ste 500, Sheridan, WY 82801
        </p>
      </div>
    </div>
  `;

  const transporter = createTransporter();
  if (transporter) {
    try {
      await transporter.sendMail({
        from: `"Digor LLC Website" <${process.env.SMTP_USER}>`,
        to: "digorva@digorcom.com",
        cc: "info@digorcom.com, martin@digorcom.com",
        replyTo: email,
        subject: `New Inquiry from ${name} — ${serviceLabel}`,
        html: emailHtml,
        text: `New inquiry from ${name}\nEmail: ${email}\nCompany: ${company || "N/A"}\nPhone: ${phone || "N/A"}\nService: ${serviceLabel}\n\nMessage:\n${message}`,
      });
      req.log.info({ name, email }, "Contact email sent");
    } catch (err) {
      req.log.error({ err }, "Failed to send contact email");
    }
  } else {
    req.log.warn("SMTP not configured — email not sent");
  }

  res.json(SubmitContactResponse.parse({
    success: true,
    message: "Thank you for your inquiry. A member of our team will be in touch within one business day.",
  }));
});

export default router;
