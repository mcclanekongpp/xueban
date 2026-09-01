# DATA_MODEL.md

## 说明
本文档记录当前数据库集合、职责和后续计划。

原则：身份与研究主体分离；原始记录与研究证据分离；研究证据与主体模型分离；历史模型版本不覆盖；重要集合仅通过云函数访问；Teacher_ID / Student_ID 均不直接使用 OpenID。

规则驱动自动 revision V1.0 已部署到 `model-dev-d9gkoyaolb464c28d`，并用 TEST Student 完成云端自动激活与重复 refresh 幂等验证。Teacher / Student 首次模型自动分析、构建和 `automatic_initial` 激活也已部署，并由隔离 TEST Teacher / Student 验证固定 13 / 17 变量、Subject 指针和幂等性。独立《声纹授权协议》、近 60 秒语音恢复、联合 Student 采集和 Progress 并发保护已进入候选版 `1.0.11`。`teacher_bind_codes`、`teacher_student_collection_access`、`voice_consents`、`variable_evidence_profiles`、`model_change_candidates` 均已创建并设置为 ADMINONLY。Teacher / Student Continuous Collection 继续复用 sessions、messages、voice_records、evidence 与 evidence_analysis。全部研究内部集合继续拒绝普通小程序客户端直读；Guardian / Teacher Collector 仅能通过云函数访问已授权 Student 的安全字段，不能读取原始 Evidence、内部 reasoning、任何身份 hash 或其他 Student 数据。

## 1. users
平台用户身份。用户不等于研究主体。

## 2. identity_map
当前用于 `users.user_id ↔ Teacher Subject`。历史字段：user_id、subject_id、identity_type、created_at、updated_at。新绑定记录扩展：binding_id、subject_type = teacher、operator_role = teacher、source_bind_id、school_id、class_id、status、is_test、bound_at、revoked_at。

新教师绑定成功后才通过事务写 identity_map 并把 `users.role` 设为 teacher；`ensureTeacherSubject` 仅查询映射，不再创建 Subject。历史教师映射缺少新增冗余字段时继续兼容。identity_map 不保存 teacher_no、teacher_no_hash、学生学号或绑定码。

Student Binding 不把 Guardian user 写成 student identity_map。新绑定流程不再采集或校验学号；历史 Student_ID ↔ 学号资料继续留在线下研究主表，历史 hash 字段不参与线上业务。

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
研究团队在线下准备阶段为每个 Teacher Subject 生成的唯一本人绑定凭据。新记录字段：bind_id、bind_code_hash、subject_id、subject_type = teacher、school_id、class_id、status、is_test、created_by_user_id、created_at、updated_at、used_at、used_by_user_id、used_binding_id、expires_at。

status：unused / used / revoked / expired。数据库只保存高熵随机 code 的 SHA-256，不保存明文；新流程只校验 bind code，并校验 Teacher Subject、teacher_v1.0 与 active teacher class_membership。绑定成功后由事务创建 identity_map、更新当前 user role 并把 code 置为 used。历史 `teacher_no_hash` 字段兼容保留，但新记录不生成、新逻辑不读取。

## 8. student_bind_codes
研究团队在线下准备阶段为每个 Student Subject 生成的唯一共享采集凭据。新记录字段：bind_id、bind_code_hash、subject_id、subject_type = student、school_id、class_id、status、usage_state、guardian_bound、guardian_bound_at、teacher_access_count、first_teacher_access_at、last_teacher_access_at、last_used_at、is_test、created_by_user_id、created_at、updated_at、expires_at。

`status`：active / revoked / expired，表示 code 是否整体可用于建立新授权。`usage_state`：unused / guardian_only / teacher_only / guardian_and_teacher，表示已有哪些 operator 类型使用。Guardian 首次使用设置 `guardian_bound`；每个新 Teacher access 只增加一次 `teacher_access_count`。code 不因某一角色首次使用而整体失效。

