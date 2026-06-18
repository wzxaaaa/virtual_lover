const TARGET_RMS = 0.09;
const NOISE_FLOOR_RMS = 0.008;
const MIN_GAIN = 0.55;
const MAX_GAIN = 8;
const AGC_ATTACK = 0.38;
const AGC_RELEASE = 0.055;
const CLIPPING_SAMPLE_RATIO = 0.005;
const SIGNAL_RMS_THRESHOLD = 0.008;
const LOW_VOLUME_PEAK = 0.15;
const HIGH_VOLUME_PEAK = 0.85;

export type AudioInputHealthStatus = 'idle' | 'waiting' | 'low' | 'normal' | 'high' | 'clipping';

export type AudioInputLevelMetrics = {
  rms: number;
  peak: number;
  clippedRatio: number;
  gain: number;
  hasSignal: boolean;
  status: AudioInputHealthStatus;
  label: string;
  hint: string;
  color: string;
};

export const IDLE_AUDIO_INPUT_LEVEL: AudioInputLevelMetrics = {
  rms: 0,
  peak: 0,
  clippedRatio: 0,
  gain: 1,
  hasSignal: false,
  status: 'idle',
  label: '未录音',
  hint: '开始录音后可查看音量',
  color: '#4f8cff'
};

export type AudioInputPipeline = {
  context: AudioContext;
  analyser: AnalyserNode;
  recordingStream: MediaStream;
  inputStream: MediaStream;
  updateAgc: () => AudioInputLevelMetrics;
  dispose: () => void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function classifyInputLevel(rms: number, peak: number, clippedRatio: number, gain: number): AudioInputLevelMetrics {
  const isClipping = clippedRatio >= CLIPPING_SAMPLE_RATIO;
  const hasSignal = rms >= SIGNAL_RMS_THRESHOLD;
  const lowVolume = hasSignal && peak < LOW_VOLUME_PEAK;
  const high = hasSignal && !isClipping && peak > HIGH_VOLUME_PEAK;

  if (isClipping) {
    return {
      rms,
      peak,
      clippedRatio,
      gain,
      hasSignal,
      status: 'clipping',
      label: '过载',
      hint: '麦克风增益过高，音频被削顶，AI 可能识别异常，请调低增益',
      color: '#dc3545'
    };
  }

  if (high) {
    return {
      rms,
      peak,
      clippedRatio,
      gain,
      hasSignal,
      status: 'high',
      label: '音量较高',
      hint: '音量偏高，建议调低增益',
      color: '#fd7e14'
    };
  }

  if (lowVolume) {
    return {
      rms,
      peak,
      clippedRatio,
      gain,
      hasSignal,
      status: 'low',
      label: '音量偏低',
      hint: '音量较低，建议调高增益',
      color: '#ffc107'
    };
  }

  if (hasSignal) {
    return {
      rms,
      peak,
      clippedRatio,
      gain,
      hasSignal,
      status: 'normal',
      label: '正常',
      hint: '麦克风工作正常',
      color: '#28a745'
    };
  }

  return {
    rms,
    peak,
    clippedRatio,
    gain,
    hasSignal,
    status: 'waiting',
    label: '等待声音',
    hint: '麦克风正在监听，请说话',
    color: '#4f8cff'
  };
}

function metricsFromAnalyser(analyser: AnalyserNode, dataArray: Float32Array<ArrayBuffer>, gain: number): AudioInputLevelMetrics {
  analyser.getFloatTimeDomainData(dataArray);

  let peak = 0;
  let sum = 0;
  for (const value of dataArray) {
    const abs = Math.abs(value);
    if (abs > peak) {
      peak = abs;
    }
    sum += value * value;
  }

  let clippedCount = 0;
  for (const value of dataArray) {
    if (Math.abs(value) >= 0.999) {
      clippedCount += 1;
    }
  }

  return classifyInputLevel(Math.sqrt(sum / dataArray.length), peak, clippedCount / dataArray.length, gain);
}

export function createAudioInputPipeline(inputStream: MediaStream): AudioInputPipeline {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(inputStream);
  const highpass = context.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 80;
  highpass.Q.value = 0.65;

  const agcGain = context.createGain();
  agcGain.gain.value = 1;

  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 12;
  limiter.ratio.value = 14;
  limiter.attack.value = 0.004;
  limiter.release.value = 0.14;

  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.12;

  const destination = context.createMediaStreamDestination();
  source.connect(highpass);
  highpass.connect(agcGain);
  agcGain.connect(limiter);
  limiter.connect(analyser);
  analyser.connect(destination);

  const agcData = new Float32Array(analyser.fftSize) as Float32Array<ArrayBuffer>;
  let currentGain = 1;

  const updateAgc = (): AudioInputLevelMetrics => {
    const metrics = metricsFromAnalyser(analyser, agcData, currentGain);
    const rms = metrics.rms;
    const desiredGain = rms > NOISE_FLOOR_RMS ? clamp(TARGET_RMS / Math.max(rms, 0.0001), MIN_GAIN, MAX_GAIN) : Math.min(currentGain, 1);
    const smoothing = desiredGain < currentGain ? AGC_ATTACK : AGC_RELEASE;
    currentGain += (desiredGain - currentGain) * smoothing;
    agcGain.gain.setTargetAtTime(currentGain, context.currentTime, 0.025);
    return { ...metrics, gain: currentGain };
  };

  const dispose = (): void => {
    source.disconnect();
    highpass.disconnect();
    agcGain.disconnect();
    limiter.disconnect();
    analyser.disconnect();
    destination.disconnect();
    destination.stream.getTracks().forEach((track) => track.stop());
    if (context.state !== 'closed') {
      context.close().catch(() => undefined);
    }
  };

  return {
    context,
    analyser,
    recordingStream: destination.stream,
    inputStream,
    updateAgc,
    dispose
  };
}
