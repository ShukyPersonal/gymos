# Gymos

My personal gym app. It runs a fixed workout program on my Android phone, tells me what to lift next, times the rest between sets, rings a boxing bell when rest is over and logs every set.

One user (me), one phone (Pixel 10). No server and no subscription. Workouts stay on the phone and are backed up to a Google Sheet.

This file covers why the app exists, what I'm training for and how we got here.

---

## Why I built it

I wanted a coach in my pocket that does four things well:

- **Knows the program.** It shows the next exercise, weight and reps without me thinking about it.
- **Runs my rest.** It counts down and rings a bell I can hear over my music, even with the phone locked in my pocket.
- **Works from the notification.** Most sets I log straight from the notification without opening the app (15 to 22 button presses a workout).
- **Pushes progression.** Double progression: hit the top of the rep range on every set, then add weight.

The gym apps I tried either did too much or couldn't get the rest bell right. Building my own was cheaper than putting up with them.

---

## My gym goals

**Current phase: a cut (Sep 2026).** Keep strength and muscle while losing fat.

- **Two lifting days a week**, Monday and Thursday. Surf class on Friday.
- **About 45 minutes a session.** 26 sets, supersets with short rests.
- **The same seven exercises.** I change sets, order and rest, but I don't add exercises.
- **Keep progressing on the main lifts** even while cutting. Volume follows Dr. Mike Israetel / RP guidance: roughly 10 to 11 hard sets per muscle per session at most.
- **Look after the surf.** Paddling works lats, triceps, rear and side delts and traps. So the Thursday session puts legs first and leaves the upper body fresher for Friday.

<!-- Add your own: target weight / body fat, lifts you want to hit, a date. -->

### Where the lifts stand (last logged, mid Sep 2026)

| Exercise | Last logged | Rep range | Notes |
|---|---|---|---|
| Incline Bench Press 30° | 28 kg × 10 | 6–10 | At the top of the range. Due to go to 30 kg |
| Assisted Pull-ups | 14 kg assist × 10 | 8–12 | Less assist = harder. Machine steps are 7 kg |
| Lateral Raises | 12 kg × 12 | 12–15 | |
| Incline Chest Flyes 30° | 18 kg × 10 | 10–12 | |
| Hammer Curls (60° incline) | 16 kg × 10 | 8–12 | |
| Dragon Flag | bodyweight × 15 | 6–10 | Past the range. No weight to add, needs a harder variation |
| Walking Lunges | 10 kg × 14 | 10 per leg | Due to go to 12 kg |

Weights are per dumbbell. These numbers stayed the same from late July to mid September. The app pre-fills the last values, and "Log same" logs them, so the "add weight" suggestion never made it into the notification I actually train from. Worth fixing so the app really pushes progression.

---

## The program

Both days use the same four blocks and the same set counts. Only the order changes. The full definition is in [program.json](program.json).

| Block | Exercises | Sets | Rest |
|---|---|---|---|
| Push/Pull (superset) | Assisted Pull-ups, Incline Bench 30° | 5 + 4 | 45 s |
| Chest/Shoulders (superset) | Lateral Raises, Incline Flyes 30° | 4 + 3 | 30 s |
| Biceps/Abs (superset) | Hammer Curls, Dragon Flag | 4 + 3 | 30 s |
| Legs | Walking Lunges | 3 | 90 s |

- **Day A (Monday), upper body first:** Push/Pull → Chest/Shoulders → Biceps/Abs → Legs
- **Day B (Thursday), legs first:** Legs → Biceps/Abs → Push/Pull → Chest/Shoulders

The app picks the day by itself. The first workout of the week follows the weekday (Mon–Wed = A, Thu–Sun = B) and the next one gets the other day. A pill on the home screen lets me switch.

---

## History

