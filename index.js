import express from "express";

const app = express();
app.use(express.json());

// Health check
app.get("/", (req, res) => {
  res.send("Webhook is live");
});

// Webhook endpoint (DEBUG ONLY)
app.post("/webhook", async (req, res) => {
  // IMPORTANT: Always respond 200 fast
  res.sendStatus(200);

  console.log("======================================");
  console.log("📩 WEBHOOK RECEIVED AT", new Date().toISOString());
  console.log("HEADERS:");
  console.log(JSON.stringify(req.headers, null, 2));
  console.log("BODY:");
  console.log(JSON.stringify(req.body, null, 2));
  console.log("======================================");
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
