#!/usr/bin/env python3
"""Independently decode PCM24 export-check output. Requires NumPy; no app DSP imports."""
import argparse
import hashlib
import json
import wave
from pathlib import Path

import numpy as np


def measure(source, case):
    digest = hashlib.sha256()
    with source.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    assert digest.hexdigest() == case["sha256"], "file identity mismatch"
    with wave.open(str(source), "rb") as reader:
        frames, rate = reader.getnframes(), reader.getframerate()
        assert (reader.getnchannels(), reader.getsampwidth()) == (2, 3)
        assert frames == case["frames"] and rate == case["sampleRate"]
        peak = last_music_peak = tail_peak = final_second_peak = 0.0
        total = square = nonzero = 0
        music_end = round((case["durationSeconds"] - case["tailSeconds"]) * rate)
        at = 0
        while block := reader.readframes(65536):
            data = np.frombuffer(block, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
            pcm = data[:, 0] | (data[:, 1] << 8) | (data[:, 2] << 16)
            pcm = np.where(pcm & 0x800000, pcm - 0x1000000, pcm)
            samples = pcm.astype(np.float64).reshape(-1, 2) / 8388608
            assert np.isfinite(samples).all()
            peak = max(peak, float(np.abs(samples).max()))
            start = max(0, music_end - rate // 4 - at)
            end = min(len(samples), music_end - at)
            if end > start:
                last_music_peak = max(
                    last_music_peak, float(np.abs(samples[start:end]).max())
                )
            start = max(0, music_end + 8 * rate - at)
            if start < len(samples):
                tail_peak = max(tail_peak, float(np.abs(samples[start:]).max()))
            start = max(0, frames - rate - at)
            if start < len(samples):
                final_second_peak = max(
                    final_second_peak, float(np.abs(samples[start:]).max())
                )
            total += float(samples.sum())
            square += float(np.square(samples).sum())
            nonzero += int(np.count_nonzero(pcm))
            at += len(samples)
        assert at == frames and nonzero > 0 and last_music_peak > 0
        return {
            "name": case["name"],
            "sha256": digest.hexdigest(),
            "frames": frames,
            "sampleRate": rate,
            "durationSeconds": frames / rate,
            "declaredTailSeconds": case["tailSeconds"],
            "samplePeak": peak,
            "rms": (square / (frames * 2)) ** 0.5,
            "dc": total / (frames * 2),
            "nonzeroSamples": nonzero,
            "lastMusicalQuarterPeak": last_music_peak,
            "peakBeyondOldEightSecondTail": tail_peak,
            "finalSecondPeak": final_second_peak,
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = json.loads(args.report.read_text())
    result = {
        "scope": "Independent PCM decode; not producer listening or live capture parity",
        "cases": [
            measure(args.report.parent / (case["name"] + ".wav"), case)
            for case in report["cases"]
            if case.get("bitDepth") == 24 and not case.get("cancelled")
        ],
    }
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
