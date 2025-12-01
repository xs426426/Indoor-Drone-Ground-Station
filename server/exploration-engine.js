const EventEmitter = require('events');
const OccupancyGrid = require('./occupancy-grid');

/**
 * Web端自主探索引擎
 * 基于前沿点检测的探索算法
 */
class ExplorationEngine extends EventEmitter {
  constructor(mqttClient) {
    super();
    this.mqtt = mqttClient;

    // 配置参数
    this.config = {
      mapWidth: 100,          // 地图宽度（格子数）= 20m
      mapHeight: 100,         // 地图高度（格子数）= 20m
      resolution: 0.2,        // 分辨率（米/格子）
      maxDistance: 20,        // 最大探索距离（米）
      maxDuration: 600,       // 最大探索时间（秒）
      clusterRadius: 1.0,     // 前沿点聚类半径（米）
      minClusterSize: 5,      // 最小簇大小
      explorationHeight: 1.0, // 探索飞行高度（米）
      updateInterval: 500,    // 探索更新间隔（毫秒）- 提升至500ms（原2000ms）
      // 新增：探索边界
      boundaryMin: null,      // 最小边界 {x, y, z} 自动或自定义
      boundaryMax: null,      // 最大边界 {x, y, z} 自动或自定义
      enableZExploration: true, // 是否启用Z轴探索
      minHeight: 0.5,         // 最小飞行高度（米）
      maxHeight: 3.0,         // 最大飞行高度（米）
      // ✅ ROI区域限定探索
      roiPolygon: null,       // 用户绘制的探索区域多边形 [{x, y}, ...]
      useROI: false,          // 是否启用ROI限定
      // ✅ 评分权重可配置化
      scoringWeights: {
        infoGain: 0.5,        // 信息增益权重
        distance: 0.3,        // 距离成本权重
        consistency: 0.3,     // 方向一致性权重
        density: 0.2,         // 密度惩罚权重
        history: 0.2          // 历史惩罚权重
      }
    };

    // 状态变量
    this.isExploring = false;
    this.isPaused = false;
    this.startPos = null;
    this.currentPos = null;
    this.startTime = null;
    this.lastUpdateTime = 0;

    // 地图
    this.map = new OccupancyGrid(
      this.config.mapWidth,
      this.config.mapHeight,
      this.config.resolution
    );

    // 前沿点
    this.frontiers = [];
    this.visitedGoals = [];

    // 不可达目标追踪（解决无限脱困循环）
    this.goalAttempts = new Map();  // 目标尝试次数 {goalKey: count}
    this.unreachableGoals = [];     // 不可达目标黑名单
    this.maxAttempts = 5;           // 最大尝试次数（增加到5次，更宽容）

    // 当前任务
    this.currentMissionId = null;
    this.isWaitingForArrival = false;
    this.isPreparingNextGoal = false;  // 滚动时域规划标志
    this.missionStartTime = null;  // 任务开始时间
    this.arrivalTimeout = 8000;  // 8秒超时（加快探索速度）

    // ✅ 僵死检测（速度监控）
    this.lastVelocityCheck = null;   // 上次速度检查 {x, y, time}
    this.stuckStartTime = null;       // 僵死开始时间
    this.STUCK_THRESHOLD = 3000;      // 僵死判定时间（3秒）
    this.VELOCITY_THRESHOLD = 0.1;    // 速度阈值（0.1m/s）

    // 返航状态
    this.isReturningHome = false;
    this.returnHomeMissionId = null;

    // 场景边界（从点云自动计算）
    this.sceneBounds = null;  // {minX, maxX, minY, maxY, minZ, maxZ}

    // 记录上一个目标方向（用于方向一致性奖励）
    this.lastGoalDirection = null;  // {x, y} 单位向量

    // 探索状态推送计时
    this.lastStatusPublishTime = 0;  // 上次推送状态时间

    console.log('✅ ExplorationEngine initialized');
  }

  /**
   * 从点云数据计算场景边界
   */
  calculateSceneBounds(pointcloud) {
    if (!pointcloud || !pointcloud.points || pointcloud.points.length === 0) return;

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (const point of pointcloud.points) {
      const pos = point.xyz || point;
      if (pos.x < minX) minX = pos.x;
      if (pos.x > maxX) maxX = pos.x;
      if (pos.y < minY) minY = pos.y;
      if (pos.y > maxY) maxY = pos.y;
      if (pos.z < minZ) minZ = pos.z;
      if (pos.z > maxZ) maxZ = pos.z;
    }

    // 添加安全边距（1.5m，更保守避免飞出窗户）
    this.sceneBounds = {
      minX: minX + 1.5,  // 收缩边界，避免飞出窗户
      maxX: maxX - 1.5,
      minY: minY + 1.5,
      maxY: maxY - 1.5,
      minZ: Math.max(0.5, minZ + 0.3),  // Z最小值不低于0.5m（离地高度）
      maxZ: Math.min(2.5, maxZ - 0.5)   // Z最大值不超过2.5m（避免太高）
    };

    console.log('📐 场景边界已计算（收缩1.5m防止飞出窗户）:', this.sceneBounds);
    console.log(`   安全范围: ${(this.sceneBounds.maxX-this.sceneBounds.minX).toFixed(1)}m × ${(this.sceneBounds.maxY-this.sceneBounds.minY).toFixed(1)}m × ${(this.sceneBounds.maxZ-this.sceneBounds.minZ).toFixed(1)}m`);
  }

