import React, { useState } from 'react';
import { Card, Button, Space, InputNumber, message, Collapse, Form, Select, Table, Switch, Popconfirm } from 'antd';
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
  HomeOutlined
} from '@ant-design/icons';
import websocket from '../services/websocket';

const { Panel } = Collapse;

export default function ControlPanel({ odometry }) {
  const [loading, setLoading] = useState(false);
  const [missionId, setMissionId] = useState('mission_' + Date.now());
  const [currentExecutingId, setCurrentExecutingId] = useState(null); // 当前正在执行的任务ID
  const [waypoints, setWaypoints] = useState([]); // 航点列表
  const [returnToStart, setReturnToStart] = useState(true); // 是否返回起点
  const [autoLand, setAutoLand] = useState(true); // 是否自动降落
  const [waypointForm] = Form.useForm(); // 航点表单

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
    if (!odometry || !odometry.pose) {
      message.warning('⚠️ 无法获取无人机当前位置');
      return;
    }

    const pos = odometry.pose.position;
    const orientation = odometry.pose.orientation;

    // 计算 yaw (简化版本，实际应该用四元数转欧拉角)
    const yaw = Math.atan2(2.0 * (orientation.w * orientation.z + orientation.x * orientation.y),
                          1.0 - 2.0 * (orientation.y * orientation.y + orientation.z * orientation.z));

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

      // 更新下一个任务的ID（用于表单显示）
      setMissionId('mission_' + Date.now());
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

  // 航点表格列定义
  const waypointColumns = [
    {
      title: '#',
      dataIndex: 'key',
      key: 'index',
      width: 50,
      render: (_text, _record, index) => index + 1
    },
    {
      title: 'X (m)',
      dataIndex: 'x',
      key: 'x',
      width: 70
    },
    {
      title: 'Y (m)',
      dataIndex: 'y',
      key: 'y',
      width: 70
    },
    {
      title: 'Z (m)',
      dataIndex: 'z',
      key: 'z',
      width: 70
    },
    {
      title: 'Yaw (rad)',
      dataIndex: 'yaw',
      key: 'yaw',
      width: 80
    },
    {
      title: '操作',
      key: 'action',
      width: 60,
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

        {/* 任务面板 */}
        <Collapse defaultActiveKey={['1']}>
          <Panel header="🛤️ 多航点任务规划" key="1">
            {/* 航点列表 */}
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
                <Space style={{ width: '100%', marginBottom: 12 }}>
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
