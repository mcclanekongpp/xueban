function getPixelRatio() {
  if (typeof wx.getWindowInfo === 'function') {
    return Number(wx.getWindowInfo().pixelRatio || 1)
  }

  return Number(wx.getSystemInfoSync().pixelRatio || 1)
}

function pointAt(centerX, centerY, radius, angle) {
  return {
    x: centerX + Math.cos(angle) * radius,
    y: centerY + Math.sin(angle) * radius
  }
}

function drawPolygon(ctx, points) {
  if (!points.length) return

  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y))
  ctx.closePath()
}

function drawModelProgressRadar(page, selector, dimensions) {
  const values = Array.isArray(dimensions) ? dimensions : []

  if (!page || values.length < 3) return

  wx.nextTick(() => {
    page.createSelectorQuery()
      .select(selector)
      .fields({ node: true, size: true })
      .exec((result) => {
        const target = result && result[0]

        if (!target || !target.node || !target.width || !target.height) return

        const canvas = target.node
        const ctx = canvas.getContext('2d')
        const pixelRatio = getPixelRatio()
        const width = target.width
        const height = target.height
        const centerX = width / 2
        const centerY = height / 2 + 4
        const radius = Math.min(width * 0.29, height * 0.31)
        const angleStep = (Math.PI * 2) / values.length
        const startAngle = -Math.PI / 2

        canvas.width = width * pixelRatio
        canvas.height = height * pixelRatio
        ctx.scale(pixelRatio, pixelRatio)
        ctx.clearRect(0, 0, width, height)
        ctx.lineJoin = 'round'

        for (let level = 1; level <= 4; level += 1) {
          const levelRadius = radius * (level / 4)
          const points = values.map((_, index) => pointAt(
            centerX,
            centerY,
            levelRadius,
            startAngle + index * angleStep
          ))
          drawPolygon(ctx, points)
          ctx.strokeStyle = level === 4 ? '#cfd9e5' : '#e5ebf2'
          ctx.lineWidth = 1
          ctx.stroke()
        }

        values.forEach((_, index) => {
          const edge = pointAt(centerX, centerY, radius, startAngle + index * angleStep)
          ctx.beginPath()
          ctx.moveTo(centerX, centerY)
          ctx.lineTo(edge.x, edge.y)
          ctx.strokeStyle = '#e1e7ef'
          ctx.lineWidth = 1
          ctx.stroke()
        })

        const progressPoints = values.map((item, index) => pointAt(
          centerX,
          centerY,
          radius * Math.max(0, Math.min(100, Number(item.progress_percent || 0))) / 100,
          startAngle + index * angleStep
        ))
        drawPolygon(ctx, progressPoints)
        ctx.fillStyle = 'rgba(47, 125, 225, 0.18)'
        ctx.fill()
        ctx.strokeStyle = '#2f7de1'
        ctx.lineWidth = 2
        ctx.stroke()

        progressPoints.forEach((point) => {
          ctx.beginPath()
          ctx.arc(point.x, point.y, 3, 0, Math.PI * 2)
          ctx.fillStyle = '#2f7de1'
          ctx.fill()
        })

        ctx.font = '12px sans-serif'
        ctx.fillStyle = '#596574'
        ctx.textBaseline = 'middle'

        values.forEach((item, index) => {
          const angle = startAngle + index * angleStep
          const labelPoint = pointAt(centerX, centerY, radius + 24, angle)
          const cosine = Math.cos(angle)
          ctx.textAlign = cosine > 0.2 ? 'left' : cosine < -0.2 ? 'right' : 'center'
          ctx.fillText(
            `${item.display_name || item.dimension_id} ${Number(item.progress_percent || 0)}%`,
            labelPoint.x,
            labelPoint.y
          )
        })
      })
  })
}

module.exports = {
  drawModelProgressRadar
}
