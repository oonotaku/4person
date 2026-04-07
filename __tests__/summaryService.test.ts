/**
 * summaryService と POST /api/summary のユニットテスト
 *
 * モック対象:
 *  - @anthropic-ai/sdk   : Anthropic クライアント (messages.create)
 *  - @/lib/db            : getSession / getMessages
 *  - @/lib/supabase      : supabase.from().upsert()
 */

import type { Summary } from "@/types/discussion";

// ─── モック定義 (jest.mock は巻き上げられるため先に宣言) ──────────────

const mockCreate = jest.fn();

jest.mock("@anthropic-ai/sdk", () => ({
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

const mockGetSession = jest.fn();
const mockGetMessages = jest.fn();

jest.mock("@/lib/db", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  getMessages: (...args: unknown[]) => mockGetMessages(...args),
}));

const mockUpsert = jest.fn();

jest.mock("@/lib/supabase", () => ({
  supabase: {
    from: jest.fn().mockReturnValue({
      upsert: (...args: unknown[]) => mockUpsert(...args),
    }),
  },
}));

// ─── テスト用フィクスチャ ─────────────────────────────────────────

const SESSION_ID = "test-session-id";

const mockSession = {
  id: SESSION_ID,
  theme: "AIと仕事の未来",
  language: "ja" as const,
  created_at: "2026-01-01T00:00:00Z",
};

const mockMessages = [
  { speaker: "taku",     content: "AIは仕事を奪うと思う" },
  { speaker: "affirmer", content: "新しい機会が生まれる" },
  { speaker: "critic",   content: "リスクもある" },
];

const mockSummary: Summary = {
  conclusion: "AIは仕事を変えるが、人間との協働が鍵となる",
  main_points: ["新しい雇用機会が生まれる", "スキルの再教育が必要", "倫理的な規制が重要"],
  next_actions: ["スキルアップ計画を立てる", "AI活用の実験を始める"],
};

/**
 * 4人格の視点 + 統合サマリーの計5回分の Claude レスポンスをセット
 */
function setupSuccessfulClaudeMocks(summary = mockSummary) {
  mockCreate
    .mockResolvedValueOnce({ content: [{ type: "text", text: "肯定者の視点テキスト" }] })
    .mockResolvedValueOnce({ content: [{ type: "text", text: "批判者の視点テキスト" }] })
    .mockResolvedValueOnce({ content: [{ type: "text", text: "俯瞰者の視点テキスト" }] })
    .mockResolvedValueOnce({ content: [{ type: "text", text: "統合者の視点テキスト" }] })
    .mockResolvedValueOnce({ content: [{ type: "text", text: JSON.stringify(summary) }] });
}

// ─── テスト本体 ───────────────────────────────────────────────────

describe("generateDiscussionSummary", () => {
  let generateDiscussionSummary: (sessionId: string) => Promise<Summary>;

  beforeAll(async () => {
    ({ generateDiscussionSummary } = await import("@/lib/services/summaryService"));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockUpsert.mockResolvedValue({ error: null });
  });

  // ─── 正常系 ─────────────────────────────────────────────────────

  describe("正常系", () => {
    it("セッションとメッセージを取得し、Summary を返す", async () => {
      mockGetSession.mockResolvedValue(mockSession);
      mockGetMessages.mockResolvedValue(mockMessages);
      setupSuccessfulClaudeMocks();

      const result = await generateDiscussionSummary(SESSION_ID);

      expect(result).toEqual(mockSummary);
    });

    it("Summary が正しい構造 (conclusion / main_points / next_actions) を持つ", async () => {
      mockGetSession.mockResolvedValue(mockSession);
      mockGetMessages.mockResolvedValue(mockMessages);
      setupSuccessfulClaudeMocks();

      const result = await generateDiscussionSummary(SESSION_ID);

      expect(typeof result.conclusion).toBe("string");
      expect(Array.isArray(result.main_points)).toBe(true);
      expect(Array.isArray(result.next_actions)).toBe(true);
    });

    it("language が 'en' のセッションでも正常に処理できる", async () => {
      mockGetSession.mockResolvedValue({ ...mockSession, language: "en" });
      mockGetMessages.mockResolvedValue(mockMessages);
      setupSuccessfulClaudeMocks();

      const result = await generateDiscussionSummary(SESSION_ID);

      expect(result).toEqual(mockSummary);
    });

    it("session.language が undefined のとき 'ja' にフォールバックする", async () => {
      mockGetSession.mockResolvedValue({ ...mockSession, language: undefined });
      mockGetMessages.mockResolvedValue(mockMessages);
      setupSuccessfulCloudeMocksWithCheck("ja");

      await generateDiscussionSummary(SESSION_ID);

      // 1回目の Claude 呼び出しのシステムプロンプトが日本語であることを確認
      expect(mockCreate).toHaveBeenCalledTimes(5);
      const firstCallArgs = mockCreate.mock.calls[0][0] as { system?: string };
      expect(firstCallArgs.system).toMatch(/日本語/);
    });

    it("正常終了後に discussions テーブルへ upsert が呼ばれる", async () => {
      mockGetSession.mockResolvedValue(mockSession);
      mockGetMessages.mockResolvedValue(mockMessages);
      setupSuccessfulClaudeMocks();

      await generateDiscussionSummary(SESSION_ID);

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          id: SESSION_ID,
          status: "completed",
          summary: mockSummary,
        })
      );
    });

    it("Claude が Markdown コードブロック包みの JSON を返しても正しく解析できる", async () => {
      mockGetSession.mockResolvedValue(mockSession);
      mockGetMessages.mockResolvedValue(mockMessages);

      const jsonInMarkdown = `\`\`\`json\n${JSON.stringify(mockSummary)}\n\`\`\``;

      mockCreate
        .mockResolvedValueOnce({ content: [{ type: "text", text: "肯定者" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: "批判者" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: "俯瞰者" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: "統合者" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: jsonInMarkdown }] });

      const result = await generateDiscussionSummary(SESSION_ID);

      expect(result).toEqual(mockSummary);
    });

    it("Claude がコードブロックラベルなし ``` で包んだ JSON も正しく解析できる", async () => {
      mockGetSession.mockResolvedValue(mockSession);
      mockGetMessages.mockResolvedValue(mockMessages);

      const jsonInMarkdown = `\`\`\`\n${JSON.stringify(mockSummary)}\n\`\`\``;

      mockCreate
        .mockResolvedValueOnce({ content: [{ type: "text", text: "肯定者" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: "批判者" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: "俯瞰者" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: "統合者" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: jsonInMarkdown }] });

      const result = await generateDiscussionSummary(SESSION_ID);

      expect(result).toEqual(mockSummary);
    });

    it("Claude を4人格 + 統合の計5回呼び出す", async () => {
      mockGetSession.mockResolvedValue(mockSession);
      mockGetMessages.mockResolvedValue(mockMessages);
      setupSuccessfulClaudeMocks();

      await generateDiscussionSummary(SESSION_ID);

      expect(mockCreate).toHaveBeenCalledTimes(5);
    });
  });

  // ─── 異常系 ─────────────────────────────────────────────────────

  describe("異常系", () => {
    it("メッセージが空配列 → エラーをスロー", async () => {
      mockGetSession.mockResolvedValue(mockSession);
      mockGetMessages.mockResolvedValue([]);

      await expect(generateDiscussionSummary(SESSION_ID)).rejects.toThrow(
        `No messages found for session: ${SESSION_ID}`
      );
    });

    it("メッセージが null → エラーをスロー", async () => {
      mockGetSession.mockResolvedValue(mockSession);
      mockGetMessages.mockResolvedValue(null);

      await expect(generateDiscussionSummary(SESSION_ID)).rejects.toThrow(
        `No messages found for session: ${SESSION_ID}`
      );
    });

    it("getSession が失敗 → エラーが伝播する", async () => {
      const dbError = new Error("Supabase: session not found");
      mockGetSession.mockRejectedValue(dbError);
      mockGetMessages.mockResolvedValue(mockMessages);

      await expect(generateDiscussionSummary(SESSION_ID)).rejects.toThrow(
        "Supabase: session not found"
      );
    });

    it("getMessages が失敗 → エラーが伝播する", async () => {
      mockGetSession.mockResolvedValue(mockSession);
      mockGetMessages.mockRejectedValue(new Error("Supabase: messages query failed"));

      await expect(generateDiscussionSummary(SESSION_ID)).rejects.toThrow(
        "Supabase: messages query failed"
      );
    });

    it("人格サマリー呼び出しで Claude が text 以外のブロックを返す → エラーをスロー", async () => {
      mockGetSession.mockResolvedValue(mockSession);
      mockGetMessages.mockResolvedValue(mockMessages);

      // affirmer の呼び出しで不正なブロック型を返す
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "x", name: "y", input: {} }],
      });

      await expect(generateDiscussionSummary(SESSION_ID)).rejects.toThrow(
        "Unexpected response type from affirmer"
      );
    });

    it("統合サマリー呼び出しで Claude が text 以外のブロックを返す → エラーをスロー", async () => {
      mockGetSession.mockResolvedValue(mockSession);
      mockGetMessages.mockResolvedValue(mockMessages);

      mockCreate
        .mockResolvedValueOnce({ content: [{ type: "text", text: "肯定者" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: "批判者" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: "俯瞰者" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: "統合者" }] })
        .mockResolvedValueOnce({
          content: [{ type: "tool_use", id: "x", name: "y", input: {} }],
        });

      await expect(generateDiscussionSummary(SESSION_ID)).rejects.toThrow(
        "Unexpected response type from synthesizer"
      );
    });

    it("統合サマリーで Claude が不正な JSON を返す → JSON.parse エラーをスロー", async () => {
      mockGetSession.mockResolvedValue(mockSession);
      mockGetMessages.mockResolvedValue(mockMessages);

      mockCreate
        .mockResolvedValueOnce({ content: [{ type: "text", text: "肯定者" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: "批判者" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: "俯瞰者" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: "統合者" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: "これはJSONではありません" }] });

      await expect(generateDiscussionSummary(SESSION_ID)).rejects.toThrow();
    });

    it("Claude が conclusion のない JSON を返す → 構造バリデーションエラー", async () => {
      mockGetSession.mockResolvedValue(mockSession);
      mockGetMessages.mockResolvedValue(mockMessages);

      const invalidSummary = { main_points: ["a"], next_actions: ["b"] }; // conclusion なし

      mockCreate
        .mockResolvedValueOnce({ content: [{ type: "text", text: "肯定者" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: "批判者" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: "俯瞰者" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: "統合者" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: JSON.stringify(invalidSummary) }] });

      await expect(generateDiscussionSummary(SESSION_ID)).rejects.toThrow(
        "Invalid summary structure returned by Claude"
      );
    });

    it("Claude が main_points を配列以外で返す → 構造バリデーションエラー", async () => {
      mockGetSession.mockResolvedValue(mockSession);
      mockGetMessages.mockResolvedValue(mockMessages);

      const invalidSummary = {
        conclusion: "結論",
        main_points: "配列ではなく文字列",
        next_actions: ["アクション"],
      };

      mockCreate
        .mockResolvedValueOnce({ content: [{ type: "text", text: "肯定者" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: "批判者" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: "俯瞰者" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: "統合者" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: JSON.stringify(invalidSummary) }] });

      await expect(generateDiscussionSummary(SESSION_ID)).rejects.toThrow(
        "Invalid summary structure returned by Claude"
      );
    });

    it("Claude が next_actions を配列以外で返す → 構造バリデーションエラー", async () => {
      mockGetSession.mockResolvedValue(mockSession);
      mockGetMessages.mockResolvedValue(mockMessages);

      const invalidSummary = {
        conclusion: "結論",
        main_points: ["ポイント"],
        next_actions: null,
      };

      mockCreate
        .mockResolvedValueOnce({ content: [{ type: "text", text: "肯定者" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: "批判者" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: "俯瞰者" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: "統合者" }] })
        .mockResolvedValueOnce({ content: [{ type: "text", text: JSON.stringify(invalidSummary) }] });

      await expect(generateDiscussionSummary(SESSION_ID)).rejects.toThrow(
        "Invalid summary structure returned by Claude"
      );
    });

    it("DB upsert がエラーを返す → エラーをスロー", async () => {
      mockGetSession.mockResolvedValue(mockSession);
      mockGetMessages.mockResolvedValue(mockMessages);
      setupSuccessfulClaudeMocks();
      mockUpsert.mockResolvedValue({ error: { message: "DB upsert failed", code: "42P01" } });

      await expect(generateDiscussionSummary(SESSION_ID)).rejects.toMatchObject({
        message: "DB upsert failed",
      });
    });

    it("Claude API 呼び出しが失敗 → エラーが伝播する", async () => {
      mockGetSession.mockResolvedValue(mockSession);
      mockGetMessages.mockResolvedValue(mockMessages);
      mockCreate.mockRejectedValue(new Error("Anthropic API rate limit exceeded"));

      await expect(generateDiscussionSummary(SESSION_ID)).rejects.toThrow(
        "Anthropic API rate limit exceeded"
      );
    });
  });
});

