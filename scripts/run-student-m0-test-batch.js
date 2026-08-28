const path = require('path')
const { spawnSync } = require('child_process')

const cli = '/Applications/wechatwebdevtools.app/Contents/MacOS/wechatide'
const project = path.resolve(__dirname, '..')

function runStudentM0TestBatch() {
  return (async function () {
    function call(name, data) {
      return wx.cloud
        .callFunction({ name, data })
        .then((response) => response.result)
    }

    const subjectId = 'S_MTB6OGNQ_4F4DD'
    const transcripts = {
      'S1-3': 'TEST：我原来以为影子晚上才会有，后来在太阳下观察到自己也有影子，我才知道只要有光照着就可能有影子。',
      'S2-1': 'TEST：我把这些叶子按边缘分成两组，一组边缘光滑，一组边缘有小齿；同一组里大小可以不一样。',
      'S2-2': 'TEST：我猜冰块放在窗边会比放在阴凉处化得快，因为窗边有阳光，摸起来也更暖。',
      'S2-3': 'TEST：小车不往前走时，我先看轮子有没有卡住，又换了电池试，换电池后能走了，所以我判断原来的电池没电。',
      'S3-1': 'TEST：做拼图时外面很吵，我发现自己总看窗外，就把椅子转过来面对桌子，再从边上的拼图开始找。',
      'S3-2': 'TEST：第一次纸桥塌了，我把纸折成波浪形又试了一次，还减少了上面放的硬币，第二次撑得更久。',
      'S3-3': 'TEST：这道题我不确定，因为两个答案看起来都可以，我重新读了题目，还把自己的算法代回去检查。',
      'S4-1': 'TEST：我先告诉同学我觉得水会从高处流到低处，不明白他说的弯管时，我问他水为什么能往上走。',
      'S4-2': 'TEST：同学说植物不是只需要水，我听完问他是不是还需要阳光，然后想起窗边的花长得更好。',
      'S4-3': 'TEST：做模型时我想用纸盒，同伴想用积木，我们先分别说理由，最后用纸盒做底座、积木做上面的部分。',
      'S5-1': 'TEST：我看到蜗牛爬过会留下亮亮的线，很想知道是什么，就跟着观察了很久，还查了书里的蜗牛图片。',
      'S5-2': 'TEST：开始算错时我有点着急，觉得可能做不好，但我休息一下又从第一步重算，后来找到了写错的数字。',
      'S6-1': 'TEST：我最喜欢观察昆虫，因为它们的身体和行动很不一样。我养过蚕，每天都会看它有没有长大。',
      'S6-2': 'TEST：我和家人种过小番茄，每天浇水并记录高度，后来发现光照多的一盆长得更快。',
      'S6-3': 'TEST：遇到不懂的作业时，我会先自己读题，还是不会就请家人听我说卡在哪里，他们会提醒我看课本例题。'
    }

    for (let step = 0; step < 20; step += 1) {
      const state = await call('getNextStudentCollectionTask', {
        subject_id: subjectId,
        start: true
      })

      if (!state || !state.success) {
        wx.setStorageSync('studentM0BatchStatus', {
          ok: false,
          stage: 'state',
          result: state
        })
        return state
      }

      if (state.collection_completed) {
        wx.setStorageSync('studentM0BatchStatus', {
          ok: true,
          stage: 'completed',
          progress: state.progress
        })
        return state
      }

      const variableId = state.task.variable_id
      const transcript = transcripts[variableId]

      if (!transcript) {
        const result = { ok: false, stage: 'transcript', variable_id: variableId }
        wx.setStorageSync('studentM0BatchStatus', result)
        return result
      }

      wx.setStorageSync('studentM0BatchStatus', {
        ok: true,
        stage: 'session',
        variable_id: variableId,
        completed: state.progress.completed_tasks
      })

      const sessionResult = await call('createSession', {
        subject_id: subjectId,
        subject_type: 'student',
        session_type: 'initial_interview',
        task_id: state.task.task_id
      })

      if (!sessionResult || !sessionResult.success) {
        wx.setStorageSync('studentM0BatchStatus', {
          ok: false,
          stage: 'session',
          variable_id: variableId,
          result: sessionResult
        })
        return sessionResult
      }

      const sessionId = sessionResult.session.session_id
      const voice = await call('createStudentTestVoiceRecord', {
        session_id: sessionId,
        transcript
      })

      if (!voice || !voice.success) {
        wx.setStorageSync('studentM0BatchStatus', {
          ok: false,
          stage: 'voice',
          variable_id: variableId,
          result: voice
        })
        return voice
      }

      const evidence = await call('createStudentTaskEvidence', {
        session_id: sessionId
      })

      if (
        !evidence ||
        !evidence.success ||
        !Array.isArray(evidence.evidence) ||
        evidence.evidence.length === 0
      ) {
        wx.setStorageSync('studentM0BatchStatus', {
          ok: false,
          stage: 'evidence',
          variable_id: variableId,
          result: evidence
        })
        return evidence
      }

      for (const item of evidence.evidence) {
        let analysis = null

        for (let attempt = 1; attempt <= 3; attempt += 1) {
          wx.setStorageSync('studentM0BatchStatus', {
            ok: true,
            stage: 'analysis',
            variable_id: variableId,
            evidence_id: item.evidence_id,
            attempt,
            completed: state.progress.completed_tasks
          })
          analysis = await call('analyzeStudentEvidence', {
            evidence_id: item.evidence_id,
            save_analysis: true
          })
          if (analysis && analysis.success && analysis.saved) break
        }

        if (!analysis || !analysis.success || !analysis.saved) {
          wx.setStorageSync('studentM0BatchStatus', {
            ok: false,
            stage: 'analysis',
            variable_id: variableId,
            result: analysis
          })
          return analysis
        }
      }

      const completed = await call('completeStudentCollectionTask', {
        session_id: sessionId
      })

      if (!completed || !completed.success) {
        wx.setStorageSync('studentM0BatchStatus', {
          ok: false,
          stage: 'complete',
          variable_id: variableId,
          result: completed
        })
        return completed
      }

      wx.setStorageSync('studentM0BatchStatus', {
        ok: true,
        stage: 'advanced',
        variable_id: variableId,
        progress: completed.progress
      })

      if (completed.collection_completed) return completed
    }

    const limit = { ok: false, stage: 'loop_limit' }
    wx.setStorageSync('studentM0BatchStatus', limit)
    return limit
  })()
}

const result = spawnSync(
  cli,
  [
    '-c',
    'codex',
    'automation_evaluate',
    '--project',
    project,
    '--fn-source',
    runStudentM0TestBatch.toString()
  ],
  { encoding: 'utf8' }
)

if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)

// The WeChatIDE wrapper stops waiting after about ten seconds, while the
// Promise keeps running inside the Mini Program runtime. Progress is exposed
// through studentM0BatchStatus and the database remains the source of truth.
if (result.status && result.status !== 0) {
  console.log('Student-M0 batch launched; monitor studentM0BatchStatus.')
}
