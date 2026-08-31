# 数据采集小程序整体说明与模拟课堂路线对照

> 文档版本：V1.1
>
> 核对日期：2026-08-31
>
> 核对依据：当前本地代码、`AGENTS.md`、`docs/ARCHITECTURE.md`、`docs/DEVELOPMENT_STATUS.md`、`docs/DATA_MODEL.md`
>
> 当前候选版本：微信小程序开发版 `1.0.7`（已上传，尚未提交审核或正式发布）

## 1. 文档目的

本文系统说明当前“主体模型数据采集小程序”已经实现的产品功能、信息架构、主体模型框架、核心机制和数据流，并把它放回“智能课堂模拟与教学实验系统”的五阶段路线中定位。

本文采用以下状态口径，避免把研究设计写成已经上线的功能：

- **已实现**：当前代码中存在，且已有端到端或回归验证记录；
- **受控能力**：已有云函数或数据结构，但只能由研究者/管理员调用，没有普通用户前端入口；
- **保留但暂停**：已有设计或部分代码，当前不作为真人试采前置条件；
- **尚未开发**：模拟课堂后续阶段需要，但当前代码中没有完整业务闭环。

## 2. 项目整体定位

本项目不是教案生成器、教师或学生测评工具，也不是用大模型自由生成一段课堂文本后将其称为“模拟课堂”。完整路线是：

```text
阶段1 主体表征
  ↓
阶段2 主体复现
  ↓
阶段3 双主体互动
  ↓
阶段4 模拟课堂
  ↓
阶段5 实验验证
```

对应逻辑是：

```text
建人 → 验证像不像 → 人与人互动 → 完整课堂 → 模拟/真实实验验证
```

当前小程序集中完成的是**阶段1“主体表征”中的真人数据采集、证据识别、初始主体模型构建，以及持续证据到受控新版本草稿的基础链路**。它为未来模拟课堂提供教师和学生的身份、真实证据、证据健康状态、模型快照与可追溯版本关系，但当前本身不是课堂仿真引擎。

当前执行层面只保留三个基础对象：

1. 教学内容；
2. 教师主体；
3. 学生主体。

课堂不是第四个独立主体，而是教师、学生、教学内容与任务情境互动后形成的过程、轨迹和关系。

## 3. 当前系统边界

### 3.1 已经覆盖

- 微信用户登录与云端身份识别；
- School / Class 组织关系；
- Teacher / Student 独立研究主体预登记；
- 教师绑定码 + 教师编号双重校验；
- 学生绑定码 + 学号双重校验；
- 教师 T0 基本背景；
- 学生 S0 组织背景自动形成；
- 教师 13 项首次语音采集；
- 学生 17 项首次语音采集；
- 语音云存储与腾讯 ASR；
- 原始 Message / Voice 与 Evidence 分层保存；
- Teacher / Student Evidence Analysis；
- 教师和学生首次模型 draft 构建；
- Human Review 后转为 active；
- 当前模型安全展示；
- 教师两类持续记录；
- 学生“再说一说”持续采集；
- 持续语音内容对固定变量的 0—5 项路由；
- 持续 Evidence 的 Profile / Gap / Contradiction / Stagnation / Model Change Candidate 派生链；
- 受控 revision draft → Human Review → 新 active snapshot；
- 后续补充对话建议；
- 模型构建覆盖进度与雷达图；
- 数据库、原始音频、Evidence / Analysis、Model Snapshot 和源码的本地加密全量备份。

### 3.2 当前明确不做

- 教师或学生综合总分、排名、能力等级；
- 固定人格标签、心理诊断或学业诊断；
- 单条 Evidence 直接改写主体模型；
- 持续采集后无需研究人员复核就自动批准 Student-M1/M2 或 Teacher-T1/T2；
- 自动审批模型；
- 图片、视频和自动行为识别；
- 双主体自动互动；
- 完整课堂事件引擎；
- 模拟课堂实验控制与效果验证。

## 4. 角色、操作者与研究主体

系统把“正在操作微信的人”和“被采集、被建模的主体”严格分离。

| 对象 | 系统含义 | 是否是主体模型归属者 |
|---|---|---|
| `users` | 当前微信账号对应的平台用户 | 否 |
| Teacher Subject | 独立教师研究主体，使用 Teacher_ID | 是 |
| Student Subject | 独立学生研究主体，使用 Student_ID | 是 |
| Guardian | 使用家长微信帮助学生进入和采集的操作者 | 否 |
| researcher / admin | 受控登记、构建和审核操作者 | 否 |

关键约束：

- Teacher_ID / Student_ID 都不等于 OpenID、`user_id`、线下编号或绑定码；
- Guardian 只记录为 `operator_user_id`，学生 Voice、Message、Evidence、Analysis 和 Snapshot 的 `subject_id` 必须是 Student_ID；
- Student 不被设计成当前微信账号的登录角色；
- 教师和学生都需要先由研究团队线下预登记，点击入口不会临时创建新的 Subject；
- 教师、家长和学生的知情同意在线下以纸质方式完成，小程序不保存电子知情同意，也不把绑定行为解释为知情同意。

## 5. 组织与绑定机制

### 5.1 组织关系

```text
School
  ↓
Class
  ├─ Teacher Subject
  └─ Student Subjects
```

组织关系由以下集合表达：

- `schools`：学校；
- `classes`：班级；
- `class_memberships`：Teacher / Student Subject 与班级的成员关系；
- `subjects`：教师和学生研究主体主表。

教师和学生通过 Class 建立真实教育关系，不建立 `teacher_student_direct_relation`。一个教师未来可属于多个班，一个班也可有多个教师。

### 5.2 预登记

研究团队通过受控函数完成线下名单入库：

