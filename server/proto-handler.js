const protobuf = require('protobufjs');
const path = require('path');

class ProtoHandler {
  constructor() {
    this.root = null;
    this.types = {};
  }

  async init() {
    try {
      // 加载所有 proto 文件
      const protoPath = path.join(__dirname, '../proto');
      this.root = await protobuf.load([
        path.join(protoPath, 'common.proto'),
        path.join(protoPath, 'pointcloud.proto'),
        path.join(protoPath, 'drone.proto'),
        path.join(protoPath, 'mission.proto'),
        path.join(protoPath, 'image.proto'),
        path.join(protoPath, 'control.proto'),
        path.join(protoPath, 'camera.proto')
      ]);

      // 缓存消息类型
      this.types = {
        PointCloud: this.root.lookupType('daf.PointCloud'),
        LocalOdometry: this.root.lookupType('daf.LocalOdometry'),
        Heartbeat: this.root.lookupType('daf.Heartbeat'),
        Image: this.root.lookupType('daf.Image'),
        Mission: this.root.lookupType('daf.mission.Mission'),
        Execution: this.root.lookupType('daf.mission.Execution'),
        Receipt: this.root.lookupType('daf.mission.Receipt'),
        Command: this.root.lookupType('daf.Command')
      };

      console.log('✅ Protobuf 文件加载成功');
    } catch (error) {
      console.error('❌ Protobuf 加载失败:', error);
      throw error;
    }
  }

  /**
   * 根据话题名称解码消息
   */
  decode(topic, buffer) {
    try {
      let messageType;

      switch (topic) {
        case '/daf/pointcloud':
        case '/daf/pointcloud_rgb':
          messageType = this.types.PointCloud;
          break;
        case '/daf/local/odometry':
          messageType = this.types.LocalOdometry;
          break;
        case '/daf/heartbeat':
          messageType = this.types.Heartbeat;
          break;
        case '/daf/camera':
          messageType = this.types.Image;
          break;
        case '/daf/mission':
          messageType = this.types.Mission;
          break;
        case '/daf/mission/execution':
          messageType = this.types.Execution;
          break;
        case '/daf/mission/receipt':
          messageType = this.types.Receipt;
          break;
        default:
          console.warn(`未知话题: ${topic}`);
          return null;
      }

      const message = messageType.decode(buffer);
      return messageType.toObject(message, {
        longs: String,
        enums: String,
        bytes: String,
        defaults: true
      });
    } catch (error) {
      console.error(`解码失败 [${topic}]:`, error);
      return null;
    }
  }

  /**
   * 编码消息用于发布
   */
  encode(type, data) {
    try {
      const messageType = this.types[type];
      if (!messageType) {
        throw new Error(`未知消息类型: ${type}`);
      }

      const errMsg = messageType.verify(data);
      if (errMsg) {
        throw new Error(`验证失败: ${errMsg}`);
      }

      const message = messageType.create(data);
      return messageType.encode(message).finish();
    } catch (error) {
      console.error(`编码失败 [${type}]:`, error);
      throw error;
    }
  }

  /**
   * 创建航点任务
   */
  createMission(missionData) {
    return this.encode('Mission', missionData);
  }

  /**
   * 创建任务执行指令
   */
  createExecution(executionData) {
    return this.encode('Execution', executionData);
  }

  /**
   * 创建起飞/降落指令
   */
  createCommand(commandData) {
    return this.encode('Command', commandData);
  }

  /**
   * 创建心跳消息
   */
  createHeartbeat(data) {
    return this.encode('Heartbeat', data);
  }

  /**
   * 创建位姿消息
   */
  createOdometry(data) {
    return this.encode('LocalOdometry', data);
  }

  /**
   * 创建点云消息
   */
  createPointCloud(data) {
    return this.encode('PointCloud', data);
  }
}

module.exports = new ProtoHandler();
