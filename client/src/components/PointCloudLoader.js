import React, { useState } from 'react';
import { Card, Upload, Button, message, Space, InputNumber, Row, Col } from 'antd';
import { UploadOutlined, EnvironmentOutlined, RocketOutlined, DownloadOutlined } from '@ant-design/icons';

/**
 * 点云文件加载器组件
 */
function PointCloudLoader({ onPointCloudLoaded, onStartPositionSet, accumulatedPointCloud }) {
  const [loading, setLoading] = useState(false);
  const [fileInfo, setFileInfo] = useState(null);
  const [startPosition, setStartPosition] = useState({ x: 0, y: 0, z: 1.5 });

  /**
   * 解析PCD文件
   */
  const parsePCDFile = async (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          console.log('🔍 开始解析PCD文件:', file.name, '大小:', (file.size / 1024 / 1024).toFixed(2), 'MB');

          const text = e.target.result;
          const lines = text.split('\n');
          console.log('📄 文件总行数:', lines.length);

          let dataStarted = false;
          let totalPoints = 0;
          const points = [];
          let loadedCount = 0; // 用于采样的计数器

          // 解析PCD文件
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // 读取点数
            if (line.startsWith('POINTS')) {
              totalPoints = parseInt(line.split(/\s+/)[1]);
              console.log('📊 PCD文件声明点数:', totalPoints);
            }

            // 数据开始标记
            if (line.startsWith('DATA')) {
              dataStarted = true;
              console.log('🔄 开始解析点云数据...');
              continue;
            }

            // 解析点云数据
            if (dataStarted && line) {
              const parts = line.split(/\s+/);
              if (parts.length >= 4) {
                const x = parseFloat(parts[0]);
                const y = parseFloat(parts[1]);
                const z = parseFloat(parts[2]);
                const rgb = parseInt(parts[3]);

                // 跳过无效数据
                if (isNaN(x) || isNaN(y) || isNaN(z)) {
                  loadedCount++;
                  continue;
                }

                // 采样：不采样，全部加载（最多50万点）
                if (points.length < 500000) {
                  points.push({
                    xyz: {
                      x: x,
                      y: y,
                      z: z
                    },
                    intensity: Math.floor(rgb & 0xFF),
                    rgb: rgb
                  });
                }
                loadedCount++;
              }
            }
          }

          // 检查是否成功加载点
          if (points.length === 0) {
            console.error('❌ 未找到有效的点云数据');
            console.log('调试信息:', {
              totalPoints,
              dataStarted,
              loadedCount,
              linesCount: lines.length
            });
            reject(new Error('未找到有效的点云数据，请检查PCD文件格式'));
            return;
          }

          console.log(`✅ 解析完成: ${points.length} 个点 (总数 ${totalPoints})`);
          console.log(`📈 采样率: ${(points.length / totalPoints * 100).toFixed(1)}%`);

          // 计算场景边界（使用循环避免堆栈溢出）
          let minX = Infinity, maxX = -Infinity;
          let minY = Infinity, maxY = -Infinity;
          let minZ = Infinity, maxZ = -Infinity;

          for (let i = 0; i < points.length; i++) {
            const p = points[i].xyz;
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
            if (p.z < minZ) minZ = p.z;
            if (p.z > maxZ) maxZ = p.z;
          }

          const bounds = { minX, maxX, minY, maxY, minZ, maxZ };

          console.log('📐 场景边界:', bounds);

          // 计算场景中心作为默认起点
          const centerX = (bounds.minX + bounds.maxX) / 2;
          const centerY = (bounds.minY + bounds.maxY) / 2;
          const centerZ = Math.max(bounds.minZ + 1.5, 1.5); // 离地1.5米

          console.log('🎯 默认起点:', { x: centerX.toFixed(2), y: centerY.toFixed(2), z: centerZ.toFixed(2) });

          resolve({
            fileName: file.name,
            totalPoints: totalPoints,
            loadedPoints: points.length,
            points: points,
            bounds: bounds,
            defaultStart: {
              x: parseFloat(centerX.toFixed(2)),
              y: parseFloat(centerY.toFixed(2)),
              z: parseFloat(centerZ.toFixed(2))
            }
          });
        } catch (error) {
          console.error('❌ PCD解析异常:', error);
          reject(error);
        }
      };

      reader.onerror = () => {
        reject(new Error('文件读取失败'));
      };

      reader.readAsText(file);
    });
  };

  /**
   * 处理文件上传
   */
  const handleUpload = async (file) => {
    setLoading(true);

    try {
      message.loading('正在解析点云文件...', 0);

      const result = await parsePCDFile(file);

      message.destroy();
      message.success(`加载成功！共 ${result.loadedPoints.toLocaleString()} 个点`);

      setFileInfo(result);
      setStartPosition(result.defaultStart);

      // 通知父组件
      if (onPointCloudLoaded) {
        onPointCloudLoaded(result);
      }

    } catch (error) {
      message.destroy();
      message.error('解析失败: ' + error.message);
      console.error('PCD解析错误:', error);
    } finally {
      setLoading(false);
    }

    return false; // 阻止自动上传
  };

  /**
   * 设置起始位置
   */
  const handleSetStartPosition = () => {
    if (!fileInfo) {
      message.warning('请先加载点云文件');
      return;
    }

    if (onStartPositionSet) {
      onStartPositionSet(startPosition);
    }

    message.success(`起点已设置: (${startPosition.x}, ${startPosition.y}, ${startPosition.z})`);
  };

  /**
   * 清空点云
   */
  const handleClearPointCloud = () => {
    setFileInfo(null);
    setStartPosition({ x: 0, y: 0, z: 1.5 });
    if (onPointCloudLoaded) {
      onPointCloudLoaded(null);
    }
    message.info('点云已清空');
  };

  /**
   * 保存当前3D视图中的累积点云为PCD文件
   */
  const handleSavePointCloud = () => {
    // 检查是否有累积的点云数据
    if (!accumulatedPointCloud || !accumulatedPointCloud.history || accumulatedPointCloud.history.length === 0) {
      message.warning('当前没有可保存的点云数据');
      return;
    }

    const { history, totalPoints } = accumulatedPointCloud;

    // 合并所有历史帧的点云数据
    let allPoints = [];
    history.forEach(frame => {
      if (frame.points) {
        allPoints = allPoints.concat(frame.points);
      }
    });

    if (allPoints.length === 0) {
      message.warning('点云数据为空');
      return;
    }

    message.loading('正在生成PCD文件...', 0);

    try {
      // 生成PCD文件内容
      const pcdContent = generatePCDContent(allPoints);

      // 创建Blob并下载
      const blob = new Blob([pcdContent], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);

      // 生成文件名（带时间戳）
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `pointcloud_${timestamp}.pcd`;

      // 创建下载链接并触发下载
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // 释放URL
      URL.revokeObjectURL(url);

      message.destroy();
      message.success(`点云已保存: ${filename} (${allPoints.length.toLocaleString()} 个点)`);
    } catch (error) {
      message.destroy();
      message.error('保存失败: ' + error.message);
      console.error('保存点云失败:', error);
    }
  };

  /**
   * 生成PCD文件内容
   */
  const generatePCDContent = (points) => {
    // PCD文件头
    const header = [
      '# .PCD v0.7 - Point Cloud Data file format',
      'VERSION 0.7',
      'FIELDS x y z intensity',
      'SIZE 4 4 4 4',
      'TYPE F F F U',
      'COUNT 1 1 1 1',
      `WIDTH ${points.length}`,
      'HEIGHT 1',
      'VIEWPOINT 0 0 0 1 0 0 0',
      `POINTS ${points.length}`,
      'DATA ascii'
    ].join('\n');

    // 点云数据
    const data = points.map(point => {
      const x = point.xyz?.x ?? point.x ?? 0;
      const y = point.xyz?.y ?? point.y ?? 0;
      const z = point.xyz?.z ?? point.z ?? 0;
      const intensity = point.intensity ?? 128;
      return `${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)} ${Math.floor(intensity)}`;
    }).join('\n');

    return header + '\n' + data;
  };

  return (
    <Card
      title={<><UploadOutlined /> 点云场景加载</>}
      className="content-card"
    >
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        {/* 文件上传、保存和清空按钮 */}
        <Space direction="horizontal" style={{ width: '100%' }} size="small">
          <Upload
            accept=".pcd"
            beforeUpload={handleUpload}
            showUploadList={false}
            disabled={loading}
            style={{ flex: 1 }}
          >
            <Button
              icon={<UploadOutlined />}
              loading={loading}
              size="large"
              block
            >
              {fileInfo ? '重新加载' : '加载点云'}
            </Button>
          </Upload>
          <Button
            icon={<DownloadOutlined />}
            size="large"
            onClick={handleSavePointCloud}
            disabled={!accumulatedPointCloud || accumulatedPointCloud.totalPoints === 0}
            title={accumulatedPointCloud?.totalPoints > 0 ? `保存 ${accumulatedPointCloud.totalPoints.toLocaleString()} 个点` : '暂无点云数据'}
          >
            保存点云
          </Button>
          {fileInfo && (
            <Button
              danger
              size="large"
              onClick={handleClearPointCloud}
            >
              清空
            </Button>
          )}
        </Space>

        {/* 场景信息 */}
        {fileInfo && (
          <div style={{
            padding: '12px',
            background: '#f0f2f5',
            borderRadius: '4px',
            fontSize: '13px'
          }}>
            <div><strong>文件名:</strong> {fileInfo.fileName}</div>
            <div><strong>点数:</strong> {fileInfo.loadedPoints.toLocaleString()} / {fileInfo.totalPoints.toLocaleString()}</div>
            <div>
              <strong>场景大小:</strong>{' '}
              {(fileInfo.bounds.maxX - fileInfo.bounds.minX).toFixed(1)}m × {' '}
              {(fileInfo.bounds.maxY - fileInfo.bounds.minY).toFixed(1)}m × {' '}
              {(fileInfo.bounds.maxZ - fileInfo.bounds.minZ).toFixed(1)}m
            </div>
          </div>
        )}

        {/* 起点设置 */}
        {fileInfo && (
          <>
            <div>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>
                <EnvironmentOutlined /> 设置无人机起点
              </div>
              <Row gutter={8}>
                <Col span={8}>
                  <InputNumber
                    addonBefore="X"
                    value={startPosition.x}
                    onChange={(v) => setStartPosition({ ...startPosition, x: v })}
                    step={0.5}
                    style={{ width: '100%' }}
                  />
                </Col>
                <Col span={8}>
                  <InputNumber
                    addonBefore="Y"
                    value={startPosition.y}
                    onChange={(v) => setStartPosition({ ...startPosition, y: v })}
                    step={0.5}
                    style={{ width: '100%' }}
                  />
                </Col>
                <Col span={8}>
                  <InputNumber
                    addonBefore="Z"
                    value={startPosition.z}
                    onChange={(v) => setStartPosition({ ...startPosition, z: v })}
                    step={0.1}
                    min={0.5}
                    style={{ width: '100%' }}
                  />
                </Col>
              </Row>
            </div>

            <Button
              type="primary"
              icon={<RocketOutlined />}
              onClick={handleSetStartPosition}
              size="large"
              block
            >
              应用起点并准备探索
            </Button>

            <div style={{ fontSize: '12px', color: '#888' }}>
              💡 提示: 点云加载后，起点默认为场景中心。您可以手动调整XYZ坐标，然后点击"应用起点"
            </div>
          </>
        )}
      </Space>
    </Card>
  );
}

export default PointCloudLoader;
