/**
 * approval_bridge.mjs — DSH answerer that forwards approval requests to the
 * Telegram bot's local HTTP panel and waits for the user's decision.
 *
 * The bot mounts this file with a --patch overlay while the agent runs in a
 * mode that asks (workspace-write). The returned outcome is fed back into the
 * real approval seam, so an "allow" here is the grant the tool receives.
 */

import { randomUUID } from "node:crypto";

export const name = "telegram-approval-bridge";

export function apply(ctx, config) {
  const url = config?.url;
  if (!url) return;

  ctx.on("approval/request", async (request, next) => {
    const payload = {
      id: randomUUID(),
      tool: request.tool ?? "",
      reason: request.reason ?? "",
      displayReason: request.displayReason ?? "",
      callId: request.callId ?? "",
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-approval-token": config?.token ?? "",
        },
        body: JSON.stringify(payload),
        signal: request.signal,
      });
      if (!response.ok) return next();
      const data = await response.json();
      if (
        data?.outcome === "allowed-once" ||
        data?.outcome === "rejected" ||
        data?.outcome === "cancelled"
      ) {
        return data.outcome;
      }
      return next();
    } catch {
      // The turn was cancelled or the bot is unreachable: fail closed.
      return request.signal?.aborted ? "cancelled" : next();
    }
  });
}
