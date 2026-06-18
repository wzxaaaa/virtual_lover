import type { CameraCapture } from '../shared/types';

const MAX_CAMERA_WIDTH = 1280;
const MAX_CAMERA_HEIGHT = 720;
const JPEG_QUALITY = 0.8;

function estimateDataUrlBytes(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(',');
  const payload = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  return Math.max(0, Math.floor((payload.length * 3) / 4));
}

function fitFrameSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(MAX_CAMERA_WIDTH / Math.max(width, 1), MAX_CAMERA_HEIGHT / Math.max(height, 1), 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function isMostlyBlack(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const sampleWidth = Math.min(16, width);
  const sampleHeight = Math.min(16, height);
  const sampleX = Math.floor((width - sampleWidth) / 2);
  const sampleY = Math.floor((height - sampleHeight) / 2);
  const sample = ctx.getImageData(sampleX, sampleY, sampleWidth, sampleHeight);

  for (let index = 0; index < sample.data.length; index += 4) {
    if (sample.data[index] > 2 || sample.data[index + 1] > 2 || sample.data[index + 2] > 2) {
      return false;
    }
  }

  return true;
}

function captureCanvasFrame(video: HTMLVideoElement): CameraCapture | null {
  if (!video.videoWidth || !video.videoHeight) {
    return null;
  }

  const size = fitFrameSize(video.videoWidth, video.videoHeight);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }

  try {
    ctx.drawImage(video, 0, 0, size.width, size.height);
    if (isMostlyBlack(ctx, size.width, size.height)) {
      return null;
    }

    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    if (!dataUrl || dataUrl.length < 'data:image/jpeg;base64,'.length) {
      return null;
    }

    return {
      sourceId: 'camera:user',
      sourceName: '用户摄像头',
      dataUrl,
      mimeType: 'image/jpeg',
      byteLength: estimateDataUrlBytes(dataUrl),
      imageSize: size,
      capturedAt: Date.now()
    };
  } catch {
    return null;
  }
}

async function waitForVideoFrame(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error('摄像头画面超时')), 3_000);
    const cleanup = (): void => {
      window.clearTimeout(timeoutId);
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('error', onError);
    };
    const onLoaded = (): void => {
      cleanup();
      resolve();
    };
    const onError = (): void => {
      cleanup();
      reject(new Error('摄像头画面读取失败'));
    };
    video.addEventListener('loadeddata', onLoaded, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

export async function getUserCameraStream(existing?: MediaStream | null): Promise<MediaStream> {
  if (existing?.active && existing.getVideoTracks().some((track) => track.readyState === 'live')) {
    return existing;
  }

  const makeConstraints = (facingMode: VideoFacingModeEnum | { ideal: VideoFacingModeEnum }): MediaStreamConstraints => ({
    video: {
      facingMode,
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 1, max: 1 }
    },
    audio: false
  });

  const attempts: MediaStreamConstraints[] = [
    makeConstraints({ ideal: 'environment' }),
    makeConstraints('user'),
    {
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 1, max: 1 }
      },
      audio: false
    }
  ];

  let lastError: unknown;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('无法获取摄像头流');
}

export async function captureCameraFrame(stream: MediaStream): Promise<CameraCapture | null> {
  if (!stream.active) {
    return null;
  }

  const video = document.createElement('video');
  video.srcObject = stream;
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;

  try {
    await video.play().catch(() => undefined);
    await waitForVideoFrame(video);
    return captureCanvasFrame(video);
  } finally {
    video.srcObject = null;
    video.remove();
  }
}

export function stopCameraStream(stream?: MediaStream | null): void {
  stream?.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      // Ignore teardown races.
    }
  });
}
