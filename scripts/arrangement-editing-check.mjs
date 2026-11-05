#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { createServer } from "vite";
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (error) {
  if (!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) throw error;
  ({ chromium } = require(
    path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, "playwright"),
  ));
}
const output =
  process.env.ARRANGEMENT_EDITING_OUTPUT || ".evidence/editing-core/browser";
await fs.mkdir(output, { recursive: true });
const server = await createServer({
  server: { host: "127.0.0.1", port: 0, watch: null, hmr: false },
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(20000);
const report = { browser: browser.version(), steps: [], errors: [] };
page.on("pageerror", (e) => report.errors.push(e.message));
const read = () =>
  page.evaluate(async () => {
    const { projectQueueService: q } =
      await import("/src/services/projectQueueService.ts");
    const { studioCommandBus: b } = await import("/src/services/commandBus.ts");
    const id = q.getActiveQueueId();
    return {
      project: q.getItem(id)?.workingProjectState,
      depth: b.getHistory(id).length,
    };
  });
async function stage(name) {
  report.steps.push(name);
  console.log(name);
  await fs.writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
}
try {
  await page.goto(`${origin}/tests/recovery-browser.html`);
  const fixture = await page.evaluate(async () => {
    const { buildStarterAbletonXml, parseAlsXmlString } =
      await import("/src/engine/alsXmlEngine.ts");
    const { encodeProjectSnapshot } =
      await import("/src/services/projectSnapshotService.ts");
    const {
      DEFAULT_HUMANIZATION: h,
      DEFAULT_MASTER_BUS: m,
      DEFAULT_TRANSPORT: t,
    } = await import("/src/engine/projectDefaults.ts");
    const p = parseAlsXmlString(
      buildStarterAbletonXml("berghain-134", 777, 1).xml,
    );
    p.fileName = "Editing_Core";
    p.tempo = 120;
    p.arrangementLengthBars = 8;
    p.tracks = p.tracks.slice(0, 2);
    const note = (id, time, pitch, duration = 0.5) => ({
      id,
      time,
      quantizedTime: time,
      pitch,
      duration,
      velocity: 85,
      isGhost: false,
      probability: 1,
    });
    p.tracks.forEach((track, i) => {
      track.devices = [];
      track.locked = false;
      track.muted = false;
      track.soloed = false;
      track.archetype = i ? "pad" : "synth";
      track.name = i ? "Layer B" : "Layer A";
      track.mixer = {
        ...track.mixer,
        reverbSend: 0,
        delaySend: 0,
        sidechainDepth: 0,
      };
      track.sessionClips = [];
      track.automationPoints = [];
    });
    p.tracks[0].clips = [
      {
        id: "early",
        name: "Early phrase",
        startTime: 0,
        length: 12,
        endTime: 12,
        notes: [
          note("shared-note", 1, 60),
          note("crossing", 3, 62, 6),
          note("middle", 5, 64),
          note("ending", 9, 65),
        ],
      },
      {
        id: "later",
        name: "Later phrase",
        startTime: 12,
        length: 4,
        endTime: 16,
        notes: [note("shared-note", 13, 67)],
      },
    ];
    p.tracks[1].clips = [
      {
        id: "other",
        name: "Other layer",
        startTime: 0,
        length: 8,
        endTime: 8,
        notes: [note("shared-note", 0.5, 48)],
      },
    ];
    p.audioSettings = {
      humanization: h,
      masterBus: m,
      transport: {
        ...t,
        followPlayhead: false,
        showAutomationLanes: false,
        loopEnabled: false,
        loopLengthBars: 8,
      },
    };
    return encodeProjectSnapshot(p, h, m, p.audioSettings.transport);
  });
  await page.goto(origin);
  await page
    .getByLabel("Open saved DAW project", { exact: true })
    .setInputFiles({
      name: "Editing_Core.aidaw.json",
      mimeType: "application/json",
      buffer: Buffer.from(fixture),
    });
  await page
    .getByText(/^Opened Editing_Core/)
    .filter({ visible: true })
    .waitFor();
  await stage("Opened canonical two-layer fixture");
  const baseline = await read(),
    other = baseline.project.tracks[1];
  const trackId = baseline.project.tracks[0].id;
  await page.getByText("Clip & Note Editor", { exact: false }).click();
  await page
    .getByLabel("Selected arrangement clip", { exact: true })
    .selectOption("later");
  await page.getByLabel("Note start beat", { exact: true }).fill("13.5");
  await page.getByLabel("Note MIDI pitch", { exact: true }).fill("69");
  await page.getByLabel("Note velocity", { exact: true }).fill("77");
  await page
    .getByRole("button", { name: "Apply note edit", exact: true })
    .click();
  let current = await read();
  let later = current.project.tracks[0].clips.find((c) => c.id === "later");
  assert.equal(later.notes[0].time, 13.5);
  assert.equal(later.notes[0].pitch, 69);
  assert.equal(later.notes[0].velocity, 77);
  assert.deepEqual(
    current.project.tracks[0].clips[0],
    baseline.project.tracks[0].clips[0],
  );
  assert.deepEqual(current.project.tracks[1], other);
  assert.equal(current.depth, baseline.depth + 1);
  await stage("Edited the selected later clip, preserving other clips/layers");
  await page.getByLabel("Clip start beat", { exact: true }).fill("14.125");
  await page
    .getByRole("button", { name: "Apply clip edit", exact: true })
    .click();
  current = await read();
  later = current.project.tracks[0].clips.find((c) => c.id === "later");
  assert.equal(later.startTime, 14.125);
  assert.equal(later.notes[0].time, 15.625);
  await stage("Moved a clip and its notes by an exact fractional beat");
  await page
    .getByRole("button", { name: "Duplicate selected clip", exact: true })
    .click();
  current = await read();
  assert(
    current.project.tracks[0].clips.some(
      (c) => c.id !== "later" && c.startTime === 18.125,
    ),
  );
  await stage("Duplicated selected clip through canonical history");
  await page.getByTestId("clip-actions").locator("summary").click();
  await page.getByTestId("bar-range-start-input").fill("2");
  await page.getByTestId("bar-range-end-input").fill("3");
  await page.getByTestId("range-delete-clip-btn").click();
  current = await read();
  const clips = current.project.tracks[0].clips;
  assert(clips.some((c) => c.startTime === 0 && c.length === 4));
  assert(clips.some((c) => c.startTime === 8 && c.length === 4));
  assert(!clips.flatMap((c) => c.notes).some((n) => n.id === "middle"));
  assert(
    clips
      .flatMap((c) => c.notes)
      .some((n) => n.id === "ending" && n.time === 9),
  );
  assert(
    clips.some(
      (c) =>
        c.startTime === 8 &&
        c.notes.some((n) => n.time === 8 && n.duration === 1),
    ),
  );
  assert.deepEqual(current.project.tracks[1], other);
  await stage(
    "Deleted only bars 2–3, retaining prefix/suffix and sustained continuation",
  );

  const prefixId = clips.find((c) => c.startTime === 0).id;
  await page
    .getByLabel("Selected arrangement clip", { exact: true })
    .selectOption(prefixId);
  const piano = page.getByTestId("midi-piano-roll");
  async function point(time, pitch, offset = 2) {
    for (let attempt = 0; attempt < 8; attempt++) {
      await piano.locator("..").scrollIntoViewIfNeeded();
      const dims = await piano.evaluate(
        async (el, { time, pitch, offset }) => {
          const { projectQueueService: q } =
            await import("/src/services/projectQueueService.ts");
          const { pianoPitchRows } =
            await import("/src/engine/arrangementEditing.ts");
          const rows = pianoPitchRows(
            q.getItem(q.getActiveQueueId()).workingProjectState.tracks[0],
          );
          const r = el.getBoundingClientRect(),
            v = el.parentElement.getBoundingClientRect(),
            row = (r.height - 54) / rows.length;
          return {
            x: r.x + 58 + (time / 8) * (r.width - 58) + offset,
            y: r.y + rows.indexOf(pitch) * row + row / 2,
            row,
            ppb: (r.width - 58) / 8,
            top: v.top,
            bottom: Math.min(v.bottom, window.innerHeight),
          };
        },
        { time, pitch, offset },
      );
      if (dims.y > dims.top + 8 && dims.y < dims.bottom - 8) return dims;
      await page
        .getByRole("button", {
          name: dims.y >= dims.bottom ? "Lower keys" : "Higher keys",
          exact: true,
        })
        .click();
    }
    throw new Error("Piano note is not reachable through register scroll");
  }
  let before = await read();
  let pt = await point(1, 60);
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await page.mouse.move(pt.x + 0.5 * pt.ppb, pt.y - pt.row, { steps: 6 });
  await page.mouse.up();
  current = await read();
  let note = current.project.tracks[0].clips
    .find((c) => c.id === prefixId)
    .notes.find((n) => n.id === "shared-note");
  assert.equal(note.time, 1.5);
  assert.equal(note.pitch, 61);
  assert.equal(current.depth, before.depth + 1);
  assert.deepEqual(current.project.tracks[1], other);
  pt = await point(2, 61, -2);
  before = current;
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await page.mouse.move(pt.x + 0.25 * pt.ppb, pt.y, { steps: 6 });
  await page.mouse.up();
  current = await read();
  note = current.project.tracks[0].clips
    .find((c) => c.id === prefixId)
    .notes.find((n) => n.id === "shared-note");
  assert.equal(note.duration, 0.75);
  assert.equal(current.depth, before.depth + 1);
  pt = await point(1.5, 61);
  before = current;
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await page.mouse.move(pt.x + 0.5 * pt.ppb, pt.y, { steps: 6 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  current = await read();
  assert.deepEqual(current.project.tracks, before.project.tracks);
  assert.equal(current.depth, before.depth);
  await stage(
    "Dragged and resized the selected note; Escape cancelled without a history entry",
  );
  const arrangement = page.getByTestId("arrangement-clips-canvas");
  await arrangement.scrollIntoViewIfNeeded();
  let box = await arrangement.boundingBox();
  const ppb = box.width / 32,
    x = box.x + 2 * ppb,
    y = box.y + 68;
  before = await read();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 0.5 * ppb, y, { steps: 6 });
  await page.mouse.up();
  current = await read();
  assert.equal(
    current.project.tracks[0].clips.find((c) => c.id === prefixId).startTime,
    0.5,
  );
  assert.equal(current.depth, before.depth + 1);
  assert.deepEqual(current.project.tracks[1], other);
  box = await arrangement.boundingBox();
  const edge = box.x + 4.5 * ppb - 2;
  await page.mouse.move(edge, y);
  await page.mouse.down();
  await page.mouse.move(edge + 0.5 * ppb, y, { steps: 6 });
  await page.mouse.up();
  current = await read();
  assert.equal(
    current.project.tracks[0].clips.find((c) => c.id === prefixId).length,
    4.5,
  );
  const resized = structuredClone(current.project.tracks);
  await page.keyboard.press("Control+z");
  assert.equal(
    (await read()).project.tracks[0].clips.find((c) => c.id === prefixId)
      .length,
    4,
  );
  await page.keyboard.press("Control+Shift+z");
  assert.deepEqual((await read()).project.tracks, resized);
  await stage(
    "Moved/resized the selected arrangement clip and verified undo/redo",
  );
  await page.getByRole("button", { name: "File", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: /Save Project/ }).click();
  const download = await pending;
  const saved = path.join(output, "edited.aidaw.json");
  await download.saveAs(saved);
  const expected = (await read()).project;
  await page
    .getByLabel("Open saved DAW project", { exact: true })
    .setInputFiles(saved);
  await page
    .getByText(/^Opened .*aidaw\.json\./)
    .filter({ visible: true })
    .waitFor();
  assert.deepEqual((await read()).project.tracks, expected.tracks);
  await stage("Saved and reopened exact edited layer state");

  // Opening a project remounts its workspace. Reveal the editor through the
  // actual menu, rather than depending on a previous details element staying open.
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByRole("button", { name: "Clip editor", exact: true }).click();
  await page
    .getByLabel("Selected arrangement clip", { exact: true })
    .selectOption("later");
  assert.equal(
    await page
      .getByLabel("Protect clip during phrase regeneration", { exact: true })
      .isChecked(),
    true,
  );
  const beforeRegenerate = await read();
  await page.getByTestId("clip-actions").locator("summary").click();
  await page.getByTestId("bar-range-start-input").fill("4");
  await page.getByTestId("bar-range-end-input").fill("7");
  await page.getByTestId("range-generate-chord-clip-btn").click();
  const scoped = await read();
  for (const protectedClip of beforeRegenerate.project.tracks[0].clips.filter(
    (c) => c.userEdited,
  ))
    assert.deepEqual(
      scoped.project.tracks[0].clips.find((c) => c.id === protectedClip.id),
      protectedClip,
    );
  assert.deepEqual(
    scoped.project.tracks[1],
    beforeRegenerate.project.tracks[1],
  );
  await page.keyboard.press("Control+z");
  assert.deepEqual(
    (await read()).project.tracks,
    beforeRegenerate.project.tracks,
  );
  await stage(
    "Regenerated a selected phrase without overwriting protected edits or the other layer, then undid it",
  );
  let downloaded = page.waitForEvent("download");
  downloaded.catch(() => {});
  await page.getByTestId("export-clip-to-midi-btn").click();
  let exportFile = await downloaded;
  const midiPath = path.join(output, "selected-later.mid");
  await exportFile.saveAs(midiPath);
  const midi = await fs.readFile(midiPath);
  assert.equal(midi.subarray(0, 4).toString(), "MThd");
  assert(
    midi.includes(Buffer.from("Later phrase")),
    "MIDI export ignored selected later clip",
  );
  await page.getByRole("button", { name: "File", exact: true }).click();
  downloaded = page.waitForEvent("download");
  downloaded.catch(() => {});
  await page
    .getByRole("button", { name: /Export Ableton Live 12 \(\.ALS\)/ })
    .click();
  exportFile = await downloaded;
  const alsPath = path.join(output, "edited.als");
  await exportFile.saveAs(alsPath);
  const xml = gunzipSync(await fs.readFile(alsPath)).toString("utf8");
  const reimport = await page.evaluate(async (xml) => {
    const { parseAlsXmlString } = await import("/src/engine/alsXmlEngine.ts");
    return parseAlsXmlString(xml);
  }, xml);
  const noteProjection = (p) =>
    p.tracks.map((t) =>
      t.clips
        .toSorted(
          (a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id),
        )
        .map((c) => ({
          id: c.id,
          start: c.startTime,
          length: c.length,
          userEdited: c.userEdited,
          notes: c.notes.map((n) => [
            n.id,
            n.time,
            n.duration,
            n.pitch,
            n.velocity,
          ]),
        })),
    );
  assert.deepEqual(
    noteProjection(reimport),
    noteProjection((await read()).project),
  );
  await page.getByRole("button", { name: "File", exact: true }).click();
  downloaded = page.waitForEvent("download", { timeout: 90000 });
  await page
    .getByRole("button", {
      name: /Master Export WAV \(24-bit PCM\)/,
    })
    .click();
  exportFile = await downloaded;
  const wavPath = path.join(output, "edited.wav");
  await exportFile.saveAs(wavPath);
  const wav = await fs.readFile(wavPath);
  assert.equal(wav.subarray(0, 4).toString(), "RIFF");
  assert(wav.length > 44100 * 6 * 16, "Full edited score WAV was truncated");
  await stage(
    "Exported selected later MIDI, reimported edited ALS and rendered complete WAV",
  );
  const beforeChain = await read();
  await page.getByTestId("bar-range-start-input").fill("4");
  await page.getByTestId("bar-range-end-input").fill("7");
  await page.getByTestId("range-consolidate-clip-btn").click();
  let chain = await read();
  const merged = chain.project.tracks[0].clips.find(
    (c) => c.startTime === 12 && c.length === 12,
  );
  assert(merged, "Consolidated selection missing");
  await page
    .getByLabel("Selected arrangement clip", { exact: true })
    .selectOption(merged.id);
  await page
    .getByRole("button", { name: "Duplicate selected clip", exact: true })
    .click();
  chain = await read();
  assert(
    chain.project.tracks[0].clips.some(
      (c) => c.startTime === 24 && c.length === 12,
    ),
    "Consolidated clip could not be duplicated",
  );
  await page.getByLabel("Split clip beat", { exact: true }).fill("30");
  await page
    .getByRole("button", { name: "Split selected clip", exact: true })
    .click();
  chain = await read();
  assert(
    chain.project.tracks[0].clips.some(
      (c) => c.startTime === 30 && c.length === 6,
    ),
    "Consolidated copy could not be split",
  );
  assert.deepEqual(chain.project.tracks[1], beforeChain.project.tracks[1]);
  for (let i = 0; i < 3; i++) await page.keyboard.press("Control+z");
  assert.deepEqual((await read()).project.tracks, beforeChain.project.tracks);
  await stage(
    "Consolidated a range, duplicated and split its result, then undid all three operations",
  );
  for (const viewport of [
    { width: 360, height: 640 },
    { width: 900, height: 720 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    if (viewport.width < 900) {
      const close = page.getByTitle("Close Left Dock", { exact: true });
      if (await close.isVisible()) await close.click();
      await page.getByRole("button", {name:"View",exact:true}).click();
      await page.getByRole("button", {name:"Track list",exact:true}).click();
      assert.equal(await close.isVisible(), true);
      await close.click();
    }
    await page
      .getByRole("button", { name: "Apply note edit", exact: true })
      .scrollIntoViewIfNeeded();
    const box = await page
      .getByRole("button", { name: "Apply note edit", exact: true })
      .boundingBox();
    assert(box && box.x >= 0 && box.x + box.width <= viewport.width + 1);
    const beforeClick = await read();
    await page
      .getByRole("button", { name: "Apply note edit", exact: true })
      .click();
    assert.equal(
      (await read()).depth,
      beforeClick.depth + 1,
      "Responsive edit must be clickable and commit one transaction",
    );
    await page.screenshot({
      path: path.join(output, `editor-${viewport.width}.png`),
    });
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  const liveFixture = await page.evaluate(async (snapshot) => {
    const { encodeProjectSnapshot } =
      await import("/src/services/projectSnapshotService.ts");
    const p = JSON.parse(snapshot).project;
    p.fileName = "Live_Editing";
    p.audioSettings.masterBus.masterAutomationPoints = [];
    p.tracks.forEach((t, i) => {
      t.archetype = "pad";
      t.clips = [
        {
          ...t.clips[0],
          id: `live-${i}`,
          startTime: 0,
          length: 16,
          endTime: 16,
          notes: [
            {
              id: `live-note-${i}`,
              time: 0.125,
              quantizedTime: 0.125,
              duration: 8,
              pitch: i ? 48 : 60,
              velocity: 85,
              isGhost: false,
            },
          ],
        },
      ];
    });
    return encodeProjectSnapshot(
      p,
      p.audioSettings.humanization,
      p.audioSettings.masterBus,
      p.audioSettings.transport,
    );
  }, fixture);
  await page
    .getByLabel("Open saved DAW project", { exact: true })
    .setInputFiles({
      name: "Live_Editing.aidaw.json",
      mimeType: "application/json",
      buffer: Buffer.from(liveFixture),
    });
  await page
    .getByText(/^Opened Live_Editing/)
    .filter({ visible: true })
    .waitFor();
  await page.getByTitle("Start Playback (Space)", { exact: true }).click();
  const liveRead = () =>
    page.evaluate(async () => {
      const { synthEngine: e } = await import("/src/engine/webAudioSynth.ts");
      const { projectQueueService: q } =
        await import("/src/services/projectQueueService.ts");
      const p = q.getItem(q.getActiveQueueId()).workingProjectState;
      return {
        playing: e.getIsPlaying(),
        beat: e.getCurrentBeat(),
        master: e.bus.masterGain.gain.value,
        voices: p.tracks.map((t) => e.bus.trackVoices?.get(t.id)?.size ?? 0),
        meters: p.tracks.map((t) => e.getTrackMeterLevels(t.id)),
      };
    });
  const waitUntil = async (predicate, message) => {
    for (let i = 0; i < 150; i++) {
      const value = await liveRead();
      if (predicate(value)) return value;
      await new Promise((r) => {setTimeout(r, 20)});
    }
    throw new Error(message);
  };
  const sounding = await waitUntil(
    (v) =>
      v.voices.every((n) => n > 0) && v.meters.every((m) => m.peakDb > -50),
    "Both native layers did not sustain",
  );
  // Inspector remains open across project replacement; edit only layer A while both sound.
  await page.getByLabel("Note MIDI pitch", { exact: true }).fill("61");
  await page
    .getByRole("button", { name: "Apply note edit", exact: true })
    .click();
  const afterLive = await waitUntil(
    (v) =>
      v.voices[0] === 0 &&
      v.voices[1] > 0 &&
      v.meters[0].peakDb <= -55 &&
      v.meters[1].peakDb > -50,
    "Live edit did not retire only the edited layer",
  );
  assert(afterLive.playing && afterLive.beat > sounding.beat);
  report.live = { before: sounding, after: afterLive };
  assert(
    Math.abs(afterLive.master - sounding.master) < 0.0001,
    "Ordinary editing changed master gain",
  );
  report.live = { before: sounding, after: afterLive };
  await page.getByTitle("Pause Playback (Space)", { exact: true }).click();
  await stage(
    "Live edit retired the edited layer while the other sustained and master level stayed constant",
  );
  assert.deepEqual(report.errors, []);
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.failure = error.message;
  await page.screenshot({
    path: path.join(output, "failure.png"),
    fullPage: true,
  });
  throw error;
} finally {
  await fs.writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  await server.close();
}
