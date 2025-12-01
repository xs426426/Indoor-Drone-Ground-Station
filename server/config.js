module.exports = {
  // MQTT 连接配置
  mqtt: {
    broker: '10.42.0.1',  // 无人机默认 IP
    port: 1883,
    clientId: 'drone_web_control_' + Math.random().toString(16).substr(2, 8)
  },

  // WebSocket 配置
  websocket: {
    port: 8080
  },

  // HTTP 服务器配置
  http: {
    port: 3001
  },

  // 订阅的话题列表
  topics: [
    '/daf/pointcloud',
    '/daf/pointcloud_rgb',
    '/daf/local/odometry',
    '/daf/heartbeat',
    '/daf/camera',
    '/daf/mission/receipt'
  ]
};
