import React, { useState, useEffect, useRef } from 'react';
import { Card, Table, Button, Modal, Space, Tag, Slider, Popconfirm, message, Empty, Spin } from 'antd';
import { HistoryOutlined, PlayCircleOutlined, PauseCircleOutlined, DeleteOutlined, EyeOutlined, ReloadOutlined } from '@ant-design/icons';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

/**
 * 任务历史记录组件
 * 显示历史任务列表，支持查看视频回放和轨迹
 */
export default function MissionHistory() {
  const [missions, setMissions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedMission, setSelectedMission] = useState(null);
  const [missionDetail, setMissionDetail] = useState(null);
  const [frames, setFrames] = useState([]);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(10); // 帧/秒

  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const trajectoryLineRef = useRef(null);
  const playIntervalRef = useRef(null);

  // 加载任务列表
  const fetchMissions = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/missions');
      const data = await response.json();
      if (data.success) {
        setMissions(data.missions || []);
      }
    } catch (error) {
      console.error('获取任务列表失败:', error);
      message.error('获取任务列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMissions();
  }, []);

  // 查看任务详情
  const viewMissionDetail = async (mission) => {
    setSelectedMission(mission);
    setDetailVisible(true);
    setCurrentFrameIndex(0);
    setIsPlaying(false);

    try {
      // 获取任务详情（轨迹、点云）
      const detailRes = await fetch(`/api/missions/${mission.timestamp}`);
      const detailData = await detailRes.json();
      if (detailData.success) {
        setMissionDetail(detailData);
      }

      // 获取视频帧列表
      const framesRes = await fetch(`/api/missions/${mission.timestamp}/frames`);
      const framesData = await framesRes.json();
      if (framesData.success) {
        setFrames(framesData.frames || []);
      }
    } catch (error) {
      console.error('获取任务详情失败:', error);
      message.error('获取任务详情失败');
    }
  };

  // 删除任务
  const deleteMission = async (timestamp) => {
    try {
      const response = await fetch(`/api/missions/${timestamp}`, { method: 'DELETE' });
      const data = await response.json();
      if (data.success) {
        message.success('任务记录已删除');
        fetchMissions();
      } else {
        message.error(data.error || '删除失败');
      }
    } catch (error) {
      console.error('删除任务失败:', error);
      message.error('删除失败');
    }
  };

  // 初始化3D场景
  useEffect(() => {
    if (!detailVisible || !canvasRef.current) return;

    // 创建场景
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    sceneRef.current = scene;

    // 创建相机
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    camera.position.set(5, 5, 5);

    // 创建渲染器
    const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, antialias: true });
    renderer.setSize(400, 300);
    rendererRef.current = renderer;

    // 添加控制器
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // 添加网格
    const gridHelper = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
    scene.add(gridHelper);

    // 添加坐标轴
    const axesHelper = new THREE.AxesHelper(2);
    scene.add(axesHelper);

    // 动画循环
    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      renderer.dispose();
    };
  }, [detailVisible]);

  // 绘制轨迹
  useEffect(() => {
    if (!sceneRef.current || !missionDetail?.trajectory) return;

    // 移除旧轨迹
    if (trajectoryLineRef.current) {
      sceneRef.current.remove(trajectoryLineRef.current);
    }

    const trajectory = missionDetail.trajectory;
    if (trajectory.length < 2) return;

    // 创建轨迹线
    const points = trajectory.map(p => new THREE.Vector3(p.x, p.z, -p.y));
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2 });
    const line = new THREE.Line(geometry, material);

    sceneRef.current.add(line);
    trajectoryLineRef.current = line;

    // 添加起点和终点标记
    const startGeom = new THREE.SphereGeometry(0.1);
    const startMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const startSphere = new THREE.Mesh(startGeom, startMat);
    startSphere.position.copy(points[0]);
    sceneRef.current.add(startSphere);

    const endGeom = new THREE.SphereGeometry(0.1);
    const endMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const endSphere = new THREE.Mesh(endGeom, endMat);
    endSphere.position.copy(points[points.length - 1]);
    sceneRef.current.add(endSphere);

  }, [missionDetail]);

  // 视频播放控制
  useEffect(() => {
    if (isPlaying && frames.length > 0) {
      playIntervalRef.current = setInterval(() => {
        setCurrentFrameIndex(prev => {
          if (prev >= frames.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 1000 / playSpeed);
    } else {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
    }

    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
    };
  }, [isPlaying, playSpeed, frames.length]);

  // 表格列定义
  const columns = [
    {
      title: '任务ID',
      dataIndex: 'id',
      key: 'id',
      width: 150,
      ellipsis: true,
      render: (text) => <span style={{ fontFamily: 'monospace' }}>{text?.substring(0, 20)}...</span>
    },
    {
      title: '开始时间',
      dataIndex: 'startTime',
      key: 'startTime',
      width: 180,
      render: (text) => new Date(text).toLocaleString('zh-CN')
    },
    {
      title: '视频帧',
      dataIndex: 'frameCount',
      key: 'frameCount',
      width: 80,
      render: (count) => <Tag color="blue">{count || 0}</Tag>
    },
    {
      title: '轨迹点',
      dataIndex: 'trajectoryPointCount',
      key: 'trajectoryPointCount',
      width: 80,
      render: (count) => <Tag color="green">{count || 0}</Tag>
    },
    {
      title: '点云快照',
      dataIndex: 'pointCloudSnapshotCount',
      key: 'pointCloudSnapshotCount',
      width: 90,
      render: (count) => <Tag color="purple">{count || 0}</Tag>
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => viewMissionDetail(record)}
          >
            查看
          </Button>
          <Popconfirm
            title="确定删除此记录?"
            onConfirm={() => deleteMission(record.timestamp)}
            okText="删除"
            cancelText="取消"
          >
            <Button type="link" danger size="small" icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <Card
      title={<><HistoryOutlined /> 任务历史记录</>}
      size="small"
      extra={
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={fetchMissions}
          loading={loading}
        >
          刷新
        </Button>
      }
    >
      {missions.length === 0 ? (
        <Empty description="暂无任务记录" />
      ) : (
        <Table
          columns={columns}
          dataSource={missions}
          rowKey="timestamp"
          size="small"
          pagination={{ pageSize: 5 }}
          loading={loading}
        />
      )}

      {/* 任务详情弹窗 */}
      <Modal
        title={`任务详情 - ${selectedMission?.id?.substring(0, 30)}...`}
        open={detailVisible}
        onCancel={() => {
          setDetailVisible(false);
          setIsPlaying(false);
        }}
        width={900}
        footer={null}
      >
        {selectedMission && (
          <div style={{ display: 'flex', gap: 16 }}>
            {/* 左侧：视频回放 */}
            <div style={{ flex: 1 }}>
              <h4>视频回放</h4>
              {frames.length > 0 ? (
                <>
                  <div style={{
                    width: '100%',
                    height: 300,
                    background: '#000',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 8
                  }}>
                    <img
                      src={`/api/missions/${selectedMission.timestamp}/frames/${frames[currentFrameIndex]?.filename}`}
                      alt={`Frame ${currentFrameIndex}`}
                      style={{ maxWidth: '100%', maxHeight: '100%' }}
                    />
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <Slider
                      min={0}
                      max={frames.length - 1}
                      value={currentFrameIndex}
                      onChange={setCurrentFrameIndex}
                      tooltip={{ formatter: (v) => `帧 ${v + 1}/${frames.length}` }}
                    />
                  </div>
                  <Space>
                    <Button
                      icon={isPlaying ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                      onClick={() => setIsPlaying(!isPlaying)}
                    >
                      {isPlaying ? '暂停' : '播放'}
                    </Button>
                    <span>速度: {playSpeed} fps</span>
                    <Slider
                      min={1}
                      max={30}
                      value={playSpeed}
                      onChange={setPlaySpeed}
                      style={{ width: 100 }}
                    />
                  </Space>
                </>
              ) : (
                <Empty description="无视频帧" />
              )}
            </div>

            {/* 右侧：轨迹3D视图 */}
            <div style={{ width: 420 }}>
              <h4>飞行轨迹</h4>
              <canvas ref={canvasRef} style={{ border: '1px solid #333', borderRadius: 4 }} />
              <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>
                <p>轨迹点数: {missionDetail?.trajectory?.length || 0}</p>
                <p>点云快照: {missionDetail?.pointCloud?.length || 0}</p>
                <p style={{ color: '#52c41a' }}>● 起点</p>
                <p style={{ color: '#ff4d4f' }}>● 终点</p>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}
