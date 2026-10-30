const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { runInNewContext } = require("node:vm");
const source = readFileSync(`${__dirname}/app.js`, "utf8");
const html = readFileSync(`${__dirname}/index.html`, "utf8");
const elementIds = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]));
const azureVoice = { voiceURI: "en-US-JennyNeural", name: "Jenny", lang: "en-US" };
const avaVoice = { voiceURI: "en-US-AvaMultilingualNeural", name: "Ava Multilingual", lang: "en-US" };
const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json" },
});
const audioResponse = () => ({
  ok: true,
  blob: async () => new Blob(["mock audio"], { type: "audio/mpeg" }),
});
const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup({ availableVoices = [azureVoice], url = "https://firofame.github.io/TTS/",
  fetch = async (url) => url.endsWith("/voices")
  ? jsonResponse({ voices: availableVoices }) : audioResponse() } = {}) {
  const elements = new Map();
  function element() {
    return {
      value: "",
      textContent: "",
      dataset: {},
      events: {},
      attributes: {},
      classes: new Set(),
      classList: {
        toggle(name, enabled) {
          if (enabled) this.owner.classes.add(name);
          else this.owner.classes.delete(name);
        },
      },
      addEventListener(name, callback) { this.events[name] = callback; },
      setAttribute(name, value) { this.attributes[name] = value; },
      replaceChildren(...children) { this.children = children; },
      focus() { this.focused = true; },
      click() { this.clicked = true; },
      remove() { this.removed = true; },
      fire(name) { return this.events[name]?.(); },
    };
  }
  const document = {
    body: {
      children: [],
      append(child) { this.children.push(child); },
    },
    getElementById(id) {
      assert.ok(elementIds.has(id), `Missing HTML element: ${id}`);
      if (!elements.has(id)) {
        const item = element();
        item.classList.owner = item;
        if (id === "speed") item.value = "1";
        if (id === "language") item.value = "en-US";
        elements.set(id, item);
      }
      return elements.get(id);
    },
    createElement: element,
  };
  const window = {
    events: {},
    location: new URL(url),
    history: {
      state: { reader: true },
      replacements: [],
      replaceState(state, title, url) {
        this.state = state;
        this.replacements.push({ state, title, url });
        window.location = new URL(url);
      },
    },
    addEventListener(name, callback) { this.events[name] = callback; },
  };
  const audio = {
    src: "",
    plays: 0,
    pauses: 0,
    loads: 0,
    play() { this.plays += 1; return Promise.resolve(); },
    pause() { this.pauses += 1; },
    load() { this.loads += 1; },
    removeAttribute(name) { if (name === "src") this.src = ""; },
  };
  window.Audio = function () { return audio; };
  const urls = { created: [], revoked: [] };
  class TestURL extends URL {
    static createObjectURL(blob) {
      const value = `blob:test-${urls.created.length}`;
      urls.created.push({ value, blob });
      return value;
    }
    static revokeObjectURL(value) { urls.revoked.push(value); }
  }
  const requests = [];
  const context = {
    window, document, URL: TestURL, AbortController, AbortSignal, Blob,
    fetch(url, options) {
      requests.push({ url, options });
      return fetch(url, options);
    },
  };
  runInNewContext(source, context);
  const get = (id) => document.getElementById(id);
  const paste = (value) => {
    get("text").value = value;
    get("text").fire("input");
  };
  return { get, paste, window, context, audio, urls, requests, document };
}

test("download requires loaded voices and nonempty text", async () => {
  const app = setup();
  assert.equal(app.get("download").disabled, true);
  await app.get("download").fire("click");
  assert.equal(app.requests.length, 1);
  await tick();
  for (const value of ["", " \n "]) {
    app.paste(value);
    assert.equal(app.get("download").disabled, true);
    await app.get("download").fire("click");
    assert.equal(app.requests.length, 1);
    assert.equal(app.get("text").focused, true);
  }
  app.paste("Ready to download.");
  assert.equal(app.get("download").disabled, false);
  app.get("clear").fire("click");
  assert.equal(app.get("download").disabled, true);
});

