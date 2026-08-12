import { useMutation, useQueryClient } from "@tanstack/react-query"
import { RefreshCwIcon, SaveIcon, Trash2Icon } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"

import { api } from "@/api/client"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useSubtitleStyles } from "@/hooks/use-subtitle-styles"
import { subtitleStyleToCss } from "@/lib/subtitle-styles"
import {
  DEFAULT_SUBTITLE_STYLES,
  type SubtitleStylePreferences,
  type SubtitleStyleResponse,
  type SubtitleTextStyle,
} from "@shared/contracts/subtitle-style"

type SubtitlePosition = "primary" | "secondary"
type SubtitleStyleTab = SubtitlePosition | "bilingual"
const SHADOW_LABELS: Record<SubtitleTextStyle["shadow"], string> = {
  none: "無",
  soft: "柔和",
  strong: "清楚",
}

function cloneStyles(styles: SubtitleStylePreferences): SubtitleStylePreferences {
  return {
    primary: { ...styles.primary },
    secondary: { ...styles.secondary },
    bilingual: { ...styles.bilingual },
  }
}

function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <TableRow>
      <TableHead scope="row" className="subtitle-style-field-label">
        {label}
      </TableHead>
      <TableCell className="subtitle-style-field-control">{children}</TableCell>
    </TableRow>
  )
}

function NumericSetting({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <SettingRow label={label}>
      <Input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </SettingRow>
  )
}

