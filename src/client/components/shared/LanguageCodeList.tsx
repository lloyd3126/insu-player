import { Badge } from "@/components/ui/badge"

export function LanguageCodeList({ codes }: { codes: string[] }) {
  if (codes.length === 0) return <span className="muted-copy">—</span>
  return (
    <div className="language-code-list" aria-label={`字幕 ${codes.join(", ")}`}>
      {codes.map((code) => (
        <Badge key={code} variant="secondary">
          {code}
        </Badge>
      ))}
    </div>
  )
}