test("download saves the complete text as one ordered MP3 at original speed without playback", async () => {
  const app = setup({ availableVoices: [azureVoice, avaVoice],
    fetch: async (url, options) => url.endsWith("/voices")
      ? jsonResponse({ voices: [azureVoice, avaVoice] })
      : { ok: true, blob: async () => new Blob(
        [JSON.parse(options.body).text], { type: "audio/mpeg" }) } });
  await tick();
  app.get("voice").value = azureVoice.voiceURI;
  app.get("voice").fire("change");
  app.get("speed").value = "2.5";
  app.get("speed").fire("input");
  const value = `${"a".repeat(1499)}\u{1F600}${"b".repeat(2001)}`;
  app.paste(value);
  await app.get("download").fire("click");
  const requests = app.requests.slice(1).map((request) => JSON.parse(request.options.body));
  assert.ok(requests.length > 1);
  assert.ok(requests.every((request) => request.text.length <= 1500 &&
    request.voice === azureVoice.voiceURI && !("speed" in request)));
  assert.equal(requests.map((request) => request.text).join(""), value);
  assert.equal(app.audio.plays, 0);
  assert.equal(app.urls.created.length, 1);
  assert.equal(app.urls.created[0].blob.type, "audio/mpeg");
  assert.equal(await app.urls.created[0].blob.text(), value);
  const link = app.document.body.children[0];
  assert.equal(link.href, app.urls.created[0].value);
  assert.match(link.download, /^TTS_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.mp3$/);
  assert.equal(link.clicked, true);
  assert.equal(link.removed, true);
  assert.match(app.get("status").textContent, /MP3 download started.*1x/);
  assert.equal(app.get("status").classes.has("error"), false);
  assert.equal(app.get("text").readOnly, false);
  assert.equal(app.get("stop").disabled, true);
  assert.equal(app.get("play").disabled, false);
  assert.equal(app.get("download").disabled, false);
  assert.equal(app.get("speed").value, "2.5");
  await app.get("download").fire("click");
  assert.deepEqual(app.urls.revoked, [app.urls.created[0].value]);
  app.window.events.pagehide();
  assert.deepEqual(app.urls.revoked, app.urls.created.map((item) => item.value));
});

test("download filenames use the current local date and time with zero-padded components", async () => {
  const app = setup();
  await tick();
  app.paste("Timestamped download.");
  let now;
  app.context.Date = class extends Date {
    constructor() { super(now.getTime()); }
  };
  for (const [date, expected] of [
    [new Date(2026, 0, 2, 3, 4, 5), "TTS_2026-01-02_03-04-05.mp3"],
    [new Date(2026, 11, 31, 23, 59, 59), "TTS_2026-12-31_23-59-59.mp3"],
    [new Date(2027, 0, 1, 0, 0, 0), "TTS_2027-01-01_00-00-00.mp3"],
  ]) {
    now = date;
    await app.get("download").fire("click");
    assert.equal(app.document.body.children.at(-1).download, expected);
    assert.equal(app.document.body.children.at(-1).clicked, true);
  }
});

test("download preparation locks editing and playback, reports progress, and Stop cancels stale work", async () => {
  const pending = [];
  const app = setup({ fetch: async (url, options) => url.endsWith("/voices")
    ? jsonResponse({ voices: [azureVoice] })
    : new Promise((resolve) => pending.push({ resolve, signal: options.signal })) });
  await tick();
  app.paste("a".repeat(3001));
  const canceled = app.get("download").fire("click");
  assert.match(app.get("status").textContent, /Preparing MP3 \(1 of 3\)/);
  assert.equal(app.get("text").readOnly, true);
  for (const id of ["language", "voice", "speed", "play", "download", "clear"]) {
    assert.equal(app.get(id).disabled, true, id);
  }
  assert.equal(app.get("stop").disabled, false);
  app.get("play").fire("click");
  await app.get("download").fire("click");
  assert.equal(pending.length, 1);
  pending[0].resolve(audioResponse());
  await tick();
  assert.match(app.get("status").textContent, /Preparing MP3 \(2 of 3\)/);
  app.get("stop").fire("click");
  assert.equal(pending[1].signal.aborted, true);
  assert.equal(app.get("status").textContent, "Download canceled.");
  assert.equal(app.get("text").readOnly, false);
  app.paste("New playback.");
  app.get("play").fire("click");
  pending[1].resolve(audioResponse());
  await canceled;
  assert.equal(app.urls.created.length, 0);
  assert.equal(app.document.body.children.length, 0);
  pending[2].resolve(audioResponse());
  await tick();
  assert.equal(app.audio.plays, 1);
  assert.equal(app.get("status").classes.has("error"), false);
});

