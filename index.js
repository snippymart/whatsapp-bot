import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json({ type: "*/*" }));

// ================= CONFIG =================
const WASENDER_SESSION_KEY = process.env.WASENDER_SESSION_KEY;
const ADMIN_NUMBERS = (process.env.ADMIN_NUMBERS || "94776512486").split(",");
const SEND_URL = "https://api.wasenderapi.com/api/send-message";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Supabase
const SUPABASE_URL = "https://vuffzfuklzzcnfnubtzx.supabase.co/functions/v1";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1ZmZ6ZnVrbHp6Y25mbnVidHp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2OTQ1NjAsImV4cCI6MjA4NDI3MDU2MH0.qHjJYOrNi1cBYPYapmHMJgDxsI50sHAKUAvv0VnPQFM";

// Initialize OpenAI
let openai = null;
if (OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: OPENAI_API_KEY });
}

// State
const botUsers = new Set();
const handledMessages = new Map();
const conversationHistory = new Map();
const humanHandling = new Map();
const blockedUsers = new Set();
let productKnowledgeBase = "";

function isAdmin(phone) {
  return ADMIN_NUMBERS.includes(phone);
}

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
  
  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  for (const [user, timestamp] of humanHandling.entries()) {
    if (timestamp < twoHoursAgo) {
      humanHandling.delete(user);
    }
  }
}, 5 * 60 * 1000);