| When | What happened |
|---|---|
| May 2026 | Project started. React Native / Expo app with the first program: 4 blocks, 7 exercises, 3 sessions a week. Workouts sync to Google Sheets. |
| Jun 2026 | Fought the rest bell. It played on the notification channel and was inaudible under Spotify. Moved the sound to the media stream so it ducks the music instead. Rebuilt bell scheduling on exact alarms so it fires with the screen locked. |
| Jul 23 | **v1.2.0.** A foreground service keeps the app alive, so the bell plays in the background. First clean session: 21 of 21 bells. |
| Late Jul | The app kept dying mid-workout, 5 to 6 fragments per session. Added crash forensics that read Android's own reason for killing the process. **Root cause (Jul 30):** the notification library ran the service as a "short service", which Android kills after about 3 minutes. |
| Aug 2 | The app got stuck on "Loading…" for 3 days. A rollback fixed it. Afterwards added a boot guard (auto-revert after 3 failed boots), a startup watchdog and a pre-release smoke test on an emulator. |
| Aug 3 | **v1.4.0.** Big discovery: cloud builds regenerate the Android manifest and threw away every manual native fix. Local builds kept them, so for months the phone ran different code from the emulator. Native changes now go through Expo config plugins only. |
| Aug 9 | **v1.4.0 confirmed in the gym.** One continuous 36-minute session, 21/21 bells, zero crashes. |
| Aug 13–18 | Notification buttons log a set without opening the app. Live rest countdown inside the notification. The last set gets a "Log & finish" button. |
| Aug 20 | **v1.6.0.** Built our own native notification and service. Pressing "Log same" no longer closes the notification shade. |
| Aug 23 | **v1.6.1.** Fixed the final-set button (the press was silently dropped). Fixed the two countdowns disagreeing by 1 second and the bell ringing up to half a second early. |
| Sep 1–10 | 5 workouts, each one clean continuous session. Bell timing confirmed. |
| Sep 15 | **Day A/B program.** Down from 3 to 2 lifting days a week with more sets per session, built around Friday surf. |
| Sep 25 | Pushed to GitHub as a private repo. |

### Lessons that cost weeks

1. **Measure what the user sees. Don't infer it.** Three wrong diagnoses shipped because a log line or API seemed to prove something. For example, "the app opens" turned out to be a transparent helper screen flashing past.
2. **A test that can't fail for the reason that matters is worse than no test.** One unit test checked a value I had written into my own mock.
3. **Test on the Android version the phone actually runs.** The Android 14 emulator hid every background-execution and service-type bug the phone hit.
4. **The emulator writes to the real Google Sheet.** Clear the app's data before testing.

---

## Open items

- **Progression isn't reaching me.** See the lift table above. The "add weight" suggestion should pre-fill or show in the notification.
- **Final-set button** is fixed but still hasn't been confirmed in a real workout.
- **Duplicate rows in the Workouts sheet.** Sessions since Aug 22 were uploaded 2 to 4 times, probably from overlapping syncs. Fix: make sync run one at a time and merge before writing.
- **11 fake test rows** dated 13/08/2026 at the bottom of the Workouts sheet need deleting by hand.
- YouTube Music pauses for about 3 seconds during the bell instead of lowering its volume. That's YouTube's own behaviour and probably can't be fixed. Spotify is fine.

---

## Tech in one paragraph

React Native with Expo, built for Android through EAS. JavaScript-only changes ship over the air. Native changes need a new APK. A custom native module ([modules/gymos-widget](modules/gymos-widget)) runs the workout notification and the foreground service. Data lives in AsyncStorage and syncs to Google Sheets through an Apps Script webhook ([sheets-script.gs](sheets-script.gs)). Session logs upload to a separate sheet for debugging.

---

## Run it yourself

1. Run `npm install`.
2. Deploy `sheets-script.gs` as an Apps Script web app, and put your spreadsheet ID in it.
3. Create `.env` with `EXPO_PUBLIC_SHEETS_WEBHOOK=...` and `EXPO_PUBLIC_LOGS_WEBHOOK=...` (the web app URLs).
4. Put your own Expo account and EAS project ID in `app.json`.
5. Run `npm test`, then build with `npx eas-cli build -p android`.

Built with Claude Code.
