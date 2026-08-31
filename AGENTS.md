# AGENTS.md

## 项目名称
智能课堂模拟与教学实验系统

## 项目定位
本项目不是教案生成器、教师/学生测评系统，也不是把大模型自由生成包装成“真实课堂”。

项目目标是：基于真实教师和真实学生的持续证据，构建可解释、可修正、可版本化的主体模型；在此基础上逐步开展主体复现、双主体互动、模拟课堂和真实教学实验验证。

当前工作重点位于五阶段路线的**阶段1：主体表征**。

教师首次模型 MVP、Student Binding MVP、Student Initial Model MVP 与 Student Continuous Collection V1.0 均已完成端到端验证。Teacher / Student 统一绑定协议已建立，采集页和模型页的信息层级已统一。教师 13/13 与学生 17/17 完成后的首次模型自动分析、构建和激活已部署到 `model-dev-d9gkoyaolb464c28d`，并用隔离 TEST Teacher / Student 验证 `automatic_initial`、Subject 当前指针、固定 13 / 17 变量和重复调用幂等性；全流程不再设人工审核。证据不足的变量仍保留为“证据不足”，通过构建进度和后续提示显示缺口，不降低 Evidence Analysis 或 supportive 门槛。持续证据健康、Model Change Candidate 与规则驱动自动 revision 主链也已部署并完成云端验证。researcher/admin 只读主体构建总览已同步部署；小程序开发候选版 `1.0.9` 已于 2026-08-31 19:07:57 CST 上传，尚未提交审核或正式发布。

## 五阶段路线
1. 主体表征
2. 主体复现
3. 双主体互动
4. 模拟课堂
5. 实验验证

逻辑：**建人 → 验证像不像 → 人与人互动 → 完整课堂 → 模拟/真实实验验证**

## 基础对象
当前执行层面只保留三个基础对象：教学内容、教师、学生。课堂不是第四个独立主体模型，而是教师、学生、教学内容和任务情境互动后涌现的轨迹与关系。理论插件是分析视角，不是 Agent。

## 教师主体模型 V1.0
- T0 基本背景，不评分
- T1 课程与学习目标取向
  - T1-1 课程与学习价值理解
  - T1-2 学习结果判断
- T2 学生理解与诊断
  - T2-1 学生已有认识理解
  - T2-2 学习困难诊断
  - T2-3 个体差异理解
- T3 教学策略与PCK
  - T3-1 内容表征与任务设计
  - T3-2 提问与学习支架
  - T3-3 教学策略资源
- T4 互动与关系方式
  - T4-1 提问与反馈方式
  - T4-2 学生自主与教师介入
  - T4-3 互动组织与差异关注
- T5 专业自我、适应与反思
  - T5-1 专业自我与教学信念
  - T5-2 适应性调整与反思

禁止自行新增 T6 或新的一级/二级维度，除非研究者基于真实证据明确修订框架版本。

## 学生主体模型 V1.0
- S0 基本背景，不评分
- S1 认知与已有经验
  - S1-1 观察与信息提取
  - S1-2 已有经验与认知解释
  - S1-3 前概念与认知关联
- S2 思维与问题解决
  - S2-1 比较与分类
  - S2-2 预测与解释
  - S2-3 证据与问题解决
- S3 学习与自我调节
  - S3-1 任务专注与注意调节
  - S3-2 困难应对与策略调整
  - S3-3 自我监控与不确定性感知
- S4 表达与社会互动
  - S4-1 表达与提问
  - S4-2 倾听与回应
  - S4-3 合作与观点调节
- S5 动机、情绪与自我效能
  - S5-1 好奇与学习投入意愿
  - S5-2 学习自信与挫折反应
- S6 兴趣、活动经验与生活情境
  - S6-1 兴趣领域
  - S6-2 活动与生活经验
  - S6-3 家庭学习支持情境

“优势”不作为首次模型固定变量，优势从长期证据中自然形成。

## 主体模型统一输出结构
一级维度 → 二级变量 → 证据层 → 当前状态 + 证据 + 情境 + 置信度 + 不确定性 + 时间/版本。

前端状态语言：证据不足、初步描述、已有一定支持、较稳定。“较稳定”仍然可以被后续证据修正。