function ColorSetting({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <SettingRow label={label}>
      <div className="subtitle-style-color-control">
        <Input
          type="color"
          aria-label={`${label}選色器`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <Input
          aria-label={label}
          value={value}
          maxLength={7}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </SettingRow>
  )
}

function SettingsTable({ children }: { children: ReactNode }) {
  return (
    <div className="subtitle-style-controls">
      <Table className="subtitle-style-table">
        <TableHeader>
          <TableRow>
            <TableHead>設定</TableHead>
            <TableHead>自訂值</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </div>
  )
}

function SubtitleStyleEditor({
  position,
  preferences,
  onChange,
}: {
  position: SubtitlePosition
  preferences: SubtitleStylePreferences
  onChange: (preferences: SubtitleStylePreferences) => void
}) {
  const style = preferences[position]
  const label = position === "primary" ? "第一字幕" : "第二字幕"
  const update = <K extends keyof SubtitleTextStyle>(
    key: K,
    value: SubtitleTextStyle[K],
  ) => onChange({ ...preferences, [position]: { ...style, [key]: value } })

  return (
    <div className="subtitle-style-editor">
      <div className="subtitle-style-preview" aria-label={`${label}預覽`}>
        <span className="subtitle-style-preview__caption" style={subtitleStyleToCss(style)}>
          <span>{label}預覽文字</span>
          <span>第二行字幕預覽</span>
        </span>
      </div>
      <SettingsTable>
        <NumericSetting label="文字縮放" value={style.fontScale} min={0.7} max={2} step={0.05} onChange={(value) => update("fontScale", value)} />
        <NumericSetting label="文字粗細" value={style.fontWeight} min={400} max={800} step={50} onChange={(value) => update("fontWeight", value)} />
        <ColorSetting label="文字顏色" value={style.textColor} onChange={(value) => update("textColor", value)} />
        <ColorSetting label="背景顏色" value={style.backgroundColor} onChange={(value) => update("backgroundColor", value)} />
        <NumericSetting label="背景透明度" value={style.backgroundOpacity} min={0} max={1} step={0.05} onChange={(value) => update("backgroundOpacity", value)} />
        <NumericSetting label="文字行距" value={style.lineHeight} min={1} max={2} step={0.05} onChange={(value) => update("lineHeight", value)} />
        <NumericSetting label="水平內距" value={style.paddingX} min={0} max={1.5} step={0.05} onChange={(value) => update("paddingX", value)} />
        <NumericSetting label="垂直內距" value={style.paddingY} min={0} max={1} step={0.05} onChange={(value) => update("paddingY", value)} />
        <NumericSetting label="背景圓弧" value={style.radius} min={0} max={0.8} step={0.05} onChange={(value) => update("radius", value)} />
        <SettingRow label="文字陰影">
          <Select value={style.shadow} onValueChange={(value) => value && update("shadow", value as SubtitleTextStyle["shadow"])}>
            <SelectTrigger aria-label="文字陰影">
              <SelectValue>{SHADOW_LABELS[style.shadow]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">無</SelectItem>
              <SelectItem value="soft">柔和</SelectItem>
              <SelectItem value="strong">清楚</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
        <NumericSetting label="文字間距" value={style.letterSpacing} min={-0.05} max={0.1} step={0.01} onChange={(value) => update("letterSpacing", value)} />
      </SettingsTable>
    </div>
  )
}

function BilingualStyleEditor({
  preferences,
  onChange,
}: {
  preferences: SubtitleStylePreferences
  onChange: (preferences: SubtitleStylePreferences) => void
}) {
  return (
    <div className="subtitle-style-editor">
      <div className="subtitle-style-preview" aria-label="雙語字幕預覽">
        <div className="subtitle-style-preview__bilingual" style={{ gap: `${preferences.bilingual.gap}rem` }}>
          <span style={subtitleStyleToCss(preferences.primary)}>第一字幕預覽文字</span>
          <span style={subtitleStyleToCss(preferences.secondary)}>第二字幕預覽文字</span>
        </div>
      </div>
      <SettingsTable>
        <NumericSetting
          label="字幕間距"
          value={preferences.bilingual.gap}
          min={0}
          max={2}
          step={0.05}
          onChange={(gap) => onChange({ ...preferences, bilingual: { gap } })}
        />
      </SettingsTable>
    </div>
  )
}

export function SubtitleStylePanel() {
  const queryClient = useQueryClient()
  const query = useSubtitleStyles()
  const [activeTab, setActiveTab] = useState<SubtitleStyleTab>("primary")
  const [draft, setDraft] = useState(() => cloneStyles(DEFAULT_SUBTITLE_STYLES))
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [presetName, setPresetName] = useState("")

  useEffect(() => {
    if (!query.data) return
    setDraft(cloneStyles(query.data.active))
    setSelectedPresetId(query.data.activePresetId)
  }, [query.data])

  const synchronize = (response: SubtitleStyleResponse) => {
    queryClient.setQueryData(["subtitle-styles"], response)
    setDraft(cloneStyles(response.active))
    setSelectedPresetId(response.activePresetId)
  }
  const apply = useMutation({
    mutationFn: () => api.setActiveSubtitleStyles(draft, selectedPresetId),
    onSuccess: synchronize,
  })
  const create = useMutation({
    mutationFn: () => api.createSubtitleStylePreset(presetName, draft),
    onSuccess: (response) => {
      synchronize(response)
      setSaveOpen(false)
      setPresetName("")
    },
  })
  const update = useMutation({
    mutationFn: () => {
      const preset = query.data?.presets.find((candidate) => candidate.id === selectedPresetId)
      if (!preset) throw new Error("請先選擇已保存的樣式")
      return api.updateSubtitleStylePreset(preset.id, preset.name, draft)
    },
    onSuccess: synchronize,
  })
  const remove = useMutation({
    mutationFn: () => {
      if (!selectedPresetId) throw new Error("請先選擇已保存的樣式")
      return api.removeSubtitleStylePreset(selectedPresetId)
    },
    onSuccess: synchronize,
  })
  const activePosition = activeTab === "bilingual" ? null : activeTab
  const otherPosition = activePosition === "primary" ? "secondary" : "primary"
  const busy = apply.isPending || create.isPending || update.isPending || remove.isPending
  const error = apply.error ?? create.error ?? update.error ?? remove.error ?? query.error

  return (
    <section className="subtitle-style-panel" aria-label="字幕樣式">
      <div className="subtitle-style-toolbar">
        <div className="subtitle-style-preset-controls">
          <Select
            value={selectedPresetId ?? "custom"}
            onValueChange={(value) => {
              if (!value || value === "custom") {
                setSelectedPresetId(null)
                return
              }
              const preset = query.data?.presets.find((candidate) => candidate.id === value)
              if (preset) {
                setSelectedPresetId(preset.id)
                setDraft(cloneStyles(preset.styles))
              }
            }}
          >
            <SelectTrigger aria-label="已保存樣式">
              <SelectValue>
                {selectedPresetId
                  ? query.data?.presets.find(
                      (preset) => preset.id === selectedPresetId,
                    )?.name ?? "自訂樣式"
                  : "自訂樣式"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="custom">自訂樣式</SelectItem>
              {query.data?.presets.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>{preset.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" onClick={() => apply.mutate()} disabled={busy}>套用</Button>
          <Button type="button" variant="outline" onClick={() => setSaveOpen(true)} disabled={busy}>
            <SaveIcon data-icon="inline-start" />另存樣式
          </Button>
          <Button type="button" variant="outline" onClick={() => update.mutate()} disabled={busy || !selectedPresetId}>更新</Button>
          <AlertDialog>
            <AlertDialogTrigger render={<Button type="button" variant="outline" size="icon" aria-label="刪除樣式" disabled={busy || !selectedPresetId} />}>
              <Trash2Icon />
            </AlertDialogTrigger>
            <AlertDialogContent overlayEmphasis="strong">
              <AlertDialogHeader>
                <AlertDialogTitle>刪除已保存樣式</AlertDialogTitle>
                <AlertDialogDescription>播放器目前套用的數值會保留，只有這個名稱會被移除。</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => remove.mutate()}>刪除</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setDraft(cloneStyles(DEFAULT_SUBTITLE_STYLES))
              setSelectedPresetId(null)
            }}
          >
            <RefreshCwIcon data-icon="inline-start" />預設值
          </Button>
        </div>
        {activePosition ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => setDraft({ ...draft, [otherPosition]: { ...draft[activePosition] } })}
          >
            <RefreshCwIcon data-icon="inline-start" />
            同步到{otherPosition === "primary" ? "第一字幕" : "第二字幕"}
          </Button>
        ) : null}
        {error ? <small role="alert">{error.message}</small> : null}
      </div>
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as SubtitleStyleTab)} className="subtitle-style-tabs">
        <TabsList variant="line" aria-label="字幕位置">
          <TabsTrigger value="primary">第一字幕</TabsTrigger>
          <TabsTrigger value="secondary">第二字幕</TabsTrigger>
          <TabsTrigger value="bilingual">雙語字幕</TabsTrigger>
        </TabsList>
        {(["primary", "secondary"] as const).map((position) => (
          <TabsContent key={position} value={position} className="subtitle-style-tab-panel">
            {activeTab === position ? <SubtitleStyleEditor position={position} preferences={draft} onChange={setDraft} /> : null}
          </TabsContent>
        ))}
        <TabsContent value="bilingual" className="subtitle-style-tab-panel">
          {activeTab === "bilingual" ? <BilingualStyleEditor preferences={draft} onChange={setDraft} /> : null}
        </TabsContent>
      </Tabs>
      <Dialog open={saveOpen} onOpenChange={(open) => !create.isPending && setSaveOpen(open)}>
        <DialogContent overlayEmphasis="strong">
          <DialogHeader>
            <DialogTitle>另存字幕樣式</DialogTitle>
            <DialogDescription>保存目前三個分頁中的完整設定，之後可直接套用。</DialogDescription>
          </DialogHeader>
          <Input aria-label="樣式名稱" placeholder="例如：深色雙語" value={presetName} onChange={(event) => setPresetName(event.target.value)} />
          {create.isError ? <small role="alert">{create.error.message}</small> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSaveOpen(false)} disabled={create.isPending}>取消</Button>
            <Button type="button" onClick={() => create.mutate()} disabled={create.isPending || !presetName.trim()}>
              {create.isPending ? <Spinner data-icon="inline-start" /> : null}保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
