import { Router, Request, Response } from "express";
import { z } from "zod";
import {
  createReelShare,
  getReelShare,
  listReelShares,
  registerReelShareClick,
  getAvatarDashboardStates,
} from "../services";
import { DeepLinkPlatform } from "../types";

const router = Router();

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const CreateReelShareSchema = z.object({
  reelId: z.string().min(1, "reelId is required"),
  groupId: z.string().min(1, "groupId is required"),
  sharedBy: z.string().min(1, "sharedBy is required"),
  memberIds: z.array(z.string()).min(1, "memberIds must contain at least one member"),
  pressureWindowSeconds: z.number().positive().optional(),
});

const RegisterClickSchema = z.object({
  memberId: z.string().min(1, "memberId is required"),
  platform: z.enum(Object.values(DeepLinkPlatform) as [DeepLinkPlatform, ...DeepLinkPlatform[]], {
    error: () => ({
      message: `platform must be one of: ${Object.values(DeepLinkPlatform).join(", ")}`,
    }),
  }),
});

const ListSharesQuerySchema = z.object({
  groupId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * POST /api/reels/share
 * Share a Quanttube reel into a Quantchat group with a FOMO payload.
 */
router.post("/share", (req: Request, res: Response) => {
  const parse = CreateReelShareSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }
  const result = createReelShare(parse.data);
  if ("error" in result) {
    res.status(400).json(result);
    return;
  }
  res.status(201).json(result);
});

/**
 * GET /api/reels/share
 * List reel shares, optionally filtered by groupId.
 */
router.get("/share", (req: Request, res: Response) => {
  const parse = ListSharesQuerySchema.safeParse(req.query);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }
  res.json(listReelShares(parse.data.groupId));
});

/**
 * GET /api/reels/share/:shareId
 * Fetch a specific reel share and its deep-link metadata.
 */
router.get("/share/:shareId", (req: Request, res: Response) => {
  const share = getReelShare(req.params.shareId);
  if (!share) {
    res.status(404).json({ error: "Reel share not found" });
    return;
  }
  res.json(share);
});

/**
 * GET /api/reels/share/:shareId/deep-link/:platform
 * Resolve a deep-link target for ios/android/web.
 */
router.get("/share/:shareId/deep-link/:platform", (req: Request, res: Response) => {
  const share = getReelShare(req.params.shareId);
  if (!share) {
    res.status(404).json({ error: "Reel share not found" });
    return;
  }
  const platform = req.params.platform as DeepLinkPlatform;
  if (!Object.values(DeepLinkPlatform).includes(platform)) {
    res.status(400).json({ error: `platform must be one of: ${Object.values(DeepLinkPlatform).join(", ")}` });
    return;
  }
  res.json({ shareId: share.shareId, platform, deepLink: share.deepLinks[platform] });
});

/**
 * POST /api/reels/share/:shareId/click
 * Register that a member clicked the native deep-link.
 */
router.post("/share/:shareId/click", (req: Request, res: Response) => {
  const parse = RegisterClickSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }
  const result = registerReelShareClick(req.params.shareId, parse.data);
  if ("error" in result) {
    if (result.error === "Reel share not found") {
      res.status(404).json(result);
      return;
    }
    res.status(400).json(result);
    return;
  }
  res.json(result);
});

/**
 * GET /api/reels/quantsink/:groupId/avatars
 * Get temporary avatar pressure states for the Quantsink dashboard.
 */
router.get("/quantsink/:groupId/avatars", (req: Request, res: Response) => {
  res.json(getAvatarDashboardStates(req.params.groupId));
});

export default router;
