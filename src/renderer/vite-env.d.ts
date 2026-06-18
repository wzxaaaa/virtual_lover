/// <reference types="vite/client" />

import type { VirtualLoverApi } from '../preload/preload';

declare global {
  type SpeechRecognitionResultLike = {
    isFinal: boolean;
    [index: number]: {
      transcript: string;
    };
  };

  type SpeechRecognitionEventLike = Event & {
    resultIndex: number;
    results: {
      length: number;
      [index: number]: SpeechRecognitionResultLike;
    };
  };

  type SpeechRecognitionLike = EventTarget & {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    start: () => void;
    stop: () => void;
    abort: () => void;
    onresult: ((event: SpeechRecognitionEventLike) => void) | null;
    onerror: ((event: Event) => void) | null;
    onend: (() => void) | null;
  };

  type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

  type AvatarPerformanceStageInstance = {
    isAvailable?: () => boolean;
    acquire?: (owner: string, options?: Record<string, unknown>) => unknown;
    release?: (sessionId?: string, reason?: string) => Promise<boolean> | boolean;
    destroy?: () => void;
  };

  type AvatarPerformanceApi = {
    createLive2DPerformance?: (options?: Record<string, unknown>) => AvatarPerformanceStageInstance;
    createLive2DDriver?: (options?: Record<string, unknown>) => unknown;
    getDefaultCoordinator?: () => unknown;
    isCapabilityLocked?: (avatarId: string, capability: string) => boolean;
    getLockedCapabilities?: (avatarId: string) => string[];
    contracts?: unknown;
  };

  type VirtualLoverLive2DManager = {
    currentModel: unknown | null;
    pixi_app?: unknown;
    fileReferences?: unknown;
    emotionMapping?: unknown;
    modelUrl?: string;
    getCurrentModel: () => unknown | null;
    getAvatarPerformanceAvatarIds?: () => string[];
    isAvatarPerformanceCapabilityLocked?: (capability: string) => boolean;
    resolveAssetPath?: (assetPath: string) => string;
    playMotion?: (name: string) => Promise<boolean>;
    playExpression?: (name: string, file?: string) => Promise<boolean>;
    setEmotion?: (emotion: string) => Promise<boolean>;
    clearEmotionEffects?: () => boolean;
    setTemporaryPoseOverride?: (source: string, callback: (coreModel: unknown) => void) => boolean;
    clearTemporaryPoseOverride?: (source: string) => boolean;
  };

  interface Window {
    lover: VirtualLoverApi;
    AvatarPerformance?: AvatarPerformanceApi;
    AvatarPerformanceStage?: unknown;
    live2dManager?: VirtualLoverLive2DManager;
    virtualLoverLive2DPerformance?: AvatarPerformanceStageInstance;
    NekoAvatarMultiScreenDragHint?: {
      recordDisplaySwitchMiss: (source?: string) => Promise<boolean>;
      markDisplaySwitchSuccess: (source?: string) => boolean;
      ackPrompt: () => void;
      dismissForever: () => void;
      _readState: () => unknown;
    };
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
    PIXI?: unknown;
  }
}

declare module 'pixi-live2d-display/cubism4' {
  export const Live2DModel: {
    from: (source: string, options?: Record<string, unknown>) => Promise<any>;
  };
}
