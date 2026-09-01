# ARCHITECTURE.md

## 0. 当前实施优先级

教师首次模型、Student Binding、Student Initial Model 与 Student Continuous Collection V1.0 均已完成端到端验证。Teacher / Student 单 Bind Code 与 Guardian + 同班 Teacher 共同构建同一 Student 的机制已部署到 `model-dev-d9gkoyaolb464c28d`，隔离 TEST 云端验收覆盖 10 项绑定顺序/幂等/跨班/多教师规则和共享 Progress。持续模型规则驱动自动更新、首次模型无人工审核激活及 researcher/admin 只读总览保持不变。独立《声纹授权协议》、60 秒 ASR 兼容、前端失败恢复及 Student Progress 并发保护已进入微信开发候选版 `1.0.11`；该版本已上传但尚未提交审核或正式发布。

Evidence Profile、Profile 内 Evidence Gap、矛盾状态、Stagnation Diagnosis 和 Model Change Candidate 已接入 Teacher / Student 持续采集后的正式派生链。已部署的自动更新 V1.0 在候选同时满足数量、独立记录、覆盖度和无矛盾规则时执行“AI 证据综合 → 结构校验 → 新 revision snapshot → 自动 active”，不再要求人工点击审批；任何未达门槛或存在 pending contradiction 的变量都只积累证据。Targeted Supplement、Unmatched 聚类和更长期的节奏/回退策略继续暂停。学生第一版仍以语音为主，并允许必要的人工观察记录，不要求图片、视频或自动行为识别。

## 0.1 Teacher / Student Subject Binding V1.1

知情同意在线下以纸质方式完成。小程序不保存电子知情同意，也不把输入绑定码解释为知情同意。

```text
School
  ↓
Class
  ├─ Teacher Subject (Teacher_ID, teacher_v1.0)
  │       ↑ 唯一 Teacher Bind Code
  │       ↑ 教师本人微信
  └─ Student Subject (Student_ID, student_v1.0)
          ↑ 唯一 Student Bind Code
          ├─ Guardian 微信（guardian_student_bindings）
          └─ 同班 Teacher（teacher_student_collection_access）
```

组织关系由 `schools`、`classes`、`class_memberships` 表达。School_ID / Class_ID 是线下研究组织编码，不是可以登录或绑定微信的主体。教师和学生仍统一存放在 `subjects`，不建立 teacher_student_direct_relation。

```text
registerTeacherForStudy / registerStudentForStudy（研究团队受控调用）
  → 创建独立 Teacher / Student Subject
  → 建立 teacher / student class_membership
  → 为每个 Subject 只生成一个高熵随机 bind code
  → 数据库只保存 bind_code_hash

bindSubjectByCode（当前微信用户）
  → 云端通过 OPENID 解析 users.user_id
  → 根据 subject_type 选择 teacher / student code 空间
  → 仅校验 bind code，定位唯一 Subject
  → 校验 Subject、framework、School / Class membership
  → Teacher：事务创建 identity_map 并把 Teacher code 置为 used
  → Student Guardian：创建唯一 active guardian_student_binding，Student code 保持 active

authorizeTeacherStudentCollectionByCode（已完成 Teacher Binding 的当前微信）
  → 仅输入 Student Bind Code
  → 不检查 Teacher 13/13、Evidence、Model 或 current snapshot
  → 校验 Teacher 与 Student 仍共享 active Class
  → 幂等创建 teacher_student_collection_access

authorizeStudentOperator（所有 Student 正式功能共用）
  ├─ active Guardian binding
  └─ active Teacher identity + active collector access + 当前仍共享 active Class

getMySubjectBindings
  → 仅返回当前用户指定 subject_type 的 active bindings 与安全组织字段
```

教师本人绑定写入增强后的 `identity_map`，成功后才将当前 `users.role` 设为 teacher；`ensureTeacherSubject` 只读映射，不再创建主体。Guardian 绑定写 `guardian_student_bindings` 且不修改 `users.role`。Teacher 帮助 Student 时另写 `teacher_student_collection_access`，不创建第二个 Student 模型。后续学生 Progress、Session、Voice、Message、Evidence、Evidence Analysis、Profile、Candidate 与 Model Snapshot 一律归属同一个 Student_ID；操作者只记录为 `operator_user_id` / `operator_type` / `operator_teacher_subject_id`。

