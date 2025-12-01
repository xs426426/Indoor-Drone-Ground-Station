/**
 * 无人机探索模拟器
 * 用于在没有真实无人机的情况下测试探索引擎
 */

const mqtt = require('mqtt');
const fs = require('fs');
const path = require('path');
const protoHandler = require('./proto-handler');

class DroneSimulator {
  constructor(scenePcdFile, mqttBroker = 'mqtt://127.0.0.1:1883') {
    this.scenePcdFile = scenePcdFile;
    this.mqttBroker = mqttBroker;
    this.mqttClient = null;

    // 无人机状态
    this.position = { x: 0, y: 0, z: 1.0 };  // 起点
    this.velocity = { x: 0, y: 0, z: 0 };
    this.orientation = { w: 1, x: 0, y: 0, z: 0 };  // 四元数

    // 场景点云数据
    this.scenePoints = [];

    // 模拟参数
    this.isFlying = false;
    this.targetPosition = null;
    this.speed = 0.5;  // m/s
    this.sensorRange = 10;  // 传感器范围10米
    this.pointCloudDensity = 500;  // 每次发送500个点

    // 定时器
    this.odometryTimer = null;
    this.pointCloudTimer = null;
    this.heartbeatTimer = null;

    // 脱困机制
    this.consecutiveCollisions = 0;  // 连续碰撞次数
    this.lastPosition = { ...this.position };  // 上次位置

    // 高度限制（默认值，可通过MQTT配置）
    this.heightLimits = {
      min: 0.5,   // 默认最小高度0.5米
      max: 2.5    // 默认最大高度2.5米
    };

    this.seqId = 0;
  }

  /**
   * 加载场景点云文件
   */
  async loadScene() {
    console.log(`📂 加载场景文件: ${this.scenePcdFile}`);

    if (!fs.existsSync(this.scenePcdFile)) {
      console.warn('⚠️ 场景文件不存在,使用默认场景');
      this.generateDefaultScene();
      return;
    }

    const ext = path.extname(this.scenePcdFile).toLowerCase();

    if (ext === '.pcd') {
      await this.loadPCD();
    } else if (ext === '.txt') {
      await this.loadTXT();
    } else if (ext === '.json') {
      await this.loadJSON();
    } else {
      console.warn('⚠️ 不支持的文件格式,使用默认场景');
      this.generateDefaultScene();
    }

    console.log(`✅ 场景已加载: ${this.scenePoints.length} 个点`);
  }