模型中的“当前主体刻画”不是 ASR 转写摘要或 Evidence Analysis 要点列表。生成层必须综合有证据支持的情境、关注/理解、判断依据、行动/调整、结果与适用边界；若证据只支持行为，不得反推深层信念。具体原始例子留在 Evidence / evidence_basis，模型描述负责跨证据提炼。首次模型在固定采集完成、Evidence Analysis 完整后自动生成并激活；已有 active 模型后的持续 revision 在满足统一自动更新门槛时由规则引擎激活新 snapshot。任何路径都不得覆盖旧 snapshot。

模型构建进度不是测评得分。V1.0 以固定 13 / 17 个变量为分母，只计算每个变量是否已有 active Evidence、有效 Analysis、supportive Evidence、重复支持、跨日和跨情境/来源覆盖，再汇总为一级维度与总体百分比。supportive 的正式定义和模型采纳门槛保持不变；不得为了提高百分比把 irrelevant / uncertain / insufficient 数据计入支持，也不得降低 confidence、首次模型构建或持续模型自动更新门槛。

## 证据基本原则
1. 原始记录与模型结论分离。
2. Evidence 与 Evidence Analysis 分离。
3. 一条证据不能直接定义稳定主体特征。
4. 新证据不能简单覆盖旧模型。
5. 一段原始输入允许关联多个变量。
6. 变量路由只说明“可能相关”，不等于证据已经 usable。
7. weak / insufficient 不能自动驱动模型更新。
8. unmatched 数据必须保留，用于重路由和框架检验。
9. 不生成教师或学生综合总分。
10. 不做人格化、永久化、污名化标签。

## 教师证据分析协议
相关性：relevant / partially_relevant / irrelevant / uncertain。

充分性：usable / weak / insufficient。

证据分析层只回答：是否相关、是否足够使用、可以提取哪些信息点、判断依据、情境、不确定性。不得直接生成教师类型、能力等级或最终主体模型结论。

## 教师持续记录规则
教师持续记录入口：teaching_reflection / student_observation / free_dialogue。

入口类型只是来源情境，不直接绑定变量。一次录音 = 一次提交单元。

流程：语音 → ASR → 原始记录 → 内容变量路由 → 1条或多条 Evidence → 每条 Evidence 独立 Evidence Analysis。

如果 matches = []：不伪造 Evidence，原始记录必须保留，进入后续 unmatched / recheck 机制。

真人试采正式前端通过 `analyzeTeacherEvidence(action = route_continuous)` 完成内容路由，再用 `action = analyze_batch` 以每批最多 3 条并发完成 1—5 条独立 Evidence Analysis。批量接口只回传最小状态，完整 Analysis 仍逐条落库。分析完成后异步调用 `advanceSubjectModel(action = refresh)` 重建证据健康层，不阻塞提交成功反馈；默认 3 秒的独立 `submitTeacherContinuousRecord` 保留为无正式前端入口的旧端点。

## 教师—学生通用模型完善机制
统一底座：Collection Event → Evidence → Evidence Analysis → Evidence Profile → Evidence Gap → Targeted Supplement → Unmatched Monitoring → Stagnation Diagnosis → Model Change Candidate → Model Snapshot。

共用的是机制，不共用变量定义与采集内容。

当前正式实现由 `advanceSubjectModel` 统一处理 Teacher / Student：每次 `refresh` 从全部 active Evidence 和最新一致的 active Evidence Analysis 完整重建 13 / 17 个 Profile，在 Profile 内保存 Gap、矛盾和停滞状态，并对 active snapshot 之后的新 continuous supportive usable Evidence 生成 Model Change Candidate。持续模型自动更新 V1.0 只有同时满足以下条件才执行：同一变量至少 2 条新的 supportive usable continuous Evidence；来自至少 2 个独立原始记录；跨中国标准时间自然日、精确去重 context 或 source type 至少一项达到 2；不存在 pending contradiction。满足后系统自动综合、校验完整框架、创建新 revision snapshot 并激活，旧 active 转 superseded。单条 Evidence、weak、irrelevant、uncertain、insufficient、重复原始记录或覆盖不足都只积累证据，不能更新模型。

## 多模态原则
系统底层从一开始支持：voice / text / image / video / behavior / file。

当前优先级：教师以语音为主；学生 V1.0 以语音 + 观察记录为主；图片/作品后续接入；视频非默认采集方式，仅在明确研究需要时使用。

Evidence 必须保持模态无关：某条原始记录或某个真实采集事件，对某一个主体变量形成的一条可追溯研究证据。

## 学生采集原则
学生首次建模：儿童自然访谈 + 行为观察 + 监护人补充。禁止把低年级儿童采集做成长问卷、长书写任务。监护人信息是独立证据来源，不是儿童回答的“标准答案”。

