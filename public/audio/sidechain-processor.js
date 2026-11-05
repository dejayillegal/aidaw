import { SidechainKernel } from './sidechain-kernel.js';
class SidechainProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {name:'thresholdDb',defaultValue:-24,minValue:-60,maxValue:0,automationRate:'k-rate'},
      {name:'ratio',defaultValue:4,minValue:1,maxValue:20,automationRate:'k-rate'},
      {name:'kneeDb',defaultValue:6,minValue:0,maxValue:24,automationRate:'k-rate'},
      {name:'attackMs',defaultValue:5,minValue:.1,maxValue:100,automationRate:'k-rate'},
      {name:'releaseMs',defaultValue:150,minValue:10,maxValue:1000,automationRate:'k-rate'},
      {name:'holdMs',defaultValue:0,minValue:0,maxValue:100,automationRate:'k-rate'},
      {name:'keyHighpassHz',defaultValue:40,minValue:20,maxValue:500,automationRate:'k-rate'},
      {name:'mix',defaultValue:1,minValue:0,maxValue:1,automationRate:'k-rate'},
    ];
  }
  constructor() {
    super(); this.kernel = new SidechainKernel(sampleRate); this.blocks = 0;
    this.settings = {thresholdDb:-24,ratio:4,kneeDb:6,attackMs:5,releaseMs:150,holdMs:0,keyHighpassHz:40,mix:1};
    this.telemetry = {gainReductionDb:0};
  }
  process(inputs, outputs, parameters) {
    const settings = this.settings;
    settings.thresholdDb=parameters.thresholdDb[0]; settings.ratio=parameters.ratio[0]; settings.kneeDb=parameters.kneeDb[0];
    settings.attackMs=parameters.attackMs[0]; settings.releaseMs=parameters.releaseMs[0]; settings.holdMs=parameters.holdMs[0];
    settings.keyHighpassHz=parameters.keyHighpassHz[0]; settings.mix=parameters.mix[0];
    this.kernel.process(inputs[0],inputs[1],outputs[0],settings);
    if (++this.blocks >= 32) { this.blocks=0; this.telemetry.gainReductionDb=this.kernel.gainReductionDb; this.port.postMessage(this.telemetry); }
    return true;
  }
}
registerProcessor('aidaw-sidechain-v1', SidechainProcessor);
