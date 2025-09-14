// netlify/functions/chat.js
import fs from "fs";
import path from "path";

export async function handler(event) {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { message = "", history = [] } = JSON.parse(event.body || "{}");

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("Missing GEMINI_API_KEY");
      return { statusCode: 500, body: "Missing GEMINI_API_KEY" };
    }

    // --- Load ALL markdown files from /data ---
    const dataDir = path.join(process.cwd(), "data");
    let kbSections = [];
    if (fs.existsSync(dataDir)) {
      const files = fs.readdirSync(dataDir).filter(f => f.endsWith(".md"));
      for (const file of files) {
        const p = path.join(dataDir, file);
        const content = fs.readFileSync(p, "utf8");
        kbSections.push(`# FILE: ${file}\n${content.trim()}`);
      }
    }
    const kbAll = kbSections.join("\n\n---\n\n") || "";

    // Trim if too long (keep first ~25k chars)
    const KB_MAX = 25000;
    const kb = kbAll.length > KB_MAX ? kbAll.slice(0, KB_MAX) + "\n\n[...truncated...]" : kbAll;

    // Build prompt
    const system = `You are BizBuddy AI, a warm, professional assistant for small business owners.
Use the knowledge below to answer accurately. If something isn't covered, say you don't know and suggest next steps.
Be concise, practical, and friendly. Prefer the Roadmap and FAQ when answering about plans.`;

    // Compact history
    const lastTurns = history.slice(-6).map(h => `${h.role.toUpperCase()}: ${h.content}`).join("\n");

    const userPrompt = [
      system,
      "",
      "===== KNOWLEDGE START =====",
      kb,
      "===== KNOWLEDGE END =====",
      lastTurns ? `\nConversation so far:\n${lastTurns}` : "",
      `\nUSER: ${message}\nASSISTANT:`
    ].join("\n");

    // Call Gemini
    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: userPrompt }]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 800
        }
      })
    });

    const data = await resp.json();
    if (!resp.ok) {
      console.error("Gemini error:", resp.status, JSON.stringify(data));
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ reply: "Upstream error from Gemini.", detail: data })
      };
    }

    const reply =
      data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("")?.trim() ||
      "Sorry, I couldn’t generate a response.";

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ reply })
    };
  } catch (err) {
    console.error("Server error:", err);
    return { statusCode: 500, body: "Server error: " + err.message };
  }
}
