const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()


// ==================================================
// getTeacherCurrentModel
//
// 职责：
// 1. 识别当前教师
// 2. 获取当前教师 subject_id
// 3. 读取当前正式主体模型
// 4. 只读，不调用 AI，不修改模型
// ==================================================

exports.main = async (event, context) => {
  try {
    const wxContext =
      cloud.getWXContext()

    const openid =
      wxContext.OPENID


    // ==================================================
    // 1. 微信身份
    // ==================================================

    if (!openid) {
      return {
        success: false,
        code: 'NO_OPENID',
        message: '未获取到微信用户标识'
      }
    }


    // ==================================================
    // 2. 当前用户
    // ==================================================

    const userResult =
      await db
        .collection('users')
        .where({
          openid
        })
        .limit(1)
        .get()


    if (
      userResult.data.length === 0
    ) {
      return {
        success: false,
        code: 'USER_NOT_FOUND',
        message: '用户不存在，请先登录'
      }
    }


    const user =
      userResult.data[0]


    if (
      user.role !== 'teacher'
    ) {
      return {
        success: false,
        code: 'NOT_TEACHER',
        message: '当前账号不是教师身份'
      }
    }


    // ==================================================
    // 3. 当前教师主体
    // ==================================================

    const mapResult =
      await db
        .collection('identity_map')
        .where({
          user_id:
            user.user_id,

          identity_type:
            'teacher'
        })
        .limit(1)
        .get()


    if (
      mapResult.data.length === 0
    ) {
      return {
        success: false,
        code: 'SUBJECT_NOT_FOUND',
        message: '尚未建立教师主体'
      }
    }


    const subjectId =
      mapResult.data[0].subject_id


    // ==================================================
    // 4. 读取正式 active 模型
    //
    // 当前首版只有 initial 模型，
    // 后续如果增加演化快照，可以继续按 created_at
    // 取最新 active 模型。
    // ==================================================

    const modelResult =
      await db
        .collection('model_snapshots')
        .where({
          subject_id:
            subjectId,

          subject_type:
            'teacher',

          framework:
            'teacher_v1.0',

          status:
            'active'
        })
        .orderBy(
          'created_at',
          'desc'
        )
        .limit(1)
        .get()


    // ==================================================
    // 5. 尚未形成正式模型
    // ==================================================

    if (
      modelResult.data.length === 0
    ) {
      return {
        success: true,

        has_model: false,

        subject_id:
          subjectId,

        framework:
          'teacher_v1.0',

        model:
          null,

        snapshot_id:
          '',

        message:
          '当前尚未形成正式教师主体模型'
      }
    }


    // ==================================================
    // 6. 返回当前正式模型
    // ==================================================

    const snapshot =
      modelResult.data[0]


    return {
      success: true,

      has_model: true,

      subject_id:
        subjectId,

      framework:
        snapshot.framework ||
        'teacher_v1.0',

      snapshot_id:
        snapshot.snapshot_id ||
        '',

      snapshot_type:
        snapshot.snapshot_type ||
        '',

      model_version:
        snapshot.model_version ||
        '',

      model_status:
        'active',

      model_status_name:
        snapshot.activation_mode === 'automatic_rule'
          ? '规则自动更新'
          : snapshot.activation_mode === 'automatic_initial'
            ? '自动构建'
            : '历史已生效',

      activation_mode:
        snapshot.activation_mode ||
        '',

      model:
        snapshot.model_data ||
        null,

      created_at:
        snapshot.created_at ||
        null,

      updated_at:
        snapshot.updated_at ||
        null,

      activated_at:
        snapshot.activated_at ||
        snapshot.approved_at ||
        null,

      message:
        '当前教师主体模型读取成功'
    }

  } catch (error) {
    console.error(
      'getTeacherCurrentModel error:',
      error
    )

    return {
      success: false,
      code:
        'GET_TEACHER_CURRENT_MODEL_ERROR',
      message:
        error.message ||
        '读取当前教师主体模型失败'
    }
  }
}
