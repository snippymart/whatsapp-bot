import express from "express";

const app = express();
app.use(express.json({ type: "*/*" }));

// ============================================================================
// CONFIGURATION
// ============================================================================
const WASENDER_SESSION_KEY = process.env.WASENDER_SESSION_KEY;
const ADMIN_NUMBERS = (process.env.ADMIN_NUMBERS || "94787767869").split(",");
const SEND_URL = "https://api.wasenderapi.com/api/send-message";

// ============================================================================
// STATE MANAGEMENT
// ============================================================================
const handledMessages = new Map();
const autoRepliedUsers = new Map(); // Track who got auto-reply in current offline window
const blockedUsers = new Set();
let currentBusinessHoursState = null;

// ============================================================================
// BUSINESS HOURS LOGIC
// ============================================================================
function isWithinBusinessHours() {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const currentTime = hours * 60 + minutes;

    // Business hours: 4:00 PM – 6:00 PM and 8:00 PM – 10:00 PM
    const slot1Start = 16 * 60; // 4:00 PM
    const slot1End = 18 * 60;   // 6:00 PM
    const slot2Start = 20 * 60; // 8:00 PM
    const slot2End = 22 * 60;   // 10:00 PM

    return (currentTime >= slot1Start && currentTime < slot1End) ||
        (currentTime >= slot2Start && currentTime < slot2End);
}

function getCurrentBusinessWindow() {
    const now = new Date();
    const hours = now.getHours();

    if (hours >= 16 && hours < 18) return "slot1";
    if (hours >= 20 && hours < 22) return "slot2";
    return "offline";
}

// Reset auto-reply tracking when business hours change
function checkAndResetAutoReplies() {
    const currentWindow = getCurrentBusinessWindow();

    if (currentWindow !== currentBusinessHoursState) {
        if (currentWindow !== "offline") {
            autoRepliedUsers.clear();
            console.log(`✅ Business hours started (${currentWindow}). Auto-reply tracking reset.`);
        }
        currentBusinessHoursState = currentWindow;
    }
}

// Check every minute
setInterval(checkAndResetAutoReplies, 60000);

function isAdmin(phone) {
    return ADMIN_NUMBERS.includes(phone);
}

// ============================================================================
// AUTO-CLEANUP
// ============================================================================
setInterval(() => {
    const now = Date.now();

    // Clear handled messages older than 5 minutes
    for (const [msgId, timestamp] of handledMessages.entries()) {
        if (now - timestamp > 300000) handledMessages.delete(msgId);
    }
}, 300000);

// ============================================================================
// WHATSAPP API HELPERS
// ============================================================================
function extractCore(body) {
    try {
        const msg = body?.data?.messages;
        if (!msg) return null;
        return {
            id: msg.id || msg?.key?.id,
            from: msg.cleanedSenderPn || msg?.key?.cleanedSenderPn,
            text: msg.message?.conversation || msg.messageBody || null,
            sessionId: body.sessionId || body.data?.sessionId,
            fromMe: msg.key?.fromMe || msg.fromMe || false
        };
    } catch { return null; }
}

async function send(payload) {
    try {
        const res = await fetch(SEND_URL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${WASENDER_SESSION_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });
        return res.ok;
    } catch { return false; }
}

async function sendText(sessionId, to, text) {
    return send({ sessionId, to, type: "text", text });
}

// ============================================================================
// AUTO-REPLY SYSTEM (BUSINESS HOURS ENFORCEMENT)
// ============================================================================
async function sendOfflineAutoReply(sessionId, from) {
    // Check if already sent auto-reply in this offline window
    if (autoRepliedUsers.has(from)) {
        console.log(`⏭️ Skipping auto-reply for ${from} - already sent in this window`);
        return false;
    }

    const autoReplyMessage = `Hi 👋

Thanks for reaching out.

We're currently *offline* and operate strictly during fixed support hours to ensure quality service.

🕓 *Support Hours:*
• 4:00 PM – 6:00 PM
• 8:00 PM – 10:00 PM

Messages sent outside these hours will be reviewed during the next available slot.
Repeated messages won't speed up responses.

🛒 *To place new orders, please visit:*
https://snippymart.com

🤖 *For service details, FAQs, and instant answers, please use the AI Chat on our website* — it's available 24/7 and explains everything clearly.

Thank you for your patience.`;

    const success = await sendText(sessionId, from, autoReplyMessage);

    if (success) {
        autoRepliedUsers.set(from, Date.now());
        console.log(`✅ Auto-reply sent to ${from}`);
    }

    return success;
}

