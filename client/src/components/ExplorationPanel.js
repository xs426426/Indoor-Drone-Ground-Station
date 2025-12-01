import React, { useState, useEffect } from 'react';
import { Card, Button, Space, Progress, Switch, Statistic, Row, Col, message, InputNumber, Radio } from 'antd';
import {
  CompassOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  StopOutlined,
  EnvironmentOutlined
} from '@ant-design/icons';
import websocket from '../services/websocket';

export default function ExplorationPanel({ startPosition }) {
  const [isExploring, setIsExploring] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [exploredPercentage, setExploredPercentage] = useState(0);
  const [exploredArea, setExploredArea] = useState(0);
  const [frontiersCount, setFrontiersCount] = useState(0);
  const [currentGoal, setCurrentGoal] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [distanceFromStart, setDistanceFromStart] = useState(0);

  // 配置参数
  const [maxDistance, setMaxDistance] = useState(20);
  const [maxDuration, setMaxDuration] = useState(600);
  const [explorationHeight, setExplorationHeight] = useState(1.0);

  // Z轴探索配置
  const [enableZExploration, setEnableZExploration] = useState(true);
  const [minHeight, setMinHeight] = useState(0.5);
  const [maxHeight, setMaxHeight] = useState(3.0);

  // 边界配置
  const [boundaryMode, setBoundaryMode] = useState('auto'); // 'auto' 或 'custom'
  const [customBoundary, setCustomBoundary] = useState({
    minX: -10, maxX: 10,
    minY: -10, maxY: 10,
    minZ: 0, maxZ: 3
  });

  useEffect(() => {
    // 监听探索状态更新
    const handleExplorationStatus = (data) => {
      setIsExploring(data.isExploring || false);
      setIsPaused(data.isPaused || false);
      setExploredPercentage(parseFloat(data.exploredPercentage) || 0);
      setExploredArea(data.exploredArea || 0);
      setFrontiersCount(data.frontiersCount || 0);
      setCurrentGoal(data.currentGoal);
      setElapsedTime(data.elapsedTime || 0);
      setDistanceFromStart(data.distanceFromStart || 0);
    };

    const handleExplorationResponse = (msgData) => {
      const data = msgData.data;
      if (data.success) {
        message.success(data.message || '操作成功');
      } else {
        message.error(data.message || '操作失败');
      }
    };

    // 使用websocket服务的on方法订阅事件
    websocket.on('exploration_status', (msg) => handleExplorationStatus(msg.data || msg));
    websocket.on('exploration_response', handleExplorationResponse);

    return () => {
      // 清理订阅
      websocket.off('exploration_status', handleExplorationStatus);
      websocket.off('exploration_response', handleExplorationResponse);
    };
  }, []);

  /**
   * 开始自主探索
   */
  const handleStartExploration = () => {
    try {
      // 构建配置对象
      const config = {
        maxDistance: maxDistance,
        maxDuration: maxDuration,
        explorationHeight: explorationHeight,
        // Z轴探索配置
        enableZExploration: enableZExploration,
        minHeight: minHeight,
        maxHeight: maxHeight
      };

      // 边界配置
      if (boundaryMode === 'custom') {
        config.boundaryMin = {
          x: customBoundary.minX,
          y: customBoundary.minY,
          z: customBoundary.minZ
        };
        config.boundaryMax = {
          x: customBoundary.maxX,
          y: customBoundary.maxY,
          z: customBoundary.maxZ
        };
        message.success(`🧭 使用自定义边界启动探索...`);
      } else {
        message.success('🧭 使用自动边界检测启动探索...');
      }

      if (startPosition) {
        config.startPosition = startPosition;
        message.success(`🧭 从自定义位置 (${startPosition.x}, ${startPosition.y}, ${startPosition.z}) 开始探索...`);
      }

      websocket.send('start_exploration', config);
    } catch (error) {
      message.error('启动失败: ' + error.message);
    }
  };

  /**
   * 暂停探索
   */
  const handlePauseExploration = () => {
    try {
      websocket.send('pause_exploration', {});
      message.info('⏸️ 正在暂停探索...');
    } catch (error) {
      message.error('暂停失败: ' + error.message);
    }
  };

  /**
   * 恢复探索
   */
  const handleResumeExploration = () => {
    try {
      websocket.send('resume_exploration', {});
      message.info('▶️ 正在恢复探索...');
    } catch (error) {
      message.error('恢复失败: ' + error.message);
    }
  };

  /**
   * 停止探索
   */
  const handleStopExploration = () => {
    try {
      websocket.send('stop_exploration', {});
      message.success('🛑 正在停止探索...');
    } catch (error) {
      message.error('停止失败: ' + error.message);
    }
  };

  // 格式化时间显示
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <Card
      title={<><CompassOutlined /> 自主探索模式</>}
      size="small"
      style={{ marginTop: 12 }}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {/* 探索进度 */}
        <div>
          <div style={{ marginBottom: 8, fontSize: '12px', color: '#666' }}>
            探索进度
          </div>
          <Progress
            percent={Math.round(exploredPercentage)}
            status={isExploring ? 'active' : 'normal'}
            strokeColor={{
              '0%': '#108ee9',
              '100%': '#87d068',
            }}
          />
        </div>

        {/* 统计信息 */}
        <Row gutter={8}>
          <Col span={8}>
            <Statistic
              title="已探索"
              value={exploredArea.toFixed(1)}
              suffix="m²"
              valueStyle={{ fontSize: '14px' }}
            />
          </Col>
          <Col span={8}>
            <Statistic
              title="前沿点"
              value={frontiersCount}
              valueStyle={{ fontSize: '14px' }}
            />
          </Col>
          <Col span={8}>
            <Statistic
              title="用时"
              value={formatTime(elapsedTime)}
              valueStyle={{ fontSize: '14px' }}
            />
          </Col>
        </Row>

        {/* 配置参数 (仅在未探索时显示) */}
        {!isExploring && (
          <div style={{ background: '#f5f5f5', padding: '12px', borderRadius: '4px' }}>
            <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: 8 }}>
              探索参数配置
            </div>
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              {/* 基础参数 */}
              <div>
                <span style={{ fontSize: '12px' }}>最大距离(m): </span>
                <InputNumber
                  size="small"
                  min={5}
                  max={100}
                  value={maxDistance}
                  onChange={setMaxDistance}
                  style={{ width: 80 }}
                />
              </div>
              <div>
                <span style={{ fontSize: '12px' }}>最大时长(秒): </span>
                <InputNumber
                  size="small"
                  min={60}
                  max={1800}
                  step={60}
                  value={maxDuration}
                  onChange={setMaxDuration}
                  style={{ width: 80 }}
                />
              </div>
              <div>
                <span style={{ fontSize: '12px' }}>默认飞行高度(m): </span>
                <InputNumber
                  size="small"
                  min={0.5}
                  max={3.0}
                  step={0.1}
                  value={explorationHeight}
                  onChange={setExplorationHeight}
                  style={{ width: 80 }}
                />
              </div>

              {/* Z轴探索配置 */}
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #ddd' }}>
                <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: 6 }}>
                  Z轴探索配置
                </div>
                <div style={{ marginBottom: 6 }}>
                  <Switch
                    size="small"
                    checked={enableZExploration}
                    onChange={setEnableZExploration}
                  />
                  <span style={{ fontSize: '12px', marginLeft: 8 }}>
                    启用Z轴探索（上下避障）
                  </span>
                </div>
                {enableZExploration && (
                  <>
                    <div>
                      <span style={{ fontSize: '12px' }}>最低高度(m): </span>
                      <InputNumber
                        size="small"
                        min={0.3}
                        max={maxHeight - 0.5}
                        step={0.1}
                        value={minHeight}
                        onChange={setMinHeight}
                        style={{ width: 80 }}
                      />
                    </div>
                    <div>
                      <span style={{ fontSize: '12px' }}>最高高度(m): </span>
                      <InputNumber
                        size="small"
                        min={minHeight + 0.5}
                        max={5.0}
                        step={0.1}
                        value={maxHeight}
                        onChange={setMaxHeight}
                        style={{ width: 80 }}
                      />
                    </div>
                  </>
                )}
              </div>

              {/* 边界配置 */}
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #ddd' }}>
                <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: 6 }}>
                  探索边界配置
                </div>
                <Radio.Group
                  size="small"
                  value={boundaryMode}
                  onChange={(e) => setBoundaryMode(e.target.value)}
                  style={{ marginBottom: 8 }}
                >
                  <Radio value="auto" style={{ fontSize: '12px' }}>
                    自动检测（根据点云大小）
                  </Radio>
                  <Radio value="custom" style={{ fontSize: '12px' }}>
                    自定义边界
                  </Radio>
                </Radio.Group>

                {boundaryMode === 'custom' && (
                  <div style={{ background: '#fff', padding: '8px', borderRadius: '4px' }}>
                    <Row gutter={8}>
                      <Col span={12}>
                        <div style={{ fontSize: '11px', marginBottom: 4 }}>X范围:</div>
                        <Space size={4}>
                          <InputNumber
                            size="small"
                            placeholder="最小X"
                            value={customBoundary.minX}
                            onChange={(v) => setCustomBoundary({ ...customBoundary, minX: v })}
                            style={{ width: 60 }}
                          />
                          <span>~</span>
                          <InputNumber
                            size="small"
                            placeholder="最大X"
                            value={customBoundary.maxX}
                            onChange={(v) => setCustomBoundary({ ...customBoundary, maxX: v })}
                            style={{ width: 60 }}
                          />
                        </Space>
                      </Col>
                      <Col span={12}>
                        <div style={{ fontSize: '11px', marginBottom: 4 }}>Y范围:</div>
                        <Space size={4}>
                          <InputNumber
                            size="small"
                            placeholder="最小Y"
                            value={customBoundary.minY}
                            onChange={(v) => setCustomBoundary({ ...customBoundary, minY: v })}
                            style={{ width: 60 }}
                          />
                          <span>~</span>
                          <InputNumber
                            size="small"
                            placeholder="最大Y"
                            value={customBoundary.maxY}
                            onChange={(v) => setCustomBoundary({ ...customBoundary, maxY: v })}
                            style={{ width: 60 }}
                          />
                        </Space>
                      </Col>
                    </Row>
                    <Row gutter={8} style={{ marginTop: 8 }}>
                      <Col span={12}>
                        <div style={{ fontSize: '11px', marginBottom: 4 }}>Z范围:</div>
                        <Space size={4}>
                          <InputNumber
                            size="small"
                            placeholder="最小Z"
                            value={customBoundary.minZ}
                            onChange={(v) => setCustomBoundary({ ...customBoundary, minZ: v })}
                            style={{ width: 60 }}
                          />
                          <span>~</span>
                          <InputNumber
                            size="small"
                            placeholder="最大Z"
                            value={customBoundary.maxZ}
                            onChange={(v) => setCustomBoundary({ ...customBoundary, maxZ: v })}
                            style={{ width: 60 }}
                          />
                        </Space>
                      </Col>
                    </Row>
                  </div>
                )}
              </div>
            </Space>
          </div>
        )}

        {/* 控制按钮 */}
        <Space style={{ width: '100%' }} direction="vertical" size="small">
          {!isExploring ? (
            <Button
              type="primary"
              icon={<CompassOutlined />}
              onClick={handleStartExploration}
              block
            >
              开始探索
            </Button>
          ) : isPaused ? (
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={handleResumeExploration}
              block
            >
              恢复探索
            </Button>
          ) : (
            <Button
              icon={<PauseCircleOutlined />}
              onClick={handlePauseExploration}
              block
            >
              暂停探索
            </Button>
          )}

          <Button
            danger
            icon={<StopOutlined />}
            onClick={handleStopExploration}
            disabled={!isExploring}
            block
          >
            停止探索
          </Button>
        </Space>

        {/* 当前状态提示 */}
        {isExploring && (
          <div style={{
            padding: '8px',
            background: isPaused ? '#fff7e6' : '#e6f7ff',
            borderRadius: '4px',
            fontSize: '12px'
          }}>
            {isPaused ? (
              <div>⏸️ 探索已暂停</div>
            ) : currentGoal ? (
              <div>
                <EnvironmentOutlined /> 正在飞往目标点:
                <br />
                坐标: ({currentGoal.x?.toFixed(2)}, {currentGoal.y?.toFixed(2)}, {currentGoal.z?.toFixed(2)})
                <br />
                距起点: {distanceFromStart.toFixed(1)}m
              </div>
            ) : (
              <div>🔍 正在搜索前沿点...</div>
            )}
          </div>
        )}
      </Space>
    </Card>
  );
}
