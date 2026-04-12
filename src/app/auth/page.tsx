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

const PERSONAS = [
  { emoji: "🟢", name: "肯定者", desc: "可能性を最大化する" },
  { emoji: "🔴", name: "批判者", desc: "甘い前提を暴く" },
  { emoji: "🔵", name: "俯瞰者", desc: "構造を整理する" },
  { emoji: "⚖️", name: "統合者", desc: "最適解を出す" },
];

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

  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [user, loading, router]);

  function handleTabChange(next: Tab) {
    setTab(next);
    setView("form");
    setError(null);
    setSuccessMsg(null);
  }

  function openResetView() {
    setResetEmail(email);
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

  const inputClass =
    "w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50 transition";

  return (
    <div
      className="min-h-screen flex flex-col lg:flex-row"
      style={{ background: "linear-gradient(135deg, #1E3A8A 0%, #0F172A 100%)" }}
    >
      {/* ── 左：ブランドエリア ── */}
      <div className="flex flex-col justify-center items-center lg:items-start px-8 py-10 lg:py-0 lg:px-20 lg:w-1/2">
        {/* ロゴ */}
        <h1 className="text-5xl lg:text-7xl font-black text-white tracking-tight leading-none">
          FRICTION
        </h1>

        {/* キャッチコピー */}
        <p className="mt-4 text-white/70 text-sm lg:text-base font-light leading-relaxed max-w-xs text-center lg:text-left">
          本当に強いアイデアは、<br className="hidden lg:block" />
          反論に耐えたものだけだ。
        </p>

        {/* 4人格 */}
        <div className="flex flex-wrap gap-2 mt-8 justify-center lg:justify-start">
          {PERSONAS.map((p) => (
            <div
              key={p.name}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/10 backdrop-blur-sm border border-white/10"
            >
              <span className="text-base leading-none">{p.emoji}</span>
              <div>
                <p className="text-white text-xs font-semibold leading-tight">{p.name}</p>
                <p className="text-white/50 text-[10px] leading-tight">{p.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 右：フォームカード ── */}
      <div className="flex items-center justify-center px-4 py-8 lg:py-0 lg:px-16 lg:w-1/2">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">

          {view === "reset" ? (
            /* パスワードリセットフォーム */
            <div className="px-7 py-8 space-y-5">
              <div>
                <p className="text-base font-bold text-gray-800">パスワードをリセット</p>
                <p className="text-xs text-gray-500 mt-1">登録済みのメールアドレスにリセット用リンクを送信します。</p>
              </div>

              <form onSubmit={handleResetPassword} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">
                    メールアドレス
                  </label>
                  <input
                    type="email"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder="you@example.com"
                    className={inputClass}
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
                  className="w-full text-white text-sm font-semibold py-2.5 rounded-xl transition disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg, #2563EB 0%, #1E3A8A 100%)" }}
                >
                  {isSubmitting ? "送信中..." : "リセットメールを送信"}
                </button>
              </form>

              <button
                type="button"
                onClick={closeResetView}
                className="w-full text-xs text-gray-400 hover:text-gray-600 transition py-1"
              >
                ← ログインに戻る
              </button>
            </div>

          ) : (
            /* ログイン／新規登録フォーム */
            <>
              {/* タブ */}
              <div className="flex border-b border-gray-100">
                <button
                  onClick={() => handleTabChange("login")}
                  className={`flex-1 py-4 text-sm font-semibold transition-colors ${
                    tab === "login"
                      ? "text-blue-800 border-b-2 border-blue-700"
                      : "text-gray-400 hover:text-gray-600"
                  }`}
                >
                  ログイン
                </button>
                <button
                  onClick={() => handleTabChange("signup")}
                  className={`flex-1 py-4 text-sm font-semibold transition-colors ${
                    tab === "signup"
                      ? "text-blue-800 border-b-2 border-blue-700"
                      : "text-gray-400 hover:text-gray-600"
                  }`}
                >
                  新規登録
                </button>
              </div>

              <form onSubmit={handleSubmit} className="px-7 py-7 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">
                    メールアドレス
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder="you@example.com"
                    className={inputClass}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-gray-600">
                      パスワード
                      {tab === "signup" && (
                        <span className="text-gray-400 font-normal ml-1">（6文字以上）</span>
                      )}
                    </label>
                    {tab === "login" && (
                      <button
                        type="button"
                        onClick={openResetView}
                        className="text-xs text-blue-600 hover:text-blue-800 transition"
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
                    className={inputClass}
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
                  className="w-full text-white text-sm font-semibold py-2.5 rounded-xl transition disabled:opacity-50 mt-1"
                  style={{ background: "linear-gradient(135deg, #2563EB 0%, #1E3A8A 100%)" }}
                >
                  {isSubmitting
                    ? "処理中..."
                    : tab === "login"
                      ? "ログイン"
                      : "アカウントを作成"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
