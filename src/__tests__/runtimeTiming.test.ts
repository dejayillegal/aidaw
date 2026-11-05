// @vitest-environment jsdom
// SYNTHETIC projects; mathematical expectations are independent of the runtime clock.
import {describe,it,expect,vi,afterEach} from 'vitest';
import {ParametricWebAudioEngine} from '../engine/webAudioSynth';
import {buildStarterAbletonXml,parseAlsXmlString} from '../engine/alsXmlEngine';
import {metronomeEvents,scheduleTempoSyncedReturns,runtimeNoteDuration} from '../engine/runtimeTiming';
import {DEFAULT_HUMANIZATION,DEFAULT_TRANSPORT} from '../engine/projectDefaults';
function fixture(loop=false) {
 const p=parseAlsXmlString(buildStarterAbletonXml('berghain-134',19,4).xml);p.tempo=60;
 p.meterMap=[{bar:1,beat:0,numerator:3,denominator:4}];
 p.tempoMap=[{beat:0,bpm:60,curve:'step'},{beat:4,bpm:120,curve:'step'}];
 const e=new ParametricWebAudioEngine();e.setState(p,DEFAULT_HUMANIZATION,{...DEFAULT_TRANSPORT,loopEnabled:loop,loopStartBar:2,loopLengthBars:2});
 const clock={currentTime:0};Object.assign(e,{ctx:clock,isPlaying:true,anchorBeat:0,anchorAudioTime:0});
 vi.spyOn(e as any,'syncLiveTrackChannels').mockImplementation(()=>{});
 return {p,e,clock};
}
afterEach(()=>vi.restoreAllMocks());
describe('runtime tempo/meter scheduling',()=>{
 it('predicts Session launch beyond the audio scheduling horizon using the installed tempo map',()=>{
  const {e,clock}=fixture();clock.currentTime=4.4; // Beat 4.8 at 120 BPM, base tempo is 60.
  expect(e.getSessionLaunchBeat()).toBeCloseTo(5.1,10);
  e.pause();expect(e.getSessionLaunchBeat()).toBeCloseTo(4.8,10);
 });
 it('advances the actual engine audio clock through a step tempo change in 3/4',()=>{
  const {e,clock}=fixture();clock.currentTime=5;expect(e.getCurrentBeat()).toBeCloseTo(6,10);
 });
 it('integrates a beat-linear tempo ramp on the actual engine clock',()=>{
  const {e,p,clock}=fixture();p.tempoMap![0].curve='linear';
  clock.currentTime=4*Math.log(2);expect(e.getCurrentBeat()).toBeCloseTo(4,10);
 });
 it('wraps skipped loops in elapsed seconds across an interior tempo change',()=>{
  const {e,clock}=fixture(true);Object.assign(e,{anchorBeat:3});clock.currentTime=9;
  expect(e.getCurrentBeat()).toBeCloseTo(6,10);
 });
 it('preserves the old audio-clock position when only the tempo map is edited',()=>{
  const {e,p,clock}=fixture();clock.currentTime=5;
  e.setState({...p,tempoMap:[{beat:0,bpm:120,curve:'step'}]},DEFAULT_HUMANIZATION);
  expect(e.getCurrentBeat()).toBeCloseTo(6,10);clock.currentTime+=.5;
  expect(e.getCurrentBeat()).toBeCloseTo(7,10);
 });
 it('places metronome accents and eighth-note clicks on a changing meter',()=>{
  const {p}=fixture();p.meterMap=[{bar:1,beat:0,numerator:3,denominator:4},{bar:3,beat:6,numerator:7,denominator:8}];
  expect(metronomeEvents(p,5.9,10)).toEqual([6,6.5,7,7.5,8,8.5,9,9.5,10].map(beat=>({beat,downbeat:beat===6||beat===9.5})));
 });
 it('automates native delay time using exponential seconds ramps with clamp crossings',()=>{
  const {p}=fixture();p.tempoMap![0].curve='linear';
  const calls:{value:number;time:number;kind:string}[]=[];
  const param={cancelScheduledValues(){},setValueAtTime(value:number,time:number){calls.push({value,time,kind:'step'});},exponentialRampToValueAtTime(value:number,time:number){calls.push({value,time,kind:'ramp'});}};
  scheduleTempoSyncedReturns({delayNodeL:{delayTime:param},delayNodeR:{delayTime:param}} as any,p,0,0);
  expect(calls[0]).toEqual({value:.5,time:0,kind:'step'});
  expect(calls[1].time).toBeCloseTo(4*Math.log(1.5),10);expect(calls[1].value).toBe(.5);
  expect(calls[2].time).toBeCloseTo(4*Math.log(2),10);expect(calls[2].value).toBe(.375);expect(calls[2].kind).toBe('ramp');
 });
 it('bounds return automation to a scheduling window so loop restarts cannot inherit the next section tempo',()=>{
  const {p}=fixture();p.tempoMap![0].curve='linear';
  const calls:{value:number;time:number}[]=[];
  const param={cancelScheduledValues(){},setValueAtTime(value:number,time:number){calls.push({value,time});},exponentialRampToValueAtTime(value:number,time:number){calls.push({value,time});}};
  scheduleTempoSyncedReturns({delayNodeL:{delayTime:param},delayNodeR:{delayTime:param}} as any,p,0,10,3);
  expect(Math.max(...calls.map(c=>c.time))).toBeCloseTo(10+4*Math.log(1.75),10);
  expect(calls.find(c=>c.time>12)?.value).toBeCloseTo(45/105,10);
 });
 it('integrates sustained notes through repeated loop tempo segments',()=>{
  const {p}=fixture();const loop={enabled:true,start:3,end:9,span:6};
  // Beat 8..9 is .5s, then 3..4 is 1s, then 4..5 is .5s.
  expect(runtimeNoteDuration(p,8,3,loop)).toBeCloseTo(2,12);
  expect(runtimeNoteDuration(p,8,9,loop)).toBeCloseTo(5.5,12);
 });
});

