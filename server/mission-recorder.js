/**
 * 任务记录器 - 记录无人机任务执行过程中的视频、点云、轨迹数据
 * 保留最近15次任务记录，超出自动删除
 * 注意：只有真正收到数据时才保存记录，否则取消
 */

const fs = require('fs');
const path = require('path');

// 数据存储目录
const DATA_DIR = path.join(__dirname, 'data', 'missions');
const DB_FILE = path.join(__dirname, 'data', 'missions.json');
const MAX_RECORDS = 15;

class MissionRecorder {
  constructor() {
    this.currentMission = null;
    this.isRecording = false;
    this.videoFrames = [];
    this.pointCloudSnapshots = [];
    this.trajectoryPoints = [];
    this.hasReceivedData = false; // 标记是否真正收到过数据

    // 确保数据目录存在
    this.ensureDataDir();

    // 加载现有记录
    this.missions = this.loadMissions();

    console.log('📹 任务记录器已初始化');
  }

  /**
   * 确保数据目录存在
   */
  ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  /**
   * 加载任务记录列表
   */
  loadMissions() {
    try {
      if (fs.existsSync(DB_FILE)) {
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
      }
    } catch (error) {
      console.error('加载任务记录失败:', error);
    }
    return [];
  }

  /**
   * 保存任务记录列表
   */
  saveMissions() {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.missions, null, 2), 'utf-8');
    } catch (error) {
      console.error('保存任务记录失败:', error);
    }
  }

  /**
   * 开始记录任务
   * @param {string} missionId - 任务ID
   * @param {object} missionData - 任务数据（航点等）
   */
  startRecording(missionId, missionData = {}) {
    if (this.isRecording) {
      console.log('⚠️ 已有任务在记录中，先停止当前记录');
      this.stopRecording();
    }

    const timestamp = Date.now();
    const missionDir = path.join(DATA_DIR, `mission_${timestamp}`);
    fs.mkdirSync(missionDir, { recursive: true });

    this.currentMission = {
      id: missionId,
      timestamp: timestamp,
      startTime: new Date().toISOString(),
      endTime: null,
      status: 'recording',
      waypoints: missionData.waypoints || [],
      waypointCount: missionData.waypointCount || 0,
      dir: missionDir,
      videoFile: path.join(missionDir, 'video_frames'),
      pointCloudFile: path.join(missionDir, 'pointcloud.json'),
      trajectoryFile: path.join(missionDir, 'trajectory.json')
    };

    // 创建视频帧目录
    fs.mkdirSync(this.currentMission.videoFile, { recursive: true });

    this.isRecording = true;
    this.videoFrames = [];
    this.pointCloudSnapshots = [];
    this.trajectoryPoints = [];
    this.hasReceivedData = false; // 重置数据接收标记

    console.log(`📹 开始记录任务: ${missionId}`);
    return { success: true, missionId, timestamp };
  }

  /**
   * 记录视频帧
   * @param {string} frameData - Base64编码的JPEG帧
   */
  recordVideoFrame(frameData) {
    if (!this.isRecording || !this.currentMission) return;

    try {
      this.hasReceivedData = true; // 标记收到数据
      const frameIndex = this.videoFrames.length;
      const framePath = path.join(this.currentMission.videoFile, `frame_${String(frameIndex).padStart(6, '0')}.jpg`);

      // 将Base64转为Buffer并保存
      const buffer = Buffer.from(frameData, 'base64');
      fs.writeFileSync(framePath, buffer);

      this.videoFrames.push({
        index: frameIndex,
        timestamp: Date.now(),
        path: framePath
      });

      // 每100帧输出一次日志
      if (frameIndex % 100 === 0) {
        console.log(`📹 已记录 ${frameIndex} 帧视频`);
      }
    } catch (error) {
      console.error('记录视频帧失败:', error);
    }
  }

  /**
   * 记录点云快照
   * @param {object} pointCloudData - 点云数据
   */
  recordPointCloud(pointCloudData) {
    if (!this.isRecording || !this.currentMission) return;

    try {
      this.hasReceivedData = true; // 标记收到数据
      // 每隔一段时间保存一次点云快照（避免数据过大）
      const now = Date.now();
      const lastSnapshot = this.pointCloudSnapshots[this.pointCloudSnapshots.length - 1];

      // 每5秒保存一次点云快照
      if (!lastSnapshot || (now - lastSnapshot.timestamp) > 5000) {
        this.pointCloudSnapshots.push({
          timestamp: now,
          pointCount: pointCloudData.points?.length || 0,
          // 只保存点的位置，不保存颜色以减少数据量
          points: pointCloudData.points?.slice(0, 10000) || [] // 最多保存1万个点
        });
        console.log(`☁️ 记录点云快照 #${this.pointCloudSnapshots.length}`);
      }
    } catch (error) {
      console.error('记录点云失败:', error);
    }
  }

  /**
   * 记录轨迹点
   * @param {object} odometryData - 里程计数据
   */
  recordTrajectory(odometryData) {
    if (!this.isRecording || !this.currentMission) return;

    try {
      this.hasReceivedData = true; // 标记收到数据
      const position = odometryData.position || odometryData;
      this.trajectoryPoints.push({
        timestamp: Date.now(),
        x: position.x,
        y: position.y,
        z: position.z,
        yaw: odometryData.yaw || 0
      });
    } catch (error) {
      console.error('记录轨迹失败:', error);
    }
  }

  /**
   * 停止记录并保存
   */
  stopRecording() {
    if (!this.isRecording || !this.currentMission) {
      return { success: false, message: '没有正在记录的任务' };
    }

    try {
      // 如果没有收到任何数据，取消记录并删除临时目录
      if (!this.hasReceivedData) {
        console.log(`⚠️ 任务 ${this.currentMission.id} 没有收到任何数据，取消记录`);

        // 删除临时目录
        if (fs.existsSync(this.currentMission.dir)) {
          fs.rmSync(this.currentMission.dir, { recursive: true, force: true });
        }

        // 重置状态
        this.isRecording = false;
        this.currentMission = null;
        this.videoFrames = [];
        this.pointCloudSnapshots = [];
        this.trajectoryPoints = [];
        this.hasReceivedData = false;

        return { success: false, message: '没有收到数据，记录已取消' };
      }

      // 更新任务状态
      this.currentMission.endTime = new Date().toISOString();
      this.currentMission.status = 'completed';
      this.currentMission.frameCount = this.videoFrames.length;
      this.currentMission.pointCloudSnapshotCount = this.pointCloudSnapshots.length;
      this.currentMission.trajectoryPointCount = this.trajectoryPoints.length;

      // 保存点云数据
      fs.writeFileSync(
        this.currentMission.pointCloudFile,
        JSON.stringify(this.pointCloudSnapshots, null, 2),
        'utf-8'
      );

      // 保存轨迹数据
      fs.writeFileSync(
        this.currentMission.trajectoryFile,
        JSON.stringify(this.trajectoryPoints, null, 2),
        'utf-8'
      );

      // 添加到记录列表
      const missionRecord = {
        id: this.currentMission.id,
        timestamp: this.currentMission.timestamp,
        startTime: this.currentMission.startTime,
        endTime: this.currentMission.endTime,
        status: this.currentMission.status,
        waypointCount: this.currentMission.waypointCount,
        frameCount: this.currentMission.frameCount,
        pointCloudSnapshotCount: this.currentMission.pointCloudSnapshotCount,
        trajectoryPointCount: this.currentMission.trajectoryPointCount,
        dir: this.currentMission.dir
      };

      this.missions.unshift(missionRecord);

      // 清理超出15条的旧记录
      this.cleanupOldRecords();

      // 保存记录列表
      this.saveMissions();

      console.log(`📹 任务记录完成: ${this.currentMission.id}`);
      console.log(`   - 视频帧: ${this.videoFrames.length}`);
      console.log(`   - 点云快照: ${this.pointCloudSnapshots.length}`);
      console.log(`   - 轨迹点: ${this.trajectoryPoints.length}`);

      const result = {
        success: true,
        missionId: this.currentMission.id,
        frameCount: this.videoFrames.length,
        pointCloudSnapshotCount: this.pointCloudSnapshots.length,
        trajectoryPointCount: this.trajectoryPoints.length
      };

      // 重置状态
      this.isRecording = false;
      this.currentMission = null;
      this.videoFrames = [];
      this.pointCloudSnapshots = [];
      this.trajectoryPoints = [];
      this.hasReceivedData = false;

      return result;
    } catch (error) {
      console.error('停止记录失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 清理超出15条的旧记录
   */
  cleanupOldRecords() {
    while (this.missions.length > MAX_RECORDS) {
      const oldMission = this.missions.pop();
      console.log(`🗑️ 删除旧记录: ${oldMission.id}`);

      // 删除文件夹
      try {
        if (fs.existsSync(oldMission.dir)) {
          fs.rmSync(oldMission.dir, { recursive: true, force: true });
        }
      } catch (error) {
        console.error('删除旧记录文件夹失败:', error);
      }
    }
  }

  /**
   * 获取所有任务记录列表
   */
  getMissionList() {
    return this.missions.map(m => ({
      id: m.id,
      timestamp: m.timestamp,
      startTime: m.startTime,
      endTime: m.endTime,
      status: m.status,
      waypointCount: m.waypointCount,
      frameCount: m.frameCount,
      pointCloudSnapshotCount: m.pointCloudSnapshotCount,
      trajectoryPointCount: m.trajectoryPointCount
    }));
  }

  /**
   * 获取指定任务的详细数据
   * @param {number} timestamp - 任务时间戳
   */
  getMissionDetail(timestamp) {
    const mission = this.missions.find(m => m.timestamp === parseInt(timestamp));
    if (!mission) {
      return { success: false, error: '任务记录不存在' };
    }

    const result = {
      success: true,
      mission: {
        id: mission.id,
        timestamp: mission.timestamp,
        startTime: mission.startTime,
        endTime: mission.endTime,
        status: mission.status,
        waypointCount: mission.waypointCount,
        frameCount: mission.frameCount,
        pointCloudSnapshotCount: mission.pointCloudSnapshotCount,
        trajectoryPointCount: mission.trajectoryPointCount
      }
    };

    // 读取轨迹数据
    const trajectoryFile = path.join(mission.dir, 'trajectory.json');
    if (fs.existsSync(trajectoryFile)) {
      try {
        result.trajectory = JSON.parse(fs.readFileSync(trajectoryFile, 'utf-8'));
      } catch (e) {
        result.trajectory = [];
      }
    }

    // 读取点云数据
    const pointCloudFile = path.join(mission.dir, 'pointcloud.json');
    if (fs.existsSync(pointCloudFile)) {
      try {
        result.pointCloud = JSON.parse(fs.readFileSync(pointCloudFile, 'utf-8'));
      } catch (e) {
        result.pointCloud = [];
      }
    }

    return result;
  }

  /**
   * 获取任务视频帧列表
   * @param {number} timestamp - 任务时间戳
   */
  getMissionFrames(timestamp) {
    const mission = this.missions.find(m => m.timestamp === parseInt(timestamp));
    if (!mission) {
      return { success: false, error: '任务记录不存在' };
    }

    const framesDir = path.join(mission.dir, 'video_frames');
    if (!fs.existsSync(framesDir)) {
      return { success: true, frames: [] };
    }

    const frames = fs.readdirSync(framesDir)
      .filter(f => f.endsWith('.jpg'))
      .sort()
      .map((f, index) => ({
        index,
        filename: f,
        url: `/api/missions/${timestamp}/frames/${f}`
      }));

    return { success: true, frames, total: frames.length };
  }

  /**
   * 获取单个视频帧
   * @param {number} timestamp - 任务时间戳
   * @param {string} filename - 帧文件名
   */
  getFrame(timestamp, filename) {
    const mission = this.missions.find(m => m.timestamp === parseInt(timestamp));
    if (!mission) {
      return null;
    }

    const framePath = path.join(mission.dir, 'video_frames', filename);
    if (fs.existsSync(framePath)) {
      return fs.readFileSync(framePath);
    }
    return null;
  }

  /**
   * 删除指定任务记录
   * @param {number} timestamp - 任务时间戳
   */
  deleteMission(timestamp) {
    const index = this.missions.findIndex(m => m.timestamp === parseInt(timestamp));
    if (index === -1) {
      return { success: false, error: '任务记录不存在' };
    }

    const mission = this.missions[index];

    // 删除文件夹
    try {
      if (fs.existsSync(mission.dir)) {
        fs.rmSync(mission.dir, { recursive: true, force: true });
      }
    } catch (error) {
      console.error('删除任务文件夹失败:', error);
    }

    // 从列表中移除
    this.missions.splice(index, 1);
    this.saveMissions();

    console.log(`🗑️ 已删除任务记录: ${mission.id}`);
    return { success: true, message: '任务记录已删除' };
  }

  /**
   * 获取当前记录状态
   */
  getRecordingStatus() {
    return {
      isRecording: this.isRecording,
      currentMission: this.currentMission ? {
        id: this.currentMission.id,
        startTime: this.currentMission.startTime,
        frameCount: this.videoFrames.length,
        trajectoryPointCount: this.trajectoryPoints.length
      } : null
    };
  }
}

module.exports = MissionRecorder;
