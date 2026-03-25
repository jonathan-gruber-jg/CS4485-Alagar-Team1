import Groq from "groq-sdk";
import { z } from "zod";
import { env } from "../config/env.js";

/**
 * ===== Schema Definitions =====
 * These Zod schemas define the exact structure of AI insights we expect.
 * We use strict validation to ensure AI output always matches our frontend expectations.
 */

/**
 * Input schema: Describes a user's spending and budget by category.
 * Used to build the prompt for Groq.
 */
export const categorySpendSummarySchema = z.object({
  category: z.string().describe("The spending category (e.g., 'Food & Dining')"),
  spent: z.number().nonnegative().describe("Amount spent in this category (dollars)"),
  allocated: z.number().nonnegative().describe("Budget allocated for this category (dollars)"),
});

export type CategorySpendSummary = z.infer<typeof categorySpendSummarySchema>;

/**
 * Output schema: A single recommendation from Groq.
 * We request EXACTLY 3 recommendations: one for each type.
 */
export const recommendationSchema = z.object({
  type: z
    .enum(["reduce", "keepDoing", "spendMore"])
    .describe("Whether the user should reduce, keep, or increase spending in this category"),
  category: z.string().describe("The spending category this recommendation applies to"),
  title: z.string().describe("A short title summarizing the recommendation"),
  message: z.string().describe("A detailed message explaining why and how to follow this recommendation"),
});

export type Recommendation = z.infer<typeof recommendationSchema>;

/**
 * Full response schema: exactly 3 recommendations + metadata.
 * This contract is critical for the frontend which expects exactly 3 cards.
 */
export const dashboardAiResponseSchema = z.object({
  recommendations: z.array(recommendationSchema).length(3).describe("Exactly 3 recommendations: reduce, keepDoing, spendMore"),
  generatedAt: z.string().datetime().describe("ISO 8601 timestamp when recommendations were generated"),
});

export type DashboardAiResponse = z.infer<typeof dashboardAiResponseSchema>;

type OutputMode = "strict-json-schema" | "best-effort-json-schema" | "json-object";

const STRICT_JSON_SCHEMA_MODELS = new Set(["openai/gpt-oss-20b", "openai/gpt-oss-120b"]);

/**
 * Detects provider errors that indicate a model is unavailable for this key/tier/region.
 * These are retryable using the fallback model list.
 */
function isModelAvailabilityError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    (normalized.includes("model") &&
      (normalized.includes("not found") ||
        normalized.includes("not supported") ||
        normalized.includes("unavailable") ||
        normalized.includes("deprecated"))) ||
    normalized.includes("404") ||
    normalized.includes("permission denied") ||
    normalized.includes("does not have access") ||
    normalized.includes("not allowed") ||
    normalized.includes("rate limit") ||
    normalized.includes("too many requests") ||
    normalized.includes("429") ||
    normalized.includes("capacity")
  );
}

/**
 * Detects unsupported structured output request formatting for a given model.
 */
function isStructuredOutputCompatibilityError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("response_format") ||
    normalized.includes("json_schema") ||
    normalized.includes("structured output") ||
    normalized.includes("strict")
  );
}

function parseMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object" && "text" in part && typeof (part as { text?: unknown }).text === "string") {
          return (part as { text: string }).text;
        }
        return "";
      })
      .join("");
  }

  return "";
}

function buildResponseFormat(mode: OutputMode): Record<string, unknown> {
  if (mode === "json-object") {
    return { type: "json_object" };
  }

  return {
    type: "json_schema",
    json_schema: {
      name: "dashboard_ai_response",
      strict: mode === "strict-json-schema",
      schema: {
        type: "object",
        properties: {
          recommendations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["reduce", "keepDoing", "spendMore"] },
                category: { type: "string" },
                title: { type: "string" },
                message: { type: "string" },
              },
              required: ["type", "category", "title", "message"],
              additionalProperties: false,
            },
            minItems: 3,
            maxItems: 3,
          },
          generatedAt: { type: "string" },
        },
        required: ["recommendations", "generatedAt"],
        additionalProperties: false,
      },
    },
  };
}

/**
 * ===== Groq Integration =====
 * Calls Groq's Chat Completions API to generate AI-powered budget recommendations.
 */
