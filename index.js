const payload = {
  sessionId: req.body?.data?.sessionId,
  number: from,
  text: `🚀 *Cursor Pro – Official Premium*

✅ Works on *your own account*
🔒 We *never* ask for passwords
⚡ Activation within 24 hours

👉 Order here:
https://yourwebsite.com/cursor

Reply *PRICE* or *DETAILS* to know more 👇`
};

console.log("📤 Sending payload:", payload);

const response = await fetch(SEND_URL, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${WASENDER_TOKEN}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify(payload)
});

const result = await response.text();
console.log("📤 SEND STATUS:", response.status);
console.log("📤 SEND RESPONSE:", result);
