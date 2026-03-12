/**
 * Run real-time price monitor for Bitcoin up/down market (Kalshi + Polymarket).
 * Logs best ask for UP (YES) and DOWN (NO) tokens to console and to logs/monitor_{YYYY-MM-DD}_{HH}-{00|15|30|45}.log per market slot.
 * Only one monitor instance is allowed (single-instance lock) so the poll interval is respected.
 */
import {
  startDualPriceMonitor,
  formatDualPricesLine,
} from "./monitor";
import { checkArbAndPlaceOrders } from "./arb";
import { appendMonitorLog } from "./monitor-logger";
import { acquireMonitorLock, releaseMonitorLock } from "./monitor-lock";
import { config } from "./config";
import { validateRequiredEnvOrExit } from "./validate-env";
import { gracefulExit, logFriendlyError } from "./error-handler";

async function main(): Promise<void> {
  validateRequiredEnvOrExit();
  acquireMonitorLock();

  if (config.mockMode) {
    console.log("\n⚠️  Bot is running with MOCK DATA — simulated prices, no real API calls, no real orders.\n");
  }

  const intervalMs = parseInt(
    process.env.KALSHI_MONITOR_INTERVAL_MS ?? "200",
    10
  );
  const ticker = process.env.KALSHI_MONITOR_TICKER; // optional Kalshi ticker
  const restartOnQuarterHour =
    process.env.KALSHI_MONITOR_NO_RESTART !== "true" && process.env.KALSHI_MONITOR_NO_RESTART !== "1";

  console.log(
    `Starting dual price monitor (Kalshi + Polymarket, poll every ${intervalMs}ms${ticker ? ` ticker=${ticker}` : ", first open BTC up/down market"}${restartOnQuarterHour && !ticker ? ", restart process at :00/:15/:30/:45" : ""})...`
  );

  const stop = await startDualPriceMonitor({
    kalshiTicker: ticker || undefined,
    intervalMs,
    restartProcessOnQuarterHour: restartOnQuarterHour,
    onPrices: (p) => {
      const line = formatDualPricesLine(p);
      console.log(line);
      appendMonitorLog(line, p.fetchedAt);
      checkArbAndPlaceOrders(p).catch((err: unknown) => {
        logFriendlyError(err, "Arb");
      });
    },
    onError: (err) => {
      logFriendlyError(err, "Monitor");
    },
  });

  process.on("SIGINT", () => {
    console.log("\nStopping monitor...");
    stop();
    releaseMonitorLock();
    process.exit(0);
  });
}

main().catch((err) => {
  gracefulExit(err, releaseMonitorLock, "Monitor");
});
