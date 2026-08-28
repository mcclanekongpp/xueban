# DEVELOPMENT_STATUS.md

## 当前总状态
当前处于：**阶段1 主体表征**。

教师首次主体模型 MVP、Student Binding MVP、Student Initial Model MVP 与 Student Continuous Collection V1.0 均已完成端到端验证。

真人试采候选版 `1.0.5` 已上传为微信小程序开发版本，尚未提交审核或正式发布。当前本地已增加主体刻画综合、后续补充对话提醒与模型构建进度展示，`1.0.5` 不包含这些改动，暂不应直接提交审核。

当前最高优先级：**完成本轮新代码真机回归并上传下一候选版，再进行微信公众平台隐私保护指引核对、审核与发布**。

## Teacher / Student 统一绑定协议（2026-08-28）

- [x] 完成兼容设计：School / Class 继续作为组织层，Teacher / Student 继续作为独立 Subject；不建立学校或班级微信主体
- [x] 新增 `registerTeacherForStudy`：受控预登记 Teacher Subject、teacher class_membership，并生成只返回一次明文的随机 bind code；数据库仅保存 bind_code_hash 与 school-scoped teacher_no_hash
- [x] 新增统一 `bindSubjectByCode`：前端只传 subject_type、bind_code、subject_no；教师与学生共用标准化、双哈希匹配、Subject / framework / membership 校验、一次性 code、事务和幂等规则
- [x] 新增统一 `getMySubjectBindings`：按当前 OPENID 解析 user，只返回本人 Teacher / Student active binding、安全 Subject 与组织字段
- [x] 教师绑定成功后才事务创建 identity_map 并设置 users.role = teacher；学生家长仍写 guardian_student_bindings 且不修改 users.role
- [x] `ensureTeacherSubject` 本地改为只读既有映射；新教师不再因点击“我是教师”自动创建第二个 Teacher Subject
- [x] 新增 `pages/teacher-bind/`，教师入口与学生入口均先检查已有 binding，无 binding 才进入对应绑定页；Student 正式入口已切换到统一云函数
- [x] 既有教师 `T_MT78AZ2K_WINH7` 与现有 Student Binding 数据保持兼容，未修改 Evidence、Analysis 或 Snapshot
- [x] 新增/修改 JavaScript 与 JSON 静态检查通过，teacher-bind / student-bind / role-select WXML、WXSS 编译通过，教师绑定页模拟器视觉检查通过
- [ ] `teacher_bind_codes` 云端集合创建/权限确认待微信开发者工具写操作确认
- [ ] `registerTeacherForStudy`、`bindSubjectByCode`、`getMySubjectBindings`、`ensureTeacherSubject` 等必要函数待部署确认
- [ ] 待 TEST Teacher 执行错误 code、错误 teacher_no、正确双匹配、重复提交四项自动化验证，并回归现有 Student Binding

## 模型构建进度与总体概览（2026-08-28）

- [x] `getSubjectModelGuidance` 新增只读 `construction_progress`：以教师 13 个、学生 17 个固定变量为完整分母，返回总体、一级维度和二级变量构建进度
- [x] 变量进度 V1.0 固定为 active Evidence 20%、有效 Analysis 20%、至少 1 条 supportive Evidence 30%、至少 2 条 supportive Evidence 15%、至少 2 个中国标准时间自然日 10%、至少 2 个 context 或 source type 5%
- [x] supportive 门槛保持 `relevant / partially_relevant + usable / weak`；irrelevant、uncertain、insufficient 不增加支持覆盖，进度不改变 confidence、模型采纳或人工审核规则
- [x] Teacher / Student 模型页已按“100 字内总体概览 → 一级维度雷达图与百分比 → 具体变量信息”统一展示，并明确标注该指数不是能力、水平、质量或置信度评分
- [x] `buildTeacherInitialModel` 升级为 `teacher_initial_model_v1.3`，`buildStudentInitialModel` 升级为 `student_initial_model_v1.2`；新 draft 必须生成覆盖固定一级维度、100 字以内且无评价性语言的 `model_data.overview_summary`
- [x] 已有 active Teacher / TEST Student snapshot 保持不可变；旧 snapshot 页面使用只读构建状态摘要兼容，不回写或重建历史模型
- [x] `getSubjectModelGuidance`、`buildTeacherInitialModel`、`buildStudentInitialModel`、`getStudentCurrentModel` 已部署到 `model-dev-d9gkoyaolb464c28d`；未调用模型构建函数
- [x] 真实教师只读结果：总体 74%，T1—T5 = 70 / 60 / 97 / 60 / 85；TEST Student 只读结果：总体 77%，S1—S6 = 70 / 80 / 70 / 80 / 85 / 80
- [x] 60 个 JavaScript 文件通过 `node --check`，95 个 JSON 文件解析通过；Teacher / Student 模型 WXML、WXSS 编译与模拟器页面核验通过，Console 无 error / warning
- [ ] 本轮小程序页面改动尚未上传新的开发版本