test("download failures never save a partial file and restore controls", async () => {
  for (const failure of [
    () => jsonResponse({ error: "Monthly quota reached." }, 429),
    () => new Response("", { status: 503 }),
    () => { throw new TypeError("Failed to fetch"); },
    () => ({ ok: true, blob: async () => new Blob([], { type: "audio/mpeg" }) }),
    () => ({ ok: true, blob: async () => new Blob(["invalid"], { type: "text/html" }) }),
    () => ({ ok: true, blob: async () => new Blob(["wrong format"], { type: "audio/wav" }) }),
  ]) {
    let speechCalls = 0;
    const app = setup({ fetch: async (url) => {
      if (url.endsWith("/voices")) return jsonResponse({ voices: [azureVoice] });
      return ++speechCalls === 1 ? audioResponse() : failure();
    } });
    await tick();
    app.paste("a".repeat(3001));
    await app.get("download").fire("click");
    assert.equal(speechCalls, 2);
    assert.match(app.get("status").textContent, /Audio download failed:/);
    assert.equal(app.get("status").classes.has("error"), true);
    assert.equal(app.urls.created.length, 0);
    assert.equal(app.document.body.children.length, 0);
    assert.equal(app.get("text").readOnly, false);
    for (const id of ["language", "voice", "speed", "play", "download", "clear"]) {
      assert.equal(app.get(id).disabled, false, id);
    }
    assert.equal(app.get("stop").disabled, true);
  }
});

test("leaving the page cancels pending downloads without saving a late response", async () => {
  let resolveSpeech;
  let signal;
  const app = setup({ fetch: async (url, options) => {
    if (url.endsWith("/voices")) return jsonResponse({ voices: [azureVoice] });
    signal = options.signal;
    return new Promise((resolve) => { resolveSpeech = resolve; });
  } });
  await tick();
  app.paste("Download before leaving.");
  const downloading = app.get("download").fire("click");
  app.window.events.pagehide();
  assert.equal(signal.aborted, true);
  resolveSpeech(audioResponse());
  await downloading;
  assert.equal(app.urls.created.length, 0);
  assert.equal(app.get("status").classes.has("error"), false);
});

test("Azure loads automatically without a source selector, browser speech, or client credentials", async () => {
  assert.doesNotMatch(html, /id="provider"|provider-setting|Voice source|Browser voices|System default/);
  assert.match(html, /Microsoft Azure voices/);
  assert.doesNotMatch(html, /azure-settings|azure-endpoint|azure-access-key|azure-connect|type="password"/);
  assert.doesNotMatch(source, /speechSynthesis|SpeechSynthesisUtterance|x-functions-key|azureConfig|localStorage|keychain/i);
  const app = setup();
  assert.equal(app.get("play").disabled, true);
  assert.equal(app.get("download").disabled, true);
  assert.equal(app.get("language").disabled, true);
  assert.equal(app.get("voice").disabled, true);
  assert.equal(app.get("speed").disabled, true);
  assert.equal(app.get("status").textContent, "Loading Microsoft neural voices...");
  app.paste("No setup needed.");
  assert.equal(app.get("play").disabled, true);
  await tick();
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].url, "https://read-aloud-0b33fdb4.azurewebsites.net/api/voices");
  assert.equal(app.requests[0].options.headers, undefined);
  assert.equal(app.requests[0].options.credentials, "omit");
  assert.equal(app.requests[0].options.redirect, "error");
  assert.equal(app.get("language").value, "en-US");
  assert.equal(app.get("voice").value, azureVoice.voiceURI);
  assert.equal(app.get("play").disabled, false);
  assert.equal(app.get("status").textContent, "Azure is ready when you are.");
  assert.deepEqual(Array.from(app.get("voice").children, (item) => item.value), [azureVoice.voiceURI]);
});

