import React, { useState, useEffect } from 'react';
import { Card, Button, Space, InputNumber, message, Collapse, Form, Table, Switch, Popconfirm, Upload, Modal } from 'antd';
import {
  RocketOutlined,
  DownOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  StopOutlined,
  SendOutlined,
  PlusOutlined,
  DeleteOutlined,
  EnvironmentOutlined,
  DownloadOutlined,
  UploadOutlined,
  CompassOutlined
} from '@ant-design/icons';
import websocket from '../services/websocket';

const { Panel } = Collapse;

export default function ControlPanel({ odometry, onWaypointsChange }) {
  const [loading, setLoading] = useState(false);
  const [currentExecutingId, setCurrentExecutingId] = useState(null); // 当前正在执行的任务ID
  const [waypoints, setWaypoints] = useState([]); // 航点列表
  const [returnToStart, setReturnToStart] = useState(true); // 是否返回起点
  const [autoLand, setAutoLand] = useState(true); // 是否自动降落
  const [waypointForm] = Form.useForm(); // 航点表单
  const [presetRoutes, setPresetRoutes] = useState([]); // 预设航线列表
  const [confirmModalVisible, setConfirmModalVisible] = useState(false); // 确认弹窗
  const [selectedRoute, setSelectedRoute] = useState(null); // 选中的航线
  const [confirmReturnHome, setConfirmReturnHome] = useState(true); // 弹窗中的返航选项
  const [confirmLand, setConfirmLand] = useState(true); // 弹窗中的降落选项

  // 当航点变化时通知父组件
  useEffect(() => {
    if (onWaypointsChange) {
      onWaypointsChange(waypoints);
    }
  }, [waypoints, onWaypointsChange]);

  // 组件加载时获取预设航线列表
  useEffect(() => {
    fetchPresetRoutes();
  }, []);

  /**
   * 获取预设航线列表
   */
  const fetchPresetRoutes = async () => {
    try {
      const response = await fetch('/api/preset-routes');
      const data = await response.json();
      if (data.success) {
        // 转换为数组格式，方便渲染按钮
        const routeList = Object.entries(data.routes).map(([key, route], index) => ({
          id: key,
          name: route.name,
          description: route.description,
          waypointCount: route.waypointCount,
          displayName: `自由探索模式${index + 1}`
        }));
        setPresetRoutes(routeList);
      }
    } catch (error) {
      console.error('获取预设航线失败:', error);
    }
  };

  /**
   * 执行指定预设航线
   * @param {string} routeId - 航线ID
   * @param {string} displayName - 显示名称
   * @param {boolean} shouldReturnHome - 是否返航（从弹窗获取）
   * @param {boolean} shouldLand - 是否降落（从弹窗获取）
   */
  const handleExecutePresetRoute = async (routeId, displayName, shouldReturnHome = true, shouldLand = true) => {
    setLoading(true);
    try {
      // 获取航线详细数据
      const response = await fetch(`/api/preset-routes/${routeId}`);
      const data = await response.json();

      if (!data.success || !data.route) {
        message.error('获取航线数据失败');
        return;
      }

      const routeWaypoints = data.route.waypoints;
      if (!routeWaypoints || routeWaypoints.length === 0) {
        message.warning('航线没有航点数据');
        return;
      }

      // 加载航点到当前列表（用于3D显示）
      const waypointsWithKeys = routeWaypoints.map((wp, index) => ({
        ...wp,
        key: wp.key || Date.now() + index
      }));
      setWaypoints(waypointsWithKeys);

      // 生成任务ID
      const newMissionId = 'preset_' + routeId + '_' + Date.now();

      // 构建任务
      const tasks = [{ takeOff: {} }];

      routeWaypoints.forEach(wp => {
        tasks.push({
          autoPilot: {
            position: { x: wp.x, y: wp.y, z: wp.z },
            yaw: wp.yaw,
            cameraParam: { on: false, mode: 0, interval: 0 }
          }
        });
      });

      // 返回起点（使用弹窗中选择的选项）
      if (shouldReturnHome) {
        tasks.push({
          autoPilot: {
            position: { x: 0, y: 0, z: 0.5 },
            yaw: 0,
            cameraParam: { on: false, mode: 0, interval: 0 }
          }
        });
      }

      // 降落（使用弹窗中选择的选项）
      if (shouldLand) {
        tasks.push({ land: {} });
      }

      const mission = { id: newMissionId, tasks };

      // 发送任务
      websocket.publishMission(mission);
      const statusParts = [];
      if (shouldReturnHome) statusParts.push('返航');
      if (shouldLand) statusParts.push('降落');
      const statusText = statusParts.length > 0 ? `, 完成后${statusParts.join('+')}` : '';
      message.success(`🚀 ${displayName} 已启动 (${routeWaypoints.length} 个航点${statusText})`);

      setCurrentExecutingId(newMissionId);

      // 自动执行
      setTimeout(() => {
        websocket.publishExecution({ id: newMissionId, action: 0 });
        message.info('▶️ 任务已开始执行');
      }, 1000);

    } catch (error) {
      message.error('执行失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  /**
   * 保存航点到JSON文件
   */
  const saveWaypointsToFile = () => {
    if (waypoints.length === 0) {
      message.warning('没有航点可保存');
      return;
    }
    const data = JSON.stringify(waypoints, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    link.download = `waypoints_${timestamp}.json`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
    message.success(`💾 已保存 ${waypoints.length} 个航点到文件`);
  };

  /**
   * 从JSON文件加载航点
   */
  const handleFileUpload = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // 确保每个航点有key
          const waypointsWithKeys = parsed.map((wp, index) => ({
            ...wp,
            key: wp.key || Date.now() + index
          }));
          setWaypoints(waypointsWithKeys);
          message.success(`📂 已从文件加载 ${waypointsWithKeys.length} 个航点`);
        } else {
          message.error('文件格式错误：需要航点数组');
        }
      } catch (err) {
        message.error('文件解析失败：' + err.message);
      }
    };
    reader.readAsText(file);
    return false; // 阻止默认上传
  };

  /**
   * 更新航点字段（编辑功能）
   */
  const handleUpdateWaypoint = (key, field, value) => {
    const newWaypoints = waypoints.map(wp => {
      if (wp.key === key) {
        return { ...wp, [field]: parseFloat(value) || 0 };
      }
      return wp;
    });
    setWaypoints(newWaypoints);
  };

  /**
   * 起飞 - 通过任务系统发送
   */
  const handleTakeOff = () => {
    setLoading(true);
    try {
      const newMissionId = 'takeoff_' + Date.now();
      const mission = {
        id: newMissionId,
        tasks: [{ takeOff: {} }]
      };
      websocket.publishMission(mission);
      setCurrentExecutingId(newMissionId);

      setTimeout(() => {
        websocket.publishExecution({
          id: newMissionId,
          action: 0  // START
        });
      }, 500);

      message.success('✈️ 起飞指令已发送');
    } catch (error) {
      message.error('发送失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  /**
   * 降落 - 通过任务系统发送
   */
  const handleLand = () => {
    setLoading(true);
    try {
      const newMissionId = 'land_' + Date.now();
      const mission = {
        id: newMissionId,
        tasks: [{ land: {} }]
      };
      websocket.publishMission(mission);
      setCurrentExecutingId(newMissionId);

      setTimeout(() => {
        websocket.publishExecution({
          id: newMissionId,
          action: 0  // START
        });
      }, 500);

      message.success('🛬 降落指令已发送');
    } catch (error) {
      message.error('发送失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  /**
   * 添加航点
   */
  const handleAddWaypoint = (values) => {
    const newWaypoint = {
      key: Date.now(),
      x: values.x || 0,
      y: values.y || 0,
      z: values.z || 1,
      yaw: values.yaw || 0
    };
    setWaypoints([...waypoints, newWaypoint]);
    waypointForm.resetFields();
    message.success('✅ 航点已添加');
  };

  /**
   * 记录当前无人机位置为航点
   */
  const handleRecordCurrentPosition = () => {
    // 兼容多种数据结构：odometry.position 或 odometry.pose.position
    const pos = odometry?.position || odometry?.pose?.position;

    if (!odometry || !pos) {
      message.warning('⚠️ 无法获取无人机当前位置');
      return;
    }

    // 获取朝向数据（兼容多种结构）
    const orientation = odometry?.orientation || odometry?.pose?.orientation;

    // 计算 yaw (如果有朝向数据则计算，否则默认为0)
    let yaw = 0;
    if (orientation && orientation.w !== undefined) {
      yaw = Math.atan2(2.0 * (orientation.w * orientation.z + orientation.x * orientation.y),
                       1.0 - 2.0 * (orientation.y * orientation.y + orientation.z * orientation.z));
    }

    const newWaypoint = {
      key: Date.now(),
      x: parseFloat(pos.x.toFixed(2)),
      y: parseFloat(pos.y.toFixed(2)),
      z: parseFloat(pos.z.toFixed(2)),
      yaw: parseFloat(yaw.toFixed(2))
    };

    setWaypoints([...waypoints, newWaypoint]);
    message.success(`✅ 已记录当前位置: (${newWaypoint.x}, ${newWaypoint.y}, ${newWaypoint.z})`);
  };

  /**
   * 删除航点
   */
  const handleDeleteWaypoint = (key) => {
    setWaypoints(waypoints.filter(wp => wp.key !== key));
    message.success('🗑️ 航点已删除');
  };

  /**
   * 清空所有航点
   */
  const handleClearWaypoints = () => {
    setWaypoints([]);
    message.success('🗑️ 已清空所有航点');
  };

  /**
   * 发送多航点任务
   */
  const handleMultiWaypointMission = () => {
    if (waypoints.length === 0) {
      message.warning('⚠️ 请先添加航点');
      return;
    }

    setLoading(true);
    try {
      // 生成新的任务ID
      const newMissionId = 'mission_' + Date.now();

      // 构建任务列表
      const tasks = [
        { takeOff: {} }
      ];

      // 添加所有航点
      waypoints.forEach(wp => {
        tasks.push({
          autoPilot: {
            position: { x: wp.x, y: wp.y, z: wp.z },
            yaw: wp.yaw,
            cameraParam: {
              on: false,
              mode: 0,  // 0 = PHOTO
              interval: 0
            }
          }
        });
      });

      // 如果需要返回起点
      if (returnToStart && waypoints.length > 0) {
        const firstWaypoint = waypoints[0];
        tasks.push({
          autoPilot: {
            position: { x: firstWaypoint.x, y: firstWaypoint.y, z: firstWaypoint.z },
            yaw: firstWaypoint.yaw,
            cameraParam: {
              on: false,
              mode: 0,  // 0 = PHOTO
              interval: 0
            }
          }
        });
      }

      // 返回起飞点并降落
      if (autoLand) {
        tasks.push({
          autoPilot: {
            position: { x: 0, y: 0, z: 0.5 },
            yaw: 0,
            cameraParam: {
              on: false,
              mode: 0,  // 0 = PHOTO
              interval: 0
            }
          }
        });
        tasks.push({ land: {} });
      }

      const mission = {
        id: newMissionId,
        tasks: tasks
      };

      websocket.publishMission(mission);
      message.success(`📋 任务已下发: ${waypoints.length} 个航点 (${newMissionId})`);

      // 保存当前执行的任务ID
      setCurrentExecutingId(newMissionId);

      // 自动执行任务
      setTimeout(() => {
        websocket.publishExecution({
          id: newMissionId,
          action: 0  // 0 = START
        });
        message.info('▶️ 任务已开始执行');
      }, 1000);
    } catch (error) {
      message.error('发送失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  /**
   * 任务控制
   */
  const handleMissionControl = (action) => {
    try {
      if (!currentExecutingId) {
        message.warning('⚠️ 没有正在执行的任务');
        return;
      }

      // 枚举值映射: START=0, PAUSE=1, RESUME=2, STOP=3, CLEAR=4
      const actionEnumMap = {
        START: 0,
        PAUSE: 1,
        RESUME: 2,
        STOP: 3,
        CLEAR: 4
      };

      websocket.publishExecution({
        id: currentExecutingId, // 使用当前执行的任务ID
        action: actionEnumMap[action]
      });

      const actionMap = {
        START: '开始',
        PAUSE: '暂停',
        RESUME: '恢复',
        STOP: '停止',
        CLEAR: '清除'
      };
      message.success(`${actionMap[action]}任务指令已发送 (${currentExecutingId})`);

      // 如果停止或清除，清空当前执行ID
      if (action === 'STOP' || action === 'CLEAR') {
        setCurrentExecutingId(null);
      }
    } catch (error) {
      message.error('发送失败: ' + error.message);
    }
  };

  // 航点表格列定义（可编辑）
  const waypointColumns = [
    {
      title: '#',
      dataIndex: 'key',
      key: 'index',
      width: 40,
      render: (_text, _record, index) => index + 1
    },
    {
      title: 'X',
      dataIndex: 'x',
      key: 'x',
      width: 80,
      render: (text, record) => (
        <InputNumber
          value={text}
          size="small"
          step={0.1}
          style={{ width: '100%' }}
          onChange={(value) => handleUpdateWaypoint(record.key, 'x', value)}
        />
      )
    },
    {
      title: 'Y',
      dataIndex: 'y',
      key: 'y',
      width: 80,
      render: (text, record) => (
        <InputNumber
          value={text}
          size="small"
          step={0.1}
          style={{ width: '100%' }}
          onChange={(value) => handleUpdateWaypoint(record.key, 'y', value)}
        />
      )
    },
    {
      title: 'Z',
      dataIndex: 'z',
      key: 'z',
      width: 80,
      render: (text, record) => (
        <InputNumber
          value={text}
          size="small"
          step={0.1}
          style={{ width: '100%' }}
          onChange={(value) => handleUpdateWaypoint(record.key, 'z', value)}
        />
      )
    },
    {
      title: 'Yaw',
      dataIndex: 'yaw',
      key: 'yaw',
      width: 80,
      render: (text, record) => (
        <InputNumber
          value={text}
          size="small"
          step={0.1}
          style={{ width: '100%' }}
          onChange={(value) => handleUpdateWaypoint(record.key, 'yaw', value)}
        />
      )
    },
    {
      title: '',
      key: 'action',
      width: 40,
      render: (_text, record) => (
        <Popconfirm
          title="确定删除此航点?"
          onConfirm={() => handleDeleteWaypoint(record.key)}
          okText="删除"
          cancelText="取消"
        >
          <Button type="link" danger size="small" icon={<DeleteOutlined />} />
        </Popconfirm>
      )
    }
  ];

  return (
    <Card
      title={<><SendOutlined /> 控制面板</>}
      size="small"
      style={{ flex: '0 0 auto' }}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {/* 基本控制 */}
        <Space style={{ width: '100%' }}>
          <Button
            type="primary"
            icon={<RocketOutlined />}
            onClick={handleTakeOff}
            loading={loading}
            block
          >
            起飞
          </Button>
          <Button
            danger
            icon={<DownOutlined />}
            onClick={handleLand}
            loading={loading}
            block
          >
            降落
          </Button>
        </Space>

        {/* 自由探索模式按钮 */}
        {presetRoutes.length > 0 && (
          <Space direction="vertical" style={{ width: '100%' }}>
            {presetRoutes.map((route, index) => (
              <Button
                key={route.id}
                type="primary"
                icon={<CompassOutlined />}
                onClick={() => {
                  setSelectedRoute({ id: route.id, displayName: `自由探索模式${index + 1}` });
                  setConfirmModalVisible(true);
                }}
                loading={loading}
                style={{ background: '#722ed1', borderColor: '#722ed1' }}
                block
              >
                自由探索模式{index + 1}
              </Button>
            ))}
          </Space>
        )}

        {/* 确认执行弹窗 */}
        <Modal
          title="确认执行"
          open={confirmModalVisible}
          onOk={() => {
            if (selectedRoute) {
              handleExecutePresetRoute(selectedRoute.id, selectedRoute.displayName, confirmReturnHome, confirmLand);
            }
            setConfirmModalVisible(false);
          }}
          onCancel={() => setConfirmModalVisible(false)}
          okText="确认执行"
          cancelText="取消"
        >
          <Space direction="vertical" style={{ width: '100%' }}>
            <div style={{ fontSize: 16, marginBottom: 12 }}>
              是否执行 <strong>{selectedRoute?.displayName}</strong>？
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span>返航：</span>
              <Switch
                checked={confirmReturnHome}
                onChange={setConfirmReturnHome}
                checkedChildren="是"
                unCheckedChildren="否"
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span>降落：</span>
              <Switch
                checked={confirmLand}
                onChange={setConfirmLand}
                checkedChildren="是"
                unCheckedChildren="否"
              />
            </div>
          </Space>
        </Modal>

        {/* 任务面板 */}
        <Collapse defaultActiveKey={['1']}>
          <Panel header="🛤️ 多航点任务规划" key="1">
            {/* 保存/加载文件按钮 */}
            <Space style={{ width: '100%', marginBottom: 12 }}>
              <Button
                size="small"
                icon={<DownloadOutlined />}
                onClick={saveWaypointsToFile}
                disabled={waypoints.length === 0}
              >
                保存到文件
              </Button>
              <Upload
                accept=".json"
                showUploadList={false}
                beforeUpload={handleFileUpload}
              >
                <Button size="small" icon={<UploadOutlined />}>
                  从文件加载
                </Button>
              </Upload>
            </Space>

            {waypoints.length > 0 && (
              <>
                <Table
                  columns={waypointColumns}
                  dataSource={waypoints}
                  pagination={false}
                  size="small"
                  style={{ marginBottom: 12 }}
                  scroll={{ y: 200 }}
                />
                <Space style={{ width: '100%', marginBottom: 12 }} wrap>
                  <Popconfirm
                    title="确定清空所有航点?"
                    onConfirm={handleClearWaypoints}
                    okText="清空"
                    cancelText="取消"
                  >
                    <Button size="small" danger icon={<DeleteOutlined />}>
                      清空航点
                    </Button>
                  </Popconfirm>
                  <Switch
                    checked={returnToStart}
                    onChange={setReturnToStart}
                    checkedChildren="返回起点"
                    unCheckedChildren="不返回"
                    size="small"
                  />
                  <Switch
                    checked={autoLand}
                    onChange={setAutoLand}
                    checkedChildren="自动降落"
                    unCheckedChildren="悬停"
                    size="small"
                  />
                </Space>
              </>
            )}

            {/* 添加航点表单 */}
            <Form
              form={waypointForm}
              layout="inline"
              onFinish={handleAddWaypoint}
              initialValues={{ x: 0, y: 0, z: 1, yaw: 0 }}
              style={{ marginBottom: 8 }}
            >
              <Form.Item name="x" style={{ width: 70 }}>
                <InputNumber
                  placeholder="X"
                  step={0.1}
                  size="small"
                  style={{ width: '100%' }}
                />
              </Form.Item>
              <Form.Item name="y" style={{ width: 70 }}>
                <InputNumber
                  placeholder="Y"
                  step={0.1}
                  size="small"
                  style={{ width: '100%' }}
                />
              </Form.Item>
              <Form.Item name="z" style={{ width: 70 }}>
                <InputNumber
                  placeholder="Z"
                  step={0.1}
                  size="small"
                  style={{ width: '100%' }}
                />
              </Form.Item>
              <Form.Item name="yaw" style={{ width: 70 }}>
                <InputNumber
                  placeholder="Yaw"
                  step={0.1}
                  size="small"
                  style={{ width: '100%' }}
                />
              </Form.Item>
              <Form.Item>
                <Button
                  type="primary"
                  htmlType="submit"
                  size="small"
                  icon={<PlusOutlined />}
                >
                  添加
                </Button>
              </Form.Item>
            </Form>

            {/* 快捷操作 */}
            <Space direction="vertical" style={{ width: '100%' }}>
              <Button
                icon={<EnvironmentOutlined />}
                onClick={handleRecordCurrentPosition}
                size="small"
                block
              >
                记录当前位置为航点
              </Button>
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={handleMultiWaypointMission}
                loading={loading}
                disabled={waypoints.length === 0}
                block
              >
                下发任务并执行 ({waypoints.length} 个航点)
              </Button>
            </Space>
          </Panel>

          <Panel header="🎮 任务控制" key="2">
            <Space direction="vertical" style={{ width: '100%' }}>
              {currentExecutingId && (
                <div style={{
                  padding: '8px',
                  background: '#e6f7ff',
                  borderRadius: '4px',
                  fontSize: '12px',
                  marginBottom: '8px'
                }}>
                  <strong>当前任务ID:</strong><br/>
                  {currentExecutingId}
                </div>
              )}
              <Button
                icon={<PlayCircleOutlined />}
                onClick={() => handleMissionControl('START')}
                disabled={!currentExecutingId}
                block
              >
                开始任务
              </Button>
              <Button
                icon={<PauseCircleOutlined />}
                onClick={() => handleMissionControl('PAUSE')}
                disabled={!currentExecutingId}
                block
              >
                暂停任务
              </Button>
              <Button
                icon={<PlayCircleOutlined />}
                onClick={() => handleMissionControl('RESUME')}
                disabled={!currentExecutingId}
                block
              >
                恢复任务
              </Button>
              <Button
                danger
                icon={<StopOutlined />}
                onClick={() => handleMissionControl('STOP')}
                disabled={!currentExecutingId}
                block
              >
                停止任务
              </Button>
            </Space>
          </Panel>
        </Collapse>
      </Space>
    </Card>
  );
}
