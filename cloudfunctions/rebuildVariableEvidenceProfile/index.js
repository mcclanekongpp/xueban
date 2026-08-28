const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

const EVIDENCE_COLLECTION = 'evidence'
const ANALYSIS_COLLECTION = 'evidence_analysis'
const PROFILE_COLLECTION = 'variable_evidence_profiles'

const PROFILE_VERSION = '1.0'

const SUPPORTIVE_RELEVANCE_STATUSES = new Set([
  'relevant',
  'partially_relevant'
])

const SUPPORTIVE_SUFFICIENCY_STATUSES = new Set([
  'usable',
  'weak'
])

// ============================================================
// 固定主体模型框架
// ============================================================

const FRAMEWORKS = {
  'teacher_v1.0': {
    subject_type: 'teacher',
    dimensions: {
      T1: {
        name: '课程与学习目标取向',
        variables: {
          'T1-1': '课程与学习价值理解',
          'T1-2': '学习结果判断'
        }
      },

      T2: {
        name: '学生理解与诊断',
        variables: {
          'T2-1': '学生已有认识理解',
          'T2-2': '学习困难诊断',
          'T2-3': '个体差异理解'
        }
      },

      T3: {
        name: '教学策略与PCK',
        variables: {
          'T3-1': '内容表征与任务设计',
          'T3-2': '提问与学习支架',
          'T3-3': '教学策略资源'
        }
      },

      T4: {
        name: '互动与关系方式',
        variables: {
          'T4-1': '提问与反馈方式',
          'T4-2': '学生自主与教师介入',
          'T4-3': '互动组织与差异关注'
        }
      },

      T5: {
        name: '专业自我、适应与反思',
        variables: {
          'T5-1': '专业自我与教学信念',
          'T5-2': '适应性调整与反思'
        }
      }
    }
  },

  'student_v1.0': {
    subject_type: 'student',
    dimensions: {
      S1: {
        name: '认知与已有经验',
        variables: {
          'S1-1': '观察与信息提取',
          'S1-2': '已有经验与认知解释',
          'S1-3': '前概念与认知关联'
        }
      },

      S2: {
        name: '思维与问题解决',
        variables: {
          'S2-1': '比较与分类',
          'S2-2': '预测与解释',
          'S2-3': '证据与问题解决'
        }
      },

      S3: {
        name: '学习与自我调节',
        variables: {
          'S3-1': '任务专注与注意调节',
          'S3-2': '困难应对与策略调整',
          'S3-3': '自我监控与不确定性感知'
        }
      },

      S4: {
        name: '表达与社会互动',
        variables: {
          'S4-1': '表达与提问',
          'S4-2': '倾听与回应',
          'S4-3': '合作与观点调节'
        }
      },

      S5: {
        name: '动机、情绪与自我效能',
        variables: {
          'S5-1': '好奇与学习投入意愿',
          'S5-2': '学习自信与挫折反应'
        }
      },

      S6: {
        name: '兴趣、活动经验与生活情境',
        variables: {
          'S6-1': '兴趣领域',
          'S6-2': '活动与生活经验',
          'S6-3': '家庭学习支持情境'
        }
      }
    }
  }
}

// ============================================================
// 工具函数
// ============================================================

function makeId(prefix) {
  const time = Date.now().toString(36).toUpperCase()

  const random = Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()

  return `${prefix}_${time}_${random}`
}

function unique(values) {
  return [...new Set(values.filter(v => v !== null && v !== undefined && v !== ''))]
}

function normalizeString(value) {
  if (value === null || value === undefined) {
    return ''
  }

  return String(value).trim()
}

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value
  }

  if (value === null || value === undefined || value === '') {
    return []
  }

  return [value]
}

function hasOwn(record, field) {
  return !!record &&
    Object.prototype.hasOwnProperty.call(
      record,
      field
    )
}

function getExistingProfileField(
  existingProfile,
  field,
  fallback
) {
  if (hasOwn(existingProfile, field)) {
    return existingProfile[field]
  }

  return fallback
}

