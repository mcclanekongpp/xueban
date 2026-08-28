# ARCHITECTURE.md

## 0. 当前实施优先级

教师首次模型、Student Binding、Student Initial Model 与 Student Continuous Collection V1.0 均已完成端到端验证。教师持续语音提交超时阻断已修复并完成真实记录恢复验证；教师/学生采集页和模型页的信息架构已经统一。真人试采候选版 `1.0.5` 已上传为微信小程序开发版本，当前实施优先级是微信平台隐私核对、审核与发布，随后进入真人教师和学生主体模型采集测试；只修复阻断真实采集、人工审核或首次模型构建的问题。

Evidence Profile、Evidence Gap、Targeted Supplement、Stagnation、Unmatched 聚类、Model Change Candidate 和自动版本更新继续保留在总体架构中，但当前暂停深入开发；除非它们阻断首次模型构建，不进入近期实现范围。学生第一版以语音为主，并允许必要的人工观察记录，不要求图片、视频或自动行为识别。

## 0.1 Student Binding MVP 身份与组织架构

知情同意在线下以纸质方式完成。小程序不保存电子知情同意，也不把输入绑定码解释为知情同意。

```text
School
  ↓
Class
  ├─ Teacher Subject
  └─ Student Subject (Student_ID, student_v1.0)
          ↑
线下预生成 bind code + 学校范围 student_no
          ↑ 双重哈希校验
Guardian WeChat User（仅采集终端操作者）
```

组织关系由 `schools`、`classes`、`class_memberships` 表达。教师和学生仍统一存放在 `subjects`，不建立 teacher_student_direct_relation。

```text
registerStudentForStudy（研究团队受控调用）
  → 创建独立 Student Subject
  → 建立 student class_membership
  → 随机生成一次性 bind code
  → 只保存 bind_code_hash + school-scoped student_no_hash

bindStudentByCode（当前微信用户）
  → 云端通过 OPENID 解析 users.user_id
  → bind code + student_no 双重匹配
  → 事务创建 guardian_student_binding 并把 code 置为 used

getMyStudentBindings
  → 仅返回当前用户 active bindings 与 Student Home 安全字段
```

绑定不会修改 `users.role`。后续学生 Voice、Message、Evidence、Evidence Analysis 与 Model Snapshot 一律归属 Student_ID，而不是 Guardian OpenID / user_id。

五个 Student Binding 集合均设置为 ADMINONLY，普通小程序端不可直接读写。

## 0.2 Student Initial Model MVP

```text
Guardian WeChat（active binding，仅操作者）
  → Student Subject（Student_ID）
  → S0 / subject_background（组织记录自动形成）
  → 17 项 student_v1.0 initial tasks
  → 每题独立 Session
  → Voice → ASR → Message
  → Student Evidence
  → Student Evidence Analysis V1.0
  → collection_progress 17/17
  → buildStudentInitialModel（draft）
  → approveStudentInitialModel（Human Review）
  → active Student-M0
  → getStudentCurrentModel / student-model（绑定用户安全摘要）
```

Student Session、Voice、Message、Evidence、Evidence Analysis 与 Model Snapshot 均归属 Student_ID。当前微信用户仅以 `operator_user_id` / `approved_by_user_id` 表达操作责任，不能替代研究主体。所有接收 `subject_id` 的学生云函数均通过 active `guardian_student_bindings` 或受控研究者权限校验。

17 个任务是 Student V1.0 的 MVP 技术组织方式，不是最终实地采集方法学。儿童端只显示自然、简短的任务提示，不显示 S1—S6、变量编号、Evidence、分数或模型结论。每题独立保存，分析失败时保留 Voice、Message 与 Evidence，采集进度只在有效分析完成后推进。

Student-M0 由有效 Evidence Analysis 确定性汇总，固定保留 S1—S6 与 17 个变量；证据不足的变量不会丢失，也不会强行描述。模型先写入新的 draft `model_snapshots`，人工审批后同一 snapshot 转 active，历史 snapshot 不覆盖。17/17 后 Student Home 提供首次建模结果入口；`getStudentCurrentModel` 只返回绑定 Student 的安全摘要，`student-model` 区分“待复核”与“已复核”，不暴露原始 Evidence、内部 reasoning、分数、排名或诊断。

### Teacher Continuous 真人提交链

教师持续记录仍使用 Voice → ASR → Message → 内容路由 → 0—5 条 Evidence → 独立 Evidence Analysis。正式前端通过 `analyzeTeacherEvidence(action = route_continuous)` 复用该函数 60 秒运行环境完成 AI 路由，并在路由成功后逐条调用 `analyzeTeacherEvidence(save_analysis = true)`。默认 3 秒的独立 `submitTeacherContinuousRecord` 仅保留为无正式前端入口的旧端点。路由使用确定性 continuous/evidence 文档 ID 保持重试幂等；无匹配时保存 Voice、Message、continuous_record_id 与原因，不制造 Evidence，也不更新当前 Teacher Model。

