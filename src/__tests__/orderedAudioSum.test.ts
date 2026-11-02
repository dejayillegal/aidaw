import { expect, it } from 'vitest';
import { OrderedAudioSum, connectOrderedSources } from '../engine/orderedAudioSum';

class Node {
  inputs = new Set<Node>(); outputs = new Set<Node>();
  constructor(public context: Context, public signal?: number) { context.nodes.push(this); }
  connect(destination: Node) { this.outputs.add(destination); destination.inputs.add(this); return destination; }
  disconnect(destination?: Node) {
    for (const target of destination ? [destination] : [...this.outputs]) { this.outputs.delete(target); target.inputs.delete(this); }
  }
}
class Context {
  nodes: Node[] = [];
  createGain() { return new Node(this); }
}
function evaluate(node: Node, reverse = false): number {
  if (node.signal !== undefined) return Math.fround(node.signal);
  return (reverse ? [...node.inputs].reverse() : [...node.inputs]).reduce((sum, input) => Math.fround(sum + evaluate(input, reverse)), 0);
}
const audio = (n: Node) => n as unknown as AudioNode;
const context = (c: Context) => c as unknown as BaseAudioContext;

it('removes floating-point summation-order dependence without dropping sources', () => {
  const baseline = new Context(), naive = new Node(baseline);
  for (const value of [1e10,-1e10,1]) new Node(baseline,value).connect(naive);
  expect(evaluate(naive)).not.toBe(evaluate(naive,true));
  const ctx = new Context(), destination = new Node(ctx), sum = new OrderedAudioSum(context(ctx),audio(destination));
  for (const value of [1e10,-1e10,1,2,3,4,5]) sum.add(audio(new Node(ctx,value)));
  expect(sum.getResourceStats().activeSources).toBe(7);
  expect(evaluate(destination)).toBe(evaluate(destination,true));
  expect(ctx.nodes.every(n=>n.inputs.size<=2)).toBe(true);
});

it('prunes released branches across 10000 sources and preserves still-active voices', () => {
  const ctx = new Context(), destination = new Node(ctx), sum = new OrderedAudioSum(context(ctx),audio(destination));
  const anchor = sum.add(audio(new Node(ctx,3)));
  for(let i=0;i<10000;i++) {
    const node = new Node(ctx,2), release = sum.add(audio(node));
    expect(evaluate(destination)).toBe(5); release(); release();
    expect(node.outputs.size).toBe(0); expect(evaluate(destination)).toBe(3);
    const stats=sum.getResourceStats();expect(stats.activeSources).toBe(1); expect(stats.nodes).toBeLessThanOrEqual(stats.depth*3);
  }
  anchor(); expect(sum.getResourceStats().activeSources).toBe(0); expect(evaluate(destination)).toBe(0);
});

it('keeps static oscillator and return sums ordered too', () => {
  const ctx=new Context(), destination=new Node(ctx);
  connectOrderedSources(context(ctx),[1e10,-1e10,1,2,3].map(v=>audio(new Node(ctx,v))),audio(destination));
  expect(evaluate(destination)).toBe(evaluate(destination,true));expect(ctx.nodes.every(n=>n.inputs.size<=2)).toBe(true);
});

it('rejects cross-context sources before changing resource state', () => {
  const ctx=new Context(), sum=new OrderedAudioSum(context(ctx),audio(new Node(ctx))), before=sum.getResourceStats();
  expect(()=>sum.add(audio(new Node(new Context(),1)))).toThrow(/AUDIO_SUM_CONTEXT/);
  expect(sum.getResourceStats()).toEqual(before);
});
