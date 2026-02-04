import express from "express";

const app = express();
app.use(express.json({ type: "*/*" }));

// ================= CONFIG =================
const WASENDER_SESSION_KEY = process.env.WASENDER_SESSION_KEY;
const SEND_URL = "https://api.wasenderapi.com/api/send-message";

// UPDATED: Supabase Edge Functions
const SUPABASE_URL = "https://vuffzfuklzzcnfnubtzx.supabase.co/functions/v1";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1ZmZ6ZnVrbHp6Y25mbnVidHp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2OTQ1NjAsImV4cCI6MjA4NDI3MDU2MH0.qHjJYOrNi1cBYPYapmHMJgDxsI50sHAKUAvv0VnPQFM";

// In-memory deduplication & user state
const handledMessages = new Set();
const userState = new Map(); // Track what user is doing

// ================= HELPERS =================
function extractCore(body) {
  try {
    const msg = body?.data?.messages;
    if (!msg) return null;

    return {
      id: msg.id || msg?.key?.id,
      from: msg.cleanedSenderPn || msg?.key?.cleanedSenderPn,
      text: msg.message?.conversation || msg.messageBody || null,
      sessionId: body.sessionId || body.data?.sessionId,
      listReplyId: msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId || null
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

// ================= API CALLS =================
async function getProducts() {
  const res = await fetch(`${SUPABASE_URL}/whatsapp-products`, {
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`
    }
  });

  if (!res.ok) {
    console.error("❌ Products API failed:", res.status);
    return null;
  }

  const data = await res.json();
  return Array.isArray(data) ? data : null;
}

async function getProductFlow(productId) {
  const res = await fetch(
    `${SUPABASE_URL}/whatsapp-product-flow?id=${productId}`,
    {
      headers: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`
      }
    }
  );

  if (!res.ok) {
    console.error("❌ Product flow API failed:", res.status);
    return null;
  }

  return await res.json();
}

async function logEvent(phone, event, productId = null, message = null) {
  try {
    await fetch(`${SUPABASE_URL}/whatsapp-log`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ phone, event, productId, message })
    });
  } catch (err) {
    console.error("❌ Failed to log event:", err);
  }
}

// ================= BOT ACTIONS =================
async function sendMenu(sessionId, to) {
  const products = await getProducts();

  if (!products || products.length === 0) {
    await sendText(sessionId, to, "⚠️ No products available right now. Please try again later.");
    return;
  }

  await send({
    sessionId,
    to,
    type: "list",
    header: {
      type: "text",
      text: "🛍️ Snippy Mart Products"
    },
    body: {
      text: "Select a product to view details and pricing 👇"
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

  await logEvent(to, "MENU_REQUEST", null, "menu");
  console.log("📤 Product menu sent to", to);
}

async function sendProductFlow(sessionId, to, productId) {
  const flow = await getProductFlow(productId);

  if (!flow) {
    await sendText(sessionId, to, "⚠️ Product not found or temporarily unavailable.");
    return;
  }

  // Log product view
  await logEvent(to, "PRODUCT_VIEW", productId, productId);

  // Send each flow step with delay
  for (const step of flow.flowSteps) {
    const message = `*${step.title}*\n\n${step.message}`;
    await sendText(sessionId, to, message);

    // Wait for specified delay
    if (step.delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, step.delayMs));
    }
  }

  // Send order link if enabled
  if (flow.showOrderLink && flow.orderUrl) {
    await sendText(
      sessionId,
      to,
      `👉 *Order Now*\n${flow.orderUrl}\n\n_Reply *menu* to see other products_`
    );
    await logEvent(to, "ORDER_CLICK", productId);
  } else {
    await sendText(
      sessionId,
      to,
      "_Reply *menu* to see all products_"
    );
  }

  console.log("✅ Product flow sent:", productId);
}

async function handleFallback(sessionId, to, message) {
  await sendText(
    sessionId,
    to,
    "Sorry, I didn't understand that. 🤔\n\nReply with *menu* to see our products!"
  );
  await logEvent(to, "FALLBACK", null, message);
}

// ================= WEBHOOK =================
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  console.log("======================================");
  console.log("📩 WEBHOOK RECEIVED");
  console.log(JSON.stringify(req.body, null, 2));

  const core = extractCore(req.body);
  if (!core || !core.id || !core.from) {
    console.log("⏭️ Invalid webhook data");
    return;
  }

  console.log("📝 EXTRACTED:", core);

  // Deduplicate
  if (handledMessages.has(core.id)) {
    console.log("⏭️ Duplicate ignored:", core.id);
    return;
  }
  handledMessages.add(core.id);

  // Clean up old messages (keep last 1000)
  if (handledMessages.size > 1000) {
    const toDelete = Array.from(handledMessages).slice(0, 100);
    toDelete.forEach(id => handledMessages.delete(id));
  }

  const { sessionId, from, text, listReplyId } = core;

  // Handle list reply (user selected product from menu)
  if (listReplyId) {
    console.log("🎯 User selected product:", listReplyId);
    await sendProductFlow(sessionId, from, listReplyId);
    return;
  }

  // Handle text commands
  if (!text) {
    console.log("⏭️ No text content");
    return;
  }

  const lowerText = text.toLowerCase().trim();

  // Menu command
  if (lowerText === "menu" || lowerText === "hi" || lowerText === "hello" || lowerText === "start") {
    await sendMenu(sessionId, from);
    return;
  }

  // Try to match product by keyword
  const products = await getProducts();
  if (products) {
    const matchedProduct = products.find(p => 
      lowerText.includes(p.id.toLowerCase()) || 
      p.menuTitle.toLowerCase().includes(lowerText)
    );

    if (matchedProduct) {
      console.log("🎯 Keyword matched product:", matchedProduct.id);
      await sendProductFlow(sessionId, from, matchedProduct.id);
      return;
    }
  }

  // Fallback - didn't understand
  await handleFallback(sessionId, from, text);

  console.log("======================================");
});

// ================= HEALTH CHECK =================
app.get("/", (_, res) => {
  res.json({
    status: "online",
    service: "Snippy Mart WhatsApp Bot",
    endpoints: {
      products: `${SUPABASE_URL}/whatsapp-products`,
      flow: `${SUPABASE_URL}/whatsapp-product-flow`,
      log: `${SUPABASE_URL}/whatsapp-log`
    }
  });
});

app.get("/health", (_, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// ================= START SERVER =================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("🚀 SNIPPY MART WHATSAPP BOT");
  console.log(`📡 Server listening on port ${PORT}`);
  console.log(`🔗 Supabase Functions: ${SUPABASE_URL}`);
  console.log("✅ Ready to receive webhooks!");
});
