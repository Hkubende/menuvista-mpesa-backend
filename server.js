import express from "express";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config({ path:"C:\\Users\\LENOVO\\menuvista-mpesa-backend\\.env"});
console.log("ENV CHECK:", {
  MPESA_CONSUMER_KEY: !!process.env.MPESA_CONSUMER_KEY,
  MPESA_CONSUMER_SECRET: !!process.env.MPESA_CONSUMER_SECRET,
  MPESA_PASSKEY: !!process.env.MPESA_PASSKEY,
  MPESA_SHORTCODE: process.env.MPESA_SHORTCODE
});

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const {
  PORT = 8080,
  MPESA_ENV = "sandbox",
  MPESA_CONSUMER_KEY,
  MPESA_CONSUMER_SECRET,
  MPESA_PASSKEY,
  MPESA_SHORTCODE,
  MPESA_CALLBACK_URL
} = process.env;

const baseURL =
  MPESA_ENV === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function normalizePhone(input) {
  // Accept: 07xxxxxxxx, 7xxxxxxxx, 2547xxxxxxxx
  let s = String(input || "").trim().replace(/\s+/g, "");
  s = s.replace(/[^\d]/g, "");

  if (s.startsWith("0") && s.length === 10) return "254" + s.slice(1);
  if (s.startsWith("7") && s.length === 9) return "254" + s;
  if (s.startsWith("254") && s.length === 12) return s;

  return null;
}

async function getAccessToken() {
  if (!MPESA_CONSUMER_KEY || !MPESA_CONSUMER_SECRET) {
    throw new Error("Missing MPESA_CONSUMER_KEY/MPESA_CONSUMER_SECRET in .env");
  }
  const auth = Buffer.from(`${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`).toString("base64");
  const url = `${baseURL}/oauth/v1/generate?grant_type=client_credentials`;
  const res = await axios.get(url, {
    headers: { Authorization: `Basic ${auth}` }
  });
  return res.data.access_token;
}

function stkPassword(ts) {
  if (!MPESA_SHORTCODE || !MPESA_PASSKEY) {
    throw new Error("Missing MPESA_SHORTCODE/MPESA_PASSKEY in .env");
  }
  const raw = `${MPESA_SHORTCODE}${MPESA_PASSKEY}${ts}`;
  return Buffer.from(raw).toString("base64");
}

app.get("/health", (req, res) => res.json({ ok: true, env: MPESA_ENV }));

// Initiate STK push (Sandbox)
app.post("/api/mpesa/stkpush", async (req, res) => {
  try {
    const { phone, amount, accountReference = "MenuVista", transactionDesc = "MenuVista" } = req.body || {};

    const msisdn = normalizePhone(phone);
    const amt = Number(amount);

    if (!msisdn) return res.status(400).json({ ok: false, error: "Invalid phone. Use 07XXXXXXXX." });
    if (!amt || amt < 1) return res.status(400).json({ ok: false, error: "Invalid amount." });

    const ts = timestamp();
    const token = await getAccessToken();

    const payload = {
      BusinessShortCode: MPESA_SHORTCODE,
      Password: stkPassword(ts),
      Timestamp: ts,

      // For sandbox STK, use PayBill Online (174379)
      TransactionType: "CustomerPayBillOnline",

      Amount: Math.round(amt),
      PartyA: msisdn,
      PartyB: MPESA_SHORTCODE,
      PhoneNumber: msisdn,
      CallBackURL: MPESA_CALLBACK_URL,

      AccountReference: String(accountReference).slice(0, 12),
      TransactionDesc: String(transactionDesc).slice(0, 13)
    };

    const url = `${baseURL}/mpesa/stkpush/v1/processrequest`;
    const stkRes = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${token}` }
    });

    return res.json({ ok: true, ...stkRes.data });
  } catch (err) {
    const data = err?.response?.data;
    console.error("STK error:", data || err.message);
    return res.status(500).json({ ok: false, error: "STK push failed", details: data || err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT} (${MPESA_ENV})`);
});