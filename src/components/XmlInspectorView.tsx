import React, { useMemo, useState } from 'react';
import { AbletonProjectState } from '../types/ableton';
import { Check, Copy, Download, FileCode } from 'lucide-react';

interface XmlInspectorViewProps {
  project: AbletonProjectState;
  onDownloadAls: () => void;
}

type XmlFilterMode = 'all' | 'injected_tracks' | 'operator_chain' | 'lfo_drift' | 'midi_notes';

export const XmlInspectorView: React.FC<XmlInspectorViewProps> = ({
  project,
  onDownloadAls,
}) => {
  const [filterMode, setFilterMode] = useState<XmlFilterMode>('all');
  const [copied, setCopied] = useState(false);

  const displayedXml = useMemo(() => {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(project.rawXmlModified, 'application/xml');
    const serializer = new XMLSerializer();

    if (filterMode === 'injected_tracks') {
      const injected = Array.from(xmlDoc.querySelectorAll('MidiTrack')).filter(
        (el) => el.getAttribute('Data-Parametric-Injected') === 'true'
      );
      if (injected.length === 0) {
        return '<!-- No AI-generated <MidiTrack> nodes injected yet. Click "Inject Missing Layers" in the Workbench to populate native XML tracks. -->';
      }
      return injected.map((el) => serializer.serializeToString(el)).join('\n\n');
    }

    if (filterMode === 'operator_chain') {
      const chains = Array.from(xmlDoc.querySelectorAll('MidiToAudioDeviceChain'));
      return chains.map((el) => serializer.serializeToString(el)).join('\n\n');
    }

    if (filterMode === 'lfo_drift') {
      const lfos = Array.from(xmlDoc.querySelectorAll('Lfo, AutoFilter'));
      if (lfos.length === 0) {
        return '<!-- No <Lfo> nodes injected yet. Inject a layer to append <Lfo> mapped to <AutoFilter><Cutoff>. -->';
      }
      return lfos.map((el) => serializer.serializeToString(el)).join('\n\n');
    }

    if (filterMode === 'midi_notes') {
      const clips = Array.from(xmlDoc.querySelectorAll('MidiClip'));
      return clips.map((el) => serializer.serializeToString(el)).join('\n\n');
    }

    return project.rawXmlModified;
  }, [project.rawXmlModified, filterMode]);

  const handleCopyXml = async () => {
    await navigator.clipboard.writeText(displayedXml);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownloadRawXml = () => {
    const blob = new Blob([project.rawXmlModified], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = project.fileName.replace(/\.als$/i, '') + '_decompressed.xml';
    a.click();
    URL.revokeObjectURL(url);
  };

  const injectedTrackCount = project.tracks.filter((t) => t.isGenerated).length;
  const totalNoteNodes = project.tracks.reduce(
    (sum, t) => sum + t.clips.reduce((cSum, c) => cSum + c.notes.length, 0),
    0
  );

  return (
    <div className="flex flex-col h-full bg-[#0B0D10] p-6 gap-5">
      {/* Header & Schema Metrics */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#232934]">
        <div>
          <h2 className="text-lg font-display font-semibold text-slate-100">
            Ableton Live 12 DOM Tree &amp; XML Diff Inspector
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 font-mono tabular-nums mt-1">
            <span>Schema: {project.schemaVersion}</span>
            <span>·</span>
            <span>Tracks: {project.tracks.length} ({injectedTrackCount} Injected)</span>
            <span>·</span>
            <span>&lt;MidiNoteEvent&gt; Nodes: {totalNoteNodes}</span>
            <span>·</span>
            <span>Uncompressed XML: {(project.rawByteSize / 1024).toFixed(1)} KB</span>
            <span>·</span>
            <span className="text-emerald-400">
              Est. Gzip .als Payload: ~{(project.estimatedGzipByteSize / 1024).toFixed(1)} KB
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleCopyXml}
            className="px-3 py-2 text-xs font-mono bg-[#161B24] hover:bg-[#1F2633] text-slate-200 border border-[#28303E] rounded flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied XML' : 'Copy XML Nodes'}
          </button>

          <button
            type="button"
            onClick={handleDownloadRawXml}
            className="px-3 py-2 text-xs font-mono bg-[#161B24] hover:bg-[#1F2633] text-slate-200 border border-[#28303E] rounded flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            <FileCode className="w-3.5 h-3.5 text-sky-400" />
            Download Uncompressed .xml
          </button>

          <button
            type="button"
            onClick={onDownloadAls}
            className="px-4 py-2 text-xs font-mono font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Export Gzipped .als
          </button>
        </div>
      </div>

      {/* Interactive Filter Segmented Bar */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 bg-[#12161F] border border-[#232934] rounded w-fit">
        {(
          [
            { id: 'all', label: 'Full Ableton .als XML DOM' },
            { id: 'injected_tracks', label: 'Injected <MidiTrack> Nodes' },
            { id: 'operator_chain', label: '<DeviceChain> (Operator / Reverb / AutoFilter)' },
            { id: 'lfo_drift', label: '<Lfo> → <Cutoff> Analog Drift' },
            { id: 'midi_notes', label: '<MidiClip> & <MidiNoteEvent> Stream' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilterMode(tab.id)}
            className={`px-3 py-1.5 text-xs font-mono rounded transition-colors whitespace-nowrap shrink-0 ${
              filterMode === tab.id
                ? 'bg-amber-500 text-slate-950 font-semibold'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* XML Source Viewport */}
      <div className="flex-1 bg-[#0E1117] border border-[#232934] rounded overflow-auto p-4">
        <pre className="text-xs font-mono leading-relaxed text-slate-200 select-all">
          <code>{displayedXml}</code>
        </pre>
      </div>
    </div>
  );
};
