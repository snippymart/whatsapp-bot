import express from "express";

const app = express();
app.use(express.json({ type: "*/*" }));

function extractMessage(body) {
  try {
    // Try multiple known paths (defensive)
    return (
      body?.data?.messages?.message?.conversation ||
      body?.data?.messages?.messageBody ||
      body?.data?.messageBody ||
      body?.messageBody ||
      null
    );
  } catch {
    return null;
  }
}

app.post("/webhook", (req, res) => {
  res.sendStatus(200);

  console.log("======================================");
  console.log("📩 WEBHOOK RECEIVED");
  console.log(JSON.stringify(req.body, null, 2));

  const text = extractMessage(req.body);

  if (text) {
    console.log("📝 EXTRACTED MESSAGE:", text);
  } else {
    console.log("⚠️ NO MESSAGE TEXT FOUND (still OK)");
  }

  console.log("======================================");
});

app.get("/", (_, res) => res.send("Webhook live"));

app.listen(process.env.PORT || 8080, () => {
  console.log("🚀 SERVER LISTENING");
});
