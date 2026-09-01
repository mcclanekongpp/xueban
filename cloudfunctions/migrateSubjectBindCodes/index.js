const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

async function loadAll(collectionName, where = {}) {
  const rows = []
  let skip = 0
  while (true) {
    const result = await db.collection(collectionName).where(where).skip(skip).limit(100).get()
    rows.push(...result.data)
    if (result.data.length < 100) break
    skip += result.data.length
  }
  return rows
}

function isExpired(record) {
  const raw = record.expires_at && record.expires_at.$date
    ? record.expires_at.$date
    : record.expires_at
  if (!raw) return false
  const date = raw instanceof Date ? raw : new Date(raw)
  return !Number.isNaN(date.getTime()) && date.getTime() <= Date.now()
}

function nextUsageState(hasGuardian, teacherCount) {
  if (hasGuardian && teacherCount > 0) return 'guardian_and_teacher'
  if (hasGuardian) return 'guardian_only'
  if (teacherCount > 0) return 'teacher_only'
  return 'unused'
}

exports.main = async (event = {}) => {
  const openid = cloud.getWXContext().OPENID
  const dryRun = event.dry_run !== false
  const testOnly = event.test_only === true

  if (!openid) return { success: false, code: 'NO_OPENID', message: '未获取到微信用户标识' }

  try {
    const userResult = await db.collection('users').where({ openid, status: 'active' }).limit(2).get()
    if (userResult.data.length !== 1) {
      return { success: false, code: 'USER_NOT_ACTIVE', message: '当前用户不存在或不可用' }
    }
    const user = userResult.data[0]
    const canApplyAll = ['researcher', 'admin'].includes(user.role)
    const canApplyTest = user.role === 'teacher' && testOnly
    if (!dryRun && !canApplyAll && !canApplyTest) {
      return { success: false, code: 'MIGRATION_FORBIDDEN', message: '当前账号无权执行绑定码迁移' }
    }

    const [codes, guardianBindings, teacherAccesses] = await Promise.all([
      loadAll('student_bind_codes'),
      loadAll('guardian_student_bindings', { status: 'active' }),
      loadAll('teacher_student_collection_access', { status: 'active' })
    ])
    const changes = []

    for (const code of codes) {
      if (testOnly && code.is_test !== true) continue
      const guardians = guardianBindings.filter((item) => item.subject_id === code.subject_id)
      const teacherIds = new Set(
        teacherAccesses
          .filter((item) => item.student_subject_id === code.subject_id)
          .map((item) => item.teacher_subject_id)
          .filter(Boolean)
      )
      const status = code.status === 'revoked'
        ? 'revoked'
        : isExpired(code)
          ? 'expired'
          : 'active'
      const usageState = nextUsageState(guardians.length > 0, teacherIds.size)
      const update = {
        subject_type: 'student',
        status,
        usage_state: usageState,
        guardian_bound: guardians.length > 0,
        guardian_bound_at: code.guardian_bound_at || (guardians[0] && (guardians[0].bound_at || guardians[0].created_at)) || null,
        teacher_access_count: teacherIds.size,
        updated_at: db.serverDate()
      }
      const changed =
        code.subject_type !== 'student' ||
        code.status !== status ||
        code.usage_state !== usageState ||
        Boolean(code.guardian_bound) !== (guardians.length > 0) ||
        Number(code.teacher_access_count || 0) !== teacherIds.size

      if (!changed) continue
      changes.push({
        database_id: code._id,
        bind_id: code.bind_id || '',
        subject_id: code.subject_id,
        is_test: code.is_test === true,
        before: {
          status: code.status || '',
          usage_state: code.usage_state || '',
          guardian_bound: code.guardian_bound === true,
          teacher_access_count: Number(code.teacher_access_count || 0)
        },
        after: {
          status,
          usage_state: usageState,
          guardian_bound: guardians.length > 0,
          teacher_access_count: teacherIds.size
        }
      })
      if (!dryRun) {
        await db.collection('student_bind_codes').doc(code._id).update({ data: update })
      }
    }

    return {
      success: true,
      dry_run: dryRun,
      test_only: testOnly,
      scanned_count: testOnly ? codes.filter((item) => item.is_test === true).length : codes.length,
      change_count: changes.length,
      applied_count: dryRun ? 0 : changes.length,
      historical_hash_fields_preserved: true,
      changes
    }
  } catch (error) {
    console.error('migrateSubjectBindCodes error:', error)
    return { success: false, code: 'MIGRATE_SUBJECT_BIND_CODES_ERROR', message: error.message || '绑定码迁移检查失败' }
  }
}
