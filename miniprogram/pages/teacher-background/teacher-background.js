Page({
  data: {
    // ==================================================
    // 页面状态
    // ==================================================

    isLoading: true,
    isSaving: false,
    hasBackground: false,

    backgroundId: '',

    // ==================================================
    // T0 基本背景
    // ==================================================

    teachingYears: '',

    educationOptions: [
      '高中及以下',
      '专科',
      '本科',
      '硕士研究生',
      '博士研究生',
      '其他'
    ],

    educationIndex: -1,
    highestEducation: '',

    majorBackground: '',
    currentSubject: '',
    currentGrade: '',

    // ==================================================
    // 教学经历
    // ==================================================

    gradesTaughtText: '',
    subjectsTaughtText: '',

    lowerGradeExperience: false,

    otherDescription: '',

    // ==================================================
    // 培训经历
    // ==================================================

    trainingExperienceText: ''
  },


  // ==================================================
  // 页面加载
  // ==================================================

  onLoad() {
    this.loadBackground()
  },


  // ==================================================
  // 读取已有 T0
  // ==================================================

  async loadBackground() {
    this.setData({
      isLoading: true
    })

    try {
      const res =
        await wx.cloud.callFunction({
          name: 'getTeacherBackground',
          data: {}
        })

      console.log(
        'getTeacherBackground 返回：',
        res.result
      )

      if (
        !res.result ||
        res.result.success !== true
      ) {
        throw new Error(
          res.result &&
          res.result.message
            ? res.result.message
            : '基本信息读取失败'
        )
      }

      // ==================================================
      // 尚未填写
      // ==================================================

      if (
        res.result.has_background !== true ||
        !res.result.background
      ) {
        this.setData({
          isLoading: false,
          hasBackground: false
        })

        return
      }

      // ==================================================
      // 已有数据 → 回填
      // ==================================================

      const background =
        res.result.background

      const teachingExperience =
        background.teaching_experience || {}

      const gradesTaught =
        Array.isArray(
          teachingExperience.grades_taught
        )
          ? teachingExperience.grades_taught
          : []

      const subjectsTaught =
        Array.isArray(
          teachingExperience.subjects_taught
        )
          ? teachingExperience.subjects_taught
          : []

      const trainingExperience =
        Array.isArray(
          background.training_experience
        )
          ? background.training_experience
          : []

      const educationIndex =
        this.data.educationOptions.indexOf(
          background.highest_education || ''
        )

      this.setData({
        isLoading: false,

        hasBackground: true,

        backgroundId:
          background.background_id || '',

        teachingYears:
          background.teaching_years !== undefined
            ? String(background.teaching_years)
            : '',

        highestEducation:
          background.highest_education || '',

        educationIndex:
          educationIndex >= 0
            ? educationIndex
            : -1,

        majorBackground:
          background.major_background || '',

        currentSubject:
          background.current_subject || '',

        currentGrade:
          background.current_grade || '',

        gradesTaughtText:
          gradesTaught.join('、'),

        subjectsTaughtText:
          subjectsTaught.join('、'),

        lowerGradeExperience:
          teachingExperience
            .lower_grade_experience === true,

        otherDescription:
          teachingExperience
            .other_description || '',

        trainingExperienceText:
          trainingExperience.join('\n')
      })

    } catch (error) {
      console.error(
        '读取教师基本信息失败：',
        error
      )

      this.setData({
        isLoading: false
      })

      wx.showToast({
        title:
          error.message ||
          '读取失败',
        icon: 'none'
      })
    }
  },


  // ==================================================
  // 通用输入
  // ==================================================

  onTeachingYearsInput(e) {
    this.setData({
      teachingYears:
        e.detail.value
    })
  },

  onMajorBackgroundInput(e) {
    this.setData({
      majorBackground:
        e.detail.value
    })
  },

  onCurrentSubjectInput(e) {
    this.setData({
      currentSubject:
        e.detail.value
    })
  },

  onCurrentGradeInput(e) {
    this.setData({
      currentGrade:
        e.detail.value
    })
  },

  onGradesTaughtInput(e) {
    this.setData({
      gradesTaughtText:
        e.detail.value
    })
  },

  onSubjectsTaughtInput(e) {
    this.setData({
      subjectsTaughtText:
        e.detail.value
    })
  },

  onOtherDescriptionInput(e) {
    this.setData({
      otherDescription:
        e.detail.value
    })
  },

  onTrainingExperienceInput(e) {
    this.setData({
      trainingExperienceText:
        e.detail.value
    })
  },


  // ==================================================
  // 学历选择
  // ==================================================

  onEducationChange(e) {
    const index =
      Number(e.detail.value)

    this.setData({
      educationIndex: index,

      highestEducation:
        this.data.educationOptions[index] || ''
    })
  },


  // ==================================================
  // 低年级教学经历
  // ==================================================

  onLowerGradeChange(e) {
    this.setData({
      lowerGradeExperience:
        e.detail.value === true
    })
  },


  // ==================================================
  // 将逗号 / 顿号等分隔内容转换为数组
  // ==================================================

  parseListText(text) {
    if (
      typeof text !== 'string' ||
      !text.trim()
    ) {
      return []
    }

    return text
      .split(/[、，,；;\n]+/)
      .map(item => item.trim())
      .filter(Boolean)
  },


  // ==================================================
  // 培训经历
  // ==================================================

  parseTrainingText(text) {
    if (
      typeof text !== 'string' ||
      !text.trim()
    ) {
      return []
    }

    return text
      .split(/[\n；;]+/)
      .map(item => item.trim())
      .filter(Boolean)
  },


  // ==================================================
  // 前端基础校验
  // ==================================================

  validateForm() {
    const teachingYears =
      Number(this.data.teachingYears)

    if (
      this.data.teachingYears === '' ||
      !Number.isFinite(teachingYears) ||
      teachingYears < 0 ||
      teachingYears > 60
    ) {
      wx.showToast({
        title: '请输入0—60之间的教龄',
        icon: 'none'
      })

      return false
    }

    if (!this.data.highestEducation) {
      wx.showToast({
        title: '请选择最高学历',
        icon: 'none'
      })

      return false
    }

    if (!this.data.majorBackground.trim()) {
      wx.showToast({
        title: '请填写专业背景',
        icon: 'none'
      })

      return false
    }

    if (!this.data.currentSubject.trim()) {
      wx.showToast({
        title: '请填写当前任教学科',
        icon: 'none'
      })

      return false
    }

    if (!this.data.currentGrade.trim()) {
      wx.showToast({
        title: '请填写当前任教年级',
        icon: 'none'
      })

      return false
    }

    return true
  },


  // ==================================================
  // 保存 T0
  // ==================================================

  async saveBackground() {
    if (this.data.isSaving) {
      return
    }

    if (!this.validateForm()) {
      return
    }

    const teachingYears =
      Number(this.data.teachingYears)

    const gradesTaught =
      this.parseListText(
        this.data.gradesTaughtText
      )

    const subjectsTaught =
      this.parseListText(
        this.data.subjectsTaughtText
      )

    const trainingExperience =
      this.parseTrainingText(
        this.data.trainingExperienceText
      )

    const payload = {
      teaching_years:
        teachingYears,

      highest_education:
        this.data.highestEducation,

      major_background:
        this.data.majorBackground.trim(),

      current_subject:
        this.data.currentSubject.trim(),

      current_grade:
        this.data.currentGrade.trim(),

      teaching_experience: {
        grades_taught:
          gradesTaught,

        subjects_taught:
          subjectsTaught,

        lower_grade_experience:
          this.data.lowerGradeExperience,

        other_description:
          this.data.otherDescription.trim()
      },

      training_experience:
        trainingExperience
    }

    this.setData({
      isSaving: true
    })

    try {
      const res =
        await wx.cloud.callFunction({
          name: 'saveTeacherBackground',
          data: payload
        })

      console.log(
        'saveTeacherBackground 返回：',
        res.result
      )

      if (
        !res.result ||
        res.result.success !== true
      ) {
        throw new Error(
          res.result &&
          res.result.message
            ? res.result.message
            : '保存失败'
        )
      }

      this.setData({
        isSaving: false,

        hasBackground: true,

        backgroundId:
          res.result.background_id ||
          this.data.backgroundId
      })

      wx.showToast({
        title: '保存成功',
        icon: 'success'
      })

    } catch (error) {
      console.error(
        '保存教师基本信息失败：',
        error
      )

      this.setData({
        isSaving: false
      })

      wx.showToast({
        title:
          error.message ||
          '保存失败',
        icon: 'none'
      })
    }
  }
})