/**
 * Browser half of the Project Teams bundle: the project workbench.
 *
 * The Client module loader loads this file as a lazy factory whose id equals the
 * package name; the returned plugin registers its React entries into slots the
 * Host already declares:
 *
 * - `sidebar.panellist` — the icon row that opens the workbench;
 * - `main` (keyed `project-teams`) — the full main-area workbench;
 * - `plugins.row.config` / `plugins.bundle.config` / `settings.plugins.tab` —
 *   the same workbench inside Plugin Manager and Settings.
 *
 * Every value on screen comes from the Host API at `project-teams/api/*` on the
 * page's own origin. The page holds no authoritative project state: it renders
 * Host answers, sends intent, and shows the Host's refusal verbatim.
 */
window.__ModuleLoader__.load({
  id: 'dsh-project-teams',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const PANEL_ID = 'project-teams'

    /** Resolve one Host API route against the page base (prefix-safe). */
    const apiUrl = (method) => {
      const base = typeof document === 'undefined' ? 'http://localhost/' : document.baseURI
      return new URL(`project-teams/api/${method}`, base).toString()
    }

    /** Call one Host API method and unwrap the Host envelope. */
    const call = async (method, body) => {
      const response = await fetch(apiUrl(method), body === undefined
        ? { method: 'GET', headers: { accept: 'application/json' }, credentials: 'same-origin' }
        : {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(body),
            credentials: 'same-origin',
          })
      let payload
      try {
        payload = await response.json()
      } catch {
        throw new Error(`Host API ${method} returned HTTP ${response.status} without a JSON body`)
      }
      if (payload?.ok !== true) {
        const error = new Error(`${payload?.error?.code ?? 'unknown'}: ${payload?.error?.message ?? `HTTP ${response.status}`}`)
        error.code = payload?.error?.code
        error.details = payload?.error?.details
        throw error
      }
      return payload.value
    }

    const T = {
      text: 'var(--dsw-text-primary, inherit)',
      muted: 'var(--dsw-text-secondary, #667085)',
      border: 'var(--dsw-border-default, #d0d5dd)',
      subtle: 'var(--dsw-border-subtle, rgba(16,24,40,.08))',
      panel: 'var(--dsw-bg-panel, transparent)',
      accent: 'var(--dsw-accent-default, #2563eb)',
      mono: 'var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
    }

    /** Shared design tokens for the workspace shell (v1.1 U5). */
    const TOKENS = {
      radius: { sm: 6, md: 8, lg: 12 },
      space: { xs: 4, sm: 6, md: 8, lg: 12 },
      font: { xs: 10.5, sm: 11.5, md: 12.5, lg: 14 },
      status: { ok: '#05603a', warn: '#b54708', err: '#b42318', info: '#175cd3', muted: '#475467' },
    }

    /**
     * Current viewport width, so the workspace can degrade on narrow windows
     * instead of squashing three fixed columns.
     * @returns {number} window width in CSS pixels.
     */
    function useViewportWidth() {
      const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth))
      useEffect(() => {
        if (typeof window === 'undefined') return undefined
        const onResize = () => setWidth(window.innerWidth)
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [])
      return width
    }

    const S = {
      page: { display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, height: '100%', padding: '4px 2px 16px' },
      header: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
      title: { fontSize: 15, fontWeight: 650, margin: 0 },
      muted: { fontSize: 12, color: T.muted, margin: 0, lineHeight: 1.6 },
      card: { border: `1px solid ${T.border}`, borderRadius: 12, padding: 12, display: 'grid', gap: 10, background: T.panel, minHeight: 0 },
      row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      grow: { flex: 1, minWidth: 0 },
      tabs: { display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: `1px solid ${T.border}`, paddingBottom: 6 },
      tab: (active) => ({
        padding: '5px 11px',
        borderRadius: 8,
        border: `1px solid ${active ? T.accent : 'transparent'}`,
        background: active ? 'rgba(37,99,235,.10)' : 'transparent',
        color: active ? T.accent : T.text,
        font: 'inherit',
        fontSize: 12.5,
        cursor: 'pointer',
      }),
      button: {
        padding: '5px 10px',
        borderRadius: 7,
        border: `1px solid ${T.border}`,
        background: 'transparent',
        color: T.text,
        font: 'inherit',
        fontSize: 12.5,
        cursor: 'pointer',
      },
      primary: {
        padding: '5px 11px',
        borderRadius: 7,
        border: `1px solid ${T.accent}`,
        background: T.accent,
        color: '#fff',
        font: 'inherit',
        fontSize: 12.5,
        cursor: 'pointer',
      },
      danger: {
        padding: '5px 10px',
        borderRadius: 7,
        border: '1px solid rgba(180,35,24,.45)',
        background: 'transparent',
        color: '#b42318',
        font: 'inherit',
        fontSize: 12.5,
        cursor: 'pointer',
      },
      input: {
        padding: '5px 8px',
        borderRadius: 7,
        border: `1px solid ${T.border}`,
        background: 'var(--dsw-bg-input, transparent)',
        color: T.text,
        font: 'inherit',
        fontSize: 12.5,
        minWidth: 0,
      },
      area: {
        padding: '6px 8px',
        borderRadius: 7,
        border: `1px solid ${T.border}`,
        background: 'var(--dsw-bg-input, transparent)',
        color: T.text,
        font: 'inherit',
        fontSize: 12.5,
        minHeight: 64,
        resize: 'vertical',
        width: '100%',
        boxSizing: 'border-box',
      },
      table: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
      th: { textAlign: 'left', padding: '6px 8px', color: T.muted, fontWeight: 500, borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' },
      td: { padding: '6px 8px', borderBottom: `1px solid ${T.subtle}`, verticalAlign: 'top' },
      code: { fontFamily: T.mono, fontSize: 11.5, wordBreak: 'break-all' },
      scroll: { overflow: 'auto', minHeight: 0, flex: 1 },
      empty: { fontSize: 12.5, color: T.muted, padding: '10px 2px' },
    }

    const ACTION_ZH = { submit: '提交', assign: '分配', block: '标记阻塞', unblock: '解除阻塞', submit_review: '提交评审', verify: '验证', reject: '退回返工', rework_ready: '可返工', complete: '完成', cancel: '取消' }

    const STATUS_LABEL = {
      DRAFT: '草稿',
      READY: '就绪',
      ASSIGNED: '已分配',
      RUNNING: '运行中',
      IN_REVIEW: '评审中',
      VERIFIED: '已验证',
      DONE: '完成',
      BLOCKED: '阻塞',
      REWORK: '返工',
      CANCELLED: '已取消',
      PASS: '通过',
      FAIL: '不通过',
      NEEDS_HUMAN: '待人工',
      INCOMPLETE: '未完成',
      STALE: '已过期',
      QUEUED: '已入队',
      CLAIMED: '已领取',
      DELIVERED: '已投递',
      PROCESSED: '已处理',
      DEAD_LETTER: '死信',
      DISCARDED: '已丢弃',
      PENDING: '待处理',
      APPROVED: '已批准',
      REJECTED: '已拒绝',
      APPROVE: '批准',
      CHANGES_REQUESTED: '要求修改',
      INCONCLUSIVE: '无法判定',
      ONLINE: '在线',
      COLD: '冷会话',
      MISSING: '缺失',
      ACTIVE: '进行中',
      PAUSED: '已暂停',
      ARCHIVED: '已归档',
      EXECUTED: '已执行',
    }

    const STATUS_COLOR = {
      DRAFT: ['#475467', 'rgba(71,84,103,.12)'],
      READY: ['#175cd3', 'rgba(23,92,211,.12)'],
      ASSIGNED: ['#7a5af8', 'rgba(122,90,248,.14)'],
      RUNNING: ['#0e7490', 'rgba(14,116,144,.14)'],
      IN_REVIEW: ['#b54708', 'rgba(181,71,8,.14)'],
      VERIFIED: ['#05603a', 'rgba(5,96,58,.12)'],
      DONE: ['#05603a', 'rgba(16,185,129,.16)'],
      BLOCKED: ['#b42318', 'rgba(180,35,24,.12)'],
      REWORK: ['#b54708', 'rgba(181,71,8,.16)'],
      CANCELLED: ['#667085', 'rgba(102,112,133,.12)'],
      PASS: ['#05603a', 'rgba(16,185,129,.16)'],
      FAIL: ['#b42318', 'rgba(180,35,24,.12)'],
      NEEDS_HUMAN: ['#b54708', 'rgba(181,71,8,.16)'],
      INCOMPLETE: ['#475467', 'rgba(71,84,103,.12)'],
      STALE: ['#7a5af8', 'rgba(122,90,248,.14)'],
      QUEUED: ['#475467', 'rgba(71,84,103,.12)'],
      CLAIMED: ['#175cd3', 'rgba(23,92,211,.12)'],
      DELIVERED: ['#0e7490', 'rgba(14,116,144,.14)'],
      PROCESSED: ['#05603a', 'rgba(16,185,129,.16)'],
      DEAD_LETTER: ['#b42318', 'rgba(180,35,24,.12)'],
      DISCARDED: ['#667085', 'rgba(102,112,133,.12)'],
      PENDING: ['#b54708', 'rgba(181,71,8,.16)'],
      APPROVED: ['#05603a', 'rgba(16,185,129,.16)'],
      REJECTED: ['#b42318', 'rgba(180,35,24,.12)'],
      APPROVE: ['#05603a', 'rgba(16,185,129,.16)'],
      CHANGES_REQUESTED: ['#b42318', 'rgba(180,35,24,.12)'],
      INCONCLUSIVE: ['#475467', 'rgba(71,84,103,.12)'],
    }

    function Badge({ value, label }) {
      const [color, background] = STATUS_COLOR[value] ?? ['#475467', 'rgba(71,84,103,.12)']
      return h('span', {
        style: { fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 999, color, background, whiteSpace: 'nowrap' },
      }, label ?? STATUS_LABEL[value] ?? value)
    }

    function Button({ children, onClick, kind = 'default', disabled, title }) {
      const style = kind === 'primary' ? S.primary : kind === 'danger' ? S.danger : S.button
      return h('button', { type: 'button', style: { ...style, opacity: disabled ? 0.55 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }, onClick, disabled, title }, children)
    }

    function Field({ label, children, hint }) {
      return h('label', { style: { display: 'grid', gap: 3, fontSize: 11.5, color: T.muted } },
        h('span', null, label),
        children,
        hint === undefined ? null : h('span', { style: { fontSize: 11, opacity: 0.8 } }, hint))
    }

    function Table({ columns, rows, empty }) {
      if (rows.length === 0) return h('div', { style: S.empty }, empty ?? '暂无内容。')
      return h('div', { style: S.scroll },
        h('table', { style: S.table },
          h('thead', null, h('tr', null, columns.map((column) => h('th', { key: column.key, style: { ...S.th, width: column.width } }, column.title)))),
          h('tbody', null, rows.map((row, index) => h('tr', { key: row.key ?? index },
            columns.map((column) => h('td', { key: column.key, style: S.td }, column.render(row, index))))))))
    }

    const when = (value) => {
      if (value === null || value === undefined) return '—'
      const date = new Date(Number(value))
      if (Number.isNaN(date.getTime())) return '—'
      return date.toLocaleString()
    }
    const short = (value, size = 12) => (typeof value === 'string' ? value.slice(0, size) : '—')

    // ------------------------------------------------------------ workbench

    // ------------------------------------------------------------ v1.1 shell

    /** Role accent colours used by canvas nodes and the left rail. */
    const ROLE_COLOR = {
      pm: '#7a5af8',
      developer: '#175cd3',
      reviewer: '#b54708',
      qa: '#0e7490',
    }

    /** Accent for a role, falling back to a neutral tone for custom roles. */
    const roleColor = (role) => ROLE_COLOR[role] ?? '#475467'

    /** Short label for one liveness value. */
    const LIVENESS = { running: '执行中', online: '在线', cold: '冷会话', missing: '缺失' }

    /** Format an epoch millisecond timestamp as a compact time. */
    const clock = (value) => {
      if (value === null || value === undefined) return '—'
      const date = new Date(Number(value))
      if (Number.isNaN(date.getTime())) return '—'
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    /** "3 分钟前" style relative time. */
    const ago = (value) => {
      if (value === null || value === undefined) return '—'
      const diff = Date.now() - Number(value)
      if (diff < 60_000) return '刚刚'
      if (diff < 3_600_000) return Math.round(diff / 60_000) + ' 分钟前'
      if (diff < 86_400_000) return Math.round(diff / 3_600_000) + ' 小时前'
      return Math.round(diff / 86_400_000) + ' 天前'
    }

    /** One-line summary of an edge for the inspector. */
    const edgeKindLabel = { collaboration: '协作', communication: '通信', handoff: '交接' }

    /**
     * Left rail: project switcher plus the live team of the selected project.
     * Selecting a Bot opens it in the inspector; it never creates a Session.
     */
    function LeftRail({ projects, selected, onSelectProject, teams, selectedBotId, onSelectBot, onManage }) {
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, height: '100%', overflow: 'auto', paddingRight: 4 } },
        h('div', { style: { display: 'grid', gap: 4 } },
          h('div', { style: { fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: T.muted } }, '项目'),
          projects.length === 0
            ? h('div', { style: S.muted }, '尚无项目')
            : projects.map((project) => h('button', {
                key: project.id,
                type: 'button',
                onClick: () => onSelectProject(project.id),
                style: {
                  textAlign: 'left',
                  padding: '6px 8px',
                  borderRadius: 8,
                  border: '1px solid ' + (project.id === selected ? T.accent : 'transparent'),
                  background: project.id === selected ? 'rgba(37,99,235,.10)' : 'transparent',
                  color: project.id === selected ? T.accent : T.text,
                  font: 'inherit',
                  fontSize: 12.5,
                  cursor: 'pointer',
                },
              }, project.name))),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
          h('div', { style: { fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: T.muted, flex: 1 } }, '团队'),
          h(Button, { onClick: onManage }, '管理')),
        teams.length === 0
          ? h('div', { style: S.muted }, '尚无 Bot')
          : teams.map((bot) => {
              const active = bot.id === selectedBotId
              const live = bot.liveness?.state ?? 'missing'
              return h('button', {
                key: bot.id,
                type: 'button',
                onClick: () => onSelectBot(bot.id),
                style: {
                  display: 'grid',
                  gap: 2,
                  textAlign: 'left',
                  padding: '7px 8px',
                  borderRadius: 9,
                  border: '1px solid ' + (active ? T.accent : T.border),
                  background: active ? 'rgba(37,99,235,.08)' : 'transparent',
                  color: T.text,
                  font: 'inherit',
                  cursor: 'pointer',
                },
              },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                  h('span', { style: { width: 7, height: 7, borderRadius: 999, background: roleColor(bot.role), flex: 'none' } }),
                  h('span', { style: { fontSize: 12.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em' } }, bot.label || bot.role),
                  h('span', { style: { flex: 1 } }),
                  h('span', { style: { fontSize: 10.5, color: live === 'missing' ? '#b42318' : T.muted } }, LIVENESS[live] ?? live)),
                h('div', { style: { fontSize: 11, color: T.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                  bot.currentTask === null ? '空闲' : bot.currentTask.id + ' ' + bot.currentTask.title))
            }),
      )
    }

    /**
     * Dependency-free flow canvas: HTML nodes over an SVG edge layer.
     *
     * React Flow is not available to a plugin Client module (its `require` only
     * resolves the module table), so the interaction model is implemented here:
     * drag nodes, wheel zoom, drag background to pan, fit to view, and persist
     * positions through `canvas.save`. Nodes are real Bots; edges are the three
     * kinds the Host projects from real rows.
     */
    function CanvasView({ canvas, canvasWindow, onWindow, selectedBotId, onSelectBot, onSelectEdge, selectedEdgeId, onSaveLayout, busy }) {
      const [show, setShow] = useState({ collaboration: true, communication: true, handoff: true })
      const [positions, setPositions] = useState({})
      const [view, setView] = useState({ x: 0, y: 0, zoom: 1 })
      const [drag, setDrag] = useState(null)
      const [pan, setPan] = useState(null)
      const surface = useRef(null)
      const nodes = canvas?.nodes ?? []
      const edges = (canvas?.edges ?? []).filter((edge) => show[edge.kind] !== false)
      const nodeById = useMemo(() => Object.fromEntries(nodes.map((node) => [node.botId, node])), [nodes])
      const NODE_W = 208
      const NODE_H = 92

      const fitted = useRef('')

      positionsRef.current = positions

      // Seed positions once per project: saved coordinates win, new Bots get a grid slot.
      // After seeding, fit the view once so a first-time project is not off-screen.
      useEffect(() => {
        if (canvas === null || canvas === undefined) return
        const saved = new Map((canvas.layout?.nodes ?? []).map((node) => [node.botId, node]))
        /** @type {Record<string, {x: number, y: number}>} */
        const next = {}
        nodes.forEach((node, index) => {
          const hit = saved.get(node.botId)
          if (hit !== undefined) {
            next[node.botId] = { x: hit.x, y: hit.y }
            return
          }
          const columns = Math.max(2, Math.ceil(Math.sqrt(nodes.length)))
          next[node.botId] = {
            x: 80 + (index % columns) * (NODE_W + 80),
            y: 80 + Math.floor(index / columns) * (NODE_H + 110),
          }
        })
        setPositions((current) => (Object.keys(current).length === 0 ? next : { ...next, ...current }))
        if (canvas.layout?.view !== undefined && canvas.layout.view !== null) {
          const saved = canvas.layout.view
          setView((current) => (current.x === 0 && current.y === 0 && current.zoom === 1 ? { x: saved.x, y: saved.y, zoom: saved.zoom } : current))
        }
        // One automatic fit per project opening; afterwards the user owns the viewport.
        const key = String(canvas?.project?.id ?? '')
        if (key !== '' && fitted.current !== key) {
          fitted.current = key
          setTimeout(() => { try { fitRef.current?.() } catch { /* fit is cosmetic */ } }, 60)
        }
      }, [canvas?.project?.id, nodes.length])

      const fitRef = useRef(null)
      const positionsRef = useRef({})

      const persist = useCallback((nextPositions, nextView) => {
        const payload = {
          nodes: Object.entries(nextPositions).map(([botId, point]) => ({ botId, x: point.x, y: point.y })),
          view: nextView,
        }
        onSaveLayout(payload)
      }, [onSaveLayout])

      const toLocal = (event) => {
        const rect = surface.current?.getBoundingClientRect()
        return {
          x: event.clientX - (rect?.left ?? 0),
          y: event.clientY - (rect?.top ?? 0),
        }
      }

      const onWheel = (event) => {
        event.preventDefault()
        const point = toLocal(event)
        setView((current) => {
          const nextZoom = Math.max(0.3, Math.min(2.5, current.zoom * (event.deltaY > 0 ? 0.9 : 1.1)))
          const ratio = nextZoom / current.zoom
          const next = {
            zoom: nextZoom,
            x: point.x - (point.x - current.x) * ratio,
            y: point.y - (point.y - current.y) * ratio,
          }
          return next
        })
      }

      const fit = () => {
        if (nodes.length === 0) return
        const rect = surface.current?.getBoundingClientRect()
        const width = rect?.width ?? 800
        const height = rect?.height ?? 520
        const xs = nodes.map((node) => (positions[node.botId]?.x ?? 0))
        const ys = nodes.map((node) => (positions[node.botId]?.y ?? 0))
        const minX = Math.min(...xs)
        const minY = Math.min(...ys)
        const maxX = Math.max(...xs) + NODE_W
        const maxY = Math.max(...ys) + NODE_H
        const zoom = Math.max(0.3, Math.min(1.4, Math.min((width - 80) / Math.max(200, maxX - minX), (height - 80) / Math.max(160, maxY - minY))))
        const next = { zoom, x: (width - (maxX - minX) * zoom) / 2 - minX * zoom, y: (height - (maxY - minY) * zoom) / 2 - minY * zoom }
        setView(next)
        persist(positions, next)
      }

      fitRef.current = fit

      /**
       * Drag a node with window-level pointer listeners.
       *
       * React's synthetic pointermove only fires while the pointer stays inside the
       * element that owns the handler; capturing the pointer on the node then leaves
       * the canvas surface without events (the node simply did not move under a real
       * mouse). Listening on window for the duration of the gesture removes that whole
       * class of failure and keeps the math in world coordinates.
       */
      const onNodePointerDown = (event, node) => {
        event.stopPropagation()
        onSelectBot(node.botId)
        const start = toLocal(event)
        const origin = positions[node.botId] ?? { x: 0, y: 0 }
        const zoom = view.zoom
        const move = (moveEvent) => {
          const point = toLocal(moveEvent)
          setPositions((current) => {
            const next = {
              ...current,
              [node.botId]: { x: Math.round(origin.x + (point.x - start.x) / zoom), y: Math.round(origin.y + (point.y - start.y) / zoom) },
            }
            positionsRef.current = next
            return next
          })
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          // Persist from the ref: side effects inside a state updater are dropped when
          // React bails out or the subtree unmounts, which is what a drag-end does.
          persist(positionsRef.current, view)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }

      const onPointerMove = (event) => {
        const point = toLocal(event)
        if (drag !== null) {
          const next = {
            ...positions,
            [drag.botId]: { x: Math.round((point.x - view.x - drag.dx) / view.zoom), y: Math.round((point.y - view.y - drag.dy) / view.zoom) },
          }
          setPositions(next)
          return
        }
        if (pan !== null) {
          setView((current) => ({ ...current, x: pan.view.x + (point.x - pan.start.x), y: pan.view.y + (point.y - pan.start.y) }))
        }
      }

      const finish = () => {
        if (drag !== null) {
          const next = positions
          setDrag(null)
          persist(next, view)
        }
        if (pan !== null) {
          setPan(null)
          persist(positions, view)
        }
      }

      /**
       * Band routing: exit the source box from its top (or bottom) edge, run along a
       * horizontal band outside every box, then drop into the target from the same
       * side. The old lane routing still crossed node bodies whenever the horizontal
       * run shared a row with another box.
       */
      const bounds = () => {
        const list = Object.values(positions)
        if (list.length === 0) return { top: 0, bottom: NODE_H, left: 0, right: NODE_W }
        return {
          top: Math.min(...list.map((point) => point.y)),
          bottom: Math.max(...list.map((point) => point.y)) + NODE_H,
          left: Math.min(...list.map((point) => point.x)),
          right: Math.max(...list.map((point) => point.x)) + NODE_W,
        }
      }

      const path = (from, to, index = 0) => {
        const a = positions[from]
        const b = positions[to]
        if (a === undefined || b === undefined) return ''
        const box = bounds()
        const ax = a.x + NODE_W / 2
        const bx = b.x + NODE_W / 2
        const ayCentre = a.y + NODE_H / 2
        const byCentre = b.y + NODE_H / 2
        const down = byCentre >= ayCentre
        // Stagger parallel edges so two links between different pairs stay readable.
        const offset = 44 + (index % 8) * 30
        const band = down ? box.bottom + offset : box.top - offset
        const startY = down ? a.y + NODE_H : a.y
        const endY = down ? b.y + NODE_H : b.y
        const radius = 10
        const dir = down ? 1 : -1
        return [
          'M ' + ax + ' ' + startY,
          'L ' + ax + ' ' + (band - radius * dir),
          'Q ' + ax + ' ' + band + ', ' + (ax + radius * Math.sign(bx - ax || 1)) + ' ' + band,
          'L ' + (bx - radius * Math.sign(bx - ax || 1)) + ' ' + band,
          'Q ' + bx + ' ' + band + ', ' + bx + ' ' + (band + radius * dir),
          'L ' + bx + ' ' + endY,
        ].join(' ')
      }

      const stroke = { collaboration: 'rgba(71,84,103,.45)', communication: T.accent, handoff: '#b54708' }
      const dash = { collaboration: '5 5', communication: '0', handoff: '0' }

      return h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', gap: 8 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h('strong', { style: { fontSize: 13 } }, 'Agent Flow'),
          [['collaboration', '协作关系'], ['communication', '实际通信'], ['handoff', '任务交接']].map(([kind, label]) =>
            h('label', { key: kind, style: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: T.muted, cursor: 'pointer' } },
              h('input', {
                type: 'checkbox',
                checked: show[kind] !== false,
                onChange: (event) => setShow({ ...show, [kind]: event.target.checked }),
              }),
              h('span', { style: { width: 14, height: 0, borderTop: '2px ' + (kind === 'collaboration' ? 'dashed' : 'solid') + ' ' + stroke[kind] } }),
              label)),
          h('span', { style: S.grow }),
          h('select', { style: { ...S.input, maxWidth: 150 }, value: canvasWindow, onChange: (event) => onWindow(Number(event.target.value)) },
            h('option', { value: 60 }, '近 1 小时'),
            h('option', { value: 1440 }, '近 24 小时'),
            h('option', { value: 10080 }, '近 7 天')),
          h(Button, { onClick: fit }, '适配视图'),
          h(Button, {
            onClick: () => {
              const next = {}
              nodes.forEach((node, index) => { next[node.botId] = { x: 80 + index * 260, y: 120 } })
              setPositions(next)
              positionsRef.current = next
              persist(next, { x: 0, y: 0, zoom: 1 })
              setView({ x: 0, y: 0, zoom: 1 })
            },
          }, '自动排布'),
          h(Button, { onClick: () => { const reset = { x: 0, y: 0, zoom: 1 }; setView(reset); persist(positions, reset) } }, '重置'),
          h('span', { style: { ...S.muted, minWidth: 54, textAlign: 'right' } }, Math.round(view.zoom * 100) + '%'),
          busy === '' ? null : h('span', { style: S.muted }, '处理中…')),
        h('div', {
          ref: surface,
          onWheel,
          onPointerDown: (event) => {
            if (event.button !== 0) return
            const point = toLocal(event)
            setPan({ start: point, view })
            event.currentTarget.setPointerCapture?.(event.pointerId)
          },
          onPointerMove,
          onPointerUp: finish,
          onPointerLeave: finish,
          style: {
            position: 'relative',
            flex: 1,
            minHeight: 380,
            overflow: 'hidden',
            borderRadius: 12,
            border: '1px solid ' + T.border,
            background: 'radial-gradient(circle at 1px 1px, rgba(128,128,128,.22) 1px, transparent 0) 0 0/22px 22px, var(--dsw-bg-panel, transparent)',
            cursor: drag !== null ? 'grabbing' : pan !== null ? 'grabbing' : 'grab',
            touchAction: 'none',
            userSelect: 'none',
          },
        },
          canvas === null
            ? h('div', { style: { ...S.empty, position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' } }, '正在读取团队与消息…')
            : nodes.length === 0
              ? h('div', { style: { ...S.empty, position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' } }, '还没有 Bot。先在「团队」里生成团队，画布会显示真实节点。')
              : null,
          h('div', { style: { position: 'absolute', left: 0, top: 0, transform: 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.zoom + ')', transformOrigin: '0 0', width: 1, height: 1 } },
            h('svg', { style: { position: 'absolute', left: 0, top: 0, width: 6000, height: 4000, overflow: 'visible', pointerEvents: 'none' } },
              h('defs', null,
                Object.entries(stroke).map(([kind, color]) =>
                  h('marker', {
                    key: kind,
                    id: 'pt-arrow-' + kind,
                    viewBox: '0 0 10 10',
                    refX: 9,
                    refY: 5,
                    markerWidth: 6,
                    markerHeight: 6,
                    orient: 'auto-start-reverse',
                  }, h('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: color })))),
              edges.map((edge, edgeIndex) => {
                const selected = edge.id === selectedEdgeId
                return h('path', {
                  key: edge.id,
                  d: path(edge.from, edge.to, edgeIndex),
                  fill: 'none',
                  stroke: selected ? '#b42318' : stroke[edge.kind],
                  strokeWidth: selected ? 2.6 : edge.kind === 'collaboration' ? 1.2 : 1.8,
                  strokeDasharray: dash[edge.kind],
                  markerEnd: 'url(#pt-arrow-' + edge.kind + ')',
                  pointerEvents: 'stroke',
                  style: { cursor: 'pointer' },
                  onPointerDown: (event) => { event.stopPropagation() },
                  onClick: (event) => { event.stopPropagation(); onSelectEdge(edge) },
                })
              })),
            edges.filter((edge) => edge.kind !== 'collaboration' && positions[edge.from] !== undefined && positions[edge.to] !== undefined).map((edge, labelIndex) => {
              const a = positions[edge.from]
              const b = positions[edge.to]
              // Sit the chip on the vertical run of the orthogonal route, which is
              // always between the two columns and therefore clear of node bodies.
              const box = bounds()
              const down = (b.y + NODE_H / 2) >= (a.y + NODE_H / 2)
              const offset = 44 + (labelIndex % 8) * 30
              // Spread labels along the run: adjacent pairs used to stack their chips at the
              // same midpoint, which is why four labels collided in the middle.
              const aCentre = a.x + NODE_W / 2
              const bCentre = b.x + NODE_W / 2
              const share = 0.22 + (labelIndex % 4) * 0.18
              const left = aCentre + (bCentre - aCentre) * share
              const top = down ? box.bottom + offset - 18 : box.top - offset + 18
              return h('button', {
                key: 'label:' + edge.id,
                type: 'button',
                onClick: (event) => { event.stopPropagation(); onSelectEdge(edge) },
                style: {
                  position: 'absolute',
                  left,
                  top,
                  transform: 'translate(-50%, -50%)',
                  fontSize: 10.5,
                  padding: '1px 6px',
                  borderRadius: 999,
                  border: '1px solid ' + (edge.id === selectedEdgeId ? '#b42318' : T.border),
                  background: 'var(--dsw-bg-panel, var(--dsw-bg-base, transparent))',
                  color: T.muted,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                },
              }, edgeKindLabel[edge.kind] + ' ×' + edge.count + (edge.lastAt === null ? '' : ' · ' + clock(edge.lastAt)))
            }),
            nodes.map((node) => {
              const point = positions[node.botId] ?? { x: 0, y: 0 }
              const isSelected = node.botId === selectedBotId
              return h('div', {
                key: node.botId,
                onPointerDown: (event) => onNodePointerDown(event, node),
                style: {
                  position: 'absolute',
                  left: point.x,
                  top: point.y,
                  width: NODE_W,
                  minHeight: NODE_H,
                  boxSizing: 'border-box',
                  padding: '9px 10px',
                  borderRadius: 12,
                  border: '1px solid ' + (isSelected ? T.accent : T.border),
                  boxShadow: isSelected ? '0 0 0 3px rgba(37,99,235,.16)' : '0 1px 2px rgba(16,24,40,.06)',
                  background: 'var(--dsw-bg-panel, var(--dsw-bg-base, transparent))',
                  display: 'grid',
                  gap: 3,
                  cursor: 'grab',
                },
              },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                  h('span', { style: { width: 8, height: 8, borderRadius: 999, background: roleColor(node.role), flex: 'none' } }),
                  h('strong', { style: { fontSize: 12.5, textTransform: 'uppercase', letterSpacing: '.03em' } }, node.label),
                  h('span', { style: { flex: 1 } }),
                  h('span', {
                    style: {
                      fontSize: 10,
                      padding: '0 5px',
                      borderRadius: 999,
                      color: node.liveness === 'running' ? '#0e7490' : node.liveness === 'online' ? '#05603a' : node.liveness === 'cold' ? '#475467' : '#b42318',
                      background: 'rgba(16,24,40,.06)',
                    },
                  }, LIVENESS[node.liveness] ?? node.liveness)),
                h('div', { style: { fontSize: 10.5, color: T.muted, fontFamily: T.mono, overflow: 'hidden', textOverflow: 'ellipsis' } }, node.sessionId),
                h('div', { style: { fontSize: 11.5, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                  node.currentTask === null ? '空闲' : node.currentTask.id + ' · ' + node.currentTask.title),
                node.blocked === null ? null : h('div', { style: { fontSize: 10.5, color: '#b42318' } }, '阻塞：' + String(node.blocked.reason ?? '').slice(0, 40)))
            })),
        ),
      )
    }

    /** Sessions view: the same independent Sessions, as a table with actions. */
    function SessionsView({ teams, busy, onOpenInTasks, onWake, onCopy }) {
      return h('div', { style: { display: 'grid', gap: 10, overflow: 'auto', minHeight: 0 } },
        h('div', { style: S.card },
          h('div', { style: S.row },
            h('strong', { style: { fontSize: 13 } }, '独立 Session'),
            h('span', { style: S.muted }, teams.length + ' 个 Bot，每个都是独立的 DSH Session（非子代理）')),
          h(Table, {
            columns: [
              { key: 'label', title: 'Bot', render: (row) => h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } }, h('span', { style: { width: 7, height: 7, borderRadius: 999, background: roleColor(row.role) } }), h('strong', { style: { fontSize: 12 } }, row.label || row.role)) },
              { key: 'session', title: 'Session', render: (row) => h('span', { style: S.code }, row.session_id) },
              { key: 'preset', title: '预设', render: (row) => row.agent_preset ?? '（默认）' },
              { key: 'live', title: '状态', render: (row) => h(Badge, { value: row.liveness.state === 'online' || row.liveness.state === 'running' ? 'DONE' : row.liveness.state === 'cold' ? 'INCOMPLETE' : 'FAIL', label: LIVENESS[row.liveness.state] ?? row.liveness.state }) },
              { key: 'task', title: '当前任务', render: (row) => (row.currentTask === null ? h('span', { style: S.muted }, '空闲') : row.currentTask.id + ' ' + row.currentTask.title) },
              { key: 'actions', title: '操作', render: (row) => h('div', { style: S.row },
                h(Button, { onClick: () => onCopy(row.session_id) }, '复制 Session id'),
                h(Button, { onClick: () => onOpenInTasks(row.currentTask?.id) }, '看任务'),
                h(Button, { kind: 'primary', disabled: busy !== '', onClick: () => onWake(row) }, '发消息')) },
            ],
            rows: teams,
            empty: '尚无 Bot。',
          })),
      )
    }

    /** Right-hand inspector: either one Bot or one edge, summary first. */
    function Inspector({ bot, edge, messages, tasks, delivery, teams, onClose, onWake, onCopy, onOpenTask, onOpenDelivery, busy }) {
      if (bot === undefined && edge === undefined) {
        return h('div', { style: { ...S.card, height: '100%' } },
          h('strong', { style: { fontSize: 13 } }, '详情'),
          h('p', { style: S.muted }, '点击画布里的 Bot 节点查看它的真实状态；点击连线查看跨 Session 消息与关联任务。'),
          h('p', { style: S.muted }, '这里不创建、不替换任何 Session。'))
      }
      if (edge !== undefined) {
        const from = teams.find((row) => row.id === edge.from)
        const to = teams.find((row) => row.id === edge.to)
        const related = messages.filter((message) => (message.from_bot_id === edge.from && message.to_bot_id === edge.to) || (message.from_bot_id === edge.to && message.to_bot_id === edge.from))
        return h('div', { style: { ...S.card, height: '100%', overflow: 'auto' } },
          h('div', { style: S.row }, h('strong', { style: { fontSize: 13 } }, edgeKindLabel[edge.kind] + '连线'), h('span', { style: S.grow }), h(Button, { onClick: onClose }, '关闭')),
          h('div', { style: S.muted }, (from?.label ?? edge.from) + ' → ' + (to?.label ?? edge.to)),
          h('table', { style: S.table }, h('tbody', null,
            h('tr', null, h('td', { style: S.td }, '消息数'), h('td', { style: S.td }, String(edge.count))),
            h('tr', null, h('td', { style: S.td }, '最近时间'), h('td', { style: S.td }, edge.lastAt === null ? '—' : when(edge.lastAt) + '（' + ago(edge.lastAt) + '）')),
            h('tr', null, h('td', { style: S.td }, '最近类型'), h('td', { style: S.td }, String(edge.lastType ?? '—'))),
            h('tr', null, h('td', { style: S.td }, '状态'), h('td', { style: S.td }, String(edge.state ?? '—'))),
            h('tr', null, h('td', { style: S.td }, '关联任务'), h('td', { style: S.td }, edge.taskId ?? '—')))),
          h('strong', { style: { fontSize: 12.5, marginTop: 4 } }, '消息历史'),
          related.length === 0
            ? h('p', { style: S.muted }, '（最近 80 条里没有这一对的往返消息）')
            : related.slice(0, 20).map((message) => h('div', { key: message.id, style: { borderTop: '1px solid ' + T.subtle, padding: '6px 0', display: 'grid', gap: 2 } },
                h('div', { style: { fontSize: 11, color: T.muted } }, when(message.created_at) + ' · ' + message.type + ' · ' + message.state),
                h('div', { style: { fontSize: 12 } }, String(message.body).slice(0, 240)))),
        )
      }
      // Normalise both shapes: a canvas node carries sessionId/run/blocked, a team row
      // carries session_id and may omit run/blocked entirely. Reading them directly
      // threw and unmounted the workspace on the first node click.
      const facts = {
        sessionId: String(bot.sessionId ?? bot.session_id ?? ''),
        liveness: bot.liveness?.state ?? 'missing',
        run: bot.run ?? null,
        blocked: bot.blocked ?? null,
        currentTask: bot.currentTask ?? null,
      }
      const botTasks = tasks.filter((task) => task.owner_bot_id === bot.id)
      const inbound = messages.filter((message) => message.to_bot_id === bot.id)
      const outbound = messages.filter((message) => message.from_bot_id === bot.id)
      const artifacts = (delivery?.artifacts ?? []).filter((artifact) => botTasks.some((task) => task.id === artifact.task_id)).slice(0, 3)
      const checks = (delivery?.verification ?? []).filter((check) => botTasks.some((task) => task.id === check.task_id)).slice(0, 3)
      return h('div', { style: { ...S.card, height: '100%', overflow: 'auto' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: { width: 9, height: 9, borderRadius: 999, background: roleColor(bot.role) } }),
          h('strong', { style: { fontSize: 14, textTransform: 'uppercase' } }, bot.label || bot.role),
          h('span', { style: S.grow }),
          h(Button, { onClick: onClose }, '关闭')),
        h('div', { style: S.muted }, 'Session · ' + facts.sessionId),
        h('div', { style: S.row },
          h(Badge, { value: facts.liveness === 'online' || facts.liveness === 'running' ? 'DONE' : facts.liveness === 'cold' ? 'INCOMPLETE' : 'FAIL', label: LIVENESS[facts.liveness] ?? facts.liveness }),
          h('span', { style: S.muted }, '预设 ' + (bot.agent_preset ?? '默认')),
          h('span', { style: S.muted }, '最近活动 ' + ago(bot.last_seen_at))),
        h('div', { style: S.row },
          h(Button, { onClick: () => onCopy(facts.sessionId) }, '复制 Session id'),
          h(Button, { kind: 'primary', disabled: busy !== '', onClick: () => onWake(bot) }, '发消息')),
        h('div', { style: { display: 'grid', gap: 6, marginTop: 4 } },
          h('strong', { style: { fontSize: 12.5 } }, '当前任务'),
          facts.currentTask === null
            ? h('span', { style: S.muted }, '空闲')
            : h('div', { style: { display: 'grid', gap: 4 } },
                h('div', { style: S.row }, h('span', { style: { fontSize: 12 } }, facts.currentTask.id + ' ' + facts.currentTask.title), h(Badge, { value: facts.currentTask.status })),
                h(Button, { onClick: () => onOpenTask(facts.currentTask.id) }, '打开任务'))),
        facts.run === null ? null : h('div', { style: { display: 'grid', gap: 3, marginTop: 4 } },
          h('strong', { style: { fontSize: 12.5 } }, 'Git 工作区'),
          h('div', { style: S.code }, facts.run.branch),
          h('div', { style: { ...S.code, fontSize: 10.5 } }, facts.run.worktree),
          h('div', { style: S.muted }, '租约至 ' + when(facts.run.leaseUntil) + ' · 令牌 ' + facts.run.tokensUsed)),
        facts.blocked === null ? null : h('div', { style: { marginTop: 4, padding: '6px 8px', borderRadius: 8, border: '1px solid rgba(180,35,24,.35)', color: '#b42318', fontSize: 12 } },
          '阻塞：' + String(facts.blocked.reason ?? '')),
        h('div', { style: { display: 'grid', gap: 3, marginTop: 6 } },
          h('strong', { style: { fontSize: 12.5 } }, '跨 Session 消息'),
          h('div', { style: S.muted }, '收到 ' + inbound.length + ' 条 · 发出 ' + outbound.length + ' 条（最近 80 条内）'),
          inbound.slice(0, 3).map((message) => h('div', { key: message.id, style: { fontSize: 11.5, color: T.muted } }, '← ' + message.type + '：' + String(message.body).slice(0, 60))),
          outbound.slice(0, 3).map((message) => h('div', { key: message.id, style: { fontSize: 11.5, color: T.muted } }, '→ ' + message.type + '：' + String(message.body).slice(0, 60)))),
        h('div', { style: { display: 'grid', gap: 3, marginTop: 6 } },
          h('strong', { style: { fontSize: 12.5 } }, '交付与检查'),
          artifacts.length === 0 ? h('span', { style: S.muted }, '暂无工件') : artifacts.map((artifact) => h('div', { key: artifact.id, style: { fontSize: 11.5 } }, artifact.id + ' @ ' + String(artifact.repo_commit).slice(0, 10))),
          checks.length === 0 ? h('span', { style: S.muted }, '暂无检查') : checks.map((check) => h('div', { key: check.id, style: { fontSize: 11.5 } }, check.check_type + ' ' + check.status + '（exit ' + check.exit_code + '）')),
          h(Button, { onClick: onOpenDelivery }, '打开交付视图')),
      )
    }

    /** Compact event strip pinned under the workspace. */
    function BottomTimeline({ timeline, onOpen }) {
      const rows = (timeline ?? []).slice(0, 40)
      return h('div', { style: { borderTop: '1px solid ' + T.border, paddingTop: 6, display: 'grid', gap: 4 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('strong', { style: { fontSize: 12 } }, '事件时间线'),
          h('span', { style: S.muted }, rows.length + ' 条（任务事件 / 审计 / 消息 / 检查 / 评审 / 审批）'),
          h('span', { style: S.grow }),
          h(Button, { onClick: onOpen }, '展开')),
        rows.length === 0
          ? h('div', { style: S.muted }, '还没有事件。')
          : h('div', { style: { display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 } },
              rows.slice(0, 14).map((row, index) => h('div', {
                key: (row.kind ?? 'row') + ':' + index,
                style: {
                  flex: 'none',
                  maxWidth: 260,
                  padding: '4px 8px',
                  borderRadius: 8,
                  border: '1px solid ' + T.border,
                  fontSize: 11.5,
                  color: T.text,
                  background: 'var(--dsw-bg-panel, transparent)',
                },
              },
                h('div', { style: { color: T.muted, fontSize: 10.5 } }, clock(row.at) + ' · ' + row.kind),
                h('div', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, String(row.summary ?? '')))))
      )
    }

    function Workbench({ compact }) {
      const [projects, setProjects] = useState([])
      const [projectId, setProjectId] = useState('')
      const [view, setView] = useState('canvas')
      const [more, setMore] = useState('')
      const [status, setStatus] = useState(null)
      const [overview, setOverview] = useState(null)
      const [teams, setTeams] = useState([])
      const [tasks, setTasks] = useState([])
      const [messages, setMessages] = useState([])
      const [delivery, setDelivery] = useState(null)
      const [decisions, setDecisions] = useState(null)
      const [activity, setActivity] = useState([])
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [busy, setBusy] = useState('')
      const [expandedTask, setExpandedTask] = useState('')
      const [taskDetail, setTaskDetail] = useState(null)
      const [budgetsState, setBudgets] = useState({ projectId: '', budgets: null })
      const [metrics, setMetrics] = useState(null)
      const [projectTemplates, setProjectTemplates] = useState([])
      const [timeline, setTimeline] = useState([])
      const [canvas, setCanvas] = useState(null)
      const [canvasWindow, setCanvasWindow] = useState(1440)
      const [selectedBotId, setSelectedBotId] = useState('')
      const [selectedEdge, setSelectedEdge] = useState(null)
      const [edgeMessages, setEdgeMessages] = useState([])
      const mounted = useRef(true)

      useEffect(() => () => { mounted.current = false }, [])

      const guard = useCallback(async (label, operation, silent = false) => {
        // Background refreshes must not flip the toolbar into "处理中…": only a
        // user-triggered action owns the busy state.
        if (!silent) setBusy(label)
        setError('')
        setNotice('')
        try {
          return await operation()
        } catch (failure) {
          setError(String(failure?.message ?? failure))
          return undefined
        } finally {
          if (!silent && mounted.current) setBusy('')
        }
      }, [])

      const refreshProjects = useCallback(async () => {
        const list = await guard('projects', () => call('projects.list'))
        if (list === undefined) return
        setProjects(list)
        void call('projectTemplates.list').then((rows) => { if (mounted.current) setProjectTemplates(rows) }).catch(() => {})
        if (projectId === '' && list.length > 0) setProjectId(list[0].id)
      }, [guard, projectId])

      const refreshProject = useCallback(async (silent = false) => {
        if (projectId === '') return
        await guard('project', async () => {
          const [nextOverview, nextTeam, nextTasks, nextMessages, nextDelivery, nextDecisions, nextActivity, nextBudgets, nextMetrics, nextTimeline, nextCanvas] = await Promise.all([
            call('overview.get', { projectId }),
            call('team.list', { projectId }),
            call('tasks.list', { projectId }),
            call('messages.list', { projectId, limit: 80 }),
            call('delivery.list', { projectId }),
            call('decisions.list', { projectId }),
            call('activity.list', { projectId, limit: 60 }),
            call('budgets.get', { projectId }).catch(() => null),
            call('dashboard.get', { projectId }).catch(() => null),
            call('timeline.get', { projectId, limit: 200 }).catch(() => []),
            call('canvas.get', { projectId, sinceMinutes: canvasWindow }).catch(() => null),
          ])
          if (!mounted.current) return
          setOverview(nextOverview)
          setTeams(nextTeam)
          setTasks(nextTasks)
          setMessages(nextMessages)
          setDelivery(nextDelivery)
          setDecisions(nextDecisions)
          setActivity(nextActivity)
          setBudgets({ projectId, budgets: nextBudgets })
          setMetrics(nextMetrics)
          setTimeline(Array.isArray(nextTimeline) ? nextTimeline : [])
          setCanvas(nextCanvas)
        }, silent)
      }, [guard, projectId, canvasWindow])

      useEffect(() => { void refreshProjects() }, [refreshProjects])
      useEffect(() => { void refreshProject() }, [refreshProject])

      useEffect(() => {
        if (projectId === '') return undefined
        const timer = setInterval(() => { void refreshProject(true) }, 5_000)
        return () => clearInterval(timer)
      }, [projectId, refreshProject])

      useEffect(() => {
        void guard('status', async () => {
          const next = await call('status')
          if (mounted.current) setStatus(next)
        })
      }, [guard])

      const viewportWidth = useViewportWidth()
      const narrow = viewportWidth < 1180
      const selected = projects.find((project) => project.id === projectId)
      const budgets = budgetsState.budgets
      const selectedNode = canvas?.nodes?.find((node) => node.botId === selectedBotId)
      const selectedBot = selectedEdge === null ? teams.find((bot) => bot.id === selectedBotId) : undefined
      const selectedForInspector = selectedEdge === null ? (selectedNode ?? selectedBot) : undefined
      const selectedEdgeValue = selectedEdge ?? undefined

      const openTask = useCallback(async (taskId) => {
        setExpandedTask(taskId)
        setTaskDetail(null)
        setMore('tasks')
        await guard('task', async () => {
          const detail = await call('tasks.get', { taskId })
          if (mounted.current) setTaskDetail(detail)
        })
      }, [guard])

      const act = useCallback(async (label, operation, success) => {
        const result = await guard(label, operation)
        if (result !== undefined) {
          setNotice(success ?? '已完成')
          await refreshProject()
          await refreshProjects()
        }
        return result
      }, [guard, refreshProject, refreshProjects])

      const copy = useCallback((text) => {
        void navigator.clipboard?.writeText(text)
        setNotice('已复制：' + String(text).slice(0, 40))
      }, [])

      const selectEdge = useCallback(async (edge) => {
        setSelectedEdge(edge)
        setEdgeMessages([])
        await guard('edge', async () => {
          const rows = await call('messages.list', { projectId, between: [edge.from, edge.to], limit: 50 })
          if (mounted.current) setEdgeMessages(Array.isArray(rows) ? rows : [])
        })
      }, [guard, projectId])

      const saveLayout = useCallback((payload) => {
        void call('canvas.save', { projectId, ...payload }).catch((failure) => setError(String(failure?.message ?? failure)))
      }, [projectId])

      const wake = useCallback(async (bot) => {
        const text = window.prompt('给 ' + (bot.label || bot.role) + ' 发一条消息（会写入它的 Session）：', '')
        if (text === null || text.trim() === '') return
        await act('wake', () => call('team.wake', { projectId, botId: bot.id, text }), '消息已投递给 ' + (bot.label || bot.role))
      }, [act, projectId])

      // -------------------------------------------------------- panels

      const ProjectsPanelNode = h(ProjectsPanel, {
        projects, templates: projectTemplates, selected, onSelect: setProjectId, busy, act,
        onCreate: (input) => act('create-project', () => call('projects.create', input), '项目已创建，下一步生成团队。'),
        onArchive: (id) => act('archive', () => call('projects.archive', { projectId: id }), '项目已归档'),
        onPause: (id, paused) => act('pause', () => call('projects.pause', { projectId: id, paused }), paused ? '项目已暂停' : '项目已恢复'),
        onRestore: (id) => act('restore', () => call('projects.restore', { projectId: id }), '项目已从归档恢复'),
      })
      const OverviewPanelNode = h(OverviewPanel, { project: selected, overview, activity, onDecide: () => setMore('decisions') })
      const TeamPanelNode = h(TeamPanel, {
        project: selected, teams, busy,
        onGenerate: (roles) => act('team', () => call('team.create', { projectId, roles, presets: {} }), '团队已创建：' + roles.length + ' 个独立 Session'),
        onRebind: (botId, sessionId) => act('rebind', () => call('team.rebind', { projectId, botId, sessionId }), 'Session 已重新绑定'),
      })
      const TasksPanelNode = h(TasksPanel, {
        project: selected, teams, tasks, busy, expandedTask, taskDetail,
        onOpen: openTask,
        onCreate: (input) => act('create-task', () => call('tasks.create', { projectId, ...input }), '任务已创建'),
        onTransition: (taskId, action, reason) => act('transition', () => call('tasks.transition', { taskId, action, reason }), '任务已' + (ACTION_ZH[action] ?? action)),
        onAssign: (taskId, botId, expectedVersion) => act('assign', () => call('tasks.assign', { taskId, botId, expectedVersion }), '任务已分配'),
        onVerify: (taskId) => act('verify', () => call('tasks.verify', { taskId }), '检查已执行'),
        onUpdate: (taskId, patch) => act('task-edit', () => call('tasks.update', { taskId, ...patch }), '任务已更新'),
      })
      const MessagesPanelNode = h(MessagesPanel, {
        messages, busy,
        onBroadcast: (channel, body) => act('broadcast', () => call('messages.broadcast', { projectId, channel, body }), '已广播到频道'),
        onReplay: (messageId) => act('replay', () => call('messages.replay', { messageId }), '消息已重新入队'),
      })
      const DeliveryPanelNode = h(DeliveryPanel, {
        delivery, tasks,
        onVerifyArtifacts: () => guard('verify-artifacts', () => call('delivery.verify', { projectId })),
      })
      const DecisionsPanelNode = h(DecisionsPanel, {
        decisions, busy,
        onDecideChange: (changeId, decision, justification) => act('change', () => call('decisions.decideChange', { changeId, decision, justification }), decision === 'APPROVE' ? '提案已批准' : '提案已拒绝'),
        onApproveTask: (taskId, decision, headCommit, justification) => act('approve', () => call('decisions.approveTask', { taskId, decision, headCommit, justification }), decision === 'APPROVE' ? '审批已记录（批准）' : '审批已记录（拒绝）'),
        onExecuteMerge: (changeId) => act('merge', () => call('decisions.executeMerge', { changeId }), '合并已执行'),
      })
      const TimelinePanelNode = h(TimelinePanel, { timeline })
      const QualityPanelNode = h(QualityPanel, { metrics })
      const SettingsPanelNode = h(SettingsPanel, {
        status, project: selected, budgets, busy, act,
        onProbe: refreshProject,
        onSavePolicy: (policy) => act('policy', () => call('projects.update', { projectId, policy }), '策略已保存'),
        onSaveBudgets: (patch) => act('budgets', () => call('budgets.update', { projectId, ...patch }), '预算已保存'),
        onExport: () => call('export.project', { projectId }),
      })
      const SessionsPanelNode = h(SessionsView, {
        teams,
        busy,
        onOpenInTasks: (taskId) => { if (taskId !== undefined && taskId !== '') void openTask(taskId) },
        onWake: (bot) => void wake(bot),
        onCopy: copy,
      })

      const primaryViews = [
        ['overview', 'Overview'],
        ['canvas', 'Canvas'],
        ['sessions', 'Sessions'],
        ['tasks', 'Tasks'],
        ['deliveries', 'Deliveries'],
      ]
      const moreViews = [
        ['projects', '项目'],
        ['team', '团队'],
        ['messages', '消息'],
        ['timeline', '时间线'],
        ['quality', '质量'],
        ['decisions', '决策' + (decisions === null ? '' : ' (' + (decisions.changes.filter((row) => row.status === 'PENDING').length + decisions.gated.filter((entry) => entry.gate.status === 'NEEDS_HUMAN').length) + ')')],
        ['settings', '设置'],
      ]
      const panelFor = {
        overview: OverviewPanelNode,
        tasks: TasksPanelNode,
        deliveries: DeliveryPanelNode,
      }
      const morePanelFor = {
        projects: ProjectsPanelNode,
        team: TeamPanelNode,
        messages: MessagesPanelNode,
        timeline: TimelinePanelNode,
        quality: QualityPanelNode,
        decisions: DecisionsPanelNode,
        settings: SettingsPanelNode,
      }

      const main = view === 'canvas'
        ? h(CanvasView, {
            canvas,
            canvasWindow,
            onWindow: (value) => setCanvasWindow(value),
            selectedBotId: selectedBot?.id ?? '',
            onSelectBot: (botId) => { setSelectedEdge(null); setSelectedBotId(botId) },
            onSelectEdge: (edge) => { setSelectedBotId(''); void selectEdge(edge) },
            selectedEdgeId: selectedEdge?.id ?? '',
            onSaveLayout: saveLayout,
            busy,
          })
        : view === 'sessions' ? SessionsPanelNode : (panelFor[view] ?? OverviewPanelNode)

      return h('div', { style: { ...S.page, height: compact ? undefined : '100%', gap: 8 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h('h3', { style: S.title }, 'Project Teams'),
          h('select', {
            style: { ...S.input, minWidth: 180 },
            value: projectId,
            onChange: (event) => { setProjectId(event.target.value); setSelectedBotId(''); setSelectedEdge(null) },
          },
            projects.length === 0 ? h('option', { value: '' }, '尚无项目') : null,
            projects.map((project) => h('option', { key: project.id, value: project.id }, project.name))),
          selected === undefined ? null : h(Badge, { value: selected.status === 'active' ? 'DONE' : 'CANCELLED', label: STATUS_LABEL[selected.status.toUpperCase()] ?? selected.status }),
          h('span', { style: S.muted }, (canvas?.nodes?.length ?? teams.length) + ' Session'),
          h('span', { style: S.muted }, '待审批 ' + (selected?.counts?.pendingDecisions ?? 0)),
          h('span', { style: S.grow }),
          h('div', { style: S.row },
            primaryViews.map(([key, label]) => h('button', {
              key, type: 'button', style: S.tab(view === key && more === ''), onClick: () => { setView(key); setMore('') },
            }, label))),
          h(Button, { onClick: () => { void refreshProjects(); void refreshProject() }, disabled: busy !== '' }, busy === '' ? '刷新' : '处理中…')),
        h('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
          moreViews.map(([key, label]) => h('button', {
            key, type: 'button', style: S.tab(more === key), onClick: () => setMore(more === key ? '' : key),
          }, label))),
        error === '' ? null : h('div', { style: { ...S.muted, color: '#b42318', border: '1px solid rgba(180,35,24,.35)', borderRadius: 8, padding: '5px 9px' } }, error),
        notice === '' ? null : h('div', { style: { ...S.muted, color: '#05603a', border: '1px solid rgba(5,96,58,.35)', borderRadius: 8, padding: '5px 9px' } }, notice),
        h('div', {
          style: {
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gap: TOKENS.space.lg,
            // Three columns need room for a readable canvas; below that the rail
            // and the inspector stack instead of squashing the graph.
            gridTemplateColumns: narrow ? 'minmax(0, 1fr)' : '220px minmax(320px, 1fr) 340px',
            gridTemplateRows: narrow ? 'auto minmax(320px, 1fr) auto' : 'minmax(0, 1fr)',
          },
        },
          h('div', { style: { minHeight: 0, borderRight: narrow ? 'none' : '1px solid ' + T.border, borderBottom: narrow ? '1px solid ' + T.border : 'none', paddingRight: narrow ? 0 : 8, paddingBottom: narrow ? 8 : 0, maxHeight: narrow ? 132 : undefined, overflow: 'auto' } },
            h(LeftRail, {
              projects, selected: projectId, onSelectProject: (id) => { setProjectId(id); setSelectedBotId(''); setSelectedEdge(null) },
              teams, selectedBotId, onSelectBot: (botId) => { setSelectedEdge(null); setSelectedBotId(botId); setView('canvas') },
              onManage: () => { setView('sessions'); setMore('') },
            })),
          h('div', { style: { minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8 } },
            more === ''
              ? main
              : h('div', { style: { minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column' } }, morePanelFor[more] ?? null)),
          h('div', { style: { minHeight: 0 } },
            h(Inspector, {
              bot: selectedForInspector,
              edge: selectedEdgeValue,
              messages: selectedEdge === null ? messages : edgeMessages,
              tasks, delivery, teams, busy,
              onClose: () => { setSelectedBotId(''); setSelectedEdge(null) },
              onWake: (bot) => void wake(bot),
              onCopy: copy,
              onOpenTask: (taskId) => void openTask(taskId),
              onOpenDelivery: () => { setView('deliveries'); setMore('') },
            }))),
        h(BottomTimeline, { timeline, onOpen: () => setMore('timeline') }),
      )
    }

    // ------------------------------------------------------------- panels

    function ProjectsPanel({ projects, templates, selected, onSelect, onCreate, onArchive, onPause, onRestore, busy }) {
      const [name, setName] = useState('')
      const [templateId, setTemplateId] = useState('')
      const [goal, setGoal] = useState('')
      const [repoRoot, setRepoRoot] = useState('')
      const [checks, setChecks] = useState('[]')
      const [policyError, setPolicyError] = useState('')

      const submit = () => {
        let policy
        try {
          const parsed = checks.trim() === '' ? [] : JSON.parse(checks)
          if (!Array.isArray(parsed)) throw new Error('策略检查必须是一个 JSON 数组')
          policy = { checks: parsed }
          setPolicyError('')
        } catch (failure) {
          setPolicyError(String(failure.message ?? failure))
          return
        }
        void onCreate({ name, goal, repoRoot, policy, templateId: templateId === '' ? undefined : templateId })
        setName('')
        setGoal('')
        setRepoRoot('')
      }

      return h('div', { style: { display: 'grid', gap: 12, overflow: 'auto', minHeight: 0 } },
        h('div', { style: S.card },
          h('strong', { style: { fontSize: 13 } }, '新建项目'),
          h('p', { style: S.muted }, '一个项目绑定一个本地 Git 仓库，以及四个彼此独立的 Bot Session。仓库必须至少已有一个 commit。'),
          h('div', { style: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' } },
            h(Field, { label: '从模板开始' }, h('select', {
              style: S.input,
              value: templateId,
              onChange: (event) => {
                const next = event.target.value
                setTemplateId(next)
                const template = (templates ?? []).find((row) => row.id === next)
                // Show the template policy in the editor so it can be adjusted before creating.
                if (template !== undefined) setChecks(JSON.stringify(template.policy ?? {}, null, 2))
                else setChecks('[]')
              },
            },
              h('option', { value: '' }, '空白项目'),
              (templates ?? []).map((row) => h('option', { key: row.id, value: row.id }, `${row.name} — ${row.description}`)))),
            h(Field, { label: '名称' }, h('input', { style: S.input, value: name, onChange: (event) => setName(event.target.value), placeholder: 'CRM SaaS' })),
            h(Field, { label: '目标' }, h('input', { style: S.input, value: goal, onChange: (event) => setGoal(event.target.value), placeholder: '实现注册与登录' })),
            h(Field, { label: '仓库根目录（绝对路径）' }, h('input', { style: S.input, value: repoRoot, onChange: (event) => setRepoRoot(event.target.value), placeholder: 'D:/work/crm' })),
          ),
          h(Field, {
            label: '策略检查（JSON 数组）',
            hint: '每个检查都是任务工作树中执行的真实命令。例如：[{"type":"test","command":"npm test","required":true}]',
          }, h('textarea', {
            style: S.area,
            value: checks,
            onChange: (event) => setChecks(event.target.value),
            placeholder: '[{"type":"build","command":"npm run build","required":true},{"type":"test","command":"npm test","required":true}]',
          })),
          policyError === '' ? null : h('span', { style: { fontSize: 12, color: '#b42318' } }, policyError),
          h('div', { style: S.row },
            h(Button, { kind: 'primary', onClick: submit, disabled: busy !== '' || name.trim() === '' || repoRoot.trim() === '' }, '创建项目'),
          ),
        ),
        h('div', { style: S.card },
          h('strong', { style: { fontSize: 13 } }, '项目列表'),
          h(Table, {
            columns: [
              { key: 'name', title: '项目', render: (row) => h('div', { style: { display: 'grid', gap: 2 } }, h('strong', { style: { fontSize: 12.5 } }, row.name), h('span', { style: S.code }, row.repo_root)) },
              { key: 'status', title: '状态', render: (row) => h(Badge, { value: row.status === 'active' ? 'DONE' : row.status === 'paused' ? 'NEEDS_HUMAN' : 'CANCELLED', label: STATUS_LABEL[row.status.toUpperCase()] ?? row.status }) },
              { key: 'counts', title: '团队 / 未完成 / 运行中', render: (row) => `${row.counts.bots} / ${row.counts.openTasks} / ${row.counts.activeRuns}` },
              { key: 'sel', title: '', render: (row) => h('div', { style: S.row },
                h(Button, { onClick: () => onSelect(row.id) }, row.id === selected?.id ? '当前项目' : '打开'),
                row.status === 'archived'
                  ? h(Button, { kind: 'primary', onClick: () => onRestore(row.id) }, '从归档恢复')
                  : h(Button, { onClick: () => onPause(row.id, row.status !== 'paused') }, row.status === 'paused' ? '恢复运行' : '暂停'),
                row.status === 'archived' ? null : h(Button, { kind: 'danger', onClick: () => onArchive(row.id) }, '归档'),
              ) },
            ],
            rows: projects,
            empty: '尚无项目，请在上方创建。',
          }),
        ),
      )
    }

    function OverviewPanel({ project, overview, activity, onDecide }) {
      if (project === undefined || overview === null) return h('div', { style: S.empty }, '请选择或新建项目以查看总览。')
      const statuses = ['DRAFT', 'READY', 'ASSIGNED', 'RUNNING', 'IN_REVIEW', 'VERIFIED', 'BLOCKED', 'REWORK', 'DONE', 'CANCELLED']
      return h('div', { style: { display: 'grid', gap: 12, overflow: 'auto', minHeight: 0 } },
        h('div', { style: S.card },
          h('div', { style: S.row }, h('strong', { style: { fontSize: 13 } }, project.name), h(Badge, { value: project.status === 'active' ? 'DONE' : 'CANCELLED', label: STATUS_LABEL[project.status.toUpperCase()] ?? project.status })),
          h('p', { style: S.muted }, project.goal === '' ? '未填写目标。' : project.goal),
          h('div', { style: S.row },
            h('span', { style: S.muted }, `仓库 ${project.repo_root}`),
            h('span', { style: S.muted }, `分支 ${project.default_branch}`),
          ),
          h('div', { style: S.row }, statuses.filter((state) => overview.byStatus[state] > 0).map((state) =>
            h('span', { key: state, style: S.row }, h(Badge, { value: state }), h('span', { style: S.muted }, String(overview.byStatus[state]))))),
        ),
        h('div', { style: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' } },
          h('div', { style: S.card },
            h('strong', { style: { fontSize: 13 } }, '进行中的运行'),
            h(Table, {
              columns: [
                { key: 'id', title: '运行', render: (row) => h('span', { style: S.code }, short(row.id, 18)) },
                { key: 'task', title: '任务', render: (row) => `${row.task_id} ${row.title}` },
                { key: 'status', title: '状态', render: (row) => h(Badge, { value: row.status === 'active' ? 'RUNNING' : row.status === 'paused' ? 'NEEDS_HUMAN' : 'BLOCKED', label: row.status }) },
              ],
              rows: overview.activeRuns,
              empty: '当前没有运行中的任务。',
            }),
          ),
          h('div', { style: S.card },
            h('strong', { style: { fontSize: 13 } }, '阻塞任务'),
            h(Table, {
              columns: [
                { key: 'id', title: '任务', render: (row) => row.id },
                { key: 'title', title: '标题', render: (row) => row.title },
                { key: 'reason', title: '原因', render: (row) => h('span', { style: S.muted }, row.reason ?? '') },
              ],
              rows: overview.blocked,
              empty: '没有阻塞任务。',
            }),
          ),
        ),
        h('div', { style: S.card },
          h('div', { style: S.row },
            h('strong', { style: { fontSize: 13 } }, '需要你处理'),
            h('span', { style: S.muted }, `${overview.pendingDecisions} 项`),
            h(Button, { onClick: onDecide }, '打开决策收件箱'),
          ),
          h('p', { style: S.muted }, '高风险变更、合并/部署提案、预算超限与故障恢复都在这里等你决定。任何 Bot 都无法代你批准。'),
        ),
        h('div', { style: S.card },
          h('strong', { style: { fontSize: 13 } }, '活动记录'),
          h(Table, {
            columns: [
              { key: 'at', title: '时间', render: (row) => when(row.at) },
              { key: 'actor', title: '操作者', render: (row) => `${row.actor_type}:${short(row.actor_id, 14)}` },
              { key: 'action', title: '动作', render: (row) => row.action ?? row.action },
              { key: 'result', title: '结果', render: (row) => (row.result === undefined ? `${row.from_state} → ${row.to_state}` : h(Badge, { value: row.result === 'ok' ? 'PASS' : 'FAIL', label: row.result === 'ok' ? '成功' : row.result === 'denied' ? '拒绝' : row.result })) },
              { key: 'target', title: '目标对象', render: (row) => h('span', { style: S.code }, short(String(row.target ?? row.task_id ?? ''), 22)) },
            ],
            rows: activity,
            empty: '暂无活动记录。',
          }),
        ),
      )
    }

    function TeamPanel({ project, teams, busy, onGenerate, onRebind }) {
      // Hooks stay above every early return so the hook order is stable.
      const [rebindFor, setRebindFor] = useState('')
      const [sessionInput, setSessionInput] = useState('')
      const [roleList, setRoleList] = useState('pm, developer, reviewer, qa')
      if (project === undefined) return h('div', { style: S.empty }, '请先选择项目。')
      return h('div', { style: { display: 'grid', gap: 12, overflow: 'auto', minHeight: 0 } },
        h('div', { style: S.card },
          h('div', { style: S.row },
            h('strong', { style: { fontSize: 13 } }, '团队成员'),
            h('span', { style: S.muted }, `${teams.length} 个 Bot`),
            h('span', { style: S.grow }),
            teams.length === 0 ? h(Field, { label: '角色清单（每项目 4–8 个；同名角色可重复，例如 developer, developer）' },
              h('input', { style: { ...S.input, minWidth: 320 }, value: roleList, onChange: (event) => setRoleList(event.target.value) })) : null,
            teams.length === 0 ? h(Button, {
              kind: 'primary',
              disabled: busy !== '',
              onClick: () => onGenerate(roleList.split(',').map((role) => role.trim()).filter(Boolean)),
            }, '生成团队') : null,
          ),
          h('p', { style: S.muted }, '每个 Bot 都是一个普通 DSH Session，拥有独立的 Agent 预设与角色说明；没有任何 Bot 是别的 Agent 的子代理。复制 Session id 可在 DSH 中打开对应会话。'),
          h(Table, {
            columns: [
              { key: 'role', title: '角色', render: (row) => h('strong', { style: { textTransform: 'uppercase', fontSize: 11.5 } }, row.label || row.role) },
              { key: 'session', title: '独立 Session', render: (row) => h('div', { style: S.row },
                h('span', { style: S.code }, row.session_id),
                h(Button, {
                  title: '复制 Session id，然后在 DSH 中打开该会话',
                  onClick: () => { void navigator.clipboard?.writeText(row.session_id) },
                }, '复制')) },
              { key: 'preset', title: '预设', render: (row) => row.agent_preset ?? '（默认）' },
              { key: 'live', title: '存活状态', render: (row) => h(Badge, { value: row.liveness.state === 'online' ? 'DONE' : row.liveness.state === 'cold' ? 'INCOMPLETE' : 'FAIL', label: row.liveness.state === 'online' ? '在线' : row.liveness.state === 'cold' ? '冷会话' : '缺失' }) },
              { key: 'task', title: '当前任务', render: (row) => (row.currentTask === null ? h('span', { style: S.muted }, '空闲') : `${row.currentTask.id} ${row.currentTask.title}`) },
              { key: 'rebind', title: '', render: (row) => h(Button, { onClick: () => { setRebindFor(rebindFor === row.id ? '' : row.id); setSessionInput('') } }, '重新绑定') },
            ],
            rows: teams,
            empty: '尚无 Bot。生成团队即可绑定四个独立 Session。',
          }),
          rebindFor === '' ? null : h('div', { style: { ...S.card, borderStyle: 'dashed' } },
            h('strong', { style: { fontSize: 12.5 } }, `重新绑定 ${rebindFor}`),
            h('p', { style: S.muted }, '把一个已有的独立 Session 绑定到该角色。属于 subagent 树的 Session 会被宿主拒绝。'),
            h('div', { style: S.row },
              h('input', { style: { ...S.input, flex: 1 }, value: sessionInput, onChange: (event) => setSessionInput(event.target.value), placeholder: 'session-…' }),
              h(Button, { kind: 'primary', onClick: () => { void onRebind(rebindFor, sessionInput.trim()); setRebindFor('') } }, '绑定'),
            ),
          ),
        ),
      )
    }

    function TasksPanel({ project, teams, tasks, busy, expandedTask, taskDetail, onOpen, onCreate, onTransition, onAssign, onVerify, onUpdate }) {
      const [title, setTitle] = useState('')
      const [description, setDescription] = useState('')
      const [acceptance, setAcceptance] = useState('')
      const [risk, setRisk] = useState('low')
      const [dependsOn, setDependsOn] = useState('')
      const [editDraft, setEditDraft] = useState(null)
      if (project === undefined) return h('div', { style: S.empty }, '请先选择项目。')
      const detail = taskDetail !== null && taskDetail.id === expandedTask ? taskDetail : undefined
      return h('div', { style: { display: 'grid', gap: 12, overflow: 'auto', minHeight: 0 } },
        h('div', { style: S.card },
          h('strong', { style: { fontSize: 13 } }, '新建任务'),
          h('div', { style: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' } },
            h(Field, { label: '标题' }, h('input', { style: S.input, value: title, onChange: (event) => setTitle(event.target.value), placeholder: '实现注册接口' })),
            h(Field, { label: '风险' }, h('select', { style: S.input, value: risk, onChange: (event) => setRisk(event.target.value) },
              h('option', { value: 'low' }, 'low'), h('option', { value: 'medium' }, 'medium'), h('option', { value: 'high' }, 'high — 需 Owner 批准'))),
            h(Field, { label: '依赖任务（逗号分隔）' }, h('input', { style: S.input, value: dependsOn, onChange: (event) => setDependsOn(event.target.value), placeholder: 'T-1, T-2' })),
          ),
          h(Field, { label: '描述 / 修改范围' }, h('textarea', { style: S.area, value: description, onChange: (event) => setDescription(event.target.value) })),
          h(Field, { label: '验收标准（每行一条；任务进入可执行状态前必需）' }, h('textarea', {
            style: S.area,
            value: acceptance,
            onChange: (event) => setAcceptance(event.target.value),
            placeholder: '拒绝非法邮箱\n拒绝短密码',
          })),
          h('div', { style: S.row },
            h(Button, {
              kind: 'primary',
              disabled: busy !== '' || title.trim() === '',
              onClick: () => {
                void onCreate({
                  title,
                  description,
                  acceptance: acceptance.split('\n').map((line) => line.trim()).filter(Boolean),
                  riskLevel: risk,
                  dependsOn: dependsOn.split(',').map((value) => value.trim()).filter(Boolean),
                })
                setTitle(''); setDescription(''); setAcceptance(''); setDependsOn('')
              },
            }, '创建任务'),
          ),
        ),
        h('div', { style: S.card },
          h('strong', { style: { fontSize: 13 } }, '任务列表'),
          h(Table, {
            columns: [
              { key: 'id', title: '编号', render: (row) => h('span', { style: S.code }, row.id) },
              { key: 'title', title: '标题', render: (row) => h('div', { style: { display: 'grid', gap: 2 } }, h('span', null, row.title), h('span', { style: { ...S.muted, fontSize: 11 } }, row.dependencies.length === 0 ? '无依赖' : `依赖 ${row.dependencies.join(', ')}`)) },
              { key: 'status', title: '状态', render: (row) => h(Badge, { value: row.status }) },
              { key: 'gate', title: '门禁', render: (row) => h(Badge, { value: row.gate.status }) },
              { key: 'owner', title: '负责人', render: (row) => (row.owner_bot_id === null ? h('span', { style: S.muted }, '未分配') : short(row.owner_bot_id, 14)) },
              { key: 'actions', title: '操作', render: (row) => h('div', { style: S.row },
                h(Button, { onClick: () => onOpen(row.id) }, expandedTask === row.id ? '收起' : '查看'),
                row.status === 'DRAFT' ? h(Button, { onClick: () => onTransition(row.id, 'submit') }, '提交') : null,
                row.status === 'READY' ? h('select', {
                  style: { ...S.input, maxWidth: 150 },
                  defaultValue: '',
                  onChange: (event) => { if (event.target.value !== '') void onAssign(row.id, event.target.value, row.version) },
                },
                  h('option', { value: '' }, '分配给…'),
                  teams.map((bot) => h('option', { key: bot.id, value: bot.id }, `${bot.role} ${short(bot.id, 8)}`))) : null,
                row.status === 'IN_REVIEW' ? h(Button, { onClick: () => onVerify(row.id) }, '运行检查') : null,
                ['DRAFT', 'READY', 'ASSIGNED', 'RUNNING', 'IN_REVIEW', 'BLOCKED', 'REWORK'].includes(row.status) ? h(Button, { kind: 'danger', onClick: () => onTransition(row.id, 'cancel', '由工作台取消') }, '取消') : null,
              ) },
            ],
            rows: tasks,
            empty: '尚无任务。',
          }),
        ),
        detail === undefined ? null : h('div', { style: S.card },
          h('div', { style: S.row }, h('strong', { style: { fontSize: 13 } }, `${detail.id} ${detail.title}`), h(Badge, { value: detail.status }), h(Badge, { value: detail.gate.status }),
            h('span', { style: S.grow }),
            ['DRAFT', 'READY', 'REWORK', 'BLOCKED'].includes(detail.status)
              ? h(Button, { onClick: () => setEditDraft(editDraft === null ? { title: detail.title, description: detail.description, acceptance: detail.acceptance.join('\n'), riskLevel: detail.risk_level } : null) }, editDraft === null ? '编辑任务' : '收起编辑')
              : null),
          editDraft === null ? null : h('div', { style: { ...S.card, borderStyle: 'dashed' } },
            h('div', { style: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' } },
              h(Field, { label: '标题' }, h('input', { style: S.input, value: editDraft.title, onChange: (event) => setEditDraft({ ...editDraft, title: event.target.value }) })),
              h(Field, { label: '风险' }, h('select', { style: S.input, value: editDraft.riskLevel, onChange: (event) => setEditDraft({ ...editDraft, riskLevel: event.target.value }) },
                h('option', { value: 'low' }, 'low'), h('option', { value: 'medium' }, 'medium'), h('option', { value: 'high' }, 'high — 需 Owner 批准')))),
            h(Field, { label: '描述 / 修改范围' }, h('textarea', { style: S.area, value: editDraft.description, onChange: (event) => setEditDraft({ ...editDraft, description: event.target.value }) })),
            h(Field, { label: '验收标准（每行一条）' }, h('textarea', { style: S.area, value: editDraft.acceptance, onChange: (event) => setEditDraft({ ...editDraft, acceptance: event.target.value }) })),
            h('div', { style: S.row },
              h(Button, { kind: 'primary', disabled: busy !== '', onClick: () => {
                void onUpdate(detail.id, {
                  title: editDraft.title,
                  description: editDraft.description,
                  acceptance: editDraft.acceptance.split('\n').map((line) => line.trim()).filter(Boolean),
                  riskLevel: editDraft.riskLevel,
                  expectedVersion: detail.version,
                })
                setEditDraft(null)
              } }, '保存修改'),
              h(Button, { onClick: () => setEditDraft(null) }, '取消')),
            h('p', { style: S.muted }, '只有草稿、就绪、返工或阻塞中的任务可以编辑：一旦开始执行，验收标准就是评审与门禁判定所依据的合约。')),
          h('p', { style: S.muted }, detail.description === '' ? '无描述。' : detail.description),
          h('p', { style: S.muted }, detail.description === '' ? '无描述。' : detail.description),
          detail.acceptance.length === 0 ? null : h('div', null,
            h('span', { style: { ...S.muted, fontWeight: 600 } }, '验收标准'),
            h('ul', { style: { ...S.muted, margin: '4px 0 0', paddingLeft: 18 } }, detail.acceptance.map((entry, index) => h('li', { key: index }, entry))),
          ),
          detail.gate.reasons.length === 0 ? null : h('div', null,
            h('span', { style: { ...S.muted, fontWeight: 600 } }, '门禁证据'),
            h('ul', { style: { ...S.muted, margin: '4px 0 0', paddingLeft: 18 } }, detail.gate.reasons.map((reason, index) => h('li', { key: index }, reason))),
          ),
          h(Table, {
            columns: [
              { key: 'seq', title: '#', render: (row) => row.seq },
              { key: 'at', title: '时间', render: (row) => when(row.created_at) },
              { key: 'actor', title: '操作者', render: (row) => `${row.actor_type}:${short(row.actor_id, 12)}` },
              { key: 'move', title: '状态转移', render: (row) => `${row.from_state ?? '—'} → ${row.to_state}` },
              { key: 'action', title: '动作', render: (row) => row.action },
            ],
            rows: detail.events,
            empty: '暂无事件记录。',
          }),
          detail.runs.length === 0 ? null : h(Table, {
            columns: [
              { key: 'id', title: '运行', render: (row) => h('span', { style: S.code }, row.id) },
              { key: 'branch', title: '分支', render: (row) => h('span', { style: S.code }, row.branch) },
              { key: 'status', title: '状态', render: (row) => h(Badge, { value: row.status === 'active' ? 'RUNNING' : row.status === 'completed' ? 'DONE' : 'BLOCKED', label: row.status === 'active' ? '运行中' : row.status === 'completed' ? '已完成' : row.status === 'recovery_required' ? '需恢复' : row.status }) },
              { key: 'head', title: '提交', render: (row) => h('span', { style: S.code }, short(row.head_commit ?? '', 12)) },
            ],
            rows: detail.runs,
          }),
          detail.reviews.length === 0 ? null : h(Table, {
            columns: [
              { key: 'verdict', title: '评审', render: (row) => h(Badge, { value: row.verdict }) },
              { key: 'head', title: '提交', render: (row) => h('span', { style: S.code }, short(row.head_commit, 12)) },
              { key: 'findings', title: '问题项', render: (row) => String(row.findings.length) },
              { key: 'when', title: '决定时间', render: (row) => when(row.decided_at) },
            ],
            rows: detail.reviews,
          }),
        ),
      )
    }

    function MessagesPanel({ messages, busy, onReplay, onBroadcast }) {
      const [channel, setChannel] = useState('all')
      const [broadcastText, setBroadcastText] = useState('')
      const [search, setSearch] = useState('')
      const filtered = search.trim() === ''
        ? messages
        : messages.filter((row) => `${row.body} ${row.type}`.toLowerCase().includes(search.trim().toLowerCase()))
      const threads = new Map()
      for (const row of filtered) {
        const key = row.thread_id ?? row.task_id ?? 'direct'
        if (!threads.has(key)) threads.set(key, [])
        threads.get(key).push(row)
      }
      return h('div', { style: { display: 'grid', gap: 12, overflow: 'auto', minHeight: 0 } },
        h('div', { style: S.card },
          h('div', { style: S.row },
            h('strong', { style: { fontSize: 13 } }, 'Bot 间消息'),
            h('span', { style: S.grow }),
            h('input', {
              style: { ...S.input, maxWidth: 260 },
              value: search,
              placeholder: '搜索正文或类型…',
              onChange: (event) => setSearch(event.target.value),
            })),
          search === '' ? null : h('p', { style: S.muted }, `本地过滤 ${filtered.length} / ${messages.length} 条（带 thread 的消息按线程分组显示）`),
          h('div', { style: S.row },
            h('span', { style: S.muted }, 'Owner 频道广播'),
            h('select', { style: { ...S.input, maxWidth: 190 }, value: channel, onChange: (event) => setChannel(event.target.value) },
              h('option', { value: 'all' }, '全体成员'),
              ['pm', 'developer', 'reviewer', 'qa'].map((role) => h('option', { key: role, value: 'role:' + role }, '角色：' + role))),
            h('input', {
              style: { ...S.input, flex: 1, minWidth: 220 },
              value: broadcastText,
              placeholder: '向该频道发一条系统通告（会写入每个 Bot 的会话）',
              onChange: (event) => setBroadcastText(event.target.value),
            }),
            h(Button, {
              kind: 'primary',
              disabled: busy !== '' || broadcastText.trim() === '',
              onClick: () => { void onBroadcast(channel, broadcastText); setBroadcastText('') },
            }, '广播')),
          h('p', { style: S.muted }, '已入队、已投递、已处理是三个不同状态：“已投递”只表示宿主接收了输入，“已处理”表示接收方 Bot 主动确认。'),
          h(Table, {
            columns: [
              { key: 'when', title: '时间', render: (row) => when(row.created_at) },
              { key: 'type', title: '类型', render: (row) => row.type },
              { key: 'route', title: '发送方 → 接收方', render: (row) => h('span', { style: S.code }, `${short(row.from_bot_id, 10)} → ${short(row.to_bot_id, 10)}`) },
              { key: 'task', title: '任务', render: (row) => row.task_id ?? '—' },
              { key: 'state', title: '状态', render: (row) => h('div', { style: S.row }, h(Badge, { value: row.state }), row.attempts > 0 ? h('span', { style: S.muted }, `×${row.attempts}`) : null) },
              { key: 'body', title: '正文', render: (row) => h('span', { style: { ...S.muted, fontSize: 12 } }, row.body.length > 160 ? `${row.body.slice(0, 160)}…` : row.body) },
              { key: 'actions', title: '', render: (row) => (row.state === 'DEAD_LETTER' ? h(Button, { onClick: () => onReplay(row.id), disabled: busy !== '' }, '重投') : null) },
            ],
            rows: filtered,
            empty: '暂无消息。',
          }),
          h('p', { style: S.muted }, `按线程/任务聚合：${[...threads.keys()].map((key) => `${key}(${threads.get(key).length})`).join(' · ') || '暂无'}`),
        ),
      )
    }

    function DeliveryPanel({ delivery, tasks, onVerifyArtifacts }) {
      const [diff, setDiff] = useState('')
      const [diffFor, setDiffFor] = useState('')
      const [verifyReport, setVerifyReport] = useState(null)
      if (delivery === null) return h('div', { style: S.empty }, '正在加载交付…')
      const runVerify = async () => {
        const report = await onVerifyArtifacts()
        if (report !== undefined) setVerifyReport(report)
      }
      const openDiff = async (artifactId) => {
        try {
          const value = await call('delivery.diff', { artifactId })
          setDiff(value.diff)
          setDiffFor(artifactId)
        } catch (failure) {
          setDiff(String(failure?.message ?? failure))
          setDiffFor(artifactId)
        }
      }
      return h('div', { style: { display: 'grid', gap: 12, overflow: 'auto', minHeight: 0 } },
        h('div', { style: S.card },
          h('div', { style: S.row },
            h('strong', { style: { fontSize: 13 } }, '代码工件'),
            h('span', { style: S.grow }),
            h(Button, { onClick: () => { void runVerify() } }, '校验工件完整性')),
          verifyReport === null ? null : h('p', { style: { ...S.muted, color: verifyReport.missing + verifyReport.corrupted === 0 ? '#05603a' : '#b42318' } },
            `已校验 ${verifyReport.checked} 个工件：${verifyReport.ok} 正常 / ${verifyReport.missing} 缺失 / ${verifyReport.corrupted} 哈希不符`),
          h(Table, {
            columns: [
              { key: 'id', title: '工件', render: (row) => h('span', { style: S.code }, row.id) },
              { key: 'task', title: '任务', render: (row) => `${row.task_id} ${row.title}` },
              { key: 'commit', title: '提交', render: (row) => h('span', { style: S.code }, short(row.repo_commit, 12)) },
              { key: 'files', title: '文件数', render: (row) => String((row.summary.files ?? []).length) },
              { key: 'sha', title: 'Diff sha256', render: (row) => h('span', { style: S.code }, short(row.sha256 ?? '', 12)) },
              { key: 'open', title: '', render: (row) => h(Button, { onClick: () => { void openDiff(row.id) } }, diffFor === row.id ? '已显示' : '查看 Diff') },
            ],
            rows: delivery.artifacts,
            empty: '尚无工件。',
          }),
          diffFor === '' ? null : h('pre', {
            style: { ...S.code, background: 'rgba(16,24,40,.04)', borderRadius: 8, padding: 10, maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap' },
          }, diff),
        ),
        h('div', { style: S.card },
          h('strong', { style: { fontSize: 13 } }, '机器证据（CI）'),
          h('p', { style: S.muted }, '模型结论与机器证据是两件事：只有这里的结果能满足门禁。'),
          h(Table, {
            columns: [
              { key: 'check', title: '检查项', render: (row) => row.check_type },
              { key: 'status', title: '结果', render: (row) => h(Badge, { value: row.status }) },
              { key: 'exit', title: '退出码', render: (row) => String(row.exit_code) },
              { key: 'commit', title: '提交', render: (row) => h('span', { style: S.code }, short(row.head_commit, 12)) },
              { key: 'command', title: '命令', render: (row) => h('span', { style: { ...S.code, fontSize: 11 } }, row.command) },
              { key: 'log', title: '日志', render: (row) => h('span', { style: { ...S.code, fontSize: 10.5 } }, short(row.log_path ?? '', 34)) },
            ],
            rows: delivery.verification,
            empty: '尚未运行任何检查。',
          }),
        ),
        h('div', { style: S.card },
          h('strong', { style: { fontSize: 13 } }, 'AI 评审记录'),
          h(Table, {
            columns: [
              { key: 'task', title: '任务', render: (row) => `${row.task_id} ${row.title}` },
              { key: 'verdict', title: '结论', render: (row) => h(Badge, { value: row.verdict }) },
              { key: 'commit', title: '提交', render: (row) => h('span', { style: S.code }, short(row.head_commit, 12)) },
              { key: 'findings', title: '问题项', render: (row) => (row.findings.length === 0 ? h('span', { style: S.muted }, '无') : row.findings.map((finding, index) => h('div', { key: index, style: { fontSize: 11.5 } }, `${finding.severity}: ${finding.summary}`))) },
              { key: 'when', title: '请求时间', render: (row) => when(row.requested_at) },
            ],
            rows: delivery.reviews,
            empty: '尚未请求评审。',
          }),
          h('p', { style: S.muted }, `本项目共 ${tasks.length} 个任务。`),
        ),
      )
    }

    function TimelinePanel({ timeline }) {
      const [kind, setKind] = useState('')
      const rows = (timeline ?? []).filter((row) => kind === '' || row.kind === kind)
      const kinds = [...new Set((timeline ?? []).map((row) => row.kind))]
      return h('div', { style: { display: 'grid', gap: 12, overflow: 'auto', minHeight: 0 } },
        h('div', { style: S.card },
          h('div', { style: S.row },
            h('strong', { style: { fontSize: 13 } }, '时间线'),
            h('span', { style: S.muted }, rows.length + ' 条（任务事件 / 审计 / 消息 / 检查 / 评审 / 审批 合并，最新在前）'),
            h('span', { style: S.grow }),
            h('select', { style: { ...S.input, maxWidth: 170 }, value: kind, onChange: (event) => setKind(event.target.value) },
              h('option', { value: '' }, '全部类型'),
              kinds.map((entry) => h('option', { key: entry, value: entry }, entry)))),
          h(Table, {
            columns: [
              { key: 'at', title: '时间', render: (row) => when(row.at) },
              { key: 'kind', title: '类型', render: (row) => h(Badge, {
                value: row.kind === 'verification' ? 'PASS' : row.kind === 'review' ? 'IN_REVIEW' : row.kind === 'approval' ? 'NEEDS_HUMAN' : row.kind === 'message' ? 'QUEUED' : 'INCOMPLETE',
                label: row.kind,
              }) },
              { key: 'actor', title: '操作者', render: (row) => h('span', { style: S.code }, row.actor) },
              { key: 'summary', title: '内容', render: (row) => h('span', { style: { fontSize: 12 } }, row.summary) },
              { key: 'task', title: '任务', render: (row) => row.taskId ?? '—' },
            ],
            rows,
            empty: '还没有事件。',
          })),
      )
    }

    function QualityPanel({ metrics }) {
      if (metrics === null || metrics === undefined) return h('div', { style: S.empty }, '正在加载质量与成本…')
      const card = (title, rows) => h('div', { style: S.card },
        h('strong', { style: { fontSize: 13 } }, title),
        h(Table, {
          columns: [
            { key: 'k', title: '指标', render: (row) => row.k },
            { key: 'v', title: '值', render: (row) => h('span', { style: { fontFamily: T.mono } }, String(row.v)) },
          ],
          rows,
        }))
      return h('div', { style: { display: 'grid', gap: 12, overflow: 'auto', minHeight: 0 } },
        h('p', { style: S.muted }, '全部指标由引擎自己的行计算（任务事件、运行、检查、评审、审批），与交付页的数字同源。'),
        h('div', { style: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' } },
          card('任务', [
            { k: '任务总数', v: metrics.tasks.total },
            { k: '已完成 / 进行中 / 已取消', v: `${metrics.tasks.done} / ${metrics.tasks.open} / ${metrics.tasks.cancelled}` },
            { k: '完成率', v: `${metrics.tasks.completionRate}%` },
            { k: '返工任务数', v: `${metrics.tasks.reworkedTasks}（${metrics.tasks.reworkRate}%）` },
            { k: '平均周期（分钟）', v: metrics.tasks.avgCycleMinutes },
          ]),
          card('运行与检查', [
            { k: '运行总数 / 进行中', v: `${metrics.runs.total} / ${metrics.runs.active}` },
            { k: '待恢复 / 已取消', v: `${metrics.runs.recovery} / ${metrics.runs.cancelled}` },
            { k: '检查次数', v: metrics.checks.total },
            { k: '通过 / 失败', v: `${metrics.checks.passed} / ${metrics.checks.failed}` },
            { k: '检查通过率', v: `${metrics.checks.passRate}%` },
            { k: '用量来源', v: metrics.checks.usageSource },
          ]),
          card('评审', [
            { k: '评审总数', v: metrics.reviews.total },
            { k: '批准 / 要求修改 / 无法判定', v: `${metrics.reviews.approved} / ${metrics.reviews.changesRequested} / ${metrics.reviews.inconclusive}` },
            { k: '待结论', v: metrics.reviews.pending },
            { k: '问题项（blocker/critical/major/minor/nit）', v: `${metrics.reviews.findings.blocker ?? 0}/${metrics.reviews.findings.critical ?? 0}/${metrics.reviews.findings.major ?? 0}/${metrics.reviews.findings.minor ?? 0}/${metrics.reviews.findings.nit ?? 0}` },
          ]),
          card('成本与消息', [
            { k: '累计令牌', v: metrics.cost.tokensTotal },
            { k: '近 24h 令牌', v: `${metrics.cost.tokensToday}（上限 ${metrics.cost.tokenBudgetPerDay || '不限'}）` },
            { k: '单次运行上限', v: metrics.cost.tokenBudgetPerRun || '不限' },
            { k: '消息数 / 死信', v: `${metrics.cost.messages} / ${metrics.cost.deadLetters}` },
          ]),
          card('决策', [
            { k: '待处理', v: metrics.approvals.pending },
            { k: '已批准 / 已拒绝', v: `${metrics.approvals.approved} / ${metrics.approvals.rejected}` },
          ]),
        ),
      )
    }

    function DecisionsPanel({ decisions, busy, onDecideChange, onApproveTask, onExecuteMerge }) {
      const [justification, setJustification] = useState('')
      if (decisions === null) return h('div', { style: S.empty }, '正在加载决策…')
      const visible = decisions.changes
      return h('div', { style: { display: 'grid', gap: 12, overflow: 'auto', minHeight: 0 } },
        h('div', { style: S.card },
          h('strong', { style: { fontSize: 13 } }, '等待 Owner 决定'),
          h('p', { style: S.muted }, '只有 Owner 可以批准。Bot 的提案、评审结论或测试结果都不能替代这个决定；你填写的理由会随审批一起存档。'),
          h(Field, { label: '随决定记录的理由' }, h('input', { style: S.input, value: justification, onChange: (event) => setJustification(event.target.value), placeholder: '已核对 diff 与测试日志' })),
          h(Table, {
            columns: [
              { key: 'kind', title: '类型', render: (row) => row.kind },
              { key: 'impact', title: '影响', render: (row) => row.impact },
              { key: 'risk', title: '风险', render: (row) => h(Badge, { value: row.risk_level === 'high' ? 'FAIL' : row.risk_level === 'medium' ? 'NEEDS_HUMAN' : 'INCOMPLETE', label: row.risk_level === 'high' ? '高' : row.risk_level === 'medium' ? '中' : '低' }) },
              { key: 'task', title: '任务', render: (row) => row.task_id ?? '—' },
              { key: 'by', title: '提出方', render: (row) => `${row.proposed_by === 'system' ? '引擎' : short(row.proposed_by, 14)}` },
              { key: 'state', title: '状态', render: (row) => h(Badge, { value: row.status }) },
              { key: 'actions', title: '', render: (row) => h('div', { style: S.row },
                row.status === 'PENDING' ? h(Button, { kind: 'primary', disabled: busy !== '', onClick: () => onDecideChange(row.id, 'APPROVE', justification) }, '批准') : null,
                row.status === 'PENDING' ? h(Button, { kind: 'danger', disabled: busy !== '', onClick: () => onDecideChange(row.id, 'REJECT', justification) }, '拒绝') : null,
                // An approved merge still needs an explicit execution step; nothing merges on its own.
                row.status === 'APPROVED' && row.kind === 'merge' ? h(Button, { kind: 'primary', disabled: busy !== '', onClick: () => onExecuteMerge(row.id) }, '执行合并') : null,
                row.status === 'APPROVED' && row.kind !== 'merge' ? h('span', { style: S.muted }, '已批准，按提案处理') : null,
                row.status === 'EXECUTED' ? h('span', { style: S.muted }, '已执行') : null,
              ) },
            ],
            rows: visible,
            empty: '没有提案或待办。',
          }),
        ),
        h('div', { style: S.card },
          h('strong', { style: { fontSize: 13 } }, '需要你才能完成的任务'),
          h(Table, {
            columns: [
              { key: 'task', title: '任务', render: (row) => `${row.task.id} ${row.task.title}` },
              { key: 'status', title: '状态', render: (row) => h(Badge, { value: row.task.status }) },
              { key: 'gate', title: '门禁', render: (row) => h(Badge, { value: row.gate.status }) },
              { key: 'commit', title: '提交', render: (row) => h('span', { style: S.code }, short(row.task.head_commit ?? '', 12)) },
              { key: 'why', title: '原因', render: (row) => h('span', { style: { ...S.muted, fontSize: 11.5 } }, row.gate.reasons.join('; ')) },
              { key: 'actions', title: '', render: (row) => h('div', { style: S.row },
                h(Button, { kind: 'primary', disabled: busy !== '', onClick: () => onApproveTask(row.task.id, 'APPROVE', row.task.head_commit, justification) }, '批准该版本'),
                h(Button, { kind: 'danger', disabled: busy !== '', onClick: () => onApproveTask(row.task.id, 'REJECT', row.task.head_commit, justification) }, '拒绝'),
              ) },
            ],
            rows: decisions.gated,
            empty: '没有等待审批的事项。',
          }),
        ),
      )
    }

    // One example policy the settings page can insert: real commands, all optional
    // except build and test.
    /** Budget fields shown in Settings: [service field, label]. */
    const BUDGET_FIELDS = [
      ['maxParallelRuns', '最大并行运行'],
      ['perRunMessageLimit', '每任务消息上限'],
      ['hourlyMessageLimit', '每小时消息上限'],
      ['maxRetries', '投递重试上限'],
      ['perRunTokenLimit', '单次运行令牌上限'],
      ['dailyTokenLimit', '24 小时令牌上限'],
    ]

    const samplePolicy = JSON.stringify({
      checks: [
        { type: 'build', command: 'npm run build', required: true },
        { type: 'test', command: 'npm test', required: true },
      ],
    }, null, 2)

    function SettingsPanel({ status, project, budgets, busy, act, onProbe, onSavePolicy, onSaveBudgets, onExport }) {
      const [probe, setProbe] = useState(null)
      const [policyText, setPolicyText] = useState('')
      const [policyError, setPolicyError] = useState('')
      const [budgetDraft, setBudgetDraft] = useState(null)
      const [templates, setTemplates] = useState([])
      const [templateRole, setTemplateRole] = useState('developer')
      const [templateText, setTemplateText] = useState('')
      const [templateStatus, setTemplateStatus] = useState('')
      const env = status?.environment ?? {}
      useEffect(() => {
        if (project === undefined) return
        setPolicyText(JSON.stringify(project.policy ?? {}, null, 2))
      }, [project?.id, project?.policy])
      useEffect(() => {
        if (budgets === null || budgets === undefined) return
        setBudgetDraft({
          maxParallelRuns: budgets.max_parallel_runs,
          perRunMessageLimit: budgets.per_run_message_limit,
          hourlyMessageLimit: budgets.hourly_message_limit,
          maxRetries: budgets.max_retries,
          perRunTokenLimit: budgets.per_run_token_limit,
          dailyTokenLimit: budgets.daily_token_limit,
        })
      }, [budgets])
      const loadTemplates = async () => {
        try {
          const rows = await call('templates.list')
          setTemplates(rows)
          const latest = rows.find((row) => row.role === templateRole)
          if (latest !== undefined && templateText === '') setTemplateText(String(latest.prompt_text ?? ''))
        } catch (failure) {
          setTemplateStatus(String(failure?.message ?? failure))
        }
      }
      useEffect(() => { void loadTemplates() }, [])
      const exportProject = async () => {
        const snapshot = await onExport()
        if (snapshot === undefined) return
        const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `project-teams-${snapshot.project.id}-${Date.now()}.json`
        anchor.click()
        URL.revokeObjectURL(url)
      }
      const runProbe = async (reuse) => {
        const value = await act('probe', () => call('m0.probe', { reuse }), 'M0 探针已执行')
        if (value !== undefined) { setProbe(value); onProbe() }
      }
      const verify = async () => {
        const value = await act('verify', () => call('m0.verify'), '已复核记录的探针')
        if (value !== undefined) setProbe(value)
      }
      return h('div', { style: { display: 'grid', gap: 12, overflow: 'auto', minHeight: 0 } },
        h('div', { style: S.card },
          h('strong', { style: { fontSize: 13 } }, '宿主状态'),
          h(Table, {
            columns: [
              { key: 'k', title: '项目', render: (row) => row.k },
              { key: 'v', title: '值', render: (row) => h('span', { style: S.code }, String(row.v)) },
            ],
            rows: [
              { k: '插件版本', v: status?.version ?? '…' },
              { k: '数据目录', v: status?.dataDir ?? '…' },
              { k: 'Node / Electron', v: `${env.node ?? '?'} / ${env.electron ?? '—'}` },
              { k: 'Session 控制器', v: String(env.hasSessionController) },
              { k: 'SQLite', v: String(env.sqlite) },
              { k: 'Agent 预设', v: (status?.presets ?? []).join(', ') || '（无）' },
              { k: '最大并行运行数', v: String(status?.config?.maxParallelRuns ?? '') },
              { k: '每任务 / 每小时消息上限', v: `${status?.config?.maxMessagesPerTask ?? ''} / ${status?.config?.maxMessagesPerHour ?? ''}` },
            ],
          }),
        ),
        h('div', { style: S.card },
          h('strong', { style: { fontSize: 13 } }, 'M0 兼容性探针'),
          h('p', { style: S.muted }, '创建两个预设不同的普通 Session，通过宿主 Session 控制器把一条消息投递给第二个会话，并回读它自己的持久日志。整个过程没有父 Agent 中转。'),
          h('div', { style: S.row },
            h(Button, { kind: 'primary', disabled: busy !== '', onClick: () => void runProbe(false) }, '运行探针（创建会话）'),
            h(Button, { disabled: busy !== '', onClick: () => void runProbe(true) }, '在已记录会话上重跑'),
            h(Button, { disabled: busy !== '', onClick: () => void verify() }, '复核已记录的探针'),
          ),
          probe === null ? null : h('pre', { style: { ...S.code, background: 'rgba(16,24,40,.04)', borderRadius: 8, padding: 10, maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap' } },
            JSON.stringify(probe.record ?? probe, null, 2).slice(0, 4000)),
        ),
        project === undefined ? null : h('div', { style: S.card },
          h('strong', { style: { fontSize: 13 } }, '项目策略（可编辑）'),
          h('p', { style: S.muted }, '检查项是门禁在任务工作树中执行的命令。修改策略属于 Owner 操作，会写入审计日志。'),
          h('textarea', { style: { ...S.area, minHeight: 120, fontFamily: T.mono, fontSize: 12 }, value: policyText, onChange: (event) => setPolicyText(event.target.value) }),
          policyError === '' ? null : h('span', { style: { fontSize: 12, color: '#b42318' } }, policyError),
          h('div', { style: S.row },
            h(Button, { kind: 'primary', disabled: busy !== '', onClick: () => {
              try {
                const parsed = JSON.parse(policyText === '' ? '{}' : policyText)
                if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('策略必须是 JSON 对象')
                setPolicyError('')
                void onSavePolicy(parsed)
              } catch (failure) {
                setPolicyError(String(failure.message ?? failure))
              }
            } }, '保存策略'),
            h(Button, { onClick: () => setPolicyText(samplePolicy) }, '填入模板')),
        ),
        h('div', { style: S.card },
          h('strong', { style: { fontSize: 13 } }, '角色模板（版本化）'),
          h('p', { style: S.muted }, 'Bot 创建时绑定当时的模板版本；修改会生成新版本，不会静默改写已有 Bot 的说明。'),
          h(Table, {
            columns: [
              { key: 'role', title: '角色', render: (row) => row.role },
              { key: 'version', title: '版本', render: (row) => 'v' + row.version },
              { key: 'len', title: '字符数', render: (row) => String((row.prompt_text ?? '').length) },
              { key: 'at', title: '发布时间', render: (row) => when(row.created_at) },
            ],
            rows: templates,
            empty: '尚无模板。',
          }),
          h('div', { style: S.row },
            h('select', {
              style: { ...S.input, maxWidth: 160 },
              value: templateRole,
              onChange: async (event) => {
                const role = event.target.value
                setTemplateRole(role)
                const latest = templates.find((row) => row.role === role)
                setTemplateText(String(latest?.prompt_text ?? ''))
              },
            }, ['pm', 'developer', 'reviewer', 'qa'].map((role) => h('option', { key: role, value: role }, role))),
            h('span', { style: S.muted }, '选择角色后可编辑正文并发布新版本'),
          ),
          h('textarea', {
            style: { ...S.area, minHeight: 140, fontFamily: T.mono, fontSize: 12 },
            value: templateText,
            onChange: (event) => setTemplateText(event.target.value),
            placeholder: '模板正文，可用 {{project}} {{projectId}} {{botId}} {{role}} 占位符',
          }),
          h('div', { style: S.row },
            h(Button, { kind: 'primary', disabled: busy !== '' || templateText.trim() === '', onClick: async () => {
              try {
                const created = await call('templates.write', { role: templateRole, promptText: templateText })
                setTemplateStatus(`已发布 ${templateRole} v${created.version}（既有 Bot 仍用旧版本）`)
                await loadTemplates()
              } catch (failure) {
                setTemplateStatus(String(failure?.message ?? failure))
              }
            } }, '发布新版本'),
            templateStatus === '' ? null : h('span', { style: S.muted }, templateStatus),
          ),
        ),
        project === undefined || budgetDraft === null ? null : h('div', { style: S.card },
          h('strong', { style: { fontSize: 13 } }, '预算（令牌 / 消息 / 并行）'),
          h('p', { style: S.muted }, '令牌数由宿主的 token 计量服务按会话日志回放得出，不产生模型调用；0 表示不限。'),
          h('div', { style: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' } },
            ...BUDGET_FIELDS.map(([field, label]) => h(Field, { key: field, label }, h('input', {
              style: S.input,
              type: 'number',
              value: budgetDraft[field] ?? 0,
              onChange: (event) => setBudgetDraft({ ...budgetDraft, [field]: Number(event.target.value) }),
            })))),
          h('div', { style: S.row },
            h(Button, { kind: 'primary', disabled: busy !== '', onClick: () => void onSaveBudgets(budgetDraft) }, '保存预算'),
            h(Button, { disabled: busy !== '', onClick: () => void exportProject() }, '导出项目 JSON')),
        ),
      )
    }

    // ------------------------------------------------------------- surface

    const icon = h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' },
      h('rect', { x: 3, y: 5, width: 7, height: 5, rx: 1.4 }),
      h('rect', { x: 14, y: 5, width: 7, height: 5, rx: 1.4 }),
      h('rect', { x: 9, y: 15, width: 7, height: 5, rx: 1.4 }),
      h('path', { d: 'M6.5 10v2.5h11V10M12 12.5V15' }),
    )

    return {
      inject: ['slots'],
      apply(ctx) {
        const PanelBody = () => h(Workbench, { compact: false })
        const CompactBody = () => h(Workbench, { compact: true })
        // Left sidebar row: the icon that opens the workbench panel.
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 40,
            label: '项目团队',
          },
          () => icon,
        ))
        // The main-area panel addressed by the same id.
        ctx.slots.inject('main', () => ctx.slots.register(
          { name: 'main', key: PANEL_ID },
          PanelBody,
        ))
        // Plugin Manager row + bundle page, and the Settings → Plugins tab.
        ctx.slots.inject('plugins.row.config', () => ctx.slots.register(
          { name: 'plugins.row.config', key: 'dsh-project-teams#project-teams' },
          CompactBody,
        ))
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register(
          { name: 'plugins.bundle.config', key: 'dsh-project-teams' },
          CompactBody,
        ))
        ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register(
          { name: 'settings.plugins.tab', id: PANEL_ID, order: 40, label: '项目团队' },
          CompactBody,
        ))
      },
    }
  },
})