## 主体刻画与后续补充对话优化（2026-08-28）

- [x] 定位 Student-M0 旧实现把 `extracted_points` 以分号拼接为 `current_description` 的根因
- [x] `buildStudentInitialModel` 先升级为 `student_initial_model_v1.1` 完成跨证据主体刻画，随后由本轮升级为 `student_initial_model_v1.2` 增加总体概览
- [x] `buildTeacherInitialModel` 先升级为 `teacher_initial_model_v1.2` 完成跨证据主体刻画，随后由本轮升级为 `teacher_initial_model_v1.3` 增加总体概览
- [x] 已有 active Teacher snapshot `MS_MT873ZQI_9PEUL` 与 TEST Student snapshot `MS_MTBMDOF7_0MNQU` 保持不可变；本轮未重建、覆盖或自动批准模型
- [x] 新增只读 `getSubjectModelGuidance`，根据 Evidence / latest active Analysis / snapshot 的证据充分性、情境与时间覆盖动态返回 1—3 个后续补充方向
- [x] 提醒只作为自然对话起点，不把入口类型绑定变量；教师继续走 continuous content routing，学生继续走 `analyzeStudentEvidence(action = route_continuous)` 的 0—5 变量内容路由
- [x] Teacher Home 和 Student Home 的首次采集完成卡片已压缩；Student Home 增加儿童友好的“下次可以聊”提示
- [x] 教师首页“自由记录”正式入口已删除，只保留“今日教学反思”和“学生观察记录”；底层 `free_dialogue` 仅作历史兼容
- [x] `getSubjectModelGuidance` 已部署；真实教师只读返回 24 条 Evidence / 24 条 Analysis 的优先建议，TEST Student 返回 22 条 Evidence / 22 条 Analysis 的优先建议
- [x] 提醒卡片到教师 `voice-chat`、学生 `student-continuous` 的导航和提示透传已在开发者工具验证；后台实际路由不接收提示变量
- [x] 59 个 JavaScript 文件通过 `node --check`，项目 JSON 解析通过，6 个相关 WXML 与 2 个相关 WXSS 编译通过，Simulator Console 无 error
- [ ] 本轮小程序页面改动尚未上传新的开发版本
- [ ] 改进后的模型综合协议需在新的真实主体完成首次采集后，以 draft → Human Review 验证输出质量；不得用旧 active snapshot 做静默覆盖测试

## 真人试采候选版本 1.0.5（2026-08-28）

