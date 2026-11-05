import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Database,
  Disc,
  Download,
  FolderOpen,
  Layers,
  PlusCircle,
  RefreshCw,
  ShieldCheck,
  Volume2,
  Wrench,
} from 'lucide-react';
import { TimelineEditMode } from '../types/ableton';
import { StudioEditingTool } from './StudioEditorToolbar';
import type {
  BlockedRecoveryRecordInfo,
  RecoveryMigrationStatus,
} from '../services/projectQueueService';

interface StudioStatusBarProps {
  projectName: string;
  projectRevision: number;
  trackCount: number;
  activeSoloCount: number;
  editMode: TimelineEditMode;
  activeTool: StudioEditingTool;
  isPlaying: boolean;
  isExportingWav?: boolean;
  wavExportProgress?: number;
  onCancelExport?:()=>void;
  canCancelExport?:boolean;
  statusMessage?: string;
  alsValid: boolean;
  canUndo: boolean;
  canRedo: boolean;
  storageStatus?: string;
  migrationStatus?: RecoveryMigrationStatus;
  recoveryBannerActive?: boolean;
  blockedRecoveryRecords?: BlockedRecoveryRecordInfo[];
  onRetryRecovery?: () => void;
  onRepairLegacyProject?: (queueId?: string) => void;
  onExportOriginalRecoveryData?: (queueId?: string) => void;
  onQuarantineRecovery?: (queueId: string) => void;
  onOpenSavedProject?: () => void;
  onStartSeparateProject?: () => void;
}