```text
registerTeacherForStudy
  → 校验 School / Class
  → 创建 Teacher Subject
  → 建立 teacher class_membership
  → 生成随机一次性 bind code
  → 保存 bind_code_hash + school-scoped teacher_no_hash

registerStudentForStudy
  → 校验 School / Class
  → 创建 Student Subject
  → 建立 student class_membership
  → 生成随机一次性 bind code
  → 保存 bind_code_hash + school-scoped student_no_hash
```

绑定码明文只在预登记成功时返回一次；数据库不保存绑定码、教师编号或学生学号明文。

### 5.3 微信绑定

正式前端统一调用 `bindSubjectByCode`：

```text
教师：bind_code + teacher_no
学生：bind_code + student_no
                ↓
云函数从 OPENID 解析当前 users.user_id
                ↓
标准化并分别计算 hash
                ↓
双重匹配同一 Subject
                ↓
校验 Subject / framework / School / Class membership
                ↓
事务创建 binding + bind code 置为 used
```

教师绑定写入 `identity_map`，并在绑定成功后将当前 `users.role` 设为 `teacher`；学生家长绑定写入 `guardian_student_bindings`，不把家长改成 student 角色。

绑定具备以下保护：

- 错误线下编号不会消耗正确绑定码；
- 一个已使用绑定码不能被另一微信再次使用；
- 同一微信重复提交已绑定主体时幂等返回；
- 同一 Subject 不允许同时被不同微信重复绑定；
- 存在重复绑定记录时返回异常，不随机选择一条；
- 普通前端不直接读取绑定集合或任何 hash 字段。

## 6. 正式页面与信息架构

`miniprogram/app.json` 当前注册 11 个正式业务页面：

| 页面 | 对象 | 当前职责 |
|---|---|---|
| `pages/role-select/` | 通用 | 教师采集与学生采集入口 |
| `pages/teacher-bind/` | 教师 | 绑定码 + 教师编号验证 |
| `pages/teacher-home/` | 教师 | T0、首次采集、持续记录、完善建议、当前模型、学生采集入口 |
| `pages/voice-chat/` | 教师 | 教师首次 13 项及教学反思/学生观察录音 |
| `pages/teacher-background/` | 教师 | T0 基本背景读取和保存 |
| `pages/teacher-model/` | 教师 | 当前 Teacher Model 展示 |
| `pages/student-bind/` | 学生家庭 | 绑定码 + 学号验证 |
| `pages/student-home/` | 学生家庭 | S0/主体信息、17 项进度、首次模型、提示、“再说一说” |
| `pages/student-collection/` | 学生 | 17 项儿童友好首次语音采集 |
| `pages/student-continuous/` | 学生 | 儿童友好的自然持续语音采集 |
| `pages/student-model/` | 学生家庭/研究 | Student-M0 安全摘要展示 |

`pages/index/` 与 `pages/example/` 是遗留 QuickStart 文件，已从正式 `app.json` 移除，并由上传忽略配置排除，不属于正式信息架构。

## 7. 教师端功能框架

### 7.1 教师入口与首页

```text
微信登录
  → getMySubjectBindings(teacher)
  → 已绑定：teacher-home
  → 未绑定：teacher-bind
```

Teacher Home 当前正式功能：

1. T0 基本信息；
2. 首次建模采集状态（13 项）；
3. 今日教学反思；
4. 学生观察记录；
5. 后续模型完善建议；
6. 当前教学思想模型；
7. 独立学生采集入口。

已清理的入口：

- 泛化“语音记录”入口；
- 尚未形成闭环的“我的记录”；
- “自由记录”正式入口。

底层仍兼容历史 `free_dialogue` 数据和旧链接，但正式首页只保留教学反思与学生观察两种持续记录情境。

### 7.2 T0 基本背景

教师通过 `teacher-background` 维护：

- 教龄；
- 最高学历；
- 专业背景；
- 当前任教学科；
- 当前任教年级；
- 曾任教年级与学科；
- 低年级教学经历；
- 其他教学经历；
- 培训经历。

T0 只作为主体模型背景，不评分。

### 7.3 13 项首次采集

教师首次任务按 `teacher_v1.0` 固定 13 个变量逐项采集。每项支持多次录音补充，确认后进入下一项；已保存 Session 和转写可恢复，避免中途退出丢失。

当前页面提交链到达：

```text
Task → Session → Voice → ASR → Message → Evidence → Progress
```

首次 Evidence Analysis、draft 构建与 Human Review 已有受控函数和已验证链路，但不是家长/教师页面中的自动审批动作。

### 7.4 教师持续记录

```text
教学反思 / 学生观察
  → 新建持续 Session
  → 一次录音
  → Voice + Message
  → 腾讯 ASR
  → analyzeTeacherEvidence(action = route_continuous)
  → 0—5 个变量匹配
  → 每个变量一条 Evidence
  → analyzeTeacherEvidence(action = analyze_batch)
  → advanceSubjectModel(refresh，异步)
  → Profile / Gap / Candidate
```

入口类型只表达采集情境，不直接决定变量。无可靠匹配时返回 `matches = []`，保留 Voice、Message、`continuous_record_id` 和 no-match 原因，不制造 Evidence。

持续 Evidence 不直接更新 active Teacher Model。达到规则门槛后自动形成 Candidate；只有受控研究调用才能生成 revision draft，Human Review 后才可成为新 active Model。

## 8. 学生端功能框架

### 8.1 学生入口与 Guardian 边界

```text
家长微信登录
  → getMySubjectBindings(student)
  → 已绑定：student-home
  → 未绑定：student-bind
```

家长是认证后的采集终端操作者，学生本人是独立 Student Subject。

### 8.2 S0 基本背景

S0 复用 `subject_background`，由 `ensureStudentBackground` 根据以下数据自动形成：

