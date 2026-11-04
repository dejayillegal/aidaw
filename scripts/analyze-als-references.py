#!/usr/bin/env python3
"""Read-only ALS structural evidence. Never executes devices or redistributes source audio.
Detailed profiles can contain private authored notes/paths: keep them outside the public repository.
"""
import argparse, gzip, hashlib, html, json, math
from pathlib import Path
import xml.etree.ElementTree as ET

VERSION = 1
MAX_XML_BYTES = 64 * 1024 * 1024


def value(element, path, default=None):
    node = element.find(path) if element is not None else None
    return node.get("Value", default) if node is not None else default


def number(raw):
    try:
        result = float(raw)
        return result if math.isfinite(result) else None
    except (ValueError, TypeError):
        return None


def scalar(raw):
    if raw in ("true", "false"):
        return raw == "true"
    parsed = number(raw)
    return parsed if parsed is not None else raw


def intervals_union(intervals):
    output = []
    for start, end in sorted(intervals):
        if not math.isfinite(start) or not math.isfinite(end) or end <= start:
            continue
        if output and start <= output[-1][1]:
            output[-1][1] = max(end, output[-1][1])
        else:
            output.append([start, end])
    return output


def local_name(element):
    return (
        value(element, "Name/EffectiveName")
        or value(element, "Name/UserName")
        or element.tag
    )


def index_document(root):
    paths = {}
    targets = {}

    def walk(element, parent=""):
        suffix = "[" + element.get("Id") + "]" if element.get("Id") is not None else ""
        path = parent + "/" + element.tag + suffix
        paths[element] = path
        if (
            element.tag in ("AutomationTarget", "ModulationTarget")
            and element.get("Id") is not None
        ):
            targets.setdefault(element.get("Id"), []).append(
                {"path": parent, "targetKind": element.tag}
            )
        for child in element:
            walk(child, path)

    walk(root)
    return paths, targets


def envelope_profile(element, targets, paths):
    target = value(element, "EnvelopeTarget/PointeeId")
    candidates = targets.get(target, [])
    events = []
    for event in element.findall("Automation/Events/*"):
        events.append(
            {
                "type": event.tag,
                "attributes": dict(event.attrib),
                "time": number(event.get("Time")),
                "value": scalar(event.get("Value")),
                "preroll": (number(event.get("Time")) or 0) < 0,
            }
        )
    return {
        "id": element.get("Id"),
        "path": paths.get(element),
        "targetId": target,
        "targetStatus": (
            "RESOLVED"
            if len(candidates) == 1
            else "AMBIGUOUS" if candidates else "UNRESOLVED"
        ),
        "targetCandidates": candidates,
        "events": events,
        "executionVerified": False,
    }


def media_profile(ref, track_id, source, paths, clip_id=None):
    relative = value(ref, "RelativePath")
    absolute = value(ref, "Path")
    candidate = source.parent / relative if relative else None
    return {
        "relativePath": relative,
        "originalPath": absolute,
        "fileName": Path((relative or absolute or "").replace(chr(92), "/")).name,
        "availability": (
            "LOCAL_REFERENCE_AVAILABLE"
            if candidate and candidate.is_file()
            else "MISSING_FROM_SUPPLIED_BUNDLE"
        ),
        "locationHint": value(ref, "RelativePathType"),
        "affectedTrack": track_id,
        "affectedClip": clip_id,
        "ownerPath": paths[ref],
    }


