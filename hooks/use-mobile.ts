import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  // Deliberately starts undefined rather than reading window in a lazy
  // initializer: the initializer runs during hydration too, so on a narrow
  // viewport it returned true on the client while the server (no window) had
  // rendered false — and Sidebar renders a completely different tree for each,
  // which surfaced as a hydration mismatch on <main>. Measuring in the effect
  // instead keeps the first client render identical to the server's.
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    // Take the first measurement here, after hydration has committed.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
