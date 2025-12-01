import React, { useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Stats } from '@react-three/drei';
import { Button, Space, Slider } from 'antd';
import { ClearOutlined, PauseOutlined, PlayCircleOutlined } from '@ant-design/icons';
import * as THREE from 'three';

/**
 * 点云渲染组件（支持历史累计）
 */
function PointCloud({ pointCloudHistory, maxPoints }) {
  const pointsRef = useRef();
  const geometryRef = useRef();

  useEffect(() => {
    // 如果点云为空或null，清空几何体
    if (!pointCloudHistory || pointCloudHistory.length === 0) {
      if (geometryRef.current) {
        geometryRef.current.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
        geometryRef.current.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3));
      }
      return;
    }

    // 合并所有历史点云
    let allPoints = [];
    pointCloudHistory.forEach(pc => {
      if (pc.points) {
        allPoints = allPoints.concat(pc.points);
      }
    });

    // 限制最大点数（避免性能问题）
    if (allPoints.length > maxPoints) {
      allPoints = allPoints.slice(allPoints.length - maxPoints);
    }

    if (allPoints.length === 0) {
      if (geometryRef.current) {
        geometryRef.current.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
        geometryRef.current.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3));
      }
      return;
    }

    const positions = new Float32Array(allPoints.length * 3);
    const colors = new Float32Array(allPoints.length * 3);

    allPoints.forEach((point, i) => {
      const idx = i * 3;
      positions[idx] = point.xyz.x;
      positions[idx + 1] = point.xyz.y;
      positions[idx + 2] = point.xyz.z;

      // 根据强度设置颜色（蓝色到红色渐变）
      const intensity = point.intensity / 255;
      colors[idx] = intensity;
      colors[idx + 1] = 0.5;
      colors[idx + 2] = 1 - intensity;
    });

    if (geometryRef.current) {
      geometryRef.current.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometryRef.current.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometryRef.current.computeBoundingSphere();
    }
  }, [pointCloudHistory, maxPoints]);

  return (
    <points ref={pointsRef}>
      <bufferGeometry ref={geometryRef} />
      <pointsMaterial
        size={0.03}
        vertexColors
        sizeAttenuation
        transparent
        opacity={0.9}
      />
    </points>
  );
}

/**
 * 无人机模型
 */