## 0.3 Student Continuous Collection V1.0

```text
Student Home（17/17）
  → “再说一说”
  → student_continuous_record Session
  → Voice → ASR → Message
  → analyzeStudentEvidence(action = route_continuous)
  → 0—5 条 Student Continuous Evidence
  → analyzeStudentEvidence(save_analysis = true)
  → 返回 Student Home
```

该流程继续以 active `guardian_student_bindings` 为授权边界。Student_ID 是 Voice、Message、Evidence 与 Evidence Analysis 的主体，Guardian user 只作为 operator。来源类型 `student_continuous_record` 只提供情境，不能直接绑定变量；路由最多返回 5 个有明确原文依据的变量，也允许 `matches = []`。

无匹配时仍保存 Voice、Message、`continuous_record_id` 与 no-match reason，不制造 Evidence。ASR、路由或 Analysis 失败时保留原始记录并允许重试。持续 Evidence 仅进入证据层，不修改 active Student-M0、不生成 Student-M1、不改变 current snapshot。

正式页面复用 `analyzeStudentEvidence` 已配置的 120 秒运行环境完成 AI 内容路由；独立的 `submitStudentContinuousRecord` 当前保留为无前端入口的实现，不作为 1.0.5 正式调用链，避免其云端默认 3 秒运行限制阻断真人提交。

## 0.4 真人试采发布边界

- 正式代码包入口仅保留主体模型采集流程；遗留 QuickStart 页面从 `app.json` 移除并由上传忽略配置排除。
- TEST 辅助脚本和无前端入口的 TEST 云函数可留在开发环境，但真人流程不得生成 `is_test = true` 或 `test_source = simulated_transcript` 的记录。
- 真人 Student 的 `buildStudentInitialModel` 只创建 draft。`approveStudentInitialModel` 仅 researcher / admin 可对真人主体受控执行，普通 Guardian 无审批权限；teacher 仅可在本人 active binding 下查看或审批 TEST Student。
- 普通 Guardian 不直接访问数据库，只能读取本人 active binding 对应的安全 Student-M0 摘要，不能读取原始 Evidence、内部 reasoning、`student_no_hash` 或 `bind_code_hash`。所有学生采集授权继续以当前 user 的 active `guardian_student_bindings` 为边界。
- 教师首页持续采集只保留 `teaching_reflection`、`student_observation`、`free_dialogue` 三个已实现入口；重复的泛化语音入口和未开发的记录中心不进入正式页面。Teacher Record Center 作为非阻断 TODO 保留。
- 教师/学生逐项采集采用一致的页面宽度、进度、任务卡、录音、提交与状态反馈结构；教师/学生模型采用一致的版本状态、一级维度、二级变量、四级状态标签、当前描述与可选不确定性结构。学生采集文案继续保持儿童友好，不显示技术术语。
- 微信小程序开发版本 `1.0.5` 已上传；微信公众平台隐私声明确认、提交审核与正式发布属于平台管理员操作，不由开发版本上传自动完成。`1.0.4` 不再用于送审。

## 1. 总体架构

```text
真实主体 Teacher / Student
        ↓
Collection Event
        ↓
多模态原始数据
Voice / Text / Image / Video / Behavior / File
        ↓
原始记录层
messages / voice_records / media_records / behavior_records
        ↓
内容解析 / 标准化
        ↓
Variable Routing
        ↓
Evidence
        ↓
Evidence Analysis
        ↓
Evidence Health Layer
        ├─ Evidence Profile
        ├─ Evidence Gap
        ├─ Stagnation Diagnosis
        └─ Unmatched Monitoring
        ↓
Model Change Candidate
        ↓
人工 / 规则审核
        ↓
Model Snapshot
        ↓
Current Subject Model
```

## 2. 四层后台结构

### 第一层：原始记录层
负责保存“真实发生了什么”。

当前：messages、voice_records。

计划：collection_events、media_records、behavior_records。

### 第二层：证据层
负责回答“哪些原始记录可以作为哪个变量的研究证据”。

- evidence
- evidence_analysis

### 第三层：证据健康层
负责回答：当前有什么证据、证据够不够、还缺什么、为什么长期不更新、哪些记录没有被框架解释。

计划：variable_evidence_profiles、evidence_gaps、supplement_candidates、unmatched / stagnation 状态。

### 第四层：主体模型层
负责主体模型变化与版本。

- model_change_candidates
- model_snapshots

## 3. 教师—学生共用与差异

共用：Collection Event、Evidence、Evidence Analysis、Evidence Profile、Evidence Gap、Targeted Supplement、Unmatched Monitoring、Stagnation Diagnosis、Model Change Candidate、Model Snapshot。

差异：变量框架、变量定义、最低证据结构、采集任务、追问内容、成人/儿童交互方式。

## 4. Collection Event
定义：一次真实发生的采集事件。