- Student Subject；
- School / Class；
- active student class membership；
- `grade` / `academic_year`（班级存在时）；
- `research_alias` / `student_display_code`。

S0 不保存 OpenID、Guardian user_id、绑定码、hash、学生学号或真实姓名。

### 8.3 17 项首次采集

学生首次采集暂以“一变量一项儿童友好语音任务”实现技术闭环。页面不显示 S1—S6、变量编号、Evidence、Analysis、分数或模型术语。

每题独立执行：

```text
Task
  → Session
  → MP3 Voice
  → ASR
  → Message
  → Student Evidence
  → Student Evidence Analysis
  → 完成当前任务
  → Progress 指向下一项
```

进度为 17/17 后，Student Home 显示首次采集已完成、首次建模结果入口和“再说一说”。

### 8.4 Student Continuous Collection V1.0

```text
Student Home
  → “再说一说”
  → student_continuous_record Session
  → Voice → ASR → Message
  → analyzeStudentEvidence(action = route_continuous)
  → 0—5 个 Student 变量
  → 0—5 条 Evidence
  → analyzeStudentEvidence(action = analyze_batch)
  → advanceSubjectModel(refresh，异步)
```

持续路由依据实际语音内容，不因入口或提示问题强行匹配变量。无匹配是合法结果；原始记录仍保留。持续 Evidence 不直接改 active Student-M0；达到门槛后只形成 Student-M1 Candidate / draft，人工审核前 current snapshot 不变。

## 9. 固定主体模型框架

### 9.1 Teacher V1.0

T0 为基本背景，不评分。T1—T5 共 13 个二级变量：

| 一级维度 | 二级变量 |
|---|---|
| T1 课程与学习目标取向 | T1-1 课程与学习价值理解；T1-2 学习结果判断 |
| T2 学生理解与诊断 | T2-1 学生已有认识理解；T2-2 学习困难诊断；T2-3 个体差异理解 |
| T3 教学策略与 PCK | T3-1 内容表征与任务设计；T3-2 提问与学习支架；T3-3 教学策略资源 |
| T4 互动与关系方式 | T4-1 提问与反馈方式；T4-2 学生自主与教师介入；T4-3 互动组织与差异关注 |
| T5 专业自我、适应与反思 | T5-1 专业自我与教学信念；T5-2 适应性调整与反思 |

### 9.2 Student V1.0

S0 为基本背景，不评分。S1—S6 共 17 个二级变量：

| 一级维度 | 二级变量 |
|---|---|
| S1 认知与已有经验 | S1-1 观察与信息提取；S1-2 已有经验与认知解释；S1-3 前概念与认知关联 |
| S2 思维与问题解决 | S2-1 比较与分类；S2-2 预测与解释；S2-3 证据与问题解决 |
| S3 学习与自我调节 | S3-1 任务专注与注意调节；S3-2 困难应对与策略调整；S3-3 自我监控与不确定性感知 |
| S4 表达与社会互动 | S4-1 表达与提问；S4-2 倾听与回应；S4-3 合作与观点调节 |
| S5 动机、情绪与自我效能 | S5-1 好奇与学习投入意愿；S5-2 学习自信与挫折反应 |
| S6 兴趣、活动经验与生活情境 | S6-1 兴趣领域；S6-2 活动与生活经验；S6-3 家庭学习支持情境 |

当前框架不得自行增加 T6 / S7、删除或合并变量，也不设置三级指标和综合总分。

## 10. 核心机制设计

### 10.1 原始记录、证据分析与模型分层

```text
原始层：Voice / Message
  ↓ 可追溯归档或内容路由
证据层：Evidence
  ↓ 单条独立分析
分析层：Evidence Analysis
  ↓ 跨证据综合
模型层：Model Snapshot
```

四层职责不能混合：

- Voice / Message 回答“主体原来实际说了什么”；
- Evidence 回答“哪段原始记录可能支持哪个变量”；
- Evidence Analysis 回答“是否相关、是否足够、能提取什么、有什么边界”；
- Model Snapshot 回答“在某一版本和时间点，如何综合描述当前主体”。

AI 解释不能覆盖原始转写，Evidence Analysis 也不能直接充当最终主体模型。

### 10.2 内容路由与分析分离

一段持续语音允许匹配 0—5 个变量。路由只说明“可能相关”，每条新 Evidence 仍要独立经过 Evidence Analysis，不能因为路由到某变量就自动判定为 relevant 或 usable。

### 10.3 Evidence Analysis 标准

教师与学生当前正式分析字段一致：

- `relevance_status`；
- `evidence_sufficiency`；
- `extracted_points`；
- `reasoning_basis`；
- `context`；
- `uncertainty`；
- 协议、模型、状态和时间元数据。

相关性枚举：

- `relevant`；
- `partially_relevant`；
- `irrelevant`；
- `uncertain`。

充分性枚举：

- `usable`；
- `weak`；
- `insufficient`。

固定关系：

- irrelevant / uncertain 必须对应 insufficient；
- usable 必须是 relevant / partially_relevant，且有原文可支持的提取点；
- 语义不清、疑似 ASR 问题或信息不足时允许 insufficient；
- 不允许从单条回答推断稳定人格、固定能力、心理诊断或排名。

### 10.4 Supportive Evidence

当前统一 supportive 定义为：

```text
relevance_status = relevant / partially_relevant
AND
evidence_sufficiency = usable / weak
```

irrelevant、uncertain 和 insufficient 不得帮助模型提高支持状态、构建覆盖或多情境覆盖。

### 10.5 主体刻画不是转写摘要

Teacher / Student 初始模型生成协议都要求跨证据综合，重点提炼：

- 发生的具体情境；
- 主体的关注、理解或判断；
- 判断依据；
- 实际行动与调整；
- 结果；
- 适用边界与不确定性。

