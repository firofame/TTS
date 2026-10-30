const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSpeechHandlers } = require("./speech");
const { app } = require("@azure/functions");

const catalog = [
  { ShortName: "en-US-JennyNeural", DisplayName: "Jenny", Locale: "en-US", VoiceType: "Neural" },
  { ShortName: "fr-FR-DeniseNeural", DisplayName: "Denise", Locale: "fr-FR", VoiceType: "Neural" },
  { ShortName: "en-US-Ava:DragonHDLatestNeural", DisplayName: "Ava HD", Locale: "en-US", VoiceType: "Neural" },
  { ShortName: "legacy", DisplayName: "Legacy", Locale: "en-US", VoiceType: "Standard" },
];
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});
const request = (body, contentType = "application/json") => new Request("https://function.example/api/speech", {
  method: "POST", headers: { "Content-Type": contentType }, body: typeof body === "string" ? body : JSON.stringify(body),
});
const validInput = { text: "Read this aloud.", voice: catalog[0].ShortName };

function setup({ env = { SPEECH_KEY: "test-speech-key", SPEECH_REGION: "eastus" },
  fetch = async () => json(catalog) } = {}) {
  const errors = [];
  return { ...createSpeechHandlers({ env, fetch }), context: { error: (value) => errors.push(value) }, errors };
}

test("both Azure routes allow public requests without exposing the Speech key", () => {
  const registrations = [];
  const original = app.http;
  app.http = (name, options) => registrations.push({ name, options });
  try {
    require("./index");
  } finally {
    app.http = original;
  }
  assert.deepEqual(registrations.map((item) => [item.name, item.options.authLevel, item.options.methods]),
    [["voices", "anonymous", ["GET"]], ["speech", "anonymous", ["POST"]]]);
});

test("missing or invalid resource settings return actionable errors without upstream requests", async () => {
  for (const env of [{}, { SPEECH_KEY: "key", SPEECH_REGION: "evil.example/path" }]) {
    const handlers = setup({ env, fetch: () => { throw new Error("Must not fetch"); } });
    assert.equal((await handlers.listVoices(null, handlers.context)).status, 503);
    assert.equal((await handlers.synthesize(request(validInput), handlers.context)).status, 503);
  }
});

