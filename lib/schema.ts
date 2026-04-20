import { z } from "zod";

/**
 * Structured output produced by Claude Code inside the sandbox.
 * This schema drives (a) the JSON schema passed to `claude --json-schema ...`,
 * (b) Zod validation of the parsed output in the workflow step,
 * (c) the shape consumed by every sink writer.
 *
 * See ARCHITECTURE.md § "Output schema" for the why behind each field.
 */

export const SourceEnum = z.enum([
  "calendar",
  "gmail",
  "slack",
  "notion",
  "github",
]);
export type Source = z.infer<typeof SourceEnum>;

export const TomorrowMeetingSchema = z.object({
  meeting: z.string().describe("Meeting title or calendar event name"),
  prep_note: z
    .string()
    .describe("One-line prep note: what to think about, who's attending, what to bring"),
});
export type TomorrowMeeting = z.infer<typeof TomorrowMeetingSchema>;

export const SectionsSchema = z.object({
  todays_wins: z
    .array(z.string())
    .describe("Things that actually moved today — decisions made, work shipped, meetings that unlocked something"),
  commitments_made: z
    .array(z.string())
    .describe("Explicit or implicit promises to others made today. 'I'll send that over Friday.' 'Let me look into X.'"),
  loose_ends: z
    .array(z.string())
    .describe("Unanswered DMs, unreplied emails, asks I've ignored. The guilt pile."),
  tomorrow_on_deck: z
    .array(TomorrowMeetingSchema)
    .describe("Tomorrow's meetings with one-line prep notes"),
  front_load_candidates: z
    .array(z.string())
    .describe("Admin/quick-wins to bang out first thing tomorrow AM so they don't eat the day"),
  watch_list: z
    .array(z.string())
    .describe("Signals brewing that don't need action today but worth monitoring (deal status, team dynamics, blocked projects)"),
  questions_surfaced: z
    .array(z.string())
    .describe("Things I hit today but didn't resolve — questions I want to return to"),
  daily_learning: z
    .string()
    .describe("One-liner takeaway from today. Compounds into a personal knowledge base over time."),
});
export type Sections = z.infer<typeof SectionsSchema>;

export const RecapSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("ISO date, e.g. '2026-04-20'"),
  day_of_week: z
    .string()
    .describe("Full day name, e.g. 'Monday'"),
  sources_available: z
    .array(SourceEnum)
    .describe("Which sources the agent successfully queried this run"),
  sources_degraded: z
    .array(z.string())
    .describe("Sources that failed and a one-line reason each. Empty array on a clean run."),
  sections: SectionsSchema,
  tldr_bullets: z
    .array(z.string())
    .min(3)
    .max(5)
    .describe("3-5 bullets for the Slack DM headline. Each under 90 chars. The most important things."),
});
export type Recap = z.infer<typeof RecapSchema>;

/**
 * JSON Schema representation for the `claude --json-schema` flag.
 * Converted from the Zod schema so the two stay in sync.
 *
 * If `claude --json-schema` doesn't exist in the current CLI (verify day 1),
 * we'll drop this and rely on prompt-embedded schema + Zod parsing instead.
 */
export const RECAP_JSON_SCHEMA = JSON.stringify(
  {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "DailyRecap",
    type: "object",
    required: [
      "date",
      "day_of_week",
      "sources_available",
      "sources_degraded",
      "sections",
      "tldr_bullets",
    ],
    properties: {
      date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      day_of_week: { type: "string" },
      sources_available: {
        type: "array",
        items: { enum: ["calendar", "gmail", "slack", "notion", "github"] },
      },
      sources_degraded: { type: "array", items: { type: "string" } },
      sections: {
        type: "object",
        required: [
          "todays_wins",
          "commitments_made",
          "loose_ends",
          "tomorrow_on_deck",
          "front_load_candidates",
          "watch_list",
          "questions_surfaced",
          "daily_learning",
        ],
        properties: {
          todays_wins: { type: "array", items: { type: "string" } },
          commitments_made: { type: "array", items: { type: "string" } },
          loose_ends: { type: "array", items: { type: "string" } },
          tomorrow_on_deck: {
            type: "array",
            items: {
              type: "object",
              required: ["meeting", "prep_note"],
              properties: {
                meeting: { type: "string" },
                prep_note: { type: "string" },
              },
            },
          },
          front_load_candidates: { type: "array", items: { type: "string" } },
          watch_list: { type: "array", items: { type: "string" } },
          questions_surfaced: { type: "array", items: { type: "string" } },
          daily_learning: { type: "string" },
        },
      },
      tldr_bullets: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 5,
      },
    },
  },
  null,
  2,
);
