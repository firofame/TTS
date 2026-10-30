# Read aloud

A minimal text-to-speech app using Microsoft Azure neural voices only.
No frontend dependencies, build step, sign-in, API-key fields, voice-source
selector, or configuration screen. Azure voices load automatically.

## Use

Open the app in Chrome, Edge, Firefox, or Safari. Paste text, choose a language,
voice, and speed (0.5x to 3x), then press **Play**. **Pause** and **Resume** keep
your place. **Stop** returns to the beginning and unlocks editing.

Choose **Download MP3** to save the full text in the selected voice without
playing it first. Downloads use the original voice speed (1x); the speed slider
affects playback only. **Stop** cancels download preparation and unlocks editing.
Long text is combined into one MP3, and preparation progress is shown.
Files are named `TTS_YYYY-MM-DD_HH-mm-ss.mp3` using your local date and time
when the download is ready, for example `TTS_2026-10-30_08-21-02.mp3`.

On mobile, the reader comes first: a single-row header, no visible marketing
intro, and a full-width primary playback button directly below the text.
Language, voice, and speed settings follow the playback controls.
Theme and playback buttons have touch-friendly targets, and text fields
use a mobile-friendly font size to avoid automatic zoom when focused.
The desktop layout keeps its introductory heading and wider controls.

The theme icons offer **System** (monitor), **Light** (sun), and **Dark** (moon).
The selected icon is highlighted. The default is **System**, which follows
changes to your device's appearance while the app is open. Your selection is
saved locally for future visits. If browser storage is unavailable, a notice
appears and theme changes still work for the current page.

The footer's **Buy me a coffee** button opens Stripe-hosted Checkout in a new
tab for an optional, one-time **INR 10** contribution. Payment details are
handled by Stripe, not the app; no Stripe keys, scripts, or backend changes
are required. The button also works without JavaScript. To change the amount,
create a new Stripe Payment Link and update the button's URL, amount, and
accessible label in [index.html](./index.html), along with its regression test
in [app.test.cjs](./app.test.cjs).

**Microsoft Azure** is the only voice source. **All languages** shows all Azure
voices. Regional language variants are filtered separately. The default selection
is **American English (en-US)** with **Ava Multilingual (en-US)** when available.

Link directly to a voice using its Azure voice ID, for example
<https://firofame.github.io/TTS/?voice=fr-FR-DeniseNeural>.
Once voices load, the app selects that voice and its language automatically.
Changing the voice or language updates the `voice` URL parameter without
reloading or adding browser history entries; other parameters and the URL
fragment are preserved. Copy the address to share the selected voice.
If the ID is unavailable or empty, a warning appears and the normal default
selection is used. A link without `voice` keeps the defaults above.

For local use, serve this folder and open <http://127.0.0.1:8000>:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Use HTTP, not `file://`, for Azure playback. No local gateway, Keychain access,
or secret environment variables are needed on the user's computer.

The GitHub Pages site is <https://firofame.github.io/TTS/>. GitHub Pages publishes
the repository root from `main` when changes are pushed. The same frontend
works locally and on that site without any configuration changes.
The deployment URL in [app.js](./app.js) is public and contains no credentials.

## Privacy and playback

The app does not save text or credentials. With Azure voices, text is sent to
the app's Azure Function and Microsoft for speech processing.

Long text is split into sections of at most 1,500 UTF-16 code units.
Azure audio is played in the browser with
pitch-preserving speed control. Pause/Resume does not synthesize the same audio
again. Stop aborts pending requests and releases audio, but already submitted
Azure work may still count toward quota. Starting over synthesizes text again.
There are no automatic synthesis retries or background prefetch requests.
Each download synthesizes the full text again and uses the same shared Azure
quota as playback. Canceling a download aborts pending requests, but already
submitted work may still count toward quota. No partial file is downloaded.

If Azure is unavailable, the app shows an explicit error. Reload the page to
retry loading its catalog, or try playback again later if synthesis fails.
There is no browser-voice fallback.

## Azure deployment

