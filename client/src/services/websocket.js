/**
 * WebSocket 服务 - 连接后端接收实时数据
 */

class WebSocketService {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.listeners = new Map();
    this.reconnectTimer = null;
    this.heartbeatTimer = null;  // 心跳定时器
    this.reconnectAttempts = 0;  // 重连次数
    this.maxReconnectAttempts = 10;  // 最大重连次数
  }

  /**
   * 连接 WebSocket 服务器
   */
  connect(url = `ws://${window.location.host}/ws`) {
    if (this.ws) {
      return;
    }

    console.log('🔗 连接 WebSocket:', url);

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('✅ WebSocket 已连接');
      this.connected = true;
      this.reconnectAttempts = 0;  // 重置重连次数
      this.emit('connection', { status: 'connected' });

      // 启动心跳
      this.startHeartbeat();
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (error) {
        console.error('解析消息失败:', error);
      }
    };

    this.ws.onerror = (error) => {
      console.error('❌ WebSocket 错误:', error);
      this.emit('error', error);
    };

    this.ws.onclose = () => {
      console.log('🔌 WebSocket 已断开');
      this.connected = false;
      this.ws = null;
      this.emit('connection', { status: 'disconnected' });

      // 停止心跳
      this.stopHeartbeat();

      // 重连逻辑（带指数退避）
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const delay = Math.min(5000 * this.reconnectAttempts, 30000);  // 最多30秒
        console.log(`⏳ ${delay/1000}秒后尝试第${this.reconnectAttempts}次重连...`);

        this.reconnectTimer = setTimeout(() => {
          this.connect(url);
        }, delay);
      } else {
        console.error('❌ 达到最大重连次数，停止重连');
        this.emit('connection', { status: 'failed', message: '连接失败，请刷新页面重试' });
      }
    };
  }

  /**
   * 启动心跳
   */
  startHeartbeat() {
    // 每25秒发送一次ping（服务端30秒检测）
    this.heartbeatTimer = setInterval(() => {
      if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send('ping', {});
      }
    }, 25000);
  }

  /**
   * 停止心跳
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 处理接收到的消息
   */
  handleMessage(message) {
    const { type, topic, data } = message;

    if (type === 'mqtt_message') {
      // 根据话题分发消息
      this.emit(topic, data);
      this.emit('any', { topic, data });
    } else {
      this.emit(type, message);
    }
  }

  /**
   * 发送消息
   */
  send(type, payload) {
    if (!this.connected || !this.ws) {
      console.warn('WebSocket 未连接');
      return;
    }

    this.ws.send(JSON.stringify({ type, payload }));
  }

  /**
   * 发布任务
   */
  publishMission(missionData) {
    this.send('publish_mission', missionData);
  }

  /**
   * 发布执行指令
   */
  publishExecution(executionData) {
    this.send('publish_execution', executionData);
  }

  /**
   * 发布起飞/降落指令
   */
  publishCommand(commandData) {
    this.send('publish_command', commandData);
  }

  /**
   * 订阅事件
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  /**
   * 取消订阅
   */
  off(event, callback) {
    if (!this.listeners.has(event)) {
      return;
    }
    const callbacks = this.listeners.get(event);
    const index = callbacks.indexOf(callback);
    if (index > -1) {
      callbacks.splice(index, 1);
    }
  }

  /**
   * 触发事件
   */
  emit(event, data) {
    if (!this.listeners.has(event)) {
      return;
    }
    this.listeners.get(event).forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`事件处理失败 [${event}]:`, error);
      }
    });
  }

  /**
   * 断开连接
   */
  disconnect() {
    // 清理重连定时器
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // 停止心跳
    this.stopHeartbeat();

    // 关闭WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connected = false;
    this.reconnectAttempts = 0;  // 重置重连次数
  }

  /**
   * 获取连接状态
   */
  isConnected() {
    return this.connected;
  }
}

export default new WebSocketService();
