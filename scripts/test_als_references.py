import gzip, hashlib, importlib.util, tempfile, unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "als_references", Path(__file__).with_name("analyze-als-references.py")
)
analysis = importlib.util.module_from_spec(spec)
spec.loader.exec_module(analysis)
XML = """<Ableton Creator="Ableton Live 12.1.1"><LiveSet><Tracks><MidiTrack Id="1"><Name><EffectiveName Value="Layer &amp; tone"/></Name><TrackGroupId Value="-1"/><DeviceChain><MainSequencer><ClipTimeable><ArrangerAutomation><Events>
<MidiClip Id="a" Time="0.125"><CurrentStart Value="0.125"/><CurrentEnd Value="25.125"/><Loop><LoopStart Value="2"/><LoopEnd Value="9"/><LoopOn Value="false"/><StartRelative Value="0.5"/></Loop><Notes><KeyTracks><KeyTrack><MidiKey Value="60"/><Notes><MidiNoteEvent NoteId="1" Time="2" Duration="1" Velocity="90" IsEnabled="false" Probability="0.5"/></Notes></KeyTrack></KeyTracks></Notes></MidiClip>
<MidiClip Id="b" Time="24"><CurrentStart Value="24"/><CurrentEnd Value="30"/></MidiClip></Events></ArrangerAutomation></ClipTimeable><ClipSlotList><ClipSlot><MidiClip Id="session"><CurrentStart Value="0"/><CurrentEnd Value="1000"/><Loop><LoopOn Value="true"/></Loop></MidiClip></ClipSlot></ClipSlotList></MainSequencer><DeviceChain><Devices><OriginalSampler Id="4"><SampleRef><FileRef><RelativePath Value="missing-kick.wav"/></FileRef></SampleRef><Gain><AutomationTarget Id="42"/><Manual Value="-6"/></Gain></OriginalSampler></Devices></DeviceChain></DeviceChain><AutomationEnvelopes><Envelopes><AutomationEnvelope Id="0"><EnvelopeTarget><PointeeId Value="42"/></EnvelopeTarget><Automation><Events><FloatEvent Time="-63072000" Value="-6"/><FloatEvent Time="8" Value="-3"/></Events></Automation></AutomationEnvelope></Envelopes></AutomationEnvelopes></MidiTrack></Tracks><MainTrack><DeviceChain><Mixer><Tempo><Manual Value="140"/></Tempo></Mixer></DeviceChain></MainTrack></LiveSet></Ableton>"""


class ReferenceAnalysis(unittest.TestCase):
    def test_unions_do_not_double_count_or_infer_sound(self):
        self.assertEqual(
            analysis.intervals_union([(0.125, 25.125), (24, 30), (36, 40)]),
            [[0.125, 30], [36, 40]],
        )

    def test_readonly_fractional_loop_session_targets_and_device_media(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "reference.als"
            original = gzip.compress(XML.encode())
            p.write_bytes(original)
            result = analysis.analyze_file(p)
            self.assertEqual(p.read_bytes(), original)
            self.assertEqual(
                result["source"]["sha256"], hashlib.sha256(original).hexdigest()
            )
            self.assertEqual(result["summary"]["latestRepresentedEndBeat"], 30)
            self.assertEqual(result["summary"]["arrangementClips"], 2)
            self.assertEqual(result["summary"]["sessionClips"], 1)
            track = result["tracks"][0]
            self.assertEqual(track["representedOccupiedBeats"], 29.875)
            self.assertIsNone(track["audibleOccupiedBeats"])
            clip = track["arrangementClips"][0]
            self.assertFalse(clip["loop"]["LoopOn"])
            self.assertEqual(clip["loop"]["StartRelative"], 0.5)
            self.assertEqual(clip["notes"][0]["time"], 2)
            self.assertFalse(clip["notes"][0]["enabled"])
            self.assertEqual(track["automation"][0]["targetStatus"], "RESOLVED")
            self.assertTrue(track["automation"][0]["events"][0]["preroll"])
            self.assertEqual(
                result["mediaDependencies"][0]["fileName"], "missing-kick.wav"
            )
            self.assertEqual(result["mediaDependencies"][0]["affectedTrack"], "1")
            self.assertIn(
                "OriginalSampler", result["mediaDependencies"][0]["ownerPath"]
            )

    def test_master_dependencies_are_not_lost(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "master.als"
            p.write_text(
                XML.replace(
                    "<MainTrack>",
                    '<MainTrack><DeviceChain><DeviceChain><Devices><Convolution Id="88"><FileRef><RelativePath Value="missing-ir.wav"/></FileRef></Convolution></Devices></DeviceChain></DeviceChain>',
                )
            )
            media = analysis.analyze_file(p)["mediaDependencies"]
            self.assertEqual(media[-1]["affectedTrack"], "master")
            self.assertEqual(media[-1]["fileName"], "missing-ir.wav")

    def test_unsafe_document_is_rejected_without_mutating_input(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "unsafe.als"
            p.write_bytes(b"<!DOCTYPE Ableton><Ableton><LiveSet/></Ableton>")
            with self.assertRaisesRegex(ValueError, "DTD"):
                analysis.analyze_file(p)


if __name__ == "__main__":
    unittest.main()