绑定码明文只在受控预登记成功时返回一次，数据库只保存 hash。Teacher code 使用 unused / used / revoked / expired；Student code 使用 `status = active / revoked / expired` 与独立 `usage_state = unused / guardian_only / teacher_only / guardian_and_teacher`。一个 Student 仍只允许一个 active Guardian，但允许多个同班 Teacher 各自取得采集 access；同一 Teacher 重复输入同一码幂等且不重复增加 `teacher_access_count`。历史 `teacher_no_hash` / `student_no_hash` 暂时保留但新流程不读、不写、不验证。绑定错误尝试具有基础限流。所有绑定相关集合保持 ADMINONLY。

### 0.1.1 独立语音及声纹信息授权 V1.0

线下纸质研究知情同意与小程序内语音敏感个人信息授权是两个不同边界。所有正式录音页在 `recorderManager.start()` 前统一执行：

```text
点击/按住开始录音
  → checkVoiceConsent(subject_id)
  → OPENID 解析当前 users.user_id
  → Teacher: 校验 identity_map 指向当前 active Teacher Subject
     Student: 通过 authorizeStudentOperator 校验 active Guardian 或合法同班 Teacher Collector
  → 查询 user_id + subject_id + consent_version = 1.0 + active
  ├─ 已授权：允许开始录音
  └─ 未授权：进入 pages/voice-consent，主动勾选后 saveVoiceConsent
```

前端不能传 user_id。`voice_consents` 为 ADMINONLY；Student 授权按当前 operator user + 单个 Student_ID 保存，同一 Guardian 的不同孩子、不同 Teacher Collector 都不能共用授权。用户未勾选、点击“不同意”、授权查询失败或主体关系校验失败时，录音页保持 fail-closed，不调用麦克风。协议明确语音仅用于 ASR、研究数据与主体模型构建完善，不用于声纹登录、身份认证、身份识别、声纹比对或学生排名。

## 0.2 Student Initial Model MVP

```text
Guardian WeChat 或同班 Teacher Collector（仅操作者）
  → Student Subject（Student_ID）
  → S0 / subject_background（组织记录自动形成）
  → 17 项 student_v1.0 initial tasks
  → 每题独立 Session
  → Voice → ASR → Message
  → Student Evidence
  → Student Evidence Analysis V1.0
  → collection_progress 17/17
  → buildStudentInitialModel（证据综合 + 固定 17 变量校验）
  → 确定性 initial snapshot
  → 规则自动激活 active Student-M0
  → getStudentCurrentModel / student-model（绑定用户安全摘要）
```

Student Session、Voice、Message、Evidence、Evidence Analysis 与 Model Snapshot 均归属 Student_ID。当前微信用户仅以 `operator_user_id` / `operator_type` / `operator_teacher_subject_id` / `triggered_by_user_id` 表达采集或触发责任，不能替代研究主体。所有接收 `subject_id` 的学生云函数均通过 `authorizeStudentOperator` 或受控研究者权限校验。

17 个任务是 Student V1.0 的 MVP 技术组织方式，不是最终实地采集方法学。儿童端只显示自然、简短的任务提示，不显示 S1—S6、变量编号、Evidence、分数或模型结论。每题独立保存，分析失败时保留 Voice、Message 与 Evidence，采集进度只在有效分析完成后推进。Student Home 在 17/17 后会幂等调用 `analyzeStudentEvidence(action = analyze_pending_initial)`，教师端使用对应 Teacher action；两者都会校验 Evidence↔Analysis 身份字段并修复缺失链接，不修改原始表达。

Student-M0 使用 `student_initial_model_v1.2` 对 supportive Evidence Analysis 做 AI 证据综合，固定保留 S1—S6 与 17 个变量。生成结果必须提炼具体情境中的观察/理解、判断、行动/调整、结果与边界，不得把 extracted_points 或转写直接拼接成模型描述；证据不足的变量不会丢失，而是保留为“证据不足”。新 snapshot 还需生成不超过 100 字且覆盖 S1—S6 的 `overview_summary`。首次构建采用确定性 snapshot ID 和 `activating → active` 事务流，记录 `activation_mode = automatic_initial`，同时更新 Subject 当前版本指针；重试复用同一 snapshot，不需要人工审核。`approveStudentInitialModel` 仅作历史兼容，不再写入新审批。17/17 后 Student Home 提供首次建模结果入口；`getStudentCurrentModel` 只返回绑定 Student 的安全摘要，不暴露原始 Evidence、内部 reasoning、分数、排名或诊断。

