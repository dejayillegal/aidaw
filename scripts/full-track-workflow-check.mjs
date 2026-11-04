import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
export async function runFullTrackWorkflow(page, origin, output) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin);
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page
    .getByRole("button", { name: /New Full Track \(64 Bars\)/ })
    .click();
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
  assert.equal(p.creationMode, "full-track");
  assert.equal(p.songPlan.durationBars, 64);
  assert(
    p.tracks.some((t) =>
      t.clips.some((c) => c.notes.some((n) => n.time > 248)),
    ),
    "new Full Track must compose its ending",
  );
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
  const buttons = await page.getByRole("button").allTextContents();
  await fs.writeFile(
    path.join(output, "full-track-visible-controls.json"),
    JSON.stringify(buttons, null, 2),
  );
  return {
    creation: "visible File → New Full Track 64",
    seed: p.songPlan.seed,
    planVersion: p.songPlan.version,
    tracks: p.tracks.length,
    saveReopen: "exact score/plan match",
    fullJourneyQualified: false,
  };
}
