/**
 * ZZXL场景模拟器 - 专门用于 zzxl.pcd 点云场景
 * 场景信息: 31.4m × 15.5m × 5.2m 大型室内环境, 513,550个点
 */

const DroneSimulator = require('./simulator');
const fs = require('fs');
const readline = require('readline');
const protoHandler = require('./proto-handler');

class ZZXLSimulator extends DroneSimulator {
  constructor(mqttBroker = 'mqtt://127.0.0.1:1883') {
    super('../zzxl.pcd', mqttBroker);

    // 加载protoHandler
    this.protoHandler = protoHandler;

    // 场景加载标志
    this.sceneLoaded = false;

    // 场景特定参数
    this.sceneBounds = {
      minX: -14.7, maxX: 16.7,   // 31.4m
      minY: -5.6, maxY: 9.8,     // 15.5m
      minZ: -1.0, maxZ: 4.2      // 5.2m
    };

    // 设置起点为场景中心偏下的位置
    this.position = {
      x: 1.0,   // 场景中心附近
      y: 2.0,
      z: 1.5    // 安全高度
    };

    // 调整传感器参数以适应大场景
    this.sensorRange = 15;  // 15米传感器范围
    this.pointCloudDensity = 1000;  // 每次发送1000个点
    this.speed = 1.0;  // 1 m/s 飞行速度

    // 加载进度
    this.loadProgress = 0;
  }

  /**
   * 优化的PCD加载 (带进度显示)
   */
  async loadPCD() {
    console.log('📂 开始加载大型点云文件...');
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const fileStream = fs.createReadStream(this.scenePcdFile);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      let lineCount = 0;
      let dataStarted = false;
      let totalPoints = 0;
      let loadedPoints = 0;
      let lastProgressUpdate = Date.now();

      rl.on('line', (line) => {
        lineCount++;

        // 读取POINTS字段获取总数
        if (line.startsWith('POINTS')) {
          totalPoints = parseInt(line.split(/\s+/)[1]);
          console.log(`📊 总点数: ${totalPoints.toLocaleString()}`);
        }

        // 数据开始标记
        if (line.startsWith('DATA')) {
          dataStarted = true;
          console.log('🔄 开始加载点云数据...');
          return;
        }

        // 解析点云数据
        if (dataStarted && line.trim()) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 4) {
            const x = parseFloat(parts[0]);
            const y = parseFloat(parts[1]);
            const z = parseFloat(parts[2]);
            const rgb = parseInt(parts[3]);

            // 采样: 每10个点取1个 (减少内存占用)
            if (loadedPoints % 10 === 0) {
              this.scenePoints.push({
                x, y, z,
                intensity: Math.floor(rgb & 0xFF)  // 从RGB提取强度，必须是整数 0-255
              });
            }

            loadedPoints++;

            // 每1秒更新一次进度
            const now = Date.now();
            if (now - lastProgressUpdate > 1000) {
              this.loadProgress = (loadedPoints / totalPoints * 100).toFixed(1);
              console.log(`⏳ 加载进度: ${this.loadProgress}% (${loadedPoints.toLocaleString()}/${totalPoints.toLocaleString()})`);
              lastProgressUpdate = now;
            }
          }
        }
      });

      rl.on('close', () => {
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`✅ 加载完成! 耗时 ${duration}秒`);
        console.log(`📊 原始点数: ${totalPoints.toLocaleString()}`);
        console.log(`📊 采样后点数: ${this.scenePoints.length.toLocaleString()}`);
        console.log(`📐 场景大小: ${(this.sceneBounds.maxX - this.sceneBounds.minX).toFixed(1)}m × ${(this.sceneBounds.maxY - this.sceneBounds.minY).toFixed(1)}m × ${(this.sceneBounds.maxZ - this.sceneBounds.minZ).toFixed(1)}m`);
        resolve();
      });

      rl.on('error', (error) => {
        console.error('❌ 加载失败:', error);
        reject(error);
      });
    });
  }

  /**
   * 重写场景加载方法
   */
  async loadScene() {
    console.log(`📂 加载ZZXL场景: ${this.scenePcdFile}`);

    if (!fs.existsSync(this.scenePcdFile)) {
      console.error('❌ 找不到 zzxl.pcd 文件!');
      console.log('💡 请确保文件在: c:\\Users\\23054\\Desktop\\室内无人机\\zzxl.pcd');
      process.exit(1);
    }

    await this.loadPCD();
    this.sceneLoaded = true;  // 标记场景已加载
  }

  /**
   * 智能起飞序列
   */
  async takeoff(height = 1.5) {
    console.log(`🚁 起飞到高度 ${height}m...`);
    this.setTarget(this.position.x, this.position.y, height);

    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (!this.isFlying) {
          clearInterval(checkInterval);
          console.log('✅ 起飞完成');
          resolve();
        }
      }, 100);
    });
  }

  /**
   * 自动探索演示路径
   */
  async autoExploreDemo() {
    console.log('🗺️ 启动自动探索演示...');

    // 规划一条覆盖场景的路径
    const waypoints = [
      { x: 1, y: 2, z: 1.5, name: '起点' },
      { x: 10, y: 2, z: 1.5, name: '向东' },
      { x: 10, y: 6, z: 1.5, name: '向北' },
      { x: -8, y: 6, z: 1.5, name: '向西' },
      { x: -8, y: -3, z: 1.5, name: '向南' },
      { x: 1, y: -3, z: 1.5, name: '中部' },
      { x: 1, y: 2, z: 1.5, name: '返回起点' }
    ];

    for (const wp of waypoints) {
      console.log(`🎯 飞往: ${wp.name} (${wp.x}, ${wp.y}, ${wp.z})`);
      this.setTarget(wp.x, wp.y, wp.z);

      // 等待到达
      await new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (!this.isFlying) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
      });

      // 在每个航点悬停2秒
      console.log('⏸️ 悬停采集数据...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log('🎉 自动探索演示完成!');
  }

  /**
   * 获取场景信息
   */
  getSceneInfo() {
    return {
      name: 'ZZXL室内场景',
      totalPoints: this.scenePoints.length,
      bounds: this.sceneBounds,
      size: {
        width: (this.sceneBounds.maxX - this.sceneBounds.minX).toFixed(1),
        depth: (this.sceneBounds.maxY - this.sceneBounds.minY).toFixed(1),
        height: (this.sceneBounds.maxZ - this.sceneBounds.minZ).toFixed(1)
      },
      startPosition: this.position
    };
  }

  /**
   * 重写发布心跳 - 使用Protobuf
   */
  publishHeartbeat() {
    try {
      const buffer = this.protoHandler.createHeartbeat({
        seqenceId: this.seqId++,
        timestamp: Date.now()
      });
      this.mqttClient.publish('/daf/heartbeat', buffer);
    } catch (error) {
      console.error('发布心跳失败:', error.message);
    }
  }

  /**
   * 重写发布位姿 - 使用Protobuf
   */
  publishOdometry() {
    try {
      const buffer = this.protoHandler.createOdometry({
        position: this.position,      // 直接传position
        orientation: this.orientation, // 直接传orientation
        velocity: this.velocity        // 直接传velocity
      });
      this.mqttClient.publish('/daf/local/odometry', buffer);
    } catch (error) {
      console.error('发布位姿失败:', error.message);
    }
  }

  /**
   * 重写发布点云 - 使用Protobuf (只在场景加载后发送)
   */
  publishPointCloud() {
    // 场景未加载时不发送点云
    if (!this.sceneLoaded) {
      return;
    }

    try {
      const visiblePoints = this.getVisiblePoints();

      // 转换为proto格式: {xyz: {x, y, z}, intensity: uint32}
      const protoPoints = visiblePoints.map(p => ({
        xyz: {
          x: p.x,
          y: p.y,
          z: p.z
        },
        intensity: Math.floor(p.intensity),  // 确保是整数
        rgb: 0
      }));

      const buffer = this.protoHandler.createPointCloud({
        points: protoPoints
      });
      this.mqttClient.publish('/daf/pointcloud', buffer);
    } catch (error) {
      console.error('发布点云失败:', error.message);
    }
  }
}

