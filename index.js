import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json({ type: "*/*" }));

// ================= CONFIG =================
const WASENDER_SESSION_KEY = process.env.WASENDER_SESSION_KEY;
const ADMIN_PHONE = process.env.ADMIN_PHONE || "94776512486";
const SEND_URL = "https://api.wasenderapi.com/api/send-message";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Supabase
const SUPABASE_URL = "https://vuffzfuklzzcnfnubtzx.supabase.co/functions/v1";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1ZmZ6ZnVrbHp6Y25mbnVidHp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2OTQ1NjAsImV4cCI6MjA4NDI3MDU2MH0.qHjJYOrNi1cBYPYapmHMJgDxsI50sHAKUAvv0VnPQFM";

// Initialize OpenAI (only if API key exists)
let openai = null;
if (OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: OPENAI_API_KEY });
}

// State
const botUsers = new Set();
const handledMessages = new Map();
const conversationHistory = new Map();
const escalatedUsers = new Set();
let productKnowledgeBase = "";

// Auto-cleanup
setInterval(() => {
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  for (const [msgId, timestamp] of handledMessages.entries()) {
    if (timestamp < fiveMinutesAgo) {
      handledMessages.delete(msgId);
    }
  }
  
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [user, history] of conversationHistory.entries()) {
    if (history.lastUpdate < oneHourAgo) {
      conversationHistory.delete(user);
    }
  }
}, 5 * 60 * 1000);

// ================= LOAD PRODUCT KNOWLEDGE =================
async function loadProductKnowledge() {
  try {
    console.log("📚 Loading product catalog...");
    
    const res = await fetch(
      `https://vuffzfuklzzcnfnubtzx.supabase.co/rest/v1/products?select=*`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`
        }
      }
    );

    if (!res.ok) {
      console.error("❌ Failed to load products");
      return;
    }

    const products = await res.json();
    
    let knowledge = `# Snippy Mart - Product Catalog\n\n`;
    knowledge += `You are a product expert for Snippy Mart digital services.\n\n`;

    products.forEach(p => {
      knowledge += `## ${p.name}\n`;
      knowledge += `**Price**: $${p.price}\n`;
      
      if (p.description) {
        knowledge += `**Description**: ${p.description}\n`;
      }
      
      if (p.name.toLowerCase().includes('chatgpt')) {
        knowledge += `**Type**: AI Assistant\n`;
        knowledge += `**Requirements**: Email only\n`;
        knowledge += `**Includes**: GPT-4, DALL-E, plugins, web browsing\n`;
      } else if (p.name.toLowerCase().includes('cursor')) {
        knowledge += `**Type**: AI Code Editor\n`;
        knowledge += `**Requirements**: Email only\n`;
        knowledge += `**Includes**: Unlimited AI completions, chat, multi-file editing\n`;
      } else if (p.name.toLowerCase().includes('claude')) {
        knowledge += `**Type**: AI Assistant\n`;
        knowledge += `**Requirements**: Email only\n`;
        knowledge += `**Includes**: Claude 3.5 Sonnet, priority access\n`;
      } else if (p.name.toLowerCase().includes('github')) {
        knowledge += `**Type**: AI Code Assistant\n`;
        knowledge += `**Requirements**: Email + GitHub username\n`;
        knowledge += `**Includes**: Code suggestions, multiple language support\n`;
      }
      
      knowledge += `\n`;
    });

    knowledge += `\n## General Info:\n`;
    knowledge += `- Delivery: Within 24 hours (usually faster)\n`;
    knowledge += `- Payment: Bank Transfer or Binance USDT\n`;
    knowledge += `- All products are FRESH activations (no sharing)\n`;
    knowledge += `- Credentials sent via email\n`;

    productKnowledgeBase = knowledge;
    console.log("✅ Knowledge loaded:", products.length, "products");
  } catch (err) {
    console.error("❌ Knowledge error:", err.message);
  }
}

loadProductKnowledge();

// ================= AI PRODUCT EXPERT =================
async function askProductExpert(userPhone, userMessage) {
  if (!openai) {
    console.log("⚠️ OpenAI not configured");
    return "I'm running in basic mode. Type *MENU* to see products or *HUMAN* for support!";
  }

  try {
    // Check for escalation keywords
    const escalationKeywords = [
      'human', 'person', 'talk to someone', 'speak to',
      'representative', 'agent', 'support', 'help me',
      'contact', 'admin', 'manager', 'real person',
      'not helpful', 'don\'t understand', 'confused'
    ];
    
    const lowerMsg = userMessage.toLowerCase();
    const needsHuman = escalationKeywords.some(kw => lowerMsg.includes(kw));
    
    if (needsHuman) {
      return "ESCALATE";
    }

    if (!conversationHistory.has(userPhone)) {
      conversationHistory.set(userPhone, {
        messages: [],
        lastUpdate: Date.now()
      });
    }

    const conversation = conversationHistory.get(userPhone);
    conversation.lastUpdate = Date.now();

    const messages = [
      {
        role: "system",
        content: `You are a product expert for Snippy Mart.

${productKnowledgeBase}

## Your Role:
Answer questions about OUR products ONLY. Be helpful, accurate, and concise.

## Rules:
1. ONLY discuss products in the catalog above
2. If asked about products we DON'T have, say: "We don't offer that currently. Reply *MENU* for available products!"
3. If you're UNSURE about something, say: "I'm not 100% sure. Type *HUMAN* to speak with our team!"
4. Be specific about features, pricing, and requirements
5. Keep responses under 350 characters
6. Use emojis appropriately
7. Always end with a call-to-action
8. NEVER make up information
9. NEVER share sensitive data

Q: "Does ChatGPT include GPT-4?"
A: "Yes! ✅ ChatGPT Plus ($20) includes full GPT-4, DALL-E 3, plugins & web browsing. Only email needed. Want to order? Reply *MENU*!"`
      },
      ...conversation.messages.slice(-4),
      {
        role: "user",
        content: userMessage
      }
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messages,
      temperature: 0.6,
      max_tokens: 200,
    });

    const aiResponse = completion.choices[0].message.content;

    conversation.messages.push(
      { role: "user", content: userMessage },
      { role: "assistant", content: aiResponse }
    );

    if (conversation.messages.length > 8) {
      conversation.messages = conversation.messages.slice(-8);
    }

    console.log("🤖 AI:", aiResponse.substring(0, 60));
    return aiResponse;
  } catch (err) {
    console.error("❌ AI Error:", err.message);
    return null;
  }
}

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
      buttonResponse: msg.message?.buttonsResponseMessage?.selectedButtonId || null,
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
  if (!res.ok) {
    console.error("📤 SEND FAILED:", res.status, out);
  }
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

