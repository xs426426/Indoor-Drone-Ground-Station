import { useEffect, useState } from 'react';
import { Layout, Card, Row, Col, message, Badge, Statistic } from 'antd';
import { CloudOutlined, RocketOutlined } from '@ant-design/icons';
import websocket from './services/websocket';
import PointCloudViewer from './components/PointCloudViewer';
import PointCloudLoader from './components/PointCloudLoader';
import DroneStatus from './components/DroneStatus';
import ControlPanel from './components/ControlPanel';
import CameraViewer from './components/CameraViewer';
import ExplorationPanel from './components/ExplorationPanel';
import MissionHistory from './components/MissionHistory';
import './App.css';

const { Header, Content } = Layout;

function App() {
  const [connected, setConnected] = useState(false);
  const [heartbeat, setHeartbeat] = useState(null);
  const [odometry, setOdometry] = useState(null);
  const [pointCloud, setPointCloud] = useState(null);
  const [localPointCloud, setLocalPointCloud] = useState(null); // 本地加载的点云
  const [droneStartPosition, setDroneStartPosition] = useState(null); // 无人机起点
  const [cameraData, setCameraData] = useState(null);
  const [isExploring, setIsExploring] = useState(false); // 是否正在探索
  const [droneMode, setDroneMode] = useState('auto'); // 'real', 'simulator', 'auto'
  const [accumulatedPointCloud, setAccumulatedPointCloud] = useState({ history: [], totalPoints: 0 }); // 累积的点云数据
  const [waypoints, setWaypoints] = useState([]); // 航点列表
  const [stats, setStats] = useState({
    pointCount: 0,
    heartbeatCount: 0,
    odometryCount: 0,
    cameraCount: 0
  });

  useEffect(() => {
    // 连接 WebSocket
    websocket.connect();

    // 获取服务器状态（包括运行模式）
    fetch('/api/status')
      .then(res => res.json())
      .then(data => {
        if (data.mode) {
          setDroneMode(data.mode);
          console.log('🔧 运行模式:', data.modeDescription);
        }
      })
      .catch(err => console.warn('获取服务器状态失败:', err));

    // 监听连接状态
    websocket.on('connection', ({ status }) => {
      setConnected(status === 'connected');
      if (status === 'connected') {
        message.success('✅ 已连接到服务器');
      } else {
        message.warning('🔌 连接已断开，正在重连...');
      }
    });

    // 监听心跳（移除日志，提升性能）
    websocket.on('/daf/heartbeat', (data) => {
      setHeartbeat(data);
      setStats(prev => ({ ...prev, heartbeatCount: prev.heartbeatCount + 1 }));
    });

    // 监听位姿（移除日志，提升性能）
    websocket.on('/daf/local/odometry', (data) => {
      // 如果正在探索，使用MQTT位姿（真实位置）
      // 如果没探索但也没有手动设置起点，也显示MQTT位姿（实时显示无人机当前位置）
      if (isExploring || !droneStartPosition) {
        setOdometry(data);
      }
      setStats(prev => ({ ...prev, odometryCount: prev.odometryCount + 1 }));
    });

    // 监听点云（移除日志，提升性能）
    websocket.on('/daf/pointcloud', (data) => {
      setPointCloud(data);
      setStats(prev => ({
        ...prev,
        pointCount: data.points?.length || 0
      }));
    });

    websocket.on('/daf/pointcloud_rgb', (data) => {
      setPointCloud(data);
      setStats(prev => ({
        ...prev,
        pointCount: data.points?.length || 0
      }));
    });

    // 监听摄像头（移除日志，提升性能）
    websocket.on('/daf/camera', (data) => {
      setCameraData(data);
      setStats(prev => ({ ...prev, cameraCount: prev.cameraCount + 1 }));
    });

    // 监听探索状态
    websocket.on('exploration_status', (msg) => {
      const data = msg.data || msg;
      if (data.isExploring !== undefined) {
        setIsExploring(data.isExploring);
      }
    });

    return () => {
      websocket.disconnect();
    };
  }, [isExploring, droneStartPosition]); // 添加 droneStartPosition 到依赖数组

  /**
   * 处理本地点云加载
   */
  const handlePointCloudLoaded = (fileInfo) => {
    if (!fileInfo) {
      // 清空点云
      setLocalPointCloud(null);
      setStats(prev => ({
        ...prev,
        pointCount: 0
      }));
      return;
    }

    setLocalPointCloud({
      points: fileInfo.points
    });

    // 更新统计信息
    setStats(prev => ({
      ...prev,
      pointCount: fileInfo.loadedPoints
    }));

    message.success(`点云已加载：${fileInfo.loadedPoints.toLocaleString()} 个点`);
  };

  /**
   * 处理起点设置
   */
  const handleStartPositionSet = (position) => {
    setDroneStartPosition(position);

    // 直接更新odometry，触发3D视图更新
    const newOdometry = {
      position: {
        x: parseFloat(position.x),
        y: parseFloat(position.y),
        z: parseFloat(position.z)
      },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
      velocity: { x: 0, y: 0, z: 0 }
    };

    setOdometry(newOdometry);
    console.log('✅ 设置无人机起点:', newOdometry.position);
  };

  /**
   * 处理累积点云数据变化
   */
  const handlePointCloudHistoryChange = (history, totalPoints) => {
    setAccumulatedPointCloud({ history, totalPoints });
  };

  // 显示逻辑：优先显示本地点云，如果没有则显示MQTT实时点云
  const displayPointCloud = localPointCloud || pointCloud;

  return (
    <Layout className="app-layout">
      <Header className="app-header">
        <div className="header-content">
          <h1>
            <RocketOutlined /> 无人机控制系统
          </h1>
          <div className="header-status">
            <Badge status={connected ? "success" : "error"} />
            <span>{connected ? '已连接' : '未连接'}</span>
            {droneMode !== 'auto' && (
              <span style={{ marginLeft: 16 }}>
                <Badge status={droneMode === 'real' ? "processing" : "warning"} />
                <span>{droneMode === 'real' ? '🚁 实机模式' : '🎮 模拟器模式'}</span>
              </span>
            )}
          </div>
        </div>
      </Header>

      <Layout>
        <Content className="app-content">
          <Row gutter={[16, 16]}>
            {/* 左侧列 - 点云和视频 */}
            <Col span={16}>
              <Row gutter={[16, 16]}>
                {/* 3D 点云视图 */}
                <Col span={24}>
                  <Card
                    title={<><CloudOutlined /> 点云视图</>}
                    className="content-card"
                    style={{ height: 600 }}
                  >
                    <PointCloudViewer
                      pointCloud={displayPointCloud}
                      odometry={odometry}
                      waypoints={waypoints}
                      onPointCloudHistoryChange={handlePointCloudHistoryChange}
                    />
                  </Card>
                </Col>

                {/* 摄像头视频 */}
                <Col span={24}>
                  <div style={{ height: 450 }}>
                    <CameraViewer cameraData={cameraData} />
                  </div>
                </Col>
              </Row>
            </Col>

            {/* 右侧面板 */}
            <Col span={8}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* 统计信息 */}
                <Card title="📊 数据统计" size="small">
                  <Row gutter={16}>
                    <Col span={6}>
                      <Statistic
                        title="点云"
                        value={stats.pointCount}
                        suffix="点"
                        valueStyle={{ fontSize: '16px' }}
                      />
                    </Col>
                    <Col span={6}>
                      <Statistic
                        title="心跳"
                        value={stats.heartbeatCount}
                        valueStyle={{ fontSize: '16px' }}
                      />
                    </Col>
                    <Col span={6}>
                      <Statistic
                        title="位姿"
                        value={stats.odometryCount}
                        valueStyle={{ fontSize: '16px' }}
                      />
                    </Col>
                    <Col span={6}>
                      <Statistic
                        title="图像"
                        value={stats.cameraCount}
                        valueStyle={{ fontSize: '16px' }}
                      />
                    </Col>
                  </Row>
                </Card>

                {/* 点云加载器 */}
                <PointCloudLoader
                  onPointCloudLoaded={handlePointCloudLoaded}
                  onStartPositionSet={handleStartPositionSet}
                  accumulatedPointCloud={accumulatedPointCloud}
                />

                {/* 无人机状态 */}
                <DroneStatus heartbeat={heartbeat} odometry={odometry} />

                {/* 控制面板 */}
                <ControlPanel odometry={odometry} onWaypointsChange={setWaypoints} />

                {/* 任务历史记录 */}
                <MissionHistory />

                {/* 探索面板 */}
                <ExplorationPanel startPosition={droneStartPosition} />
              </div>
            </Col>
          </Row>
        </Content>
      </Layout>
    </Layout>
  );
}

export default App;