- [x] 教师首次逐项采集与学生首次逐项采集统一页面宽度、进度条、任务卡、录音区、提交按钮和状态反馈层级
- [x] `teacher-model` 与 `student-model` 统一模型版本/状态、一级维度、二级变量、四级状态标签、当前描述和可选不确定性布局
- [x] `student-home` 按教师首页的卡片层级整理首次采集、首次建模结果与“再说一说”，继续使用家庭/儿童可理解的文案
- [x] 教师首页删除与自由记录重复的“语音记录”入口，底层 Voice / ASR 能力保持不变
- [x] 教师首页删除尚未开发的“我的记录”入口；Teacher Record Center 记为非阻断 TODO
- [x] 当时教师持续采集保留今日教学反思、学生观察记录、自由记录三个已实现入口；本轮后续优化已从正式首页删除自由记录，仅保留底层历史兼容
- [x] 教师身份确认后复用 `T_MT78AZ2K_WINH7` 并进入 teacher-home；13/13 与 active snapshot `MS_MT873ZQI_9PEUL` 未改变
- [x] Student Binding、17/17、active snapshot `MS_MTBMDOF7_0MNQU`、student-model 与 student-continuous 回归通过
- [x] 57 个 JS 文件通过 `node --check`，91 个 JSON 文件解析通过，相关 WXML / WXSS 及微信开发者工具完整编译通过
- [x] 模拟器 Console / Network 无 error；教师/学生采集页与模型页小屏截图核验通过
- [x] `1.0.5` 已于 2026-08-28 17:42:51 CST 上传为开发版本，AppID = `wx962acbf120074da9`，代码包 796421 bytes
- [ ] 微信公众平台隐私保护指引需管理员登录后最终核对
- [ ] 尚未提交微信审核
- [ ] 尚未正式发布

版本说明：优化教师与学生采集及模型展示界面，清理无效入口。

## 历史候选版本 1.0.4（2026-08-28）

- [x] 正式入口已移除 QuickStart / 配置助手 / TEST 页面暴露，遗留 QuickStart 页面已排除出上传包
- [x] 真人采集链不会调用 `createStudentTestVoiceRecord`，不会自动产生 `test_source = simulated_transcript`
- [x] 真人 Student 17/17 后只生成 draft，普通 Guardian 无模型批准权限；只能读取本人绑定 Student 的安全模型摘要
- [x] Teacher 初始模型生成与人工批准保持分离，真实入口不存在自动 approve 调用
- [x] 研究内部集合客户端直接访问继续返回 `DATABASE_PERMISSION_DENIED (-502003)`
- [x] AppID、云环境、录音实现与所有正式页面配置检查通过，无 localhost、TEST env 或硬编码 TEST 身份
- [x] 所有云函数 `index.js`、小程序 JS 与 JSON 静态检查通过
- [x] 微信开发者工具完整编译通过，Console / Network 无阻断错误
- [x] Teacher 13/13、active snapshot `MS_MT873ZQI_9PEUL` 与页面回归通过
- [x] Student Binding、17/17、active TEST snapshot `MS_MTBMDOF7_0MNQU` 与页面回归通过，未重新生成 TEST Evidence
- [x] Teacher 入口确认后已能复用既有 Subject 并进入 teacher-home，不初始化新任务或重建模型
- [x] Student Home 已增加首次建模结果入口，student-model 支持 draft / active 安全展示
- [x] Student Continuous Collection V1.0 真机录音、ASR、Routing、Evidence 与 Analysis 已完整验证
- [x] 教师持续语音提交的 3 秒 AI 路由超时已修复，正式前端改由 `analyzeTeacherEvidence(action = route_continuous)` 的 60 秒环境承担路由
- [x] 两条受影响真实教师录音已安全恢复：一条可靠路由为 T3-1 / T3-3 / T1-1 并完成 3 条 Analysis；一条为 0 匹配并完整保留 Voice / Message
- [x] `1.0.4` 页面编译及既有真机录音链路回归通过
- [x] `1.0.4` 已于 2026-08-28 15:08:24 CST 上传为开发版本，AppID = `wx962acbf120074da9`，代码包 786084 bytes
- [ ] 微信公众平台隐私保护指引需管理员登录后最终核对
- [ ] 尚未提交微信审核
- [ ] 尚未正式发布

版本说明：教师与学生主体模型真人试采版。

## Student Continuous Collection V1.0（2026-08-28）

