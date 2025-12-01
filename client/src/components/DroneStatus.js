import React from 'react';
import { Card, Descriptions, Tag, Space } from 'antd';
import { HeartOutlined, EnvironmentOutlined, ThunderboltOutlined } from '@ant-design/icons';

export default function DroneStatus({ heartbeat, odometry }) {
  // 飞行模式映射
  const modeMap = {
    INIT: { text: '初始化', color: 'default' },
    MANUAL: { text: '手动', color: 'blue' },
    HOVER: { text: '悬停', color: 'green' },
    AUTO: { text: '自动', color: 'purple' },
    TAKE_OFF: { text: '起飞中', color: 'orange' },
    LAND: { text: '降落中', color: 'orange' },
    CRUISE: { text: '巡航', color: 'cyan' },
    ORBIT: { text: '环绕', color: 'magenta' }
  };

  // 状态映射
  const statusMap = {
    OK: { text: '正常', color: 'success' },
    ERR: { text: '错误', color: 'error' }
  };

  const getMode = () => {
    if (!heartbeat?.flightControl?.mode) return modeMap.INIT;
    return modeMap[heartbeat.flightControl.mode] || modeMap.INIT;
  };

  const getStatus = (status) => {
    return statusMap[status] || statusMap.ERR;
  };

  return (
    <Card
      title={<><HeartOutlined /> 无人机状态</>}
      size="small"
      style={{ flex: '1 1 auto', overflow: 'auto' }}
    >
      {/* 基本信息 */}
      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label="设备编号">
          {heartbeat?.sn || 'N/A'}
        </Descriptions.Item>
        <Descriptions.Item label="序列号">
          {heartbeat?.seqenceId || 'N/A'}
        </Descriptions.Item>
        <Descriptions.Item label="飞行模式">
          {heartbeat && (
            <Tag color={getMode().color}>{getMode().text}</Tag>
          )}
        </Descriptions.Item>
      </Descriptions>

      {/* 位置信息 */}
      <div style={{ marginTop: 16 }}>
        <div style={{ marginBottom: 8, fontWeight: 'bold' }}>
          <EnvironmentOutlined /> 位置
        </div>
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="X">
            {odometry?.position?.x?.toFixed(3) || 'N/A'} m
          </Descriptions.Item>
          <Descriptions.Item label="Y">
            {odometry?.position?.y?.toFixed(3) || 'N/A'} m
          </Descriptions.Item>
          <Descriptions.Item label="Z">
            {odometry?.position?.z?.toFixed(3) || 'N/A'} m
          </Descriptions.Item>
        </Descriptions>
      </div>

      {/* 速度信息 */}
      <div style={{ marginTop: 16 }}>
        <div style={{ marginBottom: 8, fontWeight: 'bold' }}>
          <ThunderboltOutlined /> 速度
        </div>
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="Vx">
            {odometry?.velocity?.x?.toFixed(3) || 'N/A'} m/s
          </Descriptions.Item>
          <Descriptions.Item label="Vy">
            {odometry?.velocity?.y?.toFixed(3) || 'N/A'} m/s
          </Descriptions.Item>
          <Descriptions.Item label="Vz">
            {odometry?.velocity?.z?.toFixed(3) || 'N/A'} m/s
          </Descriptions.Item>
        </Descriptions>
      </div>

      {/* 传感器状态 */}
      <div style={{ marginTop: 16 }}>
        <div style={{ marginBottom: 8, fontWeight: 'bold' }}>传感器</div>
        <Space>
          <Tag color={heartbeat?.lidar?.status ? getStatus(heartbeat.lidar.status).color : 'default'}>
            雷达: {heartbeat?.lidar?.status ? getStatus(heartbeat.lidar.status).text : 'N/A'}
          </Tag>
          <Tag color={heartbeat?.fpvCamera?.status ? getStatus(heartbeat.fpvCamera.status).color : 'default'}>
            相机: {heartbeat?.fpvCamera?.status ? getStatus(heartbeat.fpvCamera.status).text : 'N/A'}
          </Tag>
        </Space>
      </div>

      {/* 任务状态 */}
      {heartbeat?.missionState && (
        <div style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 8, fontWeight: 'bold' }}>任务</div>
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="状态">
              {heartbeat.missionState.state}
            </Descriptions.Item>
            <Descriptions.Item label="队列">
              {heartbeat.missionState.queueSize}
            </Descriptions.Item>
          </Descriptions>
        </div>
      )}
    </Card>
  );
}
