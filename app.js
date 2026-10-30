"use strict";

const text = document.getElementById("text");
const language = document.getElementById("language");
const voice = document.getElementById("voice");
const speed = document.getElementById("speed");
const speedValue = document.getElementById("speed-value");
const play = document.getElementById("play");
const playLabel = document.getElementById("play-label");
const stop = document.getElementById("stop");
const download = document.getElementById("download");
const clear = document.getElementById("clear");
const status = document.getElementById("status");
const characterCount = document.getElementById("character-count");
const editingHint = document.getElementById("editing-hint");
const azureApi = "https://read-aloud-0b33fdb4.azurewebsites.net/api";
const audio = new window.Audio();

let state = "idle";
let voices = [];
let chunks = [];
let chunkIndex = 0;
let generation = 0;
let connectionRequest = null;
let speechRequest = null;
let audioUrl = null;
let downloadUrl = null;

function isReady() {
  return voices.length > 0;
}

function readyMessage() {
  return isReady() ? "Azure is ready when you are." : "Loading Microsoft neural voices...";
}

function render(message, error = false) {
  const active = state !== "idle";
  const ready = isReady();
  text.readOnly = active;
  language.disabled = !ready || active;
  voice.disabled = !ready || active;
  speed.disabled = !ready || active;
  play.disabled = !ready || state === "downloading" || (!active && !text.value.trim());
  download.disabled = !ready || active || !text.value.trim();
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

function updateLanguages() {
  const selectedLanguage = language.value;
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
  const options = matchingVoices.map((item) => {
    const option = document.createElement("option");
    option.value = item.voiceURI;
    option.textContent = `${item.name} (${item.lang})${item.default ? " - default" : ""}`;
    return option;
  });
  voice.replaceChildren(...options);
  voice.value = matchingVoices.some((item) => item.voiceURI === selected)
    ? selected
    : (matchingVoices.find((item) => item.voiceURI === "en-US-AvaMultilingualNeural") ||
      matchingVoices.find((item) => item.default) ||
      matchingVoices.find((item) => item.voiceURI === "en-US-JennyNeural") ||
      matchingVoices[0])?.voiceURI || "";
}

function updateVoiceUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("voice", voice.value);
  try {
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url.href);
  } catch (error) {
    render(`Could not update the voice link: ${error.message}`, true);
    return;
  }
  render(readyMessage());
}

function splitText(value, limit = 1500) {
  const result = [];
  let remaining = value.trim();
  while (remaining.length > limit) {
    const sample = remaining.slice(0, limit);
    let end = Math.max(sample.lastIndexOf(". "), sample.lastIndexOf("! "), sample.lastIndexOf("? "), sample.lastIndexOf("\n"));
    end = end >= 0 ? end + 1 : sample.lastIndexOf(" ");
    if (end <= 0) end = limit;
    // Keep UTF-16 surrogate pairs together, including in unbroken text.
    if (/[\uD800-\uDBFF]/.test(remaining[end - 1]) &&
        /[\uDC00-\uDFFF]/.test(remaining[end])) end -= 1;
    result.push(remaining.slice(0, end));
    remaining = remaining.slice(end).trimStart();
  }
  if (remaining) result.push(remaining);
  return result;
}

function stopSpeech(message) {
  generation += 1;
  chunks = [];
  state = "idle";
  speechRequest?.abort();
  speechRequest = null;
  releaseAudio();
  releaseDownload();
  render(message);
}

function releaseDownload() {
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = null;
}

function releaseAudio() {
  audio.onended = null;
  audio.onerror = null;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = null;
}

function playbackError(message) {
  stopSpeech(message);
  status.classList.toggle("error", true);
}

async function requestAzure(path, options, signal) {
  const response = await fetch(`${azureApi}/${path}`, {
    ...options,
    signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]),
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) {
    const payload = response.headers.get("content-type")?.includes("application/json")
      ? await response.json() : null;
    const message = `Speech service unavailable (HTTP ${response.status}). Try again later.`;
    throw new Error(typeof payload?.error === "string" ? payload.error : message);
  }
  return response;
}

function playAzureAudio(token) {
  audio.play().catch((error) => {
    if (token !== generation || (error.name === "AbortError" && state === "paused")) return;
    playbackError(`Audio playback failed (${error.message}). Check your browser's audio permissions and try Play again.`);
  });
}

async function requestAzureAudio(value, signal) {
  const response = await requestAzure("speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: value, voice: voice.value }),
  }, signal);
  const blob = await response.blob();
  if (!blob.size || !blob.type.startsWith("audio/")) throw new Error("The Function did not return valid audio.");
  return blob;
}

