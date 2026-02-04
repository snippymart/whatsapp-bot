import express from "express";

const app = express();
app.use(express.json({ type: "*/*" }));

// ================= CONFIG =================
const WASENDER_SESSION_KEY = process.env.WASENDER_SESSION_KEY;
const SEND_URL = "https://api.wasenderapi.com/api/send-message";

// Supabase Edge Functions
const SUPABASE_URL = "https://vuffzfuklzzcnfnubtzx.supabase.co/functions/v1";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1ZmZ6ZnVrbHp6Y25mbnVidHp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2OTQ1NjAsImV4cCI6MjA4NDI3MDU2MH0.qHjJYOrNi1cBYPYapmHMJgDxsI50sHAKUAvv0VnPQFM";

// ⭐ NEW: Opt-in users only (prevents interfering with sales)
const botUsers = new Set(); // Users who activated bot mode
const handledMessages = new Map(); // messageId -> timestamp

// Auto-cleanup old messages every 5 minutes
setInterval(() => {
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  for (const [msgId, timestamp] of handledMessages.entries()) {
    if (timestamp < fiveMinutesAgo) {
      handledMessages.delete(msgId);
    }
  }
  console.log(`🧹 Cleanup: ${handledMessages.size} messages in memory`);
}, 5 * 60 * 1000);

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
      listReplyId: msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId || null,
      fromMe: msg.key?.fromMe || msg.fromMe || false
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
  return res.ok;
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
  try {
    const res = await fetch(`${SUPABASE_URL}/whatsapp-products`, {
      headers: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`
      }
    });

    console.log("📡 Products API status:", res.status);

    if (!res.ok) {
      const errorText = await res.text();
      console.error("❌ Products API failed:", errorText);
      return null;
    }

    const data = await res.json();
    console.log("✅ Products fetched:", data.length, "items");
    return Array.isArray(data) ? data : null;
  } catch (err) {
    console.error("❌ Products API error:", err.message);
    return null;
  }
}

async function getProductFlow(productId) {
  try {
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

    const data = await res.json();
    console.log("✅ Product flow fetched:", productId);
    return data;
  } catch (err) {
    console.error("❌ Product flow error:", err.message);
    return null;
  }
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
    console.error("❌ Failed to log event:", err.message);
  }
}

// ================= BOT ACTIONS =================
async function sendMenu(sessionId, to) {
  const products = await getProducts();

  if (!products || products.length === 0) {
    await sendText(
      sessionId,
      to,
      "⚠️ No products configured yet. Please contact admin.\n\n_Type *STOP* to exit bot mode_"
    );
    return;
  }

  const success = await send({
    sessionId,
    to,
    type: "list",
    header: {
      type: "text",
      text: "🛍️ Snippy Mart Products"
    },
    body: {
      text: "Select a product to view details and pricing 👇\n\n_Type *STOP* to exit bot mode_"
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

  if (success) {
    await logEvent(to, "MENU_REQUEST", null, "menu");
    console.log("✅ Product menu sent to", to);
  }
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
      `👉 *Order Now*\n${flow.orderUrl}\n\n_Reply *MENU* for more products or *STOP* to exit bot_`
    );
    await logEvent(to, "ORDER_CLICK", productId);
  } else {
    await sendText(
      sessionId,
      to,
      "_Reply *MENU* for all products or *STOP* to exit bot_"
    );
  }

  console.log("✅ Product flow sent:", productId);
}

// ⭐ NEW: Activation message
async function activateBot(sessionId, to) {
  botUsers.add(to);
  await sendText(
    sessionId,
    to,
    "🤖 *Bot Mode Activated!*\n\nI can help you explore our products.\n\n📱 Commands:\n• *MENU* - View products\n• *STOP* - Exit bot mode\n\nReply *MENU* to get started!"
  );
  console.log("✅ Bot activated for:", to);
}

// ⭐ NEW: Deactivation message
async function deactivateBot(sessionId, to) {
  botUsers.delete(to);
  await sendText(
    sessionId,
    to,
    "👋 *Bot Mode Deactivated*\n\nYou can now chat normally with our team.\n\nTo activate bot again, send: *SNIPPY*"
  );
  console.log("✅ Bot deactivated for:", to);
}

// ================= WEBHOOK =================
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  console.log("======================================");
  console.log("📩 WEBHOOK RECEIVED");

  const core = extractCore(req.body);
  if (!core || !core.id || !core.from) {
    console.log("⏭️ Invalid webhook data");
    return;
  }

  // ⭐ IGNORE OUTGOING MESSAGES (from you)
  if (core.fromMe) {
    console.log("⏭️ Skipping outgoing message");
    return;
  }

  console.log("📝 EXTRACTED:", {
    id: core.id,
    from: core.from,
    text: core.text,
    listReply: core.listReplyId
  });

  // ⭐ IMPROVED DEDUPLICATION
  const now = Date.now();
  if (handledMessages.has(core.id)) {
    const age = now - handledMessages.get(core.id);
    if (age < 60000) { // Only dedupe within 1 minute
      console.log("⏭️ Duplicate ignored (too recent)");
      return;
    }
  }
  handledMessages.set(core.id, now);

  const { sessionId, from, text, listReplyId } = core;

  // ⭐ CHECK: Activation keyword (SNIPPY or BOT)
  if (text) {
    const lowerText = text.toLowerCase().trim();

    // Activation keywords
    if (lowerText === "snippy" || lowerText === "bot" || lowerText === "start") {
      await activateBot(sessionId, from);
      return;
    }

    // Deactivation keyword
    if (lowerText === "stop" || lowerText === "exit" || lowerText === "quit") {
      await deactivateBot(sessionId, from);
      return;
    }
  }

  // ⭐ CHECK: Is user in bot mode?
  if (!botUsers.has(from)) {
    console.log("⏭️ User not in bot mode, ignoring");
    return;
  }

  console.log("✅ User in bot mode, processing...");

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
  if (lowerText === "menu" || lowerText === "hi" || lowerText === "hello") {
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
  await sendText(
    sessionId,
    from,
    "Sorry, I didn't understand that. 🤔\n\nReply *MENU* to see products or *STOP* to exit bot."
  );
  await logEvent(from, "FALLBACK", null, text);

  console.log("======================================");
});

// ================= HEALTH CHECK =================
app.get("/", (_, res) => {
  res.json({
    status: "online",
    service: "Snippy Mart WhatsApp Bot",
    botUsers: botUsers.size,
    handledMessages: handledMessages.size,
    endpoints: {
      products: `${SUPABASE_URL}/whatsapp-products`,
      flow: `${SUPABASE_URL}/whatsapp-product-flow`,
      log: `${SUPABASE_URL}/whatsapp-log`
    }
  });
});

app.get("/health", (_, res) => {
  res.json({ 
    status: "healthy", 
    timestamp: new Date().toISOString(),
    activeUsers: botUsers.size
  });
});

// ================= START SERVER =================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("🚀 SNIPPY MART WHATSAPP BOT");
  console.log(`📡 Server listening on port ${PORT}`);
  console.log(`🔗 Supabase: ${SUPABASE_URL}`);
  console.log("✅ Ready! Users must send 'SNIPPY' to activate bot.");
});
