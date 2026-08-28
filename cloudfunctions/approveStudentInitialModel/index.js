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
      message: !openid ? '未获取到微信用户标识' : '缺少 Student-M0 草稿编号'
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
        code: 'STUDENT_DRAFT_NOT_FOUND',
        message: '当前用户或 Student-M0 草稿不存在'
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
        code: 'APPROVE_STUDENT_MODEL_FORBIDDEN',
        message: '当前账号无权批准该 Student-M0'
      }
    }

    if (draft.status === 'active') {
      return {
        success: true,
        already_approved: true,
        approved: true,
        snapshot_id: snapshotId,
        subject_id: draft.subject_id,
        model: draft.model_data
      }
    }

    if (draft.status !== 'draft') {
      return { success: false, code: 'SNAPSHOT_NOT_DRAFT', message: '快照不是 draft 状态' }
    }

    const activeResult = await db.collection('model_snapshots').where({
      subject_id: draft.subject_id,
      subject_type: 'student',
      framework: 'student_v1.0',
      snapshot_type: 'initial',
      status: 'active'
    }).limit(2).get()

    if (activeResult.data.length > 1) {
      return {
        success: false,
        code: 'DUPLICATE_ACTIVE_STUDENT_INITIAL_MODELS',
        message: '该学生存在多个 active Student-M0，需研究人员处理'
      }
    }

    if (activeResult.data.length === 1) {
      return {
        success: false,
        code: 'ACTIVE_STUDENT_INITIAL_MODEL_EXISTS',
        snapshot_id: activeResult.data[0].snapshot_id,
        message: '该学生已经存在 active Student-M0'
      }
    }

    const now = db.serverDate()
    await db.runTransaction(async (transaction) => {
      await transaction.collection('model_snapshots').doc(draft._id).update({
        data: {
          status: 'active',
          approved_at: now,
          approved_by_user_id: user.user_id,
          updated_at: now
        }
      })
      await transaction.collection('subjects').doc(subject._id).update({
        data: {
          current_version: draft.model_version || '1.0',
          current_snapshot_id: draft.snapshot_id,
          updated_at: now
        }
      })
    })

    return {
      success: true,
      already_approved: false,
      approved: true,
      snapshot_id: snapshotId,
      subject_id: draft.subject_id,
      approved_by_user_id: user.user_id,
      model: draft.model_data
    }
  } catch (error) {
    console.error('approveStudentInitialModel error:', error)
    return {
      success: false,
      code: 'APPROVE_STUDENT_INITIAL_MODEL_ERROR',
      message: '批准 Student-M0 失败'
    }
  }
}