test("playback precedes language, voice, and speed settings in document order", () => {
  for (const id of ["language", "voice", "speed"]) {
    assert.ok(html.indexOf('id="play"') < html.indexOf(`id="${id}"`));
  }
});

test("American English and Ava Multilingual are selected by default and used for playback", async () => {
  assert.match(html, /<select id="language">\s*<option value="en-US">American English \(en-US\)<\/option>/);
  const app = setup({ availableVoices: [
    { voiceURI: "fr-FR-DeniseNeural", name: "Denise", lang: "fr-FR" },
    { ...azureVoice, default: true },
    avaVoice,
  ] });
  await tick();
  assert.equal(app.get("language").value, "en-US");
  assert.equal(app.get("voice").value, avaVoice.voiceURI);
  assert.deepEqual(Array.from(app.get("voice").children, (item) => item.value),
    [azureVoice.voiceURI, avaVoice.voiceURI]);
  app.paste("Use the default voice.");
  app.get("play").fire("click");
  await tick();
  assert.equal(JSON.parse(app.requests[1].options.body).voice, avaVoice.voiceURI);
  app.get("stop").fire("click");
  app.get("voice").value = azureVoice.voiceURI;
  app.get("language").value = "";
  app.get("language").fire("change");
  assert.equal(app.get("voice").value, azureVoice.voiceURI);
  assert.equal(app.get("voice").children.length, 3);
});

test("an unavailable default language falls back to all available languages", async () => {
  const french = { voiceURI: "fr-FR-DeniseNeural", name: "Denise", lang: "fr-FR" };
  const { get } = setup({ availableVoices: [french] });
  await tick();
  assert.equal(get("language").value, "");
  assert.equal(get("voice").value, french.voiceURI);
  assert.equal(get("voice").disabled, false);
});

test("a voice URL selects the exact voice and its language after the catalog loads", async () => {
  const french = { voiceURI: "fr-FR-DeniseNeural", name: "Denise", lang: "fr-FR" };
  for (const selectedVoice of [azureVoice, french]) {
    const url = `https://firofame.github.io/TTS/?voice=${encodeURIComponent(selectedVoice.voiceURI)}`;
    let resolveVoices;
    const app = setup({ url, fetch: async (url) => url.endsWith("/voices")
      ? new Promise((resolve) => { resolveVoices = resolve; }) : audioResponse() });
    assert.equal(app.get("voice").disabled, true);
    resolveVoices(jsonResponse({ voices: [avaVoice, azureVoice, french] }));
    await tick();
    assert.equal(app.get("language").value, selectedVoice.lang);
    assert.equal(app.get("voice").value, selectedVoice.voiceURI);
    assert.ok(app.get("voice").children.some((item) => item.value === selectedVoice.voiceURI));
    assert.equal(app.get("status").classes.has("error"), false);
    assert.equal(app.window.location.href, url);
    assert.equal(app.window.history.replacements.length, 0);
    app.paste("Use the linked voice.");
    app.get("play").fire("click");
    await tick();
    assert.equal(JSON.parse(app.requests[1].options.body).voice, selectedVoice.voiceURI);
  }
});

test("missing voice parameters preserve defaults and do not rewrite the URL", async () => {
  const url = "https://firofame.github.io/TTS/?other=value#reader";
  const app = setup({ url, availableVoices: [azureVoice, avaVoice] });
  await tick();
  assert.equal(app.get("voice").value, avaVoice.voiceURI);
  assert.equal(app.window.location.href, url);
  assert.equal(app.window.history.replacements.length, 0);
});

test("invalid and empty voice parameters warn and use the default voice for playback", async () => {
  for (const query of ["voice=unknown", "voice=", "voice=%3Cscript%3E", "voice=%E0%A4%A"]) {
    const app = setup({
      url: `https://firofame.github.io/TTS/?${query}`,
      availableVoices: [azureVoice, avaVoice],
    });
    await tick();
    assert.equal(app.get("voice").value, avaVoice.voiceURI);
    assert.equal(app.get("language").value, "en-US");
    assert.equal(app.get("status").classes.has("error"), true);
    assert.match(app.get("status").textContent, /voice in this link is unavailable/);
    assert.equal(app.window.history.replacements.length, 0);
    app.paste("Use a known voice.");
    app.get("play").fire("click");
    await tick();
    assert.equal(JSON.parse(app.requests[1].options.body).voice, avaVoice.voiceURI);
  }
});