模型描述不能把 ASR 转写或 `extracted_points` 简单拼接。证据只支持行为时，也不能反推深层信念。

### 10.6 快照和人工复核

```text
全部有效 Evidence + 最新有效 Analysis
  → AI 跨证据综合
  → 新 draft Model Snapshot
  → Human Review
  → 同一 snapshot 转 active
```

关键规则：

- 新模型先是 draft，不能自动 active；
- 已审批 active snapshot 不静默改写；
- 后续模型变化必须创建新 snapshot；
- Student 普通 Guardian 不能批准模型；
- 当前 Student 审批函数只允许 researcher / admin，或严格限定的 TEST 技术路径；
- Teacher 初始模型的生成与 approve 模式相互分离。

### 10.7 持续证据健康与模型版本候选

持续采集完成 Evidence Analysis 后，正式页面异步调用 `advanceSubjectModel(action = refresh)`：

```text
主体全部 active Evidence
  + 每条 Evidence 最新且字段一致的 active Analysis
  → 完整重建固定 13 / 17 个 Variable Evidence Profile
  → Profile 内 Evidence Gap / Contradiction / Stagnation
  → active snapshot 之后的新 continuous Evidence
  → Model Change Candidate
```

Profile 每次完整重算，不做 `usable_count += 1`。来源、模态、日期和情境覆盖只由 supportive Evidence 贡献；`unknown` modality 不帮助达到多模态条件。日期按中国标准时间自然日去重，情境保留分析原文并精确去重，因此 `context_count` 只是 V1.0 覆盖辅助指标，不是完成语义聚类后的标准化情境类别数量。

当前内嵌 Gap 类型包括：`no_evidence`、`insufficient_detail`、`single_time_point`、`single_context`、`single_source`、`stale_evidence`、`contradiction_pending`。Stagnation 只提示重复无 supportive、长期 weak、时间/情境重复或 60 天无 supportive 更新，不评价主体能力。

Model Change Candidate 只使用 current active snapshot 之后新增的 continuous supportive usable Evidence。同一变量至少 2 条，且 `contradiction_status != pending`，才可 `eligible_for_draft = true`。随后仍需研究端执行：

```text
build_draft
  → 新 revision draft（Teacher-T1 / Student-M1）
  → 必要时人工处理矛盾
  → Human Review
  → approve_draft
  → 新 active snapshot；旧 active 保留为 superseded
```

普通 Teacher / Guardian 页面只能触发 refresh，不能 build、resolve 或 approve。单条 Evidence、weak、irrelevant、uncertain、insufficient 都不能生成新版本。

### 10.8 模型页面信息结构

Teacher / Student 模型页采用统一顺序：

1. 100 字以内总体概览；
2. 模型构建进度百分比与一级维度雷达图；
3. 版本、状态和更新时间；
4. 一级维度；
5. 二级变量；
6. 当前状态；
7. 当前主体刻画；
8. 有内容时才显示不确定性。

Student 返回的是安全摘要，不含原始 Evidence、内部 reasoning、证据 ID、身份 hash、总分、排名或诊断。

### 10.9 构建进度不是评价分数

`getSubjectModelGuidance` 运行时计算 `construction_progress`，不写数据库。教师以 13 个变量、学生以 17 个变量作为固定分母。

每变量最高 100%：

| 条件 | 权重 |
|---|---:|
| 至少有一条 active Evidence | 20% |
| 至少有一条与 Evidence 一致的有效 Analysis | 20% |
| 至少有一条 supportive Evidence | 30% |
| 至少有两条 supportive Evidence | 15% |
| supportive Evidence 跨至少两个中国标准时间自然日 | 10% |
| supportive Evidence 跨至少两个 context 或 source type | 5% |

该百分比只表示“固定维度的数据采集和证据底座覆盖程度”，不代表能力、水平、模型质量或置信度。它不会降低 Evidence 的相关性、充分性或人工审核门槛。

### 10.10 后续补充对话提醒

`getSubjectModelGuidance` 只读当前 Evidence、最新 active Analysis 和 active/draft snapshot，根据以下缺口排序 1—3 个自然对话提示：

- 尚无 supportive Evidence；
- 只有 weak 线索；
- 只有一条 usable Evidence；
- 情境覆盖单一；
- 时间点覆盖单一；
- 需要跨情境继续验证。

提示只负责开启对话，不把后续语音硬绑定到提示变量。实际内容仍需重新路由，允许匹配其他变量或 0 匹配。`getSubjectModelGuidance` 本身只读；持续 Analysis 完成后的 `advanceSubjectModel(refresh)` 才会把规则缺口写入 Profile，仍不创建 supplement candidate。

### 10.11 幂等、失败保留与断点继续

- 首次采集按任务独立保存，进度推进前必须已有 Evidence 和 Analysis（学生）或完成原始 Evidence 归档（教师）；
- Student 首次任务完成校验所有本题 Evidence 都已有 active Analysis；
- 同一首次 Session 可恢复已有转写；
- ASR 成功结果会直接复用，避免重复识别和重复计费；
- 新 ASR 使用云存储临时签名 URL 直接交给腾讯一句话识别，避免云函数下载、Base64 和二次上传音频；
- 多变量 Analysis 通过单次 batch 调用、每批最多 3 条并发，完整 Analysis 独立落库但不重复放进前端回包；
- Evidence Health 异步精简刷新，不阻塞用户看到提交成功；
- ASR 失败会把 `voice_records.asr_status` 记为 failed，原始云文件和 Voice 记录不删除；
- 持续路由使用确定性“voice + variable”文档 ID，重试不重复创建同一 Evidence；
- 路由或 Analysis 失败时保留原始 Voice / Message；
- `matches = []` 不制造 Evidence，但保留 no-match 原因；
- Evidence Analysis 失败不能回滚或丢弃原始 Evidence。

