import { desktopCapturer, nativeImage, screen } from 'electron';
import { ScreenCapture } from '../shared/types';

const MAX_CAPTURE_WIDTH = 1280;
const MAX_CAPTURE_HEIGHT = 720;
const MAX_CAPTURE_BYTES = 1024 * 1024;
const JPEG_QUALITIES = [80, 72, 64, 56];
const SCALE_FACTORS = [1, 0.85, 0.72];

function fitSize(width: number, height: number, scale = 1): { width: number; height: number } {
  const ratio = Math.min(MAX_CAPTURE_WIDTH / Math.max(width, 1), MAX_CAPTURE_HEIGHT / Math.max(height, 1), 1) * scale;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio))
  };
}

function jpegDataUrl(bytes: Buffer): string {
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

function compressedScreenshot(thumbnail: Electron.NativeImage): { dataUrl: string; imageSize: { width: number; height: number }; byteLength: number } {
  const sourceSize = thumbnail.getSize();
  let best: { image: Electron.NativeImage; bytes: Buffer } | null = null;

  for (const scale of SCALE_FACTORS) {
    const size = fitSize(sourceSize.width, sourceSize.height, scale);
    const image = thumbnail.resize({
      width: size.width,
      height: size.height,
      quality: 'best'
    });

    for (const quality of JPEG_QUALITIES) {
      const bytes = image.toJPEG(quality);
      best = !best || bytes.length < best.bytes.length ? { image, bytes } : best;
      if (bytes.length <= MAX_CAPTURE_BYTES) {
        return {
          dataUrl: jpegDataUrl(bytes),
          imageSize: image.getSize(),
          byteLength: bytes.length
        };
      }
    }
  }

  if (best) {
    return {
      dataUrl: jpegDataUrl(best.bytes),
      imageSize: best.image.getSize(),
      byteLength: best.bytes.length
    };
  }

  const fallback = nativeImage.createEmpty();
  const fallbackBytes = fallback.toJPEG(80);
  return {
    dataUrl: jpegDataUrl(fallbackBytes),
    imageSize: fallback.getSize(),
    byteLength: fallbackBytes.length
  };
}

export async function capturePrimaryScreen(): Promise<ScreenCapture> {
  const primaryDisplay = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: MAX_CAPTURE_WIDTH,
      height: MAX_CAPTURE_HEIGHT
    },
    fetchWindowIcons: false
  });

  const source =
    sources.find((item) => item.display_id === String(primaryDisplay.id)) ??
    sources.find((item) => item.name.toLowerCase().includes('screen')) ??
    sources[0];

  if (!source) {
    throw new Error('No screen source is available.');
  }

  const capture = compressedScreenshot(source.thumbnail);

  return {
    sourceId: source.id,
    sourceName: source.name,
    dataUrl: capture.dataUrl,
    mimeType: 'image/jpeg',
    byteLength: capture.byteLength,
    imageSize: capture.imageSize,
    bounds: {
      x: primaryDisplay.bounds.x,
      y: primaryDisplay.bounds.y,
      width: primaryDisplay.bounds.width,
      height: primaryDisplay.bounds.height
    }
  };
}
