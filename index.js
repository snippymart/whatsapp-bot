import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json({ type: "*/*" }));

// ================= CONFIG =================
const WASENDER_SESSION_KEY = process.env.WASENDER_SESSION_KEY;
const SEND_URL = "https://api.wasenderapi.com/api/send-message";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Supabase Edge Functions
const SUPABASE_URL = "https://vuffzfuklzzcnfnubtzx.supabase.co/functions/v1";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1ZmZ6ZnVrbHp6Y25mbnVidHp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2OTQ1NjAsImV4cCI6MjA4NDI3MDU2MH0.qHjJYOrNi1cBYPYapmHMJgDxsI50sHAKUAvv0VnPQFM";

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// State management
const botUsers = new Set();
const handledMessages = new Map();
const conversationHistory = new Map();
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
    
    // Fetch ALL products with full details from Supabase
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
    
    // Build comprehensive knowledge base
    let knowledge = `# Snippy Mart - Complete Product Catalog\n\n`;
    knowledge += `You are a product expert for Snippy Mart. You know EVERYTHING about our products.\n\n`;

    products.forEach(p => {
      knowledge += `## ${p.name}\n`;
      knowledge += `**Slug**: ${p.slug}\n`;
      knowledge += `**Category**: ${p.category || 'Digital Service'}\n`;
      knowledge += `**Price**: $${p.price}\n`;
      
      if (p.description) {
        knowledge += `**Full Description**: ${p.description}\n`;
      }
      
      if (p.features) {
        knowledge += `**Features**: ${p.features}\n`;
      }
      
      // Add product-type specific info
      if (p.name.toLowerCase().includes('chatgpt')) {
        knowledge += `**Requirements**: Only email address needed\n`;
        knowledge += `**What You Get**: Premium ChatGPT Plus account with GPT-4 access\n`;
        knowledge += `**Delivery**: Account credentials via email within 24 hours\n`;
        knowledge += `**Support**: Full GPT-4, DALL-E 3, web browsing, plugins\n`;
      } else if (p.name.toLowerCase().includes('cursor')) {
        knowledge += `**Requirements**: Only email address needed\n`;
        knowledge += `**What You Get**: Cursor Pro IDE license activated on your account\n`;
        knowledge += `**Features**: AI code completion, chat, multi-file editing, unlimited requests\n`;
        knowledge += `**Delivery**: License activated within 24 hours\n`;
      } else if (p.name.toLowerCase().includes('claude')) {
        knowledge += `**Requirements**: Only email address needed\n`;
        knowledge += `**What You Get**: Claude Pro account with Claude 3.5 Sonnet access\n`;
        knowledge += `**Features**: Longer conversations, priority access, early features\n`;
        knowledge += `**Delivery**: Account credentials via email\n`;
      } else if (p.name.toLowerCase().includes('github')) {
        knowledge += `**Requirements**: Email + GitHub username\n`;
        knowledge += `**What You Get**: GitHub Copilot subscription activated\n`;
        knowledge += `**Features**: AI pair programming, code suggestions, multiple languages\n`;
        knowledge += `**Delivery**: Activated on your GitHub account within 24 hours\n`;
      } else if (p.name.toLowerCase().includes('netflix')) {
        knowledge += `**Requirements**: Only email address needed\n`;
        knowledge += `**What You Get**: Netflix premium account access\n`;
        knowledge += `**Features**: 4K streaming, multiple profiles, no ads\n`;
        knowledge += `**Delivery**: Account credentials via email\n`;
      } else {
        // Generic digital product
        knowledge += `**Requirements**: Email address (we'll notify if anything else needed)\n`;
        knowledge += `**Delivery**: Credentials/activation within 24 hours via email\n`;
      }
      
      knowledge += `**Order URL**: https://snippymart.com/product/${p.slug}\n`;
      knowledge += `\n---\n\n`;
    });

    // Add general info
    knowledge += `## Important Notes:\n`;
    knowledge += `- All activations are done on FRESH accounts (no password sharing)\n`;
    knowledge += `- You get your OWN credentials\n`;
    knowledge += `- Delivery within 24 hours (usually much faster)\n`;
    knowledge += `- Email delivery (check spam folder)\n`;
    knowledge += `- Payment: Bank Transfer or Binance USDT\n`;
    knowledge += `- Support available via WhatsApp\n`;

    productKnowledgeBase = knowledge;
    console.log("✅ Product knowledge loaded:", products.length, "products");
    console.log("📖 Knowledge base size:", knowledge.length, "characters");
  } catch (err) {
    console.error("❌ Error loading knowledge:", err.message);
  }
}

