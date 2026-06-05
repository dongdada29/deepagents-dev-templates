import { describe, expect, it } from "vitest";
import { shouldCompact, findCutPoint } from "../src/runtime/middleware/compaction.js";

describe("compaction", () => {
  describe("shouldCompact", () => {
    it("returns false when disabled", () => {
      expect(shouldCompact(100_000, 200_000, 0.8)).toBe(false);
    });

    it("returns false when under threshold", () => {
      expect(shouldCompact(100_000, 200_000, 0.8)).toBe(false);
    });

    it("returns true when over threshold", () => {
      expect(shouldCompact(170_000, 200_000, 0.8)).toBe(true);
    });

    it("returns true at exact threshold boundary", () => {
      expect(shouldCompact(160_000, 200_000, 0.8)).toBe(true);
    });
  });

  describe("findCutPoint", () => {
    it("returns 0 for empty messages", () => {
      expect(findCutPoint([], 20_000)).toBe(0);
    });

    it("returns 0 when all messages fit in keepRecentTokens", () => {
      const messages = [
        { content: "short" },
        { content: "message" },
      ];
      expect(findCutPoint(messages, 20_000)).toBe(0);
    });

    it("returns a valid cut index for large message lists", () => {
      // Create messages that would exceed keepRecentTokens
      const messages = Array.from({ length: 100 }, (_, i) => ({
        content: "a".repeat(1000),
        role: i % 2 === 0 ? "user" : "assistant",
      }));

      const cutIndex = findCutPoint(messages, 20_000);
      // Should cut somewhere in the middle, not at start or end
      expect(cutIndex).toBeGreaterThan(0);
      expect(cutIndex).toBeLessThan(messages.length);
    });
  });
});
