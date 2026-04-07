import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export const useDiscussion = (discussionId) => {
  const [messages, setMessages] = useState([]);
  const [discussion, setDiscussion] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState(null);

  useEffect(() => {
    if (discussionId) {
      fetchDiscussion();
      fetchMessages();
    }
  }, [discussionId]);

  const fetchDiscussion = async () => {
    try {
      const { data, error } = await supabase
        .from('discussions')
        .select('*')
        .eq('id', discussionId)
        .single();

      if (error) throw error;
      setDiscussion(data);
      
      // サマリー生成状態の管理
      if (data?.status === 'generating_summary') {
        setIsGeneratingSummary(true);
        setSummaryError(null);
      } else {
        setIsGeneratingSummary(false);
      }
    } catch (error) {
      console.error('Error fetching discussion:', error);
    }
  };

  const fetchMessages = async () => {
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('discussion_id', discussionId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMessages(data || []);
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  };

  const sendMessage = async (content) => {
    if (!content.trim() || isLoading || discussion?.status === 'ended') return;

    setIsLoading(true);
    try {
      const { error } = await supabase
        .from('messages')
        .insert({
          discussion_id: discussionId,
          content: content,
          created_at: new Date().toISOString()
        });

      if (error) throw error;
      await fetchMessages();
      return true;
    } catch (error) {
      console.error('Error sending message:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const generateSummary = async () => {
    if (isGeneratingSummary) return;

    setIsGeneratingSummary(true);
    setSummaryError(null);

    try {
      // 議論ステータスを「サマリー生成中」に更新
      const { error: statusError } = await supabase
        .from('discussions')
        .update({ status: 'generating_summary' })
        .eq('id', discussionId);

      if (statusError) throw statusError;

      // サマリー生成API呼び出し（実際のAPI実装に応じて調整）
      const response = await fetch('/api/generate-summary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ discussionId }),
      });

      if (!response.ok) {
        throw new Error('サマリー生成に失敗しました');
      }

      const result = await response.json();

      // 生成成功後、議論ステータスを「終了」に更新
      const { error: updateError } = await supabase
        .from('discussions')
        .update({ 
          status: 'ended',
          summary: result.summary 
        })
        .eq('id', discussionId);

      if (updateError) throw updateError;

      await fetchDiscussion();
      return true;
    } catch (error) {
      console.error('Error generating summary:', error);
      setSummaryError(error.message || 'サマリー生成中にエラーが発生しました');
      
      // エラー時は元のステータスに戻す
      await supabase
        .from('discussions')
        .update({ status: 'active' })
        .eq('id', discussionId);
      
      await fetchDiscussion();
      return false;
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const retrySummaryGeneration = async () => {
    setSummaryError(null);
    return await generateSummary();
  };

  return {
    messages,
    discussion,
    isLoading,
    isGeneratingSummary,
    summaryError,
    sendMessage,
    generateSummary,
    retrySummaryGeneration,
    fetchDiscussion,
    fetchMessages
  };
};