test("voice and language changes keep a shareable URL without losing other parameters, hash, or history state", async () => {
  const french = { voiceURI: "fr-FR-DeniseNeural", name: "Denise", lang: "fr-FR" };
  const availableVoices = [azureVoice, avaVoice, french];
  const app = setup({
    url: "https://firofame.github.io/TTS/?other=hello%20world&other=again&voice=unknown#reader",
    availableVoices,
  });
  await tick();
  const historyState = app.window.history.state;
  app.get("voice").value = azureVoice.voiceURI;
  app.get("voice").fire("change");
  assert.equal(app.window.location.searchParams.get("voice"), azureVoice.voiceURI);
  assert.deepEqual(app.window.location.searchParams.getAll("other"), ["hello world", "again"]);
  assert.equal(app.window.location.hash, "#reader");
  assert.equal(app.window.history.state, historyState);
  assert.equal(app.window.history.replacements.length, 1);
  assert.equal(app.get("status").classes.has("error"), false);
  app.get("voice").fire("change");
  assert.equal(app.window.history.replacements.length, 1);
  app.get("language").value = "fr-FR";
  app.get("language").fire("change");
  assert.equal(app.window.location.searchParams.get("voice"), french.voiceURI);
  assert.equal(app.window.history.replacements.length, 2);
  app.get("language").value = "";
  app.get("language").fire("change");
  assert.equal(app.window.history.replacements.length, 2);
  const shared = setup({ url: app.window.location.href, availableVoices });
  await tick();
  assert.equal(shared.get("voice").value, french.voiceURI);
  assert.equal(shared.get("language").value, "fr-FR");
  assert.equal(app.requests.length, 1);
});

test("URL update failures are visible without disabling playback", async () => {
  const app = setup({ availableVoices: [azureVoice, avaVoice] });
  await tick();
  app.window.history.replaceState = () => { throw new Error("History is unavailable."); };
  app.get("voice").value = azureVoice.voiceURI;
  app.get("voice").fire("change");
  assert.match(app.get("status").textContent, /Could not update the voice link: History is unavailable/);
  assert.equal(app.get("status").classes.has("error"), true);
  app.paste("Playback still works.");
  assert.equal(app.get("play").disabled, false);
  app.get("play").fire("click");
  await tick();
  assert.equal(JSON.parse(app.requests[1].options.body).voice, azureVoice.voiceURI);
});

test("empty input is disabled; whitespace cannot start playback", async () => {
  const { get, paste, requests } = setup();
  await tick();
  assert.equal(get("play").disabled, true);
  paste("   \n ");
  get("play").fire("click");
  assert.equal(get("play").disabled, true);
  assert.equal(requests.length, 1);
  assert.equal(get("text").focused, true);
});

test("Azure playback preserves speed, pauses, resumes, and releases URLs", async () => {
  const app = setup();
  await tick();
  app.get("speed").value = "2.5";
  app.get("speed").fire("input");
  assert.equal(app.get("speed-value").textContent, "2.5x");
  assert.equal(app.get("speed").attributes["aria-valuetext"], "2.5 times normal speed");
  app.paste("Hello & <world>.");
  assert.equal(app.get("character-count").textContent, "16 characters");
  app.get("play").fire("click");
  await tick();
  assert.deepEqual(JSON.parse(app.requests[1].options.body), {
    text: "Hello & <world>.", voice: azureVoice.voiceURI,
  });
  assert.equal(app.audio.plays, 1);
  assert.equal(app.audio.playbackRate, 2.5);
  assert.equal(app.audio.preservesPitch, true);
  assert.equal(app.get("text").readOnly, true);
  assert.equal(app.get("language").disabled, true);
  assert.equal(app.get("voice").disabled, true);
  assert.equal(app.get("speed").disabled, true);
  assert.equal(app.get("clear").disabled, true);
  assert.equal(app.get("download").disabled, true);
  assert.equal(app.get("editing-hint").hidden, false);
  const pauses = app.audio.pauses;
  app.get("play").fire("click");
  assert.equal(app.audio.pauses, pauses + 1);
  assert.equal(app.get("play-label").textContent, "Resume");
  assert.equal(app.get("language").disabled, true);
  app.get("play").fire("click");
  assert.equal(app.audio.plays, 2);
  assert.equal(app.requests.length, 2);
  app.audio.onended();
  assert.equal(app.get("status").textContent, "Finished. Listen again anytime.");
  assert.equal(app.get("play-label").textContent, "Play");
  assert.equal(app.get("text").readOnly, false);
  assert.equal(app.get("language").disabled, false);
  assert.equal(app.get("voice").disabled, false);
  assert.equal(app.get("speed").disabled, false);
  assert.equal(app.get("stop").disabled, true);
  assert.equal(app.get("editing-hint").hidden, true);
  assert.equal(app.urls.revoked.length, 1);
  assert.equal(app.audio.src, "");
});

