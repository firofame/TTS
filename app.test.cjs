const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { runInNewContext } = require("node:vm");
const source = readFileSync(`${__dirname}/app.js`, "utf8");

function setup({ supported = true, availableVoices = [] } = {}) {
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
      fire(name) { this.events[name]?.(); },
    };
  }
  const document = {
    getElementById(id) {
      if (!elements.has(id)) {
        const item = element();
        item.classList.owner = item;
        if (id === "speed") item.value = "1";
        elements.set(id, item);
      }
      return elements.get(id);
    },
    createElement: element,
  };
  const synth = {
    utterances: [],
    events: {},
    cancels: 0,
    pauses: 0,
    resumes: 0,
    getVoices: () => availableVoices,
    addEventListener(name, callback) { this.events[name] = callback; },
    speak(utterance) { this.utterances.push(utterance); },
    cancel() { this.cancels += 1; },
    pause() { this.pauses += 1; },
    resume() { this.resumes += 1; },
  };
  const window = {
    events: {},
    addEventListener(name, callback) { this.events[name] = callback; },
  };
  if (supported) {
    window.speechSynthesis = synth;
    window.SpeechSynthesisUtterance = class {
      constructor(text) { this.text = text; }
    };
  }
  const context = { window, document };
  runInNewContext(source, context);
  const get = (id) => document.getElementById(id);
  const paste = (value) => {
    get("text").value = value;
    get("text").fire("input");
  };
  return { get, paste, synth, window, context, availableVoices };
}

test("empty input is disabled; whitespace cannot start playback", () => {
  const { get, paste, synth } = setup();
  assert.equal(get("play").disabled, true);
  paste("   \n ");
  get("play").fire("click");
  assert.equal(get("play").disabled, true);
  assert.equal(synth.utterances.length, 0);
});

test("play, pause, resume, completion, and editing controls", () => {
  const { get, paste, synth } = setup();
  paste("Hello world.");
  assert.equal(get("character-count").textContent, "12 characters");
  get("play").fire("click");
  assert.equal(synth.utterances[0].text, "Hello world.");
  assert.equal(get("play-label").textContent, "Pause");
  assert.equal(get("text").readOnly, true);
  assert.equal(get("language").disabled, true);
  assert.equal(get("voice").disabled, true);
  assert.equal(get("speed").disabled, true);
  get("play").fire("click");
  assert.equal(synth.pauses, 1);
  assert.equal(get("play-label").textContent, "Resume");
  assert.equal(get("language").disabled, true);
  get("play").fire("click");
  assert.equal(synth.resumes, 2);
  assert.equal(synth.utterances.length, 1);
  synth.utterances[0].onend();
  assert.equal(get("play-label").textContent, "Play");
  assert.equal(get("text").readOnly, false);
  assert.equal(get("language").disabled, false);
  assert.equal(get("stop").disabled, true);
  assert.equal(get("status").textContent, "Finished. Listen again anytime.");
});

test("selected voice, language, and fast playback rate reach the speech engine", () => {
  const selected = { voiceURI: "test-voice", name: "Test", lang: "en-GB", default: true };
  const { get, paste, synth } = setup({ availableVoices: [selected] });
  get("voice").value = selected.voiceURI;
  get("speed").value = "2.5";
  get("speed").fire("input");
  assert.equal(get("speed-value").textContent, "2.5x");
  assert.equal(get("speed").attributes["aria-valuetext"], "2.5 times normal speed");
  paste("Read this fast.");
  get("play").fire("click");
  assert.equal(synth.utterances[0].voice, selected);
  assert.equal(synth.utterances[0].lang, "en-GB");
  assert.equal(synth.utterances[0].rate, 2.5);
});