### 10.12 当前语音技术边界

教师、学生首次采集和学生持续采集均使用：

- `wx.getRecorderManager`；
- 最长 60 秒；
- 16 kHz；
- 单声道；
- 48 kbps；
- MP3。

录音上传至 CloudBase `voice/{operator_user_id}/{timestamp}.mp3`。`saveVoiceRecord` 再从已授权 Session 确定真正的 `subject_id`，不能由前端随意指定。腾讯一句话识别使用 `16k_zh`，当前单文件还受 3 MB 检查限制。

新成功转写会记录临时 URL、ASR 请求和总耗时的毫秒指标，但临时 URL 本身不保存或返回。冷启动、AI 路由和新 Analysis 仍可能需要数秒；性能优化不降低 Evidence Analysis 或模型采纳门槛。

2026-08-31 URL ASR 回归中，同一 TEST MP3 的临时 URL 获取为 489ms、腾讯 ASR 请求为 534ms、云函数内部总计 1341ms；客户端观察到 5839ms，差额主要反映该次云函数冷启动与调用链固定开销。回归临时 Voice / Message 已删除，原文件和研究证据未改动。

### 10.13 隐私与权限

- 重要研究集合保持 ADMINONLY，普通前端通过云函数访问；
- 前端不保存 ASR SecretId / SecretKey；
- 绑定接口不返回线下编号、明文 code 或 hash；
- Guardian 不能读取其他 Student；
- Guardian 不能直接读取完整内部 Student-M0；
- 教师不能因教师身份越权读取任意 Student；
- TEST 标记从 Subject 继承，真人主体不能由前端伪造为 TEST；
- 正式页面不调用模拟转写或批量 TEST 数据工具。

## 11. 当前主要数据集合

### 11.1 已实际使用

| 层次 | 集合 | 职责 |
|---|---|---|
| 用户 | `users` | 微信账号与平台用户 |
| 身份 | `identity_map` | 微信用户与 Teacher Subject 绑定 |
| 组织 | `schools` | 学校 |
| 组织 | `classes` | 班级 |
| 组织 | `class_memberships` | Teacher / Student Subject 的班级成员关系 |
| 绑定 | `teacher_bind_codes` | 教师一次性绑定凭据 hash |
| 绑定 | `student_bind_codes` | 学生一次性绑定凭据 hash |
| 绑定 | `guardian_student_bindings` | Guardian operator 与 Student Subject |
| 研究主体 | `subjects` | Teacher / Student Subject 主表 |
| 背景 | `subject_background` | T0 / S0 |
| 任务 | `collection_tasks` | 教师 13 项、学生 17 项任务配置 |
| 进度 | `collection_progress` | 首次采集断点与完成状态 |
| 会话 | `sessions` | 首次或持续采集会话 |
| 原始记录 | `messages` | ASR 文本与会话消息 |
| 原始记录 | `voice_records` | 云文件、时长、ASR 和持续提交状态 |
| 证据 | `evidence` | 变量级可追溯研究证据 |
| 分析 | `evidence_analysis` | 单条 Evidence 的正式分析 |
| 证据健康 | `variable_evidence_profiles` | 变量级 Profile、内嵌 Gap、矛盾与停滞状态 |
| 模型候选 | `model_change_candidates` | active snapshot 之后的新证据变化候选 |
| 模型 | `model_snapshots` | draft / active / 历史主体模型版本 |
| 边界保留 | `consents` | 集合保留，当前纸质知情同意流程不使用 |

最近一次加密备份生成时盘点了当时存在的 19 个业务集合；随后新增 `variable_evidence_profiles` 与 `model_change_candidates`，当前数据面为 21 个业务集合。备份工具会通过实际集合自动枚举纳入这两个集合；下一次执行时还应同步把备份注册表中的分类从 `planned` 调整为 `research`，并在一致性报告中明确列出。

### 11.2 设计或代码保留但当前暂停

| 集合/机制 | 当前状态 |
|---|---|
| `collection_events` | 计划，未创建 |
| `supplement_candidates` | 计划，未创建 |
| `media_records` | 多模态后续，未创建 |
| `behavior_records` | 行为观察后续，未创建 |

## 12. 主要云函数分工

### 12.1 登录、主体与绑定

| 云函数 | 状态 | 职责 |
|---|---|---|
| `login` | 已实现 | 通过 OPENID 创建/更新 `users` |
| `registerTeacherForStudy` | 受控 | 预登记 Teacher Subject 和绑定码 |
| `registerStudentForStudy` | 受控 | 预登记 Student Subject 和绑定码 |
| `bindSubjectByCode` | 正式 | Teacher / Student 统一双重绑定 |
| `getMySubjectBindings` | 正式 | 返回当前微信自己的安全绑定摘要 |
| `ensureTeacherSubject` | 正式 | 只读已有教师映射，不自动创建主体 |
| `ensureStudentBackground` | 正式 | 从组织记录幂等形成 S0 |
| `bindStudentByCode` / `getMyStudentBindings` | 历史兼容 | 旧 Student Binding 接口 |

### 12.2 首次采集

| 云函数 | 对象 | 职责 |
|---|---|---|
| `initTeacherCollectionTasks` | 教师 | 初始化 13 项任务配置 |
| `initStudentCollectionTasks` | 学生 | 初始化 17 项任务配置 |
| `getNextTeacherCollectionTask` | 教师 | 建立/读取教师进度与当前任务 |
| `getNextStudentCollectionTask` | 学生 | 授权后建立/读取学生进度与当前任务 |
| `createSession` | 共用 | 创建/恢复首次或创建持续 Session |
| `saveVoiceRecord` | 共用 | 从 Session 确定 Subject，写 Voice + Message |
| `transcribeVoice` | 共用 | 腾讯 ASR，回写 Voice 与 Message |
| `createStudentTaskEvidence` | 学生 | 为本题原始表达建立 Evidence |
| `completeStudentCollectionTask` | 学生 | 校验 Evidence/Analysis 后推进进度 |
| `completeTeacherCollectionTask` | 教师 | 归档本题 Evidence 后推进进度 |