test("language options are unique, named, sorted, and keep regional variants separate", async () => {
  const { get } = setup({ availableVoices: [
    { voiceURI: "french", name: "French", lang: "fr-FR" },
    { voiceURI: "british", name: "British", lang: "en-GB" },
    azureVoice,
    { voiceURI: "other-british", name: "Other British", lang: "en-GB" },
  ] });
  await tick();
  const options = get("language").children;
  assert.deepEqual(Array.from(options, (item) => item.value).sort(), ["", "en-GB", "en-US", "fr-FR"]);
  assert.equal(options[0].textContent, "All languages");
  assert.match(options.find((item) => item.value === "en-GB").textContent, /English.*en-GB/);
  const labels = Array.from(options.slice(1), (item) => item.textContent);
  assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b, "en")));
  assert.equal(get("language").value, "en-US");
  assert.equal(get("voice").children.length, 1);
  assert.equal(get("voice").value, azureVoice.voiceURI);
  get("language").value = "";
  get("language").fire("change");
  assert.equal(get("voice").children.length, 4);
});

test("language filtering selects a matching voice and sends it to Azure", async () => {
  const french = { voiceURI: "fr-FR-DeniseNeural", name: "Denise", lang: "fr-FR" };
  const { get, paste, requests } = setup({ availableVoices: [azureVoice, french] });
  await tick();
  get("language").value = "fr-FR";
  get("language").fire("change");
  assert.deepEqual(Array.from(get("voice").children, (item) => item.value), [french.voiceURI]);
  assert.equal(get("voice").value, french.voiceURI);
  paste("Bonjour.");
  get("play").fire("click");
  await tick();
  assert.equal(JSON.parse(requests[1].options.body).voice, french.voiceURI);
  get("stop").fire("click");
  assert.equal(get("language").disabled, false);
  get("language").value = "";
  get("language").fire("change");
  assert.equal(get("voice").value, french.voiceURI);
  assert.equal(get("voice").children.length, 2);
});

test("filtering prefers a matching default and preserves a matching user selection", async () => {
  const { get } = setup({ availableVoices: [
    { voiceURI: "first", name: "First", lang: "en-US" },
    { voiceURI: "default", name: "Default", lang: "en-US", default: true },
    { voiceURI: "british", name: "British", lang: "en-GB" },
  ] });
  await tick();
  assert.equal(get("voice").value, "default");
  get("language").value = "en-US";
  get("language").fire("change");
  get("voice").value = "first";
  get("language").value = "";
  get("language").fire("change");
  assert.equal(get("voice").value, "first");
  get("language").value = "en-GB";
  get("language").fire("change");
  assert.equal(get("voice").value, "british");
});

test("long documents use bounded Azure chunks without losing text or emoji", async () => {
  const app = setup();
  await tick();
  const value = `${"a".repeat(1499)}\u{1F600}${"b".repeat(2001)}`;
  app.paste(value);
  app.get("play").fire("click");
  while (app.get("play-label").textContent !== "Play") {
    await tick();
    assert.ok(app.audio.onended);
    app.audio.onended();
  }
  const spoken = app.requests.slice(1).map((request) => JSON.parse(request.options.body).text);
  assert.ok(spoken.length > 1);
  assert.ok(spoken.every((chunk) => chunk.length <= 1500));
  assert.equal(spoken.join(""), value);
  assert.ok(spoken.every((chunk) => !/[\uD800-\uDBFF]$/.test(chunk) && !/^[\uDC00-\uDFFF]/.test(chunk)));
});

