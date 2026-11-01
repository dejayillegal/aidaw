export interface TimelineViewportState {
  totalBars: number;
  beatsPerBar: number;
  totalBeats: number;
  scrollBeat: number;
  pixelsPerBeat: number;
  viewportWidthPx: number;
  minPixelsPerBeat: number;
  maxPixelsPerBeat: number;
}

export interface AdaptiveGridConfig {
  majorBarStep: number;
  minorBeatStep: number;
  subdivisionStep: number; // e.g. 0.25 for 1/16, 0.5 for 1/8, 1 for 1/4
  showSixteenths: boolean;
  showBeatNumbers: boolean;
  labelEveryNBars: number;
}

export const SUPPORTED_PROJECT_BAR_LENGTHS = [4, 8, 16, 32, 64, 128, 256, 512, 1024] as const;

export class TimelineViewportController {
  private state: TimelineViewportState;

  constructor(initial?: Partial<TimelineViewportState>) {
    const totalBars = Math.max(4, initial?.totalBars ?? 128);
    const beatsPerBar = Math.max(1, initial?.beatsPerBar ?? 4);
    const totalBeats = totalBars * beatsPerBar;
    const viewportWidthPx = Math.max(240, initial?.viewportWidthPx ?? 960);
    const minPixelsPerBeat = initial?.minPixelsPerBeat ?? Math.max(0.25, viewportWidthPx / Math.max(64, totalBeats));
    const maxPixelsPerBeat = initial?.maxPixelsPerBeat ?? 256;
    const defaultPpb = initial?.pixelsPerBeat ?? Math.max(minPixelsPerBeat, viewportWidthPx / Math.min(totalBeats, 64));

    this.state = {
      totalBars,
      beatsPerBar,
      totalBeats,
      scrollBeat: Math.max(0, initial?.scrollBeat ?? 0),
      pixelsPerBeat: this.clampPixelsPerBeat(defaultPpb, minPixelsPerBeat, maxPixelsPerBeat),
      viewportWidthPx,
      minPixelsPerBeat,
      maxPixelsPerBeat,
    };
    this.clampScroll();
  }

  public getState(): TimelineViewportState {
    return { ...this.state };
  }

  public get visibleBeats(): number {
    return this.state.viewportWidthPx / Math.max(0.05, this.state.pixelsPerBeat);
  }

  public get visibleBars(): number {
    return this.visibleBeats / this.state.beatsPerBar;
  }

  public get visibleStartBeat(): number {
    return this.state.scrollBeat;
  }

  public get visibleEndBeat(): number {
    return Math.min(this.state.totalBeats, this.state.scrollBeat + this.visibleBeats);
  }

  public setTotalBars(totalBars: number, preserveViewport = true): TimelineViewportState {
    const safeBars = Math.max(4, Math.min(2048, Math.round(totalBars)));
    this.state.totalBars = safeBars;
    this.state.totalBeats = safeBars * this.state.beatsPerBar;
    this.state.minPixelsPerBeat = Math.max(0.15, this.state.viewportWidthPx / Math.max(16, this.state.totalBeats));
    if (!preserveViewport) {
      this.fitArrangement();
    } else {
      this.state.pixelsPerBeat = this.clampPixelsPerBeat(
        this.state.pixelsPerBeat,
        this.state.minPixelsPerBeat,
        this.state.maxPixelsPerBeat
      );
      this.clampScroll();
    }
    return this.getState();
  }

  public setViewportWidth(widthPx: number): TimelineViewportState {
    const safeWidth = Math.max(200, widthPx);
    this.state.viewportWidthPx = safeWidth;
    this.state.minPixelsPerBeat = Math.max(0.15, safeWidth / Math.max(16, this.state.totalBeats));
    this.state.pixelsPerBeat = this.clampPixelsPerBeat(
      this.state.pixelsPerBeat,
      this.state.minPixelsPerBeat,
      this.state.maxPixelsPerBeat
    );
    this.clampScroll();
    return this.getState();
  }

  public beatToPixel(beat: number, leftOffsetPx = 0): number {
    return leftOffsetPx + (beat - this.state.scrollBeat) * this.state.pixelsPerBeat;
  }

  public pixelToBeat(pixelX: number, leftOffsetPx = 0): number {
    const localX = pixelX - leftOffsetPx;
    return this.state.scrollBeat + localX / Math.max(0.05, this.state.pixelsPerBeat);
  }

  /**
   * Cursor/pointer-anchored continuous logarithmic zoom.
   * Keeps the exact musical beat beneath anchorLocalPixelX stationary after zoom.
   */
  public zoomAtPixel(zoomFactor: number, anchorLocalPixelX: number): TimelineViewportState {
    const safeAnchorX = Math.max(0, Math.min(this.state.viewportWidthPx, anchorLocalPixelX));
    const anchorBeat = this.state.scrollBeat + safeAnchorX / Math.max(0.05, this.state.pixelsPerBeat);
    const nextPixelsPerBeat = this.clampPixelsPerBeat(
      this.state.pixelsPerBeat * zoomFactor,
      this.state.minPixelsPerBeat,
      this.state.maxPixelsPerBeat
    );
    this.state.pixelsPerBeat = nextPixelsPerBeat;
    this.state.scrollBeat = anchorBeat - safeAnchorX / nextPixelsPerBeat;
    this.clampScroll();
    return this.getState();
  }

