import express from "express";

const app = express();
app.use(express.json());

const WASENDER_TOKEN = process.env.WASENDER_API_KEY;
const SEND_URL = "https://api.wasenderapi.com/send-message";

// helper: random delay (2–5s)
const wait = (ms) => new Promise(r => setTimeout(r, ms));

app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // respond fast to webhook

  try {
    const msg = req.body?.message?.text;
    const from = req.body?.message?.from;

    if (!msg || !from) return;

    const text = msg.toLowerCase();
    const triggers = ["cursor", "price", "details", "cursor_pro"];

    if (!triggers.some(t => text.includes(t))) return;

    // typing delay
    const delayMs = 2000 + Math.floor(Math.random() * 3000);
    await wait(delayMs);

    await fetch(SEND_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${WASENDER_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        to: from,
        text:
`🚀 Cursor Pro – Official Premium

✅ Works on your own account
🔒 We NEVER ask for passwords
⚡ Activation within 24 hours

👉 Order here:
https://yourwebsite.com/cursor

Ask me anything 👇`
      })
    });

  } catch (e) {
    console.error(e);
  }
});

app.get("/", (_, res) => res.send("Webhook is live"));
app.listen(process.env.PORT || 3000);
