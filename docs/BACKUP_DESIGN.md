# 全量备份与恢复工具设计 V1.0

## 0. 当前状态

设计已由 `tools/xueban-backup` V1.0 实现。2026-08-29 已完成首次真实全量备份：数据库和云存储只读，未调用业务云函数，未修改、删除或新增云端业务数据；本地加密包已通过离线解密与 SHA-256 校验。恢复操作尚未执行。

目标环境：`model-dev-d9gkoyaolb464c28d`。

备份工具必须是本地管理员工具，不进入小程序代码包，不作为普通前端或业务云函数入口。

## 1. 目标

全量备份必须能够回答并保存：

1. 某个 Teacher / Student Subject 有哪些原始语音和转写；
2. 原始记录形成了哪些 Evidence；
3. 每条 Evidence 使用了哪一条正式 Evidence Analysis；
4. 当时形成了哪些 draft / active / 历史 Model Snapshot；
5. 每个模型版本引用了哪些 Evidence / Analysis、使用了什么生成协议和人工审核信息；
6. School、Class、Subject 与认证操作者之间的组织和绑定关系；
7. 备份中的每个文件和每条集合导出是否完整、是否可追溯、是否可以恢复。

V1.0 优先实现“可验证的全量备份”。增量备份、自动定时和跨环境正式恢复在首次全量备份验证通过后再实现。

## 2. 非目标

- 不在备份过程中修改业务集合；
- 不修改 Evidence、Evidence Analysis 或 Model Snapshot；
- 不把数据库导出误认为完整备份；
- 不只保存当前 active 模型而丢弃 draft 或历史版本；
- 不把临时下载 URL 当作音频备份；
- 不自动删除云端文件或旧备份；
- 不把密钥、明文绑定码或本地备份提交到 Git；
- V1.0 不提供覆盖现有生产环境的恢复命令。

## 3. 备份范围

### 3.1 云存储原始对象

默认枚举并备份环境中的全部业务云存储对象，而不是只依赖 `voice_records.file_id`。

当前重点前缀：

```text
voice/{operator_user_id}/{timestamp}.mp3
```

这样可以同时保留：

- 已被 `voice_records` 引用的音频；
- 数据库关联失败但仍存在于云存储的孤立音频；
- 未来新增的图片、视频、文件等对象。

每个对象必须记录原 `file_id`、cloud path、大小、ETag/修改时间（若接口提供）、SHA-256、本地相对路径和关联状态。

### 3.2 数据库集合

工具先枚举环境中实际存在的全部业务集合，再与“预期集合注册表”对比。未知集合默认仍备份并在报告中标记，不能因为文档未登记而跳过。

身份与组织层（高敏感）：

- `users`
- `identity_map`
- `schools`
- `classes`
- `class_memberships`
- `teacher_bind_codes`
- `student_bind_codes`
- `guardian_student_bindings`
- `consents`

主体与采集层：

- `subjects`
- `subject_background`
- `collection_tasks`
- `collection_progress`
- `sessions`
- `messages`
- `voice_records`

证据与模型层：

- `evidence`
- `evidence_analysis`
- `model_snapshots`

如果以下集合未来真实存在，也自动纳入：

- `variable_evidence_profiles`
- `collection_events`
- `supplement_candidates`
- `model_change_candidates`
- `media_records`
- `behavior_records`

数据库使用保留嵌套结构和数据类型的 JSON 原生导出，不使用 CSV 作为恢复源。

### 3.3 主体模型专项备份

`model_snapshots` 是已构建主体模型的事实来源，必须原样备份全部记录和全部状态：

- draft；
- active；
- 历史/其他状态；
- Teacher 和 Student；
- TEST 与非 TEST。

不能只备份模型页面当前显示的安全摘要。每个 snapshot 必须保留：

- `snapshot_id`、`subject_id`、`subject_type`、`framework`；
- `model_type` / `snapshot_type`；
- `version` / `model_version`；
- 完整 `model_data`，包括 `overview_summary`、一级维度、二级变量、描述、情境和不确定性；
- `source_evidence_ids[]`、`source_analysis_ids[]`；
- `generation_method`、`generation_protocol`、模型提供方和模型名；
- `status`、`approved_at`、`approved_by_user_id`；
- `created_at`、`updated_at` 和 `is_test`。

