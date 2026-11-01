import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Download,
  FileAudio,
  FolderPlus,
  Layers,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
  Sliders,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import {
  AbletonProjectState,
  HumanizationConfig,
  MasterBusConfig,
  MasterExportPreset,
  MasterExportVerificationReport,
  QueuedProjectRecord,
} from '../types/ableton';
import { projectQueueService } from '../services/projectQueueService';
import {
  deleteCustomMasterExportPreset,
  executeMasterExport20,
  loadMasterExportPresetsFromStorage,
  saveCustomMasterExportPreset,
} from '../engine/masteringEngine';

interface BulkQueueAndExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeProject: AbletonProjectState;
  humanization: HumanizationConfig;
  masterBus: MasterBusConfig;
  queueItems: QueuedProjectRecord[];
  activeQueueId: string | null;
  onSwitchToQueueProject: (queueId: string) => void;
  onSyncActiveProjectFromQueue: (updatedProject: AbletonProjectState) => void;
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const BulkQueueAndExportModal: React.FC<BulkQueueAndExportModalProps> = ({
  isOpen,
  onClose,
  activeProject,
  humanization,
  masterBus,
  queueItems,
  activeQueueId,
  onSwitchToQueueProject,
  onSyncActiveProjectFromQueue,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [activeTab, setActiveTab] = useState<'queue' | 'master_export'>('queue');
  const [presets, setPresets] = useState<MasterExportPreset[]>(() =>
    loadMasterExportPresetsFromStorage()
  );
  const [selectedPresetId, setSelectedPresetId] = useState<string>(
    () => loadMasterExportPresetsFromStorage()[0]?.id || 'preset_club_24_48'
  );

  // Editable Master Export 2.0 parameters
  const activePreset =
    presets.find((p) => p.id === selectedPresetId) || presets[0];

  const [customPresetName, setCustomPresetName] = useState<string>('Warehouse Custom Master');
  const [sampleRate, setSampleRate] = useState<44100 | 48000 | 96000>(
    activePreset?.sampleRate || 48000
  );
  const [bitDepth, setBitDepth] = useState<16 | 24 | 32>(activePreset?.bitDepth || 24);
  const [sampleFormat, setSampleFormat] = useState<'pcm_int' | 'ieee_float'>(
    activePreset?.sampleFormat || 'pcm_int'
  );
  const [targetLufs, setTargetLufs] = useState<number>(
    activePreset?.targetIntegratedLufs ?? -8.5
  );
  const [truePeakCeiling, setTruePeakCeiling] = useState<number>(
    activePreset?.truePeakCeilingDbtp ?? -1.0
  );
  const [normalize, setNormalize] = useState<boolean>(activePreset?.normalize ?? true);
  const [dither, setDither] = useState<'none' | 'tpdf'>(activePreset?.dither || 'tpdf');

  const [inspectedQueueId, setInspectedQueueId] = useState<string | null>(
    activeQueueId
  );
  const [isBatchRunning, setIsBatchRunning] = useState<boolean>(false);
  const [isSingleExporting, setIsSingleExporting] = useState<boolean>(false);
  const [lastExportReport, setLastExportReport] =
    useState<MasterExportVerificationReport | null>(null);

  if (!isOpen) return null;

  const currentWorkingPreset: MasterExportPreset = {
    id: selectedPresetId,
    version: 2,
    name: customPresetName || activePreset?.name || 'Custom Export',
    sampleRate,
    bitDepth,
    sampleFormat: bitDepth === 32 ? 'ieee_float' : sampleFormat === 'ieee_float' ? 'pcm_int' : sampleFormat,
    targetIntegratedLufs: targetLufs,
    truePeakCeilingDbtp: truePeakCeiling,
    normalize,
    dither: bitDepth === 32 ? 'none' : dither,
    createdAt: new Date().toISOString(),
  };

  const handleSelectPreset = (preset: MasterExportPreset) => {
    setSelectedPresetId(preset.id);
    setCustomPresetName(preset.name);
    setSampleRate(preset.sampleRate);
    setBitDepth(preset.bitDepth);
    setSampleFormat(preset.sampleFormat);
    setTargetLufs(preset.targetIntegratedLufs ?? -9.5);
    setTruePeakCeiling(preset.truePeakCeilingDbtp);
    setNormalize(preset.normalize);
    setDither(preset.dither);
  };

  const handleSavePresetToLocalStorage = () => {
    const updated = saveCustomMasterExportPreset({
      name: customPresetName.trim() || 'Studio Master Preset',
      sampleRate,
      bitDepth,
      sampleFormat: bitDepth === 32 ? 'ieee_float' : 'pcm_int',
      targetIntegratedLufs: targetLufs,
      truePeakCeilingDbtp: truePeakCeiling,
      normalize,
      dither: bitDepth === 32 ? 'none' : dither,
    });
    setPresets(updated);
    const newest = updated[updated.length - 1];
    if (newest) setSelectedPresetId(newest.id);
  };

  const handleDeletePreset = (id: string) => {
    const updated = deleteCustomMasterExportPreset(id);
    setPresets(updated);
    if (selectedPresetId === id && updated[0]) {
      handleSelectPreset(updated[0]);
    }
  };

  const handleMultiFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      const rec = await projectQueueService.enqueueBrowserFile(files[i]);
      if (i === 0 && !inspectedQueueId) {
        setInspectedQueueId(rec.queueId);
      }
    }
    e.target.value = '';
  };

  const handleBatchCalibrateAll = async () => {
    setIsBatchRunning(true);
    try {
      await projectQueueService.calibrateAllReadyItems(
        humanization,
        masterBus,
        targetLufs,
        truePeakCeiling
      );
    } finally {
      setIsBatchRunning(false);
    }
  };

  const handleBatchApproveAndExportAll = async () => {
    setIsBatchRunning(true);
    try {
      const items = projectQueueService.getAllItems();
      for (const item of items) {
        if (item.cancelRequested) continue;
        if (
          item.state === 'ready' ||
          item.state === 'exported'
        ) {
          await projectQueueService.calibrateQueueItem(
            item.queueId,
            humanization,
            masterBus,
            targetLufs,
            truePeakCeiling
          );
        }
        const refreshed = projectQueueService.getItem(item.queueId);
        if (
          refreshed &&
          (refreshed.state === 'preview_ready' || refreshed.state === 'approved')
        ) {
          projectQueueService.approveQueueItemProposal(item.queueId);
          const result = await projectQueueService.applyAndExportQueueItem(
            item.queueId,
            humanization,
            masterBus,
            currentWorkingPreset
          );

          if (result.alsGzipBytes && result.record.exportedAlsFilename) {
            triggerBrowserDownload(
              new Blob([result.alsGzipBytes as unknown as BlobPart], { type: 'application/gzip' }),
              result.record.exportedAlsFilename
            );
          }
          if (result.wavArrayBuffer && result.record.exportedWavFilename) {
            triggerBrowserDownload(
              new Blob([result.wavArrayBuffer], { type: 'audio/wav' }),
              result.record.exportedWavFilename
            );
          }

          if (item.queueId === activeQueueId && result.record.workingProjectState) {
            onSyncActiveProjectFromQueue(result.record.workingProjectState);
          }
        }
      }
    } finally {
      setIsBatchRunning(false);
    }
  };

  const handleSingleMasterExport = async () => {
    setIsSingleExporting(true);
    try {
      const res = await executeMasterExport20(
        activeProject,
        humanization,
        masterBus,
        currentWorkingPreset
      );
      setLastExportReport(res.verification);
      const filename = `Techno_Master_${currentWorkingPreset.sampleRate / 1000}k_${
        currentWorkingPreset.bitDepth
      }b_${currentWorkingPreset.sampleFormat === 'ieee_float' ? 'Float' : 'PCM'}.wav`;
      triggerBrowserDownload(res.blob, filename);
    } finally {
      setIsSingleExporting(false);
    }
  };

  const inspectedItem =
    queueItems.find((q) => q.queueId === (inspectedQueueId || activeQueueId)) ||
    queueItems[0];

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 font-mono">
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-6xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Top Modal Header */}
        <div className="px-4 py-3 bg-zinc-900/90 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-orange-500/15 border border-orange-500/40 text-orange-400">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-100 uppercase tracking-wider">
                Bulk Smart Leveling 2.0 Queue &amp; Master Export Engine 2.0
              </h2>
              <p className="text-[10px] text-zinc-400">
                5-Stage Non-Destructive ALS Calibration (Static Metadata + ITU-R BS.1770-4 Audio LUFS + 4x True Peak)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex bg-zinc-950 border border-zinc-800 rounded-lg p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setActiveTab('queue')}
                className={`px-3 py-1 rounded-md font-semibold transition-colors ${
                  activeTab === 'queue'
                    ? 'bg-orange-500 text-zinc-950'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Multi-File ALS Queue ({queueItems.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('master_export')}
                className={`px-3 py-1 rounded-md font-semibold transition-colors ${
                  activeTab === 'master_export'
                    ? 'bg-sky-500 text-zinc-950'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Master Export 2.0 Presets
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 border border-zinc-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {activeTab === 'queue' ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Left Column: Multi-Project Queue List & Batch Controls */}
              <div className="lg:col-span-5 space-y-3">
                <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-200 uppercase">
                      Queued .ALS Projects ({queueItems.length})
                    </span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept=".als,.xml"
                      onChange={handleMultiFileUpload}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-2.5 py-1 rounded-lg bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/40 text-orange-300 text-[11px] font-bold flex items-center gap-1.5"
                    >
                      <FolderPlus className="w-3.5 h-3.5" />
                      + Add Multiple .ALS Files
                    </button>
                  </div>

                  {/* Batch Action Buttons */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={isBatchRunning || queueItems.length === 0}
                      onClick={handleBatchCalibrateAll}
                      className="px-2.5 py-2 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 disabled:opacity-40 border border-sky-500/40 text-sky-300 text-[11px] font-bold flex items-center justify-center gap-1.5"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      1. Batch Analyze &amp; Propose
                    </button>
                    <button
                      type="button"
                      disabled={isBatchRunning || queueItems.length === 0}
                      onClick={handleBatchApproveAndExportAll}
                      className="px-2.5 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 disabled:opacity-40 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold flex items-center justify-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      2. Approve &amp; Export All
                    </button>
                  </div>
                </div>

                {/* Queue Items List */}
                <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                  {queueItems.map((item) => {
                    const isInspected = inspectedItem?.queueId === item.queueId;
                    const isActiveWorkstation = activeQueueId === item.queueId;

                    return (
                      <div
                        key={item.queueId}
                        onClick={() => setInspectedQueueId(item.queueId)}
                        className={`p-3 rounded-xl border transition-all cursor-pointer ${
                          isInspected
                            ? 'bg-zinc-900 border-orange-500/60'
                            : 'bg-zinc-900/40 border-zinc-800 hover:border-zinc-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-zinc-100 truncate">
                                {item.originalFilename}
                              </span>
                              {isActiveWorkstation && (
                                <span className="px-1.5 py-0.5 rounded bg-orange-500/20 border border-orange-500/40 text-orange-300 text-[9px]">
                                  ACTIVE IN DAW
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-zinc-400 mt-0.5 flex items-center gap-2">
                              <span>SHA256: {item.binaryChecksumSha256.slice(0, 10)}…</span>
                              <span>Rev #{item.workingProjectRevision}</span>
                            </div>
                          </div>

                          <span
                            className={`px-2 py-0.5 rounded text-[9.5px] font-bold uppercase border ${
                              item.state === 'exported'
                                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                                : item.state === 'preview_ready' || item.state === 'approved'
                                ? 'bg-sky-500/20 border-sky-500/40 text-sky-300'
                                : item.state === 'failed' || item.state === 'unsupported'
                                ? 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                                : item.state === 'cancelled'
                                ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                                : 'bg-zinc-800 border-zinc-700 text-zinc-300'
                            }`}
                          >
                            {item.state}
                          </span>
                        </div>

                        {item.errorDetails && (
                          <div className="mt-2 p-1.5 rounded bg-rose-500/10 border border-rose-500/30 text-[10px] text-rose-300">
                            {item.errorDetails}
                          </div>
                        )}

                        <div
                          className="mt-2.5 pt-2 border-t border-zinc-800/80 flex items-center justify-between gap-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center gap-1.5">
                            {item.isMidiExport && item.exportedMidiBlob ? (
                              <button
                                type="button"
                                onClick={() =>
                                  triggerBrowserDownload(
                                    item.exportedMidiBlob!,
                                    item.exportedMidiFilename || item.originalFilename
                                  )
                                }
                                className="px-2 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold flex items-center gap-1"
                              >
                                <Download className="w-3 h-3" />
                                Download .MID
                              </button>
                            ) : (
                              <>
                                {!isActiveWorkstation && item.workingProjectState && (
                                  <button
                                    type="button"
                                    onClick={() => onSwitchToQueueProject(item.queueId)}
                                    className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[10px]"
                                  >
                                    Load in Timeline
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    projectQueueService.calibrateQueueItem(
                                      item.queueId,
                                      humanization,
                                      masterBus,
                                      targetLufs,
                                      truePeakCeiling
                                    )
                                  }
                                  className="px-2 py-0.5 rounded bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 text-[10px]"
                                >
                                  Calibrate
                                </button>
                              </>
                            )}
                          </div>

                          <div className="flex items-center gap-1">
                            {(item.state === 'analyzing' ||
                              item.state === 'calibrating' ||
                              item.state === 'compiling') && (
                              <button
                                type="button"
                                onClick={() => projectQueueService.cancelQueueItem(item.queueId)}
                                className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[9px] flex items-center gap-0.5"
                              >
                                <XCircle className="w-3 h-3" /> Cancel
                              </button>
                            )}
                            {(item.state === 'cancelled' || item.state === 'failed') && (
                              <button
                                type="button"
                                onClick={() => projectQueueService.retryQueueItem(item.queueId)}
                                className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[9px] flex items-center gap-0.5"
                              >
                                <RefreshCw className="w-3 h-3" /> Retry
                              </button>
                            )}
                            {queueItems.length > 1 && (
                              <button
                                type="button"
                                onClick={() => projectQueueService.removeQueueItem(item.queueId)}
                                className="p-1 text-zinc-500 hover:text-rose-400"
                                title="Remove from queue"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right Column: 5-Stage Calibration Inspector for Selected Queue Item */}
              <div className="lg:col-span-7 space-y-3">
                {inspectedItem ? (
                  <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3.5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-zinc-800">
                      <div>
                        <h3 className="text-xs font-bold text-zinc-100">
                          Stage A–E Inspector: {inspectedItem.originalFilename}
                        </h3>
                        <p className="text-[10px] text-zinc-400">
                          User-created EQEight &amp; Compressor2 devices are strictly preserved (never overwritten)
                        </p>
                      </div>

                      {inspectedItem.calibrationProposal && (
                        <button
                          type="button"
                          onClick={async () => {
                            projectQueueService.approveQueueItemProposal(inspectedItem.queueId);
                            const res = await projectQueueService.applyAndExportQueueItem(
                              inspectedItem.queueId,
                              humanization,
                              masterBus,
                              currentWorkingPreset
                            );
                            if (res.alsGzipBytes && res.record.exportedAlsFilename) {
                              triggerBrowserDownload(
                                new Blob([res.alsGzipBytes as unknown as BlobPart], { type: 'application/gzip' }),
                                res.record.exportedAlsFilename
                              );
                            }
                            if (res.wavArrayBuffer && res.record.exportedWavFilename) {
                              triggerBrowserDownload(
                                new Blob([res.wavArrayBuffer], { type: 'audio/wav' }),
                                res.record.exportedWavFilename
                              );
                            }
                            if (
                              inspectedItem.queueId === activeQueueId &&
                              res.record.workingProjectState
                            ) {
                              onSyncActiveProjectFromQueue(res.record.workingProjectState);
                            }
                          }}
                          className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold text-[11px] flex items-center gap-1.5"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Apply Approved Proposal &amp; Export (.ALS + .WAV)
                        </button>
                      )}
                    </div>

                    {/* Stage A (Static Analysis) & Stage B (Measured Audio Analysis) Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-amber-400 uppercase">
                            Stage A: Static Metadata Analysis
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-[8.5px] text-amber-300">
                            Metadata Only (Not LUFS)
                          </span>
                        </div>
                        {inspectedItem.stageAStatic ? (
                          <div className="text-[10px] text-zinc-300 space-y-0.5 pt-1">
                            <div>
                              Tracks: <strong>{inspectedItem.stageAStatic.trackCount}</strong> | Total Notes:{' '}
                              <strong>{inspectedItem.stageAStatic.totalNoteEvents ?? inspectedItem.stageAStatic.totalMidiNotes}</strong>
                            </div>
                            <div>
                              Note Density:{' '}
                              <strong>{inspectedItem.stageAStatic.averageNoteDensityPerBar ?? inspectedItem.stageAStatic.averageNotesPerBar}</strong> notes/bar
                            </div>
                            <div>
                              Low-End Conflict Tracks:{' '}
                              <strong>
                                {inspectedItem.stageAStatic.lowEndOverlapTrackIds?.length ?? 0}
                              </strong>
                            </div>
                          </div>
                        ) : (
                          <div className="text-[10px] text-zinc-500">Not analyzed yet</div>
                        )}
                      </div>

                      <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-sky-400 uppercase">
                            Stage B: ITU-R BS.1770-4 Audio Measurement
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-500/30 text-[8.5px] text-sky-300">
                            4x Oversampled dBTP
                          </span>
                        </div>
                        {inspectedItem.stageBMeasured ? (
                          inspectedItem.stageBMeasured.status === 'measured' ? (
                            <div className="text-[10px] text-zinc-300 space-y-0.5 pt-1">
                              <div>
                                Integrated LUFS:{' '}
                                <strong className="text-sky-300">
                                  {inspectedItem.stageBMeasured.integratedLufs} LUFS
                                </strong>
                              </div>
                              <div>
                                True Peak (4x):{' '}
                                <strong className="text-emerald-300">
                                  {inspectedItem.stageBMeasured.truePeakDbtp} dBTP
                                </strong>{' '}
                                | Sample Peak: {inspectedItem.stageBMeasured.samplePeakDbfs} dBFS
                              </div>
                              <div>
                                Crest Factor: {inspectedItem.stageBMeasured.crestFactorDb} dB | Headroom:{' '}
                                {inspectedItem.stageBMeasured.headroomDb} dB
                              </div>
                            </div>
                          ) : (
                            <div className="text-[10px] text-amber-300 pt-1">
                              <strong>Audio Measurement Unavailable:</strong>{' '}
                              {inspectedItem.stageBMeasured.unavailableReason}
                            </div>
                          )
                        ) : (
                          <div className="text-[10px] text-zinc-500 pt-1">
                            Click &ldquo;Calibrate&rdquo; to run offline audio render &amp; BS.1770-4 measurement.
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Stage C & D: Per-Track Calibration Proposal & Selective Approval */}
                    {inspectedItem.calibrationProposal && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-zinc-200 uppercase">
                            Stage C &amp; D: Per-Track Calibration Proposal (Selective Track Approval)
                          </span>
                          <span className="text-[10px] text-emerald-400">
                            Projected Post-Calibration: {inspectedItem.calibrationProposal.projectedLufs} LUFS /{' '}
                            {inspectedItem.calibrationProposal.projectedTruePeakDbtp} dBTP
                          </span>
                        </div>

                        <div className="max-h-[220px] overflow-y-auto space-y-1.5 pr-1">
                          {inspectedItem.calibrationProposal.trackDeltas.map((td) => (
                            <div
                              key={td.trackId}
                              className="p-2 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-between gap-2 text-[10px]"
                            >
                              <label className="flex items-center gap-2 cursor-pointer min-w-0">
                                <input
                                  type="checkbox"
                                  checked={td.approved}
                                  onChange={(e) =>
                                    projectQueueService.setProposalTrackApproval(
                                      inspectedItem.queueId,
                                      td.trackId,
                                      e.target.checked
                                    )
                                  }
                                  className="accent-orange-500"
                                />
                                <div className="min-w-0">
                                  <div className="font-bold text-zinc-100 truncate">
                                    {td.trackName}{' '}
                                    <span className="text-zinc-500 uppercase">({td.archetype})</span>
                                  </div>
                                  <div className="text-[9px] text-zinc-400 truncate">{td.reason}</div>
                                </div>
                              </label>

                              <div className="text-right shrink-0">
                                <div className="font-bold text-orange-300">
                                  {td.previousVolumeDb} dB &rarr; {td.proposedVolumeDb} dB (
                                  {td.deltaDb >= 0 ? `+${td.deltaDb}` : td.deltaDb} dB)
                                </div>
                                <div className="text-[9px] text-emerald-400">
                                  SC: {Math.round(td.proposedSidechainDepth * 100)}% | Preserved User FX:{' '}
                                  {td.preservedUserDeviceIds?.length ?? 0}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Stage E Verification Report */}
                    {inspectedItem.verificationReport && (
                      <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[10px] space-y-1">
                        <div className="font-bold text-emerald-300 flex items-center gap-1.5">
                          <ShieldCheck className="w-4 h-4" />
                          Stage E Verification Passed — User Devices Preserved &amp; Post-Audio Re-Measured
                        </div>
                        <div className="text-zinc-300">
                          Pre-LUFS: <strong>{inspectedItem.verificationReport.preCalibration.integratedLufs}</strong> &rarr;
                          Post-LUFS: <strong className="text-emerald-300">{inspectedItem.verificationReport.postCalibration.integratedLufs} LUFS</strong> |
                          Post True Peak: <strong className="text-emerald-300">{inspectedItem.verificationReport.postCalibration.truePeakDbtp} dBTP</strong> |
                          User Devices Intact: <strong>{inspectedItem.verificationReport.userDevicesIntact ? 'YES' : 'NO'}</strong>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            /* Tab 2: Master Export 2.0 & LocalStorage Presets */
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Saved Presets Column */}
              <div className="lg:col-span-5 space-y-3">
                <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-100 uppercase">
                      Saved LocalStorage Export Presets (v2)
                    </span>
                    <span className="text-[10px] text-zinc-400">{presets.length} presets</span>
                  </div>

                  <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1">
                    {presets.map((preset) => {
                      const isSelected = preset.id === selectedPresetId;
                      const isBuiltIn = preset.id.startsWith('preset_');
                      return (
                        <div
                          key={preset.id}
                          onClick={() => handleSelectPreset(preset)}
                          className={`p-2.5 rounded-lg border cursor-pointer flex items-center justify-between gap-2 ${
                            isSelected
                              ? 'bg-zinc-950 border-sky-500/60 text-zinc-100'
                              : 'bg-zinc-950/50 border-zinc-800 text-zinc-300 hover:border-zinc-700'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-bold truncate">{preset.name}</div>
                            <div className="text-[10px] text-zinc-400">
                              {preset.sampleRate / 1000} kHz • {preset.bitDepth}-bit (
                              {preset.sampleFormat === 'ieee_float' ? 'IEEE Float' : 'PCM'}) •{' '}
                              {preset.targetIntegratedLufs} LUFS / {preset.truePeakCeilingDbtp} dBTP
                            </div>
                          </div>
                          {!isBuiltIn && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeletePreset(preset.id);
                              }}
                              className="p-1 text-zinc-500 hover:text-rose-400"
                              title="Delete custom preset"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Preset Configurator & Two-Pass Render Verification */}
              <div className="lg:col-span-7 space-y-3">
                <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                    <span className="text-xs font-bold text-sky-400 uppercase flex items-center gap-1.5">
                      <FileAudio className="w-4 h-4" />
                      Master Export 2.0 Configuration
                    </span>
                    <button
                      type="button"
                      onClick={handleSavePresetToLocalStorage}
                      className="px-2.5 py-1 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 text-sky-300 text-[10px] font-bold flex items-center gap-1"
                    >
                      <Save className="w-3 h-3" />
                      Save Preset to LocalStorage
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-1">Preset Name</label>
                      <input
                        type="text"
                        value={customPresetName}
                        onChange={(e) => setCustomPresetName(e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-zinc-100 text-xs"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-1">
                        Sample Rate (Hz)
                      </label>
                      <select
                        value={sampleRate}
                        onChange={(e) =>
                          setSampleRate(Number(e.target.value) as 44100 | 48000 | 96000)
                        }
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-zinc-100 text-xs"
                      >
                        <option value={44100}>44,100 Hz (Redbook / Streaming)</option>
                        <option value={48000}>48,000 Hz (Club / Broadcast Standard)</option>
                        <option value={96000}>96,000 Hz (Hi-Res Archival Master)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-1">
                        Bit Depth &amp; Encoding Format
                      </label>
                      <select
                        value={bitDepth}
                        onChange={(e) => {
                          const bd = Number(e.target.value) as 16 | 24 | 32;
                          setBitDepth(bd);
                          setSampleFormat(bd === 32 ? 'ieee_float' : 'pcm_int');
                          if (bd === 32) setDither('none');
                        }}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-zinc-100 text-xs"
                      >
                        <option value={16}>16-Bit Integer PCM (wFormatTag = 1)</option>
                        <option value={24}>24-Bit Integer PCM (wFormatTag = 1)</option>
                        <option value={32}>32-Bit IEEE Float (wFormatTag = 3)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-1">
                        Dithering (Integer PCM Only)
                      </label>
                      <select
                        value={bitDepth === 32 ? 'none' : dither}
                        disabled={bitDepth === 32}
                        onChange={(e) => setDither(e.target.value as 'none' | 'tpdf')}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-zinc-100 text-xs disabled:opacity-40"
                      >
                        <option value="tpdf">TPDF Triangular Dither (16/24-bit PCM)</option>
                        <option value="none">None (Truncate / 32-bit Float)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-1">
                        Target Integrated LUFS ({targetLufs} LUFS)
                      </label>
                      <input
                        type="range"
                        min={-16}
                        max={-6}
                        step={0.5}
                        value={targetLufs}
                        onChange={(e) => setTargetLufs(Number(e.target.value))}
                        className="w-full accent-sky-400"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-1">
                        True Peak Ceiling ({truePeakCeiling} dBTP)
                      </label>
                      <input
                        type="range"
                        min={-3.0}
                        max={-0.1}
                        step={0.1}
                        value={truePeakCeiling}
                        onChange={(e) => setTruePeakCeiling(Number(e.target.value))}
                        className="w-full accent-emerald-400"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-zinc-800">
                    <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={normalize}
                        onChange={(e) => setNormalize(e.target.checked)}
                        className="accent-sky-500"
                      />
                      Enable Two-Pass Loudness Normalization &amp; 4x True Peak Limiting
                    </label>

                    <button
                      type="button"
                      disabled={isSingleExporting}
                      onClick={handleSingleMasterExport}
                      className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-zinc-950 font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-sky-500/20"
                    >
                      <Play className="w-3.5 h-3.5" />
                      {isSingleExporting
                        ? 'Rendering Two-Pass Master...'
                        : 'Render & Download Verified Master .WAV'}
                    </button>
                  </div>
                </div>

                {/* Master Export Verification Report */}
                {lastExportReport && (
                  <div className="bg-zinc-950 border border-emerald-500/40 rounded-xl p-3.5 space-y-2 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                        <Check className="w-4 h-4" />
                        Two-Pass Master Export Verification Report
                      </span>
                      <span className="text-[10px] text-zinc-400">
                        RIFF fmtTag={lastExportReport.sampleFormat === 'ieee_float' ? 3 : 1} •{' '}
                        {lastExportReport.sampleRate} Hz • {lastExportReport.bitDepth}-bit •{' '}
                        {(lastExportReport.byteSize / (1024 * 1024)).toFixed(2)} MB
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                      <div className="p-2 rounded bg-zinc-900 border border-zinc-800">
                        <div className="text-[9px] text-zinc-400">Pass 1 Pre-Master</div>
                        <div className="font-bold text-zinc-200">
                          {lastExportReport.preMasterLufs} LUFS / {lastExportReport.preMasterTruePeakDbtp} dBTP
                        </div>
                      </div>
                      <div className="p-2 rounded bg-zinc-900 border border-zinc-800">
                        <div className="text-[9px] text-zinc-400">Pass 2 Post-Master</div>
                        <div className="font-bold text-emerald-300">
                          {lastExportReport.postMasterLufs} LUFS / {lastExportReport.postMasterTruePeakDbtp} dBTP
                        </div>
                      </div>
                      <div className="p-2 rounded bg-zinc-900 border border-zinc-800">
                        <div className="text-[9px] text-zinc-400">Gain / Limiter GR</div>
                        <div className="font-bold text-sky-300">
                          {(lastExportReport.appliedMakeupGainDb ?? lastExportReport.appliedGainDb ?? 0) >= 0
                            ? `+${lastExportReport.appliedMakeupGainDb ?? lastExportReport.appliedGainDb ?? 0}`
                            : (lastExportReport.appliedMakeupGainDb ?? lastExportReport.appliedGainDb ?? 0)}{' '}
                          dB / -{lastExportReport.limiterGainReductionDb} dB
                        </div>
                      </div>
                      <div className="p-2 rounded bg-zinc-900 border border-zinc-800">
                        <div className="text-[9px] text-zinc-400">Memory Segments</div>
                        <div className="font-bold text-zinc-200">
                          {lastExportReport.memorySegmentedRenderCount} segment(s)
                        </div>
                      </div>
                    </div>

                    {lastExportReport.targetConflictWarning && (
                      <div className="p-2 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[10px] flex items-start gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>{lastExportReport.targetConflictWarning}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
