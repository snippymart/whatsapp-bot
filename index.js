import express from "express";

const app = express();
app.use(express.json());

const WASENDER_TOKEN = process.env.WASENDER_API_KEY;
const SEND_URL = "https://api.wasenderapi.com/send-message";

// helper: delay
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.get("/", (req, res) => {
  res.send("Webhook is live");
});

app.post("/webhook", async (req, res) => {
  // Always respond fast
  res.sendStatus(200);

  try {
    const data = req.body?.data?.messages;
    if (!data) return;

    const text =
      data?.message?.conversation ||
      data?.messageBody ||
      "";

    const from = data?.cleanedSenderPn;
    if (!text || !from) return;

    console.log("📩 Incoming:", from, text);

    const msg = text.toLowerCase();

    // TRIGGERS (developer-safe)
    const triggers = ["hi", "hello", "cursor", "price", "details", "cursor_pro"];
    if (!triggers.some((t) => msg.includes(t))) return;

    // typing delay (2–5s)
    const delay = 2000 + Math.floor(Math.random() * 3000);
    await wait(delay);

    // send reply
    await fetch(SEND_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${WASENDER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: from,
        text: `🚀 *Cursor Pro – Official Premium*

✅ Works on *your own account*
🔒 We *never* ask for passwords
⚡ Activation within 24 hours

👉 Order here:
https://yourwebsite.com/cursor

Reply *PRICE* or *DETAILS* to know more 👇`,
      }),
    });

    console.log("✅ Reply sent to", from);

  } catch (err) {
    console.error("❌ Error:", err);
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running");
});