test("chunking keeps sentence boundaries, whitespace, and unbroken text", async () => {
  const { context } = setup();
  await tick();
  const value = "This is a sentence to read aloud. ".repeat(100);
  context.input = value;
  const chunks = runInNewContext("splitText(input)", context);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 1500));
  assert.equal(chunks.join(" ").replace(/\s+/g, " ").trim(), value.trim());
  const unbroken = runInNewContext('splitText("a".repeat(4501))', context);
  assert.equal(unbroken.length, 4);
  assert.equal(unbroken.join(""), "a".repeat(4501));
  const invalidUnicode = runInNewContext('splitText("\\uD800 " + "a".repeat(1520))', context);
  assert.equal(invalidUnicode[0], "\uD800");
  assert.equal(invalidUnicode.slice(1).join(""), "a".repeat(1520));
});

test("a chunk ending during pause waits for resume", async () => {
  const app = setup();
  await tick();
  app.paste("An ordinary sentence. ".repeat(100));
  app.get("play").fire("click");
  await tick();
  app.get("play").fire("click");
  app.audio.onended();
  assert.equal(app.requests.length, 2);
  app.get("play").fire("click");
  await tick();
  assert.equal(app.requests.length, 3);
  assert.equal(app.audio.plays, 2);
});

test("pausing while Azure is preparing audio waits for resume without re-synthesis", async () => {
  let resolveSpeech;
  const app = setup({ fetch: async (url) => {
    if (url.endsWith("/voices")) return jsonResponse({ voices: [azureVoice] });
    return new Promise((resolve) => { resolveSpeech = resolve; });
  } });
  await tick();
  app.paste("Wait for this.");
  app.get("play").fire("click");
  app.get("play").fire("click");
  resolveSpeech(audioResponse());
  await tick();
  assert.equal(app.audio.plays, 0);
  app.get("play").fire("click");
  assert.equal(app.audio.plays, 1);
  assert.equal(app.requests.length, 2);
});

test("Stop aborts Azure synthesis and ignores stale responses after a new playback", async () => {
  const pending = [];
  const app = setup({ fetch: async (url, options) => {
    if (url.endsWith("/voices")) return jsonResponse({ voices: [azureVoice] });
    return new Promise((resolve) => pending.push({ resolve, signal: options.signal }));
  } });
  await tick();
  app.paste("First.");
  app.get("play").fire("click");
  app.get("stop").fire("click");
  assert.equal(pending[0].signal.aborted, true);
  app.paste("Second.");
  app.get("play").fire("click");
  pending[0].resolve(audioResponse());
  await tick();
  assert.equal(app.audio.plays, 0);
  pending[1].resolve(audioResponse());
  await tick();
  assert.equal(app.audio.plays, 1);
  assert.equal(app.get("status").classes.has("error"), false);
});

test("Stop releases audio and ignores late completion and errors", async () => {
  const app = setup();
  await tick();
  app.paste("Some text. ".repeat(200));
  app.get("play").fire("click");
  await tick();
  const onended = app.audio.onended;
  const onerror = app.audio.onerror;
  app.get("stop").fire("click");
  assert.equal(app.audio.src, "");
  assert.equal(app.urls.revoked.length, 1);
  assert.equal(app.get("text").readOnly, false);
  app.get("play").fire("click");
  await tick();
  onended();
  onerror();
  assert.equal(app.requests.length, 3);
  assert.equal(app.get("play-label").textContent, "Pause");
  assert.equal(app.get("status").classes.has("error"), false);
});

test("clear resets text, count, focus, and play availability", async () => {
  const { get, paste } = setup();
  await tick();
  paste("a");
  assert.equal(get("character-count").textContent, "1 character");
  get("clear").fire("click");
  assert.equal(get("text").value, "");
  assert.equal(get("character-count").textContent, "0 characters");
  assert.equal(get("text").focused, true);
  assert.equal(get("play").disabled, true);
});