## Teacher / Student Subject Binding V1.0
- 教师、家长与学生知情同意均在线下以纸质方式完成；小程序不提供电子知情同意页面，也不把绑定行为解释为知情同意。
- 研究团队在线下准备阶段登记 School / Class / Teacher Subject / Student Subject，并为每个待绑定 Subject 预生成随机一次性绑定码。School_ID / Class_ID 是组织编码，不是微信登录主体或单独登录凭据。
- 教师绑定提交 `bind_code + teacher_no`；学生家长绑定提交 `bind_code + student_no`。线下编号按 `school_id` 范围标准化并哈希，绑定码单独标准化并哈希；二者必须指向同一 Subject。
- 正式前端统一调用 `bindSubjectByCode` 与 `getMySubjectBindings`。`registerTeacherForStudy` / `registerStudentForStudy` 负责受控预登记；旧 `bindStudentByCode` / `getMyStudentBindings` 仅作历史兼容。
- 新教师只有绑定成功后才建立 `identity_map` 并把当前 `users.role` 设为 teacher；`ensureTeacherSubject` 只读取既有映射，不再创建 Teacher Subject。既有教师映射继续兼容，不重新绑定、不重复建主体。
- 学生主体使用独立 Student_ID：`subject_type = student`、`model_framework = student_v1.0`。Student_ID 不等于 OpenID、user_id、学号或绑定码。
- 学校与班级关系使用 `schools`、`classes`、`class_memberships`；教师与学生均通过 Class_ID 建立组织关系，不创建 teacher_student_direct_relation。
- Guardian WeChat 只是认证后的采集终端操作者。`guardian_student_bindings` 连接 `users.user_id` 与 Student_ID，但不得修改 `users.role`；后续学生 Voice / Message / Evidence / Model Snapshot 必须归属 Student_ID。
- `teacher_bind_codes`、`student_bind_codes` 均只保存哈希，不保存明文绑定码或线下编号。绑定成功后事务写入绑定关系并把 code 置为 used；支持 revoked，拒绝跨用户重复绑定。
- `schools`、`classes`、`class_memberships`、`teacher_bind_codes`、`student_bind_codes`、`guardian_student_bindings` 与 `identity_map` 均不得允许普通前端任意读写。
- 正式入口分别为“教师采集”和“学生采集”：已有绑定进入对应 Home，否则进入对应 Bind；不把 Student 设计为当前微信账户角色。

## Student Initial Model MVP
- 学生 S0 复用 `subject_background`，由 Student Subject、School、Class 与 membership 自动形成；不保存 OpenID、guardian user_id、绑定码、学号或真实姓名。
- `student_v1.0` 首次采集暂以 17 个儿童友好语音任务覆盖 S1-1 至 S6-3。任务提示保存在 `collection_tasks`，前端不显示变量编号、Evidence、评分或模型术语。
- 每题独立执行 Session → Voice → ASR → Message → Evidence → Evidence Analysis → Progress，允许中途退出后从下一未完成任务继续。
- 学生原始记录、Evidence、Evidence Analysis 与 Model Snapshot 的 `subject_id` 均为 Student_ID；Guardian user 只记录为 `operator_user_id`，不得作为被建模主体。
- Student Evidence Analysis V1.0 使用 `relevance_status`、`evidence_sufficiency`、`extracted_points`、`reasoning_basis`、`context`、`uncertainty`，不做心理诊断、排名、总分或固定人格判断。
- `buildStudentInitialModel` 使用 `student_initial_model_v1.2` 对全部 supportive Evidence Analysis 做 AI 证据综合，固定保留 S1—S6 和 17 变量；禁止直接拼接 extracted_points，不足变量仍保留为“证据不足”。新 Student-M0 含 100 字以内、覆盖 S1—S6 的 `overview_summary`，不使用分数、排名或诊断表达。
- 17/17 完成后，页面自动补齐待分析 Evidence，然后幂等调用 `buildStudentInitialModel`；新 snapshot 以 `activation_mode = automatic_initial` 自动 active，并事务更新 Subject 当前版本指针。`approveStudentInitialModel` 只作历史兼容，不再提供人工审批写入。
- `getStudentCurrentModel` 只向 active Guardian 或 researcher / admin 返回安全摘要；Student Home 在 17/17 后提供“查看首次建模结果”，`student-model` 显示 active 状态及 S1—S6、17 变量的当前描述和不确定性，不返回原始 Evidence、内部 reasoning、分数、排名或诊断。
- TEST Student 历史上已完成 17/17、draft、人工审批、active 与当前模型展示全链路；新规则改为首次模型自动激活，历史审批字段仅作存量数据兼容。

