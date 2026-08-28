Page({

  data: {
    initialProgressLoaded: false,

    collectionCompleted: false,

    completedCount: 0,

    totalTasks: 13,

    currentTaskOrder: 1,

    currentTaskTitle: '',

    currentTaskId: ''
  },


  // ==================================================
  // 页面显示
  // ==================================================

  onShow() {
    this.loadInitialCollectionProgress()
  },


  // ==================================================
  // 读取教师首次建模采集进度
  // ==================================================

  async loadInitialCollectionProgress() {
    try {
      const res =
        await wx.cloud.callFunction({
          name: 'getNextTeacherCollectionTask',
          data: {}
        })

      const result =
        res && res.result
          ? res.result
          : null

      if (
        !result ||
        result.success !== true
      ) {
        console.error(
          '读取首次建模采集进度失败：',
          result
        )

        this.setData({
          initialProgressLoaded: true
        })

        return
      }


      const progress =
        result.progress || {}

      const completedCount =
        typeof result.completed_count === 'number'
          ? result.completed_count
          : (
              typeof progress.completed_count === 'number'
                ? progress.completed_count
                : 0
            )

      const totalTasks =
        typeof result.total_tasks === 'number'
          ? result.total_tasks
          : (
              typeof progress.total_tasks === 'number'
                ? progress.total_tasks
                : 13
            )


      // ==================================================
      // 全部完成
      // ==================================================

      if (
        result.completed === true ||
        result.collection_completed === true
      ) {
        this.setData({
          initialProgressLoaded: true,

          collectionCompleted: true,

          completedCount:
            totalTasks,

          totalTasks:
            totalTasks,

          currentTaskOrder:
            totalTasks,

          currentTaskTitle:
            '首次建模采集已完成',

          currentTaskId:
            ''
        })

        return
      }


      // ==================================================
      // 当前任务
      // ==================================================

      const task =
        result.task ||
        result.current_task ||
        {}

      const currentTaskId =
        task.task_id ||
        result.current_task_id ||
        progress.current_task_id ||
        ''

      const currentTaskOrder =
        typeof task.order === 'number'
          ? task.order
          : (
              typeof result.current_order === 'number'
                ? result.current_order
                : (
                    typeof progress.current_order === 'number'
                      ? progress.current_order
                      : completedCount + 1
                  )
            )

      const currentTaskTitle =
        task.title ||
        result.current_task_title ||
        '继续首次建模采集'


      this.setData({
        initialProgressLoaded: true,

        collectionCompleted: false,

        completedCount:
          completedCount,

        totalTasks:
          totalTasks,

        currentTaskOrder:
          currentTaskOrder,

        currentTaskTitle:
          currentTaskTitle,

        currentTaskId:
          currentTaskId
      })

    } catch (error) {
      console.error(
        'loadInitialCollectionProgress error:',
        error
      )

      this.setData({
        initialProgressLoaded: true
      })
    }
  },


  // ==================================================
  // T0 基本信息
  // ==================================================

  openBackground() {
    wx.navigateTo({
      url:
        '/pages/teacher-background/teacher-background'
    })
  },


  // ==================================================
  // T1—T5 首次建模采集
  // ==================================================

  async startInitialInterview() {
    if (
      this.data.collectionCompleted
    ) {
      wx.showToast({
        title: '首次采集已完成',
        icon: 'none'
      })

      return
    }


    if (
      !this.data.currentTaskId
    ) {
      await this.loadInitialCollectionProgress()
    }


    const taskId =
      this.data.currentTaskId

    if (!taskId) {
      wx.showToast({
        title: '暂未获取到采集任务',
        icon: 'none'
      })

      return
    }


    wx.navigateTo({
      url:
        '/pages/voice-chat/voice-chat' +
        '?type=initial_interview' +
        '&task_id=' +
        encodeURIComponent(taskId)
    })
  },


  // ==================================================
  // 教学反思
  // ==================================================

  startTeachingReflection() {
    wx.navigateTo({
      url:
        '/pages/voice-chat/voice-chat' +
        '?type=teaching_reflection'
    })
  },


  // ==================================================
  // 学生观察
  // ==================================================

  startStudentObservation() {
    wx.navigateTo({
      url:
        '/pages/voice-chat/voice-chat' +
        '?type=student_observation'
    })
  },


  // ==================================================
  // 自由记录
  // ==================================================

  startFreeRecord() {
    wx.navigateTo({
      url:
        '/pages/voice-chat/voice-chat' +
        '?type=free_dialogue'
    })
  },


  // ==================================================
  // 当前主体模型
  // ==================================================

  openModel() {
    wx.navigateTo({
      url:
        '/pages/teacher-model/teacher-model'
    })
  },


  // ==================================================
  // 学生采集入口
  // 不修改教师账号角色，也不覆盖 Teacher Subject
  // ==================================================

  async openStudentCollection() {
    wx.showLoading({
      title: '正在进入'
    })

    try {
      const res =
        await wx.cloud.callFunction({
          name: 'getMyStudentBindings',
          data: {}
        })

      const result =
        res && res.result
          ? res.result
          : null

      const bindings =
        result &&
        result.success === true &&
        Array.isArray(result.bindings)
          ? result.bindings
          : []

      if (bindings.length > 0) {
        getApp().globalData.currentStudentBinding =
          bindings[0]

        wx.navigateTo({
          url: '/pages/student-home/student-home'
        })

        return
      }

      if (result && result.success === true) {
        wx.navigateTo({
          url: '/pages/student-bind/student-bind'
        })

        return
      }

      wx.showToast({
        title:
          (result && result.message) ||
          '暂时无法进入学生采集',
        icon: 'none'
      })
    } catch (error) {
      console.error(
        'openStudentCollection error:',
        error
      )

      wx.showToast({
        title: '暂时无法进入学生采集',
        icon: 'none'
      })
    } finally {
      wx.hideLoading()
    }
  }

})