// ================= LOAD WHATSAPP-ENABLED PRODUCTS ONLY =================
async function loadProductKnowledge() {
  try {
    console.log("📚 Loading WhatsApp-enabled products...");
    
    const res = await fetch(
      `https://vuffzfuklzzcnfnubtzx.supabase.co/rest/v1/whatsapp_product_config?select=*,product:products!inner(*)&enabled=eq.true`,
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

    const whatsappProducts = await res.json();
    
    if (!whatsappProducts || whatsappProducts.length === 0) {
      console.warn("⚠️ No WhatsApp-enabled products found");
      productKnowledgeBase = "No products available yet.";
      return;
    }

    let knowledge = `# Snippy Mart - WhatsApp Product Catalog\n\n`;
    knowledge += `You are a product expert for Snippy Mart. Answer ONLY about these enabled products:\n\n`;

    whatsappProducts.forEach((wp) => {
      const p = wp.product;
      
      knowledge += `## ${p.name}\n`;
      knowledge += `**Price**: LKR ${p.price.toLocaleString('en-US')}\n`;
      knowledge += `**Menu Title**: ${wp.menu_title}\n`;
      
      if (p.description) {
        knowledge += `**Description**: ${p.description}\n`;
      }
      
      if (wp.trigger_keywords && wp.trigger_keywords.length > 0) {
        knowledge += `**Keywords**: ${wp.trigger_keywords.join(', ')}\n`;
      }
      
      const productName = p.name.toLowerCase();
      
      if (productName.includes('chatgpt')) {
        knowledge += `**Type**: AI Assistant\n`;
        knowledge += `**Requirements**: Email address only\n`;
        knowledge += `**Includes**: GPT-4, DALL-E 3, plugins, web browsing\n`;
        knowledge += `**Platform**: OpenAI ChatGPT\n`;
      } else if (productName.includes('cursor')) {
        knowledge += `**Type**: AI Code Editor\n`;
        knowledge += `**Requirements**: Email address only\n`;
        knowledge += `**Includes**: Unlimited AI autocomplete, chat, multi-file editing\n`;
        knowledge += `**Platform**: Cursor IDE\n`;
      } else if (productName.includes('claude')) {
        knowledge += `**Type**: AI Assistant\n`;
        knowledge += `**Requirements**: Email address only\n`;
        knowledge += `**Includes**: Claude 3.5 Sonnet, priority access, longer context\n`;
        knowledge += `**Platform**: Anthropic Claude\n`;
      } else if (productName.includes('github') && productName.includes('copilot')) {
        knowledge += `**Type**: AI Code Assistant\n`;
        knowledge += `**Requirements**: Email + GitHub username\n`;
        knowledge += `**Includes**: AI code suggestions, autocomplete, chat\n`;
        knowledge += `**Platform**: GitHub Copilot\n`;
      } else if (productName.includes('netflix')) {
        knowledge += `**Type**: Streaming Service\n`;
        knowledge += `**Requirements**: Email address only\n`;
        knowledge += `**Includes**: 4K streaming, multiple profiles\n`;
        knowledge += `**Platform**: Netflix\n`;
      } else if (productName.includes('spotify')) {
        knowledge += `**Type**: Music Streaming\n`;
        knowledge += `**Requirements**: Email address only\n`;
        knowledge += `**Includes**: Ad-free music, offline downloads\n`;
        knowledge += `**Platform**: Spotify\n`;
      } else {
        knowledge += `**Type**: Digital Service\n`;
        knowledge += `**Requirements**: Email address (additional info may be required)\n`;
      }
      
      knowledge += `**Slug**: ${p.slug}\n`;
      knowledge += `**Order Link**: https://snippymart.com/product/${p.slug}\n`;
      knowledge += `\n---\n\n`;
    });

    knowledge += `\n## General Information:\n`;
    knowledge += `- **Currency**: All prices in Sri Lankan Rupees (LKR)\n`;
    knowledge += `- **Delivery Time**: Within 24 hours (usually much faster)\n`;
    knowledge += `- **Payment Methods**: Bank Transfer or Binance USDT (Card payment available via team)\n`;
    knowledge += `- **Account Type**: Fresh activations on new accounts (no sharing)\n`;
    knowledge += `- **Credentials**: Sent via email after payment\n`;
    knowledge += `- **Support**: Available via WhatsApp\n`;
    knowledge += `- **Website**: snippymart.com\n\n`;

    knowledge += `## Important Rules for You:\n`;
    knowledge += `1. ONLY mention products listed above (these are WhatsApp-enabled)\n`;
    knowledge += `2. If asked about a product NOT listed above, say: "We don't have that available via WhatsApp currently. Type *HUMAN* to ask our team!"\n`;
    knowledge += `3. NEVER make up features or prices\n`;
    knowledge += `4. If you don't know something, say: "I'm not sure about that. Type *HUMAN* to speak with our team!"\n`;
    knowledge += `5. Always use LKR for prices (never $)\n`;
    knowledge += `6. Be honest and helpful\n`;
    knowledge += `7. For ordering questions, direct to snippymart.com\n`;

    productKnowledgeBase = knowledge;
    console.log("✅ Loaded", whatsappProducts.length, "WhatsApp-enabled products");
  } catch (err) {
    console.error("❌ Knowledge error:", err.message);
  }
}

loadProductKnowledge();

// ================= AI EXPERT =================
async function askProductExpert(userPhone, userMessage) {
  if (!openai) {
    return "I'm in basic mode. Type *MENU* for products or *HUMAN* for support!";
  }

  try {
    const orderingKeywords = [
      'how to buy', 'how to order', 'how to purchase', 'how do i buy',
      'how can i order', 'payment', 'pay', 'checkout', 'card payment',
      'credit card', 'debit card', 'buy this', 'want to buy',
      'place order', 'how to get', 'payment methods', 'how can i pay'
    ];
    
    const lowerMsg = userMessage.toLowerCase();
    const isOrderingQuestion = orderingKeywords.some(kw => lowerMsg.includes(kw));
    
    if (isOrderingQuestion) {
      return "ORDER_INFO";
    }

    const escalationKeywords = [
      'human', 'person', 'talk to someone', 'speak to',
      'representative', 'agent', 'support', 'help me',
      'contact', 'admin', 'manager', 'real person',
      'not helpful', 'confused', "don't understand"
    ];
    
    if (escalationKeywords.some(kw => lowerMsg.includes(kw))) {
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
        content: `You are a helpful product expert for Snippy Mart, a Sri Lankan digital service provider.

${productKnowledgeBase}

## How to Order:
When users ask about ordering/buying/payment, tell them to visit **snippymart.com** and:
- Bank Transfer or Binance USDT available now
- Card payment available (contact team for secure link)

## Response Guidelines:
1. **Be Honest**: If you don't know something, admit it and suggest typing *HUMAN*
2. **Currency**: Always use "LKR" not "$" - format like "LKR 5,000"
3. **Only Available Products**: Answer ONLY about products listed in your catalog
4. **Be Concise**: Keep responses under 350 characters
5. **Be Helpful**: Use emojis, be friendly
6. **Call-to-Action**: End with "Reply *MENU* to order!" or "Type *HUMAN* for more help!"
7. **Never Make Up**: If unsure about features, don't guess
8. **Payment Questions**: Direct to website with payment options

## Example Responses:

User: "How do I buy?"
You: "Easy! 🛍️ Visit snippymart.com and place your order. We accept Bank Transfer & Binance USDT 💳 For card payment, contact us and we'll send a secure payment link! Reply *MENU* to browse products!"

User: "Does Cursor include GPT-4?"
You: "Cursor has its own AI model optimized for coding! It's different from ChatGPT. For coding, Cursor is excellent 💻 LKR 3,000. Want to order? Reply *MENU*!"

User: "What about Spotify?"
You (if not in catalog): "We don't have Spotify available via WhatsApp currently. Type *HUMAN* to ask our team if it's available!"

User: "How much is ChatGPT?"
You: "ChatGPT Plus is LKR 6,500 ✅ Includes GPT-4, DALL-E, plugins. Just need your email! Reply *MENU* to order!"

User: "Is it safe?"
You: "Yes! You get your OWN fresh account with new credentials. No sharing, 100% safe ✅ Visit snippymart.com to order!"

User: "Can I pay with card?"
You: "Yes! 💳 For card payment, contact our team and we'll send you a secure payment link. Or use Bank Transfer/Binance now at snippymart.com! Type *HUMAN* to reach our team!"`
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
  const success = await send({
    sessionId,
    to,
    type: "buttons",
    text: text,
    buttons: buttons.map((btn, idx) => ({
      id: `btn_${idx}_${btn.id}`,
      text: btn.text
    }))
  });
  
  if (!success) {
    await sendText(sessionId, to, text);
  }
  
  return success;
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
  menuText += "_Reply with number to view:_\n\n";
  
  products.forEach((p, index) => {
    menuText += `${index + 1}️⃣ ${p.menuTitle}\n`;
  });
  
  menuText += "\n💬 *Ask me anything!*\n";
  menuText += "_Type *HUMAN* for support_";

  await sendWithButtons(sessionId, to, menuText, [
    { id: "human", text: "💬 Talk to Team" }
  ]);

  await logEvent(to, "MENU_REQUEST");
  if (!global.userProducts) global.userProducts = new Map();
  global.userProducts.set(to, products);
}

async function sendProductFlow(sessionId, to, productId) {
  const flow = await getProductFlow(productId);
  if (!flow) {
    await sendText(sessionId, to, "⚠️ Product not found. Type *MENU* to try again.");
    return;
  }

  await logEvent(to, "PRODUCT_VIEW", productId);

  for (const step of flow.flowSteps) {
    await sendText(sessionId, to, `*${step.title}*\n\n${step.message}`);
    if (step.delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, step.delayMs));
    }
  }

  if (flow.showOrderLink && flow.orderUrl) {
    await sendWithButtons(sessionId, to, 
      `👉 *Order Now*\n${flow.orderUrl}\n\n_Questions? Just ask!_`, 
      [
        { id: "menu", text: "🛍️ More Products" },
        { id: "human", text: "💬 Talk to Team" }
      ]
    );
    await logEvent(to, "ORDER_CLICK", productId);
  }
}

async function sendOrderingInfo(sessionId, to) {
  const orderMsg = "🛍️ *How to Order on Snippy Mart*\n\n" +
    "1️⃣ Visit our website:\n" +
    "🌐 *snippymart.com*\n\n" +
    "2️⃣ Choose your product and checkout\n\n" +
    "💳 *Payment Options:*\n" +
    "✅ Bank Transfer (Available now)\n" +
    "✅ Binance USDT (Available now)\n" +
    "💳 Card Payment (Contact us for secure link)\n\n" +
    "_For card payment, type *HUMAN* and our team will send you a secure payment link!_\n\n" +
    "Reply *MENU* to browse products! 🚀";
  
  await sendWithButtons(sessionId, to, orderMsg, [
    { id: "menu", text: "🛍️ View Products" },
    { id: "human", text: "💬 Card Payment" }
  ]);
}

async function escalateToHuman(sessionId, to) {
  humanHandling.set(to, Date.now());
  
  await sendText(
    sessionId,
    to,
    "👤 *Connecting to support...*\n\n" +
    "✅ Our team will respond shortly.\n\n" +
    "_Feel free to continue chatting!_"
  );

  await logEvent(to, "ESCALATION");
  console.log("🆘 Escalated:", to);
}

async function activateBot(sessionId, to) {
  botUsers.add(to);
  humanHandling.delete(to);
  
  const welcomeMsg = "🤖 *Snippy Mart AI Assistant*\n\n" +
    "✅ I'm here to help!\n\n" +
    "💬 *Ask me about:*\n" +
    "• Products & features\n" +
    "• Pricing (LKR)\n" +
    "• Requirements & delivery\n" +
    "• How to order\n\n" +
    "📱 *Commands:*\n" +
    "• *MENU* - Browse products\n" +
    "• *HUMAN* - Talk to team\n" +
    "• *STOP* - Exit bot";

  await sendWithButtons(sessionId, to, welcomeMsg, [
    { id: "menu", text: "🛍️ Products" },
    { id: "human", text: "💬 Support" }
  ]);

  console.log("✅ Activated:", to);
}

async function deactivateBot(sessionId, to) {
  botUsers.delete(to);
  humanHandling.delete(to);
  conversationHistory.delete(to);
  if (global.userProducts) global.userProducts.delete(to);
  
  await sendText(sessionId, to, "👋 *Bot Deactivated*\n\n_Send *SNIPPY* to reactivate_");
  console.log("✅ Deactivated:", to);
}

// ================= ADMIN COMMANDS =================
async function handleAdminCommand(sessionId, from, text) {
  const cmd = text.toLowerCase().trim();

  if (cmd.startsWith('/resume ')) {
    const targetPhone = cmd.split(' ')[1];
    humanHandling.delete(targetPhone);
    await sendText(sessionId, from, `✅ Bot resumed for ${targetPhone}`);
    await sendText(sessionId, targetPhone, "🤖 *Bot resumed!* Reply *MENU* for products!");
    return true;
  }

  if (cmd.startsWith('/block ')) {
    const targetPhone = cmd.split(' ')[1];
    blockedUsers.add(targetPhone);
    botUsers.delete(targetPhone);
    await sendText(sessionId, from, `🚫 Blocked ${targetPhone}`);
    return true;
  }

  if (cmd.startsWith('/unblock ')) {
    const targetPhone = cmd.split(' ')[1];
    blockedUsers.delete(targetPhone);
    await sendText(sessionId, from, `✅ Unblocked ${targetPhone}`);
    return true;
  }

  if (cmd.startsWith('/info ')) {
    const targetPhone = cmd.split(' ')[1];
    const info = `📊 *User: ${targetPhone}*\n\n` +
      `Bot Mode: ${botUsers.has(targetPhone) ? '✅' : '❌'}\n` +
      `Human: ${humanHandling.has(targetPhone) ? '✅' : '❌'}\n` +
      `Blocked: ${blockedUsers.has(targetPhone) ? '🚫' : '❌'}\n` +
      `AI Chat: ${conversationHistory.has(targetPhone) ? '✅' : '❌'}`;
    await sendText(sessionId, from, info);
    return true;
  }

  if (cmd === '/stats') {
    const stats = `📊 *Bot Stats*\n\n` +
      `👥 Active: ${botUsers.size}\n` +
      `🤝 Human: ${humanHandling.size}\n` +
      `🚫 Blocked: ${blockedUsers.size}\n` +
      `💬 Chats: ${conversationHistory.size}\n` +
      `🤖 AI: ${openai ? '✅' : '❌'}`;
    await sendText(sessionId, from, stats);
    return true;
  }

  if (cmd.startsWith('/broadcast ')) {
    const message = text.substring('/broadcast '.length);
    let sent = 0;
    for (const user of botUsers) {
      await sendText(sessionId, user, `📢 *Announcement*\n\n${message}`);
      sent++;
    }
    await sendText(sessionId, from, `✅ Sent to ${sent} users`);
    return true;
  }

  if (cmd === '/help' || cmd === '/commands') {
    const help = `🔧 *Admin Commands*\n\n` +
      `👤 User Control:\n` +
      `• /resume {phone}\n` +
      `• /block {phone}\n` +
      `• /unblock {phone}\n` +
      `• /info {phone}\n\n` +
      `📊 System:\n` +
      `• /stats\n` +
      `• /broadcast {msg}\n` +
      `• /reload\n` +
      `• /help`;
    await sendText(sessionId, from, help);
    return true;
  }

  if (cmd === '/reload') {
    await loadProductKnowledge();
    await sendText(sessionId, from, "✅ Products reloaded!");
    return true;
  }

  return false;
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

  // Admin commands
  if (isAdmin(from) && text && text.startsWith('/')) {
    const handled = await handleAdminCommand(sessionId, from, text);
    if (handled) return;
  }

  // Admin chatting
  if (isAdmin(from) && text && !text.startsWith('/')) {
    return;
  }

  // Blocked
  if (blockedUsers.has(from)) return;

  // Human mode
  if (humanHandling.has(from)) {
    humanHandling.set(from, Date.now());
    return;
  }

  // Buttons
  if (buttonResponse) {
    if (buttonResponse.includes('menu')) {
      await sendMenu(sessionId, from);
      return;
    }
    if (buttonResponse.includes('human')) {
      await escalateToHuman(sessionId, from);
      return;
    }
  }

  // Commands
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
      if (!botUsers.has(from)) botUsers.add(from);
      await escalateToHuman(sessionId, from);
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

  // Keyword match
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

  // AI
  console.log("🤖 AI:", text.substring(0, 40));
  await logEvent(from, "AI_QUERY", null, text);
  
  const aiResponse = await askProductExpert(from, text);
  
  if (aiResponse === "ESCALATE") {
    await escalateToHuman(sessionId, from);
  } else if (aiResponse === "ORDER_INFO") {
    await sendOrderingInfo(sessionId, from);
  } else if (aiResponse) {
    await sendText(sessionId, from, aiResponse);
  } else {
    await sendText(sessionId, from, "I'm having trouble. Type *HUMAN* for support or *MENU* for products!");
  }
});

// ================= ENDPOINTS =================
app.get("/", (_, res) => {
  res.json({
    status: "online",
    service: "Snippy Mart AI Bot",
    version: "2.0.0",
    ai: openai ? "enabled" : "disabled",
    activeUsers: botUsers.size,
    humanHandling: humanHandling.size,
    admins: ADMIN_NUMBERS.length
  });
});

app.post("/reload", async (req, res) => {
  await loadProductKnowledge();
  res.json({ success: true, products: productKnowledgeBase.length });
});

// ================= START =================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("🚀 SNIPPY MART AI BOT - PRODUCTION v2.0");
  console.log(`📡 Port: ${PORT}`);
  console.log(`🤖 AI: ${openai ? '✅ Enabled' : '❌ Disabled'}`);
  console.log(`👥 Admins: ${ADMIN_NUMBERS.join(', ')}`);
  console.log(`📚 Products: ${productKnowledgeBase ? 'Loaded ✅' : 'Loading...'}`);
  console.log("✅ READY TO SERVE!");
});