## Student Continuous Collection V1.0
- 首次采集 17/17 后，Student Home 提供儿童友好的“再说一说”入口，不显示变量编号、Evidence 或模型更新术语。
- 每次录音独立提交：Student continuous Session → Voice → ASR → Message → 内容路由 → 0—5 条 Student Evidence → 每条 Evidence 使用 Student Evidence Analysis V1.0 独立分析。
- 正式页面通过 `analyzeStudentEvidence(action = route_continuous)` 完成路由，再以 `action = analyze_batch` 并发处理最多 5 条独立 Analysis；所有调用都校验当前 user 对目标 Student_ID 的 active Guardian binding。
- Voice、Message、Evidence 与 Evidence Analysis 的 `subject_id` 始终是 Student_ID；Guardian user 只记录为 `operator_user_id`。
- `matches = []` 时不制造 Evidence，Voice、Message 与 `continuous_record_id` 仍保存；路由或分析失败时前端保留当前 voice_id 和 transcript，允许重试。
- Student Continuous Evidence 不直接原地修改 active Student-M0；Analysis 完成后异步刷新 Profile / Gap / Contradiction / Stagnation / Model Change Candidate。达到统一自动门槛后，系统创建 Student-M1/M2 revision snapshot 并自动激活；未达门槛或有矛盾时保持当前 active 不变。
- Student Home 的后续提示由 `getSubjectModelGuidance` 根据 supportive Evidence 的数量、充分性、情境与时间覆盖动态排序；提示问题不绑定变量，`analyzeStudentEvidence(action = route_continuous)` 仍按实际语音内容返回 0—5 个变量，允许 0 匹配。
- TEST Student 已完成一次 12.16 秒真机持续录音、腾讯 ASR、3 条路由 Evidence 与 3 条正式 Analysis 的端到端验证。

## 语音处理性能 V1.1
- `transcribeVoice` 使用云存储临时签名 URL 调用腾讯一句话识别，不再由云函数下载完整 MP3、转 Base64 后再上传给 ASR；临时 URL 不写日志、不返回前端。
- Voice 成功转写继续幂等复用，失败仍保留原始云文件与 Voice 记录。
- `voice_records` 记录 `asr_temp_url_ms`、`asr_request_ms`、`asr_total_ms` 和 `asr_source_type = cloud_storage_url`，用于区分临时 URL、ASR 和整体耗时。
- 持续记录命中多个变量时使用批量并发 Analysis；证据健康层异步刷新且使用精简回包，不再增加用户等待时间。AI 路由和首次冷启动仍可能产生数秒等待，不能以降低证据门槛换取速度。

## 真人试采版本边界
- 正式小程序包不暴露 QuickStart、配置助手、批量 Student-M0 或其他 TEST 入口；本地 TEST 脚本可以保留，但真人流程不得调用模拟记录。
- 真人 Teacher / Student 完成固定首次采集且 Evidence Analysis 齐备后，系统自动构建并激活 Teacher-T0 / Student-M0，不设人工审核环节。自动激活不改变 supportive 或信度门槛，证据不足变量以构建进度和后续补充提示显示。
- researcher / admin 从只读“主体模型构建总览”查看 Teacher / Student 首次采集、当前模型版本、构建进度、缺口数和优先补充提示；普通 Teacher / Guardian 无跨主体总览权限。
- 普通 Guardian 只能访问本人 active binding 对应的采集状态、安全字段和 Student-M0 安全摘要，不能直接读取研究集合、原始 Evidence、内部 reasoning、哈希身份字段或完整内部 snapshot。
- 教师首页正式持续采集入口只保留教学反思和学生观察记录；`free_dialogue` 仅作为历史数据/旧链接兼容类型保留在底层，不再作为正式首页入口。重复的泛化“语音记录”与未开发的“我的记录”同样不进入正式信息架构。
- 教师/学生逐项采集页面统一进度、任务卡、录音、提交和状态反馈层级；模型页面统一采用“100 字内总体概览 → 一级维度构建进度雷达图 → 具体变量信息”，再展示版本、状态、当前描述和可选不确定性。构建百分比只用于发现覆盖空白，不作为主体评价。
- 规则驱动持续 revision 已部署并完成 TEST Student 云端自动激活：新 snapshot 使用 `activation_mode = automatic_rule`，旧 snapshot 保留为 `superseded`。小程序开发候选版 `1.0.9` 已上传；微信公众平台隐私保护指引确认、提交审核和正式发布仍需管理员完成。