The backend is already deployed in Central India:

| Resource | Current setup |
| --- | --- |
| Resource group | `rg-read-aloud-0b33fdb4` |
| Region | `centralindia` |
| Speech resource | `read-aloud-speech-0b33fdb4`, Free F0 |
| Function App | `read-aloud-0b33fdb4`, Linux Consumption, Node.js 22 |
| Public API | `https://read-aloud-0b33fdb4.azurewebsites.net/api` |
| Storage | `ttsaudio0b33fdb4`, Standard LRS, no public blob access |

[azure-functions/](./azure-functions/) contains a Node.js 22+ Azure Functions v4
backend exposing `GET /api/voices` and `POST /api/speech`. Both routes are
intentionally **anonymous**, so GitHub Pages can use them without asking users
for keys or sign-in. Only the server authenticates to Microsoft Speech.

The Speech key remains in Azure application settings and is never returned to
the browser, saved in the frontend, or committed to Git. Optional Application
Insights is disabled.

### Shared quota and costs

All visitors share the resource's
[F0 allowance](https://azure.microsoft.com/en-us/pricing/details/speech/),
currently 500,000 neural TTS characters per month and 20 transactions per minute.
The catalog excludes HD voices. Speech stays on **F0**: once its allowance is
exhausted, requests fail rather than automatically upgrading to S0.

The endpoint is public. Anyone can call it or consume the shared allowance.
Allowed browser origins are limited to `https://firofame.github.io` and
`http://127.0.0.1:8000`, but **CORS is not authentication** and cannot prevent
non-browser callers. Input length limits and XML escaping are enforced on the
server, not just in the UI.

**Function hosting and storage have separate allowances and possible charges.**
F0 does not cap those costs. Budget alerts are notifications, not spending caps.
For wider public use, consider authenticated access and durable rate limiting.

### Operator settings and updates

In the Function App's **Settings > Environment variables**:

| Setting | Value |
| --- | --- |
| `SPEECH_KEY` | Speech resource key |
| `SPEECH_REGION` | `centralindia` |
| `FUNCTIONS_WORKER_RUNTIME` | `node` |

Keep the Speech resource on Free F0 unless you intentionally accept paid Speech
usage. Keep secrets in Azure settings or a Key Vault reference, not this repo.

With [Azure Functions Core Tools v4](https://learn.microsoft.com/en-us/azure/azure-functions/functions-run-local)
installed and Azure authenticated, deploy backend updates:

```sh
cd azure-functions
npm ci
func azure functionapp publish read-aloud-0b33fdb4 --build remote
```

Backend updates do not publish the static frontend; push frontend updates to
`main` to publish them to GitHub Pages. A different frontend origin also needs an explicit
entry under the Function App's **API > CORS**. Use an origin without a path,
not `*`. Allow `Content-Type` in preflight requests.

For isolated backend development, copy
[local.settings.example.json](./azure-functions/local.settings.example.json)
to `azure-functions/local.settings.json`, fill its Speech settings, then run
`npm start` inside that directory. The real local settings are ignored by Git
and deployment. The reader normally uses the deployed public API.

Maintenance: Node.js 22 support ends April 30, 2027, and it is the last Node.js
version supported on Linux Consumption. Migrate to Flex Consumption and a
supported Node.js version before then. Linux Consumption retires September 30,
2028. See Microsoft's
[language support policy](https://learn.microsoft.com/en-us/azure/azure-functions/supported-languages).

## Test

With Node.js 22+:

```sh
npm ci --prefix azure-functions
node --test app.test.cjs theme.test.cjs azure-functions/speech.test.cjs
```

Tests mock media playback and Azure responses. They cover
system and saved themes, live appearance changes, storage failures,
automatic voice loading, Azure-only UI, cancellation,
pause/resume, chunking, filtering, voice URL selection and sharing, SSML escaping,
full-text MP3 downloads, download cancellation and cleanup, the footer's Stripe
support link, input validation,
public route registration, and explicit upstream errors without
consuming Azure quota.
