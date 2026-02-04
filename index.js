import express from "express";

const app = express();
app.use(express.json({ type: "*/*" }));

const WASENDER_TOKEN = process.env.WASENDER_API_KEY;
const SEND_URL = "https://api.wasenderapi.com/api/send-message";
const SITE = "https://snippymart.com";

// helper
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function send(sessionId, number, payload) {
  await fetch(SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WASENDER_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ sessionId, number, ...payload })
  });
}

// ================= WEBHOOK =================
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  const msgData = req.body?.data?.messages;
  if (!msgData) return;

  const from = msgData.cleanedSenderPn;
  const text =
    msgData?.message?.conversation ||
    msgData?.messageBody ||
    "";

  const sessionId = req.body?.data?.sessionId;
  const message = text.toLowerCase().trim();

  if (!from || !sessionId) return;

  console.log("📩", from, message);

  /* ===== 1️⃣ MENU REQUEST ===== */
  if (
    message === "menu" ||
    message === "hi" ||
    message === "hello"
  ) {
    const products = await fetch(`${SITE}/api/whatsapp/products`)
      .then(r => r.json());

    if (!products.length) {
      await send(sessionId, from, {
        text: "⚠️ No products available right now."
      });
      return;
    }

    // Build WhatsApp List Message
    await send(sessionId, from, {
      type: "list",
      header: { type: "text", text: "🛍️ Our Products" },
      body: { text: "Select a product to view details:" },
      action: {
        button: "View Products",
        sections: [
          {
            title: "Available",
            rows: products.map(p => ({
              id: p.id,
              title: p.menuTitle
            }))
          }
        ]
      }
    });

    return;
  }

  /* ===== 2️⃣ PRODUCT SELECTED ===== */
  const productId =
    msgData?.message?.listResponseMessage?.singleSelectReply?.selectedRowId
    || null;

  if (productId) {
    // Log product view
    await fetch(`${SITE}/api/whatsapp/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: from,
        productId,
        event: "PRODUCT_VIEW"
      })
    });

    const flow = await fetch(
      `${SITE}/api/whatsapp/products/${productId}`
    ).then(r => r.json());

    for (const step of flow.flowSteps) {
      await wait(step.delayMs || 0);
      await send(sessionId, from, {
        text: `*${step.title}*\n\n${step.message}`
      });
    }

    if (flow.showOrderLink) {
      await send(sessionId, from, {
        text: `👉 *Order on website*\n${flow.orderUrl}`
      });

      await fetch(`${SITE}/api/whatsapp/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: from,
          productId,
          event: "ORDER_CLICK"
        })
      });
    }

    return;
  }

  /* ===== 3️⃣ FALLBACK ===== */
  await send(sessionId, from, {
    text: "👋 Type *MENU* to see our products."
  });
});

app.get("/", (_, res) => res.send("Webhook live"));
app.listen(process.env.PORT || 3000);