- [x] Student Home 在首次采集 17/17 后显示“查看首次建模结果”和“再说一说”
- [x] `student-model` active 实测显示 S1—S6、17 变量；draft 分支显示“首次建模结果（待复核）”
- [x] 页面不显示分数、排名、人格类型、心理诊断、原始录音或 Evidence Analysis reasoning
- [x] `createSession` 支持 `student_continuous_record`，并验证当前 user 的 active Guardian binding
- [x] `student-continuous` 复用 `wx.getRecorderManager`、`saveVoiceRecord` 与 `transcribeVoice`
- [x] 正式页面通过 `analyzeStudentEvidence(action = route_continuous)` 完成 0—5 变量内容路由，再复用同一函数逐条保存 Analysis
- [x] `matches = []` 时 Voice、Message、continuous_record_id 与 no-match reason 仍保留，不伪造 Evidence
- [x] 路由或 Analysis 失败时页面不清空 voice_id / transcript，可直接重试
- [x] Continuous Evidence 只进入 Evidence 层，不更新 `MS_MTBMDOF7_0MNQU`，不创建 Student-M1
- [x] 真机录音 `V_MTCEML6F_F1AY2`：12.16 秒、腾讯 ASR success、主体为 `S_MTB6OGNQ_4F4DD`
- [x] 路由生成 3 条 TEST Evidence：S4-1、S5-1、S6-1；全部生成正式 V1.0 Analysis，均为 partially_relevant + weak
- [x] Guardian user 只记录为 operator，Voice / Message / Evidence / Analysis 的 subject_id 均为 Student_ID
- [x] Teacher Continuous 页面改用 `analyzeTeacherEvidence(action = route_continuous)` 长时路由；`submitTeacherContinuousRecord` 保留为无正式前端入口旧端点

独立云函数 `submitStudentContinuousRecord` 当前云端保持默认 3 秒运行配置，首次真机路由曾触发 `FUNCTIONS_TIME_LIMIT_EXCEEDED`。1.0.4 正式前端不调用该端点，而是安全复用已配置 120 秒的 `analyzeStudentEvidence` 路由模式；原始 Voice / Message 在失败中完整保留并已成功重试。后续仅在 researcher / admin 可安全修改云运行配置时，再决定是否恢复独立端点。

## 微信审核 TEST Student（2026-08-28）

- [x] 使用既有 `TEST_SCHOOL_001` / `TEST_CLASS_001`
- [x] REVIEW TEST Student：`S_MTCEFIQD_395DE`，alias = `REVIEW_TEST_STUDENT_001`，`is_test = true`
- [x] 绑定码状态为 unused；当前 Evidence = 0，Model Snapshot = 0
- [x] 审核用虚拟 student_no 与一次性 bind code 记录在 `docs/REVIEW_TEST.md`，不进入小程序代码包

## Student Initial Model MVP（2026-08-28）

- [x] Student S0 复用 `subject_background`，由 School / Class / Student Subject 自动形成
- [x] `student_v1.0` 17 个儿童友好首次语音任务已写入 `collection_tasks`
- [x] Student `collection_progress` 已完成 17/17，支持逐题保存与断点继续
- [x] `createSession`、`saveVoiceRecord` 已最小泛化并执行 guardian binding 授权校验
- [x] 真机完成第 1 题录音与 ASR，并成功进入第 2 题
- [x] TEST Student 其余 16 题使用明确 `is_test=true` 的模拟技术记录完成结构验证
- [x] Student Voice / Message / Evidence / Evidence Analysis 均归属 Student_ID，Guardian user 仅为 operator
- [x] 17 条 active Evidence 与 17 条 active Evidence Analysis 完整覆盖 S1-1 至 S6-3
- [x] `buildStudentInitialModel` 生成包含 S1—S6、17 变量的 draft Student-M0
- [x] `approveStudentInitialModel` 完成人工确认并将 snapshot 转 active
- [x] `getStudentCurrentModel` 返回 active Student-M0
- [x] `student-home`、`student-collection`、`student-model` 页面验证通过
- [x] 教师首页 13/13、active current model 与 `teacher-model` 回归通过，Console 无阻断错误

