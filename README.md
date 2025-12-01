# 无人机网页端上位机

基于 MQTT + Protobuf + WebSocket 的无人机网页控制系统

## 功能特性

- ✅ 实时接收无人机数据（点云、位姿、图像、心跳）
- ✅ 3D 点云可视化（Three.js）
- ✅ 无人机状态监控
- ✅ 航点任务下发
- ✅ 起飞/降落控制

## 技术栈

**后端**
- Node.js
- MQTT.js - 连接无人机 broker
- Protobuf.js - 解析二进制数据
- WebSocket - 实时推送

**前端**
- React
- Three.js - 3D 渲染
- Ant Design - UI 组件
- Recharts - 数据图表

## 快速开始

### 1. 安装依赖

```bash
npm run install-all
```

### 2. 编译 Protobuf

```bash
npm run proto
```

### 3. 启动服务

```bash
npm start
```

访问: http://localhost:3000

## 配置

编辑 `server/config.js` 修改无人机连接信息：

```javascript
module.exports = {
  mqtt: {
    broker: '10.42.0.1',  // 无人机 IP
    port: 1883
  }
};
```

## 目录结构

```
drone-web-control/
├── server/              # Node.js 后端
│   ├── index.js         # 服务器入口
│   ├── mqtt-client.js   # MQTT 连接
│   ├── proto-handler.js # Protobuf 解析
│   └── config.js        # 配置文件
├── client/              # React 前端
│   ├── src/
│   │   ├── components/  # UI 组件
│   │   ├── services/    # WebSocket 服务
│   │   └── App.js       # 主应用
│   └── package.json
├── proto/               # Protobuf 定义
└── scripts/             # 编译脚本
```

## 订阅的话题

- `/daf/pointcloud` - 深度点云
- `/daf/pointcloud_rgb` - RGB 点云
- `/daf/local/odometry` - 位姿里程计
- `/daf/heartbeat` - 心跳包
- `/daf/camera` - 摄像头图像
- `/daf/mission/receipt` - 任务回执

## 发布的话题

- `/daf/mission` - 航点任务
- `/daf/mission/execution` - 任务执行
- `/daf/command` - 起飞降落指令
