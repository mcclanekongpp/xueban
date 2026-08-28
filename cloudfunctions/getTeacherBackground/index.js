const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()


// ==================================================
// getTeacherBackground
//
// 职责：
// 1. 识别当前微信用户
// 2. 确认教师身份
// 3. 找到当前教师 subject_id
// 4. 读取 subject_background 中当前有效的 T0
// 5. 有数据则返回
// 6. 无数据则明确返回 has_background = false
//
// 本函数：
// - 不写数据库
// - 不做 AI 分析
// - 不做能力判断
// - 不生成教师主体模型
// ==================================================

exports.main = async (event, context) => {
  try {
    // ==================================================
    // 1. 获取当前微信身份
    // ==================================================

    const wxContext =
      cloud.getWXContext()

    const openid =
      wxContext.OPENID

    if (!openid) {
      return {
        success: false,
        code: 'NO_OPENID',
        message: '未获取到微信用户标识'
      }
    }


    // ==================================================
    // 2. 查询当前用户
    // ==================================================

    const userResult =
      await db
        .collection('users')
        .where({
          openid: openid
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
    // 3. 查询当前教师主体
    // ==================================================

    const mapResult =
      await db
        .collection('identity_map')
        .where({
          user_id: user.user_id,
          identity_type: 'teacher'
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
    // 4. 查询当前有效 T0 背景资料
    // ==================================================

    const backgroundResult =
      await db
        .collection('subject_background')
        .where({
          subject_id: subjectId,
          subject_type: 'teacher',
          framework: 'teacher_v1.0',
          status: 'active'
        })
        .limit(1)
        .get()


    // ==================================================
    // 5. 尚未填写背景资料
    //
    // 这是正常业务状态，不视为错误。
    // ==================================================

    if (
      backgroundResult.data.length === 0
    ) {
      return {
        success: true,

        has_background: false,

        subject_id:
          subjectId,

        framework:
          'teacher_v1.0',

        background:
          null,

        message:
          '当前教师尚未填写基本背景资料'
      }
    }


    // ==================================================
    // 6. 读取背景资料
    // ==================================================

    const record =
      backgroundResult.data[0]


    // ==================================================
    // 7. 只返回前端需要的 T0 字段
    //
    // 不直接把数据库内部结构全部暴露给前端。
    // ==================================================

    const background = {
      background_id:
        record.background_id || '',

      subject_id:
        subjectId,

      subject_type:
        'teacher',

      framework:
        record.framework ||
        'teacher_v1.0',

      teaching_years:
        typeof record.teaching_years === 'number'
          ? record.teaching_years
          : 0,

      highest_education:
        record.highest_education || '',

      major_background:
        record.major_background || '',

      current_subject:
        record.current_subject || '',

      current_grade:
        record.current_grade || '',

      teaching_experience: {
        grades_taught:
          record.teaching_experience &&
          Array.isArray(
            record.teaching_experience
              .grades_taught
          )
            ? record.teaching_experience
                .grades_taught
            : [],

        subjects_taught:
          record.teaching_experience &&
          Array.isArray(
            record.teaching_experience
              .subjects_taught
          )
            ? record.teaching_experience
                .subjects_taught
            : [],

        lower_grade_experience:
          !!(
            record.teaching_experience &&
            record.teaching_experience
              .lower_grade_experience === true
          ),

        other_description:
          record.teaching_experience &&
          typeof record.teaching_experience
            .other_description === 'string'
            ? record.teaching_experience
                .other_description
            : ''
      },

      training_experience:
        Array.isArray(
          record.training_experience
        )
          ? record.training_experience
          : [],

      data_source:
        record.data_source ||
        'self_report',

      collection_method:
        record.collection_method ||
        'background_form',

      version:
        record.version ||
        '1.0',

      status:
        record.status ||
        'active',

      created_at:
        record.created_at ||
        null,

      updated_at:
        record.updated_at ||
        null
    }


    // ==================================================
    // 8. 返回
    // ==================================================

    return {
      success: true,

      has_background: true,

      subject_id:
        subjectId,

      framework:
        'teacher_v1.0',

      background:
        background,

      message:
        '教师基本背景读取成功'
    }

  } catch (error) {
    console.error(
      'getTeacherBackground error:',
      error
    )

    return {
      success: false,

      code:
        'GET_TEACHER_BACKGROUND_ERROR',

      message:
        error.message ||
        '教师基本背景读取失败'
    }
  }
}