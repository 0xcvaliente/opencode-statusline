import { Plugin } from "@opencode/plugin/tui"
import type { ModelInfo, SessionMessageAssistant, SessionMessageInfo } from "@opencode/client"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js"

/**
 * OpenCode status line, in the spirit of a Claude Code statusLine command.
 *
 * Replaces the built-in prompt footer with a single line:
 *   [model] 📁 folder | 🌿 branch *N | +A -R | [ctx] ● ● ○ … 42% | $0.04
 *
 * Enable it in ~/.config/opencode/cli.json and disable the built-in footer it
 * replaces:
 *   {
 *     "plugins": ["-opencode.prompt.footer", "opencode-statusline"]
 *   }
 */

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
const REFRESH_MS = 3000
const DOTS = 10
// Columns reserved by the footer's own padding/inset, mirroring OpenCode's frame.
const FRAME = 4

function basename(path: string) {
  const trimmed = path.replace(/[\\/]+$/, "")
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"))
  return index >= 0 ? trimmed.slice(index + 1) : trimmed
}

/** Approximate rendered width: full-width scripts and emoji occupy two cells. */
function textWidth(value: string) {
  let width = 0
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f000 && code <= 0x1faff) ||
      (code >= 0x2600 && code <= 0x27bf)
    )
      width += 2
    else width += 1
  }
  return width
}

/** Mirrors the built-in footer: the newest assistant step with real usage, honoring a revert boundary. */
function lastAssistantWithUsage(messages: readonly SessionMessageInfo[], boundary?: string) {
  const cut = boundary ? messages.findIndex((message) => message.id === boundary) : -1
  const scope = cut >= 0 ? messages.slice(0, cut) : messages
  for (let index = scope.length - 1; index >= 0; index--) {
    const message = scope[index]
    if (message.type !== "assistant") continue
    const assistant = message as SessionMessageAssistant
    if (assistant.tokens && assistant.tokens.output > 0) return assistant
  }
  return undefined
}

function contextUsage(messages: readonly SessionMessageInfo[], models: readonly ModelInfo[], boundary?: string) {
  const last = lastAssistantWithUsage(messages, boundary)
  if (!last?.tokens) return undefined
  const tokens =
    last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
  if (tokens <= 0) return undefined
  const model = models.find((item) => item.providerID === last.model.providerID && item.id === last.model.id)
  return { tokens, percent: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : undefined }
}

function dots(filled: number, total: number) {
  const parts: string[] = []
  for (let index = 0; index < total; index++) parts.push(index < filled ? "●" : "○")
  return parts.join(" ")
}

type Vcs = { files: number; added: number; removed: number }

