/** Playback modes supported by the Format-Shifting Engine. */
export enum PlaybackMode {
  /** Standard video + audio cinema playback. */
  Cinema = "cinema",
  /** Short-form vertical reel playback. */
  ShortReel = "short-reel",
  /** Audio-only podcast / Spotify mode (background or Drive Mode). */
  AudioOnly = "audio-only",
}

/** Represents a media session managed by the engine. */
export interface MediaSession {
  sessionId: string;
  streamUrl: string;
  mode: PlaybackMode;
  /** Whether the OTT video cache is still retained. */
  cacheRetained: boolean;
  /** ISO-8601 timestamp when the session was created. */
  createdAt: string;
  /** ISO-8601 timestamp of the last mode transition. */
  updatedAt: string;
}

/** Payload sent by the client to start a new stream session. */
export interface CreateSessionRequest {
  streamUrl: string;
  mode?: PlaybackMode;
}

/** Payload sent by the client to transition playback mode. */
export interface TransitionModeRequest {
  mode: PlaybackMode;
}

/** Status of a deep-dubbing translation job. */
export enum DubbingJobStatus {
  Queued = "queued",
  Processing = "processing",
  Completed = "completed",
  Failed = "failed",
}

/** A deep-dubbing translation job. */
export interface DubbingJob {
  jobId: string;
  sessionId: string;
  targetLanguage: string;
  status: DubbingJobStatus;
  createdAt: string;
  updatedAt: string;
}

/** Payload to request a new dubbing job. */
export interface CreateDubbingJobRequest {
  sessionId: string;
  targetLanguage: string;
}

/**
 * The 150 languages supported for Generative Deep-Dubbing.
 * This list covers the top spoken languages worldwide.
 */
export const SUPPORTED_LANGUAGES: string[] = [
  "af","am","ar","as","az","ba","be","bg","bn","bo","br","bs","ca","ceb","cs",
  "cy","da","de","el","en","eo","es","et","eu","fa","fi","fil","fo","fr","fy",
  "ga","gd","gl","gu","ha","haw","he","hi","hmn","hr","ht","hu","hy","id","ig",
  "is","it","ja","jv","ka","kk","km","kn","ko","ku","ky","la","lb","lo","lt",
  "lv","mg","mi","mk","ml","mn","mr","ms","mt","my","nb","ne","nl","nn","no",
  "ny","oc","or","pa","pl","ps","pt","qu","ro","ru","rw","sa","sd","si","sk",
  "sl","sm","sn","so","sq","sr","st","su","sv","sw","ta","te","tg","th","ti",
  "tk","tl","tn","to","tr","ts","tt","tw","ug","uk","ur","uz","ve","vi","vo",
  "wa","wo","xh","yi","yo","zh","zu","arz","azb","cdo","ckb","diq","eml","ext",
  "frr","gan","glk","gn","got","gsw","hak","hsb","ilo","jbo","kab","krc","ksh",
  "lij","lmo","ltg",
];