TEST active snapshot：`MS_MTBMDOF7_0MNQU`，version = 1.0。该快照只用于技术闭环验证，不代表真实儿童研究结论。

结论：**Student Initial Model MVP 已完整跑通**。

## Student Binding MVP（2026-08-27）

- [x] 线下纸质知情同意边界已明确，小程序不保存电子同意
- [x] 新建 `schools`、`classes`、`class_memberships`
- [x] Student Subject 与 users / OpenID 分离，使用 `student_v1.0`
- [x] 新建 `student_bind_codes`，仅保存 bind_code_hash 与 school-scoped student_no_hash
- [x] 新建 `guardian_student_bindings`
- [x] `registerStudentForStudy` 已部署并验证重复登记保护
- [x] `bindStudentByCode` 已部署，binding 创建与 bind code 置 used 使用事务
- [x] `getMyStudentBindings` 已部署，不接收前端 user_id
- [x] 错误 code：失败
- [x] 正确 code + 错误 student_no：失败，code 保持 unused
- [x] 正确 code + 正确 student_no：成功
- [x] 同一用户重复绑定：幂等成功，不创建第二条 binding
- [x] `student-bind` 与 `student-home` 页面已建立
- [x] “学生采集”独立入口已建立，不增加 student 登录角色
- [x] 五个新集合均为 ADMINONLY；客户端直接读写实测返回 `DATABASE_PERMISSION_DENIED (-502003)`
- [x] 当前教师测试账号 role 保持 teacher，原 Teacher Subject / identity_map 未改变
- [x] TEST 链路：`TEST_SCHOOL_001` → `TEST_CLASS_001` → `S_MTB6OGNQ_4F4DD`

结论：**Student Binding MVP 已跑通**。

## 教师首次模型 MVP 回归（2026-08-27）

- [x] Teacher Subject 可读取：`T_MT78AZ2K_WINH7`
- [x] T0 active 数据可读取
- [x] collection_progress = completed，13/13
- [x] 教师 Evidence 存在：16 条 active，全部 analysis_status = completed
- [x] 教师 Evidence Analysis 存在：16 条 active
- [x] 初始模型已完成人工审核：存在 approved_at
- [x] active snapshot 可读取：`MS_MT873ZQI_9PEUL`
- [x] `getTeacherCurrentModel` 返回 has_model = true
- [x] teacher-model 页面 WXML / WXSS 编译通过
- [x] teacher-model 页面正常显示 T0、T1—T5 和 13 个变量
- [x] 页面 Console 无 error

结论：**教师首次主体模型 MVP 已完成**。后续教师侧只修复阻断真实采集或首次模型构建的问题。

## 一、已完成：总体研究设计
- [x] 五阶段路线确定
- [x] 教师主体模型 V1.0 冻结
- [x] 学生主体模型 V1.0 冻结
- [x] 教师首次采集表完成
- [x] 学生首次采集表完成
- [x] 主体模型持续建构机制 V1.0 完成
- [x] 教师—学生通用模型完善架构 V1.0 完成
- [x] 多模态扩展原则确定

## 二、已完成：教师基础应用

### 身份与背景
- [x] login 可用
- [x] Teacher Subject 建立
- [x] 教师主体：`T_MT78AZ2K_WINH7`
- [x] `ensureTeacherSubject` 可用
- [x] `saveTeacherBackground` 可用
- [x] `getTeacherBackground` 可用
- [x] teacher-background 页面可用

### 首次建模任务
- [x] `initTeacherCollectionTasks`
- [x] `getNextTeacherCollectionTask`
- [x] `createSession`
- [x] `completeTeacherCollectionTask`
- [x] `createTeacherTaskEvidence`
- [x] 13/13 首次任务完成

### 首次模型
- [x] 教师首次模型草稿生成
- [x] 人工审核
- [x] 同一 snapshot 转 active
- [x] active snapshot：`MS_MT873ZQI_9PEUL`
- [x] `getTeacherCurrentModel`
- [x] teacher-model 页面
- [x] teacher-home 当前模型入口

