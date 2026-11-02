interface SumNode {
  gain: GainNode;
  start: number;
  size: number;
  active: number;
  parent?: SumNode;
  left?: SumNode;
  right?: SumNode;
}

/** Native unity-gain tree: every addition has at most two inputs and a stable grouping. */
export class OrderedAudioSum {
  private root: SumNode;
  private nextIndex = 0;
  private nodes = new Set<SumNode>();

  constructor(private context: BaseAudioContext, private destination: AudioNode) {
    this.root = this.createNode(0, 1);
    this.root.gain.connect(destination);
  }

  private createNode(start: number, size: number, parent?: SumNode): SumNode {
    const node = { gain: this.context.createGain(), start, size, active: 0, parent };
    this.nodes.add(node);
    return node;
  }

  /** Caller retains the lease until its source and effect tail have finished. No source is dropped. */
  add(source: AudioNode): () => void {
    if (source.context !== this.context) throw new Error('AUDIO_SUM_CONTEXT: source belongs to another context');
    if (!Number.isSafeInteger(this.nextIndex + 1)) throw new Error('AUDIO_SUM_CAPACITY: source identity exhausted');
    const index = this.nextIndex++;
    while (index >= this.root.size) {
      const old = this.root;
      const parent = this.createNode(0, old.size * 2);
      parent.left = old; parent.active = old.active; old.parent = parent;
      old.gain.disconnect(this.destination);
      old.gain.connect(parent.gain);
      parent.gain.connect(this.destination);
      this.root = parent;
    }
    let leaf = this.root;
    while (leaf.size > 1) {
      const half = leaf.size / 2;
      const side = index < leaf.start + half ? 'left' : 'right';
      if (!leaf[side]) {
        const child = this.createNode(side === 'left' ? leaf.start : leaf.start + half, half, leaf);
        child.gain.connect(leaf.gain); leaf[side] = child;
      }
      leaf = leaf[side]!;
    }
    source.connect(leaf.gain);
    for (let node: SumNode | undefined = leaf; node; node = node.parent) node.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      source.disconnect(leaf.gain);
      for (let node: SumNode | undefined = leaf; node;) {
        node.active--;
        const parent: SumNode | undefined = node.parent;
        if (node !== this.root && node.active === 0) {
          node.gain.disconnect(parent!.gain);
          if (parent!.left === node) parent!.left = undefined; else parent!.right = undefined;
          this.nodes.delete(node);
        }
        node = parent;
      }
    };
  }

  getResourceStats(): { nodes: number; activeSources: number; depth: number } {
    return { nodes: this.nodes.size, activeSources: this.root.active, depth: Math.log2(this.root.size) + 1 };
  }
}

/** Static small sums used inside voices and the master return junction. */
export function connectOrderedSources(
  context: BaseAudioContext, sources: AudioNode[], destination: AudioNode,
  own: <T extends AudioNode>(node: T) => T = node => node
): void {
  let level = sources;
  while (level.length > 2) {
    const next: AudioNode[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (!level[i + 1]) { next.push(level[i]); continue; }
      const sum = own(context.createGain());
      level[i].connect(sum); level[i + 1].connect(sum); next.push(sum);
    }
    level = next;
  }
  for (const source of level) source.connect(destination);
}
