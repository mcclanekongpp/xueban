# Codex 项目沟通与开发交接记录

> 生成日期：2026-08-28（Asia/Shanghai）  
> 项目目录：`/Users/wangwei/Documents/xueban`  
> 用途：更换 Codex 账号后，让新的开发会话能够快速理解项目背景、已确认决策、真实进度与下一步。  
> 安全说明：本文不包含 OpenID、云密钥、真实学生姓名、真实学号、明文绑定码或其他真实身份信息。
>
> 历史记录说明：本文保留 2026-08-28 当时的交接状态。首次模型的人工审核边界已于 2026-08-31 被新决策替代；当前规则以 `AGENTS.md`、`docs/ARCHITECTURE.md`、`docs/DEVELOPMENT_STATUS.md` 和 `docs/DATA_MODEL.md` 为准：Teacher / Student 首次模型在采集与 Evidence Analysis 完成后自动构建并激活，不再设人工审核。

## 1. 项目目标与当前阶段

项目名称为“智能课堂模拟与教学实验系统”。它不是教师/学生测评系统，也不是教案生成器。当前处于五阶段路线的第一阶段“主体表征”，目标是基于真实教师和学生的持续证据，构建可解释、可修正、可版本化的主体模型。

五阶段路线固定为：

1. 主体表征
2. 主体复现
3. 双主体互动
4. 模拟课堂
5. 实验验证

当前优先级已从后台 Evidence Profile 等增强机制调整为：尽快完成真人教师、家长和学生试采上线；只修复阻断真实采集、自动分析或主体模型构建的问题。

## 2. 固定研究框架

### 2.1 Teacher V1.0

- 框架：`teacher_v1.0`
- T0：基本背景，不评分
- T1—T5：固定 13 个二级变量
- 不允许未经研究者确认新增 T6、合并变量或修改变量含义
- 不生成综合总分、排名、人格类型或永久标签

### 2.2 Student V1.0

- 框架：`student_v1.0`
- S0：基本背景，不评分
- S1—S6：固定 17 个二级变量
- 不允许新增 S7、三级指标、总分、排名或稳定人格标签
- 学生首次采集 V1.0 暂用 17 个儿童友好短语音任务覆盖 17 个变量，这是 MVP 技术组织方式，不是最终实地采集方法学

完整变量定义以根目录 `AGENTS.md` 为唯一首要约束，并结合 `docs/ARCHITECTURE.md`、`docs/DEVELOPMENT_STATUS.md`、`docs/DATA_MODEL.md` 阅读。

## 3. 已确认的证据原则

1. 原始记录、Evidence、Evidence Analysis、Model Snapshot 必须分层保存。
2. 一条 Evidence 不能直接定义稳定主体特征，也不能直接修改 active model。
3. 一段输入允许路由至 0—多个变量；路由只代表可能相关，不代表证据可用。
4. `matches = []` 时不得伪造 Evidence，必须保留 Voice、Message 和未匹配原因。
5. Evidence Analysis 标准字段包括：
   - `relevance_status`
   - `evidence_sufficiency`
   - `extracted_points`
   - `reasoning_basis`
   - `context`
   - `uncertainty`
   - `protocol_version`
   - `analysis_version`
6. 相关性枚举：`relevant / partially_relevant / irrelevant / uncertain`。
7. 充分性枚举：`usable / weak / insufficient`。
8. 学生与教师的底层机制应共用，但变量定义和前端交互不能机械复制。

## 4. 身份、组织与隐私决策

### 4.1 Student Subject

- Student 是独立研究主体：`subject_id = Student_ID`、`subject_type = student`、`framework = student_v1.0`。
- Student_ID 不等于 OpenID、Guardian user_id、学生学号或绑定码。
- Guardian WeChat 只是认证后的采集终端操作者。
- 学生 Voice、Message、Evidence、Evidence Analysis、Model Snapshot 的主体必须始终是 Student_ID；Guardian 只可记录为 `operator_user_id`。
- Guardian binding 不修改现有 `users.role`。

### 4.2 School / Class

组织关系使用：

- `schools`
- `classes`
- `class_memberships`

Teacher 和 Student 均继续存放在 `subjects`。教师与学生通过 Class_ID 建立教育组织关系，不建立 `teacher_student_direct_relation`。

### 4.3 Student Binding

流程为：线下纸质知情同意完成 → 研究团队登记 Student Subject → 预生成随机绑定码 → 家长输入绑定码和学生学号 → 云函数双重哈希匹配 → Guardian WeChat 与 Student_ID 建立 active binding。

关键云函数：