## 三、已完成：教师持续记录
正式首页入口：teaching_reflection、student_observation。`free_dialogue` 只作历史记录与旧链接兼容，不再作为产品入口。

- [x] 一次录音 = 一次提交
- [x] source_type 不硬绑定变量
- [x] 一条语音可对应多个变量
- [x] 未匹配时不伪造 Evidence
- [x] `submitTeacherContinuousRecord`
- [x] `analyzeTeacherEvidence V1.1`

真实语音验证：
- voice_id：`V_MT8AS84D_MUDYZ`
- T2-2 Evidence：partially_relevant + weak
- T3-2 Evidence：relevant + usable
- T2-2 analysis_id：`EA_MT8BDTJN_VA7ZN`
- T3-2 analysis_id：`EA_MT8BGC75_DLFB5`

## 四、教师持续记录自动分析
- [x] `voice-chat.js` 通过 `analyzeTeacherEvidence(action = route_continuous)` 完成 0—5 变量路由，再逐条调用 `analyzeTeacherEvidence(save_analysis = true)`
- [x] 真人提交超时记录恢复验证完成：`V_MTCGGCBW_M4KSM` 生成 T3-1 / T3-3 / T1-1 三条 Evidence 与三条 active Analysis
- [x] `V_MTCGI17N_0KYVI` 正确返回 0 匹配；Voice、Message 与 no-match reason 保留，未伪造 Evidence
- [x] 重试使用确定性 continuous/evidence ID，不重复创建同一 voice + variable Evidence
- [x] 当前 active Teacher snapshot `MS_MT873ZQI_9PEUL` 未被持续 Evidence 自动更新

Evidence Analysis 失败时，原始记录和 Evidence 必须保留，不得回滚丢失。

## 五、模型完善机制：暂停深入开发

### 已保留
- [x] `rebuildVariableEvidenceProfile V1.0` 设计与本地源码已保留
- [x] 2026-08-27 已重新部署到 `model-dev-d9gkoyaolb464c28d`
- [x] dry-run 已验证会因当前环境缺少 `variable_evidence_profiles` 而安全失败，未写业务数据

### 暂停项
- [ ] 当前环境尚未实际创建 `variable_evidence_profiles` 集合
- [ ] 第一次真实 Profile 重建测试
- [ ] T2-2 Profile 校验
- [ ] T3-2 Profile 校验
- [ ] `rebuildSubjectEvidenceProfiles`
- [ ] Evidence Gap
- [ ] supplement_candidates
- [ ] unmatched monitoring
- [ ] stagnation diagnosis
- [ ] model_change_candidates
- [ ] 模型版本自动/半自动演化

这些机制不再是当前第一优先级。除非阻断教师或学生首次模型构建，否则不继续处理。

## 六、当前第一优先级

先完成本轮本地页面的真机回归并上传下一候选版，再进行微信公众平台隐私保护指引核对、审核与发布，随后组织真人教师和学生主体模型采集测试。继续坚持 Student_ID 独立于当前操作人的 OpenID / user_id；完整 Evidence Profile / Evidence Gap 状态机仍不作为当前优先项。

## 七、学生端状态

### 已完成设计
- [x] Student-M0 框架
- [x] S0 + S1—S6
- [x] 17 个二级变量
- [x] 学生首次访谈采集表
- [x] 儿童自然访谈原则
- [x] 行为观察原则
- [x] 监护人补充原则
- [x] 多模态底层策略

### MVP 实现状态
- [x] Student Subject
- [x] School / Class / Student class membership
- [x] Guardian WeChat ↔ Student_ID Binding
- [x] Student Bind / Student Home
- [x] 学生 S0
- [x] 学生首次语音采集
- [x] 学生 ASR 接入
- [x] 学生 Evidence
- [x] 学生 Evidence Analysis
- [x] Student-M0 生成
- [x] Student-M0 审核
- [x] 学生首次模型安全展示（绑定用户可查看 draft / active 安全摘要）
- [x] Student Continuous Collection V1.0
- [ ] 行为观察入口
- [ ] 图片/作品等多模态

