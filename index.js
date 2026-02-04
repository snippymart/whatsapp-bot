import express from "express";

const app = express();
app.use(express.json());

// ================= CONFIG =================
const WASENDER_TOKEN = process.env.WASENDER_API_KEY;
const SEND_URL = "https://api.wasenderapi.com/api/send-message";

// typing delay helper (2–5 sec)
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ================= HEALTH CHECK =================
app.get("/", (req, res) => {
  res.send("Webhook is live");
});

// ================= WEBHOOK =================
app.post("/webhook", async (req, res) => {
  // Always respond immediately
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

    console.log("📩 Incoming message:", from, text);

    const msg = text.toLowerCase();

    // SAFE TRIGGERS
    const triggers = [
      "hi",
      "hello",
      "cursor",
      "price",
      "details",
      "cursor_pro"
    ];

    if (!triggers.some(t => msg.includes(t))) {
      console.log("⏭️ No trigger matched, ignoring");
      return;
    }

    // simulate typing delay
    const delay = 2000 + Math.floor(Math.random() * 3000);
    await wait(delay);

    const payload = {
      sessionId: sessionId,
      number: from,
      text: `🚀 *Cursor Pro – Official Premium*

✅ Works on *your own account*
🔒 We *never* ask for passwords
⚡ Activation within 24 hours

👉 Order here:
https://yourwebsite.com/cursor

Reply *PRICE* or *DETAILS* to know more 👇`
    };

    console.log("📤 Sending payload:", payload);

    const response = await fetch(SEND_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${WASENDER_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = await response.text();
    console.log("📤 SEND STATUS:", response.status);
    console.log("📤 SEND RESPONSE:", result);

  } catch (err) {
    console.error("❌ ERROR:", err);
  }
});

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
