import React, { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { Download, Smartphone, Check, X, ExternalLink } from 'lucide-react';

interface PWAInstallButtonProps {
  variant?: 'compact' | 'full';
  className?: string;
}

const STANDALONE_WEBAPK_URL =
  'https://ais-pre-rivuqsv2p5yqh2yguttcdy-90877397680.asia-southeast1.run.app';

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'compact',
  className = '',
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled && variant === 'full') {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded">
        <Check className="w-3.5 h-3.5" />
        <span>Studio App Active</span>
      </div>
    );
  }

  const handleDirectDownloadInstaller = () => {
    const link = document.createElement('a');
    link.href = '/api/download/android-installer';
    link.download = 'Parametric-ALS-DAW-Android-Tablet.html';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const renderGuideModal = () => (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs"
      onClick={() => setShowGuide(false)}
    >
      <div
        className="w-full max-w-md rounded-xl bg-[#10141D] border border-[#2B3548] p-5 shadow-2xl text-slate-100 text-left space-y-4 font-mono"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-[#212838]">
          <h3 className="text-sm font-bold flex items-center gap-2 text-emerald-400">
            <Smartphone className="w-4 h-4" />
            Download &amp; Install Android / Tablet APK
          </h3>
          <button
            type="button"
            onClick={() => setShowGuide(false)}
            className="p-1 text-slate-400 hover:text-white rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3 text-xs text-slate-300">
          {isInstallable && (
            <button
              type="button"
              onClick={async () => {
                await install();
                setShowGuide(false);
              }}
              className="w-full py-2.5 px-4 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded flex items-center justify-center gap-2 shadow-lg transition-colors"
            >
              <Smartphone className="w-4 h-4" />
              <span>Install Native Android WebAPK Now</span>
            </button>
          )}

          <div className="p-3 bg-[#0A0D14] border border-[#222A3A] rounded space-y-2">
            <div className="text-[11px] font-bold text-amber-400">
              OPTION 1: Direct Download Standalone Mobile Launcher
            </div>
            <p className="text-[11px] text-slate-400">
              Download the standalone Android &amp; Tablet launcher file directly to your device:
            </p>
            <button
              type="button"
              onClick={handleDirectDownloadInstaller}
              className="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded flex items-center justify-center gap-2 transition-colors shadow"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Android/Tablet Launcher (.html)</span>
            </button>
          </div>

          <div className="p-3 bg-[#0A0D14] border border-[#222A3A] rounded space-y-2">
            <div className="text-[11px] font-bold text-sky-400">
              OPTION 2: Install Native WebAPK via Chrome / Samsung Internet
            </div>
            <p className="text-[11px] text-slate-400">
              Open the standalone app URL in Chrome on Android/Tablet, then tap{' '}
              <strong className="text-slate-200">⋮ (Menu) &rarr; Install App</strong> to compile and
              install the signed native Android WebAPK onto your home screen:
            </p>
            <a
              href={STANDALONE_WEBAPK_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-2 px-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded flex items-center justify-center gap-2 transition-colors no-underline"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Open Standalone WebAPK Install Link</span>
            </a>
          </div>

          {isIOS && (
            <div className="p-2.5 bg-[#0A0D14] border border-[#222A3A] rounded text-[11px] text-slate-300">
              <strong>iPad / iPhone (Safari):</strong> Tap <strong>Share</strong> &rarr;{' '}
              <strong>Add to Home Screen</strong>.
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowGuide(false)}
          className="w-full py-2 bg-[#1C2433] hover:bg-[#252F42] text-slate-200 font-semibold rounded text-xs transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (isInstallable) {
            void install();
          } else {
            setShowGuide(true);
          }
        }}
        className={`flex items-center gap-1.5 text-[10px] font-mono font-bold bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1 rounded transition-all shadow-md active:scale-95 border border-emerald-400/40 shrink-0 ${className}`}
        title="Download & Install Android / Tablet APK"
      >
        <Download className="w-3 h-3" />
        <span>DOWNLOAD APK</span>
      </button>

      {showGuide && renderGuideModal()}
    </>
  );
};
