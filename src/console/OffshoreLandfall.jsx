import { Landfall } from '../components/Landfall.jsx'
import { useConsole } from './useConsole.js'

// The arrival countdown, driven by the offshore level on each beach's own
// scale, so it agrees with the headline tiles on the consoles.
export function OffshoreLandfall({ profile, scope = 'all' }) {
  const d = useConsole(profile, { scope, regional: false })
  return <Landfall landfall={d.landfall} />
}
