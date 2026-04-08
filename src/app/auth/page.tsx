"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

type Tab = "login" | "signup";
type View = "form" | "reset";

const ERROR_MESSAGES: Record<string, string> = {
  "Invalid login credentials": "メールアドレスまたはパスワードが正しくありません",
  "Email not confirmed": "メールアドレスの確認が完了していません",
  "User already registered": "このメールアドレスはすでに登録されています",
  "Password should be at least 6 characters": "パスワードは6文字以上で入力してください",
};

function localizeError(message: string): string {
  for (const [key, value] of Object.entries(ERROR_MESSAGES)) {
    if (message.includes(key)) return value;
  }
  return message;
}

export default function AuthPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("login");
  const [view, setView] = useState<View>("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // ログイン済みならトップへ
  useEffect(() => {
    if (!loading && user) {
      router.replace("/");
    }
  }, [user, loading, router]);

  function handleTabChange(next: Tab) {
    setTab(next);
    setView("form");
    setError(null);
    setSuccessMsg(null);
  }

  function openResetView() {
    setResetEmail(email); // ログインフォームに入力済みのメアドを引き継ぐ
    setError(null);
    setSuccessMsg(null);
    setView("reset");
  }

  function closeResetView() {
    setError(null);
    setSuccessMsg(null);
    setView("form");
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setIsSubmitting(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      });
      if (error) throw error;
      setSuccessMsg("パスワードリセットのメールを送信しました。メールをご確認ください。");
      setResetEmail("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(localizeError(msg));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setIsSubmitting(true);

    try {
      if (tab === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/");
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setSuccessMsg("確認メールを送信しました。メールを確認してログインしてください。");
        setEmail("");
        setPassword("");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(localizeError(msg));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loading || user) return null;

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* タイトル */}
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">💬</div>
          <h1 className="text-xl font-bold text-gray-800">4人格 壁打ちAI</h1>
          <p className="text-sm text-gray-500 mt-1">肯定者・批判者・俯瞰者・統合者と議論する</p>
        </div>

        {/* カード */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          {/* タブ */}
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => handleTabChange("login")}
              className={`flex-1 py-3 text-sm font-semibold transition-colors ${
                tab === "login"
                  ? "text-indigo-600 border-b-2 border-indigo-600 bg-white"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              ログイン
            </button>
            <button
              onClick={() => handleTabChange("signup")}
              className={`flex-1 py-3 text-sm font-semibold transition-colors ${
                tab === "signup"
                  ? "text-indigo-600 border-b-2 border-indigo-600 bg-white"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              新規登録
            </button>
          </div>

          {view === "reset" ? (
            /* パスワードリセットフォーム */
            <form onSubmit={handleResetPassword} className="px-6 py-6 space-y-4">
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-1">パスワードをリセット</p>
                <p className="text-xs text-gray-500">登録済みのメールアドレスにリセット用リンクを送信します。</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  メールアドレス
                </label>
                <input
                  type="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
                />
              </div>

              {error && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                  {error}
                </p>
              )}
              {successMsg && (
                <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
                  {successMsg}
                </p>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors"
              >
                {isSubmitting ? "送信中..." : "リセットメールを送信"}
              </button>

              <button
                type="button"
                onClick={closeResetView}
                className="w-full text-xs text-gray-500 hover:text-gray-700 transition-colors py-1"
              >
                ← ログインに戻る
              </button>
            </form>
          ) : (
            /* ログイン／新規登録フォーム */
            <form onSubmit={handleSubmit} className="px-6 py-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  メールアドレス
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-600">
                    パスワード{tab === "signup" && <span className="text-gray-400 font-normal ml-1">（6文字以上）</span>}
                  </label>
                  {tab === "login" && (
                    <button
                      type="button"
                      onClick={openResetView}
                      className="text-xs text-indigo-500 hover:text-indigo-700 transition-colors"
                    >
                      パスワードを忘れた方はこちら
                    </button>
                  )}
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete={tab === "login" ? "current-password" : "new-password"}
                  placeholder="••••••••"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
                />
              </div>

              {error && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                  {error}
                </p>
              )}
              {successMsg && (
                <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
                  {successMsg}
                </p>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors"
              >
                {isSubmitting
                  ? "処理中..."
                  : tab === "login"
                    ? "ログイン"
                    : "アカウントを作成"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
