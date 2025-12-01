import React, { useEffect, useState, useRef } from 'react';
import { Card, Empty, Spin, Switch, Space } from 'antd';
import { CameraOutlined, VideoCameraOutlined } from '@ant-design/icons';

/**
 * 摄像头视频播放组件
 */
export default function CameraViewer({ cameraData }) {
  const [imageUrl, setImageUrl] = useState(null);
  const [fps, setFps] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const fpsCounterRef = useRef({ count: 0, lastTime: Date.now() });

  useEffect(() => {
    if (cameraData && cameraData.data && autoRefresh) {
      try {
        // 检查是否是 base64 编码的图像
        let base64Data = cameraData.data;

        // 如果是 Buffer 对象，转换为 base64
        if (typeof base64Data === 'object' && base64Data.type === 'Buffer') {
          base64Data = btoa(
            new Uint8Array(base64Data.data)
              .reduce((data, byte) => data + String.fromCharCode(byte), '')
          );
        }

        // 构建图像 URL
        const format = cameraData.format || 'jpeg';
        let mimeType = 'image/jpeg';

        if (format.includes('png')) {
          mimeType = 'image/png';
        } else if (format.includes('bgr8') || format.includes('rgb8')) {
          mimeType = 'image/jpeg';
        }

        const url = `data:${mimeType};base64,${base64Data}`;
        setImageUrl(url);

        // 计算 FPS
        const now = Date.now();
        fpsCounterRef.current.count++;
        if (now - fpsCounterRef.current.lastTime >= 1000) {
          setFps(fpsCounterRef.current.count);
          fpsCounterRef.current.count = 0;
          fpsCounterRef.current.lastTime = now;
        }
      } catch (error) {
        console.error('解析图像数据失败:', error);
      }
    }
  }, [cameraData, autoRefresh]);

  return (
    <Card
      title={
        <Space>
          <VideoCameraOutlined />
          摄像头视频
          {fps > 0 && <span style={{ fontSize: 12, color: '#52c41a' }}>({fps} FPS)</span>}
        </Space>
      }
      size="small"
      extra={
        <Space>
          <span style={{ fontSize: 12 }}>自动刷新</span>
          <Switch
            checked={autoRefresh}
            onChange={setAutoRefresh}
            size="small"
          />
        </Space>
      }
      style={{ height: '100%' }}
    >
      <div className="video-player">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt="无人机摄像头"
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain'
            }}
          />
        ) : (
          <Empty
            image={<CameraOutlined style={{ fontSize: 48, color: '#d9d9d9' }} />}
            description={
              <span style={{ color: '#8c8c8c' }}>
                {autoRefresh ? '等待摄像头数据...' : '视频已暂停'}
              </span>
            }
          />
        )}
      </div>
    </Card>
  );
}
