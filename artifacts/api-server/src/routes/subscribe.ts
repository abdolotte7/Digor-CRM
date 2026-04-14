import { Router, type IRouter } from "express";
import * as ZodSchemas from "@workspace/api-zod";
const { SubmitSubscribeBody, SubmitSubscribeResponse } = ZodSchemas;
import { db, subscribersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
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

router.post("/subscribe", async (req, res) => {
  const parseResult = SubmitSubscribeBody.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid request data." });
    return;
  }

  const { name, email, company, plan } = parseResult.data;

  // Check for existing subscriber
  try {
    const existing = await db.select().from(subscribersTable).where(eq(subscribersTable.email, email)).limit(1);
    if (existing.length === 0) {
      await db.insert(subscribersTable).values({ name, email, company, plan: plan || "basic", status: "pending" });
    }
  } catch (err) {
    req.log.error({ err }, "Failed to save subscriber");
  }

  // Notify admin
  const transporter = createTransporter();
  if (transporter) {
    try {
      await transporter.sendMail({
        from: `"Digor LLC Website" <${process.env.SMTP_USER}>`,
        to: "digorva@digorcom.com",
        cc: "info@digorcom.com, martin@digorcom.com",
        replyTo: email,
        subject: `New Subscription Intent: ${name} — Basic Plan ($1,500/mo)`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
            <div style="background:#0a0e1a;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
              <h1 style="color:#d4af37;margin:0;">DIGOR LLC</h1>
              <p style="color:#aaa;margin:8px 0 0;">New Subscription Intent</p>
            </div>
            <div style="background:#fff;padding:32px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;">
              <h2>Subscription Request: Basic Plan — $1,500/month</h2>
              <table style="width:100%;border-collapse:collapse;">
                <tr><td style="padding:8px 0;font-weight:bold;color:#555;width:120px;">Name:</td><td>${name}</td></tr>
                <tr><td style="padding:8px 0;font-weight:bold;color:#555;">Email:</td><td><a href="mailto:${email}">${email}</a></td></tr>
                <tr><td style="padding:8px 0;font-weight:bold;color:#555;">Company:</td><td>${company || "Not provided"}</td></tr>
                <tr><td style="padding:8px 0;font-weight:bold;color:#555;">Plan:</td><td>Basic — $1,500/month</td></tr>
              </table>
              <p style="margin-top:16px;color:#888;font-size:12px;">This subscriber is pending payment setup. Follow up to complete onboarding.</p>
            </div>
          </div>
        `,
      });
    } catch (err) {
      req.log.error({ err }, "Failed to send subscriber notification email");
    }
  }

  res.json(SubmitSubscribeResponse.parse({
    success: true,
    message: "Your subscription interest has been recorded. Our team will contact you shortly to complete onboarding.",
  }));
});

export default router;