## 数据与隐私原则
1. 身份信息与研究主体信息分离。
2. 原始证据与模型结论分离。
3. 模型快照不覆盖历史版本。
4. 学生研究身份使用独立 Student_ID，不直接使用 OpenID。
5. 学生主体与当前操作小程序的用户身份必须分离。
6. 重要集合仅由云函数访问。
7. 正式实地研究前必须补齐知情同意、数据保存期限、撤回规则和伦理流程。
8. 本地全量备份必须加密并保持 Voice → Message → Evidence → Analysis → Model Snapshot 的完整追溯；备份密钥不得进入 Git，必须另存离线副本。

## 当前技术环境
- 微信小程序
- 微信开发者工具
- 微信云开发 / CloudBase
- 云环境：model-dev
- 环境 ID：model-dev-d9gkoyaolb464c28d
- 语音识别：腾讯 ASR
- CloudBase AI：hy3

## 当前开发顺序
1. 教师首次主体模型 MVP 快速回归并只修复阻断问题（已完成）
2. Student Binding MVP（已完成）
3. Student Initial Model MVP：S0 → 17 项首次采集 → Voice / ASR → Evidence / Analysis → 自动构建与激活 → Current Model（已部署并通过 TEST Student 云端验证）
4. Student Continuous Collection V1.0（已完成）
5. 主体刻画综合协议、后续补充对话提醒与模型构建进度（已完成并进入 `1.0.6`）
6. Teacher / Student 统一绑定协议（集合、主要函数、页面与安全回归已完成并进入 `1.0.6`）
7. 真人试采候选版本 `1.0.7` 上传（已完成，已被后续候选版替代）
8. 微信平台隐私核对、审核与发布
9. 组织真人教师和学生主体模型采集测试
10. 依据真实教师 / 儿童数据修复阻断问题并优化首次采集任务
11. Evidence Profile、Evidence Gap、矛盾/停滞诊断与半自动模型 revision 主链（已完成并进入 `1.0.7`）
12. 规则驱动持续模型自动更新（已部署，已用 TEST Student 完成云端自动激活与幂等验证）
13. 小程序开发候选版 `1.0.9` 上传（已完成）
14. 主体复现
15. 双主体互动
16. 模拟课堂
17. 实验验证

## 当前暂停项
- Targeted Supplement
- Unmatched 聚类
- 图片 / 视频等复杂多模态
- Student-M2 及长期演化策略

Targeted Supplement、Unmatched 聚类和更长期的节奏/回退策略继续暂停。Evidence Profile、Profile 内 Gap、矛盾/停滞状态与 Model Change Candidate 已进入持续采集派生链；已部署的 V1.0 在严格自动门槛满足时创建并激活新的 revision snapshot，未达门槛或矛盾 pending 时只保留证据与候选。当前学生 MVP 以语音为主，允许必要的人工观察文本或结构化记录，同时保持 Evidence 底层的模态无关性。

## Codex 工作规则
1. 修改代码前先阅读 `AGENTS.md`、`docs/ARCHITECTURE.md`、`docs/DEVELOPMENT_STATUS.md`、`docs/DATA_MODEL.md`。
2. 未经明确要求，不修改冻结的 T/S 模型框架。
3. 未经明确要求，不新增顶层概念或数据库集合。
4. 优先复用现有云函数和集合，不重复造轮子。
5. 所有数据库变更必须同步更新 `docs/DATA_MODEL.md`。
6. 所有功能开发完成后必须更新 `docs/DEVELOPMENT_STATUS.md`。
7. 云函数修改前先检查现有函数调用关系。
8. 不把前端传入的 `subject_id` 默认视为可信身份。
9. 不在前端保存密钥。
10. 重要写操作必须保持幂等。
11. 模型更新不得覆盖旧 snapshot。
12. Evidence Analysis 失败时必须保留原始记录和 Evidence。
13. 不为了“方便”把教师和学生写成两套重复底层逻辑。
14. 学生端不能简单复制教师端交互。
15. 遇到不确定的研究逻辑，先停止修改并提出问题，不自行发明规则。

## 当前一句话原则
**主体模型不是靠一次访谈“测出来”的，也不是靠日常数据自动“堆出来”的，而是通过“真实采集—证据识别—证据健康诊断—定向补充—跨时间验证—版本更新”逐步形成的。**
