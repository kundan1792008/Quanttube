import { Router, Request, Response } from "express";
import { z } from "zod";
import logger from "../logger";

const router = Router();

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const MediaIdParamSchema = z.object({
  mediaId: z.string().min(1, "mediaId is required"),
});

const ChoicesBodySchema = z.object({
  userId: z.string().optional(),
  /** Current story progress (0-1). Determines which choices are available. */
  progressFraction: z.number().min(0).max(1).default(0.5),
  /** Tags from the user's Telepathic Feed to personalise the choices. */
  userTags: z.array(z.string()).max(20).default([]),
  /** How many choices to return. */
  count: z.number().int().min(1).max(6).default(3),
});

// ---------------------------------------------------------------------------
// Stub story choices database
// ---------------------------------------------------------------------------

const STORY_CHOICES_POOL = [
  {
    id: "choice-follow-hero",
    label: "Follow the hero into the unknown",
    genre: "adventure",
    emotionTag: "curiosity",
    nextEpisodeHint: "The hero discovers an ancient artefact.",
  },
  {
    id: "choice-stay-behind",
    label: "Stay behind and protect the village",
    genre: "drama",
    emotionTag: "loyalty",
    nextEpisodeHint: "The village faces an unexpected threat.",
  },
  {
    id: "choice-seek-alliance",
    label: "Seek alliance with the rival faction",
    genre: "thriller",
    emotionTag: "strategy",
    nextEpisodeHint: "A fragile truce leads to surprising revelations.",
  },
  {
    id: "choice-reveal-secret",
    label: "Reveal the hidden secret",
    genre: "mystery",
    emotionTag: "tension",
    nextEpisodeHint: "The secret reshapes everyone's understanding.",
  },
  {
    id: "choice-time-skip",
    label: "Jump forward 5 years",
    genre: "sci-fi",
    emotionTag: "wonder",
    nextEpisodeHint: "The world has changed beyond recognition.",
  },
  {
    id: "choice-reconcile",
    label: "Attempt to reconcile with the antagonist",
    genre: "drama",
    emotionTag: "empathy",
    nextEpisodeHint: "Forgiveness unlocks an unexpected path.",
  },
];

/**
 * Score a story choice against the user's current context.
 * In production this would call an LLM / recommendation model.
 */
function scoreChoice(
  choice: (typeof STORY_CHOICES_POOL)[number],
  userTags: string[],
  progressFraction: number
): number {
  let score = Math.random() * 0.3; // base random noise
  // Boost choices that match user's interest tags
  for (const tag of userTags) {
    if (
      choice.genre.includes(tag) ||
      choice.emotionTag.includes(tag) ||
      choice.label.toLowerCase().includes(tag)
    ) {
      score += 0.3;
    }
  }
  // Late-story choices are weighted toward high-tension options
  if (progressFraction > 0.8 && ["tension", "strategy"].includes(choice.emotionTag)) {
    score += 0.2;
  }
  return Math.min(1, score);
}

// ---------------------------------------------------------------------------
// POST /api/v1/cinema/:mediaId/choices
// ---------------------------------------------------------------------------

/**
 * Interactive Cinema – AI "Next Story Choices" endpoint.
 *
 * Given the current `mediaId` and user context, returns an ordered list
 * of AI-suggested story branch choices for interactive cinema content.
 *
 * The response is fully personalised via the Telepathic Feed user tags.
 */
router.post("/:mediaId/choices", (req: Request, res: Response) => {
  const paramParse = MediaIdParamSchema.safeParse(req.params);
  if (!paramParse.success) {
    res.status(400).json({ error: paramParse.error.issues[0]?.message });
    return;
  }

  const bodyParse = ChoicesBodySchema.safeParse(req.body);
  if (!bodyParse.success) {
    res.status(400).json({ error: bodyParse.error.issues[0]?.message });
    return;
  }

  const { mediaId } = paramParse.data;
  const { userId, progressFraction, userTags, count } = bodyParse.data;

  const scored = STORY_CHOICES_POOL.map((choice) => ({
    ...choice,
    aiScore: scoreChoice(choice, userTags, progressFraction),
  }))
    .sort((a, b) => b.aiScore - a.aiScore)
    .slice(0, count);

  logger.info(
    { mediaId, userId, progressFraction, count },
    "Interactive Cinema: AI choices generated"
  );

  res.json({
    mediaId,
    userId: userId ?? null,
    progressFraction,
    choices: scored,
    generatedAt: new Date().toISOString(),
    note: "AI story choices stub – production would use an LLM inference endpoint",
  });
});

export default router;