it('rejects an unrepresentable sub-lookahead loop before installing candidate state',()=>{
 const p=parseAlsXmlString(buildStarterAbletonXml('berghain-134',19,4).xml);
 p.tempo=240;p.tempoMap=[{beat:0,bpm:240}];p.meterMap=[{bar:1,beat:0,numerator:1,denominator:32}];
 const e=new ParametricWebAudioEngine();
 e.setState(p,DEFAULT_HUMANIZATION,{...DEFAULT_TRANSPORT,loopEnabled:true,loopStartBar:1,loopLengthBars:1});
 expect(e.getInstalledProjectState()).toBeNull();
 expect(e.getPlaybackState()).toBe('error');
});

it('retires metronome sources through the existing transport voice registry',()=>{
 const {e,p,clock}=fixture();p.tracks=[];
 const param={setValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn(),cancelScheduledValues:vi.fn(),setTargetAtTime:vi.fn()};
 const osc={type:'',frequency:param,connect:vi.fn(),disconnect:vi.fn(),start:vi.fn(),stop:vi.fn(),onended:null as null|(()=>void)};
 Object.assign(clock,{createOscillator:()=>osc,createGain:()=>({gain:param,connect:vi.fn(),disconnect:vi.fn()})});
 const voices=new Set<()=>void>();
 Object.assign(e,{bus:{activeVoices:voices,masterGain:{}},noiseBuffer:{},transport:{...DEFAULT_TRANSPORT,loopEnabled:false,metronomeEnabled:true}});
 (e as any).runLookaheadScheduler();expect(voices.size).toBe(1);
 e.pause();expect(param.cancelScheduledValues).toHaveBeenCalled();
 osc.onended!();expect(voices.size).toBe(0);expect(osc.disconnect).toHaveBeenCalled();
});

it('invalidates the beat-aligned analysis preview when only timing maps change',async()=>{
 const {computeSelectedTrackAnalysisData}=await import('../engine/webAudioSynth');const {p}=fixture();
 const first=computeSelectedTrackAnalysisData(p,p.tracks[0],DEFAULT_HUMANIZATION,{masterVolumeDb:0,glueCompressionDrive:0,reverbDecaySec:1,reverbReturnLevel:0,delayFeedback:0,delayReturnLevel:0,subBassMonoCutoffHz:120},4,32);
 expect(first.totalBeats).toBe(12);expect(first.isMeasuredAudio).toBe(false);
 const changed={...p,tempoMap:[{beat:0,bpm:120}]};
 const second=computeSelectedTrackAnalysisData(changed,changed.tracks[0],DEFAULT_HUMANIZATION,{masterVolumeDb:0,glueCompressionDrive:0,reverbDecaySec:1,reverbReturnLevel:0,delayFeedback:0,delayReturnLevel:0,subBassMonoCutoffHz:120},4,32);
 expect(second.cacheKey).not.toBe(first.cacheKey);
});
