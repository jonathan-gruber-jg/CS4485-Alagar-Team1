import { z } from "zod";
const envSchema = z.object({
    PORT: z.coerce.number().default(5001),
    CORS_ORIGIN: z.string().default("http://localhost:3000"),
    JWT_SECRET: z.string().min(10, "JWT_SECRET must be at least 10 characters").default("dev_secret_change_me"),
    JWT_EXPIRES_IN: z.string().default("7d"),
    // GROQ_API_KEY: Required for AI-powered budget recommendations feature.
    // If not provided, the AI insights endpoint will return a 503 (Unavailable) response.
    GROQ_API_KEY: z.string().optional(),
    // Primary and fallback model IDs for dashboard recommendations.
    GROQ_MODEL_PRIMARY: z.string().default("openai/gpt-oss-20b"),
    GROQ_MODEL_FALLBACK_1: z.string().default("openai/gpt-oss-120b"),
    GROQ_MODEL_FALLBACK_2: z.string().default("llama-3.3-70b-versatile"),
});
export const env = envSchema.parse(process.env);
