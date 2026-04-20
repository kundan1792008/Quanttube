import { Router, Request, Response } from "express";
import { z } from "zod";
import {
  NARRATIVE_PREFERENCES,
  generateNarrativeSegment,
  enqueueDeepDubbingSimulation,
  getDeepDubbingSimulationJob,
} from "../services/NarrativeGenerator";
import {
  LIGHTING_PRESETS,
  enqueueAvatarSynthJob,
  getAvatarSynthJob,
} from "../services/AvatarSynth";

const router = Router();

const NarrativePreferenceSchema = z.enum(NARRATIVE_PREFERENCES);
const LightingPresetSchema = z.enum(LIGHTING_PRESETS);

const NextSegmentBodySchema = z.object({
  userId: z.string().min(1, "userId is required"),
  preferences: z.array(NarrativePreferenceSchema).min(1).max(4),
  continuityToken: z.string().min(1).optional(),
  selectedChoiceId: z.string().min(1).optional(),
});

const DubbingSimulationSchema = z.object({
  audioBlockBase64: z
    .string()
    .min(8, "audioBlockBase64 is required")
    .max(2_000_000, "audioBlockBase64 too large")
    .regex(/^[A-Za-z0-9+/=]+$/, "audioBlockBase64 must be valid base64"),
  targetLanguage: z.string().min(2, "targetLanguage is required").max(8),
  sceneId: z.string().min(1).optional(),
});

const AvatarSynthSchema = z.object({
  avatarId: z.string().min(1, "avatarId is required"),
  sceneId: z.string().min(1, "sceneId is required"),
  frameIds: z.array(z.string().min(1)).min(1).max(120),
  lightingPreset: LightingPresetSchema.default("neutral"),
});

router.post("/next", (req: Request, res: Response) => {
  const parse = NextSegmentBodySchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }
  const segment = generateNarrativeSegment(parse.data);
  res.json(segment);
});

router.post("/deep-dubbing-simulation", (req: Request, res: Response) => {
  const parse = DubbingSimulationSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }
  const job = enqueueDeepDubbingSimulation(parse.data);
  res.status(202).json(job);
});

router.get("/deep-dubbing-simulation/:jobId", (req: Request, res: Response) => {
  const job = getDeepDubbingSimulationJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Simulation job not found" });
    return;
  }
  res.json(job);
});

router.post("/avatar-synth/jobs", (req: Request, res: Response) => {
  const parse = AvatarSynthSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues[0]?.message });
    return;
  }
  const dedupedFrameIds = Array.from(new Set(parse.data.frameIds));
  const job = enqueueAvatarSynthJob({
    ...parse.data,
    frameIds: dedupedFrameIds,
  });
  res.status(201).json(job);
});

router.get("/avatar-synth/jobs/:jobId", (req: Request, res: Response) => {
  const job = getAvatarSynthJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Avatar synth job not found" });
    return;
  }
  res.json(job);
});

export default router;
