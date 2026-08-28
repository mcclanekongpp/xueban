# AGENTS.md

## 项目名称
智能课堂模拟与教学实验系统

## 项目定位
本项目不是教案生成器、教师/学生测评系统，也不是把大模型自由生成包装成“真实课堂”。

项目目标是：基于真实教师和真实学生的持续证据，构建可解释、可修正、可版本化的主体模型；在此基础上逐步开展主体复现、双主体互动、模拟课堂和真实教学实验验证。

当前工作重点位于五阶段路线的**阶段1：主体表征**。

教师首次模型 MVP、Student Binding MVP、Student Initial Model MVP 与 Student Continuous Collection V1.0 均已完成端到端验证。教师持续语音提交超时阻断已修复并完成真实记录恢复验证；小程序真人试采候选版 `1.0.4` 已于 2026-08-28 上传为微信小程序开发版本，尚未提交审核或正式发布。当前最高工作目标是完成微信公众平台隐私保护指引核对、提交审核和上线，然后组织真人教师和学生主体模型采集测试；后台模型完善机制继续暂停，除非阻断实地采集。

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

真人试采正式前端通过 `analyzeTeacherEvidence(action = route_continuous)` 复用 60 秒运行环境完成内容路由，再逐条执行同一函数的 Evidence Analysis；默认 3 秒的独立 `submitTeacherContinuousRecord` 保留为无正式前端入口的旧端点，避免 AI 路由被短超时中断。

## 教师—学生通用模型完善机制
统一底座：Collection Event → Evidence → Evidence Analysis → Evidence Profile → Evidence Gap → Targeted Supplement → Unmatched Monitoring → Stagnation Diagnosis → Model Change Candidate → Model Snapshot。

共用的是机制，不共用变量定义与采集内容。

## 多模态原则
系统底层从一开始支持：voice / text / image / video / behavior / file。

当前优先级：教师以语音为主；学生 V1.0 以语音 + 观察记录为主；图片/作品后续接入；视频非默认采集方式，仅在明确研究需要时使用。

Evidence 必须保持模态无关：某条原始记录或某个真实采集事件，对某一个主体变量形成的一条可追溯研究证据。

## 学生采集原则
学生首次建模：儿童自然访谈 + 行为观察 + 监护人补充。禁止把低年级儿童采集做成长问卷、长书写任务。监护人信息是独立证据来源，不是儿童回答的“标准答案”。

## Student Binding MVP
- 教师、家长与学生知情同意均在线下以纸质方式完成；小程序不提供电子知情同意页面，也不把绑定行为解释为知情同意。
- 研究团队在线下准备阶段登记 School / Class / Student Subject 并预生成随机绑定码；教师只负责把正确绑定码线下发给对应参与学生家长。
- 学生主体使用独立 Student_ID：`subject_type = student`、`model_framework = student_v1.0`。Student_ID 不等于 OpenID、user_id、学号或绑定码。
- 学校与班级关系使用 `schools`、`classes`、`class_memberships`；教师与学生均通过 Class_ID 建立组织关系，不创建 teacher_student_direct_relation。
- 家长端必须同时提交 bind code 与 student_no；云函数分别标准化并哈希，只有二者指向同一 Student Subject 才能绑定。
- Guardian WeChat 只是认证后的采集终端操作者。`guardian_student_bindings` 连接 `users.user_id` 与 Student_ID，但不得修改 `users.role`；后续学生 Voice / Message / Evidence / Model Snapshot 必须归属 Student_ID。
- `schools`、`classes`、`class_memberships`、`student_bind_codes`、`guardian_student_bindings` 均为 ADMINONLY，只能经云函数或管理员访问。
- 当前正式入口为“学生采集”：已有 active binding 进入 Student Home，否则进入 Student Bind；不增加“我是学生”登录角色。

## Student Initial Model MVP
- 学生 S0 复用 `subject_background`，由 Student Subject、School、Class 与 membership 自动形成；不保存 OpenID、guardian user_id、绑定码、学号或真实姓名。
- `student_v1.0` 首次采集暂以 17 个儿童友好语音任务覆盖 S1-1 至 S6-3。任务提示保存在 `collection_tasks`，前端不显示变量编号、Evidence、评分或模型术语。
- 每题独立执行 Session → Voice → ASR → Message → Evidence → Evidence Analysis → Progress，允许中途退出后从下一未完成任务继续。
- 学生原始记录、Evidence、Evidence Analysis 与 Model Snapshot 的 `subject_id` 均为 Student_ID；Guardian user 只记录为 `operator_user_id`，不得作为被建模主体。
- Student Evidence Analysis V1.0 使用 `relevance_status`、`evidence_sufficiency`、`extracted_points`、`reasoning_basis`、`context`、`uncertainty`，不做心理诊断、排名、总分或固定人格判断。
- `buildStudentInitialModel` 每次基于全部有效首次 Evidence Analysis 生成包含 S1—S6、17 变量的 draft Student-M0；不足变量仍保留，不自动变为 active。
- `approveStudentInitialModel` 完成受控人工确认。`getStudentCurrentModel` 只向 active Guardian 或 researcher / admin 返回安全摘要；Student Home 在 17/17 后提供“查看首次建模结果”，`student-model` 显示 draft / active 状态及 S1—S6、17 变量的当前描述和不确定性，不返回原始 Evidence、内部 reasoning、分数、排名或诊断。
- TEST Student 已完成 1 条真机录音/ASR 与 16 条明确 `is_test=true` 的模拟技术记录，验证 17/17、draft、人工审批、active 与当前模型展示全链路。