// ============================================================================
// ADMIN COMMANDS
// ============================================================================
async function handleAdminCommand(sessionId, from, text) {
    const cmd = text.toLowerCase().trim();
    const parts = text.split(' ');

    if (cmd === '/stats') {
        const stats = `📊 *Bot Stats*\n\n` +
            `🚫 Blocked: ${blockedUsers.size}\n` +
            `🕓 Business Hours: ${isWithinBusinessHours() ? 'ONLINE ✅' : 'OFFLINE ⏰'}\n` +
            `📧 Auto-replied (this window): ${autoRepliedUsers.size}`;
        await sendText(sessionId, from, stats);
        return true;
    }

    if (cmd.startsWith('/block ')) {
        const target = parts[1];
        blockedUsers.add(target);
        await sendText(sessionId, from, `🚫 Blocked ${target}`);
        return true;
    }

    if (cmd.startsWith('/unblock ')) {
        const target = parts[1];
        blockedUsers.delete(target);
        await sendText(sessionId, from, `✅ Unblocked ${target}`);
        return true;
    }

    if (cmd.startsWith('/info ')) {
        const target = parts[1];
        const info = `📊 *User: ${target}*\n\n` +
            `Blocked: ${blockedUsers.has(target) ? '🚫 YES' : '❌ NO'}\n` +
            `Auto-replied: ${autoRepliedUsers.has(target) ? '✅ YES' : '❌ NO'}`;
        await sendText(sessionId, from, info);
        return true;
    }

    if (cmd === '/clear') {
        autoRepliedUsers.clear();
        await sendText(sessionId, from, `✅ Cleared all auto-reply tracking`);
        return true;
    }

    if (cmd === '/help' || cmd === '/commands') {
        const help = `🔧 *Admin Commands*\n\n` +
            `📊 System:\n` +
            `• /stats - View statistics\n` +
            `• /info {phone} - User info\n` +
            `• /block {phone} - Block user\n` +
            `• /unblock {phone} - Unblock user\n` +
            `• /clear - Clear auto-reply tracking\n` +
            `• /help - Show commands`;
        await sendText(sessionId, from, help);
        return true;
    }

    return false;
}

// ============================================================================
// WEBHOOK HANDLER
// ============================================================================
app.post("/webhook", async (req, res) => {
    res.sendStatus(200);

    const core = extractCore(req.body);
    if (!core || !core.id || !core.from || core.fromMe) return;

    // Deduplication
    if (handledMessages.has(core.id)) return;
    handledMessages.set(core.id, Date.now());

    const { sessionId, from, text } = core;

    // Check business hours state
    checkAndResetAutoReplies();
    const isOnline = isWithinBusinessHours();

    // Admin commands (always work)
    if (isAdmin(from) && text && text.startsWith('/')) {
        const handled = await handleAdminCommand(sessionId, from, text);
        if (handled) return;
    }

    // Admin manual chat (don't interfere)
    if (isAdmin(from) && text && !text.startsWith('/')) return;

    // Blocked users
    if (blockedUsers.has(from)) return;

    // OFFLINE MODE - Send auto-reply once per window, then stay silent
    if (!isOnline && !isAdmin(from)) {
        await sendOfflineAutoReply(sessionId, from);
        return;
    }

    // ONLINE MODE - All messages pass through to you (no bot interference)
    // The bot does nothing during business hours - you handle manually
});

// ============================================================================
// SYSTEM ENDPOINTS
// ============================================================================
app.get("/", (_, res) => {
    res.json({
        status: "online",
        service: "Snippy Mart WhatsApp Auto-Reply",
        version: "4.0.0 - Business Hours Only",
        businessHours: isWithinBusinessHours() ? "ONLINE" : "OFFLINE",
        autoRepliedThisWindow: autoRepliedUsers.size,
        blockedUsers: blockedUsers.size
    });
});

// ============================================================================
// SERVER START
// ============================================================================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log("🚀 SNIPPY MART AUTO-REPLY BOT v4.0.0");
    console.log(`📡 Port: ${PORT}`);
    console.log(`👥 Admins: ${ADMIN_NUMBERS.join(', ')}`);
    console.log(`🕓 Business Hours: ${isWithinBusinessHours() ? 'ONLINE ✅' : 'OFFLINE ⏰'}`);
    console.log("✅ READY!");
});