  /**
   * 检查位置是否在探索边界内
   */
  isWithinBounds(x, y, z) {
    const bounds = this.config.boundaryMin && this.config.boundaryMax
      ? { min: this.config.boundaryMin, max: this.config.boundaryMax }
      : this.sceneBounds
        ? { min: { x: this.sceneBounds.minX, y: this.sceneBounds.minY, z: this.sceneBounds.minZ },
            max: { x: this.sceneBounds.maxX, y: this.sceneBounds.maxY, z: this.sceneBounds.maxZ } }
        : null;

    if (!bounds) return true;  // 无边界限制

    return x >= bounds.min.x && x <= bounds.max.x &&
           y >= bounds.min.y && y <= bounds.max.y &&
           z >= bounds.min.z && z <= bounds.max.z;
  }

  /**
   * 设置ROI探索区域（多边形）
   * @param {Array} polygon - 多边形顶点数组 [{x, y}, ...]
   */
  setROI(polygon) {
    if (!polygon || polygon.length < 3) {
      console.error('❌ ROI多边形至少需要3个顶点');
      return { success: false, message: 'ROI多边形至少需要3个顶点' };
    }

    this.config.roiPolygon = polygon;
    this.config.useROI = true;

    // 计算多边形面积（用于日志）
    const area = this.calculatePolygonArea(polygon);

    console.log(`✅ ROI区域已设置:`);
    console.log(`   顶点数: ${polygon.length}`);
    console.log(`   面积: ${area.toFixed(2)} m²`);
    console.log(`   顶点坐标: ${polygon.map(p => `(${p.x.toFixed(1)},${p.y.toFixed(1)})`).join(', ')}`);

    return { success: true, message: `ROI区域已设置 (${polygon.length}个顶点, ${area.toFixed(2)}m²)` };
  }

  /**
   * 清除ROI限制
   */
  clearROI() {
    this.config.roiPolygon = null;
    this.config.useROI = false;
    console.log('✅ ROI限制已清除');
    return { success: true, message: 'ROI限制已清除' };
  }

  /**
   * 射线法判断点是否在多边形内
   * @param {Object} point - {x, y}
   * @param {Array} polygon - [{x, y}, ...]
   * @returns {boolean}
   */
  isPointInPolygon(point, polygon) {
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;

      // 射线法：从点向右发射射线，计算与多边形边的交点数
      const intersect = ((yi > point.y) !== (yj > point.y)) &&
        (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);

      if (intersect) inside = !inside;
    }