教师示例：首次访谈任务、教学反思、学生观察、自由记录。

学生示例：自然访谈、分类任务、预测任务、问题解决任务、合作观察。

一个事件可以包含多个模态：

```text
CE_001
├─ voice
├─ image
└─ behavior_observation
```

建议集合：`collection_events`

建议字段：collection_event_id、subject_id、subject_type、framework、session_id、event_type、event_title、task_id、target_dimension、target_variable、modalities[]、context、status、started_at、completed_at、created_at、updated_at。

## 5. Evidence
统一定义：某条原始记录或某个真实采集事件，对某一个主体变量形成的一条可追溯研究证据。

Evidence 不是 Voice，不是 Message，也不是 Model Conclusion。

一条原始输入可以生成多个变量 Evidence。

## 6. Evidence Analysis
统一输出：relevance_status、evidence_sufficiency、extracted_points、reasoning_basis、context、uncertainty。

相关性：relevant / partially_relevant / irrelevant / uncertain。

充分性：usable / weak / insufficient。

禁止直接生成综合分数、固定类型、能力等级或主体最终结论。

## 7. Evidence Profile
集合：`variable_evidence_profiles`

目标：维护“某个主体、某个变量当前的证据健康台账”。

关键字段：profile_id、subject_id、subject_type、framework、dimension_id、dimension_name、variable_id、variable_name、evidence_count、analyzed_count、relevant_count、partially_relevant_count、irrelevant_count、uncertain_count、usable_count、weak_count、insufficient_count、supportive_evidence_count、supportive_usable_count、supportive_weak_count、source_types[]、source_type_count、source_modalities[]、modality_count、effective_modality_count、first_evidence_at、latest_evidence_at、evidence_dates[]、time_point_count、contexts[]、context_count、support_status、support_status_name、support_summary、evidence_gaps[]、gap_status、contradiction_status、stagnation_status、profile_version、created_at、updated_at。

支持状态：insufficient / initial / supported / relatively_stable。

V1.0 中，supportive evidence 固定指：`relevance_status` 为 relevant / partially_relevant，且 `evidence_sufficiency` 为 usable / weak。来源、模态、时间点和情境覆盖度只由 supportive evidence 贡献。

V1.0 规则：
- 证据不足：supportive_usable_count = 0 且 supportive_weak_count = 0
- 初步描述：已有 supportive weak 或 usable，但未达到 supported
- 已有一定支持：supportive_usable_count >= 2，且时间/来源/情境至少一项 >= 2
- 较稳定：supportive_usable_count >= 4，time_point_count >= 3，context_count >= 2，且 source_type_count >= 2 或 effective_modality_count >= 2，同时 contradiction_status != pending

`unknown` 可以保留在 source_modalities 中用于暴露历史数据缺口，但不计入 effective_modality_count。context 保留分析原文并精确去重；context_count 只是 V1.0 辅助覆盖指标，不代表标准化情境类别数量。

Profile 只回答“现在有什么”，不直接回答“还缺什么”。

## 8. Evidence Gap
V1.0 缺口类型：no_evidence、insufficient_detail、abstract_only、missing_reason、missing_behavior、missing_outcome、single_context、single_source、stale_evidence、contradiction_pending。

Evidence Gap 回答：“为什么当前变量刻画还不完整？”

## 9. Targeted Supplement
触发原则：优先基于刚提交的真实记录追问，其次基于长期变量缺口触发；一次只推荐 1—2 个；支持现在补充 / 稍后记录 / 暂时跳过；自然记录为主，定向采集为辅。

## 10. Stagnation Diagnosis
长期无模型更新时区分：
A. 记录不足；B. 记录很多但大量 no_match；C. 能匹配但长期 weak；D. usable 很多但只是重复验证已有模型。

模型不变化不一定异常，可能只是支持增强、情境扩大、置信程度提升。

## 11. Unmatched Monitoring
任何 `matches = []` 都必须保留原始记录。

建议状态：routing_status = no_match、no_match_reason、recheck_status = pending。

后续：重新路由 → 仍未匹配 → 聚类 → framework_gap_candidate → 研究者审核。

系统不得自动创建 T6 / S7 等新维度。

## 12. Model Change Candidate
新证据不得直接覆盖 current model。

建议变化类型：content_update、support_strengthening、context_refinement、contradiction_pending、no_change。

正式更新后创建新的 model snapshot。

## 13. 多模态策略
架构支持 voice / text / image / video / behavior / file。

当前实际开发：教师语音为主；学生 V1.0 语音 + 行为观察；图片/作品后续接入；视频只在明确研究问题需要时采集。

## 14. 主体模型版本原则
教师：Teacher-T0 → Teacher-T1 → Teacher-T2 ...

学生：Student-M0 → Student-M1 → Student-M2 ...

历史版本永久保留。每个版本必须可回答：当时如何描述主体、依据哪些证据、哪些地方不确定、为什么后来发生变化。
