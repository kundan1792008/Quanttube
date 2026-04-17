"use client";

import React, { useMemo, useRef, useState } from "react";

type PartyEventType =
  | "party_join"
  | "party_leave"
  | "play"
  | "pause"
  | "seek"
  | "chat"
  | "heartbeat"
  | "sync_state";

interface PartyEvent {
  eventId: string;
  type: PartyEventType;
  userId: string;
  timestamp: string;
  payload: Record<string, string | number | boolean | null>;
}

interface ParticipantState {
  userId: string;
  isHost: boolean;
  isOnline: boolean;
  joinedAt: string;
  lastHeartbeatAt: string;
}

interface SocialWatchPartyProps {
  partyId: string;
  userId: string;
  wsUrl?: string;
  initialHostId?: string;
}

interface PlaybackState {
  isPlaying: boolean;
  currentTimeSeconds: number;
  mediaId: string;
}

const HEARTBEAT_MS = 5000;

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export default function SocialWatchParty({
  partyId,
  userId,
  wsUrl = "ws://localhost:4000/ws/watch-party",
  initialHostId,
}: SocialWatchPartyProps) {
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<PartyEvent[]>([]);
  const [participants, setParticipants] = useState<Record<string, ParticipantState>>({});
  const [chatInput, setChatInput] = useState("");
  const [playback, setPlayback] = useState<PlaybackState>({
    isPlaying: false,
    currentTimeSeconds: 0,
    mediaId: "demo-media-001",
  });

  const socketRef = useRef<WebSocket | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);

  const hostId = initialHostId ?? userId;
  const isHost = hostId === userId;

  function appendEvent(event: PartyEvent) {
    setEvents((prev) => {
      const next = [...prev, event];
      return next.slice(-200);
    });
  }

  function upsertParticipant(next: ParticipantState) {
    setParticipants((prev) => ({ ...prev, [next.userId]: next }));
  }

  function sendEvent(type: PartyEventType, payload: PartyEvent["payload"]) {
    const event: PartyEvent = {
      eventId: randomId("evt"),
      type,
      userId,
      timestamp: nowIso(),
      payload,
    };

    appendEvent(event);

    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ partyId, event }));
    }
  }

  function handleInboundMessage(raw: string) {
    try {
      const parsed = JSON.parse(raw) as { event?: PartyEvent; playback?: PlaybackState };
      if (parsed.event) {
        const event = parsed.event;
        appendEvent(event);

        if (event.type === "party_join") {
          upsertParticipant({
            userId: event.userId,
            isHost: event.userId === hostId,
            isOnline: true,
            joinedAt: event.timestamp,
            lastHeartbeatAt: event.timestamp,
          });
        }

        if (event.type === "party_leave") {
          setParticipants((prev) => {
            const existing = prev[event.userId];
            if (!existing) return prev;
            return {
              ...prev,
              [event.userId]: { ...existing, isOnline: false },
            };
          });
        }

        if (event.type === "heartbeat") {
          setParticipants((prev) => {
            const existing = prev[event.userId];
            if (!existing) return prev;
            return {
              ...prev,
              [event.userId]: {
                ...existing,
                isOnline: true,
                lastHeartbeatAt: event.timestamp,
              },
            };
          });
        }

        if (event.type === "play") {
          setPlayback((prev) => ({
            ...prev,
            isPlaying: true,
            currentTimeSeconds: safeNumber(event.payload.currentTimeSeconds, prev.currentTimeSeconds),
          }));
        }

        if (event.type === "pause") {
          setPlayback((prev) => ({
            ...prev,
            isPlaying: false,
            currentTimeSeconds: safeNumber(event.payload.currentTimeSeconds, prev.currentTimeSeconds),
          }));
        }

        if (event.type === "seek") {
          setPlayback((prev) => ({
            ...prev,
            currentTimeSeconds: safeNumber(event.payload.currentTimeSeconds, prev.currentTimeSeconds),
          }));
        }

        if (event.type === "sync_state") {
          setPlayback((prev) => ({
            ...prev,
            isPlaying:
              typeof event.payload.isPlaying === "boolean"
                ? (event.payload.isPlaying as boolean)
                : prev.isPlaying,
            currentTimeSeconds: safeNumber(event.payload.currentTimeSeconds, prev.currentTimeSeconds),
            mediaId:
              typeof event.payload.mediaId === "string"
                ? (event.payload.mediaId as string)
                : prev.mediaId,
          }));
        }
      }

      if (parsed.playback) {
        setPlayback(parsed.playback);
      }
    } catch {
      setError("Failed to parse watch party message");
    }
  }

  function stopHeartbeat() {
    if (heartbeatTimerRef.current !== null) {
      window.clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimerRef.current = window.setInterval(() => {
      sendEvent("heartbeat", { isOnline: true });
    }, HEARTBEAT_MS);
  }

  function connect() {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      return;
    }

    setStatus("connecting");
    setError(null);

    const socket = new WebSocket(`${wsUrl}?partyId=${encodeURIComponent(partyId)}&userId=${encodeURIComponent(userId)}`);
    socketRef.current = socket;

    socket.onopen = () => {
      setStatus("connected");
      upsertParticipant({
        userId,
        isHost,
        isOnline: true,
        joinedAt: nowIso(),
        lastHeartbeatAt: nowIso(),
      });
      sendEvent("party_join", { isHost });
      sendEvent("sync_state", {
        isPlaying: playback.isPlaying,
        currentTimeSeconds: playback.currentTimeSeconds,
        mediaId: playback.mediaId,
      });
      startHeartbeat();
    };

    socket.onmessage = (message) => {
      if (typeof message.data === "string") {
        handleInboundMessage(message.data);
      }
    };

    socket.onerror = () => {
      setStatus("error");
      setError("WebSocket connection failed");
    };

    socket.onclose = () => {
      stopHeartbeat();
      setStatus("idle");
      setParticipants((prev) => {
        const mine = prev[userId];
        if (!mine) return prev;
        return {
          ...prev,
          [userId]: {
            ...mine,
            isOnline: false,
          },
        };
      });
    };
  }

  function disconnect() {
    sendEvent("party_leave", {});
    stopHeartbeat();
    socketRef.current?.close();
    socketRef.current = null;
    setStatus("idle");
  }

  function sendChat() {
    const text = chatInput.trim();
    if (!text) return;
    sendEvent("chat", { message: text });
    setChatInput("");
  }

  function triggerPlay() {
    const nextTime = playback.currentTimeSeconds;
    setPlayback((prev) => ({ ...prev, isPlaying: true }));
    sendEvent("play", { currentTimeSeconds: nextTime });
  }

  function triggerPause() {
    const nextTime = playback.currentTimeSeconds;
    setPlayback((prev) => ({ ...prev, isPlaying: false }));
    sendEvent("pause", { currentTimeSeconds: nextTime });
  }

  function triggerSeek(delta: number) {
    setPlayback((prev) => {
      const next = Math.max(0, prev.currentTimeSeconds + delta);
      sendEvent("seek", { currentTimeSeconds: next });
      return { ...prev, currentTimeSeconds: next };
    });
  }

  const sortedParticipants = useMemo(
    () => Object.values(participants).sort((a, b) => a.userId.localeCompare(b.userId)),
    [participants]
  );

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">Social Watch Party</h3>
          <p className="text-xs text-white/50">Party: {partyId}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/50">Status: {status}</span>
          {status !== "connected" ? (
            <button
              onClick={connect}
              className="px-3 py-1 rounded-lg bg-cyan-600 text-white text-xs font-semibold hover:opacity-90 transition"
            >
              Connect
            </button>
          ) : (
            <button
              onClick={disconnect}
              className="px-3 py-1 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:opacity-90 transition"
            >
              Leave
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-xs text-rose-300">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2 rounded-xl border border-white/10 p-3 space-y-3">
          <p className="text-sm text-white/70">Shared Playback</p>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={triggerPlay} className="px-3 py-1 rounded bg-white/10 hover:bg-white/20 text-xs">
              Play
            </button>
            <button onClick={triggerPause} className="px-3 py-1 rounded bg-white/10 hover:bg-white/20 text-xs">
              Pause
            </button>
            <button onClick={() => triggerSeek(-10)} className="px-3 py-1 rounded bg-white/10 hover:bg-white/20 text-xs">
              -10s
            </button>
            <button onClick={() => triggerSeek(10)} className="px-3 py-1 rounded bg-white/10 hover:bg-white/20 text-xs">
              +10s
            </button>
            <span className="text-xs text-white/50">
              {playback.isPlaying ? "Playing" : "Paused"} · {playback.currentTimeSeconds.toFixed(1)}s
            </span>
          </div>

          <div className="rounded-lg border border-white/10 p-2 space-y-2 max-h-48 overflow-auto">
            {events.length === 0 ? (
              <p className="text-xs text-white/40">No events yet.</p>
            ) : (
              events.map((event) => (
                <div key={event.eventId} className="text-xs text-white/70 border-b border-white/5 pb-1">
                  <span className="font-semibold text-white/90">{event.type}</span>
                  <span className="text-white/40"> · {event.userId}</span>
                  {event.type === "chat" && typeof event.payload.message === "string" ? (
                    <p className="text-white/80">{event.payload.message}</p>
                  ) : null}
                </div>
              ))
            )}
          </div>

          <div className="flex items-center gap-2">
            <input
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="Send message to party"
              className="flex-1 rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white placeholder-white/30"
            />
            <button
              onClick={sendChat}
              className="px-3 py-2 rounded-lg bg-purple-600 text-white text-xs font-semibold hover:opacity-90 transition"
            >
              Send
            </button>
          </div>
        </div>

        <aside className="rounded-xl border border-white/10 p-3 space-y-2">
          <p className="text-sm text-white/70">Participants ({sortedParticipants.length})</p>
          <div className="space-y-2">
            {sortedParticipants.length === 0 ? (
              <p className="text-xs text-white/40">No participants yet.</p>
            ) : (
              sortedParticipants.map((participant) => (
                <div key={participant.userId} className="text-xs rounded-lg border border-white/10 p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-white/90">{participant.userId}</span>
                    <span className={participant.isOnline ? "text-emerald-300" : "text-white/40"}>
                      {participant.isOnline ? "online" : "offline"}
                    </span>
                  </div>
                  <p className="text-white/40">{participant.isHost ? "host" : "viewer"}</p>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