- `registerStudentForStudy`
- `bindStudentByCode`
- `getMyStudentBindings`

内部研究集合保持 ADMINONLY，普通小程序端不得直接读写。绑定码和学号的明文不得进入 Git 仓库、业务 Evidence 或前端安全返回。

## 5. 当前已完成的端到端 MVP

### 5.1 Teacher MVP：已完成

已跑通：

`Teacher Subject → T0 → 13项首次采集 → Voice → ASR → Evidence → Evidence Analysis → Teacher-T0 draft → Human Review → Active Model → Current Model Display`

回归基线：

- Teacher Subject：`T_MT78AZ2K_WINH7`
- Active snapshot：`MS_MT873ZQI_9PEUL`
- 首次采集进度：13/13
- `teacher-home`、`teacher-model` 已验证正常

教师首次模型流程冻结，只修阻断问题，不重新生成或覆盖现有 snapshot。

### 5.2 Student Binding MVP：已完成

已跑通：

`School → Class → Student Subject → bind code + student_no → Guardian binding → Student Home`

TEST 基线：

- TEST Student：`S_MTB6OGNQ_4F4DD`
- 研究别名：`TEST_STUDENT_001`
- active guardian binding 已存在

### 5.3 Student Initial Model MVP：已完成

已跑通：

`Student Home → S0 → 17项首次采集 → Voice → ASR → Evidence → Evidence Analysis → Draft Student-M0 → Human Review → Active Student-M0 → Current Model`

TEST 基线：

- 17/17 completed
- Active snapshot：`MS_MTBMDOF7_0MNQU`
- version：`1.0`
- `student-home`、`student-collection`、`student-model` 已验证
- TEST 数据仅用于技术验证，不代表真实儿童研究结论

真人 Student 17/17 后只能生成 draft；普通 Guardian 不得 approve，active 必须经 researcher/admin 受控人工审核。

### 5.4 Student Continuous Collection V1.0：已完成

已跑通：

`Student Home → 再说一说 → Voice → ASR → Message → 内容路由 → 0—5 Evidence → Evidence Analysis`

正式前端使用 `analyzeStudentEvidence(action = route_continuous)` 完成路由，再逐条调用同一函数保存 Analysis。持续 Evidence 只进入证据层，不更新 active Student-M0、不生成 Student-M1。

## 6. 最近一次教师语音故障与修复

### 6.1 用户现象

教师在“自由记录”页面完成语音输入后提交，真机提示：

`cloud.callFunction:fail Error: errCode: -504003...`

### 6.2 根因

正式前端原先调用 `submitTeacherContinuousRecord` 完成 AI 内容路由，但该独立云函数在云端的运行超时只有 3 秒。录音保存和腾讯 ASR 已完成，AI 路由尚未返回就触发函数超时。

### 6.3 修复

- 新增：`cloudfunctions/analyzeTeacherEvidence/continuous-routing.js`
- 修改：`cloudfunctions/analyzeTeacherEvidence/index.js`
- 修改：`miniprogram/pages/voice-chat/voice-chat.js`
- 正式前端改用 `analyzeTeacherEvidence(action = route_continuous)` 的 60 秒运行环境完成教师持续内容路由
- 路由完成后逐条调用 `analyzeTeacherEvidence(save_analysis = true)`
- 采用确定性 continuous/evidence 文档 ID，保证同一 voice + variable 重试幂等
- `submitTeacherContinuousRecord` 仍保留在云端，但已无正式前端入口，当前超时仍为 3 秒

### 6.4 真实记录恢复结果

- `V_MTCGGCBW_M4KSM`：成功路由至 T3-1、T3-3、T1-1，生成 3 条 Evidence 和 3 条 active Evidence Analysis，均为 `relevant + usable`
- `V_MTCGI17N_0KYVI`：可靠匹配为 0，保存 Voice、Message、continuous record 和 no-match reason，未伪造 Evidence
- Active Teacher snapshot `MS_MT873ZQI_9PEUL` 未被持续 Evidence 自动更新

### 6.5 验证结果

- 所有 cloudfunction `index.js`：`node --check` 通过
- 所有 miniprogram JS：`node --check` 通过
- 93 个 JSON：解析通过
- 微信开发者工具编译：通过
- Console：无 error/warning/fail
- Network：无 error/timeout/504
- Teacher Home：13/13
- Teacher Current Model：正常
- Student Home：17/17、active Student-M0 正常

## 7. 当前版本与云环境