// Load on startup
loadProductKnowledge();

// ================= AI PRODUCT EXPERT =================
async function askProductExpert(userPhone, userMessage) {
  try {
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
        content: `You are an expert product advisor for Snippy Mart.

${productKnowledgeBase}

## Your Role:
You answer questions about OUR products ONLY. Users can ask you ANYTHING about our available products:
- Features and capabilities
- What's included
- Requirements (email, username, etc.)
- Pricing
- Delivery time
- How activation works
- Differences between products
- Which product is best for their needs

## Response Rules:
1. Answer ONLY about products in the catalog above
2. If asked about a product NOT in our catalog, say "We don't currently offer that product. Reply *MENU* to see what we have!"
3. Be specific and detailed - users want to know EXACTLY what they're getting
4. Always mention the price when discussing a product
5. Keep responses under 400 characters
6. Use emojis appropriately (💻 🤖 ✅ 📧 etc.)
7. End helpful answers with: "Want to order? Reply *MENU* and select the product!"
8. If they want to order directly, tell them: "Reply *MENU* and select [product name]"

## Examples:
User: "Does ChatGPT Plus include GPT-4?"
You: "Yes! ✅ ChatGPT Plus ($20) includes full GPT-4 access, DALL-E 3, web browsing, and all plugins. You get your own account with just your email. Want to order? Reply *MENU*!"

User: "What's the difference between Cursor and GitHub Copilot?"
You: "Cursor ($10) is a full IDE with AI built-in. GitHub Copilot ($8) is a plugin for your existing editor. Cursor is better for full AI coding, Copilot for code suggestions. Reply *MENU* to see both! 💻"

User: "Do I need a password?"
You: "No password needed! ✅ You only need your email. We activate on a FRESH account and send you the new credentials within 24hrs. Want to order? Reply *MENU*!"`
      },
      ...conversation.messages.slice(-4), // Keep last 4 messages
      {
        role: "user",
        content: userMessage
      }
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messages,
      temperature: 0.7,
      max_tokens: 250,
    });

    const aiResponse = completion.choices[0].message.content;

    conversation.messages.push(
      { role: "user", content: userMessage },
      { role: "assistant", content: aiResponse }
    );

    if (conversation.messages.length > 8) {
      conversation.messages = conversation.messages.slice(-8);
    }

    console.log("🤖 AI:", aiResponse.substring(0, 80) + "...");
    return aiResponse;
  } catch (err) {
    console.error("❌ OpenAI Error:", err.message);
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
  console.log("📤 SEND:", res.status);
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
      headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data : null;
  } catch (err) {
    console.error("❌ Products error:", err.message);
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
  } catch (err) {
    console.error("❌ Flow error:", err.message);
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
    console.error("❌ Log error:", err.message);
  }
}

// ================= BOT ACTIONS =================
async function sendMenu(sessionId, to) {
  const products = await getProducts();

  if (!products || products.length === 0) {
    await sendText(sessionId, to, "⚠️ No products available.");
    return;
  }

  let menuText = "🛍️ *Snippy Mart Products*\n\n";
  menuText += "Reply with the number:\n\n";
  
  products.forEach((p, index) => {
    menuText += `${index + 1}. ${p.menuTitle}\n`;
  });
  
  menuText += "\n💬 _Ask me anything about any product!_\n";
  menuText += "_Type *STOP* to exit_";

  const success = await sendText(sessionId, to, menuText);

  if (success) {
    await logEvent(to, "MENU_REQUEST", null, "menu");
    if (!global.userProducts) global.userProducts = new Map();
    global.userProducts.set(to, products);
  }
}

