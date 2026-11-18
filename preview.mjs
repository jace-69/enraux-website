import http from "http";
import fs from "fs";
import path from "path";

const PORT = 4322;

// Helper to escape HTML characters before constructing email templates
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Load .env file safely without third-party dependencies
function loadEnvFile() {
  const envPath = path.join(process.cwd(), ".env");
  const env = {};
  if (fs.existsSync(envPath)) {
    try {
      const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          env[key] = val;
        }
      }
    } catch (e) {
      console.warn("Could not read .env file:", e);
    }
  }
  return { ...process.env, ...env };
}

// Canonical Blog Slug Mapping (maps old long slugs, CMS slugs, and short slugs to strictly the 8 canonical files)
const blogAliases = {
  // Post 1
  "why-sending-paid-traffic-to-your-homepage-is-burning-half-your-ad-spend": "blog-homepage-traffic",
  "blog-homepage-traffic": "blog-homepage-traffic",
  // Post 2
  "creative-fatigue-is-killing-your-roas-why-modern-brands-need-30-ads-a-month": "blog-creative-fatigue",
  "blog-creative-fatigue": "blog-creative-fatigue",
  // Post 3
  "the-7-day-conversion-architecture-anatomy-of-a-page-that-closes-cold-clicks": "blog-conversion-architecture",
  "blog-conversion-architecture": "blog-conversion-architecture",
  // Post 4
  "every-extra-second-of-load-time-costs-you-20-of-your-paid-conversions": "blog-page-speed",
  "blog-page-speed": "blog-page-speed",
  // Post 5
  "the-3-second-thumb-stopper-scripting-video-ads-that-survive-the-scroll": "blog-video-ads",
  "the-3-second-thumb-stopper-scripting-video-ads-that-hold-attention-and-sell": "blog-video-ads",
  "blog-video-ads": "blog-video-ads",
  // Post 6
  "fixing-the-leaky-storefront-5-checkout-frictions-costing-you-6-figures": "blog-ecommerce-cro",
  "fixing-the-leaky-storefront-5-checkout-frictions-costing-brands-six-figures": "blog-ecommerce-cro",
  "blog-ecommerce-cro": "blog-ecommerce-cro",
  // Post 7
  "how-category-leading-visual-identity-lowers-your-customer-acquisition-cost": "blog-visual-identity",
  "how-category-leading-visual-identity-lets-you-command-2x-higher-margins": "blog-visual-identity",
  "blog-visual-identity": "blog-visual-identity",
  // Post 8
  "why-hiring-separate-ad-and-web-agencies-is-the-most-expensive-mistake-in-growth": "blog-unified-growth",
  "blog-unified-growth": "blog-unified-growth",
};

