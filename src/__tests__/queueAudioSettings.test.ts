// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { buildStarterAbletonXml, parseAlsXmlString } from '../engine/alsXmlEngine';
import * as als from '../engine/alsXmlEngine';
import * as mastering from '../engine/masteringEngine';
import { ProjectQueueService } from '../services/projectQueueService';
import { projectAudioSettings } from '../engine/projectDefaults';

it('dispatches each queued project’s canonical mix to calibration and export despite another project’s active controls', async () => {
  const project = parseAlsXmlString(buildStarterAbletonXml('berghain-134', 777, 4).xml);
  project.audioSettings = projectAudioSettings(project);
  project.audioSettings.masterBus.masterVolumeDb = -9;
  project.audioSettings.humanization.cutoffHz = 321;
  const other = structuredClone(project.audioSettings);
  other.masterBus.masterVolumeDb = -1; other.humanization.cutoffHz = 900;
  const queue = new ProjectQueueService();
  const entry = await queue.enqueueProjectState(project);
  // Boundary spies stop before DSP; these assertions are not audio fidelity evidence.
  const measured = vi.spyOn(mastering, 'runStageBAudioMeasurement').mockRejectedValue(new Error('boundary-stop'));
  const exported = vi.spyOn(mastering, 'executeMasterExport20').mockRejectedValue(new Error('boundary-stop'));
  const compressed = vi.spyOn(als, 'compressXmlToAlsBlob').mockResolvedValue({ blob: { arrayBuffer: async () => new ArrayBuffer(0) } } as any);
  try {
    await queue.calibrateQueueItem(entry.queueId, other.humanization, other.masterBus);
    expect(measured.mock.calls[0][1]).toEqual(project.audioSettings.humanization);
    expect(measured.mock.calls[0][2]).toEqual(project.audioSettings.masterBus);
    queue.retryQueueItem(entry.queueId);
    await queue.applyAndExportQueueItem(entry.queueId, other.humanization, other.masterBus, {} as any);
    expect(exported).toHaveBeenCalledOnce();
    expect(exported.mock.calls[0][1]).toEqual(project.audioSettings.humanization);
    expect(exported.mock.calls[0][2]).toEqual(project.audioSettings.masterBus);
  } finally { measured.mockRestore(); exported.mockRestore(); compressed.mockRestore(); }
});
