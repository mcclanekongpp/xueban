# DATA_MODEL.md

## 说明
本文档记录当前数据库集合、职责和后续计划。

原则：身份与研究主体分离；原始记录与研究证据分离；研究证据与主体模型分离；历史模型版本不覆盖；重要集合仅通过云函数访问；Teacher_ID / Student_ID 均不直接使用 OpenID。

最近一次已上传开发版为 `1.0.5`。本轮新增 Teacher / Student 统一绑定协议及 `teacher_bind_codes` 设计；现有 `student_bind_codes`、`guardian_student_bindings` 和历史 `identity_map` 继续兼容。Teacher / Student Continuous Collection 仍复用 sessions、messages、voice_records、evidence 与 evidence_analysis。全部研究内部集合继续拒绝普通小程序客户端直读；Guardian 仅能通过云函数读取本人 active binding 对应的安全字段，不能读取原始 Evidence、内部 reasoning、任何线下编号/hash 或其他 Student 数据。

## 1. users
平台用户身份。用户不等于研究主体。

## 2. identity_map
当前用于 `users.user_id ↔ Teacher Subject`。历史字段：user_id、subject_id、identity_type、created_at、updated_at。新绑定记录扩展：binding_id、subject_type = teacher、operator_role = teacher、source_bind_id、school_id、class_id、status、is_test、bound_at、revoked_at。

新教师绑定成功后才通过事务写 identity_map 并把 `users.role` 设为 teacher；`ensureTeacherSubject` 仅查询映射，不再创建 Subject。历史教师映射缺少新增冗余字段时继续兼容。identity_map 不保存 teacher_no、teacher_no_hash、学生学号或绑定码。

Student Binding MVP 不把 Guardian user 写成 student identity_map。Student_ID ↔ 正式学号的长期敏感身份映射后续统一设计；当前在线双重校验使用 `student_bind_codes.student_no_hash` 与线下研究主表。

## 3. subjects
研究主体主表。核心：subject_id、subject_type、model_framework、current_version、status、created_at、updated_at。

当前 teacher 与 student 均已使用。预登记主体可另含 research_alias、is_test；教师固定 `subject_type = teacher`、`model_framework = teacher_v1.0`，学生固定 `subject_type = student`、`model_framework = student_v1.0`。Teacher_ID / Student_ID 均不等于 OpenID、user_id、线下编号或 bind code。

## 4. schools
学校主表。当前字段：school_id、school_name、status、is_test、created_at、updated_at。

## 5. classes
班级主表。当前字段：class_id、school_id、class_name、status、is_test、created_at、updated_at。

## 6. class_memberships
班级与研究主体的组织关系。当前字段：membership_id、class_id、subject_id、subject_type、membership_role、status、is_test、created_at、updated_at。

`membership_role` V1.0 支持 teacher / student。一个教师可属于多个班，一个班可有多个教师；不建立 teacher_student_direct_relation。

## 7. teacher_bind_codes
研究团队在线下准备阶段生成的一次性教师绑定凭据。字段：bind_id、bind_code_hash、subject_id、subject_type = teacher、school_id、class_id、teacher_no_hash、status、is_test、created_by_user_id、created_at、updated_at、used_at、used_by_user_id、used_binding_id、expires_at。

status：unused / used / revoked。数据库不保存 bind code 或 teacher_no 明文；teacher_no_hash 按 school_id 范围计算。正确 code + teacher_no 必须同时匹配，并校验 Teacher Subject、teacher_v1.0 与 active teacher class_membership。绑定成功后由事务创建 identity_map、更新当前 user role 并把 code 置为 used。

## 8. student_bind_codes
研究团队在线下准备阶段生成的一次性学生绑定凭据。当前字段：bind_id、bind_code_hash、subject_id、school_id、class_id、student_no_hash、status、is_test、created_by_user_id、created_at、updated_at、used_at、used_by_user_id、used_binding_id、expires_at。