### 12.3 证据、模型与提示

| 云函数 | 状态 | 职责 |
|---|---|---|
| `analyzeTeacherEvidence` | 正式 | 教师持续路由、单条与批量 Teacher Evidence Analysis |
| `analyzeStudentEvidence` | 正式 | 学生持续路由、单条与批量 Student Evidence Analysis |
| `advanceSubjectModel` | 正式/受控 | 普通采集端 refresh；研究端 build_draft、矛盾处理和 approve_draft |
| `analyzePendingTeacherEvidence` | 辅助 | 只读教师 pending Evidence 列表 |
| `buildTeacherInitialModel` | 受控 | 教师 draft 构建及指定 draft 审批模式 |
| `buildStudentInitialModel` | 受控 | Student-M0 draft 构建 |
| `approveStudentInitialModel` | 受控 | Student-M0 Human Review 后转 active |
| `getTeacherCurrentModel` | 正式只读 | 当前 active Teacher Model |
| `getStudentCurrentModel` | 正式只读 | 当前 Guardian/研究者安全 Student Model 摘要 |
| `getSubjectModelGuidance` | 正式只读 | 构建进度与后续补充提示 |
| `submitTeacherContinuousRecord` | 遗留端点 | 无正式前端入口；正式页改用分析函数长时路由 |
| `submitStudentContinuousRecord` | 遗留端点 | 无正式前端入口；正式页改用分析函数长时路由 |
| `rebuildVariableEvidenceProfile` | 诊断兼容 | 单变量 V1.0 工具保留；正式全主体主链使用 advanceSubjectModel |

## 13. 端到端数据流转

### 13.1 Teacher Subject 建立与绑定

```text
线下纸质知情同意与参与名单
  → School / Class
  → registerTeacherForStudy
  → subjects(teacher_v1.0)
  → class_memberships(teacher)
  → teacher_bind_codes(hash only)
  → 教师输入 bind code + teacher_no
  → bindSubjectByCode
  → identity_map + users.role=teacher + code=used
  → teacher-home
```

### 13.2 Student Subject 建立与绑定

```text
线下纸质知情同意与参与名单
  → School / Class
  → registerStudentForStudy
  → subjects(student_v1.0)
  → class_memberships(student)
  → student_bind_codes(hash only)
  → 家长输入 bind code + student_no
  → bindSubjectByCode
  → guardian_student_bindings + code=used
  → student-home
```

### 13.3 通用语音原始记录链

```text
录音临时文件
  → wx.cloud.uploadFile
  → cloud://.../voice/{operator_user_id}/{timestamp}.mp3
  → saveVoiceRecord
      ├─ messages(content='')
      └─ voice_records(asr_status=pending)
  → transcribeVoice
      ├─ 获取短时云存储签名 URL
      ├─ 腾讯 ASR 直接读取 URL
      ├─ voice_records.transcript + asr_status + 分段耗时
      └─ messages.content
```

### 13.4 学生首次任务完整链

```text
getNextStudentCollectionTask
  → createSession(initial_interview)
  → Voice / ASR / Message
  → createStudentTaskEvidence
  → analyzeStudentEvidence(save_analysis=true)
  → completeStudentCollectionTask
  → collection_progress 下一题或 17/17
```

### 13.5 持续记录完整链

```text
持续 Session
  → Voice / ASR / Message
  → 内容路由（0—5 个变量）
  ├─ 0 匹配：保留原始记录和 no-match reason
  └─ N 匹配：每变量创建一条 Evidence
                 ↓
              analyze_batch（每批最多3条并发）
                 ↓
              每条独立 Evidence Analysis 落库
                 ↓
              advanceSubjectModel(refresh，异步精简回包)
                 ↓
              Profile + Gap + Contradiction + Stagnation
                 ↓
              0—多个 Model Change Candidate
```

### 13.6 初始模型链

```text
T0/S0 + 完整首次采集进度
  + 全部 active initial Evidence
  + 每条最新有效 Evidence Analysis
  → 过滤 supportive Evidence
  → 固定 13/17 变量跨证据综合
  → overview_summary + dimensions + variables
  → model_snapshots(status=draft)
  → Human Review
  → 同一 snapshot status=active
  → getTeacherCurrentModel / getStudentCurrentModel
```

### 13.7 持续证据版本链

```text
当前 active snapshot
  + snapshot 之后的新 continuous supportive usable Evidence
  → 同变量不足2条：只保留 Profile / Gap / Candidate，不生成 draft
  → 同变量至少2条且无 pending contradiction
  → advanceSubjectModel(build_draft，受控)
  → Teacher-T1 / Student-M1 revision draft
  → resolve_contradiction（需要时，受控）
  → Human Review
  → advanceSubjectModel(approve_draft，受控)
  → 新 active snapshot
  → 旧 active snapshot 保留为 superseded
```

这一链路是“半自动形成候选、人工控制版本”的机制，不是持续语音提交后自动改变模型。正式采集页面没有 build / resolve / approve 入口。

## 14. 数据追溯主键关系

一条真实语音可以沿以下关系回溯：

```text
Subject
  ↓ subject_id
Session
  ↓ session_id
Voice Record ── file_id ──→ Cloud Storage MP3
  ↓ message_id
Message / Transcript
  ↓ voice_id + message_id + session_id
Evidence（一个或多个变量）
  ↓ evidence_id
Evidence Analysis
  ↓ source_evidence_ids / source_analysis_ids
Model Snapshot
```