同时生成只读模型索引，记录每个 snapshot 的规范化内容 SHA-256、版本、状态、来源数量和引用完整性。模型索引只用于校验，不能替代原始 `model_snapshots` 导出。

`construction_progress` 和补充对话提示目前是运行时计算结果，不是模型事实。V1.0 不把它们当作必须恢复的数据；备份 Evidence、Analysis、Snapshot、函数源码和 Git commit 后可以重新计算。若后续需要审计，可增加标记为 `derived` 的只读结果快照。

### 3.4 代码与环境元数据

备份包记录：

- 当前 Git commit、branch 和 dirty 状态；
- 项目 AppID 与 CloudBase env ID；
- 云函数名称、运行时、超时和更新时间等非秘密元数据；
- 集合权限模式和云存储权限模式；
- 小程序和云函数源码的 Git bundle 或对应 commit；
- 依赖清单与 lockfile（若存在）。

环境变量只记录键名和“是否为 secret”，不导出 secret 明文。腾讯 ASR、CloudBase AI 等外部凭证必须通过独立的密钥托管流程恢复。

## 4. 备份包结构

```text
xueban-backup-<env>-<UTC timestamp>/
├── backup-manifest.json
├── checksums.sha256
├── database/
│   ├── inventory.json
│   ├── restricted/          # 身份、绑定、组织等高敏数据
│   ├── research/            # 采集、证据与模型数据
│   └── unknown/             # 未登记但实际存在的集合
├── storage/
│   ├── inventory.jsonl
│   └── objects/             # 保留原 cloud path 层级
├── models/
│   ├── snapshot-index.json
│   └── subjects/            # 每个 Subject 的 snapshot 引用索引
├── configuration/
│   ├── environment.json
│   ├── cloudfunctions.json
│   └── permissions.json
├── source/
│   ├── git.json
│   └── xueban.bundle
└── reports/
    ├── integrity.json
    ├── consistency.json
    ├── privacy.json
    └── summary.md
```

最终交付物应加密封装。明文临时目录只允许位于 `mktemp` 创建的目录中，成功生成加密包后清理；失败时报告临时目录位置，不静默删除唯一可诊断材料。

## 5. Manifest 核心字段

```json
{
  "schema_version": "xueban_backup_v1.0",
  "backup_id": "BKP_...",
  "environment_id": "model-dev-d9gkoyaolb464c28d",
  "started_at": "ISO-8601",
  "completed_at": "ISO-8601",
  "mode": "full",
  "consistency_status": "consistent",
  "git_commit": "...",
  "database": {
    "collection_count": 0,
    "document_count": 0
  },
  "storage": {
    "object_count": 0,
    "total_bytes": 0
  },
  "models": {
    "snapshot_count": 0,
    "draft_count": 0,
    "active_count": 0
  },
  "encryption": {
    "enabled": true,
    "method": "gpg-recipient",
    "recipient_fingerprints": []
  },
  "integrity_report": "reports/integrity.json"
}
```

## 6. 本地工具设计

建议独立目录：

```text
tools/xueban-backup/
├── package.json
├── README.md
├── config/collections.json
└── src/
    ├── cli.js
    ├── preflight.js
    ├── inventory.js
    ├── database-export.js
    ├── storage-download.js
    ├── model-index.js
    ├── integrity.js
    ├── manifest.js
    ├── encryption.js
    └── verify.js
```

本地输出目录必须由操作者显式传入绝对路径。工具拒绝把真实备份写入项目 Git 工作区、`miniprogram/`、`cloudfunctions/` 或系统临时目录作为最终位置。

### 6.1 命令

```bash
# 只读盘点，不下载正文
node tools/xueban-backup/src/cli.js inventory \
  --env model-dev-d9gkoyaolb464c28d

# 全量备份
node tools/xueban-backup/src/cli.js backup \
  --env model-dev-d9gkoyaolb464c28d \
  --output /absolute/encrypted-backup-location \
  --gpg-recipient <fingerprint>

# 本地离线校验，不连接云端
node tools/xueban-backup/src/cli.js verify \
  --archive /absolute/path/xueban-backup-....tar.gpg

# 只生成恢复计划和 file_id 重映射要求，不写云端
node tools/xueban-backup/src/cli.js restore-plan \
  --archive /absolute/path/xueban-backup-....tar.gpg \
  --target-env <new-empty-environment>
```

