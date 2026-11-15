# MoneyPrinterTurbo video backend

[MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo) is a self-hosted
service that turns a script into a finished video using stock footage. Set
`VIDEO_PROVIDER=moneyprinter` and the agent sends each approved script to it instead
of rendering a slideshow or per-scene AI clips.

Who does what:

| Step | Done by |
| --- | --- |
| Topic research, script, SEO, thumbnail, approval, publishing, analytics | This agent |
| Narration (TTS), stock footage matched to the script, subtitles, background music, final render | MoneyPrinterTurbo |

## Setup

1. Run MoneyPrinterTurbo's API. From a MoneyPrinterTurbo checkout:

   ```bash
   cp config.example.toml config.toml   # add pexels_api_keys (or pixabay) here
   docker compose up -d api              # serves http://127.0.0.1:8080
   ```

   Footage needs a Pexels or Pixabay key in its `config.toml`. Narration uses its
   free Edge TTS voices by default, so no key is needed for that.

2. Point the agent at it in `.env`:

   ```bash
   VIDEO_PROVIDER=moneyprinter
   MONEYPRINTER_API_URL=http://127.0.0.1:8080
   # Only if you set [app] api_key in MoneyPrinterTurbo's config.toml:
   MONEYPRINTER_API_KEY=
   ```

3. Run the agent as usual (`npm start`).

## Options

| Variable | Default | Meaning |
| --- | --- | --- |
| `MONEYPRINTER_VOICE_NAME` | `en-US-AndrewMultilingualNeural-Male` | Any voice MoneyPrinterTurbo lists |
| `MONEYPRINTER_VIDEO_LANGUAGE` | `en` | Script language |
| `MONEYPRINTER_VIDEO_ASPECT` | `VIDEO_ASPECT_RATIO` or `16:9` | `16:9`, `9:16` or `1:1` |
| `MONEYPRINTER_VIDEO_SOURCE` | `pexels` | `pexels` or `pixabay` |
| `MONEYPRINTER_CLIP_DURATION` | `5` | Max seconds per stock clip (1–15) |
| `MONEYPRINTER_SUBTITLES` | `true` | Burn in subtitles |
| `MONEYPRINTER_BGM_TYPE` | `random` | Background music (`random` or empty for none) |
| `MONEYPRINTER_POLL_MS` | `5000` | Task polling interval |
| `MONEYPRINTER_TIMEOUT_MS` | `1800000` | Give up after this long |

## Behaviour notes

- The narration text the agent sends is the same TTS text it generates for its own
  narration (`*_tts.txt`), and the script keywords become footage search terms.
- MoneyPrinterTurbo voices the video itself. Agent-side narration is still attempted
  but is no longer required for final assembly in this mode.
- If MoneyPrinterTurbo is unreachable or the task fails, the agent falls back to the
  local slideshow, the same way as the other video providers.