// ============================================================
// Evidence Analysis 字段兼容
//
// 当前 analyzeTeacherEvidence V1.1 将正式分析字段直接写在
// evidence_analysis 顶层。历史模型构建代码曾兼容 doc.analysis
// 嵌套结构，因此这里保持同样的只读兼容：
// 1. 当前顶层标准字段优先；
// 2. 只有顶层字段不存在时，才回退读取历史 analysis 对象；
// 3. 不兼容其他未经现有代码证实的字段别名。
// ============================================================

function getAnalysisContentField(record, field) {
  if (hasOwn(record, field)) {
    return record[field]
  }

  const nested =
    record &&
    record.analysis &&
    typeof record.analysis === 'object' &&
    !Array.isArray(record.analysis)
      ? record.analysis
      : null

  if (hasOwn(nested, field)) {
    return nested[field]
  }

  return undefined
}

function normalizeAnalysisRecord(record) {
  if (!record) {
    return null
  }

  return {
    ...record,

    relevance_status:
      getAnalysisContentField(
        record,
        'relevance_status'
      ),

    evidence_sufficiency:
      getAnalysisContentField(
        record,
        'evidence_sufficiency'
      ),

    extracted_points:
      getAnalysisContentField(
        record,
        'extracted_points'
      ),

    reasoning_basis:
      getAnalysisContentField(
        record,
        'reasoning_basis'
      ),

    context:
      getAnalysisContentField(
        record,
        'context'
      ),

    uncertainty:
      getAnalysisContentField(
        record,
        'uncertainty'
      ),

    protocol_version:
      getAnalysisContentField(
        record,
        'protocol_version'
      ),

    analysis_version:
      getAnalysisContentField(
        record,
        'analysis_version'
      )
  }
}

function getAnalysisIdentityValues(record, field) {
  if (!record) {
    return []
  }

  const nested =
    record.analysis &&
    typeof record.analysis === 'object' &&
    !Array.isArray(record.analysis)
      ? record.analysis
      : null

  return unique([
    hasOwn(record, field)
      ? normalizeString(record[field])
      : '',

    hasOwn(nested, field)
      ? normalizeString(nested[field])
      : ''
  ])
}

function isAnalysisConsistentWithEvidence(
  analysis,
  evidence,
  framework
) {
  const checks = [
    {
      field: 'subject_id',
      expected: normalizeString(
        evidence.subject_id
      )
    },
    {
      field: 'framework',
      expected:
        normalizeString(
          evidence.framework
        ) || framework
    },
    {
      field: 'variable_id',
      expected: normalizeString(
        evidence.variable_id
      )
    }
  ]

  return checks.every(check => {
    const values =
      getAnalysisIdentityValues(
        analysis,
        check.field
      )

    // 历史记录缺少冗余身份字段时继续兼容。
    if (!values.length) {
      return true
    }

    return values.every(
      value => value === check.expected
    )
  })
}

// ============================================================
// 判断历史数据是否仍属于有效记录
//
// 兼容现有数据库中可能尚未设置 status 的旧记录。
// ============================================================

function isActiveRecord(record) {
  if (!record) {
    return false
  }

  const status = normalizeString(record.status).toLowerCase()

  if (!status) {
    return true
  }

  const invalidStatuses = [
    'deleted',
    'invalid',
    'archived',
    'disabled',
    'cancelled',
    'canceled'
  ]

  return !invalidStatuses.includes(status)
}

// ============================================================
// 时间处理
//
// 研究项目当前统一按中国标准时间自然日计算 time point。
// 同一天产生多条证据，只算一个时间点。
// ============================================================

function toDateObject(value) {
  if (!value) {
    return null
  }

  try {
    if (value instanceof Date) {
      return value
    }

    if (
      typeof value === 'object' &&
      value !== null &&
      value.$date
    ) {
      return new Date(value.$date)
    }

    const date = new Date(value)

    if (Number.isNaN(date.getTime())) {
      return null
    }

    return date
  } catch (err) {
    return null
  }
}

function toChinaDateString(value) {
  const date = toDateObject(value)

  if (!date) {
    return ''
  }

  const chinaTime = new Date(
    date.getTime() + 8 * 60 * 60 * 1000
  )

  return chinaTime
    .toISOString()
    .slice(0, 10)
}