test("voice catalog is regional, authenticated, cached, and contains only standard neural voices", async () => {
  const calls = [];
  const handlers = setup({ fetch: async (url, options) => {
    calls.push({ url, options });
    return json(catalog);
  } });
  const response = await handlers.listVoices(null, handlers.context);
  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody.voices, [
    { voiceURI: catalog[0].ShortName, name: "Jenny", lang: "en-US" },
    { voiceURI: catalog[1].ShortName, name: "Denise", lang: "fr-FR" },
  ]);
  assert.equal(response.headers["Cache-Control"], "no-store");
  await handlers.listVoices(null, handlers.context);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://eastus.tts.speech.microsoft.com/cognitiveservices/voices/list");
  assert.equal(calls[0].options.headers["Ocp-Apim-Subscription-Key"], "test-speech-key");
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test("speech escapes user text as SSML, validates the voice, and returns MP3 bytes", async () => {
  const calls = [];
  const bytes = Buffer.from([1, 2, 3]);
  const handlers = setup({ fetch: async (url, options) => {
    calls.push({ url, options });
    return url.endsWith("/voices/list") ? json(catalog) : new Response(bytes);
  } });
  const result = await handlers.synthesize(request({ ...validInput, text: `Hello & <audio src="evil"> 'world'` }), handlers.context);
  assert.equal(result.status, 200);
  assert.equal(result.headers["Content-Type"], "audio/mpeg");
  assert.equal(result.headers["Cache-Control"], "no-store");
  assert.deepEqual(result.body, bytes);
  assert.equal(calls[1].url, "https://eastus.tts.speech.microsoft.com/cognitiveservices/v1");
  assert.equal(calls[1].options.headers["X-Microsoft-OutputFormat"], "audio-24khz-48kbitrate-mono-mp3");
  assert.match(calls[1].options.body, /xml:lang="en-US"/);
  assert.match(calls[1].options.body, /Hello &amp; &lt;audio src=&quot;evil&quot;&gt; &apos;world&apos;/);
  assert.doesNotMatch(calls[1].options.body, /<audio/);
  assert.ok(!JSON.stringify(result).includes("test-speech-key"));
});

test("invalid inputs do not spend Speech quota", async () => {
  const handlers = setup({ fetch: () => { throw new Error("Must not fetch"); } });
  for (const input of [null, [], {}, { ...validInput, text: "" }, { ...validInput, text: "  " },
    { ...validInput, text: "a".repeat(2001) }, { ...validInput, text: "bad\u0000xml" },
    { ...validInput, text: "bad\uD800" }, { ...validInput, voice: 1 }, "invalid JSON"]) {
    assert.equal((await handlers.synthesize(request(input), handlers.context)).status, 400);
  }
  assert.equal((await handlers.synthesize(request(validInput, "text/plain"), handlers.context)).status, 415);
  assert.equal((await handlers.synthesize(request(validInput, "application/jsonp"), handlers.context)).status, 415);
  assert.equal((await handlers.synthesize(request("a".repeat(16001)), handlers.context)).status, 413);
});

test("unavailable and HD voice names cannot be synthesized", async () => {
  const handlers = setup();
  for (const voice of ['"><audio src="evil"/>', catalog[2].ShortName, "not-a-voice"]) {
    const result = await handlers.synthesize(request({ ...validInput, voice }), handlers.context);
    assert.equal(result.status, 400);
    assert.match(result.jsonBody.error, /available Azure neural voice/);
  }
});

test("2,000-character requests with valid Unicode remain supported", async () => {
  const handlers = setup({ fetch: async (url) => url.endsWith("/voices/list") ? json(catalog) : new Response("audio") });
  assert.equal((await handlers.synthesize(request({
    ...validInput, text: "\u{1F600}".repeat(1000),
  }), handlers.context)).status, 200);
});

test("upstream quota, authentication, and service errors are explicit without leaking response bodies", async () => {
  for (const upstream of [401, 403, 429, 500]) {
    for (const failCatalog of [true, false]) {
      const handlers = setup({ fetch: async (url) => url.endsWith("/voices/list") && !failCatalog
        ? json(catalog) : new Response("secret upstream details", { status: upstream }) });
      const result = failCatalog
        ? await handlers.listVoices(null, handlers.context)
        : await handlers.synthesize(request(validInput), handlers.context);
      assert.equal(result.status, upstream === 429 ? 429 : 502);
      assert.equal(handlers.errors.length, 1);
      assert.ok(!JSON.stringify(result).includes("secret upstream"));
      assert.ok(!JSON.stringify(handlers.errors).includes("test-speech-key"));
      if (upstream === 429) assert.match(result.jsonBody.error, /quota or request limit/);
    }
  }
});

test("network, timeout, malformed catalog, and empty audio failures are logged and surfaced", async () => {
  for (const failure of [
    () => { throw new TypeError("sensitive network details"); },
    () => { throw new DOMException("timeout", "TimeoutError"); },
    () => json({ unexpected: "catalog" }),
    () => json([]),
  ]) {
    const handlers = setup({ fetch: async () => failure() });
    const result = await handlers.listVoices(null, handlers.context);
    assert.ok(result.status === 502 || result.status === 504);
    assert.equal(handlers.errors.length, 1);
    assert.ok(!JSON.stringify(result).includes("sensitive network details"));
  }
  const handlers = setup({ fetch: async (url) => url.endsWith("/voices/list") ? json(catalog) : new Response("") });
  assert.equal((await handlers.synthesize(request(validInput), handlers.context)).status, 502);
  assert.equal(handlers.errors.length, 1);
});