V1.0 不提供无确认的 `restore`、`delete` 或远端清理命令。

### 6.2 依赖与鉴权

- 数据库优先使用 CloudBase 官方 JSON dump/export 能力；
- 云存储使用 `@cloudbase/manager-node` 枚举目录并获得下载能力；
- 当前本机未安装全局 `tcb` CLI；实施时在 `tools/xueban-backup` 内固定项目级 `@cloudbase/cli` / SDK 版本，不依赖或修改全局工具链；
- 本地脚本优先使用限定到目标环境、只读操作的临时凭证；
- 不在命令行参数、源码、`.env`、日志或 manifest 中保存 SecretKey；
- 允许读取标准凭证环境变量或临时 token，但日志必须屏蔽；
- 当前本机已有 GPG，使用接收方公钥指纹加密，不在脚本中保存口令。

若缺少 CLI、SDK、GPG 公钥或只读凭证，preflight 必须停止并明确报告，不能自动降级为未加密备份。

## 7. 全量备份执行顺序

1. Preflight：确认环境 ID、凭证权限、输出路径、磁盘空间、GPG 接收方、Git 状态；
2. 创建 `backup_id` 和安全临时目录；
3. 采集备份前集合计数、对象清单和最大更新时间；
4. 枚举全部集合并执行原生 JSON 导出；
5. 枚举全部云存储对象，流式下载到 `.part` 文件；
6. 每个文件下载完成后校验大小并计算 SHA-256，再原子改名；
7. 生成模型 snapshot 索引和 Subject 索引；
8. 执行跨集合、数据库—存储、模型引用完整性检查；
9. 再次采集集合计数和对象清单，判断备份期间源数据是否变化；
10. 生成 manifest、校验和与可读报告；
11. 使用 GPG 加密封装；
12. 对加密包执行一次解密可读性和内部校验抽查；
13. 成功后输出备份路径、大小、统计、异常和恢复就绪状态。

下载采用有限并发、重试、断点续传和 `.part` 文件，不能因单个音频失败而把整个备份错误标记为成功。

## 8. 完整性校验规则

至少检查：

1. `voice_records.file_id` 指向的云存储对象存在；
2. 云存储中的孤立对象仍被下载并列入 orphan 报告；
3. `messages.session_id` 对应 `sessions`；
4. `voice_records.message_id/session_id/subject_id` 相互一致；
5. `evidence.voice_id` 对应 `voice_records`；
6. `evidence.message_id` 对应 `messages`；
7. `evidence_analysis.evidence_id` 对应 `evidence`；
8. Analysis 的 subject/framework/variable 与 Evidence 一致；
9. `model_snapshots.source_evidence_ids[]` 全部存在；
10. `model_snapshots.source_analysis_ids[]` 全部存在；
11. snapshot 的 subject/framework 与 `subjects` 一致；
12. 同一 subject/framework 是否存在多个 active snapshot；
13. Teacher snapshot 是否保留 T1—T5 / 13 变量；
14. Student snapshot 是否保留 S1—S6 / 17 变量；
15. TEST 数据和非 TEST 数据是否被正确标记；
16. 所有导出文件和对象与 `checksums.sha256` 一致。

异常分级：

- `fatal`：对象/集合导出缺失、校验和失败、加密失败、关键 snapshot 无法解析；
- `warning`：孤立音频、历史兼容字段缺失、无 file_id 的模拟记录；
- `info`：空集合、未实现的计划集合、可重新计算的派生字段缺失。

只有 fatal = 0 的备份才能标记为 `restorable = true`。

## 9. 一致性策略

CloudBase 各集合和云存储之间没有由本工具控制的全局快照事务。V1.0 使用“前后双清单 + 引用校验”策略：

- 备份前记录每个集合数量、对象数量和最大更新时间；
- 备份后再次读取；
- 若期间发生变化，备份保留但标记 `consistency_status = changed_during_backup`；
- 自动重试一次；仍变化则要求在低采集时段重新运行。