export async function generateDashboardInsights(
  spendingData: CategorySpendSummary[],
  month: number,
  year: number
): Promise<DashboardAiResponse> {
  if (!env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY not configured");
  }

  const client = new Groq({ apiKey: env.GROQ_API_KEY });

  const modelCandidates = [env.GROQ_MODEL_PRIMARY, env.GROQ_MODEL_FALLBACK_1, env.GROQ_MODEL_FALLBACK_2];
  const uniqueModelCandidates = Array.from(new Set(modelCandidates));

  const categoryBreakdown = spendingData
    .map(
      (item) =>
        `- ${item.category}: $${item.spent.toFixed(2)} spent of $${item.allocated.toFixed(2)} allocated (${item.allocated > 0 ? ((item.spent / item.allocated) * 100).toFixed(1) : "N/A"}% of budget)`
    )
    .join("\n");

  const monthLabel = new Date(year, month - 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const messages = [
    {
      role: "system",
      content:
        "You are a personal finance advisor for a college student. Return only JSON output using the required structure and no extra prose.",
    },
    {
      role: "user",
      content: `Analyze this spending data for ${monthLabel} and provide exactly 3 recommendations.\n\nSpending Summary:\n${categoryBreakdown}\n\nReturn exactly 3 recommendations with one of each type:\n1) reduce\n2) keepDoing\n3) spendMore\n\nEach recommendation must include:\n- type: one of reduce, keepDoing, spendMore\n- category\n- title: short actionable title (max 50 chars)\n- message: 1-2 sentences with specific advice\n\nReturn JSON only with shape:\n{\n  "recommendations": [\n    { "type": "...", "category": "...", "title": "...", "message": "..." },\n    { "type": "...", "category": "...", "title": "...", "message": "..." },\n    { "type": "...", "category": "...", "title": "...", "message": "..." }\n  ],\n  "generatedAt": "ISO 8601 timestamp"\n}`,
    },
  ] as const;

  let sawAvailabilityFailure = false;

  for (const modelName of uniqueModelCandidates) {
    const candidateModes: OutputMode[] = STRICT_JSON_SCHEMA_MODELS.has(modelName)
      ? ["strict-json-schema", "json-object"]
      : ["best-effort-json-schema", "json-object"];

    for (const outputMode of candidateModes) {
      try {
        console.log(`[AI] Trying Groq model: ${modelName} with mode: ${outputMode}`);

        const completion = await client.chat.completions.create({
          model: modelName,
          messages: messages as any,
          response_format: buildResponseFormat(outputMode) as any,
          temperature: 0.2,
        });

        const responseText = parseMessageContent(completion.choices[0]?.message?.content).trim();
        console.log("[AI] Raw Groq response:", responseText);

        let jsonText = responseText;
        const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          jsonText = jsonMatch[1].trim();
        }

        const parsed = JSON.parse(jsonText);
        const validated = dashboardAiResponseSchema.parse({
          ...parsed,
          generatedAt: parsed.generatedAt || new Date().toISOString(),
        });

        console.log(`[AI] Successfully generated recommendations with model: ${modelName} (${outputMode})`);
        return validated;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (isModelAvailabilityError(message)) {
          sawAvailabilityFailure = true;
          console.warn(`[AI] Groq model unavailable: ${modelName}. Error: ${message}`);
          break;
        }

        if (isStructuredOutputCompatibilityError(message) && outputMode !== "json-object") {
          console.warn(`[AI] Structured output mode unsupported for ${modelName} (${outputMode}). Falling back to json-object.`);
          continue;
        }

        if (error instanceof SyntaxError) {
          throw new Error(`Groq returned invalid JSON: ${error.message}`);
        }

        if (error instanceof z.ZodError) {
          const validationErrors = error.errors
            .map((e) => `${e.path.join(".")}: ${e.message} (code: ${e.code})`)
            .join("; ");
          throw new Error(`Groq response failed validation: ${validationErrors}`);
        }

        throw error;
      }
    }
  }

  if (sawAvailabilityFailure) {
    throw new Error(
      "No supported Groq model is available for chat completions. Configure GROQ_MODEL_PRIMARY / GROQ_MODEL_FALLBACK_* to valid model IDs."
    );
  }

  throw new Error("Groq request failed before any model could return a response.");
}

/**
 * Legacy schema kept for compatibility (can be removed if not used elsewhere).
 * This was the original schema design but we're now using the simpler 3-item approach above.
 */
export const dashboardAiResponseSchema_Legacy = z.object({
  cards: z.array(
    z.object({
      type: z.enum(["alert", "onTrack", "tip", "reallocation"]),
      title: z.string(),
      message: z.string(),
      savingsCents: z.number().int().nonnegative().optional(),
      category: z.string().optional(),
    })
  ),
  comparison: z.object({
    items: z.array(
      z.object({
        category: z.string(),
        currentSpendCents: z.number().int().nonnegative(),
        recommendedSpendCents: z.number().int().nonnegative(),
      })
    ),
  }),
  recommendedActions: z.array(
    z.object({
      severity: z.enum(["info", "warning", "critical"]),
      text: z.string(),
    })
  ),
  generatedAt: z.string(),
});
