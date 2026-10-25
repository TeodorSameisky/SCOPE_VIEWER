import { AlertTriangle, Check, Download, FolderOpen, HardDrive } from 'lucide-react'
import type { Tool } from '../model/view'
import type { SaveStatus } from '../model/workspace'
import { TOOL_ORDER } from './keymap'
import { exportMenu, fileMenu, type ScopeActions } from './scopeCommands'
import { ActionButton } from './ui/IconButton'
import { Logo } from './ui/Logo'
import { Menu } from './ui/Menu'

interface Props {
  fileName: string
  saveStatus: SaveStatus
  actions: ScopeActions
}

const isNavTool = (t: Tool) => t === 'pan' || t === 'zoom'
const NAV_TOOLS = TOOL_ORDER.filter(isNavTool)
const CALLOUT_TOOLS = TOOL_ORDER.filter((t) => !isNavTool(t))

export function TopBar({ fileName, saveStatus, actions: a }: Props) {
  return (
    <header className="topbar">
      <div className="brand" title="Scope Viewer">
        <Logo size={22} />
      </div>
      <Menu icon={FolderOpen} label="File" align="left" items={fileMenu(a)} />
      <span className="file-name" title={fileName}>
        {fileName}
      </span>
      <SaveIndicator status={saveStatus} onClick={a.storage.run} />
      <ActionButton action={a.undo} />
      <ActionButton action={a.redo} />

      <div className="spacer" />

      <div className="tool-group" role="group" aria-label="Mouse tool">
        {NAV_TOOLS.map((t) => (
          <ActionButton key={t} action={a.tools[t]} showLabel />
        ))}
      </div>
      <div className="tool-group" role="group" aria-label="Callouts">
        {CALLOUT_TOOLS.map((t) => (
          <ActionButton key={t} action={a.tools[t]} showLabel />
        ))}
      </div>

      <div className="sep" />
      <ActionButton action={a.back} />
      <ActionButton action={a.savedView} />
      <ActionButton action={a.fullRecord} />
      <ActionButton action={a.autoscale} />
      <div className="sep" />
      <ActionButton action={a.cursors} showLabel />
      <ActionButton action={a.readout} />

      <div className="spacer" />

      <ActionButton action={a.palette} />
      <Menu icon={Download} label="Export" items={exportMenu(a)} />
      <ActionButton action={a.close} />
    </header>
  )
}

/** Small status next to the file name: are the changes remembered? */
function SaveIndicator({ status, onClick }: { status: SaveStatus; onClick: () => void }) {
  if (status.state === 'error') {
    return (
      <button type="button" className="save-status error" title={`Changes are not saved: ${status.error}`} onClick={onClick}>
        <AlertTriangle size={13} aria-hidden /> Not saved
      </button>
    )
  }
  const title =
    status.state === 'saved'
      ? `Your changes are saved in this browser (${new Date(status.at).toLocaleTimeString()})`
      : 'Unchanged. Changes you make are saved automatically in this browser.'
  return (
    <button type="button" className="save-status" title={title} onClick={onClick}>
      {status.state === 'saved' ? <Check size={13} aria-hidden /> : <HardDrive size={13} aria-hidden />}
      <span className="btn-label">{status.state === 'saved' ? 'Saved' : 'Unchanged'}</span>
    </button>
  )
}