### Teacher Continuous 真人提交链

教师持续记录仍使用 Voice → ASR → Message → 内容路由 → 0—5 条 Evidence → 独立 Evidence Analysis。正式前端通过 `analyzeTeacherEvidence(action = route_continuous)` 完成 AI 路由，并用 `action = analyze_batch` 以每批最多 3 条并发完成各 Evidence 的独立校验与落库。路由使用确定性 continuous/evidence 文档 ID 保持重试幂等；无匹配时保存 Voice、Message、continuous_record_id 与原因，不制造 Evidence。Analysis 成功后异步触发 `advanceSubjectModel(refresh)`：先重建证据健康层和候选；达到自动门槛时创建并激活新的 Teacher revision snapshot，否则 active Teacher Model 保持不变。

## 0.3 Student Continuous Collection V1.0

```text
Student Home（17/17）
  → “再说一说”
  → student_continuous_record Session
  → Voice → ASR → Message
  → analyzeStudentEvidence(action = route_continuous)
  → 0—5 条 Student Continuous Evidence
  → analyzeStudentEvidence(action = analyze_batch)
  → advanceSubjectModel(action = refresh，异步)
  → 返回 Student Home
```

该流程以 `authorizeStudentOperator` 为统一边界：active Guardian 或拥有 active collector access 且仍与 Student 同班的 Teacher 均可操作。Student_ID 是 Voice、Message、Evidence 与 Evidence Analysis 的主体，当前微信只作为 operator。来源类型 `student_continuous_record` 只提供情境，不能直接绑定变量；路由最多返回 5 个有明确原文依据的变量，也允许 `matches = []`。

无匹配时仍保存 Voice、Message、`continuous_record_id` 与 no-match reason，不制造 Evidence。ASR、路由或 Analysis 失败时保留原始记录并允许重试。持续 Evidence 不原地修改 active Student-M0；达到自动更新门槛后创建 Student-M1/M2 revision snapshot 并自动激活，未达门槛或存在矛盾时 current snapshot 不变。

正式页面复用 `analyzeStudentEvidence` 已配置的 120 秒运行环境完成 AI 内容路由和批量 Analysis；独立的 `submitStudentContinuousRecord` 当前保留为无前端入口的实现，避免其云端默认 3 秒运行限制阻断真人提交。

## 0.4 当前主体刻画与后续补充对话

```text
Evidence + latest active Evidence Analysis + current active/draft Snapshot
  → getSubjectModelGuidance（只读证据健康规则）
  → 1—3 个优先补充方向与自然对话提示
  → Teacher Reflection / Student Observation / Student “再说一说”
  → 内容独立路由
  → 新 Evidence + Evidence Analysis
  → 统一自动更新规则判断
  → 新 revision Snapshot（满足门槛时自动 active）
```

`getSubjectModelGuidance` 不创建 Evidence Gap 集合或候选记录，也不写数据库。它只使用 supportive Evidence（relevant / partially_relevant 且 usable / weak）的数量、充分性、情境和时间覆盖，结合当前 snapshot 状态进行优先级排序。提示问题只负责开启对话，不把入口类型硬绑定模型变量；实际语音仍可匹配 0—5 个变量或 0 匹配。

Teacher 生成协议为 `teacher_initial_model_v1.3`，Student 生成协议为 `student_initial_model_v1.2`。两者均要求模型描述承担跨证据综合，而不是复述转写或逐条排列 extracted_points，并生成不超过 100 字、覆盖固定一级维度的 `overview_summary`。首次采集完成后自动构建和激活，证据不足的变量保留为缺口；已有 active snapshot 保持不可变，不在原记录上覆盖。

## 0.5 模型构建进度与模型页信息层级

`getSubjectModelGuidance` 在同一份只读 Evidence / latest active Evidence Analysis 数据上计算 `construction_progress`，不新增集合、不写 snapshot，也不更改模型变量。固定框架中每个二级变量最高 100%，仅表示证据底座是否逐步形成：

- 已有 active Evidence：20%；
- 已有与 Evidence 一致的有效 Analysis：20%；
- 已有至少 1 条 supportive Evidence：30%；
- 已有至少 2 条 supportive Evidence：15%；
- supportive Evidence 覆盖至少 2 个中国标准时间自然日：10%；
- supportive Evidence 覆盖至少 2 个 context 或 source type：5%。