async function sendWithButtons(sessionId, to, text, buttons) {
  return send({
    sessionId,
    to,
    type: "buttons",
    text: text,
    buttons: buttons.map((btn, idx) => ({
      id: `btn_${idx}_${btn.id}`,
      text: btn.text
    }))
  });
}

async function notifyAdmin(sessionId, userPhone, lastMessage) {
  const adminMessage = `🚨 *User Escalation*\n\n` +
    `User: ${userPhone}\n` +
    `Last message: "${lastMessage}"\n` +
    `Status: Waiting for human support\n\n` +
    `_Reply to this user directly to assist_`;
  
  await sendText(sessionId, ADMIN_PHONE, adminMessage);
  console.log("📢 Admin notified:", userPhone);
}

// ================= API CALLS =================
async function getProducts() {
  try {
    const res = await fetch(`${SUPABASE_URL}/whatsapp-products`, {
      headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

async function getProductFlow(productId) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/whatsapp-product-flow?id=${productId}`,
      { headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
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
  } catch {}
}

// ================= BOT ACTIONS =================
async function sendMenu(sessionId, to) {
  const products = await getProducts();

  if (!products || products.length === 0) {
    await sendText(sessionId, to, "⚠️ No products available. Type *HUMAN* for support.");
    return;
  }

  let menuText = "🛍️ *Snippy Mart Products*\n\n";
  
  products.forEach((p, index) => {
    menuText += `${index + 1}️⃣ ${p.menuTitle}\n`;
  });
  
  menuText += "\n💬 _Ask me anything about products!_\n";
  menuText += "_Or type *HUMAN* for live support_";

  const buttonSuccess = await sendWithButtons(sessionId, to, menuText, [
    { id: "human", text: "💬 Talk to Human" },
    { id: "reload", text: "🔄 Reload Menu" }
  ]);

  if (!buttonSuccess) {
    await sendText(sessionId, to, menuText);
  }

  await logEvent(to, "MENU_REQUEST", null, "menu");
  if (!global.userProducts) global.userProducts = new Map();
  global.userProducts.set(to, products);
}

async function sendProductFlow(sessionId, to, productId) {
  const flow = await getProductFlow(productId);
  if (!flow) {
    await sendText(sessionId, to, "⚠️ Product not found. Type *MENU* to try again.");
    return;
  }

  await logEvent(to, "PRODUCT_VIEW", productId, productId);

  for (const step of flow.flowSteps) {
    const message = `*${step.title}*\n\n${step.message}`;
    await sendText(sessionId, to, message);
    if (step.delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, step.delayMs));
    }
  }

  if (flow.showOrderLink && flow.orderUrl) {
    const orderMsg = `👉 *Order Now*\n${flow.orderUrl}\n\n_Questions? Just ask! Need help? Type *HUMAN*_`;
    
    const buttonSuccess = await sendWithButtons(sessionId, to, orderMsg, [
      { id: "menu", text: "🛍️ More Products" },
      { id: "human", text: "💬 Talk to Human" }
    ]);

    if (!buttonSuccess) {
      await sendText(sessionId, to, orderMsg);
    }

    await logEvent(to, "ORDER_CLICK", productId);
  }
}

async function escalateToHuman(sessionId, to, lastMessage) {
  escalatedUsers.add(to);
  
  await sendText(
    sessionId,
    to,
    "👤 *Connecting you to our team...*\n\n" +
    "✅ Your request has been forwarded to our support team.\n" +
    "📱 Someone will respond shortly!\n\n" +
    "_In the meantime, you can still ask questions or type *MENU*_"
  );

  await notifyAdmin(sessionId, to, lastMessage);
  await logEvent(to, "ESCALATION", null, lastMessage);
  
  console.log("🆘 Escalated:", to);
}

async function activateBot(sessionId, to) {
  botUsers.add(to);
  
  const welcomeMsg = "🤖 *Snippy Mart AI Assistant*\n\n" +
    "✅ I'm here to help!\n\n" +
    "💬 *Ask me about:*\n" +
    "• Product features\n" +
    "• Pricing & requirements\n" +
    "• Delivery & support\n\n" +
    "📱 Commands:\n" +
    "• *MENU* - Browse products\n" +
    "• *HUMAN* - Talk to team\n" +
    "• *STOP* - Exit bot";

  const success = await sendWithButtons(sessionId, to, welcomeMsg, [
    { id: "menu", text: "🛍️ View Products" },
    { id: "human", text: "💬 Talk to Human" }
  ]);

  if (!success) {
    await sendText(sessionId, to, welcomeMsg);
  }

  console.log("✅ Activated:", to);
}

async function deactivateBot(sessionId, to) {
  botUsers.delete(to);
  escalatedUsers.delete(to);
  conversationHistory.delete(to);
  if (global.userProducts) global.userProducts.delete(to);
  
  await sendText(
    sessionId,
    to,
    "👋 *Bot Deactivated*\n\nYou can chat normally with our team.\n\n_Send *SNIPPY* to reactivate_"
  );
  console.log("✅ Deactivated:", to);
}

// ================= WEBHOOK =================
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  const core = extractCore(req.body);
  if (!core || !core.id || !core.from || core.fromMe) return;

  const now = Date.now();
  if (handledMessages.has(core.id)) {
    const age = now - handledMessages.get(core.id);
    if (age < 60000) return;
  }
  handledMessages.set(core.id, now);

  const { sessionId, from, text, buttonResponse } = core;

  if (buttonResponse) {
    if (buttonResponse.includes('menu')) {
      await sendMenu(sessionId, from);
      return;
    }
    if (buttonResponse.includes('human')) {
      await escalateToHuman(sessionId, from, "Button: Talk to Human");
      return;
    }
  }

  if (text) {
    const lowerText = text.toLowerCase().trim();

    if (lowerText === "snippy" || lowerText === "bot" || lowerText === "start") {
      await activateBot(sessionId, from);
      return;
    }

    if (lowerText === "stop" || lowerText === "exit") {
      await deactivateBot(sessionId, from);
      return;
    }

    if (lowerText === "human" || lowerText === "support" || lowerText === "help") {
      if (!botUsers.has(from)) {
        botUsers.add(from);
      }
      await escalateToHuman(sessionId, from, text);
      return;
    }
  }

  if (!botUsers.has(from)) return;

  if (!text) return;

  const lowerText = text.toLowerCase().trim();

  if (lowerText === "menu") {
    await sendMenu(sessionId, from);
    return;
  }

  const numberMatch = text.match(/^(\d+)$/);
  if (numberMatch && global.userProducts?.has(from)) {
    const index = parseInt(numberMatch[1]) - 1;
    const userProductList = global.userProducts.get(from);
    
    if (index >= 0 && index < userProductList.length) {
      await sendProductFlow(sessionId, from, userProductList[index].id);
      return;
    }
  }

  const products = await getProducts();
  if (products) {
    const match = products.find(p => 
      lowerText.includes(p.id.toLowerCase()) || 
      p.menuTitle.toLowerCase().includes(lowerText)
    );

    if (match) {
      await sendProductFlow(sessionId, from, match.id);
      return;
    }
  }

  console.log("🤖 AI Query:", text.substring(0, 40));
  await logEvent(from, "AI_QUERY", null, text);
  
  const aiResponse = await askProductExpert(from, text);
  
  if (aiResponse === "ESCALATE") {
    await escalateToHuman(sessionId, from, text);
  } else if (aiResponse) {
    await sendText(sessionId, from, aiResponse);
  } else {
    await sendText(
      sessionId,
      from,
      "Sorry, I'm having trouble. 😔\n\nType *HUMAN* to speak with our team or *MENU* to browse products!"
    );
  }
});

// ================= ENDPOINTS =================
app.get("/", (_, res) => {
  res.json({
    status: "online",
    service: "Snippy Mart AI Bot",
    ai: openai ? "enabled" : "disabled",
    activeUsers: botUsers.size,
    escalated: escalatedUsers.size
  });
});

app.post("/reload", async (req, res) => {
  await loadProductKnowledge();
  res.json({ success: true });
});

// ================= START =================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("🚀 SNIPPY MART AI BOT - PRODUCTION");
  console.log(`🤖 AI: ${openai ? '✅ Enabled' : '❌ Disabled (set OPENAI_API_KEY)'}`);
  console.log(`📚 Knowledge: ${productKnowledgeBase ? '✅ Loaded' : '⌛ Loading...'}`);
  console.log(`👤 Admin: ${ADMIN_PHONE}`);
  console.log("✅ READY!");
});
