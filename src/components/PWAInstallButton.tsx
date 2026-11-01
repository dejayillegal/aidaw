import React, { useState } from 'react';
import { Check, Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { downloadDebugApk } from '../utils/apkDownloader';

interface PWAInstallButtonProps {
  className?: string;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ className = '' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [downloadingApk, setDownloadingApk] = useState(false);
  const [apkDone, setApkDone] = useState(false);

  const handleDownloadApk = async () => {
    if (downloadingApk) return;
    setDownloadingApk(true);
    try {
      await downloadDebugApk('parametric-techno-daw-debug.apk');
      setApkDone(true);
      setTimeout(() => setApkDone(false), 2500);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'APK download failed.');
    } finally {
      setDownloadingApk(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button
        type="button"
        onClick={handleDownloadApk}
        className={`px-2 py-0.5 text-[10px] font-mono bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 rounded flex items-center gap-1 transition-colors shadow-sm shrink-0 cursor-pointer ${className}`}
        title="Download Compiled Android Debug APK (parametric-techno-daw-debug.apk)"
      >
        {apkDone ? (
          <>
            <Check className="w-3 h-3 text-emerald-400" />
            <span>APK Downloaded</span>
          </>
        ) : (
          <>
            <Download className="w-3 h-3 text-emerald-400" />
            <span>{downloadingApk ? 'Downloading APK...' : 'Download Debug APK'}</span>
          </>
        )}
      </button>

      {!isInstalled && isInstallable && (
        <button
          type="button"
          onClick={install}
          className={`px-2 py-0.5 text-[10px] font-mono bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded flex items-center gap-1 transition-colors shadow-sm shrink-0 ${className}`}
          title="Install Android / Desktop PWA"
        >
          <Smartphone className="w-3 h-3" />
          <span>Install PWA</span>
        </button>
      )}

      {!isInstalled && isIOS && (
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className={`px-2 py-0.5 text-[10px] font-mono bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 rounded flex items-center gap-1 transition-colors shadow-sm shrink-0 ${className}`}
          title="Install on iOS Home Screen"
        >
          <Smartphone className="w-3 h-3" />
          <span>iOS App</span>
        </button>
      )}

      {showIOSGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-xl bg-[#11151C] border border-[#232934] p-6 shadow-2xl text-slate-100 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#232934]">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-indigo-400" />
                <h3 className="text-sm font-display font-semibold">Install on iPhone &amp; iPad</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <ol className="text-xs font-mono space-y-2.5 text-slate-300 list-decimal pl-4">
              <li>
                Tap the <strong className="text-amber-400">Share</strong> icon in the Safari toolbar at the bottom of your screen.
              </li>
              <li>
                Scroll down the share sheet and tap <strong className="text-amber-400">Add to Home Screen</strong>.
              </li>
              <li>
                Confirm by tapping <strong className="text-amber-400">Add</strong> in the top right corner.
              </li>
            </ol>
            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-mono text-xs font-semibold transition"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </div>
  );
};