  public setPixelsPerBeat(pixelsPerBeat: number, anchorLocalPixelX?: number): TimelineViewportState {
    const safeAnchor = anchorLocalPixelX ?? this.state.viewportWidthPx * 0.5;
    const anchorBeat = this.state.scrollBeat + safeAnchor / Math.max(0.05, this.state.pixelsPerBeat);
    const nextPpb = this.clampPixelsPerBeat(
      pixelsPerBeat,
      this.state.minPixelsPerBeat,
      this.state.maxPixelsPerBeat
    );
    this.state.pixelsPerBeat = nextPpb;
    this.state.scrollBeat = anchorBeat - safeAnchor / nextPpb;
    this.clampScroll();
    return this.getState();
  }

  public panByPixels(deltaPx: number): TimelineViewportState {
    const deltaBeats = deltaPx / Math.max(0.05, this.state.pixelsPerBeat);
    this.state.scrollBeat += deltaBeats;
    this.clampScroll();
    return this.getState();
  }

  public panToBeat(scrollBeat: number): TimelineViewportState {
    this.state.scrollBeat = scrollBeat;
    this.clampScroll();
    return this.getState();
  }

  public fitArrangement(): TimelineViewportState {
    const fitPpb = this.state.viewportWidthPx / Math.max(16, this.state.totalBeats);
    this.state.minPixelsPerBeat = Math.min(this.state.minPixelsPerBeat, fitPpb);
    this.state.pixelsPerBeat = this.clampPixelsPerBeat(
      fitPpb,
      this.state.minPixelsPerBeat,
      this.state.maxPixelsPerBeat
    );
    this.state.scrollBeat = 0;
    return this.getState();
  }

  public zoomToBarRange(startBar: number, endBar: number): TimelineViewportState {
    const loBar = Math.max(1, Math.min(startBar, endBar));
    const hiBar = Math.min(this.state.totalBars + 1, Math.max(startBar, endBar));
    const spanBars = Math.max(1, hiBar - loBar);
    const spanBeats = spanBars * this.state.beatsPerBar;
    const nextPpb = this.clampPixelsPerBeat(
      this.state.viewportWidthPx / spanBeats,
      this.state.minPixelsPerBeat,
      this.state.maxPixelsPerBeat
    );
    this.state.pixelsPerBeat = nextPpb;
    this.state.scrollBeat = (loBar - 1) * this.state.beatsPerBar;
    this.clampScroll();
    return this.getState();
  }

  public ensureBeatExtend(requiredEndBeat: number): { extended: boolean; totalBars: number; totalBeats: number } {
    if (requiredEndBeat <= this.state.totalBeats) {
      return { extended: false, totalBars: this.state.totalBars, totalBeats: this.state.totalBeats };
    }
    const neededBars = Math.ceil(requiredEndBeat / this.state.beatsPerBar);
    const paddedBars = Math.min(2048, Math.max(neededBars + 4, Math.ceil(neededBars / 8) * 8));
    this.setTotalBars(paddedBars, true);
    return { extended: true, totalBars: this.state.totalBars, totalBeats: this.state.totalBeats };
  }

  public getAdaptiveGridConfig(): AdaptiveGridConfig {
    const ppb = this.state.pixelsPerBeat;
    const pixelsPerBar = ppb * this.state.beatsPerBar;

    let labelEveryNBars = 1;
    if (pixelsPerBar < 8) labelEveryNBars = 32;
    else if (pixelsPerBar < 16) labelEveryNBars = 16;
    else if (pixelsPerBar < 32) labelEveryNBars = 8;
    else if (pixelsPerBar < 64) labelEveryNBars = 4;
    else if (pixelsPerBar < 110) labelEveryNBars = 2;

    const showBeatNumbers = ppb >= 28;
    const showSixteenths = ppb >= 48;
    const subdivisionStep = ppb >= 64 ? 0.25 : ppb >= 32 ? 0.5 : ppb >= 12 ? 1 : 4;

    return {
      majorBarStep: labelEveryNBars,
      minorBeatStep: 1,
      subdivisionStep,
      showSixteenths,
      showBeatNumbers,
      labelEveryNBars,
    };
  }

  private clampPixelsPerBeat(ppb: number, min: number, max: number): number {
    if (!Number.isFinite(ppb)) return min;
    return Math.max(min, Math.min(max, ppb));
  }

  private clampScroll(): void {
    const maxScroll = Math.max(0, this.state.totalBeats - this.visibleBeats);
    if (!Number.isFinite(this.state.scrollBeat)) {
      this.state.scrollBeat = 0;
      return;
    }
    this.state.scrollBeat = Math.max(0, Math.min(maxScroll, this.state.scrollBeat));
  }
}

export function formatBarBeatSixteenth(beat: number, beatsPerBar = 4): string {
  const safeBeat = Math.max(0, beat);
  const barIndex = Math.floor(safeBeat / beatsPerBar) + 1;
  const beatInBar = Math.floor(safeBeat % beatsPerBar) + 1;
  const sixteenthInBeat = Math.floor(((safeBeat % 1) + 1e-6) * 4) + 1;
  return `${barIndex}.${beatInBar}.${sixteenthInBeat}`;
}
