"use strict";

function createSpeechHandlers({ env = process.env, fetch = globalThis.fetch } = {}) {
  let cachedVoices = null;
  let voicesExpire = 0;
  const headers = { "Cache-Control": "no-store" };
  const jsonError = (status, error) => ({ status, headers, jsonBody: { error } });

  function configured() {
    return Boolean(env.SPEECH_KEY && /^[a-z0-9]+$/.test(env.SPEECH_REGION || ""));
  }

  async function azureRequest(path, options) {
    return fetch(`https://${env.SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/${path}`, {
      ...options,
      headers: { ...options.headers, "Ocp-Apim-Subscription-Key": env.SPEECH_KEY },
      signal: AbortSignal.timeout(60000),
    });
  }

  function upstreamError(response, context) {
    context.error(`Azure Speech returned HTTP ${response.status}.`);
    if (response.status === 429) {
      return jsonError(429, "Azure Speech's quota or request limit was reached. Wait before retrying; check your F0 monthly allowance.");
    }
    if (response.status === 401 || response.status === 403) {
      return jsonError(502, "Azure rejected the Speech credentials. Check SPEECH_KEY and SPEECH_REGION in Function settings.");
    }
    return jsonError(502, `Azure Speech is unavailable (HTTP ${response.status}). Try again later.`);
  }

  function requestError(error, context) {
    context.error(`Azure Speech request failed (${error.name}).`);
    return jsonError(error.name === "TimeoutError" ? 504 : 502,
      "Could not complete the Azure Speech request. Check the Function configuration and try again.");
  }

  async function getVoices(context) {
    if (cachedVoices && Date.now() < voicesExpire) return { voices: cachedVoices };
    const response = await azureRequest("voices/list", { method: "GET" });
    if (!response.ok) return { error: upstreamError(response, context) };
    const result = await response.json();
    if (!Array.isArray(result)) throw new Error("Invalid Azure voice catalog");
    const voices = result.filter((item) =>
      item.VoiceType === "Neural" && typeof item.ShortName === "string" &&
      !/HD|:/.test(item.ShortName) && typeof item.Locale === "string" &&
      typeof item.DisplayName === "string"
    ).map((item) => ({
      voiceURI: item.ShortName,
      name: item.DisplayName,
      lang: item.Locale,
    }));
    if (!voices.length) throw new Error("Empty Azure voice catalog");
    cachedVoices = voices;
    voicesExpire = Date.now() + 60 * 60 * 1000;
    return { voices };
  }

  async function listVoices(request, context) {
    if (!configured()) return jsonError(503, "Configure SPEECH_KEY and SPEECH_REGION in the Azure Function settings.");
    try {
      const result = await getVoices(context);
      return result.error || { status: 200, headers, jsonBody: { voices: result.voices } };
    } catch (error) {
      return requestError(error, context);
    }
  }

  async function synthesize(request, context) {
    if (!configured()) return jsonError(503, "Configure SPEECH_KEY and SPEECH_REGION in the Azure Function settings.");
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return jsonError(415, "Send speech requests as application/json.");
    }
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 16000) return jsonError(413, "Speech request is too large.");
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      return jsonError(400, "Speech request must contain valid JSON.");
    }
    if (!input || typeof input.text !== "string" || !input.text.trim() ||
        input.text.length > 2000 || !input.text.isWellFormed() ||
        /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u.test(input.text) ||
        typeof input.voice !== "string") {
      return jsonError(400, "Provide valid text (1-2,000 characters) and an Azure voice.");
    }
    try {
      const result = await getVoices(context);
      if (result.error) return result.error;
      const selected = result.voices.find((item) => item.voiceURI === input.voice);
      if (!selected) return jsonError(400, "Choose an available Azure neural voice.");
      const escapeXml = (value) => value.replace(/[&<>"']/g, (char) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
      const response = await azureRequest("v1", {
        method: "POST",
        headers: {
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
          "User-Agent": "ReadAloud",
        },
        body: `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${escapeXml(selected.lang)}"><voice name="${escapeXml(selected.voiceURI)}">${escapeXml(input.text)}</voice></speak>`,
      });
      if (!response.ok) return upstreamError(response, context);
      const audio = Buffer.from(await response.arrayBuffer());
      if (!audio.length) throw new Error("Empty Azure audio response");
      return { status: 200, headers: { ...headers, "Content-Type": "audio/mpeg" }, body: audio };
    } catch (error) {
      return requestError(error, context);
    }
  }

  return { listVoices, synthesize };
}

module.exports = { createSpeechHandlers };
