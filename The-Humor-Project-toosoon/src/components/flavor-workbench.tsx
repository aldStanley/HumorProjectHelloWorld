'use client'

import { useState } from 'react'

import HumorFlavorPicker, { type HumorFlavor } from './humor-flavor-picker'
import ToolDirectory from './tool-directory'

// The root workbench, side by side: pick a flavor on the left, pick a tool
// for it on the right.

export default function FlavorWorkbench({
  flavors,
}: {
  flavors: HumorFlavor[]
}) {
  const [selected, setSelected] = useState<HumorFlavor | null>(null)

  return (
    // minmax(0, Nfr) pins the column widths: without the 0 minimum, a long
    // unbreakable slug would widen its column on every selection.
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className="min-w-0">
        <HumorFlavorPicker
          flavors={flavors}
          selectedId={selected?.id ?? null}
          onSelect={(flavor) =>
            setSelected((prev) => (prev?.id === flavor.id ? null : flavor))
          }
        />
      </section>
      <section className="min-w-0">
        <ToolDirectory selected={selected} />
      </section>
    </div>
  )
}
