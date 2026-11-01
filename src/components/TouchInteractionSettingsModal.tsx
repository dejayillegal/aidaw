import React from 'react';
import { Sliders, Smartphone, Touchpad, Check, RotateCcw, X } from 'lucide-react';

export interface TouchInteractionConfig {
  padSensitivity: number; // 0.5 to 2.0 (default 1.0)
  timelineDragThresholdPx: number; // 2 to 20 px (default 5 px)
  velocityCurveType: 'linear' | 'exponential' | 'compressed';
  hapticFeedbackEnabled: boolean;
  multitouchJamMode: boolean;
}

interface TouchInteractionSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: TouchInteractionConfig;
  onChangeConfig: (partial: Partial<TouchInteractionConfig>) => void;
}

export const DEFAULT_TOUCH_CONFIG: TouchInteractionConfig = {
  padSensitivity: 1.0,
  timelineDragThresholdPx: 5,
  velocityCurveType: 'exponential',
  hapticFeedbackEnabled: true,
  multitouchJamMode: true,
};

export const TouchInteractionSettingsModal: React.FC<TouchInteractionSettingsModalProps> = ({
  isOpen,
  onClose,
  config,
  onChangeConfig,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-fadeIn">
      <div className="w-full max-w-lg bg-[#0F131A] border border-[#232B38] rounded-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 bg-[#090C11] border-b border-[#1F2734] flex items-center justify-between select-none">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-amber-400" />
            <h3 className="font-display font-semibold text-sm text-slate-100">
              Android &amp; iOS Touch Interaction Settings
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-[#1A202C] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-6 space-y-5 font-mono text-xs text-slate-200 overflow-y-auto max-h-[80vh]">
          <p className="text-[11px] text-slate-400">
            Tune multi-touch pad velocity sensitivity, dragging deadzones, and haptic feedback response curves for mobile and tablet touchscreens.
          </p>

          {/* Pad Sensitivity Slider */}
          <div className="p-3.5 bg-[#141923] border border-[#232C3A] rounded-md space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200">Pad Velocity Sensitivity</span>
              <span className="text-amber-400 font-bold">{config.padSensitivity.toFixed(2)}x</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.05"
              value={config.padSensitivity}
              onChange={(e) => onChangeConfig({ padSensitivity: parseFloat(e.target.value) })}
              className="w-full accent-amber-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-zinc-500">
              <span>0.5x (Heavy touch required)</span>
              <span>2.0x (Ultra sensitive)</span>
            </div>
          </div>

          {/* Timeline Drag Threshold */}
          <div className="p-3.5 bg-[#141923] border border-[#232C3A] rounded-md space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200">Timeline Drag Threshold</span>
              <span className="text-amber-400 font-bold">{config.timelineDragThresholdPx} px</span>
            </div>
            <input
              type="range"
              min="2"
              max="20"
              step="1"
              value={config.timelineDragThresholdPx}
              onChange={(e) => onChangeConfig({ timelineDragThresholdPx: parseInt(e.target.value, 10) })}
              className="w-full accent-amber-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-zinc-500">
              <span>2px (Instant slip)</span>
              <span>20px (Safe deadzone)</span>
            </div>
          </div>

          {/* Velocity Curve Selector */}
          <div className="p-3.5 bg-[#141923] border border-[#232C3A] rounded-md space-y-2">
            <span className="font-semibold text-slate-200">Touch Velocity Mapping Curve</span>
            <div className="grid grid-cols-3 gap-2 pt-1">
              {(['linear', 'exponential', 'compressed'] as const).map((curve) => (
                <button
                  key={curve}
                  type="button"
                  onClick={() => onChangeConfig({ velocityCurveType: curve })}
                  className={`py-2 px-2 rounded text-center capitalize font-bold transition ${
                    config.velocityCurveType === curve
                      ? 'bg-amber-500 text-slate-950 border border-amber-400 shadow-sm'
                      : 'bg-[#0B0E14] text-slate-400 border border-[#273244] hover:text-slate-200'
                  }`}
                >
                  {curve}
                </button>
              ))}
            </div>
          </div>

          {/* Toggles */}
          <div className="space-y-2.5 pt-1">
            <label className="flex items-center justify-between p-3 bg-[#141923] border border-[#232C3A] rounded-md cursor-pointer hover:border-slate-600 transition">
              <div>
                <div className="font-semibold text-slate-200">Haptic Vibration Feedback</div>
                <div className="text-[10px] text-slate-400">Trigger subtle device vibration on pad impacts and scene triggers</div>
              </div>
              <input
                type="checkbox"
                checked={config.hapticFeedbackEnabled}
                onChange={(e) => onChangeConfig({ hapticFeedbackEnabled: e.target.checked })}
                className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between p-3 bg-[#141923] border border-[#232C3A] rounded-md cursor-pointer hover:border-slate-600 transition">
              <div>
                <div className="font-semibold text-slate-200">Multi-Touch Jam Mode</div>
                <div className="text-[10px] text-slate-400">Allow concurrent finger triggers across Drum Pads and Live Scenes</div>
              </div>
              <input
                type="checkbox"
                checked={config.multitouchJamMode}
                onChange={(e) => onChangeConfig({ multitouchJamMode: e.target.checked })}
                className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
              />
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-[#090C11] border-b border-[#1F2734] flex items-center justify-between">
          <button
            type="button"
            onClick={() => onChangeConfig(DEFAULT_TOUCH_CONFIG)}
            className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Defaults</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded text-xs transition shadow-sm"
          >
            Apply &amp; Save
          </button>
        </div>
      </div>
    </div>
  );
};
