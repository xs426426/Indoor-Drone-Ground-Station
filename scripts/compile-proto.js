/**
 * 编译 Protobuf 文件为 JavaScript
 * 这个脚本会验证 proto 文件是否可以被 protobufjs 正确加载
 */

const protobuf = require('protobufjs');
const path = require('path');
const fs = require('fs');

const protoDir = path.join(__dirname, '../proto');
const protoFiles = [
  'common.proto',
  'pointcloud.proto',
  'drone.proto',
  'mission.proto',
  'image.proto',
  'control.proto',
  'camera.proto'
];

async function compileProtos() {
  console.log('🔧 开始编译 Protobuf 文件...\n');

  try {
    // 检查文件是否存在
    for (const file of protoFiles) {
      const filePath = path.join(protoDir, file);
      if (!fs.existsSync(filePath)) {
        throw new Error(`文件不存在: ${filePath}`);
      }
      console.log(`✓ 找到文件: ${file}`);
    }

    console.log('\n📦 加载 Protobuf 定义...');

    // 加载所有 proto 文件
    const root = new protobuf.Root();
    root.resolvePath = (origin, target) => {
      return path.join(protoDir, target);
    };

    for (const file of protoFiles) {
      await root.load(path.join(protoDir, file));
    }

    console.log('\n✅ Protobuf 编译成功!');
    console.log('\n📋 可用的消息类型:');

    // 列出所有消息类型
    const types = [
      'daf.PointCloud',
      'daf.LocalOdometry',
      'daf.Heartbeat',
      'daf.Image',
      'daf.Command',
      'daf.mission.Mission',
      'daf.mission.Execution',
      'daf.mission.Receipt'
    ];

    types.forEach(type => {
      try {
        const messageType = root.lookupType(type);
        console.log(`  ✓ ${type}`);
      } catch (e) {
        console.log(`  ✗ ${type} (未找到)`);
      }
    });

    console.log('\n💡 提示: proto 文件已准备就绪，可以启动服务器了!');
    console.log('   运行: npm start\n');

  } catch (error) {
    console.error('\n❌ 编译失败:', error.message);
    console.error('\n详细错误:', error);
    process.exit(1);
  }
}

compileProtos();
