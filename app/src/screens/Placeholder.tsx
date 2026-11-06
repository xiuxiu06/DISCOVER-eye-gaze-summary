import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface PlaceholderProps {
  title: string
  question: string
  /** What still needs building on this screen. */
  todo: string[]
  /** Live values showing the screen already gets its data. */
  children: ReactNode
}

/** Temporary frame for a screen. Delete it once all four screens are built. */
export function Placeholder({ title, question, todo, children }: PlaceholderProps) {
  return (
    <section className="flex max-w-4xl flex-col gap-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-muted-foreground">{question}</p>
      </div>
      <Card>
        <CardContent>{children}</CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Still to build <Badge variant="outline">Placeholder</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-5">
            {todo.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  )
}
