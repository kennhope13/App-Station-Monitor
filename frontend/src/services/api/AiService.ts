/**
 * AiService - Giao tiếp với AI Engine (FastAPI)
 * Mặc định AI Engine chạy trên cổng 8100
 */

import { AI_ENGINE_URL } from '@/utils/env';

const AI_BASE_URL = AI_ENGINE_URL;

export interface PredictionHistoryPoint {
  timestamp: string;
  [key: string]: number | string; // ID_1, ID_1_pred, etc.
}

export interface TrainingStatus {
  status: 'Idle' | 'Training...' | 'Success' | 'Error';
  progress?: number;
  message?: string;
  last_trained?: string;
}

class AiService {
  /**
   * Lấy lịch sử và dự báo nhiệt độ
   */
  async getPredictionHistory(): Promise<PredictionHistoryPoint[]> {
    try {
      const response = await fetch(`${AI_BASE_URL}/api/prediction/history`);
      if (!response.ok) throw new Error('Failed to fetch prediction history');
      const data = await response.json();
      return data.history || [];
    } catch (error) {
      console.error('AiService.getPredictionHistory error:', error);
      return [];
    }
  }

  /**
   * Lấy trạng thái huấn luyện AI
   */
  async getTrainingStatus(): Promise<TrainingStatus> {
    try {
      const response = await fetch(`${AI_BASE_URL}/api/training-status`);
      if (!response.ok) throw new Error('Failed to fetch training status');
      return await response.json();
    } catch (error) {
      console.error('AiService.getTrainingStatus error:', error);
      return { status: 'Idle', message: 'Không thể kết nối với AI Engine' };
    }
  }

  /**
   * Kích hoạt huấn luyện lại thủ công
   */
  async triggerRetrain(): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch(`${AI_BASE_URL}/api/retrain`, { method: 'POST' });
      return await response.json();
    } catch (error) {
      console.error('AiService.triggerRetrain error:', error);
      return { success: false, message: 'Lỗi kết nối' };
    }
  }
}

export const aiService = new AiService();