// ─── API ルート: POST /api/summary ───────────────────────────────

describe("POST /api/summary", () => {
  // summaryService をルート専用にモックして分離テスト
  jest.mock("@/lib/services/summaryService", () => ({
    generateDiscussionSummary: jest.fn(),
  }));

  let POST: (req: Request) => Promise<Response>;
  let mockGenerateDiscussionSummary: jest.MockedFunction<(id: string) => Promise<Summary>>;

  beforeAll(async () => {
    const route = await import("@/app/api/summary/route");
    POST = route.POST;
    const service = await import("@/lib/services/summaryService");
    mockGenerateDiscussionSummary = service.generateDiscussionSummary as jest.MockedFunction<
      (id: string) => Promise<Summary>
    >;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── 正常系 ────────────────────────────────────────────────────

  describe("正常系", () => {
    it("有効な sessionId → 200 と summary を返す", async () => {
      mockGenerateDiscussionSummary.mockResolvedValue(mockSummary);

      const request = new Request("http://localhost/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: SESSION_ID }),
      });

      const response = await POST(request);
      const body = await response.json() as { summary: Summary };

      expect(response.status).toBe(200);
      expect(body.summary).toEqual(mockSummary);
    });

    it("generateDiscussionSummary に sessionId が渡される", async () => {
      mockGenerateDiscussionSummary.mockResolvedValue(mockSummary);

      const request = new Request("http://localhost/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: SESSION_ID }),
      });

      await POST(request);

      expect(mockGenerateDiscussionSummary).toHaveBeenCalledWith(SESSION_ID);
    });
  });

  // ─── 異常系 ────────────────────────────────────────────────────

  describe("異常系", () => {
    it("sessionId が欠落 → 400 エラー", async () => {
      const request = new Request("http://localhost/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const response = await POST(request);
      const body = await response.json() as { error: string };

      expect(response.status).toBe(400);
      expect(body.error).toBe("sessionId is required");
    });

    it("sessionId が null → 400 エラー", async () => {
      const request = new Request("http://localhost/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: null }),
      });

      const response = await POST(request);
      const body = await response.json() as { error: string };

      expect(response.status).toBe(400);
      expect(body.error).toBe("sessionId is required");
    });

    it("sessionId が空文字列 → 400 エラー", async () => {
      const request = new Request("http://localhost/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "" }),
      });

      const response = await POST(request);
      const body = await response.json() as { error: string };

      expect(response.status).toBe(400);
      expect(body.error).toBe("sessionId is required");
    });

    it("generateDiscussionSummary が Error をスロー → 500 とエラーメッセージ", async () => {
      mockGenerateDiscussionSummary.mockRejectedValue(
        new Error("No messages found for session: test-session-id")
      );

      const request = new Request("http://localhost/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: SESSION_ID }),
      });

      const response = await POST(request);
      const body = await response.json() as { error: string };

      expect(response.status).toBe(500);
      expect(body.error).toBe("No messages found for session: test-session-id");
    });

    it("generateDiscussionSummary が非 Error をスロー → 500 と文字列化されたエラー", async () => {
      mockGenerateDiscussionSummary.mockRejectedValue("unexpected string error");

      const request = new Request("http://localhost/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: SESSION_ID }),
      });

      const response = await POST(request);
      const body = await response.json() as { error: string };

      expect(response.status).toBe(500);
      expect(body.error).toBe("unexpected string error");
    });

    it("generateDiscussionSummary が DB エラーをスロー → 500", async () => {
      mockGenerateDiscussionSummary.mockRejectedValue(new Error("DB upsert failed"));

      const request = new Request("http://localhost/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: SESSION_ID }),
      });

      const response = await POST(request);
      const body = await response.json() as { error: string };

      expect(response.status).toBe(500);
      expect(body.error).toBe("DB upsert failed");
    });
  });
});

// ─── ヘルパー: language チェック付きモックセット ────────────────────

function setupSuccessfulCloudeMocksWithCheck(expectedLanguage: "ja" | "en") {
  void expectedLanguage; // 呼び出し元で mockCreate.mock.calls を使って検証する
  mockCreate
    .mockResolvedValueOnce({ content: [{ type: "text", text: "肯定者の視点テキスト" }] })
    .mockResolvedValueOnce({ content: [{ type: "text", text: "批判者の視点テキスト" }] })
    .mockResolvedValueOnce({ content: [{ type: "text", text: "俯瞰者の視点テキスト" }] })
    .mockResolvedValueOnce({ content: [{ type: "text", text: "統合者の視点テキスト" }] })
    .mockResolvedValueOnce({ content: [{ type: "text", text: JSON.stringify(mockSummary) }] });
}
