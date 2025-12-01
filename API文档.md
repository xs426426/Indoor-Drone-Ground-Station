# 🚁 无人机控制系统 API 文档

**版本**: v3.2.1.1
**日期**: 2025-01-27
**基础URL**: `http://localhost:3001`
**WebSocket**: `ws://localhost:3001`

---

## 📑 目录

1. [系统状态API](#1-系统状态api)
2. [无人机控制API](#2-无人机控制api)
3. [探索引擎API](#3-探索引擎api)
4. [WebSocket API](#4-websocket-api)
5. [数据结构](#5-数据结构)
6. [错误码](#6-错误码)

---

## 1. 系统状态API

### 1.1 获取系统状态

获取MQTT连接状态、WebSocket客户端数量、运行模式等信息

**请求**:
```http
GET /api/status
```

**响应**:
```json
{
  "mqtt": {
    "connected": true,
    "broker": "mqtt://10.42.0.1:1883",
    "topics": [
      "/daf/pointcloud",
      "/daf/pointcloud_rgb",
      "/daf/local/odometry",
      "/daf/heartbeat",
      "/daf/camera",
      "/daf/mission/receipt"
    ]
  },
  "websocket": {
    "clients": 2
  },
  "mode": "real",
  "modeDescription": "实机模式"
}
```

**字段说明**:
- `mqtt.connected`: MQTT连接状态
- `mqtt.broker`: MQTT broker地址
- `mqtt.topics`: 已订阅的MQTT主题列表
- `websocket.clients`: 当前连接的WebSocket客户端数量
- `mode`: 运行模式 (`real` | `simulator` | `auto`)
- `modeDescription`: 模式描述（中文）

---

## 2. 无人机控制API

### 2.1 发布任务

发布飞行任务到无人机

**请求**:
```http
POST /api/mission
Content-Type: application/json
```

**请求体**:
```json
{
  "id": "mission_001",
  "type": "waypoint",
  "waypoints": [
    { "x": 0, "y": 0, "z": 1.5 },
    { "x": 5, "y": 0, "z": 1.5 },
    { "x": 5, "y": 5, "z": 1.5 }
  ],
  "speed": 0.5
}
```

**响应**:
```json
{
  "success": true,
  "message": "任务已下发"
}
```

**MQTT发布**:
- **主题**: `/daf/mission`
- **Protobuf**: `MissionList`

---

### 2.2 任务执行控制

控制任务的执行（开始/暂停/恢复/取消）

**请求**:
```http
POST /api/execution
Content-Type: application/json
```

**请求体**:
```json
{
  "mission_id": "mission_001",
  "action": "start"
}
```

**action可选值**:
- `start`: 开始执行
- `pause`: 暂停执行
- `resume`: 恢复执行
- `cancel`: 取消执行

**响应**:
```json
{
  "success": true,
  "message": "执行指令已发送"
}
```

**MQTT发布**:
- **主题**: `/daf/mission/execution`
- **Protobuf**: `MissionExecution`

---

### 2.3 发送控制指令

发送起飞、降落等控制指令

**请求**:
```http
POST /api/command
Content-Type: application/json
```

**请求体示例**:

**起飞**:
```json
{
  "command": "takeoff",
  "altitude": 1.5
}
```

**降落**:
```json
{
  "command": "land"
}
```

**紧急停止**:
```json
{
  "command": "emergency_stop"
}
```

**响应**:
```json
{
  "success": true,
  "message": "指令已发送"
}
```

**MQTT发布**:
- **主题**: `/daf/command`
- **Protobuf**: `Command`

---

## 3. 探索引擎API

### 3.1 启动探索

启动自主探索任务

**请求**:
```http
POST /api/exploration/start
Content-Type: application/json
```

**请求体（可选）**:
```json
{
  "startPosition": {
    "x": 0,
    "y": 0,
    "z": 1.5
  },
  "maxDistance": 20,
  "explorationHeight": 1.5
}
```

**字段说明**:
- `startPosition`: 探索起点（默认当前位置）
- `maxDistance`: 最大探索距离（米，默认20）
- `explorationHeight`: 探索高度（米，默认1.5）

**响应**:
```json
{
  "success": true,
  "message": "探索已启动",
  "isExploring": true,
  "startPosition": { "x": 0, "y": 0, "z": 1.5 }
}
```

**错误响应**:
```json
{
  "success": false,
  "message": "探索已在进行中"
}
```

---

### 3.2 暂停探索

暂停当前探索任务（保留状态）

**请求**:
```http
POST /api/exploration/pause
```

**响应**:
```json
{
  "success": true,
  "message": "探索已暂停",
  "isExploring": false,
  "isPaused": true
}
```

---

### 3.3 恢复探索

恢复已暂停的探索任务

**请求**:
```http
POST /api/exploration/resume
```

**响应**:
```json
{
  "success": true,
  "message": "探索已恢复",
  "isExploring": true,
  "isPaused": false
}
```

---

### 3.4 停止探索

完全停止探索任务（清除状态）

**请求**:
```http
POST /api/exploration/stop
```

**响应**:
```json
{
  "success": true,
  "message": "探索已停止",
  "isExploring": false,
  "isPaused": false
}
```

---

### 3.5 获取探索状态

获取当前探索任务的详细状态

**请求**:
```http
GET /api/exploration/status
```

**响应**:
```json
{
  "isExploring": true,
  "isPaused": false,
  "exploredArea": 45.6,
  "totalArea": 400,
  "progress": 11.4,
  "frontierCount": 12,
  "unreachableCount": 3,
  "duration": 125000,
  "currentPosition": { "x": 3.2, "y": 4.5, "z": 1.5 },
  "startPosition": { "x": 0, "y": 0, "z": 1.5 },
  "distanceFromStart": 5.5,
  "currentGoal": { "x": 5.0, "y": 6.0, "z": 1.5 },
  "sceneBounds": {
    "minX": -0.83,
    "maxX": 3.75,
    "minY": -0.47,
    "maxY": 6.03,
    "minZ": 0.5,
    "maxZ": 2.5
  }
}
```

**字段说明**:
- `isExploring`: 是否正在探索
- `isPaused`: 是否已暂停
- `exploredArea`: 已探索面积（m²）
- `totalArea`: 总可探索面积（m²）
- `progress`: 探索进度（%）
- `frontierCount`: 当前前沿点数量
- `unreachableCount`: 不可达区域数量
- `duration`: 探索时长（毫秒）
- `currentPosition`: 当前无人机位置
- `startPosition`: 探索起点
- `distanceFromStart`: 距起点距离（米）
- `currentGoal`: 当前目标点
- `sceneBounds`: 场景边界（安全范围）

---

### 3.6 获取地图数据

获取探索生成的栅格地图数据

**请求**:
```http
GET /api/exploration/map
```

**响应**:
```json
{
  "grid": [[0, 0, 1, 1], [0, -1, 1, 1]],
  "width": 80,
  "height": 80,
  "resolution": 0.5,
  "origin": { "x": -20, "y": -20 },
  "exploredArea": 45.6,
  "occupiedCells": 234,
  "freeCells": 1824,
  "unknownCells": 5342
}
```

**字段说明**:
- `grid`: 2D栅格数组（0=自由, 1=占用, -1=未知）
- `width`: 地图宽度（格子数）
- `height`: 地图高度（格子数）
- `resolution`: 分辨率（米/格子，默认0.5）
- `origin`: 地图原点坐标
- `exploredArea`: 已探索面积
- `occupiedCells`: 占用格子数
- `freeCells`: 自由格子数
- `unknownCells`: 未知格子数

---

### 3.7 重置探索引擎

清空所有探索数据，重置到初始状态

**请求**:
```http
POST /api/exploration/reset
```

**响应**:
```json
{
  "success": true,
  "message": "探索引擎已重置"
}
```

---

### 3.8 设置ROI探索区域

限制探索范围到指定多边形区域内

**请求**:
```http
POST /api/exploration/roi/set
Content-Type: application/json
```

**请求体**:
```json
{
  "polygon": [
    { "x": 0, "y": 0 },
    { "x": 5, "y": 0 },
    { "x": 5, "y": 5 },
    { "x": 0, "y": 5 }
  ]
}
```

**响应**:
```json
{
  "success": true,
  "message": "ROI探索区域已设置",
  "polygon": [
    { "x": 0, "y": 0 },
    { "x": 5, "y": 0 },
    { "x": 5, "y": 5 },
    { "x": 0, "y": 5 }
  ]
}
```

**注意事项**:
- 多边形顶点按逆时针或顺时针顺序提供
- 至少需要3个顶点
- 只在XY平面生效（Z轴不受限制）

---

### 3.9 清除ROI限制

移除ROI限制，恢复全场景探索

**请求**:
```http
POST /api/exploration/roi/clear
```

**响应**:
```json
{
  "success": true,
  "message": "ROI探索区域已清除"
}
```

---

### 3.10 设置评分权重

自定义前沿点评分算法的权重

**请求**:
```http
POST /api/exploration/weights/set
Content-Type: application/json
```

**请求体**:
```json
{
  "distance": 0.3,
  "density": 0.2,
  "yaw": 0.1,
  "roi": 0.4
}
```

**字段说明**:
- `distance`: 距离权重（0-1，默认0.3）
  - 越近的前沿点得分越高
- `density`: 密度权重（0-1，默认0.2）
  - 前沿点周围未知区域越多得分越高
- `yaw`: 航向权重（0-1，默认0.1）
  - 航向变化越小得分越高
- `roi`: ROI权重（0-1，默认0.4）
  - 在ROI区域内的前沿点得分更高

**响应**:
```json
{
  "success": true,
  "message": "评分权重已更新",
  "weights": {
    "distance": 0.3,
    "density": 0.2,
    "yaw": 0.1,
    "roi": 0.4
  }
}
```

**注意**: 权重总和不必为1，系统会自动归一化

---

### 3.11 获取评分权重

获取当前的评分权重配置

**请求**:
```http
GET /api/exploration/weights
```

**响应**:
```json
{
  "success": true,
  "weights": {
    "distance": 0.3,
    "density": 0.2,
    "yaw": 0.1,
    "roi": 0.4
  }
}
```

---

## 4. WebSocket API

### 4.1 连接

**URL**: `ws://localhost:3001`

**连接成功后服务器响应**:
```json
{
  "type": "connection",
  "status": "connected",
  "timestamp": 1706345678900
}
```

---

### 4.2 心跳检测

**客户端发送**:
```json
{
  "type": "ping"
}
```

**服务器响应**:
```json
{
  "type": "pong",
  "timestamp": 1706345678900
}
```

**心跳频率**: 建议每10-30秒发送一次

---

### 4.3 订阅MQTT数据

WebSocket连接后，服务器会自动推送所有MQTT消息

**消息类型**:

#### 4.3.1 心跳数据
```json
{
  "type": "/daf/heartbeat",
  "data": {
    "seqenceId": 12345,
    "timestamp": 1706345678900,
    "flightControl": {
      "mode": "HOVER",
      "armed": true
    },
    "battery": {
      "voltage": 12.6,
      "percentage": 85
    }
  }
}
```

#### 4.3.2 位姿数据
```json
{
  "type": "/daf/local/odometry",
  "data": {
    "stamp": { "sec": 1706345678, "nsec": 900000000 },
    "position": { "x": 1.23, "y": 2.45, "z": 1.50 },
    "orientation": { "x": 0, "y": 0, "z": 0, "w": 1 },
    "velocity": { "x": 0.1, "y": 0.0, "z": 0.0 }
  }
}
```

#### 4.3.3 点云数据
```json
{
  "type": "/daf/pointcloud",
  "data": {
    "stamp": { "sec": 1706345678, "nsec": 900000000 },
    "points": [
      { "xyz": { "x": 1.0, "y": 2.0, "z": 1.5 }, "intensity": 128 },
      { "xyz": { "x": 1.1, "y": 2.1, "z": 1.5 }, "intensity": 156 }
    ]
  }
}
```

#### 4.3.4 摄像头数据
```json
{
  "type": "/daf/camera",
  "data": {
    "data": "<base64编码的图像数据>",
    "width": 640,
    "height": 480,
    "encoding": "rgb8"
  }
}
```

---

### 4.4 发布MQTT消息

通过WebSocket发布MQTT消息（等同于HTTP API）

#### 4.4.1 发布任务
```json
{
  "type": "publish_mission",
  "payload": {
    "id": "mission_001",
    "type": "waypoint",
    "waypoints": [
      { "x": 0, "y": 0, "z": 1.5 }
    ]
  }
}
```

#### 4.4.2 发布执行指令
```json
{
  "type": "publish_execution",
  "payload": {
    "mission_id": "mission_001",
    "action": "start"
  }
}
```

#### 4.4.3 发布控制指令
```json
{
  "type": "publish_command",
  "payload": {
    "command": "takeoff",
    "altitude": 1.5
  }
}
```

---

### 4.5 探索控制（WebSocket）

通过WebSocket控制探索引擎

#### 4.5.1 启动探索
```json
{
  "type": "start_exploration",
  "payload": {
    "startPosition": { "x": 0, "y": 0, "z": 1.5 }
  }
}
```

**服务器响应**:
```json
{
  "type": "exploration_response",
  "data": {
    "success": true,
    "message": "探索已启动"
  }
}
```

#### 4.5.2 停止探索
```json
{
  "type": "stop_exploration"
}
```

#### 4.5.3 暂停探索
```json
{
  "type": "pause_exploration"
}
```

#### 4.5.4 恢复探索
```json
{
  "type": "resume_exploration"
}
```

---

### 4.6 探索状态推送

探索引擎每2秒自动推送探索状态

```json
{
  "type": "exploration_status",
  "data": {
    "isExploring": true,
    "exploredArea": 45.6,
    "progress": 11.4,
    "frontierCount": 12,
    "duration": 125000,
    "currentPosition": { "x": 3.2, "y": 4.5, "z": 1.5 }
  }
}
```

---

## 5. 数据结构

### 5.1 Position（位置）
```typescript
interface Position {
  x: number;  // X坐标（米）
  y: number;  // Y坐标（米）
  z: number;  // Z坐标（米）
}
```

### 5.2 Orientation（姿态）
```typescript
interface Orientation {
  x: number;  // 四元数X
  y: number;  // 四元数Y
  z: number;  // 四元数Z
  w: number;  // 四元数W
}
```

### 5.3 Waypoint（航点）
```typescript
interface Waypoint {
  x: number;       // X坐标（米）
  y: number;       // Y坐标（米）
  z: number;       // Z坐标（米）
  yaw?: number;    // 航向角（弧度）
  speed?: number;  // 速度（m/s）
}
```

### 5.4 Mission（任务）
```typescript
interface Mission {
  id: string;              // 任务ID
  type: 'waypoint' | 'survey' | 'orbit';  // 任务类型
  waypoints: Waypoint[];   // 航点列表
  speed?: number;          // 默认速度（m/s）
  loop?: boolean;          // 是否循环
}
```

### 5.5 PointCloudPoint（点云点）
```typescript
interface PointCloudPoint {
  xyz: Position;     // 3D坐标
  intensity: number; // 强度值（0-255）
}
```

### 5.6 SceneBounds（场景边界）
```typescript
interface SceneBounds {
  minX: number;  // X轴最小值
  maxX: number;  // X轴最大值
  minY: number;  // Y轴最小值
  maxY: number;  // Y轴最大值
  minZ: number;  // Z轴最小值
  maxZ: number;  // Z轴最大值
}
```

---

## 6. 错误码

### HTTP状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 成功 |
| 400 | 请求参数错误 |
| 500 | 服务器内部错误 |

### 错误响应格式

```json
{
  "success": false,
  "error": "错误详细信息"
}
```

### 常见错误信息

| 错误信息 | 原因 | 解决方法 |
|----------|------|----------|
| `探索已在进行中` | 重复启动探索 | 先停止当前探索再启动新的 |
| `探索未启动` | 暂停/恢复/停止未启动的探索 | 先启动探索 |
| `polygon参数必须是数组` | ROI参数格式错误 | 检查请求体格式 |
| `探索引擎未初始化` | 服务器启动时初始化失败 | 重启服务器 |
| `MQTT连接失败` | 无法连接到MQTT broker | 检查网络和broker地址 |

---

## 7. 使用示例

### 7.1 启动完整探索流程

```javascript
// 1. 检查系统状态
const status = await fetch('http://localhost:3001/api/status').then(r => r.json());
console.log('系统状态:', status);

// 2. 设置ROI探索区域（可选）
await fetch('http://localhost:3001/api/exploration/roi/set', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    polygon: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 }
    ]
  })
});

// 3. 设置评分权重（可选）
await fetch('http://localhost:3001/api/exploration/weights/set', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    distance: 0.3,
    density: 0.2,
    yaw: 0.1,
    roi: 0.4
  })
});

// 4. 启动探索
const result = await fetch('http://localhost:3001/api/exploration/start', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    startPosition: { x: 0, y: 0, z: 1.5 },
    maxDistance: 20,
    explorationHeight: 1.5
  })
}).then(r => r.json());

console.log('探索启动:', result);

// 5. 定期查询探索状态
setInterval(async () => {
  const status = await fetch('http://localhost:3001/api/exploration/status').then(r => r.json());
  console.log(`探索进度: ${status.progress.toFixed(1)}%`);

  if (!status.isExploring) {
    console.log('探索已完成');
  }
}, 5000);
```

### 7.2 WebSocket实时监控

```javascript
const ws = new WebSocket('ws://localhost:3001');

ws.onopen = () => {
  console.log('WebSocket已连接');

  // 发送心跳
  setInterval(() => {
    ws.send(JSON.stringify({ type: 'ping' }));
  }, 10000);
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);

  switch (message.type) {
    case 'connection':
      console.log('连接成功:', message);
      break;

    case '/daf/local/odometry':
      console.log('位姿:', message.data.position);
      break;

    case '/daf/pointcloud':
      console.log('点云点数:', message.data.points?.length);
      break;

    case 'exploration_status':
      console.log('探索进度:', message.data.progress);
      break;

    case 'pong':
      console.log('心跳响应');
      break;
  }
};

ws.onerror = (error) => {
  console.error('WebSocket错误:', error);
};

ws.onclose = () => {
  console.log('WebSocket已断开');
};
```

---

## 8. 配置说明

### 8.1 环境变量

| 变量名 | 说明 | 默认值 | 可选值 |
|--------|------|--------|--------|
| `DRONE_MODE` | 运行模式 | `auto` | `real`, `simulator`, `auto` |

**设置方法**:

Windows:
```bash
set DRONE_MODE=real
npm start
```

Linux/Mac:
```bash
export DRONE_MODE=real
npm start
```

### 8.2 探索引擎参数

| 参数 | 说明 | 默认值 | 可配置范围 |
|------|------|--------|-----------|
| 最大探索距离 | 从起点的最大距离 | 20m | 5-50m |
| 探索高度 | 无人机飞行高度 | 1.5m | 0.5-3.0m |
| 地图分辨率 | 栅格地图精度 | 0.5m/格 | 0.1-1.0m/格 |
| 聚类半径 | 前沿点聚类距离 | 1.0m | 0.5-2.0m |
| 边界收缩 | 场景边界收缩距离 | 1.5m | 1.0-2.5m |
| 窗户检测阈值 | 启用窗户检测的面积 | 50m² | 30-100m² |

---

## 9. 版本历史

### v3.2.1.1 (2025-01-27)
- ✅ 优化WebSocket ping日志（移除高频输出）
- ✅ 优化点云累积算法（O(n) → O(1)）
- ✅ 移除前端高频日志
- ✅ 性能大幅提升

### v3.2.1 (2025-01-27)
- ✅ 添加DRONE_MODE环境变量
- ✅ 创建实机/模拟器启动脚本
- ✅ 前端显示运行模式
- ✅ 点云累积改为点数限制

### v3.2 (2025-01-26)
- ✅ 前端实时数据显示
- ✅ 修复位姿显示逻辑

### v3.1 (2025-01-25)
- ✅ 修复Z字形脱困问题
- ✅ 添加返航完成检测
- ✅ 窗户安全保护
- ✅ 探索进度实时推送

### v3.0 (2025-01-24)
- ✅ 探索引擎核心功能
- ✅ ROI区域限制
- ✅ 评分权重自定义
- ✅ WebSocket实时通信

---

## 10. 技术支持

**文档**:
- [优化总结.md](优化总结.md) - 系统优化记录
- [启动模式说明.md](启动模式说明.md) - 启动指南
- [延时问题诊断.md](延时问题诊断.md) - 性能诊断

**快速开始**:
1. 双击 `restart-clean.bat` 清理并启动
2. 或使用 `start-real.bat` (实机) / `start-simulator.bat` (模拟器)
3. 浏览器访问 `http://localhost:3000`

---

**最后更新**: 2025-01-27
**文档版本**: v3.2.1.1