supportive 仍严格限定为 `relevance_status = relevant / partially_relevant` 且 `evidence_sufficiency = usable / weak`。irrelevant、uncertain、insufficient 不增加支持覆盖；进度计算不会调整 relevance、sufficiency、confidence、首次模型构建或持续模型自动更新门槛。一级维度进度是该维度固定变量的算术平均，总体进度是教师 13 个或学生 17 个固定变量的算术平均，因此未采集变量必然以 0 计入，不能通过只重复少数变量获得 100%。

Teacher / Student 模型页统一按“100 字内总体概览 → 构建进度百分比与一级维度雷达图 → 具体变量信息”展示。新 snapshot 优先使用经模型生成并通过固定结构/证据规则校验的 `model_data.overview_summary`；旧 active snapshot 保持不可变，页面暂以全维度构建状态摘要作为兼容概览，不回写历史数据。

## 0.6 持续证据规则驱动自动更新 V1.0

```text
Continuous Evidence + latest valid Evidence Analysis
  → advanceSubjectModel(refresh)
  → 13 / 17 个 Variable Evidence Profile 完整重建
  → Profile 内 Evidence Gap / Contradiction / Stagnation
  → Model Change Candidate
  → 自动门槛校验
  → AI 跨证据综合 + 固定 13 / 17 变量结构校验
  → revision snapshot（Teacher-T1 / Student-M1...）
  → 规则引擎自动激活
  → 新 active snapshot；旧 active → superseded，历史数据不覆盖
```

`refresh` 每次从主体全部 active Evidence 与对应的最新有效 Analysis 重新计算，不做 `count += 1`。supportive 固定为 relevant / partially_relevant 且 usable / weak；来源、模态、时间点和情境覆盖只由 supportive Evidence 贡献，unknown modality 不帮助达到多模态门槛。情境仍按原文精确去重，`context_count` 只是 V1.0 辅助指标，不代表语义聚类后的标准情境类别。

Evidence Gap V1.0 作为 Profile 内嵌状态保存，包括 no_evidence、insufficient_detail、single_time_point、single_context、single_source、stale_evidence、contradiction_pending。Stagnation 以规则标记 repeated_without_supportive_evidence、repeated_weak_only、repeated_same_context_time 或 no_supportive_update_60d；它是研究提醒，不评价主体。

Model Change Candidate 只考察 current active snapshot 之后的新 continuous supportive usable Evidence。自动更新必须同时满足：同一变量至少 2 条新 supportive usable Evidence；来自至少 2 个独立 `continuous_record_id / voice_id / message_id / session_id`；新证据的中国标准时间自然日、精确去重 context 或 source type 至少一项达到 2；`contradiction_status != pending`。单条新 Evidence、supportive weak、irrelevant、uncertain、insufficient、同一原始记录重复或覆盖不足都不能触发更新。

AI 综合输出还必须通过 100 字概览、候选变量精确匹配和固定 13 / 17 变量完整性校验。无法由情境或时间差异解释的冲突会进入 `awaiting_additional_evidence`，同一批证据不会反复尝试；至少出现新的 supportive usable Evidence 后才重新评估。自动 snapshot 使用确定性 ID 保证重试幂等；激活事务只把当前父 snapshot 转为 superseded，并更新 Subject 指针。旧的 `build_draft / resolve_contradiction / approve_draft` 继续保留为受控兼容/恢复接口，但不再是正常持续采集链的必经步骤。

## 0.7 语音与分析性能 V1.1

- `transcribeVoice` 直接把云存储临时签名 URL 交给腾讯一句话识别，避免云函数下载、Base64 编码和再次上传完整 MP3；临时 URL 不保存、不回传。
- 微信录音上限保持 60 秒。若 MP3 编码尾部填充使媒体时长略超 60 秒，原始 `file_id` 对应文件不裁切、不覆盖；云函数下载内存副本、按完整 MP3 帧裁到 59.85 秒以内，再使用已有权限的一句话识别。该路径不生成第二条 Voice / Message。
- Teacher 首次/持续、Student 首次/持续都采用“原音先落库 → ASR → 展示文字 → 用户确认提交”。ASR 失败时保留 `currentVoiceId`，显示重试状态并禁止新录音覆盖；只有转写成功才启用提交。
- `voice_records` 增加 ASR 分段耗时、`asr_mode`、`asr_source_type`、`asr_trimmed_bytes` 与 `asr_trimmed_duration_ms`，以区分获取临时 URL、腾讯 ASR、60 秒兼容副本和整体云函数耗时。
- 多变量 Analysis 从前端串行 N 次云函数调用改为一次 `analyze_batch`，云函数内部每批最多并发 3 条；每条仍使用独立协议、独立记录和幂等检查。
- 批量 Analysis 与 Evidence Health 正式回包均使用精简字段；健康层和自动更新在 Analysis 落库后异步执行，不阻塞页面成功反馈。
- 性能优化不改变 relevance、sufficiency、supportive、模型置信度、首次模型构建或持续模型自动更新门槛。