status：unused / used / revoked。数据库不保存 bind code 明文，也不保存 student_no 明文；student_no_hash 按 school_id 范围计算，避免假设简单班级学号全系统唯一。绑定码成功使用后由事务置为 used。

新记录增加 `subject_type = student`，历史记录字段缺失时兼容。

## 9. guardian_student_bindings
认证后的微信采集终端操作者与独立 Student Subject 的关联。当前字段：binding_id、user_id、subject_id、source_bind_id、status、is_test、bound_at、revoked_at、created_at、updated_at。

status：active / revoked。结构允许一个 user 绑定多个孩子；Student MVP 暂时限制一个 Student_ID 同时只有一个 active guardian binding。该集合不会改变 users.role。

## Subject Binding 集合权限
`schools`、`classes`、`class_memberships`、`teacher_bind_codes`、`student_bind_codes`、`guardian_student_bindings` 与 `identity_map` 必须保持 ADMINONLY，只能由管理员或云函数读写。绑定接口只返回 Subject、binding 和安全组织字段，不返回 teacher_no/student_no、任何 hash 或明文 bind code。

## 10. consents
当前集合保留但 Student Binding MVP 不使用。教师、家长和学生知情同意均在线下以纸质方式完成；小程序不保存电子知情同意，也不把绑定码使用视为知情同意。

## 11. subject_background
主体基础背景信息，教师 T0 与学生 S0 共用该集合。

学生 S0 当前字段：background_id、subject_id、subject_type、framework、school_id、class_id、grade、academic_year、research_alias、student_display_code、background_version、version、data_source、collection_method、status、is_test、created_at、updated_at。

学生 S0 由 active Student Subject、class_membership 与 classes 自动形成，`data_source = organization_records`、`collection_method = automatic_derivation`。不保存 OpenID、Guardian user_id、bind code/hash、student_no/hash 或真实姓名。

## 12. collection_tasks
首次建模固定采集任务。当前包含教师 13 项和学生 17 项。

学生任务字段：task_id、subject_type、framework、dimension_id、dimension_name、variable_id、variable_name、task_type、prompt_text、collection_phase、status、task_order、created_at、updated_at。固定 `subject_type = student`、`framework = student_v1.0`、`task_type = voice_prompt`、`collection_phase = initial`，按 S1-1 → S6-3 排序。儿童自然提示保存在数据中，前端不硬编码变量术语。

## 13. collection_progress
首次建模采集进度。教师已完成 13/13；TEST Student 已完成 17/17。

学生关键字段：progress_id、subject_id、subject_type、framework、collection_phase、total_tasks、completed_tasks、completed_count、completed_task_ids[]、current_task_id、current_order、status、started_at、completed_at、created_at、updated_at。status：not_started / in_progress / completed。同一 Student Subject 不重复初始化进度。

## 14. sessions
一次采集会话。当前支持 Teacher / Student `initial_interview`，教师正式入口 `teaching_reflection`、`student_observation`，以及学生 `student_continuous_record`；`free_dialogue` 只作为历史兼容 session_type 保留在底层。学生首次会话字段包括 subject_id、subject_type = student、framework = student_v1.0、collection_phase = initial、session_type = initial_interview、task_id、operator_user_id、status 与时间字段。学生持续会话固定 `collection_phase = continuous`、`session_type = student_continuous_record`。创建任一学生会话前必须验证当前 user 对 Student_ID 的 active guardian binding。

## 15. messages
保存会话文本与 ASR 转写。属于原始记录层，不是 Evidence。

学生消息归属 Student_ID，核心字段包括 message_id、session_id、subject_id、subject_type、framework、speaker = student、content、message_type、sequence、operator_user_id、is_test、created_at、updated_at。模拟技术消息另含 `status`、`test_source = simulated_transcript`。Guardian user 不是消息主体。

## 16. voice_records
保存语音原始记录、云文件、ASR 结果及持续提交状态。