function DroneModel({ odometry }) {
  const meshRef = useRef();
  const trailRef = useRef();
  const trailPoints = useRef([]);

  useEffect(() => {
    if (odometry && meshRef.current) {
      const { position, orientation } = odometry;

      // 更新位置 - 确保position对象和xyz值都有效
      if (position &&
          typeof position.x === 'number' &&
          typeof position.y === 'number' &&
          typeof position.z === 'number' &&
          !isNaN(position.x) &&
          !isNaN(position.y) &&
          !isNaN(position.z)) {

        const pos = new THREE.Vector3(position.x, position.y, position.z);
        meshRef.current.position.copy(pos);

        // 检测"瞬移"（设置起点）- 如果距离上一个点太远，清空轨迹
        if (trailPoints.current.length > 0) {
          const lastPoint = trailPoints.current[trailPoints.current.length - 1];
          const distance = pos.distanceTo(lastPoint);

          if (distance > 2.0) {
            // 距离超过2米，认为是瞬移（设置起点），清空轨迹
            trailPoints.current = [];
            console.log('🔄 检测到位置瞬移，清空轨迹');
          }
        }

        // 记录轨迹点（每隔一定距离记录）
        if (trailPoints.current.length === 0 ||
            pos.distanceTo(trailPoints.current[trailPoints.current.length - 1]) > 0.05) {
          trailPoints.current.push(pos.clone());
          if (trailPoints.current.length > 200) {  // 增加到200个点
            trailPoints.current.shift();
          }

          // 更新轨迹线的几何体
          if (trailRef.current && trailPoints.current.length > 1) {
            const positions = new Float32Array(trailPoints.current.flatMap(p => [p.x, p.y, p.z]));
            trailRef.current.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            trailRef.current.geometry.attributes.position.needsUpdate = true;
          } else if (trailRef.current && trailPoints.current.length === 1) {
            // 只有一个点时，清空几何体
            trailRef.current.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
            trailRef.current.geometry.attributes.position.needsUpdate = true;
          }
        }

        // 位置更新日志（仅在首次或有显著变化时输出，避免刷屏）
      } else {
        console.warn('⚠️ 无效的position数据:', position);
      }

      // 更新姿态
      if (orientation) {
        const quat = new THREE.Quaternion(
          orientation.x,
          orientation.y,
          orientation.z,
          orientation.w
        );
        meshRef.current.setRotationFromQuaternion(quat);
      }
    }
  }, [odometry]);

  return (
    <>
      {/* 轨迹线 */}
      <line ref={trailRef}>
        <bufferGeometry />
        <lineBasicMaterial color="#1890ff" linewidth={2} />
      </line>

      <group ref={meshRef}>
        {/* 无人机主体 - 扁平盒子，X前后 Y左右 Z上下 */}
        <mesh>
          <boxGeometry args={[0.3, 0.3, 0.08]} />
          <meshStandardMaterial color="#1890ff" metalness={0.8} roughness={0.2} />
        </mesh>

      {/* 前方指示器 - X轴正方向（红色坐标轴方向）*/}
      <mesh position={[0.2, 0, 0]}>
        <coneGeometry args={[0.04, 0.12, 4]} />
        <meshStandardMaterial color="#ff4d4f" emissive="#ff4d4f" emissiveIntensity={0.5} />
      </mesh>

      {/* 四个螺旋桨 - 在XY平面四个角,Z方向向上 */}
      {[
        [-0.12, -0.12, 0.05], // 左后
        [0.12, -0.12, 0.05],  // 右后
        [-0.12, 0.12, 0.05],  // 左前
        [0.12, 0.12, 0.05]    // 右前
      ].map((pos, i) => (
        <mesh key={i} position={pos} rotation={[0, 0, 0]}>
          <cylinderGeometry args={[0.08, 0.08, 0.01, 32]} />
          <meshStandardMaterial color="#52c41a" transparent opacity={0.6} />
        </mesh>
      ))}
      </group>
    </>
  );
}

/**
 * 场景组件
 */
function Scene({ pointCloudHistory, odometry, maxPoints }) {
  return (
    <>
      {/* 环境光 */}
      <ambientLight intensity={0.6} />
      {/* 方向光 */}
      <directionalLight position={[10, 10, 5]} intensity={0.8} />
      <directionalLight position={[-10, -10, -5]} intensity={0.3} />

      {/* 坐标网格 - 水平地面 XY平面，Z向上 */}
      <Grid
        args={[20, 20]}
        cellSize={0.5}
        cellThickness={0.5}
        cellColor="#d9d9d9"
        sectionSize={2}
        sectionThickness={1}
        sectionColor="#1890ff"
        fadeDistance={30}
        fadeStrength={1}
        followCamera={false}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
      />

      {/* 坐标轴 - X红 Y绿 Z蓝（向上） */}
      <axesHelper args={[2]} />

      {/* 点云（累计显示） */}
      <PointCloud pointCloudHistory={pointCloudHistory} maxPoints={maxPoints} />

      {/* 无人机模型 */}
      <DroneModel odometry={odometry} />

      {/* 相机控制 */}
      <OrbitControls
        enableDamping
        dampingFactor={0.05}
        rotateSpeed={0.5}
        zoomSpeed={0.8}
      />

      {/* 性能统计 */}
      <Stats />
    </>
  );
}

/**
 * 点云视图主组件
 */
