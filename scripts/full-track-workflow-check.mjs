import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from 'node:child_process';
export async function runFullTrackWorkflow(page, origin, output) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin);
  const before = await page.evaluate(async () => {
    const { projectQueueService: q } = await import('/src/services/projectQueueService.ts');
    return { queueId: q.getActiveQueueId(), project: q.getItem(q.getActiveQueueId())?.workingProjectState };
  });
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page
    .getByRole("button", { name: /New Full Track \(64 Bars\)/ })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Create Full Track', exact: true });
  await dialog.waitFor();
  assert.equal(await dialog.getByLabel('Duration (bars)', { exact: true }).inputValue(), '64', 'Menu duration must initialize the visible dialog');
  await dialog.getByLabel('Generation seed', { exact: true }).fill('778');
  await dialog.getByLabel('Tempo (BPM)', { exact: true }).fill('133.5');
  await dialog.getByRole('button', { name: 'Generate Complete Project (64 Bars)', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const read = () =>
    page.evaluate(async () => {
      const { projectQueueService: q } =
        await import("/src/services/projectQueueService.ts");
      return q.getItem(q.getActiveQueueId())?.workingProjectState;
    });
  await page.waitForFunction(
    async () => {
      const { projectQueueService: q } =
        await import("/src/services/projectQueueService.ts");
      return (
        q.getItem(q.getActiveQueueId())?.workingProjectState?.songPlan
          ?.durationBars === 64
      );
    },
    {},
    { timeout: 30000 },
  );
  const p = await read();
  const afterQueue = await page.evaluate(async () => {
    const { projectQueueService: q } = await import('/src/services/projectQueueService.ts');
    return q.getActiveQueueId();
  });
  assert.notEqual(afterQueue, before.queueId, 'New Project must allocate an independent queue/history identity');
  if (before.queueId) {
    const preserved = await page.evaluate(async id => {
      const { projectQueueService: q } = await import('/src/services/projectQueueService.ts');
      return q.getItem(id)?.workingProjectState;
    }, before.queueId);
    assert.deepEqual(preserved, before.project, 'New Project overwrote the outgoing project');
  }
  assert.equal(p.creationMode, "full-track");
  assert.equal(p.songPlan.durationBars, 64);
  assert.equal(p.generationSeed, 778);
  assert.equal(p.tempo, 133.5);
  assert.equal(p.tempoMap[0].bpm, 133.5);
  assert.equal(p.audioSettings.transport.loopEnabled, false);
  assert(
    p.tracks.some((t) =>
      t.clips.some((c) => c.notes.some((n) => n.time > 248)),
    ),
    "new Full Track must compose its ending",
  );
  await page.getByTitle('Start Playback (Space)', { exact: true }).click();
  const live = await page.waitForFunction(async () => {
    const { synthEngine } = await import('/src/engine/webAudioSynth.ts');
    const analyser = synthEngine.getAnalyser();
    if (!analyser || !synthEngine.getIsPlaying() || synthEngine.getCurrentBeat() < 0.1) return false;
    const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
    const peak = samples.reduce((m, n) => Math.max(m, Math.abs(n)), 0);
    return peak > 1e-5 ? { peak, beat: synthEngine.getCurrentBeat(), source: 'native master analyser' } : false;
  }, {}, { timeout: 15000 });
  const nativePlayback = await live.jsonValue(); await live.dispose();
  await page.getByTitle('Stop Playback (Space)', { exact: true }).click();
  await page.screenshot({
    path: path.join(output, "full-track-arrangement.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "File", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: /Save Project/ }).click();
  const download = await pending;
  const saved = path.join(output, "ui-full-track.aidaw.json");
  await download.saveAs(saved);
  await page
    .getByLabel("Open saved DAW project", { exact: true })
    .setInputFiles(saved);
  await page
    .getByText(/^Opened .*aidaw\.json\./)
    .filter({ visible: true })
    .waitFor();
  const reopened = await read();
  assert.deepEqual(reopened.songPlan, p.songPlan);
  assert.deepEqual(reopened.tracks, p.tracks);
  assert.equal(reopened.creationMode, p.creationMode);
  assert.equal(reopened.requestedDurationBars, 64);
  assert.deepEqual(reopened.audioSettings, p.audioSettings);
  const buttons = await page.getByRole("button").allTextContents();
  await fs.writeFile(
    path.join(output, "full-track-visible-controls.json"),
    JSON.stringify(buttons, null, 2),
  );
  const responsive = [];
  for (const viewport of [{ width: 360, height: 640 }, { width: 800, height: 360 }]) {
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('button', { name: /^New Extended Full Track \(128 Bars\)/ }).click();
    const modal = page.getByRole('dialog', { name: 'Create Full Track', exact: true });
    assert.equal(await modal.getByLabel('Duration (bars)', { exact: true }).inputValue(), '128');
    const bounds = await modal.boundingBox();
    assert(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1);
    await page.screenshot({ path: path.join(output, `new-project-${viewport.width}x${viewport.height}.png`), fullPage: true });
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal((await read()).generationSeed, 778, 'Cancel changed the active project');
    responsive.push({ ...viewport, cancelPreservedProject: true });
  }
  // A short newly created arrangement exercises the actual visible WAV download path.
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('button', { name: /New Full Track \(64 Bars\)/ }).click();
  const shortDialog = page.getByRole('dialog', { name: 'Create Full Track', exact: true });
  await shortDialog.getByLabel('Duration (bars)', { exact: true }).fill('4');
  await shortDialog.getByLabel('Generation seed', { exact: true }).fill('779');
  await shortDialog.getByRole('button', { name: 'Essential — 6 tracks', exact: true }).click();
  await shortDialog.getByRole('button', { name: 'Generate Complete Project (4 Bars)', exact: true }).click();
  await shortDialog.waitFor({ state: 'hidden' });
  assert.equal((await read()).tracks.length, 6);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  const [wavDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 180000 }),
    page.getByRole('button', { name: /^Master Export WAV \(24-bit PCM\)/ }).click(),
  ]);
  const wavPath = path.join(output, 'ui-created-four-bar.wav');
  await wavDownload.saveAs(wavPath);
  const decoded = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', wavPath], { encoding: 'utf8', timeout: 30000 }));
  const stream = decoded.streams[0];
  assert.equal(stream.channels, 2); assert.equal(Number(stream.sample_rate), 44100); assert.equal(Number(stream.bits_per_sample), 24);
  assert(Number(decoded.format.duration) >= 4 * 240 / (await read()).tempo, 'New project WAV was shortened');
  execFileSync('ffmpeg', ['-v', 'error', '-i', wavPath, '-f', 'null', '-'], { timeout: 30000 });
  return {
    creation: "visible File → New Full Track 64 → dialog → Generate → new queue identity",
    seed: p.songPlan.seed,
    planVersion: p.songPlan.version,
    tracks: p.tracks.length,
    saveReopen: "exact score/plan match",
    nativePlayback, responsive,
    visibleWavExport: { channels: stream.channels, sampleRate: Number(stream.sample_rate), bits: Number(stream.bits_per_sample), seconds: Number(decoded.format.duration), independentDecoder: 'FFmpeg/ffprobe' },
    fullJourneyQualified: false,
  };
}
