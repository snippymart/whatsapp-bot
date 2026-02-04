import express from "express";

const app = express();
app.use(express.json({ type: "*/*" }));

/* ================= CONFIG ================= */

const WASENDER_TOKEN = process.env.WASENDER_API_KEY;
const ADMIN_NUMBER = "9477XXXXXXX"; // your number (no +)
const SEND_URL = "https://api.wasenderapi.com/api/send-message";

// OPTIONAL
const WEBSITE_API = "https://yourwebsite.com/api/products"; // optional
const OPENAI_KEY = process.env.OPENAI_API_KEY; // optional

/* ================= HELPERS ================= */

const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function sendMessage(sessionId, number, text) {
  const payload = { sessionId, number, text };

  const res = await fetch(SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WASENDER_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const out = await res.text();
  console.log("📤 SEND:", res.status, out);
}

/* ================= PRODUCTS ================= */

// LOCAL FALLBACK (used if website API fails)
const PRODUCTS = {
  cursor: {
    name: "Cursor Pro",
    triggers: ["cursor", "cursor pro"],
    reply: `🚀 *Cursor Pro – Official Premium*

✅ Works on your own account
🔒 We NEVER ask for passwords
⚡ Activation within 24 hours

👉 Order:
https://yourwebsite.com/cursor`
  },

  grammarly: {
    name: "Grammarly Pro",
    triggers: ["grammarly", "grammar"],
    reply: `✍️ *Grammarly Pro – Official*

✅ On your own account
⚡ Fast activation

👉 Order:
https://yourwebsite.com/grammarly`
  }
};

/* ================= AI (OPTIONAL) ================= */

async function aiReply(question) {
  if (!OPENAI_KEY) return null;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a WhatsApp sales assistant. Answer briefly. Never discuss pricing unless asked. Never ask for passwords."
        },
        { role: "user", content: question }
      ]
    })
  });

  const json = await res.json();
  return json?.choices?.[0]?.message?.content;
}

/* ================= WEBHOOK ================= */

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const data = req.body?.data?.messages;
    if (!data) return;

    const text =
      data?.message?.conversation ||
      data?.messageBody ||
      "";

    const from = data?.cleanedSenderPn;
    const sessionId = req.body?.data?.sessionId;

    if (!text || !from || !sessionId) return;

    console.log("📩 IN:", from, text);

    const msg = text.toLowerCase();

    /* ===== ADMIN ESCALATION ===== */
    if (msg.includes("agent") || msg.includes("human")) {
      await sendMessage(
        sessionId,
        from,
        "👨‍💼 An admin will reply to you shortly."
      );

      await sendMessage(
        sessionId,
        ADMIN_NUMBER,
        `⚠️ Admin needed\nFrom: ${from}\nMessage: ${text}`
      );
      return;
    }

    /* ===== PRODUCT MATCH ===== */
    for (const key in PRODUCTS) {
      const product = PRODUCTS[key];
      if (product.triggers.some(t => msg.includes(t))) {
        await wait(2000 + Math.random() * 3000);
        await sendMessage(sessionId, from, product.reply);
        return;
      }
    }

    /* ===== FAQ / AI FALLBACK ===== */
    if (msg.length > 8) {
      const ai = await aiReply(text);
      if (ai) {
        await wait(1500);
        await sendMessage(sessionId, from, ai);
        return;
      }
    }

    /* ===== DEFAULT ===== */
    await sendMessage(
      sessionId,
      from,
      "👋 Hi! Type *CURSOR* or *GRAMMARLY* to see details."
    );

  } catch (err) {
    console.error("❌ ERROR:", err);
  }
});

/* ================= HEALTH ================= */

app.get("/", (_, res) => res.send("Webhook is live"));

app.listen(process.env.PORT || 3000, () =>
  console.log("🚀 Server running")
);
