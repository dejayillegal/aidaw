// @vitest-environment jsdom
import {describe,it,expect} from 'vitest';
import {buildStarterAbletonXml,parseAlsXmlString} from '../engine/alsXmlEngine';
import {applyNoteEditWithMode,applyClipPositionWithEditMode,spotPositionToBeat,spotMillisecondsToBeat,StudioCommandBus} from '../services/commandBus';
import {evaluatePlayableArrangementEvents,MusicalTimeService} from '../engine/timelineCoordinates';
import {mapBeatToMidiGridCoordinates} from '../components/TimelineCanvas';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {StudioTransportBar} from '../components/StudioTransportBar';
import {DEFAULT_TRANSPORT} from '../engine/projectDefaults';

const fixture=()=>parseAlsXmlString(buildStarterAbletonXml('berghain-134',19,4).xml);
describe('meter- and tempo-aware canonical editing',()=>{
  it('shows the same active meter and beat counter in the main transport as the editor',()=>{
    const meterMap=[{bar:1,beat:0,numerator:3,denominator:4},{bar:3,beat:6,numerator:7,denominator:8}],noop=()=>{};
    const html=renderToStaticMarkup(React.createElement(StudioTransportBar,{
      playheadBeat:9.25,isPlaying:false,tempo:120,meterMap,transport:DEFAULT_TRANSPORT,masterPeakDb:-60,canUndo:false,canRedo:false,editMode:'spot',
      onTogglePlay:noop,onStop:noop,onRewindToStart:noop,onUpdateTempo:noop,onUpdateTransport:noop,onChangeEditMode:noop,onUndo:noop,onRedo:noop,
    }));
    expect(html).toContain('003.7.2');expect(html).toContain('7/8');
  });
  it('keeps piano-roll pixels, follow windows and visible bar extents on the meter map',()=>{
    const meterMap=[{bar:1,beat:0,numerator:3,denominator:4},{bar:3,beat:6,numerator:7,denominator:8}];
    const m=mapBeatToMidiGridCoordinates(9.75,{canvasWidth:758,keyColWidth:58,totalBars:6,zoomBars:2,followPlayhead:true,meterMap});
    expect(m.windowStartBeat).toBe(6);expect(m.windowEndBeat).toBe(13);expect(m.visibleBeats).toBe(7);
    expect(m.playheadPixelX).toBe(433);expect(m.sixteenthIndexInBar).toBe(2);
  });
  it('moves notes into the final beat of 5/4 without clamping them to a 4/4 extent',()=>{
    const p=fixture();p.meterMap=[{bar:1,beat:0,numerator:5,denominator:4}];
    const t=p.tracks[0],c=t.clips[0],n=c.notes[0];c.length=20;c.endTime=20;
    const edited=applyNoteEditWithMode(p,t.id,0,n.id,19.5,'spot');
    expect(edited.tracks[0].clips[0].notes.find(x=>x.id===n.id)!.time).toBe(19.5);
    expect(p.tracks[0].clips[0].notes[0]).toEqual(n);
  });
  it('extends a moved clip using 7/8 bars and keeps the final phrase audible through undo/reopen',()=>{
    const p=fixture();p.meterMap=[{bar:1,beat:0,numerator:7,denominator:8}];
    p.tracks=p.tracks.slice(0,1);const t=p.tracks[0],n=t.clips[0].notes[0];
    t.clips=[{...t.clips[0],startTime:0,length:1,endTime:1,notes:[{...n,time:.25,quantizedTime:.25}]}];
    const bus=new StudioCommandBus();
    const moved=bus.executeMutation('mapped','Move','clip_edit',p,d=>applyClipPositionWithEditMode(d,t.id,0,14,'spot'));
    expect(moved.arrangementLengthBars).toBe(5);
    expect(MusicalTimeService.arrangementTotalBeats(moved)).toBe(17.5);
    expect(evaluatePlayableArrangementEvents(moved).some(e=>e.beat===14.25)).toBe(true);
    expect(parseAlsXmlString(moved.rawXmlModified).arrangementLengthBars).toBe(5);
    expect(bus.undo('mapped')!.tracks).toEqual(p.tracks);expect(bus.redo('mapped')!.tracks).toEqual(moved.tracks);
  });
  it('converts Spot bar/beat/sixteenth and milliseconds through changing musical maps',()=>{
    const meters=[{bar:1,beat:0,numerator:3,denominator:4},{bar:3,beat:6,numerator:7,denominator:8}];
    expect(spotPositionToBeat(3,7,2,meters)).toBe(9.25);
    expect(spotMillisecondsToBeat(5000,60,[{beat:0,bpm:60},{beat:4,bpm:120}])).toBe(6);
  });
});
