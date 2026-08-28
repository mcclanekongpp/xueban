const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36).toUpperCase()}_${Math.random()
    .toString(36)
    .slice(2, 7)
    .toUpperCase()}`
}

async function resolveBoundStudent(openid, subjectId) {
  const userResult = await db
    .collection('users')
    .where({ openid, status: 'active' })
    .limit(2)
    .get()

  if (userResult.data.length !== 1) {
    return { error: 'USER_NOT_ACTIVE' }
  }

  const user = userResult.data[0]
  const bindingResult = await db
    .collection('guardian_student_bindings')
    .where({ user_id: user.user_id, subject_id: subjectId, status: 'active' })
    .limit(2)
    .get()

  if (bindingResult.data.length !== 1) {
    return { error: 'STUDENT_BINDING_NOT_ACTIVE' }
  }

  const subjectResult = await db
    .collection('subjects')
    .where({
      subject_id: subjectId,
      subject_type: 'student',
      model_framework: 'student_v1.0',
      status: 'active'
    })
    .limit(2)
    .get()

  if (subjectResult.data.length !== 1) {
    return { error: 'STUDENT_SUBJECT_NOT_ACTIVE' }
  }

  return { user, subject: subjectResult.data[0] }
}

exports.main = async (event = {}) => {
  const openid = cloud.getWXContext().OPENID
  const subjectId =
    typeof event.subject_id === 'string' ? event.subject_id.trim() : ''

  if (!openid || !subjectId) {
    return {
      success: false,
      code: !openid ? 'NO_OPENID' : 'STUDENT_SUBJECT_ID_REQUIRED',
      message: !openid ? '未获取到微信用户标识' : '缺少学生研究主体编号'
    }
  }

  try {
    const resolved = await resolveBoundStudent(openid, subjectId)

    if (resolved.error) {
      return {
        success: false,
        code: resolved.error,
        message: '当前微信无权初始化该学生背景'
      }
    }

    const existingResult = await db
      .collection('subject_background')
      .where({
        subject_id: subjectId,
        subject_type: 'student',
        framework: 'student_v1.0',
        status: 'active'
      })
      .limit(2)
      .get()

    if (existingResult.data.length > 1) {
      return {
        success: false,
        code: 'DUPLICATE_STUDENT_BACKGROUND',
        message: '该学生存在重复的有效 S0 记录'
      }
    }

    if (existingResult.data.length === 1) {
      return {
        success: true,
        created: false,
        background: existingResult.data[0]
      }
    }

    const membershipResult = await db
      .collection('class_memberships')
      .where({
        subject_id: subjectId,
        subject_type: 'student',
        membership_role: 'student',
        status: 'active'
      })
      .limit(2)
      .get()

    if (membershipResult.data.length !== 1) {
      return {
        success: false,
        code: 'STUDENT_CLASS_MEMBERSHIP_INVALID',
        message: '学生班级关系缺失或重复'
      }
    }

    const membership = membershipResult.data[0]
    const classResult = await db
      .collection('classes')
      .where({ class_id: membership.class_id, status: 'active' })
      .limit(2)
      .get()

    if (classResult.data.length !== 1) {
      return {
        success: false,
        code: 'STUDENT_CLASS_NOT_ACTIVE',
        message: '学生所在班级不存在或已失效'
      }
    }

    const classRecord = classResult.data[0]
    const backgroundId = makeId('BG')
    const now = db.serverDate()
    const background = {
      background_id: backgroundId,
      subject_id: subjectId,
      subject_type: 'student',
      framework: 'student_v1.0',
      school_id: classRecord.school_id || '',
      class_id: classRecord.class_id || membership.class_id,
      grade: classRecord.grade || '',
      academic_year: classRecord.academic_year || '',
      research_alias: resolved.subject.research_alias || '',
      student_display_code: resolved.subject.research_alias || '',
      background_version: '1.0',
      version: '1.0',
      data_source: 'organization_records',
      collection_method: 'automatic_derivation',
      status: 'active',
      is_test: resolved.subject.is_test === true,
      created_at: now,
      updated_at: now
    }

    const addResult = await db.collection('subject_background').add({
      data: background
    })

    return {
      success: true,
      created: true,
      database_id: addResult._id,
      background
    }
  } catch (error) {
    console.error('ensureStudentBackground error:', error)
    return {
      success: false,
      code: 'ENSURE_STUDENT_BACKGROUND_ERROR',
      message: '初始化学生 S0 失败'
    }
  }
}