test("Azure request errors are visible and recover editing controls", async () => {
  for (const response of [
    () => jsonResponse({ error: "Monthly quota reached." }, 429),
    () => new Response("", { status: 503 }),
  ]) {
    const app = setup({ fetch: async (url) => url.endsWith("/voices")
      ? jsonResponse({ voices: [azureVoice] }) : response() });
    await tick();
    app.paste("Quota test.");
    app.get("play").fire("click");
    await tick();
    assert.match(app.get("status").textContent, /Monthly quota reached|HTTP 503/);
    assert.doesNotMatch(app.get("status").textContent, /Browser voices|switch/i);
    assert.equal(app.get("status").classes.has("error"), true);
    assert.equal(app.get("text").readOnly, false);
    assert.equal(app.get("play-label").textContent, "Play");
    assert.equal(app.get("language").disabled, false);
  }
});

test("connection failures and invalid catalogs show reload guidance and never enable playback", async () => {
  for (const result of [
    () => new Response("", { status: 401 }),
    () => jsonResponse({ voices: [] }),
    () => jsonResponse({ voices: [{ ...azureVoice, lang: "bad_locale" }] }),
    () => jsonResponse({ voices: [{ ...azureVoice, voiceURI: 123 }] }),
    () => { throw new TypeError("Failed to fetch"); },
  ]) {
    const app = setup({ fetch: async () => result() });
    await tick();
    app.paste("Hello.");
    app.get("play").fire("click");
    assert.equal(app.requests.length, 1);
    assert.equal(app.get("play").disabled, true);
    assert.equal(app.get("download").disabled, true);
    assert.equal(app.get("language").disabled, true);
    assert.equal(app.get("voice").disabled, true);
    assert.equal(app.get("speed").disabled, true);
    assert.equal(app.get("status").classes.has("error"), true);
    assert.match(app.get("status").textContent, /Could not load Azure voices:.*Reload the page to retry/);
    assert.doesNotMatch(app.get("status").textContent, /Browser voices|switch/i);
    app.get("clear").fire("click");
    assert.equal(app.get("status").classes.has("error"), true);
    assert.match(app.get("status").textContent, /Reload the page to retry/);
  }
});

test("leaving the page aborts and ignores a late voice catalog", async () => {
  let resolveVoices;
  let signal;
  const app = setup({ fetch: async (url, options) => {
    signal = options.signal;
    return new Promise((resolve) => { resolveVoices = resolve; });
  } });
  app.window.events.pagehide();
  assert.equal(signal.aborted, true);
  resolveVoices(jsonResponse({ voices: [azureVoice] }));
  await tick();
  app.paste("Not connected.");
  assert.equal(app.get("play").disabled, true);
  assert.equal(app.get("status").classes.has("error"), false);
});

test("Azure rejects invalid audio and handles autoplay failures and page exit", async () => {
  for (const blob of [new Blob([], { type: "audio/mpeg" }), new Blob(["not audio"], { type: "text/html" })]) {
    const invalid = setup({ fetch: async (url) => url.endsWith("/voices")
      ? jsonResponse({ voices: [azureVoice] }) : { ok: true, blob: async () => blob } });
    await tick();
    invalid.paste("Bad audio.");
    invalid.get("play").fire("click");
    await tick();
    assert.match(invalid.get("status").textContent, /did not return valid audio/);
    assert.equal(invalid.get("text").readOnly, false);
  }
  const app = setup();
  await tick();
  app.paste("Audio test.");
  app.audio.play = () => Promise.reject(new Error("NotAllowedError"));
  app.get("play").fire("click");
  await tick();
  assert.match(app.get("status").textContent, /Audio playback failed/);
  assert.equal(app.urls.revoked.length, 1);
  assert.equal(app.get("text").readOnly, false);
  app.audio.play = () => Promise.resolve();
  app.get("play").fire("click");
  await tick();
  app.audio.onerror();
  assert.match(app.get("status").textContent, /could not be decoded/);
  app.get("play").fire("click");
  await tick();
  app.window.events.pagehide();
  assert.equal(app.audio.src, "");
  assert.equal(app.urls.revoked.length, 3);
});
