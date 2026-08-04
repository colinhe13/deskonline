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
  aiAccounts: process.env.AI_ACCOUNTS || "AI_XiaoZhi,AI_LaoWang,AI_MeiLing",
  aiProfileMinHands: parseInt(process.env.AI_PROFILE_MIN_HANDS || "5", 10),
  aiProfileSummaryEvery: parseInt(
    process.env.AI_PROFILE_SUMMARY_EVERY || "5",
    10,
  ),
};
