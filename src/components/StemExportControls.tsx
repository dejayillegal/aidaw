import React, {useState} from 'react';
export function StemExportControls({disabled,onExport}:{disabled:boolean;onExport:(includeReturns:boolean,includeMaster:boolean)=>void}) {
  const [returns,setReturns]=useState(false),[master,setMaster]=useState(false);
  return <details className="rounded border border-slate-700 p-2 text-xs"><summary className="min-h-12 cursor-pointer py-3 font-semibold">Export selected layer stem</summary>
    <p className="text-zinc-400">Full timeline and shared tail length. Key sources still drive sidechain compression. Stems with master processing may not sum back to the full mix.</p>
    <label className="flex min-h-12 items-center gap-2"><input type="checkbox" checked={returns} onChange={e=>setReturns(e.target.checked)}/>Include this layer’s wet returns</label>
    <label className="flex min-h-12 items-center gap-2"><input type="checkbox" checked={master} onChange={e=>setMaster(e.target.checked)}/>Include master processing</label>
    <button type="button" disabled={disabled} onClick={()=>onExport(returns,master)} className="min-h-12 w-full rounded border border-cyan-800 px-2 text-cyan-300 disabled:opacity-40">Export selected stem WAV</button>
  </details>;
}
