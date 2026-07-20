#!/usr/bin/env node
/**
 * Manual live smoke check for the AI adapter (WR-044). NEVER runs in CI (CLAUDE.md rule 3).
 *
 *   VITE_LIVE_APIS=true AI_PROVIDER=anthropic AI_KEY=sk-... npm run probe:ai
 *
 * Confirms the chosen provider is reachable AND browser-callable (the DEC-043 finding) and returns
 * parseable JSON. Makes exactly one small call. Prints the parsed object; never writes fixtures
 * (AI output isn't deterministic, so fixtures are hand-authored, not captured).
 */
if (process.env.VITE_LIVE_APIS !== 'true') {
  console.error('Refusing to hit a live API: set VITE_LIVE_APIS=true to run the probe.');
  process.exit(1);
}
const provider = process.env.AI_PROVIDER;
const key = process.env.AI_KEY;
if (!['anthropic', 'openrouter', 'gemini'].includes(provider) || !key) {
  console.error('Set AI_PROVIDER=anthropic|openrouter|gemini and AI_KEY=<your key>.');
  process.exit(1);
}

const system = 'You are a test. Return ONLY valid JSON. No prose, no markdown fences.';
const prompt = 'Return {"ok": true, "n": 42} exactly.';
const maxTokens = 100;

const REQ = {
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    },
    pick: (j) => j?.content?.[0]?.text,
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: {
      model: 'openai/gpt-4o-mini',
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    },
    pick: (j) => j?.choices?.[0]?.message?.content,
  },
  gemini: {
    url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: maxTokens },
    },
    pick: (j) => j?.candidates?.[0]?.content?.parts?.[0]?.text,
  },
}[provider];

const res = await fetch(REQ.url, {
  method: 'POST',
  headers: REQ.headers,
  body: JSON.stringify(REQ.body),
});
if (!res.ok) {
  console.error(`Probe (${provider}) failed: HTTP ${res.status} ${await res.text()}`);
  process.exit(1);
}
const text = REQ.pick(await res.json());
console.log(`${provider} replied:`, text);
try {
  console.log(
    'parsed OK:',
    JSON.parse(
      String(text)
        .replace(/^```(?:json)?/i, '')
        .replace(/```$/, '')
        .trim(),
    ),
  );
} catch {
  console.error('Reply was not parseable JSON.');
  process.exit(1);
}
