const { canonicalSha256, writeJson } = require('./utils')

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function idSet(documents, field) {
  return new Set(
    asArray(documents)
      .map(item => item && item[field])
      .filter(Boolean)
      .map(String)
  )
}

function fileIdToCloudPath(fileId) {
  const value = String(fileId || '')
  if (!value) return ''
  if (value.startsWith('voice/')) return value
  const voiceIndex = value.indexOf('/voice/')
  if (voiceIndex >= 0) return value.slice(voiceIndex + 1)
  return ''
}

function addIssue(report, level, code, details = {}) {
  report.issues.push({ level, code, ...details })
  report.counts[`${level}_count`] += 1
}

function createModelIndex(collections) {
  const snapshots = asArray(collections.model_snapshots)
  const bySubject = {}
  const entries = snapshots.map(snapshot => {
    const dimensions = asArray(snapshot.model_data && snapshot.model_data.dimensions)
    const variableCount = dimensions.reduce(
      (sum, dimension) => sum + asArray(dimension.variables).length,
      0
    )
    const entry = {
      snapshot_id: snapshot.snapshot_id || snapshot._id,
      subject_id: snapshot.subject_id || null,
      subject_type: snapshot.subject_type || null,
      framework: snapshot.framework || null,
      status: snapshot.status || null,
      version: snapshot.version || snapshot.model_version || null,
      snapshot_type: snapshot.snapshot_type || snapshot.model_type || null,
      generation_method: snapshot.generation_method || null,
      generation_protocol: snapshot.generation_protocol || null,
      source_evidence_count: asArray(snapshot.source_evidence_ids).length,
      source_analysis_count: asArray(snapshot.source_analysis_ids).length,
      dimension_count: dimensions.length,
      variable_count: variableCount,
      model_data_sha256: canonicalSha256(snapshot.model_data || null),
      is_test: snapshot.is_test === true,
      created_at: snapshot.created_at || null,
      approved_at: snapshot.approved_at || null
    }
    const subjectKey = String(entry.subject_id || 'unknown')
    if (!bySubject[subjectKey]) bySubject[subjectKey] = []
    bySubject[subjectKey].push(entry.snapshot_id)
    return entry
  })

  return {
    schema_version: 'xueban_model_snapshot_index_v1.0',
    generated_at: new Date().toISOString(),
    snapshot_count: entries.length,
    entries,
    by_subject: bySubject
  }
}

