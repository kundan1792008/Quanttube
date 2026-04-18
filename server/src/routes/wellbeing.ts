import { Router, Request, Response } from "express";
import { z } from "zod";
import {
  getPreferences,
  updatePreferences,
  recordWatchSession,
  getStatus,
  getInsights,
  getWatchSessions,
} from "../services/wellbeing";

const router = Router();

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const UserIdParamSchema = z.object({
  userId: z.string().min(1, "userId is required"),
});

const QuietHoursSchema = z
  .object({
    enabled: z.boolean().optional(),
    startHour: z.number().int().min(0).max(23).optional(),
    endHour: z.number().int().min(0).max(23).optional(),
  })
  .optional();

const UpdatePreferencesSchema = z
  .object({
    dailyLimitMinutes: z.number().min(0).max(24 * 60).optional(),
    quietHours: QuietHoursSchema,
    autoplayEnabled: z.boolean().optional(),
    autoplayCountdownSeconds: z.number().min(0).max(60).optional(),
    stillWatchingIntervalMinutes: z.number().min(0).max(8 * 60).optional(),
  })
  .strict();

const RecordSessionSchema = z.object({
  mediaId: z.string().min(1, "mediaId is required"),
  durationSeconds: z.number().min(0).max(12 * 60 * 60),
  startedAt: z.string().datetime().optional(),
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** GET /api/v1/wellbeing/:userId/preferences – read user preferences. */
router.get("/:userId/preferences", (req: Request, res: Response) => {
  const params = UserIdParamSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.issues[0]?.message });
    return;
  }
  res.json(getPreferences(params.data.userId));
});

/** PATCH /api/v1/wellbeing/:userId/preferences – partial update. */
router.patch("/:userId/preferences", (req: Request, res: Response) => {
  const params = UserIdParamSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.issues[0]?.message });
    return;
  }
  const body = UpdatePreferencesSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message });
    return;
  }
  const result = updatePreferences(params.data.userId, body.data);
  if ("error" in result) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json(result);
});

/** POST /api/v1/wellbeing/:userId/sessions – log a completed watch session. */
router.post("/:userId/sessions", (req: Request, res: Response) => {
  const params = UserIdParamSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.issues[0]?.message });
    return;
  }
  const body = RecordSessionSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message });
    return;
  }
  const result = recordWatchSession({
    userId: params.data.userId,
    ...body.data,
  });
  if ("error" in result) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.status(201).json(result);
});

/** GET /api/v1/wellbeing/:userId/sessions – list raw watch sessions (transparency). */
router.get("/:userId/sessions", (req: Request, res: Response) => {
  const params = UserIdParamSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.issues[0]?.message });
    return;
  }
  const sessions = getWatchSessions(params.data.userId);
  res.json({ userId: params.data.userId, count: sessions.length, sessions });
});

/** GET /api/v1/wellbeing/:userId/status – real-time autoplay/limit status. */
router.get("/:userId/status", (req: Request, res: Response) => {
  const params = UserIdParamSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.issues[0]?.message });
    return;
  }
  res.json(getStatus(params.data.userId));
});

/** GET /api/v1/wellbeing/:userId/insights – 7-day usage breakdown. */
router.get("/:userId/insights", (req: Request, res: Response) => {
  const params = UserIdParamSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.issues[0]?.message });
    return;
  }
  res.json(getInsights(params.data.userId));
});

export default router;
