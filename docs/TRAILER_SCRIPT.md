# ELSEWHERE - story trailer (action / mystery / hope)

> Exploring other worlds starts with understanding our own.

**Check the event rules first** (maximum video length, music licensing, no NASA insignia/"meatball" logo).
Below: a **90 s main cut** and a **30 s cut**. Real app footage is mixed with AI-generated or stock cinematic
shots; say so in the AI disclosure and keep the small dramatization disclaimer at the end.

## Story in one line

An astronaut lands on Mars sure he is ready - and every mission fails: the landing, the rover, the camp, the
walk. Twist: it was a **mission simulation** showing what happens when crews train on the **wrong ground**.
The team uses **ELSEWHERE** to find the places on Earth that truly match the Mars site, trains there, and the
final mission succeeds. The team appears at the end as the heroes.

## Sound design (three acts)

| Act | Music | Sound effects |
|---|---|---|
| 1 Arrival (confidence) | low ambient drone, sparse piano | heartbeat, suit breathing, radio crackle, boots on gravel |
| 2 Failures (tension) | trailer "braam" hits on each failure, ticking clock, rising strings; hard **silence** before each "FAILED" stamp | alarms, metal stress, fire roar, wheel grind, glitch stamp |
| Twist | everything cuts to silence, one sub-bass drop | "SIMULATION ENDED" beep, a breath |
| 3 ELSEWHERE (curiosity -> hope) | pulsing synth arpeggio building to hybrid orchestra, choir in the final chorus | UI clicks, scan, warp, astronaut landing (from the app, sound on) |
| 4 Heroes | full theme peak, then a single low note under the logo | logo "whoosh + impact" stinger |

