import type { ReactNode } from 'react'

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
    <section className="screen">
      <h2>{title}</h2>
      <p className="question">{question}</p>
      <div className="readout">{children}</div>
      <h3>Still to build</h3>
      <ul>
        {todo.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  )
}
