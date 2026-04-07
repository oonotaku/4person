import { useState } from 'react';
import { useDiscussion } from '../hooks/useDiscussion';

const ChatInterface = ({ discussionId }) => {
  const [newMessage, setNewMessage] = useState('');
  const {
    messages,
    discussion,
    isLoading,
    isGeneratingSummary,
    summaryError,
    sendMessage,
    retrySummaryGeneration
  } = useDiscussion(discussionId);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || isLoading || discussion?.status === 'ended') return;

    const success = await sendMessage(newMessage);
    if (success) {
      setNewMessage('');
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const isDiscussionEnded = discussion?.status === 'ended';
  const isSummaryGenerating = discussion?.status === 'generating_summary';

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isDiscussionEnded && (
          <div className="bg-gray-100 border border-gray-300 rounded-lg p-4 text-center">
            <div className="text-gray-600 font-medium">
              🏁 議論終了
            </div>
            <div className="text-sm text-gray-500 mt-1">
              この議論は終了しました。新しいメッセージを送信することはできません。
            </div>
            {discussion?.summary && (
              <div className="mt-3 p-3 bg-white rounded border">
                <div className="font-medium text-gray-700 mb-2">📝 議論サマリー</div>
                <div className="text-sm text-gray-600 text-left">
                  {discussion.summary}
                </div>
              </div>
            )}
          </div>
        )}

        {(isSummaryGenerating || isGeneratingSummary) && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center justify-center space-x-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
              <span className="text-blue-700 font-medium">サマリー生成中...</span>
            </div>
            <div className="text-sm text-blue-600 mt-1 text-center">
              議論の内容を整理しています。しばらくお待ちください。
            </div>
            <div className="mt-3 bg-blue-100 rounded p-2">
              <div className="text-xs text-blue-700">
                ⏱️ 通常1-2分程度かかります
              </div>
            </div>
          </div>
        )}

        {summaryError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-center space-x-2 text-red-700 font-medium mb-2">
              <span>⚠️</span>
              <span>サマリー生成エラー</span>
            </div>
            <div className="text-sm text-red-600 mb-3">
              {summaryError}
            </div>
            <div className="flex justify-center">
              <button
                onClick={retrySummaryGeneration}
                disabled={isGeneratingSummary}
                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                  isGeneratingSummary
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-red-600 text-white hover:bg-red-700'
                }`}
              >
                {isGeneratingSummary ? (
                  <div className="flex items-center space-x-2">
                    <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                    <span>再試行中...</span>
                  </div>
                ) : (
                  '🔄 再試行'
                )}
              </button>
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id} className="bg-white rounded-lg shadow p-4">
            <div className="text-gray-800">{message.content}</div>
            <div className="text-xs text-gray-500 mt-2">
              {new Date(message.created_at).toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      {/* Input area */}
      <div className="border-t p-4">
        <div className="flex space-x-2">
          <textarea
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={isDiscussionEnded ? "議論が終了しているため、メッセージを送信できません" : "メッセージを入力..."}
            disabled={isLoading || isDiscussionEnded}
            className={`flex-1 resize-none border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              isDiscussionEnded 
                ? 'bg-gray-100 text-gray-500 cursor-not-allowed' 
                : 'bg-white'
            }`}
            rows={3}
          />
          <button
            onClick={handleSendMessage}
            disabled={isLoading || !newMessage.trim() || isDiscussionEnded}
            className={`px-6 py-2 rounded-lg font-medium transition-colors ${
              isLoading || !newMessage.trim() || isDiscussionEnded
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {isLoading ? (
              <div className="flex items-center space-x-2">
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                <span>送信中...</span>
              </div>
            ) : (
              '送信'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;