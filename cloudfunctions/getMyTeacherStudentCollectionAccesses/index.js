const cloud = require('wx-server-sdk')
const {
  authorizeStudentOperator,
  loadActiveTeacherMapping
} = require('./student-operator-auth')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

async function getCurrentUser(openid) {
  const result = await db.collection('users').where({ openid, status: 'active' }).limit(2).get()
  return result.data.length === 1 ? result.data[0] : null
}

async function loadProgress(subjectId) {
  const result = await db.collection('collection_progress').where({
    subject_id: subjectId,
    subject_type: 'student',
    framework: 'student_v1.0',
    collection_phase: 'initial'
  }).limit(2).get()
  if (result.data.length > 1) return null
  const progress = result.data[0] || {}
  return {
    progress_id: progress.progress_id || progress._id || '',
    completed_tasks: Number(progress.completed_tasks || progress.completed_count || 0),
    total_tasks: 17,
    current_task_id: progress.current_task_id || '',
    status: progress.status || 'not_started'
  }
}

exports.main = async () => {
  const openid = cloud.getWXContext().OPENID
  if (!openid) return { success: false, code: 'NO_OPENID', message: '未获取到微信用户标识' }

  try {
    const user = await getCurrentUser(openid)
    if (!user) return { success: false, code: 'USER_NOT_ACTIVE', message: '当前用户不存在或不可用' }
    const mapping = await loadActiveTeacherMapping(db, user.user_id)
    if (mapping.error) return { success: false, code: mapping.error, message: mapping.message }
    if (!mapping.record) {
      return { success: false, code: 'TEACHER_BINDING_NOT_ACTIVE', message: '请先完成教师主体绑定' }
    }

    const accessResult = await db.collection('teacher_student_collection_access').where({
      user_id: user.user_id,
      teacher_subject_id: mapping.record.subject_id,
      status: 'active'
    }).limit(100).get()
    const accesses = []

    for (const access of accessResult.data) {
      const authorization = await authorizeStudentOperator({
        db,
        openid,
        subjectId: access.student_subject_id
      })
      if (!authorization.authorized || authorization.operator_type !== 'teacher') continue

      const progress = await loadProgress(access.student_subject_id)
      if (!progress) {
        return { success: false, code: 'DUPLICATE_STUDENT_COLLECTION_PROGRESS', message: '学生首次采集进度存在重复' }
      }
      accesses.push({
        access_id: access.access_id || access._id,
        status: 'active',
        access_role: 'teacher_collector',
        student: {
          subject_id: authorization.subject.subject_id,
          subject_type: 'student',
          framework: 'student_v1.0',
          status: authorization.subject.status,
          research_alias: authorization.subject.research_alias || ''
        },
        organization: authorization.shared_organization,
        progress
      })
    }

    return {
      success: true,
      teacher_subject_id: mapping.record.subject_id,
      has_accesses: accesses.length > 0,
      accesses
    }
  } catch (error) {
    console.error('getMyTeacherStudentCollectionAccesses error:', error)
    return { success: false, code: 'GET_TEACHER_STUDENT_ACCESSES_ERROR', message: '读取已关联学生失败' }
  }
}