教师持续记录关键字段包括：voice_id、subject_id、session_id、message_id、transcript、continuous_submit_status、continuous_record_id、continuous_submit_evidence_ids、continuous_no_match_reason、continuous_submitted_at。教师正式路由以 voice_id 为幂等单元：同一 voice + variable 使用确定性 Evidence 文档 ID；0 匹配时 Evidence 数组为空，但 Voice / Message 与 no-match reason 继续保留。

学生首次与持续语音核心字段包括 voice_id、subject_id、subject_type = student、framework = student_v1.0、session_id、message_id、file_id、duration_ms、transcript、operator_user_id、asr_status、is_test、created_at、updated_at。学生持续记录完成路由后另含 continuous_submit_status、continuous_record_id、continuous_submit_evidence_ids[]、continuous_no_match_reason、continuous_submitted_at。真实手机录音保存云文件并经腾讯 ASR；模拟技术记录另含 `status`，且必须标记 `is_test = true`、`test_source = simulated_transcript`。

后续建议逐步补：collection_event_id。

## 17. evidence
变量级研究证据。

定义：某条原始记录或某个采集事件，对某一个主体变量形成的一条可追溯研究证据。

当前 Teacher / Student Evidence 共用集合。学生首次 Evidence 字段：evidence_id、subject_id、subject_type = student、framework = student_v1.0、dimension_id / dimension_name、variable_id / variable_name、source_type = initial_interview、source_modality = voice、evidence_type = voice_response、task_id、task_order、collection_phase、session_id、message_id、voice_id、file_id、operator_user_id、raw_text、transcript、duration_ms、analysis_status、model_change_status、status、is_test、created_at、updated_at。

教师持续 Evidence 固定 `subject_type = teacher`、`framework = teacher_v1.0`、`collection_phase = continuous`、`evidence_type = continuous_voice_response`，并保存 continuous_record_id、session_id、message_id、voice_id、raw_text / transcript、routing_basis、analysis_status 与状态时间字段。来源类型只表达采集情境，不直接决定变量；每个可靠匹配变量独立创建一条 Evidence。

学生持续 Evidence 复用同一结构，固定 source_type = student_continuous_record、evidence_type = continuous_voice_response、collection_phase = continuous，并增加 continuous_record_id、routing_status、routing_method、routing_version、routing_relevance_status、routing_basis。每个匹配变量独立一条 Evidence；0 匹配时不创建 Evidence，原始 Voice / Message 仍保留。

学生原始表达保存在 raw_text / transcript，AI 分析不得覆盖。Guardian user 仅为 operator，`subject_id` 始终是 Student_ID。

后续建议补：collection_event_id、source_record_type、source_record_id、media_record_id、behavior_record_id、raw_description。

## 18. evidence_analysis
对单条 Evidence 的正式分析。

当前教师协议为 V1.1，学生首次与持续 Evidence 共用学生分析协议 V1.0。

共用核心字段：analysis_id、evidence_id、subject_id、subject_type、framework、dimension_id / dimension_name、variable_id / variable_name、evidence_source、source_type、evidence_type、task_id、task_order、relevance_status、evidence_sufficiency、extracted_points、reasoning_basis、context、uncertainty、analysis_method、analysis_version、protocol_name、protocol_version、model_provider、model_name、status、is_test、created_at、updated_at。

学生协议固定相关性 relevant / partially_relevant / irrelevant / uncertain，充分性 usable / weak / insufficient。为兼容当前模型偶发输出，学生分析器只把精确的历史式 `sufficient` 归一为标准 `usable`；其他未知枚举仍拒绝保存。

Evidence Analysis 不直接生成主体模型结论。

## 19. model_snapshots
保存不可覆盖的主体模型版本。

当前教师 snapshot：`MS_MT873ZQI_9PEUL`，status = active，framework = teacher_v1.0，type = initial，version = 1.0。

