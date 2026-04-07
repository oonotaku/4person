import { isDoneMessage } from "@/lib/utils/messageHandler";

describe("isDoneMessage", () => {
  // ─── 正常系: "done" と判定されるケース ────────────────────────────

  describe("正常系 - true を返す", () => {
    it('小文字 "done" → true', () => {
      expect(isDoneMessage("done")).toBe(true);
    });

    it('大文字 "DONE" → true (大文字小文字を区別しない)', () => {
      expect(isDoneMessage("DONE")).toBe(true);
    });

    it('先頭大文字 "Done" → true', () => {
      expect(isDoneMessage("Done")).toBe(true);
    });

    it('混在 "dOnE" → true', () => {
      expect(isDoneMessage("dOnE")).toBe(true);
    });

    it('前後スペース " done " → true (空白を無視)', () => {
      expect(isDoneMessage(" done ")).toBe(true);
    });

    it('前後タブ・改行 "\\tdone\\n" → true', () => {
      expect(isDoneMessage("\tdone\n")).toBe(true);
    });

    it('複合: スペース + 大文字 " DONE " → true', () => {
      expect(isDoneMessage(" DONE ")).toBe(true);
    });

    it('複合: タブ + 混在ケース "\\tDOne\\t" → true', () => {
      expect(isDoneMessage("\tDOne\t")).toBe(true);
    });
  });

  // ─── 異常系: "done" と判定されないケース ──────────────────────────

  describe("異常系 - false を返す", () => {
    it('空文字列 "" → false', () => {
      expect(isDoneMessage("")).toBe(false);
    });

    it('スペースのみ "   " → false', () => {
      expect(isDoneMessage("   ")).toBe(false);
    });

    it('"done!" → false (余分な文字)', () => {
      expect(isDoneMessage("done!")).toBe(false);
    });

    it('"donee" → false (余分な文字)', () => {
      expect(isDoneMessage("donee")).toBe(false);
    });

    it('"I\'m done" → false (文章の一部)', () => {
      expect(isDoneMessage("I'm done")).toBe(false);
    });

    it('"done." → false (句読点)', () => {
      expect(isDoneMessage("done.")).toBe(false);
    });

    it('"not done" → false', () => {
      expect(isDoneMessage("not done")).toBe(false);
    });

    it('"done done" → false (繰り返し)', () => {
      expect(isDoneMessage("done done")).toBe(false);
    });

    it('"完了" → false (日本語)', () => {
      expect(isDoneMessage("完了")).toBe(false);
    });

    it('"d o n e" → false (スペース混入)', () => {
      expect(isDoneMessage("d o n e")).toBe(false);
    });
  });
});