## 0.8 真人试采发布边界

- 正式代码包入口仅保留主体模型采集流程；遗留 QuickStart 页面从 `app.json` 移除并由上传忽略配置排除。
- TEST 辅助脚本和无前端入口的 TEST 云函数可留在开发环境，但真人流程不得生成 `is_test = true` 或 `test_source = simulated_transcript` 的记录。
- 真人 Teacher / Student 完成首次采集与 Evidence Analysis 后自动构建、激活 initial snapshot，不设人工审核。普通 Guardian 仍不能指定他人 Student_ID、修改模型规则或直接写 snapshot。
- researcher / admin 登录后进入 `pages/research-overview/research-overview`，通过 `getSubjectModelGuidance(action = research_overview)` 只读查看 Teacher / Student 采集进度、active 模型版本、构建百分比、缺口变量数与优先补充提示。该接口不返回原始录音/转写、Evidence 原文、内部 reasoning 或身份哈希。
- 普通 Guardian / Teacher Collector 不直接访问数据库，只能经云函数读取已授权 Student 的安全模型摘要，不能读取原始 Evidence、内部 reasoning、历史编号 hash 或 `bind_code_hash`。所有学生采集授权统一由 `authorizeStudentOperator` 校验 Guardian binding 或 Teacher collector access；Teacher 仍不能读取未授权或已失去 shared Class 的 Student。
- 教师首页持续采集只保留 `teaching_reflection` 与 `student_observation` 两个正式入口；`free_dialogue` 只作历史数据和旧链接兼容。重复的泛化语音入口和未开发的记录中心不进入正式页面。Teacher Record Center 作为非阻断 TODO 保留。
- 教师/学生逐项采集采用一致的页面宽度、进度、任务卡、录音、提交与状态反馈结构；教师/学生模型采用一致的总体概览、构建进度雷达图、版本状态、一级维度、二级变量、四级状态标签、当前描述与可选不确定性结构。学生采集文案继续保持儿童友好，不显示技术术语；构建进度明确标注为覆盖指标而非能力或质量评价。
- 微信小程序开发候选版 `1.0.11` 已上传，包含独立声纹授权、近 60 秒语音恢复、Teacher / Student 单绑定码、Guardian + Teacher 联合采集与 Student Progress 并发保护。微信公众平台隐私声明确认、提交审核与正式发布仍属于平台管理员操作。

### 0.8.1 真人采集并发边界

- CloudBase 单个云函数系统并发上限为 1000，但该数值不是当前端到端采集吞吐承诺；函数还受环境套餐 QPS、数据库热点写、AI 和外部 ASR 限制。
- 腾讯一句话识别当前官方免费 QPS 为 30；CloudBase 内置 AI 默认环境级并发为 10。当前多变量 `analyze_batch` 每批最多并发 3 条，因此 AI 是首轮真人采集最早的共享瓶颈。
- 隔离 TEST 实测 50 路 Teacher / Student 混合只读调用全部成功。单一 Student 同一任务 10 路完成请求经事务冲突退避后全部成功，Progress 只增加一次；20 路热点写最终仍保持唯一且无溢出，但出现 1 次达到重试上限的瞬时失败。
- 真人小样本启动线：首次任务同秒提交建议不超过 8 人；持续语音进入多变量 Analysis 的同秒流水线建议不超过 3 人；同一 Student 应由 Guardian / Teacher 协调，避免多端同时回答同一题。超出后应分批启动或增加平台 AI 并发，而不是降低 Evidence Analysis 门槛。

## 0.7 全量备份与恢复边界

