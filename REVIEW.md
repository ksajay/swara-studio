# Swara Studio: critical review

Date: 17 October 2026. Scope: the curriculum, the app's design, and the code.

## Verdict

The foundations are right: relative pitch first (which is how Indian music already works, with a movable Sa), real-time visual pitch feedback (the one feedback type that showed a significant training effect in Berglin et al. 2022), honest framing of absolute pitch as a side quest, and spaced repetition with measurable gates. The first build process was not: the app was built before the platform limits were checked, and tests came after the code. Retro-fitting tests found five real defects in the most important part, the repetition and progress logic.

## Process mistakes

1. **No spike on platform limits.** I designed live microphone feedback before confirming that Claude artifacts cannot use the microphone. That forced the PWA pivot. A 10-minute spike should come before any design.
2. **Tests after code.** The scheduling rules lived inline in the page, untestable. They are now a pure module (`assets/srs.js`) with a spec (`tests/srs.test.js`). From here on, every change starts with a failing test.
3. **My own spec was wrong once.** The first fix for retry-inflated accuracy counted only one answer per card per session, which would have made unlocking Ga take about ten sessions. The end-to-end test exposed it; the spec was corrected before the code.

## Defects found and fixed (each now has a test)

| # | Defect | Impact | Fix |
|---|---|---|---|
| 1 | Answering a card right before it was due still moved it up a box | Spacing silently collapsed: cards could reach 14-day gaps in one sitting | Only due cards are promoted; early right answers count as practice |
| 2 | Re-asks after a miss counted toward the 85% unlock rule | New notes unlocked before they were known | The re-ask is flagged and excluded |
| 3 | The review queue could put the same note twice in a row | Weaker interleaving, easier guessing | Arrangement checks the rest of the queue can still avoid repeats (tested over 50 random runs) |
| 4 | Phone and Claude copies overwrote each other ("newest wins") | Practice on one device could erase the other | Per-card merge: each card keeps its latest review, logs keep the best counts |
| 5 | Restoring a backup replaced all progress | Same risk as 4 | Restore now merges |
| 6 | The browser was free to evict saved progress | Silent loss on a full phone | Requests persistent storage |
| 7 | Date maths used local-time `setDate` | Edge cases around month ends | Calendar maths in UTC, tested across months, years and leap days |

## Drone review (17 October)

- **Tuning order was right:** low Pa, Sa, Sa, low Sa is the standard tanpura tuning.
- **Pitch was unmeasured.** Now tested from the rendered sound: every string within 0.26 cents at 0.4, 1, 2 and 3 seconds into a pluck. Low Pa is a pure 3:2 fifth (2 cents above equal temperament), as a tanpura tuned by ear would be.
- **The old sound was not tanpura-like:** detuned sawtooth plucks with an instant attack and a 3-second fade. Replaced with a plucked-string model plus a downward-sweeping overtone band (imitating the jawari bridge's bright burst whose brightness falls), a 0.12 s swell, and long sustain, all specified by tests (swell, falling spectral centroid, sustain at 3 s).
- **Added:** first string selectable as low Ma (ragas without Pa) or low Ni (Marva, Puriya), saved with progress.
- **Still synthetic.** A real recorded tanpura is the gold standard. If you have a recording you are free to use, it can replace the model, with the same pitch tests applied.

## Open gaps, ranked

1. **Drone bleed can fake progress (high).** Without earphones, the microphone can hear the drone's Sa and score "Hold Sa" as a hit. Next fix: a "No earphones" mode that plays the reference, then stops the drone while you sing; and a test with drone audio fed into the mic.
2. **Fixed: one synthetic timbre.** Ear rounds now rotate piano, harmonium and plucked string, evenly and in a fresh order each round (tests: `planTimbres`, plucked-string tuning, piano partials, and an end-to-end check that a round uses three sounds). Piano leads because note naming is most accurate with piano and worst with pure tones (Miyazaki 1989).
2a. **Singing reference should be your own voice (high, next).** For pitch matching, people sing closer to a human voice than to piano (Nichols 2020: about 53 vs 80 cents off on single pitches), poor singers do significantly better with a human model than a synthetic one (Journal of Voice 2012), and matching one's own recorded voice beats a synthesized voice (Hutchins & Peretz). A fake synthesized voice would be worse, so the plan is: record your Sa once, then use it, pitch-shifted, as the reference for Hold Sa and sing reviews. Harmonium stays as the fallback.
3. **Ear questions always rise from Sa within one octave (medium).** A learner can answer by "how far up" rather than by the swara's character. Add low and high octave placements, and drone-context questions instead of Sa-then-note.
4. **Single-note singing only (medium).** The visual-feedback study found the biggest gains on four-note melodies. Add short phrase reviews (Sa Re Ga Re Sa) scored note by note.
5. **Reading deck missing (medium).** Stage 4 promises an automatic reading gate; nothing exists yet. Build it test-first when you reach Stage 3.
6. **Side quest lacks time pressure (low).** The 2025 study shortened response windows as learners improved. Add a shrinking timer.
7. **Equal temperament only (low, by design).** Indian intonation is not equal-tempered and some ragas bend notes. Fine for a beginner; a teacher covers raga intonation later.
8. **Untested on real voices.** All pitch tests use synthetic tones. Record five short clips of yourself (Sa, Pa, a slide, breathy "aa", a wobbly note) and add them as test fixtures: the most valuable next test you can write.
9. **Two homes for progress.** The phone app is the daily driver; the Claude copy is where I can read progress directly. Today that bridge is copy and paste (Progress → Backup). Acceptable for monthly check-ins.

## Suggested next TDD iterations

1. Your own voice as the singing reference: record Sa once, then shift it to each target (tests: shift ratio per swara, stored clip survives reload, sing reviews play it).
2. "No earphones" mode: failing e2e test where the mic hears only the drone and Hold Sa must not score.
3. Octave variety in ear questions (low and high placements).
4. Real-voice fixtures: your five recordings, each with an expected swara track.