历史 `status = unused / used` 通过迁移映射为新的 status + usage_state；历史 `student_no_hash`、used_at、used_by_user_id、used_binding_id 暂时兼容保留，但新注册和新绑定不生成、不读取、不验证 student_no/hash。

## 9. guardian_student_bindings
认证后的微信采集终端操作者与独立 Student Subject 的关联。当前字段：binding_id、user_id、subject_id、source_bind_id、status、is_test、bound_at、revoked_at、created_at、updated_at。

status：active / revoked。结构允许一个 user 绑定多个孩子；Student MVP 暂时限制一个 Student_ID 同时只有一个 active guardian binding。该集合不会改变 users.role。

## 9A. teacher_student_collection_access
Teacher 作为 Student 采集操作者的授权关系。字段：access_id、user_id、teacher_subject_id、student_subject_id、school_id、class_id、source_bind_id、access_role = teacher_collector、status、is_test、created_at、updated_at、last_used_at、revoked_at。

status：active / revoked。同一 `teacher_subject_id + student_subject_id` 只能有一条 active access；重复输入同一 Student Code 幂等返回。创建和每次使用都必须复核 Teacher identity、Teacher / Student active Subject 以及双方至少一个 active shared Class。Teacher 自己的首次采集进度、Evidence、Model 和 current snapshot 不参与授权判断。集合为 ADMINONLY。

## Subject Binding 集合权限
`schools`、`classes`、`class_memberships`、`teacher_bind_codes`、`student_bind_codes`、`guardian_student_bindings`、`teacher_student_collection_access` 与 `identity_map` 必须保持 ADMINONLY，只能由管理员或云函数读写。绑定接口只返回 Subject、binding/access 和安全组织字段，不返回历史编号、任何 hash、Guardian 信息或明文 bind code。

## 10. consents
当前集合保留但 Student Binding MVP 不使用。教师、家长和学生知情同意均在线下以纸质方式完成；小程序不保存电子知情同意，也不把绑定码使用视为知情同意。

## 10A. voice_consents
独立保存小程序内语音及可能包含的声纹敏感个人信息授权，不替代线下纸质研究知情同意。集合为 ADMINONLY，普通客户端不能直接读写。

V1.0 字段：consent_id、user_id、subject_id、subject_type、consent_version = 1.0、status = active、consented_at、created_at、updated_at。

唯一授权语义为 `user_id + subject_id + consent_version`。教师自己的录音只能由其 active Teacher identity 保存授权；Student 录音由 `authorizeStudentOperator` 先确认当前 user 是 active Guardian 或合法同班 Teacher Collector，再按当前 operator user + 单个 Student_ID 保存。不同 Student、不同 operator 不能共用授权。前端只传 subject_id，user_id 始终由云函数根据 OPENID 解析。未授权、点击不同意、查询失败或主体关系无效时均不得调用麦克风。

## 11. subject_background
主体基础背景信息，教师 T0 与学生 S0 共用该集合。

学生 S0 当前字段：background_id、subject_id、subject_type、framework、school_id、class_id、grade、academic_year、research_alias、student_display_code、background_version、version、data_source、collection_method、status、is_test、created_at、updated_at。

学生 S0 由 active Student Subject、class_membership 与 classes 自动形成，`data_source = organization_records`、`collection_method = automatic_derivation`。不保存 OpenID、Guardian user_id、bind code/hash、student_no/hash 或真实姓名。

## 12. collection_tasks
首次建模固定采集任务。当前包含教师 13 项和学生 17 项。

学生任务字段：task_id、subject_type、framework、dimension_id、dimension_name、variable_id、variable_name、task_type、prompt_text、collection_phase、status、task_order、created_at、updated_at。固定 `subject_type = student`、`framework = student_v1.0`、`task_type = voice_prompt`、`collection_phase = initial`，按 S1-1 → S6-3 排序。儿童自然提示保存在数据中，前端不硬编码变量术语。

## 13. collection_progress
首次建模采集进度。教师已完成 13/13；TEST Student 已完成 17/17。

