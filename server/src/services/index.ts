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

export {
  getPreferences,
  updatePreferences,
  recordWatchSession,
  getWatchSessions,
  getStatus,
  getInsights,
  DEFAULT_PREFERENCES,
  _resetWellbeing,
} from "./wellbeing";
export type {
  WellbeingPreferences,
  WatchSession,
  WellbeingStatus,
  WellbeingInsights,
  RecordWatchSessionInput,
  UpdatePreferencesPatch,
} from "./wellbeing";

// ---------------------------------------------------------------------------
// Upload & Transcode pipeline
// ---------------------------------------------------------------------------

export {
  initiateUpload,
  uploadChunk,
  getUploadSession,
  listUploadSessions,
  deleteUploadSession,
  extractVideoMetadata,
  generateThumbnail,
  parseTusMetadata,
  buildTusMetadata,
  uploadEvents,
  _resetUploadSessions,
} from "./UploadService";
export type {
  UploadSession,
  UploadStatus,
  VideoMetadata,
  InitiateUploadParams,
  InitiateUploadResult,
  UploadChunkParams,
  UploadChunkResult,
} from "./UploadService";

export {
  enqueueTranscode,
  getTranscodeJob,
  listTranscodeJobs,
  buildHlsCommand,
  buildDashCommand,
  generateHlsMasterPlaylist,
  parseProgressFromFfmpegStderr,
  tokenizeCommand,
  transcodingEvents,
  BITRATE_VARIANTS,
  _resetTranscodeJobs,
} from "./TranscodeService";
export type {
  TranscodeJob,
  TranscodeStatus,
  BitrateVariant,
  EnqueueTranscodeParams,
} from "./TranscodeService";

// ---------------------------------------------------------------------------
// Deep Dubbing pipeline
// ---------------------------------------------------------------------------

export {
  transcribeAudio,
  getTranscriptionJob,
  listTranscriptionJobs,
  _resetTranscriptionJobs,
} from "./TranscriptionService";
export type {
  TranscriptSegment,
  TranscriptionResult,
  TranscriptionJob,
  TranscribeAudioParams,
} from "./TranscriptionService";

export {
  translateSegments,
  getTranslationJob,
  listTranslationJobs,
  computeTimingMultiplier,
  adjustSegmentTimings,
  _resetTranslationJobs,
} from "./TranslationService";
export type {
  TranslatedSegment,
  TranslationResult,
  TranslationJob,
  TranslateSegmentsParams,
} from "./TranslationService";

export {
  synthesizeAudio,
  getSynthesisJob,
  listSynthesisJobs,
  extractVoiceProfile,
  computeLipSyncStretchRatio,
  buildAtempoCommand,
  buildAudioMixCommand,
  _resetSynthesisJobs,
} from "./VoiceSynthesisService";
export type {
  VoiceProfile,
  SynthesisResult,
  SynthesisJob,
  SynthesisSegment,
  SynthesizeAudioParams,
} from "./VoiceSynthesisService";

// ---------------------------------------------------------------------------
// Recommendation engine
// ---------------------------------------------------------------------------

export {
  indexVideo,
  removeVideoFromIndex,
  getContentSimilar,
  getIndexSize,
  getFeatureVector,
  cosineSimilarity,
  dotProduct,
  magnitude,
  tokenize,
  getDurationBucket,
  buildFeatureVector,
  computeTfIdf,
  _resetContentIndex,
} from "./ContentRecommender";
export type {
  VideoFeatures,
  ContentSimilarityEntry,
  ContentRecommendation,
} from "./ContentRecommender";

export {
  recordInteraction,
  recordInteractions,
  getCollaborativeRecommendations,
  getUserInteractions,
  getConfidence,
  getModelState,
  trainAls,
  gaussianElimination,
  _resetCollaborativeModel,
} from "./CollaborativeRecommender";
export type {
  UserInteraction,
  InteractionType,
  CollaborativeRecommendation,
} from "./CollaborativeRecommender";

export {
  getRecommendations,
  registerVideo,
  unregisterVideo,
  getTrendingFeed,
  computeTrendingScore,
  applyDiversityPenalty,
  _resetHybridRecommender,
} from "./HybridRecommender";
export type {
  HybridRecommendation,
  VideoMetaForRecommender,
} from "./HybridRecommender";

export * from "./AutoplayEngine";
export * from "./WatchStreakService";
export * from "./ExitIntentTrigger";
export {
  DEFAULT_SCENE_UNDERSTANDING_CONFIG,
  buildSceneUnderstandingReport,
  detectSceneBoundaries,
  buildSceneSegments,
  detectHighlightMoments,
  rankThumbnailCandidates,
  generateChapters,
} from "./SceneUnderstandingService";
export type {
  HistogramTriple,
  FrameSignalInput,
  SceneBoundary,
  SceneSegment,
  HighlightMoment,
  SceneUnderstandingReport,
  SceneUnderstandingConfig,
  ChapterSegment,
  ThumbnailCandidate as SceneThumbnailCandidate,
} from "./SceneUnderstandingService";

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
  publishRemix,
  getTrendingRemixes,
  getRemixChain,
  getPublishedRemix,
  incrementRemixViewCount,
  remixEvents,
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
  PublishedRemix,
  PublishOptions,
  RemixEventName,
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
  SFX_IDS,
  VOICE_BANK,
} from "./AudioRemixService";
export type {
  MusicGenre,
  SfxId,
  VoiceId,
  AudioJobType,
  AudioJobStatus,
  AudioRemixJob,
  SfxEntry,
  ResolvedSfxEntry,
} from "./AudioRemixService";

export {
  NARRATIVE_PREFERENCES,
  generateNarrativeSegment,
  enqueueDeepDubbingSimulation,
  getDeepDubbingSimulationJob,
  _resetNarrativeGenerator,
} from "./NarrativeGenerator";
export type {
  NarrativePreference,
  GenerateNarrativeInput,
  NarrativeChoice,
  NarrativeSegment,
  DeepDubbingSimulationInput,
  DeepDubbingSimulationJob,
} from "./NarrativeGenerator";

export {
  LIGHTING_PRESETS,
  enqueueAvatarSynthJob,
  getAvatarSynthJob,
  _resetAvatarSynthJobs,
} from "./AvatarSynth";
export type {
  LightingPreset,
  AvatarFrameSynthesis,
  EnqueueAvatarSynthInput,
  AvatarSynthJob,
} from "./AvatarSynth";
