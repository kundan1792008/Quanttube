export {
  createSession,
  getSession,
  transitionMode,
  deleteSession,
  listSessions,
  extractAudioBuffer,
  createDubbingJob,
  batchCreateDubbingJobs,
  updateDubbingJobStatus,
  getDubbingJob,
  listDubbingJobs,
  createReelShare,
  getReelShare,
  listReelShares,
  registerReelShareClick,
  getAvatarDashboardStates,
  _resetStores,
} from "./engine";
export type { AudioBufferResponse } from "./engine";

export {
  ingestSignal,
  getRecommendation,
  getSignalsForUser,
  _resetTelepathicFeed,
} from "./telepathic-feed";
export type { CrossAppSignal, CrossAppSignalType, MediaRecommendation } from "./telepathic-feed";

export * from "./AutoplayEngine";
export * from "./WatchStreakService";
export * from "./ExitIntentTrigger";

// ---------------------------------------------------------------------------
// AI Video Remix Engine
// ---------------------------------------------------------------------------

export {
  applyStyleTransfer,
  swapBackground,
  generateAlternateEnding,
  addVisualEffects,
  getRemixJob,
  listRemixJobs,
  remixProgressEmitter,
  _resetRemixEngine,
  STYLE_PRESETS,
  VISUAL_EFFECTS,
  BACKGROUND_PRESETS,
} from "./RemixEngine";
export type {
  StylePreset,
  VisualEffect,
  BackgroundPreset,
  RemixJobType,
  RemixJobStatus,
  RemixJob,
  StyleTransferJob,
  BackgroundSwapJob,
  AlternateEndingJob,
  VisualEffectsJob,
  RemixProgressEvent,
} from "./RemixEngine";

export {
  changeMusic,
  addSoundEffects,
  speedChange,
  voiceClone,
  getAudioJob,
  listAudioJobs,
  _resetAudioRemixService,
  MUSIC_GENRES,
  SOUND_EFFECTS,
} from "./AudioRemixService";
export type {
  MusicGenre,
  SoundEffectId,
  AudioJobType,
  AudioJobStatus,
  AudioJob,
  MusicChangeJob,
  SfxInjectionJob,
  SfxTimestamp,
  SpeedChangeJob,
  VoiceCloneJob,
} from "./AudioRemixService";
