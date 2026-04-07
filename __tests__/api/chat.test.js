import handler from '../../pages/api/chat';
import { createMocks } from 'node-mocks-http';
import { conversationService } from '../../lib/conversationService';
import { summaryService } from '../../lib/summaryService';

// Mock dependencies
jest.mock('../../lib/conversationService');
jest.mock('../../lib/summaryService');
jest.mock('openai');

const mockConversationService = conversationService;
const mockSummaryService = summaryService;

describe('/api/chat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/chat', () => {
    test('should handle normal chat message successfully', async () => {
      const { req, res } = createMocks({
        method: 'POST',
        body: {
          message: 'Hello, how are you?',
          conversationId: 'conv-123'
        }
      });

      // Mock OpenAI response
      const mockCreate = jest.fn().mockResolvedValue({
        choices: [{
          message: {
            content: 'I am doing well, thank you for asking!'
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

      // Mock conversation service
      mockConversationService.getConversation.mockResolvedValue({
        id: 'conv-123',
        messages: []
      });

      mockConversationService.addMessage.mockResolvedValue({
        id: 'msg-123',
        content: 'Hello, how are you?',
        role: 'user'
      });

      mockSummaryService.detectDoneMessage.mockReturnValue(false);

      await handler(req, res);

      expect(res._getStatusCode()).toBe(200);
      const responseData = JSON.parse(res._getData());
      expect(responseData.message).toBe('I am doing well, thank you for asking!');
      expect(responseData.conversationId).toBe('conv-123');
      expect(mockSummaryService.detectDoneMessage).toHaveBeenCalledWith('Hello, how are you?');
    });

    test('should handle "done" message and generate summary', async () => {
      const { req, res } = createMocks({
        method: 'POST',
        body: {
          message: 'I think we are done here',
          conversationId: 'conv-123'
        }
      });

      const mockMessages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' }
      ];

      // Mock conversation service
      mockConversationService.getConversation.mockResolvedValue({
        id: 'conv-123',
        messages: mockMessages
      });

      mockConversationService.addMessage.mockResolvedValue({
        id: 'msg-123',
        content: 'I think we are done here',
        role: 'user'
      });

      // Mock summary service
      mockSummaryService.detectDoneMessage.mockReturnValue(true);
      mockSummaryService.generateSummary.mockResolvedValue('Conversation summary');
      mockSummaryService.saveSummaryToDatabase.mockResolvedValue({
        id: 'conv-123',
        summary: 'Conversation summary',
        status: 'completed'
      });

      await handler(req, res);

      expect(res._getStatusCode()).toBe(200);
      const responseData = JSON.parse(res._getData());
      expect(responseData.summary).toBe('Conversation summary');
      expect(responseData.status).toBe('completed');
      expect(mockSummaryService.generateSummary).toHaveBeenCalledWith(mockMessages);
      expect(mockSummaryService.saveSummaryToDatabase).toHaveBeenCalledWith(
        'conv-123',
        'Conversation summary'
      );
    });

    test('should handle missing message parameter', async () => {
      const { req, res } = createMocks({
        method: 'POST',
        body: {
          conversationId: 'conv-123'
        }
      });

      await handler(req, res);

      expect(res._getStatusCode()).toBe(400);
      const responseData = JSON.parse(res._getData());
      expect(responseData.error).toBe('Message is required');
    });

    test('should handle OpenAI API failure', async () => {
      const { req, res } = createMocks({
        method: 'POST',
        body: {
          message: 'Hello',
          conversationId: 'conv-123'
        }
      });

      // Mock OpenAI failure
      const mockCreate = jest.fn().mockRejectedValue(new Error('OpenAI API Error'));

      const { OpenAI } = require('openai');
      OpenAI.mockImplementation(() => ({
        chat: {
          completions: {
            create: mockCreate
          }
        }
      }));

      mockConversationService.getConversation.mockResolvedValue({
        id: 'conv-123',
        messages: []
      });

      mockSummaryService.detectDoneMessage.mockReturnValue(false);

      await handler(req, res);

      expect(res._getStatusCode()).toBe(500);
      const responseData = JSON.parse(res._getData());
      expect(responseData.error).toBe('Failed to get AI response');
    });

    test('should handle database connection failure', async () => {
      const { req, res } = createMocks({
        method: 'POST',
        body: {
          message: 'Hello',
          conversationId: 'conv-123'
        }
      });

      mockConversationService.getConversation.mockRejectedValue(
        new Error('Database connection failed')
      );

      await handler(req, res);

      expect(res._getStatusCode()).toBe(500);
      const responseData = JSON.parse(res._getData());
      expect(responseData.error).toBe('Database error');
    });

    test('should handle summary generation failure', async () => {
      const { req, res } = createMocks({
        method: 'POST',
        body: {
          message: 'done',
          conversationId: 'conv-123'
        }
      });

      mockConversationService.getConversation.mockResolvedValue({
        id: 'conv-123',
        messages: [{ role: 'user', content: 'Hello' }]
      });

      mockSummaryService.detectDoneMessage.mockReturnValue(true);
      mockSummaryService.generateSummary.mockRejectedValue(
        new Error('Summary generation failed')
      );

      await handler(req, res);

      expect(res._getStatusCode()).toBe(500);
      const responseData = JSON.parse(res._getData());
      expect(responseData.error).toBe('Failed to generate summary');
    });

    test('should handle summary save failure', async () => {
      const { req, res } = createMocks({
        method: 'POST',
        body: {
          message: 'done',
          conversationId: 'conv-123'
        }
      });

      mockConversationService.getConversation.mockResolvedValue({
        id: 'conv-123',
        messages: [{ role: 'user', content: 'Hello' }]
      });

      mockSummaryService.detectDoneMessage.mockReturnValue(true);
      mockSummaryService.generateSummary.mockResolvedValue('Test summary');
      mockSummaryService.saveSummaryToDatabase.mockRejectedValue(
        new Error('Database save failed')
      );

      await handler(req, res);

      expect(res._getStatusCode()).toBe(500);
      const responseData = JSON.parse(res._getData());
      expect(responseData.error).toBe('Failed to save summary');
    });

    test('should handle invalid conversation ID', async () => {
      const { req, res } = createMocks({
        method: 'POST',
        body: {
          message: 'Hello',
          conversationId: 'invalid-id'
        }
      });

      mockConversationService.getConversation.mockResolvedValue(null);

      await handler(req, res);

      expect(res._getStatusCode()).toBe(404);
      const responseData = JSON.parse(res._getData());
      expect(responseData.error).toBe('Conversation not found');
    });
  });

  describe('Invalid HTTP methods', () => {
    test('should return 405 for GET request', async () => {
      const { req, res } = createMocks({
        method: 'GET'
      });

      await handler(req, res);

      expect(res._getStatusCode()).toBe(405);
      const responseData = JSON.parse(res._getData());
      expect(responseData.error).toBe('Method not allowed');
    });

    test('should return 405 for PUT request', async () => {
      const { req, res } = createMocks({
        method: 'PUT'
      });

      await handler(req, res);

      expect(res._getStatusCode()).toBe(405);
    });
  });
});