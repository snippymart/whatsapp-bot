import express from "express";

const app = express();

// IMPORTANT: accept ALL content types
app.use(express.json({ type: "*/*" }));

/**
 * WEBHOOK – CATCH ALL (THIS IS WHAT WORKED BEFORE)
 */
app.post("/webhook", (req, res) => {
  // Always respond OK immediately
  res.sendStatus(200);

  console.log("======================================");
  console.log("📩 RAW WEBHOOK RECEIVED AT", new Date().toISOString());
  console.log("HEADERS:");
  console.log(JSON.stringify(req.headers, null, 2));
  console.log("BODY:");
  console.log(JSON.stringify(req.body, null, 2));
  console.log("======================================");
});

/**
 * SIMPLE TEST ROUTE (DO NOT REMOVE)
 */
app.get("/test", (req, res) => {
  console.log("🔥 TEST HIT");
  res.send("Test OK");
});

/**
 * ROOT HEALTH CHECK
 */
app.get("/", (req, res) => {
  res.send("Webhook live");
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 SERVER LISTENING ON ${PORT}`);
});