学生关键字段：progress_id、subject_id、subject_type、framework、collection_phase、total_tasks、completed_tasks、completed_count、completed_task_ids[]、current_task_id、current_order、status、started_at、completed_at、created_at、updated_at，以及 last_operator_user_id、last_operator_type、last_operator_teacher_subject_id。status：not_started / in_progress / completed。同一 Student Subject 只有一份 initial progress；新 Progress 使用 `subject_id + student_v1.0 + initial` 派生的确定性文档 ID，避免 Guardian / Teacher 首次同时进入时创建重复记录。完成任务在事务内对 completed_task_ids 去重，并仅对明确的 CloudBase TransactionConflict 做有限退避重试；同一任务重复提交幂等，completed_count 不得超过 17。

## 14. sessions
一次采集会话。当前支持 Teacher / Student `initial_interview`，教师正式入口 `teaching_reflection`、`student_observation`，以及学生 `student_continuous_record`；`free_dialogue` 只作为历史兼容 session_type 保留在底层。学生首次会话字段包括 subject_id、subject_type = student、framework = student_v1.0、collection_phase = initial、session_type = initial_interview、task_id、operator_user_id、operator_type、operator_teacher_subject_id、status 与时间字段。学生持续会话固定 `collection_phase = continuous`、`session_type = student_continuous_record`。创建任一学生会话前必须通过 `authorizeStudentOperator`；首次 Session 按 Student + task 共用，后续合法 operator 恢复同一题时不复制进度。

## 15. messages
保存会话文本与 ASR 转写。属于原始记录层，不是 Evidence。

学生消息归属 Student_ID，核心字段包括 message_id、session_id、subject_id、subject_type、framework、speaker = student、content、message_type、sequence、operator_user_id、operator_type、operator_teacher_subject_id、is_test、created_at、updated_at。模拟技术消息另含 `status`、`test_source = simulated_transcript`。Guardian / Teacher operator 都不是消息主体。

## 16. voice_records
保存语音原始记录、云文件、ASR 结果及持续提交状态。

教师持续记录关键字段包括：voice_id、subject_id、session_id、message_id、transcript、continuous_submit_status、continuous_record_id、continuous_submit_evidence_ids、continuous_no_match_reason、continuous_submitted_at。教师正式路由以 voice_id 为幂等单元：同一 voice + variable 使用确定性 Evidence 文档 ID；0 匹配时 Evidence 数组为空，但 Voice / Message 与 no-match reason 继续保留。

学生首次与持续语音核心字段包括 voice_id、subject_id、subject_type = student、framework = student_v1.0、session_id、message_id、file_id、duration_ms、transcript、operator_user_id、operator_type、operator_teacher_subject_id、asr_status、is_test、created_at、updated_at。学生持续记录完成路由后另含 continuous_submit_status、continuous_record_id、continuous_submit_evidence_ids[]、continuous_no_match_reason、continuous_submitted_at。真实手机录音保存云文件并经腾讯 ASR；模拟技术记录另含 `status`，且必须标记 `is_test = true`、`test_source = simulated_transcript`。

新转写成功记录另含 `asr_mode`、`asr_source_type`、`asr_temp_url_ms`、`asr_request_ms`、`asr_total_ms`。正常短录音使用 `asr_mode = sentence`、`asr_source_type = cloud_storage_url`，腾讯 ASR 直接读取短时有效签名 URL；URL 本身不保存到数据库、不写日志、不返回前端。

微信端报告接近 60 秒但 MP3 编码后媒体时长超过 60 秒时，原始 `file_id`、`duration_ms` 和云文件保持不变；仅识别用内存副本按完整 MP3 帧去掉尾部编码填充。成功记录使用 `asr_mode = sentence_trimmed_copy`、`asr_source_type = inline_trimmed_copy`，并保存 `asr_trimmed_bytes` 与 `asr_trimmed_duration_ms`。这两个字段描述识别副本，不代表原始研究音频被修改。历史成功记录缺少以上字段时继续兼容。

后续建议逐步补：collection_event_id。

