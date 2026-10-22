import {
  AlertTriangle,
  Archive,
  Check,
  Crosshair,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  Flag,
  FolderOpen,
  Hand,
  HardDrive,
  Home,
  Image,
  Maximize2,
  MonitorDown,
  MoveHorizontal,
  RotateCcw,
  Ruler,
  StickyNote,
  Table2,
  Undo2,
  Upload,
  Waves,
  X,
  ZoomIn,
} from 'lucide-react'
import { installApp, useCanInstall } from '../pwa/install'
import type { ExportKind } from './ExportDialog'
import { IconButton } from './ui/IconButton'
import { Logo } from './ui/Logo'
import { Menu } from './ui/Menu'
import type { Tool } from './state'

export type SaveStatus = { state: 'clean' } | { state: 'saved'; at: string } | { state: 'error'; error: string }

interface Props {
  fileName: string
  saveStatus: SaveStatus
  onOpen: () => void
  onOpenAnalysis: () => void
  onSaveAnalysis: () => void
  onSaveBundle: () => void
  onReset: () => void
  onShowStorage: () => void
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
  readoutOn: boolean
  onToggleReadout: () => void
  onExport: (kind: ExportKind) => void
  hasSpectra: boolean
}

export function TopBar(p: Props) {
  const toggle = (t: Tool) => p.setTool(p.tool === t ? 'pan' : t)
  const canInstall = useCanInstall()
  return (
    <header className="topbar">
      <div className="brand" title="Scope Viewer">
        <Logo size={22} />
      </div>
      <Menu
        icon={FolderOpen}
        label="File"
        align="left"
        items={[
          { label: 'Open session file…', hint: '.tss .wfm .scopeview', icon: FolderOpen, onClick: p.onOpen },
          { label: 'Open analysis file…', hint: '.scopeview.json', icon: Upload, onClick: p.onOpenAnalysis },
          { label: 'Save analysis file', hint: 'settings, math, callouts', icon: FileJson, divider: true, onClick: p.onSaveAnalysis },
          { label: 'Save session with analysis', hint: '.scopeview', icon: Archive, onClick: p.onSaveBundle },
          { label: 'Reset to file defaults…', icon: RotateCcw, divider: true, onClick: p.onReset },
          { label: 'Saved in this browser…', icon: HardDrive, onClick: p.onShowStorage },
          ...(canInstall ? [{ label: 'Install Scope Viewer…', hint: 'own window, offline', icon: MonitorDown, divider: true, onClick: () => void installApp() }] : []),
          { label: 'Close session', icon: X, divider: true, onClick: p.onClose },
        ]}
      />
      <span className="file-name" title={p.fileName}>
        {p.fileName}
      </span>
      <SaveIndicator status={p.saveStatus} onClick={p.onShowStorage} />

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
      <IconButton icon={Crosshair} label="Values at the pointer" shortcut="V" active={p.readoutOn} onClick={p.onToggleReadout} />

      <div className="spacer" />

      <Menu
        icon={Download}
        label="Export"
        items={[
          { label: 'Image…', hint: 'PNG', icon: Image, onClick: () => p.onExport('image') },
          { label: 'Report…', hint: 'HTML / PDF', icon: FileText, onClick: () => p.onExport('report') },
          { label: 'Waveform data…', hint: 'CSV', icon: Waves, divider: true, onClick: () => p.onExport('waveforms') },
          { label: 'Measurements…', hint: 'CSV', icon: Table2, onClick: () => p.onExport('measurements') },
          { label: 'Spectra…', hint: 'CSV', icon: FileSpreadsheet, disabled: !p.hasSpectra, onClick: () => p.onExport('spectra') },
        ]}
      />
      <IconButton icon={X} label="Close session" onClick={p.onClose} />
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
