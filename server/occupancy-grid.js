/**
 * 占据栅格地图
 * 用于Web端探索的2D地图表示
 */
class OccupancyGrid {
  constructor(width, height, resolution) {
    this.width = width;           // 格子数（X方向）
    this.height = height;          // 格子数（Y方向）
    this.resolution = resolution;  // 每格分辨率（米）

    // 地图原点（世界坐标）
    this.origin = {
      x: -width * resolution / 2,
      y: -height * resolution / 2
    };

    // 地图数据：0=未知, 1=空闲, -1=占据
    this.data = new Int8Array(width * height).fill(0);

    // 膨胀地图：考虑无人机体积的安全地图
    // 0=未知, 1=空闲, -1=占据（已膨胀）
    this.inflatedData = new Int8Array(width * height).fill(0);

    // 无人机半径（米）+ 安全余量
    // 降低至0.2m（原0.3m），信任DF Planner局部避障能力
    this.robotRadius = 0.2;  // 无人机半径约15cm + 5cm安全余量
    this.inflationRadius = Math.ceil(this.robotRadius / this.resolution);  // 转换为格子数

    // 统计信息
    this.stats = {
      unknown: width * height,
      free: 0,
      occupied: 0
    };
  }

  /**
   * 世界坐标转栅格坐标
   */
  worldToGrid(x, y) {
    const gx = Math.floor((x - this.origin.x) / this.resolution);
    const gy = Math.floor((y - this.origin.y) / this.resolution);
    return { x: gx, y: gy };
  }

  /**
   * 栅格坐标转世界坐标（中心点）
   */
  gridToWorld(gx, gy) {
    const x = (gx + 0.5) * this.resolution + this.origin.x;
    const y = (gy + 0.5) * this.resolution + this.origin.y;
    return { x, y };
  }

  /**
   * 检查是否在地图范围内
   */
  isInMap(gx, gy) {
    return gx >= 0 && gx < this.width && gy >= 0 && gy < this.height;
  }

  /**
   * 获取占据值
   */
  getOccupancy(gx, gy) {
    if (!this.isInMap(gx, gy)) return -1;
    return this.data[gy * this.width + gx];
  }

  /**
   * 设置占据值
   */
  setOccupancy(gx, gy, value) {
    if (!this.isInMap(gx, gy)) return;

    const index = gy * this.width + gx;
    const oldValue = this.data[index];

    if (oldValue !== value) {
      // 更新统计
      this.updateStats(oldValue, value);
      this.data[index] = value;
    }
  }

  /**
   * 更新统计信息
   */
  updateStats(oldValue, newValue) {
    // 减少旧值统计
    if (oldValue === 0) this.stats.unknown--;
    else if (oldValue === 1) this.stats.free--;
    else if (oldValue === -1) this.stats.occupied--;

    // 增加新值统计
    if (newValue === 0) this.stats.unknown++;
    else if (newValue === 1) this.stats.free++;
    else if (newValue === -1) this.stats.occupied++;
  }

  /**
   * Bresenham直线算法（光线追踪）
   * 用于标记从起点到终点路径上的空闲格子
   */
  raytrace(x0, y0, x1, y1) {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    let steps = 0;
    const maxSteps = Math.max(this.width, this.height);

    while (steps < maxSteps) {
      // 标记为空闲（不覆盖已知占据的格子）
      if (this.isInMap(x0, y0) && this.getOccupancy(x0, y0) !== -1) {
        this.setOccupancy(x0, y0, 1);
      }

      if (x0 === x1 && y0 === y1) break;

      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
      steps++;
    }
  }

  /**
   * 获取已探索面积（平方米）
   */
  getExploredArea() {
    const knownCells = this.stats.free + this.stats.occupied;
    const cellArea = this.resolution * this.resolution;
    return knownCells * cellArea;
  }

  /**
   * 获取探索百分比
   */
  getExploredPercentage() {
    const totalCells = this.width * this.height;
    const knownCells = this.stats.free + this.stats.occupied;
    return (knownCells / totalCells * 100).toFixed(1);
  }

  /**
   * 导出地图数据（用于可视化）
   */
  exportData() {
    return {
      width: this.width,
      height: this.height,
      resolution: this.resolution,
      origin: this.origin,
      data: Array.from(this.data),
      stats: { ...this.stats }
    };
  }

  /**
   * 重置地图
   */
  reset() {
    this.data.fill(0);
    this.inflatedData.fill(0);
    this.stats = {
      unknown: this.width * this.height,
      free: 0,
      occupied: 0
    };
  }

  /**
   * 膨胀地图更新（考虑无人机体积）
   * 在设置障碍物时自动调用
   */
  inflateObstacles() {
    // 复制原始地图
    for (let i = 0; i < this.data.length; i++) {
      this.inflatedData[i] = this.data[i];
    }

    // 对每个障碍物格子进行膨胀
    for (let gy = 0; gy < this.height; gy++) {
      for (let gx = 0; gx < this.width; gx++) {
        const index = gy * this.width + gx;

        // 如果是障碍物，膨胀周围区域
        if (this.data[index] === -1) {
          this.inflateCell(gx, gy);
        }
      }
    }
  }

  /**
   * 膨胀单个障碍物格子
   * @param {number} cx - 中心格子X坐标
   * @param {number} cy - 中心格子Y坐标
   */
  inflateCell(cx, cy) {
    const radius = this.inflationRadius;

    // 遍历以(cx, cy)为中心的正方形区域
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const gx = cx + dx;
        const gy = cy + dy;

        if (!this.isInMap(gx, gy)) continue;

        // 计算实际距离（欧氏距离）
        const distance = Math.sqrt(dx * dx + dy * dy);

        // 只膨胀圆形区域内的格子
        if (distance <= radius) {
          const index = gy * this.width + gx;

          // 只膨胀原本是空闲或未知的格子（不覆盖已有障碍物）
          if (this.inflatedData[index] !== -1) {
            this.inflatedData[index] = -1;  // 标记为膨胀障碍物
          }
        }
      }
    }
  }

  /**
   * 获取膨胀地图的占据值（用于路径检查）
   * @param {number} gx - 格子X坐标
   * @param {number} gy - 格子Y坐标
   * @returns {number} 膨胀后的占据值（-1=障碍, 0=未知, 1=空闲）
   */
  getInflatedOccupancy(gx, gy) {
    if (!this.isInMap(gx, gy)) return -1;
    return this.inflatedData[gy * this.width + gx];
  }
}

module.exports = OccupancyGrid;