Free, licensable sources: YouTube Audio Library, Pixabay Music/Sound Effects (check each item's licence),
our CC0 app sounds in `frontend/public/audio/` (Kenney, "yd"). Search terms: "epic trailer hybrid", "suspense
braam", "cinematic riser", "heartbeat", "glitch hit". Keep a list of every track and its licence for the
submission.

## Voice-over direction

Deep, calm, slow, slightly rough (movie-trailer narrator). Leave silence between lines. English.
Record yourselves (clean room, phone close to mouth) or use a TTS voice that allows this use, and disclose it.

## Main cut - 90 seconds

| Time | Picture | Source | Voice-over / on-screen text | Sound |
|---|---|---|---|---|
| 0:00-0:04 | Black. A heartbeat. Text types on: **SOL 1 - JEZERO CRATER, MARS** | text | - | heartbeat, radio crackle |
| 0:04-0:10 | Lander descends through red dust; boots touch the ground | AI (shot 1) | VO: "They told me I was ready." | drone, breathing |
| 0:10-0:14 | Astronaut looks at the horizon, visor reflects the crater | AI (shot 2) | VO: "I trained for years... on Earth." | piano note |
| 0:14-0:19 | Landing leg slides off a steep slope, lander tilts. Stamp: **LANDING - FAILED** | AI (shot 3) | - | braam, metal stress, silence, stamp |
| 0:19-0:24 | Rover wheels dig and spin, rover tips on rough ground. **ROVER - FAILED** | AI (shot 4) | VO: "The slopes were wrong." | braam, wheel grind |
| 0:24-0:30 | Base camp on uneven ground: frame cracks, sparks, fire. **BASE CAMP - FAILED** | AI (shot 5) | VO: "The ground was wrong." | fire roar, alarm |
| 0:30-0:35 | Astronaut slips on a steep walk, oxygen alarm. **EVA - FAILED** | AI (shot 6) | VO: "Everything... was wrong." | ticking speeds up, alarm |
| 0:35-0:39 | Hard cut to silence. Red screen: **SIMULATION ENDED - 4 OF 4 MISSIONS FAILED** | text | - | silence, single beep, sub drop |
| 0:39-0:44 | Astronaut takes off a VR headset in a dark control room, breathing hard | AI (shot 7) | VO: "Because we trained on the wrong ground." | breath |
| 0:44-0:49 | App: space hub, astronaut floating, planets orbiting | **app recording** | VO: "So we asked one question..." | ambient, synth starts |
| 0:49-0:55 | App: Mars globe, pin on Jezero, "Scanning terrain" | **app recording** | VO: "...where on Earth is Mars?" | scan sound |
| 0:55-1:01 | App: warp to Earth, astronaut lands on the #1 window | **app recording** | Text: **1,143,707 places on Earth. Searched in under a second.** | warp, landing thud |
| 1:01-1:08 | App: site dossier - image pair + 3D blocks; then Similar / Different table | **app recording** | VO: "Same slopes. Same relief. Same roughness. And we tell you what is different." | build-up |
| 1:08-1:14 | Training montage on Earth: rover drives a desert that looks like Jezero; crew walks it | AI (shot 8) | VO: "This time, we trained on the right ground." | orchestra rises |
| 1:14-1:20 | Mars again: smooth landing, rover rolls, camp stands, astronaut walks into sunrise | AI (shots 9-10) | VO: "And this time..." (beat) "...we came home." | full theme, choir |
| 1:20-1:26 | **The team**: slow-motion walk / at laptops, then names on screen | **team footage** | Text: team names and roles | theme peak |
| 1:26-1:30 | Logo **ELSEWHERE** + slogan **Exploring other worlds starts with understanding our own.** + "NASA Space Apps 2026 - Cairo". Small text: *Dramatization. ELSEWHERE compares terrain shape on Earth and planetary elevation data; field validation required.* | text | VO (whisper): "Elsewhere... starts here." | whoosh + impact, low note |

## 30-second cut

0:00 SOL 1 text + landing (3 s) - 0:03 four failures, 2 s each with stamps (8 s) - 0:11 "SIMULATION ENDED"
(2 s) - 0:13 app: pin Jezero, warp, landing, dossier (9 s; VO "Where on Earth is Mars?") - 0:22 success
on Mars (4 s; VO "This time, we trained on the right ground.") - 0:26 team + logo + slogan (4 s).

## App screen recording (do this first)

1. Real data mode (backend `DEMO_FIXTURES=false`, frontend `VITE_USE_FIXTURES=false`), good internet;
   pre-pin Jezero once so it loads instantly.
2. Browser full screen, 1920 x 1080, zoom 100%, **Sound on** in the top bar. Record with OBS Studio
   (60 fps) capturing the app audio too.
3. Takes to record (each 2-3 times): hub entrance; click Mars (jump); pick "Rover test drive"; click
   "Jezero crater" (scan); "Search all Earth land" (warp + landing); open the site dossier (Overview,
   Similar / Different); drag the 3D blocks slowly.

## AI video prompts (Runway / Kling / Pika / Veo / Sora - whichever you have)

Keep the same character description in every prompt for consistency:
*"astronaut in a white NASA-style suit with orange details and a gold visor"* (do not add real agency logos).

1. Cinematic wide shot, a small lander descending through swirling red dust over a vast Martian crater at
   dawn, anamorphic lens flare, film grain, slow motion.
2. Close-up of the astronaut's gold visor reflecting a red crater rim, breathing fog inside the helmet,
   tense mood, shallow depth of field.
3. A landing leg slips on a steep rocky Martian slope, the lander tilts dangerously, dust bursts, dramatic
   low angle, slow motion.
4. A six-wheeled rover's wheels dig into soft red sand and spin, the rover tilts on rough boulder ground,
   close tracking shot, dust particles.
5. A small dome habitat on uneven Martian ground, its frame cracks, sparks and a fire inside, alarm lights
   flashing red, night, cinematic.
6. The astronaut slips on a steep Martian hillside, gloved hand grabs a rock, red warning light on the
   suit, handheld camera, tension.
7. Dark mission control room, the astronaut removes a VR headset, sweating, red "simulation failed" glow on
   screens, moody lighting.
8. A rover driving across a rocky Earth desert that looks like Mars, two suited crew walking beside it,
   golden hour, hopeful.
9. A smooth lander touchdown on a flat Martian plain, dust settles, calm, sunrise.
10. The astronaut walks toward the Martian sunrise, the rover and an intact habitat behind, epic wide shot,
    hopeful.

## Editing (free tools: DaVinci Resolve or CapCut)

- Cut on the music beats; 1-2 frames of black before each "FAILED" stamp; letterbox 2.39:1 for the
  cinematic shots, full frame for the app.
- Colour: teal-orange for Mars, cold blue for the control room, warm gold for the success.
- Text: bold condensed font, wide letter spacing like the app wordmark (E L S E W H E R E).
- Export 1080p, H.264; keep the voice clearly above the music (duck music -10 dB under the voice).

## Honesty checklist (judges notice)

- The failures are a dramatization; do not say ELSEWHERE prevents fires or guarantees safety. It finds
  Earth terrain that matches a Moon/Mars site so crews and robots can train on the right ground.
- Do not show "100%" or "probability". Numbers in the trailer must come from the app (e.g. 1,143,707 places).
- Disclose AI-generated video/voice in the submission's AI section; list music licences.