- 本地项目：`/Users/wangwei/Documents/xueban`
- AppID：`wx962acbf120074da9`
- 云环境 ID：`model-dev-d9gkoyaolb464c28d`
- 微信开发者工具：`/Applications/wechatwebdevtools.app`
- CLI：`/Applications/wechatwebdevtools.app/Contents/MacOS/cli`
- Codex/IDE skill CLI：`/Applications/wechatwebdevtools.app/Contents/MacOS/wechatide`
- 当前真人试采候选版本：`1.0.4`
- `1.0.4` 上传时间：2026-08-28 15:08:24 CST
- 上传包大小：786084 bytes
- 开发版本：已上传
- 提交微信审核：否
- 正式发布：否
- `1.0.3` 已被替代，不再用于送审

## 8. 当前主要页面

- `pages/role-select/`：教师身份确认与学生采集入口
- `pages/teacher-home/`：教师首页、13项进度、持续记录入口、当前模型入口
- `pages/teacher-background/`：教师 T0
- `pages/voice-chat/`：教师首次/持续语音采集
- `pages/teacher-model/`：当前 Teacher Model
- `pages/student-bind/`：绑定码 + 学号双重验证
- `pages/student-home/`：学生采集状态、首次模型结果入口、“再说一说”入口
- `pages/student-collection/`：17项学生首次语音采集
- `pages/student-model/`：Student-M0 draft/active 安全展示
- `pages/student-continuous/`：儿童友好持续语音采集

## 9. 关键集合

当前已使用：

- `users`
- `identity_map`
- `subjects`
- `schools`
- `classes`
- `class_memberships`
- `student_bind_codes`
- `guardian_student_bindings`
- `consents`
- `sessions`
- `messages`
- `voice_records`
- `evidence`
- `evidence_analysis`
- `model_snapshots`
- `collection_tasks`
- `collection_progress`
- `subject_background`

详细字段以 `docs/DATA_MODEL.md` 为准。

## 10. 暂停项与已知非阻断风险

当前暂停，不应擅自恢复开发：

- Variable Evidence Profile 的进一步优化
- Evidence Gap
- Targeted Supplement
- Stagnation Diagnosis
- Unmatched 聚类
- Model Change Candidate
- Teacher/Student 自动模型更新
- Student-M1/M2
- 图片、视频、自动行为识别
- 多监护人、换绑、复杂家长管理
- 模拟课堂、双主体互动、实验模块

已知非阻断风险：

1. `submitTeacherContinuousRecord` 与 `submitStudentContinuousRecord` 独立端点云端仍为 3 秒，但正式页面已不调用。
2. `security_follow_up`：部分研究受控云函数的 subject authorization 仍需在正式开放自动调用链前统一加强。
3. Student Binding 当前限制一个 Student_ID 同时只有一个 active Guardian binding。
4. student_no 使用学校范围标准化后 SHA-256，正式规模化前应评估 HMAC/pepper。
5. 当前 17 个学生任务是一变量一短任务的 MVP 结构，需在真实儿童小样本试采后根据理解难度和交互表现调整。
6. `variable_evidence_profiles` 代码已存在，但数据集合与后续机制不是当前上线阻断项。

## 11. Git 与敏感文件规则

项目版本控制仓库：`https://github.com/mcclanekongpp/xueban.git`

以下文件或内容不得提交：

- `project.private.config.json`
- `docs/REVIEW_TEST.md`（包含一次性审核绑定凭据）
- `.env`、`.env.*`（`.env.example` 除外）
- 腾讯 ASR SecretId / SecretKey
- OpenID、真实姓名、真实学号、真实绑定码、数据库导出

云函数只从运行环境读取 `ASR_SECRET_ID` 与 `ASR_SECRET_KEY`，不得把实际值写入代码或文档。

## 12. 新 Codex 会话接管步骤

新会话开始时按顺序完整阅读：

1. `AGENTS.md`
2. `docs/ARCHITECTURE.md`
3. `docs/DEVELOPMENT_STATUS.md`
4. `docs/DATA_MODEL.md`
5. 本交接记录

然后执行只读检查：

```bash
git status --short --branch
git log --oneline --decorate -n 10
node --check cloudfunctions/analyzeTeacherEvidence/index.js
node --check cloudfunctions/analyzeTeacherEvidence/continuous-routing.js
node --check miniprogram/pages/voice-chat/voice-chat.js
```

不要在未理解当前真人试采目标前继续开发 Evidence Profile、Evidence Gap、Student-M1/M2 或其他后台增强机制。

## 13. 下一步唯一优先事项

登录微信公众平台，完成隐私保护指引最终核对，提交 `1.0.4` 审核；审核通过后发布。随后组织真人教师和学生主体模型采集测试，并只根据真实试采中出现的阻断问题进行修复。
