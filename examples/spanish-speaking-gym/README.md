# Spanish Speaking Gym (MVP Prototype)

A free-first, local-first speaking practice app prototype.

## What this includes

- Daily 30-minute dashboard with rotating day types
- Phrase chunk bank with recall tracking
- Substitution drills with weak phrase funnel
- Beginner roleplay cards
- Weak phrase log
- Progress milestones + weekly benchmark tracker
- Browser-native Spanish text-to-speech (if supported)
- Optional speech recognition toggle (if supported)
- Optional (future) OpenAI Realtime adapter toggle in settings (not required for MVP)
- Gamified XP + streak tracker
- Daily quick challenge prompt
- Phrase search + category filters
- Interactive roleplay checklists with saved progress
- Installable mobile PWA shell with offline cache
- Mobile connection URL helper in settings

## Environment

Copy the optional environment template if you want to serve the app to a phone on the same Wi-Fi network:

```sh
cp .env.example .env
```

The defaults bind to `0.0.0.0:4173`, which lets another device on your network open the app from your computer's LAN IP address.

## Run

For quick local use, open `index.html` in any modern browser.

For mobile install/offline support, serve the folder over HTTP:

```sh
cd examples/spanish-speaking-gym
python3 -m http.server "${PORT:-4173}" --bind "${HOST:-0.0.0.0}"
```

Then open `http://<your-computer-lan-ip>:4173/` on your phone, go to **Settings**, copy/share the mobile connection URL if needed, and choose **Add to Home Screen** / **Install App** from the mobile browser.

No account, paid API, or hosted backend required for this MVP prototype.