## 17. evidence
变量级研究证据。

定义：某条原始记录或某个采集事件，对某一个主体变量形成的一条可追溯研究证据。

当前 Teacher / Student Evidence 共用集合。学生首次 Evidence 字段：evidence_id、subject_id、subject_type = student、framework = student_v1.0、dimension_id / dimension_name、variable_id / variable_name、source_type = initial_interview、source_modality = voice、evidence_type = voice_response、task_id、task_order、collection_phase、session_id、message_id、voice_id、file_id、operator_user_id、operator_type、operator_teacher_subject_id、raw_text、transcript、duration_ms、analysis_status、model_change_status、status、is_test、created_at、updated_at。

教师持续 Evidence 固定 `subject_type = teacher`、`framework = teacher_v1.0`、`collection_phase = continuous`、`evidence_type = continuous_voice_response`，并保存 continuous_record_id、session_id、message_id、voice_id、raw_text / transcript、routing_basis、analysis_status 与状态时间字段。来源类型只表达采集情境，不直接决定变量；每个可靠匹配变量独立创建一条 Evidence。

学生持续 Evidence 复用同一结构，固定 source_type = student_continuous_record、evidence_type = continuous_voice_response、collection_phase = continuous，并增加 continuous_record_id、routing_status、routing_method、routing_version、routing_relevance_status、routing_basis。每个匹配变量独立一条 Evidence；0 匹配时不创建 Evidence，原始 Voice / Message 仍保留。

学生原始表达保存在 raw_text / transcript，AI 分析不得覆盖。Guardian / Teacher user 仅为 operator，`subject_id` 始终是 Student_ID。

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

当前 TEST Student active snapshot：`MS_AUTO_964A2C6C7C1C4C278E187881`，status = active，framework = student_v1.0，model_type / snapshot_type = revision，version / model_version = 1.1，`activation_mode = automatic_rule`。其父快照 `MS_MTBMDOF7_0MNQU` 仍保留，status = superseded，version = 1.0，`is_test = true`。

首次 snapshot 字段包括 snapshot_id、subject_id、subject_type、framework、model_type、snapshot_type、version、model_version、source_type、background_id、collection_progress_id、model_data、source_evidence_ids[]、source_analysis_ids[]、source_evidence_count、generation_method、generation_protocol、model_provider、model_name、status、is_test、activation_mode、activation_rule_version、activated_at、auto_activated_at、auto_activated_by、triggered_by_user_id、created_at、updated_at。`model_data` 固定含 `overview_summary`、Teacher T1—T5 / Student S1—S6 和对应的全部 13 / 17 个变量，每变量保存当前状态、描述、Evidence 引用、情境和不确定性；不保存总分、排名或固定人格类型。新 Student 初始模型使用 `generation_method = ai_evidence_synthesis`、`generation_protocol = student_initial_model_v1.2`；教师新初始模型使用 `teacher_initial_model_v1.3`。新规则先以确定性文档 ID 写入 `status = activating`，再通过事务置为 `active`并更新 `subjects.current_version / current_snapshot_id`；固定 `activation_mode = automatic_initial`、`activation_rule_version = subject_initial_auto_activation_v1.0`。`overview_summary` 不超过 100 字，必须覆盖各自全部一级维度且不得使用能力、水平、分数、排名或诊断表达；协议均禁止把转写或 extracted_points 直接拼接为主体刻画。历史 snapshot 可继续保留 `draft`、approved_at 和 approved_by_user_id，仅用于存量兼容，新流程不再产生人工审批写入。

后续模型变化必须创建新 snapshot，不修改旧版本。

