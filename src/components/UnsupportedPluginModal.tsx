import React, { useState } from 'react';
import type { AbletonProjectState } from '../types/ableton';
import { substituteUnsupportedDevice } from '../services/commandBus';
import { bypassUnsupportedPlugin, isPluginDependency, pluginRole, restoreOriginalPlugin, type PluginRole, type ReplacementType } from '../engine/pluginDependencies';

interface Props { project: AbletonProjectState; isOpen: boolean; onClose: () => void; onUpdateProject: (p:AbletonProjectState)=>void }
export const UnsupportedPluginModal: React.FC<Props> = ({project,isOpen,onClose,onUpdateProject}) => {
  const [roles,setRoles] = useState<Record<string,PluginRole>>({});
  const [error,setError] = useState('');
  if (!isOpen) return null;
  const items=project.tracks.flatMap(track=>track.devices.filter(isPluginDependency).map(device=>({track,device})));
  const run=(action:()=>AbletonProjectState)=>{try {onUpdateProject(action());setError('');} catch(e){setError(e instanceof Error?e.message:String(e));}};
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80">
    <div role="dialog" aria-modal="true" aria-label="Plugin dependencies" className="w-full max-w-2xl max-h-[85vh] overflow-y-auto p-5 bg-[#0F131A] border border-slate-700 rounded-xl text-slate-100 space-y-4">
      <div className="flex justify-between"><h2>Plugin dependencies ({items.length})</h2><button onClick={onClose}>Close</button></div>
      <p className="text-xs text-amber-200">Choose a replacement or explicitly bypass each enabled dependency. Original plugin XML, parameters and enabled state are retained. ALS export preserves the original plugin for Ableton; AIDAW metadata and native projects retain your browser replacement. Replacement sound differs from the original plugin.</p>
      {error && <p role="alert" className="text-red-300">{error}</p>}
      {items.map(({track,device})=>{
        const key=`${track.id}/${device.id}`, role=pluginRole(device)||roles[key]||device.pluginResolution?.role;
        const replacements:ReplacementType[]=role==='instrument'?['Operator','Analog','Wavetable']:role==='audio_effect'?['EQEight','Reverb','Compressor2']:[];
        return <div key={key} className="p-4 border border-slate-700 rounded space-y-3">
          <p>{track.name} · {(device.originalPlugin||device).displayName} · {device.pluginResolution?.action|| (device.bypassed && device.pluginOriginalEnabled === false?'Originally disabled':'Unresolved')}</p>
          {!pluginRole(device) && <label>Plugin role <select aria-label={`Role for ${device.id}`} value={role||''} onChange={e=>setRoles({...roles,[key]:e.target.value as PluginRole})} className="bg-slate-800 p-2"><option value="">Select role</option><option value="instrument">Instrument</option><option value="audio_effect">Audio effect</option></select></label>}
          <div className="flex flex-wrap gap-3">
            {replacements.map(replacement=><button key={replacement} disabled={track.locked} className="p-2 border rounded" onClick={()=>run(()=>substituteUnsupportedDevice(project,track.id,device.id,replacement,role))}>Use {replacement}</button>)}
            <button disabled={track.locked} onClick={()=>run(()=>bypassUnsupportedPlugin(project,track.id,device.id))}>Bypass explicitly</button>
            {device.originalPlugin && <button onClick={()=>run(()=>restoreOriginalPlugin(project,track.id,device.id))}>Restore original</button>}
          </div>
        </div>;
      })}
    </div>
  </div>;
};
