@AGENTS.md

# プロジェクト申し送り事項

## アプリ概要
4人格壁打ちAI（4person.vercel.app）
- 肯定者・批判者・俯瞰者・統合者の4人格がテーマについて議論するNext.jsアプリ
- Supabase（DB）+ Anthropic API + Vercel（ホスティング）

## 環境
- デスクトップPC: C:\Users\HP\4person
- ノートPC: C:\Users\taku_\Desktop\dev\4person
- GitHub: https://github.com/oonotaku/4person
- 本番URL: https://4person.vercel.app

## 技術スタック
- Next.js 16.2.2 (App Router, Turbopack)
- Tailwind CSS v4（postcss.config.jsで@tailwindcss/postcss使用）
- Supabase（sessions・messages・user_settingsテーブル）
- Anthropic API（claude-sonnet-4-20250514）

## Supabaseテーブル構成
sessions: id, user_id, theme, language, created_at, final_conclusion, is_completed(bool), summary(jsonb)
messages: id, session_id, speaker, content, target, created_at

## 実装済み機能
- 4人格による議論（全員・個別発言対応）
- doneコマンドで議論終了＋サマリー自動生成
- サマリーをSupabaseに保存・再表示
- セッション一覧で完了バッジ表示
- 一覧に戻るボタン

## ハーネス
- 場所: harness/フォルダ
- 使い方: harness/index.jsのtask変数を書き換えてnode index.jsを実行
- 構成: planner.js → generator.js → evaluator.js

## 次にやりたいこと
- 自動介入トリガー（内容ベース）の実装
- 議論の質向上

