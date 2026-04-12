# FRICTION — 仕様書

アプリ名：FRICTION  
キャッチコピー：「本当に強いアイデアは、反論に耐えたものだけだ。」  
作成日：2026-03-27 / 最終更新：2026-04-12  
作成者：Taku Ono  
本番URL：https://4person.vercel.app  
GitHub：https://github.com/oonotaku/4person

---

## プロダクト概要

ビジネスアイデアの壁打ちを目的とした、6つのAI人格がフェーズ制で連鎖議論するWebアプリ。ユーザーも会話に参加でき、特定の人格に宛てて発言できる。将来的に商用化を想定。

---

## 実装済み機能

- 6人格による議論（全員・個別発言対応）
- doneコマンドで議論終了＋サマリー自動生成（実行判断/条件/最初の一手）
- サマリーをSupabaseに保存・再表示
- セッション一覧で完了バッジ表示
- 一覧に戻るボタン
- Supabase Auth（メール/パスワード認証）
- プロアクティブ介入システム（俯瞰者が4トリガーで単独介入）
- Phase 1 発案者・調査者の対話ループ
  - 発案者：通常時は2〜3案提示、ブラッシュアップ依頼時は1案のみ深掘り
  - 調査者：Web検索で競合・市場・法規制をレポート
  - 調査者の3段階判定：「勝てる余地あり」「勝てる余地は限定的」「参入障壁が高く厳しい」
  - ①②③ 選択ボタンUI（needs_choice フラグで制御）
    - ① この案をブラッシュアップする → 発案者に送信
    - ② 全く新しい案を出してもらう → 発案者に送信
    - ③ この案で次のフェーズに進む → タイトル入力モーダルを表示
  - 調査者の吹き出し内の選択肢テキスト（「この結果を踏まえて…」）は非表示
- ③ボタン押下時にタイトル入力モーダルを表示し、decided_idea_title をSupabaseに保存
- フェーズステッパー直下にお題（theme）を常時表示
- Phase 2以降で「📋 Phase1サマリーを見る」ボタンを表示
  - Phase 1 サマリーポップアップ：決定案タイトル＋調査者の最終判定を表示
- フェーズ名：発案（Phase 1）・検証（Phase 2）・統合（Phase 3）

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
| フェーズ表示 | 上部にフェーズステッパー（発案→検証→統合） |
| フェーズ遷移 | 「次のフェーズへ」ボタンをユーザーが押す |

### 6人格の定義

#### 💡 発案者（新規）
- 役割：ビジネスアイデアを複数案生成し、可能性を広げる
- スタイル：具体的な案を2〜3個提示する。根拠のない楽観はNG
- 特記：調査者から「競合あり・障壁あり」の問い返しを受けた場合、差別化案を提示する
- フェーズ：Phase 1【発案】で最初に発言
- 発言ルール：通常は2〜3案提示。ブラッシュアップ依頼時は1案のみ深掘り（実装イメージ・ターゲット・差別化ポイントを盛り込む）

#### 🔍 調査者（新規）
- 役割：Web検索でリアルタイム情報を取得し、競合・市場規模・法規制を客観的にレポートする
- スタイル：検索結果に基づいた事実ベースの発言のみ。憶測はNG
- 特記：競合は「参入不可」でなく「市場が存在する証拠」として解釈し、「勝てる余地あり/限定的/参入障壁が高く厳しい」の3段階で結論を明示
- 選択肢提示：レポート末尾に①②③の3択を提示し、needs_choice: true フラグを返す
- フェーズ：Phase 1【発案】で発案者の後に発言
- ツール：Anthropic web_searchツールを使用

#### 🟢 肯定者（既存）
- 役割：アイデア・議論の可能性を最大化する
- スタイル：可能性を数字で示す。感情的な励まし・根拠のない楽観はNG
- フェーズ：Phase 2【検証】で最初に発言

#### 🔴 批判者（既存）
- 役割：弱い前提・リスク・矛盾・穴を具体的に指摘する
- スタイル：必ず問いで終わる。人格攻撃・ただの否定はNG
- フェーズ：Phase 2【検証】で肯定者の後に発言

#### 🔵 俯瞰者（既存）
- 役割：第三者として構造的・客観的に議論を整理する
- スタイル：「つまり本質的な問いは〜だ」で締める。どちらかに肩入れ・感情的発言はNG
- フェーズ：Phase 3【統合】で最初に発言

#### ⚖️ 統合者（既存）
- 役割：全人格の議論を受けて現時点の最適解を出す
- スタイル：必ず「次のアクション：〜」で終わる。曖昧な結論・アクションなしはNG
- フェーズ：Phase 3【統合】で俯瞰者の後に発言

### フェーズ制議論フロー

```
【Phase 1：発案】アイデアをFixするフェーズ
  1. ユーザーがテーマを入力
  2. 発案者がアイデアを2〜3案提示
  3. 調査者がWeb検索で競合・市場・法規制をレポート
     └ レポート末尾に①②③の選択ボタンを表示（needs_choice: true）
        ① この案をブラッシュアップする
           → 発案者に送信。発案者は1案のみ深掘りして返す
           → 調査者が再調査（ループ）
        ② 全く新しい案を出してもらう
           → 発案者に送信。発案者は別方向の2〜3案を提示
           → 調査者が再調査（ループ）
        ③ この案で次のフェーズに進む
           → タイトル入力モーダルを表示
           → タイトルを decided_idea_title としてSupabaseに保存
           → 「次のフェーズへ」ボタンを表示

【Phase 2：検証】アイデアを叩くフェーズ
  4. 肯定者が可能性を検証
  5. 批判者が弱点・リスクを指摘
  6. ユーザーが「次のフェーズへ」を押す

【Phase 3：統合】結論を出すフェーズ
  7. 俯瞰者が議論を構造的に整理
  8. 統合者が最適解と次のアクションを出す
```