async function downloadAudio() {
  if (!isReady() || state !== "idle") return;
  if (!text.value.trim()) {
    render("Paste some text to get started.");
    text.focus();
    return;
  }
  const token = ++generation;
  const controller = new AbortController();
  speechRequest = controller;
  state = "downloading";
  const sections = splitText(text.value);
  const parts = [];
  try {
    for (let index = 0; index < sections.length; index += 1) {
      render(`Preparing MP3 (${index + 1} of ${sections.length})...`);
      const blob = await requestAzureAudio(sections[index], controller.signal);
      if (token !== generation) return;
      if (blob.type !== "audio/mpeg") throw new Error("The Function did not return MP3 audio.");
      parts.push(blob);
    }
    releaseDownload();
    downloadUrl = URL.createObjectURL(new Blob(parts, { type: "audio/mpeg" }));
    const link = document.createElement("a");
    link.href = downloadUrl;
    const now = new Date();
    const timestamp = [
      now.getFullYear(), now.getMonth() + 1, now.getDate(),
      now.getHours(), now.getMinutes(), now.getSeconds(),
    ].map((part) => String(part).padStart(2, "0"));
    link.download = `TTS_${timestamp.slice(0, 3).join("-")}_${timestamp.slice(3).join("-")}.mp3`;
    document.body.append(link);
    try {
      link.click();
    } finally {
      link.remove();
    }
    state = "idle";
    render("MP3 download started at original speed (1x).");
  } catch (error) {
    if (token === generation) playbackError(`Audio download failed: ${error.message}`);
  } finally {
    if (speechRequest === controller) speechRequest = null;
  }
}

async function speakAzureNext(token) {
  if (speechRequest) return;
  releaseAudio();
  const controller = new AbortController();
  speechRequest = controller;
  render("Preparing Azure audio...");
  try {
    const blob = await requestAzureAudio(chunks[chunkIndex], controller.signal);
    if (token !== generation) return;
    audioUrl = URL.createObjectURL(blob);
    audio.onended = () => {
      if (token !== generation) return;
      releaseAudio();
      chunkIndex += 1;
      speakNext(token);
    };
    audio.onerror = () => {
      if (token === generation) playbackError("Azure audio could not be decoded. Try again or choose another voice.");
    };
    audio.src = audioUrl;
    audio.playbackRate = Number(speed.value);
    audio.preservesPitch = true;
    if (state === "playing") {
      render("Reading aloud with Azure...");
      playAzureAudio(token);
    }
  } catch (error) {
    if (token === generation) playbackError(`Azure speech failed: ${error.message}`);
  } finally {
    if (speechRequest === controller) speechRequest = null;
  }
}

function speakNext(token) {
  if (token !== generation || state !== "playing") return;
  if (chunkIndex >= chunks.length) {
    releaseAudio();
    state = "idle";
    render("Finished. Listen again anytime.");
    return;
  }
  speakAzureNext(token);
}

play.addEventListener("click", () => {
  if (!isReady() || state === "downloading") return;
  if (state === "playing") {
    state = "paused";
    audio.pause();
    render("Paused. Take your time.");
  } else if (state === "paused") {
    state = "playing";
    render("Reading aloud...");
    if (audioUrl) playAzureAudio(generation);
    else speakNext(generation);
  } else {
    if (!text.value.trim()) {
      render("Paste some text to get started.");
      text.focus();
      return;
    }
    generation += 1;
    chunks = splitText(text.value);
    chunkIndex = 0;
    state = "playing";
    render("Reading aloud...");
    speakNext(generation);
  }
});

download.addEventListener("click", downloadAudio);
stop.addEventListener("click", () => stopSpeech(state === "downloading"
  ? "Download canceled." : "Stopped. Press Play to start again."));
clear.addEventListener("click", () => {
  text.value = "";
  render(isReady() ? readyMessage() : undefined);
  text.focus();
});
text.addEventListener("input", () => render(isReady() ? readyMessage() : undefined));
language.addEventListener("change", () => {
  filterVoices();
  updateVoiceUrl();
});
voice.addEventListener("change", updateVoiceUrl);
speed.addEventListener("input", () => {
  const rate = Number(speed.value);
  speedValue.textContent = `${rate}x`;
  speed.setAttribute("aria-valuetext", `${rate} times normal speed`);
});

async function loadAzureVoices() {
  const controller = new AbortController();
  connectionRequest = controller;
  render(readyMessage());
  try {
    const response = await requestAzure("voices", { method: "GET" }, controller.signal);
    const result = await response.json();
    if (connectionRequest !== controller) return;
    if (!Array.isArray(result.voices) || !result.voices.length ||
        !result.voices.every((item) => typeof item.voiceURI === "string" &&
          typeof item.name === "string" && typeof item.lang === "string" && item.lang)) {
      throw new Error("The Function returned an invalid voice list.");
    }
    for (const item of result.voices) Intl.getCanonicalLocales(item.lang);
    voices = result.voices;
    updateLanguages();
    const requestedVoice = new URL(window.location.href).searchParams.get("voice");
    const selectedVoice = voices.find((item) => item.voiceURI === requestedVoice);
    if (selectedVoice) {
      language.value = selectedVoice.lang;
      filterVoices();
      voice.value = selectedVoice.voiceURI;
    }
    if (requestedVoice !== null && !selectedVoice) {
      render("The voice in this link is unavailable. Using the default selection; choose another voice if needed.", true);
    } else {
      render(readyMessage());
    }
  } catch (error) {
    if (connectionRequest !== controller) return;
    render(`Could not load Azure voices: ${error.message} Reload the page to retry.`, true);
  } finally {
    if (connectionRequest === controller) {
      connectionRequest = null;
      render();
    }
  }
}

window.addEventListener("pagehide", () => {
  connectionRequest?.abort();
  connectionRequest = null;
  stopSpeech(readyMessage());
});
loadAzureVoices();