    return inside;
  }

  /**
   * 计算多边形面积（Shoelace公式）
   * @param {Array} polygon - [{x, y}, ...]
   * @returns {number} 面积（平方米）
   */
  calculatePolygonArea(polygon) {
    let area = 0;
    for (let i = 0; i < polygon.length; i++) {
      const j = (i + 1) % polygon.length;
      area += polygon[i].x * polygon[j].y;
      area -= polygon[j].x * polygon[i].y;
    }
    return Math.abs(area / 2);
  }

  /**
   * 设置评分权重
   * @param {Object} weights - 权重对象 {infoGain, distance, consistency, density, history}
   */
  setScoringWeights(weights) {
    const validKeys = ['infoGain', 'distance', 'consistency', 'density', 'history'];

    for (const key of validKeys) {
      if (weights[key] !== undefined) {
        if (typeof weights[key] !== 'number' || weights[key] < 0 || weights[key] > 1) {
          console.error(`❌ 权重 ${key} 必须是0-1之间的数字`);
          return { success: false, message: `权重 ${key} 必须是0-1之间的数字` };
        }
        this.config.scoringWeights[key] = weights[key];
      }
    }

    console.log('✅ 评分权重已更新:');
    console.log(`   信息增益: ${this.config.scoringWeights.infoGain}`);
    console.log(`   距离成本: ${this.config.scoringWeights.distance}`);
    console.log(`   方向一致性: ${this.config.scoringWeights.consistency}`);
    console.log(`   密度惩罚: ${this.config.scoringWeights.density}`);
    console.log(`   历史惩罚: ${this.config.scoringWeights.history}`);

    return { success: true, message: '评分权重已更新', weights: this.config.scoringWeights };
  }

  /**
   * 获取当前评分权重
   */
  getScoringWeights() {
    return { ...this.config.scoringWeights };
  }

  /**
   * 处理点云数据 - 更新地图
   */
  onPointCloudReceived(pointcloud) {
    if (!this.currentPos) return;
    if (!pointcloud || !pointcloud.points || pointcloud.points.length === 0) return;

    // 首次收到点云时计算场景边界
    if (!this.sceneBounds && pointcloud.points.length > 100) {
      this.calculateSceneBounds(pointcloud);
    }

    // 更新地图
    this.updateMapFromPointCloud(pointcloud, this.currentPos);

    // ✅ 定期推送探索状态到前端（每2秒一次）
    const now = Date.now();
    if (!this.lastStatusPublishTime || now - this.lastStatusPublishTime > 2000) {
      if (this.isExploring) {
        this.publishExplorationStatus();
      }
      this.lastStatusPublishTime = now;
    }

    // 检查任务超时（即使在等待到达时也要检查）
    if (this.isWaitingForArrival && this.missionStartTime) {
      const elapsed = Date.now() - this.missionStartTime;
      if (elapsed > this.arrivalTimeout) {
        console.log(`⏰ 任务超时 (${(elapsed/1000).toFixed(1)}s)，规划下一个目标`);

        // 增加目标尝试计数（解决无限重试问题）
        if (this.currentGoal) {
          const goalKey = `${this.currentGoal.x.toFixed(1)},${this.currentGoal.y.toFixed(1)}`;
          const attempts = (this.goalAttempts.get(goalKey) || 0) + 1;
          this.goalAttempts.set(goalKey, attempts);

          console.log(`   目标 (${this.currentGoal.x.toFixed(2)}, ${this.currentGoal.y.toFixed(2)}) 尝试次数: ${attempts}/${this.maxAttempts}`);

          // 超过最大尝试次数，标记为不可达
          if (attempts >= this.maxAttempts) {
            console.log(`   ❌ 目标已标记为不可达，将被过滤`);
            this.unreachableGoals.push({
              x: this.currentGoal.x,
              y: this.currentGoal.y
            });
          }
        }

        this.isWaitingForArrival = false;
        this.currentGoal = null;
        this.missionStartTime = null;
      }
    }

    // 如果正在探索且不在等待到达，尝试发送新目标
    if (this.isExploring && !this.isPaused && !this.isWaitingForArrival) {
      const now = Date.now();
      if (now - this.lastUpdateTime > this.config.updateInterval) {
        this.explorationStep();
        this.lastUpdateTime = now;
      }
    }
  }

  /**
   * 处理位姿更新
   */
  onOdometryReceived(odometry) {
    // 支持两种格式: odometry.pose.position 或 odometry.position
    let position;
    if (odometry && odometry.pose && odometry.pose.position) {
      position = odometry.pose.position;
    } else if (odometry && odometry.position) {
      position = odometry.position;
    } else {
      return;
    }

    const newPos = {
      x: position.x,
      y: position.y,
      z: position.z
    };

    // ✅ 优先检查返航完成（返航比探索优先级更高）
    if (this.isReturningHome && this.startPos) {
      const distToHome = Math.hypot(
        newPos.x - this.startPos.x,
        newPos.y - this.startPos.y
      );

      if (distToHome < 0.5) {  // 50cm阈值认为返航成功
        console.log('🏠 ✅ 返航完成！已到达起点');
        this.isReturningHome = false;
        this.returnHomeMissionId = null;

        this.emit('exploration:returned', {
          position: newPos,
          startPosition: this.startPos
        });
      }
    }

    // 检查是否到达目标（用于自动触发下一步）
    if (this.isWaitingForArrival && this.currentGoal) {
      const dist = Math.hypot(
        newPos.x - this.currentGoal.x,
        newPos.y - this.currentGoal.y
      );

      // ✅ 僵死检测（速度监控）
      if (this.lastVelocityCheck) {
        const dt = Date.now() - this.lastVelocityCheck.time;
        const dx = newPos.x - this.lastVelocityCheck.x;
        const dy = newPos.y - this.lastVelocityCheck.y;
        const velocity = Math.hypot(dx, dy) / (dt / 1000);

        if (velocity < this.VELOCITY_THRESHOLD) {
          // 速度过低
          if (!this.stuckStartTime) {
            this.stuckStartTime = Date.now();
            console.log(`⚠️ 检测到速度过低 (${velocity.toFixed(3)}m/s < ${this.VELOCITY_THRESHOLD}m/s)，开始计时...`);
          } else {
            const stuckDuration = Date.now() - this.stuckStartTime;
            if (stuckDuration > this.STUCK_THRESHOLD) {
              console.log(`🚫 僵死检测：速度过低超过${(this.STUCK_THRESHOLD/1000).toFixed(1)}秒，标记为不可达`);

              // 增加目标尝试计数并标记为不可达（复用超时处理逻辑）
              if (this.currentGoal) {
                const goalKey = `${this.currentGoal.x.toFixed(1)},${this.currentGoal.y.toFixed(1)}`;
                const attempts = (this.goalAttempts.get(goalKey) || 0) + 1;
                this.goalAttempts.set(goalKey, attempts);

                console.log(`   目标 (${this.currentGoal.x.toFixed(2)}, ${this.currentGoal.y.toFixed(2)}) 尝试次数: ${attempts}/${this.maxAttempts}`);

                // 超过最大尝试次数，标记为不可达
                if (attempts >= this.maxAttempts) {
                  console.log(`   ❌ 目标已标记为不可达，将被过滤`);
                  this.unreachableGoals.push({
                    x: this.currentGoal.x,
                    y: this.currentGoal.y
                  });
                }
              }

              this.isWaitingForArrival = false;
              this.currentGoal = null;
              this.missionStartTime = null;
              this.stuckStartTime = null;
              this.lastVelocityCheck = null;
              return;
            }
          }
        } else {
          // 速度正常，重置僵死计时
          if (this.stuckStartTime) {
            console.log(`✅ 速度恢复正常 (${velocity.toFixed(2)}m/s)，重置僵死计时`);
            this.stuckStartTime = null;
          }
        }
      }

      // 更新速度检查记录（每次位姿更新都记录）
      this.lastVelocityCheck = {
        x: newPos.x,
        y: newPos.y,
        time: Date.now()
      };

      // 滚动时域规划：提前触发下一次规划（距离目标还有1.5m时）
      const RECEDING_HORIZON_DISTANCE = 1.5;  // 提前触发距离（米）

      if (dist <= RECEDING_HORIZON_DISTANCE && !this.isPreparingNextGoal) {
        console.log(`🔄 接近目标（剩余${dist.toFixed(2)}m），提前规划下一目标...`);
        this.isPreparingNextGoal = true;  // 标记正在准备下一目标
        // 触发探索更新（会在主循环中计算下一个目标）
        // 注意：不在这里直接调用，而是在探索主循环中检测
      }

      if (dist < 0.3) {  // 30cm阈值
        console.log('✅ Arrived at goal');

        // 记录到达的目标到历史（避免重复尝试）
        this.visitedGoals.push({
          x: this.currentGoal.x,
          y: this.currentGoal.y
        });

        // 清除该目标的尝试计数（成功到达）
        const goalKey = `${this.currentGoal.x.toFixed(1)},${this.currentGoal.y.toFixed(1)}`;
        this.goalAttempts.delete(goalKey);

        this.isWaitingForArrival = false;
        this.currentGoal = null;
        this.missionStartTime = null;  // 清除任务计时
        this.isPreparingNextGoal = false;  // 清除准备标志
        this.stuckStartTime = null;  // 清除僵死计时
        this.lastVelocityCheck = null;  // 清除速度检查记录
      }
    }

    this.currentPos = newPos;
  }

  /**
   * 从点云更新地图
   */
  updateMapFromPointCloud(pointcloud, dronePos) {
    const droneGrid = this.map.worldToGrid(dronePos.x, dronePos.y);

    // 降采样点云（每10个点取1个）
    const sampleRate = 10;
    for (let i = 0; i < pointcloud.points.length; i += sampleRate) {
      const point = pointcloud.points[i];

      // 过滤高度（只处理±1米范围内的点）
      if (Math.abs(point.z - dronePos.z) > 1.0) continue;

      // 投影到2D
      const obstacleGrid = this.map.worldToGrid(point.x, point.y);

      if (!this.map.isInMap(obstacleGrid.x, obstacleGrid.y)) continue;

      // 光线追踪：从无人机到障碍物的路径标记为空闲
      this.map.raytrace(
        droneGrid.x, droneGrid.y,
        obstacleGrid.x, obstacleGrid.y
      );

      // 障碍物点标记为占据
      this.map.setOccupancy(obstacleGrid.x, obstacleGrid.y, -1);
    }

    // 更新膨胀地图（考虑无人机体积）
    this.map.inflateObstacles();
  }

  /**
   * 启动探索
   */
  async startExploration(options = {}) {
    if (this.isExploring) {
      console.warn('⚠️ Exploration already running');
      return { success: false, message: '探索已在运行' };
    }

    // 如果提供了自定义起点，使用它；否则使用当前位置
    if (options.startPosition) {
      this.currentPos = {
        x: options.startPosition.x,
        y: options.startPosition.y,
        z: options.startPosition.z
      };
      console.log('📍 使用自定义起点:', this.currentPos);
    }

    if (!this.currentPos) {
      console.warn('⚠️ No current position');
      return { success: false, message: '无当前位置信息，请先设置起点或等待MQTT位姿数据' };
    }

    // 合并配置
    Object.assign(this.config, options);

    // 初始化状态 - 但先不设置isExploring=true，避免点云触发探索步骤
    this.isPaused = false;
    this.startPos = { ...this.currentPos };
    this.startTime = Date.now();
    this.lastUpdateTime = 0;
    this.visitedGoals = [];
    this.isWaitingForArrival = false;
    this.missionStartTime = null;

    // 同步模拟器位置到起点（无论是自定义起点还是MQTT位置）
    console.log('📍 准备同步模拟器位置到起点:', this.startPos);
    this.mqtt.client.publish('/daf/simulator/set_position',
      JSON.stringify(this.startPos));
    console.log('📍 已发布位置同步消息');

    // 同步高度限制配置到模拟器（确保脱困时遵守用户设置）
    console.log('📏 准备同步高度限制到模拟器:', {
      minHeight: this.config.minHeight,
      maxHeight: this.config.maxHeight
    });
    this.mqtt.client.publish('/daf/simulator/set_height_limits',
      JSON.stringify({
        minHeight: this.config.minHeight,
        maxHeight: this.config.maxHeight
      }));
    console.log('📏 已发布高度限制配置');

    // 等待一小段时间确保模拟器收到并处理了位置更新和高度限制
    await new Promise(resolve => setTimeout(resolve, 100));

    // 重置地图
    this.map = new OccupancyGrid(
      this.config.mapWidth,
      this.config.mapHeight,
      this.config.resolution
    );

    // 初始化起点周围为自由空间（否则无法找到前沿点）
    const startGrid = this.map.worldToGrid(this.startPos.x, this.startPos.y);
    const radius = 15; // 15格半径（3米），合理的初始化范围
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const gx = startGrid.x + dx;
        const gy = startGrid.y + dy;
        if (this.map.isInMap(gx, gy)) {
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= radius) {
            this.map.setOccupancy(gx, gy, 1); // 标记为自由空间
          }
        }
      }
    }

    console.log('🚀 Exploration started at', this.startPos);
    console.log('🗺️ 初始化地图: 起点周围', (radius * this.config.resolution).toFixed(1), 'm已标记为自由空间');

    // ⭐ 现在才设置isExploring=true，确保地图已初始化
    this.isExploring = true;

    this.emit('exploration:started', {
      startPos: this.startPos,
      config: this.config
    });

    // 立即执行第一步
    setTimeout(() => this.explorationStep(), 500);

    return { success: true, message: '探索已启动' };
  }

  /**
   * 暂停探索
   */
  pauseExploration() {
    if (!this.isExploring) return { success: false, message: '未在探索中' };

    this.isPaused = true;
    console.log('⏸️ Exploration paused');
    this.emit('exploration:paused');

    return { success: true, message: '探索已暂停' };
  }

  /**
   * 恢复探索
   */
  resumeExploration() {
    if (!this.isExploring) return { success: false, message: '未在探索中' };

    this.isPaused = false;
    this.isWaitingForArrival = false;
    console.log('▶️ Exploration resumed');
    this.emit('exploration:resumed');

    // 立即执行下一步
    this.explorationStep();

    return { success: true, message: '探索已恢复' };
  }

  /**
   * 停止探索
   */
  stopExploration(reason = 'manual') {
    if (!this.isExploring) return { success: false, message: '未在探索中' };

    this.isExploring = false;
    this.isPaused = false;
    this.isWaitingForArrival = false;

    // 计算距离起点
    const distanceFromStart = this.startPos ? Math.hypot(
      this.currentPos.x - this.startPos.x,
      this.currentPos.y - this.startPos.y
    ) : 0;

    console.log(`🛑 Exploration stopped (${reason})`);
    console.log(`   探索面积: ${this.map.getExploredArea().toFixed(2)} m²`);
    console.log(`   距起点: ${distanceFromStart.toFixed(2)} m`);

    // ✅ 如果距离起点超过1米，自动返航
    if (this.startPos && distanceFromStart > 1.0) {
      console.log('🏠 开始返航到起点...');
      this.returnToHome();
    } else {
      this.emit('exploration:stopped', {
        reason: reason,
        exploredArea: this.map.getExploredArea(),
        duration: (Date.now() - this.startTime) / 1000,
        distanceFromStart: distanceFromStart
      });
    }

    return { success: true, message: '探索已停止' };
  }

  /**
   * 返航到起点
   */
  returnToHome() {
    if (!this.startPos || !this.currentPos) {
      console.log('⚠️ 无起点信息，取消返航');
      return;
    }

    // 检查返航路径是否畅通
    const pathClear = this.isPathClear(this.currentPos, this.startPos);

    console.log(`🏠 规划返航路径: (${this.currentPos.x.toFixed(2)}, ${this.currentPos.y.toFixed(2)}) → (${this.startPos.x.toFixed(2)}, ${this.startPos.y.toFixed(2)})`);
    console.log(`   路径状态: ${pathClear ? '✅ 畅通' : '⚠️ 需要绕行'}`);

    // 下发返航任务
    const missionId = `return_home_${Date.now()}`;

    const mission = {
      id: missionId,
      tasks: [
        {
          autoPilot: {
            position: {
              x: this.startPos.x,
              y: this.startPos.y,
              z: this.startPos.z
            },
            yaw: 0,
            cameraParam: {
              on: false,
              mode: 0,
              interval: 0
            }
          }
        }
      ]
    };

    this.mqtt.publishMission(mission);

    setTimeout(() => {
      this.mqtt.publishExecution({
        id: missionId,
        action: 0  // START
      });
    }, 500);

    console.log(`🏠 返航任务已下发`);

    // 监听返航完成
    this.isReturningHome = true;
    this.returnHomeMissionId = missionId;
  }

  /**
   * 探索主循环
   */
  explorationStep() {
    // 滚动时域规划：允许在接近目标时继续规划
    if (!this.isExploring || this.isPaused) {
      return;
    }

    // 如果正在等待到达且未触发提前规划，跳过
    if (this.isWaitingForArrival && !this.isPreparingNextGoal) {
      return;
    }

    // 滚动时域：如果已经触发提前规划，允许继续
    if (this.isPreparingNextGoal) {
      console.log('📋 滚动时域规划：准备下一个目标');
      this.isWaitingForArrival = false;  // 解除等待
    }

    // 检查超时
    const elapsed = (Date.now() - this.startTime) / 1000;
    if (elapsed > this.config.maxDuration) {
      console.log('⏰ Max duration reached');
      this.stopExploration('timeout');
      return;
    }

    // 检查距离
    const distance = Math.hypot(
      this.currentPos.x - this.startPos.x,
      this.currentPos.y - this.startPos.y
    );
    if (distance > this.config.maxDistance) {
      console.log('📏 Max distance reached');
      this.stopExploration('max_distance');
      return;
    }

    // 1. 检测前沿点
    this.frontiers = this.detectFrontiers();

    console.log(`🔍 Detected ${this.frontiers.length} frontier clusters`);

    if (this.frontiers.length === 0) {
      console.log('✅ Exploration complete - no more frontiers');
      this.stopExploration('complete');
      return;
    }

    // 2. 选择最优前沿点
    const nextGoal = this.selectBestFrontier(this.frontiers, this.currentPos);

    if (!nextGoal) {
      console.log('⚠️ No valid frontier selected');
      this.stopExploration('no_valid_frontier');
      return;
    }

    // 3. 下发任务
    this.currentGoal = nextGoal;
    this.isWaitingForArrival = true;
    this.isPreparingNextGoal = false;  // 重置准备标志
    this.missionStartTime = Date.now();  // 记录任务开始时间
    this.publishExplorationMission(nextGoal);

    // 4. 发布探索状态
    this.publishExplorationStatus();
  }

  /**
   * 检测前沿点
   */
  detectFrontiers() {
    const frontierCandidates = [];

    // 限制搜索范围（以当前位置为中心）
    const droneGrid = this.map.worldToGrid(this.currentPos.x, this.currentPos.y);
    const searchRadius = Math.floor(this.config.maxDistance / this.config.resolution);

    const xMin = Math.max(1, droneGrid.x - searchRadius);
    const xMax = Math.min(this.map.width - 2, droneGrid.x + searchRadius);
    const yMin = Math.max(1, droneGrid.y - searchRadius);
    const yMax = Math.min(this.map.height - 2, droneGrid.y + searchRadius);

    // 遍历地图
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        // 检查是否为空闲格子
        if (this.map.getOccupancy(x, y) === 1) {
          // 检查8邻域是否有未知格子
          if (this.hasUnknownNeighbor(x, y)) {
            const worldPos = this.map.gridToWorld(x, y);
            frontierCandidates.push(worldPos);
          }
        }
      }
    }

    // 聚类前沿点
    return this.clusterFrontiers(frontierCandidates);
  }

  /**
   * 检查是否有未知邻居
   */
  hasUnknownNeighbor(gx, gy) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;

        const nx = gx + dx;
        const ny = gy + dy;

        if (this.map.getOccupancy(nx, ny) === 0) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 聚类前沿点
   */
  clusterFrontiers(rawFrontiers) {
    if (rawFrontiers.length === 0) return [];

    const clusters = [];
    const visited = new Set();
    const clusterRadius = this.config.clusterRadius;

    for (let i = 0; i < rawFrontiers.length; i++) {
      if (visited.has(i)) continue;

      const cluster = [rawFrontiers[i]];
      visited.add(i);

      // 找到所有邻近点
      for (let j = i + 1; j < rawFrontiers.length; j++) {
        if (visited.has(j)) continue;

        const dist = Math.hypot(
          rawFrontiers[i].x - rawFrontiers[j].x,
          rawFrontiers[i].y - rawFrontiers[j].y
        );

        if (dist < clusterRadius) {
          cluster.push(rawFrontiers[j]);
          visited.add(j);
        }
      }

      // 过滤太小的簇
      if (cluster.length >= this.config.minClusterSize) {
        // 计算簇中心
        const center = {
          x: cluster.reduce((sum, p) => sum + p.x, 0) / cluster.length,
          y: cluster.reduce((sum, p) => sum + p.y, 0) / cluster.length,
          size: cluster.length
        };
        clusters.push(center);
      }
    }

    return clusters;
  }

  /**
   * 计算点云密度（某位置周围的障碍物密度 + 未知区域风险）
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @param {number} radius - 检测半径（米）
   * @returns {number} 密度值 (0-1，越高越密集/危险)
   */
  calculatePointCloudDensity(x, y, radius = 2.0) {
    const grid = this.map.worldToGrid(x, y);
    const radiusInGrids = Math.ceil(radius / this.config.resolution);

    let obstacleCount = 0;    // 明确的障碍物
    let unknownCount = 0;      // 未知区域
    let freeCount = 0;         // 自由空间
    let totalCount = 0;

    for (let dx = -radiusInGrids; dx <= radiusInGrids; dx++) {
      for (let dy = -radiusInGrids; dy <= radiusInGrids; dy++) {
        const gx = grid.x + dx;
        const gy = grid.y + dy;

        if (!this.map.isInMap(gx, gy)) continue;

        const distance = Math.sqrt(dx * dx + dy * dy) * this.config.resolution;
        if (distance > radius) continue;

        totalCount++;
        const occupancy = this.map.getOccupancy(gx, gy);

        if (occupancy < -0.5) {
          obstacleCount++;      // 障碍物
        } else if (occupancy === 0) {
          unknownCount++;       // 未知区域
        } else {
          freeCount++;          // 自由空间
        }
      }
    }

    if (totalCount === 0) return 0.5;  // 默认中等风险

    // 综合密度：障碍物 + 部分未知区域
    const obstacleDensity = obstacleCount / totalCount;
    const unknownDensity = unknownCount / totalCount;

    // 未知区域有一定风险，计入30%
    const density = obstacleDensity + 0.3 * unknownDensity;

    return Math.min(density, 1.0);
  }

  /**
   * 统计指定位置周围的障碍物数量（用于窗户检测）
   * @param {number} x - 世界坐标X
   * @param {number} y - 世界坐标Y
   * @param {number} radius - 检测半径（米）
   * @returns {number} 障碍物格子数量
   */
  countNearbyObstacles(x, y, radius = 1.5) {
    const grid = this.map.worldToGrid(x, y);
    const radiusInGrids = Math.ceil(radius / this.config.resolution);

    let obstacleCount = 0;

    for (let dx = -radiusInGrids; dx <= radiusInGrids; dx++) {
      for (let dy = -radiusInGrids; dy <= radiusInGrids; dy++) {
        const gx = grid.x + dx;
        const gy = grid.y + dy;

        if (!this.map.isInMap(gx, gy)) continue;

        const distance = Math.sqrt(dx * dx + dy * dy) * this.config.resolution;
        if (distance > radius) continue;

        const occupancy = this.map.getOccupancy(gx, gy);

        // 只统计明确的障碍物 (occupancy < -0.5)
        if (occupancy < -0.5) {
          obstacleCount++;
        }
      }
    }

    return obstacleCount;
  }

  /**
   * Bresenham直线算法（光线追踪）
   * @param {number} x0 - 起点X
   * @param {number} y0 - 起点Y
   * @param {number} x1 - 终点X
   * @param {number} y1 - 终点Y
   * @returns {Array} 路径上的栅格点数组 [{x, y}, ...]
   */
  bresenhamLine(x0, y0, x1, y1) {
    const points = [];
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    let x = x0;
    let y = y0;

    while (true) {
      points.push({ x, y });

      if (x === x1 && y === y1) break;

      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }

    return points;
  }

  /**
   * 检查从当前位置到目标的路径是否可达（没有障碍物）
   * @param {object} start - 起点 {x, y}
   * @param {object} goal - 终点 {x, y}
   * @returns {boolean} true=可达, false=不可达
   */
  isPathClear(start, goal) {
    // 转换为栅格坐标
    const startGrid = this.map.worldToGrid(start.x, start.y);
    const goalGrid = this.map.worldToGrid(goal.x, goal.y);

    // 光线追踪：Bresenham算法
    const points = this.bresenhamLine(startGrid.x, startGrid.y, goalGrid.x, goalGrid.y);

    // 检查路径上每个格子
    for (const point of points) {
      if (!this.map.isInMap(point.x, point.y)) {
        return false;  // 超出地图
      }

      const occupancy = this.map.getInflatedOccupancy(point.x, point.y);

      // 路径检查：使用膨胀地图，考虑无人机体积
      // 地图数据定义：1=空闲, 0=未知, -1=占据（见occupancy-grid.js:17）
      // 膨胀地图已经考虑了无人机半径（0.3m），所以单根线检查即可安全
      // occupancy === 1  → 明确的空闲空间（可安全通过）✅
      // occupancy === 0  → 未知区域（不可通过，避免进入未探索区域）❌
      // occupancy === -1 → 障碍物或膨胀区域（不可通过）❌
      if (occupancy !== 1) {  // 只允许明确空闲的格子通过
        return false;
      }
    }

    return true;  // 路径畅通
  }

  /**
   * 选择最优前沿点（支持Z轴探索）
   */
  selectBestFrontier(frontiers, currentPos) {
    let bestScore = -Infinity;
    let bestFrontier = null;

    for (const frontier of frontiers) {
      // 0. ✅ ROI区域过滤（最优先检查）
      if (this.config.useROI && this.config.roiPolygon) {
        if (!this.isPointInPolygon(frontier, this.config.roiPolygon)) {
          // 跳过ROI区域外的前沿点（不输出日志，避免刷屏）
          continue;
        }
      }

      // 1. 检查是否在不可达目标黑名单中
      const isUnreachable = this.unreachableGoals.some(goal => {
        const dist = Math.hypot(frontier.x - goal.x, frontier.y - goal.y);
        return dist < 2.0;  // 2.0m范围内认为接近不可达区域（扩大至2m，避免Z字形反复尝试）
      });

      if (isUnreachable) {
        const minDist = Math.min(...this.unreachableGoals.map(g => Math.hypot(frontier.x - g.x, frontier.y - g.y)));
        console.log(`   跳过前沿点 (${frontier.x.toFixed(2)}, ${frontier.y.toFixed(2)}) - 接近不可达区域 (距离${minDist.toFixed(2)}m)`);
        continue;  // 跳过不可达目标周围区域
      }

      // 1. ✅ 新增：检查路径可达性（利用地图信息，避免碰撞）
      const pathClear = this.isPathClear(currentPos, frontier);
      if (!pathClear) {
        console.log(`   跳过前沿点 (${frontier.x.toFixed(2)}, ${frontier.y.toFixed(2)}) - 路径被阻挡`);
        continue;  // 路径不通，跳过
      }

      // 1.5. ✅ 窗户陷阱检测：检查前沿点周围是否有足够的障碍物
      // 重要：只在探索面积 > 50m² 后启用（避免探索初期误判）
      if (this.map.getExploredArea() > 50) {
        const nearbyObstacleCount = this.countNearbyObstacles(frontier.x, frontier.y, 1.5);
        if (nearbyObstacleCount === 0) {
          console.log(`   ⚠️ 跳过前沿点 (${frontier.x.toFixed(2)}, ${frontier.y.toFixed(2)}) - 周围无障碍物，疑似窗户`);
          continue;  // 可能是窗户，跳过
        }
      }

      // 2. 检查前沿点是否在自由空间中（避免选中障碍物内的点）
      const grid = this.map.worldToGrid(frontier.x, frontier.y);
      if (!this.map.isInMap(grid.x, grid.y)) continue;

      const occupancy = this.map.getOccupancy(grid.x, grid.y);
      // 地图数据定义：1=空闲, 0=未知, -1=占据
      // 前沿点通常在未知区域边界，所以 occupancy=0 或 occupancy=1 都可接受
      // 但如果前沿点在明确的障碍物中（occupancy=-1），则跳过
      if (occupancy === -1) {
        continue;  // 在障碍物中，跳过
      }

      // 1. 距离成本（水平距离）
      const distance = Math.hypot(
        frontier.x - currentPos.x,
        frontier.y - currentPos.y
      );

      // 过滤太近的点
      if (distance < 0.5) continue;

      // 过滤太远的点（避免飞太远）
      if (distance > 15) continue;

      // 2. 决定目标高度（Z轴探索）
      let targetHeight = this.config.explorationHeight;

      if (this.config.enableZExploration) {
        // Z轴探索：根据场景边界动态调整高度
        const minZ = this.config.minHeight;
        const maxZ = this.config.maxHeight;

        // 策略：在允许范围内上下变化，探索不同高度
        // 每个目标点根据位置选择一个高度层
        const heightLevels = [];
        for (let h = minZ; h <= maxZ; h += 0.5) {
          heightLevels.push(h);
        }

        // 根据前沿点位置选择高度（使用哈希使同一位置总是得到相同高度）
        const hash = Math.floor(frontier.x * 10) + Math.floor(frontier.y * 10);
        targetHeight = heightLevels[Math.abs(hash) % heightLevels.length];

        // 限制在配置范围内
        targetHeight = Math.max(minZ, Math.min(maxZ, targetHeight));
      }

      // 检查目标位置是否在边界内
      if (!this.isWithinBounds(frontier.x, frontier.y, targetHeight)) {
        continue;  // 超出边界，跳过
      }

      const distanceCost = 1.0 / (1.0 + distance);

      // 3. 信息增益（簇大小）
      const infoGain = Math.min((frontier.size || 1) / 50.0, 1.0);

      // 4. 历史惩罚（加强惩罚，避免重复尝试失败的点）
      let historyPenalty = 0;
      let skipThisFrontier = false;
      for (const visited of this.visitedGoals) {
        const dist = Math.hypot(frontier.x - visited.x, frontier.y - visited.y);
        // 完全相同的点（距离 < 0.3m）直接跳过
        if (dist < 0.3) {
          skipThisFrontier = true;
          break;
        }
        // 距离越近惩罚越大
        if (dist < 2.0) {
          historyPenalty += 0.5 * (1.0 - dist / 2.0);
        }
      }

      // 跳过已尝试过的点
      if (skipThisFrontier) continue;

      // 5. 点云密度惩罚（优先选择低密度区域）
      const density = this.calculatePointCloudDensity(frontier.x, frontier.y, 2.0);
      const densityPenalty = density;  // 密度越高，惩罚越大

      // 6. 方向一致性奖励（避免频繁掉头）
      let directionBonus = 0;
      if (this.lastGoalDirection) {
        // 计算当前方向
        const currentDir = {
          x: (frontier.x - currentPos.x) / distance,
          y: (frontier.y - currentPos.y) / distance
        };
        // 点积：-1（反向）到 1（同向）
        const dotProduct = currentDir.x * this.lastGoalDirection.x +
                          currentDir.y * this.lastGoalDirection.y;
        // 方向一致性：同向得分高
        directionBonus = Math.max(0, dotProduct) * this.config.scoringWeights.consistency;
      }

      // ✅ 综合评分（使用可配置权重）
      const weights = this.config.scoringWeights;
      const score =
        weights.distance * distanceCost +      // 距离成本
        weights.infoGain * infoGain +          // 信息增益
        -weights.history * historyPenalty +    // 历史惩罚
        -weights.density * densityPenalty +    // 密度惩罚
        directionBonus;                        // 方向一致性奖励

      if (score > bestScore) {
        bestScore = score;
        bestFrontier = {
          ...frontier,
          z: targetHeight,
          density: density,     // 记录密度用于日志
          pathClear: true       // 标记路径畅通
        };
      }
    }

    if (bestFrontier) {
      // 更新方向记录
      const dist = Math.hypot(
        bestFrontier.x - currentPos.x,
        bestFrontier.y - currentPos.y
      );
      this.lastGoalDirection = {
        x: (bestFrontier.x - currentPos.x) / dist,
        y: (bestFrontier.y - currentPos.y) / dist
      };

      // 不在这里记录历史，而是在实际到达时记录（onOdometryReceived）
      console.log(`🎯 Selected frontier at (${bestFrontier.x.toFixed(2)}, ${bestFrontier.y.toFixed(2)}, ${bestFrontier.z.toFixed(2)}) score=${bestScore.toFixed(3)} density=${bestFrontier.density.toFixed(2)} pathClear=✅`);
    }

    return bestFrontier;
  }

  /**
   * 生成路径路点（简化版直线插值）
   * @param {Object} start - 起点 {x, y, z}
   * @param {Object} goal - 终点 {x, y, z}
   * @returns {Array} 路点数组
   */
  generateWaypoints(start, goal) {
    const distance = Math.hypot(goal.x - start.x, goal.y - start.y);

    // 每2米一个路点，最少2个路点
    const numWaypoints = Math.max(2, Math.floor(distance / 2.0));

    const waypoints = [];
    for (let i = 1; i <= numWaypoints; i++) {
      const t = i / numWaypoints;
      waypoints.push({
        x: start.x + (goal.x - start.x) * t,
        y: start.y + (goal.y - start.y) * t,
        z: start.z + (goal.z - start.z) * t
      });
    }

    return waypoints;
  }

  /**
   * 下发探索任务（非阻塞式路点队列）
   */
  publishExplorationMission(goal) {
    const missionId = `exploration_${Date.now()}`;
    this.currentMissionId = missionId;

    // ✅ 生成路径路点（而非单个目标点）
    const waypoints = this.generateWaypoints(this.currentPos, goal);

    console.log(`📤 生成路径任务: ${waypoints.length}个路点`);

    const mission = {
      id: missionId,
      tasks: waypoints.map((wp, index) => ({
        autoPilot: {
          position: {
            x: wp.x,
            y: wp.y,
            z: wp.z
          },
          yaw: 0,
          cameraParam: {
            on: false,
            mode: 0,
            interval: 0
          }
        }
      }))
    };

    // 通过MQTT下发
    this.mqtt.publishMission(mission);

    // 自动开始执行
    setTimeout(() => {
      this.mqtt.publishExecution({
        id: missionId,
        action: 0  // START
      });
    }, 500);

    console.log(`📋 Mission ${missionId} published: ${waypoints.length}个路点 → goal (${goal.x.toFixed(2)}, ${goal.y.toFixed(2)}, ${(goal.z || this.config.explorationHeight).toFixed(2)})`);
  }

  /**
   * 发布探索状态
   */
  publishExplorationStatus() {
    const status = {
      isExploring: this.isExploring,
      isPaused: this.isPaused,
      frontiersCount: this.frontiers.length,
      exploredArea: this.map.getExploredArea(),
      exploredPercentage: this.map.getExploredPercentage(),
      elapsedTime: this.startTime ? (Date.now() - this.startTime) / 1000 : 0,
      distanceFromStart: this.startPos ? Math.hypot(
        this.currentPos.x - this.startPos.x,
        this.currentPos.y - this.startPos.y
      ) : 0,
      currentGoal: this.currentGoal,
      mapStats: this.map.stats
    };

    this.emit('exploration:status', status);
    return status;
  }

  /**
   * 获取地图数据（用于可视化）
   */
  getMapData() {
    return this.map.exportData();
  }

  /**
   * 重置探索引擎
   */
  reset() {
    this.stopExploration();
    this.map.reset();
    this.frontiers = [];
    this.visitedGoals = [];
    console.log('🔄 ExplorationEngine reset');
  }
}

module.exports = ExplorationEngine;
