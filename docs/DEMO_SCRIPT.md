# One-minute demo script (v2.0)

Run on the **real corpus** (`data_ready=true`, no DEMO banner). If the real corpus is not ready, say so
on screen and in words: "This run uses labeled demo data." Never present demo numbers as findings.

Setup: backend `DEMO_FIXTURES=false` on :8000; frontend production preview (`npm run build && npm run preview`)
or dev with `VITE_USE_FIXTURES=false`. Browser full screen, zoom 100 %. Have the backup video ready.

| Time | Screen | Say (adapt, keep the facts) | Do |
|---|---|---|---|
| 0:00-0:07 | Intro | "**Exploring other worlds starts with understanding our own.** Before we explore the Moon and Mars, where on Earth can we prepare?" | Let the sentence show, click **Find our next training ground** |
| 0:07-0:15 | Mission | "We pick a 20 km reference on Mars, near Jezero, measured from NASA MOLA elevation, and what matters for the mission." | Choose **Mars**, keep **General terrain**, click **Search Earth windows** |
| 0:15-0:25 | Candidates | "We searched 243 planned 20 km windows in three Earth regions at a 1 km grid. These are the closest available windows, at least 20 km apart - a window, not a whole desert." | Point at the scope line, click card #1, let the globe fly to its square |
| 0:25-0:38 | Tradeoffs | "Why this one and not the alternative? Each bar is weight times distance on a shared scale. Here the selected window is closer on <metric>, the alternative on <metric>." | Read the real explanation lines from the screen |
| 0:38-0:46 | Slider | "If slope matters more, we move slope priority. The server recomputes the whole corpus." Then say what actually happened: "the top result changed to X" **or** "the top result stayed the same - that is an honest result." | Drag slider to ~0.7, wait for the recompute message |
| 0:46-0:57 | Decision | "Confirming creates a reproducible decision brief: settings, evidence, sources, and what terrain data cannot tell us - soil, temperature, ice, gravity, radiation." | **Go to decision**, **Confirm my choice**, scroll to limitations and sources |
| 0:57-1:00 | Close | "A terrain analog to test with, not a field-validated site." | - |

## Moon variant

Same flow with **Moon** at Mission: "a 20 km sector near the lunar south pole from NASA LOLA (Barker et al. 2023)."
Prefer **Slope focus** to show the slope-priority story. Say clearly that this is a prototype comparison
sector, not an officially selected base location.

## If something fails live

| Failure | Say | Do |
|---|---|---|
| Map imagery missing | "The imagery service is down; the evidence is unaffected." | continue with cards |
| Chat unavailable | "The explanation assistant is offline; the decision brief is deterministic and still works." | skip chat |
| Backend down | "Switching to our recorded run." | play backup video |

## Optional 15 s chat beat (only if time and key work)

Click **Explain this choice** -> "What can't we infer from terrain data?" -> show that it admits missing dimensions.
