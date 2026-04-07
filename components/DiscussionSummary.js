import React, { useState } from 'react';
import { ChevronDownIcon, ChevronUpIcon, PrinterIcon, DocumentDuplicateIcon } from '@heroicons/react/24/outline';

const DiscussionSummary = ({ summary }) => {
  const [expandedSections, setExpandedSections] = useState({
    conclusion: true,
    keyPoints: true,
    nextActions: true
  });

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const handlePrint = () => {
    window.print();
  };

  const handleCopy = async () => {
    const text = `
結論:
${summary?.conclusion || '未設定'}

主な論点:
${summary?.keyPoints?.map((point, index) => `${index + 1}. ${point}`).join('\n') || '未設定'}

次のアクション:
${summary?.nextActions?.map((action, index) => `${index + 1}. ${action}`).join('\n') || '未設定'}
    `.trim();
    
    try {
      await navigator.clipboard.writeText(text);
      alert('クリップボードにコピーしました');
    } catch (err) {
      console.error('コピーに失敗しました:', err);
      alert('コピーに失敗しました');
    }
  };

  const SectionHeader = ({ title, section, icon }) => (
    <button
      onClick={() => toggleSection(section)}
      className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors duration-200 border-b border-gray-200"
    >
      <div className="flex items-center space-x-3">
        <span className="text-2xl">{icon}</span>
        <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
      </div>
      {expandedSections[section] ? (
        <ChevronUpIcon className="w-5 h-5 text-gray-600" />
      ) : (
        <ChevronDownIcon className="w-5 h-5 text-gray-600" />
      )}
    </button>
  );

  if (!summary) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-white rounded-lg shadow-lg">
          <div className="p-8 text-center">
            <p className="text-gray-500 text-lg">ディスカッションサマリーがありません</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        {/* ヘッダー */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-white">ディスカッションサマリー</h2>
            <div className="flex space-x-2">
              <button
                onClick={handlePrint}
                className="flex items-center space-x-1 px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors duration-200 text-white"
              >
                <PrinterIcon className="w-4 h-4" />
                <span className="text-sm">印刷</span>
              </button>
              <button
                onClick={handleCopy}
                className="flex items-center space-x-1 px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors duration-200 text-white"
              >
                <DocumentDuplicateIcon className="w-4 h-4" />
                <span className="text-sm">コピー</span>
              </button>
            </div>
          </div>
        </div>

        {/* 結論セクション */}
        <div className="border-b border-gray-200">
          <SectionHeader
            title="結論"
            section="conclusion"
            icon="🎯"
          />
          {expandedSections.conclusion && (
            <div className="p-6">
              <div className="prose max-w-none">
                <p className="text-gray-700 leading-relaxed text-lg">
                  {summary.conclusion || 'まだ結論が設定されていません'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* 主な論点セクション */}
        <div className="border-b border-gray-200">
          <SectionHeader
            title="主な論点"
            section="keyPoints"
            icon="💡"
          />
          {expandedSections.keyPoints && (
            <div className="p-6">
              {summary.keyPoints && summary.keyPoints.length > 0 ? (
                <ul className="space-y-3">
                  {summary.keyPoints.map((point, index) => (
                    <li key={index} className="flex items-start space-x-3">
                      <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-medium">
                        {index + 1}
                      </span>
                      <p className="text-gray-700 leading-relaxed">{point}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-500 italic">まだ論点が設定されていません</p>
              )}
            </div>
          )}
        </div>

        {/* 次のアクションセクション */}
        <div>
          <SectionHeader
            title="次のアクション"
            section="nextActions"
            icon="⚡"
          />
          {expandedSections.nextActions && (
            <div className="p-6">
              {summary.nextActions && summary.nextActions.length > 0 ? (
                <ul className="space-y-3">
                  {summary.nextActions.map((action, index) => (
                    <li key={index} className="flex items-start space-x-3">
                      <span className="flex-shrink-0 w-6 h-6 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-sm font-medium">
                        {index + 1}
                      </span>
                      <p className="text-gray-700 leading-relaxed">{action}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-500 italic">まだアクションが設定されていません</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 印刷用スタイル */}
      <style jsx>{`
        @media print {
          .max-w-4xl {
            max-width: none;
          }
          
          .shadow-lg {
            box-shadow: none;
          }
          
          .bg-gradient-to-r {
            background: #1e40af !important;
            -webkit-print-color-adjust: exact;
            color-adjust: exact;
          }
          
          button {
            display: none;
          }
          
          .bg-gray-50,
          .hover\\:bg-gray-100 {
            background: #f9fafb !important;
            -webkit-print-color-adjust: exact;
            color-adjust: exact;
          }
        }
      `}</style>
    </div>
  );
};

export default DiscussionSummary;