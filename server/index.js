const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const mqttClient = require('./mqtt-client');
const protoHandler = require('./proto-handler');
const ExplorationEngine = require('./exploration-engine');
const MissionRecorder = require('./mission-recorder');

// 预设航线数据文件路径
const PRESET_ROUTES_FILE = path.join(__dirname, 'data', 'preset-routes.json');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 创建探索引擎实例（先声明，启动后初始化）
let explorationEngine = null;

// 创建任务记录器实例
const missionRecorder = new MissionRecorder();

// 运行模式检测（检测是否有模拟器在同一broker上运行）
const DRONE_MODE = process.env.DRONE_MODE || 'auto'; // 'real', 'simulator', 'auto'

// 中间件
app.use(cors());
app.use(express.json());

// 静态文件服务 - 提供独立页面访问
app.use('/static', express.static(path.join(__dirname, 'public')));

// HTTP API 路由
app.get('/api/status', (req, res) => {
  res.json({
    mqtt: mqttClient.getStatus(),
    websocket: {
      clients: wss.clients.size
    },
    mode: DRONE_MODE,
    modeDescription: DRONE_MODE === 'real' ? '实机模式' :
                     DRONE_MODE === 'simulator' ? '模拟器模式' : '自动检测'
  });
});

// 发布任务
app.post('/api/mission', (req, res) => {
  try {
    mqttClient.publishMission(req.body);
    res.json({ success: true, message: '任务已下发' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 任务执行控制
app.post('/api/execution', (req, res) => {
  try {
    mqttClient.publishExecution(req.body);
    res.json({ success: true, message: '执行指令已发送' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 起飞/降落指令
app.post('/api/command', (req, res) => {
  try {
    mqttClient.publishCommand(req.body);
    res.json({ success: true, message: '指令已发送' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== MJPEG视频流 ==========
// 存储MJPEG流客户端
const mjpegClients = new Set();
let latestFrame = null;

// MJPEG流端点
app.get('/api/mjpeg', (req, res) => {
  console.log('📹 MJPEG客户端连接');

  res.setHeader('Content-Type', 'multipart/x-mixed-replace; boundary=frame');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  mjpegClients.add(res);

  // 如果有最新帧，立即发送
  if (latestFrame) {
    sendMjpegFrame(res, latestFrame);
  }

  req.on('close', () => {
    console.log('📹 MJPEG客户端断开');
    mjpegClients.delete(res);
  });
});

// 发送MJPEG帧
function sendMjpegFrame(res, frameData) {
  try {
    const buffer = Buffer.from(frameData, 'base64');
    res.write('--frame\r\n');
    res.write('Content-Type: image/jpeg\r\n');
    res.write(`Content-Length: ${buffer.length}\r\n\r\n`);
    res.write(buffer);
    res.write('\r\n');
  } catch (e) {
    // 客户端可能已断开
  }
}

// 广播帧到所有MJPEG客户端
function broadcastMjpegFrame(frameData) {
  latestFrame = frameData;
  mjpegClients.forEach(client => {
    sendMjpegFrame(client, frameData);
  });
}

// ========== 预设航线API ==========

// 获取所有预设航线列表
app.get('/api/preset-routes', (req, res) => {
  try {
    if (!fs.existsSync(PRESET_ROUTES_FILE)) {
      return res.json({ success: true, routes: {} });
    }
    const data = JSON.parse(fs.readFileSync(PRESET_ROUTES_FILE, 'utf-8'));
    // 返回航线列表（不包含完整航点数据，只返回名称和描述）
    const routeList = {};
    for (const [key, value] of Object.entries(data)) {
      routeList[key] = {
        name: value.name,
        description: value.description,
        waypointCount: value.waypoints?.length || 0
      };
    }
    res.json({ success: true, routes: routeList });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取指定预设航线的详细数据
app.get('/api/preset-routes/:routeId', (req, res) => {
  try {
    const { routeId } = req.params;
    if (!fs.existsSync(PRESET_ROUTES_FILE)) {
      return res.status(404).json({ success: false, error: '航线不存在' });
    }
    const data = JSON.parse(fs.readFileSync(PRESET_ROUTES_FILE, 'utf-8'));
    if (!data[routeId]) {
      return res.status(404).json({ success: false, error: '航线不存在' });
    }
    res.json({ success: true, route: data[routeId] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 保存/更新预设航线
app.post('/api/preset-routes/:routeId', (req, res) => {
  try {
    const { routeId } = req.params;
    const { name, description, waypoints } = req.body;

    // 确保data目录存在
    const dataDir = path.dirname(PRESET_ROUTES_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // 读取现有数据
    let data = {};
    if (fs.existsSync(PRESET_ROUTES_FILE)) {
      data = JSON.parse(fs.readFileSync(PRESET_ROUTES_FILE, 'utf-8'));
    }

    // 更新航线
    data[routeId] = {
      name: name || routeId,
      description: description || '',
      waypoints: waypoints || []
    };

    // 保存
    fs.writeFileSync(PRESET_ROUTES_FILE, JSON.stringify(data, null, 2), 'utf-8');

    res.json({ success: true, message: '航线已保存' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 删除预设航线
app.delete('/api/preset-routes/:routeId', (req, res) => {
  try {
    const { routeId } = req.params;
    if (!fs.existsSync(PRESET_ROUTES_FILE)) {
      return res.status(404).json({ success: false, error: '航线不存在' });
    }
    const data = JSON.parse(fs.readFileSync(PRESET_ROUTES_FILE, 'utf-8'));
    if (!data[routeId]) {
      return res.status(404).json({ success: false, error: '航线不存在' });
    }
    delete data[routeId];
    fs.writeFileSync(PRESET_ROUTES_FILE, JSON.stringify(data, null, 2), 'utf-8');
    res.json({ success: true, message: '航线已删除' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== 任务记录API ==========

// 获取任务记录列表
app.get('/api/missions', (req, res) => {
  try {
    const missions = missionRecorder.getMissionList();
    res.json({ success: true, missions, total: missions.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取任务记录详情（包含轨迹和点云数据）
app.get('/api/missions/:timestamp', (req, res) => {
  try {
    const result = missionRecorder.getMissionDetail(req.params.timestamp);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取任务视频帧列表
app.get('/api/missions/:timestamp/frames', (req, res) => {
  try {
    const result = missionRecorder.getMissionFrames(req.params.timestamp);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取单个视频帧
app.get('/api/missions/:timestamp/frames/:filename', (req, res) => {
  try {
    const frame = missionRecorder.getFrame(req.params.timestamp, req.params.filename);
    if (frame) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.send(frame);
    } else {
      res.status(404).json({ success: false, error: '帧不存在' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 删除任务记录
app.delete('/api/missions/:timestamp', (req, res) => {
  try {
    const result = missionRecorder.deleteMission(req.params.timestamp);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取当前记录状态
app.get('/api/missions/recording/status', (req, res) => {
  try {
    const status = missionRecorder.getRecordingStatus();
    res.json({ success: true, ...status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 手动停止记录
app.post('/api/missions/recording/stop', (req, res) => {
  try {
    const result = missionRecorder.stopRecording();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== 探索相关API ==========

// 启动探索
app.post('/api/exploration/start', async (req, res) => {
  try {
    const result = await explorationEngine.startExploration(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 暂停探索
app.post('/api/exploration/pause', (req, res) => {
  try {
    const result = explorationEngine.pauseExploration();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 恢复探索
app.post('/api/exploration/resume', (req, res) => {
  try {
    const result = explorationEngine.resumeExploration();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 停止探索
app.post('/api/exploration/stop', (req, res) => {
  try {
    const result = explorationEngine.stopExploration();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取探索状态
app.get('/api/exploration/status', (req, res) => {
  try {
    const status = explorationEngine.publishExplorationStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取地图数据
app.get('/api/exploration/map', (req, res) => {
  try {
    const mapData = explorationEngine.getMapData();
    res.json(mapData);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 重置探索引擎
app.post('/api/exploration/reset', (req, res) => {
  try {
    explorationEngine.reset();
    res.json({ success: true, message: '探索引擎已重置' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 设置ROI探索区域
app.post('/api/exploration/roi/set', (req, res) => {
  try {
    const { polygon } = req.body;
    if (!polygon || !Array.isArray(polygon)) {
      return res.status(400).json({
        success: false,
        message: 'polygon参数必须是数组，例如: [{x: 0, y: 0}, {x: 5, y: 0}, {x: 5, y: 5}, {x: 0, y: 5}]'
      });
    }
    const result = explorationEngine.setROI(polygon);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 清除ROI限制
app.post('/api/exploration/roi/clear', (req, res) => {
  try {
    const result = explorationEngine.clearROI();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 设置评分权重
app.post('/api/exploration/weights/set', (req, res) => {
  try {
    const weights = req.body;
    const result = explorationEngine.setScoringWeights(weights);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取当前评分权重
app.get('/api/exploration/weights', (req, res) => {
  try {
    const weights = explorationEngine.getScoringWeights();
    res.json({ success: true, weights });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// WebSocket 连接处理
wss.on('connection', (ws) => {
  console.log('🌐 WebSocket 客户端已连接');

  // 初始化心跳状态
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // 添加到订阅者列表
  mqttClient.addSubscriber(ws);

  // 发送连接成功消息
  ws.send(JSON.stringify({
    type: 'connection',
    status: 'connected',
    timestamp: Date.now()
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleWebSocketMessage(ws, data);
    } catch (error) {
      console.error('WebSocket 消息处理失败:', error);
    }
  });

  ws.on('close', () => {
    console.log('🌐 WebSocket 客户端已断开');
    mqttClient.removeSubscriber(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket 错误:', error);
  });

  // 如果探索引擎已初始化，发送当前状态
  if (explorationEngine) {
    try {
      const status = explorationEngine.publishExplorationStatus();
      ws.send(JSON.stringify({
        type: 'exploration_status',
        data: status
      }));
    } catch (error) {
      // 初始化时可能还没有数据，忽略错误
    }
  }
});

// WebSocket 心跳检测 (每30秒检查一次)
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log('💔 客户端心跳超时，终止连接');
      return ws.terminate();
    }

    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// 服务器关闭时清理心跳定时器
wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

/**
 * 处理 WebSocket 客户端消息
 */
async function handleWebSocketMessage(ws, data) {
  const { type, payload } = data;

  // 只记录非ping消息，减少日志输出
  if (type !== 'ping') {
    console.log('📥 收到 WebSocket 消息:', type, payload);
  }

  switch (type) {
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      break;

    case 'publish_mission':
      console.log('📋 发布任务:', payload);
      // 启动任务记录
      if (payload && payload.id) {
        const waypointCount = payload.tasks ? payload.tasks.filter(t => t.autoPilot).length : 0;
        missionRecorder.startRecording(payload.id, {
          waypoints: payload.tasks,
          waypointCount
        });
      }
      mqttClient.publishMission(payload);
      break;

    case 'publish_execution':
      console.log('▶️ 发布执行指令:', payload);
      // 如果是停止任务，停止记录
      if (payload && payload.action === 'STOP') {
        missionRecorder.stopRecording();
      }
      mqttClient.publishExecution(payload);
      break;

    case 'publish_command':
      console.log('🎮 发布控制指令:', payload);
      mqttClient.publishCommand(payload);
      break;

    // ========== 探索相关WebSocket消息 ==========
    case 'start_exploration':
      console.log('🧭 启动探索:', payload);
      if (explorationEngine) {
        try {
          const result = await explorationEngine.startExploration(payload || {});
          ws.send(JSON.stringify({
            type: 'exploration_response',
            data: result
          }));
        } catch (error) {
          ws.send(JSON.stringify({
            type: 'exploration_response',
            data: { success: false, message: error.message }
          }));
        }
      } else {
        ws.send(JSON.stringify({
          type: 'exploration_response',
          data: { success: false, message: '探索引擎未初始化' }
        }));
      }
      break;

    case 'stop_exploration':
      console.log('🛑 停止探索');
      if (explorationEngine) {
        try {
          const result = explorationEngine.stopExploration();
          ws.send(JSON.stringify({
            type: 'exploration_response',
            data: result
          }));
        } catch (error) {
          ws.send(JSON.stringify({
            type: 'exploration_response',
            data: { success: false, message: error.message }
          }));
        }
      }
      break;

    case 'pause_exploration':
      console.log('⏸️ 暂停探索');
      if (explorationEngine) {
        try {
          const result = explorationEngine.pauseExploration();
          ws.send(JSON.stringify({
            type: 'exploration_response',
            data: result
          }));
        } catch (error) {
          ws.send(JSON.stringify({
            type: 'exploration_response',
            data: { success: false, message: error.message }
          }));
        }
      }
      break;

    case 'resume_exploration':
      console.log('▶️ 恢复探索');
      if (explorationEngine) {
        try {
          const result = explorationEngine.resumeExploration();
          ws.send(JSON.stringify({
            type: 'exploration_response',
            data: result
          }));
        } catch (error) {
          ws.send(JSON.stringify({
            type: 'exploration_response',
            data: { success: false, message: error.message }
          }));
        }
      }
      break;

    case 'get_exploration_map':
      console.log('🗺️ 获取探索地图');
      if (explorationEngine) {
        try {
          const mapData = explorationEngine.getMapData();
          ws.send(JSON.stringify({
            type: 'exploration_map',
            data: mapData
          }));
        } catch (error) {
          ws.send(JSON.stringify({
            type: 'exploration_map',
            data: { success: false, message: error.message }
          }));
        }
      }
      break;

    default:
      console.warn('未知的 WebSocket 消息类型:', type);
  }
}

/**
 * 广播消息到所有WebSocket客户端
 */
function broadcastToAll(message) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify(message));
      } catch (error) {
        console.error('广播消息失败:', error);
      }
    }
  });
}

/**
 * 启动服务器
 */
async function start() {
  try {
    console.log('🚀 启动无人机网页控制系统...');

    // 1. 初始化 Protobuf
    await protoHandler.init();

    // 2. 连接 MQTT（异步，失败不阻止服务器启动）
    mqttClient.connect().catch(err => {
      console.warn('⚠️ MQTT初始连接失败，将自动重连:', err.message);
    });

    // 3. 初始化探索引擎
    explorationEngine = new ExplorationEngine(mqttClient);
    console.log('🧭 探索引擎已初始化');

    // 4. 监听探索引擎事件
    explorationEngine.on('exploration:started', (data) => {
      console.log('🚀 探索已启动:', data);
      broadcastToAll({
        type: 'exploration_status',
        data: { isExploring: true, ...data }
      });
    });

    explorationEngine.on('exploration:stopped', (data) => {
      console.log('🛑 探索已停止:', data);
      broadcastToAll({
        type: 'exploration_status',
        data: { isExploring: false, ...data }
      });
    });

    explorationEngine.on('exploration:paused', () => {
      console.log('⏸️ 探索已暂停');
      broadcastToAll({
        type: 'exploration_status',
        data: { isPaused: true }
      });
    });

    explorationEngine.on('exploration:resumed', () => {
      console.log('▶️ 探索已恢复');
      broadcastToAll({
        type: 'exploration_status',
        data: { isPaused: false }
      });
    });

    explorationEngine.on('exploration:status', (status) => {
      // 定期广播探索状态
      broadcastToAll({
        type: 'exploration_status',
        data: status
      });
    });

    // 5. 连接MQTT数据到探索引擎和任务记录器（通过回调）
    mqttClient.setExplorationCallback((dataType, data) => {
      // 探索引擎处理
      if (explorationEngine) {
        if (dataType === 'pointcloud') {
          explorationEngine.onPointCloudReceived(data);
        } else if (dataType === 'odometry') {
          explorationEngine.onOdometryReceived(data);
        }
      }

      // 任务记录器处理
      if (missionRecorder.isRecording) {
        if (dataType === 'pointcloud') {
          missionRecorder.recordPointCloud(data);
        } else if (dataType === 'odometry') {
          missionRecorder.recordTrajectory(data);
        }
      }
    });

    // 6. 连接MQTT摄像头数据到MJPEG流和任务记录器
    mqttClient.setCameraCallback((frameData) => {
      broadcastMjpegFrame(frameData);

      // 任务记录器保存视频帧
      if (missionRecorder.isRecording) {
        missionRecorder.recordVideoFrame(frameData);
      }
    });

    // 7. 连接MQTT任务回执到任务记录器（任务完成时自动停止记录）
    mqttClient.setMissionReceiptCallback((receiptData) => {
      console.log('📋 收到任务回执:', receiptData);
      // 当任务完成（状态为COMPLETED或STOPPED）时，停止记录
      if (receiptData && (receiptData.status === 'COMPLETED' || receiptData.status === 'STOPPED' || receiptData.status === 2 || receiptData.status === 3)) {
        if (missionRecorder.isRecording) {
          console.log('📹 任务完成，停止记录');
          missionRecorder.stopRecording();
        }
      }
    });

    // 8. 启动 HTTP + WebSocket 服务器
    server.listen(config.http.port, () => {
      console.log('');
      console.log('✅ 服务器启动成功!');
      console.log(`📡 HTTP API: http://localhost:${config.http.port}`);
      console.log(`🌐 WebSocket: ws://localhost:${config.http.port}`);
      console.log(`🚁 MQTT Broker: ${config.mqtt.broker}:${config.mqtt.port}`);
      console.log('🧭 探索引擎: 已就绪');
      console.log('');
      console.log('💡 提示: 确保已连接到无人机热点 (10.42.0.1)');
      console.log('');
    });
  } catch (error) {
    console.error('❌ 启动失败:', error);
    process.exit(1);
  }
}

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n👋 正在关闭服务器...');

  // 停止探索引擎
  if (explorationEngine) {
    try {
      explorationEngine.stopExploration();
      console.log('🛑 探索引擎已停止');
    } catch (error) {
      console.error('停止探索引擎失败:', error);
    }
  }

  server.close(() => {
    mqttClient.client?.end();
    process.exit(0);
  });
});

// 启动
start();
