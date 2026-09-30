'use client'

import { openTour } from './WelcomeTour'

/** Footer link that replays the welcome tour. */
export function TourLink() {
  return (
    <button type="button" onClick={openTour} className="text-left transition hover:text-fg">
      Take the tour
    </button>
  )
}
