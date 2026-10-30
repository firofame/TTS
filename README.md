# Read aloud

A minimal text-to-speech app using the browser's built-in Web Speech API.
No dependencies, account, API key, or build step.

## Use

Live app: <https://firofame.github.io/TTS/>.

Open [index.html](./index.html) in a current version of Chrome, Edge, or Safari.
Paste text, optionally filter voices by **Language**, choose a voice and speed
(0.5x to 3x), then press **Play**. **All languages** shows every available voice
and the system default. Choosing a language (including its regional variant)
shows only matching voices and selects one if your current voice does not match.
**Pause** and **Resume** keep your place. **Stop** returns to the beginning and
unlocks the text, language, voice, and speed controls.

Long text is read in short sections to avoid browser utterance-length limits.
Available voices, pronunciation, actual speaking speed, and pause/resume behavior
depend on your browser and operating system. If pause/resume is unreliable in
your browser, use Stop and Play or try another browser.

The app does not store your text or send it to an app server. Some browser or
system voices use online speech services; choose an offline voice in your
device's settings if you need offline processing.

For local HTTP preview, run `python3 -m http.server 8000 --bind 127.0.0.1`
from this folder and open <http://127.0.0.1:8000>.

## Test

Run `node --test app.test.cjs` (Node.js 18 or newer).
The tests use a mocked speech engine; actual audio output still depends on
the browser and device.
