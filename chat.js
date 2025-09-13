// netlify/functions/chat.js
import fs from "fs";
import path from "path";

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { message = "", history = [] } = JSON.parse(event.body || "{}");
  const kbPath = path.join(process.cwd(), "data", "plan.md");
  const kb = fs.existsSync(kbPath) ? fs.readFileSync(kbPath, "utf8") : "";

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: "Missing GEMINI_API_KEY" };
  }

  // Build a concise, safe prompt
  const sys = `You are BizBuddy AI, a warm, professional assistant for small business owners.
Use the project plan to answer questions accurately. If the plan doesn't contain the answer,
say you don't know and suggest next steps. Keep answers concise and practical.`;

  // Convert our lightweight history into Gemini "contents"
  const past = history.flatMap(h => ([
    { role: h.role === "assistant" ? "model" : "user", parts: [{ text: h.content }] }
  ]));

  const contents = [
    { role: "user", parts: [{ text: sys }] },
    { role: "user", parts: [{ text: `--- PROJECT PLAN ---\n${kb}\n--------------------` }] },
    ...past,
    { role: "user", parts: [{ text: message }] }
  ];

  // Call Gemini (Generative Language API)
  const resp = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=" + apiKey, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 800
      }
    })
  });

  const data = await resp.json();
  const reply = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "Sorry, I couldn't generate a response.";

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reply })
  };
}