def clip_profile(clip, track_id, source, targets, paths):
    start = number(value(clip, "CurrentStart"))
    start = number(clip.get("Time")) if start is None else start
    end = number(value(clip, "CurrentEnd"))
    valid = start is not None and end is not None and end >= start
    loop = {child.tag: scalar(child.get("Value")) for child in clip.findall("Loop/*")}
    notes = []
    for key_track in clip.findall("Notes/KeyTracks/KeyTrack"):
        pitch = number(value(key_track, "MidiKey"))
        for note in key_track.findall("Notes/MidiNoteEvent"):
            notes.append(
                {
                    "id": note.get("NoteId"),
                    "pitch": pitch,
                    "time": number(note.get("Time")),
                    "duration": number(note.get("Duration")),
                    "enabled": note.get("IsEnabled", "true") == "true",
                    "velocity": number(note.get("Velocity")),
                    "probability": number(note.get("Probability", "1")),
                    "rawAttributes": dict(note.attrib),
                }
            )
    media = [
        media_profile(ref, track_id, source, paths, clip.get("Id"))
        for ref in clip.iter("FileRef")
    ]
    meters = [
        {k: scalar(value(m, k)) for k in ("Numerator", "Denominator", "Time")}
        for m in clip.iter("RemoteableTimeSignature")
    ]
    return {
        "id": clip.get("Id"),
        "kind": clip.tag,
        "name": value(clip, "Name"),
        "startBeat": start,
        "endBeat": end,
        "validBounds": valid,
        "disabled": value(clip, "Disabled", "false") == "true",
        "loop": loop,
        "meters": meters,
        "notes": notes,
        "enabledSourceNoteCount": sum(
            n["enabled"] and (n["probability"] or 0) > 0 for n in notes
        ),
        "sourceNoteCoordinates": "native source coordinates, not flattened Arrangement onsets",
        "audibleActivity": "UNVERIFIED: needs loop/offset/envelope/asset/device evaluation",
        "warpMarkers": [dict(m.attrib) for m in clip.findall("WarpMarkers/WarpMarker")],
        "warpEnabled": scalar(value(clip, "IsWarped")),
        "pitchCoarse": scalar(value(clip, "PitchCoarse")),
        "pitchFine": scalar(value(clip, "PitchFine")),
        "sampleVolume": scalar(value(clip, "SampleVolume")),
        "media": media,
        "envelopes": [
            envelope_profile(e, targets, paths) for e in clip.iter("ClipEnvelope")
        ],
        "opaqueXmlSha256": hashlib.sha256(ET.tostring(clip)).hexdigest(),
    }


def device_profiles(track, paths):
    output = []
    # Every Devices container is owned once; rack children remain distinct from top-level inserts.
    top = track.find("DeviceChain/DeviceChain/Devices")
    for container in track.iter("Devices"):
        for device in container:
            if device.get("Id") is None:
                continue
            params = []
            for element in device.iter("Manual"):
                raw = element.get("Value")
                parsed = scalar(raw)
                if isinstance(parsed, str) and len(parsed) > 128:
                    parsed = {
                        "sha256": hashlib.sha256(parsed.encode()).hexdigest(),
                        "length": len(parsed),
                    }
                params.append(
                    {
                        "path": paths[element],
                        "rawValue": parsed,
                        "units": "NOT_DECLARED/UNRESOLVED",
                    }
                )
            output.append(
                {
                    "id": device.get("Id"),
                    "tag": device.tag,
                    "path": paths[device],
                    "topLevel": container is top,
                    "parentContainer": paths[container],
                    "name": value(device, "UserName") or value(device, "Name"),
                    "enabled": scalar(value(device, "On/Manual")),
                    "parameters": params,
                    "opaqueStateSha256": hashlib.sha256(
                        ET.tostring(device)
                    ).hexdigest(),
                    "executionStatus": "NOT_ESTABLISHED_BY_XML",
                    "nativeSonicEquivalence": "UNVERIFIED",
                    "exportReopen": "UNVERIFIED",
                }
            )
    return output


