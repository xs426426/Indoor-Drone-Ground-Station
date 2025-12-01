const mqtt = require('mqtt');
const config = require('./config');
const protoHandler = require('./proto-handler');

class MqttClient {
  constructor() {
    this.client = null;
    this.connected = false;
    this.subscribers = new Set();
    this.explorationCallback = null; // 探索引擎数据回调
  }

  /**
   * 连接到无人机 MQTT broker
   */
  connect() {
    return new Promise((resolve, reject) => {
      const url = `mqtt://${config.mqtt.broker}:${config.mqtt.port}`;

      console.log(`🔗 连接到 MQTT broker: ${url}`);

      this.client = mqtt.connect(url, {
        clientId: config.mqtt.clientId,
        clean: true,
        connectTimeout: 10000,
        reconnectPeriod: 5000
      });

      this.client.on('connect', () => {
        console.log('✅ MQTT 连接成功');
        this.connected = true;
        this.subscribeAll();
        resolve();
      });

      this.client.on('error', (error) => {
        console.error('❌ MQTT 连接错误:', error.message);
        reject(error);
      });

      this.client.on('close', () => {
        console.log('🔌 MQTT 连接断开');
        this.connected = false;
      });

      this.client.on('reconnect', () => {
        console.log('🔄 正在重连 MQTT...');
      });

      this.client.on('message', (topic, payload) => {
        this.handleMessage(topic, payload);
      });
    });
  }

  /**
   * 订阅所有配置的话题
   */
  subscribeAll() {
    config.topics.forEach(topic => {
      this.client.subscribe(topic, (err) => {
        if (err) {
          console.error(`❌ 订阅失败 [${topic}]:`, err);
        } else {
          console.log(`✅ 已订阅: ${topic}`);
        }
      });
    });
  }

  /**
   * 处理接收到的消息
   */
  handleMessage(topic, payload) {
    try {
      // 解码 Protobuf 消息
      const data = protoHandler.decode(topic, payload);

      if (data) {
        // 广播给所有 WebSocket 客户端
        this.broadcast({
          type: 'mqtt_message',
          topic: topic,
          data: data,
          timestamp: Date.now()
        });

        // 如果有探索引擎回调，传递点云和里程计数据
        if (this.explorationCallback) {
          if (topic === '/daf/pointcloud' || topic === '/daf/pointcloud_rgb') {
            this.explorationCallback('pointcloud', data);
          } else if (topic === '/daf/local/odometry') {
            this.explorationCallback('odometry', data);
          }
        }

        // 日志已关闭 - 避免刷屏
        // if (topic === '/daf/heartbeat') {
        //   console.log(`💓 [心跳] 序号: ${data.seqenceId}`);
        // } else if (topic === '/daf/pointcloud' || topic === '/daf/pointcloud_rgb') {
        //   console.log(`☁️ [点云] 点数: ${data.points?.length || 0}`);
        // } else if (topic === '/daf/local/odometry') {
        //   const pos = data.pose?.position || data.position;
        //   if (pos) {
        //     console.log(`📍 [位姿] x:${pos.x.toFixed(3)} y:${pos.y.toFixed(3)} z:${pos.z.toFixed(3)}`);
        //   }
        // } else if (topic === '/daf/camera') {
        //   console.log(`📷 [视频] 帧大小: ${payload.length} bytes`);
        // }
      }
    } catch (error) {
      console.error(`处理消息失败 [${topic}]:`, error);
    }
  }

  /**
   * 发布任务
   */
  publishMission(missionData) {
    try {
      const buffer = protoHandler.createMission(missionData);
      this.client.publish('/daf/mission', buffer);
      console.log('✅ 任务已发布:', missionData.id);
    } catch (error) {
      console.error('❌ 发布任务失败:', error);
      throw error;
    }
  }

  /**
   * 发布任务执行指令
   */
  publishExecution(executionData) {
    try {
      const buffer = protoHandler.createExecution(executionData);
      this.client.publish('/daf/mission/execution', buffer);
      console.log('✅ 执行指令已发布:', executionData);
    } catch (error) {
      console.error('❌ 发布执行指令失败:', error);
      throw error;
    }
  }

  /**
   * 发布起飞/降落指令
   */
  publishCommand(commandData) {
    try {
      const buffer = protoHandler.createCommand(commandData);
      this.client.publish('/daf/command', buffer);
      console.log('✅ 指令已发布:', commandData);
    } catch (error) {
      console.error('❌ 发布指令失败:', error);
      throw error;
    }
  }

  /**
   * 添加订阅者（WebSocket 客户端）
   */
  addSubscriber(ws) {
    this.subscribers.add(ws);
  }

  /**
   * 移除订阅者
   */
  removeSubscriber(ws) {
    this.subscribers.delete(ws);
  }

  /**
   * 广播消息给所有 WebSocket 客户端
   */
  broadcast(message) {
    const payload = JSON.stringify(message);
    this.subscribers.forEach(ws => {
      if (ws.readyState === 1) { // OPEN
        ws.send(payload);
      }
    });
  }

  /**
   * 获取连接状态
   */
  getStatus() {
    return {
      connected: this.connected,
      broker: `${config.mqtt.broker}:${config.mqtt.port}`,
      subscribers: this.subscribers.size
    };
  }

  /**
   * 设置探索引擎数据回调
   */
  setExplorationCallback(callback) {
    this.explorationCallback = callback;
  }
}

module.exports = new MqttClient();
