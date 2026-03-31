"use client";

import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";

/** Playback modes – kept in sync with the backend enum. */
export enum PlaybackMode {
  Cinema = "cinema",
  ShortReel = "short-reel",
  AudioOnly = "audio-only",
}

interface MediaState {
  mode: PlaybackMode;
  sessionId: string | null;
  streamUrl: string | null;
}

interface MediaContextValue {
  state: MediaState;
  setMode: (mode: PlaybackMode) => void;
  setSession: (sessionId: string, streamUrl: string) => void;
  clearSession: () => void;
}

const MediaContext = createContext<MediaContextValue | undefined>(undefined);

export function MediaProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MediaState>({
    mode: PlaybackMode.Cinema,
    sessionId: null,
    streamUrl: null,
  });

  const setMode = useCallback((mode: PlaybackMode) => {
    setState((prev) => ({ ...prev, mode }));
  }, []);

  const setSession = useCallback((sessionId: string, streamUrl: string) => {
    setState((prev) => ({ ...prev, sessionId, streamUrl }));
  }, []);

  const clearSession = useCallback(() => {
    setState({ mode: PlaybackMode.Cinema, sessionId: null, streamUrl: null });
  }, []);

  return (
    <MediaContext.Provider value={{ state, setMode, setSession, clearSession }}>
      {children}
    </MediaContext.Provider>
  );
}

export function useMedia(): MediaContextValue {
  const ctx = useContext(MediaContext);
  if (!ctx) throw new Error("useMedia must be used within a MediaProvider");
  return ctx;
}