真人采集规模扩大后，应安排固定低峰备份窗口或增加变更日志/增量备份机制。

## 10. 隐私与安全

备份包含教师和未成年人语音、转写、主体模型、身份关系与哈希编号，整体按高敏研究数据处理。

- 身份层与研究层在包内分目录，并允许以后使用不同接收方密钥；
- 最终包必须加密，明文不得进入 Git、网盘同步目录或普通聊天工具；
- 备份报告默认只显示计数和研究 ID，不显示转写、姓名、学号、bind code 或 hash；
- 操作日志不得输出完整临时下载 URL、SecretKey 或音频正文；
- 推荐至少两份加密副本：本地受控存储 + 离线/异地受控存储；
- 定期执行恢复演练，而不是只验证文件存在。

## 11. 恢复与迁移原则

恢复必须优先进入新的空白验证环境，不能直接覆盖当前真人采集环境。

建议顺序：

1. 恢复 School / Class / Subject 与组织关系；
2. 恢复身份和绑定层；
3. 恢复背景、任务和进度；
4. 恢复 Session / Message；
5. 上传云存储对象并生成 `old file_id → new file_id` 映射；
6. 用映射改写待导入的 `voice_records.file_id` 和 `evidence.file_id`；
7. 恢复 Voice、Evidence、Evidence Analysis；
8. 最后恢复全部 Model Snapshot；
9. 运行相同完整性检查；
10. 只读验证 Teacher / Student Current Model。

跨 CloudBase 环境或迁移到自建对象存储时，原 `cloud://` file ID 一定会变化，因此 `file-id-remap.json` 是恢复必要产物。Subject_ID、Evidence_ID、Analysis_ID、Snapshot_ID 应尽量保持不变，以保存研究可追溯性。

## 12. 当前基线与首轮验收

首次正式全量备份基线为：

- 数据库：19 个实际集合、631 条文档；
- 云存储 `voice/`：65 个 MP3；
- 总大小：5,722,748 bytes（约 5.46 MiB）；
- `voice_records`：79 条；
- 其中 63 条有 `file_id`；
- 16 条无 `file_id`，为模拟技术记录，不存在真实音频；
- 2 个云存储音频没有被 `voice_records` 引用，已作为 orphan 完整备份并报告，未删除；
- `model_snapshots`：2 条，Teacher active 1 条、Student active 1 条；
- 加密包包含 102 个校验文件，fatal = 0，备份期间源清单一致，`restorable = true`。

首轮全量备份通过标准：

- 所有实际集合均有 JSON 导出和数量记录；
- 所有云存储对象均已下载并通过 SHA-256；
- Teacher / Student 全部 snapshot（含 draft、active、历史和 TEST）均被索引；
- 两个潜在孤立文件得到明确结论；
- fatal = 0；
- 加密包能够离线解密并通过 `verify`；
- 从备份中能够为任一 Subject 追溯 Voice → Message → Evidence → Analysis → Snapshot；
- 不对云端业务数据进行任何写入、更新或删除。

## 13. 实施阶段

1. 建立 `tools/xueban-backup`、配置注册表、preflight 和 inventory；
2. 实现数据库原生 JSON 导出；
3. 实现云存储流式下载、断点续传和 SHA-256；
4. 实现 Model Snapshot 专项索引与引用校验；
5. 实现 manifest、报告与 GPG 加密；
6. 使用当前小体量数据执行首次全量备份；
7. 离线 verify；
8. 在新的空白测试环境设计恢复演练，恢复操作另行授权后执行。

## 14. 官方能力依据

- CloudBase 数据库 JSON 导出适用于完整备份和迁移：<https://docs.cloudbase.net/database/manage.html>
- CloudBase CLI `tcb db nosql dump` 支持把集合 JSON 导出并下载到本地：<https://docs.cloudbase.net/cli-v1/db/nosql/management>
- CloudBase SDK 支持通过 file ID 下载云存储文件：<https://docs.cloudbase.net/storage/sdk>
- Manager Node SDK 支持数据库、存储、函数和环境管理：<https://docs.cloudbase.net/api-reference/manager/node/introduction>
- CloudBase 支持对管理端访问密钥按环境和操作控制权限：<https://docs.cloudbase.net/cam/access-manage>
