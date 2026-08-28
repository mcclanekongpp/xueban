const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()


// ==================================================
// ID 生成
// ==================================================

function createId(prefix) {
  const timePart = Date.now()
    .toString(36)
    .toUpperCase()

  const randomPart = Math.random()
    .toString(36)
    .substring(2, 7)
    .toUpperCase()

  return `${prefix}_${timePart}_${randomPart}`
}


// ==================================================
// 字符串清理
// ==================================================

function normalizeString(value) {
  if (typeof value !== 'string') {
    return ''
  }

  return value.trim()
}


// ==================================================
// 字符串数组清理
// ==================================================

function normalizeStringArray(value, maxItems = 20) {
  if (!Array.isArray(value)) {
    return []
  }

  const result = []

  for (const item of value) {
    if (typeof item !== 'string') {
      continue
    }

    const text = item.trim()

    if (!text) {
      continue
    }

    if (!result.includes(text)) {
      result.push(text)
    }

    if (result.length >= maxItems) {
      break
    }
  }

  return result
}


// ==================================================
// 云函数入口
//
// T0 教师基本背景
//
// 仅保存客观背景资料：
//
// teaching_years
// highest_education
// major_background
// current_subject
// current_grade
// teaching_experience
// training_experience
//
// 不评分
// 不分析
// 不推断教师能力或教学思想
// ==================================================

