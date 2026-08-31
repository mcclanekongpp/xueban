const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event = {}) => {
  const openid = cloud.getWXContext().OPENID
  const snapshotId = String(event.snapshot_id || event.approve_snapshot_id || '').trim()

  if (!openid || !snapshotId) {
    return {
      success: false,
      code: !openid ? 'NO_OPENID' : 'SNAPSHOT_ID_REQUIRED',
      message: !openid ? '未获取到微信用户标识' : '缺少 Student-M0 快照编号'
    }
  }

  try {
    const userResult = await db.collection('users').where({ openid }).limit(2).get()
    const user = userResult.data.length === 1 ? userResult.data[0] : null
    const draftResult = await db.collection('model_snapshots').where({
      snapshot_id: snapshotId,
      subject_type: 'student',
      framework: 'student_v1.0',
      snapshot_type: 'initial'
    }).limit(2).get()

    if (!user || draftResult.data.length !== 1) {
      return {
        success: false,
        code: 'STUDENT_INITIAL_SNAPSHOT_NOT_FOUND',
        message: '当前用户或 Student-M0 快照不存在'
      }
    }

    const draft = draftResult.data[0]
    const subjectResult = await db.collection('subjects').where({
      subject_id: draft.subject_id,
      subject_type: 'student',
      status: 'active'
    }).limit(2).get()
    const bindingResult = await db.collection('guardian_student_bindings').where({
      user_id: user.user_id,
      subject_id: draft.subject_id,
      status: 'active'
    }).limit(2).get()
    const subject = subjectResult.data.length === 1 ? subjectResult.data[0] : null
    const controlled =
      subject &&
      (
        ['researcher', 'admin'].includes(user.role) ||
        (
          user.role === 'teacher' &&
          subject.is_test === true &&
          bindingResult.data.length === 1
        )
      )

    if (!controlled) {
      return {
        success: false,
        code: 'STUDENT_INITIAL_MODEL_ACCESS_FORBIDDEN',
        message: '当前账号无权访问该 Student-M0'
      }
    }

    if (draft.status === 'active') {
      return {
        success: true,
        already_active: true,
        auto_activated: draft.activation_mode === 'automatic_initial',
        snapshot_id: snapshotId,
        subject_id: draft.subject_id,
        model: draft.model_data
      }
    }

    return {
      success: false,
      code: 'INITIAL_MODEL_APPROVAL_REMOVED',
      snapshot_id: snapshotId,
      subject_id: draft.subject_id,
      message: '首次模型人工审核入口已停用；系统将在采集和证据分析完成后自动构建并激活模型'
    }
  } catch (error) {
    console.error('approveStudentInitialModel error:', error)
    return {
      success: false,
      code: 'APPROVE_STUDENT_INITIAL_MODEL_ERROR',
      message: '读取 Student-M0 历史审批兼容接口失败'
    }
  }
}