  /**
   * 加载PCD格式点云
   */
  async loadPCD() {
    const content = fs.readFileSync(this.scenePcdFile, 'utf-8');
    const lines = content.split('\n');

    let dataStarted = false;
    for (const line of lines) {
      if (line.startsWith('DATA')) {
        dataStarted = true;
        continue;
      }

      if (dataStarted && line.trim()) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) {
          this.scenePoints.push({
            x: parseFloat(parts[0]),
            y: parseFloat(parts[1]),
            z: parseFloat(parts[2]),
            intensity: parts[3] ? parseFloat(parts[3]) : 100
          });
        }
      }
    }
  }

  /**
   * 加载TXT格式点云 (x y z 或 x y z intensity)
   */
  async loadTXT() {
    const content = fs.readFileSync(this.scenePcdFile, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      if (line.trim() && !line.startsWith('#')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) {
          this.scenePoints.push({
            x: parseFloat(parts[0]),
            y: parseFloat(parts[1]),
            z: parseFloat(parts[2]),
            intensity: parts[3] ? parseFloat(parts[3]) : 100
          });
        }
      }
    }
  }

  /**
   * 加载JSON格式点云
   */
  async loadJSON() {
    const content = fs.readFileSync(this.scenePcdFile, 'utf-8');
    const data = JSON.parse(content);

    if (Array.isArray(data)) {
      this.scenePoints = data;
    } else if (data.points) {
      this.scenePoints = data.points;
    }
  }

  /**
   * 生成默认测试场景 (一个5m×5m的房间)
   */
  generateDefaultScene() {
    console.log('🏠 生成默认室内场景...');

    const roomSize = 5;  // 5米×5米房间
    const wallHeight = 3;
    const pointDensity = 0.1;  // 每10cm一个点

    // 不添加地板点云！避免与无人机碰撞检测冲突
    // 实际LiDAR不会扫描到地板（除非角度向下）

    // 四面墙
    // 前墙 (y = roomSize)
    for (let x = -roomSize; x <= roomSize; x += pointDensity) {
      for (let z = 0; z <= wallHeight; z += pointDensity) {
        if (Math.random() < 0.5) {
          this.scenePoints.push({ x, y: roomSize, z, intensity: 100 });
        }
      }
    }

    // 后墙 (y = -roomSize)
    for (let x = -roomSize; x <= roomSize; x += pointDensity) {
      for (let z = 0; z <= wallHeight; z += pointDensity) {
        if (Math.random() < 0.5) {
          this.scenePoints.push({ x, y: -roomSize, z, intensity: 100 });
        }
      }
    }

    // 左墙 (x = -roomSize)
    for (let y = -roomSize; y <= roomSize; y += pointDensity) {
      for (let z = 0; z <= wallHeight; z += pointDensity) {
        if (Math.random() < 0.5) {
          this.scenePoints.push({ x: -roomSize, y, z, intensity: 100 });
        }
      }
    }

    // 右墙 (x = roomSize)
    for (let y = -roomSize; y <= roomSize; y += pointDensity) {
      for (let z = 0; z <= wallHeight; z += pointDensity) {
        if (Math.random() < 0.5) {
          this.scenePoints.push({ x: roomSize, y, z, intensity: 100 });
        }
      }
    }

    // 添加一些障碍物 (桌子、椅子等)
    this.addObstacle(2, 2, 0, 0.5, 0.5, 0.8);  // 桌子
    this.addObstacle(-2, -2, 0, 0.4, 0.4, 1.0);  // 椅子

    console.log(`✅ 生成了 ${this.scenePoints.length} 个点（无地板点云）`);
  }

  /**
   * 添加障碍物
   */
  addObstacle(cx, cy, cz, width, depth, height) {
    const density = 0.05;
    for (let x = cx - width/2; x <= cx + width/2; x += density) {
      for (let y = cy - depth/2; y <= cy + depth/2; y += density) {
        for (let z = cz; z <= cz + height; z += density) {
          if (Math.random() < 0.3) {
            this.scenePoints.push({ x, y, z, intensity: 150 });
          }
        }
      }
    }
  }

  /**
   * 连接MQTT
   */
  async connectMQTT() {
    return new Promise((resolve, reject) => {
      console.log(`🔗 连接MQTT: ${this.mqttBroker}`);

      this.mqttClient = mqtt.connect(this.mqttBroker, {
        clientId: 'drone_simulator_' + Math.random().toString(16).substr(2, 8),
        clean: true
      });

      this.mqttClient.on('connect', () => {
        console.log('✅ MQTT 已连接');

        // 订阅任务话题
        this.mqttClient.subscribe('/daf/mission', (err) => {
          if (!err) console.log('✅ 已订阅: /daf/mission');
        });

        this.mqttClient.subscribe('/daf/mission/execution', (err) => {
          if (!err) console.log('✅ 已订阅: /daf/mission/execution');
        });

        // 订阅位置设置命令（用于同步探索起点）
        this.mqttClient.subscribe('/daf/simulator/set_position', (err) => {
          if (!err) console.log('✅ 已订阅: /daf/simulator/set_position');
        });

        // 订阅高度限制配置（用于同步探索高度范围）
        this.mqttClient.subscribe('/daf/simulator/set_height_limits', (err) => {
          if (!err) console.log('✅ 已订阅: /daf/simulator/set_height_limits');
        });

        resolve();
      });

      this.mqttClient.on('error', (error) => {
        console.error('❌ MQTT错误:', error);
        reject(error);
      });

      this.mqttClient.on('message', (topic, message) => {
        console.log(`[SIMULATOR] 📬 收到原始MQTT消息: topic=${topic}, size=${message.length}`);
        this.handleMQTTMessage(topic, message);
      });
    });
  }

  /**
   * 处理MQTT消息 (接收任务指令)
   */
  handleMQTTMessage(topic, message) {
    try {
      console.log(`📥 收到消息 [${topic}]`);

      // 特殊处理：位置设置消息（JSON格式，不是Protobuf）
      if (topic === '/daf/simulator/set_position') {
        try {
          const posData = JSON.parse(message.toString());
          if (posData.x !== undefined && posData.y !== undefined && posData.z !== undefined) {
            this.position = { x: posData.x, y: posData.y, z: posData.z };
            this.velocity = { x: 0, y: 0, z: 0 };
            this.isFlying = false;
            this.targetPosition = null;
            console.log(`📍 模拟器位置已更新: (${posData.x.toFixed(2)}, ${posData.y.toFixed(2)}, ${posData.z.toFixed(2)})`);
          } else {
            console.log('⚠️ 位置数据格式错误:', posData);
          }
        } catch (err) {
          console.error('解析位置数据失败:', err);
        }
        return;  // 处理完成，直接返回
      }

      // 特殊处理：高度限制配置消息（JSON格式，不是Protobuf）
      if (topic === '/daf/simulator/set_height_limits') {
        try {
          const limitsData = JSON.parse(message.toString());
          if (limitsData.minHeight !== undefined && limitsData.maxHeight !== undefined) {
            this.heightLimits.min = limitsData.minHeight;
            this.heightLimits.max = limitsData.maxHeight;
            console.log(`📏 高度限制已更新: [${this.heightLimits.min.toFixed(2)}m, ${this.heightLimits.max.toFixed(2)}m]`);
          } else {
            console.log('⚠️ 高度限制数据格式错误:', limitsData);
          }
        } catch (err) {
          console.error('解析高度限制数据失败:', err);
        }
        return;  // 处理完成，直接返回
      }

      // 使用 Protobuf 解码消息
      const decodedMessage = protoHandler.decode(topic, message);

      if (!decodedMessage) {
        console.log('⚠️ 无法解码消息');
        return;
      }

      console.log('📦 解码后的消息:', JSON.stringify(decodedMessage, null, 2));

      if (topic === '/daf/mission') {
        // 收到任务，解析目标位置
        const mission = decodedMessage;

        // 查找第一个 autoPilot 任务（跳过 takeOff, land 等）
        if (mission && mission.tasks && mission.tasks.length > 0) {
          const autoPilotTask = mission.tasks.find(task => task.autoPilot);

          if (autoPilotTask && autoPilotTask.autoPilot.position) {
            const goal = autoPilotTask.autoPilot.position;
            this.targetPosition = {
              x: goal.x,
              y: goal.y,
              z: goal.z || this.position.z
            };
            console.log(`🎯 接收到任务目标: (${goal.x.toFixed(2)}, ${goal.y.toFixed(2)}, ${goal.z?.toFixed(2) || this.position.z.toFixed(2)})`);
          } else {
            console.log('⚠️ 任务中没有找到 autoPilot 指令');
          }
        } else {
          console.log('⚠️ 任务结构错误: mission =', mission);
        }
      } else if (topic === '/daf/mission/execution') {
        // 收到执行指令，开始飞行
        const execution = decodedMessage;
        // action 是字符串 "START"，不是数字 0
        if (execution && (execution.action === 0 || execution.action === 'START')) {
          this.isFlying = true;
          console.log('🚁 开始执行任务');
        } else {
          console.log('⚠️ 执行指令结构错误: execution =', execution);
        }
      }
    } catch (error) {
      console.error('处理MQTT消息失败:', error);
    }
  }

  /**
   * 启动模拟
   */
  start() {
    console.log('🎮 启动模拟器...');

    // 发布心跳 (10Hz)
    this.heartbeatTimer = setInterval(() => {
      this.publishHeartbeat();
    }, 100);

    // 发布位姿 (20Hz)
    this.odometryTimer = setInterval(() => {
      this.updatePosition();
      this.publishOdometry();
    }, 50);

    // 发布点云 (5Hz)
    this.pointCloudTimer = setInterval(() => {
      this.publishPointCloud();
    }, 200);

    console.log('✅ 模拟器已启动');
    console.log('💡 提示: 使用 setTarget(x, y, z) 设置目标位置');
  }

  /**
   * 停止模拟
   */
  stop() {
    console.log('🛑 停止模拟器...');

    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.odometryTimer) clearInterval(this.odometryTimer);
    if (this.pointCloudTimer) clearInterval(this.pointCloudTimer);

    if (this.mqttClient) {
      this.mqttClient.end();
    }

    console.log('✅ 模拟器已停止');
  }

  /**
   * 设置目标位置
   */
  setTarget(x, y, z) {
    this.targetPosition = { x, y, z: z || this.position.z };
    this.isFlying = true;
    console.log(`🎯 设置目标: (${x.toFixed(2)}, ${y.toFixed(2)}, ${z?.toFixed(2) || this.position.z.toFixed(2)})`);
  }

  /**
   * 更新无人机位置
   */
  updatePosition() {
    if (!this.isFlying || !this.targetPosition) {
      return;
    }

    const dx = this.targetPosition.x - this.position.x;
    const dy = this.targetPosition.y - this.position.y;
    const dz = (this.targetPosition.z || this.position.z) - this.position.z;

    const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);

    // 到达目标
    if (distance < 0.1) {
      this.position = { ...this.targetPosition };
      this.velocity = { x: 0, y: 0, z: 0 };
      this.isFlying = false;
      this.targetPosition = null;
      console.log(`✅ 到达目标: (${this.position.x.toFixed(2)}, ${this.position.y.toFixed(2)}, ${this.position.z.toFixed(2)})`);
      return;
    }

    // 匀速移动
    const dt = 0.05;  // 50ms
    const stepDistance = this.speed * dt;

    if (stepDistance < distance) {
      const ratio = stepDistance / distance;
      const newX = this.position.x + dx * ratio;
      const newY = this.position.y + dy * ratio;
      const newZ = this.position.z + dz * ratio;

      // 碰撞检测：检查新位置是否与点云碰撞
      if (this.checkCollision(newX, newY, newZ)) {
        // 增加连续碰撞计数
        this.consecutiveCollisions++;

        console.log(`⚠️ 前方障碍物，停在安全位置: (${this.position.x.toFixed(2)}, ${this.position.y.toFixed(2)}, ${this.position.z.toFixed(2)}) [连续碰撞: ${this.consecutiveCollisions}]`);

        // 如果连续碰撞3次或以上，尝试脱困
        if (this.consecutiveCollisions >= 3) {
          console.log(`🔄 检测到连续${this.consecutiveCollisions}次碰撞，尝试脱困...`);
          this.attemptEscape();
        }

        this.isFlying = false;
        this.targetPosition = null;
        this.velocity = { x: 0, y: 0, z: 0 };
        // 不报告碰撞错误，让探索引擎认为已到达并规划下一个目标
        return;
      }

      // 移动成功，重置碰撞计数
      this.consecutiveCollisions = 0;

      this.position.x = newX;
      this.position.y = newY;
      this.position.z = newZ;

      this.velocity.x = dx / distance * this.speed;
      this.velocity.y = dy / distance * this.speed;
      this.velocity.z = dz / distance * this.speed;
    } else {
      this.position = { ...this.targetPosition };
      this.velocity = { x: 0, y: 0, z: 0 };
    }
  }

  /**
   * 碰撞检测：检查位置是否与点云碰撞
   */
  checkCollision(x, y, z) {
    const collisionRadius = 0.3;  // 增加到0.3米（更保守）

    // 只检查与无人机同高度的点（±0.3m范围内，避免地板干扰）
    const minZ = z - 0.3;
    const maxZ = z + 0.3;

    // 检查周围是否有点云
    for (const point of this.scenePoints) {
      // 跳过地板点（z < 0.2）
      if (point.z < 0.2) continue;

      // 跳过高度差异太大的点
      if (point.z < minZ || point.z > maxZ) continue;

      const dx = point.x - x;
      const dy = point.y - y;
      const distance = Math.sqrt(dx*dx + dy*dy);  // 只计算水平距离

      if (distance < collisionRadius) {
        return true;  // 碰撞
      }
    }

    return false;  // 无碰撞
  }

  /**
   * 脱困机制：当连续碰撞时，尝试移动到更安全的位置（支持3D + 动态距离）
   */
  attemptEscape() {
    // 根据连续碰撞次数动态调整脱困距离（越困越远）
    const baseDistance = 0.5;
    const escapeDistance = baseDistance * Math.min(Math.floor(this.consecutiveCollisions / 3) + 1, 3);
    // 3次碰撞: 0.5m
    // 6次碰撞: 1.0m
    // 9次碰撞: 1.5m

    console.log(`   尝试脱困距离: ${escapeDistance.toFixed(1)}m (连续碰撞${this.consecutiveCollisions}次)`);

    // ============ 阶段1: 垂直脱困 ============

    // 使用配置的高度限制（而不是硬编码）
    const MIN_HEIGHT = this.heightLimits.min;
    const MAX_HEIGHT = this.heightLimits.max;

    // 1. 尝试上升
    if (this.position.z + escapeDistance <= MAX_HEIGHT) {  // 使用配置的最大高度
      const newZ = this.position.z + escapeDistance;
      if (!this.checkCollision(this.position.x, this.position.y, newZ)) {
        this.position.z = newZ;
        console.log(`✅ 脱困成功（上升${escapeDistance.toFixed(1)}m），移动到: (${this.position.x.toFixed(2)}, ${this.position.y.toFixed(2)}, ${this.position.z.toFixed(2)}) [高度限制: ${MIN_HEIGHT.toFixed(1)}-${MAX_HEIGHT.toFixed(1)}m]`);
        this.consecutiveCollisions = 0;
        return true;
      }
    }

    // 2. 尝试下降
    if (this.position.z - escapeDistance >= MIN_HEIGHT) {  // 使用配置的最小高度
      const newZ = this.position.z - escapeDistance;
      if (!this.checkCollision(this.position.x, this.position.y, newZ)) {
        this.position.z = newZ;
        console.log(`✅ 脱困成功（下降${escapeDistance.toFixed(1)}m），移动到: (${this.position.x.toFixed(2)}, ${this.position.y.toFixed(2)}, ${this.position.z.toFixed(2)}) [高度限制: ${MIN_HEIGHT.toFixed(1)}-${MAX_HEIGHT.toFixed(1)}m]`);
        this.consecutiveCollisions = 0;
        return true;
      }
    }

    // ============ 阶段2: 水平脱困 ============

    const currentZ = this.position.z;

    // 3. 尝试朝向中心移动（0, 0, 当前高度）
    const centerX = 0;
    const centerY = 0;
    const dx = centerX - this.position.x;
    const dy = centerY - this.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 0.1) {  // 如果不在中心
      const ratio = Math.min(escapeDistance / dist, 1.0);
      const escapeX = this.position.x + dx * ratio;
      const escapeY = this.position.y + dy * ratio;

      if (!this.checkCollision(escapeX, escapeY, currentZ)) {
        this.position.x = escapeX;
        this.position.y = escapeY;
        console.log(`✅ 脱困成功（朝向中心${escapeDistance.toFixed(1)}m），移动到: (${this.position.x.toFixed(2)}, ${this.position.y.toFixed(2)}, ${this.position.z.toFixed(2)})`);
        this.consecutiveCollisions = 0;
        return true;
      }
    }

    // 4. 尝试8个水平方向
    const angles = [0, 45, 90, 135, 180, 225, 270, 315];
    for (const angle of angles) {
      const rad = angle * Math.PI / 180;
      const escapeX = this.position.x + escapeDistance * Math.cos(rad);
      const escapeY = this.position.y + escapeDistance * Math.sin(rad);

      if (!this.checkCollision(escapeX, escapeY, currentZ)) {
        this.position.x = escapeX;
        this.position.y = escapeY;
        console.log(`✅ 脱困成功（方向${angle}° ${escapeDistance.toFixed(1)}m），移动到: (${this.position.x.toFixed(2)}, ${this.position.y.toFixed(2)}, ${this.position.z.toFixed(2)})`);
        this.consecutiveCollisions = 0;
        return true;
      }
    }

    // ============ 阶段3: 3D组合脱困 ============

    // 5. 尝试上升+水平方向
    if (this.position.z + escapeDistance <= MAX_HEIGHT) {  // 使用相同的高度限制
      const newZ = this.position.z + escapeDistance;
      for (const angle of angles) {
        const rad = angle * Math.PI / 180;
        const escapeX = this.position.x + escapeDistance * Math.cos(rad);
        const escapeY = this.position.y + escapeDistance * Math.sin(rad);

        if (!this.checkCollision(escapeX, escapeY, newZ)) {
          this.position.x = escapeX;
          this.position.y = escapeY;
          this.position.z = newZ;
          console.log(`✅ 脱困成功（上升+方向${angle}° ${escapeDistance.toFixed(1)}m），移动到: (${this.position.x.toFixed(2)}, ${this.position.y.toFixed(2)}, ${this.position.z.toFixed(2)}) [高度限制: ${MIN_HEIGHT.toFixed(1)}-${MAX_HEIGHT.toFixed(1)}m]`);
          this.consecutiveCollisions = 0;
          return true;
        }
      }
    }

    // 6. 尝试下降+水平方向
    if (this.position.z - escapeDistance >= MIN_HEIGHT) {  // 使用相同的高度限制
      const newZ = this.position.z - escapeDistance;
      for (const angle of angles) {
        const rad = angle * Math.PI / 180;
        const escapeX = this.position.x + escapeDistance * Math.cos(rad);
        const escapeY = this.position.y + escapeDistance * Math.sin(rad);

        if (!this.checkCollision(escapeX, escapeY, newZ)) {
          this.position.x = escapeX;
          this.position.y = escapeY;
          this.position.z = newZ;
          console.log(`✅ 脱困成功（下降+方向${angle}° ${escapeDistance.toFixed(1)}m），移动到: (${this.position.x.toFixed(2)}, ${this.position.y.toFixed(2)}, ${this.position.z.toFixed(2)}) [高度限制: ${MIN_HEIGHT.toFixed(1)}-${MAX_HEIGHT.toFixed(1)}m]`);
          this.consecutiveCollisions = 0;
          return true;
        }
      }
    }

    // ============ 阶段4: 随机脱困（最后手段）============

    // 7. 尝试5次随机方向+随机距离
    for (let attempt = 0; attempt < 5; attempt++) {
      const randomAngle = Math.random() * 360;
      const randomDistance = 1.0 + Math.random() * 1.0;  // 1-2米
      const randomZOffset = (Math.random() - 0.5) * 1.0;  // ±0.5米

      const escapeX = this.position.x + randomDistance * Math.cos(randomAngle * Math.PI / 180);
      const escapeY = this.position.y + randomDistance * Math.sin(randomAngle * Math.PI / 180);
      const escapeZ = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, this.position.z + randomZOffset));  // 使用相同的高度限制

      if (!this.checkCollision(escapeX, escapeY, escapeZ)) {
        this.position.x = escapeX;
        this.position.y = escapeY;
        this.position.z = escapeZ;
        console.log(`✅ 脱困成功（随机方向${randomAngle.toFixed(0)}° ${randomDistance.toFixed(1)}m），移动到: (${this.position.x.toFixed(2)}, ${this.position.y.toFixed(2)}, ${this.position.z.toFixed(2)}) [高度限制: ${MIN_HEIGHT.toFixed(1)}-${MAX_HEIGHT.toFixed(1)}m]`);
        this.consecutiveCollisions = 0;
        return true;
      }
    }

    console.log(`❌ 脱困失败，所有方向（包括3D + 随机）都有障碍物`);
    return false;
  }

  /**
   * 获取可见点云 (传感器范围内的点)
   */
  getVisiblePoints() {
    const visible = [];

    for (const point of this.scenePoints) {
      const dx = point.x - this.position.x;
      const dy = point.y - this.position.y;
      const dz = point.z - this.position.z;
      const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);

      if (distance <= this.sensorRange) {
        visible.push(point);
      }
    }

    // 随机采样到目标密度
    if (visible.length > this.pointCloudDensity) {
      const sampled = [];
      const step = visible.length / this.pointCloudDensity;
      for (let i = 0; i < this.pointCloudDensity; i++) {
        const idx = Math.floor(i * step);
        sampled.push(visible[idx]);
      }
      return sampled;
    }

    return visible;
  }

  /**
   * 发布心跳
   */
  publishHeartbeat() {
    const heartbeat = {
      seqenceId: this.seqId++,
      timestamp: Date.now(),
      status: 'OK'
    };

    // 这里简化为JSON,实际应该用protobuf编码
    this.mqttClient.publish('/daf/heartbeat', JSON.stringify(heartbeat));
  }

  /**
   * 发布位姿
   */
  publishOdometry() {
    const odometry = {
      pose: {
        position: { ...this.position },
        orientation: { ...this.orientation }
      },
      twist: {
        linear: { ...this.velocity },
        angular: { x: 0, y: 0, z: 0 }
      },
      timestamp: Date.now()
    };

    this.mqttClient.publish('/daf/local/odometry', JSON.stringify(odometry));
  }

  /**
   * 发布点云
   */
  publishPointCloud() {
    const visiblePoints = this.getVisiblePoints();

    const pointcloud = {
      points: visiblePoints,
      timestamp: Date.now(),
      frame_id: 'lidar'
    };

    this.mqttClient.publish('/daf/pointcloud', JSON.stringify(pointcloud));
  }
}

// 命令行启动
if (require.main === module) {
  const args = process.argv.slice(2);
  const sceneFile = args[0] || 'scene.txt';
  const broker = args[1] || 'mqtt://127.0.0.1:1883';

  const simulator = new DroneSimulator(sceneFile, broker);

  (async () => {
    await simulator.loadScene();
    await simulator.connectMQTT();
    simulator.start();

    // 示例: 5秒后移动到(3, 3, 1)
    setTimeout(() => {
      simulator.setTarget(3, 3, 1);
    }, 5000);

    // Ctrl+C 优雅退出
    process.on('SIGINT', () => {
      console.log('\n👋 退出模拟器...');
      simulator.stop();
      process.exit(0);
    });
  })();
}

module.exports = DroneSimulator;
