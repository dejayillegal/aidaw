// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import App from '../App';
import {projectQueueService as queue} from '../services/projectQueueService';
import {buildStarterAbletonXml,parseAlsXmlString} from '../engine/alsXmlEngine';
vi.mock('../components/TimelineCanvas',()=>({TimelineCanvas:()=>null}));
vi.mock('../components/MasterSpectrumAnalyzer',()=>({MasterSpectrumAnalyzer:()=>null}));
vi.mock('../components/SelectedTrackAnalysisStrip',()=>({SelectedTrackAnalysisStrip:()=>null}));
it('keeps placeholder controls and shortcuts unavailable until recovery settles, then reuses the active score on remount',async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  const project=parseAlsXmlString(buildStarterAbletonXml('berghain-134',777,1).xml);
  project.fileName='Recovered user score.als';
  project.tracks[0].muted=true;
  let release!:()=>void;
  const restore=vi.spyOn(queue,'restorePersistedProjects').mockImplementationOnce(async()=>{
    await new Promise<void>(resolve=>{release=resolve;});
    const record=await queue.enqueueProjectState(project);
    queue.switchActiveProject(record.queueId);
    return project;
  });
  const container=document.createElement('div');document.body.append(container);
  let root=createRoot(container);
  try{
    await act(async()=>{root.render(<App/>);});
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector('button,input,canvas')).toBeNull();
    await act(async()=>{window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true}));});
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await act(async()=>{release();await restore.mock.results[0].value;});
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(container.textContent).toContain(project.fileName);
    expect(queue.getActiveItem()?.workingProjectState.tracks).toEqual(project.tracks);
    await act(async()=>{root.unmount();});
    root=createRoot(container);
    await act(async()=>{root.render(<App/>);});
    expect(container.textContent).toContain(project.fileName);
    expect(restore).toHaveBeenCalledOnce();
    expect(queue.getActiveItem()?.workingProjectState.tracks[0].muted).toBe(true);
  }finally{
    await act(async()=>{root.unmount();});container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();
  }
},20000);
it('releases the startup boundary after recovery fails and keeps the failure visible',async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  vi.spyOn(queue,'getAllItems').mockReturnValue([]);
  vi.spyOn(queue,'restorePersistedProjects').mockRejectedValueOnce(Error('storage unavailable'));
  const container=document.createElement('div');document.body.append(container);
  const root=createRoot(container);
  try{
    await act(async()=>{root.render(<App/>);});
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(container.textContent).toContain('Recovery failed: Error: storage unavailable');
  }finally{
    await act(async()=>{root.unmount();});container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();
  }
},20000);
