import type { AbletonProjectState, MasterBusConfig } from "../types/ableton";
import { composeEffectiveTrackGain } from "./channelStripEngine";
import { readDeviceParamNumber } from "./abletonCapabilityMatrix";

/** Tail policy: minimum eight seconds; serial wet paths retain modeled -80dB
 * feedback/comb decay plus the chosen shared return. This is not a listening approval. */
export function estimateArrangementTailSeconds(
  project: AbletonProjectState,
  master: MasterBusConfig,
): number {
  const repeatTail = (seconds: number, feedback: number) =>
    feedback > 0
      ? seconds * (Math.log(0.0001) / Math.log(feedback) + 1)
      : seconds;
  const masterDelay =
    Math.max(0.08, Math.min(0.9, (60 / Math.max(90, project.tempo)) * 0.75)) *
    2;
  const returnDelay =
    master.delayReturnLevel > 0
      ? repeatTail(
          masterDelay,
          Math.min(0.82, Math.max(0.1, master.delayFeedback)),
        )
      : 0;
  const returnReverb =
    master.reverbReturnLevel > 0
      ? Math.max(0.8, Math.min(6, master.reverbDecaySec || 3.2))
      : 0;
  let tail = 8;
  for (const track of project.tracks) {
    if (
      composeEffectiveTrackGain(track, project.tracks, project.vcaGroups || [])
        .effectivelyMuted
    )
      continue;
    let serial = 0;
    for (const device of track.devices || []) {
      if (device.bypassed || readDeviceParamNumber(device, "DryWet", 100) <= 0)
        continue;
      if (device.xmlTag === "Reverb" || device.xmlTag === "HybridReverb")
        serial +=
          (Math.min(
            15,
            Math.max(
              0.2,
              readDeviceParamNumber(
                device,
                "DecayTime",
                device.xmlTag === "HybridReverb" ? 3.2 : 2.4,
              ),
            ),
          ) *
            4) /
            3 +
          Math.min(
            0.5,
            Math.max(0, readDeviceParamNumber(device, "PreDelay", 18) / 1000),
          );
      else if (device.xmlTag === "Delay" || device.xmlTag === "Echo") {
        const raw = readDeviceParamNumber(
            device,
            "Feedback",
            device.xmlTag === "Echo" ? 0.42 : 0.35,
          ),
          feedback = Math.min(0.88, Math.max(0, raw > 1 ? raw / 100 : raw));
        serial += repeatTail(
          Math.min(
            1.5,
            Math.max(
              0.01,
              readDeviceParamNumber(
                device,
                "DelayTime",
                device.xmlTag === "Echo" ? 335 : 280,
              ) / 1000,
            ),
          ),
          feedback,
        );
      }
    }
    const returns = Math.max(
      (track.mixer.delaySend || 0) > 0 ? returnDelay : 0,
      (track.mixer.reverbSend || 0) > 0 ? returnReverb : 0,
    );
    tail = Math.max(tail, serial + returns);
  }
  return tail;
}

/** Estimates retained render buffers, declared delay/impulse capacities and bounded bridge encoding.
 * It is a working-buffer budget, not a claim about total Android process memory. */
export function estimateContinuousExportMemory(
  project: AbletonProjectState,
  masterBus: MasterBusConfig,
  sampleRate: number,
  frames: number,
) {
  if (
    !Number.isSafeInteger(frames) ||
    frames <= 0 ||
    ![44100, 48000, 96000].includes(sampleRate)
  )
    throw new Error("RENDER_INPUT: invalid frame count/sample rate");
  const outputPcmBytes = frames * 2 * 4;
  const devices = project.tracks
    .flatMap((track) => track.devices || [])
    .filter((device) => !device.bypassed);
  const delaySeconds = devices.reduce(
    (sum, device) =>
      sum +
      (["Delay", "Echo"].includes(device.xmlTag)
        ? 2
        : ["Reverb", "HybridReverb"].includes(device.xmlTag)
          ? 0.9
          : ["Chorus", "Flanger"].includes(device.xmlTag)
            ? 0.1
            : 0.05),
    4,
  );
  const impulseSeconds = Math.max(
    0.8,
    Math.min(6, masterBus.reverbDecaySec || 3.2),
  );
  const declaredBufferBytes = Math.ceil(
    sampleRate * 4 * (delaySeconds * 2 + impulseSeconds * 2 + 2),
  );
  const fixedReserveBytes =
    16 * 1024 * 1024 + devices.length * 65536 + 4 * 192 * 1024;
  const totalBytes = outputPcmBytes + declaredBufferBytes + fixedReserveBytes;
  if (totalBytes > 256 * 1024 * 1024)
    throw new Error(
      "RENDER_MEMORY: continuous PCM and bounded encoder working buffers exceed 256 MiB",
    );
  return {
    outputPcmBytes,
    declaredBufferBytes,
    fixedReserveBytes,
    encodedWholeFileBytes: 0,
    totalBytes,
    limitBytes: 256 * 1024 * 1024,
  };
}