http.createServer(async (req, res) => {
  try {
    const reqUrl = req.url.split("?")[0];

    // Contact API Endpoint
    if (reqUrl === "/api/contact") {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Cache-Control": "no-store",
        });
        return res.end();
      }

      if (req.method === "POST") {
        const sendJson = (status, payload) => {
          res.writeHead(status, {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store",
          });
          res.end(JSON.stringify(payload));
        };

        let rawBody = "";
        for await (const chunk of req) {
          rawBody += chunk;
          if (rawBody.length > 1024 * 1024) {
            return sendJson(413, { ok: false, error: "Payload too large" });
          }
        }

        let data;
        try {
          data = JSON.parse(rawBody);
        } catch {
          return sendJson(400, { ok: false, error: "Invalid JSON body" });
        }

        if (!data || typeof data !== "object") {
          return sendJson(400, { ok: false, error: "Request payload must be an object" });
        }

        // Honeypot trap check
        if (data.website_trap && typeof data.website_trap === "string" && data.website_trap.trim().length > 0) {
          return sendJson(200, { ok: true });
        }

        const name = typeof data.name === "string" ? data.name.trim().slice(0, 150) : "";
        const email = typeof data.email === "string" ? data.email.trim().slice(0, 254) : "";
        const phone = typeof data.phone === "string" ? data.phone.trim().slice(0, 50) : "";
        const country = typeof data.country === "string" ? data.country.trim().slice(0, 100) : "";
        const service = typeof data.service === "string" ? data.service.trim().slice(0, 100) : "";
        const message = typeof data.message === "string" ? data.message.trim().slice(0, 5000) : "";
        const source_page = typeof data.source_page === "string" ? data.source_page.trim().slice(0, 200) : "";

        if (!name) return sendJson(400, { ok: false, error: "Name is required" });
        if (!email || !email.includes("@") || !email.includes(".")) {
          return sendJson(400, { ok: false, error: "Valid email is required" });
        }
        if (!phone) return sendJson(400, { ok: false, error: "Phone number is required" });
        if (!message) return sendJson(400, { ok: false, error: "Message is required" });

        const env = loadEnvFile();
        const supabaseUrl = (env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
        const serviceKey = (env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

        if (!supabaseUrl || !serviceKey) {
          return sendJson(500, { ok: false, error: "Supabase environment variables missing" });
        }

        try {
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

          if (sbResponse.ok) {
            let emailed = false;
            let sheetSaved = false;

            const resendApiKey = (env.RESEND_API_KEY || "").trim();
            const isResendConfigured = resendApiKey && !resendApiKey.includes("re_your_resend_api_key_here");
            const sheetsWebhookUrl = (env.GOOGLE_SHEETS_WEBHOOK_URL || "").trim();
            const sheetsSecret = (env.GOOGLE_SHEETS_SECRET || "").trim();

            const sendEmail = async () => {
              if (!isResendConfigured) return;
              const resendFrom = (env.RESEND_FROM_EMAIL || "").trim() || "Enraux <onboarding@resend.dev>";
              const resendTo = (env.RESEND_TO_EMAIL || "").trim() || "hello@enraux.com";
              const resendSendConfirmation = (env.RESEND_SEND_CONFIRMATION || "").trim().toLowerCase();

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

            return sendJson(200, { ok: true, emailed, sheetSaved });
          }

          const errorDetails = await sbResponse.text().catch(() => "");
          return sendJson(502, { ok: false, error: errorDetails || `Supabase responded with HTTP ${sbResponse.status}` });
        } catch (fetchErr) {
          return sendJson(502, { ok: false, error: fetchErr?.message || "Failed to contact Supabase" });
        }
      }
    }

    // Serve extracted CSS files from public/styles/
    if (reqUrl.startsWith("/styles/")) {
      const cssPath = path.join("public", reqUrl);
      if (fs.existsSync(cssPath)) {
        res.writeHead(200, {
          "Content-Type": "text/css; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
        });
        return res.end(fs.readFileSync(cssPath, "utf-8"));
      }
    }

    // Serve static assets from public/ if present
    const publicPath = path.join("public", reqUrl.replace(/^\/+/, ""));
    if (fs.existsSync(publicPath) && fs.statSync(publicPath).isFile()) {
      const ext = path.extname(publicPath).toLowerCase();
      const mimeTypes = {
        ".css": "text/css",
        ".js": "application/javascript",
        ".mjs": "application/javascript",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".ico": "image/x-icon",
        ".woff2": "font/woff2",
        ".woff": "font/woff",
      };
      res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
      return res.end(fs.readFileSync(publicPath));
    }

    // Serve clean .astro pages by stitching BaseLayout + Page slots together
    let cleanRoute = reqUrl.replace(/^\/+|\/+$/g, "").replace(/\/index\.html$/, "").replace(/\.html$/, "");

    // Normalize duplicate /blog/blog/... paths to /blog/...
    cleanRoute = cleanRoute.replace(/^(blog\/)+/i, "blog/");

    // If someone requests /blog-visual-identity directly without /blog/, normalize to blog/...
    if (cleanRoute.startsWith("blog-")) {
      cleanRoute = `blog/${cleanRoute}`;
    }
    if (blogAliases[cleanRoute]) {
      cleanRoute = `blog/${blogAliases[cleanRoute]}`;
    }

    let astroFile = null;
    if (!cleanRoute) {
      astroFile = path.join("src", "pages", "index.astro");
    } else if (cleanRoute.startsWith("blog/")) {
      const slug = cleanRoute.slice("blog/".length);
      const resolvedSlug = blogAliases[slug] || slug;
      const resolvedFile = path.join("src", "pages", "blog", `${resolvedSlug}.astro`);
      if (fs.existsSync(resolvedFile)) {
        astroFile = resolvedFile;
      } else {
        astroFile = path.join("src", "pages", "blog", `${slug}.astro`);
      }
    } else {
      astroFile = path.join("src", "pages", `${cleanRoute}.astro`);
    }

    if (astroFile && fs.existsSync(astroFile)) {
      const content = fs.readFileSync(astroFile, "utf-8");
      const title = (content.match(/title="([^"]*)"/) || [])[1] || "Enraux";
      const cssFile = (content.match(/cssFile="([^"]*)"/) || [])[1] || "";
      const bodyClass = (content.match(/bodyClass="([^"]*)"/) || [])[1] || "";

      // Synchronously inline page CSS to eliminate white flashes and any 600ms navbar shifts
      let inlineStyleTag = "";
      if (cssFile) {
        const cssDiskPath = path.join("public", cssFile.replace(/^\/+/, ""));
        if (fs.existsSync(cssDiskPath)) {
          const cssContent = fs.readFileSync(cssDiskPath, "utf-8");
          inlineStyleTag = `<style id="enraux-inlined-page-css">\n${cssContent}\n</style>`;
        }
      }

      const fragments = [...content.matchAll(/<Fragment[^>]*>([\s\S]*?)<\/Fragment>/g)].map((m) => m[1]);
      const headSlot = fragments[0] || "";
      const bodySlot = fragments.slice(1).join("\n");

      const baseLayoutPath = path.join("src", "layouts", "BaseLayout.astro");
      const baseLayoutContent = fs.readFileSync(baseLayoutPath, "utf-8");
      const baseTemplate = baseLayoutContent.replace(/^---[\s\S]*?---\s*/, "");

      // Use function replacers so JavaScript never interprets $& or $' in minified CSS or slots
      let renderedHtml = baseTemplate
        .replace("{title}", () => title)
        .replace("href={cssFile}", () => `href="${cssFile}"`)
        .replace("class={bodyClass}", () => `class="${bodyClass}"`)
        .replace('<slot name="head" />', () => headSlot)
        .replace("<slot />", () => bodySlot);

      if (inlineStyleTag) {
        renderedHtml = renderedHtml.replace("</head>", () => `${inlineStyleTag}\n</head>`);
      }

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      return res.end(renderedHtml);
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("404 Not Found: " + astroFile);
  } catch (err) {
    console.error("Preview server error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    }
    res.end("500 Internal Server Error: " + (err && err.message ? err.message : err));
  }
}).listen(PORT, () => {
  console.log(`🚀 Clean Astro Preview running at: http://localhost:${PORT}`);
});