持续采集页面不直接写 model_snapshots，也不原地更新 active Student-M0 / Teacher-T0。页面只调用 `advanceSubjectModel(refresh)`；已部署的 V1.0 达到自动门槛后由云函数内部创建并激活 revision snapshot。revision snapshot 继续复用 model_snapshots，新增/使用字段：snapshot_type = revision、model_type = revision、parent_snapshot_id、model_change_candidate_ids[]、source_evidence_ids[]、source_analysis_ids[]、version / model_version、generation_protocol = subject_model_auto_revision_v1.0、activation_mode = automatic_rule、auto_update_rule_version = subject_model_auto_update_v1.0、auto_update_key、triggered_by_user_id、activated_at、auto_activated_at、auto_activated_by、status = active。自动激活事务把旧 active 置为 superseded，并更新 Subject 当前版本指针；旧 snapshot 内容不覆盖。历史受控 draft 仍可保留 `generation_protocol = subject_model_revision_v1.0`、approved_at 与 approved_by_user_id。

`getSubjectModelGuidance` 不写 model_snapshots，也不创建 supplement_candidates。它只读当前 Evidence、最新 active Evidence Analysis 与当前 snapshot，动态返回后续对话提示和 `construction_progress`；提示和进度结果不属于模型事实。`action = research_overview` 只允许 researcher / admin，返回 Teacher / Student 的安全构建总览：Subject 安全标识、班级/学校 ID、首次采集进度、active 模型版本、构建百分比、缺口变量数与优先补充提示；不返回原始录音/转写、Evidence 原文、Analysis reasoning、绑定码/线下编号哈希。实际新语音仍必须经内容路由和 Evidence Analysis；只有满足统一自动门槛时才创建并激活新 revision。

`construction_progress` 为运行时计算结构，不存数据库。核心字段：index_name、index_version、is_quality_score = false、overall_percent、variable_count、collected_variable_count、analyzed_variable_count、supportive_variable_count、dimensions[]、variables[]、summary_text、formula、note。每变量最多 100%：active Evidence 20%、有效 Analysis 20%、至少 1 条 supportive Evidence 30%、至少 2 条 supportive Evidence 15%、至少 2 个中国标准时间自然日 10%、至少 2 个 context 或 source type 5%。一级维度与总体均按固定变量算术平均；未采集变量以 0 计入。该结构不改变 Evidence Analysis、模型状态、置信度、首次模型构建或持续模型自动更新门槛；证据不足/缺失只会降低对应变量进度并进入后续提示，不会被伪造成 supportive。

## 20. variable_evidence_profiles
状态：已在 `model-dev-d9gkoyaolb464c28d` 创建并设为 ADMINONLY，已由 `advanceSubjectModel` 对真实教师 13 个变量和 TEST Student 17 个变量完成首次全量重建。唯一业务键为 `subject_id + framework + variable_id`；代码遇到重复 Profile 时停止，不随机更新。

用途：保存某个主体某个变量的当前证据健康画像。

当前 V1.1 字段：profile_id、subject_id、subject_type、framework、dimension_id、dimension_name、variable_id、variable_name、evidence_count、analyzed_count、relevant_count、partially_relevant_count、irrelevant_count、uncertain_count、usable_count、weak_count、insufficient_count、supportive_evidence_count、supportive_usable_count、supportive_weak_count、source_types[]、source_type_count、source_modalities[]、modality_count、effective_modality_count、first_evidence_at、latest_evidence_at、evidence_dates[]、time_point_count、contexts[]、context_count、support_status、support_status_name、support_summary、evidence_gaps[]、gap_status、contradiction_status、contradiction_resolution、stagnation_status、stagnation_reasons[]、profile_version = 1.1、created_at、updated_at。

support_status：insufficient / initial / supported / relatively_stable。

supportive evidence 固定指：relevance_status = relevant / partially_relevant，且 evidence_sufficiency = usable / weak。source_types、source_modalities、evidence_dates、contexts 及其覆盖计数只由 supportive evidence 贡献。unknown 可以保留在 source_modalities 中，但不计入 effective_modality_count，也不能帮助达到 relatively_stable。context 保留正式分析原文并精确去重；context_count 只是 V1.0 辅助覆盖指标，不代表标准化情境类别数量。

