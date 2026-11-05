import type { AbletonProjectState, SidechainCompressorConfig } from '../types/ableton';

const readiness = new WeakMap<BaseAudioContext, Promise<void>>();
const ready = new WeakSet<BaseAudioContext>();
export const SIDECHAIN_RANGES = {
  thresholdDb:[-60,0],ratio:[1,20],kneeDb:[0,24],attackMs:[.1,100],releaseMs:[10,1000],holdMs:[0,100],keyHighpassHz:[20,500],mix:[0,1],
} as const;
export function assertSidechainRouting(project: Pick<AbletonProjectState,'tracks'>): void {
  const tracks = new Map(project.tracks.map(t=>[t.id,t]));
  for (const track of project.tracks) {
    const c = track.sidechainCompressor; if (!c) continue;
    if(c.version!==1 || typeof c.enabled!=='boolean' || typeof c.sourceTrackId!=='string' || !c.sourceTrackId ||
      !tracks.has(c.sourceTrackId) || c.sourceTrackId===track.id || Object.entries(SIDECHAIN_RANGES).some(([key,[min,max]])=>{
        const value=c[key as keyof typeof SIDECHAIN_RANGES];return !Number.isFinite(value)||value<min||value>max;
      })) throw new Error('SIDECHAIN_CONFIG: valid version, key source and bounded parameters required');
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id:string) => {
    if(visiting.has(id)) throw new Error('SIDECHAIN_CYCLE: keyed feedback is unsupported');
    if(visited.has(id)) return; visiting.add(id);
    const c=tracks.get(id)?.sidechainCompressor;if(c?.enabled)visit(c.sourceTrackId);
    visiting.delete(id);visited.add(id);
  };
  for(const id of tracks.keys())visit(id);
}
export function requiresSidechain(project: Pick<AbletonProjectState,'tracks'>): boolean { return project.tracks.some(t=>t.sidechainCompressor?.enabled); }
export function isSidechainReady(ctx: BaseAudioContext): boolean {return ready.has(ctx);}
export async function prepareSidechainModule(ctx: BaseAudioContext): Promise<void> {
  if(ready.has(ctx))return;
  if(!ctx.audioWorklet || typeof AudioWorkletNode==='undefined')throw new Error('SIDECHAIN_UNSUPPORTED: this runtime cannot execute the requested compressor; explicitly disable it to bypass');
  let pending=readiness.get(ctx);
  if(!pending){pending=ctx.audioWorklet.addModule(`${import.meta.env.BASE_URL}audio/sidechain-processor.js`).then(()=>{ready.add(ctx);}).catch(error=>{
    readiness.delete(ctx);throw new Error(`SIDECHAIN_LOAD: module unavailable; project unchanged. ${String(error)}`);
  });readiness.set(ctx,pending);}
  await pending;
}
export interface SidechainChannel {
  muteSoloGate: GainNode; panner: StereoPannerNode;
  sidechainNode?: AudioWorkletNode; sidechainSource?: AudioNode;
  sidechainSignature?: string; sidechainReductionDb?: number; sidechainError?: string;
}
export function removeSidechain(channel: SidechainChannel): void {
  const node=channel.sidechainNode;if(!node)return;
  try{channel.sidechainSource?.disconnect(node,0,1);}catch{/* source may already be retired */}
  channel.muteSoloGate.disconnect(node);node.disconnect();node.port.onmessage=null;node.port.close();
  channel.muteSoloGate.connect(channel.panner);channel.sidechainNode=undefined;channel.sidechainSource=undefined;
  channel.sidechainSignature=undefined;channel.sidechainError=undefined;channel.sidechainReductionDb=0;
}
export function reconcileSidechains(ctx: BaseAudioContext, channels: Map<string,SidechainChannel>, project: AbletonProjectState): void {
  assertSidechainRouting(project);
  if(requiresSidechain(project)&&!ready.has(ctx))throw new Error('SIDECHAIN_NOT_READY: prepare audio processing before playback');
  for(const track of project.tracks){
    const channel=channels.get(track.id);if(!channel)continue;
    const c=track.sidechainCompressor;
    if(!c?.enabled){removeSidechain(channel);continue;}
    const source=channels.get(c.sourceTrackId)?.panner;
    if(!source)throw new Error('SIDECHAIN_KEY: source channel missing');
    if(!channel.sidechainNode){
      const node=new AudioWorkletNode(ctx,'aidaw-sidechain-v1',{numberOfInputs:2,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit'});
      channel.muteSoloGate.disconnect(channel.panner);channel.muteSoloGate.connect(node,0,0);node.connect(channel.panner);
      node.port.onmessage=event=>{const value=event.data?.gainReductionDb;if(Number.isFinite(value))channel.sidechainReductionDb=value;};
      node.onprocessorerror=()=>{channel.sidechainError='SIDECHAIN_PROCESSOR: audio processor failed; requested processing cannot be silently bypassed';};
      channel.sidechainNode=node;
    }
    const node=channel.sidechainNode;
    if(channel.sidechainSource!==source){try{channel.sidechainSource?.disconnect(node,0,1);}catch{/* retired source */}source.connect(node,0,1);channel.sidechainSource=source;}
    const signature=JSON.stringify(c);
    if(channel.sidechainSignature!==signature){
      for(const key of Object.keys(SIDECHAIN_RANGES))node.parameters.get(key)?.setValueAtTime(c[key as keyof typeof SIDECHAIN_RANGES],ctx.currentTime);
      channel.sidechainSignature=signature;
    }
  }
}
export function defaultSidechain(sourceTrackId:string): SidechainCompressorConfig {
  return {version:1,enabled:true,sourceTrackId,thresholdDb:-24,ratio:4,kneeDb:6,attackMs:5,releaseMs:150,holdMs:0,keyHighpassHz:40,mix:1};
}
