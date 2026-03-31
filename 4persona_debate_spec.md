# 4人格 壁打ちAI — MVP仕様書

作成日：2026-03-27  
作成者：Taku Ono  
ステータス：設計完了・実装待ち

---

## プロダクト概要

プロダクト設計の壁打ちを目的とした、4つのAI人格が連鎖議論するWebアプリ。ユーザー（Taku）も会話に参加でき、特定の人格に宛てて発言できる。将来的に商用化を想定。

---

## 確定仕様

### UI

| 項目 | 内容 |
|---|---|
| 形式 | チャット型（吹き出し形式） |
| デバイス | PC・スマホ両対応（レスポンシブ） |
| 言語切り替え | 日本語・英語（UI内でトグル切り替え） |
| 発言先指定 | 入力欄の上部でターゲット人格を選択（複数可・未選択で全員） |
| 議論の開始 | テーマ（自由記述）を入力して送信 |

### 4人格の定義

#### 🟢 肯定者
- 役割：アイデア・議論の可能性を最大化する
- 口癖：「実はここに大きなチャンスがある」「具体的な事例で言うと〜」
- 締め方：可能性を数字で示す（例：「〜なら○○%の市場が取れる」）
- NG：感情的な励まし、根拠のない楽観

#### 🔴 批判者
- 役割：リスク・矛盾・穴を具体的に指摘する
- 口癖：「一点だけ確認したい」「その前提は本当に正しいか」
- 締め方：必ず問いで終わる（例：「〜という点はどう説明するのか」）
- NG：人格攻撃、ただの否定

#### 🔵 俯瞰者
- 役割：第三者として構造的・客観的に議論を整理する
- 口癖：「構造的に見ると」「論点を整理すると3つある」
- 締め方：「つまり本質的な問いは〜だ」
- NG：どちらかに肩入れ、感情的な発言

#### ⚖️ 統合者
- 役割：3人の議論を受けて現時点の最適解を出す
- 口癖：「3人の議論を踏まえると」「現時点での最善手は」
- 締め方：必ず「次のアクション：〜」で終わる
- NG：曖昧な結論、アクションなしの締め

### 議論フロー

```
1. Takuがテーマを入力
2. 肯定者が最初に発言
3. 批判者が肯定者の発言を受けて反論（連鎖）
4. 俯瞰者が両者を踏まえて構造的に整理（連鎖）
5. 統合者が現時点の最適解と次のアクションを出す（連鎖）
6. Takuが発言先を指定して割り込む（任意）
7. 指定された人格が返答 → 残り3人格も一言ずつ反応
8. 6〜7を繰り返す
```

### Takuの参加ルール

- 発言先を1人格に指定 → その人格がメインで返答、他3人格がサブで一言反応
- 発言先を複数指定 → 指定された人格が順番に返答
- 発言先を未指定（全員）→ 4人格が順番に反応

### 自動介入トリガー

| トリガー | 条件 | 介入する人格 |
|---|---|---|
| 連続指定 | 同じ人格に2回連続で話しかけた場合 | 他の人格が3回目で割り込む |
| 発言比率 | 特定人格への言及が全体の50%以上 | 少ない側の人格が介入 |
| 感情的な議論 | 議論が感情的・主観的になった場合 | 俯瞰者が介入 |
| 論点のずれ | 本題から離れた場合 | 俯瞰者が介入 |

### ユーザーカスタマイズ（設定画面）

```
介入トリガー設定
├ 連続指定の上限：[ 2 ] 回　（変更可）
├ 発言比率の閾値：[ 50 ] %　（変更可）
└ 介入の強さ：[ソフト / 標準 / アグレッシブ]　（変更可）
```

---

## 記憶・データ設計

### A：セッション内記憶（MVP必須）

- 会話中のTakuの発言を全てmessages配列に蓄積
- 各人格はその会話内のTakuの発言傾向・矛盾を参照できる
- ブラウザを閉じるとリセット

### B：DB保存（MVP必須）

- 使用DB：Supabase
- 保存内容：会話履歴・テーマ・統合者の最終結論・タイムスタンプ
- 次回ログイン時に過去の壁打ち一覧を表示
- 「前回の続き」として会話を再開できる

### C：ユーザープロファイル（商用化フェーズ）

- SNS投稿履歴・過去の意思決定メモ等をインプット
- Claudeがプロファイルを生成・保存
- 4人格がプロファイルを参照して発言（傾向・クセへの言及）

