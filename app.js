"use strict";

const text = document.getElementById("text");
const language = document.getElementById("language");
const voice = document.getElementById("voice");
const speed = document.getElementById("speed");
const speedValue = document.getElementById("speed-value");
const play = document.getElementById("play");
const playLabel = document.getElementById("play-label");
const stop = document.getElementById("stop");
const clear = document.getElementById("clear");
const status = document.getElementById("status");
const characterCount = document.getElementById("character-count");
const editingHint = document.getElementById("editing-hint");
const supported = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
const synth = supported ? window.speechSynthesis : null;

let state = "idle";
let voices = [];
let chunks = [];
let chunkIndex = 0;
let currentUtterance = null;
let generation = 0;

function render(message, error = false) {
  const active = state !== "idle";
  text.readOnly = active;
  language.disabled = !supported || active;
  voice.disabled = !supported || active;
  speed.disabled = !supported || active;
  play.disabled = !supported || (!active && !text.value.trim());
  stop.disabled = !active;
  clear.disabled = active || !text.value;
  editingHint.hidden = !active;
  play.dataset.mode = state;
  playLabel.textContent = state === "playing" ? "Pause" : state === "paused" ? "Resume" : "Play";
  characterCount.textContent = `${text.value.length.toLocaleString()} character${text.value.length === 1 ? "" : "s"}`;
  if (message !== undefined) {
    status.textContent = message;
    status.classList.toggle("error", error);
  }
}

function loadVoices() {
  const selectedLanguage = language.value;
  voices = synth.getVoices();
  const languageNames = new Intl.DisplayNames(["en"], { type: "language" });
  const allLanguages = document.createElement("option");
  allLanguages.value = "";
  allLanguages.textContent = "All languages";
  const languages = [...new Set(voices.map((item) => item.lang).filter(Boolean))];
  const options = languages.map((lang) => {
    const option = document.createElement("option");
    option.value = lang;
    option.textContent = `${languageNames.of(lang)} (${lang})`;
    return option;
  }).sort((a, b) => a.textContent.localeCompare(b.textContent, "en"));
  language.replaceChildren(allLanguages, ...options);
  language.value = languages.includes(selectedLanguage) ? selectedLanguage : "";
  filterVoices();
}

function filterVoices() {
  const selected = voice.value;
  const matchingVoices = voices.filter((item) => !language.value || item.lang === language.value);
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "System default";
  const options = matchingVoices.map((item) => {
    const option = document.createElement("option");
    option.value = item.voiceURI;
    option.textContent = `${item.name} (${item.lang})${item.default ? " - default" : ""}`;
    return option;
  });
  voice.replaceChildren(...(language.value ? options : [defaultOption, ...options]));
  voice.value = matchingVoices.some((item) => item.voiceURI === selected)
    ? selected
    : language.value
      ? (matchingVoices.find((item) => item.default) || matchingVoices[0]).voiceURI
      : "";
}

function splitText(value) {
  const result = [];
  let remaining = value.trim();
  // Short utterances avoid browser limits when reading long pasted documents.
  while (remaining.length > 200) {
    const sample = remaining.slice(0, 200);
    let end = Math.max(sample.lastIndexOf(". "), sample.lastIndexOf("! "), sample.lastIndexOf("? "), sample.lastIndexOf("\n"));
    end = end >= 0 ? end + 1 : sample.lastIndexOf(" ");
    if (end <= 0) end = 200;
    result.push(remaining.slice(0, end));
    remaining = remaining.slice(end).trimStart();
  }
  if (remaining) result.push(remaining);
  return result;
}

function stopSpeech(message) {
  generation += 1;
  currentUtterance = null;
  chunks = [];
  state = "idle";
  synth.cancel();
  render(message);
}

function speakNext(token) {
  if (token !== generation || state !== "playing") return;
  if (chunkIndex >= chunks.length) {
    currentUtterance = null;
    state = "idle";
    render("Finished. Listen again anytime.");
    return;
  }

  const utterance = new window.SpeechSynthesisUtterance(chunks[chunkIndex]);
  currentUtterance = utterance;
  utterance.voice = voices.find((item) => item.voiceURI === voice.value) || null;
  if (utterance.voice) utterance.lang = utterance.voice.lang;
  utterance.rate = Number(speed.value);
  utterance.onend = () => {
    if (token !== generation) return;
    currentUtterance = null;
    chunkIndex += 1;
    speakNext(token);
  };
  utterance.onerror = (event) => {
    if (token !== generation) return;
    stopSpeech(`Speech failed (${event.error}). Try another voice or check your device's speech settings.`);
    status.classList.toggle("error", true);
  };
  synth.speak(utterance);
}

play.addEventListener("click", () => {
  if (!supported) return;
  if (state === "playing") {
    state = "paused";
    synth.pause();
    render("Paused. Take your time.");
  } else if (state === "paused") {
    state = "playing";
    synth.resume();
    if (!currentUtterance) speakNext(generation);
    render("Reading aloud...");
  } else {
    if (!text.value.trim()) {
      render("Paste some text to get started.");
      text.focus();
      return;
    }
    generation += 1;
    synth.cancel();
    synth.resume();
    chunks = splitText(text.value);
    chunkIndex = 0;
    state = "playing";
    render("Reading aloud...");
    speakNext(generation);
  }
});

stop.addEventListener("click", () => stopSpeech("Stopped. Press Play to start again."));
clear.addEventListener("click", () => {
  text.value = "";
  render(supported ? "Ready when you are." : undefined);
  text.focus();
});
text.addEventListener("input", () => render(supported ? "Ready when you are." : undefined));
language.addEventListener("change", filterVoices);
speed.addEventListener("input", () => {
  const rate = Number(speed.value);
  speedValue.textContent = `${rate}x`;
  speed.setAttribute("aria-valuetext", `${rate} times normal speed`);
});

if (supported) {
  loadVoices();
  synth.addEventListener("voiceschanged", loadVoices);
  window.addEventListener("pagehide", () => stopSpeech("Ready when you are."));
  render("Ready when you are.");
} else {
  render("Text to speech isn't available in this browser. Try a current version of Chrome, Edge, or Safari.", true);
}
