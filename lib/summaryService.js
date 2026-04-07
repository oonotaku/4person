import { supabaseAdmin } from './supabaseClient';

/**
 * 議論のサマリーを生成してデータベースに保存する
 * トランザクションを使用してdiscussionsテーブルのステータス更新とサマリー保存を同期実行
 */
export async function generateAndSaveSummary(discussionId) {
  try {
    // 議論のメッセージを取得
    const { data: messages, error: messagesError } = await supabaseAdmin
      .from('messages')
      .select('content, created_at, user_id')
      .eq('discussion_id', discussionId)
      .order('created_at', { ascending: true });

    if (messagesError) {
      throw new Error(`Failed to fetch messages: ${messagesError.message}`);
    }

    if (!messages || messages.length === 0) {
      throw new Error('No messages found for discussion');
    }

    // サマリーを生成（簡単な実装例）
    const summary = generateSummaryText(messages);

    // トランザクション開始
    const { error: transactionError } = await supabaseAdmin.rpc('execute_summary_transaction', {
      p_discussion_id: discussionId,
      p_summary_content: summary
    });

    if (transactionError) {
      // RPCが存在しない場合は個別に実行
      if (transactionError.code === '42883') {
        await executeManualTransaction(discussionId, summary);
      } else {
        throw transactionError;
      }
    }

    return summary;
  } catch (error) {
    console.error('Summary generation failed:', error);
    throw error;
  }
}

/**
 * 手動でトランザクション相当の処理を実行
 */
async function executeManualTransaction(discussionId, summary) {
  try {
    // 1. 議論ステータスを更新
    const { error: updateError } = await supabaseAdmin
      .from('discussions')
      .update({ 
        status: 'completed',
        updated_at: new Date().toISOString()
      })
      .eq('id', discussionId);

    if (updateError) {
      throw updateError;
    }

    // 2. サマリーを保存
    const { error: summaryError } = await supabaseAdmin
      .from('discussion_summaries')
      .insert({
        discussion_id: discussionId,
        summary: summary,
        created_at: new Date().toISOString()
      });

    if (summaryError) {
      // サマリー保存に失敗した場合、ステータスを元に戻す
      await supabaseAdmin
        .from('discussions')
        .update({ 
          status: 'active',
          updated_at: new Date().toISOString()
        })
        .eq('id', discussionId);
      
      throw summaryError;
    }
  } catch (error) {
    throw new Error(`Transaction failed: ${error.message}`);
  }
}

/**
 * メッセージからサマリーテキストを生成する
 */
function generateSummaryText(messages) {
  const messageCount = messages.length;
  const uniqueUsers = new Set(messages.map(m => m.user_id)).size;
  
  // 最初と最後のメッセージを取得
  const firstMessage = messages[0];
  const lastMessage = messages[messages.length - 1];
  
  // 簡単なサマリー生成（実際のプロジェクトではAI APIなどを使用）
  const summary = `議論サマリー:
` +
    `- 参加者数: ${uniqueUsers}名
` +
    `- メッセージ数: ${messageCount}件
` +
    `- 開始時刻: ${new Date(firstMessage.created_at).toLocaleString('ja-JP')}
` +
    `- 終了時刻: ${new Date(lastMessage.created_at).toLocaleString('ja-JP')}
` +
    `- 議論内容: ${messages.slice(0, 3).map(m => m.content).join(', ')}${messageCount > 3 ? '...' : ''}`;
  
  return summary;
}