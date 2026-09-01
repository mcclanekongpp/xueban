// Historical endpoint retained only so old clients fail safely. New Student
// binding uses bindSubjectByCode(subject_type = student, bind_code) and never
// accepts or validates student_no / student_no_hash.
exports.main = async () => ({
  success: false,
  code: 'LEGACY_STUDENT_BINDING_ENDPOINT_DISABLED',
  message: '请更新小程序后使用学生绑定码完成绑定'
})