async function sendProductFlow(sessionId, to, productId) {
  const flow = await getProductFlow(productId);
  if (!flow) {
    await sendText(sessionId, to, "⚠️ Product not found.");
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
    await sendText(
      sessionId,
      to,
      `👉 *Order Now*\n${flow.orderUrl}\n\n_Questions? Just ask! 💬_`
    );
    await logEvent(to, "ORDER_CLICK", productId);
  }
}

async function activateBot(sessionId, to) {
  botUsers.add(to);
  await sendText(
    sessionId,
    to,
    "🤖 *Snippy Mart Product Expert*\n\n✅ I'm your AI assistant!\n\n💬 *Ask me ANYTHING about our products:*\n• What's included?\n• Requirements?\n• Features?\n• Pricing?\n• Best for your needs?\n\n📱 Or reply *MENU* to browse\n\n_Type *STOP* to exit_"
  );
  console.log("✅ Bot activated:", to);
}

async function deactivateBot(sessionId, to) {
  botUsers.delete(to);
  conversationHistory.delete(to);
  if (global.userProducts) {
    global.userProducts.delete(to);
  }
  await sendText(
    sessionId,
    to,
    "👋 *Bot Deactivated*\n\nChat with our team normally.\n\n_Send *SNIPPY* to reactivate_"
  );
  console.log("✅ Deactivated:", to);
}

// ================= WEBHOOK =================
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  const core = extractCore(req.body);
  if (!core || !core.id || !core.from || core.fromMe) return;

  // Deduplication
  const now = Date.now();
  if (handledMessages.has(core.id)) {
    const age = now - handledMessages.get(core.id);
    if (age < 60000) return;
  }
  handledMessages.set(core.id, now);

  const { sessionId, from, text, listReplyId } = core;

  // Activation/deactivation
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
  }

  // Check bot mode
  if (!botUsers.has(from)) return;

  // Handle list replies
  if (listReplyId) {
    await sendProductFlow(sessionId, from, listReplyId);
    return;
  }

  if (!text) return;

  const lowerText = text.toLowerCase().trim();

  // Menu
  if (lowerText === "menu" || lowerText === "hi" || lowerText === "hello") {
    await sendMenu(sessionId, from);
    return;
  }

  // Number selection
  const numberMatch = text.match(/^(\d+)$/);
  if (numberMatch && global.userProducts?.has(from)) {
    const index = parseInt(numberMatch[1]) - 1;
    const userProductList = global.userProducts.get(from);
    
    if (index >= 0 && index < userProductList.length) {
      await sendProductFlow(sessionId, from, userProductList[index].id);
      return;
    }
  }

  // Product keyword match
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

  // ⭐ ASK AI PRODUCT EXPERT
  console.log("🤖 Asking AI about:", text.substring(0, 50));
  await logEvent(from, "PRODUCT_QUESTION", null, text);
  
  const aiResponse = await askProductExpert(from, text);
  
  if (aiResponse) {
    await sendText(sessionId, from, aiResponse);
    console.log("✅ AI answered");
  } else {
    await sendText(
      sessionId,
      from,
      "Sorry, I'm having trouble. 😔 Reply *MENU* to browse products!"
    );
  }
});

// ================= ENDPOINTS =================
app.get("/", (_, res) => {
  res.json({
    status: "online",
    service: "Snippy Mart AI Product Expert",
    ai: OPENAI_API_KEY ? "enabled" : "disabled",
    botUsers: botUsers.size,
    conversations: conversationHistory.size,
    knowledgeLoaded: productKnowledgeBase.length > 0
  });
});

app.post("/reload-knowledge", async (req, res) => {
  await loadProductKnowledge();
  res.json({ success: true, products: productKnowledgeBase.length });
});

// ================= START =================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("🚀 SNIPPY MART AI PRODUCT EXPERT");
  console.log(`🤖 OpenAI: ${OPENAI_API_KEY ? 'Enabled ✅' : 'DISABLED ❌'}`);
  console.log(`📚 Knowledge: ${productKnowledgeBase ? 'Loaded ✅' : 'Loading...'}`);
  console.log("✅ Ready!");
});