这条追溯链是未来主体复现、模型解释、争议复核和实验审计的基础。

## 15. 全量备份机制

本地管理员工具位于 `tools/xueban-backup/`，不进入小程序包，也不部署备份云函数。

当前 V1.0 已实现：

- 枚举并导出全部实际集合；
- 独立枚举 `voice/` 云存储，不只依赖数据库引用；
- 保存全部 Teacher / Student、draft / active / 历史 Model Snapshot；
- 保存 Voice → Message → Evidence → Analysis → Snapshot 引用检查；
- 保存云函数元数据和 Git bundle；
- 每个文件计算 SHA-256；
- 生成 GPG AES-256 加密归档；
- 离线解密和完整性校验。

首次真实全量备份结果：19 个集合、631 条文档、65 个 MP3、2 个 active Model Snapshot，备份期间源清单一致，`fatal = 0`、`restorable = true`。

尚需管理动作：备份密钥必须再复制到独立离线介质；正式恢复只能在新的空白验证环境先演练。

## 16. 当前验证状态

| 能力 | 当前状态 |
|---|---|
| Teacher Binding | 代码、权限、错误凭据和兼容回归已通过；全新微信正确凭据仍建议做一次烟雾测试 |
| Teacher T0 | 已完成 |
| Teacher 13/13 | 已完成 |
| Teacher Evidence / Analysis | 已完成并有真实持续语音验证 |
| Teacher draft / Human Review / active | 已完成 |
| Teacher Current Model | 已完成 |
| Student Binding | 已完成 |
| Student S0 | 已完成 |
| Student 17/17 | 已完成技术闭环 |
| Student Voice / ASR | 已完成真机验证 |
| Student Evidence / Analysis | 已完成 |
| Student-M0 draft / Human Review / active | 已完成 TEST 闭环 |
| Student Continuous | 已完成真机录音、路由、Evidence 和 Analysis 验证 |
| Evidence Health / Candidate | 已完成 Teacher 13 + Student 17 Profile 和 5 条 Candidate 实测 |
| 受控 revision draft / Human Review | 正向 dry-run 已生成 Student-M1 / 1.1 草稿预案且未落库；正式真人 draft 与审核质量仍待验证 |
| 模型构建进度/雷达图 | 已完成，只读运行时计算 |
| 后续补充对话提醒 | 已完成，只读运行时计算 |
| 微信开发版本 | `1.0.7` 已上传 |
| 微信审核 | 尚未提交 |
| 正式发布 | 尚未发布 |

当前已验证数据不应被理解为正式研究效果结论；TEST Student 的 active 模型只证明技术链路可用。

Evidence Health 当前真实回归基线：教师 13 个 Profile、27 个 open Gap、4 个 pending Candidate，其中 1 个达到 draft 门槛；TEST Student 17 个 Profile、41 个 open Gap、1 个 pending Candidate，未达到门槛。数据面共 30 个唯一 Profile 和 5 个唯一 Candidate，无重复；Teacher active snapshot `MS_MT873ZQI_9PEUL`、Student active snapshot `MS_MTBMDOF7_0MNQU` 均未改变。

另以 2 条临时 TEST supportive usable continuous Evidence 完成正向门槛验证：`build_draft(dry_run=true)` 返回 `would_create = true`，生成 Student-M1 / version 1.1 草稿预案，但 `draft_created = false`，预案 snapshot 未落库；临时 2 条 Evidence 与 2 条 Analysis 已精确删除。

## 17. 对模拟课堂整体构建的贡献

当前小程序已经为后续模拟课堂提供以下基础资产：

| 当前资产 | 对未来模拟课堂的作用 |
|---|---|
| 独立 Teacher_ID / Student_ID | 使模拟对象不依赖微信账号 |
| School / Class / membership | 提供真实组织与师生情境边界 |
| 原始 Voice / Message | 保留主体真实表达和可复核材料 |
| Evidence / Analysis | 把原始数据转换为可追溯变量证据 |
| Variable Evidence Profile / Gap | 表达各变量当前证据覆盖、缺口、矛盾与停滞状态 |
| Model Change Candidate | 把 active snapshot 之后可能引起变化的新证据组织为可审核候选 |
| active Model Snapshot | 提供某一时间点可版本化的主体状态输入 |
| context / uncertainty | 限制未来 Agent 不能脱离证据边界自由发挥 |
| Human Review | 防止 AI 自动生成直接成为研究事实 |
| 构建进度与补充提示 | 帮助发现数据覆盖空白并持续采集 |
| 全量备份 | 支持科研审计、迁移与长期保存 |

也就是说，当前系统完成的是未来模拟课堂的“主体证据和模型输入层”，而不是“互动运行层”。

## 18. 距离模拟课堂还缺什么

### 18.1 阶段2：主体复现（尚未形成完整闭环）

需要在 active snapshot 基础上验证“模型生成的教师/学生反应是否像真实主体”，至少还需：

- 主体行为/话语生成接口；
- 受控情境输入；
- 真实主体对照材料；
- 研究者与本人相似性评审；
- 不一致原因记录；
- 模型版本选择与复现评测集；
- 禁止模型越过 Evidence 与 uncertainty 边界的约束。

### 18.2 阶段3：双主体互动（尚未开发）

需要：

- Teacher Agent 与 Student Agent 的角色状态；
- 轮次、发言、观察和行动协议；
- 教学内容/任务对象；
- 互动历史与短期状态；
- 双方模型版本固定；
- 事件记录与可重放机制；
- 互动安全和中止规则。

### 18.3 阶段4：模拟课堂（尚未开发）

需要：

- 完整课堂情境与任务编排；
- 教学内容结构；
- 多学生或学生群体表示；
- 时间推进与课堂事件引擎；
- 教师决策、学生响应和反馈循环；
- 课堂轨迹、关系和状态变化记录；
- 可重放、可比较、可解释的仿真运行；
- 真实课堂与模拟课堂的对照接口。

