/**
 * 角色素材包字母格构建脚本（一次性转换，可重复运行、确定性输出）。
 *
 * 输入：`<kitDir>/img/`——已经落盘的图像协议帧（`<key>/<两位帧号>.png`，
 * 288px 高、等比定宽、保留真实 alpha）与 `timings.json`。输出：与
 * `assets/deepy/frames.json` 同 schema 的字母格素材包 `<kitDir>/frames.json`：
 *
 *   { size: [42, 30], palette: { K: '#rrggbb', ... },
 *     animations: [{ key, title, frames: [{ dur, rows }] }] }
 *
 * 为什么源是 PNG 而不是 GIF（对比 scripts/build-whale-girl-kit.mjs）：这两套
 * 素材的 GIF 只是预览导出，alpha 被压成 1bit、且缺 idle 动画；`img/` 才是
 * 真源。脚本只做「缩到 42×30 字母格 + 全局调色板 + 合并连续同帧」，不再碰
 * 原始像素。
 *
 * 转换规则（与 build-whale-girl-kit.mjs 保持一致）：
 * - 每帧等比 contain 进 42×30 字母格，透明像素（alpha < 128）→ '.'，
 *   水平居中、两侧补 '.'；
 * - 跨全部动画统计网格分辨率下的主色直方图，近色聚成 ≤30 个单字符键
 *   （可打印非 '.' 字符，按出现频次降序分配），像素按最近质心归键；
 * - dur 沿用 timings.json；连续相同帧合并（dur 相加）；单动画超过 30 帧时
 *   等距抽帧并合并时长（当前两套素材都不超）。
 *
 * 用法：node scripts/build-girl-kit-from-frames.mjs assets/claudeGirl
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const sharp = require('sharp')

const COLUMNS = 42
const ROWS = 30
const ALPHA_THRESHOLD = 128
const PALETTE_MAX = 30
/** 近色合并阈值（RGB 欧氏距离；质心间小于它的两个簇并成一个）。 */
const MERGE_DISTANCE = 48
const FRAME_CAP = 30
/** 调色键字符表：可打印、非 '.'、按簇频次降序取用。 */
const PALETTE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** 动画 key → 中文标题。key 是 deepy 规范词汇表（22 键，与
 *  assets/whaleGirl/frames.json 同集）；标题只描述语义，两套素材共用——
 *  鲸娘那套的中文名来自源 GIF 文件名，这里没有源文件名可用。 */
const ANIMATION_TITLES = {
  'idle': '待机',
  'idle-look': '东张西望',
  'idle-spout': '开心冒星星',
  'thinking': '思考中',
  'typing': '敲代码',
  'music': '戴着耳机听歌',
  'conducting': '挥棒指挥',
  'building': '施工中',
  'error': '出错啦',
  'happy': '任务完成',
  'notification': '需要你确认',
  'compacting': '整理中',
  'carrying': '搬运东西',
  'sleeping': '打瞌睡',
  'waking': '被吵醒',
  'poke-left': '被戳左边',
  'poke-right': '被戳右边',
  'tickle': '被挠痒痒',
  'drag': '被拎起来',
  'swim': '游泳',
  'smile-hearts': '冒爱心',
  'thumbs-up': '点赞',
}

function fail(message) {
  throw new Error(message)
}

/** 校验 timings.json 形状（校验即拒绝：形状不对整份不可用，不出半成品）。 */
function parseTimings(raw, imgDir) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail('timings.json 顶层不是对象')
  const entries = []
  for (const [key, value] of Object.entries(raw)) {
    if (!Array.isArray(value) || value.length === 0) fail(key + ': 帧表为空或不是数组')
    const frames = value.map(entry => {
      if (entry === null || typeof entry !== 'object') fail(key + ': 帧项不是对象')
      if (typeof entry.dur !== 'number' || !Number.isFinite(entry.dur) || entry.dur <= 0) fail(key + ': dur 非法')
      if (typeof entry.file !== 'string' || !/^[0-9]{2}\.png$/.test(entry.file)) fail(key + ': 帧文件名非法')
      const path = join(imgDir, key, entry.file)
      if (!existsSync(path)) fail(key + ': 缺帧文件 ' + path)
      return { dur: Math.round(entry.dur), path }
    })
    entries.push({ key, frames })
  }
  if (entries.length === 0) fail('timings.json 没有任何动画')
  return entries
}

