function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function onRequestPost({ request, env }) {
  const jsonHeaders = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    let data;
    try {
      data = await request.json();
    } catch {
      return new Response(JSON.stringify({ ok: false, error: "Invalid JSON body" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    if (!data || typeof data !== "object") {
      return new Response(JSON.stringify({ ok: false, error: "Request payload must be an object" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    // Honeypot check: silently return 200 { ok: true } if website_trap is non-empty
    if (data.website_trap && typeof data.website_trap === "string" && data.website_trap.trim().length > 0) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: jsonHeaders,
      });
    }

    // Extract & trim fields
    const name = typeof data.name === "string" ? data.name.trim().slice(0, 150) : "";
    const email = typeof data.email === "string" ? data.email.trim().slice(0, 254) : "";
    const phone = typeof data.phone === "string" ? data.phone.trim().slice(0, 50) : "";
    const country = typeof data.country === "string" ? data.country.trim().slice(0, 100) : "";
    const service = typeof data.service === "string" ? data.service.trim().slice(0, 100) : "";
    const message = typeof data.message === "string" ? data.message.trim().slice(0, 5000) : "";
    const source_page = typeof data.source_page === "string" ? data.source_page.trim().slice(0, 200) : "";

    // Required fields validation
    if (!name) {
      return new Response(JSON.stringify({ ok: false, error: "Name is required" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }
    if (!email || !email.includes("@") || !email.includes(".")) {
      return new Response(JSON.stringify({ ok: false, error: "Valid email is required" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }
    if (!phone) {
      return new Response(JSON.stringify({ ok: false, error: "Phone number is required" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }
    if (!message) {
      return new Response(JSON.stringify({ ok: false, error: "Message is required" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    // Supabase credentials
    const supabaseUrl = (env?.SUPABASE_URL || "").trim().replace(/\/+$/, "");
    const serviceKey = (env?.SUPABASE_SERVICE_ROLE_KEY || "").trim();

    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ ok: false, error: "Supabase environment variables missing" }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    const sbResponse = await fetch(`${supabaseUrl}/rest/v1/leads`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({
        name,
        email,
        phone,
        country,
        service,
        message,
        source_page,
      }),
    });

    if (!sbResponse.ok) {
      const errorDetails = await sbResponse.text().catch(() => "");
      return new Response(JSON.stringify({ ok: false, error: errorDetails || `Supabase responded with HTTP ${sbResponse.status}` }), {
        status: 502,
        headers: jsonHeaders,
      });
    }

    // Lead saved to Supabase successfully. Now dispatch Resend email alert and Google Sheets webhook in parallel
    let emailed = false;
    let sheetSaved = false;

    const resendApiKey = (env?.RESEND_API_KEY || "").trim();
    const isResendConfigured = resendApiKey && !resendApiKey.includes("re_your_resend_api_key_here");
    const sheetsWebhookUrl = (env?.GOOGLE_SHEETS_WEBHOOK_URL || "").trim();
    const sheetsSecret = (env?.GOOGLE_SHEETS_SECRET || "").trim();

    const sendEmail = async () => {
      if (!isResendConfigured) return;
      const resendFrom = (env?.RESEND_FROM_EMAIL || "").trim() || "Enraux <onboarding@resend.dev>";
      const resendTo = (env?.RESEND_TO_EMAIL || "").trim() || "hello@enraux.com";
      const resendSendConfirmation = (env?.RESEND_SEND_CONFIRMATION || "").trim().toLowerCase();

      const safeName = escapeHtml(name);
      const safeEmail = escapeHtml(email);
      const safePhone = escapeHtml(phone);
      const safeCountry = escapeHtml(country || "Not specified");
      const safeService = escapeHtml(service || "Not specified");
      const safeSource = escapeHtml(source_page || "Direct");
      const safeMessage = escapeHtml(message).replace(/\n/g, "<br>");

      const alertHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>New Sprint Lead</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #0b0c10; color: #f5f5f7; margin: 0; padding: 32px 16px; }
    .card { max-width: 580px; margin: 0 auto; background: #14151b; border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; padding: 32px; box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
    h1 { font-size: 20px; font-weight: 600; margin: 0 0 24px 0; color: #ffffff; letter-spacing: -0.02em; }
    .badge { display: inline-block; background: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3); padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 500; margin-bottom: 20px; }
    .row { display: flex; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 14px; }
    .label { width: 140px; font-weight: 500; color: rgba(255,255,255,0.5); flex-shrink: 0; }
    .value { color: #f5f5f7; word-break: break-word; font-weight: 500; }
    .value a { color: #60a5fa; text-decoration: none; }
    .message-box { margin-top: 20px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 16px; font-size: 14px; line-height: 1.6; color: #e2e8f0; }
    .footer { margin-top: 24px; font-size: 12px; color: rgba(255,255,255,0.4); text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">New Sprint Lead</div>
    <h1>${safeName} requested a sprint</h1>
    <div class="row"><div class="label">Name:</div><div class="value">${safeName}</div></div>
    <div class="row"><div class="label">Email:</div><div class="value"><a href="mailto:${safeEmail}">${safeEmail}</a></div></div>
    <div class="row"><div class="label">WhatsApp / Phone:</div><div class="value">${safePhone}</div></div>
    <div class="row"><div class="label">Country:</div><div class="value">${safeCountry}</div></div>
    <div class="row"><div class="label">Service:</div><div class="value">${safeService}</div></div>
    <div class="row"><div class="label">Source Page:</div><div class="value">${safeSource}</div></div>
    <div style="margin-top: 18px; font-weight: 500; font-size: 13px; color: rgba(255,255,255,0.5);">Message / Project Scope:</div>
    <div class="message-box">${safeMessage}</div>
    <div class="footer">Enraux Conversion Architecture &bull; Lead Notification</div>
  </div>
</body>
</html>`;

      const alertText = `New Sprint Lead Received:

Name: ${name}
Email: ${email}
WhatsApp / Phone: ${phone}
Country: ${country || "Not specified"}
Service: ${service || "Not specified"}
Source Page: ${source_page || "Direct"}

Message:
${message}
`;

      try {
        const resendRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
            "User-Agent": "Enraux-Website/1.0",
          },
          body: JSON.stringify({
            from: resendFrom,
            to: [resendTo],
            reply_to: email,
            subject: `New Sprint Lead: ${name}${service ? " — " + service : ""}`,
            html: alertHtml,
            text: alertText,
          }),
        });

        if (resendRes.ok) {
          emailed = true;

          // Optional user confirmation email (only if using a custom verified sender, avoiding 403 on onboarding@resend.dev)
          if (resendSendConfirmation === "true" && !resendFrom.includes("onboarding@resend.dev")) {
            try {
              const confirmHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #0b0c10; color: #f5f5f7; margin: 0; padding: 32px 16px; }
    .card { max-width: 540px; margin: 0 auto; background: #14151b; border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; padding: 32px; box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
    h1 { font-size: 20px; font-weight: 600; margin: 0 0 16px 0; color: #ffffff; }
    p { font-size: 15px; line-height: 1.6; color: #cbd5e1; margin: 0 0 16px 0; }
    .footer { margin-top: 24px; font-size: 12px; color: rgba(255,255,255,0.4); }
  </style>
</head>
<body>
  <div class="card">
    <h1>Thank you, ${safeName}</h1>
    <p>We received your Sprint brief &mdash; our team will reach out shortly via WhatsApp or email.</p>
    <div class="footer">&mdash; Enraux Team</div>
  </div>
</body>
</html>`;
              const confirmText = `Hi ${name},\n\nWe received your Sprint brief — our team will reach out shortly via WhatsApp or email.\n\n— Enraux Team`;

              await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${resendApiKey}`,
                  "Content-Type": "application/json",
                  "User-Agent": "Enraux-Website/1.0",
                },
                body: JSON.stringify({
                  from: resendFrom,
                  to: [email],
                  reply_to: resendTo,
                  subject: "We received your sprint brief — Enraux",
                  html: confirmHtml,
                  text: confirmText,
                }),
              });
            } catch (confirmErr) {
              console.error("Resend confirmation email error:", confirmErr);
            }
          }
        } else {
          const resendErr = await resendRes.text().catch(() => "");
          console.error(`Resend email delivery failed (${resendRes.status}):`, resendErr);
        }
      } catch (emailErr) {
        console.error("Resend email request exception:", emailErr);
      }
    };

    const postToSheets = async () => {
      if (!sheetsWebhookUrl) return;
      try {
        const sheetRes = await fetch(sheetsWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          redirect: "follow",
          body: JSON.stringify({
            secret: sheetsSecret || "",
            name,
            email,
            phone,
            country,
            service,
            message,
            source_page,
          }),
        });

        if (sheetRes.ok) {
          try {
            const resText = await sheetRes.text();
            try {
              const resJson = JSON.parse(resText);
              if (resJson && (resJson.status === "error" || resJson.ok === false || resJson.error)) {
                console.error("Google Sheets webhook error response:", resJson.error || resJson);
              } else {
                sheetSaved = true;
              }
            } catch {
              // Non-JSON response (e.g. plain text "Success" or 200 OK)
              sheetSaved = true;
            }
          } catch (parseErr) {
            console.error("Google Sheets response parse error:", parseErr);
            sheetSaved = true;
          }
        } else {
          const errText = await sheetRes.text().catch(() => "");
          console.error(`Google Sheets webhook HTTP error (${sheetRes.status}):`, errText);
        }
      } catch (sheetsErr) {
        console.error("Google Sheets webhook exception:", sheetsErr);
      }
    };

    const notificationTasks = [];
    if (isResendConfigured) {
      notificationTasks.push(sendEmail());
    }
    if (sheetsWebhookUrl) {
      notificationTasks.push(postToSheets());
    }
    if (notificationTasks.length > 0) {
      await Promise.allSettled(notificationTasks);
    }

    return new Response(JSON.stringify({ ok: true, emailed, sheetSaved }), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err?.message || "Internal server error" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
}
