// app.js

App({
  globalData: {
    env: "model-dev-d9gkoyaolb464c28d",

    // 当前微信登录用户
    currentUser: null,

    // 当前教师/学生主体
    currentSubject: null,

    // 当前采集终端已选择的学生主体，不覆盖教师主体
    currentStudentBinding: null
  },

  onLaunch: function () {
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
      return;
    }

    wx.cloud.init({
      env: this.globalData.env,
      traceUser: true
    });

    this.login();
  },

  // 微信账号登录
  login: async function () {
    try {
      const res = await wx.cloud.callFunction({
        name: "login",
        data: {}
      });

      console.log("login 云函数返回：", res.result);

      if (!res.result || !res.result.success) {
        console.error("登录失败：", res.result);
        return;
      }

      this.globalData.currentUser = res.result.user;

      if (res.result.is_new_user) {
        console.log("首次进入，已创建用户记录");
      } else {
        console.log("已有用户，登录成功");
      }

      const role = res.result.user.role;

      // 尚未设置身份
      if (role === "unassigned") {
        const enteredStudentHome = await this.openBoundStudentHome()

        if (enteredStudentHome) {
          wx.reLaunch({
            url: "/pages/student-home/student-home"
          });
          return;
        }

        wx.reLaunch({
          url: "/pages/role-select/role-select"
        });
        return;
      }

      // 教师身份
      if (role === "teacher") {
        await this.ensureTeacherSubject();

        wx.reLaunch({
          url: "/pages/teacher-home/teacher-home"
        });
        return;
      }

      // 监护人微信是学生采集终端操作者，不是 Student Subject
      if (role === "guardian") {
        const enteredStudentHome = await this.openBoundStudentHome()

        wx.reLaunch({
          url: enteredStudentHome
            ? "/pages/student-home/student-home"
            : "/pages/student-bind/student-bind"
        });
      }

    } catch (err) {
      console.error("调用 login 云函数失败：", err);
    }
  },

  // 已有学生绑定时准备 Student Home 所需的安全状态。
  // 不修改 users.role，也不覆盖当前教师 Subject。
  openBoundStudentHome: async function () {
    try {
      const res = await wx.cloud.callFunction({
        name: "getMyStudentBindings",
        data: {}
      });

      const result = res && res.result ? res.result : null;
      const bindings =
        result && result.success && Array.isArray(result.bindings)
          ? result.bindings
          : [];

      if (bindings.length === 0) {
        return false;
      }

      this.globalData.currentStudentBinding = bindings[0];
      return true;
    } catch (error) {
      console.error("读取学生绑定失败：", error);
      return false;
    }
  },

  // 确保当前教师拥有 Teacher Subject
  ensureTeacherSubject: async function () {
    try {
      const res = await wx.cloud.callFunction({
        name: "ensureTeacherSubject",
        data: {}
      });

      console.log(
        "ensureTeacherSubject 云函数返回：",
        res.result
      );

      if (res.result && res.result.success) {
        this.globalData.currentSubject = res.result.subject;

        if (res.result.is_new_subject) {
          console.log(
            "已创建新的教师主体：",
            res.result.subject.subject_id
          );
        } else {
          console.log(
            "已有教师主体：",
            res.result.subject.subject_id
          );
        }

        return res.result.subject;
      }

      console.error(
        "教师主体获取失败：",
        res.result
      );

      return null;

    } catch (err) {
      console.error(
        "调用 ensureTeacherSubject 云函数失败：",
        err
      );

      return null;
    }
  }
});
