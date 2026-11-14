# One-minute demo script (v2.0 + discovery mode)

Run on real data (`/api/health`: `data_ready=true`, `discovery_ready=true`, no DEMO banner). If anything is
demo data, say so on screen and in words. Never present demo numbers as findings.

Setup: backend `DEMO_FIXTURES=false` on :8000; frontend `npm run build && npm run preview` (or dev with
`VITE_USE_FIXTURES=false`). Full screen, zoom 100 %. Backup video ready. Pre-click Jezero once so the MOLA
range-read is cached (first Mars pin can take up to ~20 s).

| Time | Screen | Say (adapt, keep the facts) | Do |
|---|---|---|---|
| 0:00-0:06 | Intro | "**Exploring other worlds starts with understanding our own.** Before we explore the Moon and Mars, where on Earth can we prepare?" | **Find our next training ground** |
| 0:06-0:18 | Mission: 3D Mars | "This is Mars from NASA MOLA. I can pin any place. Here, Jezero crater. Before searching Earth, we measure its 20 km of terrain: slope classes, relief, local height variation, all at 1 km." | Click **Jezero crater** (or the globe), point at the fingerprint |
| 0:18-0:28 | Candidates | "Now we search **all Earth land** between 56°S and 60°N with NASA SRTMGL30 - 1.14 million 20 km windows. No trained model: one fixed, explainable distance. These are the closest windows, at least 100 km apart." | **Search all Earth land**; click card #1; globe flies to its square |
| 0:28-0:36 | Discovery | "This one is not in our list of well-known analog sites. That is not a discovery claim - it is a lead worth checking." | Point at the label; optionally tick **Hide well-known analog sites** |
| 0:36-0:46 | Tradeoffs | "Why this one and not the alternative? Each bar is weight x distance on a shared scale." Then move slope priority and state the REAL outcome (changed / stayed). | **Compare tradeoffs**, drag slider |
| 0:46-0:57 | Decision | "Confirming gives a reproducible brief with sources and what terrain can't tell us: soil, temperature, ice, gravity, radiation." | **Go to decision**, **Confirm my choice** |
| 0:57-1:00 | Close | "A terrain lead to investigate, not a field-validated site." | - |

## Moon variant

Switch to **Moon**, pin **South pole sector** (LOLA 80 m near the pole) or **Apollo 15 (Hadley Rille)**.
Say the south-pole sector is a prototype comparison sector, not an officially selected base location.

## Curated variant (30 m data)

Choose **3 curated regions (30 m SRTM)** to show the original high-resolution corpus (Khaybar, Pinacate,
Death Valley) with the vetted references.

## If something fails live

| Failure | Say | Do |
|---|---|---|
| Planet imagery missing | "Imagery service is down; the measurement is unaffected." | use the named-place buttons |
| Mars pin slow | "We're range-reading the NASA MOLA file for this spot." | wait, or use a cached place |
| Chat unavailable | "The assistant is offline; the decision brief is deterministic." | skip chat |
| Backend down | "Switching to our recorded run." | play backup video |