// 命令行启动
if (require.main === module) {
  const simulator = new ZZXLSimulator();

  (async () => {
    try {
      // 1. 初始化Protobuf
      await protoHandler.init();
      console.log('✅ Protobuf已加载');

      // 2. 加载场景（后台加载，但不发送点云）
      console.log('📂 开始加载场景...');
      await simulator.loadScene();

      const info = simulator.getSceneInfo();
      console.log('\n📊 场景信息:');
      console.log(`   名称: ${info.name}`);
      console.log(`   大小: ${info.size.width}m × ${info.size.depth}m × ${info.size.height}m`);
      console.log(`   点数: ${info.totalPoints.toLocaleString()}`);
      console.log(`   起点: (${info.startPosition.x}, ${info.startPosition.y}, ${info.startPosition.z})`);
      console.log('');

      // 3. 连接MQTT
      await simulator.connectMQTT();

      // 4. 启动模拟器（会发送点云，因为场景已加载）
      simulator.start();

      console.log('🧭 模拟器已就绪，等待探索引擎控制...');
      console.log('💡 在Web界面点击"开始探索"按钮启动智能探索');
      console.log('💡 按 Ctrl+C 退出模拟器');
      console.log('');

    } catch (error) {
      console.error('❌ 启动失败:', error);
      process.exit(1);
    }
  })();

  // Ctrl+C 优雅退出
  process.on('SIGINT', () => {
    console.log('\n👋 退出模拟器...');
    simulator.stop();
    process.exit(0);
  });
}

module.exports = ZZXLSimulator;
