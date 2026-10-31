import React, { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { Download, Smartphone, Check, X } from 'lucide-react';

interface PWAInstallButtonProps {
  variant?: 'compact' | 'full';
  className?: string;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'compact',
  className = '',
}) => {
  const { isInstallable, isInstalled, isAndroid, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  // If already running as installed standalone app on Android/iOS/Desktop
  if (isInstalled) {
    if (variant === 'full') {
      return (
        <div className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded">
          <Check className="w-3.5 h-3.5" />
          <span>Standalone App Active</span>
        </div>
      );
    }
    return null;
  }

  // Native install prompt available (Android Chrome / Edge / Desktop Chrome)
  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className={`flex items-center gap-1.5 text-xs font-mono font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-3 py-1.5 rounded transition-all shadow-sm active:scale-95 ${className}`}
        title="Install Parametric ALS as a native Android app"
      >
        <Smartphone className="w-3.5 h-3.5" />
        <span>{isAndroid ? 'Install on Android' : 'Install PWA'}</span>
      </button>
    );
  }

  // iOS Safari flow (no automated beforeinstallprompt on iOS Safari)
  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowGuide(true)}
          className={`flex items-center gap-1.5 text-xs font-mono text-slate-200 bg-[#161B26] hover:bg-[#202738] border border-[#2B3548] px-3 py-1.5 rounded transition-all ${className}`}
        >
          <Smartphone className="w-3.5 h-3.5 text-amber-400" />
          <span>Install on iOS</span>
        </button>

        {showGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
            <div className="w-full max-w-sm rounded-xl bg-[#121620] border border-[#2B3548] p-5 shadow-2xl text-slate-100">
              <div className="flex items-center justify-between pb-3 border-b border-[#212838]">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-amber-400" />
                  Install on iPad / iPhone
                </h3>
                <button
                  type="button"
                  onClick={() => setShowGuide(false)}
                  className="p-1 text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="py-4 space-y-2.5 text-xs text-slate-300 font-mono">
                <p>To run Parametric ALS as a standalone fullscreen DAW app:</p>
                <ol className="list-decimal list-inside space-y-1.5 text-slate-300 pl-1">
                  <li>Tap the Safari <strong>Share</strong> icon in the toolbar.</li>
                  <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
                  <li>Tap <strong>Add</strong> in the top-right corner.</li>
                </ol>
              </div>

              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="w-full py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold rounded text-xs font-mono transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  // Generic fallback for desktop or Android when prompt hasn't fired yet
  return (
    <button
      type="button"
      onClick={() => setShowGuide(true)}
      className={`flex items-center gap-1.5 text-xs font-mono text-slate-200 bg-[#161B26] hover:bg-[#202738] border border-[#2B3548] px-3 py-1.5 rounded transition-all ${className}`}
      title="Install to Android / Desktop Home Screen"
    >
      <Download className="w-3.5 h-3.5 text-amber-400" />
      <span>Install App</span>

      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-xl bg-[#121620] border border-[#2B3548] p-5 shadow-2xl text-slate-100 text-left">
            <div className="flex items-center justify-between pb-3 border-b border-[#212838]">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-emerald-400" />
                Android &amp; Tablet Install
              </h3>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowGuide(false);
                }}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="py-4 space-y-2 text-xs text-slate-300 font-mono">
              <p>On Android Chrome or Samsung Internet:</p>
              <p className="p-2 bg-[#0A0D14] border border-[#222A3A] rounded text-emerald-300">
                Tap <strong>⋮ (Menu)</strong> &rarr; <strong>Install App</strong> or <strong>Add to Home screen</strong>.
              </p>
              <p className="text-[11px] text-slate-400">
                Once installed, the app launches in full standalone low-latency audio mode with no address bar.
              </p>
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowGuide(false);
              }}
              className="w-full py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold rounded text-xs font-mono transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </button>
  );
};
