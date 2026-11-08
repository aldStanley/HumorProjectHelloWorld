import type { Metadata } from 'next'

// Browser-tab titles, set on the server so Next's streamed metadata never
// overwrites them. The root layout's title template supplies the
// "The Matrix: " prefix; pages supply only the part after it:
//   /humor-flavor/1540/ops-reverse → "Flavor 1540 · ops-reverse"
//   /humor-flavor/1540             → "Flavor 1540"
//   /humor-flavor-step/77          → "Step 77"
//   /sidechat-events               → "sidechat-events"
// Query string and hash are ignored on purpose: they name a state, not a page.

type FlavorParams = { params: Promise<{ humorFlavorId: string }> }
type StepParams = { params: Promise<{ humorFlavorStepId: string }> }

// `export const generateMetadata = flavorPageMetadata('ops-reverse')` in a
// flavor page; omit the surface on the flavor's own page.
export const flavorPageMetadata =
  (surface?: string) =>
  async ({ params }: FlavorParams): Promise<Metadata> => {
    const { humorFlavorId } = await params
    return { title: `Flavor ${humorFlavorId}${surface ? ` · ${surface}` : ''}` }
  }

export const stepPageMetadata = async ({ params }: StepParams): Promise<Metadata> => {
  const { humorFlavorStepId } = await params
  return { title: `Step ${humorFlavorStepId}` }
}

// Static pages: the tab reads as the route itself.
export const pageMetadata = (title: string): Metadata => ({ title })
