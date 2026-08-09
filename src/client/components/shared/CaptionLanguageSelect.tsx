import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { NO_CAPTION } from "@/lib/captions"

interface CaptionLanguageSelectProps {
  codes: string[]
  value: string
  onValueChange: (value: string) => void
  label: string
  includeOff?: boolean
  className?: string
}

export function CaptionLanguageSelect({
  codes,
  value,
  onValueChange,
  label,
  includeOff = false,
  className,
}: CaptionLanguageSelectProps) {
  const items = includeOff
    ? [
        { value: "off", label: "關閉字幕" },
        ...codes.map((code) => ({ value: code, label: code })),
      ]
    : codes.length > 0
      ? codes.map((code) => ({ value: code, label: code }))
      : [{ value: NO_CAPTION, label: "無字幕" }]
  const normalizedValue = items.some((item) => item.value === value)
    ? value
    : items[0].value

  return (
    <Select
      items={items}
      value={normalizedValue}
      disabled={!includeOff && codes.length === 0}
      onValueChange={(nextValue) => {
        if (nextValue) onValueChange(nextValue)
      }}
    >
      <SelectTrigger aria-label={label} className={className}>
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