function StatusLine(props: {
  context: Plugin.Context
  sessionID?: string
  mode: "normal" | "shell"
  showDetails: boolean
}) {
  const context = props.context
  const theme = () => context.theme
  const dimensions = useTerminalDimensions()
  const [vcs, setVcs] = createSignal<Vcs>()

  const session = createMemo(() => (props.sessionID ? context.data.session.get(props.sessionID) : undefined))
  const location = createMemo(() => session()?.location ?? context.location ?? context.data.location.default())
  const models = createMemo<ModelInfo[]>(() => context.data.location.model.list(location()) ?? [])

  const modelName = createMemo(() => {
    const selected = context.ui.model.current()
    if (!selected) return undefined
    const model = models().find(
      (item) =>
        item.providerID === selected.providerID && (item.modelID === selected.modelID || item.id === selected.modelID),
    )
    return model?.name ?? selected.modelID
  })

  const branch = createMemo(() => context.data.location.vcs.info(location())?.branch.current)

  const usage = createMemo(() =>
    props.sessionID
      ? contextUsage(context.data.session.message.list(props.sessionID), models(), session()?.revert?.messageID)
      : undefined,
  )

  const cost = createMemo(() => (props.sessionID ? context.data.session.cost(props.sessionID) : 0))

  const files = () => vcs()?.files ?? 0
  const added = () => vcs()?.added ?? 0
  const removed = () => vcs()?.removed ?? 0
  const percent = () => usage()?.percent ?? 0
  const dotBar = () => dots(Math.round(percent() / (100 / DOTS)), DOTS)

  // Plain-text mirrors of each segment, used only to decide what fits.
  const coreText = () =>
    (modelName() ? `[${modelName()}] ` : "") +
    `📁 ${basename(location().directory)}` +
    (branch() ? ` | 🌿 ${branch()}${files() > 0 ? ` *${files()}` : ""}` : "")
  const linesText = () => ` | +${added()} -${removed()}`
  const ctxFullText = () => ` | [ctx] ${dotBar()} ${percent()}%`
  const ctxShortText = () => ` | [ctx] ${percent()}%`
  const costText = () => ` | ${money.format(cost())}`

  // Fit segments left to right, dropping whatever the terminal cannot hold. The
  // context meter keeps a compact `[ctx] 42%` form before falling away entirely.
  const visible = createMemo(() => {
    let used = textWidth(coreText())
    const available = Math.max(0, dimensions().width - FRAME)
    const result: { lines: boolean; ctx: "full" | "short" | null; cost: boolean } = {
      lines: false,
      ctx: null,
      cost: false,
    }
    const fits = (text: string) => {
      if (used + textWidth(text) > available) return false
      used += textWidth(text)
      return true
    }
    if (!props.showDetails) return result
    if (added() + removed() > 0) result.lines = fits(linesText())
    if (usage()) result.ctx = fits(ctxFullText()) ? "full" : fits(ctxShortText()) ? "short" : null
    if (cost() > 0) result.cost = fits(costText())
    return result
  })

  const barColor = (value: number) => {
    if (value >= 90) return theme().text.feedback.error.base
    if (value >= 70) return theme().text.feedback.warning.base
    return theme().text.feedback.success.base
  }

  let inFlight = false
  const refresh = async () => {
    if (inFlight) return
    inFlight = true
    try {
      const directory = location().directory
      const result = await context.client.vcs.status({ location: { directory } })
      const files = result.data ?? []
      setVcs({
        files: files.length,
        added: files.reduce((sum, file) => sum + (file.additions ?? 0), 0),
        removed: files.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
      })
    } catch {
      // Outside a repository, or the server is momentarily unavailable: keep the last known value.
    } finally {
      inFlight = false
    }
  }

  onMount(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), REFRESH_MS)
    const offs = [
      context.data.on("vcs.branch.updated", () => void refresh()),
      context.data.on("filesystem.changed", () => void refresh()),
      context.data.on("session.execution.succeeded", () => void refresh()),
      context.data.on("session.step.ended", () => void refresh()),
    ]
    onCleanup(() => {
      clearInterval(timer)
      for (const off of offs) off()
    })
  })

  return (
    <Switch>
      <Match when={props.mode === "shell"}>
        <text fg={theme().text.base} wrapMode="none" flexShrink={0}>
          esc <span style={{ fg: theme().text.muted }}>exit shell mode</span>
        </text>
      </Match>
      <Match when={true}>
        <box flexDirection="row" flexShrink={1} minWidth={0}>
          <text wrapMode="none" flexShrink={1} minWidth={0}>
            <Show when={modelName()}>
              <span style={{ fg: theme().text.action.primary.base }}>[{modelName()}]</span>
            </Show>
            {modelName() ? " " : ""}
            <span style={{ fg: theme().text.base }}>{`📁 ${basename(location().directory)}`}</span>
            <Show when={branch()}>
              <span style={{ fg: theme().text.muted }}>{" | "}</span>
              <span style={{ fg: theme().text.feedback.success.base }}>{`🌿 ${branch()}`}</span>
              <Show when={files() > 0}>
                <span style={{ fg: theme().text.feedback.warning.base }}>{` *${files()}`}</span>
              </Show>
            </Show>
            <Show when={visible().lines}>
              <span style={{ fg: theme().text.muted }}>{" | "}</span>
              <span style={{ fg: theme().diff.text.added }}>{`+${added()}`}</span>
              <span style={{ fg: theme().text.muted }}> </span>
              <span style={{ fg: theme().diff.text.removed }}>{`-${removed()}`}</span>
            </Show>
            <Show when={visible().ctx}>
              <span style={{ fg: theme().text.muted }}>{" | "}</span>
              <span style={{ fg: theme().text.muted }}>{"[ctx] "}</span>
              <Show when={visible().ctx === "full"}>
                <span style={{ fg: barColor(percent()) }}>{`${dotBar()} ${percent()}%`}</span>
              </Show>
              <Show when={visible().ctx === "short"}>
                <span style={{ fg: barColor(percent()) }}>{`${percent()}%`}</span>
              </Show>
            </Show>
            <Show when={visible().cost}>
              <span style={{ fg: theme().text.muted }}>{" | "}</span>
              <span style={{ fg: theme().text.muted }}>{money.format(cost())}</span>
            </Show>
          </text>
        </box>
      </Match>
    </Switch>
  )
}

export default Plugin.define({
  id: "opencode.statusline",
  setup(context) {
    context.ui.slot({
      replace: "prompt.footer",
      render: (props) => (
        <StatusLine context={context} sessionID={props.sessionID} mode={props.mode} showDetails={props.showDetails} />
      ),
    })
  },
})