function getRecordTime(record) {
  if (!record) {
    return null
  }

  return (
    record.created_at ||
    record.createdAt ||
    record.updated_at ||
    record.updatedAt ||
    null
  )
}

// ============================================================
// 模态推断
//
// 新证据以后直接使用 source_modality。
// 现有教师历史数据没有该字段时，根据关联ID兼容推断。
// ============================================================

function inferModality(evidence) {
  const direct = normalizeString(
    evidence.source_modality
  ).toLowerCase()

  if (direct) {
    return direct
  }

  if (evidence.voice_id) {
    return 'voice'
  }

  if (evidence.media_record_id) {
    return 'media'
  }

  if (evidence.behavior_record_id) {
    return 'behavior'
  }

  if (evidence.message_id) {
    return 'text'
  }

  return 'unknown'
}

function isSupportiveAnalysis(
  relevanceStatus,
  evidenceSufficiency
) {
  return (
    SUPPORTIVE_RELEVANCE_STATUSES.has(
      relevanceStatus
    ) &&
    SUPPORTIVE_SUFFICIENCY_STATUSES.has(
      evidenceSufficiency
    )
  )
}

// ============================================================
// 情境提取
//
// V1.0暂时不进行AI情境聚类，只保留真实分析结果。
// 对完全相同的文本进行去重。
// context_count 当前只是 V1.0 辅助指标，不能被解释为已经
// 完成标准化的情境类别数量。
// ============================================================

function extractContexts(analysis) {
  if (!analysis) {
    return []
  }

  const raw = analysis.context

  if (Array.isArray(raw)) {
    return unique(
      raw
        .map(item => normalizeString(item))
        .filter(Boolean)
    )
  }

  const text = normalizeString(raw)

  return text ? [text] : []
}

// ============================================================
// 框架与变量解析
// ============================================================

function resolveFramework(variableId, frameworkInput) {
  const requested = normalizeString(frameworkInput)

  if (requested) {
    if (!FRAMEWORKS[requested]) {
      throw new Error(`不支持的 framework：${requested}`)
    }

    return requested
  }

  if (variableId.startsWith('T')) {
    return 'teacher_v1.0'
  }

  if (variableId.startsWith('S')) {
    return 'student_v1.0'
  }

  throw new Error(
    `无法根据 variable_id 判断主体框架：${variableId}`
  )
}

function resolveVariable(framework, variableId) {
  const frameworkConfig = FRAMEWORKS[framework]

  if (!frameworkConfig) {
    throw new Error(`未找到框架：${framework}`)
  }

  for (const [dimensionId, dimension] of Object.entries(
    frameworkConfig.dimensions
  )) {
    if (
      Object.prototype.hasOwnProperty.call(
        dimension.variables,
        variableId
      )
    ) {
      return {
        subject_type: frameworkConfig.subject_type,
        dimension_id: dimensionId,
        dimension_name: dimension.name,
        variable_id: variableId,
        variable_name: dimension.variables[variableId]
      }
    }
  }

  throw new Error(
    `变量 ${variableId} 不属于框架 ${framework}`
  )
}

// ============================================================
// 分页读取
// ============================================================

async function fetchAll(collectionName, whereCondition) {
  const collection = db.collection(collectionName)

  const PAGE_SIZE = 100

  let skip = 0
  let all = []

  while (true) {
    const result = await collection
      .where(whereCondition)
      .skip(skip)
      .limit(PAGE_SIZE)
      .get()

    const rows = result.data || []

    all = all.concat(rows)

    if (rows.length < PAGE_SIZE) {
      break
    }

    skip += PAGE_SIZE
  }

  return all
}

// ============================================================
// 查找某条 Evidence 的正式分析
//
// 当前协议原则上一条 Evidence 对应一个正式 analysis。
// 为兼容未来重新分析，若存在多条，则取最新有效记录。
// ============================================================