当前 TEST Student snapshot：`MS_MTBMDOF7_0MNQU`，status = active，framework = student_v1.0，model_type / snapshot_type = initial，version / model_version = 1.0，`is_test = true`。

学生首次 snapshot 字段包括 snapshot_id、subject_id、subject_type、framework、model_type、snapshot_type、version、model_version、source_type、background_id、collection_progress_id、model_data、source_evidence_ids[]、source_analysis_ids[]、source_evidence_count、generation_method、generation_protocol、model_provider、model_name、status、is_test、approved_at、approved_by_user_id、created_at、updated_at。`model_data` 固定含 `overview_summary`、S1—S6 与 17 个变量，每变量保存 current_status、current_description、evidence_ids、evidence_count、evidence_summary、contexts、uncertainty、updated_at；不保存总分、排名或固定人格类型。新 Student 初始 draft 使用 `generation_method = ai_evidence_synthesis`、`generation_protocol = student_initial_model_v1.2`；教师新初始 draft 使用 `teacher_initial_model_v1.3`。`overview_summary` 不超过 100 字，必须覆盖各自全部一级维度且不得使用能力、水平、分数、排名或诊断表达；协议均禁止把转写或 extracted_points 直接拼接为主体刻画。

后续模型变化必须创建新 snapshot，不修改旧版本。

Student Continuous Collection V1.0 不写 model_snapshots，不更新 active Student-M0，也不改变 subjects.current_version / current_snapshot_id。

`getSubjectModelGuidance` 不写 model_snapshots，也不创建 supplement_candidates。它只读当前 Evidence、最新 active Evidence Analysis 与 active/draft snapshot，动态返回后续对话提示和 `construction_progress`；提示和进度结果不属于模型事实，实际新语音仍需内容路由、Evidence Analysis 和后续人工复核。

`construction_progress` 为运行时计算结构，不存数据库。核心字段：index_name、index_version、is_quality_score = false、overall_percent、variable_count、collected_variable_count、analyzed_variable_count、supportive_variable_count、dimensions[]、variables[]、summary_text、formula、note。每变量最多 100%：active Evidence 20%、有效 Analysis 20%、至少 1 条 supportive Evidence 30%、至少 2 条 supportive Evidence 15%、至少 2 个中国标准时间自然日 10%、至少 2 个 context 或 source type 5%。一级维度与总体均按固定变量算术平均；未采集变量以 0 计入。该结构不改变 Evidence Analysis、模型状态、置信度或人工审批门槛。

## 20. variable_evidence_profiles
状态：设计和云函数代码已保留；截至 2026-08-27，当前 `model-dev-d9gkoyaolb464c28d` 数据面未实际存在该集合。机制当前暂停，不阻断教师 / 学生首次模型 MVP 时不继续处理。

用途：保存某个主体某个变量的当前证据健康画像。

V1.0 字段：profile_id、subject_id、subject_type、framework、dimension_id、dimension_name、variable_id、variable_name、evidence_count、analyzed_count、relevant_count、partially_relevant_count、irrelevant_count、uncertain_count、usable_count、weak_count、insufficient_count、supportive_evidence_count、supportive_usable_count、supportive_weak_count、source_types[]、source_type_count、source_modalities[]、modality_count、effective_modality_count、first_evidence_at、latest_evidence_at、evidence_dates[]、time_point_count、contexts[]、context_count、support_status、support_status_name、support_summary、evidence_gaps[]、gap_status、contradiction_status、stagnation_status、profile_version、created_at、updated_at。

support_status：insufficient / initial / supported / relatively_stable。

supportive evidence 固定指：relevance_status = relevant / partially_relevant，且 evidence_sufficiency = usable / weak。source_types、source_modalities、evidence_dates、contexts 及其覆盖计数只由 supportive evidence 贡献。unknown 可以保留在 source_modalities 中，但不计入 effective_modality_count，也不能帮助达到 relatively_stable。context 保留正式分析原文并精确去重；context_count 只是 V1.0 辅助覆盖指标，不代表标准化情境类别数量。

