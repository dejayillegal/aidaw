import { HumanizationConfig } from '../types/ableton';

/**
 * Generates the complete, production-grade Python FastAPI + lxml + gzip codebase
 * fulfilling Task 1 (The Parser Engine), Task 2 (TechnoHeuristicEngine),
 * Task 3 (Automation & Drift), and the FastAPI multipart endpoint with zero placeholders.
 * Dynamically reflects the user's current humanization parameters from the workbench.
 */
export function generatePythonFastApiCode(humanization: HumanizationConfig): string {
  return `"""
Parametric AI DAW Engine — Ableton Live (.als) XML Manipulation & Techno Layer Generator
========================================================================================
Architecture:
- Decompresses native Ableton Live 11/12 .als files (gzip-compressed XML) in memory.
- Strips stray XML namespaces safely for deterministic XPath / ElementTree traversal.
- Extracts <Tempo>, Root Key / Scale, and existing <MidiTrack> & <AudioTrack> metadata.
- Injects complementary underground techno layers (Operator Sine Sub-Bass, Reverb,
  AutoFilter LPF, Sidechain Compressor, Collision, Wavetable, Simpler) with zero 3rd-party VSTs.
- Applies Anti-Slop Humanization: Gaussian micro-timing shifts (+/- ${humanization.microTimingMaxShiftBeats.toFixed(3)} beats)
  on syncopated 16ths and +/- ${Math.round(humanization.velocityVariancePct * 100)}% velocity contouring with ghost notes (${humanization.ghostVelocityMin}-${humanization.ghostVelocityMax}).
- Appends unsynced <Lfo> analog drift (${humanization.lfoRateHz.toFixed(2)} Hz) mapped directly to <AutoFilter><Cutoff>.

Run locally:
    pip install fastapi uvicorn lxml python-multipart
    uvicorn als_techno_engine:app --host 0.0.0.0 --port 8000 --reload
"""

import gzip
import io
import math
import random
import re
from typing import Any, Dict, List, Optional, Tuple

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from lxml import etree

app = FastAPI(
    title="Parametric AI DAW Engine (.als XML Injector)",
    description="Native Ableton Live 11/12 .als DOM parser, underground techno heuristic generator, and analog LFO drift injector.",
    version="1.0.0",
)

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


# =====================================================================
# TASK 1: THE PARSER ENGINE (GZIP + LXML DOM TRAVERSAL & CLIP INJECTION)
# =====================================================================

def strip_xml_namespaces(xml_bytes: bytes) -> bytes:
    """
    Robustly removes default and prefixed XML namespace declarations so XPath queries
    operate cleanly across Ableton Live 10, 11, and 12 schema revisions.
    """
    cleaned = re.sub(rb'\\sxmlns(:[a-zA-Z0-9_-]+)?="[^"]*"', b"", xml_bytes)
    return cleaned


def decompress_als_to_tree(als_bytes: bytes) -> etree._ElementTree:
    """
    Decompresses an uploaded .als file (or raw XML fallback) into an lxml ElementTree.
    Includes defensive error handling for corrupted archives and malformed XML namespaces.
    """
    if not als_bytes:
        raise ValueError("Uploaded .als payload is empty.")

    # Check standard GZIP magic bytes (0x1f 0x8b)
    if len(als_bytes) >= 2 and als_bytes[0] == 0x1F and als_bytes[1] == 0x8B:
        try:
            raw_xml_bytes = gzip.decompress(als_bytes)
        except Exception as exc:
            raise ValueError(f"Gzip decompression failed for .als file: {exc}") from exc
    else:
        raw_xml_bytes = als_bytes

    sanitized_xml = strip_xml_namespaces(raw_xml_bytes)

    try:
        parser = etree.XMLParser(remove_blank_text=True, recover=False, resolve_entities=False)
        root = etree.fromstring(sanitized_xml, parser=parser)
        return etree.ElementTree(root)
    except etree.XMLSyntaxError as exc:
        raise ValueError(f"Invalid Ableton Live XML DOM structure: {exc}") from exc


def serialize_tree_to_als_bytes(tree: etree._ElementTree) -> bytes:
    """
    Serializes the modified lxml ElementTree back into UTF-8 XML with standard Ableton
    XML declaration and compresses it into a valid gzipped .als binary stream.
    """
    xml_bytes = etree.tostring(
        tree.getroot(),
        encoding="UTF-8",
        xml_declaration=True,
        pretty_print=True,
    )
    out_buffer = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=out_buffer, compresslevel=9) as gz:
        gz.write(xml_bytes)
    return out_buffer.getvalue()


def extract_project_metadata(tree: etree._ElementTree) -> Dict[str, Any]:
    """
    Traverses the Ableton Live DOM to extract:
    1. Current BPM (<Tempo><Manual Value="..." /></Tempo>)
    2. Root Key & Scale (from <ScaleInformation> or pitch class histogram of <MidiNoteEvent>)
    3. Existing tracks list by parsing <MidiTrack> and <AudioTrack> names.
    """
    root = tree.getroot()

    # 1. Extract Tempo
    tempo_nodes = root.xpath("//MasterTrack//Tempo/Manual/@Value | //Tempo/Manual/@Value")
    bpm = 134.0
    if tempo_nodes:
        try:
            bpm = float(tempo_nodes[0])
        except (ValueError, TypeError):
            bpm = 134.0

    # 2. Extract Track List (<MidiTrack> and <AudioTrack>)
    tracks_summary: List[Dict[str, str]] = []
    track_elements = root.xpath("//LiveSet/Tracks/MidiTrack | //LiveSet/Tracks/AudioTrack")

    for idx, track_el in enumerate(track_elements):
        track_id = track_el.get("Id", str(idx + 1))
        eff_names = track_el.xpath("./Name/EffectiveName/@Value | ./Name/UserName/@Value")
        track_name = eff_names[0] if eff_names else f"{track_el.tag}_{track_id}"
        tracks_summary.append(
            {
                "id": track_id,
                "type": track_el.tag,
                "name": track_name,
            }
        )

    # 3. Extract or Infer Root Key
    scale_root_nodes = root.xpath("//ScaleInformation/RootNote/@Value")
    scale_name_nodes = root.xpath("//ScaleInformation/Name/@Value")

    if scale_root_nodes and scale_root_nodes[0] in NOTE_NAMES:
        root_key = scale_root_nodes[0]
    else:
        # Analyze existing <KeyTrack><MidiKey> or <MidiNoteEvent Pitch="...">
        midi_keys = root.xpath("//KeyTrack/MidiKey/@Value | //MidiNoteEvent/@Pitch")
        pitch_histogram: Dict[int, int] = {}
        for k in midi_keys:
            try:
                pc = int(float(k)) % 12
                pitch_histogram[pc] = pitch_histogram.get(pc, 0) + 1
            except ValueError:
                continue
        if pitch_histogram:
            dominant_pc = max(pitch_histogram.items(), key=lambda item: item[1])[0]
            root_key = NOTE_NAMES[dominant_pc]
        else:
            root_key = "F"

    scale_name = scale_name_nodes[0] if scale_name_nodes else "Phrygian"

    return {
        "bpm": bpm,
        "root_key": root_key,
        "scale": scale_name,
        "tracks": tracks_summary,
    }


def inject_midi_clip(
    track_node: etree._Element,
    clip_name: str,
    start_time: float,
    length: float,
    midi_notes_array: List[Dict[str, float]],
) -> etree._Element:
    """
    Task 1.3: Properly formats and injects an Ableton <MidiClip> and its child
    <MidiNoteEvent> nodes into the target <MidiTrack>, ensuring exact formatting for
    Time, Duration, Pitch, and Velocity across both <KeyTrack> and <MidiNoteEvent>.
    """
    events_list = track_node.xpath(
        "./DeviceChain/MainSequencer/ClipTimeable/ArrangerAutomation/Events"
    )
    if events_list:
        events_node = events_list[0]
    else:
        device_chain = track_node.find("DeviceChain")
        if device_chain is None:
            device_chain = etree.SubElement(track_node, "DeviceChain")
        main_seq = etree.SubElement(device_chain, "MainSequencer")
        clip_timeable = etree.SubElement(main_seq, "ClipTimeable")
        arranger_auto = etree.SubElement(clip_timeable, "ArrangerAutomation")
        events_node = etree.SubElement(arranger_auto, "Events")

    midi_clip = etree.SubElement(
        events_node,
        "MidiClip",
        Id=str(random.randint(5000, 8999)),
        Time=f"{start_time:.3f}",
    )
    etree.SubElement(midi_clip, "LomId", Value="0")
    etree.SubElement(midi_clip, "Name", Value=clip_name)
    etree.SubElement(midi_clip, "CurrentStart", Value=f"{start_time:.3f}")
    etree.SubElement(midi_clip, "CurrentEnd", Value=f"{start_time + length:.3f}")

    loop_node = etree.SubElement(midi_clip, "Loop")
    etree.SubElement(loop_node, "LoopStart", Value="0.000")
    etree.SubElement(loop_node, "LoopEnd", Value=f"{length:.3f}")
    etree.SubElement(loop_node, "LoopOn", Value="true")

    notes_container = etree.SubElement(midi_clip, "Notes")
    key_tracks_container = etree.SubElement(notes_container, "KeyTracks")

    # Group notes by integer MIDI pitch for native Ableton <KeyTrack> compatibility
    notes_by_pitch: Dict[int, List[Dict[str, float]]] = {}
    for note in midi_notes_array:
        pitch_int = max(0, min(127, int(round(note["Pitch"]))))
        notes_by_pitch.setdefault(pitch_int, []).append(note)

    note_id_counter = 10000
    for kt_idx, (pitch_val, pitch_notes) in enumerate(sorted(notes_by_pitch.items())):
        key_track = etree.SubElement(key_tracks_container, "KeyTrack", Id=str(kt_idx))
        etree.SubElement(key_track, "MidiKey", Value=str(pitch_val))
        kt_notes_el = etree.SubElement(key_track, "Notes")

        for n in sorted(pitch_notes, key=lambda item: item["Time"]):
            note_id_counter += 1
            velocity_clamped = max(1, min(127, int(round(n["Velocity"]))))
            etree.SubElement(
                kt_notes_el,
                "MidiNoteEvent",
                Time=f"{n['Time']:.3f}",
                Duration=f"{n['Duration']:.3f}",
                Pitch=str(pitch_val),
                Velocity=str(velocity_clamped),
                OffVelocity="64",
                NoteId=str(note_id_counter),
                IsEnabled="true",
            )

    return midi_clip


# =====================================================================
# TASK 2: THE TECHNO LAYER GENERATOR (TechnoHeuristicEngine)
# =====================================================================

class TechnoHeuristicEngine:
    """
    Analyzes the extracted track list, builds native Ableton Live XML device chains
    (Operator Sine Sub-Bass -> Reverb -> AutoFilter LPF), and generates humanized
    16-bar rolling 16th-note MIDI sequences.
    """

    OPERATOR_RUMBLE_DEVICE_CHAIN_XML = """
    <MidiToAudioDeviceChain>
      <Devices>
        <Operator Id="4101">
          <LomId Value="0" />
          <IsOn><Manual Value="true" /></IsOn>
          <Algorithm Value="0" />
          <Transpose><Manual Value="0" /></Transpose>
          <OscillatorA>
            <IsOn><Manual Value="true" /></IsOn>
            <Waveform Value="Sine" />
            <Coarse Value="0" />
            <Fine Value="0" />
            <Level Value="0.92" />
            <Envelope>
              <Attack Value="2.5" />
              <Decay Value="620.0" />
              <Sustain Value="0.75" />
              <Release Value="180.0" />
            </Envelope>
          </OscillatorA>
        </Operator>
        <Reverb Id="4102">
          <LomId Value="0" />
          <IsOn><Manual Value="true" /></IsOn>
          <PreDelay><Manual Value="12.5" /></PreDelay>
          <DecayTime><Manual Value="${Math.round(2800 + humanization.macroTransition * 18)}.0" /></DecayTime>
          <RoomSize><Manual Value="88.0" /></RoomSize>
          <StereoSeparation><Manual Value="0.0" /></StereoSeparation>
          <DryWet><Manual Value="0.44" /></DryWet>
        </Reverb>
        <AutoFilter Id="4103">
          <LomId Value="0" />
          <IsOn><Manual Value="true" /></IsOn>
          <FilterType><Manual Value="Lowpass" /></FilterType>
          <Slope><Manual Value="24dB" /></Slope>
          <Cutoff Id="9401">
            <Manual Value="${humanization.cutoffHz.toFixed(1)}" />
          </Cutoff>
          <Resonance>
            <Manual Value="0.28" />
          </Resonance>
          <EnvModulation><Manual Value="0.15" /></EnvModulation>
        </AutoFilter>
      </Devices>
    </MidiToAudioDeviceChain>
    """

    def __init__(
        self,
        tree: etree._ElementTree,
        velocity_variance: float = ${humanization.velocityVariancePct.toFixed(2)},
        max_syncopation_shift_beats: float = ${humanization.microTimingMaxShiftBeats.toFixed(3)},
    ) -> None:
        self.tree = tree
        self.root = tree.getroot()
        self.velocity_variance = velocity_variance
        self.max_syncopation_shift_beats = max_syncopation_shift_beats
        self.metadata = extract_project_metadata(tree)

    def has_sub_or_rumble_track(self) -> bool:
        """Checks if any existing track name contains 'Sub' or 'Rumble' (case-insensitive)."""
        for t in self.metadata["tracks"]:
            name_lower = t["name"].lower()
            if "sub" in name_lower or "rumble" in name_lower:
                return True
        return False

    def root_key_to_sub_midi_pitch(self) -> int:
        """Maps the project root key to octave 1 sub-bass MIDI pitch (e.g., F1 = 29)."""
        root_key = self.metadata.get("root_key", "F").upper()
        semitone = NOTE_NAMES.index(root_key) if root_key in NOTE_NAMES else 5
        return 24 + semitone

    def generate_16bar_rolling_sub_midi(self) -> List[Dict[str, float]]:
        """
        Task 2.3: Generates a 16-bar (64-beat) rolling 16th-note MIDI array (256 steps).
        Applies anti-slop humanization:
        - Randomizes velocities by +/- 8% (self.velocity_variance) with ghost notes (${humanization.ghostVelocityMin}-${humanization.ghostVelocityMax}).
        - Shifts the Time attribute of 16th-note syncopations by up to +/- ${humanization.microTimingMaxShiftBeats.toFixed(3)} beats.
        """
        sub_pitch = self.root_key_to_sub_midi_pitch()
        midi_events: List[Dict[str, float]] = []

        for bar in range(16):
            for step in range(16):
                quantized_time = bar * 4.0 + step * 0.25
                is_downbeat = (step % 4) == 0
                is_offbeat_8th = (step % 4) == 2
                is_syncopated_16th = (step % 2) == 1

                # Micro-timing groove shift on syncopated 16th notes (up to +/- 0.015 beats)
                if is_syncopated_16th:
                    shift = random.gauss(0.003, self.max_syncopation_shift_beats * 0.55)
                    shift = max(
                        -self.max_syncopation_shift_beats,
                        min(self.max_syncopation_shift_beats, shift),
                    )
                elif not is_downbeat:
                    shift = random.uniform(
                        -self.max_syncopation_shift_beats * 0.25,
                        self.max_syncopation_shift_beats * 0.25,
                    )
                else:
                    shift = 0.0

                note_time = max(0.0, quantized_time + shift)

                # Base velocity contour + ghost notes
                if is_downbeat:
                    base_vel = 72.0  # Ducked under kick downbeat
                elif is_offbeat_8th:
                    base_vel = 104.0  # Primary offbeat sub pump
                elif (step % 4) == 3:
                    base_vel = 92.0  # Rolling pickup 16th
                else:
                    base_vel = float(random.randint(${humanization.ghostVelocityMin}, ${humanization.ghostVelocityMax}))

                # Apply +/- 8% velocity humanization variance
                vel_multiplier = 1.0 + random.uniform(-self.velocity_variance, self.velocity_variance)
                final_velocity = max(16.0, min(126.0, round(base_vel * vel_multiplier)))

                # Subtle Phrygian minor-2nd inflection at end of 4-bar phrases
                pitch = sub_pitch + 1 if (bar % 4 == 3 and step >= 14) else sub_pitch

                midi_events.append(
                    {
                        "Time": round(note_time, 3),
                        "Duration": 0.24 if is_offbeat_8th else 0.20,
                        "Pitch": float(pitch),
                        "Velocity": final_velocity,
                    }
                )

        return midi_events

    def ensure_sub_rumble_layer(self, lfo_rate_hz: float = ${humanization.lfoRateHz.toFixed(2)}) -> etree._Element:
        """
        Task 2.1 & 2.2: If no track named 'Sub' or 'Rumble' exists, generates a new
        <MidiTrack> node, injects the Operator Sine + Reverb + AutoFilter (LPF) DeviceChain,
        injects the 16-bar humanized rolling 16th-note MidiClip, and wires the analog LFO drift.
        """
        tracks_container_list = self.root.xpath("//LiveSet/Tracks")
        if tracks_container_list:
            tracks_container = tracks_container_list[0]
        else:
            live_set = self.root.find("LiveSet") or self.root
            tracks_container = etree.SubElement(live_set, "Tracks")

        existing_count = len(tracks_container.xpath("./MidiTrack | ./AudioTrack"))
        new_track_id = str(existing_count + 1)

        midi_track = etree.SubElement(tracks_container, "MidiTrack", Id=new_track_id)
        etree.SubElement(midi_track, "LomId", Value="0")
        name_node = etree.SubElement(midi_track, "Name")
        etree.SubElement(name_node, "EffectiveName", Value="Sub_Rumble_Operator_AI")
        etree.SubElement(name_node, "UserName", Value="Sub_Rumble_Operator_AI")
        etree.SubElement(midi_track, "Color", Value="14")

        device_chain = etree.SubElement(midi_track, "DeviceChain")

        # Inject Operator (Sine) -> Reverb -> AutoFilter (LPF) XML template
        chain_node = etree.fromstring(self.OPERATOR_RUMBLE_DEVICE_CHAIN_XML.strip())
        device_chain.append(chain_node)

        # Generate and inject 16-bar (64-beat) rolling 16th-note MIDI clip
        midi_notes = self.generate_16bar_rolling_sub_midi()
        inject_midi_clip(
            track_node=midi_track,
            clip_name="Rumble_16th_Rolling_Humanized",
            start_time=0.0,
            length=64.0,
            midi_notes_array=midi_notes,
        )

        # Task 3: Append <Lfo> mapped to <AutoFilter><Cutoff> at unsynced slow frequency
        inject_analog_drift(device_chain, lfo_rate_hz=lfo_rate_hz)

        return midi_track


# =====================================================================
# TASK 3: AUTOMATION & DRIFT (UNSYNCED LFO -> AUTOFILTER CUTOFF)
# =====================================================================

def inject_analog_drift(
    device_chain_node: etree._Element,
    lfo_rate_hz: float = ${humanization.lfoRateHz.toFixed(2)},
    lfo_depth: float = ${humanization.lfoDepth.toFixed(2)},
) -> etree._Element:
    """
    Task 3: Appends an Ableton <Lfo> XML node to a track's <DeviceChain> and maps it
    directly to the <Cutoff> parameter of an existing <AutoFilter> node, setting the LFO
    rate to an unsynced slow frequency (e.g., ${humanization.lfoRateHz.toFixed(2)} Hz) to simulate hardware analog drift.
    """
    devices_list = device_chain_node.xpath("./MidiToAudioDeviceChain/Devices | ./Devices")
    if devices_list:
        devices_container = devices_list[0]
    else:
        midi_to_audio = etree.SubElement(device_chain_node, "MidiToAudioDeviceChain")
        devices_container = etree.SubElement(midi_to_audio, "Devices")

    # Locate existing <AutoFilter><Cutoff> parameter ID or assign a deterministic ID
    cutoff_nodes = devices_container.xpath(".//AutoFilter/Cutoff")
    if cutoff_nodes:
        cutoff_el = cutoff_nodes[0]
        cutoff_param_id = cutoff_el.get("Id") or "9401"
        cutoff_el.set("Id", cutoff_param_id)
    else:
        cutoff_param_id = "9401"

    lfo_node = etree.SubElement(devices_container, "Lfo", Id="9901")
    etree.SubElement(lfo_node, "LomId", Value="0")
    is_on = etree.SubElement(lfo_node, "IsOn")
    etree.SubElement(is_on, "Manual", Value="true")
    etree.SubElement(lfo_node, "Waveform", Value="Sine")
    etree.SubElement(lfo_node, "SyncMode", Value="FreeHz")

    rate_el = etree.SubElement(lfo_node, "Rate")
    etree.SubElement(rate_el, "Manual", Value=f"{lfo_rate_hz:.3f}")

    depth_el = etree.SubElement(lfo_node, "Depth")
    etree.SubElement(depth_el, "Manual", Value=f"{lfo_depth:.2f}")

    jitter_el = etree.SubElement(lfo_node, "Jitter")
    etree.SubElement(jitter_el, "Manual", Value="0.08")

    # Map LFO modulation target directly to <AutoFilter><Cutoff Id="...">
    etree.SubElement(
        lfo_node,
        "ModulationTarget",
        Id=cutoff_param_id,
        Parameter="AutoFilter.Cutoff",
    )

    return lfo_node


# =====================================================================
# FASTAPI MULTIPART ENDPOINT
# =====================================================================

@app.post("/process-als")
async def process_als_endpoint(
    file: UploadFile = File(..., description="Incomplete Ableton Live .als project file"),
    lfo_rate_hz: float = Query(${humanization.lfoRateHz.toFixed(2)}, ge=0.01, le=2.0, description="Unsynced LFO analog drift rate in Hz"),
    force_inject_sub: bool = Query(False, description="Inject Sub/Rumble track even if one already exists"),
):
    """
    Ingests an uploaded .als file, extracts arrangement metadata, injects the humanized
    Operator Sine Sub/Rumble layer and slow LFO analog drift if missing, and streams back
    a valid, gzip-compressed native Ableton Live .als file.
    """
    try:
        raw_bytes = await file.read()
        tree = decompress_als_to_tree(raw_bytes)
        engine = TechnoHeuristicEngine(tree)

        injected = False
        if force_inject_sub or not engine.has_sub_or_rumble_track():
            engine.ensure_sub_rumble_layer(lfo_rate_hz=lfo_rate_hz)
            injected = True
        else:
            # Ensure existing AutoFilter chains still receive analog LFO drift
            for dc in tree.getroot().xpath("//MidiTrack/DeviceChain"):
                if dc.xpath(".//AutoFilter") and not dc.xpath(".//Lfo"):
                    inject_analog_drift(dc, lfo_rate_hz=lfo_rate_hz)

        modified_als_bytes = serialize_tree_to_als_bytes(tree)
        orig_name = (file.filename or "project.als").replace(".als", "")
        out_filename = f"{orig_name}_parametric_techno.als"

        headers = {
            "Content-Disposition": f'attachment; filename="{out_filename}"',
            "X-Als-BPM": str(engine.metadata["bpm"]),
            "X-Als-Root-Key": f"{engine.metadata['root_key']} {engine.metadata['scale']}",
            "X-Als-Sub-Injected": str(injected),
        }

        return StreamingResponse(
            io.BytesIO(modified_als_bytes),
            media_type="application/x-ableton-live-set",
            headers=headers,
        )
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve)) from ve
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Internal .als engine error: {exc}") from exc
`;
}
