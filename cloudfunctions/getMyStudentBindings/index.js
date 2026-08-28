const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

async function getCurrentUser(openid) {
  const result = await db
    .collection('users')
    .where({ openid })
    .limit(2)
    .get()

  if (result.data.length !== 1) {
    return null
  }

  return result.data[0]
}

async function getSingle(collectionName, where) {
  const result = await db
    .collection(collectionName)
    .where(where)
    .limit(2)
    .get()

  return result.data.length === 1 ? result.data[0] : null
}

exports.main = async () => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!openid) {
    return {
      success: false,
      code: 'NO_OPENID',
      message: '未获取到微信用户标识'
    }
  }

  try {
    const user = await getCurrentUser(openid)

    if (!user || user.status !== 'active') {
      return {
        success: false,
        code: 'USER_NOT_ACTIVE',
        message: '当前用户不存在或不可用，请重新登录'
      }
    }

    const bindingResult = await db
      .collection('guardian_student_bindings')
      .where({
        user_id: user.user_id,
        status: 'active'
      })
      .limit(20)
      .get()

    const bindings = []

    for (const binding of bindingResult.data) {
      const subject = await getSingle('subjects', {
        subject_id: binding.subject_id,
        subject_type: 'student',
        status: 'active'
      })

      if (!subject || subject.model_framework !== 'student_v1.0') {
        continue
      }

      const membership = await getSingle('class_memberships', {
        subject_id: subject.subject_id,
        subject_type: 'student',
        membership_role: 'student',
        status: 'active'
      })

      let classRecord = null
      let schoolRecord = null

      if (membership) {
        classRecord = await getSingle('classes', {
          class_id: membership.class_id,
          status: 'active'
        })

        if (classRecord) {
          schoolRecord = await getSingle('schools', {
            school_id: classRecord.school_id,
            status: 'active'
          })
        }
      }

      bindings.push({
        binding_id: binding.binding_id,
        status: binding.status,
        bound_at: binding.bound_at || null,
        student: {
          subject_id: subject.subject_id,
          subject_type: subject.subject_type,
          framework: subject.model_framework,
          status: subject.status,
          research_alias: subject.research_alias || ''
        },
        organization: {
          school_id: schoolRecord ? schoolRecord.school_id : '',
          school_name: schoolRecord
            ? schoolRecord.school_name || schoolRecord.display_name || ''
            : '',
          class_id: classRecord ? classRecord.class_id : '',
          class_name: classRecord
            ? classRecord.class_name || classRecord.display_name || ''
            : ''
        }
      })
    }

    return {
      success: true,
      has_bindings: bindings.length > 0,
      bindings
    }
  } catch (error) {
    console.error('getMyStudentBindings error:', error)

    return {
      success: false,
      code: 'GET_STUDENT_BINDINGS_ERROR',
      message: '读取学生绑定失败'
    }
  }
}
