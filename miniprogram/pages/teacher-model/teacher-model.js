const {
  drawModelProgressRadar
} = require('../../utils/model-progress-radar')

function normalizeTextList(value) {
  const values = Array.isArray(value) ? value : [value]
  const emptyValues = ['none', 'null', 'undefined', '无', '暂无', '目前无', '无不确定性']

  return Array.from(new Set(
    values
      .map(item => String(item || '').trim())
      .filter(item => item && !emptyValues.includes(item.toLowerCase()))
  ))
}

function formatDate(value) {
  const rawValue = value && value.$date ? value.$date : value
  const date = rawValue instanceof Date ? rawValue : new Date(rawValue)

  if (!rawValue || Number.isNaN(date.getTime())) return ''

  const pad = number => String(number).padStart(2, '0')
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`
}

function limitSummary(value, fallback) {
  const text = String(value || fallback || '').trim()
  return text.length <= 100 ? text : `${text.slice(0, 99)}…`
}

Page({

  data: {
    isLoading: true,

    hasModel: false,

    errorMessage: '',

    snapshotId: '',

    modelVersion: '',

    snapshotType: '',

    modelStatus: 'active',

    modelStatusName: '已复核',

    modelUpdatedAt: '',

    background: null,

    dimensions: [],

    modelCautions: [],

    overviewSummary: '',

    constructionProgressLoading: false,

    constructionProgressPercent: 0,

    constructionProgressDimensions: [],

    constructionProgressNote: ''
  },


  // ==================================================
  // 页面加载
  // ==================================================

  onLoad() {
    this.loadCurrentModel()
  },


  // ==================================================
  // 读取当前正式教师主体模型
  // ==================================================

  async loadCurrentModel() {
    try {
      this.setData({
        isLoading: true,
        errorMessage: ''
      })


      const res =
        await wx.cloud.callFunction({
          name:
            'getTeacherCurrentModel',

          data: {}
        })


      const result =
        res && res.result
          ? res.result
          : null


      console.log(
        '教师主体模型页面读取结果：',
        result
      )


      // ==================================================
      // 云函数返回异常
      // ==================================================

      if (
        !result ||
        result.success !== true
      ) {
        this.setData({
          isLoading: false,

          hasModel: false,

          errorMessage:
            result &&
            result.message
              ? result.message
              : '读取教师主体模型失败'
        })

        return
      }


      // ==================================================
      // 尚未形成正式模型
      // ==================================================

      if (
        result.has_model !== true ||
        !result.model
      ) {
        this.setData({
          isLoading: false,

          hasModel: false,

          snapshotId: '',

          modelVersion: '',

          snapshotType: '',

          background: null,

          dimensions: [],

          modelCautions: [],

          errorMessage:
            result.message ||
            '当前尚未形成正式教师主体模型'
        })

        return
      }


      const model =
        result.model


      // ==================================================
      // 整理维度和变量
      //
      // 不修改主体模型原始内容，
      // 只增加页面展示用字段。
      // ==================================================

      const dimensions =
        Array.isArray(
          model.dimensions
        )
          ? model.dimensions.map(
              dimension => ({
                dimension_id:
                  dimension.dimension_id ||
                  '',

                dimension_name:
                  dimension.dimension_name ||
                  '',

                variables:
                  Array.isArray(
                    dimension.variables
                  )
                    ? dimension.variables.map(
                        variable => ({
                          ...variable,

                          confidence_text:
                            this.getConfidenceText(
                              variable.confidence
                            ),

                          uncertainty:
                            normalizeTextList(
                              variable.uncertainty
                            ),

                          evidence_count:
                            Array.isArray(
                              variable.evidence_basis
                            )
                              ? variable
                                  .evidence_basis
                                  .length
                              : 0
                        })
                      )
                    : []
              })
            )
          : []


      // ==================================================
      // 页面数据
      // ==================================================

      this.setData({
        isLoading: false,

        hasModel: true,

        errorMessage: '',

        snapshotId:
          result.snapshot_id ||
          '',

        modelVersion:
          result.model_version ||
          model.model_version ||
          '',

        snapshotType:
          result.snapshot_type ||
          '',

        modelStatus:
          'active',

        modelStatusName:
          '已复核',

        modelUpdatedAt:
          formatDate(
            result.updated_at ||
            result.created_at
          ),

        background:
          model.background ||
          null,

        dimensions:
          dimensions,

        modelCautions:
          Array.isArray(
            model.model_cautions
          )
            ? model.model_cautions
            : []
      })

      await this.loadConstructionProgress(model)

    } catch (error) {
      console.error(
        'loadCurrentModel error:',
        error
      )


      this.setData({
        isLoading: false,

        hasModel: false,

        errorMessage:
          error.message ||
          '读取教师主体模型失败'
      })
    }
  },


  // ==================================================
  // 模型构建进度
  // 只描述证据覆盖与持续积累，不改变置信度或采纳门槛。
  // ==================================================

  async loadConstructionProgress(model) {
    const fallbackSummary =
      '目标取向、学生理解、教学策略、互动关系与专业反思均已纳入当前模型，具体覆盖程度见下方构建进展。'

    this.setData({
      constructionProgressLoading: true,
      overviewSummary: limitSummary(model && model.overview_summary, fallbackSummary)
    })

    try {
      const res = await wx.cloud.callFunction({
        name: 'getSubjectModelGuidance',
        data: {
          subject_type: 'teacher',
          limit: 1
        }
      })
      const result = res && res.result ? res.result : null
      const progress = result && result.success === true
        ? result.construction_progress
        : null

      if (!progress || !Array.isArray(progress.dimensions)) {
        throw new Error('教师模型构建进度返回无效')
      }

      const overviewSummary = model && model.overview_summary
        ? model.overview_summary
        : progress.summary_text

      this.setData({
        constructionProgressLoading: false,
        overviewSummary: limitSummary(overviewSummary, fallbackSummary),
        constructionProgressPercent: Number(progress.overall_percent || 0),
        constructionProgressDimensions: progress.dimensions,
        constructionProgressNote: progress.note || ''
      })

      drawModelProgressRadar(
        this,
        '#teacherProgressRadar',
        progress.dimensions
      )
    } catch (error) {
      console.error('读取教师模型构建进度失败：', error)
      this.setData({
        constructionProgressLoading: false,
        constructionProgressPercent: 0,
        constructionProgressDimensions: [],
        constructionProgressNote: '构建进度暂未读取，不影响当前模型内容。'
      })
    }
  },


  // ==================================================
  // 置信度展示文字
  //
  // 这里只做界面文字映射，
  // 不改变数据库里的 confidence 原值。
  // ==================================================

  getConfidenceText(
    confidence
  ) {
    const map = {
      insufficient:
        '证据不足',

      low:
        '初步描述',

      medium:
        '已有一定支持',

      high:
        '较稳定'
    }

    return (
      map[confidence] ||
      '待判断'
    )
  },


  // ==================================================
  // 手动刷新
  // ==================================================

  refreshModel() {
    this.loadCurrentModel()
  }

})