### 18.4 阶段5：实验验证（尚未开发）

需要：

- 明确研究问题与实验设计；
- 自变量、控制变量和结果指标；
- 仿真条件与真实条件对照；
- 重复运行和随机性管理；
- 统计分析与效度检验；
- 伦理、撤回、保存期限和未成年人数据治理；
- 实验日志、模型版本、代码版本和数据版本共同归档。

## 19. 持续证据健康与版本机制在整体路线中的位置

以下主链已进入正式持续采集派生流程：

```text
Evidence
  → Variable Evidence Profile
  → Evidence Gap
  → Contradiction / Stagnation Diagnosis
  → Model Change Candidate
  → 受控 revision draft
  → Human Review
  → New Model Snapshot
```

`advanceSubjectModel(refresh)` 已负责 Profile、内嵌 Gap、Contradiction、Stagnation 与 Candidate；`getSubjectModelGuidance` 仍只提供只读补充提示和构建进度。Targeted Supplement 状态机和 Unmatched 自动聚类继续暂停。新模型不是全自动：同一变量至少两条新 supportive usable continuous Evidence、无 pending contradiction 才可由研究端生成 draft，随后仍需 Human Review。

## 20. 当前总体完成度判断

### 已完成并有端到端验证

- Teacher Subject Binding、T0、13 项首次采集和 Teacher 初始模型；
- Student Subject Binding、S0、17 项首次采集和 Student-M0；
- Teacher / Student Voice、ASR、Evidence、Evidence Analysis；
- Human Review 与 active snapshot；
- Teacher / Student 当前模型展示；
- Teacher / Student Continuous Collection；
- Teacher / Student Evidence Profile、Gap、Stagnation 与 Model Change Candidate；
- 受控持续证据 revision draft / approval 接口及权限边界；
- URL ASR、批量 Analysis 与异步健康层性能优化；
- 构建进度、雷达图和补充对话提醒；
- 本地加密全量备份。

### 已有代码但属于受控或遗留能力

- Teacher / Student 研究主体预登记；
- Teacher / Student 初始模型构建与审批；
- pending Teacher Evidence 批量分析辅助；
- 历史 Student Binding 接口；
- 独立 Teacher / Student continuous submit 旧端点；
- TEST 技术辅助函数；
- 单变量 Evidence Profile 诊断兼容函数。

### 只有设计或当前暂停

- Targeted Supplement 状态机；
- Unmatched 聚类；
- 无 Human Review 的全自动模型更新；
- Student-M2 / Teacher-T2 长期演化与回退策略；
- 多模态 Collection Event、图片、视频和行为记录。

### 尚未开发

- 主体复现评测；
- 双主体互动；
- 模拟课堂引擎；
- 模拟/真实教学实验验证平台。

## 21. 当前最合理的近期顺序

在不扩大研究架构的前提下，近期顺序应是：

1. 完成微信公众平台隐私保护指引核对；
2. 提交 `1.0.7` 审核并在通过后发布；
3. 用全新微信账号完成教师正确绑定烟雾测试；
4. 组织真人教师、家长和学生试采；
5. 根据真实语音、ASR、交互负担和模型 draft 质量修复阻断问题；
6. 形成主体复现的验证方案后，再进入阶段2；
7. 用真人持续记录验证 Candidate 与 revision draft 质量，不以提高覆盖率为由降低证据门槛。

## 22. 关键代码位置

### 小程序

- 环境与启动：`miniprogram/app.js`、`miniprogram/app.json`
- 身份入口：`miniprogram/pages/role-select/`
- Teacher：`teacher-bind/`、`teacher-home/`、`teacher-background/`、`voice-chat/`、`teacher-model/`
- Student：`student-bind/`、`student-home/`、`student-collection/`、`student-continuous/`、`student-model/`
- 雷达图：`miniprogram/utils/model-progress-radar.js`

### 云函数

- 身份与绑定：`login`、`registerTeacherForStudy`、`registerStudentForStudy`、`bindSubjectByCode`、`getMySubjectBindings`
- 采集：`createSession`、`saveVoiceRecord`、`transcribeVoice`
- Teacher：`completeTeacherCollectionTask`、`analyzeTeacherEvidence`、`buildTeacherInitialModel`、`getTeacherCurrentModel`
- Student：`createStudentTaskEvidence`、`completeStudentCollectionTask`、`analyzeStudentEvidence`、`buildStudentInitialModel`、`approveStudentInitialModel`、`getStudentCurrentModel`
- 持续证据健康与版本：`advanceSubjectModel`（refresh / status / build_draft / resolve_contradiction / approve_draft）、`rebuildVariableEvidenceProfile`（单变量诊断兼容）
- 通用只读诊断：`getSubjectModelGuidance`

### 文档与运维

- 总体约束：`AGENTS.md`
- 架构：`docs/ARCHITECTURE.md`
- 进度：`docs/DEVELOPMENT_STATUS.md`
- 数据结构：`docs/DATA_MODEL.md`
- 备份设计：`docs/BACKUP_DESIGN.md`
- 备份工具：`tools/xueban-backup/`

## 23. 一句话总结

当前数据采集小程序已经跑通“线下预登记与主体绑定 → 真人语音采集 → 原始记录保存 → 变量 Evidence → Evidence Analysis → 初始 draft → Human Review → active Model Snapshot → 持续 Evidence Health → Model Change Candidate → 受控 revision draft”的 Teacher / Student 主体表征基础链；它已经具备模拟课堂所需的主体证据、证据健康和可版本化模型输入基础，但正式持续模型新版本仍需真人证据与人工审核验证，主体复现、双主体互动、完整课堂仿真和实验验证也仍属于后续阶段。