def analyze_file(source):
    source = Path(source)
    raw = source.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if raw.startswith(bytes([31, 139])):
        with gzip.open(source, "rb") as stream:
            xml = stream.read(MAX_XML_BYTES + 1)
    else:
        xml = raw
    if len(xml) > MAX_XML_BYTES:
        raise ValueError("REFERENCE_SIZE: decoded XML exceeds 64 MiB")
    if b"<!DOCTYPE" in xml or b"<!ENTITY" in xml:
        raise ValueError("REFERENCE_XML: DTD/entities are not supported")
    root = ET.fromstring(xml)
    if root.tag != "Ableton":
        raise ValueError("REFERENCE_XML: unsupported root/schema namespace")
    live = root.find("LiveSet")
    if live is None:
        raise ValueError("REFERENCE_XML: LiveSet missing")
    paths, targets = index_document(root)
    tracks = []
    media = []
    for track in live.findall("Tracks/*"):
        track_id = track.get("Id")
        seq = track.find("DeviceChain/MainSequencer")
        clips = []
        if seq is not None:
            for events in seq.findall(
                "ClipTimeable/ArrangerAutomation/Events"
            ) + seq.findall("Sample/ArrangerAutomation/Events"):
                clips.extend(
                    clip_profile(c, track_id, source, targets, paths)
                    for c in events
                    if c.tag in ("MidiClip", "AudioClip")
                )
        clips.sort(
            key=lambda c: (
                c["startBeat"] if c["startBeat"] is not None else float("inf"),
                str(c["id"]),
            )
        )
        session = [
            {
                **clip_profile(c, track_id, source, targets, paths),
                "path": paths[c],
                "slotPath": paths[slot],
            }
            for slot in track.iter("ClipSlot")
            for c in slot.iter()
            if c.tag in ("MidiClip", "AudioClip")
        ]
        takes = [
            {
                **clip_profile(c, track_id, source, targets, paths),
                "path": paths[c],
                "lanePath": paths[lane],
            }
            for lane in track.iter("TakeLane")
            for c in lane.iter()
            if c.tag in ("MidiClip", "AudioClip")
        ]
        occupied = intervals_union(
            [
                (c["startBeat"], c["endBeat"])
                for c in clips
                if c["validBounds"] and not c["disabled"]
            ]
        )
        routing = {
            tag: [
                {
                    "path": paths[e],
                    "values": [
                        {x.tag: x.get("Value")}
                        for x in e.iter()
                        if x.get("Value") is not None
                    ],
                }
                for e in track.iter(tag)
            ]
            for tag in (
                "AudioInputRouting",
                "AudioOutputRouting",
                "MidiInputRouting",
                "MidiOutputRouting",
                "Sends",
                "SideChain",
            )
        }
        automation = [
            envelope_profile(e, targets, paths)
            for e in track.iter("AutomationEnvelope")
        ]
        tracks.append(
            {
                "id": track_id,
                "kind": track.tag,
                "name": local_name(track),
                "groupId": value(track, "TrackGroupId"),
                "arrangementClips": clips,
                "sessionClips": session,
                "takeClips": takes,
                "activeClipIntervalUnion": occupied,
                "representedOccupiedBeats": sum(b - a for a, b in occupied),
                "audibleOccupiedBeats": None,
                "mixer": {
                    field: scalar(
                        value(track, "DeviceChain/Mixer/" + field + "/Manual")
                    )
                    for field in ("Speaker", "Volume", "Pan", "SoloSink")
                },
                "routing": routing,
                "automation": automation,
                "devices": device_profiles(track, paths),
            }
        )
        media.extend(
            media_profile(
                ref,
                track_id,
                source,
                paths,
                next(
                    (
                        c["id"]
                        for c in clips + session + takes
                        if any(m["ownerPath"] == paths[ref] for m in c["media"])
                    ),
                    None,
                ),
            )
            for ref in track.iter("FileRef")
        )
    master = live.find("MainTrack")
    master = master if master is not None else live.find("MasterTrack")
    if master is not None:
        media.extend(
            media_profile(ref, "master", source, paths)
            for ref in master.iter("FileRef")
        )
    tempo = number(value(master, "DeviceChain/Mixer/Tempo/Manual"))
    tempo_target = (
        master.find("DeviceChain/Mixer/Tempo/AutomationTarget")
        if master is not None
        else None
    )
    master_envelopes = (
        []
        if master is None
        else [
            envelope_profile(e, targets, paths)
            for e in master.iter("AutomationEnvelope")
        ]
    )
    tempo_envelopes = [
        e
        for e in master_envelopes
        if tempo_target is not None and e["targetId"] == tempo_target.get("Id")
    ]
    max_end = max(
        [0]
        + [
            c["endBeat"]
            for t in tracks
            for c in t["arrangementClips"]
            if c["validBounds"]
        ]
    )
    kinds = {
        kind: sum(t["kind"] == kind for t in tracks)
        for kind in ("MidiTrack", "AudioTrack", "GroupTrack", "ReturnTrack")
    }
    result = {
        "profileVersion": VERSION,
        "source": {
            "fileName": source.name,
            "sha256": digest,
            "compressedBytes": len(raw),
            "xmlBytes": len(xml),
            "creator": root.get("Creator"),
            "schema": dict(root.attrib),
        },
        "summary": {
            "trackCounts": kinds,
            "arrangementClips": sum(len(t["arrangementClips"]) for t in tracks),
            "sessionClips": sum(len(t["sessionClips"]) for t in tracks),
            "takeClips": sum(len(t["takeClips"]) for t in tracks),
            "documentClipEnvelopes": len(list(root.iter("ClipEnvelope"))),
            "clipEnvelopes": sum(
                len(c["envelopes"]) for t in tracks for c in t["arrangementClips"]
            ),
            "latestRepresentedEndBeat": max_end,
            "savedTempo": tempo,
            "nominalSecondsAtSavedTempo": max_end * 60 / tempo if tempo else None,
            "audibleDurationSeconds": None,
        },
        "globalTempo": {
            "savedBpm": tempo,
            "envelopes": tempo_envelopes,
            "timedDurationStatus": "UNVERIFIED: saved BPM span is not tempo-envelope integration",
        },
        "globalMeter": {
            "encodedManual": value(master, "DeviceChain/Mixer/TimeSignature/Manual"),
            "decodedSignatures": [
                {
                    "numerator": number(value(e, "Numerator")),
                    "denominator": number(value(e, "Denominator")),
                    "time": number(value(e, "Time")),
                }
                for e in (
                    [] if master is None else master.iter("RemoteableTimeSignature")
                )
            ],
            "nativeEnumStatus": "UNRESOLVED: do not infer native enum from clip lengths",
        },
        "tracks": tracks,
        "master": {
            "devices": [] if master is None else device_profiles(master, paths),
            "automation": master_envelopes,
        },
        "mediaDependencies": media,
        "limits": [
            "Structural analysis only; rectangle occupancy is not audible activity",
            "Native source note/loop coordinates retained; no automatic beat flattening or polymeter inference",
            "Missing samples/plug-ins prevent auditory qualification",
            "Native meter enums, arbitrary target units/routing and audible envelope interpretation remain unqualified",
            "No source notes, presets or audio are licensed for redistribution by this report",
        ],
    }
    if hashlib.sha256(source.read_bytes()).hexdigest() != digest:
        raise RuntimeError("REFERENCE_CHANGED: original bytes changed during read")
    return result