test("voices load asynchronously, preserve selection, and allow system default", () => {
  const { get, synth, availableVoices, paste } = setup();
  assert.equal(get("voice").children.length, 1);
  availableVoices.push({ voiceURI: "new", name: "New voice", lang: "en-US" });
  synth.events.voiceschanged();
  assert.equal(get("voice").children.length, 2);
  get("voice").value = "new";
  synth.events.voiceschanged();
  assert.equal(get("voice").value, "new");
  availableVoices.length = 0;
  synth.events.voiceschanged();
  assert.equal(get("voice").value, "");
  paste("System voice.");
  get("play").fire("click");
  assert.equal(synth.utterances[0].voice, null);
});

test("language options are unique, named, sorted, and keep regional variants separate", () => {
  const { get } = setup({ availableVoices: [
    { voiceURI: "french", name: "French", lang: "fr-FR" },
    { voiceURI: "british", name: "British", lang: "en-GB" },
    { voiceURI: "american", name: "American", lang: "en-US" },
    { voiceURI: "other-british", name: "Other British", lang: "en-GB" },
    { voiceURI: "unknown", name: "Unknown", lang: "" },
  ] });
  const options = get("language").children;
  assert.deepEqual(Array.from(options, (item) => item.value).sort(), ["", "en-GB", "en-US", "fr-FR"]);
  assert.equal(get("language").children[0].textContent, "All languages");
  assert.match(options.find((item) => item.value === "en-GB").textContent, /English.*en-GB/);
  const labels = Array.from(options.slice(1), (item) => item.textContent);
  assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b, "en")));
  assert.equal(get("voice").children.length, 6);
});

test("language filtering selects a matching voice and sends it to the speech engine", () => {
  const french = { voiceURI: "french", name: "French", lang: "fr-FR" };
  const { get, paste, synth } = setup({ availableVoices: [
    { voiceURI: "english", name: "English", lang: "en-US", default: true },
    french,
  ] });
  get("voice").value = "english";
  get("language").value = "fr-FR";
  get("language").fire("change");
  assert.deepEqual(Array.from(get("voice").children, (item) => item.value), ["french"]);
  assert.equal(get("voice").value, "french");
  paste("Bonjour.");
  get("play").fire("click");
  assert.equal(synth.utterances[0].voice, french);
  assert.equal(synth.utterances[0].lang, "fr-FR");
  get("stop").fire("click");
  assert.equal(get("language").disabled, false);
});

test("filtering prefers a matching default and preserves a matching user selection", () => {
  const { get } = setup({ availableVoices: [
    { voiceURI: "first", name: "First", lang: "en-US" },
    { voiceURI: "default", name: "Default", lang: "en-US", default: true },
    { voiceURI: "british", name: "British", lang: "en-GB" },
  ] });
  get("language").value = "en-US";
  get("language").fire("change");
  assert.equal(get("voice").value, "default");
  get("voice").value = "first";
  get("language").value = "";
  get("language").fire("change");
  assert.equal(get("voice").children[0].textContent, "System default");
  assert.equal(get("voice").children.length, 4);
  assert.equal(get("voice").value, "first");
  get("language").value = "en-US";
  get("language").fire("change");
  assert.equal(get("voice").value, "first");
});

test("voice refresh preserves language and voice, then recovers when either disappears", () => {
  const { get, synth, availableVoices } = setup();
  assert.equal(get("language").children.length, 1);
  availableVoices.push(
    { voiceURI: "english", name: "English", lang: "en-US" },
    { voiceURI: "french", name: "French", lang: "fr-FR" },
    { voiceURI: "other-french", name: "Other French", lang: "fr-FR" },
  );
  synth.events.voiceschanged();
  get("language").value = "fr-FR";
  get("language").fire("change");
  get("voice").value = "other-french";
  synth.events.voiceschanged();
  assert.equal(get("language").value, "fr-FR");
  assert.equal(get("voice").value, "other-french");
  assert.equal(get("voice").children.length, 2);
  availableVoices.pop();
  synth.events.voiceschanged();
  assert.equal(get("language").value, "fr-FR");
  assert.equal(get("voice").value, "french");
  availableVoices.pop();
  synth.events.voiceschanged();
  assert.equal(get("language").value, "");
  assert.equal(get("voice").value, "");
  assert.deepEqual(Array.from(get("voice").children, (item) => item.value), ["", "english"]);
  availableVoices.length = 0;
  synth.events.voiceschanged();
  assert.equal(get("language").children.length, 1);
  assert.equal(get("voice").children.length, 1);
});