本地管理员工具位于 `tools/xueban-backup`，不进入小程序代码包，也不是普通前端或业务云函数入口。工具通过微信开发者工具的只读云能力枚举并导出全部实际集合，独立枚举 `voice/` 云存储对象，完整保存全部 draft / active / 历史 Teacher / Student `model_snapshots`，并建立 Voice → Message → Evidence → Evidence Analysis → Model Snapshot 引用校验。

备份交付物使用 GPG AES-256 对称加密，逐文件保存 SHA-256；数据库与云存储执行前后双清单校验，只有 fatal = 0 且备份期间数据未变化时才标记 `restorable = true`。工具没有云端删除或覆盖恢复命令；未来恢复必须先进入新的空白验证环境，并通过 `file-id-remap.json` 处理跨环境 `cloud://` file ID 变化。

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
统一自动更新规则
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

当前：`variable_evidence_profiles`，以及其中内嵌的 `evidence_gaps`、`gap_status`、`contradiction_status`、`stagnation_status`。Targeted Supplement 与 Unmatched 聚类仍为后续机制。

### 第四层：主体模型层
负责主体模型变化与版本。

- model_change_candidates
- model_snapshots

当前本地已实现 Candidate → 自动门槛 → revision snapshot → 自动 active；普通采集端只触发 `refresh`，不能降低规则、指定候选或直接改写 snapshot。旧受控 build / resolve / approve 接口仅作兼容与恢复。

## 3. 教师—学生共用与差异

共用：Collection Event、Evidence、Evidence Analysis、Evidence Profile、Evidence Gap、Targeted Supplement、Unmatched Monitoring、Stagnation Diagnosis、Model Change Candidate、Model Snapshot。

差异：变量框架、变量定义、最低证据结构、采集任务、追问内容、成人/儿童交互方式。

## 4. Collection Event
定义：一次真实发生的采集事件。

教师示例：首次访谈任务、教学反思、学生观察。`free_dialogue` 仅保留为历史兼容来源类型，不再作为正式首页入口。

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
V1.0 当前实现类型：no_evidence、insufficient_detail、single_time_point、single_context、single_source、stale_evidence、contradiction_pending。Gap 作为 Profile 内嵌数组保存，不单独建立集合。

Evidence Gap 回答：“为什么当前变量刻画还不完整？”

## 9. Targeted Supplement
触发原则：优先基于刚提交的真实记录追问，其次基于长期变量缺口触发；一次只推荐 1—2 个；支持现在补充 / 稍后记录 / 暂时跳过；自然记录为主，定向采集为辅。

## 10. Stagnation Diagnosis
长期无模型更新时区分：
A. 记录不足；B. 记录很多但大量 no_match；C. 能匹配但长期 weak；D. usable 很多但只是重复验证已有模型。

模型不变化不一定异常，可能只是支持增强、情境扩大、置信程度提升。

V1.0 已实现确定性状态 `not_evaluated / none / pending`，reason code 包括 repeated_without_supportive_evidence、repeated_weak_only、repeated_same_context_time、no_supportive_update_60d。No-match 聚类仍未接入该状态机。

## 11. Unmatched Monitoring
任何 `matches = []` 都必须保留原始记录。

建议状态：routing_status = no_match、no_match_reason、recheck_status = pending。

后续：重新路由 → 仍未匹配 → 聚类 → framework_gap_candidate → 研究者审核。

系统不得自动创建 T6 / S7 等新维度。

## 12. Model Change Candidate
新证据不得直接覆盖 current model。

当前变化类型：content_update、support_strengthening、context_refinement、contradiction_pending、no_change。

同一变量至少 2 条 active snapshot 之后新增的 supportive usable continuous Evidence只是数量底线；自动更新还要求 2 个独立原始记录，以及跨日/跨情境/跨来源至少一项覆盖，且无 pending contradiction。满足后创建新的 revision model snapshot 并自动 active；无法解释的矛盾保留并等待新证据，旧 snapshot 永不覆盖。

## 13. 多模态策略
架构支持 voice / text / image / video / behavior / file。

当前实际开发：教师语音为主；学生 V1.0 语音 + 行为观察；图片/作品后续接入；视频只在明确研究问题需要时采集。

## 14. 主体模型版本原则
教师：Teacher-T0 → Teacher-T1 → Teacher-T2 ...

学生：Student-M0 → Student-M1 → Student-M2 ...

历史版本永久保留。每个版本必须可回答：当时如何描述主体、依据哪些证据、哪些地方不确定、为什么后来发生变化。