exports.main = async (event, context) => {
  try {
    const wxContext = cloud.getWXContext()
    const openid = wxContext.OPENID

    // ==================================================
    // 1. 身份校验
    // ==================================================

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

    const userResult = await db
      .collection('users')
      .where({
        openid: openid
      })
      .limit(1)
      .get()

    if (userResult.data.length === 0) {
      return {
        success: false,
        code: 'USER_NOT_FOUND',
        message: '用户不存在，请先登录'
      }
    }

    const user = userResult.data[0]

    if (user.role !== 'teacher') {
      return {
        success: false,
        code: 'NOT_TEACHER',
        message: '当前账号不是教师身份'
      }
    }


    // ==================================================
    // 3. 查询当前教师主体
    // ==================================================

    const mapResult = await db
      .collection('identity_map')
      .where({
        user_id: user.user_id,
        identity_type: 'teacher'
      })
      .limit(1)
      .get()

    if (mapResult.data.length === 0) {
      return {
        success: false,
        code: 'SUBJECT_NOT_FOUND',
        message: '尚未建立教师主体'
      }
    }

    const subjectId =
      mapResult.data[0].subject_id


    // ==================================================
    // 4. teaching_years
    // ==================================================

    const teachingYears =
      Number(event.teaching_years)

    if (
      !Number.isFinite(teachingYears) ||
      teachingYears < 0 ||
      teachingYears > 60
    ) {
      return {
        success: false,
        code: 'INVALID_TEACHING_YEARS',
        message: '教龄应为 0—60 之间的数字'
      }
    }


    // ==================================================
    // 5. 基础字符串字段
    // ==================================================

    const highestEducation =
      normalizeString(
        event.highest_education
      )

    const majorBackground =
      normalizeString(
        event.major_background
      )

    const currentSubject =
      normalizeString(
        event.current_subject
      )

    const currentGrade =
      normalizeString(
        event.current_grade
      )

    if (!highestEducation) {
      return {
        success: false,
        code: 'EDUCATION_REQUIRED',
        message: '请填写最高学历'
      }
    }

    if (!majorBackground) {
      return {
        success: false,
        code: 'MAJOR_REQUIRED',
        message: '请填写专业背景'
      }
    }

    if (!currentSubject) {
      return {
        success: false,
        code: 'CURRENT_SUBJECT_REQUIRED',
        message: '请填写当前任教学科'
      }
    }

    if (!currentGrade) {
      return {
        success: false,
        code: 'CURRENT_GRADE_REQUIRED',
        message: '请填写当前任教年级'
      }
    }

    if (
      highestEducation.length > 50 ||
      majorBackground.length > 100 ||
      currentSubject.length > 100 ||
      currentGrade.length > 100
    ) {
      return {
        success: false,
        code: 'BACKGROUND_TEXT_TOO_LONG',
        message: '部分背景信息内容过长'
      }
    }


    // ==================================================
    // 6. teaching_experience
    // ==================================================

    const experienceInput =
      event.teaching_experience &&
      typeof event.teaching_experience === 'object' &&
      !Array.isArray(
        event.teaching_experience
      )
        ? event.teaching_experience
        : {}

    const gradesTaught =
      normalizeStringArray(
        experienceInput.grades_taught,
        20
      )

    const subjectsTaught =
      normalizeStringArray(
        experienceInput.subjects_taught,
        20
      )

    const lowerGradeExperience =
      experienceInput
        .lower_grade_experience === true

    const otherDescription =
      normalizeString(
        experienceInput.other_description
      )

    if (otherDescription.length > 500) {
      return {
        success: false,
        code: 'EXPERIENCE_DESCRIPTION_TOO_LONG',
        message: '相关教学经历补充说明过长'
      }
    }

    const teachingExperience = {
      grades_taught:
        gradesTaught,

      subjects_taught:
        subjectsTaught,

      lower_grade_experience:
        lowerGradeExperience,

      other_description:
        otherDescription
    }


    // ==================================================
    // 7. training_experience
    //
    // 没有培训经历时允许为空数组。
    // ==================================================

    const trainingExperience =
      normalizeStringArray(
        event.training_experience,
        30
      )

    for (
      const training of trainingExperience
    ) {
      if (training.length > 300) {
        return {
          success: false,
          code: 'TRAINING_ITEM_TOO_LONG',
          message: '单条培训经历内容过长'
        }
      }
    }


    // ==================================================
    // 8. 构造 T0 数据
    //
    // 注意：
    // 这些字段只是背景事实。
    // 不直接形成教师能力或教学思想判断。
    // ==================================================

    const now = new Date()

    const backgroundData = {
      subject_id:
        subjectId,

      subject_type:
        'teacher',

      framework:
        'teacher_v1.0',

      teaching_years:
        teachingYears,

      highest_education:
        highestEducation,

      major_background:
        majorBackground,

      current_subject:
        currentSubject,

      current_grade:
        currentGrade,

      teaching_experience:
        teachingExperience,

      training_experience:
        trainingExperience,

      data_source:
        'self_report',

      collection_method:
        'background_form',

      version:
        '1.0',

      status:
        'active',

      updated_at:
        now
    }


    // ==================================================
    // 9. 查询是否已有 active T0
    //
    // 一个教师主体默认只保留一条
    // 当前有效背景记录。
    // ==================================================

    const existingResult =
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
    // 10A. 已存在 → 更新
    // ==================================================

    if (
      existingResult.data.length > 0
    ) {
      const existing =
        existingResult.data[0]

      await db
        .collection('subject_background')
        .doc(existing._id)
        .update({
          data: backgroundData
        })

      return {
        success: true,

        created: false,

        updated: true,

        background_id:
          existing.background_id,

        subject_id:
          subjectId,

        background: {
          ...backgroundData,

          background_id:
            existing.background_id,

          created_at:
            existing.created_at ||
            null
        },

        message:
          '教师基本背景已更新'
      }
    }


    // ==================================================
    // 10B. 不存在 → 创建
    // ==================================================

    const backgroundId =
      createId('BG')

    const newRecord = {
      background_id:
        backgroundId,

      ...backgroundData,

      created_at:
        now
    }

    const addResult =
      await db
        .collection('subject_background')
        .add({
          data: newRecord
        })


    // ==================================================
    // 11. 返回
    // ==================================================

    return {
      success: true,

      created: true,

      updated: false,

      background_id:
        backgroundId,

      database_id:
        addResult._id,

      subject_id:
        subjectId,

      background:
        newRecord,

      message:
        '教师基本背景已保存'
    }

  } catch (error) {
    console.error(
      'saveTeacherBackground error:',
      error
    )

    return {
      success: false,

      code:
        'SAVE_TEACHER_BACKGROUND_ERROR',

      message:
        error.message ||
        '教师基本背景保存失败'
    }
  }
}