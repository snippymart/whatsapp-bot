import express from "express";

const app = express();
app.use(express.json({ type: "*/*" }));

// ===== CONFIG =====
const WASENDER_SESSION_KEY = process.env.WASENDER_SESSION_KEY;
const SEND_URL = "https://api.wasenderapi.com/api/send-message";

// In-memory dedup (OK for now)
const handledMessages = new Set();

// ===== HELPERS =====
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

async function sendMessage(sessionId, number, text) {
  const res = await fetch(SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WASENDER_SESSION_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      sessionId,
      number,
      type: "text", // REQUIRED
      text
    })
  });

  const out = await res.text();
  console.log("📤 SEND STATUS:", res.status, out);
}

// ===== WEBHOOK =====
app.post("/webhook", async (req, res) => {
  // Always acknowledge
  res.sendStatus(200);

  console.log("======================================");
  console.log("📩 RAW WEBHOOK RECEIVED");
  console.log(JSON.stringify(req.body, null, 2));

  const core = extractCore(req.body);

  if (!core || !core.id || !core.text) {
    console.log("⚠️ Could not extract core message");
    return;
  }

  console.log("📝 EXTRACTED:", core);

  // ===== DEDUPLICATION =====
  if (handledMessages.has(core.id)) {
    console.log("⏭️ Duplicate event ignored:", core.id);
    return;
  }
  handledMessages.add(core.id);

  // ===== SAFE REPLY =====
  await sendMessage(
    core.sessionId,
    core.from,
    "✅ Bot is alive. Menu coming next."
  );

  console.log("📤 Replied once to", core.id);
  console.log("======================================");
});

// ===== HEALTH CHECK =====
app.get("/", (_, res) => res.send("Webhook live"));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 SERVER LISTENING ON ${PORT}`);
});
