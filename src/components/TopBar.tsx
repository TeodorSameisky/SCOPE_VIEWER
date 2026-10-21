import {
  Download,
  FileJson,
  FileSpreadsheet,
  Flag,
  FolderOpen,
  Hand,
  Home,
  Image,
  Maximize2,
  MoveHorizontal,
  Ruler,
  StickyNote,
  Undo2,
  X,
  ZoomIn,
} from 'lucide-react'
import { IconButton } from './ui/IconButton'
import { Menu } from './ui/Menu'
import type { Tool } from './state'

interface Props {
  fileName: string
  onOpen: () => void
  onClose: () => void
  tool: Tool
  setTool: (t: Tool) => void
  canGoBack: boolean
  onBack: () => void
  onSavedView: () => void
  onFullRecord: () => void
  zoomed: boolean
  cursorsOn: boolean
  onToggleCursors: () => void
  onExportCsv: () => void
  onExportPng: () => void
  onExportCallouts: () => void
  calloutCount: number
}

export function TopBar(p: Props) {
  const toggle = (t: Tool) => p.setTool(p.tool === t ? 'pan' : t)
  return (
    <header className="topbar">
      <div className="brand" title="Scope Viewer">
        <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden>
          <path d="M3 20h6l3-10 4 14 3-9 2 5h8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      </div>
      <IconButton icon={FolderOpen} label="Open" onClick={p.onOpen} />
      <span className="file-name" title={p.fileName}>
        {p.fileName}
      </span>

      <div className="spacer" />

      <div className="tool-group" role="group" aria-label="Mouse tool">
        <IconButton icon={Hand} label="Pan" shortcut="P" showLabel active={p.tool === 'pan'} onClick={() => p.setTool('pan')} />
        <IconButton icon={ZoomIn} label="Zoom" shortcut="Z" showLabel active={p.tool === 'zoom'} onClick={() => p.setTool('zoom')} />
      </div>
      <div className="tool-group" role="group" aria-label="Callouts">
        <IconButton icon={StickyNote} label="Note" shortcut="N" showLabel active={p.tool === 'note'} onClick={() => toggle('note')} />
        <IconButton icon={Flag} label="Marker" shortcut="M" showLabel active={p.tool === 'marker'} onClick={() => toggle('marker')} />
        <IconButton icon={MoveHorizontal} label="Region" shortcut="R" showLabel active={p.tool === 'region'} onClick={() => toggle('region')} />
      </div>

      <div className="sep" />
      <IconButton icon={Undo2} label="Back" shortcut="Backspace" disabled={!p.canGoBack} onClick={p.onBack} />
      <IconButton icon={Home} label="Saved view" onClick={p.onSavedView} />
      <IconButton icon={Maximize2} label="Full record" shortcut="F" disabled={!p.zoomed} onClick={p.onFullRecord} />
      <div className="sep" />
      <IconButton icon={Ruler} label="Cursors" shortcut="C" showLabel active={p.cursorsOn} onClick={p.onToggleCursors} />

      <div className="spacer" />

      <Menu
        icon={Download}
        label="Export"
        items={[
          { label: 'Waveforms as CSV', hint: 'visible range', icon: FileSpreadsheet, onClick: p.onExportCsv },
          { label: 'Plot as PNG', hint: 'with callouts', icon: Image, onClick: p.onExportPng },
          { label: 'Callouts as JSON', icon: FileJson, disabled: !p.calloutCount, onClick: p.onExportCallouts },
        ]}
      />
      <IconButton icon={X} label="Close session" onClick={p.onClose} />
    </header>
  )
}
