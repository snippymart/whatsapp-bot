import express from "express";

const app = express();
app.use(express.json({ type: "*/*" }));

app.all("*", (req, res) => {
  console.log("🔥 REQUEST RECEIVED");
  console.log("METHOD:", req.method);
  console.log("PATH:", req.path);
  console.log("HEADERS:", req.headers);
  console.log("BODY:", JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 SERVER LISTENING ON", PORT);
});
