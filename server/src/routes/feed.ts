import { Router, Request, Response } from "express";
import { z } from "zod";
import {
  ingestSignal,
  getRecommendation,
  getSignalsForUser,
  CrossAppSignalType,
} from "../services/telepathic-feed";

const router = Router();

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const SIGNAL_TYPES: [CrossAppSignalType, ...CrossAppSignalType[]] = [
  "QUANTMAIL_FLIGHT_TICKET",
  "QUANTMAIL_EVENT_INVITE",
  "QUANTMAIL_SHOPPING_RECEIPT",
  "QUANTSINK_PROFILE_VIEW",
  "QUANTSINK_POST_REACTION",
  "QUANTADS_PRODUCT_CLICK",
  "QUANTCHAT_KEYWORD",
  "QUANTEDITS_TEMPLATE_USED",
];

const IngestSignalSchema = z.object({
  userId: z.string().min(1, "userId is required"),
  signalType: z.enum(SIGNAL_TYPES, {
    error: () => ({ message: `signalType must be one of: ${SIGNAL_TYPES.join(", ")}` }),
  }),
  payload: z.record(z.string(), z.unknown()).default({}),
  occurredAt: z.string().datetime().optional(),
});

const UserIdParamSchema = z.object({
  userId: z.string().min(1, "userId is required"),
});

// ---------------------------------------------------------------------------
// POST /api/v1/feed/signals
// Ingest a cross-app signal (called by other Quant services via webhook)
// ---------------------------------------------------------------------------

router.post("/signals", (req: Request, res: Response) => {
  const parse = IngestSignalSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }

  const { userId, signalType, payload, occurredAt } = parse.data;

  ingestSignal({
    userId,
    signalType,
    payload: payload as Record<string, unknown>,
    occurredAt: occurredAt ?? new Date().toISOString(),
  });

  res.status(202).json({ accepted: true, userId, signalType });
});

// ---------------------------------------------------------------------------
// GET /api/v1/feed/:userId/recommendation
// Get the current personalised media recommendation for a user
// ---------------------------------------------------------------------------

router.get("/:userId/recommendation", (req: Request, res: Response) => {
  const parse = UserIdParamSchema.safeParse(req.params);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }

  const recommendation = getRecommendation(parse.data.userId);
  res.json(recommendation);
});

// ---------------------------------------------------------------------------
// GET /api/v1/feed/:userId/signals
// Get all raw cross-app signals for a user (debug / transparency endpoint)
// ---------------------------------------------------------------------------

router.get("/:userId/signals", (req: Request, res: Response) => {
  const parse = UserIdParamSchema.safeParse(req.params);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }

  const signals = getSignalsForUser(parse.data.userId);
  res.json({ userId: parse.data.userId, count: signals.length, signals });
});

export default router;
