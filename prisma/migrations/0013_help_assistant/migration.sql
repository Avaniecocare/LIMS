-- The help site's assistant: anonymous question log (for unanswered questions, cost and abuse) and page feedback.
CREATE TYPE "HelpOutcome" AS ENUM ('ANSWERED', 'CACHED', 'NOT_FOUND', 'OFF_TOPIC', 'BLOCKED', 'RATE_LIMITED', 'CAPTCHA_FAILED', 'BUDGET_REACHED', 'ERROR');

CREATE TABLE "HelpQuestion" (
    "id" TEXT NOT NULL,
    "question" TEXT,
    "outcome" "HelpOutcome" NOT NULL,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "model" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicros" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "signedIn" BOOLEAN NOT NULL DEFAULT false,
    "helpful" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HelpQuestion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HelpQuestion_createdAt_idx" ON "HelpQuestion"("createdAt");
CREATE INDEX "HelpQuestion_outcome_createdAt_idx" ON "HelpQuestion"("outcome", "createdAt");

CREATE TABLE "HelpPageFeedback" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "helpful" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HelpPageFeedback_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HelpPageFeedback_path_createdAt_idx" ON "HelpPageFeedback"("path", "createdAt");
