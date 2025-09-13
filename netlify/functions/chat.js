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

    // Load your project knowledge
    const kbPath = path.join(process.cwd(), "data", "plan.md");
    const kb = fs.existsSync(kbPath) ? fs.readFileSync(kbPath, "utf8") : "";

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("Missing GEMINI_API_KEY env var");
      return { statusCode: 500, body: "Missing GEMINI_API_KEY" };
    }

    // Simple, robust prompt: single user message with system + plan + short history
    const system = `You are BizBuddy AI, a warm, professional assistant for small business owners.
Use the project plan to answer accurately. If the plan doesn't contain the answer,
say you don't know and suggest next steps. Keep replies concise and practical.`;

    // (Optional) include a tiny rolling history to give context
    const lastTurns = history.slice(-6) // last 6 turns max
      .map(h => `${h.role.toUpperCase()}: ${h.content}`)
      .join("\n");

    const userPrompt = [
      system,
      "",
      "--- PROJECT PLAN ---",
      kb,
      "--------------------",
      lastTurns ? `\nConversation so far:\n${lastTurns}` : "",
      `\nUSER: ${message}\nASSISTANT:`
    ].join("\n");

    // Call Gemini (header key + 2.0-flash model)
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
      // Log full error for debugging in Netlify → Functions → chat → Logs
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