### ユーザーの参加ルール

- 発言先を1人格に指定 → その人格がメインで返答
- 発言先を複数指定 → 指定された人格が順番に返答
- 発言先を未指定（全員）→ 現フェーズの人格が順番に反応

### プロアクティブ介入（実装済み）

俯瞰者が以下の4パターンで単独介入し、ユーザーに問いを返す：
1. 根拠のない主観的発言
2. 根拠のない否定
3. 根拠のない同意
4. 短すぎる・不明瞭な発言

---

## 技術スタック

| 項目 | 技術 |
|---|---|
| フロントエンド | Next.js + Tailwind CSS v3 |
| バックエンド | Next.js API Routes |
| AI | Anthropic API（claude-sonnet-4-20250514） |
| Web検索 | Anthropic web_searchツール（調査者専用） |
| DB / Auth | Supabase |
| デプロイ | Vercel |
| バージョン管理 | GitHub |
| 開発環境 | Windows / VSCode / PowerShell |

---

## Supabaseスキーマ（現状）

```sql
sessions (
  id uuid primary key,
  user_id uuid,
  theme text,
  language text,
  created_at timestamp,
  final_conclusion text,
  is_completed bool,
  summary jsonb,           -- { verdict, verdict_reason, conditions[], first_step }
  current_phase int,       -- 1 | 2 | 3
  decided_idea_title text  -- ③ボタン確定時に保存するPhase 1の決定案タイトル
)

messages (
  id uuid primary key,
  session_id uuid references sessions(id),
  speaker text,  -- 'taku' | 'proposer' | 'researcher' | 'affirmer' | 'critic' | 'observer' | 'synthesizer'
  content text,
  target text,
  created_at timestamp
)
```

**Supabase追加マイグレーション（2026-04-13実施）：**
```sql
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS decided_idea_title text;
```

---

## APIの呼び出し設計

### フェーズ制連鎖の仕組み

```javascript
// Phase 1：発案
const proposerResponse = await callClaude(PROPOSER_PROMPT, messages);
// 発案者：通常は2〜3案、ブラッシュアップ依頼時は1案深掘り

const researcherResponse = await callClaudeWithSearch(RESEARCHER_PROMPT, messages);
// 戻り値: { content, isDecided, needsChoice }
// needsChoice: true → フロント側で①②③の選択ボタンを表示
// isDecided: true  → phaseCompleted: true を返し「次のフェーズへ」ボタンを表示

// ① or ② が選ばれた場合: target=["proposer"] で再度 API 呼び出し → ループ
// ③ が選ばれた場合: API呼び出しなし → タイトル入力モーダル → 次フェーズボタン

// Phase 2：検証（ユーザーが「次のフェーズへ」を押した後）
const affirmerResponse = await callClaude(AFFIRMER_PROMPT, messages);
const criticResponse = await callClaude(CRITIC_PROMPT, messages);

// Phase 3：統合（ユーザーが「次のフェーズへ」を押した後）
const observerResponse = await callClaude(OBSERVER_PROMPT, messages);
const synthesizerResponse = await callClaude(SYNTHESIZER_PROMPT, messages);
```

### 調査者の決断検出マーカー

```
<<<NEEDS_CHOICE>>>  調査レポートの末尾に①②③の選択肢を提示した場合
<<<IS_DECIDED>>>    ユーザーが①②③のいずれかを選択・決断した場合
<<<CONTINUE>>>      その他（追加調査・通常の会話など）
```

### 調査者のWeb検索実装

```javascript
async function callClaudeWithSearch(systemPrompt, messages) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      system: systemPrompt,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages,
    }),
  });
  // needs_clarification フラグをレスポンスに含める
}
```

---

## Claude Codeへの実装指示（今回の変更分）

```
4persona_debate_spec.md を読んで。

今回実装したいのは以下の3点：

【1】新人格2つの追加
src/app/api/debate/route.ts の getSystemPrompt に以下を追加：
- 発案者（proposer）：アイデアを2〜3案提示する役割
- 調査者（researcher）：web_searchツールを使いリアルタイムで競合・市場・法規制を調べる役割。
  障壁発見時は { needs_clarification: true, message: "..." } を返す。
  クリア時は通常の発言を返す。

【2】フェーズ制フローの実装
- セッションにcurrent_phase（1/2/3）を持たせる
- Phase 1：発案者→調査者の順で実行
- Phase 2：肯定者→批判者の順で実行（ユーザーが「次のフェーズへ」を押したとき）
- Phase 3：俯瞰者→統合者の順で実行（ユーザーが「次のフェーズへ」を押したとき）
- 調査者がneeds_clarification: trueを返した場合はフェーズを進めない

【3】UI変更
- チャット画面上部にフェーズステッパーを追加
  （① 発散 → ② 検証 → ③ 統合）現在のフェーズをハイライト
- 発言先ボタンを6人格分に更新（発案者・調査者・肯定者・批判者・俯瞰者・統合者）
- 調査者がneeds_clarification: trueを返した場合、
  「障壁が見つかりました。どうしますか？」という形でユーザーへの問い返しUIを表示
- 各フェーズの最後（調査者クリア後・批判者後・統合者後）に
  「次のフェーズへ」ボタンを表示

既存機能（doneコマンド・Supabase保存・介入トリガー）はそのまま維持すること。
実装はUX→フロントエンド→バックエンドの順で進めて。
```

---

## 今後の実装予定

- Stripe課金（3セッションまで無料、4回目から月額980円）
- 調査者のWeb検索を有料プラン限定に切り替え
- 会話履歴の保存・再開（Supabase）← 実装済み（2026-04-12）
