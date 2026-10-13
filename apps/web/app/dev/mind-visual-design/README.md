# Mind visual workspace fixture

Local-only visual verification of the actual `MindTodayWorkspace`, `MindClientOverview`, and
`RecordConfirmStrip` components. This is not an authenticated or production journey.

## Safety boundary

- The route returns not-found unless both `NODE_ENV=development` and `MIND_WORKSPACE_PREVIEW=true`.
- Every person, score, plan, booking and note in this directory is fictional.
- Before mounting production presentation components, the fixture replaces `fetch` with a memory-only,
  no-passthrough transport. Only preparation-focus acknowledgements are simulated; other mutations fail closed.
- Microphone, camera and display capture are denied. No real consent, recording, AI generation, note signing,
  account change or database write takes place.
- Normal links are intercepted within the fixture. The three approved screens stay connected; other links
  explain the boundary instead of opening a patient record. Refresh resets fixture state.
- The browser checker separately rejects actual API, auth, external and out-of-fixture navigation requests.

## Visual direction

This harness adds only a fictional-data banner and screen navigation. All application styling comes from
the real components: Fraunces headings, Inter clinical copy, paper `#F8F8F4`, ink `#302B45`, purple
`#6753AD`, lilac `#EAE5F4`, sage `#719386`, and sand `#E7DAC2`. The consultation-room illustration belongs
on Today; recorded care and preparation remain quieter, source-labelled working surfaces.

## Run locally

Start the web development server with `MIND_WORKSPACE_PREVIEW=true`, then open
`/dev/mind-visual-design`. Use `#today`, `#client`, or `#prepare` for the initial screen.

From the repository root:

```sh
MIND_VISUAL_BASE_URL=http://127.0.0.1:4180 node scripts/mind-visual-design-check.mjs
```

The runner requires the repository's existing Puppeteer dependency. `MIND_VISUAL_OUTPUT_DIR` optionally
changes the screenshot/report output directory; by default it uses the operating system temporary directory.
Only localhost targets are accepted.

Checks cover the connected Today → client → exact booked visit route, all three screens at 1440/900/390/320px,
horizontal overflow, and dirty/pending focus start guards. Microphone, API and browser-storage assertions
verify the fixture boundary. Real accounts, production persistence, browsers other than the installed Chrome,
full accessibility compliance and clinical correctness are outside this visual check.