/** 一帧 PNG → 42×30 RGBA 网格（contain 居中，透明底）。 */
async function decodeGrid(path) {
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .resize(COLUMNS, ROWS, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (info.width !== COLUMNS || info.height !== ROWS || data.length !== COLUMNS * ROWS * 4) {
    fail('解码尺寸异常: ' + path)
  }
  return data
}

async function main() {
  const kitDir = resolve(process.argv[2] ?? process.cwd())
  const imgDir = join(kitDir, 'img')
  if (!existsSync(join(imgDir, 'timings.json'))) {
    fail('用法: node scripts/build-girl-kit-from-frames.mjs <素材包目录>（目录下要有 img/timings.json）')
  }
  const entries = parseTimings(JSON.parse(readFileSync(join(imgDir, 'timings.json'), 'utf8')), imgDir)

  // --- 1. 逐帧解码到网格 --------------------------------------------------
  for (const entry of entries) {
    const grids = await Promise.all(entry.frames.map(frame => decodeGrid(frame.path)))
    entry.frames = entry.frames.map((frame, index) => ({ dur: frame.dur, grid: grids[index] }))
    console.log('解码 ' + entry.key + ': ' + entry.frames.length + ' 帧')
  }

  // --- 2. 全局主色直方图（4bit/通道分箱，箱内加权平均）--------------------
  const bins = new Map()
  for (const entry of entries) {
    for (const frame of entry.frames) {
      for (let i = 0; i < frame.grid.length; i += 4) {
        if (frame.grid[i + 3] < ALPHA_THRESHOLD) continue
        const r = frame.grid[i]
        const g = frame.grid[i + 1]
        const b = frame.grid[i + 2]
        const binId = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
        const bin = bins.get(binId) ?? { r: 0, g: 0, b: 0, count: 0 }
        bin.r += r
        bin.g += g
        bin.b += b
        bin.count += 1
        bins.set(binId, bin)
      }
    }
  }
  // 确定性排序：count 降序，平手按箱 id 升序。
  const ordered = [...bins.entries()].sort((a, b) => b[1].count - a[1].count || a[0] - b[0])
  const centroid = bin => [Math.round(bin.r / bin.count), Math.round(bin.g / bin.count), Math.round(bin.b / bin.count)]
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

  // --- 3. 贪心聚类：近色（<=MERGE_DISTANCE）并入最近簇；簇数到 PALETTE_MAX
  //        后余色一律归最近簇。--------------------------------------------
  const clusters = [] // { rgb:[r,g,b], count }（count 是簇内像素数）
  for (const [, bin] of ordered) {
    const rgb = centroid(bin)
    let nearest = -1
    let nearestDist = Number.POSITIVE_INFINITY
    for (let i = 0; i < clusters.length; i += 1) {
      const d = distance(rgb, clusters[i].rgb)
      if (d < nearestDist) { nearestDist = d; nearest = i }
    }
    if (nearest >= 0 && (nearestDist <= MERGE_DISTANCE || clusters.length >= PALETTE_MAX)) {
      const cluster = clusters[nearest]
      const total = cluster.count + bin.count
      cluster.rgb = [
        Math.round((cluster.rgb[0] * cluster.count + rgb[0] * bin.count) / total),
        Math.round((cluster.rgb[1] * cluster.count + rgb[1] * bin.count) / total),
        Math.round((cluster.rgb[2] * cluster.count + rgb[2] * bin.count) / total),
      ]
      cluster.count = total
    } else {
      clusters.push({ rgb, count: bin.count })
    }
  }
  // 簇排序同样确定：count 降序，平手按颜色字典序。
  clusters.sort((a, b) => b.count - a.count || a.rgb[0] - b.rgb[0] || a.rgb[1] - b.rgb[1] || a.rgb[2] - b.rgb[2])
  if (clusters.length > PALETTE_MAX) fail('聚类结果超过 ' + PALETTE_MAX + ' 个键（不应发生）')
  const hex = rgb => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('')
  const palette = {}
  const paletteKeys = []
  clusters.forEach((cluster, index) => {
    const char = PALETTE_CHARS[index]
    palette[char] = hex(cluster.rgb)
    paletteKeys.push(char)
  })

  // --- 4. 像素归键 → rows；连续相同帧合并；超帧数上限等距抽帧 -------------
  const nearestKey = (r, g, b) => {
    let best = 0
    let bestDist = Number.POSITIVE_INFINITY
    for (let i = 0; i < clusters.length; i += 1) {
      const d = distance([r, g, b], clusters[i].rgb)
      if (d < bestDist) { bestDist = d; best = i }
    }
    return paletteKeys[best]
  }
  const usedKeys = new Set()
  const frameRows = grid => {
    const rows = []
    for (let y = 0; y < ROWS; y += 1) {
      let row = ''
      for (let x = 0; x < COLUMNS; x += 1) {
        const i = (y * COLUMNS + x) * 4
        if (grid[i + 3] < ALPHA_THRESHOLD) { row += '.'; continue }
        const key = nearestKey(grid[i], grid[i + 1], grid[i + 2])
        usedKeys.add(key)
        row += key
      }
      rows.push(row)
    }
    return rows
  }
  const mergeIdentical = frames => {
    const merged = []
    for (const frame of frames) {
      const last = merged[merged.length - 1]
      if (last !== undefined && last.rows.join('\n') === frame.rows.join('\n')) last.dur += frame.dur
      else merged.push(frame)
    }
    return merged
  }
  const capFrames = frames => {
    if (frames.length <= FRAME_CAP) return frames
    const kept = []
    let prev = -1
    for (let k = 0; k < FRAME_CAP; k += 1) {
      const index = Math.floor((k * frames.length) / FRAME_CAP)
      const dur = frames.slice(prev + 1, index + 1).reduce((sum, f) => sum + f.dur, 0)
      kept.push({ dur, rows: frames[index].rows })
      prev = index
    }
    return kept
  }

  const animations = entries.map(entry => {
    let frames = entry.frames.map(frame => ({ dur: frame.dur, rows: frameRows(frame.grid) }))
    const before = frames.length
    frames = capFrames(mergeIdentical(frames))
    console.log('  ' + entry.key + ' (' + (ANIMATION_TITLES[entry.key] ?? entry.key) + '): ' + before + ' 帧 -> ' + frames.length + ' 帧, 周期 ' + frames.reduce((s, f) => s + f.dur, 0) + 'ms')
    return { key: entry.key, title: ANIMATION_TITLES[entry.key] ?? entry.key, frames }
  })

  // 构建侧只保留实际用到的键（校验侧要求键全部在帧里出现过）。
  for (const key of Object.keys(palette)) {
    if (!usedKeys.has(key)) delete palette[key]
  }

  const kit = { size: [COLUMNS, ROWS], palette, animations }
  const json = JSON.stringify(kit)
  writeFileSync(join(kitDir, 'frames.json'), json, 'utf8')
  console.log('调色板 ' + Object.keys(palette).length + ' 键')
  console.log('写出 ' + join(kitDir, 'frames.json') + ' (' + Math.round(json.length / 1024) + 'KB, ' + animations.length + ' 动画, ' + animations.reduce((s, a) => s + a.frames.length, 0) + ' 帧)')
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