## Student Continuous Collection V1.0
- 首次采集 17/17 后，Student Home 提供儿童友好的“再说一说”入口，不显示变量编号、Evidence 或模型更新术语。
- 每次录音独立提交：Student continuous Session → Voice → ASR → Message → 内容路由 → 0—5 条 Student Evidence → 每条 Evidence 使用 Student Evidence Analysis V1.0 独立分析。
- 正式页面通过 `analyzeStudentEvidence(action = route_continuous)` 复用已配置的长时运行环境完成路由，再以 `save_analysis = true` 逐条分析；所有调用都校验当前 user 对目标 Student_ID 的 active Guardian binding。
- Voice、Message、Evidence 与 Evidence Analysis 的 `subject_id` 始终是 Student_ID；Guardian user 只记录为 `operator_user_id`。
- `matches = []` 时不制造 Evidence，Voice、Message 与 `continuous_record_id` 仍保存；路由或分析失败时前端保留当前 voice_id 和 transcript，允许重试。
- Student Continuous Evidence 只进入 Evidence 层，不修改 active Student-M0，不创建 Student-M1，也不改变 current snapshot。
- TEST Student 已完成一次 12.16 秒真机持续录音、腾讯 ASR、3 条路由 Evidence 与 3 条正式 Analysis 的端到端验证。

## 真人试采版本边界
- 正式小程序包不暴露 QuickStart、配置助手、批量 Student-M0 或其他 TEST 入口；本地 TEST 脚本可以保留，但真人流程不得调用模拟记录。
- 真人 Student 完成 17/17 后只允许生成 draft Student-M0，不得由 Guardian 页面自动批准；active 模型必须经 researcher / admin 受控审核。
- Teacher 初始模型生成与人工批准保持分离，真人采集入口不得调用自动批准捷径。
- 普通 Guardian 只能访问本人 active binding 对应的采集状态、安全字段和 Student-M0 安全摘要，不能直接读取研究集合、原始 Evidence、内部 reasoning、哈希身份字段或完整内部 snapshot。
- 版本 `1.0.4` 当前仅为已上传开发版本；微信公众平台隐私保护指引确认、提交审核和发布仍需管理员在平台完成。`1.0.3` 已被本候选版本替代，不再用于送审。

## 数据与隐私原则
1. 身份信息与研究主体信息分离。
2. 原始证据与模型结论分离。
3. 模型快照不覆盖历史版本。
4. 学生研究身份使用独立 Student_ID，不直接使用 OpenID。
5. 学生主体与当前操作小程序的用户身份必须分离。
6. 重要集合仅由云函数访问。
7. 正式实地研究前必须补齐知情同意、数据保存期限、撤回规则和伦理流程。

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
3. Student Initial Model MVP：S0 → 17 项首次采集 → Voice / ASR → Evidence / Analysis → Draft → Human Review → Active → Current Model（已完成）
4. Student Continuous Collection V1.0（已完成）
5. 真人试采候选版本 `1.0.4` 上传（已完成，待平台隐私核对、审核与发布）
6. 组织真人教师和学生主体模型采集测试
7. 依据真实教师 / 儿童数据修复阻断问题并优化首次采集任务
8. 再评估 Evidence Profile、Evidence Gap 和模型持续演化机制的恢复时点
9. 主体复现
10. 双主体互动
11. 模拟课堂
12. 实验验证

## 当前暂停项
- variable_evidence_profiles 的进一步优化
- Evidence Gap
- Targeted Supplement
- Stagnation Diagnosis
- Unmatched 聚类
- Model Change Candidate
- 自动模型版本更新
- 图片 / 视频等复杂多模态
- 学生持续模型演化

这些设计和已有代码继续保留；除非阻断教师或学生首次模型端到端流程，否则暂不继续开发。当前学生 MVP 以语音为主，允许必要的人工观察文本或结构化记录，同时保持 Evidence 底层的模态无关性。

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
