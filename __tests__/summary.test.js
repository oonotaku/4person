import { summaryService } from '../lib/summaryService';
import { conversationService } from '../lib/conversationService';

// Mock dependencies
jest.mock('../lib/conversationService');
jest.mock('openai');

const mockConversationService = conversationService;

describe('SummaryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('detectDoneMessage', () => {
    test('should detect "done" message (case insensitive)', () => {
      const testCases = [
        'done',
        'Done',
        'DONE',
        '  done  ',
        'I am done',
        'We are done with this conversation'
      ];

      testCases.forEach(message => {
        expect(summaryService.detectDoneMessage(message)).toBe(true);
      });
    });

    test('should not detect non-done messages', () => {
      const testCases = [
        'hello',
        'how are you',
        'donkey',
        'undone',
        'abandon',
        ''
      ];

      testCases.forEach(message => {
        expect(summaryService.detectDoneMessage(message)).toBe(false);
      });
    });

    test('should handle null and undefined', () => {
      expect(summaryService.detectDoneMessage(null)).toBe(false);
      expect(summaryService.detectDoneMessage(undefined)).toBe(false);
    });
  });

  describe('generateSummary', () => {
    test('should generate summary successfully', async () => {
      const mockMessages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' },
        { role: 'assistant', content: 'I am doing well, thank you!' }
      ];

      const mockSummary = 'User greeted and asked about wellbeing. Assistant responded positively.';
      
      // Mock OpenAI response
      const mockCreate = jest.fn().mockResolvedValue({
        choices: [{
          message: {
            content: mockSummary
          }
        }]
      });

      const { OpenAI } = require('openai');
      OpenAI.mockImplementation(() => ({
        chat: {
          completions: {
            create: mockCreate
          }
        }
      }));

      const result = await summaryService.generateSummary(mockMessages);

      expect(result).toBe(mockSummary);
      expect(mockCreate).toHaveBeenCalledWith({
        model: 'gpt-3.5-turbo',
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'system',
            content: expect.stringContaining('conversation')
          })
        ]),
        max_tokens: 200,
        temperature: 0.3
      });
    });

    test('should handle OpenAI API failure', async () => {
      const mockMessages = [
        { role: 'user', content: 'Hello' }
      ];

      const mockCreate = jest.fn().mockRejectedValue(new Error('API Error'));

      const { OpenAI } = require('openai');
      OpenAI.mockImplementation(() => ({
        chat: {
          completions: {
            create: mockCreate
          }
        }
      }));

      await expect(summaryService.generateSummary(mockMessages))
        .rejects
        .toThrow('API Error');
    });

    test('should handle empty messages array', async () => {
      await expect(summaryService.generateSummary([]))
        .rejects
        .toThrow('No messages to summarize');
    });

    test('should handle invalid response format', async () => {
      const mockMessages = [
        { role: 'user', content: 'Hello' }
      ];

      const mockCreate = jest.fn().mockResolvedValue({
        choices: []
      });

      const { OpenAI } = require('openai');
      OpenAI.mockImplementation(() => ({
        chat: {
          completions: {
            create: mockCreate
          }
        }
      }));

      await expect(summaryService.generateSummary(mockMessages))
        .rejects
        .toThrow('Failed to generate summary');
    });
  });

  describe('saveSummaryToDatabase', () => {
    test('should save summary successfully', async () => {
      const mockConversationId = 'conv-123';
      const mockSummary = 'Test summary';

      mockConversationService.updateConversation.mockResolvedValue({
        id: mockConversationId,
        summary: mockSummary,
        status: 'completed'
      });

      const result = await summaryService.saveSummaryToDatabase(mockConversationId, mockSummary);

      expect(mockConversationService.updateConversation).toHaveBeenCalledWith(
        mockConversationId,
        {
          summary: mockSummary,
          status: 'completed',
          updated_at: expect.any(String)
        }
      );
      expect(result).toEqual({
        id: mockConversationId,
        summary: mockSummary,
        status: 'completed'
      });
    });

    test('should handle database connection error', async () => {
      const mockConversationId = 'conv-123';
      const mockSummary = 'Test summary';

      mockConversationService.updateConversation.mockRejectedValue(
        new Error('Database connection failed')
      );

      await expect(
        summaryService.saveSummaryToDatabase(mockConversationId, mockSummary)
      ).rejects.toThrow('Database connection failed');
    });

    test('should handle invalid conversation ID', async () => {
      const mockSummary = 'Test summary';

      mockConversationService.updateConversation.mockRejectedValue(
        new Error('Conversation not found')
      );

      await expect(
        summaryService.saveSummaryToDatabase(null, mockSummary)
      ).rejects.toThrow('Conversation not found');
    });

    test('should validate required parameters', async () => {
      await expect(
        summaryService.saveSummaryToDatabase('', 'summary')
      ).rejects.toThrow();

      await expect(
        summaryService.saveSummaryToDatabase('conv-123', '')
      ).rejects.toThrow();
    });
  });
});