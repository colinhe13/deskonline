import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || "3001", 10),
  databaseUrl: process.env.DATABASE_URL || "",
  jwtSecret: process.env.JWT_SECRET || "",
  registerCode: process.env.REGISTER_CODE || "214",
  livekitUrl: process.env.LIVEKIT_URL || "",
  livekitPublicUrl:
    process.env.LIVEKIT_PUBLIC_URL || process.env.LIVEKIT_URL || "",
  livekitApiKey: process.env.LIVEKIT_API_KEY || "",
  livekitApiSecret: process.env.LIVEKIT_API_SECRET || "",
  aiBaseUrl: process.env.AI_BASE_URL || "https://api.deepseek.com",
  aiModel: process.env.AI_MODEL || "deepseek-v4-flash",
  aiApiKey: process.env.AI_API_KEY || "",
  aiTimeoutMs: parseInt(process.env.AI_TIMEOUT_MS || "10000", 10),
  aiSummaryTimeoutMs: parseInt(process.env.AI_SUMMARY_TIMEOUT_MS || "4000", 10),
  aiAccounts:
    process.env.AI_ACCOUNTS || "AI_XiaoZhi,AI_LaoWang,AI_XiaoMei,AI_AQiang",
  aiProfileMinHands: parseInt(process.env.AI_PROFILE_MIN_HANDS || "5", 10),
  aiProfileSummaryWindow: parseInt(
    process.env.AI_PROFILE_SUMMARY_WINDOW || "10",
    10,
  ),
  aiProfileSummaryEvery: parseInt(
    process.env.AI_PROFILE_SUMMARY_EVERY || "10",
    10,
  ),
  aiRecentHandsWindow: parseInt(process.env.AI_RECENT_HANDS_WINDOW || "8", 10),
  aiRecentHandsInContext: parseInt(
    process.env.AI_RECENT_HANDS_IN_CONTEXT || "3",
    10,
  ),
  aiSelfStatsWindow: parseInt(process.env.AI_SELF_STATS_WINDOW || "20", 10),
  aiEvolveEveryHands: parseInt(process.env.AI_EVOLVE_EVERY_HANDS || "20", 10),
  // Global reflection cycle: one LLM call over all personas every N settled
  // hands server-wide. The enabled switch stops both new reflections AND
  // lesson injection (full return to the pre-lesson status quo).
  aiReflectionEnabled:
    (process.env.AI_REFLECTION_ENABLED ?? "true") !== "false",
  aiReflectEveryHands: parseInt(
    process.env.AI_REFLECT_EVERY_HANDS || "100",
    10,
  ),
};