计划：完成微信平台隐私核对、审核与发布后进入真人教师和学生主体模型采集测试；以真实语音为主，根据实地问题迭代任务文案和交互，不等待 Evidence Profile 或复杂多模态。

## 八、当前数据库重要集合
已有：users、identity_map、subjects、schools、classes、class_memberships、student_bind_codes、guardian_student_bindings、consents、sessions、messages、voice_records、evidence、evidence_analysis、model_snapshots、collection_tasks、collection_progress、subject_background。

暂停 / 计划：variable_evidence_profiles、collection_events、supplement_candidates、model_change_candidates、media_records（后续）、behavior_records（学生侧后续）。

## 九、非阻断 TODO

- `subjects.current_version` 当前为空，但 active snapshot 可被 `getTeacherCurrentModel` 正常读取；首次模型 MVP 不受阻断，后续统一版本指针规则。
- 当前 active snapshot 保存的 T0 教龄为 8 年，而当前 active `subject_background` 为 9 年；snapshot 按版本不可变，后续在新的首次采集前明确 T0 修改与模型重建规则。
- `submitTeacherContinuousRecord` 的独立云端运行时仍是 3 秒且无正式前端入口；1.0.5 继续由 `analyzeTeacherEvidence(action = route_continuous)` 承担正式教师持续路由。后续只有 researcher / admin 可调整运行配置时再清理该遗留端点，不阻断真人流程。
- Teacher Record Center / “我的记录”尚未形成正式业务闭环，已从正式首页移除；后续统一设计，不阻断当前真人试采。
- `security_follow_up`：正式前端或自动调用链接入前，统一设计 subject authorization。
- `identity_map` 当前实际只用于 users ↔ Teacher Subject，不适合直接承载 Student_ID ↔ 学号；正式学生身份主表扩展后续统一设计。本轮在线双重校验依赖 `student_bind_codes.student_no_hash` 与线下研究主表。
- Student Binding MVP 当前限制一个 Student_ID 同时只有一个 active guardian binding；换绑、多监护人和撤销后的重新发码后续开发。
- student_no 当前使用学校范围标准化后 SHA-256；正式规模化前评估 HMAC / pepper，以降低低熵学号离线枚举风险。
- 本轮保留少量 `inactive + is_test=true` 权限探针记录，用于证明 ADMINONLY 生效；不参与 active School 查询。
- Student Evidence Analysis 的个别 TEST 返回使用了字符串 `none` 表示无不确定性；后续生成新快照前统一将这类语义空值标准化为空，不修改已审批的测试快照。
- `createStudentTestVoiceRecord` 是无正式前端入口、且只允许 active TEST Student 的开发辅助函数；正式页面不得调用。配置辅助函数已限制为 researcher / admin，仍应保持无普通前端入口。
- `submitStudentContinuousRecord` 的独立云端运行时当前仍是 3 秒且无正式前端入口；1.0.5 继续由 `analyzeStudentEvidence(action = route_continuous)` 承担正式持续路由。后续只有 researcher / admin 可调整运行配置时再清理该遗留端点，不阻断当前真人流程。
- 当前 17 个任务是一变量一短任务的 MVP 技术组织方式；真实儿童试采后再决定是否重组为自然交流、任务活动、行为观察或微采集。

## 十、明确不做的事情
- [ ] 自动创建 T6 / S7
- [ ] 综合能力打分
- [ ] 单条证据直接改模型
- [ ] 用新证据覆盖旧 snapshot
- [ ] 把教学反思固定归 T5-2
- [ ] 把学生直接绑定当前用户 OpenID
- [ ] 教师和学生分别复制两套 Evidence Profile 底层
- [ ] 为了“完整”而强制高频追问教师或儿童
- [ ] 把大量 unmatched 自动解释为用户表达质量差