function checkIntegrity(collections, storageInventory) {
  const report = {
    schema_version: 'xueban_backup_integrity_v1.0',
    generated_at: new Date().toISOString(),
    counts: {
      fatal_count: 0,
      warning_count: 0,
      info_count: 0
    },
    issues: [],
    storage: {
      referenced_object_count: 0,
      orphan_object_count: 0,
      missing_object_count: 0
    }
  }

  const sessions = asArray(collections.sessions)
  const messages = asArray(collections.messages)
  const voices = asArray(collections.voice_records)
  const evidence = asArray(collections.evidence)
  const analyses = asArray(collections.evidence_analysis)
  const snapshots = asArray(collections.model_snapshots)
  const subjects = asArray(collections.subjects)

  const sessionIds = idSet(sessions, 'session_id')
  const messageIds = idSet(messages, 'message_id')
  const voiceIds = idSet(voices, 'voice_id')
  const evidenceIds = idSet(evidence, 'evidence_id')
  const analysisIds = idSet(analyses, 'analysis_id')
  const subjectIds = idSet(subjects, 'subject_id')
  const storageKeys = new Set(asArray(storageInventory.files).map(item => item.key))
  const referencedStorageKeys = new Set()

  for (const message of messages) {
    if (message.session_id && !sessionIds.has(String(message.session_id))) {
      addIssue(report, 'warning', 'message_session_missing', {
        message_id: message.message_id,
        session_id: message.session_id
      })
    }
  }

  for (const voice of voices) {
    if (voice.session_id && !sessionIds.has(String(voice.session_id))) {
      addIssue(report, 'warning', 'voice_session_missing', {
        voice_id: voice.voice_id,
        session_id: voice.session_id
      })
    }
    if (voice.message_id && !messageIds.has(String(voice.message_id))) {
      addIssue(report, 'warning', 'voice_message_missing', {
        voice_id: voice.voice_id,
        message_id: voice.message_id
      })
    }

    const cloudPath = fileIdToCloudPath(voice.file_id)
    if (cloudPath) {
      referencedStorageKeys.add(cloudPath)
      if (!storageKeys.has(cloudPath)) {
        report.storage.missing_object_count += 1
        addIssue(report, 'fatal', 'voice_storage_object_missing', {
          voice_id: voice.voice_id,
          cloud_path: cloudPath
        })
      }
    } else if (!voice.file_id) {
      addIssue(
        report,
        voice.is_test === true || voice.test_source === 'simulated_transcript'
          ? 'info'
          : 'warning',
        'voice_record_without_file_id',
        { voice_id: voice.voice_id, is_test: voice.is_test === true }
      )
    } else {
      addIssue(report, 'warning', 'unrecognized_voice_file_id', {
        voice_id: voice.voice_id
      })
    }
  }

  for (const item of evidence) {
    if (item.voice_id && !voiceIds.has(String(item.voice_id))) {
      addIssue(report, 'warning', 'evidence_voice_missing', {
        evidence_id: item.evidence_id,
        voice_id: item.voice_id
      })
    }
    if (item.message_id && !messageIds.has(String(item.message_id))) {
      addIssue(report, 'warning', 'evidence_message_missing', {
        evidence_id: item.evidence_id,
        message_id: item.message_id
      })
    }
  }

  const evidenceById = new Map(
    evidence.filter(item => item.evidence_id).map(item => [String(item.evidence_id), item])
  )
  for (const analysis of analyses) {
    const source = evidenceById.get(String(analysis.evidence_id || ''))
    if (!source) {
      addIssue(report, 'fatal', 'analysis_evidence_missing', {
        analysis_id: analysis.analysis_id,
        evidence_id: analysis.evidence_id
      })
      continue
    }
    for (const field of ['subject_id', 'framework', 'variable_id']) {
      if (analysis[field] && source[field] && analysis[field] !== source[field]) {
        addIssue(report, 'fatal', 'analysis_evidence_mismatch', {
          analysis_id: analysis.analysis_id,
          evidence_id: analysis.evidence_id,
          field
        })
      }
    }
  }

  const activeGroups = new Map()
  for (const snapshot of snapshots) {
    const snapshotId = snapshot.snapshot_id || snapshot._id
    if (snapshot.subject_id && !subjectIds.has(String(snapshot.subject_id))) {
      addIssue(report, 'fatal', 'snapshot_subject_missing', {
        snapshot_id: snapshotId,
        subject_id: snapshot.subject_id
      })
    }
    for (const evidenceId of asArray(snapshot.source_evidence_ids)) {
      if (!evidenceIds.has(String(evidenceId))) {
        addIssue(report, 'fatal', 'snapshot_source_evidence_missing', {
          snapshot_id: snapshotId,
          evidence_id: evidenceId
        })
      }
    }
    for (const analysisId of asArray(snapshot.source_analysis_ids)) {
      if (!analysisIds.has(String(analysisId))) {
        addIssue(report, 'fatal', 'snapshot_source_analysis_missing', {
          snapshot_id: snapshotId,
          analysis_id: analysisId
        })
      }
    }

    const dimensions = asArray(snapshot.model_data && snapshot.model_data.dimensions)
    const variableCount = dimensions.reduce(
      (sum, dimension) => sum + asArray(dimension.variables).length,
      0
    )
    const expected = snapshot.framework === 'teacher_v1.0'
      ? 13
      : snapshot.framework === 'student_v1.0'
        ? 17
        : null
    if (expected !== null && variableCount !== expected) {
      addIssue(report, 'fatal', 'snapshot_variable_count_invalid', {
        snapshot_id: snapshotId,
        expected,
        actual: variableCount
      })
    }

    if (snapshot.status === 'active') {
      const key = `${snapshot.subject_id || ''}|${snapshot.framework || ''}`
      if (!activeGroups.has(key)) activeGroups.set(key, [])
      activeGroups.get(key).push(snapshotId)
    }
  }

  for (const [group, ids] of activeGroups.entries()) {
    if (ids.length > 1) {
      addIssue(report, 'fatal', 'duplicate_active_snapshots', {
        group,
        snapshot_ids: ids
      })
    }
  }

  const orphanKeys = [...storageKeys]
    .filter(key => !referencedStorageKeys.has(key))
    .sort()
  report.storage.referenced_object_count = referencedStorageKeys.size
  report.storage.orphan_object_count = orphanKeys.length
  if (orphanKeys.length > 0) {
    addIssue(report, 'warning', 'orphan_storage_objects', {
      count: orphanKeys.length,
      cloud_paths: orphanKeys
    })
  }

  report.restorable = report.counts.fatal_count === 0
  return report
}

function writeModelIndexes(modelsDirectory, modelIndex) {
  writeJson(`${modelsDirectory}/snapshot-index.json`, modelIndex)
  for (const [subjectId, snapshotIds] of Object.entries(modelIndex.by_subject)) {
    writeJson(`${modelsDirectory}/subjects/${subjectId}.json`, {
      subject_id: subjectId,
      snapshot_ids: snapshotIds
    })
  }
}

module.exports = {
  checkIntegrity,
  createModelIndex,
  fileIdToCloudPath,
  writeModelIndexes
}