---

## 技術スタック

| 項目 | 技術 |
|---|---|
| フロントエンド | Next.js（レスポンシブ） |
| バックエンド | Next.js API Routes |
| AI | Anthropic API（claude-sonnet-4-20250514） |
| DB | Supabase |
| デプロイ | Vercel |
| バージョン管理 | GitHub |

---

## APIの呼び出し設計

### 連鎖の仕組み

```javascript
// 各人格への呼び出しは順番に実行（並列ではない）
// 前の人格の発言をmessagesに追加してから次を呼ぶ

const messages = [
  { role: "user", content: `テーマ：${theme}` }
];

// 1. 肯定者
const affirmerResponse = await callClaude(AFFIRMER_PROMPT, messages);
messages.push({ role: "assistant", content: `[肯定者] ${affirmerResponse}` });
messages.push({ role: "user", content: "批判者として、上記を踏まえて発言せよ" });

// 2. 批判者
const criticResponse = await callClaude(CRITIC_PROMPT, messages);
messages.push({ role: "assistant", content: `[批判者] ${criticResponse}` });
messages.push({ role: "user", content: "俯瞰者として、上記を踏まえて発言せよ" });

// 3. 俯瞰者
const observerResponse = await callClaude(OBSERVER_PROMPT, messages);
messages.push({ role: "assistant", content: `[俯瞰者] ${observerResponse}` });
messages.push({ role: "user", content: "統合者として、3人の議論を踏まえて最適解と次のアクションを出せ" });

// 4. 統合者
const synthesizerResponse = await callClaude(SYNTHESIZER_PROMPT, messages);
```

### 各人格のシステムプロンプト構造

```
あなたは「{人格名}」です。

## 役割
{役割の説明}

## 発言ルール
- {口癖・スタイル}
- {締め方}
- {NGパターン}
- 発言は3〜4文以内に収める

## 介入ルール（批判者・俯瞰者のみ）
以下の条件に該当する場合、通常の順番を無視して割り込む：
- {介入トリガーの条件}

## Takuの文脈参照
会話履歴のTakuの発言から以下を把握して発言に反映する：
- 発言傾向（楽観的か悲観的か）
- 過去の主張との矛盾
- よく使う前提・価値観

## 言語
{{language}}（日本語 または English）
```

---

## Supabaseスキーマ（概要）

```sql
-- セッション（壁打きのテーマ単位）
sessions (
  id uuid primary key,
  user_id uuid,
  theme text,
  language text,
  created_at timestamp,
  final_conclusion text  -- 統合者の最終発言
)

-- メッセージ（発言履歴）
messages (
  id uuid primary key,
  session_id uuid references sessions(id),
  speaker text,  -- 'taku' | 'affirmer' | 'critic' | 'observer' | 'synthesizer'
  content text,
  target text,   -- Takuの発言先（nullなら全員）
  created_at timestamp
)

-- ユーザー設定
user_settings (
  user_id uuid primary key,
  consecutive_limit int default 2,
  bias_threshold int default 50,
  intervention_strength text default 'standard'
)
```

---

## Claude Codeへの実装指示

このファイルをプロジェクトに置いた上で、以下の順番で実装を依頼する：

```
Step 1: プロジェクトのセットアップ
「Next.js + Supabase + Anthropic APIのプロジェクトをセットアップして。
この仕様書に従って実装する。まずディレクトリ構造と必要なパッケージを準備して」

Step 2: UI実装
「チャット画面を実装して。仕様書のUI仕様に従うこと。
レスポンシブ・発言先指定・言語切り替えを含める」

Step 3: API実装
「4人格の連鎖議論APIを実装して。仕様書のAPIの呼び出し設計に従うこと」

Step 4: DB連携
「Supabaseとの連携を実装して。仕様書のスキーマに従うこと」

Step 5: 介入トリガー実装
「自動介入トリガーを実装して。連続指定2回・比率50%がデフォルト値」

Step 6: 動作確認 → GitHub push → Vercelデプロイ
```

---

## 商用化フェーズで追加する機能

- ユーザー認証（Supabase Auth）
- SNS履歴インプットによるプロファイル生成（C）
- 人格の名前・キャラクターカスタマイズ
- 壁打き結果のエクスポート（PDF・Markdown）
- チーム機能（複数人で同じ壁打きに参加）
