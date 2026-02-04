import express from "express";

const app = express();
app.use(express.json({ type: "*/*" }));

// ================= CONFIG =================
const WASENDER_SESSION_KEY = process.env.WASENDER_SESSION_KEY;
const SEND_URL = "https://api.wasenderapi.com/api/send-message";
const API_BASE = "https://snippymart.com/api/public/whatsapp";

// In-memory deduplication
const handledMessages = new Set();

// ================= HELPERS =================
function extractCore(body) {
  try {
    const msg = body?.data?.messages;
    if (!msg) return null;

    return {
      id: msg.id || msg?.key?.id,
      from: msg.cleanedSenderPn || msg?.key?.cleanedSenderPn,
      text:
        msg.message?.conversation ||
        msg.messageBody ||
        null,
      sessionId: body.sessionId || body.data?.sessionId
    };
  } catch {
    return null;
  }
}

async function send(payload) {
  const res = await fetch(SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WASENDER_SESSION_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const out = await res.text();
  console.log("📤 SEND STATUS:", res.status, out);
}

async function sendText(sessionId, to, text) {
  return send({
    sessionId,
    to,
    type: "text",
    text
  });
}

async function sendMenu(sessionId, to) {
  const res = await fetch(`${API_BASE}/products`);
  const raw = await res.text();

  let products;
  try {
    products = JSON.parse(raw);
  } catch {
    console.error("❌ Products API returned non-JSON:", raw.slice(0, 200));
    await sendText(sessionId, to, "⚠️ Product menu temporarily unavailable.");
    return;
  }

  if (!Array.isArray(products) || products.length === 0) {
    await sendText(sessionId, to, "⚠️ No products available right now.");
    return;
  }

  await send({
    sessionId,
    to,
    type: "list",
    header: {
      type: "text",
      text: "🛍️ Our Products"
    },
    body: {
      text: "Select a product to view details"
    },
    action: {
      button: "View Products",
      sections: [
        {
          title: "Available Products",
          rows: products.map(p => ({
            id: p.id,
            title: p.menuTitle
          }))
        }
      ]
    }
  });

  console.log("📤 Product menu sent");
}

// ================= WEBHOOK =================
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  console.log("======================================");
  console.log("📩 RAW WEBHOOK");
  console.log(JSON.stringify(req.body, null, 2));

  const core = extractCore(req.body);
  if (!core || !core.id || !core.from) return;

  console.log("📝 EXTRACTED:", core);

  // Deduplicate (Wasender sends multiple events)
  if (handledMessages.has(core.id)) {
    console.log("⏭️ Duplicate ignored:", core.id);
    return;
  }
  handledMessages.add(core.id);

  // Send product menu
  await sendMenu(core.sessionId, core.from);

  console.log("======================================");
});

// ================= HEALTH =================
app.get("/", (_, res) => res.send("Webhook live"));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("🚀 SERVER LISTENING");
});