async function getLatestAnalysis(
  evidence,
  framework
) {
  const evidenceId =
    normalizeString(
      evidence && evidence.evidence_id
    )

  if (!evidenceId) {
    return null
  }

  const rows = await fetchAll(
    ANALYSIS_COLLECTION,
    {
      evidence_id: evidenceId
    }
  )

  const activeRows = rows
    .filter(isActiveRecord)
    .filter(analysis =>
      isAnalysisConsistentWithEvidence(
        analysis,
        evidence,
        framework
      )
    )

  if (!activeRows.length) {
    return null
  }

  activeRows.sort((a, b) => {
    const aTime = toDateObject(getRecordTime(a))
    const bTime = toDateObject(getRecordTime(b))

    const av = aTime ? aTime.getTime() : 0
    const bv = bTime ? bTime.getTime() : 0

    return bv - av
  })

  return normalizeAnalysisRecord(
    activeRows[0]
  )
}

// ============================================================
// support_status
//
// V1.0规则：
// 证据不足：没有 supportive evidence
//
// 初步描述：
// 有 supportive weak 或 supportive usable，
// 但不足以进入 supported
//
// 已有一定支持：
// supportive usable >= 2
// 且时间 / 来源 / 情境至少一项 >= 2
//
// 较稳定：
// supportive usable >= 4
// + 至少3个时间点
// + 至少2类情境
// + 至少2类来源或至少2类模态
// + 无待解释矛盾
// ============================================================

function calculateSupportStatus({
  supportiveUsableCount,
  supportiveWeakCount,
  sourceTypeCount,
  effectiveModalityCount,
  timePointCount,
  contextCount,
  contradictionStatus
}) {
  const supportiveCount =
    supportiveUsableCount +
    supportiveWeakCount

  if (supportiveCount === 0) {
    return {
      support_status: 'insufficient',
      support_status_name: '证据不足'
    }
  }

  const relativelyStable =
    supportiveUsableCount >= 4 &&
    timePointCount >= 3 &&
    contextCount >= 2 &&
    (
      sourceTypeCount >= 2 ||
      effectiveModalityCount >= 2
    ) &&
    contradictionStatus !== 'pending'

  if (relativelyStable) {
    return {
      support_status: 'relatively_stable',
      support_status_name: '较稳定'
    }
  }

  const supported =
    supportiveUsableCount >= 2 &&
    (
      timePointCount >= 2 ||
      sourceTypeCount >= 2 ||
      contextCount >= 2
    )

  if (supported) {
    return {
      support_status: 'supported',
      support_status_name: '已有一定支持'
    }
  }

  return {
    support_status: 'initial',
    support_status_name: '初步描述'
  }
}

// ============================================================
// 生成纯证据台账摘要
//
// 不生成教师或学生能力结论。
// ============================================================

function buildSupportSummary({
  evidenceCount,
  analyzedCount,
  usableCount,
  weakCount,
  insufficientCount,
  supportiveEvidenceCount,
  supportiveUsableCount,
  supportiveWeakCount,
  sourceTypeCount,
  modalityCount,
  effectiveModalityCount,
  timePointCount,
  contextCount
}) {
  const parts = []

  parts.push(
    `当前共有${evidenceCount}条变量证据`
  )

  parts.push(
    `其中${analyzedCount}条已完成正式分析`
  )

  if (analyzedCount > 0) {
    parts.push(
      `${usableCount}条usable、${weakCount}条weak、${insufficientCount}条insufficient`
    )
  }

  if (supportiveEvidenceCount > 0) {
    parts.push(
      `${supportiveEvidenceCount}条构成supportive evidence（${supportiveUsableCount}条usable、${supportiveWeakCount}条weak）`
    )
  }

  if (sourceTypeCount > 0) {
    parts.push(
      `覆盖${sourceTypeCount}类证据来源`
    )
  }

  if (modalityCount > 0) {
    parts.push(
      `记录${modalityCount}个模态值，其中${effectiveModalityCount}类可用于多模态覆盖判断`
    )
  }

  if (timePointCount > 0) {
    parts.push(
      `覆盖${timePointCount}个时间点`
    )
  }

  if (contextCount > 0) {
    parts.push(
      `记录${contextCount}条精确去重的原始情境描述（V1.0辅助指标，非标准化情境类别）`
    )
  }

  return parts.join('；') + '。'
}

// ============================================================
// 主函数
// ============================================================

