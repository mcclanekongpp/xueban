const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

// 发布版保留函数名以避免历史调用得到不可预测结果，但彻底关闭
// QuickStart 示例中的建集合、增删改查和生成二维码能力。
exports.main = async () => ({
  success: false,
  code: 'QUICKSTART_DISABLED_FOR_RELEASE',
  message: 'QuickStart 示例能力已在真人试采版停用'
})