Profile 只描述“现在有什么证据”，Evidence Gap 才负责“还缺什么”。

## 21. collection_events（计划）
状态：尚未创建。

用途：作为多模态原始记录共同父级，表示一次真实采集事件。

建议字段：collection_event_id、subject_id、subject_type、framework、session_id、event_type、event_title、task_id、target_dimension、target_variable、modalities[]、context、status、started_at、completed_at、created_at、updated_at。

## 22. supplement_candidates（计划）
状态：尚未创建。

用途：保存证据健康层识别出的定向补充候选。

建议字段：candidate_id、subject_id、subject_type、framework、dimension_id、variable_id、gap_type、trigger_evidence_id、trigger_event_id、supplement_goal、suggested_prompt、priority、status、created_at、updated_at。

status：pending / shown / completed / skipped。

## 23. model_change_candidates（计划）
状态：尚未创建。

用途：保存新证据可能引起的模型变化候选。

建议字段：candidate_id、subject_id、subject_type、framework、dimension_id、variable_id、current_snapshot_id、change_type、old_state、candidate_state、supporting_evidence_ids[]、contradicting_evidence_ids[]、context_changes[]、reasoning_basis、review_status、created_at、updated_at。

change_type：content_update / support_strengthening / context_refinement / contradiction_pending / no_change。

## 24. media_records（后续）
状态：尚未创建。

用途：图片、视频、文件等多模态原始记录。

建议字段：media_record_id、collection_event_id、subject_id、subject_type、modality、file_id、file_name、mime_type、file_size、source_type、processing_status、extracted_text、extracted_description、created_at、updated_at。

## 25. behavior_records（后续）
状态：尚未创建。

用途：学生行为观察等结构化/半结构化过程证据。

建议字段：behavior_record_id、collection_event_id、subject_id、observer_type、behavior_type、behavior_code、behavior_description、sequence、timestamp、created_at。

## 26. 当前主要关系

Teacher / Student Subject Binding：

```text
schools
  ↓
classes
  ↓
class_memberships
  ↓
subjects (Teacher / Student)

users (Guardian operator)
  ↓
guardian_student_bindings
  ↓
Student Subject

users (Teacher operator)
  ↓
identity_map
  ↓
Teacher Subject

teacher_bind_codes
  ├─ bind_code_hash
  ├─ school-scoped teacher_no_hash
  └─ Teacher Subject

student_bind_codes
  ├─ bind_code_hash
  ├─ school-scoped student_no_hash
  └─ Student Subject
```

统一前端协议：`bindSubjectByCode(subject_type, bind_code, subject_no)`；统一安全查询：`getMySubjectBindings(subject_type)`。存储层保留教师 identity_map 与学生 guardian binding 的角色差异，以兼容所有既有采集授权函数。

教师登录身份与主体模型主链：

```text
users
  ↓
identity_map
  ↓
subjects
  ↓
sessions
  ↓
messages / voice_records
  ↓
evidence
  ↓
evidence_analysis
  ↓
variable_evidence_profiles
  ↓
model_change_candidates（计划）
  ↓
model_snapshots
```

学生首次模型主链：

```text
users (Guardian operator)
  ↓ guardian_student_bindings authorization
Student Subject
  ↓
subject_background (S0)
  ↓
collection_tasks / collection_progress
  ↓
sessions
  ↓
voice_records → messages
  ↓
evidence
  ↓
evidence_analysis
  ↓
model_snapshots (draft → Human Review → active Student-M0)
```

未来多模态：

```text
subjects
  ↓
collection_events
  ├─ voice_records
  ├─ messages
  ├─ media_records
  └─ behavior_records
        ↓
      evidence
        ↓
 evidence_analysis
        ↓
variable_evidence_profiles
```