exports.main = async (event, context) => {
  try {
    const subjectId = normalizeString(
      event && event.subject_id
    )

    const variableId = normalizeString(
      event && event.variable_id
    )

    const frameworkInput = normalizeString(
      event && event.framework
    )

    const dryRun =
      !!(
        event &&
        event.dry_run === true
      )

    if (!subjectId) {
      return {
        success: false,
        error: 'subject_id_required',
        message: '缺少 subject_id'
      }
    }

    if (!variableId) {
      return {
        success: false,
        error: 'variable_id_required',
        message: '缺少 variable_id'
      }
    }

    // --------------------------------------------------------
    // 1. 确定框架与变量
    // --------------------------------------------------------

    const framework = resolveFramework(
      variableId,
      frameworkInput
    )

    const variableMeta = resolveVariable(
      framework,
      variableId
    )

    // --------------------------------------------------------
    // 2. 查询当前变量全部 Evidence
    //
    // 不依赖 status 字段存在，之后在内存中过滤历史无效记录。
    // --------------------------------------------------------

    const evidenceRowsRaw = await fetchAll(
      EVIDENCE_COLLECTION,
      {
        subject_id: subjectId,
        variable_id: variableId
      }
    )

    const evidenceRows = evidenceRowsRaw.filter(
      evidence => {
        if (!isActiveRecord(evidence)) {
          return false
        }

        // 如果历史 Evidence 有 framework，则必须匹配。
        // 没有 framework 的旧数据继续兼容。
        if (
          evidence.framework &&
          evidence.framework !== framework
        ) {
          return false
        }

        return true
      }
    )

    // --------------------------------------------------------
    // 3. 查询每条 Evidence 的最新正式 analysis
    //
    // 当前变量通常只有少量证据，因此 V1.0 采用最稳妥的
    // evidence_id 逐条关联方式，不假设 evidence_analysis
    // 一定存在 subject_id / variable_id 等冗余字段。
    // --------------------------------------------------------

    const records = []

    for (const evidence of evidenceRows) {
      const analysis = await getLatestAnalysis(
        evidence,
        framework
      )

      records.push({
        evidence,
        analysis
      })
    }

    // --------------------------------------------------------
    // 4. 基础计数
    // --------------------------------------------------------

    const evidenceCount = evidenceRows.length

    let analyzedCount = 0

    let relevantCount = 0
    let partiallyRelevantCount = 0
    let irrelevantCount = 0
    let uncertainCount = 0

    let usableCount = 0
    let weakCount = 0
    let insufficientCount = 0

    let supportiveEvidenceCount = 0
    let supportiveUsableCount = 0
    let supportiveWeakCount = 0

    const supportiveRecords = []

    // --------------------------------------------------------
    // 5. 正式 analysis 统计
    // --------------------------------------------------------

    for (const item of records) {
      const analysis = item.analysis

      if (!analysis) {
        continue
      }

      analyzedCount += 1

      const relevanceStatus =
        normalizeString(
          analysis.relevance_status
        )

      const evidenceSufficiency =
        normalizeString(
          analysis.evidence_sufficiency
        )

      switch (relevanceStatus) {
        case 'relevant':
          relevantCount += 1
          break

        case 'partially_relevant':
          partiallyRelevantCount += 1
          break

        case 'irrelevant':
          irrelevantCount += 1
          break

        case 'uncertain':
          uncertainCount += 1
          break

        default:
          break
      }

      switch (evidenceSufficiency) {
        case 'usable':
          usableCount += 1
          break

        case 'weak':
          weakCount += 1
          break

        case 'insufficient':
          insufficientCount += 1
          break

        default:
          break
      }

      if (
        isSupportiveAnalysis(
          relevanceStatus,
          evidenceSufficiency
        )
      ) {
        supportiveEvidenceCount += 1

        if (
          evidenceSufficiency ===
          'usable'
        ) {
          supportiveUsableCount += 1
        }

        if (
          evidenceSufficiency ===
          'weak'
        ) {
          supportiveWeakCount += 1
        }

        supportiveRecords.push(item)
      }
    }

    // --------------------------------------------------------
    // 6. Profile 覆盖信息
    //
    // 来源 / 模态 / 时间 / 情境只使用 supportive evidence，
    // 避免 irrelevant 证据虚增模型支持多样性。
    // --------------------------------------------------------

    const sourceTypes = unique(
      supportiveRecords.map(item =>
        normalizeString(
          item.evidence.source_type
        )
      )
    )

    const sourceModalities = unique(
      supportiveRecords.map(item =>
        inferModality(item.evidence)
      )
    )

    const evidenceDates = unique(
      supportiveRecords.map(item =>
        toChinaDateString(
          getRecordTime(item.evidence) ||
          getRecordTime(item.analysis)
        )
      )
    ).sort()

    const contexts = unique(
      supportiveRecords.flatMap(item =>
        extractContexts(item.analysis)
      )
    )

    const sourceTypeCount =
      sourceTypes.length

    const modalityCount =
      sourceModalities.length

    // unknown 继续保留在 source_modalities 中，便于暴露历史数据缺口；
    // effective_modality_count 明确排除 unknown，并且只有该有效计数
    // 可以帮助达到“较稳定”的多模态条件。
    const effectiveModalityCount =
      sourceModalities.filter(
        modality => modality !== 'unknown'
      ).length

    const timePointCount =
      evidenceDates.length

    const contextCount =
      contexts.length

    // --------------------------------------------------------
    // 7. 首次 / 最近 supportive evidence 时间
    // --------------------------------------------------------

    const supportiveTimes = supportiveRecords
      .map(item => {
        const time =
          getRecordTime(item.evidence) ||
          getRecordTime(item.analysis)

        return toDateObject(time)
      })
      .filter(Boolean)
      .sort((a, b) =>
        a.getTime() - b.getTime()
      )

    const firstEvidenceAt =
      supportiveTimes.length
        ? supportiveTimes[0]
        : null

    const latestEvidenceAt =
      supportiveTimes.length
        ? supportiveTimes[
            supportiveTimes.length - 1
          ]
        : null

    // --------------------------------------------------------
    // 8. 读取已有 Profile
    //
    // rebuild 不能覆盖未来 Evidence Gap / Stagnation
    // 等层已经形成的研究状态。
    // --------------------------------------------------------

    const existingProfiles =
      await fetchAll(
        PROFILE_COLLECTION,
        {
          subject_id: subjectId,
          framework,
          variable_id: variableId
        }
      )

    if (existingProfiles.length > 1) {
      return {
        success: false,
        error:
          'duplicate_variable_evidence_profiles',
        message:
          '同一主体、框架和变量存在多条 Evidence Profile，已停止重建',
        dry_run:
          dryRun,
        subject_id:
          subjectId,
        framework,
        variable_id:
          variableId,
        duplicate_count:
          existingProfiles.length
      }
    }

    const existingProfile =
      existingProfiles.length
        ? existingProfiles[0]
        : null

    // 按字段是否存在判断，不使用 truthy 判断，确保已有值原样保留。
    const evidenceGaps =
      getExistingProfileField(
        existingProfile,
        'evidence_gaps',
        []
      )

    const gapStatus =
      getExistingProfileField(
        existingProfile,
        'gap_status',
        'not_evaluated'
      )

    const contradictionStatus =
      getExistingProfileField(
        existingProfile,
        'contradiction_status',
        'none'
      )

    const stagnationStatus =
      getExistingProfileField(
        existingProfile,
        'stagnation_status',
        'not_evaluated'
      )

    // --------------------------------------------------------
    // 9. support_status
    //
    // 注意：
    // support_status 只由同时满足相关性与充分性条件的
    // supportive evidence 推动。总体 usable / weak 仅用于
    // 记录分析分布，不能直接提升 Profile 支持状态。
    // --------------------------------------------------------

    const statusResult =
      calculateSupportStatus({
        supportiveUsableCount,
        supportiveWeakCount,
        sourceTypeCount,
        effectiveModalityCount,
        timePointCount,
        contextCount,
        contradictionStatus
      })

    // --------------------------------------------------------
    // 10. support_summary
    // --------------------------------------------------------

    const supportSummary =
      buildSupportSummary({
        evidenceCount,
        analyzedCount,
        usableCount,
        weakCount,
        insufficientCount,
        supportiveEvidenceCount,
        supportiveUsableCount,
        supportiveWeakCount,
        sourceTypeCount,
        modalityCount,
        effectiveModalityCount,
        timePointCount,
        contextCount
      })

    // --------------------------------------------------------
    // 11. Profile 内容
    // --------------------------------------------------------

    const profileCore = {
      subject_id: subjectId,
      subject_type:
        variableMeta.subject_type,

      framework,

      dimension_id:
        variableMeta.dimension_id,

      dimension_name:
        variableMeta.dimension_name,

      variable_id:
        variableMeta.variable_id,

      variable_name:
        variableMeta.variable_name,

      evidence_count:
        evidenceCount,

      analyzed_count:
        analyzedCount,

      relevant_count:
        relevantCount,

      partially_relevant_count:
        partiallyRelevantCount,

      irrelevant_count:
        irrelevantCount,

      uncertain_count:
        uncertainCount,

      usable_count:
        usableCount,

      weak_count:
        weakCount,

      insufficient_count:
        insufficientCount,

      supportive_evidence_count:
        supportiveEvidenceCount,

      supportive_usable_count:
        supportiveUsableCount,

      supportive_weak_count:
        supportiveWeakCount,

      source_types:
        sourceTypes,

      source_type_count:
        sourceTypeCount,

      source_modalities:
        sourceModalities,

      modality_count:
        modalityCount,

      effective_modality_count:
        effectiveModalityCount,

      first_evidence_at:
        firstEvidenceAt,

      latest_evidence_at:
        latestEvidenceAt,

      evidence_dates:
        evidenceDates,

      time_point_count:
        timePointCount,

      contexts,
      context_count:
        contextCount,

      support_status:
        statusResult.support_status,

      support_status_name:
        statusResult.support_status_name,

      support_summary:
        supportSummary,

      // 下一阶段 Evidence Gap 使用
      evidence_gaps:
        evidenceGaps,

      gap_status:
        gapStatus,

      contradiction_status:
        contradictionStatus,

      stagnation_status:
        stagnationStatus,

      profile_version:
        PROFILE_VERSION
    }

    const existingProfileId =
      existingProfile &&
      existingProfile.profile_id
        ? existingProfile.profile_id
        : ''

    const wouldCreate =
      !existingProfile

    // --------------------------------------------------------
    // 12. dry_run
    //
    // 完成全部 Evidence / Evidence Analysis 查询和 Profile
    // 计算，但不生成 ID，也不新增或更新数据库记录。
    // --------------------------------------------------------

    if (dryRun) {
      return {
        success: true,
        dry_run: true,
        would_create:
          wouldCreate,
        existing_profile_id:
          existingProfileId,
        created: false,
        profile_id:
          existingProfileId,
        document_id:
          existingProfile
            ? existingProfile._id
            : '',
        ...profileCore
      }
    }

    const now = db.serverDate()

    const profileData = {
      ...profileCore,
      updated_at:
        now
    }

    let profileId = ''
    let documentId = ''
    let created = false

    // --------------------------------------------------------
    // 13. Upsert
    // --------------------------------------------------------

    if (existingProfile) {
      profileId =
        existingProfile.profile_id ||
        makeId('VEP')

      documentId =
        existingProfile._id

      await db
        .collection(PROFILE_COLLECTION)
        .doc(existingProfile._id)
        .update({
          data: {
            ...profileData,

            profile_id:
              profileId
          }
        })
    } else {
      created = true

      profileId = makeId('VEP')

      const addResult = await db
        .collection(PROFILE_COLLECTION)
        .add({
          data: {
            ...profileData,

            profile_id:
              profileId,

            created_at:
              now
          }
        })

      documentId =
        addResult._id
    }

    // --------------------------------------------------------
    // 14. 返回最新 Profile
    // --------------------------------------------------------

    return {
      success: true,

      dry_run: false,

      would_create:
        wouldCreate,

      existing_profile_id:
        existingProfileId,

      created,

      profile_id:
        profileId,

      document_id:
        documentId,

      ...profileCore
    }
  } catch (err) {
    console.error(
      '[rebuildVariableEvidenceProfile] failed:',
      err
    )

    return {
      success: false,

      error:
        'rebuild_variable_evidence_profile_failed',

      message:
        err && err.message
          ? err.message
          : String(err)
    }
  }
}
