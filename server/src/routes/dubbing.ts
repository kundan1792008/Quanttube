import { Router, Request, Response } from "express";
import { createDubbingJob, getDubbingJob, listDubbingJobs } from "../services";
import { CreateDubbingJobRequest, SUPPORTED_LANGUAGES } from "../types";

const router = Router();

/**
 * GET /api/dubbing/languages
 * List all 150 supported languages for Generative Deep-Dubbing.
 */
router.get("/languages", (_req: Request, res: Response) => {
  res.json({ count: SUPPORTED_LANGUAGES.length, languages: SUPPORTED_LANGUAGES });
});

/**
 * POST /api/dubbing/jobs
 * Enqueue a new deep-dubbing translation job.
 */
router.post("/jobs", (req: Request, res: Response) => {
  const { sessionId, targetLanguage } = req.body as CreateDubbingJobRequest;
  if (!sessionId || !targetLanguage) {
    res.status(400).json({ error: "sessionId and targetLanguage are required" });
    return;
  }
  const result = createDubbingJob(sessionId, targetLanguage);
  if ("error" in result) {
    res.status(400).json(result);
    return;
  }
  res.status(201).json(result);
});

/**
 * GET /api/dubbing/jobs/:id
 * Get the status of a dubbing job.
 */
router.get("/jobs/:id", (req: Request, res: Response) => {
  const job = getDubbingJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Dubbing job not found" });
    return;
  }
  res.json(job);
});

/**
 * GET /api/dubbing/jobs
 * List all dubbing jobs, optionally filtered by sessionId query param.
 */
router.get("/jobs", (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string | undefined;
  res.json(listDubbingJobs(sessionId));
});

export default router;
