import React, { useState } from 'react';
import { AbletonProjectState } from '../types/ableton';
import { synthEngine } from '../engine/webAudioSynth';
import { Sparkles } from 'lucide-react';

interface TouchJamPadsProps {
  project: AbletonProjectState;
  selectedTrackId: string;
  onSelectTrack: (trackId: string) => void;
}

interface PadDef {
  archetype: string;
  label: string;
  subLabel: string;
  defaultPitch: number;
  color: string;
  glowColor: string;
}

const PAD_CONFIGS: PadDef[] = [
  {
    archetype: 'kick',
    label: '909 KICK',
    subLabel: 'Drum Buss Punch',
    defaultPitch: 36,
    color: '#F59E0B',
    glowColor: 'rgba(245, 158, 11, 0.45)',
  },
  {
    archetype: 'rumble',
    label: 'RUMBLE SUB',
    subLabel: 'Operator Sine LPF',
    defaultPitch: 29,
    color: '#38BDF8',
    glowColor: 'rgba(56, 189, 248, 0.45)',
  },
  {
    archetype: 'acid',
    label: '303 ACID',
    subLabel: 'Diode Resonance + Slide',
    defaultPitch: 41,
    color: '#A3E635',
    glowColor: 'rgba(163, 230, 53, 0.45)',
  },
  {
    archetype: 'percussion',
    label: '3/16 PERC',
    subLabel: 'Collision Metallic',
    defaultPitch: 53,
    color: '#FB923C',
    glowColor: 'rgba(251, 146, 60, 0.45)',
  },
  {
    archetype: 'synth',
    label: 'HYPNOTIC STAB',
    subLabel: 'Wavetable Chord',
    defaultPitch: 65,
    color: '#C084FC',
    glowColor: 'rgba(192, 132, 252, 0.45)',
  },
  {
    archetype: 'pad',
    label: 'DUB CHORD PAD',
    subLabel: 'Drift Minor 9th',
    defaultPitch: 65,
    color: '#818CF8',
    glowColor: 'rgba(129, 140, 248, 0.45)',
  },
  {
    archetype: 'hats',
    label: '909 HI-HAT',
    subLabel: 'Offbeat Simpler',
    defaultPitch: 46,
    color: '#34D399',
    glowColor: 'rgba(52, 211, 153, 0.45)',
  },
  {
    archetype: 'ride',
    label: '909 RIDE',
    subLabel: 'Warehouse Shimmer',
    defaultPitch: 51,
    color: '#22D3EE',
    glowColor: 'rgba(34, 211, 238, 0.45)',
  },
];

export const TouchJamPads: React.FC<TouchJamPadsProps> = ({
  project,
  selectedTrackId,
  onSelectTrack,
}) => {
  const [activePad, setActivePad] = useState<string | null>(null);

  const handlePadTrigger = (archetype: string, e: React.TouchEvent | React.MouseEvent) => {
    if ('touches' in e && e.cancelable) {
      e.preventDefault();
    }

    const padRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const clientY =
      'touches' in e && e.touches.length > 0
        ? e.touches[0].clientY
        : (e as React.MouseEvent).clientY;

    const relY = Math.max(0, Math.min(1, (clientY - padRect.top) / padRect.height));
    const vel = Math.round(122 - relY * 50);

    const track = project.tracks.find((t) => t.archetype === archetype);
    if (track) {
      onSelectTrack(track.id);
    }

    synthEngine.triggerLivePad(archetype, vel);
    setActivePad(archetype);
    setTimeout(() => {
      setActivePad((curr) => (curr === archetype ? null : curr));
    }, 120);
  };

  return (
    <div className="bg-[#0C0F14] border border-[#212838] rounded-lg p-3 space-y-2 select-none">
      <div className="flex items-center justify-between text-xs font-mono text-slate-300">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span className="font-semibold text-slate-100 uppercase tracking-wider">
            ABLETON PERFORMANCE JAM PADS (8-VOICE STUDIO MATRIX)
          </span>
        </div>
        <span className="text-[10px] text-slate-400 hidden sm:inline">
          Tap pad to audition &amp; play live · Velocity-sensitive Y-axis
        </span>
      </div>

      {/* 8-Pad Grid (Push / Ableton Note style) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {PAD_CONFIGS.map((pad) => {
          const track = project.tracks.find((t) => t.archetype === pad.archetype);
          const isSelected = track?.id === selectedTrackId;
          const isTriggered = activePad === pad.archetype;

          return (
            <button
              key={pad.archetype}
              type="button"
              onTouchStart={(e) => handlePadTrigger(pad.archetype, e)}
              onMouseDown={(e) => handlePadTrigger(pad.archetype, e)}
              className={`relative h-24 sm:h-28 rounded-lg border flex flex-col justify-between p-2.5 transition-all duration-75 text-left active:scale-95 touch-none ${
                isTriggered
                  ? 'brightness-135 shadow-lg scale-[0.98]'
                  : 'brightness-100 hover:border-slate-500'
              } ${isSelected ? 'ring-2 ring-amber-400/80' : ''}`}
              style={{
                backgroundColor: isTriggered ? `${pad.color}33` : '#131822',
                borderColor: isTriggered ? pad.color : isSelected ? '#F59E0B' : '#232C3E',
                boxShadow: isTriggered ? `0 0 20px ${pad.glowColor}` : 'none',
              }}
            >
              <div className="flex items-center justify-between w-full">
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{
                    backgroundColor: pad.color,
                    boxShadow: `0 0 8px ${pad.color}`,
                  }}
                />
                <span className="text-[9px] font-mono text-slate-400">
                  {track ? (track.muted ? 'MUTED' : 'ACTIVE') : 'READY'}
                </span>
              </div>

              <div>
                <div className="text-xs font-mono font-bold text-slate-100 tracking-wide truncate">
                  {pad.label}
                </div>
                <div className="text-[9.5px] font-mono text-slate-400 truncate mt-0.5">
                  {pad.subLabel}
                </div>
              </div>

              <div className="w-full h-1 bg-[#1A2230] rounded-full overflow-hidden">
                <div
                  className="h-full transition-all duration-100"
                  style={{
                    width: isTriggered ? '100%' : '20%',
                    backgroundColor: pad.color,
                  }}
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