def arrangement_html(profile):
    width = 1200
    end = max(1, profile["summary"]["latestRepresentedEndBeat"])
    rows = []
    for index, track in enumerate(profile["tracks"]):
        y = 36 + index * 30
        rows.append(
            f'<text x="4" y="{y+14}" fill="#cbd5e1">{html.escape(track["name"])}</text>'
        )
        for clip in track["arrangementClips"]:
            if not clip["validBounds"]:
                continue
            x = 230 + clip["startBeat"] / end * width
            w = max(0.5, (clip["endBeat"] - clip["startBeat"]) / end * width)
            title = html.escape(
                f'{clip["name"]}: {clip["startBeat"]}–{clip["endBeat"]}; LoopOn={clip["loop"].get("LoopOn")}; audible activity unverified'
            )
            rows.append(
                f'<rect x="{x}" y="{y}" width="{w}" height="20" fill="'
                + ("#64748b" if clip["disabled"] else "#f59e0b")
                + f'"><title>{title}</title></rect>'
            )
    title = html.escape(profile["source"]["fileName"])
    sha = profile["source"]["sha256"]
    height = 70 + len(profile["tracks"]) * 30
    return (
        f'<!doctype html><html><meta charset="utf-8"><title>{title} structural map</title><body style="background:#0b0d10;color:#ddd;font:13px system-ui"><h1>{title}</h1><p>Read-only Arrangement bounds. Hover for exact beats/loop flags. Source SHA-256: {sha}</p><p>Session/take clips excluded. Rectangles do not prove continuous sound. Missing media and native devices are unverified.</p><div style="overflow:auto"><svg role="img" aria-label="Structural arrangement map" width="1470" height="{height}">'
        + "".join(rows)
        + "</svg></div></body></html>"
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", nargs="+", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    sources = []
    for item in args.inputs:
        sources.extend(sorted(item.glob("*.als")) if item.is_dir() else [item])
    summary = []
    for source in sources:
        profile = analyze_file(source)
        name = source.stem.replace(" ", "_")
        (args.output / (name + ".json")).write_text(
            json.dumps(profile, indent=2) + "\n"
        )
        (args.output / (name + ".html")).write_text(arrangement_html(profile))
        summary.append({"source": profile["source"], **profile["summary"]})
    (args.output / "corpus-index.json").write_text(
        json.dumps({"profileVersion": VERSION, "profiles": summary}, indent=2) + "\n"
    )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
