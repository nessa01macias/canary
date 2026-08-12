import { useState } from 'react'
import App from './App'
import { Landing } from './components/Landing'

// The gate: every load lands on the landing page first (the front door);
// entering swaps in the actual product (the map IS the demo).
export default function Root() {
  const [entered, setEntered] = useState(false)
  return entered ? <App /> : <Landing onEnter={() => setEntered(true)} />
}
