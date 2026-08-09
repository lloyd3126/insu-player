import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const UNCONFIGURED_VALUE = "unconfigured"
const MANAGE_VALUE = "manage"

interface ApiKeySelectProps {
  apiKeyName: string
  configured: boolean
  modelName: string
  onManage: () => void
}

export function ApiKeySelect({
  apiKeyName,
  configured,
  modelName,
  onManage,
}: ApiKeySelectProps) {
  const currentValue = configured ? apiKeyName : UNCONFIGURED_VALUE
  const items = [
    {
      value: currentValue,
      label: configured ? apiKeyName : "尚未設定",
    },
    {
      value: MANAGE_VALUE,
      label: `${configured ? "管理" : "設定"} ${apiKeyName}`,
    },
  ]

  return (
    <Select
      items={items}
      value={currentValue}
      onValueChange={(value) => {
        if (value === MANAGE_VALUE) onManage()
      }}
    >
      <SelectTrigger
        aria-label={`${modelName} API Key`}
        className="model-api-key-select"
      >
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