export default function PointCloudViewer({ pointCloud, odometry }) {
  const [pointCloudHistory, setPointCloudHistory] = useState([]);
  const [isPaused, setIsPaused] = useState(false);
  const [maxPoints, setMaxPoints] = useState(500000); // 最大显示50万个点
  const [totalPoints, setTotalPoints] = useState(0); // 维护总点数，避免每次计算
  const lastTimestampRef = useRef(null);

  // 监听点云数据并累计
  useEffect(() => {
    if (pointCloud && !isPaused) {
      // 检查是否是新的点云数据（使用时间戳防止重复）
      const currentTimestamp = pointCloud.stamp ?
        `${pointCloud.stamp.sec}_${pointCloud.stamp.nsec}` :
        `${Date.now()}_${Math.random()}`;

      // 如果是新数据，添加到历史记录
      if (currentTimestamp !== lastTimestampRef.current) {
        lastTimestampRef.current = currentTimestamp;

        const newFramePoints = pointCloud.points?.length || 0;

        // ✅ 使用维护的totalPoints，避免每次遍历所有历史帧
        if (totalPoints + newFramePoints > maxPoints) {
          // 只在第一次达到上限时输出日志（使用ref避免重复）
          if (pointCloudHistory.length > 0 && lastTimestampRef.limitWarned !== true) {
            console.log(`⚠️ 点云总数已达上限 ${maxPoints.toLocaleString()}，停止累积`);
            lastTimestampRef.limitWarned = true;
          }
          return; // 不添加新帧
        }

        // 更新历史记录和总点数
        setPointCloudHistory(prev => [...prev, pointCloud]);
        setTotalPoints(prev => prev + newFramePoints);

        // 只每100帧输出一次日志，减少性能消耗
        if ((pointCloudHistory.length + 1) % 100 === 0) {
          console.log(`✅ 点云累积: ${(totalPoints + newFramePoints).toLocaleString()} / ${maxPoints.toLocaleString()} 个点 (${pointCloudHistory.length + 1} 帧)`);
        }
      }
    }
  }, [pointCloud, isPaused, maxPoints, totalPoints, pointCloudHistory.length]);

  const handleClear = () => {
    setPointCloudHistory([]);
    setTotalPoints(0);
    lastTimestampRef.current = null;
    lastTimestampRef.limitWarned = false;
    console.log('点云历史已清空');
  };

  const handleTogglePause = () => {
    setIsPaused(!isPaused);
    console.log(isPaused ? '继续累计点云' : '暂停累计点云');
  };

  // totalPoints 已经通过state维护，不需要每次计算

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* 3D 场景 */}
      <div style={{ width: '100%', height: '100%', background: '#000' }}>
        <Canvas
          camera={{
            position: [5, 5, 5],
            fov: 60,
            up: [0, 0, 1]
          }}
          style={{ width: '100%', height: '100%' }}
        >
          <Scene
            pointCloudHistory={pointCloudHistory}
            odometry={odometry}
            maxPoints={maxPoints}
          />
        </Canvas>
      </div>

      {/* 控制面板 */}
      <div style={{
        position: 'absolute',
        top: 16,
        left: 16,
        background: 'rgba(255, 255, 255, 0.95)',
        padding: '12px 16px',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        minWidth: 280,
        zIndex: 10
      }}>
        <div style={{ marginBottom: 12, fontWeight: 600, color: '#262626' }}>
          点云控制
        </div>

        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <div style={{ fontSize: 12, color: '#8c8c8c' }}>
            累计帧数: <strong>{pointCloudHistory.length}</strong> / 总点数: <strong>{totalPoints.toLocaleString()}</strong>
          </div>

          <div>
            <div style={{ fontSize: 12, color: '#595959', marginBottom: 4 }}>
              最大点数上限: {(maxPoints / 1000).toFixed(0)}K ({maxPoints.toLocaleString()} 个点)
            </div>
            <Slider
              min={50000}
              max={1000000}
              step={50000}
              value={maxPoints}
              onChange={setMaxPoints}
              tooltip={{ formatter: (v) => `${(v / 1000).toFixed(0)}K 点` }}
            />
          </div>

          <Space>
            <Button
              size="small"
              icon={isPaused ? <PlayCircleOutlined /> : <PauseOutlined />}
              onClick={handleTogglePause}
              type={isPaused ? 'primary' : 'default'}
            >
              {isPaused ? '继续' : '暂停'}
            </Button>
            <Button
              size="small"
              icon={<ClearOutlined />}
              onClick={handleClear}
              danger
            >
              清空
            </Button>
          </Space>
        </Space>
      </div>
    </div>
  );
}