test("long documents are fully spoken in bounded chunks", () => {
  const { get, paste, synth } = setup();
  const value = "This is a sentence to read aloud. ".repeat(100);
  paste(value);
  get("play").fire("click");
  let index = 0;
  while (index < synth.utterances.length) {
    assert.ok(synth.utterances[index].text.length <= 200);
    synth.utterances[index++].onend();
  }
  assert.ok(index > 1);
  assert.equal(synth.utterances.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim(), value.trim());
  assert.equal(get("play-label").textContent, "Play");
});

test("unbroken text does not exceed the chunk limit or lose characters", () => {
  const { context } = setup();
  const chunks = runInNewContext('splitText("a".repeat(601))', context);
  assert.equal(chunks.length, 4);
  assert.equal(chunks.join(""), "a".repeat(601));
  assert.ok(chunks.every((chunk) => chunk.length <= 200));
});

test("a chunk ending during pause waits for resume", () => {
  const { get, paste, synth } = setup();
  paste("An ordinary sentence. ".repeat(30));
  get("play").fire("click");
  get("play").fire("click");
  synth.utterances[0].onend();
  assert.equal(synth.utterances.length, 1);
  get("play").fire("click");
  assert.equal(synth.utterances.length, 2);
});

test("stop ignores late completion and errors from canceled playback", () => {
  const { get, paste, synth } = setup();
  paste("Some text. ".repeat(60));
  get("play").fire("click");
  const oldUtterance = synth.utterances[0];
  get("stop").fire("click");
  get("play").fire("click");
  oldUtterance.onend();
  oldUtterance.onerror({ error: "interrupted" });
  assert.equal(synth.utterances.length, 2);
  assert.equal(get("play-label").textContent, "Pause");
  assert.equal(get("status").classes.has("error"), false);
});

test("speech errors are visible and controls recover", () => {
  const { get, paste, synth } = setup();
  paste("Test error.");
  get("play").fire("click");
  synth.utterances[0].onerror({ error: "network" });
  assert.match(get("status").textContent, /Speech failed \(network\)/);
  assert.equal(get("status").classes.has("error"), true);
  assert.equal(get("play-label").textContent, "Play");
  assert.equal(get("text").readOnly, false);
});

test("clear resets text, count, focus, and play availability", () => {
  const { get, paste } = setup();
  paste("a");
  assert.equal(get("character-count").textContent, "1 character");
  get("clear").fire("click");
  assert.equal(get("text").value, "");
  assert.equal(get("character-count").textContent, "0 characters");
  assert.equal(get("text").focused, true);
  assert.equal(get("play").disabled, true);
});

test("unsupported browsers show an actionable message", () => {
  const { get, paste } = setup({ supported: false });
  assert.equal(get("play").disabled, true);
  assert.equal(get("language").disabled, true);
  assert.equal(get("voice").disabled, true);
  assert.equal(get("speed").disabled, true);
  assert.equal(get("status").classes.has("error"), true);
  assert.match(get("status").textContent, /isn't available/);
  paste("Text should not hide the browser compatibility message.");
  assert.match(get("status").textContent, /isn't available/);
  assert.equal(get("status").classes.has("error"), true);
  get("clear").fire("click");
  assert.match(get("status").textContent, /isn't available/);
});

test("leaving the page cancels speech and resets controls", () => {
  const { get, paste, synth, window } = setup();
  paste("Goodbye.");
  get("play").fire("click");
  window.events.pagehide();
  assert.equal(synth.cancels, 2);
  assert.equal(get("play-label").textContent, "Play");
});
