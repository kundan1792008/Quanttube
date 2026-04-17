/**
 * Lightweight cache service for Quanttube.
 *
 * Uses Redis (via ioredis) when `REDIS_URL` is configured; otherwise falls
 * back to a simple in-process TTL map so the server starts cleanly without
 * an external Redis instance (useful for local dev and tests).
 *
 * Usage:
 *   await cache.set("stream:movie-001", JSON.stringify(data), ttlSeconds);
 *   const raw = await cache.get("stream:movie-001");
 */

import Redis from "ioredis";
import logger from "../logger";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

interface CacheBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  quit(): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory fallback (no external dependency)
// ---------------------------------------------------------------------------

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

class MemoryCache implements CacheBackend {
  private readonly store = new Map<string, MemoryEntry>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async quit(): Promise<void> {
    this.store.clear();
  }
}

// ---------------------------------------------------------------------------
// Redis backend (ioredis) – only loaded when REDIS_URL is set
// ---------------------------------------------------------------------------

async function buildRedisBackend(redisUrl: string): Promise<CacheBackend | null> {
  try {
    const client = new Redis(redisUrl);

    // Surface connection errors without crashing the server.
    client.on("error", (err: unknown) => {
      logger.warn({ err }, "Redis connection error – cache degraded to in-memory");
    });

    const backend: CacheBackend = {
      async get(key) {
        return client.get(key);
      },
      async set(key, value, ttlSeconds) {
        await client.set(key, value, "EX", ttlSeconds);
      },
      async del(key) {
        await client.del(key);
      },
      async quit() {
        await client.quit();
      },
    };

    logger.info({ redisUrl: redisUrl.replace(/:[^@]+@/, ":***@") }, "Redis cache connected");
    return backend;
  } catch (err) {
    logger.warn({ err }, "Failed to connect to Redis during initialisation – falling back to in-memory cache");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cache factory – singleton
// ---------------------------------------------------------------------------

let _backend: CacheBackend | null = null;

async function getBackend(): Promise<CacheBackend> {
  if (_backend) return _backend;
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    const redis = await buildRedisBackend(redisUrl);
    _backend = redis ?? new MemoryCache();
  } else {
    _backend = new MemoryCache();
  }
  return _backend;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const cache = {
  async get(key: string): Promise<string | null> {
    const backend = await getBackend();
    return backend.get(key);
  },

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    const backend = await getBackend();
    return backend.set(key, value, ttlSeconds);
  },

  async del(key: string): Promise<void> {
    const backend = await getBackend();
    return backend.del(key);
  },
};

/** Reset the backend – used in tests to clear state between runs. */
export async function _resetCache(): Promise<void> {
  if (_backend) {
    await _backend.quit();
    _backend = null;
  }
}