export const StudioStatusBar: React.FC<StudioStatusBarProps> = ({
  projectName,
  projectRevision,
  trackCount,
  activeSoloCount,
  editMode,
  activeTool,
  isPlaying,
  isExportingWav = false,
  wavExportProgress = 0,
  onCancelExport,
  canCancelExport=true,
  statusMessage,
  alsValid,
  storageStatus = 'saved',
  migrationStatus = 'idle',
  recoveryBannerActive = false,
  blockedRecoveryRecords = [],
  onRetryRecovery,
  onRepairLegacyProject,
  onExportOriginalRecoveryData,
  onQuarantineRecovery,
  onOpenSavedProject,
  onStartSeparateProject,
}) => {
  const clampedWavPct = Math.max(0, Math.min(100, Math.round(wavExportProgress)));

  const criticalMessage = /^(Recovery (blocked|failed|storage warning)|Edit rejected|Playback blocked|Project (open|save) failed|Export failed|Lossless WAV render failed|Failed|Error)/i.test(
    statusMessage || ''
  );
  const isRecoveryFailure =
    /^Recovery (blocked|failed|storage warning)/i.test(statusMessage || '') ||
    recoveryBannerActive;
  const isPlaybackBlocked = /^Playback blocked/i.test(statusMessage || '');

  const playbackLabel = isPlaying
    ? 'PLAYING'
    : isPlaybackBlocked
    ? 'PLAYBACK BLOCKED'
    : isRecoveryFailure
    ? 'RECOVERY BLOCKED'
    : 'ENGINE READY';

  const playbackDotClass = isPlaying
    ? 'bg-amber-400 animate-pulse'
    : isPlaybackBlocked || isRecoveryFailure
    ? 'bg-rose-400'
    : 'bg-emerald-400';

  const effectiveStorageLabel = isRecoveryFailure
    ? 'BLOCKED'
    : storageStatus === 'error'
    ? 'ERROR'
    : storageStatus === 'pending'
    ? 'PENDING'
    : storageStatus === 'unavailable'
    ? 'UNAVAILABLE'
    : 'SAVED';

  const effectiveMigrationLabel =
    migrationStatus === 'migrated'
      ? 'MIGRATED'
      : migrationStatus === 'repaired'
      ? 'REPAIRED'
      : migrationStatus === 'repair_required'
      ? 'REPAIR REQUIRED'
      : migrationStatus === 'blocked'
      ? 'BLOCKED'
      : migrationStatus === 'current'
      ? 'CURRENT'
      : 'IDLE';

  const showRecoveryWorkflow =
    recoveryBannerActive || (isRecoveryFailure && blockedRecoveryRecords.length > 0);
  const primaryRepairable = blockedRecoveryRecords.find((r) => r.canRepairLegacyConversions);

  return (
    <>
      {criticalMessage && (
        <div
          role="alert"
          className="shrink-0 max-h-24 overflow-auto break-words px-3 py-2 bg-amber-950 text-amber-100 text-xs border-t border-amber-700"
        >
          {statusMessage}
        </div>
      )}
      {showRecoveryWorkflow && (
        <div
          role="region"
          aria-label="Recovery Workflow Actions"
          className="shrink-0 px-3 py-2 bg-[#1A120B] text-amber-100 text-xs border-t border-amber-800/80 flex flex-col gap-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-mono text-[11px] text-amber-200">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>
                Unresolved Recovery Records ({blockedRecoveryRecords.length}): Stored records in
                IndexedDB are preserved unchanged.
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {onRetryRecovery && (
                <button
                  type="button"
                  onClick={onRetryRecovery}
                  className="px-2.5 py-1 rounded bg-[#272018] hover:bg-[#352B20] border border-amber-600/60 text-amber-100 font-mono text-[11px] flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  Retry Recovery
                </button>
              )}
              {onRepairLegacyProject && primaryRepairable && (
                <button
                  type="button"
                  onClick={() => onRepairLegacyProject(primaryRepairable.queueId)}
                  className="px-2.5 py-1 rounded bg-emerald-950 hover:bg-emerald-900 border border-emerald-500/70 text-emerald-100 font-mono text-[11px] flex items-center gap-1"
                >
                  <Wrench className="w-3 h-3" />
                  Repair Legacy Project
                </button>
              )}
              {onExportOriginalRecoveryData && (
                <button
                  type="button"
                  onClick={() =>
                    onExportOriginalRecoveryData(blockedRecoveryRecords[0]?.queueId)
                  }
                  className="px-2.5 py-1 rounded bg-[#1B222D] hover:bg-[#252F3F] border border-slate-600 text-slate-100 font-mono text-[11px] flex items-center gap-1"
                >
                  <Download className="w-3 h-3" />
                  Export Original Recovery Data
                </button>
              )}
              {onOpenSavedProject && (
                <button
                  type="button"
                  onClick={onOpenSavedProject}
                  className="px-2.5 py-1 rounded bg-[#1B222D] hover:bg-[#252F3F] border border-slate-600 text-slate-100 font-mono text-[11px] flex items-center gap-1"
                >
                  <FolderOpen className="w-3 h-3" />
                  Open Saved Project
                </button>
              )}
              {onStartSeparateProject && (
                <button
                  type="button"
                  onClick={onStartSeparateProject}
                  className="px-2.5 py-1 rounded bg-[#1B222D] hover:bg-[#252F3F] border border-slate-600 text-slate-100 font-mono text-[11px] flex items-center gap-1"
                >
                  <PlusCircle className="w-3 h-3" />
                  Start Separate Project
                </button>
              )}
            </div>
          </div>
          {blockedRecoveryRecords.length > 0 && (
            <ul
              aria-label="Unresolved recovery projects"
              className="space-y-1 max-h-24 overflow-y-auto font-mono text-[11px] text-amber-200/90"
            >
              {blockedRecoveryRecords.map((rec) => (
                <li
                  key={rec.queueId}
                  data-testid={`blocked-recovery-item-${rec.queueId}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-2 py-1 rounded bg-black/30 border border-amber-900/50"
                >
                  <span className="truncate">
                    <strong>{rec.originalFilename}</strong> ({rec.queueId}) — {rec.error}
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {rec.canRepairLegacyConversions && onRepairLegacyProject && (
                      <button
                        type="button"
                        onClick={() => onRepairLegacyProject(rec.queueId)}
                        className="px-2 py-0.5 rounded bg-emerald-900/70 hover:bg-emerald-800 border border-emerald-500/50 text-emerald-100 text-[10px]"
                      >
                        Repair {rec.originalFilename}
                      </button>
                    )}
                    {onQuarantineRecovery && <button type="button" className="px-2 py-0.5 rounded bg-slate-800 border border-slate-600" onClick={() => onQuarantineRecovery(rec.queueId)}>Quarantine copy</button>}
                    {onExportOriginalRecoveryData && (
                      <button
                        type="button"
                        onClick={() => onExportOriginalRecoveryData(rec.queueId)}
                        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 text-[10px]"
                      >
                        Export {rec.queueId}
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!criticalMessage && statusMessage && (
        <div
          role="status"
          aria-live="polite"
          className="lg:hidden shrink-0 max-h-20 overflow-auto break-words px-3 py-1 bg-[#080A0D] text-zinc-300 text-xs border-t border-[#1C222C]"
        >
          {statusMessage}
        </div>
      )}
      <div className={`${isExportingWav?'min-h-14':'h-6.5'} bg-[#080A0D] border-t border-[#1C222C] px-3 flex items-center justify-between text-[10px] font-mono text-zinc-400 select-none shrink-0 z-30`}>
        {/* LEFT: SEPARATED PLAYBACK, STORAGE & MIGRATION STATUS */}
        <div className={`${isExportingWav?'hidden sm:flex':'flex'} items-center gap-3`}>
          <div className="flex items-center gap-1.5 text-zinc-300" data-testid="status-bar-playback">
            <span className={`w-1.5 h-1.5 rounded-full ${playbackDotClass}`} />
            <span className="font-bold text-zinc-200">{playbackLabel}</span>
            <span className="text-zinc-600">·</span>
            <span>48kHz 32-bit float</span>
          </div>

          <div
            className="hidden sm:flex items-center gap-1 text-zinc-400 border-l border-[#1C222C] pl-2"
            data-testid="status-bar-storage"
          >
            <Database className="w-3 h-3 text-zinc-500" />
            <span>STORAGE:</span>
            <span
              className={
                effectiveStorageLabel === 'SAVED'
                  ? 'text-emerald-400 font-semibold'
                  : effectiveStorageLabel === 'PENDING'
                  ? 'text-amber-300 font-semibold'
                  : 'text-rose-400 font-semibold'
              }
            >
              {effectiveStorageLabel}
            </span>
          </div>

          <div
            className="hidden md:flex items-center gap-1 text-zinc-400 border-l border-[#1C222C] pl-2"
            data-testid="status-bar-migration"
          >
            <span>MIGRATION:</span>
            <span
              className={
                effectiveMigrationLabel === 'MIGRATED' ||
                effectiveMigrationLabel === 'REPAIRED' ||
                effectiveMigrationLabel === 'CURRENT'
                  ? 'text-emerald-400 font-semibold'
                  : effectiveMigrationLabel === 'REPAIR REQUIRED'
                  ? 'text-amber-300 font-semibold'
                  : effectiveMigrationLabel === 'BLOCKED'
                  ? 'text-rose-400 font-semibold'
                  : 'text-zinc-400 font-semibold'
              }
            >
              {effectiveMigrationLabel}
            </span>
          </div>

          {activeSoloCount > 0 ? (
            <div className="flex items-center gap-1 px-1.5 py-0.2 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold">
              <Volume2 className="w-3 h-3" />
              <span>
                SOLO: {activeSoloCount} TRACK{activeSoloCount > 1 ? 'S' : ''} ACTIVE
              </span>
            </div>
          ) : (
            <div className="hidden xl:flex items-center gap-1 text-zinc-500">
              <span>SOLO: NONE</span>
            </div>
          )}

          <div className="hidden lg:flex items-center gap-1 text-zinc-400 border-l border-[#1C222C] pl-2">
            <span className="uppercase text-zinc-500">TOOL:</span>
            <span className="text-zinc-200 uppercase font-semibold">{activeTool}</span>
            <span className="text-zinc-600">/</span>
            <span className="text-amber-400 uppercase font-semibold">{editMode}</span>
          </div>
        </div>

        {/* CENTER: REAL-TIME OPERATION MESSAGE & WAV EXPORT PROGRESS BAR */}
        <div className="flex items-center gap-2 truncate max-w-lg text-zinc-300 text-center px-2">
          {isExportingWav && (
            <div className="flex items-center gap-2 px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 shrink-0">
              {onCancelExport&&<button type="button" disabled={!canCancelExport} className="min-h-12 min-w-12 px-2 border border-emerald-500/50 rounded disabled:opacity-40" onClick={onCancelExport}>Cancel export</button>}
              <Disc className="w-3 h-3 animate-spin" />
              <span className="font-bold tabular-nums">WAV RENDER {clampedWavPct}%</span>
              <div
                role="progressbar"
                aria-label="Status Bar WAV Export Progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={clampedWavPct}
                className="hidden sm:block w-24 h-1.5 bg-[#0B0E14] rounded-full overflow-hidden border border-emerald-500/30"
              >
                <div
                  className="h-full bg-emerald-400 transition-all duration-150"
                  style={{ width: `${clampedWavPct}%` }}
                />
              </div>
            </div>
          )}
          <span className="hidden lg:inline truncate">
            {criticalMessage
              ? `${projectName} · Action required`
              : statusMessage || `${projectName} · Ready`}
          </span>
        </div>

        {/* RIGHT: TRACK COUNT, PROJECT REVISION & ALS VALIDITY */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1 text-zinc-400">
            <Layers className="w-3 h-3 text-zinc-500" />
            <span>{trackCount} Tracks</span>
          </div>

          <div className="flex items-center gap-1 text-emerald-400">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">ALS 12.0</span>
            <span>{alsValid ? 'VALID' : 'CHECK'}</span>
          </div>

          <div className="hidden sm:flex items-center gap-1 text-zinc-500 border-l border-[#1C222C] pl-2">
            <span>REV #{projectRevision}</span>
          </div>
        </div>
      </div>
    </>
  );
};

