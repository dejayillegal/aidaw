import React, { useMemo, useState } from 'react';
import { HumanizationConfig } from '../types/ableton';
import { generatePythonFastApiCode } from '../engine/pythonFastApiCode';
import { Check, Copy, Download, Terminal } from 'lucide-react';

interface PythonFastApiViewProps {
  humanization: HumanizationConfig;
}

export const PythonFastApiView: React.FC<PythonFastApiViewProps> = ({ humanization }) => {
  const [copied, setCopied] = useState(false);
  const [selectedSection, setSelectedSection] = useState<'all' | 'task1' | 'task2' | 'task3' | 'endpoint'>('all');

  const fullPythonCode = useMemo(() => generatePythonFastApiCode(humanization), [humanization]);

  const displayedCode = useMemo(() => {
    if (selectedSection === 'all') return fullPythonCode;
    const markers: Record<string, [string, string]> = {
      task1: ['# TASK 1: THE PARSER ENGINE', '# TASK 2: THE TECHNO LAYER GENERATOR'],
      task2: ['# TASK 2: THE TECHNO LAYER GENERATOR', '# TASK 3: AUTOMATION & DRIFT'],
      task3: ['# TASK 3: AUTOMATION & DRIFT', '# FASTAPI MULTIPART ENDPOINT'],
      endpoint: ['# FASTAPI MULTIPART ENDPOINT', ''],
    };
    const [startMarker, endMarker] = markers[selectedSection];
    const startIdx = fullPythonCode.indexOf(startMarker);
    if (startIdx === -1) return fullPythonCode;
    const endIdx = endMarker ? fullPythonCode.indexOf(endMarker) : fullPythonCode.length;
    return fullPythonCode.slice(Math.max(0, startIdx - 70), endIdx > startIdx ? endIdx : undefined).trim();
  }, [fullPythonCode, selectedSection]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(fullPythonCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownloadPy = () => {
    const blob = new Blob([fullPythonCode], { type: 'text/x-python' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'als_techno_engine.py';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full bg-[#0B0D10] p-6 gap-5">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#232934]">
        <div>
          <h2 className="text-lg font-display font-semibold text-slate-100">
            Production Python FastAPI + lxml + gzip Backend Engine
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 font-mono tabular-nums mt-1">
            <span>File: als_techno_engine.py</span>
            <span>·</span>
            <span>Dependencies: fastapi, uvicorn, lxml, python-multipart</span>
            <span>·</span>
            <span className="text-amber-400">
              Live Synced Jitter: ±{humanization.microTimingMaxShiftBeats.toFixed(3)} beats / LFO: {humanization.lfoRateHz.toFixed(2)} Hz
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleCopy}
            className="px-3 py-2 text-xs font-mono bg-[#161B24] hover:bg-[#1F2633] text-slate-200 border border-[#28303E] rounded flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied Python Script' : 'Copy Full Python Code'}
          </button>

          <button
            type="button"
            onClick={handleDownloadPy}
            className="px-4 py-2 text-xs font-mono font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Download als_techno_engine.py
          </button>
        </div>
      </div>

      {/* Task Filter Bar + CLI Run Instructions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-[#12161F] border border-[#232934] rounded">
          {(
            [
              { id: 'all', label: 'Complete FastAPI Script' },
              { id: 'task1', label: 'Task 1: Gzip Parser & inject_midi_clip()' },
              { id: 'task2', label: 'Task 2: TechnoHeuristicEngine (Operator + 16-Bar Sub)' },
              { id: 'task3', label: 'Task 3: inject_analog_drift (<Lfo> → <Cutoff>)' },
              { id: 'endpoint', label: 'POST /process-als Multipart Endpoint' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedSection(item.id)}
              className={`px-3 py-1.5 text-xs font-mono rounded transition-colors whitespace-nowrap shrink-0 ${
                selectedSection === item.id
                  ? 'bg-amber-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#12161F] border border-[#232934] rounded text-xs font-mono text-slate-300">
          <Terminal className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <code>curl -X POST -F &quot;file=@incomplete.als&quot; http://localhost:8000/process-als --output finished.als</code>
        </div>
      </div>

      {/* Code Viewport */}
      <div className="flex-1 bg-[#0E1117] border border-[#232934] rounded overflow-auto p-4">
        <pre className="text-xs font-mono leading-relaxed text-slate-200 select-all">
          <code>{displayedCode}</code>
        </pre>
      </div>
    </div>
  );
};
