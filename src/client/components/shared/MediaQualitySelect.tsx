import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { MediaRendition } from "@shared/contracts/media"

export function MediaQualitySelect({
  renditions,
  value,
  onValueChange,
  disabled = false,
}: {
  renditions: MediaRendition[]
  value: string
  onValueChange: (renditionId: string) => void
  disabled?: boolean
}) {
  const items = renditions.map((rendition) => ({
    value: rendition.id,
    label: `${rendition.height}p`,
  }))
  const normalized = items.some((item) => item.value === value)
    ? value
    : items[0]?.value
  return (
    <Select
      items={items}
      value={normalized}
      disabled={disabled || items.length < 2}
      onValueChange={(nextValue) => {
        if (nextValue) onValueChange(nextValue)
      }}
    >
      <SelectTrigger aria-label="播放器畫質" className="media-quality-select">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