Profile 的统计层描述“现在有什么证据”，内嵌 `evidence_gaps` 记录当前还缺什么。Gap V1.0 类型：no_evidence、insufficient_detail、single_time_point、single_context、single_source、stale_evidence、contradiction_pending。当前不单独创建 evidence_gaps 集合。

## 21. collection_events（计划）
状态：尚未创建。

用途：作为多模态原始记录共同父级，表示一次真实采集事件。

建议字段：collection_event_id、subject_id、subject_type、framework、session_id、event_type、event_title、task_id、target_dimension、target_variable、modalities[]、context、status、started_at、completed_at、created_at、updated_at。

## 22. supplement_candidates（计划）
状态：尚未创建。

用途：保存证据健康层识别出的定向补充候选。

建议字段：candidate_id、subject_id、subject_type、framework、dimension_id、variable_id、gap_type、trigger_evidence_id、trigger_event_id、supplement_goal、suggested_prompt、priority、status、created_at、updated_at。

status：pending / shown / completed / skipped。

## 23. model_change_candidates
状态：已在 `model-dev-d9gkoyaolb464c28d` 创建并设为 ADMINONLY，由 `advanceSubjectModel` 幂等维护。

用途：保存新证据可能引起的模型变化候选。

当前字段：candidate_key、candidate_id、subject_id、subject_type、framework、dimension_id、dimension_name、variable_id、variable_name、current_snapshot_id、change_type、old_state、candidate_state、supporting_evidence_ids[]、supporting_analysis_ids[]、new_supportive_usable_count、eligible_for_draft、auto_update_eligible、auto_update_rule_version、auto_update_blockers[]、independent_source_record_count、new_time_point_count、new_context_count、new_source_type_count、auto_update_attempted_evidence_ids[]、auto_update_last_attempted_count、auto_update_contradiction_notes、contradiction_status、contradiction_resolution、context_changes[]、reasoning_basis、profile_id、review_status、draft_snapshot_id、applied_snapshot_id、application_mode、auto_applied_at、auto_applied_by、created_at、updated_at。

change_type：content_update / support_strengthening / context_refinement / contradiction_pending / no_change。

`candidate_key` 由 subject + framework + variable + current active snapshot 构成。`eligible_for_draft` 继续表达旧受控草稿数量门槛；正式自动更新使用更严格的 `auto_update_eligible`：同一变量至少 2 条 active snapshot 之后新增的 continuous supportive usable Evidence、至少 2 个独立原始记录、跨日/跨精确 context/跨 source type 至少一项达到 2，且 contradiction_status != pending。review_status 兼容 pending_review、blocked_by_contradiction、awaiting_additional_evidence、draft_created、applied、resolved_no_change。AI 发现无法解释的矛盾时保存本次 attempted evidence IDs；同一批证据不重复尝试，新增 supportive usable Evidence 后才重新评估。单条 Evidence、weak、irrelevant、uncertain、insufficient、同源重复和覆盖不足都不能改 active snapshot。

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
  ↓ identity_map → Teacher Subject
  ↓ teacher_student_collection_access
Student Subject

users (Teacher operator)
  ↓
identity_map
  ↓
Teacher Subject

teacher_bind_codes
  ├─ bind_code_hash
  └─ Teacher Subject

student_bind_codes
  ├─ bind_code_hash
  ├─ status + usage_state
  └─ Student Subject
```

统一本人绑定协议：`bindSubjectByCode(subject_type, bind_code)`；统一安全查询：`getMySubjectBindings(subject_type)`。Teacher 帮助 Student 使用 `authorizeTeacherStudentCollectionByCode(bind_code)`，列表使用 `getMyTeacherStudentCollectionAccesses()`。所有 Student 正式云函数统一通过 `authorizeStudentOperator` 识别 Guardian 或 Teacher Collector。

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
model_change_candidates
  ↓
model_snapshots
```

学生首次模型主链：

```text
users (Guardian / Teacher operator)
  ↓ guardian_student_bindings / teacher_student_collection_access authorization
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
model_snapshots (automatic_initial → active Teacher-T0 / Student-M0)
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
